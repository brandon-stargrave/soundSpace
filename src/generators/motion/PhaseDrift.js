import { MotionAlgorithm } from './MotionAlgorithm.js';

const TWO_PI = Math.PI * 2;

/**
 * Reich-inspired phase drift.
 * All nodes orbit at nearly identical speed with tiny epsilon offsets,
 * causing gradual phase separation that creates evolving interference patterns.
 */
export class PhaseDrift extends MotionAlgorithm {
  constructor() {
    super('Phase Drift', 'phaseDrift');
    this.params = {
      basePeriod: 12,
      driftRate: 0.008,
      driftCurve: 'linear',
      stageLength: 60,
      realignStrength: 0.0,
      driftModRate: 0.02,
    };
    this._stageCount = 0;
  }

  init(nodes, generatorParams) {
    super.init(nodes, generatorParams);
    this._stageCount = 0;
  }

  computeSpeeds(deltaTime, nodes, generatorParams) {
    this._elapsedTime += deltaTime;
    const { basePeriod, driftRate, driftCurve, stageLength, realignStrength, driftModRate } = this.params;
    const baseSpeed = TWO_PI / basePeriod;
    const n = nodes.length;

    // Stage tracking — drift can reverse direction at stage boundaries
    this._stageCount = Math.floor(this._elapsedTime / stageLength);
    const stagePhase = (this._elapsedTime % stageLength) / stageLength; // 0-1 within stage
    const stageDir = this._stageCount % 2 === 0 ? 1 : -1; // alternate direction

    // Drift curve multiplier
    let curveMultiplier;
    switch (driftCurve) {
      case 'exponential':
        curveMultiplier = 1 + stagePhase * 2;
        break;
      case 'sinusoidal':
        curveMultiplier = Math.sin(stagePhase * Math.PI);
        break;
      case 'linear':
      default:
        curveMultiplier = 1;
    }

    // Meta-modulation: slowly modulate the drift rate itself
    let driftMod = 1;
    if (driftModRate > 0) {
      driftMod = 1 + Math.sin(this._elapsedTime * driftModRate * TWO_PI) * 0.5;
    }

    // Compute mean angle for realignment force
    let meanAngle = 0;
    if (realignStrength > 0) {
      let sumX = 0, sumY = 0;
      for (const node of nodes) {
        sumX += Math.cos(node.angle);
        sumY += Math.sin(node.angle);
      }
      meanAngle = Math.atan2(sumY / n, sumX / n);
    }

    for (let i = 0; i < n; i++) {
      // Each node gets a progressively larger epsilon offset
      let epsilon = driftRate * i * stageDir * curveMultiplier * driftMod;

      // Realignment: gentle pull toward mean angle
      if (realignStrength > 0) {
        let delta = meanAngle - nodes[i].angle;
        // Normalize to [-PI, PI]
        while (delta > Math.PI) delta -= TWO_PI;
        while (delta < -Math.PI) delta += TWO_PI;
        epsilon += delta * realignStrength * 0.1;
      }

      this._speedBuffer[i] = baseSpeed + epsilon;
    }

    return this._speedBuffer;
  }

  getParams() {
    return [
      { key: 'basePeriod', label: 'Base Period (s)', type: 'range', min: 2, max: 60, step: 0.5, value: this.params.basePeriod },
      { key: 'driftRate', label: 'Drift Rate', type: 'range', min: 0.001, max: 0.05, step: 0.001, value: this.params.driftRate },
      { key: 'driftCurve', label: 'Drift Shape', type: 'select', value: this.params.driftCurve, options: ['linear', 'exponential', 'sinusoidal'] },
      { key: 'stageLength', label: 'Stage Length (s)', type: 'range', min: 10, max: 300, step: 5, value: this.params.stageLength },
      { key: 'realignStrength', label: 'Re-align Pull', type: 'range', min: 0, max: 0.5, step: 0.01, value: this.params.realignStrength },
      { key: 'driftModRate', label: 'Drift Modulation', type: 'range', min: 0, max: 0.1, step: 0.005, value: this.params.driftModRate },
    ];
  }
}
