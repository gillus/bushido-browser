# Bushido Browser

Low-poly browser dueling game inspired by PS1's Bushido Blade. One clean hit
kills; glancing hits maim. PvP or vs AI. See README.md for controls and rules.

**Tone (user decision 2026-08-20):** the fighters are cartoonish nerd
stereotypes settling escalated arguments "in the way of bushido" with
improvised weapons. Stage 1: a videogame shop — Panzer (short/wide, cardboard
tube = katana stats) vs Sticchio (tall/skinny, shop broom = naginata stats).
The mechanics and pseudo-Japanese framing (JODAN 上段, ai-uchi, Japanese move
names) stay dead serious — that deadpan IS the joke; don't camp it up in-game.
Each future stage = a location + a dumb argument that went too far.

## Commands

- `npm run dev` — Vite dev server (usually already running on :5173)
- `npm run build` — static bundle to `dist/` (~155 kB gzipped; keep it light —
  three's `ShapeGeometry` alone costs ~7 kB, hand-build small geometry)
- `npx tsc --noEmit` — typecheck (no test runner; see Testing below)
- Deploy: push to `main` on github.com/gillus/bushido-browser → Actions
  (`.github/workflows/deploy.yml`: typecheck, build, publish `dist/`) →
  https://gillus.github.io/bushido-browser/. `vite.config.ts` sets
  `base: './'` so the bundle works under the `/<repo>/` subpath — keep any
  new asset paths relative.

## Architecture (load-bearing rules)

- `src/sim/` is a **pure simulation**: fixed 60 Hz timestep, no rendering or
  DOM imports, no `Math.random` (the AI uses seeded mulberry32). This keeps
  the sim deterministic for future WebRTC lockstep netplay — online PvP is
  deferred (user decision 2026-08-19), but do not break determinism.
- `src/render/` is view-only: three.js low-poly people posed by damping
  joint Eulers toward per-phase pose targets (`poses.ts`). Deaths swap the
  body for a verlet ragdoll (`ragdoll.ts`) — render-side only, never in the
  sim. Each joint keeps its own meshes in a "skin" group (`FighterView.skins`)
  and the ragdoll segments are deep clones of those skins, so the corpse
  always matches the living outfit — add new body parts to a skin, never
  build a second copy for the ragdoll.
- `src/main.ts` owns input edge-detection, the fixed-timestep accumulator
  loop, and the HUD. Sim ticks and render frames are decoupled. Keyboard and
  gamepad (`gamepad.ts`, polled once per render frame; pad edges accumulate
  until a tick consumes them, same as `pressedThisTick`) merge per player.
  Pad stance bumpers step relative to the fighter's current stance in main —
  the sim's `InputFrame` is unchanged.
- Audio + rumble (2026-10-17): `events.ts` diffs a `snapshot()` taken before
  `stepSim` against the sim after it → `GameEvent`s (swing, deflect vs
  parried — told apart by the defender's pre-tick phase — wound, kill, dash,
  footsteps synced to the leg swing `walkCycle * 5.2`, stance, topple,
  roundStart). `audio.ts` (`Sfx`) synthesizes every sound with Web Audio —
  no audio files, ~3 kB gz. Sounds are what the props really make (cardboard
  thock, broom whoosh, sneaker squeak); the framing plays it straight
  (hyoshigi clappers on round start, one o-daiko hit per kill). Stages with
  `walls` get a 100 Hz fluorescent-ballast hum. Never add event queues or
  audio hooks to `src/sim/` — diff from outside. Audio unlocks on keydown/
  pointerdown only (gamepad presses aren't user activation); N mutes.
- Furniture collision (2026-08-20): stage props with `"solid": true` become
  yaw-rotated box colliders (`obstaclesFromStage` in `types.ts`) passed via
  `SimConfig.obstacles`. The sim resolves fighter-circle-vs-box pushout in
  `collide()`; ragdoll particles collide with the same boxes (corpses drape
  over furniture). Attacks pass OVER furniture — only bodies collide;
  deliberate, keeps hitboxes geometric. The AI steers around furniture
  (`steerAroundFurniture` in `ai.ts`) — without it the broom AI backs into
  boxes and loses ~64/36. Props with `"knockable": true` (cardboard) topple
  on body contact instead of blocking: dynamic state lives in
  `SimState.obstacleState` (NOT in cfg — keeps state serializable for
  lockstep), resets each round; `createSim(cfg)` now takes the config.
  Render topple animation = `updateProps` in `scene.ts`.
- Combat resolution priority in `sim.ts`: blade clash (below) → active
  parry (any line, 8-frame window) → passive stance guard (matching line,
  idle only) → glancing wound (outer reach/arc: high/mid → arm, low → leg;
  repeat region = kill) → kill.
- Tsubazeriai / blade lock (2026-10-17, `tryClash`/`updateLock` in
  `sim.ts`): a landing cut whose opponent's blade is already moving on the
  SAME line (active, or last `CLASH_WINDUP_TAIL` = 6 windup frames) locks
  both in phase `'lock'` instead of hitting; cross-line simultaneous hits
  stay ai-uchi. While locked, `SimState.lockBalance` (±1) moves by
  `LOCK_PUSH` per attack press × wound multipliers × weapon `lockLeverage`;
  the pair eases to 0.9 m and drifts toward the losing side. ±1 → loser
  staggers 36f and slides back (dashVec reused in `stagger`); 150f with no
  winner → both slide apart. The AI's 'trade' threat plan switches to the
  attacker's line when its own cut would arrive within the clash window,
  and pushes at a per-lock random rate. Without broom leverage the lock
  shifted AI-vs-AI ~3 pts to the katana (it can time a meet against slow
  broom windups, the broom almost never can) — `lockLeverage: 1.4` on the
  broom restores it (20-seed × 12-min: baseline 58.5% katana, with locks
  57.5%, ±1.0 SE). Render: `lockPose` + strain tremor; HUD meter `#lock`.
  Hitboxes are geometric (reach + arc from move data), NOT mesh collision —
  deliberate, keeps the sim render-independent and fair.

## Content is data (text-based editors are a design goal, no GUI)

- `src/data/weapons.json` — per-weapon visual lengths + frame data
  (windup/active/recovery), reach, arc, lunge, optional `minReach` (polearm
  dead zone: hits inside it only glance — the naginata/katana reach game),
  optional `lockLeverage` (tsubazeriai push multiplier, default 1).
  The entire game feel lives here; tune here before touching code.
- `src/data/characters.json` — proportions (`heightScale`/`bulk` carry the
  silhouette gag), speeds, colors, `weapon` key, optional `glasses`, and an
  optional render-only `shape` block (`belly`/`chest`/`shoulders`/`neck`
  multipliers, `head`: round|long|wide|block, `hair`: topknot|bowl|messy|
  ponytail|bald, `hairColor`, `nose`, `beard`, `eyes`, `tail` = nape tail on
  any hair) — see `CharacterShape`
  in `types.ts` — and an optional render-only `outfit` block (`style`:
  street|gi, `sleeves`, `legs`: shorts|jeans, `shoes`, `socks`, `emblem`:
  star|bolt|dpad|ring, `emblemColor`, `headband` + `headbandMark` +
  `headbandTails` for the hachimaki) — see `CharacterOutfit`. With `style:
  "street"`, `colors.body` is the shirt and `colors.trim` the trousers; no
  `outfit` = the old gi. **Cosplay layer (2026-10-17, user decision):**
  Bushido Blade kit worn OVER the street clothes — `obi` (sash + tails),
  `tasuki` (X cord on the back), `kyahan` (shin wraps, shorts only),
  `haori` + `haoriCollar` (open coat, bell sleeves, back crest). Each is a
  colour string; omit to leave it off.
  Render-only fields never touch the sim; speeds/frame-data DO — keep stats
  fixed when reskinning or the 50/50 balance breaks.
- `src/data/stage.json` — arena radius, grid, fog, `floorColor` (+ optional
  `floorTile`/`tileSize` checker linoleum, which replaces the grid), optional
  `walls` (inward-facing room box + unlit ceiling with fluorescent strips; the
  wall nearest the camera back-face-culls itself — dollhouse cutaway), and `props`:
  scenery boxes (pos=[x,baseY,z], size, color, rot°, emissive, solid,
  knockable). **With `walls`, the room IS the arena** (2026-10-09): the sim
  clamps fighters to the square (`SimConfig.arenaHalf` = `walls.halfSize`),
  ragdolls bounce off `wallObstacles()`, the floor stops at the walls, and
  `radius` + the circular cage are only used for wall-less stages. Put
  furniture flush to a wall (shelves/counter are `solid`); thin non-solid
  props within 0.1 m of a wall are wall decor and hide when their wall
  culls (`wallDecor` in `scene.ts`) — otherwise posters float in front of
  the camera. `solid: true` props collide with fighters + ragdolls (keep
  them off the spawn corridor x≈0, z∈[-3,3]); `knockable: true` on a solid
  prop makes it cardboard — topples on touch, back up next round; non-solid
  props are pure set dressing.
  **Fixtures (2026-10-17, `fixtures.ts`):** a prop with `"fixture":
  "shelf" | "kiosk"` keeps its box as the collider but renders as shop
  furniture built inside it — front = local +z, so a +z-wall shelf has
  `rot: 180`, -x wall `90`, +x wall `-90`. Shelves take `label` (lit
  header sign), `accent` (sign colour) and `stock`: `games` (jewel/keep
  cases spines-out, face-outs, a fallen leaner), `bigbox` (PC boxes) or
  `pegs` (pegboard blister packs over console boxes). Stock is seeded from
  the prop's position (same shelves every load); all boxes of one fixture
  merge into a single vertex-coloured mesh (`BoxBatch`) — one draw call
  per shelf. The kiosk is a demo unit (tethered pad, CRT running a canvas
  attract-mode loop at 12 fps, ticked from `updateCamera`). Solid props
  ≥ 1.5 m tall flush to a wall hide once the camera is within 0.3 m of
  their front (`wallDecor` limits in `scene.ts`), so wall shelving never
  blocks the shot from behind. AI-vs-AI is unchanged by the wall shelving
  (identical 20-seed × 12-min results, 58.6% katana): the AI roams only
  |x| < 4.5, z ∈ [-3, 5.8], so it never reaches them — humans will.
  **Storefront (2026-10-17):** `walls.storefront` cuts a display window +
  glass door into one wall (`holedWallGeo`) and `storefront.ts` builds the
  frames, mirrored vinyl lettering, a ledge of games, and the night street
  outside (pavement, parked car, sodium lamps, blocks with lit windows).
  All of it is one group that hides with its wall, like wall decor, so the
  cutaway camera never ends up inside the street. Render-only: the sim still
  clamps to the full square — the door is shut. Far facades, lamps and light
  pools set `fog: false` (the room fog would erase the far kerb). The
  cashier is ordinary solid props (L-counter boxed into the corner beside
  the door); `stage.clerk` adds the render-only shop assistant (`clerk.ts`,
  built from the fighter parts: phone, head down, glances at the duel every
  ~8 s via `updateCamera`). AI-vs-AI duels never get past z≈-3, so props
  along the -z wall don't move AI balance (2026-10-17: identical 20-seed
  results before/after moving the counter) — only humans go there.
  **Breakable window (2026-10-17, `shopWindow.ts`):** each pane between
  mullions is a `Breakable` (`ragdoll.ts`): a slab just outside the glass
  that ragdoll particles test after the solid obstacles. A particle hitting
  it at ≥ `BREAK_SPEED` (1.5 m/s) shatters the pane and loses `BREAK_DRAG`
  of its velocity; slower ones are pushed out like a wall. A living fighter
  OVERPOWERED out of a blade lock (`stagger` with `dashLeft > 0`) into the
  window wall breaks the pane too. Shards + the knocked display boxes fly
  and settle on floor/pavement/road, jagged teeth stay in the frame,
  `Sfx.glass` plays. `ragdollWalls()` (storefront.ts) replaces that wall's
  ragdoll box with piers, bulkhead and header, so corpses drape over the
  sill through a broken pane but never leave the shop. All render-only
  (uses `Math.random` freely — never in the sim); the fighter clamp is
  unchanged and everything resets when a new round starts.
- `src/data/flavor.json` — pre-round bicker lines ([p1,p2] pairs), shown by
  `main.ts` on round start.
- `src/render/poses.ts` — joint Euler targets per stance/move phase.
- `src/render/parts.ts` — body-part geometry builders (lathe torso, tapered
  limbs, faceted heads, hair caps with a hairline, face features, glasses,
  hachimaki, street clothes: tee/emblem, hands, sneakers, cosplay layer:
  obi/tasuki/kyahan/haori). Face layout
  constants `EYE_Y`/`BAND_Y` live there. Hanging cloth/hair (hachimaki
  tails, obi tails, ponytail) is built with `tailStrip` or a pivot tagged
  `userData.dangle = stiffness`; `FighterView.updateDanglers` springs every
  tagged pivot toward gravity and drags it with the body's motion —
  render-only secondary motion, frozen in place on the ragdoll clone. Flat-shaded, 8–12 radial segments:
  "smooth but still PS1". Joint layout is the original box-man's, so poses
  are unaffected. Mesh geometry is NEVER a hitbox — press **H** in-game
  for `HitboxOverlay` (`hitboxDebug.ts`), which draws what the sim really
  tests: the `BODY_RADIUS` circle and the reach/arc/minReach wedge.
- Weapon visuals: `weapons.json` optional `look: "tube" | "broom"` switches
  improvised-weapon geometry in `fighterView.ts`; omit `look` for real
  katana/naginata visuals (both code paths kept for future stages).

## Testing

Visual checks: Python Playwright (1.51, cached Chromium) can screenshot
WebGL headlessly with `--use-gl=angle --use-angle=swiftshader
--enable-unsafe-swiftshader`. Bundle a scratchpad viewer page that imports
`src/render/` + `src/data/` with esbuild (add
`--alias:three=<repo>/node_modules/three/build/three.module.js`), serve it
with `python3 -m http.server`, set `window.__done` after rendering, and
screenshot it. Look at render changes this way before calling them done.

Verify sim changes with an AI-vs-AI smoke test: script in the session scratchpad imports from
`src/sim/` + `src/data/`, bundled via `node_modules/.bin/esbuild <file>
--bundle --format=esm --platform=node`, run with node. Assert: rounds end,
no NaN/arena escapes, mechanic counters (deflects/parries/wounds) nonzero.
Balance claims need 10+ sim-minutes — 3-minute runs are seed-noisy.

## Known tuning debts (pending user playtest)

- AI-vs-AI baseline drifted to ~56–58% katana since the walled room
  (2026-10-17 20-seed runs) — the 54/46 figure below predates the walls.
- Lock push is attack-mashing vs an AI pushing 4–9×/s (`lockRate` in
  `ai.ts`); humans may mash faster — check in playtest.
- Mid thrust (Tsuki) is fastest AND longest reach — likely dominant.
- Arm wounds vastly outnumber leg wounds (2 of 3 lines map to arm).
- Katana vs naginata was AI-balanced to ~50/50 on 2026-08-19 (two 12-min
  runs: 65-60, 59-61); human play may shift it — retune naginata windups
  and `minReach` in weapons.json, not code.
- Parry window (`PARRY_WINDOW` in `sim.ts`) is 8f = forgiving; 6f = expert.
- In-arena furniture leans katana slightly (~54/46 AI-vs-AI over 24 min,
  2026-08-20: 62-60, 71-54) — more walls favor the close-range weapon.
  Within noise; retune after human playtest if it holds.
- Ragdoll drama knobs: impulse `2.2` in `fighterView.ts` `spawnRagdoll`,
  `AIR_DAMP`/`GROUND_FRICTION` in `ragdoll.ts`, corpse linger =
  `ROUND_END_FRAMES` in `sim.ts`.
