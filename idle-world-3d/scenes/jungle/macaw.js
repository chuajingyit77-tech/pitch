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

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0), _x = new THREE.Vector3(1, 0, 0), _z = new THREE.Vector3(0, 0, 1), _e = new THREE.Euler();
const angleTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

function bezier(out, p0, p1, p2, p3, t) {
  const u = 1 - t;
  return out.set(0, 0, 0)
    .addScaledVector(p0, u * u * u).addScaledVector(p1, 3 * u * u * t)
    .addScaledVector(p2, 3 * u * t * t).addScaledVector(p3, t * t * t);
}
function bezierD(out, p0, p1, p2, p3, t) {
  const u = 1 - t;
  return out.set(0, 0, 0)
    .addScaledVector(p1, 3 * u * u).addScaledVector(p0, -3 * u * u)
    .addScaledVector(p2, 6 * u * t).addScaledVector(p1, -6 * u * t)
    .addScaledVector(p3, 3 * t * t).addScaledVector(p2, -3 * t * t);
}
/** Cubic ease from 0 to 1 with start slope s0 and end slope s1 (monotonic for slopes in [0, 3]). */
const hermite = (t, s0, s1) => ((s0 + s1 - 2) * t + (3 - 2 * s0 - s1)) * t * t + s0 * t;
const hermiteD = (t, s0, s1) => (3 * (s0 + s1 - 2) * t + 2 * (3 - 2 * s0 - s1)) * t + s0;
/** Position and velocity on a flight path at its current time. The velocity is the path's own derivative: a
 * finite difference read low on the frame a path ended part-way through a step, so the next leg started slow. */
function samplePath(P, pos, vel) {
  const tt = clamp(P.t, 0, 1), e = hermite(tt, P.s0, P.s1);
  bezier(pos, P.p0, P.p1, P.p2, P.p3, e);
  bezierD(vel, P.p0, P.p1, P.p2, P.p3, e).multiplyScalar(hermiteD(tt, P.s0, P.s1) / P.dur);
}
/** Rotate q toward target: exponential (lambda) but at most maxRate rad/s, so a big change of attitude is a
 * smooth turn at any frame rate (a plain slerp turned twice as far per frame at 30 fps and snapped). */
function turnQuat(q, target, lambda, maxRate, dt) {
  const ang = q.angleTo(target);
  if (ang < 1e-6) return q;
  return q.rotateTowards(target, Math.min(ang * (1 - Math.exp(-lambda * dt)), maxRate * dt));
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
    this.ph = rng.next() * TAU; // this bird's own phase for idle sway, wing stretches and glides
    this.flapRate = 1; this.flapAmt = 0; this.fold = 1;
    this.state = 'perch';
    this.timer = rng.range(2, 8);
    this.perch = null;
    this.path = null;
    this.bank = 0;
    this.yaw = 0; this.pitch = 0; this.velYaw = 0;
    this.carry = null; // fruit being carried / eaten
    this.biteT = 0;
    this.lookYaw = 0;
    this.headBob = 0;
    this.stretch = 0;
    this.hoverAt = new THREE.Vector3();
    this.hoverT = 0;
    this.scale = 0.0098;
  }
  get size() { return 0.85 + 0.15 * (this.member ? this.member.size : 1); }
  /** Beak position in world space. */
  beak(out) { return out.set(0, 3, 27).applyMatrix4(this.mesh.matrixWorld); }
  /** Where the body sits on a perch: lifted so the feet (belly) rest on the branch. Flights end exactly here
   * (the lift used to be added only once perched: an 18 cm hop at every landing and take-off). */
  perchPoint(perch, out) { return out.copy(perch.pos).add(_v3.set(0, 0.18 * this.size, 0)); }

  placeAt(perch, instant = false) {
    this.perch = perch; perch.taken = this;
    this.perchPoint(perch, this.pos);
    this.vel.set(0, 0, 0);
    this.state = 'perch';
    this.timer = this.rng.range(7, 18);
    // wings fold after touch-down (perch state eases them); only a bird placed at build time starts folded
    if (instant) { this.fold = 1; this.flapAmt = 0; }
    this.faceYaw = Math.atan2(perch.face.x, perch.face.z);
    if (instant) { this.yaw = this.faceYaw; this.quat.setFromEuler(_e.set(-0.95, this.yaw, 0, 'YXZ')); }
  }

  /** Hover in place (flapping) for a while, e.g. to pick up a fruit; ctx.afterGrab is called when done. */
  hover(seconds) {
    this.state = 'grab';
    this.timer = seconds;
    this.hoverAt.copy(this.pos);
    this.hoverT = 0;
    this.vel.set(0, 0, 0);
  }

  flyTo(target, { land = true, arrive = null, speed = 5.2, dip = 1.2, flare = -0.7, follow = null } = {}) {
    const p0 = this.pos.clone();
    const p3 = target.clone();
    const dir = _v.subVectors(p3, p0);
    const dist = Math.max(dir.length(), 1e-3);
    dir.divideScalar(dist);
    const flying = this.state === 'fly' && this.vel.lengthSq() > 0.04;
    const fwd = flying ? this.vel.clone().normalize() : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(this.rng.range(-0.25, 0.25) * dist);
    const reach = Math.min(3, dist * 0.3);
    const p1 = p0.clone().addScaledVector(fwd, reach);
    // from a perch (or a hover) it drops off / climbs away; already in the air it carries straight on, so the
    // path has no corner where two flights join
    if (!flying) p1.add(_v2.set(0, -dip, 0)).add(side);
    const p2 = p3.clone().addScaledVector(dir, -Math.min(3.5, dist * 0.35)).add(_v2.set(0, land ? 1.4 : 0, 0)).add(side.multiplyScalar(0.5));
    const len = dist * 1.25 + 2;
    const dur = len / speed;
    // speed profile: from rest it eases off the perch, in the air it keeps its current speed, and a landing
    // brakes to a slow touch-down (it used to start and stop at 40 % of cruise speed in one frame)
    const s0 = flying ? clamp(this.vel.length() * dur / (3 * reach), 0.2, 2.5) : 0.15;
    const s1 = land ? 0.15 : 1;
    this.path = { p0, p1, p2, p3, t: 0, dur, land, arrive, s0, s1, cruise: len / dur, flare, fresh: true, follow };
    this.state = 'fly';
    if (this.perch) { this.perch.taken = null; this.perch = null; }
  }

  update(dt, t, ctx) {
    const k = this.kit;
    if (this.state === 'perch') {
      // idle motions: weight shifts, an occasional wing stretch (eased in and out). These were keyed to the flap
      // clock, which keeps running and wraps every 1.2 s, so the head and body jerked instead of swaying, and the
      // "stretch" was a 0.08 rad nod switched on and off every 1.4 s.
      this.stretch = this.carry ? 0 : smoothstep(0.93, 0.99, Math.sin(t * 0.43 + this.ph * 3));
      this.headBob = Math.sin(t * 0.7 + this.ph) * 0.04 + this.stretch * 0.08;
      this.fold = damp(this.fold, 1 - this.stretch * 0.4, 6, dt);
      this.flapAmt = damp(this.flapAmt, 0, 8, dt);
      this.flapRate = damp(this.flapRate, 1, 3, dt);
      this.timer -= dt;
      if (this.carry) {
        this.biteT -= dt;
        this.headBob += Math.sin(t * 9 + this.ph) * 0.04;
        if (this.biteT <= 0) {
          this.biteT = 1.6 + this.rng.next();
          ctx.bite(this, this.carry);
          if (this.carry.dead || this.carry.bites <= 0) this.carry = null;
        }
      } else {
        this.foodT = (this.foodT ?? 1) - dt;
        if (this.foodT <= 0) { this.foodT = 1.2; if (ctx.wantsFood(this)) this.timer = 0; }
        if (this.timer <= 0) ctx.decide(this);
      }
      if (this.state === 'perch' && this.perch) this.perchPoint(this.perch, this.pos);
    } else if (this.state === 'fly') {
      const P = this.path;
      P.t += dt / P.dur;
      const tt = clamp(P.t, 0, 1);
      // heading for something that drifts (a floating fruit): the end of the path moves with it, so the bird
      // arrives over it instead of where it was at take-off
      const F = P.follow;
      if (F && !F.dead && !F.heldBy) {
        const dx = F.pos.x - P.p3.x, dz = F.pos.z - P.p3.z;
        P.p3.x += dx; P.p3.z += dz; P.p2.x += dx; P.p2.z += dz;
      }
      samplePath(P, this.pos, this.vel);
      this.fold = damp(this.fold, 0, 10, dt);
      // wingbeat follows airspeed: hard and fast while slow (leaving the perch, braking to land), slower at
      // cruise, with glides (rhythm from the bird's own phase: it used to come from the wrapping flap clock)
      const spr = this.vel.length() / P.cruise;
      const climbing = this.vel.y > 0.2;
      const landing = P.land && tt > 0.82;
      const glide = !climbing && !landing && tt > 0.15 && spr > 0.8 && Math.sin(t * 0.8 + this.ph) > 0.1;
      this.flapAmt = damp(this.flapAmt, glide ? 0.12 : 1, 4, dt);
      this.flapRate = damp(this.flapRate, lerp(1.7, 1.1, smoothstep(0.3, 0.9, spr)), 4, dt);
      if (P.t >= 1) {
        const over = (P.t - 1) * P.dur; // the part of this step past the end of the path
        if (P.arrive) P.arrive(this);
        else this.state = 'perch';
        // flying straight on into a new leg: spend the rest of the step on it (no one-frame hitch at the join)
        if (this.state === 'fly' && this.path !== P && over > 0) { this.path.t = Math.min(over / this.path.dur, 1); samplePath(this.path, this.pos, this.vel); }
      }
    } else if (this.state === 'grab') {
      // hovering at the fruit: quick wingbeats, the body bobbing gently with them
      this.timer -= dt;
      this.hoverT += dt;
      this.flapAmt = damp(this.flapAmt, 0.85, 6, dt);
      this.flapRate = damp(this.flapRate, 1.8, 4, dt);
      this.fold = damp(this.fold, 0.15, 6, dt);
      _v.copy(this.hoverAt);
      _v.y += Math.sin(this.hoverT * 5.5) * 0.035 * smoothstep(0, 0.3, this.hoverT);
      this.vel.subVectors(_v, this.pos).divideScalar(Math.max(dt, 1e-3));
      this.pos.copy(_v);
      if (this.timer <= 0) ctx.afterGrab(this);
    }
    // flap clip
    this.flapT = (this.flapT + dt * this.flapRate * (0.6 + this.flapAmt * 0.6)) % k.duration;
    const w = k.interp.evaluate(this.flapT);
    const infl = this.mesh.morphTargetInfluences;
    for (let i = 0; i < k.nT; i++) infl[i] = w[i] * this.flapAmt;
    infl[k.foldIndex] = this.fold;
    // orientation
    if (this.state === 'fly') {
      const P = this.path;
      const sp = this.vel.length();
      if (sp > 0.05) {
        _v.copy(this.vel).divideScalar(sp);
        const yaw = Math.atan2(_v.x, _v.z);
        const pitch = Math.asin(clamp(-_v.y, -0.8, 0.8));
        if (P.fresh) { P.fresh = false; this.velYaw = yaw; } // no bank kick from the perched heading
        const dy = angleTo(this.velYaw, yaw);
        this.velYaw = yaw;
        this.yaw = yaw;
        this.bank = damp(this.bank, clamp(-dy / Math.max(dt, 1e-3) * 0.35, -0.9, 0.9), 4, dt);
        const landing = P.land && P.t > 0.8;
        this.pitch = damp(this.pitch, landing ? P.flare : pitch * 0.8, 5, dt);
      }
      _q.setFromEuler(_e.set(this.pitch, this.yaw, this.bank, 'YXZ'));
      turnQuat(this.quat, _q, 10, 5, dt);
    } else if (this.state === 'grab') {
      // keep the heading, ease from the landing flare into an upright hover (a steep flare dips the tail into
      // the ground or the water)
      this.pitch = damp(this.pitch, -0.35, 4, dt);
      this.bank = damp(this.bank, 0, 4, dt);
      _q.setFromEuler(_e.set(this.pitch, this.yaw, this.bank, 'YXZ'));
      turnQuat(this.quat, _q, 8, 4, dt);
    } else {
      // perched upright, facing outward
      this.yaw = damp(this.yaw, this.faceYaw + Math.sin(t * 0.23 + this.ph) * 0.35, 2, dt);
      this.bank = damp(this.bank, 0, 4, dt);
      this.pitch = damp(this.pitch, -0.95, 4, dt);
      _q.setFromEuler(_e.set(-0.95 + this.headBob, this.yaw, 0, 'YXZ'));
      turnQuat(this.quat, _q, 6, 4, dt);
    }
    const s = this.scale * this.size;
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.quat);
    this.mesh.scale.setScalar(s);
    this.mesh.updateMatrixWorld();
  }
}
