// Scarlet macaws from models/Parrot.glb: the clip's morph-target flap cycle is sampled by hand so we
// can blend it with a procedural "folded wings" target for perching, glide with wings spread, and
// flare to land.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, damp } from '../../lib/util.js';
import { jungleMaterial } from './shading.js';

export async function loadMacawKit(env, shared) {
  const gltf = await env.loadGLTF('models/Parrot.glb');
  let src = null;
  gltf.scene.traverse(o => { if (o.isMesh && !src) src = o; });
  const geo = src.geometry.clone();
  const base = geo.attributes.position;
  const n = base.count;
  const fold = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = base.getX(i), y = base.getY(i), z = base.getZ(i);
    const ax = Math.abs(x);
    if (ax < 6.5) continue;
    const s = Math.sign(x);
    const d = ax - 6.5;
    const nx = s * (5.8 + d * 0.05 + Math.max(0, y) * 0.02);
    const ny = 2.5 - d * 0.1 + (y - 3) * 0.12;
    const nz = z * 0.35 - 4 - d * 1.05;
    fold[i * 3] = nx - x; fold[i * 3 + 1] = ny - y; fold[i * 3 + 2] = nz - z;
  }
  const targets = geo.morphAttributes.position.slice();
  targets.push(new THREE.Float32BufferAttribute(fold, 3));
  geo.morphAttributes.position = targets;
  geo.morphTargetsRelative = true;
  const clip = gltf.animations[0];
  const track = clip.tracks[0];
  const nT = track.getValueSize();
  const interp = track.createInterpolant(new Float32Array(nT));
  // Parrot.glb has no normals: flat shading derives them per pixel (and follows the morphs)
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.0, flatShading: true });
  jungleMaterial(mat, shared, { translucent: 0.1 });
  return { geo, mat, interp, nT, duration: clip.duration, foldIndex: nT };
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0), _x = new THREE.Vector3(1, 0, 0), _z = new THREE.Vector3(0, 0, 1), _e = new THREE.Euler();

function bezier(out, p0, p1, p2, p3, t) {
  const u = 1 - t;
  return out.set(0, 0, 0)
    .addScaledVector(p0, u * u * u).addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t).addScaledVector(p3, t * t * t);
}

export class Macaw {
  constructor(kit, member, rng, world) {
    this.kit = kit; this.member = member; this.rng = rng; this.world = world;
    this.mesh = new THREE.Mesh(kit.geo, kit.mat);
    this.mesh.castShadow = world.shadows;
    this.mesh.frustumCulled = false;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.flapT = rng.next() * kit.duration;
    this.flapRate = 1; this.flapAmt = 0; this.fold = 1;
    this.state = 'perch';
    this.timer = rng.range(2, 8);
    this.perch = null;
    this.path = null;
    this.bank = 0;
    this.carry = null; // fruit being carried / eaten
    this.biteT = 0;
    this.lookYaw = 0;
    this.headBob = 0;
    this.scale = 0.0088;
  }
  get size() { return 0.85 + 0.15 * (this.member ? this.member.size : 1); }
  /** Beak position in world space. */
  beak(out) { return out.set(0, 3, 27).applyMatrix4(this.mesh.matrixWorld); }

  placeAt(perch) {
    this.perch = perch; perch.taken = this;
    this.pos.copy(perch.pos);
    this.state = 'perch';
    this.timer = this.rng.range(7, 18);
    this.fold = 1; this.flapAmt = 0;
    this.faceYaw = Math.atan2(perch.face.x, perch.face.z);
  }

  flyTo(target, { land = true, arrive = null, speed = 5.2, dip = 1.2 } = {}) {
    const p0 = this.pos.clone();
    const p3 = target.clone();
    const dir = _v.subVectors(p3, p0);
    const dist = dir.length();
    dir.normalize();
    const fwd = this.state === 'perch' ? new THREE.Vector3(Math.sin(this.faceYaw), 0, Math.cos(this.faceYaw)) : this.vel.clone().normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(this.rng.range(-0.25, 0.25) * dist);
    const p1 = p0.clone().addScaledVector(fwd, Math.min(3, dist * 0.3)).add(_v2.set(0, -dip, 0)).add(side);
    const p2 = p3.clone().addScaledVector(dir, -Math.min(3.5, dist * 0.35)).add(_v2.set(0, land ? 1.4 : 0, 0)).add(side.multiplyScalar(0.5));
    const len = dist * 1.25 + 2;
    this.path = { p0, p1, p2, p3, t: 0, dur: len / speed, land, arrive };
    this.state = 'fly';
    if (this.perch) { this.perch.taken = null; this.perch = null; }
  }

  update(dt, t, ctx) {
    const k = this.kit;
    if (this.state === 'perch') {
      this.fold = damp(this.fold, 1, 6, dt);
      this.flapAmt = damp(this.flapAmt, 0, 8, dt);
      this.timer -= dt;
      // idle motions: weight shifts, an occasional wing stretch
      this.headBob = Math.sin(t * 0.7 + this.flapT) * 0.04 + (Math.sin(t * 2.3 + this.flapT * 3) > 0.97 ? 0.08 : 0);
      if (this.carry) {
        this.biteT -= dt;
        this.headBob += Math.sin(t * 9) * 0.04;
        if (this.biteT <= 0) {
          this.biteT = 1.6 + this.rng.next();
          ctx.bite(this, this.carry);
          if (this.carry.dead) this.carry = null;
        }
      } else {
        this.foodT = (this.foodT ?? 1) - dt;
        if (this.foodT <= 0) { this.foodT = 1.2; if (ctx.wantsFood(this)) this.timer = 0; }
        if (this.timer <= 0) ctx.decide(this);
      }
      if (this.perch) this.pos.copy(this.perch.pos);
    } else if (this.state === 'fly') {
      const P = this.path;
      P.t += dt / P.dur;
      const tt = clamp(P.t, 0, 1);
      // ease: slow takeoff and landing
      const e = tt * tt * (3 - 2 * tt) * 0.6 + tt * 0.4;
      bezier(_v, P.p0, P.p1, P.p2, P.p3, e);
      this.vel.subVectors(_v, this.pos).divideScalar(Math.max(dt, 1e-3));
      this.pos.copy(_v);
      this.fold = damp(this.fold, 0, 10, dt);
      const climbing = this.vel.y > 0.2;
      const landing = P.land && tt > 0.82;
      const takeoff = tt < 0.15;
      const glide = !climbing && !landing && !takeoff && Math.sin(t * 0.8 + this.flapT) > 0.1;
      this.flapAmt = damp(this.flapAmt, glide ? 0.12 : 1, 4, dt);
      this.flapRate = landing ? 1.6 : (takeoff ? 1.5 : 1.15);
      if (P.t >= 1) {
        if (P.arrive) P.arrive(this);
        else this.state = 'perch';
      }
    } else if (this.state === 'grab') {
      // flapping hop at the fruit
      this.timer -= dt;
      this.flapAmt = damp(this.flapAmt, 0.6, 6, dt);
      this.flapRate = 1.4;
      this.fold = damp(this.fold, 0.2, 6, dt);
      this.vel.set(0, 0, 0);
      if (this.timer <= 0) ctx.afterGrab(this);
    }
    // flap clip
    this.flapT = (this.flapT + dt * this.flapRate * (0.6 + this.flapAmt * 0.6)) % k.duration;
    const w = k.interp.evaluate(this.flapT);
    const infl = this.mesh.morphTargetInfluences;
    for (let i = 0; i < k.nT; i++) infl[i] = w[i] * this.flapAmt;
    infl[k.foldIndex] = this.fold;
    // orientation
    if (this.state === 'fly' || (this.state === 'grab')) {
      const sp = this.vel.length();
      if (sp > 0.05) {
        _v.copy(this.vel).normalize();
        const yaw = Math.atan2(_v.x, _v.z);
        const pitch = Math.asin(clamp(-_v.y, -0.8, 0.8));
        const prevYaw = this.yaw ?? yaw;
        let dy = yaw - prevYaw; if (dy > Math.PI) dy -= TAU; if (dy < -Math.PI) dy += TAU;
        this.yaw = yaw;
        this.bank = damp(this.bank, clamp(-dy / Math.max(dt, 1e-3) * 0.35, -0.9, 0.9), 4, dt);
        const landing = this.path && this.path.land && this.path.t > 0.8;
        this.pitch = damp(this.pitch ?? 0, landing ? -0.7 : pitch * 0.8, 5, dt);
      }
      _q.setFromEuler(_e.set(this.pitch ?? 0, this.yaw ?? 0, this.bank, 'YXZ'));
      this.quat.slerp(_q, 1 - Math.exp(-10 * dt));
    } else {
      // perched upright, facing outward
      this.yaw = damp(this.yaw ?? this.faceYaw, this.faceYaw + Math.sin(t * 0.23 + this.flapT) * 0.35, 2, dt);
      this.bank = damp(this.bank, 0, 4, dt);
      _q.setFromEuler(_e.set(-0.95 + this.headBob, this.yaw, 0, 'YXZ'));
      this.quat.slerp(_q, 1 - Math.exp(-6 * dt));
    }
    const s = this.scale * this.size;
    this.mesh.position.copy(this.pos);
    // perched: lift so the feet (belly) sit on the branch
    if (this.state === 'perch') this.mesh.position.y += 0.18 * this.size;
    this.mesh.quaternion.copy(this.quat);
    this.mesh.scale.setScalar(s);
    this.mesh.updateMatrixWorld();
  }
}
