// 云海 · Chinese celestial architecture: curved glazed roofs with flying eaves, a double-eaved
// hexagonal pavilion, a two-storey tower, a paifang gate, white-jade balustrades, an arched bridge
// and red silk lanterns. Everything is merged into a handful of meshes per material.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, smoothstep, canvasTexture } from '../../lib/util.js';
import { patchStd } from './common.js';

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */
export const COL = {
  red: '#a8281f', redDark: '#6e1a16', teal: '#2b6e72', blue: '#24476e', green: '#3d7d55',
  gold: '#d6a640', jade: '#e2dccf', jadeShade: '#d0c8b8', tileGreen: '#2f7a64', tileGold: '#d39a2a',
  rafter: '#3a4f52', wood: '#8a3a28', paper: '#f2d8a8',
};

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e); _s.set(sx, sy, sz); _p.set(x, y, z);
  return geo.applyMatrix4(_m.compose(_p, _q, _s));
}
/** Normalise a built-in geometry for merging: indexed, no uv, constant (or gradient-darkened) colour. */
export function paint(geo, color, { ao = 0, aoH = 0.4 } = {}) {
  geo.deleteAttribute('uv');
  if (!geo.index) { geo.deleteAttribute('normal'); geo = mergeVertices(geo); geo.computeVertexNormals(); }
  if (!geo.getAttribute('normal')) geo.computeVertexNormals();
  const c = new THREE.Color(color), p = geo.getAttribute('position'), n = p.count;
  geo.computeBoundingBox();
  const bb = geo.boundingBox, h = Math.max(bb.max.y - bb.min.y, 1e-3);
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = ao ? 1 - ao * (1 - smoothstep(0, aoH, (p.getY(i) - bb.min.y) / h)) : 1;
    arr[i * 3] = c.r * k; arr[i * 3 + 1] = c.g * k; arr[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
const box = (w, h, d, color, o) => paint(new THREE.BoxGeometry(w, h, d), color, o);
const cyl = (r0, r1, h, seg, color, o) => paint(new THREE.CylinderGeometry(r0, r1, h, seg), color, o);

/** Collects geometry per material bucket; local placement via a parent matrix. */
export class Builder {
  constructor() { this.b = { paint: [], jade: [], roof: [], gold: [] }; this.lanterns = []; this.lights = []; this.extras = []; this.mat = new THREE.Matrix4(); this.stack = []; }
  push(x, y, z, ry = 0, s = 1) { this.stack.push(this.mat.clone()); const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(s, s, s)); this.mat.multiply(m); return this; }
  pop() { this.mat.copy(this.stack.pop()); return this; }
  add(bucket, geo) { geo.applyMatrix4(this.mat); this.b[bucket].push(geo); return geo; }
  point(x, y, z) { return new THREE.Vector3(x, y, z).applyMatrix4(this.mat); }
  lantern(x, y, z, s = 1, hang = 0.45) { this.lanterns.push({ pos: this.point(x, y, z), s, hang }); }
}

/* ------------------------------------------------------------------ */
/* Roof                                                                */
/* ------------------------------------------------------------------ */
function insetPoly(poly, d, out) {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], b = poly[i], c = poly[(i + 1) % n];
    // inward normals of edges a->b and b->c (polygon is CCW in x/z with +y up => inward = left)
    let ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez); const n1x = -ez / l, n1z = ex / l;
    ex = c[0] - b[0]; ez = c[1] - b[1]; l = Math.hypot(ex, ez); const n2x = -ez / l, n2z = ex / l;
    const k = 1 + n1x * n2x + n1z * n2z;
    out[i] = [b[0] + d * (n1x + n2x) / k, b[1] + d * (n1z + n2z) / k];
  }
  return out;
}
function polyCentroid(poly) { let x = 0, z = 0; for (const p of poly) { x += p[0]; z += p[1]; } return [x / poly.length, z / poly.length]; }
function maxInset(poly) {
  const [cx, cz] = polyCentroid(poly); let m = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez);
    m = Math.min(m, Math.abs((cx - a[0]) * (-ez / l) + (cz - a[1]) * (ex / l)));
  }
  return m;
}
function orientUp(geo) {
  const p = geo.getAttribute('position'), idx = geo.index.array;
  let ny = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ux = p.getX(b) - p.getX(a), uy = p.getY(b) - p.getY(a), uz = p.getZ(b) - p.getZ(a);
    const vx = p.getX(c) - p.getX(a), vy = p.getY(c) - p.getY(a), vz = p.getZ(c) - p.getZ(a);
    ny += uz * vx - ux * vz;
  }
  if (ny < 0) for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
  return geo;
}

/**
 * Curved Chinese roof over a convex CCW polygon footprint [[x,z],...] (the eave line).
 * height: rise at v=1; vMax < 1 truncates it into a ring roof (lower eave of a double roof).
 * Returns { roof: geometry (top tiles + underside + fascia, attrs position/normal/color/aTile/aTileUv), ridges: [curves], top: ring }.
 */
export function roofGeometry(poly, { height = 2, vMax = 1, K = 12, p = 1.75, lift = 0.5, flare = 0.3, seg = 8, thick = 0.14, tile = COL.tileGreen, under = COL.rafter, fascia = COL.redDark } = {}) {
  poly = ensureCCW(poly);
  const n = poly.length, M = maxInset(poly);
  const [cx, cz] = polyCentroid(poly);
  const sideLen = poly.map((a, i) => { const b = poly[(i + 1) % n]; return Math.hypot(b[0] - a[0], b[1] - a[1]); });
  const rings = [];
  const corners = new Array(n);
  for (let k = 0; k <= K; k++) {
    const v = (k / K) * vMax;
    insetPoly(poly, v * M * 0.999, corners);
    const ring = [];
    for (let i = 0; i < n; i++) {
      const a = corners[i], b = corners[(i + 1) % n];
      for (let j = 0; j < seg; j++) {
        const s = j / seg;
        let x = lerp(a[0], b[0], s), z = lerp(a[1], b[1], s);
        const cf = Math.pow(1 - Math.min(s, 1 - s) * 2, 3);
        const eave = Math.pow(1 - v, 2.6);
        let y = height * Math.pow(v, p) + lift * eave * Math.pow(cf, 1.4);
        const dx = x - cx, dz = z - cz, dl = Math.hypot(dx, dz) || 1;
        const push = flare * Math.pow(1 - v, 2) * Math.pow(cf, 2);
        x += dx / dl * push; z += dz / dl * push;
        ring.push({ x, y, z, u: (i + s) * sideLen[i], w: v * height * 1.3 + v * M });
      }
    }
    rings.push(ring);
  }
  const N = rings[0].length;
  function surface(offY, shrink, color, tileFlag, flip) {
    const pos = [], col = [], til = [], tuv = [], idx = [];
    const c = new THREE.Color(color);
    for (const ring of rings) for (const q of ring) {
      const dx = q.x - cx, dz = q.z - cz;
      pos.push(cx + dx * shrink, q.y + offY, cz + dz * shrink);
      col.push(c.r, c.g, c.b); til.push(tileFlag); tuv.push(q.u, q.w);
    }
    for (let k = 0; k < K; k++) for (let j = 0; j < N; j++) {
      const a = k * N + j, b = k * N + (j + 1) % N, c2 = (k + 1) * N + j, d = (k + 1) * N + (j + 1) % N;
      idx.push(a, b, c2, b, d, c2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('aTile', new THREE.Float32BufferAttribute(til, 1));
    g.setAttribute('aTileUv', new THREE.Float32BufferAttribute(tuv, 2));
    g.setIndex(idx);
    orientUp(g);
    if (flip) { const ia = g.index.array; for (let t = 0; t < ia.length; t += 3) { const tmp = ia[t + 1]; ia[t + 1] = ia[t + 2]; ia[t + 2] = tmp; } }
    g.computeVertexNormals();
    return g;
  }
  const top = surface(0, 1, tile, 1, false);
  const bottom = surface(-thick, 0.985, under, 0, true);
  // fascia band joining the eave edges
  const pos = [], col = [], til = [], tuv = [], idx = [];
  const fc = new THREE.Color(fascia);
  for (let j = 0; j <= N; j++) {
    const q = rings[0][j % N];
    const dx = q.x - cx, dz = q.z - cz;
    pos.push(q.x, q.y + 0.01, q.z, cx + dx * 0.985, q.y - thick, cz + dz * 0.985);
    col.push(fc.r, fc.g, fc.b, fc.r, fc.g, fc.b); til.push(0, 0); tuv.push(0, 0, 0, 0);
  }
  for (let j = 0; j < N; j++) { const a = j * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const band = new THREE.BufferGeometry();
  band.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  band.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  band.setAttribute('aTile', new THREE.Float32BufferAttribute(til, 1));
  band.setAttribute('aTileUv', new THREE.Float32BufferAttribute(tuv, 2));
  band.setIndex(idx);
  band.computeVertexNormals();
  const roof = mergeGeometries([top, bottom, band]);
  // hip ridges along the corners, with upturned tips
  const ridges = [];
  for (let i = 0; i < n; i++) {
    const pts = rings.map(r => new THREE.Vector3(r[i * seg].x, r[i * seg].y + 0.06, r[i * seg].z));
    const e0 = pts[0], e1 = pts[1];
    const out = new THREE.Vector3(e0.x - e1.x, 0, e0.z - e1.z).normalize();
    const tip1 = e0.clone().addScaledVector(out, 0.22).add(new THREE.Vector3(0, 0.16, 0));
    const tip2 = tip1.clone().addScaledVector(out, 0.1).add(new THREE.Vector3(0, 0.2, 0));
    ridges.push([tip2, tip1, ...pts]);
  }
  const topRing = rings[K];
  return { roof, ridges, topRing, height, rings };
}

/** Tube geometry along points with a constant radius. */
function tube(points, r, color, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const g = new THREE.TubeGeometry(curve, Math.max(8, points.length * 3), r, radial, false);
  return paint(g, color);
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */
export function archMaterials(shared, tex) {
  const paintMat = patchStd(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0.0 }), shared, { key: 'lacquer' });
  const jadeMat = patchStd(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.0 }), shared, {
    key: 'jade',
    uniforms: { tRock: { value: tex.rock } },
    fragmentHeader: 'uniform sampler2D tRock;',
    fragment: {
      '#include <color_fragment>': /* glsl */`$&
        { vec3 q = vWPos * 0.35; float v = texture2D(tRock, q.xz + q.y * 0.3).a * 0.5 + texture2D(tRock, q.zy * 1.7).a * 0.5;
          diffuseColor.rgb *= 0.9 + 0.14 * v; }
      `,
      // a little subsurface glow: white jade is translucent
      '#include <lights_fragment_end>': /* glsl */`$&
        { vec3 Vw = normalize(cameraPosition - vWPos);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uLightCol * 0.18 * pow(max(dot(-Vw, uLightDir), 0.0), 2.0) + diffuseColor.rgb * uBounce * 0.12; }
      `,
    },
  });
  const roofMat = patchStd(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.05, envMapIntensity: 1.25, side: THREE.FrontSide }), shared, {
    key: 'roof',
    vertexHeader: 'attribute float aTile; attribute vec2 aTileUv; varying float vTile; varying vec2 vTileUv;',
    vertex: { '#include <begin_vertex>': '$&\n vTile = aTile; vTileUv = aTileUv;' },
    fragmentHeader: 'varying float vTile; varying vec2 vTileUv;',
    fragment: {
      '#include <color_fragment>': /* glsl */`$&
        float tph = vTileUv.x / 0.26;
        float fw = fwidth(tph);
        float aa = 1.0 - smoothstep(0.22, 0.55, fw);
        float roll = sin(fract(tph) * 3.14159);
        float course = fract(vTileUv.y / 0.34);
        float tileShade = 0.74 + 0.3 * roll - 0.16 * smoothstep(0.8, 1.0, course);
        diffuseColor.rgb *= mix(1.0, mix(0.9, tileShade, aa), vTile);
      `,
      '#include <normal_fragment_maps>': /* glsl */`$&
        if (vTile > 0.5) {
          // surface-gradient bump across the round tile rolls (analytic, so no blockiness)
          vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
          float dH = 0.13 * cos(fract(tph) * 3.14159) * aa;
          float Hx = dH * dFdx(tph), Hy = dH * dFdy(tph);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          normal = normalize(abs(det) * normal - sign(det) * (Hx * r1 + Hy * r2));
        }
      `,
    },
  });
  const goldMat = patchStd(new THREE.MeshStandardMaterial({ vertexColors: true, color: '#ffffff', metalness: 0.9, roughness: 0.3, envMapIntensity: 1.4 }), shared, { key: 'gold' });
  return { paintMat, jadeMat, roofMat, goldMat };
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */
/** Add a roof (and its ridges, finial) to the builder at local height y. */
function addRoof(B, poly, y, opts, { ridgeR = 0.06, finial = false, ridgeCol = COL.gold, mainRidge = false } = {}) {
  const r = roofGeometry(poly, opts);
  r.roof.translate(0, y, 0);
  B.add('roof', r.roof);
  for (const pts of r.ridges) {
    const g = tube(pts.map(p => p.clone().add(new THREE.Vector3(0, y, 0))), ridgeR, ridgeCol);
    B.add('gold', g);
  }
  const apex = r.topRing.reduce((a, q) => a.add(new THREE.Vector3(q.x, q.y, q.z)), new THREE.Vector3()).multiplyScalar(1 / r.topRing.length);
  apex.y += y;
  if (mainRidge) {
    // the top ring is a segment: find its two extreme points
    let a = r.topRing[0], b = r.topRing[0], best = 0;
    for (const p of r.topRing) for (const q of r.topRing) { const d = (p.x - q.x) ** 2 + (p.z - q.z) ** 2; if (d > best) { best = d; a = p; b = q; } }
    const A = new THREE.Vector3(a.x, a.y + y + 0.1, a.z), Bv = new THREE.Vector3(b.x, b.y + y + 0.1, b.z);
    const dir = Bv.clone().sub(A).normalize();
    B.add('gold', tube([A.clone().addScaledVector(dir, -0.15).add(new THREE.Vector3(0, 0.35, 0)), A, Bv, Bv.clone().addScaledVector(dir, 0.15).add(new THREE.Vector3(0, 0.35, 0))], ridgeR * 1.5, ridgeCol));
    // ridge-end ornaments
    for (const P of [A, Bv]) B.add('gold', xf(paint(new THREE.SphereGeometry(ridgeR * 2.2, 10, 8), COL.gold), P.x, P.y + 0.3, P.z));
  }
  if (finial) {
    const f = [];
    f.push(xf(cyl(0.12, 0.2, 0.25, 12, COL.gold), apex.x, apex.y + 0.08, apex.z));
    f.push(xf(paint(new THREE.SphereGeometry(0.2, 14, 10), COL.gold), apex.x, apex.y + 0.38, apex.z));
    f.push(xf(paint(new THREE.SphereGeometry(0.12, 12, 8), COL.gold), apex.x, apex.y + 0.66, apex.z));
    f.push(xf(paint(new THREE.ConeGeometry(0.05, 0.3, 8), COL.gold), apex.x, apex.y + 0.9, apex.z));
    for (const g of f) B.add('gold', g);
  }
  return { r, apex, eaveCorners: r.ridges.map(pts => pts[0].clone().add(new THREE.Vector3(0, y, 0))) };
}

function regularPoly(n, R, rot = 0) {
  const out = [];
  for (let i = 0; i < n; i++) { const a = rot + (i / n) * TAU; out.push([Math.sin(a) * R, Math.cos(a) * R]); }
  // make CCW in x/z (as seen from +y): our insetPoly assumes inward = left of edge
  return ensureCCW(out);
}
function rectPoly(hx, hz) { return ensureCCW([[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]); }
function ensureCCW(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; }
  // insetPoly treats the left normal (-ez, ex) as inward, which holds for positive signed area
  return a < 0 ? poly.slice().reverse() : poly;
}

/** White-jade balustrade along a polyline of Vector3 points (local to the builder). */
export function balustrade(B, pts, { h = 0.85, every = 1.05, closed = false, post = 0.13 } = {}) {
  const P = closed ? [...pts, pts[0]] : pts;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.round(len / every));
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    for (let k = 0; k <= n; k++) {
      if (k === n && i < P.length - 2) continue;
      const t = k / n;
      const x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t), z = lerp(a.z, b.z, t);
      B.add('jade', xf(box(post, h, post, COL.jade, { ao: 0.25 }), x, y + h / 2, z, 0, yaw));
      B.add('jade', xf(paint(new THREE.SphereGeometry(post * 0.62, 10, 8), COL.jade), x, y + h + post * 0.35, z));
      B.add('jade', xf(cyl(post * 0.5, post * 0.62, post * 0.35, 8, COL.jade), x, y + h + 0.02, z));
    }
    // rails & panel, slanted to follow the slope
    const mid = a.clone().lerp(b, 0.5);
    const dy = b.y - a.y, horiz = Math.hypot(b.x - a.x, b.z - a.z);
    const pitch = Math.atan2(dy, horiz);
    const L = len;
    const rail = xf(box(0.09, 0.09, L, COL.jade), 0, 0, 0);
    B.add('jade', xf(rail, mid.x, mid.y + h * 0.88, mid.z, -pitch, yaw));
    B.add('jade', xf(box(0.06, h * 0.42, L, COL.jadeShade), mid.x, mid.y + h * 0.42, mid.z, -pitch, yaw));
    B.add('jade', xf(box(0.11, 0.08, L, COL.jade), mid.x, mid.y + 0.06, mid.z, -pitch, yaw));
  }
}

/** Hexagonal double-eaved pavilion (重檐六角亭). Local origin at ground centre. */
export function pavilion(B, { R = 2.0, colH = 2.75, plat = 3.1, platH = 0.62, openAngle = 0 } = {}) {
  // platform (hexagon corners aligned with the columns)
  B.add('jade', xf(cyl(plat, plat + 0.12, platH, 6, COL.jade, { ao: 0.35 }), 0, platH / 2, 0, 0, openAngle + Math.PI / 6));
  B.add('jade', xf(cyl(plat + 0.05, plat + 0.05, 0.08, 6, COL.jadeShade), 0, platH + 0.02, 0, 0, openAngle + Math.PI / 6));
  // steps toward +z (rotated by openAngle)
  for (let i = 0; i < 3; i++) {
    const g = box(1.6, platH * (3 - i) / 3, 0.42, COL.jade, { ao: 0.2 });
    const zz = plat * Math.cos(Math.PI / 6) + 0.2 + i * 0.4;
    B.add('jade', xf(g, Math.sin(openAngle) * zz, platH * (3 - i) / 6, Math.cos(openAngle) * zz, 0, openAngle));
  }
  // balustrade on 5 sides
  const corners = [];
  for (let i = 0; i < 6; i++) { const a = openAngle + Math.PI / 6 + (i / 6) * TAU; corners.push(new THREE.Vector3(Math.sin(a) * (plat - 0.15), platH, Math.cos(a) * (plat - 0.15))); }
  // corners[5] -> corners[0] edge spans the stair side (centred on openAngle); skip it
  balustrade(B, [corners[0], corners[1], corners[2], corners[3], corners[4], corners[5]], { h: 0.72, every: 0.95 });
  const y0 = platH;
  // columns on the hexagon corners
  const colPts = [];
  for (let i = 0; i < 6; i++) {
    const a = openAngle + Math.PI / 6 + (i / 6) * TAU;
    const x = Math.sin(a) * R, z = Math.cos(a) * R;
    colPts.push([x, z]);
    B.add('jade', xf(cyl(0.21, 0.24, 0.2, 12, COL.jade), x, y0 + 0.1, z));
    B.add('paint', xf(cyl(0.13, 0.145, colH, 14, COL.red, { ao: 0.15 }), x, y0 + 0.2 + colH / 2, z));
    // brackets (dou-gong) on top
    B.add('paint', xf(box(0.38, 0.12, 0.38, COL.teal), x, y0 + 0.2 + colH + 0.06, z, 0, a));
    B.add('gold', xf(box(0.5, 0.08, 0.2, COL.gold), x, y0 + 0.2 + colH + 0.16, z, 0, a));
    B.add('gold', xf(box(0.2, 0.08, 0.5, COL.gold), x, y0 + 0.2 + colH + 0.16, z, 0, a));
  }
  const beamY = y0 + 0.2 + colH - 0.14;
  for (let i = 0; i < 6; i++) {
    const [x0, z0] = colPts[i], [x1, z1] = colPts[(i + 1) % 6];
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, L = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
    B.add('paint', xf(box(0.16, 0.3, L, COL.teal), mx, beamY, mz, 0, yaw));
    B.add('gold', xf(box(0.17, 0.05, L * 0.98, COL.gold), mx, beamY - 0.1, mz, 0, yaw));
    B.add('paint', xf(box(0.06, 0.22, L * 0.86, COL.red), mx, beamY - 0.36, mz, 0, yaw));     // hanging fascia
    // bench between columns (not on the stair side)
    if (i !== 5) B.add('paint', xf(box(0.36, 0.08, L * 0.8, COL.wood), mx * 0.93, y0 + 0.48, mz * 0.93, 0, yaw));
  }
  // stone table and stools
  B.add('jade', xf(cyl(0.16, 0.24, 0.62, 12, COL.jade), 0, y0 + 0.31, 0));
  B.add('jade', xf(cyl(0.55, 0.55, 0.08, 20, COL.jade), 0, y0 + 0.66, 0));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU + 0.4; B.add('jade', xf(cyl(0.16, 0.2, 0.4, 10, COL.jade), Math.sin(a) * 0.95, y0 + 0.2, Math.cos(a) * 0.95)); }
  // lower roof ring
  const roofY = y0 + 0.2 + colH + 0.22;
  const low = addRoof(B, regularPoly(6, R + 1.3, openAngle + Math.PI / 6), roofY, { height: 2.3, vMax: 0.52, K: 10, lift: 0.55, flare: 0.35, seg: 8 }, { ridgeR: 0.055 });
  // upper drum
  const innerR = (R + 1.3) * (1 - 0.52) * Math.cos(Math.PI / 6) * 0.98;
  const drumY = roofY + 2.3 * Math.pow(0.52, 1.75) - 0.05;
  B.add('paint', xf(cyl(innerR, innerR, 0.85, 6, COL.red, { ao: 0.2 }), 0, drumY + 0.42, 0, 0, openAngle + Math.PI / 6));
  B.add('paint', xf(cyl(innerR + 0.04, innerR + 0.04, 0.2, 6, COL.teal), 0, drumY + 0.78, 0, 0, openAngle + Math.PI / 6));
  B.add('gold', xf(cyl(innerR + 0.05, innerR + 0.05, 0.05, 6, COL.gold), 0, drumY + 0.66, 0, 0, openAngle + Math.PI / 6));
  const up = addRoof(B, regularPoly(6, innerR / Math.cos(Math.PI / 6) + 1.05, openAngle + Math.PI / 6), drumY + 0.9, { height: 1.85, vMax: 1, K: 12, lift: 0.62, flare: 0.42, seg: 8 }, { ridgeR: 0.05, finial: true });
  for (const c of low.eaveCorners) B.lantern(c.x, c.y - 0.05, c.z, 0.85);
  for (const c of up.eaveCorners) B.lantern(c.x, c.y - 0.05, c.z, 0.6, 0.3);
  return { top: up.apex, floorY: y0 };
}

/** Two-storey tower (楼阁) with a balcony; rectangular plan. */
export function tower(B, { w = 5.0, d = 4.2, h1 = 3.0, h2 = 2.4, platH = 0.6, openAngle = 0 } = {}) {
  B.push(0, 0, 0, openAngle);
  B.add('jade', xf(box(w + 1.6, platH, d + 1.6, COL.jade, { ao: 0.35 }), 0, platH / 2, 0));
  for (let i = 0; i < 3; i++) B.add('jade', xf(box(1.8, platH * (3 - i) / 3, 0.4, COL.jade, { ao: 0.2 }), 0, platH * (3 - i) / 6, (d + 1.6) / 2 + 0.2 + i * 0.4));
  const hw = w / 2, hd = d / 2, y0 = platH;
  const cols = [];
  for (const sx of [-1, 0, 1]) for (const sz of [-1, 1]) cols.push([sx * hw, sz * hd]);
  cols.push([-hw, 0], [hw, 0]);
  for (const [x, z] of cols) {
    B.add('jade', xf(cyl(0.22, 0.25, 0.18, 12, COL.jade), x, y0 + 0.09, z));
    B.add('paint', xf(cyl(0.15, 0.16, h1, 14, COL.red, { ao: 0.15 }), x, y0 + 0.18 + h1 / 2, z));
  }
  // lattice walls on three sides, open front (+z) with doors
  const wallC = '#b04a35';
  B.add('paint', xf(box(w - 0.3, h1 * 0.78, 0.08, wallC, { ao: 0.2 }), 0, y0 + 0.18 + h1 * 0.39, -hd));
  B.add('paint', xf(box(0.08, h1 * 0.78, d - 0.3, wallC, { ao: 0.2 }), -hw, y0 + 0.18 + h1 * 0.39, 0));
  B.add('paint', xf(box(0.08, h1 * 0.78, d - 0.3, wallC, { ao: 0.2 }), hw, y0 + 0.18 + h1 * 0.39, 0));
  for (const sx of [-1, 1]) B.add('paint', xf(box(hw * 0.8, h1 * 0.78, 0.08, wallC, { ao: 0.2 }), sx * hw * 0.55, y0 + 0.18 + h1 * 0.39, hd));
  // golden lattice lines on the walls
  for (let k = 0; k < 4; k++) {
    const yy = y0 + 0.5 + k * h1 * 0.2;
    B.add('gold', xf(box(w - 0.35, 0.03, 0.1, COL.gold), 0, yy, -hd));
    B.add('gold', xf(box(0.1, 0.03, d - 0.35, COL.gold), -hw, yy, 0));
    B.add('gold', xf(box(0.1, 0.03, d - 0.35, COL.gold), hw, yy, 0));
  }
  const beamY = y0 + 0.18 + h1;
  B.add('paint', xf(box(w + 0.3, 0.3, 0.2, COL.teal), 0, beamY, hd));
  B.add('paint', xf(box(w + 0.3, 0.3, 0.2, COL.teal), 0, beamY, -hd));
  B.add('paint', xf(box(0.2, 0.3, d + 0.3, COL.teal), hw, beamY, 0));
  B.add('paint', xf(box(0.2, 0.3, d + 0.3, COL.teal), -hw, beamY, 0));
  B.add('gold', xf(box(w + 0.32, 0.05, 0.22, COL.gold), 0, beamY - 0.12, hd));
  // first eave (ring roof)
  const r1 = addRoof(B, rectPoly(hw + 1.2, hd + 1.2), beamY + 0.2, { height: 2.4, vMax: 0.42, K: 9, lift: 0.5, flare: 0.32, seg: 8 }, { ridgeR: 0.055 });
  // balcony + second storey
  const y1 = beamY + 0.2 + 2.4 * Math.pow(0.42, 1.75);
  const w2 = w * 0.74, d2 = d * 0.74;
  B.add('paint', xf(box(w2 + 1.0, 0.18, d2 + 1.0, COL.wood), 0, y1, 0));
  const bp = [new THREE.Vector3(-w2 / 2 - 0.45, y1 + 0.09, -d2 / 2 - 0.45), new THREE.Vector3(w2 / 2 + 0.45, y1 + 0.09, -d2 / 2 - 0.45), new THREE.Vector3(w2 / 2 + 0.45, y1 + 0.09, d2 / 2 + 0.45), new THREE.Vector3(-w2 / 2 - 0.45, y1 + 0.09, d2 / 2 + 0.45)];
  balustrade(B, bp, { h: 0.65, every: 0.8, closed: true, post: 0.1 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) B.add('paint', xf(cyl(0.12, 0.13, h2, 12, COL.red), sx * w2 / 2, y1 + 0.09 + h2 / 2, sz * d2 / 2));
  B.add('paint', xf(box(w2 - 0.2, h2 * 0.75, d2 - 0.2, wallC, { ao: 0.2 }), 0, y1 + 0.09 + h2 * 0.4, 0));
  for (let k = 0; k < 3; k++) B.add('gold', xf(box(w2 - 0.15, 0.03, d2 - 0.15, COL.gold), 0, y1 + 0.5 + k * 0.5, 0));
  const beam2 = y1 + 0.09 + h2;
  B.add('paint', xf(box(w2 + 0.3, 0.28, d2 + 0.3, COL.teal), 0, beam2, 0));
  const r2 = addRoof(B, rectPoly(w2 / 2 + 1.15, d2 / 2 + 1.15), beam2 + 0.18, { height: 2.1, vMax: 1, K: 12, lift: 0.6, flare: 0.4, seg: 8 }, { ridgeR: 0.055, mainRidge: true });
  for (const c of r1.eaveCorners) B.lantern(c.x, c.y - 0.05, c.z, 0.85);
  for (const c of r2.eaveCorners) B.lantern(c.x, c.y - 0.05, c.z, 0.75, 0.35);
  B.pop();
}

/** Paifang gate with three roofs and a plaque. */
export function gate(B, plaqueGeo, { openAngle = 0 } = {}) {
  B.push(0, 0, 0, openAngle);
  const xs = [-3.3, -1.25, 1.25, 3.3], hs = [4.0, 4.9, 4.9, 4.0];
  for (let i = 0; i < 4; i++) {
    const x = xs[i], h = hs[i];
    B.add('jade', xf(box(0.7, 0.5, 0.7, COL.jade, { ao: 0.3 }), x, 0.25, 0));
    for (const s of [-1, 1]) B.add('jade', xf(cyl(0.34, 0.34, 0.16, 16, COL.jade), x, 0.62, s * 0.45, Math.PI / 2, 0, 0));
    B.add('paint', xf(cyl(0.17, 0.19, h, 14, COL.red, { ao: 0.15 }), x, 0.5 + h / 2, 0));
  }
  // lintels
  B.add('paint', xf(box(2.7, 0.32, 0.26, COL.teal), 0, 4.2, 0));
  B.add('paint', xf(box(2.7, 0.24, 0.24, COL.blue), 0, 3.35, 0));
  B.add('gold', xf(box(2.72, 0.05, 0.28, COL.gold), 0, 4.02, 0));
  for (const s of [-1, 1]) {
    B.add('paint', xf(box(2.15, 0.28, 0.24, COL.teal), s * 2.28, 3.55, 0));
    B.add('gold', xf(box(2.17, 0.05, 0.26, COL.gold), s * 2.28, 3.4, 0));
  }
  // plaque between lintels (textured, built by the caller)
  if (plaqueGeo) B.extras.push({ geo: plaqueGeo, matrix: B.mat.clone().multiply(new THREE.Matrix4().makeTranslation(0, 3.78, 0.14)) });
  B.add('gold', xf(box(1.5, 0.62, 0.06, COL.gold), 0, 3.78, 0.1));
  // roofs
  addRoof(B, rectPoly(1.75, 0.62), 4.4, { height: 0.75, vMax: 1, K: 8, lift: 0.32, flare: 0.22, seg: 6, thick: 0.1 }, { ridgeR: 0.045, mainRidge: true });
  for (const s of [-1, 1]) addRoof(B, rectPoly(1.3, 0.55), 3.75, { height: 0.6, vMax: 1, K: 8, lift: 0.28, flare: 0.18, seg: 6, thick: 0.1 }, { ridgeR: 0.04, mainRidge: true });
  for (const x of [-1.25, 1.25]) B.lantern(x, 3.2, 0.35, 0.7, 0.25);
  B.pop();
}

/** Arched white-jade bridge from a to b (Vector3 in builder space). */
export function bridge(B, a, b, { width = 1.7, rise = 2.2 } = {}) {
  const n = 18;
  const dir = b.clone().sub(a); const L = Math.hypot(dir.x, dir.z);
  const yaw = Math.atan2(dir.x, dir.z);
  const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = a.clone().lerp(b, t);
    p.y += Math.sin(t * Math.PI) * rise;
    pts.push(p);
  }
  // deck segments (slanted boxes) with a thicker arch underneath
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[i + 1], m = p.clone().lerp(q, 0.5);
    const seg = p.distanceTo(q), pitch = Math.atan2(q.y - p.y, Math.hypot(q.x - p.x, q.z - p.z));
    const t = (i + 0.5) / n;
    const th = 0.28 + 0.9 * Math.pow(Math.abs(t - 0.5) * 2, 2.5);
    B.add('jade', xf(box(width, 0.2, seg + 0.02, COL.jade), m.x, m.y - 0.1, m.z, -pitch, yaw));
    B.add('jade', xf(box(width * 0.9, th, seg + 0.02, COL.jadeShade, { ao: 0.3 }), m.x, m.y - 0.2 - th / 2, m.z, -pitch, yaw));
    // step lines
    B.add('jade', xf(box(width * 0.98, 0.03, 0.05, COL.jadeShade), m.x, m.y + 0.005, m.z, -pitch, yaw));
  }
  for (const s of [-1, 1]) balustrade(B, pts.filter((_, i) => i % 2 === 0).map(p => p.clone().addScaledVector(side, s * (width / 2 - 0.08))), { h: 0.7, every: 10, post: 0.11 });
  return pts;
}

/* ------------------------------------------------------------------ */
/* Plaque texture                                                      */
/* ------------------------------------------------------------------ */
export function plaqueGeometry() {
  const tex = canvasTexture(512, 224, (g, w, h) => {
    g.fillStyle = '#1d2f5a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e2b450'; g.lineWidth = 14; g.strokeRect(10, 10, w - 20, h - 20);
    g.lineWidth = 4; g.strokeRect(30, 30, w - 60, h - 60);
    g.fillStyle = '#f1c862';
    g.font = 'bold 128px "Noto Serif SC","Songti SC","STSong","SimSun",serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('蟠桃园', w / 2, h / 2 + 6);
  });
  const geo = new THREE.PlaneGeometry(1.32, 0.56);
  return { geo, tex };
}

/* ------------------------------------------------------------------ */
/* Lanterns (instanced): red silk body + gold caps, glowing at night  */
/* ------------------------------------------------------------------ */
export function createLanterns(shared, list) {
  const pts = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; const a = t * Math.PI; pts.push(new THREE.Vector2(Math.sin(a) * 0.2 * (0.82 + 0.18 * Math.sin(a)), -Math.cos(a) * 0.19)); }
  let body = new THREE.LatheGeometry(pts, 16);
  // ribs
  const p = body.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x); const k = 1 - 0.05 * Math.pow(Math.abs(Math.cos(a * 6)), 4); p.setX(i, x * k); p.setZ(i, z * k); }
  body.computeVertexNormals();
  body.deleteAttribute('uv');
  const caps = mergeGeometries([
    paint(new THREE.CylinderGeometry(0.1, 0.11, 0.05, 12), COL.gold).translate(0, 0.2, 0),
    paint(new THREE.CylinderGeometry(0.11, 0.1, 0.05, 12), COL.gold).translate(0, -0.2, 0),
    paint(new THREE.CylinderGeometry(0.008, 0.008, 0.32, 4), '#2a1a12').translate(0, 0.36, 0),
    paint(new THREE.ConeGeometry(0.045, 0.22, 8), '#b8261c').rotateX(Math.PI).translate(0, -0.33, 0),
  ]);
  const n = list.length;
  const glowU = { value: 1 };
  const bodyMat = patchStd(new THREE.MeshStandardMaterial({ color: '#c42a1c', roughness: 0.7, emissive: new THREE.Color('#ff5a1e'), emissiveIntensity: 1 }), shared, {
    key: 'lantern',
    uniforms: { uLanternGlow: glowU },
    fragmentHeader: 'uniform float uLanternGlow;',
    fragment: {
      '#include <emissivemap_fragment>': /* glsl */`$&
        { vec3 Vv = normalize(vViewPosition);
          float facing = abs(dot(normalize(vNormal), Vv));
          float ribs = 0.8 + 0.2 * smoothstep(0.0, 1.0, facing);
          totalEmissiveRadiance *= uLanternGlow * (0.35 + 0.95 * pow(facing, 1.5)) * ribs; }
      `,
    },
  });
  const capMat = patchStd(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.6, roughness: 0.4 }), shared, { key: 'lanterncap' });
  const bodies = new THREE.InstancedMesh(body, bodyMat, n);
  const capsM = new THREE.InstancedMesh(caps, capMat, n);
  const m = new THREE.Matrix4();
  const state = list.map((l, i) => ({ ...l, ph: i * 1.7 }));
  function write(t) {
    for (let i = 0; i < n; i++) {
      const L = state[i];
      const sw = Math.sin(t * 0.9 + L.ph) * 0.06;
      _q.setFromEuler(_e.set(sw, 0, Math.cos(t * 0.7 + L.ph) * 0.05));
      m.compose(_p.set(L.pos.x, L.pos.y - 0.5 * L.s, L.pos.z), _q, _s.set(L.s, L.s, L.s));
      bodies.setMatrixAt(i, m); capsM.setMatrixAt(i, m);
    }
    bodies.instanceMatrix.needsUpdate = true; capsM.instanceMatrix.needsUpdate = true;
  }
  write(0);
  return {
    meshes: [bodies, capsM], state,
    update(t, night) {
      write(t);
      glowU.value = lerp(0.12, 2.6, night) * (0.92 + 0.08 * Math.sin(t * 7.3));
    },
  };
}
