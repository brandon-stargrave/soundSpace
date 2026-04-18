import * as THREE from 'three';

/**
 * Cloud particle material — variation of SoftParticleMaterial with
 * noise-based edge distortion for nebula cloud-like shapes.
 * Per-vertex size/alpha/color, wispy irregular edges, slowly evolving.
 */
export function createCloudParticleMaterial(opts = {}) {
  const {
    vertexColors = true,
    baseColor = 0xffffff,
    glowWidth = 0.25,
    glowIntensity = 0.5,
    pixelRatio = 1,
    canvasHeight = 800,
  } = opts;

  const defines = {};
  if (vertexColors) defines.USE_VERTEX_COLORS = '';

  const material = new THREE.ShaderMaterial({
    defines,
    uniforms: {
      uScale: { value: canvasHeight * pixelRatio * 0.5 },
      uBaseColor: { value: new THREE.Color(baseColor) },
      uGlowWidth: { value: glowWidth },
      uGlowIntensity: { value: glowIntensity },
      uTime: { value: 0 },
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

// ── Vertex Shader (same as SoftParticleMaterial) ─────────────────

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
  gl_PointSize = aSize * (uScale / -mvPosition.z);
  gl_PointSize = clamp(gl_PointSize, 0.0, 256.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

// ── Fragment Shader (with noise cloud distortion) ────────────────

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;

uniform float uGlowWidth;
uniform float uGlowIntensity;
uniform float uTime;

// Compact hash-based 2D noise (no texture needed)
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y) * 2.0 - 1.0;
}

// Layered noise for richer detail
float fbm(vec2 p) {
  float v = 0.0;
  v += vnoise(p * 1.0) * 0.5;
  v += vnoise(p * 2.0) * 0.25;
  v += vnoise(p * 4.0) * 0.125;
  return v;
}

void main() {
  vec2 center = gl_PointCoord - 0.5;
  float dist = length(center);

  if (dist > 0.55) discard;

  // Noise-based edge distortion — wispy cloud shapes
  float angle = atan(center.y, center.x);
  float noiseVal = fbm(vec2(angle * 2.5 + uTime * 0.05, dist * 3.0 + uTime * 0.08));

  // Warp distance — outer edges get irregular, core stays round
  float warpStrength = smoothstep(0.1, 0.45, dist);
  float warpedDist = dist + noiseVal * 0.12 * warpStrength;

  // Shape with warped distance
  float coreRadius = 0.5 - uGlowWidth;
  float coreFade = 1.0 - smoothstep(0.0, coreRadius, warpedDist);

  float glowFade = 1.0 - smoothstep(coreRadius, 0.52, warpedDist);
  float glow = glowFade * uGlowIntensity;

  float shape = coreFade + glow * (1.0 - coreFade);

  float finalAlpha = shape * vAlpha;

  if (finalAlpha < 0.003) discard;

  gl_FragColor = vec4(vColor, finalAlpha);
}
`;
