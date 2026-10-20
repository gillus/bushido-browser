import * as THREE from 'three';

/**
 * Planted feet — render only. Each foot stays where it was put down while
 * the body moves over it, and steps, one foot at a time, when the pose
 * wants it elsewhere: walking, turning to follow the opponent, a lunge,
 * the drift of a lock. Where it steps to is the pose's own foot placement
 * (`home`, the posed leg's ankle) carried ahead by the travel, so a guard
 * keeps its front foot in front: advancing, retreating and circling are a
 * shuffle that never crosses the feet. The legs then reach the feet with
 * two-bone IK on the hip (pitch + splay) and knee — the pose decides where
 * the feet go and how high the hips are, the IK how the knees bend.
 * `plan` places the feet (and says how far the hips must come down and how
 * the body leans), the view applies that, `solve` bends the legs.
 */
export interface Leg {
  hip: THREE.Object3D;          // pivot at the hip joint, leg hanging along -Y
  knee: THREE.Object3D;         // child of `hip`, the thigh's length below it
  shoe: THREE.Object3D | null;  // child of `knee`, kept flat on the floor
}

// plant: feet stay put and step (a sidestep too, as a lunge); glide: a dash, both feet off
// the floor, carried along; skid: shoved out of a lock, both feet dragged
export type FootMode = 'plant' | 'glide' | 'skid';

// Ankle height with the sole flat on the floor (sneakerGroup's sole)
const ANKLE_Y = 0.035;
// A planted foot keeps the pose's ankle height up to this much, the heel
// raised and the ball of the foot on the floor (the guards are poised on
// their toes); only past it do the hips come down
const HEEL_MAX = 0.06;
const FOOT_LEN = 0.14; // ankle to the ball of the foot
// Step length per leg length, straight at them or away, and sideways
// (shorter: a side shuffle opens and closes the feet)
const STEP_FWD = 0.42;
const STEP_SIDE = 0.34;
const STEP_FAST = 0.07;  // s a step takes at its quickest (a sidestep; the cadence is speed / step)…
const STEP_SLOW = 0.2;   // …and at a crawl or a correcting step
// Least gap a side shuffle keeps between the feet: they open and close,
// never cross (going forward or back they pass side by side, as in a walk)
const GAP_SIDE = 0.12;
// At full walking speed the guard's front-to-back stance draws in under the
// hips by this much (a short-legged fighter can't stride from a deep stance)
const GATHER = 0.5;
const GATHER_SPEED = 1.5; // m/s
// How far a foot may be off its spot before it steps: standing, walking
const STEP_AT_REST = 0.09;
const STEP_MOVING = 0.03;
const MOVING = 0.3;      // m/s
const LIFT = 0.3;        // swing height per m of step
const LIFT_MIN = 0.02, LIFT_MAX = 0.07;
const REACH = 0.96;      // legs never straighter than this: the hips come down instead
const DRAG_REACH = 0.99; // and past this (the hips as low as they go) the foot drags
const BOB = 0.014;       // m the hips settle at each footfall, walking at full speed
const LEAN = 0.05;       // rad of torso lean per m/s of travel, into it
const LEAN_MAX = 0.24;
const LEAN_SPRING = 110, LEAN_DAMP = 13; // lags a start, overshoots a stop a little
const GLIDE_LIFT = 0.04; // m the feet clear the floor in a dash
const GLIDE_SINK = 0.06; // m the hips crouch into it
const GLIDE_LEAD = 0.035; // s of travel the feet reach ahead of the hips (less trailing)
// Travel is measured per sim tick (the screen may run faster than the sim):
// how much of each new reading to take, and how long without one is a stop
const VEL_KEEP = 0.7;
const VEL_STOP = 0.034; // s
const SIM_TICK = 1 / 60;
const TELEPORT = 0.5;    // m in one frame: a new round, not a step
// 1/s the hips come down onto the feet, and rise again: slowly, so a walk
// that needs them low keeps them low (a crouched shuffle) rather than bouncing
const DROP_RATE = 25, RISE_RATE = 3;
const DROP_MAX = 0.22;   // of the leg's length

interface Foot {
  home: THREE.Vector3;   // where the pose puts the ankle (world)
  plant: THREE.Vector3;  // where it rests on the floor
  from: THREE.Vector3;   // where the current step left from
  at: THREE.Vector3;     // where it is this frame: the IK target
  stand: number;         // its ankle height planted (heel raised above ANKLE_Y)
  heel: number;          // the heel's rise this frame, for the shoe's pitch
  t: number;             // step progress 0..1; -1 = planted
  dur: number;
  lift: number;
}

const foot = (): Foot => ({
  home: new THREE.Vector3(), plant: new THREE.Vector3(), from: new THREE.Vector3(), at: new THREE.Vector3(),
  stand: ANKLE_Y, heel: 0, t: -1, dur: STEP_SLOW, lift: 0,
});

const smooth = (t: number): number => t * t * (3 - 2 * t);

export class Feet {
  /** Footfalls since the view's owner last took them (for the step sound). */
  footfalls = 0;
  /** How far the hips come down this frame (m): onto the feet, a long stride, a bob, a dash. */
  hipDrop = 0;
  /** Torso lean into the travel, rad: pitch (forward +) and roll (toward +x +). */
  leanF = 0;
  leanS = 0;
  private feet = [foot(), foot()];
  private vel = new THREE.Vector3();
  private last = new THREE.Vector3();
  private still = 0; // s since the root last moved
  private seeded = false;
  private swing = -1;      // the foot in the air (only one at a time)
  private glide = 0;       // 0..1 eased in and out of a dash
  private gliding = false;
  private leanVel = [0, 0];
  private drop = 0;
  private v = new THREE.Vector3();
  private w = new THREE.Vector3();
  private inv = new THREE.Matrix4();
  private legLen: number;

  constructor(private hips: THREE.Object3D, private legs: Leg[], private thigh: number, private shin: number) {
    this.legLen = thigh + shin;
  }

  /** Put the feet back where the pose wants them (a cut in time, a new round). */
  reset(): void {
    this.seeded = false;
  }

  /**
   * Places the feet for this frame (`root` posed, the hips at the pose's
   * height) and sets `hipDrop`, `leanF`, `leanS` for the view to apply.
   * `lean` scales the torso lean (0 where the pose leans by itself).
   */
  plan(root: THREE.Object3D, dt: number, mode: FootMode, lean: number): void {
    const { feet, legs, v } = this;
    root.updateMatrixWorld(true);
    for (let i = 0; i < 2; i++) legs[i].knee.localToWorld(feet[i].home.set(0, -this.shin, 0));

    // travel: the root only moves on sim ticks, so it's the distance over
    // the time since it last moved
    this.still += dt;
    const jumped = v.subVectors(root.position, this.last).length() > TELEPORT;
    if (!this.seeded || jumped) {
      this.seeded = true;
      this.vel.set(0, 0, 0);
      this.still = 0;
      this.last.copy(root.position);
      this.swing = -1;
      this.glide = 0;
      this.leanVel[0] = this.leanVel[1] = this.leanF = this.leanS = 0;
      for (const ft of feet) {
        ft.plant.set(ft.home.x, ANKLE_Y, ft.home.z);
        ft.at.copy(ft.plant);
        ft.t = -1;
      }
    } else if (v.lengthSq() > 1e-12 && this.still > 0) {
      // (after a stand, only the last tick or frame moved it)
      this.vel.lerp(v.divideScalar(Math.min(this.still, Math.max(dt, SIM_TICK))), VEL_KEEP);
      this.still = 0;
      this.last.copy(root.position);
    } else if (this.still > VEL_STOP) {
      this.vel.multiplyScalar(Math.exp(-25 * dt));
    }
    const yaw = root.rotation.y;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);  // facing
    const rx = Math.cos(yaw), rz = -Math.sin(yaw); // +x of the body
    const vF = this.vel.x * fx + this.vel.z * fz;
    const vS = this.vel.x * rx + this.vel.z * rz;
    const speed = Math.hypot(vF, vS);

    // the hips come down as far as the posed ankles hang over the floor
    // past a raised heel (the lower foot lands with the pose's bend)
    const lowest = Math.min(feet[0].home.y, feet[1].home.y);
    const sink = Math.max(0, lowest - ANKLE_Y - HEEL_MAX);
    for (const ft of feet) ft.stand = Math.max(ANKLE_Y, Math.min(ANKLE_Y + HEEL_MAX, ft.home.y - sink));

    const wasGliding = this.gliding;
    this.gliding = mode === 'glide';
    this.glide += ((this.gliding ? 1 : 0) - this.glide) * Math.min(1, 25 * dt);
    let bob = 0;
    if (mode !== 'plant') {
      // carried along with the hips, a little ahead so they don't trail
      const k = 1 - Math.exp(-30 * dt);
      for (const ft of feet) {
        ft.t = -1;
        ft.plant.x += (ft.home.x + this.vel.x * GLIDE_LEAD - ft.plant.x) * k;
        ft.plant.z += (ft.home.z + this.vel.z * GLIDE_LEAD - ft.plant.z) * k;
        ft.plant.y = ANKLE_Y;
      }
      this.swing = -1;
    } else {
      if (wasGliding) this.footfalls++; // landing out of the dash
      bob = this.step(root.position, dt, vF, vS, speed, fx, fz, rx, rz);
    }
    for (let i = 0; i < 2; i++) {
      const ft = feet[i];
      if (i === this.swing) continue; // step() placed it
      ft.at.copy(ft.plant);
      ft.at.y = ft.stand + GLIDE_LIFT * this.glide;
      ft.heel = ft.stand - ANKLE_Y;
    }

    // lean into the travel: a damped spring, so a stop rocks back through upright
    const targets = [
      Math.max(-LEAN_MAX, Math.min(LEAN_MAX, vF * LEAN * lean)),
      Math.max(-LEAN_MAX, Math.min(LEAN_MAX, vS * LEAN * lean)),
    ];
    const cur = [this.leanF, this.leanS];
    for (let a = 0; a < 2; a++) {
      this.leanVel[a] += ((targets[a] - cur[a]) * LEAN_SPRING - this.leanVel[a] * LEAN_DAMP) * Math.min(dt, 0.05);
      cur[a] += this.leanVel[a] * Math.min(dt, 0.05);
    }
    [this.leanF, this.leanS] = cur;

    // and further when a foot is out of reach of a leg REACH-straight
    let drop = sink;
    for (let i = 0; i < 2; i++) {
      const hip = legs[i].hip.getWorldPosition(v);
      const ft = feet[i];
      const d = Math.hypot(ft.at.x - hip.x, ft.at.z - hip.z);
      const reach = this.legLen * REACH;
      const up = Math.sqrt(Math.max(0, reach * reach - d * d));
      drop = Math.max(drop, hip.y - ft.at.y - up);
    }
    drop = Math.min(drop, this.legLen * DROP_MAX);
    this.drop += (drop - this.drop) * Math.min(1, (drop > this.drop ? DROP_RATE : RISE_RATE) * dt);
    this.hipDrop = this.drop + bob + GLIDE_SINK * this.glide;

    // a foot the leg can't reach even then is dragged after the hips (the
    // back foot of a sidestep, outrun by the lunge; in the air, its path)
    for (let i = 0; i < 2; i++) {
      const ft = feet[i];
      const hip = legs[i].hip.getWorldPosition(v);
      const dx = ft.at.x - hip.x, dz = ft.at.z - hip.z;
      const reach = this.legLen * DRAG_REACH, h = hip.y - this.hipDrop - ft.at.y;
      const far = Math.hypot(dx, dz) / Math.sqrt(Math.max(1e-6, reach * reach - h * h));
      if (far <= 1) continue;
      ft.at.x = hip.x + dx / far;
      ft.at.z = hip.z + dz / far;
      if (i !== this.swing) { ft.plant.x = ft.at.x; ft.plant.z = ft.at.z; }
    }
  }

  /** Stepping (plant mode): moves the foot in the air, lifts the next. Returns the bob. */
  private step(
    root: THREE.Vector3, dt: number, vF: number, vS: number, speed: number,
    fx: number, fz: number, rx: number, rz: number,
  ): number {
    const { feet } = this;
    const across = speed > 1e-3 ? Math.abs(vS) / speed : 0;
    const stepLen = this.legLen * (STEP_FWD + (STEP_SIDE - STEP_FWD) * across);
    const T = Math.max(STEP_FAST, Math.min(STEP_SLOW, stepLen / Math.max(speed, 1e-3)));

    // each foot lands half a step ahead of its spot, so it's half a step
    // behind when the other lands. Sideways, where that would bring the two
    // closer than GAP_SIDE, the leading foot lands further out and the
    // other short of its spot: the feet open and close
    const w = this.w.subVectors(feet[0].home, feet[1].home);
    const wS = w.x * rx + w.z * rz;
    const pS = Math.max(0, (Math.abs(vS) * T) / 2 - Math.max(0, Math.abs(wS) - GAP_SIDE) / 2);
    const lead = Math.sign(wS) * Math.sign(vS) >= 0 ? pS : -pS; // the foot on the +x side
    const gather = GATHER * Math.min(1, speed / GATHER_SPEED);
    const target = (i: number, rem: number, out: THREE.Vector3): THREE.Vector3 => {
      const ft = feet[i];
      const hF = (ft.home.x - root.x) * fx + (ft.home.z - root.z) * fz;
      const oF = -hF * gather;
      const oS = Math.sign(vS) * (i === 0 ? lead : -lead);
      const ahead = rem + T / 2;
      return out.set(
        ft.home.x + this.vel.x * ahead + fx * oF + rx * oS,
        ANKLE_Y,
        ft.home.z + this.vel.z * ahead + fz * oF + rz * oS,
      );
    };

    if (this.swing >= 0) {
      const ft = feet[this.swing];
      ft.dur = T; // the cadence follows the speed mid-step too
      ft.t += dt / ft.dur;
      const to = target(this.swing, Math.max(0, (1 - ft.t) * ft.dur), this.v);
      if (ft.t >= 1) {
        ft.plant.copy(to);
        ft.t = -1;
        this.swing = -1;
        this.footfalls++;
      } else {
        const e = smooth(ft.t);
        ft.at.lerpVectors(ft.from, to, e);
        ft.at.y = ft.from.y + (ft.stand - ft.from.y) * e;
        ft.heel = ft.at.y - ANKLE_Y;
        ft.at.y += ft.lift * Math.sin(Math.PI * ft.t);
      }
    }
    if (this.swing < 0) {
      // lift whichever foot is furthest off where it should land — going
      // sideways, the one on that side first, or the other crosses over it
      let best = -1, worst = speed > MOVING ? STEP_MOVING : STEP_AT_REST, score = 0;
      for (let i = 0; i < 2; i++) {
        const to = target(i, T, this.v);
        const off = Math.hypot(to.x - feet[i].plant.x, to.z - feet[i].plant.z);
        const leads = Math.sign(vS) * Math.sign(wS) * (i === 0 ? 1 : -1) > 0;
        const sc = off + (leads ? Math.abs(vS) * T : 0);
        if (off > worst && sc > score) { score = sc; best = i; }
      }
      if (best >= 0) {
        const ft = feet[best];
        const to = target(best, T, this.v);
        worst = Math.hypot(to.x - ft.plant.x, to.z - ft.plant.z);
        this.swing = best;
        ft.t = 0;
        ft.dur = T;
        ft.from.set(ft.plant.x, ft.stand, ft.plant.z);
        ft.at.copy(ft.from);
        ft.heel = ft.stand - ANKLE_Y;
        ft.lift = Math.max(LIFT_MIN, Math.min(LIFT_MAX, LIFT * worst));
      }
    }
    // the hips settle onto each landing and rise through the swing
    const k = Math.min(1, speed / 1.5);
    return this.swing >= 0 ? BOB * k * (1 - Math.sin(Math.PI * feet[this.swing].t)) : BOB * k;
  }

  /** Bends the legs to reach the feet placed by `plan` (call after moving the hips). */
  solve(root: THREE.Object3D): void {
    root.updateMatrixWorld(true);
    this.inv.copy(this.hips.matrixWorld).invert();
    const T = this.thigh, S = this.shin;
    for (let i = 0; i < 2; i++) {
      const { hip, knee, shoe } = this.legs[i];
      const ft = this.feet[i];
      // the ankle's target from the hip joint, in the pelvis frame
      const t = this.v.copy(ft.at).applyMatrix4(this.inv).sub(hip.position);
      const len = Math.min(t.length(), (T + S) * 0.999);
      // knee bend from the distance (law of cosines); the shin then hangs
      // at (0, -T - S cos κ, -S sin κ) in the thigh's frame
      const cosK = Math.max(-1, Math.min(1, (len * len - T * T - S * S) / (2 * T * S)));
      const kappa = Math.acos(cosK);
      const py = -T - S * cosK, pz = -S * Math.sin(kappa);
      // hip: splay (z) first, then pitch (x) — Euler XYZ applies Rz innermost
      const b = Math.asin(Math.max(-1, Math.min(1, t.x / -py)));
      const Y = py * Math.cos(b);
      let a = Math.atan2(t.z, t.y) - Math.atan2(pz, Y);
      if (a > Math.PI) a -= 2 * Math.PI;
      if (a < -Math.PI) a += 2 * Math.PI;
      hip.rotation.x = a;
      hip.rotation.z = b;
      knee.rotation.x = kappa;
      // the sole stays on the floor, flat or up on the ball of the foot; in
      // the air the toe comes up to land
      const ball = Math.asin(Math.min(1, ft.heel / FOOT_LEN));
      if (shoe) shoe.rotation.x = -(a + kappa) + ball - (ft.t >= 0 ? 0.25 * Math.sin(Math.PI * ft.t) : 0);
    }
  }

  /** The shoes back to the shin's angle (kneeling: the pose places them). */
  release(): void {
    for (const { shoe } of this.legs) if (shoe) shoe.rotation.x = 0;
  }
}
