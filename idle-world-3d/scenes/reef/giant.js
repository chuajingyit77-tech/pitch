// 深蓝 · 珊瑚礁 — the gentle giant: a whale shark (鲸鲨, 10.5–12 m) that drifts through the blue every few
// minutes, with remoras riding on its belly and juvenile golden trevallies in its bow wave.
//
// Shape: broad, flat head with a wide terminal mouth, ridged back, tall crescent tail. Body, fins and
// remoras are one merged mesh (one draw call, ~6k triangles). Skin: a painted pattern of white spots and
// pale stripes on a dark blue-grey back over a white belly (countershading), ridges and gill slits in a
// normal map, the reef's rim light. Motion: one continuous phase drives the tail sweep and the body wave;
// it advances with the distance swum (stride-matched, so the body never slides, the same at any frame
// rate). The body bends along the path's curvature and banks gently into turns; the pectoral fins ride the
// stiff front of the body and hold steady.
// Visits: the first 20–45 s after the world opens, then one every 3–5 minutes (seeded), 40–90 s each.
// Each path is planned when the visit starts, against the camera and the screensaver's slow orbit, so it
// crosses the view; it comes out of the deep blue and goes back into it, fading with the haze. Between
// visits the shark is hidden and costs nothing.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU, makeRng, damp, quatFromForward, makeCanvas, createNoise, patchMaterial } from '../../lib/util.js';
import { PAINTERS, SHAPES, REGION, buildFishGeometry, paintFish, createFishMaterial, FishInstances, Swimmer } from '../../lib/fish.js';
import { waterize, UW_VERT } from './uw.js';

/* ------------------------------------------------------------------ */
/* Body plan: fractions of the total length TL, nose at x = +0.5       */
/* ------------------------------------------------------------------ */
const KS = [0.00, 0.02, 0.05, 0.10, 0.16, 0.22, 0.30, 0.40, 0.50, 0.58, 0.65, 0.71, 0.76, 0.81];
const KTOP = [0.012, 0.025, 0.039, 0.054, 0.066, 0.077, 0.087, 0.091, 0.087, 0.074, 0.057, 0.041, 0.031, 0.026];
const KBOT = [0.014, 0.030, 0.042, 0.051, 0.059, 0.067, 0.077, 0.079, 0.071, 0.058, 0.043, 0.031, 0.023, 0.019];
const KHW = [0.052, 0.070, 0.080, 0.086, 0.089, 0.091, 0.093, 0.091, 0.082, 0.066, 0.048, 0.032, 0.022, 0.018];
const S_END = 0.81;   // the body ends at the caudal fin root
const NOSE = 0.03;    // length of the rounded front of the (blunt, flat) snout
const BU = 0.84;      // the body uses u in [0, BU] of the skin atlas; fins and remoras the rest
const MOUTH_Y = -0.0085;
const RIDGES = [0.095, 0.215, 0.355];   // the three dorsolateral ridges (arc fraction from the dorsal midline)
const GILLS = [0.158, 0.17, 0.182, 0.194, 0.206];

/** Cubic Hermite through keys (finite-difference tangents): smooth profiles without overshoot steps. */
function spline(xs, ys, x) {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 0;
  while (x > xs[i + 1]) i++;
  const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
  const p1 = ys[i], p2 = ys[i + 1];
  const m1 = i > 0 ? (p2 - ys[i - 1]) / (xs[i + 1] - xs[i - 1]) * h : p2 - p1;
  const m2 = i < n - 2 ? (ys[i + 2] - p1) / (xs[i + 2] - xs[i]) * h : p2 - p1;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2;
}
const noseK = s => (s >= NOSE ? 1 : Math.sqrt(Math.max(0, 1 - ((NOSE - s) / NOSE) ** 2)));
const profTop = s => spline(KS, KTOP, s) * noseK(s);
const profBot = s => spline(KS, KBOT, s) * noseK(s);
const profHW = s => spline(KS, KHW, s) * noseK(s);

/**
 * A point of the body surface: s along the body (0 nose .. S_END), phi round it (0 the dorsal midline,
 * pi/2 the right flank, pi the belly). Superellipse sections: a flat, boxy head and belly, rounder behind,
 * and the lowest lateral ridge swelling into a keel along the caudal peduncle. Writes [x, y, z].
 */
function section(s, phi, out) {
  const c = Math.cos(phi), sn = Math.sin(phi);
  const nT = lerp(2.6, 2.15, smoothstep(0.08, 0.5, s)), nB = lerp(3.0, 2.3, smoothstep(0.15, 0.7, s));
  const e = 2 / (c >= 0 ? nT : nB);
  const y = (c >= 0 ? profTop(s) : -profBot(s)) * Math.pow(Math.abs(c), e);
  let z = profHW(s) * Math.sign(sn) * Math.pow(Math.abs(sn), e);
  const pf = phi > Math.PI ? TAU - phi : phi;
  z += Math.sign(sn) * 0.011 * smoothstep(0.6, 0.76, s) * Math.exp(-(((pf - Math.PI / 2) / 0.28) ** 2));
  out[0] = 0.5 - s; out[1] = y; out[2] = z;
  return out;
}
const _p = [0, 0, 0], _q3 = [0, 0, 0];

/** Arc-length table of one half section (dorsal midline .. belly), `n` equal steps of phi. */
function halfArc(s, n) {
  const a = new Float32Array(n + 1);
  section(s, 0, _q3);
  for (let i = 1; i <= n; i++) {
    section(s, (i / n) * Math.PI, _p);
    a[i] = a[i - 1] + Math.hypot(_p[0] - _q3[0], _p[1] - _q3[1], _p[2] - _q3[2]);
    _q3[0] = _p[0]; _q3[1] = _p[1]; _q3[2] = _p[2];
  }
  return a;
}
const HP = [];   // half perimeter per 0.005 of s (for painting round spots on the anisotropic atlas)
for (let i = 0; i <= 170; i++) { const a = halfArc(Math.max(0.004, i * 0.005), 72); HP.push(a[72]); }
const halfPerim = s => { const f = clamp(s / 0.005, 0, 169.999), i = Math.floor(f); return lerp(HP[i], HP[i + 1], f - i); };

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */
const NAR = 36;                  // vertices round a section
const FIN_U0 = BU + 0.005, FIN_DU = 0.15;
const UV_F1 = [0.03, 0.44];      // fin region (dark, spotted): v0, dv
const UV_F2 = [0.52, 0.18];      // pale undersides
const UV_RM = [0.74, 0.24];      // remoras

function buildGeometry(seed) {
  const rng = makeRng(seed);
  const pos = [], uv = [], rem = [], idx = [];
  const vtx = (x, y, z, u, v, r = null) => {
    pos.push(x, y, z); uv.push(u, v);
    if (r) rem.push(r[0], r[1], r[2], r[3]); else rem.push(0, 0, 0, 0);
    return pos.length / 3 - 1;
  };

  /* ---- body: rings from the snout to the caudal root, closed by a pole at each end ---- */
  const rings = [0.003, 0.008, 0.015, 0.024, 0.035, 0.048, 0.062, 0.078, 0.095];
  for (let s = 0.11; s < S_END - 0.006; s += 0.0145) rings.push(s);
  rings.push(S_END - 0.002);
  const SUB = 8, half = NAR / 2;
  const poleF = vtx(0.5, 0.0, 0.0, 0.0, 0.5);
  const ringStart = [];
  for (const s of rings) {
    ringStart.push(pos.length / 3);
    const arc = halfArc(s, half * SUB), tot = arc[half * SUB];
    for (let j = 0; j < NAR; j++) {
      section(s, (j / NAR) * TAU, _p);
      const jj = j <= half ? j : NAR - j;            // mirrored: v runs from the dorsal midline to the belly
      vtx(_p[0], _p[1], _p[2], (s / S_END) * BU, arc[jj * SUB] / tot);
    }
  }
  const poleB = vtx(0.5 - S_END - 0.006, 0.0, 0.0, BU, 0.5);
  for (let j = 0; j < NAR; j++) idx.push(poleF, ringStart[0] + j, ringStart[0] + (j + 1) % NAR);
  for (let r = 0; r < rings.length - 1; r++) {
    for (let j = 0; j < NAR; j++) {
      const a = ringStart[r] + j, b = ringStart[r] + (j + 1) % NAR, c = ringStart[r + 1] + j, d = ringStart[r + 1] + (j + 1) % NAR;
      idx.push(a, c, b, b, c, d);
    }
  }
  const last = ringStart[rings.length - 1];
  for (let j = 0; j < NAR; j++) idx.push(poleB, last + (j + 1) % NAR, last + j);

  /* ---- fins: thin closed airfoils (rounded leading edge, sharp trailing edge) ---- */
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const bodyPt = (s, phi) => { section(s, phi, _p); return V(_p[0], _p[1], _p[2]); };
  const _le = new THREE.Vector3(), _te = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
  /**
   * edge(a, le, te): leading and trailing edge at span fraction a (0 root, inside the body .. 1 tip);
   * nrm: thickness direction (the "top" side); T(a): maximum thickness; uvTop / uvBot: atlas rows.
   */
  const fin = ({ edge, nrm, T, NA = 8, NC = 6, uvTop = UV_F1, uvBot = UV_F1 }) => {
    const n = nrm.clone().normalize();
    for (const sideK of [1, -1]) {
      const base = pos.length / 3;
      const uvr = sideK > 0 ? uvTop : uvBot;
      for (let i = 0; i <= NA; i++) {
        const a = i / NA;
        edge(a, _le, _te);
        for (let j = 0; j <= NC; j++) {
          const c = (1 - Math.cos((j / NC) * Math.PI)) / 2;
          const t = T(a) * 2.6 * Math.sqrt(c) * (1 - c);
          _a.copy(_le).lerp(_te, c).addScaledVector(n, sideK * t * 0.5);
          vtx(_a.x, _a.y, _a.z, FIN_U0 + FIN_DU * a, uvr[0] + uvr[1] * c);
        }
      }
      // winding: the top face looks along +nrm, the bottom along -nrm
      edge(0.5, _le, _te); _a.copy(_te).sub(_le);
      edge(0.55, _b, _te); _b.sub(_le);
      const flip = _b.cross(_a).dot(n) * sideK < 0;
      for (let i = 0; i < NA; i++) for (let j = 0; j < NC; j++) {
        const p = base + i * (NC + 1) + j, q = p + 1, r2 = p + NC + 1, s2 = r2 + 1;
        if (!flip) idx.push(p, r2, q, q, r2, s2); else idx.push(p, q, r2, q, s2, r2);
      }
    }
  };
  const bow = (a, k) => Math.sin(Math.PI * a) * k;
  // first dorsal: tall, raked triangle with a convex leading and a concave trailing edge
  {
    const r0 = V(0.5 - 0.505, profTop(0.505) - 0.006, 0), r1 = V(0.5 - 0.615, profTop(0.615) - 0.006, 0);
    const tip = V(0.5 - 0.6, profTop(0.55) + 0.085, 0);
    fin({ edge: (a, le, te) => { le.lerpVectors(r0, tip, a); le.x += bow(a, 0.012); le.y += bow(a, 0.006); te.lerpVectors(r1, tip, Math.pow(a, 0.9)); te.x += bow(a, 0.014); },
      nrm: V(0, 0, 1), T: a => 0.014 * (1 - 0.85 * a), NA: 8, NC: 6 });
  }
  // second dorsal and anal fins: small
  {
    const r0 = V(0.5 - 0.715, profTop(0.715) - 0.004, 0), r1 = V(0.5 - 0.752, profTop(0.752) - 0.004, 0), tip = V(0.5 - 0.752, profTop(0.73) + 0.03, 0);
    fin({ edge: (a, le, te) => { le.lerpVectors(r0, tip, a); le.x += bow(a, 0.004); te.lerpVectors(r1, tip, a); te.x += bow(a, 0.005); }, nrm: V(0, 0, 1), T: a => 0.007 * (1 - 0.8 * a), NA: 4, NC: 4 });
    const q0 = V(0.5 - 0.735, -profBot(0.735) + 0.004, 0), q1 = V(0.5 - 0.768, -profBot(0.768) + 0.004, 0), qt = V(0.5 - 0.768, -profBot(0.75) - 0.026, 0);
    fin({ edge: (a, le, te) => { le.lerpVectors(q0, qt, a); le.x += bow(a, 0.004); te.lerpVectors(q1, qt, a); te.x += bow(a, 0.005); }, nrm: V(0, 0, -1), T: a => 0.006 * (1 - 0.8 * a), NA: 4, NC: 4 });
  }
  // pectorals: large, falcate, drooping and swept back; dark above, white below
  for (const sd of [1, -1]) {
    const ph = Math.PI / 2 + 0.42, phi = sd > 0 ? ph : TAU - ph;
    const r0 = bodyPt(0.212, phi), r1 = bodyPt(0.305, phi);
    r0.z -= sd * 0.012; r1.z -= sd * 0.012;
    const tip = r0.clone().add(V(-0.082, -0.052, sd * 0.158));
    const span = tip.clone().sub(r0), chord = r1.clone().sub(r0);
    const up = chord.clone().cross(span).multiplyScalar(sd);   // points up out of the fin's top face
    if (up.y < 0) up.negate();
    fin({ edge: (a, le, te) => {
      le.lerpVectors(r0, tip, a); le.addScaledVector(chord, -bow(a, 0.12)); le.y += bow(a, 0.006);
      te.lerpVectors(r1, tip, Math.pow(a, 0.85)); te.addScaledVector(chord, -bow(a, 0.22)); te.x -= 0.01 * a * a;
    }, nrm: up, T: a => 0.017 * (1 - 0.82 * a), NA: 9, NC: 6, uvTop: UV_F1, uvBot: UV_F2 });
  }
  // pelvic fins: small, under the belly
  for (const sd of [1, -1]) {
    const ph = Math.PI - 0.6, phi = sd > 0 ? ph : TAU - ph;
    const r0 = bodyPt(0.565, phi), r1 = bodyPt(0.605, phi);
    const tip = r0.clone().add(V(-0.045, -0.02, sd * 0.032));
    const span = tip.clone().sub(r0), chord = r1.clone().sub(r0);
    const up = chord.clone().cross(span).multiplyScalar(sd);
    if (up.y < 0) up.negate();
    fin({ edge: (a, le, te) => { le.lerpVectors(r0, tip, a); te.lerpVectors(r1, tip, a); te.addScaledVector(chord, -bow(a, 0.15)); }, nrm: up, T: a => 0.006 * (1 - 0.8 * a), NA: 4, NC: 4, uvTop: UV_F1, uvBot: UV_F2 });
  }
  // caudal fin: a tall crescent; the upper lobe longer than the lower, their roots meeting at the notch
  {
    // the roots run along the peduncle inside the body; the lobes are broad near the base and taper
    const xb = 0.5 - S_END - 0.002;
    const upTip = V(-0.488, 0.154, 0), loTip = V(-0.437, -0.1, 0);
    const uR0 = V(0.5 - 0.73, profTop(0.73) - 0.005, 0), uR1 = V(xb, 0.004, 0);
    fin({ edge: (a, le, te) => {
      le.lerpVectors(uR0, upTip, a); le.x += bow(a, 0.016); le.y += bow(a, 0.022);
      te.lerpVectors(uR1, upTip, a); te.x += bow(a, 0.012); te.y += bow(a, 0.004);
    }, nrm: V(0, 0, 1), T: a => 0.018 * (1 - 0.86 * a), NA: 10, NC: 6 });
    const lR0 = V(0.5 - 0.742, -profBot(0.742) + 0.005, 0), lR1 = V(xb, -0.004, 0);
    fin({ edge: (a, le, te) => {
      le.lerpVectors(lR0, loTip, a); le.x += bow(a, 0.012); le.y -= bow(a, 0.014);
      te.lerpVectors(lR1, loTip, a); te.x += bow(a, 0.01); te.y -= bow(a, 0.002);
    }, nrm: V(0, 0, -1), T: a => 0.016 * (1 - 0.86 * a), NA: 7, NC: 6 });
  }

  /* ---- remoras on the belly and lower flanks (they ride the body wave and beat their tails) ---- */
  const remSpots = [[0.27, Math.PI - 0.72], [0.315, Math.PI + 0.5], [0.45, Math.PI - 0.12], [0.6, Math.PI + 0.32]];
  const nV = new THREE.Vector3(), xr = new THREE.Vector3(), yr = new THREE.Vector3(), zr = new THREE.Vector3(), c0 = new THREE.Vector3();
  for (const [s, phi] of remSpots) {
    const l = rng.range(0.042, 0.056), ph0 = rng.range(0, TAU);
    // outward normal from neighbouring surface points
    const pA = bodyPt(s - 0.004, phi), pB = bodyPt(s + 0.004, phi), pC = bodyPt(s, phi - 0.05), pD = bodyPt(s, phi + 0.05);
    nV.copy(pB).sub(pA).cross(_b.copy(pD).sub(pC)).normalize();
    const p0 = bodyPt(s, phi);
    _a.copy(p0).sub(V(p0.x, 0, 0));                  // from the body axis outward
    if (nV.dot(_a) < 0) nV.negate();
    yr.copy(nV).negate();                            // the sucker disc faces the shark
    xr.set(1, 0, 0).addScaledVector(nV, -nV.x).normalize();
    zr.crossVectors(xr, yr).normalize();
    const R = l * 0.085;
    c0.copy(p0).addScaledVector(nV, R * 0.8);
    const NR = 8, NL = 9, base = pos.length / 3;
    for (let i = 0; i <= NL; i++) {
      const t = i / NL;                               // 0 head .. 1 tail
      const prof = Math.pow(Math.sin(Math.PI * (0.06 + 0.94 * Math.pow(t, 0.85))), 0.75) * (1 - 0.55 * t * t);
      for (let j = 0; j < NR; j++) {
        const ang = (j / NR) * TAU;
        const cy = Math.cos(ang), cz = Math.sin(ang);
        const flat = cy > 0 && t < 0.45 ? 0.55 : 1;   // flat sucker disc on top of the head
        const ry = R * prof * cy * flat * 0.85, rz = R * prof * cz;
        _a.copy(c0).addScaledVector(xr, l * (0.5 - t)).addScaledVector(yr, ry).addScaledVector(zr, rz);
        const amp = 0.0042 * t * t;
        vtx(_a.x, _a.y, _a.z, FIN_U0 + FIN_DU * t, UV_RM[0] + UV_RM[1] * (0.5 - 0.5 * cy), [zr.x * amp, zr.y * amp, zr.z * amp, ph0 - t * 2.4]);
      }
    }
    for (let i = 0; i < NL; i++) for (let j = 0; j < NR; j++) {
      const a = base + i * NR + j, b = base + i * NR + (j + 1) % NR, c = base + (i + 1) * NR + j, d = base + (i + 1) * NR + (j + 1) % NR;
      idx.push(a, c, b, b, c, d);
    }
    // nose cap and a small tail fin (its own vertices per side, so the two faces keep their normals)
    const nose = vtx(c0.x + xr.x * l * 0.52, c0.y + xr.y * l * 0.52, c0.z + xr.z * l * 0.52, FIN_U0, UV_RM[0] + UV_RM[1] * 0.5, [0, 0, 0, ph0]);
    for (let j = 0; j < NR; j++) idx.push(nose, base + j, base + (j + 1) % NR);
    const amp = 0.0042 * 1.3, tr = [zr.x * amp, zr.y * amp, zr.z * amp, ph0 - 2.6];
    const tv = (along, yk) => { _a.copy(c0).addScaledVector(xr, -l * along).addScaledVector(yr, yk * l * 0.13); return vtx(_a.x, _a.y, _a.z, FIN_U0 + FIN_DU, UV_RM[0] + UV_RM[1] * 0.5, tr); };
    for (const sideK of [1, -1]) {
      const r0 = tv(0.47, 0.25), r1 = tv(0.47, -0.25), t1 = tv(0.66, 1), t2 = tv(0.66, -1), m = tv(0.6, 0);
      if (sideK > 0) idx.push(r0, t1, m, r0, m, r1, r1, m, t2); else idx.push(r0, m, t1, r0, r1, m, r1, t2, m);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aRem', new THREE.Float32BufferAttribute(rem, 4));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 0.64);
  return g;
}

/* ------------------------------------------------------------------ */
/* Skin: painted atlas + ridge normal map                              */
/* ------------------------------------------------------------------ */
const AW = 1024, AH = 512;
const PX_TL = (BU * AW) / S_END;   // atlas pixels per body length along the body

/** phi (right half) at an arc fraction v of the section at s (for per-pixel work at the snout). */
function phiAtArc(arc, v) {
  const n = arc.length - 1, tgt = v * arc[n];
  let i = 0;
  while (i < n - 1 && arc[i + 1] < tgt) i++;
  const f = (tgt - arc[i]) / Math.max(arc[i + 1] - arc[i], 1e-9);
  return ((i + clamp(f, 0, 1)) / n) * Math.PI;
}

function paintSkin(seed) {
  const rng = makeRng(seed), nz = createNoise(seed + 5);
  const cv = makeCanvas(AW, AH), g = cv.getContext('2d');
  const img = g.createImageData(AW, AH), d = img.data;
  const hgt = new Float32Array(AW * AH);
  const BX = Math.floor(BU * AW);
  // mottling noise on coarse grids, read back bilinearly (per-pixel noise was slow to paint on an iPad)
  const grid = (gw, gh, f) => { const a = new Float32Array(gw * gh); for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) a[j * gw + i] = f((i + 0.5) / gw, (j + 0.5) / gh); return a; };
  const read = (a, gw, gh, u, v) => {
    const x = clamp(u * gw - 0.5, 0, gw - 1.001), y = clamp(v * gh - 0.5, 0, gh - 1.001), i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
    const p = a[j * gw + i], q = a[j * gw + i + 1], r2 = a[(j + 1) * gw + i], s2 = a[(j + 1) * gw + i + 1];
    return lerp(lerp(p, q, fx), lerp(r2, s2, fx), fy);
  };
  const G1 = grid(256, 128, (u, v) => { const s = u * S_END; return nz.fbm2(s * 38, v * halfPerim(s) * 38, 3); });
  const G2 = grid(512, 256, (u, v) => { const s = u * S_END; return nz.noise2(s * 160 + 7, v * halfPerim(s) * 160); });
  // colours (sRGB 0..255)
  const DORSAL = [48, 61, 75], FLANK = [57, 72, 87], BELLY = [192, 199, 201], LIP = [132, 136, 132], MOUTH = [24, 18, 16];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let x = 0; x < BX; x++) {
    const s = ((x + 0.5) / BX) * S_END;
    const hp = halfPerim(s);
    const arc = s < 0.05 ? halfArc(Math.max(s, 0.002), 144) : null;
    // the white belly starts a little above mid-flank (higher on the head), with a ragged edge
    const vcs = lerp(0.7, 0.64, smoothstep(0.12, 0.3, s)) + 0.03 * smoothstep(0.62, 0.8, s);
    for (let y = 0; y < AH; y++) {
      const v = 1 - (y + 0.5) / AH, i = (y * AW + x) * 4;
      const n1 = read(G1, 256, 128, s / S_END, v), n2 = read(G2, 512, 256, s / S_END, v);
      const cs = smoothstep(vcs - 0.022, vcs + 0.022, v + 0.035 * n1);
      let col = mix(DORSAL, FLANK, smoothstep(0.0, 0.45, v));
      col = mix(col, BELLY, cs);
      const k = 1 + 0.07 * n1 + 0.035 * n2 - (1 - cs) * 0.08 * smoothstep(0.08, 0.0, v);
      col = [col[0] * k, col[1] * k, col[2] * k];
      let h = 0;
      // ridges (normal map) and their slightly paler crests
      for (let r = 0; r < 3; r++) {
        const reach = r === 2 ? smoothstep(0.82, 0.74, s) : smoothstep(0.74, 0.6, s);
        const amt = smoothstep(0.18, 0.24, s) * reach;
        if (amt <= 0) continue;
        const sig = 0.0058 / hp, dv = (v - RIDGES[r] - 0.01 * Math.sin(s * 9 + r)) / sig;
        const e = Math.exp(-dv * dv) * amt;
        h += 0.0024 * e;
      }
      // gill slits: grooves curving slightly forward at mid-height
      if (s > 0.145 && s < 0.22 && v > 0.27 && v < 0.62) {
        const win = smoothstep(0.27, 0.33, v) * smoothstep(0.62, 0.56, v);
        for (const sg of GILLS) {
          const ds = (s - sg + 0.006 * Math.sin((v - 0.27) / 0.35 * Math.PI)) / 0.0012;
          const gr = Math.exp(-ds * ds) * win;
          h -= 0.0014 * gr;
          col = mix(col, [20, 26, 32], gr * 0.75);
          // pale lip behind each slit
          const db = (s - sg - 0.0032) / 0.0018;
          col = mix(col, [120, 132, 138], Math.exp(-db * db) * win * 0.35);
        }
      }
      // the wide terminal mouth: a dark band with pale lips across the front of the snout
      if (arc) {
        const phi = phiAtArc(arc, v);
        section(Math.max(s, 0.002), phi, _p);
        const dm = (_p[1] - MOUTH_Y) / 0.0024, fade = smoothstep(0.046, 0.036, s);
        const band = Math.exp(-dm * dm * 0.6) * fade;
        const lip = Math.exp(-(((Math.abs(_p[1] - MOUTH_Y) - 0.0046) / 0.0018) ** 2)) * fade;
        col = mix(col, LIP, lip * 0.6);
        col = mix(col, MOUTH, band);
        h -= 0.002 * band;
      }
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
      hgt[y * AW + x] = h;
    }
  }
  // atlas regions for fins (dark above, pale below) and remoras
  for (let x = BX; x < AW; x++) {
    const a = (x - BX) / (AW - BX);
    for (let y = 0; y < AH; y++) {
      const v = 1 - (y + 0.5) / AH, i = (y * AW + x) * 4;
      let col;
      if (v < 0.5) { const n1 = read(G1, 256, 128, a * 0.3, v); col = mix(DORSAL, FLANK, 0.3 + 0.2 * n1); const k = 0.95 + 0.08 * n1; col = [col[0] * k, col[1] * k, col[2] * k]; }
      else if (v < 0.72) { const t = (v - UV_F2[0]) / UV_F2[1]; col = mix(BELLY, [150, 160, 166], smoothstep(0.75, 1.0, t) * 0.7 + smoothstep(0.82, 1, a) * 0.3); }
      else {
        // remora: dark back, a black lateral stripe edged in white, grey belly
        const t = clamp((v - UV_RM[0]) / UV_RM[1], 0, 1);
        col = mix([58, 60, 62], [38, 40, 44], smoothstep(0.35, 0.5, t));
        col = mix(col, [205, 210, 206], Math.exp(-(((t - 0.42) / 0.035) ** 2)) + Math.exp(-(((t - 0.58) / 0.035) ** 2)));
        col = mix(col, [22, 22, 24], Math.exp(-(((t - 0.5) / 0.05) ** 2)));
        col = mix(col, [170, 172, 168], smoothstep(0.8, 0.95, t) * 0.5);
      }
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);

  /* ---- the pattern: pale spots and stripes, painted round on the body ---- */
  const SPOT = 'rgba(196,205,199,';
  const atlasY = v => (1 - v) * AH;
  const spot = (s, v, r, a = 0.92) => {
    const hp = halfPerim(s), rx = r * PX_TL, ry = (r / hp) * AH;
    const x = (s / S_END) * BX, y = atlasY(v);
    g.fillStyle = SPOT + (a * 0.45) + ')';
    g.beginPath(); g.ellipse(x, y, rx * 1.18, ry * 1.18, 0, 0, TAU); g.fill();
    g.fillStyle = SPOT + a + ')';
    g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, TAU); g.fill();
    // mirrored copy across the dorsal midline (v < 0) so spots on the midline stay round
    if (v - r / hp < 0) { g.beginPath(); g.ellipse(x, atlasY(-v), rx, ry, 0, 0, TAU); g.fill(); }
  };
  const vStripe = (s0, v0, v1, w, a) => {
    g.strokeStyle = SPOT + a + ')';
    g.lineCap = 'round';
    g.lineWidth = w * PX_TL;
    g.beginPath();
    for (let k = 0; k <= 12; k++) {
      const v = lerp(v0, v1, k / 12), s = s0 + 0.0022 * Math.sin(v * 13 + s0 * 50);
      const x = (s / S_END) * BX, y = atlasY(v);
      if (k) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  };
  const hStripe = (v0, s0, s1, w, a) => {
    g.strokeStyle = SPOT + a + ')';
    g.lineCap = 'round';
    for (let k = 0; k < 24; k++) {
      const sA = lerp(s0, s1, k / 24), sB = lerp(s0, s1, (k + 1) / 24);
      g.lineWidth = Math.max(1, (w / halfPerim((sA + sB) / 2)) * AH);
      const fade = smoothstep(s1, s1 - 0.08, sA);
      g.globalAlpha = fade;
      g.beginPath(); g.moveTo((sA / S_END) * BX, atlasY(v0 + 0.004 * Math.sin(sA * 40))); g.lineTo((sB / S_END) * BX, atlasY(v0 + 0.004 * Math.sin(sB * 40))); g.stroke();
    }
    g.globalAlpha = 1;
  };
  // checkerboard behind the gills: vertical pale stripes, horizontal ones along the ridges
  const cols = [];
  for (let s = 0.214; s < 0.7; s += 0.031 + rng.range(-0.002, 0.003)) cols.push(s);
  for (const s of cols) vStripe(s, -0.01, lerp(0.5, 0.44, smoothstep(0.3, 0.68, s)) + rng.range(-0.02, 0.02), 0.0031, lerp(0.62, 0.34, smoothstep(0.45, 0.7, s)));
  for (const vr of RIDGES) hStripe(vr, 0.214, vr === RIDGES[2] ? 0.76 : 0.7, 0.0028, 0.5);
  // spots in the cells between the stripes
  const bands = [[0.0, RIDGES[0]], [RIDGES[0], RIDGES[1]], [RIDGES[1], RIDGES[2]], [RIDGES[2], 0.56]];
  for (let c = 0; c < cols.length; c++) {
    const sA = cols[c], sB = c + 1 < cols.length ? cols[c + 1] : sA + 0.032;
    const tail = smoothstep(0.55, 0.74, sA);
    bands.forEach(([v0, v1], bi) => {
      // two columns of spots per cell, two or three per column
      const rows = bi === 0 ? 2 : 3;
      for (let i = 0; i < 2; i++) for (let k = 0; k < rows; k++) {
        if (rng.next() < 0.12 + tail * 0.45) continue;
        const s = lerp(sA, sB, (i + 0.5) / 2 + rng.range(-0.07, 0.07)), v = lerp(v0, v1, (k + 0.5) / rows + rng.range(-0.06, 0.06));
        spot(s, v, rng.range(0.0032, 0.0046) * (bi === 3 ? 0.85 : 1) * (1 - tail * 0.2), 0.84);
      }
    });
  }
  // the head: dense small spots
  for (let k = 0; k < 600; k++) {
    const s = lerp(0.014, 0.212, Math.pow(rng.next(), 0.85)), v = rng.range(0.0, s < 0.04 ? 0.42 : 0.66);
    if (s > 0.145 && v > 0.26 && v < 0.62 && GILLS.some(g => Math.abs(s - g) < 0.0042)) continue;   // not on a gill slit
    spot(s, v, rng.range(0.0019, 0.003) * lerp(0.8, 1.1, smoothstep(0.03, 0.2, s)), 0.78);
  }
  // spots fading into the belly and onto the peduncle
  for (let k = 0; k < 120; k++) spot(rng.range(0.22, 0.72), rng.range(0.55, 0.66), rng.range(0.0025, 0.0036), 0.66);
  for (let k = 0; k < 70; k++) spot(rng.range(0.7, 0.8), rng.range(0.0, 0.55), rng.range(0.0024, 0.0034), 0.7);
  // eye: small, dark, ringed, just behind the mouth corner
  {
    const s = 0.058, arc = halfArc(s, 144);
    let best = 0, bd = 9;
    for (let i = 0; i <= 144; i++) { section(s, (i / 144) * Math.PI, _p); const e = Math.abs(_p[1] - 0.006); if (e < bd) { bd = e; best = i; } }
    const v = arc[best] / arc[144], x = (s / S_END) * BX, y = atlasY(v), hp = halfPerim(s);
    g.fillStyle = 'rgb(150,156,150)'; g.beginPath(); g.ellipse(x, y, 0.0068 * PX_TL, (0.0068 / hp) * AH, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgb(16,16,18)'; g.beginPath(); g.ellipse(x, y, 0.0046 * PX_TL, (0.0046 / hp) * AH, 0, 0, TAU); g.fill();
  }
  // fins: sparse spots on the dark side
  for (let k = 0; k < 220; k++) {
    const x = BX + rng.range(3, AW - BX - 3), v = rng.range(0.05, 0.47), r = rng.range(1.6, 2.6);
    g.fillStyle = SPOT + '0.85)'; g.beginPath(); g.ellipse(x, atlasY(v), r, r * 1.3, 0, 0, TAU); g.fill();
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  /* ---- normal map from the relief (ridges, gill slits, mouth) ---- */
  const nc = makeCanvas(AW, AH), ng = nc.getContext('2d'), nimg = ng.createImageData(AW, AH), nd = nimg.data;
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
    const i = y * AW + x, o = i * 4;
    let nx = 0, ny = 0;
    if (x > 0 && x < BX - 1 && y > 0 && y < AH - 1) {
      const s = ((x + 0.5) / BX) * S_END, hp = halfPerim(s);
      nx = -(hgt[i + 1] - hgt[i - 1]) * 0.5 * PX_TL;
      ny = (hgt[i + AW] - hgt[i - AW]) * 0.5 / (hp / AH);
    }
    const l = Math.hypot(nx, ny, 1);
    nd[o] = (nx / l * 0.5 + 0.5) * 255; nd[o + 1] = (ny / l * 0.5 + 0.5) * 255; nd[o + 2] = (1 / l * 0.5 + 0.5) * 255; nd[o + 3] = 255;
  }
  ng.putImageData(nimg, 0, 0);
  const normalMap = new THREE.CanvasTexture(nc);
  normalMap.colorSpace = THREE.NoColorSpace;
  normalMap.anisotropy = 4;
  return { map, normalMap };
}

/* ------------------------------------------------------------------ */
/* Swimming: one phase drives the body wave; the body bends with the path */
/* ------------------------------------------------------------------ */
const SWIM_V = /* glsl */`
uniform float uWsPh, uWsAmp, uWsBend;
attribute vec4 aRem;
// lateral offset (in body lengths) at x: a travelling wave that grows toward the tail (the stiff front
// half barely moves: the head yaws a few centimetres, the pectorals hold steady) plus the bend of a turn
float wsLat(float x){
  float T = clamp(0.5 - x, 0.0, 1.05);
  float e = smoothstep(0.35, 1.0, T);
  return sin(uWsPh - 5.4 * T) * (0.010 + 0.1 * pow(e, 1.8)) * uWsAmp + uWsBend * x * x;
}
`;

/* ------------------------------------------------------------------ */
/* Pilot fish: juvenile golden trevallies riding the bow wave          */
/* ------------------------------------------------------------------ */
const hex = h => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
if (!PAINTERS.reefPilot) {
  PAINTERS.reefPilot = {
    setup: () => ({}),
    body(s, v, C) {
      const q = C.q;
      let col = mix3(hex('#fff2b0'), hex('#ffcb1f'), smoothstep(0.05, 0.42, q));
      col = mix3(col, hex('#d8a614'), smoothstep(0.72, 0.98, q) * 0.55);
      let b = 0;
      for (const x of [0.105, 0.235, 0.365, 0.49, 0.61, 0.73, 0.85]) b = Math.max(b, smoothstep(0.024, 0.011, Math.abs(s - x)));
      b *= smoothstep(0.06, 0.28, q);
      return mix3(col, hex('#1d1b14'), b * 0.82);
    },
    fin(region, a, b) {
      if (region === REGION.caudal) { const e = Math.min(b, 1 - b); return [...mix3(hex('#ffd22e'), hex('#1e1d18'), smoothstep(0.72, 0.95, a) * (1 - smoothstep(0.1, 0.3, e) * 0.5)), 0.95]; }
      if (region === REGION.pectoral) return [...hex('#ffe57a'), lerp(0.8, 0.4, a)];
      return [...hex('#ffd436'), lerp(0.92, 0.6, a)];
    },
    eye: { iris: '#e8c850', pupil: '#050505' },
    material: () => ({ metalness: 0.12, roughness: 0.3, clearcoat: 0.6, iridescence: 0.5, normalScale: 0.2 }),
    scaleDark: () => 0.02,
  };
  SHAPES.reefPilot = {
    ...SHAPES.chromis, height: 0.42, hPos: 0.42, width: 0.12, noseQ: 0.62, noseQw: 0.6, tailLen: 0.22, arch: 0.03,
    caudal: { type: 'fork', L: 0.3, S: 0.21, notch: 0.55 },
    dorsal: { d0: 0.3, d1: 0.8, h: 0.08, profile: [0, 1.2, 0.6, 0.5, 0.55, 0.1], sweep: 0.35 },
    anal: { d0: 0.55, d1: 0.82, h: 0.07, profile: [0, 1, 0.55, 0.5, 0.1], sweep: 0.35 },
    pectoral: { s: 0.27, L: 0.16, W: 0.05, spread: 0.6, droop: 0.3, y: -0.1 },
  };
}
// stations round the snout (metres: ahead of the snout tip, up, right); the last two beside the head
const SLOTS = [[0.5, 0.1, 0.0], [0.95, -0.2, 0.45], [0.8, 0.25, -0.5], [1.35, 0.0, 0.12], [0.35, -0.35, 0.75], [0.4, -0.3, -0.8], [0.65, 0.45, 0.25], [1.15, -0.45, -0.25], [-1.2, -0.62, 1.3], [-1.45, -0.66, -1.35]];

/* ------------------------------------------------------------------ */
/* Path: a quadratic Bezier, walked at constant speed by arc length    */
/* ------------------------------------------------------------------ */
class Path {
  constructor(n = 96) { this.S = new THREE.Vector3(); this.Q = new THREE.Vector3(); this.E = new THREE.Vector3(); this.n = n; this.len = new Float64Array(n + 1); this.total = 0; }
  set(S, C, E) {
    this.S.copy(S); this.E.copy(E);
    this.Q.copy(C).multiplyScalar(2).addScaledVector(S, -0.5).addScaledVector(E, -0.5);   // passes through C at t = 0.5
    const p = new THREE.Vector3(), q = new THREE.Vector3();
    this.at(0, q); this.len[0] = 0;
    for (let i = 1; i <= this.n; i++) { this.at(i / this.n, p); this.len[i] = this.len[i - 1] + p.distanceTo(q); q.copy(p); }
    this.total = this.len[this.n];
    return this;
  }
  at(t, out) { const a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t; return out.set(a * this.S.x + b * this.Q.x + c * this.E.x, a * this.S.y + b * this.Q.y + c * this.E.y, a * this.S.z + b * this.Q.z + c * this.E.z); }
  d1(t, out) { return out.set(2 * (1 - t) * (this.Q.x - this.S.x) + 2 * t * (this.E.x - this.Q.x), 2 * (1 - t) * (this.Q.y - this.S.y) + 2 * t * (this.E.y - this.Q.y), 2 * (1 - t) * (this.Q.z - this.S.z) + 2 * t * (this.E.z - this.Q.z)); }
  d2(out) { return out.set(2 * (this.E.x - 2 * this.Q.x + this.S.x), 2 * (this.E.y - 2 * this.Q.y + this.S.y), 2 * (this.E.z - 2 * this.Q.z + this.S.z)); }
  /** Bezier parameter at arc length s. */
  tAt(s) {
    const L = this.len, n = this.n;
    if (s <= 0) return 0;
    if (s >= this.total) return 1;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= s) lo = m; else hi = m; }
    return (lo + (s - L[lo]) / Math.max(L[hi] - L[lo], 1e-9)) / n;
  }
  arcAt(t) { const f = clamp(t, 0, 1) * this.n, i = Math.min(this.n - 1, Math.floor(f)); return lerp(this.len[i], this.len[i + 1], f - i); }
}

/* ------------------------------------------------------------------ */
/* The whale shark                                                     */
/* ------------------------------------------------------------------ */
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d1 = new THREE.Vector3(), _d2 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _cam = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3(), _h = new THREE.Vector3();
const _C = new THREE.Vector3(), _S = new THREE.Vector3(), _E = new THREE.Vector3(), _x = new THREE.Vector3();

export class WhaleShark {
  /**
   * ctx: { W, env, camera, view, floorAt, surfY, obstacles: [{ x, z, r, top }], rng }
   */
  constructor(ctx) {
    const { W, env, rng } = ctx;
    this.ctx = ctx;
    this.env = env;
    this.rng = rng;
    this.camera = ctx.camera;
    this.view = ctx.view;
    this.group = new THREE.Group();
    this.group.name = 'whaleShark';

    const skin = paintSkin(((env.seed ^ 0x5a17) >>> 0) % 100000);
    this.textures = [skin.map, skin.normalMap];
    const mat = new THREE.MeshStandardMaterial({ map: skin.map, normalMap: skin.normalMap, normalScale: new THREE.Vector2(1, 1), roughness: 0.6, metalness: 0, envMapIntensity: 0.55 });
    this.u = { uWsPh: { value: 0 }, uWsAmp: { value: 1 }, uWsBend: { value: 0 }, uVis: { value: 0 }, uWsGlow: { value: 0 } };
    patchMaterial(mat, {
      key: 'whaleshark',
      uniforms: { ...W, uWsPh: this.u.uWsPh, uWsAmp: this.u.uWsAmp, uWsBend: this.u.uWsBend, uWsGlow: this.u.uWsGlow },
      vertexHeader: UW_VERT + SWIM_V + 'varying float vWsX;',
      fragmentHeader: 'uniform float uWsPh, uWsGlow; varying float vWsX;',
      fragment: {
        // At night the plankton it pushes through lights up along its skin: a soft cyan rim that flows
        // back along the body with the swimming (no flicker: smooth in space and time)
        '#include <emissivemap_fragment>': /* glsl */`$&
          if (uWsGlow > 0.001) {
            float wsR = 1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0);
            float wsF = 0.72 + 0.28 * sin(vWsX * 16.0 + uWsPh);
            totalEmissiveRadiance += vec3(0.07, 0.36, 0.62) * uWsGlow * wsR * wsR * wsF;
          }`,
      },
      vertex: {
        '#include <beginnormal_vertex>': /* glsl */`$&
          { float wsS = (wsLat(position.x + 0.002) - wsLat(position.x - 0.002)) * 250.0;
            objectNormal.x -= wsS * objectNormal.z; objectNormal = normalize(objectNormal); }`,
        '#include <begin_vertex>': /* glsl */`$&
          vWsX = position.x;
          transformed.z += wsLat(position.x);
          transformed += aRem.xyz * sin(uTimeS * 5.0 + aRem.w);`,
      },
    });
    waterize(mat, W, { key: 'whaleshark', rim: 0.9 });
    // uVis dissolves the shark into the open-water colour behind it: visits begin and end deep in the
    // haze, and this makes sure nothing can pop even where the fog alone is not quite enough
    patchMaterial(mat, {
      key: 'wsvis',
      uniforms: { uVis: this.u.uVis },
      fragmentHeader: 'uniform float uVis;',
      fragment: { '#include <premultiplied_alpha_fragment>': 'gl_FragColor.rgb = mix(uwScatter(normalize(vUwPos - cameraPosition), cameraPosition.y, 2000.0), gl_FragColor.rgb, uVis);\n$&' },
    });
    this.mat = mat;
    this.geo = buildGeometry(((env.seed ^ 0x77) >>> 0) % 100000);
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.name = 'whaleSharkBody';
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.group.add(this.mesh);

    // pilot fish (same program as the reef's other fish)
    const q = Math.max(0.45, env.q);
    this.nPilot = Math.round(clamp(12 * q, 6, 10));
    this.pilotGeo = buildFishGeometry(SHAPES.reefPilot, { detail: 0.28 });   // small, mostly 20 m+ away
    const painted = paintFish('reefPilot', { seed: 23, shape: 'reefPilot', size: [512, 256] });
    this.textures.push(painted.map);
    const pmat = createFishMaterial(painted, { envMapIntensity: 1.2 });
    waterize(pmat, W, { key: 'fish', rim: 1.4 });
    this.pilotInst = new FishInstances(this.pilotGeo, pmat, this.nPilot, { castShadow: false });
    this.pilotInst.mesh.name = 'pilotFish';
    this.group.add(this.pilotInst.mesh);
    const pr = rng.fork('pilots');
    this.pilots = [];
    for (let i = 0; i < this.nPilot; i++) {
      const sw = new Swimmer({ pos: new THREE.Vector3(), size: pr.range(0.24, 0.33), speed: 1.1, rng: pr, agility: 3.2, maxPitch: 0.35 });
      sw.size0 = sw.size; sw.slot = i % SLOTS.length; sw.retarget = pr.range(4, 12);
      sw.w1 = pr.range(0.6, 1.1); sw.w2 = pr.range(0.5, 0.9); sw.p1 = pr.range(0, TAU); sw.p2 = pr.range(0, TAU);
      sw.slotPos = new THREE.Vector3();
      this.pilots.push(sw);
    }
    this.pilotRng = pr;

    this.path = new Path();
    this.pos = new THREE.Vector3();
    this.fwd = new THREE.Vector3(1, 0, 0);
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.active = false;
    this.wait = rng.range(20, 45);      // the first visit
    this.side = rng.chance(0.5) ? 1 : -1;
    this.tau = 0; this.P = 60; this.tc = 30; this.v = 1.1; this.TL = 11;
    this.ph = rng.range(0, TAU); this.roll = 0; this.bend = 0;
    this.warm = 6;                       // shown (out of sight) for the first frames so it compiles under the veil
    // what the rest of the reef reacts to
    this.state = ctx.state || { on: false, head: new THREE.Vector3(), tail: new THREE.Vector3(), mid: new THREE.Vector3(), fwd: new THREE.Vector3(1, 0, 0), r: 1, vis: 0, speed: 0 };
    this.group.visible = true;
    this.mesh.position.set(0, -400, 0);
  }

  /** Predicted camera position `tau` seconds ahead (the screensaver's orbit keeps turning the view). */
  planCamera(staticCam) {
    const cam = this.camera.position, T = this.view.target;
    const ox = cam.x - T.x, oy = cam.y - T.y, oz = cam.z - T.z;
    const dist = Math.max(4, Math.hypot(ox, oy, oz));
    const yaw0 = Math.atan2(ox, oz), pitch0 = Math.asin(clamp(oy / dist, -0.99, 0.99));
    const idle = !staticCam && this.env.isIdle && this.env.isIdle();
    const drift = idle ? (this.view.drift || 0) : 0;
    const pitch1 = idle && this.view.idlePitch !== undefined ? lerp(pitch0, this.view.idlePitch, 0.6) : pitch0;
    const tx = T.x, ty = T.y, tz = T.z;
    return {
      dist, pitch: pitch1,
      at(tau, out) {
        const yaw = yaw0 + drift * tau, p = tau > 0 ? pitch1 : pitch0, cp = Math.cos(p);
        return out.set(tx + dist * cp * Math.sin(yaw), ty + dist * Math.sin(p), tz + dist * cp * Math.cos(yaw));
      },
      target: new THREE.Vector3(tx, ty, tz),
    };
  }

  /** Is a body of length TL centred at p out of sight from the camera at c (looking at the target)? */
  hidden(p, c, target, TL) {
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z, d = Math.hypot(dx, dy, dz);
    if (d > 52) return true;
    _f.set(target.x - c.x, 0, target.z - c.z).normalize();
    const hd = Math.hypot(dx, dz) || 1;
    const ang = Math.acos(clamp((dx * _f.x + dz * _f.z) / hd, -1, 1));
    return ang - Math.atan2(TL * 0.55, d) > 0.92;   // ~53 degrees: outside even a 21:9 screen
  }

  /**
   * Plan a visit: candidates `from` .. `to` (of 260). Returns true as soon as one is safe; the visit is
   * postponed when all 260 fail (update() runs them a few dozen per frame, so the search never stalls).
   */
  plan(staticCam = false, from = 0, to = 260) {
    const r = this.rng, cp = this.planCamera(staticCam);
    const { floorAt, surfY, obstacles, movers } = this.ctx;
    const T = cp.target;
    const why = this.why || (this.why = { surface: 0, dur: 0, high: 0, obst: 0, cam: 0, start: 0, end: 0 });
    // A few milliseconds once per visit: candidates are cheap, and the haze is crowded with pinnacles.
    // A second, looser round (a wider band of distances, a little higher in the frame) only runs when
    // pinnacles box in the whole first one (that happens for a few fixed views; the screensaver's orbit
    // never stays on one).
    for (let attempt = from; attempt < to; attempt++) {
      const u = r.next(), relax = attempt >= 160;
      // far, middle distance, close; when the haze pinnacles keep blocking, try in front of them, then far
      const kind = relax ? (u < 0.5 ? 0 : 2) : attempt >= 120 ? 0 : attempt >= 60 ? (u < 0.5 ? 1 : 2) : u < 0.4 ? 0 : u < 0.75 ? 1 : 2;
      const D = relax ? (kind === 0 ? r.range(44, 52) : r.range(16, 20)) : kind === 0 ? r.range(36, 46) : kind === 1 ? r.range(27, 35) : r.range(19, 25);
      const side = attempt < 24 ? this.side : (r.chance(0.5) ? 1 : -1);
      const alpha = r.range(-0.38, 0.38) * (1 + Math.min(attempt, 80) / 80);
      // the ends: half a span to each side, each end receding into the blue (b > 0) or coming nearer
      // (b < 0: a diagonal pass that leaves the frame on the near side); the curve's radius at the
      // crossing is a^2 / (b1 + b2), kept above ~22 m so the giant only ever turns gently
      const a = r.range(24, 34) + (kind === 2 ? 4 : 0);
      let b1 = r.range(-12, 24) + (kind === 2 ? 5 : 0), b2 = r.range(-12, 24) + (kind === 2 ? 5 : 0);
      const bs = (b1 + b2) / (a * a);
      if (Math.abs(bs) > 0.045) { const k = 0.045 / Math.abs(bs); b1 *= k; b2 *= k; }
      const dy1 = r.range(-1.5, 1.5), dy2 = r.range(-1.5, 1.5);
      const v = r.range(0.95, 1.25);
      const TL = r.range(10.5, 12);
      const elev = r.range(0.13, 0.24);
      let tc = (a * 1.05) / v;
      for (let it = 0; it < 3; it++) {
        cp.at(tc, _cam);
        _f.set(T.x - _cam.x, 0, T.z - _cam.z).normalize();
        _r.set(-_f.z, 0, _f.x);
        _h.copy(_r).multiplyScalar(side).applyAxisAngle(_up, alpha);
        _C.copy(_cam).addScaledVector(_f, D);
        const axisY = _cam.y - D * Math.tan(cp.pitch);
        _C.y = clamp(axisY + D * Math.tan(elev), -40, surfY - 0.19 * TL - 0.8);
        const yMax = surfY - 0.19 * TL - 0.8;
        _S.copy(_C).addScaledVector(_h, -a).addScaledVector(_f, b1); _S.y = Math.min(_C.y + dy1, yMax);
        _E.copy(_C).addScaledVector(_h, a).addScaledVector(_f, b2); _E.y = Math.min(_C.y + dy2, yMax);
        this.path.set(_S, _C, _E);
        tc = this.path.arcAt(0.5) / v;
      }
      // clear of the reef, the far pinnacles and the kelp: lift the whole path if it runs low
      let lift = 0;
      const K = 48;
      for (let k = 0; k <= K; k++) {
        this.path.at(k / K, _v);
        this.path.d1(k / K, _d1).normalize();
        for (const o of [-0.5, 0, 0.5]) {
          const x = _v.x + _d1.x * TL * o, z = _v.z + _d1.z * TL * o;
          lift = Math.max(lift, floorAt(x, z) + 0.75 + 0.12 * TL - _v.y);
        }
      }
      if (lift > 0) {
        if (Math.max(_S.y, _C.y, _E.y) + lift > surfY - 0.19 * TL - 0.8) { why.surface++; continue; }
        _S.y += lift; _C.y += lift; _E.y += lift;
        this.path.set(_S, _C, _E);
      }
      // where it crosses, the body should sit in the upper middle of the frame, not at its top edge
      cp.at(tc, _cam);
      const axisYc = _cam.y - D * Math.tan(cp.pitch);
      if (Math.atan2(_C.y - axisYc, D) > (relax ? 0.31 : 0.29)) { why.high++; continue; }
      const P = this.path.total / v;
      if (P < 40 || P > 90) { why.dur++; continue; }
      let ok = true;
      for (let k = 0; k <= K && ok; k++) {
        this.path.at(k / K, _v);
        if (_v.y + 0.19 * TL > surfY - 0.6) { ok = false; why.surface++; break; }
        for (const ob of obstacles) {
          // a rounded rock (ellipsoid): its radius at the heights the body spans (belly .. dorsal fin)
          const lo = (_v.y - 0.13 * TL - ob.y) / ob.ry, hi = (_v.y + 0.18 * TL - ob.y) / ob.ry;
          if (lo >= 1) continue;
          const yl = hi < 0 ? hi : lo > 0 ? lo : 0;
          const rr = ob.r * Math.sqrt(Math.max(0, 1 - yl * yl));
          if (Math.hypot(_v.x - ob.x, _v.z - ob.z) < rr + 0.27 * TL + 0.5) { ok = false; why.obst++; break; }
        }
        // never close to the (moving) camera, nor to the manta if it is out on a visit
        const tk = this.path.arcAt(k / K) / v;
        cp.at(tk, _cam);
        if (ok && _v.distanceTo(_cam) < 14 + 0.25 * TL) { ok = false; why.cam++; }
        if (ok && movers) for (const m of movers) if (m.predict(tk, _x) && _v.distanceTo(_x) < 0.5 * TL + m.r) { ok = false; why.obst++; break; }
      }
      if (!ok) continue;
      // both ends out of sight (far in the haze or outside the view) for the camera at that moment
      cp.at(0, _cam);
      if (!this.hidden(_S, _cam, T, TL)) { why.start++; continue; }
      cp.at(P, _cam);
      if (!this.hidden(_E, _cam, T, TL)) { why.end++; continue; }
      this.P = P; this.v = v; this.TL = TL; this.tc = tc; this.kind = kind;
      this.side = r.chance(0.75) ? -side : side;   // mostly alternate left/right
      return true;
    }
    return false;
  }

  begin(staticCam = false) {
    if (!this.plan(staticCam)) { this.wait = 25; return false; }
    this.start();
    return true;
  }

  start() {
    this.active = true;
    this.tau = 0;
    this.mesh.scale.setScalar(this.TL);
    this.group.visible = true;
    this.sample(0);
    this.roll = this.rollT;
    this.bend = this.bendT;
    this.placePilots();
  }

  /** Position, heading and turn at pass time tau (constant speed along the path). */
  sample(tau) {
    const t = this.path.tAt(this.v * tau);
    this.path.at(t, this.pos);
    this.path.d1(t, _d1);
    this.path.d2(_d2);
    const sp = _d1.length();
    this.fwd.copy(_d1).divideScalar(Math.max(sp, 1e-6));
    this.vel.copy(this.fwd).multiplyScalar(this.v);
    // signed horizontal curvature (+ = turning toward the shark's right)
    const hs = Math.max(Math.hypot(_d1.x, _d1.z), 1e-6);
    const kappa = (_d1.x * _d2.z - _d1.z * _d2.x) / (hs * hs * hs);
    this.kappa = kappa;
    this.rollT = clamp(kappa * 3.6, -0.2, 0.2);
    this.bendT = clamp(this.TL * kappa * 0.5, -0.08, 0.08);
  }

  placePilots() {
    for (const f of this.pilots) {
      this.slotWorld(f, 0, f.slotPos);
      f.pos.copy(f.slotPos);
      f.vel.copy(this.vel);
      f.fwd.copy(this.fwd);
      f.yawRate = 0; f.roll = 0; f.turn = 0;
      quatFromForward(f.quat, f.fwd, 0);
    }
  }

  slotWorld(f, time, out) {
    const sl = SLOTS[f.slot];
    _r.crossVectors(this.fwd, _up);
    if (_r.lengthSq() < 1e-6) _r.set(0, 0, 1);
    _r.normalize();
    _w.crossVectors(_r, this.fwd).normalize();
    const ax = sl[0] + Math.sin(time * f.w1 + f.p1) * 0.18, ay = sl[1] + Math.sin(time * f.w2 + f.p2) * 0.14, az = sl[2] + Math.sin(time * f.w1 * 0.8 + f.p2) * 0.2;
    return out.copy(this.pos).addScaledVector(this.fwd, this.TL * 0.5 + ax).addScaledVector(_w, ay).addScaledVector(_r, az);
  }

  /** Night factor (0..1) for the bioluminescent rim. */
  setNight(n) { this.u.uWsGlow.value = n; }

  /** Test hook: start a visit now (planned for the camera as it is) and jump to `t` s from its closest pass. */
  debug(t = 0) {
    this.active = false;
    if (!this.begin(true)) return false;
    this.tau = clamp(this.tc + t, 0, this.P - 0.05);
    this.sample(this.tau);
    this.roll = this.rollT; this.bend = this.bendT;
    this.placePilots();
    return true;
  }

  update(dt, time) {
    const st = this.state;
    if (!this.active) {
      st.on = false;
      if (this.warm > 0) { this.warm--; if (this.warm === 0) this.group.visible = false; }
      this.wait -= dt;
      if (this.wait > 0) return;
      // plan over a few frames, 40 candidates each (about a millisecond on a desktop)
      const from = this.planAt || 0, to = Math.min(260, from + 40);
      if (this.plan(false, from, to)) { this.planAt = 0; this.start(); }
      else { this.planAt = to >= 260 ? 0 : to; if (to >= 260) this.wait = 25; return; }
    }
    this.tau += dt;
    if (this.tau >= this.P) {
      this.active = false;
      this.group.visible = false;
      st.on = false;
      // start to start every 3–5 minutes
      this.wait = Math.max(30, this.rng.range(180, 300) - this.P);
      return;
    }
    this.sample(this.tau);
    this.roll = damp(this.roll, this.rollT, 0.8, dt);
    this.bend = damp(this.bend, this.bendT, 1.5, dt);
    // fade in and out over the first and last ~8 s (deep in the haze by then)
    const vis = smoothstep(0, 8, this.tau) * (1 - smoothstep(this.P - 8, this.P, this.tau));
    this.u.uVis.value = vis;
    quatFromForward(this.quat, this.fwd, this.roll);
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.quat);
    // tail beat: ~0.36 body lengths per stroke, so the stroke always matches the speed
    this.ph = (this.ph + dt * TAU * this.v / (0.36 * this.TL)) % TAU;
    this.u.uWsPh.value = this.ph;
    this.u.uWsBend.value = this.bend;
    st.on = vis > 0.02;
    st.vis = vis;
    st.speed = this.v;
    st.fwd.copy(this.fwd);
    st.mid.copy(this.pos);
    st.head.copy(this.pos).addScaledVector(this.fwd, this.TL * 0.5);
    st.tail.copy(this.pos).addScaledVector(this.fwd, -this.TL * 0.5);
    st.r = 0.095 * this.TL;
    this.updatePilots(dt, time, vis);
  }

  updatePilots(dt, time, vis) {
    const inst = this.pilotInst, k = smoothstep(0.0, 0.6, vis), pr = this.pilotRng;
    inst.begin();
    for (const f of this.pilots) {
      f.retarget -= dt;
      if (f.retarget <= 0) {
        // now and then a fish darts to another station round the snout
        let s = pr.int(0, SLOTS.length - 1);
        if (s === f.slot) s = (s + 1) % SLOTS.length;
        f.slot = s; f.retarget = pr.range(6, 14);
      }
      this.slotWorld(f, time, f.slotPos);
      _x.copy(f.slotPos).sub(f.pos);
      const dl = _x.length();
      _v.copy(this.vel).addScaledVector(_x, 1.6);
      if (dl > 1.2) _v.addScaledVector(_x, 0.4 / dl);
      // keep off the shark's head
      _w.copy(f.pos).sub(this.pos);
      const along = _w.dot(this.fwd);
      if (along > 0 && along < this.TL * 0.52) {
        _w.addScaledVector(this.fwd, -along);
        const rr = _w.length(), need = 0.1 * this.TL + 0.25;
        if (rr < need && rr > 1e-4) _v.addScaledVector(_w, (need - rr) / rr * 2.5);
      }
      const sp = _v.length(), cap = this.v + 1.3;
      if (sp > cap) _v.multiplyScalar(cap / sp);
      f.steer(_v, dt).integrate(dt);
      if (f.phase > 4096) f.phase %= TAU;
      if (f.flutter > 4096) f.flutter %= TAU;
      f.size = f.size0 * k;
      if (k > 0.01) inst.push(f);
    }
    inst.end(time % (20 * Math.PI));
  }

  dispose() {
    for (const t of this.textures) t.dispose();
    this.geo.dispose();
    this.pilotGeo.dispose();
  }
}

// for tests (tools/node-side checks of the path planner and the mesh)
export { Path, buildGeometry, section };
