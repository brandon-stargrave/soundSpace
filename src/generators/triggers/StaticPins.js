import * as THREE from 'three';
import { TriggerMethod } from './TriggerMethod.js';
import { normalizeAngle, polarToCartesian, countPasses, euclideanPattern } from '../../util/math.js';
import { noteVelocity } from './velocity.js';

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
          // Use pentatonic-like spacing: uneven but musical. Pins past the
          // first 8 shift by a third of the smallest gap so none coincide.
          const frac = [0, 0.1, 0.2, 0.35, 0.5, 0.6, 0.7, 0.85][i % 8] + Math.floor(i / 8) * (0.1 / 3);
          this._pinAngles.push(frac * TWO_PI);
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
    let maxSpeed = 0;
    for (const node of nodes) maxSpeed = Math.max(maxSpeed, Math.abs(node.speed));

    for (let ni = 0; ni < nodes.length; ni++) {
      const node = nodes[ni];

      for (let pi = 0; pi < this._pinAngles.length; pi++) {
        const pinAngle = this._pinAngles[pi];
        // Pins sit in the same local angle space as the nodes
        if (countPasses(node.prevAngle, node.step ?? 0, pinAngle) === 0) continue;

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

        // Display position from the rendered mesh (already includes globalAngle)
        triggers.push({
          nodeIndexA: ni,
          rawValue,
          velocity: noteVelocity(node.speed, maxSpeed),
          position: { x: node.mesh.position.x, y: node.mesh.position.y },
        });
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

  /** Pins on the onsets of a Euclidean rhythm of `pulses` over `steps`. */
  _euclideanAngles(pulses, steps) {
    const pattern = euclideanPattern(pulses, steps);
    const angles = [];
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i]) angles.push((i / pattern.length) * TWO_PI);
    }
    return angles;
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
      { key: 'pinLayout', label: 'Pin Layout', type: 'select', value: this.params.pinLayout, options: ['even', 'euclidean', 'scale'],
        optionLabels: { even: 'Even', euclidean: 'Euclidean rhythm', scale: 'Uneven (scale-like)' } },
      { key: 'pinCooldownMs', label: 'Pin Cooldown (ms)', type: 'range', min: 0, max: 500, step: 10, value: this.params.pinCooldownMs },
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
