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

    // Morph progress: oscillates 0→1→0 over time
    let morphT = 0;
    if (morphRate > 0) {
      morphT = (Math.sin(this._elapsedTime * morphRate * TWO_PI) + 1) / 2;
    }

    for (let i = 0; i < n; i++) {
      // Assign ratio index based on spread mode
      let ratioIndex;
      switch (spreadMode) {
        case 'mirrored':
          // Mirror: 0,1,2,...,n/2,...,2,1,0
          ratioIndex = i < n / 2 ? i : n - 1 - i;
          break;
        case 'random':
          // Deterministic pseudo-random based on index
          ratioIndex = (i * 7 + 3) % n;
          break;
        case 'sequential':
        default:
          ratioIndex = i;
      }

      const srcRatio = sourceRatios[ratioIndex % sourceRatios.length];
      const tgtRatio = targetRatios[ratioIndex % targetRatios.length];
      const ratio = srcRatio + (tgtRatio - srcRatio) * morphT;

      this._speedBuffer[i] = baseSpeed * ratio;
    }

    return this._speedBuffer;
  }

  getParams() {
    const ratioSetNames = Object.keys(RATIO_SETS);
    return [
      { key: 'ratioSet', label: 'Ratio Set', type: 'select', value: this.params.ratioSet, options: ratioSetNames },
      { key: 'morphRate', label: 'Morph Rate', type: 'range', min: 0, max: 0.02, step: 0.001, value: this.params.morphRate },
      { key: 'morphTarget', label: 'Morph Target', type: 'select', value: this.params.morphTarget, options: ratioSetNames },
      { key: 'basePeriod', label: 'Base Period (s)', type: 'range', min: 2, max: 60, step: 0.5, value: this.params.basePeriod },
      { key: 'spreadMode', label: 'Spread', type: 'select', value: this.params.spreadMode, options: ['sequential', 'mirrored', 'random'] },
    ];
  }
}
