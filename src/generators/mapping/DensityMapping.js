import { NoteMapping } from './NoteMapping.js';
import { angleDelta, clamp } from '../../util/math.js';

/**
 * Pitch from local node clustering density.
 * More neighbors nearby = higher pitch. Creates spatial-to-pitch mapping.
 * Pairs well with Phase Drift, where nodes bunch up and spread out.
 */
export class DensityMapping extends NoteMapping {
  constructor() {
    super('Density', 'density');
    this.params = {
      radius: 0.5,
      invert: false,
    };
  }

  mapValue(trig, nodes, generatorParams) {
    const { nodeIndexA, nodeIndexB } = trig;
    const a = nodes[nodeIndexA];
    const n = nodes.length;
    // Leave out the collision partner, which is always right there
    const others = Math.max(n - (nodeIndexB != null ? 2 : 1), 1);

    // Count neighbors within angular radius, weighted by proximity
    let density = 0;
    for (let i = 0; i < n; i++) {
      if (i === nodeIndexA || i === nodeIndexB) continue;
      const dist = Math.abs(angleDelta(a.angle, nodes[i].angle));
      if (dist < this.params.radius) {
        // Closer neighbors contribute more
        density += 1 - (dist / this.params.radius);
      }
    }

    // Normalize: max possible density is (n-1) if all nodes are at the same angle
    let rawValue = clamp(density / others, 0, 1);

    if (this.params.invert) {
      rawValue = 1 - rawValue;
    }

    return rawValue;
  }

  getParams() {
    return [
      { key: 'radius', label: 'Neighbor Range', type: 'range', min: 0.1, max: 1.5, step: 0.05, value: this.params.radius,
        help: 'How close (in radians) another node must be to count as a neighbor.' },
      { key: 'invert', label: 'Invert', type: 'toggle', value: this.params.invert },
    ];
  }
}
