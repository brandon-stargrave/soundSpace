import { NoteMapping } from './NoteMapping.js';
import { normalizeAngle } from '../../util/math.js';

/**
 * Pitch from the triggering node's rank in the current angular ordering.
 * As nodes pass each other and swap rank, the melody rearranges.
 * Pairs well with Phase Drift where ranks slowly shift.
 */
export class RelativePositionMapping extends NoteMapping {
  constructor() {
    super('Relative Position', 'relativePosition');
  }

  mapValue(trig, nodes, generatorParams) {
    const { nodeIndexA } = trig;
    const a = nodes[nodeIndexA];

    // Sort all nodes by their current angle and find rank of the triggering node
    const angles = nodes.map((n, i) => ({ angle: normalizeAngle(n.angle), index: i }));
    angles.sort((a, b) => a.angle - b.angle);

    const rank = angles.findIndex(entry => entry.index === nodeIndexA);

    // Normalize rank to 0-1
    return rank / Math.max(nodes.length - 1, 1);
  }
}
