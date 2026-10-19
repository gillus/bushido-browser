import * as THREE from 'three';
import { Obstacle, SimState, StageProp } from '../sim/types';
import { cutThrough, Debris, RoundWatch, Smash, Smashable, shardGeo, shardMat, shoved, struck } from './debris';
import { BoxBatch, c, rng } from './fixtures';
import { Breakable } from './ragdoll';

const BREAK_SPEED = 1.8;  // m/s — a corpse slumping onto the glass is plenty
const SHOVE_SPEED = 4;    // a shoved fighter's slide, for the debris
const CUT_SPEED = 3;      // a blade's blow, for the debris
const FLOOR = -0.016;     // the shop floor (y = -0.02), plus a hair
const RAIL = 0.04;        // the metal frame round the glass
const DEPTH = 0.09;       // glass down to the felt
const ART = ['#8f2f2f', '#2f4f8f', '#3f7a4f', '#6f3f8f', '#8f7a2f', '#2f6f7a', '#a04a3f', '#1f2a5a', '#c8c2b0'];

/** A case on top of the glass, and where it lay. */
interface Loose {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  rot: THREE.Euler;
}

/**
 * Glass-topped display table (`"fixture": "table"`): a cabinet base with a
 * lit vitrine of games and a console laid out on felt under a glass top,
 * and a few cases left lying on the glass. It's a solid prop and a
 * `Breakable` that stays solid: a corpse landing on it or flung into it at
 * `BREAK_SPEED`, a fighter shoved into it out of a tsubazeriai, or a blade
 * — an overhead cut coming down across it (the sim lets that pass over: the
 * blade goes on through), or a rising cut rebounding off it — shatters
 * the top — shards rain into the vitrine and over the floor, teeth stay in
 * the frame, the cases on top go flying. Render-only; reglazed for the next
 * round.
 */
export class DisplayTable implements Smashable {
  readonly object = new THREE.Group(); // the table's own frame: front = +z
  readonly breakables: Breakable[];
  private glass: THREE.Mesh;
  private loose: Loose[] = [];
  private debris: Debris;
  private smashes: Smash[] = [];
  private round = new RoundWatch();
  private ob: Obstacle;
  private unit: Breakable;
  private w: number;
  private h: number;
  private d: number;

  constructor(p: StageProp) {
    const [w, h, d] = p.size;
    this.w = w; this.h = h; this.d = d;
    const a = ((p.rot ?? 0) * Math.PI) / 180;
    this.object.position.set(p.pos[0], p.pos[1], p.pos[2]);
    this.object.rotation.y = a;
    const rand = rng(Math.round(p.pos[0] * 1009 + p.pos[2] * 2003 + p.pos[1] * 17) | 0);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];

    const b = new BoxBatch();
    const body = c(p.color), dark = c('#1c1d22'), metal = c('#8a8f99'), accent = c(p.accent ?? '#c8302a');
    // base: inset plinth, cabinet, an accent band all the way round
    b.box(0, 0.04, 0, w - 0.08, 0.08, d - 0.08, dark);
    b.box(0, 0.08 + (h - DEPTH - 0.08) / 2, 0, w - 0.02, h - DEPTH - 0.08, d - 0.02, body);
    b.box(0, h - DEPTH - 0.06, 0, w - 0.016, 0.03, d - 0.016, accent);
    // the vitrine: metal rails round a felt bed
    const bed = h - DEPTH + 0.01;
    b.box(0, h - DEPTH + 0.005, 0, w - 2 * RAIL, 0.01, d - 2 * RAIL, c('#1d2f4f'));
    for (const s of [-1, 1]) {
      b.box(0, h - DEPTH / 2, s * (d / 2 - RAIL / 2), w, DEPTH, RAIL, metal);
      b.box(s * (w / 2 - RAIL / 2), h - DEPTH / 2, 0, RAIL, DEPTH, d - 2 * RAIL, metal);
    }
    // under the glass: a console and its pad in the middle, games in rows either side
    b.box(0, bed + 0.03, -0.06, 0.28, 0.06, 0.2, c('#a9abb0'));
    b.box(0, bed + 0.061, -0.06, 0.12, 0.002, 0.13, c('#7d8086'), 0, 0, false);
    b.box(0, bed + 0.015, 0.16, 0.15, 0.03, 0.065, c('#a9abb0'));
    for (const s of [-1, 1]) {
      for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 2; row++) {
          const x = s * (0.25 + col * 0.155), z = -0.11 + row * 0.23, art = c(pick(ART));
          b.box(x, bed + 0.008, z, 0.135, 0.016, 0.19, c('#141418'));
          b.box(x, bed + 0.0165, z + 0.012, 0.125, 0.002, 0.16, art, 0, 0, false);
          b.box(x, bed + 0.0175, z - 0.08, 0.125, 0.002, 0.018, c('#e8e4da'), 0, 0, false);
          b.box(x + 0.04, bed + 0.0185, z + 0.06, 0.03, 0.002, 0.02, c('#e8843a'), 0, 0, false); // price sticker
        }
      }
    }
    this.object.add(b.mesh());

    this.glass = new THREE.Mesh(
      new THREE.PlaneGeometry(w - 2 * RAIL, d - 2 * RAIL),
      new THREE.MeshBasicMaterial({ map: glare(), transparent: true, depthWrite: false }),
    );
    this.glass.rotation.x = -Math.PI / 2;
    this.glass.position.y = h - 0.004;
    this.object.add(this.glass);

    // cases left lying on the glass: their own meshes, they go flying
    for (const [x, z, yaw] of [[-0.38, 0.12, 0.35], [0.3, -0.05, -0.6], [0.42, 0.2, 0.2]]) {
      const side = new THREE.MeshLambertMaterial({ color: '#141418' });
      const cover = new THREE.MeshLambertMaterial({ color: pick(ART) });
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.135, 0.19, 0.016), [side, side, side, side, cover, side]);
      mesh.position.set(x, h + 0.008, z);
      mesh.rotation.set(-Math.PI / 2, 0, yaw);
      this.object.add(mesh);
      this.loose.push({ mesh, pos: mesh.position.clone(), rot: mesh.rotation.clone() });
    }

    // debris lands on the felt or the floor (a bit on a rail sinks out of sight)
    this.debris = new Debris((x, z) => (Math.abs(x) < w / 2 && Math.abs(z) < d / 2 ? bed + 0.003 : FLOOR));
    this.object.add(this.debris.group);

    this.ob = {
      x: p.pos[0], z: p.pos[2], halfW: w / 2, halfD: d / 2,
      y0: p.pos[1], y1: p.pos[1] + h, c: Math.cos(a), s: Math.sin(a),
    };
    this.unit = {
      ob: this.ob, broken: false, breakSpeed: BREAK_SPEED, solid: true,
      shatter: (at, vel) => this.smash(at, vel),
    };
    this.breakables = [this.unit];
  }

  /** Per render frame: shove impacts, debris, and the reglazing when a new round starts. */
  update(sim: SimState, dt: number): Smash[] {
    if (this.round.newRound(sim)) this.reset();
    if (!this.unit.broken) {
      const hit = shoved(sim, this.ob, SHOVE_SPEED)
        ?? cutThrough(sim, this.ob, CUT_SPEED, ['high'])
        ?? struck(sim, this.ob, CUT_SPEED);
      if (hit) this.smash(hit.at.setY(this.h), hit.vel);
    }
    this.debris.update(dt);
    const out = this.smashes;
    this.smashes = [];
    return out;
  }

  private smash(at: THREE.Vector3, vel: THREE.Vector3): void {
    if (this.unit.broken) return;
    this.unit.broken = true;
    this.glass.visible = false;
    this.smashes.push({ at: at.clone(), kind: 'glass' });
    const hit = this.object.worldToLocal(at.clone());
    const push = vel.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -this.object.rotation.y);
    const ix = this.w / 2 - RAIL, iz = this.d / 2 - RAIL;

    // the pane: shards near the impact fly along the blow, the rest drop into the case
    const fling = (mesh: THREE.Object3D, up: number, spinRate: number, lie: number): void => {
      const near = Math.max(0, 1 - Math.hypot(mesh.position.x - hit.x, mesh.position.z - hit.z) / 0.8);
      const v = push.clone().multiplyScalar((0.15 + 0.5 * near) * (0.6 + Math.random() * 0.6));
      v.x += (Math.random() - 0.5) * 1.0;
      v.y = Math.random() * up * (0.3 + near);
      v.z += (Math.random() - 0.5) * 1.0;
      this.debris.fling(mesh, v, spinRate, lie);
    };
    for (let i = 0; i < 30; i++) {
      const mesh = new THREE.Mesh(shardGeo(0.05 + Math.random() * 0.12), shardMat);
      mesh.position.set((Math.random() * 2 - 1) * ix, this.h - 0.004, (Math.random() * 2 - 1) * iz);
      mesh.rotation.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.6, 0, Math.random() * 6);
      fling(mesh, 1.6, 14, 0);
    }
    for (const l of this.loose) fling(l.mesh, 2.4, 9, 0.008);

    // jagged teeth left in the frame, pointing in from each rail
    for (let i = 0; i < 12; i++) {
      const edge = i % 4, len = 0.06 + Math.random() * 0.16, base = 0.1 + Math.random() * 0.18;
      const along = edge < 2 ? ix : iz, t = (Math.random() * 2 - 1) * (along - base / 2);
      const s = edge % 2 ? 1 : -1, tip = t + (Math.random() - 0.5) * base;
      // (u along the rail, v inward from it) → table frame
      const pt = (u: number, v: number): number[] =>
        edge < 2 ? [u, this.h - 0.004, s * (iz - v)] : [s * (ix - v), this.h - 0.004, u];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute([...pt(t - base / 2, 0), ...pt(t + base / 2, 0), ...pt(tip, len)], 3));
      this.debris.group.add(new THREE.Mesh(geo, shardMat));
    }
  }

  /** A new top and the cases put back for the next round. */
  private reset(): void {
    this.unit.broken = false;
    this.glass.visible = true;
    for (const l of this.loose) {
      l.mesh.position.copy(l.pos);
      l.mesh.rotation.copy(l.rot);
    }
    this.debris.clear();
  }
}

/** A faint tint with two diagonal glare streaks, so the glass reads as glass. */
function glare(): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = 'rgba(207,230,245,0.16)'; g.fillRect(0, 0, 128, 64);
  g.fillStyle = 'rgba(235,245,255,0.3)';
  for (const [x, wd] of [[30, 18], [58, 6]]) {
    g.beginPath(); g.moveTo(x, 64); g.lineTo(x + wd, 64); g.lineTo(x + wd + 40, 0); g.lineTo(x + 40, 0); g.fill();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
