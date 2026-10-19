import * as THREE from 'three';
import { TICK } from '../sim/sim';
import { Cart, CartEnd, HurlRules, SimState } from '../sim/types';
import { FighterView } from './fighterView';

const RELEASE_Y = 1.55; // leaves the hand over the shoulder…
const SETTLE_M = 1.5;   // …and is down on its line this far out
const SPIN = 1.8;       // rad per metre flown, end over end (~4 turns a second)
const SPIN_FROM = 2.4;  // at release the business end still points back
// after it stops: how long (s) and how high (m) it bounces to where the sim says it lies
const HOP: Record<CartEnd, [number, number]> = {
  hit: [0.35, 0.2], guard: [0.55, 0.6], parry: [0.55, 0.7],
  wall: [0.45, 0.3], prop: [0.45, 0.3], spent: [0.3, 0.1],
};

interface Piece {
  pivot: THREE.Group; // where it is, yawed to the flight
  spin: THREE.Group;  // end over end about the pivot's x
  lift: number;       // centre height lying flat
}

/**
 * Hurled weapons (`SimState.carts` with `kind: 'weapon'`): a copy of the
 * thrower's weapon (`FighterView.weaponClone`) whirling end over end along
 * the sim's flight, then bouncing to the spot the sim says it lies
 * (`FighterState.weaponAt`) — so what you see is where you must walk to
 * pick it up. Everything is a function of the state shown (frames since
 * it stopped, not wall time), so the kill replay rewinds it too. Hidden
 * while the owner holds it: the hand's own weapon shows then.
 */
export class HurlView {
  readonly group = new THREE.Group();
  private pieces: Piece[];
  private hand = new THREE.Vector3();

  constructor(private views: FighterView[], private rules: HurlRules) {
    this.pieces = views.map((v) => {
      const w = v.weaponClone();
      const box = new THREE.Box3().setFromObject(w);
      w.position.sub(box.getCenter(new THREE.Vector3())); // spin about the middle
      const spin = new THREE.Group();
      spin.add(w);
      const pivot = new THREE.Group();
      pivot.add(spin);
      pivot.visible = false;
      this.group.add(pivot);
      // flat (spin π/2) the weapon's z depth becomes its height
      return { pivot, spin, lift: (box.max.z - box.min.z) / 2 + 0.005 };
    });
  }

  update(s: SimState): void {
    this.pieces.forEach((p, i) => {
      let c: Cart | null = null;
      for (const k of s.carts) if (k.kind === 'weapon' && k.owner === i) c = k;
      p.pivot.visible = !!c && !s.fighters[i].armed;
      if (!c || !p.pivot.visible) return;

      const yaw = Math.atan2(c.dx, c.dz);
      const line = this.rules.heights[c.line];
      const y = line + (RELEASE_Y - line) * Math.max(0, 1 - c.flown / SETTLE_M);
      const spun = SPIN_FROM + c.flown * SPIN;
      const rest = s.fighters[i].weaponAt;
      if (!c.end || !rest) {
        p.pivot.position.set(c.x, y, c.z);
        p.pivot.rotation.set(0, yaw, 0);
        p.spin.rotation.x = spun;
        return;
      }

      // bounce from where it stopped to where it lies, the spin running
      // down so it lands flat
      const [dur, height] = HOP[c.end];
      const u = Math.min(1, (s.frame - c.endFrame) * TICK / dur);
      const back = c.end === 'guard' || c.end === 'parry'; // knocked back the way it came
      const flat = Math.PI / 2;
      const turn = 2 * Math.PI;
      const left = back
        ? ((spun - flat) % turn + turn) % turn + turn  // unwinds backwards
        : ((flat - spun) % turn + turn) % turn + turn; // keeps tumbling on
      const ease = (1 - u) * (1 - u);
      p.spin.rotation.x = back ? flat + left * ease : flat - left * ease;
      p.pivot.position.set(
        c.x + (rest.x - c.x) * u,
        y + (p.lift - y) * u + 4 * height * u * (1 - u),
        c.z + (rest.z - c.z) * u,
      );
      const skew = (c.endFrame % 2 ? 1 : -1) * (back ? 1.2 : 0.5);
      p.pivot.rotation.set(0, yaw + skew * u, 0);

      // stooping for it: the back half of the stoop brings it up into the hand
      const f = s.fighters[i];
      if (f.phase === 'pickup') {
        const g = Math.max(0, Math.min(1, f.phaseFrame / this.rules.pickupFrames * 2 - 0.8));
        p.pivot.position.lerp(this.views[i].rightHand(this.hand), g);
      }
    });
  }
}
