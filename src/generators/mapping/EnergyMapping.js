import { NoteMapping } from './NoteMapping.js';
import { clamp } from '../../util/math.js';

/**
 * Pitch from node's current speed relative to its running average.
 * LFO-driven speed variations directly sculpt melody contour.
 * Pairs well with Modulation Stacks and Euclidean Rhythms.
 */
export class EnergyMapping extends NoteMapping {
  constructor() {
    super('Energy', 'energy');
    this.params = {
      smoothing: 0.98,
      sensitivity: 1.5,
    };
    this._averages = [];
  }

  init(nodes, generatorParams) {
    this._averages = nodes.map(n => Math.abs(n.speed));
  }

  mapValue(trig, nodes, generatorParams) {
    const { nodeIndexA } = trig;
    const a = nodes[nodeIndexA];
    const currentSpeed = Math.abs(a.speed);

    // Ensure averages array is big enough
    while (this._averages.length <= nodeIndexA) {
      this._averages.push(currentSpeed);
    }

    // Update running average
    const avg = this._averages[nodeIndexA];
    this._averages[nodeIndexA] = avg * this.params.smoothing + currentSpeed * (1 - this.params.smoothing);

    // Deviation from average, scaled by sensitivity
    const deviation = (currentSpeed - this._averages[nodeIndexA]) / Math.max(this._averages[nodeIndexA], 0.01);
    // Map deviation to 0-1: 0.5 is average, >0.5 is above average, <0.5 is below
    const rawValue = 0.5 + deviation * this.params.sensitivity * 0.5;

    return clamp(rawValue, 0, 1);
  }

  getParams() {
    return [
      { key: 'smoothing', label: 'Smoothing', type: 'range', min: 0.9, max: 0.999, step: 0.001, value: this.params.smoothing },
      { key: 'sensitivity', label: 'Sensitivity', type: 'range', min: 0.5, max: 3.0, step: 0.1, value: this.params.sensitivity },
    ];
  }
}
