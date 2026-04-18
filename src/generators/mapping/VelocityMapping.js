import { NoteMapping } from './NoteMapping.js';
import { clamp } from '../../util/math.js';

/**
 * Pitch from node speed at trigger time.
 * Faster nodes produce higher notes.
 */
export class VelocityMapping extends NoteMapping {
  constructor() {
    super('Velocity', 'velocity');
  }

  mapValue(trig, nodes, generatorParams) {
    const { nodeIndexA, nodeIndexB } = trig;
    const a = nodes[nodeIndexA];
    if (nodeIndexB != null) {
      const b = nodes[nodeIndexB];
      const relSpeed = Math.abs(a.speed * a.dir - b.speed * b.dir);
      return clamp(relSpeed / (generatorParams.baseSpeed * 8), 0, 1);
    }
    return clamp(Math.abs(a.speed) / (generatorParams.baseSpeed * 4), 0, 1);
  }
}
