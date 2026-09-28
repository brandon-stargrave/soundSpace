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
    // Relative to the fastest node right now, so it works under every motion algorithm
    let maxSpeed = 0;
    for (const n of nodes) maxSpeed = Math.max(maxSpeed, Math.abs(n.speed));
    if (maxSpeed < 1e-6) return 0.5;
    if (nodeIndexB != null) {
      const b = nodes[nodeIndexB];
      const relSpeed = Math.abs(a.speed * a.dir - b.speed * b.dir);
      return clamp(relSpeed / (2 * maxSpeed), 0, 1);
    }
    return clamp(Math.abs(a.speed) / maxSpeed, 0, 1);
  }
}
