/**
 * Preset validation. Presets arrive from files and shared links, so they're
 * untrusted: every value is checked against the same ranges the controls
 * allow, unknown IDs fall back to defaults, and anything that isn't a
 * soundSpace preset is rejected before the current scene is touched.
 *
 * Pure data code (no three.js or Tone.js), so it can be unit-tested in Node.
 */

import {
  SCALES, NOTE_NAMES, NOTE_NAME_TO_SEMITONE, SYNTH_TYPES, NOTE_DURATIONS, CHORD_VOICINGS,
} from '../util/constants.js';
import { PROGRESSION_IDS } from './ProgressionWalker.js';
import { ORBIT_PARAMS, DEFAULT_SPEED_RATIOS, MAX_NODES } from '../generators/orbitParams.js';

export const PRESET_APP = 'soundSpace';
export const PRESET_VERSION = 2;
export const MAX_ORBITS = 5;

export class PresetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PresetError';
  }
}

// ── Primitive checks ────────────────────────────────────────────────

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function num(v, min, max, fallback, int = false) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  const clamped = Math.min(max, Math.max(min, n));
  return int ? Math.round(clamped) : clamped;
}

const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);

/** Accept sharp or flat note names; store the sharp spelling the scale menus use. */
function noteName(v, fallback) {
  if (typeof v !== 'string' || !(v in NOTE_NAME_TO_SEMITONE)) return fallback;
  return NOTE_NAMES[NOTE_NAME_TO_SEMITONE[v]];
}

/** Clamp every key of `spec` ({ key: [min, max] | [min, max, 'int'] }) present in `src`. */
function numbers(src, spec) {
  const out = {};
  if (!isObject(src)) return out;
  for (const [key, [min, max, int]] of Object.entries(spec)) {
    if (key in src) {
      const v = num(src[key], min, max, undefined, int === 'int');
      if (v !== undefined) out[key] = v;
    }
  }
  return out;
}

// ── Scale ───────────────────────────────────────────────────────────

const SCALE_TYPES = [...Object.keys(SCALES), 'custom'];
const MAPPING_MODES = ['linear', 'wrap', 'nearest', 'random_in_scale'];

export function sanitizeScale(src) {
  const s = isObject(src) ? src : {};
  let octaveLow = num(s.octaveLow, 0, 8, 3, true);
  let octaveHigh = num(s.octaveHigh, 0, 8, 5, true);
  if (octaveLow > octaveHigh) [octaveLow, octaveHigh] = [octaveHigh, octaveLow];
  let customDegrees = null;
  if (Array.isArray(s.customDegrees)) {
    const degrees = [...new Set(s.customDegrees.map(d => num(d, 0, 11, null, true)).filter(d => d !== null))].sort((a, b) => a - b);
    if (degrees.length) customDegrees = degrees;
  }
  let scaleType = oneOf(s.scaleType, SCALE_TYPES, 'pentatonic_minor');
  if (scaleType === 'custom' && !customDegrees) scaleType = 'pentatonic_minor';
  return {
    root: noteName(s.root, 'C'),
    scaleType,
    octaveLow,
    octaveHigh,
    mappingMode: oneOf(s.mappingMode, MAPPING_MODES, 'linear'),
    customDegrees,
  };
}

// ── Synth and effects ───────────────────────────────────────────────

const OSC_TYPE = /^(fm|am|fat)?(sine|square|sawtooth|triangle)(\d{1,2})?$|^(pwm|pulse)$/;
const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'lowshelf', 'highshelf', 'peaking', 'allpass'];
const ROLLOFFS = [-12, -24, -48, -96];
const TIME_NOTATIONS = ['64n', '32n', '16n', '16n.', '8n', '8n.', '8t', '4n', '4n.', '4t', '2n', '2n.', '1n'];

const ENVELOPE = { attack: [0.001, 10], decay: [0.001, 10], sustain: [0, 1], release: [0.001, 20] };
const FILTER_ENVELOPE = { ...ENVELOPE, baseFrequency: [20, 20000], octaves: [0, 8], exponent: [0.1, 10] };

function sanitizeOscillator(src) {
  if (!isObject(src)) return undefined;
  const out = {};
  if (typeof src.type === 'string' && OSC_TYPE.test(src.type)) out.type = src.type;
  Object.assign(out, numbers(src, { count: [1, 8, 'int'], spread: [0, 100], modulationIndex: [0, 100], harmonicity: [0.1, 20], width: [0, 1] }));
  return out;
}

function sanitizeSynthOptions(src, synthType) {
  if (!isObject(src)) return {};
  const out = numbers(src, {
    harmonicity: [0.1, 20], modulationIndex: [0, 100], detune: [-1200, 1200],
    portamento: [0, 2], pitchDecay: [0, 1], octaves: [0.5, 8],
    attackNoise: [0.1, 20], dampening: [20, 20000], resonance: [0, 8000], release: [0.01, 10],
  });
  // PluckSynth's resonance is comb-filter feedback: 1 and above rings forever
  if (synthType === 'PluckSynth' && 'resonance' in out) out.resonance = Math.min(out.resonance, 0.99);
  const osc = sanitizeOscillator(src.oscillator);
  if (osc) out.oscillator = osc;
  const mod = sanitizeOscillator(src.modulation);
  if (mod) out.modulation = mod;
  for (const key of ['envelope', 'modulationEnvelope']) {
    if (isObject(src[key])) out[key] = numbers(src[key], ENVELOPE);
  }
  if (isObject(src.filterEnvelope)) out.filterEnvelope = numbers(src.filterEnvelope, FILTER_ENVELOPE);
  if (isObject(src.filter)) {
    out.filter = numbers(src.filter, { Q: [0, 20], frequency: [20, 20000], gain: [-24, 24] });
    if (FILTER_TYPES.includes(src.filter.type)) out.filter.type = src.filter.type;
    if (ROLLOFFS.includes(src.filter.rolloff)) out.filter.rolloff = src.filter.rolloff;
  }
  return out;
}

const EFFECT_SPECS = {
  Filter: { frequency: [20, 20000], Q: [0, 20], gain: [-24, 24] },
  EQ3: { low: [-24, 24], mid: [-24, 24], high: [-24, 24], lowFrequency: [20, 20000], highFrequency: [20, 20000] },
  Reverb: { decay: [0.1, 12], preDelay: [0, 0.5] },
  FeedbackDelay: { feedback: [0, 0.95], maxDelay: [0.01, 4] },
  PingPongDelay: { feedback: [0, 0.95], maxDelay: [0.01, 4] },
  Chorus: { frequency: [0.01, 20], delayTime: [0.5, 20], depth: [0, 1], spread: [0, 180] },
  Distortion: { distortion: [0, 1] },
  Phaser: { frequency: [0.01, 20], octaves: [0, 8], baseFrequency: [20, 20000], Q: [0, 20] },
  Tremolo: { frequency: [0.01, 40], depth: [0, 1], spread: [0, 180] },
  AutoFilter: { frequency: [0.01, 20], depth: [0, 1], baseFrequency: [20, 20000], octaves: [0, 8] },
  BitCrusher: { bits: [1, 16, 'int'] },
  Freeverb: { roomSize: [0, 0.99], dampening: [20, 20000] },
};

function sanitizeEffect(src) {
  if (!isObject(src) || !(src.type in EFFECT_SPECS)) return null;
  const opts = isObject(src.options) ? src.options : {};
  const options = numbers(opts, EFFECT_SPECS[src.type]);
  if (src.type === 'Filter') {
    options.type = oneOf(opts.type, FILTER_TYPES, 'lowpass');
    options.rolloff = oneOf(Number(opts.rolloff), ROLLOFFS, -12);
  }
  if (src.type === 'FeedbackDelay' || src.type === 'PingPongDelay') {
    options.delayTime = TIME_NOTATIONS.includes(opts.delayTime)
      ? opts.delayTime
      : num(opts.delayTime, 0.001, 2, '8n');
  }
  if (src.type === 'Distortion' && ['none', '2x', '4x'].includes(opts.oversample)) options.oversample = opts.oversample;
  const effect = { type: src.type, options };
  if ('wet' in src) effect.wet = num(src.wet, 0, 1, 1);
  return effect;
}

/**
 * Orbit synth (`kind: 'orbit'`) or Harmonic Orbit pad/bass voice (`kind: 'aux'`).
 * Returns undefined when absent so the engine's defaults apply.
 */
export function sanitizeSynth(src, kind = 'orbit') {
  if (!isObject(src)) return undefined;
  const synthType = oneOf(src.synthType, SYNTH_TYPES, 'Synth');
  const out = {
    synthType,
    synthOptions: sanitizeSynthOptions(src.synthOptions, synthType),
    effects: Array.isArray(src.effects) ? src.effects.slice(0, 8).map(sanitizeEffect).filter(Boolean) : [],
  };
  if (kind === 'orbit') {
    out.noteDuration = oneOf(src.noteDuration, NOTE_DURATIONS, '16n');
    out.velocityScale = num(src.velocityScale, 0.1, 1.5, 0.8);
  } else {
    out.mode = oneOf(src.mode, ['mono', 'poly'], 'mono');
  }
  return out;
}

// ── Orbit generator ─────────────────────────────────────────────────

/** Validate plugin params against the plugin's own control descriptors. */
function sanitizePluginParams(params, descriptors) {
  const out = {};
  if (!isObject(params)) return out;
  for (const d of descriptors) {
    if (!(d.key in params)) continue;
    const v = params[d.key];
    if (d.type === 'range' || d.type === 'number') {
      const n = num(v, d.min ?? -Infinity, d.max ?? Infinity, undefined, Number.isInteger(d.step ?? 0.5) && Number.isInteger(d.min ?? 0.5));
      if (n !== undefined) out[d.key] = n;
    } else if (d.type === 'select') {
      if ((d.options || []).includes(v)) out[d.key] = v;
    } else if (d.type === 'toggle') {
      if (typeof v === 'boolean') out[d.key] = v;
    }
  }
  return out;
}

function sanitizePlugin(src, ids, kind, ctx, warnings) {
  if (!isObject(src)) return null;
  if (!ids.includes(src.id)) {
    warnings.push(`Unknown ${kind} "${String(src.id).slice(0, 40)}" was replaced with the default.`);
    return null;
  }
  return { id: src.id, params: sanitizePluginParams(src.params, ctx.describe(kind, src.id)) };
}

function sanitizeGenerator(src, ctx, warnings) {
  const g = isObject(src) ? src : {};
  const p = isObject(g.params) ? g.params : {};
  const params = {};
  for (const d of ORBIT_PARAMS) {
    if (!(d.key in p)) continue;
    const v = p[d.key];
    if (d.type === 'range') {
      const n = num(v, d.min, d.max, undefined, d.step === 1);
      if (n !== undefined) params[d.key] = n;
    } else if (d.type === 'toggle') {
      if (typeof v === 'boolean') params[d.key] = v;
    } else if (d.options && d.options.includes(v)) {
      params[d.key] = v;
    }
  }
  if (Array.isArray(p.speedRatios)) {
    const ratios = p.speedRatios.slice(0, MAX_NODES).map((r, i) => num(r, 0.01, 64, DEFAULT_SPEED_RATIOS[i]));
    while (ratios.length < MAX_NODES) ratios.push(DEFAULT_SPEED_RATIOS[ratios.length]);
    params.speedRatios = ratios;
  }
  if ('orbitIndex' in p) params.orbitIndex = num(p.orbitIndex, 0, MAX_ORBITS - 1, 0, true);

  const motion = g.motionAlgorithm && g.motionAlgorithm.id !== 'none'
    ? sanitizePlugin(g.motionAlgorithm, ctx.motionIds, 'motion', ctx, warnings)
    : null;
  const trigger = sanitizePlugin(g.triggerMethod, ctx.triggerIds, 'trigger', ctx, warnings);
  const mapping = sanitizePlugin(g.noteMapping, ctx.mappingIds, 'mapping', ctx, warnings);

  // The id stored in params must agree with the plugin that's restored
  params.motionAlgorithm = motion ? motion.id : (ctx.motionIds.includes(p.motionAlgorithm) ? p.motionAlgorithm : 'none');
  params.triggerMethod = trigger ? trigger.id : (ctx.triggerIds.includes(p.triggerMethod) ? p.triggerMethod : 'nodeCollision');
  params.noteMapping = mapping ? mapping.id : (ctx.mappingIds.includes(p.noteMapping) ? p.noteMapping : 'angle');

  return { params, motionAlgorithm: motion, triggerMethod: trigger, noteMapping: mapping };
}

// ── Harmonic Orbit ──────────────────────────────────────────────────

function sanitizeHarmonic(src) {
  if (!isObject(src)) return undefined;
  const p = isObject(src.params) ? src.params : {};
  const params = numbers(p, {
    sides: [3, 12, 'int'], travelerSize: [0.04, 0.4], speedBpm: [2, 240],
    syncSourceIndex: [0, MAX_ORBITS - 1, 'int'], syncRatio: [0.125, 32], transposeChance: [0, 1],
    padOctave: [1, 6, 'int'], bassOctave: [1, 4, 'int'], padVolume: [0, 1], bassVolume: [0, 1],
    midiPadChannel: [1, 16, 'int'], midiBassChannel: [1, 16, 'int'],
  });
  for (const key of ['enabled', 'padEnabled', 'bassEnabled', 'midiEnabled', 'oscEnabled']) {
    if (typeof p[key] === 'boolean') params[key] = p[key];
  }
  if (p.radius === null) params.radius = null;
  else if ('radius' in p) {
    const r = num(p.radius, 0.3, 6, undefined);
    if (r !== undefined) params.radius = r;
  }
  if (['free', 'periodSync'].includes(p.speedMode)) params.speedMode = p.speedMode;
  if (PROGRESSION_IDS.includes(p.progressionId)) params.progressionId = p.progressionId;
  if (CHORD_VOICINGS.includes(p.chordVoicing)) params.chordVoicing = p.chordVoicing;

  const out = { params };
  if (isObject(src.progression) && PROGRESSION_IDS.includes(src.progression.id)) {
    out.progression = {
      id: src.progression.id,
      step: num(src.progression.step, 0, 1e6, 0, true),
      currentDegree: num(src.progression.currentDegree, 0, 11, 0, true),
      pedalCounter: num(src.progression.pedalCounter, 0, 100, 0, true),
    };
  }
  const baseRoot = noteName(src.baseRoot, undefined);
  if (baseRoot) out.baseRoot = baseRoot;
  const cyclePos = num(src.cyclePos, 0, 0.999999, undefined);
  if (cyclePos !== undefined) out.cyclePos = cyclePos;
  const pad = sanitizeSynth(src.padConfig, 'aux');
  if (pad) out.padConfig = { ...pad, mode: 'poly' };
  const bass = sanitizeSynth(src.bassConfig, 'aux');
  if (bass) out.bassConfig = { ...bass, mode: 'mono' };
  return out;
}

// ── Scene-wide sections ─────────────────────────────────────────────

function sanitizeVector(v) {
  if (!isObject(v)) return null;
  const out = {};
  for (const k of ['x', 'y', 'z']) {
    const n = num(v[k], -100, 100, undefined);
    if (n === undefined) return null;
    out[k] = n;
  }
  return out;
}

function sanitizeCamera(src) {
  if (!isObject(src)) return undefined;
  const position = sanitizeVector(src.position);
  const target = sanitizeVector(src.target);
  return position && target ? { position, target } : undefined;
}

export const VISUAL_DEFAULTS = {
  bloomStrength: 0.4, bloomRadius: 0.5, bloomThreshold: 0.45, trails: 0.25,
  vignetteDarkness: 1.0, vignetteOffset: 0.9, chromaticIntensity: 0.4,
  crossingFlash: false, spinSpeed: 0.02,
};

function sanitizeVisual(src) {
  if (!isObject(src)) return undefined;
  const out = numbers(src, {
    bloomStrength: [0, 3], bloomRadius: [0, 1], bloomThreshold: [0, 1], trails: [0, 0.95],
    vignetteDarkness: [0, 1.5], vignetteOffset: [0.5, 2], chromaticIntensity: [0, 1], spinSpeed: [0, 0.15],
  });
  if (typeof src.crossingFlash === 'boolean') out.crossingFlash = src.crossingFlash;
  return out;
}

const HOST = /^[A-Za-z0-9.\-]{1,253}$|^\[[0-9A-Fa-f:.]{2,45}\]$/;

function sanitizeIO(src) {
  if (!isObject(src)) return undefined;
  const out = {};
  if (isObject(src.midi)) {
    out.midi = numbers(src.midi, { channel: [1, 16, 'int'], noteDurationMs: [10, 2000, 'int'] });
    if (['linear', 'exponential', 'logarithmic'].includes(src.midi.velocityCurve)) out.midi.velocityCurve = src.midi.velocityCurve;
  }
  if (isObject(src.osc)) {
    out.osc = numbers(src.osc, { wsPort: [1, 65535, 'int'] });
    if (typeof src.osc.wsHost === 'string' && HOST.test(src.osc.wsHost)) out.osc.wsHost = src.osc.wsHost;
  }
  return out;
}

// ── Entry point ─────────────────────────────────────────────────────

/**
 * Validate a preset object.
 *
 * @param {any} input - parsed JSON from a file or link
 * @param {{ motionIds: string[], triggerIds: string[], mappingIds: string[],
 *           describe: (kind: 'motion'|'trigger'|'mapping', id: string) => object[] }} ctx
 *        plugin registries; `describe` returns a plugin's control descriptors
 * @returns {{ preset: object, warnings: string[] }}
 * @throws {PresetError} when the input isn't a usable soundSpace preset
 */
export function sanitizePreset(input, ctx) {
  const warnings = [];
  if (!isObject(input)) throw new PresetError('This file is not a soundSpace preset.');
  if ('app' in input && input.app !== PRESET_APP) throw new PresetError('This file is not a soundSpace preset.');
  if (typeof input.version === 'number' && input.version > PRESET_VERSION) {
    warnings.push('This preset was made with a newer version of soundSpace; some settings may be ignored.');
  }

  // The original single-orbit format
  let orbitsIn = input.orbits;
  if (!Array.isArray(orbitsIn) && isObject(input.scale) && isObject(input.synth) && Array.isArray(input.generators)) {
    orbitsIn = [{ generator: input.generators[0], scale: input.scale, synth: input.synth }];
  }
  if (!Array.isArray(orbitsIn)) throw new PresetError('This file is not a soundSpace preset.');

  const orbits = [];
  for (const o of orbitsIn) {
    if (!isObject(o) || !isObject(o.generator)) continue;
    if (orbits.length === MAX_ORBITS) {
      warnings.push(`Only the first ${MAX_ORBITS} orbits were loaded.`);
      break;
    }
    orbits.push({
      generator: sanitizeGenerator(o.generator, ctx, warnings),
      scale: sanitizeScale(o.scale),
      synth: sanitizeSynth(o.synth, 'orbit'),
      muted: bool(o.muted, false),
      solo: bool(o.solo, false),
    });
  }
  if (orbits.length === 0) throw new PresetError('This preset has no orbits to load.');

  const preset = { app: PRESET_APP, version: PRESET_VERSION, orbits };
  const camera = sanitizeCamera(input.camera);
  if (camera) preset.camera = camera;
  if (isObject(input.spatial)) {
    preset.spatial = {
      enabled: bool(input.spatial.enabled, false),
      axis: oneOf(input.spatial.axis, ['horizontal', 'vertical'], 'horizontal'),
    };
  }
  const harmonic = sanitizeHarmonic(input.harmonic);
  if (harmonic) preset.harmonic = harmonic;
  const visual = sanitizeVisual(input.visual) || {};
  // Spin speed used to be an orbit setting
  if (!('spinSpeed' in visual) && isObject(orbitsIn[0]?.generator?.params)) {
    const legacySpin = num(orbitsIn[0].generator.params.spinSpeed, 0, 0.15, undefined);
    if (legacySpin !== undefined) visual.spinSpeed = legacySpin;
  }
  if (Object.keys(visual).length) preset.visual = visual;
  const io = sanitizeIO(input.io);
  if (io) preset.io = io;

  return { preset, warnings };
}
