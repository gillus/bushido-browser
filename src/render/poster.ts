import * as THREE from 'three';
import { StageProp } from '../sim/types';
import { rng } from './fixtures';

// Print resolution: ~230 px per metre of a 1.1 × 1.5 m sheet
const W = 256, H = 352;
const PAPER = '#ece6d6';
const INK = '#0c0c10';
const BORDER = 10;          // white paper margin round the print
const ART_H = 258;          // print area above the footer band

type G = CanvasRenderingContext2D;
type Art = NonNullable<StageProp['art']>;

/**
 * Wall poster (`"fixture": "poster"`): a printed sheet for one of the
 * shop's (fictional) games — `art` picks the illustration, `label` the
 * title, `accent` the logo colour — with a paper margin, a footer band
 * (tagline, platform box, rating), tape on the corners, one corner
 * peeling, and a slight hand-hung tilt. Front = local +z, like the other
 * fixtures (+z wall: `rot: 180`, -x: `90`, +x: `-90`). Hangs on the box's
 * room-side face; the box's own thickness is just air behind it.
 */
export function buildPoster(p: StageProp): THREE.Group {
  const [w, h, d] = p.size;
  const g = new THREE.Group();
  g.position.set(p.pos[0], p.pos[1] + h / 2, p.pos[2]);
  g.rotation.y = ((p.rot ?? 0) * Math.PI) / 180;
  const rand = rng(Math.round(p.pos[0] * 733 + p.pos[2] * 1291 + p.pos[1] * 31) | 0);
  rand(); rand(); // nearby seeds' first draws run together; skip them
  const peeled = rand() < 0.5 ? -1 : 1; // which bottom corner has come unstuck

  const tex = new THREE.CanvasTexture(print(p.art ?? 'shooter', p.label, p.accent, peeled, rand));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const sheet = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 }), // the lifted corner shows the wall
  );
  sheet.position.z = -d / 2 + 0.004; // flat on the wall
  sheet.rotation.z = (rand() - 0.5) * 0.04;
  g.add(sheet);

  // a strip of tape over each corner but the peeled one
  const tape = new THREE.MeshLambertMaterial({ color: '#e8dcb0', transparent: true, opacity: 0.7 });
  const tapeGeo = new THREE.PlaneGeometry(0.13, 0.045);
  for (const [sx, sy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    if (sy < 0 && sx === peeled) continue;
    const t = new THREE.Mesh(tapeGeo, tape);
    t.position.set(sx * (w / 2 - 0.03), sy * (h / 2 - 0.025), 0.002);
    t.rotation.z = sx * sy * (0.6 + rand() * 0.3);
    sheet.add(t);
  }
  return g;
}

/** The whole printed sheet: margin, art, title, footer, the peeling corner. */
function print(
  art: Art, label: string | undefined, accent: string | undefined, peeled: number, rand: () => number,
): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = PAPER; g.fillRect(0, 0, W, H);

  g.save();
  g.beginPath(); g.rect(BORDER, BORDER, W - 2 * BORDER, ART_H); g.clip();
  const footer = ART[art](g, label, accent, rand);
  g.restore();

  // footer band: tagline, platform box, rating, publisher
  const y0 = BORDER + ART_H;
  g.fillStyle = '#141418'; g.fillRect(BORDER, y0, W - 2 * BORDER, H - BORDER - y0);
  g.fillStyle = footer.stripe; g.fillRect(BORDER, y0, W - 2 * BORDER, 4);
  g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillStyle = '#ece6d6';
  g.font = 'italic 900 13px Impact, "Arial Black", sans-serif';
  g.fillText(footer.tagline, W / 2, y0 + 20, W - 2 * BORDER - 16);
  g.fillStyle = '#ece6d6'; g.fillRect(BORDER + 8, y0 + 38, 54, 26);
  g.fillStyle = INK; g.font = 'bold 13px monospace';
  g.fillText('32-BIT', BORDER + 35, y0 + 51, 48);
  g.strokeStyle = '#ece6d6'; g.lineWidth = 2; g.strokeRect(W - BORDER - 38, y0 + 37, 28, 28);
  g.fillStyle = '#ece6d6'; g.font = 'bold 12px monospace';
  g.fillText(footer.rating, W - BORDER - 24, y0 + 52, 24);
  g.fillStyle = '#9a96a0'; g.font = 'bold 9px monospace';
  g.fillText(footer.publisher, W / 2 + 4, y0 + 46, 100);
  g.fillText('© 1997', W / 2 + 4, y0 + 58, 100);

  // shelf wear: a faint fold line across the middle, from the mailing tube
  g.fillStyle = 'rgba(255,255,255,0.08)'; g.fillRect(BORDER, H / 2 - 1, W - 2 * BORDER, 1);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(BORDER, H / 2, W - 2 * BORDER, 1);
  return peel(cv, peeled > 0);
}

/**
 * One bottom corner lifted off the wall: cut away (the material's alpha
 * test lets the real wall show), with the print folded over so the
 * paper's blank back shows.
 */
function peel(cv: HTMLCanvasElement, right: boolean): HTMLCanvasElement {
  const g = cv.getContext('2d')!;
  const s = 30;
  const x = right ? W : 0, dx = right ? -1 : 1;
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.moveTo(x, H); g.lineTo(x + dx * s, H); g.lineTo(x, H - s); g.closePath(); g.fill();
  g.restore();
  g.fillStyle = '#d8d0bc'; // the folded-over back of the paper
  g.beginPath(); g.moveTo(x + dx * s, H); g.lineTo(x, H - s); g.lineTo(x + dx * s * 0.9, H - s * 0.9); g.closePath(); g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.stroke();
  return cv;
}

interface Footer { tagline: string; rating: string; publisher: string; stripe: string }

/** Chunky italic logo with a drop shadow, fitted to `maxW`. */
function logo(g: G, text: string, x: number, y: number, size: number, fill: string | CanvasGradient, shadow: string, maxW: number): void {
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `italic 900 ${size}px Impact, "Arial Black", sans-serif`;
  g.fillStyle = shadow; g.fillText(text, x + 3, y + 3, maxW);
  g.strokeStyle = INK; g.lineWidth = 4; g.lineJoin = 'round'; g.strokeText(text, x, y, maxW);
  g.fillStyle = fill; g.fillText(text, x, y, maxW);
}

function stars(g: G, n: number, rand: () => number, y1 = H): void {
  for (let i = 0; i < n; i++) {
    const a = 0.3 + rand() * 0.7;
    g.fillStyle = `rgba(255,255,255,${a})`;
    const s = rand() < 0.1 ? 2 : 1;
    g.fillRect(BORDER + rand() * (W - 2 * BORDER), BORDER + rand() * (y1 - BORDER), s, s);
  }
}

function poly(g: G, pts: number[], fill: string | CanvasGradient, stroke = 0): void {
  g.beginPath();
  g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath();
  g.fillStyle = fill; g.fill();
  if (stroke) { g.strokeStyle = INK; g.lineWidth = stroke; g.lineJoin = 'round'; g.stroke(); }
}

const ART: Record<Art, (g: G, label: string | undefined, accent: string | undefined, rand: () => number) => Footer> = {
  // the arcade's shooter, home edition: a fighter banking past a ringed planet
  shooter(g, label = 'SOLAR LANCER', accent = '#3f8fe0', rand) {
    const sky = g.createLinearGradient(0, 0, 0, ART_H);
    sky.addColorStop(0, '#05061a'); sky.addColorStop(1, '#1a0f3a');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    stars(g, 90, rand, ART_H);
    // the planet and its ring
    const pl = g.createRadialGradient(170, 168, 8, 182, 182, 74);
    pl.addColorStop(0, '#f0b45a'); pl.addColorStop(0.7, '#b8502a'); pl.addColorStop(1, '#4a1a20');
    g.save(); g.translate(182, 182); g.rotate(-0.35);
    g.strokeStyle = 'rgba(232,200,150,0.5)'; g.lineWidth = 6;
    g.beginPath(); g.ellipse(0, 0, 112, 24, 0, Math.PI, Math.PI * 2); g.stroke(); // ring, far side
    g.restore();
    g.beginPath(); g.arc(182, 182, 68, 0, Math.PI * 2); g.fillStyle = pl; g.fill();
    g.save(); g.translate(182, 182); g.rotate(-0.35);
    g.strokeStyle = 'rgba(240,214,170,0.8)'; g.lineWidth = 6;
    g.beginPath(); g.ellipse(0, 0, 112, 24, 0, 0, Math.PI); g.stroke(); // ring, near side
    g.restore();
    // laser streaks and the ship, banking up and left out of the planet's glow
    g.strokeStyle = '#ff5a4a'; g.lineWidth = 2;
    for (const [x, y] of [[40, 210], [64, 236], [24, 160]]) {
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 46, y - 30); g.stroke();
    }
    g.save(); g.translate(104, 168); g.rotate(-0.55);
    const glow = g.createRadialGradient(0, 46, 2, 0, 46, 26);
    glow.addColorStop(0, '#fff2b0'); glow.addColorStop(0.4, '#ff9a3a'); glow.addColorStop(1, 'rgba(255,90,40,0)');
    g.fillStyle = glow; g.fillRect(-26, 20, 52, 54);
    poly(g, [0, -56, 10, -14, 44, 22, 46, 36, 12, 30, 8, 42, -8, 42, -12, 30, -46, 36, -44, 22, -10, -14], '#c8ccd8', 3);
    poly(g, [0, -52, 6, -14, 0, 34, -6, -14], '#8a90a4');
    poly(g, [-5, -26, 5, -26, 4, -8, -4, -8], '#4ac0f0', 2);       // canopy
    poly(g, [44, 22, 46, 36, 30, 33], accent, 0);                  // wing stripes
    poly(g, [-44, 22, -46, 36, -30, 33], accent, 0);
    g.restore();
    const [first, ...rest] = label.split(' ');
    const chrome = g.createLinearGradient(0, 24, 0, 74);
    chrome.addColorStop(0, '#ffffff'); chrome.addColorStop(0.5, '#9ac8f0'); chrome.addColorStop(0.52, accent); chrome.addColorStop(1, '#e8f4ff');
    logo(g, first, W / 2, 46, 40, chrome, '#0a1a40', W - 40);
    if (rest.length) logo(g, rest.join(' '), W / 2, 84, 30, '#e8c84a', '#5a1a10', W - 60);
    return { tagline: 'THE ARCADE HIT — NOW AT HOME', rating: '3+', publisher: 'KOGANE SOFT', stripe: accent };
  },

  // the kiosk's racer: a red coupé down a highway into the sunset
  racer(g, label = 'NITRO HIGHWAY 2', accent = '#e8c84a') {
    const horizon = 150;
    const sky = g.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, '#2a1450'); sky.addColorStop(0.6, '#c8406a'); sky.addColorStop(1, '#f0a040');
    g.fillStyle = sky; g.fillRect(0, 0, W, horizon);
    // the sun, sliced
    g.save();
    g.beginPath(); g.arc(W / 2, horizon, 62, Math.PI, Math.PI * 2); g.clip();
    const sun = g.createLinearGradient(0, horizon - 62, 0, horizon);
    sun.addColorStop(0, '#fff0a0'); sun.addColorStop(1, '#f06a2a');
    g.fillStyle = sun; g.fillRect(0, 0, W, horizon);
    g.fillStyle = '#c8406a';
    for (let k = 0; k < 5; k++) g.fillRect(0, horizon - 8 - k * 9, W, 2 + k * 0.6);
    g.restore();
    // mountains
    poly(g, [0, horizon, 0, 122, 30, 108, 58, 126, 84, 100, 110, 130, 150, 120, 178, 96, 206, 124, 236, 104, W, 118, W, horizon], '#3a1a48');
    // the road: tarmac, verges, dashes running to the vanishing point
    g.fillStyle = '#1a1424'; g.fillRect(0, horizon, W, ART_H + BORDER - horizon);
    poly(g, [W / 2 - 4, horizon, W / 2 + 4, horizon, W + 60, ART_H + BORDER, -60, ART_H + BORDER], '#2e2838');
    g.strokeStyle = '#f06aa0'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(W / 2 - 4, horizon); g.lineTo(-60, ART_H + BORDER); g.stroke();
    g.beginPath(); g.moveTo(W / 2 + 4, horizon); g.lineTo(W + 60, ART_H + BORDER); g.stroke();
    g.fillStyle = '#ece6d6';
    for (let k = 0; k < 6; k++) {
      const t0 = (k / 6) ** 2, t1 = ((k + 0.5) / 6) ** 2;
      const y0 = horizon + t0 * (ART_H + BORDER - horizon), y1 = horizon + t1 * (ART_H + BORDER - horizon);
      const w0 = 1 + t0 * 6, w1 = 1 + t1 * 6;
      poly(g, [W / 2 - w0, y0, W / 2 + w0, y0, W / 2 + w1, y1, W / 2 - w1, y1], '#ece6d6');
    }
    // the car from behind, low and wide
    const cx = W / 2 + 16, cy = 222;
    poly(g, [cx - 60, cy + 10, cx - 56, cy - 14, cx - 34, cy - 22, cx + 34, cy - 22, cx + 56, cy - 14, cx + 60, cy + 10], '#c8201a', 3);
    poly(g, [cx - 32, cy - 22, cx - 22, cy - 42, cx + 22, cy - 42, cx + 32, cy - 22], '#8a1410', 3);
    poly(g, [cx - 26, cy - 24, cx - 18, cy - 38, cx + 18, cy - 38, cx + 26, cy - 24], '#3a5a8a', 0);
    poly(g, [cx - 64, cy - 16, cx + 64, cy - 16, cx + 60, cy - 10, cx - 60, cy - 10], '#141418', 2); // spoiler
    g.fillStyle = '#ff3a2a'; g.fillRect(cx - 52, cy - 6, 24, 6); g.fillRect(cx + 28, cy - 6, 24, 6);
    g.fillStyle = '#ece6d6'; g.fillRect(cx - 12, cy - 2, 24, 7);
    g.fillStyle = '#0c0c10'; g.fillRect(cx - 56, cy + 10, 22, 14); g.fillRect(cx + 34, cy + 10, 22, 14);
    // speed lines
    g.strokeStyle = 'rgba(255,240,200,0.6)'; g.lineWidth = 1.5;
    for (const [x, y, l] of [[20, 200, 40], [30, 236, 56], [214, 196, 34], [200, 244, 50]]) {
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (x < W / 2 ? -l : l) * 0.3, y + l * 0.15); g.stroke();
    }
    const [first, ...rest] = label.split(' ');
    logo(g, first, W / 2, 48, 52, accent, '#b8201a', W - 36);
    if (rest.length) logo(g, rest.join(' '), W / 2, 88, 22, '#ece6d6', '#3a1a48', W - 80);
    return { tagline: 'FULL THROTTLE. NO BRAKES.', rating: '3+', publisher: 'VELOCITA', stripe: accent };
  },

  // a 60-hour JRPG: a caped hero on a cliff, a giant sword, a castle under the moon
  rpg(g, label = 'AZURE CHRONICLE', accent = '#e8c84a', rand) {
    const sky = g.createLinearGradient(0, 0, 0, ART_H);
    sky.addColorStop(0, '#0a1430'); sky.addColorStop(0.7, '#1f5a78'); sky.addColorStop(1, '#5a9ab0');
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    stars(g, 50, rand, 150);
    // the moon behind it all
    const moon = g.createRadialGradient(150, 120, 10, 150, 120, 60);
    moon.addColorStop(0, '#fffbe8'); moon.addColorStop(0.8, '#e8e0c0'); moon.addColorStop(1, 'rgba(232,224,192,0)');
    g.fillStyle = moon; g.beginPath(); g.arc(150, 120, 60, 0, Math.PI * 2); g.fill();
    // a castle on a far peak
    poly(g, [120, ART_H, 170, 150, 190, 162, 236, ART_H], '#1a3a54');
    g.fillStyle = '#10243a';
    g.fillRect(166, 132, 8, 22); g.fillRect(178, 126, 10, 30); g.fillRect(190, 138, 7, 18);
    poly(g, [178, 126, 183, 112, 188, 126], '#10243a');
    g.fillStyle = '#f0c860'; g.fillRect(182, 136, 2, 3);
    // the cliff and the hero, back to us, looking at it
    poly(g, [0, ART_H + BORDER, 0, 210, 40, 200, 96, 206, 128, 222, 140, ART_H + BORDER], '#0c1422', 0);
    poly(g, [64, 206, 58, 168, 64, 150, 80, 150, 86, 168, 82, 206], '#0c1422');          // body
    poly(g, [58, 156, 86, 156, 104, 212, 44, 214], '#8a1a2a');                            // cape
    g.fillStyle = '#0c1422';
    g.beginPath(); g.arc(72, 140, 11, 0, Math.PI * 2); g.fill();                         // head
    poly(g, [60, 138, 56, 124, 66, 132, 70, 118, 76, 130, 84, 120, 84, 136], '#0c1422');  // spiky hair
    poly(g, [84, 158, 88, 154, 136, 86, 140, 90], '#cfd8e8', 2);                          // the oversized sword
    poly(g, [80, 160, 92, 150, 94, 154, 82, 164], '#e8c84a', 1);                          // its guard
    // the logo, gold with an ornament rule
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const gold = g.createLinearGradient(0, 22, 0, 70);
    gold.addColorStop(0, '#fff2b0'); gold.addColorStop(0.5, accent); gold.addColorStop(1, '#8a5a1a');
    const words = label.split(' ');
    const big = words.pop()!, small = words.join(' ');
    if (small) {
      g.font = 'bold 14px Georgia, "Times New Roman", serif';
      g.fillStyle = '#ece6d6'; g.fillText(small.split('').join(' '), W / 2, 30, W - 60);
    }
    g.font = 'bold 34px Georgia, "Times New Roman", serif';
    g.fillStyle = '#0a1430'; g.fillText(big, W / 2 + 2, 62, W - 40);
    g.fillStyle = gold; g.fillText(big, W / 2, 60, W - 40);
    g.strokeStyle = accent; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(40, 84); g.lineTo(W - 40, 84); g.stroke();
    poly(g, [W / 2, 78, W / 2 + 6, 84, W / 2, 90, W / 2 - 6, 84], accent);
    return { tagline: 'OVER 60 HOURS OF ADVENTURE', rating: '12+', publisher: 'HOSHIZORA', stripe: accent };
  },
};
