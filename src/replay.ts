import { SimState } from './sim/types';

const LEAD = 80;  // ticks of lead-up kept before the kill
const TAIL = 50;  // ticks after it — the live sim runs this far before the replay cuts in
const SLOW = 0.25; // playback speed at the moment of the cut
const MIN_WATCH = 0.5; // seconds before a press may skip it (mashing attack mustn't)

/**
 * The kill replay. `record` keeps a ring of whole sim states (deep copies —
 * the sim is plain data); after a kill main stops ticking the live sim, and
 * `play` hands back recorded states to drive the same views through the
 * last couple of seconds again, easing into slow motion at the cut and back
 * out as the body drops. The live sim is only delayed, never changed, so
 * determinism is untouched; render-only things (ragdoll, debris) just run
 * again on top of whatever they left behind.
 */
export class Replay {
  private ring: SimState[] = [];
  private sinceKill = -1;
  private frames: SimState[] = [];
  private killAt = 0;
  private t = 0;
  private watched = 0;

  /** Forget the history — a new round can't replay the last one. */
  clear(sim: SimState): void {
    this.ring = [structuredClone(sim)];
    this.sinceKill = -1;
    this.frames = [];
  }

  /** Keep the state after a live tick; true once it's time to cut to the replay. */
  record(sim: SimState, killed: boolean): boolean {
    this.ring.push(structuredClone(sim));
    if (this.ring.length > LEAD + TAIL + 1) this.ring.shift();
    if (killed && this.sinceKill < 0) this.sinceKill = 0;
    else if (this.sinceKill >= 0) this.sinceKill++;
    if (this.sinceKill !== TAIL) return false;
    this.frames = this.ring.slice();
    this.killAt = this.frames.length - 1 - TAIL;
    this.t = 0;
    this.watched = 0;
    return true;
  }

  get playing(): boolean { return this.frames.length > 0; }
  get skippable(): boolean { return this.watched >= MIN_WATCH; }

  /** The state to show first, before any time passes. */
  get first(): SimState { return this.frames[0]; }

  /**
   * Advance by `dt` real seconds. Returns the states passed (oldest first,
   * for the sound diff), the playback speed (scale view dt by it), and how
   * far through the replay it is (0–1); `done` once it has run out.
   */
  play(dt: number): { states: SimState[]; speed: number; progress: number; done: boolean } {
    const from = Math.floor(this.t);
    const speed = this.speedAt(this.t);
    this.t = Math.min(this.frames.length - 1, this.t + dt * 60 * speed);
    this.watched += dt;
    const to = Math.floor(this.t);
    return {
      states: this.frames.slice(from + 1, to + 1),
      speed,
      progress: this.t / (this.frames.length - 1),
      done: this.t >= this.frames.length - 1,
    };
  }

  /** The state on screen now. */
  get current(): SimState { return this.frames[Math.floor(this.t)]; }

  stop(): void { this.frames = []; this.sinceKill = -1; }

  /** Real time far from the cut, `SLOW` around it, the fall back up to half. */
  private speedAt(t: number): number {
    const ramp = (x: number): number => Math.max(0, Math.min(1, x));
    const k = this.killAt;
    if (t < k) return SLOW + (1 - SLOW) * ramp((k - 10 - t) / 40);
    return SLOW + (0.5 - SLOW) * ramp((t - k - 20) / 25);
  }
}
