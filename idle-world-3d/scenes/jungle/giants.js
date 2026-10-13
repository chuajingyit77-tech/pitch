// 雨林 · gentle giants: a small family of long-necked browsers that now and then walks along the misty ridge beyond
// the cliff. Original design (in the spirit of the gentle herbivores of big creature games, nothing copied): a heavy
// barrel body with a dorsal crest of soft plates, a long neck carried high, a small head with a swept-back frill,
// a long tail, columnar legs; countershaded hide with dark saddle stripes and pale throat, glowing lichen on the back
// at night.
//
// Each animal is a SkinnedMesh with a procedural skeleton (31 bones) driven on the CPU:
//  - feet are planted in world space: a foot in stance never moves; a swinging foot travels from where it lifted to
//    where the body will be at touch-down (predicted along the path), so the stride always matches the speed;
//  - lateral-sequence walk (LH, LF, RH, RF), duty factor 0.7; cadence follows speed (f = v / stride(v));
//  - the hips and shoulders vault over the stance legs (an analytic bump during single support), so the columnar
//    legs stay almost straight, with a slight sway and roll from the gait;
//  - neck: posture, a slow travelling S-sway, gait bob, and browsing (the head dips to the shrubs and rises again);
//  - tail: a travelling wave tied to the stride plus a slow drift.
// Everything integrates with dt or is a function of continuous phases, so 30 and 60 fps give the same motion.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, damp, makeRng, createNoise, makeCanvas } from '../../lib/util.js';
import { JG_GLSL } from './shading.js';
import { VISTA_GLSL } from './far.js';

/* ------------------------------------------------------------------ */
/* Body plan (adult, metres; body space: +z forward, +y up, +x = left)  */
/* ------------------------------------------------------------------ */
// spine key points from the tail tip to the snout: z, y, half-width, half-height
const SPINE = [
  [-12.6, 3.55, 0.07, 0.08], [-11.0, 3.85, 0.17, 0.19], [-9.2, 4.25, 0.3, 0.33], [-7.4, 4.7, 0.47, 0.52],
  [-5.6, 5.1, 0.7, 0.78], [-4.0, 5.42, 0.98, 1.1], [-2.7, 5.62, 1.22, 1.4], [-1.3, 5.72, 1.4, 1.62],
  [0.1, 5.76, 1.48, 1.74], [1.5, 5.84, 1.44, 1.7], [2.7, 5.98, 1.3, 1.56], [3.7, 6.45, 1.0, 1.12],
  [4.45, 7.3, 0.78, 0.86], [5.1, 8.25, 0.63, 0.68], [5.7, 9.2, 0.53, 0.56], [6.25, 10.1, 0.46, 0.48],
  [6.75, 10.9, 0.4, 0.42], [7.2, 11.45, 0.36, 0.4], [7.65, 11.72, 0.35, 0.42], [8.15, 11.78, 0.32, 0.38],
  [8.6, 11.66, 0.26, 0.3], [9.0, 11.5, 0.19, 0.21], [9.25, 11.38, 0.08, 0.09],
];
// bones placed on spine key points (index into SPINE)
const SPINE_BONES = [
  ['tail5', 0], ['tail4', 1], ['tail3', 2], ['tail2', 3], ['tail1', 4], ['tail0', 5], ['pelvis', 6], ['spine1', 7],
  ['spine2', 8], ['spine3', 9], ['chest', 10], ['neck0', 11], ['neck1', 12], ['neck2', 13], ['neck3', 14],
  ['neck4', 15], ['neck5', 16], ['head', 17],
];
const NECK0 = 11, HEAD0 = 17, TAIL0 = 5;
// legs: joint (hip / shoulder) in body space, upper and lower lengths, ankle height above the sole, knee pole
const LEGS = [
  { name: 'LH', side: 1, hind: true, parent: 'pelvis', joint: [0.95, 4.72, -2.7], off: 0.0 },
  { name: 'RH', side: -1, hind: true, parent: 'pelvis', joint: [-0.95, 4.72, -2.7], off: 0.5 },
  { name: 'LF', side: 1, hind: false, parent: 'chest', joint: [0.98, 4.98, 2.7], off: 0.25 },
  { name: 'RF', side: -1, hind: false, parent: 'chest', joint: [-0.98, 4.98, 2.7], off: 0.75 },
];
const ANKLE_H = 0.42;

/** A body build: `prop` = { scale, neck, head, tail, girth, leg } (1 = adult). Returns the skinned geometry,
 * the rest skeleton (name, parent, position in parent space) and the measures the gait needs. */
function buildBody(seed, prop) {
  const S = prop.scale;
  const rng = makeRng(seed);
  // proportions: the neck, head and tail are scaled about their roots
  const pts = SPINE.map(p => p.slice());
  const n0 = SPINE[NECK0];
  for (let i = NECK0 + 1; i < pts.length; i++) {
    const k = i >= HEAD0 ? prop.neck : prop.neck;
    pts[i][0] = n0[0] + (SPINE[i][0] - n0[0]) * k; pts[i][1] = n0[1] + (SPINE[i][1] - n0[1]) * k;
  }
  // the head keeps its shape, scaled about the head's base
  const h0 = pts[HEAD0].slice();
  for (let i = HEAD0; i < pts.length; i++) {
    pts[i][0] = h0[0] + (SPINE[i][0] - SPINE[HEAD0][0]) * prop.head; pts[i][1] = h0[1] + (SPINE[i][1] - SPINE[HEAD0][1]) * prop.head;
    pts[i][2] = SPINE[i][2] * prop.head; pts[i][3] = SPINE[i][3] * prop.head;
  }
  const t0 = SPINE[TAIL0];
  for (let i = 0; i < TAIL0; i++) { pts[i][0] = t0[0] + (SPINE[i][0] - t0[0]) * prop.tail; pts[i][1] = t0[1] + (SPINE[i][1] - t0[1]) * prop.tail; }
  for (let i = 0; i < pts.length; i++) if (i < HEAD0) { pts[i][2] *= prop.girth; pts[i][3] *= prop.girth; }
  // legs a little longer or shorter: lift the whole body
  const lift = (prop.leg - 1) * 4.7;
  for (const p of pts) p[1] += lift;
  const P = pts.map(p => new THREE.Vector3(0, p[1] * S, p[0] * S));
  const curve = new THREE.CatmullRomCurve3(P, false, 'centripetal');
  const LEN = curve.getLength();
  // arc position of every key point (for bone placement and skin weights)
  const NS = 400;
  const tab = []; // [u, s]
  for (let i = 0; i <= NS; i++) tab.push(curve.getPointAt(i / NS));
  const keyS = P.map(p => { let best = 0, bd = 1e9; for (let i = 0; i <= NS; i++) { const d = tab[i].distanceToSquared(p); if (d < bd) { bd = d; best = i; } } return best / NS * LEN; });
  const radAt = s => {
    // interpolate the half-sizes between key points by arc position
    let k = 0;
    while (k < keyS.length - 2 && s > keyS[k + 1]) k++;
    const t = clamp((s - keyS[k]) / Math.max(keyS[k + 1] - keyS[k], 1e-6), 0, 1), e = t * t * (3 - 2 * t);
    return [lerp(pts[k][2], pts[k + 1][2], e) * S, lerp(pts[k][3], pts[k + 1][3], e) * S];
  };
  /* ---- skeleton (rest pose, no rotations) ---- */
  const rest = [];
  const idx = {};
  const addBone = (name, parent, worldPos) => {
    idx[name] = rest.length;
    rest.push({ name, parent: parent === null ? -1 : idx[parent], world: worldPos.clone() });
  };
  addBone('root', null, new THREE.Vector3());
  // parents before children: pelvis, the tail chain going back, the spine and neck chain going forward
  const keyOf = Object.fromEntries(SPINE_BONES);
  const BONE_TREE = [['pelvis', 'root'], ['tail0', 'pelvis'], ['tail1', 'tail0'], ['tail2', 'tail1'], ['tail3', 'tail2'], ['tail4', 'tail3'], ['tail5', 'tail4'],
    ['spine1', 'pelvis'], ['spine2', 'spine1'], ['spine3', 'spine2'], ['chest', 'spine3'], ['neck0', 'chest'], ['neck1', 'neck0'], ['neck2', 'neck1'],
    ['neck3', 'neck2'], ['neck4', 'neck3'], ['neck5', 'neck4'], ['head', 'neck5']];
  for (const [nm, parent] of BONE_TREE) addBone(nm, parent, P[keyOf[nm]]);
  const legDims = [];
  for (const L of LEGS) {
    const J = new THREE.Vector3(L.joint[0] * S * prop.girth, (L.joint[1] + lift) * S, L.joint[2] * S);
    const ankle = new THREE.Vector3(J.x, ANKLE_H * S, J.z + (L.hind ? -0.06 : 0.04) * S);
    // the leg is slightly bent in the rest pose (knee forward for the hind legs, elbow back for the fore legs)
    const total = J.distanceTo(ankle);
    const a = total * 0.535 * 1.012, b = total * 0.465 * 1.012; // a + b a little longer than the rest span
    const mid = J.clone().lerp(ankle, 0.535);
    const bend = Math.sqrt(Math.max(a * a - (total * 0.535) ** 2, 0));
    const knee = mid.add(new THREE.Vector3(0, 0, L.hind ? bend : -bend));
    addBone(L.name + 'u', L.parent, J);
    addBone(L.name + 'l', L.name + 'u', knee);
    addBone(L.name + 'f', L.name + 'l', ankle);
    legDims.push({ ...L, J, knee, ankle, a: J.distanceTo(knee), b: knee.distanceTo(ankle) });
  }
  for (const r of rest) {
    const parentWorld = r.parent >= 0 ? rest[r.parent].world : new THREE.Vector3();
    r.pos = r.world.clone().sub(parentWorld);
  }
  /* ---- geometry ---- */
  const pos = [], nor = [], hide = [], sIdx = [], sW = [], ind = [];
  const push = (p, n, u, v, part, ao, b0, b1, w1) => {
    pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); hide.push(u, v, part, ao);
    sIdx.push(b0, b1, 0, 0); sW.push(1 - w1, w1, 0, 0);
  };
  // chain of spine bones ordered by arc position, for skin weights
  const chain = SPINE_BONES.map(([nm, ki]) => ({ bone: idx[nm], s: keyS[ki] })).sort((a, b) => a.s - b.s);
  const spineWeights = s => {
    if (s <= chain[0].s) return [chain[0].bone, chain[0].bone, 0];
    for (let k = 0; k < chain.length - 1; k++) {
      if (s <= chain[k + 1].s) {
        const t = (s - chain[k].s) / Math.max(chain[k + 1].s - chain[k].s, 1e-6);
        return [chain[k].bone, chain[k + 1].bone, t * t * (3 - 2 * t)];
      }
    }
    const e = chain[chain.length - 1];
    return [e.bone, e.bone, 0];
  };
  // body tube: rings by arc length (denser on the head and the neck base)
  const SIDES = 18;
  const ringS = [];
  for (let s = 0; s < LEN; ) { ringS.push(s); const hd = s > keyS[HEAD0] - 0.3 * S ? 0.22 : s < keyS[1] ? 0.3 : 0.4; s += hd * Math.max(S, 0.55); }
  ringS.push(LEN);
  const _T = new THREE.Vector3(), _U = new THREE.Vector3(), _X = new THREE.Vector3(1, 0, 0), _p = new THREE.Vector3(), _n = new THREE.Vector3();
  const neckS = keyS[NECK0], headS = keyS[HEAD0], hipS = keyS[6], chestS = keyS[10];
  const rings = ringS.length;
  for (let r = 0; r < rings; r++) {
    const s = ringS[r], u = s / LEN;
    const c = curve.getPointAt(u);
    curve.getTangentAt(u, _T);
    _U.crossVectors(_T, _X).normalize();
    let [rx, ry] = radAt(s);
    if (r === 0 || r === rings - 1) { rx *= 0.25; ry *= 0.25; }
    // belly hangs lower between the legs; a soft dorsal crest along the back and neck
    const torso = smoothstep(hipS - 2.4 * S, hipS, s) * (1 - smoothstep(chestS, chestS + 1.6 * S, s));
    const crest = (smoothstep(keyS[3], hipS, s) * (1 - smoothstep(headS - 0.6 * S, headS, s))) * 0.09 * S;
    const [b0, b1, w1] = spineWeights(s);
    for (let i = 0; i <= SIDES; i++) {
      const a = (i / SIDES) * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const ryS = ca >= 0 ? ry * (1 - 0.1 * torso) : ry * (1 + 0.16 * torso);
      const flat = 1 - 0.06 * torso * ca * ca;
      const da = Math.min(a, TAU - a);
      const cr = crest * Math.exp(-((da / 0.3) ** 2));
      _p.copy(c).addScaledVector(_U, ca * (ryS + cr)).addScaledVector(_X, sa * rx * flat);
      // normal of the ellipse cross-section (tilted along the taper by the tangent)
      _n.copy(_U).multiplyScalar(ca / Math.max(ryS, 1e-3)).addScaledVector(_X, sa / Math.max(rx, 1e-3)).normalize();
      // occlusion: under the belly, the inside of the neck base
      const ao = smoothstep(0.2, -0.9, ca) * (0.35 + 0.5 * torso);
      push(_p, _n, u, i / SIDES, 0, ao, b0, b1, w1);
    }
  }
  for (let r = 0; r < rings - 1; r++) for (let i = 0; i < SIDES; i++) {
    const a = r * (SIDES + 1) + i, b = a + 1, c = a + SIDES + 1, d = c + 1;
    ind.push(a, c, b, b, c, d);
  }
  // caps at both ends (tiny, but keeps the silhouette closed)
  for (const r of [0, rings - 1]) {
    const base = pos.length / 3;
    const ctr = curve.getPointAt(ringS[r] / LEN);
    const [b0, b1, w1] = spineWeights(ringS[r]);
    curve.getTangentAt(ringS[r] / LEN, _T);
    push(ctr, r === 0 ? _T.clone().negate() : _T, ringS[r] / LEN, 0.25, 0, 0, b0, b1, w1);
    const ring0 = r * (SIDES + 1);
    for (let i = 0; i < SIDES; i++) { if (r === 0) ind.push(base, ring0 + i, ring0 + i + 1); else ind.push(base, ring0 + i + 1, ring0 + i); }
  }
  // dorsal plates: soft leaf-shaped plates along the crest from the neck base to the tail
  const plateFrom = keyS[2], plateTo = neckS + 1.6 * S;
  for (let s = plateFrom; s < plateTo; s += 0.62 * S) {
    const u = s / LEN, c = curve.getPointAt(u);
    curve.getTangentAt(u, _T);
    _U.crossVectors(_T, _X).normalize();
    const [, ry] = radAt(s);
    const k = Math.sin(Math.PI * clamp((s - plateFrom) / (plateTo - plateFrom), 0, 1));
    const ht = (0.22 + 0.42 * Math.pow(k, 0.7)) * S * rng.range(0.85, 1.1), ln = (0.42 + 0.3 * k) * S, th = 0.07 * S;
    const crest = (smoothstep(keyS[3], hipS, s) * (1 - smoothstep(headS - 0.6 * S, headS, s))) * 0.09 * S;
    const base = c.clone().addScaledVector(_U, ry * 0.97 + crest);
    const tip = base.clone().addScaledVector(_U, ht).addScaledVector(_T, -ln * 0.45);
    const f = base.clone().addScaledVector(_T, ln * 0.5), bk = base.clone().addScaledVector(_T, -ln * 0.5);
    const l = base.clone().addScaledVector(_X, th), rr = base.clone().addScaledVector(_X, -th);
    const [b0, b1, w1] = spineWeights(s);
    const v0 = pos.length / 3;
    const nU = _U.clone(), nF = _T.clone(), nB = _T.clone().negate(), nL = _X.clone(), nR = _X.clone().negate();
    // a thin pyramid: tip, front, back, left, right (normals approximate; plates are tiny on screen)
    push(tip, nU, u, 0.0, 2, 0, b0, b1, w1);
    push(f, nF, u, 0.0, 2, 0.2, b0, b1, w1); push(bk, nB, u, 0.0, 2, 0.2, b0, b1, w1);
    push(l, nL, u, 0.0, 2, 0.3, b0, b1, w1); push(rr, nR, u, 0.0, 2, 0.3, b0, b1, w1);
    ind.push(v0, v0 + 3, v0 + 1, v0, v0 + 1, v0 + 4, v0, v0 + 2, v0 + 3, v0, v0 + 4, v0 + 2);
  }
  // swept-back frill at the back of the head (two flat fins)
  for (const side of [1, -1]) {
    const s = headS + 0.18 * S * prop.head, u = s / LEN, c = curve.getPointAt(u);
    curve.getTangentAt(u, _T);
    _U.crossVectors(_T, _X).normalize();
    const [rx] = radAt(s);
    const hs = S * prop.head;
    const root = c.clone().addScaledVector(_X, side * rx * 0.8).addScaledVector(_U, 0.12 * hs);
    const tipA = root.clone().addScaledVector(_T, -0.75 * hs).addScaledVector(_U, 0.32 * hs).addScaledVector(_X, side * 0.32 * hs);
    const tipB = root.clone().addScaledVector(_T, -0.55 * hs).addScaledVector(_U, -0.12 * hs).addScaledVector(_X, side * 0.26 * hs);
    const n = _X.clone().multiplyScalar(side).addScaledVector(_U, 0.3).normalize();
    const [b0, b1, w1] = spineWeights(s);
    const v0 = pos.length / 3;
    push(root, n, u, 0.02, 2, 0.1, b0, b1, w1); push(tipA, n, u, 0.02, 2, 0.1, b0, b1, w1); push(tipB, n, u, 0.02, 2, 0.1, b0, b1, w1);
    const nb = n.clone().negate();
    push(root, nb, u, 0.02, 2, 0.3, b0, b1, w1); push(tipA, nb, u, 0.02, 2, 0.3, b0, b1, w1); push(tipB, nb, u, 0.02, 2, 0.3, b0, b1, w1);
    if (side > 0) ind.push(v0, v0 + 1, v0 + 2, v0 + 3, v0 + 5, v0 + 4); else ind.push(v0, v0 + 2, v0 + 1, v0 + 3, v0 + 4, v0 + 5);
  }
  // legs: columnar tubes from inside the body down to the foot pads
  const LS = 12;
  legDims.forEach((L, li) => {
    const bu = idx[L.name + 'u'], bl = idx[L.name + 'l'], bf = idx[L.name + 'f'], bp = idx[L.parent];
    const g = prop.girth * S;
    // profile: [point, radius, weights (bone a, bone b, w)]
    const kneeY = L.knee.y, ankY = L.ankle.y, J = L.J;
    const prof = [
      [J.clone().add(new THREE.Vector3(0, 0.75 * S, 0)), (L.hind ? 0.92 : 0.82) * g, [bp, bu, 0.15]],
      [J.clone(), (L.hind ? 0.86 : 0.74) * g, [bp, bu, 0.7]],
      [J.clone().lerp(L.knee, 0.45), (L.hind ? 0.7 : 0.6) * g, [bu, bu, 0]],
      [J.clone().lerp(L.knee, 0.85), (L.hind ? 0.56 : 0.5) * g, [bu, bl, 0.12]],
      [L.knee.clone(), (L.hind ? 0.53 : 0.49) * g, [bu, bl, 0.5]],
      [L.knee.clone().lerp(L.ankle, 0.2), 0.49 * g, [bu, bl, 0.88]],
      [L.knee.clone().lerp(L.ankle, 0.65), 0.46 * g, [bl, bl, 0]],
      [L.ankle.clone().add(new THREE.Vector3(0, 0.1 * S, 0)), 0.47 * g, [bl, bf, 0.4]],
      [new THREE.Vector3(L.ankle.x, 0.22 * S, L.ankle.z), 0.6 * g, [bl, bf, 0.92]],
      [new THREE.Vector3(L.ankle.x, 0.08 * S, L.ankle.z + 0.04 * S), 0.66 * g, [bf, bf, 0]],
      [new THREE.Vector3(L.ankle.x, 0.0, L.ankle.z + 0.04 * S), 0.6 * g, [bf, bf, 0]],
    ];
    const v0 = pos.length / 3;
    prof.forEach(([c, rad, [ba, bb, w]], k) => {
      for (let i = 0; i <= LS; i++) {
        const a = (i / LS) * TAU;
        _n.set(Math.cos(a), 0, Math.sin(a));
        _p.copy(c).addScaledVector(_n, rad);
        // slightly darker toward the feet, the inner side shaded
        const ao = smoothstep(J.y, 0, c.y) * 0.45 + (L.side * _n.x < -0.3 ? 0.25 : 0);
        push(_p, _n, (L.hind ? 0.32 : 0.6) + 0.02 * k / prof.length, 0.5 + 0.15 * Math.cos(a), 1, ao, ba, bb, w);
      }
    });
    for (let k = 0; k < prof.length - 1; k++) for (let i = 0; i < LS; i++) {
      const a = v0 + k * (LS + 1) + i, b = a + 1, c = a + LS + 1, d = c + 1;
      ind.push(a, b, c, b, d, c);
    }
    // sole cap
    const cIdx = pos.length / 3;
    push(prof[prof.length - 1][0], new THREE.Vector3(0, -1, 0), 0.32, 0.5, 1, 0.6, bf, bf, 0);
    const lastRing = v0 + (prof.length - 1) * (LS + 1);
    for (let i = 0; i < LS; i++) ind.push(cIdx, lastRing + i + 1, lastRing + i);
    void kneeY; void ankY; void li;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('aHide', new THREE.Float32BufferAttribute(hide, 4));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(sIdx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sW, 4));
  geo.setIndex(ind);
  geo.computeBoundingSphere();
  const pel = rest[idx.pelvis].world;
  const oSh = new THREE.Vector2(legDims[2].J.y - pel.y, legDims[2].J.z - pel.z); // pelvis -> shoulder joints (y, z)
  return {
    geometry: geo, rest, idx, legs: legDims,
    shLen: oSh.length(), shAng: Math.atan2(oSh.x, oSh.y), hipOff: legDims[0].J.y - pel.y, pelvisZ: pel.z,
    hipH: legDims[0].J.y, shoulderH: legDims[2].J.y,
    hipZ: legDims[0].J.z, shoulderZ: legDims[2].J.z,
    pelvisAboveHip: rest[idx.pelvis].world.y - legDims[0].J.y,
    chestRestY: rest[idx.chest].world.y,
    height: P[HEAD0 + 1].y, length: LEN, scale: S,
  };
}

/* ------------------------------------------------------------------ */
/* Hide: countershading, saddle stripes, pale throat, lichen; A = glow   */
/* ------------------------------------------------------------------ */
function paintHide(seed) {
  const W = 256, H = 128;
  const n = createNoise(seed);
  const rng = makeRng(seed + 3);
  const c = makeCanvas(W, H), g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const glow = new Float32Array(W * H);
  // glowing lichen spots: two rows along the back, from the hips to the neck base
  const spots = [];
  for (let k = 0; k < 46; k++) spots.push([rng.range(0.24, 0.66) * W, (rng.chance(0.5) ? rng.range(0.03, 0.13) : rng.range(0.87, 0.97)) * H, rng.range(1.2, 2.6)]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const dors = 0.5 + 0.5 * Math.cos(v * TAU);          // 1 on the back, 0 on the belly
    const mott = n.fbm2(u * 22, v * 6, 3) * 0.5 + 0.5;
    // base countershading: dark olive back, warm grey flanks, pale belly
    let r = lerp(0.8, 0.33, Math.pow(dors, 0.8)), gg = lerp(0.76, 0.33, Math.pow(dors, 0.8)), b = lerp(0.62, 0.25, Math.pow(dors, 0.8));
    // saddle stripes over the back and down the flanks (torso and tail), slightly wavy
    const body = smoothstep(0.08, 0.2, u) * (1 - smoothstep(0.58, 0.66, u));
    const st = Math.sin((u * 46 + n.noise2(u * 6, v * 3) * 0.6) * Math.PI);
    const stripe = smoothstep(0.35, 0.75, st) * smoothstep(0.25, 0.75, dors) * body;
    r *= 1 - 0.38 * stripe; gg *= 1 - 0.36 * stripe; b *= 1 - 0.3 * stripe;
    // pale throat and chin, a darker mask over the eyes
    const throat = smoothstep(0.62, 0.72, u) * smoothstep(0.55, 0.15, dors);
    r = lerp(r, 0.86, throat * 0.6); gg = lerp(gg, 0.82, throat * 0.6); b = lerp(b, 0.7, throat * 0.6);
    const mask = smoothstep(0.93, 0.96, u) * (1 - smoothstep(0.985, 1.0, u)) * smoothstep(0.3, 0.7, dors);
    r *= 1 - 0.35 * mask; gg *= 1 - 0.35 * mask; b *= 1 - 0.3 * mask;
    // lichen / moss mottling on the back, weathered skin everywhere
    const moss = smoothstep(0.55, 0.8, mott) * smoothstep(0.45, 0.9, dors) * body;
    r = lerp(r, 0.36, moss * 0.55); gg = lerp(gg, 0.46, moss * 0.55); b = lerp(b, 0.22, moss * 0.55);
    const w = 0.88 + 0.24 * mott;
    const k = (y * W + x) * 4;
    img.data[k] = clamp(r * w, 0, 1) * 255; img.data[k + 1] = clamp(gg * w, 0, 1) * 255; img.data[k + 2] = clamp(b * w, 0, 1) * 255; img.data[k + 3] = 255;
  }
  for (const [sx, sy, sr] of spots) {
    for (let y = Math.floor(sy - sr - 2); y <= sy + sr + 2; y++) for (let x = Math.floor(sx - sr - 2); x <= sx + sr + 2; x++) {
      const yy = ((y % H) + H) % H, xx = clamp(x, 0, W - 1);
      const d = Math.hypot(x + 0.5 - sx, y + 0.5 - sy);
      glow[yy * W + xx] = Math.max(glow[yy * W + xx], clamp((sr + 0.8 - d) / 1.6, 0, 1));
    }
  }
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { data[i * 4] = img.data[i * 4]; data[i * 4 + 1] = img.data[i * 4 + 1]; data[i * 4 + 2] = img.data[i * 4 + 2]; data[i * 4 + 3] = Math.round(glow[i] * 255); }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace; // painted in sRGB, decoded in the shader (keeps mipmaps under WebGL 1)
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Material: open-air light, haze and mist, glowing lichen at night     */
/* ------------------------------------------------------------------ */
function giantMaterial(shared, vistaU, hideTex) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, ...vistaU, tHide: { value: hideTex } },
    vertexShader: /* glsl */`
      #include <common>
      #include <skinning_pars_vertex>
      attribute vec4 aHide;
      varying vec3 vWorldP; varying vec3 vN; varying vec4 vHide;
      void main(){
        #include <skinbase_vertex>
        #include <beginnormal_vertex>
        #include <skinnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        vWorldP = wp.xyz;
        vN = normalize(mat3(modelMatrix) * objectNormal);
        vHide = aHide;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      ${JG_GLSL}
      ${VISTA_GLSL}
      uniform sampler2D tHide;
      varying vec3 vN; varying vec4 vHide;
      void main(){
        vec4 h = texture2D(tHide, vHide.xy);
        vec3 albedo = h.rgb * h.rgb;
        if (vHide.z > 1.5) albedo = albedo * vec3(0.72, 0.66, 0.52);        // plates and frill: darker horn
        else if (vHide.z > 0.5) albedo = albedo * vec3(0.82, 0.78, 0.7);   // legs
        vec3 N = normalize(vN);
        vec3 V = normalize(cameraPosition - vWorldP);
        float ao = 1.0 - 0.55 * vHide.w;
        vec3 col = vistaLight(albedo, N, V, ao, 0.45);
        // glowing lichen on the back at night: a slow wave of light travelling along the body (never a flash)
        col += uFarGlow * h.a * uNight * (0.55 + 0.45 * sin(uGlowPh - vHide.x * 7.0)) * 1.6;
        vec3 d = vWorldP - cameraPosition;
        float tSurf = length(d);
        gl_FragColor = vec4(vistaAtmos(col, vWorldP, tSurf, d / tSurf), 1.0);
      }`,
  });
}

/* ------------------------------------------------------------------ */
/* One animal                                                           */
/* ------------------------------------------------------------------ */
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _H = new THREE.Vector3(), _F = new THREE.Vector3(), _K = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qu = new THREE.Quaternion(), _ql = new THREE.Quaternion();
const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _e = new THREE.Euler();
const _fwd = new THREE.Vector3(), _side = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const DUTY = 0.7;

/** Quaternion that turns the frame (down0, fwd0) into (down1, fwd1). */
function frameQuat(out, down1, fwd1, restInv) {
  _y.copy(down1).negate().normalize();                 // bone "up" = minus its downward axis
  _z.copy(fwd1).addScaledVector(_y, -fwd1.dot(_y)).normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  out.setFromRotationMatrix(_m);
  return out.multiply(restInv);
}

class Giant {
  constructor(kit, material, rng, role) {
    this.kit = kit; this.rng = rng; this.role = role;
    this.bones = kit.rest.map(r => { const b = new THREE.Bone(); b.name = r.name; b.position.copy(r.pos); return b; });
    kit.rest.forEach((r, i) => { if (r.parent >= 0) this.bones[r.parent].add(this.bones[i]); });
    this.mesh = new THREE.SkinnedMesh(kit.geometry, material);
    this.mesh.name = 'giant-' + role;
    this.mesh.add(this.bones[0]);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.visible = false;
    const B = n => this.bones[kit.idx[n]];
    this.b = {
      pelvis: B('pelvis'), spine: [B('spine1'), B('spine2'), B('spine3')], chest: B('chest'),
      neck: [0, 1, 2, 3, 4, 5].map(i => B('neck' + i)), head: B('head'), tail: [0, 1, 2, 3, 4, 5].map(i => B('tail' + i)),
    };
    this.legs = kit.legs.map(L => {
      const u = B(L.name + 'u'), l = B(L.name + 'l'), f = B(L.name + 'f');
      // rest frames of the two leg bones (their downward axis and forward), inverted once
      const dU = L.knee.clone().sub(L.J).normalize(), dL = L.ankle.clone().sub(L.knee).normalize();
      const restU = frameQuat(new THREE.Quaternion(), dU, new THREE.Vector3(0, 0, 1), new THREE.Quaternion()).invert();
      const restL = frameQuat(new THREE.Quaternion(), dL, new THREE.Vector3(0, 0, 1), new THREE.Quaternion()).invert();
      return { def: L, u, l, f, a: L.a, b: L.b, restU, restL, foot: new THREE.Vector3(), lift: new THREE.Vector3(), target: new THREE.Vector3(), stance: true, inited: false };
    });
    // own rhythm: phases, sway and browse timing
    this.pos = new THREE.Vector3();   // ground point under the body centre (the mesh origin)
    this.yaw = 0;
    this.phase = rng.next();
    this.v = 1.2;
    this.neckPh = rng.next() * TAU; this.tailPh = rng.next() * TAU; this.lookPh = rng.next() * TAU;
    this.browse = 0; this.browseT = rng.range(6, 16); this.browsing = 0;
    this.hHind = kit.hipH; this.hFront = kit.shoulderH;
  }
  /** Stride length at speed v (m): about 0.85 hip heights at a slow walk, longer when faster (so a small animal
   * at the same speed steps more often). */
  stride(v) { return this.kit.hipH * 0.85 * Math.pow(Math.max(v, 0.2) / 1.3, 0.45); }
}

/* ------------------------------------------------------------------ */
/* The family and its schedule                                         */
/* ------------------------------------------------------------------ */
/**
 * @param shared  jungle shared uniforms; @param vistaU far-vista uniforms
 * @param land    { groundAt(x, z), lane(variant, dir, rng) -> { length, at(s, out) -> Vector3 (ground point), dirAt(s, out) } }
 * @param rng     seeded stream for the schedule and the animals
 */
export function createGiants(shared, vistaU, land, rng) {
  const hide = paintHide(Math.floor(rng.next() * 1e6));
  const material = giantMaterial(shared, vistaU, hide);
  const adultKit = buildBody(11, { scale: 0.8, neck: 1, head: 1, tail: 1, girth: 1, leg: 1 });
  const youngKit = buildBody(12, { scale: 0.47, neck: 0.86, head: 1.3, tail: 0.92, girth: 1.06, leg: 1.04 });
  const group = new THREE.Group();
  group.name = 'giants';
  const roles = [['lead', adultKit], ['young', youngKit], ['second', adultKit]];
  const herd = roles.map(([role, kit], i) => new Giant(kit, material, rng.fork('giant' + i), role));
  herd.forEach(g => group.add(g.mesh));
  group.visible = false;
  group.matrixWorldAutoUpdate = false;

  const sched = { next: rng.range(20, 45), pass: null, count: 0, rng: rng.fork('passes') };
  const P = { lane: null, s: 0, v: 1.3, t: 0, members: [] };

  function startPass(now) {
    const r = sched.rng;
    sched.count++;
    const dir = r.chance(0.5) ? 1 : -1;
    const variant = r.int(0, 2);
    const lane = land.lane(variant, dir, r);
    const n = r.chance(0.7) ? 3 : 2;
    const spacing = r.range(15, 19);
    // speed chosen so the whole family crosses in 40–90 s
    const want = r.range(55, 78);
    const v = clamp((lane.length + spacing * 0.9) / want, 1.2, 1.8);
    P.lane = lane; P.v = v; P.t = 0;
    P.members = [];
    for (let i = 0; i < n; i++) {
      const g = herd[i];
      // the young walks beside / just behind its mother, the second adult a little further back: each sets off from
      // the start of the path (hidden in the valley behind the ridge) when its place in the file comes by
      const back = i === 0 ? 0 : i === 1 ? spacing * r.range(0.45, 0.6) : spacing * r.range(0.85, 1.0);
      const lat = i === 0 ? r.range(-0.8, 0.8) : i === 1 ? r.range(2.2, 2.9) * (r.chance(0.5) ? 1 : -1) : r.range(-1.2, 1.2);
      g.s = 0; g.delay = back / v; g.back = back; g.lat = lat; g.latT = lat; g.vMul = 1; g.mood = r.next() * TAU;
      g.browse = 0; g.browsing = 0; g.browseT = r.range(4, 14) + i * 3;
      g.v = v; g.phase = r.next();
      g.legs.forEach(L => { L.inited = false; L.uSw = 0; });
      g.fresh = true; g.hindZ = g.kit.hipZ; g.frontZ = g.kit.shoulderZ;
      g.mesh.visible = true;
      g.active = true;
      P.members.push(g);
    }
    group.visible = true;
    group.matrixWorldAutoUpdate = true;
    sched.pass = { start: now };
  }
  function endPass(now) {
    for (const g of herd) { g.mesh.visible = false; g.active = false; }
    group.visible = false;
    group.matrixWorldAutoUpdate = false;
    sched.pass = null;
    // the next pass 3–5 minutes after this one began
    sched.next = Math.max(now + 30, (sched.lastStart ?? now) + sched.rng.range(180, 300));
  }

  /** Ground point and heading of the path at arc s, offset sideways by lat (body yaw = path direction). */
  const pathPose = (s, lat, outP) => {
    P.lane.at(s, outP);
    P.lane.dirAt(s, _fwd);
    _side.set(_fwd.z, 0, -_fwd.x); // left of the heading
    outP.addScaledVector(_side, lat);
    outP.y = land.groundAt(outP.x, outP.z);
    return Math.atan2(_fwd.x, _fwd.z);
  };

  function updateAnimal(g, dt, t) {
    const kit = g.kit, S = kit.scale;
    // speed: the family pace, the follower keeping its place, its own slow surges, slower while browsing
    const lead = P.members[0];
    let v = P.v * (1 + 0.06 * Math.sin(t * 0.21 + g.mood));
    if (g !== lead) v += clamp((g.s - (lead.s - g.back)) * -0.08, -0.35, 0.35);
    v *= 1 - 0.3 * g.browse;
    g.v = damp(g.v, v, 1.5, dt);
    g.s += g.v * dt;
    g.lat = damp(g.lat, g.latT + Math.sin(t * 0.11 + g.mood) * 0.8, 0.5, dt);
    g.yaw = pathPose(g.s, g.lat, g.pos);
    g.mesh.position.copy(g.pos);
    g.mesh.rotation.set(0, g.yaw, 0);
    // gait clock: cadence = speed / stride
    const lam = g.stride(g.v);
    const f = g.v / lam;
    g.phase = (g.phase + f * dt) % 1;
    // browsing: now and then the head goes down to the shrubs for a few seconds
    g.browseT -= dt;
    if (g.browseT <= 0) { g.browsing = g.browsing ? 0 : 1; g.browseT = g.browsing ? g.rng.range(4.5, 8) : g.rng.range(9, 20); }
    g.browse = damp(g.browse, g.browsing, 0.9, dt);
    // feet: planted in world space during stance; in swing they go from lift-off to the predicted touch-down point
    const stanceLen = DUTY * lam;
    const sinY = Math.sin(g.yaw), cosY = Math.cos(g.yaw);
    for (const L of g.legs) {
      const D = L.def;
      const psi = ((g.phase - D.off) % 1 + 1) % 1;
      const stance = psi < DUTY;
      const xOff = D.J.x;
      // where a swinging foot lands: under its joint, half a stance ahead, on the body's pose at touch-down time
      // (predicted along the path; a foot in stance keeps the spot it landed on)
      if (!stance) {
        const sT = g.s + g.v * (1 - psi) / f;
        const yT = pathPose(sT, g.lat, _v);
        const zOff = (D.hind ? g.hindZ : g.frontZ) + stanceLen * 0.5, sT2 = Math.sin(yT), cT2 = Math.cos(yT);
        L.target.set(_v.x + cT2 * xOff + sT2 * zOff, 0, _v.z - sT2 * xOff + cT2 * zOff);
        L.target.y = land.groundAt(L.target.x, L.target.z);
      }
      if (!L.inited) {
        // first frame of a pass: put the foot where it would be at this phase of the cycle
        const along = stance ? (0.5 - psi / DUTY) * stanceLen : (-0.5 + (psi - DUTY) / (1 - DUTY)) * stanceLen;
        const zz = D.J.z + along;
        L.foot.set(g.pos.x + cosY * xOff + sinY * zz, 0, g.pos.z - sinY * xOff + cosY * zz);
        L.foot.y = land.groundAt(L.foot.x, L.foot.z);
        L.lift.copy(L.foot);
        if (!stance) L.lift.addScaledVector(_v.set(sinY, 0, cosY), -(psi - DUTY) / (1 - DUTY) * stanceLen);
        L.stance = stance; L.inited = true;
      }
      if (stance) {
        L.uSw = 0;
        if (!L.stance) { L.foot.copy(L.target); L.stance = true; } // touch-down exactly on the target
      } else {
        if (L.stance) { L.lift.copy(L.foot); L.stance = false; }   // lift-off from where it stood
        const u = (psi - DUTY) / (1 - DUTY);
        L.uSw = u;
        const e = u * u * u * (u * (u * 6 - 15) + 10);             // smootherstep: lands with zero speed
        L.foot.lerpVectors(L.lift, L.target, e);
        L.foot.y += Math.sin(Math.PI * Math.min(u * 1.15, 1)) * 0.5 * S * (0.8 + 0.2 * g.v);
      }
    }
    // body height: each pair of joints (hips, shoulders) rides as high as its feet allow: for every foot on the
    // ground (and a swinging foot more and more as it comes down) the joint can be at most a nearly straight leg
    // above it, given how far the foot is from under the joint. The lowest of these wins, so the body vaults over
    // a leg in mid-stance, settles in double support, and on a side slope rides on the downhill leg.
    const sinY0 = Math.sin(g.yaw), cosY0 = Math.cos(g.yaw);
    const footY = L => L.stance ? L.foot.y : lerp(L.lift.y, L.target.y, smoothstep(0.25, 0.85, L.uSw));
    const pairH = (La, Lb) => {
      let h = Infinity;
      for (const L of [La, Lb]) {
        const J = L.def.J, jzB = L.def.hind ? g.hindZ : g.frontZ;
        const jx = g.pos.x + cosY0 * J.x + sinY0 * jzB, jz = g.pos.z - sinY0 * J.x + cosY0 * jzB;
        const reach = (L.a + L.b) * 0.99;
        // a swinging foot's landing spot binds more and more as it comes down (relaxed by up to ~1.4 m before that)
        const w = L.stance ? 1 : smoothstep(0.05, 0.8, L.uSw);
        const F = L.stance ? L.foot : L.target;
        const dxz = Math.min(Math.hypot(F.x - jx, F.z - jz), reach * 0.8);
        const c = F.y + ANKLE_H * S + Math.sqrt(reach * reach - dxz * dxz) + (1 - w) * 0.8 * S;
        h = Math.min(h, c);
      }
      return h;
    };
    const hindT = pairH(g.legs[0], g.legs[1]), frontT = pairH(g.legs[2], g.legs[3]);
    if (g.fresh) { g.hHind = hindT; g.hFront = frontT; g.fresh = false; }
    // follow quickly down (a foot must never be out of reach), a little more gently up
    g.hHind = damp(g.hHind, hindT, hindT < g.hHind ? 30 : 10, dt);
    g.hFront = damp(g.hFront, frontT, frontT < g.hFront ? 30 : 10, dt);
    const gr0 = g.pos.y;
    const yHip = g.hHind, ySh = g.hFront;
    // pitch the body about the pelvis so the shoulder joints land exactly at their ride height (the vector pelvis ->
    // shoulder turns by the pitch); remember where the joints now sit along the body for the next foot targets
    const pelY = yHip - kit.hipOff;
    const pitchX = kit.shAng - Math.asin(clamp((ySh - pelY) / kit.shLen, -0.95, 0.95));
    g.frontZ = kit.pelvisZ + kit.shLen * Math.cos(kit.shAng - pitchX);
    g.hindZ = kit.pelvisZ + kit.hipOff * Math.sin(pitchX);
    // sway toward the stance side, roll with the stride and a little with a side slope
    const slopeRoll = Math.atan2(footY(g.legs[1]) + footY(g.legs[3]) - footY(g.legs[0]) - footY(g.legs[2]), 4 * Math.abs(g.legs[0].def.J.x)) * 0.25;
    const sway = Math.sin(TAU * (g.phase - 0.12)) * 0.06 * S;
    const roll = Math.sin(TAU * (g.phase - 0.05)) * 0.025 - clamp(slopeRoll, -0.08, 0.08); // the uphill side a little higher
    const pb = g.b.pelvis;
    pb.position.set(sway, pelY - gr0, kit.pelvisZ);
    pb.rotation.set(pitchX, Math.sin(TAU * (g.phase - 0.3)) * 0.02, roll, 'YXZ');
    // spine: a little flex with the stride; chest steadied
    for (let i = 0; i < 3; i++) g.b.spine[i].rotation.set(Math.sin(TAU * (g.phase * 2) + i) * 0.006, -Math.sin(TAU * (g.phase - 0.3)) * 0.008, -roll * 0.25);
    g.b.chest.rotation.set(0, 0, -roll * 0.3);
    // neck: posture, browse, a slow travelling S-sway and a gentle bob with the stride
    const nb = g.browse;
    const bend = [0.2, 0.24, 0.25, 0.23, 0.19, 0.12];
    for (let i = 0; i < 6; i++) {
      const sw = Math.sin(t * 0.55 + g.neckPh - i * 0.45) * 0.035 + Math.sin(t * 0.23 + g.lookPh) * 0.03;
      g.b.neck[i].rotation.set(bend[i] * nb * 1.08 + Math.sin(TAU * g.phase * 2 + 0.6) * 0.008 - 0.012, sw * (1 - 0.5 * nb), 0, 'YXZ');
    }
    // the head stays steadier than the neck (a little counter-sway), dips further while browsing
    g.b.head.rotation.set(0.38 * nb - 0.04 * Math.sin(t * 0.37 + g.lookPh), -Math.sin(t * 0.55 + g.neckPh - 2.7) * 0.05 + Math.sin(t * 0.19 + g.lookPh * 1.3) * 0.12 * (1 - nb), 0, 'YXZ');
    // tail: a wave travelling to the tip with the stride, plus a slow drift; carried a little higher when walking
    for (let i = 0; i < 6; i++) {
      const k = (i + 1) / 6;
      const w = Math.sin(TAU * g.phase - i * 0.55 + g.tailPh) * 0.05 * (0.35 + 0.65 * k) + Math.sin(t * 0.31 + g.tailPh - i * 0.5) * 0.03 * k;
      g.b.tail[i].rotation.set(-0.012 + Math.sin(TAU * g.phase * 2 - i * 0.6) * 0.006, w, 0, 'YXZ');
    }
    // legs: two-bone IK from the joints to the feet (after the body pose is in place)
    g.mesh.updateMatrixWorld(true);
    for (const L of g.legs) solveLeg(g, L);
  }

  function solveLeg(g, L) {
    const D = L.def, S = g.kit.scale;
    L.u.parent.getWorldQuaternion(_qp);
    L.u.getWorldPosition(_H);
    _F.copy(L.foot); _F.y += ANKLE_H * S;
    _v.subVectors(_F, _H);
    let d = _v.length();
    const a = L.a, b = L.b;
    d = clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-4);
    _v.normalize();
    // bend plane: the body's forward (knees forward on the hind legs, elbows back on the fore legs)
    _fwd.set(Math.sin(g.yaw), 0, Math.cos(g.yaw));
    const pole = D.hind ? 1 : -1;
    _v2.copy(_fwd).multiplyScalar(pole).addScaledVector(_v, -_fwd.dot(_v) * pole).normalize();
    const x = (a * a - b * b + d * d) / (2 * d), y = Math.sqrt(Math.max(a * a - x * x, 0));
    _K.copy(_H).addScaledVector(_v, x).addScaledVector(_v2, y);
    // upper bone: world rotation from its rest frame to (knee - hip), then into the parent's space
    _v3.subVectors(_K, _H).normalize();
    frameQuat(_qu, _v3, _fwd, L.restU);
    L.u.quaternion.copy(_qp).invert().multiply(_qu);
    // lower bone
    _v3.subVectors(_F, _K).normalize();
    frameQuat(_ql, _v3, _fwd, L.restL);
    L.l.quaternion.copy(_qu).invert().multiply(_ql);
    // foot: flat on the ground, facing the way the body goes (rolls a little during the swing)
    _q.setFromAxisAngle(UP, g.yaw);
    L.f.quaternion.copy(_ql).invert().multiply(_q);
  }

  const api = {
    group, herd, material, hide,
    get active() { return !!sched.pass; },
    get nextIn() { return sched.next; },
    get _laneLen() { return P.lane ? P.lane.length : 0; },
    /** Advance the schedule and the animals. now = the world clock (s since the world opened). */
    update(dt, t, now) {
      if (!sched.pass) {
        if (now >= sched.next) { sched.lastStart = now; startPass(now); }
        else return;
      }
      P.t += dt;
      for (const g of P.members) {
        // each animal sets off when its place in the file comes by, and leaves once it reaches the end of the path
        // (both ends lie in the valley behind the ridge, below the crest line seen from the clearing)
        const out = P.t < g.delay || g.s > P.lane.length;
        g.mesh.visible = !out;
        if (!out) updateAnimal(g, dt, t);
      }
      // the pass ends once the last animal has walked off the lane (behind the ridge, out of sight)
      let done = true;
      for (const g of P.members) if (P.t < g.delay || g.s <= P.lane.length) done = false;
      if (done || P.t > 150) endPass(now);
    },
    /** Test hook: start a pass now and fast-forward it by `ahead` seconds (variant / dir optional). */
    debug(now, t, ahead = 30, opts = {}) {
      if (sched.pass) endPass(now);
      sched.lastStart = now;
      if (opts.variant !== undefined || opts.dir !== undefined) {
        const r = sched.rng;
        const keep = land.lane;
        land.lane = (variant, dir, rr) => keep(opts.variant ?? variant, opts.dir ?? dir, rr);
        startPass(now);
        land.lane = keep;
      } else startPass(now);
      for (let k = 0; k < ahead * 30; k++) { P.t += 1 / 30; for (const g of P.members) { g.mesh.visible = P.t >= g.delay && g.s <= P.lane.length; if (g.mesh.visible) updateAnimal(g, 1 / 30, t - ahead + k / 30); } }
      return { members: P.members.map(g => ({ role: g.role, pos: g.pos.toArray().map(x => +x.toFixed(1)), s: +g.s.toFixed(1) })), lane: +P.lane.length.toFixed(1), v: +P.v.toFixed(2) };
    },
    /** World positions of the animals that are out, for the egrets and the camera tests. */
    positions(out) { out.length = 0; if (sched.pass) for (const g of P.members) out.push(g.pos); return out; },
    dispose() { hide.dispose(); material.dispose(); adultKit.geometry.dispose(); youngKit.geometry.dispose(); herd.forEach(g => g.mesh.skeleton.dispose()); },
  };
  return api;
}
