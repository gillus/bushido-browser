import * as THREE from 'three';
import { CharacterDef, FighterState, Obstacle, WeaponDef } from '../sim/types';
import {
  JointName, kneelLegs, lockPose, movePoses, parryPose, Pose, staggerPose, stancePoses,
} from './poses';
import { Breakable, Ragdoll, RagdollParticleInit, RagdollSegmentInit } from './ragdoll';
import {
  ballGeo, blobGeo, clothGeo, faceGroup, haoriGroup, haoriSleeveGeo, hairGroup, handGroup,
  headbandGroup, headGeo, headScale, jacketDetails, kyahanGroup, limbGeo, mat, mesh,
  muscleGeo, obiGroup, pelvisGeo, shade, shoeMesh, shortsLegGeo, sneakerGroup, tasukiGroup, teeDetails,
  torsoGeo,
} from './parts';

const WOUND_COLOR = new THREE.Color('#7a2020');

// Cloth secondary motion (headband tails, obi ends, ponytail): each tagged
// pivot's hang direction is a damped spring toward gravity, blended with
// its rest angle by stiffness, and dragged back by the pivot's own speed.
const DANGLE_SPRING = 70;
const DANGLE_DAMP = 9;
const DANGLE_DRAG = 0.09;    // tilt per m/s of travel
const DANGLE_MAX_SPEED = 6;  // ignore teleports (round reset)
const DOWN = new THREE.Vector3(0, -1, 0);

// Footfalls land at the extremes of sin(walkCycle * STRIDE_FREQ) — events.ts
// times the step sounds (and the kneeling knee-drag scuffs) off the same wave.
const STRIDE_FREQ = 5.2;
// Pelvis height kneeling on the cut leg, as a fraction of standing
const KNEEL_HIP_Y = 0.585;

interface Dangler {
  node: THREE.Object3D;
  stiff: number;
  rest: THREE.Quaternion;
  restDir: THREE.Vector3; // node's hang direction at rest, in parent space
  dir: THREE.Vector3;     // current hang direction, world space
  vel: THREE.Vector3;
  last: THREE.Vector3;
  phase: number;
  live: boolean;          // false until seeded from the pose
}

const JOINTS: JointName[] = [
  'torso', 'head', 'shoulderR', 'elbowR', 'wristR',
  'shoulderL', 'elbowL', 'hipR', 'kneeR', 'hipL', 'kneeL',
];

type SkinName = JointName | 'hips';

function box(
  w: number, h: number, d: number,
  color: string, offsetY: number,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.translate(0, offsetY, 0);
  return mesh(geo, color);
}

/** Deep copy with its own geometry + materials (the ragdoll disposes them). */
function deepClone(src: THREE.Object3D): THREE.Object3D {
  const c = src.clone(true);
  c.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry = o.geometry.clone();
      o.material = (o.material as THREE.Material).clone();
    }
  });
  return c;
}

/** Soft dark disc under each fighter: the PS1 answer to shadow maps. */
let shadowTex: THREE.CanvasTexture | null = null;
function blobShadow(radius: number): THREE.Mesh {
  if (!shadowTex) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(0,0,0,0.75)');
    grad.addColorStop(0.55, 'rgba(0,0,0,0.45)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(cv);
  }
  const geo = new THREE.CircleGeometry(radius, 16);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    map: shadowTex, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  m.position.y = 0.004;
  m.renderOrder = 1;
  return m;
}

/**
 * Articulated low-poly fighter on a group hierarchy. Body parts come from
 * `parts.ts`; the skeleton's joint layout is unchanged from the original
 * box-man so poses.ts still applies. Poses are joint Euler targets,
 * exponentially damped each frame.
 *
 * Every joint holds its own meshes in a "skin" group, separate from its
 * child joints. The death ragdoll clones those skins, so the corpse always
 * wears exactly what the living fighter wore (outfit, wounds and all).
 *
 * Note: none of this geometry is a hitbox. The sim tests reach/arc wedges
 * (weapons.json) against a fixed body circle — see `HitboxOverlay`.
 */
export class FighterView {
  readonly root = new THREE.Group();
  private body = new THREE.Group();   // tilts for the death fall
  private hips = new THREE.Group();   // pelvis pivot; y animates (bob, collapse)
  private joints = new Map<JointName, THREE.Group>();
  private skins = new Map<SkinName, THREE.Group>();
  private current = new Map<JointName, THREE.Euler>();
  private baseHipY: number;
  private hipY: number;
  private facing = 0;
  private time = 0;
  private lastWalk = 0;
  private gait = 0; // 0 standing still .. 1 travelling: fades the knee-walk in and out
  private woundMats = {
    arm: [] as { mat: THREE.MeshLambertMaterial; orig: THREE.Color }[],
    leg: [] as { mat: THREE.MeshLambertMaterial; orig: THREE.Color }[],
  };
  private shownWounds = { arm: false, leg: false };
  private shadow: THREE.Mesh;
  private ragdoll: Ragdoll | null = null;
  private danglers: Dangler[] = [];
  private dims!: {
    h: number; foreLen: number; shinLen: number;
    tipLen: number; // hand to weapon tip
  };

  constructor(
    private char: CharacterDef,
    private weapon: WeaponDef,
    private obstacles: Obstacle[] = [],
  ) {
    const h = char.heightScale;
    const b = char.bulk;
    const c = char.colors;
    this.baseHipY = 0.95 * h;

    this.hipY = this.baseHipY;
    this.root.add(this.body);
    this.body.add(this.hips);
    this.hips.position.y = this.baseHipY;
    this.shadow = blobShadow(0.36 * Math.sqrt(b) * Math.max(1, h));
    this.root.add(this.shadow);

    const shape = char.shape ?? {};
    const outfit = char.outfit ?? {};
    const street = outfit.style === 'street';
    const shorts = street && outfit.legs === 'shorts';
    const longSleeves = street && outfit.sleeves === 'long';
    const belly = shape.belly ?? 1, chest = shape.chest ?? 1;
    const shoulders = shape.shoulders ?? 1, neckLen = 0.04 * h * (shape.neck ?? 1);
    const headShape = shape.head ?? 'round';
    const hairColor = shape.hairColor ?? '#1a1a1a';
    // street: shirt = colors.body, trousers = colors.trim
    const legColor = street ? c.trim : c.body;

    const skin = (name: SkinName, parent: THREE.Group): THREE.Group => {
      const g = new THREE.Group();
      parent.add(g);
      this.skins.set(name, g);
      return g;
    };

    // pelvis
    const hipsSkin = skin('hips', this.hips);
    hipsSkin.add(mesh(pelvisGeo(b, h), legColor));
    if (shorts) {
      // crotch seam: the seat dips between the legs instead of ending flat
      const crotch = mesh(blobGeo(0.07 * b, 0.05 * h, 0.1 * b, 6, 4), legColor);
      crotch.position.y = -0.1 * h;
      const seam = mesh(new THREE.BoxGeometry(0.012, 0.11 * h, 0.012), shade(legColor, 0.7));
      seam.position.set(0, -0.06 * h, 0.12 * b);
      hipsSkin.add(crotch, seam);
    }
    if (street && !shorts) {
      // shirt tucked into belted jeans
      const belt = mesh(new THREE.CylinderGeometry(0.18 * b, 0.18 * b, 0.034, 10), '#2a2420');
      belt.scale.z = 0.7;
      belt.position.y = 0.075 * h;
      const buckle = mesh(new THREE.BoxGeometry(0.046, 0.03, 0.01), '#b8a060');
      buckle.position.set(0, 0.075 * h, 0.18 * b * 0.7 + 0.004);
      hipsSkin.add(belt, buckle);
    }

    // torso + neck
    const torso = new THREE.Group();
    torso.position.y = 0.09 * h;
    const torsoH = 0.44 * h;
    this.hips.add(torso);
    const torsoSkin = skin('torso', torso);
    const tdims = { h, b, belly, chest, shoulders, height: torsoH };
    torsoSkin.add(mesh(torsoGeo(tdims), c.body));
    if (street) {
      torsoSkin.add(teeDetails(tdims, c.body, outfit.emblem
        ? { kind: outfit.emblem, color: outfit.emblemColor ?? '#ece6da' } : undefined));
      if (outfit.haori) torsoSkin.add(haoriGroup(tdims, outfit.haori, outfit.haoriCollar ?? '#e8e2d2'));
      if (outfit.tasuki) torsoSkin.add(tasukiGroup(tdims, outfit.tasuki));
      if (outfit.obi) torsoSkin.add(obiGroup(tdims, outfit.obi));
    } else {
      torsoSkin.add(jacketDetails(b, torsoH, c.body, c.trim));
    }
    const neck = mesh(limbGeo(0.045, 0.05, neckLen + 0.03, 8), c.skin);
    neck.position.y = torsoH + neckLen + 0.01;
    torsoSkin.add(neck);

    // head: skull, face, hair, headband — all around the head centre
    const headR = 0.115;
    const head = new THREE.Group();
    head.position.y = torsoH + neckLen;
    torso.add(head);
    const headSkin = skin('head', head);
    const centre = new THREE.Group();
    centre.position.y = headR * headScale(headShape).sy + 0.01;
    headSkin.add(centre);
    centre.add(mesh(headGeo(headShape, headR), c.skin));
    centre.add(faceGroup(headShape, headR, c.skin, hairColor, {
      nose: shape.nose ?? 1, beard: !!shape.beard,
      eyes: shape.eyes ?? true, glasses: !!char.glasses,
    }));
    centre.add(hairGroup(shape.hair ?? 'topknot', hairColor, headR, headShape, !!shape.tail));
    if (outfit.headband) {
      centre.add(headbandGroup(outfit.headband, outfit.headbandMark, headR, headShape, outfit.headbandTails));
    }
    this.joints.set('torso', torso);
    this.joints.set('head', head);

    // arms — pivot at shoulder, geometry hangs along -Y
    const armW = 0.13 * Math.sqrt(b), upperLen = 0.3 * h, foreLen = 0.28 * h;
    const mkArm = (side: 1 | -1, sh: JointName, el: JointName): THREE.Group => {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.21 * b * shoulders, torsoH * 0.9, 0);
      torso.add(shoulder);
      const elbow = new THREE.Group();
      elbow.position.y = -upperLen;
      shoulder.add(elbow);
      const shSkin = skin(sh, shoulder);
      const elSkin = skin(el, elbow);
      if (street) {
        const sleeveLen = longSleeves ? upperLen : upperLen * 0.5;
        shSkin.add(mesh(ballGeo(armW * 0.64), c.body));
        shSkin.add(mesh(limbGeo(armW * 0.66, armW * 0.8, sleeveLen, 9), c.body));
        const hem = mesh(limbGeo(armW * 0.82, armW * 0.82, 0.024, 9), shade(c.body, 0.78));
        hem.position.y = -sleeveLen + 0.024;
        shSkin.add(hem);
        if (!longSleeves) shSkin.add(mesh(muscleGeo(armW * 0.4, armW * 0.46, armW * 0.36, upperLen, 0.45), c.skin));
        if (outfit.haori) {
          const sleeve = mesh(haoriSleeveGeo(armW * 0.85, upperLen * 1.02), outfit.haori);
          (sleeve.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
          shSkin.add(mesh(ballGeo(armW * 0.7), outfit.haori), sleeve);
        }
        elSkin.add(mesh(ballGeo(armW * (longSleeves ? 0.5 : 0.4)), longSleeves ? c.body : c.skin));
        if (longSleeves) {
          elSkin.add(mesh(limbGeo(armW * 0.5, armW * 0.44, foreLen * 0.86, 9), c.body));
          const cuff = mesh(limbGeo(armW * 0.46, armW * 0.46, 0.03, 9), shade(c.body, 0.78));
          cuff.position.y = -foreLen * 0.86 + 0.03;
          elSkin.add(cuff);
        } else {
          elSkin.add(mesh(muscleGeo(armW * 0.38, armW * 0.44, armW * 0.3, foreLen, 0.28), c.skin));
        }
        const hand = handGroup(armW, c.skin, side);
        hand.position.y = -foreLen;
        elSkin.add(hand);
      } else {
        shSkin.add(mesh(ballGeo(armW * 0.83), c.body));
        shSkin.add(mesh(clothGeo(armW * 0.82, armW * 1.02, upperLen), c.body));
        elSkin.add(mesh(ballGeo(armW * 0.42), c.trim));
        elSkin.add(mesh(limbGeo(armW * 0.4, armW * 0.34, foreLen), c.skin));
        const hand = mesh(blobGeo(armW * 0.42, armW * 0.5, armW * 0.36), c.skin);
        hand.position.y = -foreLen;
        elSkin.add(hand);
        const cuff = mesh(clothGeo(armW * 0.48, armW * 0.39, foreLen * 0.64), c.trim);
        cuff.position.y = -foreLen * 0.25;
        elSkin.add(cuff);
        for (let i = 0; i < 3; i++) {
          const tie = mesh(limbGeo(armW * 0.49, armW * 0.49, 0.015, 8), '#ab9574');
          tie.position.y = -foreLen * (0.32 + i * 0.2);
          tie.userData.noTint = true;
          elSkin.add(tie);
        }
      }
      if (side === 1) this.collectTint('arm', shSkin, elSkin);
      this.joints.set(sh, shoulder);
      this.joints.set(el, elbow);
      return elbow;
    };
    const elbowR = mkArm(1, 'shoulderR', 'elbowR');
    mkArm(-1, 'shoulderL', 'elbowL');

    // weapon — gripped at the end of the right forearm, business end along -Y
    const wrist = new THREE.Group();
    wrist.position.y = -foreLen;
    elbowR.add(wrist);
    const wristSkin = skin('wristR', wrist);
    const bl = weapon.bladeLength;
    if (weapon.look === 'tube') {
      // one proud cardboard tube, duct-taped at the grip, spiral seam and all
      const tubeLen = bl + 0.3;
      const tube = mesh(new THREE.CylinderGeometry(0.028, 0.028, tubeLen, 8), c.blade);
      tube.position.y = 0.12 - tubeLen / 2;
      const tape = mesh(new THREE.CylinderGeometry(0.033, 0.033, 0.11, 8), '#4a4c52');
      const cap = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 8), '#e2dccb');
      cap.position.y = 0.12 - tubeLen;
      wristSkin.add(tube, tape, cap);
      for (let i = 1; i < 6; i++) {
        const seam = mesh(new THREE.TorusGeometry(0.0285, 0.002, 3, 8), shade(c.blade, 0.72));
        seam.rotation.x = Math.PI / 2 + 0.35;
        seam.position.y = 0.12 - (tubeLen * i) / 6;
        wristSkin.add(seam);
      }
    } else if (weapon.shaftLength > 0) {
      // polearm: haft runs from above the grip down past it, blade at the far end
      const L = weapon.shaftLength;
      if (weapon.look === 'broom') {
        const shaft = mesh(new THREE.CylinderGeometry(0.016, 0.016, L, 7), '#5b8fd1');
        shaft.position.y = 0.4 - L / 2;
        const hangCap = mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.04, 7), '#d8d2c0');
        hangCap.position.y = 0.4;
        const collar = mesh(new THREE.CylinderGeometry(0.028, 0.034, 0.07, 8), '#2e2e34');
        collar.position.y = 0.4 - L + 0.035;
        // angled bristle head: a wide wedge, flared at the floor end
        const head = mesh(new THREE.BoxGeometry(0.2, 0.05, 0.06), '#2e2e34');
        head.position.y = 0.4 - L - 0.02;
        const bristleGeo = new THREE.CylinderGeometry(0.05, 0.075, bl, 8);
        bristleGeo.scale(1.5, 1, 0.5);
        const bristles = mesh(bristleGeo, c.blade);
        bristles.position.y = 0.4 - L - 0.04 - bl / 2;
        wristSkin.add(shaft, hangCap, collar, head, bristles);
      } else {
        const shaft = mesh(new THREE.CylinderGeometry(0.016, 0.016, L, 7), '#5a4632');
        shaft.position.y = 0.4 - L / 2;
        const blade = new THREE.Mesh(
          new THREE.BoxGeometry(0.016, bl, 0.05), mat(c.blade, '#22282e'),
        );
        blade.geometry.translate(0, 0.4 - L - bl / 2, 0.01);
        wristSkin.add(shaft, blade);
      }
    } else {
      const grip = box(0.035, 0.22, 0.035, '#3a2c1a', 0.06);
      const guard = box(0.11, 0.02, 0.07, '#8a7440', -0.06);
      const blade = new THREE.Mesh(
        new THREE.BoxGeometry(0.014, bl, 0.045), mat(c.blade, '#22282e'),
      );
      blade.geometry.translate(0, -(bl / 2) - 0.07, 0.01);
      wristSkin.add(grip, guard, blade);
    }
    this.joints.set('wristR', wrist);

    // legs — pivot at hip, hang along -Y
    const legW = 0.18 * Math.sqrt(b), thighLen = 0.42 * h, shinLen = 0.4 * h;
    const mkLeg = (side: 1 | -1, hip: JointName, knee: JointName): void => {
      const hipG = new THREE.Group();
      hipG.position.set(side * 0.1 * b, -0.06 * h, 0);
      this.hips.add(hipG);
      const kneeG = new THREE.Group();
      kneeG.position.y = -thighLen;
      hipG.add(kneeG);
      const hipSkin = skin(hip, hipG);
      const kneeSkin = skin(knee, kneeG);
      if (street) {
        if (shorts) {
          // cargo shorts to just above the knee, bare shins, tube socks. Each
          // leg tapers toward a rolled hem (a flared, pleated hem = skirt).
          const shortsLen = thighLen * 0.78;
          hipSkin.add(mesh(shortsLegGeo(legW * 0.6, legW * 0.5, shortsLen), c.trim));
          const rollGeo = new THREE.CylinderGeometry(legW * 0.53, legW * 0.53, 0.035, 10, 1, true);
          rollGeo.scale(1, 1, 0.88);
          const roll = mesh(rollGeo, shade(c.trim, 0.82));
          (roll.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
          roll.position.y = -shortsLen + 0.016;
          hipSkin.add(roll);
          const pocket = mesh(new THREE.BoxGeometry(legW * 0.14, thighLen * 0.26, legW * 0.4), shade(c.trim, 0.85));
          pocket.position.set(side * legW * 0.58, -thighLen * 0.5, 0);
          hipSkin.add(pocket);
          kneeSkin.add(mesh(ballGeo(legW * 0.34), c.skin));
          kneeSkin.add(mesh(muscleGeo(legW * 0.36, legW * 0.45, legW * 0.27, shinLen, 0.3), c.skin));
          const sock = mesh(limbGeo(legW * 0.33, legW * 0.3, shinLen * 0.38, 8), outfit.socks ?? '#e8e4da');
          sock.position.y = -shinLen * 0.62;
          kneeSkin.add(sock);
          for (let i = 0; i < 2; i++) {
            const stripe = mesh(limbGeo(legW * 0.335, legW * 0.335, 0.014, 8), c.body);
            stripe.position.y = -shinLen * 0.65 - i * 0.026;
            kneeSkin.add(stripe);
          }
          if (outfit.kyahan) {
            const wrap = kyahanGroup(legW * 0.44, legW * 0.34, shinLen * 0.64, outfit.kyahan);
            wrap.position.y = -shinLen * 0.28;
            kneeSkin.add(wrap);
          }
        } else {
          hipSkin.add(mesh(limbGeo(legW * 0.62, legW * 0.5, thighLen, 9), c.trim));
          kneeSkin.add(mesh(ballGeo(legW * 0.5), c.trim));
          kneeSkin.add(mesh(limbGeo(legW * 0.5, legW * 0.46, shinLen * 0.92, 9), c.trim));
          const cuff = mesh(limbGeo(legW * 0.5, legW * 0.5, 0.03, 9), shade(c.trim, 0.8));
          cuff.position.y = -shinLen * 0.92 + 0.03;
          kneeSkin.add(cuff);
        }
        const shoe = sneakerGroup(legW, outfit.shoes ?? '#d8d8d8', !shorts);
        shoe.position.y = -shinLen + 0.023;
        shoe.traverse((o) => { o.userData.noTint = true; });
        kneeSkin.add(shoe);
      } else {
        hipSkin.add(mesh(clothGeo(legW * 0.69, legW * 0.88, thighLen), c.body));
        kneeSkin.add(mesh(ballGeo(legW * 0.46), c.trim));
        kneeSkin.add(mesh(clothGeo(legW * 0.86, legW * 0.42, shinLen), c.trim));
        const gaiter = mesh(limbGeo(legW * 0.48, legW * 0.39, shinLen * 0.34, 8), '#cec2aa');
        gaiter.position.y = -shinLen * 0.67;
        const foot = shoeMesh(legW, '#222222');
        foot.position.set(0, -shinLen + 0.01, 0.05);
        gaiter.userData.noTint = foot.userData.noTint = true;
        kneeSkin.add(gaiter, foot);
      }
      if (side === 1) this.collectTint('leg', hipSkin, kneeSkin);
      this.joints.set(hip, hipG);
      this.joints.set(knee, kneeG);
    };
    mkLeg(1, 'hipR', 'kneeR');
    mkLeg(-1, 'hipL', 'kneeL');

    this.dims = {
      h, foreLen, shinLen,
      tipLen: weapon.look === 'tube'
        ? weapon.bladeLength + 0.18
        : weapon.shaftLength > 0
          ? weapon.shaftLength - 0.4 + weapon.bladeLength
          : weapon.bladeLength + 0.07,
    };

    for (const j of JOINTS) this.current.set(j, new THREE.Euler());

    this.root.traverse((o) => {
      if (o.userData.dangle === undefined) return;
      const rest = o.quaternion.clone();
      this.danglers.push({
        node: o, stiff: o.userData.dangle, rest,
        restDir: DOWN.clone().applyQuaternion(rest),
        dir: new THREE.Vector3(), vel: new THREE.Vector3(), last: new THREE.Vector3(),
        phase: this.danglers.length * 1.7, live: false,
      });
    });
  }

  private parentQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private tmpT = new THREE.Vector3();

  /** Swing the cloth pivots (see DANGLE_*). Call after the pose is applied. */
  private updateDanglers(dt: number): void {
    if (this.danglers.length === 0 || dt <= 0) return;
    this.root.updateMatrixWorld(true);
    for (const d of this.danglers) {
      d.node.parent!.getWorldQuaternion(this.parentQ);
      const pos = d.node.getWorldPosition(this.tmpV);
      const restWorld = this.tmpT.copy(d.restDir).applyQuaternion(this.parentQ);
      if (!d.live) {
        d.dir.copy(restWorld);
        d.vel.set(0, 0, 0);
        d.last.copy(pos);
        d.live = true;
        continue;
      }
      const v = pos.clone().sub(d.last).divideScalar(dt);
      d.last.copy(pos);
      if (v.length() > DANGLE_MAX_SPEED) v.setLength(DANGLE_MAX_SPEED);
      const target = DOWN.clone().multiplyScalar(1 - d.stiff).addScaledVector(restWorld, d.stiff)
        .addScaledVector(v, -DANGLE_DRAG);
      target.x += Math.sin(this.time * 6.3 + d.phase) * 0.04;
      target.z += Math.sin(this.time * 4.9 + d.phase * 1.3) * 0.04;
      target.normalize();
      d.vel.addScaledVector(target.sub(d.dir), DANGLE_SPRING * dt);
      d.vel.multiplyScalar(Math.exp(-DANGLE_DAMP * dt));
      d.dir.addScaledVector(d.vel, dt).normalize();
      // into parent space, keeping the rest twist around the hang axis
      const local = d.dir.clone().applyQuaternion(this.parentQ.invert());
      d.node.quaternion.setFromUnitVectors(d.restDir, local).multiply(d.rest);
    }
  }

  /** Register a limb's materials for the blood tint (skips `noTint` meshes). */
  private collectTint(limb: 'arm' | 'leg', ...skins: THREE.Group[]): void {
    for (const s of skins) {
      s.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || o.userData.noTint) return;
        const m = o.material as THREE.MeshLambertMaterial;
        this.woundMats[limb].push({ mat: m, orig: m.color.clone() });
      });
    }
  }

  /**
   * Swap the articulated body for a verlet ragdoll seeded from the
   * skeleton's current world pose, with an impulse away from the killer.
   */
  private spawnRagdoll(f: FighterState): void {
    this.root.updateWorldMatrix(true, true);
    const d = this.dims;
    const j = (n: JointName) => this.joints.get(n)!;
    const wp = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
    const lp = (o: THREE.Object3D, x: number, y: number, z: number) =>
      o.localToWorld(new THREE.Vector3(x, y, z));

    // fall away from the opponent (we die facing our killer)
    const fall = new THREE.Vector3(-Math.sin(f.facing), 0, -Math.cos(f.facing));
    const vel = (s: number) => fall.clone().multiplyScalar(2.2 * s).add(
      new THREE.Vector3((Math.random() - 0.5) * 0.7, 0.55 * s, (Math.random() - 0.5) * 0.7),
    );
    const P = (
      name: string, pos: THREE.Vector3, radius: number, s: number,
    ): RagdollParticleInit => ({ name, pos, radius, vel: vel(s) });

    const particles: RagdollParticleInit[] = [
      P('pelvis', wp(this.hips), 0.09, 0.8),
      P('neck', wp(j('head')), 0.08, 1.4),
      P('head', lp(j('head'), 0, 0.13 * d.h, 0), 0.11, 1.5),
      P('shoulderR', wp(j('shoulderR')), 0.07, 1.3),
      P('shoulderL', wp(j('shoulderL')), 0.07, 1.3),
      P('elbowR', wp(j('elbowR')), 0.05, 1.1),
      P('elbowL', wp(j('elbowL')), 0.05, 1.1),
      P('handR', wp(j('wristR')), 0.05, 1.2),
      P('handL', lp(j('elbowL'), 0, -d.foreLen, 0), 0.05, 1.2),
      P('hipR', wp(j('hipR')), 0.07, 0.7),
      P('hipL', wp(j('hipL')), 0.07, 0.7),
      P('kneeR', wp(j('kneeR')), 0.06, 0.5),
      P('kneeL', wp(j('kneeL')), 0.06, 0.5),
      P('footR', lp(j('kneeR'), 0, -d.shinLen, 0), 0.06, 0.4),
      P('footL', lp(j('kneeL'), 0, -d.shinLen, 0), 0.06, 0.4),
      P('swordTip', lp(j('wristR'), 0, -d.tipLen, 0), 0.02, 1.8),
    ];

    const sticks: [string, string][] = [
      // spine + head
      ['pelvis', 'neck'], ['neck', 'head'],
      // shoulder girdle and torso bracing
      ['neck', 'shoulderR'], ['neck', 'shoulderL'], ['shoulderR', 'shoulderL'],
      ['shoulderR', 'hipR'], ['shoulderL', 'hipL'],
      ['shoulderR', 'hipL'], ['shoulderL', 'hipR'],
      ['pelvis', 'shoulderR'], ['pelvis', 'shoulderL'],
      // pelvis girdle
      ['pelvis', 'hipR'], ['pelvis', 'hipL'], ['hipR', 'hipL'],
      // limbs
      ['shoulderR', 'elbowR'], ['elbowR', 'handR'],
      ['shoulderL', 'elbowL'], ['elbowL', 'handL'],
      ['hipR', 'kneeR'], ['kneeR', 'footR'],
      ['hipL', 'kneeL'], ['kneeL', 'footL'],
      // the blade stays in the death grip
      ['handR', 'swordTip'],
    ];

    // Each segment carries clones of the living skins. Segment +Y runs a→b;
    // limbs hang along -Y from their joint, so they're flipped to point at b.
    const seg = (a: string, b: string, parts: [SkinName, number][], flip: boolean): RagdollSegmentInit => {
      const carrier = new THREE.Group();
      for (const [name, offsetY] of parts) {
        const c = deepClone(this.skins.get(name)!);
        c.position.y = offsetY;
        if (flip) c.rotation.x = Math.PI;
        carrier.add(c);
      }
      return { a, b, mode: 'start', mesh: carrier };
    };
    const segments: RagdollSegmentInit[] = [
      seg('pelvis', 'neck', [['hips', 0], ['torso', 0.09 * d.h]], false),
      seg('neck', 'head', [['head', 0]], false),
      seg('shoulderR', 'elbowR', [['shoulderR', 0]], true),
      seg('elbowR', 'handR', [['elbowR', 0]], true),
      seg('shoulderL', 'elbowL', [['shoulderL', 0]], true),
      seg('elbowL', 'handL', [['elbowL', 0]], true),
      seg('hipR', 'kneeR', [['hipR', 0]], true),
      seg('kneeR', 'footR', [['kneeR', 0]], true),
      seg('hipL', 'kneeL', [['hipL', 0]], true),
      seg('kneeL', 'footL', [['kneeL', 0]], true),
      seg('handR', 'swordTip', [['wristR', 0]], true),
    ];

    this.ragdoll = new Ragdoll(particles, sticks, segments, this.liveObstacles, this.breakables);
    (this.root.parent as THREE.Object3D).add(this.ragdoll.group);
    this.body.visible = false;
  }

  private targetFor(f: FighterState): { pose: Pose; rate: number } {
    switch (f.phase) {
      case 'windup':   return { pose: movePoses[f.move!.line].windup, rate: 9 };
      case 'active':   return { pose: movePoses[f.move!.line].active, rate: 34 };
      case 'recovery': return { pose: movePoses[f.move!.line].recovery, rate: 5 };
      case 'parry':    return { pose: parryPose, rate: 30 };
      case 'stagger':  return { pose: staggerPose, rate: 14 };
      case 'flinch':   return { pose: staggerPose, rate: 20 };
      case 'lock':     return { pose: lockPose, rate: 22 };
      default:         return { pose: stancePoses[f.stance], rate: 10 };
    }
  }

  private liveObstacles: Obstacle[] = [];
  /** Glass the corpse can go through (the shop window), shared with the scene. */
  breakables: Breakable[] = [];
  private shadowPos = new THREE.Vector3();

  update(f: FighterState, dt: number, liveObstacles?: Obstacle[]): void {
    this.liveObstacles = liveObstacles ?? this.obstacles;
    this.time += dt;
    if (f.phase === 'dead') {
      if (!this.ragdoll) {
        this.root.position.set(f.pos.x, 0, f.pos.z);
        this.spawnRagdoll(f);
      }
      this.ragdoll!.step(dt);
      // the shadow slides along under the falling pelvis
      this.shadowPos.copy(this.ragdoll!.getPos('pelvis'));
      this.root.worldToLocal(this.shadowPos);
      this.shadow.position.set(this.shadowPos.x, 0.004, this.shadowPos.z);
      return;
    }
    if (this.ragdoll) {
      this.ragdoll.dispose();
      this.ragdoll = null;
      this.body.visible = true;
      this.shadow.position.set(0, 0.004, 0);
      for (const d of this.danglers) d.live = false; // reseed after the respawn
    }

    this.root.position.set(f.pos.x, 0, f.pos.z);

    // smooth yaw
    let dy = f.facing - this.facing;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    this.facing += dy * Math.min(1, 14 * dt);
    this.root.rotation.y = this.facing;

    const target = this.targetFor(f);
    const kneeling = f.wounds.leg;
    const pose: Pose = kneeling ? { ...target.pose, ...kneelLegs } : target.pose;
    const k = 1 - Math.exp(-target.rate * dt);

    for (const j of JOINTS) {
      const cur = this.current.get(j)!;
      const t = pose[j] ?? [0, 0, 0];
      cur.x += (t[0] - cur.x) * k;
      cur.y += (t[1] - cur.y) * k;
      cur.z += (t[2] - cur.z) * k;
      this.joints.get(j)!.rotation.copy(cur);
    }

    if (f.phase === 'lock') {
      // straining: a fast tremor through the arms and shoulders
      const shake = Math.sin(this.time * 31) * 0.035 + Math.sin(this.time * 47) * 0.02;
      this.joints.get('shoulderR')!.rotation.x += shake;
      this.joints.get('shoulderL')!.rotation.x += shake;
      this.joints.get('torso')!.rotation.z += shake * 0.4;
    }

    let targetHipY = kneeling ? this.baseHipY * KNEEL_HIP_Y : this.baseHipY;
    if (f.phase === 'idle') {
      // breathing: a slow chest rise so a held guard never looks frozen
      const breath = Math.sin(this.time * 2.1);
      this.joints.get('torso')!.rotation.x += breath * 0.018;
      this.joints.get('head')!.rotation.x -= breath * 0.012;
    }
    // walkCycle only grows while travelling; a jump back is a round reset
    const travelled = f.walkCycle - this.lastWalk;
    this.lastWalk = f.walkCycle;
    const moving = travelled > 0 && travelled < 0.5 && dt > 0
      ? Math.min(1, travelled / dt / (this.char.walkSpeed * 0.3)) : 0;
    this.gait += (moving - this.gait) * Math.min(1, 10 * dt);

    this.hips.position.x = 0;
    if (f.phase === 'idle' && kneeling && this.gait > 0.01) {
      // knee-walk: the planted front foot reaches and stamps, then the
      // weight rocks onto it and the cut leg's knee is hauled in behind
      const ph = f.walkCycle * STRIDE_FREQ;
      const s = Math.sin(ph), c = Math.cos(ph), g = this.gait;
      const reach = Math.max(0, c); // front foot in the air
      const haul = Math.max(0, -c); // knee dragging up
      this.joints.get('hipL')!.rotation.x += (-reach * 0.3 + haul * 0.12) * g;
      this.joints.get('kneeL')!.rotation.x += reach * 0.25 * g;
      // the knee slides under the hip; the shin keeps its angle, so the
      // foot trails along the floor instead of flicking up
      this.joints.get('hipR')!.rotation.x += s * 0.22 * g;
      this.joints.get('kneeR')!.rotation.x -= s * 0.22 * g;
      const torso = this.joints.get('torso')!;
      torso.rotation.x += haul * 0.12 * g;  // lean in to drag
      torso.rotation.z += s * 0.09 * g;     // weight rolls side to side
      torso.rotation.y += s * 0.06 * g;
      this.joints.get('head')!.rotation.z -= s * 0.06 * g; // the head stays level-ish
      this.hips.position.x = s * 0.025 * g;
      targetHipY += haul * 0.04 * g;
    }

    // walk: leg swing with a knee kick + slight bob layered over the stance
    if (f.phase === 'idle' && !kneeling) {
      const swing = Math.sin(f.walkCycle * STRIDE_FREQ) * 0.4;
      this.joints.get('hipR')!.rotation.x += swing * 0.5;
      this.joints.get('hipL')!.rotation.x -= swing * 0.5;
      this.joints.get('kneeR')!.rotation.x += Math.max(0, swing) * 0.6;
      this.joints.get('kneeL')!.rotation.x += Math.max(0, -swing) * 0.6;
      targetHipY += Math.abs(Math.sin(f.walkCycle * STRIDE_FREQ)) * 0.015;
    }
    this.hipY += (targetHipY - this.hipY) * Math.min(1, 8 * dt);
    this.hips.position.y = this.hipY;
    this.updateDanglers(dt);

    // blood tint on wounded limbs (idempotent; restores on round reset)
    for (const limb of ['arm', 'leg'] as const) {
      if (f.wounds[limb] === this.shownWounds[limb]) continue;
      this.shownWounds[limb] = f.wounds[limb];
      for (const { mat, orig } of this.woundMats[limb]) {
        mat.color.copy(f.wounds[limb] ? WOUND_COLOR : orig);
      }
    }
  }
}
