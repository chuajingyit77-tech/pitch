// 深蓝 · 珊瑚礁 — a broadclub cuttlefish (乌贼) hovering over the reef: an undulating fin skirt, eight arms
// held in a crown, and a skin that changes with what it is doing. By day it drifts between spots near
// its home on a coral head in mottled camouflage, now and then running "passing clouds" (dark bands that
// flow over the mantle) as it hunts; when food falls nearby it comes over to watch it, clouds rolling;
// when the whale shark passes it darkens, raises its arms and sinks close to the reef until the giant
// has gone. At night it rests low on the reef, dull and slow. Colour changes ease over a second or two.
// One mesh, one draw call (~2.6k triangles). Local frame: +X forward (arms), +Y up, +Z right.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU, damp, angleDelta, quatFromForward, patchMaterial } from '../../lib/util.js';
import { waterize, UW_VERT, UW_FRAG, NOISE_GLSL } from './uw.js';

/* ------------------------------------------------------------------ */
/* Geometry (metres, total length ~0.56 m)                             */
/* ------------------------------------------------------------------ */
const KX = [-0.300, -0.292, -0.270, -0.220, -0.120, -0.010, 0.070, 0.105, 0.125, 0.148, 0.168, 0.180];
const KW = [0.000, 0.024, 0.042, 0.060, 0.073, 0.076, 0.071, 0.063, 0.051, 0.054, 0.047, 0.030];
const KT = [0.000, 0.016, 0.026, 0.035, 0.041, 0.043, 0.040, 0.035, 0.032, 0.035, 0.033, 0.022];
const KB = [0.000, 0.015, 0.024, 0.031, 0.036, 0.037, 0.035, 0.031, 0.029, 0.031, 0.029, 0.019];
function pw(xs, ys, x) {   // smooth piecewise (cosine) interpolation
  if (x <= xs[0]) return ys[0];
  for (let i = 0; i < xs.length - 1; i++) if (x <= xs[i + 1]) { const t = (x - xs[i]) / (xs[i + 1] - xs[i]); return lerp(ys[i], ys[i + 1], (1 - Math.cos(Math.PI * t)) / 2); }
  return ys[ys.length - 1];
}
const X0 = KX[0], X1 = KX[KX.length - 1], LEN = 0.56;

function buildGeometry() {
  const pos = [], uv = [], cut = [], idx = [];
  const vtx = (x, y, z, u, v, c0, c1, c2) => { pos.push(x, y, z); uv.push(u, v); cut.push(c0, c1, c2); return pos.length / 3 - 1; };
  const uOf = x => (x - X0) / LEN;
  // mantle and head: rings of a superellipse, a pole at each end
  const NA = 20, rings = [];
  for (let k = 1; k <= 26; k++) rings.push(X0 + (X1 - X0 - 0.002) * Math.pow(k / 26, 1.15));
  const pR = vtx(X0, 0, 0, 0, 0.5, 0, 0, 0);
  const starts = [];
  for (const x of rings) {
    starts.push(pos.length / 3);
    const w = pw(KX, KW, x), t = pw(KX, KT, x), b = pw(KX, KB, x);
    for (let j = 0; j < NA; j++) {
      const ph = (j / NA) * TAU, c = Math.cos(ph), s = Math.sin(ph);
      const e = 2 / 2.3;
      const y = (c >= 0 ? t : -b) * Math.pow(Math.abs(c), e), z = w * Math.sign(s) * Math.pow(Math.abs(s), e);
      const jj = j <= NA / 2 ? j : NA - j;
      vtx(x, y, z, uOf(x), jj / (NA / 2), 0, 0, 0);
    }
  }
  const pF = vtx(X1 + 0.004, 0, 0, uOf(X1), 0.5, 0, 0, 0);
  for (let j = 0; j < NA; j++) idx.push(pR, starts[0] + (j + 1) % NA, starts[0] + j);
  for (let r = 0; r < rings.length - 1; r++) for (let j = 0; j < NA; j++) {
    const a = starts[r] + j, b = starts[r] + (j + 1) % NA, c = starts[r + 1] + j, d = starts[r + 1] + (j + 1) % NA;
    idx.push(a, b, c, b, d, c);
  }
  const lastR = starts[starts.length - 1];
  for (let j = 0; j < NA; j++) idx.push(pF, lastR + j, lastR + (j + 1) % NA);

  // fin skirt along each side of the mantle (cut = 1, w across 0..1, side); a thin two-faced ribbon
  const FL = 30, FW = 3, fx0 = -0.286, fx1 = 0.098;
  for (const sd of [1, -1]) for (const face of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= FL; i++) {
      const x = lerp(fx0, fx1, i / FL), ta = i / FL;
      const width = 0.036 * Math.pow(Math.sin(Math.PI * clamp(ta * 1.02, 0, 1)), 0.55);
      const z0 = pw(KX, KW, x) * 0.97;
      for (let j = 0; j <= FW; j++) {
        const w = j / FW;
        vtx(x, -0.004 + face * 0.0011 * (1 - w), sd * (z0 + width * w), uOf(x), 0.5, 1, w, sd);
      }
    }
    for (let i = 0; i < FL; i++) for (let j = 0; j < FW; j++) {
      const a = base + i * (FW + 1) + j, b = a + 1, c = a + FW + 1, d = c + 1;
      // the top face (face +1) looks up; mirrored sides flip the order
      if (face * sd > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  // eyes (cut = 3)
  for (const sd of [1, -1]) {
    const cx = 0.147, cy = 0.013, cz = sd * 0.05, R = 0.0165, NU = 10, NV = 7, base = pos.length / 3;
    for (let i = 0; i <= NV; i++) {
      const th = (i / NV) * Math.PI;
      for (let j = 0; j < NU; j++) {
        const ph = (j / NU) * TAU;
        const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
        vtx(cx + nx * R, cy + ny * R * 0.85, cz + nz * R, 0.9, 0.5, 3, nz * sd, ny);
      }
    }
    for (let i = 0; i < NV; i++) for (let j = 0; j < NU; j++) {
      const a = base + i * NU + j, b = base + i * NU + (j + 1) % NU, c = a + NU, d = b + NU;
      idx.push(a, b, c, b, d, c);
    }
  }
  // eight arms in a crown (cut = 2, t along the arm, arm index); the first pair rides highest
  const NR = 5, NS = 7;
  for (let k = 0; k < 8; k++) {
    const th = (k / 8) * TAU + Math.PI / 8;
    const bx = 0.172, by = -0.004 + Math.cos(th) * 0.02, bz = Math.sin(th) * 0.024;
    const L = 0.1 + 0.025 * Math.abs(Math.cos(th));
    const dir = new THREE.Vector3(1, Math.cos(th) * 0.32 + (Math.cos(th) > 0.5 ? 0.18 : 0), Math.sin(th) * 0.18).normalize();
    const side = new THREE.Vector3(0, 1, 0).cross(dir).normalize(), up2 = new THREE.Vector3().crossVectors(dir, side).normalize();
    const base = pos.length / 3;
    for (let i = 0; i <= NS; i++) {
      const t = i / NS, r = lerp(0.0085, 0.0016, Math.pow(t, 0.8));
      // converge toward the crown's axis and curl slightly
      const cx = bx + dir.x * L * t, cy = by + dir.y * L * t - Math.cos(th) * 0.012 * t * t, cz = bz + dir.z * L * t - Math.sin(th) * 0.012 * t * t;
      for (let j = 0; j < NR; j++) {
        const a = (j / NR) * TAU;
        const ox = side.x * Math.cos(a) + up2.x * Math.sin(a), oy = side.y * Math.cos(a) + up2.y * Math.sin(a), oz = side.z * Math.cos(a) + up2.z * Math.sin(a);
        vtx(cx + ox * r, cy + oy * r, cz + oz * r, 0.86 + 0.14 * t, 0.2 + 0.6 * (j / NR), 2, t, k);
      }
    }
    const tip = vtx(bx + dir.x * L * 1.06, by + dir.y * L * 1.06 - Math.cos(th) * 0.013, bz + dir.z * L * 1.06 - Math.sin(th) * 0.013, 1, 0.5, 2, 1.05, k);
    for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) {
      const a = base + i * NR + j, b = base + i * NR + (j + 1) % NR, c = a + NR, d = b + NR;
      idx.push(a, b, c, b, d, c);
    }
    const lr = base + NS * NR;
    for (let j = 0; j < NR; j++) idx.push(lr + j, lr + (j + 1) % NR, tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aCut', new THREE.Float32BufferAttribute(cut, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(-0.05, 0, 0), 0.36);
  return g;
}

/* ------------------------------------------------------------------ */
/* Skin                                                                */
/* ------------------------------------------------------------------ */
const CUT_V = /* glsl */`
uniform float uCuFin, uCuFinAmp, uCuArms;
attribute vec3 aCut;
varying vec3 vCut;
varying vec2 vCuUv;
`;
const CUT_F = /* glsl */`
uniform float uCuClouds, uCuCloudPh, uCuDark, uCuPale, uCuZebra, uCuSeed;
varying vec3 vCut;
varying vec2 vCuUv;
vec3 cuttleColor(){
  float u = vCuUv.x, v = vCuUv.y;          // u: 0 tail .. 1 arm tips; v: 0 dorsal midline .. 1 belly
  float dors = 1.0 - smoothstep(0.35, 0.72, v);
  // mottled camouflage, coarse (it is small on screen): the fine octave fades out under ~3 px
  float aa = 1.0 - smoothstep(0.08, 0.16, fwidth(u) * 12.0);
  float m = vnoise(vec2(u * 7.0, v * 3.0) + uCuSeed) * 0.65 + (vnoise(vec2(u * 13.0, v * 6.0) + uCuSeed * 1.7) - 0.5) * 0.35 * aa + 0.175 * (1.0 - aa);
  // (linear colours: a dark brown to a sandy tan mottle, cream spots)
  vec3 col = mix(vec3(0.075, 0.048, 0.026), vec3(0.3, 0.22, 0.12), smoothstep(0.3, 0.72, m));
  col = mix(col, vec3(0.5, 0.46, 0.37), smoothstep(0.7, 0.8, vnoise(vec2(u * 9.0, v * 4.0) + uCuSeed * 2.3 + 5.0)) * 0.75);
  // passing clouds: dark bands that flow from the tail toward the head
  float band = smoothstep(0.15, 0.85, sin(u * 14.0 - uCuCloudPh + v * 1.5));
  col = mix(col, vec3(0.018, 0.012, 0.008), band * uCuClouds * dors * 0.85);
  // zebra display: bold transverse stripes on the back
  float zb = smoothstep(-0.35, 0.35, sin(u * 30.0 + sin(v * 8.0) * 1.2));
  col = mix(col, mix(vec3(0.012, 0.01, 0.008), vec3(0.55, 0.52, 0.45), zb), uCuZebra * dors * 0.85);
  col *= 1.0 - 0.62 * uCuDark;
  col = mix(col, vec3(0.42, 0.39, 0.32), uCuPale * 0.7);
  col = mix(col, vec3(0.44, 0.41, 0.34), smoothstep(0.6, 0.86, v) * 0.8);   // paler underside
  if (vCut.x > 0.5 && vCut.x < 1.5) col = mix(col * 0.85 + 0.03, vec3(0.6, 0.62, 0.58), smoothstep(0.6, 0.95, vCut.y) * 0.75);   // fin: pale edge
  else if (vCut.x > 2.5) {                  // eye: golden iris facing out, a dark curved slit pupil
    float e = vCut.y, ey = vCut.z;
    col = mix(vec3(0.02, 0.018, 0.015), vec3(0.42, 0.3, 0.08), smoothstep(0.3, 0.55, e));
    col = mix(col, vec3(0.02), smoothstep(0.62, 0.74, e) * smoothstep(0.3, 0.16, abs(ey + 0.12 * (1.0 - e) - 0.04)));
  } else if (vCut.x > 1.5) col = mix(col, col * 0.8 + vec3(0.02, 0.015, 0.01), 0.5);
  return col;
}
`;

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export class Cuttlefish {
  /** ctx: { W, rng, floorAt, home: Vector3 (a spot on the reef), seed } */
  constructor({ W, rng, floorAt, home, seed = 1 }) {
    this.rng = rng;
    this.floorAt = floorAt;
    this.home = home.clone();
    this.u = {
      uCuFin: { value: 0 }, uCuFinAmp: { value: 1 }, uCuArms: { value: 0 },
      uCuClouds: { value: 0 }, uCuCloudPh: { value: 0 }, uCuDark: { value: 0 }, uCuPale: { value: 0 }, uCuZebra: { value: 0 }, uCuSeed: { value: (seed % 97) * 0.731 },
    };
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0, envMapIntensity: 0.6 });
    patchMaterial(mat, {
      key: 'cuttle',
      uniforms: { ...W, ...this.u },
      vertexHeader: UW_VERT + CUT_V,
      fragmentHeader: UW_FRAG + NOISE_GLSL + CUT_F,
      vertex: {
        '#include <begin_vertex>': /* glsl */`$&
          vCut = aCut; vCuUv = uv;
          if (aCut.x > 0.5 && aCut.x < 1.5) {
            // fin skirt: a wave running from the tail to the head, growing toward the edge
            float fu = (position.x + 0.29) / 0.39;
            transformed.y += sin(uCuFin - fu * 15.0) * 0.011 * uCuFinAmp * aCut.y * (0.4 + 0.6 * sin(3.1416 * clamp(fu, 0.0, 1.0)));
          } else if (aCut.x > 1.5 && aCut.x < 2.5) {
            // arms: slow searching curls, raised and spread in alarm
            float t = aCut.y, k = aCut.z;
            transformed.y += (sin(uTimeS * 1.1 + k * 0.9 + t * 2.5) * 0.008 + uCuArms * 0.05 * (k < 1.5 || k > 6.5 ? 1.0 : 0.35)) * t * t;
            transformed.z += cos(uTimeS * 0.9 + k * 1.3 + t * 2.0) * 0.006 * t * t;
          }`,
      },
      fragment: { '#include <color_fragment>': '$&\ndiffuseColor.rgb = cuttleColor();' },
    });
    waterize(mat, W, { key: 'cuttle', rim: 1.0 });
    this.mat = mat;
    this.geo = buildGeometry();
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.name = 'cuttlefish';
    this.mesh.scale.setScalar(1.2);   // a big broadclub: ~0.65 m with its arms
    this.mesh.castShadow = false;
    this.mesh.frustumCulled = true;
    this.pos = home.clone();
    this.pos.y = floorAt(home.x, home.z) + 1.1;
    const a = rng.range(0, TAU);
    this.fwd = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    this.quat = new THREE.Quaternion();
    this.target = this.pos.clone();
    this.speed = 0;
    this.state = 'hover'; this.timer = rng.range(2, 5);
    this.fin = rng.range(0, TAU); this.cloudPh = 0; this.roll = 0;
    this.huntT = rng.range(10, 25); this.huntOn = 0;
    this.d = { clouds: 0, dark: 0, pale: 0, zebra: 0, arms: 0 };
    this.zebraT = 0;
  }

  pickSpot() {
    const r = this.rng, a = r.range(0, TAU), rr = r.range(0.4, 2.6);
    const x = this.home.x + Math.cos(a) * rr, z = this.home.z + Math.sin(a) * rr;
    this.target.set(x, this.floorAt(x, z) + r.range(0.7, 1.5), z);
  }

  /** ctx: { night, giant (state), food (Food), camera } */
  update(dt, time, ctx) {
    const r = this.rng, g = ctx.giant, food = ctx.food;
    // what is going on around it
    let alarm = 0;
    if (g && g.on) {
      const bx = g.head.x - g.tail.x, by = g.head.y - g.tail.y, bz = g.head.z - g.tail.z;
      const px = this.pos.x - g.tail.x, py = this.pos.y - g.tail.y, pz = this.pos.z - g.tail.z;
      const u = clamp((px * bx + py * by + pz * bz) / Math.max(bx * bx + by * by + bz * bz, 1e-6), 0, 1);
      alarm = smoothstep(16, 9, Math.hypot(px - bx * u, py - by * u, pz - bz * u)) * g.vis;
    }
    let seen = null;
    if (food && food.active) {
      let bd = 36;
      for (const it of food.items) { if (!it.alive) continue; const d = it.pos.distanceToSquared(this.home); if (d < bd) { bd = d; seen = it; } }
    }
    const night = ctx.night;
    this.timer -= dt;
    if (night > 0.6) {
      if (this.state !== 'rest') { this.state = 'rest'; this.target.set(this.home.x, this.floorAt(this.home.x, this.home.z) + 0.32, this.home.z); }
    } else if (alarm > 0.2) {
      if (this.state !== 'alarm') { this.state = 'alarm'; this.target.set(this.home.x, this.floorAt(this.home.x, this.home.z) + 0.38, this.home.z); }
      this.timer = 4;
    } else if (seen) {
      this.state = 'watch';
      _v.subVectors(this.pos, seen.pos); _v.y = 0;
      const l = _v.length() || 1;
      this.target.copy(seen.pos).addScaledVector(_v, 1.3 / l);
      this.target.y = Math.max(seen.pos.y + 0.15, this.floorAt(this.target.x, this.target.z) + 0.5);
    } else if (this.state === 'rest' || this.state === 'alarm' || this.state === 'watch') {
      if (this.timer <= 0) { this.state = 'drift'; this.pickSpot(); this.timer = r.range(8, 14); }
    } else if (this.timer <= 0) {
      if (this.state === 'drift') { this.state = 'hover'; this.timer = r.range(5, 13); }
      else { this.state = 'drift'; this.pickSpot(); this.timer = r.range(8, 14); }
    }
    // steering: the body turns toward where it goes (yaw and pitch at capped rates) and swims along its
    // heading, so it never slides; it slows to a hover near the target and turns to face what it watches
    _v.subVectors(this.target, this.pos);
    const dist = _v.length();
    const moving = this.state === 'drift' || this.state === 'watch' || this.state === 'alarm' || this.state === 'rest';
    const maxS = this.state === 'alarm' ? 0.32 : this.state === 'watch' ? 0.22 : this.state === 'rest' ? 0.12 : 0.15;
    let want = moving ? maxS * smoothstep(0.12, 0.9, dist) : 0;
    const yaw0 = Math.atan2(this.fwd.z, this.fwd.x), pit0 = Math.asin(clamp(this.fwd.y, -1, 1));
    let yawT = yaw0, pitT = 0;
    if (dist > 0.05 && want > 0.005) { yawT = Math.atan2(_v.z, _v.x); pitT = clamp(Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.45, 0.45); }
    else {
      // hovering: face the food it watches, else the reef's open side, slowly
      const look = this.state === 'watch' && seen ? seen.pos : ctx.camera.position;
      _w.subVectors(look, this.pos);
      yawT = Math.atan2(_w.z, _w.x);
    }
    const dy = angleDelta(yaw0, yawT), k = 1 - Math.exp(-1.6 * dt);
    const yaw = yaw0 + clamp(dy * k, -0.55 * dt, 0.55 * dt);
    const pit = pit0 + clamp((pitT - pit0) * k, -0.35 * dt, 0.35 * dt);
    this.fwd.set(Math.cos(pit) * Math.cos(yaw), Math.sin(pit), Math.cos(pit) * Math.sin(yaw));
    // swim slower while still turning toward the target
    if (want > 0) want *= smoothstep(-0.2, 0.8, Math.cos(dy));
    this.speed = damp(this.speed, want, 1.4, dt);
    this.pos.addScaledVector(this.fwd, this.speed * dt);
    const fl = this.floorAt(this.pos.x, this.pos.z) + 0.24;
    if (this.pos.y < fl) this.pos.y = damp(this.pos.y, fl, 4, dt);
    const yawRate = angleDelta(yaw0, yaw) / Math.max(dt, 1e-4);
    this.roll = damp(this.roll, clamp(-yawRate * 0.5, -0.25, 0.25), 2, dt);
    quatFromForward(this.quat, this.fwd, this.roll);
    this.mesh.position.copy(this.pos);
    this.mesh.position.y += Math.sin(time * 0.7 + this.u.uCuSeed.value) * 0.015 * (1 - night * 0.7);
    this.mesh.quaternion.copy(this.quat);
    // fins: a calm ripple, faster when it swims; slow at rest
    this.fin = (this.fin + dt * (night > 0.6 ? 2.2 : 3.4 + this.speed * 22)) % TAU;
    this.u.uCuFin.value = this.fin;
    this.u.uCuFinAmp.value = lerp(1.0, 0.45, smoothstep(0.3, 0.9, night));
    // skin: hunting episodes (passing clouds) now and then by day, a rare zebra display while hovering
    this.huntT -= dt;
    if (this.huntT <= 0) { this.huntOn = this.huntOn ? 0 : 1; this.huntT = this.huntOn ? r.range(6, 11) : r.range(14, 32); }
    if (this.state === 'hover' && this.zebraT <= 0 && r.next() < dt * 0.012) this.zebraT = r.range(4, 7);
    this.zebraT -= dt;
    const day = 1 - smoothstep(0.3, 0.8, night);
    const tg = {
      clouds: (this.state === 'watch' ? 1 : this.huntOn * 0.85) * day * (1 - alarm),
      dark: Math.max(alarm * 0.75, smoothstep(0.4, 0.9, night) * 0.35),
      pale: smoothstep(0.4, 0.9, night) * 0.15,
      zebra: this.zebraT > 0 ? day * (1 - alarm) : 0,
      arms: alarm,
    };
    for (const n in tg) this.d[n] = damp(this.d[n], tg[n], 1.3, dt);
    this.cloudPh = (this.cloudPh + dt * 5.2) % TAU;
    this.u.uCuClouds.value = this.d.clouds;
    this.u.uCuCloudPh.value = this.cloudPh;
    this.u.uCuDark.value = this.d.dark;
    this.u.uCuPale.value = this.d.pale;
    this.u.uCuZebra.value = this.d.zebra;
    this.u.uCuArms.value = this.d.arms;
  }

  dispose() { this.geo.dispose(); }
}
