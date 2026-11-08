// The guardians' shared building kit: parametric surfaces into one skinned geometry (lib/rig.js is used by the
// rainforest's macaw and the cloud sea's tortoise). Every part is a surface F(u, v) sampled on a grid, with normals
// from F's own derivatives, painted from one atlas and skinned to a flat skeleton (every bone a child of the mesh,
// posed in mesh space each frame); motion comes from exact critically damped springs, the same at any frame rate.
import * as THREE from 'three';
import { clamp, lerp, smoothstep } from './util.js';

export const V = (x, y, z) => new THREE.Vector3(x, y, z);
export const finite = v => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
export const spow = (t, p) => Math.sign(t) * Math.pow(Math.abs(t), p);
/** 0 -> 1 -> 0 over [0, d], easing in and out over `e` at each end (the shape of a reaction) */
export const envl = (t, d, e) => smoothstep(0, e, t) * (1 - smoothstep(d - e, d, t));
/** n + 1 values from a to b (optionally eased) */
export const range = (a, b, n, ease = null) => { const o = []; for (let i = 0; i <= n; i++) { const t = i / n; o.push(lerp(a, b, ease ? ease(t) : t)); } return o; };
/** blend between two bones over [a, b] of x */
export const blend2 = (x, a, b, b0, b1) => { const t = smoothstep(a, b, x); return t <= 0 ? [[b0, 1]] : t >= 1 ? [[b1, 1]] : [[b0, 1 - t], [b1, t]]; };

/** A smooth curve through a table's rows ([x, ...values]): monotone cubic (PCHIP) in column k, so outlines have no
 *  ripple at the rows and never overshoot them. Built once per table and column. */
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
export function table(rows, x, k) {
  let c = CURVES.get(rows);
  if (!c) CURVES.set(rows, c = []);
  return (c[k] || (c[k] = curve(rows, k)))(x);
}

/** Critically damped spring, stepped exactly (the same at any frame rate for a target held over the step). */
export class Spring {
  constructor(x = 0) { this.x = x; this.v = 0; }
  step(target, w, dt) {
    const e = this.x - target, a = (this.v + w * e) * dt, ex = Math.exp(-w * dt);
    this.x = target + (e + a) * ex; this.v = (this.v - w * a) * ex;
    return this.x;
  }
  set(x) { this.x = x; this.v = 0; return this; }
}

/** atlas regions [u0, v0, u1, v1] (v from the bottom) -> uv, `inset` pixels clear of each region's border (so mipmaps
 *  bleed less) */
export function makeRuv(W, H, inset = 2.5) {
  const du = inset / W, dv = inset / H;
  return (r, a, b) => [lerp(r[0] + du, r[2] - du, clamp(a, 0, 1)), lerp(r[1] + dv, r[3] - dv, clamp(b, 0, 1))];
}

/** The parts of one skinned mesh, gathered into a single geometry (one draw call). Attributes beside three's own:
 *  aThin (parts that keep a minimum size on screen) and aRough (roughness per part). */
export class Geo {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.si = []; this.sw = []; this.thin = []; this.rough = []; this.idx = []; }
  get count() { return this.p.length / 3; }
  vert(p, n, uv, ao, bones, thin = 0, rough = 0.62) {
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(uv[0], uv[1]); this.c.push(ao, ao, ao);
    let tot = 0; for (const b of bones) tot += b[1];
    for (let k = 0; k < 4; k++) { const b = bones[k]; this.si.push(b ? b[0] : 0); this.sw.push(b ? b[1] / tot : 0); }
    this.thin.push(thin); this.rough.push(rough);
  }
  /**
   * A surface F(u, v) sampled at us[] × vs[]. Normals from F's own derivatives (finite differences in the
   * parameters), so parts meeting along a shared edge shade as one; `flip` turns them round, `pole(u, v, out)` gives
   * the normal where the surface collapses to a point. meta(u, v, p) -> { uv, ao, bones, thin, rough }.
   */
  surf(us, vs, F, meta, { flip = false, pole = null, eps = 1e-4 } = {}) {
    const base = this.count, nu = us.length, nv = vs.length;
    const p = V(0, 0, 0), a = V(0, 0, 0), b = V(0, 0, 0), du = V(0, 0, 0), dv = V(0, 0, 0), n = V(0, 0, 0);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const u = us[i], v = vs[j];
      F(u, v, p);
      // central differences; one-sided where a neighbour sample falls outside the surface's domain (an edge at
      // v = 0 may take pow() of a negative number there: never a NaN normal)
      F(u + eps, v, a); F(u - eps, v, b); du.subVectors(finite(a) ? a : p, finite(b) ? b : p);
      F(u, v + eps, a); F(u, v - eps, b); dv.subVectors(finite(a) ? a : p, finite(b) ? b : p);
      n.crossVectors(du, dv);
      // degenerate only where the surface really collapses (a pole: one derivative vanishes or the two run
      // parallel), judged on directions, not lengths, so a small part (an eye, a claw) is not mistaken for one
      const lu = du.lengthSq(), lv = dv.lengthSq();
      if (!(lu > 1e-12 * lv && lv > 1e-12 * lu && n.lengthSq() > 1e-10 * lu * lv)) { if (pole) pole(u, v, n); else n.set(0, 1, 0); }
      else if (flip) n.negate();
      n.normalize();
      const m = meta(u, v, p);
      this.vert(p, n, m.uv, m.ao ?? 1, m.bones, m.thin || 0, m.rough ?? 0.62);
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

/** a two-sided blade between two edges: u round its section (0 at edge A, over side +n to edge B at 0.5, back under
 *  side -n), v along. edges(v, A, B, n) fills the edges and the side direction; thick(v, c) the half thickness at
 *  chord fraction c from edge A (0) to B (1). */
export function bladeSurface(edges, thick) {
  const A = V(0, 0, 0), Bv = V(0, 0, 0), n = V(0, 0, 0);
  return (u, v, out) => {
    edges(clamp(v, 0, 1), A, Bv, n);
    const w = clamp(u, 0, 1), top = w < 0.5, c = top ? w * 2 : (1 - w) * 2;
    return out.copy(A).lerp(Bv, c).addScaledVector(n, (top ? 1 : -1) * thick(clamp(v, 0, 1), c));
  };
}

/** The skinned mesh with its flat skeleton: every bone a child of the mesh, at its bind position. */
export function makeFlatSkinnedMesh(geo, mat, bind) {
  const mesh = new THREE.SkinnedMesh(geo, mat);
  const bones = [];
  for (let i = 0; i < bind.length; i++) { const b = new THREE.Bone(); b.position.copy(bind[i]); mesh.add(b); bones.push(b); }
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  return { mesh, bones };
}
