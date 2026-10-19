import {
  Cart, CartEnd, CartRules, CharacterDef, EMPTY_INPUT, FighterState, HonorRules, HurlRules, InputFrame, Line,
  MoveDef, MoveTable, SimState, WoundRegion, Obstacle, ObstacleState,
} from './types';

export const TICK = 1 / 60;

const STAGGER_FRAMES = 45;
const PARRIED_STAGGER_FRAMES = 70;
const FLINCH_FRAMES = 24;

// Active parry: deflects ANY line during the window; whiffing leaves you
// locked out and unguarded for the remainder.
export const PARRY_WINDOW = 8;
const PARRY_TOTAL = 34;
export const ROUND_END_FRAMES = 160;
/** Clean kills to take the match; ai-uchi scores for nobody. */
export const MATCH_WINS = 3;

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

// Tsubazeriai: a same-line cut that lands while the other blade is already
// moving (active, or in its lunge tail) meets steel — well, cardboard —
// instead of flesh. Both lock guard-to-guard and push: each attack press
// shoves the balance; whoever reaches the end throws the other off
// balance. Cross-line simultaneous cuts still pass each other (ai-uchi).
export const CLASH_WINDUP_TAIL = LUNGE_WINDUP_TAIL;
const LOCK_FRAMES = 150;        // nobody wins by then: both break apart
const LOCK_DIST = 0.9;            // guard-to-guard spacing while locked
const LOCK_CLOSE_RATE = 0.2;      // per-frame ease toward LOCK_DIST
const LOCK_PUSH = 0.12;           // balance per attack press
const LOCK_DRIFT = 0.012;         // m/frame the pair slides at full balance
const LOCK_ARM_MULT = 0.8;        // a cut arm pushes weaker
const LOCK_LEG_MULT = 0.85;       // so does a kneeling stance
const SHOVE_STAGGER_FRAMES = 36;  // shorter than a deflect: a real but not free opening

// Furniture stops blades: a cut whose line runs into a wall or a solid
// prop before it reaches the opponent rebounds off it instead. Each line
// clears furniture lower than this (m): the overhead cut comes down to the
// waist, thrusts and sweeps ride at chest height over the counters, rising
// cuts start at the shins. Cardboard (knockable) never stops a blade — it
// gets knocked flat. Tested along the cut's centerline only (that's where
// the rendered weapon goes), from the hands out.
const BLADE_CLEARS: Record<Line, number> = { high: 0.9, mid: 1.05, low: 0.5 };
export const BLADE_FROM = 0.4;    // m from body center: the hands
export const BLADE_STEP = 0.1;
const REBOUND_STAGGER_FRAMES = 32; // about a whiff's recovery, from a worse pose

// Thrown cartridges: tested every CART_STEP m along the flight, released
// this far in front of the thrower, and hit a body within this of it.
const CART_STEP = 0.1;
export const CART_FROM = 0.4;
const CART_RADIUS = 0.07;
// A hurled weapon is bigger (it tumbles end over end), and glances off a
// body it only clips: past this fraction of the hit radius off its path.
const WEAPON_RADIUS = 0.14;
const WEAPON_GLANCE_FRAC = 0.65;
// Where a thrown weapon ends up: knocked back this far off a guard, off
// the furniture it hit, and how close you must walk to stoop for it.
const WEAPON_KNOCK_BACK = 1.0;
const WEAPON_KNOCK_SIDE = 0.6;
const WEAPON_OFF_FURNITURE = 0.35;
export const PICKUP_RADIUS = 0.6;

export interface SimConfig {
  arenaRadius: number;
  arenaHalf?: number;    // square arena half-extent (room walls); overrides arenaRadius
  obstacles: Obstacle[]; // solid furniture, derived from stage props
  chars: [CharacterDef, CharacterDef];
  moves: [MoveTable, MoveTable]; // per fighter, from their weapon
  lockLeverage?: [number, number]; // per fighter, from their weapon (default 1)
  carts?: CartRules;   // rules.json; absent = nobody throws
  honor?: HonorRules;  // rules.json; absent = no bow, no dishonor
  hurl?: HurlRules;    // rules.json; absent = nobody throws their weapon
}

function makeFighter(index: number, cfg: SimConfig): FighterState {
  return {
    pos: { x: 0, z: index === 0 ? -2.3 : 2.3 },
    facing: index === 0 ? 0 : Math.PI,
    stance: 'mid',
    phase: cfg.honor ? 'bow' : 'idle',
    phaseFrame: 0,
    move: null,
    didHit: false,
    dashVec: { x: 0, z: 0 },
    dashLeft: 0,
    dashCooldown: 0,
    walkCycle: 0,
    wounds: { arm: false, leg: false },
    staggerLen: STAGGER_FRAMES,
    rebound: null,
    score: 0,
    carts: cfg.carts?.ammo ?? 0,
    dishonored: false,
    armed: true,
    weaponAt: null,
  };
}

function freshObstacleState(cfg: SimConfig): ObstacleState[] {
  return cfg.obstacles.map(() => ({ down: false, fx: 0, fz: 0, downFrame: 0 }));
}

export function createSim(cfg: SimConfig): SimState {
  return {
    frame: 0,
    fighters: [makeFighter(0, cfg), makeFighter(1, cfg)],
    roundPhase: 'fight',
    roundFrame: 0,
    ...openingMessage(cfg),
    obstacleState: freshObstacleState(cfg),
    lockBalance: 0,
    matchWinner: null,
    carts: [],
  };
}

/** Rounds open on the bow when there's an honor code, else straight to it. */
function openingMessage(cfg: SimConfig): { message: string; messageTimer: number } {
  return cfg.honor
    ? { message: 'REI 礼', messageTimer: cfg.honor.bowFrames }
    : { message: 'FIGHT', messageTimer: 70 };
}

function resetRound(sim: SimState, cfg: SimConfig): void {
  for (let i = 0; i < 2; i++) {
    const score = sim.fighters[i].score;
    sim.fighters[i] = makeFighter(i, cfg);
    sim.fighters[i].score = score;
  }
  sim.roundPhase = 'fight';
  sim.roundFrame = 0;
  Object.assign(sim, openingMessage(cfg));
  sim.obstacleState = freshObstacleState(cfg); // the standee rises again
  sim.lockBalance = 0;
  sim.carts = [];
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

  // The opening bow lasts until its time is up or you do anything at all
  // (acting first is allowed; hitting someone still bowing is not).
  if (f.phase === 'bow') {
    const acted = inp.attack || inp.dash || inp.parry || inp.throw || inp.hurl || inp.stance !== null
      || Math.hypot(inp.moveX, inp.moveY) > 0.2;
    if (acted || ++f.phaseFrame >= cfg.honor!.bowFrames) {
      f.phase = 'idle';
      f.phaseFrame = 0;
      if (sim.message === 'REI 礼' && o.phase !== 'bow') { sim.message = 'FIGHT'; sim.messageTimer = 50; }
    }
  }

  // Face the opponent while free; facing is locked once an attack starts
  // (a throw keeps aiming until the cartridge — or the weapon — leaves the hand).
  if (f.phase === 'idle' || f.phase === 'stagger' || f.phase === 'bow'
    || f.phase === 'flinch' || f.phase === 'parry'
    || (f.phase === 'throw' && f.phaseFrame < cfg.carts!.windup)
    || (f.phase === 'hurl' && f.phaseFrame < cfg.hurl!.windup)) {
    f.facing = Math.atan2(o.pos.x - f.pos.x, o.pos.z - f.pos.z);
  }

  const fwd = { x: Math.sin(f.facing), z: Math.cos(f.facing) };
  const right = { x: Math.cos(f.facing), z: -Math.sin(f.facing) };

  if (f.dashCooldown > 0) f.dashCooldown--;

  switch (f.phase) {
    case 'idle': {
      if (inp.stance) f.stance = inp.stance;

      // unarmed: walking onto your weapon stoops for it
      if (!f.armed && f.weaponAt && f.dashLeft <= 0
        && Math.hypot(f.weaponAt.x - f.pos.x, f.weaponAt.z - f.pos.z) <= PICKUP_RADIUS) {
        f.phase = 'pickup';
        f.phaseFrame = 0;
        break;
      }

      if (inp.parry && f.armed) {
        f.phase = 'parry';
        f.phaseFrame = 0;
        f.dashLeft = 0;
        break;
      }

      if (inp.attack && f.armed) {
        f.move = moves[f.stance];
        f.phase = 'windup';
        f.phaseFrame = 0;
        f.didHit = false;
        f.rebound = null;
        f.dashLeft = 0;
        break;
      }

      if (inp.throw && f.carts > 0) {
        f.phase = 'throw';
        f.phaseFrame = 0;
        f.dashLeft = 0;
        break;
      }

      if (inp.hurl && f.armed && cfg.hurl) {
        f.phase = 'hurl';
        f.phaseFrame = 0;
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

    case 'throw': {
      const rules = cfg.carts!;
      if (f.phaseFrame === rules.windup) {
        const dx = Math.sin(f.facing), dz = Math.cos(f.facing);
        f.carts--;
        sim.carts.push({
          owner: sim.fighters.indexOf(f), line: f.stance,
          x: f.pos.x + dx * CART_FROM, z: f.pos.z + dz * CART_FROM, dx, dz,
          flown: 0, end: null, endFrame: 0,
        });
      }
      if (++f.phaseFrame >= rules.windup + rules.recovery) { f.phase = 'idle'; f.phaseFrame = 0; }
      break;
    }

    case 'hurl': {
      const rules = cfg.hurl!;
      if (f.phaseFrame === rules.windup) {
        const dx = Math.sin(f.facing), dz = Math.cos(f.facing);
        f.armed = false;
        sim.carts.push({
          kind: 'weapon', owner: sim.fighters.indexOf(f), line: f.stance,
          x: f.pos.x + dx * CART_FROM, z: f.pos.z + dz * CART_FROM, dx, dz,
          flown: 0, end: null, endFrame: 0,
        });
      }
      if (++f.phaseFrame >= rules.windup + rules.recovery) { f.phase = 'idle'; f.phaseFrame = 0; }
      break;
    }

    case 'pickup': {
      if (++f.phaseFrame >= cfg.hurl!.pickupFrames) {
        f.armed = true;
        f.weaponAt = null;
        f.phase = 'idle';
        f.phaseFrame = 0;
      }
      break;
    }

    case 'stagger': {
      // a shove out of a lock slides the loser back
      if (f.dashLeft > 0) {
        f.pos.x += f.dashVec.x * char.dashSpeed * TICK;
        f.pos.z += f.dashVec.z * char.dashSpeed * TICK;
        f.dashLeft--;
      }
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

/** Keep bodies from overlapping. */
function separate(a: FighterState, b: FighterState, cfg: SimConfig, sim: SimState): void {
  const d = dist(a, b);
  const minD = BODY_RADIUS * 2;
  if (d <= 0.001 || d >= minD) return;
  const push = (minD - d) / 2;
  const nx = (b.pos.x - a.pos.x) / d;
  const nz = (b.pos.z - a.pos.z) / d;
  a.pos.x -= nx * push; a.pos.z -= nz * push;
  b.pos.x += nx * push; b.pos.z += nz * push;
  collide(a, cfg, sim);
  collide(b, cfg, sim);
}

/** Is this fighter's blade already travelling (can it meet another)? */
function bladeMoving(f: FighterState): boolean {
  if (f.phase === 'active') return !f.didHit;
  return f.phase === 'windup' && effWindup(f, f.move!) - f.phaseFrame <= CLASH_WINDUP_TAIL;
}

/** Blades on the same line meet: lock both fighters guard-to-guard. */
function tryClash(sim: SimState): boolean {
  for (let i = 0; i < 2; i++) {
    const f = sim.fighters[i];
    const o = sim.fighters[1 - i];
    if (f.phase !== 'active' || f.didHit || !bladeMoving(o)) continue;
    if (o.move!.line !== f.move!.line || !testHit(f, o).hit) continue;
    for (const g of sim.fighters) {
      g.phase = 'lock';
      g.phaseFrame = 0;
      g.move = null;
      g.didHit = false;
      g.dashLeft = 0;
    }
    sim.lockBalance = 0;
    sim.message = 'TSUBAZERIAI';
    sim.messageTimer = 70;
    return true;
  }
  return false;
}

function lockStrength(f: FighterState, leverage = 1): number {
  return leverage * (f.wounds.arm ? LOCK_ARM_MULT : 1) * (f.wounds.leg ? LOCK_LEG_MULT : 1);
}

/** Push contest while locked. Attack presses push; nothing else does. */
function updateLock(sim: SimState, cfg: SimConfig, inputs: [InputFrame, InputFrame]): void {
  const [a, b] = sim.fighters;
  if (inputs[0].attack) sim.lockBalance += LOCK_PUSH * lockStrength(a, cfg.lockLeverage?.[0]);
  if (inputs[1].attack) sim.lockBalance -= LOCK_PUSH * lockStrength(b, cfg.lockLeverage?.[1]);
  sim.lockBalance = Math.max(-1, Math.min(1, sim.lockBalance));

  // close to guard-to-guard, and let the stronger side walk the pair back
  const d = dist(a, b) || 1e-3;
  const nx = (b.pos.x - a.pos.x) / d, nz = (b.pos.z - a.pos.z) / d;
  const drift = sim.lockBalance * LOCK_DRIFT;
  const mx = (a.pos.x + b.pos.x) / 2 + nx * drift;
  const mz = (a.pos.z + b.pos.z) / 2 + nz * drift;
  const half = (d + (LOCK_DIST - d) * LOCK_CLOSE_RATE) / 2;
  a.pos.x = mx - nx * half; a.pos.z = mz - nz * half;
  b.pos.x = mx + nx * half; b.pos.z = mz + nz * half;
  for (const f of sim.fighters) {
    f.facing = Math.atan2((f === a ? b : a).pos.x - f.pos.x, (f === a ? b : a).pos.z - f.pos.z);
    f.phaseFrame++;
    collide(f, cfg, sim);
  }
  separate(a, b, cfg, sim); // one pinned to a wall: the pusher must not walk through

  const away = (f: FighterState, sign: number) => {
    f.dashVec = { x: -nx * sign, z: -nz * sign };
    f.dashLeft = DASH_FRAMES;
  };
  if (Math.abs(sim.lockBalance) >= 1) {
    const w = sim.lockBalance > 0 ? 0 : 1;
    const winner = sim.fighters[w], loser = sim.fighters[1 - w];
    winner.phase = 'idle';
    winner.phaseFrame = 0;
    loser.phase = 'stagger';
    loser.phaseFrame = 0;
    loser.staggerLen = SHOVE_STAGGER_FRAMES;
    away(loser, w === 0 ? -1 : 1);
    sim.lockBalance = 0;
    sim.message = 'OVERPOWERED';
    sim.messageTimer = 50;
  } else if (a.phaseFrame >= LOCK_FRAMES) {
    for (const f of sim.fighters) { f.phase = 'idle'; f.phaseFrame = 0; }
    away(a, 1);
    away(b, -1);
    sim.lockBalance = 0;
    sim.message = 'DISENGAGE';
    sim.messageTimer = 45;
  }
}

function inBox(ob: Obstacle, x: number, z: number): boolean {
  const dx = x - ob.x, dz = z - ob.z;
  return Math.abs(dx * ob.c - dz * ob.s) <= ob.halfW && Math.abs(dx * ob.s + dz * ob.c) <= ob.halfD;
}

/**
 * How far out along its centerline `move`, cut from `f` along `facing`,
 * travels: to the opponent's body if they're in the swing (the blade meets
 * them first), else full reach. Starts at `BLADE_FROM`, the hands.
 */
export function bladeSpan(f: FighterState, o: FighterState, move: MoveDef, facing: number): number {
  const dx = o.pos.x - f.pos.x, dz = o.pos.z - f.pos.z;
  const d = Math.hypot(dx, dz);
  const halfArc = (move.arcDeg * Math.PI / 180) / 2;
  const inArc = Math.abs(angleWrap(Math.atan2(dx, dz) - facing)) <= halfArc;
  return inArc && d <= move.reach ? d - BODY_RADIUS : move.reach;
}

/**
 * Where `move`, cut from `f` along `facing`, runs into a wall or solid
 * furniture before it reaches `o` — null if nothing's in the way. Pass
 * `knock` to topple the cardboard the blade passes through (only a real
 * swing does that).
 */
export function bladeObstruction(
  f: FighterState, o: FighterState, move: MoveDef, facing: number,
  cfg: SimConfig, sim: SimState, knock?: boolean,
): { x: number; z: number } | null {
  const fx = Math.sin(facing), fz = Math.cos(facing);
  const until = bladeSpan(f, o, move, facing);
  const clears = BLADE_CLEARS[move.line];
  for (let r = BLADE_FROM; r <= until; r += BLADE_STEP) {
    const x = f.pos.x + fx * r, z = f.pos.z + fz * r;
    if (cfg.arenaHalf !== undefined && (Math.abs(x) > cfg.arenaHalf || Math.abs(z) > cfg.arenaHalf)) {
      return { x, z };
    }
    for (let i = 0; i < cfg.obstacles.length; i++) {
      const ob = cfg.obstacles[i];
      const st = sim.obstacleState[i];
      if (st.down || !inBox(ob, x, z)) continue;
      if (ob.knockable) {
        if (knock) { st.down = true; st.fx = fx; st.fz = fz; st.downFrame = sim.frame; }
        continue;
      }
      if (ob.y1 >= clears) return { x, z };
    }
  }
  return null;
}

/** Blades that hit furniture this frame bounce off it: no cut lands. */
function reboundOffFurniture(sim: SimState, cfg: SimConfig): void {
  for (let i = 0; i < 2; i++) {
    const f = sim.fighters[i];
    if (f.phase !== 'active' || f.didHit) continue;
    const stop = bladeObstruction(f, sim.fighters[1 - i], f.move!, f.facing, cfg, sim, true);
    if (!stop) continue;
    f.didHit = true;
    f.rebound = stop;
    f.phase = 'stagger';
    f.phaseFrame = 0;
    f.staggerLen = REBOUND_STAGGER_FRAMES;
  }
}

/**
 * Was a blow arriving along direction (dx, dz) at `o` dishonorable — `o`
 * still bowing, or struck from behind? Never without an honor code.
 */
function dishonorable(o: FighterState, dx: number, dz: number, cfg: SimConfig): boolean {
  if (!cfg.honor) return false;
  if (o.phase === 'bow') return true;
  // the blow travels (dx, dz); it came from the opposite way
  const from = Math.atan2(-dx, -dz);
  return Math.abs(angleWrap(from - o.facing)) > (cfg.honor.backDeg * Math.PI) / 180;
}

function dishonor(sim: SimState, cfg: SimConfig, i: number): void {
  sim.fighters[i].dishonored = true;
  sim.message = `${cfg.chars[i].name.toUpperCase()} — DISHONOR 不名誉`;
  sim.messageTimer = 90;
}

/**
 * Where a thrown weapon that just stopped comes to rest — the spot its
 * owner has to walk back to. Knocked back toward the thrower and to one
 * side off a guard, off whatever furniture or wall it hit, at the feet of
 * whoever it hit; always inside the room and outside solid furniture.
 */
function weaponRest(c: Cart, cfg: SimConfig, sim: SimState): { x: number; z: number } {
  let back = 0, side = 0;
  switch (c.end) {
    case 'guard': case 'parry':
      back = WEAPON_KNOCK_BACK;
      side = sim.frame % 2 ? WEAPON_KNOCK_SIDE : -WEAPON_KNOCK_SIDE;
      break;
    case 'wall': case 'prop': back = WEAPON_OFF_FURNITURE; break;
  }
  let x = c.x - c.dx * back + c.dz * side;
  let z = c.z - c.dz * back - c.dx * side;
  if (cfg.arenaHalf !== undefined) {
    const m = cfg.arenaHalf - 0.15;
    x = Math.max(-m, Math.min(m, x));
    z = Math.max(-m, Math.min(m, z));
  } else {
    const r = Math.hypot(x, z), maxR = cfg.arenaRadius - 0.15;
    if (r > maxR) { x *= maxR / r; z *= maxR / r; }
  }
  for (let i = 0; i < cfg.obstacles.length; i++) {
    const ob = cfg.obstacles[i];
    if (ob.knockable || !inBox(ob, x, z)) continue;
    // out through the nearest face
    const dx = x - ob.x, dz = z - ob.z;
    let lx = dx * ob.c - dz * ob.s;
    let lz = dx * ob.s + dz * ob.c;
    if (ob.halfW - Math.abs(lx) < ob.halfD - Math.abs(lz)) lx = (lx >= 0 ? 1 : -1) * (ob.halfW + 0.08);
    else lz = (lz >= 0 ? 1 : -1) * (ob.halfD + 0.08);
    x = ob.x + lx * ob.c + lz * ob.s;
    z = ob.z - lx * ob.s + lz * ob.c;
  }
  return { x, z };
}

/**
 * Fly every cartridge (and hurled weapon) still in the air one tick:
 * furniture tall enough for its line or a wall stops it (cardboard gets
 * knocked flat), and the thrower's opponent catches it — unless guarding
 * that line (deflected) or inside a parry window (swatted away, and back
 * to neutral). A cartridge hit flinches; it never wounds. A weapon hit is
 * a blade hit: it kills, or glances (a wound) if it only clips the body.
 * A weapon that stops lies where `weaponRest` says until picked up.
 * `strike` = false once the round is over: things still in the air only
 * fly on into the furniture.
 */
function updateCarts(sim: SimState, cfg: SimConfig, strike: boolean): void {
  if (sim.carts.length === 0) return;
  const kills: [boolean, boolean] = [false, false];
  const stop = (c: Cart, end: CartEnd): void => {
    c.end = end;
    c.endFrame = sim.frame;
    if (c.kind === 'weapon') sim.fighters[c.owner].weaponAt = weaponRest(c, cfg, sim);
  };
  for (const c of sim.carts) {
    if (c.end) continue;
    const weapon = c.kind === 'weapon';
    const rules: CartRules | HurlRules = weapon ? cfg.hurl! : cfg.carts!;
    const reach = BODY_RADIUS + (weapon ? WEAPON_RADIUS : CART_RADIUS);
    const step = rules.speed * TICK;
    const n = Math.ceil(step / CART_STEP);
    for (let k = 0; k < n && !c.end; k++) {
      c.x += c.dx * (step / n);
      c.z += c.dz * (step / n);
      c.flown += step / n;
      if (cfg.arenaHalf !== undefined
        ? Math.abs(c.x) > cfg.arenaHalf || Math.abs(c.z) > cfg.arenaHalf
        : c.flown > rules.range) {
        stop(c, cfg.arenaHalf !== undefined ? 'wall' : 'spent');
        break;
      }
      for (let i = 0; i < cfg.obstacles.length; i++) {
        const ob = cfg.obstacles[i];
        const st = sim.obstacleState[i];
        if (st.down || !inBox(ob, c.x, c.z)) continue;
        if (ob.knockable) { st.down = true; st.fx = c.dx; st.fz = c.dz; st.downFrame = sim.frame; }
        if (ob.knockable || ob.y1 >= rules.heights[c.line]) { stop(c, 'prop'); break; }
      }
      if (c.end || !strike) continue;
      const t = 1 - c.owner;
      const o = sim.fighters[t];
      if (o.phase === 'dead' || kills[t]
        || Math.hypot(o.pos.x - c.x, o.pos.z - c.z) > reach) continue;
      if (o.phase === 'lock') stop(c, 'guard'); // it bounces off the crossed weapons
      else if (o.phase === 'parry' && o.phaseFrame < PARRY_WINDOW) {
        stop(c, 'parry');
        o.phase = 'idle';
        o.phaseFrame = 0;
        sim.message = 'PARRIED';
        sim.messageTimer = 40;
      } else if (o.phase === 'idle' && o.dashLeft <= 0 && o.armed && o.stance === c.line) {
        stop(c, 'guard');
        sim.message = 'DEFLECTED';
        sim.messageTimer = 40;
      } else if (weapon) {
        stop(c, 'hit');
        if (dishonorable(o, c.dx, c.dz, cfg)) dishonor(sim, cfg, c.owner);
        // how far off its path the body was: clipped = glancing
        const off = Math.abs((o.pos.x - c.x) * c.dz - (o.pos.z - c.z) * c.dx);
        const region: WoundRegion = c.line === 'low' ? 'leg' : 'arm';
        if (off > reach * WEAPON_GLANCE_FRAC && !o.wounds[region]) wound(sim, cfg, t, region);
        else kills[t] = true;
      } else {
        stop(c, 'hit');
        const shame = dishonorable(o, c.dx, c.dz, cfg);
        if (o.phase !== 'stagger') {
          o.phase = 'flinch';
          o.phaseFrame = 0;
          o.move = null;
          o.didHit = false;
          o.dashLeft = 0;
        }
        sim.message = rules.name.toUpperCase();
        sim.messageTimer = 45;
        if (shame) dishonor(sim, cfg, c.owner);
      }
    }
  }
  if (kills[0] || kills[1]) endRound(sim, cfg, kills);
}

/** A glancing wound: the limb is marked and whatever they were doing stops. */
function wound(sim: SimState, cfg: SimConfig, i: number, region: WoundRegion): void {
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

/** Someone's dead: the round ends, and a clean, honorable kill scores. */
function endRound(sim: SimState, cfg: SimConfig, kills: [boolean, boolean]): void {
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
    const name = cfg.chars[w].name.toUpperCase();
    if (sim.fighters[w].dishonored) {
      sim.message = `${name} STRIKES WITHOUT HONOR — NO POINT`; // the kill doesn't count
    } else {
      sim.fighters[w].score++;
      if (sim.fighters[w].score >= MATCH_WINS) sim.matchWinner = w;
      sim.message = `${name} STRIKES TRUE`;
    }
  }
  sim.messageTimer = ROUND_END_FRAMES;
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
    updateCarts(sim, cfg, false);
    sim.roundFrame++;
    for (const f of sim.fighters) if (f.phase === 'dead') f.phaseFrame++;
    if (sim.roundFrame >= ROUND_END_FRAMES && sim.matchWinner === null) resetRound(sim, cfg);
    return;
  }

  updateCarts(sim, cfg, true);
  if ((sim.roundPhase as string) === 'end') return; // a thrown weapon killed
  const [a, b] = sim.fighters;
  if (a.phase === 'lock') { updateLock(sim, cfg, inputs); return; } // both lock together
  updateFighter(a, b, cfg.chars[0], cfg.moves[0], cfg, sim, inputs[0]);
  updateFighter(b, a, cfg.chars[1], cfg.moves[1], cfg, sim, inputs[1]);

  if (a.phase !== 'dead' && b.phase !== 'dead') separate(a, b, cfg, sim);

  reboundOffFurniture(sim, cfg);
  if (tryClash(sim)) return;

  // Resolve blades. Collect first so a mutual hit is a true double kill.
  const kills: [boolean, boolean] = [false, false];
  const wounds: [WoundRegion | null, WoundRegion | null] = [null, null];
  const shamed: [boolean, boolean] = [false, false];
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
    const guarding = o.phase === 'idle' && o.dashLeft <= 0 && o.armed;
    if (guarding && o.stance === f.move!.line) {
      f.phase = 'stagger';
      f.phaseFrame = 0;
      f.staggerLen = STAGGER_FRAMES;
      deflected = true;
    } else {
      const region: WoundRegion = f.move!.line === 'low' ? 'leg' : 'arm';
      if (res.glancing && !o.wounds[region]) wounds[1 - i] = region;
      else kills[1 - i] = true; // clean hit, or nothing left to give there
      if (dishonorable(o, o.pos.x - f.pos.x, o.pos.z - f.pos.z, cfg)) shamed[i] = true;
    }
  }

  for (let i = 0; i < 2; i++) {
    const region = wounds[i];
    if (region && !kills[i]) wound(sim, cfg, i, region);
  }

  for (let i = 0; i < 2; i++) if (shamed[i]) dishonor(sim, cfg, i);

  if (parried && !kills[0] && !kills[1] && !wounds[0] && !wounds[1]) {
    sim.message = 'PARRIED';
    sim.messageTimer = 55;
  } else if (deflected && !kills[0] && !kills[1] && !wounds[0] && !wounds[1]) {
    sim.message = 'DEFLECTED';
    sim.messageTimer = 50;
  }

  if (kills[0] || kills[1]) endRound(sim, cfg, kills);
}

export { EMPTY_INPUT };
