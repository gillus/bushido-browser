import charactersJson from './data/characters.json';
import weaponsJson from './data/weapons.json';
import stageJson from './data/stage.json';
import flavorJson from './data/flavor.json';
import { AIController } from './sim/ai';
import { createSim, SimConfig, stepSim, TICK } from './sim/sim';
import {
  CharacterDef, EMPTY_INPUT, InputFrame, Line, StageDef, WeaponDef, obstaclesFromStage,
} from './sim/types';
import { FighterView } from './render/fighterView';
import { HitboxOverlay } from './render/hitboxDebug';
import { createScene } from './render/scene';
import { ragdollWalls } from './render/storefront';
import { Sfx } from './audio';
import { diffTick, snapshot } from './events';
import { GamepadInput, PadRead } from './gamepad';
import { Vector3 } from 'three';

const characters = charactersJson as Record<string, CharacterDef>;
const weapons = weaponsJson as unknown as Record<string, WeaponDef>;
const stage = stageJson as unknown as StageDef;
const BICKER = flavorJson.bicker as [string, string][];

const fighterChars: [CharacterDef, CharacterDef] = [characters.panzer, characters.sticchio];
const fighterWeapons: [WeaponDef, WeaponDef] = [
  weapons[fighterChars[0].weapon],
  weapons[fighterChars[1].weapon],
];

const obstacles = obstaclesFromStage(stage.props);
// ragdolls only (sim uses arenaHalf); a shop window is left open — its panes are breakables
const roomWalls = stage.walls ? ragdollWalls(stage.walls) : [];

const cfg: SimConfig = {
  arenaRadius: stage.radius,
  arenaHalf: stage.walls?.halfSize,
  obstacles,
  chars: fighterChars,
  moves: [fighterWeapons[0].moves, fighterWeapons[1].moves],
  lockLeverage: [fighterWeapons[0].lockLeverage ?? 1, fighterWeapons[1].lockLeverage ?? 1],
};

let sim = createSim(cfg);
let p2IsAI = true;
let ai = new AIController(1337);

// ---------- audio ----------
const sfx = new Sfx(fighterWeapons, !!stage.walls); // walls = indoors = fluorescent hum
// audio unlocks on the first gesture; gamepad presses don't count as one
window.addEventListener('pointerdown', () => sfx.unlock());

// ---------- input ----------
const down = new Set<string>();
const pressedThisTick = new Set<string>();
const pads = new GamepadInput();
window.addEventListener('keydown', (e) => {
  sfx.unlock();
  if (!down.has(e.code)) pressedThisTick.add(e.code);
  down.add(e.code);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash'].includes(e.code)) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => down.delete(e.code));

interface KeyMap {
  fwd: string; back: string; left: string; right: string;
  attack: string; dash: string; parry: string;
  high: string; mid: string; low: string;
}

const P1_KEYS: KeyMap = {
  fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  attack: 'KeyF', dash: 'KeyG', parry: 'Space',
  high: 'Digit1', mid: 'Digit2', low: 'Digit3',
};

const P2_KEYS: KeyMap = {
  fwd: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  attack: 'Period', dash: 'Comma', parry: 'Slash',
  high: 'Digit8', mid: 'Digit9', low: 'Digit0',
};

const STANCE_ORDER: Line[] = ['low', 'mid', 'high'];

/** Keyboard + (optional) gamepad for one player; the two are merged. */
function readInput(keys: KeyMap, pad: PadRead | null, current: Line): InputFrame {
  const pp = pad?.pressed;
  let stance: Line | null = null;
  if (pressedThisTick.has(keys.high) || pp?.has('high')) stance = 'high';
  else if (pressedThisTick.has(keys.mid) || pp?.has('mid')) stance = 'mid';
  else if (pressedThisTick.has(keys.low) || pp?.has('low')) stance = 'low';
  else if (pp?.has('stanceUp') !== pp?.has('stanceDown')) {
    const k = STANCE_ORDER.indexOf(current) + (pp!.has('stanceUp') ? 1 : -1);
    stance = STANCE_ORDER[Math.max(0, Math.min(2, k))];
  }
  const clamp = (v: number) => Math.max(-1, Math.min(1, v));
  return {
    moveY: clamp((down.has(keys.fwd) ? 1 : 0) - (down.has(keys.back) ? 1 : 0) + (pad?.moveY ?? 0)),
    moveX: clamp((down.has(keys.right) ? 1 : 0) - (down.has(keys.left) ? 1 : 0) + (pad?.moveX ?? 0)),
    attack: pressedThisTick.has(keys.attack) || !!pp?.has('attack'),
    dash: pressedThisTick.has(keys.dash) || !!pp?.has('dash'),
    parry: pressedThisTick.has(keys.parry) || !!pp?.has('parry'),
    stance,
  };
}

// ---------- scene ----------
const app = document.getElementById('app')!;
const { scene, camera, renderer, updateCamera, updateProps, shopWindow } = createScene(stage, app);
const views = [
  new FighterView(cfg.chars[0], fighterWeapons[0], [...obstacles, ...roomWalls]),
  new FighterView(cfg.chars[1], fighterWeapons[1], [...obstacles, ...roomWalls]),
];
if (shopWindow) for (const v of views) v.breakables = shopWindow.panes;
scene.add(views[0].root, views[1].root);
// H toggles the sim's real hitboxes (body circle + attack wedge)
const hitboxes = [new HitboxOverlay(cfg.moves[0]), new HitboxOverlay(cfg.moves[1])];
scene.add(hitboxes[0].group, hitboxes[1].group);

// ---------- HUD ----------
const hud = {
  p1: document.getElementById('p1')!,
  p2: document.getElementById('p2')!,
  msg: document.getElementById('msg')!,
  mode: document.getElementById('mode')!,
  quote: document.getElementById('quote')!,
  lock: document.getElementById('lock')!,
  lockMark: document.querySelector<HTMLElement>('#lock .mark')!,
};

// pre-fight bickering — the argument that started all this
let quoteTimer = 0;
function pickQuote(): void {
  const q = BICKER[(Math.random() * BICKER.length) | 0];
  hud.quote.innerHTML =
    `<b>${cfg.chars[0].name.toUpperCase()}:</b> “${q[0]}”<br>` +
    `<b>${cfg.chars[1].name.toUpperCase()}:</b> “${q[1]}”`;
  quoteTimer = 6;
}
pickQuote();

const STANCE_LABEL: Record<Line, string> = {
  high: 'JODAN 上段', mid: 'CHUDAN 中段', low: 'GEDAN 下段',
};

function woundTags(f: typeof sim.fighters[0]): string {
  const tags = [
    f.wounds.arm ? 'ARM CUT' : '',
    f.wounds.leg ? 'LEG CUT' : '',
  ].filter(Boolean).join(' · ');
  return tags ? `<br><span class="wound">${tags}</span>` : '';
}

function renderHud(): void {
  const [a, b] = sim.fighters;
  hud.p1.innerHTML =
    `<b>${cfg.chars[0].name}</b> <span class="weapon">${fighterWeapons[0].name}</span>` +
    ` &nbsp;${'◆'.repeat(a.score)}<br>` +
    `<span class="stance">${STANCE_LABEL[a.stance]}</span>${woundTags(a)}`;
  hud.p2.innerHTML =
    `<b>${cfg.chars[1].name}</b> <span class="weapon">${fighterWeapons[1].name}</span>` +
    ` &nbsp;${'◆'.repeat(b.score)}<br>` +
    `<span class="stance">${STANCE_LABEL[b.stance]}</span>${woundTags(b)}`;
  hud.msg.textContent = sim.messageTimer > 0 ? sim.message : '';
  // tsubazeriai meter: P1 pushes the mark right, toward P2's side of the HUD
  const locked = a.phase === 'lock';
  hud.lock.style.display = locked ? 'block' : 'none';
  if (locked) hud.lockMark.style.left = `${50 + sim.lockBalance * 50}%`;
  const status = [
    p2IsAI ? `${cfg.chars[1].name}: AI (M for 2P)` : `${cfg.chars[1].name}: HUMAN (M for AI)`,
    pads.count ? `${pads.count} PAD${pads.count > 1 ? 'S' : ''}` : '',
    sfx.muted ? 'SOUND OFF (N)' : sfx.locked ? 'CLICK OR PRESS A KEY FOR SOUND' : '',
  ];
  hud.mode.textContent = status.filter(Boolean).join(' · ');
}

// stereo-pan each fighter by where they sit on screen
const panProbe = new Vector3();
function updatePans(): void {
  sim.fighters.forEach((f, i) => {
    panProbe.set(f.pos.x, 1, f.pos.z).project(camera);
    sfx.setPan(i, panProbe.x);
  });
}

// ---------- loop ----------
let last = performance.now();
let acc = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt;
  pads.poll();

  while (acc >= TICK) {
    if (pressedThisTick.has('KeyM') || pads.any('toggleAI')) {
      p2IsAI = !p2IsAI;
      ai = new AIController((Math.random() * 1e9) | 0);
    }
    if (pressedThisTick.has('KeyR') || pads.any('reset')) { sim = createSim(cfg); pickQuote(); }
    if (pressedThisTick.has('KeyH')) {
      for (const hb of hitboxes) hb.group.visible = !hb.group.visible;
    }
    if (pressedThisTick.has('KeyN')) sfx.toggleMute();

    const [a, b] = sim.fighters;
    const inputs: [InputFrame, InputFrame] =
      sim.roundPhase === 'fight'
        ? [
          readInput(P1_KEYS, pads.read(0), a.stance),
          p2IsAI ? ai.update(sim, cfg, 1) : readInput(P2_KEYS, pads.read(1), b.stance),
        ]
        : [{ ...EMPTY_INPUT }, { ...EMPTY_INPUT }];

    const wasEnded = sim.roundPhase === 'end';
    const before = snapshot(sim);
    stepSim(sim, cfg, inputs);
    for (const ev of diffTick(before, sim)) {
      sfx.play(ev);
      pads.rumble(ev);
    }
    if (wasEnded && sim.roundPhase === 'fight') pickQuote();
    pressedThisTick.clear();
    pads.clearPressed();
    acc -= TICK;
  }

  quoteTimer = Math.max(0, quoteTimer - dt);
  hud.quote.style.opacity = quoteTimer > 0 ? '1' : '0';

  const liveObstacles = [
    ...obstacles.filter((_, i) => !sim.obstacleState[i].down), ...roomWalls,
  ];
  views[0].update(sim.fighters[0], dt, liveObstacles);
  views[1].update(sim.fighters[1], dt, liveObstacles);
  hitboxes[0].update(sim.fighters[0]);
  hitboxes[1].update(sim.fighters[1]);
  updateProps(sim);
  for (const at of shopWindow?.update(sim, dt) ?? []) {
    panProbe.copy(at).project(camera);
    sfx.glass(panProbe.x);
  }
  updateCamera(sim.fighters[0], sim.fighters[1], dt);
  updatePans();
  renderHud();
  renderer.render(scene, camera);
}

requestAnimationFrame(frame);
