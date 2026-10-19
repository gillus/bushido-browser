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
      case 'rebound': {
        // weapon into shop fittings: a dull knock, then the stock rattles
        const out = v(ev.who);
        this.tone(out, t, 'triangle', 190, 115, 0.14, 0.6);
        this.noiseHit(out, t, 0.08, 'lowpass', 1300, 350, 0.7, 0.5);
        for (let k = 0; k < 4; k++) {
          this.noiseHit(out, t + 0.05 + k * 0.035 + Math.random() * 0.03, 0.025,
            'bandpass', 2600 + Math.random() * 1400, 2200, 4, 0.12);
        }
        break;
      }
      case 'clash': {
        // both weapons meet full force: two thocks on top of each other + crumple
        const out = this.voice((this.pans[0] + this.pans[1]) / 2);
        this.tone(out, t, 'triangle', 300, 210, 0.22, 0.6);
        this.tone(out, t, 'triangle', 190, 150, 0.26, 0.5);
        this.noiseHit(out, t, 0.1, 'bandpass', 1100, 500, 2.5, 0.7);
        this.noiseHit(out, t + 0.02, 0.18, 'lowpass', 900, 250, 0.7, 0.35);
        break;
      }
      case 'push':
        // cardboard creaking under load
        this.noiseHit(this.voice((this.pans[0] + this.pans[1]) / 2), t, 0.07, 'bandpass',
          650 + Math.random() * 300, 450, 5, 0.14);
        break;
      case 'shove': {
        const out = v(ev.who);
        this.whoosh(out, t, 0.18, 500, 1300, 0.3);
        this.tone(out, t, 'triangle', 230, 140, 0.16, 0.45);
        break;
      }
      case 'disengage':
        this.whoosh(this.voice(0), t, 0.16, 700, 1600, 0.18);
        break;
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
      case 'throw':
        // a flick of the wrist, then the cart fluttering through the air
        this.whoosh(v(ev.who), t, 0.1, 1800, 3600, 0.22);
        this.whoosh(v(ev.who), t + 0.06, 0.22, 2400, 3000, 0.08);
        break;
      case 'cart': {
        // hollow plastic: a clack off whatever stopped it, then on the floor
        const out = v(ev.who);
        if (ev.end === 'hit') {
          this.tone(out, t, 'sine', 210, 120, 0.09, 0.45); // into a body
          this.noiseHit(out, t, 0.05, 'bandpass', 1500, 1100, 2, 0.4);
        } else {
          const f = ev.end === 'parry' ? 1500 : ev.end === 'guard' ? 1200 : 900;
          this.tone(out, t, 'triangle', f, f * 0.7, 0.06, 0.4);
          this.noiseHit(out, t, 0.04, 'bandpass', f * 2.2, f * 1.6, 3, 0.35);
        }
        for (const [dt, g] of [[0.32, 0.22], [0.42, 0.1]]) {
          const f = 1700 + Math.random() * 500;
          this.tone(out, t + dt, 'triangle', f, f * 0.8, 0.04, g);
          this.noiseHit(out, t + dt, 0.03, 'bandpass', 3200, 2600, 3, g * 0.8);
        }
        break;
      }
      case 'hurl': {
        // the weapon leaves the hand: a grunt of effort, then it whirls
        // end over end — a slow wub-wub of air as it comes round
        const w = this.weapons[ev.who];
        const len = w.bladeLength + w.shaftLength;
        const out = v(ev.who);
        this.whoosh(out, t, 0.12, 500, 1100, 0.35);
        for (let k = 1; k <= 4; k++) {
          this.whoosh(out, t + k * 0.09 * Math.sqrt(len), 0.08, 700 / Math.sqrt(len), 1400, 0.2 / k);
        }
        break;
      }
      case 'landed': {
        // a hit is heard as the wound or the kill; anything else is the
        // weapon knocked aside or into the furniture, then clattering down
        if (ev.end === 'hit') break;
        const out = v(ev.who);
        if (ev.end === 'guard' || ev.end === 'parry') {
          this.tone(out, t, 'triangle', 380, 260, 0.14, 0.55);
          this.noiseHit(out, t, 0.05, 'bandpass', 1000, 700, 3, 0.45);
        } else {
          this.noiseHit(out, t, 0.08, 'lowpass', 900, 250, 0.7, 0.5);
          this.tone(out, t, 'sine', 140, 80, 0.12, 0.4);
        }
        for (const [dt, g] of [[0.38, 0.3], [0.5, 0.14], [0.58, 0.07]]) {
          this.tone(out, t + dt, 'triangle', 240 + Math.random() * 60, 170, 0.07, g);
          this.noiseHit(out, t + dt, 0.05, 'bandpass', 1300, 900, 2, g);
        }
        break;
      }
      case 'chain':
        // the weapon wrenched round mid-recovery: a short drag of air and a squeak of grip
        this.whoosh(v(ev.who), t, 0.09, 600, 1300, 0.18);
        this.noiseHit(v(ev.who), t, 0.05, 'bandpass', 2600, 2000, 2, 0.1);
        break;
      case 'feint': {
        // the cut checked: a hard sneaker stamp (the kendo seme) and a squeak of grip
        const out = v(ev.who);
        this.noiseHit(out, t, 0.07, 'lowpass', 900, 300, 0.7, 0.3);
        this.tone(out, t, 'sine', 110, 55, 0.09, 0.35);
        this.tone(out, t + 0.02, 'triangle', 1700, 2300, 0.06, 0.05, 0.01);
        this.noiseHit(out, t + 0.03, 0.05, 'bandpass', 2400, 1800, 2, 0.08);
        break;
      }
      case 'sidestep': {
        // a sneaker pivoting on linoleum, and the shirt swishing round
        const out = v(ev.who);
        const f = 1100 + Math.random() * 300;
        this.tone(out, t, 'triangle', f, f * 0.8, 0.13, 0.08, 0.01);
        this.noiseHit(out, t + 0.01, 0.16, 'bandpass', 700, 1600, 1.2, 0.12);
        break;
      }
      case 'slip': {
        // the thrust hisses through where they were; the thruster skids on
        const out = v(ev.who);
        this.noiseHit(out, t, 0.14, 'bandpass', 3200, 900, 1.5, 0.22);
        this.tone(out, t + 0.06, 'triangle', 1900, 1300, 0.16, 0.08, 0.01);
        break;
      }
      case 'pickup':
        // back in hand: the grip scraped up off the floor and squeezed
        this.noiseHit(v(ev.who), t, 0.1, 'bandpass', 1400, 2200, 1.5, 0.12);
        this.tone(v(ev.who), t + 0.08, 'triangle', 300, 260, 0.06, 0.15);
        break;
      case 'dishonor': {
        // a cracked temple bell: two low tones a semitone apart, beating
        const out = this.voice(0);
        this.tone(out, t, 'sine', 98, 96, 2.2, 0.5, 0.004);
        this.tone(out, t, 'sine', 104, 101, 2.0, 0.4, 0.004);
        this.tone(out, t, 'triangle', 392, 380, 0.9, 0.12, 0.004);
        this.noiseHit(out, t, 0.12, 'bandpass', 700, 500, 2, 0.25);
        break;
      }
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

  /** Plate glass giving way: a crash, then the pieces landing for a while. */
  glass(pan: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return;
    const t = ctx.currentTime + 0.005;
    const out = this.voice(Math.max(-0.7, Math.min(0.7, pan)));
    this.noiseHit(out, t, 0.35, 'highpass', 3000, 1800, 0.7, 0.75);
    this.noiseHit(out, t, 0.12, 'bandpass', 1200, 700, 1.5, 0.5);
    this.tone(out, t, 'sine', 110, 55, 0.2, 0.4);
    // tinkling as shards hit the floor
    for (let i = 0; i < 16; i++) {
      const dt = 0.08 + Math.random() * 0.9;
      const f = 3000 + Math.random() * 5000;
      this.tone(out, t + dt, 'sine', f, f * 0.97, 0.05 + Math.random() * 0.08, 0.05 + Math.random() * 0.1);
    }
  }

  /** A CRT tube going: a hollow implosion thump, then the glass. */
  crt(pan: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return;
    const t = ctx.currentTime + 0.005;
    const out = this.voice(Math.max(-0.7, Math.min(0.7, pan)));
    this.tone(out, t, 'sine', 90, 32, 0.35, 0.7);
    this.noiseHit(out, t, 0.18, 'lowpass', 900, 200, 1, 0.6);
    this.tone(out, t, 'sawtooth', 15700, 15000, 0.08, 0.04); // the flyback whine cutting out
    this.glass(pan);
  }

  /** Electrical crackle from a smashed set. */
  spark(pan: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return;
    const t = ctx.currentTime + 0.005;
    const out = this.voice(Math.max(-0.7, Math.min(0.7, pan)));
    for (let i = 0; i < 4; i++) {
      this.noiseHit(out, t + i * 0.03 + Math.random() * 0.02, 0.03, 'highpass', 2500, 1500, 0.8, 0.35);
    }
    this.tone(out, t, 'sawtooth', 120, 100, 0.12, 0.08);
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
