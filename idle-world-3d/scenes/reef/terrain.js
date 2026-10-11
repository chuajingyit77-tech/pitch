// 深蓝 · 珊瑚礁 — seabed: sloping rippled sand, rocks / coral heads with coralline algae, and a
// coarse height map (sand + rocks + coral caps) used for placement, fish avoidance and the camera.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise, clamp, lerp, smoothstep, TAU, canvasTexture, makeRng } from '../../lib/util.js';
import { waterize, addDetail, addFluor } from './uw.js';

const softplus = (v, k = 1) => Math.log1p(Math.exp(v * k)) / k;

export function createGround(seed, surfY) {
  const n = createNoise(seed);
  const height = (x, z) => {
    let y = -1.0 + 0.042 * z;
    y -= softplus(-z - 13, 0.35) * 0.27;           // reef slope dropping into the deep (-z)
    y += softplus(z - 16, 0.3) * 0.07;             // rising toward the shallows (+z)
    y += n.fbm2(x * 0.03, z * 0.03, 3) * 1.15;
    y += n.fbm2(x * 0.11 + 5.2, z * 0.11 - 3.1, 2) * 0.2;
    return Math.min(y, surfY - 3);
  };
  return { height, noise: n };
}

/* ------------------------------------------------------------------ */
/* Sand                                                                */
/* ------------------------------------------------------------------ */
const SAND_GLSL = /* glsl */`
float detailH(vec3 p){
  vec2 x = p.xz;
  float d = length(p - cameraPosition);
  float fade = 1.0 - smoothstep(16.0, 42.0, d);
  vec2 w = vec2(snoise(vec3(x * 0.16, 1.3)), snoise(vec3(x * 0.16 + 9.1, 4.7)));
  float ph = dot(x + w * 1.1, vec2(0.62, 0.78)) * 10.5;
  float r = sin(ph + 0.65 * sin(ph));
  float amp = 0.012 * (0.5 + 0.5 * snoise(vec3(x * 0.08, 2.0)));
  float h = r * amp;
  h += (vnoise(x * 8.0) - 0.5) * 0.004 + (vnoise(x * 27.0) - 0.5) * 0.0014;
  return h * fade;
}
vec3 detailCol(vec3 p, float h, vec3 c){
  vec2 x = p.xz;
  float big = snoise(vec3(x * 0.05, 7.0)) * 0.5 + 0.5;
  float mid = snoise(vec3(x * 0.3, 3.0)) * 0.5 + 0.5;
  c *= 0.8 + 0.34 * big;
  c = mix(c, c * vec3(0.8, 0.86, 0.68), smoothstep(0.55, 0.85, mid) * 0.55);
  c *= 0.9 + h * 10.0;
  return c;
}
`;

function sandTexture(seed) {
  const rng = makeRng(seed);
  const n = createNoise(seed + 3);
  return canvasTexture(512, 512, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = (x / w) * TAU, b = (y / h) * TAU;
      const v = n.fbm3(Math.cos(a) * 2, Math.sin(a) * 2, Math.cos(b) * 2 + Math.sin(b), 3) * 0.5 + 0.5;
      const grain = rng.next();
      let r = 214, gg = 200, bb = 166;
      const k = 0.86 + v * 0.2 + (grain - 0.5) * 0.12;
      r *= k; gg *= k; bb *= k;
      if (grain > 0.985) { r *= 0.55; gg *= 0.55; bb *= 0.6; }          // dark grains
      else if (grain < 0.012) { r = 250; gg = 238; bb = 225; }           // shell bits
      else if (grain < 0.02) { r = 220; gg = 150; bb = 150; }            // pink forams
      const i = (y * w + x) * 4;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = bb; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { repeat: true });
}

export function buildTerrain(ground, W, env, { rings = 130, segs = 180, rMax = 150 } = {}) {
  const NR = Math.round(rings * Math.max(0.6, env.q)), NS = Math.round(segs * Math.max(0.6, env.q));
  const pos = new Float32Array((NR + 1) * NS * 3), nor = new Float32Array((NR + 1) * NS * 3), uv = new Float32Array((NR + 1) * NS * 2);
  const idx = [];
  const e = 0.15;
  for (let i = 0; i <= NR; i++) {
    const r = rMax * Math.pow(i / NR, 2.05);
    for (let j = 0; j < NS; j++) {
      const a = (j / NS) * TAU + (i % 2) * (Math.PI / NS);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const y = ground.height(x, z);
      const k = i * NS + j;
      pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
      const dx = (ground.height(x + e, z) - ground.height(x - e, z)) / (2 * e);
      const dz = (ground.height(x, z + e) - ground.height(x, z - e)) / (2 * e);
      const l = Math.hypot(dx, 1, dz);
      nor[k * 3] = -dx / l; nor[k * 3 + 1] = 1 / l; nor[k * 3 + 2] = -dz / l;
      uv[k * 2] = x / 2.2; uv[k * 2 + 1] = z / 2.2;
    }
  }
  for (let i = 0; i < NR; i++) for (let j = 0; j < NS; j++) {
    const a = i * NS + j, b = i * NS + (j + 1) % NS, c = (i + 1) * NS + j, d = (i + 1) * NS + (j + 1) % NS;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  const tex = sandTexture(env.seed ^ 0x5a5d);
  tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map: tex, color: new THREE.Color('#d2c3a2'), roughness: 0.96, metalness: 0, envMapIntensity: 0.25 });
  waterize(mat, W, { key: 'sand' });
  addDetail(mat, W, { glsl: SAND_GLSL, space: 'world', bump: 1.0, key: 'sand' });
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = 'seabed';
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Rocks                                                               */
/* ------------------------------------------------------------------ */
const ROCK_GLSL = /* glsl */`
float detailH(vec3 p){
  float d = length(p - cameraPosition);
  float fade = 1.0 - smoothstep(14.0, 34.0, d);
  float h = snoise(p * 2.7) * 0.03 + snoise(p * 8.3) * 0.012;
  vec2 c = cell2(p.xz * 5.0 + vec2(p.y * 3.3, -p.y * 2.1));
  h -= smoothstep(0.32, 0.0, c.x) * 0.014;
  h += (vnoise3(p * 31.0) - 0.5) * 0.005;
  return h * fade;
}
vec3 detailCol(vec3 p, float h, vec3 c){
  float m = snoise(p * 1.6) * 0.5 + 0.5;
  c *= 0.72 + 0.5 * m;
  c *= 0.86 + h * 7.0;
  float sp = vnoise3(p * 9.0);
  c = mix(c, vec3(0.66, 0.34, 0.46), smoothstep(0.76, 0.92, sp) * 0.55);
  c = mix(c, vec3(0.78, 0.56, 0.22), smoothstep(0.8, 0.95, vnoise3(p * 6.0 + 3.0)) * 0.45);
  c = mix(c, vec3(0.2, 0.42, 0.5), smoothstep(0.84, 0.97, vnoise3(p * 4.0 + 11.0)) * 0.35);
  return c;
}
`;

function rockTemplate(seed, detail) {
  const n = createNoise(seed);
  const disp = (x, y, z) => {
    let d = 1 + n.fbm3(x * 1.05 + 3.1, y * 1.05, z * 1.05, 3) * 0.44;
    const r = 1 - Math.abs(n.noise3(x * 2.4 + 9, y * 2.4, z * 2.4));
    d += r * r * 0.17;
    d += n.noise3(x * 6.1, y * 6.1 + 2, z * 6.1) * 0.05;
    if (y < -0.15) d *= 1 - (-0.15 - y) * 0.42;
    if (y > 0.55) d *= 1 - (y - 0.55) * 0.35;  // flatter tops for corals to sit on
    return d;
  };
  const TW = 96, TH = 48, table = new Float32Array(TW * TH);
  for (let j = 0; j < TH; j++) for (let i = 0; i < TW; i++) {
    const th = ((j + 0.5) / TH) * Math.PI, ph = (i / TW) * TAU;
    table[j * TW + i] = disp(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
  }
  const sample = (x, y, z) => {
    const th = Math.acos(clamp(y, -1, 1)), ph = (Math.atan2(z, x) + TAU) % TAU;
    const fi = (ph / TAU) * TW, fj = clamp((th / Math.PI) * TH - 0.5, 0, TH - 1.001);
    const i0 = Math.floor(fi) % TW, i1 = (i0 + 1) % TW, j0 = Math.floor(fj), j1 = j0 + 1;
    const ti = fi - Math.floor(fi), tj = fj - j0;
    const a = lerp(table[j0 * TW + i0], table[j0 * TW + i1], ti), b = lerp(table[j1 * TW + i0], table[j1 * TW + i1], ti);
    return lerp(a, b, tj);
  };
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.getAttribute('position');
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    v.multiplyScalar(disp(v.x, v.y, v.z));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  // vertex colours: base stone, ochre crust, coralline algae, turf algae on tops, darker undersides
  const nrm = g.getAttribute('normal');
  const col = new Float32Array(p.count * 3), fl = new Float32Array(p.count);
  const C = hex => new THREE.Color(hex);
  const stone = C('#6a6157'), crust = C('#8e7752'), grey = C('#77736b'), coral1 = C('#b97895'), coral2 = C('#9a6aa6'), turf = C('#6e6c3e'), turf2 = C('#5a6e45');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ny = nrm.getY(i);
    c.copy(stone).lerp(grey, clamp(n.noise3(x * 1.7, y * 1.7, z * 1.7) * 0.5 + 0.5, 0, 1));
    c.lerp(crust, smoothstep(0.1, 0.6, n.noise3(x * 2.3 + 5, y * 2.3, z * 2.3)) * 0.7);
    const ca = n.noise3(x * 1.9 + 11, y * 1.9, z * 1.9 - 4);
    const cor = smoothstep(0.05, 0.45, ca) * (1 - smoothstep(0.55, 0.9, ny));
    c.lerp(n.noise3(x * 3, y * 3, z * 3) > 0 ? coral1 : coral2, cor * 0.85);
    const tf = smoothstep(0.45, 0.85, ny) * smoothstep(-0.3, 0.3, n.noise3(x * 2.2, y * 2.2 + 7, z * 2.2));
    c.lerp(n.noise3(x * 4, y * 4, z * 4 + 2) > 0 ? turf : turf2, tf * 0.75);
    const ao = smoothstep(-0.75, 0.1, ny) * 0.55 + 0.45;
    c.multiplyScalar(ao * (0.9 + 0.2 * n.noise3(x * 8, y * 8, z * 8)));
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    fl[i] = cor * 0.35;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aFluor', new THREE.BufferAttribute(fl, 1));
  g.computeBoundingSphere();
  return { geometry: g, sample };
}

/* ------------------------------------------------------------------ */
/* Height map                                                          */
/* ------------------------------------------------------------------ */
export class HeightMap {
  constructor(ground, half = 26, res = 0.3) {
    this.ground = ground;
    this.half = half; this.res = res;
    this.n = Math.ceil((half * 2) / res) + 1;
    this.h = new Float32Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) this.h[j * this.n + i] = ground.height(-half + i * res, -half + j * res);
  }
  /** Raise cells covered by `inside(x,y,z)` up to the top surface (scan downward from yTop). */
  addSolid(cx, cz, radius, yTop, inside) {
    const { n, res, half } = this;
    const i0 = Math.max(0, Math.floor((cx - radius + half) / res)), i1 = Math.min(n - 1, Math.ceil((cx + radius + half) / res));
    const j0 = Math.max(0, Math.floor((cz - radius + half) / res)), j1 = Math.min(n - 1, Math.ceil((cz + radius + half) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -half + i * res, z = -half + j * res;
      const k = j * n + i, cur = this.h[k];
      if (yTop <= cur) continue;
      let y = yTop, hit = false;
      for (; y > cur; y -= 0.12) if (inside(x, y, z)) { hit = true; break; }
      if (!hit) continue;
      let lo = y, hi = y + 0.12;
      for (let s = 0; s < 6; s++) { const m = (lo + hi) / 2; if (inside(x, m, z)) lo = m; else hi = m; }
      this.h[k] = Math.max(cur, lo);
    }
  }
  /** Raise a disc to at least y (coral caps). */
  addDisc(cx, cz, radius, y) {
    const { n, res, half } = this;
    const i0 = Math.max(0, Math.floor((cx - radius + half) / res)), i1 = Math.min(n - 1, Math.ceil((cx + radius + half) / res));
    const j0 = Math.max(0, Math.floor((cz - radius + half) / res)), j1 = Math.min(n - 1, Math.ceil((cz + radius + half) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -half + i * res, z = -half + j * res;
      const d = Math.hypot(x - cx, z - cz);
      if (d > radius) continue;
      const k = j * n + i;
      this.h[k] = Math.max(this.h[k], y - (d / radius) * (d / radius) * 0.25);
    }
  }
  at(x, z) {
    const { n, res, half } = this;
    const fx = (x + half) / res, fz = (z + half) / res;
    if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return this.ground.height(x, z);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = lerp(this.h[j * n + i], this.h[j * n + i + 1], tx), b = lerp(this.h[(j + 1) * n + i], this.h[(j + 1) * n + i + 1], tx);
    return lerp(a, b, tz);
  }
  normal(x, z, out = new THREE.Vector3(), e = 0.3) {
    const dx = (this.at(x + e, z) - this.at(x - e, z)) / (2 * e), dz = (this.at(x, z + e) - this.at(x, z - e)) / (2 * e);
    return out.set(-dx, 1, -dz).normalize();
  }
}

/**
 * Rock layout: a few coral heads (bommies) built from stacked rocks near the centre, loose rocks
 * across the slope and big silhouettes in the haze.
 */
export function buildRocks(ground, hm, W, env, rng) {
  const detail = env.q >= 0.9 ? 5 : 4;
  const T = [0, 1, 2, 3, 4].map(i => rockTemplate((env.seed ^ (0x9e37 * (i + 1))) >>> 0, detail));
  const farT = rockTemplate((env.seed ^ 0x1234) >>> 0, 3);
  const items = []; // { t, pos, scale, rotY }
  const bommies = [];
  const nB = rng.int(3, 4);
  const angle0 = rng.range(0, TAU);
  for (let b = 0; b < nB; b++) {
    let cx, cz;
    if (b === 0) { cx = rng.range(-1, 1); cz = rng.range(-1, 1); }
    else { const a = angle0 + (b / (nB - 1)) * TAU * 0.92 + rng.range(-0.3, 0.3); const r = rng.range(5.2, 7.2); cx = Math.cos(a) * r; cz = Math.sin(a) * r; }
    const big = b === 0 ? 1.15 : rng.range(0.8, 1.05);
    const sx = rng.range(1.9, 2.5) * big, sy = rng.range(1.5, 1.95) * big, sz = rng.range(1.7, 2.3) * big;
    const gy = ground.height(cx, cz);
    items.push({ t: rng.int(0, 4), pos: new THREE.Vector3(cx, gy - sy * 0.3, cz), scale: new THREE.Vector3(sx, sy, sz), rotY: rng.range(0, TAU) });
    const kids = rng.int(2, 4);
    for (let k = 0; k < kids; k++) {
      const a = rng.range(0, TAU), r = rng.range(0.4, 1.3) * big;
      const kx = cx + Math.cos(a) * r, kz = cz + Math.sin(a) * r;
      const ks = rng.range(0.6, 1.1) * big;
      items.push({ t: rng.int(0, 4), pos: new THREE.Vector3(kx, gy + sy * rng.range(0.4, 0.8), kz), scale: new THREE.Vector3(ks * rng.range(0.9, 1.3), ks * rng.range(0.7, 1.0), ks * rng.range(0.9, 1.3)), rotY: rng.range(0, TAU) });
    }
    bommies.push({ x: cx, z: cz, r: Math.max(sx, sz) * 1.25, main: b === 0 });
  }
  // loose rocks on the slope
  const nLoose = Math.round(16 * Math.max(0.6, env.q));
  for (let i = 0; i < nLoose; i++) {
    let x, z, ok = false;
    for (let tries = 0; tries < 20 && !ok; tries++) {
      const a = rng.range(0, TAU), r = rng.range(3.5, 22);
      x = Math.cos(a) * r; z = Math.sin(a) * r;
      ok = bommies.every(b => Math.hypot(b.x - x, b.z - z) > b.r + 0.8);
    }
    const s = rng.range(0.35, 1.25) * (Math.hypot(x, z) > 12 ? 1.4 : 1);
    items.push({ t: rng.int(0, 4), pos: new THREE.Vector3(x, ground.height(x, z) - s * 0.25, z), scale: new THREE.Vector3(s * rng.range(1, 1.6), s * rng.range(0.6, 1), s * rng.range(1, 1.5)), rotY: rng.range(0, TAU) });
  }
  // big pinnacles in the haze
  const far = [];
  const nFar = Math.round(12 * Math.max(0.6, env.q));
  for (let i = 0; i < nFar; i++) {
    const a = (i / nFar) * TAU + rng.range(-0.2, 0.2), r = rng.range(26, 52);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const s = rng.range(2.5, 5.5);
    far.push({ pos: new THREE.Vector3(x, ground.height(x, z) - s * 0.3, z), scale: new THREE.Vector3(s * rng.range(0.9, 1.5), s * rng.range(1.0, 2.2), s * rng.range(0.9, 1.5)), rotY: rng.range(0, TAU) });
  }

  // height map: rocks are solid
  const insideFn = it => (x, y, z) => {
    const dx = x - it.pos.x, dy = y - it.pos.y, dz = z - it.pos.z;
    const c = Math.cos(it.rotY), s = Math.sin(it.rotY);
    const lx = (dx * c - dz * s) / it.scale.x, lz = (dx * s + dz * c) / it.scale.z, ly = dy / it.scale.y;
    const L = Math.hypot(lx, ly, lz);
    if (L < 1e-5) return true;
    return L < T[it.t].sample(lx / L, ly / L, lz / L);
  };
  for (const it of items) {
    const R = Math.max(it.scale.x, it.scale.z) * 1.65;
    it.inside = insideFn(it);
    hm.addSolid(it.pos.x, it.pos.z, R, it.pos.y + it.scale.y * 1.7, it.inside);
  }

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, envMapIntensity: 0.3 });
  waterize(mat, W, { key: 'rock' });
  addDetail(mat, W, { glsl: ROCK_GLSL, space: 'world', bump: 1.0, key: 'rock' });
  addFluor(mat, W, '#ff6fb0', 0.35, 'rock');
  const group = new THREE.Group();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const meshes = [];
  for (let t = 0; t < T.length; t++) {
    const list = items.filter(it => it.t === t);
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(T[t].geometry, mat, list.length);
    list.forEach((it, i) => { q.setFromEuler(e.set(0, it.rotY, 0)); m4.compose(it.pos, q, it.scale); im.setMatrixAt(i, m4); });
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    group.add(im); meshes.push(im);
  }
  const farMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: 0.3 });
  waterize(farMat, W, { caustics: false, key: 'far' });
  const fim = new THREE.InstancedMesh(farT.geometry, farMat, far.length);
  far.forEach((it, i) => { q.setFromEuler(e.set(0, it.rotY, 0)); m4.compose(it.pos, q, it.scale); fim.setMatrixAt(i, m4); });
  fim.computeBoundingSphere();
  group.add(fim);
  return { group, meshes, items, bommies, far };
}
