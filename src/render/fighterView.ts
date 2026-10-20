import * as THREE from 'three';
import { effWindup } from '../sim/sim';
import { CharacterDef, FighterState, Line, Obstacle, WeaponDef } from '../sim/types';
import {
  bowPose, cutPoses, feintPose, hurlPoses, JointName, kneelLegs, lockPose, parryPose, pickupPose, Pose, staggerPose,
  stancePoses, throwPoses, unarmedPose,
} from './poses';
import { CutAnim, CutPose, CutStageName, cutPose, cutsFor, KNOCKED, keyValues, reachArm, sampleCut, stageStart } from './cuts';
import { Trail } from './trail';
import { BladeAvoider, BladeShape, BladeWorld, Rod, clipLength, crossSide } from './bladeAvoid';
import { Feet, FootMode, Leg } from './gait';
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

// The kneeling knee-walk's cycle per m of travel; a knee-drag scuff at each
// extreme of sin(walkCycle * STRIDE_FREQ). Standing, the feet step for
// themselves (gait.ts) and count their own footfalls.
const STRIDE_FREQ = 5.2;
const strideIndex = (walkCycle: number): number => Math.floor((walkCycle * STRIDE_FREQ - Math.PI / 2) / Math.PI);
// Pelvis height kneeling on the cut leg, as a fraction of standing
const KNEEL_HIP_Y = 0.585;
// …and stooping for a dropped weapon
const PICKUP_HIP_Y = 0.72;
// Sidestep body language (radians at full step; the dip is a fraction of hip height)
const SIDE_TURN = 0.45;
const SIDE_LEAN = 0.16;
const SIDE_SPLAY = 0.3;
const SIDE_DIP = 0.08;
// Weapon avoidance (bladeAvoid.ts): how fast the weapon turns out of the
// way and back (per s), and how far a broom's bristles may press into the floor
const AVOID_IN = 16;
const AVOID_OUT = 8;
const FLOOR_SINK = 0.06;
// The skins the opponent's weapon stays out of: not the arms — the blades
// cross in front of the hands in every guard
const BODY_SKINS: SkinName[] = ['hips', 'torso', 'head', 'hipR', 'kneeR', 'hipL', 'kneeL'];
// Phases whose weapon holds its line when the two weapons meet; the other
// one gives way (a cut stops on a guard). Even → the longer weapon gives.
const HOLDS: ReadonlySet<string> = new Set(['idle', 'parry', 'lock']);
// Cuts (cuts.ts): the strike is the wind-up's last frames — the sim's lunge
// tail — so the weapon arrives by the first active tick, when a cut lands
const STRIKE_FRAMES = 6;
const CUT_PHASES: ReadonlySet<string> = new Set(['windup', 'active', 'recovery']);
const CUT_OUT = 14; // 1/s the cut layer hands back to the pose after a cut…
const CUT_KNOCKED = 30; // …and when it's cut short (deflected, parried, locked, struck): the weapon is knocked away
const KNOCK_RATE = 18;  // 1/s the weapon flies out to KNOCKED (a stagger, a flinch)
const KNOCKED_POSE = keyValues(KNOCKED, cutPose());
// Phases the off hand holds the haft in (by IK); elsewhere it's posed free
const TWO_HANDED: ReadonlySet<string> = new Set(['idle', 'windup', 'active', 'recovery', 'feint', 'parry', 'lock', 'sidestep']);
const GRIP_RATE = 12;
const HOLD_REACH = 0.97; // of the arm's length: the furthest the off hand reaches for its grip…
const HOLD_PULL = 0.15;  // …and m the weapon hand comes in, at most, to bring it there
// Where the elbows point (torso frame): out to the side, down, a little back
const POLE_R = new THREE.Vector3(0.75, -0.6, -0.3).normalize();
const POLE_L = new THREE.Vector3(-0.75, -0.6, -0.3).normalize();

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
 * exponentially damped each frame; cuts and the knocked-wide stagger are
 * laid over them in weapon space (cuts.ts), the legs are IK'd to planted
 * feet (gait.ts) and the off hand to the haft.
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
  private feet!: Feet;
  private lastStride = 0;
  /** Footfalls since main last played them (the step sound). */
  footfalls = 0;
  private woundMats = {
    arm: [] as { mat: THREE.MeshLambertMaterial; orig: THREE.Color }[],
    leg: [] as { mat: THREE.MeshLambertMaterial; orig: THREE.Color }[],
  };
  private shownWounds = { arm: false, leg: false };
  private shadow: THREE.Mesh;
  private ragdoll: Ragdoll | null = null;
  private danglers: Dangler[] = [];
  private dims!: {
    h: number; upperLen: number; foreLen: number; shinLen: number;
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
    const legs: Leg[] = [];
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
        legs.push({ hip: hipG, knee: kneeG, shoe });
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
        legs.push({ hip: hipG, knee: kneeG, shoe: foot });
      }
      if (side === 1) this.collectTint('leg', hipSkin, kneeSkin);
      this.joints.set(hip, hipG);
      this.joints.set(knee, kneeG);
    };
    mkLeg(1, 'hipR', 'kneeR');
    mkLeg(-1, 'hipL', 'kneeL');
    this.feet = new Feet(this.hips, legs, thighLen, shinLen);

    // the weapon line through the grip, for keeping it out of the furniture
    const shaft = weapon.shaftLength - 0.4;
    this.blade = weapon.look === 'tube'
      ? { back: 0.12, fwd: bl + 0.18, r: 0.04, rods: [{ from: -0.12, to: bl + 0.18, r: 0.03 }] }
      : weapon.shaftLength > 0
        ? {
          back: 0.4, fwd: shaft + bl, r: 0.06,
          rods: [{ from: -0.4, to: shaft, r: 0.018 }, { from: shaft, to: shaft + bl, r: weapon.look === 'broom' ? 0.05 : 0.02 }],
        }
        : { back: 0.17, fwd: bl + 0.07, r: 0.03, rods: [{ from: -0.17, to: bl + 0.07, r: 0.02 }] };
    this.rodPool = this.blade.rods.map((p) => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), r: p.r }));

    this.dims = {
      h, upperLen, foreLen, shinLen,
      tipLen: weapon.look === 'tube'
        ? weapon.bladeLength + 0.18
        : weapon.shaftLength > 0
          ? weapon.shaftLength - 0.4 + weapon.bladeLength
          : weapon.bladeLength + 0.07,
    };

    for (const j of JOINTS) this.current.set(j, new THREE.Euler());

    // cuts: the arcs for this weapon, and each guard in the same terms (a
    // recovery ends on one; a cut seen from its middle starts from one)
    this.cuts = cutsFor(weapon.look, weapon.shaftLength > 0);
    for (const line of ['high', 'mid', 'low'] as const) {
      for (const j of JOINTS) this.joints.get(j)!.rotation.set(...(stancePoses[line][j] ?? [0, 0, 0]));
      this.measureCut(this.guards[line]);
    }
    for (const j of JOINTS) this.joints.get(j)!.rotation.set(0, 0, 0);
    // the off hand holds the haft this far behind the weapon hand: at the
    // tube's end (hands together, as on a hilt), at the broom's butt
    this.grip = weapon.shaftLength > 0 ? 0.32 : 0.11;
    const tip = this.dims.tipLen;
    this.trail = new Trail(weapon.shaftLength > 0 ? tip - weapon.bladeLength - 0.3 : tip * 0.3, tip, '#dfe6ff');

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

  // cuts (cuts.ts)
  private cuts!: Record<Line, CutAnim>;
  private guards: Record<Line, CutPose> = { high: cutPose(), mid: cutPose(), low: cutPose() };
  private cutFrom = cutPose();  // where this cut's wind-up started
  private cutStart = cutPose(); // where the current stage started
  private cutNow = cutPose();   // this frame's (held while it hands back)
  private cutW = 0;             // 1 in a cut, easing to 0 after
  private gripW = 0;            // the off hand on the haft, eased
  private grip = 0.11;
  private trail!: Trail;
  private snapping = false;
  // the cut's clock: the sim's phase and frame, and how far past that frame
  // the picture is (frozen in a hitstop, slowed in the replay)
  private clockPhase = '';
  private clockFrame = -1;
  private clockFrac = 0;
  private cutQ = new THREE.Quaternion();
  private cutQ2 = new THREE.Quaternion();
  private ikQ = new THREE.Quaternion();
  private cutE = new THREE.Euler();
  private cutD = new THREE.Vector3();
  private baseQ = [new THREE.Quaternion(), new THREE.Quaternion(), new THREE.Quaternion()];

  /** The joints as they stand, in the terms of a cut (cuts.ts). */
  private measureCut(out: CutPose): CutPose {
    this.root.updateMatrixWorld(true);
    const torso = this.joints.get('torso')!, head = this.joints.get('head')!, wrist = this.joints.get('wristR')!;
    const hand = torso.worldToLocal(wrist.getWorldPosition(this.tmpV));
    const dir = torso.worldToLocal(wrist.localToWorld(this.tmpT.set(0, -1, 0))).sub(hand).normalize();
    const A = this.dims.upperLen + this.dims.foreLen;
    const sy = this.joints.get('shoulderR')!.position.y;
    out[0] = hand.x / A; out[1] = (hand.y - sy) / A; out[2] = hand.z / A;
    out[3] = dir.x; out[4] = dir.y; out[5] = dir.z;
    out[6] = torso.rotation.x; out[7] = torso.rotation.y; out[8] = torso.rotation.z;
    out[9] = head.rotation.x; out[10] = head.rotation.y; out[11] = head.rotation.z;
    return out;
  }

  /** Which stage of a cut `f` is in, and how far (null outside a cut). */
  private cutStage(f: FighterState): { stage: CutStageName; t: number } | null {
    if (!f.armed || !f.move) return null;
    const p = f.phaseFrame + this.clockFrac;
    switch (f.phase) {
      case 'windup': {
        const w = effWindup(f, f.move);
        const s = Math.min(STRIKE_FRAMES, Math.floor(w / 2));
        return p < w - s ? { stage: 'windup', t: p / (w - s) } : { stage: 'strike', t: (p - (w - s)) / s };
      }
      case 'active': return { stage: 'active', t: p / f.move.active };
      case 'recovery': return { stage: 'recovery', t: p / f.move.recovery };
      default: return null;
    }
  }

  /** Lay the cut `p` over the pose by `w`: torso, head, and the weapon arm by IK, the wrist aiming the weapon. */
  private applyCut(p: CutPose, w: number): void {
    const { upperLen: U, foreLen: F } = this.dims;
    const torso = this.joints.get('torso')!, head = this.joints.get('head')!;
    torso.quaternion.slerp(this.cutQ.setFromEuler(this.cutE.set(p[6], p[7], p[8])), w);
    head.quaternion.slerp(this.cutQ.setFromEuler(this.cutE.set(p[9], p[10], p[11])), w);
    const arm = [this.joints.get('shoulderR')!, this.joints.get('elbowR')!, this.joints.get('wristR')!];
    arm.forEach((j, i) => this.baseQ[i].copy(j.quaternion));
    const [sh, el, wr] = arm;
    const A = U + F;
    reachArm(sh, el, U, F, this.tmpV.set(p[0] * A, sh.position.y + p[1] * A, p[2] * A), POLE_R);
    // the wrist turns the weapon from the forearm's line onto `dir`, the least turn
    const fore = this.cutQ.multiplyQuaternions(sh.quaternion, el.quaternion);
    const along = this.tmpT.set(0, -1, 0).applyQuaternion(fore);
    const aim = this.cutQ2.setFromUnitVectors(along, this.cutD.set(p[3], p[4], p[5]));
    wr.quaternion.copy(fore).invert().multiply(aim).multiply(fore);
    arm.forEach((j, i) => {
      this.ikQ.copy(j.quaternion);
      j.quaternion.copy(this.baseQ[i]).slerp(this.ikQ, w);
    });
  }

  /**
   * Two hands on one weapon: where the off hand's grip is out of its arm's
   * reach (Panzer's short arms in every guard), the weapon hand comes in
   * toward the off shoulder by the difference — the weapon keeps its angle.
   * Before the weapon avoidance, so what it publishes is where the weapon is.
   */
  private bringHandsTogether(f: FighterState, dt: number): void {
    const want = f.armed && TWO_HANDED.has(f.phase) ? 1 : 0;
    this.gripW += (want - this.gripW) * Math.min(1, GRIP_RATE * dt);
    if (this.gripW < 0.01) return;
    this.root.updateMatrixWorld(true);
    const torso = this.joints.get('torso')!, wrist = this.joints.get('wristR')!;
    const hand = torso.worldToLocal(wrist.getWorldPosition(this.tmpV));
    const at = torso.worldToLocal(wrist.localToWorld(this.tmpT.set(0, this.grip, 0)));
    const sh = this.joints.get('shoulderL')!;
    const dist = at.distanceTo(sh.position), reach = (this.dims.upperLen + this.dims.foreLen) * HOLD_REACH;
    if (dist <= reach) return;
    // (bounded: letting go, the off hand's grip flies wide with the pose)
    const pull = Math.min(dist - reach, HOLD_PULL) * this.gripW;
    hand.addScaledVector(at.sub(sh.position), -pull / dist);
    // re-reach the weapon hand, the weapon held as it was
    const shR = this.joints.get('shoulderR')!, elR = this.joints.get('elbowR')!;
    const held = this.cutQ2.multiplyQuaternions(shR.quaternion, elR.quaternion).multiply(wrist.quaternion);
    reachArm(shR, elR, this.dims.upperLen, this.dims.foreLen, hand, POLE_R);
    wrist.quaternion.multiplyQuaternions(shR.quaternion, elR.quaternion).invert().multiply(held);
  }

  /** The off hand onto the haft (IK), behind the weapon hand as the weapon is shown. */
  private gripHaft(): void {
    if (this.gripW < 0.01) return;
    this.root.updateMatrixWorld(true);
    const torso = this.joints.get('torso')!, wrist = this.joints.get('wristR')!;
    const hand = wrist.getWorldPosition(this.tmpV);
    const along = wrist.localToWorld(this.tmpT.set(0, -this.grip, 0)).sub(hand);
    const target = torso.worldToLocal(hand.sub(along));
    const sh = this.joints.get('shoulderL')!, el = this.joints.get('elbowL')!;
    this.baseQ[0].copy(sh.quaternion);
    this.baseQ[1].copy(el.quaternion);
    reachArm(sh, el, this.dims.upperLen, this.dims.foreLen, target, POLE_L);
    [sh, el].forEach((j, i) => {
      this.ikQ.copy(j.quaternion);
      j.quaternion.copy(this.baseQ[i]).slerp(this.ikQ, this.gripW);
    });
  }

  /** The swoosh: sampled through the strike and the cut, aged by the cut's clock. */
  private updateTrail(f: FighterState, cut: { stage: CutStageName; t: number } | null, adv: number): void {
    if (!this.trail.mesh.parent && this.root.parent) this.root.parent.add(this.trail.mesh);
    const swinging = cut !== null && (
      (cut.stage === 'strike' && cut.t > 0.15) || cut.stage === 'active' || (cut.stage === 'recovery' && cut.t < 0.1));
    if (swinging && f.armed) {
      this.root.updateMatrixWorld(true);
      const wrist = this.joints.get('wristR')!;
      const hand = wrist.getWorldPosition(this.tmpV);
      const dir = wrist.localToWorld(this.tmpT.set(0, -1, 0)).sub(hand).normalize();
      this.trail.push(hand, dir);
    }
    this.trail.update(adv);
  }

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

  /**
   * Turn the weapon about the hand, out of any furniture, wall, floor,
   * ceiling, opponent's body or opponent's weapon the pose put it into
   * (bladeAvoid.ts), then publish it as `rods`.
   * Render only: the sim's blade is the reach/arc wedge, and a cut into
   * furniture already rebounds there.
   */
  private avoidBlade(f: FighterState, dt: number, rate: number): void {
    const wrist = this.joints.get('wristR')!;
    const goal = this.avoidGoal.identity();
    this.root.updateMatrixWorld(true);
    const hand = wrist.getWorldPosition(this.handPos);
    const d = wrist.localToWorld(this.bladeDir.set(0, -1, 0)).sub(hand).normalize();
    this.holds = HOLDS.has(f.phase);
    this.rods.length = 0;
    const opp = this.opponent;
    let gives = false;
    if (f.armed) {
      const reach = Math.max(this.blade.back, this.blade.fwd) + this.blade.r;
      const boxes = this.bladeBoxes;
      boxes.length = 0;
      const near = (ob: Obstacle) =>
        Math.hypot(ob.x - hand.x, ob.z - hand.z) < reach + Math.hypot(ob.halfW, ob.halfD);
      for (const ob of this.liveObstacles) {
        // a cut knocks cardboard flat rather than stopping on it
        if (ob.knockable && f.phase === 'active') continue;
        if (near(ob)) boxes.push(ob);
      }
      for (const b of this.breakables) if (!b.solid && !b.broken && near(b.ob)) boxes.push(b.ob);
      this.forward.set(Math.sin(this.facing), 0, Math.cos(this.facing));
      // a landing cut stops at the skin instead of passing through; where
      // the weapons meet, one gives way to the other
      gives = opp !== null && (opp.holds !== this.holds ? opp.holds
        : opp.blade.fwd !== this.blade.fwd ? this.blade.fwd > opp.blade.fwd : this.serial > opp.serial);
      this.avoider.solve(hand, d, this.forward, this.blade, {
        boxes, bodies: opp?.hull ?? [], rods: gives ? opp!.rods : [], rodSide: this.rodSide,
        floor: -FLOOR_SINK, ceiling: this.ceiling,
      }, goal);
    }
    const out = goal.w > 0.99999;
    this.avoidQ.slerp(goal, 1 - Math.exp(-(out ? AVOID_OUT : Math.max(AVOID_IN, rate)) * dt));
    if (gives) {
      // a swinging weapon outruns the ease: where easing would leave this
      // one inside the other, it's knocked straight to the goal
      this.rodWorld.rods = opp!.rods;
      this.rodWorld.rodSide = this.rodSide;
      const shown = this.tmpT.copy(d).applyQuaternion(this.avoidQ);
      if (clipLength(hand, shown, this.blade, this.rodWorld) > 0) this.avoidQ.copy(goal);
    }
    this.rodSide = 0;
    if (f.armed) {
      // the weapon as shown, for the opponent's weapon to meet
      d.applyQuaternion(this.avoidQ);
      if (opp) this.rodSide = crossSide(hand, d, this.blade, opp.rods);
      this.blade.rods.forEach((p, i) => {
        const rod = this.rodPool[i];
        rod.a.copy(hand).addScaledVector(d, p.from);
        rod.b.copy(hand).addScaledVector(d, p.to);
        this.rods.push(rod);
      });
    }
    if (this.avoidQ.w > 0.99999) return;
    // a world turn about the hand, in the wrist's parent space
    this.turnJoint(wrist, this.avoidQ);
    if (f.phase === 'throw') return; // the off hand is busy with a cartridge
    // the off hand follows the haft: swing that arm so the hand lands where
    // the turn carried its grip
    const sh = this.joints.get('shoulderL')!;
    const s = sh.getWorldPosition(this.tmpV);
    const grip = this.joints.get('elbowL')!.localToWorld(this.tmpT.set(0, -this.dims.foreLen, 0));
    const moved = this.bladeDir.copy(grip).sub(hand).applyQuaternion(this.avoidQ).add(hand).sub(s).normalize();
    this.turnJoint(sh, this.avoidGoal.setFromUnitVectors(grip.sub(s).normalize(), moved));
  }

  /**
   * Refresh `hull`: each of `BODY_SKINS` as the box around its meshes in
   * the fighter's own (yawed) frame — so it leans, steps and kneels with
   * the pose. Dangling cloth is left out. Needs this frame's world matrices.
   */
  private updateHull(): void {
    this.rootInv.copy(this.root.matrixWorld).invert();
    const c = Math.cos(this.facing), s = Math.sin(this.facing);
    const root = this.root.position;
    const add = (o: THREE.Object3D): void => {
      if (o.userData.dangle !== undefined) return;
      if (o instanceof THREE.Mesh) {
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        this.meshToRoot.multiplyMatrices(this.rootInv, o.matrixWorld);
        this.skinBox.union(this.meshBox.copy(o.geometry.boundingBox!).applyMatrix4(this.meshToRoot));
      }
      for (const ch of o.children) add(ch);
    };
    this.hull.length = 0;
    BODY_SKINS.forEach((name, i) => {
      this.skinBox.makeEmpty();
      add(this.skins.get(name)!);
      const { min, max } = this.skinBox;
      const lx = (min.x + max.x) / 2, lz = (min.z + max.z) / 2;
      const ob = this.bodyPool[i];
      ob.x = root.x + lx * c + lz * s;
      ob.z = root.z - lx * s + lz * c;
      ob.halfW = (max.x - min.x) / 2;
      ob.halfD = (max.z - min.z) / 2;
      ob.y0 = min.y;
      ob.y1 = max.y;
      ob.c = c;
      ob.s = s;
      this.hull.push(ob);
    });
  }

  /** Apply world rotation `q` to joint `j` (about its own pivot). */
  private turnJoint(j: THREE.Object3D, q: THREE.Quaternion): void {
    const pq = j.parent!.getWorldQuaternion(this.parentQ);
    j.quaternion.premultiply(pq).premultiply(q).premultiply(pq.invert());
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
      // a chained cut has less time to wind up: snap into it
      // (the arms are the cut's, cuts.ts: these place the feet)
      case 'windup':
        return effWindup(f, f.move!) - f.phaseFrame > STRIKE_FRAMES
          ? { pose: cutPoses[f.move!.line].windup, rate: f.chain > 0 ? 15 : 9 }
          : { pose: cutPoses[f.move!.line].lunge, rate: 20 };
      case 'active':   return { pose: cutPoses[f.move!.line].lunge, rate: 20 };
      case 'recovery':
        return f.phaseFrame < f.move!.recovery / 2
          ? { pose: cutPoses[f.move!.line].lunge, rate: 20 }
          : { pose: stancePoses[f.stance], rate: 6 };
      case 'feint':    // reined in, then settling into the (maybe new) guard
        return f.phaseFrame < this.feintRecovery / 2
          ? { pose: feintPose, rate: 22 }
          : { pose: stancePoses[f.stance], rate: 12 };
      case 'parry':    return { pose: parryPose, rate: 30 };
      case 'stagger':  return { pose: staggerPose, rate: 14 };
      case 'flinch':   return { pose: staggerPose, rate: 20 };
      case 'lock':     return { pose: lockPose, rate: 22 };
      case 'bow':      return { pose: bowPose, rate: 5 };
      case 'pickup':   return { pose: pickupPose, rate: 12 };
      case 'hurl':
        return f.phaseFrame < this.hurlWindup
          ? { pose: hurlPoses.windup, rate: 9 }
          : { pose: hurlPoses.release, rate: 30 };
      case 'throw':
        return f.phaseFrame < this.throwWindup
          ? { pose: throwPoses.windup, rate: 14 }
          : { pose: throwPoses.release, rate: 32 };
      default:         return { pose: f.armed ? stancePoses[f.stance] : unarmedPose, rate: 10 };
    }
  }

  private liveObstacles: Obstacle[] = [];
  /** Glass the corpse can go through (the shop window), shared with the scene. */
  breakables: Breakable[] = [];
  /** Frames a throw holds the cartridge before letting go (rules.json `carts.windup`). */
  throwWindup = 12;
  /** Frames a weapon throw winds up before letting go (rules.json `hurl.windup`). */
  hurlWindup = 20;
  /** Frames a feint takes to come back to guard (rules.json `feint.recovery`). */
  feintRecovery = 14;
  /** Frames a sidestep travels for (rules.json `sidestep.move`). */
  sidestepMove = 10;
  private sideLean = 0; // -1 stepping left … 1 right, eased
  /** Room height: the weapon stays under it (Infinity without walls). */
  ceiling = Infinity;
  private blade!: BladeShape;
  private avoider = new BladeAvoider();
  private avoidQ = new THREE.Quaternion(); // eased world turn about the hand
  private avoidGoal = new THREE.Quaternion();
  private bladeBoxes: Obstacle[] = [];
  private handPos = new THREE.Vector3();
  private bladeDir = new THREE.Vector3();
  private forward = new THREE.Vector3();
  /** The other fighter: its body is one more thing this weapon stays out of. */
  opponent: FighterView | null = null;
  /** This body as yawed boxes (one per `BODY_SKINS`, as posed last frame); empty once dead. */
  hull: Obstacle[] = [];
  /** This weapon as posed last frame (capsules along it); empty unarmed or dead. */
  rods: Rod[] = [];
  /** Whether this weapon holds its line where the weapons meet (`HOLDS`). */
  holds = false;
  private rodPool: Rod[];
  private rodWorld: BladeWorld = { boxes: [], bodies: [], rods: [], rodSide: 0, floor: -Infinity, ceiling: Infinity };
  private rodSide = 0; // which side of the opponent's weapon this one was on (crossSide)
  private serial = FighterView.count++;
  private static count = 0;
  private bodyPool: Obstacle[] = BODY_SKINS.map(() => ({ x: 0, z: 0, halfW: 0, halfD: 0, y0: 0, y1: 0, c: 1, s: 0 }));
  private rootInv = new THREE.Matrix4();
  private meshToRoot = new THREE.Matrix4();
  private skinBox = new THREE.Box3();
  private meshBox = new THREE.Box3();

  /** A copy of the weapon as carried (grip at the origin, along -Y), for throwing. */
  weaponClone(): THREE.Object3D {
    const w = deepClone(this.skins.get('wristR')!);
    w.visible = true;
    return w;
  }

  /** World position of the right hand — the weapon hand. */
  rightHand(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.joints.get('wristR')!.getWorldPosition(out);
  }

  /** World position of the left hand — the throwing hand. */
  leftHand(out: THREE.Vector3): THREE.Vector3 {
    this.root.updateMatrixWorld(true);
    return this.joints.get('elbowL')!.localToWorld(out.set(0, -this.dims.foreLen, 0));
  }
  private shadowPos = new THREE.Vector3();

  /** Jump straight to `f`'s pose (a replay cutting back in time), no blending. */
  snap(f: FighterState, liveObstacles?: Obstacle[]): void {
    for (const d of this.danglers) d.live = false; // reseed rather than spring across the cut
    this.rodSide = 0; // the weapons' sides from another moment don't hold
    this.feet.reset();
    this.trail.clear();
    this.clockPhase = ''; // a cut seen from here starts from its guard
    this.snapping = true;
    this.update(f, 1, liveObstacles);
    this.snapping = false;
  }

  update(f: FighterState, dt: number, liveObstacles?: Obstacle[]): void {
    this.liveObstacles = liveObstacles ?? this.obstacles;
    this.time += dt;
    if (f.phase === 'dead') {
      this.hull.length = 0;
      this.rods.length = 0;
      if (!this.ragdoll) {
        this.root.position.set(f.pos.x, 0, f.pos.z);
        this.spawnRagdoll(f);
      }
      this.ragdoll!.step(dt);
      this.trail.update(dt);
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
      this.feet.reset();
    }

    this.root.position.set(f.pos.x, 0, f.pos.z);
    // thrown away: the hand's empty until it's picked up (HurlView draws it meanwhile)
    this.skins.get('wristR')!.visible = f.armed;

    // smooth yaw
    let dy = f.facing - this.facing;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    this.facing += dy * Math.min(1, 14 * dt);
    this.root.rotation.y = this.facing;

    // the cut's clock (and how much cut time this frame showed)
    const was = this.clockPhase;
    let adv = dt;
    if (f.phase !== this.clockPhase || f.phaseFrame !== this.clockFrame) {
      this.clockPhase = f.phase;
      this.clockFrame = f.phaseFrame;
      this.clockFrac = 0;
    } else {
      const frac = Math.min(0.999, this.clockFrac + dt * 60);
      adv = (frac - this.clockFrac) / 60;
      this.clockFrac = frac;
    }
    const cut = this.cutStage(f);
    if (cut && (f.phase === 'windup' ? was !== 'windup' : !CUT_PHASES.has(was))) {
      // a cut winds up from wherever the weapon is (from its guard, seen from mid-way)
      if (f.phase === 'windup' && !this.snapping) this.measureCut(this.cutFrom);
      else this.cutFrom.splice(0, 12, ...this.guards[f.move!.line]);
    }
    // knocked wide: the cut layer takes the weapon from wherever it's shown
    const knocked = f.armed && (f.phase === 'stagger' || f.phase === 'flinch');
    if (knocked && this.cutW < 0.999) {
      this.measureCut(this.cutNow);
      this.cutW = 1;
    }

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
    if (cut) {
      const anim = this.cuts[f.move!.line], guard = this.guards[f.stance];
      stageStart(anim, cut.stage, this.cutFrom, guard, this.cutStart);
      sampleCut(anim, cut.stage, cut.t, this.cutStart, guard, this.cutNow);
      this.cutW = 1;
    } else if (knocked) {
      const k = 1 - Math.exp(-KNOCK_RATE * dt);
      for (let i = 0; i < 12; i++) this.cutNow[i] += (KNOCKED_POSE[i] - this.cutNow[i]) * k;
      const d = Math.hypot(this.cutNow[3], this.cutNow[4], this.cutNow[5]) || 1;
      for (let i = 3; i < 6; i++) this.cutNow[i] /= d;
    } else this.cutW *= Math.exp(-(f.phase === 'idle' || f.phase === 'feint' ? CUT_OUT : CUT_KNOCKED) * dt);
    if (this.cutW > 0.002) this.applyCut(this.cutNow, this.cutW);

    if (f.phase === 'lock') {
      // straining: a fast tremor through the arms and shoulders
      const shake = Math.sin(this.time * 31) * 0.035 + Math.sin(this.time * 47) * 0.02;
      this.joints.get('shoulderR')!.rotation.x += shake;
      this.joints.get('shoulderL')!.rotation.x += shake;
      this.joints.get('torso')!.rotation.z += shake * 0.4;
    }

    // sidestep (tai-sabaki): hips turned off the line, leaning into the
    // step, the trailing leg crossing behind — layered over the guard
    const side = f.phase === 'sidestep' && f.phaseFrame < this.sidestepMove
      ? Math.sign(f.dashVec.x * Math.cos(f.facing) - f.dashVec.z * Math.sin(f.facing)) : 0;
    this.sideLean += (side - this.sideLean) * Math.min(1, 18 * dt);
    const sl = this.sideLean;
    if (Math.abs(sl) > 0.01) {
      const torso = this.joints.get('torso')!;
      torso.rotation.y += sl * SIDE_TURN;
      torso.rotation.z -= sl * SIDE_LEAN;
      this.joints.get('head')!.rotation.y -= sl * SIDE_TURN * 0.8; // eyes stay on them
      this.joints.get('hipR')!.rotation.z += sl * SIDE_SPLAY;
      this.joints.get('hipL')!.rotation.z += sl * SIDE_SPLAY;
      this.joints.get('kneeR')!.rotation.x += Math.abs(sl) * 0.35;
      this.joints.get('kneeL')!.rotation.x += Math.abs(sl) * 0.35;
    }

    let targetHipY = kneeling ? this.baseHipY * KNEEL_HIP_Y : this.baseHipY;
    targetHipY *= 1 - Math.abs(sl) * SIDE_DIP;
    if (f.phase === 'pickup' && !kneeling) targetHipY *= PICKUP_HIP_Y;
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

    this.hipY += (targetHipY - this.hipY) * Math.min(1, 8 * dt);
    this.hips.position.y = this.hipY;
    if (kneeling) {
      // the knee-walk scuffs once a stride (the round reset rewinds walkCycle)
      const stride = strideIndex(f.walkCycle);
      if (stride > this.lastStride && f.phase === 'idle') this.footfalls++;
      this.lastStride = stride;
      this.feet.release();
    } else {
      // the feet stay planted and step (gait.ts) — a sidestep too, out and
      // closed; a dash carries them off the floor, a shove out of a lock drags them
      const mode: FootMode = f.phase === 'idle' && f.dashLeft > 0 ? 'glide'
        : f.phase === 'stagger' && f.dashLeft > 0 ? 'skid' : 'plant';
      // the sidestep and the shove pose their own lean
      this.feet.plan(this.root, dt, mode, mode === 'skid' || side !== 0 ? 0 : 1);
      this.footfalls += this.feet.footfalls;
      this.feet.footfalls = 0;
      this.hips.position.y -= this.feet.hipDrop;
      const torso = this.joints.get('torso')!;
      torso.rotation.x += this.feet.leanF;
      torso.rotation.z -= this.feet.leanS;
      this.joints.get('head')!.rotation.x -= this.feet.leanF * 0.6; // eyes stay on them
      this.feet.solve(this.root);
    }
    this.bringHandsTogether(f, dt);
    this.avoidBlade(f, dt, target.rate);
    this.gripHaft();
    this.updateTrail(f, cut, adv);
    this.updateHull();
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
