import * as Tone from 'tone';
import { DEFAULT_SYNTH_CONFIG } from '../util/constants.js';
import { clamp } from '../util/math.js';

/**
 * Local audio output using Tone.js.
 * Uses a voice pool architecture: each note gets its own mono synth + Panner3D
 * so strict per-note 3D spatialization is possible without overlapping notes
 * dragging each other's positions. Effects chain is shared downstream of the
 * voice panners (standard mix-bus behavior).
 */
export class ToneOutput {
  constructor(config = {}) {
    this.config = { ...DEFAULT_SYNTH_CONFIG, ...config };
    this.enabled = true;
    this.synth = null;            // legacy ref (unused with voice pool)
    this.effectsChain = [];
    this._voices = [];            // Array<{ synth, panner, busyUntil }>
    this._voiceCursor = 0;
    this._voicePoolSize = 12;
    this._spatialEnabled = false;
    this._initialized = false;
  }

  /** Must be called from a user gesture context */
  async init() {
    await Tone.start();
    this._buildSynthChain();
    this._initialized = true;
  }

  /** Play a note from a trigger event — acquires a voice and pins its panner */
  send(triggerEvent, quantized) {
    if (!this.enabled || !this._initialized || this._voices.length === 0) return;

    const velocity = clamp(triggerEvent.velocity * this.config.velocityScale, 0.01, 1);
    const voice = this._acquireVoice();

    // Pin the panner at the collision point (stays there for note's lifetime)
    if (this._spatialEnabled && triggerEvent.position) {
      const p = triggerEvent.position;
      voice.panner.positionX.value = p.x;
      voice.panner.positionY.value = p.y;
      voice.panner.positionZ.value = p.z ?? 0;
    } else {
      voice.panner.positionX.value = 0;
      voice.panner.positionY.value = 0;
      voice.panner.positionZ.value = 0;
    }

    try {
      voice.synth.triggerAttackRelease(
        quantized.frequency,
        this.config.noteDuration,
        Tone.now(),
        velocity
      );
      // Mark busy for note duration + release envelope tail + small pad
      const durSec = this._durationToSeconds(this.config.noteDuration);
      voice.busyUntil = Tone.now() + durSec + this._estimateReleaseTail();
    } catch (e) {
      console.warn('ToneOutput: note dropped', e.message);
    }
  }

  /** Acquire an idle voice (round-robin); steal oldest if none idle */
  _acquireVoice() {
    const now = Tone.now();
    for (let i = 0; i < this._voices.length; i++) {
      const idx = (this._voiceCursor + i) % this._voices.length;
      if (this._voices[idx].busyUntil <= now) {
        this._voiceCursor = (idx + 1) % this._voices.length;
        return this._voices[idx];
      }
    }
    // All busy — steal oldest (lowest busyUntil)
    let oldest = this._voices[0];
    for (const v of this._voices) if (v.busyUntil < oldest.busyUntil) oldest = v;
    return oldest;
  }

  /** Convert Tone duration (string like '16n' or number in sec) to seconds */
  _durationToSeconds(dur) {
    try {
      if (typeof dur === 'number') return dur;
      return Tone.Time(dur).toSeconds();
    } catch {
      return 0.25; // fallback ~quarter note at 120bpm
    }
  }

  /** Release-envelope tail estimate for busyUntil calculation */
  _estimateReleaseTail() {
    const rel = this.config.synthOptions?.envelope?.release ?? 0.5;
    return Number(rel) + 0.05; // small pad
  }

  /** Enable/disable spatial panning — affects future triggers only */
  setSpatialEnabled(v) {
    this._spatialEnabled = !!v;
  }

  /** Rebuild the full audio graph: voice pool + shared FX chain + destination */
  _buildSynthChain() {
    this._disposeChain();

    // 1) Build shared effects chain
    this.effectsChain = this.config.effects
      .map(fx => this._createEffect(fx))
      .filter(Boolean);

    // 2) Connect FX chain: fx[0] → fx[1] → ... → fx[last] → destination
    if (this.effectsChain.length > 0) {
      for (let i = 0; i < this.effectsChain.length - 1; i++) {
        this.effectsChain[i].connect(this.effectsChain[i + 1]);
      }
      this.effectsChain[this.effectsChain.length - 1].connect(Tone.getDestination());
    }

    // 3) Build voice pool — each voice = mono synth → Panner3D → fx bus
    this._buildVoicePool();
  }

  /** Build the per-voice pool (synth + panner pairs). Feeds shared FX bus. */
  _buildVoicePool() {
    this._disposeVoices();

    const SynthClass = this._getSynthClass(this.config.synthType);
    const fxHead = this.effectsChain.length > 0
      ? this.effectsChain[0]
      : Tone.getDestination();

    for (let i = 0; i < this._voicePoolSize; i++) {
      let synth;
      try {
        synth = new SynthClass(this.config.synthOptions || {});
      } catch (e) {
        // Some synth types don't accept arbitrary oscillator options
        // (e.g. MetalSynth ignores oscillator). Fall back to no options.
        console.warn(`ToneOutput: voice ${i} synth options rejected, using defaults`, e.message);
        synth = new SynthClass();
      }

      const panner = new Tone.Panner3D({
        panningModel: 'HRTF',
        distanceModel: 'inverse',
        refDistance: 2,
        rolloffFactor: 1,
        maxDistance: 20,
        positionX: 0, positionY: 0, positionZ: 0,
      });

      synth.connect(panner);
      panner.connect(fxHead);

      this._voices.push({ synth, panner, busyUntil: 0 });
    }
  }

  _disposeVoices() {
    for (const v of this._voices) {
      try { v.synth.disconnect(); } catch {}
      try { v.panner.disconnect(); } catch {}
      try { v.synth.dispose(); } catch {}
      try { v.panner.dispose(); } catch {}
    }
    this._voices = [];
    this._voiceCursor = 0;
  }

  _getSynthClass(type) {
    const map = {
      'Synth': Tone.Synth,
      'FMSynth': Tone.FMSynth,
      'AMSynth': Tone.AMSynth,
      'MonoSynth': Tone.MonoSynth,
      'MembraneSynth': Tone.MembraneSynth,
      'MetalSynth': Tone.MetalSynth,
      'PluckSynth': Tone.PluckSynth,
    };
    return map[type] || Tone.Synth;
  }

  _createEffect(fx) {
    const { type, wet, options } = fx;
    let effect;
    try {
      switch (type) {
        case 'Filter': effect = new Tone.Filter(options.frequency, options.type, options.rolloff); if (options.Q !== undefined) effect.Q.value = options.Q; break;
        case 'EQ3': effect = new Tone.EQ3(options.low, options.mid, options.high); effect.lowFrequency.value = options.lowFrequency || 400; effect.highFrequency.value = options.highFrequency || 2500; break;
        case 'Reverb': effect = new Tone.Reverb(options); break;
        case 'FeedbackDelay': effect = new Tone.FeedbackDelay(options.delayTime, options.feedback); break;
        case 'Chorus': effect = new Tone.Chorus(options).start(); break;
        case 'Distortion': effect = new Tone.Distortion(options); break;
        case 'Phaser': effect = new Tone.Phaser(options); break;
        case 'PingPongDelay': effect = new Tone.PingPongDelay(options); break;
        case 'Tremolo': effect = new Tone.Tremolo(options).start(); break;
        case 'AutoFilter': effect = new Tone.AutoFilter(options).start(); break;
        case 'BitCrusher': effect = new Tone.BitCrusher(options); break;
        case 'Freeverb': effect = new Tone.Freeverb(options); break;
        default: return null;
      }
      if (wet !== undefined && effect.wet) effect.wet.value = wet;
      effect._fxType = type; // tag for live param lookup
    } catch (e) {
      console.warn(`ToneOutput: failed to create effect ${type}`, e);
      return null;
    }
    return effect;
  }

  /** Update synth config and rebuild */
  setConfig(updates) {
    Object.assign(this.config, updates);
    if (this._initialized) {
      this._buildSynthChain();
    }
  }

  /** Swap delay type (FeedbackDelay ↔ PingPongDelay) without full chain rebuild */
  swapDelayType(newType) {
    const oldType = newType === 'PingPongDelay' ? 'FeedbackDelay' : 'PingPongDelay';
    const fxIndex = this.config.effects.findIndex(f => f.type === oldType);
    if (fxIndex === -1) return;

    // Preserve current params
    const fx = this.config.effects[fxIndex];
    fx.type = newType;

    // Rebuild chain to apply the swap
    if (this._initialized) {
      this._buildSynthChain();
    }
  }

  /** Update a single effect param live without rebuilding the chain */
  setEffectParam(effectType, paramName, value) {
    // Normalize delay type lookup — both map to the same effect slot
    const lookupType = (effectType === 'FeedbackDelay' || effectType === 'PingPongDelay')
      ? this.config.effects.find(f => f.type === 'FeedbackDelay' || f.type === 'PingPongDelay')?.type || effectType
      : effectType;
    const fx = this.config.effects.find(f => f.type === lookupType);
    if (fx) {
      if (paramName === 'wet') {
        fx.wet = value;
      } else {
        fx.options[paramName] = value;
      }
    }
    // Apply to live effect instance (matched by _fxType tag)
    const effect = this.effectsChain.find(e => e && e._fxType === lookupType);
    if (!effect) return;
    try {
      if (paramName === 'wet') {
        if (effect.wet) effect.wet.value = value;
      } else if (paramName === 'decay' && effectType === 'Reverb') {
        // Reverb decay requires rebuilding impulse response
        effect.decay = value;
        effect.generate && effect.generate();
      } else if (paramName === 'preDelay' && effectType === 'Reverb') {
        effect.preDelay = value;
        effect.generate && effect.generate();
      } else if (paramName === 'frequency' && effectType === 'Filter') {
        effect.frequency.value = value;
      } else if (paramName === 'Q' && effectType === 'Filter') {
        effect.Q.value = value;
      } else if (paramName === 'type' && effectType === 'Filter') {
        effect.type = value;
      } else if (paramName === 'rolloff' && effectType === 'Filter') {
        effect.rolloff = value;
      } else if (effectType === 'Chorus' && paramName === 'frequency') {
        effect.frequency.value = value;
      } else if (effectType === 'Chorus' && paramName === 'delayTime') {
        effect.delayTime = value;
      } else if (effectType === 'Chorus' && paramName === 'depth') {
        effect.depth = value;
      } else if (effectType === 'EQ3' && (paramName === 'low' || paramName === 'mid' || paramName === 'high')) {
        effect[paramName].value = value;
      } else if (paramName === 'lowFrequency' && effectType === 'EQ3') {
        effect.lowFrequency.value = value;
      } else if (paramName === 'highFrequency' && effectType === 'EQ3') {
        effect.highFrequency.value = value;
      } else if (paramName === 'feedback') {
        effect.feedback.value = value;
      } else if (paramName === 'delayTime') {
        effect.delayTime.value = value;
      } else if (effect[paramName] !== undefined) {
        if (effect[paramName] && effect[paramName].value !== undefined) {
          effect[paramName].value = value;
        } else {
          effect[paramName] = value;
        }
      }
    } catch (e) {
      console.warn(`setEffectParam: ${effectType}.${paramName}`, e.message);
    }
  }

  getConfig() {
    return { ...this.config };
  }

  _disposeChain() {
    // Dispose voices first (they connect to the fx head)
    this._disposeVoices();

    // Legacy synth ref (kept null with voice pool architecture, but stay safe)
    if (this.synth) {
      try { this.synth.disconnect(); } catch {}
      try { this.synth.dispose(); } catch {}
      this.synth = null;
    }

    for (const fx of this.effectsChain) {
      try { fx.disconnect(); } catch {}
      try { fx.dispose(); } catch {}
    }
    this.effectsChain = [];
  }

  dispose() {
    this._disposeChain();
    this._initialized = false;
  }
}
