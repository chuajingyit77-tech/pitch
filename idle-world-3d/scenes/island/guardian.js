// 晴岛 · 海豚 — the island's guardian: a bottlenose dolphin (2.5 m) that now and then swims in to the dock, lifts its
// head out of the water and watches the island for a while; called for a lesson (lib/guide.js), it comes now and
// stays, turned to whoever talks with it: it chatters with its beak while it speaks, nods at a right answer, shakes
// its head at a wrong one and, when a lesson is learnt, leaps clear of the water with a spin.
//
// One skinned mesh (one draw call) built from parametric surfaces: a lofted body whose beak opens (upper and lower
// jaw, with the palate, tongue and teeth inside), eyes, the blowhole, a falcate dorsal fin, flippers and flukes. It is
// painted by vertex colour (the dark cape, grey flanks with the eye-to-flipper stripe, the pale belly and lower jaw)
// over a fine skin normal map, wet and glossy. Normals come from the surfaces' own derivatives, so the separate parts
// join without a shading seam. The rig is a spine of joints posed every frame from functions of time (paths, the
// head-up pose, nods, the leap) and exact springs, so it moves the same at any frame rate.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, makeRng, makeCanvas, createNoise, normalMapFromHeight, patchMaterial } from '../../lib/util.js';
import { addUnderwater, LAYER_NO_REFLECT } from './shared.js';
import { waveHeight } from './water.js';

/* ------------------------------------------------------------------ */
/* Body plan (bind pose: dolphin-local, +Z forward, +Y up, +X its left)  */
/* ------------------------------------------------------------------ */
const LEN = 2.5;                        // rostrum tip to fluke notch (m)
const S_COM = 0.40;                     // the centre of mass, the dolphin's origin, as a fraction of the length
const zAt = s => (S_COM - s) * LEN;     // local z of body fraction s (the tip at s = 0, the fluke notch at s = 1)
const S_GAPE = 0.095;                   // the corner of the mouth
const S_TIP = 0.012;                    // the rounded tip of the beak
// the body's sections (an adult bottlenose: the beak ~10 cm, the melon, the deepest at a third of the length, the
// keeled tail stock): [s, top y, bottom y, half width, section exponent (2 = ellipse; less = keeled)]
const BODY = [
  [0.012, 0.010, -0.024, 0.024, 2.1], [0.025, 0.019, -0.036, 0.034, 2.1], [0.040, 0.028, -0.046, 0.044, 2.1],
  [0.047, 0.040, -0.051, 0.051, 2.15], [0.054, 0.082, -0.057, 0.061, 2.2], [0.064, 0.126, -0.065, 0.077, 2.25],
  [0.076, 0.160, -0.076, 0.094, 2.3], [0.090, 0.183, -0.091, 0.112, 2.3], [0.110, 0.200, -0.112, 0.132, 2.3],
  [0.130, 0.212, -0.132, 0.148, 2.3], [0.160, 0.228, -0.158, 0.165, 2.3], [0.200, 0.243, -0.188, 0.183, 2.3],
  [0.250, 0.256, -0.214, 0.198, 2.3], [0.310, 0.264, -0.234, 0.208, 2.3], [0.370, 0.266, -0.244, 0.211, 2.3],
  [0.430, 0.260, -0.244, 0.206, 2.25], [0.490, 0.247, -0.236, 0.194, 2.2], [0.550, 0.226, -0.218, 0.175, 2.15],
  [0.610, 0.198, -0.192, 0.150, 2.05], [0.670, 0.166, -0.160, 0.118, 1.95], [0.730, 0.132, -0.126, 0.086, 1.85],
  [0.790, 0.100, -0.096, 0.058, 1.75], [0.840, 0.076, -0.073, 0.040, 1.72], [0.880, 0.058, -0.056, 0.031, 1.8],
  [0.915, 0.044, -0.042, 0.029, 1.95], [0.950, 0.030, -0.029, 0.031, 2.0], [0.980, 0.016, -0.016, 0.022, 2.0],
  [1.000, 0.004, -0.004, 0.006, 2.0],
];
// the lips' height along the beak (they rise a little at the corner: the smile)
const MOUTH = [[0.0, -0.007], [0.02, -0.011], [0.04, -0.015], [0.065, -0.019], [0.085, -0.016], [0.095, -0.008]];

/* the rig: joints along the spine; each joint's frame carries the part of the body beyond it (away from SP1, the
   centre, which stays put in the dolphin's own frame) */
const B = { ROOT: 0, HEAD: 1, JAW: 2, SP0: 3, SP1: 4, SP2: 5, SP3: 6, SP4: 7, SP5: 8, SP6: 9, FLUKE: 10, PEC: [11, 12] };
const BONE_COUNT = 13;
const JOINT_S = { [B.HEAD]: 0.17, [B.SP0]: 0.27, [B.SP1]: 0.40, [B.SP2]: 0.50, [B.SP3]: 0.60, [B.SP4]: 0.69, [B.SP5]: 0.78, [B.SP6]: 0.86, [B.FLUKE]: 0.915 };
// the body's regions, tip to tail: the bone that carries each, the boundaries between them and how wide each blend is
const REGION_BONE = [B.HEAD, B.SP0, B.SP1, B.SP2, B.SP3, B.SP4, B.SP5, B.SP6, B.FLUKE];
const REGION_EDGE = [0.17, 0.27, 0.50, 0.60, 0.69, 0.78, 0.86, 0.915];
const REGION_BLEND = [0.035, 0.045, 0.05, 0.045, 0.04, 0.035, 0.03, 0.016];
const BACK = [B.SP2, B.SP3, B.SP4, B.SP5, B.SP6, B.FLUKE];  // the joints toward the tail, in order

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */
/** A smooth curve through a table's rows ([x, ...values]): monotone cubic (PCHIP) in column k, so the body's outline
 *  has no ripple at the rows and never overshoots them. Built once per table and column. */
const CURVES = new Map();
function curve(rows, k) {
  const n = rows.length, xs = rows.map(r => r[0]), ys = rows.map(r => r[k]), d = [], m = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) { m[i] = 0; continue; }
    const h0 = xs[i] - xs[i - 1], h1 = xs[i + 1] - xs[i], w1 = 2 * h1 + h0, w2 = h1 + 2 * h0;
    m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
  }
  return x => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (3 * t2 - 2 * t3) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
function table(rows, x, k) {
  let c = CURVES.get(rows);
  if (!c) CURVES.set(rows, c = []);
  return (c[k] || (c[k] = curve(rows, k)))(x);
}
const spow = (t, p) => Math.sign(t) * Math.pow(Math.abs(t), p);
const easeIO = t => t * t * (3 - 2 * t);
/** 0 -> 1 -> 0 over [0, d] (the shape of a reaction), easing in and out over `e` at each end */
const envl = (t, d, e) => smoothstep(0, e, t) * (1 - smoothstep(d - e, d, t));

/** Critically damped spring, stepped exactly (the same at any frame rate for a target held over the step). */
class Spring {
  constructor(x = 0) { this.x = x; this.v = 0; }
  step(target, w, dt) {
    const e = this.x - target, a = (this.v + w * e) * dt, ex = Math.exp(-w * dt);
    this.x = target + (e + a) * ex; this.v = (this.v - w * a) * ex;
    return this.x;
  }
  set(x) { this.x = x; this.v = 0; return this; }
}

/** The body's section at s: { yt, yb, w, n } (the beak's tip rounded off). */
const _sec = { yt: 0, yb: 0, w: 0, n: 2 };
function section(s) {
  if (s < S_TIP) {
    const k = Math.sqrt(Math.max(0, 1 - (1 - Math.max(s, 0) / S_TIP) ** 2));
    const yt = table(BODY, S_TIP, 1), yb = table(BODY, S_TIP, 2), c = (yt + yb) / 2;
    _sec.yt = c + (yt - c) * k; _sec.yb = c + (yb - c) * k; _sec.w = table(BODY, S_TIP, 3) * k; _sec.n = table(BODY, S_TIP, 4);
    return _sec;
  }
  _sec.yt = table(BODY, s, 1); _sec.yb = table(BODY, s, 2); _sec.w = table(BODY, s, 3); _sec.n = table(BODY, s, 4);
  return _sec;
}
/** A point on the body: fraction s, angle phi round the section (0 the belly, PI/2 its left flank, PI the back). */
function bodyPoint(s, phi, out) {
  const c = section(s), yc = (c.yt + c.yb) / 2, hh = (c.yt - c.yb) / 2, e = 2 / c.n;
  return out.set(c.w * spow(Math.sin(phi), e), yc - hh * spow(Math.cos(phi), e), zAt(s));
}
/** The angle of the left lip at s (the right one is TAU minus it). */
function lipAngle(s) {
  const c = section(Math.max(s, 1e-4)), yc = (c.yt + c.yb) / 2, hh = Math.max((c.yt - c.yb) / 2, 1e-6);
  const r = clamp((yc - table(MOUTH, s, 1)) / hh, -0.98, 0.98);
  return Math.acos(spow(r, c.n / 2));
}
const PHI_GAPE = lipAngle(S_GAPE);
/** Where a flipper joins the body (side 1 its left, -1 its right), just inside the skin. */
function pecRoot(side, out) {
  bodyPoint(0.20, side > 0 ? 0.31 * Math.PI : TAU - 0.31 * Math.PI, out);
  out.x -= side * 0.035;
  return out;
}
/** Axis point (bind) at s. */
function axisAt(s, out) { const c = section(s); return out.set(0, (c.yt + c.yb) / 2, zAt(s)); }

/** Bone weights of a point at body fraction s: two neighbouring regions blended across their boundary. */
function spineWeights(s) {
  for (let k = 0; k < REGION_EDGE.length; k++) {
    const e = REGION_EDGE[k], h = REGION_BLEND[k];
    if (s < e - h) return [[REGION_BONE[k], 1]];
    if (s <= e + h) { const w = smoothstep(e - h, e + h, s); return [[REGION_BONE[k], 1 - w], [REGION_BONE[k + 1], w]]; }
  }
  return [[REGION_BONE[REGION_BONE.length - 1], 1]];
}

/* ------------------------------------------------------------------ */
/* Colours                                                              */
/* ------------------------------------------------------------------ */
// (written as seen, sRGB; THREE.Color stores them linear, as vertex colours are used)
const COL = {
  cape: new THREE.Color('#2f3b47'), flank: new THREE.Color('#6d7c89'), belly: new THREE.Color('#e9e5e0'),
  jaw: new THREE.Color('#d9d7d4'), lip: new THREE.Color('#2b3137'), eye: new THREE.Color('#0b0a09'),
  rim: new THREE.Color('#283038'), mouth: new THREE.Color('#8c4c51'), tongue: new THREE.Color('#b86e73'),
  tooth: new THREE.Color('#ede8de'), blow: new THREE.Color('#13171b'), fin: new THREE.Color('#2c3641'),
  finLow: new THREE.Color('#5a6773'),
};
const _col = new THREE.Color(), _col2 = new THREE.Color();
const CAPE = [[0, 0.5], [0.06, 0.44], [0.13, 0.36], [0.27, 0.4], [0.43, 0.47], [0.56, 0.56], [0.7, 0.6], [0.9, 0.62], [1, 0.62]];
const BELLY = [[0, 0.36], [0.08, 0.33], [0.18, 0.3], [0.33, 0.33], [0.53, 0.3], [0.73, 0.22], [0.9, 0.16], [1, 0.12]];
const NOISE = createNoise(91);
/** The skin's colour at body fraction s, angle phi: the dark cape over the back (dipping behind the dorsal fin),
 *  grey flanks with a faint stripe from the eye to the flipper, the pale belly and lower jaw. */
function skinColour(s, phi, out) {
  // angle from the back (0 on the spine, PI on the belly) and from the belly
  const a = Math.abs(((phi % TAU) + TAU) % TAU - Math.PI), fromBelly = Math.PI - a;
  const capeEdge = table(CAPE, s, 1) * Math.PI, bellyEdge = table(BELLY, s, 1) * Math.PI;
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const wob = 0.035 * NOISE.noise3(s * 9, cp * 1.4, sp * 1.4);
  out.copy(COL.flank);
  // the cape, darkening toward the spine
  out.lerp(COL.cape, smoothstep(capeEdge + 0.06, capeEdge - 0.1, a + wob) * (0.75 + 0.25 * smoothstep(capeEdge, 0.1, a)));
  // the belly (and the lower jaw), with a soft edge
  out.lerp(s < S_GAPE + 0.03 ? COL.jaw : COL.belly, smoothstep(bellyEdge + 0.12, bellyEdge - 0.08, fromBelly + wob));
  // the stripe from the eye to the flipper (on both sides)
  const side = Math.abs(Math.sin(phi)), sideT = (s - 0.12) / 0.08;
  if (sideT > -0.1 && sideT < 1.15 && side > 0.5) {
    const lineA = lerp(0.47, 0.33, clamp(sideT, 0, 1)) * Math.PI;
    const d = Math.abs(Math.min(((phi % TAU) + TAU) % TAU, TAU - (((phi % TAU) + TAU) % TAU)) - lineA);
    out.lerp(COL.cape, 0.32 * smoothstep(0.1, 0.02, d) * envl(sideT + 0.1, 1.25, 0.25));
  }
  // the beak darkens a little toward the tip; a faint shoulder blaze lightens the flank above the flipper
  if (s < 0.06) out.lerp(COL.cape, 0.2 * smoothstep(0.06, 0.0, s) * smoothstep(0.3, 0.6, -Math.cos(phi)));
  // round the eye, a darker patch
  { const de = Math.hypot((s - 0.118) * 9, Math.abs(Math.sin(phi)) > 0.5 ? (Math.abs(Math.cos(phi)) - 0.34) * 1.6 : 9); out.lerp(COL.rim, 0.55 * smoothstep(0.42, 0.12, de)); }
  const blaze = smoothstep(0.21, 0.27, s) * (1 - smoothstep(0.33, 0.41, s)) * smoothstep(0.3, 0.12, Math.abs(a - 0.52 * Math.PI));
  out.lerp(COL.belly, 0.16 * blaze);
  // mottling, very faint
  const m = 0.012 * NOISE.noise3(s * 23 + 3, cp * 2.5, sp * 2.5);
  out.r += m; out.g += m; out.b += m;
  return out;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                             */
/* ------------------------------------------------------------------ */
class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.si = []; this.sw = []; this.thin = []; this.rough = []; this.idx = []; }
  get count() { return this.p.length / 3; }
  vert(p, n, uv, col, bones, thin = 0, rough = 0.38) {
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(uv[0], uv[1]); this.c.push(col.r, col.g, col.b);
    let tot = 0; for (const b of bones) tot += b[1];
    for (let k = 0; k < 4; k++) { const b = bones[k]; this.si.push(b ? b[0] : 0); this.sw.push(b ? b[1] / tot : 0); }
    this.thin.push(thin); this.rough.push(rough);
  }
  /**
   * A surface F(u, v) sampled at us[] × vs[] (parameter values). Normals from F's own derivatives (finite
   * differences in the parameters), so two surfaces meeting along a shared edge shade as one; `outward` flips them
   * (the surface's orientation is chosen by the caller), `pole(u, v, out)` gives the normal where the surface
   * collapses to a point. meta(u, v, p) -> { uv, col, bones, thin, rough }.
   */
  surf(us, vs, F, meta, { flip = false, pole = null, eps = 1e-4 } = {}) {
    const base = this.count, nu = us.length, nv = vs.length;
    const p = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), du = new THREE.Vector3(), dv = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const u = us[i], v = vs[j];
      F(u, v, p);
      F(u + eps, v, a); F(u - eps, v, b); du.subVectors(a, b);
      F(u, v + eps, a); F(u, v - eps, b); dv.subVectors(a, b);
      n.crossVectors(du, dv);
      if (n.lengthSq() < 1e-18) { if (pole) pole(u, v, n); else n.set(0, 1, 0); } else if (flip) n.negate();
      n.normalize();
      const m = meta(u, v, p);
      this.vert(p, n, m.uv, m.col, m.bones, m.thin || 0, m.rough ?? 0.38);
    }
    for (let i = 0; i < nu - 1; i++) for (let j = 0; j < nv - 1; j++) {
      const a0 = base + i * nv + j, a1 = a0 + 1, b0 = a0 + nv, b1 = b0 + 1;
      if (flip) this.idx.push(a0, a1, b0, b0, a1, b1); else this.idx.push(a0, b0, a1, b0, b1, a1);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setAttribute('aThin', new THREE.Float32BufferAttribute(this.thin, 1));
    g.setAttribute('aRough', new THREE.Float32BufferAttribute(this.rough, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}
const range = (a, b, n, ease = null) => { const o = []; for (let i = 0; i <= n; i++) { const t = i / n; o.push(lerp(a, b, ease ? ease(t) : t)); } return o; };

/** A thin fin as a surface: u round its airfoil (0 trailing edge, over its left side to the leading edge at 0.5, back
 *  along the right side to 1), v from root (0) to tip (1). edge(v) -> { le, te } (Vector3s on the fin's mid-plane),
 *  side: the fin's thickness direction at v, thick(v): half thickness at the thickest. */
function finSurface(edge, side, thick) {
  const le = new THREE.Vector3(), te = new THREE.Vector3(), sd = new THREE.Vector3();
  return (u, v, out) => {
    const e = edge(clamp(v, 0, 1), le, te);
    side(clamp(v, 0, 1), sd);
    const w = clamp(u, 0, 1), c = w < 0.5 ? 1 - w * 2 : (w - 0.5) * 2;  // chord: 0 at the leading edge, 1 at the trailing
    const sgn = w < 0.5 ? 1 : -1;
    // a rounded leading edge, thickest at a third, thinning to the trailing edge
    const t = thick(clamp(v, 0, 1)) * 1.6 * Math.sqrt(Math.max(c, 0)) * Math.pow(Math.max(1 - c, 0), 1.15);
    return out.copy(e.le).lerp(e.te, c * c * (3 - 2 * c) * 0.25 + c * 0.75).addScaledVector(sd, sgn * t);
  };
}

function buildDolphinGeometry(q) {
  const G = new Geo();
  const d = q >= 0.6 ? 1 : 0.72;            // density
  const N = x => Math.max(6, Math.round(x * d));
  const tmp = new THREE.Vector3();
  const sLip = s => Math.min(s, S_GAPE);
  const headBones = s => spineWeights(s);
  const jawW = s => 1 - smoothstep(S_GAPE - 0.05, S_GAPE - 0.004, s);
  const withJaw = (s, w) => { const hb = headBones(s); return w > 0.999 ? [[B.JAW, 1]] : w < 0.001 ? hb : [[B.JAW, w], ...hb.map(([b, x]) => [b, x * (1 - w)])]; };
  const lipDark = (phi, lip, s) => smoothstep(0.12, 0.0, Math.abs(phi - lip)) * smoothstep(-0.005, 0.015, s) * (1 - smoothstep(S_GAPE - 0.01, S_GAPE + 0.012, s));

  // rings along the body: close together over the beak and head, wider apart along the body
  const sHead = range(0, S_GAPE, N(30), t => t * t * (1.6 - 0.6 * t) / 1.0);
  const sBody = range(S_GAPE, 0.25, N(26)).slice(1).concat(range(0.25, 1.0, N(62)).slice(1));
  // angles round the body: the lower arc between the lips at the gape, the upper arc over the back (the beak's
  // two jaws meet the body along exactly these angles)
  const nLow = N(20), nUp = N(36);
  const lowArc = range(-PHI_GAPE, PHI_GAPE, nLow), upArc = range(PHI_GAPE, TAU - PHI_GAPE, nUp);
  const ringPhi = lowArc.concat(upArc.slice(1));     // -PHI_GAPE .. TAU - PHI_GAPE: closes on itself
  const meta = (s, phi, tint = null, w = 0) => {
    skinColour(s, phi, _col);
    if (tint) _col.lerp(tint, w);
    return { uv: [s * 6, phi / TAU * 2], col: _col, bones: headBones(s) };
  };

  // ---- the body behind the gape: full rings ----
  G.surf(sBody.length ? [S_GAPE, ...sBody] : [S_GAPE], ringPhi, (s, phi, out) => bodyPoint(s, phi, out), (s, phi) => meta(s, phi),
    { pole: (s, phi, out) => out.set(0, 0, -1) });

  // ---- the upper jaw and head in front of the gape: from the left lip over the top to the right lip ----
  G.surf(sHead, range(0, 1, nUp), (s, v, out) => { const l = lipAngle(s); return bodyPoint(s, lerp(l, TAU - l, v), out); },
    (s, v) => {
      const l = lipAngle(s), phi = lerp(l, TAU - l, v);
      const m = meta(s, phi);
      m.col.lerp(COL.lip, 0.85 * Math.max(lipDark(phi, l, s), lipDark(phi, TAU - l, s)));
      return m;
    }, { pole: (s, v, out) => out.set(0, 0.2, 1).normalize() });

  // ---- the lower jaw: from the right lip under the chin to the left lip ----
  G.surf(sHead, range(0, 1, nLow), (s, v, out) => { const l = lipAngle(s); return bodyPoint(s, lerp(-l, l, v), out); },
    (s, v) => {
      const l = lipAngle(s), phi = lerp(-l, l, v);
      const m = meta(s, phi);
      m.col.lerp(COL.lip, 0.85 * Math.max(lipDark(phi, l, s), lipDark(phi, -l, s)));
      m.bones = withJaw(s, jawW(s));
      return m;
    }, { pole: (s, v, out) => out.set(0, -0.2, 1).normalize() });

  // ---- inside the mouth: the palate (arched up into the upper jaw) and the tongue (down into the lower jaw), joining
  // the lips; it closes to nothing at the tip and at the corner of the mouth ----
  const L = new THREE.Vector3(), Rr = new THREE.Vector3();
  const lips = s => { const l = lipAngle(s); bodyPoint(s, l, L); bodyPoint(s, TAU - l, Rr); };
  const arch = s => smoothstep(0, 0.03, s) * (1 - smoothstep(S_GAPE - 0.035, S_GAPE, s));
  const palate = (s, v, out) => { lips(s); const c = section(s); out.copy(L).lerp(Rr, v); out.y += 0.45 * (c.yt - table(MOUTH, s, 1)) * arch(s) * Math.sin(Math.PI * v); return out; };
  const tongue = (s, v, out) => { lips(s); const c = section(s); out.copy(Rr).lerp(L, v); out.y -= 0.42 * (table(MOUTH, s, 1) - c.yb) * arch(s) * Math.sin(Math.PI * v); return out; };
  const nIn = N(10);
  G.surf(sHead, range(0, 1, nIn), palate, (s, v) => ({ uv: [s * 6, v], col: _col.copy(COL.mouth).lerp(COL.lip, smoothstep(0.25, 0.0, Math.min(v, 1 - v))), bones: headBones(s), rough: 0.55 }),
    { flip: true, pole: (s, v, out) => out.set(0, -1, 0) });
  G.surf(sHead, range(0, 1, nIn), tongue, (s, v) => ({ uv: [s * 6, v], col: _col.copy(COL.tongue).lerp(COL.mouth, smoothstep(0.3, 0.0, Math.min(v, 1 - v))), bones: withJaw(s, jawW(s)), rough: 0.5 }),
    { flip: true, pole: (s, v, out) => out.set(0, 1, 0) });

  // ---- teeth: small cones just inside each lip, the upper ones pointing down, the lower ones up ----
  {
    const nT = 11, up = new THREE.Vector3(), base = new THREE.Vector3(), inward = new THREE.Vector3(), q0 = new THREE.Quaternion();
    for (const side of [1, -1]) for (const jaw of [0, 1]) for (let k = 0; k < nT; k++) {
      const s = lerp(0.014, 0.098, (k + 0.5) / nT);
      const l = lipAngle(s);
      bodyPoint(s, side > 0 ? l : TAU - l, base);
      inward.set(-base.x, 0, 0).normalize();
      base.addScaledVector(inward, 0.0045);
      up.set(0, jaw ? 1 : -1, 0);
      const h = 0.0062, r = 0.0026, seg = 5;
      q0.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      const bones = jaw ? withJaw(s, jawW(s)) : headBones(s);
      const b0 = G.count;
      for (let i = 0; i < seg; i++) {
        const a = i / seg * TAU;
        tmp.set(Math.cos(a) * r, 0, Math.sin(a) * r).applyQuaternion(q0).add(base);
        const nn = new THREE.Vector3(Math.cos(a), 0.4, Math.sin(a)).normalize().applyQuaternion(q0);
        G.vert(tmp, nn, [0.5, 0.5], COL.tooth, bones, 0, 0.3);
      }
      tmp.copy(up).multiplyScalar(h).add(base);
      G.vert(tmp, up, [0.5, 0.5], COL.tooth, bones, 0, 0.3);
      for (let i = 0; i < seg; i++) { const a = b0 + i, b = b0 + (i + 1) % seg; if (jaw) G.idx.push(a, b0 + seg, b); else G.idx.push(a, b, b0 + seg); }
    }
  }

  // ---- eyes: dark, glossy, set into the skin just above and behind the corner of the mouth ----
  {
    const sE = 0.118, yE = table(MOUTH, S_GAPE, 1) + 0.035, rE = 0.0152;
    for (const side of [1, -1]) {
      // find the angle on this side where the skin is at the eye's height
      let lo = 0.1, hi = Math.PI - 0.1;
      for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; bodyPoint(sE, m, tmp); if (tmp.y < yE) lo = m; else hi = m; }
      const phi = side > 0 ? (lo + hi) / 2 : TAU - (lo + hi) / 2;
      const c = bodyPoint(sE, phi, new THREE.Vector3());
      const nrm = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
      bodyPoint(sE + 1e-4, phi, a); bodyPoint(sE - 1e-4, phi, b); const ds = a.clone().sub(b);
      bodyPoint(sE, phi + 1e-4, a); bodyPoint(sE, phi - 1e-4, b); const dp = a.clone().sub(b);
      nrm.crossVectors(ds, dp).normalize(); if (nrm.x * side < 0) nrm.negate();
      const centre = c.clone().addScaledVector(nrm, -rE * 0.48);
      const bones = headBones(sE), nu = 10, nv = 16;
      const us = range(0, Math.PI, nu), vs = range(0, TAU, nv);
      G.surf(us, vs, (u, v, out) => out.set(Math.sin(u) * Math.cos(v), Math.cos(u), Math.sin(u) * Math.sin(v)).multiplyScalar(rE).add(centre),
        () => ({ uv: [0.5, 0.5], col: COL.eye, bones, rough: 0.42 }),
        { flip: true, pole: (u, v, out) => out.set(0, u < 1 ? 1 : -1, 0) });
    }
  }

  // ---- the blowhole: a dark crescent on the top of the head, its hollow side forward ----
  {
    const sB = 0.137, c = bodyPoint(sB, Math.PI, new THREE.Vector3()), bones = headBones(sB);
    const n = 12, R = 0.024, w = 0.0055;
    const b0 = G.count, up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i <= n; i++) {
      const a = lerp(-1.05, 1.05, i / n), x = Math.sin(a) * R, z = -Math.cos(a) * R + R * 0.65;
      const taper = Math.sin(Math.PI * i / n);
      for (const k of [-1, 1]) {
        tmp.set(x * (1 + k * w * taper / R), 0, z * (1 + k * w * taper / R) + 0.0);
        tmp.add(c); tmp.y = bodyPoint(sB - (z / LEN), Math.PI - x / 0.2, new THREE.Vector3()).y + 0.0012;
        G.vert(tmp, up, [0.5, 0.5], COL.blow, bones, 0, 0.45);
      }
    }
    for (let i = 0; i < n; i++) { const a = b0 + i * 2; G.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }

  // ---- the dorsal fin: falcate, swept back, thick at the root and thin at the tip and trailing edge ----
  {
    const s0 = 0.40, s1 = 0.545, sTip = 0.59, h = 0.25;
    const rootLE = new THREE.Vector3(0, table(BODY, s0, 1) - 0.012, zAt(s0)), rootTE = new THREE.Vector3(0, table(BODY, s1, 1) - 0.014, zAt(s1));
    const tip = new THREE.Vector3(0, table(BODY, 0.5, 1) + h, zAt(sTip));
    const cLE = new THREE.Vector3(0, rootLE.y + h * 0.72, zAt(0.46)), cTE = new THREE.Vector3(0, rootTE.y + h * 0.42, zAt(0.525));
    const bez = (a, c, b, t, out) => out.copy(a).multiplyScalar((1 - t) * (1 - t)).addScaledVector(c, 2 * t * (1 - t)).addScaledVector(b, t * t);
    const edge = (v, le, te) => { bez(rootLE, cLE, tip, v, le); bez(rootTE, cTE, tip, Math.pow(v, 0.85), te); return { le, te }; };
    const F = finSurface(edge, (v, out) => out.set(1, 0, 0), v => 0.021 * (1 - 0.8 * v) + 0.002);
    const sOf = p => S_COM - p.z / LEN;
    G.surf(range(0, 1, N(22)), range(0, 1, N(18)), F, (u, v, p) => ({ uv: [u * 2, v], col: _col.copy(COL.fin).lerp(COL.cape, 0.4 * (1 - v)), bones: spineWeights(sOf(p)), thin: v > 0.7 ? 0.008 : 0, rough: 0.34 }),
      { pole: (u, v, out) => out.set(0, 1, 0) });
  }

  // ---- the flippers: low on each side behind the head, swept back and down ----
  for (const side of [1, -1]) {
    const root = pecRoot(side, new THREE.Vector3());
    const span = new THREE.Vector3(side * 0.62, -0.5, -0.6).normalize(), chord = new THREE.Vector3(0, 0.12, 1).normalize();
    const thickDir = new THREE.Vector3().crossVectors(span, chord).normalize().multiplyScalar(side);
    const len = 0.37, c0 = 0.17;
    const edge = (v, le, te) => {
      const sp = v * len, c = c0 * (1 - 0.35 * v) * Math.sqrt(Math.max(1 - Math.pow(v, 2.6), 0)) + 0.01 * (1 - v);
      le.copy(root).addScaledVector(span, sp).addScaledVector(chord, c * 0.42 - 0.06 * v * v);
      te.copy(root).addScaledVector(span, sp).addScaledVector(chord, -c * 0.58 - 0.07 * v * v);
      return { le, te };
    };
    const F = finSurface(edge, (v, out) => out.copy(thickDir), v => 0.017 * (1 - 0.75 * v) + 0.002);
    const pec = B.PEC[side > 0 ? 0 : 1];
    G.surf(range(0, 1, N(20)), range(0, 1, N(16)), F, (u, v) => ({ uv: [u * 2, v], col: _col.copy(COL.finLow).lerp(COL.fin, 0.5 + 0.5 * Math.cos(u * TAU) * 0.0 + (u < 0.5 ? 0.25 : -0.1)), bones: v < 0.15 ? [[pec, smoothstep(0, 0.15, v)], [B.SP0, 1 - smoothstep(0, 0.15, v)]] : [[pec, 1]], thin: v > 0.75 ? 0.007 : 0, rough: 0.34 }),
      { pole: (u, v, out) => out.copy(span) });
  }

  // ---- the flukes: a horizontal wing each side of the tail stock, swept back to pointed tips, notched in the middle ----
  for (const side of [1, -1]) {
    const span = 0.31;
    const edge = (v, le, te) => {
      const x = side * v * span;
      // leading edge: from the stock forward of the notch, swept back to the tip
      const zLE = zAt(0.9) - (0.03 * v + 0.15 * v * v);
      // trailing edge: from the notch, curving forward then back out to the tip
      const zTE = zAt(1.0) + 0.045 * Math.sin(Math.PI * Math.min(v * 1.1, 1)) * (1 - v) + 0.01 * smoothstep(0, 0.08, v) - 0.17 * Math.pow(v, 2.6);
      le.set(x, 0, zLE); te.set(x, 0, Math.min(zTE, zLE - 0.012));
      return { le, te };
    };
    const F = finSurface(edge, (v, out) => out.set(0, 1, 0), v => 0.022 * (1 - 0.82 * v) + 0.0015);
    G.surf(range(0, 1, N(20)), range(0, 1, N(16)), F, (u, v, p) => ({ uv: [u * 2, v], col: _col.copy(u < 0.5 ? COL.fin : COL.finLow), bones: spineWeights(S_COM - p.z / LEN), thin: v > 0.7 ? 0.007 : 0, rough: 0.34 }),
      { flip: side < 0, pole: (u, v, out) => out.set(side, 0, 0) });
  }
  return G.build();
}

/* ------------------------------------------------------------------ */
/* Skin texture: fine pores, faint creases and the odd pale scratch     */
/* ------------------------------------------------------------------ */
function skinNormalMap(seed) {
  const W = 256, c = makeCanvas(W, W), g = c.getContext('2d');
  const rng = makeRng(seed), nz = createNoise(seed);
  const img = g.createImageData(W, W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / W;
    // tileable: noise on a torus
    const a = u * TAU, b = v * TAU;
    const n1 = nz.noise3(Math.cos(a) * 2.2, Math.sin(a) * 2.2, Math.cos(b) * 2.2 + Math.sin(b) * 0.7);
    const n2 = nz.noise3(Math.cos(a) * 9 + 5, Math.sin(a) * 9, Math.cos(b) * 9 + Math.sin(b) * 9);
    const h = 0.5 + 0.12 * n1 + 0.035 * n2;
    const i = (y * W + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp(h, 0, 1) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // rake marks: short groups of fine parallel scratches (a dolphin's skin carries the marks of its pod's play)
  g.lineCap = 'round';
  for (let k = 0; k < 9; k++) {
    const x = rng.range(0, W), y = rng.range(0, W), ang = rng.range(-0.5, 0.5) + (rng.next() < 0.5 ? 0 : Math.PI / 2), len = rng.range(14, 40);
    const n = 2 + Math.floor(rng.range(0, 3));
    for (let j = 0; j < n; j++) {
      const off = (j - (n - 1) / 2) * 2.4;
      g.strokeStyle = `rgba(${rng.next() < 0.5 ? '90,90,90' : '170,170,170'},${rng.range(0.35, 0.6)})`;
      g.lineWidth = rng.range(0.6, 1.1);
      for (const dx of [-W, 0, W]) for (const dy of [-W, 0, W]) {
        g.beginPath();
        g.moveTo(x + dx - Math.cos(ang) * len / 2 - Math.sin(ang) * off, y + dy - Math.sin(ang) * len / 2 + Math.cos(ang) * off);
        g.lineTo(x + dx + Math.cos(ang) * len / 2 - Math.sin(ang) * off, y + dy + Math.sin(ang) * len / 2 + Math.cos(ang) * off);
        g.stroke();
      }
    }
  }
  return normalMapFromHeight(c, 3.2, true);
}

function dolphinMaterial(normalMap, U) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 1, metalness: 0, normalMap, normalScale: new THREE.Vector2(0.075, 0.075), envMapIntensity: 0.55,
  });
  patchMaterial(mat, {
    key: 'dolphinGuardian',
    uniforms: U,
    vertexHeader: 'attribute float aThin; attribute float aRough; varying float vDRough; uniform float uDPx;',
    fragmentHeader: 'varying float vDRough; uniform vec3 uDRim; uniform vec3 uDSheen;',
    vertex: {
      '#include <skinning_vertex>': /* glsl */`$&
        vDRough = aRough;
        // thin edges (fin tips) keep at least ~1.6 px on screen instead of breaking into crawling slivers far off
        if (aThin > 0.0) {
          vec4 dmv = modelViewMatrix * vec4(transformed, 1.0);
          float minR = 0.8 * max(-dmv.z, 0.05) / uDPx;
          transformed += normalize(objectNormal + vec3(1e-6)) * max(minR - aThin, 0.0);
        }`,
    },
    fragment: {
      '#include <roughnessmap_fragment>': '$&\n roughnessFactor = vDRough;',
      // wet skin: a soft rim of sky light round the silhouette and a cool sheen, never a flat clay look
      '#include <emissivemap_fragment>': /* glsl */`$&
        { float dr = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += (uDRim * diffuseColor.rgb + uDSheen) * (dr * dr * dr); }`,
    },
  });
  addUnderwater(mat, { key: 'dolphinGuardian' });
  return mat;
}

/* ------------------------------------------------------------------ */
/* Pose                                                                 */
/* ------------------------------------------------------------------ */
const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
/** rotation for a joint: pitch about local X (+ raises what lies toward the tail / lowers what lies toward the head),
 *  yaw about local Y, roll about local Z */
function jointRot(q, pitch, yaw, roll = 0) { return q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ')); }


/* ------------------------------------------------------------------ */
/* Paths through the water                                              */
/* ------------------------------------------------------------------ */
const CRUISE = -0.85;   // the centre's depth swimming between breaths
const STAY_D = -0.31;   // ... holding its head out of the water (the eyes ~15 cm above the surface, the blowhole clear)
const ALPHA = 0.78;     // how far it tilts up to hold its head out (rad): the body slants away under the water
/** A swim along a cubic Bezier over the water (x, z), as functions of time: speeding up from rest (or not), cruising,
 *  slowing to rest at the end (or not); breathing at the surface every few metres; rising into (or sinking from) the
 *  head-up pose at its ends. Nothing is integrated, so it is the same at any frame rate. */
class SwimPath {
  constructor(p0, p1, p2, p3, { v = 3.0, fromRest = false, toRest = true, startY = CRUISE, endY = STAY_D, breaths = 7.5, firstBreath = 4 } = {}) {
    this.p = [p0.clone(), p1.clone(), p2.clone(), p3.clone()];
    this.v = v; this.fromRest = fromRest; this.toRest = toRest; this.startY = startY; this.endY = endY;
    // arc length
    const n = 64, pt = new THREE.Vector3(), prev = new THREE.Vector3();
    this.len = new Float64Array(n + 1); this.n = n;
    this.at(0, prev);
    for (let i = 1; i <= n; i++) { this.at(i / n, pt); this.len[i] = this.len[i - 1] + pt.distanceTo(prev); prev.copy(pt); }
    this.S = this.len[n];
    // speed: accelerate over Da (from rest), cruise, decelerate over Dd (to rest)
    this.Da = fromRest ? Math.min(3, this.S * 0.3) : 0; this.Dd = toRest ? Math.min(3.5, this.S * 0.35) : 0;
    this.Ta = 2 * this.Da / v; this.Td = 2 * this.Dd / v;
    this.Tc = Math.max(0, this.S - this.Da - this.Dd) / v;
    this.T = this.Ta + this.Tc + this.Td;
    // where it breathes: every `breaths` metres, not in the first or last few metres (where it rises or sinks anyway)
    this.breaths = [];
    for (let d = firstBreath; d < this.S - 5.5; d += breaths) this.breaths.push(d);
  }
  /** the curve (x, z; y 0) at parameter u */
  at(u, out) {
    const [a, b, c, d] = this.p, w = 1 - u;
    return out.set(0, 0, 0).addScaledVector(a, w * w * w).addScaledVector(b, 3 * w * w * u).addScaledVector(c, 3 * w * u * u).addScaledVector(d, u * u * u).setY(0);
  }
  uAt(dist) {
    const L = this.len, n = this.n;
    if (dist <= 0) return 0;
    if (dist >= this.S) return 1;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] < dist) lo = m; else hi = m; }
    return (lo + (dist - L[lo]) / Math.max(L[hi] - L[lo], 1e-9)) / n;
  }
  /** distance along at time t (s) */
  dist(t) {
    const v = this.v;
    if (t <= 0) return 0;
    if (t < this.Ta) return 0.5 * (v / this.Ta) * t * t;
    const t2 = t - this.Ta;
    if (t2 < this.Tc) return this.Da + v * t2;
    const t3 = Math.min(t2 - this.Tc, this.Td);
    return this.Da + v * this.Tc + v * t3 - 0.5 * (v / Math.max(this.Td, 1e-6)) * t3 * t3;
  }
  speed(t) {
    const v = this.v;
    if (t < this.Ta) return v * t / this.Ta;
    if (t < this.Ta + this.Tc) return v;
    return Math.max(0, v * (1 - (t - this.Ta - this.Tc) / Math.max(this.Td, 1e-6)));
  }
  /** the centre's height at distance d: cruising depth, a rise to the surface at each breath, the pose at the ends */
  y(d) {
    let y = CRUISE;
    for (const b of this.breaths) { const x = (d - b) / 1.9; if (x > -2.6 && x < 2.6) y += 0.82 * Math.exp(-x * x); }
    if (this.fromRest) y = lerp(this.startY, y, smoothstep(0.2, 3.2, d));
    if (this.toRest) y = lerp(y, this.endY, smoothstep(this.S - 4.6, this.S - 0.25, d));
    return y;
  }
  /** position, heading (yaw), slope (pitch, + nose up) and speed at time t */
  sample(t, o) {
    const d = this.dist(t), u = this.uAt(d);
    this.at(u, o.pos); o.pos.y = this.y(d);
    const u1 = this.uAt(Math.min(d + 0.06, this.S)), u0 = this.uAt(Math.max(d - 0.06, 0));
    this.at(u1, _v); this.at(u0, _v2);
    const dx = _v.x - _v2.x, dz = _v.z - _v2.z;
    if (dx * dx + dz * dz > 1e-10) o.yaw = Math.atan2(dx, dz);
    o.pitch = Math.atan2(this.y(Math.min(d + 0.25, this.S)) - this.y(Math.max(d - 0.25, 0)), 0.5);
    o.speed = this.speed(t);
    // the turn's curvature: how much the heading changes per metre (banks and bends the body)
    const d0 = Math.max(d - 0.8, 0), d1 = Math.min(d + 0.8, this.S);
    o.curve = d1 - d0 > 0.2 ? ((((this.heading(d1) - this.heading(d0) + Math.PI) % TAU) + TAU) % TAU - Math.PI) / (d1 - d0) : 0;
    return o;
  }
  /** the heading at distance d (never from a degenerate stretch, at the ends too) */
  heading(d) {
    const a = Math.max(0, Math.min(d - 0.06, this.S - 0.12)), b = a + 0.12;
    this.at(this.uAt(a), _v); this.at(this.uAt(b), _v2);
    return Math.atan2(_v2.x - _v.x, _v2.z - _v.z);
  }
}

/* ------------------------------------------------------------------ */
/* The dolphin                                                          */
/* ------------------------------------------------------------------ */
const _p = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _q2 = new THREE.Quaternion(), _m4 = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);
const nearAngle = (a, b) => b + ((((a - b) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
const G = 9.8;
const SWELL = 0.54;     // the swell's greatest height over deep water (island/water.js: the waves' amplitudes summed)

export class Dolphin {
  /** ctx: { env, scene, terrain, props, fx, camera } (the island's). Everything is built here. */
  constructor(ctx) {
    this.ctx = ctx;
    this.env = ctx.env;
    this.rng = ctx.rng;
    const q = this.env.q;
    this.geo = buildDolphinGeometry(q);
    this.normalMap = skinNormalMap((this.env.seed % 997) + 3);
    this.U = { uDPx: { value: 900 }, uDRim: { value: new THREE.Color(0.2, 0.23, 0.27) }, uDSheen: { value: new THREE.Color(0.02, 0.03, 0.04) } };
    this.mat = dolphinMaterial(this.normalMap, this.U);
    // a flat skeleton: every bone posed directly in the dolphin's own frame
    this.bones = [];
    for (let i = 0; i < BONE_COUNT; i++) { const b = new THREE.Bone(); b.name = 'dolphinB' + i; this.bones.push(b); }
    const bind = this.bind = new Array(BONE_COUNT).fill(null).map(() => new THREE.Vector3());
    for (const k of Object.keys(JOINT_S)) axisAt(JOINT_S[k], bind[k]);
    bind[B.JAW].set(0, table(MOUTH, S_GAPE, 1), zAt(S_GAPE));
    pecRoot(1, bind[B.PEC[0]]); pecRoot(-1, bind[B.PEC[1]]);
    const root = this.bones[0];
    for (let i = 1; i < BONE_COUNT; i++) { this.bones[i].position.copy(bind[i]); root.add(this.bones[i]); }
    const mesh = new THREE.SkinnedMesh(this.geo, this.mat);
    mesh.add(root);
    mesh.bind(new THREE.Skeleton(this.bones));
    mesh.frustumCulled = false;
    mesh.castShadow = !!this.env.shadows;
    mesh.layers.set(LAYER_NO_REFLECT);  // (the water's mirror leaves swimmers out: they are mostly under it)
    mesh.name = 'dolphinGuardian';
    this.mesh = mesh;
    this.obj = new THREE.Group();
    this.obj.name = 'dolphin';
    this.obj.add(mesh);
    this.obj.visible = false;
    this.obj.rotation.order = 'YXZ';
    ctx.scene.add(this.obj);
    // posed joints (dolphin frame)
    this.P = bind.map(v => v.clone());
    this.Q = bind.map(() => new THREE.Quaternion());
    // points on the body, in the bone frames they move with (eye level on the melon, the blowhole, the beak's tip)
    this.headPt = axisAt(0.11, new THREE.Vector3()).setY(0.06).sub(bind[B.HEAD]);
    this.blowPt = bodyPoint(0.137, Math.PI, new THREE.Vector3()).sub(bind[B.HEAD]);
    this.tipPt = bodyPoint(0.0, 0, new THREE.Vector3()).sub(bind[B.HEAD]);
    this.tailPt = axisAt(0.98, new THREE.Vector3()).sub(bind[B.FLUKE]);

    // state
    this.state = 'away';
    this.t = 0;                         // time in this state
    this.time = 0;                      // the world's clock (update's t)
    this.wait = this.rng.range(25, 50); // the first visit: soon after the world opens
    this.spot = null;                   // { x, z, depth, face } where it holds its head out
    this.path = null;
    this.sw = { pos: new THREE.Vector3(), yaw: 0, pitch: 0, speed: 0, curve: 0 };
    this.com = new THREE.Vector3();     // world centre of mass
    this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.yawS = new Spring(0); this.hYaw = new Spring(0); this.hPitch = new Spring(0.22); this.hRoll = new Spring(0); this.jaw = new Spring(0); this.splay = new Spring(0);
    this.beatPh = 0; this.beatF = 1.4; this.beatA = 1; this.spkPh = 0; this.scullPh = 0;
    this.summoned = false; this.talking = false; this.speaking = false;
    this.mood = null;                   // { kind, t } a reaction under way
    this.leap = null;                   // the leap after a lesson
    this.stayDur = 60;
    this.lookT = 0; this.lookYaw = 0;
    this.breathT = 6;
    this.rippleT = 0;
    this.ff = false;                    // test only: fast-forwarding (no splashes, sounds or ripples)
    // independent random streams for things on their own clocks (same choices at 30 and 60 fps)
    this.rngVisit = this.rng.fork('visits'); this.rngLook = this.rng.fork('look'); this.rngBreath = this.rng.fork('breath');
    this.spots = null;
    this.restPose();
    this.pose();
  }

  /* ---------- where it comes: deep enough water by the dock's end, clear of the dock and the boat ---------- */
  findSpots() {
    const { terrain, props } = this.ctx, H = terrain.height;
    const D = props.dockEnd, dir = props.dockDir, perp = props.dockPerp;
    const deep = (x, z, need) => { if (H(x, z) > -need) return false; for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; if (H(x + Math.cos(a) * 1.3, z + Math.sin(a) * 1.3) > -need + 0.25) return false; } return true; };
    const clearOfDock = (x, z, r) => {
      // distance to the dock's centre line (start .. end) less its half width and the platform
      const s = props.dockStart, ex = D.x - s.x, ez = D.z - s.z, L2 = ex * ex + ez * ez;
      const k = clamp(((x - s.x) * ex + (z - s.z) * ez) / L2, 0, 1);
      const dd = Math.hypot(x - (s.x + ex * k), z - (s.z + ez * k)) - (k > 0.92 ? (props.platform || 2) * 0.75 : 1.05);
      const db = Math.hypot(x - props.boatBase.x, z - props.boatBase.z) - 1.4;
      return dd > r && db > r && !props.onDock(x, z);
    };
    const out = [];
    for (const a of [-4, -2.5, -1, 0.5, 2, 3.5, 5, 6.5, 8]) for (const b of [-6.5, -5, -3.5, -2, 0, 2, 3.5, 5, 6.5]) {
      if (a < 2.5 && Math.abs(b) < 2.5) continue;
      const x = D.x + dir.x * a + perp.x * b, z = D.z + dir.z * a + perp.z * b;
      if (!deep(x, z, 1.9) || !clearOfDock(x, z, 1.9)) continue;
      // it faces the dock's end (and the island past it); `leaps`: the ways a leap fits from here
      const sp = { x, z, depth: -H(x, z), face: Math.atan2(D.x - x, D.z - z), a, b };
      sp.leaps = this.leapLanes(sp).length;
      out.push(sp);
    }
    this.spots = out;
    return out;
  }
  /** The spot for a visit: one the camera sees well (in the middle of the picture, near, not behind the dock). */
  pickSpot() {
    const spots = this.spots || this.findSpots();
    if (!spots.length) return null;
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    const scored = [];
    for (const sp of spots) {
      _p.set(sp.x, 0.4, sp.z).project(cam);
      if (_p.z > 1) continue;
      const camD = Math.hypot(sp.x - cam.position.x, sp.z - cam.position.z);
      // in view, out in open water a few metres off the dock (the hut and the dock behind it, no post in front of
      // it), with room round it to leap, and not out where the swell is big
      const sc = -Math.abs(_p.x) * 1.4 - Math.abs(_p.y + 0.05) * 1.2 - (Math.abs(_p.x) > 0.75 || Math.abs(_p.y) > 0.75 ? 3 : 0) - camD * 0.01
        - 0.3 * Math.abs(Math.abs(sp.b) - 5) - (sp.leaps ? 0 : 1.2) - 0.25 * Math.max(0, sp.depth - 3.4);
      scored.push({ sp, sc });
    }
    if (!scored.length) return spots[0];
    // of the best few, one where a leap fits across the picture the lesson camera will have there (seen from the side
    // the camera is on now)
    scored.sort((a, b) => b.sc - a.sc);
    const fw = cam.getWorldDirection(_a), yaw = Math.atan2(-fw.x, -fw.z);
    const tmp = this._tmpCam || (this._tmpCam = new THREE.PerspectiveCamera());
    tmp.fov = cam.fov; tmp.aspect = cam.aspect; tmp.near = cam.near; tmp.far = cam.far; tmp.updateProjectionMatrix();
    let best = scored[0].sp, bs = -Infinity;
    for (const c of scored.slice(0, 8)) {
      const v = this.view(yaw, c.sp), cp = Math.cos(v.pitch);
      tmp.position.set(v.target.x + v.dist * cp * Math.sin(v.yaw), Math.max(v.target.y + v.dist * Math.sin(v.pitch), v.minY), v.target.z + v.dist * cp * Math.cos(v.yaw));
      tmp.lookAt(v.target); tmp.updateMatrixWorld();
      const leap = c.sp.leaps && this.leapLanes(c.sp, tmp).some(l => l.across >= 0.45);
      const sc = c.sc + (leap ? 1.5 : 0);
      if (sc > bs) { bs = sc; best = c.sp; }
    }
    return best;
  }
  /** A start (or end) point out in the open water away from the island, the straight way to it deep enough. */
  offshore(sp, rng) {
    const H = this.ctx.terrain.height;
    const out = new THREE.Vector3(sp.x, 0, sp.z).normalize();
    const side = new THREE.Vector3(-out.z, 0, out.x);
    let best = null, bd = -Infinity;
    for (let k = 0; k < 8; k++) {
      const lat = rng.range(-9, 9), dist = rng.range(20, 26);
      const e = new THREE.Vector3(sp.x, 0, sp.z).addScaledVector(out, dist).addScaledVector(side, lat);
      let minD = Infinity;
      for (let i = 1; i <= 12; i++) { const f = i / 12; minD = Math.min(minD, -H(lerp(sp.x, e.x, f), lerp(sp.z, e.z, f))); }
      if (minD > bd) { bd = minD; best = e; }
      if (minD > 1.6) break;
    }
    return best;
  }

  /* ---------- the visit ---------- */
  beginVisit(spot = null) {
    const sp = spot || this.pickSpot();
    if (!sp) { this.wait = 60; return false; }
    this.spot = sp;
    const start = this.offshore(sp, this.rngVisit);
    const end = new THREE.Vector3(sp.x, 0, sp.z);
    const toSpot = _a.subVectors(end, start).normalize();
    // it comes in from the open water, straight for the last few metres, slowing, lifting its head and turning a
    // little toward the dock as it stops (the rest of the turn comes slowly after)
    const p1 = start.clone().addScaledVector(toSpot, 7), p2 = end.clone().addScaledVector(toSpot, -4.5);
    this.path = new SwimPath(start, p1, p2, end, { v: 3.1, fromRest: false, toRest: true, firstBreath: 3.5 });
    this.arriveFace = this.settleYaw(Math.atan2(toSpot.x, toSpot.z), sp.face);
    this.state = 'arrive'; this.t = 0;
    this.obj.visible = true;
    this.yawS.set(sp.face);
    this.breathDone = new Set();
    return true;
  }
  /** called back while leaving: it turns round where it is and comes straight back */
  comeBack() {
    const sp = this.spot || this.pickSpot();
    if (!sp) return;
    this.spot = sp;
    const start = this.com.clone().setY(0), end = new THREE.Vector3(sp.x, 0, sp.z);
    const head = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), toSpot = _a.subVectors(end, start).normalize();
    const p1 = start.clone().addScaledVector(head, 3.5), p2 = end.clone().addScaledVector(toSpot, -3.5);
    this.path = new SwimPath(start, p1, p2, end, { v: 3.0, fromRest: false, toRest: true, startY: this.com.y, firstBreath: 2.5 });
    this.arriveFace = this.settleYaw(Math.atan2(toSpot.x, toSpot.z), sp.face);
    this.path.startY = this.com.y;
    this.state = 'arrive'; this.t = 0;
    this.breathDone = new Set();
  }
  /** the way it faces as it stops: its heading, turned toward `face` by no more than ~35° */
  settleYaw(heading, face) { return heading + clamp(nearAngle(face, heading) - heading, -0.6, 0.6); }
  beginLeave() {
    const sp = this.spot;
    const end = this.offshore(sp, this.rngVisit);
    const start = new THREE.Vector3(sp.x, 0, sp.z);
    const away = _a.subVectors(end, start).normalize();
    const p1 = start.clone().addScaledVector(away, 4), p2 = end.clone().addScaledVector(away, -7);
    this.path = new SwimPath(start, p1, p2, end, { v: 3.4, fromRest: true, toRest: false, startY: STAY_D, firstBreath: 6 });
    this.leaveFrom = { yaw: this.yaw, pitch: this.pitch };
    this.state = 'leave'; this.t = 0;
    this.breathDone = new Set();
  }
  endVisit() {
    this.state = 'away'; this.t = 0; this.path = null;
    this.obj.visible = false;
    this.wait = this.rngVisit.range(150, 330);
    this.mood = null; this.leap = null;
  }

  /* ---------- lessons (lib/guide.js): called in, it stays while someone talks with it, turned to them ---------- */
  /** 'away' (not here), 'leaving', 'coming' (swimming in) or 'ready' (holding its head out by the dock) */
  lessonState() {
    if (this.state === 'stay') return 'ready';
    if (this.state === 'leave') return 'leaving';
    return this.state === 'away' && !this.summoned ? 'away' : 'coming';
  }
  /** Called for a lesson: it comes now, to a spot in view, or stays on where it is (leaving, it comes straight back). */
  summon() {
    this.summoned = true;
    if (this.state === 'away') this.beginVisit();
    else if (this.state === 'leave') this.comeBack();
    else this.stayDur = Infinity;
  }
  /** Someone talks with it (it turns to them and attends) or has finished. */
  talk(on) {
    this.talking = !!on;
    if (this.talking) this.summon(); else this.speaking = false;
  }
  /** What was just said: 'yes' (a right answer), 'no' (a wrong one) or 'done' (the lesson is over). */
  react(kind) {
    if (kind === 'done') { if (!this.startLeap()) this.mood = { kind: 'spin', t: 0 }; return; }
    this.mood = { kind, t: 0 };
    if (kind === 'yes' && !this.ff) this.env.sfx('whistle');
  }
  /** The lesson is over (or put off): it stays a while longer, then swims off as it always does. */
  release() {
    this.summoned = false; this.talking = false; this.speaking = false;
    if (this.state === 'stay') this.stayDur = this.t + this.rngVisit.range(20, 40);
  }

  /* ---------- the leap: under, a run, out of the water with a spin, back in, round and up again ---------- */
  /** The ways a leap fits from spot sp: its frame (u across, w away), moved over by (ox, oz), the keys of its path,
   *  wherever the run, the leap and the landing have deep, clear water (no dock, no boat). `cam` (if given): also
   *  the launch, the top and the landing in its picture, and none of it right under it. */
  leapLanes(sp, cam = null) {
    const H = this.ctx.terrain.height, props = this.ctx.props, bx = props.boatBase;
    const vu = 5.2 * Math.cos(0.87), vy = 5.2 * Math.sin(0.87), Tf = 2 * vy / G;
    const out = [], w0 = cam ? new THREE.Vector3(sp.x - cam.position.x, 0, sp.z - cam.position.z).normalize() : null;
    if (cam) cam.updateMatrixWorld();
    for (let k = 0; k < 16; k++) {
      const ang = k / 16 * TAU, u = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang)), w = new THREE.Vector3(-u.z, 0, u.x);
      if (w0 && w.dot(w0) < 0) w.negate();   // (z: away from the camera)
      for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, -0.6], [0, 1]]) {
        const keys = this.leapKeys(vu, vy, Tf, ox, oz);
        let ok = true;
        for (let i = 0; i < keys.length && ok; i++) {
          const kp = keys[i].p, x = sp.x + u.x * kp.x + w.x * kp.z, z = sp.z + u.z * kp.x + w.z * kp.z;
          if (H(x, z) > (kp.y < -0.5 ? -1.6 : -1.3) || props.onDock(x, z) || Math.hypot(x - bx.x, z - bx.z) < 2.0) ok = false;
          else if (cam) {
            if (Math.hypot(x - cam.position.x, z - cam.position.z) < 1.6) ok = false;
            // the launch and the landing in the picture (the dives before and after may leave it)
            if (i === 3 || i === 4) { _p.set(x, 0.5, z).project(cam); if (_p.z > 1 || Math.abs(_p.x) > 0.95 || _p.y > 0.9) ok = false; }
          }
        }
        if (ok && cam) { // and the top of the arc
          const m = keys[3].p.clone().lerp(keys[4].p, 0.5);
          _p.set(sp.x + u.x * m.x + w.x * m.z, vy * vy / (2 * G), sp.z + u.z * m.x + w.z * m.z).project(cam);
          ok = _p.z < 1 && Math.abs(_p.x) < 0.95 && _p.y < 1.0;
        }
        if (ok) out.push({ u, w, keys, vu, vy, Tf, across: w0 ? 1 - Math.abs(u.dot(w0)) : 1, off: Math.hypot(ox, oz) });
      }
    }
    return out;
  }
  /** The lesson learnt: a leap across the camera's view where one fits (as nearly across as it can), else false (it
   *  spins high out of the water instead). */
  startLeap() {
    if (this.state !== 'stay' || !this.spot) return false;
    const lanes = this.leapLanes(this.spot, this.ctx.camera);
    if (!lanes.length) return false;
    lanes.sort((a, b) => (b.across * 2 - b.off * 0.3) - (a.across * 2 - a.off * 0.3));
    const L = lanes[0];
    if (L.across < 0.45) return false;   // (straight at or away from the camera it would not read as a leap)
    this.leap = { t: 0, u: L.u, w: L.w, keys: L.keys, vu: L.vu, vy: L.vy, Tf: L.Tf, launched: false, entered: false };
    this.mood = null;
    return true;
  }
  /** the leap as keys of the centre's path in the leap's own frame (x across the view, z away from the camera, y up),
   *  with velocities; between the launch and the entry it flies free */
  leapKeys(vu, vy, Tf, ox = 0, oz = 0) {
    // (ox, oz: the run, the leap and the landing moved over; it eases there from where it holds itself out, and back)
    const tL = 2.3, tE = tL + Tf, x0 = -1.35, x1 = x0 + vu * Tf;
    const K = (t, x, y, z, w, v = null) => ({ t, p: new THREE.Vector3(x + ox * w, y, z + oz * w), v });
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    return [
      K(0, 0, STAY_D, 0, 0, V(0, 0, 0)), K(0.9, -0.45, -1.0, 0.85, 0.6), K(1.8, -1.55, -0.9, 1.55, 1),
      K(tL, x0, 0, 1.8, 1, V(vu, vy, 0)), K(tE, x1, 0, 1.8, 1, V(vu, -vy, 0)),
      K(tE + 0.9, x1 + 0.95, -1.0, 1.6, 1), K(tE + 2.1, x1 - 0.2, -0.95, 0.6, 0.85), K(tE + 3.2, 0.15, -0.6, 0.05, 0.35), K(tE + 4.0, 0, STAY_D, 0, 0, V(0, 0, 0)),
    ];
  }
  /** the leap's centre (leap frame) and velocity at time t */
  leapAt(L, t, pos, vel) {
    const ks = L.keys, tL = ks[3].t, tE = ks[4].t;
    if (t >= tL && t <= tE) { // free flight
      const f = t - tL;
      pos.set(ks[3].p.x + L.vu * f, L.vy * f - 0.5 * G * f * f, ks[3].p.z);
      vel.set(L.vu, L.vy - G * f, 0);
      return;
    }
    let i = 0; while (i < ks.length - 2 && t > ks[i + 1].t) i++;
    const a = ks[i], b = ks[i + 1], h = b.t - a.t, s = clamp((t - a.t) / h, 0, 1);
    const tan = (k, j) => k.v ? k.v : ks[Math.min(j + 1, ks.length - 1)].p.clone().sub(ks[Math.max(j - 1, 0)].p).divideScalar(ks[Math.min(j + 1, ks.length - 1)].t - ks[Math.max(j - 1, 0)].t);
    const ma = tan(a, i), mb = tan(b, i + 1);
    const s2 = s * s, s3 = s2 * s;
    pos.copy(a.p).multiplyScalar(2 * s3 - 3 * s2 + 1).addScaledVector(ma, (s3 - 2 * s2 + s) * h).addScaledVector(b.p, 3 * s2 - 2 * s3).addScaledVector(mb, (s3 - s2) * h);
    vel.copy(a.p).multiplyScalar((6 * s2 - 6 * s) / h).addScaledVector(ma, 3 * s2 - 4 * s + 1).addScaledVector(b.p, (6 * s - 6 * s2) / h).addScaledVector(mb, 3 * s2 - 2 * s);
  }

  /* ---------- every frame ---------- */
  update(dt, time) {
    this.time = time;
    if (this.state === 'away') {
      if (this.summoned) this.beginVisit();
      else { this.wait -= dt; if (this.wait <= 0) this.beginVisit(); }
      if (this.state === 'away') return;
    }
    this.t += dt;
    const S = this.state;
    if (S === 'arrive') this.updateSwim(dt, true);
    else if (S === 'leave') this.updateSwim(dt, false);
    else if (S === 'stay') this.updateStay(dt);
    if (this.state === 'away') return;
    this.applyRoot();
    this.pose();
    this.U.uDPx.value = 0.5 * this.env.renderer.getDrawingBufferSize(_v2).y * this.ctx.camera.projectionMatrix.elements[5];
  }
  /** tail beat: phase integrated over the step with Simpson's rule (f is a smooth function of time) */
  beat(dt, f0, f1, fm) { this.beatPh = (this.beatPh + TAU * dt * (f0 + 4 * fm + f1) / 6) % (TAU * 64); }

  updateSwim(dt, arriving) {
    const P = this.path, t = this.t, sw = this.sw;
    P.sample(Math.min(t, P.T), sw);
    const vFrac = clamp(sw.speed / P.v, 0, 1);
    // frequency follows speed; amplitude too, never quite still
    const f = s => lerp(0.85, 1.75, clamp(P.speed(s) / P.v, 0, 1));
    this.beat(dt, f(t - dt), f(t), f(t - dt / 2));
    this.beatA = lerp(0.55, 1.15, vFrac);
    this.com.copy(sw.pos);
    {
      const sp = this.spot, k = arriving ? smoothstep(P.T - 2.4, P.T, t) : 1 - smoothstep(0, 1.8, t);
      if (k > 0) this.com.y += k * waveHeight(sp.x, sp.z, this.time, sp.depth);
    }
    let yaw = sw.yaw, pitch = sw.pitch, roll = -clamp(sw.curve * sw.speed * 0.35, -0.5, 0.5);
    this.curve = clamp(sw.curve, -0.6, 0.6);
    if (arriving) {
      // the last moments: it slows, turns to face the dock and lifts its head out
      const k = smoothstep(P.T - 2.2, P.T, t), face = nearAngle(this.arriveFace, yaw);
      yaw = lerp(yaw, face, k); pitch = lerp(pitch, ALPHA, easeIO(k)); roll *= 1 - k;
      this.headBase = lerp(0.04, 0.22, k);
      this.yawS.set(yaw);
    } else {
      // first moments: it lowers its head and tips forward under the water
      const k = smoothstep(0, 1.6, t), L = this.leaveFrom;
      yaw = lerp(nearAngle(L.yaw, yaw), yaw, k);
      pitch = lerp(L.pitch, pitch, k);
      this.headBase = lerp(0.22, 0.04, k);
    }
    this.yaw = yaw; this.pitch = pitch; this.roll = roll;
    this.hYaw.step(0, 3, dt); this.hRoll.step(0, 3, dt); this.hPitch.step(this.headBase, 4, dt); this.jaw.step(0, 5, dt);
    this.splay.step(arriving ? smoothstep(this.path.T - 2.5, this.path.T, this.t) : 1 - smoothstep(0, 1.2, this.t), 6, dt);
    this.breathe(P, dt);
    if (t >= P.T) {
      if (arriving) {
        this.state = 'stay'; this.t = 0;
        this.stayDur = this.summoned ? Infinity : this.rngVisit.range(55, 110);
        this.lookT = this.rngLook.range(2, 4);
      } else this.endVisit();
    }
  }
  /** a breath at the top of each rise to the surface: a puff of spray from the blowhole */
  breathe(P, dt) {
    const d = P.dist(this.t);
    for (const b of P.breaths) {
      if (d >= b && !this.breathDone.has(b)) {
        this.breathDone.add(b);
        if (!this.ff && this.obj.visible) {
          this.worldPoint(B.HEAD, this.blowPt, _c);
          this.ctx.fx.spray(_c.setY(Math.max(_c.y, 0.05)), Math.sin(this.yaw) * 0.6, Math.cos(this.yaw) * 0.6, 6, 0.45);
          this.ctx.fx.ripple(this.com.x, this.com.z, 1.5, 1.6, 0.45);
        }
      }
    }
  }

  updateStay(dt) {
    const sp = this.spot, t = this.t, cam = this.ctx.camera;
    if (!this.summoned && !this.talking && t > this.stayDur && !this.leap) { this.beginLeave(); return; }
    // sculling to hold its head out: a slow beat, the body rising and settling a little with each stroke
    const fS = 0.82;
    this.beat(dt, fS, fS, fS);
    const ease = smoothstep(0, 1.4, t);   // (the sway and bob of sculling come in gently after it stops)
    this.beatA = lerp(0.55, 0.45, ease);
    this.scullPh = this.beatPh;
    const H = this.ctx.terrain.height;
    const wy = waveHeight(sp.x, sp.z, this.time, sp.depth);
    let bob = 0.018 * Math.sin(this.beatPh - 0.6) * ease;
    // where it looks: at whoever talks with it, else at the island, glancing about now and then
    let target = sp.face;
    if (this.talking) target = this.talkYaw(cam);
    else {
      this.lookT -= dt;
      if (this.lookT <= 0) { this.lookT = this.rngLook.range(3, 7); this.lookYaw = this.rngLook.range(-0.45, 0.45); }
    }
    const bodyYaw = this.yawS.step(nearAngle(target, this.yawS.x), this.talking ? 1.6 : 0.7, dt);
    // its head turned to whoever talks with it (or glancing about)
    const toCam = Math.atan2(cam.position.x - this.com.x, cam.position.z - this.com.z);
    let hy = this.talking ? clamp(nearAngle(toCam, bodyYaw) - bodyYaw, -0.3, 0.3) : this.lookYaw * 0.6;
    let hp = 0.22, hr = 0, jaw = 0.0, pitch = ALPHA + 0.03 * Math.sin(this.beatPh + 1.1) * ease, roll = 0;
    // speaking: chattering with its beak, nodding along
    if (this.speaking) {
      this.spkPh += TAU * 3.3 * dt;
      const sy = Math.max(0, Math.sin(this.spkPh)) * (0.55 + 0.45 * Math.sin(this.spkPh * 0.37 + 1.3));
      jaw += 0.17 * sy;
      hp += 0.035 * Math.sin(this.spkPh * 0.5) ; hr += 0.04 * Math.sin(this.spkPh * 0.23);
    }
    // reactions
    const M = this.mood;
    if (M) {
      M.t += dt;
      const e = M.kind === 'yes' ? envl(M.t, 1.5, 0.25) : M.kind === 'no' ? envl(M.t, 1.6, 0.25) : envl(M.t, 2.6, 0.35);
      if (M.kind === 'yes') { hp += 0.26 * Math.sin(TAU * 1.8 * M.t) * e; bob += 0.06 * e; jaw += 0.12 * e; }
      else if (M.kind === 'no') { hy += 0.32 * Math.sin(TAU * 1.45 * M.t) * e; hr += 0.08 * Math.sin(TAU * 1.45 * M.t + 0.6) * e; jaw = Math.max(0.0, jaw - 0.03 * e); }
      else if (M.kind === 'spin') { bob += 0.3 * e; pitch += 0.35 * e; this.yawS.x += TAU / 2.6 * dt * smoothstep(0.3, 0.6, M.t) * (1 - smoothstep(2.0, 2.3, M.t)); jaw += 0.1 * e; }
      if (M.t > (M.kind === 'spin' ? 2.6 : 1.7)) this.mood = null;
    }
    // a breath now and then: the head rises a little and a puff of spray leaves the blowhole
    this.breathT -= dt;
    if (this.breathT <= 0) {
      this.breathT = this.rngBreath.range(14, 24);
      this.breathAt = t;
      // (a puff of spray only when no one is close by: next to the camera it would be a blob)
      if (!this.ff && !this.talking) { this.worldPoint(B.HEAD, this.blowPt, _c); this.ctx.fx.spray(_c, 0, 0, 3, 0.16); }
    }
    if (this.breathAt !== undefined) bob += 0.02 * envl(t - this.breathAt, 0.9, 0.3);
    this.com.set(sp.x, wy + STAY_D + bob, sp.z);  // (it rides the swell: its head stays the same height out of the water)
    this.yaw = bodyYaw; this.pitch = pitch; this.roll = roll;
    this.curve = 0;
    this.hYaw.step(hy, this.mood ? 14 : 4, dt); this.hPitch.step(hp, this.mood ? 16 : 5, dt); this.hRoll.step(hr, 6, dt); this.jaw.step(jaw, 22, dt);
    this.splay.step(this.leap ? 0 : 1, 4, dt);
    this.headBase = 0.22;
    // the leap
    if (this.leap) this.updateLeap(dt);
    // rings spreading from where it holds itself out of the water
    this.rippleT -= dt;
    if (this.rippleT <= 0 && !this.leap) {
      this.rippleT = 2.6;
      if (!this.ff) { this.worldPoint(B.HEAD, this.headPt, _c); this.ctx.fx.ripple(lerp(_c.x, this.com.x, 0.5), lerp(_c.z, this.com.z, 0.5), 0.9, 2.2, 0.14); }
    }
  }
  /** The way its body faces while it talks: three-quarters on to the camera (a dolphin is known by its profile),
   *  turned toward the dock rather than away from it; its head turns the rest of the way. */
  talkYaw(cam, sp = this.spot) {
    const toCam = Math.atan2(cam.position.x - sp.x, cam.position.z - sp.z);
    const a = toCam + 0.62, b = toCam - 0.62;
    return Math.abs(nearAngle(a, sp.face) - sp.face) < Math.abs(nearAngle(b, sp.face) - sp.face) ? a : b;
  }
  updateLeap(dt) {
    const L = this.leap, sp = this.spot;
    L.t += dt;
    const ks = L.keys, end = ks[ks.length - 1].t;
    this.leapAt(L, Math.min(L.t, end), _a, _b);
    // the leap frame to the world: x across the view, z away from the camera
    const x = sp.x + L.u.x * _a.x + L.w.x * _a.z, z = sp.z + L.u.z * _a.x + L.w.z * _a.z;
    const vx = L.u.x * _b.x + L.w.x * _b.z, vz = L.u.z * _b.x + L.w.z * _b.z, vh = Math.hypot(vx, vz);
    const k = smoothstep(0, 0.6, L.t) * (1 - smoothstep(end - 0.7, end, L.t)); // from and back to the head-up pose
    this.com.set(lerp(this.com.x, x, k), lerp(this.com.y, _a.y, k), lerp(this.com.z, z, k));
    if (vh > 0.05) this.yaw = lerp(this.yaw, nearAngle(Math.atan2(vx, vz), this.yaw), k);
    this.pitch = lerp(this.pitch, Math.atan2(_b.y, Math.max(vh, 0.05)), k);
    const tL = ks[3].t, tE = ks[4].t;
    // in the air: one full turn round its own length
    this.roll = TAU * easeIO(clamp((L.t - tL) / (tE - tL), 0, 1));
    this.beatA = 1.25 * k + 0.45 * (1 - k);
    this.beatPh += TAU * 2.0 * dt * k;
    this.yawS.set(this.yaw);
    if (!L.launched && L.t >= tL) { L.launched = true; if (!this.ff) { this.ctx.fx.splash(_c.set(x, 0, z), 18, 1.0); this.ctx.fx.ripple(x, z, 1.8, 1.8, 0.55); this.env.sfx('whistle'); } }
    if (!L.entered && L.t >= tE) { L.entered = true; if (!this.ff) { this.ctx.fx.splash(_c.set(x, 0, z), 30, 1.45); this.ctx.fx.ripple(x, z, 2.4, 2.4, 0.7); this.ctx.fx.ripple(x, z, 1.4, 1.6, 0.5); this.env.sfx('splash'); } }
    if (L.t >= end) { this.leap = null; this.roll = 0; }
  }

  /* ---------- pose ---------- */
  restPose() {
    this.com.set(0, -10, 0);
    this.yaw = 0; this.pitch = 0; this.roll = 0; this.curve = 0; this.headBase = 0.04;
  }
  applyRoot() {
    this.obj.position.copy(this.com);
    // (YXZ: yaw, then pitch, + nose up, then roll round its own length)
    this.obj.rotation.set(-this.pitch, this.yaw, this.roll);
    this.obj.updateMatrixWorld();
  }
  /** The joints from the pose values: the head and jaw, the tail's beat and the body's curve. */
  pose() {
    const P = this.P, Q = this.Q, bind = this.bind;
    const link = (j, parent, rot) => {
      P[j].copy(bind[j]).sub(bind[parent]).applyQuaternion(Q[parent]).add(P[parent]);
      Q[j].copy(Q[parent]).multiply(rot);
    };
    P[B.SP1].copy(bind[B.SP1]); Q[B.SP1].identity();
    const curve = this.curve || 0;
    link(B.SP0, B.SP1, jointRot(_q, 0.06 * (this.headBase || 0) - 0.02 * Math.sin(this.beatPh + 2.2) * this.beatA, curve * 0.25));
    link(B.HEAD, B.SP0, jointRot(_q, this.hPitch.x, this.hYaw.x + curve * 0.2, this.hRoll.x));
    link(B.JAW, B.HEAD, jointRot(_q, clamp(this.jaw.x, 0, 0.3), 0));
    // the flippers scull a little and steer into turns
    const sc = Math.sin(this.beatPh * 0.5 + 0.4), sp = this.splay.x;
    link(B.PEC[0], B.SP0, jointRot(_q, 0.1 * sc - 0.25 * sp, 0.05 * sc - curve * 0.3 + 0.2 * sp, -0.15 * sc + 0.75 * sp));
    link(B.PEC[1], B.SP0, jointRot(_q, -0.1 * sc - 0.25 * sp, -0.05 * sc - curve * 0.3 - 0.2 * sp, 0.15 * sc - 0.75 * sp));
    // the tail: a wave running back to the flukes (up and down: a dolphin swims with its flukes), the body's curve in turns
    const amp = [0.025, 0.045, 0.07, 0.09, 0.1, 0.24], lag = [0.0, 0.35, 0.7, 1.05, 1.4, 2.1];
    let parent = B.SP1;
    for (let k = 0; k < BACK.length; k++) {
      const j = BACK[k];
      link(j, parent, jointRot(_q, amp[k] * this.beatA * Math.sin(this.beatPh - lag[k]), -curve * 0.22));
      parent = j;
    }
    for (let i = 1; i < BONE_COUNT; i++) { this.bones[i].position.copy(P[i]); this.bones[i].quaternion.copy(Q[i]); }
  }
  /** a point given in a bone's bind frame, where it is now in the world */
  worldPoint(bone, local, out) {
    out.copy(local).applyQuaternion(this.Q[bone]).add(this.P[bone]);
    return out.applyMatrix4(this.obj.matrixWorld);
  }

  /* ---------- for the guide and the camera ---------- */
  /** the point above its head (the marker) */
  anchor(out) { this.worldPoint(B.HEAD, this.headPt, out); out.y += 0.42; return out; }
  /** what a tap can find: its head, while it is near the surface */
  pickTarget() {
    if (!this.obj.visible || this.com.y < -1.3) return null;
    this.worldPoint(B.HEAD, this.headPt, this._pick || (this._pick = new THREE.Vector3()));
    return { member: null, label: '海豚', guardian: 'dolphin', pos: this._pick, radius: 0.6 };
  }
  /** the camera's target while it talks: steady over the spot, at the height of its head */
  look(out, sp = this.spot, y = this.yawS.x) {
    if (!sp) return out.copy(this.com);
    // over the spot, moved toward where its head is (half a metre along the way it faces), a little below its head
    return out.set(sp.x + Math.sin(y) * 0.42, 0.1, sp.z + Math.cos(y) * 0.42);
  }
  /**
   * The camera for a lesson: low over the water, close, from the side the camera is already on (turned where the dock,
   * the boat or the shore would stand between or under it). It is free to come lower than the island's own view.
   */
  view(yaw, sp = this.spot) {
    const cam = this.ctx.camera;
    const portrait = cam.aspect < 0.9;
    const v = { target: null, yaw, pitch: 0.26, dist: portrait ? 3.3 : 2.4, minY: 0.7 };
    // (it will be three-quarters on to this yaw, so the head's place depends on it)
    const head = yy => this.look(new THREE.Vector3(), sp, this.talkYaw({ position: _c.set(sp.x + Math.sin(yy) * 3, 1, sp.z + Math.cos(yy) * 3) }, sp));
    v.target = head(yaw);
    for (const d of [0, 0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.4, -1.4, 1.75, -1.75]) {
      const y = yaw + d;
      const tg = head(y);
      if (this.viewClear(tg, y, v.pitch, v.dist)) { v.yaw = y; v.target = tg; break; }
    }
    // never where a wave could come up to it: the swell's reach at the camera (it is calmer over shallow water)
    {
      const cp = Math.cos(v.pitch), cx = v.target.x + v.dist * cp * Math.sin(v.yaw), cz = v.target.z + v.dist * cp * Math.cos(v.yaw);
      v.minY = Math.max(0.7, 0.38 + SWELL * smoothstep(0.3, 5.5, -this.ctx.terrain.height(cx, cz)));
    }
    return v;
  }
  viewClear(t, yaw, pitch, dist) {
    const { terrain, props } = this.ctx, cp = Math.cos(pitch);
    const c = _p.set(t.x + dist * cp * Math.sin(yaw), t.y + dist * Math.sin(pitch), t.z + dist * cp * Math.cos(yaw));
    if (terrain.height(c.x, c.z) > -0.6 || props.onDock(c.x, c.z)) return false;
    const ray = this._ray || (this._ray = new THREE.Raycaster());
    for (const h of [0.15, 0.55]) {
      _a.set(t.x, h, t.z); _b.subVectors(c, _a); const len = _b.length();
      ray.set(_a, _b.divideScalar(len)); ray.far = len;
      if (ray.intersectObject(props.group, true).length) return false;
    }
    return true;
  }
  /** where a new resident given for a lesson comes into the water: beside it, in view */
  rewardAt(out) {
    const sp = this.spot, cam = this.ctx.camera;
    if (!sp) return out.copy(this.com);
    const w = _a.set(sp.x - cam.position.x, 0, sp.z - cam.position.z).normalize();
    const H = this.ctx.terrain.height;
    // to one side of it and a little beyond (seen whole, not in front of the camera)
    for (const s of [1, -1, 1.5, -1.5]) {
      out.set(sp.x + w.z * 1.5 * s + w.x * 1.2, -0.4, sp.z - w.x * 1.5 * s + w.z * 1.2);
      if (H(out.x, out.z) < -1.0) return out;
    }
    return out.set(sp.x, -0.4, sp.z);
  }

  /** Test hook: start a visit now (at the spot the camera sees best) and play it t seconds in. */
  debug(t = 12, stay = 120) {
    this.endVisit();
    this.beginVisit();
    this.ff = true;
    const step = 1 / 30;
    for (let k = 0; k < Math.round(t / step); k++) this.update(step, this.time + step);
    this.ff = false;
    if (this.state === 'stay') this.stayDur = Math.max(this.stayDur, this.t + stay);
    return { state: this.state, spot: this.spot, t: this.t };
  }
  dispose() {
    this.ctx.scene.remove(this.obj);
    this.geo.dispose(); this.mat.dispose(); this.normalMap.dispose();
  }
}

export { buildDolphinGeometry };
