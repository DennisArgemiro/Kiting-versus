// Small math / random helpers shared by the engine and the drills.

export const TAU = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
/** Normalise a vector; returns {x, y} with length 1 (or {0,0} for a zero vector). */
export function norm(x, y) {
  const len = Math.hypot(x, y);
  if (len < 1e-9) return { x: 0, y: 0 };
  return { x: x / len, y: y / len };
}

/**
 * Distance from point P to segment AB, and the closest point on the segment.
 * Used for linear skillshot collision.
 */
export function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = 0;
  if (lenSq > 1e-9) t = clamp(((px - ax) * abx + (py - ay) * aby) / lenSq, 0, 1);
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return { distance: Math.hypot(px - cx, py - cy), x: cx, y: cy, t };
}

/**
 * Signed angle test for a cone: is P inside the cone rooted at (ox, oy) with
 * direction (dx, dy), half-angle `half` and reach `reach`?
 */
export function insideCone(px, py, ox, oy, dx, dy, half, reach) {
  const vx = px - ox;
  const vy = py - oy;
  const d = Math.hypot(vx, vy);
  if (d > reach) return false;
  if (d < 1e-6) return true;
  const dot = (vx / d) * dx + (vy / d) * dy;
  return dot >= Math.cos(half);
}

/** Mulberry32 — tiny, fast, seedable PRNG so drills can be replayed. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (min, max) => min + rng() * (max - min);
  rng.int = (min, max) => Math.floor(rng.range(min, max + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  return rng;
}

/** Format seconds as m:ss. */
export function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
