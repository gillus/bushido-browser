import charactersJson from './data/characters.json';
import weaponsJson from './data/weapons.json';
import stageJson from './data/stage.json';
import flavorJson from './data/flavor.json';
import aiJson from './data/ai.json';
import rulesJson from './data/rules.json';
import { AIController, AIProfile } from './sim/ai';
import { createSim, MATCH_WINS, ROUND_END_FRAMES, SimConfig, stepSim, TICK } from './sim/sim';
import {
  CartRules, CharacterDef, EMPTY_INPUT, HonorRules, HurlRules, InputFrame, Line, SimState, StageDef, WeaponDef,
  obstaclesFromStage,
} from './sim/types';
import { CartView } from './render/carts';
import { HurlView } from './render/hurled';
import { FighterView } from './render/fighterView';
import { HitboxOverlay } from './render/hitboxDebug';
import { createScene } from './render/scene';
import { ragdollWalls } from './render/storefront';
import { Sfx } from './audio';
import { Dialogue } from './dialogue';
import { diffTick, GameEvent, snapshot } from './events';
import { GamepadInput, PadRead } from './gamepad';
import { Replay } from './replay';
import { Vector3 } from 'three';

const characters = charactersJson as Record<string, CharacterDef>;
const weapons = weaponsJson as unknown as Record<string, WeaponDef>;
const stage = stageJson as unknown as StageDef;
const BICKER = flavorJson.bicker as [string, string][];
const rules = rulesJson as { carts: CartRules; hurl: HurlRules; honor: HonorRules };

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
  carts: rules.carts,
  hurl: rules.hurl,
  honor: rules.honor,
};

// ---------- remembered settings ----------
function loadPref(key: string): string | null {
  try { return localStorage.getItem(`bushido.${key}`); } catch { return null; }
}
function savePref(key: string, value: boolean | string): void {
  const v = typeof value === 'string' ? value : value ? '1' : '0';
  try { localStorage.setItem(`bushido.${key}`, v); } catch { /* private mode */ }
}

let sim = createSim(cfg);
let p2IsAI = loadPref('p2ai') !== '0';
// difficulty: L (or pad X while paused) cycles easy → normal → hard
const AI_LEVELS = aiJson as unknown as Record<string, AIProfile>;
const LEVEL_KEYS = Object.keys(AI_LEVELS);
let aiLevel = LEVEL_KEYS.includes(loadPref('ai') ?? '') ? loadPref('ai')! : 'normal';
let ai = new AIController(1337, AI_LEVELS[aiLevel]);
const newAI = (): void => { ai = new AIController((Math.random() * 1e9) | 0, AI_LEVELS[aiLevel]); };

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
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Slash', 'F1'].includes(e.code)) {
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => down.delete(e.code));
// a key held while the window loses focus never sends its keyup — forget it,
// and stop the fight until the player is back
window.addEventListener('blur', () => {
  down.clear();
  for (const t of throwButtons) t.reset();
  setPaused(true);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

interface KeyMap {
  fwd: string; back: string; left: string; right: string;
  attack: string; dash: string; parry: string; throw: string;
  high: string; mid: string; low: string;
}

const P1_KEYS: KeyMap = {
  fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
  attack: 'KeyF', dash: 'KeyG', parry: 'Space', throw: 'KeyT',
  high: 'Digit1', mid: 'Digit2', low: 'Digit3',
};

const P2_KEYS: KeyMap = {
  fwd: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  attack: 'Period', dash: 'Comma', parry: 'Slash', throw: 'Semicolon',
  high: 'Digit8', mid: 'Digit9', low: 'Digit0',
};

const STANCE_ORDER: Line[] = ['low', 'mid', 'high'];

// The throw button does two things: a tap throws a cartridge (on release,
// so a hold can't fire one first); held HURL_HOLD ticks, it hurls the weapon.
const HURL_HOLD = 18;
class ThrowButton {
  private ticks = -1; // ticks held since the press; -1 = not pressed

  /** Once per sim tick: pressed since the last tick, and down right now. */
  step(pressed: boolean, held: boolean): 'tap' | 'hold' | null {
    if (pressed) this.ticks = 0;
    if (this.ticks < 0) return null;
    if (!held) { this.ticks = -1; return 'tap'; }
    if (++this.ticks < HURL_HOLD) return null;
    this.ticks = -1;
    return 'hold';
  }

  reset(): void { this.ticks = -1; }
}
const throwButtons = [new ThrowButton(), new ThrowButton()];

/** Keyboard + (optional) gamepad for one player; the two are merged. */
function readInput(keys: KeyMap, pad: PadRead | null, current: Line, thrower: ThrowButton): InputFrame {
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
  const thrown = thrower.step(
    pressedThisTick.has(keys.throw) || !!pp?.has('throw'), down.has(keys.throw) || !!pad?.throwHeld,
  );
  return {
    moveY: clamp((down.has(keys.fwd) ? 1 : 0) - (down.has(keys.back) ? 1 : 0) + (pad?.moveY ?? 0)),
    moveX: clamp((down.has(keys.right) ? 1 : 0) - (down.has(keys.left) ? 1 : 0) + (pad?.moveX ?? 0)),
    attack: pressedThisTick.has(keys.attack) || !!pp?.has('attack'),
    dash: pressedThisTick.has(keys.dash) || !!pp?.has('dash'),
    parry: pressedThisTick.has(keys.parry) || !!pp?.has('parry'),
    throw: thrown === 'tap',
    hurl: thrown === 'hold',
    stance,
  };
}

// ---------- scene ----------
const app = document.getElementById('app')!;
const { scene, camera, renderer, updateCamera, updateProps, smashables } = createScene(stage, app);
const views = [
  new FighterView(cfg.chars[0], fighterWeapons[0], [...obstacles, ...roomWalls]),
  new FighterView(cfg.chars[1], fighterWeapons[1], [...obstacles, ...roomWalls]),
];
for (const v of views) {
  v.breakables = smashables.flatMap((s) => s.breakables);
  v.throwWindup = rules.carts.windup;
  v.hurlWindup = rules.hurl.windup;
}
scene.add(views[0].root, views[1].root);
const carts = new CartView(
  [fighterChars[0].cart ?? '#222228', fighterChars[1].cart ?? '#222228'], rules.carts, stage.walls?.halfSize,
);
scene.add(carts.group);
const hurled = new HurlView(views, rules.hurl);
scene.add(hurled.group);
// H toggles the sim's real hitboxes (body circle + attack wedge)
const hitboxes = [new HitboxOverlay(cfg.moves[0]), new HitboxOverlay(cfg.moves[1])];
scene.add(hitboxes[0].group, hitboxes[1].group);
const showHitboxes = (on: boolean): void => {
  for (const hb of hitboxes) hb.group.visible = on;
};
showHitboxes(loadPref('hitboxes') === '1');

// ---------- HUD ----------
const hud = {
  p1: document.getElementById('p1')!,
  p2: document.getElementById('p2')!,
  msg: document.getElementById('msg')!,
  mode: document.getElementById('mode')!,
  lock: document.getElementById('lock')!,
  lockMark: document.querySelector<HTMLElement>('#lock .mark')!,
  help: document.getElementById('help')!,
  pause: document.getElementById('pause')!,
  pauseLevel: document.querySelector<HTMLElement>('#pause .level')!,
  match: document.getElementById('match')!,
  matchWho: document.querySelector<HTMLElement>('#match .who')!,
  matchScore: document.querySelector<HTMLElement>('#match .score')!,
};

// the controls bar: up for the first round, then out of the way unless F1
// asked for it (that choice is remembered)
let helpPref = loadPref('help');
hud.help.hidden = helpPref === '0';

let joined = 0; // seconds left on the "pad 2 joined" notice

let paused = false;
function setPaused(on: boolean): void {
  paused = on;
  hud.pause.hidden = !on;
  document.body.classList.toggle('paused', on); // the panel lists the controls itself
}

// pre-fight bickering — the argument that started all this
const dialogue = new Dialogue(document.getElementById('dialogue')!, cfg.chars);
function pickQuote(): void {
  dialogue.say(BICKER[(Math.random() * BICKER.length) | 0]);
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
  return (tags ? `<br><span class="wound">${tags}</span>` : '')
    + (f.armed ? '' : '<br><span class="unarmed">無刀 UNARMED</span>')
    + (f.dishonored ? '<br><span class="shame">不名誉 DISHONORED</span>' : '');
}

// cartridges left this round: ▮ in hand, ▯ thrown
const cartTags = (n: number): string =>
  `<span class="carts">${'▮'.repeat(n)}<span class="spent">${'▯'.repeat(Math.max(0, rules.carts.ammo - n))}</span></span>`;

// one pip per clean kill toward the match
const pips = (score: number): string =>
  `<span class="pips">${'◆'.repeat(score)}${'◇'.repeat(Math.max(0, MATCH_WINS - score))}</span>`;

function renderHud(): void {
  const [a, b] = sim.fighters;
  hud.p1.innerHTML =
    `<b>${cfg.chars[0].name}</b> <span class="weapon">${fighterWeapons[0].name}</span>` +
    ` &nbsp;${pips(a.score)}<br>` +
    `<span class="stance">${STANCE_LABEL[a.stance]}</span> ${cartTags(a.carts)}${woundTags(a)}`;
  hud.p2.innerHTML =
    `<b>${cfg.chars[1].name}</b> <span class="weapon">${fighterWeapons[1].name}</span>` +
    ` &nbsp;${pips(b.score)}<br>` +
    `${cartTags(b.carts)} <span class="stance">${STANCE_LABEL[b.stance]}</span>${woundTags(b)}`;
  hud.msg.textContent = sim.messageTimer > 0 ? sim.message : '';
  // tsubazeriai meter: P1 pushes the mark right, toward P2's side of the HUD
  const locked = a.phase === 'lock';
  hud.lock.style.display = locked ? 'block' : 'none';
  if (locked) hud.lockMark.style.left = `${50 + sim.lockBalance * 50}%`;
  const status = [
    joined > 0 ? `PAD 2 JOINED AS ${cfg.chars[1].name.toUpperCase()}`
      : p2IsAI ? `${cfg.chars[1].name}: AI ${AI_LEVELS[aiLevel].label} (L level · M for 2P)`
      : `${cfg.chars[1].name}: HUMAN (M for AI)`,
    p2IsAI && pads.count > 1 ? 'PAD 2: START TO JOIN'
      : pads.count ? `${pads.count} PAD${pads.count > 1 ? 'S' : ''}` : '',
    sfx.muted ? 'SOUND OFF (N)' : sfx.locked ? 'CLICK OR PRESS A KEY FOR SOUND' : '',
    'ESC PAUSE · F1 HELP',
  ];
  hud.mode.textContent = status.filter(Boolean).join(' · ');
  if (paused) hud.pauseLevel.textContent = AI_LEVELS[aiLevel].label;
}

// stereo-pan each fighter by where they sit on screen
const panProbe = new Vector3();
function updatePans(s: SimState): void {
  s.fighters.forEach((f, i) => {
    panProbe.set(f.pos.x, 1, f.pos.z).project(camera);
    sfx.setPan(i, panProbe.x);
  });
}

// ---------- match flow: hitstop, kill replay, match end ----------
const replay = new Replay();
replay.clear(sim);
const HITSTOP_KILL = 0.18; // seconds the picture holds on the killing blow…
const HITSTOP_WOUND = 0.07; // …and on a graze
const HITSTOP_CART = 0.04;  // …and a cartridge to the head
const ORBIT_FROM = -0.55, ORBIT_SWEEP = 1.1; // replay camera drifts this far round the pair
const REMATCH_DELAY = 0.8; // s the match banner is up before a press counts
// events worth hearing again in the replay (no footsteps or stance clicks)
const REPLAY_SOUNDS = new Set<GameEvent['type']>([
  'swing', 'parryTry', 'clash', 'push', 'shove', 'disengage', 'deflect', 'parried',
  'wound', 'kill', 'rebound', 'dash', 'topple', 'throw', 'cart', 'dishonor', 'hurl', 'landed', 'pickup',
]);
let hitstop = 0;
let matchUp = -1; // seconds the match banner has been showing; -1 = hidden
let replayLast: SimState | null = null;

function newMatch(): void {
  sim = createSim(cfg);
  replay.clear(sim);
  showReplayHud(false);
  pickQuote();
}

function showReplayHud(on: boolean): void {
  document.body.classList.toggle('replay', on);
}

const liveObstaclesOf = (s: SimState) => [
  ...obstacles.filter((_, i) => !s.obstacleState[i].down), ...roomWalls,
];

function startReplay(): void {
  const s = replay.first;
  replayLast = s;
  views.forEach((v, i) => v.snap(s.fighters[i], liveObstaclesOf(s)));
  updateCamera(s.fighters[0], s.fighters[1], 1, ORBIT_FROM); // cut, don't pan
  showReplayHud(true);
}

/** One render frame of the replay: recorded states through the live views, slowed. */
function playReplay(dt: number): void {
  const { states, speed, progress, done } = replay.play(dt);
  for (const st of states) {
    for (const ev of diffTick(snapshot(replayLast!), st)) {
      if (REPLAY_SOUNDS.has(ev.type)) sfx.play(ev);
    }
    replayLast = st;
  }
  const s = replay.current;
  const slow = dt * speed;
  views.forEach((v, i) => v.update(s.fighters[i], slow, liveObstaclesOf(s)));
  hitboxes.forEach((h, i) => h.update(s.fighters[i]));
  carts.update(s, slow, views);
  hurled.update(s);
  updateProps(s);
  // debris from the live round keeps settling, in slow motion too
  for (const sm of smashables) sm.update(sim, slow);
  updateCamera(s.fighters[0], s.fighters[1], dt, ORBIT_FROM + ORBIT_SWEEP * progress);
  updatePans(s);
  if (done) {
    replay.stop();
    showReplayHud(false);
  }
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
  joined = Math.max(0, joined - dt);

  // menu keys act once per render frame and are consumed, so they work while paused
  const key = (code: string): boolean => pressedThisTick.delete(code);
  // "go on": skips the replay, starts the rematch (consumes the press)
  const proceed = (): boolean =>
    key('KeyF') || key('Period') || key('Enter') || pads.take('attack');
  // a second pad pressing Start while P2 is the AI takes over P2 instead of pausing
  if (p2IsAI && pads.takeFrom(1, 'pause')) {
    p2IsAI = false;
    savePref('p2ai', false);
    joined = 2.5;
  }
  if (key('Escape') || key('KeyP') || pads.take('pause')) setPaused(!paused);
  if (key('KeyM') || pads.take('toggleAI')) {
    p2IsAI = !p2IsAI;
    savePref('p2ai', p2IsAI);
    newAI();
  }
  if (key('KeyL') || (paused && pads.take('level'))) {
    aiLevel = LEVEL_KEYS[(LEVEL_KEYS.indexOf(aiLevel) + 1) % LEVEL_KEYS.length];
    savePref('ai', aiLevel);
    newAI();
  }
  if (key('KeyR') || (paused && pads.take('reset'))) {
    newMatch();
    setPaused(false);
  }
  if (key('KeyH')) {
    const on = !hitboxes[0].group.visible;
    showHitboxes(on);
    savePref('hitboxes', on);
  }
  if (key('F1')) {
    hud.help.hidden = !hud.help.hidden;
    helpPref = hud.help.hidden ? '0' : '1';
    savePref('help', !hud.help.hidden);
  }
  if (key('KeyN')) sfx.toggleMute();

  const hold = (): void => {
    // the fight doesn't advance; presses made meanwhile don't reach it
    acc = 0;
    pressedThisTick.clear();
    pads.clearPressed();
    renderHud();
    renderer.render(scene, camera);
  };
  if (paused) { hold(); return; }
  if (hitstop > 0) { hitstop -= dt; hold(); return; }
  if (replay.playing) {
    if (replay.skippable && proceed()) {
      replay.stop();
      showReplayHud(false);
    } else {
      playReplay(dt);
      hold();
      return;
    }
  }

  // the match is decided: hold on the last corpse until someone wants a rematch
  const over = sim.matchWinner !== null && sim.roundFrame >= ROUND_END_FRAMES;
  if (over && matchUp < 0) {
    const w = sim.matchWinner!;
    hud.matchWho.textContent = `${cfg.chars[w].name.toUpperCase()} TAKES THE MATCH`;
    hud.matchScore.textContent = `${sim.fighters[w].score} – ${sim.fighters[1 - w].score}`;
    hud.match.hidden = false;
    matchUp = 0;
  }
  if (matchUp >= 0) {
    matchUp += dt;
    if (!over) { hud.match.hidden = true; matchUp = -1; } // R reset meanwhile
    else if (matchUp >= REMATCH_DELAY && proceed()) {
      newMatch();
      hud.match.hidden = true;
      matchUp = -1;
    }
  }

  while (acc >= TICK) {
    const [a, b] = sim.fighters;
    const inputs: [InputFrame, InputFrame] =
      sim.roundPhase === 'fight'
        ? [
          readInput(P1_KEYS, pads.read(0), a.stance, throwButtons[0]),
          p2IsAI ? ai.update(sim, cfg, 1) : readInput(P2_KEYS, pads.read(1), b.stance, throwButtons[1]),
        ]
        : [{ ...EMPTY_INPUT }, { ...EMPTY_INPUT }];

    const wasEnded = sim.roundPhase === 'end';
    const before = snapshot(sim);
    stepSim(sim, cfg, inputs);
    let killed = false, wounded = false, carted = false;
    for (const ev of diffTick(before, sim)) {
      sfx.play(ev);
      pads.rumble(ev);
      if (ev.type === 'kill') killed = true;
      if (ev.type === 'wound') wounded = true;
      if (ev.type === 'cart' && ev.end === 'hit') carted = true;
    }
    if (wasEnded && sim.roundPhase === 'fight') {
      pickQuote();
      replay.clear(sim);
    }
    if (!wasEnded && sim.roundPhase === 'end' && helpPref === null) hud.help.hidden = true;
    pressedThisTick.clear();
    pads.clearPressed();
    acc -= TICK;
    const cut = replay.record(sim, killed);
    if (killed || wounded || carted || cut) {
      // the picture holds on the blow (views keep the pose of the moment
      // it landed); the rest of this frame's time is dropped
      hitstop = killed ? HITSTOP_KILL : wounded ? HITSTOP_WOUND : carted ? HITSTOP_CART : 0;
      acc = 0;
      if (cut) startReplay();
      break;
    }
  }
  if (hitstop > 0 || replay.playing) { hold(); return; }

  dialogue.update(dt);

  const liveObstacles = liveObstaclesOf(sim);
  views[0].update(sim.fighters[0], dt, liveObstacles);
  views[1].update(sim.fighters[1], dt, liveObstacles);
  hitboxes[0].update(sim.fighters[0]);
  hitboxes[1].update(sim.fighters[1]);
  carts.update(sim, dt, views);
  hurled.update(sim);
  updateProps(sim);
  for (const s of smashables) {
    for (const { at, kind } of s.update(sim, dt)) {
      panProbe.copy(at).project(camera);
      sfx[kind](panProbe.x);
    }
  }
  updateCamera(sim.fighters[0], sim.fighters[1], dt);
  updatePans(sim);
  renderHud();
  renderer.render(scene, camera);
}

requestAnimationFrame(frame);
