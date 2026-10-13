// 芒原 · procedural quadrupeds for the gentle giants (the nine-tailed spirit fox, the sika deer herd).
//
// Bodies are lofted tubes (elliptic sections along the spine, legs, paws, ears, tails, antlers) skinned to a flat
// list of "segment" bones. Every frame each bone is set from two joint positions and a lateral axis, directly in
// world space, so a pose is plain vector maths: no bone hierarchy to unwind, no animation clips.
//
// Gait: a stepping clock advances by ground speed ÷ stride length (plus the arc a turn sweeps under the paws), and
// each leg lifts at its own offset in the cycle (a lateral-sequence walk; a trot when running). A planted paw stays
// exactly where it touched down for its whole stance; a lifted paw swings along an eased arc to the footfall
// predicted from the body's motion; two-bone IK makes the leg reach it. Cadence follows speed, so paws never slide,
// and everything is integrated with dt, so the motion is the same at 30 and 60 fps.
import * as THREE from 'three';
import { TAU, clamp, lerp } from '../../lib/util.js';

export const UP = new THREE.Vector3(0, 1, 0);
const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const _e = new THREE.Vector3(), _p = new THREE.Vector3();

/* ------------------------------------------------------------------ */
/* Skinned tube geometry                                               */
/* ------------------------------------------------------------------ */
/**
 * Accumulates lofted tubes into one skinned BufferGeometry. A ring is { c: centre, t: tangent, l: lateral (unit,
 * ⟂ t), rx, ryT, ryB (half-width, upper and lower half-height), keel (narrows the lower half: a jaw, a brisket),
 * u, tip, w: [[bone, weight], …] }. The section's "up" is t × l; v runs round it from the top (0) over the l side.
 * aAux = (part id, tip 0..1, tube radius for the on-screen minimum width, animal index).
 */
export class SkinGeo {
  constructor() { this.P = []; this.N = []; this.UV = []; this.SI = []; this.SW = []; this.AX = []; this.I = []; }
  tube(rings, seg, { v0 = 0, v1 = 1, part = 0, idx = 0 } = {}) {
    const base = this.P.length / 3, row = seg + 1, n = rings.length;
    const pos = new Float32Array(n * row * 3);
    const nn = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const r = rings[i];
      nn.crossVectors(r.t, r.l).normalize();
      const ws = r.w.slice().sort((a, b) => b[1] - a[1]).slice(0, 4);
      const tot = ws.reduce((s, x) => s + x[1], 0) || 1;
      for (let j = 0; j <= seg; j++) {
        const th = TAU * (j % seg) / seg, ct = Math.cos(th), st = Math.sin(th);
        const ry = ct >= 0 ? r.ryT : r.ryB;
        const kf = 1 - (r.keel || 0) * Math.pow(Math.max(0, -ct), 2);
        p.copy(r.c).addScaledVector(nn, ry * ct).addScaledVector(r.l, r.rx * st * kf);
        const o = (i * row + j) * 3;
        pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
        this.P.push(p.x, p.y, p.z);
        this.UV.push(r.u, v0 + (v1 - v0) * j / seg);
        for (let k = 0; k < 4; k++) { this.SI.push(k < ws.length ? ws[k][0] : 0); this.SW.push(k < ws.length ? ws[k][1] / tot : 0); }
        this.AX.push(part, r.tip || 0, Math.max(0.002, Math.min(r.rx, r.ryT, r.ryB)), idx);
      }
    }
    // normals by central differences along the tube and round the section (wrapping at the uv seam, so the seam
    // is invisible); a collapsed tip points along the tube
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), D = new THREE.Vector3(), N = new THREE.Vector3();
    const at = (i, j, out) => { const o = (i * row + j) * 3; return out.set(pos[o], pos[o + 1], pos[o + 2]); };
    for (let i = 0; i < n; i++) for (let j = 0; j <= seg; j++) {
      const jj = j % seg;
      at(Math.min(i + 1, n - 1), jj, A); at(Math.max(i - 1, 0), jj, B); A.sub(B);
      at(i, (jj + 1) % seg, C); at(i, (jj - 1 + seg) % seg, D); C.sub(D);
      N.crossVectors(A, C);
      if (N.lengthSq() < 1e-14) N.copy(rings[i].t).multiplyScalar(i === 0 ? -1 : 1);
      N.normalize();
      this.N.push(N.x, N.y, N.z);
    }
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
      const a = base + i * row + j, b = a + row;
      this.I.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.UV, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.SI, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.SW, 4));
    g.setAttribute('aAux', new THREE.Float32BufferAttribute(this.AX, 4));
    g.setIndex(this.P.length / 3 > 65000 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    return g;
  }
}

/* ------------------------------------------------------------------ */
/* Segment bones                                                       */
/* ------------------------------------------------------------------ */
/** Flat list of bones, each defined by a start joint, an end joint and a lateral axis (its local x). */
export class SegRig {
  constructor() { this.bones = []; this.bindA = []; this.bindB = []; this.bindL = []; }
  add(name, a, b, l) {
    const bone = new THREE.Bone();
    bone.name = name;
    this.bones.push(bone); this.bindA.push(a.clone()); this.bindB.push(b.clone()); this.bindL.push(l.clone());
    return this.bones.length - 1;
  }
  set(k, a, b, l) {
    _y.subVectors(b, a);
    const len = _y.length();
    if (len > 1e-7) _y.divideScalar(len); else _y.set(0, 1, 0);
    _x.copy(l).addScaledVector(_y, -l.dot(_y));
    let xl = _x.length();
    if (xl < 1e-5) { _x.set(1, 0, 0).addScaledVector(_y, -_y.x); xl = _x.length(); }
    if (xl < 1e-5) { _x.set(0, 0, 1).addScaledVector(_y, -_y.z); xl = _x.length(); }
    _x.divideScalar(xl);
    _z.crossVectors(_x, _y);
    _m.makeBasis(_x, _y, _z);
    const bone = this.bones[k];
    bone.quaternion.setFromRotationMatrix(_m);
    bone.position.copy(a);
  }
  /** Bind pose → skeleton (bone inverses from the bind joints). */
  skeleton() {
    const inv = [];
    for (let k = 0; k < this.bones.length; k++) {
      this.set(k, this.bindA[k], this.bindB[k], this.bindL[k]);
      const b = this.bones[k];
      b.updateMatrix();
      inv.push(b.matrix.clone().invert());
    }
    return new THREE.Skeleton(this.bones, inv);
  }
}

/** Knee / elbow of a two-bone chain from `a` (lengths L1, L2) reaching for `c`, bending toward `pole`. */
export function ik2(a, c, L1, L2, pole, out) {
  _e.subVectors(c, a);
  let d = _e.length();
  if (d < 1e-6) { _e.set(0, -1, 0); d = 1e-6; } else _e.divideScalar(d);
  const dc = clamp(d, Math.abs(L1 - L2) + 1e-4, (L1 + L2) * 0.9995);
  const cosA = clamp((L1 * L1 + dc * dc - L2 * L2) / (2 * L1 * dc), -1, 1);
  const sinA = Math.sqrt(1 - cosA * cosA);
  _p.copy(pole).addScaledVector(_e, -pole.dot(_e));
  const pl = _p.length();
  if (pl < 1e-6) _p.set(0, 0, 1); else _p.divideScalar(pl);
  return out.copy(a).addScaledVector(_e, L1 * cosA).addScaledVector(_p, L1 * sinA);
}

/** Direction in a body frame (l, u, f): pitched up by `pitch` from forward, turned toward +l by `yaw`. */
export function frameDir(l, u, f, pitch, yaw, out) {
  const cp = Math.cos(pitch);
  return out.set(0, 0, 0).addScaledVector(l, Math.sin(yaw) * cp).addScaledVector(u, Math.sin(pitch)).addScaledVector(f, Math.cos(yaw) * cp);
}
/** A point of a body frame: origin + l·x + u·y + f·z. */
export function framePt(o, l, u, f, x, y, z, out) {
  return out.copy(o).addScaledVector(l, x).addScaledVector(u, y).addScaledVector(f, z);
}

/* ------------------------------------------------------------------ */
/* Animal: body plan, bind mesh and per-frame pose                     */
/* ------------------------------------------------------------------ */
const LEGS = [['LH', false, 1], ['LF', true, 1], ['RH', false, -1], ['RF', true, -1]];
const BF_L = new THREE.Vector3(1, 0, 0), BF_U = new THREE.Vector3(0, 1, 0), BF_F = new THREE.Vector3(0, 0, 1);

/**
 * One animal built from a body plan (`spec`, metres, bind pose facing +z, feet on y = 0) into a shared SkinGeo /
 * SegRig. Several animals can share one mesh (the deer herd is a single draw).
 */
export class Animal {
  constructor(spec, geo, rig, { idx = 0, heightAt, seed = 0 }) {
    this.spec = spec; this.rig = rig; this.idx = idx; this.heightAt = heightAt;
    const S = spec.spine;
    const v = a => new THREE.Vector3(0, a[0], a[1]);
    this.b = { P: v(S.P), M: v(S.M), C: v(S.C), N1: v(S.N1), N2: v(S.N2), H: v(S.H), S: v(S.S) };
    const B = this.b;
    // rest offsets and lengths
    this.T = B.C.z - B.P.z;
    this.chestH = B.C.y; this.hipH = B.P.y;
    this.n1Off = new THREE.Vector3().subVectors(B.N1, B.C);
    this.Ln1 = B.N1.distanceTo(B.N2); this.Ln2 = B.N2.distanceTo(B.H); this.Lh = B.H.distanceTo(B.S);
    const pitchOf = (a, b) => Math.atan2(b.y - a.y, b.z - a.z);
    this.rest = { n1: pitchOf(B.N1, B.N2), n2: pitchOf(B.N2, B.H), h: pitchOf(B.H, B.S) };
    this.mOff = new THREE.Vector3(0, B.M.y - (B.P.y + B.C.y) / 2, B.M.z - (B.P.z + B.C.z) / 2);
    // ---- bones ----
    const ids = this.k = {};
    const add = (name, a, b, l = BF_L) => rig.add(name + idx, a, b, l);
    ids.pelvis = add('pelvis', B.P, B.M); ids.waist = add('waist', B.M, B.C); ids.chest = add('chest', B.C, B.N1);
    ids.neck1 = add('neck1', B.N1, B.N2); ids.neck2 = add('neck2', B.N2, B.H); ids.head = add('head', B.H, B.S);
    // ---- body loft ----
    this.buildBody(geo);
    this.buildLegs(geo);
    this.buildEars(geo);
    if (spec.tails) this.buildTails(geo);
    if (spec.tail) this.buildShortTail(geo);
    if (spec.antlers) this.buildAntlers(geo);
    // ---- runtime state ----
    this.phase = 0;
    this.legs = this.legDefs.map(d => ({
      ...d, k: 0, stance: true, w: 1, Tsw: 0.4, foot: new THREE.Vector3(), lift: new THREE.Vector3(), target: new THREE.Vector3(),
      yaw: 0, yawLift: 0, aLift: d.alpha, alpha: d.alpha, alpha0: d.alpha, curl: 0,
      J0: new THREE.Vector3(), J1: new THREE.Vector3(), J2: new THREE.Vector3(), J4: new THREE.Vector3(),
    }));
    // world frame of the body, updated by pose()
    this.P = new THREE.Vector3(); this.C = new THREE.Vector3(); this.M = new THREE.Vector3();
    this.N1 = new THREE.Vector3(); this.N2 = new THREE.Vector3(); this.H = new THREE.Vector3(); this.S = new THREE.Vector3();
    this.f = new THREE.Vector3(0, 0, 1); this.l = new THREE.Vector3(1, 0, 0); this.u = new THREE.Vector3(0, 1, 0);
    this.fh = new THREE.Vector3(0, 0, 1); this.lh = new THREE.Vector3(1, 0, 0); this.uh = new THREE.Vector3(0, 1, 0);
    this.tmp = [0, 1, 2, 3, 4, 5, 6, 7].map(() => new THREE.Vector3());
    this.seed = seed;
  }

  /* ---------------- bind mesh ---------------- */
  spineWeights(c) {
    // project a point onto the spine polyline P-M-C-N1-N2-H-S; blend the two bones around each joint
    const B = this.b, J = [B.P, B.M, B.C, B.N1, B.N2, B.H, B.S];
    const ids = [this.k.pelvis, this.k.waist, this.k.chest, this.k.neck1, this.k.neck2, this.k.head];
    let best = 1e9, seg = 0, fr = 0;
    for (let i = 0; i < J.length - 1; i++) {
      const a = J[i], b = J[i + 1];
      _e.subVectors(b, a); const L2 = _e.lengthSq();
      const t = clamp(_p.subVectors(c, a).dot(_e) / L2, 0, 1);
      const d = _p.copy(a).addScaledVector(_e, t).distanceToSquared(c);
      if (d < best - 1e-9) { best = d; seg = i; fr = t; }
    }
    // signed distance (in segment fractions) to the nearest joint, blended over ±0.3
    const out = [];
    if (fr < 0.3 && seg > 0) { const k = 0.5 + fr / 0.6; out.push([ids[seg], k], [ids[seg - 1], 1 - k]); }
    else if (fr > 0.7 && seg < ids.length - 1) { const k = 0.5 + (1 - fr) / 0.6; out.push([ids[seg], k], [ids[seg + 1], 1 - k]); }
    else out.push([ids[seg], 1]);
    return out;
  }
  buildBody(geo) {
    const sp = this.spec, secs = sp.sections;
    // resample the sections along z with a Catmull-Rom spline (smooth centreline and radii)
    const pts = secs.map(s => new THREE.Vector3(0, s[1], s[0]));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const nR = sp.bodyRings || 40;
    const lens = [0]; for (let i = 1; i < secs.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = lens[lens.length - 1];
    const rad = (t, idx) => {
      // radii are interpolated along arc length with a smooth (cosine) blend between the given sections
      const s = t * total;
      let i = 0; while (i < secs.length - 2 && lens[i + 1] < s) i++;
      const f = clamp((s - lens[i]) / Math.max(lens[i + 1] - lens[i], 1e-6), 0, 1), e = 0.5 - 0.5 * Math.cos(Math.PI * f);
      return lerp(secs[i][idx], secs[i + 1][idx], e);
    };
    const rings = [];
    const c = new THREE.Vector3(), t = new THREE.Vector3();
    for (let i = 0; i <= nR; i++) {
      // denser rings toward the head (the face needs them more than the flank)
      const q = i / nR, tt = 1 - Math.pow(1 - q, sp.headDense || 1.25);
      curve.getPointAt(tt, c); curve.getTangentAt(tt, t);
      rings.push({ c: c.clone(), t: t.clone(), l: BF_L, rx: rad(tt, 2), ryT: rad(tt, 3), ryB: rad(tt, 4), keel: rad(tt, 5), u: tt, tip: 0, w: this.spineWeights(c) });
    }
    // round the rump and the nose tip
    rings[0].rx *= 0.25; rings[0].ryT *= 0.25; rings[0].ryB *= 0.25;
    rings[nR].rx = rings[nR].ryT = rings[nR].ryB = 0.001;
    geo.tube(rings, sp.segBody || 22, { part: 0, idx: this.idx, v0: 0, v1: 1 });
    this.bodyCurve = curve;
  }
  buildLegs(geo) {
    const sp = this.spec, B = this.b, ids = this.k;
    this.legDefs = [];
    const J0 = new THREE.Vector3(), J1 = new THREE.Vector3(), J2 = new THREE.Vector3(), J3 = new THREE.Vector3(), J4 = new THREE.Vector3();
    for (const [name, front, side] of LEGS) {
      const L = front ? sp.legs.F : sp.legs.H;
      const anchor = front ? B.C : B.P;
      J0.set(side * L.hip[0], L.hip[1], L.hip[2]);
      J3.set(side * L.foot[0], sp.pawH, L.foot[1]);
      // standing pose: the metapodial at its rest angle, the upper two bones by IK
      J2.set(J3.x, J3.y + Math.cos(L.alpha) * L.L[2], J3.z - Math.sin(L.alpha) * L.L[2]);
      ik2(J0, J2, L.L[0], L.L[1], front ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 0, 1), J1);
      J4.set(J3.x, sp.pawH * 0.6, J3.z + L.L[3]);
      const pre = name + this.idx;
      const kU = this.rig.add(pre + 'u', J0, J1, BF_L), kL = this.rig.add(pre + 'l', J1, J2, BF_L);
      const kM = this.rig.add(pre + 'm', J2, J3, BF_L), kP = this.rig.add(pre + 'p', J3, J4, BF_L);
      const body = front ? ids.chest : ids.pelvis;
      // the leg tube: from inside the body (above the hip joint) down to the paw
      const r = L.r;   // radii: [top, J0, mid upper, J1, mid lower, J2, mid meta, J3]
      const ringsAt = [];
      const top = J0.clone().add(new THREE.Vector3(0, L.topUp || r[0] * 0.9, L.topFwd || 0));
      const seq = [
        [top, r[0], [[body, 0.75], [kU, 0.25]], 0],
        [J0, r[1], [[kU, 0.7], [body, 0.3]], 0.08],
        [J0.clone().lerp(J1, 0.5), r[2], [[kU, 1]], 0.2],
        [J1.clone().lerp(J0, 0.12), (r[2] + r[3]) * 0.5, [[kU, 0.8], [kL, 0.2]], 0.3],
        [J1, r[3], [[kU, 0.5], [kL, 0.5]], 0.36],
        [J1.clone().lerp(J2, 0.15), r[3] * 0.96, [[kL, 0.85], [kU, 0.15]], 0.42],
        [J1.clone().lerp(J2, 0.55), r[4], [[kL, 1]], 0.55],
        [J2.clone().lerp(J1, 0.1), (r[4] + r[5]) * 0.5, [[kL, 0.85], [kM, 0.15]], 0.64],
        [J2, r[5], [[kL, 0.5], [kM, 0.5]], 0.68],
        [J2.clone().lerp(J3, 0.18), r[5] * 0.95, [[kM, 0.85], [kL, 0.15]], 0.73],
        [J2.clone().lerp(J3, 0.6), r[6], [[kM, 1]], 0.84],
        [J3.clone().add(new THREE.Vector3(0, r[7] * 0.9, 0)), r[7], [[kM, 0.7], [kP, 0.3]], 0.94],
      ];
      for (let i = 0; i < seq.length; i++) {
        const [c, rr, w, u] = seq[i];
        const nx = seq[Math.min(i + 1, seq.length - 1)][0], pv = seq[Math.max(i - 1, 0)][0];
        const t = new THREE.Vector3().subVectors(nx, pv).normalize();
        const l = BF_L.clone().addScaledVector(t, -t.x).normalize();
        ringsAt.push({ c: c.clone(), t, l, rx: rr * (L.flat || 1), ryT: rr, ryB: rr, keel: 0, u, tip: 0, w });
      }
      // close the bottom of the leg tube inside the paw
      const last = ringsAt[ringsAt.length - 1];
      ringsAt.push({ ...last, c: J3.clone(), rx: 0.001, ryT: 0.001, ryB: 0.001, u: 1, w: [[kP, 1]] });
      geo.tube(ringsAt, L.seg || 10, { part: front ? 1 : 1.25, idx: this.idx, v0: 0, v1: 1 });
      // paw / hoof: a small closed loft from the heel to the toe
      const pw = L.paw, pr = [];
      const prof = pw.prof || [0.05, 0.75, 1, 0.95, 0.75, 0.05];
      for (let i = 0; i < prof.length; i++) {
        const f = i / (prof.length - 1);
        const c = new THREE.Vector3(J3.x, sp.pawH * (pw.lift || 0.55) + (pw.rise || 0) * f, J3.z - pw.back + (pw.back + L.L[3]) * f);
        pr.push({ c, t: BF_F, l: BF_L, rx: pw.w * prof[i], ryT: pw.h * prof[i], ryB: pw.h * prof[i] * 0.6, keel: 0, u: f, tip: 0, w: f < 0.3 ? [[kP, 0.6], [kM, 0.4]] : [[kP, 1]] });
      }
      geo.tube(pr, pw.seg || 8, { part: 5, idx: this.idx, v0: 0, v1: 1 });
      this.legDefs.push({
        name, front, side, kU, kL, kM, kP, L: L.L.slice(), alpha: L.alpha, flex: L.flex, curlMax: L.curl || 0.6, align: L.align ?? 0.6, scap: L.scap || 0,
        pole: front ? -1 : 1, off: sp.gait.off[LEGS.findIndex(x => x[0] === name)],
        hip: new THREE.Vector3(side * L.hip[0], L.hip[1] - anchor.y, L.hip[2] - anchor.z),   // from the anchor, body frame
        home: new THREE.Vector3(side * L.foot[0], 0, L.foot[1] - anchor.z),
      });
    }
  }
  buildEars(geo) {
    const E = this.spec.ears, B = this.b, ids = this.k;
    if (!E) return;
    this.ear = [];
    for (const side of [1, -1]) {
      const base = new THREE.Vector3(side * E.base[0], B.H.y + E.base[1], B.H.z + E.base[2]);
      const tip = new THREE.Vector3(side * E.tip[0], B.H.y + E.tip[1], B.H.z + E.tip[2]);
      const k = this.rig.add('ear' + side + '_' + this.idx, base, tip, BF_L);
      const rings = [];
      const n = 6;
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const c = base.clone().lerp(tip, f);
        // the ear's flat face turns forward and a little out; a cupped, slightly curled leaf
        const t = new THREE.Vector3().subVectors(tip, base).normalize();
        const l0 = new THREE.Vector3(side * Math.cos(E.turn || 0.3), 0, Math.sin(E.turn || 0.3));
        const l = l0.addScaledVector(t, -l0.dot(t)).normalize();
        const wv = (E.shape ? E.shape(f) : Math.sin(Math.PI * Math.min(1, 0.15 + f * 0.95)) * (1 - f * 0.85) + 0.02);
        rings.push({ c, t, l, rx: E.w * wv, ryT: E.d * wv, ryB: E.d * wv * 0.6, keel: 0, u: f + (side < 0 ? 2 : 0), tip: f, w: f < 0.2 ? [[k, 0.6], [ids.head, 0.4]] : [[k, 1]] });
      }
      rings[n].rx = rings[n].ryT = rings[n].ryB = 0.001;
      geo.tube(rings, 8, { part: 3, idx: this.idx, v0: 0, v1: 1 });
      this.ear.push({ k, side, base: new THREE.Vector3(side * E.base[0], E.base[1], E.base[2]), tipOff: new THREE.Vector3(side * (E.tip[0] - E.base[0]), E.tip[1] - E.base[1], E.tip[2] - E.base[2]) });
    }
  }
  /** Rest directions of the fox's tails (pelvis frame: pitch above backward, yaw toward +l), per segment. */
  tailRest(i, k) {
    const T = this.spec.tails;
    const c = (i - (T.n - 1) / 2) / ((T.n - 1) / 2);   // -1 .. 1 across the fan
    const yaw = T.fan * c;
    const pitch = T.lift + T.liftC * (1 - Math.abs(c)) + T.curl[k];
    return [pitch, yaw];
  }
  buildTails(geo) {
    const T = this.spec.tails, B = this.b;
    this.tailRoot = new THREE.Vector3(0, T.root[0] - B.P.y, T.root[1] - B.P.z);
    this.tails = [];
    const f = BF_F, l = BF_L, u = BF_U, back = new THREE.Vector3(0, 0, -1);
    const d = new THREE.Vector3();
    for (let i = 0; i < T.n; i++) {
      const len = T.len * (1 - 0.1 * Math.abs((i - (T.n - 1) / 2) / ((T.n - 1) / 2)));
      const sl = len / T.segs;
      const J = [new THREE.Vector3(0, T.root[0], T.root[1])];
      let pitch = 0, yaw = 0;
      for (let k = 0; k < T.segs; k++) {
        [pitch, yaw] = this.tailRest(i, k);
        // backward-based direction: -f turned by yaw toward ±l and raised by pitch
        d.set(0, 0, 0).addScaledVector(back, Math.cos(pitch) * Math.cos(yaw)).addScaledVector(l, Math.sin(yaw) * Math.cos(pitch)).addScaledVector(u, Math.sin(pitch));
        J.push(J[k].clone().addScaledVector(d, sl));
      }
      const ks = [];
      for (let k = 0; k < T.segs; k++) {
        const t = new THREE.Vector3().subVectors(J[k + 1], J[k]).normalize();
        const lat = l.clone().addScaledVector(t, -t.dot(l)).normalize();
        ks.push(this.rig.add('tail' + i + '_' + k + '_' + this.idx, J[k], J[k + 1], lat.lengthSq() > 0.5 ? lat : new THREE.Vector3(0, 1, 0)));
      }
      // tube along the chain: a soft brush, thin at the root, full in the middle, drawn to a point
      const rings = [];
      const nR = T.rings || 16;
      for (let r = 0; r <= nR; r++) {
        const s = r / nR, fk = s * T.segs, k = Math.min(Math.floor(fk), T.segs - 1), fr = fk - k;
        const c = J[k].clone().lerp(J[k + 1], fr);
        const t = new THREE.Vector3().subVectors(J[k + 1], J[k]).normalize();
        const lat = l.clone().addScaledVector(t, -t.dot(l));
        if (lat.lengthSq() < 1e-4) lat.set(0, 1, 0);
        lat.normalize();
        const rr = T.rMax * T.prof(s);
        const w = fr < 0.3 && k > 0 ? [[ks[k], 0.5 + fr / 0.6], [ks[k - 1], 0.5 - fr / 0.6]]
          : fr > 0.7 && k < T.segs - 1 ? [[ks[k], 0.5 + (1 - fr) / 0.6], [ks[k + 1], 0.5 - (1 - fr) / 0.6]] : [[ks[k], 1]];
        if (r === 0) w.push([this.k.pelvis, 0.6]);
        rings.push({ c, t, l: lat, rx: rr, ryT: rr * 0.92, ryB: rr * 0.92, keel: 0, u: s, tip: s, w });
      }
      rings[nR].rx = rings[nR].ryT = rings[nR].ryB = 0.001;
      geo.tube(rings, T.seg || 12, { part: 2, idx: this.idx * 16 + i, v0: 0, v1: 1 });
      this.tails.push({ ks, len, sl, J: J.map(x => new THREE.Vector3()), i });
    }
    void f; void d;
  }
  buildShortTail(geo) {
    const T = this.spec.tail, B = this.b;
    const a = new THREE.Vector3(0, T.root[0], T.root[1]);
    const b = a.clone().add(new THREE.Vector3(0, Math.sin(T.pitch) * T.len, -Math.cos(T.pitch) * T.len));
    const k = this.rig.add('stail' + this.idx, a, b, BF_L);
    const rings = [];
    for (let i = 0; i <= 5; i++) {
      const f = i / 5, c = a.clone().lerp(b, f);
      const t = new THREE.Vector3().subVectors(b, a).normalize();
      const w = T.w * (i === 5 ? 0.02 : Math.sin(Math.PI * Math.min(1, 0.2 + f * 0.85)) + 0.15);
      rings.push({ c, t, l: BF_L, rx: w, ryT: T.d * (w / T.w), ryB: T.d * (w / T.w), keel: 0, u: f, tip: f, w: f < 0.2 ? [[k, 0.5], [this.k.pelvis, 0.5]] : [[k, 1]] });
    }
    geo.tube(rings, 8, { part: 6, idx: this.idx, v0: 0, v1: 1 });
    this.sTail = { k, root: new THREE.Vector3(0, T.root[0] - B.P.y, T.root[1] - B.P.z), len: T.len, pitch: T.pitch };
  }
  buildAntlers(geo) {
    // rigid branches on the skull (weighted to the head bone): a main beam per side with its tines
    const A = this.spec.antlers, B = this.b, kH = this.k.head;
    for (const side of [1, -1]) {
      for (const br of A.branches) {
        const pts = br.pts.map(p => new THREE.Vector3(side * p[0], B.H.y + p[1], B.H.z + p[2]));
        const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
        const rings = [];
        const n = br.rings || 6;
        for (let i = 0; i <= n; i++) {
          const f = i / n, c = curve.getPointAt(f), t = curve.getTangentAt(f);
          const lat = BF_L.clone().addScaledVector(t, -t.dot(BF_L));
          if (lat.lengthSq() < 1e-4) lat.set(0, 0, 1);
          lat.normalize();
          const r = lerp(br.r0, br.r1, f) * (i === n ? 0.2 : 1);
          rings.push({ c, t, l: lat, rx: r, ryT: r, ryB: r, keel: 0, u: br.u0 + (br.u1 - br.u0) * f, tip: f, w: [[kH, 1]] });
        }
        geo.tube(rings, 6, { part: 4, idx: this.idx, v0: 0, v1: 1 });
      }
    }
  }

  /* ---------------- runtime ---------------- */
  /**
   * Place the paws for the current P / C before the first pose(): standing square (speed 0), or already in stride
   * at `speed` (each paw where the walk cycle would have it: planted along its stance, or part-way through a swing).
   */
  plant(P, C, speed = 0) {
    this.frame(P, C, 0);
    const G = this.spec.gait, duty = G.duty;
    const L = G.L0 * clamp(0.45 + 0.55 * speed / G.vRef, 0.45, 1.3), rate = speed / L;
    const hx = this.f.x, hz = this.f.z, hl = Math.hypot(hx, hz) || 1;
    const yaw = Math.atan2(hx, hz);
    for (const g of this.legs) {
      this.homeOf(g, g.foot);
      g.yaw = yaw; g.curl = 0;
      g.k = Math.floor(this.phase - g.off - duty);
      g.stance = true; g.w = 1;
      if (speed > 0.01) {
        const c = ((this.phase - g.off) % 1 + 1) % 1;
        const bias = 0.5 * duty * L;
        const put = (out, d) => { out.x += hx / hl * d; out.z += hz / hl * d; out.y = this.heightAt(out.x, out.z) + this.spec.pawH; return out; };
        if (c < duty) put(g.foot, bias - c * L);
        else {
          g.stance = false; g.w = (c - duty) / (1 - duty);
          g.Tsw = clamp((1 - duty) / Math.max(rate, 1e-3), G.tMin || 0.24, G.tMax || 0.62);
          this.homeOf(g, g.lift); put(g.lift, bias - duty * L - (c - duty) * L);
          g.yawLift = yaw;
        }
      }
      g.alpha = this.alphaAt(g, g.foot); g.aLift = g.alpha;
    }
  }
  frame(P, C, roll) {
    this.P.copy(P); this.C.copy(C);
    const f = this.f.subVectors(C, P).normalize();
    const l = this.l.crossVectors(UP, f);
    if (l.lengthSq() < 1e-8) l.set(1, 0, 0);
    l.normalize();
    const u = this.u.crossVectors(f, l).normalize();
    if (roll) { l.applyAxisAngle(f, roll); u.applyAxisAngle(f, roll); }
  }
  homeOf(L, out) {
    const a = L.front ? this.C : this.P;
    // horizontal forward / lateral (feet stand on the ground, not on the tilted body frame)
    const fx = this.f.x, fz = this.f.z, fl = Math.hypot(fx, fz) || 1;
    const hx = fx / fl, hz = fz / fl;
    out.set(a.x + hz * L.home.x + hx * L.home.z, 0, a.z - hx * L.home.x + hz * L.home.z);
    out.y = this.heightAt(out.x, out.z) + this.spec.pawH;
    return out;
  }
  /** Hip / shoulder joint of a leg for this frame (the shoulder blade swings a little with the front leg). */
  jointOf(g, out) {
    const a = g.front ? this.C : this.P;
    framePt(a, this.l, this.u, this.f, g.hip.x, g.hip.y, g.hip.z, out);
    if (g.scap) {
      const ahead = (g.foot.x - out.x) * this.f.x + (g.foot.z - out.z) * this.f.z;
      out.addScaledVector(this.f, clamp(ahead * 0.3, -g.scap, g.scap));
    }
    return out;
  }
  /** Metapodial angle (hock / wrist behind the paw, rad) for a paw at p: rest angle, turned with the leg's line. */
  alphaAt(g, p) {
    const J0 = this.jointOf(g, this.tmp[4]);
    const ahead = (p.x - J0.x) * this.f.x + (p.z - J0.z) * this.f.z;
    return g.alpha0 + g.align * Math.atan2(ahead, Math.max(J0.y - p.y, 0.1));
  }
  /**
   * Pose for this frame. st = { P, C: spine points (world, heights included), vP, vC: their velocities, speed (m/s
   * forward), turn (rad/s), roll, bend (lateral spine bend, m), down (0 head up … 1 grazing), lookYaw, lookPitch,
   * ears: [flickL, flickR], earBack, tailLift, tailWag, gait: { duty, off[4], swingH, L0, vRef } overrides,
   * tails(i, k) → [dPitch, dYaw] for the fox }.
   */
  pose(dt, st) {
    const sp = this.spec, G = st.gait || sp.gait, rig = this.rig, k = this.k;
    this.frame(st.P, st.C, st.roll || 0);
    const f = this.f, l = this.l, u = this.u;
    // ---- gait clock ----
    const arm = this.T * 0.55;
    const vEff = Math.hypot(st.speed, st.turn * arm);
    const L = G.L0 * clamp(0.45 + 0.55 * vEff / G.vRef, 0.45, 1.3);
    const rate = vEff / L;
    this.rate = rate;
    this.phase += rate * dt;
    if (this.phase > 4096) { this.phase -= 4096; for (const g of this.legs) g.k -= 4096; }
    const duty = G.duty;
    const yawBody = Math.atan2(f.x, f.z);
    for (let i = 0; i < 4; i++) {
      const g = this.legs[i];
      const off = G.off ? G.off[i] : g.off;
      const kk = Math.floor(this.phase - off - duty);
      // a planted paw the body has drifted too far from (a slow shuffle, a turn on the spot) takes a catch-up step
      // of its own, as long as the legs either side of it are planted
      const reachK = g.stance && g.J0.lengthSq() > 0 ? g.J0.distanceTo(g.J2) / (g.L[0] + g.L[1]) : 0;
      const catchUp = reachK > 0.975 && this.legs[(i + 1) % 4].stance && this.legs[(i + 3) % 4].stance;
      if (kk > g.k || catchUp) {
        if (kk > g.k) g.k = kk;
        if (g.stance) {
          g.stance = false; g.w = 0; g.lift.copy(g.foot); g.yawLift = g.yaw; g.aLift = g.alpha;
          g.Tsw = clamp((1 - duty) / Math.max(rate, 1e-3), G.tMin || 0.24, G.tMax || 0.62);
        }
      }
      if (!g.stance) {
        g.w = Math.min(1, g.w + dt / g.Tsw);
        const w = g.w;
        // footfall: the paw's home when it lands, a little ahead (the stance then centres under the hip)
        this.homeOf(g, g.target);
        const vel = g.front ? st.vC : st.vP;
        const tRem = (1 - w) * g.Tsw;
        const sp2 = Math.hypot(vel.x, vel.z);
        const bias = vEff > 1e-4 ? 0.5 * duty * L * (st.speed / vEff) : 0;
        g.target.x += vel.x * tRem + (sp2 > 1e-4 ? vel.x / sp2 * bias : 0);
        g.target.z += vel.z * tRem + (sp2 > 1e-4 ? vel.z / sp2 * bias : 0);
        g.target.y = this.heightAt(g.target.x, g.target.z) + sp.pawH;
        const e = w * w * (3 - 2 * w);
        g.foot.lerpVectors(g.lift, g.target, e);
        const span = Math.hypot(g.target.x - g.lift.x, g.target.z - g.lift.z);
        g.foot.y += G.swingH * Math.min(1, span / (0.3 * G.L0) + 0.25) * Math.sin(Math.PI * Math.pow(w, 0.85));
        let dy = yawBody - g.yawLift; dy -= Math.round(dy / TAU) * TAU;
        g.yaw = g.yawLift + dy * e;
        // mid-swing the joint above the paw folds: the wrist (hock) rides up and ahead and the paw trails behind it
        g.alpha = lerp(g.aLift, this.alphaAt(g, g.target), e) - g.flex * Math.sin(Math.PI * Math.pow(w, 0.8));
        g.curl = g.curlMax * Math.sin(Math.PI * w);
        if (g.w >= 1) { g.stance = true; g.foot.copy(g.target); g.curl = 0; }
      } else {
        // stance: the paw stays put; the metapodial turns with the leg's line as the body passes over it
        g.alpha = this.alphaAt(g, g.foot);
        g.curl = 0;
      }
    }
    // ---- spine ----
    const M = this.M.addVectors(this.P, this.C).multiplyScalar(0.5).addScaledVector(u, this.mOff.y).addScaledVector(f, this.mOff.z).addScaledVector(l, st.bend || 0);
    rig.set(k.pelvis, this.P, M, l);
    rig.set(k.waist, M, this.C, l);
    // neck and head: rest pitches blended toward grazing, with the look turn shared along the chain
    const down = st.down || 0, gz = sp.graze;
    const yawT = st.lookYaw || 0, pitT = st.lookPitch || 0;
    const t0 = this.tmp[0], t1 = this.tmp[1], t2 = this.tmp[2];
    framePt(this.C, l, u, f, this.n1Off.x, this.n1Off.y, this.n1Off.z, this.N1);
    const p1 = lerp(this.rest.n1, gz.n1, down) + pitT * 0.3, y1 = yawT * 0.3;
    const p2 = lerp(this.rest.n2, gz.n2, down) + pitT * 0.35, y2 = yawT * 0.65;
    const ph = lerp(this.rest.h, gz.h, down) + pitT * 0.35 + (st.nod || 0), yh = yawT;
    frameDir(l, u, f, p1, y1, t0); this.N2.copy(this.N1).addScaledVector(t0, this.Ln1);
    frameDir(l, u, f, p2, y2, t1); this.H.copy(this.N2).addScaledVector(t1, this.Ln2);
    frameDir(l, u, f, ph, yh, t2); this.S.copy(this.H).addScaledVector(t2, this.Lh);
    const lat = this.tmp[3];
    rig.set(k.chest, this.C, this.N1, l);
    lat.copy(l).multiplyScalar(Math.cos(y1)).addScaledVector(f, -Math.sin(y1));
    rig.set(k.neck1, this.N1, this.N2, lat);
    lat.copy(l).multiplyScalar(Math.cos(y2)).addScaledVector(f, -Math.sin(y2));
    rig.set(k.neck2, this.N2, this.H, lat);
    this.lh.copy(l).multiplyScalar(Math.cos(yh)).addScaledVector(f, -Math.sin(yh)).normalize();
    this.fh.copy(t2);
    this.uh.crossVectors(this.fh, this.lh).normalize();
    rig.set(k.head, this.H, this.S, this.lh);
    // ---- ears ----
    if (this.ear) {
      for (let i = 0; i < 2; i++) {
        const e = this.ear[i];
        const base = framePt(this.H, this.lh, this.uh, this.fh, e.base.x, e.base.y, e.base.z, this.tmp[4]);
        const tip = this.tmp[5].set(0, 0, 0).addScaledVector(this.lh, e.tipOff.x).addScaledVector(this.uh, e.tipOff.y).addScaledVector(this.fh, e.tipOff.z);
        const fl = st.ears ? st.ears[i] : 0;
        if (fl) tip.applyAxisAngle(this.fh, -e.side * fl * 0.7);
        if (st.earBack) tip.applyAxisAngle(this.lh, -st.earBack * 0.6 * 1);
        tip.add(base);
        rig.set(e.k, base, tip, this.lh);
      }
    }
    // ---- legs ----
    let dropC = 0, dropP = 0;
    for (const g of this.legs) {
      this.jointOf(g, g.J0);
      // paw frame (planted yaw)
      const px = Math.sin(g.yaw), pz = Math.cos(g.yaw);
      // metapodial: up from the paw, leaning back by alpha (front: the carpus folds back in swing)
      const J3 = g.foot;
      g.J2.set(J3.x - px * Math.sin(g.alpha) * g.L[2], J3.y + Math.cos(g.alpha) * g.L[2], J3.z - pz * Math.sin(g.alpha) * g.L[2]);
      const pole = t0.copy(f).multiplyScalar(g.pole);
      ik2(g.J0, g.J2, g.L[0], g.L[1], pole, g.J1);
      // a leg that cannot reach lowers its end of the body a little (next frames), instead of stretching
      const over = g.J0.distanceTo(g.J2) - (g.L[0] + g.L[1]) * 0.985;
      if (over > 0) { if (g.front) dropC = Math.max(dropC, over); else dropP = Math.max(dropP, over); }
      const cu = g.curl;
      g.J4.set(J3.x + px * Math.cos(cu) * g.L[3], J3.y - Math.sin(cu) * g.L[3] - sp.pawH * 0.4 * Math.cos(cu), J3.z + pz * Math.cos(cu) * g.L[3]);
      const pl = t1.set(pz, 0, -px);
      rig.set(g.kU, g.J0, g.J1, l);
      rig.set(g.kL, g.J1, g.J2, l);
      rig.set(g.kM, g.J2, J3, pl);
      rig.set(g.kP, J3, g.J4, pl);
    }
    this.dropC = Math.min(0.12, Math.max(dropC * 1.3, (this.dropC || 0) * Math.exp(-3 * dt)));
    this.dropP = Math.min(0.12, Math.max(dropP * 1.3, (this.dropP || 0) * Math.exp(-3 * dt)));
    // ---- tails ----
    if (this.tails) {
      const T = sp.tails;
      const root = framePt(this.P, l, u, f, this.tailRoot.x, this.tailRoot.y, this.tailRoot.z, this.tmp[6]);
      const d = this.tmp[7];
      for (const tl of this.tails) {
        tl.J[0].copy(root);
        for (let s = 0; s < T.segs; s++) {
          let [pitch, yaw] = this.tailRest(tl.i, s);
          if (st.tails) { const o = st.tails(tl.i, s); pitch += o[0]; yaw += o[1]; }
          d.set(0, 0, 0).addScaledVector(f, -Math.cos(pitch) * Math.cos(yaw)).addScaledVector(l, Math.sin(yaw) * Math.cos(pitch)).addScaledVector(u, Math.sin(pitch));
          tl.J[s + 1].copy(tl.J[s]).addScaledVector(d, tl.sl);
          lat.copy(l).addScaledVector(d, -d.dot(l));
          if (lat.lengthSq() < 1e-4) lat.copy(u);
          rig.set(tl.ks[s], tl.J[s], tl.J[s + 1], lat.normalize());
        }
      }
    }
    if (this.sTail) {
      const T = this.sTail;
      const root = framePt(this.P, l, u, f, T.root.x, T.root.y, T.root.z, this.tmp[6]);
      const pitch = T.pitch + (st.tailLift || 0) * 1.9;
      const wag = st.tailWag || 0;
      const d = this.tmp[7].set(0, 0, 0).addScaledVector(f, -Math.cos(pitch) * Math.cos(wag)).addScaledVector(l, Math.sin(wag) * Math.cos(pitch)).addScaledVector(u, Math.sin(pitch));
      const tip = this.tmp[5].copy(root).addScaledVector(d, T.len);
      rig.set(T.k, root, tip, l);
    }
  }
}
