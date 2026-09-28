import * as THREE from 'three';
import { TriggerMethod } from './TriggerMethod.js';
import { normalizeAngle, polarToCartesian, countPasses } from '../../util/math.js';
import { noteVelocity } from './velocity.js';

const TWO_PI = Math.PI * 2;

/**
 * Angular arc regions on the orbit ring that fire when a node
 * enters or exits a zone. Zones can overlap to create chords.
 */
export class ZoneTriggers extends TriggerMethod {
  constructor() {
    super('Zone Triggers', 'zoneTriggers');
    this.params = {
      zoneCount: 4,
      zoneWidth: 0.3,
      triggerOn: 'enter',
      zoneCooldownMs: 150,
    };
    this._zones = [];
    this._cooldowns = new Map();
    this._arcMeshes = [];
    this._sceneGroup = null;
  }

  init(nodes, generatorParams, sceneGroup) {
    this._sceneGroup = sceneGroup;
    this._lastGP = generatorParams;
    this._lastNodes = nodes;
    this._cooldowns.clear();
    this._buildZones(nodes, generatorParams);
  }

  _buildZones(nodes, gp) {
    this._disposeArcs();
    const { zoneCount, zoneWidth } = this.params;

    // Evenly distributed zones
    this._zones = [];
    for (let i = 0; i < zoneCount; i++) {
      const center = (i / zoneCount) * TWO_PI;
      this._zones.push({
        center,
        halfWidth: zoneWidth / 2,
      });
    }

    this._arcRadius = gp.radius;

    // Create visual arc segments
    if (this._sceneGroup) {
      for (let i = 0; i < zoneCount; i++) {
        const zone = this._zones[i];
        const startAngle = zone.center - zone.halfWidth;
        const endAngle = zone.center + zone.halfWidth;
        const segments = 24;

        const points = [];
        for (let s = 0; s <= segments; s++) {
          const a = startAngle + (s / segments) * (endAngle - startAngle);
          const pos = polarToCartesian(a, gp.radius);
          points.push(new THREE.Vector3(pos.x, pos.y, 0));
        }

        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineBasicMaterial({
          color: 0x446688,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
        });
        // Use thicker visual by overlaying a second line slightly offset
        const line = new THREE.Line(geometry, material);
        this._sceneGroup.add(line);
        this._arcMeshes.push(line);
      }
    }
  }

  /**
   * A node enters a zone when it crosses the edge it meets first in its
   * direction of travel, and leaves by the other edge. Edge crossings are
   * exact, so a fast node can't skip a narrow zone between frames.
   */
  detectTriggers(deltaTime, nodes, generatorParams) {
    const triggers = [];
    const now = performance.now();
    const { triggerOn, zoneCooldownMs } = this.params;
    let maxSpeed = 0;
    for (const node of nodes) maxSpeed = Math.max(maxSpeed, Math.abs(node.speed));

    for (let ni = 0; ni < nodes.length; ni++) {
      const node = nodes[ni];
      const step = node.step ?? 0;
      if (!step) continue;
      const dir = step > 0 ? 1 : -1;

      for (let zi = 0; zi < this._zones.length; zi++) {
        const zone = this._zones[zi];
        const events = [];
        if (triggerOn !== 'exit' && countPasses(node.prevAngle, step, zone.center - dir * zone.halfWidth) > 0) events.push('in');
        if (triggerOn !== 'enter' && countPasses(node.prevAngle, step, zone.center + dir * zone.halfWidth) > 0) events.push('out');

        for (const edge of events) {
          // Entering and leaving have separate cooldowns, so a short pass
          // through a zone plays both
          const key = `${ni}-z${zi}-${edge}`;
          const lastTrigger = this._cooldowns.get(key) || 0;
          if (now - lastTrigger < zoneCooldownMs) continue;
          this._cooldowns.set(key, now);

          // Combine zone position + node identity for note variety
          const zoneFrac = normalizeAngle(zone.center) / TWO_PI;
          const nodeShift = ni / (nodes.length * 4);
          const rawValue = (zoneFrac + nodeShift) % 1.0;

          // Use rendered mesh position (includes globalAngle)
          triggers.push({
            nodeIndexA: ni,
            rawValue,
            velocity: noteVelocity(node.speed, maxSpeed),
            position: { x: node.mesh.position.x, y: node.mesh.position.y },
          });
        }
      }
    }

    return triggers;
  }

  update(deltaTime, generatorParams, globalAngle) {
    // Redraw the arcs if the orbit's Radius changed
    if (generatorParams.radius !== this._arcRadius && this._lastNodes) {
      this._buildZones(this._lastNodes, generatorParams);
    }
    // Rotate arc visuals to match orbit ring rotation
    for (const arc of this._arcMeshes) {
      arc.rotation.z = globalAngle;
    }
  }

  _disposeArcs() {
    for (const mesh of this._arcMeshes) {
      if (this._sceneGroup) this._sceneGroup.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this._arcMeshes = [];
  }

  getParams() {
    return [
      { key: 'zoneCount', label: 'Zone Count', type: 'range', min: 1, max: 8, step: 1, value: this.params.zoneCount },
      { key: 'zoneWidth', label: 'Zone Width', type: 'range', min: 0.05, max: 1.0, step: 0.05, value: this.params.zoneWidth },
      { key: 'triggerOn', label: 'Trigger On', type: 'select', value: this.params.triggerOn, options: ['enter', 'exit', 'both'],
        optionLabels: { enter: 'Entering', exit: 'Leaving', both: 'Both' } },
      { key: 'zoneCooldownMs', label: 'Cooldown (ms)', type: 'range', min: 0, max: 500, step: 10, value: this.params.zoneCooldownMs },
    ];
  }

  onParamChange(key, value) {
    if (key === 'zoneCount' || key === 'zoneWidth') {
      if (this._lastGP && this._lastNodes) {
        this._buildZones(this._lastNodes, this._lastGP);
      }
    }
  }

  dispose() {
    this._disposeArcs();
    this._cooldowns.clear();
  }
}
