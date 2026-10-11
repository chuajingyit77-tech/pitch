// 深蓝 · 珊瑚礁 — the living reef: staghorn thickets, brain corals, table and shelf corals, sea fans,
// soft tree corals, tube sponges, anemones, seagrass and kelp, starfish, urchins and rubble.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise, clamp, lerp, smoothstep, TAU, canvasTexture, makeRng } from '../../lib/util.js';
import { waterize, addDetail, addFluor, addSway } from './uw.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _e = new THREE.Euler(), _n = new THREE.Vector3(), _c = new THREE.Color();
const C = h => new THREE.Color(h);

/** Write per-vertex colour and fluorescence. fn(x, y, z, i) -> [Color, fluor] */
function paint(g, fn) {
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3), fl = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const [c, f] = fn(p.getX(i), p.getY(i), p.getZ(i), i);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; fl[i] = f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aFluor', new THREE.BufferAttribute(fl, 1));
  return g;
}
const strip = g => { g.deleteAttribute('uv'); return g; };
function stdMat(W, opts, { caustics = true, key } = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, envMapIntensity: 0.35, ...opts });
  waterize(m, W, { caustics, key });
  return m;
}
function instanced(geo, mat, list, { shadow = true, receive = true } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  list.forEach((it, i) => {
    im.setMatrixAt(i, _m.compose(it.pos, it.quat, it.scale));
    if (it.color) im.setColorAt(i, it.color);
  });
  im.count = list.length;
  im.castShadow = shadow; im.receiveShadow = receive;
  im.computeBoundingSphere();
  return im;
}
/** Quaternion that stands an object on a surface with normal n (blend toward up), plus spin. */
function standOn(n, spin, upright = 0.5, out = new THREE.Quaternion()) {
  _n.copy(n).lerp(_up, upright).normalize();
  out.setFromUnitVectors(_up, _n);
  _q2.setFromAxisAngle(_up, spin);
  return out.multiply(_q2);
}

/* ------------------------------------------------------------------ */
/* Geometry builders                                                   */
/* ------------------------------------------------------------------ */
function staghornGeo(rng, base, tip, maxD = 4) {
  const segs = [], tips = [];
  const grow = (a, dir, len, r, d) => {
    const b = a.clone().addScaledVector(dir, len);
    segs.push({ a, b, r0: r, r1: r * 0.84, d });
    if (d >= maxD || r < 0.012) { tips.push({ p: b, r: r * 0.86 }); return; }
    const nk = rng.chance(0.3) ? 3 : 2;
    for (let k = 0; k < nk; k++) {
      const axis = rng.onSphere(new THREE.Vector3()).cross(dir).normalize();
      const ang = k === 0 ? rng.range(0.05, 0.25) : rng.range(0.45, 0.9);
      const nd = dir.clone().applyAxisAngle(axis, ang);
      nd.y += 0.2; nd.normalize();
      grow(b, nd, len * rng.range(0.74, 0.92), r * 0.79, d + 1);
    }
  };
  const trunks = rng.int(6, 9);
  for (let t = 0; t < trunks; t++) {
    const a = (t / trunks) * TAU + rng.range(-0.4, 0.4);
    const sp = rng.range(0.35, 1.0);
    const dir = new THREE.Vector3(Math.cos(a) * sp, 1, Math.sin(a) * sp).normalize();
    grow(new THREE.Vector3(Math.cos(a) * 0.06, -0.06, Math.sin(a) * 0.06), dir, rng.range(0.24, 0.34), rng.range(0.045, 0.06), 0);
  }
  const parts = [];
  const dir = new THREE.Vector3();
  for (const s of segs) {
    dir.subVectors(s.b, s.a); const len = dir.length(); dir.divideScalar(len);
    const e = s.r0 * 0.7;
    const g = new THREE.CylinderGeometry(s.r1, s.r0, len + e, 6, 2, true);
    g.translate(0, (len - e) / 2, 0);
    g.applyQuaternion(_q.setFromUnitVectors(_up, dir));
    g.translate(s.a.x, s.a.y, s.a.z);
    const d0 = s.d;
    paint(strip(g), (x, y, z, i) => {
      const lt = (i / g.getAttribute('position').count);
      const t = clamp((d0 + 0.5) / (maxD + 1), 0, 1);
      return [_c.copy(base).lerp(tip, Math.pow(t, 1.6)).clone(), Math.pow(t, 2) * 0.6];
    });
    parts.push(g);
  }
  for (const tp of tips) {
    const g = new THREE.SphereGeometry(tp.r * 1.08, 6, 4);
    g.translate(tp.p.x, tp.p.y, tp.p.z);
    paint(strip(g), () => [tip, 1]);
    parts.push(g);
  }
  const g = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  g.computeBoundingSphere();
  return g;
}

function brainGeo(seed) {
  const g = strip(new THREE.SphereGeometry(1, 72, 32, 0, TAU, 0, Math.PI * 0.62));
  const n = createNoise(seed);
  const p = g.getAttribute('position'), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + n.noise3(v.x * 1.4, v.y * 1.4, v.z * 1.4) * 0.07;
    p.setXYZ(i, v.x * k, (v.y * 0.8 - 0.06) * k, v.z * k);
  }
  g.computeVertexNormals();
  paint(g, (x, y) => [C('#ffffff'), 0.7]);
  return g;
}

/** Plate coral: a slightly cupped, uneven disc with a rim, optionally on a stalk. */
function tableGeo(seed, { stalk = true, NS = 56, NR = 9, top = '#7a6c44', rim = '#c9b98a', under = '#45392a' } = {}) {
  const n = createNoise(seed);
  const R = [];
  for (let k = 0; k <= NS; k++) { const a = (k / NS) * TAU; R.push(1 + n.noise2(Math.cos(a) * 1.3, Math.sin(a) * 1.3) * 0.13 + n.noise2(Math.cos(a) * 4, Math.sin(a) * 4) * 0.04); }
  const pos = [], col = [], fl = [], idx = [];
  const cTop = C(top), cRim = C(rim), cUnder = C(under);
  const surf = (j, k, under) => {
    const a = (k / NS) * TAU, rr = (j / NR) * R[k];
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    let y = 0.07 * rr * rr + n.noise2(x * 2.2, z * 2.2) * 0.025;
    if (under) y -= 0.075 * (1 - rr * 0.75) + 0.018;
    return [x, y, z, rr];
  };
  for (const under of [false, true]) {
    const base = pos.length / 3;
    for (let j = 0; j <= NR; j++) for (let k = 0; k <= NS; k++) {
      const [x, y, z, rr] = surf(j, k, under);
      pos.push(x, y, z);
      const t = j / NR;
      _c.copy(under ? cUnder : cTop).lerp(cRim, under ? smoothstep(0.85, 1, t) * 0.6 : smoothstep(0.55, 1, t));
      col.push(_c.r, _c.g, _c.b); fl.push(under ? 0 : smoothstep(0.6, 1, t));
    }
    for (let j = 0; j < NR; j++) for (let k = 0; k < NS; k++) {
      const a = base + j * (NS + 1) + k, b = a + 1, c = a + NS + 1, d = c + 1;
      if (!under) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  // rim band
  const off = (NR + 1) * (NS + 1);
  for (let k = 0; k < NS; k++) {
    const a = NR * (NS + 1) + k, b = a + 1, c = off + NR * (NS + 1) + k, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aFluor', new THREE.Float32BufferAttribute(fl, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (stalk) {
    const s = strip(new THREE.CylinderGeometry(0.13, 0.2, 0.7, 10, 3, false));
    const sp = s.getAttribute('position');
    for (let i = 0; i < sp.count; i++) { const y = sp.getY(i); const k = 1 + smoothstep(0.1, 0.35, y) * 0.8; sp.setX(i, sp.getX(i) * k); sp.setZ(i, sp.getZ(i) * k); }
    s.translate(0, -0.33, 0);
    s.computeVertexNormals();
    paint(s, () => [cUnder, 0]);
    g = mergeGeometries([g, s]);
  }
  g.computeBoundingSphere();
  return g;
}

function fanTexture(seed) {
  const rng = makeRng(seed);
  return canvasTexture(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const pts = [];
    const inFan = (x, y) => { const dx = (x - w / 2) / (w * 0.48), dy = (h - 8 - y) / (h * 0.92); return dy > 0 && dx * dx + (dy - 0.45) * (dy - 0.45) / 0.3 < 1 && dx * dx + dy * dy < 1; };
    const br = (x, y, ang, len, wid, d) => {
      let cx = x, cy = y, a = ang;
      const steps = 5;
      for (let s = 0; s < steps; s++) {
        a += rng.range(-0.1, 0.1);
        const nx = cx + (Math.cos(a) * len) / steps, ny = cy - (Math.sin(a) * len) / steps;
        if (!inFan(nx, ny)) return;
        const ww = wid * (1 - (s / steps) * 0.2);
        g.lineWidth = ww;
        const shade = Math.round(lerp(185, 255, clamp(d / 7, 0, 1)));
        g.strokeStyle = `rgb(${shade},${shade},${shade})`;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(nx, ny); g.stroke();
        cx = nx; cy = ny;
        pts.push([cx, cy, ww]);
      }
      if (d < 8 && len > 6) {
        const spread = rng.range(0.22, 0.5);
        br(cx, cy, a + spread, len * rng.range(0.74, 0.9), Math.max(1.2, wid * 0.72), d + 1);
        br(cx, cy, a - spread, len * rng.range(0.74, 0.9), Math.max(1.2, wid * 0.72), d + 1);
      }
    };
    br(w / 2, h - 4, Math.PI / 2 + rng.range(-0.1, 0.1), h * 0.2, 11, 0);
    br(w / 2, h - 30, Math.PI / 2 + 0.55, h * 0.18, 7, 1);
    br(w / 2, h - 30, Math.PI / 2 - 0.55, h * 0.18, 7, 1);
    // anastomosing mesh between neighbouring twigs
    g.strokeStyle = 'rgb(235,235,235)';
    for (let i = 0; i < pts.length; i += 1) {
      const [x, y] = pts[i];
      let best = -1, bd = 1e9, best2 = -1, bd2 = 1e9;
      for (let j = 0; j < pts.length; j++) {
        if (Math.abs(i - j) < 3) continue;
        const d = (pts[j][0] - x) ** 2 + (pts[j][1] - y) ** 2;
        if (d < bd) { bd2 = bd; best2 = best; bd = d; best = j; } else if (d < bd2) { bd2 = d; best2 = j; }
      }
      for (const [b, dd] of [[best, bd], [best2, bd2]]) {
        if (b < 0 || dd > 26 * 26) continue;
        g.lineWidth = 1.3;
        g.beginPath(); g.moveTo(x, y); g.lineTo(pts[b][0], pts[b][1]); g.stroke();
      }
    }
  }, { srgb: true });
}

function anemoneTentacleGeo(len = 0.3) {
  const g = strip(new THREE.CylinderGeometry(0.014, 0.026, len, 6, 6, true));
  g.translate(0, len / 2, 0);
  const tipG = strip(new THREE.SphereGeometry(0.02, 6, 4));
  tipG.translate(0, len, 0);
  const merged = mergeGeometries([g, tipG]);
  g.dispose(); tipG.dispose();
  // gentle curl so a bunch looks soft
  const p = merged.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.pow(y / len, 2) * 0.05); }
  merged.computeVertexNormals();
  return merged;
}

function softCoralGeo(rng, stem, blossom) {
  const parts = [];
  const trunkH = rng.range(0.32, 0.5);
  const tr = strip(new THREE.CylinderGeometry(0.045, 0.085, trunkH, 8, 3, false));
  tr.translate(0, trunkH / 2, 0);
  paint(tr, () => [stem, 0.1]);
  parts.push(tr);
  const nb = rng.int(5, 8);
  for (let b = 0; b < nb; b++) {
    const a = (b / nb) * TAU + rng.range(-0.3, 0.3);
    const h0 = trunkH * rng.range(0.5, 0.95);
    const dir = new THREE.Vector3(Math.cos(a) * rng.range(0.6, 1.1), rng.range(0.7, 1.2), Math.sin(a) * rng.range(0.6, 1.1)).normalize();
    const L = rng.range(0.16, 0.3);
    const br = strip(new THREE.CylinderGeometry(0.014, 0.026, L, 6, 1, true));
    br.translate(0, L / 2, 0);
    br.applyQuaternion(_q.setFromUnitVectors(_up, dir));
    br.translate(0, h0, 0);
    paint(br, () => [stem, 0.1]);
    parts.push(br);
    const end = new THREE.Vector3(0, h0, 0).addScaledVector(dir, L);
    const nc = rng.int(11, 17);
    for (let k = 0; k < nc; k++) {
      const r = rng.range(0.035, 0.062);
      const sp = strip(new THREE.SphereGeometry(r, 7, 5));
      const o = rng.onSphere(new THREE.Vector3()).multiplyScalar(rng.range(0.02, 0.1));
      o.y = Math.abs(o.y) * 0.8;
      sp.translate(end.x + o.x, end.y + o.y, end.z + o.z);
      const cc = blossom.clone().offsetHSL(rng.range(-0.02, 0.02), 0, rng.range(-0.08, 0.06));
      paint(sp, () => [cc, 0.8]);
      parts.push(sp);
    }
  }
  const g = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function spongeGeo(rng, color) {
  const parts = [];
  const n = rng.int(3, 6);
  for (let i = 0; i < n; i++) {
    const h = rng.range(0.35, 0.85), r = rng.range(0.06, 0.1);
    const g = strip(new THREE.CylinderGeometry(r * 1.25, r * 0.85, h, 14, 4, true));
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) { const y = p.getY(k) / h + 0.5; const fl = 1 + smoothstep(0.75, 1, y) * 0.25; p.setX(k, p.getX(k) * fl); p.setZ(k, p.getZ(k) * fl); }
    g.translate(0, h / 2 - 0.04, 0);
    const a = (i / n) * TAU + rng.range(-0.4, 0.4), off = i === 0 ? 0 : rng.range(0.08, 0.16);
    g.applyQuaternion(_q.setFromEuler(_e.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18)));
    g.translate(Math.cos(a) * off, 0, Math.sin(a) * off);
    g.computeVertexNormals();
    const cc = color.clone().offsetHSL(0, 0, rng.range(-0.06, 0.06));
    paint(g, (x, y) => [_c.copy(cc).multiplyScalar(lerp(0.65, 1.1, clamp(y / h, 0, 1))).clone(), 0.3]);
    parts.push(g);
  }
  const g = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  g.computeBoundingSphere();
  return g;
}

function starGeo() {
  const shape = new THREE.Shape();
  const N = 5, R = 1, r = 0.34, S = 80;
  for (let i = 0; i <= S; i++) {
    const a = (i / S) * TAU + Math.PI / 2;
    const k = Math.cos(a * N - Math.PI * N / 2) * 0.5 + 0.5;
    const rad = r + (R - r) * Math.pow(k, 2.4);
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.11, bevelSize: 0.1, bevelSegments: 3, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.1, 0);
  strip(g);
  // squash the arms so they hug the ground
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const rr = Math.hypot(p.getX(i), p.getZ(i)); p.setY(i, p.getY(i) * (1 - rr * 0.55)); }
  g.computeVertexNormals();
  paint(g, () => [C('#ffffff'), 0.4]);
  return g;
}

function kelpTexture(seed) {
  const rng = makeRng(seed);
  return canvasTexture(128, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgb(120,96,40)';
    g.fillRect(w / 2 - 3, 0, 6, h);
    for (let y = h - 20; y > 10; y -= rng.range(26, 40)) {
      const side = rng.chance(0.5) ? 1 : -1;
      const L = rng.range(40, 58), Wd = rng.range(9, 14);
      g.save();
      g.translate(w / 2, y);
      g.rotate(side * rng.range(0.5, 0.9) - Math.PI / 2 * 0);
      const grd = g.createLinearGradient(0, 0, side * L, 0);
      grd.addColorStop(0, 'rgb(150,120,45)'); grd.addColorStop(1, 'rgb(200,170,70)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(side * L * 0.5, -Wd, side * L, -4);
      g.quadraticCurveTo(side * L * 0.5, Wd * 0.6, 0, 0);
      g.fill();
      g.fillStyle = 'rgb(170,140,50)';
      g.beginPath(); g.arc(side * 6, -1, 4, 0, TAU); g.fill();
      g.restore();
    }
  }, { srgb: true });
}

/* ------------------------------------------------------------------ */
/* Detail shaders                                                      */
/* ------------------------------------------------------------------ */
const BRAIN_GLSL = /* glsl */`
float detailH(vec3 p){
  vec3 q = p * 2.1;
  q += 0.6 * vec3(snoise(q * 0.45), snoise(q * 0.45 + 11.3), snoise(q * 0.45 + 23.1));
  float n = snoise(q) + 0.22 * snoise(q * 2.1 + 5.0);
  float k = n * 2.3;
  float w = fwidth(k);
  float g = abs(fract(k) - 0.5) * 2.0;
  float ridge = 1.0 - smoothstep(0.35, 0.85, g);
  ridge = mix(ridge, 0.6, smoothstep(0.12, 0.45, w));
  float d = length(vUwPos - cameraPosition);
  return (ridge * 0.022 - 0.011) * (1.0 - smoothstep(12.0, 30.0, d));
}
vec3 detailCol(vec3 p, float h, vec3 c){
  float r = smoothstep(-0.008, 0.01, h);
  vec3 groove = c * vec3(0.5, 0.58, 0.42);
  vec3 ridge = c * 1.1 + vec3(0.02, 0.03, 0.01);
  return mix(groove, ridge, r);
}
`;
const POLYP_GLSL = /* glsl */`
float detailH(vec3 p){
  vec2 c = cell2(p.xz * 26.0 + p.y * 19.0);
  float d = length(vUwPos - cameraPosition);
  return (smoothstep(0.0, 0.45, c.x) * 0.004 - 0.002) * (1.0 - smoothstep(6.0, 18.0, d));
}
vec3 detailCol(vec3 p, float h, vec3 c){ return c * (0.88 + h * 50.0); }
`;
const TABLE_GLSL = /* glsl */`
float detailH(vec3 p){
  float a = atan(p.z, p.x);
  float r = length(p.xz);
  float st = sin(a * 90.0 + snoise(p * 3.0) * 4.0) * 0.5 + 0.5;
  vec2 c = cell2(p.xz * 30.0);
  float d = length(vUwPos - cameraPosition);
  return (st * 0.002 + smoothstep(0.0, 0.4, c.x) * 0.003) * (1.0 - smoothstep(6.0, 20.0, d));
}
vec3 detailCol(vec3 p, float h, vec3 c){ return c * (0.85 + h * 50.0); }
`;
const STAR_GLSL = /* glsl */`
float detailH(vec3 p){
  vec2 c = cell2(p.xz * 9.0 + p.y * 3.0);
  return (1.0 - smoothstep(0.0, 0.3, c.x)) * 0.05;
}
vec3 detailCol(vec3 p, float h, vec3 c){ return mix(c, c * 1.35 + 0.05, h * 15.0); }
`;
const SPONGE_GLSL = /* glsl */`
float detailH(vec3 p){
  vec2 c = cell2(vec2(atan(p.z, p.x) * 6.0, p.y * 30.0));
  return -smoothstep(0.25, 0.0, c.x) * 0.004 + (vnoise3(p * 40.0) - 0.5) * 0.002;
}
vec3 detailCol(vec3 p, float h, vec3 c){ return c * (1.0 + h * 60.0); }
`;

/* ------------------------------------------------------------------ */
/* Reef assembly                                                       */
/* ------------------------------------------------------------------ */
export function buildReef(ctx) {
  const { W, env, hm, ground, rocks, rng } = ctx;
  const q = Math.max(0.5, env.q);
  const group = new THREE.Group();
  const occupied = []; // {x, z, r}
  const free = (x, z, r) => occupied.every(o => Math.hypot(o.x - x, o.z - z) > (o.r + r) * 0.8);
  const occupy = (x, z, r) => occupied.push({ x, z, r });
  const curDir = W.uCurDir.value;

  // candidate spots on the coral heads
  const spots = [];
  for (const b of rocks.bommies) {
    for (let i = 0; i < 90; i++) {
      const a = rng.range(0, TAU), r = Math.sqrt(rng.next()) * b.r * 0.95;
      const x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
      const y = hm.at(x, z), gy = ground.height(x, z);
      if (y < gy + 0.25) continue;
      const n = hm.normal(x, z, new THREE.Vector3());
      spots.push({ x, y, z, n, h: y - gy, b });
    }
  }
  spots.sort((a, b) => b.h - a.h);
  const sandSpot = (rMin, rMax, near = null) => {
    for (let t = 0; t < 30; t++) {
      let x, z;
      if (near) { const a = rng.range(0, TAU), r = near.r + rng.range(rMin, rMax); x = near.x + Math.cos(a) * r; z = near.z + Math.sin(a) * r; }
      else { const a = rng.range(0, TAU), r = rng.range(rMin, rMax); x = Math.cos(a) * r; z = Math.sin(a) * r; }
      const y = hm.at(x, z), gy = ground.height(x, z);
      if (y > gy + 0.08) continue;
      return { x, y: gy, z, n: hm.normal(x, z, new THREE.Vector3()) };
    }
    return null;
  };
  const takeSpot = (pred, r) => {
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      if (!pred(s) || !free(s.x, s.z, r)) continue;
      spots.splice(i, 1);
      return s;
    }
    return null;
  };

  /* ---- anemones (clownfish homes) ---- */
  const anemones = [];
  const mainB = rocks.bommies.find(b => b.main) || rocks.bommies[0];
  for (let k = 0; k < 2; k++) {
    const b = k === 0 ? mainB : rocks.bommies[1 % rocks.bommies.length];
    const s = takeSpot(s => s.b === b && s.n.y > 0.8, 0.7) || takeSpot(s => s.n.y > 0.7, 0.7);
    if (!s) continue;
    occupy(s.x, s.z, 0.75);
    anemones.push({ pos: new THREE.Vector3(s.x, s.y - 0.04, s.z), r: k === 0 ? 0.5 : 0.42, n: s.n.clone() });
  }

  /* ---- table and shelf corals ---- */
  const tableMat = stdMat(W, { vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }, { key: 'table' });
  addDetail(tableMat, W, { glsl: TABLE_GLSL, space: 'object', bump: 1, key: 'table' });
  addFluor(tableMat, W, '#7dff6a', 0.7, 'table');
  const tableG = tableGeo(env.seed ^ 31);
  const shelfG = tableGeo(env.seed ^ 57, { stalk: false, top: '#7b5e78', rim: '#d9b8d8', under: '#4a3448' });
  const tables = [], shelves = [];
  const nTable = Math.round(5 * q);
  for (let i = 0; i < nTable; i++) {
    const s = takeSpot(s => s.n.y > 0.7 && s.h > 0.6, 1.0);
    if (!s) continue;
    const r = rng.range(0.75, 1.25);
    occupy(s.x, s.z, r * 0.8);
    const lift = 0.42 * r;
    tables.push({ pos: new THREE.Vector3(s.x, s.y + lift, s.z), quat: _q.setFromEuler(_e.set(rng.range(-0.08, 0.08), rng.range(0, TAU), rng.range(-0.08, 0.08))).clone(), scale: new THREE.Vector3(r, r * 0.9, r), color: _c.setHSL(0.1, 0.1, rng.range(0.8, 1)).clone() });
    hm.addDisc(s.x, s.z, r, s.y + lift + 0.12);
  }
  const nShelf = Math.round(11 * q);
  for (let i = 0; i < nShelf; i++) {
    const s = takeSpot(s => s.n.y < 0.75 && s.n.y > 0.15 && s.h > 0.5, 0.35);
    if (!s) continue;
    const r = rng.range(0.35, 0.6);
    const out = new THREE.Vector3(s.n.x, 0, s.n.z).normalize();
    const pos = new THREE.Vector3(s.x, s.y - 0.08, s.z).addScaledVector(out, r * 0.45);
    const yaw = Math.atan2(-out.z, out.x);
    shelves.push({ pos, quat: _q.setFromEuler(_e.set(rng.range(-0.1, 0.1), yaw, rng.range(0.05, 0.25))).clone(), scale: new THREE.Vector3(r, r * 0.8, r), color: rng.pick([C('#ffffff'), C('#c8e0c0'), C('#f0d0b0')]) });
  }
  group.add(instanced(tableG, tableMat, tables));
  group.add(instanced(shelfG, tableMat, shelves));

  rng.shuffle(spots);

  /* ---- staghorn thickets ---- */
  const stagPal = [
    [C('#9a6c3c'), C('#f6e2b0')], [C('#6a4a8e'), C('#dcb0ff')], [C('#3f6f98'), C('#86d8ff')], [C('#a85a72'), C('#ffb4cc')], [C('#77803a'), C('#dcf27e')],
  ];
  const stagGeos = stagPal.map(([b, t], i) => staghornGeo(rng.fork('stag' + i), b, t));
  const stagMat = stdMat(W, { vertexColors: true, roughness: 0.72 }, { key: 'stag' });
  addDetail(stagMat, W, { glsl: POLYP_GLSL, space: 'object', bump: 1, key: 'polyp' });
  addFluor(stagMat, W, '#47ffb0', 0.9, 'stag');
  const stagLists = stagGeos.map(() => []);
  const nStag = Math.round(22 * q);
  for (let i = 0; i < nStag; i++) {
    const onRock = i < nStag * 0.6;
    const s = onRock ? takeSpot(s => s.n.y > 0.55, 0.6) : sandSpot(0.2, 2.2, rng.pick(rocks.bommies));
    if (!s || (!onRock && !free(s.x, s.z, 0.6))) continue;
    const sc = rng.range(1.0, 1.6);
    occupy(s.x, s.z, 0.55 * sc);
    const t = rng.int(0, stagGeos.length - 1);
    stagLists[t].push({ pos: new THREE.Vector3(s.x, s.y - 0.04, s.z), quat: standOn(s.n, rng.range(0, TAU), 0.6), scale: new THREE.Vector3(sc, sc * rng.range(0.85, 1.15), sc), color: _c.setHSL(0, 0, rng.range(0.85, 1.05)).clone() });
    hm.addDisc(s.x, s.z, 0.55 * sc, s.y + 0.85 * sc);
  }
  stagGeos.forEach((g, i) => group.add(instanced(g, stagMat, stagLists[i])));

  /* ---- brain corals ---- */
  const brainG = brainGeo(env.seed ^ 77);
  const brainMat = stdMat(W, { vertexColors: true, roughness: 0.8 }, { key: 'brain' });
  addDetail(brainMat, W, { glsl: BRAIN_GLSL, space: 'object', bump: 0.9, key: 'brain' });
  addFluor(brainMat, W, '#3dff8a', 0.55, 'brain');
  const brainCols = [C('#b9a36a'), C('#8fa06a'), C('#c08f72'), C('#a8b08a'), C('#d0b080')];
  const brains = [];
  const nBrain = Math.round(12 * q);
  for (let i = 0; i < nBrain; i++) {
    const onRock = i % 3 === 0;
    const s = onRock ? takeSpot(s => s.n.y > 0.75, 0.6) : sandSpot(0.1, 2.6, rng.pick(rocks.bommies));
    if (!s) continue;
    const r = rng.range(0.38, 0.75);
    if (!onRock && !free(s.x, s.z, r)) continue;
    occupy(s.x, s.z, r);
    brains.push({ pos: new THREE.Vector3(s.x, s.y - 0.05, s.z), quat: standOn(s.n, rng.range(0, TAU), 0.5), scale: new THREE.Vector3(r, r * rng.range(0.75, 1.0), r * rng.range(0.9, 1.1)), color: rng.pick(brainCols).clone() });
    hm.addDisc(s.x, s.z, r, s.y + r * 0.7);
  }
  group.add(instanced(brainG, brainMat, brains));

  /* ---- sea fans (face the surge) ---- */
  const fanTex = fanTexture(env.seed ^ 99);
  const fanMat = new THREE.MeshStandardMaterial({ map: fanTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, envMapIntensity: 0.35 });
  waterize(fanMat, W, { key: 'fan' });
  addSway(fanMat, W, { height: 1.4, amount: 0.12, stiff: 1.4, flutter: 0.015, key: 'fan' });
  const fanG = new THREE.PlaneGeometry(1.5, 1.4, 6, 6);
  fanG.translate(0, 0.68, 0);
  const fans = [];
  const fanCols = [C('#a03cb8'), C('#c94aa8'), C('#8f3fd0'), C('#e0a33a'), C('#d8503a')];
  const nFan = Math.round(15 * q);
  for (let i = 0; i < nFan; i++) {
    const onRock = i % 2 === 0;
    const s = onRock ? takeSpot(s => s.n.y > 0.45, 0.4) : sandSpot(0.0, 2.0, rng.pick(rocks.bommies));
    if (!s || (!onRock && !free(s.x, s.z, 0.4))) continue;
    occupy(s.x, s.z, 0.35);
    const sc = rng.range(0.8, 1.35);
    const yaw = Math.atan2(curDir.x, curDir.y) + rng.range(-0.35, 0.35);
    fans.push({ pos: new THREE.Vector3(s.x, s.y - 0.05, s.z), quat: _q.setFromEuler(_e.set(rng.range(-0.12, 0.12), yaw, rng.range(-0.1, 0.1))).clone(), scale: new THREE.Vector3(sc, sc * rng.range(0.85, 1.15), sc), color: i % 4 === 3 ? rng.pick(fanCols.slice(3)) : rng.pick(fanCols.slice(0, 3)) });
  }
  group.add(instanced(fanG, fanMat, fans));

  /* ---- soft tree corals ---- */
  const softMat = stdMat(W, { vertexColors: true, roughness: 0.6 }, { key: 'soft' });
  addSway(softMat, W, { height: 0.6, amount: 0.06, stiff: 1.3, flutter: 0.01, key: 'soft' });
  addFluor(softMat, W, '#ff5aa0', 0.8, 'soft');
  const softDefs = [[C('#f1d6dc'), C('#ff3f7f')], [C('#f3e3d0'), C('#ff7a2a')], [C('#e8d8f0'), C('#b44ae8')], [C('#f6e8d8'), C('#ffcf3a')]];
  const softGeos = softDefs.map(([a, b], i) => softCoralGeo(rng.fork('soft' + i), a, b));
  const softLists = softGeos.map(() => []);
  const nSoft = Math.round(22 * q);
  for (let i = 0; i < nSoft; i++) {
    const s = takeSpot(s => s.n.y > 0.35, 0.3);
    if (!s) continue;
    occupy(s.x, s.z, 0.3);
    const sc = rng.range(1.0, 1.7);
    softLists[i % softGeos.length].push({ pos: new THREE.Vector3(s.x, s.y - 0.04, s.z), quat: standOn(s.n, rng.range(0, TAU), 0.55), scale: new THREE.Vector3(sc, sc, sc) });
  }
  softGeos.forEach((g, i) => group.add(instanced(g, softMat, softLists[i])));

  /* ---- encrusting mound corals (Porites lumps) fill the gaps with colour ---- */
  const moundG = (() => {
    const g = strip(new THREE.SphereGeometry(1, 28, 14, 0, TAU, 0, Math.PI * 0.55));
    const nn = createNoise(env.seed ^ 404), p = g.getAttribute('position'), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const k = 1 + nn.fbm3(v.x * 1.8, v.y * 1.8, v.z * 1.8, 3) * 0.28;
      p.setXYZ(i, v.x * k, (v.y * 0.75 - 0.05) * k, v.z * k);
    }
    g.computeVertexNormals();
    paint(g, (x, y) => [_c.setRGB(1, 1, 1).multiplyScalar(lerp(0.7, 1.05, clamp(y * 1.4, 0, 1))).clone(), 0.5 + y * 0.5]);
    return g;
  })();
  const moundMat = stdMat(W, { vertexColors: true, roughness: 0.7 }, { key: 'mound' });
  addDetail(moundMat, W, { glsl: POLYP_GLSL, space: 'object', bump: 1, key: 'mound' });
  addFluor(moundMat, W, '#36ffd0', 0.7, 'mound');
  const moundCols = [C('#b58cd8'), C('#d9b04a'), C('#8ccf9a'), C('#e8909c'), C('#7fb6e8'), C('#c9d46a'), C('#e09a5a')];
  const mounds = [];
  for (let i = Math.round(56 * q); i > 0; i--) {
    const s = rng.chance(0.75) ? takeSpot(st => st.n.y > 0.2, 0.22) : sandSpot(0.0, 1.0, rng.pick(rocks.bommies));
    if (!s) continue;
    const r = rng.range(0.14, 0.36);
    occupy(s.x, s.z, r * 0.8);
    mounds.push({ pos: new THREE.Vector3(s.x, s.y - r * 0.15, s.z), quat: standOn(s.n, rng.range(0, TAU), 0.25), scale: new THREE.Vector3(r * rng.range(0.9, 1.4), r, r * rng.range(0.9, 1.4)), color: rng.pick(moundCols).clone().offsetHSL(0, 0, rng.range(-0.06, 0.04)) });
  }
  group.add(instanced(moundG, moundMat, mounds));

  /* ---- tube sponges ---- */
  const spongeMat = stdMat(W, { vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }, { key: 'sponge' });
  addDetail(spongeMat, W, { glsl: SPONGE_GLSL, space: 'object', bump: 1, key: 'sponge' });
  const spongeGeos = [spongeGeo(rng.fork('sp1'), C('#8a3fa8')), spongeGeo(rng.fork('sp2'), C('#e08a2c'))];
  const spongeLists = [[], []];
  const nSponge = Math.round(10 * q);
  for (let i = 0; i < nSponge; i++) {
    const s = i % 2 ? takeSpot(s => s.n.y > 0.5, 0.35) : sandSpot(0.0, 1.5, rng.pick(rocks.bommies));
    if (!s || !free(s.x, s.z, 0.3)) continue;
    occupy(s.x, s.z, 0.3);
    const sc = rng.range(0.9, 1.4);
    spongeLists[i % 2].push({ pos: new THREE.Vector3(s.x, s.y - 0.03, s.z), quat: standOn(s.n, rng.range(0, TAU), 0.7), scale: new THREE.Vector3(sc, sc, sc) });
  }
  spongeGeos.forEach((g, i) => group.add(instanced(g, spongeMat, spongeLists[i])));

  /* ---- anemones ---- */
  const tentLen = 0.3;
  const tentG = anemoneTentacleGeo(tentLen);
  paint(tentG, (x, y) => { const t = clamp(y / tentLen, 0, 1); return [_c.copy(C('#d8c79a')).lerp(C('#ff7fb8'), smoothstep(0.55, 1, t)).clone(), smoothstep(0.5, 1, t)]; });
  const tentMat = stdMat(W, { vertexColors: true, roughness: 0.45, envMapIntensity: 0.6 }, { key: 'tent' });
  addSway(tentMat, W, { height: tentLen, amount: 0.07, stiff: 1.5, flutter: 0.045, key: 'tent' });
  addFluor(tentMat, W, '#7dff3a', 1.4, 'tent');
  const tents = [];
  const baseList = [];
  const nT = Math.round(240 * q);
  anemones.forEach((a, ai) => {
    for (let i = 0; i < nT; i++) {
      const r = a.r * Math.sqrt(rng.range(0.03, 1));
      const ang = rng.range(0, TAU);
      const x = a.pos.x + Math.cos(ang) * r, z = a.pos.z + Math.sin(ang) * r;
      const y = a.pos.y + 0.12 + (1 - (r / a.r) ** 2) * 0.05;
      const tilt = 0.12 + 1.0 * (r / a.r) + rng.range(-0.15, 0.15);
      _q.setFromEuler(_e.set(0, -ang, 0));
      _q2.setFromAxisAngle(new THREE.Vector3(0, 0, -1), tilt);
      const quat = _q.clone().multiply(_q2);
      const sc = rng.range(0.75, 1.2);
      tents.push({ pos: new THREE.Vector3(x, y, z), quat, scale: new THREE.Vector3(sc, sc * rng.range(0.85, 1.2), sc) });
    }
    baseList.push({ pos: a.pos.clone(), quat: new THREE.Quaternion(), scale: new THREE.Vector3(a.r * 1.0, 1, a.r * 1.0), color: ai ? C('#c0602a') : C('#8a1f3a') });
  });
  group.add(instanced(tentG, tentMat, tents, { shadow: false }));
  const anBaseG = strip(new THREE.CylinderGeometry(0.62, 0.48, 0.16, 28, 2, false));
  anBaseG.translate(0, 0.06, 0);
  paint(anBaseG, () => [C('#ffffff'), 0.2]);
  const anBaseMat = stdMat(W, { vertexColors: true, roughness: 0.5 }, { key: 'anbase' });
  group.add(instanced(anBaseG, anBaseMat, baseList));

  /* ---- seagrass meadows ---- */
  const bladeG = new THREE.PlaneGeometry(0.05, 1, 1, 6);
  bladeG.translate(0, 0.5, 0);
  { const p = bladeG.getAttribute('position'); for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, y * y * 0.12); p.setX(i, p.getX(i) * (1 - y * 0.5)); } bladeG.computeVertexNormals(); }
  strip(bladeG);
  paint(bladeG, (x, y) => [_c.setRGB(1, 1, 1).multiplyScalar(lerp(0.45, 1.05, y)).clone(), 0]);
  const grassMat = stdMat(W, { vertexColors: true, side: THREE.DoubleSide, roughness: 0.65 }, { key: 'grass' });
  addSway(grassMat, W, { height: 1, amount: 0.32, stiff: 1.5, flutter: 0.03, key: 'grass' });
  const blades = [];
  const nPatch = Math.round(9 * q);
  const grassCols = [C('#7d8a2c'), C('#93a03a'), C('#6a7a2a'), C('#a39a3c')];
  for (let pI = 0; pI < nPatch; pI++) {
    const a = rng.range(0, TAU), r = rng.range(9, 24);
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const pr = rng.range(1.8, 4.2);
    const nb = Math.round(rng.range(180, 380) * q);
    for (let i = 0; i < nb; i++) {
      const ra = rng.range(0, TAU), rr = Math.abs(rng.gauss()) * pr * 0.55;
      const x = cx + Math.cos(ra) * rr, z = cz + Math.sin(ra) * rr;
      if (hm.at(x, z) > ground.height(x, z) + 0.1) continue;
      const h = rng.range(0.35, 0.95) * (1 - clamp(rr / pr, 0, 1) * 0.5);
      blades.push({ pos: new THREE.Vector3(x, ground.height(x, z) - 0.02, z), quat: _q.setFromEuler(_e.set(rng.range(-0.15, 0.15), rng.range(0, TAU), rng.range(-0.15, 0.15))).clone(), scale: new THREE.Vector3(1, h, 1), color: rng.pick(grassCols).clone().offsetHSL(0, 0, rng.range(-0.05, 0.05)) });
    }
  }
  group.add(instanced(bladeG, grassMat, blades, { shadow: false }));

  /* ---- kelp ribbons on the outer slope ---- */
  const kelpTex = kelpTexture(env.seed ^ 5);
  const kelpMat = new THREE.MeshStandardMaterial({ map: kelpTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, envMapIntensity: 0.3 });
  waterize(kelpMat, W, { key: 'kelp' });
  addSway(kelpMat, W, { height: 1, amount: 0.9, stiff: 1.25, flutter: 0.06, key: 'kelp' });
  const kelpG = new THREE.PlaneGeometry(1, 1, 1, 24);
  kelpG.translate(0, 0.5, 0);
  const kelps = [];
  const nClump = Math.round(5 * q);
  for (let c = 0; c < nClump; c++) {
    const a = rng.range(0, TAU), r = rng.range(15, 28);
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    for (let i = rng.int(4, 7); i > 0; i--) {
      const x = cx + rng.range(-1.6, 1.6), z = cz + rng.range(-1.6, 1.6);
      const h = rng.range(4.5, 8.5), w = rng.range(0.45, 0.65);
      const yaw = rng.range(0, TAU);
      for (const extra of [0, Math.PI / 2]) {
        kelps.push({ pos: new THREE.Vector3(x, ground.height(x, z) - 0.1, z), quat: _q.setFromEuler(_e.set(0, yaw + extra, 0)).clone(), scale: new THREE.Vector3(w, h, 1), color: _c.setHSL(0.11, 0.5, rng.range(0.55, 0.75)).clone() });
      }
    }
  }
  group.add(instanced(kelpG, kelpMat, kelps, { shadow: false }));

  /* ---- starfish ---- */
  const starG = starGeo();
  const starMat = stdMat(W, { vertexColors: true, roughness: 0.7 }, { key: 'star' });
  addDetail(starMat, W, { glsl: STAR_GLSL, space: 'object', bump: 0.25, key: 'star' });
  const stars = [];
  const starCols = [C('#ff6a1f'), C('#e8402a'), C('#2f6fe0'), C('#ff9a2a'), C('#c8304a')];
  for (let i = Math.round(11 * q); i > 0; i--) {
    const s = rng.chance(0.4) ? takeSpot(st => st.n.y > 0.6, 0.15) : sandSpot(0.2, 4.5, rng.pick(rocks.bommies));
    if (!s) continue;
    const sc = rng.range(0.11, 0.17);
    stars.push({ pos: new THREE.Vector3(s.x, s.y - 0.005, s.z), quat: standOn(s.n, rng.range(0, TAU), 0.0), scale: new THREE.Vector3(sc, sc, sc), color: rng.pick(starCols) });
  }
  group.add(instanced(starG, starMat, stars, { shadow: false }));

  /* ---- urchins ---- */
  const urchinBodyG = strip(new THREE.SphereGeometry(0.09, 14, 10));
  paint(urchinBodyG, () => [C('#2a1830'), 0]);
  const spineG = strip(new THREE.ConeGeometry(0.011, 1, 4, 1));
  spineG.translate(0, 0.5, 0);
  paint(spineG, (x, y) => [_c.copy(C('#1c1024')).lerp(C('#5a3a6a'), clamp(y, 0, 1)).clone(), 0]);
  const urchinMat = stdMat(W, { vertexColors: true, roughness: 0.4, envMapIntensity: 0.6 }, { key: 'urchin' });
  const urchins = [], spines = [];
  for (let i = Math.round(7 * q); i > 0; i--) {
    const s = rng.chance(0.5) ? takeSpot(st => st.n.y > 0.3, 0.25) : sandSpot(0.0, 1.2, rng.pick(rocks.bommies));
    if (!s) continue;
    const c = new THREE.Vector3(s.x, s.y + 0.04, s.z);
    urchins.push({ pos: c, quat: new THREE.Quaternion(), scale: new THREE.Vector3(1, 0.8, 1) });
    for (let k = 0; k < 70; k++) {
      const d = rng.onSphere(new THREE.Vector3());
      if (d.y < -0.25) d.y = -d.y * 0.3;
      d.normalize();
      const L = rng.range(0.16, 0.32);
      spines.push({ pos: c.clone().addScaledVector(d, 0.07), quat: _q.setFromUnitVectors(_up, d).clone(), scale: new THREE.Vector3(1, L, 1) });
    }
  }
  group.add(instanced(urchinBodyG, urchinMat, urchins));
  group.add(instanced(spineG, urchinMat, spines, { shadow: false }));

  /* ---- rubble around the coral heads ---- */
  const rubG = strip(new THREE.IcosahedronGeometry(1, 1));
  { const p = rubG.getAttribute('position'), nn = createNoise(3); for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + nn.noise3(x * 2, y * 2, z * 2) * 0.3; p.setXYZ(i, x * k, y * k * 0.6, z * k); } rubG.computeVertexNormals(); }
  paint(rubG, () => [C('#ffffff'), 0]);
  const rubMat = stdMat(W, { vertexColors: true, roughness: 0.9, flatShading: true }, { key: 'rub' });
  const rubble = [];
  const rubCols = [C('#d8d0bc'), C('#c8bca0'), C('#e0c8c0'), C('#b8b0a0'), C('#cfc4b2')];
  for (let i = Math.round(320 * q); i > 0; i--) {
    const b = rng.pick(rocks.bommies);
    const a = rng.range(0, TAU), r = b.r * rng.range(0.7, 1.6);
    const x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
    if (hm.at(x, z) > ground.height(x, z) + 0.1) continue;
    const sc = rng.range(0.03, 0.11);
    rubble.push({ pos: new THREE.Vector3(x, ground.height(x, z) + sc * 0.15, z), quat: _q.setFromEuler(_e.set(rng.range(-0.3, 0.3), rng.range(0, TAU), rng.range(-0.3, 0.3))).clone(), scale: new THREE.Vector3(sc * rng.range(1, 2.2), sc, sc), color: rng.pick(rubCols) });
  }
  group.add(instanced(rubG, rubMat, rubble, { shadow: false }));

  return { group, anemones, occupied };
}
