import * as THREE from 'three';

const MAX = 12;   // samples kept
const SUB = 4;    // ribbon segments per sample gap: the weapon turns ~30° a frame in a strike
const LIFE = 0.1; // s a sample lasts (cut time: frozen in a hitstop, slowed in the replay)
const OPACITY = 0.55;
const ROOT_FADE = 0.25; // the edge nearer the hand is fainter

/**
 * The swoosh behind a cut — render only. Samples the weapon (hand + its
 * direction) each frame while the view says so and draws a ribbon over
 * the stretch `from`..`to` along it, fading with age. Between samples the
 * direction is slerped about the hand, so a fast arc stays an arc rather
 * than a fan of chords.
 */
export class Trail {
  readonly mesh: THREE.Mesh;
  private hands = Array.from({ length: MAX }, () => new THREE.Vector3());
  private dirs = Array.from({ length: MAX }, () => new THREE.Vector3());
  private ages = new Float32Array(MAX);
  private count = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private geo = new THREE.BufferGeometry();
  private q = new THREE.Quaternion();
  private q1 = new THREE.Quaternion();
  private d = new THREE.Vector3();
  private h = new THREE.Vector3();

  constructor(private from: number, private to: number, color: string) {
    const verts = ((MAX - 1) * SUB + 1) * 2;
    this.pos = new Float32Array(verts * 3);
    this.col = new Float32Array(verts * 4);
    const c = new THREE.Color(color);
    for (let i = 0; i < verts; i++) this.col.set([c.r, c.g, c.b, 0], i * 4);
    const idx: number[] = [];
    for (let i = 0; i < verts / 2 - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  clear(): void {
    this.count = 0;
    this.geo.setDrawRange(0, 0);
  }

  /** Record the weapon where it is now (world hand, unit direction to the tip). */
  push(hand: THREE.Vector3, dir: THREE.Vector3): void {
    if (this.count > 0 && hand.distanceToSquared(this.hands[0]) < 1e-8 && dir.dot(this.dirs[0]) > 0.99999) return;
    for (let i = Math.min(this.count, MAX - 1); i > 0; i--) {
      this.hands[i].copy(this.hands[i - 1]);
      this.dirs[i].copy(this.dirs[i - 1]);
      this.ages[i] = this.ages[i - 1];
    }
    this.hands[0].copy(hand);
    this.dirs[0].copy(dir);
    this.ages[0] = 0;
    this.count = Math.min(this.count + 1, MAX);
  }

  /** Age the samples by `dt` of cut time and rebuild the ribbon. */
  update(dt: number): void {
    for (let i = 0; i < this.count; i++) this.ages[i] += dt;
    while (this.count > 0 && this.ages[this.count - 1] > LIFE) this.count--;
    if (this.count < 2) {
      this.geo.setDrawRange(0, 0);
      return;
    }
    let v = 0;
    for (let i = 0; i < this.count - 1; i++) {
      const last = i === this.count - 2;
      this.q.setFromUnitVectors(this.dirs[i], this.dirs[i + 1]);
      for (let s = 0; s <= (last ? SUB : SUB - 1); s++) {
        const k = s / SUB;
        this.q1.identity().slerp(this.q, k);
        const d = this.d.copy(this.dirs[i]).applyQuaternion(this.q1);
        const h = this.h.lerpVectors(this.hands[i], this.hands[i + 1], k);
        const age = this.ages[i] + (this.ages[i + 1] - this.ages[i]) * k;
        const a = OPACITY * Math.max(0, 1 - age / LIFE);
        this.pos.set([h.x + d.x * this.from, h.y + d.y * this.from, h.z + d.z * this.from], v * 6);
        this.pos.set([h.x + d.x * this.to, h.y + d.y * this.to, h.z + d.z * this.to], v * 6 + 3);
        this.col[v * 8 + 3] = a * ROOT_FADE;
        this.col[v * 8 + 7] = a;
        v++;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
    this.geo.setDrawRange(0, (v - 1) * 6);
  }
}
