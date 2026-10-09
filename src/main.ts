import charactersJson from './data/characters.json';
import weaponsJson from './data/weapons.json';
import stageJson from './data/stage.json';
import flavorJson from './data/flavor.json';
import { AIController } from './sim/ai';
import { createSim, SimConfig, stepSim, TICK } from './sim/sim';
import {
  CharacterDef, EMPTY_INPUT, InputFrame, Line, StageDef, WeaponDef, obstaclesFromStage,
  wallObstacles,
} from './sim/types';
import { FighterView } from './render/fighterView';
import { HitboxOverlay } from './render/hitboxDebug';
import { createScene } from './render/scene';

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
const roomWalls = wallObstacles(stage.walls); // ragdolls only; sim uses arenaHalf

const cfg: SimConfig = {
  arenaRadius: stage.radius,
  arenaHalf: stage.walls?.halfSize,
  obstacles,
  chars: fighterChars,
  moves: [fighterWeapons[0].moves, fighterWeapons[1].moves],
};

let sim = createSim(cfg);
let p2IsAI = true;
let ai = new AIController(1337);

// ---------- input ----------
const down = new Set<string>();
const pressedThisTick = new Set<string>();
window.addEventListener('keydown', (e) => {
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

function readInput(keys: KeyMap): InputFrame {
  let stance: Line | null = null;
  if (pressedThisTick.has(keys.high)) stance = 'high';
  else if (pressedThisTick.has(keys.mid)) stance = 'mid';
  else if (pressedThisTick.has(keys.low)) stance = 'low';
  return {
    moveY: (down.has(keys.fwd) ? 1 : 0) - (down.has(keys.back) ? 1 : 0),
    moveX: (down.has(keys.right) ? 1 : 0) - (down.has(keys.left) ? 1 : 0),
    attack: pressedThisTick.has(keys.attack),
    dash: pressedThisTick.has(keys.dash),
    parry: pressedThisTick.has(keys.parry),
    stance,
  };
}

// ---------- scene ----------
const app = document.getElementById('app')!;
const { scene, camera, renderer, updateCamera, updateProps } = createScene(stage, app);
const views = [
  new FighterView(cfg.chars[0], fighterWeapons[0], [...obstacles, ...roomWalls]),
  new FighterView(cfg.chars[1], fighterWeapons[1], [...obstacles, ...roomWalls]),
];
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
  hud.mode.textContent = p2IsAI ? `${cfg.chars[1].name}: AI (M for 2P)` : `${cfg.chars[1].name}: HUMAN (M for AI)`;
}

// ---------- loop ----------
let last = performance.now();
let acc = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += dt;

  while (acc >= TICK) {
    if (pressedThisTick.has('KeyM')) {
      p2IsAI = !p2IsAI;
      ai = new AIController((Math.random() * 1e9) | 0);
    }
    if (pressedThisTick.has('KeyR')) { sim = createSim(cfg); pickQuote(); }
    if (pressedThisTick.has('KeyH')) {
      for (const hb of hitboxes) hb.group.visible = !hb.group.visible;
    }

    const inputs: [InputFrame, InputFrame] =
      sim.roundPhase === 'fight'
        ? [readInput(P1_KEYS), p2IsAI ? ai.update(sim, cfg, 1) : readInput(P2_KEYS)]
        : [{ ...EMPTY_INPUT }, { ...EMPTY_INPUT }];

    const wasEnded = sim.roundPhase === 'end';
    stepSim(sim, cfg, inputs);
    if (wasEnded && sim.roundPhase === 'fight') pickQuote();
    pressedThisTick.clear();
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
  updateCamera(sim.fighters[0], sim.fighters[1], dt);
  renderHud();
  renderer.render(scene, camera);
}

requestAnimationFrame(frame);
