import { MotionAlgorithm } from './MotionAlgorithm.js';

const TWO_PI = Math.PI * 2;

/**
 * Speed ratios locked to musical intervals.
 * Creates periodic crossing patterns whose cycle lengths are determined
 * by the LCM of the ratios. Can morph between ratio sets over time.
 */

const RATIO_SETS = {
  fifths:         [1, 3/2, 2, 3, 4, 9/2, 6, 8, 9, 12, 16, 18, 24, 27, 32, 36],
  fourths:        [1, 4/3, 2, 8/3, 4, 16/3, 8, 32/3, 16, 64/3, 32, 128/3, 64, 256/3, 128, 512/3],
  thirds:         [1, 5/4, 3/2, 5/3, 2, 5/2, 3, 10/3, 4, 5, 6, 20/3, 8, 10, 12, 40/3],
  justIntonation: [1, 9/8, 5/4, 4/3, 3/2, 5/3, 15/8, 2, 9/4, 5/2, 8/3, 3, 10/3, 15/4, 4, 9/2],
  pythagorean:    [1, 9/8, 81/64, 4/3, 3/2, 27/16, 243/128, 2, 9/4, 81/32, 8/3, 3, 27/8, 243/64, 4, 9/2],
};

// Fastest node relative to the base: keeps high node counts playable
const MAX_RATIO = 8;

/** Which ratio a node gets. 'random' is a fixed shuffle that uses every ratio once. */
function spreadIndex(mode, i, n) {
  switch (mode) {
    case 'mirrored':
      return i < n / 2 ? i : n - 1 - i;
    case 'random': {
      // A multiplier coprime with n makes (i * m + 3) mod n a permutation
      const m = [7, 5, 11, 13, 3].find(c => gcd(c, n) === 1) ?? 1;
      return (i * m + 3) % n;
    }
    case 'sequential':
    default:
      return i;
  }
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

const RATIO_LABELS = {
  fifths: 'Fifths', fourths: 'Fourths', thirds: 'Thirds',
  justIntonation: 'Just intonation', pythagorean: 'Pythagorean',
};

export class HarmonicRatios extends MotionAlgorithm {
  constructor() {
    super('Harmonic Ratios', 'harmonicRatios');
    this.params = {
      ratioSet: 'fifths',
      morphRate: 0.005,
      morphTarget: 'fourths',
      basePeriod: 10,
      spreadMode: 'sequential',
    };
  }

  computeSpeeds(deltaTime, nodes, generatorParams) {
    this._elapsedTime += deltaTime;
    const { ratioSet, morphRate, morphTarget, basePeriod, spreadMode } = this.params;
    const baseSpeed = TWO_PI / basePeriod;
    const n = nodes.length;

    const sourceRatios = RATIO_SETS[ratioSet] || RATIO_SETS.fifths;
    const targetRatios = RATIO_SETS[morphTarget] || RATIO_SETS.fourths;

    // Morph progress: starts on the chosen set, then swings to the target and back
    let morphT = 0;
    if (morphRate > 0) {
      morphT = (1 - Math.cos(this._elapsedTime * morphRate * TWO_PI)) / 2;
    }

    const ratios = this._ratioBuffer?.length === n ? this._ratioBuffer : (this._ratioBuffer = new Float64Array(n));
    let maxRatio = 1;
    for (let i = 0; i < n; i++) {
      const ratioIndex = spreadIndex(spreadMode, i, n);
      const srcRatio = sourceRatios[ratioIndex % sourceRatios.length];
      const tgtRatio = targetRatios[ratioIndex % targetRatios.length];
      ratios[i] = srcRatio + (tgtRatio - srcRatio) * morphT;
      maxRatio = Math.max(maxRatio, ratios[i]);
    }

    // The sets grow fast (up to 170x at 16 nodes). Past MAX_RATIO, compress
    // the ratios on a power curve: the order and the base speed are kept, the
    // fastest node stays at MAX_RATIO times the base
    const k = maxRatio > MAX_RATIO ? Math.log(MAX_RATIO) / Math.log(maxRatio) : 1;
    for (let i = 0; i < n; i++) {
      this._speedBuffer[i] = baseSpeed * Math.pow(ratios[i], k);
    }

    return this._speedBuffer;
  }

  getParams() {
    const ratioSetNames = Object.keys(RATIO_SETS);
    return [
      { key: 'ratioSet', label: 'Ratio Set', type: 'select', value: this.params.ratioSet, options: ratioSetNames, optionLabels: RATIO_LABELS },
      { key: 'morphRate', label: 'Morph Rate', type: 'range', min: 0, max: 0.02, step: 0.001, value: this.params.morphRate },
      { key: 'morphTarget', label: 'Morph Target', type: 'select', value: this.params.morphTarget, options: ratioSetNames, optionLabels: RATIO_LABELS },
      { key: 'basePeriod', label: 'Base Period (s)', type: 'range', min: 2, max: 60, step: 0.5, value: this.params.basePeriod },
      { key: 'spreadMode', label: 'Spread', type: 'select', value: this.params.spreadMode, options: ['sequential', 'mirrored', 'random'],
        optionLabels: { sequential: 'In order', mirrored: 'Mirrored', random: 'Shuffled' } },
    ];
  }
}
