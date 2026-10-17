import * as THREE from 'three';
import { BODY_RADIUS } from '../sim/sim';
import { Obstacle, SimState, StageProp } from '../sim/types';
import { Debris, RoundWatch, Smash, Smashable, shardGeo, shardMat } from './debris';
import { Breakable } from './ragdoll';

const BREAK_SPEED = 2.0;  // m/s a corpse must hit it at — sturdier than the window
const SHOVE_SPEED = 4;    // a shoved fighter's slide, for the debris
const FLOOR = -0.016;     // the shop floor (y = -0.02), plus a hair
const UP = new THREE.Vector3(0, 1, 0);

interface Spark {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  life0: number;
}

/**
 * A solid prop with a CRT in it — the demo kiosk, the arcade cabinet — and
 * a `Breakable` that stays solid: a corpse flung into it at `BREAK_SPEED`,
 * or a fighter shoved into it out of a tsubazeriai, implodes the tube
 * (flash, cracked dead screen, glass, sparks that keep popping), knocks the
 * `topper` sign off and sets the cabinet rocking. It never topples — the
 * sim's collider stays upright, so the corpse slumps against the wreck
 * instead of thin air. Subclasses build the furniture into `body` (front =
 * local +z), mount the tube with `tube()` and fill and place `topper`.
 * Render-only; repaired for the next round.
 */
export abstract class CrtCabinet implements Smashable {
  readonly object = new THREE.Group(); // world frame: the cabinet and its debris
  readonly breakables: Breakable[];
  protected body = new THREE.Group();  // the cabinet, rocking about its base
  protected topper = new THREE.Group();
  protected glass!: THREE.Mesh;
  private topperHome = new THREE.Matrix4();
  private debris = new Debris(() => FLOOR);
  private sparkGeo = new THREE.BoxGeometry(0.014, 0.014, 0.014);
  private sparkMat = new THREE.MeshBasicMaterial({ color: '#ffe7a0' });
  private sparks: Spark[] = [];
  private pops = 0;
  private popIn = 0;
  private rockT = 0;
  private rockAmp = 0;
  private tipAxis = new THREE.Vector3();
  private yaw = new THREE.Quaternion();
  private tilt = new THREE.Quaternion();
  private smashes: Smash[] = [];
  private round = new RoundWatch();
  private ob: Obstacle;
  private unit: Breakable;

  constructor(p: StageProp, protected screen: CrtScreen) {
    const [w, h, d] = p.size;
    const a = ((p.rot ?? 0) * Math.PI) / 180;
    this.body.position.set(p.pos[0], p.pos[1], p.pos[2]);
    this.yaw.setFromAxisAngle(UP, a);
    this.body.quaternion.copy(this.yaw);
    this.body.add(this.topper);
    this.object.add(this.body, this.debris.group);
    this.ob = {
      x: p.pos[0], z: p.pos[2], halfW: w / 2, halfD: d / 2,
      y0: p.pos[1], y1: p.pos[1] + h, c: Math.cos(a), s: Math.sin(a),
    };
    this.unit = {
      ob: this.ob, broken: false, breakSpeed: BREAK_SPEED, solid: true,
      shatter: (_at, vel) => this.smash(vel),
    };
    this.breakables = [this.unit];
  }

  /** The tube's face, `w` × `h`, showing the screen; the caller places it. */
  protected tube(w: number, h: number): THREE.Mesh {
    this.glass = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: this.screen.tex }));
    this.body.add(this.glass);
    return this.glass;
  }

  /**
   * Per render frame: the attract loop, shove impacts, debris, sparks, the
   * rocking, and the repair when a new round starts. Returns what broke.
   */
  update(sim: SimState, dt: number): Smash[] {
    if (this.round.newRound(sim)) this.reset();
    this.screen.update(dt);

    if (!this.unit.broken) {
      for (const f of sim.fighters) {
        // the OVERPOWERED slide is the only stagger that carries a dash
        if (f.phase !== 'stagger' || f.dashLeft <= 0) continue;
        const ob = this.ob, dx = f.pos.x - ob.x, dz = f.pos.z - ob.z;
        if (f.dashVec.x * dx + f.dashVec.z * dz >= 0) continue; // sliding away from it
        const lx = dx * ob.c - dz * ob.s, lz = dx * ob.s + dz * ob.c;
        const gap = Math.hypot(Math.max(0, Math.abs(lx) - ob.halfW), Math.max(0, Math.abs(lz) - ob.halfD));
        if (gap > BODY_RADIUS + 0.08) continue;
        this.smash(new THREE.Vector3(f.dashVec.x, 0, f.dashVec.z).multiplyScalar(SHOVE_SPEED));
        break;
      }
    }

    this.debris.update(dt);
    if (this.rockAmp > 0) {
      // tips away from the blow, rocks back past upright, settles
      this.rockT += dt;
      const ang = this.rockAmp * Math.exp(-3.5 * this.rockT) * Math.sin(9 * this.rockT);
      this.tilt.setFromAxisAngle(this.tipAxis, ang);
      this.body.quaternion.copy(this.tilt).multiply(this.yaw);
      if (this.rockT > 2.5) {
        this.rockAmp = 0;
        this.body.quaternion.copy(this.yaw);
      }
    }
    if (this.pops > 0 && (this.popIn -= dt) <= 0) {
      this.pops--;
      this.popIn = 0.4 + Math.random() * 1.1;
      this.burst(5 + Math.floor(Math.random() * 6), 1.2);
      this.screen.flicker();
      this.smashes.push({ at: this.glass.getWorldPosition(new THREE.Vector3()), kind: 'spark' });
    }
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.object.remove(s.mesh);
        this.sparks.splice(i, 1);
        continue;
      }
      s.vel.y -= 9.8 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      if (s.mesh.position.y < FLOOR) { s.mesh.position.y = FLOOR; s.vel.multiplyScalar(0.3); s.vel.y *= -1; }
      s.mesh.scale.setScalar(s.life / s.life0);
    }

    const out = this.smashes;
    this.smashes = [];
    return out;
  }

  private smash(vel: THREE.Vector3): void {
    if (this.unit.broken) return;
    this.unit.broken = true;
    this.screen.smash();
    this.body.updateMatrixWorld(true);
    const centre = this.glass.getWorldPosition(new THREE.Vector3());
    this.smashes.push({ at: centre, kind: 'crt' });

    const dir = new THREE.Vector3(vel.x, 0, vel.z);
    const speed = dir.length();
    if (speed < 1e-3) dir.set(0, 0, -1).applyQuaternion(this.yaw);
    else dir.divideScalar(speed);
    this.tipAxis.set(dir.z, 0, -dir.x); // up × dir: the top swings along the blow
    this.rockAmp = THREE.MathUtils.clamp(speed * 0.035, 0.06, 0.2);
    this.rockT = 0;

    // the tube's face glass, out of the bezel and onto the floor
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(this.glass.getWorldQuaternion(new THREE.Quaternion()));
    const g = this.glass.geometry as THREE.PlaneGeometry;
    const { width, height } = g.parameters;
    for (let i = 0; i < 22; i++) {
      const mesh = new THREE.Mesh(shardGeo(0.03 + Math.random() * 0.06), shardMat);
      mesh.position.set((Math.random() - 0.5) * width, (Math.random() - 0.5) * height, 0.01);
      this.glass.localToWorld(mesh.position);
      this.debris.group.worldToLocal(mesh.position);
      mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      const v = facing.clone().multiplyScalar(0.4 + Math.random() * 1.2).addScaledVector(dir, speed * 0.15);
      v.x += (Math.random() - 0.5) * 1.0;
      v.y += Math.random() * 1.0;
      v.z += (Math.random() - 0.5) * 1.0;
      this.debris.fling(mesh, v, 18);
    }
    // the topper comes off and lands flat, clear of the cabinet
    this.topperHome.compose(this.topper.position, this.topper.quaternion, this.topper.scale);
    this.debris.group.attach(this.topper);
    const tv = dir.clone().multiplyScalar(1.5).add(new THREE.Vector3(0, 0.8, 0));
    this.debris.fling(this.topper, tv, 3, 0.05);

    this.burst(28, 2.2);
    this.pops = 5;
    this.popIn = 0.3 + Math.random() * 0.5;
  }

  /** A spray of sparks from the dead tube. */
  private burst(n: number, power: number): void {
    const at = this.glass.getWorldPosition(new THREE.Vector3());
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(this.body.quaternion);
    for (let i = 0; i < n; i++) {
      const mesh = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      mesh.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.2, 0));
      const vel = facing.clone().multiplyScalar(power * (0.3 + Math.random() * 0.7));
      vel.x += (Math.random() - 0.5) * power;
      vel.y += Math.random() * power;
      vel.z += (Math.random() - 0.5) * power;
      const life = 0.25 + Math.random() * 0.5;
      this.sparks.push({ mesh, vel, life, life0: life });
      this.object.add(mesh);
    }
  }

  /** Good as new for the next round. */
  private reset(): void {
    if (this.unit.broken) {
      this.body.add(this.topper);
      this.topperHome.decompose(this.topper.position, this.topper.quaternion, this.topper.scale);
    }
    this.unit.broken = false;
    this.screen.reset();
    this.debris.clear();
    for (const s of this.sparks) this.object.remove(s.mesh);
    this.sparks = [];
    this.pops = 0;
    this.rockAmp = 0;
    this.body.quaternion.copy(this.yaw);
  }
}

export const SCR_W = 128, SCR_H = 96;

/** One frame of a screen's attract loop, `t` seconds in, onto a SCR_W × SCR_H canvas. */
export type Attract = (g: CanvasRenderingContext2D, t: number) => void;

/**
 * A cabinet's CRT, drawn into a tiny canvas (nearest filter, so it stays
 * chunky) at ~12 fps, like the hardware it's selling: the `attract` loop
 * until it's smashed, then the dead tube — collapse to a dot, a hole in the
 * face glass, static when the wreck sparks.
 */
export class CrtScreen {
  readonly tex: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private t = 0;
  private acc = 1;
  private broken = false;
  private brokenT = 0;
  private flickerT = 0;
  private hole: number[] = [];     // jagged outline of the smashed face, x,y pairs
  private cracks: number[][] = []; // polylines running out from it

  constructor(private attract: Attract) {
    const cv = document.createElement('canvas');
    cv.width = SCR_W; cv.height = SCR_H;
    this.g = cv.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.draw();
  }

  update(dt: number): void {
    this.t += dt;
    this.acc += dt;
    if (this.broken) {
      this.brokenT += dt;
      this.flickerT -= dt;
    }
    if (this.acc < 1 / 12) return;
    this.acc = 0;
    this.draw();
    this.tex.needsUpdate = true;
  }

  /** The tube goes: flash, collapse to a dot, a hole in the face glass. */
  smash(): void {
    this.broken = true;
    this.brokenT = 0;
    this.acc = 1; // redraw on the next frame, not the next 12th
    const cx = SCR_W / 2 + (Math.random() - 0.5) * 40, cy = SCR_H / 2 + (Math.random() - 0.5) * 30;
    this.hole = [];
    this.cracks = [];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const r = 14 + Math.random() * 14;
      const x = cx + Math.cos(a) * r * 1.3, y = cy + Math.sin(a) * r;
      this.hole.push(x, y);
      if (Math.random() < 0.75) {
        const line = [x, y];
        let px = x, py = y, pa = a;
        for (let k = 0; k < 3; k++) {
          pa += (Math.random() - 0.5) * 0.8;
          const len = 10 + Math.random() * 22;
          px += Math.cos(pa) * len * 1.3; py += Math.sin(pa) * len;
          line.push(px, py);
        }
        this.cracks.push(line);
      }
    }
  }

  /** A crackle of static across the dead tube. */
  flicker(): void {
    this.flickerT = 0.2;
    this.acc = 1;
  }

  reset(): void {
    this.broken = false;
    this.flickerT = 0;
    this.acc = 1;
  }

  private draw(): void {
    const g = this.g;
    if (this.broken) this.dead(g);
    else this.attract(g, this.t);
    // scanlines
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < SCR_H; y += 2) g.fillRect(0, y, SCR_W, 1);
  }

  private dead(g: CanvasRenderingContext2D): void {
    const T = this.brokenT;
    if (T < 0.1) {
      g.fillStyle = '#eef4ff'; g.fillRect(0, 0, SCR_W, SCR_H);
      return;
    }
    g.fillStyle = '#0b0d10'; g.fillRect(0, 0, SCR_W, SCR_H);
    if (T < 0.7) {
      // the picture folding to a line, then a dot
      const k = (T - 0.1) / 0.6;
      const lw = SCR_W * (1 - k) ** 3 + 2, lh = Math.max(1, 5 * (1 - 2 * k));
      g.fillStyle = `rgba(230,240,255,${1 - 0.7 * k})`;
      g.fillRect(SCR_W / 2 - lw / 2, SCR_H / 2 - lh / 2, lw, lh);
    }
    if (this.flickerT > 0) {
      const y0 = Math.floor(Math.random() * (SCR_H - 24));
      for (let y = y0; y < y0 + 24; y++) {
        for (let x = 0; x < SCR_W; x += 2) {
          const v = Math.floor(Math.random() * 200);
          g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 2, 1);
        }
      }
    }
    // the hole in the face glass: black inside, jagged rim, cracks running out
    g.fillStyle = '#000000';
    g.beginPath();
    g.moveTo(this.hole[0], this.hole[1]);
    for (let i = 2; i < this.hole.length; i += 2) g.lineTo(this.hole[i], this.hole[i + 1]);
    g.closePath(); g.fill();
    g.strokeStyle = 'rgba(205,220,235,0.7)'; g.lineWidth = 1;
    g.stroke();
    for (const line of this.cracks) {
      g.beginPath();
      g.moveTo(line[0], line[1]);
      for (let i = 2; i < line.length; i += 2) g.lineTo(line[i], line[i + 1]);
      g.stroke();
    }
  }
}
