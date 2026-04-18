import * as THREE from 'three';
import { NEON_PALETTE, ORBIT_PALETTES } from '../util/constants.js';
import { createSoftParticleMaterial } from './SoftParticleMaterial.js';
import { createCloudParticleMaterial } from './CloudParticleMaterial.js';

// ── Materials ────────────────────────────────────────────────────

/**
 * Create a glowing MeshBasicMaterial with luminance-normalized color.
 * Boosts dim colors (purple, red) and tames bright ones (cyan, green)
 * so all nodes bloom equally through the bloom pass.
 */
export function createGlowMaterial(color) {
  const c = new THREE.Color(color);

  // Perceived luminance
  const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;

  // Target luminance — bring bright colors DOWN hard to match dimmer ones
  const target = 0.25;
  if (lum > 0.01) {
    const scale = target / lum;
    c.r = Math.min(1, c.r * scale);
    c.g = Math.min(1, c.g * scale);
    c.b = Math.min(1, c.b * scale);
  }

  return new THREE.MeshBasicMaterial({
    color: c,
    transparent: false,
  });
}

/**
 * Iridescent / dichroic material for nodes — metallic surface with a
 * thin-film iridescence overlay that produces a chameleon color shift
 * across viewing angles. Requires scene.environment to render anything
 * visible. The palette color is routed into `emissive` so each node
 * still carries its orbit's identity and feeds the bloom pass.
 */
export function createIridescentMaterial(color) {
  const c = new THREE.Color(color);
  const mat = new THREE.MeshPhysicalMaterial({
    color: c,                                 // palette color tints the surface
    metalness: 0.9,                           // metallic chameleon base
    roughness: 0.55,                          // satin finish
    iridescence: 1.0,                         // full thin-film effect
    iridescenceIOR: 2.33,                     // max hue shift
    iridescenceThicknessRange: [100, 400],    // prime thin-film color territory
    envMapIntensity: 0.3,                     // lower → less Fresnel rim brightness
    transparent: true,
    opacity: 0.85,                            // center opacity; edges fade via shader
    depthWrite: false,
  });

  // Fade alpha at grazing angles so the sphere edges don't paint a bright
  // Fresnel rim. dot(normal, viewDir) is ~1 head-on and ~0 at edges — we
  // multiply the material's alpha by this to taper the edges to zero.
  mat.onBeforeCompile = (shader) => {
    // Inject edge-facing alpha fade before the final opaque_fragment chunk
    // that emits gl_FragColor. vNormal + vViewPosition are available in the
    // physical fragment shader.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <opaque_fragment>',
      `
      float _edgeFacing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
      // Sharpen the curve so only the very edges fade
      float _edgeAlpha = smoothstep(0.0, 0.45, _edgeFacing);
      diffuseColor.a *= _edgeAlpha;
      #include <opaque_fragment>
      `
    );
  };

  return mat;
}

// Cache shuffled palettes per orbit so the shuffle is stable
const _shuffledPalettes = new Map();

/** Seeded shuffle — deterministic per orbit, different order each orbit */
function _getShuffledPalette(orbitIndex) {
  if (_shuffledPalettes.has(orbitIndex)) return _shuffledPalettes.get(orbitIndex);

  const source = ORBIT_PALETTES[orbitIndex] || ORBIT_PALETTES[0] || NEON_PALETTE;
  const shuffled = [...source];

  // Seeded Fisher-Yates shuffle using orbit index as seed
  let seed = (orbitIndex + 1) * 2654435761; // large prime multiplier
  for (let i = shuffled.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff; // LCG
    const j = seed % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  _shuffledPalettes.set(orbitIndex, shuffled);
  return shuffled;
}

/** Get a color from the palette by node index and orbit index */
export function getPaletteColor(index, orbitIndex = 0) {
  const palette = _getShuffledPalette(orbitIndex);
  return palette[index % palette.length];
}

/** Create a THREE.Color from palette index */
export function getPaletteThreeColor(index, orbitIndex = 0) {
  return new THREE.Color(getPaletteColor(index, orbitIndex));
}

// ── Trail Geometry ───────────────────────────────────────────────

/**
 * Create a trail line for a moving object.
 * Returns { line, positions, colors, head, maxPoints, push(x, y, z) }
 */
export function createTrail(maxPoints, color) {
  const positions = new Float32Array(maxPoints * 3);
  const alphas = new Float32Array(maxPoints);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);

  const threeColor = new THREE.Color(color);

  const material = new THREE.LineBasicMaterial({
    color: threeColor,
    transparent: true,
    opacity: 0.15,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  const line = new THREE.Line(geometry, material);

  const trail = {
    line,
    positions,
    alphas,
    head: 0,
    count: 0,
    maxPoints,

    push(x, y, z) {
      const i = this.head * 3;
      this.positions[i] = x;
      this.positions[i + 1] = y;
      this.positions[i + 2] = z;
      this.head = (this.head + 1) % this.maxPoints;
      if (this.count < this.maxPoints) this.count++;
      this._updateGeometry();
    },

    _updateGeometry() {
      // Reorder positions into a contiguous array for rendering
      const ordered = new Float32Array(this.count * 3);
      for (let i = 0; i < this.count; i++) {
        const srcIdx = ((this.head - this.count + i + this.maxPoints) % this.maxPoints) * 3;
        ordered[i * 3] = this.positions[srcIdx];
        ordered[i * 3 + 1] = this.positions[srcIdx + 1];
        ordered[i * 3 + 2] = this.positions[srcIdx + 2];
      }
      this.line.geometry.attributes.position.array.set(ordered);
      this.line.geometry.attributes.position.needsUpdate = true;
      this.line.geometry.setDrawRange(0, this.count);

      // For dashed trails: use fixed evenly-spaced distances so the dash
      // pattern stays locked in place instead of jittering as points shift
      if (this._isDashed) {
        const spacing = 0.1; // fixed distance per point — controls dash density
        let distAttr = this.line.geometry.getAttribute('lineDistance');
        if (!distAttr || distAttr.count < this.maxPoints) {
          distAttr = new THREE.BufferAttribute(new Float32Array(this.maxPoints), 1);
          this.line.geometry.setAttribute('lineDistance', distAttr);
        }
        for (let i = 0; i < this.count; i++) {
          distAttr.array[i] = i * spacing;
        }
        distAttr.needsUpdate = true;
      }
    },

    clear() {
      this.head = 0;
      this.count = 0;
      this.line.geometry.setDrawRange(0, 0);
    },
  };

  return trail;
}

// ── Flash Sprite ─────────────────────────────────────────────────

let _flashTexture = null;

export function getFlashTexture() {
  if (_flashTexture) return _flashTexture;

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  _flashTexture = new THREE.CanvasTexture(canvas);
  return _flashTexture;
}

/**
 * Manages a pool of flash sprites for trigger events.
 */
export class FlashPool {
  constructor(scene, poolSize = 20) {
    this.scene = scene;
    this.flashes = [];

    for (let i = 0; i < poolSize; i++) {
      const material = new THREE.SpriteMaterial({
        map: getFlashTexture(),
        blending: THREE.AdditiveBlending,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      sprite.scale.set(0.1, 0.1, 1);
      scene.add(sprite);
      this.flashes.push({
        sprite,
        active: false,
        life: 0,
        maxLife: 0,
      });
    }
  }

  /** Spawn a flash at position with given color */
  spawn(x, y, z, color, duration = 0.3, maxScale = 1.5) {
    // Find inactive flash
    const flash = this.flashes.find(f => !f.active);
    if (!flash) return;

    flash.sprite.position.set(x, y, z);
    flash.sprite.material.color.set(color);
    flash.sprite.material.opacity = 0;
    flash.sprite.scale.set(0.01, 0.01, 1);
    flash.sprite.visible = true;
    flash.active = true;
    flash.life = 0;
    flash.maxLife = duration;
    flash.maxScale = maxScale;
  }

  /** Update all active flashes (call each frame) */
  update(deltaTime) {
    for (const flash of this.flashes) {
      if (!flash.active) continue;
      flash.life += deltaTime;
      const t = flash.life / flash.maxLife;
      if (t >= 1) {
        flash.active = false;
        flash.sprite.visible = false;
        continue;
      }
      // Smooth fade in then fade out — no hard pop, no strobe
      const fadeIn = Math.min(1, t / 0.15);
      const fadeOut = 1 - ((t - 0.1) / 0.9) ** 1.5;
      const envelope = fadeIn * Math.max(0, fadeOut);
      const scale = flash.maxScale * envelope;
      flash.sprite.scale.set(scale, scale, 1);
      flash.sprite.material.opacity = 0.2 * envelope;
    }
  }

  dispose() {
    for (const flash of this.flashes) {
      flash.sprite.material.dispose();
      this.scene.remove(flash.sprite);
    }
  }
}

// ── Star Sprite Texture ──────────────────────────────────────────

let _starTexture = null;

/** Canvas-generated 4-point star with soft glow halo */
function getStarTexture() {
  if (_starTexture) return _starTexture;

  const size = 64;
  const half = size / 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Soft radial glow base
  const glow = ctx.createRadialGradient(half, half, 0, half, half, half);
  glow.addColorStop(0, 'rgba(255,255,255,0.9)');
  glow.addColorStop(0.15, 'rgba(255,255,255,0.4)');
  glow.addColorStop(0.4, 'rgba(255,255,255,0.08)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  // 4-point star spikes (cross shape with tapered arms)
  ctx.globalCompositeOperation = 'lighter';
  const spikes = 4;
  for (let s = 0; s < spikes; s++) {
    const angle = (s / spikes) * Math.PI * 2;
    ctx.save();
    ctx.translate(half, half);
    ctx.rotate(angle);

    // Tapered spike via gradient along the arm
    const grad = ctx.createLinearGradient(0, 0, half * 0.95, 0);
    grad.addColorStop(0, 'rgba(255,255,255,0.8)');
    grad.addColorStop(0.3, 'rgba(255,255,255,0.35)');
    grad.addColorStop(0.7, 'rgba(255,255,255,0.08)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;

    // Narrow diamond shape for each spike
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(half * 0.95, -1.2);
    ctx.lineTo(half * 0.95, 1.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  ctx.globalCompositeOperation = 'source-over';
  _starTexture = new THREE.CanvasTexture(canvas);
  return _starTexture;
}

// ── Sparkle Particle Burst ────────────────────────────────────────

/**
 * Simple sparkle burst using individual star sprites (always camera-facing).
 * Each particle fades via scale + opacity. No additive blending.
 */
export class SparkleBurstPool {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
  }

  spawn(x, y, z, color, duration = 0.7, speed = 1.2, opts = {}) {
    const count = opts.count ?? 15;
    const scaleMul = opts.scaleMul ?? 1.0;
    const scatterMul = opts.scatterMul ?? 1.0;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: getStarTexture(),
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        rotation: Math.random() * Math.PI * 2,
      });
      const mesh = new THREE.Sprite(mat);

      // Spread out from spawn point immediately
      const angle = Math.random() * Math.PI * 2;
      const scatter = (0.08 + Math.random() * 0.1) * scatterMul;
      mesh.position.set(
        x + Math.cos(angle) * scatter,
        y + Math.sin(angle) * scatter,
        0.05
      );

      // Random scale variation, optionally multiplied
      const baseScale = (0.1 + Math.random() * 0.12) * scaleMul;
      mesh.scale.setScalar(0);

      this.scene.add(mesh);

      const spd = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        mesh,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 0,
        maxLife: duration * (0.7 + Math.random() * 0.5),
        baseScale,
        phase: Math.random() * Math.PI * 2,
        freq: 20 + Math.random() * 40,
        alphaVar: 0.4 + Math.random() * 0.6,
      });
    }
  }

  update(deltaTime) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += deltaTime;
      const t = p.life / p.maxLife;

      if (t >= 1) {
        // Remove particle
        this.scene.remove(p.mesh);
        p.mesh.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }

      // Smooth envelope: fade in 15%, fade out
      const fadeIn = Math.min(1, t / 0.15);
      const fadeOut = 1 - ((Math.max(0, t - 0.1) / 0.9) ** 2);
      const envelope = fadeIn * Math.max(0, fadeOut);

      // Sparkle flicker
      const flicker = 0.3 + 0.7 * ((Math.sin(p.life * p.freq + p.phase) + 1) * 0.5);

      // Scale controls visibility — fades in and out smoothly
      const scale = p.baseScale * envelope * flicker;
      p.mesh.scale.setScalar(scale);
      p.mesh.material.opacity = envelope * p.alphaVar;

      // Movement with drag + position noise
      p.vx *= (1 - deltaTime * 3);
      p.vy *= (1 - deltaTime * 3);
      p.mesh.position.x += p.vx * deltaTime + (Math.random() - 0.5) * 0.008;
      p.mesh.position.y += p.vy * deltaTime + (Math.random() - 0.5) * 0.008;
    }
  }

  dispose() {
    for (const p of this.particles) {
      this.scene.remove(p.mesh);
      p.mesh.material.dispose();
    }
    this.particles = [];
  }
}

// ── Center Nebula / Spiral Galaxy ─────────────────────────────────

import { gaussRand } from '../util/math.js';

const MAX_NEBULA_PARTICLES = 2500;
const MAX_DUST_PARTICLES = 5000;
const MAX_CLOUD_PARTICLES = 600;
const MAX_NANO_PARTICLES = 6000;

/**
 * Generative spiral galaxy nebula at the center of the orbital system.
 * Each note trigger injects colored particles that spiral outward,
 * building a visual history of the composition.
 *
 * Features:
 * - Multi-arm logarithmic spiral structure
 * - Trail lines per arm that build up structure
 * - Particles with tight arm adherence + gentle drift
 */
export class CenterNebula {
  constructor(parentGroup, numArms = 5, orbitRadius = 3.0, nodeColors = null) {
    this._group = parentGroup;
    this._numArms = numArms;
    this._orbitRadius = orbitRadius;
    this._nodeColors = nodeColors; // hex colors per arm, matching nodes
    this._tightness = 2.5;
    this._cursor = 0;
    this._globalAngle = 0;
    this._spinSpeed = 0.02;
    this._shimmerWaves = [];
    this._armWaves = [];          // traveling per-arm turbulence fronts
    this._turbulence = 0;
    this._turbulenceTarget = 0;
    this._triggerRate = 0;       // smoothed triggers-per-second estimate
    this._lastTriggerTime = 0;

    // ── Particle Points ──
    const positions = new Float32Array(MAX_NEBULA_PARTICLES * 3);
    const colors = new Float32Array(MAX_NEBULA_PARTICLES * 3);
    const sizes = new Float32Array(MAX_NEBULA_PARTICLES);
    const alphas = new Float32Array(MAX_NEBULA_PARTICLES);

    this._geometry = new THREE.BufferGeometry();
    this._posAttr = new THREE.BufferAttribute(positions, 3);
    this._colorAttr = new THREE.BufferAttribute(colors, 3);
    this._sizeAttr = new THREE.BufferAttribute(sizes, 1);
    this._alphaAttr = new THREE.BufferAttribute(alphas, 1);
    this._geometry.setAttribute('position', this._posAttr);
    this._geometry.setAttribute('color', this._colorAttr);
    this._geometry.setAttribute('aSize', this._sizeAttr);
    this._geometry.setAttribute('aAlpha', this._alphaAttr);

    this._material = createSoftParticleMaterial({
      vertexColors: true,
      glowWidth: 0.12,
      glowIntensity: 0.35,
      pixelRatio: window.devicePixelRatio || 1,
      canvasHeight: window.innerHeight,
    });

    this._points = new THREE.Points(this._geometry, this._material);
    this._points.layers.enable(1); // visible to god ray camera
    parentGroup.add(this._points);

    // ── Micro dust layer — tiny fill particles ──
    const dustPositions = new Float32Array(MAX_DUST_PARTICLES * 3);
    const dustColors = new Float32Array(MAX_DUST_PARTICLES * 3);
    const dustSizes = new Float32Array(MAX_DUST_PARTICLES);
    const dustAlphas = new Float32Array(MAX_DUST_PARTICLES);

    this._dustGeometry = new THREE.BufferGeometry();
    this._dustPosAttr = new THREE.BufferAttribute(dustPositions, 3);
    this._dustColorAttr = new THREE.BufferAttribute(dustColors, 3);
    this._dustSizeAttr = new THREE.BufferAttribute(dustSizes, 1);
    this._dustAlphaAttr = new THREE.BufferAttribute(dustAlphas, 1);
    this._dustGeometry.setAttribute('position', this._dustPosAttr);
    this._dustGeometry.setAttribute('color', this._dustColorAttr);
    this._dustGeometry.setAttribute('aSize', this._dustSizeAttr);
    this._dustGeometry.setAttribute('aAlpha', this._dustAlphaAttr);

    this._dustMaterial = createSoftParticleMaterial({
      vertexColors: true,
      glowWidth: 0.08,
      glowIntensity: 0.25,
      pixelRatio: window.devicePixelRatio || 1,
      canvasHeight: window.innerHeight,
    });

    this._dustPoints = new THREE.Points(this._dustGeometry, this._dustMaterial);
    this._dustPoints.layers.enable(1);
    parentGroup.add(this._dustPoints);

    this._dustParticles = [];
    for (let i = 0; i < MAX_DUST_PARTICLES; i++) {
      this._dustParticles.push({
        alive: false, age: 0, maxLife: 0,
        r: 0, theta: 0, armIndex: 0, armOffset: 0, z: 0,
        baseColor: new THREE.Color(), fadeStart: 0,
        shimmerPhase: Math.random() * Math.PI * 2,
        shimmerSpeed: 6 + Math.random() * 25,
        alphaVar: 0.25 + Math.random() * 0.75,
        shimmerImmune: Math.random() < 0.15, // 15% don't shimmer — negative space
      });
      const i3 = i * 3;
      dustSizes[i] = 0;
      dustAlphas[i] = 0;
    }
    this._dustCursor = 0;

    // ── Cloud layer — large faint particles with noise shader for body ──
    const cloudPositions = new Float32Array(MAX_CLOUD_PARTICLES * 3);
    const cloudColors = new Float32Array(MAX_CLOUD_PARTICLES * 3);
    const cloudSizes = new Float32Array(MAX_CLOUD_PARTICLES);
    const cloudAlphas = new Float32Array(MAX_CLOUD_PARTICLES);

    this._cloudGeometry = new THREE.BufferGeometry();
    this._cloudPosAttr = new THREE.BufferAttribute(cloudPositions, 3);
    this._cloudColorAttr = new THREE.BufferAttribute(cloudColors, 3);
    this._cloudSizeAttr = new THREE.BufferAttribute(cloudSizes, 1);
    this._cloudAlphaAttr = new THREE.BufferAttribute(cloudAlphas, 1);
    this._cloudGeometry.setAttribute('position', this._cloudPosAttr);
    this._cloudGeometry.setAttribute('color', this._cloudColorAttr);
    this._cloudGeometry.setAttribute('aSize', this._cloudSizeAttr);
    this._cloudGeometry.setAttribute('aAlpha', this._cloudAlphaAttr);

    this._cloudMaterial = createCloudParticleMaterial({
      vertexColors: true,
      glowWidth: 0.25,
      glowIntensity: 0.5,
      pixelRatio: window.devicePixelRatio || 1,
      canvasHeight: window.innerHeight,
    });

    this._cloudPoints = new THREE.Points(this._cloudGeometry, this._cloudMaterial);
    this._cloudPoints.layers.enable(1);
    parentGroup.add(this._cloudPoints);

    this._cloudParticles = [];
    for (let i = 0; i < MAX_CLOUD_PARTICLES; i++) {
      this._cloudParticles.push({
        alive: false, age: 0, maxLife: 0,
        r: 0, theta: 0, z: 0,
        baseColor: new THREE.Color(),
        alphaVar: 0.03 + Math.random() * 0.05,
        fadeStart: 0,
        baseSize: 0.20,
      });
      cloudSizes[i] = 0;
      cloudAlphas[i] = 0;
    }
    this._cloudCursor = 0;

    // ── Nano particle layer — ultra-fine, dense ring framing the center void ──
    const nanoPositions = new Float32Array(MAX_NANO_PARTICLES * 3);
    const nanoColors = new Float32Array(MAX_NANO_PARTICLES * 3);
    const nanoSizes = new Float32Array(MAX_NANO_PARTICLES);
    const nanoAlphas = new Float32Array(MAX_NANO_PARTICLES);

    this._nanoGeometry = new THREE.BufferGeometry();
    this._nanoPosAttr = new THREE.BufferAttribute(nanoPositions, 3);
    this._nanoColorAttr = new THREE.BufferAttribute(nanoColors, 3);
    this._nanoSizeAttr = new THREE.BufferAttribute(nanoSizes, 1);
    this._nanoAlphaAttr = new THREE.BufferAttribute(nanoAlphas, 1);
    this._nanoGeometry.setAttribute('position', this._nanoPosAttr);
    this._nanoGeometry.setAttribute('color', this._nanoColorAttr);
    this._nanoGeometry.setAttribute('aSize', this._nanoSizeAttr);
    this._nanoGeometry.setAttribute('aAlpha', this._nanoAlphaAttr);

    this._nanoMaterial = createSoftParticleMaterial({
      vertexColors: true,
      glowWidth: 0.05,
      glowIntensity: 0.2,
      pixelRatio: window.devicePixelRatio || 1,
      canvasHeight: window.innerHeight,
    });

    this._nanoPoints = new THREE.Points(this._nanoGeometry, this._nanoMaterial);
    this._nanoPoints.layers.enable(1);
    parentGroup.add(this._nanoPoints);

    this._nanoParticles = [];
    for (let i = 0; i < MAX_NANO_PARTICLES; i++) {
      this._nanoParticles.push({
        alive: false, age: 0, maxLife: 0,
        r: 0, theta: 0, armIndex: 0, armOffset: 0, z: 0,
        baseColor: new THREE.Color(),
        alphaVar: 0.3 + Math.random() * 0.5,
        fadeStart: 0,
      });
      nanoSizes[i] = 0;
      nanoAlphas[i] = 0;
    }
    this._nanoCursor = 0;

    // ── Trail lines — one per spiral arm, colored to match node ──
    this._trails = [];
    for (let a = 0; a < this._numArms; a++) {
      const trailPts = 120;
      const trailPositions = new Float32Array(trailPts * 3);
      const trailGeo = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(trailPositions, 3);
      trailGeo.setAttribute('position', posAttr);

      // Use node color if available, dimmed for subtlety
      let armColor = 0x333355;
      if (this._nodeColors && this._nodeColors[a] !== undefined) {
        const c = new THREE.Color(this._nodeColors[a]);
        c.multiplyScalar(0.35); // dim to trail-level
        armColor = c;
      }

      const trailMat = new THREE.LineDashedMaterial({
        color: armColor,
        transparent: true,
        opacity: 0.3,
        blending: THREE.NormalBlending,
        depthWrite: false,
        dashSize: 0.08,
        gapSize: 0.06,
      });

      // Pre-compute static spiral shape — tips reach orbit ring
      for (let i = 0; i < trailPts; i++) {
        const t = i / trailPts;
        const r = 0.25 + t * (this._orbitRadius - 0.25);
        const theta = this._spiralArm(r, a);
        trailPositions[i * 3] = r * Math.cos(theta);
        trailPositions[i * 3 + 1] = r * Math.sin(theta);
        trailPositions[i * 3 + 2] = 0;
      }

      const line = new THREE.Line(trailGeo, trailMat);
      line.computeLineDistances(); // required for dashed lines
      parentGroup.add(line);
      this._trails.push({ line, geometry: trailGeo, positions: trailPositions, trailPts });
    }

    // ── CPU-side particle metadata ──
    this._particles = [];
    for (let i = 0; i < MAX_NEBULA_PARTICLES; i++) {
      this._particles.push({
        alive: false,
        age: 0,
        maxLife: 0,
        r: 0,
        theta: 0,
        armIndex: 0,
        armOffset: 0,
        z: 0,
        baseColor: new THREE.Color(),
        velocity: 0,
        fadeStart: 0,
        shimmerPhase: Math.random() * Math.PI * 2,
        shimmerSpeed: 8 + Math.random() * 20,
        alphaVar: 0.3 + Math.random() * 0.7,
        shimmerImmune: Math.random() < 0.2, // 20% of particles don't shimmer
      });

      sizes[i] = 0;
      alphas[i] = 0;
    }
  }

  /** Inject particles from a collision between two nodes.
   *  Each arm gets the OTHER node's color — green hits purple = purple on green arm.
   */
  /**
   * Launch a tight turbulence wave down every spiral arm simultaneously.
   * Each wave starts at the galactic center and travels outward along one
   * arm, briefly amplifying per-particle turbulence within a narrow radial
   * band. Used by the HarmonicOrbit on transpose events to make the whole
   * nebula visibly react to key changes.
   */
  fireArmWaves(opts = {}) {
    const intensity  = opts.intensity  ?? 1.0;  // peak push magnitude
    const speed      = opts.speed      ?? 1.9;  // units/second outward
    const width      = opts.width      ?? 0.28; // radial thickness of the band
    const maxLife    = opts.maxLife    ?? 3.5;  // seconds before removed
    const hueBase    = opts.hueBase    ?? 0.9;  // base hue-rotation multiplier (radians at armBandStrength=1)
    const hueVariety = opts.hueVariety ?? 0.7;  // 0 = fixed, 1 = full randomization of amplitude
    const now = performance.now() / 1000;
    for (let a = 0; a < this._numArms; a++) {
      // Per-wave randomized hue rotation: sign ±1 (direction) and
      // amplitude scale in [1-hueVariety, 1]. Each arm gets its own roll so
      // a single transpose event can show several different chromatic shifts
      // across the arms — more interesting than a uniform shift everywhere.
      const hueSign = Math.random() < 0.5 ? -1 : 1;
      const hueScale = 1 - hueVariety + Math.random() * hueVariety;
      const hueMul = hueBase * hueSign * hueScale;
      this._armWaves.push({
        birth: now,
        armIndex: a,
        speed,
        width,
        intensity,
        maxLife,
        hueMul,
      });
    }
  }

  injectCollision(velocity, nodeIndexA, nodeIndexB, colorHexA, colorHexB) {
    // Spawn on arm A in color B, and arm B in color A
    const pairs = [
      { arm: nodeIndexA % this._numArms, colorHex: colorHexB },
      { arm: nodeIndexB % this._numArms, colorHex: colorHexA },
    ];

    const count = Math.floor(6 + velocity * 12);
    const positions = this._posAttr.array;
    const colors = this._colorAttr.array;
    const sizes = this._sizeAttr.array;
    const alphas = this._alphaAttr.array;

    for (const { arm, colorHex } of pairs) {
      const srcColor = this._normColor(colorHex);

      for (let n = 0; n < count; n++) {
        const slot = this._findSlot();
        const p = this._particles[slot];
        const i3 = slot * 3;

        p.alive = true;
        p.age = 0;
        p.maxLife = 30 + Math.random() * 40;
        p.r = 0.1 + Math.random() * 1.2;
        p.armIndex = arm;
        const jitterScale = 1.0 / (0.15 + p.r);
        p.armOffset = gaussRand(0.4) * jitterScale;
        p.theta = this._spiralArm(p.r, p.armIndex) + p.armOffset;
        const zSpread = 0.12 / (0.4 + p.r);
        p.z = gaussRand(zSpread);
        p.baseColor.copy(srcColor);
        p.velocity = velocity;
        p.fadeStart = p.maxLife * 0.6;

        const worldTheta = p.theta + this._globalAngle;
        positions[i3] = p.r * Math.cos(worldTheta);
        positions[i3 + 1] = p.r * Math.sin(worldTheta);
        positions[i3 + 2] = p.z;
        colors[i3] = srcColor.r;
        colors[i3 + 1] = srcColor.g;
        colors[i3 + 2] = srcColor.b;
        sizes[slot] = 0;  // fade in via update loop
        alphas[slot] = 0;
      }
    }

    this._posAttr.needsUpdate = true;
    this._colorAttr.needsUpdate = true;
    this._sizeAttr.needsUpdate = true;
    this._alphaAttr.needsUpdate = true;

    // ── Inject dust — same arm/color pairing ──
    const dustCount = Math.floor(16 + velocity * 30);
    const dustPos = this._dustPosAttr.array;
    const dustCol = this._dustColorAttr.array;
    const dustSizes = this._dustSizeAttr.array;
    const dustAlphas = this._dustAlphaAttr.array;

    for (const { arm, colorHex } of pairs) {
      const dColor = this._normColor(colorHex, 0.17);

      for (let n = 0; n < dustCount; n++) {
        const slot = this._findDustSlot();
        const d = this._dustParticles[slot];
        const i3 = slot * 3;

        d.alive = true;
        d.age = 0;
        d.maxLife = 25 + Math.random() * 35;

        const rRaw = Math.random() * Math.random() * 2.8;
        d.r = Math.max(0.25, 0.15 + rRaw);

        const isCoreDust = d.r < 1.2;
        d.armIndex = arm;
        if (isCoreDust) {
          d.armOffset = (Math.random() - 0.5) * Math.PI * 1.0;
        } else {
          const dJitter = 0.8 / (0.12 + d.r);
          d.armOffset = gaussRand(0.35) * dJitter;
        }
        d.theta = this._spiralArm(d.r, d.armIndex) + d.armOffset;

        const dZSpread = 0.08 / (0.35 + d.r);
        d.z = gaussRand(dZSpread);
        d.baseColor.copy(dColor);
        d.fadeStart = d.maxLife * 0.5;

        const wt = d.theta + this._globalAngle;
        dustPos[i3] = d.r * Math.cos(wt);
        dustPos[i3 + 1] = d.r * Math.sin(wt);
        dustPos[i3 + 2] = d.z;
        dustCol[i3] = dColor.r;
        dustCol[i3 + 1] = dColor.g;
        dustCol[i3 + 2] = dColor.b;
        dustSizes[slot] = 0;
        dustAlphas[slot] = 0;
      }
    }

    this._dustPosAttr.needsUpdate = true;
    this._dustColorAttr.needsUpdate = true;
    this._dustSizeAttr.needsUpdate = true;
    this._dustAlphaAttr.needsUpdate = true;

    // ── Inject cloud particles — center-biased, tapering size toward outer ring ──
    const cloudCount = Math.floor(4 + velocity * 6);
    const cloudPos = this._cloudPosAttr.array;
    const cloudCol = this._cloudColorAttr.array;
    const cloudSizes = this._cloudSizeAttr.array;
    const cloudAlphas = this._cloudAlphaAttr.array;

    for (let n = 0; n < cloudCount; n++) {
      const slot = this._findCloudSlot();
      const cp = this._cloudParticles[slot];
      const i3 = slot * 3;

      const cColor = this._normColor(Math.random() < 0.5 ? colorHexA : colorHexB, 0.10);

      cp.alive = true;
      cp.age = 0;
      cp.maxLife = 40 + Math.random() * 40;
      // Center-biased: squared random clusters toward center
      cp.r = 0.25 + Math.pow(Math.random(), 1.5) * 2.5;
      cp.theta = Math.random() * Math.PI * 2;
      // More z depth, tapering with radius
      const zSpread = 0.04 / (0.5 + cp.r * 2.0);
      cp.z = gaussRand(zSpread);
      cp.baseColor.copy(cColor);
      cp.fadeStart = cp.maxLife * 0.5;
      // Size tapers with radius — big near center, small at edges
      cp.baseSize = 0.25 * Math.max(0.15, 1.0 - cp.r / 4.0);

      const wt = cp.theta + this._globalAngle;
      cloudPos[i3] = cp.r * Math.cos(wt);
      cloudPos[i3 + 1] = cp.r * Math.sin(wt);
      cloudPos[i3 + 2] = cp.z;
      cloudCol[i3] = cColor.r;
      cloudCol[i3 + 1] = cColor.g;
      cloudCol[i3 + 2] = cColor.b;
      cloudSizes[slot] = 0;
      cloudAlphas[slot] = 0;
    }

    this._cloudPosAttr.needsUpdate = true;
    this._cloudColorAttr.needsUpdate = true;
    this._cloudSizeAttr.needsUpdate = true;
    this._cloudAlphaAttr.needsUpdate = true;

    // ── Inject nano particles — ultra-fine, tight ring around center void ──
    const nanoCount = Math.floor(45 + velocity * 60);
    const nanoPos = this._nanoPosAttr.array;
    const nanoCol = this._nanoColorAttr.array;
    const nanoSizes = this._nanoSizeAttr.array;
    const nanoAlphas = this._nanoAlphaAttr.array;
    // Outer radius is ~20% of the orbit radius (spiral extent)
    const nanoOuterR = this._orbitRadius * 0.35;
    // Inner radius starts where spiral arm lines begin
    const nanoInnerR = 0.25;

    for (let n = 0; n < nanoCount; n++) {
      const slot = this._findNanoSlot();
      const np = this._nanoParticles[slot];
      const i3 = slot * 3;

      const nColor = this._normColor(Math.random() < 0.5 ? colorHexA : colorHexB, 0.15);

      np.alive = true;
      np.age = 0;
      np.maxLife = 10 + Math.random() * 20;
      // Heavily biased toward inner edge — dense at spiral arm starts
      np.r = nanoInnerR + Math.pow(Math.random(), 2.5) * (nanoOuterR - nanoInnerR);
      np.armIndex = Math.floor(Math.random() * this._numArms);
      // Spread freely — solid disc, not locked to arms
      np.armOffset = (Math.random() - 0.5) * Math.PI * 1.2;
      np.theta = this._spiralArm(np.r, np.armIndex) + np.armOffset;
      np.z = (Math.random() - 0.5) * 0.02;
      np.baseColor.copy(nColor);
      np.fadeStart = np.maxLife * 0.5;

      const wt = np.theta + this._globalAngle;
      nanoPos[i3] = np.r * Math.cos(wt);
      nanoPos[i3 + 1] = np.r * Math.sin(wt);
      nanoPos[i3 + 2] = np.z;
      nanoCol[i3] = nColor.r;
      nanoCol[i3 + 1] = nColor.g;
      nanoCol[i3 + 2] = nColor.b;
      nanoSizes[slot] = 0;
      nanoAlphas[slot] = 0;
    }

    this._nanoPosAttr.needsUpdate = true;
    this._nanoColorAttr.needsUpdate = true;
    this._nanoSizeAttr.needsUpdate = true;
    this._nanoAlphaAttr.needsUpdate = true;

    // ── Turbulence + shimmer (only when running standalone, not via wrapper) ──
    this._injectTurbulenceAndShimmer(velocity);
  }

  /** Inject only particles — no turbulence/shimmer management.
   *  Used by LegacyNebulaBackend when wrapper handles turbulence/shimmer. */
  _injectParticlesOnly(velocity, nodeIndexA, nodeIndexB, colorHexA, colorHexB) {
    // Re-call injectCollision but skip turbulence/shimmer
    // We temporarily disable the turbulence/shimmer injection
    const origMethod = this._injectTurbulenceAndShimmer;
    this._injectTurbulenceAndShimmer = () => {};
    this.injectCollision(velocity, nodeIndexA, nodeIndexB, colorHexA, colorHexB);
    this._injectTurbulenceAndShimmer = origMethod;
  }

  _injectTurbulenceAndShimmer(velocity) {
    const now2 = performance.now() / 1000;
    const sinceLastTrigger = now2 - this._lastTriggerTime;
    this._lastTriggerTime = now2;
    const instantRate = sinceLastTrigger > 0.01 ? 1 / sinceLastTrigger : 20;
    this._triggerRate = this._triggerRate * 0.85 + instantRate * 0.15;
    const adaptiveGain = 0.25 / (1 + this._triggerRate * 0.25);
    const headroom = Math.max(0, 0.7 - this._turbulenceTarget);
    this._turbulenceTarget = Math.min(0.7, this._turbulenceTarget + velocity * adaptiveGain * (0.4 + headroom));

    this._shimmerWaves.push({
      birth: now2,
      speed: 1.0 + Math.random() * 1.2,
      intensity: 0.4 + velocity * 0.6,
      width: 0.3 + Math.random() * 0.6,
      noiseFreq: 6 + Math.random() * 14,
      noiseAmp: 0.2 + Math.random() * 0.4,
    });
  }

  update(deltaTime) {
    // Full update: manage own state + update particles
    this._globalAngle -= this._spinSpeed * deltaTime;

    // Smooth turbulence toward target, then decay target
    const decayRate = 1.0 + this._triggerRate * 0.3;
    this._turbulence += (this._turbulenceTarget - this._turbulence) * deltaTime * 2;
    this._turbulenceTarget *= (1 - deltaTime * decayRate);
    this._triggerRate *= (1 - deltaTime * 0.5);

    // Expire old shimmer + arm waves
    const nowSec = performance.now() / 1000;
    this._shimmerWaves = this._shimmerWaves.filter(w => (nowSec - w.birth) < 5.0);
    this._armWaves = this._armWaves.filter(w => (nowSec - w.birth) < w.maxLife);

    this._updateParticlesOnly(deltaTime);
  }

  /** Update particles without managing globalAngle/shimmer/turbulence state.
   *  Used by LegacyNebulaBackend which receives these from the wrapper. */
  _updateParticlesOnly(deltaTime) {
    const positions = this._posAttr.array;
    const colors = this._colorAttr.array;
    const sizes = this._sizeAttr.array;
    const alphas = this._alphaAttr.array;
    let anyAlive = false;
    const now = performance.now() / 1000;

    for (let i = 0; i < MAX_NEBULA_PARTICLES; i++) {
      const p = this._particles[i];
      if (!p.alive) continue;
      anyAlive = true;

      p.age += deltaTime;

      if (p.age >= p.maxLife) {
        p.alive = false;
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }

      // Fade particles approaching orbit ring edge
      if (p.r > 4.0) {
        p.maxLife = Math.min(p.maxLife, p.age + 1.0);
        p.fadeStart = Math.min(p.fadeStart, p.age);
      }

      // ── Motion — gentle drift so particles travel further ──
      p.r += 0.012 * deltaTime * (1 + p.velocity * 0.3);

      // Follow spiral arm, but with radius-dependent looseness
      const armTheta = this._spiralArm(p.r, p.armIndex);
      // Very slow decay — particles stay scattered
      p.armOffset *= (1 - deltaTime * 0.02);
      // Oscillation amplitude larger near center, smaller at tips
      const oscAmp = 0.02 / (0.3 + p.r);
      p.armOffset += Math.sin(p.age * 1.5 + i * 0.7) * oscAmp * deltaTime;

      p.theta = armTheta + p.armOffset;
      p.r = Math.max(0.02, p.r);

      // ── Fade envelope ──
      let fade = 1.0;
      if (p.age < 0.5) {
        fade = p.age / 0.5;
      }
      if (p.age > p.fadeStart) {
        fade *= 1.0 - (p.age - p.fadeStart) / (p.maxLife - p.fadeStart);
      }
      // Dim with distance — blend to dust at arm tips
      const radiusDim = Math.max(0.2, 1.0 - (p.r / 4.5));
      fade = Math.max(0, Math.min(1, fade * radiusDim));

      // ── Write position (with turbulence near center) ──
      const i3 = i * 3;
      const worldTheta = p.theta + this._globalAngle;
      // Turbulence: stronger near center, fades with radius
      const turbFalloff = Math.pow(Math.max(0, 1 - p.r / 3.5), 2); // quadratic taper
      const turbScale = this._turbulence * turbFalloff * 0.20;
      let turbX = Math.sin(p.age * 3.7 + i * 1.3) * turbScale;
      let turbY = Math.cos(p.age * 2.9 + i * 0.7) * turbScale;
      // Arm-wave contribution — tight band of amplified turbulence travelling
      // outward along this particle's arm. Added on top of the ambient
      // turbulence for a brief, localized "shockwave" passage.
      // armSparkle     — flickery sparkle (drives size/alpha twinkle)
      // armBandStrength — steady envelope value (drives saturation)
      // armHueAngle    — final hue rotation angle from the dominant wave,
      //                  incorporates that wave's randomized amplitude+sign
      let armSparkle = 0;
      let armBandStrength = 0;
      let armHueAngle = 0;
      if (this._armWaves.length > 0) {
        for (const aw of this._armWaves) {
          if (aw.armIndex !== p.armIndex) continue;
          const wAge = now - aw.birth;
          const wFront = wAge * aw.speed;
          const wDist = Math.abs(p.r - wFront);
          if (wDist < aw.width) {
            // Soft (1-x²)² envelope — smooth at both center and edges,
            // producing a gentler-feeling wave crest than a cosine.
            const x = wDist / aw.width;
            const bandEnv = Math.pow(1 - x * x, 2);
            const lifeFade = Math.max(0, 1 - wAge / aw.maxLife);
            // Suppress displacement near the galactic center — particles are
            // densely clustered there and large motion looks frantic. Ramps
            // from 0.3 at r=0 to 1.0 by wFront ≈ 1.0.
            const cT = Math.max(0, Math.min(1, wFront / 1.0));
            const centerFade = 0.3 + 0.7 * cT * cT * (3 - 2 * cT);
            const push = aw.intensity * bandEnv * lifeFade * centerFade * 0.07;
            // Oscillation frequencies lowered so particles undulate slowly
            // rather than vibrating — reads as a flowing ripple, not static.
            turbX += Math.sin(p.age * 2.3 + i * 2.7 + wAge * 1.4) * push;
            turbY += Math.cos(p.age * 2.0 + i * 2.1 + wAge * 1.2) * push;

            // Steady strength — no flicker. Used for color operations
            // (saturation + hue shift) so they read as a smooth band rather
            // than a twinkly one.
            const steady = bandEnv * lifeFade * aw.intensity;
            if (steady > armBandStrength) {
              armBandStrength = steady;
              // Use THIS wave's randomized hueMul (signed amplitude) so
              // different arms/waves produce different chromatic shifts.
              armHueAngle = steady * (aw.hueMul ?? 0);
            }

            // Flickery sparkle — used only for size/alpha twinkle. Uses the
            // particle's own shimmerPhase for unique twinkle.
            const flick = 0.5 + 0.5 *
              Math.sin(p.shimmerPhase + wAge * 4.2 + p.age * 3.1);
            const spark = steady * flick * 0.55;
            if (spark > armSparkle) armSparkle = spark;
          }
        }
      }
      positions[i3] = p.r * Math.cos(worldTheta) + turbX;
      positions[i3 + 1] = p.r * Math.sin(worldTheta) + turbY;
      positions[i3 + 2] = p.z;

      // ── Shimmer waves — per-particle sparkle (some immune for negative space) ──
      let pShimmer = 0;
      let particleFlickerPeak = 0;
      if (!p.shimmerImmune) for (const w of this._shimmerWaves) {
        const wAge = now - w.birth;
        const wFront = wAge * w.speed;
        const wDist = Math.abs(p.r - wFront);
        if (wDist < w.width) {
          const wFade = 1 - wAge / 5.0;
          const wPeak = Math.cos((wDist / w.width) * Math.PI * 0.5);
          // Layered per-particle flicker — multiple frequencies for depth
          const f1 = Math.sin(p.shimmerPhase + p.age * p.shimmerSpeed + wAge * w.noiseFreq);
          const f2 = Math.sin(p.shimmerPhase * 2.3 + p.age * p.shimmerSpeed * 0.7 + wAge * 3.1);
          const f3 = Math.sin(p.shimmerPhase * 0.6 + p.age * p.shimmerSpeed * 1.8 + i * 0.4);
          const particleFlicker = 0.3 + 0.7 * Math.max(0, (f1 * 0.5 + f2 * 0.3 + f3 * 0.2));
          particleFlickerPeak = Math.max(particleFlickerPeak, particleFlicker);
          // Spatial noise — multi-scale along arm
          const s1 = Math.sin(p.theta * w.noiseFreq + p.r * 8);
          const s2 = Math.sin(p.theta * w.noiseFreq * 2.7 + p.r * 13 + wAge * 2);
          const spatialNoise = 0.3 + 0.7 * ((s1 * 0.6 + s2 * 0.4 + 1) * 0.5);
          const combined = wPeak * particleFlicker * spatialNoise;
          pShimmer = Math.max(pShimmer, combined * w.intensity * Math.max(0, wFade));
        }
      }
      // ── Write color, size, alpha ──
      const shimmerSizeBoost = 1 + pShimmer * 0.5;
      // Arm-wave sparkle adds a light, non-saturating boost to size + alpha
      // so the wave crest picks up a gentle twinkle without competing with
      // the full shimmer-wave sparkle pass.
      const armSizeBoost = 1 + armSparkle * 0.35;
      const armAlphaBoost = 1 + armSparkle * 0.25;
      sizes[i] = 0.08 * shimmerSizeBoost * armSizeBoost;
      alphas[i] = Math.min(1, fade * p.alphaVar * armAlphaBoost);

      // Saturation push — strongest contributor wins. Shimmer waves push
      // hardest; transpose arm-wave adds a gentler saturation bump driven
      // by the steady band envelope (not the flickery sparkle).
      const satBoost = Math.max(pShimmer * 0.6, armBandStrength * 0.5);
      let sr = p.baseColor.r;
      let sg = p.baseColor.g;
      let sb = p.baseColor.b;
      if (satBoost > 0.01) {
        const maxC = Math.max(sr, sg, sb, 0.01);
        sr += (sr / maxC - sr) * satBoost;
        sg += (sg / maxC - sg) * satBoost;
        sb += (sb / maxC - sb) * satBoost;
      }

      // Hue shift — applied inside the arm-wave band so the transpose wave
      // reads as a chromatic ripple sliding down each arm. Direction and
      // amplitude come from the dominant wave's randomized hueMul (set at
      // spawn time in fireArmWaves), so each transpose event produces a
      // different chromatic character per arm. Luminance-preserving RGB
      // rotation matrix keeps brightness stable.
      if (armBandStrength > 0.02 && armHueAngle !== 0) {
        const cosA = Math.cos(armHueAngle);
        const sinA = Math.sin(armHueAngle);
        const oneThird = 1 / 3;
        const k = Math.sqrt(oneThird) * sinA;
        const m1 = cosA + (1 - cosA) * oneThird;
        const m2 = (1 - cosA) * oneThird - k;
        const m3 = (1 - cosA) * oneThird + k;
        const hr = sr * m1 + sg * m2 + sb * m3;
        const hg = sr * m3 + sg * m1 + sb * m2;
        const hb = sr * m2 + sg * m3 + sb * m1;
        sr = Math.max(0, hr);
        sg = Math.max(0, hg);
        sb = Math.max(0, hb);
      }

      if (pShimmer > 0.01) {
        // Sparkles emerge from the accretion ring outward, not from center
        // Probability ramps from 0 at r<0.5 to full at r>1.5
        const sparkleChance = Math.max(0, Math.min(1, (p.r - 0.5) / 1.0));
        const isSparkle = particleFlickerPeak > 0.88 && Math.random() < sparkleChance;

        if (isSparkle) {
          // Sparse bright sparkle on top of enriched color
          const sparkleBoost = 1 + pShimmer * 1.4;
          colors[i3]     = Math.min(1, sr * sparkleBoost);
          colors[i3 + 1] = Math.min(1, sg * sparkleBoost);
          colors[i3 + 2] = Math.min(1, sb * sparkleBoost);
        } else {
          // Enriched shimmer — more vivid, modest brightness
          const colorBoost = 1 + pShimmer * 0.5;
          colors[i3]     = Math.min(1, sr * colorBoost);
          colors[i3 + 1] = Math.min(1, sg * colorBoost);
          colors[i3 + 2] = Math.min(1, sb * colorBoost);
        }
      } else if (armBandStrength > 0.01) {
        // Arm-wave-only path — saturation + hue shift applied above; no
        // shimmer-pipeline brightness layer. Reads as a smoothly colored
        // band rolling down the arm.
        colors[i3]     = Math.min(1, sr);
        colors[i3 + 1] = Math.min(1, sg);
        colors[i3 + 2] = Math.min(1, sb);
      } else {
        colors[i3]     = p.baseColor.r;
        colors[i3 + 1] = p.baseColor.g;
        colors[i3 + 2] = p.baseColor.b;
      }
    }

    if (anyAlive) {
      this._posAttr.needsUpdate = true;
      this._colorAttr.needsUpdate = true;
      this._sizeAttr.needsUpdate = true;
      this._alphaAttr.needsUpdate = true;
    }

    // ── Update dust particles ──
    const dustPos = this._dustPosAttr.array;
    const dustCol = this._dustColorAttr.array;
    const dustSizes = this._dustSizeAttr.array;
    const dustAlphas = this._dustAlphaAttr.array;
    let anyDust = false;

    for (let i = 0; i < MAX_DUST_PARTICLES; i++) {
      const d = this._dustParticles[i];
      if (!d.alive) continue;
      anyDust = true;

      d.age += deltaTime;

      if (d.age >= d.maxLife) {
        d.alive = false;
        dustSizes[i] = 0;
        dustAlphas[i] = 0;
        continue;
      }

      if (d.r > 4.0) {
        d.maxLife = Math.min(d.maxLife, d.age + 1.0);
        d.fadeStart = Math.min(d.fadeStart, d.age);
      }

      // Slow drift outward
      d.r += 0.010 * deltaTime;

      // Follow arm
      const armT = this._spiralArm(d.r, d.armIndex);
      d.armOffset *= (1 - deltaTime * 0.015);
      d.theta = armT + d.armOffset;
      d.r = Math.max(0.25, d.r); // maintain hollow center

      // Fade
      let fade = 1.0;
      if (d.age < 0.8) fade = d.age / 0.8;
      if (d.age > d.fadeStart) {
        fade *= 1.0 - (d.age - d.fadeStart) / (d.maxLife - d.fadeStart);
      }
      fade = Math.max(0, Math.min(1, fade));

      // ── Shimmer waves — per-particle sparkle (some immune) ──
      let shimmer = 0;
      let dustFlickerPeak = 0;
      if (!d.shimmerImmune) for (const w of this._shimmerWaves) {
        const waveAge = now - w.birth;
        const waveFront = waveAge * w.speed;
        const dist = Math.abs(d.r - waveFront);
        if (dist < w.width) {
          const waveFade = 1 - waveAge / 5.0;
          const peak = Math.cos((dist / w.width) * Math.PI * 0.5);
          const df1 = Math.sin(d.shimmerPhase + d.age * d.shimmerSpeed + waveAge * w.noiseFreq);
          const df2 = Math.sin(d.shimmerPhase * 2.3 + d.age * d.shimmerSpeed * 0.7 + waveAge * 3.1);
          const df3 = Math.sin(d.shimmerPhase * 0.6 + d.age * d.shimmerSpeed * 1.8 + i * 0.4);
          const particleFlicker = 0.3 + 0.7 * Math.max(0, (df1 * 0.5 + df2 * 0.3 + df3 * 0.2));
          dustFlickerPeak = Math.max(dustFlickerPeak, particleFlicker);
          const ds1 = Math.sin(d.theta * w.noiseFreq + d.r * 8);
          const ds2 = Math.sin(d.theta * w.noiseFreq * 2.7 + d.r * 13 + waveAge * 2);
          const spatialNoise = 0.3 + 0.7 * ((ds1 * 0.6 + ds2 * 0.4 + 1) * 0.5);
          const combined = peak * particleFlicker * spatialNoise;
          shimmer = Math.max(shimmer, combined * w.intensity * Math.max(0, waveFade));
        }
      }

      const i3 = i * 3;
      const wt = d.theta + this._globalAngle;
      const dTurbFalloff = Math.pow(Math.max(0, 1 - d.r / 3.5), 2);
      const dTurbScale = this._turbulence * dTurbFalloff * 0.12;
      let dTurbX = Math.sin(d.age * 4.1 + i * 1.1) * dTurbScale;
      let dTurbY = Math.cos(d.age * 3.3 + i * 0.9) * dTurbScale;
      // Arm-wave contribution for dust — smaller magnitude than the main
      // particles (dust is secondary visual layer).
      let dArmSparkle = 0;
      let dArmBandStrength = 0;
      let dArmHueAngle = 0;
      if (this._armWaves.length > 0) {
        for (const aw of this._armWaves) {
          if (aw.armIndex !== d.armIndex) continue;
          const wAge = now - aw.birth;
          const wFront = wAge * aw.speed;
          const wDist = Math.abs(d.r - wFront);
          if (wDist < aw.width) {
            const x = wDist / aw.width;
            const bandEnv = Math.pow(1 - x * x, 2);
            const lifeFade = Math.max(0, 1 - wAge / aw.maxLife);
            const cT = Math.max(0, Math.min(1, wFront / 1.0));
            const centerFade = 0.3 + 0.7 * cT * cT * (3 - 2 * cT);
            const push = aw.intensity * bandEnv * lifeFade * centerFade * 0.045;
            dTurbX += Math.sin(d.age * 2.4 + i * 2.3 + wAge * 1.4) * push;
            dTurbY += Math.cos(d.age * 2.1 + i * 1.9 + wAge * 1.2) * push;

            // Steady envelope (no flicker) — drives saturation + hue shift.
            const steady = bandEnv * lifeFade * aw.intensity;
            if (steady > dArmBandStrength) {
              dArmBandStrength = steady;
              // Dust gets ~83% of the main particle hue amplitude — same
              // direction as the main layer since they share wave.hueMul.
              dArmHueAngle = steady * (aw.hueMul ?? 0) * 0.83;
            }

            // Flickery sparkle — drives size/alpha twinkle only.
            const flick = 0.5 + 0.5 *
              Math.sin((d.shimmerPhase ?? i * 0.37) + wAge * 4.2 + d.age * 3.1);
            const spark = steady * flick * 0.4;
            if (spark > dArmSparkle) dArmSparkle = spark;
          }
        }
      }
      dustPos[i3] = d.r * Math.cos(wt) + dTurbX;
      dustPos[i3 + 1] = d.r * Math.sin(wt) + dTurbY;
      dustPos[i3 + 2] = d.z;

      const shimmerSizeBoost = 1 + shimmer * 0.3;
      const dArmSizeBoost = 1 + dArmSparkle * 0.25;
      const dArmAlphaBoost = 1 + dArmSparkle * 0.2;
      dustSizes[i] = 0.04 * shimmerSizeBoost * dArmSizeBoost;
      dustAlphas[i] = Math.min(1, fade * d.alphaVar * dArmAlphaBoost);

      // Combined saturation push — shimmer wins when both active; arm-wave
      // provides a smaller push driven by steady band envelope.
      const dSatBoost = Math.max(shimmer * 0.6, dArmBandStrength * 0.4);
      let sr = d.baseColor.r;
      let sg = d.baseColor.g;
      let sb = d.baseColor.b;
      if (dSatBoost > 0.01) {
        const maxC = Math.max(sr, sg, sb, 0.01);
        sr += (sr / maxC - sr) * dSatBoost;
        sg += (sg / maxC - sg) * dSatBoost;
        sb += (sb / maxC - sb) * dSatBoost;
      }

      // Hue shift on arm-wave dust — uses the dominant wave's signed
      // randomized amplitude; dust shifts in the same direction as the
      // main particles (both draw from wave.hueMul).
      if (dArmBandStrength > 0.02 && dArmHueAngle !== 0) {
        const cosA = Math.cos(dArmHueAngle);
        const sinA = Math.sin(dArmHueAngle);
        const oneThird = 1 / 3;
        const k = Math.sqrt(oneThird) * sinA;
        const m1 = cosA + (1 - cosA) * oneThird;
        const m2 = (1 - cosA) * oneThird - k;
        const m3 = (1 - cosA) * oneThird + k;
        const hr = sr * m1 + sg * m2 + sb * m3;
        const hg = sr * m3 + sg * m1 + sb * m2;
        const hb = sr * m2 + sg * m3 + sb * m1;
        sr = Math.max(0, hr);
        sg = Math.max(0, hg);
        sb = Math.max(0, hb);
      }

      if (shimmer > 0.01) {
        const dSparkleChance = Math.max(0, Math.min(1, (d.r - 0.5) / 1.0));
        const isSparkle = dustFlickerPeak > 0.88 && Math.random() < dSparkleChance;

        if (isSparkle) {
          const sparkleBoost = 1 + shimmer * 1.4;
          dustCol[i3]     = Math.min(1, sr * sparkleBoost);
          dustCol[i3 + 1] = Math.min(1, sg * sparkleBoost);
          dustCol[i3 + 2] = Math.min(1, sb * sparkleBoost);
        } else {
          const colorBoost = 1 + shimmer * 0.5;
          dustCol[i3]     = Math.min(1, sr * colorBoost);
          dustCol[i3 + 1] = Math.min(1, sg * colorBoost);
          dustCol[i3 + 2] = Math.min(1, sb * colorBoost);
        }
      } else if (dArmBandStrength > 0.01) {
        // Arm-wave-only — saturation + hue shift applied above; no shimmer
        // brightness layer. Smooth colored band rolling down the arm.
        dustCol[i3]     = Math.min(1, sr);
        dustCol[i3 + 1] = Math.min(1, sg);
        dustCol[i3 + 2] = Math.min(1, sb);
      } else {
        dustCol[i3]     = d.baseColor.r;
        dustCol[i3 + 1] = d.baseColor.g;
        dustCol[i3 + 2] = d.baseColor.b;
      }
    }

    if (anyDust) {
      this._dustPosAttr.needsUpdate = true;
      this._dustColorAttr.needsUpdate = true;
      this._dustSizeAttr.needsUpdate = true;
      this._dustAlphaAttr.needsUpdate = true;
    }

    // ── Update cloud particles ──
    const cloudPos = this._cloudPosAttr.array;
    const cloudCol = this._cloudColorAttr.array;
    const cloudSizes = this._cloudSizeAttr.array;
    const cloudAlphas = this._cloudAlphaAttr.array;
    let anyCloud = false;

    // Update cloud shader time
    this._cloudMaterial.uniforms.uTime.value = now;

    for (let i = 0; i < MAX_CLOUD_PARTICLES; i++) {
      const cp = this._cloudParticles[i];
      if (!cp.alive) continue;
      anyCloud = true;

      cp.age += deltaTime;

      if (cp.age >= cp.maxLife) {
        cp.alive = false;
        cloudSizes[i] = 0;
        cloudAlphas[i] = 0;
        continue;
      }

      if (cp.r > 4.0) {
        cp.maxLife = Math.min(cp.maxLife, cp.age + 2.0);
        cp.fadeStart = Math.min(cp.fadeStart, cp.age);
      }

      // Very slow drift
      cp.r += 0.005 * deltaTime;
      // Slow rotation
      cp.theta += 0.01 * deltaTime;

      // Fade envelope
      let fade = 1.0;
      if (cp.age < 1.5) fade = cp.age / 1.5; // slow fade in
      if (cp.age > cp.fadeStart) {
        fade *= 1.0 - (cp.age - cp.fadeStart) / (cp.maxLife - cp.fadeStart);
      }
      fade = Math.max(0, Math.min(1, fade));

      const i3 = i * 3;
      const wt = cp.theta + this._globalAngle;
      cloudPos[i3] = cp.r * Math.cos(wt);
      cloudPos[i3 + 1] = cp.r * Math.sin(wt);
      cloudPos[i3 + 2] = cp.z;

      cloudSizes[i] = cp.baseSize;
      // Opacity ramps from high at center to low at edges
      const centerBoost = Math.max(0, 1.0 - cp.r / 3.0); // 1.0 at center, 0 at r=3
      const cloudOpacity = 0.04 + centerBoost * 0.20; // 0.04 at edges, 0.24 at center
      cloudAlphas[i] = fade * cloudOpacity;

      cloudCol[i3] = cp.baseColor.r;
      cloudCol[i3 + 1] = cp.baseColor.g;
      cloudCol[i3 + 2] = cp.baseColor.b;
    }

    if (anyCloud) {
      this._cloudPosAttr.needsUpdate = true;
      this._cloudColorAttr.needsUpdate = true;
      this._cloudSizeAttr.needsUpdate = true;
      this._cloudAlphaAttr.needsUpdate = true;
    }

    // ── Update nano particles ──
    const nanoPos = this._nanoPosAttr.array;
    const nanoCol = this._nanoColorAttr.array;
    const nanoSizes = this._nanoSizeAttr.array;
    const nanoAlphas = this._nanoAlphaAttr.array;
    let anyNano = false;

    for (let i = 0; i < MAX_NANO_PARTICLES; i++) {
      const np = this._nanoParticles[i];
      if (!np.alive) continue;
      anyNano = true;

      np.age += deltaTime;

      if (np.age >= np.maxLife) {
        np.alive = false;
        nanoSizes[i] = 0;
        nanoAlphas[i] = 0;
        continue;
      }

      // Moderate outward drift
      np.r += 0.008 * deltaTime;

      // Follow arm loosely
      const armT = this._spiralArm(np.r, np.armIndex);
      // Very slow arm tightening — keeps disc-like spread
      np.armOffset *= (1 - deltaTime * 0.005);
      // Add orbital motion for more lively movement
      np.theta = armT + np.armOffset;
      np.theta += 0.04 * deltaTime / (0.3 + np.r);

      // Clamp to annular ring
      const nanoOuterR = this._orbitRadius * 0.35;
      if (np.r > nanoOuterR) {
        np.maxLife = Math.min(np.maxLife, np.age + 0.5);
        np.fadeStart = Math.min(np.fadeStart, np.age);
      }
      np.r = Math.max(0.25, np.r);

      // Fade
      let fade = 1.0;
      if (np.age < 0.3) fade = np.age / 0.3;
      if (np.age > np.fadeStart) {
        fade *= 1.0 - (np.age - np.fadeStart) / (np.maxLife - np.fadeStart);
      }
      fade = Math.max(0, Math.min(1, fade));

      const i3 = i * 3;
      const wt = np.theta + this._globalAngle;
      nanoPos[i3] = np.r * Math.cos(wt);
      nanoPos[i3 + 1] = np.r * Math.sin(wt);
      nanoPos[i3 + 2] = np.z;

      nanoSizes[i] = 0.012;
      nanoAlphas[i] = fade * np.alphaVar;

      nanoCol[i3] = np.baseColor.r;
      nanoCol[i3 + 1] = np.baseColor.g;
      nanoCol[i3 + 2] = np.baseColor.b;
    }

    if (anyNano) {
      this._nanoPosAttr.needsUpdate = true;
      this._nanoColorAttr.needsUpdate = true;
      this._nanoSizeAttr.needsUpdate = true;
      this._nanoAlphaAttr.needsUpdate = true;
    }

    // ── Rotate trail lines with the slow global rotation ──
    for (const trail of this._trails) {
      trail.line.rotation.z = this._globalAngle;
    }
  }


  get globalAngle() { return this._globalAngle; }
  set spinSpeed(val) { this._spinSpeed = val; }

  /** Rebuild spiral arm trail lines (e.g., after node colors become available) */
  _rebuildTrails() {
    // Dispose existing trails
    for (const trail of this._trails) {
      trail.geometry.dispose();
      trail.line.material.dispose();
      this._group.remove(trail.line);
    }
    this._trails = [];

    // Recreate with current colors
    for (let a = 0; a < this._numArms; a++) {
      const trailPts = 120;
      const trailPositions = new Float32Array(trailPts * 3);
      const trailGeo = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(trailPositions, 3);
      trailGeo.setAttribute('position', posAttr);

      let armColor = 0x333355;
      if (this._nodeColors && this._nodeColors[a] !== undefined) {
        const c = new THREE.Color(this._nodeColors[a]);
        c.multiplyScalar(0.35);
        armColor = c;
      }

      const trailMat = new THREE.LineDashedMaterial({
        color: armColor,
        transparent: true,
        opacity: 0.3,
        blending: THREE.NormalBlending,
        depthWrite: false,
        dashSize: 0.08,
        gapSize: 0.06,
      });

      for (let i = 0; i < trailPts; i++) {
        const t = i / trailPts;
        const r = 0.25 + t * (this._orbitRadius - 0.25);
        const theta = this._spiralArm(r, a);
        trailPositions[i * 3] = r * Math.cos(theta);
        trailPositions[i * 3 + 1] = r * Math.sin(theta);
        trailPositions[i * 3 + 2] = 0;
      }

      const line = new THREE.Line(trailGeo, trailMat);
      line.computeLineDistances();
      this._group.add(line);
      this._trails.push({ line, geometry: trailGeo, positions: trailPositions, trailPts });
    }
  }

  dispose() {
    this._geometry.dispose();
    this._material.dispose();
    this._group.remove(this._points);
    this._dustGeometry.dispose();
    this._dustMaterial.dispose();
    this._group.remove(this._dustPoints);
    this._cloudGeometry.dispose();
    this._cloudMaterial.dispose();
    this._group.remove(this._cloudPoints);
    this._nanoGeometry.dispose();
    this._nanoMaterial.dispose();
    this._group.remove(this._nanoPoints);
    for (const trail of this._trails) {
      trail.geometry.dispose();
      trail.line.material.dispose();
      this._group.remove(trail.line);
    }
    this._trails = [];
  }

  _findCloudSlot() {
    for (let n = 0; n < MAX_CLOUD_PARTICLES; n++) {
      const idx = (this._cloudCursor + n) % MAX_CLOUD_PARTICLES;
      if (!this._cloudParticles[idx].alive) {
        this._cloudCursor = (idx + 1) % MAX_CLOUD_PARTICLES;
        return idx;
      }
    }
    let oldestIdx = 0;
    let oldestRatio = 0;
    for (let i = 0; i < MAX_CLOUD_PARTICLES; i++) {
      const ratio = this._cloudParticles[i].age / this._cloudParticles[i].maxLife;
      if (ratio > oldestRatio) { oldestRatio = ratio; oldestIdx = i; }
    }
    this._cloudCursor = (oldestIdx + 1) % MAX_CLOUD_PARTICLES;
    return oldestIdx;
  }

  _findNanoSlot() {
    for (let n = 0; n < MAX_NANO_PARTICLES; n++) {
      const idx = (this._nanoCursor + n) % MAX_NANO_PARTICLES;
      if (!this._nanoParticles[idx].alive) {
        this._nanoCursor = (idx + 1) % MAX_NANO_PARTICLES;
        return idx;
      }
    }
    let oldestIdx = 0;
    let oldestRatio = 0;
    for (let i = 0; i < MAX_NANO_PARTICLES; i++) {
      const ratio = this._nanoParticles[i].age / this._nanoParticles[i].maxLife;
      if (ratio > oldestRatio) { oldestRatio = ratio; oldestIdx = i; }
    }
    this._nanoCursor = (oldestIdx + 1) % MAX_NANO_PARTICLES;
    return oldestIdx;
  }

  _normColor(colorHex, target = 0.22) {
    const c = new THREE.Color(colorHex);
    const lum = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
    if (lum > 0.01) {
      const s = target / lum;
      c.r = Math.min(1, c.r * s);
      c.g = Math.min(1, c.g * s);
      c.b = Math.min(1, c.b * s);
    }
    return c;
  }

  _spiralArm(r, armIndex) {
    // Evenly spaced arms — tips land exactly at node initial positions on orbit ring.
    // Subtract the spiral offset at orbitRadius so tip angle = node angle.
    const baseAngle = (armIndex / this._numArms) * Math.PI * 2;
    const tipOffset = this._tightness * Math.log(Math.max(this._orbitRadius, 0.01));
    return baseAngle + this._tightness * Math.log(Math.max(r, 0.01)) - tipOffset;
  }

  _findDustSlot() {
    for (let n = 0; n < MAX_DUST_PARTICLES; n++) {
      const idx = (this._dustCursor + n) % MAX_DUST_PARTICLES;
      if (!this._dustParticles[idx].alive) {
        this._dustCursor = (idx + 1) % MAX_DUST_PARTICLES;
        return idx;
      }
    }
    let oldestIdx = 0;
    let oldestRatio = 0;
    for (let i = 0; i < MAX_DUST_PARTICLES; i++) {
      const ratio = this._dustParticles[i].age / this._dustParticles[i].maxLife;
      if (ratio > oldestRatio) { oldestRatio = ratio; oldestIdx = i; }
    }
    this._dustCursor = (oldestIdx + 1) % MAX_DUST_PARTICLES;
    return oldestIdx;
  }

  _findSlot() {
    for (let n = 0; n < MAX_NEBULA_PARTICLES; n++) {
      const idx = (this._cursor + n) % MAX_NEBULA_PARTICLES;
      if (!this._particles[idx].alive) {
        this._cursor = (idx + 1) % MAX_NEBULA_PARTICLES;
        return idx;
      }
    }
    let oldestIdx = 0;
    let oldestRatio = 0;
    for (let i = 0; i < MAX_NEBULA_PARTICLES; i++) {
      const ratio = this._particles[i].age / this._particles[i].maxLife;
      if (ratio > oldestRatio) {
        oldestRatio = ratio;
        oldestIdx = i;
      }
    }
    this._cursor = (oldestIdx + 1) % MAX_NEBULA_PARTICLES;
    return oldestIdx;
  }
}

// ── Orbit Ring ────────────────────────────────────────────────────

/** Create a glowing ring (circle outline) */
export function createOrbitRing(radius, color = 0x333366, segments = 128) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(
      Math.cos(angle) * radius,
      Math.sin(angle) * radius,
      0
    ));
  }

  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });

  return new THREE.Line(geometry, material);
}

/** Compute the XY world position of vertex `i` of a regular N-gon at given radius. */
export function polygonVertexPos(radius, sides, i) {
  // Rotate -90° so vertex 0 sits at the top of the ring for visual clarity
  const a = (i / sides) * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
}

/**
 * Build a regular N-gon line loop (harmonic orbit visual).
 * Uses a slightly bolder material than `createOrbitRing` so the polygon
 * reads as visually distinct from the circular orbit rings.
 */
export function createOrbitPolygon(radius, sides, color = 0xff66aa) {
  const points = [];
  for (let i = 0; i <= sides; i++) {
    const v = polygonVertexPos(radius, sides, i % sides);
    points.push(new THREE.Vector3(v.x, v.y, 0));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.85,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  return new THREE.Line(geometry, material);
}

/**
 * Stella octangula — the stellation of the regular octahedron, a compound
 * of two interpenetrating tetrahedra sharing an inscribed cube. The canonical
 * "3D star of David" shape. 8 outer vertices, 12 edges (6 per tetrahedron).
 *
 * Returns a BufferGeometry suitable for `THREE.LineSegments` (positions are
 * laid out as pairs of endpoints, one pair per edge).
 */
export function createStellaOctangulaEdges(radius = 1) {
  const s = radius / Math.sqrt(3); // cube half-side such that vertices sit at `radius`
  // 8 vertices of the inscribed cube. Indices 0-3 form tetrahedron A,
  // indices 4-7 form tetrahedron B (alternating cube vertices).
  const v = [
    [ s,  s,  s], [ s, -s, -s], [-s,  s, -s], [-s, -s,  s], // tetra A
    [-s,  s,  s], [ s,  s, -s], [ s, -s,  s], [-s, -s, -s], // tetra B
  ];
  // Each tetrahedron has 6 edges — 12 total.
  const edges = [
    [0,1],[0,2],[0,3],[1,2],[1,3],[2,3],
    [4,5],[4,6],[4,7],[5,6],[5,7],[6,7],
  ];
  const positions = [];
  for (const [a, b] of edges) {
    positions.push(v[a][0], v[a][1], v[a][2]);
    positions.push(v[b][0], v[b][1], v[b][2]);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geom;
}

/**
 * Spiked icosahedron — an icosahedron (20 triangular faces) with a pyramid
 * spike extruded outward from each face centroid. Visually akin to the
 * Kepler-Poinsot great dodecahedron/great icosahedron family. Produces
 * an aggressive, many-pointed "star ball" wireframe.
 *
 * @param {number} radius - size of the base icosahedron
 * @param {number} spikeFactor - how far each spike extrudes beyond the
 *        base (as a fraction of radius). 0 = no spikes, 1 = radius-length
 *        spikes.
 */
export function createSpikedIcosahedronEdges(radius = 1, spikeFactor = 0.55) {
  const base = new THREE.IcosahedronGeometry(radius, 0);
  const pos = base.attributes.position;
  const segments = [];

  // IcosahedronGeometry is non-indexed in modern three.js: every 3 verts
  // form one triangular face. 20 faces × 3 verts = 60 positions.
  for (let i = 0; i < pos.count; i += 3) {
    const ax = pos.getX(i),     ay = pos.getY(i),     az = pos.getZ(i);
    const bx = pos.getX(i + 1), by = pos.getY(i + 1), bz = pos.getZ(i + 1);
    const cx = pos.getX(i + 2), cy = pos.getY(i + 2), cz = pos.getZ(i + 2);
    // Face centroid → normalize → push out for spike tip
    const ccx = (ax + bx + cx) / 3;
    const ccy = (ay + by + cy) / 3;
    const ccz = (az + bz + cz) / 3;
    const clen = Math.hypot(ccx, ccy, ccz);
    const scale = (radius + radius * spikeFactor) / clen;
    const spx = ccx * scale, spy = ccy * scale, spz = ccz * scale;

    // Original face edges (3) — duplicated with neighboring faces, but
    // redundant line segments are cheap and make the wireframe slightly bolder.
    segments.push(ax, ay, az, bx, by, bz);
    segments.push(bx, by, bz, cx, cy, cz);
    segments.push(cx, cy, cz, ax, ay, az);
    // Spike edges (3) — from each face vertex to the spike tip
    segments.push(ax, ay, az, spx, spy, spz);
    segments.push(bx, by, bz, spx, spy, spz);
    segments.push(cx, cy, cz, spx, spy, spz);
  }

  base.dispose();
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(segments, 3));
  return geom;
}