import * as THREE from 'three';
import { StageProp } from '../sim/types';

/**
 * Shop furniture built inside a prop's box (`fixture` in stage.json): the
 * footprint, height and collider stay the plain prop's, this only dresses
 * it. Local frame: x across, y up from the floor, front = +z (rot 0 faces
 * +z, like the clerk), so a shelf on the +z wall has rot 180. Set dressing
 * is seeded from the prop's position: the same games every load.
 */
export function buildShelf(p: StageProp): THREE.Object3D {
  const seed = Math.round(p.pos[0] * 1009 + p.pos[2] * 2003 + p.pos[1] * 17) | 0;
  const object = shelf(p, rng(seed));
  object.position.set(p.pos[0], p.pos[1], p.pos[2]);
  object.rotation.y = ((p.rot ?? 0) * Math.PI) / 180;
  return object;
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
export class BoxBatch {
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

export const c = (hex: string, k = 1): THREE.Color => new THREE.Color(hex).multiplyScalar(k);

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
export function signMesh(text: string, bg: string, w: number, h: number): THREE.Mesh {
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
