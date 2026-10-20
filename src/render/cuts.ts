import * as THREE from 'three';
import { Line } from '../sim/types';

/**
 * Cuts, animated in weapon space — render only. A cut is keyed as where
 * the weapon hand is and which way the weapon points (plus the torso's
 * turn), not as joint angles: the arm reaches the hand by IK and the wrist
 * aims the weapon, so the weapon travels the arc the keys describe instead
 * of whatever path interpolated shoulder angles happen to trace.
 *
 * Every cut runs in four stages: the wind-up (cocking, then a slow creep
 * deeper so a held wind-up never freezes), the strike (the last frames of
 * the wind-up, while the sim's lunge carries the body in — it must arrive
 * by the first active tick, because that's when a cut lands and the
 * hitstop freezes the picture), the active frames (cutting through), and
 * the recovery (follow-through, a held moment, back to guard).
 *
 * Coordinates are in the torso's frame (+z forward, +y up, +x the weapon
 * hand's side): `hand` from the midpoint between the shoulders in arm
 * lengths, `dir` from the hand toward the business end. The torso's own
 * Euler is in the key, so a sweep is the body turning AND the arms
 * crossing — mind that the two add up.
 */
type V = [number, number, number];

export interface CutKey {
  at: number;   // 0..1 of the stage, in eased time
  hand: V;
  dir: V;
  torso: V;
  head?: V;     // default: undoes the torso's turn, eyes on the opponent
}

type Ease = 'in' | 'out' | 'inout';
interface CutStage { ease: Ease; keys: CutKey[] }
export interface CutAnim { windup: CutStage; strike: CutStage; active: CutStage; recovery: CutStage }
export type CutStageName = keyof CutAnim;

const EASE: Record<Ease, (t: number) => number> = {
  in: (t) => t * t,
  out: (t) => 1 - (1 - t) * (1 - t),
  inout: (t) => t * t * (3 - 2 * t),
};

// Cardboard tube (katana stats)
const tubeCuts: Record<Line, CutAnim> = {
  // Shomen-giri: furikaburi — the tube swung back over the head — then
  // straight down the middle, the body dropping into it
  high: {
    windup: { ease: 'out', keys: [
      { at: 0.55, hand: [0.18, 0.95, -0.02], dir: [-0.08, 0.5, -0.86], torso: [-0.14, 0, 0] },
      { at: 1, hand: [0.18, 0.98, -0.1], dir: [-0.08, 0.32, -0.94], torso: [-0.2, 0.04, 0] },
    ] },
    strike: { ease: 'in', keys: [
      { at: 0.45, hand: [0.14, 0.95, 0.32], dir: [-0.04, 1, 0.1], torso: [-0.05, 0.02, 0] },
      { at: 1, hand: [0.1, 0.22, 0.95], dir: [0, 0.12, 1], torso: [0.24, 0, 0] },
    ] },
    active: { ease: 'out', keys: [
      { at: 1, hand: [0.1, -0.32, 0.88], dir: [0, -0.48, 0.88], torso: [0.42, 0, 0] },
    ] },
    recovery: { ease: 'inout', keys: [
      { at: 0.18, hand: [0.1, -0.45, 0.8], dir: [0, -0.62, 0.78], torso: [0.48, 0, 0] },
      { at: 0.5, hand: [0.1, -0.4, 0.82], dir: [0, -0.52, 0.85], torso: [0.42, 0, 0] },
    ] },
  },
  // Tsuki: the hands drawn back to the belly, point on the throat, the
  // right shoulder turned away — then driven straight in, the shoulder
  // following the point
  mid: {
    windup: { ease: 'out', keys: [
      { at: 0.55, hand: [0.18, -0.32, 0.45], dir: [-0.14, 0.2, 0.97], torso: [0.02, 0.3, 0] },
      { at: 1, hand: [0.2, -0.34, 0.36], dir: [-0.12, 0.16, 0.98], torso: [0.05, 0.38, 0] },
    ] },
    // (the point keeps level: dir rises by what the torso leans in)
    strike: { ease: 'in', keys: [
      { at: 1, hand: [0.1, -0.1, 0.98], dir: [-0.06, 0.24, 0.97], torso: [0.2, -0.1, 0] },
    ] },
    active: { ease: 'out', keys: [
      { at: 1, hand: [0.06, -0.02, 1.15], dir: [-0.03, 0.3, 0.95], torso: [0.3, -0.28, 0] },
    ] },
    recovery: { ease: 'inout', keys: [
      { at: 0.2, hand: [0.06, -0.02, 1.15], dir: [-0.03, 0.3, 0.95], torso: [0.32, -0.3, 0] },
      { at: 0.45, hand: [0.1, -0.1, 1.0], dir: [-0.1, 0.32, 0.94], torso: [0.24, -0.18, 0] },
    ] },
  },
  // Kiriage: the tube trails low behind the right hip (waki-gamae), then
  // rips forward along the floor and up across the body to high left
  low: {
    windup: { ease: 'out', keys: [
      { at: 0.55, hand: [0.5, -0.9, 0.05], dir: [0.4, -0.4, -0.82], torso: [0.18, 0.42, 0] },
      { at: 1, hand: [0.55, -0.9, -0.05], dir: [0.42, -0.32, -0.85], torso: [0.2, 0.52, 0] },
    ] },
    strike: { ease: 'in', keys: [
      { at: 0.5, hand: [0.45, -0.88, 0.42], dir: [0.78, -0.52, 0.34], torso: [0.2, 0.25, 0] },
      { at: 1, hand: [0.18, -0.6, 0.82], dir: [-0.08, -0.22, 0.97], torso: [0.14, 0, 0] },
    ] },
    active: { ease: 'out', keys: [
      { at: 1, hand: [-0.1, 0.42, 0.78], dir: [-0.45, 0.62, 0.64], torso: [-0.05, -0.35, 0] },
    ] },
    recovery: { ease: 'inout', keys: [
      { at: 0.18, hand: [-0.16, 0.58, 0.64], dir: [-0.5, 0.72, 0.48], torso: [-0.1, -0.42, 0] },
      { at: 0.5, hand: [-0.1, 0.52, 0.7], dir: [-0.42, 0.7, 0.58], torso: [-0.06, -0.36, 0] },
    ] },
  },
};

// Shop broom (naginata stats): two hands spread on the haft, big arcs
const broomCuts: Record<Line, CutAnim> = {
  // Kabuto-wari: the broom hauled up over the right shoulder, bristles
  // behind, then brought over and down on the head — and on into the floor
  high: {
    windup: { ease: 'out', keys: [
      { at: 0.55, hand: [0.25, 0.82, 0.02], dir: [0.15, 0.55, -0.82], torso: [-0.14, 0.15, 0] },
      { at: 1, hand: [0.3, 0.86, -0.08], dir: [0.15, 0.4, -0.9], torso: [-0.2, 0.22, 0] },
    ] },
    strike: { ease: 'in', keys: [
      { at: 0.45, hand: [0.2, 0.78, 0.34], dir: [0.05, 1, 0.08], torso: [-0.04, 0.1, 0] },
      { at: 1, hand: [0.1, 0.12, 0.85], dir: [0, 0.18, 0.98], torso: [0.3, 0, 0] },
    ] },
    active: { ease: 'out', keys: [
      { at: 1, hand: [0.08, -0.3, 0.78], dir: [0, -0.42, 0.91], torso: [0.46, 0, 0] },
    ] },
    recovery: { ease: 'inout', keys: [
      { at: 0.18, hand: [0.08, -0.4, 0.72], dir: [0, -0.5, 0.87], torso: [0.5, 0, 0] },
      { at: 0.5, hand: [0.08, -0.34, 0.76], dir: [0, -0.45, 0.89], torso: [0.44, 0, 0] },
    ] },
  },
  // Nagi-harai: wound up with the broom out behind the right side, swept
  // flat across the front at chest height through 130°, body unwinding
  mid: {
    windup: { ease: 'out', keys: [
      { at: 0.55, hand: [0.52, -0.12, 0.3], dir: [0.98, 0.12, 0.15], torso: [0.05, 0.5, 0] },
      { at: 1, hand: [0.56, -0.1, 0.24], dir: [1, 0.12, 0.05], torso: [0.05, 0.62, 0] },
    ] },
    strike: { ease: 'in', keys: [
      { at: 0.5, hand: [0.46, -0.16, 0.6], dir: [0.8, 0.02, 0.6], torso: [0.08, 0.3, 0] },
      { at: 1, hand: [0.12, -0.2, 0.9], dir: [0.02, -0.04, 1], torso: [0.12, 0, 0] },
    ] },
    active: { ease: 'out', keys: [
      { at: 1, hand: [-0.2, -0.2, 0.8], dir: [-0.6, -0.02, 0.8], torso: [0.12, -0.5, 0] },
    ] },
    recovery: { ease: 'inout', keys: [
      { at: 0.18, hand: [-0.3, -0.2, 0.7], dir: [-0.78, 0.04, 0.62], torso: [0.1, -0.6, 0] },
      { at: 0.5, hand: [-0.24, -0.2, 0.75], dir: [-0.7, 0.06, 0.7], torso: [0.1, -0.5, 0] },
    ] },
  },
  // Ashi-barai: bent low, the bristles cocked out behind the right foot,
  // then swept along at shin height from right to left
  low: {
    windup: { ease: 'out', keys: [
      { at: 0.55, hand: [0.48, -0.58, 0.32], dir: [0.86, -0.42, 0.2], torso: [0.3, 0.42, 0] },
      { at: 1, hand: [0.52, -0.6, 0.28], dir: [0.88, -0.44, 0.1], torso: [0.34, 0.5, 0] },
    ] },
    strike: { ease: 'in', keys: [
      { at: 0.5, hand: [0.4, -0.7, 0.6], dir: [0.65, -0.45, 0.62], torso: [0.4, 0.25, 0] },
      { at: 1, hand: [0.1, -0.75, 0.82], dir: [0, -0.45, 0.9], torso: [0.45, 0, 0] },
    ] },
    active: { ease: 'out', keys: [
      { at: 1, hand: [-0.2, -0.7, 0.7], dir: [-0.5, -0.45, 0.74], torso: [0.45, -0.45, 0] },
    ] },
    recovery: { ease: 'inout', keys: [
      { at: 0.18, hand: [-0.28, -0.66, 0.62], dir: [-0.66, -0.4, 0.64], torso: [0.45, -0.55, 0] },
      { at: 0.5, hand: [-0.22, -0.66, 0.68], dir: [-0.58, -0.4, 0.7], torso: [0.42, -0.46, 0] },
    ] },
  },
};

/**
 * Knocked wide (a stagger, a flinch): the weapon flung up and out to its
 * own side, the body thrown back and turned with the blow — away from the
 * opponent, whatever its length (posed as joint angles, the broom ended up
 * levelled at the opponent's face).
 */
export const KNOCKED: CutKey = {
  at: 1, hand: [0.45, 0.12, 0.3], dir: [0.55, 0.8, -0.25], torso: [-0.3, 0.25, 0.1], head: [0.12, -0.2, 0],
};

/** The cut set for a weapon's `look` (the real katana/naginata use the same arcs). */
export const cutsFor = (look: string | undefined, polearm: boolean): Record<Line, CutAnim> =>
  look === 'broom' || (look !== 'tube' && polearm) ? broomCuts : tubeCuts;

/** A sampled cut moment, flat: hand 0-2, dir 3-5, torso 6-8, head 9-11. */
export type CutPose = number[];
export const cutPose = (): CutPose => new Array(12).fill(0);

const headFor = (torso: V): V => [-torso[0] * 0.7, -torso[1] * 0.85, -torso[2]];

export function keyValues(k: CutKey, out: CutPose): CutPose {
  const d = Math.hypot(...k.dir);
  out[0] = k.hand[0]; out[1] = k.hand[1]; out[2] = k.hand[2];
  out[3] = k.dir[0] / d; out[4] = k.dir[1] / d; out[5] = k.dir[2] / d;
  out[6] = k.torso[0]; out[7] = k.torso[1]; out[8] = k.torso[2];
  const h = k.head ?? headFor(k.torso);
  out[9] = h[0]; out[10] = h[1]; out[11] = h[2];
  return out;
}

// scratch: the stage's keys as values, with the start (and the guard) around them
const pts: CutPose[] = Array.from({ length: 8 }, cutPose);
const ats: number[] = new Array(8).fill(0);

/**
 * The cut at `t` (0..1) of `stage`, starting from `from` (where the stage
 * began); the recovery ends on `guard`. Catmull-Rom through the keys, so a
 * swing curves through them instead of turning corners.
 */
export function sampleCut(anim: CutAnim, stage: CutStageName, t: number, from: CutPose, guard: CutPose, out: CutPose): CutPose {
  const st = anim[stage];
  let n = 0;
  for (let i = 0; i < 12; i++) pts[0][i] = from[i];
  ats[n++] = 0;
  for (const k of st.keys) { keyValues(k, pts[n]); ats[n++] = k.at; }
  if (stage === 'recovery') {
    for (let i = 0; i < 12; i++) pts[n][i] = guard[i];
    ats[n++] = 1;
  }
  const u = EASE[st.ease](Math.max(0, Math.min(1, t)));
  let s = 0;
  while (s < n - 2 && u > ats[s + 1]) s++;
  const span = ats[s + 1] - ats[s];
  const x = span > 1e-6 ? Math.max(0, Math.min(1, (u - ats[s]) / span)) : 1;
  const p0 = pts[Math.max(0, s - 1)], p1 = pts[s], p2 = pts[s + 1], p3 = pts[Math.min(n - 1, s + 2)];
  const x2 = x * x, x3 = x2 * x;
  for (let i = 0; i < 12; i++) {
    out[i] = 0.5 * (2 * p1[i] + (p2[i] - p0[i]) * x
      + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * x2 + (3 * p1[i] - p0[i] - 3 * p2[i] + p3[i]) * x3);
  }
  const d = Math.hypot(out[3], out[4], out[5]) || 1;
  out[3] /= d; out[4] /= d; out[5] /= d;
  return out;
}

/** Where `stage` starts, given where the wind-up started (each stage begins where the last one ended). */
export function stageStart(anim: CutAnim, stage: CutStageName, windupFrom: CutPose, guard: CutPose, out: CutPose): CutPose {
  for (let i = 0; i < 12; i++) out[i] = windupFrom[i];
  const order: CutStageName[] = ['windup', 'strike', 'active', 'recovery'];
  for (const s of order) {
    if (s === stage) break;
    sampleCut(anim, s, 1, out, guard, out);
  }
  return out;
}

const _t = new THREE.Vector3();
const _u = new THREE.Vector3();
const _n = new THREE.Vector3();
const _b = new THREE.Vector3();
const _x = new THREE.Vector3();
const _m = new THREE.Matrix4();

/**
 * Two-bone arm IK in the shoulder's parent frame: turns `shoulder` and
 * bends `elbow` (about its x, as the poses do) so the hand — `fore` down
 * the forearm — reaches `target`, the elbow pointing toward `pole`.
 * Out of reach, the arm points straight at it.
 */
export function reachArm(
  shoulder: THREE.Object3D, elbow: THREE.Object3D, upper: number, fore: number,
  target: THREE.Vector3, pole: THREE.Vector3,
): void {
  const t = _t.subVectors(target, shoulder.position);
  const D = Math.max(Math.abs(upper - fore) + 1e-3, Math.min((upper + fore) * 0.999, t.length()));
  t.normalize();
  const cosK = Math.max(-1, Math.min(1, (D * D - upper * upper - fore * fore) / (2 * upper * fore)));
  const kappa = Math.acos(cosK);
  // the upper arm leaves the shoulder→hand line by β, toward the pole
  const cosB = Math.max(-1, Math.min(1, (upper * upper + D * D - fore * fore) / (2 * upper * D)));
  const n = _n.copy(pole).addScaledVector(t, -pole.dot(t));
  if (n.lengthSq() < 1e-8) n.set(0, -1, 0).addScaledVector(t, t.y);
  n.normalize();
  const sinB = Math.sqrt(1 - cosB * cosB);
  const u = _u.copy(t).multiplyScalar(cosB).addScaledVector(n, sinB);
  // the forearm folds toward the shoulder's local +z: from the elbow to the hand
  const b = _b.copy(t).multiplyScalar(D).addScaledVector(u, -upper);
  b.addScaledVector(u, -b.dot(u));
  if (b.lengthSq() < 1e-8) b.copy(n).negate();
  b.normalize();
  // basis: local -y → u, local +z → b
  const x = _x.crossVectors(u, b).negate(); // (-u) × b
  _m.makeBasis(x, u.negate(), b);
  shoulder.quaternion.setFromRotationMatrix(_m);
  elbow.rotation.set(-kappa, 0, 0);
}
