import { PhaseDrift } from './PhaseDrift.js';
import { HarmonicRatios } from './HarmonicRatios.js';
import { GoldenSpiral } from './GoldenSpiral.js';

const ALGORITHMS = {
  phaseDrift:       { name: 'Phase Drift', factory: () => new PhaseDrift() },
  harmonicRatios:   { name: 'Harmonic Ratios', factory: () => new HarmonicRatios() },
  goldenSpiral:     { name: 'Golden Spiral', factory: () => new GoldenSpiral() },
};

/** Get list of algorithm IDs */
export function getAlgorithmIds() {
  return Object.keys(ALGORITHMS);
}

/** Get display names for dropdown: [{id, name}] */
export function getAlgorithmNames() {
  return Object.entries(ALGORITHMS).map(([id, { name }]) => ({ id, name }));
}

/** Create an algorithm instance by ID */
export function createAlgorithm(id) {
  const entry = ALGORITHMS[id];
  if (!entry) throw new Error(`Unknown motion algorithm: ${id}`);
  return entry.factory();
}
