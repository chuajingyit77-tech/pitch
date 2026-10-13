// Tropical fruit for feeding: mango, papaya slice, halved passion fruit, berry cluster.
import * as THREE from 'three';
import { TAU, clamp, lerp, damp, smoothstep, makeRng } from '../../lib/util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { jungleMaterial } from './shading.js';
import { WATER_Y } from './terrain.js';

function colored(g, fn) {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  const p = ng.attributes.position, n = ng.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); nn.fromBufferAttribute(n, i); const c = fn(v, nn); col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function mango() {
  const g = new THREE.SphereGeometry(1, 20, 14);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) * 0.42, y = p.getY(i) * 0.36, z = p.getZ(i) * 0.55;
    x += z * z * 0.25; // kidney bend
    p.setXYZ(i, x, y + 0.36, z);
  }
  g.computeVertexNormals();
  const body = colored(g, v => {
    const t = clamp(0.5 + v.z * 0.9 + v.y * 0.4, 0, 1);
    return mix(mix([0.55, 0.62, 0.1], [0.98, 0.62, 0.08], clamp(t * 1.6, 0, 1)), [0.85, 0.18, 0.08], clamp(t * 1.4 - 0.5, 0, 1));
  });
  const stem = colored(new THREE.CylinderGeometry(0.025, 0.03, 0.08, 5).translate(0.06, 0.74, -0.42), () => [0.25, 0.18, 0.08]);
  return mergeGeometries([body, stem]);
}

function papaya() {
  // half of an elongated fruit, cut face up: skin below, orange flesh, seed cavity with black seeds
  const g = new THREE.SphereGeometry(1, 20, 10, 0, TAU, Math.PI / 2, Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * 0.4, p.getY(i) * 0.3 + 0.3, p.getZ(i) * 0.7);
  g.computeVertexNormals();
  const skin = colored(g, (v, n) => mix([0.95, 0.65, 0.12], [0.45, 0.6, 0.12], clamp(-v.y + 0.3, 0, 1) * 0.6));
  const top = new THREE.CircleGeometry(1, 24);
  top.rotateX(-Math.PI / 2);
  const tp = top.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const x = tp.getX(i), z = tp.getZ(i);
    const d = Math.hypot(x, z);
    tp.setXYZ(i, x * 0.4, 0.3 - Math.max(0, 0.5 - d) * 0.12, z * 0.7);
  }
  top.computeVertexNormals();
  const face = colored(top, v => { const d = Math.hypot(v.x / 0.4, v.z / 0.7); return d < 0.45 ? [0.75, 0.28, 0.08] : mix([1.0, 0.45, 0.12], [1.0, 0.62, 0.25], (d - 0.45) * 2); });
  const parts = [skin, face];
  const rng = makeRng(7);
  for (let k = 0; k < 18; k++) {
    const a = rng.next() * TAU, r = Math.sqrt(rng.next()) * 0.38;
    const s = colored(new THREE.SphereGeometry(0.045, 5, 4).translate(Math.cos(a) * r * 0.4, 0.27, Math.sin(a) * r * 0.7), () => [0.03, 0.03, 0.03]);
    parts.push(s);
  }
  return mergeGeometries(parts);
}

function passion() {
  const g = new THREE.SphereGeometry(0.42, 18, 10, 0, TAU, Math.PI / 2, Math.PI / 2);
  g.translate(0, 0.42, 0);
  const rng = makeRng(3);
  const skin = colored(g, v => { const sp = Math.sin(v.x * 40) * Math.sin(v.z * 37) > 0.85 ? 0.6 : 0; return mix([0.28, 0.06, 0.22], [0.6, 0.5, 0.45], sp); });
  const top = new THREE.CircleGeometry(0.4, 20);
  top.rotateX(-Math.PI / 2); top.translate(0, 0.42, 0);
  const face = colored(top, v => { const d = Math.hypot(v.x, v.z) / 0.4; return d > 0.85 ? [0.92, 0.9, 0.75] : [1.0, 0.72, 0.1]; });
  const parts = [skin, face];
  for (let k = 0; k < 22; k++) {
    const a = rng.next() * TAU, r = Math.sqrt(rng.next()) * 0.3;
    parts.push(colored(new THREE.SphereGeometry(0.03, 4, 3).translate(Math.cos(a) * r, 0.43, Math.sin(a) * r), () => [0.05, 0.03, 0.02]));
  }
  return mergeGeometries(parts);
}

function berries() {
  const rng = makeRng(11);
  const parts = [];
  for (let k = 0; k < 8; k++) {
    const a = rng.next() * TAU, r = k === 0 ? 0 : rng.range(0.15, 0.3);
    const s = rng.range(0.15, 0.2);
    const purple = rng.chance(0.4);
    parts.push(colored(new THREE.SphereGeometry(s, 10, 8).translate(Math.cos(a) * r, s + (k > 5 ? 0.18 : 0), Math.sin(a) * r), () => purple ? [0.32, 0.05, 0.3] : [0.85, 0.06, 0.1]));
  }
  parts.push(colored(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 4).rotateZ(1.2).translate(0.1, 0.4, 0), () => [0.3, 0.4, 0.15]));
  return mergeGeometries(parts);
}

export const FRUIT_KINDS = [
  { name: '芒果', build: mango, bites: 9, scale: 0.26, r: 0.14 },
  { name: '木瓜', build: papaya, bites: 8, scale: 0.28, r: 0.12 },
  { name: '百香果', build: passion, bites: 6, scale: 0.3, r: 0.13 },
  { name: '野莓', build: berries, bites: 6, scale: 0.3, r: 0.12 },
];

export class FruitSystem {
  constructor(shared, maxPer = 8, shadows = false) {
    this.items = [];
    // room for the recycled fruit that are still fading out next to the new ones
    this.cap = maxPer * 2;
    this.meshes = FRUIT_KINDS.map(k => {
      const g = k.build();
      const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.3 });
      jungleMaterial(mat, shared, { translucent: 0.2 });
      const m = new THREE.InstancedMesh(g, mat, this.cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.castShadow = shadows; m.frustumCulled = false;
      return m;
    });
    this.maxPer = maxPer;
  }
  spawn(kindIndex, pos, onWater, rng) {
    const perKind = this.items.filter(f => f.kind === kindIndex && !f.dead && !f.dying).length;
    if (perKind >= this.maxPer) {
      // recycle the oldest of this kind: it fades out (it used to vanish in one frame)
      const old = this.items.find(f => f.kind === kindIndex && !f.dead && !f.dying && !f.heldBy) || this.items.find(f => f.kind === kindIndex && !f.dead && !f.dying);
      if (old) { old.dying = true; if (old.heldBy) old.heldBy = null; }
    }
    const K = FRUIT_KINDS[kindIndex];
    const f = {
      kind: kindIndex, pos: pos.clone().add(new THREE.Vector3(0, 2.6, 0)), rest: pos.clone(), vel: new THREE.Vector3(rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3)),
      quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.next() * TAU), spin: rng.range(-3, 3),
      state: 'fall', onWater, bites: K.bites, maxBites: K.bites, scale: K.scale, r: K.r, age: 0, dead: false, fade: 1,
      claims: [], heldBy: null, bob: rng.next() * TAU, landed: false, grow: 0, sz: K.scale, splashT: -1,
    };
    this.items.push(f);
    return f;
  }
  alive() { return this.items.length ? this.items.filter(f => !f.dead && !f.dying && f.state !== 'fall' && f.bites > 0) : NONE; }
  bite(f, amount = 1) {
    f.bites -= amount;
    if (f.bites <= 0) { f.bites = 0; f.dying = true; }
  }
  update(dt, t, hooks) {
    const counts = this._counts || (this._counts = [0, 0, 0, 0]);
    counts.fill(0);
    const m4 = _m4;
    for (const f of this.items) {
      if (f.dead) continue;
      f.age += dt;
      if (f.state === 'fall') {
        // exact ballistic step (the explicit one fell a few per cent faster at 30 fps than at 60)
        f.pos.addScaledVector(f.vel, dt);
        f.pos.y -= 4.9 * dt * dt;
        f.vel.y -= 9.8 * dt;
        const floor = f.onWater ? WATER_Y - 0.05 : f.rest.y;
        if (f.pos.y <= floor) {
          f.pos.y = floor;
          if (f.onWater) {
            f.state = 'float'; f.splashT = 0;
            // bob phase chosen so the float starts exactly where the fall ended (it hopped by up to 2 cm)
            f.bob = -0.985 / 1.6;
            hooks.splash(f);
          } else if (!f.landed && Math.abs(f.vel.y) > 2) { f.landed = true; f.vel.set(f.vel.x * 0.4, -f.vel.y * 0.22, f.vel.z * 0.4); f.spin *= 0.4; hooks.thud(f); }
          else { f.state = 'rest'; f.vel.set(0, 0, 0); }
        }
      } else if (f.state === 'float') {
        f.bob += dt;
        // after the splash it dips a few centimetres and comes back up (critically damped), then bobs
        f.splashT += dt;
        const dip = -0.6 * f.splashT * Math.exp(-8 * f.splashT);
        f.pos.y = WATER_Y - 0.04 + Math.sin(f.bob * 1.6) * 0.012 + dip;
        f.pos.x += f.vel.x * dt; f.pos.z += f.vel.z * dt;
        f.vel.multiplyScalar(Math.exp(-0.3 * dt));
        hooks.drift(f, dt);
      }
      // the tumble slows to a stop on the ground or the water instead of freezing at touch-down
      if (f.state !== 'fall') f.spin *= Math.exp(-6 * dt);
      if (Math.abs(f.spin) > 1e-3) f.quat.multiply(_q.setFromAxisAngle(_ax.set(0.3, 1, 0.2).normalize(), f.spin * dt));
      if (f.heldBy) hooks.held(f, dt);
      if (f.dying || f.age > 240) {
        f.fade -= dt * 2.5;
        if (f.fade <= 0) { f.dead = true; continue; }
      }
      // appears with a quick grow instead of popping in, and shrinks smoothly with each bite (a bite used to
      // take a step of up to 8 % off its size in one frame)
      f.grow = Math.min(1, f.grow + dt / 0.15);
      f.sz = damp(f.sz, f.scale * (0.5 + 0.5 * f.bites / f.maxBites), 6, dt);
      const s = f.sz * Math.max(0, f.fade) * smoothstep(0, 1, f.grow);
      if (counts[f.kind] >= this.cap) continue;
      m4.compose(f.pos, f.quat, _sv.setScalar(Math.max(s, 1e-4)));
      const mesh = this.meshes[f.kind];
      mesh.setMatrixAt(counts[f.kind]++, m4);
    }
    for (let k = 0; k < this.meshes.length; k++) { this.meshes[k].count = counts[k]; this.meshes[k].instanceMatrix.needsUpdate = true; }
    // prune
    if (this.items.length > 40) this.items = this.items.filter(f => !f.dead);
  }
  dispose() { this.meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); }); }
}
const _q = new THREE.Quaternion(), _ax = new THREE.Vector3(), _sv = new THREE.Vector3(), _m4 = new THREE.Matrix4();
const NONE = Object.freeze([]);
