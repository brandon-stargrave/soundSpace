import { MotionAlgorithm } from './MotionAlgorithm.js';

const TWO_PI = Math.PI * 2;

/**
 * Speed ratios derived from irrational numbers — the system never
 * exactly repeats. Fibonacci-based structural proportions create
 * aesthetically balanced evolution over infinite timescales.
 */

const IRRATIONAL_BASES = {
  phi:    (1 + Math.sqrt(5)) / 2,  // 1.618... golden ratio
  pi:     Math.PI,                   // 3.14159...
  sqrt2:  Math.sqrt(2),              // 1.41421...
  e:      Math.E,                    // 2.71828...
  silver: 1 + Math.sqrt(2),         // 2.41421... silver ratio
};

// Fibonacci sequence for structural indexing (read at offset 2, so 16 nodes need 18 terms)
const FIB = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1597];

export class GoldenSpiral extends MotionAlgorithm {
  constructor() {
    super('Golden Spiral', 'goldenSpiral');
    this.params = {
      irrationalBase: 'phi',
      basePeriod: 15,
      powerSpread: 1.0,
      fibStructure: true,
      breathRate: 0.003,
      breathDepth: 0.15,
    };
  }

  computeSpeeds(deltaTime, nodes, generatorParams) {
    this._elapsedTime += deltaTime;
    const { irrationalBase, basePeriod, powerSpread, fibStructure, breathRate, breathDepth } = this.params;
    const base = IRRATIONAL_BASES[irrationalBase] || IRRATIONAL_BASES.phi;
    const n = nodes.length;

    // Base speed with optional slow "breathing" modulation
    let baseSpeed = TWO_PI / basePeriod;
    if (breathRate > 0) {
      const breathMod = 1 + Math.sin(this._elapsedTime * breathRate * TWO_PI) * breathDepth;
      baseSpeed *= breathMod;
    }

    for (let i = 0; i < n; i++) {
      // Position in [0, (n-1)/n]: the linear index, or Fibonacci spacing
      // (0, 1, 2, 4, 7, 12, …) normalized into the same range so the
      // exponent stays bounded at any node count
      const t = fibStructure
        ? ((FIB[i + 2] - 1) / Math.max(FIB[n + 1] - 1, 1)) * ((n - 1) / n)
        : i / n;

      // Ratio: base^(t * powerSpread) — speeds spread logarithmically across the irrational base
      const ratio = Math.pow(base, t * powerSpread);

      this._speedBuffer[i] = baseSpeed * ratio;
    }

    return this._speedBuffer;
  }

  getParams() {
    return [
      { key: 'irrationalBase', label: 'Base Ratio', type: 'select', value: this.params.irrationalBase, options: Object.keys(IRRATIONAL_BASES) },
      { key: 'basePeriod', label: 'Base Period (s)', type: 'range', min: 2, max: 60, step: 0.5, value: this.params.basePeriod },
      { key: 'powerSpread', label: 'Power Spread', type: 'range', min: 0.1, max: 2.0, step: 0.05, value: this.params.powerSpread },
      { key: 'fibStructure', label: 'Fibonacci Index', type: 'toggle', value: this.params.fibStructure },
      { key: 'breathRate', label: 'Breath Rate', type: 'range', min: 0, max: 0.01, step: 0.001, value: this.params.breathRate },
      { key: 'breathDepth', label: 'Breath Depth', type: 'range', min: 0, max: 0.5, step: 0.01, value: this.params.breathDepth },
    ];
  }
}
