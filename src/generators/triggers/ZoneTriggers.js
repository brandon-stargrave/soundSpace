import * as THREE from 'three';
import { TriggerMethod } from './TriggerMethod.js';
import { normalizeAngle, angleDelta, clamp, polarToCartesian } from '../../util/math.js';

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
      zoneRotate: true,
      zoneCooldownMs: 150,
    };
    this._zones = [];
    this._nodeInZone = []; // [nodeIndex][zoneIndex] = boolean
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

    // Init node-in-zone tracking
    this._nodeInZone = [];
    for (let ni = 0; ni < nodes.length; ni++) {
      this._nodeInZone[ni] = new Array(zoneCount).fill(false);
      // Set initial state
      for (let zi = 0; zi < zoneCount; zi++) {
        this._nodeInZone[ni][zi] = this._isInZone(nodes[ni].angle, this._zones[zi]);
      }
    }

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

  _isInZone(angle, zone) {
    const delta = angleDelta(angle, zone.center);
    return Math.abs(delta) <= zone.halfWidth;
  }

  detectTriggers(deltaTime, nodes, generatorParams) {
    const triggers = [];
    const now = performance.now();
    const { triggerOn, zoneCooldownMs } = this.params;

    // Ensure tracking arrays match node count
    while (this._nodeInZone.length < nodes.length) {
      this._nodeInZone.push(new Array(this._zones.length).fill(false));
    }

    for (let ni = 0; ni < nodes.length; ni++) {
      const node = nodes[ni];

      for (let zi = 0; zi < this._zones.length; zi++) {
        const zone = this._zones[zi];
        const wasIn = this._nodeInZone[ni]?.[zi] || false;
        // Compare in local angle space
        const isIn = this._isInZone(node.angle, zone);
        this._nodeInZone[ni][zi] = isIn;

        let shouldTrigger = false;
        if (triggerOn === 'enter' && !wasIn && isIn) shouldTrigger = true;
        if (triggerOn === 'exit' && wasIn && !isIn) shouldTrigger = true;
        if (triggerOn === 'both' && wasIn !== isIn) shouldTrigger = true;

        if (!shouldTrigger) continue;

        const key = `${ni}-z${zi}`;
        const lastTrigger = this._cooldowns.get(key) || 0;
        if (now - lastTrigger < zoneCooldownMs) continue;
        this._cooldowns.set(key, now);

        // Combine zone position + node identity for note variety
        const zoneFrac = normalizeAngle(zone.center) / TWO_PI;
        const nodeShift = ni / (nodes.length * 4);
        const rawValue = (zoneFrac + nodeShift) % 1.0;
        const velocity = clamp(Math.abs(node.speed) / (generatorParams.baseSpeed * 5), 0.2, 1.0);

        // Use rendered mesh position (includes globalAngle)
        triggers.push({
          nodeIndexA: ni,
          rawValue,
          velocity,
          position: { x: node.mesh.position.x, y: node.mesh.position.y },
        });
      }
    }

    return triggers;
  }

  update(deltaTime, generatorParams, globalAngle) {
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
      { key: 'triggerOn', label: 'Trigger On', type: 'select', value: this.params.triggerOn, options: ['enter', 'exit', 'both'] },
      { key: 'zoneRotate', label: 'Rotate w/ Ring', type: 'toggle', value: this.params.zoneRotate },
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
    this._nodeInZone = [];
  }
}
