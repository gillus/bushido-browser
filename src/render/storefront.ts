import * as THREE from 'three';
import { StageStorefront, StageWalls, WallSide } from '../sim/types';
import { mesh, shade } from './parts';

/**
 * Shop front: a display window and a glass door cut into one room wall,
 * and the night street outside them. Everything here is built in the
 * wall's own frame — x along the wall (left → right seen from inside),
 * +z into the room, -z out to the street — then placed like that wall.
 * The whole group hides with its wall when the camera is behind it.
 */

/** rotation.y of each wall (its plane faces local +z, into the room). */
export function wallAngle(side: WallSide): number {
  return { '-z': 0, '-x': Math.PI / 2, '+z': Math.PI, '+x': -Math.PI / 2 }[side];
}

/**
 * A wall plane spanning x ∈ [-w/2, w/2], y ∈ [0, h] with rectangular
 * holes [x0, x1, y0, y1], as quads around the openings. UV v = y/h, so the
 * wainscot texture lines up with the plain walls.
 */
export function holedWallGeo(w: number, h: number, holes: [number, number, number, number][]): THREE.BufferGeometry {
  const xs = [...new Set([-w / 2, w / 2, ...holes.flatMap(([x0, x1]) => [x0, x1])])].sort((a, b) => a - b);
  const pos: number[] = [], uv: number[] = [];
  const quad = (x0: number, x1: number, y0: number, y1: number): void => {
    for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y0], [x1, y1], [x0, y1]]) {
      pos.push(x, y, 0);
      uv.push(x / w + 0.5, y / h);
    }
  };
  for (let i = 0; i < xs.length - 1; i++) {
    const a = xs[i], b = xs[i + 1], mid = (a + b) / 2;
    const cuts = holes.filter(([x0, x1]) => mid > x0 && mid < x1).sort((p, q) => p[2] - q[2]);
    let y = 0;
    for (const [, , y0, y1] of cuts) {
      if (y0 > y) quad(a, b, y, y0);
      y = Math.max(y, y1);
    }
    if (y < h) quad(a, b, y, h);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** The holes a storefront cuts into its wall. */
export function storefrontHoles(sf: StageStorefront): [number, number, number, number][] {
  return [sf.window, [sf.door[0], sf.door[1], 0, sf.door[2]]];
}

/** Axis-aligned box spanning the given ranges. */
function slab(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, color: string | THREE.Color): THREE.Mesh {
  const m = mesh(new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), color);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return m;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return [cv, cv.getContext('2d')!];
}

function texture(cv: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Cheap deterministic hash in [0, 1) — the set dressing is the same every load. */
function hash(i: number, j: number): number {
  const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * Window glass: a faint blue tint, a few reflection streaks and the shop's
 * vinyl lettering — which reads backwards from inside, as it should.
 */
function glassTexture(sf: StageStorefront, wM: number, hM: number): THREE.CanvasTexture {
  const W = 1024, H = Math.round((W * hM) / wM);
  const [cv, g] = canvas(W, H);
  g.fillStyle = 'rgba(150,190,225,0.1)';
  g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,0.05)';
  for (const [x, w] of [[0.08, 0.05], [0.15, 0.02], [0.52, 0.06], [0.61, 0.025], [0.86, 0.04]]) {
    g.beginPath();
    g.moveTo(x * W, H); g.lineTo((x + w) * W, H);
    g.lineTo((x + w + 0.12) * W, 0); g.lineTo((x + 0.12) * W, 0);
    g.fill();
  }
  if (sf.lettering) {
    g.save();
    g.translate(W, 0);
    g.scale(-1, 1); // vinyl applied for the street; we're on the wrong side
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.font = `900 ${Math.round(H * 0.24)}px Impact, "Arial Black", sans-serif`;
    g.lineWidth = H * 0.03;
    g.strokeStyle = 'rgba(10,10,14,0.85)';
    g.strokeText(sf.lettering, W / 2, H * 0.2);
    g.fillStyle = sf.letteringColor ?? '#e8c84a';
    g.fillText(sf.lettering, W / 2, H * 0.2);
    if (sf.tagline) {
      g.font = `bold ${Math.round(H * 0.075)}px "Courier New", monospace`;
      g.fillText(sf.tagline, W / 2, H * 0.37);
    }
    g.restore();
  }
  return texture(cv);
}

/** Paper card hung inside the door, readable from the shop floor. */
function doorSignMesh(text: string): THREE.Mesh {
  const [cv, g] = canvas(128, 64);
  g.fillStyle = '#ece6da'; g.fillRect(0, 0, 128, 64);
  g.strokeStyle = '#a02828'; g.lineWidth = 4; g.strokeRect(5, 5, 118, 54);
  g.fillStyle = '#a02828';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 26px "Arial Black", sans-serif';
  g.fillText(text, 64, 33);
  return new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.15), new THREE.MeshLambertMaterial({ map: texture(cv) }));
}

function frameAndGlass(sf: StageStorefront, trim: string): THREE.Group {
  const g = new THREE.Group();
  const frame = sf.frame ?? '#5d636e';
  const t = 0.06, z0 = -0.08, z1 = 0.04;

  // display window: frame, mullions, glass, and a ledge of games facing out
  const [wx0, wx1, sill, head] = sf.window;
  g.add(
    slab(wx0, wx0 + t, sill, head, z0, z1, frame),
    slab(wx1 - t, wx1, sill, head, z0, z1, frame),
    slab(wx0, wx1, head - t, head, z0, z1, frame),
    slab(wx0 - 0.04, wx1 + 0.04, sill - 0.05, sill + 0.02, -0.02, 0.22, shade(trim, 1.6)),
  );
  const n = sf.mullions ?? 0;
  for (let k = 1; k <= n; k++) {
    const x = wx0 + ((wx1 - wx0) * k) / (n + 1);
    g.add(slab(x - t * 0.4, x + t * 0.4, sill, head, z0, z1, frame));
  }
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(wx1 - wx0, head - sill),
    new THREE.MeshBasicMaterial({
      map: glassTexture(sf, wx1 - wx0, head - sill), transparent: true, depthWrite: false,
    }),
  );
  glass.position.set((wx0 + wx1) / 2, (sill + head) / 2, -0.03);
  g.add(glass);
  // game boxes on the ledge, backs to the room (fronts are for the street)
  const spines = ['#8f2f2f', '#2f4f8f', '#2f7a4f', '#8f7a2f', '#5a2f8f', '#e8e4da', '#1a1c22'];
  for (let x = wx0 + 0.25, i = 0; x < wx1 - 0.25; i++) {
    if (hash(i, 3) < 0.3) { x += 0.5; continue; } // gaps between clusters
    const big = hash(i, 7) < 0.15;
    const w = big ? 0.42 : 0.14, hgt = big ? 0.3 : 0.19, d = big ? 0.1 : 0.016;
    const box = slab(x, x + w, sill + 0.02, sill + 0.02 + hgt, 0.04, 0.04 + d, spines[Math.floor(hash(i, 5) * spines.length)]);
    box.rotation.y = (hash(i, 9) - 0.5) * 0.3;
    g.add(box);
    x += w + 0.03 + hash(i, 11) * 0.08;
  }

  // the door: jambs, an aluminium leaf with a kick plate, push bar, glass
  const [dx0, dx1, dh] = sf.door;
  g.add(
    slab(dx0, dx0 + t, 0, dh, z0, z1, frame),
    slab(dx1 - t, dx1, 0, dh, z0, z1, frame),
    slab(dx0, dx1, dh - t, dh, z0, z1, frame),
    slab(dx0, dx1, -0.02, 0.0, -0.1, 0.1, shade(frame, 0.8)), // threshold
  );
  const lx0 = dx0 + t, lx1 = dx1 - t, top = dh - t, s = 0.08;
  g.add(
    slab(lx0, lx0 + s, 0, top, -0.05, 0.0, frame),
    slab(lx1 - s, lx1, 0, top, -0.05, 0.0, frame),
    slab(lx0, lx1, top - s, top, -0.05, 0.0, frame),
    slab(lx0, lx1, 0, 0.28, -0.05, 0.0, shade(frame, 1.25)), // kick plate
    slab(lx0 + 0.1, lx1 - 0.1, 0.98, 1.02, 0.04, 0.07, '#9aa0a8'), // push bar
    slab(lx0 + 0.12, lx0 + 0.14, 0.98, 1.02, 0.0, 0.05, '#9aa0a8'),
    slab(lx1 - 0.14, lx1 - 0.12, 0.98, 1.02, 0.0, 0.05, '#9aa0a8'),
  );
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(lx1 - lx0 - 2 * s, top - s - 0.28),
    new THREE.MeshBasicMaterial({ color: '#96bee1', transparent: true, opacity: 0.1, depthWrite: false }),
  );
  pane.position.set((lx0 + lx1) / 2, (0.28 + top - s) / 2, -0.025);
  g.add(pane);
  if (sf.doorSign) {
    const sign = doorSignMesh(sf.doorSign);
    sign.position.set((lx0 + lx1) / 2, 1.55, 0.008);
    const cx = (lx0 + lx1) / 2;
    for (const side of [-1, 1]) {
      const cord = slab(-0.003, 0.003, 0, 0.2, 0, 0.003, '#d8d2c0');
      cord.position.set(cx + side * 0.07, 1.72, 0.008);
      cord.rotation.z = side * 0.6;
      g.add(cord);
    }
    g.add(sign);
  }
  return g;
}

// ---------- outside ----------

function pavingTexture(base: string, repeatX: number, repeatY: number): THREE.CanvasTexture {
  const [cv, g] = canvas(32, 32);
  g.fillStyle = base; g.fillRect(0, 0, 32, 32);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 0, 32, 1); g.fillRect(0, 0, 1, 32);
  const t = texture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.magFilter = THREE.NearestFilter;
  return t;
}

/** Flat ground strip from z0 to z1 (z0 > z1) at height y. */
function ground(len: number, z0: number, z1: number, y: number, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, z0 - z1), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.set(0, y, (z0 + z1) / 2);
  return m;
}

let glowTex: THREE.CanvasTexture | null = null;
/** Additive sodium-orange light pool on the pavement. */
function lightPool(rx: number, rz: number, x: number, y: number, z: number): THREE.Mesh {
  if (!glowTex) {
    const [cv, g] = canvas(64, 64);
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,170,80,0.55)');
    grad.addColorStop(0.6, 'rgba(255,150,60,0.18)');
    grad.addColorStop(1, 'rgba(255,140,50,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    glowTex = texture(cv);
  }
  const geo = new THREE.CircleGeometry(1, 20);
  geo.rotateX(-Math.PI / 2);
  geo.scale(rx, 1, rz);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  m.position.set(x, y, z);
  return m;
}

/** Sodium streetlamp on the kerb, arm reaching out over the road. */
function streetlamp(x: number, z: number, out: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  const pole = mesh(new THREE.CylinderGeometry(0.05, 0.07, 5, 6), '#2a2d33');
  pole.position.y = 2.5;
  const arm = slab(-0.03, 0.03, 4.9, 4.96, 0, out * 1.3, '#2a2d33');
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.1, 0.5),
    new THREE.MeshBasicMaterial({ color: '#ffb457', fog: false }),
  );
  head.position.set(0, 4.86, out * 1.25);
  g.add(pole, arm, head);
  return g;
}

/** Hatchback parked at the kerb, nose toward +x. */
function car(color: string): THREE.Group {
  const g = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(3.8, 0.55, 1.7), color);
  body.position.y = 0.47;
  const cabinGeo = new THREE.BoxGeometry(2.2, 0.52, 1.5);
  const p = cabinGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.78 - 0.12); p.setZ(i, p.getZ(i) * 0.86); }
  }
  cabinGeo.computeVertexNormals();
  const cabin = mesh(cabinGeo, '#15181e');
  cabin.position.set(-0.3, 1.0, 0);
  const roof = mesh(new THREE.BoxGeometry(1.7, 0.05, 1.3), color);
  roof.position.set(-0.42, 1.28, 0);
  g.add(body, cabin, roof);
  for (const [x, z] of [[1.2, 0.78], [1.2, -0.78], [-1.25, 0.78], [-1.25, -0.78]]) {
    const wheel = mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.22, 10), '#0e0f12');
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.31, z);
    g.add(wheel);
  }
  for (const z of [-0.6, 0.6]) {
    const lamp = slab(1.88, 1.92, 0.55, 0.65, z - 0.15, z + 0.15, '#cfcab8');
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.26), new THREE.MeshBasicMaterial({ color: '#4a0c0c' }));
    tail.position.set(-1.91, 0.62, z);
    g.add(lamp, tail);
  }
  return g;
}

type GroundFloor = 'shutter' | 'market' | 'dark';

/** Apartment block facade: windows on a grid, a few lit; a shop at street level. */
function facadeTextures(wM: number, hM: number, wall: string, floor: GroundFloor, seed: number): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const ppm = 16, W = Math.round(wM * ppm), H = Math.round(hM * ppm);
  const [cv, g] = canvas(W, H);
  const [ce, e] = canvas(W, H);
  g.fillStyle = wall; g.fillRect(0, 0, W, H);
  e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const lit = (x: number, y: number, w: number, h: number, color: string): void => {
    g.fillStyle = color; g.fillRect(x, y, w, h);
    e.fillStyle = color; e.fillRect(x, y, w, h);
  };
  // upper floors: 3 m storeys above a 3.6 m ground floor
  const cols = Math.max(1, Math.floor(wM / 2.2));
  for (let row = 0; 3.6 + row * 3 + 2.2 < hM; row++) {
    for (let c = 0; c < cols; c++) {
      const x = ((c + 0.5) * wM) / cols - 0.6, y = hM - (3.6 + row * 3 + 0.8) - 1.4;
      const r = hash(seed + c, row);
      if (r < 0.22) lit(x * ppm, y * ppm, 1.2 * ppm, 1.4 * ppm, r < 0.08 ? '#9fc4e8' : '#e8c27a');
      else { g.fillStyle = '#121419'; g.fillRect(x * ppm, y * ppm, 1.2 * ppm, 1.4 * ppm); }
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(x * ppm - 2, (y + 1.4) * ppm, 1.2 * ppm + 4, 2); // sill
    }
  }
  // ground floor
  const gy = (hM - 3.2) * ppm, gh = 2.6 * ppm;
  if (floor === 'market') {
    lit(0.6 * ppm, gy + 0.4 * ppm, (wM - 1.2) * ppm, gh - 0.4 * ppm, '#b4c8d4');
    g.fillStyle = e.fillStyle = 'rgba(40,60,70,0.55)';
    for (let x = 1.8; x < wM - 1; x += 1.2) {
      g.fillRect(x * ppm, gy + 1.2 * ppm, 0.7 * ppm, gh - 1.2 * ppm); // shelves seen through glass
      e.fillRect(x * ppm, gy + 1.2 * ppm, 0.7 * ppm, gh - 1.2 * ppm);
    }
    lit(0.6 * ppm, gy - 0.5 * ppm, (wM - 1.2) * ppm, 0.6 * ppm, '#3fa06a');
    for (const ctx of [g, e]) {
      ctx.fillStyle = '#eef6ee';
      ctx.font = `bold ${Math.round(0.42 * ppm)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('MARKET  24H', (wM / 2) * ppm, gy - 0.2 * ppm);
    }
  } else if (floor === 'shutter') {
    g.fillStyle = '#4a4d52'; g.fillRect(0.5 * ppm, gy, (wM - 1) * ppm, gh + 0.6 * ppm);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (let y = gy; y < gy + gh + 0.6 * ppm; y += 3) g.fillRect(0.5 * ppm, y, (wM - 1) * ppm, 1);
  } else {
    g.fillStyle = '#121419';
    g.fillRect(1 * ppm, gy + 0.6 * ppm, 1.1 * ppm, gh); // a door
    g.fillRect(2.8 * ppm, gy + 0.9 * ppm, (wM - 3.8) * ppm, 1.4 * ppm);
  }
  const map = texture(cv), emissive = texture(ce);
  map.magFilter = emissive.magFilter = THREE.NearestFilter;
  return [map, emissive];
}

/** The street outside, wall-local (-z = away from the shop). */
function street(len: number): THREE.Group {
  const g = new THREE.Group();
  const kerb = '#55565c';
  // near pavement, kerb, road, far kerb + pavement
  g.add(ground(len, 0, -3, -0.03, new THREE.MeshLambertMaterial({ map: pavingTexture('#35363c', len / 0.6, 3 / 0.6) })));
  g.add(slab(-len / 2, len / 2, -0.2, -0.03, -3.16, -3.0, kerb));
  g.add(ground(len, -3.16, -10.56, -0.2, new THREE.MeshLambertMaterial({ color: '#17181c' })));
  for (let x = -len / 2 + 1; x < len / 2; x += 3.6) {
    g.add(slab(x, x + 1.8, -0.2, -0.195, -6.92, -6.8, '#8a897e'));
  }
  g.add(slab(-len / 2, len / 2, -0.2, -0.03, -10.72, -10.56, kerb));
  g.add(ground(len, -10.72, -13.3, -0.03, new THREE.MeshLambertMaterial({ map: pavingTexture('#2f3036', len / 0.6, 2.6 / 0.6) })));

  // across the street: a row of blocks, the corner market still open
  const blocks: [number, number, number, string, GroundFloor][] = [
    [-17, -8, 10, '#3b3430', 'shutter'],
    [-8, 1.5, 13, '#2f3338', 'market'],
    [1.5, 9, 9, '#3a2f2f', 'shutter'],
    [9, 17, 11, '#30343a', 'dark'],
  ];
  blocks.forEach(([x0, x1, h, wall, floor], i) => {
    const [map, emissiveMap] = facadeTextures(x1 - x0, h, wall, floor, i * 17);
    // unfogged: the room's fog would erase the far side of the street, and
    // lit windows at night carry anyway (the facade colours are pre-darkened)
    const front = new THREE.MeshLambertMaterial({ map, emissiveMap, emissive: '#ffffff', fog: false });
    const side = new THREE.MeshLambertMaterial({ color: shade(wall, 0.5), fog: false });
    // BoxGeometry material order: +x, -x, +y, -y, +z (faces the shop), -z
    const b = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, h, 2), [side, side, side, side, front, side]);
    b.position.set((x0 + x1) / 2, h / 2 - 0.03, -14.3);
    g.add(b);
  });

  g.add(streetlamp(-4, -2.8, -1), streetlamp(7, -2.8, -1), streetlamp(2, -10.9, 1));
  g.add(
    lightPool(2.4, 1.3, -4, -0.02, -1.7), lightPool(2.4, 1.6, -4, -0.19, -4.6),
    lightPool(2.4, 1.3, 7, -0.02, -1.7), lightPool(2.4, 1.6, 7, -0.19, -4.6),
    lightPool(2.4, 1.2, 2, -0.02, -12), lightPool(2.4, 1.6, 2, -0.19, -9.2),
  );
  const parked = car('#4a5f7a');
  parked.position.set(-1.6, -0.2, -4.15);
  g.add(parked);
  return g;
}

/** Window, door, glass, display ledge and the street, placed at their wall. */
export function buildStorefront(sf: StageStorefront, walls: StageWalls): THREE.Group {
  const g = new THREE.Group();
  const a = wallAngle(sf.wall);
  g.rotation.y = a;
  g.position.set(-Math.sin(a) * walls.halfSize, -0.02, -Math.cos(a) * walls.halfSize);
  g.add(frameAndGlass(sf, walls.trim ?? walls.color));
  g.add(street(walls.halfSize * 2 + 20));
  return g;
}
