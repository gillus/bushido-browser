import * as THREE from 'three';
import { StageProp } from '../sim/types';

/**
 * Shop furniture built inside a prop's box (`fixture` in stage.json): the
 * footprint, height and collider stay the plain prop's, this only dresses
 * it. Local frame: x across, y up from the floor, front = +z (rot 0 faces
 * +z, like the clerk), so a shelf on the +z wall has rot 180. Set dressing
 * is seeded from the prop's position: the same games every load.
 */
export interface Fixture {
  object: THREE.Object3D;
  update?: (dt: number) => void;
}

export function buildFixture(p: StageProp): Fixture | null {
  const seed = Math.round(p.pos[0] * 1009 + p.pos[2] * 2003 + p.pos[1] * 17) | 0;
  let f: Fixture;
  if (p.fixture === 'shelf') f = { object: shelf(p, rng(seed)) };
  else if (p.fixture === 'kiosk') f = kiosk(p);
  else return null;
  f.object.position.set(p.pos[0], p.pos[1], p.pos[2]);
  f.object.rotation.y = ((p.rot ?? 0) * Math.PI) / 180;
  return f;
}

/** mulberry32: deterministic set dressing (render-only, not the sim's RNG). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Each face: normal n and in-plane axes u, v with u × v = n (CCW from outside).
const FACES: [number[], number[], number[]][] = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];
const BACK_FACE = 4;

/**
 * Many flat-shaded, vertex-coloured boxes merged into one mesh — a whole
 * shelf of games is a single draw call. Bottoms are never emitted (every
 * box stands on something); `back: false` drops the -z face too.
 */
class BoxBatch {
  private pos: number[] = [];
  private nrm: number[] = [];
  private col: number[] = [];
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private v = new THREE.Vector3();
  private n = new THREE.Vector3();

  box(
    x: number, y: number, z: number, w: number, h: number, d: number, color: THREE.Color,
    rx = 0, rz = 0, back = true,
  ): void {
    this.q.setFromEuler(this.e.set(rx, 0, rz));
    const half = [w / 2, h / 2, d / 2];
    for (let f = 0; f < FACES.length; f++) {
      if (!back && f === BACK_FACE) continue;
      const [n, u, v] = FACES[f];
      this.n.set(n[0], n[1], n[2]).applyQuaternion(this.q);
      const corner = (su: number, sv: number): void => {
        this.v.set(
          (n[0] + su * u[0] + sv * v[0]) * half[0],
          (n[1] + su * u[1] + sv * v[1]) * half[1],
          (n[2] + su * u[2] + sv * v[2]) * half[2],
        ).applyQuaternion(this.q);
        this.pos.push(x + this.v.x, y + this.v.y, z + this.v.z);
        this.nrm.push(this.n.x, this.n.y, this.n.z);
        this.col.push(color.r, color.g, color.b);
      };
      corner(-1, -1); corner(1, -1); corner(1, 1);
      corner(-1, -1); corner(1, 1); corner(-1, 1);
    }
  }

  mesh(): THREE.Mesh {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  }
}

const c = (hex: string, k = 1): THREE.Color => new THREE.Color(hex).multiplyScalar(k);

/** Muted cover-art colours: what a shelf of games reads as from 5 m away. */
const ART = [
  '#b8312f', '#d9822b', '#e8c84a', '#3f8f4f', '#2f6fa8', '#6f3f8f', '#c4c0b4',
  '#8f2f5a', '#2f8f8f', '#e0dccf', '#5a6a2f', '#a04a3f', '#4a5fa0',
].map((h) => c(h));
/** Keep-case colours, one platform per row. */
const CASES = ['#18191d', '#2c7a36', '#24499a', '#dcdcd8', '#b3232b'].map((h) => c(h));
const JEWEL = c('#141416');
const PAPER = c('#d8d4c8');
const TAG = [c('#c8302a'), c('#e8c84a')];

/** Lit header sign: a coloured board with the category in block capitals. */
function signMesh(text: string, bg: string, w: number, h: number): THREE.Mesh {
  const W = 512, H = Math.max(32, Math.round((W * h) / w));
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = Math.max(2, H * 0.06);
  g.strokeRect(H * 0.1, H * 0.1, W - H * 0.2, H * 0.8);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = Math.round(H * 0.62);
  g.font = `900 ${size}px Impact, "Arial Black", sans-serif`;
  const fit = (W - H * 0.6) / g.measureText(text).width;
  if (fit < 1) {
    size = Math.floor(size * fit);
    g.font = `900 ${size}px Impact, "Arial Black", sans-serif`;
  }
  g.fillStyle = '#f4f1e8';
  g.fillText(text, W / 2, H * 0.54);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: tex, color: '#c8c8c8' }), // self-lit, not blown out
  );
}

/**
 * Wall shelving: carcass, boards with price strips, and stock —
 * `games` (rows of jewel and keep cases, spines out, the odd face-out and a
 * leaner at the end of a row), `bigbox` (PC big boxes) or `pegs`
 * (pegboard of blister packs over a board of console boxes).
 */
function shelf(p: StageProp, rand: () => number): THREE.Group {
  const [w, h, d] = p.size;
  const group = new THREE.Group();
  const b = new BoxBatch();
  const body = c(p.color), inner = c(p.color, 0.6);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  const front = d / 2, xIn = w / 2 - 0.035;

  b.box(-w / 2 + 0.015, h / 2, 0, 0.03, h, d, body);
  b.box(w / 2 - 0.015, h / 2, 0, 0.03, h, d, body);
  b.box(0, h - 0.015, 0, w, 0.03, d, body);
  b.box(0, 0.05, 0.01, w - 0.06, 0.1, d - 0.04, c(p.color, 0.45));

  const stock = p.stock ?? 'games';
  const pegRows = stock === 'pegs' ? Math.max(1, Math.round((h - 0.13) / 0.34) - 2) : 0;
  const rows = Math.max(1, Math.round((h - 0.13) / 0.34));
  const pitch = (h - 0.13) / rows;
  const boards = rows - pegRows;
  const backZ = -d / 2 + 0.01;
  if (pegRows) {
    // masonite pegboard above the boards, the back panel below
    const y0 = 0.1 + boards * pitch;
    b.box(0, (y0 + h) / 2, backZ, w - 0.06, h - y0, 0.02, c('#a8916a'));
    b.box(0, y0 / 2, backZ, w - 0.06, y0, 0.02, inner);
  } else {
    b.box(0, h / 2, backZ, w - 0.06, h, 0.02, inner);
  }

  for (let r = 0; r < boards; r++) {
    const yb = 0.1 + r * pitch;
    b.box(0, yb, 0.0, w - 0.06, 0.022, d - 0.03, body);
    // price strip along the front edge with tags
    b.box(0, yb - 0.004, front - 0.012, w - 0.06, 0.036, 0.008, PAPER, 0, 0, false);
    for (let x = -xIn + 0.12; x < xIn; x += 0.22 + rand() * 0.18) {
      b.box(x, yb - 0.004, front - 0.006, 0.035, 0.026, 0.006, pick(TAG), 0, 0, false);
    }
    const floor = yb + 0.011, room = pitch - 0.035;
    if (stock === 'pegs') consoleRow(b, rand, floor, xIn, front);
    else gameRow(b, rand, floor, room, xIn, front, stock === 'bigbox');
  }
  for (let r = 0; r < pegRows; r++) {
    const yTop = 0.1 + (boards + r + 1) * pitch - 0.03;
    blisterRow(b, rand, yTop, xIn, backZ + 0.01, pitch);
  }
  const m = b.mesh();
  group.add(m);

  if (p.label) {
    const sh = 0.22;
    const board = new BoxBatch();
    board.box(0, h + sh / 2, front - 0.04, w, sh, 0.05, c(p.color, 0.8));
    group.add(board.mesh());
    const sign = signMesh(p.label, p.accent ?? '#7a2f2f', w - 0.04, sh - 0.04);
    sign.position.set(0, h + sh / 2, front - 0.014);
    group.add(sign);
  }
  return group;
}

/** One board of games, spines out, packed left to right. */
function gameRow(
  b: BoxBatch, rand: () => number, floor: number, room: number, xIn: number, front: number, bigbox: boolean,
): void {
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)];
  // a row is one format: jewel cases, keep cases of one platform, or big boxes
  const jewel = !bigbox && rand() < 0.4;
  const base = bigbox ? null : jewel ? JEWEL : pick(CASES);
  const ch = Math.min(room, bigbox ? 0.24 + rand() * 0.05 : jewel ? 0.142 : 0.19);
  const cd = bigbox ? 0.19 : jewel ? 0.125 : 0.135;
  const faceOut = bigbox ? 0.18 : 0.05;
  let x = -xIn;
  const end = xIn - (rand() < 0.5 ? 0.12 + rand() * 0.25 : 0); // some rows run short
  while (true) {
    if (rand() < 0.03) x += 0.05 + rand() * 0.12; // sold out
    const art = pick(ART);
    if (rand() < faceOut) {
      // cover facing the aisle, leaning back on the stock behind it
      const cw = bigbox ? 0.19 : cd, t = bigbox ? 0.06 : 0.015;
      if (x + cw > end) break;
      const z = front - 0.05 - t / 2;
      b.box(x + cw / 2, floor + ch / 2, z, cw, ch, t, base ?? art, -0.08);
      b.box(x + cw / 2, floor + ch * 0.47, z + t / 2 + 0.002, cw * 0.86, ch * 0.7, 0.002, art, -0.08, 0, false);
      x += cw + 0.004;
      continue;
    }
    const t = bigbox ? 0.05 + rand() * 0.03 : jewel ? 0.024 : 0.015;
    if (x + t > end) break;
    const hh = bigbox ? ch - rand() * 0.04 : ch;
    const z = front - 0.03 - cd / 2;
    b.box(x + t / 2, floor + hh / 2, z, t - 0.001, hh, cd, base ?? art, 0, 0, false);
    // spine art band (+ a white platform strip on jewel cases)
    b.box(x + t / 2, floor + hh * 0.48, z + cd / 2 + 0.001, t * 0.8, hh * 0.6, 0.002, art, 0, 0, false);
    if (jewel) b.box(x + t / 2, floor + hh * 0.9, z + cd / 2 + 0.001, t * 0.8, hh * 0.1, 0.002, PAPER, 0, 0, false);
    x += t;
  }
  // last one in a short row has fallen against its neighbour
  if (end < xIn - 0.1 && !bigbox) {
    const t = jewel ? 0.024 : 0.015, lean = 0.35; // top tips over to -x
    const cx = x + (Math.sin(lean) * ch + Math.cos(lean) * t) / 2 + 0.005;
    const cy = floor + (Math.cos(lean) * ch + Math.sin(lean) * t) / 2;
    b.box(cx, cy, front - 0.03 - cd / 2, t, ch, cd, base ?? pick(ART), 0, lean);
  }
}

/** Console boxes on the bottom boards of a peg unit. */
function consoleRow(b: BoxBatch, rand: () => number, floor: number, xIn: number, front: number): void {
  let x = -xIn + 0.02;
  while (true) {
    const bw = 0.32 + rand() * 0.12, bh = 0.2 + rand() * 0.08, bd = 0.26;
    if (x + bw > xIn) break;
    const shell = rand() < 0.5 ? c('#1c1d22') : c('#dcdad2');
    const z = front - 0.03 - bd / 2;
    b.box(x + bw / 2, floor + bh / 2, z, bw, bh, bd, shell, 0, 0, false);
    // product shot + a stripe of brand colour
    b.box(x + bw * 0.45, floor + bh * 0.5, z + bd / 2 + 0.001, bw * 0.6, bh * 0.6, 0.002, ART[Math.floor(rand() * ART.length)], 0, 0, false);
    b.box(x + bw / 2, floor + bh * 0.9, z + bd / 2 + 0.001, bw * 0.92, bh * 0.08, 0.002, c('#2f6fa8'), 0, 0, false);
    x += bw + 0.02 + rand() * 0.04;
  }
}

/** Hooks of blister packs: pads, memory cards, cables. */
function blisterRow(b: BoxBatch, rand: () => number, yTop: number, xIn: number, z0: number, pitch: number): void {
  const card = c('#e8e4da');
  const n = Math.max(2, Math.floor((2 * xIn) / 0.2));
  const step = (2 * xIn) / n;
  for (let i = 0; i < n; i++) {
    if (rand() < 0.12) continue; // empty hook
    const x = -xIn + step * (i + 0.5);
    const ch = Math.min(pitch - 0.05, 0.2 + rand() * 0.05), cw = step * 0.78;
    b.box(x, yTop, z0 + 0.06, 0.006, 0.006, 0.12, c('#9aa0a8')); // the hook
    // two or three packs deep on the hook
    const deep = 2 + Math.floor(rand() * 2);
    const item = rand() < 0.5 ? c('#2a2b30') : c('#8a8d94');
    const art = ART[Math.floor(rand() * ART.length)];
    for (let k = 0; k < deep; k++) {
      const z = z0 + 0.03 + k * 0.035;
      b.box(x, yTop - 0.02 - ch / 2, z, cw, ch, 0.008, k === deep - 1 ? art : card);
      b.box(x, yTop - 0.03 - ch * 0.55, z + 0.016, cw * 0.62, ch * 0.5, 0.024, item);
    }
  }
}

/**
 * Console demo kiosk: plinth, cabinet with side fins, a tethered pad on a
 * sloped ledge, a CRT running an attract-mode loop, and a lit topper.
 */
function kiosk(p: StageProp): Fixture {
  const [w, h, d] = p.size;
  const group = new THREE.Group();
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
  const screen = new DemoScreen();
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(sw * 0.86, sh * 0.84), new THREE.MeshBasicMaterial({ map: screen.tex }));
  glass.position.set(0, sy, crtFront + 0.001);
  group.add(glass);

  // topper sign, out in front of the fins
  const ty = h - 0.16, tz = crtFront - 0.05;
  b.box(0, ty, tz, w, 0.3, 0.1, body);
  group.add(b.mesh());
  const sign = signMesh(p.label ?? 'PLAY IT NOW', p.accent ?? '#2f6fa8', w - 0.05, 0.25);
  sign.position.set(0, ty, tz + 0.051);
  group.add(sign);

  return { object: group, update: (dt) => screen.update(dt) };
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
    if (this.acc < 1 / 12) return;
    this.acc = 0;
    this.draw();
    this.tex.needsUpdate = true;
  }

  private draw(): void {
    const g = this.g, t = this.t % (DEMO_SECS + TITLE_SECS);
    if (t > DEMO_SECS) this.title(g, t - DEMO_SECS);
    else this.race(g, t);
    // scanlines
    g.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < SCR_H; y += 2) g.fillRect(0, y, SCR_W, 1);
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
