// Small pond life: a school of medaka (the heron's prey; they nibble at food and scatter from koi and the heron),
// dragonflies that hover, dart and perch by day, and frogs on the lily pads that breathe, croak at dusk and night, and
// plop into the water when the heron lands (climbing back once it has gone). All instanced (one draw call each),
// built up front, integrated with dt, every turn rate-limited and every move eased, so nothing snaps or slides.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, damp, makeCanvas, patchMaterial, quatFromForward } from '../../lib/util.js';
import { buildFishGeometry, applySwim, FishInstances, Swimmer } from '../../lib/fish.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const WATER_Y = 0;

/* ================================================================== */
/* Medaka                                                               */
/* ================================================================== */
// slim, big-eyed, upturned mouth, dorsal fin set far back, long anal fin, square tail
const MEDAKA_SHAPE = {
  tailLen: 0.22, height: 0.21, hPos: 0.42, width: 0.14, wPos: 0.38, noseQ: 0.55, noseQw: 0.6, pinch: 0.34, pinchW: 0.35, arch: -0.03, mouthY: 0.06,
  caudal: { type: 'truncate', L: 0.19, S: 0.1 },
  dorsal: { d0: 0.64, d1: 0.78, h: 0.06, profile: [0, 1, 0.7, 0.1], sweep: 0.3 },
  anal: { d0: 0.46, d1: 0.82, h: 0.065, profile: [0, 1, 0.9, 0.8, 0.2], sweep: 0.3 },
  pectoral: { s: 0.22, L: 0.09, W: 0.05, spread: 0.7, droop: 0.3, y: 0.05 },
  pelvic: { s: 0.46, L: 0.05, W: 0.025 },
  eye: { s: 0.1, r: 0.038, y: 0.13 },
  scales: { along: 30, around: 20, curve: 0.9 },
};
/** atlas in lib/fish.js's layout: body u < 0.72 (v round the body: 0 belly .. 0.5 back), fins in the right column */
function medakaAtlas() {
  const W = 128, H = 64, c = makeCanvas(W, H), g = c.getContext('2d'), img = g.createImageData(W, H), px = img.data;
  const hexc = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const back = hexc('#6f6236'), side = hexc('#c2b27a'), belly = hexc('#e6e2d4'), line = hexc('#4c4a3c');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x + 0.5) / W, v = 1 - (y + 0.5) / H, o = (y * W + x) * 4;
    let col = [150, 150, 150], a = 0;
    if (u < 0.72) {
      const s = u / 0.72, q = v < 0.5 ? v * 2 : (1 - v) * 2; // 0 belly .. 1 back
      const k1 = smoothstep(0.25, 0.55, q), k2 = smoothstep(0.62, 0.85, q);
      col = [0, 1, 2].map(i => lerp(lerp(belly[i], side[i], k1), back[i], k2));
      // a dark lateral line and a faint dark back stripe toward the tail
      const ln = (1 - smoothstep(0.0, 0.05, Math.abs(q - 0.55))) * smoothstep(0.25, 0.45, s);
      col = col.map((cc, i) => lerp(cc, line[i], ln * 0.55));
      a = 255;
    } else if (v > 0.9 && u > 0.88) {
      const d = Math.hypot((u - 0.93) / 0.05, (v - 0.95) / 0.05);
      col = d < 0.45 ? [10, 10, 10] : d < 0.9 ? [200, 205, 205] : [60, 60, 60]; a = 255; // big silvery eyes
    } else { col = [214, 206, 178]; a = 150; } // pale fins
    px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = a;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export class Medaka {
  constructor(pond, rng) {
    this.pond = pond; this.rng = rng;
    const n = Math.round(lerp(20, 34, pond.q));
    this.geo = buildFishGeometry(MEDAKA_SHAPE, { detail: 0.3 });
    this.tex = medakaAtlas();
    this.mat = new THREE.MeshStandardMaterial({ map: this.tex, alphaTest: 0.45, roughness: 0.42, metalness: 0.15, side: THREE.DoubleSide });
    applySwim(this.mat, { waveK: 6.5, key: 'medaka' });
    this.inst = new FishInstances(this.geo, this.mat, n);
    this.inst.mesh.name = 'medaka';
    pond.scene.add(this.inst.mesh);
    this.fish = [];
    this.center = new THREE.Vector3(); this.goal = new THREE.Vector3(); this.cvel = new THREE.Vector3();
    pond.randomInPond(rng, 0.9, this.center);
    this.shallow(this.center);
    this.goal.copy(this.center);
    this.goalT = 0;
    for (let i = 0; i < n; i++) {
      const p = this.center.clone().add(_a.set(rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3)));
      p.y = WATER_Y - rng.range(0.04, 0.1);
      const size = rng.range(0.038, 0.05);
      const sw = new Swimmer({ pos: p, size, speed: 0.08, rng, maxPitch: 0.3, agility: 3.2, beat: 1.5 });
      this.fish.push({ sw, size, slot: new THREE.Vector3(rng.range(-0.35, 0.35), rng.range(-0.03, 0.03), rng.range(-0.35, 0.35)), wan: rng.range(0, TAU), flee: new THREE.Vector3(), scare: 0, alive: true, vis: 1, caught: false, gulp: false, respawn: 0, food: null, pos: sw.pos });
    }
    this.desired = new THREE.Vector3();
  }
  /** move a point to the shallows near it (medaka keep to the edges, near the surface) */
  shallow(p) {
    const P = this.pond;
    for (let k = 0; k < 10; k++) { const d = P.sdf(p.x, p.z); if (d > -0.35) { P.sdfGrad(p.x, p.z, _b); p.x -= _b.x * (d + 0.5) * 0.6; p.z -= _b.z * (d + 0.5) * 0.6; } else if (d < -1.4) { P.sdfGrad(p.x, p.z, _b); p.x -= _b.x * (d + 1.0) * 0.6; p.z -= _b.z * (d + 1.0) * 0.6; } }
    P.pushOutOfObstacles(p, 0.25);
    return p;
  }
  pickGoal() {
    const P = this.pond, r = this.rng, H = P.heron;
    if (H && H.present && H.state === 'stay' && H.stayT > 4 && r.chance(0.7)) {
      // a heron standing still is part of the scenery: the school drifts into the shallows in front of it
      const yaw = H.yaw.x;
      this.goal.set(H.center.x + Math.sin(yaw) * r.range(0.35, 0.9) + r.range(-0.4, 0.4), 0, H.center.z + Math.cos(yaw) * r.range(0.35, 0.9) + r.range(-0.4, 0.4));
    } else {
      for (let i = 0; i < 8; i++) {
        P.randomInPond(r, 0.4, this.goal);
        if (this.goal.distanceTo(this.center) < 4.5) break;
      }
    }
    this.shallow(this.goal);
    // time to get there at the school's pace, then a while to linger
    this.goalT = clamp(this.center.distanceTo(this.goal) / 0.16, 0, 45) + r.range(5, 12);
  }
  update(dt, time, sclock) {
    const P = this.pond, night = P.sunState ? P.sunState.night : 0, H = P.heron;
    this.goalT -= dt;
    if (this.goalT <= 0 || this.center.distanceTo(this.goal) < 0.3) this.pickGoal();
    // the school drifts (slowly, slower at night)
    _a.subVectors(this.goal, this.center).setY(0);
    const gl = _a.length();
    const sp = 0.16 * (1 - night * 0.55);
    _a.multiplyScalar(gl > 1e-3 ? Math.min(sp, gl * 0.4) / gl : 0);
    this.cvel.lerp(_a, 1 - Math.exp(-0.8 * dt));
    this.center.addScaledVector(this.cvel, dt);
    const depth = lerp(0.05, 0.11, night);
    const D = this.desired;
    // the heron's bill, once per frame
    const bill = this.bill || (this.bill = new THREE.Vector3());
    const heronHere = H && H.obj.visible && H.state === 'stay';
    if (heronHere) H.billTip(bill);
    for (const f of this.fish) {
      const sw = f.sw;
      if (f.caught) {
        // held in the heron's bill (posed in render()); once swallowed it fades out there
        if (!f.alive) { f.vis = Math.max(0, f.vis - dt * 4); if (f.vis <= 0) f.caught = false; }
        continue;
      }
      // a swallowed minnow's slot swims back to the school unseen and, a while later, fades in as a newcomer
      // (its track never jumps)
      if (!f.alive) { f.respawn -= dt; if (f.respawn <= 0) { f.alive = true; f.flee.set(0, 0, 0); } }
      f.vis = f.alive ? Math.min(1, f.vis + dt * 0.7) : 0;
      // place in the school, with a slow individual wander
      f.wan += dt * (0.3 + 0.2 * Math.sin(f.wan * 0.7));
      _b.copy(this.center).add(f.slot).add(_c.set(Math.sin(f.wan) * 0.12, 0, Math.cos(f.wan * 1.3) * 0.12));
      _b.y = WATER_Y - depth + f.slot.y;
      sw.seek(_b, sp * 1.4 + 0.03, 0.25, D);
      // food: nibble at pellets close by (and dart off when a koi arrives)
      let food = null, fd = 1.0;
      for (const p of P.foods) { const d = Math.hypot(p.pos.x - sw.pos.x, p.pos.z - sw.pos.z); if (d < fd) { fd = d; food = p; } }
      if (food) { _c.set(food.pos.x - sw.pos.x, WATER_Y - 0.03 - sw.pos.y, food.pos.z - sw.pos.z); const l = _c.length() || 1; D.lerp(_c.multiplyScalar(0.16 / l), 0.75); }
      // flee: koi nearby (fast ones most), the heron's bill and feet, fresh splashes
      f.flee.multiplyScalar(Math.exp(-2.2 * dt));
      for (const k of P.koi) {
        const dx = sw.pos.x - k.sw.pos.x, dz = sw.pos.z - k.sw.pos.z, d = Math.hypot(dx, dz);
        const kv = Math.hypot(k.sw.vel.x, k.sw.vel.z), R = 0.25 + kv * 0.9 + 0.2 * k.scale;
        if (d < R && d > 1e-4 && Math.abs(sw.pos.y - k.sw.pos.y) < 0.35) { const w = (1 - d / R) * (0.5 + kv * 2); f.flee.x += dx / d * w * dt * 6; f.flee.z += dz / d * w * dt * 6; }
      }
      if (heronHere) {
        const dx = sw.pos.x - bill.x, dz = sw.pos.z - bill.z, d = Math.hypot(dx, dz);
        if (d < 0.32 && bill.y < 0.25 && d > 1e-4) { f.flee.x += dx / d * dt * 4; f.flee.z += dz / d * dt * 4; }
        for (const ft of H.feet) if (!ft.planted) {
          const ex = sw.pos.x - ft.pos.x, ez = sw.pos.z - ft.pos.z, e = Math.hypot(ex, ez);
          if (e < 0.4 && e > 1e-4) { f.flee.x += ex / e * dt * 3; f.flee.z += ez / e * dt * 3; }
        }
      }
      const fl = Math.hypot(f.flee.x, f.flee.z);
      if (fl > 0.6) f.flee.multiplyScalar(0.6 / fl);
      D.x += f.flee.x; D.z += f.flee.z;
      // stay in the water, off the floor and under the surface, out of rocks
      const e = P.sdf(sw.pos.x, sw.pos.z);
      if (e > -0.14) { P.sdfGrad(sw.pos.x, sw.pos.z, _c); D.addScaledVector(_c, -(e + 0.14) * 3); }
      const floor = P.height(sw.pos.x, sw.pos.z, e) + 0.03;
      if (sw.pos.y < floor) D.y += (floor - sw.pos.y) * 3;
      if (sw.pos.y > WATER_Y - 0.02) D.y -= (sw.pos.y - WATER_Y + 0.02) * 4;
      const vmax = 0.22 + Math.min(fl, 0.6);
      const dl = D.length();
      if (dl > vmax) D.multiplyScalar(vmax / dl);
      D.y = clamp(D.y, -0.08, 0.08);
      sw.steer(D, dt, 3 + fl * 4).integrate(dt);
      P.pushOutOfObstacles(sw.pos, 0.03);
      if (sw.pos.y < floor - 0.01) sw.pos.y = floor - 0.01;
    }
  }
  /** heron hooks */
  findPrey(spot, fx, fz) {
    const H = this.pond.heron;
    let best = null, bd = Infinity;
    for (const f of this.fish) {
      if (!f.alive || f.caught || f.vis < 0.9) continue;
      const dx = f.sw.pos.x - H.center.x, dz = f.sw.pos.z - H.center.z, d = Math.hypot(dx, dz);
      if (d < 0.22 || d > 0.55 || f.sw.pos.y < WATER_Y - 0.14) continue;
      if ((dx * fx + dz * fz) / d < 0.55) continue;
      if (d < bd) { bd = d; best = f; }
    }
    return best;
  }
  near(H) {
    for (const f of this.fish) if (f.alive && Math.hypot(f.sw.pos.x - H.center.x, f.sw.pos.z - H.center.z) < 1.6) return true;
    return false;
  }
  catchPrey(f) { f.caught = true; f.held = 0; return f; }
  swallow(f) { f.alive = false; f.respawn = this.rng.range(30, 60); }
  scatter(p) {
    for (const f of this.fish) {
      const dx = f.sw.pos.x - p.x, dz = f.sw.pos.z - p.z, d = Math.hypot(dx, dz);
      if (d < 1.1 && d > 1e-4) { const w = (1 - d / 1.1) * 0.9; f.flee.x += dx / d * w; f.flee.z += dz / d * w; }
    }
  }
  render(dt, sclock) {
    const I = this.inst, H = this.pond.heron;
    I.begin();
    for (const f of this.fish) {
      if (f.caught && H) {
        // crosswise in the heron's bill, wriggling
        f.held += dt;
        H.billTip(f.sw.pos);
        f.sw.pos.y -= 0.004;
        _a.set(Math.cos(H.yaw.x), 0, -Math.sin(H.yaw.x));
        quatFromForward(f.sw.quat, _a, 0);
        f.sw.phase = (f.sw.phase + dt * 26) % TAU; f.sw.amp = 0.11; f.sw.turn = Math.sin(f.held * 9) * 0.15;
      }
      // every fish keeps its own instance slot (a hidden one is drawn at zero size), so no slot changes hands
      const s0 = f.sw.size;
      f.sw.size = s0 * Math.max(f.vis, 0.0001);
      I.push(f.sw);
      f.sw.size = s0;
    }
    I.end(sclock);
  }
  dispose() { this.geo.dispose(); this.tex.dispose(); this.inst.geometry.dispose(); this.mat.dispose(); }
}

/* ================================================================== */
/* Dragonflies                                                          */
/* ================================================================== */
function dragonflyGeometry() {
  const pos = [], nor = [], part = [], uu = [], idx = [];
  const add = (p, n, k, u = 0) => { pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); part.push(k); uu.push(u); return pos.length / 3 - 1; };
  const ellipsoid = (c, r, nu, nv, k) => {
    const base = pos.length / 3;
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const th = (i / nu) * Math.PI, ph = (j / nv) * TAU;
      const n = new THREE.Vector3(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      add(new THREE.Vector3(c.x + n.x * r.x, c.y + n.y * r.y, c.z + n.z * r.z), new THREE.Vector3(n.x / r.x, n.y / r.y, n.z / r.z).normalize(), k);
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = base + i * (nv + 1) + j, b = a + nv + 1; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  };
  // abdomen (a tapered tube toward the tail, slightly arched), thorax, head with the big compound eyes
  {
    const nu = 10, nv = 6, base = pos.length / 3;
    for (let i = 0; i <= nu; i++) {
      const t = i / nu, z = lerp(-0.004, -0.044, t), y = 0.0015 + 0.002 * Math.sin(t * Math.PI) - 0.0015 * t, r = lerp(0.0024, 0.0013, t) * (1 + 0.15 * Math.sin(t * 30));
      for (let j = 0; j <= nv; j++) { const ph = (j / nv) * TAU; add(new THREE.Vector3(Math.cos(ph) * r, y + Math.sin(ph) * r, z), new THREE.Vector3(Math.cos(ph), Math.sin(ph), 0), 2, t); }
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = base + i * (nv + 1) + j, b = a + nv + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  }
  ellipsoid(new THREE.Vector3(0, 0.0015, 0.002), new THREE.Vector3(0.0034, 0.004, 0.0058), 6, 8, 1);
  ellipsoid(new THREE.Vector3(0.0021, 0.0028, 0.0093), new THREE.Vector3(0.0028, 0.0028, 0.0028), 5, 8, 0.5);
  ellipsoid(new THREE.Vector3(-0.0021, 0.0028, 0.0093), new THREE.Vector3(0.0028, 0.0028, 0.0028), 5, 8, 0.5);
  // four wings, flat at rest: elongated ellipses from the thorax (part = -1 left, -2 right... encoded below)
  const wing = (s, z0, span, chord, sweep) => {
    const n = 12, c = add(new THREE.Vector3(s * 0.0022, 0.004, z0), new THREE.Vector3(0, 1, 0), -1, 0);
    const first = pos.length / 3;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * TAU;
      const u = 0.5 - 0.5 * Math.cos(a), w = Math.sin(a) * chord * 0.5 * (1 - 0.4 * u);
      add(new THREE.Vector3(s * (0.0022 + u * span), 0.004 + u * 0.0012, z0 - u * sweep + w), new THREE.Vector3(0, 1, 0), -1, u);
    }
    for (let k = 0; k < n; k++) { if (s > 0) idx.push(c, first + k + 1, first + k); else idx.push(c, first + k, first + k + 1); }
  };
  for (const s of [1, -1]) { wing(s, 0.004, 0.031, 0.0078, 0.004); wing(s, -0.0015, 0.03, 0.0095, 0.006); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(uu, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class Dragonflies {
  constructor(pond, rng) {
    this.pond = pond; this.rng = rng;
    const n = Math.round(lerp(3, 6, pond.q));
    this.geo = dragonflyGeometry();
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.fly = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); this.fly.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aTint', this.tint); this.geo.setAttribute('aFly', this.fly);
    // one pass (three draws transparent double-sided materials twice, back faces first); the wings are flat and
    // the body writes depth, so a single pass sorts itself out
    this.mat = new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.1, transparent: true, depthWrite: true, side: THREE.DoubleSide, forceSinglePass: true });
    patchMaterial(this.mat, {
      key: 'koiDragonfly',
      vertexHeader: 'attribute float aPart; attribute float aU; attribute vec3 aTint; attribute float aFly; varying float vPart; varying float vU; varying vec3 vTint; varying float vFly;',
      fragmentHeader: 'varying float vPart; varying float vU; varying vec3 vTint; varying float vFly;',
      vertex: { '#include <begin_vertex>': '$&\n vPart = aPart; vU = aU; vTint = aTint; vFly = aFly;' },
      fragment: {
        '#include <color_fragment>': /* glsl */`$&
          if (vPart < -0.5) {
            // wings: clear membrane, faint amber at the base, a dark pterostigma near the tip; a soft blur in flight
            float u = vU;
            vec3 wc = mix(vec3(0.95, 0.82, 0.55), vec3(0.92, 0.95, 0.98), smoothstep(0.0, 0.3, u));
            wc = mix(wc, vec3(0.15, 0.1, 0.08), smoothstep(0.84, 0.88, u) * (1.0 - smoothstep(0.93, 0.97, u)));
            diffuseColor = vec4(wc, mix(0.42, 0.16, vFly));
          } else if (vPart >= 2.0) {
            // abdomen: the tint, darker segment rings and a dark tip
            float t = vU;
            vec3 c = vTint * (0.85 + 0.15 * step(0.5, fract(t * 8.0)));
            c = mix(c, vec3(0.06), smoothstep(0.8, 0.95, t) * 0.8);
            diffuseColor = vec4(c, 1.0);
          } else {
            diffuseColor = vec4(mix(vec3(0.05, 0.05, 0.05), vTint * 0.6, vPart), 1.0); // dark eyes, tinted thorax
          }`,
      },
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'dragonflies';
    pond.scene.add(this.mesh);
    this.perches = this.findPerches();
    this.flies = [];
    const red = new THREE.Color('#c8321c'), blue = new THREE.Color('#7e95b5');
    for (let i = 0; i < n; i++) {
      const c = i % 3 === 2 ? blue : red;
      this.tint.setXYZ(i, c.r, c.g, c.b);
      const pc = this.perches[i % this.perches.length];
      const p = this.perchPos(pc, new THREE.Vector3());
      this.flies.push({ pos: p.clone(), vel: new THREE.Vector3(), goal: p.clone(), yaw: rng.range(0, TAU), yawGoal: 0, state: 'perch', t: rng.range(2, 9), perch: pc, hops: 0, flyK: 0, ph: rng.range(0, TAU), size: rng.range(0.95, 1.1) });
    }
    this.tint.needsUpdate = true;
  }
  findPerches() {
    const P = this.pond, out = [];
    for (const p of P.pads) out.push({ kind: 'pad', pad: p, off: new THREE.Vector3(this.rng.range(-0.08, 0.08), 0, this.rng.range(-0.08, 0.08)) });
    for (const s of P.stones) if (s.s > 0.3 && P.sdf(s.x, s.z) < 0.4) {
      const top = P.rockTop ? P.rockTop(s.x, s.z) : null;
      if (top) out.push({ kind: 'rock', pos: top.clone().add(new THREE.Vector3(0, 0.004, 0)) });
    }
    if (P.railTops) for (const p of P.railTops) out.push({ kind: 'rail', pos: p.clone() });
    if (!out.length) out.push({ kind: 'rock', pos: new THREE.Vector3(P.viewTarget.x, 0.3, P.viewTarget.z) });
    return out;
  }
  perchPos(pc, out) {
    if (pc.kind === 'pad') {
      const R = pc.pad.mesh.geometry.parameters.radius, r2 = (pc.off.x * pc.off.x + pc.off.z * pc.off.z) / (R * R);
      return out.copy(pc.pad.mesh.position).add(pc.off).setY(pc.pad.mesh.position.y + 0.0045 + 0.018 * r2);
    }
    return out.copy(pc.pos);
  }
  update(dt, time) {
    const P = this.pond, r = this.rng, S = P.sunState;
    // on the wing from mid-morning until late afternoon; they rest at dawn, dusk and night
    const active = S ? S.day * (1 - S.golden * 0.85) : 1;
    const H = P.heron;
    for (const f of this.flies) {
      f.t -= dt;
      if (f.state === 'perch') {
        this.perchPos(f.perch, f.goal);
        f.pos.lerp(f.goal, 1 - Math.exp(-14 * dt));
        f.vel.set(0, 0, 0);
        f.flyK = damp(f.flyK, 0, 6, dt);
        if (f.t <= 0) {
          if (active > 0.5 && r.chance(0.8)) { f.hops = r.int(2, 6); this.newHover(f); }
          else f.t = r.range(4, 12);
        }
        // a heron head coming close: off it goes
        if (H && H.obj.visible && active > 0.2) { H.billTip(_a); if (_a.distanceTo(f.pos) < 0.45) { f.hops = r.int(1, 3); this.newHover(f); } }
      } else {
        f.flyK = damp(f.flyK, 1, 8, dt);
        // turning to face a new point first, then the dart: quick but eased (a critically damped spring)
        if (f.state === 'turn') {
          let dd = f.yawGoal - f.yaw; dd = ((dd + Math.PI) % TAU + TAU) % TAU - Math.PI;
          if (Math.abs(dd) < 0.3 || f.t <= 0) { f.state = 'dart'; f.t = r.range(0.5, 0.9); f.goal.copy(f.next); }
        }
        const w = f.state === 'dart' ? 7 : 3.5, ex2 = Math.exp(-w * dt);
        let e = f.pos.x - f.goal.x, a = (f.vel.x + w * e) * dt;
        f.pos.x = f.goal.x + (e + a) * ex2; f.vel.x = (f.vel.x - w * a) * ex2;
        e = f.pos.y - f.goal.y; a = (f.vel.y + w * e) * dt;
        f.pos.y = f.goal.y + (e + a) * ex2; f.vel.y = (f.vel.y - w * a) * ex2;
        e = f.pos.z - f.goal.z; a = (f.vel.z + w * e) * dt;
        f.pos.z = f.goal.z + (e + a) * ex2; f.vel.z = (f.vel.z - w * a) * ex2;
        // hovering: a faint drift
        if (f.state === 'hover') { f.pos.x += Math.sin(time * 1.7 + f.ph) * 0.004 * dt; f.pos.y += Math.sin(time * 2.3 + f.ph * 2) * 0.006 * dt; }
        const sp = Math.hypot(f.vel.x, f.vel.z);
        if (sp > 0.15 && f.state !== 'turn') f.yawGoal = Math.atan2(f.vel.x, f.vel.z);
        if (f.t <= 0 && f.state !== 'turn' && f.state !== 'land') {
          if (f.state === 'dart') { f.state = 'hover'; f.t = r.range(0.6, 2.4); }
          else if (f.hops-- > 0 && active > 0.3) this.newHover(f);
          else {
            // to a perch
            let best = null;
            for (let k = 0; k < 6; k++) { const pc = r.pick(this.perches); const d = this.perchPos(pc, _a).distanceTo(f.pos); if (d < 3.5 && (!best || r.chance(0.5))) best = pc; }
            f.perch = best || f.perch;
            this.perchPos(f.perch, f.goal); f.goal.y += 0.03;
            f.state = 'land'; f.t = 1.4;
          }
        }
        if (f.state === 'land') {
          this.perchPos(f.perch, _a);
          f.goal.set(_a.x, _a.y + 0.03 * smoothstep(0, 1.0, f.t), _a.z);
          if (f.t <= 0 && f.pos.distanceTo(_a) < 0.008) { f.state = 'perch'; f.t = r.range(5, 16); }
          else if (f.t <= -2) { f.state = 'perch'; f.t = r.range(5, 16); }
        }
      }
      // turn smoothly (never more than ~9 rad/s)
      let d = f.yawGoal - f.yaw; d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
      f.yaw += clamp(d * (1 - Math.exp(-8 * dt)), -9 * dt, 9 * dt);
    }
  }
  newHover(f) {
    const P = this.pond, r = this.rng;
    // a new point over the water near the shore, 0.15-0.9 m up; face it first, then dart
    for (let k = 0; k < 8; k++) {
      const a = r.range(0, TAU), d = r.range(0.4, 1.8);
      f.goal.set(f.pos.x + Math.cos(a) * d, 0, f.pos.z + Math.sin(a) * d);
      const e = P.sdf(f.goal.x, f.goal.z);
      if (e < 0.4 && e > -2.2) break;
    }
    f.goal.y = Math.max(P.height(f.goal.x, f.goal.z), WATER_Y) + r.range(0.15, 0.9);
    f.yawGoal = Math.atan2(f.goal.x - f.pos.x, f.goal.z - f.pos.z);
    (f.next || (f.next = new THREE.Vector3())).copy(f.goal);
    f.goal.copy(f.pos); // hold position while turning to face it
    if (f.state === 'perch') f.goal.y += 0.06; // lift off the perch first
    f.state = 'turn'; f.t = 0.8;
  }
  render() {
    let i = 0;
    for (const f of this.flies) {
      // pitch with the climb, bank a little with the turn
      _e.set(-clamp(f.vel.y * 0.8, -0.5, 0.5), f.yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(f.pos, _q, _s.setScalar(f.size));
      this.mesh.setMatrixAt(i, _m);
      this.fly.setX(i, f.flyK);
      i++;
    }
    this.mesh.instanceMatrix.needsUpdate = true; this.fly.needsUpdate = true;
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

/* ================================================================== */
/* Frogs                                                                */
/* ================================================================== */
/** procedural frog: crouched pose in `position`, a stretched leap pose in `aExt`, a throat sac weight in `aPouch` */
function frogGeometry() {
  const pos = [], ext = [], nor = [], col = [], pouch = [], idx = [];
  const green = new THREE.Color('#5f7d2e'), dark = new THREE.Color('#2f3d19'), belly = new THREE.Color('#d9d4b0'), gold = new THREE.Color('#c9a03a');
  const grid = (nu, nv, P, Pe, colFn, pouchFn = () => 0, wrap = true) => {
    const base = pos.length / 3, A = new THREE.Vector3(), Bv = new THREE.Vector3();
    const pts = [], pex = [];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { pts.push(P(i / nu, j / nv, new THREE.Vector3())); pex.push(Pe(i / nu, j / nv, new THREE.Vector3())); }
    const at = (arr, i, j) => arr[clamp(i, 0, nu) * (nv + 1) + (wrap ? ((j % nv) + nv) % nv : clamp(j, 0, nv))];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const p = at(pts, i, j), pe = at(pex, i, j);
      A.subVectors(at(pts, i + 1, j), at(pts, i - 1, j)); Bv.subVectors(at(pts, i, j + 1), at(pts, i, j - 1));
      const n = new THREE.Vector3().crossVectors(A, Bv);
      if (n.lengthSq() < 1e-16) n.set(0, i === 0 ? -1 : 1, 0);
      n.normalize();
      pos.push(p.x, p.y, p.z); ext.push(pe.x, pe.y, pe.z); nor.push(n.x, n.y, n.z);
      const c = colFn(i / nu, j / nv, p); col.push(c.r, c.g, c.b); pouch.push(pouchFn(i / nu, j / nv, p));
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = base + i * (nv + 1) + j, b = a + nv + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  };
  const spot = (p) => { const v = Math.sin(p.x * 900 + 1.3) * Math.sin(p.z * 760) * Math.sin(p.y * 1100 + 2); return v > 0.35 ? 1 : 0; };
  const tmpC = new THREE.Color();
  // body + head: one loft along z (tail -> snout), flattened, the head wider than the neck
  const bodyR = [[0, 0.0, 0.0], [0.08, 0.012, 0.009], [0.3, 0.021, 0.015], [0.55, 0.022, 0.015], [0.72, 0.02, 0.013], [0.86, 0.016, 0.01], [0.95, 0.009, 0.006], [1, 0, 0]];
  const tab = (t, k) => { for (let i = 1; i < bodyR.length; i++) if (t <= bodyR[i][0]) { const a = bodyR[i - 1], b = bodyR[i], u = (t - a[0]) / (b[0] - a[0]); return lerp(a[k], b[k], 0.5 - 0.5 * Math.cos(Math.PI * u)); } return 0; };
  const body = (t, w, out, stretch) => {
    const z = lerp(-0.036, 0.036, t) * (1 + stretch * 0.08), ph = w * TAU;
    const rx = tab(t, 1), ry = tab(t, 2);
    const y = 0.018 + (t > 0.7 ? (t - 0.7) * 0.012 : 0) + stretch * 0.004;
    const sx = Math.sin(ph), cy = -Math.cos(ph);
    return out.set(sx * rx, y + cy * ry * (cy < 0 ? 0.75 : 1), z);
  };
  grid(16, 14, (t, w, o) => body(t, w, o, 0), (t, w, o) => body(t, w, o, 1), (t, w, p) => {
    const up = -Math.cos(w * TAU);
    tmpC.copy(belly).lerp(green, smoothstep(-0.35, 0.15, up));
    if (up > 0.1 && spot(p)) tmpC.lerp(dark, 0.7);
    if (up > 0.6 && Math.abs(p.x) < 0.0025) tmpC.lerp(new THREE.Color('#b6c27a'), 0.6); // pale dorsal stripe
    return tmpC.clone();
  }, (t, w, p) => {
    // the throat: under the head, just behind the jaw
    const up = -Math.cos(w * TAU);
    return smoothstep(0.62, 0.75, t) * (1 - smoothstep(0.86, 0.95, t)) * smoothstep(0.1, -0.5, up);
  });
  // eyes
  for (const s of [1, -1]) {
    const c = new THREE.Vector3(s * 0.0115, 0.031, 0.021), r = 0.0062;
    grid(6, 10, (t, w, o) => { const th = t * Math.PI, ph = w * TAU; return o.set(c.x + Math.sin(th) * Math.cos(ph) * r, c.y + Math.cos(th) * r, c.z + Math.sin(th) * Math.sin(ph) * r); },
      (t, w, o) => { const th = t * Math.PI, ph = w * TAU; return o.set(c.x + Math.sin(th) * Math.cos(ph) * r, c.y + 0.004 + Math.cos(th) * r, c.z + 0.003 + Math.sin(th) * Math.sin(ph) * r); },
      (t, w, p) => { const dz = p.z - c.z, dx = (p.x - c.x) * s; return dx > r * 0.55 && Math.abs(p.y - c.y) < r * 0.22 && Math.abs(dz) < r * 0.5 ? new THREE.Color('#0b0b0b') : dx > r * 0.3 ? gold.clone() : green.clone(); });
  }
  // legs: tubes along crouched / leaping polylines
  const leg = (crouch, leap, r0, r1) => {
    const nu = 8, nv = 6;
    const along = (pts, t, o) => { const n = pts.length - 1, x = t * n, i = Math.min(n - 1, Math.floor(x)), f = x - i; return o.copy(pts[i]).lerp(pts[i + 1], f); };
    const frame = (pts, t, R, w, o) => {
      const c = along(pts, t, new THREE.Vector3()), d = along(pts, Math.min(1, t + 0.02), new THREE.Vector3()).sub(along(pts, Math.max(0, t - 0.02), new THREE.Vector3())).normalize();
      const n1 = new THREE.Vector3(0, 1, 0).addScaledVector(d, -d.y); if (n1.lengthSq() < 1e-6) n1.set(1, 0, 0); n1.normalize();
      const n2 = new THREE.Vector3().crossVectors(d, n1), ph = w * TAU;
      return o.copy(c).addScaledVector(n1, Math.cos(ph) * R).addScaledVector(n2, Math.sin(ph) * R);
    };
    grid(nu, nv, (t, w, o) => frame(crouch, t, lerp(r0, r1, t), w, o), (t, w, o) => frame(leap, t, lerp(r0, r1, t), w, o),
      (t, w, p) => { tmpC.copy(green).lerp(dark, spot(p) * 0.6); return tmpC.clone(); });
  };
  for (const s of [1, -1]) {
    const v = (x, y, z) => new THREE.Vector3(s * x, y, z);
    // hind legs folded in a Z beside the body; stretched straight back for the leap
    leg([v(0.014, 0.014, -0.026), v(0.032, 0.01, -0.004), v(0.026, 0.005, -0.04), v(0.036, 0.002, -0.012), v(0.04, 0.001, 0.004)],
      [v(0.014, 0.016, -0.03), v(0.02, 0.012, -0.06), v(0.019, 0.01, -0.092), v(0.02, 0.009, -0.118), v(0.022, 0.008, -0.135)], 0.0068, 0.0032);
    // front legs
    leg([v(0.013, 0.012, 0.012), v(0.019, 0.004, 0.022), v(0.021, 0.001, 0.03)],
      [v(0.013, 0.014, 0.012), v(0.016, 0.012, 0.03), v(0.016, 0.012, 0.045)], 0.0036, 0.0024);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aExt', new THREE.Float32BufferAttribute(ext, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aPouch', new THREE.Float32BufferAttribute(pouch, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class Frogs {
  constructor(pond, rng) {
    this.pond = pond; this.rng = rng;
    const n = Math.round(lerp(2, 3, pond.q));
    this.geo = frogGeometry();
    this.aHop = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); this.aHop.setUsage(THREE.DynamicDrawUsage);
    this.aCroak = new THREE.InstancedBufferAttribute(new Float32Array(n), 1); this.aCroak.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aHop', this.aHop); this.geo.setAttribute('aCroak', this.aCroak);
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0 });
    patchMaterial(this.mat, {
      key: 'koiFrog',
      vertexHeader: 'attribute vec3 aExt; attribute float aPouch; attribute float aHop; attribute float aCroak; varying float vPouch;',
      fragmentHeader: 'varying float vPouch;',
      vertex: {
        // the leap pose blends in; the throat sac swells out (down and forward) as it calls
        '#include <begin_vertex>': /* glsl */`$&
          transformed = mix(position, aExt, aHop);
          transformed += vec3(0.0, -0.55, 0.45) * aPouch * aCroak * 0.016;
          vPouch = aPouch * aCroak;`,
      },
      fragment: { '#include <color_fragment>': '$&\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.9, 0.72), clamp(vPouch * 1.6, 0.0, 0.85));' },
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'frogs';
    pond.scene.add(this.mesh);
    // the biggest pads without a flower
    const pads = pond.pads.filter(p => !pond.flowers.some(f => f.pad === p)).sort((a, b) => b.mesh.geometry.parameters.radius - a.mesh.geometry.parameters.radius);
    this.frogs = [];
    for (let i = 0; i < n && pads.length; i++) {
      const pad = pads[i % pads.length], R = pad.mesh.geometry.parameters.radius;
      const off = new THREE.Vector3(rng.range(-0.3, 0.3) * R, 0, rng.range(-0.3, 0.3) * R);
      this.frogs.push({ pad, R, off, yaw: rng.range(0, TAU), yawGoal: 0, pos: new THREE.Vector3(), state: 'sit', t: rng.range(2, 8), hop: 0, croak: 0, bout: 0, ct: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), dur: 0.5, k: 0, pitch: 0, breathe: rng.range(0, TAU), under: 0 });
    }
    for (const f of this.frogs) { f.yawGoal = f.yaw; this.seat(f, f.pos); }
  }
  seat(f, out) {
    const pm = f.pad.mesh;
    _a.copy(f.off).applyAxisAngle(_b.set(0, 1, 0), pm.rotation.y);
    return out.set(pm.position.x + _a.x, pm.position.y + 0.004, pm.position.z + _a.z);
  }
  /** the heron landed or struck: frogs within reach leap into the water */
  scare(p, R = 4.5) {
    for (const f of this.frogs) if (f.state === 'sit' || f.state === 'croak') {
      if (Math.hypot(f.pos.x - p.x, f.pos.z - p.z) < R) { f.state = 'crouch'; f.t = this.rng.range(0.05, 0.6); }
    }
  }
  update(dt, time) {
    const P = this.pond, r = this.rng, S = P.sunState, H = P.heron;
    const evening = S ? Math.max(S.night, S.golden * 0.7) : 0;
    for (const f of this.frogs) {
      f.t -= dt;
      f.breathe += dt * TAU * 1.4;
      switch (f.state) {
        case 'sit': case 'croak': {
          this.seat(f, f.pos);
          f.hop = damp(f.hop, 0, 10, dt);
          if (f.state === 'croak') {
            // a bout of calls: swell, hold, let go
            f.ct += dt;
            const c = f.ct % 0.75;
            f.croak = c < 0.16 ? smoothstep(0, 0.16, c) : c < 0.3 ? 1 : c < 0.5 ? 1 - smoothstep(0.3, 0.5, c) : 0;
            if (f.ct > f.bout) { f.state = 'sit'; f.t = r.range(4, 14) * (evening > 0.5 ? 0.5 : 1.6); }
          } else {
            f.croak = damp(f.croak, 0.06 + 0.04 * Math.sin(f.breathe), 12, dt); // throat pumping
            if (f.t <= 0) {
              if (r.chance(lerp(0.15, 0.7, evening))) { f.state = 'croak'; f.ct = 0; f.bout = 0.75 * r.int(3, 7) - 0.1; }
              else { f.yawGoal = f.yaw + r.range(-0.9, 0.9); f.t = r.range(4, 12); }
            }
          }
          break;
        }
        case 'crouch':
          this.seat(f, f.pos);
          f.croak = damp(f.croak, 0, 12, dt);
          if (f.t <= 0) {
            // leap outward from the pad into open water
            f.state = 'leap'; f.k = 0; f.dur = 0.42;
            f.from.copy(f.pos);
            const away = _a.subVectors(f.pos, f.pad.mesh.position).setY(0);
            if (away.lengthSq() < 1e-6) away.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
            away.normalize();
            f.to.copy(f.pos).addScaledVector(away, f.R + r.range(0.18, 0.3)); f.to.y = WATER_Y;
            P.pushOutOfObstacles(f.to, 0.15);
            f.yawGoal = Math.atan2(away.x, away.z);
            f.yaw = f.yaw + clamp(((f.yawGoal - f.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI, -0.6, 0.6);
          }
          break;
        case 'leap': {
          f.k = Math.min(1, f.k + dt / f.dur);
          const k = f.k;
          f.pos.lerpVectors(f.from, f.to, k);
          f.pos.y += Math.sin(Math.PI * k) * 0.11;
          f.hop = smoothstep(0, 0.25, k);
          f.pitch = lerp(-0.5, 0.9, k);
          if (k >= 1) {
            P.addRipple(f.pos.x, f.pos.z, 0.7); P.splash(f.pos.x, WATER_Y, f.pos.z, 5, 0.45); P.env.sfx('drop');
            f.state = 'swim'; f.t = r.range(1.2, 2.0); f.from.copy(f.pos);
          }
          break;
        }
        case 'swim': {
          // dive and swim back under the pad (hidden from above), kicking
          this.seat(f, f.to); f.to.y = WATER_Y - 0.1;
          const k = smoothstep(0, 1, 1 - Math.max(0, f.t) / 2.0);
          f.pos.lerpVectors(f.from, f.to, k);
          f.hop = 0.45 + 0.4 * Math.sin(time * 9 + f.breathe);
          f.pitch = damp(f.pitch, 0.25, 4, dt);
          f.yawGoal = Math.atan2(f.to.x - f.from.x, f.to.z - f.from.z);
          if (f.t <= 0) { f.state = 'hide'; f.t = r.range(12, 25); }
          break;
        }
        case 'hide':
          this.seat(f, f.pos); f.pos.y = WATER_Y - 0.1;
          f.hop = damp(f.hop, 0.3, 3, dt);
          // back up once the heron has gone (or after a while)
          if (f.t <= 0 && !(H && H.obj.visible && Math.hypot(H.center.x - f.pos.x, H.center.z - f.pos.z) < 5)) {
            f.state = 'climb'; f.k = 0; f.from.copy(f.pos);
            _a.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
            f.to.copy(f.pad.mesh.position).addScaledVector(_a, f.R + 0.06); f.to.y = WATER_Y - 0.01;
          } else if (f.t <= 0) f.t = 3;
          break;
        case 'climb': {
          // swim up to the edge of the pad, then a small hop back on
          f.k += dt;
          if (f.k < 1.4) {
            const k = smoothstep(0, 1.4, f.k);
            f.pos.lerpVectors(f.from, f.to, k);
            f.hop = 0.4 + 0.3 * Math.sin(time * 8);
            f.yawGoal = Math.atan2(f.to.x - f.from.x, f.to.z - f.from.z);
          } else {
            if (!f.onEdge) { f.onEdge = true; P.addRipple(f.pos.x, f.pos.z, 0.35); f.from.copy(f.pos); }
            const k = Math.min(1, (f.k - 1.4) / 0.4);
            this.seat(f, _b);
            f.pos.lerpVectors(f.from, _b, k); f.pos.y += Math.sin(Math.PI * k) * 0.05;
            f.hop = Math.sin(Math.PI * k) * 0.7;
            f.pitch = damp(f.pitch, 0, 6, dt);
            if (k >= 1) { f.state = 'sit'; f.onEdge = false; f.t = r.range(3, 9); f.yawGoal = f.yaw + Math.PI; }
          }
          break;
        }
      }
      if (f.state === 'sit' || f.state === 'croak' || f.state === 'crouch' || f.state === 'hide') f.pitch = damp(f.pitch, 0, 6, dt);
      let d = f.yawGoal - f.yaw; d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
      f.yaw += clamp(d * (1 - Math.exp(-3 * dt)), -4 * dt, 4 * dt);
    }
  }
  render() {
    let i = 0;
    for (const f of this.frogs) {
      _e.set(f.pitch, f.yaw, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(f.pos, _q, _s.setScalar(1));
      this.mesh.setMatrixAt(i, _m);
      this.aHop.setX(i, f.hop); this.aCroak.setX(i, f.croak);
      i++;
    }
    this.mesh.count = i;
    this.mesh.instanceMatrix.needsUpdate = true; this.aHop.needsUpdate = true; this.aCroak.needsUpdate = true;
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}
