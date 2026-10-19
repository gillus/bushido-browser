# BUSHIDO BROWSER

A low-poly, browser-based dueling game — *Bushido Blade* mechanics, but the
duelists are two guys from the local videogame shop whose argument went too
far. One clean hit kills. No health bars. There is no steel.

**The premise:** every stage is a stupid argument that escalated until both
parties agreed it could only be settled in the way of bushido. Stage one: the
videogame shop. **Panzer** (short, wide, Nintendo loyalist, cardboard tube)
vs **Sticchio** (tall, skinny, SEGA apologist, shop broom). They take the
forms *extremely* seriously — Jodan, Chudan, ai-uchi — with a wrapping-paper
tube and a broom, and they dressed for it: hachimaki, obi and shin wraps over
Panzer's tee, a haori over Sticchio's. The interface plays it straight
because *they* play it straight.

## Play

**[Play in your browser → gillus.github.io/bushido-browser](https://gillus.github.io/bushido-browser/)**

No install; keyboard or gamepad. You start against the AI (it plays Sticchio);
press **M** to switch to two players on one keyboard (or two pads). Every push to `main` redeploys it via GitHub
Actions.

## Run locally

```
npm install
npm run dev      # then open the printed localhost URL
```

`npm run build` produces a small static bundle in `dist/` (~175 kB gzipped).

## Controls

|            | P1 (Panzer) | P2 (Sticchio) |
|------------|-------------|---------------|
| Move       | W A S D     | Arrow keys    |
| Attack     | F           | .             |
| Dash       | G           | ,             |
| Parry      | Space       | /             |
| Stance     | 1 / 2 / 3   | 8 / 9 / 0     |
| Throw cart | T           | ;             |
| Throw weapon | hold T    | hold ;        |

Gamepads (any pad the browser reports with the standard layout; Xbox names,
PlayStation in brackets). The first pad connected is P1, the second is P2. Keyboard keeps working
alongside.

| Action     | Pad |
|------------|-----|
| Move       | Left stick or D-pad (analog: half tilt = slow walk) |
| Attack     | A (✕) |
| Dash       | B (○) |
| Parry      | X (□) |
| Throw cart | Y (△) |
| Throw weapon | hold Y (△) |
| Stance     | RB/RT raise · LB/LT lower — or flick the right stick: up Jodan, sideways Chudan, down Gedan |
| Toggle AI  | Back (Share) |
| Pause      | Start (Options) — then Y (△) resets the match, X (□) cycles the AI level |
| Join as P2 | Start on the second pad while P2 is the AI |

Pads rumble when you're cut, killed, deflected or parried.

- **Esc** / **P** — pause (lists every control); the game also pauses itself
  when the tab loses focus. **F1** — show/hide the controls bar (it hides
  itself after the first round; your choice is remembered).
- **M** — toggle P2 between AI and human (remembered). **L** — AI level:
  *Kohai* (easy: slow to react, often freezes, misses openings), *Senpai*
  (normal), *Sensei* (hard: quick, parries a lot) — remembered; on a pad,
  X (□) while paused. A second pad pressing **Start** while P2 is the AI
  takes over P2. **R** — reset the match.
  **N** — sound on/off (remembered). Browsers keep audio locked until you click or
  press a key, and a gamepad press doesn't count.
  **H** — show the real hitboxes (body circle + attack wedge; red = kill zone, amber = glancing; remembered).
- Movement is opponent-relative: forward/back closes/opens distance, left/right circles.

## How to not die

- Three stances: **Jodan** (high), **Chudan** (mid), **Gedan** (low). Each stance
  has one attack whose line matches the stance.
- If you are standing guard (not attacking, not dashing) and your stance matches
  the line of the incoming cut, you **deflect** it — the attacker staggers, and
  staggered fighters are free kills.
- **Active parry**: a timed press opens an 8-frame (~133 ms) window that
  deflects *any* line — no stance matching needed — staggers the attacker much
  longer than a passive deflect, and snaps you straight back to neutral for the
  punish. Whiff it and you are locked out and unguarded for ~half a second.
- Wrong stance, mid-swing, or mid-dash: one hit and you are done.
- **Glancing hits maim instead of killing** — a hit landing near max reach or
  the outer edge of the swing arc hurts but leaves you standing.
  High/mid glances wound the **weapon arm** (windups ~35% slower); low glances
  wound the **leg** (kneeling: half speed, no dash, weaker lunge). Getting
  wounded flinches you, cancelling whatever you were doing. A second graze to
  an already-wounded region kills. Wounds last until the round ends.
- **Renzoku-giri 連続斬り: chained cuts.** Whiff, and you can chain
  out of the recovery into a *different* line: change stance and press
  attack during the follow-through (it goes about a third of the way in;
  press earlier in the follow-through and it waits for that). The re-aimed second cut
  winds up ~15% quicker — a Jodan that missed becomes a Chudan thrust at
  whoever stepped in to punish it. Up to two follow-ups, and only off a
  clean miss: a cut that landed, was deflected or was parried can't chain.
  Guards and parries still stop it like any other cut.
- Dashing has no invincibility — it saves you only if it actually carries you
  out of the weapon's reach.
- **Weapons have a reach game.** The broom out-ranges the cardboard tube by
  ~0.6 m with huge sweeping arcs, but is slower everywhere and has a
  `minReach` dead zone: inside the haft its swings only glance (the handle
  smacks and wounds, never cleanly kills). The tube wants to live inside that
  zone; the broom wants to keep you out of it.
- **The furniture is real.** Bargain bin, CRT demo kiosk, arcade cabinet,
  display table —
  you can't walk through them, and neither can he. Put a box between you
  and a broom. Corpses land on the merchandise. (Swings sweep *over*
  furniture — only bodies collide.) The cardboard standee is the exception:
  touch it and it goes down, and stays down until the next round. Nobody
  ever respects the standee. Throw someone through the shop window, into
  the demo kiosk, the arcade cabinet or the glass display table and it
  breaks — the shop is fixed before the next round.
- **Tsubazeriai.** If your cut lands while his is already coming down the
  *same* line, the weapons meet and lock guard-to-guard. Hammer attack to
  push; whoever drives the meter to the end throws the other off balance
  (a short stagger: punish it). Nobody wins in ~2.5 s and you both break
  apart. A cut arm or a bad knee pushes weaker; the broom's long haft is
  a lever and pushes harder.
- Simultaneous clean hits on *different* lines pass each other: an
  *ai-uchi*. Both fall, nobody scores. They would both insist this proves
  their point.
- **Shuriken-uchi 手裏剣打ち.** You have three game cartridges in your
  pockets each round (▮▮▮ by your stance). A throw flies straight along
  your stance's line: Jodan at the head, Chudan at the chest, Gedan at
  the shins. It never cuts — a hit just flinches, which cancels a wind-up
  and buys a moment. A guard on that line knocks it away, a parry swats
  it from any line, and tall enough furniture stops it. Throwing leaves
  you open, so do it from out of reach. The cartridge in flight can be
  sidestepped.
- **Tachi-nage 太刀投げ: throw your weapon.** Hold the throw button and
  you hurl the tube (or the broom) itself, on your stance's line like a
  cartridge. It hits like a cut: dead centre kills, a clip at the edge of
  its path maims. A guard on that line or a parry knocks it away, and
  then you're *UNARMED 無刀*: no cuts, no guard, no parry, only your
  cartridges and your feet, until you walk back over it (a short stoop —
  wide open). A last resort. (A tap still throws a cartridge; it goes when
  you let go of the button.)
- **The honor code.** Each round opens with a bow (*REI 礼*); any input
  ends yours. Landing a cut or a cartridge on an opponent who is still
  bowing, or hitting them in the back, is *DISHONOR 不名誉*: a dishonored
  fighter's kill that round scores nothing. (The cartridge to the bowing
  head is the classic.)
- **First to three clean kills takes the match** (◆◆◇ by the names).
  Every kill lands with a beat of hitstop and then a slow-motion replay of
  the cut (attack or Enter skips it); the last one ends on *shobu ari* —
  attack or Enter for a rematch.

## Editing content (the "text-based editor")

All content is plain JSON in `src/data/` — edit and the dev server hot-reloads:

- `characters.json` — name, colors, proportions (`heightScale`, `bulk` — this
  is the entire Panzer/Sticchio silhouette gag), `walkSpeed`, `dashSpeed`,
  `weapon` (a key into `weapons.json`), optional `glasses`, `portrait` (the
  headshot in the pre-round dialogue box: drop a square image at
  `public/portraits/panzer.png` / `sticchio.png`; until then it's a
  placeholder), plus render-only
  `shape` (head/hair/face) and `outfit` (street clothes + the cosplay layer:
  `headband`, `headbandTails`, `obi`, `tasuki`, `kyahan`, `haori`) blocks —
  see `CharacterShape` / `CharacterOutfit` in `src/sim/types.ts`.
- `weapons.json` — one entry per weapon: visual lengths (`bladeLength`,
  `shaftLength`), optional `look` (`"tube"` / `"broom"` improvised-weapon
  visuals; omit for real blades), plus per-line move frame data: `windup` /
  `active` / `recovery` (in 60ths of a second), `reach` (m), `arcDeg`
  (horizontal arc), `lunge` (forward m/s during the swing), optional
  `minReach` (polearm dead zone — hits inside it only glance), optional
  `lockLeverage` (tsubazeriai push strength, default 1). The whole feel
  of the game lives here.
- `stage.json` — arena radius, floor grid, fog, plus `props`: a list of
  scenery boxes (`pos` = [x, baseY, z], `size`, `color`, optional `rot` yaw
  in degrees, `emissive` glow for CRT screens / signs, and `solid`). Solid
  props are obstacles: fighters collide, ragdolls drape over them, and the
  AI steers around them. Add `knockable` to a solid prop to make it
  cardboard: it topples on body contact instead of blocking, and pops back
  up each round. Non-solid props are pure set dressing. Add `"fixture": "shelf"`
  (with a `label`, an `accent` colour and `stock`: `games`, `bigbox` or
  `pegs`), `"fixture": "kiosk"`, `"fixture": "arcade"` (the `label` is
  the game on its marquee) or `"fixture": "table"` to render a prop as
  stocked shelving, a console demo kiosk, an upright arcade cabinet or a
  glass-topped display table instead of a plain box (front = local +z). `walls.storefront`
  cuts a display window and glass door into one wall (with the street
  outside, and the shop name on the glass); `clerk` places the shop
  assistant behind the counter. Both are scenery only — the door stays shut —
  but the display window, the demo kiosk, the arcade cabinet and the
  display table break when a corpse is flung
  into them or a fighter is shoved into them out of a blade lock
  (everything is repaired for the next round).
- `rules.json` — the cartridge throw (`ammo`, `windup`, `recovery`,
  `speed`, flight `heights` per line), the weapon throw (`hurl`: the same
  plus `pickupFrames`, the stoop to get it back), chained cuts (`chain`:
  `open` = how far into a whiff's recovery the chain can start, `windupMult`,
  `max` follow-ups) and the honor code (`bowFrames`, and
  `backDeg`: how far round behind someone a hit counts as "in the back").
- `flavor.json` — the pre-round bickering lines (`[panzerLine, sticchioLine]`
  pairs), played out in RPG text boxes before each round. New stage = new
  argument.

Animation poses (joint Euler angles per stance / move phase) live in
`src/render/poses.ts` — same idea, numbers you can tweak by hand.

## Architecture

- `src/sim/` — pure simulation, no rendering imports. Fixed 60 Hz timestep,
  seeded-RNG AI. Kept deterministic-friendly so lockstep netplay over WebRTC
  stays possible later. The sim genuinely believes this is a samurai duel.
- `src/render/` — three.js view: procedural box-people posed by interpolating
  joint targets, data-driven scenery props, auto-framing duel camera. Deaths
  swap the articulated body for a verlet ragdoll (16 particles, braced stick
  constraints, ground friction) seeded from the skeleton's world pose with an
  impulse away from the killer — the weapon stays in the death grip.
- `src/main.ts` — input edge-detection (keyboard + `gamepad.ts`), fixed-timestep loop, HUD, bicker lines.
- `src/events.ts` — diffs the sim before/after each tick into presentation
  events (swing, deflect, parried, wound, kill, step…) for `audio.ts` (procedural
  Web Audio: every sound is synthesized, no audio files) and pad rumble. The
  sim never knows it's being listened to.

## Roadmap ideas

- More stages = more escalated arguments (comic shop? MtG back room? con hallway?)
- More improvised weapons (rolled poster? foam dart blaster as… something?)
- Online PvP via WebRTC lockstep (sim is already fixed-timestep + seeded RNG)
  — deliberately deferred for now
