import { NoteMapping } from './NoteMapping.js';
import { clamp } from '../../util/math.js';

/**
 * Pitch from how energetic the triggering node is: its speed compared with
 * its own recent average (speeding up plays higher), plus its speed compared
 * with the orbit's other nodes (faster nodes sit higher). The first part
 * follows motion algorithms; the second keeps it melodic with fixed speeds.
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

  /** Track each node's average speed over time (not per note, which would depend on note rate). */
  update(deltaTime, nodes, generatorParams) {
    // Smoothing reads as a per-frame factor at 60 fps: 0.98 averages over ~0.8 s
    const tau = (1 / Math.max(1 - this.params.smoothing, 1e-4)) / 60;
    const k = 1 - Math.exp(-deltaTime / tau);
    for (let i = 0; i < nodes.length; i++) {
      const speed = Math.abs(nodes[i].speed);
      if (i >= this._averages.length) this._averages.push(speed);
      this._averages[i] += (speed - this._averages[i]) * k;
    }
  }

  mapValue(trig, nodes, generatorParams) {
    const a = nodes[trig.nodeIndexA];
    const speed = Math.abs(a.speed);
    const avg = this._averages[trig.nodeIndexA] ?? speed;
    const temporal = (speed - avg) / Math.max(avg, 0.01);

    let mean = 0;
    for (const n of nodes) mean += Math.abs(n.speed);
    mean /= Math.max(nodes.length, 1);
    const relative = (speed - mean) / Math.max(mean, 0.01);

    // 0.5 is average; above means faster than usual or than the others
    return clamp(0.5 + (temporal + 0.5 * relative) * this.params.sensitivity * 0.5, 0, 1);
  }

  getParams() {
    return [
      { key: 'smoothing', label: 'Smoothing', type: 'range', min: 0.9, max: 0.999, step: 0.001, value: this.params.smoothing },
      { key: 'sensitivity', label: 'Sensitivity', type: 'range', min: 0.5, max: 3.0, step: 0.1, value: this.params.sensitivity },
    ];
  }
}
