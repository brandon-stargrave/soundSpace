import * as THREE from 'three';
import * as Tone from 'tone';
import { SceneManager } from '../visual/SceneManager.js';
import { ScaleQuantizer } from './ScaleQuantizer.js';
import { OutputRouter } from './OutputRouter.js';
import { ToneOutput } from '../output/ToneOutput.js';
import { MidiOutput } from '../output/MidiOutput.js';
import { OscOutput } from '../output/OscOutput.js';
import { CenterNebula } from '../visual/CyberpunkStyle.js';
import { HarmonicOrbit } from './HarmonicOrbit.js';
import { OrbitalNodes } from '../generators/OrbitalNodes.js';
import { DEFAULT_SCALE_CONFIG, DEFAULT_SYNTH_CONFIG } from '../util/constants.js';
import { sanitizePreset, PresetError, PRESET_APP, PRESET_VERSION, VISUAL_DEFAULTS, MAX_ORBITS } from './presetSchema.js';
import { getAlgorithmIds, createAlgorithm } from '../generators/motion/MotionRegistry.js';
import { getTriggerIds, createTrigger } from '../generators/triggers/TriggerRegistry.js';
import { getMappingIds, createMapping } from '../generators/mapping/MappingRegistry.js';

// Scratch vectors for listener orientation — avoid per-frame allocation
const _tmpFwd = new THREE.Vector3();
const _tmpUp = new THREE.Vector3();

// New orbits take the first radius clear of the existing ones
const ORBIT_RADIUS_SLOTS = [3, 4.5, 6, 1.75, 5.25, 2.4];

// Notes are triggered from the render loop the moment they happen. Tone's
// default 100 ms scheduling look-ahead would make every note sound that much
// after its visual flash (and after MIDI/OSC, which send immediately).
const AUDIO_LOOKAHEAD_SECONDS = 0.01;

// Mute fades rather than cuts, so tails and drones stop without a click
const MUTE_FADE_SECONDS = 0.03;

// Master soft clipper: linear up to CLIP_KNEE, then eases toward CLIP_CEILING
// (about -0.5 dBFS). The waveshaper's input is scaled down by
// CLIP_INPUT_RANGE so overshoots up to +12 dB still land on the smooth curve.
const CLIP_KNEE = 0.7;
const CLIP_CEILING = 0.944;
const CLIP_INPUT_RANGE = 4;

function softClip(x) {
  const a = Math.abs(x);
  if (a <= CLIP_KNEE) return x;
  const room = CLIP_CEILING - CLIP_KNEE;
  return Math.sign(x) * (CLIP_KNEE + room * Math.tanh((a - CLIP_KNEE) / room));
}

/**
 * Main engine: coordinates the render loop, generators, and output routing.
 * Manages shared resources (nebula, scene) and per-orbit audio chains.
 */
export class Engine {
  constructor(containerEl) {
    this.sceneManager = new SceneManager(containerEl);

    // Shared center nebula — all orbits inject into this
    // Layer 0 = default (everything), Layer 1 = nebula only (for god rays)
    this._nebulaGroup = new THREE.Group();
    this._nebulaGroup.layers.enable(1); // visible on both layer 0 and layer 1
    this.sceneManager.scene.add(this._nebulaGroup);
    this.nebula = null; // created after first orbit is added

    // Shared MIDI and OSC outputs — registered in every orbit's router.
    // Each orbit owns its own quantizer + router + synth (createOrbitAudioChain).
    this.midiOutput = new MidiOutput();
    this.oscOutput = new OscOutput();

    this.generators = [];
    this.running = false;
    this.paused = false;
    this.muted = false;
    this.muteOnDefocus = true;
    this._defocusMuted = false;
    this.spatialEnabled = false; // Global 3D spatial audio toggle
    this.spatialAxis = 'horizontal'; // 'horizontal' | 'vertical' — vertical is for portrait phones
    this.debugPerf = false; // log frame stats every 2s (window._soundSpace.debugPerf = true)
    this._lastTime = 0;
    this._rafId = null;
    this._audioInitialized = false;
    this._audioInitPromise = null;
    this._toneStarted = false;
    this.masterVolume = 0.8;       // 0..1, listener preference (not saved in presets)
    this._masterGate = null;       // mute gain at the end of the master bus
    this._opQueue = Promise.resolve();
    // Scene-wide visual settings shared by every orbit (Post FX lives in SceneManager)
    this.visual = {
      crossingFlash: VISUAL_DEFAULTS.crossingFlash,
      spinSpeed: VISUAL_DEFAULTS.spinSpeed,
    };
    // A viewer preference, not part of presets: on by default for reduced motion
    this.calmVisuals = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.sceneManager.setCalm(this.calmVisuals);

    this._onVisibilityChange = this._handleVisibilityChange.bind(this);
    document.addEventListener('visibilitychange', this._onVisibilityChange);

    // Harmonic orbit — engine-level singleton (polygon + aux voices). Init'd
    // visually in constructor; audio voices init inside initAudio (user gesture).
    this.harmonicOrbit = new HarmonicOrbit(this.sceneManager, this);
    this.harmonicOrbit.init();
  }

  /** Enable/disable global 3D spatial audio panning; propagates to all orbits. */
  setSpatialEnabled(v) {
    this.spatialEnabled = !!v;
    for (const gen of this.generators) {
      if (gen._toneOutput?.setSpatialEnabled) {
        gen._toneOutput.setSpatialEnabled(this.spatialEnabled);
      }
    }
    // _updateListener stops tracking the camera; put the listener back at the
    // origin so any panner still in use hears the mix at full level
    if (!this.spatialEnabled && this._toneStarted) this._resetListener();
  }

  _resetListener() {
    const L = Tone.Listener;
    L.positionX.value = 0; L.positionY.value = 0; L.positionZ.value = 0;
    L.forwardX.value = 0; L.forwardY.value = 0; L.forwardZ.value = -1;
    L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
  }

  /**
   * Set spatial-axis mode globally. 'horizontal' (default) maps visual X to
   * L/R; 'vertical' maps visual Y to L/R for portrait-phone playback. No-op
   * when spatialEnabled is false.
   */
  setSpatialAxis(axis) {
    this.spatialAxis = axis === 'vertical' ? 'vertical' : 'horizontal';
    for (const gen of this.generators) {
      if (gen._toneOutput?.setSpatialAxis) {
        gen._toneOutput.setSpatialAxis(this.spatialAxis);
      }
    }
  }

  /** Sync Tone.Listener to current camera transform. Call once per frame. */
  _updateListener() {
    if (!this.spatialEnabled) return;
    const cam = this.sceneManager.camera;
    // Forward = camera local -Z in world space; Up = camera local +Y in world space
    _tmpFwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    _tmpUp.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const L = Tone.Listener;
    // Tone.Listener exposes AudioParams — set via .value
    L.positionX.value = cam.position.x;
    L.positionY.value = cam.position.y;
    L.positionZ.value = cam.position.z;
    L.forwardX.value = _tmpFwd.x;
    L.forwardY.value = _tmpFwd.y;
    L.forwardZ.value = _tmpFwd.z;
    L.upX.value = _tmpUp.x;
    L.upY.value = _tmpUp.y;
    L.upZ.value = _tmpUp.z;
  }

  /**
   * Initialize audio (must be called from a user gesture). If an attempt
   * fails it can be retried from a later gesture; concurrent calls share
   * a single attempt.
   */
  initAudio() {
    this._installAudioResume();
    if (!this._audioInitPromise) {
      this._audioInitPromise = this._initAudio().catch((e) => {
        this._audioInitPromise = null;
        throw e;
      });
    }
    return this._audioInitPromise;
  }

  async _initAudio() {
    await Tone.start();
    if (!this._toneStarted) {
      Tone.getContext().lookAhead = AUDIO_LOOKAHEAD_SECONDS;
      this._setupMasterBus();
      this._toneStarted = true;
    }
    // Orbits created before audio was available still need their synth chains.
    // Orbits added from here on build theirs as they're created (_toneStarted).
    for (const gen of this.generators) {
      if (gen._toneOutput && !gen._toneOutput._initialized) {
        await gen._toneOutput.init();
      }
    }
    // MIDI is requested only when the user turns it on (MidiOscPanel), so
    // visitors aren't asked for device access they never wanted.
    // OSC connects on demand when enabled, not at init.
    this._audioInitialized = true;
    if (this.harmonicOrbit) {
      await this.harmonicOrbit.initAudio();
    }
  }

  /**
   * Master bus on Tone's Destination: a gentle compressor and a limiter just
   * under full scale give dense scenes headroom, and a gain at the end does
   * the mute. Recordings tap Destination's output, so they get the same mix.
   */
  _setupMasterBus() {
    this._masterComp = new Tone.Compressor({ threshold: -20, ratio: 3, knee: 12, attack: 0.008, release: 0.2 });
    this._masterMakeup = new Tone.Gain(Tone.dbToGain(4));
    this._masterLimiter = new Tone.Limiter(-1);
    // Tone's Limiter is a fast compressor, so a burst of simultaneous attacks
    // still overshoots it. A soft clipper is the hard ceiling behind it.
    this._masterClipDrive = new Tone.Gain(1 / CLIP_INPUT_RANGE);
    this._masterClip = new Tone.WaveShaper(x => softClip(x * CLIP_INPUT_RANGE), 4096);
    this._masterClip.oversample = '2x';
    this._masterGate = new Tone.Gain(this._outputSilenced() ? 0 : 1);
    Tone.getDestination().chain(
      this._masterComp, this._masterMakeup, this._masterLimiter,
      this._masterClipDrive, this._masterClip, this._masterGate,
    );
    Tone.getDestination().volume.value = Tone.gainToDb(this.masterVolume);
  }

  /** Master output level, 0..1. */
  setMasterVolume(v) {
    this.masterVolume = Math.max(0, Math.min(1, v));
    if (this._toneStarted) {
      Tone.getDestination().volume.rampTo(this.masterVolume > 0 ? Tone.gainToDb(this.masterVolume) : -Infinity, 0.05);
    }
  }

  /**
   * Browsers suspend or interrupt audio (iOS calls, backgrounding, a first
   * attempt outside a gesture). Retry on the next user gesture, or when the
   * page becomes visible again. pointerup/touchend/keydown count as user
   * activation; a touch pointerdown does not.
   */
  _installAudioResume() {
    if (this._audioResumeHandler) return;
    this._audioResumeHandler = () => {
      if (!this._audioInitialized) {
        this.initAudio().catch(() => {});
      } else if (Tone.getContext().state !== 'running') {
        Tone.start().catch(() => {});
      }
    };
    this._audioVisibleHandler = () => {
      if (!document.hidden && this._toneStarted && Tone.getContext().state !== 'running') {
        Tone.start().catch(() => {});
      }
    };
    for (const type of ['pointerup', 'touchend', 'keydown']) {
      window.addEventListener(type, this._audioResumeHandler, true);
    }
    document.addEventListener('visibilitychange', this._audioVisibleHandler);
    window.addEventListener('pageshow', this._audioVisibleHandler);
  }

  _removeAudioResume() {
    if (!this._audioResumeHandler) return;
    for (const type of ['pointerup', 'touchend', 'keydown']) {
      window.removeEventListener(type, this._audioResumeHandler, true);
    }
    document.removeEventListener('visibilitychange', this._audioVisibleHandler);
    window.removeEventListener('pageshow', this._audioVisibleHandler);
    this._audioResumeHandler = null;
  }

  /** True while the global mute or tab-hidden mute silences the output. */
  _outputSilenced() {
    return this.muted || this._defocusMuted;
  }

  /** Push the current mute/pause/defocus state to every output. */
  _applyOutputGates() {
    const silenced = this._outputSilenced();
    for (const gen of this.generators) {
      if (gen._toneOutput) gen._toneOutput.enabled = !silenced;
    }
    this.midiOutput.muted = this.muted;
    this.oscOutput.muted = this.muted;
    if (this._masterGate) this._masterGate.gain.rampTo(silenced ? 0 : 1, MUTE_FADE_SECONDS);
    // The harmonic drones are sustained, so pause silences them too
    if (this.harmonicOrbit) {
      this.harmonicOrbit.setSilenced(silenced || this.paused);
    }
  }

  /**
   * Create a per-orbit audio chain (quantizer + router + synth).
   * Each orbit gets its own independent scale and synth settings.
   */
  async createOrbitAudioChain(scaleConfig, synthConfig) {
    const quantizer = new ScaleQuantizer(scaleConfig || DEFAULT_SCALE_CONFIG);
    const router = new OutputRouter(quantizer);
    const synth = new ToneOutput(synthConfig || DEFAULT_SYNTH_CONFIG);
    // A new orbit respects the current mute, like the ones already playing
    synth.enabled = !this._outputSilenced();
    if (this._toneStarted) {
      await synth.init();
    }
    router.addOutput(synth);
    // Register shared MIDI and OSC so every orbit routes to them
    router.addOutput(this.midiOutput);
    router.addOutput(this.oscOutput);
    return { quantizer, router, synth };
  }

  /**
   * Add an orbit (OrbitalNodes instance) with its own audio chain. Queued
   * behind any preset load in progress.
   * @param {typeof import('./Generator.js').Generator} GeneratorClass
   * @param {object} [config] - Generator params (radius, nodeCount, etc.)
   * @param {object} [scaleConfig] - Per-orbit scale settings
   * @param {object} [synthConfig] - Per-orbit synth settings
   * @returns {Promise<Generator|null>}
   */
  addOrbit(GeneratorClass = OrbitalNodes, config = {}, scaleConfig, synthConfig) {
    return this._enqueue(() => this._addOrbit(GeneratorClass, config, scaleConfig, synthConfig));
  }

  /** Remove an orbit, queued behind any preset load in progress. */
  removeOrbit(generator) {
    return this._enqueue(() => this.removeGenerator(generator));
  }

  /**
   * Run engine mutations one at a time. A second preset load (or an orbit
   * added mid-load) waits for the first instead of interleaving with it.
   */
  _enqueue(task) {
    const run = this._opQueue.then(task, task);
    this._opQueue = run.catch(() => {});
    return run;
  }

  /** A radius clear of the existing orbits, within the Radius slider's range. */
  _freeRadius() {
    const radii = this.generators.map(g => g.params.radius);
    return ORBIT_RADIUS_SLOTS.find(r => radii.every(x => Math.abs(x - r) >= 0.6)) ?? ORBIT_RADIUS_SLOTS[0];
  }

  async _addOrbit(GeneratorClass, config = {}, scaleConfig, synthConfig, flags = {}) {
    if (this.generators.length >= MAX_ORBITS) {
      console.warn(`Max ${MAX_ORBITS} orbits reached`);
      return null;
    }
    config = { ...config };

    // Create per-orbit audio chain
    const audio = await this.createOrbitAudioChain(scaleConfig, synthConfig);
    if (this.generators.length >= MAX_ORBITS) {
      audio.synth.dispose();
      return null;
    }

    if (!config.radius) config.radius = this._freeRadius();

    // Keep a requested index (a loaded preset) when it's free, so MIDI
    // channels, OSC addresses and colors survive a save and load. Otherwise
    // take the lowest free one, reusing a removed orbit's slot.
    const usedIndices = new Set(this.generators.map(g => g.params.orbitIndex));
    let orbitIndex = config.orbitIndex;
    if (!Number.isInteger(orbitIndex) || orbitIndex < 0 || orbitIndex >= MAX_ORBITS || usedIndices.has(orbitIndex)) {
      orbitIndex = 0;
      while (usedIndices.has(orbitIndex)) orbitIndex++;
    }
    config.orbitIndex = orbitIndex;

    const generator = new GeneratorClass(
      this.sceneManager,
      audio.router,
      config
    );

    // Attach audio chain references for UI access
    generator._scaleQuantizer = audio.quantizer;
    generator._toneOutput = audio.synth;
    generator._outputRouter = audio.router;
    generator.outputMuted = !!flags.muted;
    generator.outputSolo = !!flags.solo;
    audio.router.isAudible = () => this.isOrbitAudible(generator);

    // Inherit current global spatial-audio state
    audio.synth.setSpatialEnabled(this.spatialEnabled);
    audio.synth.setSpatialAxis(this.spatialAxis);

    // Create shared nebula on first orbit, share with all
    if (!this.nebula) {
      this.nebula = new CenterNebula(
        this._nebulaGroup,
        config.nodeCount || 5,
        config.radius,
        null // colors set after init
      );
      this.nebula.spinSpeed = this.visual.spinSpeed;
    }
    generator._sharedNebula = this.nebula;

    generator.init();
    generator._crossingFlashEnabled = this.visual.crossingFlash;

    // Orbits stay ordered by index, so orbit 1 is always the first entry
    const insertAt = this.generators.findIndex(g => g.params.orbitIndex > orbitIndex);
    if (insertAt === -1) this.generators.push(generator);
    else this.generators.splice(insertAt, 0, generator);

    // First orbit: register nebula materials and rebuild trails with actual node colors
    if (this.generators.length === 1) {
      for (const mat of this._nebulaMaterials()) {
        this.sceneManager.registerSoftParticleMaterial(mat);
      }
      // Now nodes exist — rebuild nebula with orbit 0's colors for spiral arm traces
      if (generator.nodes && generator.nodes.length > 0) {
        const nodeColors = generator.nodes.map(n => n.colorHex);
        this.nebula._nodeColors = nodeColors;
        this.nebula._rebuildTrails();
      }
    }

    this._applyOrbitAudibility();
    if (this.harmonicOrbit) this.harmonicOrbit.onOrbitAdded(generator);
    return generator;
  }

  /** Remove a generator/orbit by index or reference */
  removeGenerator(generatorOrIndex) {
    let index;
    if (typeof generatorOrIndex === 'number') {
      index = generatorOrIndex;
    } else {
      index = this.generators.indexOf(generatorOrIndex);
    }
    if (index >= 0 && index < this.generators.length) {
      const gen = this.generators[index];
      if (this.harmonicOrbit) this.harmonicOrbit.onOrbitRemoved(gen);

      // Dispose per-orbit audio
      if (gen._toneOutput) gen._toneOutput.dispose();

      gen.dispose();
      this.generators.splice(index, 1);
      this._applyOrbitAudibility();

      // If all orbits removed, clean up nebula
      if (this.generators.length === 0 && this.nebula) {
        for (const mat of this._nebulaMaterials()) {
          this.sceneManager.unregisterSoftParticleMaterial(mat);
        }
        this.nebula.dispose();
        this.nebula = null;
      }
    }
  }

  // ── Per-orbit mute and solo ────────────────────────────────────

  /** An orbit is heard unless it's muted, or another orbit is soloed. */
  isOrbitAudible(generator) {
    if (generator.outputMuted) return false;
    const anySolo = this.generators.some(g => g.outputSolo);
    return !anySolo || !!generator.outputSolo;
  }

  setOrbitMuted(generator, muted) {
    generator.outputMuted = !!muted;
    this._applyOrbitAudibility();
  }

  setOrbitSolo(generator, solo) {
    generator.outputSolo = !!solo;
    this._applyOrbitAudibility();
  }

  _applyOrbitAudibility() {
    for (const gen of this.generators) {
      gen._toneOutput?.setAudible(this.isOrbitAudible(gen));
    }
  }

  // ── Scene-wide visual settings ─────────────────────────────────

  /** Post FX plus the settings shared by every orbit. */
  getVisualSettings() {
    return { ...this.sceneManager.getPostFX(), ...this.visual };
  }

  /** Apply visual settings; keys that are missing are left as they are. */
  setVisualSettings(settings) {
    this.sceneManager.setPostFX(settings);
    if ('spinSpeed' in settings) {
      this.visual.spinSpeed = settings.spinSpeed;
      if (this.nebula) this.nebula.spinSpeed = settings.spinSpeed;
    }
    if ('crossingFlash' in settings) {
      this.visual.crossingFlash = !!settings.crossingFlash;
      for (const gen of this.generators) gen._crossingFlashEnabled = this.visual.crossingFlash;
    }
  }

  setCalmVisuals(calm) {
    this.calmVisuals = !!calm;
    this.sceneManager.setCalm(this.calmVisuals);
  }

  _nebulaMaterials() {
    const n = this.nebula;
    return n ? [n._material, n._dustMaterial, n._cloudMaterial, n._nanoMaterial].filter(Boolean) : [];
  }

  _handleVisibilityChange() {
    if (document.hidden) {
      if (!this.muteOnDefocus || this.muted) return;
      this._defocusMuted = true;
    } else if (this._defocusMuted) {
      this._defocusMuted = false;
    } else {
      return;
    }
    this._applyOutputGates();
  }

  /** Start the animation/simulation loop */
  start() {
    if (this.running) return;
    this.running = true;
    this._lastTime = performance.now();
    this._loop();
  }

  /** Stop the animation/simulation loop */
  stop() {
    this.running = false;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  togglePause() {
    this.paused = !this.paused;
    if (!this.paused) {
      this._lastTime = performance.now();
    }
    this._applyOutputGates();
    return this.paused;
  }

  toggleMute() {
    this.muted = !this.muted;
    // A manual mute supersedes a tab-hidden one
    if (this.muted) this._defocusMuted = false;
    // MIDI/OSC keep their own enabled state; `muted` is a separate gate so
    // unmuting restores them.
    this._applyOutputGates();
    return this.muted;
  }

  _loop() {
    if (!this.running) return;
    this._rafId = requestAnimationFrame(() => this._loop());

    const now = performance.now();
    const deltaTime = Math.min((now - this._lastTime) / 1000, 0.1);
    this._lastTime = now;

    if (!this.paused) {
      for (const gen of this.generators) {
        gen.update(deltaTime);
      }
      if (this.nebula) {
        this.nebula.update(deltaTime);
      }
      if (this.harmonicOrbit) {
        this.harmonicOrbit.update(deltaTime);
      }
    }

    // Sync Tone.Listener to camera each frame (cheap no-op when spatial is off)
    this._updateListener();

    this.sceneManager.render(deltaTime);

    if (this.debugPerf) this._logPerf(deltaTime);
  }

  _logPerf(deltaTime) {
    this._perfFrames = (this._perfFrames || 0) + 1;
    this._perfAccum = (this._perfAccum || 0) + deltaTime;
    if (this._perfAccum < 2.0) return;
    const fps = (this._perfFrames / this._perfAccum).toFixed(1);
    const frameMs = ((this._perfAccum / this._perfFrames) * 1000).toFixed(1);
    const info = this.sceneManager.renderer.info;
    console.log(
      `%c[perf]%c ${fps} fps | ${frameMs}ms/frame | ${info.render.calls} draws | ${info.render.triangles} tris | ${info.render.points} pts | ${info.memory.textures} tex | ${info.memory.geometries} geo | ${this.generators.length} orbits`,
      'color: #00ff88; font-weight: bold',
      'color: #88aacc'
    );
    this._perfFrames = 0;
    this._perfAccum = 0;
  }

  /** Registries the preset validator checks plugin IDs and params against. */
  _presetContext() {
    const factories = { motion: createAlgorithm, trigger: createTrigger, mapping: createMapping };
    return {
      motionIds: getAlgorithmIds(),
      triggerIds: getTriggerIds(),
      mappingIds: getMappingIds(),
      describe: (kind, id) => {
        try {
          const plugin = factories[kind](id);
          const params = plugin.getParams();
          plugin.dispose?.();
          return params;
        } catch {
          return [];
        }
      },
    };
  }

  /**
   * Serialize the whole setup.
   * @param {{ includeIO?: boolean }} [opts] - share links leave out MIDI/OSC settings
   */
  serialize({ includeIO = true } = {}) {
    const cam = this.sceneManager.camera;
    const tgt = this.sceneManager.controls.target;
    const data = {
      app: PRESET_APP,
      version: PRESET_VERSION,
      orbits: this.generators.map(g => ({
        generator: g.serialize(),
        // The orbit's own key, not a Harmonic Orbit transposition of it
        scale: { ...g._scaleQuantizer.getConfig(), root: this.harmonicOrbit?.homeRootFor(g) ?? g._scaleQuantizer.getConfig().root },
        synth: g._toneOutput.getConfig(),
        muted: !!g.outputMuted,
        solo: !!g.outputSolo,
      })),
      camera: {
        position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
        target: { x: tgt.x, y: tgt.y, z: tgt.z },
      },
      spatial: {
        enabled: this.spatialEnabled,
        axis: this.spatialAxis,
      },
      harmonic: this.harmonicOrbit ? this.harmonicOrbit.serialize() : undefined,
      visual: this.getVisualSettings(),
    };
    if (includeIO) {
      const midi = this.midiOutput.config;
      const osc = this.oscOutput.config;
      data.io = {
        midi: { channel: midi.channel, noteDurationMs: midi.noteDurationMs, velocityCurve: midi.velocityCurve },
        osc: { wsHost: osc.wsHost, wsPort: osc.wsPort },
      };
    }
    return data;
  }

  /**
   * Load a preset (a file, a shared link, or a bundled preset). It is
   * validated before anything changes; if applying it fails part-way, the
   * previous setup is restored. Resolves with any warnings.
   * @throws {PresetError}
   */
  loadPreset(data) {
    return this._enqueue(async () => {
      const ctx = this._presetContext();
      const { preset, warnings } = sanitizePreset(data, ctx);
      const snapshot = this.serialize();
      try {
        await this._applyPreset(preset);
      } catch (e) {
        console.error('Preset failed to apply; restoring the previous setup', e);
        try {
          await this._applyPreset(sanitizePreset(snapshot, ctx).preset);
        } catch (restoreError) {
          console.error('Restoring the previous setup failed', restoreError);
        }
        throw new PresetError('That preset could not be loaded. Your previous setup was restored.');
      }
      return { warnings };
    });
  }

  /** @deprecated Use loadPreset. */
  deserialize(data) {
    return this.loadPreset(data);
  }

  /** Apply a preset that has already been through sanitizePreset. */
  async _applyPreset(p) {
    const sm = this.sceneManager;

    if (p.camera) {
      // A preset's camera wins over a running orbit or Home animation
      sm.stopCameraMotion();
      sm.camera.position.set(p.camera.position.x, p.camera.position.y, p.camera.position.z);
      sm.controls.target.set(p.camera.target.x, p.camera.target.y, p.camera.target.z);
      sm.controls.update();
    }

    // Sections a preset leaves out go back to their defaults, so nothing
    // lingers from the previous setup. MIDI/OSC settings belong to the
    // listener's setup and are only changed when the preset has them.
    const spatial = p.spatial ?? { enabled: false, axis: 'horizontal' };
    this.setSpatialEnabled(spatial.enabled);
    this.setSpatialAxis(spatial.axis);
    this.setVisualSettings({ ...VISUAL_DEFAULTS, ...p.visual });
    if (p.io?.midi) this.midiOutput.setConfig(p.io.midi);
    if (p.io?.osc) this.oscOutput.setConfig(p.io.osc);

    // Release the drones and hand orbits their own keys back before they go
    const h = this.harmonicOrbit;
    if (h?.params.enabled) h.setParam('enabled', false);

    while (this.generators.length > 0) {
      this.removeGenerator(0);
    }

    for (const orbit of p.orbits) {
      const g = orbit.generator;
      const gen = await this._addOrbit(OrbitalNodes, g.params, orbit.scale, orbit.synth,
        { muted: orbit.muted, solo: orbit.solo });
      if (!gen) continue;
      gen._switchAlgorithm(g.motionAlgorithm ? g.motionAlgorithm.id : 'none');
      if (gen._motionAlgo && g.motionAlgorithm) gen._motionAlgo.deserialize(g.motionAlgorithm);
      if (g.triggerMethod) {
        gen._switchTrigger(g.triggerMethod.id);
        gen._triggerMethod.deserialize(g.triggerMethod);
      }
      if (g.noteMapping) {
        gen._switchMapping(g.noteMapping.id);
        gen._noteMapping.deserialize(g.noteMapping);
      }
    }

    // After the orbits, so turning the Harmonic Orbit on captures their keys
    if (h) h.deserialize(p.harmonic ?? { params: { enabled: false } });
    this._applyOutputGates();
  }

  dispose() {
    this.stop();
    document.removeEventListener('visibilitychange', this._onVisibilityChange);
    this._removeAudioResume();
    if (this.harmonicOrbit) {
      this.harmonicOrbit.dispose();
      this.harmonicOrbit = null;
    }
    while (this.generators.length > 0) {
      this.removeGenerator(0);
    }
    this.midiOutput.dispose();
    this.oscOutput.dispose();
    this.sceneManager.dispose();
  }
}
