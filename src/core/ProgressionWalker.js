/**
 * ProgressionWalker — pluggable algorithms for stepping through a sequence of
 * scale-degree (or semitone) offsets from a base root. Each call to `next()`
 * advances the internal state and returns an offset descriptor:
 *   { degreeIndex: N }  — scale-degree offset (N is an index into the active scale)
 *   { semitones: S }    — raw semitone delta (for fifths / modal interchange)
 *
 * The caller (HarmonicOrbit) resolves the offset against the active scale and
 * clamps the resulting root to within ±11 semitones of the base root to
 * prevent unbounded octave drift.
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
   * Advance and return the next offset descriptor.
   * @param {number} scaleIntervalCount - length of the active scale's interval array
   */
  next(scaleIntervalCount = 7) {
    switch (this.id) {
      case 'pedal':            return this._pedal(scaleIntervalCount);
      case 'romanPopAxis':     return this._cycle([0, 4, 5, 3], scaleIntervalCount);
      case 'romanCanonical':   return this._cycle([0, 3, 4, 0], scaleIntervalCount);
      case 'romanJazzii_v_I':  return this._cycle([1, 4, 0], scaleIntervalCount);
      case 'randomWalk':       return this._randomWalk(scaleIntervalCount);
      case 'fifthsUp':         return { semitones: 7 };
      case 'fifthsRandom':     return { semitones: Math.random() < 0.5 ? 7 : -7 };
      default:                 return { degreeIndex: 0 };
    }
  }

  /** Sit on tonic for 6 steps, then briefly step to a neighbor, then return. */
  _pedal(len) {
    this._pedalCounter++;
    if (this._pedalCounter > 6) {
      this._pedalCounter = 0;
      // Random pick from {IV, v, bVII} — scale-degree indices 3, 4, 6 (clamped to scale length)
      const candidates = [3, 4, 6].filter(i => i < len);
      const pick = candidates[Math.floor(Math.random() * candidates.length)] ?? 0;
      return { degreeIndex: pick };
    }
    return { degreeIndex: 0 };
  }

  /** Step through a fixed pattern, wrapping. Each index is modded to scale length. */
  _cycle(pattern, len) {
    const deg = pattern[this._step % pattern.length] % len;
    this._step++;
    return { degreeIndex: deg };
  }

  /** Weighted ±1 random walk favoring stable degrees (0, 2, 4). */
  _randomWalk(len) {
    // Move ±1 (or stay) with modest bias toward staying on stable degrees
    const step = [-1, 0, 1][Math.floor(Math.random() * 3)];
    let next = (this._currentDegree + step + len) % len;

    // If we landed on an unstable degree (not 0, 2, or 4), roll a weighted
    // correction toward the nearest stable degree 40% of the time.
    const stableSet = new Set([0, 2, 4]);
    if (!stableSet.has(next) && Math.random() < 0.4) {
      const stable = [...stableSet].filter(d => d < len);
      let best = stable[0];
      let bestD = Math.abs(best - next);
      for (const s of stable) {
        const d = Math.abs(s - next);
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
