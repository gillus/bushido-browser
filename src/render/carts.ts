import * as THREE from 'three';
import { CartRules, SimState } from '../sim/types';
import { FighterView } from './fighterView';

// a 16-bit cartridge, a size up so it reads from the duel camera
const W = 0.11 * 1.25, H = 0.135 * 1.25, D = 0.022 * 1.25;
const RELEASE_Y = 1.3;   // leaves the hand about here…
const SETTLE_M = 1.5;    // …and is down on its line this far out
const TUMBLE = 24;       // rad/s end over end: from the side the label flashes round
const TRAIL = 0.7;       // m of motion streak behind it
const GRAVITY = 9.8;
// the shop's fictional catalogue, for the labels
const TITLES = ['SOLAR LANCER', 'NITRO HIGHWAY 2', 'STEEL RONIN', 'DRAGON QUILL III', 'TURBO KAPPA', 'PUNCH PARADE'];
const ART = [['#f2a03a', '#7a1414'], ['#5ad0f0', '#1d2a7a'], ['#e8c84a', '#3a6a2a'], ['#d070e0', '#2a1040']];

const geo = new THREE.BoxGeometry(W, H, D);
const trailGeo = new THREE.BoxGeometry(0.025, 0.025, TRAIL).translate(0, 0, -TRAIL / 2);
const trailMat = new THREE.MeshBasicMaterial({
  color: '#fff6e0', transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending,
});
let backMat: THREE.MeshLambertMaterial | null = null;
const shellMats = new Map<string, THREE.MeshLambertMaterial>();
const labelMats = new Map<string, THREE.MeshLambertMaterial>();

function shellMat(shell: string): THREE.MeshLambertMaterial {
  let m = shellMats.get(shell);
  if (!m) shellMats.set(shell, m = new THREE.MeshLambertMaterial({ color: shell }));
  return m;
}

/** The front: shell border, grip ridges along the top, a printed label. */
function labelMat(shell: string, title: number): THREE.MeshLambertMaterial {
  const key = `${shell}|${title}`;
  let m = labelMats.get(key);
  if (m) return m;
  const cv = document.createElement('canvas');
  cv.width = 44; cv.height = 54;
  const g = cv.getContext('2d')!;
  g.fillStyle = shell; g.fillRect(0, 0, 44, 54);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let x = 6; x < 40; x += 4) g.fillRect(x, 2, 2, 7);
  const [hot, deep] = ART[title % ART.length];
  const art = g.createLinearGradient(0, 12, 0, 50);
  art.addColorStop(0, hot); art.addColorStop(1, deep);
  g.fillStyle = art; g.fillRect(5, 12, 34, 38);
  g.fillStyle = '#101018'; g.fillRect(5, 12, 34, 9);
  g.fillStyle = '#e8e4da';
  g.font = 'bold 7px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(TITLES[title], 22, 17, 32);
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.beginPath(); g.arc(22, 37, 7, 0, Math.PI * 2); g.fill(); // the hero, or a sun
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  m = new THREE.MeshLambertMaterial({ map: tex });
  labelMats.set(key, m);
  return m;
}

/** The back: a pale warranty sticker on the shell (any face but the edge should read). */
function stickerMat(): THREE.MeshLambertMaterial {
  if (backMat) return backMat;
  const cv = document.createElement('canvas');
  cv.width = 44; cv.height = 54;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#d8d2c0'; g.fillRect(0, 0, 44, 54);
  g.fillStyle = '#8a8478';
  for (let y = 16; y < 44; y += 5) g.fillRect(6, y, 32 - (y % 3) * 4, 2);
  g.fillRect(6, 6, 18, 5);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return backMat = new THREE.MeshLambertMaterial({ map: tex });
}

function cartMesh(shell: string): THREE.Mesh {
  const s = shellMat(shell);
  const label = labelMat(shell, Math.floor(Math.random() * TITLES.length));
  const m = new THREE.Mesh(geo, [s, s, s, s, label, stickerMat()]); // +z = label, -z = sticker
  m.rotation.order = 'YXZ'; // yaw to the flight, then tumble about its own x
  return m;
}

interface Flyer {
  mesh: THREE.Mesh;
  trail: THREE.Mesh;
  stopped: string | null; // which stop the loose motion was seeded from
  vel: THREE.Vector3;
  tumble: number;
  resting: boolean;
}

/**
 * Thrown cartridges (`SimState.carts`). In flight they sit where the sim
 * puts them, spinning flat, dropping from the hand to their line's height;
 * once one stops it's render debris — knocked away off a guard, dropped at
 * the feet of whoever it hit, bounced off the furniture — that clatters
 * down and lies label-up until the round ends. Driven from whichever state
 * is on screen, so the kill replay rewinds them too. Also shows the cart
 * in the thrower's hand during the wind-up.
 */
export class CartView {
  readonly group = new THREE.Group();
  private flyers: Flyer[] = [];
  private held: THREE.Mesh[];
  private hand = new THREE.Vector3();

  constructor(private shells: [string, string], private rules: CartRules, private halfSize = Infinity) {
    this.held = shells.map((s) => cartMesh(s));
    this.group.add(...this.held);
  }

  update(s: SimState, dt: number, views: FighterView[]): void {
    s.fighters.forEach((f, i) => {
      const m = this.held[i];
      m.visible = f.phase === 'throw' && f.phaseFrame < this.rules.windup;
      if (!m.visible) return;
      m.position.copy(views[i].leftHand(this.hand));
      m.rotation.set(0.4, f.facing, 0);
    });

    // a new round, or a replay cut back to before a throw
    while (this.flyers.length > s.carts.length) {
      const fl = this.flyers.pop()!;
      this.group.remove(fl.mesh, fl.trail);
    }

    s.carts.forEach((c, k) => {
      let fl = this.flyers[k];
      if (!fl) {
        const trail = new THREE.Mesh(trailGeo, trailMat);
        fl = { mesh: cartMesh(this.shells[c.owner]), trail, stopped: null, vel: new THREE.Vector3(), tumble: 0, resting: false };
        this.flyers.push(fl);
        this.group.add(fl.mesh, trail);
      }
      const m = fl.mesh;
      fl.trail.visible = !c.end;
      if (!c.end) {
        const line = this.rules.heights[c.line];
        const y = line + (RELEASE_Y - line) * Math.max(0, 1 - c.flown / SETTLE_M);
        const yaw = Math.atan2(c.dx, c.dz);
        m.position.set(c.x, y, c.z);
        m.rotation.set(m.rotation.x + TUMBLE * dt, yaw, 0.25);
        fl.trail.position.copy(m.position);
        fl.trail.rotation.set(0, yaw, 0);
        fl.trail.scale.z = Math.min(1, c.flown / TRAIL); // grows out of the hand
        fl.stopped = null;
        fl.resting = false;
        return;
      }
      const key = `${c.end}@${c.endFrame}`;
      if (fl.stopped !== key) {
        fl.stopped = key;
        fl.resting = false;
        this.loose(fl, c.end, c.dx, c.dz);
      }
      if (!fl.resting) this.fall(fl, dt);
    });
  }

  /** Seed the loose motion from how it stopped. */
  private loose(fl: Flyer, end: string, dx: number, dz: number): void {
    const m = fl.mesh;
    const side = (Math.random() - 0.5) * 2;
    switch (end) {
      case 'guard': case 'parry': {
        // knocked off the weapon: up and away to one side
        const a = Math.atan2(-dx, -dz) + side * 1.1;
        const v = end === 'parry' ? 4 : 3;
        fl.vel.set(Math.sin(a) * v, 2.6, Math.cos(a) * v);
        break;
      }
      case 'hit':
        fl.vel.set(-dx * 1.1 + side * 0.4, 1.2, -dz * 1.1 - side * 0.4);
        break;
      case 'wall': case 'prop':
        // back out of what it hit, then off it
        m.position.x -= dx * 0.15;
        m.position.z -= dz * 0.15;
        fl.vel.set(-dx * 1.8 + side * 0.5, 0.8, -dz * 1.8 - side * 0.5);
        break;
      default: // spent: carries on and drops
        fl.vel.set(dx * 4, 0, dz * 4);
    }
    fl.tumble = (8 + Math.random() * 10) * (side < 0 ? -1 : 1);
  }

  private fall(fl: Flyer, dt: number): void {
    const m = fl.mesh;
    fl.vel.y -= GRAVITY * dt;
    m.position.addScaledVector(fl.vel, dt);
    m.rotation.x += fl.tumble * dt;
    m.rotation.y += fl.tumble * 0.3 * dt;
    const lim = this.halfSize - 0.08;
    for (const ax of ['x', 'z'] as const) {
      if (Math.abs(m.position[ax]) > lim) {
        m.position[ax] = Math.sign(m.position[ax]) * lim;
        fl.vel[ax] *= -0.4;
      }
    }
    if (m.position.y > D / 2) return;
    m.position.y = D / 2;
    if (fl.vel.y < -1.4) {
      // clack: one bounce, losing most of it
      fl.vel.y *= -0.3;
      fl.vel.x *= 0.5;
      fl.vel.z *= 0.5;
      fl.tumble *= 0.4;
      return;
    }
    m.rotation.set(-Math.PI / 2, m.rotation.y, 0); // flat, label up
    fl.resting = true;
  }
}
