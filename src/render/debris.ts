import * as THREE from 'three';
import { BLADE_FROM, BLADE_STEP, BODY_RADIUS, bladeSpan } from '../sim/sim';
import { Line, Obstacle, SimState } from '../sim/types';
import { Breakable } from './ragdoll';

const GRAVITY = 9.8;

/** Pane-glass shards: pale, see-through, double-sided. */
export const shardMat = new THREE.MeshBasicMaterial({
  color: '#e2f1fb', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false,
});

/** A jagged glass triangle around the origin, roughly `size` across. */
export function shardGeo(size: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const a = Math.random() * Math.PI * 2;
  const pts: number[] = [];
  for (let k = 0; k < 3; k++) {
    const t = a + (k * Math.PI * 2) / 3 + (Math.random() - 0.5) * 1.2;
    const r = size * (0.5 + Math.random() * 0.6);
    pts.push(Math.cos(t) * r, Math.sin(t) * r, 0);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

interface Piece {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  resting: boolean;
  lie: number; // height of its centre when lying flat
}

/**
 * Things knocked loose by a smash — shards, display boxes, a falling sign —
 * flying under gravity until they land flat on `ground(x, z)` (in `group`'s
 * frame). Meshes flung without a parent join `group` and are disposed by
 * `clear`; ones that already have a home just move and are restored by
 * their owner. Render-only; `Math.random` is fine here.
 */
export class Debris {
  readonly group = new THREE.Group();
  private pieces: Piece[] = [];

  constructor(private ground: (x: number, z: number) => number) {}

  fling(mesh: THREE.Object3D, vel: THREE.Vector3, spinRate: number, lie = 0): void {
    if (!mesh.parent) this.group.add(mesh);
    const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
      .multiplyScalar(spinRate);
    this.pieces.push({ mesh, vel, spin, resting: false, lie });
  }

  update(dt: number): void {
    for (const s of this.pieces) {
      if (s.resting) continue;
      s.vel.y -= GRAVITY * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      const ground = this.ground(s.mesh.position.x, s.mesh.position.z) + s.lie;
      if (s.mesh.position.y <= ground) {
        s.mesh.position.y = ground;
        s.mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
        s.resting = true;
      }
    }
  }

  /** Sweep up: dispose everything in `group`, forget every piece. */
  clear(): void {
    for (const o of this.group.children) (o as THREE.Mesh).geometry?.dispose();
    this.group.clear();
    this.pieces = [];
  }
}

/** True on the first frame of a new round (or a fresh sim), to reset set dressing. */
export class RoundWatch {
  private wasEnded = false;
  private lastFrame = 0;

  newRound(sim: SimState): boolean {
    const ended = sim.roundPhase === 'end';
    const fresh = (this.wasEnded && !ended) || sim.frame < this.lastFrame;
    this.wasEnded = ended;
    this.lastFrame = sim.frame;
    return fresh;
  }
}

/** A smash for the sound/rumble side: where, and what broke. */
export interface Smash {
  at: THREE.Vector3;
  kind: 'glass' | 'crt' | 'spark';
}

/** Set dressing that breaks: ragdolls test its `breakables`; main ticks it. */
export interface Smashable {
  readonly breakables: Breakable[];
  update(sim: SimState, dt: number): Smash[];
}

/**
 * A blade that rebounded off `ob` (the sim's impact point lies in it):
 * where it struck (floor level), which side of the box it came from in
 * `ob`'s local frame (+z = front), and the blow as a velocity of `speed`
 * along the cut. Null if no blade is stuck in it right now.
 */
export function struck(
  sim: SimState, ob: Obstacle, speed: number,
): { at: THREE.Vector3; vel: THREE.Vector3; local: { x: number; z: number }; line: Line } | null {
  for (const f of sim.fighters) {
    const hit = f.rebound;
    if (f.phase !== 'stagger' || !hit || !f.move) continue;
    const dx = hit.x - ob.x, dz = hit.z - ob.z;
    const lx = dx * ob.c - dz * ob.s, lz = dx * ob.s + dz * ob.c;
    if (Math.abs(lx) > ob.halfW + 1e-6 || Math.abs(lz) > ob.halfD + 1e-6) continue;
    const vx = hit.x - f.pos.x, vz = hit.z - f.pos.z;
    const len = Math.hypot(vx, vz) || 1;
    return {
      at: new THREE.Vector3(hit.x, 0, hit.z),
      vel: new THREE.Vector3(vx / len, 0, vz / len).multiplyScalar(speed),
      local: { x: lx, z: lz },
      line: f.move.line,
    };
  }
  return null;
}

/**
 * A live cut on one of `lines` whose centerline passes through `ob` — over
 * furniture too low to stop it (the sim lets it through): where it crosses
 * (floor level) and the blow as a velocity of `speed` along the cut.
 */
export function cutThrough(
  sim: SimState, ob: Obstacle, speed: number, lines: Line[],
): { at: THREE.Vector3; vel: THREE.Vector3 } | null {
  for (let i = 0; i < 2; i++) {
    const f = sim.fighters[i];
    if (f.phase !== 'active' || !f.move || !lines.includes(f.move.line)) continue;
    const fx = Math.sin(f.facing), fz = Math.cos(f.facing);
    const until = bladeSpan(f, sim.fighters[1 - i], f.move, f.facing);
    for (let r = BLADE_FROM; r <= until; r += BLADE_STEP) {
      const x = f.pos.x + fx * r, z = f.pos.z + fz * r;
      const dx = x - ob.x, dz = z - ob.z;
      if (Math.abs(dx * ob.c - dz * ob.s) > ob.halfW || Math.abs(dx * ob.s + dz * ob.c) > ob.halfD) continue;
      return { at: new THREE.Vector3(x, 0, z), vel: new THREE.Vector3(fx, 0, fz).multiplyScalar(speed) };
    }
  }
  return null;
}

/**
 * A fighter OVERPOWERED out of a blade lock (the only stagger that carries
 * a dash) sliding into `ob`: where they are (floor level) and the blow as a
 * velocity of `speed` along their slide. Null if nobody is.
 */
export function shoved(sim: SimState, ob: Obstacle, speed: number): { at: THREE.Vector3; vel: THREE.Vector3 } | null {
  for (const f of sim.fighters) {
    if (f.phase !== 'stagger' || f.dashLeft <= 0) continue;
    const dx = f.pos.x - ob.x, dz = f.pos.z - ob.z;
    if (f.dashVec.x * dx + f.dashVec.z * dz >= 0) continue; // sliding away from it
    const lx = dx * ob.c - dz * ob.s, lz = dx * ob.s + dz * ob.c;
    const gap = Math.hypot(Math.max(0, Math.abs(lx) - ob.halfW), Math.max(0, Math.abs(lz) - ob.halfD));
    if (gap > BODY_RADIUS + 0.08) continue;
    return {
      at: new THREE.Vector3(f.pos.x, 0, f.pos.z),
      vel: new THREE.Vector3(f.dashVec.x, 0, f.dashVec.z).multiplyScalar(speed),
    };
  }
  return null;
}
