import {
  BODY_RADIUS, bladeObstruction, CART_FROM, CLASH_WINDUP_TAIL, dist, effWindup, PARRY_WINDOW, SimConfig, TICK,
} from './sim';
import { EMPTY_INPUT, FighterState, InputFrame, Line, LINES, SimState } from './types';

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type ThreatPlan = 'freeze' | 'guard' | 'parry' | 'retreat' | 'trade';

/** A difficulty level (`src/data/ai.json`). Frame counts are sim ticks. */
export interface AIProfile {
  label: string;
  /** Mean frames before answering a wind-up. Lower = harder. */
  reaction: number;
  /** Odds of each answer to a wind-up; `freeze` = do nothing at all. */
  plans: Partial<Record<ThreatPlan, number>>;
  /** Frames between probing cuts: [min, random extra]; vs a wounded opponent. */
  poke: [number, number];
  pokeWounded: [number, number];
  /** Frames to notice an opening (stagger, recovery…): [min, random extra]. */
  punishDelay: [number, number];
  /** Frames between cartridge throws: [min, random extra]. */
  throws: [number, number];
  /** Frames, once wounded, before hurling the weapon as a last resort: [min, random extra]. */
  hurls: [number, number];
  /** Odds of chaining a whiffed cut into another line (rolled once per whiff). */
  chain: number;
}

/** A cartridge (or a hurled weapon) on its way: the line it flies on, frames until it lands. */
interface CartThreat { line: Line; eta: number; }

const PLAN_ORDER: ThreatPlan[] = ['freeze', 'guard', 'parry', 'retreat', 'trade'];

/**
 * A patient duelist: keeps spacing, reacts to wind-ups with a human-ish
 * delay, punishes recovery and stagger, and occasionally probes.
 */
export class AIController {
  private rng: () => number;
  private noticedThreat = false;
  private reactLeft = 0;
  private plan: ThreatPlan = 'guard';
  private planDone = false;
  private circleDir = 1;
  private circleTimer = 0;
  private pokeTimer = 90;
  private stanceTimer = 120;
  private lockRate = -1; // push presses per frame in the current lock; -1 = not locked
  private openingWait = -1; // frames left before punishing the current opening; -1 = none seen
  // incoming cartridges get their own answer, rolled from the same odds
  private noticedCart = false;
  private cartReact = 0;
  private cartPlan: ThreatPlan = 'guard';
  private cartPlanDone = false;
  private throwTimer: number;
  private hurlTimer: number;
  private chainRoll: boolean | null = null; // this whiff's roll: will we chain off it? null = not rolled

  constructor(seed: number, private profile: AIProfile) {
    this.rng = mulberry32(seed);
    this.throwTimer = profile.throws[0];
    this.hurlTimer = profile.hurls[0];
  }

  /** Roll an answer to a threat from the profile's odds. */
  private rollPlan(): ThreatPlan {
    let r = this.rng();
    for (const p of PLAN_ORDER) {
      const w = this.profile.plans[p] ?? 0;
      if (r < w) return p;
      r -= w;
    }
    return 'trade';
  }

  /**
   * The opponent's cartridge, if one is coming at us: being thrown
   * (aimed at us until it leaves the hand) or in the air on a path that
   * will meet our body.
   */
  private incomingCart(sim: SimState, cfg: SimConfig, selfIndex: number): CartThreat | null {
    if (!cfg.carts && !cfg.hurl) return null;
    const me = sim.fighters[selfIndex];
    const op = sim.fighters[1 - selfIndex];
    const winding = op.phase === 'throw' ? cfg.carts : op.phase === 'hurl' ? cfg.hurl : undefined;
    if (winding && op.phaseFrame <= winding.windup) { // == windup: it leaves the hand this tick
      const flight = Math.max(0, dist(me, op) - CART_FROM - BODY_RADIUS) / (winding.speed * TICK);
      return { line: op.stance, eta: winding.windup - op.phaseFrame + flight };
    }
    for (const c of sim.carts) {
      if (c.end || c.owner === selfIndex) continue;
      const rx = me.pos.x - c.x, rz = me.pos.z - c.z;
      const along = rx * c.dx + rz * c.dz;
      const off = Math.abs(rx * c.dz - rz * c.dx);
      if (along < 0 || off > BODY_RADIUS + 0.15) continue; // gone past, or not heading for us
      const perTick = (c.kind ? cfg.hurl! : cfg.carts!).speed * TICK;
      return { line: c.line, eta: Math.max(0, along - BODY_RADIUS) / perTick };
    }
    return null;
  }

  /**
   * Weapon thrown and gone: get it back. Walk (or dash, from afar) to
   * where it lies; back off while it's still in the air or they're
   * swinging at us — there's no guard without it.
   */
  private retrieve(sim: SimState, cfg: SimConfig, selfIndex: number, inp: InputFrame): InputFrame {
    const me = sim.fighters[selfIndex];
    const op = sim.fighters[1 - selfIndex];
    const w = me.weaponAt;
    const opMove = cfg.moves[1 - selfIndex][op.stance];
    const swinging = op.phase === 'windup' || op.phase === 'active';
    if (!w || (swinging && dist(me, op) < opMove.reach + 0.6)) {
      inp.moveY = -1;
      inp.dash = swinging;
      return inp;
    }
    const wx = w.x - me.pos.x, wz = w.z - me.pos.z;
    const len = Math.hypot(wx, wz) || 1;
    // world direction into our facing frame (facing tracks the opponent)
    inp.moveY = (wx * Math.sin(me.facing) + wz * Math.cos(me.facing)) / len;
    inp.moveX = (wx * Math.cos(me.facing) - wz * Math.sin(me.facing)) / len;
    inp.dash = len > 2.5;
    return inp;
  }

  /**
   * Our cut whiffed: maybe chain into another line — one they aren't
   * guarding, that would reach them and clear the furniture. Keep it
   * ready through the recovery: if they walk in to punish, it goes.
   */
  private chainCut(sim: SimState, cfg: SimConfig, selfIndex: number, inp: InputFrame): InputFrame {
    const me = sim.fighters[selfIndex];
    const op = sim.fighters[1 - selfIndex];
    if (me.didHit || me.chain >= cfg.chain!.max || op.phase === 'dead') return inp;
    if (this.chainRoll === null) this.chainRoll = this.rng() < this.profile.chain;
    if (!this.chainRoll) return inp;
    const d = dist(me, op);
    const facing = Math.atan2(op.pos.x - me.pos.x, op.pos.z - me.pos.z);
    const lines = LINES.filter((l) => {
      const m = cfg.moves[selfIndex][l];
      return l !== me.move!.line && !(op.phase === 'idle' && op.armed && op.stance === l)
        && d < m.reach + m.lunge * 0.12 && d > (m.minReach ?? 0)
        && !bladeObstruction(me, op, m, facing, cfg, sim);
    });
    if (lines.length === 0) return inp;
    inp.stance = lines.includes(me.stance) ? me.stance : lines[0]; // stick with the first pick
    inp.attack = true;
    return inp;
  }

  /**
   * Would a weapon (or cartridge) thrown on `line` from here fly clear of
   * the furniture to the opponent? Mirrors the sim's flight test.
   */
  private clearShot(sim: SimState, cfg: SimConfig, selfIndex: number, height: number): boolean {
    const me = sim.fighters[selfIndex];
    const op = sim.fighters[1 - selfIndex];
    const d = dist(me, op);
    const dx = (op.pos.x - me.pos.x) / d, dz = (op.pos.z - me.pos.z) / d;
    for (let r = CART_FROM; r < d - BODY_RADIUS; r += 0.1) {
      const x = me.pos.x + dx * r, z = me.pos.z + dz * r;
      for (let i = 0; i < cfg.obstacles.length; i++) {
        const ob = cfg.obstacles[i];
        if (ob.knockable || sim.obstacleState[i].down || ob.y1 < height) continue;
        const ox = x - ob.x, oz = z - ob.z;
        if (Math.abs(ox * ob.c - oz * ob.s) <= ob.halfW && Math.abs(ox * ob.s + oz * ob.c) <= ob.halfD) return false;
      }
    }
    return true;
  }

  /** Answer an incoming cartridge (the plan is rolled once per cart). */
  private dodgeCart(cart: CartThreat, inp: InputFrame): InputFrame {
    if (!this.noticedCart) {
      this.noticedCart = true;
      this.cartPlanDone = false;
      this.cartReact = Math.floor(this.profile.reaction * (0.6 + this.rng() * 0.9));
      this.cartPlan = this.rollPlan();
    }
    if (this.cartReact > 0) { this.cartReact--; return inp; }
    if (this.cartPlanDone) {
      if (this.cartPlan === 'retreat') inp.moveX = this.circleDir;
      return inp;
    }
    switch (this.cartPlan) {
      case 'freeze':
        break;
      case 'guard':
        inp.stance = cart.line; // a guard on its line knocks it away
        break;
      case 'parry':
        if (cart.eta > PARRY_WINDOW - 3) return inp; // not yet
        inp.parry = true;
        break;
      case 'retreat':
        inp.moveX = this.circleDir; // step off its path
        inp.dash = true;
        break;
      case 'trade':
        inp.moveY = 1; // take it and close the distance
        break;
    }
    this.cartPlanDone = true;
    return inp;
  }

  /** Roll [min, random extra] frames; no rng draw when there's no spread. */
  private frames([min, extra]: [number, number]): number {
    return extra > 0 ? min + Math.floor(this.rng() * extra) : min;
  }

  update(sim: SimState, cfg: SimConfig, selfIndex: number): InputFrame {
    const inp = this.decide(sim, cfg, selfIndex);
    if (sim.roundPhase === 'fight') {
      const me = sim.fighters[selfIndex];
      if (me.phase === 'idle' && inp.attack) this.holdBlockedCut(sim, cfg, selfIndex, inp);
      if (me.phase === 'idle') this.steerAroundFurniture(me, cfg, inp);
    }
    return inp;
  }

  /**
   * Don't swing into furniture: with a shelf or cabinet between us (or a
   * wall where a whiff would land), the cut would only rebound. Hold it and
   * sidestep for a clear line instead.
   */
  private holdBlockedCut(sim: SimState, cfg: SimConfig, selfIndex: number, inp: InputFrame): void {
    const me = sim.fighters[selfIndex];
    const op = sim.fighters[1 - selfIndex];
    const move = cfg.moves[selfIndex][inp.stance ?? me.stance];
    const facing = Math.atan2(op.pos.x - me.pos.x, op.pos.z - me.pos.z);
    if (!bladeObstruction(me, op, move, facing, cfg, sim)) return;
    inp.attack = false;
    if (inp.moveX === 0) inp.moveX = this.circleDir;
  }

  /**
   * If walking the intended direction would grind into solid furniture
   * (the walk itself is safe — the sim pushes us out — but we'd stand
   * still and get run down), swing sideways around the box instead.
   */
  private steerAroundFurniture(
    me: FighterState, cfg: SimConfig, inp: InputFrame,
  ): void {
    if (cfg.obstacles.length === 0 || (inp.moveX === 0 && inp.moveY === 0)) return;
    const fwd = { x: Math.sin(me.facing), z: Math.cos(me.facing) };
    const right = { x: Math.cos(me.facing), z: -Math.sin(me.facing) };
    const blocked = (mx: number, my: number): boolean => {
      let vx = right.x * mx + fwd.x * my;
      let vz = right.z * mx + fwd.z * my;
      const len = Math.hypot(vx, vz) || 1;
      vx /= len; vz /= len;
      const px = me.pos.x + vx * 0.9;
      const pz = me.pos.z + vz * 0.9;
      for (const ob of cfg.obstacles) {
        if (ob.knockable) continue; // cardboard never actually blocks
        const dx = px - ob.x, dz = pz - ob.z;
        const lx = dx * ob.c - dz * ob.s;
        const lz = dx * ob.s + dz * ob.c;
        if (Math.abs(lx) < ob.halfW + 0.42 && Math.abs(lz) < ob.halfD + 0.42) {
          return true;
        }
      }
      return false;
    };
    if (!blocked(inp.moveX, inp.moveY)) return;
    const candidates: [number, number][] = [
      [this.circleDir, inp.moveY], [-this.circleDir, inp.moveY],
      [this.circleDir, 0], [-this.circleDir, 0],
    ];
    for (const [mx, my] of candidates) {
      if (!blocked(mx, my)) {
        inp.moveX = mx;
        inp.moveY = my;
        this.circleDir = mx > 0 ? 1 : -1; // commit to the side that cleared
        return;
      }
    }
    inp.moveY = 0; // boxed in: at least stop grinding into the furniture
  }

  private decide(sim: SimState, cfg: SimConfig, selfIndex: number): InputFrame {
    if (sim.roundPhase !== 'fight') {
      this.noticedThreat = false;
      return { ...EMPTY_INPUT };
    }

    const me = sim.fighters[selfIndex];
    const op = sim.fighters[1 - selfIndex];
    const inp: InputFrame = { ...EMPTY_INPUT };
    if (me.phase === 'lock') {
      // tsubazeriai: push at a rate picked per lock (~4-9 shoves a second)
      if (this.lockRate < 0) this.lockRate = 0.07 + this.rng() * 0.08;
      inp.attack = this.rng() < this.lockRate;
      return inp;
    }
    this.lockRate = -1;
    if (me.phase === 'bow') {
      // keep bowing — unless they've already stopped and are coming over
      if (op.phase !== 'bow' && dist(me, op) < 3.4) inp.stance = me.stance;
      return inp;
    }
    if (me.phase === 'recovery' && cfg.chain) return this.chainCut(sim, cfg, selfIndex, inp);
    this.chainRoll = null;
    if (me.phase !== 'idle') return inp; // committed; inputs would be dropped anyway
    if (!me.armed) return this.retrieve(sim, cfg, selfIndex, inp);

    const d = dist(me, op);
    const myMove = cfg.moves[selfIndex][me.stance];
    const strikeRange = myMove.reach + myMove.lunge * 0.12; // reach + a bit of lunge carry

    // --- Threat response: opponent is swinging ---
    if (op.phase === 'windup' || op.phase === 'active') {
      if (!this.noticedThreat) {
        this.noticedThreat = true;
        this.planDone = false;
        this.reactLeft = Math.floor(this.profile.reaction * (0.6 + this.rng() * 0.9));
        this.plan = this.rollPlan();
      }
      if (this.reactLeft > 0) { this.reactLeft--; return inp; }
      if (!this.planDone) {
        switch (this.plan) {
          case 'freeze':
            break; // caught flat-footed: whatever stance it's in will have to do
          case 'guard':
            if (op.move && me.stance !== op.move.line) inp.stance = op.move.line;
            break;
          case 'parry': {
            // hold the press until the blade is about to go live
            const remaining = op.phase === 'windup' && op.move
              ? effWindup(op, op.move) - op.phaseFrame
              : 0;
            if (remaining <= PARRY_WINDOW - 3) {
              inp.parry = true;
              this.planDone = true;
            }
            return inp; // keep waiting; planDone stays false until pressed
          }
          case 'retreat':
            inp.moveY = -1;
            inp.dash = true;
            break;
          case 'trade': {
            // If our cut on their line would arrive with theirs, take that
            // line: the blades meet (tsubazeriai) instead of trading.
            if (op.phase === 'windup' && op.move) {
              const lag = effWindup(me, cfg.moves[selfIndex][op.move.line])
                - (effWindup(op, op.move) - op.phaseFrame);
              if (Math.abs(lag) <= CLASH_WINDUP_TAIL - 2) inp.stance = op.move.line;
            }
            if (d < strikeRange) inp.attack = true;
            else inp.moveY = -1;
            break;
          }
        }
        this.planDone = true;
      } else if (this.plan === 'retreat') {
        inp.moveY = -1;
      }
      return inp;
    }
    this.noticedThreat = false;

    const cart = this.incomingCart(sim, cfg, selfIndex);
    if (cart) return this.dodgeCart(cart, inp);
    this.noticedCart = false;

    // --- Punish windows ---
    const opening = op.phase === 'stagger' || op.phase === 'flinch' || op.phase === 'recovery'
      || op.phase === 'throw' || op.phase === 'hurl' // past the release (before it, it's incoming)
      || op.phase === 'pickup' || !op.armed // no guard at all until it's back in hand
      || (op.phase === 'parry' && op.phaseFrame >= PARRY_WINDOW);
    if (!opening) this.openingWait = -1;
    else {
      // a slower duelist takes a moment to see it (and may miss it entirely)
      if (this.openingWait < 0) this.openingWait = this.frames(this.profile.punishDelay);
      if (this.openingWait > 0) { this.openingWait--; return inp; }
    }
    // From inside our own dead zone, back up to killing range first.
    const myMin = myMove.minReach ?? 0;
    if (op.phase === 'stagger' || op.phase === 'flinch') {
      inp.moveY = d < myMin + 0.1 ? -1 : 1;
      if (d < strikeRange && d > myMin) inp.attack = true;
      return inp;
    }
    if (op.phase === 'parry' && op.phaseFrame >= PARRY_WINDOW) {
      // whiffed parry: locked out and unguarded
      inp.moveY = d < myMin + 0.1 ? -1 : 1;
      if (d < strikeRange && d > myMin) inp.attack = true;
      return inp;
    }
    if (op.phase === 'recovery' || op.phase === 'throw' || op.phase === 'hurl'
      || op.phase === 'pickup' || !op.armed) {
      inp.moveY = d < myMin + 0.1 ? -1 : 1;
      if (d < strikeRange * 0.98 && d > myMin) inp.attack = true;
      else if (d < 3.0 && d > myMin && this.rng() < 0.3) inp.dash = true;
      return inp;
    }

    // --- Neutral: spacing, circling, probing ---
    // Sit just outside our own strike range; crowd a wounded opponent.
    const opWounded = op.wounds.arm || op.wounds.leg;
    const oppMove = cfg.moves[1 - selfIndex][op.stance];
    let desired = myMove.reach + (opWounded ? -0.2 : 0.35);
    // Outranged by a polearm: dive inside the haft, where its cuts only glance
    const oppMin = oppMove.minReach ?? 0;
    if (oppMove.reach > myMove.reach && oppMin > 0) {
      desired = Math.min(desired, Math.max(0.85, oppMin - 0.15));
    }
    if (d > desired + 0.3) inp.moveY = 1;
    else if (d < desired - 0.35) inp.moveY = -1;

    if (--this.circleTimer <= 0) {
      this.circleDir = this.rng() < 0.5 ? -1 : 1;
      this.circleTimer = 40 + Math.floor(this.rng() * 90);
    }
    inp.moveX = this.circleDir * 0.7;

    if (--this.stanceTimer <= 0) {
      inp.stance = LINES[Math.floor(this.rng() * 3)] as Line;
      this.stanceTimer = 90 + Math.floor(this.rng() * 160);
    }

    if (--this.pokeTimer <= 0) {
      if (d < strikeRange + 0.5) {
        inp.attack = true;
        this.pokeTimer = this.frames(opWounded ? this.profile.pokeWounded : this.profile.poke);
      } else {
        this.pokeTimer = 20; // not in range yet, check again soon
      }
    }

    // From out of their reach, throw a cartridge on a line they aren't guarding
    if (!inp.attack && cfg.carts && me.carts > 0 && --this.throwTimer <= 0) {
      const theirReach = oppMove.reach + oppMove.lunge * 0.12;
      if (d > theirReach + 0.4 && d < 6.5) {
        const open = LINES.filter((l) => l !== op.stance);
        inp.stance = open[Math.floor(this.rng() * open.length)];
        inp.throw = true;
        this.throwTimer = this.frames(this.profile.throws);
      } else {
        this.throwTimer = 20;
      }
    }

    // Wounded and out of their reach: the last resort — hurl the weapon,
    // on a line they aren't guarding, when nothing tall is in the way
    const hurl = cfg.hurl;
    if (!inp.attack && !inp.throw && hurl && (me.wounds.arm || me.wounds.leg) && --this.hurlTimer <= 0) {
      const theirReach = oppMove.reach + oppMove.lunge * 0.12;
      const open = LINES.filter((l) => l !== op.stance && this.clearShot(sim, cfg, selfIndex, hurl.heights[l]));
      if (d > theirReach + 0.3 && d < 5 && open.length > 0) {
        inp.stance = open[Math.floor(this.rng() * open.length)];
        inp.hurl = true;
        this.hurlTimer = this.frames(this.profile.hurls);
      } else {
        this.hurlTimer = 20;
      }
    }

    return inp;
  }
}
