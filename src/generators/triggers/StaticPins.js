import * as THREE from 'three';
import { TriggerMethod } from './TriggerMethod.js';
import { normalizeAngle, angleDelta, clamp, polarToCartesian } from '../../util/math.js';

const TWO_PI = Math.PI * 2;

/**
 * Fixed trigger points on the orbit ring — like a music box with pins.
 * Any node passing a pin fires a note. Pin positions can be evenly spaced,
 * Euclidean-distributed, or scale-degree based.
 */
export class StaticPins extends TriggerMethod {
  constructor() {
    super('Static Pins', 'staticPins');
    this.params = {
      pinCount: 8,
      pinLayout: 'even',
      pinCooldownMs: 100,
      pinRotate: true,
    };
    this._cooldowns = new Map();
    this._pinAngles = [];
    this._pinMeshes = [];
    this._sceneGroup = null;
    this._prevNodeAngles = [];
  }

  init(nodes, generatorParams, sceneGroup) {
    this._sceneGroup = sceneGroup;
    this._lastGP = generatorParams;
    this._cooldowns.clear();
    this._prevNodeAngles = nodes.map(n => n.angle);
    this._buildPins(generatorParams);
  }

  _buildPins(gp) {
    this._disposePinMeshes();
    const { pinCount, pinLayout } = this.params;

    // Compute pin angles
    this._pinAngles = [];
    switch (pinLayout) {
      case 'euclidean':
        this._pinAngles = this._euclideanAngles(pinCount, pinCount + Math.floor(pinCount * 0.6));
        break;
      case 'scale':
        // Place pins at scale-degree positions (distribute count across 2*PI)
        for (let i = 0; i < pinCount; i++) {
          // Use pentatonic-like spacing: uneven but musical
          const frac = [0, 0.1, 0.2, 0.35, 0.5, 0.6, 0.7, 0.85][i % 8] || (i / pinCount);
          this._pinAngles.push(frac * TWO_PI + (Math.floor(i / 8) * TWO_PI));
        }
        break;
      case 'even':
      default:
        for (let i = 0; i < pinCount; i++) {
          this._pinAngles.push((i / pinCount) * TWO_PI);
        }
    }

    // Create visual pin markers on the orbit ring
    if (this._sceneGroup) {
      const pinGeo = new THREE.SphereGeometry(0.04, 6, 4);
      const pinMat = new THREE.MeshBasicMaterial({
        color: 0x888899,
        transparent: true,
        opacity: 0.6,
      });

      for (const angle of this._pinAngles) {
        const pos = polarToCartesian(angle, gp.radius);
        const mesh = new THREE.Mesh(pinGeo, pinMat);
        mesh.position.set(pos.x, pos.y, 0);
        this._sceneGroup.add(mesh);
        this._pinMeshes.push(mesh);
      }
    }
  }

  detectTriggers(deltaTime, nodes, generatorParams) {
    const triggers = [];
    const now = performance.now();

    for (let ni = 0; ni < nodes.length; ni++) {
      const node = nodes[ni];

      for (let pi = 0; pi < this._pinAngles.length; pi++) {
        const pinAngle = this._pinAngles[pi];

        // Compare in local angle space (both node.angle and pinAngle are local)
        const prevDelta = angleDelta(node.prevAngle, pinAngle);
        const currDelta = angleDelta(node.angle, pinAngle);

        if ((prevDelta > 0 && currDelta <= 0) || (prevDelta < 0 && currDelta >= 0)) {
          // Cooldown per node-pin pair
          const key = `${ni}-p${pi}`;
          const lastTrigger = this._cooldowns.get(key) || 0;
          if (now - lastTrigger < this.params.pinCooldownMs) continue;
          this._cooldowns.set(key, now);

          // Combine pin position + node identity for note variety
          // Pin determines base position, node index shifts octave range
          const pinFrac = normalizeAngle(pinAngle) / TWO_PI;
          const nodeShift = ni / (nodes.length * 4); // subtle per-node offset
          const rawValue = (pinFrac + nodeShift) % 1.0;
          const velocity = clamp(Math.abs(node.speed) / (generatorParams.baseSpeed * 5), 0.2, 1.0);

          // Display position from the rendered mesh (already includes globalAngle)
          triggers.push({
            nodeIndexA: ni,
            rawValue,
            velocity,
            position: { x: node.mesh.position.x, y: node.mesh.position.y },
          });
        }
      }
    }

    return triggers;
  }

  update(deltaTime, generatorParams, globalAngle) {
    // Rotate pin meshes to match the orbit ring / nebula rotation
    for (let i = 0; i < this._pinMeshes.length; i++) {
      const angle = this._pinAngles[i] + globalAngle;
      const pos = polarToCartesian(angle, generatorParams.radius);
      this._pinMeshes[i].position.set(pos.x, pos.y, 0);
    }
  }

  _euclideanAngles(pulses, steps) {
    // Bjorklund algorithm to distribute pulses evenly across steps
    const pattern = this._bjorklund(pulses, steps);
    const angles = [];
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i]) {
        angles.push((i / pattern.length) * TWO_PI);
      }
    }
    return angles;
  }

  _bjorklund(pulses, steps) {
    if (pulses >= steps) return new Array(steps).fill(true);
    if (pulses <= 0) return new Array(steps).fill(false);

    let groups = [];
    for (let i = 0; i < steps; i++) {
      groups.push([i < pulses]);
    }

    let remainder = steps - pulses;
    let divisor = pulses;

    while (remainder > 1) {
      const newGroups = [];
      const limit = Math.min(divisor, remainder);
      for (let i = 0; i < limit; i++) {
        newGroups.push([...groups[i], ...groups[groups.length - 1 - i]]);
      }
      // Remaining groups that weren't paired
      for (let i = limit; i < divisor; i++) {
        newGroups.push(groups[i]);
      }
      groups = newGroups;
      const prevRemainder = remainder;
      remainder = Math.abs(divisor - remainder);
      divisor = limit;
      if (remainder <= 1) break;
    }

    return groups.flat();
  }

  _disposePinMeshes() {
    for (const mesh of this._pinMeshes) {
      if (this._sceneGroup) this._sceneGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._pinMeshes = [];
  }

  getParams() {
    return [
      { key: 'pinCount', label: 'Pin Count', type: 'range', min: 1, max: 24, step: 1, value: this.params.pinCount },
      { key: 'pinLayout', label: 'Pin Layout', type: 'select', value: this.params.pinLayout, options: ['even', 'euclidean', 'scale'] },
      { key: 'pinCooldownMs', label: 'Pin Cooldown (ms)', type: 'range', min: 0, max: 500, step: 10, value: this.params.pinCooldownMs },
      { key: 'pinRotate', label: 'Rotate w/ Ring', type: 'toggle', value: this.params.pinRotate },
    ];
  }

  onParamChange(key, value) {
    if (key === 'pinCount' || key === 'pinLayout') {
      // Need generatorParams for radius — rebuild on next init
      // For now, just rebuild if we have a cached reference
      if (this._lastGP) this._buildPins(this._lastGP);
    }
  }

  dispose() {
    this._disposePinMeshes();
    this._cooldowns.clear();
  }
}
