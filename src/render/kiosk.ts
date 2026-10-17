import { StageProp } from '../sim/types';
import { CrtCabinet, CrtScreen, SCR_H, SCR_W } from './cabinet';
import { BoxBatch, c, signMesh } from './fixtures';

const DEMO_SECS = 9, TITLE_SECS = 4;

/**
 * Console demo kiosk (`"fixture": "kiosk"`): plinth, cabinet with side
 * fins, a tethered pad on a sloped ledge, a CRT running an attract-mode
 * loop (a road racer and its title screen), and a lit topper. Breaks like
 * any `CrtCabinet`.
 */
export class Kiosk extends CrtCabinet {
  constructor(p: StageProp) {
    super(p, new CrtScreen((g, t) => {
      t %= DEMO_SECS + TITLE_SECS;
      if (t > DEMO_SECS) title(g, t - DEMO_SECS);
      else race(g, t);
    }));
    const [w, h, d] = p.size;

    const b = new BoxBatch();
    const body = c(p.color), dark = c('#1f2026'), accent = c(p.accent ?? '#2f6fa8');
    const front = d / 2;

    b.box(0, 0.04, 0, w - 0.06, 0.08, d - 0.06, dark);
    // cabinet, with a lit stripe and a speaker grille on its face
    const cabFront = -0.06 + (d * 0.6) / 2;
    b.box(0, 0.08 + 0.41, -0.06, w * 0.76, 0.82, d * 0.6, body);
    b.box(0, 0.7, cabFront + 0.003, w * 0.76, 0.04, 0.006, accent);
    for (let k = 0; k < 5; k++) b.box(0, 0.3 + k * 0.035, cabFront + 0.003, w * 0.4, 0.012, 0.006, dark);
    // side fins, full height, in the brand colour's dark shade
    const fin = c(p.accent ?? '#2f6fa8', 0.45);
    for (const s of [-1, 1]) {
      b.box(s * (w / 2 - 0.025), 0.08 + (h - 0.08) / 2, -0.08, 0.05, h - 0.08, d * 0.6, fin);
      b.box(s * (w / 2 - 0.025), h * 0.55, -0.08 + d * 0.3 + 0.003, 0.052, h * 0.6, 0.006, accent);
    }
    // sloped ledge, wider than the cabinet, with the pad on it
    const ly = 0.95, slope = 0.32;
    b.box(0, ly, front - 0.17, w * 0.9, 0.035, 0.3, dark, slope);
    pad(b, 0, ly, front - 0.17, slope);
    // the tether: along the ledge from the pad into the cabinet, with a kink
    const on = onLedge(0, ly, front - 0.17, slope);
    const cable = c('#0d0d10');
    for (const [lx, lz] of [[0, -0.045], [0.01, -0.085], [0.025, -0.12]]) b.box(...on(lx, 0.005, lz), 0.008, 0.008, 0.045, cable, slope);

    // CRT: bezel + tapered back, screen set into the front
    const sy = 1.3, sw = w * 0.82, sh = 0.46, crtFront = 0.2;
    b.box(0, sy, crtFront - 0.2, sw, sh + 0.08, 0.4, c('#2a2c33'));
    b.box(0, sy + 0.01, crtFront - 0.46, sw * 0.7, (sh + 0.08) * 0.75, 0.16, c('#23252b'));
    b.box(0, ly + 0.08, -0.08, 0.28, 0.12, 0.28, dark); // neck
    const glass = this.tube(sw * 0.86, sh * 0.84);
    glass.position.set(0, sy, crtFront + 0.001);
    this.body.add(b.mesh());

    // topper sign, out in front of the fins — its own piece, it comes off
    const tb = new BoxBatch();
    tb.box(0, -0.15, 0, w, 0.3, 0.1, body);
    const sign = signMesh(p.label ?? 'PLAY IT NOW', p.accent ?? '#2f6fa8', w - 0.05, 0.25);
    sign.position.z = 0.051;
    const board = tb.mesh();
    board.position.y = 0.15; // centre the box on the group's origin
    this.topper.add(board, sign);
    this.topper.position.set(0, h - 0.16, crtFront - 0.05);
  }
}

/**
 * Points on top of a ledge centred at (x, y, z) and pitched by `rx`:
 * (lx, up, lz) from the pad's spot on it → world, tilted with the slope.
 */
function onLedge(x: number, y: number, z: number, rx: number): (lx: number, up: number, lz: number) => [number, number, number] {
  const cos = Math.cos(rx), sin = Math.sin(rx);
  return (lx, up, lz) => {
    up += 0.033; lz += 0.03;
    return [x + lx, y + up * cos - lz * sin, z + up * sin + lz * cos];
  };
}

/** Grey dual-grip pad lying on a ledge centred at (x, y, z), pitched by `rx`. */
function pad(b: BoxBatch, x: number, y: number, z: number, rx: number): void {
  const grey = c('#a9abb0'), deep = c('#7d8086');
  const at = onLedge(x, y, z, rx);
  b.box(...at(0, 0, 0), 0.15, 0.03, 0.065, grey, rx);
  for (const s of [-1, 1]) b.box(...at(s * 0.055, -0.004, 0.045), 0.04, 0.026, 0.05, deep, rx);
  b.box(...at(-0.042, 0.017, -0.004), 0.034, 0.006, 0.011, c('#2a2b30'), rx); // d-pad
  b.box(...at(-0.042, 0.017, -0.004), 0.011, 0.006, 0.034, c('#2a2b30'), rx);
  const buttons: [number, number, string][] = [[0.042, -0.016, '#3f9f6a'], [0.058, -0.004, '#c8403a'], [0.042, 0.009, '#4a6fc0'], [0.026, -0.004, '#c86aa8']];
  for (const [bx, bz, col] of buttons) b.box(...at(bx, 0.017, bz), 0.011, 0.007, 0.011, c(col), rx);
}

/** The racer, `t` seconds into its demo lap. */
function race(g: CanvasRenderingContext2D, t: number): void {
  const horizon = 38;
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#1d2a6a'); sky.addColorStop(1, '#d0784a');
  g.fillStyle = sky; g.fillRect(0, 0, SCR_W, horizon);
  // far hills drift against the curve
  const curve = Math.sin(t * 0.7) * 0.8;
  g.fillStyle = '#2a2140';
  for (let i = -1; i < 6; i++) {
    const hx = ((i * 34 - curve * 30 + t * 4) % 204) - 20;
    g.beginPath(); g.moveTo(hx, horizon); g.lineTo(hx + 22, horizon - 12); g.lineTo(hx + 46, horizon); g.fill();
  }
  // road, row by row, with scrolling rumble bands
  for (let y = horizon; y < SCR_H; y++) {
    const k = (y - horizon) / (SCR_H - horizon); // 0 far → 1 near
    const z = 1 / (k + 0.05);
    const band = Math.floor(z * 2 + t * 18) % 2 === 0;
    const cx = SCR_W / 2 + curve * (1 - k) * (1 - k) * 60;
    const half = 6 + k * 70;
    g.fillStyle = band ? '#2f6a2a' : '#3a7a33'; g.fillRect(0, y, SCR_W, 1);
    g.fillStyle = band ? '#c8c8c8' : '#b8312f'; g.fillRect(cx - half * 1.12, y, half * 2.24, 1);
    g.fillStyle = band ? '#55565c' : '#4d4e54'; g.fillRect(cx - half, y, half * 2, 1);
    if (band) { g.fillStyle = '#e8e4da'; g.fillRect(cx - half * 0.03, y, Math.max(1, half * 0.06), 1); }
  }
  // the car, sliding against the curve
  const carX = SCR_W / 2 - curve * 10 - 12, carY = 72;
  g.fillStyle = '#7a1414'; g.fillRect(carX, carY + 6, 24, 9);
  g.fillStyle = '#c8302a'; g.fillRect(carX + 2, carY + 4, 20, 8); g.fillRect(carX + 5, carY, 14, 6);
  g.fillStyle = '#141416'; g.fillRect(carX - 1, carY + 12, 6, 6); g.fillRect(carX + 19, carY + 12, 6, 6);
  g.fillStyle = '#9fc8ef'; g.fillRect(carX + 7, carY + 1, 10, 3);
  g.fillStyle = '#e8c84a'; g.fillRect(carX + 2, carY + 9, 3, 2); g.fillRect(carX + 19, carY + 9, 3, 2);
  // HUD
  g.font = 'bold 9px monospace'; g.textBaseline = 'top';
  g.fillStyle = '#e8c84a';
  const lap = (t * 1.37).toFixed(2).padStart(5, '0');
  g.fillText(`LAP 1/3  ${lap}`, 4, 3);
  g.fillText(`${Math.floor(180 + Math.sin(t * 2) * 25)} km/h`, 4, SCR_H - 12);
  if (Math.floor(t * 2) % 2 === 0) { g.fillStyle = '#f4f1e8'; g.fillText('DEMO', SCR_W - 30, SCR_H - 12); }
}

/** Its title screen, `t` seconds in. */
function title(g: CanvasRenderingContext2D, t: number): void {
  g.fillStyle = '#08070c'; g.fillRect(0, 0, SCR_W, SCR_H);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'italic 900 22px Impact, "Arial Black", sans-serif';
  const glint = Math.min(1, t * 1.5);
  g.fillStyle = '#b8312f'; g.fillText('NITRO', SCR_W / 2 + 2, 30 + 2);
  g.fillStyle = '#e8c84a'; g.fillText('NITRO', SCR_W / 2, 30);
  g.font = 'italic 900 14px Impact, "Arial Black", sans-serif';
  g.fillStyle = '#f4f1e8'; g.fillText('HIGHWAY  2', SCR_W / 2, 50);
  g.fillStyle = `rgba(255,255,255,${0.6 * (1 - glint)})`; g.fillRect(0, 18, SCR_W * glint, 2);
  g.font = 'bold 9px monospace';
  if (Math.floor(t * 2.5) % 2 === 0) { g.fillStyle = '#f4f1e8'; g.fillText('PRESS START', SCR_W / 2, 74); }
  g.fillStyle = '#6a6a72'; g.fillText('© 1998', SCR_W / 2, 88);
  g.textAlign = 'left';
}
