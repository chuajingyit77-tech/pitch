// 苍鹭 · the koi pond's gentle giant. A grey heron (about 1 m tall) now and then glides in on broad, slow
// wingbeats, lands in the shallows or on a stone, stands still for long stretches, wades with slow planted steps,
// stretches its neck, tilts its head at the water, preens, may strike at a minnow (never a named koi), then leaves.
//
// One skinned mesh (one draw call) built from parametric parts (torso, closed-wing mantle, S-neck, head and dagger
// bill, crest and breast plumes, legs and toes, flight wings), painted procedurally (feather rows, the black eye
// stripe and crest, neck streaks, dark flight feathers, a yellow bill) with a matching feather normal map. The rig is
// procedural and frame-rate independent: critically damped springs drive every target, the neck is a cubic Bezier of
// fixed length (bones placed by arc length, twist spread along it), the legs are two-bone IK chains whose feet stay
// planted in world space until they step, and the wings beat on a continuous phase.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, makeRng, makeCanvas, createNoise, normalMapFromHeight, patchMaterial } from '../../lib/util.js';

/* ------------------------------------------------------------------ */
/* Skeleton layout (heron-local frame: origin at the body centre,       */
/* +Z forward, +Y up, +X the heron's left)                              */
/* ------------------------------------------------------------------ */
const NECK_N = 10, NECK_L = 0.48;
const BI = {
  ROOT: 0, BODY: 1, TAIL: 2, NECK: 3, HEAD: 3 + NECK_N, CREST: 4 + NECK_N, CW: 5 + NECK_N, PLUME: 6 + NECK_N,
  HUM: [7 + NECK_N, 10 + NECK_N], FORE: [8 + NECK_N, 11 + NECK_N], HAND: [9 + NECK_N, 12 + NECK_N],
  TIB: [13 + NECK_N, 16 + NECK_N], TAR: [14 + NECK_N, 17 + NECK_N], FOOT: [15 + NECK_N, 18 + NECK_N],
};
const BONE_COUNT = 19 + NECK_N;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const NECK_BASE = V(0, 0.075, 0.13);
const HEAD_BIND = V(0, 0.075 + NECK_L, 0.13);
const CREST_OFF = V(0, 0.03, -0.03);            // head-local
const PLUME_BIND = V(0, 0.123, 0.168);
const CW_BIND = V(0, -0.025, -0.16);
const TAIL_BIND = V(0, -0.05, -0.2);
const SHOULDER = [V(0.05, 0.05, 0.075), V(-0.05, 0.05, 0.075)];
const L_HUM = 0.17, L_FORE = 0.21, L_HAND = 0.10;
const KNEE = [V(0.042, -0.112, 0.035), V(-0.042, -0.112, 0.035)];
const L_TIB = 0.21, L_TAR = 0.195;
const HIP = [V(0.042, -0.07, 0.02), V(-0.042, -0.07, 0.02)];
const STAND_H = 0.478;          // body centre above the floor under the feet, standing relaxed (the ankles bend a little)
const FOOT_DROP = 0.008;        // the foot bone sits this far above the floor (toe thickness)
const STAND_PITCH = -0.36;      // standing, the back slopes down to the tail (front up ~20° beyond the torso's own tilt)

/* ------------------------------------------------------------------ */
/* Small math helpers                                                   */
/* ------------------------------------------------------------------ */
/** Piecewise-smooth table lookup: rows [x, ...values], cosine-eased between rows. */
function table(rows, x, k) {
  if (x <= rows[0][0]) return rows[0][k];
  for (let i = 1; i < rows.length; i++) {
    if (x <= rows[i][0]) {
      const a = rows[i - 1], b = rows[i], t = (x - a[0]) / (b[0] - a[0]);
      return lerp(a[k], b[k], 0.5 - 0.5 * Math.cos(Math.PI * t));
    }
  }
  return rows[rows.length - 1][k];
}
/** signed power for superellipse sections */
const spow = (t, p) => Math.sign(t) * Math.pow(Math.abs(t), p);

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
class Spring3 {
  constructor() { this.x = new THREE.Vector3(); this.v = new THREE.Vector3(); }
  step(target, w, dt) {
    const ex = Math.exp(-w * dt);
    for (const c of ['x', 'y', 'z']) {
      const e = this.x[c] - target[c], a = (this.v[c] + w * e) * dt;
      this.x[c] = target[c] + (e + a) * ex; this.v[c] = (this.v[c] - w * a) * ex;
    }
    return this.x;
  }
  set(p) { this.x.copy(p); this.v.set(0, 0, 0); return this; }
  /** follow a prescribed path point: position set, velocity measured (later springs continue from it) */
  follow(p, dt) { if (dt > 0) this.v.subVectors(p, this.x).divideScalar(dt); this.x.copy(p); return this; }
}
/** quaternion from a basis given by its Z (exact) and an approximate Y */
function basisZY(q, Z, Yhint) {
  const z = _zz.copy(Z).normalize(), y = _yy.copy(Yhint).addScaledVector(z, -Yhint.dot(z));
  if (y.lengthSq() < 1e-10) y.set(0, 1, 0).addScaledVector(z, -z.y);
  y.normalize();
  const x = _xx.crossVectors(y, z);
  return q.setFromRotationMatrix(_mm.makeBasis(x, y, z));
}
const _xx = new THREE.Vector3(), _yy = new THREE.Vector3(), _zz = new THREE.Vector3(), _mm = new THREE.Matrix4();
/** angle a moved to the branch nearest b */
const nearAngle = (a, b) => b + ((((a - b) % TAU) + TAU + Math.PI) % TAU) - Math.PI;

/* ------------------------------------------------------------------ */
/* Atlas regions (UV rectangles [u0, v0, u1, v1])                        */
/* ------------------------------------------------------------------ */
const ATLAS_W = 1024, ATLAS_H = 512;
const R = {
  feather: [0.5625, 0.375, 1.0, 0.5],
  torso: [0.0, 0.75, 0.5, 1.0],
  panel: [0.5, 0.75, 1.0, 1.0],
  wing: [0.0, 0.5, 1.0, 0.75],
  neck: [0.0, 0.0, 0.125, 0.5],
  head: [0.125, 0.3125, 0.5, 0.5],
  legs: [0.125, 0.21875, 0.5, 0.3125],
  plume: [0.125, 0.125, 0.5, 0.21875],
  eye: [0.5, 0.375, 0.5625, 0.5],
};
const INSET = 3.5; // pixels kept clear of each region's border (mipmaps bleed less)
/** map a, b in [0, 1] into region r, inset */
function ruv(r, a, b) {
  const iu = INSET / ATLAS_W, iv = INSET / ATLAS_H;
  return [lerp(r[0] + iu, r[2] - iu, a), lerp(r[1] + iv, r[3] - iv, b)];
}

/* ------------------------------------------------------------------ */
/* Body plan (bind pose)                                                */
/* ------------------------------------------------------------------ */
// torso: s 0 (breast) .. 1 (tail tip): [s, half width, half height, centre offset y]
const TORSO = [
  [0.00, 0.000, 0.000, -0.014], [0.03, 0.032, 0.044, -0.018], [0.08, 0.052, 0.072, -0.024], [0.16, 0.065, 0.088, -0.026],
  [0.30, 0.071, 0.090, -0.018], [0.45, 0.068, 0.082, -0.008], [0.60, 0.058, 0.066, 0.000], [0.72, 0.045, 0.046, 0.004],
  [0.80, 0.036, 0.027, 0.006], [0.88, 0.037, 0.013, 0.004], [0.95, 0.034, 0.007, 0.002], [1.00, 0.026, 0.002, 0.000],
];
const torsoSpine = (s, out) => out.set(0, 0.03 - 0.09 * s - 0.04 * s * s, 0.18 - 0.5 * s);
function torsoPoint(s, phi, off, out) {
  torsoSpine(s, out);
  const w = table(TORSO, s, 1) + off, h = table(TORSO, s, 2) + off, yo = table(TORSO, s, 3);
  const n = 2.35;
  out.x += w * spow(Math.sin(phi), 2 / n);
  out.y += yo - h * spow(Math.cos(phi), 2 / n);
  return out;
}
// head + bill along head-local z: [z, half width, half height, centre y, section exponent]
const HEADP = [
  [-0.038, 0.000, 0.000, 0.016, 2.1], [-0.034, 0.010, 0.012, 0.016, 2.1], [-0.024, 0.017, 0.020, 0.015, 2.1],
  [-0.008, 0.0205, 0.0235, 0.014, 2.1], [0.008, 0.020, 0.0225, 0.013, 2.1], [0.022, 0.016, 0.018, 0.010, 2.0],
  [0.034, 0.0115, 0.0135, 0.006, 1.9], [0.046, 0.0078, 0.0108, 0.003, 1.75], [0.060, 0.0062, 0.0098, 0.0015, 1.6],
  [0.090, 0.0052, 0.0084, 0.0, 1.55], [0.120, 0.0042, 0.0066, -0.001, 1.5], [0.150, 0.0028, 0.0042, -0.002, 1.5],
  [0.168, 0.0013, 0.0020, -0.0025, 1.5], [0.175, 0.000, 0.000, -0.003, 1.5],
];
const HEAD_Z0 = -0.038, HEAD_Z1 = 0.175, BILL_Z = 0.047;
const NECK_R = [[0, 0.036], [0.08, 0.030], [0.2, 0.024], [0.45, 0.019], [0.7, 0.0165], [0.9, 0.016], [1.0, 0.0155]];
const TIB_R = [[0, 0.021], [0.25, 0.0135], [0.42, 0.0085], [0.5, 0.0068], [0.94, 0.0066], [1.0, 0.0076]];
const TAR_R = [[0, 0.0076], [0.06, 0.0064], [0.9, 0.006], [1.0, 0.0068]];
// flight wing outline (span x from the body centre): leading edge z and base trailing edge z
const WING_LE = [[0.045, 0.112], [0.2, 0.119], [0.40, 0.126], [0.47, 0.118], [0.53, 0.09], [0.575, 0.045], [0.6, 0.0]];
const WING_TE = [[0.045, -0.19], [0.2, -0.214], [0.40, -0.218], [0.45, -0.165], [0.52, -0.085], [0.575, -0.03], [0.6, 0.0]];
const X_ELBOW = SHOULDER[0].x + L_HUM, X_WRIST = X_ELBOW + L_FORE, X_TIP = 0.6;
// nine primaries per wing, fanned from the hand: [root along the hand 0..1, angle from straight back (rad), length]
const PRIMARIES = [[0.0, 0.3, 0.215], [0.12, 0.46, 0.235], [0.25, 0.62, 0.255], [0.37, 0.78, 0.27], [0.5, 0.93, 0.285], [0.62, 1.07, 0.29], [0.74, 1.2, 0.285], [0.86, 1.33, 0.27], [1.0, 1.46, 0.245]];

/* ------------------------------------------------------------------ */
/* Geometry assembly                                                    */
/* ------------------------------------------------------------------ */
class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.si = []; this.sw = []; this.thin = []; this.rough = []; this.idx = []; }
  get count() { return this.p.length / 3; }
  vert(p, n, m) {
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z);
    this.uv.push(m.uv[0], m.uv[1]);
    const ao = m.ao ?? 1; this.c.push(ao, ao, ao);
    const bw = m.bones; // [[bone, weight], ...] up to 4
    let tot = 0; for (const b of bw) tot += b[1];
    for (let k = 0; k < 4; k++) { const b = bw[k]; this.si.push(b ? b[0] : 0); this.sw.push(b ? b[1] / tot : 0); }
    this.thin.push(m.thin || 0); this.rough.push(m.rough ?? 0.84);
  }
  /**
   * (nu + 1) × (nv + 1) vertex grid from P(i, j, out). Normals from grid neighbours (wrapping round closed rings, so
   * a tube has no shading seam); `centre(i, j, out)` orients the surface outward; `hint(i, j, out)` gives the normal
   * where the grid collapses (poles).
   */
  grid(nu, nv, P, meta, { wrapV = false, centre = null, hint = null } = {}) {
    const base = this.count, pos = [];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const v = new THREE.Vector3(); P(i, j, v); pos.push(v); }
    const at = (i, j) => {
      i = clamp(i, 0, nu);
      if (wrapV) j = ((j % nv) + nv) % nv; else j = clamp(j, 0, nv);
      return pos[i * (nv + 1) + j];
    };
    const du = new THREE.Vector3(), dv = new THREE.Vector3(), nrm = new THREE.Vector3(), c = new THREE.Vector3();
    // orientation: decided once, at the middle of the grid
    let flip = false;
    if (centre) {
      const i = nu >> 1, j = nv >> 1;
      du.subVectors(at(i + 1, j), at(i - 1, j)); dv.subVectors(at(i, j + 1), at(i, j - 1));
      nrm.crossVectors(du, dv); centre(i, j, c);
      flip = nrm.dot(c.subVectors(at(i, j), c)) < 0;
    }
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      du.subVectors(at(i + 1, j), at(i - 1, j)); dv.subVectors(at(i, j + 1), at(i, j - 1));
      nrm.crossVectors(du, dv);
      if (flip) nrm.negate();
      if (nrm.lengthSq() < 1e-16) { if (hint) hint(i, j, nrm); else nrm.set(0, 1, 0); }
      nrm.normalize();
      this.vert(pos[i * (nv + 1) + j], nrm, meta(i, j));
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const a = base + i * (nv + 1) + j, b = a + nv + 1;
      if (flip) this.idx.push(a, a + 1, b, b, a + 1, b + 1); else this.idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  /** Tube along a centre-line function C(t) with radius r(t) (optionally elliptic: rx(t), rz along the frame). */
  tube(nu, nv, C, rad, meta, { up = V(0, 0, 1), ellip = 1, closeEnds = false } = {}) {
    // parallel-transport frames along the centre line
    const cs = [], T = [], N = [], Bn = [];
    for (let i = 0; i <= nu; i++) cs.push(C(i / nu, new THREE.Vector3()));
    for (let i = 0; i <= nu; i++) T.push(new THREE.Vector3().subVectors(cs[Math.min(nu, i + 1)], cs[Math.max(0, i - 1)]).normalize());
    let n0 = up.clone().sub(T[0].clone().multiplyScalar(up.dot(T[0])));
    if (n0.lengthSq() < 1e-8) n0 = new THREE.Vector3(1, 0, 0).sub(T[0].clone().multiplyScalar(T[0].x));
    n0.normalize();
    N.push(n0); Bn.push(new THREE.Vector3().crossVectors(T[0], n0));
    const q = new THREE.Quaternion();
    for (let i = 1; i <= nu; i++) {
      q.setFromUnitVectors(T[i - 1], T[i]);
      const n = N[i - 1].clone().applyQuaternion(q).normalize();
      N.push(n); Bn.push(new THREE.Vector3().crossVectors(T[i], n));
    }
    const P = (i, j, out) => {
      const t = i / nu, a = (j / nv) * TAU, r = (closeEnds && (i === 0 || i === nu)) ? 0 : rad(t);
      return out.copy(cs[i]).addScaledVector(N[i], Math.cos(a) * r).addScaledVector(Bn[i], Math.sin(a) * r * ellip);
    };
    this.grid(nu, nv, P, meta, { wrapV: true, centre: (i, j, out) => out.copy(cs[i]), hint: (i, j, out) => out.copy(T[i]).multiplyScalar(i === 0 ? -1 : 1) });
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

/** neck bone blend at fraction t of the neck (0 base .. 1 head) */
function neckBones(t) {
  const x = clamp(t, 0, 1) * NECK_N;
  if (x < 0.5) return [[BI.BODY, 1 - smoothstep(0, 0.5, x + 0.25)], [BI.NECK, smoothstep(0, 0.5, x + 0.25)]];
  if (x >= NECK_N - 0.5) { const k = smoothstep(NECK_N - 0.5, NECK_N, x); return [[BI.NECK + NECK_N - 1, 1 - k], [BI.HEAD, k]]; }
  const i = Math.floor(x - 0.5), f = (x - 0.5) - i;
  return [[BI.NECK + i, 1 - f], [BI.NECK + i + 1, f]];
}

function buildHeronGeometry(q) {
  const G = new Geo();
  const d = q >= 0.6 ? 1 : 0.8; // ring density
  const R2 = (x) => Math.max(4, Math.round(x * d));
  const tmp = new THREE.Vector3();

  // ---- torso ----
  {
    const nu = R2(42), nv = R2(28);
    G.grid(nu, nv, (i, j, out) => torsoPoint(i / nu, (j / nv) * TAU, 0, out), (i, j) => {
      const s = i / nu, phi = (j / nv) * TAU;
      const tail = smoothstep(0.66, 0.84, s);
      const belly = (1 + Math.cos(phi)) * 0.5; // 1 at the belly
      return { uv: ruv(R.torso, s, j / nv), bones: [[BI.BODY, 1 - tail], [BI.TAIL, tail]], ao: 1 - 0.12 * belly * smoothstep(0.3, 0.7, s), rough: 0.86 };
    }, { wrapV: true, centre: (i, j, out) => torsoSpine(i / nu, out), hint: (i, j, out) => out.set(0, 0.2, i === 0 ? 1 : -1) });
  }

  // ---- closed-wing mantle over the back and sides (one surface from lip to lip, tucked under at both lips) ----
  {
    const nu = R2(34), nv = R2(22);
    const PHI_LOW = 1.2;
    const sOf = u => lerp(0.10, 1.07, u);
    const P = (i, j, out) => {
      const u = i / nu, w = j / nv; // w: 0 left lip .. 0.5 back .. 1 right lip
      const s = sOf(u);
      // extent of the mantle round the body: rounded front, narrowing to the wingtips
      const ext = smoothstep(0.0, 0.2, u) * (1 - 0.82 * smoothstep(0.7, 1.0, u)) * 0.92 + 0.08;
      const phiLow = Math.PI - (Math.PI - PHI_LOW) * ext;
      // section path: tucked under the lip (k < 0.08), up over the back, down to the other lip
      let k = Math.abs(w - 0.5) * 2; // 0 back .. 1 lip
      const side = w < 0.5 ? 1 : -1;
      const tuck = smoothstep(0.9, 1.0, k);
      const phi = Math.PI - (Math.PI - phiLow) * Math.min(k, 0.9) / 0.9 + tuck * 0.07;
      const lift = (0.0045 + 0.0045 * Math.min(k, 0.9) / 0.9) * (1 - tuck) * smoothstep(0, 0.12, u) * (1 - smoothstep(0.96, 1, u));
      torsoPoint(Math.min(s, 0.86), side > 0 ? phi : TAU - phi, lift, out);
      const bk = smoothstep(0.74, 0.9, s);
      if (bk > 0) {
        // beyond the tail base the folded primaries lie over the tail as a narrow, slightly raised blade
        const e = Math.max(0, s - 0.86) / 0.3, kk = Math.min(k, 0.9) / 0.9;
        torsoSpine(0.86, tmp);
        const hw = lerp(0.044, 0.012, smoothstep(0, 1, e)) * Math.sin(kk * Math.PI * 0.5 + 0.0001);
        const bx = side * hw, by = tmp.y + 0.022 - 0.014 * e - (1 - Math.cos(kk * Math.PI * 0.5)) * 0.014 * (1 - e * 0.5) - tuck * 0.004;
        const bz = tmp.z - (s - 0.86) * 0.5;
        out.x = lerp(out.x, bx, bk); out.y = lerp(out.y, by, bk); out.z = lerp(out.z, bz, bk);
      }
      return out;
    };
    G.grid(nu, nv, P, (i, j) => {
      const u = i / nu, w = j / nv, k = Math.abs(w - 0.5) * 2;
      const tip = smoothstep(0.58, 0.8, u);
      return { uv: ruv(R.panel, u, w), bones: [[BI.BODY, 1 - tip], [BI.CW, tip]], ao: lerp(1, 0.62, smoothstep(0.86, 1, k)), rough: 0.84 };
    }, { centre: (i, j, out) => { torsoSpine(Math.min(sOf(i / nu), 0.86), out); out.y -= 0.03; return out; } });
  }

  // ---- neck (straight up in the bind pose) ----
  {
    const nu = R2(38), nv = R2(16);
    G.grid(nu, nv, (i, j, out) => {
      const t = i / nu, th = (j / nv) * TAU, r = table(NECK_R, t, 1);
      return out.set(Math.sin(th) * r * 0.92, NECK_BASE.y + t * NECK_L, NECK_BASE.z - Math.cos(th) * r * 1.1);
    }, (i, j) => {
      const t = i / nu;
      return { uv: ruv(R.neck, j / nv, t), bones: neckBones(t), ao: lerp(0.86, 1, smoothstep(0, 0.12, t)), rough: 0.86 };
    }, { wrapV: true, centre: (i, j, out) => out.set(0, NECK_BASE.y + (i / nu) * NECK_L, NECK_BASE.z) });
  }

  // ---- head and bill: one loft from the nape to the bill tip ----
  {
    const nu = R2(46), nv = R2(18);
    const zOf = i => lerp(HEAD_Z0, HEAD_Z1, Math.pow(i / nu, 1.0));
    G.grid(nu, nv, (i, j, out) => {
      const z = zOf(i), th = (j / nv) * TAU;
      const wx = table(HEADP, z, 1), wy = table(HEADP, z, 2), yc = table(HEADP, z, 3), n = table(HEADP, z, 4);
      return out.set(HEAD_BIND.x + wx * spow(Math.sin(th), 2 / n), HEAD_BIND.y + yc - wy * spow(Math.cos(th), 2 / n), HEAD_BIND.z + z);
    }, (i, j) => {
      const z = zOf(i), bill = smoothstep(BILL_Z - 0.004, BILL_Z + 0.004, z);
      const neckJoin = 1 - smoothstep(-0.02, 0.012, z);
      const th = (j / nv) * TAU, under = (1 + Math.cos(th)) * 0.5;
      // the back of the skull's underside blends into the top of the neck
      const bones = neckJoin * under > 0.02 ? [[BI.HEAD, 1 - 0.35 * neckJoin * under], [BI.NECK + NECK_N - 1, 0.35 * neckJoin * under]] : [[BI.HEAD, 1]];
      return { uv: ruv(R.head, i / nu, j / nv), bones, rough: lerp(0.84, 0.36, bill), thin: bill * Math.max(table(HEADP, z, 2), 0.0012) * 0.9, ao: 1 };
    }, { wrapV: true, centre: (i, j, out) => out.set(HEAD_BIND.x, HEAD_BIND.y + table(HEADP, zOf(i), 3), HEAD_BIND.z + zOf(i)), hint: (i, j, out) => out.set(0, 0, i === 0 ? -1 : 1) });
  }

  // ---- eyes ----
  for (const s of [1, -1]) {
    const z = 0.026, wx = table(HEADP, z, 1);
    const c = V(HEAD_BIND.x + s * (wx - 0.0026), HEAD_BIND.y + 0.0135, HEAD_BIND.z + z);
    const ax = V(s * 0.9, 0.12, 0.42).normalize(), r = 0.0058;
    const t1 = new THREE.Vector3().crossVectors(ax, V(0, 1, 0)).normalize(), t2 = new THREE.Vector3().crossVectors(ax, t1);
    const nu = 6, nv = 12;
    G.grid(nu, nv, (i, j, out) => {
      const th = (i / nu) * Math.PI * 0.5, ph = (j / nv) * TAU;
      return out.copy(c).addScaledVector(ax, Math.cos(th) * r).addScaledVector(t1, Math.sin(th) * Math.cos(ph) * r).addScaledVector(t2, Math.sin(th) * Math.sin(ph) * r);
    }, (i, j) => {
      const th = (i / nu) * Math.PI * 0.5, ph = (j / nv) * TAU, rr = Math.sin(th) * 0.5;
      return { uv: ruv(R.eye, 0.5 + rr * Math.cos(ph), 0.5 + rr * Math.sin(ph)), bones: [[BI.HEAD, 1]], rough: 0.1 };
    }, { wrapV: true, centre: () => c.clone(), hint: (i, j, out) => out.copy(ax) });
  }

  // ---- crest: two long black plumes from the nape ----
  {
    const root = HEAD_BIND.clone().add(CREST_OFF);
    for (const [sx, len] of [[0.0032, 0.135], [-0.0032, 0.113]]) {
      const dir = V(sx * 12, -0.28, -1).normalize();
      G.tube(R2(14), 5, (t, out) => out.copy(root).add(V(sx, 0, 0)).addScaledVector(dir, len * t).add(V(0, -0.03 * t * t, 0)),
        t => lerp(0.0028, 0.0007, t), (i) => {
          const t = i / R2(14);
          const k = smoothstep(0.05, 0.4, t);
          return { uv: ruv(R.plume, t * 0.5, 0.5), bones: [[BI.HEAD, 1 - k], [BI.CREST, k]], thin: lerp(0.0028, 0.0007, t), rough: 0.6 };
        });
    }
  }

  // ---- breast plumes hanging from the lower neck ----
  {
    const prng = makeRng(77);
    const n = 13;
    for (let k = 0; k < n; k++) {
      const th = lerp(-1.1, 1.1, k / (n - 1)) + prng.range(-0.06, 0.06);
      const t0 = prng.range(0.05, 0.16), len = prng.range(0.075, 0.12) * (1 - 0.25 * Math.abs(th));
      const r0 = table(NECK_R, t0, 1);
      const root = V(-Math.sin(th) * r0 * 0.85, NECK_BASE.y + t0 * NECK_L, NECK_BASE.z + Math.cos(th) * r0 * 1.0);
      const out0 = V(-Math.sin(th) * 0.008, 0, Math.cos(th) * 0.01 + 0.004);
      G.tube(R2(9), 4, (t, out) => out.copy(root).addScaledVector(out0, Math.sin(t * Math.PI * 0.5)).add(V(0, -len * t, 0)),
        t => lerp(0.0055, 0.0012, t), (i) => {
          const t = i / R2(9), w = smoothstep(0.08, 0.45, t);
          const nb = neckBones(t0);
          return { uv: ruv(R.plume, 0.5 + t * 0.5, 0.5), bones: [...nb.map(([b, ww]) => [b, ww * (1 - w)]), [BI.PLUME, w]].filter(b => b[1] > 1e-4), thin: lerp(0.0055, 0.0012, t), rough: 0.8 };
        });
    }
  }

  // ---- legs: feathered thigh into a bare tibia, tarsus, toes ----
  for (let si = 0; si < 2; si++) {
    const s = si === 0 ? 1 : -1, K = KNEE[si], A = V(K.x, K.y - L_TIB, K.z), F = V(K.x, A.y - L_TAR, K.z);
    G.tube(R2(16), R2(10), (t, out) => out.copy(K).add(V(0, -L_TIB * t, 0)), t => table(TIB_R, t, 1), (i) => {
      const t = i / R2(16);
      const bones = t < 0.12 ? [[BI.BODY, 1 - t / 0.12], [BI.TIB[si], t / 0.12]] : t > 0.9 ? [[BI.TIB[si], 1 - (t - 0.9) / 0.2], [BI.TAR[si], (t - 0.9) / 0.2]] : [[BI.TIB[si], 1]];
      return { uv: ruv(R.legs, t * 0.45, 0.5), bones, thin: t > 0.4 ? table(TIB_R, t, 1) : 0, rough: t > 0.42 ? 0.55 : 0.85, ao: lerp(0.8, 1, smoothstep(0, 0.3, t)) };
    }, { up: V(0, 0, 1) });
    G.tube(R2(14), 8, (t, out) => out.copy(A).add(V(0, -L_TAR * t, 0)), t => table(TAR_R, t, 1), (i) => {
      const t = i / R2(14);
      const bones = t > 0.9 ? [[BI.TAR[si], 1 - (t - 0.9) / 0.1], [BI.FOOT[si], (t - 0.9) / 0.1]] : t < 0.05 ? [[BI.TIB[si], 0.5 - t * 10], [BI.TAR[si], 0.5 + t * 10]] : [[BI.TAR[si], 1]];
      return { uv: ruv(R.legs, 0.45 + t * 0.37, 0.5), bones, thin: table(TAR_R, t, 1), rough: 0.5 };
    }, { up: V(0, 0, 1) });
    // toes: three forward, one hind
    const toes = [[-0.56, 0.082], [0, 0.098], [0.56, 0.08], [Math.PI - 0.12 * s, 0.046]];
    for (const [ang, len] of toes) {
      const dir = V(Math.sin(ang) * s, 0, Math.cos(ang));
      const base = F.clone().add(V(0, -FOOT_DROP + 0.004, 0)).addScaledVector(dir, 0.004);
      G.tube(R2(9), 6, (t, out) => out.copy(base).addScaledVector(dir, len * t).add(V(0, 0.005 * Math.sin(Math.PI * t) - 0.003 * t, 0)),
        t => t < 0.85 ? lerp(0.0044, 0.0026, t / 0.85) : lerp(0.0026, 0.0007, (t - 0.85) / 0.15), (i) => {
          const t = i / R2(9);
          return { uv: ruv(R.legs, 0.82 + t * 0.18, 0.5), bones: [[BI.FOOT[si], 1]], thin: t < 0.85 ? lerp(0.0044, 0.0026, t / 0.85) : 0.0018, rough: t > 0.86 ? 0.35 : 0.55 };
        }, { up: V(0, 1, 0) });
    }
    // a small pad joining the toes under the tarsus
    {
      const c = F.clone().add(V(0, -FOOT_DROP + 0.006, 0.006)), r = 0.0078;
      G.grid(6, 10, (i, j, out) => {
        const th = (i / 6) * Math.PI, ph = (j / 10) * TAU;
        return out.copy(c).add(V(Math.sin(th) * Math.cos(ph) * r, Math.cos(th) * r * 0.75, Math.sin(th) * Math.sin(ph) * r * 1.25));
      }, () => ({ uv: ruv(R.legs, 0.83, 0.5), bones: [[BI.FOOT[si], 1]], rough: 0.55 }), { wrapV: true, centre: () => c.clone(), hint: (i, j, out) => out.set(0, i === 0 ? 1 : -1, 0) });
    }
  }

  // ---- flight wings (spread in the bind pose), an airfoil loft along the span ----
  for (let si = 0; si < 2; si++) {
    const s = si === 0 ? 1 : -1, sh = SHOULDER[si];
    const nu = R2(76), nv = 16; // nv: around the airfoil (top TE -> LE -> bottom TE)
    const ySh = sh.y;
    // span stations: denser toward the tip
    const xOf = i => lerp(0.045, X_TIP, 1 - Math.pow(1 - i / nu, 1.18));
    const feather = x => {
      // trailing-edge scallops: the secondaries' rounded tips (the hand's trailing edge is under the primaries)
      if (x > X_WRIST + 0.01) return 0;
      const P = 0.0355, f = ((x - 0.05) / P) % 1;
      return 0.011 * Math.sqrt(Math.max(0, 1 - (2 * f - 1) ** 2)) * (1 - smoothstep(X_WRIST - 0.02, X_WRIST + 0.01, x));
    };
    const P = (i, j, out) => {
      const x = xOf(i);
      const le = table(WING_LE, x, 1), te0 = table(WING_TE, x, 1);
      const tipK = smoothstep(0.5, X_TIP, x);
      const te = te0 - feather(x);
      const w = j / nv; // 0 top TE .. 0.5 LE .. 1 bottom TE
      const top = w <= 0.5;
      const b = top ? 1 - w * 2 : (w - 0.5) * 2; // chord fraction from LE
      const bc = 0.5 - 0.5 * Math.cos(Math.PI * b); // cosine spacing: round leading edge
      const chord = le - te;
      const T0 = lerp(0.018, 0.007, smoothstep(0.05, X_TIP, x));
      const thick = T0 * 2.4 * Math.sqrt(bc + 1e-4) * Math.pow(1 - bc, 1.4) * (1 - tipK * 0.5);
      const camber = (0.014 * Math.sin(Math.PI * bc) * (1 - 0.4 * smoothstep(0.2, X_TIP, x)));
      // the hand coverts bow down toward the wingtip
      const droop = -0.012 * smoothstep(0.42, X_TIP, x) * (0.4 + bc);
      out.set(s * x, ySh + camber + droop + (top ? 0.5 : -0.5) * thick, le - chord * bc);
      return out;
    };
    const boneW = x => {
      if (x < X_ELBOW - 0.025) return [[BI.HUM[si], 1]];
      if (x < X_ELBOW + 0.03) { const k = smoothstep(X_ELBOW - 0.025, X_ELBOW + 0.03, x); return [[BI.HUM[si], 1 - k], [BI.FORE[si], k]]; }
      if (x < X_WRIST - 0.02) return [[BI.FORE[si], 1]];
      if (x < X_WRIST + 0.025) { const k = smoothstep(X_WRIST - 0.02, X_WRIST + 0.025, x); return [[BI.FORE[si], 1 - k], [BI.HAND[si], k]]; }
      return [[BI.HAND[si], 1]];
    };
    G.grid(nu, nv, P, (i, j) => {
      const x = xOf(i);
      return { uv: ruv(R.wing, (x - 0.045) / (X_TIP - 0.045), j / nv), bones: boneW(x), rough: 0.84, ao: lerp(0.78, 1, smoothstep(0.045, 0.16, x)) };
    }, {
      wrapV: false,
      centre: (i, j, out) => { const x = xOf(i); return out.set(s * x, ySh + 0.004, (table(WING_LE, x, 1) + table(WING_TE, x, 1)) * 0.5); },
      hint: (i, j, out) => out.set(s, 0, 0),
    });
    // primaries: separate long feathers fanned from the hand, curving back and drooping a little, the outer
    // five emarginated so the wingtip shows open "fingers"
    PRIMARIES.forEach(([fr, ang, len], k) => {
      const root = V(s * lerp(X_WRIST - 0.015, X_WRIST + L_HAND + 0.03, fr), ySh - 0.0015 - 0.0012 * k, lerp(-0.105, 0.05, fr));
      const wid = lerp(0.054, 0.04, k / 8), emarg = smoothstep(3.5, 8, k);
      const fnu = R2(10), fnv = 8;
      const Pf = (i, j, out) => {
        const t = i / fnu, w = j / fnv, top = w <= 0.5, b = top ? w * 2 : 2 - w * 2; // across: 0 .. 1 .. 0
        const a = ang - 0.16 * t * t;                       // curving back toward the tip
        const dx = s * Math.sin(a), dz = -Math.cos(a);
        // width: full at the base, the outer feathers narrowed in their outer half, a rounded tip
        let hw = wid * 0.5 * (1 - emarg * 0.42 * smoothstep(0.45, 0.62, t)) * Math.sqrt(Math.max(0, 1 - Math.pow(t, 6)));
        hw *= lerp(0.65, 1, smoothstep(0, 0.12, t));
        const across = (b - 0.5) * 2 * hw;
        const ex = -dz * s, ez = dx * s; // in-plane perpendicular (toward the leading side)
        const th = 0.0016 * (1 - Math.pow(Math.abs(b - 0.5) * 2, 2)) * (1 - t * 0.6);
        out.set(root.x + dx * len * t + ex * across * s, root.y - 0.02 * t * t + (top ? th : -th), root.z + dz * len * t + ez * across * s);
        return out;
      };
      G.grid(fnu, fnv, Pf, (i, j) => ({ uv: ruv(R.feather, i / fnu, j / fnv), bones: [[BI.HAND[si], 1]], rough: 0.8 }), {
        centre: (i, j, out) => { const t = i / fnu, a = ang - 0.16 * t * t; return out.set(root.x + s * Math.sin(a) * len * t, root.y - 0.02 * t * t - 0.0001, root.z - Math.cos(a) * len * t); },
        hint: (i, j, out) => out.set(0, 1, 0),
      });
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
  white: hex('#efeeea'), offWhite: hex('#dddcd6'), pale: hex('#b9bdc0'), grey: hex('#7a8389'), greyD: hex('#656d73'),
  greyL: hex('#979ea3'), slate: hex('#4f565c'), dark: hex('#383d42'), black: hex('#18191b'), blackS: hex('#222528'),
  bill: hex('#d6a33a'), billL: hex('#e6bf52'), billD: hex('#8e6c32'), lore: hex('#b9b36a'), skin: hex('#9b8549'),
  skinD: hex('#7f6b38'), claw: hex('#2a2620'), iris: hex('#e8cf3c'),
};
/** soft feather rows: returns { edge (0..1, 1 at a feather's free edge), id } for row/column coordinates */
function featherRows(a, b, rows, cols, curve) {
  const ra = a * rows, ri = Math.floor(ra);
  const cb = b * cols + (ri & 1 ? 0.5 : 0), ci = Math.floor(cb), fb = cb - ci;
  const u2 = ra + curve * (fb - 0.5) * (fb - 0.5);
  const f = u2 - Math.floor(u2);
  return { f, fb, id: Math.floor(u2) * 131 + ci * 17 };
}
const hash1 = n => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function paintHeronAtlas(seed) {
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
      let col = C.grey, ht = 0.5;
      if (name) {
        const a = clamp((u - r[0]) / (r[2] - r[0]), 0, 1), b = clamp((v - r[1]) / (r[3] - r[1]), 0, 1);
        const n1 = noise.noise2(x * 0.045, y * 0.045) * 0.5 + noise.noise2(x * 0.17, y * 0.17) * 0.25;
        [col, ht] = PAINT[name](a, b, n1, noise);
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
  const normalMap = normalMapFromHeight(hc, 2.2, false);
  normalMap.anisotropy = 4;
  return { map, normalMap };
}

const PAINT = {
  // a = s (breast -> tail tip), b = round (0 belly .. 0.5 back .. 1 belly)
  torso(a, b, n) {
    const q = (1 - Math.cos(b * TAU)) * 0.5; // 0 belly .. 1 back
    let c = mix3(C.offWhite, C.pale, smoothstep(0.2, 0.42, q));
    c = mix3(c, C.grey, smoothstep(0.5, 0.78, q));
    c = mix3(c, C.white, (1 - smoothstep(0.06, 0.3, a)) * (1 - smoothstep(0.5, 0.8, q)) * 0.9);
    // black flank band (side of the breast), mostly under the mantle's lip
    const fb = smoothstep(0.26, 0.32, q) * (1 - smoothstep(0.44, 0.5, q)) * smoothstep(0.06, 0.14, a) * (1 - smoothstep(0.5, 0.66, a));
    c = mix3(c, C.black, fb * 0.65);
    // dark grey tail, white under-tail coverts
    c = mix3(c, C.greyD, smoothstep(0.76, 0.84, a) * smoothstep(0.3, 0.55, q));
    c = mix3(c, C.white, smoothstep(0.7, 0.8, a) * (1 - smoothstep(0.2, 0.35, q)) * 0.6);
    const f = featherRows(a, b, 26, 22, 1.2);
    const edge = smoothstep(0.7, 0.98, f.f);
    c = mul3(c, 1 - 0.09 * edge + 0.05 * n + 0.03 * (hash1(f.id) - 0.5));
    // breast streaks (lanceolate feathers): long dark dashes on the white breast
    const st = (1 - smoothstep(0.0, 0.25, a)) * (1 - smoothstep(0.25, 0.45, q)) * smoothstep(0.6, 0.85, Math.sin(b * TAU * 9 + n * 2) * 0.5 + 0.5);
    c = mix3(c, C.dark, st * 0.35);
    return [c, 0.5 + 0.35 * Math.pow(f.f, 1.6) - 0.15 * edge];
  },
  // a = along (front .. wingtips), b = across (0 left lip .. 0.5 back .. 1 right lip)
  panel(a, b, n) {
    const m = Math.abs(b - 0.5) * 2;
    let c = C.grey;
    // carpal patch: black at the bend of the wing, with the white leading edge above it
    const carpal = (1 - smoothstep(0.1, 0.2, a)) * smoothstep(0.45, 0.6, m);
    c = mix3(c, C.black, carpal * 0.92);
    c = mix3(c, C.white, (1 - smoothstep(0.04, 0.09, a)) * smoothstep(0.3, 0.5, m) * 0.7);
    // long pale scapular plumes along the back
    const sc = (1 - smoothstep(0.18, 0.4, m)) * smoothstep(0.15, 0.3, a) * (1 - smoothstep(0.55, 0.7, a));
    c = mix3(c, C.greyL, sc * (0.55 + 0.25 * Math.sin(b * 160 + n * 3)));
    // tertials darker, primaries (wingtips) near black
    c = mix3(c, C.slate, smoothstep(0.55, 0.66, a) * 0.7);
    c = mix3(c, C.blackS, smoothstep(0.68, 0.78, a));
    let ht = 0.5;
    if (a < 0.68) {
      const f = featherRows(a, b, 24, 26, 1.4);
      const edge = smoothstep(0.72, 0.98, f.f);
      c = mul3(c, 1 - 0.1 * edge + 0.05 * n + 0.04 * (hash1(f.id) - 0.5));
      // pale fringes on the coverts
      c = mix3(c, C.greyL, smoothstep(0.86, 0.96, f.f) * 0.25 * (1 - carpal));
      ht = 0.5 + 0.4 * Math.pow(f.f, 1.5) - 0.2 * edge;
    } else {
      // primaries: long feathers along the wing, rachis and a lighter outer edge
      const fq = (b * 9) % 1;
      c = mul3(c, 0.9 + 0.12 * smoothstep(0.75, 0.95, fq) - 0.08 * smoothstep(0.42, 0.5, fq) * (1 - smoothstep(0.5, 0.58, fq)) + 0.04 * n);
      ht = 0.5 + 0.25 * Math.sin(fq * Math.PI);
    }
    return [c, ht];
  },
  // a = span (root .. tip), b = round the airfoil (0..0.5 top TE->LE, 0.5..1 bottom LE->TE)
  wing(a, b, n) {
    const top = b < 0.5, ch = top ? 1 - b * 2 : (b - 0.5) * 2; // 0 LE .. 1 TE
    const x = lerp(0.045, X_TIP, a);
    const hand = smoothstep(X_WRIST - 0.01, X_WRIST + 0.03, x);
    const covEnd = lerp(0.38, 0.27, hand);
    let c, ht = 0.5;
    if (top) {
      if (ch < covEnd) {
        c = mix3(C.grey, C.slate, hand * 0.55);
        // white leading edge at the wrist
        c = mix3(c, C.white, (1 - smoothstep(0.03, 0.09, ch)) * smoothstep(0.25, 0.32, x) * (1 - smoothstep(0.5, 0.56, x)) * 0.85);
        const f = featherRows(ch / covEnd, a, 7, 70, 0.9);
        const edge = smoothstep(0.75, 0.98, f.f);
        c = mul3(c, 1 - 0.1 * edge + 0.05 * n);
        ht = 0.5 + 0.35 * Math.pow(f.f, 1.5) - 0.2 * edge;
      } else {
        c = mix3(C.slate, C.blackS, smoothstep(X_WRIST - 0.03, X_WRIST + 0.06, x));
        c = mix3(c, C.dark, (1 - hand) * 0.4);
        // feather vanes across the flight feathers (same period as the trailing-edge scallops)
        const P = x < X_WRIST + 0.02 ? 0.0355 : 0.036;
        const fq = (((x - (x < X_WRIST + 0.02 ? 0.05 : X_WRIST + 0.02)) / P) % 1 + 1) % 1;
        const rach = 1 - smoothstep(0.0, 0.035, Math.abs(fq - 0.42));
        const gap = smoothstep(0.88, 1.0, fq) + (1 - smoothstep(0.0, 0.1, fq));
        c = mul3(c, 0.95 + 0.12 * rach - 0.12 * gap + 0.04 * n);
        c = mix3(c, C.greyD, smoothstep(0.05, 0.0, ch - covEnd) * 0.4);
        ht = 0.5 + 0.2 * rach - 0.25 * gap;
      }
    } else {
      // underwing: pale grey coverts, grey flight feathers
      c = ch < covEnd + 0.05 ? mix3(C.greyL, C.pale, 0.4) : mix3(C.greyD, C.slate, hand * 0.6);
      const fq = ((x / 0.036) % 1);
      c = mul3(c, 0.96 + 0.06 * Math.sin(fq * TAU) * smoothstep(covEnd, covEnd + 0.1, ch) + 0.04 * n);
    }
    return [c, ht];
  },
  // a = round (0.5 front), b = along (base .. head)
  neck(a, b, n) {
    let c = mix3(C.white, C.pale, smoothstep(0.32, 0.0, Math.abs(a - 0.0) < 0.5 ? Math.min(a, 1 - a) : 0.5) * 0.8);
    // a double line of black streaks down the front of the neck
    for (const off of [-0.026, 0.026]) {
      const du = Math.abs(a - 0.5 - off);
      const P = 0.052, ph = ((b + hash1(Math.floor(b / P) + off * 100) * 0.02) / P) % 1;
      const dash = smoothstep(0.0, 0.12, ph) * (1 - smoothstep(0.5, 0.68, ph));
      const w = lerp(0.016, 0.009, b);
      const k = (1 - smoothstep(w * 0.5, w, du)) * dash * (1 - smoothstep(0.62, 0.8, b));
      c = mix3(c, C.black, k * 0.92);
    }
    c = mul3(c, 1 + 0.04 * n);
    const fq = (b * 44 + Math.sin(a * TAU * 3) * 0.3) % 1;
    return [c, 0.5 + 0.08 * Math.sin(fq * TAU)];
  },
  // a = along (nape .. bill tip), b = round (0 chin, 0.5 crown)
  head(a, b, n) {
    const z = lerp(HEAD_Z0, HEAD_Z1, a);
    const th = b * TAU, up = -Math.cos(th); // 1 crown .. -1 chin
    const el = Math.asin(clamp(up, -1, 1)), sideS = Math.sin(th);
    if (z < BILL_Z) {
      let c = C.white;
      // black supercilium from above the eye to the nape, widening back to the crest
      const back = smoothstep(0.03, -0.03, z);
      const lo = lerp(0.62, 0.12, back), hi = lerp(1.22, 1.5, back);
      const st = smoothstep(lo - 0.08, lo + 0.02, el) * (1 - smoothstep(hi - 0.06, hi + 0.02, el)) * smoothstep(0.03, 0.018, z) * (Math.abs(sideS) > 0.08 || back > 0.5 ? 1 : 0);
      c = mix3(c, C.black, st * 0.95);
      // bare yellow-green lores between the eye and the bill
      const lore = smoothstep(0.02, 0.03, z) * (1 - smoothstep(-0.25, -0.05, -el + 0.32)) * smoothstep(-0.35, -0.1, el);
      c = mix3(c, C.lore, lore * 0.8);
      c = mix3(c, C.bill, smoothstep(BILL_Z - 0.01, BILL_Z, z) * 0.8);
      const f = (z * 400 + Math.sin(th * 7) * 0.4) % 1;
      return [mul3(c, 1 + 0.03 * n), 0.5 + 0.06 * Math.sin(f * TAU) * (1 - smoothstep(0.02, 0.04, z))];
    }
    // bill: yellow, darker culmen, pale lower mandible, a dark gape line
    let c = up > 0 ? C.bill : C.billL;
    c = mix3(c, C.billD, smoothstep(0.75, 0.97, up) * 0.85);
    const gape = 1 - smoothstep(0.02, 0.085, Math.abs(el + 0.06));
    c = mix3(c, C.billD, gape * (1 - smoothstep(0.12, 0.16, z)) * 0.9);
    c = mix3(c, hex('#a8843a'), smoothstep(0.145, 0.172, z) * 0.6);
    return [mul3(c, 1 + 0.025 * n), 0.5];
  },
  // a = along (tibia 0..0.45, tarsus 0.45..0.82, toes 0.82..1)
  legs(a, b, n) {
    let c;
    if (a < 0.45) {
      const t = a / 0.45;
      c = mix3(C.greyL, C.skin, smoothstep(0.34, 0.44, t));
      return [mul3(c, 1 + 0.05 * n), 0.5];
    }
    if (a < 0.82) {
      const t = (a - 0.45) / 0.37;
      const sc = (t * 22) % 1;
      c = mix3(C.skin, C.skinD, 0.3 + 0.2 * n);
      c = mul3(c, 1 - 0.18 * smoothstep(0.85, 1, sc));
      return [c, 0.5 + 0.3 * smoothstep(0.85, 1, sc)];
    }
    const t = (a - 0.82) / 0.18;
    const sc = (t * 9) % 1;
    c = mix3(C.skin, C.skinD, 0.4);
    c = mul3(c, 1 - 0.15 * smoothstep(0.82, 1, sc));
    c = mix3(c, C.claw, smoothstep(0.84, 0.9, t));
    return [c, 0.5];
  },
  // a < 0.5: crest (black); a >= 0.5: breast plumes (white, grey toward the tips)
  plume(a, b, n) {
    if (a < 0.5) return [mul3(C.black, 1 + 0.15 * Math.sin(b * TAU * 3)), 0.5];
    const t = (a - 0.5) * 2;
    return [mix3(C.white, C.pale, smoothstep(0.4, 1, t) * 0.8), 0.5];
  },
  feather(a, b, n) {
    const top = b < 0.5, w = top ? b * 2 : 2 - b * 2;     // 0 .. 1 across
    let c = top ? mix3(C.blackS, C.slate, (1 - smoothstep(0.0, 0.3, a)) * 0.6) : mix3(C.slate, C.greyD, 0.35);
    // rachis, a lighter outer vane edge, faint barbs
    const rach = 1 - smoothstep(0.0, 0.05, Math.abs(w - 0.42));
    c = mul3(c, 0.94 + 0.16 * rach * (1 - a * 0.5) + 0.05 * Math.sin((a * 70 + w * 9)) * smoothstep(0.1, 0.3, a) + 0.03 * n);
    c = mix3(c, C.greyD, smoothstep(0.85, 1.0, w) * 0.25);
    return [c, 0.5 + 0.25 * rach - 0.2 * smoothstep(0.85, 1, w)];
  },
  eye(a, b) {
    const r = Math.hypot(a - 0.5, b - 0.5) * 2;
    let c = r < 0.36 ? C.black : r < 0.86 ? mix3(C.iris, hex('#c79a28'), smoothstep(0.4, 0.86, r) * 0.6) : C.black;
    if (r >= 0.86) c = mix3(C.black, hex('#8a8a52'), smoothstep(0.92, 1, r));
    return [c, 0.5];
  },
};

/* ------------------------------------------------------------------ */
/* Material                                                             */
/* ------------------------------------------------------------------ */
function heronMaterial(tex, U) {
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.55, 0.55),
    vertexColors: true, roughness: 1, metalness: 0, envMapIntensity: 0.85,
  });
  patchMaterial(mat, {
    key: 'heron',
    uniforms: U,
    vertexHeader: 'attribute float aThin; attribute float aRough; varying float vHRough; uniform float uHPx;',
    fragmentHeader: 'varying float vHRough; uniform vec3 uHRim;',
    vertex: {
      '#include <skinning_vertex>': /* glsl */`$&
        vHRough = aRough;
        // thin parts (legs, toes, bill tip, plumes) keep at least ~1.6 px on screen instead of breaking into
        // crawling sub-pixel slivers at a distance
        if (aThin > 0.0) {
          vec4 hmv = modelViewMatrix * vec4(transformed, 1.0);
          float minR = 0.8 * max(-hmv.z, 0.05) / uHPx;
          transformed += normalize(objectNormal + vec3(1e-6)) * max(minR - aThin, 0.0);
        }`,
    },
    fragment: {
      '#include <roughnessmap_fragment>': '$&\n roughnessFactor = vHRough;',
      // soft rim light from the sky (the feathered silhouette catches the light; never a flat clay look)
      '#include <emissivemap_fragment>': /* glsl */`$&
        { float hr = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += uHRim * diffuseColor.rgb * (hr * hr * hr) * (0.6 + 0.4 * vHRough); }`,
    },
  });
  return mat;
}

/* ------------------------------------------------------------------ */
/* The heron                                                            */
/* ------------------------------------------------------------------ */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3();
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
// long-lived pose values get their own vectors (the helpers below reuse _a.._z freely)
const _hp = new THREE.Vector3(), _knee = new THREE.Vector3(), _ankle = new THREE.Vector3(), _foot = new THREE.Vector3(), _ft = new THREE.Vector3(), _dir = new THREE.Vector3(), _seg = new THREE.Vector3();
const easeIO = t => t * t * (3 - 2 * t);

/** quaternion from a basis given by its Y (axis) and an approximate Z (forward) */
function basisYZ(q, Y, Zhint) {
  _y.copy(Y).normalize();
  _z.copy(Zhint).addScaledVector(_y, -Zhint.dot(_y));
  if (_z.lengthSq() < 1e-10) { _z.set(0, 0, 1).addScaledVector(_y, -_y.z); if (_z.lengthSq() < 1e-10) _z.set(1, 0, 0); }
  _z.normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return q.setFromRotationMatrix(_m);
}

/** A cubic Bezier with an arc-length table (used for the neck every frame and for flight paths). */
class Bezier {
  constructor(n = 48) { this.p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]; this.n = n; this.len = new Float64Array(n + 1); this.total = 0; this.t0 = new THREE.Vector3(); this.t1 = new THREE.Vector3(); }
  at(t, out) {
    const [a, b, c, d] = this.p, u = 1 - t;
    return out.set(0, 0, 0).addScaledVector(a, u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t);
  }
  tangent(t, out) {
    const [a, b, c, d] = this.p, u = 1 - t;
    out.subVectors(b, a).multiplyScalar(3 * u * u).addScaledVector(this.t0.subVectors(c, b), 6 * u * t).addScaledVector(this.t1.subVectors(d, c), 3 * t * t);
    return out.lengthSq() > 1e-12 ? out.normalize() : out.subVectors(d, a).normalize();
  }
  measure() {
    const prev = this.at(0, this.t0), p = this.t1;
    let tot = 0;
    this.len[0] = 0;
    for (let i = 1; i <= this.n; i++) { this.at(i / this.n, p); tot += p.distanceTo(prev); prev.copy(p); this.len[i] = tot; }
    this.total = tot;
    return tot;
  }
  /** curve parameter at arc length s */
  tAt(s) {
    if (s <= 0) return 0;
    if (s >= this.total) return 1;
    let lo = 0, hi = this.n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (this.len[mid] < s) lo = mid; else hi = mid; }
    const f = (s - this.len[lo]) / Math.max(this.len[hi] - this.len[lo], 1e-9);
    return (lo + f) / this.n;
  }
}

export class Heron {
  /**
   * pond: the KoiPond (sdf, height, obstacles, ripples, camera, …). Built entirely in the constructor: nothing is
   * created while the world runs.
   */
  constructor(pond, rng) {
    this.pond = pond;
    this.rng = rng;
    this.q = pond.q;
    const geo = buildHeronGeometry(this.q);
    this.tex = paintHeronAtlas(pond.env.seed % 1000 + 5);
    this.U = { uHPx: { value: 900 }, uHRim: { value: new THREE.Color(0.25, 0.27, 0.3) } };
    const mat = heronMaterial(this.tex, this.U);
    this.mat = mat;
    // bones: a flat skeleton under one root; every bone is posed directly in the heron's local frame
    this.bones = [];
    for (let i = 0; i < BONE_COUNT; i++) { const b = new THREE.Bone(); b.name = 'heronB' + i; this.bones.push(b); }
    const bindPos = this.bindPos = new Array(BONE_COUNT).fill(null).map(() => new THREE.Vector3());
    bindPos[BI.TAIL].copy(TAIL_BIND);
    for (let k = 0; k < NECK_N; k++) bindPos[BI.NECK + k].set(NECK_BASE.x, NECK_BASE.y + (k / NECK_N) * NECK_L, NECK_BASE.z);
    bindPos[BI.HEAD].copy(HEAD_BIND);
    bindPos[BI.CREST].copy(HEAD_BIND).add(CREST_OFF);
    bindPos[BI.CW].copy(CW_BIND);
    bindPos[BI.PLUME].copy(PLUME_BIND);
    for (let si = 0; si < 2; si++) {
      const s = si === 0 ? 1 : -1;
      bindPos[BI.HUM[si]].copy(SHOULDER[si]);
      bindPos[BI.FORE[si]].copy(SHOULDER[si]).add(V(s * L_HUM, 0, 0));
      bindPos[BI.HAND[si]].copy(SHOULDER[si]).add(V(s * (L_HUM + L_FORE), 0, 0));
      bindPos[BI.TIB[si]].copy(KNEE[si]);
      bindPos[BI.TAR[si]].copy(KNEE[si]).add(V(0, -L_TIB, 0));
      bindPos[BI.FOOT[si]].copy(KNEE[si]).add(V(0, -L_TIB - L_TAR, 0));
    }
    const root = this.bones[0];
    for (let i = 1; i < BONE_COUNT; i++) { this.bones[i].position.copy(bindPos[i]); root.add(this.bones[i]); }
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.add(root);
    mesh.bind(new THREE.Skeleton(this.bones));
    mesh.frustumCulled = false;
    mesh.castShadow = pond.env.shadows;
    mesh.name = 'heronMesh';
    this.mesh = mesh;
    this.obj = new THREE.Group();
    this.obj.name = 'heron';
    this.obj.add(mesh);
    this.obj.visible = false;
    pond.scene.add(this.obj);

    // pose state
    this.bodyPos = new Spring3();           // world body centre
    this.yaw = new Spring(0);               // heading (rad, about +Y; 0 = facing +Z)
    this.pitch = new Spring(0);             // + = nose down
    this.roll = new Spring(0);
    this.headW = new Spring3();             // world head-bone position
    this.hYaw = new Spring(0); this.hPitch = new Spring(0); this.hRoll = new Spring(0); // head orientation, world
    this.fold = new Spring(1);              // 1 = wings folded (flight wings hidden)
    this.flapPh = 0; this.flapA = new Spring(0); this.flapF = 1.8; this.sweep = new Spring(0); this.bow = new Spring(0.12);
    this.crest = new Spring(0); this.tailUp = new Spring(0); this.ruffle = 0;
    this.neckA0 = new Spring(1.0); this.neckA3 = new Spring(1.0); // neck shape (see poseNeck)
    this.feet = [0, 1].map(si => ({
      si, planted: false, pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), t: 1, dur: 1,
      yaw: 0, fromYaw: 0, toYaw: 0, lift: 0.14, local: new THREE.Vector3(), localS: new Spring3(), closed: new Spring(0),
      wasWet: false, wetT: 0, floorN: new THREE.Vector3(0, 1, 0),
    }));
    this.neck = new Bezier(24);
    this.state = 'away';
    this.visit = null;
    this.alarm = 0;                         // 0..1: how much the pond's creatures are startled right now
    this.present = false;                   // standing in the pond (koi keep their distance)
    this.spot = new THREE.Vector3();
    this.path = new Bezier(96);
    this.prey = null;
    this.held = null;                       // a caught minnow held in the bill
    this.wait = rng.range(18, 40);          // the first visit: soon after the world opens
    this.visits = 0;
    this.lastSpot = -1;
    this.tmpCam = new THREE.PerspectiveCamera(42, 4 / 3, 0.1, 200);
    this.frustum = new THREE.Frustum();
    this.sphere = new THREE.Sphere(new THREE.Vector3(), 1.2);
    this.findSpots();
    this.restPose();
    this.pose(0);
  }

  /* ---------- where it may land: shallows along the shore, shoreline stones, the island stone ---------- */
  findSpots() {
    const P = this.pond, r = this.rng.fork('spots');
    const cam = this.tmpCam, vt = P.viewTarget, yaw = P.yaw0, pitch = 0.54, dist = 9.2;
    cam.position.set(vt.x + Math.sin(yaw) * Math.cos(pitch) * dist, vt.y + Math.sin(pitch) * dist, vt.z + Math.cos(yaw) * Math.cos(pitch) * dist);
    cam.lookAt(vt); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    this.defaultCam = cam.position.clone();
    const ray = new THREE.Raycaster();
    const occluders = [P.bridge, P.lanternGroup].filter(Boolean);
    const score = (x, y, z) => {
      // in the default view: near the middle of the picture (phones in portrait see only a narrow strip), not
      // too close to the bottom edge, with the bird's body and head in clear view (not behind the bridge)
      _a.set(x, y + 0.5, z).project(cam);
      const sx = Math.abs(_a.x), sy = _a.y;
      if (sx > 0.62 || sy < -0.72 || sy > 0.6 || _a.z > 1) return -Infinity;
      let sc = -sx * 1.6 - Math.abs(sy + 0.05) * 0.8;
      for (const h of [0.45, 0.9]) {
        _b.set(x, y + h, z);
        ray.set(cam.position, _c.subVectors(_b, cam.position).normalize());
        ray.far = cam.position.distanceTo(_b) - 0.15;
        if (occluders.length && ray.intersectObjects(occluders, true).length) sc -= 2.5;
      }
      const dc = cam.position.distanceTo(_b.set(x, y, z));
      sc -= Math.max(0, 6.5 - dc) * 0.6; // not right under the lens
      return sc;
    };
    const clearOf = (x, z, pad) => {
      if (P.nearBridge(x, z, 0.9 + pad)) return false;
      if (P.obstacleGap(x, z) < 0.22 + pad) return false;
      if (P.spoutHit && Math.hypot(x - P.spoutHit.x, z - P.spoutHit.z) < 1.3) return false;
      for (const p of P.pads) if (Math.hypot(x - p.anchor.x, z - p.anchor.z) < 0.75 + pad) return false;
      for (const s of P.stones) if (Math.hypot(x - s.x, z - s.z) < s.s + 0.28 + pad) return false;
      for (const s of P.irisSpots || []) if (Math.hypot(x - s.x, z - s.z) < 0.5 + pad) return false;
      if (P.lanternPos && Math.hypot(x - P.lanternPos.x, z - P.lanternPos.z) < 0.85) return false;
      return true;
    };
    const spots = [];
    // shallows: walk in from the shore to ~0.12–0.22 m of water
    for (const L of P.lobes) {
      for (let k = 0; k < 40; k++) {
        const a = (k / 40) * TAU + r.range(-0.03, 0.03);
        let x = L.x + Math.cos(a) * L.r, z = L.z + Math.sin(a) * L.r;
        for (let it = 0; it < 14; it++) { const d = P.sdf(x, z); P.sdfGrad(x, z, _a); x -= _a.x * (d + 0.34); z -= _a.z * (d + 0.34); }
        const d = P.sdf(x, z);
        if (Math.abs(d + 0.34) > 0.08) continue;
        const fy = P.height(x, z);
        if (fy < -0.26 || fy > -0.07) continue;
        if (!clearOf(x, z, 0)) continue;
        // the room to wade: shallows on both sides along the shore
        P.sdfGrad(x, z, _a);
        const along = V(-_a.z, 0, _a.x);
        let room = 0;
        for (const sg of [1, -1]) for (let s = 0.2; s <= 0.8; s += 0.2) { const px = x + along.x * s * sg, pz = z + along.z * s * sg; const dd = P.sdf(px, pz); if (dd < -0.12 && dd > -0.6 && clearOf(px, pz, -0.1)) room++; }
        const sc = score(x, fy, z);
        if (sc === -Infinity) continue;
        spots.push({ kind: 'water', pos: V(x, fy, z), along, score: sc + room * 0.05 + r.range(0, 0.15), face: Math.atan2(-_a.x, -_a.z) });
      }
    }
    // stones: shoreline stones that reach the water, and the island stone in the pond
    const rocks = P.rockMeshes || [];
    const topAt = (x, z, out) => {
      ray.set(_c.set(x, 3, z), _d.set(0, -1, 0)); ray.far = 4;
      const hit = ray.intersectObjects(rocks, false)[0];
      return hit ? out.copy(hit.point) : null;
    };
    const stoneList = P.stones.filter(s => s.s >= 0.4).map(s => ({ x: s.x, z: s.z, s: s.s }));
    if (P.islandStone) stoneList.push({ x: P.islandStone.x, z: P.islandStone.z, s: 0.7, island: true });
    for (const st of stoneList) {
      if (!st.island && P.sdf(st.x, st.z) > 0.35) continue;
      if (P.nearBridge(st.x, st.z, 1.0)) continue;
      const top = topAt(st.x, st.z, new THREE.Vector3());
      if (!top || top.y > 0.75 || top.y < 0.02) continue;
      // both feet need footing: the top must be broad and fairly level
      let ok = true;
      for (const [ox, oz] of [[0.07, 0], [-0.07, 0], [0, 0.07], [0, -0.07]]) { const h = topAt(st.x + ox, st.z + oz, _b); if (!h || Math.abs(h.y - top.y) > 0.05) ok = false; }
      if (!ok) continue;
      const sc = score(top.x, top.y, top.z);
      if (sc === -Infinity) continue;
      spots.push({ kind: 'rock', pos: top, score: sc - 0.15 + r.range(0, 0.15), island: !!st.island, face: r.range(0, TAU) });
    }
    spots.sort((a, b) => b.score - a.score);
    // keep a varied set: the best spots, at least a metre apart
    const keep = [];
    for (const s of spots) { if (keep.length >= 9) break; if (keep.every(k => k.pos.distanceTo(s.pos) > 1.0)) keep.push(s); }
    this.spots = keep;
  }

  /* ---------- the schedule ---------- */
  update(dt, time) {
    if (this.frozen) return;
    if (this.state === 'away') {
      this.wait -= dt;
      if (this.wait > 0 || !this.spots.length) return;
      this.beginVisit();
    }
    this.alarm = Math.max(0, this.alarm - dt * 0.35);
    this.t += dt;
    switch (this.state) {
      case 'arrive': this.updateArrive(dt); break;
      case 'settle': this.updateSettle(dt); break;
      case 'stay': this.updateStay(dt, time); break;
      case 'takeoff': this.updateTakeoff(dt); break;
      case 'leave': this.updateLeave(dt); break;
    }
    if (this.state === 'away') return;
    this.pose(dt);
  }

  /** Choose a landing spot and an approach, out of view and clear of the bridge, lantern and tree. */
  beginVisit(forceSpot = -1, stay = 0) {
    const r = this.rng;
    let si = forceSpot;
    if (si < 0) {
      // weighted by score, never the same spot twice in a row
      const w = this.spots.map((s, i) => (i === this.lastSpot ? 0 : Math.exp(s.score * 1.2)));
      let sum = w.reduce((a, b) => a + b, 0), x = r.next() * sum;
      si = 0; for (let i = 0; i < w.length; i++) { x -= w[i]; if (x <= 0) { si = i; break; } }
    }
    si = clamp(si, 0, this.spots.length - 1);
    this.lastSpot = si;
    const sp = this.spots[si];
    this.spotInfo = sp;
    this.spot.copy(sp.pos);
    this.visits++;
    // facing after landing: along the shore (water spots) so it is seen side-on
    const P = this.pond;
    const camDir = _a.subVectors(this.spot, P.camera.position).setY(0).normalize();
    let face;
    if (sp.kind === 'water') { face = Math.atan2(sp.along.x, sp.along.z); if (r.chance(0.5)) face += Math.PI; }
    else face = Math.atan2(-camDir.z, camDir.x) + (r.chance(0.5) ? 0 : Math.PI) + r.range(-0.5, 0.5);
    // approach: come in across the view, ending along the landing heading; try several and keep a clear one
    let best = null;
    for (let k = 0; k < 10; k++) {
      const ang = face + (k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.32);
      const dir = V(Math.sin(ang), 0, Math.cos(ang));
      const lateral = V(dir.z, 0, -dir.x).multiplyScalar(r.range(5, 9) * (r.chance(0.5) ? 1 : -1));
      this.makeInbound(dir, lateral);
      const c = this.pathClearance();
      if (!best || c > best.c) best = { c, dir, lateral, ang };
      if (c > 0.6) break;
    }
    this.makeInbound(best.dir, best.lateral);
    this.landYaw = best.ang;
    this.stayDur = stay || r.range(40, 90);
    this.state = 'arrive';
    this.t = 0;
    this.pathS = 0;
    this.obj.visible = true;
    // start on the path, at speed, out of sight
    this.path.at(0, _a);
    this.bodyPos.set(_a);
    this.path.tangent(0, _b);
    this.yaw.set(Math.atan2(_b.x, _b.z)); this.pitch.set(0); this.roll.set(0);
    this.fold.set(0); this.flapA.set(0.6); this.flapPh = r.range(0, TAU); this.flapF = 1.8;
    this.sweep.set(0); this.bow.set(0.12);
    for (const f of this.feet) { f.planted = false; f.closed.set(1); f.local.set(f.si === 0 ? 0.035 : -0.035, -0.09, -0.5); f.localS.set(f.local); f.plantK = 0; }
    this.applyRoot();
    this.flightNeck(true);
    this.present = false;
    this.prey = null; this.held = null;
  }
  /** inbound path: from high and far behind the approach line down to the touchdown point */
  makeInbound(dir, lateral) {
    const end = _c.copy(this.spot).addScaledVector(dir, -0.16);
    end.y = this.spot.y + STAND_H + 0.08;
    const p = this.path.p;
    p[3].copy(end);
    p[2].copy(end).addScaledVector(dir, -5.5); p[2].y += 2.1;
    p[1].copy(end).addScaledVector(dir, -14).add(lateral); p[1].y += 7.5;
    p[0].copy(end).addScaledVector(dir, -26).addScaledVector(lateral, 1.6); p[0].y += 12;
    this.path.measure();
  }
  /** smallest clearance (m) of the path's low part from the bridge, the lantern and the tree */
  pathClearance() {
    const P = this.pond;
    let c = 9;
    for (let i = 0; i <= 40; i++) {
      const s = this.path.total * (0.55 + 0.45 * i / 40);
      this.path.at(this.path.tAt(s), _a);
      if (P.bridgeLine) {
        const B = P.bridgeLine;
        const t = clamp(((_a.x - B.a.x) * B.dir.x + (_a.z - B.a.z) * B.dir.z) / B.len, 0, 1);
        const bx = B.a.x + B.dir.x * t * B.len, bz = B.a.z + B.dir.z * t * B.len;
        const hz = Math.hypot(_a.x - bx, _a.z - bz) - B.halfW - 0.9;
        const vy = _a.y - (Math.max(B.a.y, B.b.y) + 2.4);
        c = Math.min(c, Math.max(hz, vy));
      }
      if (P.lanternPos) c = Math.min(c, Math.max(Math.hypot(_a.x - P.lanternPos.x, _a.z - P.lanternPos.z) - 1.0, _a.y - 2.6));
      for (const t of P.canopy || []) c = Math.min(c, Math.max(Math.hypot(_a.x - t.x, _a.z - t.z) - 1.6, _a.y - t.y - 0.8));
      if (P.treeBase) c = Math.min(c, Math.max(Math.hypot(_a.x - P.treeBase.x, _a.z - P.treeBase.z) - 1.2, _a.y - 4.5));
    }
    return c;
  }

  /* ---------- flight in ---------- */
  updateArrive(dt) {
    const path = this.path, total = path.total;
    const rem = total - this.pathS;
    // cruise ~4.6 m/s, easing to a gentle touchdown
    const v = lerp(0.55, 4.6, smoothstep(0.0, 7.5, rem));
    this.pathS = Math.min(total, this.pathS + v * dt);
    const t = path.tAt(this.pathS);
    path.at(t, _a);
    this.bodyPos.follow(_a, dt);
    path.tangent(t, _b);
    const climb = Math.asin(clamp(_b.y, -1, 1));
    const yawT = nearAngle(Math.atan2(_b.x, _b.z), this.yaw.x);
    // bank into the turn: lean by the rate of heading change
    const prevYaw = this.yaw.x;
    this.yaw.step(yawT, 5, dt);
    const yawRate = (this.yaw.x - prevYaw) / Math.max(dt, 1e-4);
    const flare = smoothstep(2.6, 0.4, rem);
    this.roll.step(clamp(yawRate * v * 0.12, -0.45, 0.45) * (1 - flare), 3, dt);
    this.pitch.step(-climb * 0.45 - flare * 0.62, 4, dt);
    // wings: cruise beats, a long glide down, then deep braking beats with the wings swept forward
    const glide = smoothstep(11, 8, rem) * (1 - smoothstep(3.2, 2.2, rem));
    const brake = smoothstep(2.6, 1.2, rem);
    this.flapF = lerp(lerp(1.75, 1.6, glide), 2.5, brake);
    this.flapA.step(lerp(lerp(0.6, 0.05, glide), 0.95, brake), 3, dt);
    this.sweep.step(lerp(0, -0.25, brake) + glide * 0.05, 3, dt);
    this.bow.step(lerp(0.1, 0.2, glide), 3, dt);
    this.fold.step(0, 6, dt);
    // legs: trailing behind, swinging down and forward for the touchdown, then onto the planned footholds
    const reach = smoothstep(3.4, 1.0, rem);
    const plant = smoothstep(0.9, 0.06, rem);
    for (const f of this.feet) {
      const s = f.si === 0 ? 1 : -1;
      _c.set(s * 0.035, -0.09, -0.5).lerp(_d.set(s * 0.05, -0.47, 0.12), reach);
      f.local.copy(_c);
      f.closed.step(lerp(1, 0, reach), 4, dt);
      if (plant > 0) {
        this.footHold(f, this.landYaw, _d);
        f.plantTarget = f.plantTarget || new THREE.Vector3();
        f.plantTarget.copy(_d);
        f.plantK = plant;
      } else f.plantK = 0;
    }
    this.flightNeck(false, dt, smoothstep(4, 1, rem));
    if (this.pathS >= total - 1e-4) {
      this.state = 'settle'; this.t = 0;
      for (const f of this.feet) {
        this.footHold(f, this.landYaw, f.pos);
        f.planted = true; f.yaw = this.landYaw; f.t = 1;
        this.waterTouch(f.pos, 0.9);
      }
      this.present = this.spotInfo.kind === 'water' || this.spotInfo.island;
      this.alarm = 1;
      this.pond.onHeronLanded && this.pond.onHeronLanded(this);
    }
  }
  /** foothold for one foot around the body's landing point (world, on the floor) */
  footHold(f, yaw, out) {
    const s = f.si === 0 ? 1 : -1;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    // left foot to the heron's left (+X local) of the centre line, slightly staggered
    const lx = s * 0.05, lz = s * 0.018;
    out.set(this.spot.x + lx * cy + lz * sy, 0, this.spot.z - lx * sy + lz * cy);
    out.y = this.floorAt(out.x, out.z) + FOOT_DROP;
    return out;
  }
  floorAt(x, z) {
    if (this.spotInfo && this.spotInfo.kind === 'rock') {
      // standing on a stone: its top, measured once per visit around the spot
      return this.spotInfo.pos.y;
    }
    return this.pond.height(x, z);
  }
  waterTouch(p, amp) {
    if (this.spotInfo && this.spotInfo.kind === 'rock') return;
    if (p.y < 0.02) { this.pond.addRipple(p.x, p.z, amp); if (amp > 0.5) this.pond.splash(p.x, 0, p.z, 4, 0.5); }
  }

  /* ---------- settle after the touchdown: wings held up, then folded; body down onto the legs ---------- */
  updateSettle(dt) {
    const t = this.t;
    this.yaw.step(nearAngle(this.landYaw, this.yaw.x), 3, dt);
    this.roll.step(0, 5, dt);
    this.pitch.step(lerp(-0.5, STAND_PITCH, smoothstep(0.1, 1.2, t)), 5, dt);
    this.standBody(dt, 4.5, 0);
    // a last half beat with the wings held high, then the fold
    this.flapF = lerp(2.2, 1.2, smoothstep(0, 0.6, t));
    this.flapA.step(t < 0.35 ? 0.7 : 0, 6, dt);
    this.sweep.step(0.1, 3, dt);
    this.fold.step(t < 0.55 ? 0.1 : 1, 4.2, dt);
    for (const f of this.feet) f.closed.step(0, 6, dt);
    this.standNeck(dt, 0.4, 3.5);
    if (t > 1.6) {
      this.state = 'stay'; this.t = 0; this.stayT = 0;
      this.act = null; this.nextAct('still', 3 + this.rng.range(0, 2));
      this.ruffle = 0.8;
    }
  }

  /* ---------- the stay: long stillness, slow wading, stretches, head tilts, preening, hunting ---------- */
  nextAct(type, dur) {
    const r = this.rng;
    if (!type) {
      const canWalk = this.spotInfo.kind === 'water';
      const prev = this.act ? this.act.type : '';
      const opts = [['still', 3], ['look', 1.2], ['stretch', 0.9], ['tilt', 1.4], ['preen', prev === 'preen' ? 0 : 1], ['hunt', this.pond.preyNear ? 2.2 : 0.6]];
      if (canWalk) opts.push(['walk', prev === 'walk' ? 0.6 : 2]);
      opts.push(['turn', 0.5]);
      let sum = 0; for (const o of opts) sum += o[1];
      let x = r.next() * sum; type = 'still';
      for (const o of opts) { x -= o[1]; if (x <= 0) { type = o[0]; break; } }
      if (type === prev && type !== 'still') type = 'still';
    }
    const durs = { still: [4, 10], look: [3, 5], stretch: [3, 5], tilt: [2.5, 4.5], preen: [4, 7], hunt: [5, 11], walk: [0, 0], turn: [0, 0] };
    const d = durs[type];
    this.act = { type, t: 0, dur: dur || r.range(d[0], d[1]), k: 0, side: r.chance(0.5) ? 1 : -1, n: 0, next: 0 };
    if (type === 'walk') this.planWalk(r.int(2, 5));
    if (type === 'turn') this.planTurn(r.range(0.6, 1.5) * (r.chance(0.5) ? 1 : -1));
    // the head's own small, slow adjustments while it stands
    this.act.lookYaw = 0; this.act.lookPitch = 0;
  }
  updateStay(dt, time) {
    this.stayT += dt;
    const A = this.act;
    A.t += dt;
    const leaving = this.stayT > this.stayDur;
    // pose targets for this act
    let bodyLean = 0, bodyLow = 0, neckExt = 0.42, headDown = 0.18, headYaw = 0, headRoll = 0, neckW = 3.2, crest = 0;
    let headFwd = 0.05, headSide = 0, headUp = 0, a0 = 0.95, a3 = 1.0;
    const r = this.rng;
    if (A.t >= A.next) {
      // occasional small head adjustments: slow and rare (statue-like)
      A.next = A.t + r.range(1.8, 4.5);
      A.lookYaw = r.range(-0.35, 0.35); A.lookPitch = r.range(-0.08, 0.12);
    }
    headYaw = A.lookYaw; headDown += A.lookPitch;
    switch (A.type) {
      case 'still': {
        neckExt = 0.36; neckW = 2.2;
        break;
      }
      case 'look': {
        const k = Math.sin(A.t * 0.9) ;
        headYaw = k * 0.75 * A.side; neckExt = 0.55; headDown = 0.05; neckW = 2.6;
        break;
      }
      case 'stretch': {
        const k = smoothstep(0, 1.2, A.t) * (1 - smoothstep(A.dur - 1.2, A.dur, A.t));
        neckExt = lerp(0.4, 1.0, k); headDown = lerp(0.18, -0.08, k); crest = k * 0.35; bodyLean = lerp(0, -0.14, k);
        headYaw = Math.sin(A.t * 0.7) * 0.5 * k; neckW = 2.4;
        break;
      }
      case 'tilt': {
        const k = smoothstep(0, 0.8, A.t) * (1 - smoothstep(A.dur - 0.8, A.dur, A.t));
        headRoll = A.side * 0.55 * k; headDown = lerp(0.18, 0.62, k); neckExt = lerp(0.4, 0.32, k); headFwd = lerp(0.05, 0.11, k);
        if (A.t > A.dur * 0.55 && !A.flipped) { A.flipped = true; if (r.chance(0.4)) A.side = -A.side; }
        neckW = 3;
        break;
      }
      case 'preen': {
        // the bill goes into the back and the wing coverts, nibbling; a rouse (ruffle and shake) to finish
        const k = smoothstep(0, 1.0, A.t) * (1 - smoothstep(A.dur - 0.9, A.dur, A.t));
        const nib = Math.sin(A.t * 17) * 0.5 + Math.sin(A.t * 11.3 + 1) * 0.5;
        const spot = (Math.floor(A.t / 2.2) % 2) ? 1 : -1;
        headFwd = lerp(0.05, -0.27, k); headSide = A.side * spot * 0.06 * k; headUp = lerp(0, -0.16, k) + nib * 0.006 * k;
        neckExt = lerp(0.4, 0.3, k); headDown = lerp(0.18, 1.15, k); headYaw = A.side * spot * 2.3 * k; headRoll = A.side * spot * 0.4 * k;
        neckW = 4.5; a0 = lerp(0.95, 0.55, k); a3 = lerp(1.0, -0.8, k);
        if (A.t > A.dur - 0.5 && !A.roused) { A.roused = true; this.ruffle = 1; }
        break;
      }
      case 'hunt': this.updateHunt(dt, A); ({ bodyLean, bodyLow, neckExt, headDown, headYaw, neckW, headFwd } = A.pose); break;
      case 'walk': case 'turn': {
        neckExt = 0.46; headDown = 0.28; neckW = 4; bodyLean = 0.16; bodyLow = 0.012;
        if (this.stepsLeft <= 0 && this.feet.every(f => f.planted)) A.dur = Math.min(A.dur, A.t);
        else A.dur = A.t + 1;
        break;
      }
    }
    if (leaving && A.type !== 'walk' && A.type !== 'turn' && A.type !== 'hunt' && A.t > 1.2) {
      this.beginTakeoff();
      return;
    }
    this.stepFeet(dt);
    {
      const y0 = this.feet[0].yaw, y1 = nearAngle(this.feet[1].yaw, y0);
      this.yaw.step(nearAngle((y0 + y1) * 0.5, this.yaw.x), 2.4, dt);
    }
    this.pitch.step(STAND_PITCH + bodyLean, 2.2, dt);
    this.roll.step(0, 3, dt);
    this.standBody(dt, 3.2, bodyLow);
    if (A.type === 'hunt') { a0 = 1.25; a3 = 1.25; }
    this.headTarget(dt, { neckExt, headDown, headYaw, headRoll, neckW, crest, headFwd, headSide, headUp, a0, a3 });
    this.flapA.step(0, 6, dt); this.fold.step(1, 5, dt); this.sweep.step(0.1, 3, dt);
    // legs standing in the water now and then send out a faint ring
    for (const f of this.feet) {
      if (!f.planted || this.spotInfo.kind === 'rock') continue;
      f.wetT -= dt;
      if (f.wetT <= 0) { f.wetT = r.range(3, 7); this.pond.addRipple(f.pos.x, f.pos.z, 0.12); }
    }
    if (A.t >= A.dur && (A.type !== 'hunt' || !this.prey)) this.nextAct();
  }

  /** The body follows the feet: over their midpoint, at standing height (lowered by `low`). */
  standBody(dt, w, low) {
    const f0 = this.feet[0], f1 = this.feet[1];
    _a.addVectors(f0.pos, f1.pos).multiplyScalar(0.5);
    const yaw = this.yaw.x;
    // body centre sits a little behind the feet (the legs angle forward from the hips)
    _a.x -= Math.sin(yaw) * 0.03; _a.z -= Math.cos(yaw) * 0.03;
    // while one foot is up, the weight shifts over the other
    for (const f of this.feet) if (!f.planted) { const o = f.si === 0 ? this.feet[1] : this.feet[0]; _a.lerp(_b.copy(o.pos).setY(_a.y), 0.18 * Math.sin(Math.PI * f.t)); }
    _a.y = Math.min(f0.pos.y, f1.pos.y) - FOOT_DROP + STAND_H - low + Math.sin(this.t * 1.7) * 0.0015;
    this.bodyPos.step(_a, w, dt);
  }

  /** Head targets in the body's frame, held in world space by a spring (the neck absorbs the body's motion). */
  headTarget(dt, o) {
    const ext = o.neckExt;
    // chord from the neck base to the head, in the body frame (y up, z forward)
    const up = lerp(0.17, 0.43, ext) + (o.headUp || 0), fwd = lerp(0.05, 0.1, ext) + (o.headFwd || 0);
    _a.set(o.headSide || 0, NECK_BASE.y + up, NECK_BASE.z + fwd);
    this.obj.updateMatrixWorld();
    _a.applyMatrix4(this.obj.matrixWorld);
    this.headW.step(_a, o.neckW, dt);
    const yaw = this.yaw.x;
    this.hYaw.step(nearAngle(yaw + o.headYaw, this.hYaw.x), o.neckW * 0.9, dt);
    this.hPitch.step(o.headDown, o.neckW * 0.9, dt);
    this.hRoll.step(o.headRoll, o.neckW * 0.8, dt);
    this.crest.step(o.crest || 0, 3, dt);
    this.neckA0.step(o.a0 ?? 0.95, o.neckW * 0.8, dt);
    this.neckA3.step(o.a3 ?? 1.0, o.neckW * 0.8, dt);
  }
  standNeck(dt, ext, w) { this.headTarget(dt, { neckExt: ext, headDown: 0.2, headYaw: 0, headRoll: 0, neckW: w, crest: 0.15 }); }
  /** flight: the neck drawn back into an S, the head resting between the shoulders */
  flightNeck(snap, dt = 0, look = 0) {
    _a.set(0, NECK_BASE.y + lerp(0.08, 0.16, look), NECK_BASE.z + lerp(0.05, 0.12, look));
    this.obj.updateMatrixWorld();
    _a.applyMatrix4(this.obj.matrixWorld);
    if (snap) {
      this.headW.set(_a); this.hYaw.set(this.yaw.x); this.hPitch.set(this.pitch.x * 0.5); this.hRoll.set(0);
      this.neckA0.set(2.0); this.neckA3.set(1.25);
      return;
    }
    this.neckA0.step(lerp(2.0, 1.2, look), 5, dt); this.neckA3.step(lerp(1.25, 1.0, look), 5, dt);
    this.headW.step(_a, 7, dt);
    this.hYaw.step(nearAngle(this.yaw.x, this.hYaw.x), 6, dt);
    this.hPitch.step(this.pitch.x * 0.6 + look * 0.35, 5, dt);
    this.hRoll.step(this.roll.x * 0.5, 5, dt);
    this.crest.step(-0.25, 4, dt);
  }

  /* ---------- wading: planted feet, one deliberate step at a time ---------- */
  planWalk(n) {
    this.stepsLeft = n;
    this.walkTurn = this.rng.range(-0.18, 0.18);
    this.stepPause = 0.3;
  }
  planTurn(total) {
    const n = Math.max(2, Math.ceil(Math.abs(total) / 0.45));
    this.stepsLeft = n;
    this.turnPer = total / n;
    this.walkTurn = 0;
    this.stepPause = 0.15;
    this.turning = true;
  }
  stepFeet(dt) {
    const r = this.rng;
    for (const f of this.feet) {
      if (f.planted) continue;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = easeIO(f.t);
      const prevY = f.pos.y;
      f.pos.lerpVectors(f.from, f.to, e);
      // high, careful lift: up and forward, toes closed, then reached out and set down
      f.pos.y += f.lift * Math.pow(Math.sin(Math.PI * Math.min(1, f.t * 1.08)), 0.85);
      f.yaw = f.fromYaw + (f.toYaw - f.fromYaw) * e;
      f.closed.step(f.t < 0.82 ? 1 : 0, 7, dt);
      // breaking and re-entering the surface
      if (prevY < 0 && f.pos.y >= 0) this.waterTouch(f.pos, 0.35);
      if (prevY > 0 && f.pos.y <= 0) this.waterTouch(f.pos, 0.55);
      if (f.t >= 1) { f.planted = true; f.pos.copy(f.to); f.yaw = f.toYaw; this.stepPauseT = this.stepPause + r.range(0, 0.6); }
    }
    if (this.stepsLeft > 0 && this.feet.every(f => f.planted)) {
      this.stepPauseT = (this.stepPauseT || 0) - dt;
      if (this.stepPauseT <= 0) this.takeStep();
    }
  }
  takeStep() {
    const P = this.pond;
    // the rear foot steps
    const yaw = this.yaw.x;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const [f0, f1] = this.feet;
    const d0 = f0.pos.x * fx + f0.pos.z * fz, d1 = f1.pos.x * fx + f1.pos.z * fz;
    const mover = d0 <= d1 ? f0 : f1, stance = mover === f0 ? f1 : f0;
    let newYaw = yaw, len;
    if (this.turning) { newYaw = yaw + this.turnPer; len = 0.04; }
    else { newYaw = yaw + this.walkTurn; len = this.rng.range(0.17, 0.23); }
    const s = mover.si === 0 ? 1 : -1;
    const nfx = Math.sin(newYaw), nfz = Math.cos(newYaw);
    // the mover lands beside the stance foot (on its own side), one step length ahead in the new heading
    const lat = 0.1;
    const tx = stance.pos.x + nfx * len + (nfz) * lat * s, tz = stance.pos.z + nfz * len + (-nfx) * lat * s;
    // can it go there? water of wading depth, clear of rocks, pads, the bridge and the shore
    const dd = P.sdf(tx, tz);
    const ok = this.turning || (dd < -0.1 && dd > -0.62 && P.obstacleGap(tx, tz) > 0.12 && !P.nearBridge(tx, tz, 0.4) && P.pads.every(p => Math.hypot(tx - p.mesh.position.x, tz - p.mesh.position.z) > 0.45));
    if (!ok) { this.stepsLeft = 0; this.turning = false; return; }
    mover.from.copy(mover.pos); mover.fromYaw = mover.yaw;
    mover.to.set(tx, this.floorAt(tx, tz) + FOOT_DROP, tz);
    mover.toYaw = newYaw;
    mover.t = 0; mover.dur = this.turning ? this.rng.range(0.7, 0.9) : this.rng.range(1.0, 1.3);
    mover.lift = this.turning ? 0.06 : this.rng.range(0.12, 0.17);
    mover.planted = false;
    this.yawTarget = newYaw;
    this.stepsLeft--;
    if (this.stepsLeft <= 0) this.turning = false;
  }

  /* ---------- hunting: stalk, freeze, strike; a caught minnow is held, tossed and swallowed ---------- */
  updateHunt(dt, A) {
    const P = this.pond;
    A.pose = A.pose || {};
    const o = A.pose;
    o.bodyLean = 0.32; o.bodyLow = 0.03; o.neckExt = 0.3; o.headDown = 0.85; o.headYaw = 0; o.neckW = 3.4; o.headFwd = 0.12;
    const yaw = this.yaw.x, fx = Math.sin(yaw), fz = Math.cos(yaw);
    // the bill's reach: a little ahead of the feet
    if (!A.phase) A.phase = 'watch';
    if (A.phase === 'watch') {
      if (!this.prey && P.findPrey) this.prey = P.findPrey(this.spot, fx, fz);
      if (this.prey) {
        _a.copy(this.prey.pos).sub(this.bodyPos.x);
        const ang = Math.atan2(_a.x, _a.z) - yaw;
        o.headYaw = clamp(nearAngle(ang, 0), -0.6, 0.6) * 0.7;
        A.aimT = (A.aimT || 0) + dt;
        if (A.aimT > 1.4 + (A.freeze || (A.freeze = this.rng.range(0.4, 1.8)))) {
          A.phase = 'strike'; A.k = 0; A.strikeAt = this.prey.pos.clone(); A.strikeAt.y = -0.025;
          o.neckW = 30;
        }
      } else if (A.t > A.dur) { A.dur = A.t; }
    }
    if (A.phase === 'strike') {
      A.k += dt;
      // the head shoots to the prey (bill tip to the fish), a splash, then up again
      const reachT = 0.16;
      if (A.k < reachT) {
        o.neckW = 34; o.neckExt = 1; o.bodyLean = 0.62; o.headDown = 1.25;
        this.strikeHead(A.strikeAt, dt, 34);
        return;
      }
      if (!A.hit) {
        A.hit = true;
        P.addRipple(A.strikeAt.x, A.strikeAt.z, 1.0);
        P.splash(A.strikeAt.x, 0, A.strikeAt.z, 7, 0.7);
        P.env.sfx('splash');
        this.alarm = 1;
        const caught = this.prey && this.prey.pos.distanceTo(A.strikeAt) < 0.12 && this.rng.chance(0.6);
        if (caught && P.catchPrey) this.held = P.catchPrey(this.prey);
        P.preyScatter && P.preyScatter(A.strikeAt);
        this.prey = null;
      }
      if (A.k < reachT + 0.3) { o.neckW = 10; o.bodyLean = 0.5; o.headDown = 0.9; this.strikeHead(A.strikeAt, dt, 10); return; }
      if (A.k < reachT + 1.7 && this.held) {
        // head raised with the minnow crosswise in the bill, a toss, and it is gone
        o.neckExt = 0.62; o.headDown = lerp(-0.25, 0.1, smoothstep(reachT + 1.0, reachT + 1.4, A.k)); o.neckW = 6; o.bodyLean = 0.0;
        if (A.k > reachT + 1.35 && this.held) { this.held.gulp = true; }
        return;
      }
      if (this.held && this.held.gulp && A.k > reachT + 1.5) { P.swallowPrey && P.swallowPrey(this.held); this.held = null; }
      A.phase = 'done';
      A.dur = A.t + 1.2;
    }
    if (A.phase === 'done') { o.neckExt = 0.45; o.headDown = 0.3; o.neckW = 3; o.bodyLean = 0.06; o.bodyLow = 0; }
  }
  strikeHead(target, dt, w) {
    // head-bone position so that the bill tip reaches the target, bill pointing down along the strike
    const yaw = this.yaw.x;
    _a.subVectors(target, this.headW.x);
    const ang = Math.atan2(_a.x, _a.z);
    this.hYaw.step(nearAngle(ang, this.hYaw.x), w, dt);
    this.hPitch.step(1.15, w, dt);
    this.hRoll.step(0, w, dt);
    const cp = Math.cos(1.15), sp = Math.sin(1.15);
    _b.set(Math.sin(this.hYaw.x) * cp, -sp, Math.cos(this.hYaw.x) * cp); // bill direction
    _c.copy(target).addScaledVector(_b, -0.16);
    this.headW.step(_c, w, dt);
    void yaw;
  }

  /* ---------- leaving ---------- */
  beginTakeoff() {
    const r = this.rng, P = this.pond;
    this.state = 'takeoff'; this.t = 0;
    this.act = null;
    // exit: away from the camera, climbing out of the picture over the far side; pick a clear direction
    const yaw = this.yaw.x;
    let best = null;
    for (const da of [0, 0.5, -0.5, 1.0, -1.0, 1.5, -1.5]) {
      const ang = yaw + da;
      const dir = V(Math.sin(ang), 0, Math.cos(ang));
      const away = dir.dot(P.farDir);
      this.makeOutbound(dir);
      const c = this.pathClearance();
      const sc = Math.min(c, 1.5) + away * 0.8 - Math.abs(da) * 0.15;
      if (!best || sc > best.sc) best = { sc, dir: dir.clone() };
    }
    this.exitDir = best.dir;
    this.launched = false;
    this.present = false;
    void r;
  }
  makeOutbound(dir) {
    const p = this.path.p, b = this.bodyPos.x;
    const yaw = this.yaw.x, h = V(Math.sin(yaw), 0, Math.cos(yaw));
    p[0].copy(b); p[0].y += 0.05;
    p[1].copy(b).addScaledVector(h, 2.2); p[1].y += 1.6;
    p[2].copy(b).addScaledVector(dir, 12); p[2].y += 6.5;
    p[3].copy(b).addScaledVector(dir, 34); p[3].y += 15;
    this.path.measure();
  }
  updateTakeoff(dt) {
    const t = this.t;
    if (!this.launched) {
      // crouch, neck drawn in, wings opened and raised: then the jump with the first deep downstroke
      this.pitch.step(STAND_PITCH + 0.5, 4, dt);
      this.standBody(dt, 5, 0.06 * smoothstep(0, 0.4, t));
      this.headTarget(dt, { neckExt: 0.2, headDown: 0.1, headYaw: 0, headRoll: 0, neckW: 5, crest: -0.1, headFwd: 0.08 });
      this.fold.step(t > 0.25 ? 0 : 1, 7, dt);
      this.sweep.step(-0.1, 4, dt);
      this.flapF = 2.4;
      this.flapA.step(t > 0.35 ? 0.9 : 0.2, 5, dt);
      if (t > 0.7) {
        this.launched = true; this.pathS = 0; this.launchT = 0;
        this.makeOutbound(this.exitDir);
        this.alarm = Math.max(this.alarm, 0.6);
        for (const f of this.feet) { if (f.pos.y < 0.03) this.waterTouch(f.pos, 0.7); }
        this.pond.onHeronLeft && this.pond.onHeronLeft(this);
      }
      this.stepFeet(dt);
      return;
    }
    this.launchT += dt;
    const v = lerp(0.9, 4.4, smoothstep(0, 2.6, this.launchT));
    this.pathS = Math.min(this.path.total, this.pathS + v * dt);
    const tt = this.path.tAt(this.pathS);
    this.path.at(tt, _a);
    // the climb starts from the crouch: the body eases onto the path
    _a.lerp(this.bodyPos.x, Math.exp(-6 * this.launchT));
    this.bodyPos.follow(_a, dt);
    this.path.tangent(tt, _b);
    const yawT = nearAngle(Math.atan2(_b.x, _b.z), this.yaw.x);
    const prevYaw = this.yaw.x;
    this.yaw.step(yawT, 2.6, dt);
    const yawRate = (this.yaw.x - prevYaw) / Math.max(dt, 1e-4);
    this.roll.step(clamp(yawRate * v * 0.12, -0.4, 0.4), 3, dt);
    this.pitch.step(-Math.asin(clamp(_b.y, -1, 1)) * 0.35 - 0.12 * (1 - smoothstep(0.5, 2, this.launchT)), 3.5, dt);
    this.flapF = lerp(2.4, 1.8, smoothstep(0.5, 3, this.launchT));
    this.flapA.step(lerp(0.95, 0.6, smoothstep(0.5, 3, this.launchT)), 3, dt);
    this.sweep.step(0, 3, dt); this.bow.step(0.1, 3, dt);
    this.fold.step(0, 8, dt);
    // feet leave their holds as the legs straighten, dangle, then trail behind
    for (const f of this.feet) {
      const s = f.si === 0 ? 1 : -1;
      if (f.planted) {
        this.obj.updateMatrixWorld();
        _c.copy(f.pos); this.obj.worldToLocal(_c);
        _d.copy(KNEE[f.si]);
        if (_c.distanceTo(_d) > (L_TIB + L_TAR) * 0.985 || this.launchT > 0.45) {
          f.planted = false; f.local.copy(_c); f.localS.set(_c); f.plantK = 0;
          this.waterTouch(f.pos, 0.45);
        }
        continue;
      }
      const k = smoothstep(0.3, 1.6, this.launchT);
      f.local.set(s * 0.04, -0.47, 0.02).lerp(_c.set(s * 0.035, -0.09, -0.5), k);
      f.closed.step(1, 5, dt);
    }
    this.flightNeck(false, dt, 0);
    if (this.pathS > 6) { this.state = 'leave'; this.t = 0; }
  }
  updateLeave(dt) {
    const v = 4.6;
    this.pathS += v * dt;
    if (this.pathS <= this.path.total) {
      const tt = this.path.tAt(this.pathS);
      this.path.at(tt, _a); this.path.tangent(tt, _b);
    } else {
      // past the end of the path: straight on
      this.path.tangent(1, _b);
      this.path.at(1, _a).addScaledVector(_b, this.pathS - this.path.total);
    }
    this.bodyPos.follow(_a, dt);
    const prevYaw = this.yaw.x;
    this.yaw.step(nearAngle(Math.atan2(_b.x, _b.z), this.yaw.x), 2.6, dt);
    const yawRate = (this.yaw.x - prevYaw) / Math.max(dt, 1e-4);
    this.roll.step(clamp(yawRate * v * 0.12, -0.4, 0.4), 3, dt);
    this.pitch.step(-Math.asin(clamp(_b.y, -1, 1)) * 0.35, 3, dt);
    this.flapF = 1.8; this.flapA.step(0.58, 2, dt);
    for (const f of this.feet) { const s = f.si === 0 ? 1 : -1; f.local.set(s * 0.035, -0.09, -0.5); }
    this.flightNeck(false, dt, 0);
    // gone once out of sight and well away (or after a long while, whatever the camera does)
    const cam = this.pond.camera;
    cam.updateMatrixWorld();
    _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(_m);
    this.sphere.center.copy(this.bodyPos.x); this.sphere.radius = 1.3;
    const away = this.pathS > 14 && !this.frustum.intersectsSphere(this.sphere);
    if (away || this.t > 25) this.endVisit();
  }
  endVisit() {
    this.state = 'away';
    this.obj.visible = false;
    this.present = false;
    this.wait = this.rng.range(120, 200);
    if (this.held) { this.pond.swallowPrey && this.pond.swallowPrey(this.held); this.held = null; }
    this.restPose();
  }
  /** a neutral standing pose (also what the hidden heron keeps between visits) */
  restPose() {
    this.fold.set(1); this.flapA.set(0);
    for (const f of this.feet) { f.planted = false; f.closed.set(0); f.local.set(f.si === 0 ? 0.05 : -0.05, -STAND_H + FOOT_DROP, 0.035); f.localS.set(f.local); f.plantK = 0; }
  }

  /** Test hook: start a visit now (spot index, or -1 to choose) and run it forward t seconds. */
  debug(t = 14, spot = -1, stay = 120) {
    this.frozen = false;
    this.beginVisit(spot, stay);
    const n = Math.round(t * 30);
    for (let i = 0; i < n && this.state !== 'away'; i++) this.update(1 / 30, i / 30);
    return { state: this.state, spot: this.lastSpot, kind: this.spotInfo.kind, pos: this.bodyPos.x.toArray().map(v => +v.toFixed(2)), spots: this.spots.length };
  }

  /* ------------------------------------------------------------------ */
  /* Posing the skeleton from the state                                 */
  /* ------------------------------------------------------------------ */
  applyRoot() {
    const o = this.obj;
    o.position.copy(this.bodyPos.x);
    _e.set(this.pitch.x, this.yaw.x, -this.roll.x, 'YXZ');
    o.quaternion.setFromEuler(_e);
    o.updateMatrixWorld();
  }
  /** world position of the bill tip */
  billTip(out) {
    const B = this.bones;
    out.set(0, -0.003, HEAD_Z1 - 0.004).applyQuaternion(B[BI.HEAD].quaternion).add(B[BI.HEAD].position);
    return out.applyMatrix4(this.obj.matrixWorld);
  }
  pose(dt) {
    const o = this.obj;
    o.position.copy(this.bodyPos.x);
    _e.set(this.pitch.x, this.yaw.x, -this.roll.x, 'YXZ');
    o.quaternion.setFromEuler(_e);
    // a rouse: a quick shiver of the plumage that fades out
    if (this.ruffle > 0) {
      this.ruffle = Math.max(0, this.ruffle - dt * 1.6);
      const k = this.ruffle * this.ruffle;
      _q.setFromAxisAngle(_a.set(0, 0, 1), Math.sin(this.t * 34) * 0.07 * k);
      o.quaternion.multiply(_q);
    }
    o.updateMatrixWorld();
    const B = this.bones;
    B[BI.BODY].position.set(0, 0, 0); B[BI.BODY].quaternion.identity();
    // where the pond's creatures see the heron standing (between its feet)
    (this.center || (this.center = new THREE.Vector3())).addVectors(this.feet[0].pos, this.feet[1].pos).multiplyScalar(0.5);
    this.poseNeck();
    this.poseLegs(dt);
    this.poseWings(dt);
    // tail: a slight lift in flight and on landing
    this.tailUp.step(this.state === 'stay' ? 0 : 0.12, 3, dt || 0.016);
    B[BI.TAIL].position.copy(TAIL_BIND);
    B[BI.TAIL].quaternion.setFromAxisAngle(_a.set(1, 0, 0), -this.tailUp.x);
    // closed wingtips over the tail: drawn into the body while the flight wings are out
    const cwS = lerp(0.12, 1, smoothstep(0.55, 0.95, this.fold.x));
    B[BI.CW].position.copy(CW_BIND);
    B[BI.CW].quaternion.identity();
    B[BI.CW].scale.set(cwS, lerp(0.6, 1, cwS), cwS);
    // the uniform that keeps thin parts at least ~1.6 px wide
    const cam = this.pond.camera, h = this.pond.env.renderer.getDrawingBufferSize(this.pond._dbs || (this.pond._dbs = new THREE.Vector2())).y;
    this.U.uHPx.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) * 0.5));
  }

  poseNeck() {
    const B = this.bones, o = this.obj;
    // head target and orientation in the body frame
    const hp = _hp.copy(this.headW.x);
    o.worldToLocal(hp);
    // the neck cannot stretch: pull the head back toward the base when out of reach
    const base = NECK_BASE;
    _b.subVectors(hp, base);
    const maxC = NECK_L * 0.93;
    if (_b.length() > maxC) { _b.setLength(maxC); hp.copy(base).add(_b); }
    // keep the head out of the breast (but it may reach back over the body when preening)
    if (hp.y < base.y - 0.06 && hp.z > base.z - 0.08 && this.state === 'stay' && !(this.act && this.act.type === 'hunt')) hp.y = base.y - 0.06;
    _e.set(this.hPitch.x, this.hYaw.x - this.yaw.x, -this.hRoll.x, 'YXZ');
    _q2.setFromEuler(_e);               // head orientation relative to the heading (world-level)
    // relative to the body (which may be pitched or rolled): q_body^-1 * q_yaw * q_head
    _q.setFromAxisAngle(UP, this.yaw.x);
    _q.multiply(_q2);
    const headQ = this.headQ || (this.headQ = new THREE.Quaternion());
    headQ.copy(o.quaternion).invert().multiply(_q);
    // Bezier from the neck base into the back of the skull. The S lies in the body's middle plane: the lower neck
    // leaves ahead of the chord (base -> head) and the upper neck comes into the head from behind it (a3 > 0), or
    // both bow the same way into a C when the head reaches back over the body (a3 < 0)
    const nb = this.neck, p = nb.p;
    p[0].copy(base); p[3].copy(hp);
    const chord = _c.subVectors(hp, base);
    const cl = chord.length() || 1e-4;
    chord.divideScalar(cl);
    const hf = _x.set(0, 0, 1).applyQuaternion(headQ);
    const fperp = this._fp || (this._fp = new THREE.Vector3());
    fperp.set(0, 0, 0.75).addScaledVector(hf, 0.25);
    fperp.addScaledVector(chord, -fperp.dot(chord));
    if (fperp.lengthSq() < 1e-6) fperp.set(0, 1, 0).addScaledVector(chord, -chord.y);
    fperp.normalize();
    const a0 = this.neckA0.x, a3 = this.neckA3.x;
    const T0 = _d.copy(chord).multiplyScalar(Math.cos(a0)).addScaledVector(fperp, Math.sin(a0));
    const T3 = _f.copy(chord).multiplyScalar(Math.cos(a3)).addScaledVector(fperp, Math.sin(a3));
    // control length chosen so the curve keeps the neck's length (bisection on the arc length)
    let lo = 0.0, hi = 0.45;
    for (let it = 0; it < 9; it++) {
      const k = (lo + hi) * 0.5;
      p[1].copy(base).addScaledVector(T0, k * 1.1); p[2].copy(hp).addScaledVector(T3, -k * 0.9);
      if (nb.measure() < NECK_L) lo = k; else hi = k;
    }
    const k = (lo + hi) * 0.5;
    p[1].copy(base).addScaledVector(T0, k * 1.1); p[2].copy(hp).addScaledVector(T3, -k * 0.9);
    nb.measure();
    void cl;
    // bones by arc length; frames parallel-transported from the base, the head's twist spread along the neck
    const scale = nb.total / NECK_L;
    let prevT = this._pt || (this._pt = new THREE.Vector3());
    const fwd = this._pf || (this._pf = new THREE.Vector3());
    prevT.set(0, 1, 0); fwd.set(0, 0, 1);
    // twist: the head's forward projected across the end tangent vs the transported forward
    const endT = nb.tangent(1, this._et || (this._et = new THREE.Vector3()));
    const tq = this._tq || (this._tq = new THREE.Quaternion());
    // transport the base forward to the end to measure the twist
    const frames = this._frames || (this._frames = Array.from({ length: NECK_N + 1 }, () => ({ p: new THREE.Vector3(), t: new THREE.Vector3(), f: new THREE.Vector3() })));
    for (let i = 0; i <= NECK_N; i++) {
      const s = (i / NECK_N) * NECK_L * scale;
      const t = nb.tAt(s);
      nb.at(t, frames[i].p);
      nb.tangent(t, frames[i].t);
      tq.setFromUnitVectors(prevT, frames[i].t);
      fwd.applyQuaternion(tq).addScaledVector(frames[i].t, -fwd.dot(frames[i].t)).normalize();
      frames[i].f.copy(fwd);
      prevT.copy(frames[i].t);
    }
    // head forward across the end tangent
    _x.set(0, 0, 1).applyQuaternion(headQ);
    _x.addScaledVector(endT, -_x.dot(endT));
    let twist = 0;
    if (_x.lengthSq() > 1e-8) {
      _x.normalize();
      const f = frames[NECK_N].f;
      twist = Math.atan2(_y.crossVectors(f, _x).dot(endT), f.dot(_x));
    }
    for (let i = 0; i < NECK_N; i++) {
      const fr = frames[i];
      _z.copy(fr.f).applyAxisAngle(fr.t, twist * (i / NECK_N));
      basisYZ(B[BI.NECK + i].quaternion, fr.t, _z);
      B[BI.NECK + i].position.copy(fr.p);
    }
    B[BI.HEAD].position.copy(hp);
    B[BI.HEAD].quaternion.copy(headQ);
    // crest plumes: lift when alert, flatten in flight, a little lag-sway
    _q.setFromAxisAngle(_a.set(1, 0, 0), this.crest.x + 0.04);
    B[BI.CREST].position.copy(CREST_OFF).applyQuaternion(headQ).add(hp);
    B[BI.CREST].quaternion.copy(headQ).multiply(_q);
    // breast plumes hang from the lower neck under gravity
    const fp = frames[1];
    B[BI.PLUME].position.copy(fp.p).addScaledVector(fp.f, 0.038).addScaledVector(fp.t, 0.003);
    _a.set(0, -1, 0).applyQuaternion(_q.copy(this.obj.quaternion).invert()); // world down, in the body frame
    _b.set(0, 0, 1);
    basisYZ(B[BI.PLUME].quaternion, _a.negate(), _b);
  }

  poseLegs(dt) {
    const B = this.bones, o = this.obj;
    for (const f of this.feet) {
      const si = f.si, s = si === 0 ? 1 : -1;
      // foot target in the body frame: planted feet are fixed in the world
      const ft = _ft;
      if (f.planted) { ft.copy(f.pos); o.worldToLocal(ft); f.localS.set(ft); }
      else if (this.state === 'stay' || (this.state === 'takeoff' && !this.launched)) { ft.copy(f.pos); o.worldToLocal(ft); f.localS.set(ft); }
      else {
        f.localS.step(f.local, 9, dt || 0.016);
        ft.copy(f.localS.x);
        if (f.plantK > 0 && f.plantTarget) { _b.copy(f.plantTarget); o.worldToLocal(_b); ft.lerp(_b, f.plantK); }
      }
      // the knee swings a little toward the foot (the hidden femur), then two-bone IK, ankle bending backward
      const knee = _knee.copy(KNEE[si]);
      knee.z += clamp((ft.z - knee.z) * 0.18, -0.05, 0.05);
      knee.y += clamp((ft.y - (knee.y - 0.4)) * 0.08, -0.03, 0.03);
      const dir = _dir.subVectors(ft, knee);
      let d = dir.length();
      const L1 = L_TIB, L2 = L_TAR, maxD = (L1 + L2) * 0.999;
      d = clamp(d, Math.abs(L1 - L2) + 1e-3, maxD);
      dir.normalize();
      const a1 = (L1 * L1 - L2 * L2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, L1 * L1 - a1 * a1));
      // bend direction: backward in the body frame, across the leg's line
      const bend = _f.set(0, 0, -1).addScaledVector(dir, dir.z).normalize();
      const ankle = _ankle.copy(knee).addScaledVector(dir, a1).addScaledVector(bend, h);
      const foot = _foot.copy(knee).addScaledVector(dir, d);
      // bones: tibia (knee -> ankle), tarsus (ankle -> foot); bone -Y runs down the segment
      B[BI.TIB[si]].position.copy(knee);
      basisYZ(B[BI.TIB[si]].quaternion, _seg.subVectors(knee, ankle), _c.set(0, 0, 1));
      B[BI.TAR[si]].position.copy(ankle);
      basisYZ(B[BI.TAR[si]].quaternion, _seg.subVectors(ankle, foot), _c.set(0, 0, 1));
      // foot: flat on the floor along its own heading when planted; toes drooped and closed when lifted
      B[BI.FOOT[si]].position.copy(foot);
      const closed = f.closed.x;
      const ground = (f.planted || this.state === 'stay' || this.state === 'settle' || (this.state === 'takeoff' && !this.launched)) ? 1 : (f.plantK || 0);
      const fq = B[BI.FOOT[si]].quaternion;
      if (ground < 1) {
        // in the air: the toes trail along the leg, curled a little
        basisZY(fq, _seg.subVectors(foot, ankle), _c.set(0, 1, 0.3));
        fq.multiply(_q.setFromAxisAngle(_a.set(1, 0, 0), 0.35));
      }
      if (ground > 0) {
        // on (or reaching for) the ground: level, along the foot's own heading; toes droop while lifted
        _e.set(0, f.planted || this.state === 'stay' ? f.yaw : this.landYaw ?? f.yaw, 0, 'YXZ'); _q.setFromEuler(_e);
        const air = f.planted ? 0 : (this.state === 'stay' ? Math.sin(Math.PI * clamp(f.t, 0, 1)) : 0);
        _q.multiply(_q2.setFromAxisAngle(_a.set(1, 0, 0), 0.9 * air));
        _q2.copy(o.quaternion).invert().multiply(_q);
        if (ground >= 1) fq.copy(_q2); else fq.slerp(_q2, ground);
      }
      B[BI.FOOT[si]].scale.set(lerp(1, 0.38, closed), 1, lerp(1, 0.86, closed));
      void s;
    }
  }

  poseWings(dt) {
    const B = this.bones;
    // continuous wingbeat phase; the amplitude eases (glides hold the wings level)
    this.flapPh = (this.flapPh + TAU * this.flapF * (dt || 0)) % TAU;
    const ph = this.flapPh, A = this.flapA.x, fold = clamp(this.fold.x, 0, 1);
    const vis = 1 - smoothstep(0.55, 0.95, fold);
    const down = Math.sin(ph);                       // > 0 during the downstroke
    const up = Math.max(0, -down);                   // upstroke strength
    for (let si = 0; si < 2; si++) {
      const s = si === 0 ? 1 : -1;
      const elev = 0.05 + A * Math.cos(ph) - fold * 0.35;
      const sweepH = this.sweep.x + 0.12 * A * down + fold * 1.25;
      const twistH = -0.1 * A * down;
      // compose R_y(sweep) * R_z(elev) * R_x(twist)
      const qh = _q.setFromAxisAngle(_a.set(0, 1, 0), s * sweepH);
      qh.multiply(_q2.setFromAxisAngle(_a.set(0, 0, 1), s * elev));
      qh.multiply(_q2.setFromAxisAngle(_a.set(1, 0, 0), twistH));
      const sh = _b.copy(SHOULDER[si]);
      sh.x *= lerp(0.55, 1, vis);
      B[BI.HUM[si]].position.copy(sh);
      B[BI.HUM[si]].quaternion.copy(qh);
      B[BI.HUM[si]].scale.setScalar(Math.max(vis, 0.001));
      // elbow: flexes on the upstroke (and folds forward)
      const flexE = 0.06 + 0.32 * A * up + fold * 2.55;
      const elevF = 0.12 * A * Math.cos(ph - 0.5);
      const qf = this._qf || (this._qf = new THREE.Quaternion());
      qf.copy(qh).multiply(_q2.setFromAxisAngle(_a.set(0, 1, 0), -s * flexE)).multiply(_q2.setFromAxisAngle(_a.set(0, 0, 1), s * elevF));
      const elbow = _c.set(s * L_HUM * Math.max(vis, 0.001), 0, 0).applyQuaternion(qh).add(sh);
      B[BI.FORE[si]].position.copy(elbow);
      B[BI.FORE[si]].quaternion.copy(qf);
      B[BI.FORE[si]].scale.setScalar(Math.max(vis, 0.001));
      // wrist: the hand lags the arm (a whip through the stroke), bows down, pronates on the downstroke
      const flexW = 0.05 + 0.5 * A * up + fold * 2.75;
      const elevW = -this.bow.x + 0.55 * A * Math.cos(ph - 0.85);
      const twistW = -0.28 * A * down;
      const qw = this._qw || (this._qw = new THREE.Quaternion());
      qw.copy(qf).multiply(_q2.setFromAxisAngle(_a.set(0, 1, 0), s * flexW)).multiply(_q2.setFromAxisAngle(_a.set(0, 0, 1), s * elevW)).multiply(_q2.setFromAxisAngle(_a.set(1, 0, 0), twistW));
      const wrist = _d.set(s * L_FORE * Math.max(vis, 0.001), 0, 0).applyQuaternion(qf).add(elbow);
      B[BI.HAND[si]].position.copy(wrist);
      B[BI.HAND[si]].quaternion.copy(qw);
      B[BI.HAND[si]].scale.setScalar(Math.max(vis, 0.001));
    }
  }

  /** time-of-day look: the rim light follows the sky */
  setLight(S) {
    const rim = this.U.uHRim.value;
    rim.copy(S.horizon).lerp(S.sunColor, S.golden * 0.6).multiplyScalar(lerp(0.32, 0.12, S.night));
  }

  dispose() {
    this.mesh.geometry.dispose(); this.mat.dispose();
    this.tex.map.dispose(); this.tex.normalMap.dispose();
    this.mesh.skeleton.dispose();
  }
}
