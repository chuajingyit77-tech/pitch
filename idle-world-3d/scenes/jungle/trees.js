// Giant buttress-rooted trees, limbs, lianas, aerial roots and canopy foliage clumps.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, createNoise, makeRng } from '../../lib/util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _b = new THREE.Vector3();

/** Tapered tube along a curve; radius(t) callback. Adds a `color` attribute (tint). */
export function taperTube(curve, radius, { tubular = 24, radial = 8, tint = [1, 1, 1], tintFn = null, uvScale = [1, 0.5], closed = false } = {}) {
  const frames = curve.computeFrenetFrames(tubular, closed);
  const pos = [], nor = [], uv = [], col = [], idx = [];
  const len = curve.getLength();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    const P = curve.getPointAt(t);
    const N = frames.normals[i], B = frames.binormals[i];
    const r = radius(t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const s = Math.sin(a), c = -Math.cos(a);
      _n.set(c * N.x + s * B.x, c * N.y + s * B.y, c * N.z + s * B.z).normalize();
      pos.push(P.x + r * _n.x, P.y + r * _n.y, P.z + r * _n.z);
      nor.push(_n.x, _n.y, _n.z);
      uv.push((j / radial) * uvScale[0], t * len * uvScale[1]);
      const tc = tintFn ? tintFn(t, _n) : tint;
      col.push(tc[0], tc[1], tc[2]);
    }
  }
  for (let i = 0; i < tubular; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = (i + 1) * (radial + 1) + j, c = (i + 1) * (radial + 1) + j + 1, d = i * (radial + 1) + j + 1;
    idx.push(a, b, d, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Giant rainforest tree trunk with plank buttress roots. Returns { geometry, axis(y) }.
 * Positioned at origin; caller translates.
 */
export function buildTrunk(seed, { height = 26, r0 = 1.0, fins = 6, finLen = 3, finH = 3.6, lean = [0.02, 0.01], q = 1 } = {}) {
  const rng = makeRng(seed);
  const n = createNoise(seed);
  const finA = [], finL = [], finHh = [];
  const a0 = rng.next() * TAU;
  for (let k = 0; k < fins; k++) {
    finA.push(a0 + (k / fins) * TAU + rng.range(-0.3, 0.3));
    finL.push(finLen * rng.range(0.55, 1.15));
    finHh.push(finH * rng.range(0.7, 1.2));
  }
  // angular samples: uniform + dense around each fin
  const offs = [0, 0.012, 0.026, 0.045, 0.07, 0.11, 0.17, 0.26];
  let angles = [];
  const base = Math.round(36 * Math.max(0.6, q));
  for (let i = 0; i < base; i++) angles.push((i / base) * TAU);
  for (const fa of finA) for (const o of offs) { angles.push(((fa + o) % TAU + TAU) % TAU); if (o) angles.push(((fa - o) % TAU + TAU) % TAU); }
  angles.sort((x, y) => x - y);
  angles = angles.filter((a, i) => i === 0 || a - angles[i - 1] > 0.006);
  const NR = angles.length;
  const rings = [];
  const NY = Math.round(54 * Math.max(0.6, q));
  for (let j = 0; j <= NY; j++) { const t = j / NY; rings.push(-0.8 + Math.pow(t, 1.7) * (height + 0.8)); }
  const axis = y => [lean[0] * y + 0.35 * Math.sin(y * 0.13 + seed), lean[1] * y + 0.3 * Math.cos(y * 0.11 + seed * 0.7)];
  const rTrunk = y => r0 * (1 + 0.32 * Math.exp(-Math.max(y, 0) / 2.2)) * (1 - 0.42 * clamp(y / height, 0, 1));
  const pos = [], uv = [], col = [], idx = [];
  const circ = Math.max(1, Math.round((TAU * r0) / 2.4));
  for (let j = 0; j < rings.length; j++) {
    const y = rings[j];
    const [cx, cz] = axis(y);
    const rt = rTrunk(y);
    for (let i = 0; i <= NR; i++) {
      const th = angles[i % NR] + (i === NR ? TAU : 0);
      let e = 0;
      for (let k = 0; k < fins; k++) {
        const fa = finA[k] + 0.07 * Math.sin(y * 0.9 + k * 1.7);
        let d = th - fa; d = ((d + Math.PI) % TAU + TAU) % TAU - Math.PI;
        const yy = Math.max(y, 0);
        const ext = finL[k] * Math.pow(clamp(1 - yy / finHh[k], 0, 1), 1.9) * (y < 0 ? 1 + (-y) * 0.25 : 1);
        if (ext <= 0) continue;
        const R = rt + ext;
        const halfT = 0.16 + 0.1 * (1 - clamp(yy / finHh[k], 0, 1));
        const s = Math.abs(d) * R / halfT;
        const plate = s < 1 ? ext * Math.sqrt(1 - s * s) : 0;
        const fillet = 0.35 * rt * (ext / finLen) * Math.exp(-Math.pow(d / 0.32, 2));
        e = Math.max(e, plate + fillet);
      }
      const bump = 1 + 0.05 * n.noise2(th * 3, y * 0.6) + 0.025 * n.noise2(th * 9, y * 2);
      const r = (rt + e) * bump;
      pos.push(cx + Math.cos(th) * r, y, cz + Math.sin(th) * r);
      uv.push((th / TAU) * circ, y / 2.4);
      const moss = clamp(Math.exp(-Math.max(y, 0) / 4.5) * 0.7 + (n.noise2(th * 1.5, y * 0.25) * 0.5 + 0.2), 0, 1);
      const dark = smoothstep(0.6, -0.4, y);
      col.push(lerp(1, 0.62, moss) * (1 - dark * 0.5), lerp(1, 1.12, moss) * (1 - dark * 0.5), lerp(1, 0.5, moss) * (1 - dark * 0.5));
    }
  }
  const W = NR + 1;
  for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < NR; i++) {
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, axis, rTrunk };
}

/**
 * A tree = trunk + limbs. Returns { geometry (bark), limbs: [{curve, r0, r1}], perches: [{pos, tangent}], hangs: [Vector3] }.
 */
export function buildTree(seed, at, opts = {}) {
  const rng = makeRng(seed + 101);
  const { geometry, axis, rTrunk } = buildTrunk(seed, opts);
  const height = opts.height || 26;
  geometry.translate(at.x, at.y, at.z);
  const parts = [geometry];
  const limbs = [], perches = [], hangs = [];
  const nL = opts.limbs ?? 4;
  const towards = opts.towards ?? 0; // preferred azimuth for limbs (toward the clearing)
  for (let k = 0; k < nL; k++) {
    const y0 = lerp(opts.limbMin ?? 10, opts.limbMax ?? height * 0.85, (k + rng.next() * 0.6) / nL);
    const [cx, cz] = axis(y0);
    const az = towards + rng.range(-1.2, 1.2) * (k % 2 ? 1 : -1) * 0.8 + (k === 0 ? 0 : rng.range(-0.6, 0.6));
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const L = rng.range(opts.limbLen?.[0] ?? 6, opts.limbLen?.[1] ?? 10);
    const rise = rng.range(0.6, 2.4);
    const P0 = new THREE.Vector3(at.x + cx, at.y + y0, at.z + cz);
    const pts = [
      P0.clone().addScaledVector(dir, -0.3),
      P0.clone().addScaledVector(dir, L * 0.3).add(_v.set(0, rise * 0.45, 0)),
      P0.clone().addScaledVector(dir, L * 0.62).add(_v.set(rng.range(-0.6, 0.6), rise * 0.65, rng.range(-0.6, 0.6))),
      P0.clone().addScaledVector(dir, L).add(_v.set(rng.range(-0.8, 0.8), rise * 0.75 + rng.range(-0.6, 1.4), rng.range(-0.8, 0.8))),
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    const r0 = rTrunk(y0) * rng.range(0.32, 0.42), r1 = 0.08;
    parts.push(taperTube(curve, t => lerp(r0, r1, Math.pow(t, 0.8)), { tubular: 20, radial: 9, tintFn: (t, nn) => { const m = clamp(nn.y, 0, 1); return [lerp(1, 0.6, m), lerp(1, 1.15, m), lerp(1, 0.45, m)]; }, uvScale: [2, 0.4] }));
    limbs.push({ curve, r0, r1 });
    for (let s = 0.25; s < 0.92; s += 0.12) {
      const p = curve.getPointAt(s), tg = curve.getTangentAt(s);
      if (Math.abs(tg.y) < 0.45) perches.push({ pos: p.clone().add(_v.set(0, lerp(r0, r1, Math.pow(s, 0.8)) * 0.9, 0)), tangent: tg.clone().setY(0).normalize(), r: lerp(r0, r1, Math.pow(s, 0.8)) });
      hangs.push(p.clone());
    }
    // a couple of twigs
    for (let tw = 0; tw < 2; tw++) {
      const s = rng.range(0.45, 0.85);
      const p = curve.getPointAt(s);
      const tdir = dir.clone().applyAxisAngle(_b.set(0, 1, 0), rng.range(-1.3, 1.3));
      const tl = rng.range(1.5, 3.2);
      const c2 = new THREE.CatmullRomCurve3([p.clone(), p.clone().addScaledVector(tdir, tl * 0.5).add(_v.set(0, tl * 0.25, 0)), p.clone().addScaledVector(tdir, tl).add(_v.set(0, tl * 0.55, 0))]);
      parts.push(taperTube(c2, t => lerp(0.1, 0.03, t), { tubular: 6, radial: 5, uvScale: [1, 0.5] }));
      hangs.push(c2.getPointAt(1));
    }
  }
  const merged = mergeGeometries(parts.map(p => { const g = p.index ? p : p; if (!g.attributes.normal) g.computeVertexNormals(); return g; }));
  parts.forEach(p => p.dispose());
  return { geometry: merged, limbs, perches, hangs, axis: y => { const [x, z] = axis(y); return new THREE.Vector3(at.x + x, at.y + y, at.z + z); }, rTrunk };
}

/** Hanging liana (sagging between two points) or a drop liana (from a point down toward the ground). */
export function lianaCurve(a, b, sag) {
  const pts = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const p = a.clone().lerp(b, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  return new THREE.CatmullRomCurve3(pts);
}
export function dropCurve(a, groundY, rng) {
  const pts = [];
  const len = a.y - groundY;
  const dx = rng.range(-1, 1), dz = rng.range(-1, 1);
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    pts.push(new THREE.Vector3(a.x + dx * Math.sin(t * 2.2) * 0.6 + Math.sin(t * 9) * 0.08, a.y - len * t, a.z + dz * Math.sin(t * 2.2) * 0.6 + Math.cos(t * 7) * 0.08));
  }
  // curl on the ground
  const e = pts[pts.length - 1];
  pts.push(e.clone().add(new THREE.Vector3(dx * 0.6, 0.05, dz * 0.6)));
  return new THREE.CatmullRomCurve3(pts);
}

/** Canopy foliage clump: random cards around a centre (object space, radius ~1, base at y=0). */
export function buildClump(seed, cards = 9) {
  const rng = makeRng(seed);
  const parts = [];
  for (let i = 0; i < cards; i++) {
    const g = new THREE.PlaneGeometry(1.6, 1.6, 2, 2);
    // slight cup
    const p = g.attributes.position;
    for (let k = 0; k < p.count; k++) p.setZ(k, -0.12 * (p.getX(k) ** 2 + p.getY(k) ** 2));
    const e = new THREE.Euler(rng.range(-1.2, 1.2) - (i < 3 ? Math.PI / 2 : 0), rng.next() * TAU, rng.range(-0.4, 0.4));
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(e));
    g.translate(rng.range(-0.7, 0.7), rng.range(0.2, 1.1), rng.range(-0.7, 0.7));
    parts.push(g);
  }
  const m = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  m.computeVertexNormals();
  // point normals outward from the centre for softer, volumetric shading
  const pos = m.attributes.position, nor = m.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    _v.set(pos.getX(i), pos.getY(i) - 0.5, pos.getZ(i)).normalize();
    _n.set(nor.getX(i), nor.getY(i), nor.getZ(i));
    _n.lerp(_v, 0.75).normalize();
    nor.setXYZ(i, _n.x, _n.y, _n.z);
  }
  return m;
}
