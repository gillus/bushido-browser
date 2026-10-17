import { StageProp } from '../sim/types';
import { CrtCabinet, CrtScreen, SCR_H, SCR_W } from './cabinet';
import { BoxBatch, c, signMesh } from './fixtures';

const DEMO_SECS = 10, TITLE_SECS = 5;
const TILT = -0.18;  // the monitor leans back
const DECK = 0.9;    // control panel height
const SLOPE = 0.22;  // control panel tilt toward the player

/**
 * Upright arcade cabinet (`"fixture": "arcade"`): side panels with stripe
 * art, coin door, a two-player control panel (sticks, six buttons each), a
 * tilted monitor running a side-scrolling shooter's attract loop, and a lit
 * marquee (`label`) under the hood. Breaks like any `CrtCabinet` — the
 * marquee is the piece that comes off.
 */
export class Arcade extends CrtCabinet {
  constructor(p: StageProp) {
    const name = p.label ?? 'SOLAR LANCER';
    super(p, new CrtScreen((g, t) => {
      t %= DEMO_SECS + TITLE_SECS;
      if (t > DEMO_SECS) titleCard(g, t - DEMO_SECS, name);
      else shooter(g, t);
    }));
    const [w, h, d] = p.size;
    const b = new BoxBatch();
    const body = c(p.color), trim = c('#0b0b0d'), dark = c('#121317');
    const accentHex = p.accent ?? '#c8402a', accent = c(accentHex), shade = c(accentHex, 0.55);
    const front = d / 2, back = -d / 2, side = 0.03, inner = w - 2 * side;
    const hood = h - 0.27, lid = h - 0.024, upperFront = front - 0.2, hoodFront = front - 0.12;

    // side panels: full depth up to the deck, set back above it, the hood overhanging
    for (const s of [-1, 1]) {
      const x = s * (w / 2 - side / 2), out = s * (w / 2 + 0.001);
      b.box(x, DECK / 2, 0, side, DECK, d, body);
      b.box(x, (DECK + hood) / 2, (back + upperFront) / 2, side, hood - DECK, upperFront - back, body);
      b.box(x, (hood + lid) / 2, (back + hoodFront) / 2, side, lid - hood, hoodFront - back, body);
      // T-molding on the front edges
      b.box(x, DECK / 2, front - 0.006, side + 0.006, DECK, 0.012, trim);
      b.box(x, (DECK + hood) / 2, upperFront - 0.006, side + 0.006, hood - DECK, 0.012, trim);
      b.box(x, (hood + lid) / 2, hoodFront - 0.006, side + 0.006, lid - hood, 0.012, trim);
      // side art: stripes raking up toward the back, a block of colour above
      for (let k = 0; k < 3; k++) b.box(out, 0.42 + k * 0.18, -0.06, 0.003, 0.05, 0.6, k === 1 ? accent : shade, 0.55, 0, false);
      b.box(out, (DECK + hood) / 2 + 0.04, -0.14, 0.003, hood - DECK - 0.2, 0.42, shade, 0, 0, false);
    }

    // base: kick plate, front panel, coin door with lit slots
    const baseFront = front - 0.07;
    b.box(0, DECK / 2, (back + baseFront) / 2, inner, DECK, baseFront - back, body);
    b.box(0, 0.06, baseFront + 0.006, inner, 0.12, 0.012, trim);
    b.box(0, 0.5, baseFront + 0.005, 0.3, 0.34, 0.01, c('#4d5058'));
    for (const s of [-1, 1]) {
      b.box(s * 0.07, 0.6, baseFront + 0.012, 0.045, 0.07, 0.006, c('#e8443a'), 0, 0, false);
      b.box(s * 0.07, 0.6, baseFront + 0.016, 0.006, 0.04, 0.003, trim, 0, 0, false);
      b.box(s * 0.07, 0.48, baseFront + 0.012, 0.04, 0.03, 0.006, c('#2a2b30'), 0, 0, false);
    }
    b.box(0, 0.38, baseFront + 0.012, 0.012, 0.012, 0.004, c('#c9c2b0'), 0, 0, false); // lock

    // control panel, sloped toward the player, with its overlay
    const pz = front - 0.17, pd = 0.34;
    b.box(0, DECK, pz, w + 0.01, 0.05, pd, dark, SLOPE);
    const on = onDeck(DECK, pz, SLOPE);
    b.box(...on(0, 0.001, 0), w - 0.04, 0.002, pd - 0.04, shade, SLOPE, 0, false);
    b.box(...on(0, 0.002, pd / 2 - 0.035), w - 0.04, 0.002, 0.012, accent, SLOPE, 0, false);
    const caps = ['#c8403a', '#e8c84a', '#3f7fd0', '#3f9f6a', '#c86aa8', '#f4f1e8'];
    for (const [px, ball] of [[-0.24, '#c8403a'], [0.16, '#3f7fd0']] as const) {
      b.box(...on(px, 0.002, 0.01), 0.05, 0.004, 0.05, trim, SLOPE);       // dust washer
      b.box(...on(px, 0.035, 0.01), 0.012, 0.07, 0.012, trim, SLOPE);      // shaft
      b.box(...on(px, 0.075, 0.01), 0.04, 0.04, 0.04, c(ball), SLOPE);       // ball top
      for (let k = 0; k < 6; k++) {
        const bx = px + 0.09 + (k % 3) * 0.045 + (k < 3 ? 0 : -0.01), bz = k < 3 ? -0.025 : 0.025;
        b.box(...on(bx, 0.006, bz), 0.03, 0.012, 0.03, c(caps[k]), SLOPE);
      }
    }
    for (const s of [-1, 1]) b.box(...on(s * 0.04, 0.005, -0.12), 0.022, 0.01, 0.022, c('#f4f1e8'), SLOPE); // starts

    // upper body, the monitor bezel tilted back, a sill between it and the panel
    b.box(0, (DECK + hood) / 2, (back + upperFront - 0.12) / 2, inner, hood - DECK, upperFront - 0.12 - back, body);
    const by = (DECK + hood) / 2 + 0.03, bz = upperFront - 0.06, bh = hood - DECK - 0.1;
    b.box(0, by, bz, inner, bh, 0.03, trim, TILT);
    b.box(0, DECK + 0.06, upperFront - 0.04, inner, 0.06, 0.08, dark);
    const n = [Math.sin(-TILT), Math.cos(TILT)]; // the bezel's face normal (y, z)
    const sw = Math.min(inner - 0.1, (bh - 0.1) * 4 / 3);
    b.box(0, by + n[0] * 0.017, bz + n[1] * 0.017, sw + 0.05, sw * 0.75 + 0.04, 0.004, c('#050506'), TILT, 0, false);
    const glass = this.tube(sw, sw * 0.75);
    glass.position.set(0, by + n[0] * 0.021, bz + n[1] * 0.021);
    glass.rotation.x = TILT;

    // the hood: lid, back of the marquee box, a light strip shining down on the screen
    b.box(0, (hood + lid) / 2, (back + hoodFront - 0.05) / 2, inner, lid - hood, hoodFront - 0.05 - back, body);
    b.box(0, (lid + h) / 2, (back + hoodFront) / 2, w + 0.006, h - lid, hoodFront - back + 0.006, trim);
    b.box(0, hood + 0.012, hoodFront - 0.03, inner, 0.024, 0.06, c('#e8e4da'));
    this.body.add(b.mesh());

    // the marquee, across the front of the hood — its own piece, it comes off
    const mh = lid - hood - 0.03;
    const tb = new BoxBatch();
    tb.box(0, 0, 0, inner, mh, 0.03, trim);
    const sign = signMesh(name, accentHex, inner - 0.03, mh - 0.03);
    sign.position.z = 0.016;
    this.topper.add(tb.mesh(), sign);
    this.topper.position.set(0, (hood + lid) / 2, hoodFront - 0.035);
  }
}

/**
 * Points on top of the control panel, centred at (0, y, z) and pitched by
 * `rx`: (lx, up, lz) on its surface → cabinet frame, tilted with it.
 */
function onDeck(y: number, z: number, rx: number): (lx: number, up: number, lz: number) => [number, number, number] {
  const cos = Math.cos(rx), sin = Math.sin(rx);
  return (lx, up, lz) => {
    up += 0.025;
    return [lx, y + up * cos - lz * sin, z + up * sin + lz * cos];
  };
}

/** Ship's height on the screen at time `s`. */
const shipY = (s: number): number => 40 + 16 * Math.sin(s * 1.1);

/** Side-scrolling shooter demo, `t` seconds in: it shoots down a conga line of drones, forever. */
function shooter(g: CanvasRenderingContext2D, t: number): void {
  g.fillStyle = '#05040c'; g.fillRect(0, 0, SCR_W, SCR_H);
  // three layers of parallax stars
  for (let i = 0; i < 36; i++) {
    const layer = i % 3;
    const x = (((i * 47) % SCR_W) - t * (8 + layer * 14)) % SCR_W;
    g.fillStyle = ['#3a3a5a', '#7a7aa0', '#e8e8f4'][layer];
    g.fillRect(Math.floor(x < 0 ? x + SCR_W : x), (i * 29 + layer * 7) % 80, layer === 2 ? 2 : 1, 1);
  }
  // the cavern floor scrolling past
  for (let x = 0; x < SCR_W; x += 2) {
    const u = x + t * 30;
    const top = Math.round(SCR_H - 12 - 6 * Math.sin(u * 0.045) - 3 * Math.sin(u * 0.13));
    g.fillStyle = '#3b2a5c'; g.fillRect(x, top, 2, SCR_H - top);
    g.fillStyle = '#7a5fb0'; g.fillRect(x, top, 2, 1);
  }
  // shots: one every sixth of a second, each from where the ship was
  const sx = 16, sy = Math.round(shipY(t)), P = 1 / 6;
  g.fillStyle = '#9ff0ff';
  for (let k = 0; k < 5; k++) {
    const tf = (Math.floor(t / P) - k) * P, bx = sx + 14 + (t - tf) * 160;
    if (bx < SCR_W) g.fillRect(Math.round(bx), Math.round(shipY(tf)) + 1, 5, 1);
  }
  // drones snaking in along one path; each one meets the stream at x ≈ 50
  for (let i = 0; i < 6; i++) {
    const life = (t + i * 0.35) % 6;
    const ex = SCR_W + 8 - life * 40, ey = Math.round(34 + 14 * Math.sin(ex * 0.06));
    const boom = (SCR_W + 8 - 50) / 40;
    if (life < boom) {
      g.fillStyle = '#d0602a'; g.fillRect(Math.round(ex), ey, 7, 5);
      g.fillStyle = '#f4f1e8'; g.fillRect(Math.round(ex) + 1, ey + 2, 2, 1);
    } else if (life < boom + 0.35) {
      const r = (life - boom) * 24;
      g.fillStyle = life < boom + 0.08 ? '#ffffff' : '#e8c84a';
      for (let a = 0; a < 8; a++) g.fillRect(Math.round(50 + Math.cos(a * 0.785) * r), Math.round(ey + Math.sin(a * 0.785) * r), 2, 2);
    }
  }
  // the ship, flame flickering
  g.fillStyle = '#c8ccd8'; g.fillRect(sx, sy, 12, 4); g.fillRect(sx + 3, sy - 2, 5, 2);
  g.fillStyle = '#3f7fd0'; g.fillRect(sx + 8, sy + 1, 3, 2);
  g.fillStyle = Math.floor(t * 12) % 2 ? '#e8c84a' : '#c8402a'; g.fillRect(sx - 4, sy + 1, 4, 2);
  // HUD
  g.font = 'bold 8px monospace'; g.textBaseline = 'top';
  g.fillStyle = '#f4f1e8'; g.fillText('1UP', 4, 2);
  g.fillStyle = '#e8c84a'; g.fillText(String(Math.floor(t * 3.1) * 50).padStart(6, '0'), 24, 2);
  g.fillStyle = '#c8402a'; g.fillText('HI 050000', 78, 2);
  if (Math.floor(t * 2) % 2 === 0) {
    g.textAlign = 'center'; g.fillStyle = '#f4f1e8';
    g.fillText('INSERT COIN', SCR_W / 2, SCR_H - 9);
    g.textAlign = 'left';
  }
}

/** Its title card, `t` seconds in: the name slides in, then begs for money. */
function titleCard(g: CanvasRenderingContext2D, t: number, name: string): void {
  g.fillStyle = '#05040c'; g.fillRect(0, 0, SCR_W, SCR_H);
  g.fillStyle = '#7a7aa0';
  for (let i = 0; i < 24; i++) g.fillRect((i * 47) % SCR_W, (i * 31) % SCR_H, 1, 1);
  const [first, ...rest] = name.split(' ');
  const x = SCR_W / 2 + Math.max(0, 1 - t * 2) * 140;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'italic 900 20px Impact, "Arial Black", sans-serif';
  g.fillStyle = '#3f7fd0'; g.fillText(first, x + 2, 24 + 2);
  g.fillStyle = '#e8e8f4'; g.fillText(first, x, 24);
  if (rest.length) {
    g.fillStyle = '#c8402a'; g.fillText(rest.join(' '), x + 2, 46 + 2);
    g.fillStyle = '#e8c84a'; g.fillText(rest.join(' '), x, 46);
  }
  g.font = 'bold 8px monospace';
  if (t > 0.6 && Math.floor(t * 2.5) % 2 === 0) { g.fillStyle = '#f4f1e8'; g.fillText('INSERT COIN', SCR_W / 2, 70); }
  g.fillStyle = '#6a6a72'; g.fillText('CREDIT 0    © 1994', SCR_W / 2, 86);
  g.textAlign = 'left';
}
