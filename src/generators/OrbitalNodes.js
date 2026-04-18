import * as THREE from 'three';
import { Generator } from '../core/Generator.js';
import { TriggerEvent } from '../core/TriggerEvent.js';
import { normalizeAngle, angleDelta, polarToCartesian, clamp } from '../util/math.js';
import { getAlgorithmIds, createAlgorithm } from './motion/MotionRegistry.js';
import { getTriggerIds, createTrigger } from './triggers/TriggerRegistry.js';
import { getMappingIds, createMapping } from './mapping/MappingRegistry.js';
import {
  createGlowMaterial,
  createIridescentMaterial,
  getPaletteColor,
  getPaletteThreeColor,
  createTrail,
  createOrbitRing,
  SparkleBurstPool,
  CenterNebula,
  getFlashTexture,
} from '../visual/CyberpunkStyle.js';

const TWO_PI = Math.PI * 2;

const DEFAULT_PARAMS = {
  nodeCount: 5,
  radius: 3.0,
  baseSpeed: 0.5,
  speedRatios: [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5],
  direction: 'mixed',       // 'cw' | 'ccw' | 'mixed' | 'alternate'
  trailLength: 5,           // Number of trail points
  trailStyle: 'line',      // 'line' | 'dots'
  tailLength: 0.3,          // Arc length behind node on orbit ring (radians, 0 = off)
  tailDecompose: 0.0,       // Decomposition amount at tail end (0 = solid, 1 = fully fragmented)
  tailDecomposeCount: 6,    // Number of decomposing fragments at tail end
  nodeStyle: 'sphere',     // 'sphere' | 'ring' | 'diamond' | 'orb'
  nodeSize: 0.15,
  showOrbitRing: true,
  showConnectionLines: true,
  noteMapping: 'angle',     // pluggable mapping ID
  minCrossingAngle: 0.04,   // Radians — crossing detection threshold
  cooldownMs: 80,           // Min time between triggers for the same pair
  spinSpeed: 0.02,          // Global nebula/ring rotation speed (rad/s)
  motionAlgorithm: 'none',  // 'none' | 'phaseDrift' | 'harmonicRatios' | 'goldenSpiral'
  triggerMethod: 'nodeCollision', // 'nodeCollision' | 'staticPins' | 'zoneTriggers'
};

export class OrbitalNodes extends Generator {
  constructor(sceneManager, outputRouter, config = {}) {
    super('OrbitalNodes', sceneManager, outputRouter);
    this.params = { ...DEFAULT_PARAMS, ...config };
    this.nodes = [];
    this.cooldowns = new Map();
    this.sparklePool = null;
    this._nebula = null;
    this._centerPulse = 0;
    this._motionAlgo = null;
    this._triggerMethod = null;
    this._noteMapping = null;
    this.orbitRing = null;
    this.connectionLines = null;
    this._group = new THREE.Group();
  }

  init() {
    this.sceneManager.scene.add(this._group);
    this.sparklePool = new SparkleBurstPool(this._group);
    this._crossingFlashes = []; // active color-mix flash sprites
    this._crossingFlashEnabled = false; // disabled — sparkle bursts provide crossing feedback
    this._nebula = null;
    this._triggerMethod = createTrigger(this.params.triggerMethod);
    this._noteMapping = createMapping(this.params.noteMapping);
    this._buildNodes();
    this._buildOrbitRing();
    this._buildConnectionLines();
  }

  update(deltaTime) {
    // 1. Compute speeds (from algorithm or static)
    let speeds = null;
    if (this._motionAlgo) {
      speeds = this._motionAlgo.computeSpeeds(deltaTime, this.nodes, this.params);
    }

    // Update angles
    for (let i = 0; i < this.nodes.length; i++) {
      const node = this.nodes[i];
      node.prevAngle = node.angle;
      const speed = speeds ? speeds[i] : node.speed;
      node.angle = normalizeAngle(node.angle + node.dir * speed * deltaTime);
    }

    // 2. Update mesh positions & trails
    // Store trail points in local (non-rotated) space using raw angles.
    // The trail lines + meshes rotate together via globalAngle.
    const ringOffset = this._nebula ? this._nebula.globalAngle : 0;
    for (const node of this.nodes) {
      // Local position (raw angle, no rotation offset) for trail storage
      const localPos = polarToCartesian(node.angle, this.params.radius);
      if (node.trail) {
        node.trail.push(localPos.x, localPos.y, 0);
        node.trail.line.rotation.z = ringOffset;
        // Trail opacity: 15% base, spikes to ~80% on trigger via bloomPulse
        node.trail.line.material.opacity = 0.15 + node.bloomPulse * 0.65;
      }

      // Rendered mesh position includes rotation offset
      const displayAngle = node.angle + ringOffset;
      const displayPos = polarToCartesian(displayAngle, this.params.radius);
      node.mesh.position.set(displayPos.x, displayPos.y, 0);

      // Update tail arc — extends behind the node along the orbit ring
      // Uses LineSegments with decomposition: trailing fragments shrink & gap apart
      if (node.tailLine) {
        const tl = this.params.tailLength;
        node.tailLine.visible = tl > 0;
        if (tl > 0) {
          const r = this.params.radius;
          const dir = node.dir;
          const segs = node.tailSegments;
          const decompose = this.params.tailDecompose;   // 0..1
          const fragCount = this.params.tailDecomposeCount; // how many trailing fragments

          // Fraction of the tail that decomposes (the trailing portion)
          const decomposeFrac = decompose * 0.8; // up to 80% of tail can decompose
          const solidEnd = 1.0 - decomposeFrac;  // solid portion ends here (0..1)

          for (let s = 0; s < segs; s++) {
            const t0 = s / segs;        // start of this segment (0..1 along tail)
            const t1 = (s + 1) / segs;  // end of this segment

            let segStart = t0;
            let segEnd = t1;

            // If this segment falls in the decomposing region
            if (decompose > 0 && t1 > solidEnd) {
              // How far into the decompose zone (0..1)
              const decompT = clamp((t0 - solidEnd) / decomposeFrac, 0, 1);

              // Which discrete fragment are we in? (0..fragCount-1)
              const fragIdx = Math.min(Math.floor(decompT * fragCount), fragCount - 1);
              // Normalized position of this fragment (0..1)
              const fragNorm = fragIdx / Math.max(fragCount - 1, 1);

              // Fragment length shrinks progressively — last fragment is smallest
              const shrink = fragNorm * fragNorm; // quadratic: first fragment full, last tiny
              const scale = 1.0 - decompose * shrink * 0.92;
              const segLen = (t1 - t0) * Math.max(scale, 0.05);

              // Gap grows progressively toward the end — large enough to survive bloom bleed
              const gap = decompose * fragNorm * (t1 - t0) * 9.0;

              segStart = t0 + gap;
              segEnd = segStart + segLen;

              // Clamp — don't exceed tail bounds
              if (segEnd > 1.0) segEnd = 1.0;
              if (segStart >= 1.0) { segStart = 1.0; segEnd = 1.0; }
            }

            // Write vertex pair for this segment
            const a0 = displayAngle - dir * segStart * tl;
            const a1 = displayAngle - dir * segEnd * tl;
            const idx = s * 6; // 2 verts * 3 components
            node.tailPositions[idx]     = Math.cos(a0) * r;
            node.tailPositions[idx + 1] = Math.sin(a0) * r;
            node.tailPositions[idx + 2] = 0;
            node.tailPositions[idx + 3] = Math.cos(a1) * r;
            node.tailPositions[idx + 4] = Math.sin(a1) * r;
            node.tailPositions[idx + 5] = 0;
          }
          node.tailPosAttr.needsUpdate = true;

          // Blend tail color with crossing history
          const baseC = new THREE.Color(node.colorHex);
          if (node.crossingHistory.length > 0) {
            const mixC = new THREE.Color(node.crossingHistory[0]);
            const blend = 0.3 / node.crossingHistory.length;
            baseC.lerp(mixC, 0.15 + blend);
          }
          node.tailLine.material.color.copy(baseC);
          node.tailLine.material.opacity = 0.5;
        }
      }
    }

    // 3. Update connection lines
    if (this.params.showConnectionLines && this.connectionLines) {
      this._updateConnectionLines();
    }

    // 4. Detect triggers via pluggable method
    const now = performance.now();
    if (this._triggerMethod) {
      const triggers = this._triggerMethod.detectTriggers(deltaTime, this.nodes, this.params);
      for (const trig of triggers) {
        this._emitTriggerFromDescriptor(trig, now);
      }
    }

    // 5. Update sparkle effects + trigger visuals
    this.sparklePool.update(deltaTime);

    // Update crossing color flashes
    for (let fi = this._crossingFlashes.length - 1; fi >= 0; fi--) {
      const cf = this._crossingFlashes[fi];
      cf.life += deltaTime;
      const t = cf.life / cf.maxLife;
      if (t >= 1) {
        this._group.remove(cf.sprite);
        cf.sprite.material.dispose();
        this._crossingFlashes.splice(fi, 1);
        continue;
      }
      // Fade in fast, fade out smooth
      const fadeIn = Math.min(1, t / 0.15);
      const fadeOut = 1 - ((t - 0.1) / 0.9) ** 1.5;
      const envelope = fadeIn * Math.max(0, fadeOut);
      cf.sprite.scale.setScalar(cf.maxScale * envelope);
      cf.sprite.material.opacity = cf.maxOpacity * envelope;
    }
    if (this._triggerMethod) {
      const globalAngle = this._nebula ? this._nebula.globalAngle : 0;
      this._triggerMethod.update(deltaTime, this.params, globalAngle);
    }

    // 6. Sync orbit ring rotation with nebula (nebula update is in Engine now)
    if (this._nebula && this.orbitRing) {
      this.orbitRing.rotation.z = this._nebula.globalAngle;
    }

    // 7. Rotate center decoration — counter-rotating shells
    if (this._centerDeco) {
      if (this._centerOuter) {
        this._centerOuter.rotation.y += 0.006;
        this._centerOuter.rotation.x += 0.004;
        this._centerOuter.rotation.z += 0.002;
      }
      if (this._centerInner) {
        this._centerInner.rotation.y -= 0.012;
        this._centerInner.rotation.z -= 0.008;
      }

      // Center pulse decay
      if (this._centerPulse > 0.001) {
        this._centerPulse *= (1 - deltaTime * 3.5);
        const scale = 1 + this._centerPulse * 1.0;
        this._centerDeco.scale.setScalar(scale);
        if (this._centerOuter) this._centerOuter.material.opacity = 0.3 + this._centerPulse * 0.5;
        if (this._centerInner) this._centerInner.material.opacity = 0.5 + this._centerPulse * 0.4;
      } else {
        this._centerPulse = 0;
        this._centerDeco.scale.setScalar(1);
        if (this._centerOuter) this._centerOuter.material.opacity = 0.3;
        if (this._centerInner) this._centerInner.material.opacity = 0.5;
      }
    }

    // 8. Decay node bloom pulses (scale + emissive on iridescent material)
    for (const node of this.nodes) {
      if (node.bloomPulse > 0) {
        node.bloomPulse = Math.max(0, node.bloomPulse - deltaTime * 3.5);
        node.mesh.scale.setScalar(1 + node.bloomPulse * 1.2);
      } else {
        node.mesh.scale.setScalar(1);
      }
      // (Emissive pulse removed — the iridescent sphere relies on bloom of
      // its bright iridescent reflections, not on an emissive layer, to avoid
      // Fresnel-driven white halos around the sphere.)
    }
  }

  dispose() {
    // Remove all visuals
    if (this.sparklePool) this.sparklePool.dispose();
    if (this._triggerMethod) this._triggerMethod.dispose();
    if (this._noteMapping) this._noteMapping.dispose();
    // Only dispose nebula if we own it (not shared from Engine)
    if (this._nebula && !this._sharedNebula) {
      if (this._nebula._material) this.sceneManager.unregisterSoftParticleMaterial(this._nebula._material);
      if (this._nebula._dustMaterial) this.sceneManager.unregisterSoftParticleMaterial(this._nebula._dustMaterial);
      this._nebula.dispose();
    }
    this._nebula = null;
    for (const node of this.nodes) {
      if (node.trail) {
        this._group.remove(node.trail.line);
      }
    }
    this.sceneManager.scene.remove(this._group);

    // Dispose geometries and materials
    this._group.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    this._group.clear();
    this.nodes = [];
    this.cooldowns.clear();
  }

  // ── Parameter Descriptors ──────────────────────────────────────

  getParams() {
    const params = [
      { key: 'motionAlgorithm', label: 'Motion', type: 'select', value: this.params.motionAlgorithm, options: ['none', ...getAlgorithmIds()] },
      { key: 'triggerMethod', label: 'Trigger', type: 'select', value: this.params.triggerMethod, options: getTriggerIds() },
      { key: 'nodeCount', label: 'Nodes', type: 'range', min: 2, max: 16, step: 1, value: this.params.nodeCount },
      { key: 'radius', label: 'Radius', type: 'range', min: 0.5, max: 6, step: 0.1, value: this.params.radius },
      { key: 'baseSpeed', label: 'Node Speed', type: 'range', min: 0.05, max: 5, step: 0.05, value: this.params.baseSpeed },
      { key: 'spinSpeed', label: 'Spin Speed', type: 'range', min: 0, max: 0.15, step: 0.005, value: this.params.spinSpeed },
      { key: 'direction', label: 'Direction', type: 'select', value: this.params.direction, options: ['cw', 'ccw', 'mixed', 'alternate'] },
      { key: 'trailLength', label: 'Trail Number', type: 'range', min: 0, max: 200, step: 1, value: this.params.trailLength },
      { key: 'trailStyle', label: 'Trail Style', type: 'select', value: this.params.trailStyle, options: ['line', 'dots'] },
      { key: 'tailLength', label: 'Tail Length', type: 'range', min: 0, max: 3, step: 0.05, value: this.params.tailLength },
      { key: 'tailDecompose', label: 'Tail Decompose', type: 'range', min: 0, max: 1, step: 0.01, value: this.params.tailDecompose },
      { key: 'tailDecomposeCount', label: 'Decompose Fragments', type: 'range', min: 2, max: 12, step: 1, value: this.params.tailDecomposeCount },
      { key: 'nodeStyle', label: 'Node Style', type: 'select', value: this.params.nodeStyle, options: ['sphere', 'ring', 'diamond', 'orb'] },
      { key: 'nodeSize', label: 'Node Size', type: 'range', min: 0.05, max: 0.5, step: 0.01, value: this.params.nodeSize },
      { key: 'showOrbitRing', label: 'Orbit Ring', type: 'toggle', value: this.params.showOrbitRing },
      { key: 'showConnectionLines', label: 'Connections', type: 'toggle', value: this.params.showConnectionLines },
      { key: 'noteMapping', label: 'Note Mapping', type: 'select', value: this.params.noteMapping, options: getMappingIds() },
    ];

    // Append algorithm-specific params with 'algo.' prefix
    if (this._motionAlgo) {
      const algoParams = this._motionAlgo.getParams();
      for (const p of algoParams) {
        params.push({ ...p, key: `algo.${p.key}` });
      }
    }

    // Append trigger-specific params with 'trig.' prefix
    if (this._triggerMethod) {
      const trigParams = this._triggerMethod.getParams();
      for (const p of trigParams) {
        params.push({ ...p, key: `trig.${p.key}` });
      }
    }

    // Append mapping-specific params with 'map.' prefix
    if (this._noteMapping) {
      const mapParams = this._noteMapping.getParams();
      for (const p of mapParams) {
        params.push({ ...p, key: `map.${p.key}` });
      }
    }

    return params;
  }

  onParamChange(key, value) {
    // Algorithm switching
    if (key === 'motionAlgorithm') {
      this._switchAlgorithm(value);
      return;
    }

    // Trigger method switching
    if (key === 'triggerMethod') {
      this._switchTrigger(value);
      return;
    }

    // Route algo-namespaced params to the algorithm
    if (key.startsWith('algo.') && this._motionAlgo) {
      this._motionAlgo.setParam(key.slice(5), value);
      return;
    }

    // Route trigger-namespaced params to the trigger method
    if (key.startsWith('trig.') && this._triggerMethod) {
      this._triggerMethod.setParam(key.slice(5), value);
      return;
    }

    // Mapping switching
    if (key === 'noteMapping') {
      this._switchMapping(value);
      return;
    }

    // Route mapping-namespaced params
    if (key.startsWith('map.') && this._noteMapping) {
      this._noteMapping.setParam(key.slice(4), value);
      return;
    }

    // Only nodeCount and trailLength truly need full rebuild
    const needsRebuild = ['nodeCount', 'trailLength', 'trailStyle', 'nodeStyle'];
    if (needsRebuild.includes(key)) {
      this._rebuild();
    } else if (key === 'radius') {
      // Live update: orbit ring, node positions update each frame from this.params.radius
      // Rebuild orbit ring visual only
      if (this.orbitRing) {
        this._group.remove(this.orbitRing);
        this.orbitRing = createOrbitRing(value, 0x333366);
        this.orbitRing.visible = this.params.showOrbitRing;
        this._group.add(this.orbitRing);
      }
    } else if (key === 'nodeSize') {
      // Live update: scale all node meshes
      const scaleFactor = value / 0.15; // normalize to default
      for (const node of this.nodes) {
        node.mesh.geometry.dispose();
        node.mesh.geometry = new THREE.SphereGeometry(value, 24, 16);
      }
    } else if (key === 'direction') {
      // Live update: recalculate per-node directions
      for (let i = 0; i < this.nodes.length; i++) {
        this.nodes[i].dir = this._resolveDirection(value, i);
      }
    } else if (key === 'spinSpeed') {
      if (this._nebula) this._nebula.spinSpeed = value;
    } else if (key === 'baseSpeed') {
      // Recalculate per-node speeds without rebuilding
      for (let i = 0; i < this.nodes.length; i++) {
        this.nodes[i].speed = value * (this.params.speedRatios[i] || (i + 1));
      }
    } else if (key === 'showOrbitRing' && this.orbitRing) {
      this.orbitRing.visible = value;
    } else if (key === 'showConnectionLines' && this.connectionLines) {
      this.connectionLines.visible = value;
    }
  }

  _switchMapping(mappingId) {
    if (this._noteMapping) {
      this._noteMapping.dispose();
      this._noteMapping = null;
    }
    this._noteMapping = createMapping(mappingId);
    this._noteMapping.init(this.nodes, this.params);
  }

  _switchTrigger(triggerId) {
    if (this._triggerMethod) {
      this._triggerMethod.dispose();
      this._triggerMethod = null;
    }
    this._triggerMethod = createTrigger(triggerId);
    this._triggerMethod.init(this.nodes, this.params, this._group);
  }

  _switchAlgorithm(algorithmId) {
    if (this._motionAlgo) {
      this._motionAlgo.dispose();
      this._motionAlgo = null;
    }
    if (algorithmId !== 'none') {
      this._motionAlgo = createAlgorithm(algorithmId);
      this._motionAlgo.init(this.nodes, this.params);
    }
    // UI rebuild happens via GeneratorPanel detecting the select change
  }

  // ── Internal: Build ────────────────────────────────────────────

  _rebuild() {
    // Preserve the group's parent
    const wasRunning = this.nodes.length > 0;
    if (wasRunning) {
      this.sparklePool.dispose();
      if (this._triggerMethod) this._triggerMethod.dispose();
      // Only dispose nebula if we own it
      if (this._nebula && !this._sharedNebula) {
        if (this._nebula._material) this.sceneManager.unregisterSoftParticleMaterial(this._nebula._material);
        if (this._nebula._dustMaterial) this.sceneManager.unregisterSoftParticleMaterial(this._nebula._dustMaterial);
        this._nebula.dispose();
        this._nebula = null;
      }
      this._group.clear();
    }
    this.nodes = [];
    this.cooldowns.clear();
    this._centerPulse = 0;

    this.sparklePool = new SparkleBurstPool(this._group);
    if (!this._sharedNebula) this._nebula = null;
    this._triggerMethod = createTrigger(this.params.triggerMethod);
    this._noteMapping = createMapping(this.params.noteMapping);
    this._buildNodes();
    this._buildOrbitRing();
    this._buildConnectionLines();
  }

  _buildNodes() {
    const { nodeCount, radius, baseSpeed, speedRatios, nodeSize, direction, trailLength, nodeStyle } = this.params;

    for (let i = 0; i < nodeCount; i++) {
      const color = getPaletteColor(i, this.params.orbitIndex || 0);
      let mesh;

      switch (nodeStyle) {
        case 'ring': {
          const geo = new THREE.TorusGeometry(nodeSize, nodeSize * 0.12, 8, 32);
          const mat = new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.8 });
          mesh = new THREE.Mesh(geo, mat);
          break;
        }
        case 'diamond': {
          const geo = new THREE.OctahedronGeometry(nodeSize, 0);
          mesh = new THREE.Mesh(geo, createGlowMaterial(color));
          break;
        }
        case 'orb': {
          const outerGeo = new THREE.SphereGeometry(nodeSize, 24, 16);
          const outerMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2 });
          const outer = new THREE.Mesh(outerGeo, outerMat);
          const innerGeo = new THREE.SphereGeometry(nodeSize * 0.4, 16, 12);
          const innerMat = createGlowMaterial(color);
          const inner = new THREE.Mesh(innerGeo, innerMat);
          mesh = new THREE.Group();
          mesh.add(outer);
          mesh.add(inner);
          // Store refs for bloom pulse scaling
          mesh._outerMesh = outer;
          mesh._innerMesh = inner;
          break;
        }
        case 'sphere':
        default: {
          const geo = new THREE.SphereGeometry(nodeSize, 24, 16);
          mesh = new THREE.Mesh(geo, createIridescentMaterial(color));
          break;
        }
      }

      const angle = (i / nodeCount) * TWO_PI;
      const speed = baseSpeed * (speedRatios[i] || (i + 1));
      const dir = this._resolveDirection(direction, i);

      const pos = polarToCartesian(angle, radius);
      mesh.position.set(pos.x, pos.y, 0);
      this._group.add(mesh);

      // Trail
      let trail = null;
      if (trailLength > 0) {
        trail = createTrail(trailLength, color);
        // Swap to dashed material for dots style
        if (this.params.trailStyle === 'dots') {
          trail.line.material.dispose();
          trail.line.material = new THREE.LineDashedMaterial({
            color,
            transparent: true,
            opacity: 0.15,
            depthWrite: false,
            dashSize: 0.015,
            gapSize: 0.08,
          });
          trail._isDashed = true;
        }
        this._group.add(trail.line);
      }

      // Tail arc — follows orbit ring behind the node
      // Uses LineSegments (paired verts) so we can introduce gaps for decomposition
      const tailSegments = 32;
      const tailVertCount = tailSegments * 2; // 2 verts per segment
      const tailPositions = new Float32Array(tailVertCount * 3);
      const tailGeo = new THREE.BufferGeometry();
      const tailPosAttr = new THREE.BufferAttribute(tailPositions, 3);
      tailGeo.setAttribute('position', tailPosAttr);

      const tailColor = new THREE.Color(color);
      const tailMat = new THREE.LineBasicMaterial({
        color: tailColor,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      });
      const tailLine = new THREE.LineSegments(tailGeo, tailMat);
      tailLine.visible = this.params.tailLength > 0;
      this._group.add(tailLine);

      this.nodes.push({
        angle,
        prevAngle: angle,
        speed,
        dir,
        mesh,
        trail,
        colorHex: color,
        bloomPulse: 0,
        crossingHistory: [], // recent crossing colors for tail gradient
        tailLine,
        tailPosAttr,
        tailPositions,
        tailSegments,
      });
    }

    // Use shared nebula from Engine if available, otherwise create own
    if (this._sharedNebula) {
      this._nebula = this._sharedNebula;
    } else if (!this._nebula) {
      const nodeColors = this.nodes.map(n => n.colorHex);
      this._nebula = new CenterNebula(this._group, this.params.nodeCount, this.params.radius, nodeColors);
      this.sceneManager.registerSoftParticleMaterial(this._nebula._material);
      this.sceneManager.registerSoftParticleMaterial(this._nebula._dustMaterial);
    }

    // Re-init motion algorithm and trigger method with fresh nodes
    if (this._motionAlgo) {
      this._motionAlgo.init(this.nodes, this.params);
    }
    if (this._triggerMethod) {
      this._triggerMethod.init(this.nodes, this.params, this._group);
    }
    if (this._noteMapping) {
      this._noteMapping.init(this.nodes, this.params);
    }
  }

  _buildOrbitRing() {
    this.orbitRing = createOrbitRing(this.params.radius, 0x333366);
    this.orbitRing.visible = this.params.showOrbitRing;
    this._group.add(this.orbitRing);

    // Center decoration: dual nested counter-rotating wireframe icosahedra
    const outerGeo = new THREE.IcosahedronGeometry(0.7, 2);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0x554488,
      wireframe: true,
      transparent: true,
      opacity: 0.3,
    });
    this._centerOuter = new THREE.Mesh(outerGeo, outerMat);

    const innerGeo = new THREE.IcosahedronGeometry(0.35, 1);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0x6644aa,
      wireframe: true,
      transparent: true,
      opacity: 0.5,
    });
    this._centerInner = new THREE.Mesh(innerGeo, innerMat);

    this._centerDeco = new THREE.Group();
    this._centerDeco.add(this._centerOuter);
    this._centerDeco.add(this._centerInner);
    this._centerDeco.visible = false;
    this._group.add(this._centerDeco);
  }

  _buildConnectionLines() {
    // Create line segments for all pairs
    const pairCount = (this.params.nodeCount * (this.params.nodeCount - 1)) / 2;
    const positions = new Float32Array(pairCount * 6); // 2 vertices per line, 3 floats each
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.LineBasicMaterial({
      color: 0x555577,
      transparent: true,
      opacity: 0.25,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.connectionLines = new THREE.LineSegments(geometry, material);
    this.connectionLines.visible = this.params.showConnectionLines;
    this._group.add(this.connectionLines);
  }

  _updateConnectionLines() {
    const positions = this.connectionLines.geometry.attributes.position.array;
    let idx = 0;
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i].mesh.position;
        const b = this.nodes[j].mesh.position;
        positions[idx++] = a.x;
        positions[idx++] = a.y;
        positions[idx++] = a.z;
        positions[idx++] = b.x;
        positions[idx++] = b.y;
        positions[idx++] = b.z;
      }
    }
    this.connectionLines.geometry.attributes.position.needsUpdate = true;
  }

  _resolveDirection(mode, index) {
    switch (mode) {
      case 'cw': return 1;
      case 'ccw': return -1;
      case 'alternate': return index % 2 === 0 ? 1 : -1;
      case 'mixed':
      default:
        // Deterministic "random" based on index
        return ((index * 7 + 3) % 5) > 2 ? 1 : -1;
    }
  }

  // ── Internal: Crossing Detection ───────────────────────────────

  _detectCrossing(i, j, now) {
    const a = this.nodes[i];
    const b = this.nodes[j];

    // Physical proximity check: nodes must be close on the circle
    const ax = a.mesh.position.x;
    const ay = a.mesh.position.y;
    const bx = b.mesh.position.x;
    const by = b.mesh.position.y;
    const dx = ax - bx;
    const dy = ay - by;
    const distSq = dx * dx + dy * dy;
    const threshold = this.params.nodeSize * 6; // collision radius
    if (distSq > threshold * threshold) return false;

    // Angular crossing: delta changed sign (they passed through each other)
    const prevDelta = angleDelta(a.prevAngle, b.prevAngle);
    const currDelta = angleDelta(a.angle, b.angle);
    if (!((prevDelta > 0 && currDelta <= 0) || (prevDelta < 0 && currDelta >= 0))) {
      return false;
    }

    // Check cooldown
    const pairKey = `${i}-${j}`;
    const lastTrigger = this.cooldowns.get(pairKey) || 0;
    if (now - lastTrigger < this.params.cooldownMs) return false;

    this.cooldowns.set(pairKey, now);
    return true;
  }

  /**
   * Unified trigger handler for pluggable trigger methods.
   * Takes a descriptor from any TriggerMethod and routes to
   * all visual effects + audio output.
   */
  _emitTriggerFromDescriptor(trig, now) {
    const { nodeIndexA, nodeIndexB, velocity, position } = trig;
    let { rawValue } = trig;
    const a = this.nodes[nodeIndexA];
    const b = nodeIndexB != null ? this.nodes[nodeIndexB] : null;

    // Apply pluggable note mapping
    if (this._noteMapping) {
      rawValue = this._noteMapping.mapValue(trig, this.nodes, this.params);
    }

    const event = new TriggerEvent({
      generatorId: this.id,
      triggerId: nodeIndexA * 100 + (nodeIndexB ?? 0),
      rawValue,
      velocity,
      position,
      timestamp: now,
      orbitIndex: this.params.orbitIndex || 0,
      nodeIndex: nodeIndexA,
    });

    // Bloom pulse on involved nodes
    a.bloomPulse = velocity;
    if (b) b.bloomPulse = velocity;

    // Track crossing colors for tail gradient
    if (b) {
      a.crossingHistory.unshift(b.colorHex);
      b.crossingHistory.unshift(a.colorHex);
      if (a.crossingHistory.length > 5) a.crossingHistory.pop();
      if (b.crossingHistory.length > 5) b.crossingHistory.pop();
    }

    // Star twinkle + chromatic aberration + light rays
    this.sceneManager.triggerStarTwinkle(velocity * 0.6);
    this.sceneManager.triggerChromaticAberration(velocity * 0.4);
    this.sceneManager.triggerLightRayPulse(velocity * 0.3);

    // Sparkle bursts
    const meshA = a.mesh.position;
    this.sparklePool.spawn(meshA.x, meshA.y, meshA.z, a.colorHex, 0.5, 1.2 * velocity + 0.4);
    if (b) {
      const meshB = b.mesh.position;
      this.sparklePool.spawn(meshB.x, meshB.y, meshB.z, b.colorHex, 0.5, 1.2 * velocity + 0.4);
    }

    // Crossing color mix flash
    if (this._crossingFlashEnabled && b) {
      const mixColor = new THREE.Color(a.colorHex).lerp(new THREE.Color(b.colorHex), 0.5);
      const flashMat = new THREE.SpriteMaterial({
        map: getFlashTexture(),
        color: mixColor,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const flash = new THREE.Sprite(flashMat);
      flash.position.set(position.x, position.y, 0.05);
      flash.scale.setScalar(0.01);
      this._group.add(flash);
      this._crossingFlashes.push({
        sprite: flash,
        life: 0,
        maxLife: 0.35,
        maxScale: 0.3 + velocity * 0.2,
        maxOpacity: 0.3 + velocity * 0.2,
      });
    }

    // Nebula energy injection
    if (this._nebula) {
      if (b) {
        this._nebula.injectCollision(velocity, nodeIndexA, nodeIndexB, a.colorHex, b.colorHex);
      } else {
        // Single-node trigger: inject on the node's arm with its own color
        this._nebula.injectCollision(velocity, nodeIndexA, nodeIndexA, a.colorHex, a.colorHex);
      }
      this._centerPulse = Math.max(this._centerPulse, velocity);
    }

    // Route to audio/MIDI/OSC
    this.outputRouter.route(event);
  }

  // Legacy method — kept for reference but no longer called by update loop
  _emitTrigger(i, j, now) {
    const a = this.nodes[i];
    const b = this.nodes[j];

    // Compute crossing position from rendered mesh positions (includes ring offset)
    const crossX = (a.mesh.position.x + b.mesh.position.x) / 2;
    const crossY = (a.mesh.position.y + b.mesh.position.y) / 2;

    // Compute rawValue based on noteMapping mode
    let rawValue;
    switch (this.params.noteMapping) {
      case 'angle':
        rawValue = normalizeAngle((a.angle + b.angle) / 2) / TWO_PI;
        break;
      case 'nodeIndex':
        rawValue = (i + j) / (this.nodes.length * 2);
        break;
      case 'velocity':
        const relSpeed = Math.abs(a.speed * a.dir - b.speed * b.dir);
        const maxRelSpeed = this.params.baseSpeed * 20; // rough normalization
        rawValue = clamp(relSpeed / maxRelSpeed, 0, 1);
        break;
      default:
        rawValue = normalizeAngle((a.angle + b.angle) / 2) / TWO_PI;
    }

    // Velocity based on relative angular speed
    const relativeSpeed = Math.abs(a.speed * a.dir - b.speed * b.dir);
    const maxSpeed = this.params.baseSpeed * 10;
    const velocity = clamp(relativeSpeed / maxSpeed, 0.2, 1.0);

    // Emit trigger event
    const event = new TriggerEvent({
      generatorId: this.id,
      triggerId: i * 100 + j,
      rawValue,
      velocity,
      position: { x: crossX, y: crossY },
      timestamp: now,
    });

    // Bloom pulse on both triggering nodes
    a.bloomPulse = velocity;
    b.bloomPulse = velocity;

    // Star twinkle
    this.sceneManager.triggerStarTwinkle(velocity * 0.6);

    // Sparkle burst from each node
    const meshA = a.mesh.position;
    const meshB = b.mesh.position;
    this.sparklePool.spawn(meshA.x, meshA.y, meshA.z, a.colorHex, 0.5, 1.2 * velocity + 0.4);
    this.sparklePool.spawn(meshB.x, meshB.y, meshB.z, b.colorHex, 0.5, 1.2 * velocity + 0.4);

    // Inject energy into center nebula — each arm gets the OTHER node's color
    if (this._nebula) {
      this._nebula.injectCollision(velocity, i, j, a.colorHex, b.colorHex);
      this._centerPulse = Math.max(this._centerPulse, velocity);
    }

    // Route to outputs
    this.outputRouter.route(event);
  }

  // ── Serialization ──────────────────────────────────────────────

  serialize() {
    return {
      type: 'OrbitalNodes',
      params: { ...this.params },
      motionAlgorithm: this._motionAlgo ? this._motionAlgo.serialize() : null,
      triggerMethod: this._triggerMethod ? this._triggerMethod.serialize() : null,
      noteMapping: this._noteMapping ? this._noteMapping.serialize() : null,
    };
  }

  deserialize(data) {
    if (data.params) {
      this.params = { ...DEFAULT_PARAMS, ...data.params };
      this._rebuild();
    }
    if (data.motionAlgorithm) {
      this._switchAlgorithm(data.motionAlgorithm.id);
      if (this._motionAlgo) {
        this._motionAlgo.deserialize(data.motionAlgorithm);
      }
    }
    if (data.triggerMethod) {
      this._switchTrigger(data.triggerMethod.id);
      if (this._triggerMethod) {
        this._triggerMethod.deserialize(data.triggerMethod);
      }
    }
    if (data.noteMapping) {
      this._switchMapping(data.noteMapping.id);
      if (this._noteMapping) {
        this._noteMapping.deserialize(data.noteMapping);
      }
    }
  }
}
