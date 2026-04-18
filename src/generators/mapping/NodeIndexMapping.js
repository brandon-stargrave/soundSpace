import { NoteMapping } from './NoteMapping.js';
import { clamp } from '../../util/math.js';

/**
 * Pitch based on which node(s) triggered.
 * Each node has a characteristic pitch. Golden ratio spread for
 * better distribution across the scale.
 */
export class NodeIndexMapping extends NoteMapping {
  constructor() {
    super('Node Index', 'nodeIndex');
  }

  mapValue(trig, nodes, generatorParams) {
    const { nodeIndexA, nodeIndexB } = trig;
    const n = nodes.length;
    if (nodeIndexB != null) {
      return ((nodeIndexA + nodeIndexB * 1.618) % n) / n;
    }
    return nodeIndexA / n;
  }
}
