// 云海 · 太极龟 — the cloud sea's guardian: an old master tortoise who practises tai chi on the jade terrace under the
// peach tree, his disciples (the resident tortoises) round him. Called for a lesson he gathers his form, turns to
// whoever has come and gives them a small bow; while he talks his beak moves with the words and his long white beard
// and brows sway; a right answer earns a slow nod and a stroke of the beard, a wrong one a slow shake of the head and
// a raised palm, and when a lesson is learnt he draws a great circle with both arms and gathers a ball of golden qi
// between his palms, lets it rise and burst, and bows.
//
// One skinned mesh (one draw call) built from parametric parts: the high-domed carapace with its thick rim, the
// plastron and the bridges that join them, the skin of the body inside, the wrinkled neck, the head with its horny
// hooked beak, hinged jaw and heavy-lidded eyes, strands of white brow and beard, scaled forelimbs with claws,
// columnar legs and a short tail; painted into one atlas (scutes with growth rings, moss and lichen on the old shell,
// scales and folds of skin) over a matching relief. The flat rig is posed every frame from functions of time and
// exact springs, so he moves the same at any frame rate.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, makeCanvas, createNoise, normalMapFromHeight } from '../../lib/util.js';
import { V, spow, envl, range, table, Spring, Geo, makeRuv, makeFlatSkinnedMesh } from '../../lib/rig.js';
import { patchStd, glowSprite } from './common.js';

/* ------------------------------------------------------------------ */
/* Body plan (bind pose, model space: origin on the ground between the  */
/* feet, +Z the way he faces, +Y up, +X his left; metres at scale 1)     */
/* ------------------------------------------------------------------ */
// the carapace: a dome over his back from behind the shoulders (a = 0) down to over the tail (a = 1), round from his
// left edge (b = 0) over the back (b = 0.5) to his right edge (b = 1)
const CARA_TOP = 1.47, CARA_BOT = 0.42;
// its sections follow an ellipsoid (centre height CARA_YC, half height CARA_H): the rims close in like a bowl's lip
const CARA_YC = 0.95, CARA_H = 0.62, CARA_W = 0.51, CARA_D = 0.57;
const caraE = a => Math.abs(lerp(CARA_TOP, CARA_BOT, a) - CARA_YC) / CARA_H;
const caraW = a => CARA_W * Math.pow(Math.sqrt(Math.max(0, 1 - caraE(a) ** 2)), 0.9);   // half width
const caraD = a => CARA_D * Math.sqrt(Math.max(0, 1 - caraE(a) ** 2));                  // depth behind the side edges
const caraZe = a => 0.11 * smoothstep(0.75, 0.15, caraE(a));                             // the side edges, forward at the bridges
// the plastron: the flat shield over his belly, from the throat (a = 0) to the groin (a = 1)
const PLAS_TOP = 1.33, PLAS_BOT = 0.49;
const PLAS = [ // [a, half width, z of its middle]
  [0.00, 0.1, 0.17], [0.06, 0.2, 0.19], [0.2, 0.31, 0.215], [0.5, 0.35, 0.235], [0.8, 0.32, 0.215], [0.94, 0.22, 0.19], [1.00, 0.1, 0.165],
];
// the bridges join the plastron's sides to the carapace's edges between the arm and leg openings
const BRIDGE_Y0 = 0.7, BRIDGE_Y1 = 1.06;
// the body inside the shell (seen at the openings): sections along y [y, half width, z of its middle, half depth]
const CORE = [[0.355, 0.002, -0.06, 0.002], [0.38, 0.05, -0.06, 0.05], [0.44, 0.27, -0.06, 0.22], [0.56, 0.38, -0.07, 0.29], [0.9, 0.45, -0.08, 0.32], [1.22, 0.44, -0.04, 0.29], [1.34, 0.36, 0.0, 0.22], [1.42, 0.2, 0.02, 0.13], [1.46, 0.05, 0.02, 0.04], [1.475, 0.002, 0.02, 0.002]];   // (closed at both ends)
// the neck: from inside the shell up and forward to the back of the head
const NECK = [V(0, 1.27, 0.02), V(0, 1.4, 0.1), V(0, 1.5, 0.18), V(0, 1.568, 0.262)];
// the head along its axis, s from the back of the skull (0) to the tip of the beak (1)
const HEAD_O = V(0, 1.59, 0.205), HEAD_T = V(0, 1.548, 0.47);
const HEAD = [ // [s, half width, height of the crown above the axis, depth of the mouth line below it]
  // (the back of the skull rounded off over the neck, which enters it from below)
  [0.0, 0.004, 0.004, 0.003], [0.012, 0.036, 0.03, 0.02], [0.045, 0.068, 0.056, 0.038], [0.1, 0.095, 0.078, 0.052],
  [0.18, 0.112, 0.092, 0.061], [0.4, 0.119, 0.097, 0.064], [0.62, 0.109, 0.087, 0.06],
  [0.8, 0.09, 0.074, 0.054], [0.9, 0.073, 0.063, 0.047], [0.96, 0.054, 0.05, 0.038], [0.99, 0.03, 0.03, 0.023], [1.0, 0.004, 0.006, 0.004],
];
const S_EYE = 0.6, EYE_R = 0.026, EYE_PH = 0.62;   // where the eyes sit: along the head, and up its side (rad)
const JAW_HINGE = V(0, 1.552, 0.29);
// the forelimbs (bind: hanging a little forward, bent) and the hind legs; [x, y, z] of the joints, the left side
const SHO = V(0.35, 1.23, 0.07), ELB = V(0.44, 0.97, 0.15), WRI = V(0.46, 0.75, 0.21);
const HIP = V(0.22, 0.47, -0.04), KNEE = V(0.27, 0.28, 0.07), ANK = V(0.27, 0.11, 0.04);
const TAIL0 = V(0, 0.44, -0.28), TAIL1 = V(0, 0.3, -0.42);

/* ------------------------------------------------------------------ */
/* Skeleton (flat: every bone a child of the mesh, posed in its frame)   */
/* ------------------------------------------------------------------ */
const B = {
  ROOT: 0, BODY: 1, NECK1: 2, NECK2: 3, HEAD: 4, JAW: 5, LID: [6, 7], BROW: [8, 9], BEARD: [10, 11, 12],
  SHO: [13, 16], ELB: [14, 17], HAND: [15, 18], HIP: [19, 22], KNEE: [20, 23], FOOT: [21, 24], TAIL: 25,
};
const BONE_COUNT = 26;
const mirror = (v, s) => V(v.x * s, v.y, v.z);
const headAt = (s, out) => out.lerpVectors(HEAD_O, HEAD_T, s);
/** a point of the skull's surface (and its outward normal): s along the head, ph round it from the left mouth
 *  corner (0) over the crown to the right one (PI); below, the palate */
function headSurface(s, ph, out) {
  const ss = clamp(s, 0, 1);
  const w = table(HEAD, ss, 1), up = table(HEAD, ss, 2), dn = table(HEAD, ss, 3);
  headAt(ss, out);
  const c = Math.cos(ph), sn = Math.sin(ph);
  const y0 = out.y - dn * 0.15;
  if (sn >= 0) {
    const hook = -0.01 * smoothstep(0.88, 1.0, ss) * Math.pow(sn, 2);
    return out.set(w * spow(c, 0.7), y0 + (up + dn * 0.15) * Math.pow(sn, 0.75) + hook, out.z);
  }
  // the palate under the mouth line; behind the corners of the mouth, the underside of the skull, full and round
  return out.set(w * c, y0 + dn * lerp(1.25, 0.25, smoothstep(0.12, 0.32, ss)) * sn, out.z);
}
/** the distance along a line F(s, out) of a part from s = 0 (m), and back: a part's painting runs along it at an even
 *  scale (a closed end, like the tip of the beak, is a small dome that s crosses quickly) */
function arcTable(F, n = 400) {
  const a = [0], p = V(0, 0, 0), q = V(0, 0, 0);
  F(0, q);
  for (let i = 1; i <= n; i++) { F(i / n, p); a.push(a[i - 1] + p.distanceTo(q)); q.copy(p); }
  const total = a[n];
  return {
    total,
    at: s => { const x = clamp(s, 0, 1) * n, i = Math.min(n - 1, Math.floor(x)); return lerp(a[i], a[i + 1], x - i); },
    inv: d => { const x = clamp(d, 0, total); let lo = 0, hi = n; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m; else hi = m; } return (lo + (x - a[lo]) / Math.max(1e-9, a[hi] - a[lo])) / n; },
  };
}
/** over the top of the head, from the back of the skull to the tip of the beak */
const HEAD_ARC = arcTable((s, out) => headSurface(s, Math.PI / 2, out));
/** the normal where a surface closes to a point (the tip of the beak, the back of the skull, the chin): the mean of its
 *  normals on a ring just short of it, so the shading runs smoothly into the point instead of a star of facets */
function poleNormal(F, u, v0, v1, n = 32, sign = 1) {
  const p = V(0, 0, 0), a = V(0, 0, 0), b = V(0, 0, 0), du = V(0, 0, 0), dv = V(0, 0, 0), sum = V(0, 0, 0), e = 1e-4;
  for (let i = 0; i < n; i++) {
    const v = lerp(v0, v1, (i + 0.5) / n);
    F(u, v, p); F(u + e, v, a); F(u - e, v, b); du.subVectors(a, b); F(u, v + e, a); F(u, v - e, b); dv.subVectors(a, b);
    sum.add(du.cross(dv).normalize());
  }
  return sum.multiplyScalar(sign).normalize();
}
const TIP_N = poleNormal(headSurface, 0.985, 0, TAU, 48, -1), BACK_N = poleNormal(headSurface, 0.015, 0, TAU, 48, -1);
/** the horn sheath of the upper beak: its top edge rises from the corner of the mouth to 3.5 cm above the mouth line
 *  over the snout (below the nostrils), so it covers the whole tip; beakReach(s) is how far round the head that is
 *  (turns up from the mouth line; 0.25 is the top) */
const beakEdge = s => lerp(0.002, 0.031, Math.pow(smoothstep(0.76, 0.97, s), 2));
const beakReach = s => {
  const hh = table(HEAD, s, 2) + 0.15 * table(HEAD, s, 3) - 0.01 * smoothstep(0.88, 1, s), r = beakEdge(s) / Math.max(1e-4, hh);
  return r >= 1 ? 0.3 : Math.asin(Math.pow(r, 4 / 3)) / TAU;
};
/** the lower jaw runs from JAW_S0 to JAW_S1 along the head (k 0..1 along it); its horn round from the lip (0.5 is under
 *  the chin), over the whole chin at the front */
const JAW_S0 = 0.15, JAW_S1 = 0.985, jawSS = k => lerp(JAW_S0, JAW_S1, k);
const jawReach = k => { const ss = jawSS(k); return smoothstep(0.72, 0.8, ss) * (0.04 + 0.1 * Math.pow(smoothstep(0.76, 0.93, ss), 2) + 0.4 * smoothstep(0.89, 0.95, ss)); };
const _ax = V(0, 0, 0);
const lipY = ss => headAt(ss, _ax).y - table(HEAD, ss, 3) * 0.15;
/** a point of the lower jaw: a scoop under the mouth line, k along it from behind the hinge to the chin, ph round it from
 *  the left lip (0) under the chin to the right one (PI) */
function jawPoint(s, ph, out) {
  const k = clamp(s, 0, 1), ss = jawSS(k);
  headAt(ss, _ax);
  const z = _ax.z;
  // rounded off at the chin: the scoop closes to a point tucked under the tip of the upper beak; its back end (behind
  // the hinge) runs into the underside of the skull
  const end = k > 0.83 ? Math.sqrt(Math.max(0, 1 - ((k - 0.83) / 0.17) ** 2)) : 1, back = lerp(0.9, 1, smoothstep(0, 0.2, k));
  const w = table(HEAD, ss, 1) * 1.005 * end * back, dn = table(HEAD, ss, 3);
  const deep = (dn * lerp(1.15, 0.95, ss) + 0.004) * lerp(0.2, 1, end) * back;
  const c = Math.cos(ph), sn = Math.max(0, Math.sin(ph));
  return out.set(w * spow(c, 0.8), lipY(ss) + 0.005 - deep * Math.pow(sn, 0.8), z + 0.003);
}
/** under the jaw, from behind the hinge to the chin */
const JAW_ARC = arcTable((k, out) => jawPoint(k, Math.PI / 2, out));
const CHIN_N = poleNormal(jawPoint, 0.985, 0.05, Math.PI - 0.05, 32, 1);
/** 0 at both ends of [a, b], 1 midway: a section's two sides share one painting (twice the resolution round it) */
const fold = (x, a, b) => { const f = clamp((x - a) / (b - a), 0, 1); return Math.min(f, 1 - f) * 2; };
const EYE = [], EYE_N = [];
for (let si = 0; si < 2; si++) {
  const ph = si === 0 ? EYE_PH : Math.PI - EYE_PH;
  const p = headSurface(S_EYE, ph, V(0, 0, 0)), a = headSurface(S_EYE + 0.01, ph, V(0, 0, 0)), b = headSurface(S_EYE, ph + 0.01, V(0, 0, 0));
  const n = a.sub(p).cross(b.sub(p)).normalize();
  if (n.x * (si === 0 ? 1 : -1) < 0) n.negate();
  EYE_N.push(n.clone().add(V(0, 0.05, 0.18)).normalize());     // it looks out, a little forward and up
  EYE.push(p.clone().addScaledVector(n, -EYE_R * 0.5));
}
const BIND = [];
{
  const b = (i, p) => { BIND[i] = p.clone(); };
  b(B.ROOT, V(0, 0.5, -0.03)); b(B.BODY, V(0, 0.92, -0.05));
  b(B.NECK1, NECK[0]); b(B.NECK2, NECK[1].clone().lerp(NECK[2], 0.4)); b(B.HEAD, NECK[3]);
  b(B.JAW, JAW_HINGE);
  for (let si = 0; si < 2; si++) {
    const s = si === 0 ? 1 : -1;
    b(B.LID[si], EYE[si]);
    b(B.BROW[si], EYE[si].clone().add(V(-s * 0.012, 0.024, -0.004)));
    b(B.SHO[si], mirror(SHO, s)); b(B.ELB[si], mirror(ELB, s)); b(B.HAND[si], mirror(WRI, s));
    b(B.HIP[si], mirror(HIP, s)); b(B.KNEE[si], mirror(KNEE, s)); b(B.FOOT[si], mirror(ANK, s));
  }
  b(B.BEARD[0], V(0, 1.49, 0.395)); b(B.BEARD[1], V(0, 1.37, 0.43)); b(B.BEARD[2], V(0, 1.24, 0.42));
  b(B.TAIL, TAIL0);
}

/* ------------------------------------------------------------------ */
/* Atlas regions [u0, v0, u1, v1] (v from the bottom)                    */
/* ------------------------------------------------------------------ */
const ATLAS_W = 1024, ATLAS_H = 1024;
const R = {
  cara: [0.0, 0.5, 0.75, 1.0],        // a: down the shell (top rim -> bottom rim), b: round it (left edge -> right edge)
  rim: [0.75, 0.9375, 1.0, 1.0],      // the shell's edges: t round the boundary, w across the rim
  plas: [0.75, 0.5, 1.0, 0.9375],     // a: down the plastron, b: across (left -> right); its edges and the bridges too
  head: [0.0, 0.25, 0.25, 0.5],       // s along the head; round it the crown folded at its midline (0 at the mouth line,
                                      // 0.8 on top), then the palate (folded too)
  jaw: [0.25, 0.375, 0.375, 0.5],     // s along the jaw, round it from the lip (0) to under the chin (1), folded
  neck: [0.75, 0.25, 1.0, 0.5],       // along, round (folded: its two sides share one painting)
  core: [0.25, 0.25, 0.5, 0.375],     // round (folded: 0 in front, 1 behind), up
  arm: [0.0, 0.0, 0.375, 0.25],       // along (shoulder -> wrist), round
  hand: [0.375, 0.0, 0.5, 0.125],
  leg: [0.5, 0.0, 0.75, 0.25],        // along (hip -> ankle), round
  foot: [0.375, 0.125, 0.5, 0.25],
  claw: [0.75, 0.0, 0.875, 0.125],
  hair: [0.875, 0.0, 1.0, 0.125],     // along a strand, across
  eye: [0.75, 0.125, 0.875, 0.25],
  lid: [0.875, 0.125, 1.0, 0.25],
  tail: [0.5, 0.25, 0.625, 0.375],
  bridge: [0.625, 0.25, 0.75, 0.5],   // s across (plastron -> carapace), y up
};
const ruv = makeRuv(ATLAS_W, ATLAS_H, 3);

/* ------------------------------------------------------------------ */
/* Shapes                                                               */
/* ------------------------------------------------------------------ */
const caraY = a => lerp(CARA_TOP, CARA_BOT, a);
const _dp = V(0, 0, 0);
/** a point of the carapace's outer surface by its painting coordinates (a down the shell, b round it) */
function caraPoint(a, b, out) {
  const W = caraW(a), D = caraD(a), ze = caraZe(a);
  const th = (0.5 - b) * Math.PI;
  return out.set(W * spow(Math.sin(th), 0.85), caraY(a), ze - D * Math.pow(Math.max(Math.cos(th), 0), 0.8));
}
// The carapace itself: an ellipsoid dome over his back, from its pole (the middle of his back) out to the rim at
// polar angle RIM(psi) round it (psi 0 his left side, PI/2 up, PI his right, 3PI/2 down). The rim wraps forward past
// the sides where the bridges join and closes in at the top and bottom like a bowl's lip: one smooth loop.
const DOME_C = V(0, CARA_YC, 0.0), DOME_A = V(CARA_W, CARA_H, CARA_D);
const RIM_SIDE = 1.75, RIM_TOP = 1.2, RIM_BOT = 1.0;
// (forward of the sides only at the bridges: above and below them it curves back, the openings for the limbs)
const rimAngle = psi => { const sn = Math.sin(psi), tb = sn >= 0 ? RIM_TOP : RIM_BOT; return tb + (RIM_SIDE - tb) * Math.pow(Math.cos(psi), 6); };
function domePoint(rho, psi, out) {
  const th = clamp(rho, 0, 1) * rimAngle(psi), st = Math.sin(th);
  return out.set(DOME_A.x * st * Math.cos(psi), DOME_C.y + DOME_A.y * st * Math.sin(psi), DOME_C.z - DOME_A.z * Math.cos(th));
}
/** painting coordinates of a point on the dome (the scutes are laid out over a, b) */
function domeAB2(p) {
  const a = clamp((CARA_TOP - p.y) / (CARA_TOP - CARA_BOT), 0, 1);
  const h = Math.atan2(p.x / DOME_A.x, -(p.z - DOME_C.z) / DOME_A.z);   // round the back: 0 in the middle, +-PI/2 the sides
  return [a, clamp(0.5 - h / Math.PI, 0, 1)];
}
/** the rim's point at height y on his left (side 1) or right (-1) */
function rimAtY(y, side, out) {
  let lo = -Math.PI / 2 + 0.02, hi = Math.PI / 2 - 0.02;
  for (let k = 0; k < 40; k++) { const m = (lo + hi) / 2; domePoint(1, m, out); if (out.y < y) lo = m; else hi = m; }
  domePoint(1, (lo + hi) / 2, out);
  if (side < 0) out.x = -out.x;
  return out;
}
/** (rho, psi) on a disc -> (a, b) on a part's parameter square whose outline is a squircle of exponent n: the
 *  shells are sampled over it, so their rims are single smooth loops (a square's corners showed as points) */
function domeAB(rho, psi, n) {
  const c = Math.cos(psi), sn = Math.sin(psi), r = clamp(rho, 0, 1);
  return [0.5 - 0.5 * r * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n), 0.5 + 0.5 * r * Math.sign(c) * Math.pow(Math.abs(c), 2 / n)];
}
const plasY = a => lerp(PLAS_TOP, PLAS_BOT, a);
function plasPoint(a, b, out) {
  const W = table(PLAS, a, 1), zc = table(PLAS, a, 2), x = (2 * b - 1);
  // gently convex across, turning back toward the bridges at its sides
  return out.set(W * x, plasY(a), zc + 0.04 * (1 - x * x) - 0.06 * Math.pow(Math.abs(x), 6));
}
function corePoint(t, ph, out) {
  const y = lerp(CORE[0][0], CORE[CORE.length - 1][0], t);
  const w = table(CORE, y, 1), zc = table(CORE, y, 2), d = table(CORE, y, 3);
  return out.set(w * Math.sin(ph), y, zc + d * Math.cos(ph));
}
function bez(P, t, out) {
  const u = 1 - t;
  return out.set(0, 0, 0).addScaledVector(P[0], u * u * u).addScaledVector(P[1], 3 * u * u * t).addScaledVector(P[2], 3 * u * t * t).addScaledVector(P[3], t * t * t);
}
/** a tube along a curve C(t) (t 0..1) with radius r(t, phi) (phi round it), facing out; the section's frame turns with
 *  the curve */
function tubeSurface(C, r, up = V(0, 1, 0)) {
  const c = V(0, 0, 0), c1 = V(0, 0, 0), c0 = V(0, 0, 0), tg = V(0, 0, 0), a = V(0, 0, 0), bb = V(0, 0, 0);
  return (t, ph, out) => {
    const tt = clamp(t, 0, 1);
    C(tt, c); C(Math.min(1, tt + 0.004), c1); C(Math.max(0, tt - 0.004), c0);
    tg.subVectors(c1, c0).normalize();
    a.copy(up).addScaledVector(tg, -up.dot(tg));
    if (a.lengthSq() < 1e-8) a.set(1, 0, 0).addScaledVector(tg, -tg.x);
    a.normalize(); bb.crossVectors(a, tg);   // (round this way the surface faces out)
    const rr = r(tt, ph);
    return out.copy(c).addScaledVector(a, rr * Math.cos(ph)).addScaledVector(bb, rr * Math.sin(ph));
  };
}
/** a smooth curve through points (Catmull-Rom) */
function spline(pts) {
  const n = pts.length - 1, curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  return (t, out) => out.copy(curve.getPoint(clamp(t, 0, 1)));
}
const blendW = (x, a, b, b0, b1) => { const t = smoothstep(a, b, x); return t <= 0 ? [[b0, 1]] : t >= 1 ? [[b1, 1]] : [[b0, 1 - t], [b1, t]]; };

/* ------------------------------------------------------------------ */
/* Geometry                                                             */
/* ------------------------------------------------------------------ */
function buildTortoiseGeometry(q = 1) {
  const G = new Geo();
  const d = q >= 0.6 ? 1 : 0.65;
  const N = x => Math.max(4, Math.round(x * d));
  const shell = [[B.BODY, 1]];

  // ---- the body inside the shell ----
  G.surf(range(0, 1, N(20)), range(0, TAU, N(36)), corePoint, (t, ph, p) => ({
    uv: ruv(R.core, fold(ph, 0, TAU), t), ao: lerp(0.55, 0.9, smoothstep(-0.2, 0.2, Math.cos(ph))),
    bones: blendW(p.y, 0.62, 0.8, B.ROOT, B.BODY), rough: 0.78,
  }), { flip: true, pole: (t, ph, out) => out.set(0, t > 0.5 ? 1 : -1, 0) });

  // ---- the carapace: its outer face, and the rim where it turns under ----
  G.surf(range(0, 1, N(26), t => 1 - Math.pow(1 - t, 1.3)), range(0, TAU, N(84)), domePoint, (rho, psi) => {
    const [a, b] = domeAB2(domePoint(rho, psi, _dp));
    return { uv: ruv(R.cara, b, 1 - a), bones: shell, rough: 0.66 };
  }, { flip: true, pole: (rho, psi, out) => out.set(0, 0, -1) });
  // the rim: round the outline, turning in by its thickness toward the body (the top rim down, the bottom up)
  {
    const toIn = V(0, 0, 0);
    const rimF = (t, w, out) => {
      domePoint(1, t * TAU, out);
      toIn.set(-out.x, 0.35 * (smoothstep(0.7, 0.5, out.y) - smoothstep(1.2, 1.4, out.y)), -0.08 - out.z * 0.6).normalize();
      return out.addScaledVector(toIn, 0.032 * clamp(w, 0, 1));
    };
    G.surf(range(0, 1, N(160)), [0, 0.35, 1], rimF, (t, w) => ({ uv: ruv(R.rim, t, w), ao: lerp(0.95, 0.55, w), bones: shell, rough: 0.75 }));
  }

  // ---- the plastron ----
  const PLAS_N = 4;
  const plasF = (rho, psi, out) => { const [a, b] = domeAB(rho, psi, PLAS_N); return plasPoint(a, b, out); };
  G.surf(range(0, 1, N(18), t => 1 - Math.pow(1 - t, 1.3)), range(0, TAU, N(64)), plasF, (rho, psi) => {
    const [a, b] = domeAB(rho, psi, PLAS_N);
    return { uv: ruv(R.plas, b, 1 - a), bones: shell, rough: 0.6 };
  }, { pole: (rho, psi, out) => out.set(0, 0, 1) });
  G.surf(range(0, 1, N(100)), [0, 1], (t, w, out) => { plasF(1, t * TAU, out); return out.add(V(0, 0, -0.028 * clamp(w, 0, 1))); },
    (t, w) => ({ uv: ruv(R.plas, 0.5, 0.97), ao: lerp(0.9, 0.6, w), bones: shell, rough: 0.7 }), { flip: true });

  // ---- the bridges: from the plastron's sides out to the carapace's edges ----
  for (let si = 0; si < 2; si++) {
    const s = si === 0 ? 1 : -1;
    const pe = V(0, 0, 0), ce = V(0, 0, 0);
    const F = (u, v, out) => {
      const y = lerp(BRIDGE_Y0, BRIDGE_Y1, clamp(v, 0, 1));
      plasPoint((PLAS_TOP - y) / (PLAS_TOP - PLAS_BOT), si === 0 ? 1 : 0, pe);
      rimAtY(y, s, ce);
      const uu = clamp(u, 0, 1);
      out.lerpVectors(pe, ce, uu);
      // bowed outward; its ends round off into the openings
      const end = Math.sin(Math.PI * clamp(v, 0, 1));
      out.x += s * 0.035 * Math.sin(Math.PI * uu) * (0.4 + 0.6 * end);
      out.z += 0.02 * Math.sin(Math.PI * uu);
      return out;
    };
    G.surf(range(0, 1, N(8)), range(0, 1, N(14)), F, (u, v) => ({ uv: ruv(R.bridge, u, v), bones: shell, rough: 0.66 }), { flip: si !== 0 });
  }

  // ---- the neck: folds of skin from inside the shell up to the head ----
  {
    const C = spline(NECK);
    const r = (t, ph) => {
      const base = lerp(0.125, 0.088, smoothstep(0, 1, t));
      const fold = 1 + 0.085 * Math.pow(Math.max(0, Math.sin(t * 6.5 * Math.PI)), 3) * (0.55 + 0.45 * Math.cos(ph)) * smoothstep(0.05, 0.3, t) * (1 - smoothstep(0.82, 1, t));
      return base * fold;
    };
    G.surf(range(0, 1, N(26)), range(0, TAU, N(24)), tubeSurface(C, r, V(0, 0, 1)), (t, ph) => ({
      uv: ruv(R.neck, t, fold(ph, 0, TAU)),
      bones: t < 0.35 ? blendW(t, 0.0, 0.35, B.BODY, B.NECK1) : t < 0.7 ? blendW(t, 0.35, 0.7, B.NECK1, B.NECK2) : blendW(t, 0.7, 1, B.NECK2, B.HEAD),
      rough: 0.8,
    }));
  }

  // ---- the head: the skull and the upper beak (closed at the tip), the lower jaw under it ----
  {
    const hs = range(0, 1, N(34)).map(t => HEAD_ARC.inv(t * HEAD_ARC.total)), pole = (s, ph, out) => out.copy(s > 0.5 ? TIP_N : BACK_N);
    G.surf(hs, range(0, Math.PI, N(22)), headSurface, (s, ph) => {
      const dm = 0.25 * fold(ph, 0, Math.PI);
      return { uv: ruv(R.head, HEAD_ARC.at(s) / HEAD_ARC.total, 0.8 * fold(ph, 0, Math.PI)), bones: [[B.HEAD, 1]], rough: s > 0.74 && dm < beakReach(s) ? 0.55 : 0.7 };
    }, { flip: true, pole });
    G.surf(hs, range(Math.PI, TAU, N(22)), headSurface, (s, ph) => ({
      uv: ruv(R.head, HEAD_ARC.at(s) / HEAD_ARC.total, 0.82 + 0.18 * fold(ph, Math.PI, TAU)), bones: [[B.HEAD, 1]], rough: s > 0.3 ? 0.5 : 0.72,
    }), { flip: true, pole });
  }
  // the lower jaw: a scoop under the mouth line from the hinge to the chin, closed over by the floor of the mouth
  {
    const axis = V(0, 0, 0);
    G.surf(range(0, 1, N(20)).map(t => JAW_ARC.inv(t * JAW_ARC.total)), range(0, Math.PI, N(16)), jawPoint, (s, ph) => {
      const lip = 0.5 * fold(ph, 0, Math.PI);
      return { uv: ruv(R.jaw, JAW_ARC.at(s) / JAW_ARC.total, fold(ph, 0, Math.PI)), bones: [[B.JAW, 1]], rough: lip < jawReach(s) ? 0.55 : 0.72 };
    }, { pole: (u, v, out) => out.copy(CHIN_N) });
    // the floor of the mouth (and the tongue), seen when he speaks
    G.surf(range(0, 1, N(12)), range(0, 1, 6), (s, x, out) => {
      const ss = lerp(0.36, 0.97, clamp(s, 0, 1));
      headAt(ss, axis);
      const w = table(HEAD, ss, 1) * 0.9;
      return out.set(w * (2 * clamp(x, 0, 1) - 1), lipY(ss) - 0.018, axis.z);
    }, (s, x) => ({ uv: ruv(R.jaw, 0.01, 0.5), bones: [[B.JAW, 1]], rough: 0.5, ao: 0.6 }));   // (facing up)
  }

  // ---- the eyes: each set into its socket under a heavy upper lid and a lower one ----
  for (let si = 0; si < 2; si++) {
    const s = si === 0 ? 1 : -1, c = EYE[si], out0 = EYE_N[si];
    const ax = V(0, 0, 1).addScaledVector(out0, -out0.z).normalize();     // forward along the head
    const ay = out0.clone().cross(ax).multiplyScalar(s).normalize();      // up
    if (ay.y < 0) ay.negate();
    G.surf(range(0, 1, N(10)), range(0, TAU, N(20)), (r, ph, out) => {
      const th = clamp(r, 0, 1) * 1.45;
      return out.copy(c).addScaledVector(out0, EYE_R * Math.cos(th)).addScaledVector(ax, EYE_R * Math.sin(th) * Math.cos(ph)).addScaledVector(ay, EYE_R * Math.sin(th) * Math.sin(ph));
    }, (r, ph) => ({ uv: ruv(R.eye, 0.5 + 0.48 * Math.min(1, r / 0.75) * Math.cos(ph), 0.5 + 0.48 * Math.min(1, r / 0.75) * Math.sin(ph)), bones: [[B.HEAD, 1]], rough: 0.1 }),
    { flip: ax.clone().cross(ay).dot(out0) < 0, pole: (u, v, out) => out.copy(out0) });
    // the lids: shells a little outside the eyeball, the upper one over its top (it turns down to blink), the lower
    // one under it; their rims are the lids' edges
    for (const upper of [true, false]) {
      // (the upper lid's edge just above the middle of the eye, heavy and wise; the lower one's well below)
      const pole = upper ? ay.clone().multiplyScalar(Math.cos(0.3)).addScaledVector(out0, -Math.sin(0.3)).normalize()
        : ay.clone().multiplyScalar(-Math.cos(0.85)).addScaledVector(out0, -Math.sin(0.85)).normalize();
      const rr = EYE_R * (upper ? 1.13 : 1.09);
      const e1 = ax, e2 = pole.clone().cross(ax).normalize();
      const lidF = (al, phi, out) => {
        const a = clamp(al, 0, 1) * (Math.PI / 2) * (upper ? 1.06 : 1.0);
        const d = out.copy(pole).multiplyScalar(Math.cos(a)).addScaledVector(e1, Math.sin(a) * Math.cos(phi)).addScaledVector(e2, Math.sin(a) * Math.sin(phi));
        return d.multiplyScalar(rr * (1 + 0.06 * Math.sin(Math.PI * clamp(al, 0, 1)))).add(c);
      };
      G.surf(range(0, 1, N(9)), range(0, TAU, N(22)), lidF, (al, phi) => ({ uv: ruv(R.lid, ((phi / TAU) % 1 + 1) % 1, al * 0.5 + (upper ? 0.5 : 0)), bones: [[upper ? B.LID[si] : B.HEAD, 1]], rough: 0.68 }),
        { pole: (u, v, out) => out.copy(pole) });
    }
  }

  // ---- brows and beard: locks of white hair (flattened, tapering, painted with fine strands), and a few stray hairs ----
  const hrng = (() => { let x = 0x9e3779b9; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; }; })();
  const FWD = V(0, 0, 1);
  /** a lock along the points P: w0 x th0 at its root (broad across the frame's first axis if broadA, else its second),
   *  swelling a little past the root and tapering to a fine tip */
  const lock = (P, w0, th0, broadA, bonesAt, nAlong, { twist = 0, tone = 1, shade = 0.3 } = {}) => {
    const C = spline(P), taper = t => Math.pow(1 - t, 0.75) * (0.82 + 0.18 * Math.sin(Math.PI * Math.min(1, t * 2.2)));
    const r = (t, ph) => {
      const k = taper(t), wa = w0 * k + 0.0004, tb = th0 * k + 0.0004, c = Math.cos(ph + twist * t), sn = Math.sin(ph + twist * t);
      return broadA ? 1 / Math.sqrt((c / wa) ** 2 + (sn / tb) ** 2) : 1 / Math.sqrt((c / tb) ** 2 + (sn / wa) ** 2);
    };
    G.surf(range(0, 1, nAlong), range(0, TAU, 8), tubeSurface(C, r, FWD), (t, ph) => ({
      uv: ruv(R.hair, t, fold(ph, 0, TAU)), bones: bonesAt(t), rough: 0.5, thin: th0 * taper(t) + 0.0004,
      ao: tone * lerp(1 - shade, 1, smoothstep(0.0, 0.3, t)),     // (in the shade of the chin or brow at the root)
    }));
  };
  const stray = (P, r0, bonesAt, nAlong, tone = 1) => {
    G.surf(range(0, 1, nAlong), range(0, TAU, 5), tubeSurface(spline(P), t => lerp(r0, 0.0004, Math.pow(t, 0.8)), FWD), (t, ph) => ({
      uv: ruv(R.hair, t, fold(ph, 0, TAU)), bones: bonesAt(t), rough: 0.5, thin: lerp(r0, 0.0004, t), ao: tone * lerp(0.75, 1, smoothstep(0, 0.3, t)),
    }));
  };
  // brows: the long white brows of an old sage, from the ridge over each eye; each lock rises a little off the brow,
  // arcs out and back over the eye and falls past the cheek
  for (let si = 0; si < 2; si++) {
    const s = si === 0 ? 1 : -1, e = EYE[si];
    const bones = t => t < 0.1 ? [[B.HEAD, 1]] : [[B.HEAD, 1 - smoothstep(0.1, 0.4, t)], [B.BROW[si], 0.0001 + smoothstep(0.1, 0.4, t)]];
    const path = (f, len, j1, j2, j3) => {
      const r0 = V(e.x - s * lerp(0.022, 0.006, f), e.y + EYE_R * lerp(1.0, 1.15, f), e.z + lerp(0.02, -0.02, f));
      const sp = 0.01 + 0.014 * j3;
      return [r0, r0.clone().add(V(s * 0.016, 0.011, -0.012)), r0.clone().add(V(s * (0.038 + j1 * 0.006), 0.007, -0.036 + j2 * 0.006)),
        r0.clone().add(V(s * (0.054 + j2 * sp), -len * 0.45, -0.052 + j1 * sp)), r0.clone().add(V(s * (0.058 + j1 * sp * 1.4), -len, -0.058 + j2 * sp * 1.4))];
    };
    for (const f of [0.25, 0.7]) {
      lock(path(f, lerp(0.12, 0.15, f), (hrng() - 0.5) * 0.5, (hrng() - 0.5) * 0.5, 0.4), 0.0075, 0.0028, true, bones, N(14), { twist: 0.6 * (hrng() - 0.5), tone: 0.93 + 0.07 * hrng(), shade: 0.2 });
    }
    for (let k = 0; k < (q >= 0.6 ? 6 : 2); k++) stray(path(hrng(), lerp(0.1, 0.17, hrng()), hrng() - 0.5, hrng() - 0.5, hrng()), 0.0011, bones, N(12), 0.9 + 0.1 * hrng());
  }
  // the beard: locks from under the chin; they leave it forward and a little apart, then gather as they fall in a
  // gentle wave over the throat, the whole beard narrowing to a point; the outer locks shorter, laid over the inner
  {
    const bones = len => t => {
      // the jaw at the root, then down the chain of beard bones
      const L = t * len, b1 = 0.11, b2 = 0.24;
      if (L < 0.04) return [[B.JAW, 1]];
      if (L < b1) return [[B.JAW, 1 - smoothstep(0.04, b1, L)], [B.BEARD[0], 0.0001 + smoothstep(0.04, b1, L)]];
      if (L < b2) return [[B.BEARD[0], 1 - smoothstep(b1, b2, L)], [B.BEARD[1], 0.0001 + smoothstep(b1, b2, L)]];
      return [[B.BEARD[1], 1 - smoothstep(b2, 0.4, L)], [B.BEARD[2], 0.0001 + smoothstep(b2, 0.4, L)]];
    };
    const path = (x0, len, l, j1, j2) => {
      const mid = 1 - Math.min(1, Math.abs(x0) / 0.045), wave = 0.012 * Math.sin(l * 1.9 + 0.7);
      // (rooted under the jaw behind the chin: from the front the horn of the chin shows above the beard)
      const r0 = V(x0 * 1.15, 1.512 + 0.004 * mid, 0.372 + 0.03 * mid);
      return [r0, r0.clone().add(V(x0 * 0.2 + j1 * 0.006, -0.068, 0.03 + 0.006 * mid)),
        r0.clone().add(V(-x0 * 0.25 + wave + j2 * 0.006, -len * 0.42, 0.04 + 0.01 * mid)),
        r0.clone().add(V(-x0 * 0.62 - wave * 0.8 + j1 * 0.008, -len * 0.72, 0.03 + 0.008 * mid)),
        r0.clone().add(V(-x0 * 0.85 + wave * 1.1 + j2 * 0.01, -len, 0.035 + 0.01 * mid))];
    };
    const XS = [-0.03, -0.017, -0.005, 0.007, 0.019, 0.031];
    XS.forEach((x0, l) => {
      const len = lerp(0.46, 0.3, Math.min(1, Math.abs(x0) / 0.034)) * (0.94 + 0.06 * Math.sin(l * 3.7));
      lock(path(x0, len, l, hrng() - 0.5, hrng() - 0.5), lerp(0.018, 0.014, Math.abs(x0) / 0.034), 0.006, false, bones(len), N(16),
        { twist: 1.4 * (hrng() - 0.5), tone: 0.86 + 0.14 * hrng(), shade: 0.42 });
    });
    for (let k = 0; k < (q >= 0.6 ? 10 : 3); k++) {
      const x0 = lerp(-0.036, 0.036, hrng()), len = lerp(0.45, 0.28, Math.min(1, Math.abs(x0) / 0.036)) * (0.85 + 0.2 * hrng());
      stray(path(x0, len, k * 2.3, hrng() - 0.5, hrng() - 0.5), 0.0014, bones(len), N(14), 0.9 + 0.1 * hrng());
    }
  }

  // ---- forelimbs: shoulder -> wrist, then the hand with its claws ----
  for (let si = 0; si < 2; si++) {
    const s = si === 0 ? 1 : -1;
    const S = mirror(SHO, s), E = mirror(ELB, s), W = mirror(WRI, s);
    const P = [S.clone().add(V(-s * 0.17, -0.07, -0.04)), S, E, W];
    const Ls = [0, P[0].distanceTo(P[1]), P[1].distanceTo(P[2]), P[2].distanceTo(P[3])];
    const tot = Ls[1] + Ls[2] + Ls[3], tS = Ls[1] / tot, tE = (Ls[1] + Ls[2]) / tot;
    // a smooth path through the joints (the polyline would crease the skin at the elbow)
    const Cs = spline([P[0], P[0].clone().lerp(S, 0.6), S.clone().lerp(E, 0.5), E, E.clone().lerp(W, 0.5), W]);
    const r = (t, ph) => {
      const base = t < tS ? lerp(0.09, 0.105, t / tS) : t < tE ? lerp(0.105, 0.088, (t - tS) / (tE - tS)) : lerp(0.088, 0.074, (t - tE) / (1 - tE));
      // the forearm flattened front to back
      const flat = t > tE - 0.05 ? 1 - 0.22 * Math.pow(Math.cos(ph), 2) : 1;
      return base * flat;
    };
    G.surf(range(0, 1, N(28)), range(0, TAU, N(22)), tubeSurface(Cs, r, V(0, 0, 1)), (t, ph) => ({
      uv: ruv(R.arm, t, ((ph / TAU) % 1 + 1) % 1),
      bones: t < tS ? blendW(t, 0, tS, B.BODY, B.SHO[si]) : t < tE ? blendW(t, tE - 0.08, tE + 0.02, B.SHO[si], B.ELB[si]) : blendW(t, 0.95, 1.0, B.ELB[si], B.HAND[si]),
      rough: 0.74,
    }));
    // the hand: a broad, flattened mitten from the wrist, its palm in, four claws at the front
    const dir = W.clone().sub(E).normalize();
    const side = V(0, 0, 1).cross(dir).normalize().multiplyScalar(s);   // across the hand
    const nrm = dir.clone().cross(side).normalize();                        // its back (out from the palm)
    const handF = (u, ph, out) => {
      const t = clamp(u, 0, 1);
      const len = 0.13, wid = lerp(0.074, 0.08, Math.sin(Math.PI * Math.min(1, t * 1.3))) * (t > 0.8 ? Math.sqrt(Math.max(0, (1 - t) / 0.2)) * 0.6 + 0.4 : 1);
      const thk = lerp(0.055, 0.03, t) * (t > 0.85 ? Math.sqrt(Math.max(0, (1 - t) / 0.15)) * 0.7 + 0.3 : 1);
      return out.copy(W).addScaledVector(dir, len * t).addScaledVector(side, wid * Math.cos(ph)).addScaledVector(nrm, thk * Math.sin(ph));
    };
    G.surf(range(0, 1, N(12)), range(0, TAU, N(18)), handF, (u, ph) => ({ uv: ruv(R.hand, u, ((ph / TAU) % 1 + 1) % 1), bones: [[B.HAND[si], 1]], rough: 0.76 }),
      { flip: true, pole: (u, v, out) => out.copy(dir) });
    for (let k = 0; k < 4; k++) {
      const f = (k - 1.5) / 1.5;
      const base = W.clone().addScaledVector(dir, 0.112).addScaledVector(side, f * 0.055).addScaledVector(nrm, 0.008);
      const tip = base.clone().addScaledVector(dir, 0.06).addScaledVector(nrm, -0.03).addScaledVector(side, f * 0.008);
      const mid = base.clone().lerp(tip, 0.5).addScaledVector(nrm, 0.008);
      const Cc = spline([base, mid, tip]);
      G.surf(range(0, 1, N(7)), range(0, TAU, 8), tubeSurface(Cc, t => lerp(0.012, 0.0015, Math.pow(t, 0.9)), nrm), (t, ph) => ({
        uv: ruv(R.claw, t, ((ph / TAU) % 1 + 1) % 1), bones: [[B.HAND[si], 1]], rough: 0.35, thin: t > 0.6 ? 0.0012 : 0,
      }));
    }
  }

  // ---- hind legs: columns from the hips to round feet with four short nails ----
  for (let si = 0; si < 2; si++) {
    const s = si === 0 ? 1 : -1;
    const H = mirror(HIP, s), K = mirror(KNEE, s), A = mirror(ANK, s);
    const P0 = H.clone().add(V(-s * 0.07, 0.04, -0.01));
    const G0 = V(A.x, 0.004, A.z + 0.025);
    const Cs = spline([P0, H, H.clone().lerp(K, 0.5), K, K.clone().lerp(A, 0.5), A, A.clone().lerp(G0, 0.6), G0]);
    // round columns, the foot a broad flare to the ground (an elephant's)
    const r = t => t < 0.72 ? lerp(0.15, 0.125, smoothstep(0, 0.55, t)) : lerp(0.125, 0.152, Math.pow(smoothstep(0.72, 1, t), 2.2));
    G.surf(range(0, 1, N(26)), range(0, TAU, N(24)), tubeSurface(Cs, r, V(0, 0, 1)), (t, ph) => ({
      uv: ruv(t < 0.8 ? R.leg : R.foot, t < 0.8 ? t / 0.8 : (t - 0.8) / 0.2, ((ph / TAU) % 1 + 1) % 1),
      bones: t < 0.2 ? blendW(t, 0, 0.2, B.ROOT, B.HIP[si]) : t < 0.6 ? blendW(t, 0.5, 0.62, B.HIP[si], B.KNEE[si]) : blendW(t, 0.74, 0.84, B.KNEE[si], B.FOOT[si]),
      rough: 0.78, ao: t > 0.92 ? lerp(1, 0.8, smoothstep(0.92, 1, t)) : 1,
    }));
    // the sole
    const fc = G0;
    G.surf([0, 0.5, 1], range(0, TAU, N(24)), (u, ph, out) => out.set(fc.x + 0.152 * clamp(u, 0, 1) * Math.sin(ph), fc.y - 0.002, fc.z + 0.152 * clamp(u, 0, 1) * Math.cos(ph)),
      (u, ph) => ({ uv: ruv(R.foot, 0.98, ((ph / TAU) % 1 + 1) % 1), bones: [[B.FOOT[si], 1]], rough: 0.9, ao: 0.5 }), { flip: true, pole: (u, v, out) => out.set(0, -1, 0) });
    for (let k = 0; k < 5; k++) {
      const a = (k - 2) * 0.3;
      const base = V(fc.x + Math.sin(a) * 0.138, 0.03, fc.z + Math.cos(a) * 0.138);
      const tip = base.clone().add(V(Math.sin(a) * 0.026, -0.022, Math.cos(a) * 0.03));
      const Cc = spline([base, base.clone().lerp(tip, 0.5).add(V(0, 0.006, 0)), tip]);
      G.surf(range(0, 1, N(5)), range(0, TAU, 7), tubeSurface(Cc, t => lerp(0.018, 0.005, t)), (t, ph) => ({
        uv: ruv(R.claw, t, ((ph / TAU) % 1 + 1) % 1), bones: [[B.FOOT[si], 1]], rough: 0.4,
      }));
    }
  }

  // ---- the tail ----
  {
    const C = spline([TAIL0, TAIL0.clone().lerp(TAIL1, 0.5).add(V(0, -0.02, 0.01)), TAIL1]);
    G.surf(range(0, 1, N(10)), range(0, TAU, N(12)), tubeSurface(C, t => 0.065 * Math.pow(1 - t, 0.8) + 0.003), (t, ph) => ({
      uv: ruv(R.tail, t, ((ph / TAU) % 1 + 1) % 1), bones: blendW(t, 0, 0.3, B.BODY, B.TAIL), rough: 0.8,
    }));
  }
  return G.build();
}

/* ------------------------------------------------------------------ */
/* Painted atlas + relief                                               */
/* ------------------------------------------------------------------ */
const hex = h => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const mul3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const C = {
  shellA: hex('#38432a'), shellB: hex('#5b5631'), shellC: hex('#4a3f26'), areola: hex('#9c7b3e'), seam: hex('#1a1f13'),
  moss: hex('#4f6d2a'), mossL: hex('#86a246'), lichen: hex('#aab495'), lichenD: hex('#87907a'),
  plas: hex('#a08c5b'), plasD: hex('#7f6d43'), plasM: hex('#4f4129'), plasSeam: hex('#3f3422'),
  skin: hex('#5d6447'), skinD: hex('#40462e'), skinV: hex('#aaa37a'), skinP: hex('#787d5c'), crease: hex('#282c1d'), mouth: hex('#7a5c56'), mouthD: hex('#4a3533'),
  horn: hex('#3d3a2f'), hornL: hex('#7a7360'), hornT: hex('#b0a27c'),
  eyeD: hex('#0e0907'), iris: hex('#4a2f16'), irisL: hex('#86602e'),
  hair: hex('#ece8dc'), hairS: hex('#cfc9b8'), hairD: hex('#a39d8e'),
};
const hash1 = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const hash2 = (i, j) => hash1(i * 157.31 + j * 9.73);

/** the carapace's scutes as Voronoi cells round their areolae, in metres over the shell (x round, y down) */
const SCUTES = (() => {
  const S = [];
  const Wm = 0.465, La = 1.15;
  const X = (a, b) => (b - 0.5) * 1.42 * (caraW(a) / Wm), Y = a => a * La;
  // vertebrals down the middle, four costals each side, and the marginals round the rim
  for (const a of [0.1, 0.295, 0.5, 0.705, 0.9]) S.push({ x: 0, y: Y(a), kind: 0 });
  for (const s of [-1, 1]) for (const a of [0.17, 0.39, 0.61, 0.83]) S.push({ x: s * X(a, 0.5 + 0.205) , y: Y(a), kind: 1 });
  // marginals: a ring just inside the outline, ~12 cm apart
  const ring = [];
  for (let i = 0; i <= 40; i++) { const b = i / 40; ring.push([0.025, b]); }
  for (let i = 1; i < 40; i++) { const a = i / 40; ring.push([a, 0.975]); ring.push([a, 0.025]); }
  for (let i = 0; i <= 40; i++) { const b = i / 40; ring.push([0.975, b]); }
  const pts = ring.map(([a, b]) => ({ x: X(a, b), y: Y(a) }));
  for (const p of pts) if (!S.some(q => q.kind === 2 && Math.hypot(q.x - p.x, q.y - p.y) < 0.12)) S.push({ x: p.x, y: p.y, kind: 2 });
  S.forEach((s, i) => { s.h = hash1(i * 3.7 + 1); s.ax = s.x + (s.kind === 2 ? 0 : (hash1(i + 9) - 0.5) * 0.03); s.ay = s.y - (s.kind === 0 ? 0.035 : s.kind === 1 ? 0.03 : 0); });
  return { S, X, Y };
})();
/** the scutes worth testing near a point: for each cell of a grid, every seed that can be one of the two nearest to some
 *  point in it (within the cell middle's second-nearest distance plus the cell's diameter), so the painting tests a
 *  handful of seeds instead of all of them */
const SCUTE_GRID = (() => {
  const { S } = SCUTES, G = 0.08, h = G * Math.SQRT1_2;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const q of S) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y); }
  x0 -= 0.5; x1 += 0.5; y0 -= 0.5; y1 += 0.5;
  const nx = Math.ceil((x1 - x0) / G), ny = Math.ceil((y1 - y0) / G), cells = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const cx = x0 + (i + 0.5) * G, cy = y0 + (j + 0.5) * G;
    const ds = S.map(q => Math.hypot(cx - q.x, cy - q.y)).sort((a, b) => a - b), lim = ds[1] + 2 * h;
    cells.push(S.filter(q => Math.hypot(cx - q.x, cy - q.y) <= lim));
  }
  return (x, y) => { const i = Math.floor((x - x0) / G), j = Math.floor((y - y0) / G); return i >= 0 && j >= 0 && i < nx && j < ny ? cells[j * nx + i] : S; };
})();

/** an integer hash of a lattice cell, 0..1 (cheaper than a sine per call: the scales are painted over most of the atlas) */
const ihash = (x, y) => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const _sc = { k: 0, e: 0, id: 0 };
/** a scaly skin: cells about `size` m across (jittered grid), in metres u, v; { k (0 at a scale's middle .. 1 at its
 *  edge), e (distance to the crease), id } (one object, reused: read it before the next call) */
function scales(u, v, size) {
  const x = u / size, y = v / size, xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 81, d2 = 81, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = xi + i, cy = yi + j;
    const dx = x - (cx + 0.15 + 0.7 * ihash(cx, cy)), dy = y - (cy + 0.15 + 0.7 * ihash(cy + 7919, cx - 104729));
    const dd = dx * dx + dy * dy;
    if (dd < d1) { d2 = d1; d1 = dd; id = cx * 7919 + cy; } else if (dd < d2) d2 = dd;
  }
  d1 = Math.sqrt(d1); d2 = Math.sqrt(d2);
  _sc.k = clamp(2 * d1 / (d1 + d2), 0, 1); _sc.e = (d2 - d1) * size; _sc.id = id;
  return _sc;
}
/** skin colour and relief from scales; belly 0..1 (the paler underside) */
function skinLook(u, v, size, belly, n1, wrinkle = 0) {
  const s = scales(u, v, size), hv = hash1(s.id);
  let c = mix3(mix3(C.skin, C.skinP, 0.3 + 0.4 * hv), C.skinV, belly);
  c = mix3(c, mix3(C.skinP, C.skinV, belly), 0.25 * (1 - s.k));
  const crease = 1 - smoothstep(0.0, size * 0.16, s.e);
  c = mix3(c, mix3(C.crease, C.skinD, 0.35 + belly * 0.4), crease * 0.5);
  c = mul3(c, 0.94 + 0.12 * n1);
  let ht = 0.5 + 0.11 * (1 - s.k * s.k) - 0.1 * crease;
  if (wrinkle) { const w = Math.pow(Math.abs(Math.sin(v * wrinkle)), 6); c = mix3(c, C.crease, 0.25 * w); ht -= 0.08 * w; }
  return [c, ht];
}

const PAINT = {
  // b round (left edge -> right edge), down (1 at the top rim)
  cara(b, up, n1, n2) {
    const a = 1 - up, { X, Y } = SCUTES;
    const x = X(a, b), y = Y(a);
    let d1 = 9, d2 = 9, s1 = null;
    for (const s of SCUTE_GRID(x, y)) {
      const dd = Math.hypot(x - s.x, y - s.y);
      if (dd < d1) { d2 = d1; d1 = dd; s1 = s; } else if (dd < d2) d2 = dd;
    }
    const e = d2 - d1;                                 // ~ twice the distance to the seam
    const k = clamp(Math.hypot(x - s1.ax, y - s1.ay) / (Math.hypot(x - s1.ax, y - s1.ay) + e * 0.5 + 1e-4), 0, 1);
    const seam = 1 - smoothstep(0.004, 0.016, e);
    // growth rings round the areola, finer toward the seams
    const ring = Math.cos(k * 9 * TAU * (0.85 + 0.15 * s1.h));
    let c = mix3(mix3(C.shellA, C.shellB, s1.h), C.shellC, 0.35 * smoothstep(0.3, 1, k) * hash1(s1.h * 7));
    c = mix3(c, C.areola, (1 - smoothstep(0.0, 0.32, k)) * 0.75 * (0.6 + 0.4 * s1.h));
    c = mul3(c, 0.93 + 0.07 * ring * (1 - seam) + 0.08 * n1);
    // the old shell: moss low down and in the seams, lichen rosettes here and there higher up
    const mossN = n2 * 0.6 + n1 * 0.6 + smoothstep(0.45, 1.0, a) * 0.9 + seam * 0.5 - 0.75;
    const moss = smoothstep(0.0, 0.25, mossN);
    const lj = Math.floor(x / 0.09), lk = Math.floor(y / 0.09), lh = hash2(lj + 311, lk + 17);
    let lichen = 0;
    if (lh > 0.93 && a < 0.75) {
      const lx = (lj + 0.2 + 0.6 * hash1(lh * 13)) * 0.09, ly = (lk + 0.2 + 0.6 * hash1(lh * 29)) * 0.09, lr = Math.hypot(x - lx, y - ly);
      lichen = (1 - smoothstep(0.008, 0.016 + 0.008 * lh, lr)) * 0.8;
      if (lichen > 0) c = mix3(c, mix3(C.lichenD, C.lichen, 0.5 + 0.5 * Math.cos(lr * 400)), lichen * 0.85);
    }
    if (moss > 0) c = mix3(c, mix3(C.moss, C.mossL, 0.5 + 0.5 * n1), moss * 0.88);
    c = mix3(c, C.seam, seam * (1 - moss * 0.6));
    let ht = 0.5 + 0.13 * (1 - k * k) + 0.012 * ring * (1 - seam) - 0.2 * seam + 0.05 * moss * (0.5 + n2) + 0.03 * lichen;
    return [c, ht, seam * (1 - moss)];
  },
  // the rim: t round the outline, w from the outer edge in under the shell
  rim(t, w, n1) {
    const per = 23, f = (t * per) % 1, seam = 1 - smoothstep(0.02, 0.07, Math.min(f, 1 - f));
    let c = mix3(mix3(C.shellB, C.shellC, 0.5 + 0.5 * n1), C.plasD, smoothstep(0.4, 1, w) * 0.6);
    c = mix3(c, mul3(C.shellA, 1.25), (1 - smoothstep(0.0, 0.25, w)) * 0.5);   // worn along the edge
    c = mix3(c, C.seam, seam * 0.8);
    return [c, 0.5 - 0.15 * seam, seam];
  },
  // b across (left -> right), up (1 at the throat)
  plas(b, up, n1, n2) {
    const a = 1 - up, x = (b - 0.5) * 2;
    if (up > 0.965) return [mix3(C.plasD, C.plasSeam, 0.4), 0.45, 0];   // its rim
    const ax = Math.abs(x);
    // paired scutes: the midline and the transverse seams (curving up toward the sides)
    const rows = [0.0, 0.11, 0.3, 0.4, 0.7, 0.87, 1.0];
    const ya = a - 0.05 * ax * ax + 0.006 * n2;
    let r = 0; while (r < rows.length - 2 && ya > rows[r + 1]) r++;
    const dT = Math.min(Math.abs(ya - rows[r]), Math.abs(ya - rows[r + 1])) * 0.74;
    const dM = Math.abs(x * table(PLAS, a, 1) + 0.003 * Math.sin(a * 23));
    const dmin = Math.min(dT, dM);
    const seam = 1 - smoothstep(0.0018, 0.0065, dmin);
    const id = r * 2 + (x > 0 ? 1 : 0), h = hash1(id + 5.3);
    // growth rings parallel to the seams (the plastron's annuli)
    const ring = Math.cos(dmin * 300) * smoothstep(0.004, 0.012, dmin) * 0.6;
    let c = mix3(C.plas, C.plasD, 0.3 * h + 0.25 * smoothstep(0.6, 1, a) + 0.35 * smoothstep(0.55, 1, ax));
    // dark blotches along the seams on some scutes
    const blot = (h > 0.25 ? 1 : 0) * (1 - smoothstep(0.01, 0.05 + 0.025 * n2, dmin)) * smoothstep(-0.25, 0.25, n1);
    c = mix3(c, C.plasM, blot * 0.7);
    c = mul3(c, 0.97 + 0.02 * ring + 0.08 * n1 + 0.05 * n2);
    c = mix3(c, C.plasSeam, seam * 0.75);
    return [c, 0.5 + 0.06 * smoothstep(0.0, 0.05, dmin) + 0.008 * ring - 0.16 * seam, seam * 0.6];
  },
  bridge(u, v, n1) {
    const c = mix3(mix3(C.plasD, C.shellB, smoothstep(0.3, 0.9, u)), C.plasM, 0.15 + 0.1 * n1);
    const seam = 1 - smoothstep(0.02, 0.06, Math.abs(((v * 3) % 1) - 0.5) * 2 > 0.92 ? 0 : 1);
    return [mix3(c, C.plasSeam, seam * 0.6), 0.5, 0];
  },
  // round from the front (0) to the back (1), folded; up the body (seen at the shoulders and between the shell's edges)
  core(u, t, n1) { const belly = smoothstep(0.55, 0.05, u); return skinLook(u * 1.25, t * 1.1, 0.011, 0.25 + 0.4 * belly, n1); },
  // t along (the shell -> the head), v round it from the throat (0) to the nape (1), folded
  neck(t, v, n1, n2) {
    const belly = smoothstep(0.55, 0.1, v);   // the paler throat
    return skinLook(v * 0.33, t * 0.4 + 0.003 * n2, 0.008, belly * 0.75, n1, 240);
  },
  // along the head (at an even scale: its arc over the top); v round it (folded): the crown from the mouth line (0) to the top (0.8), then the palate
  head(u, v, n1) {
    const s = HEAD_ARC.inv(u * HEAD_ARC.total);
    const hw = table(HEAD, s, 1), hh = table(HEAD, s, 2) + 0.15 * table(HEAD, s, 3);
    const tip = smoothstep(0.95, 0.99, s);            // (at the very tip all of v meets in one point: paint it plain)
    const n = n1 * (1 - tip);
    if (v > 0.81) {
      // the palate: the horn of the beak's cutting edge round its rim, the mouth inside; behind the corners of the
      // mouth the underside of the skull (pale skin, like the throat)
      const e = clamp((v - 0.82) / 0.18, 0, 1), inner = smoothstep(0.24, 0.34, s);
      const m = mix3(mix3(C.mouth, C.crease, 0.45 + 0.25 * e), C.horn, 1 - smoothstep(0.25, 0.45, e));
      const [sk, sh] = skinLook(HEAD_ARC.at(s), e * 0.12, 0.006, 0.6, n);
      return [mix3(mix3(sk, m, inner), C.horn, tip), lerp(sh, 0.5, inner)];
    }
    const dm = 0.25 * clamp(v / 0.8, 0, 1);                                   // up from the mouth line, in turns
    const arcQ = 1.5708 * Math.sqrt((hw * hw + hh * hh) / 2);               // the crown's quarter section, in metres
    const um = HEAD_ARC.at(s), vm = (dm / 0.25) * arcQ;                       // metres along, and up from the mouth line
    let [c, ht] = skinLook(um, vm, s > 0.6 ? 0.0055 : 0.008, 0.05, n);
    // big plates on the crown (in a symmetric pattern, as the painting is folded at the midline)
    const top = smoothstep(0.05, 0.17, dm) * (1 - smoothstep(0.68, 0.8, s));
    if (top > 0) {
      const pl = scales(um, vm, 0.02);
      const seam = 1 - smoothstep(0.0, 0.0022, pl.e);
      const pc = mix3(mix3(C.skin, C.skinP, 0.35 + 0.3 * hash1(pl.id)), C.crease, seam * 0.8);
      c = mix3(c, pc, top); ht = lerp(ht, 0.52 + 0.06 * (1 - pl.k) - 0.12 * seam, top);
    }
    // two nostrils on top of the snout, just above the horn
    {
      const nd = Math.hypot(um - HEAD_ARC.at(0.968), (dm - 0.215) / 0.25 * arcQ);
      const nos = 1 - smoothstep(0.0022, 0.004, nd);
      c = mix3(c, C.crease, nos * 0.9); ht -= 0.12 * nos;
    }
    // the beak: a dark horn sheath from the mouth line up over the front of the snout, narrowing back along the mouth
    // to below the eye; smooth, and worn paler along its cutting edge
    const reach = beakReach(s);
    const beak = smoothstep(0.72, 0.8, s) * (1 - smoothstep(reach - 0.01, reach + 0.008, dm + 0.01 * n));
    if (beak > 0) {
      const bc = mix3(C.horn, C.hornL, 0.12 + 0.35 * (1 - smoothstep(0.0, 0.018, dm)) * (1 - tip) + 0.08 * n);
      c = mix3(c, bc, beak); ht = lerp(ht, 0.55 + 0.012 * Math.cos(s * 900) * (1 - tip), beak);   // (fine growth lines)
    }
    return [c, ht];
  },
  // along the jaw (the hinge -> the chin, at an even scale); v round it from the lip (0) to under the chin (1), folded
  jaw(u, v, n1) {
    const s = JAW_ARC.inv(u * JAW_ARC.total);
    if (s < 0.03) return [mix3(C.mouthD, C.crease, 0.4 + 0.3 * n1), 0.5];   // (the floor of the mouth)
    const tip = smoothstep(0.95, 0.995, s), n = n1 * (1 - tip);
    const lip = 0.5 * v;
    let [c, ht] = skinLook(JAW_ARC.at(s), lip * 0.29, 0.0065, 0.55 * smoothstep(0.25, 0.5, lip), n);
    // the lower beak's horn: along the lip, and over the whole chin at the front
    const reach = jawReach(s);
    const beak = 1 - smoothstep(reach - 0.025, reach + 0.015, lip + 0.02 * n);
    const bc = mix3(C.horn, C.hornL, 0.12 + 0.3 * (1 - smoothstep(0.0, 0.04, lip)) * (1 - tip) + 0.08 * n);
    c = mix3(c, bc, beak);
    return [c, lerp(ht, 0.55, beak)];
  },
  arm(t, ph, n1) {
    // big overlapping scales down the front of the forearm, small ones elsewhere
    const front = smoothstep(0.35, 0.1, Math.min(Math.abs(ph), Math.abs(1 - ph)));
    const big = front * smoothstep(0.42, 0.55, t);
    const small = skinLook(t * 0.75, ph * 0.5, 0.009, 0.15 * (1 - front), n1);
    if (big <= 0) return small;
    const sc = scales(t * 0.75, ph * 0.5, 0.026), hv = hash1(sc.id);
    const seam = 1 - smoothstep(0.0, 0.003, sc.e);
    let c = mix3(mix3(C.skinP, C.skinV, 0.25 + 0.3 * hv), C.crease, seam * 0.9);
    c = mul3(c, 0.92 + 0.1 * (1 - sc.k) + 0.06 * n1);
    const ht = 0.5 + 0.16 * (1 - sc.k * sc.k) - 0.18 * seam;
    return [mix3(small[0], c, big), lerp(small[1], ht, big)];
  },
  hand(u, ph, n1) { const [c, h] = skinLook(u * 0.12, ph * 0.3, 0.007, 0.25, n1); return [c, h]; },
  leg(t, ph, n1) { return skinLook(t * 0.6, ph * 0.65, 0.012, 0.1, n1); },
  foot(u, ph, n1) { const [c, h] = skinLook(u * 0.15, ph * 0.7, 0.01, 0.25, n1); return [mul3(c, lerp(1, 0.7, smoothstep(0.75, 1, u))), h]; },
  tail(t, ph, n1) { return skinLook(t * 0.2, ph * 0.3, 0.008, 0.2, n1); },
  claw(t, ph, n1) {
    const c = mix3(C.horn, C.hornT, smoothstep(0.35, 1, t) * 0.85 + 0.05 * n1);
    return [mul3(c, 0.93 + 0.07 * Math.cos(ph * TAU * 5 + t * 8)), 0.5];
  },
  // t along a lock, v round it (folded): fine strands along it, light crests and shadowed grooves that waver a
  // little; the tips a touch greyer
  hair(t, v, n1, n2) {
    const g = 0.5 + 0.5 * Math.cos(v * Math.PI * 13 + 1.1 * Math.sin(t * 11 + v * 5) + 2 * n2);
    const g2 = 0.5 + 0.5 * Math.cos(v * Math.PI * 29 + 3 * n1);
    let c = mix3(C.hairS, C.hair, 0.2 + 0.55 * g + 0.25 * g2);
    c = mix3(c, C.hairD, 0.5 * Math.pow((1 - g) * (1 - 0.5 * g2), 1.5));
    return [mul3(c, 1 - 0.08 * smoothstep(0.75, 1, t)), 0.5 + 0.16 * g + 0.06 * g2];
  },
  eye(u, v) {
    const x = u - 0.5, y = v - 0.5, r = Math.hypot(x, y) / 0.48;
    let c = C.eyeD;
    const iris = smoothstep(0.66, 0.52, r) * smoothstep(0.22, 0.3, r);
    const ang = Math.atan2(y, x);
    c = mix3(c, mix3(C.iris, C.irisL, smoothstep(0.3, 0.6, r) * 0.7 + 0.15 * Math.cos(ang * 23)), iris * 0.8);
    return [c, 0.5];
  },
  lid(u, v, n1) {
    const upper = v > 0.5, w = upper ? (v - 0.5) * 2 : v * 2;
    let [c, h] = skinLook(u * 0.06, w * 0.02, 0.0035, 0.05, n1, 0);
    c = mix3(c, C.crease, (1 - smoothstep(0.0, 0.25, w)) * 0.5);   // the lid's rim
    return [c, h - 0.08 * Math.pow(Math.abs(Math.sin(w * 18)), 4)];
  },
};

const N2_REGIONS = new Set(['cara', 'plas', 'neck', 'hair']);
function paintTortoiseAtlas(seed = 7) {
  const W = ATLAS_W, H = ATLAS_H;
  const noise = createNoise(seed);
  const cc = makeCanvas(W, H), hc = makeCanvas(W, H);
  const g = cc.getContext('2d'), gh = hc.getContext('2d');
  const img = g.createImageData(W, H), himg = gh.createImageData(W, H);
  const px = img.data, hp = himg.data;
  const GW = W / 2, GH = H / 2, glow = new Uint8Array(GW * GH * 4);
  // (the atlas's unused corners stay skin coloured, flat: nothing samples them)
  const sk = C.skin.map(c => clamp(c, 0, 1) * 255);
  for (let o = 0; o < W * H * 4; o += 4) { px[o] = sk[0]; px[o + 1] = sk[1]; px[o + 2] = sk[2]; px[o + 3] = 255; hp[o] = hp[o + 1] = hp[o + 2] = 127.5; hp[o + 3] = 255; }
  // each region over its own pixels (the second noise only where it is used)
  for (const [name, r] of Object.entries(R)) {
    const paint = PAINT[name], useN2 = N2_REGIONS.has(name);
    const xa = Math.round(r[0] * W), xb = Math.round(r[2] * W), ya = Math.round((1 - r[3]) * H), yb = Math.round((1 - r[1]) * H);
    for (let y = ya; y < yb; y++) {
      const v = 1 - (y + 0.5) / H, b = clamp((v - r[1]) / (r[3] - r[1]), 0, 1);
      for (let x = xa; x < xb; x++) {
        const u = (x + 0.5) / W, a = clamp((u - r[0]) / (r[2] - r[0]), 0, 1);
        const n1 = noise.noise2(x * 0.03, y * 0.03) * 0.5 + noise.noise2(x * 0.11, y * 0.11) * 0.25;
        const n2 = useN2 ? noise.noise2(x * 0.05 + 31.7, y * 0.05 - 12.3) : 0;
        const res = paint(a, b, n1, n2);
        const col = res[0], gl = res[2] || 0;
        const o = (y * W + x) * 4;
        px[o] = clamp(col[0], 0, 1) * 255; px[o + 1] = clamp(col[1], 0, 1) * 255; px[o + 2] = clamp(col[2], 0, 1) * 255;
        hp[o] = hp[o + 1] = hp[o + 2] = clamp(res[1], 0, 1) * 255;
        if (gl > 0 && (x & 1) === 0 && (y & 1) === 0) { const go = ((y >> 1) * GW + (x >> 1)) * 4; glow[go] = glow[go + 1] = glow[go + 2] = Math.round(clamp(gl, 0, 1) * 255); }
      }
    }
  }
  g.putImageData(img, 0, 0); gh.putImageData(himg, 0, 0);
  const map = new THREE.CanvasTexture(cc);
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const normalMap = normalMapFromHeight(hc, 3.0, false);
  normalMap.anisotropy = 4;
  // the seams that glow softly at night (the residents' shells do the same), at half the atlas's resolution
  for (let i = 3; i < glow.length; i += 4) glow[i] = 255;
  const glowMap = new THREE.DataTexture(glow, GW, GH, THREE.RGBAFormat);
  glowMap.flipY = true; glowMap.magFilter = THREE.LinearFilter; glowMap.minFilter = THREE.LinearMipmapLinearFilter; glowMap.generateMipmaps = true;
  glowMap.needsUpdate = true;
  return { map, normalMap, glowMap };
}

/* ------------------------------------------------------------------ */
/* Material                                                             */
/* ------------------------------------------------------------------ */
function tortoiseMaterial(tex, U, shared = null) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.9, 0.9),
    vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.75,
  });
  const opts = {
    key: 'master',
    uniforms: Object.assign({ uGlowMap: { value: tex.glowMap } }, U),
    vertexHeader: 'attribute float aThin; attribute float aRough; varying float vMRough; uniform float uMPx;',
    fragmentHeader: 'varying float vMRough; uniform vec3 uMRim; uniform float uSeamGlow; uniform sampler2D uGlowMap;',
    vertex: {
      '#include <skinning_vertex>': /* glsl */`$&
        vMRough = aRough;
        // thin parts (the strands of beard and brow, the claws) keep at least ~1.6 px on screen instead of breaking
        // into crawling slivers at a distance
        if (aThin > 0.0) {
          vec4 mmv = modelViewMatrix * vec4(transformed, 1.0);
          float minR = 0.8 * max(-mmv.z, 0.05) / uMPx;
          transformed += normalize(objectNormal + vec3(1e-6)) * max(minR - aThin, 0.0);
        }`,
    },
    fragment: {
      '#include <roughnessmap_fragment>': '$&\n roughnessFactor = vMRough;',
      '#include <emissivemap_fragment>': /* glsl */`$&
        { float mr = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += uMRim * diffuseColor.rgb * (mr * mr * mr);
          // the scute seams glow a soft gold at night
          totalEmissiveRadiance += vec3(1.0, 0.72, 0.32) * texture2D(uGlowMap, vMapUv).r * uSeamGlow; }`,
    },
  };
  if (shared) return patchStd(mat, shared, opts);
  // (alone, for the test viewer: without the cloud sea's fog and lighting)
  return patchStdLite(mat, opts);
}
function patchStdLite(mat, opts) {
  const uniforms = opts.uniforms;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = opts.vertexHeader + '\n' + sh.vertexShader;
    sh.fragmentShader = opts.fragmentHeader + '\n' + sh.fragmentShader;
    for (const [k, v] of Object.entries(opts.vertex)) sh.vertexShader = sh.vertexShader.replace(k, v.replace('$&', k));
    for (const [k, v] of Object.entries(opts.fragment)) sh.fragmentShader = sh.fragmentShader.replace(k, v.replace('$&', k));
  };
  mat.customProgramCacheKey = () => 'master-lite';
  return mat;
}
/* ------------------------------------------------------------------ */
/* The master on his terrace                                            */
/* ------------------------------------------------------------------ */
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const near = (target, cur) => cur + wrap(target - cur);
const ease = t => t * t * (3 - 2 * t);
const _a = V(0, 0, 0), _b = V(0, 0, 0), _c = V(0, 0, 0), _p = V(0, 0, 0), _t = V(0, 0, 0), _n = V(0, 0, 0), _pole = V(0, 0, 0);
const _PR = V(0, 0, 0), _PB = V(0, 0, 0), _E = V(0, 0, 0), _W = V(0, 0, 0), _u = V(0, 0, 0), _bb = V(0, 0, 0), _sx = V(0, 0, 0), _sy = V(0, 0, 0), _x1 = V(0, 0, 0), _x2 = V(0, 0, 0);
const _v2 = new THREE.Vector2();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qR = new THREE.Quaternion(), _qB = new THREE.Quaternion(), _qU = new THREE.Quaternion();
const _qN1 = new THREE.Quaternion(), _qN2 = new THREE.Quaternion(), _qH = new THREE.Quaternion(), _qJ = new THREE.Quaternion(), _qF = new THREE.Quaternion();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _e = new THREE.Euler();
const AX = V(1, 0, 0), AY = V(0, 1, 0), AZ = V(0, 0, 1);

/** Two-bone IK: from S toward T over segments L1 and L2, bending toward the pole direction P. Writes the middle joint
 *  into E, the reached end into W and the bend's normal (u x b) into N. */
function ik2(S, T, L1, L2, P, E, W, N) {
  const u = _u.subVectors(T, S);
  let d = u.length();
  if (d < 1e-6) u.set(0, -1, 0); else u.divideScalar(d);
  d = clamp(d, Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
  const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  const b = _bb.copy(P).addScaledVector(u, -P.dot(u));
  if (b.lengthSq() < 1e-10) b.set(0, 0, 1).addScaledVector(u, -u.z);
  b.normalize();
  E.copy(S).addScaledVector(u, a).addScaledVector(b, h);
  W.copy(S).addScaledVector(u, d);
  N.crossVectors(u, b).normalize();
}
/** the rotation taking a bind segment (direction xb, bent about the normal nb) to a posed one (x, bent about n) */
function segQuat(xb, nb, x, n, out) {
  _m1.makeBasis(x, _sx.crossVectors(n, x), n);
  _m2.makeBasis(xb, _sy.crossVectors(nb, xb), nb).transpose();
  return out.setFromRotationMatrix(_m1.multiply(_m2));
}
/** the limbs at bind: segment lengths, directions and the bend's normal, each side */
const LIMB = (() => {
  const mk = (A, Bj, Cj, s) => {
    const a = mirror(A, s), b = mirror(Bj, s), c = mirror(Cj, s);
    const u = c.clone().sub(a).normalize(), bend = b.clone().sub(a);
    bend.addScaledVector(u, -bend.dot(u)).normalize();
    return { L1: a.distanceTo(b), L2: b.distanceTo(c), x1: b.clone().sub(a).normalize(), x2: c.clone().sub(b).normalize(), n: u.clone().cross(bend).normalize() };
  };
  return { arm: [mk(SHO, ELB, WRI, 1), mk(SHO, ELB, WRI, -1)], leg: [mk(HIP, KNEE, ANK, 1), mk(HIP, KNEE, ANK, -1)] };
})();
/** the upper lids close by turning about the eye's forward axis: which way, each side */
const LID_AXIS = [], LID_SIGN = [];
for (let si = 0; si < 2; si++) {
  const s = si === 0 ? 1 : -1, out0 = EYE_N[si];
  const ax = V(0, 0, 1).addScaledVector(out0, -out0.z).normalize(), ay = out0.clone().cross(ax).multiplyScalar(s).normalize();
  if (ay.y < 0) ay.negate();
  const r = ay.clone().multiplyScalar(Math.sin(0.3)).addScaledVector(out0, Math.cos(0.3));
  const r2 = r.clone().applyAxisAngle(ax, 0.3);
  LID_AXIS.push(ax); LID_SIGN.push(r2.dot(ay) < r.dot(ay) ? 1 : -1);
}

const GSCALE = 1.2;                               // (his size in the world: a head taller than his disciples)
const FOOT_X = ANK.x, FOOT_Z = ANK.z, ANK_H = ANK.y - 0.002;
// his forms, one after another (each eases in and out through standing at rest)
const FORMS = [
  { kind: 'open', dur: 19, period: 9.5 },     // 起势: the arms float up to the shoulders and sink, the knees with them
  { kind: 'cloud', dur: 34, period: 11.3 },   // 云手: the hands circle before him half a turn apart, the waist turning
  { kind: 'ball', dur: 21, period: 10.5 },    // 抱球: holding a ball before his belly and turning it over
];
const REST_HAND = [V(0.45, 0.76, 0.23), V(-0.45, 0.76, 0.23)];
// the great circle when a lesson is learnt: both arms sweep out, up and round and come together on a ball of qi
const BALL_C = V(0.005, 1.11, 0.5);               // (the ball's middle, in front of his chest)
// (each ends where that hand takes hold of the ball: the upper one over it, the lower one under it)
const CIRCLE = [
  new THREE.CatmullRomCurve3([V(0.45, 0.76, 0.23), V(0.6, 1.06, 0.22), V(0.44, 1.46, 0.3), V(0.14, 1.48, 0.4), V(BALL_C.x, BALL_C.y + 0.11, BALL_C.z - 0.03)]),
  new THREE.CatmullRomCurve3([V(-0.45, 0.76, 0.23), V(-0.6, 1.06, 0.22), V(-0.44, 1.42, 0.3), V(-0.16, 1.3, 0.42), V(BALL_C.x - 0.02, BALL_C.y - 0.11, BALL_C.z - 0.04)]),
];
const TICK = 1 / 120;                              // (his own clock's step)

const newPose = () => ({ h: [V(0, 0, 0), V(0, 0, 0)], roll: [0, 0], flex: [0, 0], sway: 0, sink: 0, waist: 0, lean: 0, hy: 0, hp: 0, hr: 0 });
function copyPose(d, s) {
  d.h[0].copy(s.h[0]); d.h[1].copy(s.h[1]); d.roll[0] = s.roll[0]; d.roll[1] = s.roll[1]; d.flex[0] = s.flex[0]; d.flex[1] = s.flex[1];
  d.sway = s.sway; d.sink = s.sink; d.waist = s.waist; d.lean = s.lean; d.hy = s.hy; d.hp = s.hp; d.hr = s.hr;
  return d;
}
function mixPose(d, s, w) {
  if (w <= 0) return d;
  d.h[0].lerp(s.h[0], w); d.h[1].lerp(s.h[1], w);
  for (let k = 0; k < 2; k++) { d.roll[k] = lerp(d.roll[k], s.roll[k], w); d.flex[k] = lerp(d.flex[k], s.flex[k], w); }
  d.sway = lerp(d.sway, s.sway, w); d.sink = lerp(d.sink, s.sink, w); d.waist = lerp(d.waist, s.waist, w); d.lean = lerp(d.lean, s.lean, w);
  d.hy = lerp(d.hy, s.hy, w); d.hp = lerp(d.hp, s.hp, w); d.hr = lerp(d.hr, s.hr, w);
  return d;
}
function restPose(d) {
  d.h[0].copy(REST_HAND[0]); d.h[1].copy(REST_HAND[1]);
  d.roll[0] = d.roll[1] = 0; d.flex[0] = d.flex[1] = 0.15;
  d.sway = 0; d.sink = 0.012; d.waist = 0; d.lean = 0.03; d.hy = 0; d.hp = 0.06; d.hr = 0;
  return d;
}

export class TortoiseGuardian {
  /**
   * ctx: { env, scene, camera, shared (the cloud sea's shading), world (its ground, obstacles and the terrace's spots),
   * fx (sparkles), rng, night() -> 0..1 }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.env = ctx.env;
    this.rng = ctx.rng;
    this.geo = buildTortoiseGeometry(this.env.q);
    this.tex = paintTortoiseAtlas((this.env.seed % 997) + 23);
    this.U = { uMPx: { value: 900 }, uMRim: { value: new THREE.Color(0.16, 0.2, 0.17) }, uSeamGlow: { value: 0 } };
    this.mat = tortoiseMaterial(this.tex, this.U, ctx.shared);
    const { mesh, bones } = makeTortoiseMesh(this.geo, this.mat);
    mesh.frustumCulled = false;
    mesh.castShadow = !!this.env.shadows;
    mesh.name = 'tortoiseGuardian';
    this.mesh = mesh; this.bones = bones;
    this.obj = new THREE.Group();
    this.obj.name = 'tortoise';
    this.obj.add(mesh);
    this.obj.scale.setScalar(GSCALE);
    ctx.scene.add(this.obj);
    // his place: on the jade terrace, facing out from the peach tree
    const spot = ctx.world.masterSpot || ctx.world.taijiSpot(0);
    this.home = spot.p.clone(); this.homeYaw = spot.yaw;
    this.obj.position.copy(this.home);
    // the qi he gathers when a lesson is learnt
    this.orbTex = glowSprite(64);
    this.orbMat = new THREE.SpriteMaterial({ map: this.orbTex, color: new THREE.Color(1, 0.8, 0.45), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
    this.orb = new THREE.Sprite(this.orbMat);
    this.orb.visible = false; this.orb.renderOrder = 6; this.orb.frustumCulled = false;
    ctx.scene.add(this.orb);
    this.orbPos = V(0, 0, 0); this.orbFree = V(0, 0, 0);
    // state
    this.t = 0; this.time = 0;
    this.yawS = new Spring(this.homeYaw); this.faceYaw = this.homeYaw;
    this.wTai = new Spring(1);                       // 1 at his practice, 0 standing to talk
    this.hy = new Spring(0); this.hp = new Spring(0); this.hr = new Spring(0); this.jaw = new Spring(0);
    this.lagY = new Spring(this.homeYaw); this.lagP = new Spring(0);   // the beard and brows lag the head a little
    this.talking = false; this.speaking = false; this.summoned = false;
    this.greet = null;                               // { t }: his bow to whoever has come
    this.mood = null;                                // { kind, t }: a reaction under way
    this.formI = 0; this.formT = 6;
    this.blinkWait = 2.5; this.blinkT = -1;
    this.spkPh = 0;
    this.stepWait = 0;
    this.ff = false;                                 // test only: fast-forwarding (no sounds)
    this.rngBlink = this.rng.fork('blink');
    this.feet = [0, 1].map(k => ({ p: this.footHome(k, this.homeYaw, V(0, 0, 0)), yaw: this.homeYaw, h: 0, lift: null }));
    this.P = newPose(); this._pB = newPose(); this._pX = newPose();
    this.palm = [V(0, 0, 0), V(0, 0, 0)];            // (object space, after posing)
    this.headPt = V(0, 0.05, 0.12);                  // the middle of his head, in the head bone's frame
    this.pose(0);
  }

  /* ---------- feet: planted on the stone, stepping round when he turns ---------- */
  footHome(k, yaw, out) {
    const s = k === 0 ? 1 : -1, x = s * FOOT_X * GSCALE, z = FOOT_Z * GSCALE;
    return out.set(this.home.x + Math.cos(yaw) * x + Math.sin(yaw) * z, this.home.y, this.home.z - Math.sin(yaw) * x + Math.cos(yaw) * z);
  }
  stepFeet(dt) {
    const yaw = this.yawS.x;
    this.stepWait -= dt;
    const lifting = this.feet.find(f => f.lift);
    if (lifting) {
      const L = lifting.lift;
      L.t += dt;
      const k = clamp(L.t / L.dur, 0, 1), e = ease(k);
      lifting.p.lerpVectors(L.from, L.to, e);
      lifting.yaw = lerp(L.yaw0, L.yaw1, e);
      lifting.h = 0.06 * Math.sin(Math.PI * k);
      if (k >= 1) { lifting.lift = null; lifting.h = 0; this.stepWait = 0.1; }
      return;
    }
    // a foot steps once the body has turned off it: the one left farther behind first, one at a time
    let worst = -1, we = 0;
    for (let k = 0; k < 2; k++) {
      const f = this.feet[k], h = this.footHome(k, yaw, _a);
      const e = Math.hypot(f.p.x - h.x, f.p.z - h.z) / GSCALE + 0.12 * Math.abs(wrap(f.yaw - yaw));
      if (e > we) { we = e; worst = k; }
    }
    if (we > 0.045 && this.stepWait <= 0) {
      const f = this.feet[worst];
      // (leading the turn a little, so the steps keep up with it)
      const yaw1 = yaw + clamp(wrap(this.faceYaw - yaw), -0.3, 0.3);
      f.lift = { t: 0, dur: 0.55, from: f.p.clone(), to: this.footHome(worst, yaw1, V(0, 0, 0)), yaw0: f.yaw, yaw1: near(yaw1, f.yaw) };
    }
  }

  /* ---------- lessons (lib/guide.js): he is always here; called, he turns to whoever has come and bows ---------- */
  lessonState() { return 'ready'; }
  summon() { this.summoned = true; }
  talk(on) {
    const was = this.talking;
    this.talking = !!on;
    if (this.talking) { this.summoned = true; if (!was) this.greet = { t: 0, started: false }; } else this.speaking = false;
  }
  /** 'yes' (a right answer: a slow nod and a stroke of the beard), 'no' (a wrong one: a slow shake of the head and a
   *  raised palm) or 'done' (the great circle, the ball of qi, a bow) */
  react(kind) {
    this.mood = { kind, t: 0, burst: false };
    this.greet = null;
  }
  release() { this.summoned = false; this.talking = false; this.speaking = false; }

  /* ---------- every frame ---------- */
  update(dt, time) {
    this.time = time;
    if (!(dt > 0)) return;
    this.t += dt;
    const cam = this.ctx.camera, night = this.ctx.night ? this.ctx.night() : 0;
    this.U.uMPx.value = 0.5 * this.env.renderer.getDrawingBufferSize(_v2).y * cam.projectionMatrix.elements[5];
    this.U.uMRim.value.setRGB(0.16, 0.2, 0.17).multiplyScalar(lerp(1, 0.35, night));
    this.U.uSeamGlow.value = 0.9 * smoothstep(0.25, 0.8, night);
    // what goes on by his own clock (turning and stepping, his forms, blinks, the bow, the reactions' timing) runs in
    // fixed ticks: a step, a blink or a bow then starts at the same moment at any frame rate
    this.acc = Math.min((this.acc || 0) + dt, 0.5);
    while (this.acc >= TICK * 0.999) { this.acc -= TICK; this.tick(TICK, cam); }
    this.obj.rotation.set(0, this.yawS.x, 0);
    this.obj.updateMatrixWorld(true);
    this.targets(dt, cam);
    this.pose(dt);
    this.updateOrb();
  }
  tick(dt, cam) {
    // facing: the way he practises, or whoever talks with him (he turns on the spot, stepping round); a reaction under
    // way keeps him turned as he is
    const toCam = Math.atan2(cam.position.x - this.home.x, cam.position.z - this.home.z);
    if (this.talking) this.faceYaw = toCam; else if (!this.mood) this.faceYaw = this.homeYaw;
    this.yawS.step(near(this.faceYaw, this.yawS.x), this.talking ? 1.5 : 0.7, dt);
    this.stepFeet(dt);
    // his forms go on (blended away while he talks)
    this.formT += dt;
    if (this.formT > FORMS[this.formI].dur) { this.formT -= FORMS[this.formI].dur; this.formI = (this.formI + 1) % FORMS.length; }
    this.wTai.step(this.talking || this.mood ? 0 : 1, 1.3, dt);
    // blinks (the upper lids), now and then
    if (this.blinkT >= 0) { this.blinkT += dt; if (this.blinkT > 0.24) this.blinkT = -1; }
    else if ((this.blinkWait -= dt) <= 0) { this.blinkT = 0; this.blinkWait = this.rngBlink.range(2.2, 6.5); }
    const g = this.greet;
    if (g) {
      // the bow starts once he has turned to them (and, started, runs through)
      if (!g.started) g.started = Math.abs(wrap(this.faceYaw - this.yawS.x)) < 0.25;
      if (g.started) { g.t += dt; if (g.t > 2.6) this.greet = null; }
    }
    const m = this.mood;
    if (m) {
      m.t += dt;
      const end = m.kind === 'done' ? 8.2 : m.kind === 'yes' ? 2.6 : 2.4;
      if (m.kind === 'done' && !m.burst && m.t > 5.7) {
        m.burst = true;
        this.ctx.fx && this.ctx.fx.sparkles.burst(this.orbPos, new THREE.Color(2.4, 1.8, 1.0), 44, 1.5, 0.3, 1.5);
        if (!this.ff) this.env.sfx('chime');
      }
      if (m.t > end) this.mood = null;
    }
    // speech: the beak works in syllables
    let jaw = 0;
    if (this.speaking) { this.spkPh += dt * 9; jaw = 0.03 + 0.15 * Math.pow(Math.max(0, Math.sin(this.spkPh)), 0.7); }
    this.jaw.step(jaw, 20, dt);
  }

  /** the pose he is after (body-local hand targets and the body's sway, sink, turn and lean; the head's turn) */
  targets(dt, cam) {
    const P = restPose(this.P), X = this._pX;
    // 1. at his practice
    const wT = clamp(this.wTai.x, 0, 1);
    if (wT > 0.001) mixPose(P, this.taichi(this._pB), wT);
    // 2. standing to talk: hands folded before his belly, looking at whoever has come
    if (wT < 0.999) {
      restPose(X);
      X.h[0].set(0.14, 0.93, 0.38); X.h[1].set(-0.12, 0.95, 0.39); X.roll[0] = 0.9; X.roll[1] = -0.9; X.flex[0] = X.flex[1] = 0.25;
      X.sink = 0.02; X.lean = 0.04;
      X.sway = 0.004 * Math.sin(this.t * 0.6);
      mixPose(P, X, 1 - wT);
    }
    // 3. his bow to whoever has come (once he has turned to them)
    const g = this.greet;
    if (g && g.started) {
      const e = envl(g.t, 2.4, 0.6);
      if (e > 0) mixPose(P, this.bowPose(X), e);
    }
    // 4. reactions
    const m = this.mood;
    let nod = 0, shake = 0;
    if (m) {
      if (m.kind === 'yes') {
        // a slow nod, and a stroke down the beard
        nod = 0.15 * Math.sin(m.t * TAU * 0.85) * envl(m.t, 2.4, 0.3);
        const e = envl(m.t, 2.5, 0.45);
        copyPose(X, P);
        const k = smoothstep(0.75, 1.75, m.t);
        X.h[1].set(lerp(-0.075, -0.05, k), lerp(1.23, 1.04, k), lerp(0.475, 0.46, k)); X.roll[1] = -1.3; X.flex[1] = 0.3;
        mixPose(P, X, e);
      } else if (m.kind === 'no') {
        // a slow shake of the head, a palm raised: not quite
        shake = 0.2 * Math.sin(m.t * TAU * 1.0) * envl(m.t, 2.2, 0.3);
        const e = envl(m.t, 2.3, 0.45);
        copyPose(X, P);
        X.h[0].set(0.2, 1.18, 0.46); X.roll[0] = -0.4; X.flex[0] = -0.5;
        mixPose(P, X, e);
      } else if (m.kind === 'done') mixPose(P, this.circlePose(X, m.t), envl(m.t, 8.2, 0.5));
    }
    // the head: at his practice it follows his hands (the forms say how); talking, it turns to the camera
    if (wT < 0.999) {
      const hx = this.home.x, hz = this.home.z, hyW = this.home.y + 1.6 * GSCALE;
      const dist = Math.hypot(cam.position.x - hx, cam.position.z - hz);
      const lookY = clamp(wrap(Math.atan2(cam.position.x - hx, cam.position.z - hz) - this.yawS.x), -0.8, 0.8);
      const lookP = clamp(Math.atan2(hyW - cam.position.y, Math.max(dist, 0.5)), -0.35, 0.45);
      P.hy = lerp(P.hy, P.hy + lookY, 1 - wT); P.hp = lerp(P.hp, P.hp + lookP * 0.8, 1 - wT);
    }
    if (this.speaking) P.hp += 0.025 * Math.sin(this.spkPh * 0.5);
    this.hy.step(P.hy, 5, dt); this.hp.step(P.hp, 5, dt); this.hr.step(P.hr, 4, dt);
    this.nod = nod; this.shake = shake;
  }
  /** his tai chi now (into d) */
  taichi(d) {
    restPose(d);
    const F = FORMS[this.formI], T = this.formT;
    const fb = smoothstep(0, 3, T) * smoothstep(F.dur, F.dur - 3, T);
    if (fb <= 0) return d;
    const ph = T / F.period * TAU, X = this._pX;
    copyPose(X, d);
    if (F.kind === 'open') {
      // the arms float up before him to the shoulders, palms down, and sink again as the knees bend
      const o = 0.5 - 0.5 * Math.cos(ph);
      for (let k = 0; k < 2; k++) {
        const s = k === 0 ? 1 : -1;
        X.h[k].set(s * 0.25, lerp(0.86, 1.19, o), lerp(0.36, 0.5, o)); X.roll[k] = s * lerp(0.6, 1.2, o); X.flex[k] = lerp(0.1, -0.25, o);
      }
      X.sink = 0.02 + 0.05 * (1 - o); X.lean = 0.02; X.hp = 0.04 - 0.06 * o;
    } else if (F.kind === 'cloud') {
      // cloud hands: each hand turns a slow vertical circle before him, half a turn behind the other; the waist turns
      // toward the upper hand, the weight shifts with it and the eyes follow it
      for (let k = 0; k < 2; k++) {
        const s = k === 0 ? 1 : -1, a = ph + (k === 0 ? 0 : Math.PI);
        X.h[k].set(s * 0.2 + 0.15 * Math.cos(a), 1.03 + 0.16 * Math.sin(a), 0.4 + 0.04 * Math.sin(a));
        X.roll[k] = s * (0.9 + 0.5 * Math.sin(a)); X.flex[k] = 0.15;
      }
      X.waist = 0.2 * Math.cos(ph); X.sway = 0.035 * Math.cos(ph);
      X.sink = 0.045 + 0.012 * (0.5 - 0.5 * Math.cos(2 * ph));
      X.hy = 0.26 * Math.cos(ph); X.hp = 0.02;
    } else {
      // holding a ball before his belly, the hands turning round it (the upper one comes down, the lower one up)
      for (let k = 0; k < 2; k++) {
        const s = k === 0 ? 1 : -1, a = ph + (k === 0 ? 0 : Math.PI);
        X.h[k].set(0.02 + s * 0.04 + 0.11 * Math.cos(a), 1.0 + 0.14 * Math.sin(a), 0.43);
        X.roll[k] = s * (1.0 + 0.9 * Math.sin(a)); X.flex[k] = 0.2;
      }
      X.waist = 0.16 * Math.sin(ph); X.sway = 0.025 * Math.sin(ph); X.sink = 0.04; X.hp = 0.14; X.hy = 0.1 * Math.sin(ph);
    }
    return mixPose(d, X, fb);
  }
  /** his bow: the right fist in the left palm before his chest, bending from the hips, eyes down */
  bowPose(d) {
    restPose(d);
    d.h[0].set(0.065, 1.13, 0.44); d.h[1].set(-0.035, 1.12, 0.45);
    d.roll[0] = 1.4; d.roll[1] = -1.4; d.flex[0] = 0.2; d.flex[1] = 0.6;
    d.lean = 0.3; d.hp = 0.28; d.sink = 0.03;
    return d;
  }
  /** a lesson learnt: the great circle (0..2.2 s), the ball of qi held (..4.2), pushed up (..5.0), let go (..5.8), a bow */
  circlePose(d, t) {
    restPose(d);
    const k1 = ease(clamp(t / 2.2, 0, 1));
    for (let k = 0; k < 2; k++) CIRCLE[k].getPoint(k1, d.h[k]);
    d.roll[0] = lerp(0, 1.6, k1); d.roll[1] = lerp(0, -1.6, k1); d.flex[0] = d.flex[1] = 0.2;
    d.lean = lerp(0.03, -0.04, Math.sin(Math.PI * k1)); d.sink = lerp(0.012, 0.05, k1); d.hp = lerp(0.06, -0.1, Math.sin(Math.PI * k1));
    if (t > 2.2) {
      // the ball: the hands turn slowly round it, his eyes on it
      const w = Math.sin((t - 2.2) * 1.4) * 0.25 * smoothstep(2.2, 2.8, t);
      d.h[0].set(BALL_C.x + 0.09 * Math.sin(w), BALL_C.y + 0.11 * Math.cos(w), BALL_C.z - 0.03);
      d.h[1].set(BALL_C.x - 0.09 * Math.sin(w) - 0.02, BALL_C.y - 0.11 * Math.cos(w), BALL_C.z - 0.04);
      d.hp = 0.22;
    }
    if (t > 4.2) {
      // pushed up, palms up
      const k = ease(clamp((t - 4.2) / 0.8, 0, 1));
      d.h[0].y += 0.22 * k; d.h[1].y += 0.34 * k; d.h[0].x += 0.05 * k; d.h[1].x -= 0.04 * k;
      d.hp = lerp(0.22, -0.32, k);
    }
    if (t > 5.0) {
      // let go: the hands open out and come down, his eyes after the ball
      const k = ease(clamp((t - 5.0) / 0.8, 0, 1));
      d.h[0].lerp(_a.set(0.3, 1.18, 0.4), k); d.h[1].lerp(_b.set(-0.3, 1.18, 0.4), k);
      d.hp = -0.38;
    }
    if (t > 5.8) {
      // and a bow
      const e = envl(t - 5.8, 2.4, 0.6);
      mixPose(d, this.bowPose(this._pB), e);
    }
    return d;
  }

  /* ---------- pose (flat rig: every bone posed in the mesh's frame) ---------- */
  setBone(i, p, q) { const b = this.bones[i]; b.position.copy(p); b.quaternion.copy(q); }
  pose(dt = 0) {
    const P = this.P, bn = this.bones;
    const breathe = 0.003 * Math.sin(this.t * TAU / 5.5);
    // pelvis and body: sink, sway, the waist's turn and the lean from the hips
    const pr = _PR.set(P.sway, -P.sink, 0).add(BIND[B.ROOT]);
    _qR.setFromAxisAngle(AY, P.waist * 0.35);
    _qB.setFromAxisAngle(AY, P.waist).multiply(_q.setFromAxisAngle(AX, P.lean));
    this.setBone(B.ROOT, pr, _qR);
    const pb = _PB.subVectors(BIND[B.BODY], BIND[B.ROOT]).applyQuaternion(_qB).add(pr);
    pb.y += breathe;
    this.setBone(B.BODY, pb, _qB);
    const bodyAt = (j, out) => out.subVectors(BIND[j], BIND[B.BODY]).applyQuaternion(_qB).add(pb);
    // the tail, swaying a little
    this.setBone(B.TAIL, bodyAt(B.TAIL, _a), _q.copy(_qB).multiply(_q2.setFromAxisAngle(AY, 0.12 * Math.sin(this.t * 0.7))));
    // neck and head: the neck takes part of each turn, the head the rest; nods and shakes drawn straight from time
    const hy = this.hy.x + (this.shake || 0), hp = this.hp.x + (this.nod || 0), hr = this.hr.x;
    _qN1.copy(_qB).multiply(_q.setFromEuler(_e.set(hp * 0.3, hy * 0.3, hr * 0.2, 'YXZ')));
    const n1 = bodyAt(B.NECK1, _b);
    this.setBone(B.NECK1, n1, _qN1);
    _qN2.copy(_qN1).multiply(_q.setFromEuler(_e.set(hp * 0.3, hy * 0.3, hr * 0.3, 'YXZ')));
    const n2 = _c.subVectors(BIND[B.NECK2], BIND[B.NECK1]).applyQuaternion(_qN1).add(n1);
    this.setBone(B.NECK2, n2, _qN2);
    _qH.copy(_qN2).multiply(_q.setFromEuler(_e.set(hp * 0.4, hy * 0.4, hr * 0.5, 'YXZ')));
    const ph = _a.subVectors(BIND[B.HEAD], BIND[B.NECK2]).applyQuaternion(_qN2).add(n2);
    this.setBone(B.HEAD, ph, _qH);
    const headAtB = (j, out) => out.subVectors(BIND[j], BIND[B.HEAD]).applyQuaternion(_qH).add(ph);
    _qJ.copy(_qH).multiply(_q.setFromAxisAngle(AX, this.jaw.x));
    const pj = headAtB(B.JAW, _b);
    this.setBone(B.JAW, pj, _qJ);
    // lids: blinks
    const blink = this.blinkT >= 0 ? Math.sin(Math.PI * clamp(this.blinkT / 0.24, 0, 1)) : 0;
    for (let si = 0; si < 2; si++) {
      this.setBone(B.LID[si], headAtB(B.LID[si], _c), _q.copy(_qH).multiply(_q2.setFromAxisAngle(LID_AXIS[si], LID_SIGN[si] * 1.0 * blink)));
    }
    // brows and beard: they lag the head's turns a little and hang (the beard from the chin, whatever his bow)
    if (dt > 0) { this.lagY.step(hy + this.yawS.x, 5, dt); this.lagP.step(hp + P.lean, 5, dt); }
    const sy = clamp(wrap(this.lagY.x - hy - this.yawS.x), -0.5, 0.5), sp = clamp(this.lagP.x - hp - P.lean, -0.5, 0.5);
    for (let si = 0; si < 2; si++) {
      this.setBone(B.BROW[si], headAtB(B.BROW[si], _c), _q.copy(_qH).multiply(_q2.setFromEuler(_e.set(sp * 0.4, 0, sy * 0.5, 'YXZ'))));
    }
    // the beard hangs: the head's yaw only, with the lag's swing growing toward its tip
    _qU.setFromAxisAngle(AY, P.waist + hy);
    for (let k = 0; k < 3; k++) {
      const j = B.BEARD[k], f = 0.5 + 0.45 * k, jp = k === 0 ? B.JAW : B.BEARD[k - 1];
      const prev = k === 0 ? pj : this.bones[jp].position, prevQ = k === 0 ? _qJ : this.bones[jp].quaternion;
      const pos = _c.subVectors(BIND[j], BIND[jp]).applyQuaternion(prevQ).add(prev);
      _qF.copy(_qU).multiply(_q2.setFromEuler(_e.set(sp * f * 0.8, 0, sy * f, 'YXZ')));
      if (k === 0) _qF.slerp(_qJ, 0.3);
      this.setBone(j, pos, _qF);
    }
    // arms: two-bone IK to the hands' targets, elbows down and out
    for (let si = 0; si < 2; si++) {
      const s = si === 0 ? 1 : -1, L = LIMB.arm[si];
      const S = bodyAt(B.SHO[si], _a);
      const T = _t.subVectors(P.h[si], BIND[B.BODY]).applyQuaternion(_qB).add(pb);
      _pole.set(s * 0.55, -0.7, -0.45).applyQuaternion(_qB);
      ik2(S, T, L.L1, L.L2, _pole, _E, _W, _n);
      this.setBone(B.SHO[si], S, segQuat(L.x1, L.n, _x1.subVectors(_E, S).normalize(), _n, _q));
      segQuat(L.x2, L.n, _x2.subVectors(_W, _E).normalize(), _n, _q2);
      this.setBone(B.ELB[si], _E, _q2);
      // the hand: turned about the forearm and bent at the wrist
      _qF.copy(_q2).multiply(_q.setFromAxisAngle(L.x2, P.roll[si])).multiply(_q.setFromAxisAngle(L.n, P.flex[si]));
      this.setBone(B.HAND[si], _W, _qF);
      this.palm[si].copy(_x2).multiplyScalar(0.07).add(_W);
    }
    // legs: two-bone IK down to the planted feet, knees forward
    const inv = this._inv || (this._inv = new THREE.Matrix4());
    inv.copy(this.obj.matrixWorld).invert();
    for (let si = 0; si < 2; si++) {
      const s = si === 0 ? 1 : -1, L = LIMB.leg[si], f = this.feet[si];
      const H = _a.subVectors(BIND[B.HIP[si]], BIND[B.ROOT]).applyQuaternion(_qR).add(pr);
      const A = _t.copy(f.p).applyMatrix4(inv);
      A.y += ANK_H + f.h;
      const fy = wrap(f.yaw - this.yawS.x);
      _pole.set(s * 0.2, 0, 1).applyAxisAngle(AY, fy);
      ik2(H, A, L.L1, L.L2, _pole, _E, _W, _n);
      this.setBone(B.HIP[si], H, segQuat(L.x1, L.n, _x1.subVectors(_E, H).normalize(), _n, _q));
      this.setBone(B.KNEE[si], _E, segQuat(L.x2, L.n, _x2.subVectors(_W, _E).normalize(), _n, _q2));
      this.setBone(B.FOOT[si], _W, _q.setFromAxisAngle(AY, fy));
    }
  }

  /** the ball of qi: gathered between his palms, glowing; pushed up it rises and bursts into sparks */
  updateOrb() {
    const m = this.mood;
    if (!m || m.kind !== 'done' || m.t < 2.0 || m.t > 6.1) { this.orb.visible = false; return; }
    const t = m.t;
    // between the palms (world)
    const mid = _a.addVectors(this.palm[0], this.palm[1]).multiplyScalar(0.5);
    mid.z += 0.03;
    this.mesh.localToWorld(mid);
    if (t < 5.0) this.orbPos.copy(mid);
    else {
      if (!this.orbFreeSet) { this.orbFree.copy(this.orbPos); this.orbFreeSet = true; }
      this.orbPos.copy(this.orbFree).y += 1.3 * GSCALE * ease(clamp((t - 5.0) / 0.7, 0, 1));
    }
    if (t < 5.0) this.orbFreeSet = false;
    const grow = smoothstep(2.0, 3.9, t), fade = 1 - smoothstep(5.65, 6.05, t);
    const size = (0.07 + 0.22 * grow + 0.06 * smoothstep(5.0, 5.7, t)) * GSCALE;
    const glow = (0.6 + 2.2 * grow + 0.25 * Math.sin(t * 6.5) * grow) * fade;
    this.orb.visible = glow > 0.01;
    this.orb.position.copy(this.orbPos);
    this.orb.scale.setScalar(size * 2.2);
    this.orbMat.color.setRGB(1.0 * glow, 0.8 * glow, 0.45 * glow);
  }

  /* ---------- for the guide, the camera and taps ---------- */
  worldPoint(bone, local, out) {
    const b = this.bones[bone];
    out.copy(local).applyQuaternion(b.quaternion).add(b.position);
    return this.mesh.localToWorld(out);
  }
  /** a point over his head (the guide's marker) */
  anchor(out) { this.worldPoint(B.HEAD, this.headPt, out); out.y += 0.32 * GSCALE; return out; }
  pickTarget() {
    this.worldPoint(B.BODY, _c.set(0, 0.25, 0.1), this._pick || (this._pick = V(0, 0, 0)));
    return { member: null, label: '太极龟', guardian: 'tortoise', pos: this._pick, radius: 0.9 * GSCALE };
  }
  /** the camera's target while he talks: steady, at his chest (his head in the upper part of the picture, clear of the
   *  dialogue) */
  look(out) { return out.copy(this.home).add(_c.set(0, 1.18 * GSCALE, 0)); }
  /** the camera for a lesson: close, a little above, from the side the camera is already on (he turns to it), turned
   *  where the tree, a lantern or a building would stand between */
  view(yaw) {
    const cam = this.ctx.camera, portrait = cam.aspect < 0.9;
    const v = { target: this.look(V(0, 0, 0)), yaw, pitch: 0.12, dist: (portrait ? 3.1 : 2.25) * GSCALE };
    const y0 = Math.atan2(cam.position.x - this.home.x, cam.position.z - this.home.z);
    for (const d of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.3, -1.3, 1.8, -1.8, 2.4, -2.4, Math.PI]) {
      if (this.viewClear(v.target, y0 + d, v.pitch, v.dist)) { v.yaw = y0 + d; return v; }
    }
    v.yaw = y0;
    return v;
  }
  viewClear(t, yaw, pitch, dist) {
    const W = this.ctx.world, cp = Math.cos(pitch);
    const c = _b.set(t.x + dist * cp * Math.sin(yaw), t.y + dist * Math.sin(pitch), t.z + dist * cp * Math.cos(yaw));
    const g = W.groundAt(c.x, c.z);
    if (g !== null && c.y < g + 0.5) return false;
    for (const h of [0, 0.42 * GSCALE, 0.56 * GSCALE]) for (let k = 1; k <= 12; k++) {
      const f = k / 12;
      _p.set(lerp(t.x, c.x, f), lerp(t.y + h, c.y, f), lerp(t.z, c.z, f));
      if (Math.hypot(_p.x - this.home.x, _p.z - this.home.z) < 0.75 * GSCALE + 0.35) continue;   // (himself)
      // (with a margin: the boughs' blossoms hang a little outside their clusters)
      if (W.blocked(_p.x, _p.y, _p.z, 0.32)) return false;
    }
    return true;
  }
  /** where a new resident given for a lesson comes in: beside him on the terrace, a little behind him (in the picture,
   *  never between him and the camera), on whichever side is clear */
  rewardAt(out) {
    const yaw = this.yawS.x, W = this.ctx.world;
    for (const side of [-1, 1, -1.5, 1.5]) {
      const d = side * 1.35 * GSCALE, b = -0.35 * GSCALE;
      out.set(this.home.x + Math.cos(yaw) * d + Math.sin(yaw) * b, this.home.y, this.home.z - Math.sin(yaw) * d + Math.cos(yaw) * b);
      const g = W.groundAt(out.x, out.z);
      if (g !== null && !W.blocked(out.x, g + 1.2, out.z, 0.4)) { out.y = g; return out; }
    }
    return out;
  }

  /** Test hook: play t seconds now (talking if `talk`), returning his state. */
  debug(t = 4, talk = false) {
    if (talk) this.talk(true);
    this.ff = true;
    const step = 1 / 30;
    for (let k = 0; k < Math.round(t / step); k++) this.update(step, this.time + step);
    this.ff = false;
    return { t: this.t, yaw: this.yawS.x, form: FORMS[this.formI].kind, talking: this.talking, mood: this.mood && this.mood.kind };
  }
  dispose() {
    this.ctx.scene.remove(this.obj); this.ctx.scene.remove(this.orb);
    this.geo.dispose(); this.mat.dispose(); this.tex.map.dispose(); this.tex.normalMap.dispose(); this.tex.glowMap.dispose();
    this.orbMat.dispose(); this.orbTex.dispose();
  }
}

function makeTortoiseMesh(geo, mat) { return makeFlatSkinnedMesh(geo, mat, BIND); }

export { buildTortoiseGeometry, paintTortoiseAtlas, tortoiseMaterial, makeTortoiseMesh, B as TORTOISE_BONES, BIND as TORTOISE_BIND, BONE_COUNT as TORTOISE_BONE_COUNT };
