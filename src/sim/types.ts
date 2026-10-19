export type Line = 'high' | 'mid' | 'low';
export const LINES: Line[] = ['high', 'mid', 'low'];

export interface MoveDef {
  name: string;
  line: Line;
  windup: number;   // frames
  active: number;   // frames
  recovery: number; // frames
  reach: number;    // meters, from body center
  arcDeg: number;   // horizontal arc the blade covers
  lunge: number;    // forward speed (m/s) applied late-windup + active
  minReach?: number; // inside this, hits only glance (polearm haft dead zone)
}

export type MoveTable = Record<Line, MoveDef>;

export interface WeaponDef {
  name: string;
  bladeLength: number;
  shaftLength: number; // 0 = one-handed-ish sword; >0 = polearm
  look?: 'tube' | 'broom'; // improvised-weapon visual override (render only)
  lockLeverage?: number; // tsubazeriai push multiplier (long haft = lever); default 1
  moves: MoveTable;
}

export interface CharacterDef {
  name: string;
  colors: { body: string; trim: string; skin: string; blade: string };
  heightScale: number;
  bulk: number;
  walkSpeed: number;
  dashSpeed: number;
  weapon: string; // key into weapons.json
  glasses?: boolean; // render only: thick spectacles bar on the face
  portrait?: string; // render only: dialogue headshot, path relative to the page (public/)
  cart?: string;     // render only: shell colour of the cartridges they throw
  shape?: CharacterShape; // render only: silhouette details
  outfit?: CharacterOutfit; // render only: clothes (default: gi)
}

/**
 * Render-only clothing. `style: "street"` = what they wore to the shop:
 * colors.body is the shirt, colors.trim the trousers. `style: "gi"` (the
 * default) is the old kimono/hakama look. Never touches the sim.
 */
export interface CharacterOutfit {
  style?: 'street' | 'gi';
  sleeves?: 'short' | 'long';
  legs?: 'shorts' | 'jeans';
  shoes?: string;      // sneaker upper color (soles are always white)
  socks?: string;      // visible with shorts
  emblem?: 'star' | 'bolt' | 'dpad' | 'ring'; // chest print
  emblemColor?: string;
  headband?: string;   // hachimaki color; omit for none
  headbandMark?: string; // the rising-sun dot on the forehead
  headbandTails?: number; // tail length multiplier (1 = short knot ends, 2.5 = BB streamers)
  // Bushido cosplay worn OVER the street clothes (they take this seriously):
  obi?: string;        // sash tied over the shirt, knot + swinging tails
  tasuki?: string;     // sleeve cord crossed in an X over the back
  kyahan?: string;     // shin wraps (with shorts: over the socks)
  haori?: string;      // open hip-length coat with wide sleeves
  haoriCollar?: string; // its collar band, cords and back crest
}

/**
 * Render-only silhouette knobs. None of these touch the sim; change them
 * freely when reskinning. Multipliers are 1 = neutral.
 */
export interface CharacterShape {
  belly?: number;      // 1 flat, 1.5 paunch, 0.8 concave
  chest?: number;      // barrel chest
  shoulders?: number;  // shoulder shelf width
  neck?: number;       // neck length multiplier
  head?: 'round' | 'long' | 'wide' | 'block';
  hair?: 'topknot' | 'bowl' | 'messy' | 'ponytail' | 'bald';
  hairColor?: string;
  nose?: number;       // 0 = none, 1 = normal, 1.6 = honker
  beard?: boolean;
  eyes?: boolean;      // eyes behind the specs (default true; false = none)
  tail?: boolean;      // loose tail tied at the nape, on any hair style
}

/**
 * Render-only scenery box. pos is [x, baseY, z] — y is the prop's BASE
 * (it sits on baseY), rot is yaw in degrees. Only `solid` props reach the
 * sim (as obstacles); the rest is set dressing.
 */
export interface StageProp {
  pos: [number, number, number];
  size: [number, number, number];
  color: string;
  rot?: number;
  emissive?: string; // glow, for CRT screens / signs
  solid?: boolean;   // fighters (and ragdolls) collide with it
  knockable?: boolean; // cardboard: topples on body contact instead of blocking
  // Render-only shop furniture built inside the box (front = local +z):
  fixture?: 'shelf' | 'kiosk' | 'arcade' | 'table' | 'standee' | 'poster';
  label?: string;  // shelf header / kiosk topper text / standee or poster game title
  art?: 'shooter' | 'racer' | 'rpg'; // poster illustration
  accent?: string; // sign colour
  stock?: 'games' | 'bigbox' | 'pegs'; // what a shelf holds (default games)
}

/** Yaw-rotated box collider derived from a solid StageProp. */
export interface Obstacle {
  x: number; z: number;
  halfW: number; halfD: number;
  y0: number; y1: number; // vertical extent (sim ignores; ragdoll uses)
  c: number; s: number;   // precomputed cos/sin of yaw
  knockable?: boolean;    // topples on contact; state lives in SimState
}

/** Dynamic state for one knockable obstacle (indexed like cfg.obstacles). */
export interface ObstacleState {
  down: boolean;
  fx: number; fz: number; // world fall direction (away from the toppler)
  downFrame: number;      // sim.frame when it fell, for the topple animation
}

export function obstaclesFromStage(props: StageProp[] | undefined): Obstacle[] {
  return (props ?? []).filter((p) => p.solid).map((p) => {
    const a = ((p.rot ?? 0) * Math.PI) / 180;
    return {
      x: p.pos[0], z: p.pos[2],
      halfW: p.size[0] / 2, halfD: p.size[2] / 2,
      y0: p.pos[1], y1: p.pos[1] + p.size[1],
      c: Math.cos(a), s: Math.sin(a),
      knockable: p.knockable,
    };
  });
}

/**
 * The room's four walls as thick box colliders (render-side ragdolls only;
 * the sim clamps fighters to the square via `SimConfig.arenaHalf`).
 */
export function wallObstacles(w: StageWalls | undefined): Obstacle[] {
  if (!w) return [];
  const t = 0.5, o = w.halfSize + t, span = w.halfSize + 2 * t;
  const box = (x: number, z: number, halfW: number, halfD: number): Obstacle => ({
    x, z, halfW, halfD, y0: 0, y1: w.height, c: 1, s: 0,
  });
  return [box(0, o, span, t), box(0, -o, span, t), box(o, 0, t, span), box(-o, 0, t, span)];
}

export interface StageDef {
  name: string;
  radius: number;      // circular arena (used only when there are no walls)
  gridSize: number;
  gridDivisions: number;
  gridColor: string;
  ringColor: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  floorColor?: string; // solid floor disc under the grid
  floorTile?: string;  // second checker color: tiles the floor (replaces the grid)
  tileSize?: number;   // checker tile edge in meters (default 0.6)
  walls?: StageWalls;  // room box: its walls ARE the arena boundary
  props?: StageProp[];
  clerk?: StageClerk;  // render-only shop assistant (never in the sim)
}

/** Which room wall, by its outward direction. */
export type WallSide = '-z' | '+z' | '-x' | '+x';

/**
 * Shop front cut into one wall: a display window and a glass door, with
 * the night street outside. Render-only — the sim still clamps fighters to
 * the full square, so the door is shut and the glass holds. X ranges run
 * along the wall, left → right as seen from inside the room.
 */
export interface StageStorefront {
  wall: WallSide;
  window: [number, number, number, number]; // x0, x1, sill y, head y
  mullions?: number;                        // glazing bars across the window
  door: [number, number, number];           // x0, x1, height
  frame?: string;                           // aluminium frame color
  lettering?: string;                       // vinyl shop name on the glass
  tagline?: string;                         // smaller line under it
  letteringColor?: string;
  doorSign?: string;                        // card hung inside the door
}

/** Render-only shop clerk: stands where placed, scrolls his phone, glances up. */
export interface StageClerk {
  pos: [number, number, number];
  rot: number;          // facing, degrees (0 = +z, like props)
  heightScale: number;
  bulk: number;
  skin: string;
  shirt: string;        // shop polo
  trousers: string;
  hair: string;
  hairStyle?: NonNullable<CharacterShape['hair']>;
  head?: NonNullable<CharacterShape['head']>;
}

/**
 * Square room that is the arena: fighters are clamped to `halfSize` (minus
 * body radius) and ragdolls bounce off the walls. Four inward-facing walls,
 * so whichever wall is between the camera and the fight is back-face culled
 * (dollhouse cutaway). Props should sit inside `halfSize`, flush to a wall.
 */
export interface StageWalls {
  halfSize: number;
  height: number;
  color: string;
  trim?: string; // wainscot / baseboard color (lower band)
  storefront?: StageStorefront;
}

/** One tick of intent for one fighter. attack/dash are edge-triggered. */
export interface InputFrame {
  moveX: number;          // -1..1 strafe (circle around opponent)
  moveY: number;          // -1..1 toward/away from opponent
  attack: boolean;
  dash: boolean;
  parry: boolean;
  stance: Line | null;    // direct stance select, null = keep
  throw: boolean;         // throw a cartridge (edge-triggered)
}

export const EMPTY_INPUT: InputFrame = {
  moveX: 0, moveY: 0, attack: false, dash: false, parry: false, stance: null, throw: false,
};

export type FighterPhase =
  | 'bow' | 'idle' | 'windup' | 'active' | 'recovery' | 'throw'
  | 'parry' | 'stagger' | 'flinch' | 'lock' | 'dead';

/**
 * Shuriken-uchi (`src/data/rules.json` → `carts`): a thrown game cartridge
 * flies straight along the thrower's stance line. It never cuts — a hit
 * flinches. Frames are sim ticks.
 */
export interface CartRules {
  name: string;
  ammo: number;      // per fighter per round
  windup: number;    // frames from the press to the release
  recovery: number;  // frames after the release, unguarded
  speed: number;     // m/s
  range: number;     // m before it drops (wall-less stages)
  heights: Record<Line, number>; // flight height per line: furniture at least this tall stops it
}

/**
 * The honor code (`rules.json` → `honor`). Each round opens with a bow
 * (`bowFrames`; any input breaks your own); landing a cut or a cartridge on
 * an opponent still bowing, or from more than `backDeg` off their facing,
 * is dishonorable — a dishonored fighter's kill that round scores nothing.
 */
export interface HonorRules {
  bowFrames: number;
  backDeg: number;
}

export type CartEnd = 'hit' | 'guard' | 'parry' | 'wall' | 'prop' | 'spent';

/** A cartridge in flight (or, once `end` is set, where it stopped). */
export interface Cart {
  owner: number;
  line: Line;
  x: number; z: number;
  dx: number; dz: number; // unit flight direction
  flown: number;          // m travelled
  end: CartEnd | null;    // null = still flying
  endFrame: number;       // sim.frame it stopped
}

export type WoundRegion = 'arm' | 'leg';

export interface FighterState {
  pos: { x: number; z: number };
  facing: number;         // yaw; rotation.y = facing points +Z at opponent
  stance: Line;
  phase: FighterPhase;
  phaseFrame: number;
  move: MoveDef | null;
  didHit: boolean;        // this attack already resolved (hit or deflected)
  dashVec: { x: number; z: number };
  dashLeft: number;
  dashCooldown: number;
  walkCycle: number;      // accumulated distance, drives leg swing in the view
  wounds: Record<WoundRegion, boolean>;
  staggerLen: number;     // frames for the current stagger (parried = longer)
  rebound: { x: number; z: number } | null; // where this attack's blade struck furniture or a wall (cleared on the next attack)
  score: number;
  carts: number;          // cartridges left this round
  dishonored: boolean;    // broke the honor code this round: a kill won't score
}

export type RoundPhase = 'fight' | 'end';

export interface SimState {
  frame: number;
  fighters: [FighterState, FighterState];
  roundPhase: RoundPhase;
  roundFrame: number;
  message: string;
  messageTimer: number;
  obstacleState: ObstacleState[]; // parallel to cfg.obstacles
  /** Tsubazeriai push balance while both fighters are in 'lock':
   *  +1 = fighter 0 overpowers, -1 = fighter 1 does. 0 otherwise. */
  lockBalance: number;
  /** Set once a fighter reaches `MATCH_WINS`: the match is over and the
   *  sim holds on the final corpse instead of starting another round. */
  matchWinner: number | null;
  /** Every cartridge thrown this round, in throw order (spent ones stay). */
  carts: Cart[];
}
