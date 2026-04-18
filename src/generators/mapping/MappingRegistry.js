import { AngleMapping } from './AngleMapping.js';
import { NodeIndexMapping } from './NodeIndexMapping.js';
import { VelocityMapping } from './VelocityMapping.js';
import { PhaseOffsetMapping } from './PhaseOffsetMapping.js';
import { CumulativePhaseMapping } from './CumulativePhaseMapping.js';
import { DensityMapping } from './DensityMapping.js';
import { EnergyMapping } from './EnergyMapping.js';
import { RelativePositionMapping } from './RelativePositionMapping.js';

const MAPPINGS = {
  angle:            { name: 'Angle', factory: () => new AngleMapping() },
  nodeIndex:        { name: 'Node Index', factory: () => new NodeIndexMapping() },
  velocity:         { name: 'Velocity', factory: () => new VelocityMapping() },
  phaseOffset:      { name: 'Phase Offset', factory: () => new PhaseOffsetMapping() },
  cumulativePhase:  { name: 'Cumulative Phase', factory: () => new CumulativePhaseMapping() },
  density:          { name: 'Density', factory: () => new DensityMapping() },
  energy:           { name: 'Energy', factory: () => new EnergyMapping() },
  relativePosition: { name: 'Relative Position', factory: () => new RelativePositionMapping() },
};

export function getMappingIds() {
  return Object.keys(MAPPINGS);
}

export function getMappingNames() {
  return Object.entries(MAPPINGS).map(([id, { name }]) => ({ id, name }));
}

export function createMapping(id) {
  const entry = MAPPINGS[id];
  if (!entry) throw new Error(`Unknown note mapping: ${id}`);
  return entry.factory();
}
