import * as THREE from 'three';
import { Obstacle } from '../sim/types';

/**
 * Keeps a carried weapon out of furniture, walls, floor and ceiling —
 * render only, the sim never sees it (its blade is the reach/arc wedge).
 * The weapon is a capsule of radius `r` along a line through the grip,
 * from `back` behind the hand to `fwd` ahead of it; when the posed weapon
 * goes into something, `BladeAvoider.solve` finds the smallest turn about
 * the hand that gets it out — raising the point first, then aside, and
 * lowering it last.
 */
export interface BladeShape { back: number; fwd: number; r: number; }

export interface BladeWorld {
  boxes: Obstacle[];
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
  for (const ob of world.boxes) {
    // into the box's local frame (yaw only, as `collide` in sim.ts)
    const px = h.x - ob.x, pz = h.z - ob.z;
    t0 = -back; t1 = fwd;
    slab(px * ob.c - pz * ob.s, d.x * ob.c - d.z * ob.s, -ob.halfW - r, ob.halfW + r);
    slab(px * ob.s + pz * ob.c, d.x * ob.s + d.z * ob.c, -ob.halfD - r, ob.halfD + r);
    slab(h.y, d.y, ob.y0 - r, ob.y1 + r);
    if (t1 > t0) len += t1 - t0;
  }
  return len;
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
