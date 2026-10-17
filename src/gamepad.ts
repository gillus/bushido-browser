import { GameEvent } from './events';

/**
 * Gamepad API input ("standard" mapping, Xbox names / PlayStation names).
 * Pads are assigned to players in connection order: first pad = P1, second
 * = P2. Keyboard keeps working alongside — main.ts merges the two.
 */
export type PadAction =
  | 'attack' | 'dash' | 'parry'
  | 'stanceUp' | 'stanceDown' | 'high' | 'mid' | 'low'
  | 'toggleAI' | 'reset';

const BUTTONS: [number, PadAction][] = [
  [0, 'attack'],      // A / Cross
  [1, 'dash'],        // B / Circle
  [2, 'parry'],       // X / Square
  [5, 'stanceUp'],    // RB / R1
  [4, 'stanceDown'],  // LB / L1
  [7, 'stanceUp'],    // RT / R2
  [6, 'stanceDown'],  // LT / L2
  [8, 'toggleAI'],    // Back / Share
  [9, 'reset'],       // Start / Options
];
const DPAD = { up: 12, down: 13, left: 14, right: 15 };

const STICK_DEADZONE = 0.2;
const FLICK_ON = 0.65;  // right stick past this = a stance flick
const FLICK_OFF = 0.35; // must return inside this before the next flick

interface Slot {
  held: boolean[];
  flicked: boolean;
  pressed: Set<PadAction>; // edges since the last sim tick
}

export interface PadRead {
  moveX: number;
  moveY: number;
  pressed: Set<PadAction>;
}

function deadzone(x: number, y: number): [number, number] {
  const m = Math.hypot(x, y);
  if (m < STICK_DEADZONE) return [0, 0];
  const k = Math.min(1, (m - STICK_DEADZONE) / (1 - STICK_DEADZONE)) / m;
  return [x * k, y * k];
}

export class GamepadInput {
  private slots = new Map<number, Slot>(); // keyed by Gamepad.index
  private pads: Gamepad[] = [];            // connected, in player order

  /** Snapshot every pad and record button edges. Call once per render frame. */
  poll(): void {
    const all = navigator.getGamepads ? navigator.getGamepads() : [];
    this.pads = all.filter((p): p is Gamepad => !!p && p.connected);
    for (const id of [...this.slots.keys()]) {
      if (!this.pads.some((p) => p.index === id)) this.slots.delete(id);
    }
    for (const pad of this.pads) {
      let slot = this.slots.get(pad.index);
      if (!slot) {
        // seed with the current state so a button held while connecting doesn't fire
        slot = { held: pad.buttons.map((b) => b.pressed), flicked: true, pressed: new Set() };
        this.slots.set(pad.index, slot);
      }
      for (const [bi, action] of BUTTONS) {
        const now = pad.buttons[bi]?.pressed ?? false;
        if (now && !slot.held[bi]) slot.pressed.add(action);
      }
      slot.held = pad.buttons.map((b) => b.pressed);

      // right-stick flick picks a stance directly: up = jodan, down = gedan, sideways = chudan
      const rx = pad.axes[2] ?? 0, ry = pad.axes[3] ?? 0;
      const m = Math.hypot(rx, ry);
      if (!slot.flicked && m > FLICK_ON) {
        slot.flicked = true;
        slot.pressed.add(Math.abs(ry) > Math.abs(rx) ? (ry < 0 ? 'high' : 'low') : 'mid');
      } else if (m < FLICK_OFF) slot.flicked = false;
    }
  }

  get count(): number { return this.pads.length; }

  /** Movement and pending presses for a player, or null if they have no pad. */
  read(player: number): PadRead | null {
    const pad = this.pads[player];
    if (!pad) return null;
    const btn = (i: number) => pad.buttons[i]?.pressed ?? false;
    let [x, y] = deadzone(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
    x += (btn(DPAD.right) ? 1 : 0) - (btn(DPAD.left) ? 1 : 0);
    y += (btn(DPAD.down) ? 1 : 0) - (btn(DPAD.up) ? 1 : 0);
    return {
      moveX: Math.max(-1, Math.min(1, x)),
      moveY: -Math.max(-1, Math.min(1, y)), // stick up (-y) = toward the opponent
      pressed: this.slots.get(pad.index)!.pressed,
    };
  }

  /** True if any pad pressed `action` since the last tick (global buttons). */
  any(action: PadAction): boolean {
    for (const s of this.slots.values()) if (s.pressed.has(action)) return true;
    return false;
  }

  /** Forget consumed edges; call after each sim tick, like the keyboard set. */
  clearPressed(): void {
    for (const s of this.slots.values()) s.pressed.clear();
  }

  /** Rumble the pads of the players a combat event concerns. */
  rumble(ev: GameEvent): void {
    switch (ev.type) {
      case 'kill':
        this.buzz(ev.who, 1.0, 1.0, 380);
        this.buzz(1 - ev.who, 0.2, 0.5, 150); // the killer feels it land
        break;
      case 'wound': this.buzz(ev.who, 0.7, 0.5, 200); break;
      case 'clash': this.buzz(0, 0.5, 0.6, 180); this.buzz(1, 0.5, 0.6, 180); break;
      case 'push': this.buzz(1 - ev.who, 0, 0.35, 45); break; // feel them lean on you
      case 'shove': this.buzz(ev.who, 0.6, 0.4, 220); break;
      case 'parried': this.buzz(ev.who, 0.4, 0.8, 160); break;
      case 'deflect': this.buzz(ev.who, 0.2, 0.6, 110); break;
    }
  }

  private buzz(player: number, strong: number, weak: number, ms: number): void {
    // vibrationActuator is missing on some browsers/pads despite the typings
    const act = this.pads[player]?.vibrationActuator as GamepadHapticActuator | undefined;
    act?.playEffect?.('dual-rumble', {
      duration: ms, strongMagnitude: strong, weakMagnitude: weak,
    }).catch(() => { /* unsupported effect */ });
  }
}
