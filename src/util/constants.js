// ── Scale Definitions ────────────────────────────────────────────
// Each scale is an array of semitone offsets from the root note.

export const SCALES = {
  // Standard
  major:             [0, 2, 4, 5, 7, 9, 11],
  minor_natural:     [0, 2, 3, 5, 7, 8, 10],
  minor_harmonic:    [0, 2, 3, 5, 7, 8, 11],
  minor_melodic:     [0, 2, 3, 5, 7, 9, 11],
  pentatonic_major:  [0, 2, 4, 7, 9],
  pentatonic_minor:  [0, 3, 5, 7, 10],
  blues:             [0, 3, 5, 6, 7, 10],
  chromatic:         [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  whole_tone:        [0, 2, 4, 6, 8, 10],
  diminished:        [0, 2, 3, 5, 6, 8, 9, 11],

  // Modes
  dorian:            [0, 2, 3, 5, 7, 9, 10],
  phrygian:          [0, 1, 3, 5, 7, 8, 10],
  lydian:            [0, 2, 4, 6, 7, 9, 11],
  mixolydian:        [0, 2, 4, 5, 7, 9, 10],
  aeolian:           [0, 2, 3, 5, 7, 8, 10],
  locrian:           [0, 1, 3, 5, 6, 8, 10],

  // Exotic
  japanese:          [0, 1, 5, 7, 8],
  arabian:           [0, 2, 4, 5, 6, 8, 10],
  hungarian_minor:   [0, 2, 3, 6, 7, 8, 11],
  persian:           [0, 1, 4, 5, 6, 8, 11],
  bebop_dominant:    [0, 2, 4, 5, 7, 9, 10, 11],
};

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const NOTE_NAME_TO_SEMITONE = {
  'C': 0, 'C#': 1, 'Db': 1,
  'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'Fb': 4,
  'F': 5, 'F#': 6, 'Gb': 6,
  'G': 7, 'G#': 8, 'Ab': 8,
  'A': 9, 'A#': 10, 'Bb': 10,
  'B': 11, 'Cb': 11,
};

// ── Neon Palette ─────────────────────────────────────────────────
// Default palette (orbit 0 / legacy)
export const NEON_PALETTE = [
  0x2288ff,  // blue
  0xff00ff,  // magenta
  0x00ff41,  // matrix green
  0xff6600,  // orange
  0xaa00ff,  // purple
  0xffff00,  // yellow
  0xff0066,  // hot pink
  0x00aaff,  // electric blue
  0xff3333,  // neon red
  0x33ff99,  // mint
  0xff9900,  // amber
  0x6600ff,  // indigo
  0x00ffcc,  // teal
  0xff0099,  // fuchsia
  0x99ff00,  // lime
  0x3366ff,  // royal blue
];

// Per-orbit color generation — fully saturated hues at decreasing value
// Each orbit gets a unique set of hues, shifted so orbits don't overlap
// Saturation stays at 100%, value decreases with each ring

/**
 * Generate a palette of N fully saturated colors at a given value (brightness).
 * Hues are evenly distributed around the color wheel, offset by orbitIndex.
 */
function generateOrbitPalette(orbitIndex, count = 16) {
  const palette = [];
  // Value decreases per orbit: 1.0, 0.82, 0.65, 0.50, 0.38
  const value = [1.0, 0.82, 0.65, 0.50, 0.38][orbitIndex] || Math.max(0.3, 1.0 - orbitIndex * 0.18);
  // Offset hue start per orbit so each ring has distinct hues
  const hueOffset = orbitIndex * 137.508; // golden angle in degrees — maximally spread
  for (let i = 0; i < count; i++) {
    const hue = ((i / count) * 360 + hueOffset) % 360;
    palette.push(hsvToHex(hue, 1.0, value));
  }
  return palette;
}

function hsvToHex(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r, g, b;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  const ri = Math.round((r + m) * 255);
  const gi = Math.round((g + m) * 255);
  const bi = Math.round((b + m) * 255);
  return (ri << 16) | (gi << 8) | bi;
}

export const ORBIT_PALETTES = [
  generateOrbitPalette(0),
  generateOrbitPalette(1),
  generateOrbitPalette(2),
  generateOrbitPalette(3),
  generateOrbitPalette(4),
];

// ── Defaults ─────────────────────────────────────────────────────

export const DEFAULT_SCALE_CONFIG = {
  root: 'C',
  scaleType: 'pentatonic_minor',
  octaveLow: 3,
  octaveHigh: 5,
  mappingMode: 'linear',
  customDegrees: null,
};

export const DEFAULT_SYNTH_CONFIG = {
  synthType: 'Synth',
  noteDuration: '16n',
  velocityScale: 0.8,
  synthOptions: {
    oscillator: { type: 'triangle' },
    envelope: { attack: 0.025, decay: 0.3, sustain: 0.1, release: 0.8 },
  },
  effects: [
    { type: 'Filter', wet: 1.0, options: { frequency: 2000, type: 'lowpass', rolloff: -12, Q: 1 } },
    { type: 'Chorus', wet: 0.3, options: { frequency: 1.5, delayTime: 3.5, depth: 0.7 } },
    { type: 'Reverb', wet: 0.4, options: { decay: 2.5, preDelay: 0.01 } },
    { type: 'FeedbackDelay', wet: 0.2, options: { delayTime: '8n', feedback: 0.3 } },
    { type: 'EQ3', wet: 1.0, options: { low: 0, mid: 0, high: 0, lowFrequency: 400, highFrequency: 2500 } },
  ],
};

// Pad voice — slow-attack sustained chord synth for harmonic orbit drones
export const DEFAULT_PAD_SYNTH_CONFIG = {
  mode: 'poly',
  synthType: 'AMSynth',
  synthOptions: {
    harmonicity: 2.5,
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 1.5, decay: 0.8, sustain: 0.8, release: 3.0 },
    modulation: { type: 'sine' },
    modulationEnvelope: { attack: 2.0, decay: 0.5, sustain: 0.5, release: 2.0 },
  },
  effects: [
    { type: 'Filter', wet: 1.0, options: { frequency: 900, type: 'lowpass', rolloff: -12, Q: 1 } },
    { type: 'Chorus', wet: 0.6, options: { frequency: 0.6, delayTime: 6, depth: 0.8 } },
    { type: 'Reverb', wet: 0.5, options: { decay: 4.5, preDelay: 0.03 } },
    { type: 'EQ3', wet: 1.0, options: { low: -3, mid: 0, high: -2, lowFrequency: 300, highFrequency: 3000 } },
  ],
};

// Bass voice — fast-attack sustained sub drone
export const DEFAULT_BASS_SYNTH_CONFIG = {
  mode: 'mono',
  synthType: 'MonoSynth',
  synthOptions: {
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.05, decay: 0.2, sustain: 0.9, release: 0.8 },
    filter: { Q: 2, type: 'lowpass', rolloff: -24 },
    filterEnvelope: { attack: 0.1, decay: 0.3, sustain: 0.6, release: 1.0, baseFrequency: 200, octaves: 2 },
  },
  effects: [
    { type: 'Filter', wet: 1.0, options: { frequency: 260, type: 'lowpass', rolloff: -24, Q: 2 } },
    { type: 'Chorus', wet: 0.15, options: { frequency: 0.3, delayTime: 8, depth: 0.4 } },
    { type: 'Reverb', wet: 0.2, options: { decay: 2.0, preDelay: 0.01 } },
    { type: 'EQ3', wet: 1.0, options: { low: 3, mid: 0, high: -6, lowFrequency: 200, highFrequency: 1500 } },
  ],
};
