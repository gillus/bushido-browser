import * as THREE from 'three';
import { FighterState, SimState, StageDef, WallSide } from '../sim/types';
import { Clerk } from './clerk';
import { Smashable } from './debris';
import { buildShelf } from './fixtures';
import { Arcade } from './arcade';
import { DisplayTable } from './displayTable';
import { Kiosk } from './kiosk';
import { buildPoster } from './poster';
import { buildStandee } from './standee';
import { buildStorefront, holedWallGeo, storefrontHoles, wallAngle } from './storefront';

export interface SceneBundle {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  /** `orbit` (radians) switches to the low replay camera, swung that far round the pair. */
  updateCamera: (a: FighterState, b: FighterState, dt: number, orbit?: number) => void;
  updateProps: (sim: SimState) => void;
  smashables: Smashable[]; // set dressing that breaks: shop window, kiosk, arcade, display table
}

function ringLine(radius: number, y: number, color: string): THREE.LineLoop {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius));
  }
  return new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color }),
  );
}

/** 2×2 checker canvas; repeat it to tile a floor. */
function checkerTexture(a: string, b: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  g.fillStyle = a; g.fillRect(0, 0, 64, 64);
  g.fillStyle = b; g.fillRect(0, 0, 32, 32); g.fillRect(32, 32, 32, 32);
  // faint grout lines
  g.fillStyle = 'rgba(0,0,0,0.25)';
  g.fillRect(0, 0, 64, 1); g.fillRect(0, 32, 64, 1);
  g.fillRect(0, 0, 1, 64); g.fillRect(32, 0, 1, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Four inward-facing walls: the one nearest the camera culls itself. A
 *  storefront wall gets its window and door cut out. */
function roomWalls(w: NonNullable<StageDef['walls']>): THREE.Group {
  const cv = document.createElement('canvas');
  cv.width = 8; cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = w.color; g.fillRect(0, 0, 8, 128);
  const trim = w.trim ?? w.color;
  g.fillStyle = trim; g.fillRect(0, 128 - 34, 8, 34);      // wainscot
  g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, 128 - 36, 8, 2); // rail
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, 128 - 5, 8, 5);         // baseboard
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshLambertMaterial({ map: tex });
  const group = new THREE.Group();
  for (const side of ['-z', '-x', '+z', '+x'] as WallSide[]) {
    const holed = w.storefront?.wall === side;
    const wall = new THREE.Mesh(
      holed
        ? holedWallGeo(w.halfSize * 2, w.height, storefrontHoles(w.storefront!))
        : new THREE.PlaneGeometry(w.halfSize * 2, w.height),
      mat,
    );
    const a = wallAngle(side);
    // plane faces +Z locally → faces the room centre (holed geometry starts at y=0)
    wall.position.set(-Math.sin(a) * w.halfSize, (holed ? 0 : w.height / 2) - 0.02, -Math.cos(a) * w.halfSize);
    wall.rotation.y = a;
    group.add(wall);
  }
  // unlit ceiling: black with glowing fluorescent strips (no extra lights)
  const cc = document.createElement('canvas');
  cc.width = cc.height = 128;
  const cg = cc.getContext('2d')!;
  cg.fillStyle = '#000000'; cg.fillRect(0, 0, 128, 128);
  cg.fillStyle = '#ffffff';
  for (const x of [26, 62, 98]) for (const y of [16, 76]) cg.fillRect(x, y, 3, 36);
  const glow = new THREE.CanvasTexture(cc);
  glow.colorSpace = THREE.SRGBColorSpace;
  glow.magFilter = THREE.NearestFilter;
  const ceiling = new THREE.Mesh(
    new THREE.PlaneGeometry(w.halfSize * 2, w.halfSize * 2),
    new THREE.MeshBasicMaterial({ color: '#8d97ab', map: glow }),
  );
  ceiling.rotation.x = Math.PI / 2; // face down into the room
  ceiling.position.y = w.height - 0.02;
  group.add(ceiling);
  return group;
}

function addCage(scene: THREE.Scene, stage: StageDef): void {
  scene.add(ringLine(stage.radius, 0.02, stage.ringColor));
  scene.add(ringLine(stage.radius, 1.1, stage.gridColor));
  const tickPts: THREE.Vector3[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = Math.cos(a) * stage.radius, z = Math.sin(a) * stage.radius;
    tickPts.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 1.1, z));
  }
  scene.add(new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(tickPts),
    new THREE.LineBasicMaterial({ color: stage.gridColor }),
  ));
}

export function createScene(stage: StageDef, container: HTMLElement): SceneBundle {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(stage.fogColor);
  scene.fog = new THREE.Fog(stage.fogColor, stage.fogNear, stage.fogFar);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  if (!stage.floorTile) {
    const grid = new THREE.GridHelper(
      stage.gridSize, stage.gridDivisions,
      new THREE.Color(stage.ringColor), new THREE.Color(stage.gridColor),
    );
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);
  }

  // arena cage: two hoops plus vertical ticks (a walled room is its own boundary)
  if (!stage.walls) addCage(scene, stage);

  // solid floor + scenery props (render-only; sim never sees these)
  if (stage.floorColor) {
    const floorMat = new THREE.MeshLambertMaterial({ color: stage.floorColor });
    // a walled room gets a floor that stops at the walls; otherwise a big disc
    const floorSize = stage.walls ? stage.walls.halfSize * 2 : 80;
    if (stage.floorTile) {
      // shop linoleum: crisp checker up close, mipmapped far away
      const tex = checkerTexture(stage.floorColor, stage.floorTile);
      tex.repeat.setScalar(floorSize / (2 * (stage.tileSize ?? 0.6)));
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      floorMat.color.set('#ffffff');
      floorMat.map = tex;
    }
    const floor = new THREE.Mesh(
      stage.walls
        ? new THREE.PlaneGeometry(floorSize, floorSize)
        : new THREE.CircleGeometry(floorSize / 2, 48),
      floorMat,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.02;
    scene.add(floor);
  }
  if (stage.walls) scene.add(roomWalls(stage.walls));
  interface Knockable {
    mesh: THREE.Object3D; obIndex: number;
    pos0: THREE.Vector3; quat0: THREE.Quaternion;
    baseY: number; halfT: number;
  }
  const knockables: Knockable[] = [];
  // Thin non-solid props flush to a wall (posters, signs) are wall decor:
  // they hide with their wall when it culls, instead of floating in mid-air.
  // Tall furniture against a wall (shelving) hides once the camera is past
  // its front, so it never blocks the shot from behind. `limit` = how far
  // out along that wall's normal the camera may go. Walls indexed by
  // outward normal: +z, -z, +x, -x.
  interface Hugger { obj: THREE.Object3D; limit: number }
  const wallDecor: Hugger[][] = [[], [], [], []];
  const DECOR_INDEX: Record<WallSide, number> = { '+z': 0, '-z': 1, '+x': 2, '-x': 3 };
  const sf = stage.walls?.storefront;
  const smashables: Smashable[] = [];
  if (sf) {
    // window frames, glass and the whole street go when their wall culls
    const front = buildStorefront(sf, stage.walls!);
    scene.add(front.group);
    wallDecor[DECOR_INDEX[sf.wall]].push({ obj: front.group, limit: stage.walls!.halfSize });
    smashables.push(front.shopWindow);
  }
  const clerk = stage.clerk ? new Clerk(stage.clerk) : null;
  if (clerk) scene.add(clerk.root);
  const box = new THREE.Box3();
  let solidIndex = 0;
  for (const p of stage.props ?? []) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.size[0], p.size[1], p.size[2]));
    mesh.position.set(p.pos[0], p.pos[1] + p.size[1] / 2, p.pos[2]);
    if (p.rot) mesh.rotation.y = (p.rot * Math.PI) / 180;
    const smashable = p.fixture === 'kiosk' ? new Kiosk(p)
      : p.fixture === 'arcade' ? new Arcade(p)
      : p.fixture === 'table' ? new DisplayTable(p)
      : null;
    if (smashable) smashables.push(smashable);
    const fixture = smashable?.object
      ?? (p.fixture === 'shelf' ? buildShelf(p)
        : p.fixture === 'standee' ? buildStandee(p)
        : p.fixture === 'poster' ? buildPoster(p)
        : null);
    if (fixture) {
      scene.add(fixture);
    } else {
      const mat = new THREE.MeshLambertMaterial({ color: p.color });
      if (p.emissive) mat.emissive = new THREE.Color(p.emissive);
      mesh.material = mat;
      scene.add(mesh);
    }
    if (stage.walls) {
      const h = stage.walls.halfSize;
      mesh.updateMatrixWorld();
      box.setFromObject(mesh);
      const thin = (a: number, b: number): boolean => !p.solid && b - a < 0.2;
      const tall = p.solid && p.size[1] >= 1.5;
      const wall =
        box.max.z > h - 0.1 && (thin(box.min.z, box.max.z) || tall) ? 0
        : box.min.z < 0.1 - h && (thin(box.min.z, box.max.z) || tall) ? 1
        : box.max.x > h - 0.1 && (thin(box.min.x, box.max.x) || tall) ? 2
        : box.min.x < 0.1 - h && (thin(box.min.x, box.max.x) || tall) ? 3
        : -1;
      if (wall >= 0) {
        // room-side face, measured out along the wall's normal
        const face = [box.min.z, -box.max.z, box.min.x, -box.max.x][wall];
        wallDecor[wall].push({ obj: fixture ?? mesh, limit: tall ? face - 0.3 : h });
      }
    }
    if (p.solid) {
      // (a knockable fixture is built centred in its box, like the plain mesh)
      const body = fixture ?? mesh;
      if (p.knockable && (!fixture || p.fixture === 'standee')) {
        knockables.push({
          mesh: body, obIndex: solidIndex,
          pos0: body.position.clone(), quat0: body.quaternion.clone(),
          baseY: p.pos[1], halfT: Math.min(p.size[0], p.size[2]) / 2,
        });
      }
      solidIndex++;
    }
  }

  // topple animation for knocked-down cardboard, driven by sim state
  const kAxis = new THREE.Vector3();
  const kQ = new THREE.Quaternion();
  const kPivot = new THREE.Vector3();
  const updateProps = (sim: SimState): void => {
    for (const k of knockables) {
      const st = sim.obstacleState[k.obIndex];
      if (!st || !st.down) {
        k.mesh.position.copy(k.pos0);
        k.mesh.quaternion.copy(k.quat0);
        continue;
      }
      const t = Math.min(1, (sim.frame - st.downFrame) / 26);
      const ease = 1 - (1 - t) ** 3; // fast tip, soft landing
      kAxis.set(st.fz, 0, -st.fx).normalize(); // up x fallDir
      kQ.setFromAxisAngle(kAxis, ease * (Math.PI / 2));
      kPivot.set(k.pos0.x, k.baseY, k.pos0.z);
      k.mesh.position.copy(k.pos0).sub(kPivot).applyQuaternion(kQ).add(kPivot);
      k.mesh.position.y += ease * k.halfT; // rest on its face, not in the floor
      k.mesh.quaternion.copy(kQ).multiply(k.quat0);
    }
  };

  // Lighting: cool ambient, a warm overhead key, a shop-fluorescent pool
  // over the arena, and a camera-relative rim light (positioned in
  // updateCamera) that always backlights the fighters off the dark room.
  scene.add(new THREE.HemisphereLight('#c4cedc', '#2a2622', 1.25));
  const sun = new THREE.DirectionalLight('#fff0dc', 1.5);
  sun.position.set(3, 8, 4);
  scene.add(sun);
  const pool = new THREE.PointLight('#e8f0ff', 14, 0, 1.6);
  pool.position.set(0, 3.0, 0);
  scene.add(pool);
  const rim = new THREE.DirectionalLight('#8fb8ff', 2.2);
  scene.add(rim, rim.target);

  const camera = new THREE.PerspectiveCamera(
    52, window.innerWidth / window.innerHeight, 0.1, 60,
  );
  camera.position.set(0, 2, -7);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Side-framing duel camera: sits perpendicular to the line between
  // fighters, pulls back with distance, never flips sides mid-fight.
  const camTarget = new THREE.Vector3(0, 1, 0);
  const desired = new THREE.Vector3();
  const perp = new THREE.Vector3();

  const UP = new THREE.Vector3(0, 1, 0);

  const updateCamera = (a: FighterState, b: FighterState, dt: number, orbit?: number): void => {
    const midX = (a.pos.x + b.pos.x) / 2;
    const midZ = (a.pos.z + b.pos.z) / 2;
    const dx = b.pos.x - a.pos.x;
    const dz = b.pos.z - a.pos.z;
    const d = Math.max(0.001, Math.hypot(dx, dz));

    perp.set(-dz / d, 0, dx / d);
    // stay on whichever side we're already on
    const toCam = new THREE.Vector3(camera.position.x - midX, 0, camera.position.z - midZ);
    if (perp.dot(toCam) < 0) perp.negate();

    const cine = orbit !== undefined; // replay: in close and low, drifting round
    if (cine) perp.applyAxisAngle(UP, orbit);
    const back = cine ? 2.3 + d * 0.6 : 2.8 + d * 0.85;
    desired.set(midX + perp.x * back, cine ? 1.15 + d * 0.1 : 1.55 + d * 0.14, midZ + perp.z * back);

    const k = 1 - Math.exp(-(cine ? 8 : 4) * dt);
    camera.position.lerp(desired, k);
    camTarget.lerp(new THREE.Vector3(midX, cine ? 0.9 : 1.0, midZ), k);
    camera.lookAt(camTarget);
    // rim light from the far side of the fighters, high and behind
    rim.position.set(camTarget.x - perp.x * 6, 4.5, camTarget.z - perp.z * 6);
    rim.target.position.copy(camTarget);
    clerk?.update(dt, camTarget);
    if (stage.walls) {
      // a wall culls once the camera is behind it; take its decor along
      const c = camera.position;
      const out = [c.z, -c.z, c.x, -c.x];
      for (let i = 0; i < 4; i++) for (const d of wallDecor[i]) d.obj.visible = out[i] < d.limit;
    }
  };

  return { scene, camera, renderer, updateCamera, updateProps, smashables };
}
