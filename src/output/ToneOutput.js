import * as Tone from 'tone';
import { DEFAULT_SYNTH_CONFIG } from '../util/constants.js';
import { clamp } from '../util/math.js';
import { createEffect, createSynthVoice, setEffectParam, disposeNode } from './effects.js';

// Fade applied when this output is removed, so tails don't cut off with a click
const REMOVE_FADE_SECONDS = 0.04;

/** Merge plain objects recursively; arrays and values in `patch` replace those in `base`. */
function mergeDeep(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const isPlain = value && typeof value === 'object' && !Array.isArray(value);
    out[key] = isPlain && base[key] && typeof base[key] === 'object' ? mergeDeep(base[key], value) : value;
  }
  return out;
}

/**
 * Local audio output using Tone.js.
 * Uses a voice pool architecture: each note gets its own mono synth. With
 * spatial audio on, every voice runs through its own Panner3D so notes can be
 * placed independently; with it off, voices feed the effects bus directly.
 * The effects chain is shared downstream of the voices (standard mix-bus
 * behavior) and ends in an output gain that feeds the master bus.
 */
export class ToneOutput {
  constructor(config = {}) {
    this.config = structuredClone({ ...DEFAULT_SYNTH_CONFIG, ...config });
    this.enabled = true;
    this.effectsChain = [];
    this._output = null;          // Gain after the effects chain
    this._voices = [];            // Array<{ synth, panner, busyUntil }>
    this._voiceCursor = 0;
    this._voicePoolSize = 12;
    this._spatialEnabled = false;
    this._spatialAxis = 'horizontal'; // 'horizontal' | 'vertical' — see setSpatialAxis
    this._initialized = false;
  }

  /** Build the audio graph. The engine has already started the AudioContext. */
  async init() {
    if (this._initialized) return;
    this._buildSynthChain();
    this._initialized = true;
  }

  /** Play a note from a trigger event — acquires a voice and pins its panner */
  send(triggerEvent, quantized) {
    if (!this.enabled || !this._initialized || this._voices.length === 0) return;

    const velocity = clamp(triggerEvent.velocity * this.config.velocityScale, 0.01, 1);
    const voice = this._acquireVoice();

    // Pin the panner at the collision point (stays there for note's lifetime).
    // In 'vertical' axis mode, swap world X↔Y so visual top/bottom drives audio
    // L/R — appropriate for portrait phones with top/bottom speakers.
    if (this._spatialEnabled && triggerEvent.position) {
      const p = triggerEvent.position;
      const vertical = this._spatialAxis === 'vertical';
      voice.panner.positionX.value = vertical ? p.y : p.x;
      voice.panner.positionY.value = vertical ? p.x : p.y;
      voice.panner.positionZ.value = p.z ?? 0;
    }

    try {
      const now = Tone.now();
      voice.synth.triggerAttackRelease(quantized.frequency, this.config.noteDuration, now, velocity);
      // Mark busy for note duration + release envelope tail + small pad
      voice.busyUntil = now + this._durationToSeconds(this.config.noteDuration) + this._estimateReleaseTail();
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

  /** Fade this orbit's output in or out (per-orbit mute and solo). */
  setAudible(audible) {
    this._audible = !!audible;
    if (this._output) this._output.gain.rampTo(this._audible ? 1 : 0, 0.03);
  }

  /** Enable/disable spatial panning. Voices bypass their panners while it's off. */
  setSpatialEnabled(v) {
    this._spatialEnabled = !!v;
    for (const voice of this._voices) this._routeVoice(voice);
  }

  /**
   * Set spatial-axis mapping. 'horizontal' (default) panel maps world X to L/R
   * (normal headphone/landscape behavior). 'vertical' swaps so world Y drives
   * L/R — for portrait-phone playback where speakers are top/bottom.
   */
  setSpatialAxis(axis) {
    this._spatialAxis = axis === 'vertical' ? 'vertical' : 'horizontal';
  }

  /** Where voices feed in: the first effect, or the output gain when there are none. */
  _fxHead() {
    return this.effectsChain.length > 0 ? this.effectsChain[0] : this._output;
  }

  /** Connect a voice straight to the effects bus, or through its panner when spatial is on. */
  _routeVoice(voice) {
    try { voice.synth.disconnect(); } catch {}
    voice.synth.connect(this._spatialEnabled ? voice.panner : this._fxHead());
  }

  /** Rebuild the full audio graph: voice pool + shared FX chain + output gain */
  _buildSynthChain() {
    this._disposeChain();

    this._output = new Tone.Gain(this._audible === false ? 0 : 1);
    this._output.connect(Tone.getDestination());

    // Shared effects chain: fx[0] → fx[1] → ... → fx[last] → output
    this.effectsChain = this.config.effects
      .map(fx => createEffect(fx, 'ToneOutput'))
      .filter(Boolean);
    const chain = [...this.effectsChain, this._output];
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);

    this._buildVoicePool();
  }

  /** Build the per-voice pool (synth + panner pairs). Feeds the shared FX bus. */
  _buildVoicePool() {
    const fxHead = this._fxHead();
    for (let i = 0; i < this._voicePoolSize; i++) {
      const synth = createSynthVoice(this.config.synthType, this.config.synthOptions, 'ToneOutput');
      // Inverse distance with the reference near the default camera distance,
      // so turning spatial audio on doesn't drop the whole mix by 6–12 dB
      const panner = new Tone.Panner3D({
        panningModel: 'HRTF',
        distanceModel: 'inverse',
        refDistance: 6,
        rolloffFactor: 1,
        maxDistance: 40,
        positionX: 0, positionY: 0, positionZ: 0,
      });
      panner.connect(fxHead);
      const voice = { synth, panner, busyUntil: 0 };
      this._routeVoice(voice);
      this._voices.push(voice);
    }
    this._voiceCursor = 0;
  }

  /**
   * Swap in a fresh voice pool (e.g. a new synth type). The old voices are
   * released and disposed once their release tail has finished, so notes that
   * are sounding fade out instead of cutting off.
   */
  _replaceVoicePool(releaseSeconds) {
    const retiring = this._voices;
    this._voices = [];
    const now = Tone.now();
    for (const v of retiring) {
      try { v.synth.triggerRelease?.(now); } catch {}
    }
    setTimeout(() => {
      for (const v of retiring) {
        disposeNode(v.synth);
        disposeNode(v.panner);
      }
    }, (Number(releaseSeconds) + 0.2) * 1000);
    this._buildVoicePool();
  }

  /**
   * Update the synth config. Only what changed is touched: volume and note
   * length are read per note, envelope and oscillator edits go to the live
   * voices, a synth type change swaps the voice pool, and only a new effects
   * list rebuilds the whole graph.
   */
  setConfig(updates) {
    const previousRelease = this._estimateReleaseTail();
    const previousType = this.config.synthType;
    const { synthOptions, ...rest } = structuredClone(updates);
    Object.assign(this.config, rest);
    // Synth options arrive as partial edits (one envelope stage at a time)
    if (synthOptions) this.config.synthOptions = mergeDeep(this.config.synthOptions || {}, synthOptions);
    if (!this._initialized) return;

    if ('effects' in updates) {
      this._buildSynthChain();
    } else if ('synthType' in updates && updates.synthType !== previousType) {
      this._replaceVoicePool(previousRelease);
    } else if ('synthOptions' in updates) {
      try {
        for (const v of this._voices) v.synth.set(updates.synthOptions);
      } catch (e) {
        // Some synth types reject options they don't have; rebuild from the config instead
        this._replaceVoicePool(previousRelease);
      }
    }
  }

  /** Swap delay type (FeedbackDelay ↔ PingPongDelay) without full chain rebuild */
  swapDelayType(newType) {
    const oldType = newType === 'PingPongDelay' ? 'FeedbackDelay' : 'PingPongDelay';
    const fx = this.config.effects.find(f => f.type === oldType);
    if (!fx) return;
    fx.type = newType;
    if (this._initialized) this._buildSynthChain();
  }

  /** Update a single effect param live without rebuilding the chain */
  setEffectParam(effectType, paramName, value) {
    // Normalize delay type lookup — both map to the same effect slot
    const lookupType = (effectType === 'FeedbackDelay' || effectType === 'PingPongDelay')
      ? this.config.effects.find(f => f.type === 'FeedbackDelay' || f.type === 'PingPongDelay')?.type || effectType
      : effectType;
    const fx = this.config.effects.find(f => f.type === lookupType);
    if (fx) {
      if (paramName === 'wet') fx.wet = value;
      else fx.options[paramName] = value;
    }
    const effect = this.effectsChain.find(e => e && e._fxType === lookupType);
    if (!effect) return;
    try {
      setEffectParam(effect, paramName, value);
    } catch (e) {
      console.warn(`setEffectParam: ${effectType}.${paramName}`, e.message);
    }
  }

  getConfig() {
    return structuredClone(this.config);
  }

  _disposeChain() {
    for (const v of this._voices) {
      disposeNode(v.synth);
      disposeNode(v.panner);
    }
    this._voices = [];
    this._voiceCursor = 0;
    for (const fx of this.effectsChain) disposeNode(fx);
    this.effectsChain = [];
    disposeNode(this._output);
    this._output = null;
  }

  /** Fade out, then tear down the graph. */
  dispose() {
    this.enabled = false;
    this._initialized = false;
    if (!this._output) return;
    const voices = this._voices;
    const effects = this.effectsChain;
    const output = this._output;
    this._voices = [];
    this.effectsChain = [];
    this._output = null;
    try { output.gain.rampTo(0, REMOVE_FADE_SECONDS); } catch {}
    setTimeout(() => {
      for (const v of voices) {
        disposeNode(v.synth);
        disposeNode(v.panner);
      }
      for (const fx of effects) disposeNode(fx);
      disposeNode(output);
    }, (REMOVE_FADE_SECONDS + 0.05) * 1000);
  }
}
