// ── Angle Utilities ──────────────────────────────────────────────

const TWO_PI = Math.PI * 2;

/** Normalize angle to [0, 2*PI) */
export function normalizeAngle(a) {
  a = a % TWO_PI;
  return a < 0 ? a + TWO_PI : a;
}

/** Signed angular difference in [-PI, PI] */
export function angleDelta(a, b) {
  let d = normalizeAngle(a - b);
  if (d > Math.PI) d -= TWO_PI;
  return d;
}

/** Convert polar (angle, radius) to cartesian {x, y} */
export function polarToCartesian(angle, radius) {
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

// ── General Math ─────────────────────────────────────────────────

/** Clamp value to [min, max] */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Linear interpolation */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Map value from [inMin, inMax] to [outMin, outMax] */
export function mapRange(value, inMin, inMax, outMin, outMax) {
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

/** Inverse lerp — returns t where value = lerp(a, b, t) */
export function inverseLerp(a, b, value) {
  if (a === b) return 0;
  return (value - a) / (b - a);
}

// ── Random ───────────────────────────────────────────────────────

/** Gaussian-distributed random value (Box-Muller transform) */
export function gaussRand(stddev = 1) {
  const u = 1 - Math.random();
  const v = Math.random();
  return stddev * Math.sqrt(-2 * Math.log(u)) * Math.cos(TWO_PI * v);
}

// ── Vector 2D ────────────────────────────────────────────────────

export function vec2Distance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

export function vec2Length(x, y) {
  return Math.sqrt(x * x + y * y);
}
