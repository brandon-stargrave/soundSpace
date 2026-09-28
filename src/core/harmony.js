/**
 * Harmony helpers for the Harmonic Orbit: which 7-note key a scale belongs
 * to, the diatonic chord on each degree, smooth chord voicing, and key-change
 * offsets. Pure functions, so they can be unit-tested.
 */

import { SCALES } from '../util/constants.js';

/** Chord shapes as steps through the 7-note scale from the chord's root. */
const VOICING_STEPS = {
  triad: [0, 2, 4],
  sus2: [0, 1, 4],
  sus4: [0, 3, 4],
  seventh: [0, 2, 4, 6],
  // Root and fifth, then root and third an octave up
  octaveDoubled: [0, 4, 7, 9],
};

/**
 * The 7-note key a scale belongs to. Seven-note scales are their own key;
 * pentatonics, blues and other scales map to the major or minor mode that
 * contains them, so chords can be built in thirds.
 * @param {number[]} intervals - semitones from the root
 */
export function parentScale(intervals) {
  if (intervals.length === 7) return [...intervals];
  const has = (s) => intervals.includes(s);
  if (has(4)) return has(10) && !has(11) ? [...SCALES.mixolydian] : [...SCALES.major];
  return has(9) && !has(8) ? [...SCALES.dorian] : [...SCALES.minor_natural];
}

/** Whether the key's 7th degree is a whole step below the tonic (so ♭VII is diatonic). */
export function hasFlatSeven(parent) {
  return parent[6] === 10;
}

/** Whether the key's I chord is minor (a minor third above the tonic). */
export function isMinorKey(parent) {
  return parent[2] === 3;
}

/**
 * The chord on a degree of a 7-note key, as semitones from the tonic
 * (ascending, may run past 12).
 * @param {number[]} parent - 7-note scale
 * @param {number} degree - 0 = I … 6 = vii
 * @param {string} voicing - one of VOICING_STEPS
 */
export function diatonicChord(parent, degree, voicing = 'triad') {
  const steps = VOICING_STEPS[voicing] || VOICING_STEPS.triad;
  return steps.map((s) => {
    const idx = degree + s;
    return parent[idx % 7] + 12 * Math.floor(idx / 7);
  });
}

/** The chord's root, as semitones from the tonic (0–11). */
export function chordRoot(parent, degree) {
  return parent[degree % 7];
}

/** A key change as the nearest move: -6 … +5 semitones, so the register never jumps more than a tritone. */
export function nearestOffset(semitones) {
  return (((semitones % 12) + 12 + 6) % 12) - 6;
}

/**
 * Choose the octave placement of a chord that stays closest to `center`
 * (usually the previous chord's middle), trying each inversion. Keeps pad
 * changes smooth instead of jumping to root position every time.
 * @param {number[]} offsets - chord tones, semitones from the tonic
 * @param {number} tonicMidi - MIDI note of the tonic in the pad's octave
 * @param {number} center - MIDI pitch the chord should sit around
 * @returns {number[]} MIDI notes, ascending
 */
export function voiceChord(offsets, tonicMidi, center) {
  const base = offsets.map((o) => tonicMidi + o).sort((a, b) => a - b);
  let best = base;
  let bestScore = Infinity;
  for (const shift of [-12, 0, 12]) {
    for (let k = 0; k < base.length; k++) {
      // Inversion k: the lowest k notes move up an octave
      const notes = base.map((n, i) => n + shift + (i < k ? 12 : 0)).sort((a, b) => a - b);
      if (notes[0] < 24 || notes[notes.length - 1] > 108) continue;
      const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
      const score = Math.abs(mean - center);
      if (score < bestScore - 1e-9) {
        best = notes;
        bestScore = score;
      }
    }
  }
  return best;
}

/**
 * Voice a chord near the previous one, but aim no further than `drift`
 * semitones from the register the tonic sets (around its fifth). Without the
 * limit, a progression that keeps moving one way (the circle of fifths)
 * carries the chord an octave away from where it was set.
 * @param {number|null} previousCenter - average pitch of the last chord, or null
 */
export function voiceChordInRegister(offsets, tonicMidi, previousCenter, drift = 4) {
  const anchor = tonicMidi + 7;
  const center = Math.max(anchor - drift, Math.min(anchor + drift, previousCenter ?? anchor));
  return voiceChord(offsets, tonicMidi, center);
}

/** The bass note for a chord root, within a fourth or fifth of the key's bass tonic. */
export function bassNote(tonicMidi, rootOffset) {
  return tonicMidi + nearestOffset(rootOffset);
}
