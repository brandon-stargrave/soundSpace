import * as Tone from 'tone';
import { rampParam } from '../util/audio.js';

// Shared synth and effect plumbing for the orbit synths (ToneOutput) and the
// Harmonic Orbit drones (AuxVoice), so both build and edit effects the same way.

const SYNTH_CLASSES = {
  Synth: Tone.Synth,
  FMSynth: Tone.FMSynth,
  AMSynth: Tone.AMSynth,
  MonoSynth: Tone.MonoSynth,
  MembraneSynth: Tone.MembraneSynth,
  MetalSynth: Tone.MetalSynth,
  PluckSynth: Tone.PluckSynth,
};

export const SYNTH_TYPES = Object.keys(SYNTH_CLASSES);

export function synthClassFor(type) {
  return SYNTH_CLASSES[type] || Tone.Synth;
}

/** Build one synth voice, falling back to defaults for types that reject the shared options. */
export function createSynthVoice(type, options, label = 'synth') {
  const SynthClass = synthClassFor(type);
  try {
    return new SynthClass(options || {});
  } catch (e) {
    console.warn(`${label}: synth options rejected, using defaults`, e.message);
    return new SynthClass();
  }
}

// ── Filter resonance ────────────────────────────────────────────────
// Tone.Filter cascades 1, 2, 4 or 8 biquads for -12/-24/-48/-96 dB rolloffs
// and feeds the same Q to each one. For lowpass/highpass, Q is the resonance
// peak in dB, so the peaks add up: Q 15 at -96 would be a +120 dB spike. The
// UI value is treated as the TOTAL resonance and capped.
const MAX_TOTAL_RESONANCE_DB = 12;
const STAGES = { '-12': 1, '-24': 2, '-48': 4, '-96': 8 };

function stageQ(q, type, rolloff) {
  if (type !== 'lowpass' && type !== 'highpass') return q;
  const stages = STAGES[String(rolloff)] ?? 1;
  return Math.min(q, MAX_TOTAL_RESONANCE_DB) / stages;
}

// ── Three-band EQ ───────────────────────────────────────────────────
// Tone.EQ3 splits the signal with lowpass/highpass pairs whose phases cancel
// at each crossover: at 0/0/0 it cuts ~17 dB at both crossover frequencies.
// Shelves plus a peaking band sum flat at 0 dB.
class ShelfEQ extends Tone.ToneAudioNode {
  constructor({ low = 0, mid = 0, high = 0, lowFrequency = 400, highFrequency = 2500 } = {}) {
    super();
    this.name = 'ShelfEQ';
    this._lowShelf = new Tone.Filter({ type: 'lowshelf', frequency: lowFrequency, gain: low });
    this._peak = new Tone.Filter({ type: 'peaking', frequency: Math.sqrt(lowFrequency * highFrequency), Q: 0.7, gain: mid });
    this._highShelf = new Tone.Filter({ type: 'highshelf', frequency: highFrequency, gain: high });
    this._lowShelf.chain(this._peak, this._highShelf);
    this.input = this._lowShelf;
    this.output = this._highShelf;
    this.low = this._lowShelf.gain;
    this.mid = this._peak.gain;
    this.high = this._highShelf.gain;
    this._lowFrequency = lowFrequency;
    this._highFrequency = highFrequency;
  }

  setBandFrequency(band, value) {
    if (band === 'lowFrequency') {
      this._lowFrequency = value;
      rampParam(this._lowShelf.frequency, value);
    } else {
      this._highFrequency = value;
      rampParam(this._highShelf.frequency, value);
    }
    // The mid band sits between the two shelves
    rampParam(this._peak.frequency, Math.sqrt(this._lowFrequency * this._highFrequency));
  }

  dispose() {
    super.dispose();
    this._lowShelf.dispose();
    this._peak.dispose();
    this._highShelf.dispose();
    return this;
  }
}

/** Create the effect described by a config entry `{ type, wet, options }`, or null. */
export function createEffect(fx, label = 'effect') {
  const { type, wet } = fx;
  const options = fx.options || {};
  let effect;
  try {
    switch (type) {
      case 'Filter': {
        const filterType = options.type || 'lowpass';
        const rolloff = options.rolloff ?? -12;
        effect = new Tone.Filter(options.frequency, filterType, rolloff);
        effect.Q.value = stageQ(options.Q ?? 1, filterType, rolloff);
        break;
      }
      case 'EQ3': effect = new ShelfEQ(options); break;
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
    effect._fxOptions = { ...options };
  } catch (e) {
    console.warn(`${label}: failed to create effect ${type}`, e);
    return null;
  }
  return effect;
}

// Reverb re-renders its impulse response whenever decay or pre-delay changes;
// wait for the slider to settle instead of rendering on every step
const REVERB_REGEN_DELAY_MS = 200;

/** Apply one parameter change to a live effect created by createEffect. */
export function setEffectParam(effect, paramName, value) {
  const type = effect._fxType;
  const opts = effect._fxOptions || (effect._fxOptions = {});
  opts[paramName] = value;

  if (paramName === 'wet') {
    if (effect.wet) rampParam(effect.wet, value);
    return;
  }

  switch (type) {
    case 'Reverb':
      if (paramName === 'decay' || paramName === 'preDelay') {
        clearTimeout(effect._regenTimer);
        effect._regenTimer = setTimeout(() => {
          if (!effect.disposed) effect[paramName] = value; // the setter re-renders the impulse response
        }, REVERB_REGEN_DELAY_MS);
        return;
      }
      break;
    case 'Filter':
      if (paramName === 'Q' || paramName === 'rolloff' || paramName === 'type') {
        if (paramName === 'rolloff') effect.rolloff = value;
        if (paramName === 'type') effect.type = value;
        rampParam(effect.Q, stageQ(opts.Q ?? 1, effect.type, effect.rolloff));
        return;
      }
      if (paramName === 'frequency') { rampParam(effect.frequency, value); return; }
      break;
    case 'EQ3':
      if (paramName === 'low' || paramName === 'mid' || paramName === 'high') { rampParam(effect[paramName], value); return; }
      if (paramName === 'lowFrequency' || paramName === 'highFrequency') { effect.setBandFrequency(paramName, value); return; }
      break;
    case 'Chorus':
      if (paramName === 'frequency') { rampParam(effect.frequency, value); return; }
      if (paramName === 'delayTime' || paramName === 'depth') { effect[paramName] = value; return; }
      break;
  }

  // Generic: signals and params ramp, plain properties are assigned
  const target = effect[paramName];
  if (target === undefined) return;
  if (target && target.value !== undefined) rampParam(target, value);
  else effect[paramName] = value;
}

export function disposeNode(node) {
  if (!node) return;
  clearTimeout(node._regenTimer);
  try { node.disconnect(); } catch {}
  try { node.dispose(); } catch {}
}
