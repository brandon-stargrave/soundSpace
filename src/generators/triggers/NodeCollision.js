import { TriggerMethod } from './TriggerMethod.js';
import { countPasses, circularMidpoint } from '../../util/math.js';
import { noteVelocity } from './velocity.js';

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

    // Loudness is relative to the fastest pair in this orbit right now
    let maxRel = 0;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        maxRel = Math.max(maxRel, Math.abs(nodes[i].speed * nodes[i].dir - nodes[j].speed * nodes[j].dir));
      }
    }

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        if (this._detectCrossing(i, j, nodes, now)) {
          triggers.push(this._buildTrigger(i, j, nodes, maxRel));
        }
      }
    }

    return triggers;
  }

  /**
   * A pair crosses when their separation passes zero during this step. The
   * separation's own step is the difference of the two nodes' steps, so the
   * test is exact however far they moved.
   */
  _detectCrossing(i, j, nodes, now) {
    const a = nodes[i];
    const b = nodes[j];
    const separation = b.prevAngle - a.prevAngle;
    if (countPasses(separation, (b.step ?? 0) - (a.step ?? 0), 0) === 0) return false;

    // Cooldown
    const pairKey = `${i}-${j}`;
    const lastTrigger = this._cooldowns.get(pairKey) || 0;
    if (now - lastTrigger < this.params.cooldownMs) return false;
    this._cooldowns.set(pairKey, now);
    return true;
  }

  _buildTrigger(i, j, nodes, maxRel) {
    const a = nodes[i];
    const b = nodes[j];

    const crossX = (a.mesh.position.x + b.mesh.position.x) / 2;
    const crossY = (a.mesh.position.y + b.mesh.position.y) / 2;

    // The crossing's angle as rawValue (the midpoint along the short arc, so a
    // crossing near angle 0 isn't read as the opposite side of the ring).
    // OrbitalNodes._emitTriggerFromDescriptor applies the note mapping.
    const rawValue = circularMidpoint(a.angle, b.angle) / TWO_PI;

    const relativeSpeed = Math.abs(a.speed * a.dir - b.speed * b.dir);

    return {
      nodeIndexA: i,
      nodeIndexB: j,
      rawValue,
      velocity: noteVelocity(relativeSpeed, maxRel),
      position: { x: crossX, y: crossY },
    };
  }

  getParams() {
    return [
      { key: 'cooldownMs', label: 'Cooldown (ms)', type: 'range', min: 0, max: 500, step: 10, value: this.params.cooldownMs,
        help: 'Shortest time between two notes from the same pair of nodes.' },
    ];
  }

  dispose() {
    this._cooldowns.clear();
  }
}
