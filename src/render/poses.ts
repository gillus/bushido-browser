import { Line } from '../sim/types';

export type JointName =
  | 'torso' | 'head'
  | 'shoulderR' | 'elbowR' | 'wristR'
  | 'shoulderL' | 'elbowL'
  | 'hipR' | 'kneeR' | 'hipL' | 'kneeL';

export type Pose = Partial<Record<JointName, [number, number, number]>>;

// Convention: character faces +Z. Arms hang along -Y at rest;
// shoulder.rotation.x = -PI/2 points the arm forward at the opponent.

const guardLegs: Pose = {
  hipR: [-0.32, 0, 0.04], kneeR: [0.5, 0, 0],
  hipL: [0.14, 0, -0.04], kneeL: [0.38, 0, 0],
};

const lungeLegs: Pose = {
  hipR: [-0.6, 0, 0.05], kneeR: [0.75, 0, 0],
  hipL: [0.4, 0, -0.05], kneeL: [0.3, 0, 0],
};

export const stancePoses: Record<Line, Pose> = {
  // Jodan — sword raised overhead, blade angled back
  high: {
    torso: [-0.06, 0, 0], head: [0.15, 0, 0],
    shoulderR: [-2.55, -0.12, -0.25], elbowR: [-0.55, 0, 0], wristR: [0.55, 0, 0],
    shoulderL: [-2.35, 0.18, 0.3], elbowL: [-0.75, 0, 0],
    ...guardLegs,
  },
  // Chudan — classic center guard, point at the throat
  mid: {
    torso: [0.09, 0, 0], head: [-0.05, 0, 0],
    shoulderR: [-1.05, -0.18, -0.3], elbowR: [-0.55, 0, 0], wristR: [-0.5, 0, 0],
    shoulderL: [-0.9, 0.22, 0.35], elbowL: [-0.8, 0, 0],
    ...guardLegs,
  },
  // Gedan — blade low, inviting
  low: {
    torso: [0.16, 0, 0], head: [-0.1, 0, 0],
    shoulderR: [-0.45, -0.12, -0.28], elbowR: [-0.18, 0, 0], wristR: [-0.35, 0, 0],
    shoulderL: [-0.4, 0.18, 0.32], elbowL: [-0.35, 0, 0],
    ...guardLegs,
  },
};

// A cut's arms, torso and head are keyed in weapon space (cuts.ts) and laid
// over these; what's left of them is the legs, which place the feet:
// planted in the guard while winding up, stepping into the lunge from the
// strike on, and back to the guard late in the recovery
export const cutPoses: Record<Line, { windup: Pose; lunge: Pose }> = {
  high: { windup: { ...stancePoses.high }, lunge: { ...stancePoses.high, ...lungeLegs } },
  mid: { windup: { ...stancePoses.mid }, lunge: { ...stancePoses.mid, ...lungeLegs } },
  low: { windup: { ...stancePoses.low }, lunge: { ...stancePoses.low, ...lungeLegs } },
};

// Leg wound: right knee on the floor under the hip, left thigh level with
// the shin upright and the foot planted. Merged over any pose (except
// death); pairs with KNEEL_HIP_Y in the view, which is what puts the knee
// on the ground (thigh + kneecap ≈ shin + shoe).
export const kneelLegs: Pose = {
  hipR: [0.15, 0, 0.06], kneeR: [1.45, 0, 0],
  hipL: [-1.6, 0, -0.08], kneeL: [1.62, 0, 0],
};

// Active parry: blade snapped up vertical across the centerline
export const parryPose: Pose = {
  torso: [0.12, 0.1, 0], head: [-0.08, 0, 0],
  shoulderR: [-1.35, -0.35, -0.45], elbowR: [-1.05, 0, 0], wristR: [-1.25, 0, 0.2],
  shoulderL: [-1.15, 0.4, 0.45], elbowL: [-1.2, 0, 0],
  hipR: [-0.38, 0, 0.05], kneeR: [0.55, 0, 0],
  hipL: [0.16, 0, -0.05], kneeL: [0.4, 0, 0],
};

// Feint (Kyojitsu): the cut checked — weapon reined back upright in front
// of the face, weight back off the front foot; held briefly, then guard
export const feintPose: Pose = {
  torso: [-0.14, 0, 0], head: [0.06, 0, 0],
  shoulderR: [-0.95, -0.15, -0.2], elbowR: [-1.45, 0, 0], wristR: [-0.55, 0, 0],
  shoulderL: [-0.8, 0.2, 0.25], elbowL: [-1.55, 0, 0],
  hipR: [0.2, 0, 0.05], kneeR: [0.45, 0, 0],
  hipL: [-0.15, 0, -0.05], kneeL: [0.2, 0, 0],
};

// Tsubazeriai: guard-to-guard, hands pulled in to the chest, weapon raised
// so the two cross above the gap, leaning into the push
export const lockPose: Pose = {
  torso: [0.3, 0, 0], head: [-0.2, 0, 0],
  shoulderR: [-1.6, -0.2, -0.3], elbowR: [-0.95, 0, 0], wristR: [-0.25, 0, 0],
  shoulderL: [-1.4, 0.25, 0.35], elbowL: [-1.1, 0, 0],
  ...lungeLegs,
};

// Blade knocked wide, weight thrown onto the back foot
export const staggerPose: Pose = {
  torso: [-0.35, 0, 0.12], head: [-0.25, 0, 0],
  shoulderR: [-1.2, -1.0, 0], elbowR: [-0.35, 0, 0], wristR: [0.3, 0, 0],
  shoulderL: [-0.9, 0.9, 0], elbowL: [-0.4, 0, 0],
  hipR: [0.25, 0, 0.06], kneeR: [0.35, 0, 0],
  hipL: [-0.45, 0, -0.06], kneeL: [0.6, 0, 0],
};

export const deadPose: Pose = {
  torso: [0.05, 0, 0.08], head: [0.2, 0.3, 0],
  shoulderR: [-0.35, -0.6, 0], elbowR: [-0.2, 0, 0], wristR: [0, 0, 0],
  shoulderL: [-0.3, 0.7, 0], elbowL: [-0.25, 0, 0],
  hipR: [-0.1, 0, 0.15], kneeR: [0.25, 0, 0],
  hipL: [0.15, 0, -0.2], kneeL: [0.15, 0, 0],
};

// Rei: the opening bow — bent at the waist, eyes down, arms hanging, the
// weapon held back along the leg. The shoulders undo the torso's pitch so
// the arms still hang plumb.
export const bowPose: Pose = {
  torso: [0.62, 0, 0], head: [0.3, 0, 0],
  shoulderR: [-0.72, -0.05, -0.12], elbowR: [-0.15, 0, 0], wristR: [1.2, 0, 0],
  shoulderL: [-0.68, 0.05, 0.12], elbowL: [-0.18, 0, 0],
  hipR: [0, 0, 0.04], kneeR: [0.04, 0, 0],
  hipL: [0, 0, -0.04], kneeL: [0.04, 0, 0],
};

// Shuriken-uchi: the cartridge goes with the free left hand, overhand,
// while the weapon hangs low in the right
const throwArmR: Pose = { shoulderR: [-0.6, -0.2, -0.3], elbowR: [-0.45, 0, 0], wristR: [-0.4, 0, 0] };
export const throwPoses: { windup: Pose; release: Pose } = {
  // left shoulder drawn back, the cart cocked up behind the ear
  windup: {
    torso: [-0.08, -0.4, 0], head: [0, 0.35, 0],
    ...throwArmR,
    shoulderL: [-2.5, 0.2, 0.3], elbowL: [-1.5, 0, 0],
    ...guardLegs,
  },
  // and snapped through: arm straight at the target, shoulder leading
  release: {
    torso: [0.25, 0.35, 0], head: [-0.1, -0.3, 0],
    ...throwArmR,
    shoulderL: [-1.55, 0.1, 0.15], elbowL: [-0.05, 0, 0],
    ...lungeLegs,
  },
};

// Tachi-nage: the weapon itself goes, overhand, like a spear off the
// shoulder — the free hand points the way
export const hurlPoses: { windup: Pose; release: Pose } = {
  // drawn back over the right shoulder, the weapon trailing behind
  windup: {
    torso: [-0.15, 0.45, 0], head: [0.05, -0.4, 0],
    shoulderR: [-2.75, -0.35, -0.2], elbowR: [-1.1, 0, 0], wristR: [1.0, 0, 0],
    shoulderL: [-1.45, 0.25, 0.25], elbowL: [-0.2, 0, 0],
    ...guardLegs,
  },
  // and flung: arm through and down, the whole body following it in
  release: {
    torso: [0.42, -0.35, 0], head: [-0.2, 0.3, 0],
    shoulderR: [-1.15, 0.1, -0.15], elbowR: [-0.05, 0, 0], wristR: [-0.3, 0, 0],
    shoulderL: [-0.4, 0.5, 0.3], elbowL: [-0.5, 0, 0],
    ...lungeLegs,
  },
};

// Empty-handed (the weapon's been thrown): fists up, still squared up to
// the opponent — the deadpan has no unarmed technique, just resolve
export const unarmedPose: Pose = {
  torso: [0.14, 0, 0], head: [-0.06, 0, 0],
  shoulderR: [-1.0, -0.2, -0.3], elbowR: [-1.7, 0, 0], wristR: [0, 0, 0],
  shoulderL: [-1.15, 0.2, 0.3], elbowL: [-1.65, 0, 0],
  ...guardLegs,
};

// Stooping for the dropped weapon: bent over, knees bent (the view drops
// the pelvis), the right hand down at the floor
export const pickupPose: Pose = {
  torso: [1.2, 0, 0], head: [-0.55, 0, 0],
  shoulderR: [-0.35, -0.1, -0.15], elbowR: [-0.1, 0, 0], wristR: [-0.3, 0, 0],
  shoulderL: [-0.15, 0.2, 0.3], elbowL: [-0.45, 0, 0],
  hipR: [-1.0, 0, 0.06], kneeR: [1.35, 0, 0],
  hipL: [-0.35, 0, -0.06], kneeL: [0.9, 0, 0],
};
