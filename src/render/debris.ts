import * as THREE from 'three';
import { SimState } from '../sim/types';
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
