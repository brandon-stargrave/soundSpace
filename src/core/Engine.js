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
import { DEFAULT_SCALE_CONFIG, DEFAULT_SYNTH_CONFIG } from '../util/constants.js';

// Scratch vectors for listener orientation — avoid per-frame allocation
const _tmpFwd = new THREE.Vector3();
const _tmpUp = new THREE.Vector3();

const MAX_ORBITS = 5;

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

    // Per-orbit audio chains stored on each generator
    // Legacy single chain kept for backward compat during transition
    this.scaleQuantizer = new ScaleQuantizer();
    this.outputRouter = new OutputRouter(this.scaleQuantizer);
    this.toneOutput = new ToneOutput();
    this.outputRouter.addOutput(this.toneOutput);

    // Shared MIDI and OSC outputs — registered in every orbit's router
    this.midiOutput = new MidiOutput();
    this.oscOutput = new OscOutput();

    this.generators = [];
    this.running = false;
    this.paused = false;
    this.muted = false;
    this.muteOnDefocus = true;
    this._defocusMuted = false;
    this.spatialEnabled = false; // Global 3D spatial audio toggle
    this._lastTime = 0;
    this._rafId = null;
    this._audioInitialized = false;

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
    // Also apply to the legacy shared toneOutput
    if (this.toneOutput?.setSpatialEnabled) {
      this.toneOutput.setSpatialEnabled(this.spatialEnabled);
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

  /** Initialize audio (must be called from user gesture) */
  async initAudio() {
    await this.toneOutput.init();
    await this.midiOutput.init();
    // OSC connects on demand when enabled, not at init
    this._audioInitialized = true;
    // Aux voices for harmonic orbit — need Tone.start() which happened above
    if (this.harmonicOrbit) {
      await this.harmonicOrbit.initAudio();
    }
  }

  /** Transpose every orbit's ScaleQuantizer to a new root note (e.g. 'F#'). */
  transposeAll(newRoot) {
    for (const gen of this.generators) {
      if (gen._scaleQuantizer?.setRoot) {
        gen._scaleQuantizer.setRoot(newRoot);
      } else if (gen._scaleQuantizer) {
        gen._scaleQuantizer.setConfig({ root: newRoot });
      }
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
    if (this._audioInitialized) {
      await synth.init();
    }
    router.addOutput(synth);
    // Register shared MIDI and OSC so every orbit routes to them
    router.addOutput(this.midiOutput);
    router.addOutput(this.oscOutput);
    return { quantizer, router, synth };
  }

  /**
   * Add an orbit (OrbitalNodes instance) with its own audio chain.
   * @param {typeof import('./Generator.js').Generator} GeneratorClass
   * @param {object} [config] - Generator params (radius, nodeCount, etc.)
   * @param {object} [scaleConfig] - Per-orbit scale settings
   * @param {object} [synthConfig] - Per-orbit synth settings
   * @returns {Promise<Generator>}
   */
  async addOrbit(GeneratorClass, config = {}, scaleConfig, synthConfig) {
    if (this.generators.length >= MAX_ORBITS) {
      console.warn(`Max ${MAX_ORBITS} orbits reached`);
      return null;
    }

    // Create per-orbit audio chain
    const audio = await this.createOrbitAudioChain(scaleConfig, synthConfig);

    // Auto-assign radius if not specified
    if (!config.radius) {
      const existingRadii = this.generators.map(g => g.params?.radius || 3);
      const maxRadius = existingRadii.length > 0 ? Math.max(...existingRadii) : 1.5;
      config.radius = maxRadius + 1.5;
    }

    config.orbitIndex = this.generators.length;

    const generator = new GeneratorClass(
      this.sceneManager,
      audio.router,
      config
    );

    // Attach audio chain references for UI access
    generator._scaleQuantizer = audio.quantizer;
    generator._toneOutput = audio.synth;
    generator._outputRouter = audio.router;

    // Inherit current global spatial-audio state
    if (audio.synth?.setSpatialEnabled) {
      audio.synth.setSpatialEnabled(this.spatialEnabled);
    }

    // Create shared nebula on first orbit, share with all
    if (!this.nebula) {
      this.nebula = new CenterNebula(
        this._nebulaGroup,
        config.nodeCount || 5,
        config.radius,
        null // colors set after init
      );
    }
    generator._sharedNebula = this.nebula;

    generator.init();
    this.generators.push(generator);

    // First orbit: register nebula materials and rebuild trails with actual node colors
    if (this.generators.length === 1) {
      if (this.nebula._material) this.sceneManager.registerSoftParticleMaterial(this.nebula._material);
      if (this.nebula._dustMaterial) this.sceneManager.registerSoftParticleMaterial(this.nebula._dustMaterial);
      if (this.nebula._cloudMaterial) this.sceneManager.registerSoftParticleMaterial(this.nebula._cloudMaterial);
      if (this.nebula._nanoMaterial) this.sceneManager.registerSoftParticleMaterial(this.nebula._nanoMaterial);
      // Now nodes exist — rebuild nebula with orbit 0's colors for spiral arm traces
      if (generator.nodes && generator.nodes.length > 0) {
        const nodeColors = generator.nodes.map(n => n.colorHex);
        this.nebula._nodeColors = nodeColors;
        this.nebula._rebuildTrails();
      }
    }

    return generator;
  }

  /** Legacy addGenerator — wraps addOrbit for backward compat */
  addGenerator(GeneratorClass, config) {
    return this.addOrbit(GeneratorClass, config);
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

      // Dispose per-orbit audio
      if (gen._toneOutput) gen._toneOutput.dispose();

      gen.dispose();
      this.generators.splice(index, 1);

      // If all orbits removed, clean up nebula
      if (this.generators.length === 0 && this.nebula) {
        this.sceneManager.unregisterSoftParticleMaterial(this.nebula._material);
        this.sceneManager.unregisterSoftParticleMaterial(this.nebula._dustMaterial);
        this.nebula.dispose();
        this.nebula = null;
      }
    }
  }

  /** Reorder orbits — swap positions in the array */
  reorderOrbits(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.generators.length) return;
    if (toIndex < 0 || toIndex >= this.generators.length) return;
    const [moved] = this.generators.splice(fromIndex, 1);
    this.generators.splice(toIndex, 0, moved);
  }

  _setupDefocusMute() {
    document.addEventListener('visibilitychange', () => {
      if (!this.muteOnDefocus) return;
      if (document.hidden) {
        // Mute on defocus (only if not already manually muted)
        if (!this.muted) {
          this._defocusMuted = true;
          for (const gen of this.generators) {
            if (gen._toneOutput) gen._toneOutput.enabled = false;
          }
          this.toneOutput.enabled = false;
          if (this.harmonicOrbit) this.harmonicOrbit.setSilenced(true);
        }
      } else {
        // Restore on refocus (only if we were the ones who muted)
        if (this._defocusMuted) {
          this._defocusMuted = false;
          if (!this.muted) {
            for (const gen of this.generators) {
              if (gen._toneOutput) gen._toneOutput.enabled = true;
            }
            this.toneOutput.enabled = true;
            if (this.harmonicOrbit) {
              this.harmonicOrbit.setSilenced(this.paused);
            }
          }
        }
      }
    });
  }

  /** Start the animation/simulation loop */
  start() {
    if (this.running) return;
    this._setupDefocusMute();
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
    // Silence/restore the harmonic orbit's sustained drones with pause state
    if (this.harmonicOrbit) {
      this.harmonicOrbit.setSilenced(this.paused || this.muted || this._defocusMuted);
    }
    return this.paused;
  }

  toggleMute() {
    this.muted = !this.muted;
    // Mute all per-orbit synths + shared outputs
    for (const gen of this.generators) {
      if (gen._toneOutput) gen._toneOutput.enabled = !this.muted;
    }
    this.toneOutput.enabled = !this.muted;
    this.midiOutput.enabled = this.midiOutput.enabled && !this.muted;
    this.oscOutput.enabled = this.oscOutput.enabled && !this.muted;
    // Release/restore harmonic orbit drones — they're sustained and would
    // otherwise keep playing through a mute.
    if (this.harmonicOrbit) {
      this.harmonicOrbit.setSilenced(this.muted || this.paused || this._defocusMuted);
    }
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

    this.sceneManager.render();

    // Performance stats — log every 2 seconds
    this._perfFrames = (this._perfFrames || 0) + 1;
    this._perfAccum = (this._perfAccum || 0) + deltaTime;
    if (this._perfAccum >= 2.0) {
      const fps = (this._perfFrames / this._perfAccum).toFixed(1);
      const frameMs = ((this._perfAccum / this._perfFrames) * 1000).toFixed(1);
      const info = this.sceneManager.renderer.info;
      const draws = info.render.calls;
      const tris = info.render.triangles;
      const points = info.render.points;
      const textures = info.memory.textures;
      const geometries = info.memory.geometries;
      const orbits = this.generators.length;
      console.log(
        `%c[perf]%c ${fps} fps | ${frameMs}ms/frame | ${draws} draws | ${tris} tris | ${points} pts | ${textures} tex | ${geometries} geo | ${orbits} orbits`,
        'color: #00ff88; font-weight: bold',
        'color: #88aacc'
      );
      this._perfFrames = 0;
      this._perfAccum = 0;
    }
  }

  /** Serialize entire engine state */
  serialize() {
    const cam = this.sceneManager.camera;
    const tgt = this.sceneManager.controls.target;
    return {
      orbits: this.generators.map(g => ({
        generator: g.serialize(),
        scale: g._scaleQuantizer ? g._scaleQuantizer.getConfig() : this.scaleQuantizer.getConfig(),
        synth: g._toneOutput ? g._toneOutput.getConfig() : this.toneOutput.getConfig(),
      })),
      camera: {
        position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
        target: { x: tgt.x, y: tgt.y, z: tgt.z },
      },
      spatial: {
        enabled: this.spatialEnabled,
      },
      harmonic: this.harmonicOrbit ? this.harmonicOrbit.serialize() : undefined,
    };
  }

  /** Restore engine state from saved data */
  async deserialize(data, GeneratorClass) {
    // Camera
    if (data.camera) {
      const p = data.camera.position;
      const t = data.camera.target;
      this.sceneManager.camera.position.set(p.x, p.y, p.z);
      this.sceneManager.controls.target.set(t.x, t.y, t.z);
      this.sceneManager.controls.update();
    }

    // Spatial audio (set before orbits so new orbits inherit on recreate)
    if (data.spatial) {
      this.setSpatialEnabled(!!data.spatial.enabled);
    }

    // Need GeneratorClass to recreate orbits
    if (!GeneratorClass) {
      const mod = await import('../generators/OrbitalNodes.js');
      GeneratorClass = mod.OrbitalNodes;
    }

    // New multi-orbit format
    if (data.orbits) {
      // Remove all existing orbits
      while (this.generators.length > 0) {
        this.removeGenerator(0);
      }

      // Recreate each orbit
      for (const orbitData of data.orbits) {
        const gen = await this.addOrbit(
          GeneratorClass,
          orbitData.generator?.params || {},
          orbitData.scale,
          orbitData.synth
        );

        // Restore motion algorithm
        if (gen && orbitData.generator?.motionAlgorithm) {
          gen._switchAlgorithm(orbitData.generator.motionAlgorithm.id);
          if (gen._motionAlgo) {
            gen._motionAlgo.deserialize(orbitData.generator.motionAlgorithm);
          }
        }

        // Restore trigger method
        if (gen && orbitData.generator?.triggerMethod) {
          gen._switchTrigger(orbitData.generator.triggerMethod.id);
          if (gen._triggerMethod) {
            gen._triggerMethod.deserialize(orbitData.generator.triggerMethod);
          }
        }

        // Restore note mapping
        if (gen && orbitData.generator?.noteMapping) {
          gen._switchMapping(orbitData.generator.noteMapping.id);
          if (gen._noteMapping) {
            gen._noteMapping.deserialize(orbitData.generator.noteMapping);
          }
        }
      }
    }

    // Legacy format (single orbit)
    if (data.scale && data.synth && data.generators) {
      while (this.generators.length > 0) {
        this.removeGenerator(0);
      }
      const params = data.generators[0]?.params || {};
      const gen = await this.addOrbit(GeneratorClass, params, data.scale, data.synth);
      if (gen && data.generators[0]) {
        gen.deserialize(data.generators[0]);
      }
    }

    // Restore harmonic orbit AFTER orbits so enable-drones captures correct roots
    if (data.harmonic && this.harmonicOrbit) {
      this.harmonicOrbit.deserialize(data.harmonic);
    }
  }

  dispose() {
    this.stop();
    if (this.harmonicOrbit) {
      this.harmonicOrbit.dispose();
      this.harmonicOrbit = null;
    }
    for (const gen of this.generators) {
      if (gen._toneOutput) gen._toneOutput.dispose();
      gen.dispose();
    }
    this.generators = [];
    if (this.nebula) {
      this.nebula.dispose();
      this.nebula = null;
    }
    this.toneOutput.dispose();
    this.midiOutput.dispose();
    this.oscOutput.dispose();
    this.sceneManager.dispose();
  }
}
