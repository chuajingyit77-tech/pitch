// 晴岛 · 座头鲸 — the gentle giant. Every few minutes a humpback whale (now and then with her calf) passes far out
// at sea: she rises out of the blue, blows, rolls her back and hump through the surface, breaches once or twice
// (rises out of the sea, turns and falls back in a white burst), blows once more and lifts her flukes as she sounds.
//
// Model: one lofted body (countershaded, ventral pleats, a knobbly rostrum, barnacles and scars painted on), long
// white pectoral fins with scalloped leading edges, a small dorsal fin on its hump and serrated flukes. A 21-joint
// spine bends it in the vertex shader (joint positions and rotations are uniforms), so a whale is one draw call.
//
// Motion: a pass is planned once, when it starts, in the frame of the camera (which orbits slowly in the
// screensaver), so it crosses the view, and precomputed at a fixed step into a track. The body follows its own path
// like a train on a track (each joint sits on the path where the root was or will be), so it never slides; the tail
// beat, the head lift for a breath and the fluke lift of a dive are layered on top. Out of the water (a breach) it is
// a rigid body on a ballistic arc that turns as it falls. At runtime everything is interpolated from the track by the
// pass clock, so it moves the same at 30 and 60 fps. Between passes nothing is drawn or updated.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, smoothstep, damp, angleDelta, makeRng, makeCanvas, patchMaterial } from '../../lib/util.js';
import { waterUniforms, UNDERWATER_GLSL, LAYER_NO_REFLECT } from './shared.js';
import { waveHeight } from './water.js';

export const L0 = 14;          // the model's length (m); the calf is the same model, scaled
const U_C = 0.4;               // the root (centre of mass): a joint, u = JC / (NJ - 1)
export const NJ = 21;
const JC = 8;
const UJ = new Float64Array(NJ);
for (let j = 0; j < NJ; j++) UJ[j] = j / (NJ - 1);
const DT0 = 1 / 30;            // track step (s)
const MAXT = 100;              // longest pass (s)
const G = 9.8;
const LIFT = 1.3;              // how far the tail lifts over the arch of a fluke-up dive (rad)

/* ================================================================== */
/* Shape                                                               */
/* ================================================================== */
// body profile, fractions of the length: u (snout 0 → fluke notch 1), half-width, dorsal and ventral half-height
const PROF = [
  [0.000, 0.012, 0.006, 0.006],
  [0.006, 0.026, 0.010, 0.012],
  [0.020, 0.043, 0.015, 0.021],
  [0.060, 0.061, 0.024, 0.040],
  [0.120, 0.074, 0.034, 0.060],
  [0.180, 0.084, 0.043, 0.075],
  [0.250, 0.092, 0.054, 0.086],
  [0.320, 0.097, 0.063, 0.091],
  [0.400, 0.098, 0.069, 0.089],
  [0.480, 0.093, 0.071, 0.078],
  [0.560, 0.083, 0.069, 0.064],
  [0.630, 0.068, 0.064, 0.053],
  [0.700, 0.051, 0.056, 0.044],
  [0.780, 0.034, 0.045, 0.035],
  [0.860, 0.022, 0.033, 0.027],
  [0.930, 0.015, 0.022, 0.018],
  [0.970, 0.012, 0.015, 0.012],
  [1.000, 0.007, 0.007, 0.006],
];
function interp(keys, col) {
  const n = keys.length;
  const m = keys.map((k, i) => {
    const a = keys[Math.max(0, i - 1)], b = keys[Math.min(n - 1, i + 1)];
    return (b[col] - a[col]) / (b[0] - a[0]);
  });
  return u => {
    if (u <= keys[0][0]) return keys[0][col];
    if (u >= keys[n - 1][0]) return keys[n - 1][col];
    let i = 0;
    while (u > keys[i + 1][0]) i++;
    const h = keys[i + 1][0] - keys[i][0], t = (u - keys[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * keys[i][col] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * keys[i + 1][col] + (t3 - t2) * h * m[i + 1];
  };
}
export const PW = interp(PROF, 1), PHD = interp(PROF, 2), PHV = interp(PROF, 3);
const centreY = u => -0.008 * (1 - smoothstep(0, 0.35, u)) + 0.002 * smoothstep(0.7, 1, u);

// texture atlas (1024 x 512): body (v 0 dorsal → 1 ventral midline), then a strip for the flippers and one for the flukes
const TW = 1024, TH = 512;
const BODY0 = 2, BODY1 = 350, PEC0 = 368, PEC1 = 432, FLK0 = 448, FLK1 = 510;
const uvBodyY = v => 1 - (BODY0 + v * (BODY1 - BODY0)) / TH;
const uvStrip = (r0, r1, x01, under, c01) => [(8 + x01 * (TW - 16)) / TW, 1 - (r0 + (under ? 0.5 : 0) * (r1 - r0) + (1 + c01 * 29) / 32 * 0.5 * (r1 - r0)) / TH];

/** NACA 00xx thickness, normalised to 0.5 at its thickest (30 % chord); x: 0 leading → 1 trailing edge. */
const naca = x => 5 * (0.2969 * Math.sqrt(Math.max(x, 0)) - 0.126 * x - 0.3516 * x * x + 0.2843 * x * x * x - 0.1036 * x * x * x * x);

/** Average the normals of vertices that share a position (loft seams, duplicated UV edges). */
function weldNormals(geo) {
  const p = geo.attributes.position, n = geo.attributes.normal, map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 1e4)},${Math.round(p.getY(i) * 1e4)},${Math.round(p.getZ(i) * 1e4)}`;
    let l = map.get(k);
    if (!l) map.set(k, l = []);
    l.push(i);
  }
  const v = new THREE.Vector3();
  for (const l of map.values()) {
    if (l.length < 2) continue;
    v.set(0, 0, 0);
    for (const i of l) v.x += n.getX(i), v.y += n.getY(i), v.z += n.getZ(i);
    v.normalize();
    for (const i of l) n.setXYZ(i, v.x, v.y, v.z);
  }
  n.needsUpdate = true;
}

function makeGeo(pos, uv, sp, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aSp', new THREE.Float32BufferAttribute(sp, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * A fin: airfoil sections along a span. Each station: centre p, unit chord direction c (toward the leading edge),
 * unit thickness direction t, chord and thickness (m), its span position x01 and its spine u. The section's upper
 * half (+t) and lower half get their own atlas rows (the trailing and leading edge vertices are doubled for that).
 */
function finLoft(stations, NA, part, uvOf) {
  const pos = [], uv = [], sp = [], idx = [];
  const half = NA / 2, ring = NA + 2;
  for (const S of stations) {
    for (let k = 0; k < ring; k++) {
      const under = k > half;
      const kk = under ? k - 1 : k;                // the trailing edge (θ = π) appears twice
      const th = kk / NA * TAU;
      const xc = 0.5 * (1 - Math.cos(th));
      const yt = naca(xc) * S.thick * (under ? -1 : 1);
      const al = (0.5 - xc) * S.chord;
      pos.push(S.p.x + S.c.x * al + S.t.x * yt, S.p.y + S.c.y * al + S.t.y * yt, S.p.z + S.c.z * al + S.t.z * yt);
      const t = uvOf(S.x01, under, xc);
      uv.push(t[0], t[1]);
      sp.push(S.u, part);
    }
  }
  for (let i = 0; i < stations.length - 1; i++) for (let k = 0; k < ring - 1; k++) {
    if (k === half) continue;                      // the doubled trailing edge: no gap to fill
    const a = i * ring + k, b = a + 1, c = a + ring, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = makeGeo(pos, uv, sp, idx);
  // make the upper surface face +t (the winding depends on the fin's handedness)
  const n = g.attributes.normal, S0 = stations[Math.min(2, stations.length - 1)], i0 = Math.min(2, stations.length - 1) * ring + Math.round(half / 2);
  if (n.getX(i0) * S0.t.x + n.getY(i0) * S0.t.y + n.getZ(i0) * S0.t.z < 0) {
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i += 3) { const s = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = s; }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  weldNormals(g);
  return g;
}

/**
 * The humpback, 14 m, head toward +X, back +Y, right side +Z, the root (centre of mass, u = 0.4) at the origin.
 * Attribute aSp = (spine u, part: 0 body, 1 left flipper, 2 right flipper, 3 flukes).
 */
export function buildHumpback(q = 1) {
  const L = L0;
  const NS = q >= 0.7 ? 72 : 60, NR = q >= 0.7 ? 32 : 28;
  /* ---- body ---- */
  const pos = [], uv = [], sp = [], idx = [];
  const uOf = t => t - 0.36 * Math.sin(TAU * t) / TAU;   // rings gather at the head and at the tail stock
  for (let i = 0; i <= NS; i++) {
    const u = uOf(i / NS);
    const w = PW(u) * L, hd = PHD(u) * L, hv = PHV(u) * L, c = centreY(u) * L;
    const e = 2 / lerp(2.25, 1.6, smoothstep(0.64, 0.84, u)); // superellipse: full body → keeled tail stock
    const x = (U_C - u) * L;
    for (let j = 0; j <= NR; j++) {
      const a = j / NR * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const yy = Math.sign(ca) * Math.pow(Math.abs(ca), e), zz = Math.sign(sa) * Math.pow(Math.abs(sa), e);
      const H = lerp(hv, hd, smoothstep(-0.35, 0.35, ca));
      pos.push(x, c + H * yy, w * zz);
      const v = a <= Math.PI ? a / Math.PI : 2 - a / Math.PI;
      uv.push(u, uvBodyY(v));
      sp.push(u, 0);
    }
  }
  const R1 = NR + 1;
  for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) {
    const a = i * R1 + j, b = a + 1, c = a + R1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // caps: the snout and the end of the tail stock (inside the flukes)
  const capN = pos.length / 3;
  pos.push(U_C * L + 0.004 * L, centreY(0) * L, 0); uv.push(0, uvBodyY(0.5)); sp.push(0, 0);
  for (let j = 0; j < NR; j++) idx.push(capN, j + 1, j);
  const capT = pos.length / 3, lastRing = NS * R1;
  pos.push((U_C - 1) * L - 0.003 * L, centreY(1) * L, 0); uv.push(1, uvBodyY(0.5)); sp.push(1, 0);
  for (let j = 0; j < NR; j++) idx.push(capT, lastRing + j, lastRing + j + 1);
  const body = makeGeo(pos, uv, sp, idx);
  weldNormals(body);

  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  /* ---- dorsal fin, on its hump ---- */
  const uf = 0.635, xf = (U_C - uf) * L, yb = (centreY(uf) + PHD(uf)) * L - 0.012 * L;
  const dst = [];
  for (let i = 0; i <= 8; i++) {
    const h = i / 8;
    dst.push({ p: V(xf - 0.018 * L * Math.pow(h, 1.4), yb + h * 0.031 * L, 0), c: V(1, 0, 0), t: V(0, 0, 1),
      chord: 0.062 * L * Math.pow(1 - h, 0.8) + 0.004 * L, thick: 0.009 * L * (1 - 0.65 * h), x01: h, u: uf });
  }
  const dorsal = finLoft(dst, 10, 0, (x01, under, xc) => [uf - 0.012 + xc * 0.03, uvBodyY(0.015 + 0.02 * x01)]);
  // its vertices bend with the spine at their own u
  { const p = dorsal.attributes.position, s = dorsal.attributes.aSp; for (let i = 0; i < p.count; i++) s.setX(i, clamp(U_C - p.getX(i) / L, 0, 1)); }

  /* ---- flippers ---- */
  const pecRoot = [];
  const pecs = [-1, 1].map(side => {
    const up = 0.3, xr = (U_C - up) * L + 0.012 * L;
    const root = V(xr, (centreY(up) - 0.42 * PHV(up)) * L, side * 0.84 * PW(up) * L);
    pecRoot.push(root);
    const Ds = V(-0.36, -0.2, 0.91 * side).normalize();
    const Dc = V(1, 0.12, 0).addScaledVector(Ds, -Ds.dot(V(1, 0.12, 0))).normalize();
    let Dt = new THREE.Vector3().crossVectors(Dc, Ds).normalize();
    if (Dt.y < 0) Dt.negate();
    const Lp = 0.31 * L, st = [];
    const NP = q >= 0.7 ? 24 : 20;
    for (let i = 0; i <= NP; i++) {
      const t = 1 - Math.pow(1 - i / NP, 1.25);     // denser toward the rounded tip
      const tip = t > 0.72 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.72) / 0.28, 2))) : 1;
      // tubercles: the scalloped leading edge
      const bump = 0.0042 * L * Math.pow(Math.max(0, Math.sin(t * 10.5 * Math.PI)), 2) * smoothstep(0.04, 0.12, t) * (1 - smoothstep(0.85, 0.98, t));
      const chord = 0.056 * L * lerp(0.82, 1, smoothstep(0, 0.18, t)) * Math.max(tip, 0.02) + bump;
      const p = root.clone().addScaledVector(Ds, t * Lp).addScaledVector(Dc, bump * 0.5 - 0.03 * L * t * t).addScaledVector(Dt, -0.02 * L * t * t);
      st.push({ p, c: Dc, t: Dt, chord, thick: 0.011 * L * (1 - 0.6 * t) * Math.max(tip, 0.15), x01: t, u: up });
    }
    return finLoft(st, 10, side < 0 ? 1 : 2, (x01, under, xc) => uvStrip(PEC0, PEC1, x01, under, xc));
  });

  /* ---- flukes: broad, swept, pointed tips, a notch and a serrated trailing edge ---- */
  const xn = (U_C - 1) * L, b = 0.165 * L;
  const flLE = s => (0.4 - 0.28 * Math.pow(s, 1.5)) * b;
  const flTE = s => (-0.06 - 0.22 * Math.pow(s, 1.8) + 0.06 * (1 - smoothstep(0, 0.12, s))) * b
    - 0.016 * b * Math.abs(Math.sin(s * 7 * Math.PI)) * smoothstep(0.1, 0.25, s);
  const flukes = [-1, 1].map(side => {
    const st = [];
    const NF = q >= 0.7 ? 22 : 18;
    for (let i = 0; i <= NF; i++) {
      const s = i / NF;
      const le = flLE(s), te = flTE(s);
      const tipK = 1 - 0.97 * Math.pow(smoothstep(0.68, 1, s), 1.3);
      const chord = (le - te) * tipK, mid = (le + te) / 2 - (le - te) * (1 - tipK) * 0.22;
      st.push({ p: V(xn + mid, 0.02 * b * s * s, side * s * b), c: V(1, 0, 0), t: V(0, 1, 0),
        chord, thick: 0.014 * L * (1 - 0.75 * s), x01: 0.5 + 0.5 * side * s, u: 1 });
    }
    const g = finLoft(st, 10, 3, (x01, under, xc) => uvStrip(FLK0, FLK1, x01, under, xc));
    const p = g.attributes.position, sa = g.attributes.aSp;
    for (let i = 0; i < p.count; i++) sa.setX(i, clamp(U_C - p.getX(i) / L, 0.9, 1));
    return g;
  });

  const geo = mergeGeometries([body, dorsal, ...pecs, ...flukes]);
  [body, dorsal, ...pecs, ...flukes].forEach(g => g.dispose());
  geo.computeBoundingSphere();
  geo.boundingSphere.radius = L * 0.75;
  // points the runtime uses (rest pose): the blowhole, the dorsal line, the flukes' trailing edge
  const flukeTE = [];
  for (const s of [-0.85, -0.55, -0.25, 0.25, 0.55, 0.85]) {
    const a = Math.abs(s);
    flukeTE.push(new THREE.Vector3(flTE(a), 0.02 * b * a * a, s * b)); // relative to the notch
  }
  return { geo, pecRoot, flukeTE };
}

/* ================================================================== */
/* Surface                                                             */
/* ================================================================== */
function valueNoise(rng) {
  const N = 256, T = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) T[i] = rng.next() * 2 - 1;
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const x0 = xi & 255, y0 = yi & 255, x1 = (x0 + 1) & 255, y1 = (y0 + 1) & 255;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = T[y0 * N + x0], b = T[y0 * N + x1], c = T[y1 * N + x0], d = T[y1 * N + x1];
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}

/**
 * Painted skin (colour + height → normal map). Countershading: slate-black back and flanks, a white throat and
 * belly with a ragged boundary and grey marbling, the ventral pleats, rows of knobs (tubercles) on the rostrum and
 * the lower jaw, barnacle clusters, pale rake scars, the mouth line and the eye; white flippers with dark patches at
 * the root; flukes dark above, patterned black and white below.
 */
export function paintHumpback(seed) {
  const rng = makeRng(seed);
  const n1 = valueNoise(rng), n2 = valueNoise(rng);
  const cv = makeCanvas(TW, TH), g = cv.getContext('2d');
  const hc = makeCanvas(TW, TH), hg = hc.getContext('2d');
  const img = g.createImageData(TW, TH), D = img.data;
  const himg = hg.createImageData(TW, TH), HD = himg.data;
  const put = (o, r, gg, b, h) => { D[o] = r; D[o + 1] = gg; D[o + 2] = b; D[o + 3] = 255; HD[o] = HD[o + 1] = HD[o + 2] = h; HD[o + 3] = 255; };
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const DARK = [24, 29, 36], FLANK = [40, 47, 56], PALE = [222, 226, 223], MARB = [128, 135, 141], WHITE = [232, 236, 233];
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const o = (y * TW + x) * 4;
      const fxp = (x + 0.5) / TW;
      if (y < 360) {
        const u = fxp, v = clamp((y + 0.5 - BODY0) / (BODY1 - BODY0), 0, 1);
        let vb = 0.62 + 0.045 * Math.sin(u * 23 + 1.3) + 0.06 * n1(u * 7, 0.5) + 0.025 * n1(u * 29, 3.3);
        vb -= 0.08 * (1 - smoothstep(0.02, 0.14, u));
        vb += 0.33 * smoothstep(0.44, 0.68, u);
        const k = smoothstep(vb - 0.03, vb + 0.03, v + 0.035 * n2(u * 55, v * 18));
        const m1 = n1(u * 70, v * 24) * 0.5 + 0.5, m2 = n2(u * 160, v * 60) * 0.5 + 0.5;
        let c = mixc(DARK, FLANK, smoothstep(0.12, 0.6, v) * 0.75);
        c = mixc(c, [c[0] * 1.18, c[1] * 1.18, c[2] * 1.16], smoothstep(0.5, 0.9, m1) * 0.4);
        let p = mixc(PALE, MARB, smoothstep(0.58, 0.82, m1 * 0.75 + m2 * 0.35) * 0.75);
        p = mixc(p, [70, 76, 84], smoothstep(0.78, 0.95, n2(u * 40 + 9, v * 13) * 0.5 + 0.5) * 0.85); // dark blotches on the belly
        // the tail stock keeps a pale ventral keel line
        const keel = smoothstep(0.93, 0.99, v) * smoothstep(0.62, 0.7, u) * (1 - smoothstep(0.88, 0.96, u)) * 0.45;
        const col = mixc(mixc(c, p, k), MARB, keel);
        const grain = 1 + (m2 - 0.5) * 0.06;
        put(o, col[0] * grain, col[1] * grain, col[2] * grain, 128 + (m2 - 0.5) * 10);
      } else if (y >= PEC0 - 6 && y < PEC1 + 6) {
        const t = fxp, yy = clamp(y + 0.5 - PEC0, 0, PEC1 - PEC0), under = yy >= (PEC1 - PEC0) / 2;
        const c01 = (yy % ((PEC1 - PEC0) / 2)) / ((PEC1 - PEC0) / 2);
        const m = n1(t * 30, c01 * 4 + (under ? 20 : 0)) * 0.5 + 0.5;
        let col = WHITE;
        if (!under) {
          const darkRoot = (1 - smoothstep(0.1, 0.42, t + (m - 0.5) * 0.25)) * 0.9;
          const spots = smoothstep(0.66, 0.8, n2(t * 22, c01 * 5)) * 0.8;
          col = mixc(col, DARK, Math.max(darkRoot, spots));
          col = mixc(col, MARB, smoothstep(0.7, 1, c01) * 0.35);
        } else col = mixc(col, MARB, smoothstep(0.75, 0.9, m) * 0.5);
        put(o, col[0], col[1], col[2], 128);
      } else if (y >= FLK0 - 6) {
        const s = fxp * 2 - 1, yy = clamp(y + 0.5 - FLK0, 0, FLK1 - FLK0), under = yy >= (FLK1 - FLK0) / 2;
        const c01 = (yy % ((FLK1 - FLK0) / 2)) / ((FLK1 - FLK0) / 2);
        let col;
        if (!under) col = mixc(DARK, FLANK, 0.35 + 0.3 * (n1(s * 9, c01 * 3) * 0.5 + 0.5));
        else {
          // the underside: white with a black trailing margin and tips, and its own black marks
          const margin = smoothstep(0.7, 0.92, c01 + 0.12 * Math.abs(s)) + smoothstep(0.8, 0.95, Math.abs(s));
          const marks = smoothstep(0.55, 0.7, n2(s * 6 + 4, c01 * 3) * 0.5 + 0.5 + 0.15 * Math.cos(s * 9));
          const centre = 1 - smoothstep(0.05, 0.16, Math.abs(s));
          col = mixc(WHITE, DARK, clamp(Math.max(margin, marks * 0.9, centre * 0.8), 0, 1));
        }
        put(o, col[0], col[1], col[2], 128);
      } else put(o, PALE[0], PALE[1], PALE[2], 128);
    }
  }
  g.putImageData(img, 0, 0);
  hg.putImageData(himg, 0, 0);
  const X = u => u * TW, Y = v => BODY0 + v * (BODY1 - BODY0);
  const knob = (x, y, r, dark = 0.7) => {
    let gr = g.createRadialGradient(x, y, 0, x, y, r * 1.6);
    gr.addColorStop(0, `rgba(20,23,27,${dark})`); gr.addColorStop(0.55, `rgba(30,34,38,${dark * 0.7})`); gr.addColorStop(0.75, 'rgba(120,126,132,0.35)'); gr.addColorStop(1, 'rgba(120,126,132,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 1.6, 0, TAU); g.fill();
    gr = hg.createRadialGradient(x, y, 0, x, y, r * 1.5);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.7, 'rgba(200,200,200,0.4)'); gr.addColorStop(1, 'rgba(128,128,128,0)');
    hg.fillStyle = gr; hg.beginPath(); hg.arc(x, y, r * 1.5, 0, TAU); hg.fill();
  };
  const barnacle = (x, y, r) => {
    g.fillStyle = `rgba(${200 + rng.int(0, 30)},${200 + rng.int(0, 28)},${192 + rng.int(0, 25)},0.85)`;
    g.beginPath(); g.ellipse(x, y, r, r * rng.range(0.7, 1), rng.range(0, TAU), 0, TAU); g.fill();
    g.fillStyle = 'rgba(60,62,60,0.7)'; g.beginPath(); g.arc(x, y, r * 0.35, 0, TAU); g.fill();
    hg.fillStyle = 'rgba(235,235,235,0.9)'; hg.beginPath(); hg.arc(x, y, r, 0, TAU); hg.fill();
  };
  // ventral pleats: grooves from the chin to the navel, gathering toward the chin
  for (let k = 0; k < 26; k++) {
    const v0 = 1 - k * 0.0118, uEnd = 0.47 - 0.12 * Math.pow(k / 26, 1.4) + rng.range(-0.012, 0.012);
    const path = c => {
      c.beginPath();
      for (let s = 0; s <= 48; s++) {
        const u = 0.024 + (uEnd - 0.024) * s / 48;
        const v = 1 - (1 - v0) * (0.3 + 0.7 * smoothstep(0.02, 0.13, u)) + 0.003 * Math.sin(u * 70 + k * 1.7);
        if (s) c.lineTo(X(u), Y(v)); else c.moveTo(X(u), Y(v));
      }
    };
    path(g); g.strokeStyle = 'rgba(58,62,68,0.5)'; g.lineWidth = 1.4; g.stroke();
    g.save(); g.translate(0, 1.3); path(g); g.strokeStyle = 'rgba(250,252,250,0.22)'; g.lineWidth = 1; g.stroke(); g.restore();
    path(hg); hg.strokeStyle = 'rgba(40,40,40,0.85)'; hg.lineWidth = 2.2; hg.stroke();
  }
  // tubercles: three rows along the rostrum, two along the lower jaw
  for (const [v0, n] of [[0.025, 11], [0.085, 10], [0.15, 8]]) {
    for (let i = 0; i < n; i++) {
      const u = 0.018 + i * (0.15 / n) + rng.range(-0.004, 0.004);
      knob(X(u), Y(v0 + rng.range(-0.012, 0.012) + u * 0.12), rng.range(2.4, 3.4));
    }
  }
  for (const v0 of [0.53, 0.6]) {
    for (let i = 0; i < 9; i++) {
      const u = 0.012 + i * 0.016 + rng.range(-0.004, 0.004);
      knob(X(u), Y(v0 + rng.range(-0.012, 0.012) - u * 0.25), rng.range(2.2, 3.0), 0.55);
    }
  }
  // the mouth line, the eye, the blowholes
  g.strokeStyle = 'rgba(10,12,14,0.9)'; g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(X(0.004), Y(0.47)); g.quadraticCurveTo(X(0.1), Y(0.47), X(0.19), Y(0.415)); g.stroke();
  g.strokeStyle = 'rgba(190,195,198,0.35)'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(X(0.006), Y(0.485)); g.quadraticCurveTo(X(0.1), Y(0.485), X(0.19), Y(0.43)); g.stroke();
  hg.strokeStyle = 'rgba(30,30,30,0.9)'; hg.lineWidth = 2.4;
  hg.beginPath(); hg.moveTo(X(0.004), Y(0.47)); hg.quadraticCurveTo(X(0.1), Y(0.47), X(0.19), Y(0.415)); hg.stroke();
  g.fillStyle = 'rgba(95,100,104,0.8)'; g.beginPath(); g.ellipse(X(0.205), Y(0.43), 7, 5, 0, 0, TAU); g.fill();
  g.fillStyle = '#07090b'; g.beginPath(); g.ellipse(X(0.205), Y(0.43), 4.2, 3, 0, 0, TAU); g.fill();
  for (const dv of [0.004, 0.022]) { g.fillStyle = 'rgba(8,10,12,0.9)'; g.beginPath(); g.ellipse(X(0.172), Y(dv), 5, 1.6, 0.1, 0, TAU); g.fill(); }
  { const gr = hg.createRadialGradient(X(0.17), Y(0.012), 0, X(0.17), Y(0.012), 14); gr.addColorStop(0, 'rgba(230,230,230,0.8)'); gr.addColorStop(1, 'rgba(128,128,128,0)'); hg.fillStyle = gr; hg.beginPath(); hg.arc(X(0.17), Y(0.012), 14, 0, TAU); hg.fill(); }
  // barnacles: the chin, the throat, the genital region; the flippers' leading edge and tips
  for (let i = 0; i < 70; i++) barnacle(X(rng.range(0.004, 0.06)), Y(rng.range(0.45, 0.98)), rng.range(1.3, 2.6));
  for (let i = 0; i < 30; i++) barnacle(X(rng.range(0.08, 0.16)), Y(rng.range(0.9, 1.0)), rng.range(1.2, 2.2));
  for (let i = 0; i < 14; i++) barnacle(X(rng.range(0.53, 0.58)), Y(rng.range(0.94, 1.0)), rng.range(1.0, 1.8));
  for (let i = 0; i < 40; i++) {
    const t = rng.range(0.1, 0.98), under = rng.chance(0.4);
    const r0 = PEC0 + (under ? 32 : 0);
    barnacle(8 + t * (TW - 16), r0 + rng.range(1, 6), rng.range(1.1, 2.0));
  }
  // rake scars on the dark flanks and back
  for (let s = 0; s < 7; s++) {
    const u = rng.range(0.32, 0.88), v = rng.range(0.08, 0.5), ang = rng.range(-0.6, 0.6), len = rng.range(18, 46);
    for (let k = 0; k < rng.int(2, 4); k++) {
      g.strokeStyle = `rgba(170,176,182,${rng.range(0.3, 0.5)})`; g.lineWidth = rng.range(0.8, 1.4);
      g.beginPath();
      const x0 = X(u) + k * 4 * Math.sin(ang), y0 = Y(v) + k * 4 * Math.cos(ang);
      g.moveTo(x0, y0); g.quadraticCurveTo(x0 + Math.cos(ang) * len * 0.5, y0 - Math.sin(ang) * len * 0.5 + 3, x0 + Math.cos(ang) * len, y0 - Math.sin(ang) * len);
      g.stroke();
    }
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  map.needsUpdate = true;
  const normalMap = normalFromHeight(hc, 2.4);
  return { map, normalMap };
}
function normalFromHeight(hc, strength) {
  const w = hc.width, h = hc.height;
  const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h * 4);
  const H = (x, y) => src[(clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * strength, dy = (H(x, y + 1) - H(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = ((h - 1 - y) * w + x) * 4; // rows flipped: uv v grows upward
    data[i] = (-dx / l * 0.5 + 0.5) * 255; data[i + 1] = (dy / l * 0.5 + 0.5) * 255; data[i + 2] = (1 / l * 0.5 + 0.5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = THREE.NoColorSpace;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/* ================================================================== */
/* Material: the spine in the vertex shader                            */
/* ================================================================== */
const VERT_HEAD = /* glsl */`
attribute vec2 aSp;
uniform vec4 uSpP[${NJ}];
uniform vec4 uSpQ[${NJ}];
uniform mat3 uPecL, uPecR;
uniform vec3 uPecRootL, uPecRootR;
uniform float uFlex;
varying vec3 vWhW;
vec3 whRot(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
`;
const VERT_SPINE = /* glsl */`
vec3 objectNormal = vec3(normal);
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif
vec3 whPos;
{
  float su = clamp(aSp.x, 0.0, 1.0) * ${(NJ - 1).toFixed(1)};
  float fi = min(floor(su), ${(NJ - 2).toFixed(1)});
  int i0 = int(fi);
  float f = su - fi;
  vec4 qa = uSpQ[i0];
  vec4 qb = uSpQ[i0 + 1];
  if (dot(qa, qb) < 0.0) qb = -qb;
  vec4 q = normalize(mix(qa, qb, f));
  vec3 sp = mix(uSpP[i0].xyz, uSpP[i0 + 1].xyz, f);
  vec3 p = position, n = normal;
  if (aSp.y > 0.5 && aSp.y < 2.5) {
    if (aSp.y < 1.5) { p = uPecL * (position - uPecRootL) + uPecRootL; n = uPecL * normal; }
    else { p = uPecR * (position - uPecRootR) + uPecRootR; n = uPecR * normal; }
  } else if (aSp.y > 2.5) {
    // the flukes flex with the stroke: their tips trail the beat
    float zz = position.z / ${(0.165 * L0).toFixed(3)};
    p.y += uFlex * zz * zz * ${(0.05 * L0).toFixed(3)} * smoothstep(0.0, 0.04 * ${L0.toFixed(1)}, ${((U_C - 1) * L0 + 0.05 * L0).toFixed(3)} - position.x);
  }
  vec3 off = p - vec3((${U_C.toFixed(2)} - aSp.x) * ${L0.toFixed(1)}, 0.0, 0.0);
  whPos = sp + whRot(q, off);
  objectNormal = whRot(q, n);
}
`;
const FRAG_HEAD = /* glsl */`
varying vec3 vWhW;
uniform vec3 uWhRim, uWhHaze;
uniform float uWhHazeK;
${UNDERWATER_GLSL}
`;
const FRAG_TAIL = /* glsl */`
{
  // a soft sheen along the silhouette (sky or moonlight on wet skin): the dark back still reads against the sea
  float whNV = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  gl_FragColor.rgb += uWhRim * pow(1.0 - whNV, 3.0) * smoothstep(-0.4, 0.15, vWhW.y);
  gl_FragColor.rgb = underwaterFog(gl_FragColor.rgb, vWhW);
  // distance haze (above the sea only: below, the water's own colour already takes over)
  float whD = length(cameraPosition - vWhW);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uWhHaze, (1.0 - exp(-whD * uWhHazeK)) * smoothstep(-0.4, 0.3, vWhW.y));
}
`;
function makeSpineUniforms() {
  const P = [], Qs = [];
  for (let j = 0; j < NJ; j++) { P.push(new THREE.Vector4((U_C - UJ[j]) * L0, 0, 0, 0)); Qs.push(new THREE.Vector4(0, 0, 0, 1)); }
  return {
    uSpP: { value: P }, uSpQ: { value: Qs },
    uPecL: { value: new THREE.Matrix3() }, uPecR: { value: new THREE.Matrix3() },
    uPecRootL: { value: new THREE.Vector3() }, uPecRootR: { value: new THREE.Vector3() },
    uFlex: { value: 0 },
    uWhRim: { value: new THREE.Color(0, 0, 0) },
    uWhHaze: { value: new THREE.Color(0.7, 0.8, 0.9) },
    uWhHazeK: { value: 1 / 1500 },
  };
}
function makeWhaleMaterial(maps, U) {
  const m = new THREE.MeshStandardMaterial({
    name: 'Humpback', map: maps.map, normalMap: maps.normalMap, normalScale: new THREE.Vector2(0.75, 0.75),
    roughness: 0.4, metalness: 0, envMapIntensity: 0.95,
  });
  return patchMaterial(m, {
    key: 'humpback',
    uniforms: { ...waterUniforms, ...U },
    vertexHeader: VERT_HEAD,
    fragmentHeader: FRAG_HEAD,
    vertex: {
      '#include <beginnormal_vertex>': VERT_SPINE,
      '#include <begin_vertex>': '$&\n transformed = whPos;',
      '#include <fog_vertex>': '$&\n vWhW = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    },
    fragment: { '#include <opaque_fragment>': '$&\n' + FRAG_TAIL },
  });
}

/* ================================================================== */
/* Choreography                                                        */
/* ================================================================== */
/** Depth of the root over time: C2 quintic segments, a ballistic arc in the air, drag after a fall. */
function YScript() { this.segs = []; this.t = 0; this.y = 0; this.v = 0; this.a = 0; }
YScript.prototype.reset = function (y, v) { this.segs.length = 0; this.t = 0; this.y = y; this.v = v; this.a = 0; return this; };
YScript.prototype.quintic = function (d, y1, v1 = 0, a1 = 0) {
  const y0 = this.y, v0 = this.v, a0 = this.a, d2 = d * d, d3 = d2 * d, d4 = d3 * d, d5 = d4 * d;
  const c3 = (20 * (y1 - y0) - (8 * v1 + 12 * v0) * d - (3 * a0 - a1) * d2) / (2 * d3);
  const c4 = (30 * (y0 - y1) + (14 * v1 + 16 * v0) * d + (3 * a0 - 2 * a1) * d2) / (2 * d4);
  const c5 = (12 * (y1 - y0) - 6 * (v1 + v0) * d - (a0 - a1) * d2) / (2 * d5);
  this.segs.push({ type: 0, t0: this.t, d, c0: y0, c1: v0, c2: a0 / 2, c3, c4, c5 });
  this.t += d; this.y = y1; this.v = v1; this.a = a1;
  return this;
};
YScript.prototype.ballistic = function () {
  const d = 2 * this.v / G;
  this.segs.push({ type: 1, t0: this.t, d, y0: this.y, v0: this.v });
  this.t += d; this.v = -this.v; this.a = -G;
  return this;
};
YScript.prototype.drag = function (d, l) {
  const y0 = this.y, v0 = this.v, e = Math.exp(-l * d);
  this.segs.push({ type: 2, t0: this.t, d, y0, v0, l });
  this.t += d; this.y = y0 + v0 / l * (1 - e); this.v = v0 * e; this.a = -l * v0 * e;
  return this;
};
YScript.prototype.at = function (t, out) {
  const S = this.segs;
  let s = S[S.length - 1];
  for (let i = 0; i < S.length; i++) if (t < S[i].t0 + S[i].d) { s = S[i]; break; }
  let u = t - s.t0;
  if (u > s.d) { // past the end: carry on at the last speed
    this.at(s.t0 + s.d, out);
    out.y += out.v * (u - s.d);
    return out;
  }
  u = Math.max(u, 0);
  if (s.type === 0) {
    out.y = s.c0 + u * (s.c1 + u * (s.c2 + u * (s.c3 + u * (s.c4 + u * s.c5))));
    out.v = s.c1 + u * (2 * s.c2 + u * (3 * s.c3 + u * (4 * s.c4 + u * 5 * s.c5)));
  } else if (s.type === 1) { out.y = s.y0 + s.v0 * u - 0.5 * G * u * u; out.v = s.v0 - G * u; }
  else { const e = Math.exp(-s.l * u); out.y = s.y0 + s.v0 / s.l * (1 - e); out.v = s.v0 * e; }
  return out;
};
/** A value eased (smoothstep) from key to key. */
function Keys() { this.k = []; }
Keys.prototype.reset = function (v) { this.k.length = 0; this.k.push(0, v); return this; };
Keys.prototype.to = function (t, v) { this.k.push(Math.max(t, this.k[this.k.length - 2] + 1e-3), v); return this; };
Keys.prototype.hold = function (t) { return this.to(t, this.k[this.k.length - 1]); };
Keys.prototype.at = function (t) {
  const k = this.k;
  if (t <= k[0]) return k[1];
  for (let i = 2; i < k.length; i += 2) if (t < k[i]) return lerp(k[i - 1], k[i + 1], smoothstep(k[i - 2], k[i], t));
  return k[k.length - 1];
};

const CH = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'yaw', 'pit', 'rol', 's', 'amp', 'ph', 'lift', 'head', 'pa', 'pb', 'w', 'ry', 'rp', 'rr', 'arch', 'fz', 'ep'];
/** One whale's precomputed pass: channels sampled every DT0 s. */
function Track() {
  const n = Math.ceil(MAXT / DT0) + 4;
  for (const c of CH) this[c] = new Float64Array(n);
  this.n = 0;
  this.T = 0;
  this.eps = [];      // path episodes: arc-length ranges the body may follow ({ s0, s1 })
  this.breaches = []; // { ts, te, ti, tr0, tr1, ..., frozenP, frozenQ } (from the pool: nothing is made per pass)
  this.pool = [0, 1, 2].map(() => ({ frozenP: new Float64Array(NJ * 3), frozenQ: new Float64Array(NJ * 4) }));
  this.blows = [];    // scripted breathing crests (times)
  this.fluke = -1;    // start of the fluke-up dive
  this.sCrest = 0;    // arc length of the arch's crest it dives over
  this.blowAt = [];   // when the blows actually happened (runtime; for the test hook)
  this.L = L0;
}

/* ---------------- scratch ---------------- */
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion();
const _m3 = new THREE.Matrix3(), _m4 = new THREE.Matrix4();
const ys = { y: 0, v: 0 };
/** Body orientation from heading (yaw: atan2(vx, vz)), pitch (nose up +) and roll (about the body axis). */
function quatYPR(out, yaw, pitch, roll) {
  const a = (yaw - Math.PI / 2) / 2, b = pitch / 2, c = roll / 2;
  _qa.set(0, Math.sin(a), 0, Math.cos(a));
  _qb.set(0, 0, Math.sin(b), Math.cos(b));
  _qc.set(Math.sin(c), 0, 0, Math.cos(c));
  return out.copy(_qa).multiply(_qb).multiply(_qc);
}

/** Per-whale pose state: joint positions (local, m) and rotations, reused every frame. */
function Pose() {
  this.P = new Float64Array(NJ * 3);
  this.Q = new Float64Array(NJ * 4);
  this.P2 = new Float64Array(NJ * 3);
  this.Q2 = new Float64Array(NJ * 4);
  this.root = new THREE.Vector3();
  this.qroot = new THREE.Quaternion();
  this.vel = new THREE.Vector3();
}

/* ================================================================== */
/* The giant                                                           */
/* ================================================================== */
export function createGiant(env, { camera, view, fx, wind }) {
  const q = env.q;
  const rng = makeRng(env.seed ^ 0x6b1e);
  const group = new THREE.Group();
  group.name = 'giant';
  const shape = buildHumpback(q);
  const maps = paintHumpback(env.seed ^ 0x4b7);
  const mk = (name) => {
    const U = makeSpineUniforms();
    U.uPecRootL.value.copy(shape.pecRoot[0]); U.uPecRootR.value.copy(shape.pecRoot[1]);
    const mat = makeWhaleMaterial(maps, U);
    const mesh = new THREE.Mesh(shape.geo, mat);
    mesh.name = name;
    mesh.frustumCulled = false; // the spine moves it far from its rest bounds
    mesh.layers.set(LAYER_NO_REFLECT);
    mesh.visible = false;
    group.add(mesh);
    return { mesh, mat, U, track: new Track(), pose: new Pose(), on: false, scale: 1, blowArmed: false, washAcc: 0, dripAcc: 0, surfaced: false, flukeGone: false };
  };
  const mom = mk('whale'), calf = mk('calf');
  const whales = [mom, calf];

  /* ---------------- planning ---------------- */
  const yS = new YScript();
  // horizontal speed: a factor of the planned (cruise) speed, or an absolute speed (m/s), mixed by kM
  const kF = new Keys(), kV = new Keys(), kM = new Keys();
  const kAmp = new Keys(), kFreq = new Keys(), kLift = new Keys(), kHead = new Keys(), kPa = new Keys(), kPb = new Keys();
  const K = { F: kF, V: kV, M: kM, A: kAmp, Fq: kFreq, L: kLift, H: kHead, Pa: kPa, Pb: kPb };
  const pass = { on: false, t: 0, T: 0, n: 0, next: rng.range(20, 45), start: 0, frame: null, calf: false, breaches: 1 };
  const camState = { phi: null, omega: 0 };

  /**
   * Where the pass runs, in the camera's frame at its start: d metres beyond the island along the view, x metres to
   * the side, both drifting linearly; the frame itself turns with the camera (omega rad/s). Returns world position
   * and velocity at plan time tp.
   */
  const F = {
    phi0: 0, om: 0, d0: 0, dv: 0, x0: 0, xv: 0, T: 60,
    at(tp, p, v) {
      const ph = this.phi0 + this.om * tp, sf = Math.sin(ph), cf = Math.cos(ph);
      const d = this.d0 + this.dv * (tp - this.T / 2), x = this.x0 + this.xv * (tp - this.T / 2);
      // forward (camera → island) = -(sin, cos), right = (cos, -sin)
      p.set(-sf * d + cf * x, 0, -cf * d - sf * x);
      if (v) {
        const a = this.dv + this.om * x, b = this.xv - this.om * d;
        v.set(-sf * a + cf * b, 0, -cf * a - sf * b);
      }
      return p;
    },
  };

  function choosePath(T) {
    const c = camera.position, tgt = view.target;
    const tx = tgt.x !== undefined ? tgt.x : tgt[0], tz = tgt.z !== undefined ? tgt.z : tgt[2];
    const D = Math.max(20, Math.hypot(c.x - tx, c.z - tz));
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.max(0.3, camera.aspect);
    const om = Math.abs(camState.omega) < 0.004 ? 0 : clamp(camState.omega, -0.045, 0.045);
    F.phi0 = camState.phi !== null ? camState.phi : Math.atan2(c.x - tx, c.z - tz);
    F.om = om; F.T = T;
    const near = pass.n % 2 === 0;
    const prefer = (pass.n >> 1) % 2 === 0 ? 1 : -1; // screen direction, alternating every other pass
    let best = null;
    for (let tries = 0; tries < 6 && !best; tries++) {
      const d0 = (near ? rng.range(64, 86) : rng.range(96, 135)) - tries * 7;
      const Wd = (D + d0) * tanH;
      const uMax = 1.1 * Wd / T;
      const want = rng.range(1.7, 2.8);
      for (const sgn of [prefer, -prefer]) {
        for (const fu of [1, 0.75, 0.5, 0.3, 0.12]) {
          for (const dv of [0, 0.35, -0.35, 0.7, -0.7]) {
            const u = sgn * fu * uMax;
            if (Math.abs(dv) * T / 2 > Math.min(d0 - 52, 175 - d0)) continue;
            let ok = true, sum = 0;
            for (const e of [-0.55, 0, 0.55]) { // world speed at both ends and the middle of the sweep
              const x = e * Wd, d = d0 + dv * e * T;
              const sp = Math.hypot(dv + om * x, u - om * d);
              if (sp < 1.25 || sp > 3.5) { ok = false; break; }
              sum += Math.abs(sp - want);
            }
            if (!ok) continue;
            const score = sum - fu * 0.8 + (sgn === prefer ? 0 : 0.6);
            if (!best || score < best.score) best = { score, d0, dv, u, Wd };
          }
        }
      }
    }
    if (!best) best = { d0: 80, dv: 0, u: 0, Wd: (D + 80) * tanH }; // (unreachable: a slow drift straight out)
    F.d0 = best.d0; F.dv = best.dv; F.xv = best.u;
    F.x0 = rng.range(-0.12, 0.12) * best.Wd;
  }

  /** The mother's script: rise, two breaths with a roll, one or two breaches, a last breath and the fluke-up dive. */
  function scriptMother(nBreach) {
    const J = s => rng.range(-s, s);
    const tr = mom.track;
    tr.blows.length = 0; tr.breaches.length = 0;
    yS.reset(-9.5, 0.55);
    kF.reset(1); kV.reset(2); kM.reset(0);
    kAmp.reset(0.07); kFreq.reset(0.3); kLift.reset(0); kHead.reset(0); kPa.reset(0.05); kPb.reset(0);
    const breath = (rise, yTop = -0.55) => {
      yS.quintic(rise, yTop, 0);
      const tc = yS.t;
      tr.blows.push(tc);
      kHead.to(tc - 1.4, 0).to(tc - 0.5, 0.11).hold(tc + 0.9).to(tc + 2.2, 0);
      kAmp.to(tc - 1.6, 0.06).to(tc - 0.6, 0.012).hold(tc + 1.6);
      kPa.to(tc - 1.2, -0.1);
      return tc;
    };
    // 1. up from the blue and a first breath, a roll, a shallow stretch, a second breath and a roll
    yS.quintic(4.5 + J(0.5), -3.2, 0.5);
    breath(5.0 + J(0.5));
    yS.quintic(2.2 + J(0.3), -0.62, -0.05);
    yS.quintic(3.6, -2.6, -0.5);
    kAmp.to(yS.t, 0.03).to(yS.t + 2.5, 0.06);
    yS.quintic(4.6 + J(0.8), -3.0, 0.15);
    breath(4.0);
    yS.quintic(2.2, -0.62, -0.05);
    yS.quintic(3.8, -3.4, -0.9);
    kPa.to(yS.t, 0.05);
    // 2. breaches
    for (let b = 0; b < nBreach; b++) {
      const vyE = 8.6 + J(0.5) - b * 0.6;
      yS.quintic(4.4 + J(0.3), -13.5, 0, 0);
      const tb = yS.t;
      kAmp.to(tb - 2, 0.08).to(tb, 0.15);
      kFreq.to(tb - 2, 0.3).to(tb, 0.55);
      kPa.to(tb - 1, -0.3); kPb.to(tb - 1, 0.25);
      yS.quintic(3.4, 0, vyE, 0);
      const te = yS.t;
      yS.ballistic();
      const ti = yS.t;
      yS.drag(2.6, 1.7);
      yS.quintic(4.2, -4.8, 0.1);
      const ts = te - 0.9, tr0 = ti + 2.2, tr1 = ti + 4.0;
      // through the run-up and in the air a steady 2.4 m/s over the ground (constant while ballistic); the fall
      // stops it, then it swims on at the planned speed
      kV.to(tb - 1.2, 2.4).hold(ti).to(ti + 1.6, 0.6);
      kM.to(tb - 1.2, 0).to(tb, 1).hold(ti + 1.6).to(ti + 6, 0);
      kAmp.to(te - 0.2, 0.15).to(te + 0.4, 0).hold(ti + 1.5).to(ti + 4, 0.05);
      kFreq.to(te, 0.55).to(ti + 3, 0.3);
      kPa.to(ts, -0.3).to(ts + 0.6, 0.85).hold(ti).to(ti + 2, 0.05);
      kPb.to(ts, 0.25).to(ts + 0.6, -0.35).hold(ti).to(ti + 2, 0);
      const B = tr.pool[b];
      Object.assign(B, { ts, te, ti, tr0, tr1, dp: rng.range(0.95, 1.15), dr: rng.sign() * rng.range(1.7, 2.7), dy: J(0.3), arch: rng.range(0.1, 0.2), firedX: false, firedI: false, firedJ: false });
      tr.breaches.push(B);
    }
    // 3. a last breath, then the back humps up and rolls over a gentle arch, and the tail lifts out as the
    // body passes over it (see poseWhale): the flukes rise above the crest, hang, and slide down after it
    breath(6.0 + J(0.6));
    yS.quintic(2.4, -0.5, 0.05);
    kAmp.to(yS.t, 0.01);
    yS.quintic(1.8, -0.22, 0);
    const tf = yS.t;
    tr.fluke = tf;
    kV.to(tf - 1.2, 1.1).to(tf + 2.5, 0.8);
    kM.to(tf - 1.2, 0).to(tf + 1.5, 1);
    kPa.to(tf - 1.2, -0.36); kPb.to(tf - 1.2, 0.3);
    kAmp.hold(tf + 4).to(tf + 6, 0.06);
    yS.quintic(3.0, -2.6, -1.7);
    yS.quintic(2.4, -5.4, -1.15);   // the flukes hang
    yS.quintic(2.6, -11.5, -3.0);   // and it sounds
    yS.quintic(2.5, -18, -2.2);
    return yS.t;
  }

  /** Fill a track from the scripts: integrate the horizontal progress, sample the depth, derive the orientation. */
  function buildTrack(W, Y, K, T, offset) {
    const tr = W.track;
    const n = Math.min(Math.ceil(T / DT0) + 2, tr.x.length);
    tr.n = n; tr.T = T;
    const p = _v, v = _v2;
    // over-the-ground speed: the planned speed scaled (kF), or an absolute speed (kV), mixed by kM
    const speedFactor = (t, vn) => lerp(K.F.at(t) * vn, K.V.at(t), K.M.at(t)) / vn;
    let tp = 0, ph = 0, yawPrev = 0, s = 0;
    for (let i = 0; i < n; i++) {
      const t = i * DT0;
      if (i > 0) {
        // horizontal: progress along the planned path (plan time tp), midpoint rule
        const tm = t - DT0 / 2;
        F.at(tp, p, v);
        tp += speedFactor(tm, Math.max(0.5, Math.hypot(v.x, v.z))) * DT0;
        ph += TAU * K.Fq.at(tm) * DT0;
      }
      F.at(tp, p, v);
      v.multiplyScalar(speedFactor(t, Math.max(0.5, Math.hypot(v.x, v.z))));
      if (offset) offset(t, p, v);
      Y.at(t, ys);
      tr.x[i] = p.x; tr.y[i] = ys.y; tr.z[i] = p.z;
      tr.vx[i] = v.x; tr.vy[i] = ys.v; tr.vz[i] = v.z;
      const vh = Math.max(0.3, Math.hypot(v.x, v.z));
      let yaw = Math.atan2(v.x, v.z);
      if (i > 0) yaw = yawPrev + angleDelta(yawPrev, yaw);
      yawPrev = yaw;
      tr.yaw[i] = yaw;
      tr.pit[i] = Math.atan2(ys.v, vh);
      if (i > 0) s += Math.hypot(tr.x[i] - tr.x[i - 1], tr.y[i] - tr.y[i - 1], tr.z[i] - tr.z[i - 1]);
      tr.s[i] = s;
      tr.amp[i] = K.A.at(t); tr.ph[i] = ph; tr.head[i] = K.H.at(t);
      tr.pa[i] = K.Pa.at(t); tr.pb[i] = K.Pb.at(t);
      tr.w[i] = 0; tr.arch[i] = 0; tr.fz[i] = 0;
      // path episode: how many breaches have handed the body back to its path by now
      let e = 0;
      for (const B of tr.breaches) if (t >= B.tr0) e++;
      tr.ep[i] = e;
    }
    // banking into turns (from the heading's rate, smoothed both ways so it leads nothing)
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 3), b = Math.min(n - 1, i + 3);
      const rate = (tr.yaw[b] - tr.yaw[a]) / ((b - a) * DT0 || 1);
      const sp = Math.hypot(tr.vx[i], tr.vz[i]);
      tr.rol[i] = clamp(-rate * sp * 0.35, -0.3, 0.3);
    }
    // rigid windows (breaches): the body leaves its path from just before the take-off until it is back under
    // water; its orientation is scripted there (it turns back and rolls as it falls), and it rejoins its path
    // by the end. Episodes: the stretches of path the body follows between them.
    tr.eps.length = 0;
    let e0 = 0;
    for (let b = 0; b < tr.breaches.length; b++) {
      const B = tr.breaches[b];
      const is = Math.min(n - 1, Math.round(B.ts / DT0));
      tr.eps.push({ s0: tr.s[Math.min(n - 1, Math.round(e0 / DT0))], s1: tr.s[is] });
      const y0 = tr.yaw[is], p0 = tr.pit[is], r0 = tr.rol[is];
      const i0 = Math.max(0, Math.round((B.ts - 0.3) / DT0));
      for (let i = i0; i < n; i++) {
        const t = i * DT0;
        if (t > B.tr1 + DT0) break;
        if (i <= is) { tr.w[i] = smoothstep(B.ts - 0.3, B.ts, t); tr.ry[i] = tr.yaw[i]; tr.rp[i] = tr.pit[i]; tr.rr[i] = tr.rol[i]; continue; }
        tr.w[i] = 1 - smoothstep(B.tr0, B.tr1, t);
        const back = smoothstep(B.ti + 0.25, B.tr1, t), unroll = smoothstep(B.ti + 0.6, B.tr1 - 0.2, t);
        const air = smoothstep(B.ts + 0.35, B.ti + 0.25, t);
        tr.ry[i] = lerp(y0 + B.dy * smoothstep(B.ts, B.ti, t), tr.yaw[i], back);
        tr.rp[i] = lerp(p0 - B.dp * air, tr.pit[i], back);
        tr.rr[i] = lerp(r0 + B.dr * smoothstep(B.ts + 0.2, B.ti + 0.5, t), tr.rol[i] + Math.sign(B.dr) * TAU, unroll);
        tr.arch[i] = B.arch * smoothstep(B.ts, B.ts + 0.9, t) * (1 - smoothstep(B.ti, B.tr0, t));
        tr.fz[i] = 1 - smoothstep(B.ts, B.ts + 0.8, t);
      }
      e0 = B.tr0;
    }
    tr.eps.push({ s0: tr.s[Math.min(n - 1, Math.round(e0 / DT0))], s1: tr.s[n - 1] });
    // the shape each breach takes off with: the path pose at its start (so the switch is seamless)
    const pz = W.pose;
    for (let b = 0; b < tr.breaches.length; b++) {
      const B = tr.breaches[b];
      pathShape(W, B.ts, b, pz.P2, pz.Q2);
      B.frozenP.set(pz.P2); B.frozenQ.set(pz.Q2);
    }
    // the fluke-up: the crest of the arch the body rolls over (the tail lifts about it, see poseWhale)
    if (tr.fluke > 0) {
      let ic = Math.round(tr.fluke / DT0), best = -1e9;
      for (let i = Math.max(0, ic - 45); i < Math.min(n, ic + 45); i++) if (tr.y[i] > best) { best = tr.y[i]; ic = i; }
      tr.sCrest = tr.s[ic];
    }
  }

  /* ---------------- pose ---------------- */
  /** Sample a channel at time t (linear). */
  function chan(tr, c, t) {
    const k = clamp(t / DT0, 0, tr.n - 1.0001), i = Math.floor(k), f = k - i, a = tr[c];
    return a[i] + (a[i + 1] - a[i]) * f;
  }
  /** Root position at time t: cubic Hermite with the sampled velocities (C1, so speeds never step). */
  function rootAt(tr, t, out, vel) {
    const k = clamp(t / DT0, 0, tr.n - 1.0001), i = Math.floor(k), f = k - i;
    const f2 = f * f, f3 = f2 * f, h00 = 2 * f3 - 3 * f2 + 1, h10 = f3 - 2 * f2 + f, h01 = -2 * f3 + 3 * f2, h11 = f3 - f2;
    out.set(
      h00 * tr.x[i] + h10 * DT0 * tr.vx[i] + h01 * tr.x[i + 1] + h11 * DT0 * tr.vx[i + 1],
      h00 * tr.y[i] + h10 * DT0 * tr.vy[i] + h01 * tr.y[i + 1] + h11 * DT0 * tr.vy[i + 1],
      h00 * tr.z[i] + h10 * DT0 * tr.vz[i] + h01 * tr.z[i + 1] + h11 * DT0 * tr.vz[i + 1]);
    if (vel) vel.set(lerp(tr.vx[i], tr.vx[i + 1], f), lerp(tr.vy[i], tr.vy[i + 1], f), lerp(tr.vz[i], tr.vz[i + 1], f));
    return out;
  }
  /** Path point at arc length s (clamped to an episode, straight beyond its ends): position and orientation. */
  function pathAt(tr, ep, s, outP, outQ) {
    const E = tr.eps[Math.min(ep, tr.eps.length - 1)];
    const sc = clamp(s, E.s0, E.s1), S = tr.s;
    let lo = 0, hi = tr.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= sc) lo = m; else hi = m; }
    const ds = S[hi] - S[lo], f = ds > 1e-6 ? (sc - S[lo]) / ds : 0;
    outP.set(lerp(tr.x[lo], tr.x[hi], f), lerp(tr.y[lo], tr.y[hi], f), lerp(tr.z[lo], tr.z[hi], f));
    const yaw = lerp(tr.yaw[lo], tr.yaw[hi], f), pit = lerp(tr.pit[lo], tr.pit[hi], f), rol = lerp(tr.rol[lo], tr.rol[hi], f);
    quatYPR(outQ, yaw, pit, rol);
    if (s !== sc) { // beyond the episode: straight on along the end's heading
      _v3.set(1, 0, 0).applyQuaternion(outQ);
      outP.addScaledVector(_v3, s - sc);
    }
  }
  /** The body following its path at time t, as joint positions / rotations relative to the path's root frame. */
  const _pr = new THREE.Vector3(), _qr = new THREE.Quaternion(), _pj = new THREE.Vector3(), _qj = new THREE.Quaternion();
  function pathShape(W, t, ep, P, Q) {
    const tr = W.track, L = tr.L;
    const sr = chan(tr, 's', t);
    pathAt(tr, ep, sr, _pr, _qr);
    _qi.copy(_qr).invert();
    for (let j = 0; j < NJ; j++) {
      pathAt(tr, ep, sr + (U_C - UJ[j]) * L, _pj, _qj);
      _pj.sub(_pr).applyQuaternion(_qi);
      _qj.premultiply(_qi);
      P[j * 3] = _pj.x; P[j * 3 + 1] = _pj.y; P[j * 3 + 2] = _pj.z;
      Q[j * 4] = _qj.x; Q[j * 4 + 1] = _qj.y; Q[j * 4 + 2] = _qj.z; Q[j * 4 + 3] = _qj.w;
    }
  }
  /** Rotate joints [from..to] about joint `pivot` by `ang` about that joint's own lateral (+z) axis. */
  function bendAt(P, Q, pivot, from, to, ang) {
    if (Math.abs(ang) < 1e-6) return;
    _q.set(Q[pivot * 4], Q[pivot * 4 + 1], Q[pivot * 4 + 2], Q[pivot * 4 + 3]);
    _v.set(0, 0, 1).applyQuaternion(_q);
    _q2.setFromAxisAngle(_v, ang);
    const px = P[pivot * 3], py = P[pivot * 3 + 1], pz = P[pivot * 3 + 2];
    for (let k = from; k <= to; k++) {
      _v2.set(P[k * 3] - px, P[k * 3 + 1] - py, P[k * 3 + 2] - pz).applyQuaternion(_q2);
      P[k * 3] = px + _v2.x; P[k * 3 + 1] = py + _v2.y; P[k * 3 + 2] = pz + _v2.z;
      _q3.set(Q[k * 4], Q[k * 4 + 1], Q[k * 4 + 2], Q[k * 4 + 3]).premultiply(_q2);
      Q[k * 4] = _q3.x; Q[k * 4 + 1] = _q3.y; Q[k * 4 + 2] = _q3.z; Q[k * 4 + 3] = _q3.w;
    }
    // the pivot's own cross-section turns half way (it sits between the two segments)
    _q2.setFromAxisAngle(_v, ang / 2);
    _q3.copy(_q).premultiply(_q2);
    Q[pivot * 4] = _q3.x; Q[pivot * 4 + 1] = _q3.y; Q[pivot * 4 + 2] = _q3.z; Q[pivot * 4 + 3] = _q3.w;
  }
  /** Full pose of a whale at pass time t → its mesh transform and spine uniforms. */
  function poseWhale(W, t) {
    const tr = W.track, L = tr.L, pz = W.pose, P = pz.P, Q = pz.Q;
    const w = chan(tr, 'w', t);
    const k = clamp(t / DT0, 0, tr.n - 1.0001), ep = tr.ep[Math.round(k)];
    rootAt(tr, t, pz.root, pz.vel);
    quatYPR(pz.qroot, chan(tr, 'yaw', t), chan(tr, 'pit', t), chan(tr, 'rol', t));
    // the path shape (w < 1)
    if (w < 1) pathShape(W, t, ep, P, Q);
    if (w > 0) {
      // the rigid shape of a breach: the take-off shape relaxing into a gently arched body
      let FP = tr.breaches[0].frozenP, FQ = tr.breaches[0].frozenQ;
      for (const b of tr.breaches) if (t >= b.ts - 0.35) { FP = b.frozenP; FQ = b.frozenQ; }
      const fz = chan(tr, 'fz', t), arch = chan(tr, 'arch', t);
      const P2 = pz.P2, Q2 = pz.Q2;
      for (let j = 0; j < NJ; j++) {
        // an arc of total angle `arch` through the root (head and tail drop, the back bows up)
        const sj = (U_C - UJ[j]) * L, a = arch * sj / L;
        const ax = Math.abs(a) > 1e-5 ? Math.sin(a) / a * sj : sj, ay = Math.abs(a) > 1e-5 ? -(1 - Math.cos(a)) / a * sj : 0;
        _v.set(ax, ay, 0);
        _q.setFromAxisAngle(_v2.set(0, 0, 1), -a);
        _v2.set(FP[j * 3], FP[j * 3 + 1], FP[j * 3 + 2]);
        _v.lerp(_v2, fz);
        _q2.set(FQ[j * 4], FQ[j * 4 + 1], FQ[j * 4 + 2], FQ[j * 4 + 3]);
        _q.slerp(_q2, fz);
        P2[j * 3] = _v.x; P2[j * 3 + 1] = _v.y; P2[j * 3 + 2] = _v.z;
        Q2[j * 4] = _q.x; Q2[j * 4 + 1] = _q.y; Q2[j * 4 + 2] = _q.z; Q2[j * 4 + 3] = _q.w;
      }
      quatYPR(_q3, chan(tr, 'ry', t), chan(tr, 'rp', t), chan(tr, 'rr', t));
      if (w >= 1) { P.set(P2); Q.set(Q2); pz.qroot.copy(_q3); }
      else {
        pz.qroot.slerp(_q3, w);
        for (let j = 0; j < NJ; j++) {
          for (let c = 0; c < 3; c++) P[j * 3 + c] = lerp(P[j * 3 + c], P2[j * 3 + c], w);
          _q.set(Q[j * 4], Q[j * 4 + 1], Q[j * 4 + 2], Q[j * 4 + 3]);
          _q2.set(Q2[j * 4], Q2[j * 4 + 1], Q2[j * 4 + 2], Q2[j * 4 + 3]);
          _q.slerp(_q2, w);
          Q[j * 4] = _q.x; Q[j * 4 + 1] = _q.y; Q[j * 4 + 2] = _q.z; Q[j * 4 + 3] = _q.w;
        }
      }
    }
    // layered on top: the tail beat (a wave running back along the tail), the fluke lift, the head lift
    const amp = chan(tr, 'amp', t), ph = chan(tr, 'ph', t), head = chan(tr, 'head', t);
    // the fluke-up: the part of the body behind the crest it is rolling over lifts up about the crest (spread
    // over a few joints, moving smoothly along the body as the crest does), so the tail stock and flukes rise
    // vertically above the arch; once the crest has passed them they slide down the path after the body
    let uc = -1, lift = 0, gs = 0;
    if (tr.fluke > 0 && t > tr.fluke - 2 && w < 1) {
      uc = U_C - (tr.sCrest - chan(tr, 's', t)) / L;
      lift = LIFT * smoothstep(0.5, 0.8, uc) * (1 - smoothstep(0.98, 1.13, uc)) * (1 - w);
      if (lift > 1e-4) for (let j = JC + 1; j < NJ - 1; j++) { const d = (UJ[j] - uc) / 0.045; gs += Math.exp(-d * d); }
    }
    for (let j = JC; j < NJ - 1; j++) {
      const u = UJ[j], wt = smoothstep(0.42, 1.0, u);
      let a = amp * wt * wt * Math.sin(ph - 5.2 * (u - U_C)) * 0.9;
      if (gs > 1e-6 && j > JC) { const d = (u - uc) / 0.045; a -= lift * Math.exp(-d * d) / gs; }
      bendAt(P, Q, j, j + 1, NJ - 1, a);
    }
    if (Math.abs(head) > 1e-5) bendAt(P, Q, JC, 0, JC - 1, head);
    // flukes flex with the beat (their tips trail the stroke)
    W.U.uFlex.value = amp * 4 * Math.cos(ph - 5.2 * (1 - U_C));
    // flippers: abduction + sweep (+ a slow wave in the air)
    const pa = chan(tr, 'pa', t) + 0.22 * w * Math.sin(t * 2.6), pb = chan(tr, 'pb', t);
    pecMatrix(W.U.uPecL.value, 1, pa, pb);
    pecMatrix(W.U.uPecR.value, -1, pa, pb);
    // to the mesh: transform = root, spine = local joints (in the unscaled model's units)
    const m = W.mesh, inv = 1 / W.scale;
    m.position.copy(pz.root);
    m.quaternion.copy(pz.qroot);
    m.scale.setScalar(W.scale);
    const SP = W.U.uSpP.value, SQ = W.U.uSpQ.value;
    for (let j = 0; j < NJ; j++) {
      SP[j].set(P[j * 3] * inv, P[j * 3 + 1] * inv, P[j * 3 + 2] * inv, 0);
      SQ[j].set(Q[j * 4], Q[j * 4 + 1], Q[j * 4 + 2], Q[j * 4 + 3]);
    }
  }
  const _e = new THREE.Euler();
  function pecMatrix(M, sideSign, a, b) {
    // left (sideSign 1): Ry(-b)·Rx(a); right: Ry(b)·Rx(-a)
    _q.setFromAxisAngle(_v.set(0, 1, 0), -sideSign * b);
    _q2.setFromAxisAngle(_v.set(1, 0, 0), sideSign * a);
    _q.multiply(_q2);
    _m4.makeRotationFromQuaternion(_q);
    M.setFromMatrix4(_m4);
  }
  /** World position of a body point: spine u, offset (m, in the joint frame: x along, y up, z right). */
  function bodyPoint(W, u, ox, oy, oz, out) {
    const pz = W.pose, s = clamp(u, 0, 1) * (NJ - 1), i = Math.min(Math.floor(s), NJ - 2), f = s - i;
    _q.set(pz.Q[i * 4], pz.Q[i * 4 + 1], pz.Q[i * 4 + 2], pz.Q[i * 4 + 3]);
    _q2.set(pz.Q[i * 4 + 4], pz.Q[i * 4 + 5], pz.Q[i * 4 + 6], pz.Q[i * 4 + 7]);
    _q.slerp(_q2, f);
    out.set(ox, oy, oz).applyQuaternion(_q);
    out.x += lerp(pz.P[i * 3], pz.P[i * 3 + 3], f); out.y += lerp(pz.P[i * 3 + 1], pz.P[i * 3 + 4], f); out.z += lerp(pz.P[i * 3 + 2], pz.P[i * 3 + 5], f);
    return out.applyQuaternion(pz.qroot).add(pz.root);
  }

  /* ---------------- passes ---------------- */
  function startPass(opts = {}) {
    const nB = opts.breaches || (rng.chance(0.3) ? 2 : 1);
    const T = scriptMother(nB);
    choosePath(T);
    mom.track.L = L0; mom.scale = 1;
    buildTrack(mom, yS, K, T, null);
    for (const W of whales) { W.on = false; W.mesh.visible = false; }
    mom.track.blowAt.length = 0;
    mom.on = true; mom.blowArmed = false; mom.surfaced = false; mom.flukeGone = false; mom.washAcc = mom.dripAcc = 0;
    pass.on = true; pass.t = 0; pass.T = T; pass.n++; pass.breaches = nB;
    // the field on the sea sits around the middle of the pass
    F.at(T / 2, _v);
    fx.centre(_v.x, _v.z);
    return pass;
  }
  function endPass() {
    pass.on = false;
    for (const W of whales) { W.on = false; W.mesh.visible = false; }
  }

  /* ---------------- per frame ---------------- */
  const focus = { active: false, x: 0, z: 0, y: 0, strength: 0, t: 0, seq: 0 };
  const light = { night: 0, glow: new THREE.Color() };
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
  let wtime = 0;
  function stepWhale(W, t, dt, T) {
    poseWhale(W, t);
    const tr = W.track, L = tr.L, k = W.scale, gl = light.night;
    // visible only while some of it is near the surface (deep in the blue it costs nothing)
    const top = W.pose.root.y + 2.5 * k;
    W.mesh.visible = top > -6 && t < T;
    // a breath: when the blowhole clears the surface
    bodyPoint(W, 0.172, 0, PHD(0.172) * L * 1.02, 0, _a);
    const hb = _a.y - waveHeight(_a.x, _a.z, wtime);
    if (hb < -0.7) W.blowArmed = true;
    if (W.blowArmed && hb > -0.06 && W.pose.vel.y > -1) {
      W.blowArmed = false;
      tr.blowAt.push(+t.toFixed(2));
      _b.set(1, 0, 0).applyQuaternion(W.pose.qroot);
      fx.spout(_a.x, _a.y, _a.z, _b.x, _b.z, k, gl);
      focus.active = true; focus.x = _a.x; focus.z = _a.z; focus.t = 0; focus.seq++;
    }
    // where the back cuts the surface: white water and a patch of foam that blooms and fades
    const sp = Math.hypot(W.pose.vel.x, W.pose.vel.z);
    let wet = 0;
    for (let i = 0; i < 6; i++) {
      const u = 0.12 + i * 0.13;
      bodyPoint(W, u, 0, PHD(u) * L, 0, _a);
      const h = _a.y - waveHeight(_a.x, _a.z, wtime);
      if (h > -0.25 && h < 0.5) {
        wet++;
        W.washAcc += dt * (2 + sp * 2.2) * k;
        while (W.washAcc > 1) { W.washAcc -= 1; fx.wash(_a.x, Math.max(_a.y, 0), _a.z, W.pose.vel.x, W.pose.vel.z, k, gl); }
      }
    }
    if (wet >= 2 && !W.surfaced) {
      W.surfaced = true;
      _b.set(1, 0, 0).applyQuaternion(W.pose.qroot);
      fx.patch(0, W.pose.root.x, W.pose.root.z, 0.5 * L, 0.24 * L, Math.atan2(_b.z, _b.x), 13, 0.9);
    } else if (wet === 0 && W.surfaced && W.pose.root.y < -2.5) W.surfaced = false;
    // breaches: water pouring off as it rises, the fall's crown of spray, white water and rings
    for (let b = 0; b < tr.breaches.length; b++) {
      const B = tr.breaches[b];
      if (t > B.te - 0.9 && t < B.te + 1.2) {
        for (let i = 0; i < 7; i++) {
          const u = 0.05 + i * 0.14;
          bodyPoint(W, u, 0, 0, 0, _a);
          const h = _a.y - waveHeight(_a.x, _a.z, wtime);
          if (h > -0.5 && h < 1.2) {
            W.dripAcc += dt * 26 * k;
            while (W.dripAcc > 1) { W.dripAcc -= 1; fx.pour(_a.x, Math.max(_a.y, 0.2), _a.z, W.pose.vel.x, Math.max(W.pose.vel.y, 0) * 0.7, W.pose.vel.z, k, gl); }
          }
        }
      }
      if (t >= B.te - 0.75 && !B.firedX) {
        B.firedX = true;
        rootAt(tr, B.te, _a);
        fx.crown(_a.x, _a.z, W.pose.vel.x, W.pose.vel.z, 3 * k, 0.5 * k, gl, false);
        fx.patch(0, _a.x, _a.z, 0.32 * L, 0.32 * L, 0, 10, 0.8);
      }
      if (t >= B.ti && !B.firedI) {
        B.firedI = true;
        _b.set(1, 0, 0).applyQuaternion(W.pose.qroot);
        const ax = _b.x, az = _b.z, ang = Math.atan2(az, ax);
        fx.crown(W.pose.root.x, W.pose.root.z, ax, az, 0.8 * L, 1.15 * k, gl);
        fx.patch(1, W.pose.root.x, W.pose.root.z, 0.62 * L, 0.38 * L, ang, 24, 1);
        fx.patch(2, W.pose.root.x, W.pose.root.z, 30 * k, 30 * k, 0, 9, 0.8);
        focus.active = true; focus.x = W.pose.root.x; focus.z = W.pose.root.z; focus.t = 0; focus.seq++;
      }
      if (t >= B.ti + 0.45 && !B.firedJ) {
        B.firedJ = true;
        bodyPoint(W, 0.85, 0, 0, 0, _a);
        fx.crown(_a.x, _a.z, 1, 0, 0.3 * L, 0.6 * k, gl);
        fx.patch(2, W.pose.root.x, W.pose.root.z, 44 * k, 44 * k, 0, 12, 0.55);
      }
    }
    // the fluke-up: water streaming off the trailing edge while the flukes are up, a smooth print where they went down
    if (tr.fluke > 0 && t > tr.fluke) {
      bodyPoint(W, 1, 0, 0, 0, _c);
      for (let i = 0; i < shape.flukeTE.length; i++) {
        const p = shape.flukeTE[i];
        bodyPoint(W, 1, p.x * k, p.y * k, p.z * k, _a);
        const h = _a.y - waveHeight(_a.x, _a.z, wtime);
        if (h > 0.1) {
          W.dripAcc += dt * 9 * k;
          while (W.dripAcc > 1) { W.dripAcc -= 1; fx.drip(_a.x, _a.y, _a.z, W.pose.vel.x * 0.3, W.pose.vel.y * 0.5, W.pose.vel.z * 0.3, k, gl); }
        }
      }
      if (!W.flukeGone && t > tr.fluke + 2.5 && _c.y < -0.6) {
        W.flukeGone = true;
        fx.patch(3, _c.x, _c.z, 0.3 * L, 0.2 * L, 0, 30, 0.9);
      }
    }
  }

  function update(dt, t, info) {
    wtime = t;
    light.night = info.glow;
    // the camera's own turn rate (the screensaver orbits): passes are planned in its frame
    const c = camera.position, tgt = view.target;
    const tx = tgt.x !== undefined ? tgt.x : tgt[0], tz = tgt.z !== undefined ? tgt.z : tgt[2];
    const phi = Math.atan2(c.x - tx, c.z - tz);
    if (camState.phi !== null && dt > 0) camState.omega = damp(camState.omega, clamp(angleDelta(camState.phi, phi) / dt, -0.3, 0.3), 1.2, dt);
    camState.phi = phi;
    focus.t += dt;
    if (focus.t > 20) focus.active = false;
    pass.next -= dt;
    if (!pass.on) {
      if (pass.next > 0) return;
      startPass();
      pass.next = rng.range(180, 300); // start to start: a pass every 3-5 minutes
    }
    pass.t += dt;
    const T = pass.T;
    for (const W of whales) if (W.on) stepWhale(W, pass.t, dt, T);
    if (pass.t >= T) endPass();
  }

  /** Lighting from the time of day (island.js). */
  function setLight(L) {
    for (const W of whales) {
      W.U.uWhRim.value.copy(L.rim);
      W.U.uWhHaze.value.copy(L.haze);
    }
  }

  return {
    group, update, setLight, focus, whales, pass,
    /**
     * Test hook: start a pass now (if none is running) and play it on to pass time t (s), effects included, at a
     * fixed step. opts: { breaches: 1 | 2 }. Returns the pass's timeline.
     */
    debug(t = 0, opts = {}) {
      if (!pass.on || opts.restart) startPass(opts);
      const step = 1 / 30;
      while (pass.t + 1e-6 < t) {
        const d = Math.min(step, t - pass.t);
        pass.t += d;
        for (const W of whales) if (W.on) stepWhale(W, pass.t, d, pass.T);
        fx.update(d);
      }
      return this.timeline();
    },
    timeline() {
      const tr = mom.track;
      return { on: pass.on, t: +pass.t.toFixed(2), T: +pass.T.toFixed(2), blows: tr.blows.map(x => +x.toFixed(2)), blowAt: tr.blowAt.slice(), breaches: tr.breaches.map(B => ({ exit: +B.te.toFixed(2), impact: +B.ti.toFixed(2) })), fluke: +tr.fluke.toFixed(2), next: +pass.next.toFixed(1),
        plan: { d0: +F.d0.toFixed(1), dv: +F.dv.toFixed(2), x0: +F.x0.toFixed(1), xv: +F.xv.toFixed(2), om: +F.om.toFixed(4), phi0: +F.phi0.toFixed(3) } };
    },
    dispose() { shape.geo.dispose(); maps.map.dispose(); maps.normalMap.dispose(); for (const W of whales) W.mat.dispose(); },
  };
}
