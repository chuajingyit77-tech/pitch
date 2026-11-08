// 雨林 · 金刚鹦鹉 — the rainforest's guardian: a scarlet macaw (about 85 cm, half of it tail) that now and then flies in
// to one of the low branches over the pool, folds its wings, looks about and preens; called for a lesson
// (lib/guide.js), it comes now and stays, turned to whoever talks with it: its beak works while it speaks, it bobs its
// head at a right answer, shakes it at a wrong one and, when a lesson is learnt, spreads its wings wide.
//
// One skinned mesh (one draw call) built from parametric parts: a lofted body (vent, breast, the short neck and the big
// round head), the hooked upper mandible and the deep lower one (with the tongue inside), the eyes, the folded wings
// lying over the flanks, the long graduated tail, the flight wings (opened only to fly or to display: folded, they
// shrink into the shoulders and the folded wings show) and the legs, whose toes (two forward, two back) grip the
// branch. It is painted into one atlas (the scarlet plumage, the bare white face with its rows of tiny red feathers,
// the yellow band and blue flight feathers of the wing, the blue-tipped tail, the ivory and black beak, the pale eye)
// over a matching feather relief. The rig is flat and posed every frame from functions of time and exact springs, so it
// moves the same at any frame rate.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, makeRng, makeCanvas, createNoise, normalMapFromHeight, patchMaterial } from '../../lib/util.js';
import { V, finite, spow, envl, range, blend2, table, Spring, Geo, bladeSurface, makeRuv, makeFlatSkinnedMesh } from '../../lib/rig.js';
import { jungleMaterial } from './shading.js';

/* ------------------------------------------------------------------ */
/* Small helpers                                                        */
/* ------------------------------------------------------------------ */
const X_AXIS = V(1, 0, 0), UP = V(0, 1, 0);

/* ------------------------------------------------------------------ */
/* Body plan (bind pose: perched upright on a branch along its X axis,  */
/* macaw-local: origin at the body's centre, +Z the way it faces, +Y    */
/* up, +X its left). Lengths in metres.                                  */
/* ------------------------------------------------------------------ */
const PERCH_DY = 0.104;      // the top of the perch below the origin: the feet grip there
const PERCH_R = 0.115;       // the radius of the branches it perches on (the toes lie round it)
// the spine from the vent (s = 0) up the breast and the short neck to the crown (s = 1): [s, y, z]
const SPINE = [
  [0.00, -0.112, -0.050], [0.12, -0.086, -0.034], [0.26, -0.048, -0.015], [0.40, -0.002, 0.002],
  [0.52, 0.044, 0.014], [0.62, 0.084, 0.022], [0.71, 0.117, 0.027], [0.80, 0.145, 0.032],
  [0.90, 0.172, 0.037], [1.00, 0.203, 0.040],
];
// the body's sections: [s, back, front (the breast, the face), half width, section exponent (2 = ellipse)]
const BODY = [
  [0.000, 0.012, 0.012, 0.014, 2.0], [0.040, 0.024, 0.026, 0.026, 2.1], [0.100, 0.034, 0.038, 0.036, 2.2],
  [0.180, 0.042, 0.049, 0.049, 2.3], [0.280, 0.047, 0.058, 0.056, 2.4], [0.380, 0.049, 0.062, 0.059, 2.4],
  [0.470, 0.047, 0.061, 0.057, 2.4], [0.560, 0.041, 0.054, 0.050, 2.3], [0.640, 0.035, 0.044, 0.041, 2.2],
  [0.710, 0.033, 0.040, 0.038, 2.2], [0.770, 0.037, 0.045, 0.041, 2.2], [0.830, 0.040, 0.052, 0.042, 2.2],
  [0.860, 0.040, 0.053, 0.042, 2.2], [1.000, 0.040, 0.053, 0.042, 2.2],
];
const S_CAP0 = 0.07, S_CAP1 = 0.86;   // rounded off below (the vent) and above (the crown, a dome over the eyes)
const _sp = V(0, 0, 0);
function spineAt(s, out) { return out.set(0, table(SPINE, s, 1), table(SPINE, s, 2)); }
function tangentAt(s, out) {
  const e = 0.004;
  spineAt(Math.min(1, s + e), out); spineAt(Math.max(0, s - e), _sp);
  return out.sub(_sp).normalize();
}
const _sec = { back: 0, front: 0, w: 0, n: 2 };
function section(s) {
  let k = 1, sr = s;
  if (s < S_CAP0) { sr = S_CAP0; k = Math.sqrt(Math.max(0, 1 - ((S_CAP0 - s) / S_CAP0) ** 2)); }
  else if (s > S_CAP1) { sr = S_CAP1; k = Math.sqrt(Math.max(0, 1 - ((s - S_CAP1) / (1 - S_CAP1)) ** 2)); }
  _sec.back = table(BODY, sr, 1) * k; _sec.front = table(BODY, sr, 2) * k; _sec.w = table(BODY, sr, 3) * k; _sec.n = table(BODY, sr, 4);
  return _sec;
}
const _bp = V(0, 0, 0), _bt = V(0, 0, 0), _bf = V(0, 0, 0);
/** A point of the body: s up the spine, phi round it (0 the back, pi/2 its left, pi the breast, 3pi/2 its right). */
function bodyPoint(s, phi, out) {
  spineAt(s, _bp); tangentAt(s, _bt); _bf.crossVectors(X_AXIS, _bt).normalize();
  const c = section(s), e = 2 / c.n, cs = Math.cos(phi), sn = Math.sin(phi);
  const fb = -cs, r = fb >= 0 ? c.front : c.back;
  return out.copy(_bp).addScaledVector(X_AXIS, c.w * spow(sn, e)).addScaledVector(_bf, r * spow(fb, e));
}
const _bn1 = V(0, 0, 0), _bn2 = V(0, 0, 0), _bn3 = V(0, 0, 0);
/** the body's outward normal at (s, phi) */
function bodyNormal(s, phi, out) {
  const e = 1e-3;
  bodyPoint(Math.min(0.999, s + e), phi, _bn1); bodyPoint(Math.max(0.001, s - e), phi, _bn2); _bn1.sub(_bn2);
  bodyPoint(s, phi + e, _bn2); bodyPoint(s, phi - e, _bn3); _bn2.sub(_bn3);
  return out.crossVectors(_bn1, _bn2).normalize();
}

// the face: the eye on the side of the head, a little forward and up of the widest section
const S_EYE = 0.9, PHI_EYE = Math.PI / 2 + 0.62, EYE_R = 0.0066;
// the beak (in the midplane, [y, z]): the culmen from the cere over the hook to the tip, and the cutting edge from the
// gape (the corner of the mouth) forward and down to the same tip
const CULMEN = [V(0, 0.179, 0.068), V(0, 0.193, 0.101), V(0, 0.166, 0.132), V(0, 0.102, 0.107)];
const TOMIUM = [V(0, 0.141, 0.074), V(0, 0.137, 0.096), V(0, 0.125, 0.108), V(0, 0.102, 0.107)];
// the lower mandible: its cutting edge (inside the upper one when closed) and its keel (the gonys) under the chin
const L_TOP = [V(0, 0.142, 0.070), V(0, 0.138, 0.091), V(0, 0.132, 0.103), V(0, 0.121, 0.106)];
const L_BOT = [V(0, 0.119, 0.068), V(0, 0.105, 0.088), V(0, 0.108, 0.105), V(0, 0.121, 0.106)];
const JAW_PIVOT = V(0, 0.145, 0.065);
function bez(P, t, out) {
  const u = 1 - t;
  return out.set(0, 0, 0).addScaledVector(P[0], u * u * u).addScaledVector(P[1], 3 * u * u * t).addScaledVector(P[2], 3 * u * t * t).addScaledVector(P[3], t * t * t);
}

// the tail: from under the vent, hanging down and a little back (its bones bend it to fly, fan and wag)
const TAIL_BASE = V(0, -0.098, -0.046);
const TAIL_DIR = V(0, -0.94, -0.33).normalize();
const TAIL_LEN = 0.46;
const TAIL = [ // [t along, half width, half thickness]
  [0.0, 0.026, 0.007], [0.08, 0.031, 0.006], [0.3, 0.029, 0.005], [0.55, 0.024, 0.004], [0.78, 0.017, 0.003],
  [0.92, 0.010, 0.0022], [1.0, 0.0, 0.0012],
];

// the folded wing (each side): u from the shoulder (0) down the flank (body s from 0.60 to 0.06 by u = 0.62) and on
// as the crossed tips of the flight feathers over the tail (to u = 1); v across, from its upper edge (by the back)
// to its lower edge (on the flank). [u, centre angle round the body from the back, half width, thickness]
const CLOAK = [
  [0.0, 1.32, 0.0, 0.0], [0.03, 1.32, 0.026, 0.008], [0.1, 1.27, 0.040, 0.014], [0.25, 1.14, 0.045, 0.013],
  [0.45, 0.96, 0.039, 0.010], [0.62, 0.7, 0.029, 0.009], [0.8, 0.52, 0.018, 0.007], [0.93, 0.46, 0.009, 0.004],
  [1.0, 0.43, 0.0, 0.002],
];
const CLOAK_U_BODY = 0.62, CLOAK_S0 = 0.60, CLOAK_S1 = 0.06, CLOAK_BLADE = 0.105;

// the flight wings, spread out to each side in the bind pose (the leading edge up, the upper surface facing back):
// span x from the shoulder; the leading and trailing edges as heights above/below the shoulder line
const SHOULDER = V(0.044, 0.070, -0.014);
const ELBOW_X = 0.15, WRIST_X = 0.27, TIP_X = 0.53;
const WING = [ // [x, leading edge (+y), trailing edge (-y), sweep back (z)]
  [0.044, 0.020, 0.150, 0.0], [0.10, 0.026, 0.156, -0.004], [0.16, 0.031, 0.153, -0.008], [0.27, 0.035, 0.142, -0.014],
  [0.36, 0.028, 0.122, -0.024], [0.44, 0.018, 0.088, -0.036], [0.50, 0.008, 0.046, -0.046], [0.53, 0.0, 0.0, -0.052],
];

// the legs: the tarsus from the belly feathers to the foot; the toes curl round the branch (two forward, two back)
const HIP = [V(0.021, -0.072, 0.014), V(-0.021, -0.072, 0.014)];
const FOOT = [V(0.022, -0.097, 0.012), V(-0.022, -0.097, 0.012)];

/* ------------------------------------------------------------------ */
/* Skeleton (flat: every bone a child of the mesh, posed in its frame)   */
/* ------------------------------------------------------------------ */
const B = { ROOT: 0, NECK: 1, HEAD: 2, JAW: 3, TAIL0: 4, TAIL1: 5, TAIL2: 6, CLOAK: [7, 8], HUM: [9, 10], FORE: [11, 12], HAND: [13, 14], LEG: [15, 16], FOOT: [17, 18] };
const BONE_COUNT = 19;
const BIND = [];
{
  const b = (i, p) => { BIND[i] = p.clone(); };
  b(B.ROOT, V(0, 0, 0));
  b(B.NECK, spineAt(0.6, V(0, 0, 0)));
  b(B.HEAD, spineAt(0.8, V(0, 0, 0)));
  b(B.JAW, JAW_PIVOT);
  b(B.TAIL0, TAIL_BASE);
  b(B.TAIL1, TAIL_BASE.clone().addScaledVector(TAIL_DIR, TAIL_LEN * 0.3));
  b(B.TAIL2, TAIL_BASE.clone().addScaledVector(TAIL_DIR, TAIL_LEN * 0.62));
  for (let si = 0; si < 2; si++) {
    const sx = si === 0 ? 1 : -1;
    b(B.CLOAK[si], V(sx * 0.036, 0.074, -0.02));
    b(B.HUM[si], V(sx * SHOULDER.x, SHOULDER.y, SHOULDER.z));
    b(B.FORE[si], V(sx * ELBOW_X, SHOULDER.y, SHOULDER.z - 0.008));
    b(B.HAND[si], V(sx * WRIST_X, SHOULDER.y, SHOULDER.z - 0.014));
    b(B.LEG[si], HIP[si]);
    b(B.FOOT[si], FOOT[si]);
  }
}

/* ------------------------------------------------------------------ */
/* Atlas regions [u0, v0, u1, v1] (v from the bottom)                    */
/* ------------------------------------------------------------------ */
const ATLAS_W = 1024, ATLAS_H = 512;
const R = {
  body: [0.0, 0.5, 0.625, 1.0],       // a: up the body (the head given more room), b: round it
  cloak: [0.625, 0.5, 1.0, 0.75],     // a: along the folded wing, b: across it
  tailTop: [0.625, 0.75, 1.0, 0.875], // a: along the tail, b: across
  tailBot: [0.625, 0.875, 1.0, 1.0],
  wingTop: [0.0, 0.25, 0.5, 0.5],     // a: span, b: chord (leading -> trailing)
  wingBot: [0.5, 0.25, 1.0, 0.5],
  beak: [0.0, 0.0, 0.125, 0.25],      // a: base -> tip, b: round the section
  jaw: [0.125, 0.0, 0.25, 0.25],
  mouth: [0.25, 0.0, 0.3125, 0.125],
  eye: [0.25, 0.125, 0.3125, 0.25],
  feet: [0.3125, 0.0, 0.5, 0.25],
};
const INSET = 2.5; // pixels kept clear of each region's border (mipmaps bleed less)
const ruv = makeRuv(ATLAS_W, ATLAS_H, INSET);
/** up the body -> atlas (the head, s > 0.7, takes half the region) */
const bodyA = s => s < 0.7 ? s / 0.7 * 0.5 : 0.5 + (s - 0.7) / 0.3 * 0.5;
const bodyS = a => a < 0.5 ? a * 2 * 0.7 : 0.7 + (a - 0.5) * 2 * 0.3;

/* ------------------------------------------------------------------ */
/* Geometry                                                             */
/* ------------------------------------------------------------------ */

function buildMacawGeometry(q = 1) {
  const G = new Geo();
  const d = q >= 0.6 ? 1 : 0.7;               // density
  const N = x => Math.max(5, Math.round(x * d));
  const _p = V(0, 0, 0), _n = V(0, 0, 0), _t = V(0, 0, 0);

  // ---- the body: vent, breast, neck and head in one loft ----
  {
    // denser over the head (the close-ups look at it) and toward the crown
    const us = [];
    for (let i = 0; i <= N(16); i++) us.push(0.72 * i / N(16));
    for (let i = 1; i <= N(20); i++) us.push(0.72 + 0.28 * Math.sin((i / N(20)) * Math.PI / 2));
    const vs = range(0, TAU, N(40));
    G.surf(us, vs, (s, phi, out) => bodyPoint(clamp(s, 0, 1), phi, out), (s, phi) => {
      // the neck bends (root -> neck -> head) and the throat and nape follow the head
      const bones = s < 0.66 ? blend2(s, 0.46, 0.66, B.ROOT, B.NECK) : blend2(s, 0.72, 0.84, B.NECK, B.HEAD);
      return { uv: ruv(R.body, bodyA(s), ((phi / TAU) % 1 + 1) % 1), bones, rough: 0.56 };
    }, { pole: (s, phi, out) => tangentAt(s, out).multiplyScalar(s > 0.5 ? 1 : -1) });
  }

  // ---- the upper mandible: a closed section between the culmen and the cutting edge, closing to the tip ----
  {
    const top = V(0, 0, 0), bot = V(0, 0, 0), upd = V(0, 0, 0);
    const W = u => 0.021 * Math.pow(1 - u, 0.62) * (1 - 0.25 * u);
    const sec = (u, v, out) => {
      bez(CULMEN, u, top); bez(TOMIUM, u, bot);
      upd.subVectors(top, bot); const H = upd.length(); if (H > 1e-6) upd.divideScalar(H); else upd.set(0, 1, 0);
      const w = W(u);
      if (v < 0.78) {
        // the outer face: from the left cutting edge up over the culmen and down to the right one (boxy sides, a
        // rounded ridge)
        const a = v / 0.78 * Math.PI;
        const x = w * spow(Math.cos(a), 0.55), y = H * Math.pow(Math.sin(a), 0.7);
        return out.copy(bot).addScaledVector(X_AXIS, x).addScaledVector(upd, y);
      }
      // the palate: back from the right edge to the left one, arched up inside
      const b = (v - 0.78) / 0.22, x = w * (-1 + 2 * b);
      return out.copy(bot).addScaledVector(X_AXIS, x).addScaledVector(upd, H * 0.42 * (1 - (2 * b - 1) ** 2));
    };
    const us = range(0, 1, N(18), t => 1 - Math.pow(1 - t, 1.3)); // a little denser toward the hook
    const vs = range(0, 1, N(28));
    G.surf(us, vs, sec, (u, v) => ({ uv: ruv(R.beak, u, v), bones: [[B.HEAD, 1]], rough: v < 0.78 ? 0.34 : 0.6, thin: u > 0.88 ? 0.0012 : 0 }),
      { flip: true, pole: (u, v, out) => { bez(CULMEN, 0.995, out); bez(CULMEN, 1, _t); return out.subVectors(_t, out).normalize(); } });
  }

  // ---- the lower mandible: a deep, rounded scoop under the upper one; its front closes to a point inside the hook ----
  {
    const top = V(0, 0, 0), bot = V(0, 0, 0), upd = V(0, 0, 0);
    const W = u => 0.0195 * Math.pow(1 - u, 0.45) * (1 - 0.3 * u);
    const sec = (u, v, out) => {
      bez(L_TOP, u, top); bez(L_BOT, u, bot);
      upd.subVectors(top, bot); const H = upd.length(); if (H > 1e-6) upd.divideScalar(H); else upd.set(0, 1, 0);
      const w = W(u);
      if (v < 0.74) {
        // outside: up the left side, round under the keel, up the right side (v from the left edge)
        const a = v / 0.74 * Math.PI;
        const x = w * spow(Math.cos(a), 0.7), y = H * (1 - Math.pow(Math.sin(a), 0.75));
        return out.copy(bot).addScaledVector(X_AXIS, x).addScaledVector(upd, y);
      }
      // inside (the floor of the mouth, under the tongue): back from the right edge to the left, a little below the rim
      const b = (v - 0.74) / 0.26, x = w * (-1 + 2 * b);
      return out.copy(top).addScaledVector(X_AXIS, x * 0.96).addScaledVector(upd, -H * 0.45 * (1 - (2 * b - 1) ** 2));
    };
    G.surf(range(0, 1, N(12)), range(0, 1, N(24)), sec, (u, v) => ({ uv: ruv(R.jaw, u, v), bones: [[B.JAW, 1]], rough: v < 0.74 ? 0.4 : 0.7 }),
      { pole: (u, v, out) => out.set(0, 0.2, 1).normalize() });
  }

  // ---- the tongue: a thick, rounded tongue lying in the lower mandible ----
  {
    const c = V(0, 0.127, 0.084), r = V(0.0095, 0.0055, 0.0125);
    G.surf(range(0, Math.PI, N(8)), range(0, TAU, N(12)), (th, ph, out) => out.set(c.x + r.x * Math.sin(th) * Math.cos(ph), c.y + r.y * Math.sin(th) * Math.sin(ph), c.z + r.z * Math.cos(th)),
      (th, ph) => ({ uv: ruv(R.mouth, th / Math.PI, ((ph / TAU) % 1 + 1) % 1), bones: [[B.JAW, 1]], rough: 0.45 }),
      { pole: (th, ph, out) => out.set(0, 0, th < 1 ? 1 : -1) });
  }

  // ---- the eyes: small glossy spheres set into the bare face ----
  for (const side of [1, -1]) {
    const phi = side > 0 ? PHI_EYE : TAU - PHI_EYE;
    const c = bodyPoint(S_EYE, phi, V(0, 0, 0)), nrm = bodyNormal(S_EYE, phi, V(0, 0, 0));
    c.addScaledVector(nrm, -EYE_R * 0.5);
    // a frame round the eye's axis (its normal)
    const ax = nrm.clone(), up = V(0, 1, 0).addScaledVector(ax, -ax.y).normalize(), rt = V(0, 0, 0).crossVectors(up, ax);
    G.surf(range(0, Math.PI, N(10)), range(0, TAU, N(16)), (th, ph, out) => out.copy(c)
      .addScaledVector(ax, EYE_R * Math.cos(th)).addScaledVector(up, EYE_R * Math.sin(th) * Math.sin(ph)).addScaledVector(rt, EYE_R * Math.sin(th) * Math.cos(ph)),
      (th, ph) => { const r = Math.min(1, th / (Math.PI * 0.42)); return { uv: ruv(R.eye, 0.5 + 0.5 * r * Math.cos(ph), 0.5 + 0.5 * r * Math.sin(ph)), bones: [[B.HEAD, 1]], rough: 0.14 }; },
      { pole: (th, ph, out) => out.copy(ax).multiplyScalar(th < 1 ? 1 : -1) });
  }

  // ---- the folded wings: over each flank from the shoulder, the crossed flight-feather tips over the tail ----
  for (let si = 0; si < 2; si++) {
    const sx = si === 0 ? 1 : -1;
    const K = V(0, 0, 0), Nn = V(0, 0, 0), Ac = V(0, 0, 0), T0 = V(0, 0, 0), K0 = V(0, 0, 0), N0 = V(0, 0, 0), A0 = V(0, 0, 0);
    // the frame of the folded wing at u: its centre line on the body, the body's normal, the direction across (round
    // the body, from the upper edge toward the lower) and the body's radius there (so the wing wraps round it)
    const frame = u => {
      const uu = Math.min(u, CLOAK_U_BODY);
      const s = lerp(CLOAK_S0, CLOAK_S1, uu / CLOAK_U_BODY);
      const ang = table(CLOAK, uu, 1), phi = sx > 0 ? ang : TAU - ang;
      bodyPoint(s, phi, K); bodyNormal(s, phi, Nn);
      bodyPoint(s, phi + 0.01 * sx, Ac); Ac.sub(K);
      const rad = Ac.length() / 0.01; Ac.normalize();
      let R0 = rad;
      if (u > CLOAK_U_BODY) {
        // on past the body: straight on down the tail's way, flattening, drawn in toward the middle
        const k = (u - CLOAK_U_BODY) / (1 - CLOAK_U_BODY);
        bodyPoint(lerp(CLOAK_S0, CLOAK_S1, (CLOAK_U_BODY - 0.02) / CLOAK_U_BODY), phi, T0); T0.subVectors(K, T0).normalize();
        T0.lerp(TAIL_DIR, 0.5).normalize();
        K.addScaledVector(T0, CLOAK_BLADE * k).addScaledVector(X_AXIS, -sx * 0.014 * k);
        R0 = lerp(rad, rad * 4, k);
      }
      return R0;
    };
    const F = (u, v, out) => {
      const R0 = frame(clamp(u, 0, 1));
      const hw = table(CLOAK, clamp(u, 0, 1), 2), th = table(CLOAK, clamp(u, 0, 1), 3);
      // across from the upper edge (v = 0) to the lower edge (v = 0.5) over the outside, back under it
      const w = clamp(v, 0, 1), outside = w < 0.5, c = outside ? w * 2 : (1 - w) * 2;
      const x = (c * 2 - 1) * hw;
      // the wing's outer face stands off the body by its thickness (most at the coverts, a rounded edge), its inner
      // face lies on it; both curve round the body
      const bulge = Math.sqrt(Math.max(0, 1 - (c * 2 - 1) ** 2));
      const off = (outside ? th * (0.35 + 0.65 * bulge) : -th * 0.15 * bulge) - x * x / (2 * Math.max(R0, 0.02)) + 0.0012;
      return out.copy(K).addScaledVector(Ac, x).addScaledVector(Nn, off);
    };
    G.surf(range(0, 1, N(34), t => t * (0.85 + 0.15 * t)), range(0, 1, N(16)), F, (u, v) => {
      const outside = v < 0.5;
      return { uv: ruv(R.cloak, u, outside ? v * 2 : 1 - (v - 0.5) * 2 * 0.15), bones: [[B.CLOAK[si], 1]], rough: 0.7, thin: u > 0.9 ? 0.0015 : 0 };
    }, { flip: sx < 0, pole: (u, v, out) => out.copy(Nn) });
  }

  // ---- the tail: a long blade, a little keeled, hanging from under the vent ----
  {
    const side = V(0, 0, 0).crossVectors(X_AXIS, TAIL_DIR).normalize(); // its upper (dorsal) side, facing back
    const edges = (v, a, b, n) => {
      const hw = table(TAIL, v, 1), c = TAIL_BASE.clone().addScaledVector(TAIL_DIR, v * TAIL_LEN);
      a.copy(c).addScaledVector(X_AXIS, hw); b.copy(c).addScaledVector(X_AXIS, -hw); n.copy(side);
    };
    const thick = (v, c) => table(TAIL, v, 2) * (0.35 + 0.65 * Math.sqrt(Math.max(0, 1 - (2 * c - 1) ** 2))) + 0.004 * (1 - (2 * c - 1) ** 2) * (1 - v);
    const tailBones = v => {
      const t = v * TAIL_LEN;
      if (t < TAIL_LEN * 0.3) return blend2(t, TAIL_LEN * 0.18, TAIL_LEN * 0.36, B.TAIL0, B.TAIL1);
      return blend2(t, TAIL_LEN * 0.5, TAIL_LEN * 0.7, B.TAIL1, B.TAIL2);
    };
    G.surf(range(0, 1, N(14)), range(0, 1, N(26)), bladeSurface(edges, thick), (u, v) => {
      const top = u < 0.5, c = top ? u * 2 : (1 - u) * 2;
      return { uv: ruv(top ? R.tailTop : R.tailBot, v, c), bones: tailBones(v), rough: 0.68, thin: v > 0.85 ? 0.0012 : 0 };
    }, { flip: true, pole: (u, v, out) => out.copy(TAIL_DIR) });
  }

  // ---- the flight wings (spread in the bind pose; folded, their bones shrink them into the shoulders) ----
  for (let si = 0; si < 2; si++) {
    const sx = si === 0 ? 1 : -1;
    const edges = (v, a, b, n) => {
      const x = lerp(SHOULDER.x, TIP_X, v);
      const le = table(WING, x, 1), zb = table(WING, x, 3);
      const hand = smoothstep(WRIST_X - 0.01, WRIST_X + 0.05, x), P = lerp(0.026, 0.03, hand);
      const g = Math.abs(Math.sin(Math.PI * (x - SHOULDER.x) / P));
      const fingers = smoothstep(0.38, 0.47, x);
      const te = table(WING, x, 2) - lerp(lerp(0.004, 0.009, hand), 0.036, fingers) * (1 - Math.pow(g, lerp(1.1, 0.75, fingers))) * smoothstep(0.06, 0.1, x);
      a.set(sx * x, SHOULDER.y + le, SHOULDER.z + zb); b.set(sx * x, SHOULDER.y - te, SHOULDER.z + zb - 0.006);
      n.set(0, 0, -1); // the upper surface faces back
    };
    const thick = (v, c) => (0.0075 * (1 - v) + 0.0016) * Math.pow(Math.max(0, 1 - c), 1.6) * Math.sqrt(Math.max(c, 0.0001) * 4 + 0.15) + 0.0006;
    const wingBones = v => {
      const x = lerp(SHOULDER.x, TIP_X, v);
      if (x < ELBOW_X + 0.02) return blend2(x, ELBOW_X - 0.02, ELBOW_X + 0.02, B.HUM[si], B.FORE[si]);
      return blend2(x, WRIST_X - 0.02, WRIST_X + 0.02, B.FORE[si], B.HAND[si]);
    };
    G.surf(range(0, 1, N(14)), range(0, 1, N(100)), bladeSurface(edges, thick), (u, v) => {
      const top = u < 0.5, c = top ? u * 2 : (1 - u) * 2;
      return { uv: ruv(top ? R.wingTop : R.wingBot, v, c), bones: wingBones(v), rough: 0.7, thin: c > 0.85 || v > 0.92 ? 0.0012 : 0 };
    }, { flip: sx > 0, pole: (u, v, out) => out.set(sx, 0, 0) });
  }

  // ---- legs and feet: the tarsus, and the toes curled round the branch (front pair, back pair) ----
  for (let si = 0; si < 2; si++) {
    const sx = si === 0 ? 1 : -1;
    const tube = (P, rad, meta, n = N(10)) => {
      // a tube along P(t) (t 0..1) with radius rad(t)
      const c = V(0, 0, 0), c2 = V(0, 0, 0), tg = V(0, 0, 0), a = V(0, 0, 0), b = V(0, 0, 0);
      return G.surf(range(0, 1, n), range(0, TAU, N(8)), (t, ph, out) => {
        const tt = clamp(t, 0, 1);
        P(tt, c); P(Math.min(1, tt + 0.01), c2); P(Math.max(0, tt - 0.01), tg); tg.subVectors(c2, tg).normalize();
        a.copy(Math.abs(tg.x) < 0.9 ? X_AXIS : UP).addScaledVector(tg, -(Math.abs(tg.x) < 0.9 ? tg.x : tg.y)).normalize();
        b.crossVectors(tg, a);
        const r = rad(tt);
        return out.copy(c).addScaledVector(a, r * Math.cos(ph)).addScaledVector(b, r * Math.sin(ph));
      }, meta, { pole: (t, ph, out) => { P(Math.min(1, t + 0.01), out); P(Math.max(0, t - 0.01), c); return out.sub(c).normalize().multiplyScalar(t > 0.5 ? 1 : -1); } });
    };
    const hip = HIP[si], foot = FOOT[si];
    tube((t, out) => out.lerpVectors(hip, foot, t), t => lerp(0.0085, 0.0062, t) * (t < 0.08 ? Math.sqrt(t / 0.08) * 0.6 + 0.4 : 1),
      (t, ph) => ({ uv: ruv(R.feet, t * 0.3, ((ph / TAU) % 1 + 1) % 1), bones: [[B.LEG[si], 1]], rough: 0.8 }), N(5));
    // toes: arcs round the branch (centre PERCH_R under its top), each from the foot over the top and down the side
    const cy = -PERCH_DY - PERCH_R, cz = foot.z;
    const toes = [ // [start angle from the top (rad, + forward), sweep (rad: a toe's length on the branch), splay x, scale]
      [0.03, 0.36, 0.005, 1.0], [0.03, 0.33, -0.005, 1.0], [-0.03, -0.31, 0.007, 1.0], [-0.03, -0.26, -0.006, 1.0],
    ];
    toes.forEach(([a0, sweep, splay, ls], ti) => {
      const rr = PERCH_R + 0.0055;
      const P = (t, out) => {
        const a = a0 + sweep * ls * t;
        return out.set(foot.x + sx * splay * (0.4 + t), cy + rr * Math.cos(a), cz + rr * Math.sin(a));
      };
      tube(P, t => 0.0052 * (1 - 0.55 * t) * (t > 0.86 ? Math.sqrt(Math.max(0, (1 - t) / 0.14)) * 0.8 + 0.2 : 1),
        (t, ph) => ({ uv: ruv(R.feet, 0.32 + t * 0.66, ((ph / TAU) % 1 + 1) % 1 * 0.5 + (ti % 2) * 0.5), bones: [[B.FOOT[si], 1]], rough: t > 0.82 ? 0.4 : 0.78, thin: t > 0.8 ? 0.001 : 0 }), N(9));
    });
  }

  return G.build();
}

/* ------------------------------------------------------------------ */
/* Painted atlas + feather relief                                       */
/* ------------------------------------------------------------------ */
const hex = h => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const C = {
  red: hex('#d3221f'), redD: hex('#a3171a'), redL: hex('#e8462a'), orange: hex('#e2551d'),
  yellow: hex('#f3c21b'), yellowL: hex('#fadd52'), green: hex('#3f9440'), greenD: hex('#2a6b33'),
  blue: hex('#1f5bb6'), blueD: hex('#173f8c'), blueL: hex('#3f86d4'), sky: hex('#5aa6e0'),
  skin: hex('#e2d7ce'), skinS: hex('#d2bdb4'), olive: hex('#7a6a2a'), oliveD: hex('#4e4520'),
  ivory: hex('#ddd1bc'), horn: hex('#bcab8c'), beakD: hex('#2b2725'), black: hex('#141212'),
  iris: hex('#efd77c'), irisD: hex('#a8893c'), mouth: hex('#4a3a3b'), tongue: hex('#3b3437'),
  foot: hex('#6f6865'), footD: hex('#4b4542'), claw: hex('#252221'),
};
const hash1 = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** soft feather rows: { f (0..1 along a feather, 1 at its free edge), fb (across), id } */
function featherRows(a, b, rows, cols, curvature) {
  const ra = a * rows, ri = Math.floor(ra);
  const cb = b * cols + (ri & 1 ? 0.5 : 0), ci = Math.floor(cb), fb = cb - ci;
  const u2 = ra + curvature * (fb - 0.5) * (fb - 0.5);
  return { f: u2 - Math.floor(u2), fb, id: Math.floor(u2) * 131 + ci * 17 };
}
/**
 * Overlapping feathers (the body's plumage, the coverts): each one a soft, rounded tip lying over the base of the
 * feather behind it, jittered in place, width and length, so no two are alike and no row lines up into a stripe.
 * y runs along the feathers toward their tips (in rows), x across them (in columns, wrapping at `wrap` when given).
 * The feather showing at (y, x): { t: rows back from its tip, q: 0 on its axis .. 1 at its outline, dx: across it
 * (-1..1), h: its own random 0..1, shade: 0..1, how close the tip lying over it is (a soft contact shadow) }.
 */
function plumage(y, x, wrap = 0, seed = 0) {
  const r0 = Math.floor(y);
  let near = 9;
  for (let r = r0 - 1; r <= r0 + 1; r++) { // the rows nearer the base first: their feathers lie on top
    const off = r & 1 ? 0.5 : 0, c0 = Math.floor(x - off);
    let best = null;
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      const k = r * 1013 + (wrap ? ((c % wrap) + wrap) % wrap : c) * 37 + seed * 7919;
      const h2 = hash1(k + 0.31), t = r + 1 + (h2 - 0.5) * 0.34 - y;
      if (t > 2.4 || t < -1.5) continue;
      const h1 = hash1(k), h3 = hash1(k + 0.67);
      const w = 0.6 + 0.14 * h3, rt = 0.45 + 0.25 * h1; // half-width; how far back its rounded tip reaches
      const dx = (x - (c + off + 0.5 + (h1 - 0.5) * 0.3)) / w, dy = t < rt ? (rt - t) / rt : 0;
      const q = dx * dx + dy * dy;
      if (q <= 1) { if (!best || q < best.q) best = { t, q, dx, h: h3, shade: 0 }; }
      else if (q < near) near = q;
    }
    if (best) { best.shade = 1 - smoothstep(1.0, 1.8, near); return best; }
  }
  return { t: 1, q: 0, dx: 0, h: 0.5, shade: 0 };
}
/** a feather from plumage() as colour and relief: { tip (1 at its tip, 0 where it comes out from under the one over
 *  it), dome (across it), barb (its fine barbs, -1..1) } */
function featherLook(P, len = 1.25) {
  const tip = clamp(1 - P.t / len, 0, 1), dome = Math.sqrt(Math.max(0, 1 - P.q));
  return { tip, dome, barb: Math.sin((P.t + 0.42 * Math.abs(P.dx)) * 3.4 * TAU) * dome };
}
/** the flight feathers' own coordinates along a wing's span, as the trailing edge's notches lay them out: k (which
 *  feather), fq (0..1 across it: 0 and 1 its edges, the notch between two feathers), P (its width) */
function remexAt(x) {
  const hand = smoothstep(WRIST_X - 0.01, WRIST_X + 0.05, x), P = lerp(0.026, 0.03, hand);
  const ph = (x - SHOULDER.x) / P;
  return { k: Math.floor(ph), fq: ph - Math.floor(ph), P };
}

const PAINT = {
  // a: up the body (bodyS(a) = s), b: round it (0 the back, 0.25 its left, 0.5 the breast, 0.75 its right)
  body(a, b, n1, n2) {
    const s = bodyS(a), phi = b * TAU;
    const fb = -Math.cos(phi), side = Math.abs(Math.sin(phi));
    // the head: small, close feathers in soft rows; the body: larger ones, each lying over the base of the next, the
    // feathers of the breast and belly the largest
    const head = a >= 0.5, aa = head ? (1 - a) / 0.5 : (0.5 - a) / 0.5;
    let c, ht;
    if (head) {
      const f = featherRows(aa + n2 * 0.45 / 26, b + n1 * 0.3 / 64, 26, 64, 0.8);
      const size = 0.85 + 0.3 * hash1(f.id * 7 + 3), edge = smoothstep(0.86, 0.995, f.f) * 0.6;
      c = mix3(mix3(C.redD, C.red, 0.55 + 0.45 * smoothstep(0.0, 0.8, f.f)), C.redL, 0.12 + 0.15 * n1 + 0.1 * Math.pow(f.f, 3) * size);
      c = mul3(c, 1 - 0.09 * edge + 0.06 * (hash1(f.id) - 0.5));
      ht = 0.45 + 0.14 * Math.pow(f.f, 1.3) * size - 0.1 * edge;
    } else {
      // (the warp fades out at the seam down the back, so the feathers meet there)
      const seam = smoothstep(0, 0.04, b) * (1 - smoothstep(0.96, 1, b));
      const P = plumage(aa * 24 + n2 * 0.12 * seam, b * 26 + n2 * 0.1 * seam, 26, 1), L = featherLook(P);
      c = mix3(C.redD, C.red, 0.55 + 0.45 * smoothstep(0.0, 0.85, L.tip));
      c = mix3(c, C.redL, 0.08 + 0.12 * n1 + 0.16 * L.tip * L.tip * L.dome);
      c = mul3(c, 1 - 0.1 * P.shade - 0.03 * smoothstep(0.88, 1, P.q) + 0.05 * (P.h - 0.5) + 0.02 * L.barb);
      ht = 0.45 + 0.11 * Math.pow(L.tip, 1.2) + 0.07 * L.dome - 0.04 * P.shade + 0.01 * L.barb;
    }
    c = mix3(c, C.orange, smoothstep(0.55, 0.75, s) * 0.12 * (1 - Math.abs(fb)));
    // the lower back and rump (under the folded wings) blue; the vent's feathers a deeper red
    const rump = (1 - smoothstep(0.18, 0.42, s)) * smoothstep(0.35, 0.95, -fb);
    c = mix3(c, C.sky, rump * 0.9);
    c = mix3(c, C.redD, (1 - smoothstep(0.02, 0.14, s)) * 0.6);
    // the bare face: white skin from the beak back under and round the eye, with lines of tiny red feathers
    if (s > 0.78) {
      const sideAng = Math.abs(Math.PI - phi);                 // 0 at the front of the face
      const fx = (sideAng - 0.25) / 1.0, fy = (s - 0.795) / 0.13;
      const ov = ((fx - 0.46) / 0.6) ** 2 + ((fy - 0.56 + 0.08 * fx) / 0.44) ** 2;
      const inside = (1 - smoothstep(0.82, 1.0, ov)) * smoothstep(0.0, 0.05, fx);
      if (inside > 0) {
        const wr = Math.sin(fy * 70 + fx * 9 + n1 * 3) * 0.5 + 0.5;
        let sk = mul3(mix3(C.skin, C.skinS, 0.35 + 0.35 * n1), 0.97 + 0.04 * wr);
        // three or four lines of tiny feathers below the eye, following the face's curve
        const row = fy * 6.5 + fx * 0.9, line = Math.abs((row % 1 + 1) % 1 - 0.5);
        const along = Math.abs(((fx * 34 + Math.floor(row) * 0.37) % 1 + 1) % 1 - 0.5);
        const dots = (1 - smoothstep(0.08, 0.16, line)) * (1 - smoothstep(0.16, 0.3, along)) * (1 - smoothstep(0.36, 0.5, fy)) * smoothstep(0.3, 0.42, fx) * (1 - smoothstep(0.85, 0.95, fx));
        sk = mix3(sk, mix3(C.redD, C.skinS, 0.35), clamp(dots, 0, 1) * 0.55);
        c = mix3(c, sk, inside);
        ht = lerp(ht, 0.5 + 0.03 * n1 + 0.02 * wr + 0.08 * clamp(dots, 0, 1), inside);
      }
    }
    return [c, ht];
  },
  // a: along the folded wing (shoulder -> tips), b: across (upper edge 0 -> lower edge 1)
  cloak(a, b, n1) {
    let c, ht = 0.5;
    if (a < 0.17) {
      // lesser coverts: small scarlet feathers
      const P = plumage(a / 0.17 * 6 + n1 * 0.3, b * 8, 0, 2), L = featherLook(P);
      c = mix3(mix3(C.redD, C.red, 0.5 + 0.5 * L.tip), C.redL, 0.12 + 0.2 * n1 + 0.15 * L.tip * L.dome);
      c = mul3(c, 1 - 0.16 * P.shade + 0.07 * (P.h - 0.5) + 0.025 * L.barb);
      ht = 0.43 + 0.15 * Math.pow(L.tip, 1.2) + 0.07 * L.dome - 0.05 * P.shade + 0.012 * L.barb;
    } else if (a < 0.33) {
      // the yellow band (median and greater coverts), each feather tipped green
      const P = plumage((a - 0.17) / 0.16 * 3 + n1 * 0.2, b * 6, 0, 3), L = featherLook(P, 1.4);
      c = mix3(C.yellow, C.yellowL, 0.25 + 0.3 * n1 + 0.2 * L.dome);
      c = mix3(c, mix3(C.greenD, C.green, 0.4 + 0.6 * L.dome), smoothstep(0.5, 0.85, L.tip) * 0.85);
      c = mix3(c, C.red, (1 - smoothstep(0.17, 0.2, a)) * 0.6);
      c = mul3(c, 1 - 0.18 * P.shade + 0.06 * (P.h - 0.5) + 0.03 * L.barb);
      ht = 0.43 + 0.16 * Math.pow(L.tip, 1.2) + 0.07 * L.dome - 0.05 * P.shade + 0.012 * L.barb;
    } else {
      // the flight feathers: long blue vanes lying along the wing, each with its shaft, darker toward the tips
      const k = (a - 0.33) / 0.67, q = b * 7 + k * 0.6, fq = q - Math.floor(q), id = Math.floor(q);
      const rach = 1 - smoothstep(0.0, 0.05, Math.abs(fq - 0.3));
      const gap = smoothstep(0.9, 1.0, fq);
      c = mix3(C.blue, C.blueD, smoothstep(0.2, 0.9, k) * 0.7 + 0.1 * hash1(id));
      c = mix3(c, C.green, (1 - smoothstep(0.0, 0.12, k)) * 0.5);
      c = mul3(c, 0.96 + 0.12 * rach - 0.16 * gap + 0.04 * n1);
      ht = 0.5 + 0.18 * rach - 0.25 * gap;
    }
    return [c, ht];
  },
  // a: along the tail, b: across (an edge, the middle at 0.5, the other edge)
  tailTop(a, b, n1) {
    const mid = 1 - Math.abs(b * 2 - 1);
    // the central feathers red, the outer ones blue; the tips blue all across
    const blue = Math.max(smoothstep(0.55, 0.85, a), 1 - smoothstep(0.25, 0.55, mid));
    let c = mix3(mix3(C.red, C.redL, 0.2 + 0.2 * n1), mix3(C.blue, C.blueL, 0.3), blue);
    const q = b * 9, fq = q - Math.floor(q);
    const rach = 1 - smoothstep(0.0, 0.05, Math.abs(fq - 0.5));
    const vane = Math.sin((a * 160 + b * 6) * 1.0) * 0.5 + 0.5;
    c = mul3(c, 0.95 + 0.1 * rach + 0.03 * vane + 0.04 * n1);
    return [c, 0.5 + 0.18 * rach + 0.05 * vane];
  },
  tailBot(a, b, n1) {
    // underneath: duller red with an olive-gold sheen toward the tip
    let c = mix3(C.redD, C.olive, smoothstep(0.3, 0.9, a) * 0.7);
    c = mul3(c, 0.95 + 0.06 * n1);
    return [c, 0.5];
  },
  // a: span (root -> tip), b: chord (leading edge 0 -> trailing edge 1)
  wingTop(a, b, n1) {
    const x = lerp(SHOULDER.x, TIP_X, a);
    let c, ht = 0.5;
    const covEnd = lerp(0.42, 0.28, smoothstep(WRIST_X - 0.02, WRIST_X + 0.06, x));
    if (b < covEnd * 0.55) {
      const P = plumage(b / (covEnd * 0.55) * 5 + n1 * 0.25, a * 40, 0, 4), L = featherLook(P);
      c = mix3(mix3(C.redD, C.red, 0.55 + 0.45 * L.tip), C.redL, 0.12 + 0.12 * L.tip * L.dome);
      c = mul3(c, 1 - 0.11 * P.shade + 0.05 * (P.h - 0.5) + 0.02 * L.barb);
      ht = 0.45 + 0.1 * Math.pow(L.tip, 1.2) + 0.05 * L.dome - 0.035 * P.shade + 0.01 * L.barb;
    } else if (b < covEnd) {
      const P = plumage((b - covEnd * 0.55) / (covEnd * 0.45) * 3 + n1 * 0.2, a * 34, 0, 5), L = featherLook(P, 1.4);
      c = mix3(mix3(C.yellow, C.yellowL, 0.25 + 0.2 * L.dome), mix3(C.greenD, C.green, 0.4 + 0.6 * L.dome), smoothstep(0.5, 0.85, L.tip) * 0.85);
      c = mul3(c, 1 - 0.18 * P.shade + 0.06 * (P.h - 0.5) + 0.03 * L.barb);
      ht = 0.43 + 0.16 * Math.pow(L.tip, 1.2) + 0.07 * L.dome - 0.05 * P.shade + 0.012 * L.barb;
    } else {
      // each flight feather with its shaft and fine barbs, lying over the next one out; the tips darker
      const { k, fq } = remexAt(x), kb = (b - covEnd) / (1 - covEnd);
      const rach = 1 - smoothstep(0.0, 0.035, Math.abs(fq - 0.42)), lap = smoothstep(0.8, 1.0, fq), under = 1 - smoothstep(0.0, 0.12, fq);
      const barb = Math.sin((kb * 9 - Math.abs(fq - 0.42) * 2.2) * TAU);
      c = mix3(C.blue, C.blueD, smoothstep(WRIST_X, TIP_X, x) * 0.55 + 0.2 * smoothstep(0.5, 1, kb) + 0.08 * hash1(k * 3.1));
      c = mix3(c, C.blueL, 0.12 * (1 - Math.abs(fq - 0.42) * 2) * (1 - kb));
      c = mul3(c, 0.95 + 0.1 * rach - 0.16 * lap - 0.1 * under + 0.03 * barb + 0.04 * n1);
      ht = 0.5 + 0.12 * rach + 0.1 * (1 - fq) - 0.12 * lap + 0.012 * barb;
    }
    return [c, ht];
  },
  wingBot(a, b, n1) {
    // under the wing: rows of red coverts, then the flight feathers, dull red at their bases and dark olive-gold toward
    // the tips, each with its pale shaft, lying over the next one out (as on the upper side, the notches between them
    // where the trailing edge has its notches)
    const x = lerp(SHOULDER.x, TIP_X, a);
    const covEnd = lerp(0.45, 0.3, smoothstep(WRIST_X - 0.02, WRIST_X + 0.06, x));
    let c, ht;
    if (b < covEnd) {
      const P = plumage(b / covEnd * 5 + n1 * 0.25, a * 38, 0, 6), L = featherLook(P);
      c = mix3(mix3(C.redD, C.red, 0.45 + 0.45 * L.tip), C.redL, 0.08 * L.tip * L.dome);
      // the last row darker where the flight feathers come out from under it
      c = mul3(c, (1 - 0.11 * P.shade + 0.05 * (P.h - 0.5) + 0.02 * L.barb) * (1 - 0.12 * smoothstep(0.75, 1, b / covEnd)));
      ht = 0.45 + 0.1 * Math.pow(L.tip, 1.2) + 0.05 * L.dome - 0.035 * P.shade + 0.01 * L.barb;
    } else {
      const { k, fq } = remexAt(x), kb = (b - covEnd) / (1 - covEnd);
      const rach = 1 - smoothstep(0.0, 0.035, Math.abs(fq - 0.42)), lap = smoothstep(0.8, 1.0, fq), under = 1 - smoothstep(0.0, 0.12, fq);
      const barb = Math.sin((kb * 9 - Math.abs(fq - 0.42) * 2.2) * TAU);
      c = mix3(mix3(C.redD, C.oliveD, 0.35), mix3(C.olive, C.oliveD, 0.35), smoothstep(0.05, 0.75, kb));
      c = mix3(c, mix3(C.olive, C.yellow, 0.25), 0.16 * (1 - Math.abs(fq - 0.42) * 2) * smoothstep(0.2, 0.8, kb)); // the satin sheen
      c = mix3(c, C.skinS, 0.45 * rach);
      c = mul3(c, (0.97 + 0.08 * hash1(k * 5.3) - 0.18 * lap - 0.12 * under + 0.035 * barb + 0.04 * n1) * (1 - 0.18 * smoothstep(0.82, 1, kb)));
      ht = 0.5 + 0.12 * rach + 0.1 * (1 - fq) - 0.12 * lap + 0.012 * barb;
    }
    return [c, ht];
  },
  // a: base -> tip, b: round the section (0..0.78 outside from the left edge over the ridge; the palate beyond)
  beak(a, b, n1) {
    if (b > 0.78) return [mix3(C.mouth, C.beakD, 0.4), 0.5];
    const ang = b / 0.78;                    // 0 left edge, 0.5 the ridge, 1 right edge
    const up = Math.sin(ang * Math.PI);      // 1 on the ridge, 0 at the cutting edges
    // ivory above, the cutting edge and the tip black; a little horn colour at the base
    let c = mix3(C.ivory, C.horn, 0.25 + 0.2 * n1 + 0.25 * (1 - smoothstep(0.0, 0.25, a)));
    // black along the cutting edge, widening into the black patch at the base of each side; the very tip of the hook
    const edgeDark = (1 - smoothstep(0.05, 0.16 + 0.26 * (1 - smoothstep(0.08, 0.55, a)), up));
    const dark = Math.max(edgeDark, smoothstep(0.87, 0.98, a) * (1 - smoothstep(0.35, 0.85, up)));
    c = mix3(c, C.beakD, dark);
    // faint growth lines following the curve of the beak
    const g = Math.sin(up * 40 + a * 6 + n1 * 2) * 0.5 + 0.5;
    c = mul3(c, 0.985 + 0.02 * g);
    return [c, 0.5 + 0.015 * g];
  },
  jaw(a, b, n1) {
    if (b > 0.74) return [C.mouth, 0.5];
    return [mul3(mix3(C.black, C.beakD, 0.5 + 0.3 * n1), 1), 0.5];
  },
  mouth(a, b, n1) { return [mix3(C.tongue, C.mouth, 0.3 + 0.3 * n1), 0.5 + 0.05 * n1]; },
  // the eye seen down its axis: the black pupil, the pale yellow iris, a dark rim
  eye(a, b) {
    const r = Math.hypot(a - 0.5, b - 0.5) * 2;
    let c = r < 0.3 ? C.black : r < 0.74 ? mix3(C.iris, C.irisD, smoothstep(0.3, 0.74, r) * 0.7) : mix3(C.irisD, C.black, smoothstep(0.74, 0.86, r));
    if (r >= 0.3 && r < 0.74) c = mul3(c, 0.9 + 0.1 * Math.sin(Math.atan2(b - 0.5, a - 0.5) * 18));
    return [c, 0.5];
  },
  feet(a, b, n1) {
    // grey, finely scaled; the claws dark
    const claw = a > 0.32 ? smoothstep(0.86, 0.92, (a - 0.32) / 0.66) : 0;
    const sc = Math.sin(a * 140) * Math.sin(b * 60);
    const c = mix3(mul3(mix3(C.foot, C.footD, 0.3 + 0.3 * n1), 0.95 + 0.06 * sc), C.claw, claw);
    return [c, 0.5 + 0.06 * sc * (1 - claw)];
  },
};

function paintMacawAtlas(seed = 7) {
  const W = ATLAS_W, H = ATLAS_H;
  const noise = createNoise(seed);
  const cc = makeCanvas(W, H), hc = makeCanvas(W, H);
  const g = cc.getContext('2d'), gh = hc.getContext('2d');
  const img = g.createImageData(W, H), himg = gh.createImageData(W, H);
  const px = img.data, hp = himg.data;
  const regions = Object.entries(R);
  for (let y = 0; y < H; y++) {
    const v = 1 - (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      let name = null, r = null;
      for (const [k, rr] of regions) if (u >= rr[0] && u < rr[2] && v >= rr[1] && v < rr[3]) { name = k; r = rr; break; }
      let col = C.red, ht = 0.5;
      if (name) {
        const a = clamp((u - r[0]) / (r[2] - r[0]), 0, 1), b = clamp((v - r[1]) / (r[3] - r[1]), 0, 1);
        const n1 = noise.noise2(x * 0.045, y * 0.045) * 0.5 + noise.noise2(x * 0.17, y * 0.17) * 0.25;
        const n2 = noise.noise2(x * 0.07 + 31.7, y * 0.07 - 12.3);
        [col, ht] = PAINT[name](a, b, n1, n2);
      }
      const o = (y * W + x) * 4;
      px[o] = clamp(col[0], 0, 1) * 255; px[o + 1] = clamp(col[1], 0, 1) * 255; px[o + 2] = clamp(col[2], 0, 1) * 255; px[o + 3] = 255;
      const hv = clamp(ht, 0, 1) * 255;
      hp[o] = hp[o + 1] = hp[o + 2] = hv; hp[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0); gh.putImageData(himg, 0, 0);
  const map = new THREE.CanvasTexture(cc);
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const normalMap = normalMapFromHeight(hc, 3.2, false);
  normalMap.anisotropy = 4;
  return { map, normalMap };
}

/* ------------------------------------------------------------------ */
/* Material                                                             */
/* ------------------------------------------------------------------ */
function macawMaterial(tex, U, shared = null) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.85, 0.85),
    vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.7,
  });
  patchMaterial(mat, {
    key: 'macawGuardian',
    uniforms: U,
    vertexHeader: 'attribute float aThin; attribute float aRough; varying float vMRough; uniform float uMPx;',
    fragmentHeader: 'varying float vMRough; uniform vec3 uMRim;',
    vertex: {
      '#include <skinning_vertex>': /* glsl */`$&
        vMRough = aRough;
        // thin parts (claws, the beak's hook, feather tips) keep at least ~1.6 px on screen instead of breaking into
        // crawling slivers at a distance
        if (aThin > 0.0) {
          vec4 mmv = modelViewMatrix * vec4(transformed, 1.0);
          float minR = 0.8 * max(-mmv.z, 0.05) / uMPx;
          transformed += normalize(objectNormal + vec3(1e-6)) * max(minR - aThin, 0.0);
        }`,
    },
    fragment: {
      '#include <roughnessmap_fragment>': '$&\n roughnessFactor = vMRough;',
      // soft rim light from the sky: a feathered silhouette catches the light (never a flat clay look)
      '#include <emissivemap_fragment>': /* glsl */`$&
        { float mr = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += uMRim * diffuseColor.rgb * (mr * mr * mr) * (0.5 + 0.5 * vMRough); }`,
    },
  });
  if (shared) jungleMaterial(mat, shared, { key: 'macawGuardian', glowLight: true });
  return mat;
}

/* ------------------------------------------------------------------ */
/* Flight                                                               */
/* ------------------------------------------------------------------ */
function bezD(P, t, out) {
  const u = 1 - t;
  return out.set(0, 0, 0).addScaledVector(P[0], -3 * u * u).addScaledVector(P[1], 3 * u * u - 6 * u * t)
    .addScaledVector(P[2], 6 * u * t - 3 * t * t).addScaledVector(P[3], 3 * t * t);
}
/** cubic ease from 0 to 1 with start and end slopes s0, s1 (monotonic for slopes in [0, 3]) */
const hermite = (t, s0, s1) => ((s0 + s1 - 2) * t + (3 - 2 * s0 - s1)) * t * t + s0 * t;
const hermiteD = (t, s0, s1) => (3 * (s0 + s1 - 2) * t + 2 * (3 - 2 * s0 - s1)) * t + s0;
/** A flight: a cubic Bezier flown over `dur` seconds, its parameter eased so the speed starts and ends as asked
 *  (a time function: the same path at any frame rate). */
class Flight {
  constructor(P, dur, s0, s1) { this.P = P; this.dur = dur; this.s0 = s0; this.s1 = s1; }
  at(t, pos, vel) {
    const k = clamp(t / this.dur, 0, 1), e = hermite(k, this.s0, this.s1);
    bez(this.P, e, pos);
    if (vel) bezD(this.P, e, vel).multiplyScalar(hermiteD(k, this.s0, this.s1) / this.dur);
    return k;
  }
  static length(P) {
    let L = 0; const a = V(0, 0, 0), b = V(0, 0, 0);
    bez(P, 0, a);
    for (let i = 1; i <= 32; i++) { bez(P, i / 32, b); L += a.distanceTo(b); a.copy(b); }
    return L;
  }
}
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const near = (target, cur) => cur + wrap(target - cur);

/* ------------------------------------------------------------------ */
/* The guardian                                                         */
/* ------------------------------------------------------------------ */
const PITCH_FLY = 1.36;   // how far the body tips forward to fly (rad, from perched upright)
const FLY_SPEED = 5.2;    // m/s cruising in from the canopy
const _a = V(0, 0, 0), _b = V(0, 0, 0), _c = V(0, 0, 0), _d = V(0, 0, 0), _v2 = new THREE.Vector2();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qN = new THREE.Quaternion(), _qH = new THREE.Quaternion();
const _qT = new THREE.Quaternion(), _qL = new THREE.Quaternion(), _qh = new THREE.Quaternion(), _qf = new THREE.Quaternion(), _qw = new THREE.Quaternion();
const _e = new THREE.Euler();
const qX = (q, a) => q.setFromAxisAngle(X_AXIS, a), qY = (q, a) => q.setFromAxisAngle(UP, a), qZ = (q, a) => q.setFromAxisAngle(_Z, a);
const _Z = V(0, 0, 1);

export class MacawGuardian {
  /**
   * ctx: { env, scene, camera, shared (the jungle's shading), perches ([{ pos, axis, rad, tan, taken }]: thin, low
   * branches it can grip), occluders (meshes the close-up camera must see past), rng, daylight() -> 0..1 }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.env = ctx.env;
    this.rng = ctx.rng;
    this.geo = buildMacawGeometry(this.env.q);
    this.tex = paintMacawAtlas((this.env.seed % 997) + 11);
    this.U = { uMPx: { value: 900 }, uMRim: { value: new THREE.Color(0.2, 0.24, 0.22) } };
    this.mat = macawMaterial(this.tex, this.U, ctx.shared);
    const { mesh, bones } = makeMacawMesh(this.geo, this.mat);
    mesh.frustumCulled = false;
    mesh.castShadow = !!this.env.shadows;
    mesh.name = 'macawGuardian';
    this.mesh = mesh; this.bones = bones;
    this.obj = new THREE.Group();
    this.obj.name = 'macaw';
    this.obj.add(mesh);
    this.obj.visible = false;
    ctx.scene.add(this.obj);
    // points it is seen by, in the frames of the bones they move with: the middle of the head, the eye
    this.headPt = V(0, 0.168, 0.044).sub(BIND[B.HEAD]);
    // state
    this.state = 'away';
    this.t = 0;                          // time in this state
    this.time = 0;
    this.wait = this.rng.range(30, 60);  // the first visit: soon after the world opens
    this.perch = null;
    this.face = V(0, 0, 1);              // the way it faces on its branch (out from the branch, toward the camera's side)
    this.flight = null;
    this.pos = V(0, 0, 0); this.vel = V(0, 0, 0);
    this.yawS = new Spring(0); this.tiltS = new Spring(0); this.rollS = new Spring(0);
    this.hYaw = new Spring(0); this.hPitch = new Spring(0); this.hRoll = new Spring(0); this.jaw = new Spring(0);
    this.fold = [new Spring(1), new Spring(1)];    // each wing: 1 folded (the folded wing shows), 0 open
    this.flapA = new Spring(0); this.flapPh = 0; this.flapF = 4.6;
    this.raise = new Spring(0);                    // the wings raised (the display)
    this.stretch = [new Spring(0), new Spring(0)]; // a wing stretched down and back
    this.tailP = new Spring(0); this.tailFan = new Spring(1); this.wag = new Spring(0);
    this.legs = new Spring(0);                     // 0 gripping, 1 tucked up to fly
    this.ruffle = new Spring(0); this.dip = new Spring(0);
    this.summoned = false; this.talking = false; this.speaking = false;
    this.mood = null;                    // { kind, t }: a reaction under way
    this.act = null;                     // { kind, t, dur, ... }: what it is doing on its branch
    this.actWait = 2;
    this.tiltWait = 3; this.tiltTo = 0;
    this.stayDur = 90;
    this.spkPh = 0;
    this.lastYaw = 0;
    this.ff = false;                     // test only: fast-forwarding (no sounds)
    // independent random streams for things on their own clocks (the same choices at 30 and 60 fps)
    this.rngVisit = this.rng.fork('visits'); this.rngAct = this.rng.fork('acts'); this.rngTilt = this.rng.fork('tilt');
    this.pose(0);
  }

  /* ---------- where it comes: a thin, low branch the camera sees, with no resident macaw on it ---------- */
  pickPerch() {
    const cam = this.ctx.camera;
    cam.updateMatrixWorld();
    let best = null, bestS = -Infinity;
    for (const p of this.ctx.perches) {
      if (p.taken && p.taken !== this) continue;
      const sp = _a.copy(p.pos).project(cam);
      const seen = Math.abs(sp.x) < 0.9 && Math.abs(sp.y) < 0.85 && sp.z < 1;
      const sc = (seen ? 4 : 0) - p.pos.distanceTo(cam.position) * 0.2 - Math.abs(sp.x) * 0.6 - Math.abs(sp.y) * 0.4;
      if (sc > bestS) { bestS = sc; best = p; }
    }
    return best;
  }
  /** out from the branch (square to it, level), on the camera's side */
  facingFor(p, out) {
    const cam = this.ctx.camera;
    out.set(-p.tan.z, 0, p.tan.x).normalize();
    if (out.x * (cam.position.x - p.axis.x) + out.z * (cam.position.z - p.axis.z) < 0) out.negate();
    return out;
  }
  /** its centre, standing on a branch facing `face` (the toes lie over the top of the branch) */
  perchRoot(p, face, out) { return out.copy(p.axis).addScaledVector(UP, p.rad + PERCH_DY).addScaledVector(face, -0.012); }
  branchDir(out) { return out.set(this.perch.tan.x, 0, this.perch.tan.z).normalize(); }

  /* ---------- visits ---------- */
  beginVisit() {
    const p = this.pickPerch();
    if (!p) { this.wait = this.t + 20; return; }
    this.perch = p; p.taken = this;
    const face = this.facingFor(p, this.face);
    const end = this.perchRoot(p, face, V(0, 0, 0));
    // out over the pool (toward the branch's tip), high, then gliding round to land facing out
    const along = this.branchDir(V(0, 0, 0));
    const far = this.summoned ? 6.5 : 8.5;
    const start = end.clone().addScaledVector(along, far).addScaledVector(face, -2.2).add(V(0, far * 0.62, 0));
    const P = [start, start.clone().lerp(end, 0.38).add(V(0, 0.9, 0)), end.clone().addScaledVector(face, -2.1).add(V(0, 0.45, 0)), end];
    this.flight = new Flight(P, Flight.length(P) / FLY_SPEED * 1.55, 1.35, 0);
    this.state = 'arrive'; this.t = 0;
    this.obj.visible = true;
    this.flight.at(0, this.pos, this.vel);
    this.yawS.set(Math.atan2(this.vel.x, this.vel.z)); this.lastYaw = this.yawS.x;
    this.tiltS.set(PITCH_FLY); this.rollS.set(0);
    this.legs.set(1); this.fold[0].set(0); this.fold[1].set(0); this.flapA.set(0.9); this.raise.set(0);
    this.tailP.set(0); this.tailFan.set(1); this.dip.set(0);
    this.hYaw.set(0); this.hPitch.set(0); this.hRoll.set(0); this.jaw.set(0);
    this.stayDur = this.rngVisit.range(70, 150);
    this.mood = null; this.act = null;
  }
  /** called while leaving: round again to the same branch, from where it is and the way it is going */
  comeBack() {
    const p = this.perch;
    if (!p || (p.taken && p.taken !== this)) { this.endVisit(); this.beginVisit(); return; }
    p.taken = this;
    const end = this.perchRoot(p, this.facingFor(p, this.face), V(0, 0, 0));
    const p0 = this.pos.clone();
    const P = [p0, null, end.clone().addScaledVector(this.face, -2.3).add(V(0, 0.8, 0)), end];
    const dur = Math.max(2.6, Flight.length([p0, p0, P[2], end]) / FLY_SPEED * 1.7);
    const s0 = 1.2;
    P[1] = p0.clone().addScaledVector(this.vel, dur / (3 * s0));   // leaves at the speed it has
    this.flight = new Flight(P, dur, s0, 0);
    this.state = 'arrive'; this.t = 0;
  }
  land() {
    this.state = 'perch'; this.t = 0;
    this.flight = null;
    this.vel.set(0, 0, 0);
    this.dip.v = -2.2;            // it sinks onto its legs as it lands, and rocks back up
    this.act = null; this.actWait = this.rngAct.range(1.2, 2.5);
  }
  beginLeave() {
    const p = this.perch, face = this.face;
    const start = this.pos.clone(), along = this.branchDir(V(0, 0, 0)), side = this.rngVisit.chance(0.5) ? 1 : -1;
    // off the branch forward, dropping a little as the wings open, then climbing away to one side into the canopy
    const end = start.clone().addScaledVector(along, side * 9.5).addScaledVector(face, 2.0).add(V(0, 6.2, 0));
    const P = [start, start.clone().addScaledVector(face, 1.1).add(V(0, -0.2, 0)),
      start.clone().addScaledVector(face, 2.4).addScaledVector(along, side * 2.6).add(V(0, 1.0, 0)), end];
    this.flight = new Flight(P, Flight.length(P) / FLY_SPEED * 1.25, 0.2, 1.45);
    this.state = 'leave'; this.t = 0;
    this.act = null; this.mood = null; this.speaking = false;
    if (p && p.taken === this) p.taken = null;
  }
  endVisit() {
    if (this.perch && this.perch.taken === this) this.perch.taken = null;
    this.state = 'away'; this.t = 0; this.obj.visible = false;
    this.flight = null; this.perch = null; this.mood = null; this.act = null;
    this.wait = this.rngVisit.range(150, 330);
  }

  /* ---------- lessons (lib/guide.js): called in, it stays while someone talks with it, turned to them ---------- */
  /** 'away' (not here), 'leaving', 'coming' (flying in) or 'ready' (settled on its branch) */
  lessonState() {
    if (this.state === 'perch') return this.t > 0.7 ? 'ready' : 'coming';
    if (this.state === 'leave') return 'leaving';
    return this.state === 'away' && !this.summoned ? 'away' : 'coming';
  }
  summon() {
    this.summoned = true;
    if (this.state === 'away') this.beginVisit();
    else if (this.state === 'leave') this.comeBack();
    else this.stayDur = Infinity;
  }
  talk(on) {
    this.talking = !!on;
    if (this.talking) { this.summon(); this.act = null; } else this.speaking = false;
  }
  /** 'yes' (a right answer: it bobs), 'no' (a wrong one: it shakes its head) or 'done' (it spreads its wings) */
  react(kind) {
    this.mood = { kind, t: 0 };
    if (this.ff) return;
    if (kind === 'yes') this.env.sfx('chirp');
    else if (kind === 'done') this.env.sfx('squawk');
  }
  release() {
    this.summoned = false; this.talking = false; this.speaking = false;
    if (this.state === 'perch') this.stayDur = this.t + this.rngVisit.range(20, 40);
  }

  /* ---------- every frame ---------- */
  update(dt, time) {
    this.time = time;
    if (!(dt > 0)) return;
    this.t += dt;
    const cam = this.ctx.camera;
    this.U.uMPx.value = 0.5 * this.env.renderer.getDrawingBufferSize(_v2).y * cam.projectionMatrix.elements[5];
    const day = this.ctx.daylight ? this.ctx.daylight() : 1;
    this.U.uMRim.value.setRGB(0.2, 0.24, 0.22).multiplyScalar(lerp(0.3, 1, day));
    if (this.state === 'away') {
      if (this.summoned || (this.t > this.wait && day > 0.45)) this.beginVisit();
      if (this.state === 'away') return;
    }
    if (this.state === 'arrive' || this.state === 'leave') this.updateFlight(dt, this.state === 'arrive');
    else if (this.state === 'perch') this.updatePerch(dt);
    if (this.state !== 'away') this.pose(dt);
  }

  updateFlight(dt, arriving) {
    const F = this.flight;
    const k = F.at(this.t, this.pos, this.vel);
    const hv = Math.hypot(this.vel.x, this.vel.z), v = this.vel.length();
    // the body faces its way (gently: no snap where the path starts slow), tips forward with speed, banks into turns
    if (hv > 0.25) this.yawS.step(near(Math.atan2(this.vel.x, this.vel.z), this.yawS.x), 7, dt);
    const turn = (this.yawS.x - this.lastYaw) / dt; this.lastYaw = this.yawS.x;
    const climb = Math.atan2(this.vel.y, Math.max(hv, 0.01));
    const left = (1 - k) * F.dur;
    // landing, it flares over the last second (body up, deep quick strokes, the tail down and spread, the feet out);
    // taking off, it springs out of the same pose
    const flare = arriving ? 1 - smoothstep(0.0, 1.15, left) : 1 - smoothstep(0.0, 0.7, this.t);
    const speedTip = smoothstep(0.6, 3.5, v);
    this.tiltS.step(lerp(0.25, PITCH_FLY - clamp(climb, -0.5, 0.6) * 0.55, Math.min(speedTip, 1 - flare)), 7, dt);
    this.rollS.step(clamp(-turn * v / 9.8, -0.75, 0.75) * (1 - flare), 5, dt);
    const glide = smoothstep(-0.08, -0.38, climb) * (1 - flare) * smoothstep(3, 5, v);
    this.flapA.step(lerp(lerp(0.9, 0.18, glide), 1.15, flare), 6, dt);
    this.flapF = lerp(4.4, 5.6, flare);
    this.fold[0].step(0, 14, dt); this.fold[1].step(0, 14, dt);
    this.raise.step(0, 6, dt); this.stretch[0].step(0, 6, dt); this.stretch[1].step(0, 6, dt);
    this.legs.step(arriving && flare > 0.35 ? 0 : 1, 6, dt);
    this.tailP.step(-0.42 * flare, 6, dt); this.tailFan.step(1 + 0.55 * flare, 6, dt); this.wag.step(0, 5, dt);
    this.hYaw.step(0, 6, dt); this.hPitch.step(arriving ? -0.15 * flare : 0, 6, dt); this.hRoll.step(0, 6, dt);
    this.jaw.step(0, 10, dt); this.ruffle.step(0, 5, dt); this.dip.step(0, 10, dt);
    if (k >= 1) { if (arriving) this.land(); else this.endVisit(); }
  }

  updatePerch(dt) {
    const p = this.perch, cam = this.ctx.camera;
    if (!this.summoned && !this.talking && !this.mood && this.t > this.stayDur) { this.beginLeave(); return; }
    const face = this.facingFor(p, this.face);
    const base = Math.atan2(face.x, face.z);
    const toCam = Math.atan2(cam.position.x - this.pos.x, cam.position.z - this.pos.z);
    // turned to whoever talks with it as far as its grip allows (the head turns the rest)
    const bodyYaw = this.talking ? base + clamp(wrap(toCam - base), -0.55, 0.55) : base;
    this.yawS.step(near(bodyYaw, this.yawS.x), 3.2, dt);
    this.lastYaw = this.yawS.x;
    this.perchRoot(p, face, this.pos);
    this.dip.step(0, 9, dt);
    this.tiltS.step(this.talking ? 0.07 : 0.02, 6, dt);
    this.rollS.step(0, 6, dt);
    this.legs.step(0, 9, dt);
    this.flapF = 0.55; // (on a branch only the display's slow ripple: quick beats strobe the feather tips at 60 fps)
    // the reaction under way, then (alone) what it does on its branch
    let open = 0, raise = 0, flap = 0, fan = 1, tailP = 0, hy = 0, hp = 0, hr = 0, jaw = 0, ruffle = 0;
    const m = this.mood;
    if (m) {
      m.t += dt;
      if (m.kind === 'done') {
        // the display: wings spread wide and raised and held there, rippling slowly, the tail spread; then folded away
        const e = envl(m.t, 2.9, 0.45);
        open = e; raise = e; flap = 0.09 * smoothstep(0.4, 1.0, m.t) * (1 - smoothstep(2.0, 2.6, m.t)); fan = 1 + 0.5 * e; hp = -0.25 * e;
        if (m.t > 3.0) this.mood = null;
      } else if (m.t > 1.25) this.mood = null;
    }
    const a = this.act;
    if (!this.talking && !m) {
      this.actWait -= dt;
      if (!a && this.actWait <= 0) this.startAct();
    }
    if (a) {
      a.t += dt;
      const e = envl(a.t, a.dur, Math.min(0.5, a.dur * 0.3));
      if (a.kind === 'look') { hy = a.yaw * e; hp = a.pitch * e; hr = a.roll * e; }
      else if (a.kind === 'preen') {
        hy = a.side * 1.35 * e; hp = 0.72 * e; hr = a.side * -0.35 * e;
        jaw = e * 0.08 * (Math.sin(a.t * 17) * 0.5 + 0.5); hp += e * 0.05 * Math.sin(a.t * 13);
      } else if (a.kind === 'stretch') { this.stretch[a.side > 0 ? 0 : 1].step(e, 5, dt); hy = a.side * 0.5 * e; fan = 1 + 0.35 * e; }
      else if (a.kind === 'ruffle') { ruffle = e; }
      if (a.t >= a.dur || this.talking || m) { this.act = null; this.actWait = this.rngAct.range(1.8, 5.5); }
    }
    if (!a || a.kind !== 'stretch') { this.stretch[0].step(0, 5, dt); this.stretch[1].step(0, 5, dt); }
    if (this.talking) {
      // looking at the camera (its head turns past where its body does), with the curious tilts of a parrot
      const hx = this.pos.y + 0.17, dist = Math.hypot(cam.position.x - this.pos.x, cam.position.z - this.pos.z);
      hy = clamp(wrap(toCam - this.yawS.x), -1.1, 1.1);
      hp = clamp(Math.atan2(hx - cam.position.y, Math.max(dist, 0.3)), -0.45, 0.55) * 0.8;
      this.tiltWait -= dt;
      if (this.tiltWait <= 0) { this.tiltWait = this.rngTilt.range(2.5, 5); this.tiltTo = this.rngTilt.chance(0.45) ? 0 : this.rngTilt.range(0.14, 0.3) * (this.rngTilt.chance(0.5) ? 1 : -1); }
      hr = this.tiltTo;
    }
    if (this.speaking) {
      // its beak works in syllables while it speaks, the head moving a little with the words
      this.spkPh += dt * 10.5;
      jaw = Math.max(jaw, 0.04 + 0.2 * Math.pow(Math.max(0, Math.sin(this.spkPh)), 0.7));
      hp += 0.03 * Math.sin(this.spkPh * 0.5);
    }
    this.fold[0].step(1 - Math.max(open, this.stretch[0].x * 0.62), 9, dt);
    this.fold[1].step(1 - Math.max(open, this.stretch[1].x * 0.62), 9, dt);
    this.raise.step(raise, 6, dt);
    this.flapA.step(flap, 6, dt);
    this.tailP.step(tailP, 5, dt); this.tailFan.step(fan, 6, dt);
    this.wag.step(this.talking ? 0 : 0.04 * Math.sin(this.t * 0.9), 3, dt);
    this.hYaw.step(hy, 7, dt); this.hPitch.step(hp, 7, dt); this.hRoll.step(hr, 5, dt);
    this.jaw.step(jaw, 22, dt);
    this.ruffle.step(ruffle, 8, dt);
  }
  startAct() {
    const r = this.rngAct, x = r.next();
    if (x < 0.42) this.act = { kind: 'look', t: 0, dur: r.range(1.6, 3.6), yaw: r.range(-1.1, 1.1), pitch: r.range(-0.2, 0.35), roll: r.range(-0.2, 0.2) };
    else if (x < 0.64) this.act = { kind: 'preen', t: 0, dur: r.range(2.4, 4.2), side: r.chance(0.5) ? 1 : -1 };
    else if (x < 0.8) this.act = { kind: 'stretch', t: 0, dur: r.range(1.8, 2.6), side: r.chance(0.5) ? 1 : -1 };
    else this.act = { kind: 'ruffle', t: 0, dur: r.range(0.9, 1.4) };
  }

  /* ---------- pose ---------- */
  pose(dt = 0) {
    const b = this.bones;
    this.obj.position.copy(this.pos);
    this.obj.position.y += this.dip.x * 0.022;
    this.obj.quaternion.setFromEuler(_e.set(this.tiltS.x + this.dip.x * 0.05, this.yawS.x, this.rollS.x, 'YXZ'));
    this.flapPh = (this.flapPh + TAU * this.flapF * dt) % TAU;
    // reactions drawn straight from their time (quick, so not through the springs): bobs and shakes
    let bob = 0, shake = 0;
    const m = this.mood;
    if (m && m.kind === 'yes') bob = 0.3 * Math.max(0, Math.sin(m.t * TAU * 2.6)) * envl(m.t, 1.2, 0.12);
    if (m && m.kind === 'no') shake = 0.34 * Math.sin(m.t * TAU * 3.1) * envl(m.t, 1.15, 0.15);
    // the body (its feathers fluffed out)
    b[B.ROOT].scale.set(1 + 0.07 * this.ruffle.x, 1 + 0.02 * this.ruffle.x, 1 + 0.07 * this.ruffle.x);
    // neck and head: the neck takes a third of each turn, the head the rest
    const hy = this.hYaw.x + shake, hp = this.hPitch.x + bob, hr = this.hRoll.x;
    _qN.setFromEuler(_e.set(hp * 0.35, hy * 0.35, hr * 0.25, 'YXZ'));
    _qH.copy(_qN).multiply(_q.setFromEuler(_e.set(hp * 0.65, hy * 0.65, hr * 0.75, 'YXZ')));
    b[B.NECK].position.copy(BIND[B.NECK]); b[B.NECK].quaternion.copy(_qN);
    const hp0 = b[B.HEAD].position.subVectors(BIND[B.HEAD], BIND[B.NECK]).applyQuaternion(_qN).add(BIND[B.NECK]);
    b[B.HEAD].quaternion.copy(_qH);
    b[B.JAW].position.subVectors(BIND[B.JAW], BIND[B.HEAD]).applyQuaternion(_qH).add(hp0);
    b[B.JAW].quaternion.copy(_qH).multiply(qX(_q, this.jaw.x));
    // the tail: hangs; in flight it lies in line; landing it drops and spreads; a little sway
    qX(_qT, this.tailP.x).multiply(qY(_q, this.wag.x));
    b[B.TAIL0].position.copy(BIND[B.TAIL0]); b[B.TAIL0].quaternion.copy(_qT); b[B.TAIL0].scale.set(this.tailFan.x, 1, 1);
    const t1 = b[B.TAIL1].position.subVectors(BIND[B.TAIL1], BIND[B.TAIL0]).applyQuaternion(_qT).add(BIND[B.TAIL0]);
    _q2.copy(_qT).multiply(qX(_q, this.tailP.x * 0.3));
    b[B.TAIL1].quaternion.copy(_q2); b[B.TAIL1].scale.set(lerp(1, this.tailFan.x, 0.85), 1, 1);
    b[B.TAIL2].position.subVectors(BIND[B.TAIL2], BIND[B.TAIL1]).applyQuaternion(_q2).add(t1);
    b[B.TAIL2].quaternion.copy(_q2).multiply(qX(_q, this.tailP.x * 0.2)); b[B.TAIL2].scale.set(lerp(1, this.tailFan.x, 0.7), 1, 1);
    // the wings
    for (let si = 0; si < 2; si++) this.poseWing(si);
    // legs: gripping, or swung back and drawn up under the tail to fly
    for (let si = 0; si < 2; si++) {
      const lg = this.legs.x;
      qX(_qL, lg * 1.15);
      b[B.LEG[si]].position.copy(BIND[B.LEG[si]]); b[B.LEG[si]].quaternion.copy(_qL);
      b[B.FOOT[si]].position.subVectors(BIND[B.FOOT[si]], BIND[B.LEG[si]]).applyQuaternion(_qL).add(BIND[B.LEG[si]]);
      b[B.FOOT[si]].quaternion.copy(_qL).multiply(qX(_q, lg * 0.5));
      b[B.FOOT[si]].scale.setScalar(1 - 0.25 * lg);
    }
  }
  poseWing(si) {
    const b = this.bones, sx = si === 0 ? 1 : -1;
    const fold = clamp(this.fold[si].x, 0, 1), st = this.stretch[si].x, raise = this.raise.x;
    const vis = 1 - smoothstep(0.5, 0.9, fold);
    // the folded wing shows while the flight wing is shut (and shrinks into the shoulder as it opens)
    b[B.CLOAK[si]].position.copy(BIND[B.CLOAK[si]]);
    b[B.CLOAK[si]].scale.setScalar(Math.max(smoothstep(0.55, 0.92, fold), 0.001));
    const A = this.flapA.x, ph = this.flapPh, down = Math.sin(ph), up = Math.max(0, -down);
    // shoulder: elevation about the body's long axis (up in flight), sweep toward the head, twist about the span
    // (the display: wings raised in a V, a little forward, the elbows and wrists a little bent so all of it stays in a
    // close-up)
    const elev = 0.08 + A * 0.9 * Math.cos(ph) - raise * 0.18 - st * 0.55 + fold * 0.3;
    const sweep = 0.06 + 0.16 * A * down + raise * 0.62 - st * 0.95 - fold * 1.2;
    const twist = -0.12 * A * down;
    _qh.copy(qZ(_q, sx * sweep)).multiply(qY(_q2, sx * elev)).multiply(qX(_q2, twist));
    const sh = b[B.HUM[si]].position.copy(BIND[B.HUM[si]]);
    sh.x *= lerp(0.7, 1, vis);
    b[B.HUM[si]].quaternion.copy(_qh); b[B.HUM[si]].scale.setScalar(Math.max(vis, 0.001));
    // elbow: flexes on the upstroke and folds
    const flexE = 0.05 + 0.3 * A * up + fold * 2.4 + st * 0.2 + raise * 0.35;
    _qf.copy(_qh).multiply(qZ(_q, -sx * flexE));
    const elbow = b[B.FORE[si]].position.set(sx * (ELBOW_X - SHOULDER.x) * Math.max(vis, 0.001), 0, -0.008 * vis).applyQuaternion(_qh).add(sh);
    b[B.FORE[si]].quaternion.copy(_qf); b[B.FORE[si]].scale.setScalar(Math.max(vis, 0.001));
    // wrist: the hand lags through the stroke, and folds back along the forearm
    const flexW = 0.04 + 0.45 * A * up + fold * 2.6 - st * 0.15 + raise * 0.3;
    _qw.copy(_qf).multiply(qZ(_q, -sx * flexW)).multiply(qY(_q2, sx * 0.4 * A * Math.cos(ph - 0.8)));
    b[B.HAND[si]].position.set(sx * (WRIST_X - ELBOW_X) * Math.max(vis, 0.001), 0, -0.006 * vis).applyQuaternion(_qf).add(elbow);
    b[B.HAND[si]].quaternion.copy(_qw); b[B.HAND[si]].scale.setScalar(Math.max(vis, 0.001));
  }

  /* ---------- for the guide, the camera and taps ---------- */
  worldPoint(bone, local, out) {
    const bn = this.bones[bone];
    out.copy(local).multiply(bn.scale).applyQuaternion(bn.quaternion).add(bn.position);
    this.obj.updateMatrixWorld();
    return out.applyMatrix4(this.obj.matrixWorld);
  }
  /** a point over its head (the guide's marker) */
  anchor(out) { this.worldPoint(B.HEAD, this.headPt, out); out.y += 0.2; return out; }
  pickTarget() {
    if (!this.obj.visible) return null;
    this.worldPoint(B.HEAD, this.headPt, this._pick || (this._pick = V(0, 0, 0)));
    this._pick.y -= 0.08;
    return { member: null, label: '金刚鹦鹉', guardian: 'macaw', pos: this._pick, radius: 0.42 };
  }
  /** the camera's target while it talks: steady on its branch, a little below its middle (its head in the upper
   *  part of the picture, clear of the dialogue) */
  look(out) {
    if (!this.perch) return out.copy(this.pos);
    return this.perchRoot(this.perch, this.face, out).add(V(0, -0.03, 0));
  }
  /** the camera for a lesson: close, a little above, from in front of it (three-quarters on the side the camera is
   *  already on), turned where a trunk, a branch or a vine would stand between */
  view(yaw) {
    const cam = this.ctx.camera, portrait = cam.aspect < 0.9;
    const v = { target: this.look(V(0, 0, 0)), yaw, pitch: 0.08, dist: portrait ? 1.3 : 0.86 };
    const fy = Math.atan2(this.face.x, this.face.z);
    const off = clamp(wrap(yaw - fy), -0.55, 0.55);
    for (const d of [off, 0.4 * Math.sign(off || 1), -0.4 * Math.sign(off || 1), 0.15, -0.15, 0.65, -0.65, 0.9, -0.9]) {
      if (this.viewClear(v.target, fy + d, v.pitch, v.dist)) { v.yaw = fy + d; return v; }
    }
    v.yaw = fy + off;
    return v;
  }
  viewClear(t, yaw, pitch, dist) {
    const occ = this.ctx.occluders || [];
    if (!occ.length) return true;
    const cp = Math.cos(pitch);
    const c = _c.set(t.x + dist * cp * Math.sin(yaw), t.y + dist * Math.sin(pitch), t.z + dist * cp * Math.cos(yaw));
    const ray = this._ray || (this._ray = new THREE.Raycaster());
    for (const h of [0.0, 0.17]) {
      _a.set(t.x, t.y + h, t.z); _b.subVectors(c, _a); const len = _b.length();
      ray.set(_a, _b.divideScalar(len)); ray.near = 0.18; ray.far = len + 0.25;
      if (ray.intersectObjects(occ, false).length) return false;
    }
    return true;
  }
  /** where a new resident given for a lesson comes in: beside it, along its branch toward the tip, in view */
  rewardAt(out) {
    if (!this.perch) return out.copy(this.pos);
    return out.copy(this.pos).addScaledVector(this.branchDir(_d), 0.9).add(V(0, 0.4, 0)).addScaledVector(this.face, 0.4);
  }

  /** Test hook: start a visit now (to the branch the camera sees best) and play it t seconds in. */
  debug(t = 8, stay = 120) {
    this.endVisit();
    this.t = 0;
    this.beginVisit();
    this.ff = true;
    const step = 1 / 30;
    for (let k = 0; k < Math.round(t / step); k++) this.update(step, this.time + step);
    this.ff = false;
    if (this.state === 'perch') this.stayDur = Math.max(this.stayDur, this.t + stay);
    return { state: this.state, t: this.t, perch: this.perch && this.perch.pos.toArray() };
  }
  dispose() {
    this.ctx.scene.remove(this.obj);
    this.geo.dispose(); this.mat.dispose(); this.tex.map.dispose(); this.tex.normalMap.dispose();
  }
}

/** The skinned mesh with its flat skeleton (every bone a child of the mesh, at its bind position). */
function makeMacawMesh(geo, mat) { return makeFlatSkinnedMesh(geo, mat, BIND); }

export { buildMacawGeometry, paintMacawAtlas, macawMaterial, makeMacawMesh, B as MACAW_BONES, BIND as MACAW_BIND, BONE_COUNT as MACAW_BONE_COUNT, PERCH_DY, PERCH_R };
