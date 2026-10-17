import { GameEvent } from './events';
import { WeaponDef } from './sim/types';

/**
 * Procedural Web Audio sound: every effect is synthesized from oscillators
 * and one noise buffer — no audio files, so the bundle stays tiny. Sounds
 * are what the props would really make (cardboard thock, broom whoosh,
 * sneaker squeak on linoleum); the framing (hyoshigi clappers, taiko on a
 * kill) plays it straight, like the HUD does.
 */

const MUTE_KEY = 'bushido.muted';
const MASTER = 0.8;
const SILENT = 0.0001; // exponential ramps can't reach 0

function loadMuted(): boolean {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private pans: [number, number] = [0, 0];
  muted = loadMuted();

  /** `hum`: fluorescent-tube mains buzz under everything (indoor stages). */
  constructor(private weapons: [WeaponDef, WeaponDef], private hum: boolean) {
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) void this.ctx.suspend();
      else void this.ctx.resume();
    });
  }

  /** Browsers keep audio locked until a user gesture; call from one. */
  unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 6;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER;
      this.master.connect(comp);
      this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      if (this.hum) this.startHum();
    }
    if (this.ctx.state === 'suspended' && !document.hidden) void this.ctx.resume();
  }

  get locked(): boolean { return !this.ctx || this.ctx.state !== 'running'; }

  toggleMute(): void {
    this.muted = !this.muted;
    try { localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0'); } catch { /* private mode */ }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : MASTER, this.ctx.currentTime, 0.02);
  }

  /** Stereo position of each fighter, -1 (left of screen) .. 1 (right). */
  setPan(i: number, x: number): void {
    this.pans[i] = Math.max(-0.7, Math.min(0.7, x));
  }

  play(ev: GameEvent): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return;
    const t = ctx.currentTime + 0.005;
    const v = (i: number) => this.voice(this.pans[i]);
    switch (ev.type) {
      case 'roundStart': {
        // hyoshigi: two hardwood clappers
        const out = this.voice(0);
        for (const dt of [0, 0.3]) {
          this.tone(out, t + dt, 'triangle', 2100, 1900, 0.07, 0.35);
          this.tone(out, t + dt, 'sine', 3350, 3200, 0.05, 0.15);
          this.noiseHit(out, t + dt, 0.03, 'bandpass', 2600, 2600, 6, 0.5);
        }
        break;
      }
      case 'swing': {
        // longer weapon = lower, slower whoosh; the broom drags a bristle hiss
        const w = this.weapons[ev.who];
        const len = w.bladeLength + w.shaftLength;
        const dur = 0.14 + 0.08 * len;
        const f = 1500 / Math.sqrt(len);
        const out = v(ev.who);
        this.whoosh(out, t, dur, f * 0.5, f * 1.3, 0.55);
        if (w.look === 'broom') this.noiseHit(out, t + dur * 0.3, dur * 0.6, 'highpass', 5000, 3500, 0.7, 0.12, dur * 0.3);
        break;
      }
      case 'deflect': {
        // cardboard on cardboard: hollow tube resonance
        const out = v(ev.who);
        this.tone(out, t, 'triangle', 340, 250, 0.16, 0.55);
        this.tone(out, t, 'sine', 170, 140, 0.2, 0.4);
        this.noiseHit(out, t, 0.06, 'bandpass', 900, 600, 3, 0.45);
        break;
      }
      case 'parried': {
        // sharper and louder than a deflect, with a rebound knock
        const out = v(ev.who);
        this.noiseHit(out, t, 0.025, 'highpass', 2500, 2500, 0.7, 0.6);
        this.tone(out, t, 'triangle', 560, 330, 0.18, 0.7);
        this.tone(out, t + 0.07, 'triangle', 300, 220, 0.14, 0.35);
        break;
      }
      case 'parryTry':
        this.whoosh(v(ev.who), t, 0.08, 1500, 3200, 0.12);
        break;
      case 'wound': {
        const out = v(ev.who);
        this.noiseHit(out, t, 0.12, 'lowpass', 1400, 300, 0.7, 0.8);
        this.tone(out, t, 'sine', 120, 60, 0.15, 0.55);
        break;
      }
      case 'kill': {
        const out = v(ev.who);
        this.noiseHit(out, t, 0.2, 'lowpass', 2600, 200, 0.7, 1.0);
        this.tone(out, t, 'sine', 95, 40, 0.3, 0.9);
        // body meets linoleum (the ragdoll takes about this long to land)
        for (const [dt, g] of [[0.45, 0.7], [0.72, 0.35]]) {
          this.tone(out, t + dt, 'sine', 75, 35, 0.25, g);
          this.noiseHit(out, t + dt, 0.15, 'lowpass', 450, 150, 0.7, g * 0.6);
        }
        // one o-daiko hit per round, even for ai-uchi
        if (!ev.mutual || ev.who === 0) {
          const drum = this.voice(0);
          this.tone(drum, t + 1.0, 'sine', 58, 41, 1.8, 0.95, 0.004);
          this.noiseHit(drum, t + 1.0, 0.3, 'lowpass', 220, 90, 0.7, 0.5);
        }
        break;
      }
      case 'dash': {
        // sneaker squeak on linoleum
        const out = v(ev.who);
        const f = 1500 + Math.random() * 400;
        this.tone(out, t, 'triangle', f, f * 1.45, 0.09, 0.09, 0.01);
        this.noiseHit(out, t, 0.07, 'highpass', 3000, 3000, 0.7, 0.1);
        break;
      }
      case 'step': {
        const out = v(ev.who);
        const r = 0.9 + Math.random() * 0.2;
        if (ev.kneeling) this.noiseHit(out, t, 0.16, 'bandpass', 800 * r, 500 * r, 1.5, 0.07, 0.04); // knee drag
        else {
          this.noiseHit(out, t, 0.05, 'lowpass', 700 * r, 300 * r, 0.7, 0.09);
          this.tone(out, t, 'sine', 95 * r, 60 * r, 0.05, 0.1);
        }
        break;
      }
      case 'stance':
        // grip shifting on the handle
        this.noiseHit(v(ev.who), t, 0.045, 'bandpass', 2400, 1800, 2, 0.08);
        break;
      case 'topple': {
        // the standee goes down: a slap of cardboard, then it lands flat
        const out = this.voice(0);
        this.whoosh(out, t, 0.2, 400, 900, 0.12);
        this.noiseHit(out, t + 0.28, 0.22, 'lowpass', 1100, 200, 0.7, 0.55);
        this.tone(out, t + 0.28, 'sine', 85, 50, 0.18, 0.35);
        break;
      }
    }
  }

  // ---------- building blocks ----------

  private voice(pan: number): AudioNode {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = pan;
    p.connect(this.master);
    return p;
  }

  private envelope(t: number, dur: number, peak: number, attack: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(SILENT, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(SILENT, t + dur);
    return g;
  }

  private tone(
    out: AudioNode, t: number, type: OscillatorType,
    f0: number, f1: number, dur: number, peak: number, attack = 0.002,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.envelope(t, dur, peak, attack);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noiseHit(
    out: AudioNode, t: number, dur: number, type: BiquadFilterType,
    f0: number, f1: number, q: number, peak: number, attack = 0.002,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.envelope(t, dur, peak, attack);
    src.connect(filt).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  /** Band-passed noise that swells and sweeps up then back down — air being cut. */
  private whoosh(out: AudioNode, t: number, dur: number, fLo: number, fHi: number, peak: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.Q.value = 1.6;
    filt.frequency.setValueAtTime(fLo, t);
    filt.frequency.exponentialRampToValueAtTime(fHi, t + dur * 0.45);
    filt.frequency.exponentialRampToValueAtTime(fLo * 0.8, t + dur);
    const g = this.envelope(t, dur, peak, dur * 0.4);
    src.connect(filt).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  private startHum(): void {
    // 50 Hz mains -> 100 Hz ballast buzz, low-passed to a background drone
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 450;
    const g = ctx.createGain();
    g.gain.value = 0.018;
    lp.connect(g).connect(this.master);
    for (const [type, f] of [['sawtooth', 100], ['sine', 50]] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      osc.connect(lp);
      osc.start();
    }
  }
}
