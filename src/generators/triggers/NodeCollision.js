import { TriggerMethod } from './TriggerMethod.js';
import { angleDelta, normalizeAngle, clamp } from '../../util/math.js';

const TWO_PI = Math.PI * 2;

/**
 * Original trigger method: notes fire when two nodes physically cross
 * each other's angular position on the orbit ring.
 */
export class NodeCollision extends TriggerMethod {
  constructor() {
    super('Node Collision', 'nodeCollision');
    this.params = {
      cooldownMs: 80,
    };
    this._cooldowns = new Map();
  }

  init(nodes, generatorParams, sceneGroup) {
    this._cooldowns.clear();
  }

  detectTriggers(deltaTime, nodes, generatorParams) {
    const triggers = [];
    const now = performance.now();

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (this._detectCrossing(i, j, nodes, generatorParams, now)) {
          triggers.push(this._buildTrigger(i, j, nodes, generatorParams));
        }
      }
    }

    return triggers;
  }

  _detectCrossing(i, j, nodes, gp, now) {
    const a = nodes[i];
    const b = nodes[j];

    // Angular crossing: delta changed sign. angleDelta also flips sign when the
    // nodes are opposite each other (±π), so only a flip near zero counts.
    const prevDelta = angleDelta(a.prevAngle, b.prevAngle);
    const currDelta = angleDelta(a.angle, b.angle);
    if (Math.abs(prevDelta) > Math.PI / 2 || Math.abs(currDelta) > Math.PI / 2) return false;
    if (!((prevDelta > 0 && currDelta <= 0) || (prevDelta < 0 && currDelta >= 0))) {
      return false;
    }

    // Cooldown
    const pairKey = `${i}-${j}`;
    const lastTrigger = this._cooldowns.get(pairKey) || 0;
    if (now - lastTrigger < this.params.cooldownMs) return false;
    this._cooldowns.set(pairKey, now);
    return true;
  }

  _buildTrigger(i, j, nodes, gp) {
    const a = nodes[i];
    const b = nodes[j];

    const crossX = (a.mesh.position.x + b.mesh.position.x) / 2;
    const crossY = (a.mesh.position.y + b.mesh.position.y) / 2;

    // Produce the natural crossing angle as rawValue
    // OrbitalNodes._emitTriggerFromDescriptor will apply noteMapping
    const rawValue = normalizeAngle((a.angle + b.angle) / 2) / TWO_PI;

    const relativeSpeed = Math.abs(a.speed * a.dir - b.speed * b.dir);
    const maxSpeed = gp.baseSpeed * 10;
    const velocity = clamp(relativeSpeed / maxSpeed, 0.2, 1.0);

    return {
      nodeIndexA: i,
      nodeIndexB: j,
      rawValue,
      velocity,
      position: { x: crossX, y: crossY },
    };
  }

  getParams() {
    return [
      { key: 'cooldownMs', label: 'Cooldown (ms)', type: 'range', min: 0, max: 500, step: 10, value: this.params.cooldownMs },
    ];
  }

  dispose() {
    this._cooldowns.clear();
  }
}
