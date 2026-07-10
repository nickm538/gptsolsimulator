export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const KTS_TO_MPS = 0.514444;
export const MPS_TO_KTS = 1 / KTS_TO_MPS;
export const M_TO_FT = 3.28084;
export const MPS_TO_FPM = 196.8504;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function saturate(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, value: number): number {
  return a === b ? 0 : (value - a) / (b - a);
}

export function smoothstep(min: number, max: number, value: number): number {
  const t = saturate(invLerp(min, max, value));
  return t * t * (3 - 2 * t);
}

export function damp(
  current: number,
  target: number,
  lambda: number,
  dt: number,
): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

export function wrapRadians(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

export function wrapDegrees(value: number): number {
  return ((value % 360) + 360) % 360;
}

export function shortestAngleDegrees(from: number, to: number): number {
  return ((to - from + 540) % 360) - 180;
}

export function moveToward(
  current: number,
  target: number,
  maxDelta: number,
): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

export function formatAltitude(feet: number): string {
  return Math.max(0, Math.round(feet / 10) * 10)
    .toString()
    .padStart(5, "0");
}

export function formatHeading(degrees: number): string {
  return Math.round(wrapDegrees(degrees)).toString().padStart(3, "0");
}

export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

export function fbm2(x: number, y: number): number {
  const wave1 = Math.sin(x * 0.0017 + Math.cos(y * 0.0011));
  const wave2 = Math.sin(x * 0.0041 + y * 0.0033) * 0.5;
  const wave3 = Math.cos(x * 0.0093 - y * 0.0077) * 0.24;
  return (wave1 + wave2 + wave3) / 1.74;
}

export function terrainHeight(x: number, z: number): number {
  const airportDistance = Math.max(Math.abs(x) - 2_600, Math.abs(z) - 2_800);
  const blend = smoothstep(0, 2_400, airportDistance);
  const hills = Math.max(0, fbm2(x, z) * 190 + 65);
  return hills * blend - smoothstep(4_500, 8_000, -z) * 18;
}
