import * as THREE from 'three';
import { BODY_RADIUS } from '../sim/sim';
import { SimState, StageStorefront } from '../sim/types';
import { Breakable } from './ragdoll';

const BREAK_SPEED = 1.5;   // m/s a corpse must hit a pane at
const SHOVE_SPEED = 4;     // a shoved fighter's slide, for the shard spray
const SHARDS_PER_M2 = 12;
const GRAVITY = 9.8;
const UP = new THREE.Vector3(0, 1, 0);

interface Pane extends Breakable {
  x0: number; x1: number; // wall-local span between mullions
  mesh: THREE.Mesh;
}

interface Shard {
  mesh: THREE.Object3D;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  resting: boolean;
  lie: number; // height of its centre when lying flat
}

/** A game box from the window display, and where it stood. */
interface Display {
  mesh: THREE.Object3D;
  home: THREE.Vector3;
  rot: THREE.Euler;
  lie: number;
  knocked: boolean;
}

/**
 * The display window as separately breakable panes. A pane shatters when a
 * corpse is flung into it (the ragdolls test the panes as `Breakable`s) or
 * when a fighter shoved out of a tsubazeriai is slammed against it. Shards
 * spray off and settle on the floor or the pavement, jagged teeth stay in
 * the frame, and the glazier has it all back for the next round.
 * Render-only, like the ragdolls: the sim's arena is unchanged.
 */
export class ShopWindow {
  readonly panes: Pane[] = [];
  private shards: Shard[] = [];
  private debris = new THREE.Group(); // shards + teeth, wall-local
  private shardMat = new THREE.MeshBasicMaterial({
    color: '#e2f1fb', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false,
  });
  private display: Display[] = [];
  private broke: THREE.Vector3[] = [];
  private wasEnded = false;
  private lastFrame = 0;
  private sill: number;
  private head: number;

  /** `group` is the storefront's wall-local frame (+z into the room). */
  constructor(sf: StageStorefront, private group: THREE.Group, glass: THREE.Texture) {
    const [wx0, wx1, sill, head] = sf.window;
    this.sill = sill;
    this.head = head;
    group.add(this.debris);
    group.updateMatrixWorld(true);
    group.traverse((o) => {
      if (o.userData.display === undefined) return;
      this.display.push({
        mesh: o, home: o.position.clone(), rot: o.rotation.clone(), lie: o.userData.display, knocked: false,
      });
    });
    const glassMat = new THREE.MeshBasicMaterial({ map: glass, transparent: true, depthWrite: false });
    const n = (sf.mullions ?? 0) + 1;
    const a = group.rotation.y;
    for (let k = 0; k < n; k++) {
      const x0 = wx0 + ((wx1 - wx0) * k) / n, x1 = wx0 + ((wx1 - wx0) * (k + 1)) / n;
      const geo = new THREE.PlaneGeometry(x1 - x0, head - sill);
      // this pane's slice of the shared lettering texture
      const uv = geo.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setX(i, (k + uv.getX(i)) / n);
      const mesh = new THREE.Mesh(geo, glassMat);
      mesh.position.set((x0 + x1) / 2, (sill + head) / 2, -0.03);
      group.add(mesh);
      // ragdoll collider: a slab behind the glass, outside the room
      const c = group.localToWorld(new THREE.Vector3((x0 + x1) / 2, 0, -0.25));
      const pane: Pane = {
        x0, x1, mesh, broken: false, breakSpeed: BREAK_SPEED,
        ob: {
          x: c.x, z: c.z, halfW: (x1 - x0) / 2, halfD: 0.25,
          y0: sill, y1: head, c: Math.cos(a), s: Math.sin(a),
        },
        shatter: (at, vel) => this.shatter(pane, at, vel),
      };
      this.panes.push(pane);
    }
  }

  /**
   * Per render frame: shove impacts, shard physics, and the reset when a
   * new round starts. Returns world points of panes broken since last call.
   */
  update(sim: SimState, dt: number): THREE.Vector3[] {
    const ended = sim.roundPhase === 'end';
    if ((this.wasEnded && !ended) || sim.frame < this.lastFrame) this.reset();
    this.wasEnded = ended;
    this.lastFrame = sim.frame;

    for (const f of sim.fighters) {
      // the OVERPOWERED slide is the only stagger that carries a dash
      if (f.phase !== 'stagger' || f.dashLeft <= 0) continue;
      const p = this.group.worldToLocal(new THREE.Vector3(f.pos.x, 1.1, f.pos.z));
      const dir = new THREE.Vector3(f.dashVec.x, 0, f.dashVec.z).applyAxisAngle(UP, -this.group.rotation.y);
      if (p.z > BODY_RADIUS + 0.1 || dir.z > -0.3) continue; // not slammed into this wall
      const pane = this.panes.find((q) => p.x > q.x0 - 0.1 && p.x < q.x1 + 0.1 && !q.broken);
      if (!pane) continue;
      p.z = 0;
      const at = this.group.localToWorld(p);
      pane.shatter(at, new THREE.Vector3(f.dashVec.x, 0, f.dashVec.z).multiplyScalar(SHOVE_SPEED));
    }

    for (const s of this.shards) {
      if (s.resting) continue;
      s.vel.y -= GRAVITY * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      const z = s.mesh.position.z;
      // shop floor, pavement, or down in the road past the kerb
      const ground = (z > 0 ? 0.004 : z > -3.0 ? -0.026 : -0.196) + s.lie;
      if (s.mesh.position.y <= ground) {
        s.mesh.position.y = ground;
        s.mesh.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
        s.resting = true;
      }
    }

    const out = this.broke;
    this.broke = [];
    return out;
  }

  private shatter(pane: Pane, at: THREE.Vector3, vel: THREE.Vector3): void {
    if (pane.broken) return;
    pane.broken = true;
    pane.mesh.visible = false;
    this.broke.push(at.clone());
    const push = vel.clone().applyAxisAngle(UP, -this.group.rotation.y); // wall-local
    const hit = this.group.worldToLocal(at.clone());
    const w = pane.x1 - pane.x0, h = this.head - this.sill;
    const count = Math.round(w * h * SHARDS_PER_M2);
    // shards near the impact fly hardest, along the blow; the rest drop
    const fling = (mesh: THREE.Object3D, lie: number, spinRate: number): void => {
      const near = Math.max(0, 1 - mesh.position.distanceTo(hit) / 1.2);
      const vel = push.clone().multiplyScalar((0.25 + 0.6 * near) * (0.6 + Math.random() * 0.6));
      vel.x += (Math.random() - 0.5) * 1.2;
      vel.y += Math.random() * 1.2;
      vel.z += (Math.random() - 0.5) * 0.8;
      const spin = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5)
        .multiplyScalar(spinRate);
      this.shards.push({ mesh, vel, spin, resting: false, lie });
    };
    for (let i = 0; i < count; i++) {
      const size = 0.07 + Math.random() * 0.16;
      const mesh = new THREE.Mesh(this.triangle(size), this.shardMat);
      mesh.position.set(pane.x0 + Math.random() * w, this.sill + Math.random() * h, -0.03);
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.debris.add(mesh);
      fling(mesh, 0, 18);
    }
    // the window display behind that pane goes with it
    for (const d of this.display) {
      if (d.knocked || d.home.x < pane.x0 || d.home.x > pane.x1) continue;
      d.knocked = true;
      fling(d.mesh, d.lie, 8);
    }
    // jagged teeth left in the frame
    for (let i = 0; i < 9; i++) {
      const edge = i % 3; // sill, head, a jamb
      const len = 0.1 + Math.random() * 0.3, base = 0.12 + Math.random() * 0.2;
      const geo = new THREE.BufferGeometry();
      let pts: number[];
      if (edge < 2) {
        const x = pane.x0 + Math.random() * (w - base), y = edge === 0 ? this.sill : this.head;
        const tip = edge === 0 ? len : -len;
        pts = [x, y, 0, x + base, y, 0, x + Math.random() * base, y + tip, 0];
      } else {
        const side = Math.random() < 0.5 ? pane.x0 : pane.x1;
        const y = this.sill + Math.random() * (h - base), tip = side === pane.x0 ? len : -len;
        pts = [side, y, 0, side, y + base, 0, side + tip, y + Math.random() * base, 0];
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const tooth = new THREE.Mesh(geo, this.shardMat);
      tooth.position.z = -0.03;
      this.debris.add(tooth);
    }
  }

  private triangle(size: number): THREE.BufferGeometry {
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

  /** Fresh glass for the new round. */
  private reset(): void {
    for (const p of this.panes) {
      p.broken = false;
      p.mesh.visible = true;
    }
    for (const o of this.debris.children) (o as THREE.Mesh).geometry.dispose();
    this.debris.clear();
    this.shards = [];
    for (const d of this.display) {
      d.mesh.position.copy(d.home);
      d.mesh.rotation.copy(d.rot);
      d.knocked = false;
    }
  }
}
