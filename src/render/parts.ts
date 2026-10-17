import * as THREE from 'three';
import { CharacterShape } from '../sim/types';

/**
 * Low-poly body parts. Everything here is flat-shaded and deliberately
 * faceted (8–12 radial segments) — smoother than boxes, still PS1.
 * All limb geometry hangs along -Y from its pivot, like the old boxes did,
 * so poses.ts targets are unchanged.
 */

export const FLAT = true;

export function mat(color: string | THREE.Color, emissive?: string): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color, flatShading: FLAT });
  if (emissive) m.emissive = new THREE.Color(emissive);
  return m;
}

export function mesh(geo: THREE.BufferGeometry, color: string | THREE.Color, emissive?: string): THREE.Mesh {
  return new THREE.Mesh(geo, mat(color, emissive));
}

/** Tapered limb segment from y=0 down to y=-len. rTop/rBot = radii. */
export function limbGeo(rTop: number, rBot: number, len: number, radial = 8): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, radial, 1, false);
  g.translate(0, -len / 2, 0);
  return g;
}

/**
 * Bare limb with a muscle belly (calf, forearm) instead of a straight taper:
 * widest `bulgeAt` of the way down, slightly flattened front-to-back.
 */
export function muscleGeo(rTop: number, rBulge: number, rBot: number, len: number, bulgeAt = 0.3, radial = 8): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(rTop, 0),
    new THREE.Vector2(rBulge, -len * bulgeAt),
    new THREE.Vector2((rBulge + rBot) / 2, -len * (0.5 + bulgeAt / 2)),
    new THREE.Vector2(rBot, -len),
    new THREE.Vector2(0.001, -len),
  ];
  const g = new THREE.LatheGeometry(pts, radial);
  g.scale(1, 1, 0.88);
  return g;
}

/**
 * One leg of a pair of shorts: full at the seat, tapering to the hem, and
 * the hem is an opening (the end dishes up inside) rather than a flat lid.
 */
export function shortsLegGeo(rTop: number, rBot: number, len: number, radial = 10): THREE.BufferGeometry {
  const pts = [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(rTop, 0),
    new THREE.Vector2(rTop * 1.03, -len * 0.25),
    new THREE.Vector2(rBot, -len),
    new THREE.Vector2(rBot * 0.8, -len + 0.012),
    new THREE.Vector2(0.001, -len + 0.06),
  ];
  const g = new THREE.LatheGeometry(pts, radial);
  g.scale(1, 1, 0.88);
  return g;
}

/** Joint ball (elbow / knee / shoulder) — hides the gap when a limb bends. */
export function ballGeo(r: number): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, 8, 6);
}

/** Ellipsoid (hands, shoes, noses, hair blobs). */
export function blobGeo(rx: number, ry: number, rz: number, w = 8, h = 6): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  return g;
}

export interface TorsoDims {
  h: number;        // heightScale
  b: number;        // bulk
  belly: number;    // 1 = neutral, >1 paunch, <1 flat
  chest: number;    // 1 = neutral, >1 barrel
  shoulders: number;// width multiplier at the top
  height: number;   // torso height (waist → shoulder line)
}

/**
 * Torso as a lathe: profile from the waist up to the neck, with a belly
 * bulge and shoulder shelf. Squashed on Z so the cross-section is an
 * ellipse, not a can. Pivots at the waist (y=0), rises to y=height.
 */
export function torsoGeo(d: TorsoDims): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(torsoProfile(d), 12);
  g.scale(1, 1, torsoDepth(d));
  return g;
}

/** Z squash of the torso's elliptical cross-section. */
export function torsoDepth(d: TorsoDims): number {
  return 0.66 + 0.14 * (d.belly - 1);
}

/** Torso half-width at height y (waist = 0), from the lathe profile. */
export function torsoRadius(d: TorsoDims, y: number): number {
  const pts = torsoProfile(d);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (y <= b.y && b.y > a.y) return a.x + (b.x - a.x) * ((y - a.y) / (b.y - a.y));
  }
  return pts[pts.length - 2].x;
}

function torsoProfile(d: TorsoDims): THREE.Vector2[] {
  const w = 0.19 * d.b; // half-width reference (old box was 0.38*b wide)
  const H = d.height;
  return [
    new THREE.Vector2(0.001, 0),
    new THREE.Vector2(w * 0.92, 0),
    new THREE.Vector2(w * (0.95 + 0.18 * (d.belly - 1)), H * 0.12),
    new THREE.Vector2(w * (1.0 + 0.32 * (d.belly - 1)), H * 0.32),
    new THREE.Vector2(w * (0.96 + 0.14 * (d.belly - 1) + 0.1 * (d.chest - 1)), H * 0.52),
    new THREE.Vector2(w * (1.02 + 0.25 * (d.chest - 1)), H * 0.72),
    new THREE.Vector2(w * (1.12 * d.shoulders), H * 0.9),
    new THREE.Vector2(w * (1.05 * d.shoulders), H * 0.98),
    new THREE.Vector2(w * 0.45, H),
    new THREE.Vector2(0.001, H),
  ];
}

/** Pelvis: a squat lathe bowl sitting under the torso pivot. */
export function pelvisGeo(b: number, h: number): THREE.BufferGeometry {
  const w = 0.17 * b, H = 0.2 * h;
  const pts = [
    new THREE.Vector2(0.001, -H * 0.5),
    new THREE.Vector2(w * 0.75, -H * 0.5),
    new THREE.Vector2(w * 1.0, -H * 0.1),
    new THREE.Vector2(w * 0.98, H * 0.5),
    new THREE.Vector2(0.001, H * 0.5),
  ];
  const g = new THREE.LatheGeometry(pts, 10);
  g.scale(1, 1, 0.68);
  return g;
}

export type HeadShape = NonNullable<CharacterShape['head']>;

// Face layout (head-centre space, before the per-shape Y scale): eyes and
// specs on the midline, brows just over the rims, hachimaki above those.
const EYE_Y = 0.004;
const BAND_Y = 0.074;

/** Per-shape head scale, shared by the skull, hair, face and headband. */
export function headScale(shape: HeadShape): { sx: number; sy: number; sz: number } {
  switch (shape) {
    case 'long':  return { sx: 0.88, sy: 1.22, sz: 0.92 };
    case 'wide':  return { sx: 1.15, sy: 0.95, sz: 1.02 };
    case 'block': return { sx: 1.0, sy: 1.08 * 0.78, sz: 0.95 };
    default:      return { sx: 1, sy: 1, sz: 1 };
  }
}

/** Z of the flattened face plane, in head-centre space. */
export function faceZ(shape: HeadShape, r: number): number {
  return 0.86 * r * headScale(shape).sz;
}

/** Head shapes: a faceted sphere scaled per silhouette. Centered at its own middle. */
export function headGeo(shape: HeadShape, r = 0.115): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, 10, 7);
  // Flat face plane, a jaw that narrows into a squared chin, and a chin
  // pushed forward of the face: Bushido Blade's angular PS1 heads.
  const vertices = g.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    const y = vertices.getY(i), z = vertices.getZ(i);
    if (y < -r * 0.25) {
      const t = Math.min(1, (-y - r * 0.25) / (r * 0.6));
      vertices.setX(i, vertices.getX(i) * (0.88 - 0.16 * t));
      if (z > r * 0.2) vertices.setZ(i, z + r * 0.12 * t);
    }
    if (vertices.getZ(i) > r * 0.72) vertices.setZ(i, r * 0.86);
  }
  g.computeVertexNormals();
  const { sx, sy, sz } = headScale(shape);
  if (shape === 'block') {
    g.scale(1.0, 1.08, 0.95);
    flattenY(g, r * sy); // flatten the top/bottom a touch to read as a jaw
  } else {
    g.scale(sx, sy, sz);
  }
  return g;
}

function flattenY(g: THREE.BufferGeometry, cap: number): void {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > cap) p.setY(i, cap);
    if (y < -cap) p.setY(i, -cap);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
}

/**
 * Hair shell: the head sphere inflated a little, with every vertex below
 * the hairline sunk inside the skull. The hairline runs from `front`
 * (unit height at the forehead) down to `back` (the nape), so the face
 * stays clear and the back of the head is covered. Jagged on purpose.
 */
function capGeo(r: number, shape: HeadShape, inflate: number, front: number, back: number): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 12, 8);
  const p = g.attributes.position as THREE.BufferAttribute;
  const { sx, sy, sz } = headScale(shape);
  for (let i = 0; i < p.count; i++) {
    const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i);
    const t = THREE.MathUtils.smoothstep(uz, -0.2, 0.6);
    const sink = uy < back + (front - back) * t ? 0.85 / inflate : 1;
    p.setXYZ(i, ux * r * sx * inflate * sink, uy * r * sy * inflate * sink, uz * r * sz * inflate * sink);
  }
  g.computeVertexNormals();
  return g;
}

/** Build a hair group for a head of radius ~r. Hair sits in head-local space. */
export function hairGroup(style: NonNullable<CharacterShape['hair']>, color: string, r: number, shape: HeadShape, tail = false): THREE.Group {
  const g = new THREE.Group();
  const { sx, sy, sz } = headScale(shape);
  const top = r * sy;
  switch (style) {
    case 'bald': break;
    case 'topknot': {
      g.add(mesh(capGeo(r, shape, 1.05, 0.66, -0.25), color));
      const knot = mesh(blobGeo(0.034, 0.048, 0.034, 6, 5), color);
      knot.position.set(0, top + 0.035, -0.035);
      const tie = mesh(limbGeo(0.022, 0.022, 0.016, 6), '#c9a24a');
      tie.position.set(0, top + 0.004, -0.03);
      g.add(knot, tie);
      break;
    }
    case 'bowl': {
      g.add(mesh(capGeo(r, shape, 1.12, 0.5, -0.1), color));
      break;
    }
    case 'messy': {
      g.add(mesh(capGeo(r, shape, 1.08, 0.6, -0.4), color));
      // deterministic tufts sticking out of the crown, plus a front cowlick
      const tufts: [number, number, number, number][] = [
        [0.35, 0.9, 0.1, 1], [-0.4, 0.85, -0.1, 1.1], [0.05, 0.85, -0.5, 1.2],
        [0.6, 0.6, -0.45, 0.9], [-0.6, 0.55, -0.5, 1], [0.0, 0.95, 0.25, 0.9],
        [-0.25, 0.65, 0.65, 0.8], [0.3, 0.6, 0.65, 0.75],
      ];
      for (const [x, y, z, s] of tufts) {
        const dir = new THREE.Vector3(x * sx, y * sy, z * sz).normalize();
        const cone = new THREE.ConeGeometry(0.024 * s, 0.065 * s, 4);
        cone.translate(0, 0.02 * s, 0);
        const t = mesh(cone, color);
        t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        t.position.set(x * r * sx, y * r * sy, z * r * sz).multiplyScalar(1.02);
        g.add(t);
      }
      break;
    }
    case 'ponytail': {
      g.add(mesh(capGeo(r, shape, 1.06, 0.6, -0.3), color));
      tail = true;
      break;
    }
  }
  if (tail) {
    // a loose tail tied at the nape; swings like the cloth (userData.dangle)
    const pivot = new THREE.Group();
    pivot.userData.dangle = 0.35;
    pivot.position.set(0, -top * 0.15, -r * 0.95 * sz);
    pivot.rotation.x = 0.25;
    const lock = mesh(limbGeo(0.03, 0.012, r * 2.1, 6), color);
    const tie = mesh(limbGeo(0.026, 0.026, 0.016, 6), '#c9a24a');
    tie.position.y = 0.004;
    pivot.add(lock, tie);
    g.add(pivot);
  }
  return g;
}

/** Hachimaki: a cloth band round the forehead, knotted at the back. */
export function headbandGroup(color: string, mark: string | undefined, r: number, shape: HeadShape, tailLen = 1): THREE.Group {
  const g = new THREE.Group();
  const { sx, sy, sz } = headScale(shape);
  const y = BAND_Y * sy, half = 0.016;
  // radius of the (hair-inflated) skull at a given height, plus a hair's gap
  const skullR = (yy: number) => r * (Math.sqrt(Math.max(0, 1 - (yy / (r * sy)) ** 2)) * 1.09 + 0.012);
  const rTop = skullR(y + half), rBot = skullR(y - half), rMid = skullR(y);
  const bandGeo = new THREE.CylinderGeometry(rTop, rBot, half * 2, 12, 1, true);
  bandGeo.scale(sx, 1, sz);
  const band = mesh(bandGeo, color);
  band.position.y = y;
  (band.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
  g.add(band);
  const knot = mesh(blobGeo(0.022, 0.02, 0.016, 6, 4), color);
  knot.position.set(0, y, -rMid * sz - 0.008);
  g.add(knot);
  for (const s of [-1, 1]) {
    // long trailing tails, Bushido Blade style; they swing (see tailStrip)
    const tail = tailStrip(0.04, 0.13 * tailLen * (s > 0 ? 1 : 0.85), color, 0.8, 0.15);
    tail.position.set(s * 0.008, y, -rMid * sz - 0.012);
    tail.rotation.set(0.3, 0, s * 0.2);
    g.add(tail);
  }
  if (mark) {
    const dot = mesh(new THREE.CircleGeometry(0.015, 8), mark);
    dot.position.set(0, y, rMid * sz * 0.965 + 0.003);
    dot.rotation.x = -Math.atan2((rBot - rTop) * sz, half * 2);
    g.add(dot);
  }
  return g;
}

/** Thick spectacles: two octagonal rims, a bridge and the arms. */
export function glassesGroup(r: number, shape: HeadShape): THREE.Group {
  const { sx } = headScale(shape);
  const g = new THREE.Group();
  const frame = '#14161a';
  const lensR = 0.034, gap = 0.048 * Math.min(1.1, sx);
  const bridge = mesh(new THREE.BoxGeometry(gap * 2 - lensR * 2 + 0.01, 0.01, 0.012), frame);
  bridge.position.y = 0.006;
  g.add(bridge);
  for (const s of [-1, 1]) {
    const rim = mesh(new THREE.TorusGeometry(lensR, 0.0075, 4, 8), frame);
    rim.rotation.z = Math.PI / 8;
    rim.position.x = s * gap;
    g.add(rim);
    const glare = mesh(new THREE.PlaneGeometry(0.012, 0.03), '#cfe8ff', '#5a6a78');
    glare.position.set(s * gap + 0.012, 0.008, 0.003);
    glare.rotation.z = -0.6;
    g.add(glare);
    const armLen = r * 1.05;
    const arm = mesh(new THREE.BoxGeometry(0.01, 0.01, armLen), frame);
    arm.position.set(s * (gap + lensR), 0.004, -armLen / 2);
    arm.rotation.y = s * 0.12;
    g.add(arm);
  }
  return g;
}

/**
 * Face features on a head centred at the origin: ears, eyes, stern brows,
 * a flat deadpan mouth, nose, optional beard. Everything sits on the
 * flattened face plane from `headGeo`, so it scales with the head shape.
 */
export function faceGroup(
  shape: HeadShape, r: number, skin: string, hairColor: string,
  opts: { nose: number; beard: boolean; eyes: boolean; glasses: boolean },
): THREE.Group {
  const g = new THREE.Group();
  const { sx, sy } = headScale(shape);
  const fz = faceZ(shape, r);
  const eyeY = EYE_Y * sy, eyeX = 0.044 * Math.min(1.1, sx);
  for (const s of [-1, 1]) {
    const ear = mesh(blobGeo(0.014, 0.03, 0.022, 6, 4), skin);
    ear.position.set(s * r * sx * 0.97, -0.004, -0.012);
    g.add(ear);
    if (opts.eyes) {
      const white = mesh(blobGeo(0.017, 0.012, 0.004, 6, 4), '#ece8e0');
      white.position.set(s * eyeX, eyeY, fz + 0.001);
      const pupil = mesh(blobGeo(0.007, 0.008, 0.003, 5, 4), '#141414');
      pupil.position.set(s * eyeX - s * 0.003, eyeY, fz + 0.004);
      g.add(white, pupil);
    }
    // brows: inner ends low — permanently, gravely serious
    const brow = mesh(new THREE.BoxGeometry(0.042, 0.013, 0.012), hairColor);
    brow.position.set(s * eyeX, eyeY + 0.047, fz + 0.002);
    brow.rotation.z = s * 0.3;
    g.add(brow);
  }
  if (opts.glasses) {
    const specs = glassesGroup(r, shape);
    specs.position.set(0, eyeY, fz + 0.012);
    g.add(specs);
  }
  const mouth = mesh(new THREE.BoxGeometry(0.038, 0.007, 0.006), '#5a2a26');
  mouth.position.set(0, -0.054 * sy, fz);
  g.add(mouth);
  if (opts.nose > 0) {
    const size = 0.03 * opts.nose;
    const nose = noseMesh(size, skin);
    nose.position.set(0, -0.02 * sy, fz + size * 0.55);
    g.add(nose);
  }
  if (opts.beard) {
    const beard = mesh(blobGeo(r * 0.82 * sx, r * 0.42, r * 0.55, 8, 5), hairColor);
    const p = beard.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > r * 0.12) p.setY(i, r * 0.12);
    p.needsUpdate = true;
    beard.geometry.computeVertexNormals();
    beard.position.set(0, -r * 0.82 * sy, fz * 0.42);
    const stache = mesh(new THREE.BoxGeometry(0.056, 0.014, 0.014), hairColor);
    stache.position.set(0, -0.038 * sy, fz + 0.006);
    g.add(beard, stache);
  }
  return g;
}

export function noseMesh(size: number, color: string): THREE.Mesh {
  const g = new THREE.ConeGeometry(size * 0.55, size * 1.3, 5);
  g.rotateX(Math.PI / 2);
  return mesh(g, color);
}

export function shoeMesh(w: number, color: string): THREE.Mesh {
  const m = mesh(blobGeo(w * 0.55, 0.045, 0.13, 8, 5), color);
  return m;
}

/** Octagonal cloth rings with alternating pleats, hanging from a joint. */
export function clothGeo(top: number, hem: number, len: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(top, hem, len, 12, 2);
  g.translate(0, -len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const angle = Math.atan2(p.getX(i), p.getZ(i));
    const fold = 1 + 0.10 * Math.cos(angle * 6);
    p.setXYZ(i, p.getX(i) * fold, p.getY(i), p.getZ(i) * fold * 0.82);
  }
  g.computeVertexNormals();
  return g;
}

/** Crossed kimono lapels and a broad obi, kept local to the torso. */
export function jacketDetails(b: number, height: number, body: string, trim: string): THREE.Group {
  const group = new THREE.Group();
  const depth = 0.145 * b;
  for (const side of [-1, 1]) {
    const lapel = mesh(new THREE.BoxGeometry(0.052 * b, height * 0.86, 0.026), '#d4c5a5');
    lapel.position.set(side * 0.055 * b, height * 0.54, depth);
    lapel.rotation.z = side * -0.38;
    group.add(lapel);
  }
  const belt = mesh(new THREE.CylinderGeometry(0.205 * b, 0.208 * b, height * 0.23, 10), trim);
  belt.scale.z = 0.77;
  belt.position.y = height * 0.06;
  const knot = mesh(new THREE.BoxGeometry(0.085 * b, 0.07, 0.055), body);
  knot.position.set(0.07 * b, height * 0.07, 0.175 * b);
  const end = mesh(new THREE.BoxGeometry(0.065 * b, height * 0.45, 0.025), trim);
  end.position.set(0.10 * b, -height * 0.22, 0.16 * b);
  end.rotation.z = -0.15;
  group.add(belt, knot, end);
  // Small ivory family crest on the back of the jacket.
  const crest = mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.008, 8), '#d4c5a5');
  crest.rotation.x = Math.PI / 2;
  crest.position.set(0, height * 0.72, -depth);
  group.add(crest);
  return group;
}

// ---------- street clothes (outfit.style = "street") ----------

/** Darker/lighter variant of a color, for hems, collars and soles. */
export function shade(color: string, k: number): THREE.Color {
  return new THREE.Color(color).multiplyScalar(k);
}

/**
 * Gripping fist, hanging at y=0 (the wrist): a squared-off palm block, a
 * knuckle ridge curled forward and the thumb wrapped over — the blocky
 * Bushido Blade hand rather than a mitten.
 */
export function handGroup(w: number, skin: string, side: 1 | -1): THREE.Group {
  const g = new THREE.Group();
  const palm = mesh(blobGeo(w * 0.4, w * 0.46, w * 0.34, 6, 4), skin);
  palm.position.y = -w * 0.3;
  const fingers = mesh(new THREE.BoxGeometry(w * 0.66, w * 0.3, w * 0.42), shade(skin, 0.94));
  fingers.position.set(0, -w * 0.62, w * 0.1);
  fingers.rotation.x = 0.35;
  const thumb = mesh(blobGeo(w * 0.13, w * 0.24, w * 0.13, 5, 4), skin);
  thumb.position.set(-side * w * 0.26, -w * 0.38, w * 0.26);
  thumb.rotation.set(0.6, 0, -side * 0.9);
  g.add(palm, fingers, thumb);
  return g;
}

/**
 * Chunky sneaker centred under the ankle at y=0: white sole, colored
 * upper, white toe cap; `high` adds the ankle collar of a high-top.
 */
export function sneakerGroup(w: number, upper: string, high: boolean): THREE.Group {
  const g = new THREE.Group();
  const sole = mesh(new THREE.BoxGeometry(w * 0.7, 0.024, 0.23), '#e8e4da');
  sole.position.set(0, -0.046, 0.045);
  const body = mesh(blobGeo(w * 0.4, 0.046, 0.115, 8, 5), upper);
  body.position.set(0, -0.022, 0.04);
  const toe = mesh(blobGeo(w * 0.34, 0.026, 0.05, 7, 4), '#e8e4da');
  toe.position.set(0, -0.032, 0.12);
  g.add(sole, body, toe);
  if (high) {
    const collar = mesh(limbGeo(w * 0.5, w * 0.52, 0.09, 8), upper);
    collar.position.y = 0.05;
    g.add(collar);
  }
  return g;
}

/** Flat triangles (x,y pairs, 3 per triangle) facing +Z. */
function flatTris(tris: number[][]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const [x, y] of tris) pos.push(x, y, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Fan-triangulate a polygon that is star-shaped around the origin. */
function fanTris(pts: number[][]): number[][] {
  const tris: number[][] = [];
  for (let i = 0; i < pts.length; i++) tris.push([0, 0], pts[i], pts[(i + 1) % pts.length]);
  return tris;
}

/**
 * Flat chest print, facing +Z, centred at the origin, ~`size` across.
 * Hand-built triangles: three's ShapeGeometry would add ~7 kB gzipped.
 */
export function emblemMesh(kind: 'star' | 'bolt' | 'dpad' | 'ring', color: string, size: number): THREE.Mesh {
  const s = size / 2;
  let geo: THREE.BufferGeometry;
  if (kind === 'star') {
    const pts: number[][] = [];
    for (let i = 0; i < 10; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? s * 0.42 : s;
      pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
    geo = flatTris(fanTris(pts));
  } else if (kind === 'bolt') {
    // two overlapping wedges make the zig-zag
    geo = flatTris([
      [0.25 * s, s], [-0.55 * s, -0.12 * s], [0.18 * s, -0.12 * s],
      [-0.25 * s, -s], [0.55 * s, 0.12 * s], [-0.18 * s, 0.12 * s],
    ]);
  } else if (kind === 'dpad') {
    const a = s * 0.33;
    geo = flatTris(fanTris([[-a, s], [-a, a], [-s, a], [-s, -a], [-a, -a], [-a, -s], [a, -s], [a, -a], [s, -a], [s, a], [a, a], [a, s]]));
  } else {
    geo = new THREE.RingGeometry(s * 0.62, s, 12);
  }
  return mesh(geo, color);
}

/** Crew-neck tee over a lathe torso: collar ring, hem, chest print. */
export function teeDetails(d: TorsoDims, shirt: string, emblem?: CharacterOutfitEmblem): THREE.Group {
  const g = new THREE.Group();
  const w = 0.19 * d.b, H = d.height;
  const zs = torsoDepth(d);
  const collar = mesh(new THREE.TorusGeometry(w * 0.47, 0.014, 4, 10), shade(shirt, 0.7));
  collar.rotation.x = Math.PI / 2;
  collar.scale.y = 0.85;
  collar.position.y = H * 0.985;
  const hemGeo = new THREE.CylinderGeometry(w * 0.97, w * 1.02, 0.05, 12, 1, true);
  hemGeo.scale(1, 1, zs * 1.04);
  const hem = mesh(hemGeo, shade(shirt, 0.8));
  hem.position.y = 0.01;
  g.add(collar, hem);
  if (emblem) {
    const chestR = w * (1.02 + 0.25 * (d.chest - 1));
    const e = emblemMesh(emblem.kind, emblem.color, 0.16 * Math.sqrt(d.b));
    e.position.set(0, H * 0.7, chestR * zs + 0.006);
    e.rotation.x = -0.12;
    g.add(e);
  }
  return g;
}

export interface CharacterOutfitEmblem { kind: 'star' | 'bolt' | 'dpad' | 'ring'; color: string; }

// ---------- bushido cosplay, worn over the street clothes ----------

/** Open band hugging the torso between two heights (obi, tasuki loops). */
function torsoBand(d: TorsoDims, y0: number, y1: number, puff: number, color: string | THREE.Color): THREE.Mesh {
  const g = new THREE.CylinderGeometry(torsoRadius(d, y1) * puff, torsoRadius(d, y0) * puff, y1 - y0, 12, 1, true);
  g.scale(1, 1, torsoDepth(d));
  const m = mesh(g, color);
  m.position.y = (y0 + y1) / 2;
  (m.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
  return m;
}

/**
 * A strip of cloth hanging along -Y from its pivot. The pivot is tagged
 * `userData.dangle` (stiffness 0..1 toward its rest angle), and the view
 * swings every tagged pivot with gravity and motion.
 */
export function tailStrip(w: number, len: number, color: string | THREE.Color, taper = 0.75, stiff = 0.3): THREE.Group {
  const pivot = new THREE.Group();
  pivot.userData.dangle = stiff;
  const g = new THREE.BufferGeometry();
  const t = w * taper / 2, h = w / 2;
  // a flat quad that narrows toward the end, with a slight V fold for depth
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    -h, 0, 0, 0, 0, 0.006, 0, -len, 0.004, -h, 0, 0, 0, -len, 0.004, -t, -len, 0,
    0, 0, 0.006, h, 0, 0, t, -len, 0, 0, 0, 0.006, t, -len, 0, 0, -len, 0.004,
  ], 3));
  g.computeVertexNormals();
  const m = mesh(g, color);
  (m.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
  pivot.add(m);
  return pivot;
}

/**
 * Obi tied over the tee, under the belly where it actually sits on a man
 * like Panzer: a broad band, a flat knot at the front-left and two tails
 * (returned separately so the view can let them swing).
 */
export function obiGroup(d: TorsoDims, color: string): THREE.Group {
  const group = new THREE.Group();
  const y0 = -0.03, y1 = d.height * 0.16;
  group.add(torsoBand(d, y0, y1, 1.05, color));
  const ym = (y0 + y1) / 2;
  const ang = 0.55; // knot sits off-centre, toward the wearer's left
  const r = torsoRadius(d, ym) * 1.08, zs = torsoDepth(d);
  const kx = -Math.sin(ang) * r, kz = Math.cos(ang) * r * zs;
  const knot = mesh(blobGeo(0.05, 0.042, 0.03, 6, 4), shade(color, 0.85));
  knot.position.set(kx, ym, kz);
  knot.rotation.y = -ang;
  group.add(knot);
  for (const [dx, len, roll] of [[-0.018, 0.3, 0.08], [0.02, 0.24, -0.1]] as const) {
    const tail = tailStrip(0.07, len, shade(color, 0.92), 0.75, 0.45);
    tail.position.set(kx + dx, ym - 0.02, kz + 0.012);
    tail.rotation.set(0, -ang, roll);
    group.add(tail);
  }
  return group;
}

/**
 * Tasuki: the cord that ties kimono sleeves back, crossed in an X over the
 * back and looped over each shoulder. Over a t-shirt it ties back nothing.
 */
export function tasukiGroup(d: TorsoDims, color: string): THREE.Group {
  const g = new THREE.Group();
  const zs = torsoDepth(d), H = d.height;
  const surface = (x: number, y: number, sign: number) => {
    const r = torsoRadius(d, y) * 1.04;
    const cx = Math.max(-r * 0.97, Math.min(r * 0.97, x));
    return new THREE.Vector3(cx, y, sign * Math.sqrt(r * r - cx * cx) * zs);
  };
  const strand = (pts: THREE.Vector3[]) => {
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const len = a.distanceTo(b);
      const seg = mesh(new THREE.CylinderGeometry(0.009, 0.009, len + 0.006, 4), color);
      seg.position.copy(a).add(b).multiplyScalar(0.5);
      seg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(seg);
    }
  };
  for (const s of [-1, 1]) {
    const shoulderX = s * torsoRadius(d, H * 0.9) * 0.62;
    const back: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      back.push(surface(shoulderX * (1 - t) - s * torsoRadius(d, H * 0.15) * 0.8 * t, H * (0.93 - 0.78 * t), -1));
    }
    strand(back);
    // over the shoulder and down the front into the armpit
    strand([back[0], new THREE.Vector3(shoulderX, H * 0.99, 0), surface(shoulderX * 1.15, H * 0.72, 1)]);
  }
  return g;
}

/**
 * Kyahan: cloth shin wraps from below the knee to the ankle, with the
 * diagonal wrap lines and the tie at the top. Hangs along -Y from y=0.
 */
export function kyahanGroup(rTop: number, rBot: number, len: number, color: string): THREE.Group {
  const g = new THREE.Group();
  const shell = mesh(limbGeo(rTop, rBot, len, 9), color);
  g.add(shell);
  const wraps = 5;
  for (let i = 1; i < wraps; i++) {
    const t = i / wraps;
    const r = rTop + (rBot - rTop) * t;
    const ring = mesh(new THREE.TorusGeometry(r * 1.01, 0.004, 3, 9), shade(color, 0.72));
    ring.rotation.set(Math.PI / 2 + 0.3, 0, 0);
    ring.position.y = -len * t;
    g.add(ring);
  }
  const tie = mesh(new THREE.TorusGeometry(rTop * 1.03, 0.006, 3, 9), '#e8e2d2');
  tie.rotation.x = Math.PI / 2;
  tie.position.y = -0.012;
  g.add(tie);
  return g;
}

/**
 * Haori: a hip-length coat worn open over the tee — a torso shell with the
 * front cut away, a contrasting collar band down both front edges, the
 * short cords that tie it, and a crest on the back.
 */
export function haoriGroup(d: TorsoDims, color: string, collar: string): THREE.Group {
  const g = new THREE.Group();
  const H = d.height, zs = torsoDepth(d);
  const yHem = -0.16;
  const prof = [yHem, 0, H * 0.32, H * 0.72, H * 0.9, H * 0.98].map((y) =>
    new THREE.Vector2(torsoRadius(d, Math.max(0, y)) * (y < H * 0.8 ? 1.12 : 1.08) + (y < 0 ? 0.015 : 0), y));
  const open = 0.42; // half-angle of the open front
  const shellGeo = new THREE.LatheGeometry(prof, 12, open, Math.PI * 2 - open * 2);
  shellGeo.scale(1, 1, zs * 1.06);
  const shell = mesh(shellGeo, color);
  (shell.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
  g.add(shell);
  for (const s of [-1, 1]) {
    // collar band (eri) running from the back of the neck down the front edge
    const pts: THREE.Vector3[] = [];
    for (const v of prof.slice().reverse()) {
      const r = v.x * 1.005;
      pts.push(new THREE.Vector3(s * Math.sin(open) * r, v.y, Math.cos(open) * r * zs * 1.06));
    }
    pts[0].set(s * 0.05, H * 1.0, -0.01);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const band = mesh(new THREE.BoxGeometry(0.04, a.distanceTo(b) + 0.01, 0.012), collar);
      band.position.copy(a).add(b).multiplyScalar(0.5);
      band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      g.add(band);
    }
    const himo = mesh(blobGeo(0.012, 0.03, 0.01, 5, 4), collar);
    himo.position.set(s * Math.sin(open) * torsoRadius(d, H * 0.55) * 1.0, H * 0.53, Math.cos(open) * torsoRadius(d, H * 0.55) * 1.12 * zs * 1.06 + 0.008);
    himo.rotation.z = s * 0.5;
    g.add(himo);
  }
  const crest = mesh(new THREE.RingGeometry(0.022, 0.036, 8), collar);
  crest.position.set(0, H * 0.78, -torsoRadius(d, H * 0.78) * 1.12 * zs * 1.06 - 0.004);
  crest.rotation.y = Math.PI;
  g.add(crest);
  return g;
}

/** Wide haori sleeve: a flared, open bell from the shoulder past the elbow. */
export function haoriSleeveGeo(r: number, len: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r * 2.1, len, 10, 2, true);
  g.translate(0, -len / 2, 0);
  // soft folds, and the bag of the sleeve sagging toward the back of the arm
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const t = -p.getY(i) / len;
    const fold = 1 + 0.08 * Math.cos(Math.atan2(p.getX(i), p.getZ(i)) * 5);
    p.setXYZ(i, p.getX(i) * fold, p.getY(i), p.getZ(i) * fold - t * t * r * 0.9);
  }
  g.computeVertexNormals();
  return g;
}
