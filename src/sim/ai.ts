import { CLASH_WINDUP_TAIL, dist, effWindup, PARRY_WINDOW, SimConfig } from './sim';
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

type ThreatPlan = 'guard' | 'parry' | 'retreat' | 'trade';

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

  /** reaction: mean extra frames of delay. Lower = harder. */
  constructor(seed: number, private reaction = 12) {
    this.rng = mulberry32(seed);
  }

  update(sim: SimState, cfg: SimConfig, selfIndex: number): InputFrame {
    const inp = this.decide(sim, cfg, selfIndex);
    if (sim.roundPhase === 'fight') {
      const me = sim.fighters[selfIndex];
      if (me.phase === 'idle') this.steerAroundFurniture(me, cfg, inp);
    }
    return inp;
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
    if (me.phase !== 'idle') return inp; // committed; inputs would be dropped anyway

    const d = dist(me, op);
    const myMove = cfg.moves[selfIndex][me.stance];
    const strikeRange = myMove.reach + myMove.lunge * 0.12; // reach + a bit of lunge carry

    // --- Threat response: opponent is swinging ---
    if (op.phase === 'windup' || op.phase === 'active') {
      if (!this.noticedThreat) {
        this.noticedThreat = true;
        this.planDone = false;
        this.reactLeft = Math.floor(this.reaction * (0.6 + this.rng() * 0.9));
        const r = this.rng();
        this.plan =
          r < 0.42 ? 'guard' : r < 0.62 ? 'parry' : r < 0.85 ? 'retreat' : 'trade';
      }
      if (this.reactLeft > 0) { this.reactLeft--; return inp; }
      if (!this.planDone) {
        switch (this.plan) {
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

    // --- Punish windows ---
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
    if (op.phase === 'recovery') {
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
        this.pokeTimer = opWounded
          ? 40 + Math.floor(this.rng() * 70)
          : 70 + Math.floor(this.rng() * 130);
      } else {
        this.pokeTimer = 20; // not in range yet, check again soon
      }
    }

    return inp;
  }
}
