// Procedural fish: body + fins geometry, painted texture atlas with scale normals,
// a swim shader (travelling body wave, turn curvature, fin flutter) and steering helpers.
//
// Local frame of every fish: +X = head direction, +Y = up, +Z = fish's right side.
// Length is normalised to ~1 (nose at x=+0.5, tail fin tip near x=-0.5). Scale per instance.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, makeRng, makeCanvas, createNoise, patchMaterial, quatFromForward, angleDelta } from './util.js';

/* ------------------------------------------------------------------ */
/* Atlas layout                                                        */
/* ------------------------------------------------------------------ */
const BODY_U = 0.72; // body uses u in [0, 0.72]; s (0 nose .. 1 peduncle) -> u = s * BODY_U
export const REGION = { body: 0, caudal: 1, dorsal: 2, anal: 3, pectoral: 4, pelvic: 5, eye: 6 };
const RECT = {
  // [u0, v0, u1, v1]; a (base -> edge) runs along u, b runs along v
  caudal: [0.72, 0.00, 1.00, 0.46],
  dorsal: [0.72, 0.46, 1.00, 0.66],
  anal: [0.72, 0.66, 1.00, 0.80],
  pectoral: [0.72, 0.80, 0.88, 1.00],
  pelvic: [0.88, 0.80, 1.00, 0.90],
  eye: [0.88, 0.90, 0.98, 1.00],
};

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */
const BASE_SHAPE = {
  tailLen: 0.2, height: 0.3, hPos: 0.4, width: 0.15, wPos: 0.35,
  noseQ: 0.55, noseQw: 0.6, pinch: 0.3, pinchW: 0.35, arch: 0, mouthY: 0,
  caudal: { type: 'fork', L: 0.22, S: 0.14, notch: 0.6 },
  dorsal: { d0: 0.3, d1: 0.72, h: 0.1, profile: [0, 1, 0.8, 0.6, 0.1], sweep: 0.3 },
  anal: { d0: 0.62, d1: 0.82, h: 0.07, profile: [0, 1, 0.6, 0.1], sweep: 0.3 },
  pectoral: { s: 0.24, L: 0.12, W: 0.06, spread: 0.75, droop: 0.35, y: -0.18 },
  pelvic: { s: 0.46, L: 0.07, W: 0.035 },
  eye: { s: 0.1, r: 0.026, y: 0.14 },
  scales: { along: 46, around: 30, curve: 0.9 },
};

export const SHAPES = {
  koi: {
    tailLen: 0.2, height: 0.235, hPos: 0.36, width: 0.2, wPos: 0.32, noseQ: 0.5, noseQw: 0.55, pinch: 0.3, pinchW: 0.3, arch: -0.06, mouthY: -0.12,
    caudal: { type: 'fork', L: 0.24, S: 0.125, notch: 0.62 },
    dorsal: { d0: 0.36, d1: 0.74, h: 0.075, profile: [0, 1, 0.78, 0.66, 0.58, 0.1], sweep: 0.3 },
    anal: { d0: 0.75, d1: 0.87, h: 0.05, profile: [0, 1, 0.55, 0.05], sweep: 0.35 },
    pectoral: { s: 0.2, L: 0.14, W: 0.075, spread: 0.95, droop: 0.42, y: -0.3 },
    pelvic: { s: 0.5, L: 0.075, W: 0.04 },
    eye: { s: 0.085, r: 0.017, y: 0.1 },
    scales: { along: 34, around: 22, curve: 1.1 },
  },
  koiButterfly: {
    tailLen: 0.2, height: 0.22, hPos: 0.36, width: 0.19, wPos: 0.32, noseQ: 0.5, noseQw: 0.55, pinch: 0.28, pinchW: 0.3, arch: -0.06, mouthY: -0.12,
    caudal: { type: 'flowing', L: 0.46, S: 0.2, notch: 0.6 },
    dorsal: { d0: 0.34, d1: 0.76, h: 0.12, profile: [0, 1, 0.9, 0.85, 0.8, 0.3], sweep: 0.55 },
    anal: { d0: 0.74, d1: 0.88, h: 0.08, profile: [0, 1, 0.8, 0.2], sweep: 0.5 },
    pectoral: { s: 0.2, L: 0.26, W: 0.11, spread: 1.0, droop: 0.4, y: -0.3 },
    pelvic: { s: 0.5, L: 0.12, W: 0.05 },
    eye: { s: 0.085, r: 0.017, y: 0.1 },
    scales: { along: 34, around: 22, curve: 1.1 },
  },
  clownfish: {
    tailLen: 0.2, height: 0.36, hPos: 0.42, width: 0.17, wPos: 0.35, noseQ: 0.42, noseQw: 0.5, pinch: 0.4, pinchW: 0.4, arch: 0.05,
    caudal: { type: 'round', L: 0.2, S: 0.15 },
    dorsal: { d0: 0.24, d1: 0.8, h: 0.13, profile: [0, 0.8, 0.65, 0.45, 0.95, 0.9, 0.1], sweep: 0.25 },
    anal: { d0: 0.62, d1: 0.82, h: 0.11, profile: [0, 1, 0.8, 0.1], sweep: 0.25 },
    pectoral: { s: 0.25, L: 0.12, W: 0.075, spread: 0.6, droop: 0.3, y: -0.1 },
    pelvic: { s: 0.4, L: 0.08, W: 0.04 },
    eye: { s: 0.12, r: 0.03, y: 0.13 },
    scales: { along: 60, around: 40, curve: 0.9 },
  },
  blueTang: {
    tailLen: 0.18, height: 0.5, hPos: 0.45, width: 0.12, wPos: 0.35, noseQ: 0.5, noseQw: 0.6, pinch: 0.25, pinchW: 0.4, arch: 0.04, mouthY: 0.06,
    caudal: { type: 'lunate', L: 0.2, S: 0.2, notch: 0.8 },
    dorsal: { d0: 0.22, d1: 0.86, h: 0.08, profile: [0, 0.8, 0.9, 1, 1, 0.9, 0.2], sweep: 0.25 },
    anal: { d0: 0.5, d1: 0.86, h: 0.07, profile: [0, 0.9, 1, 1, 0.8, 0.2], sweep: 0.25 },
    pectoral: { s: 0.25, L: 0.13, W: 0.08, spread: 0.55, droop: 0.25, y: -0.05 },
    pelvic: { s: 0.36, L: 0.07, W: 0.035 },
    eye: { s: 0.14, r: 0.03, y: 0.2 },
    scales: { along: 80, around: 50, curve: 0.8 },
  },
  yellowTang: {
    tailLen: 0.17, height: 0.62, hPos: 0.5, width: 0.1, wPos: 0.38, noseQ: 0.9, noseQw: 0.8, pinch: 0.22, pinchW: 0.4, arch: 0.0, mouthY: 0.12,
    caudal: { type: 'truncate', L: 0.17, S: 0.19 },
    dorsal: { d0: 0.24, d1: 0.86, h: 0.2, profile: [0, 0.7, 1, 0.95, 0.8, 0.55, 0.15], sweep: 0.3 },
    anal: { d0: 0.5, d1: 0.86, h: 0.17, profile: [0, 0.9, 1, 0.85, 0.5, 0.1], sweep: 0.3 },
    pectoral: { s: 0.3, L: 0.12, W: 0.08, spread: 0.5, droop: 0.2, y: 0.0 },
    pelvic: { s: 0.4, L: 0.07, W: 0.035 },
    eye: { s: 0.2, r: 0.03, y: 0.22 },
    scales: { along: 80, around: 50, curve: 0.8 },
  },
  chromis: {
    tailLen: 0.26, height: 0.36, hPos: 0.4, width: 0.15, wPos: 0.35, noseQ: 0.5, noseQw: 0.55, pinch: 0.28, pinchW: 0.35, arch: 0.05,
    caudal: { type: 'fork', L: 0.27, S: 0.17, notch: 0.45 },
    dorsal: { d0: 0.3, d1: 0.76, h: 0.1, profile: [0, 1, 0.8, 0.6, 0.7, 0.1], sweep: 0.3 },
    anal: { d0: 0.62, d1: 0.82, h: 0.08, profile: [0, 1, 0.7, 0.1], sweep: 0.3 },
    pectoral: { s: 0.26, L: 0.11, W: 0.05, spread: 0.6, droop: 0.3, y: -0.1 },
    pelvic: { s: 0.42, L: 0.06, W: 0.03 },
    eye: { s: 0.13, r: 0.034, y: 0.12 },
    scales: { along: 40, around: 26, curve: 0.9 },
  },
  moorishIdol: {
    tailLen: 0.15, height: 0.66, hPos: 0.5, width: 0.09, wPos: 0.4, noseQ: 1.25, noseQw: 0.9, pinch: 0.2, pinchW: 0.4, arch: 0.08, mouthY: 0.1,
    caudal: { type: 'lunate', L: 0.15, S: 0.15, notch: 0.75 },
    dorsal: { d0: 0.32, d1: 0.72, h: 0.55, profile: [0, 0.5, 1.0, 0.55, 0.3, 0.12, 0.04], sweep: 1.5 },
    anal: { d0: 0.5, d1: 0.8, h: 0.24, profile: [0, 0.8, 1, 0.5, 0.1], sweep: 0.9 },
    pectoral: { s: 0.33, L: 0.11, W: 0.07, spread: 0.5, droop: 0.2, y: 0.0 },
    pelvic: { s: 0.42, L: 0.08, W: 0.03 },
    eye: { s: 0.24, r: 0.03, y: 0.2 },
    scales: { along: 80, around: 50, curve: 0.8 },
  },
  emperorAngel: {
    tailLen: 0.18, height: 0.56, hPos: 0.45, width: 0.11, wPos: 0.38, noseQ: 0.55, noseQw: 0.6, pinch: 0.32, pinchW: 0.4, arch: 0.04, mouthY: 0.02,
    caudal: { type: 'round', L: 0.18, S: 0.17 },
    dorsal: { d0: 0.24, d1: 0.92, h: 0.12, profile: [0, 0.6, 0.8, 0.9, 1, 1, 0.6], sweep: 0.5 },
    anal: { d0: 0.5, d1: 0.92, h: 0.1, profile: [0, 0.8, 0.9, 1, 0.9, 0.5], sweep: 0.5 },
    pectoral: { s: 0.27, L: 0.12, W: 0.08, spread: 0.5, droop: 0.2, y: -0.02 },
    pelvic: { s: 0.36, L: 0.09, W: 0.035 },
    eye: { s: 0.15, r: 0.03, y: 0.17 },
    scales: { along: 70, around: 46, curve: 0.8 },
  },
};
for (const k in SHAPES) SHAPES[k] = { ...BASE_SHAPE, ...SHAPES[k] };

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */
function profileAt(arr, b) {
  const n = arr.length - 1;
  const x = clamp(b, 0, 1) * n;
  const i = Math.min(n - 1, Math.floor(x));
  const t = x - i;
  const s = (1 - Math.cos(t * Math.PI)) * 0.5;
  return lerp(arr[i], arr[i + 1], s);
}

function makeBodyFns(S) {
  const torso = 1 - S.tailLen;
  const pH = Math.log(0.5) / Math.log(S.hPos);
  const pW = Math.log(0.5) / Math.log(S.wPos);
  const prof = (s, pp, q) => Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(clamp(s, 0, 1), pp))), q);
  const height = s => S.height * Math.max(prof(s, pH, S.noseQ), S.pinch * smoothstep(0.5, 1.0, s));
  const width = s => S.width * Math.max(prof(s, pW, S.noseQw), S.pinchW * smoothstep(0.55, 1.0, s) * 0.5);
  const yc = s => S.arch * height(s) * 0.5 + (S.mouthY || 0) * S.height * (1 - smoothstep(0, 0.3, s));
  const xAt = s => 0.5 - s * torso;
  const P = (s, phi, out) => {
    const h = height(s), w = width(s);
    out[0] = xAt(s);
    out[1] = yc(s) - Math.cos(phi) * h * 0.5;
    out[2] = Math.sin(phi) * w * 0.5;
    return out;
  };
  return { torso, height, width, yc, xAt, P };
}

/**
 * Build fish geometry. detail: 1 = hero (≈2.2k verts), 0.5 = school fish.
 * Attributes: position, normal, uv, aFin (region id, distance from fin base 0..1).
 */
export function buildFishGeometry(shape, { detail = 1 } = {}) {
  const S = typeof shape === 'string' ? SHAPES[shape] : { ...BASE_SHAPE, ...shape };
  const F = makeBodyFns(S);
  const pos = [], nor = [], uv = [], fin = [], idx = [];
  const finRanges = [];

  // ---- body ----
  const NX = Math.max(14, Math.round(52 * detail)), NR = Math.max(10, Math.round(30 * detail));
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0], d = [0, 0, 0];
  const e = 1e-3;
  for (let i = 0; i <= NX; i++) {
    const s = 0.5 - 0.5 * Math.cos((Math.PI * i) / NX);
    for (let j = 0; j <= NR; j++) {
      const phi = (j / NR) * TAU;
      F.P(s, phi, a);
      pos.push(a[0], a[1], a[2]);
      // analytic-ish normal: (dP/dphi) x (dP/ds)
      F.P(clamp(s + e, 0, 1), phi, b); F.P(clamp(s - e, 0, 1), phi, c);
      const ds = [b[0] - c[0], b[1] - c[1], b[2] - c[2]];
      F.P(Math.max(s, 0.004), phi + e, b); F.P(Math.max(s, 0.004), phi - e, d);
      const dp = [b[0] - d[0], b[1] - d[1], b[2] - d[2]];
      let nx = dp[1] * ds[2] - dp[2] * ds[1], ny = dp[2] * ds[0] - dp[0] * ds[2], nz = dp[0] * ds[1] - dp[1] * ds[0];
      let l = Math.hypot(nx, ny, nz);
      if (s < 0.002 || l < 1e-9) { nx = 1; ny = 0; nz = 0; l = 1; }
      nor.push(nx / l, ny / l, nz / l);
      uv.push(s * BODY_U, j / NR);
      fin.push(REGION.body, 0);
    }
  }
  const row = NR + 1;
  for (let i = 0; i < NX; i++) for (let j = 0; j < NR; j++) {
    const A = i * row + j, B = (i + 1) * row + j, C = B + 1, D = A + 1;
    idx.push(A, D, C, A, C, B);
  }
  // tail cap
  {
    const s = 1, base = pos.length / 3;
    const cx = F.xAt(s), cy = F.yc(s);
    pos.push(cx - 0.004, cy, 0); nor.push(-1, 0, 0); uv.push(BODY_U * 0.999, 0.5); fin.push(REGION.body, 0);
    for (let j = 0; j < NR; j++) {
      const A = NX * row + j, B = A + 1;
      idx.push(base, B, A);
    }
  }

  // ---- fins ----
  const addGrid = (nA, nB, posFn, region, rect) => {
    const base = pos.length / 3;
    const start = idx.length;
    for (let i = 0; i <= nA; i++) for (let j = 0; j <= nB; j++) {
      const fa = i / nA, fb = j / nB;
      const p = posFn(fa, fb);
      pos.push(p[0], p[1], p[2]);
      nor.push(0, 0, 1);
      uv.push(lerp(rect[0], rect[2], fa), lerp(rect[1], rect[3], fb));
      fin.push(region, fa);
    }
    for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) {
      const A = base + i * (nB + 1) + j, B = A + nB + 1, C = B + 1, D = A + 1;
      idx.push(A, B, C, A, C, D);
    }
    finRanges.push([base, pos.length / 3, start, idx.length]);
  };
  const fa = Math.max(3, Math.round(7 * detail)), fb = Math.max(4, Math.round(12 * detail));

  // caudal
  {
    const C = S.caudal;
    const x0 = F.xAt(1), y0 = F.yc(1), hb = F.height(1) * 0.5 * 1.05;
    const edge = t => {
      const at = Math.abs(t);
      switch (C.type) {
        case 'round': { const th = t * Math.PI * 0.5; return [-C.L * (0.1 + 0.9 * Math.cos(th)), C.S * Math.sin(th)]; }
        case 'truncate': return [-C.L * (0.9 + 0.1 * at), C.S * t];
        case 'lunate': return [-C.L * lerp(C.notch ?? 0.75, 1.05, at * at), C.S * t * 1.04];
        case 'flowing': return [-C.L * lerp(0.5, 1.0, Math.pow(at, 0.55)) * (0.88 + 0.12 * Math.cos(at * 3.0)), C.S * t * (1 + 0.25 * Math.sin(at * Math.PI))];
        case 'fork':
        default: return [-C.L * lerp(C.notch ?? 0.6, 1, Math.pow(at, 0.85)), C.S * t * (0.86 + 0.14 * Math.sin(at * Math.PI))];
      }
    };
    addGrid(fa + 1, fb + 2, (A, B) => {
      const t = B * 2 - 1;
      const ed = edge(t);
      const bx = x0 + 0.012, by = y0 + hb * t;
      const ex = x0 + ed[0], ey = y0 + ed[1];
      const ca = Math.pow(A, 0.92);
      return [lerp(bx, ex, ca), lerp(by, ey, ca), 0];
    }, REGION.caudal, RECT.caudal);
  }
  // dorsal & anal
  const finAlong = (cfg, sign, region, rect) => {
    if (!cfg || cfg.h <= 0) return;
    addGrid(fa, fb + 4, (A, B) => {
      const s = lerp(cfg.d0, cfg.d1, B);
      const bx = F.xAt(s), by = F.yc(s) + sign * F.height(s) * 0.5 * 0.96;
      const fh = cfg.h * profileAt(cfg.profile, B);
      const aa = A;
      return [bx - cfg.sweep * fh * Math.pow(aa, 1.25), by + sign * fh * aa, 0];
    }, region, rect);
  };
  finAlong(S.dorsal, 1, REGION.dorsal, RECT.dorsal);
  finAlong(S.anal, -1, REGION.anal, RECT.anal);

  // paired fins
  const v3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const paired = (cfg, region, rect, kind) => {
    if (!cfg) return;
    for (const side of [1, -1]) {
      const s = cfg.s;
      const h = F.height(s), w = F.width(s);
      let ax, ay, az, e1;
      if (kind === 'pectoral') {
        const yy = (cfg.y ?? -0.15) * h;
        const zz = (w * 0.5) * Math.sqrt(Math.max(0, 1 - Math.pow(yy / (h * 0.5), 2))) * 0.96;
        ax = F.xAt(s); ay = F.yc(s) + yy; az = side * zz;
        e1 = v3(-Math.cos(cfg.spread), -Math.sin(cfg.droop), side * Math.sin(cfg.spread)).normalize();
      } else {
        ax = F.xAt(s); ay = F.yc(s) - h * 0.44; az = side * w * 0.18;
        e1 = v3(-1, -0.45, side * 0.4).normalize();
      }
      const e2 = new THREE.Vector3().crossVectors(e1, kind === 'pectoral' ? v3(0, 1, 0) : v3(1, 0, 0)).normalize();
      addGrid(fa, Math.max(4, fb - 4), (A, B) => {
        const L = cfg.L, W = cfg.W;
        const wp = Math.pow(Math.sin(Math.PI * (0.12 + 0.88 * Math.min(A, 0.98))), 0.6) * (0.35 + 0.65 * smoothstep(0, 0.3, A));
        const along = A * L, across = (B - 0.5) * W * wp;
        return [ax + e1.x * along + e2.x * across, ay + e1.y * along + e2.y * across, az + e1.z * along + e2.z * across];
      }, region, rect);
    }
  };
  paired(S.pectoral, REGION.pectoral, RECT.pectoral, 'pectoral');
  paired(S.pelvic, REGION.pelvic, RECT.pelvic, 'pelvic');

  // ---- eyes ----
  {
    const E = S.eye;
    const s = E.s, h = F.height(s), w = F.width(s);
    const yy = E.y * h;
    const zs = (w * 0.5) * Math.sqrt(Math.max(0, 1 - Math.pow(yy / (h * 0.5), 2)));
    const R = E.r;
    const rect = RECT.eye;
    const NU = Math.max(8, Math.round(14 * detail)), NV = Math.max(4, Math.round(7 * detail));
    for (const side of [1, -1]) {
      const base = pos.length / 3;
      const cx = F.xAt(s), cy = F.yc(s) + yy, cz = side * (zs - R * 0.35);
      for (let i = 0; i <= NV; i++) {
        const th = (i / NV) * Math.PI * 0.5; // 0 at pole
        for (let j = 0; j <= NU; j++) {
          const ph = (j / NU) * TAU;
          const lx = Math.sin(th) * Math.cos(ph), ly = Math.sin(th) * Math.sin(ph), lz = Math.cos(th);
          pos.push(cx + lx * R, cy + ly * R, cz + side * lz * R * 0.75);
          const n = new THREE.Vector3(lx, ly, side * lz / 0.75).normalize();
          nor.push(n.x, n.y, n.z);
          uv.push(lerp(rect[0], rect[2], 0.5 + 0.5 * lx * side), lerp(rect[1], rect[3], 0.5 + 0.5 * ly));
          fin.push(REGION.eye, 0);
        }
      }
      for (let i = 0; i < NV; i++) for (let j = 0; j < NU; j++) {
        const A = base + i * (NU + 1) + j, B = A + NU + 1, C = B + 1, D = A + 1;
        if (side > 0) idx.push(A, B, C, A, C, D); else idx.push(A, C, B, A, D, C);
      }
    }
  }

  // fin normals from their own triangles
  const P3 = (i) => new THREE.Vector3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
  for (const [v0, v1, i0, i1] of finRanges) {
    const acc = new Float32Array((v1 - v0) * 3);
    for (let k = i0; k < i1; k += 3) {
      const A = idx[k], B = idx[k + 1], C = idx[k + 2];
      const pa = P3(A), pb = P3(B), pc = P3(C);
      const n = new THREE.Vector3().subVectors(pb, pa).cross(new THREE.Vector3().subVectors(pc, pa));
      for (const q of [A, B, C]) { acc[(q - v0) * 3] += n.x; acc[(q - v0) * 3 + 1] += n.y; acc[(q - v0) * 3 + 2] += n.z; }
    }
    for (let q = v0; q < v1; q++) {
      const o = (q - v0) * 3;
      const l = Math.hypot(acc[o], acc[o + 1], acc[o + 2]);
      // a vertex touched only by zero-area triangles would get a zero normal, which the GPU turns into
      // NaN pixels (bloom smears them into flashing blocks); fins lie roughly in the x-y plane
      if (l < 1e-9) { nor[q * 3] = 0; nor[q * 3 + 1] = 0; nor[q * 3 + 2] = 1; continue; }
      nor[q * 3] = acc[o] / l; nor[q * 3 + 1] = acc[o + 1] / l; nor[q * 3 + 2] = acc[o + 2] / l;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aFin', new THREE.Float32BufferAttribute(fin, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  g.userData.shape = S;
  return g;
}

/** Add the attributes the swim shader expects to an arbitrary mesh geometry (e.g. a loaded GLB). */
export function prepareSwimGeometry(geometry) {
  if (!geometry.getAttribute('aFin')) {
    geometry.setAttribute('aFin', new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 2), 2));
  }
  return geometry;
}

/* ------------------------------------------------------------------ */
/* Painting                                                            */
/* ------------------------------------------------------------------ */
const hex = h => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const vdist = (v, pv) => { let d = Math.abs(v - pv); return Math.min(d, 1 - d); };

/** Scale lattice helper: returns {edge 0..1 (1 at the free edge), rowId, colId} */
function scaleCell(s, v, sc) {
  const cs = s * sc.along;
  const ri = Math.floor(cs);
  const cv = v * sc.around + (ri & 1 ? 0.5 : 0);
  const ci = Math.floor(cv);
  const fv = cv - ci;
  const u2 = cs + sc.curve * (fv - 0.5) * (fv - 0.5);
  const f = u2 - Math.floor(u2);
  return { f, fv, ri: Math.floor(u2), ci };
}

/**
 * Species painters. body(s, v, ctx) -> [r,g,b] (sRGB 0..1); fin(region, a, b, ctx) -> [r,g,b,alpha].
 * ctx: { rng, noise, side (+1 right / -1 left), q (0 belly .. 1 back on either side), circ, data }
 */
const countershade = (c, q, amt = 0.18) => mix3(c, [1, 1, 1], (1 - smoothstep(0.0, 0.45, q)) * amt);

function koiSetup(variety, rng, shape) {
  const circ = Math.PI * (shape.height + shape.width) * 0.5;
  const patches = [];
  const addPatch = (s, v, len, rv, color, rough = 0.35) => patches.push({ s, v, rs: len, rv, color, rough });
  const red = mix3(hex('#d4231a'), hex('#e8541c'), rng.next() * 0.6);
  const black = hex('#151312');
  const white = mix3(hex('#f6f3ec'), hex('#fffaf2'), rng.next());
  const step = (n, from, to) => {
    let s = from + rng.range(0, 0.06);
    for (let i = 0; i < n && s < to; i++) {
      const len = rng.range(0.07, 0.15);
      addPatch(s + len * 0.5, 0.5 + rng.range(-0.06, 0.06), len * 0.62, rng.range(0.13, 0.27), red);
      s += len + rng.range(0.03, 0.09);
    }
  };
  let base = white, scaleDark = 0.05, fins = { color: white, alpha: 0.55 }, metal = 0, finsBlackBase = false;
  switch (variety) {
    case 'kohaku':
      if (rng.chance(0.7)) addPatch(0.08, 0.5, 0.06, 0.12, red); // head patch
      step(rng.int(2, 4), 0.18, 0.86);
      break;
    case 'tancho':
      addPatch(0.105, 0.5, 0.042, 0.042 / circ * 0.9, red, 0.05);
      break;
    case 'sanke':
      if (rng.chance(0.6)) addPatch(0.08, 0.5, 0.05, 0.11, red);
      step(rng.int(2, 3), 0.2, 0.86);
      for (let i = rng.int(3, 7); i > 0; i--) addPatch(rng.range(0.25, 0.9), 0.5 + rng.range(-0.18, 0.18), rng.range(0.018, 0.045), rng.range(0.03, 0.08), black, 0.5);
      break;
    case 'showa':
      base = white;
      for (let i = rng.int(4, 7); i > 0; i--) addPatch(rng.range(0.05, 0.9), rng.next(), rng.range(0.05, 0.13), rng.range(0.12, 0.3), black, 0.5);
      step(rng.int(2, 3), 0.1, 0.8);
      finsBlackBase = true;
      break;
    case 'ogon': base = hex('#e9b73e'); scaleDark = 0.14; fins = { color: hex('#f0c45a'), alpha: 0.7 }; metal = 0.6; break;
    case 'platinum': base = hex('#ece9e1'); scaleDark = 0.1; fins = { color: hex('#f2efe8'), alpha: 0.6 }; metal = 0.55; break;
    case 'yamabuki': base = hex('#f2c12a'); scaleDark = 0.12; fins = { color: hex('#f6d24e'), alpha: 0.65 }; metal = 0.5; break;
    case 'chagoi': base = hex('#8c6a46'); scaleDark = 0.35; fins = { color: hex('#9a7a55'), alpha: 0.65 }; break;
    case 'asagi': base = hex('#6f8aa6'); scaleDark = -0.45; fins = { color: hex('#f0eee8'), alpha: 0.55 }; break;
    case 'kigoi': base = hex('#f5d36a'); scaleDark = 0.06; fins = { color: hex('#f8e08a'), alpha: 0.55 }; break;
    case 'benigoi': base = hex('#c8361e'); scaleDark = 0.1; fins = { color: hex('#d9502c'), alpha: 0.6 }; break;
    default: step(3, 0.15, 0.85);
  }
  return { patches, base, red, black, white, scaleDark, fins, metal, finsBlackBase, variety, circ };
}

export const PAINTERS = {
  koi: {
    setup: (rng, shape, opts) => koiSetup(opts.variety || 'kohaku', rng, shape),
    body(s, v, C) {
      const K = C.data;
      let col = K.base;
      if (K.variety === 'asagi') {
        // blue-grey back, warm hi on belly, cheeks and fin bases
        const belly = 1 - smoothstep(0.1, 0.42, C.q);
        const cheek = (1 - smoothstep(0.12, 0.22, s)) * (1 - smoothstep(0.35, 0.75, C.q));
        col = mix3(K.base, hex('#e0632a'), Math.max(belly * 0.9, cheek));
      }
      for (const p of K.patches) {
        const ds = (s - p.s) / p.rs, dv = vdist(v, p.v) / p.rv;
        const d0 = ds * ds + dv * dv;
        if (d0 > 1 + p.rough * 1.2) continue; // far outside: skip the noise
        const n = C.noise.fbm2(s * 14 + p.s * 31, v * 9 + p.v * 17, 3) * p.rough;
        const d = d0 + n;
        const m = 1 - smoothstep(0.86, 1.0, d);
        if (m > 0) col = mix3(col, p.color, m);
      }
      // subtle belly brightening and head warmth
      col = countershade(col, C.q, K.metal ? 0.08 : 0.12);
      return col;
    },
    fin(region, a, b, C) {
      const K = C.data;
      let col = K.fins.color;
      if (region === REGION.eye) return null;
      if (K.finsBlackBase && region === REGION.pectoral) col = mix3(K.black, col, smoothstep(0.15, 0.55, a));
      const rays = 0.5 + 0.5 * Math.cos(b * TAU * (region === REGION.caudal ? 11 : 7));
      col = mix3(col, [col[0] * 0.82, col[1] * 0.82, col[2] * 0.82], rays * 0.25);
      const alpha = lerp(K.fins.alpha + 0.25, K.fins.alpha - 0.12, a) * (0.85 + rays * 0.15);
      return [...col, clamp(alpha, 0.2, 1)];
    },
    eye: { iris: '#c9a443', pupil: '#0b0b0b' },
    material: K => ({ metalness: K.metal, roughness: K.metal ? 0.3 : 0.36, clearcoat: 0.75, iridescence: K.metal ? 0.25 : 0.12, normalScale: 0.55 }),
    scaleDark: K => K.scaleDark,
  },
  clownfish: {
    setup: () => ({}),
    body(s, v, C) {
      const orange = mix3(hex('#ff5a0a'), hex('#ff8a1c'), smoothstep(0.1, 0.5, s));
      const band = (c, w, bulge) => {
        const cc = c + bulge * Math.cos((C.q - 0.5) * Math.PI) * 0.03;
        const d = Math.abs(s - cc);
        return { white: d < w ? 1 : 0, black: d >= w && d < w + 0.012 ? 1 : 0 };
      };
      let col = countershade(orange, C.q, 0.1);
      for (const [c, w, bulge] of [[0.205, 0.035, 0.6], [0.5, 0.04, -1.2], [0.885, 0.022, 0]]) {
        const b = band(c, w, bulge);
        if (b.white) col = hex('#fbfbf6');
        if (b.black) col = hex('#141414');
      }
      return col;
    },
    fin(region, a, b) {
      const orange = hex('#ff6e12');
      let col = orange, alpha = 0.95;
      if (a > 0.82) col = hex('#111111');
      if (a > 0.93) { col = hex('#ffffff'); alpha = 0.7; }
      if (region === REGION.pectoral || region === REGION.pelvic) { col = mix3(orange, hex('#ffb070'), a); alpha = lerp(0.95, 0.6, a); }
      return [...col, alpha];
    },
    eye: { iris: '#ff8a20', pupil: '#0b0b0b' },
    material: () => ({ roughness: 0.42, clearcoat: 0.5, iridescence: 0.15, normalScale: 0.25 }),
    scaleDark: () => 0.04,
  },
  blueTang: {
    setup: () => ({}),
    body(s, v, C) {
      const blue = mix3(hex('#1747c9'), hex('#2a6af0'), smoothstep(0.2, 0.8, C.q) * 0.5);
      let col = countershade(blue, C.q, 0.05);
      const q = C.q;
      const bandC = 0.74 + 0.06 * Math.sin(s * Math.PI);
      const band = s > 0.12 && s < 0.97 && Math.abs(q - bandC) < 0.09 + 0.05 * Math.sin(s * Math.PI);
      const ex = (s - 0.56) / 0.24, ey = (q - 0.46) / 0.2;
      const r = Math.sqrt(ex * ex + ey * ey);
      const loop = Math.abs(r - 1) < 0.22 && s > 0.3;
      const eyeBar = Math.abs(s - 0.14) < 0.03 && q > 0.45;
      if (band || loop || eyeBar) col = hex('#0a0e1e');
      if (s > 0.93) col = mix3(col, hex('#ffd21f'), smoothstep(0.93, 0.98, s));
      return col;
    },
    fin(region, a, b) {
      if (region === REGION.caudal) {
        const edge = b < 0.12 || b > 0.88;
        return edge ? [...hex('#0a0e1e'), 0.95] : [...hex('#ffd21f'), 0.95];
      }
      if (region === REGION.pectoral) return [...mix3(hex('#1747c9'), hex('#ffd21f'), smoothstep(0.55, 0.85, a)), 0.85];
      const col = mix3(hex('#1747c9'), hex('#0a0e1e'), smoothstep(0.55, 0.85, a));
      return [...mix3(col, hex('#4fa8ff'), a > 0.92 ? 1 : 0), 0.95];
    },
    eye: { iris: '#1a1a2a', pupil: '#050505' },
    material: () => ({ roughness: 0.36, clearcoat: 0.55, iridescence: 0.35, normalScale: 0.2 }),
    scaleDark: () => 0.03,
  },
  yellowTang: {
    setup: () => ({}),
    body(s, v, C) {
      let col = countershade(hex('#ffd200'), C.q, 0.12);
      if (Math.hypot((s - 0.95) * 3, C.q - 0.5) < 0.06) col = hex('#ffffff');
      return col;
    },
    fin(region, a) { return [...mix3(hex('#ffd200'), hex('#ffe766'), a), lerp(0.95, 0.75, a)]; },
    eye: { iris: '#202020', pupil: '#050505' },
    material: () => ({ roughness: 0.4, clearcoat: 0.45, iridescence: 0.1, normalScale: 0.2 }),
    scaleDark: () => 0.03,
  },
  chromis: {
    setup: () => ({}),
    body(s, v, C) { return countershade(mix3(hex('#6fd3d9'), hex('#9cf0d6'), C.q * 0.3 + smoothstep(0.4, 1, s) * 0.3), C.q, 0.25); },
    fin(region, a) { return [...hex('#9eeedd'), lerp(0.7, 0.35, a)]; },
    eye: { iris: '#6a9a9a', pupil: '#050505' },
    material: () => ({ roughness: 0.3, clearcoat: 0.6, iridescence: 0.8, normalScale: 0.3 }),
    scaleDark: () => 0.05,
  },
  moorishIdol: {
    setup: () => ({}),
    body(s, v, C) {
      let col = mix3(hex('#f7f4e9'), hex('#ffe680'), smoothstep(0.45, 0.62, s) * (1 - smoothstep(0.78, 0.8, s)));
      if (s > 0.17 && s < 0.36) col = hex('#141414');
      if (s > 0.6 && s < 0.78) col = hex('#141414');
      if (s < 0.08 && C.q > 0.55) col = hex('#ff8a2a');
      return countershade(col, C.q, 0.05);
    },
    fin(region, a, b) {
      if (region === REGION.dorsal) return [...(b < 0.35 ? hex('#141414') : hex('#f7f4e9')), lerp(0.95, 0.7, a)];
      if (region === REGION.anal) return [...(b < 0.55 ? hex('#141414') : hex('#ffe680')), 0.9];
      if (region === REGION.caudal) return [...(a < 0.8 ? hex('#141414') : hex('#f7f4e9')), 0.92];
      return [...hex('#f2efe4'), lerp(0.8, 0.45, a)];
    },
    eye: { iris: '#202020', pupil: '#050505' },
    material: () => ({ roughness: 0.4, clearcoat: 0.45, iridescence: 0.1, normalScale: 0.2 }),
    scaleDark: () => 0.02,
  },
  emperorAngel: {
    setup: () => ({}),
    body(s, v, C) {
      const blue = hex('#1a3b9a');
      const st = (C.q * 13 + s * 3.0 + Math.sin(s * 5) * 0.4) % 1;
      let col = st < 0.38 ? hex('#ffd03a') : blue;
      if (s < 0.2) col = mix3(hex('#9fb4d8'), hex('#2a3f80'), C.q);
      if (Math.abs(s - 0.15) < 0.028) col = hex('#0d0f1a');
      if (s > 0.2 && s < 0.27 && C.q > 0.2) col = hex('#0d1238');
      return countershade(col, C.q, 0.06);
    },
    fin(region, a, b) {
      if (region === REGION.caudal) return [...hex('#ffcc2a'), 0.95];
      if (region === REGION.dorsal || region === REGION.anal) return [...(Math.floor(b * 14) % 2 ? hex('#ffd03a') : hex('#1a3b9a')), 0.95];
      return [...hex('#2a3f80'), lerp(0.9, 0.6, a)];
    },
    eye: { iris: '#3a3a5a', pupil: '#050505' },
    material: () => ({ roughness: 0.38, clearcoat: 0.5, iridescence: 0.3, normalScale: 0.2 }),
    scaleDark: () => 0.04,
  },
};
PAINTERS.koiButterfly = PAINTERS.koi;

const normalCache = new Map();
const RECTS = Object.entries(RECT);

/**
 * Paint the texture atlas for a species. Returns { map, normalMap, material params, data }.
 * opts: { seed, size: [w, h], variety (koi) }
 */
export function paintFish(species, opts = {}) {
  const painter = PAINTERS[species];
  const shapeName = opts.shape || species;
  const shape = SHAPES[shapeName];
  const [W, H] = opts.size || [1024, 512];
  const rng = makeRng(opts.seed ?? 1);
  const noise = createNoise((opts.seed ?? 1) + 7);
  const data = painter.setup(rng, shape, opts);
  const canvas = makeCanvas(W, H);
  const g = canvas.getContext('2d');
  const img = g.createImageData(W, H);
  const px = img.data;
  const sc = shape.scales;
  const scaleDark = painter.scaleDark ? painter.scaleDark(data) : 0.05;
  const C = { rng, noise, data, side: 1, q: 0, circ: Math.PI * (shape.height + shape.width) * 0.5 };
  const BW = Math.floor(BODY_U * W);

  for (let y = 0; y < H; y++) {
    const v = 1 - (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const u = (x + 0.5) / W;
      if (x < BW) {
        const s = u / BODY_U;
        C.side = v < 0.5 ? 1 : -1;
        C.q = v < 0.5 ? v * 2 : (1 - v) * 2;
        let col = painter.body(s, v, C);
        if (scaleDark) {
          const cell = scaleCell(s, v, sc);
          const rim = smoothstep(0.72, 0.98, cell.f);
          col = scaleDark > 0 ? mix3(col, [col[0] * 0.55, col[1] * 0.55, col[2] * 0.55], rim * scaleDark)
            : mix3(col, [Math.min(1, col[0] * 1.5 + 0.2), Math.min(1, col[1] * 1.5 + 0.2), Math.min(1, col[2] * 1.5 + 0.2)], rim * -scaleDark);
        }
        px[o] = col[0] * 255; px[o + 1] = col[1] * 255; px[o + 2] = col[2] * 255; px[o + 3] = 255;
      } else {
        // which fin rect?
        let region = -1, a = 0, b = 0;
        for (const [name, r] of RECTS) {
          if (u >= r[0] && u <= r[2] && v >= r[1] && v <= r[3]) {
            region = REGION[name]; a = (u - r[0]) / (r[2] - r[0]); b = (v - r[1]) / (r[3] - r[1]);
            break;
          }
        }
        if (region === REGION.eye) {
          const d = Math.hypot(a - 0.5, b - 0.5) * 2;
          const E = painter.eye || { iris: '#b08a3a', pupil: '#050505' };
          let col = d < 0.48 ? hex(E.pupil) : d < 0.86 ? mix3(hex(E.iris), hex(E.pupil), smoothstep(0.6, 0.86, d) * 0.6) : hex('#2a2a2a');
          px[o] = col[0] * 255; px[o + 1] = col[1] * 255; px[o + 2] = col[2] * 255; px[o + 3] = 255;
        } else if (region >= 0) {
          const f = painter.fin(region, a, b, C) || [1, 1, 1, 0.5];
          // soften the outer margin
          const edgeFade = 1 - smoothstep(0.9, 1.0, a) * 0.5;
          px[o] = f[0] * 255; px[o + 1] = f[1] * 255; px[o + 2] = f[2] * 255; px[o + 3] = clamp(f[3] * edgeFade, 0, 1) * 255;
        } else {
          px[o] = px[o + 1] = px[o + 2] = 128; px[o + 3] = 0;
        }
      }
    }
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  // normal map, cached per shape + size
  const key = shapeName + W + 'x' + H;
  let normalMap = normalCache.get(key);
  if (!normalMap) {
    normalMap = buildScaleNormalMap(shape, W, H);
    normalCache.set(key, normalMap);
  }
  const matParams = painter.material ? painter.material(data) : {};
  return { map, normalMap, material: matParams, data };
}

function buildScaleNormalMap(shape, W, H) {
  const sc = shape.scales;
  const BW = Math.floor(BODY_U * W);
  const hgt = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const v = 1 - (y + 0.5) / H;
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      let h = 0.5;
      if (x < BW) {
        const s = u / BODY_U;
        const cell = scaleCell(s, v, sc);
        h = Math.pow(cell.f, 1.6) * (0.75 + 0.25 * Math.sin(cell.fv * Math.PI)) * smoothstep(0.02, 0.1, s);
      } else {
        for (const [name, r] of RECTS) {
          if (u >= r[0] && u <= r[2] && v >= r[1] && v <= r[3]) {
            const a = (u - r[0]) / (r[2] - r[0]), b = (v - r[1]) / (r[3] - r[1]);
            if (name === 'eye') { const d = Math.hypot(a - 0.5, b - 0.5) * 2; h = Math.sqrt(Math.max(0, 1 - d * d)) * 0.4; }
            else h = 0.5 + 0.5 * Math.cos(b * TAU * (name === 'caudal' ? 11 : 7)) * smoothstep(0.05, 0.3, a) * 0.6;
            break;
          }
        }
      }
      hgt[y * W + x] = h;
    }
  }
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const strength = 3.2;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const xl = Math.max(0, x - 1), xr = Math.min(W - 1, x + 1), yu = Math.max(0, y - 1), yd = Math.min(H - 1, y + 1);
    const dx = (hgt[y * W + xr] - hgt[y * W + xl]) * strength;
    const dy = (hgt[yd * W + x] - hgt[yu * W + x]) * strength;
    const l = Math.hypot(dx, dy, 1);
    const o = (y * W + x) * 4;
    img.data[o] = (-dx / l * 0.5 + 0.5) * 255;
    img.data[o + 1] = (dy / l * 0.5 + 0.5) * 255;
    img.data[o + 2] = (1 / l * 0.5 + 0.5) * 255;
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ------------------------------------------------------------------ */
/* Swim material                                                       */
/* ------------------------------------------------------------------ */
const SWIM_HEADER = /* glsl */`
  uniform float uFishTime;
  uniform float uWaveK;
  uniform vec4 uSwim;
  attribute vec2 aFin;
  #ifdef USE_INSTANCING
    attribute vec4 aSwim;
    #define FISH_SWIM aSwim
  #else
    #define FISH_SWIM uSwim
  #endif
  float fishT(vec3 p){ return clamp(0.5 - p.x, 0.0, 1.4); }
  vec3 fishDisplace(vec3 p, vec4 sw){
    float T = fishT(p);
    float bw = smoothstep(0.1, 1.0, T);
    float env = bw * (0.3 + 0.7 * bw);
    p.z += sin(sw.x - T * uWaveK) * sw.y * env + sw.z * T * T;
    if (aFin.x > 3.5 && aFin.x < 5.5) {
      float side = sign(p.z + 1e-4);
      p.z += side * sin(uFishTime * 5.5 + sw.w) * 0.035 * aFin.y;
      p.y += sin(uFishTime * 5.5 + sw.w + 1.3) * 0.012 * aFin.y;
    } else if (aFin.x > 0.5 && aFin.x < 3.5) {
      p.z += sin(uFishTime * 3.7 + sw.w + aFin.y * 2.5 + p.x * 6.0) * 0.01 * aFin.y;
    }
    return p;
  }
  float fishSlope(vec3 p, vec4 sw){
    float T = fishT(p);
    float bw = smoothstep(0.1, 1.0, T);
    float env = bw * (0.3 + 0.7 * bw);
    return -cos(sw.x - T * uWaveK) * uWaveK * sw.y * env + 2.0 * sw.z * T;
  }
`;

/**
 * Patch any material so the mesh swims like a fish. The mesh must use the fish local frame
 * (head toward +X, length ~1 centred at the origin). Instanced meshes read `aSwim` per instance;
 * plain meshes use the returned `swim` uniform (Vector4: phase, amplitude, turn, flutter phase).
 */
export function applySwim(material, { waveK = 7.0, key = 'swim' } = {}) {
  const uniforms = { uFishTime: { value: 0 }, uWaveK: { value: waveK }, uSwim: { value: new THREE.Vector4(0, 0.04, 0, 0) } };
  patchMaterial(material, {
    key: key + waveK,
    uniforms,
    vertexHeader: SWIM_HEADER,
    vertex: {
      '#include <beginnormal_vertex>': /* glsl */`$&
        { float sl = fishSlope(position, FISH_SWIM); objectNormal.x += sl * objectNormal.z;
          float nl = length(objectNormal); objectNormal = nl > 1e-6 ? objectNormal / nl : vec3(0.0, 0.0, 1.0); }
      `,
      '#include <begin_vertex>': '$&\ntransformed = fishDisplace(transformed, FISH_SWIM);',
    },
  });
  material.userData.swimUniforms = uniforms;
  return uniforms;
}

/** Depth material for shadows that follows the swim deformation. */
export function createSwimDepthMaterial(swimUniforms) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  patchMaterial(m, {
    key: 'swimdepth',
    uniforms: swimUniforms,
    vertexHeader: SWIM_HEADER,
    vertex: { '#include <begin_vertex>': '$&\ntransformed = fishDisplace(transformed, FISH_SWIM);' },
  });
  return m;
}

/** MeshPhysicalMaterial for a painted fish atlas, already swim-patched. */
export function createFishMaterial(painted, overrides = {}) {
  const p = { ...painted.material, ...overrides };
  const mat = new THREE.MeshPhysicalMaterial({
    map: painted.map,
    normalMap: painted.normalMap,
    normalScale: new THREE.Vector2(p.normalScale ?? 0.4, p.normalScale ?? 0.4),
    metalness: p.metalness ?? 0,
    roughness: p.roughness ?? 0.38,
    clearcoat: p.clearcoat ?? 0.5,
    clearcoatRoughness: p.clearcoatRoughness ?? 0.22,
    iridescence: p.iridescence ?? 0.15,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [180, 460],
    sheen: p.sheen ?? 0,
    side: THREE.DoubleSide,
    // translucent fins: alpha-to-coverage with the MSAA render target (falls back to a cutout)
    alphaToCoverage: true,
    alphaTest: 0.04,
    envMapIntensity: p.envMapIntensity ?? 1,
  });
  applySwim(mat, { waveK: p.waveK ?? 7.0 });
  // three r160 forces alpha to 1 on opaque materials, which defeats alpha-to-coverage; keep the fin alpha.
  // The chunk itself stays in place so later patches that hook it (underwater tint, fog, rim) still apply.
  patchMaterial(mat, {
    key: 'a2c',
    fragment: {
      '#include <opaque_fragment>': `float fishAlpha = diffuseColor.a;
        $&
        gl_FragColor.a = fishAlpha;
        #ifdef USE_TRANSMISSION
          gl_FragColor.a *= material.transmissionAlpha;
        #endif`,
    },
  });
  return mat;
}

/* ------------------------------------------------------------------ */
/* Instancing                                                          */
/* ------------------------------------------------------------------ */
const _mat4 = new THREE.Matrix4(), _scl = new THREE.Vector3();

export class FishInstances {
  constructor(geometry, material, maxCount, { castShadow = false, receiveShadow = false } = {}) {
    this.geometry = geometry.clone();
    this.swim = new THREE.InstancedBufferAttribute(new Float32Array(maxCount * 4), 4);
    this.swim.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aSwim', this.swim);
    this.mesh = new THREE.InstancedMesh(this.geometry, material, maxCount);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    this.mesh.receiveShadow = receiveShadow;
    if (castShadow && material.userData.swimUniforms) this.mesh.customDepthMaterial = createSwimDepthMaterial(material.userData.swimUniforms);
    this.max = maxCount;
    this.count = 0;
    this.mesh.count = 0;
  }
  begin() { this.count = 0; }
  /** Add one fish from a Swimmer (or anything with pos, quat, size, phase, amp, turn, flutter). */
  push(f) {
    const i = this.count;
    if (i >= this.max) return -1;
    this.count++;
    _mat4.compose(f.pos, f.quat, _scl.setScalar(f.size));
    this.mesh.setMatrixAt(i, _mat4);
    this.swim.setXYZW(i, f.phase, f.amp, f.turn, f.flutter);
    return i;
  }
  setColor(i, color) { this.mesh.setColorAt(i, color); }
  end(time) {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.swim.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    const u = this.mesh.material.userData.swimUniforms;
    // the fin-flutter rates (5.5 and 3.7 rad/s) complete whole cycles every 20π s, so the clock wraps there
    // seamlessly; the GPU gets it as float32, and an unwrapped clock would step by ~8 ms after a day
    if (u && time !== undefined) u.uFishTime.value = time % (20 * Math.PI);
  }
}

/* ------------------------------------------------------------------ */
/* Steering                                                            */
/* ------------------------------------------------------------------ */
const _tmp = new THREE.Vector3();

/**
 * A swimming body with smooth heading, tail-beat synced to speed, body curvature on turns and
 * banking. Drive it by calling steer(desiredVelocity) then integrate(dt).
 */
export class Swimmer {
  constructor({ pos, size = 1, speed = 0.4, rng = makeRng(1), maxPitch = 0.5, agility = 2.2, beat = 1 } = {}) {
    this.pos = pos ? pos.clone() : new THREE.Vector3();
    const a = rng.range(0, TAU);
    this.vel = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(speed);
    this.fwd = this.vel.clone().normalize();
    this.quat = new THREE.Quaternion();
    this.size = size;
    this.phase = rng.range(0, TAU);
    this.flutter = rng.range(0, TAU);
    this.amp = 0.04;
    this.turn = 0;
    this.roll = 0;
    this.yawRate = 0;
    this.maxPitch = maxPitch;
    this.agility = agility;
    this.beat = beat;
    this.boost = 0; // extra tail-beat when accelerating
  }
  /** Blend velocity toward `desired` (world units / s). */
  steer(desired, dt, agility = this.agility) {
    const k = 1 - Math.exp(-agility * dt);
    const before = this.vel.length();
    this.vel.lerp(desired, k);
    const after = this.vel.length();
    this.boost = lerp(this.boost, clamp((after - before) / Math.max(dt, 1e-3) * 2.0, 0, 3), 1 - Math.exp(-6 * dt));
    return this;
  }
  integrate(dt) {
    this.pos.addScaledVector(this.vel, dt);
    const speed = this.vel.length();
    if (speed > 1e-4) {
      // Turn the body toward the direction of travel. Yaw turns in the horizontal plane (following at 8/s, so
      // a fish turning at 1 rad/s trails its path by ~7°; never slower than ~1 rad/s, never faster than ~3.5) and pitch follows separately, so a
      // reversing fish swings round level instead of over the top (a straight vector lerp stalled, and a
      // great-circle turn went through vertical). A fish that has all but stopped holds its heading
      // instead of swivelling after centimetre drifts.
      const body = Math.max(this.size, 0.05), hSpeed = Math.hypot(this.vel.x, this.vel.z);
      const hold = smoothstep(0.04, 0.15, speed / body);
      const prevYaw = Math.atan2(this.fwd.z, this.fwd.x);
      let yaw = prevYaw, pitch = Math.asin(clamp(this.fwd.y, -1, 1));
      if (hSpeed > 1e-5) {
        // yaw follows the horizontal part of the motion only when there is enough of it to mean something
        // (a fish rising or sinking steeply must not chase the noise in its tiny horizontal drift)
        const d = angleDelta(prevYaw, Math.atan2(this.vel.z, this.vel.x)), a = Math.abs(d);
        yaw += Math.sign(d) * Math.min(a, Math.max(a * (1 - Math.exp(-8 * dt)), 1.0 * dt), 3.5 * dt) * smoothstep(0.04, 0.15, hSpeed / body);
      }
      const tp = Math.asin(clamp(this.vel.y / speed, -this.maxPitch, this.maxPitch));
      pitch += (tp - pitch) * (1 - Math.exp(-4 * dt)) * hold;
      const cp = Math.cos(pitch);
      this.fwd.set(cp * Math.cos(yaw), Math.sin(pitch), cp * Math.sin(yaw));
      const rate = -angleDelta(prevYaw, yaw) / Math.max(dt, 1e-4); // + = turning left seen from above
      this.yawRate = lerp(this.yawRate, rate, 1 - Math.exp(-8 * dt));
    }
    const rel = speed / Math.max(this.size, 0.05);
    // both are only used as sin() phases, so wrap them: the GPU gets them as float32, and a fish that
    // swims all day would otherwise end up with a jittery tail
    this.phase = (this.phase + dt * this.beat * (3.0 + rel * 5.5 + this.boost * 4 + Math.abs(this.yawRate) * 1.5)) % TAU;
    this.flutter = (this.flutter + dt * 0.5) % TAU;
    this.amp = lerp(this.amp, clamp(0.035 + rel * 0.035 + this.boost * 0.03, 0.03, 0.12), 1 - Math.exp(-3 * dt));
    this.turn = lerp(this.turn, clamp(-this.yawRate * 0.06, -0.22, 0.22), 1 - Math.exp(-6 * dt));
    this.roll = lerp(this.roll, clamp(-this.yawRate * 0.12, -0.45, 0.45), 1 - Math.exp(-4 * dt));
    quatFromForward(this.quat, this.fwd, this.roll);
    return this;
  }
  /** Desired velocity toward a point, slowing within `arrive` distance. */
  seek(target, maxSpeed, arrive = 0.5, out = new THREE.Vector3()) {
    out.subVectors(target, this.pos);
    const d = out.length();
    if (d < 1e-5) return out.set(0, 0, 0);
    return out.multiplyScalar((maxSpeed * clamp(d / arrive, 0, 1)) / d);
  }
}

/** Classic boids forces for a school (neighbors: array of Swimmers). Writes into `out`. */
const _al = new THREE.Vector3();
export function schoolForce(self, neighbors, { radius = 1.2, sepRadius = 0.45, sep = 1.6, ali = 0.6, coh = 0.4 } = {}, out = new THREE.Vector3()) {
  out.set(0, 0, 0);
  const c = _tmp.set(0, 0, 0);
  const al = _al.set(0, 0, 0);
  let n = 0;
  for (const o of neighbors) {
    if (o === self) continue;
    const dx = o.pos.x - self.pos.x, dy = o.pos.y - self.pos.y, dz = o.pos.z - self.pos.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > radius * radius) continue;
    n++;
    c.x += o.pos.x; c.y += o.pos.y; c.z += o.pos.z;
    al.add(o.vel);
    if (d2 < sepRadius * sepRadius && d2 > 1e-8) {
      const d = Math.sqrt(d2), f = (sepRadius - d) / sepRadius / d;
      out.x -= dx * f * sep; out.y -= dy * f * sep; out.z -= dz * f * sep;
    }
  }
  if (n) {
    c.divideScalar(n).sub(self.pos).multiplyScalar(coh);
    al.divideScalar(n).sub(self.vel).multiplyScalar(ali);
    out.add(c).add(al);
  }
  return out;
}
