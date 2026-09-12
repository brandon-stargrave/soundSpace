// Continuous effect params glide to new values; a hard jump clicks while a slider drags
const RAMP_SECONDS = 0.05;

/** Ramp a Tone.js Param or Signal to value, or assign it when it has no ramp. */
export function rampParam(param, value) {
  if (!param) return;
  if (typeof param.rampTo === 'function') param.rampTo(value, RAMP_SECONDS);
  else param.value = value;
}
