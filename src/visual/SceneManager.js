import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { AfterimagePass } from 'three/addons/postprocessing/AfterimagePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RGBShiftShader } from 'three/addons/shaders/RGBShiftShader.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createSoftParticleMaterial } from './SoftParticleMaterial.js';

export class SceneManager {
  constructor(containerEl) {
    this.container = containerEl;

    // Soft particle material registry (updated on resize)
    this._softParticleMaterials = [];

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    containerEl.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050510);
    this.scene.fog = new THREE.FogExp2(0x050510, 0.06);

    // Environment map — needed for MeshPhysicalMaterial iridescence to reflect
    // anything (iridescent nodes). Generated once at init, no per-frame cost.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    const envScene = new RoomEnvironment();
    this._envMap = pmrem.fromScene(envScene, 0.04).texture;
    this.scene.environment = this._envMap;
    pmrem.dispose();

    // Camera
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 100);
    this.camera.position.set(0.5932243216769502, -4.40979250323908, 3.5542546184259214);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(0.8839200727001142, -0.42716111489327124, -0.763693798103482);

    // Orbit controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 30;
    this.controls.enablePan = true;
    this.controls.panSpeed = 0.8;
    this.controls.rotateSpeed = 0.8;
    this.controls.zoomSpeed = 1.0;
    this.controls.target.set(0.8839200727001142, -0.42716111489327124, -0.763693798103482);

    // Camera animation state
    this._cameraAnim = null;
    this._orbitMode = false;

    // Post-processing
    this._setupPostProcessing();

    // Background elements
    this._createBackgroundGrid();
    this._createStarField();

    // Resize handling
    this._onResize = this._handleResize.bind(this);
    window.addEventListener('resize', this._onResize);

    // Interrupt orbit mode on user camera interaction (but not zoom)
    this._setupOrbitInterrupt();
  }

  // ── Soft Particle Material Registry ────────────────────────────

  registerSoftParticleMaterial(material) {
    if (material && !this._softParticleMaterials.includes(material)) {
      this._softParticleMaterials.push(material);
    }
  }

  unregisterSoftParticleMaterial(material) {
    const idx = this._softParticleMaterials.indexOf(material);
    if (idx >= 0) this._softParticleMaterials.splice(idx, 1);
  }

  // ── Setup ──────────────────────────────────────────────────────

  _setupPostProcessing() {
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Bloom — (resolution, strength, radius, threshold).
    // Threshold raised from 0.1 to 0.45 so only genuinely bright highlights
    // bloom (iridescent hotspots, trigger flashes) instead of every mid-bright
    // Fresnel edge — which was causing white halos around the sphere nodes.
    this.bloomPass = new UnrealBloomPass(size, 0.4, 0.5, 0.45);
    this.composer.addPass(this.bloomPass);

    // Motion trails
    this.afterimagePass = new AfterimagePass(0.25);
    this.composer.addPass(this.afterimagePass);

    // God rays — radial blur from nebula center
    this._setupGodRays();
    if (this.godRayPass) {
      this.composer.addPass(this.godRayPass);
    }

    // Chromatic aberration — dynamic, spikes on triggers
    this.rgbShiftPass = new ShaderPass(RGBShiftShader);
    this.rgbShiftPass.uniforms['amount'].value = 0.0;
    this.rgbShiftPass.uniforms['angle'].value = 0.0;
    this.composer.addPass(this.rgbShiftPass);
    this._rgbShiftIntensity = 0;
    this._rgbShiftMaxIntensity = 0.4;

    // Vignette — subtle edge darkening (darkness must stay < 1.0 to avoid blowout)
    this.vignettePass = new ShaderPass(VignetteShader);
    this.vignettePass.uniforms['offset'].value = 0.9;
    this.vignettePass.uniforms['darkness'].value = 1.0;
    this.composer.addPass(this.vignettePass);

    this.composer.addPass(new OutputPass());
  }

  _createBackgroundGrid() {
    const gridHelper = new THREE.GridHelper(60, 60, 0x111133, 0x0a0a22);
    gridHelper.position.y = -4;
    gridHelper.material.opacity = 0.25;
    gridHelper.material.transparent = true;
    this.scene.add(gridHelper);
  }

  _createStarField() {
    const count = 1500;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const alphas = new Float32Array(count);

    this._starMeta = new Array(count);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 60;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 60 - 10;

      sizes[i] = 0.04 + Math.random() * 0.04;
      alphas[i] = 0.7;

      this._starMeta[i] = {
        phase: Math.random() * Math.PI * 2,
        speed: 0.5 + Math.random() * 2.0,
        baseSize: sizes[i],
        twinkleAmount: 0,
      };
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this._starSizeAttr = new THREE.BufferAttribute(sizes, 1);
    this._starAlphaAttr = new THREE.BufferAttribute(alphas, 1);
    geometry.setAttribute('aSize', this._starSizeAttr);
    geometry.setAttribute('aAlpha', this._starAlphaAttr);

    const pr = this.renderer.getPixelRatio();
    const material = createSoftParticleMaterial({
      vertexColors: false,
      baseColor: 0x667799,
      glowWidth: 0.2,
      glowIntensity: 0.5,
      pixelRatio: pr,
      canvasHeight: window.innerHeight,
    });

    this.starField = new THREE.Points(geometry, material);
    this._starBaseOpacity = 0.7;
    this._starTwinkle = 0;
    this.scene.add(this.starField);
    this.registerSoftParticleMaterial(material);

    // ── Bright diffraction spike stars (sparse, multicolored, away from center) ──
    this._brightStars = [];
    const brightCount = 25;
    const spikeTexture = this._createDiffractionTexture();
    const minDist = 10; // minimum distance from center

    // Color layer combos — each star gets 3 layers with different hues
    const layerPalettes = [
      [0x88aaff, 0xffaa88, 0xffffff],
      [0xaaddff, 0xffccaa, 0xddddff],
      [0x99ccff, 0xff9977, 0xeeeeff],
      [0xccaaff, 0xffddbb, 0xaaccff],
      [0x77bbff, 0xffbb99, 0xddccff],
      [0xaabbff, 0xffcc88, 0xffeeff],
      [0x88ddff, 0xffaa99, 0xccbbff],
      [0xbbaaff, 0xffeebb, 0x99ddff],
    ];

    for (let i = 0; i < brightCount; i++) {
      // Generate position with minimum distance from origin
      let x, y, z, dist;
      do {
        x = (Math.random() - 0.5) * 55;
        y = (Math.random() - 0.5) * 55;
        z = (Math.random() - 0.5) * 40 - 12;
        dist = Math.sqrt(x * x + y * y + z * z);
      } while (dist < minDist);

      const baseScale = 0.5 + Math.random() * 0.7;
      const baseOpacity = 0.25 + Math.random() * 0.25;
      const palette = layerPalettes[i % layerPalettes.length];

      // Container group for the multi-layer star
      const starGroup = new THREE.Group();
      starGroup.position.set(x, y, z);

      const sprites = [];
      // 3 layers: core (white/bright), warm spike, cool spike — offset rotations
      for (let l = 0; l < 3; l++) {
        const layerMat = new THREE.SpriteMaterial({
          map: spikeTexture,
          color: palette[l],
          transparent: true,
          opacity: baseOpacity * (l === 0 ? 1.0 : 0.5),
          depthWrite: false,
        });
        const layerSprite = new THREE.Sprite(layerMat);
        // Each layer slightly different scale and rotation for chromatic spread
        const layerScale = baseScale * (1 + l * 0.15);
        layerSprite.scale.set(layerScale, layerScale, 1);
        // Rotate each layer's material slightly for spike offset
        layerMat.rotation = l * 0.25; // radians offset between layers
        starGroup.add(layerSprite);
        sprites.push(layerSprite);
      }

      this.starField.add(starGroup);

      this._brightStars.push({
        group: starGroup,
        sprites,
        baseScale,
        baseOpacity,
        phase: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 1.5,
        twinkleAmount: 0,
        rotSpeed: (0.0001 + Math.random() * 0.0003) * (Math.random() < 0.5 ? 1 : -1),
      });
    }

    // ── Shooting stars (very rare) ──
    this._shootingStars = [];
    this._spikeTexture = spikeTexture;
    this._shootingStarChance = 0.00042; // per trigger chance

    // ── Stationary sparkle stars (punctuation for harmonic transposes etc.) ──
    this._stationaryStars = [];
  }

  /**
   * Spawn a big diffraction-spike star at a fixed world position that sparkles
   * in place then fades and dies. Used for punctuation-class events such as
   * harmonic-orbit vertex transposes.
   */
  spawnStationaryStar(x, y, z = 0.1, color = 0xffffff, duration = 1.8, baseScale = 0.55) {
    const tex = this._spikeTexture;
    if (!tex) return;

    const group = new THREE.Group();
    group.position.set(x, y, z);
    const sprites = [];
    // 5-layer diffraction star — same construction as shooting stars, stationary
    for (let l = 0; l < 5; l++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const sp = new THREE.Sprite(mat);
      const lScale = baseScale * (1 + l * 0.18);
      sp.scale.set(lScale, lScale, 1);
      mat.rotation = l * 0.25;
      group.add(sp);
      sprites.push(sp);
    }
    this.scene.add(group);

    this._stationaryStars.push({
      group,
      sprites,
      baseScale,
      life: 0,
      maxLife: duration,
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleFreq: 12 + Math.random() * 18,
      rotSpeed: (0.8 + Math.random() * 1.4) * (Math.random() < 0.5 ? 1 : -1),
    });
  }

  /** Spawn a shooting star — a bright diffraction star that orbits once then vanishes */
  spawnShootingStar() {
    const tex = this._spikeTexture;
    if (!tex) return;

    const palette = [
      [0x99ccff, 0xffbb88, 0xffffff, 0xddaaff, 0xaaeeff],
    ][0];

    const dist = 12;
    // Random orbit axis and start position
    const axisTheta = Math.random() * Math.PI * 2;
    const axisPhi = (Math.random() - 0.5) * Math.PI * 0.8;
    const startAngle = Math.random() * Math.PI * 2;
    const orbitDir = Math.random() < 0.5 ? 1 : -1;
    const orbitSpeed = (0.05 + Math.random() * 0.1) * orbitDir; // rad/s, one full orbit in ~40-120s

    // Build 5-layer star (3 base + 2 extra)
    const baseScale = 0.6 + Math.random() * 0.5;
    const group = new THREE.Group();

    const sprites = [];
    for (let l = 0; l < 5; l++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: palette[l % palette.length],
        transparent: true,
        opacity: l < 2 ? 0.7 : 0.35,
        depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      const lScale = baseScale * (1 + l * 0.12);
      sp.scale.set(lScale, lScale, 1);
      mat.rotation = l * 0.3;
      group.add(sp);
      sprites.push(sp);
    }

    this.scene.add(group);

    this._shootingStars.push({
      group,
      sprites,
      baseScale,
      baseOpacity: 0.7,
      // Orbit params
      dist,
      axisTheta,
      axisPhi,
      angle: startAngle,
      orbitSpeed,
      totalAngle: 0,
      // Animation
      phase: Math.random() * Math.PI * 2,
      rotSpeed: (0.0004 + Math.random() * 0.0006) * (Math.random() < 0.5 ? 1 : -1),
      twinkleAmount: 0.5,
      jitterPhase: Math.random() * 100,
      alive: true,
      // Trail particles
      trail: [],
      trailTimer: 0,
    });
  }

  _createDiffractionTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;

    // Radial glow base
    const radGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
    radGrad.addColorStop(0, 'rgba(255,255,255,1)');
    radGrad.addColorStop(0.05, 'rgba(255,255,255,0.8)');
    radGrad.addColorStop(0.15, 'rgba(255,255,255,0.2)');
    radGrad.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = radGrad;
    ctx.fillRect(0, 0, size, size);

    // Diffraction spikes — 4 pointed star
    ctx.globalCompositeOperation = 'lighter';
    for (let angle = 0; angle < 4; angle++) {
      const a = (angle / 4) * Math.PI + Math.PI / 8; // 45 degree offset
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);

      const spikeGrad = ctx.createLinearGradient(0, 0, size * 0.5, 0);
      spikeGrad.addColorStop(0, 'rgba(255,255,255,0.6)');
      spikeGrad.addColorStop(0.3, 'rgba(255,255,255,0.15)');
      spikeGrad.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.fillStyle = spikeGrad;
      ctx.beginPath();
      ctx.moveTo(0, -1);
      ctx.lineTo(size * 0.5, 0);
      ctx.lineTo(0, 1);
      ctx.closePath();
      ctx.fill();

      // Mirror spike
      ctx.beginPath();
      ctx.moveTo(0, -1);
      ctx.lineTo(-size * 0.5, 0);
      ctx.lineTo(0, 1);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    return new THREE.CanvasTexture(canvas);
  }

  _setupGodRays() {
    // Displayed value (feeds the shader uniform). Smoothly chases the
    // target below, giving the pulse a smooth attack rather than an
    // instant jump, and a slower release curve than simple geometric decay.
    this._godRayIntensity = 0;
    // Raw pulse target — set by triggerLightRayPulse, decays gradually
    // (release envelope). Intensity chases this value each frame.
    this._godRayTarget = 0;
    this._godRayBaseIntensity = 0.4;
    this._godRayCenter = new THREE.Vector2(0.5, 0.5);

    // Separate render target for nebula-only rendering
    const w = window.innerWidth;
    const h = window.innerHeight;
    this._nebulaRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    // God ray shader samples from the nebula-only texture, composites onto main scene
    const godRayShader = {
      uniforms: {
        tDiffuse: { value: null },              // main scene (auto-set by ShaderPass)
        tNebula: { value: this._nebulaRT.texture }, // nebula-only render
        uCenter: { value: this._godRayCenter },
        uIntensity: { value: this._godRayBaseIntensity },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tNebula;
        uniform vec2 uCenter;
        uniform float uIntensity;
        varying vec2 vUv;

        #define SAMPLES 40
        #define DECAY 0.88
        #define DENSITY 0.9
        #define WEIGHT 0.12

        void main() {
          vec4 texColor = texture2D(tDiffuse, vUv);

          vec2 delta = (vUv - uCenter) * DENSITY / float(SAMPLES);
          vec2 coord = vUv;
          float illumination = 1.0;
          vec3 rays = vec3(0.0);

          for (int i = 0; i < SAMPLES; i++) {
            coord -= delta;
            vec2 sc = clamp(coord, vec2(0.0), vec2(1.0));
            // Sample from nebula-only texture — nodes never appear here
            vec3 s = texture2D(tNebula, sc).rgb;
            float lum = dot(s, vec3(0.299, 0.587, 0.114));
            rays += s * lum * illumination * WEIGHT;
            illumination *= DECAY;
          }

          gl_FragColor = vec4(texColor.rgb + rays * uIntensity, texColor.a);
        }
      `,
    };

    this.godRayPass = new ShaderPass(godRayShader);
    this._godRayEnabled = true;

    // Use Three.js layers: layer 1 = nebula only
    // Nebula objects must be assigned to layer 1 (done by Engine when creating nebula)
    this._nebulaLayerCamera = this.camera.clone();
    this._nebulaLayerCamera.layers.set(1); // only render layer 1
  }

  /**
   * Trigger a god-ray pulse. Sets the envelope TARGET, not the displayed
   * intensity — the intensity then smoothly chases the target (smooth
   * attack) while the target itself slowly decays (smooth, longer release).
   */
  triggerLightRayPulse(intensity = 0.3) {
    this._godRayTarget = Math.max(this._godRayTarget, intensity);
  }

  /** Smoothly animate camera back to default view */
  resetCamera() {
    this._orbitMode = false;
    const sidebarOpen = !document.getElementById('config-panel')?.classList.contains('collapsed');
    const xOffset = sidebarOpen ? -2.0 : 0;
    this._cameraAnim = {
      startPos: this.camera.position.clone(),
      startTarget: this.controls.target.clone(),
      endPos: new THREE.Vector3(0.5932243216769502 + xOffset, -4.40979250323908, 3.5542546184259214),
      endTarget: new THREE.Vector3(0.8839200727001142 + xOffset, -0.42716111489327124, -0.763693798103482),
      progress: 0,
      duration: 1.8,
    };
  }

  /** Toggle cinematic orbit mode.
   *  Orbits around the Z axis (disc normal) at a fixed elevation,
   *  keeping the ring flat from the user's perspective.
   */
  toggleOrbitMode() {
    if (this._orbitMode) {
      this._orbitMode = false;
      this._cameraAnim = null;
      return false;
    }

    // Disc is in XY plane at z=0. Camera orbits around Z axis.
    this._orbitMode = true;
    this._orbitElevation = 0.58;    // ~33 degrees above disc plane
    this._orbitSpeed = 0.12;

    // Check if sidebar is open — zoom out more and offset target left
    const sidebarOpen = !document.getElementById('config-panel')?.classList.contains('collapsed');
    this._orbitDistance = sidebarOpen ? 6.5 : 5.5;
    // Offset target to the left (negative X in screen space) when sidebar is open
    this._orbitTarget = sidebarOpen
      ? new THREE.Vector3(-2.0, 0, 0.3)
      : new THREE.Vector3(0, 0, 0.3);

    const rXY = this._orbitDistance * Math.cos(this._orbitElevation);
    const zHeight = this._orbitDistance * Math.sin(this._orbitElevation);

    this._orbitAngle = Math.atan2(this.camera.position.y, this.camera.position.x);

    this._cameraAnim = {
      startPos: this.camera.position.clone(),
      startTarget: this.controls.target.clone(),
      endPos: new THREE.Vector3(
        this._orbitTarget.x + Math.cos(this._orbitAngle) * rXY,
        this._orbitTarget.y + Math.sin(this._orbitAngle) * rXY,
        this._orbitTarget.z + zHeight
      ),
      endTarget: this._orbitTarget.clone(),
      progress: 0,
      duration: 2.0,
    };

    return true;
  }

  /** Stop orbit mode on user interaction (rotate/pan, not zoom) */
  _setupOrbitInterrupt() {
    // OrbitControls emits 'start' when user begins interacting
    this.controls.addEventListener('start', (e) => {
      // Only interrupt on rotate/pan, not zoom
      // OrbitControls doesn't distinguish, so check pointer type
      // Zoom is typically wheel — we detect it by checking if it came from pointerdown
      if (this._orbitMode && e.target) {
        // Slight delay to distinguish zoom wheel from drag
        this._orbitInterruptPending = true;
      }
    });

    // Listen for actual pointer drag (rotate/pan)
    this.renderer.domElement.addEventListener('pointerdown', () => {
      if (this._orbitMode) {
        this._orbitMode = false;
        this._cameraAnim = null;
      }
    });
  }

  /** Trigger chromatic aberration flash on collision */
  triggerChromaticAberration(intensity = 0.5) {
    this._rgbShiftIntensity = Math.max(this._rgbShiftIntensity, intensity * this._rgbShiftMaxIntensity);
  }

  /** Call on note trigger to make stars twinkle */
  triggerStarTwinkle(intensity = 0.5) {
    this._starTwinkle = Math.max(this._starTwinkle, intensity);
    // Randomly boost ~35% of small stars for staggered per-star twinkle
    for (let i = 0; i < this._starMeta.length; i++) {
      if (Math.random() < 0.35) {
        this._starMeta[i].twinkleAmount = Math.max(
          this._starMeta[i].twinkleAmount,
          intensity * (0.6 + Math.random() * 0.5)
        );
      }
    }
    // All diffraction stars get a small pulse, ~40% get a larger one
    if (this._brightStars) {
      for (const bs of this._brightStars) {
        const smallPulse = intensity * 0.18;
        bs.twinkleAmount = Math.max(bs.twinkleAmount, smallPulse);
        if (Math.random() < 0.15) {
          bs.twinkleAmount = Math.max(bs.twinkleAmount, intensity * (0.4 + Math.random() * 0.3));
        }
      }
    }

    // Shooting stars always get strong response
    for (const ss of this._shootingStars) {
      if (ss.alive) {
        ss.twinkleAmount = Math.max(ss.twinkleAmount, intensity * (0.8 + Math.random() * 0.4));
      }
    }

    // Very rare chance to spawn a shooting star on trigger
    if (Math.random() < this._shootingStarChance) {
      this.spawnShootingStar();
    }
  }

  _handleResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    if (this._nebulaRT) this._nebulaRT.setSize(w, h);

    // Update all soft particle material scale uniforms
    const pr = this.renderer.getPixelRatio();
    const scale = h * pr * 0.5;
    for (const mat of this._softParticleMaterials) {
      if (mat.uniforms && mat.uniforms.uScale) {
        mat.uniforms.uScale.value = scale;
      }
    }
  }

  render() {
    this.controls.update();

    // Smooth camera animation (transition to home or orbit start)
    if (this._cameraAnim) {
      const a = this._cameraAnim;
      a.progress += (1 / 60) / a.duration;
      if (a.progress >= 1) {
        this.camera.position.copy(a.endPos);
        this.controls.target.copy(a.endTarget);
        this._cameraAnim = null;
        // If entering orbit mode, seed the angle from final position in XY
        if (this._orbitMode) {
          this._orbitAngle = Math.atan2(a.endPos.y, a.endPos.x);
        }
      } else {
        // Ease in-out (smoothstep)
        const t = a.progress * a.progress * (3 - 2 * a.progress);
        this.camera.position.lerpVectors(a.startPos, a.endPos, t);
        this.controls.target.lerpVectors(a.startTarget, a.endTarget, t);
      }
      this.controls.update();
    }

    // Continuous orbit around Z axis (after transition completes)
    if (this._orbitMode && !this._cameraAnim) {
      this._orbitAngle += this._orbitSpeed * (1 / 60);
      const rXY = this._orbitDistance * Math.cos(this._orbitElevation);
      const zH = this._orbitDistance * Math.sin(this._orbitElevation);
      const t = this._orbitTarget;
      this.camera.position.set(
        t.x + Math.cos(this._orbitAngle) * rXY,
        t.y + Math.sin(this._orbitAngle) * rXY,
        t.z + zH
      );
      this.controls.target.copy(t);
      this.controls.update();
    }

    if (this.starField) {
      this.starField.rotation.y += 0.00005;
      this.starField.rotation.x += 0.00002;

      const now = performance.now() * 0.001;
      const sizes = this._starSizeAttr.array;
      const alphas = this._starAlphaAttr.array;

      // Decay global twinkle trigger
      if (this._starTwinkle > 0.001) {
        this._starTwinkle *= 0.92;
      } else {
        this._starTwinkle = 0;
      }

      // Per-star update
      for (let i = 0; i < this._starMeta.length; i++) {
        const s = this._starMeta[i];

        // Decay per-star twinkle
        if (s.twinkleAmount > 0.001) {
          s.twinkleAmount *= 0.95;
        } else {
          s.twinkleAmount = 0;
        }

        // Baseline gentle oscillation + triggered pulse
        const baseFlicker = 0.85 + 0.15 * Math.sin(now * s.speed + s.phase);
        const triggerBoost = 1 + s.twinkleAmount * 2.0;

        alphas[i] = this._starBaseOpacity * baseFlicker * Math.min(triggerBoost, 2.5);
        sizes[i] = s.baseSize * (1 + s.twinkleAmount * 1.5);
      }

      this._starSizeAttr.needsUpdate = true;
      this._starAlphaAttr.needsUpdate = true;

      // Shooting stars
      for (let si = this._shootingStars.length - 1; si >= 0; si--) {
        const ss = this._shootingStars[si];
        if (!ss.alive) continue;

        // Advance orbit
        const dt = 1 / 60;
        ss.angle += ss.orbitSpeed * dt;
        ss.totalAngle += Math.abs(ss.orbitSpeed * dt);

        // Kill after one full orbit
        if (ss.totalAngle >= Math.PI * 2) {
          ss.alive = false;
          this.scene.remove(ss.group);
          for (const sp of ss.sprites) sp.material.dispose();
          // Clean up remaining trail particles
          for (const tp of ss.trail) {
            this.scene.remove(tp.sprite);
            tp.sprite.material.dispose();
          }
          this._shootingStars.splice(si, 1);
          continue;
        }

        // Position on orbit — tilted circle in 3D
        const ca = Math.cos(ss.angle);
        const sa = Math.sin(ss.angle);
        const ct = Math.cos(ss.axisTheta);
        const st = Math.sin(ss.axisTheta);
        const cp = Math.cos(ss.axisPhi);
        const sp2 = Math.sin(ss.axisPhi);
        // Orbit in local XY, rotated by axis angles
        const lx = ca * ss.dist;
        const ly = sa * ss.dist;
        ss.group.position.set(
          lx * ct - ly * sp2 * st,
          lx * st + ly * sp2 * ct,
          ly * cp
        );

        // Twinkle jitter — constant flicker
        ss.jitterPhase += dt * 15;
        const jitter = 0.7 + 0.3 * Math.sin(ss.jitterPhase) * Math.cos(ss.jitterPhase * 1.7);

        // Fade in/out at orbit start/end
        const progress = ss.totalAngle / (Math.PI * 2);
        const envelope = Math.sin(progress * Math.PI); // 0→1→0 over orbit

        // Strong note response
        if (ss.twinkleAmount > 0.01) {
          ss.twinkleAmount *= 0.90;
        }
        const pulse = 1 + ss.twinkleAmount * 3.5;

        const scale = ss.baseScale * (1 + ss.twinkleAmount * 2.0) * envelope;
        for (let l = 0; l < ss.sprites.length; l++) {
          const spr = ss.sprites[l];
          const lScale = scale * (1 + l * 0.12);
          spr.scale.set(lScale, lScale, 1);
          const lOpacity = (l < 2 ? 0.7 : 0.35) * jitter * envelope * Math.min(pulse, 4.0);
          spr.material.opacity = lOpacity;
          spr.material.rotation += (l + 1) * ss.rotSpeed;
        }

        // ── Trail particles — emit sparkly nano dots behind the star ──
        ss.trailTimer += dt;
        if (ss.trailTimer > 0.03 && envelope > 0.1) { // emit every ~30ms while visible
          ss.trailTimer = 0;
          const pos = ss.group.position;
          const count = 2 + Math.floor(Math.random() * 3);
          for (let t = 0; t < count; t++) {
            const trailColors = [0x99ccff, 0xffbb88, 0xddaaff, 0xaaeeff, 0xffffff];
            const tMat = new THREE.SpriteMaterial({
              color: trailColors[Math.floor(Math.random() * trailColors.length)],
              transparent: true,
              opacity: 0.5 + Math.random() * 0.3,
              depthWrite: false,
            });
            const tSprite = new THREE.Sprite(tMat);
            const tScale = 0.02 + Math.random() * 0.03;
            tSprite.scale.set(tScale, tScale, 1);
            tSprite.position.set(
              pos.x + (Math.random() - 0.5) * 0.15,
              pos.y + (Math.random() - 0.5) * 0.15,
              pos.z + (Math.random() - 0.5) * 0.15
            );
            this.scene.add(tSprite);
            ss.trail.push({
              sprite: tSprite,
              life: 0,
              maxLife: 1.5 + Math.random() * 2.0,
              baseOpacity: tMat.opacity,
              baseScale: tScale,
              vx: (Math.random() - 0.5) * 0.1,
              vy: (Math.random() - 0.5) * 0.1,
              vz: (Math.random() - 0.5) * 0.1,
              flickerPhase: Math.random() * 100,
              flickerSpeed: 10 + Math.random() * 20,
            });
          }
        }

        // Update trail particles
        for (let ti = ss.trail.length - 1; ti >= 0; ti--) {
          const tp = ss.trail[ti];
          tp.life += dt;
          if (tp.life >= tp.maxLife) {
            this.scene.remove(tp.sprite);
            tp.sprite.material.dispose();
            ss.trail.splice(ti, 1);
            continue;
          }
          const tFade = 1 - (tp.life / tp.maxLife);
          tp.flickerPhase += dt * tp.flickerSpeed;
          const sparkle = 0.5 + 0.5 * Math.sin(tp.flickerPhase) * Math.cos(tp.flickerPhase * 1.3);
          tp.sprite.material.opacity = tp.baseOpacity * tFade * sparkle;
          tp.sprite.scale.setScalar(tp.baseScale * (0.5 + tFade * 0.5));
          // Gentle drift
          tp.sprite.position.x += tp.vx * dt;
          tp.sprite.position.y += tp.vy * dt;
          tp.sprite.position.z += tp.vz * dt;
          tp.vx *= 0.97;
          tp.vy *= 0.97;
          tp.vz *= 0.97;
        }
      }

      // Stationary sparkle stars — big diffraction star punctuation that
      // sparkles in place then fades and disposes. Used by the harmonic orbit
      // on transpose events.
      if (this._stationaryStars && this._stationaryStars.length > 0) {
        const ssDt = 1 / 60;
        for (let si = this._stationaryStars.length - 1; si >= 0; si--) {
          const st = this._stationaryStars[si];
          st.life += ssDt;
          const t = st.life / st.maxLife;
          if (t >= 1) {
            this.scene.remove(st.group);
            for (const sp of st.sprites) sp.material.dispose();
            this._stationaryStars.splice(si, 1);
            continue;
          }
          // Envelope: fast fade-in, slow exp-ish fade-out
          const fadeIn = Math.min(1, t / 0.08);
          const fadeOut = 1 - Math.pow(Math.max(0, t - 0.1) / 0.9, 1.6);
          const envelope = fadeIn * Math.max(0, fadeOut);

          st.twinklePhase += ssDt * st.twinkleFreq;
          const twinkle = 0.6 + 0.4 * Math.sin(st.twinklePhase) * Math.cos(st.twinklePhase * 1.4);
          // Initial size burst that settles
          const sizeBurst = 1 + (1 - Math.min(1, t * 4)) * 0.6;

          for (let l = 0; l < st.sprites.length; l++) {
            const spr = st.sprites[l];
            const lScale = st.baseScale * (1 + l * 0.18) * envelope * sizeBurst;
            spr.scale.set(lScale, lScale, 1);
            const baseOp = l < 2 ? 0.9 : 0.5;
            spr.material.opacity = baseOp * envelope * twinkle;
            spr.material.rotation += (l + 1) * st.rotSpeed * ssDt * 0.25;
          }
        }
      }

      // Bright diffraction stars (multi-layered)
      if (this._brightStars) {
        for (const bs of this._brightStars) {
          if (bs.twinkleAmount > 0.001) {
            bs.twinkleAmount *= 0.93;
          } else {
            bs.twinkleAmount = 0;
          }
          const flicker = 0.9 + 0.1 * Math.sin(now * bs.speed + bs.phase);
          const pulse = 1 + bs.twinkleAmount * 2.5;
          const scale = bs.baseScale * (1 + bs.twinkleAmount * 1.8);

          for (let l = 0; l < bs.sprites.length; l++) {
            const sp = bs.sprites[l];
            const layerScale = scale * (1 + l * 0.15);
            sp.scale.set(layerScale, layerScale, 1);
            // Core layer brighter, outer layers dimmer but pulse more
            const layerOpacity = l === 0
              ? bs.baseOpacity * flicker * Math.min(pulse, 3.0)
              : bs.baseOpacity * 0.5 * flicker * Math.min(pulse * 1.3, 3.5);
            sp.material.opacity = layerOpacity;
            // Slowly rotate outer layers for prismatic shimmer — per-star speed
            sp.material.rotation += (l + 1) * bs.rotSpeed;
          }
        }
      }
    }

    // God rays — render nebula layer to separate target, then composite
    if (this.godRayPass && this._nebulaRT) {
      // Project world origin to screen UV
      const origin = new THREE.Vector3(0, 0, 0);
      origin.project(this.camera);
      this._godRayCenter.set(
        (origin.x + 1) * 0.5,
        (origin.y + 1) * 0.5
      );

      // Two-stage AR envelope:
      //   1) Target (set by triggerLightRayPulse) decays gently — this is
      //      the release tail, stretched out so bursts don't snap off.
      //   2) Displayed intensity eases toward target with a smooth chase —
      //      gives a gentle attack ramp rather than an instant spike, and
      //      smooths out the release curve further.
      if (this._godRayTarget > 0.001) {
        this._godRayTarget *= 0.985;
      } else {
        this._godRayTarget = 0;
      }
      this._godRayIntensity += (this._godRayTarget - this._godRayIntensity) * 0.15;
      if (this._godRayIntensity < 0.001 && this._godRayTarget === 0) {
        this._godRayIntensity = 0;
      }

      this.godRayPass.uniforms.uIntensity.value =
        this._godRayBaseIntensity + this._godRayIntensity * 0.5;

      // Render nebula-only (layer 1) to separate target
      this._nebulaLayerCamera.position.copy(this.camera.position);
      this._nebulaLayerCamera.rotation.copy(this.camera.rotation);
      this._nebulaLayerCamera.projectionMatrix.copy(this.camera.projectionMatrix);
      this.renderer.setRenderTarget(this._nebulaRT);
      this.renderer.clear();
      this.renderer.render(this.scene, this._nebulaLayerCamera);
      this.renderer.setRenderTarget(null);

      // Update the nebula texture uniform
      this.godRayPass.uniforms.tNebula.value = this._nebulaRT.texture;
    }

    // Chromatic aberration decay
    if (this._rgbShiftIntensity > 0.001) {
      this._rgbShiftIntensity *= 0.88;
      // Output multiplier restored to a perceptually visible range. The old
      // value of 0.003 was left over from earlier debugging; peak amounts
      // were below 0.001 which is effectively invisible (visible shift
      // starts around 0.005, clearly visible ~0.01). At the new multiplier:
      //   orbit-note peak ≈ 0.4 × 0.4 × 0.015 = 0.0024 (just visible)
      //   transpose peak ≈ 0.8 × 0.4 × 0.015 = 0.0048 (clearly visible)
      this.rgbShiftPass.uniforms['amount'].value = this._rgbShiftIntensity * 0.015;
      this.rgbShiftPass.uniforms['angle'].value += 0.1;
    } else {
      this._rgbShiftIntensity = 0;
      this.rgbShiftPass.uniforms['amount'].value = 0;
    }

    this.composer.render();
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.controls.dispose();
    this.renderer.dispose();
    this.composer.dispose();
  }
}
