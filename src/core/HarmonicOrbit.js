import * as THREE from 'three';
import * as Tone from 'tone';
import {
  polygonVertexPos,
  createStellaOctangulaEdges,
  createSpikedIcosahedronEdges,
  SparkleBurstPool,
} from '../visual/CyberpunkStyle.js';
import { ProgressionWalker } from './ProgressionWalker.js';
import { AuxVoice } from '../output/AuxVoice.js';
import {
  SCALES,
  NOTE_NAMES,
  NOTE_NAME_TO_SEMITONE,
  DEFAULT_PAD_SYNTH_CONFIG,
  DEFAULT_BASS_SYNTH_CONFIG,
  DEFAULT_SCALE_CONFIG,
} from '../util/constants.js';
import { angleDelta } from '../util/math.js';

const TWO_PI = Math.PI * 2;

export const CHORD_VOICINGS = ['triad', 'sus2', 'sus4', 'seventh', 'octaveDoubled'];

const DEFAULT_PARAMS = {
  enabled: false,
  sides: 4,
  radius: null,             // null = auto-match first orbit's radius
  travelerSize: 0.18,
  speedMode: 'free',        // 'free' | 'periodSync'
  speedBpm: 20,             // lower default — feels more ambient
  syncSourceIndex: 0,
  syncRatio: 1.0,
  progressionId: 'pedal',
  transposeChance: 1.0,     // 0..1 — probability a vertex fires a transpose
  chordVoicing: 'triad',    // see CHORD_VOICINGS
  padOctave: 4,
  bassOctave: 2,
  padEnabled: true,
  padVolume: 0.5,
  bassEnabled: true,
  bassVolume: 0.5,
  midiEnabled: false,       // route harmonic voices over MIDI
  midiPadChannel: 15,       // 1..16 absolute
  midiBassChannel: 16,
  oscEnabled: false,        // route harmonic voices over OSC
};

// Harmonic orbit palette — expanded cyan/teal/blue/purple/green family.
// The two traveler voices sit at opposite ends of the cool hue wheel:
//   pad  → saturated vivid blue
//   bass → saturated fresh green
// The holo ring/trail is a mint/aqua bridge between them, and the transpose
// starburst pulls from a blue/purple palette to punctuate note changes with
// a distinct color away from the trail and traveler hues.
const PAD_HUE   = new THREE.Color(0x3d7eff);  // saturated vivid blue
const BASS_HUE  = new THREE.Color(0x2be07a);  // saturated fresh green
const HOLO_COLOR = 0x4af4c8;                  // bright mint/aqua

// Starburst palette — blues and purples, randomized per transpose so each
// key change reads as a distinct flash of color.
const STARBURST_PALETTE = [
  0x5b6bff, // royal blue
  0x7658ff, // blue-violet
  0x9349ff, // vivid purple
  0x4e90ff, // azure
  0x6a4cff, // deep indigo
  0xa65cff, // orchid
];

// Multiplier applied to traveler hues to give the wireframe an HDR
// "emissive" glow — values above 1.0 are preserved through the bloom pass
// and blown out gently by the tonemap, producing a soft halo around the
// sharp lines without switching to a lit material.
const TRAVELER_EMISSIVE_BOOST = 1.6;

// Holo-sphere trail tuning — the polygon is drawn as a dense ring of tiny
// spheres. A pulse (opacity + scale) propagates behind the traveler and
// decays over angular distance.
const HOLO_SAMPLES_PER_EDGE = 64;   // very dense, pixelated trail
const HOLO_SPHERE_RADIUS    = 0.005;
const HOLO_BASE_OPACITY     = 0.08;
const HOLO_PEAK_OPACITY     = 0.80;
const HOLO_BASE_SCALE       = 1.0;
const HOLO_PEAK_SCALE       = 3.0;
// Fraction of one full cycle that visibly trails behind the traveler.
const HOLO_TRAIL_LEN        = 0.18;
// Transpose-event pulse — a brightness + scale bump radiating outward in
// angular distance from the vertex where the transpose happened, decaying
// in time. Makes actual note/root changes visually distinct from mere
// traveler-passes.
const HOLO_TRANSPOSE_DECAY   = 3.0;   // per-second exponential decay rate
const HOLO_TRANSPOSE_SPREAD  = 0.12;  // angular spread (fraction of cycle)
const HOLO_TRANSPOSE_BOOST   = 1.5;   // multiplies peak pulse on affected spheres

/**
 * HarmonicOrbit — engine-level singleton. A polygon ring with a traveling
 * node that may fire a scale-root transposition each time it crosses a vertex.
 *
 * When enabled, two always-sustaining aux voices (pad = chord, bass = drone)
 * play the current root. Each transpose event crossfades them to the new
 * root/chord and fires scene-wide visual pulses.
 *
 * Vertex-hit detection uses a monotonic "step counter" derived from cyclePos
 * so sides changes or speed changes can never offset which vertex is at the
 * traveler's position — both use the same polygonVertexPos() to place visuals
 * and spawn effects.
 */
export class HarmonicOrbit {
  constructor(sceneManager, engine) {
    this.sceneManager = sceneManager;
    this.engine = engine;
    this.params = { ...DEFAULT_PARAMS };

    this._group = new THREE.Group();
    this._holoSpheres = [];      // [{ mesh, cyclePos }] — trail of holo spheres
    this._holoSphereGeo = null;  // shared sphere geometry
    this._transposePulse = 0;        // 0..1 — decays after each transpose event
    this._transposeCyclePos = 0;     // cyclePos where the last transpose fired
    this._traveler = null;       // Group of nested star polyhedra
    this._travelerOuter = null;  // outer = bass (stella octangula wireframe)
    this._travelerInner = null;  // inner = pad (spiked icosahedron wireframe)
    this._sparklePool = null;

    this._progression = new ProgressionWalker(this.params.progressionId);

    this._pad = null;
    this._bass = null;
    this._audioInitialized = false;

    // Single source of truth for traveler position along the polygon.
    this._cyclePos = 0;                  // 0..1 around the cycle
    this._lastVertexIdx = -1;            // vertex last hit — used to detect crossings
    this._sourceTotalAngle = 0;
    this._sourcePrevAngle = 0;

    // Counter-rotation state for the nested traveler solids
    this._rotOuter = 0;
    this._rotInner = 0;

    this._baseRoot = 'C';
    this._originalRoots = new Map();
    this._currentRoot = 'C';
    this._currentMidiPad = [];
    this._currentMidiBass = [];

    // External silencing state — separate from user-facing `params.enabled`.
    // When `true` the drones are released and no transpose events fire, but
    // all UI state (enabled toggle, volumes, captured base root) is preserved
    // so we can restore cleanly. Used by mute/pause/defocus.
    this._silenced = false;
  }

  init() {
    this.sceneManager.scene.add(this._group);
    this._sparklePool = new SparkleBurstPool(this._group);
    this._buildVisuals();
    this._group.visible = this.params.enabled;
  }

  async initAudio() {
    this._pad = new AuxVoice(DEFAULT_PAD_SYNTH_CONFIG);
    this._bass = new AuxVoice(DEFAULT_BASS_SYNTH_CONFIG);
    await this._pad.init();
    await this._bass.init();
    this._pad.setVolume(this.params.padVolume);
    this._bass.setVolume(this.params.bassVolume);
    this._pad.setEnabled(this.params.padEnabled);
    this._bass.setEnabled(this.params.bassEnabled);
    this._audioInitialized = true;

    if (this.params.enabled) this._captureBaseAndStartDrones();
  }

  update(deltaTime) {
    if (!this.params.enabled) return;
    // When silenced (mute/pause/defocus) the traveler keeps moving visually —
    // only audio emission and audio-coupled visual punctuation (transpose
    // stars + scene pulses) are suppressed. Vertex gating happens inside
    // _onVertexCrossed so the user still sees the trail animating.

    // Resolve effective radius — match first orbit if auto
    const r = this._resolveRadius();
    if (r !== this._appliedRadius) {
      this._appliedRadius = r;
      this._buildVisuals(); // rebuild polygon + reposition traveler
    }

    // Advance cycle position
    if (this.params.speedMode === 'periodSync') {
      const srcOrbit = this.engine.generators[this.params.syncSourceIndex];
      if (srcOrbit && srcOrbit.nodes && srcOrbit.nodes[0]) {
        const srcAngle = srcOrbit.nodes[0].angle;
        const dA = angleDelta(this._sourcePrevAngle, srcAngle);
        this._sourceTotalAngle += dA;
        this._sourcePrevAngle = srcAngle;
        const ratio = Math.max(0.01, this.params.syncRatio);
        this._cyclePos = ((this._sourceTotalAngle / (TWO_PI * ratio)) % 1 + 1) % 1;
      }
    } else {
      // Free mode: speedBpm is edges-per-minute
      const edgesPerSecond = this.params.speedBpm / 60;
      this._cyclePos = (this._cyclePos + (edgesPerSecond * deltaTime) / this.params.sides) % 1;
      if (this._cyclePos < 0) this._cyclePos += 1;
    }

    // Resolve traveler position from cyclePos — single source of truth
    this._updateTravelerPosition(this._cyclePos);

    // Determine which vertex the traveler is "past" (most recently crossed).
    // A vertex is considered hit when cyclePos crosses its exact angular threshold.
    // Using integer "step counter" derived from cyclePos avoids drift issues.
    const vertexSteps = Math.floor(this._cyclePos * this.params.sides);
    // vertexSteps goes 0, 1, 2, ... sides-1 per cycle.
    // A vertex is hit when vertexSteps transitions to a new value.
    const vertexIdx = vertexSteps % this.params.sides;
    if (vertexIdx !== this._lastVertexIdx) {
      // Guard against initialization: don't fire on first frame
      if (this._lastVertexIdx !== -1) {
        this._onVertexCrossed(vertexIdx);
      }
      this._lastVertexIdx = vertexIdx;
    }

    // Counter-rotate the star polyhedra for visual motion
    this._rotOuter += deltaTime * 0.6;
    this._rotInner -= deltaTime * 0.9;
    if (this._travelerOuter) {
      this._travelerOuter.rotation.set(this._rotOuter * 0.7, this._rotOuter, this._rotOuter * 0.3);
    }
    if (this._travelerInner) {
      this._travelerInner.rotation.set(this._rotInner * 0.5, this._rotInner * 0.8, this._rotInner);
    }

    // Drive the holo-sphere trail pulse — each sphere's opacity + scale
    // tracks its angular distance behind the traveler, plus a decaying
    // transpose-event pulse centered on the last fired vertex.
    this._updateHoloTrail(deltaTime);

    if (this._sparklePool) this._sparklePool.update(deltaTime);
    this._updateTravelerAppearance();
  }

  _resolveRadius() {
    if (this.params.radius !== null && this.params.radius !== undefined) {
      return this.params.radius;
    }
    const orbit0 = this.engine.generators[0];
    if (orbit0 && orbit0.params && typeof orbit0.params.radius === 'number') {
      return orbit0.params.radius;
    }
    return 3.0; // fallback
  }

  _onVertexCrossed(vertexIdx) {
    // When silenced (mute/pause/defocus) a vertex hit is a visual-only pass-
    // through — no transpose, no progression state advance, no sparkles, no
    // scene pulses. The traveler continues animating so the user can see
    // the interaction paused mid-flight.
    if (this._silenced) return;

    // Decide: does this crossing trigger a transpose?
    const roll = Math.random();
    const shouldTranspose = roll < this.params.transposeChance;
    if (!shouldTranspose) return; // silent pass-through

    // Active scale (from orbit 0 or default)
    const scaleType = this._getActiveScaleType();
    const scaleIntervals = SCALES[scaleType] || SCALES.pentatonic_minor;

    const descriptor = this._progression.next(scaleIntervals.length);
    let semitoneOffset;
    if (descriptor.semitones !== undefined) {
      semitoneOffset = descriptor.semitones;
    } else {
      const idx = descriptor.degreeIndex ?? 0;
      semitoneOffset = scaleIntervals[idx] || 0;
    }
    while (semitoneOffset > 11) semitoneOffset -= 12;
    while (semitoneOffset < -11) semitoneOffset += 12;

    const baseSemitone = NOTE_NAME_TO_SEMITONE[this._baseRoot] ?? 0;
    const newRootSemitone = ((baseSemitone + semitoneOffset) % 12 + 12) % 12;
    const newRoot = NOTE_NAMES[newRootSemitone];

    // Snapshot previous notes to detect "no change" situations
    const prevPadNotes = [...this._currentMidiPad];
    const prevBassNotes = [...this._currentMidiBass];
    const prevRoot = this._currentRoot;

    this._currentRoot = newRoot;
    if (this.engine.transposeAll) this.engine.transposeAll(newRoot);
    this._updateDronePitches(newRoot, scaleIntervals);

    // If neither the pad chord nor the bass note changed, suppress all
    // visual feedback — a vertex hit that produced no audible change
    // shouldn't draw attention to itself.
    const notesChanged = (
      prevRoot !== newRoot ||
      !this._arraysEqual(prevPadNotes, this._currentMidiPad) ||
      !this._arraysEqual(prevBassNotes, this._currentMidiBass)
    );
    if (!notesChanged) return;

    // Scene-wide pulses (only when notes actually changed). The light ray
    // pulse gets a much bigger push on transpose events than on ordinary
    // note triggers — a key change should feel like a significant event.
    if (this.sceneManager.triggerStarTwinkle) this.sceneManager.triggerStarTwinkle(1.0);
    if (this.sceneManager.triggerChromaticAberration) this.sceneManager.triggerChromaticAberration(0.8);
    if (this.sceneManager.triggerLightRayPulse) this.sceneManager.triggerLightRayPulse(2.5);

    // Fire a tight turbulence wave down every spiral arm simultaneously —
    // the whole nebula visibly reacts to the harmonic event, with each
    // wave travelling from center out to the arm tips over ~2 seconds.
    if (this.engine.nebula?.fireArmWaves) {
      this.engine.nebula.fireArmWaves({
        intensity: 1.2,
        speed: 0.85,   // slower travel — wave crawls down the arm
        width: 0.55,   // wider + softer band; combines with (1-x²)² envelope
        maxLife: 5.5,  // enough for the wave to reach ~4-unit arm tips
      });
    }

    // Holo-trail transpose pulse — brightness + scale bump radiating out
    // from the vertex where the transpose fired, decaying in time. Makes
    // note-change hits visually distinct from mere traveler passes.
    this._transposePulse = 1.0;
    // Center on the vertex's exact cyclePos, not the slightly-past traveler pos
    this._transposeCyclePos = vertexIdx / this.params.sides;

    const vp = polygonVertexPos(this._appliedRadius ?? this._resolveRadius(), this.params.sides, vertexIdx);
    const mixColor = this._computeMixColor().getHex();

    // Small, subtle sparkle burst from the traveler — punctuation, not a show
    if (this._sparklePool) {
      this._sparklePool.spawn(vp.x, vp.y, 0.05, mixColor, 0.8, 1.0, {
        count: 6,
        scaleMul: 0.35,
        scatterMul: 0.55,
      });
    }

    // Big stationary sparkle star at the vertex — the real punctuation
    if (this.sceneManager.spawnStationaryStar) {
      // Starburst color leans blue/purple — distinct from the mint-green
      // trail and the green/blue traveler, so transposes punctuate with a
      // different hue. Randomized per hit for visual variety.
      const starColor = STARBURST_PALETTE[
        Math.floor(Math.random() * STARBURST_PALETTE.length)
      ];
      this.sceneManager.spawnStationaryStar(vp.x, vp.y, 0.04, starColor, 2.6, 0.55);
    }
  }

  _arraysEqual(a, b) {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  _getActiveScaleType() {
    const orbit0 = this.engine.generators[0];
    if (orbit0 && orbit0._scaleQuantizer) {
      return orbit0._scaleQuantizer.getConfig().scaleType;
    }
    return DEFAULT_SCALE_CONFIG.scaleType;
  }

  /** Build the set of scale degree indices for the configured chord voicing. */
  _chordDegreesFor(voicing, scaleIntervalCount) {
    const clampDeg = (d) => ((d % scaleIntervalCount) + scaleIntervalCount) % scaleIntervalCount;
    switch (voicing) {
      case 'sus2':          return [0, 1, 4].map(clampDeg);
      case 'sus4':          return [0, 3, 4].map(clampDeg);
      case 'seventh':       return [0, 2, 4, 6].map(clampDeg);
      case 'octaveDoubled':
        // Returns degree indices; we handle the octave offsets at resolve time
        return [[0, 0], [4, 0], [0, 1], [2, 1]]; // [degIdx, octaveOffset]
      case 'triad':
      default:              return [0, 2, 4].map(clampDeg);
    }
  }

  _updateDronePitches(rootName, scaleIntervals) {
    if (!this._audioInitialized) return;
    const voicing = this.params.chordVoicing;

    // Resolve pad voicing to midi + frequencies
    let padMidi = [];
    let padFreqs = [];
    const padOct = this.params.padOctave;

    const voicingDegrees = this._chordDegreesFor(voicing, scaleIntervals.length);
    if (voicing === 'octaveDoubled') {
      for (const [degIdx, octOff] of voicingDegrees) {
        const interval = scaleIntervals[degIdx] ?? 0;
        const midi = this._midiFor(rootName, padOct + octOff, interval);
        padMidi.push(midi);
        padFreqs.push(Tone.Frequency(midi, 'midi').toFrequency());
      }
    } else {
      for (const degIdx of voicingDegrees) {
        const interval = scaleIntervals[degIdx] ?? 0;
        const midi = this._midiFor(rootName, padOct, interval);
        padMidi.push(midi);
        padFreqs.push(Tone.Frequency(midi, 'midi').toFrequency());
      }
    }

    // Bass is always a single sustained root at configured octave
    const bassOct = this.params.bassOctave;
    const bassMidi = this._midiFor(rootName, bassOct, 0);
    const bassFreq = Tone.Frequency(bassMidi, 'midi').toFrequency();

    // Drive local synths
    if (this._pad) this._pad.hold(padFreqs);
    if (this._bass) this._bass.hold([bassFreq]);

    // Drive MIDI/OSC outputs if enabled
    this._currentMidiPad = padMidi;
    this._currentMidiBass = [bassMidi];
    this._sendExternal(rootName, padMidi, padFreqs, bassMidi, bassFreq);
  }

  _sendExternal(rootName, padMidi, padFreqs, bassMidi, bassFreq) {
    const midi = this.engine.midiOutput;
    const osc = this.engine.oscOutput;

    if (this.params.midiEnabled && midi?.sendHarmonicHold) {
      if (this.params.padEnabled) {
        midi.sendHarmonicHold('pad', this.params.midiPadChannel, padMidi, this.params.padVolume);
      } else {
        midi.releaseHarmonic('pad');
      }
      if (this.params.bassEnabled) {
        midi.sendHarmonicHold('bass', this.params.midiBassChannel, [bassMidi], this.params.bassVolume);
      } else {
        midi.releaseHarmonic('bass');
      }
    }

    if (this.params.oscEnabled && osc?.sendHarmonicHold) {
      if (this.params.padEnabled) osc.sendHarmonicHold('pad', rootName, padMidi, padFreqs);
      if (this.params.bassEnabled) osc.sendHarmonicHold('bass', rootName, [bassMidi], [bassFreq]);
      // Also emit a dedicated transpose event so external tools can follow the root
      const rootSem = NOTE_NAME_TO_SEMITONE[rootName] ?? 0;
      if (osc.sendHarmonicTranspose) osc.sendHarmonicTranspose(rootName, rootSem);
    }
  }

  _midiFor(rootName, octave, scaleIntervalSemi) {
    const semi = NOTE_NAME_TO_SEMITONE[rootName] ?? 0;
    return (octave + 1) * 12 + semi + scaleIntervalSemi;
  }

  _buildVisuals() {
    // Clear existing visuals (holo trail + traveler)
    this._disposeHoloTrail();
    if (this._traveler) {
      this._group.remove(this._traveler);
      this._disposeTraveler();
    }

    const r = this._resolveRadius();
    this._appliedRadius = r;

    // ── Holo-sphere trail ─────────────────────────────────────────
    // Dense ring of tiny translucent spheres sampled along the polygon
    // perimeter. Each sphere pulses (opacity + scale) as the traveler
    // passes, and the pulse decays over angular distance — creating a
    // bright fading trail behind the traveler.
    const sides = this.params.sides;
    const totalSamples = sides * HOLO_SAMPLES_PER_EDGE;
    this._holoSphereGeo = new THREE.SphereGeometry(HOLO_SPHERE_RADIUS, 8, 6);
    this._holoSpheres = [];
    for (let i = 0; i < totalSamples; i++) {
      const t = i / totalSamples; // 0..1 cycle position
      const edgeFloat = t * sides;
      const edgeIdx = Math.floor(edgeFloat) % sides;
      const local = edgeFloat - Math.floor(edgeFloat);
      const a = polygonVertexPos(r, sides, edgeIdx);
      const b = polygonVertexPos(r, sides, (edgeIdx + 1) % sides);

      const material = new THREE.MeshBasicMaterial({
        color: HOLO_COLOR,
        transparent: true,
        opacity: HOLO_BASE_OPACITY,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(this._holoSphereGeo, material);
      mesh.position.set(a.x + (b.x - a.x) * local, a.y + (b.y - a.y) * local, 0);
      mesh.scale.setScalar(HOLO_BASE_SCALE);
      this._group.add(mesh);
      this._holoSpheres.push({ mesh, cyclePos: t });
    }

    // ── Traveler: nested wireframed star polyhedra ────────────────
    //   Outer = BASS voice — stella octangula (compound of two tetrahedra)
    //   Inner = PAD  voice — spiked icosahedron (icosahedron with face spikes)
    // Each solid is sized/faded by its voice's own volume (not the mix).
    this._traveler = new THREE.Group();
    const size = this.params.travelerSize;

    // Bass traveler sits slightly bigger than the pad traveler to give the
    // stella octangula enough presence next to its denser inner companion.
    const outerEdges = createStellaOctangulaEdges(size * 1.18);
    // HDR-boosted color so additive blending pushes the line pixels above
    // the bloom threshold, giving a soft emissive halo.
    const outerColor = BASS_HUE.clone().multiplyScalar(TRAVELER_EMISSIVE_BOOST);
    const outerMat = new THREE.LineBasicMaterial({
      color: outerColor,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._travelerOuter = new THREE.LineSegments(outerEdges, outerMat);
    this._travelerOuter.userData.voice = 'bass';
    this._traveler.add(this._travelerOuter);

    const innerEdges = createSpikedIcosahedronEdges(size * 0.58, 0.55);
    const innerColor = PAD_HUE.clone().multiplyScalar(TRAVELER_EMISSIVE_BOOST);
    const innerMat = new THREE.LineBasicMaterial({
      color: innerColor,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this._travelerInner = new THREE.LineSegments(innerEdges, innerMat);
    this._travelerInner.userData.voice = 'pad';
    this._traveler.add(this._travelerInner);

    this._group.add(this._traveler);

    // Reset vertex tracker — don't fire a spurious hit after rebuild
    this._lastVertexIdx = Math.floor(this._cyclePos * this.params.sides) % this.params.sides;

    this._updateTravelerPosition(this._cyclePos);
    this._updateHoloTrail(); // set initial pulse values so spheres don't all pop on
  }

  /**
   * Update each holo sphere's pulse. Two contributions:
   *   1) Trail pulse — a wake that trails behind the traveler (cyclePos-
   *      based falloff). Always present while the traveler moves.
   *   2) Transpose pulse — a time-decaying flash centered on the last
   *      vertex where a transpose fired, emphasizing the harmonic event.
   */
  _updateHoloTrail(deltaTime = 0) {
    if (!this._holoSpheres || this._holoSpheres.length === 0) return;

    // Time-decay the transpose pulse
    if (this._transposePulse > 0) {
      this._transposePulse = Math.max(
        0,
        this._transposePulse * Math.exp(-HOLO_TRANSPOSE_DECAY * deltaTime)
      );
      if (this._transposePulse < 0.001) this._transposePulse = 0;
    }

    const cyclePos = this._cyclePos;
    const trailLen = HOLO_TRAIL_LEN;
    const tpPulse = this._transposePulse;
    const tpSpread = HOLO_TRANSPOSE_SPREAD;
    const tpCenter = this._transposeCyclePos;

    for (const s of this._holoSpheres) {
      // Trail pulse ───────────────────────────────────────────────
      let behind = cyclePos - s.cyclePos;
      if (behind < 0) behind += 1;
      let trail = 0;
      if (behind < trailLen) {
        const t = 1 - behind / trailLen;
        trail = t * t;
      }

      // Transpose pulse ─────────────────────────────────────────
      // Shortest angular distance on the cyclic ring from transpose center.
      let transposeLocal = 0;
      if (tpPulse > 0) {
        let d = Math.abs(s.cyclePos - tpCenter);
        if (d > 0.5) d = 1 - d; // wrap-around
        if (d < tpSpread) {
          const dt = 1 - d / tpSpread;
          transposeLocal = tpPulse * dt * dt * HOLO_TRANSPOSE_BOOST;
        }
      }

      // Combine: both contributions add into the pulse, clamped to [0,1]
      const pulse = Math.min(1, trail + transposeLocal);
      s.mesh.material.opacity =
        HOLO_BASE_OPACITY + (HOLO_PEAK_OPACITY - HOLO_BASE_OPACITY) * pulse;
      s.mesh.scale.setScalar(
        HOLO_BASE_SCALE + (HOLO_PEAK_SCALE - HOLO_BASE_SCALE) * pulse
      );
    }
  }

  /** Dispose the holo-sphere trail — individual materials + shared geometry. */
  _disposeHoloTrail() {
    for (const s of this._holoSpheres) {
      this._group.remove(s.mesh);
      try { s.mesh.material.dispose(); } catch {}
    }
    this._holoSpheres = [];
    if (this._holoSphereGeo) {
      try { this._holoSphereGeo.dispose(); } catch {}
      this._holoSphereGeo = null;
    }
  }

  _disposeTraveler() {
    if (this._travelerOuter) {
      this._travelerOuter.geometry.dispose();
      this._travelerOuter.material.dispose();
      this._travelerOuter = null;
    }
    if (this._travelerInner) {
      this._travelerInner.geometry.dispose();
      this._travelerInner.material.dispose();
      this._travelerInner = null;
    }
    this._traveler = null;
  }

  _updateTravelerPosition(cyclePos) {
    if (!this._traveler) return;
    const sides = this.params.sides;
    const r = this._appliedRadius ?? this._resolveRadius();
    const edgeFloat = cyclePos * sides;
    const edgeIdx = Math.floor(edgeFloat) % sides;
    const t = edgeFloat - Math.floor(edgeFloat);
    const a = polygonVertexPos(r, sides, edgeIdx);
    const b = polygonVertexPos(r, sides, (edgeIdx + 1) % sides);
    this._traveler.position.set(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      0.05
    );
  }

  /** Mix color used for the sparkles + stationary star (blended punctuation hue). */
  _computeMixColor() {
    const pv = this.params.padEnabled ? this.params.padVolume : 0;
    const bv = this.params.bassEnabled ? this.params.bassVolume : 0;
    const total = pv + bv;
    if (total < 0.001) return new THREE.Color(0x555566);
    const r = pv / total;
    return new THREE.Color().copy(BASS_HUE).lerp(PAD_HUE, r);
  }

  /**
   * Each solid reflects its own voice's volume/enabled state independently.
   * Scale reacts only very subtly to volume — most of the volume response is
   * in opacity (a clear visual cue without making the shapes wobble in size).
   */
  _updateTravelerAppearance() {
    if (!this._traveler) return;

    const padVol = this.params.padEnabled ? this.params.padVolume : 0;
    const bassVol = this.params.bassEnabled ? this.params.bassVolume : 0;

    // Outer = bass
    if (this._travelerOuter) {
      // Scale: 0.95 .. 1.00 — barely perceptible.
      this._travelerOuter.scale.setScalar(0.95 + bassVol * 0.05);
      // Opacity carries the "intensity" signal: soft ghost when silent,
      // strong (but not solid) presence at max volume.
      this._travelerOuter.material.opacity = 0.08 + bassVol * 0.65;
    }

    // Inner = pad
    if (this._travelerInner) {
      this._travelerInner.scale.setScalar(0.95 + padVol * 0.05);
      this._travelerInner.material.opacity = 0.06 + padVol * 0.65;
    }
  }

  _captureBaseAndStartDrones() {
    this._originalRoots.clear();
    for (const gen of this.engine.generators) {
      if (gen._scaleQuantizer) {
        this._originalRoots.set(gen, gen._scaleQuantizer.getConfig().root);
      }
    }
    const orbit0 = this.engine.generators[0];
    this._baseRoot = orbit0 && orbit0._scaleQuantizer
      ? orbit0._scaleQuantizer.getConfig().root
      : DEFAULT_SCALE_CONFIG.root;
    this._currentRoot = this._baseRoot;
    this._progression.reset();

    const scaleType = this._getActiveScaleType();
    const scaleIntervals = SCALES[scaleType] || SCALES.pentatonic_minor;
    this._updateDronePitches(this._baseRoot, scaleIntervals);
  }

  _stopAndRestoreRoots() {
    if (this._pad) this._pad.release();
    if (this._bass) this._bass.release();
    // Release MIDI notes too
    const midi = this.engine.midiOutput;
    if (this.params.midiEnabled && midi?.releaseHarmonic) {
      midi.releaseHarmonic('pad');
      midi.releaseHarmonic('bass');
    }
    for (const [gen, root] of this._originalRoots) {
      if (gen._scaleQuantizer) gen._scaleQuantizer.setConfig({ root });
    }
    this._originalRoots.clear();
  }

  setParam(key, value) {
    if (!(key in this.params)) {
      console.warn(`HarmonicOrbit: unknown param "${key}"`);
      return;
    }
    const prev = this.params[key];
    this.params[key] = value;

    switch (key) {
      case 'enabled':
        this._group.visible = !!value;
        if (value && !prev) {
          if (this._audioInitialized) this._captureBaseAndStartDrones();
        } else if (!value && prev) {
          this._stopAndRestoreRoots();
        }
        break;
      case 'sides':
      case 'radius':
      case 'travelerSize':
        this._buildVisuals();
        break;
      case 'progressionId':
        this._progression = new ProgressionWalker(value);
        break;
      case 'chordVoicing':
      case 'padOctave':
      case 'bassOctave':
        // Recompute + rehold current chord/drone
        if (this._audioInitialized && this.params.enabled) {
          const scaleType = this._getActiveScaleType();
          const scaleIntervals = SCALES[scaleType] || SCALES.pentatonic_minor;
          this._updateDronePitches(this._currentRoot, scaleIntervals);
        }
        break;
      case 'padEnabled':
        if (this._pad) this._pad.setEnabled(value);
        if (!value && this.engine.midiOutput?.releaseHarmonic && this.params.midiEnabled) {
          this.engine.midiOutput.releaseHarmonic('pad');
        }
        break;
      case 'padVolume':
        if (this._pad) this._pad.setVolume(value);
        break;
      case 'bassEnabled':
        if (this._bass) this._bass.setEnabled(value);
        if (!value && this.engine.midiOutput?.releaseHarmonic && this.params.midiEnabled) {
          this.engine.midiOutput.releaseHarmonic('bass');
        }
        break;
      case 'bassVolume':
        if (this._bass) this._bass.setVolume(value);
        break;
      case 'midiEnabled':
        if (!value && this.engine.midiOutput?.releaseHarmonic) {
          this.engine.midiOutput.releaseHarmonic('pad');
          this.engine.midiOutput.releaseHarmonic('bass');
        } else if (value && this.params.enabled && this._audioInitialized) {
          // Re-send current state so external synths pick up
          this._resendExternal();
        }
        break;
      case 'oscEnabled':
        if (value && this.params.enabled && this._audioInitialized) this._resendExternal();
        break;
      case 'speedMode':
        if (value === 'periodSync') {
          this._sourceTotalAngle = 0;
          const srcOrbit = this.engine.generators[this.params.syncSourceIndex];
          this._sourcePrevAngle = srcOrbit?.nodes?.[0]?.angle ?? 0;
        }
        break;
      case 'syncSourceIndex': {
        this._sourceTotalAngle = 0;
        const src = this.engine.generators[value];
        this._sourcePrevAngle = src?.nodes?.[0]?.angle ?? 0;
        break;
      }
    }
  }

  /** Re-send the current chord/drone to external outputs (used when toggling). */
  _resendExternal() {
    if (!this._audioInitialized) return;
    const scaleType = this._getActiveScaleType();
    const scaleIntervals = SCALES[scaleType] || SCALES.pentatonic_minor;
    this._updateDronePitches(this._currentRoot, scaleIntervals);
  }

  /**
   * Silence (or un-silence) the drones without touching user-facing state.
   * Used by Engine.toggleMute / togglePause / defocus-mute. When silenced,
   * the pad+bass drones release their held notes and the traveler stops
   * advancing, so no new transpose events fire. When un-silenced, if the
   * harmonic orbit is still enabled we re-attack the current chord/drone.
   */
  setSilenced(v) {
    const wasSilenced = this._silenced;
    this._silenced = !!v;
    if (this._silenced && !wasSilenced) {
      // Release local drones immediately
      if (this._pad) this._pad.release();
      if (this._bass) this._bass.release();
      // Release external MIDI notes if we had been sending
      const midi = this.engine.midiOutput;
      if (this.params.midiEnabled && midi?.releaseHarmonic) {
        midi.releaseHarmonic('pad');
        midi.releaseHarmonic('bass');
      }
    } else if (!this._silenced && wasSilenced) {
      // Restore drones at the current root if harmonic orbit is still enabled
      if (this.params.enabled && this._audioInitialized) {
        const scaleType = this._getActiveScaleType();
        const scaleIntervals = SCALES[scaleType] || SCALES.pentatonic_minor;
        this._updateDronePitches(this._currentRoot, scaleIntervals);
      }
    }
  }

  /** Update pad or bass synth/effect config live (called from UI). */
  setPadConfig(updates) {
    if (this._pad) this._pad.setConfig(updates);
  }
  setBassConfig(updates) {
    if (this._bass) this._bass.setConfig(updates);
  }
  setPadEffectParam(fxType, paramName, value) {
    if (this._pad) this._pad.setEffectParam(fxType, paramName, value);
  }
  setBassEffectParam(fxType, paramName, value) {
    if (this._bass) this._bass.setEffectParam(fxType, paramName, value);
  }
  getPadConfig() { return this._pad ? this._pad.getConfig() : null; }
  getBassConfig() { return this._bass ? this._bass.getConfig() : null; }

  serialize() {
    return {
      params: { ...this.params },
      progression: this._progression.serialize(),
      baseRoot: this._baseRoot,
      cyclePos: this._cyclePos,
      padConfig: this.getPadConfig(),
      bassConfig: this.getBassConfig(),
    };
  }

  deserialize(data) {
    if (!data) return;
    if (data.params) {
      for (const [k, v] of Object.entries(data.params)) {
        if (k in this.params) this.setParam(k, v);
      }
    }
    if (data.progression) this._progression.deserialize(data.progression);
    if (data.baseRoot) this._baseRoot = data.baseRoot;
    if (typeof data.cyclePos === 'number') this._cyclePos = data.cyclePos;
    if (data.padConfig && this._pad) this._pad.setConfig(data.padConfig);
    if (data.bassConfig && this._bass) this._bass.setConfig(data.bassConfig);
  }

  dispose() {
    this._stopAndRestoreRoots();
    if (this._pad) { this._pad.dispose(); this._pad = null; }
    if (this._bass) { this._bass.dispose(); this._bass = null; }
    this._disposeHoloTrail();
    if (this._traveler) {
      this._group.remove(this._traveler);
      this._disposeTraveler();
    }
    if (this._sparklePool) this._sparklePool.dispose();
    this.sceneManager.scene.remove(this._group);
  }
}
