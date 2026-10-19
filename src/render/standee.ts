import * as THREE from 'three';
import { StageProp } from '../sim/types';
import { BoxBatch, c } from './fixtures';

// The cutout's art, at 320 px per metre of a 0.7 × 1.7 m board
const W = 224, H = 544;
const INK = '#0c0c10';
const CARD = '#a8875a';

/**
 * Cardboard promo standee (`"fixture": "standee"`): a die-cut board for a
 * 32-bit samurai fighter — the hero in jodan against a red sun, the logo
 * across the top, a footer with an OUT NOW burst and a lire price sticker
 * — with plain brown board and a fold-out easel strut behind. Alpha-tested
 * cutout planes, so the silhouette costs two quads. Returns a group
 * centred in the prop's box like a plain prop mesh, so the knockable
 * topple in `scene.ts` swings it the same way.
 */
export function buildStandee(p: StageProp): THREE.Group {
  const [w, h, d] = p.size;
  const g = new THREE.Group();
  g.position.set(p.pos[0], p.pos[1] + h / 2, p.pos[2]);
  g.rotation.y = ((p.rot ?? 0) * Math.PI) / 180;

  const front = frontArt(p.label ?? 'STEEL RONIN', p.accent ?? '#d23a26');
  const back = backArt(front);
  const card = (cv: HTMLCanvasElement, z: number, yaw: number): THREE.Mesh => {
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 }),
    );
    m.position.z = z;
    m.rotation.y = yaw;
    return m;
  };
  g.add(card(front, 0.004, 0), card(back, -0.004, Math.PI));

  // the easel: a strut folded out of the back, its foot on the floor
  const b = new BoxBatch();
  const strut = c('#94764c');
  const len = h * 0.62, kick = Math.min(0.045, d / 2 - 0.005);
  const tilt = Math.atan2(kick, len);
  b.box(0, -h / 2 + len / 2, -0.006 - kick / 2, 0.11, len, 0.006, strut, tilt, 0);
  b.box(0, -h / 2 + len, -0.008, 0.13, 0.03, 0.004, strut); // the glued hinge tab
  g.add(b.mesh());
  return g;
}

/** The printed face; its alpha is the die-cut. */
function frontArt(title: string, accent: string): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.lineJoin = 'round';
  const poly = (pts: number[], fill: string, stroke = 3): void => {
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
    g.fillStyle = fill; g.fill();
    if (stroke) { g.strokeStyle = INK; g.lineWidth = stroke; g.stroke(); }
  };

  // the red sun, banded like a sunset
  const sun = g.createRadialGradient(112, 236, 10, 112, 236, 104);
  sun.addColorStop(0, '#f2a03a'); sun.addColorStop(0.55, accent); sun.addColorStop(1, '#7a1414');
  g.beginPath(); g.arc(112, 236, 104, 0, Math.PI * 2);
  g.fillStyle = sun; g.fill();
  g.strokeStyle = INK; g.lineWidth = 4; g.stroke();
  g.save();
  g.clip(); // the bands stay inside the disc (they'd widen the die-cut)
  g.fillStyle = 'rgba(40,6,10,0.55)';
  for (const [y, t] of [[262, 3], [280, 4], [298, 6], [318, 8]]) g.fillRect(0, y, W, t);
  g.restore();

  // the footer board
  const foot = g.createLinearGradient(0, 410, 0, H);
  foot.addColorStop(0, '#1d2a5a'); foot.addColorStop(1, '#0b1028');
  g.fillStyle = foot; g.fillRect(6, 408, W - 12, H - 412);
  g.strokeStyle = INK; g.lineWidth = 4; g.strokeRect(6, 408, W - 12, H - 412);
  g.fillStyle = '#e8c84a'; g.fillRect(6, 408, W - 12, 5);

  // the ronin, in jodan: hakama, kimono, arms up, the sword raised high
  poly([70, 300, 154, 300, 176, 430, 124, 430, 112, 352, 100, 430, 48, 430], '#232846');   // hakama
  g.strokeStyle = '#3a4270'; g.lineWidth = 2;
  for (const x of [80, 96, 128, 144]) { g.beginPath(); g.moveTo(x + 4, 310); g.lineTo(x + (x < 112 ? -8 : 10), 424); g.stroke(); }
  poly([40, 430, 70, 422, 76, 436, 38, 440], '#16161c', 2); // feet
  poly([148, 422, 182, 428, 186, 440, 150, 436], '#16161c', 2);
  poly([84, 182, 140, 182, 150, 300, 74, 300], '#3b3f4a');      // kimono
  poly([96, 182, 128, 182, 112, 236], '#e8e4da', 2);             // collar V
  poly([102, 186, 122, 186, 112, 222], '#3b3f4a', 0);
  g.fillStyle = accent; g.fillRect(72, 286, 80, 14);             // obi
  g.strokeStyle = INK; g.lineWidth = 3; g.strokeRect(72, 286, 80, 14);
  poly([84, 184, 70, 150, 98, 104, 112, 110, 92, 156, 100, 190], '#3b3f4a');  // left arm, up
  poly([140, 184, 156, 150, 130, 104, 116, 110, 132, 156, 124, 190], '#3b3f4a'); // right arm, up
  poly([100, 100, 126, 100, 126, 116, 100, 116], '#e2b48a', 2);  // fists on the hilt
  // the head, under the raised arms: topknot, red hachimaki, a hard stare
  g.beginPath(); g.arc(112, 160, 20, 0, Math.PI * 2);
  g.fillStyle = '#e2b48a'; g.fill(); g.strokeStyle = INK; g.lineWidth = 3; g.stroke();
  poly([92, 156, 94, 140, 112, 132, 130, 140, 132, 156, 126, 146, 98, 146], '#141418', 2); // hair
  poly([108, 132, 116, 132, 118, 120, 106, 120], '#141418', 2);  // topknot
  g.fillStyle = '#e8e4da'; g.fillRect(92, 147, 40, 6);           // hachimaki
  g.fillStyle = accent; g.beginPath(); g.arc(112, 150, 3, 0, Math.PI * 2); g.fill();
  poly([132, 148, 150, 158, 146, 164, 130, 154], '#e8e4da', 2);  // its tails
  g.fillStyle = INK;
  g.fillRect(100, 160, 9, 3); g.fillRect(115, 160, 9, 3);        // brows down
  g.fillRect(108, 172, 8, 2);
  // the sword: tsuka in the fists, tsuba, a long blade raised up and back
  poly([108, 118, 118, 118, 116, 92, 110, 92], '#2a1a14', 2);    // tsuka
  poly([104, 90, 122, 90, 122, 96, 104, 96], '#c8a03a', 2);      // tsuba
  poly([110, 90, 118, 90, 66, 6, 60, 8], '#e6ecf2', 2);          // blade
  g.strokeStyle = '#9aa6b4'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(115, 88); g.lineTo(64, 9); g.stroke(); // edge line
  g.fillStyle = 'rgba(255,255,255,0.9)';                         // a glint
  g.beginPath(); g.moveTo(82, 40); g.lineTo(86, 30); g.lineTo(90, 40); g.lineTo(86, 50); g.closePath(); g.fill();

  // the logo, slanted across the top, the blade cutting up through it
  g.save();
  g.translate(112, 62); g.rotate(-0.08);
  poly([-104, -26, 108, -32, 104, 28, -108, 30], '#101018', 4);
  g.strokeStyle = '#e8c84a'; g.lineWidth = 2; g.strokeRect(-98, -22, 198, 46);
  const [top, ...rest] = title.split(' ');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'italic 900 15px Impact, "Arial Black", sans-serif';
  g.fillStyle = '#e8e4da'; g.fillText(top, 0, -10, 180);
  g.font = 'italic 900 30px Impact, "Arial Black", sans-serif';
  const big = rest.join(' ') || top;
  g.fillStyle = INK; g.fillText(big, 3, 13, 186);
  g.fillStyle = accent; g.fillText(big, 0, 10, 186);
  g.restore();
  poly([110, 90, 118, 90, 98, 58, 92, 60], '#e6ecf2', 0); // the blade in front of the logo's lower edge

  // footer: OUT NOW burst, the tagline, platform strip, price sticker
  g.save();
  g.translate(52, 462);
  const burst: number[] = [];
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2, r = i % 2 ? 26 : 36;
    burst.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.rotate(-0.2);
  poly(burst, '#e8c84a', 3);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#b8201a';
  g.font = 'italic 900 13px Impact, "Arial Black", sans-serif';
  g.fillText('OUT', 0, -7, 40); g.fillText('NOW!', 0, 8, 40);
  g.restore();
  g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = '#e8e4da';
  g.font = 'italic 900 12px Impact, "Arial Black", sans-serif';
  g.fillText('ONE CUT.', 96, 440, 112);
  g.fillText('NO SECOND CHANCE.', 96, 456, 112);
  g.fillStyle = '#e8e4da'; g.fillRect(6, 508, W - 12, 18);
  g.fillStyle = INK; g.font = 'bold 10px monospace'; g.textAlign = 'center';
  g.fillText('32-BIT · 1-2 PLAYERS · MEMORY CARD', W / 2, 517, W - 24);
  g.save();
  g.translate(178, 488); g.rotate(0.12);
  poly([-24, -11, 24, -11, 24, 11, -24, 11], '#f08a2a', 2);
  g.fillStyle = INK; g.font = 'bold 11px monospace'; g.textAlign = 'center';
  g.fillText('L.99.900', 0, 1, 42);
  g.restore();
  return cv;
}

/** Plain board behind: the front's die-cut, mirrored, in brown card. */
function backArt(front: HTMLCanvasElement): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.translate(W, 0); g.scale(-1, 1);
  g.drawImage(front, 0, 0);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = CARD; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(60,40,20,0.55)';
  g.font = 'bold 9px monospace'; g.textAlign = 'center';
  g.fillText('DISPLAY STAND  1/1', W / 2, 430, W - 30);
  g.fillText('INSERT TAB A INTO SLOT B', W / 2, 444, W - 30);
  g.strokeStyle = 'rgba(60,40,20,0.35)'; g.lineWidth = 1;
  g.beginPath(); g.moveTo(W / 2, 200); g.lineTo(W / 2, 410); g.stroke(); // fold line
  return cv;
}
