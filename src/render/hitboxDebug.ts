import * as THREE from 'three';
import { BODY_RADIUS, GLANCE_ARC_FRAC, GLANCE_REACH_FRAC } from '../sim/sim';
import { FighterState, MoveTable } from '../sim/types';

/**
 * Debug view of what the sim ACTUALLY tests (toggle with H). The fighter
 * meshes are never used for collision: each fighter is a circle of
 * BODY_RADIUS, and an attack is a wedge (reach × arcDeg, minus the
 * minReach dead zone) from weapons.json. The inner, brighter wedge is the
 * kill zone; the outer band / arc edges are the glancing (wound) zone.
 */
export class HitboxOverlay {
  readonly group = new THREE.Group();
  private body: THREE.LineLoop;
  private kill: THREE.Line;
  private glance: THREE.Line;
  private lastKey = '';

  constructor(private moves: MoveTable) {
    this.body = new THREE.LineLoop(
      circleGeo(BODY_RADIUS), new THREE.LineBasicMaterial({ color: '#8fd0ff' }),
    );
    this.kill = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ff4040' }));
    this.glance = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#ffb040' }));
    this.group.add(this.body, this.kill, this.glance);
    this.group.visible = false;
  }

  update(f: FighterState): void {
    if (!this.group.visible) return;
    this.group.position.set(f.pos.x, 0.03, f.pos.z);
    this.group.rotation.y = f.facing;
    const m = f.move ?? this.moves[f.stance];
    const key = m.name;
    if (key !== this.lastKey) {
      this.lastKey = key;
      const half = (m.arcDeg * Math.PI) / 360;
      const inner = m.minReach ?? 0;
      this.kill.geometry.dispose();
      this.glance.geometry.dispose();
      this.kill.geometry = wedgeGeo(inner, m.reach * GLANCE_REACH_FRAC, half * GLANCE_ARC_FRAC);
      this.glance.geometry = wedgeGeo(0, m.reach, half);
    }
    const attacking = f.phase === 'active';
    const winding = f.phase === 'windup';
    (this.kill.material as THREE.LineBasicMaterial).color.set(attacking ? '#ff2020' : winding ? '#ff9090' : '#704040');
    (this.glance.material as THREE.LineBasicMaterial).color.set(attacking ? '#ffc040' : winding ? '#d0a060' : '#605030');
  }
}

function circleGeo(r: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r));
  }
  return new THREE.BufferGeometry().setFromPoints(pts);
}

/** Annular wedge outline, +Z forward (matches sim: atan2(dx, dz) - facing). */
function wedgeGeo(r0: number, r1: number, half: number): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const a = -half + (i / N) * 2 * half;
    pts.push(new THREE.Vector3(Math.sin(a) * r1, 0, Math.cos(a) * r1));
  }
  for (let i = N; i >= 0; i--) {
    const a = -half + (i / N) * 2 * half;
    pts.push(new THREE.Vector3(Math.sin(a) * r0, 0, Math.cos(a) * r0));
  }
  pts.push(pts[0].clone());
  return new THREE.BufferGeometry().setFromPoints(pts);
}
