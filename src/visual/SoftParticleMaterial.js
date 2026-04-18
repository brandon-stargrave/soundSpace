import * as THREE from 'three';

/**
 * Create a ShaderMaterial for THREE.Points with:
 * - Per-vertex size (aSize attribute)
 * - Per-vertex alpha (aAlpha attribute)
 * - Soft circular shape with radial falloff
 * - Gentle glow at edges
 *
 * @param {object} opts
 * @param {boolean} [opts.vertexColors=true]
 * @param {THREE.Color|number} [opts.baseColor=0xffffff]
 * @param {number} [opts.glowWidth=0.15]
 * @param {number} [opts.glowIntensity=0.4]
 * @param {number} [opts.pixelRatio=1]
 * @param {number} [opts.canvasHeight=800]
 */
export function createSoftParticleMaterial(opts = {}) {
  const {
    vertexColors = true,
    baseColor = 0xffffff,
    glowWidth = 0.15,
    glowIntensity = 0.4,
    pixelRatio = 1,
    canvasHeight = 800,
  } = opts;

  const defines = {};
  if (vertexColors) {
    defines.USE_VERTEX_COLORS = '';
  }

  const material = new THREE.ShaderMaterial({
    defines,
    uniforms: {
      uScale: { value: canvasHeight * pixelRatio * 0.5 },
      uBaseColor: { value: new THREE.Color(baseColor) },
      uGlowWidth: { value: glowWidth },
      uGlowIntensity: { value: glowIntensity },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    blending: THREE.NormalBlending,
    depthWrite: false,
    vertexColors,
  });

  return material;
}

/** Update the size-attenuation scale uniform on resize */
export function updateSoftParticleScale(material, canvasHeight, pixelRatio) {
  if (material && material.uniforms && material.uniforms.uScale) {
    material.uniforms.uScale.value = canvasHeight * pixelRatio * 0.5;
  }
}

// ── Vertex Shader ────────────────────────────────────────────────

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;

varying vec3 vColor;
varying float vAlpha;

uniform float uScale;
uniform vec3 uBaseColor;

void main() {
  vAlpha = aAlpha;

  #ifdef USE_VERTEX_COLORS
    vColor = color;
  #else
    vColor = uBaseColor;
  #endif

  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

  // Size attenuation matching Three.js PointsMaterial behavior
  gl_PointSize = aSize * (uScale / -mvPosition.z);
  gl_PointSize = clamp(gl_PointSize, 0.0, 128.0);

  gl_Position = projectionMatrix * mvPosition;
}
`;

// ── Fragment Shader ──────────────────────────────────────────────

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

uniform float uGlowWidth;
uniform float uGlowIntensity;

void main() {
  vec2 center = gl_PointCoord - 0.5;
  float dist = length(center);

  // Discard outside circle
  if (dist > 0.5) discard;

  // Core: solid center fading to edge of core region
  float coreRadius = 0.5 - uGlowWidth;
  float coreFade = 1.0 - smoothstep(0.0, coreRadius, dist);

  // Glow: soft band from core edge to outer boundary
  float glowFade = 1.0 - smoothstep(coreRadius, 0.5, dist);
  float glow = glowFade * uGlowIntensity;

  // Combined shape: core dominates center, glow extends to edge
  float shape = coreFade + glow * (1.0 - coreFade);

  float finalAlpha = shape * vAlpha;

  // Discard invisible fragments
  if (finalAlpha < 0.004) discard;

  gl_FragColor = vec4(vColor, finalAlpha);
}
`;
