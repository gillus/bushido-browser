import { CartEnd, FighterPhase, Line, RoundPhase, SimState, WoundRegion } from './sim/types';

/**
 * Presentation events (audio, rumble) derived by diffing the sim before and
 * after a tick. Reads sim state, never writes it — the sim stays pure and
 * knows nothing about speakers or controllers.
 */
export type GameEvent =
  | { type: 'roundStart' }
  | { type: 'swing'; who: number }                // windup -> active
  | { type: 'deflect'; who: number }              // `who` (attacker) bounced off a stance guard
  | { type: 'parried'; who: number }              // `who` (attacker) got actively parried
  | { type: 'rebound'; who: number }              // `who`'s blade hit furniture or a wall
  | { type: 'parryTry'; who: number }
  | { type: 'clash' }                             // blades met: tsubazeriai
  | { type: 'push'; who: number }                 // `who` shoved the lock their way
  | { type: 'shove'; who: number }                // `who` lost the lock and staggers
  | { type: 'disengage' }
  | { type: 'wound'; who: number; region: WoundRegion }
  | { type: 'kill'; who: number; mutual: boolean } // `who` died
  | { type: 'dash'; who: number }
  | { type: 'step'; who: number; kneeling: boolean }
  | { type: 'stance'; who: number }
  | { type: 'topple'; prop: number }
  | { type: 'throw'; who: number }                // `who` let a cartridge go
  | { type: 'cart'; who: number; end: CartEnd }   // a cartridge aimed at `who` stopped
  | { type: 'hurl'; who: number }                 // `who` threw their weapon
  | { type: 'landed'; who: number; end: CartEnd } // a weapon thrown at `who` stopped (a hit is a wound/kill)
  | { type: 'pickup'; who: number }               // `who` has their weapon back
  | { type: 'dishonor'; who: number };            // `who` broke the honor code

export interface TickSnapshot {
  frame: number;
  roundPhase: RoundPhase;
  lockBalance: number;
  fighters: {
    phase: FighterPhase; stance: Line; dashLeft: number; step: number;
    wounds: Record<WoundRegion, boolean>; dishonored: boolean; armed: boolean;
  }[];
  downs: boolean[];
  carts: (CartEnd | null)[];
}

// Footfalls land at the extremes of the leg swing, sin(walkCycle * 5.2) in
// fighterView.ts — i.e. every π/5.2 m of travel.
const STRIDE_FREQ = 5.2;
function stepIndex(walkCycle: number): number {
  return Math.floor((walkCycle * STRIDE_FREQ - Math.PI / 2) / Math.PI);
}

export function snapshot(sim: SimState): TickSnapshot {
  return {
    frame: sim.frame,
    roundPhase: sim.roundPhase,
    lockBalance: sim.lockBalance,
    fighters: sim.fighters.map((f) => ({
      phase: f.phase, stance: f.stance, dashLeft: f.dashLeft,
      step: stepIndex(f.walkCycle), wounds: { ...f.wounds }, dishonored: f.dishonored, armed: f.armed,
    })),
    downs: sim.obstacleState.map((s) => s.down),
    carts: sim.carts.map((c) => c.end),
  };
}

export function diffTick(before: TickSnapshot, sim: SimState): GameEvent[] {
  const out: GameEvent[] = [];
  if (before.frame === 0) out.push({ type: 'roundStart' }); // fresh sim (load / R)
  // cartridges (and weapons) still in the air when the round ends land meanwhile
  sim.carts.forEach((c, i) => {
    if (i >= before.carts.length) out.push({ type: c.kind ? 'hurl' : 'throw', who: c.owner });
    if (c.end && !before.carts[i]) out.push({ type: c.kind ? 'landed' : 'cart', who: 1 - c.owner, end: c.end });
  });
  if (before.roundPhase === 'end') {
    // a round reset swaps in fresh fighters; nothing else to diff on that tick
    if (sim.roundPhase === 'fight') out.push({ type: 'roundStart' });
    return out;
  }

  const wasLocked = before.fighters[0].phase === 'lock';
  const locked = sim.fighters[0].phase === 'lock';
  if (!wasLocked && locked) out.push({ type: 'clash' });
  if (wasLocked && locked && sim.lockBalance !== before.lockBalance) {
    out.push({ type: 'push', who: sim.lockBalance > before.lockBalance ? 0 : 1 });
  }
  if (wasLocked && !locked) {
    const loser = sim.fighters.findIndex((f) => f.phase === 'stagger');
    out.push(loser >= 0 ? { type: 'shove', who: loser } : { type: 'disengage' });
  }

  const bothDead = sim.fighters.every((f) => f.phase === 'dead');
  for (let i = 0; i < 2; i++) {
    const b = before.fighters[i];
    const f = sim.fighters[i];
    const o = before.fighters[1 - i];
    if (f.phase !== b.phase) {
      if (b.phase === 'windup' && f.phase === 'active') out.push({ type: 'swing', who: i });
      else if (f.phase === 'stagger' && f.rebound) out.push({ type: 'rebound', who: i });
      else if (f.phase === 'stagger' && b.phase !== 'lock') {
        out.push({ type: o.phase === 'parry' ? 'parried' : 'deflect', who: i });
      } else if (f.phase === 'parry') out.push({ type: 'parryTry', who: i });
      else if (f.phase === 'dead') out.push({ type: 'kill', who: i, mutual: bothDead });
    }
    // a flinch is a wound only if a wound appeared (a cartridge flinches too)
    for (const region of ['arm', 'leg'] as const) {
      if (f.wounds[region] && !b.wounds[region]) out.push({ type: 'wound', who: i, region });
    }
    if (f.dishonored && !b.dishonored) out.push({ type: 'dishonor', who: i });
    if (f.armed && !b.armed) out.push({ type: 'pickup', who: i });
    if (f.stance !== b.stance) out.push({ type: 'stance', who: i });
    if (f.dashLeft > 0 && b.dashLeft <= 0) out.push({ type: 'dash', who: i });
    if (f.phase !== 'dead' && stepIndex(f.walkCycle) > b.step) {
      out.push({ type: 'step', who: i, kneeling: f.wounds.leg });
    }
  }

  sim.obstacleState.forEach((s, i) => {
    if (s.down && !before.downs[i]) out.push({ type: 'topple', prop: i });
  });
  return out;
}
