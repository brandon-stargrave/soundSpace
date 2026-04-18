import { NoteMapping } from './NoteMapping.js';
import { angleDelta, normalizeAngle, clamp } from '../../util/math.js';

const TWO_PI = Math.PI * 2;

/**
 * Pitch from the phase relationship between the triggering node
 * and a reference (nearest neighbor, mean, or fixed point).
 * With Phase Drift, melody slowly shifts as phases evolve.
 */
export class PhaseOffsetMapping extends NoteMapping {
  constructor() {
    super('Phase Offset', 'phaseOffset');
    this.params = {
      referenceMode: 'nearest',
    };
  }

  mapValue(trig, nodes, generatorParams) {
    const { nodeIndexA } = trig;
    const a = nodes[nodeIndexA];
    let refAngle;

    switch (this.params.referenceMode) {
      case 'mean': {
        // Mean angle of all other nodes
        let sumX = 0, sumY = 0;
        for (let i = 0; i < nodes.length; i++) {
          if (i === nodeIndexA) continue;
          sumX += Math.cos(nodes[i].angle);
          sumY += Math.sin(nodes[i].angle);
        }
        refAngle = Math.atan2(sumY, sumX);
        break;
      }
      case 'fixed':
        refAngle = 0;
        break;
      case 'nearest':
      default: {
        // Find nearest neighbor by angular distance
        let minDist = Infinity;
        refAngle = 0;
        for (let i = 0; i < nodes.length; i++) {
          if (i === nodeIndexA) continue;
          const dist = Math.abs(angleDelta(a.angle, nodes[i].angle));
          if (dist < minDist) {
            minDist = dist;
            refAngle = nodes[i].angle;
          }
        }
        break;
      }
    }

    // Phase offset normalized to 0-1
    const offset = normalizeAngle(a.angle - refAngle);
    return offset / TWO_PI;
  }

  getParams() {
    return [
      { key: 'referenceMode', label: 'Reference', type: 'select', value: this.params.referenceMode, options: ['nearest', 'mean', 'fixed'] },
    ];
  }
}
