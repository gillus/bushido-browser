import * as THREE from 'three';
import { Obstacle } from '../sim/types';

export type SegMode = 'mid' | 'start' | 'end';

export interface RagdollParticleInit {
  name: string;
  pos: THREE.Vector3;
  radius: number;
  vel: THREE.Vector3; // initial velocity, m/s
}

export interface RagdollSegmentInit {
  a: string;
  b: string;
  mesh: THREE.Object3D; // +Y runs from a toward b
  mode: SegMode; // where the mesh center sits on the a→b segment
}

const H = 1 / 60;
const GRAVITY = 9.8;
const AIR_DAMP = 0.996;
const GROUND_FRICTION = 0.55;
const ITERATIONS = 4;

interface Particle { pos: THREE.Vector3; prev: THREE.Vector3; radius: number; }
interface Stick { a: Particle; b: Particle; len: number; }

/**
 * Position-based verlet ragdoll: particles + distance constraints,
 * meshes stretched between particle pairs. Purely visual — lives
 * entirely on the render side.
 */
export class Ragdoll {
  readonly group = new THREE.Group();
  private parts = new Map<string, Particle>();
  private sticks: Stick[] = [];
  private segs: { a: Particle; b: Particle; mesh: THREE.Object3D; mode: SegMode }[] = [];
  private acc = 0;
  private static UP = new THREE.Vector3(0, 1, 0);

  constructor(
    particles: RagdollParticleInit[],
    stickPairs: [string, string][],
    segments: RagdollSegmentInit[],
    private obstacles: Obstacle[] = [],
  ) {
    for (const p of particles) {
      this.parts.set(p.name, {
        pos: p.pos.clone(),
        prev: p.pos.clone().addScaledVector(p.vel, -H),
        radius: p.radius,
      });
    }
    for (const [an, bn] of stickPairs) {
      const a = this.parts.get(an)!;
      const b = this.parts.get(bn)!;
      this.sticks.push({ a, b, len: a.pos.distanceTo(b.pos) });
    }
    for (const s of segments) {
      this.segs.push({
        a: this.parts.get(s.a)!, b: this.parts.get(s.b)!,
        mesh: s.mesh, mode: s.mode,
      });
      this.group.add(s.mesh);
    }
    this.sync();
  }

  step(dt: number): void {
    this.acc += Math.min(dt, 0.1);
    let n = 0;
    while (this.acc >= H && n < 4) {
      this.substep();
      this.acc -= H;
      n++;
    }
    this.sync();
  }

  private substep(): void {
    const g = GRAVITY * H * H;
    let tx: number, ty: number, tz: number;
    for (const p of this.parts.values()) {
      tx = p.pos.x; ty = p.pos.y; tz = p.pos.z;
      p.pos.x += (p.pos.x - p.prev.x) * AIR_DAMP;
      p.pos.y += (p.pos.y - p.prev.y) * AIR_DAMP - g;
      p.pos.z += (p.pos.z - p.prev.z) * AIR_DAMP;
      p.prev.set(tx, ty, tz);
    }

    const d = new THREE.Vector3();
    for (let i = 0; i < ITERATIONS; i++) {
      for (const s of this.sticks) {
        d.subVectors(s.b.pos, s.a.pos);
        const len = d.length() || 1e-6;
        d.multiplyScalar(((len - s.len) / len) * 0.5);
        s.a.pos.add(d);
        s.b.pos.sub(d);
      }
      for (const p of this.parts.values()) {
        if (p.pos.y < p.radius) {
          p.pos.y = p.radius;
          // kill tangential velocity on contact
          p.prev.x = p.pos.x - (p.pos.x - p.prev.x) * (1 - GROUND_FRICTION);
          p.prev.z = p.pos.z - (p.pos.z - p.prev.z) * (1 - GROUND_FRICTION);
        }
        for (const ob of this.obstacles) {
          const r = p.radius;
          const dx = p.pos.x - ob.x, dz = p.pos.z - ob.z;
          const lx = dx * ob.c - dz * ob.s;
          const lz = dx * ob.s + dz * ob.c;
          const px = ob.halfW + r - Math.abs(lx);
          const pz = ob.halfD + r - Math.abs(lz);
          const py = ob.y1 + r - p.pos.y;
          if (px <= 0 || pz <= 0 || py <= 0 || p.pos.y < ob.y0) continue;
          if (py <= px && py <= pz) {
            // came down on top: rest there, with furniture friction
            p.pos.y = ob.y1 + r;
            p.prev.x = p.pos.x - (p.pos.x - p.prev.x) * (1 - GROUND_FRICTION);
            p.prev.z = p.pos.z - (p.pos.z - p.prev.z) * (1 - GROUND_FRICTION);
          } else if (px <= pz) {
            const nlx = (lx >= 0 ? 1 : -1) * (ob.halfW + r);
            p.pos.x = ob.x + nlx * ob.c + lz * ob.s;
            p.pos.z = ob.z - nlx * ob.s + lz * ob.c;
          } else {
            const nlz = (lz >= 0 ? 1 : -1) * (ob.halfD + r);
            p.pos.x = ob.x + lx * ob.c + nlz * ob.s;
            p.pos.z = ob.z - lx * ob.s + nlz * ob.c;
          }
        }
      }
    }
  }

  private sync(): void {
    const dir = new THREE.Vector3();
    for (const s of this.segs) {
      dir.subVectors(s.b.pos, s.a.pos);
      const len = dir.length() || 1e-6;
      dir.divideScalar(len);
      s.mesh.quaternion.setFromUnitVectors(Ragdoll.UP, dir);
      if (s.mode === 'mid') {
        s.mesh.position.addVectors(s.a.pos, s.b.pos).multiplyScalar(0.5);
      } else if (s.mode === 'start') {
        s.mesh.position.copy(s.a.pos);
      } else {
        s.mesh.position.copy(s.b.pos);
      }
    }
  }

  /** Current world position of a named particle (e.g. 'pelvis'). */
  getPos(name: string): THREE.Vector3 {
    return this.parts.get(name)!.pos;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const s of this.segs) {
      s.mesh.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
    }
  }
}
