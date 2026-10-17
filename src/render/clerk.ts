import * as THREE from 'three';
import { StageClerk } from '../sim/types';
import {
  ballGeo, faceGroup, hairGroup, handGroup, headGeo, headScale, limbGeo, mesh,
  muscleGeo, pelvisGeo, shade, sneakerGroup, teeDetails, torsoGeo,
} from './parts';

const PHONE_SECS = 5.5; // head down over the phone...
const WATCH_SECS = 2.5; // ...then a look at the duel, then back
const NECK_YAW = 1.2;

/**
 * The shop assistant behind the counter. Same part builders as the
 * fighters, one fixed pose: phone held at the chest, head down. Every few
 * seconds he looks up at the duel, then back at the phone. Render-only and
 * not a body — the sim never knows he is there; the counter is the collider.
 */
export class Clerk {
  readonly root = new THREE.Group();
  private head = new THREE.Group();
  private time = 0;
  private yaw = 0;
  private pitch = 0;
  private local = new THREE.Vector3();

  constructor(def: StageClerk) {
    const h = def.heightScale, b = def.bulk;
    this.root.position.set(def.pos[0], def.pos[1], def.pos[2]);
    this.root.rotation.y = (def.rot * Math.PI) / 180;

    const hips = new THREE.Group();
    hips.position.y = 0.95 * h;
    this.root.add(hips);
    hips.add(mesh(pelvisGeo(b, h), def.trousers));

    const legW = 0.18 * Math.sqrt(b), thighLen = 0.42 * h, shinLen = 0.4 * h;
    for (const side of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(side * 0.1 * b, -0.06 * h, 0);
      hip.rotation.z = side * 0.04; // weight on both feet, slouched
      hips.add(hip);
      hip.add(mesh(limbGeo(legW * 0.62, legW * 0.5, thighLen, 9), def.trousers));
      const knee = new THREE.Group();
      knee.position.y = -thighLen;
      hip.add(knee);
      knee.add(mesh(ballGeo(legW * 0.5), def.trousers));
      knee.add(mesh(limbGeo(legW * 0.5, legW * 0.46, shinLen * 0.92, 9), def.trousers));
      const shoe = sneakerGroup(legW, '#d8d2c4', false);
      shoe.position.y = -shinLen + 0.023;
      knee.add(shoe);
    }

    const torso = new THREE.Group();
    torso.position.y = 0.09 * h;
    torso.rotation.x = 0.12; // hunched over the phone
    hips.add(torso);
    const torsoH = 0.44 * h;
    const dims = { h, b, belly: 1, chest: 0.9, shoulders: 0.95, height: torsoH };
    torso.add(mesh(torsoGeo(dims), def.shirt), teeDetails(dims, def.shirt));
    // polo collar points and a name badge
    for (const side of [-1, 1]) {
      const point = mesh(new THREE.BoxGeometry(0.05, 0.012, 0.04), shade(def.shirt, 0.85));
      point.position.set(side * 0.035, torsoH * 0.97, 0.075 * b);
      point.rotation.set(0.6, 0, side * 0.5);
      torso.add(point);
    }
    const badge = mesh(new THREE.BoxGeometry(0.06, 0.025, 0.006), '#ece6da');
    badge.position.set(-0.07 * b, torsoH * 0.76, 0.13 * b);
    torso.add(badge);
    const neckLen = 0.04 * h;
    const neck = mesh(limbGeo(0.042, 0.047, neckLen + 0.03, 8), def.skin);
    neck.position.y = torsoH + neckLen + 0.01;
    torso.add(neck);

    const headR = 0.112, shape = def.head ?? 'round';
    this.head.position.y = torsoH + neckLen;
    torso.add(this.head);
    const centre = new THREE.Group();
    centre.position.y = headR * headScale(shape).sy + 0.01;
    this.head.add(centre);
    centre.add(mesh(headGeo(shape, headR), def.skin));
    centre.add(faceGroup(shape, headR, def.skin, def.hair, { nose: 0.9, beard: false, eyes: true, glasses: false }));
    centre.add(hairGroup(def.hairStyle ?? 'messy', def.hair, headR, shape));

    // arms bent up to hold the phone in front of the chest
    const armW = 0.12 * Math.sqrt(b), upperLen = 0.3 * h, foreLen = 0.28 * h;
    const hands: THREE.Object3D[] = [];
    for (const side of [1, -1] as const) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * 0.2 * b * 0.95, torsoH * 0.9, 0);
      shoulder.rotation.set(-0.2, -side * 0.55, -side * 0.08); // forearms turn in to meet
      torso.add(shoulder);
      shoulder.add(mesh(ballGeo(armW * 0.64), def.shirt));
      shoulder.add(mesh(limbGeo(armW * 0.66, armW * 0.8, upperLen * 0.5, 9), def.shirt));
      shoulder.add(mesh(muscleGeo(armW * 0.38, armW * 0.42, armW * 0.34, upperLen, 0.45), def.skin));
      const elbow = new THREE.Group();
      elbow.position.y = -upperLen;
      elbow.rotation.x = -1.7;
      shoulder.add(elbow);
      elbow.add(mesh(ballGeo(armW * 0.38), def.skin));
      elbow.add(mesh(muscleGeo(armW * 0.36, armW * 0.4, armW * 0.28, foreLen, 0.28), def.skin));
      const hand = handGroup(armW, def.skin, side);
      hand.position.y = -foreLen;
      elbow.add(hand);
      hands.push(hand);
    }
    // the phone sits between the hands, screen tilted up at his face
    this.root.updateMatrixWorld(true);
    const mid = new THREE.Vector3();
    for (const hand of hands) mid.add(torso.worldToLocal(hand.getWorldPosition(new THREE.Vector3())));
    mid.multiplyScalar(0.5);
    const phone = mesh(new THREE.BoxGeometry(0.075, 0.14, 0.012), '#16181d');
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.062, 0.12),
      new THREE.MeshBasicMaterial({ color: '#9fc8ef' }),
    );
    screen.position.z = 0.0065;
    phone.add(screen);
    phone.position.copy(mid).add(new THREE.Vector3(0, 0.03, 0.01));
    phone.rotation.x = -1.0;
    torso.add(phone);
  }

  /** Idle loop: phone, glance at `watch` (world point), phone again. */
  update(dt: number, watch: THREE.Vector3): void {
    this.time += dt;
    const watching = this.time % (PHONE_SECS + WATCH_SECS) > PHONE_SECS;
    let yaw = 0, pitch = 0.5;
    if (watching) {
      this.local.copy(watch);
      this.root.worldToLocal(this.local);
      yaw = THREE.MathUtils.clamp(Math.atan2(this.local.x, this.local.z), -NECK_YAW, NECK_YAW);
      pitch = -0.05;
    }
    const k = 1 - Math.exp(-6 * dt);
    this.yaw += (yaw - this.yaw) * k;
    this.pitch += (pitch - this.pitch) * k;
    this.head.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
