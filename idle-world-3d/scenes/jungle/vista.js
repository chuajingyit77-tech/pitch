// 雨林 · the vista beyond the cliff: a forested ridge where the gentle giants walk, a second ridge further back,
// layered mountains in the haze, and the ancient tree — a colossal strangler fig rising from the valley between
// the ridges, its trunk a braid of fused roots with hanging aerial roots, moss and epiphytes, its crown lost in the
// haze far above the view.
//
// Everything here is static and opaque and drawn in one call (one merged mesh, one material, one bark texture). It
// is only drawn in the main view (layer 1): the pond's reflection never sees past the cliff. Light, haze and the
// drifting mist sheets come from far.js; the trunk's bark relief comes from a small packed texture (slope, albedo,
// crevices) with mipmaps, and its roots carry faint glowing moss that breathes slowly at night.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, makeRng, createNoise } from '../../lib/util.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { JG_GLSL } from './shading.js';
import { tiler } from './textures.js';
import { VISTA_GLSL } from './far.js';

/** Layout around the clearing (polar about the view target C, angle th from -z toward +x). */
export const VISTA = {
  C: new THREE.Vector2(1.4, -3.6),
  near: { r: 80, y: 27.5 },     // the ridge the giants usually walk along
  far: { r: 148, y: 46 },       // the second ridge (the farther passes)
  tree: { r: 176, th: 0.13, R: 13, top: 180 }, // rises from the valley behind the far ridge
  span: 2.3,                    // the ridges wrap ±2.3 rad around the clearing
};
export const polar = (th, r, out = new THREE.Vector3()) => out.set(VISTA.C.x + Math.sin(th) * r, 0, VISTA.C.y - Math.cos(th) * r);

/* ------------------------------------------------------------------ */
/* Ridge height fields                                                  */
/* ------------------------------------------------------------------ */
export function createLand(seed) {
  const n = createNoise(seed + 501);
  const nearR = th => VISTA.near.r + 5.5 * n.noise2(th * 1.6, 3.1) + 2.2 * n.noise2(th * 5.3, 8.7);
  const nearY = th => VISTA.near.y + 2.0 * n.noise2(th * 2.2, 1.7) + 0.9 * n.noise2(th * 7.9, 4.4) - 3.0 * smoothstep(1.2, 2.2, Math.abs(th));
  const farR = th => VISTA.far.r + 8 * n.noise2(th * 1.3, 11.3) + 3 * n.noise2(th * 4.1, 6.2);
  const farY = th => VISTA.far.y + 3.2 * n.noise2(th * 1.9, 9.4) + 1.2 * n.noise2(th * 6.7, 2.2);
  const sa = (u, k) => Math.sqrt(u * u + k * k) - k; // soft |u|: a rounded crest k metres wide
  /** Ground height of one ridge at polar (th, r). */
  const ridge = (th, r, R, Y, front, back, round, q = 0.003) => {
    const u = R - r; // > 0 toward the clearing
    return Y - (u > 0 ? front * sa(u, round) + q * u * u : back * sa(u, round));
  };
  const nearH = (th, r) => ridge(th, r, nearR(th), nearY(th), 0.42, 0.4, 5);
  const farH = (th, r) => ridge(th, r, farR(th), farY(th), 1.0, 0.4, 7, 0.004);
  const toPolar = (x, z) => { const dx = x - VISTA.C.x, dz = z - VISTA.C.y; return [Math.atan2(dx, -dz), Math.hypot(dx, dz)]; };
  /** Ground height anywhere beyond the plateau (the higher of the two ridges, the valley floor between them). */
  const groundAt = (x, z) => { const [th, r] = toPolar(x, z); return Math.max(nearH(th, r), farH(th, r), 2); };
  /**
   * A path for one pass of the giants. It starts behind a ridge (below the crest line seen from the clearing, so the
   * animals rise into view head first), climbs diagonally onto the walkway along the crest, crosses the view and goes
   * down behind the ridge again. variant 0 / 1: the near ridge (just in front of the crest / on it), 2: the far ridge.
   * dir: +1 left to right, -1 right to left. Returns { length, at(s, out), dirAt(s, out) } (ground points, y = 0).
   */
  const lane = (variant, dir, rng) => {
    const far = variant === 2;
    const Rf = far ? farR : nearR;
    const c = rng.range(-0.1, 0.06) + (far ? 0.02 : 0);
    const half = far ? rng.range(0.07, 0.1) : rng.range(0.13, 0.18);
    const ramp = far ? 0.2 : 0.36;
    const walkB = far ? -1.5 : variant === 0 ? -2.2 : 0.4;   // across the crest: < 0 toward the clearing
    const hideB = far ? 30 : 27;
    const wob = rng.range(-1.2, 1.2);
    // the ramps run mostly along the ridge (gentle grades), dropping behind the crest gradually
    const key = [[-(half + ramp), hideB], [-(half + ramp * 0.66), hideB * 0.62], [-(half + ramp * 0.3), hideB * 0.2], [-half, walkB + 0.3], [-half * 0.35, walkB + wob * 0.5],
      [half * 0.35, walkB - wob * 0.5], [half, walkB + 0.3], [half + ramp * 0.3, hideB * 0.2], [half + ramp * 0.66, hideB * 0.62], [half + ramp, hideB]];
    const pts = key.map(([a, b]) => { const th = c + a * dir; return polar(th, Rf(th) + b); });
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const N = 320;
    const P = [], D = [];
    for (let i = 0; i <= N; i++) P.push(curve.getPointAt(i / N));
    const length = curve.getLength();
    for (let i = 0; i <= N; i++) { const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, N)]; D.push(new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize()); }
    const sample = (arr, s, out) => {
      const u = clamp(s / length, 0, 1) * N, i = Math.min(Math.floor(u), N - 1), f = u - i;
      return out.copy(arr[i]).lerp(arr[i + 1], f);
    };
    return {
      length, variant, dir,
      at(s, out) {
        // beyond either end the path carries straight on (behind the ridge, out of sight)
        if (s < 0) { sample(P, 0, out); return out.addScaledVector(D[0], s); }
        if (s > length) { sample(P, length, out); return out.addScaledVector(D[N], s - length); }
        return sample(P, s, out);
      },
      dirAt(s, out) { return sample(D, clamp(s, 0, length), out).normalize(); },
    };
  };
  return { n, nearR, nearY, farR, farY, nearH, farH, toPolar, groundAt, lane };
}

/* ------------------------------------------------------------------ */
/* Bark texture of the ancient tree (RG = slope, B = albedo, A = moss)  */
/* ------------------------------------------------------------------ */
function barkTexture(seed, S = 128) {
  const rng = makeRng(seed + 1);
  // periodic noise (tiles seamlessly): vertical fibrous strands, broad lumps, fine grain, lichen
  const strands = tiler(seed, S, S, 10, 2), lumps = tiler(seed + 1, S, S, 3, 3), fine = tiler(seed + 2, S, S, 20, 6), lichT = tiler(seed + 3, S, S, 5, 4);
  const H = new Float32Array(S * S), Lm = new Float32Array(S * S), A = new Float32Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = i / S, k = j * S + i;
    const st = strands(i, j, 3), lu = lumps(i, j, 3), fi = fine(i, j, 2);
    const fiss = Math.pow(1 - Math.abs(Math.sin((u * 9 + st * 3.2) * Math.PI)), 6);
    H[k] = lu + st * 0.5 + fi * 0.16 - fiss * 0.28;
    const lich = smoothstep(0.08, 0.3, lichT(i, j, 3));
    Lm[k] = clamp(0.55 + lu * 0.5 + fi * 0.24 - fiss * 0.35 + lich * 0.18, 0.08, 1);
    A[k] = clamp(fiss * 0.9 + smoothstep(-0.05, -0.3, lu) * 0.6, 0, 1);
  }
  // a few deep scars
  for (let c = 0; c < 6; c++) {
    let x = rng.next() * S, y = rng.next() * S;
    const len = rng.range(10, 35), w = rng.range(0.5, 1.0);
    for (let s = 0; s < len; s++) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const d = Math.hypot(dx, dy); if (d > w + 1) continue;
        const kk = (((Math.floor(y) + dy) % S + S) % S) * S + (((Math.floor(x) + dx) % S + S) % S);
        const f = clamp(w + 0.5 - d, 0, 1);
        H[kk] -= 0.25 * f; Lm[kk] *= 1 - 0.5 * f; A[kk] = Math.max(A[kk], f);
      }
      x += rng.range(-0.4, 0.4); y += 1;
    }
  }
  const data = new Uint8Array(S * S * 4);
  const K = S / 6;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const k = j * S + i;
    const dx = (H[j * S + ((i + 1) % S)] - H[j * S + ((i - 1 + S) % S)]) * 0.5 * K;
    const dy = (H[((j + 1) % S) * S + i] - H[((j - 1 + S) % S) * S + i]) * 0.5 * K;
    data[k * 4] = Math.round((clamp(dx, -1, 1) * 0.5 + 0.5) * 255);
    data[k * 4 + 1] = Math.round((clamp(dy, -1, 1) * 0.5 + 0.5) * 255);
    data[k * 4 + 2] = Math.round(Lm[k] * 255);
    data[k * 4 + 3] = Math.round(A[k] * 255);
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.anisotropy = 4; tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Geometry helpers: every part has position, normal, uv, aCol, aAux    */
/* aAux: x = occlusion (1 open), y = glow, z = bark detail, w = land    */
/* ------------------------------------------------------------------ */
function makeGeo(pos, nor, uv, col, aux, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aAux', new THREE.Float32BufferAttribute(aux, 4));
  g.setIndex(idx);
  return g;
}

/**
 * Tube along a centreline. center(t) -> Vector3 (t in [0,1]), radius(t, a) -> metres (a = angle round the tube),
 * shade(t, a, p, n) -> [r, g, b, ao, glow]. Rotation-minimising frames, so long roots do not twist.
 */
function tube(center, radius, shade, { rings, sides, uvScale = [1, 1], bark = 1 }) {
  const pos = [], nor = [], uv = [], col = [], aux = [], idx = [];
  const C = [], T = [];
  for (let i = 0; i <= rings; i++) C.push(center(i / rings));
  for (let i = 0; i <= rings; i++) T.push(C[Math.min(i + 1, rings)].clone().sub(C[Math.max(i - 1, 0)]).normalize());
  // initial normal: any vector not parallel to the first tangent
  let N = Math.abs(T[0].y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  N.addScaledVector(T[0], -N.dot(T[0])).normalize();
  let len = 0;
  const p = new THREE.Vector3(), nn = new THREE.Vector3(), Bv = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    if (i > 0) {
      // parallel transport of N to the new tangent
      const ax = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
      const s = ax.length();
      if (s > 1e-6) N.applyAxisAngle(ax.divideScalar(s), Math.asin(Math.min(s, 1)));
      N.addScaledVector(T[i], -N.dot(T[i])).normalize();
      len += C[i].distanceTo(C[i - 1]);
    }
    Bv.crossVectors(T[i], N);
    const t = i / rings;
    // taper slope tilts the normal along the tube
    const r0 = radius(Math.max(t - 0.01, 0), 0), r1 = radius(Math.min(t + 0.01, 1), 0);
    const step = C[Math.min(i + 1, rings)].distanceTo(C[Math.max(i - 1, 0)]) * 0.01 * rings / Math.max(1, Math.min(i + 1, rings) - Math.max(i - 1, 0)) || 1e-3;
    const slope = (r0 - r1) / Math.max(step * 2, 1e-3);
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * TAU;
      const r = radius(t, a);
      nn.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(Bv, Math.sin(a));
      p.copy(C[i]).addScaledVector(nn, r);
      const sh = shade(t, a, p, nn);
      const nrm = nn.clone().addScaledVector(T[i], clamp(slope, -1.5, 1.5)).normalize();
      pos.push(p.x, p.y, p.z); nor.push(nrm.x, nrm.y, nrm.z);
      uv.push((j / sides) * uvScale[0], len * uvScale[1]);
      col.push(sh[0], sh[1], sh[2]); aux.push(sh[3], sh[4], bark, 0);
    }
  }
  const W = sides + 1;
  for (let i = 0; i < rings; i++) for (let j = 0; j < sides; j++) {
    const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  return makeGeo(pos, nor, uv, col, aux, idx);
}

/* ------------------------------------------------------------------ */
/* The ancient tree                                                     */
/* ------------------------------------------------------------------ */
function buildAncientTree(seed, base, land) {
  const rng = makeRng(seed);
  const n = createNoise(seed + 9);
  const parts = [];
  const Rt = VISTA.tree.R, TOP = VISTA.tree.top;
  // the trunk's axis leans and wanders a little; its girth tapers slowly and flares at the foot
  const axis = (y, out = new THREE.Vector3()) => out.set(base.x + Math.sin(y * 0.019 + 1.3) * 2.2 + y * 0.02, base.y + y, base.z + Math.cos(y * 0.015) * 1.6 - y * 0.012);
  const girth = y => Rt * (1 - 0.3 * clamp(y / TOP, 0, 1)) + 7 * Math.pow(Math.max(0, 1 - y / 22), 2);
  const sunSide = new THREE.Vector3(0.6, 0, 0.8).normalize();
  // bark colour: warm grey fig bark, darker in the gaps, moss on the shaded and upper sides, pale lichen
  const barkShade = (gap, p, nrm, glowK) => {
    const lich = smoothstep(0.35, 0.6, n.noise2(p.x * 0.09, p.y * 0.05) * 0.5 + 0.5);
    const moss = clamp(smoothstep(0.1, 0.8, nrm.y) * 0.8 + smoothstep(0.2, -0.6, nrm.dot(sunSide)) * 0.45 + (n.noise2(p.x * 0.05 + 7, p.y * 0.03) * 0.5) * 0.4, 0, 1);
    let r = 0.32, g = 0.29, b = 0.24;
    r = lerp(r, 0.4, lich * 0.4); g = lerp(g, 0.41, lich * 0.4); b = lerp(b, 0.36, lich * 0.4);
    r = lerp(r, 0.17, moss * 0.75); g = lerp(g, 0.27, moss * 0.75); b = lerp(b, 0.09, moss * 0.75);
    const ao = clamp(1 - gap, 0.15, 1);
    // faint glowing moss in the deep folds of the lower roots (patches, not everywhere)
    const glowSpot = smoothstep(0.55, 0.8, n.noise2(p.x * 0.11 + 31, p.y * 0.07 + 5) * 0.5 + 0.5) * moss * glowK;
    return [r * (0.75 + 0.25 * ao), g * (0.75 + 0.25 * ao), b * (0.75 + 0.25 * ao), ao, glowSpot];
  };
  // core: the old host tree, mostly hidden inside the root lattice (dark)
  parts.push(tube(t => axis(t * TOP), (t, a) => girth(t * TOP) * 0.64 * (1 + 0.06 * Math.sin(a * 5 + t * 9)), (t, a, p, nrm) => barkShade(0.7, p, nrm, 0.3), { rings: 24, sides: 14, uvScale: [6, 1 / 9] }));
  // the fused roots: 11 columns wound slowly round the core, merging and parting, flaring into buttresses
  const NC = 11;
  for (let i = 0; i < NC; i++) {
    const a0 = (i / NC) * TAU + rng.range(-0.2, 0.2);
    const tw = rng.range(0.0035, 0.0075) * (i % 4 === 3 ? -1 : 1);
    const ph = rng.next() * TAU, rr = rng.range(0.24, 0.34);
    const ang = y => a0 + tw * y + 0.14 * Math.sin(y * 0.035 + ph);
    const rad = y => girth(y) * rr * (0.82 + 0.3 * (n.noise2(i * 3.1, y * 0.03) * 0.5 + 0.5));
    const dist = y => girth(y) * 0.78 + 5 * Math.pow(Math.max(0, 1 - y / 18), 2);
    const c = (t, out = new THREE.Vector3()) => {
      const y = -6 + t * (TOP + 6);
      axis(y, out);
      const A = ang(y), D = dist(y);
      return out.set(out.x + Math.cos(A) * D, y < 0 ? base.y + y : out.y, out.z + Math.sin(A) * D);
    };
    parts.push(tube(t => c(t), (t, a) => { const y = -6 + t * (TOP + 6); return rad(y) * (1 + 0.07 * Math.sin(a * 3 + y * 0.2)); },
      (t, a, p, nrm) => {
        // the side facing the core sits in the gap between roots: darker
        const y = -6 + t * (TOP + 6);
        const ax = axis(y);
        const out = Math.max(0, (p.x - ax.x) * nrm.x + (p.z - ax.z) * nrm.z) / Math.max(1, Math.hypot(p.x - ax.x, p.z - ax.z));
        return barkShade((1 - out) * 0.75, p, nrm, 1 - smoothstep(32, 62, y));
      }, { rings: 46, sides: 9, uvScale: [3, 1 / 8] }));
  }
  // thinner roots winding the other way over the columns: the lattice of a strangler fig
  for (let i = 0; i < 7; i++) {
    const a0 = rng.next() * TAU, tw = -rng.range(0.012, 0.022), y0 = rng.range(10, 30), y1 = y0 + rng.range(40, 80);
    const r0 = rng.range(0.7, 1.1);
    parts.push(tube(t => { const y = lerp(y0, y1, t); const p = axis(y); const A = a0 + tw * (y - y0); const D = girth(y) * 0.98; return p.set(p.x + Math.cos(A) * D, p.y, p.z + Math.sin(A) * D); },
      (t) => r0 * (0.75 + 0.25 * Math.sin(Math.PI * t)) * (t < 0.06 ? 0.4 + 10 * t : 1),
      (t, a, p, nrm) => barkShade(0.12, p, nrm, 0.6), { rings: 26, sides: 6, uvScale: [1, 1 / 6] }));
  }
  // great limbs leaving the trunk high up and climbing out of view, with aerial roots hanging from them
  const limbs = [];
  for (let k = 0; k < 4; k++) {
    const az = -1.9 + k * 1.25 + rng.range(-0.25, 0.25);
    const y0 = rng.range(33, 47);
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const p0 = axis(y0).addScaledVector(dir, girth(y0) * 0.5);
    const L = rng.range(42, 58);
    const pts = [p0, p0.clone().addScaledVector(dir, L * 0.3).add(new THREE.Vector3(0, L * 0.12, 0)), p0.clone().addScaledVector(dir, L * 0.65).add(new THREE.Vector3(0, L * 0.34, 0)), p0.clone().addScaledVector(dir, L).add(new THREE.Vector3(0, L * 0.62, 0))];
    const curve = new THREE.CatmullRomCurve3(pts);
    const r0 = rng.range(3.6, 4.6);
    limbs.push(curve);
    parts.push(tube(t => curve.getPointAt(t), t => lerp(r0, 1.0, Math.pow(t, 0.8)), (t, a, p, nrm) => barkShade(0.05, p, nrm, 0.2), { rings: 18, sides: 11, uvScale: [3, 1 / 8] }));
    for (let h = 0; h < 4; h++) {
      const u = rng.range(0.15, 0.7);
      const top = curve.getPointAt(u);
      const len = rng.range(18, 34), sway = rng.range(-1.5, 1.5);
      const rr = rng.range(0.32, 0.55);
      parts.push(tube(t => new THREE.Vector3(top.x + Math.sin(t * 2.2) * sway, top.y - 1 - t * len, top.z + Math.sin(t * 1.7) * sway * 0.6),
        t => rr * (1 - 0.35 * t), (t, a, p, nrm) => { const s = barkShade(0.1, p, nrm, 0.0); return [s[0] * 1.05, s[1] * 1.05, s[2] * 0.95, 0.95, 0]; }, { rings: 10, sides: 5, uvScale: [1, 1 / 6] }));
    }
  }
  // hanging roots from the trunk itself, the curtain that marks an old fig
  for (let h = 0; h < 10; h++) {
    const az = rng.next() * TAU, y0 = rng.range(28, 50), len = rng.range(12, 24);
    const p0 = axis(y0); const D = girth(y0) * 1.04;
    p0.x += Math.cos(az) * D; p0.z += Math.sin(az) * D;
    const rr = rng.range(0.28, 0.48);
    parts.push(tube(t => new THREE.Vector3(p0.x + Math.cos(az) * t * 1.6, p0.y - t * len, p0.z + Math.sin(az) * t * 1.6), t => rr * (1 - 0.3 * t),
      (t, a, p, nrm) => barkShade(0.1, p, nrm, 0.0), { rings: 8, sides: 5, uvScale: [1, 1 / 6] }));
  }
  // epiphytes and moss cushions on the roots and in the forks (green, some with night glow)
  const blobBase = new THREE.IcosahedronGeometry(1, 1);
  for (let k = 0; k < 34; k++) {
    const y = k < 26 ? rng.range(18, 54) : rng.range(34, 56);
    const az = rng.next() * TAU;
    const p = axis(y); const D = girth(y) * 0.98;
    const nrm = new THREE.Vector3(Math.cos(az), 0.25, Math.sin(az)).normalize();
    p.x += Math.cos(az) * D; p.z += Math.sin(az) * D;
    const s = rng.range(1.4, 3.4);
    const g = blobBase.clone();
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), yy = pa.getY(i), z = pa.getZ(i);
      const w = 1 + 0.25 * n.noise3(x * 2 + k, yy * 2, z * 2);
      pa.setXYZ(i, x * s * w, yy * s * 0.55 * w + s * 0.2, z * s * w);
    }
    g.lookAt(nrm); // the cushion's flat side against the bark
    g.rotateX(0); g.translate(p.x, p.y, p.z);
    g.computeVertexNormals();
    const cnt = pa.count;
    const green = rng.range(0.8, 1.15), glow = rng.chance(0.4) ? 1 : 0;
    const col = [], aux = [], uv = [];
    for (let i = 0; i < cnt; i++) {
      const ny = g.attributes.normal.getY(i);
      col.push(0.12 * green, 0.24 * green, 0.07 * green);
      aux.push(0.55 + 0.45 * clamp(ny * 0.5 + 0.5, 0, 1), glow * 0.8, 0, 0); uv.push(0, 0);
    }
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aAux', new THREE.Float32BufferAttribute(aux, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    parts.push(g);
  }
  blobBase.dispose();
  return { parts, limbs, axis, girth };
}

/* ------------------------------------------------------------------ */
/* Ridges, scrub, crest trees and far mountains                          */
/* ------------------------------------------------------------------ */
function buildLand(seed, land) {
  const rng = makeRng(seed + 7);
  const n = land.n;
  const parts = [];
  const span = VISTA.span;
  // a ridge strip in polar coordinates: columns along the arc, rows across it
  const strip = (Rf, Hf, rowsU, cols, tint) => {
    const pos = [], nor = [], uv = [], col = [], aux = [], idx = [];
    for (let i = 0; i <= cols; i++) {
      const th = -span + (i / cols) * span * 2;
      for (let j = 0; j < rowsU.length; j++) {
        const r = Rf(th) - rowsU[j];
        const p = polar(th, r);
        const y = Hf(th, r);
        pos.push(p.x, y, p.z);
        nor.push(0, 1, 0); uv.push(0, 0);
        // forest canopy on the slopes (darker, mottled), open meadow along the crest (lighter, warmer)
        const crest = Math.exp(-Math.pow(rowsU[j] / 5.5, 2));
        const f = n.noise2(th * 9, r * 0.04) * 0.5 + 0.5;
        const k = (0.75 + 0.5 * f) * (1 - 0.25 * (1 - crest));
        col.push(tint[0] * k * (1 + 0.9 * crest), tint[1] * k * (1 + 0.55 * crest), tint[2] * k * (1 + 0.3 * crest));
        aux.push(1, 0, 0, 1);
      }
    }
    const R = rowsU.length;
    for (let i = 0; i < cols; i++) for (let j = 0; j < R - 1; j++) {
      const a = i * R + j, b = a + 1, c = a + R, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
    const g = makeGeo(pos, nor, uv, col, aux, idx);
    g.computeVertexNormals();
    return g;
  };
  // the near ridge: from below the plateau line up over the rounded crest and down into the valley
  parts.push(strip(land.nearR, land.nearH, [34, 24, 16, 10, 6, 3, 1, -1, -3, -6, -10, -16, -24, -34, -46], 96, [0.075, 0.1, 0.045]));
  parts.push(strip(land.farR, land.farH, [40, 26, 16, 9, 4, 1, -2, -6, -12, -22, -36], 80, [0.065, 0.085, 0.05]));
  // far mountain ranges: tall, steep, deep in the haze
  const mnt = (R0, H0, amp, kx, tint, seedK) => strip(
    th => R0 + 30 * n.noise2(th * 1.1, seedK),
    (th, r) => {
      const u = R0 + 30 * n.noise2(th * 1.1, seedK) - r;
      const peak = H0 + amp * (n.ridged2(th * kx + seedK, seedK * 0.7, 4) - 0.5) + amp * 0.6 * n.noise2(th * kx * 2.3, seedK + 3);
      return peak - Math.abs(u) * 0.55;
    }, [90, 50, 20, 0, -20, -50], 120, tint);
  parts.push(mnt(275, 82, 64, 3.1, [0.06, 0.08, 0.07], 17.3));
  parts.push(mnt(430, 140, 90, 2.2, [0.06, 0.075, 0.08], 41.9));
  // trees and shrubs on both ridges: clusters of smooth, lumpy crowns (opaque: no cut-out edges to shimmer at this
  // distance). The walkway along each crest stays open meadow; trees stand a little below it on both slopes, so the
  // giants tower over them.
  const blobHi = mergeVertices(new THREE.IcosahedronGeometry(1, 1).deleteAttribute('normal').deleteAttribute('uv'));
  const blobLo = mergeVertices(new THREE.IcosahedronGeometry(1, 0).deleteAttribute('normal').deleteAttribute('uv'));
  const perches = [];
  const crown = (p, s, sy, colr, base, hi) => {
    const g = (hi ? blobHi : blobLo).clone();
    const pa = g.attributes.position;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i), y = pa.getY(i), z = pa.getZ(i);
      const w = 1 + 0.2 * n.noise3(x * 1.9 + p.x * 0.7, y * 1.9, z * 1.9 + p.z * 0.7);
      // flatter underside, a fuller dome on top
      pa.setXYZ(i, x * s * w, (y < 0 ? y * 0.55 : y) * s * sy * w, z * s * w);
    }
    g.translate(p.x, p.y + base, p.z);
    g.computeVertexNormals();
    const cnt = pa.count, col = [], aux = [], uv = [];
    for (let i = 0; i < cnt; i++) {
      const ny = g.attributes.normal.getY(i);
      const top = clamp(ny * 0.5 + 0.5, 0, 1);
      const k = 0.7 + 0.45 * top;
      col.push(colr[0] * k * (0.9 + 0.2 * top), colr[1] * k, colr[2] * k * (0.95 - 0.1 * top));
      aux.push(0.35 + 0.65 * top, 0, 0, 0.35); uv.push(0, 0);
    }
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aAux', new THREE.Float32BufferAttribute(aux, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    parts.push(g);
  };
  const trunk = (p, h, r) => {
    const g = new THREE.CylinderGeometry(r * 0.55, r, h, 5, 1, true);
    g.translate(p.x, p.y + h / 2, p.z);
    const cnt = g.attributes.position.count, col = [], aux = [];
    for (let i = 0; i < cnt; i++) { col.push(0.05, 0.042, 0.034); aux.push(0.6, 0, 0, 0); }
    g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aAux', new THREE.Float32BufferAttribute(aux, 4));
    parts.push(g);
  };
  const greens = [[0.05, 0.09, 0.03], [0.065, 0.1, 0.035], [0.045, 0.08, 0.035], [0.08, 0.1, 0.035], [0.055, 0.085, 0.045]];
  const tree = (Rf, H, th, u, h, s, near) => {
    const r = Rf(th) - u;
    const p = polar(th, r);
    p.y = H(th, r) - 0.3;
    const colr = greens[rng.int(0, greens.length - 1)];
    trunk(p, h, s * 0.13);
    const nb = rng.int(2, 3);
    for (let b = 0; b < nb; b++) {
      const q = p.clone().add(new THREE.Vector3(rng.range(-0.6, 0.6) * s, 0, rng.range(-0.6, 0.6) * s));
      crown(q, s * (b ? rng.range(0.6, 0.8) : 1), rng.range(0.7, 0.9), colr, h - s * 0.35 + (b ? rng.range(-0.4, 0.5) * s : 0), near);
    }
    perches.push({ pos: new THREE.Vector3(p.x, p.y + h + s * 0.6, p.z), near, th });
  };
  // near ridge: a line of trees just behind the crest, a few lower ones on its face, shrubs along the flanks
  for (let k = 0; k < 34; k++) tree(land.nearR, land.nearH, rng.range(-span * 0.9, span * 0.9), -rng.range(6, 17), rng.range(5, 8.5), rng.range(1.7, 2.9), true);
  for (let k = 0; k < 9; k++) tree(land.nearR, land.nearH, rng.range(-0.8, 0.8), rng.range(7, 12), rng.range(4.5, 7), rng.range(1.5, 2.4), true);
  for (let k = 0; k < 70; k++) {
    const th = rng.range(-span * 0.9, span * 0.9), u = rng.chance(0.5) ? rng.range(4, 9) : -rng.range(4, 12);
    const r = land.nearR(th) - u, p = polar(th, r);
    p.y = land.nearH(th, r) - 0.25;
    crown(p, rng.range(0.8, 1.6), rng.range(0.55, 0.75), greens[rng.int(0, greens.length - 1)], 0.1, false);
  }
  // far ridge: trees behind its crest
  for (let k = 0; k < 30; k++) tree(land.farR, land.farH, rng.range(-span * 0.8, span * 0.8), -rng.range(5, 16), rng.range(6, 10), rng.range(2.2, 3.4), false);
  blobHi.dispose(); blobLo.dispose();
  return { parts, perches };
}

/* ------------------------------------------------------------------ */
/* Material                                                             */
/* ------------------------------------------------------------------ */
function vistaMaterial(shared, vistaU, barkTex) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, ...vistaU, tBark: { value: barkTex } },
    vertexShader: /* glsl */`
      attribute vec3 aCol; attribute vec4 aAux;
      varying vec3 vWorldP; varying vec3 vN; varying vec2 vUv; varying vec3 vCol; varying vec4 vAux;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
        vUv = uv; vCol = aCol; vAux = aAux;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      ${JG_GLSL}
      ${VISTA_GLSL}
      uniform sampler2D tBark;
      varying vec3 vN; varying vec2 vUv; varying vec3 vCol; varying vec4 vAux;
      void main(){
        vec3 N = normalize(vN);
        vec3 d = vWorldP - cameraPosition;
        float tSurf = length(d);
        vec3 rd = d / tSurf;
        vec3 V = -rd;
        if (dot(N, V) < 0.0) N = -N; // thin open parts (crest tree trunks) seen from behind
        float bark = vAux.z;
        vec4 bt = texture2D(tBark, vUv);
        vec3 albedo = vCol;
        if (bark > 0.0) {
          // bark relief: a tangent frame from screen-space derivatives (as three.js does without tangents)
          vec3 q0 = dFdx(vWorldP), q1 = dFdy(vWorldP);
          vec2 st0 = dFdx(vUv), st1 = dFdy(vUv);
          vec3 q1perp = cross(q1, N), q0perp = cross(N, q0);
          vec3 T = q1perp * st0.x + q0perp * st1.x, B = q1perp * st0.y + q0perp * st1.y;
          float det = max(dot(T, T), dot(B, B));
          float sc = det == 0.0 ? 0.0 : inversesqrt(det);
          vec2 g = bt.rg * 2.0 - 1.0;
          N = normalize(N - (T * g.x + B * g.y) * sc * 0.9 * bark);
          albedo *= mix(1.0, bt.b * 1.7, bark);
          albedo = mix(albedo, uMossColor * vec3(0.32, 0.4, 0.22), bark * smoothstep(0.45, 0.85, bt.a) * 0.55);
        }
        // the ridges: canopy mottling
        float mot = texture2D(uCookieTex, vWorldP.xz * 0.011).r;
        albedo *= mix(1.0, 0.7 + 0.6 * mot, vAux.w);
        vec3 col = vistaLight(albedo, N, V, vAux.x, 0.3);
        // glowing moss in the folds of the roots: breathes slowly, each patch in its own time
        col += uFarGlow * vAux.y * uNight * (0.5 + 0.5 * sin(uGlowPh + vWorldP.y * 0.31 + vWorldP.x * 0.17)) * (1.0 - 0.6 * bark * (1.0 - bt.a)) * 0.9;
        // the crown is lost in luminous haze far above
        float hi = smoothstep(55.0, 125.0, vWorldP.y) * bark;
        col = mix(col, mix(uHazeCol, uMistCol, 0.5), hi * 0.92);
        gl_FragColor = vec4(vistaAtmos(col, vWorldP, tSurf, rd), 1.0);
      }`,
    extensions: { derivatives: true },
  });
}

/**
 * Build the vista. Returns { mesh, land, perches (egret roosts), treeTop, shaftAnchors, dispose }.
 */
export function buildVista(shared, vistaU, seed) {
  const land = createLand(seed);
  const th = VISTA.tree.th, r = VISTA.tree.r;
  const tb = polar(th, r);
  tb.y = land.groundAt(tb.x, tb.z) - 4;
  const tree = buildAncientTree(seed + 3, tb, land);
  const ground = buildLand(seed, land);
  // all parts indexed (tubes share their vertices; the small blobs get a trivial index), then merged into one draw
  const all = [...tree.parts, ...ground.parts].map(g => { if (!g.index) { const n = g.attributes.position.count, ix = new (n > 65535 ? Uint32Array : Uint16Array)(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); } return g; });
  for (const g of all) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'aCol', 'aAux'].includes(k)) g.deleteAttribute(k);
  const geo = mergeGeometries(all);
  tree.parts.forEach(g => g.dispose()); ground.parts.forEach(g => g.dispose()); all.forEach(g => g.dispose());
  geo.computeBoundingSphere();
  const bark = barkTexture(seed + 77);
  const mat = vistaMaterial(shared, vistaU, bark);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'vista';
  mesh.frustumCulled = false; // spans the whole horizon
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.layers.set(1);
  // god-ray anchors in the valley around the tree: tall shafts slanting down through its crown into the mist
  const rr = makeRng(seed + 99);
  const shaftAnchors = [];
  for (let i = 0; i < 5; i++) {
    const a = th + rr.range(-0.35, 0.35), rad = r + rr.range(-14, 22);
    const p = polar(a, rad);
    p.y = rr.range(26, 34);
    shaftAnchors.push({ pos: p, width: rr.range(5, 9), len: rr.range(70, 110), k: rr.range(0.5, 0.9) });
  }
  return {
    mesh, land, material: mat, bark,
    perches: ground.perches,
    treeBase: tb, treeAxis: tree.axis, treeGirth: tree.girth,
    shaftAnchors,
    dispose() { bark.dispose(); mat.dispose(); geo.dispose(); },
  };
}
