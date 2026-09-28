/**
 * ProgressionWalker — pluggable algorithms for stepping through a chord
 * progression. Each call to `next()` advances the internal state and returns
 * a descriptor:
 *   { degreeIndex: N } — a diatonic chord: degree N (0 = I … 6 = vii) of the
 *                        home key's 7-note scale. The key doesn't change.
 *   { semitones: S }   — a key change of S semitones from the current key
 *                        (the fifths walks). The new key's I chord plays.
 *
 * The caller (HarmonicOrbit) builds the chord from the descriptor.
 */

export const PROGRESSION_IDS = [
  'pedal',
  'romanPopAxis',
  'romanCanonical',
  'romanJazzii_v_I',
  'randomWalk',
  'fifthsUp',
  'fifthsRandom',
];

// Chord degrees: I = 0, ii = 1, iii = 2, IV = 3, V = 4, vi = 5, vii = 6
const PATTERNS = {
  romanPopAxis: [0, 4, 5, 3],     // I – V – vi – IV
  romanCanonical: [0, 3, 4, 0],   // I – IV – V – I
  romanJazzii_v_I: [1, 4, 0],     // ii – V – I
};

// Degrees a random walk settles on: I, IV, V and vi
const STABLE_DEGREES = [0, 3, 4, 5];

export class ProgressionWalker {
  constructor(id = 'pedal') {
    this.id = id;
    this.reset();
  }

  reset() {
    this._step = 0;                // step counter within a cycle
    this._currentDegree = 0;       // used by randomWalk
    this._pedalCounter = 0;        // used by pedal algorithm
  }

  /**
   * Advance and return the next descriptor.
   * @param {{ flatSeven?: boolean }} [key] - whether the home key's 7th degree
   *        is a whole step below the tonic (minor, dorian, mixolydian), which
   *        makes ♭VII a diatonic chord the pedal can visit
   */
  next(key = {}) {
    switch (this.id) {
      case 'pedal':           return this._pedal(key);
      case 'romanPopAxis':
      case 'romanCanonical':
      case 'romanJazzii_v_I': return this._cycle(PATTERNS[this.id]);
      case 'randomWalk':      return this._randomWalk();
      case 'fifthsUp':        return { semitones: 7 };
      case 'fifthsRandom':    return { semitones: Math.random() < 0.5 ? 7 : -7 };
      default:                return { degreeIndex: 0 };
    }
  }

  /** Sit on the tonic for 6 steps, then briefly visit IV, V (or ♭VII), then return. */
  _pedal(key) {
    this._pedalCounter++;
    if (this._pedalCounter > 6) {
      this._pedalCounter = 0;
      const candidates = key.flatSeven ? [3, 4, 6] : [3, 4];
      return { degreeIndex: candidates[Math.floor(Math.random() * candidates.length)] };
    }
    return { degreeIndex: 0 };
  }

  /** Step through a fixed pattern, wrapping. */
  _cycle(pattern) {
    const deg = pattern[this._step % pattern.length];
    this._step++;
    return { degreeIndex: deg };
  }

  /** Step up or down a degree (or stay), leaning back toward I, IV, V and vi. */
  _randomWalk() {
    const step = [-1, 0, 1][Math.floor(Math.random() * 3)];
    let next = (this._currentDegree + step + 7) % 7;
    if (!STABLE_DEGREES.includes(next) && Math.random() < 0.4) {
      // Nearest stable degree, measured around the circle of degrees
      let best = 0;
      let bestD = Infinity;
      for (const s of STABLE_DEGREES) {
        const d = Math.min(Math.abs(s - next), 7 - Math.abs(s - next));
        if (d < bestD) { best = s; bestD = d; }
      }
      next = best;
    }
    this._currentDegree = next;
    return { degreeIndex: next };
  }

  serialize() {
    return {
      id: this.id,
      step: this._step,
      currentDegree: this._currentDegree,
      pedalCounter: this._pedalCounter,
    };
  }

  deserialize(data) {
    if (!data) return;
    this.id = data.id ?? this.id;
    this._step = data.step ?? 0;
    this._currentDegree = data.currentDegree ?? 0;
    this._pedalCounter = data.pedalCounter ?? 0;
  }
}
