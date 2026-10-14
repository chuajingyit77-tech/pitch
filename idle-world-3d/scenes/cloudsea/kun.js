// 云海 · 鲲 (Kun): a colossal sky whale that now and then swims through and above the sea of clouds.
//
// The creature
//   A ~58 m whale with long, wing-like pectoral fins (tubercles on their leading edges), broad flukes and a
//   small dorsal fin; flowing translucent veils trail from the fins and flukes. Slate-jade back, white-jade
//   belly and throat pleats (painted, countershaded), soft rim light and a wet sheen; scroll patterns, a
//   lateral line and spots that glow and breathe slowly at night (a pulse running head to tail, period 7 s).
//   Three draw calls while it is out: the body (opaque), the veils (premultiplied) and the cloud vapour it
//   raises (lit cloud puffs, shaded like every other cloud here). Nothing at all between passes.
// Motion
//   A pass is a dense path (uniform in arc length). The head advances along it at a constant speed; four
//   samples of the path under the body are fitted with a cubic that the vertex shader evaluates per vertex,
//   so the body follows exactly where its head went (no sliding). A vertical travelling wave on one
//   continuous, wrapped phase undulates it; the pectoral fins stroke on the same phase with a span-wise lag,
//   the flukes pitch with it and the veils follow with a delay. Everything is integrated with dt, so it is
//   the same at 30 and 60 fps.
// Schedule
//   First pass 20-45 s after the world opens, then one every 3-5 min (seeded). Each pass is planned when it
//   starts, for the camera as it is then and as it will drift in screensaver mode: candidate paths are scored
//   by how much of the body is in view, above the clouds and not hidden by the island, and one of the best is
//   taken. The Kun rises out of the clouds and sinks back into them, so it never pops in or out of view.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, smoothstep, damp, makeCanvas } from '../../lib/util.js';
import { SHARED_GLSL, CLOUD_TOP } from './common.js';
import { createPuffs, SEA_HEIGHT_GLSL, seaHeightUniforms } from './clouds.js';
import { DECODE_GLSL } from './flora.js';

/* ------------------------------------------------------------------ */
/* Body profile (fractions of the body length)                         */
/* ------------------------------------------------------------------ */
// A rounded snout (radius ~ sqrt(u)), the deepest girth a third of the way back, a laterally compressed tail
// stock with keels. top / bot: height of the back / depth of the belly above / below the spine axis, w: half
// width, yc: offset of the section centre.
const P_U = [0, 0.0015, 0.005, 0.011, 0.02, 0.032, 0.045, 0.06, 0.10, 0.15, 0.22, 0.30, 0.40, 0.50, 0.60, 0.70, 0.78, 0.85, 0.91, 0.96, 1.0];
const P_TOP = [0, 0.0072, 0.0128, 0.0186, 0.0246, 0.0306, 0.0366, 0.0428, 0.058, 0.072, 0.084, 0.090, 0.090, 0.084, 0.074, 0.061, 0.049, 0.038, 0.028, 0.019, 0.013];
const P_BOT = [0, 0.0098, 0.0178, 0.0262, 0.0352, 0.0444, 0.0526, 0.0606, 0.078, 0.091, 0.099, 0.100, 0.094, 0.084, 0.069, 0.052, 0.038, 0.027, 0.018, 0.012, 0.009];
const P_W = [0, 0.0092, 0.0167, 0.0248, 0.0335, 0.0424, 0.0502, 0.058, 0.071, 0.081, 0.090, 0.093, 0.090, 0.081, 0.068, 0.052, 0.037, 0.025, 0.016, 0.011, 0.008];
const P_YC = [0, -0.002, -0.004, -0.006, -0.007, -0.008, -0.008, -0.008, -0.007, -0.005, -0.003, 0, 0.002, 0.004, 0.006, 0.008, 0.010, 0.011, 0.012, 0.012, 0.012];
function spline(xs, ys, x) {
  let i = 0;
  while (i < xs.length - 2 && x > xs[i + 1]) i++;
  const x0 = xs[i], x1 = xs[i + 1], h = x1 - x0, t = clamp((x - x0) / h, 0, 1);
  const slope = k => (k <= 0 ? (ys[1] - ys[0]) / (xs[1] - xs[0]) : k >= xs.length - 1 ? (ys[k] - ys[k - 1]) / (xs[k] - xs[k - 1]) : (ys[k + 1] - ys[k - 1]) / (xs[k + 1] - xs[k - 1]));
  const m0 = slope(i) * h, m1 = slope(i + 1) * h, t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * m1;
}
const prof = u => ({ top: spline(P_U, P_TOP, u), bot: spline(P_U, P_BOT, u), w: spline(P_U, P_W, u), yc: spline(P_U, P_YC, u) });
const spow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */
// Rest frame: +x forward (snout at x = 0, tail stock end at x = -L), +y up, +z the Kun's right.
// Attributes: position, normal, uv (body: u along, v' = 0 dorsal .. 1 ventral, mirrored; fins: span, chord),
// aPart (0 body, 1 left fin, 2 right fin, 3 flukes, 4 dorsal fin), aHinge (fins and flukes: hinge point, span),
// aSide (+1 upper / -1 lower surface of a fin).
class Part {
  constructor(part) { this.part = part; this.pos = []; this.uv = []; this.hinge = []; this.side = []; this.idx = []; this.extra = []; }
  v(x, y, z, u, v, hinge = null, side = 0, extra = null) {
    this.pos.push(x, y, z); this.uv.push(u, v);
    this.hinge.push(...(hinge || [0, 0, 0, 0])); this.side.push(side);
    if (extra) this.extra.push(...extra);
    return this.pos.length / 3 - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  geometry({ normals = null, extraSize = 0 } = {}) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(this.pos.length / 3).fill(this.part), 1));
    g.setAttribute('aHinge', new THREE.Float32BufferAttribute(this.hinge, 4));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(this.side, 1));
    if (extraSize) g.setAttribute('aVeil', new THREE.Float32BufferAttribute(this.extra, extraSize));
    g.setIndex(this.idx);
    if (normals) g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    else g.computeVertexNormals();
    return g;
  }
}

/** A closed, thin fin loft. st: stations [{ le, te: Vector3, t: half thickness, sig }] from root to tip; n: unit
 *  thickness direction (the fin's upper side). The root ring stays open (it sits inside the body); the tip is
 *  closed by a fan. Returns the TE points per station (veils attach there). */
function finLoft(P, st, n, nC, hinge) {
  const ring = [];
  for (let k = 0; k <= nC; k++) ring.push((1 - Math.cos(Math.PI * k / nC)) / 2);
  const th = c => 2.6 * Math.sqrt(c) * Math.pow(1 - c, 1.1);
  const M = 2 * nC, base = [];
  const pt = new THREE.Vector3();
  for (const s of st) {
    const b0 = P.pos.length / 3;
    base.push(b0);
    const H = hinge ? [hinge.x, hinge.y, hinge.z, Math.max(0, s.sig)] : null;
    for (let k = 0; k <= nC; k++) {   // upper surface, LE -> TE
      const c = ring[k];
      pt.lerpVectors(s.le, s.te, c).addScaledVector(n, s.t * th(c));
      P.v(pt.x, pt.y, pt.z, Math.max(0, s.sig), c, H, 1);
    }
    for (let k = nC - 1; k >= 1; k--) {   // lower surface, TE -> LE
      const c = ring[k];
      pt.lerpVectors(s.le, s.te, c).addScaledVector(n, -s.t * th(c));
      P.v(pt.x, pt.y, pt.z, Math.max(0, s.sig), c, H, -1);
    }
  }
  // winding: the upper surface's first quad must face along n
  const a0 = new THREE.Vector3(), a1 = new THREE.Vector3(), a2 = new THREE.Vector3();
  const get = (i, out) => out.set(P.pos[i * 3], P.pos[i * 3 + 1], P.pos[i * 3 + 2]);
  get(base[0] + 1, a0); get(base[1] + 1, a1); get(base[0] + 2, a2);
  const flip = a1.sub(a0).cross(a2.sub(a0)).dot(n) < 0;
  const tri = (a, b, c) => (flip ? P.tri(a, c, b) : P.tri(a, b, c));
  for (let j = 0; j < st.length - 1; j++) for (let k = 0; k < M; k++) {
    const a = base[j] + k, b = base[j] + (k + 1) % M, c = base[j + 1] + k, d = base[j + 1] + (k + 1) % M;
    tri(a, c, b); tri(b, c, d);
  }
  // tip: a fan round a point just beyond the last station
  const s = st[st.length - 1], sp = st[st.length - 2];
  pt.lerpVectors(s.le, s.te, 0.42).add(new THREE.Vector3().lerpVectors(s.le, s.te, 0.42).sub(new THREE.Vector3().lerpVectors(sp.le, sp.te, 0.42)).multiplyScalar(0.6));
  const tip = P.v(pt.x, pt.y, pt.z, 1, 0.42, hinge ? [hinge.x, hinge.y, hinge.z, 1] : null, 0);
  const last = base[base.length - 1];
  for (let k = 0; k < M; k++) tri(last + k, tip, last + (k + 1) % M);
  return st.map(q => q.te.clone());
}

/** Builds the body (one merged geometry) and the veils. L: body length (m). */
export function kunGeometry(L, q = 0.45) {
  const NA = q >= 0.7 ? 36 : 28, NU = q >= 0.7 ? 104 : 78, nC = q >= 0.7 ? 8 : 7;
  /* ---- body ---- */
  const body = new Part(0);
  const us = [0.0012, 0.004];
  for (let i = 1; i <= NU; i++) { const t = i / NU, u = t - 0.07 * Math.sin(TAU * t); if (u > 0.0072) us.push(u); }
  const tipI = body.v(0.0, prof(0).yc * L, 0, 0, 0.5);
  const rings = [];
  for (const u of us) {
    const p = prof(u), e = 2 / lerp(2.25, 1.65, smoothstep(0.72, 0.97, u));
    const r0 = body.pos.length / 3;
    rings.push(r0);
    for (let j = 0; j < NA; j++) {
      const a = (j / NA) * TAU, c = Math.cos(a), s = Math.sin(a);
      const y = p.yc + (c >= 0 ? p.top : p.bot) * spow(c, e), z = p.w * spow(s, e);
      body.v(-u * L, y * L, z * L, u, a <= Math.PI ? a / Math.PI : (TAU - a) / Math.PI);
    }
  }
  for (let j = 0; j < NA; j++) body.tri(tipI, rings[0] + j, rings[0] + (j + 1) % NA);
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < NA; j++) {
    const a = rings[i] + j, b = rings[i] + (j + 1) % NA, c = rings[i + 1] + j, d = rings[i + 1] + (j + 1) % NA;
    body.tri(a, c, b); body.tri(b, c, d);
  }
  const capI = body.v(-1.006 * L, prof(1).yc * L, 0, 1, 0.5);
  const lastR = rings[rings.length - 1];
  for (let j = 0; j < NA; j++) body.tri(capI, lastR + (j + 1) % NA, lastR + j);

  /* ---- dorsal fin (bends with the body) ---- */
  const dors = new Part(4);
  {
    const st = [], nS = 9, ub = 0.6, pb = prof(ub);
    const yb = (pb.yc + pb.top) * L - 0.006 * L;
    for (let j = 0; j <= nS; j++) {
      const sig = -0.15 + 1.12 * j / nS;
      const h = Math.max(sig, 0), ch = 0.10 * L * Math.pow(1 - Math.min(h, 0.97), 0.85);
      const xle = -0.585 * L - 0.075 * L * Math.pow(h, 1.4);
      st.push({ le: new THREE.Vector3(xle, yb + 0.034 * L * sig, 0), te: new THREE.Vector3(xle - ch, yb + 0.034 * L * sig - 0.004 * L * h, 0), t: 0.08 * ch, sig: h });
    }
    finLoft(dors, st, new THREE.Vector3(0, 0, 1), 5, null);
    for (let i = 0; i < dors.uv.length; i += 2) { const x = dors.pos[(i / 2) * 3]; dors.uv[i] = -x / L; dors.uv[i + 1] = 0.02; }
  }

  /* ---- pectoral fins: long, wing-like, swept back, tubercles on the leading edge ---- */
  const S = 0.33 * L, uR = 0.255, pr = prof(uR), aR = 1.98;   // root on the lower flank (~113 deg from the top)
  const eR = 2 / 2.25;
  const fins = [], veils = [];
  const pecMeta = [];
  for (const sz of [-1, 1]) {
    const part = new Part(sz < 0 ? 1 : 2);
    const root = new THREE.Vector3(-uR * L, (pr.yc + pr.bot * spow(Math.cos(aR), eR)) * L * 0.92, sz * pr.w * spow(Math.sin(aR), eR) * L * 0.92);
    const Lam = 0.52, dih = 0.26;   // sweep back, droop (rad)
    const ds = new THREE.Vector3(-Math.sin(Lam), -Math.sin(dih), sz * Math.cos(dih) * Math.cos(Lam)).normalize();
    const dc = new THREE.Vector3(-1, 0, 0).addScaledVector(ds, ds.x).normalize();
    const dt = new THREE.Vector3().crossVectors(dc, ds).normalize();
    if (dt.y < 0) dt.negate();
    const chord = sig => 0.062 * L * (1 - 0.52 * sig) * Math.sqrt(Math.max(0.02, 1 - Math.pow(Math.max(sig, 0), 6)));
    const c0 = chord(0);
    const bump = sig => 0.0085 * L * Math.pow(Math.max(0, Math.sin(sig * Math.PI * 9 - 0.6)), 2) * smoothstep(0.15, 0.45, sig) * (1 - smoothstep(0.86, 0.98, sig));
    const st = [], nS = q >= 0.7 ? 22 : 17;
    for (let j = 0; j <= nS; j++) {
      const sig = j === 0 ? -0.07 : Math.min(0.985, Math.pow(j / nS, 0.92) * 0.985);
      const ch = chord(sig);
      const le = root.clone().addScaledVector(ds, sig * S).addScaledVector(dc, -0.42 * c0 + 0.28 * c0 * Math.max(sig, 0) - bump(Math.max(sig, 0)));
      st.push({ le, te: le.clone().addScaledVector(dc, ch), t: 0.13 * ch, sig });
    }
    const tes = finLoft(part, st, dt, nC, root);
    fins.push(part);
    pecMeta.push({ sz, root, ds, dc, dt, st, tes });
  }

  /* ---- flukes ---- */
  const fl = new Part(3);
  const tail = new THREE.Vector3(-L, prof(1).yc * L, 0);
  const B = 0.17 * L;
  const flukeMeta = [];
  for (const sz of [-1, 1]) {
    const st = [], nS = q >= 0.7 ? 18 : 14;
    const chord = sig => 0.078 * L * (1 - 0.6 * Math.pow(sig, 1.3)) * Math.sqrt(Math.max(0.02, 1 - Math.pow(sig, 8)));
    for (let j = 0; j <= nS; j++) {
      const sig = Math.min(0.99, Math.pow(j / nS, 0.9) * 0.99);
      const le = tail.clone().add(new THREE.Vector3(0.03 * L - 0.09 * L * Math.pow(sig, 1.5), 0.018 * L * Math.pow(sig, 2.2), sz * B * sig));
      const notch = 0.016 * L * (1 - smoothstep(0, 0.16, sig));
      const te = le.clone().add(new THREE.Vector3(-chord(sig) + notch + 0.006 * L * Math.sin(sig * Math.PI), 0, 0));
      st.push({ le, te, t: 0.11 * chord(sig) * (1 - 0.5 * sig), sig });
    }
    const tes = finLoft(fl, st, new THREE.Vector3(0, 1, 0), nC, tail);
    flukeMeta.push({ sz, st, tes });
  }

  const bodyGeo = mergeGeometries([body.geometry(), dors.geometry(), ...fins.map(f => f.geometry()), fl.geometry()]);
  bodyGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  /* ---- veils: translucent membranes trailing from the fins' and flukes' trailing edges ---- */
  const veilParts = [];
  const nR = 5;
  for (const m of pecMeta) {
    const V = new Part(m.sz < 0 ? 1 : 2);
    const cols = [];
    m.st.forEach((s, j) => { if (s.sig >= 0.3) cols.push(j); });
    const base = [];
    cols.forEach((j, ci) => {
      const s = m.st[j], sig = s.sig;
      const scal = 0.8 + 0.2 * Math.abs(Math.sin(sig * Math.PI * 5.5));
      const len = L * (0.04 + 0.07 * smoothstep(0.35, 0.95, sig) + 0.08 * smoothstep(0.86, 0.985, sig)) * scal;
      base.push(V.pos.length / 3);
      const ph = ci * 0.9;
      for (let k = 0; k <= nR; k++) {
        const rho = k / nR;
        // the free part trails back along the chord, curling a little toward the fin's underside
        const p = m.tes[j].clone().addScaledVector(m.dc, rho * len).addScaledVector(m.dt, -0.18 * rho * rho * len);
        V.v(p.x, p.y, p.z, sig, rho, [m.root.x, m.root.y, m.root.z, sig], 0, [rho, len, ph, 0]);
      }
    });
    for (let c = 0; c < base.length - 1; c++) for (let k = 0; k < nR; k++) {
      const a = base[c] + k, b = base[c] + k + 1, cc = base[c + 1] + k, d = base[c + 1] + k + 1;
      V.tri(a, b, cc); V.tri(b, d, cc);
    }
    const nrm = [];
    for (let i = 0; i < V.pos.length / 3; i++) nrm.push(m.dt.x, m.dt.y, m.dt.z);
    veilParts.push(V.geometry({ normals: nrm, extraSize: 4 }));
  }
  for (const m of flukeMeta) {
    const V = new Part(3);
    const base = [];
    m.st.forEach((s, j) => {
      if (s.sig < 0.18) return;
      const sig = s.sig, scal = 0.78 + 0.22 * Math.abs(Math.sin(sig * Math.PI * 4.5));
      const len = L * (0.035 + 0.065 * smoothstep(0.2, 0.9, sig)) * scal;
      base.push(V.pos.length / 3);
      for (let k = 0; k <= nR; k++) {
        const rho = k / nR;
        const p = m.tes[j].clone().add(new THREE.Vector3(-rho * len, -0.2 * rho * rho * len, m.sz * 0.12 * rho * rho * len * sig));
        V.v(p.x, p.y, p.z, sig, rho, [tail.x, tail.y, tail.z, sig], 0, [rho, len, j * 1.1 + (m.sz > 0 ? 2.0 : 0), 0]);
      }
    });
    for (let c = 0; c < base.length - 1; c++) for (let k = 0; k < nR; k++) {
      const a = base[c] + k, b = base[c] + k + 1, cc = base[c + 1] + k, d = base[c + 1] + k + 1;
      V.tri(a, b, cc); V.tri(b, d, cc);
    }
    const nrm = [];
    for (let i = 0; i < V.pos.length / 3; i++) nrm.push(0, 1, 0);
    veilParts.push(V.geometry({ normals: nrm, extraSize: 4 }));
  }
  const veilGeo = mergeGeometries(veilParts);
  veilGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return { body: bodyGeo, veil: veilGeo, pectoral: pecMeta.map(m => ({ root: m.root, span: S })), tail };
}

/* ------------------------------------------------------------------ */
/* Painted skin (albedo RGB + night glow mask A)                       */
/* ------------------------------------------------------------------ */
// u runs along the body (canvas x), v' from the dorsal midline (canvas top) to the ventral midline (bottom);
// both flanks share it (mirrored), so there is no seam. Albedo and glow are painted on two opaque canvases and
// packed into one DataTexture (a canvas' own alpha would lose the colour where the mask is 0).
function kunSkin(rng, W) {
  const H = W / 4, k = W / 1024;
  const A = makeCanvas(W, H), G = makeCanvas(W, H);
  const ga = A.getContext('2d'), gg = G.getContext('2d');
  ga.scale(k, k); gg.scale(k, k);
  const w = 1024, h = 256;
  // countershading: slate-jade back, grey-jade flank, white-jade belly
  const grad = ga.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#30554c'); grad.addColorStop(0.28, '#3f6359'); grad.addColorStop(0.44, '#6a8e82');
  grad.addColorStop(0.56, '#a6c0b4'); grad.addColorStop(0.66, '#d2e2d8'); grad.addColorStop(1, '#e4eee6');
  ga.fillStyle = grad; ga.fillRect(0, 0, w, h);
  // the belly's edge: wavy, higher on the throat, lower toward the tail (feathered in layers: no canvas blur on Safari 14)
  const edge = x => {
    const u = x / w;
    return h * (0.53 + 0.035 * Math.sin(u * 14.5 + 1.0) + 0.02 * Math.sin(u * 37 + 2.0) - 0.07 * (1 - smoothstep(0.0, 0.42, u)) + 0.09 * smoothstep(0.62, 1.0, u));
  };
  for (let l = 0; l < 7; l++) {
    ga.fillStyle = `rgba(220,234,225,${0.16 + l * 0.05})`;
    ga.beginPath(); ga.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) ga.lineTo(x, edge(x) - 9 + l * 3);
    ga.lineTo(w, h); ga.closePath(); ga.fill();
  }
  // dorsal mottling: pale freckles and darker blotches, like a blue whale
  for (let i = 0; i < 900; i++) {
    const x = rng.range(10, w), y = Math.pow(rng.next(), 1.4) * h * 0.5, r = rng.range(1.2, 5.5);
    ga.fillStyle = rng.chance(0.62) ? `rgba(160,190,182,${rng.range(0.10, 0.28)})` : `rgba(28,44,43,${rng.range(0.08, 0.2)})`;
    ga.beginPath(); ga.ellipse(x, y, r * rng.range(1, 1.8), r, rng.range(0, Math.PI), 0, TAU); ga.fill();
  }
  // throat pleats: fine grooves from the chin to the navel
  ga.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const y0 = h * (0.64 + i * 0.03);
    ga.strokeStyle = `rgba(150,170,164,${0.5 - i * 0.012})`; ga.lineWidth = 1.6;
    ga.beginPath();
    for (let x = 12; x <= 450; x += 6) { const u = x / 450; ga.lineTo(x, y0 + (h - y0) * 0.35 * u * u + Math.sin(x * 0.05 + i) * 0.8); }
    ga.stroke();
  }
  // the long mouth line curving up to its corner, a pale lip under it
  const mouth = [[2, 118], [40, 124], [90, 132], [125, 138], [140, 133], [146, 126]];
  const curve = (g, pts, width, col) => {
    g.strokeStyle = col; g.lineWidth = width; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
    g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]); g.stroke();
  };
  curve(ga, mouth.map(([x, y]) => [x, y + 3]), 2.0, 'rgba(226,236,230,0.8)');
  curve(ga, mouth, 3.2, '#22312f');
  // eye: dark, with a pale ring; it glows faintly at night
  ga.fillStyle = '#d2e2db'; ga.beginPath(); ga.ellipse(150, 112, 9, 7, 0, 0, TAU); ga.fill();
  ga.fillStyle = '#0f1918'; ga.beginPath(); ga.ellipse(150, 112, 6.5, 5, 0, 0, TAU); ga.fill();
  gg.fillStyle = '#000'; gg.fillRect(0, 0, w, h);
  const glowDot = (x, y, r, v) => { gg.fillStyle = `rgb(${v},${v},${v})`; gg.beginPath(); gg.arc(x, y, r, 0, TAU); gg.fill(); };
  glowDot(150, 112, 3.2, 255);
  // blowholes on the dorsal midline
  ga.strokeStyle = '#1d2c2a'; ga.lineWidth = 2.2;
  for (const d of [-1, 1]) { ga.beginPath(); ga.moveTo(152, 3 + d * 0); ga.lineTo(166, 6); ga.stroke(); }
  // auspicious cloud scrolls (祥云) along the upper flank: pale jade by day, glowing at night
  const scroll = (g, x, y, s, flip, col, width) => {
    g.strokeStyle = col; g.lineWidth = width; g.lineCap = 'round';
    g.beginPath();
    for (let t = 0; t <= 1.0001; t += 0.04) {   // a spiral curl
      const a = t * 4.4, r = s * (1 - 0.72 * t);
      g.lineTo(x + Math.cos(a + Math.PI) * r * flip, y + Math.sin(a + Math.PI) * r);
    }
    g.stroke();
    g.beginPath(); g.moveTo(x - s * flip, y);   // its tail sweeping back into the next one
    g.bezierCurveTo(x - s * 1.8 * flip, y + s * 0.9, x - s * 3.0 * flip, y - s * 0.4, x - s * 4.1 * flip, y + s * 0.35);
    g.stroke();
  };
  for (let x = 205, i = 0; x < 880; i++) {
    const s = lerp(12, 7, smoothstep(205, 880, x)), y = h * (0.3 + 0.035 * Math.sin(i * 1.7));
    scroll(ga, x, y, s, -1, 'rgba(176,214,201,0.55)', 2.2);
    scroll(gg, x, y, s, -1, 'rgb(255,255,255)', 2.6);
    if (i % 2 === 0) { scroll(ga, x + s * 1.6, y - s * 1.9, s * 0.55, -1, 'rgba(176,214,201,0.45)', 1.6); scroll(gg, x + s * 1.6, y - s * 1.9, s * 0.55, -1, 'rgb(200,200,200)', 2.0); }
    x += s * 5.2;
  }
  // the lateral line: a row of pale dots from behind the eye to the tail
  for (let x = 196; x < 980; x += 15) {
    const y = h * (0.43 + 0.04 * smoothstep(600, 980, x)) + Math.sin(x * 0.02) * 2, r = lerp(2.6, 1.6, x / 1000);
    ga.fillStyle = 'rgba(214,236,228,0.6)'; ga.beginPath(); ga.arc(x, y, r, 0, TAU); ga.fill();
    glowDot(x, y, r + 0.5, 235);
  }
  // twin rows of spots along the back, freckles on the head
  for (let x = 175; x < 940; x += rng.range(18, 28)) {
    for (const yy of [h * 0.055, h * 0.14]) {
      const y = yy + rng.range(-3, 3), r = rng.range(1.8, 3.2) * lerp(1, 0.7, x / 1000);
      ga.fillStyle = 'rgba(190,220,210,0.5)'; ga.beginPath(); ga.arc(x, y, r, 0, TAU); ga.fill();
      glowDot(x, y, r, 175);
    }
  }
  for (let i = 0; i < 40; i++) {
    const x = rng.range(8, 130), y = rng.range(h * 0.12, h * 0.4), r = rng.range(1, 2.2);
    ga.fillStyle = 'rgba(200,226,218,0.5)'; ga.beginPath(); ga.arc(x, y, r, 0, TAU); ga.fill();
    glowDot(x, y, r, 150);
  }
  const da = ga.getImageData(0, 0, W, H).data, dg = gg.getImageData(0, 0, W, H).data;
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { out[i * 4] = da[i * 4]; out[i * 4 + 1] = da[i * 4 + 1]; out[i * 4 + 2] = da[i * 4 + 2]; out[i * 4 + 3] = dg[i * 4]; }
  const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true; tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;   // sRGB values, decoded in the shader (mipmaps on WebGL 1 too)
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Shaders                                                             */
/* ------------------------------------------------------------------ */
const KUN_GLSL = /* glsl */`
${SEA_HEIGHT_GLSL}
uniform vec3 uC0, uC1, uC2, uC3;     // the spine path under the body, a cubic in u (0 snout .. 1 tail stock)
uniform float uLen, uPhase, uAmp, uWaveK, uRoll;
uniform vec4 uFin;     // stroke amplitude (rad), rest offset (rad), phase offset, span-wise lag
uniform vec4 uFluke;   // pitch amplitude, phase lag, veil lag, unused
attribute vec4 aHinge;
attribute float aPart, aSide;
vec3 kRotX(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
vec3 kRotZ(vec3 v, float a){ float c = cos(a), s = sin(a); return vec3(v.x * c - v.y * s, v.x * s + v.y * c, v.z); }
// the body's frame at u: spine point S (with the travelling wave), forward F, up U, right R
void kunFrame(float u, out vec3 S, out vec3 F, out vec3 U, out vec3 R){
  vec3 P = ((uC3 * u + uC2) * u + uC1) * u + uC0;
  vec3 dP = (3.0 * uC3 * u + 2.0 * uC2) * u + uC1;
  vec3 T = normalize(dP);
  vec3 up = normalize(vec3(0.0, 1.0, 0.0) - T * T.y);   // paths climb at well under 60 degrees
  up = up * cos(uRoll) + cross(-T, up) * sin(uRoll);
  float env = 0.12 + 0.88 * u * u;
  float ph = uWaveK * u - uPhase;
  float w = uAmp * env * sin(ph);
  float dw = uAmp * (1.76 * u * sin(ph) + env * uWaveK * cos(ph));
  S = P + up * w;
  vec3 Tb = normalize(dP + up * dw);
  F = -Tb;
  U = normalize(up - Tb * dot(up, Tb));
  R = cross(F, U);
}
float finAngle(float sig, float lagPh){ return uFin.y + uFin.x * (0.45 + 0.55 * sig) * sin(uPhase + uFin.z - uFin.w * sig - lagPh); }
float flukeAngle(float lagPh){ return uFluke.x * sin(uWaveK - uPhase - uFluke.y - lagPh); }
// rest point and normal -> world; ub: where on the body it is carried
void kunDeform(vec3 p, vec3 n, float part, vec4 hinge, float lagPh, out vec3 wp, out vec3 wn, out float ub){
  vec3 q = p, m = n;
  if (part > 0.5 && part < 2.5) {
    float a = finAngle(hinge.w, lagPh) * (part < 1.5 ? 1.0 : -1.0);
    q = hinge.xyz + kRotX(p - hinge.xyz, a); m = kRotX(n, a);
    ub = -hinge.x / uLen;
  } else if (part > 2.5 && part < 3.5) {
    float b = flukeAngle(lagPh);
    q = hinge.xyz + kRotZ(p - hinge.xyz, b); m = kRotZ(n, b);
    ub = 1.0;
  } else ub = clamp(-p.x / uLen, 0.0, 1.0);
  vec3 S, F, U, R;
  kunFrame(ub, S, F, U, R);
  wp = S + F * (q.x + ub * uLen) + U * q.y + R * q.z;
  wn = F * m.x + U * m.y + R * m.z;
}
`;

const BODY_VERT = /* glsl */`
${SHARED_GLSL}
${KUN_GLSL}
varying vec3 vW, vN;
varying vec2 vUv;
varying vec4 vInfo;   // part, fin surface side, cloud height under the vertex, body coordinate u
void main(){
  vec3 wp, wn; float ub;
  kunDeform(position, normal, aPart, aHinge, 0.0, wp, wn, ub);
  vW = wp; vN = wn; vUv = uv;
  vInfo = vec4(aPart, aSide, seaHeightAt(wp.xz), ub);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const KUN_FRAG_COMMON = /* glsl */`
${SHARED_GLSL}
${DECODE_GLSL}
uniform sampler2D tPattern, tNoise;
uniform vec3 uGlowCol;
uniform float uGlowAmt, uGlowPh, uVapT;
varying vec3 vW, vN;
varying vec2 vUv;
varying vec4 vInfo;
// colour of lit cloud tops seen in this direction (what the vapour and the cloud sea look like here)
vec3 cloudTop(vec3 V, vec3 L){
  return (uAmbient * 0.72 + uLightCol * 0.95) * 0.97 + uLightCol * pow(max(dot(-V, L), 0.0), 10.0) * 0.4;
}
float breathe(float u){ return 0.62 + 0.38 * sin(uGlowPh - u * 7.0); }
`;

const BODY_FRAG = /* glsl */`
${KUN_FRAG_COMMON}
void main(){
  float part = vInfo.x;
  vec3 N = vN / max(length(vN), 1e-4);
  vec3 toC = cameraPosition - vW;
  vec3 V = toC / max(length(toC), 1e-3);
  vec3 L = uLightDir;
  vec3 alb; float glow, thin = 0.0;
  if (part < 0.5 || part > 3.5) {
    vec4 tx = texture2D(tPattern, vUv);
    alb = csDecodeSRGB(tx.rgb); glow = tx.a;
    // soft occlusion where the flanks turn under toward the belly, and round the throat
    alb *= 1.0 - 0.28 * smoothstep(0.5, 0.78, vUv.y) * (1.0 - smoothstep(0.86, 1.0, vUv.y));
    if (part > 3.5) { thin = 0.45; alb = mix(alb, vec3(0.13, 0.2, 0.19), 0.35); glow = 0.0; }
  } else {
    // fins and flukes: slate above, pale jade below, the trailing edge and the tip paler and translucent
    float sig = vUv.x, c = vUv.y;
    vec3 top = vec3(0.04, 0.09, 0.072), under = vec3(0.34, 0.47, 0.42);
    alb = mix(under, top, smoothstep(-0.6, 0.6, vInfo.y));
    float edgeZone = smoothstep(0.55, 1.0, c) * 0.6 + smoothstep(0.7, 1.0, sig) * 0.4;
    alb = mix(alb, vec3(0.4, 0.62, 0.53), edgeZone * 0.6);
    // pale knobs along the pectoral fins' leading edges
    alb = mix(alb, vec3(0.7, 0.78, 0.74), (1.0 - smoothstep(0.0, 0.12, c)) * step(part, 2.5) * 0.6);
    thin = 0.35 + 0.65 * edgeZone;
    glow = smoothstep(0.78, 1.0, c) * 0.55;
  }
  float ndl = dot(N, L);
  float wr = clamp((ndl + 0.32) / 1.32, 0.0, 1.0);
  vec3 col = alb * (uLightCol * wr * wr + uAmbient * (0.66 + 0.4 * N.y) + uBounce * (0.3 - 0.3 * N.y));
  // light through the thin fins and the edges when the sun or moon is behind
  float bl = pow(max(dot(-V, L), 0.0), 3.0);
  col += alb * uLightCol * bl * (thin * 1.1 + 0.08);
  // a soft wet sheen and the sky in it at grazing angles
  vec3 Hh = normalize(L + V);
  col += uLightCol * pow(max(dot(N, Hh), 0.0), 36.0) * 0.11 * smoothstep(-0.05, 0.3, ndl);
  float nv = 1.0 - clamp(dot(N, V), 0.0, 1.0);
  float fr = nv * nv * nv * nv;
  col += hazeColor(reflect(-V, N)) * fr * 0.2;
  // a soft rim of light round the silhouette when the sun (or the moon) is behind it
  col += uLightCol * nv * nv * nv * pow(max(dot(-V, L), 0.0), 1.5) * 0.4;
  // bioluminescence: breathes slowly, a pulse running from head to tail
  col += uGlowCol * glow * breathe(vInfo.w) * uGlowAmt;
  // where it meets the cloud tops the body dissolves into vapour, streaming back along it
  float above = vW.y - vInfo.z;
  float nz = texture2D(tNoise, vec2(vInfo.w * 7.0 + uVapT, vUv.y * 1.3 + vInfo.y * 0.2)).r;
  float vap = clamp((1.0 - smoothstep(-0.5, 7.5, above)) * (0.62 + 0.8 * nz) - 0.08, 0.0, 1.0);
  col = mix(col, cloudTop(V, L), vap);
  // aerial perspective (a little lighter than the scenery's: it must keep its presence against the haze)
  col = mix(col, hazeColor(-V), fogAmountAt(vW) * 0.72);
  gl_FragColor = vec4(col, 1.0);
}`;

const VEIL_VERT = /* glsl */`
${SHARED_GLSL}
${KUN_GLSL}
attribute vec4 aVeil;   // rho (0 at the fin .. 1 free edge), length (m), ripple phase, unused
varying vec3 vW, vN;
varying vec2 vUv;
varying vec4 vInfo;
void main(){
  float rho = aVeil.x;
  vec3 wp, wn; float ub;
  // further out, the veil follows the fin's stroke later: it flows
  kunDeform(position, normal, aPart, aHinge, rho * uFluke.z, wp, wn, ub);
  wn = normalize(wn);
  wp += wn * sin(uPhase * 2.0 - rho * 4.5 + aVeil.z) * rho * rho * aVeil.y * 0.16;
  vW = wp; vN = wn; vUv = uv;
  vInfo = vec4(aPart, rho, seaHeightAt(wp.xz), ub);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const VEIL_FRAG = /* glsl */`
${KUN_FRAG_COMMON}
void main(){
  float rho = vUv.y, sig = vUv.x;
  vec3 N = vN / max(length(vN), 1e-4);
  if (!gl_FrontFacing) N = -N;
  vec3 toC = cameraPosition - vW;
  vec3 V = toC / max(length(toC), 1e-3);
  vec3 L = uLightDir;
  // fine rays along the membrane, faded out before they get thinner than a pixel
  float rp = sig * 64.0;
  float rays = sin(rp * 6.2831853) * (1.0 - smoothstep(0.25, 0.6, fwidth(rp)));
  float a = (1.0 - smoothstep(0.35, 1.0, rho)) * 0.78 * (0.88 + 0.12 * rays);
  vec3 alb = vec3(0.56, 0.8, 0.7);
  float bl = pow(max(dot(-V, L), 0.0), 2.0);
  vec3 col = alb * (uAmbient * 0.9 + uBounce * 0.35 + uLightCol * (0.25 + 0.45 * abs(dot(N, L)) + 1.2 * bl));
  col += uGlowCol * uGlowAmt * 0.3 * (1.0 - rho) * breathe(vInfo.w);
  // hidden under the cloud tops (the sea is opaque there anyway): fade the last metres instead of a hard line
  a *= smoothstep(0.0, 5.0, vW.y - vInfo.z);
  col = mix(col, hazeColor(-V), fogAmountAt(vW) * 0.72);
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a);
}`;

/* ------------------------------------------------------------------ */
/* The cloud sea's height on the CPU (same sampling as its vertex shader) */
/* ------------------------------------------------------------------ */
function seaSampler(sea, tex) {
  const S = tex.billow.size, data = tex.billow.tex.image.data, U = sea.uniforms, G = sea.grid;
  // mip pyramids of the height (R) and swell (A) channels, box-filtered like generateMipmap
  const mips = ch => {
    const out = [];
    let cur = new Float32Array(S * S);
    for (let i = 0; i < S * S; i++) cur[i] = data[i * 4 + ch] / 255;
    out.push(cur);
    for (let s = S; s > 1; s >>= 1) {
      const h = s >> 1, nx = new Float32Array(h * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < h; x++) nx[y * h + x] = (cur[(2 * y) * s + 2 * x] + cur[(2 * y) * s + 2 * x + 1] + cur[(2 * y + 1) * s + 2 * x] + cur[(2 * y + 1) * s + 2 * x + 1]) * 0.25;
      out.push(nx); cur = nx;
    }
    return out;
  };
  const R = mips(0), A = mips(3);
  const bil = (lv, u, v) => {
    const s = Math.max(1, S >> lv.idx), arr = lv.arr;
    const x = (u - Math.floor(u)) * s - 0.5, y = (v - Math.floor(v)) * s - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const at = (xx, yy) => arr[((yy % s) + s) % s * s + ((xx % s) + s) % s];
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
  const lvl = { idx: 0, arr: null };
  const tri = (pyr, u, v, lod) => {
    const l0 = Math.min(Math.floor(lod), pyr.length - 1), l1 = Math.min(l0 + 1, pyr.length - 1), f = lod - Math.floor(lod);
    lvl.idx = l0; lvl.arr = pyr[l0]; const a = bil(lvl, u, v);
    if (f < 1e-4 || l1 === l0) return a;
    lvl.idx = l1; lvl.arr = pyr[l1]; return a + (bil(lvl, u, v) - a) * f;
  };
  return (x, z) => {
    const L1 = U.uL1.value, L2 = U.uL2.value, L0 = U.uL0.value, R2 = U.uRot2.value;
    const r = Math.hypot(x, z), sp = Math.max(G.b * (r + G.A), TAU * r / G.segs);
    const lod1 = clamp(Math.log2(Math.max(sp * L1.x * S, 1)), 0, 9), lod2 = clamp(Math.log2(Math.max(sp * L2.x * S, 1)), 0, 9);
    const h1 = tri(R, x * L1.x + L1.y, z * L1.x + L1.z, lod1);
    const xr = x * R2.x - z * R2.y, zr = x * R2.y + z * R2.x;
    const h2 = tri(R, xr * L2.x + L2.y, zr * L2.x + L2.z, lod2);
    const sw = tri(A, x * L0.x + L0.y, z * L0.x + L0.z, 5);
    return CLOUD_TOP + (h1 - 0.45) * L1.w * (0.55 + 0.9 * sw) + (h2 - 0.5) * L2.w + (sw - 0.5) * L0.w - r * r * U.uCurve.value;
  };
}

/* ------------------------------------------------------------------ */
/* Pass paths                                                          */
/* ------------------------------------------------------------------ */
const DS = 1.0;            // path sample spacing (m of arc length)
const MAXP = 2400;         // samples
const Y_DEEP = CLOUD_TOP - 33;   // below the deepest troughs of the cloud sea (~CLOUD_TOP - 19) by a body's height

/** Vertical profile of a pass, as a function of horizontal distance h along it (0 = where the head starts). */
function profileY(pr, h) {
  const { hr, ht, hf, yTop, arch } = pr;
  if (h <= 0) return Y_DEEP + h * pr.s0;
  if (h < hr) { const x = h / hr; return Y_DEEP + (yTop - Y_DEEP) * (1 - (1 - x) * (1 - x)); }
  if (h < hr + ht) { const x = (h - hr) / ht; return yTop + arch * 0.5 * (1 - Math.cos(TAU * x)); }
  const H = hr + ht + hf;
  if (h < H) { const x = (h - hr - ht) / hf; return yTop - (yTop - Y_DEEP) * x * x; }
  return Y_DEEP - (h - H) * pr.s1;
}

/* ------------------------------------------------------------------ */
/* The Kun                                                             */
/* ------------------------------------------------------------------ */
/**
 * opts: { glowU (the clouds' caster / glow uniforms), occluders: [{ type:'sphere', c, r } | { type:'cyl', x, z, r, y0, y1 }],
 *         obstacles: [{ x, z, r, y0, y1 }], drift (the view's idle drift rad/s) }
 */
export function createKun(env, shared, tex, sea, opts) {
  const q = env.q, rng = env.rng.fork('kun');
  const L = 58 * rng.range(0.94, 1.06);
  const geo = kunGeometry(L, q);
  const skin = kunSkin(rng.fork('skin'), q >= 0.7 ? 1024 : 512);
  const uniforms = Object.assign({}, shared, seaHeightUniforms(sea), {
    uC0: { value: new THREE.Vector3() }, uC1: { value: new THREE.Vector3(0, 0, -L) }, uC2: { value: new THREE.Vector3() }, uC3: { value: new THREE.Vector3() },
    uLen: { value: L }, uPhase: { value: 0 }, uAmp: { value: 0.028 * L }, uWaveK: { value: TAU * 0.72 }, uRoll: { value: 0 },
    uFin: { value: new THREE.Vector4(0.3, 0.0, -1.1, 0.9) }, uFluke: { value: new THREE.Vector4(0.42, 1.25, 1.1, 0) },
    tPattern: { value: skin }, tNoise: { value: tex.noise },
    uGlowCol: { value: new THREE.Color(0.32, 1.0, 0.8) }, uGlowAmt: { value: 0 }, uGlowPh: { value: 0 }, uVapT: { value: 0 },
  });
  const bodyMat = new THREE.ShaderMaterial({ uniforms, vertexShader: BODY_VERT, fragmentShader: BODY_FRAG, extensions: { derivatives: true, shaderTextureLOD: true } });
  const veilMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: VEIL_VERT, fragmentShader: VEIL_FRAG, extensions: { derivatives: true, shaderTextureLOD: true },
    transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide,
  });
  const body = new THREE.Mesh(geo.body, bodyMat);
  const veil = new THREE.Mesh(geo.veil, veilMat);
  body.name = 'kun'; veil.name = 'kunVeil';
  for (const m of [body, veil]) { m.frustumCulled = false; m.castShadow = false; m.receiveShadow = false; }
  veil.renderOrder = 2.5;

  /* ---- vapour: cloud puffs it raises where it breaks the surface, and wisps streaming off its back ---- */
  const NP = q >= 0.7 ? 56 : 40;
  const vrng = rng.fork('vapour');
  const items = [];
  const P = [];
  for (let i = 0; i < NP; i++) {
    items.push({ x: 0, y: -500, z: 0, r: 0, seed: vrng.next(), shade: 0.7, alpha: 0, cx: 0, cy: -500, cz: 0, cr: 10, grp: null, thin: 0 });
    P.push({ age: 0, life: 0, vx: 0, vy: 0, vz: 0, r0: 0, r1: 0, a0: 0, rise: 0, dragH: 0.45, dragV: 0.45, fin: 0.12, blow: false });
  }
  // the blow's puffs are sorted as one plume (fixed order inside it: overlapping puffs never swap and pop) and
  // shaded round its middle, so it reads as one bushy column of vapour, not a row of separate balls
  const blowGrp = { x: 0, y: -500, z: 0 };
  const puffs = createPuffs(shared, tex, items, { dynamic: true, glow: opts.glowU, hysteresis: 0.03 });
  puffs.mesh.renderOrder = 2;
  puffs.mesh.name = 'kunVapour';
  let puffHead = 0, livePuffs = 0;
  function emit(x, y, z, vx, vy, vz, r0, r1, life, a0, rise, dragH = 0.45, dragV = dragH, fin = 0.12, blow = false) {
    // a free slot (or one in its last moments, already faded): a puff still showing is never taken over
    let i = -1;
    for (let k = 0; k < NP; k++) {
      const j = (puffHead + k) % NP;
      if (P[j].life <= 0 || P[j].age > P[j].life * 0.97) { i = j; break; }
    }
    if (i < 0) return;
    puffHead = (i + 1) % NP;
    const p = P[i], it = items[i];
    p.age = 0; p.life = life; p.vx = vx; p.vy = vy; p.vz = vz; p.r0 = r0; p.r1 = r1; p.a0 = a0; p.rise = rise;
    p.dragH = dragH; p.dragV = dragV; p.fin = fin; p.blow = blow;
    it.x = x; it.y = y; it.z = z; it.r = r0 * 0.6; it.alpha = 0; it.seed = vrng.next(); it.grp = blow ? blowGrp : null; it.shade = blow ? 1 : 0.7; it.thin = blow ? 0.8 : 0;
    it.cx = x; it.cy = y - r0 * 1.2; it.cz = z; it.cr = r0 * 2.5;
  }

  const group = new THREE.Group();
  group.name = 'kunGroup';
  group.add(body, veil, puffs.mesh);
  // trackers: their transforms follow the head, the middle and the tail (the motion probe reads them; no cost)
  const track = ['kunHead', 'kunMid', 'kunTail'].map(n => { const o = new THREE.Object3D(); o.name = n; group.add(o); return o; });
  body.visible = veil.visible = puffs.mesh.visible = false;

  const seaH = seaSampler(sea, tex);
  // A pass circles the view target at radius D (bearing b0 + sgn h / D at horizontal distance h) with the height
  // profileY(h). The horizontal speed along such an arc is the same for every D, so the arc-length table h(s)
  // depends on the profile only, and every point of the path is exact (no polyline).
  const tables = [0, 1, 2].map(() => ({ hOfS: new Float32Array(MAXP), n: 0, pr: null }));
  const path = { tb: tables[0], cx: 0, cz: 0, D: 300, b0: 0, sgn: 1 };
  function profileTable(tb, pr) {
    const h0 = -(L + 40), h1 = pr.hr + pr.ht + pr.hf + L + 40, H = tb.hOfS;
    let s = 0, i = 0, py = profileY(pr, h0);
    H[0] = h0;
    // fine steps in h, written out every DS of arc length
    for (let h = h0 + 0.25; h <= h1 && i < MAXP - 1; h += 0.25) {
      const y = profileY(pr, h), ds = Math.hypot(0.25, y - py);
      const s1 = s + ds;
      while ((i + 1) * DS <= s1 && i < MAXP - 1) { i++; H[i] = h - 0.25 + 0.25 * (i * DS - s) / ds; }
      s = s1; py = y;
    }
    tb.pr = pr; tb.n = i + 1;
    const sOfH = hh => { let j = 0; while (j < tb.n - 1 && H[j + 1] < hh) j++; return j * DS + DS * clamp((hh - H[j]) / Math.max(H[j + 1] - H[j], 1e-6), 0, 1); };
    tb.sStart = sOfH(0); tb.sMid = sOfH(pr.hr + pr.ht * 0.5); tb.sEnd = sOfH(pr.hr + pr.ht + pr.hf) + L + 12;
    tb.dur = (tb.sEnd - tb.sStart) / pr.v; tb.tauMid = (tb.sMid - tb.sStart) / pr.v;
    // when the middle of the body breaks out of the cloud tops, and when it sinks back into them
    let hb = 0, hd = pr.hr + pr.ht;
    while (hb < pr.hr && profileY(pr, hb) < CLOUD_TOP) hb += 1;
    while (hd < pr.hr + pr.ht + pr.hf && profileY(pr, hd) > CLOUD_TOP) hd += 1;
    tb.tauRise = (sOfH(hb) + L * 0.5 - tb.sStart) / pr.v; tb.tauDive = (sOfH(hd) + L * 0.5 - tb.sStart) / pr.v;
    return tb;
  }
  const hAtS = (tb, s) => { const H = tb.hOfS, f = clamp(s / DS, 0, tb.n - 1.0001), i = Math.floor(f); return H[i] + (H[i + 1] - H[i]) * (f - i); };
  const pathAt = (s, out) => {
    const tb = path.tb, H = tb.hOfS;
    const f = clamp(s / DS, 0, tb.n - 1.0001), i = Math.floor(f), h = H[i] + (H[i + 1] - H[i]) * (f - i);
    const b = path.b0 + path.sgn * h / path.D;
    return out.set(path.cx + path.D * Math.sin(b), profileY(tb.pr, h), path.cz + path.D * Math.cos(b));
  };

  /* ---- planning ---- */
  // occluders: the island's things (tested only when the line of sight crosses the island's bounding sphere),
  // and far things (cloud banks, floating islets); obstacles: what a path must keep clear of
  const occl = opts.occluders || [], far = opts.far || [], bound = opts.bound, obst = opts.obstacles || [];
  const _cp = new THREE.Vector3(), _cf = new THREE.Vector3(), _cr = new THREE.Vector3(), _cu = new THREE.Vector3(), _pt = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
  const segSphere = (c, dx, dy, dz, L2, o, r) => {
    const t = clamp(((o.x - c.x) * dx + (o.y - c.y) * dy + (o.z - c.z) * dz) / L2, 0, 1);
    const ex = c.x + dx * t - o.x, ey = c.y + dy * t - o.y, ez = c.z + dz * t - o.z;
    return ex * ex + ey * ey + ez * ez < r * r;
  };
  function hits(list, c, dx, dy, dz, L2) {
    for (const o of list) {
      if (o.type === 'sphere') { if (segSphere(c, dx, dy, dz, L2, o.c, o.r)) return true; continue; }
      // vertical cylinder: where the segment's ground track is inside the circle, is it between y0 and y1?
      const ox = c.x - o.x, oz = c.z - o.z, a = dx * dx + dz * dz, b = 2 * (ox * dx + oz * dz), cc = ox * ox + oz * oz - o.r * o.r;
      const disc = b * b - 4 * a * cc;
      if (disc <= 0 || a < 1e-9) continue;
      const sq = Math.sqrt(disc), t0 = clamp((-b - sq) / (2 * a), 0, 1), t1 = clamp((-b + sq) / (2 * a), 0, 1);
      if (t1 <= t0) continue;
      const y0 = c.y + dy * t0, y1 = c.y + dy * t1;
      if (Math.max(y0, y1) > o.y0 && Math.min(y0, y1) < o.y1) return true;
    }
    return false;
  }
  /** Is the line of sight camera -> p hidden by the island (its tree, buildings, rock), a cloud bank or an islet? */
  function occluded(c, p) {
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z, L2 = dx * dx + dy * dy + dz * dz;
    if (hits(far, c, dx, dy, dz, L2)) return true;
    return (!bound || segSphere(c, dx, dy, dz, L2, bound.c, bound.r)) && hits(occl, c, dx, dy, dz, L2);
  }
  // A plan is worked out over a few frames (a handful of candidates each), never in one long frame.
  const job = { on: false, list: [], k: 0, best: null, cam: { psi0: 0, hd: 0, cy: 0, tx: 0, ty: 0, tz: 0, tanV: 0, tanH: 0 }, drift: 0, pref: 'soar' };
  const VARIANTS = [
    { kind: 'glide', y: [9, 14], hr: [135, 150], ht: [110, 160], hf: [125, 140], v: [6.5, 7.8], D: [290, 380, 480], arch: [-1, 2.5] },
    { kind: 'soar', y: [42, 50], hr: [175, 195], ht: [25, 50], hf: [165, 180], v: [7.0, 8.2], D: [250, 320, 400], arch: [2, 5] },
    { kind: 'soar', y: [58, 68], hr: [200, 220], ht: [20, 40], hf: [185, 200], v: [7.6, 8.6], D: [250, 320, 400], arch: [2, 4] },
  ];
  const PHIS = [-0.66, -0.4, -0.15, 0.1, 0.35, 0.6];
  /** Starts planning a pass for the camera as it is now and as it will turn in screensaver mode (drift, rad/s). */
  function planBegin(camera, viewTarget, drift, pref) {
    const c = job.cam, cam = camera.position, tgt = viewTarget;
    c.tx = tgt.x; c.ty = tgt.y; c.tz = tgt.z;
    const hx = cam.x - tgt.x, hz = cam.z - tgt.z;
    c.hd = Math.hypot(hx, hz); c.cy = cam.y - tgt.y; c.psi0 = Math.atan2(hx, hz);
    c.tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2); c.tanH = c.tanV * camera.aspect;
    job.drift = drift; job.pref = pref; job.list.length = 0; job.k = 0; job.best = null; job.on = true; job.align = 'mid';
    VARIANTS.forEach((V, vi) => {
      const pr = { kind: V.kind, yTop: CLOUD_TOP + rng.range(V.y[0], V.y[1]), hr: rng.range(V.hr[0], V.hr[1]), ht: rng.range(V.ht[0], V.ht[1]), hf: rng.range(V.hf[0], V.hf[1]), arch: rng.range(V.arch[0], V.arch[1]), v: rng.range(V.v[0], V.v[1]) };
      pr.s0 = 2 * (pr.yTop - Y_DEEP) / pr.hr; pr.s1 = 2 * (pr.yTop - Y_DEEP) / pr.hf;
      profileTable(tables[vi], pr);
      for (const D of V.D) for (const sgn of [-1, 1]) for (const phi of PHIS) job.list.push({ vi, D, sgn, phi, b0: 0, score: -1, bestTau: 0 });
    });
  }
  function camAt(tau) {   // predicted camera: orbiting the target with the screensaver's drift
    const c = job.cam, ps = c.psi0 + job.drift * tau;
    _cp.set(c.tx + c.hd * Math.sin(ps), c.ty + c.cy, c.tz + c.hd * Math.cos(ps));
    _cf.set(c.tx - _cp.x, c.ty - _cp.y, c.tz - _cp.z).normalize();
    _cr.crossVectors(_cf, _up).normalize(); _cu.crossVectors(_cr, _cf);
  }
  function scoreCandidate(cd) {
    const tb = tables[cd.vi], pr = tb.pr, c = job.cam, v = pr.v;
    path.tb = tb; path.cx = c.tx; path.cz = c.tz; path.D = cd.D; path.sgn = cd.sgn;
    // the middle of the body sits at phi (share of the half view width; positive: right of centre) at the middle of
    // the pass (or, for tests, as it breaks out of the clouds or dives back in)
    const tauA = job.align === 'rise' ? tb.tauRise : job.align === 'dive' ? tb.tauDive : tb.tauMid;
    const hMid = hAtS(tb, tb.sStart + v * tauA - L * 0.5);
    path.b0 = c.psi0 + Math.PI + job.drift * tauA - cd.phi * Math.atan(c.tanH) - cd.sgn * hMid / cd.D;
    cd.b0 = path.b0;
    for (let s = 0; s < tb.n * DS; s += 12) {
      pathAt(s, _pt);
      for (const o of obst) if (_pt.y > o.y0 - 12 && _pt.y < o.y1 + 12 && Math.hypot(_pt.x - o.x, _pt.z - o.z) < o.r + 30) { cd.score = 0; return; }
    }
    // seconds of body in view, above the clouds and not hidden
    let score = 0, peak = 0, bestVis = -1;
    for (let tau = 0; tau < tb.dur; tau += 2) {
      camAt(tau);
      const sh = tb.sStart + v * tau;
      let vis = 0, above = 0;
      for (let kk = 0; kk < 4; kk++) {
        pathAt(sh - L * (0.08 + 0.27 * kk), _pt);
        if (_pt.y < seaH(_pt.x, _pt.z) + 1.5) continue;
        above++;
        const dx = _pt.x - _cp.x, dy = _pt.y - _cp.y, dz = _pt.z - _cp.z;
        const zc = dx * _cf.x + dy * _cf.y + dz * _cf.z;
        if (zc < 1) continue;
        const xs = (dx * _cr.x + dy * _cr.y + dz * _cr.z) / (zc * c.tanH), ys = (dx * _cu.x + dy * _cu.y + dz * _cu.z) / (zc * c.tanV);
        if (Math.abs(xs) > 0.92 || Math.abs(ys) > 0.9) continue;
        if (occluded(_cp, _pt)) continue;
        vis++;
      }
      // weighted by how large it looks (a near pass shows it twice the size of a far one), and twice when it is
      // breaking out of the clouds or diving back in: the moments most worth seeing (a test framing one of those
      // counts only that moment)
      score += vis * 2 * 320 / cd.D * (above > 0 && above < 4 ? 2.2 : 1) * (job.align === 'mid' || Math.abs(tau - tauA) < 5 ? 1 : 0.05);
      peak = Math.max(peak, vis);
      // the best moment to look at (tests and screenshots): most of it in view, as high as it gets
      const pick = vis + (_pt.y - CLOUD_TOP) * 0.005;
      if (pick > bestVis) { bestVis = pick; cd.bestTau = tau; }
    }
    // in full view at least once; calm on screen (its turn rate against the drifting view); the kind wanted
    const rel = Math.abs(cd.sgn * v / cd.D - job.drift);
    cd.score = score * (peak >= 3 ? 1 : 0.5) * (1 - 0.5 * smoothstep(0.022, 0.04, rel)) * (pr.kind === job.pref ? 1.25 : 1);
  }
  /** Scores up to n more candidates; returns the plan once all are done (null while still working, false if none). */
  function planStep(n, force) {
    for (let i = 0; i < n && job.k < job.list.length; i++, job.k++) {
      const cd = job.list[job.k];
      scoreCandidate(cd);
      if (force && ((force.vi !== undefined && cd.vi !== force.vi) || (force.D !== undefined && cd.D !== force.D) || (force.sgn !== undefined && cd.sgn !== force.sgn))) cd.score *= 0.001;
      if (!job.best || cd.score > job.best.score) job.best = cd;
    }
    if (job.k < job.list.length) return null;
    job.on = false;
    const best = job.best;
    if (!best || best.score <= 0) return false;
    // one of the good ones: variety (nearer, farther, higher, lower, either way across the screen)
    const good = job.list.filter(c => c.score >= best.score * 0.8);
    const pick = (force ? best : good[Math.floor(rng.next() * good.length)]) || best;
    const tb = tables[pick.vi];
    path.tb = tb; path.cx = job.cam.tx; path.cz = job.cam.tz; path.D = pick.D; path.sgn = pick.sgn; path.b0 = pick.b0;
    return { pr: tb.pr, v: tb.pr.v, D: pick.D, sgn: pick.sgn, phi: pick.phi, score: pick.score, bestTau: pick.bestTau, dur: tb.dur, sStart: tb.sStart, sEnd: tb.sEnd, sMid: tb.sMid, tauRise: tb.tauRise, tauDive: tb.tauDive };
  }

  /* ---- runtime state ---- */
  const st = {
    clock: 0, next: rng.range(20, 45), n: 0, active: false, pass: null, tau: 0,
    phase: 0, glowPh: 0, vapT: 0, air: 0, rollPh: rng.range(0, TAU), fade: 0,
  };
  const Q = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _f = new THREE.Vector3(), _u = new THREE.Vector3(), _r = new THREE.Vector3(), _m = new THREE.Matrix4();
  const slices = 10, sliceE = new Float32Array(slices), sliceAcc = new Float32Array(slices * 2);
  const sliceProf = Array.from({ length: slices }, (_, k) => prof((k + 0.5) / slices)), blowProf = prof(0.155);   // (no allocation per frame)

  function begin(p) {
    st.pass = p; st.active = true; st.tau = 0; st.n++; st.blow = -1; st.blowK = 0;
    st.beat = TAU / (6.4 * Math.sqrt(7 / p.v));
    sliceE.fill(0); sliceAcc.fill(0);
    body.visible = veil.visible = puffs.mesh.visible = true;
  }
  function stop() {
    st.active = false; st.pass = null;
    if (opts.escort) opts.escort.on = false;
    body.visible = veil.visible = false;
    sea.glowPos[0].w = 0; sea.glowPos[1].w = 0; sea.casters[3].w = 0;
  }

  /** Spine samples -> cubic coefficients (Lagrange nodes 0, 1/3, 2/3, 1). */
  function setSpine(sh) {
    for (let k = 0; k < 4; k++) pathAt(sh - (k / 3) * L, Q[k]);
    const [q0, q1, q2, q3] = Q;
    uniforms.uC0.value.copy(q0);
    uniforms.uC1.value.set(0, 0, 0).addScaledVector(q0, -5.5).addScaledVector(q1, 9).addScaledVector(q2, -4.5).add(q3);
    uniforms.uC2.value.set(0, 0, 0).addScaledVector(q0, 9).addScaledVector(q1, -22.5).addScaledVector(q2, 18).addScaledVector(q3, -4.5);
    uniforms.uC3.value.set(0, 0, 0).addScaledVector(q0, -4.5).addScaledVector(q1, 13.5).addScaledVector(q2, -13.5).addScaledVector(q3, 4.5);
  }
  const cubic = (u, out) => {
    const C0 = uniforms.uC0.value, C1 = uniforms.uC1.value, C2 = uniforms.uC2.value, C3 = uniforms.uC3.value;
    return out.copy(C3).multiplyScalar(u).add(C2).multiplyScalar(u).add(C1).multiplyScalar(u).add(C0);
  };
  const cubicD = (u, out) => {
    const C1 = uniforms.uC1.value, C2 = uniforms.uC2.value, C3 = uniforms.uC3.value;
    return out.copy(C3).multiplyScalar(3 * u).addScaledVector(C2, 2).multiplyScalar(u).add(C1);
  };
  /** CPU copy of the shader's frame at u (spine point with the wave, forward, up, right). Own scratch vectors: any of
   *  the module's temporaries may be passed in as outputs. */
  const _ft = new THREE.Vector3(), _fb = new THREE.Vector3();
  function frameAt(u, S, F, U, R) {
    const ua = uniforms;
    cubicD(u, _ft); const T = _ft.normalize();
    U.set(0, 1, 0).addScaledVector(T, -T.y).normalize();
    R.crossVectors(_fb.copy(T).negate(), U);
    const cr = Math.cos(ua.uRoll.value), sr = Math.sin(ua.uRoll.value);
    U.multiplyScalar(cr).addScaledVector(R, sr);
    const env = 0.12 + 0.88 * u * u, ph = ua.uWaveK.value * u - ua.uPhase.value;
    const w = ua.uAmp.value * env * Math.sin(ph), dw = ua.uAmp.value * (1.76 * u * Math.sin(ph) + env * ua.uWaveK.value * Math.cos(ph));
    cubic(u, S).addScaledVector(U, w);
    cubicD(u, F).addScaledVector(U, dw).normalize().negate();
    U.addScaledVector(F, -U.dot(F)).normalize();
    R.crossVectors(F, U);
  }

  function update(dt, t, camera, tod, viewTarget, idle) {
    st.clock += dt;
    if (!st.active) {
      if (livePuffs) updatePuffs(dt, camera);
      if (st.clock < st.next) return;
      if (!job.on) planBegin(camera, viewTarget, idle ? opts.drift || 0 : 0, st.n === 0 || rng.chance(0.62) ? 'soar' : 'glide');
      const p = planStep(6);
      if (p === null) return;
      if (p === false) { st.next = st.clock + 20; return; }
      begin(p);
      // the pass runs from its scheduled time (planning takes a few frames, twice as many at 30 fps as at 60; the
      // Kun is deep in the clouds then): the same pass, to the same instant, at any frame rate
      st.tau = st.clock - st.next - dt;
      st.phase = (st.beat * (st.tau + dt)) % (TAU * 64);
      st.next = st.next + rng.range(180, 300);
    }
    const p = st.pass;
    st.tau += dt;
    const sh = p.sStart + p.v * st.tau;
    if (sh - L > p.sEnd || sh > (path.tb.n - 2) * DS) { stop(); return; }
    // one continuous phase for the body wave, the fins and the flukes; wrapped (a whole number of cycles)
    st.phase += st.beat * dt; if (st.phase > TAU * 64) st.phase -= TAU * 64;
    st.glowPh += dt * TAU / 7; if (st.glowPh > TAU * 64) st.glowPh -= TAU * 64;
    st.rollPh += dt * TAU / 13.7; if (st.rollPh > TAU * 64) st.rollPh -= TAU * 64;
    st.vapT = (st.vapT + dt * 0.035) % 1;
    setSpine(sh);
    // how much of it is out of the clouds (eases the fins' stroke from a glide to full wing beats)
    let out = 0;
    for (let k = 0; k < 5; k++) { cubic(0.1 + 0.2 * k, _a); if (_a.y > seaH(_a.x, _a.z) + 2) out++; }
    st.air = damp(st.air, out / 5, 0.8, dt);
    // bank gently toward the centre of the turn, plus a slow sway of its own
    const bank = -p.sgn * 0.06 + 0.035 * Math.sin(st.rollPh);
    const U = uniforms;
    U.uRoll.value = damp(U.uRoll.value, bank, 0.5, dt);
    U.uPhase.value = st.phase;
    U.uFin.value.x = lerp(0.16, 0.52, st.air);
    U.uFin.value.y = lerp(-0.1, -0.02, st.air);
    U.uGlowPh.value = st.glowPh;
    U.uVapT.value = st.vapT;
    const night = tod.night;
    U.uGlowAmt.value = 1.5 * smoothstep(0.25, 0.9, night);

    // trackers (head, middle, tail)
    for (let k = 0; k < 3; k++) {
      frameAt(k * 0.5, _a, _f, _u, _r);
      _m.makeBasis(_f, _u, _r);   // local x = forward
      track[k].position.copy(_a); track[k].quaternion.setFromRotationMatrix(_m);
    }
    // its glow lights the clouds round it at night; its shadow falls on them by day
    frameAt(0.38, _a, _f, _u, _r);
    const hs = seaH(_a.x, _a.z), hgt = _a.y - hs;
    const gk = smoothstep(0.25, 0.9, night) * (1 - smoothstep(4, 22, -hgt));
    if (gk > 0.002) {
      const br = 0.62 + 0.38 * Math.sin(st.glowPh - 0.38 * 7);
      sea.glowPos[0].set(_a.x, _a.y - 2, _a.z, 30);
      sea.glowCol[0].setRGB(0.07, 0.24, 0.2).multiplyScalar(gk * br);
      frameAt(0.78, _b, _f, _u, _r);
      const br2 = 0.62 + 0.38 * Math.sin(st.glowPh - 0.78 * 7);
      sea.glowPos[1].set(_b.x, _b.y - 1, _b.z, 20);
      sea.glowCol[1].setRGB(0.05, 0.18, 0.15).multiplyScalar(gk * br2);
    } else { sea.glowPos[0].w = 0; sea.glowPos[1].w = 0; }
    const sk = smoothstep(3, 12, hgt) * (1 - night);
    if (sk > 0.01) sea.casters[3].set(_a.x, _a.y, _a.z, 9 * sk); else sea.casters[3].w = 0;
    // the distant cranes come to circle on the line of sight in front of it (until it starts its dive)
    if (opts.escort) {
      const E = opts.escort, cam = camera.position;
      E.on = st.tau < p.tauDive - 6;
      E.p.copy(cam).lerp(_a, 0.45); E.p.y += 4;
      E.r.subVectors(_a, cam).cross(_up).normalize();
    }

    emitVapour(dt);
    updatePuffs(dt, camera);
  }

  /* ---- vapour ---- */
  const blowP = new THREE.Vector3();
  function emitVapour(dt) {
    const p = st.pass;
    // the blow: a few seconds after its head breaks out of the clouds it breathes out a plume from the blowhole
    {
      const pf = blowProf;
      frameAt(0.155, _a, _f, _u, _r);
      blowP.copy(_a).addScaledVector(_u, (pf.yc + pf.top) * L);
      if (st.blow < 0 && blowP.y > seaH(blowP.x, blowP.z) + 4) st.blow = 0;
      if (st.blow >= 0) {
        st.blow += dt;
        // 2.5 s after the head is out, one exhalation: eight puffs over 0.85 s, thrown up from the blowhole
        // (between straight up and the back's up), fast at first and slower as it ends, so they stand in a column
        // from the blowhole to some 15 m above it with a bushy crown (the high ones bloom widest). Each starts with
        // the body's own velocity and loses it over a second or two, so the plume rises with the head, then is
        // left behind as it swims on, drifting up and thinning out.
        while (st.blowK < 8 && st.blow > 2.5 + st.blowK * 0.12) {
          const k = st.blowK++, w = 1 - k / 7;
          const up = lerp(2.5, 13, w) * vrng.range(0.9, 1.1);
          _b.copy(_u).add(_up).normalize();
          const r0 = vrng.range(0.9, 1.3) * lerp(1, 1.4, w);
          const jx = vrng.range(-0.6, 0.6), jz = vrng.range(-0.6, 0.6);
          emit(blowP.x + _b.x * r0 * 0.4, blowP.y + _b.y * r0 * 0.4, blowP.z + _b.z * r0 * 0.4,
            _f.x * p.v + _b.x * up + jx, _f.y * p.v + _b.y * up, _f.z * p.v + _b.z * up + jz,
            r0, r0 * lerp(2.2, 4.4, w) * vrng.range(0.9, 1.1), vrng.range(5.5, 7.5), vrng.range(0.6, 0.78), 0.2, 0.9, 0.85, 0.03, true);
        }
      }
    }
    for (let k = 0; k < slices; k++) {
      const u = (k + 0.5) / slices, pf = sliceProf[k];
      frameAt(u, _a, _f, _u, _r);
      const top = _a.y + (pf.yc + pf.top) * L, bot = _a.y + (pf.yc - pf.bot) * L;
      const hsea = seaH(_a.x, _a.z);
      const e = clamp((top - hsea) / Math.max(top - bot, 1e-3), 0, 1);
      const de = (e - sliceE[k]) / Math.max(dt, 1e-4);
      sliceE[k] = e;
      if (e <= 0 || e >= 1 && top - hsea > 9) continue;
      // breaking the surface: a churned collar of cloud on both flanks; rising: wisps peel off the back
      const width = pf.w * L;
      const rate = (e > 0 && e < 1 ? 0.35 : 0) + clamp(Math.abs(de) * 4, 0, 1.2);
      sliceAcc[k * 2] += rate * dt;
      while (sliceAcc[k * 2] >= 1) {
        sliceAcc[k * 2] -= 1;
        const side = vrng.chance(0.5) ? 1 : -1, r0 = vrng.range(3.2, 5.5) * (0.8 + 0.4 * pf.w / 0.093);
        const x = _a.x + _r.x * side * (width + r0 * 0.3), z = _a.z + _r.z * side * (width + r0 * 0.3);
        emit(x, hsea + r0 * 0.35, z, -_f.x * p.v * 0.15 + _r.x * side * 0.8, 0.35, -_f.z * p.v * 0.15 + _r.z * side * 0.8, r0, r0 * vrng.range(1.8, 2.5), vrng.range(8, 12), vrng.range(0.65, 0.9), 0.05);
      }
      if (de > 0.02 && top - hsea > 0.5 && top - hsea < 8) {
        sliceAcc[k * 2 + 1] += clamp(de * 3, 0, 0.9) * dt;
        while (sliceAcc[k * 2 + 1] >= 1) {
          sliceAcc[k * 2 + 1] -= 1;
          const r0 = vrng.range(2.2, 3.6);
          const x = _a.x + _u.x * (pf.top * L * 0.8), y = top - r0 * 0.2, z = _a.z + _u.z * (pf.top * L * 0.8);
          emit(x, y, z, _f.x * p.v * 0.55, 0.9, _f.z * p.v * 0.55, r0, r0 * vrng.range(2.0, 2.8), vrng.range(6, 9), vrng.range(0.5, 0.7), 0.3);
        }
      }
    }
  }
  function updatePuffs(dt, camera) {
    let live = 0, bx = 0, by = 0, bz = 0, bw = 0;
    for (let i = 0; i < NP; i++) {
      const p = P[i], it = items[i];
      if (p.life <= 0) continue;
      p.age += dt;
      const f = p.age / p.life;
      if (f >= 1) { p.life = 0; it.alpha = 0; it.r = 0; it.y = -500; continue; }
      live++;
      const dh = Math.exp(-p.dragH * dt), dv = Math.exp(-p.dragV * dt);
      p.vx *= dh; p.vz *= dh; p.vy = p.vy * dv + p.rise * dt;
      it.x += p.vx * dt; it.y += p.vy * dt; it.z += p.vz * dt;
      const e = 1 - (1 - f) * (1 - f);
      it.r = lerp(p.r0, p.r1, e);
      it.alpha = p.a0 * smoothstep(0, p.fin, f) * (1 - smoothstep(0.4, 1, f));
      it.cx = it.x; it.cy = it.y - it.r * 1.2; it.cz = it.z; it.cr = it.r * 2.5;
      if (p.blow) { bx += it.x * it.r; by += it.y * it.r; bz += it.z * it.r; bw += it.r; }
    }
    if (bw > 0) {
      // the plume is sorted by its middle; a thin plume is lit right through (every puff fully exposed to the
      // sun or the moon, not shaded like the inside of a cumulus)
      blowGrp.x = bx / bw; blowGrp.y = by / bw; blowGrp.z = bz / bw;
      const Ld = shared.uLightDir.value;
      for (let i = 0; i < NP; i++) {
        if (!P[i].blow || P[i].life <= 0) continue;
        const it = items[i];
        it.cx = it.x - Ld.x * it.r * 2; it.cy = it.y - Ld.y * it.r * 2; it.cz = it.z - Ld.z * it.r * 2; it.cr = it.r * 3;
      }
    }
    livePuffs = live;
    if (!live && !st.active) { puffs.mesh.visible = false; return; }
    puffs.update(camera);
  }

  return {
    group, body, veil, puffs, state: st, L,
    update,
    /** Test hook: start a pass now (planned for the current view) and jump to `tau` s into it (default: the
     *  middle of its high part). The last few seconds are simulated so the vapour is there. */
    debug(camera, viewTarget, idle, tau, tod, force = {}) {
      // keep: stay on the current pass and only jump to another moment of it
      if (force.keep && st.active) {
        // later in the pass: simulate on to it (the vapour and the blow develop as they would)
        const p = st.pass, target = tau ?? p.bestTau;
        if (target < st.tau) { const pre = Math.min(target, 10); st.tau = target - pre; }
        while (st.active && st.tau < target - 1e-6) update(Math.min(1 / 30, target - st.tau), 0, camera, tod, viewTarget, idle);
        return { tau: target, dur: p.dur };
      }
      if (st.active) stop();
      // planned for the camera as it is (it jumps into the pass at once, the view has no time to drift); the best
      // plan is taken (not one of the good ones at random), optionally of a given variant / distance / direction
      planBegin(camera, viewTarget, 0, 'soar');
      if (force.align) job.align = force.align;
      const p = planStep(1e9, force);
      if (!p) return null;
      begin(p);
      st.next = st.clock + rng.range(180, 300);
      const target = tau ?? (job.align === 'rise' ? p.tauRise : job.align === 'dive' ? p.tauDive : p.bestTau);
      const pre = Math.min(target, 10);
      st.tau = target - pre;
      for (let s = 0; s < pre; s += 1 / 30) update(1 / 30, 0, camera, tod, viewTarget, idle);
      return { L, D: p.D, sgn: p.sgn, phi: p.phi, v: p.v, score: p.score, kind: p.pr.kind, yTop: p.pr.yTop, tau: target, dur: p.dur, tauRise: p.tauRise, tauDive: p.tauDive,
        cands: job.list.map(c => [c.vi, c.D, c.sgn, c.phi, +c.score.toFixed(1)]) };
    },
    dispose() { skin.dispose(); },
  };
}
