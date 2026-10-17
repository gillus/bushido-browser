import * as THREE from 'three';
import { BODY_RADIUS } from '../sim/sim';
import { Obstacle, SimState, StageProp } from '../sim/types';
import { Debris, RoundWatch, Smash, Smashable, shardGeo, shardMat } from './debris';
import { BoxBatch, c, signMesh } from './fixtures';
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
 * Console demo kiosk (`"fixture": "kiosk"`): plinth, cabinet with side
 * fins, a tethered pad on a sloped ledge, a CRT running an attract-mode
 * loop, and a lit topper. It's a solid prop, and a `Breakable` that stays
 * solid: a corpse flung into it at `BREAK_SPEED`, or a fighter shoved into
 * it out of a tsubazeriai, implodes the tube (flash, cracked dead screen,
 * glass, sparks that keep popping), knocks the topper sign off and sets the
 * cabinet rocking. It never topples — the sim's collider stays upright, so
 * the corpse slumps against the wreck instead of thin air. Render-only;
 * repaired for the next round.
 */
export class Kiosk implements Smashable {
  readonly object = new THREE.Group(); // world frame: the cabinet and its debris
  readonly breakables: Breakable[];
  private body = new THREE.Group();    // the cabinet, rocking about its base
  private topper = new THREE.Group();
  private topperHome = new THREE.Matrix4();
  private glass: THREE.Mesh;
  private screen = new DemoScreen();
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
  private kiosk: Breakable;

  constructor(p: StageProp) {
    const [w, h, d] = p.size;
    const a = ((p.rot ?? 0) * Math.PI) / 180;
    this.body.position.set(p.pos[0], p.pos[1], p.pos[2]);
    this.yaw.setFromAxisAngle(UP, a);
    this.body.quaternion.copy(this.yaw);
    this.object.add(this.body, this.debris.group);

    const b = new BoxBatch();
    const body = c(p.color), dark = c('#1f2026'), accent = c(p.accent ?? '#2f6fa8');
    const front = d / 2;

    b.box(0, 0.04, 0, w - 0.06, 0.08, d - 0.06, dark);
    // cabinet, with a lit stripe and a speaker grille on its face
    const cabFront = -0.06 + (d * 0.6) / 2;
    b.box(0, 0.08 + 0.41, -0.06, w * 0.76, 0.82, d * 0.6, body);
    b.box(0, 0.7, cabFront + 0.003, w * 0.76, 0.04, 0.006, accent);
    for (let k = 0; k < 5; k++) b.box(0, 0.3 + k * 0.035, cabFront + 0.003, w * 0.4, 0.012, 0.006, dark);
    // side fins, full height, in the brand colour's dark shade
    const fin = c(p.accent ?? '#2f6fa8', 0.45);
    for (const s of [-1, 1]) {
      b.box(s * (w / 2 - 0.025), 0.08 + (h - 0.08) / 2, -0.08, 0.05, h - 0.08, d * 0.6, fin);
      b.box(s * (w / 2 - 0.025), h * 0.55, -0.08 + d * 0.3 + 0.003, 0.052, h * 0.6, 0.006, accent);
    }
    // sloped ledge, wider than the cabinet, with the pad on it
    const ly = 0.95, slope = 0.32;
    b.box(0, ly, front - 0.17, w * 0.9, 0.035, 0.3, dark, slope);
    pad(b, 0, ly, front - 0.17, slope);
    // the tether: along the ledge from the pad into the cabinet, with a kink
    const on = onLedge(0, ly, front - 0.17, slope);
    const cable = c('#0d0d10');
    for (const [lx, lz] of [[0, -0.045], [0.01, -0.085], [0.025, -0.12]]) b.box(...on(lx, 0.005, lz), 0.008, 0.008, 0.045, cable, slope);

    // CRT: bezel + tapered back, screen set into the front
    const sy = 1.3, sw = w * 0.82, sh = 0.46, crtFront = 0.2;
    b.box(0, sy, crtFront - 0.2, sw, sh + 0.08, 0.4, c('#2a2c33'));
    b.box(0, sy + 0.01, crtFront - 0.46, sw * 0.7, (sh + 0.08) * 0.75, 0.16, c('#23252b'));
    b.box(0, ly + 0.08, -0.08, 0.28, 0.12, 0.28, dark); // neck
    this.glass = new THREE.Mesh(
      new THREE.PlaneGeometry(sw * 0.86, sh * 0.84),
      new THREE.MeshBasicMaterial({ map: this.screen.tex }),
    );
    this.glass.position.set(0, sy, crtFront + 0.001);
    this.body.add(b.mesh(), this.glass);

    // topper sign, out in front of the fins — its own piece, it comes off
    const tb = new BoxBatch();
    tb.box(0, -0.15, 0, w, 0.3, 0.1, body);
    const sign = signMesh(p.label ?? 'PLAY IT NOW', p.accent ?? '#2f6fa8', w - 0.05, 0.25);
    sign.position.z = 0.051;
    const board = tb.mesh();
    board.position.y = 0.15; // centre the box on the group's origin
    this.topper.add(board, sign);
    this.topper.position.set(0, h - 0.16, crtFront - 0.05);
    this.topperHome.copy(this.topper.matrix.compose(this.topper.position, this.topper.quaternion, this.topper.scale));
    this.body.add(this.topper);

    this.ob = {
      x: p.pos[0], z: p.pos[2], halfW: w / 2, halfD: d / 2,
      y0: p.pos[1], y1: p.pos[1] + h, c: Math.cos(a), s: Math.sin(a),
    };
    this.kiosk = {
      ob: this.ob, broken: false, breakSpeed: BREAK_SPEED, solid: true,
      shatter: (at, vel) => this.smash(vel),
    };
    this.breakables = [this.kiosk];
  }

  /**
   * Per render frame: the attract loop, shove impacts, debris, sparks, the
   * rocking, and the repair when a new round starts. Returns what broke.
   */
  update(sim: SimState, dt: number): Smash[] {
    if (this.round.newRound(sim)) this.reset();
    this.screen.update(dt);

    if (!this.kiosk.broken) {
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
    if (this.kiosk.broken) return;
    this.kiosk.broken = true;
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
    const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(this.body.quaternion);
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
    this.kiosk.broken = false;
    this.screen.reset();
    this.body.add(this.topper);
    this.topperHome.decompose(this.topper.position, this.topper.quaternion, this.topper.scale);
    this.debris.clear();
    for (const s of this.sparks) this.object.remove(s.mesh);
    this.sparks = [];
    this.pops = 0;
    this.rockAmp = 0;
    this.body.quaternion.copy(this.yaw);
  }
}

/**
 * Points on top of a ledge centred at (x, y, z) and pitched by `rx`:
 * (lx, up, lz) from the pad's spot on it → world, tilted with the slope.
 */
function onLedge(x: number, y: number, z: number, rx: number): (lx: number, up: number, lz: number) => [number, number, number] {
  const cos = Math.cos(rx), sin = Math.sin(rx);
  return (lx, up, lz) => {
    up += 0.033; lz += 0.03;
    return [x + lx, y + up * cos - lz * sin, z + up * sin + lz * cos];
  };
}

/** Grey dual-grip pad lying on a ledge centred at (x, y, z), pitched by `rx`. */
function pad(b: BoxBatch, x: number, y: number, z: number, rx: number): void {
  const grey = c('#a9abb0'), deep = c('#7d8086');
  const at = onLedge(x, y, z, rx);
  b.box(...at(0, 0, 0), 0.15, 0.03, 0.065, grey, rx);
  for (const s of [-1, 1]) b.box(...at(s * 0.055, -0.004, 0.045), 0.04, 0.026, 0.05, deep, rx);
  b.box(...at(-0.042, 0.017, -0.004), 0.034, 0.006, 0.011, c('#2a2b30'), rx); // d-pad
  b.box(...at(-0.042, 0.017, -0.004), 0.011, 0.006, 0.034, c('#2a2b30'), rx);
  const buttons: [number, number, string][] = [[0.042, -0.016, '#3f9f6a'], [0.058, -0.004, '#c8403a'], [0.042, 0.009, '#4a6fc0'], [0.026, -0.004, '#c86aa8']];
  for (const [bx, bz, col] of buttons) b.box(...at(bx, 0.017, bz), 0.011, 0.007, 0.011, c(col), rx);
}

const SCR_W = 128, SCR_H = 96;
const DEMO_SECS = 9, TITLE_SECS = 4;

/**
 * Attract mode on the kiosk CRT, drawn into a tiny canvas (nearest filter,
 * so it stays chunky): a pseudo-3D road racer that loops into its title
 * screen. ~12 fps, like the hardware it's selling.
 */
class DemoScreen {
  readonly tex: THREE.CanvasTexture;
  private g: CanvasRenderingContext2D;
  private t = 0;
  private acc = 1;
  private broken = false;
  private brokenT = 0;
  private flickerT = 0;
  private hole: number[] = [];     // jagged outline of the smashed face, x,y pairs
  private cracks: number[][] = []; // polylines running out from it

  constructor() {
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
    const g = this.g, t = this.t % (DEMO_SECS + TITLE_SECS);
    if (this.broken) this.dead(g);
    else if (t > DEMO_SECS) this.title(g, t - DEMO_SECS);
    else this.race(g, t);
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

  private race(g: CanvasRenderingContext2D, t: number): void {
    const horizon = 38;
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#1d2a6a'); sky.addColorStop(1, '#d0784a');
    g.fillStyle = sky; g.fillRect(0, 0, SCR_W, horizon);
    // far hills drift against the curve
    const curve = Math.sin(t * 0.7) * 0.8;
    g.fillStyle = '#2a2140';
    for (let i = -1; i < 6; i++) {
      const hx = ((i * 34 - curve * 30 + t * 4) % 204) - 20;
      g.beginPath(); g.moveTo(hx, horizon); g.lineTo(hx + 22, horizon - 12); g.lineTo(hx + 46, horizon); g.fill();
    }
    // road, row by row, with scrolling rumble bands
    for (let y = horizon; y < SCR_H; y++) {
      const k = (y - horizon) / (SCR_H - horizon); // 0 far → 1 near
      const z = 1 / (k + 0.05);
      const band = Math.floor(z * 2 + t * 18) % 2 === 0;
      const cx = SCR_W / 2 + curve * (1 - k) * (1 - k) * 60;
      const half = 6 + k * 70;
      g.fillStyle = band ? '#2f6a2a' : '#3a7a33'; g.fillRect(0, y, SCR_W, 1);
      g.fillStyle = band ? '#c8c8c8' : '#b8312f'; g.fillRect(cx - half * 1.12, y, half * 2.24, 1);
      g.fillStyle = band ? '#55565c' : '#4d4e54'; g.fillRect(cx - half, y, half * 2, 1);
      if (band) { g.fillStyle = '#e8e4da'; g.fillRect(cx - half * 0.03, y, Math.max(1, half * 0.06), 1); }
    }
    // the car, sliding against the curve
    const carX = SCR_W / 2 - curve * 10 - 12, carY = 72;
    g.fillStyle = '#7a1414'; g.fillRect(carX, carY + 6, 24, 9);
    g.fillStyle = '#c8302a'; g.fillRect(carX + 2, carY + 4, 20, 8); g.fillRect(carX + 5, carY, 14, 6);
    g.fillStyle = '#141416'; g.fillRect(carX - 1, carY + 12, 6, 6); g.fillRect(carX + 19, carY + 12, 6, 6);
    g.fillStyle = '#9fc8ef'; g.fillRect(carX + 7, carY + 1, 10, 3);
    g.fillStyle = '#e8c84a'; g.fillRect(carX + 2, carY + 9, 3, 2); g.fillRect(carX + 19, carY + 9, 3, 2);
    // HUD
    g.font = 'bold 9px monospace'; g.textBaseline = 'top';
    g.fillStyle = '#e8c84a';
    const lap = (t * 1.37).toFixed(2).padStart(5, '0');
    g.fillText(`LAP 1/3  ${lap}`, 4, 3);
    g.fillText(`${Math.floor(180 + Math.sin(t * 2) * 25)} km/h`, 4, SCR_H - 12);
    if (Math.floor(t * 2) % 2 === 0) { g.fillStyle = '#f4f1e8'; g.fillText('DEMO', SCR_W - 30, SCR_H - 12); }
  }

  private title(g: CanvasRenderingContext2D, t: number): void {
    g.fillStyle = '#08070c'; g.fillRect(0, 0, SCR_W, SCR_H);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'italic 900 22px Impact, "Arial Black", sans-serif';
    const glint = Math.min(1, t * 1.5);
    g.fillStyle = '#b8312f'; g.fillText('NITRO', SCR_W / 2 + 2, 30 + 2);
    g.fillStyle = '#e8c84a'; g.fillText('NITRO', SCR_W / 2, 30);
    g.font = 'italic 900 14px Impact, "Arial Black", sans-serif';
    g.fillStyle = '#f4f1e8'; g.fillText('HIGHWAY  2', SCR_W / 2, 50);
    g.fillStyle = `rgba(255,255,255,${0.6 * (1 - glint)})`; g.fillRect(0, 18, SCR_W * glint, 2);
    g.font = 'bold 9px monospace';
    if (Math.floor(t * 2.5) % 2 === 0) { g.fillStyle = '#f4f1e8'; g.fillText('PRESS START', SCR_W / 2, 74); }
    g.fillStyle = '#6a6a72'; g.fillText('© 1998', SCR_W / 2, 88);
    g.textAlign = 'left';
  }
}
