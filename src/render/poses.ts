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

interface MovePoseSet { windup: Pose; active: Pose; recovery: Pose; }

export const movePoses: Record<Line, MovePoseSet> = {
  // Shomen-giri: raise high over the head, cut straight down
  high: {
    windup: {
      torso: [-0.18, 0, 0], head: [0.2, 0, 0],
      shoulderR: [-2.9, -0.1, -0.2], elbowR: [-0.9, 0, 0], wristR: [0.85, 0, 0],
      shoulderL: [-2.7, 0.15, 0.25], elbowL: [-1.0, 0, 0],
      ...guardLegs,
    },
    active: {
      torso: [0.38, 0, 0], head: [-0.15, 0, 0],
      shoulderR: [-0.55, -0.1, -0.2], elbowR: [-0.12, 0, 0], wristR: [-0.35, 0, 0],
      shoulderL: [-0.45, 0.15, 0.25], elbowL: [-0.25, 0, 0],
      ...lungeLegs,
    },
    recovery: {
      torso: [0.3, 0, 0], head: [-0.1, 0, 0],
      shoulderR: [-0.35, -0.1, -0.22], elbowR: [-0.1, 0, 0], wristR: [-0.3, 0, 0],
      shoulderL: [-0.3, 0.15, 0.28], elbowL: [-0.2, 0, 0],
      ...lungeLegs,
    },
  },
  // Tsuki: coil the arms, drive the point straight in
  mid: {
    windup: {
      torso: [0.05, 0.18, 0], head: [-0.05, -0.15, 0],
      shoulderR: [-0.8, -0.25, -0.3], elbowR: [-1.5, 0, 0], wristR: [-0.6, 0, 0],
      shoulderL: [-0.7, 0.3, 0.35], elbowL: [-1.6, 0, 0],
      ...guardLegs,
    },
    active: {
      torso: [0.28, -0.12, 0], head: [-0.15, 0.1, 0],
      shoulderR: [-1.4, -0.08, -0.15], elbowR: [-0.05, 0, 0], wristR: [-0.15, 0, 0],
      shoulderL: [-1.3, 0.1, 0.2], elbowL: [-0.15, 0, 0],
      ...lungeLegs,
    },
    recovery: {
      torso: [0.15, 0, 0], head: [-0.05, 0, 0],
      shoulderR: [-1.15, -0.15, -0.25], elbowR: [-0.4, 0, 0], wristR: [-0.4, 0, 0],
      shoulderL: [-1.0, 0.2, 0.3], elbowL: [-0.6, 0, 0],
      ...lungeLegs,
    },
  },
  // Kiriage: blade trails low and right, rips up on the diagonal
  low: {
    windup: {
      torso: [0.22, -0.35, 0], head: [-0.1, 0.3, 0],
      shoulderR: [-0.15, -0.55, 0.35], elbowR: [-0.45, 0, 0], wristR: [-0.3, 0, 0],
      shoulderL: [-0.3, 0.1, 0.4], elbowL: [-0.5, 0, 0],
      ...guardLegs,
    },
    active: {
      torso: [-0.08, 0.3, 0], head: [0.05, -0.25, 0],
      shoulderR: [-1.95, 0.3, -0.35], elbowR: [-0.2, 0, 0], wristR: [0.25, 0, 0],
      shoulderL: [-1.6, 0.05, 0.2], elbowL: [-0.3, 0, 0],
      ...lungeLegs,
    },
    recovery: {
      torso: [-0.02, 0.15, 0], head: [0, -0.1, 0],
      shoulderR: [-2.2, 0.2, -0.3], elbowR: [-0.45, 0, 0], wristR: [0.4, 0, 0],
      shoulderL: [-1.9, 0.1, 0.25], elbowL: [-0.55, 0, 0],
      ...guardLegs,
    },
  },
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
