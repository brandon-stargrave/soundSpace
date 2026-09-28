/**
 * Note velocity from a speed, relative to the fastest speed in the orbit
 * right now. Normalizing against live motion (not the Node Speed setting)
 * keeps dynamics meaningful under every motion algorithm: the fastest
 * crossings play loudest, the slowest softly, never silently.
 */
export function noteVelocity(speed, maxSpeed) {
  if (!(maxSpeed > 1e-6)) return 0.6;
  const t = Math.min(1, Math.abs(speed) / maxSpeed);
  return 0.25 + 0.75 * Math.pow(t, 0.8);
}
