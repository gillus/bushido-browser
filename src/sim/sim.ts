import {
  CharacterDef, EMPTY_INPUT, FighterState, InputFrame, MoveDef, MoveTable,
  SimState, WoundRegion, Obstacle, ObstacleState,
} from './types';

export const TICK = 1 / 60;

const STAGGER_FRAMES = 45;
const PARRIED_STAGGER_FRAMES = 70;
const FLINCH_FRAMES = 24;

// Active parry: deflects ANY line during the window; whiffing leaves you
// locked out and unguarded for the remainder.
export const PARRY_WINDOW = 8;
const PARRY_TOTAL = 34;
const ROUND_END_FRAMES = 160;

// Wound penalties
const ARM_WINDUP_MULT = 1.35;   // slower to raise the blade
const LEG_SPEED_MULT = 0.5;     // kneeling shuffle
const LEG_LUNGE_MULT = 0.6;

// A hit is a glancing wound (not a kill) past these fractions of reach/arc
export const GLANCE_REACH_FRAC = 0.9;
export const GLANCE_ARC_FRAC = 0.65;
export const BODY_RADIUS = 0.34;
const DASH_FRAMES = 10;
const DASH_COOLDOWN = 28;
const LUNGE_WINDUP_TAIL = 6; // lunge kicks in this many frames before active

export interface SimConfig {
  arenaRadius: number;
  arenaHalf?: number;    // square arena half-extent (room walls); overrides arenaRadius
  obstacles: Obstacle[]; // solid furniture, derived from stage props
  chars: [CharacterDef, CharacterDef];
  moves: [MoveTable, MoveTable]; // per fighter, from their weapon
}

function makeFighter(index: number): FighterState {
  return {
    pos: { x: 0, z: index === 0 ? -2.3 : 2.3 },
    facing: index === 0 ? 0 : Math.PI,
    stance: 'mid',
    phase: 'idle',
    phaseFrame: 0,
    move: null,
    didHit: false,
    dashVec: { x: 0, z: 0 },
    dashLeft: 0,
    dashCooldown: 0,
    walkCycle: 0,
    wounds: { arm: false, leg: false },
    staggerLen: STAGGER_FRAMES,
    score: 0,
  };
}

function freshObstacleState(cfg: SimConfig): ObstacleState[] {
  return cfg.obstacles.map(() => ({ down: false, fx: 0, fz: 0, downFrame: 0 }));
}

export function createSim(cfg: SimConfig): SimState {
  return {
    frame: 0,
    fighters: [makeFighter(0), makeFighter(1)],
    roundPhase: 'fight',
    roundFrame: 0,
    message: 'FIGHT',
    messageTimer: 70,
    obstacleState: freshObstacleState(cfg),
  };
}

function resetRound(sim: SimState, cfg: SimConfig): void {
  for (let i = 0; i < 2; i++) {
    const score = sim.fighters[i].score;
    sim.fighters[i] = makeFighter(i);
    sim.fighters[i].score = score;
  }
  sim.roundPhase = 'fight';
  sim.roundFrame = 0;
  sim.message = 'FIGHT';
  sim.messageTimer = 70;
  sim.obstacleState = freshObstacleState(cfg); // the standee rises again
}

function angleWrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

export function dist(a: FighterState, b: FighterState): number {
  return Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z);
}

function updateFighter(
  f: FighterState, o: FighterState, char: CharacterDef, moves: MoveTable,
  cfg: SimConfig, sim: SimState, inp: InputFrame,
): void {
  if (f.phase === 'dead') { f.phaseFrame++; return; }

  // Face the opponent while free; facing is locked once an attack starts.
  if (f.phase === 'idle' || f.phase === 'stagger'
    || f.phase === 'flinch' || f.phase === 'parry') {
    f.facing = Math.atan2(o.pos.x - f.pos.x, o.pos.z - f.pos.z);
  }

  const fwd = { x: Math.sin(f.facing), z: Math.cos(f.facing) };
  const right = { x: Math.cos(f.facing), z: -Math.sin(f.facing) };

  if (f.dashCooldown > 0) f.dashCooldown--;

  switch (f.phase) {
    case 'idle': {
      if (inp.stance) f.stance = inp.stance;

      if (inp.parry) {
        f.phase = 'parry';
        f.phaseFrame = 0;
        f.dashLeft = 0;
        break;
      }

      if (inp.attack) {
        f.move = moves[f.stance];
        f.phase = 'windup';
        f.phaseFrame = 0;
        f.didHit = false;
        f.dashLeft = 0;
        break;
      }

      if (inp.dash && f.dashCooldown <= 0 && !f.wounds.leg) {
        let dx = right.x * inp.moveX + fwd.x * inp.moveY;
        let dz = right.z * inp.moveX + fwd.z * inp.moveY;
        const len = Math.hypot(dx, dz);
        if (len < 0.01) { dx = -fwd.x; dz = -fwd.z; } // no direction held: hop back
        else { dx /= len; dz /= len; }
        f.dashVec = { x: dx, z: dz };
        f.dashLeft = DASH_FRAMES;
        f.dashCooldown = DASH_COOLDOWN;
      }

      if (f.dashLeft > 0) {
        f.pos.x += f.dashVec.x * char.dashSpeed * TICK;
        f.pos.z += f.dashVec.z * char.dashSpeed * TICK;
        f.dashLeft--;
        f.walkCycle += char.dashSpeed * TICK;
      } else {
        let vx = right.x * inp.moveX + fwd.x * inp.moveY;
        let vz = right.z * inp.moveX + fwd.z * inp.moveY;
        const len = Math.hypot(vx, vz);
        if (len > 1) { vx /= len; vz /= len; }
        const speed = char.walkSpeed * (f.wounds.leg ? LEG_SPEED_MULT : 1);
        f.pos.x += vx * speed * TICK;
        f.pos.z += vz * speed * TICK;
        f.walkCycle += Math.hypot(vx, vz) * speed * TICK;
      }
      break;
    }

    case 'windup': {
      const m = f.move!;
      const windup = effWindup(f, m);
      const lunge = m.lunge * (f.wounds.leg ? LEG_LUNGE_MULT : 1);
      if (windup - f.phaseFrame <= LUNGE_WINDUP_TAIL) {
        f.pos.x += fwd.x * lunge * TICK;
        f.pos.z += fwd.z * lunge * TICK;
      }
      if (++f.phaseFrame >= windup) { f.phase = 'active'; f.phaseFrame = 0; }
      break;
    }

    case 'active': {
      const m = f.move!;
      const lunge = m.lunge * (f.wounds.leg ? LEG_LUNGE_MULT : 1);
      f.pos.x += fwd.x * lunge * TICK;
      f.pos.z += fwd.z * lunge * TICK;
      if (++f.phaseFrame >= m.active) { f.phase = 'recovery'; f.phaseFrame = 0; }
      break;
    }

    case 'recovery': {
      if (++f.phaseFrame >= f.move!.recovery) { f.phase = 'idle'; f.phaseFrame = 0; f.move = null; }
      break;
    }

    case 'parry': {
      if (++f.phaseFrame >= PARRY_TOTAL) { f.phase = 'idle'; f.phaseFrame = 0; }
      break;
    }

    case 'stagger': {
      if (++f.phaseFrame >= f.staggerLen) { f.phase = 'idle'; f.phaseFrame = 0; }
      break;
    }

    case 'flinch': {
      if (++f.phaseFrame >= FLINCH_FRAMES) { f.phase = 'idle'; f.phaseFrame = 0; }
      break;
    }
  }

  collide(f, cfg, sim);
}

/**
 * Clamp to the arena (room square or circle) and push the body circle out of solid furniture.
 * Knockable furniture (cardboard) doesn't push back — it topples on
 * first contact and stops being an obstacle until the round resets.
 */
function collide(f: FighterState, cfg: SimConfig, sim: SimState): void {
  if (cfg.arenaHalf !== undefined) {
    const m = cfg.arenaHalf - BODY_RADIUS;
    f.pos.x = Math.max(-m, Math.min(m, f.pos.x));
    f.pos.z = Math.max(-m, Math.min(m, f.pos.z));
  } else {
    const r = Math.hypot(f.pos.x, f.pos.z);
    const maxR = cfg.arenaRadius - BODY_RADIUS;
    if (r > maxR) { f.pos.x *= maxR / r; f.pos.z *= maxR / r; }
  }

  for (let i = 0; i < cfg.obstacles.length; i++) {
    const ob = cfg.obstacles[i];
    const st = sim.obstacleState[i];
    if (st.down) continue;
    // into the box's local frame (yaw only)
    const dx = f.pos.x - ob.x, dz = f.pos.z - ob.z;
    const lx = dx * ob.c - dz * ob.s;
    const lz = dx * ob.s + dz * ob.c;
    const cx = Math.max(-ob.halfW, Math.min(ob.halfW, lx));
    const cz = Math.max(-ob.halfD, Math.min(ob.halfD, lz));
    let ex = lx - cx, ez = lz - cz;
    const d2 = ex * ex + ez * ez;
    if (d2 >= BODY_RADIUS * BODY_RADIUS) continue;
    if (ob.knockable) {
      // cardboard goes down, fighter walks on through
      const fl = Math.hypot(dx, dz) || 1;
      st.down = true;
      st.fx = -dx / fl;
      st.fz = -dz / fl;
      st.downFrame = sim.frame;
      continue;
    }
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      const k = (BODY_RADIUS - d) / d;
      ex *= k; ez *= k;
    } else {
      // center inside the box: exit through the nearest face
      const pw = ob.halfW - Math.abs(lx);
      const pd = ob.halfD - Math.abs(lz);
      if (pw < pd) { ex = (lx >= 0 ? 1 : -1) * (pw + BODY_RADIUS); ez = 0; }
      else { ez = (lz >= 0 ? 1 : -1) * (pd + BODY_RADIUS); ex = 0; }
    }
    f.pos.x += ex * ob.c + ez * ob.s;
    f.pos.z += -ex * ob.s + ez * ob.c;
  }
}

export function effWindup(f: FighterState, m: MoveDef): number {
  return f.wounds.arm ? Math.round(m.windup * ARM_WINDUP_MULT) : m.windup;
}

interface HitTest { hit: boolean; glancing: boolean; }

/** Does attacker `f` reach opponent `o` this frame, and how cleanly? */
function testHit(f: FighterState, o: FighterState): HitTest {
  const m = f.move!;
  const dx = o.pos.x - f.pos.x;
  const dz = o.pos.z - f.pos.z;
  const d = Math.hypot(dx, dz);
  const halfArc = (m.arcDeg * Math.PI / 180) / 2;
  const ang = Math.abs(angleWrap(Math.atan2(dx, dz) - f.facing));
  if (d > m.reach || ang > halfArc) return { hit: false, glancing: false };
  const glancing =
    d > m.reach * GLANCE_REACH_FRAC
    || ang > halfArc * GLANCE_ARC_FRAC
    || d < (m.minReach ?? 0); // inside the haft, only the shaft connects
  return { hit: true, glancing };
}

export function stepSim(sim: SimState, cfg: SimConfig, inputs: [InputFrame, InputFrame]): void {
  sim.frame++;
  if (sim.messageTimer > 0) sim.messageTimer--;

  if (sim.roundPhase === 'end') {
    sim.roundFrame++;
    for (const f of sim.fighters) if (f.phase === 'dead') f.phaseFrame++;
    if (sim.roundFrame >= ROUND_END_FRAMES) resetRound(sim, cfg);
    return;
  }

  const [a, b] = sim.fighters;
  updateFighter(a, b, cfg.chars[0], cfg.moves[0], cfg, sim, inputs[0]);
  updateFighter(b, a, cfg.chars[1], cfg.moves[1], cfg, sim, inputs[1]);

  // Keep bodies from overlapping
  const d = dist(a, b);
  const minD = BODY_RADIUS * 2;
  if (d > 0.001 && d < minD && a.phase !== 'dead' && b.phase !== 'dead') {
    const push = (minD - d) / 2;
    const nx = (b.pos.x - a.pos.x) / d;
    const nz = (b.pos.z - a.pos.z) / d;
    a.pos.x -= nx * push; a.pos.z -= nz * push;
    b.pos.x += nx * push; b.pos.z += nz * push;
    collide(a, cfg, sim);
    collide(b, cfg, sim);
  }

  // Resolve blades. Collect first so a mutual hit is a true double kill.
  const kills: [boolean, boolean] = [false, false];
  const wounds: [WoundRegion | null, WoundRegion | null] = [null, null];
  let deflected = false;
  let parried = false;
  for (let i = 0; i < 2; i++) {
    const f = sim.fighters[i];
    const o = sim.fighters[1 - i];
    if (f.phase !== 'active' || f.didHit || o.phase === 'dead') continue;
    const res = testHit(f, o);
    if (!res.hit) continue;
    f.didHit = true;
    if (o.phase === 'parry' && o.phaseFrame < PARRY_WINDOW) {
      // active parry beats any line; defender snaps back to neutral
      f.phase = 'stagger';
      f.phaseFrame = 0;
      f.staggerLen = PARRIED_STAGGER_FRAMES;
      o.phase = 'idle';
      o.phaseFrame = 0;
      parried = true;
      continue;
    }
    const guarding = o.phase === 'idle' && o.dashLeft <= 0;
    if (guarding && o.stance === f.move!.line) {
      f.phase = 'stagger';
      f.phaseFrame = 0;
      f.staggerLen = STAGGER_FRAMES;
      deflected = true;
    } else {
      const region: WoundRegion = f.move!.line === 'low' ? 'leg' : 'arm';
      if (res.glancing && !o.wounds[region]) wounds[1 - i] = region;
      else kills[1 - i] = true; // clean hit, or nothing left to give there
    }
  }

  for (let i = 0; i < 2; i++) {
    const region = wounds[i];
    if (!region || kills[i]) continue;
    const f = sim.fighters[i];
    f.wounds[region] = true;
    f.phase = 'flinch';   // interrupts whatever they were doing
    f.phaseFrame = 0;
    f.move = null;
    f.didHit = false;
    f.dashLeft = 0;
    sim.message = `${cfg.chars[i].name.toUpperCase()} — ${region.toUpperCase()} CUT`;
    sim.messageTimer = 60;
  }

  if (parried && !kills[0] && !kills[1] && !wounds[0] && !wounds[1]) {
    sim.message = 'PARRIED';
    sim.messageTimer = 55;
  } else if (deflected && !kills[0] && !kills[1] && !wounds[0] && !wounds[1]) {
    sim.message = 'DEFLECTED';
    sim.messageTimer = 50;
  }

  if (kills[0] || kills[1]) {
    for (let i = 0; i < 2; i++) {
      if (kills[i]) {
        sim.fighters[i].phase = 'dead';
        sim.fighters[i].phaseFrame = 0;
      }
    }
    sim.roundPhase = 'end';
    sim.roundFrame = 0;
    if (kills[0] && kills[1]) {
      sim.message = 'AI-UCHI — MUTUAL SLAYING';
    } else {
      const w = kills[0] ? 1 : 0;
      sim.fighters[w].score++;
      sim.message = `${cfg.chars[w].name.toUpperCase()} STRIKES TRUE`;
    }
    sim.messageTimer = ROUND_END_FRAMES;
  }
}

export { EMPTY_INPUT };
