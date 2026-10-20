import * as THREE from 'three';
import { Obstacle } from '../sim/types';

/**
 * Keeps a carried weapon out of furniture, walls, floor, ceiling, the
 * opponent's body and the opponent's weapon — render only, the sim never
 * sees it (its blade is the reach/arc wedge).
 * The weapon is a capsule of radius `r` along a line through the grip,
 * from `back` behind the hand to `fwd` ahead of it; when the posed weapon
 * goes into something, `BladeAvoider.solve` finds the smallest turn about
 * the hand that gets it out — raising the point first, then aside, and
 * lowering it last.
 */
export interface BladeShape {
  back: number; fwd: number; r: number;
  // the weapon's true thickness, as stretches of the line [from, to] with
  // their radius: what another weapon meets (`r` is padded for furniture)
  rods: { from: number; to: number; r: number }[];
}

/** A stretch of a weapon as a capsule, end `a` to end `b`, in world space. */
export interface Rod { a: THREE.Vector3; b: THREE.Vector3; r: number; }

export interface BladeWorld {
  boxes: Obstacle[];
  bodies: Obstacle[]; // boxes around posed body parts: already loose round limbs, so no `r` margin
  rods: Rod[];        // the other weapon, hilt to tip
  // the side of the other weapon this one was on last frame (`crossSide`),
  // 0 = free: a swing doesn't jump through it between frames, it pushes
  rodSide: number;
  floor: number;   // lowest the weapon line may go (a broom's bristles touch down)
  ceiling: number; // Infinity without a room
}

const STEP = 0.06;     // rad per search step
const MAX_TURN = 1.9;  // never turn the weapon further than this
const SWITCH = 0.15;   // rad another direction must save to replace the current one
// per direction around the weapon (k × 45°, 0 = point up): raise, then the
// up-diagonals, aside, the down-diagonals, lower
const BIAS = [0, 0.02, 0.03, 0.05, 0.08, 0.05, 0.03, 0.02];

// the [t0, t1] stretch of the weapon line still inside every slab tested so far
let t0 = 0, t1 = 0;
function slab(p: number, u: number, min: number, max: number): void {
  if (Math.abs(u) < 1e-9) {
    if (p < min || p > max) t1 = t0 - 1;
    return;
  }
  let a = (min - p) / u, b = (max - p) / u;
  if (a > b) { const s = a; a = b; b = s; }
  if (a > t0) t0 = a;
  if (b < t1) t1 = b;
}

/** Length of the weapon held at `h`, pointing `d` (unit), that is inside something. */
export function clipLength(h: THREE.Vector3, d: THREE.Vector3, shape: BladeShape, world: BladeWorld): number {
  const { back, fwd, r } = shape;
  let len = 0;
  // floor and ceiling are a single slab each
  t0 = -back; t1 = fwd;
  slab(h.y, d.y, -Infinity, world.floor);
  if (t1 > t0) len += t1 - t0;
  t0 = -back; t1 = fwd;
  slab(h.y, d.y, world.ceiling - r, Infinity);
  if (t1 > t0) len += t1 - t0;
  for (const ob of world.boxes) len += boxSpan(h, d, back, fwd, ob, r);
  for (const ob of world.bodies) len += boxSpan(h, d, back, fwd, ob, 0);
  for (const rod of world.rods) {
    for (const p of shape.rods) len += rodSpan(h, d, p.from, p.to, p.r + rod.r, rod);
  }
  if (world.rodSide !== 0 && crossSide(h, d, shape, world.rods) === -world.rodSide) len += back + fwd;
  return len;
}

/**
 * Which side of the other weapon (`rods`, hilt to tip) this one's line is
 * on, ±1, where the two cross — the closest points of the two lines fall
 * within both weapons; 0 where they don't (one passes the other's end).
 */
export function crossSide(h: THREE.Vector3, d: THREE.Vector3, shape: BladeShape, rods: Rod[]): number {
  if (rods.length === 0) return 0;
  const a = rods[0].a, b = rods[rods.length - 1].b;
  const ex = b.x - a.x, ey = b.y - a.y, ez = b.z - a.z;
  const wx = a.x - h.x, wy = a.y - h.y, wz = a.z - h.z;
  // n = d × e; the side is n · (a − h)
  const nx = d.y * ez - d.z * ey, ny = d.z * ex - d.x * ez, nz = d.x * ey - d.y * ex;
  const bb = d.x * ex + d.y * ey + d.z * ez, ee = ex * ex + ey * ey + ez * ez;
  const den = ee - bb * bb; // |d| = 1
  if (den < 1e-9) return 0;
  const dw = d.x * wx + d.y * wy + d.z * wz, ew = ex * wx + ey * wy + ez * wz;
  const t = (dw * ee - bb * ew) / den;  // along this line from the hand
  const u = (dw * bb - ew) / den;       // along the other, 0 hilt … 1 tip
  if (t < -shape.back || t > shape.fwd || u < 0 || u > 1) return 0;
  return nx * wx + ny * wy + nz * wz >= 0 ? 1 : -1;
}

/** Squared distance from h + t·d to `rod`'s segment. */
function rodDist2(h: THREE.Vector3, d: THREE.Vector3, t: number, rod: Rod): number {
  const { a, b } = rod;
  const px = h.x + d.x * t - a.x, py = h.y + d.y * t - a.y, pz = h.z + d.z * t - a.z;
  const ex = b.x - a.x, ey = b.y - a.y, ez = b.z - a.z;
  const ee = ex * ex + ey * ey + ez * ez;
  const u = ee > 1e-12 ? Math.min(1, Math.max(0, (px * ex + py * ey + pz * ez) / ee)) : 0;
  const x = px - ex * u, y = py - ey * u, z = pz - ez * u;
  return x * x + y * y + z * z;
}

/**
 * Length of the line h + t·d, t ∈ [t0, t1], within `R` of `rod`'s segment.
 * The distance is convex along the line, so it's one stretch around the
 * closest point; its ends are found by bisection.
 */
function rodSpan(h: THREE.Vector3, d: THREE.Vector3, ta: number, tb: number, R: number, rod: Rod): number {
  const R2 = R * R;
  // closest point between the two segments (Ericson, Real-Time Collision Detection 5.1.9)
  const ex = rod.b.x - rod.a.x, ey = rod.b.y - rod.a.y, ez = rod.b.z - rod.a.z;
  const ox = h.x + d.x * ta - rod.a.x, oy = h.y + d.y * ta - rod.a.y, oz = h.z + d.z * ta - rod.a.z;
  const L = tb - ta;
  const aa = L * L, ee = ex * ex + ey * ey + ez * ez;
  const f = ex * ox + ey * oy + ez * oz;
  const c = L * (d.x * ox + d.y * oy + d.z * oz);
  const bb = L * (d.x * ex + d.y * ey + d.z * ez);
  const den = aa * ee - bb * bb;
  let s = den > 1e-12 ? Math.min(1, Math.max(0, (bb * f - c * ee) / den)) : 0;
  const u = (bb * s + f) / ee;
  if (u < 0) s = Math.min(1, Math.max(0, -c / aa));
  else if (u > 1) s = Math.min(1, Math.max(0, (bb - c) / aa));
  const tm = ta + s * L;
  if (rodDist2(h, d, tm, rod) >= R2) return 0;
  const edge = (inside: number, outside: number): number => {
    if (rodDist2(h, d, outside, rod) < R2) return outside;
    for (let i = 0; i < 7; i++) {
      const mid = (inside + outside) / 2;
      if (rodDist2(h, d, mid, rod) < R2) inside = mid; else outside = mid;
    }
    return (inside + outside) / 2;
  };
  return edge(tm, tb) - edge(tm, ta);
}

/** Length of the line h + t·d, t ∈ [-back, fwd], inside `ob` grown by `pad`. */
function boxSpan(h: THREE.Vector3, d: THREE.Vector3, back: number, fwd: number, ob: Obstacle, pad: number): number {
  // into the box's local frame (yaw only, as `collide` in sim.ts)
  const px = h.x - ob.x, pz = h.z - ob.z;
  t0 = -back; t1 = fwd;
  slab(px * ob.c - pz * ob.s, d.x * ob.c - d.z * ob.s, -ob.halfW - pad, ob.halfW + pad);
  slab(px * ob.s + pz * ob.c, d.x * ob.s + d.z * ob.c, -ob.halfD - pad, ob.halfD + pad);
  slab(h.y, d.y, ob.y0 - pad, ob.y1 + pad);
  return t1 > t0 ? t1 - t0 : 0;
}

const UP = new THREE.Vector3(0, 1, 0);

export class BladeAvoider {
  private dir = -1; // the direction last turned towards (k), kept while it still works
  private u = new THREE.Vector3();
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  private cand = new THREE.Vector3();

  /**
   * The world rotation about the hand that takes the weapon (at `hand`,
   * pointing `d`) out of everything, into `out` — identity when it's clear.
   * `forward` is the fighter's facing, used when the weapon points straight up.
   */
  solve(
    hand: THREE.Vector3, d: THREE.Vector3, forward: THREE.Vector3,
    shape: BladeShape, world: BladeWorld, out: THREE.Quaternion,
  ): THREE.Quaternion {
    let worst = clipLength(hand, d, shape, world);
    if (worst === 0) {
      this.dir = -1;
      return out.identity();
    }
    // u = "up" across the weapon, v = aside
    const { u, v, w, cand } = this;
    u.copy(UP).addScaledVector(d, -d.y);
    if (u.lengthSq() < 0.02) u.copy(forward).addScaledVector(d, -d.dot(forward));
    u.normalize();
    v.crossVectors(d, u);
    const turned = (k: number, theta: number): THREE.Vector3 => {
      const psi = (k * Math.PI) / 4;
      w.copy(u).multiplyScalar(Math.cos(psi)).addScaledVector(v, Math.sin(psi));
      return cand.copy(d).multiplyScalar(Math.cos(theta)).addScaledVector(w, Math.sin(theta));
    };

    let bestK = -1, bestTheta = 0, bestScore = Infinity;
    let leastK = -1, leastTheta = 0; // nothing clears (the hand itself is in it): least inside
    for (let k = 0; k < 8; k++) {
      const bias = BIAS[k] - (k === this.dir ? SWITCH : 0);
      for (let theta = STEP; theta <= MAX_TURN && theta + bias < bestScore; theta += STEP) {
        const c = clipLength(hand, turned(k, theta), shape, world);
        if (c > 0) {
          if (c < worst - 1e-4) { worst = c; leastK = k; leastTheta = theta; }
          continue;
        }
        // clear: home in on the edge between the last step and this one
        let lo = theta - STEP, hi = theta;
        for (let i = 0; i < 3; i++) {
          const mid = (lo + hi) / 2;
          if (clipLength(hand, turned(k, mid), shape, world) > 0) lo = mid; else hi = mid;
        }
        bestK = k; bestTheta = hi; bestScore = hi + bias;
        break;
      }
    }
    if (bestK < 0) { bestK = leastK; bestTheta = leastTheta; }
    this.dir = bestK;
    if (bestK < 0) return out.identity();
    return out.setFromUnitVectors(d, turned(bestK, bestTheta));
  }
}
