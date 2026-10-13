// 晴岛 · 鲣鸟 — masked boobies: a loose flock that works the open sea around the island by day, now and then folding
// its wings and plunging for fish; when the whale surfaces they come from all round, wheel over it and dive into the
// fish it has stirred up. At dusk they head out to sea and are gone until morning (nothing is drawn).
//
// One instanced mesh (one draw call): a small body and two jointed wings, flapped and folded in the vertex shader
// from per-bird attributes. Far birds keep a minimum size on screen so their wings never thin into crawling slivers.
// Every motion is integrated with dt (rate-limited turns, eased speeds), so it is the same at 30 and 60 fps.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, damp, angleDelta, makeRng, patchMaterial } from '../../lib/util.js';
import { LAYER_NO_REFLECT, addUnderwater } from './shared.js';
import { waveHeight } from './water.js';

const V3 = THREE.Vector3;
const WHITE = [0.95, 0.95, 0.93], BLACK = [0.05, 0.05, 0.06], BILL = [0.86, 0.8, 0.42], MASK = [0.08, 0.08, 0.09];

/** A booby, 0.85 m long, 1.6 m across: forward +X, up +Y, right wing +Z. aW = (wing side -1 | 0 | 1, span 0..1). */
function buildBooby() {
  const pos = [], col = [], aw = [], idx = [];
  const push = (x, y, z, c, side = 0, s = 0) => { pos.push(x, y, z); col.push(c[0], c[1], c[2]); aw.push(side, s); return pos.length / 3 - 1; };
  // body: a spindle from the tail to the bill
  const st = [[-0.36, 0.022], [-0.26, 0.05], [-0.12, 0.085], [0.02, 0.09], [0.14, 0.072], [0.22, 0.055], [0.28, 0.058], [0.33, 0.04], [0.38, 0.022], [0.47, 0.004]];
  const NR = 6;
  for (let i = 0; i < st.length; i++) {
    const [x, r] = st[i];
    for (let j = 0; j < NR; j++) {
      const a = j / NR * TAU;
      const c = x > 0.37 ? BILL : x > 0.3 && Math.cos(a) > -0.2 ? MASK : WHITE;
      push(x, Math.cos(a) * r * 0.9 + (x > 0.2 ? 0.02 : 0), Math.sin(a) * r, c);
    }
  }
  for (let i = 0; i < st.length - 1; i++) for (let j = 0; j < NR; j++) {
    const a = i * NR + j, b = i * NR + (j + 1) % NR, c = a + NR, d = b + NR;
    idx.push(a, c, b, b, c, d);
  }
  // tail: a dark wedge
  const t0 = push(-0.3, 0.01, 0, BLACK), t1 = push(-0.5, 0.0, 0.08, BLACK), t2 = push(-0.5, 0.0, -0.08, BLACK), t3 = push(-0.54, 0.0, 0, BLACK);
  idx.push(t0, t1, t3, t0, t3, t2);
  // wings: leading edge, middle and trailing edge along five stations from the shoulder to the tip
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    const NS = 5;
    for (let i = 0; i < NS; i++) {
      const s = i / (NS - 1);
      const z = side * (0.07 + s * 0.78);
      const le = 0.09 - 0.07 * s * s, te = -0.15 + 0.06 * s + 0.04 * s * s;
      const ch = (le - te) * (s > 0.85 ? 1 - (s - 0.85) * 4 : 1);
      const mid = te + ch * 0.55;
      push(le, 0.01, z, s < 0.55 ? WHITE : BLACK, side, s);
      push(mid, 0.005, z, s < 0.5 ? WHITE : BLACK, side, s);
      push(le - ch, 0, z, BLACK, side, s);
    }
    for (let i = 0; i < NS - 1; i++) for (let k = 0; k < 2; k++) {
      const a = base + i * 3 + k, b = a + 1, c = a + 3, d = c + 1;
      if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aW', new THREE.Float32BufferAttribute(aw, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const FLAP_HEAD = /* glsl */`
attribute vec2 aW;
attribute vec4 aFlap;   // flap phase, amplitude, fold (0 open .. 1 folded back for a plunge), minimum size (px)
uniform float uPxScale;
vec3 bdPos;
`;
// wings beat about the shoulder (the hand lags and bends further), and fold back along the body for a plunge
const FLAP_NORMAL = /* glsl */`
vec3 objectNormal = vec3(normal);
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif
{
  vec3 p = position;
  if (abs(aW.x) > 0.5) {
    float side = aW.x, s = aW.y;
    float th = (aFlap.y * sin(aFlap.x - s * 0.9) + 0.1) * (0.8 + 0.55 * s) * (1.0 - 0.8 * aFlap.z);
    float r = abs(p.z) - 0.07;
    float rc = r * cos(th) - p.y * sin(th), yc = p.y * cos(th) + r * sin(th);
    float fo = aFlap.z * 1.25;                                   // sweep back
    float spanK = 1.0 - 0.45 * aFlap.z;
    p = vec3(p.x - rc * spanK * sin(fo) - 0.04 * aFlap.z, yc, side * (0.07 + rc * spanK * cos(fo)));
    vec3 n = vec3(0.0, cos(th), -side * sin(th));
    objectNormal = normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.3));
  }
  // far away a bird keeps a few pixels of size (its wings would thin into sub-pixel slivers that crawl)
  vec3 bw = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float px = 1.6 * uPxScale / max(distance(bw, cameraPosition), 1.0);
  p *= clamp(aFlap.w / max(px, 1e-3), 1.0, 2.2);
  bdPos = p;
}
`;

export function createSeabirds(env, { fx }) {
  const q = env.q;
  const rng = makeRng(env.seed ^ 0xb00b);
  const N = Math.round(lerp(9, 15, q));
  const geo = buildBooby();
  const aFlap = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  aFlap.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aFlap', aFlap);
  const U = { uPxScale: { value: 600 } };
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide, envMapIntensity: 0.6 });
  patchMaterial(mat, {
    key: 'booby', uniforms: U, vertexHeader: FLAP_HEAD,
    vertex: { '#include <beginnormal_vertex>': FLAP_NORMAL, '#include <begin_vertex>': '$&\n transformed = bdPos;' },
  });
  addUnderwater(mat, { key: 'booby' });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.name = 'boobies';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.layers.set(LAYER_NO_REFLECT);

  // the patch of sea they work by day: a broad loop around the island, beyond the reef
  const home = { a: rng.range(0, TAU), r: rng.range(70, 110) };
  const birds = [];
  for (let i = 0; i < N; i++) {
    const r = makeRng(env.seed ^ (0xb1 + i * 977));
    const a = home.a + r.range(-0.6, 0.6), d = home.r + r.range(-25, 25);
    const b = {
      r, pos: new V3(Math.cos(a) * d, r.range(14, 26), Math.sin(a) * d), vel: new V3(), yaw: r.range(0, TAU), pitch: 0, roll: 0, yawRate: 0,
      speed: r.range(9, 11), state: 'cruise', timer: r.range(6, 30), ph: r.range(0, TAU), flapK: r.range(2.6, 3.2), amp: 0.6, fold: 0,
      orbitA: r.range(0, TAU), orbitR: r.range(14, 30), orbitH: r.range(12, 24), dir: r.chance(0.5) ? 1 : -1, glide: false, glideT: r.range(1, 4),
      target: new V3(), turnSide: 1, delay: r.range(0, 7), seen: -1,
    };
    b.vel.set(Math.sin(b.yaw), 0, Math.cos(b.yaw)).multiplyScalar(b.speed);
    birds.push(b);
  }
  const _w = new V3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _x = new V3(), _y = new V3(), _z = new V3(), _s = new V3(1, 1, 1);
  const UP = new V3(0, 1, 0);
  const MAX_TURN = 1.6; // rad/s

  /** Turn the velocity toward `want` at a limited rate (the bird banks round, it never pivots) and ease its speed. */
  function steer(b, want, rate, dt) {
    const k = 1 - Math.exp(-rate * dt);
    const hs = Math.hypot(b.vel.x, b.vel.z), ws = Math.hypot(want.x, want.z);
    const cur = hs > 0.3 ? Math.atan2(b.vel.x, b.vel.z) : b.yaw;
    let da = angleDelta(cur, ws > 1e-4 ? Math.atan2(want.x, want.z) : cur);
    if (Math.abs(da) > Math.PI - 0.3) da = (Math.abs(b.yawRate) > 0.1 ? Math.sign(b.yawRate) : b.turnSide) * Math.abs(da);
    else if (Math.abs(da) > 0.05) b.turnSide = Math.sign(da);
    const a = cur + clamp(da * k, -MAX_TURN * dt, MAX_TURN * dt);
    const nhs = hs + (ws - hs) * k;
    b.vel.x = Math.sin(a) * nhs; b.vel.z = Math.cos(a) * nhs;
    b.vel.y += (want.y - b.vel.y) * k;
  }

  let away = 0, lastSeq = -1;
  function update(dt, t, { day, focus, time }) {
    // at dusk the flock heads out to sea; at dawn it comes back
    away = damp(away, day > 0.35 ? 0 : 1, 0.5, dt);
    const working = focus && focus.active && day > 0.35;
    if (working && focus.seq !== lastSeq) {
      lastSeq = focus.seq;
      for (const b of birds) if (b.state === 'cruise' || b.state === 'gather' || b.state === 'circle') { b.state = 'gather'; b.seen = b.delay; }
    }
    let far = 0;
    for (let i = 0; i < birds.length; i++) {
      const b = birds[i];
      let flap = true, foldT = 0, rate = 1.4;
      const sp = b.speed;
      switch (b.state) {
        case 'cruise': {
          // a broad loop over the open sea, with a plunge now and then
          b.orbitA += dt * (sp / (home.r + 30)) * b.dir;
          const R = home.r + 25 * Math.sin(b.orbitA * 2 + i);
          _w.set(Math.cos(b.orbitA) * R, 16 + 6 * Math.sin(t * 0.13 + i), Math.sin(b.orbitA) * R).sub(b.pos);
          if (away > 0.5) _w.set(b.pos.x, 0, b.pos.z).setLength(30).setY(20 - b.pos.y);
          _w.setLength(sp);
          b.timer -= dt;
          if (b.timer <= 0 && away < 0.5 && b.pos.y > 10) { b.state = 'plunge'; b.timer = 9; b.target.set(b.pos.x + b.vel.x * 2, 0, b.pos.z + b.vel.z * 2); }
          break;
        }
        case 'gather': case 'circle': {
          if (!working) { b.state = 'cruise'; b.timer = b.r.range(10, 30); break; }
          if (b.seen > 0) { b.seen -= dt; _w.copy(b.vel).setY(0); break; }
          // wheel over where the whale came up
          b.orbitA += dt * (sp / b.orbitR) * b.dir;
          _w.set(focus.x + Math.cos(b.orbitA) * b.orbitR, b.orbitH, focus.z + Math.sin(b.orbitA) * b.orbitR).sub(b.pos);
          const d = _w.length();
          if (b.state === 'gather' && d < 12) { b.state = 'circle'; b.timer = b.r.range(2, 7); }
          _w.setLength(sp * (d > 30 ? 1.25 : 1));
          rate = 1.6;
          if (b.state === 'circle') {
            b.timer -= dt;
            if (b.timer <= 0 && b.pos.y > 8) {
              b.state = 'plunge'; b.timer = 9;
              b.target.set(focus.x + b.r.range(-9, 9), 0, focus.z + b.r.range(-9, 9));
            }
          }
          break;
        }
        case 'plunge': {
          // turn onto the fish, tip over and fall, wings sweeping back into an arrow
          _w.subVectors(b.target, b.pos);
          const hd = Math.hypot(_w.x, _w.z);
          const steep = smoothstep(0, 1, (b.pos.y - 1) / Math.max(hd, 0.5));
          const v = Math.min(22, Math.hypot(b.vel.x, b.vel.y, b.vel.z) + 9 * dt * (0.4 + steep));
          _w.y -= b.pos.y * 0.2;
          _w.setLength(v);
          foldT = smoothstep(0.35, 0.9, steep);
          flap = foldT < 0.3;
          rate = 3;
          b.timer -= dt;
          if (b.timer <= 0) { b.state = 'takeoff'; b.timer = 1.2; break; } // (never got a line on it)
          const surf = waveHeight(b.pos.x, b.pos.z, time);
          if (b.pos.y < surf + 0.1 && b.vel.y < 0) {
            b.state = 'under'; b.timer = b.r.range(1.4, 2.4);
            fx.splashBird(b.pos.x, surf, b.pos.z, b.vel.x, b.vel.z, focus && focus.active ? 1 : 0.7);
          }
          break;
        }
        case 'under': {
          // underwater: carries on down a little, slows, comes back up (hidden by the sea)
          b.timer -= dt;
          _w.copy(b.vel).setY(b.timer > 0.9 ? -0.6 : 1.6).multiplyScalar(1);
          _w.x *= 0.3; _w.z *= 0.3;
          rate = 2.5; foldT = 1; flap = false;
          const surf = waveHeight(b.pos.x, b.pos.z, time);
          if (b.timer <= 0 && b.pos.y > surf - 0.15) { b.state = 'float'; b.timer = b.r.range(0.8, 2.2); }
          break;
        }
        case 'float': {
          b.timer -= dt;
          _w.copy(b.vel).setY(0).multiplyScalar(0.2);
          foldT = 1; flap = false; rate = 3;
          b.pos.y = damp(b.pos.y, waveHeight(b.pos.x, b.pos.z, time) + 0.05, 6, dt);
          if (b.timer <= 0) { b.state = 'takeoff'; b.timer = 1.6; }
          break;
        }
        case 'takeoff': {
          // run along the water flapping hard, then climb away
          b.timer -= dt;
          _w.set(Math.sin(b.yaw), 0, Math.cos(b.yaw)).multiplyScalar(sp).setY(2.6);
          rate = 1.2;
          if (b.timer <= 0) { b.state = working ? 'gather' : 'cruise'; b.timer = b.r.range(12, 32); b.seen = 0; }
          break;
        }
      }
      steer(b, _w, rate, dt);
      if (b.state === 'float') { b.vel.y = 0; b.pos.x += b.vel.x * dt; b.pos.z += b.vel.z * dt; }
      else b.pos.addScaledVector(b.vel, dt);
      // keep clear of the island and the sea (except when diving in)
      if (b.state !== 'plunge' && b.state !== 'under' && b.state !== 'float') {
        const floor = Math.max(4, 22 - Math.hypot(b.pos.x, b.pos.z) * 0.3);
        if (b.pos.y < floor && b.state !== 'takeoff') b.pos.y = damp(b.pos.y, floor, 1.5, dt);
      }
      if (Math.hypot(b.pos.x, b.pos.z) > 420) far++;
      // wing beat: flapping with glides; quick and deep at take-off, none in a plunge
      b.glideT -= dt;
      if (b.glideT < 0) { b.glide = !b.glide; b.glideT = b.glide ? b.r.range(1.2, 3.5) : b.r.range(0.8, 2); }
      const beat = flap && !(b.glide && b.state !== 'takeoff' && b.vel.y < 0.5);
      b.amp = damp(b.amp, beat ? (b.state === 'takeoff' ? 0.95 : 0.65) : 0.04, 5, dt);
      b.ph = (b.ph + dt * TAU * b.flapK * (b.state === 'takeoff' ? 1.4 : 1) * (beat ? 1 : 0.3)) % TAU;
      b.fold = damp(b.fold, foldT, 6, dt);
      // orientation from the flight: heading, climb/dive, bank into turns
      const hs = Math.hypot(b.vel.x, b.vel.z);
      const wantYaw = hs > 0.3 ? Math.atan2(b.vel.x, b.vel.z) : b.yaw;
      const dy = clamp(angleDelta(b.yaw, wantYaw) * (1 - Math.exp(-8 * dt)), -2.4 * dt, 2.4 * dt);
      b.yaw = (b.yaw + dy) % TAU;
      b.yawRate = damp(b.yawRate, dy / Math.max(dt, 1e-4), 6, dt);
      b.pitch = damp(b.pitch, clamp(Math.atan2(b.vel.y, Math.max(hs, 0.5)), -1.45, 0.6), 7, dt);
      b.roll = damp(b.roll, clamp(-b.yawRate * hs * 0.1, -0.8, 0.8) * (1 - b.fold), 3, dt);
      const cp = Math.cos(b.pitch);
      _z.set(Math.sin(b.yaw) * cp, Math.sin(b.pitch), Math.cos(b.yaw) * cp); // forward
      _y.copy(UP).applyAxisAngle(_z, b.roll);
      _x.crossVectors(_y, _z).normalize();                                // left... the model's +Z is the right wing
      _y.crossVectors(_z, _x).normalize();
      // model axes: +X forward, +Y up, +Z right
      _m.makeBasis(_z, _y, _x.negate());
      _q.setFromRotationMatrix(_m);
      _m.compose(b.pos, _q, _s);
      mesh.setMatrixAt(i, _m);
      aFlap.setXYZW(i, b.ph, b.amp, b.fold, 9);
    }
    mesh.instanceMatrix.needsUpdate = true;
    aFlap.needsUpdate = true;
    mesh.visible = !(away > 0.98 && far === birds.length);
  }
  function setView(bufH, proj) { U.uPxScale.value = 0.5 * bufH * proj.elements[5]; }

  return {
    mesh, birds, update, setView,
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
