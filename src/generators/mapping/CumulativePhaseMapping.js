import { NoteMapping } from './NoteMapping.js';
import { clamp } from '../../util/math.js';

const TWO_PI = Math.PI * 2;

/**
 * Pitch walks through the scale as a node orbits.
 * rawValue from total accumulated angle modulo a configurable range.
 * With irrational speed ratios, each orbit pass hits different notes.
 */
export class CumulativePhaseMapping extends NoteMapping {
  constructor() {
    super('Cumulative Phase', 'cumulativePhase');
    this.params = {
      cycleLength: 3,
      direction: 'ascending',
    };
    this._accumulators = [];
    this._prevAngles = [];
  }

  init(nodes, generatorParams) {
    // Track cumulative angle per node
    this._accumulators = nodes.map(() => 0);
    this._prevAngles = nodes.map(n => n.angle);
  }

  // Accumulate every frame: a node can travel more than half a lap between
  // triggers, and sampling only at triggers would wrap that travel away
  update(deltaTime, nodes, generatorParams) {
    for (let i = 0; i < nodes.length; i++) {
      if (i >= this._accumulators.length) {
        this._accumulators.push(0);
        this._prevAngles.push(nodes[i].angle);
      }
      let delta = nodes[i].angle - this._prevAngles[i];
      // Handle wrapping
      if (delta > Math.PI) delta -= TWO_PI;
      if (delta < -Math.PI) delta += TWO_PI;
      this._accumulators[i] += Math.abs(delta);
      this._prevAngles[i] = nodes[i].angle;
    }
  }

  mapValue(trig, nodes, generatorParams) {
    const totalAngle = this._accumulators[trig.nodeIndexA] || 0;
    const cycleRadians = this.params.cycleLength * TWO_PI;
    let phase = (totalAngle % cycleRadians) / cycleRadians; // 0-1

    switch (this.params.direction) {
      case 'descending':
        phase = 1 - phase;
        break;
      case 'pendulum':
        // Triangle wave: 0→1→0→1...
        phase = phase * 2;
        if (phase > 1) phase = 2 - phase;
        break;
      case 'ascending':
      default:
        break;
    }

    return clamp(phase, 0, 1);
  }

  getParams() {
    return [
      { key: 'cycleLength', label: 'Cycle (orbits)', type: 'range', min: 1, max: 8, step: 0.5, value: this.params.cycleLength },
      { key: 'direction', label: 'Direction', type: 'select', value: this.params.direction, options: ['ascending', 'descending', 'pendulum'] },
    ];
  }
}
