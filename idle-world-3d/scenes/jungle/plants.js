// Procedural rainforest plants built from leaf blades on a shared texture atlas.
// Every plant is one BufferGeometry (position, normal, uv, color) meant for an InstancedMesh.
import * as THREE from 'three';
import { TAU, clamp, lerp, makeRng, makeCanvas } from '../../lib/util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as T from './textures.js';
import { taperTube } from './trees.js';

/* ------------------------------------------------------------------ */
/* Atlas                                                                */
/* ------------------------------------------------------------------ */
// layout in a 2048 x 2048 virtual space: [x, y, w, h]
const LAYOUT = {
  monstera: [0, 0, 512, 512],
  elephant: [512, 0, 512, 512],
  lily: [1024, 0, 256, 256],
  orchid: [1280, 0, 128, 128],
  orchid2: [1280, 128, 128, 128],
  petal: [1408, 0, 128, 256],
  white: [1536, 0, 256, 256],
  orchid3: [1792, 0, 128, 128],
  banana: [0, 512, 256, 1024],
  fern: [256, 512, 256, 1024],
  strap: [512, 512, 128, 512],
  vine: [640, 512, 128, 512],
  blades: [768, 512, 128, 512],
  strap2: [896, 512, 128, 512],
  foliage: [1024, 512, 512, 512],
  foliage2: [1536, 512, 512, 512],
  fern2: [512, 1024, 256, 1024],
  foliage3: [1024, 1024, 512, 512],
  glowfern: [768, 1024, 256, 1024],
  petal2: [1536, 1024, 128, 256],
};

export function makeAtlas(seed, q) {
  const S = q >= 0.9 ? 2048 : 1024;
  const k = S / 2048;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const put = (name, tex) => {
    const [x, y, w, h] = LAYOUT[name];
    const img = tex.image;
    g.drawImage(img, x * k, y * k, w * k, h * k);
    tex.dispose();
  };
  put('monstera', T.makeMonstera(seed + 1));
  put('elephant', T.makeElephantEar(seed + 2));
  put('lily', T.makeLilyPad(seed + 3));
  put('orchid', T.makeOrchid(seed + 4));
  put('orchid2', T.makeOrchid(seed + 5, 128, { petal: '#ffffff', lip: '#e85aa0', center: '#ffd23a' }));
  put('orchid3', T.makeOrchid(seed + 6, 128, { petal: '#ffb347', lip: '#c2361f', center: '#fff2a0' }));
  put('petal', T.makePetal(seed + 7));
  put('petal2', T.makePetal(seed + 8, 128, 256, { base: '#fff8e8', tipC: '#ffd0e0' }));
  g.fillStyle = '#ffffff';
  { const [x, y, w, h] = LAYOUT.white; g.fillRect(x * k, y * k, w * k, h * k); }
  put('banana', T.makeBanana(seed + 9));
  put('fern', T.makeFern(seed + 10));
  put('fern2', T.makeFern(seed + 11, 256, 1024, { color: ['#2f6a22', '#4a8a2e'], density: 1.25 }));
  put('glowfern', T.makeFern(seed + 12, 256, 1024, { color: ['#2a5a3a', '#3a7a4a'], density: 0.9, vein: '#86f0dc', rachis: '#9af5e4' }));
  put('strap', T.makeStrap(seed + 13));
  put('strap2', T.makeStrap(seed + 14, 128, 512, { base: '#c8282a', mid: '#4a7a2a', tipC: '#5a8a30' }));
  put('vine', T.makeVineCard(seed + 15));
  put('blades', T.makeBlades(seed + 16));
  put('foliage', T.makeFoliage(seed + 17));
  put('foliage2', T.makeFoliage(seed + 18, 512, { palette: ['#3a6e24', '#4a7e2c', '#2e5e20', '#5a8a30', '#28501c'], count: 220 }));
  put('foliage3', T.makeFoliage(seed + 19, 512, { palette: ['#1a3a22', '#21452a', '#183320', '#2a5030'], count: 300, radius: 0.48 }));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  const rects = {};
  for (const [name, [x, y, w, h]] of Object.entries(LAYOUT)) {
    const pad = 1.5;
    rects[name] = [(x + pad) / 2048, 1 - (y + h - pad) / 2048, (x + w - pad) / 2048, 1 - (y + pad) / 2048];
  }
  // centre of the white block
  rects.whiteUV = [(LAYOUT.white[0] + 128) / 2048, 1 - (LAYOUT.white[1] + 128) / 2048];
  return { texture: tex, rects };
}

/* ------------------------------------------------------------------ */
/* Building blocks                                                      */
/* ------------------------------------------------------------------ */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(1, 1, 1);

/**
 * Leaf blade grid in local space: base at origin, length along +Z, width along X, face +Y.
 * base: fraction of the length behind the attachment (elephant ear lobes).
 */
export function blade(rect, { len = 1, wid = 0.5, segU = 4, segV = 8, fold = 0.15, droop = 0.3, twist = 0, ruffle = 0, base = 0, tint = [1, 1, 1], cup = 0 } = {}) {
  const pos = [], uv = [], col = [], idx = [];
  for (let j = 0; j <= segV; j++) {
    const s = j / segV;
    const sl = s - base;
    for (let i = 0; i <= segU; i++) {
      const u = i / segU, xw = u - 0.5, ax = Math.abs(xw) * 2;
      let x = xw * wid;
      let y = fold * Math.pow(ax, 1.4) * wid * 0.5 - cup * (1 - ax * ax) * wid * 0.1;
      y -= droop * len * Math.max(0, sl) * Math.max(0, sl);
      y += ruffle * Math.sin(s * 23 + xw * 4) * ax * wid * 0.06;
      if (sl < 0) y -= droop * 0.4 * len * sl * sl;
      const tw = twist * s;
      const ct = Math.cos(tw), st = Math.sin(tw);
      const xx = x * ct - y * st, yy = x * st + y * ct;
      pos.push(xx, yy, sl * len);
      uv.push(lerp(rect[0], rect[2], u), lerp(rect[1], rect[3], s));
      col.push(tint[0], tint[1], tint[2]);
    }
  }
  const W = segU + 1;
  for (let j = 0; j < segV; j++) for (let i = 0; i < segU; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Place a part: roll about its length, pitch up, yaw around Y, then move. */
function place(g, at, yaw, pitch, roll = 0, scale = 1) {
  _e.set(-pitch, yaw, roll, 'YXZ');
  _q.setFromEuler(_e);
  _m.compose(at, _q, _s.set(scale, scale, scale));
  g.applyMatrix4(_m);
  return g;
}

/** Stem tube along points, uv on the atlas white block, solid colour. */
function stem(A, points, r0, r1, color, { tubular = 8, radial = 5 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = taperTube(curve, t => lerp(r0, r1, t), { tubular, radial, tint: color });
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, A.rects.whiteUV[0], A.rects.whiteUV[1]);
  return g;
}

function finish(parts) {
  const m = mergeGeometries(parts.map(p => (p.index ? p.toNonIndexed() : p)));
  parts.forEach(p => p.dispose());
  m.computeBoundingSphere();
  m.computeBoundingBox();
  return m;
}

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const leafGreen = (rng, k = 1) => { const v = rng.range(0.85, 1.1) * k; return [v * rng.range(0.92, 1.05), v, v * rng.range(0.85, 1.0)]; };

/* ------------------------------------------------------------------ */
/* Species                                                              */
/* ------------------------------------------------------------------ */
export function monstera(A, rng, { leaves = 8, size = 1 } = {}) {
  const parts = [];
  const stemCol = [0.38, 0.55, 0.22];
  for (let i = 0; i < leaves; i++) {
    const az = (i / leaves) * TAU + rng.range(-0.35, 0.35);
    const el = rng.range(0.55, 1.15);
    const Lp = rng.range(0.6, 1.35) * size;
    const P = V(Math.sin(az) * Math.cos(el) * Lp, Math.sin(el) * Lp, Math.cos(az) * Math.cos(el) * Lp);
    parts.push(stem(A, [V(0, 0, 0), V(P.x * 0.35, P.y * 0.62, P.z * 0.35), P], 0.028 * size, 0.018 * size, stemCol));
    const s = rng.range(0.75, 1.1) * size;
    const lf = blade(A.rects.monstera, { len: 1.0 * s, wid: 0.95 * s, segU: 6, segV: 8, fold: 0.18, droop: rng.range(0.15, 0.35), twist: rng.range(-0.2, 0.2), tint: leafGreen(rng) });
    // the texture's petiole notch is ~6% in: shift so the blade starts at the attachment
    lf.translate(0, 0, -0.06 * s);
    parts.push(place(lf, P, az + rng.range(-0.25, 0.25), rng.range(-0.15, 0.45), rng.range(-0.25, 0.25)));
  }
  return finish(parts);
}

export function banana(A, rng, { leaves = 7, height = 3.2 } = {}) {
  const parts = [];
  const h = height * rng.range(0.85, 1.1);
  const lean = V(rng.range(-0.15, 0.15), 0, rng.range(-0.15, 0.15));
  const top = V(lean.x, h, lean.z);
  parts.push(stem(A, [V(0, -0.1, 0), V(lean.x * 0.3, h * 0.5, lean.z * 0.3), top], 0.16, 0.1, [0.42, 0.5, 0.22], { tubular: 6, radial: 8 }));
  for (let i = 0; i < leaves; i++) {
    const az = (i / leaves) * TAU * 1.05 + rng.range(-0.3, 0.3);
    const age = i / leaves; // older leaves droop and are torn
    const P = top.clone().add(V(0, -0.1 * i * 0.2, 0));
    const petiole = 0.35;
    const P2 = P.clone().add(V(Math.sin(az) * petiole, 0.15, Math.cos(az) * petiole));
    parts.push(stem(A, [P.clone().add(V(0, -0.3, 0)), P2], 0.05, 0.03, [0.55, 0.65, 0.3]));
    const L = rng.range(1.8, 2.5), Wd = rng.range(0.5, 0.65);
    const lf = blade(A.rects.banana, { len: L, wid: Wd, segU: 4, segV: 12, fold: 0.22, droop: lerp(0.18, 0.55, age) + rng.range(-0.05, 0.05), twist: rng.range(-0.3, 0.3), ruffle: 0.4, tint: leafGreen(rng, lerp(1.05, 0.9, age)) });
    parts.push(place(lf, P2, az, lerp(0.85, 0.15, age) + rng.range(-0.1, 0.1), rng.range(-0.2, 0.2)));
  }
  return finish(parts);
}

export function elephantEar(A, rng, { leaves = 5, size = 1 } = {}) {
  const parts = [];
  for (let i = 0; i < leaves; i++) {
    const az = (i / leaves) * TAU + rng.range(-0.4, 0.4);
    const el = rng.range(0.9, 1.3);
    const Lp = rng.range(0.9, 1.7) * size;
    const P = V(Math.sin(az) * Math.cos(el) * Lp, Math.sin(el) * Lp, Math.cos(az) * Math.cos(el) * Lp);
    parts.push(stem(A, [V(0, 0, 0), V(P.x * 0.2, P.y * 0.6, P.z * 0.2), P], 0.035 * size, 0.022 * size, [0.4, 0.58, 0.25]));
    const s = rng.range(0.9, 1.25) * size;
    const lf = blade(A.rects.elephant, { len: 1.1 * s, wid: 0.95 * s, segU: 6, segV: 8, base: 0.22, fold: 0.12, droop: rng.range(0.25, 0.45), ruffle: 0.6, tint: leafGreen(rng, 1.05) });
    parts.push(place(lf, P, az + rng.range(-0.2, 0.2), rng.range(0.35, 0.8), rng.range(-0.2, 0.2)));
  }
  return finish(parts);
}

export function fern(A, rng, { fronds = 9, size = 1, rect = 'fern', upright = 0 } = {}) {
  const parts = [];
  for (let i = 0; i < fronds; i++) {
    const az = (i / fronds) * TAU + rng.range(-0.3, 0.3);
    const L = rng.range(0.65, 1.1) * size;
    const lf = blade(A.rects[rect], { len: L, wid: L * 0.36, segU: 2, segV: 7, fold: 0.25, droop: rng.range(0.45, 0.8) * (1 - upright * 0.6), twist: rng.range(-0.3, 0.3), tint: leafGreen(rng) });
    parts.push(place(lf, V(0, 0.02, 0), az, rng.range(0.7, 1.15) + upright * 0.25, rng.range(-0.3, 0.3)));
  }
  return finish(parts);
}

export function treeFern(A, rng, { height = 3, fronds = 12 } = {}) {
  const parts = [];
  const h = height * rng.range(0.8, 1.15);
  const bend = V(rng.range(-0.4, 0.4), 0, rng.range(-0.4, 0.4));
  const top = V(bend.x, h, bend.z);
  parts.push(stem(A, [V(0, -0.1, 0), V(bend.x * 0.2, h * 0.5, bend.z * 0.2), top], 0.16, 0.12, [0.26, 0.2, 0.14], { tubular: 8, radial: 7 }));
  for (let i = 0; i < fronds; i++) {
    const az = (i / fronds) * TAU + rng.range(-0.25, 0.25);
    const L = rng.range(1.7, 2.4);
    const lf = blade(A.rects.fern2, { len: L, wid: L * 0.42, segU: 2, segV: 10, fold: 0.3, droop: rng.range(0.32, 0.5), twist: rng.range(-0.2, 0.2), tint: leafGreen(rng, 1.05) });
    parts.push(place(lf, top, az, rng.range(0.55, 0.95), rng.range(-0.2, 0.2)));
  }
  // fiddleheads
  for (let i = 0; i < 3; i++) {
    const az = rng.next() * TAU;
    const p = top.clone().add(V(Math.sin(az) * 0.1, 0.05, Math.cos(az) * 0.1));
    parts.push(stem(A, [p, p.clone().add(V(Math.sin(az) * 0.08, 0.35, Math.cos(az) * 0.08)), p.clone().add(V(Math.sin(az) * 0.2, 0.45, Math.cos(az) * 0.2))], 0.03, 0.04, [0.5, 0.42, 0.22]));
  }
  return finish(parts);
}

export function heliconia(A, rng, { stems = 4 } = {}) {
  const parts = [];
  for (let s = 0; s < stems; s++) {
    const a = rng.next() * TAU, r = rng.range(0, 0.35);
    const b = V(Math.cos(a) * r, 0, Math.sin(a) * r);
    const h = rng.range(1.2, 2.0);
    const top = b.clone().add(V(rng.range(-0.15, 0.15), h, rng.range(-0.15, 0.15)));
    parts.push(stem(A, [b, b.clone().lerp(top, 0.5), top], 0.03, 0.02, [0.32, 0.45, 0.18]));
    // paddle leaves from upper stem
    for (let k = 0; k < 2; k++) {
      const az = rng.next() * TAU;
      const p = b.clone().lerp(top, rng.range(0.55, 0.95));
      const L = rng.range(0.9, 1.3);
      const lf = blade(A.rects.banana, { len: L, wid: L * 0.28, segU: 2, segV: 6, fold: 0.25, droop: 0.3, tint: [0.75, 0.9, 0.7] });
      parts.push(place(lf, p, az, rng.range(0.6, 1.1)));
    }
    // inflorescence: zig-zag red bracts with yellow tips
    if (s < 2) {
      const n = rng.int(5, 8);
      const az = rng.next() * TAU;
      for (let k = 0; k < n; k++) {
        const t = k / n;
        const p = top.clone().add(V(Math.sin(az) * 0.05 * k, 0.05 + t * 0.55, Math.cos(az) * 0.05 * k));
        const side = k % 2 ? 1 : -1;
        const g = new THREE.ConeGeometry(0.045, 0.22 * (1 - t * 0.4), 5, 1);
        g.translate(0, 0.11, 0);
        g.rotateZ(side * 1.15);
        g.rotateY(az);
        g.translate(p.x, p.y, p.z);
        const cnt = g.attributes.position.count;
        const col = new Float32Array(cnt * 3);
        for (let v = 0; v < cnt; v++) {
          const tip = g.attributes.position.getY(v) > p.y + 0.06 ? 1 : 0;
          col[v * 3] = 1.0; col[v * 3 + 1] = lerp(0.08, 0.75, tip * 0.8); col[v * 3 + 2] = lerp(0.06, 0.1, tip);
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const uv = new Float32Array(cnt * 2);
        for (let v = 0; v < cnt; v++) { uv[v * 2] = A.rects.whiteUV[0]; uv[v * 2 + 1] = A.rects.whiteUV[1]; }
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        parts.push(g.index ? g.toNonIndexed() : g);
      }
    }
  }
  return finish(parts);
}

export function bromeliad(A, rng, { leaves = 12, size = 0.6, red = false } = {}) {
  const parts = [];
  for (let i = 0; i < leaves; i++) {
    const az = (i / leaves) * TAU * 2.0 + rng.range(-0.2, 0.2);
    const L = rng.range(0.4, 0.65) * size / 0.6;
    const lf = blade(A.rects[red ? 'strap2' : 'strap'], { len: L, wid: L * 0.22, segU: 2, segV: 5, fold: 0.5, droop: rng.range(0.4, 0.9), tint: [1, 1, 1] });
    parts.push(place(lf, V(0, 0, 0), az, rng.range(0.6, 1.2)));
  }
  return finish(parts);
}

/** A spray of orchid flowers on an arching stalk (+ two strap leaves). */
export function orchidSpray(A, rng, { rect = 'orchid', flowers = 6 } = {}) {
  const parts = [];
  const az = rng.next() * TAU;
  const pts = [V(0, 0, 0), V(Math.sin(az) * 0.15, 0.35, Math.cos(az) * 0.15), V(Math.sin(az) * 0.45, 0.42, Math.cos(az) * 0.45), V(Math.sin(az) * 0.65, 0.3, Math.cos(az) * 0.65)];
  parts.push(stem(A, pts, 0.008, 0.006, [0.35, 0.4, 0.2], { tubular: 8, radial: 3 }));
  const curve = new THREE.CatmullRomCurve3(pts);
  for (let k = 0; k < flowers; k++) {
    const p = curve.getPointAt(0.35 + (k / flowers) * 0.65);
    const f = new THREE.PlaneGeometry(0.11, 0.11);
    const uv = f.attributes.uv;
    const r = A.rects[rect];
    for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(r[0], r[2], uv.getX(i)), lerp(r[1], r[3], uv.getY(i)));
    const col = new Float32Array(uv.count * 3).fill(1);
    f.setAttribute('color', new THREE.BufferAttribute(col, 3));
    f.rotateX(rng.range(-0.6, 0.2));
    f.rotateY(az + Math.PI / 2 + rng.range(-0.8, 0.8));
    f.translate(p.x, p.y - 0.04, p.z);
    parts.push(f);
  }
  for (let i = 0; i < 2; i++) {
    const lf = blade(A.rects.strap, { len: 0.35, wid: 0.09, segU: 2, segV: 4, fold: 0.3, droop: 0.6, tint: [0.7, 1.0, 0.7] });
    parts.push(place(lf, V(0, 0, 0), az + Math.PI + rng.range(-0.8, 0.8), 0.5));
  }
  return finish(parts);
}

export function sedge(A, rng, { cards = 4, height = 0.9 } = {}) {
  const parts = [];
  for (let i = 0; i < cards; i++) {
    const g = new THREE.PlaneGeometry(height * 0.5, height, 2, 4);
    g.translate(0, height / 2, 0);
    const uv = g.attributes.uv, r = A.rects.blades;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, lerp(r[0], r[2], uv.getX(k)), lerp(r[1], r[3], uv.getY(k)));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(uv.count * 3).fill(1), 3));
    g.rotateY((i / cards) * Math.PI + rng.range(-0.2, 0.2));
    parts.push(g);
  }
  return finish(parts);
}

/** Lily pad: flat disc with upturned rim, uv from the atlas. Unit radius. */
export function lilyPad(A) {
  const g = new THREE.CircleGeometry(1, 20);
  const pos = g.attributes.position, uv = g.attributes.uv, r = A.rects.lily;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const d = Math.hypot(x, y);
    pos.setZ(i, Math.pow(d, 6) * 0.06);
    uv.setXY(i, lerp(r[0], r[2], x * 0.5 + 0.5), lerp(r[1], r[3], y * 0.5 + 0.5));
  }
  g.rotateX(-Math.PI / 2);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(1), 3));
  g.computeVertexNormals();
  return g.index ? g.toNonIndexed() : g;
}

/** Lotus flower: cupped layered petals + yellow seed pod, on a short stalk. */
export function lotus(A, rng, { open = 0.6, rect = 'petal' } = {}) {
  const parts = [];
  const top = V(0, 0.32, 0);
  parts.push(stem(A, [V(0, -0.4, 0), V(0.02, 0, 0.01), top], 0.012, 0.012, [0.35, 0.5, 0.25]));
  const layers = [[6, 0.13, 0.25 + open * 0.55], [8, 0.16, 0.45 + open * 0.6], [9, 0.18, 0.75 + open * 0.55]];
  layers.forEach(([n, L, tilt], li) => {
    for (let i = 0; i < n; i++) {
      const az = (i / n) * TAU + li * 0.4 + rng.range(-0.1, 0.1);
      const lf = blade(A.rects[rect], { len: L * 1.5, wid: L * 0.85, segU: 3, segV: 4, fold: 0.9, droop: -0.25, tint: [1, 1, 1] });
      parts.push(place(lf, top.clone().add(V(0, 0.01 * li, 0)), az, Math.PI / 2 - tilt));
    }
  });
  const pod = new THREE.CylinderGeometry(0.045, 0.03, 0.05, 10);
  pod.translate(top.x, top.y + 0.06, top.z);
  const cnt = pod.attributes.position.count;
  pod.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cnt * 3).map((_, k) => [1.0, 0.82, 0.25][k % 3]), 3));
  const uv = pod.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, A.rects.whiteUV[0], A.rects.whiteUV[1]);
  parts.push(pod.index ? pod.toNonIndexed() : pod);
  return finish(parts);
}

/** Raised lotus leaf: a shallow bowl on a stalk. */
export function lotusLeaf(A, rng) {
  const parts = [];
  const h = rng.range(0.25, 0.6);
  parts.push(stem(A, [V(0, -0.4, 0), V(0.03, h * 0.5, 0), V(0, h, 0)], 0.012, 0.012, [0.35, 0.5, 0.25]));
  const g = new THREE.CircleGeometry(0.42, 16);
  const pos = g.attributes.position, uv = g.attributes.uv, r = A.rects.lily;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), d = Math.hypot(x, y) / 0.42;
    pos.setZ(i, d * d * 0.12 + Math.sin(Math.atan2(y, x) * 5) * 0.015 * d);
    uv.setXY(i, lerp(r[0], r[2], 0.5 + x / 0.84 * 0.95), lerp(r[1], r[3], 0.5 + y / 0.84 * 0.95));
  }
  g.rotateX(-Math.PI / 2);
  g.translate(0, h, 0);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.count * 3).fill(0.9), 3));
  g.computeVertexNormals();
  parts.push(g.index ? g.toNonIndexed() : g);
  return finish(parts);
}

/** Hanging vine curtain: several vine cards from y=0 down to -len (object space). */
export function vineCurtain(A, rng, { strands = 5, len = 4 } = {}) {
  const parts = [];
  for (let i = 0; i < strands; i++) {
    const L = len * rng.range(0.5, 1.1);
    const g = new THREE.PlaneGeometry(0.3, L, 1, 8);
    g.translate(0, -L / 2, 0);
    const uv = g.attributes.uv, r = A.rects.vine;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, lerp(r[0], r[2], uv.getX(k)), lerp(r[1], r[3], uv.getY(k)));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(uv.count * 3).fill(1), 3));
    g.rotateY(rng.next() * Math.PI);
    g.translate(rng.range(-0.6, 0.6), rng.range(-0.2, 0.1), rng.range(-0.3, 0.3));
    parts.push(g);
  }
  return finish(parts);
}

/** Glow pods: thin arching stems carrying luminous bulbs (pale buds by day, cyan lanterns by night). */
export function glowPods(rng, { stems = 5 } = {}) {
  const parts = [];
  for (let i = 0; i < stems; i++) {
    const a = rng.next() * TAU, h = rng.range(0.35, 0.9), lean = rng.range(0.05, 0.3);
    const top = new THREE.Vector3(Math.cos(a) * lean, h, Math.sin(a) * lean);
    const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * lean * 0.3, h * 0.6, Math.sin(a) * lean * 0.3), top]);
    const st = taperTube(curve, t => lerp(0.011, 0.006, t), { tubular: 6, radial: 4, tint: [0.25, 0.4, 0.22] }).toNonIndexed();
    st.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(st.attributes.position.count).fill(0.08), 1));
    st.deleteAttribute('uv');
    parts.push(st);
    const r = rng.range(0.03, 0.055);
    const b = new THREE.SphereGeometry(r, 8, 6);
    b.scale(1, 1.25, 1);
    b.translate(top.x, top.y + r * 0.9, top.z);
    const nb = b.toNonIndexed();
    nb.deleteAttribute('uv');
    nb.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(nb.attributes.position.count).fill(1), 1));
    nb.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nb.attributes.position.count * 3).map((_, k) => [0.62, 0.78, 0.6][k % 3]), 3));
    parts.push(nb);
  }
  const m = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  return m;
}

/** Bioluminescent mushroom cluster: caps + stems, with an aGlow attribute (1 on caps' gills). */
export function mushroomCluster(rng, { count = 5 } = {}) {
  const parts = [];
  for (let i = 0; i < count; i++) {
    const a = rng.next() * TAU, r = rng.range(0, 0.12);
    const h = rng.range(0.05, 0.16), cr = rng.range(0.025, 0.06);
    const st = new THREE.CylinderGeometry(cr * 0.25, cr * 0.32, h, 6, 1);
    st.translate(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    const cap = new THREE.SphereGeometry(cr, 10, 5, 0, TAU, 0, Math.PI * 0.55);
    cap.scale(1, 0.55, 1);
    cap.translate(Math.cos(a) * r, h, Math.sin(a) * r);
    const gill = new THREE.CircleGeometry(cr * 0.98, 10);
    gill.rotateX(Math.PI / 2);
    gill.translate(Math.cos(a) * r, h + 0.002, Math.sin(a) * r);
    for (const [g, glow, c] of [[st, 0.35, [0.85, 0.85, 0.78]], [cap, 0.75, [0.8, 0.82, 0.78]], [gill, 1.0, [0.9, 0.95, 0.9]]]) {
      const ng = g.index ? g.toNonIndexed() : g;
      const cnt = ng.attributes.position.count;
      ng.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(cnt).fill(glow), 1));
      ng.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cnt * 3).map((_, k) => c[k % 3]), 3));
      ng.deleteAttribute('uv');
      parts.push(ng);
    }
  }
  const m = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  return m;
}

/**
 * Bracket (shelf) fungi: half-disc shelves stacked on bark, growing out along +z with +y up. aGlow: the pale gills
 * under each shelf glow at night (1), the caps a little (0.35); colour: cream to apricot caps, pale gills.
 */
export function bracketCluster(rng, { shelves = 4 } = {}) {
  const parts = [];
  for (let i = 0; i < shelves; i++) {
    const r = rng.range(0.06, 0.15) * (1 - i * 0.12), y = i * rng.range(0.07, 0.12) + rng.range(-0.02, 0.02), x = rng.range(-0.08, 0.08);
    const cap = new THREE.SphereGeometry(r, 8, 3, -Math.PI / 2, Math.PI, 0, Math.PI * 0.5); // the outer half of a dome
    cap.scale(1, 0.32, 0.9);
    cap.translate(x, y, 0.01);
    const gill = new THREE.CircleGeometry(r * 0.97, 8, -Math.PI / 2, Math.PI);
    gill.rotateX(Math.PI / 2); // facing down
    gill.scale(1, 1, 0.9);
    gill.translate(x, y - 0.002, 0.01);
    const tint = rng.range(0, 1);
    for (const [g, glow, c] of [[cap, 0.35, [lerp(0.86, 0.95, tint), lerp(0.76, 0.6, tint), lerp(0.6, 0.42, tint)]], [gill, 1.0, [0.92, 0.95, 0.88]]]) {
      const ng = g.index ? g.toNonIndexed() : g;
      const cnt = ng.attributes.position.count;
      ng.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(cnt).fill(glow), 1));
      ng.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cnt * 3).map((_, k) => c[k % 3]), 3));
      ng.deleteAttribute('uv');
      parts.push(ng);
    }
  }
  const m = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  return m;
}
