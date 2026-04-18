import { NoteMapping } from './NoteMapping.js';
import { angleDelta, clamp } from '../../util/math.js';

/**
 * Pitch from local node clustering density.
 * More neighbors nearby = higher pitch. Creates spatial-to-pitch mapping.
 * Pairs well with Drift Fields where nodes cluster/disperse organically.
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
    const { nodeIndexA } = trig;
    const a = nodes[nodeIndexA];
    const n = nodes.length;

    // Count neighbors within angular radius, weighted by proximity
    let density = 0;
    for (let i = 0; i < n; i++) {
      if (i === nodeIndexA) continue;
      const dist = Math.abs(angleDelta(a.angle, nodes[i].angle));
      if (dist < this.params.radius) {
        // Closer neighbors contribute more
        density += 1 - (dist / this.params.radius);
      }
    }

    // Normalize: max possible density is (n-1) if all nodes are at the same angle
    let rawValue = clamp(density / Math.max(n - 1, 1), 0, 1);

    if (this.params.invert) {
      rawValue = 1 - rawValue;
    }

    return rawValue;
  }

  getParams() {
    return [
      { key: 'radius', label: 'Radius', type: 'range', min: 0.1, max: 1.5, step: 0.05, value: this.params.radius },
      { key: 'invert', label: 'Invert', type: 'toggle', value: this.params.invert },
    ];
  }
}
