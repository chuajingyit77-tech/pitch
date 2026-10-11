// 晴岛 flora & beach dressing: palms, bushes + hibiscus, grass, rocks, shells, starfish, driftwood.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, smoothstep, addWind, patchMaterial, createNoise } from '../../lib/util.js';
import { addUnderwater, softenNormals, LAYER_NO_REFLECT } from './shared.js';
import { barkTexture, frondTexture, leafClusterTexture, grassTexture, flowerTexture, woodTexture, PALETTES } from './textures.js';

const V3 = THREE.Vector3;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new V3(), _p = new V3(), _e = new THREE.Euler();
const UP = new V3(0, 1, 0);
const WHITE = new THREE.Color(1, 1, 1);
const CORAL = ['#b0587e', '#7e5aa8', '#c47f45', '#5f9a8e', '#c9a14a'].map(c => new THREE.Color(c).multiplyScalar(1.6));

/** Foliage seen from behind keeps its (outward/up) normal instead of flipping dark. */
function noFlip(material) {
  return patchMaterial(material, {
    key: 'noflip',
    fragment: { '#include <normal_fragment_begin>': '$&\n normal = normalize(vNormal);' },
  });
}

/* ------------------------------------------------------------------ */
/* Palm                                                                */
/* ------------------------------------------------------------------ */
function buildPalmVariant(rng, { height, lean, nFronds, frondLen }) {
  const curve = new THREE.CubicBezierCurve3(
    new V3(0, 0, 0), new V3(lean * 0.6, height * 0.3, 0), new V3(lean * 0.98, height * 0.66, 0), new V3(lean, height, 0));
  // ---- trunk ----
  const segs = 34, radial = 11;
  const pos = [], nor = [], uv = [], idx = [];
  let len = 0;
  const prev = new V3(), p = new V3(), T = new V3(), B = new V3(), N = new V3(), d = new V3();
  for (let i = 0; i <= segs; i++) {
    const s = i / segs;
    curve.getPoint(s, p);
    curve.getTangent(s, T);
    if (i > 0) len += p.distanceTo(prev);
    prev.copy(p);
    B.crossVectors(T, new V3(0, 0, 1)).normalize();
    N.crossVectors(B, T).normalize();
    let r = lerp(0.27, 0.15, Math.pow(s, 0.85)) * (1 + 0.45 * Math.exp(-s * 16));
    r *= 1 + 0.04 * Math.sin(s * 70);
    if (s > 0.97) r *= 1.25;
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * TAU;
      d.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
      pos.push(p.x + d.x * r, p.y + d.y * r, p.z + d.z * r);
      nor.push(d.x, d.y, d.z);
      uv.push(j / radial * 2, len / 1.0);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + 1, c = a + radial + 1, e = c + 1;
    idx.push(a, c, b, b, c, e);
  }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  trunk.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  trunk.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  trunk.setIndex(idx);
  const top = curve.getPoint(1);

  // ---- fronds ----
  const frondGeos = [];
  for (let f = 0; f < nFronds; f++) {
    const tier = f % 3;
    const phi = f / nFronds * TAU + rng.range(-0.22, 0.22);
    const pitch0 = [0.95, 0.42, 0.08][tier] + rng.range(-0.12, 0.12);
    const L = frondLen * [0.72, 1.0, 0.96][tier] * rng.range(0.9, 1.08);
    const droop = [0.55, 1.35, 1.85][tier] * rng.range(0.85, 1.15);
    const W = L * 0.21;
    const M = 18;
    const fp = [], fn = [], fu = [], fi = [];
    const cp = new V3(top.x, top.y + 0.05, top.z).addScaledVector(new V3(Math.cos(phi), 0, Math.sin(phi)), 0.12);
    const side = new V3(-Math.sin(phi), 0, Math.cos(phi));
    const twist = rng.range(-0.25, 0.25);
    for (let k = 0; k <= M; k++) {
      const s = k / M;
      const ang = pitch0 - droop * Math.pow(s, 1.55);
      const dir = new V3(Math.cos(ang) * Math.cos(phi), Math.sin(ang), Math.cos(ang) * Math.sin(phi));
      if (k > 0) cp.addScaledVector(dir, L / M);
      const sd = side.clone().applyAxisAngle(dir, twist * s);
      const nrm = new V3().crossVectors(sd, dir).normalize(); // frond "up"
      if (nrm.y < 0) nrm.negate();
      const w = W * (s < 0.08 ? s / 0.08 * 0.6 + 0.4 : 1) * (1 - Math.pow(s, 5) * 0.55);
      const fold = 0.42 + s * 0.25;
      for (const side01 of [0, 0.5, 1]) {
        const o = (side01 - 0.5) * 2;
        const v = cp.clone().addScaledVector(sd, o * w).addScaledVector(nrm, -Math.abs(o) * w * fold);
        fp.push(v.x, v.y, v.z);
        fn.push(nrm.x, nrm.y, nrm.z);
        fu.push(side01, s);
      }
    }
    for (let k = 0; k < M; k++) {
      const a = k * 3;
      fi.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(fn, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(fu, 2));
    g.setIndex(fi);
    frondGeos.push(g);
  }
  const fronds = mergeGeometries(frondGeos);
  frondGeos.forEach(g => g.dispose());
  softenNormals(fronds, 0.45);

  // ---- coconuts + frond boots ----
  const nuts = [];
  const nNuts = rng.int(3, 6);
  for (let i = 0; i < nNuts; i++) {
    const a = rng.range(0, TAU);
    const g = new THREE.SphereGeometry(rng.range(0.12, 0.15), 10, 8);
    g.scale(1, 1.12, 1);
    g.translate(top.x + Math.cos(a) * 0.2, top.y - 0.22 - rng.range(0, 0.18), top.z + Math.sin(a) * 0.2);
    nuts.push(g);
  }
  const coconuts = mergeGeometries(nuts);
  nuts.forEach(g => g.dispose());
  return { trunk, fronds, coconuts, height: height + 0.5, top };
}

/* ------------------------------------------------------------------ */
/* Bush cards                                                          */
/* ------------------------------------------------------------------ */
function buildBush(rng, nCards = 30) {
  const pos = [], nor = [], uv = [], idx = [];
  const c = new V3(), n = new V3(), t1 = new V3(), t2 = new V3();
  for (let k = 0; k < nCards; k++) {
    const y = rng.range(-0.15, 1);
    const a = rng.range(0, TAU), rr = Math.sqrt(1 - y * y);
    n.set(Math.cos(a) * rr, y, Math.sin(a) * rr).normalize();
    const rad = rng.range(0.45, 0.8);
    c.copy(n).multiplyScalar(rad);
    c.y = c.y * 0.8 + 0.55;
    t1.crossVectors(n, Math.abs(n.y) > 0.9 ? new V3(1, 0, 0) : UP).normalize();
    t1.applyAxisAngle(n, rng.range(0, TAU));
    t2.crossVectors(n, t1).normalize();
    const S = rng.range(0.42, 0.62);
    const base = pos.length / 3;
    const sn = n.clone().multiplyScalar(0.7).add(new V3(0, 0.6, 0)).normalize();
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
      const ox = (u - 0.5) * 2 * S, oy = (v - 0.5) * 2 * S;
      pos.push(c.x + t1.x * ox + t2.x * oy, c.y + t1.y * ox + t2.y * oy, c.z + t1.z * ox + t2.z * oy);
      nor.push(sn.x, sn.y, sn.z);
      uv.push(u, v);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

function buildGrassTuft() {
  const geos = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(0.62, 0.5);
    g.translate(0, 0.25, 0);
    g.rotateY(i / 3 * Math.PI);
    geos.push(g);
  }
  const g = mergeGeometries(geos);
  geos.forEach(x => x.dispose());
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

function buildRock(seed, detail = 3) {
  const nz = createNoise(seed);
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    _p.set(p.getX(i), p.getY(i), p.getZ(i));
    const k = 1 + 0.28 * nz.fbm3(_p.x * 1.2, _p.y * 1.2, _p.z * 1.2, 4) + 0.06 * nz.noise3(_p.x * 5, _p.y * 5, _p.z * 5);
    _p.multiplyScalar(k);
    _p.y *= 0.62;
    if (_p.y < -0.25) _p.y = -0.25 + (_p.y + 0.25) * 0.4;
    p.setXYZ(i, _p.x, _p.y, _p.z);
  }
  g.computeVertexNormals();
  // vertex colours: grey-brown with darker cracks; moss/sand on top decided in the shader
  const cols = new Float32Array(p.count * 3);
  const a = new THREE.Color('#8f877b'), b = new THREE.Color('#6a6259'), c = new THREE.Color('#a39a8b');
  const col = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const v = nz.noise3(p.getX(i) * 2.2, p.getY(i) * 2.2, p.getZ(i) * 2.2) * 0.5 + 0.5;
    col.copy(a).lerp(b, smoothstep(0.55, 0.8, v)).lerp(c, smoothstep(0.45, 0.2, v) * 0.6);
    cols[i * 3] = col.r; cols[i * 3 + 1] = col.g; cols[i * 3 + 2] = col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

function buildStarfish() {
  const shape = new THREE.Shape();
  for (let i = 0; i <= 10; i++) {
    const a = i / 10 * TAU + Math.PI / 2, r = i % 2 === 0 ? 0.1 : 0.038;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2 });
  g.rotateX(-Math.PI / 2);
  return g;
}

function buildShell() {
  // scallop: a ribbed fan
  const g = new THREE.SphereGeometry(0.07, 14, 6, 0, Math.PI, 0, Math.PI / 2);
  g.scale(1, 0.35, 0.85);
  g.rotateY(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getZ(i), p.getX(i));
    const k = 1 + 0.06 * Math.max(0, Math.sin(a * 14));
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

function buildDriftwood(rng) {
  const pts = [];
  const n = 5, L = rng.range(1.4, 2.4);
  for (let i = 0; i < n; i++) pts.push(new V3((i / (n - 1) - 0.5) * L, rng.range(-0.03, 0.05), rng.range(-0.12, 0.12)));
  const main = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, rng.range(0.07, 0.1), 7, false);
  const b0 = pts[2].clone();
  const branch = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([b0, b0.clone().add(new V3(0.25, 0.08, 0.32)), b0.clone().add(new V3(0.45, 0.1, 0.62))]), 6, 0.045, 6, false);
  const g = mergeGeometries([main, branch]);
  main.dispose(); branch.dispose();
  return g;
}

/* ------------------------------------------------------------------ */
/* Placement                                                           */
/* ------------------------------------------------------------------ */
export function createFlora(env, rng, terrain, wind, reserved) {
  const q = env.q;
  const group = new THREE.Group();
  group.name = 'flora';
  const disposables = [];
  const occupied = reserved.slice(); // [{x,z,r}]
  const free = (x, z, r) => occupied.every(o => Math.hypot(o.x - x, o.z - z) > o.r + r);
  const H = terrain.height;

  /* ---------------- palms ---------------- */
  const barkTex = barkTexture(rng.int(1, 1e6));
  const frondTexA = frondTexture(rng.int(1, 1e6));
  disposables.push(barkTex, frondTexA);
  const variants = [
    buildPalmVariant(rng.fork('pv0'), { height: 7.6, lean: 3.4, nFronds: 13, frondLen: 3.9 }),
    buildPalmVariant(rng.fork('pv1'), { height: 6.8, lean: 1.9, nFronds: 12, frondLen: 3.6 }),
    buildPalmVariant(rng.fork('pv2'), { height: 6.0, lean: 0.9, nFronds: 11, frondLen: 3.3 }),
  ];
  const palmSites = [];
  const nPalms = Math.round(lerp(7, 10, q));
  const prng = rng.fork('palms');
  // hero palm: on the beach, leaning far out over the water
  const clusters = [terrain.dockAng + prng.range(0.5, 0.9), terrain.dockAng + Math.PI * prng.range(0.75, 1.25), terrain.dockAng - prng.range(1.3, 1.9)];
  for (let i = 0, guard = 0; palmSites.length < nPalms && guard < 400; guard++) {
    const hero = palmSites.length === 0;
    const c = clusters[palmSites.length % clusters.length];
    const a = c + prng.range(-0.45, 0.45) + (palmSites.length >= 6 ? prng.range(-2, 2) : 0);
    const e = hero ? prng.range(1.8, 2.8) : prng.range(2.8, 8.5);
    const pt = terrain.pointAt(a, e);
    if (!free(pt.x, pt.z, 1.4)) continue;
    const variant = hero ? 0 : e < 5 ? prng.pick([0, 1, 1]) : prng.pick([1, 2, 2]);
    const out = Math.atan2(pt.z, pt.x) + prng.range(-0.5, 0.5);
    palmSites.push({ x: pt.x, y: pt.y - 0.12, z: pt.z, variant, yaw: -out, s: prng.range(0.88, 1.12) * (hero ? 1.08 : 1) });
    occupied.push({ x: pt.x, z: pt.z, r: 1.1 });
    i++;
  }
  // young palms inland
  const nYoung = Math.round(lerp(2, 4, q));
  for (let k = 0, guard = 0; k < nYoung && guard < 200; guard++) {
    const a = prng.range(0, TAU), e = prng.range(6, 10);
    const pt = terrain.pointAt(a, e);
    if (!free(pt.x, pt.z, 1)) continue;
    palmSites.push({ x: pt.x, y: pt.y - 0.1, z: pt.z, variant: 2, yaw: prng.range(0, TAU), s: prng.range(0.5, 0.7) });
    occupied.push({ x: pt.x, z: pt.z, r: 0.8 });
    k++;
  }

  const barkMat = new THREE.MeshStandardMaterial({ map: barkTex, roughness: 0.95, color: 0xe8e0d6 });
  const frondMat = new THREE.MeshStandardMaterial({ map: frondTexA, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.72, color: 0xffffff });
  const nutMat = new THREE.MeshStandardMaterial({ color: 0x6a7a2c, roughness: 0.55 });
  const palmMeshes = [];
  const palmTops = [];
  variants.forEach((v, vi) => {
    const sites = palmSites.filter(s => s.variant === vi);
    if (!sites.length) return;
    const windOpts = { height: v.height, amount: 0.42, stiffness: 2.2 };
    const mk = (geo, mat, extra) => {
      const m = mat.clone();
      addWind(m, wind, { ...windOpts, ...extra });
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: mat.map, alphaTest: mat.alphaTest });
      addWind(depth, wind, { ...windOpts, ...extra });
      const mesh = new THREE.InstancedMesh(geo, m, sites.length);
      mesh.customDepthMaterial = depth;
      mesh.castShadow = true; mesh.receiveShadow = true;
      sites.forEach((s, i) => {
        _q.setFromAxisAngle(UP, s.yaw);
        _m.compose(_p.set(s.x, s.y, s.z), _q, _s.setScalar(s.s));
        mesh.setMatrixAt(i, _m);
      });
      mesh.computeBoundingSphere();
      disposables.push(m, depth);
      palmMeshes.push(mesh);
      group.add(mesh);
      return { mesh, m };
    };
    mk(v.trunk, barkMat);
    const fr = mk(v.fronds, frondMat, { flutter: 0.035 });
    noFlip(fr.m);
    patchMaterial(fr.m, {
      key: 'frondFlutter',
      vertex: { '#include <begin_vertex>': '$&\n transformed.y += sin(uWindTime * 2.3 + position.x * 1.3 + position.z * 1.1) * 0.08 * uv.y * uv.y;' },
    });
    mk(v.coconuts, nutMat);
    disposables.push(v.trunk, v.fronds, v.coconuts);
    sites.forEach(s => {
      const t = v.top.clone().multiplyScalar(s.s).applyAxisAngle(UP, s.yaw).add(_p.set(s.x, s.y, s.z));
      palmTops.push(t);
    });
  });
  disposables.push(barkMat, frondMat, nutMat);

  /* ---------------- bushes + flowers ---------------- */
  const leafTex = [leafClusterTexture(rng.int(1, 1e6), PALETTES.bush), leafClusterTexture(rng.int(1, 1e6), PALETTES.bushDark)];
  disposables.push(...leafTex);
  const bushGeo = buildBush(rng.fork('bushgeo'), 30);
  disposables.push(bushGeo);
  const bushSites = [];
  const brng = rng.fork('bushes');
  const nBush = Math.round(lerp(34, 58, q));
  for (let guard = 0; bushSites.length < nBush && guard < 2000; guard++) {
    const a = brng.range(0, TAU), e = brng.range(4.6, terrain.R0);
    const pt = terrain.pointAt(a, e);
    const z = terrain.zone(pt.x, pt.z);
    if (z.sand > 0.35 && brng.chance(0.85)) continue;
    if (z.rock > 0.35 && brng.chance(0.8)) continue;
    const big = smoothstep(6, 11, e);
    const s = brng.range(0.75, 1.25) * (1 + big * 0.8);
    if (!free(pt.x, pt.z, 0.55 * s)) continue;
    bushSites.push({ x: pt.x, y: pt.y - 0.1, z: pt.z, s, yaw: brng.range(0, TAU), tex: brng.chance(0.5) ? 0 : 1, flower: brng.chance(0.45) });
    occupied.push({ x: pt.x, z: pt.z, r: 0.45 * s });
  }
  // bushes hugging palm bases
  for (const ps of palmSites) {
    if (!brng.chance(0.55)) continue;
    const a = brng.range(0, TAU);
    bushSites.push({ x: ps.x + Math.cos(a) * 0.9, y: H(ps.x + Math.cos(a) * 0.9, ps.z + Math.sin(a) * 0.9) - 0.1, z: ps.z + Math.sin(a) * 0.9, s: brng.range(0.6, 0.9), yaw: brng.range(0, TAU), tex: 0, flower: brng.chance(0.5) });
  }
  const tint = new THREE.Color();
  const bushMeshes = [0, 1].map(ti => {
    const sites = bushSites.filter(b => b.tex === ti);
    const m = new THREE.MeshStandardMaterial({ map: leafTex[ti], alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.78 });
    addWind(m, wind, { height: 1.4, amount: 0.07, stiffness: 1.4, flutter: 0.012 });
    noFlip(m);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTex[ti], alphaTest: 0.45 });
    const mesh = new THREE.InstancedMesh(bushGeo, m, Math.max(1, sites.length));
    mesh.customDepthMaterial = depth;
    mesh.castShadow = true; mesh.receiveShadow = true;
    sites.forEach((b, i) => {
      _q.setFromAxisAngle(UP, b.yaw);
      _m.compose(_p.set(b.x, b.y, b.z), _q, _s.set(b.s, b.s * brng.range(0.8, 1.05), b.s));
      mesh.setMatrixAt(i, _m);
      tint.setHSL(brng.range(0.2, 0.3), brng.range(0.35, 0.6), brng.range(0.55, 0.75));
      mesh.setColorAt(i, tint.lerp(new THREE.Color(1, 1, 1), 0.45));
    });
    mesh.count = sites.length;
    mesh.computeBoundingSphere();
    disposables.push(m, depth);
    group.add(mesh);
    return mesh;
  });

  // hibiscus
  const flowerTex = flowerTexture();
  const flowerGeo = new THREE.PlaneGeometry(0.26, 0.26, 3, 3);
  {
    const p = flowerGeo.attributes.position;
    for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getY(i)); p.setZ(i, r * r * 2.2); }
    flowerGeo.computeVertexNormals();
  }
  const flowerSites = [];
  const fcol = [new THREE.Color('#ff2340'), new THREE.Color('#ff4f8f'), new THREE.Color('#ff7a2a'), new THREE.Color('#ffd23a'), new THREE.Color('#f5f0ff')];
  for (const b of bushSites) {
    if (!b.flower) continue;
    const c = brng.pick(fcol.slice(0, 4));
    const nf = brng.int(3, 7);
    for (let i = 0; i < nf; i++) {
      const y = brng.range(0.0, 0.9), a = brng.range(0, TAU), rr = Math.sqrt(1 - y * y);
      const n = new V3(Math.cos(a) * rr, y, Math.sin(a) * rr);
      const r = 0.82 * b.s;
      flowerSites.push({ p: new V3(b.x + n.x * r, b.y + (n.y * r * 0.8 + 0.55 * b.s), b.z + n.z * r), n, c: brng.chance(0.15) ? fcol[4] : c });
    }
  }
  const flowerMat = new THREE.MeshStandardMaterial({ map: flowerTex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, emissive: 0x220008 });
  const flowers = new THREE.InstancedMesh(flowerGeo, flowerMat, Math.max(1, flowerSites.length));
  flowerSites.forEach((f, i) => {
    _q.setFromUnitVectors(new V3(0, 0, 1), f.n);
    _m.compose(f.p, _q, _s.setScalar(brng.range(0.8, 1.2)));
    flowers.setMatrixAt(i, _m);
    flowers.setColorAt(i, f.c);
  });
  flowers.count = flowerSites.length;
  flowers.layers.set(LAYER_NO_REFLECT);
  group.add(flowers);
  disposables.push(flowerTex, flowerGeo, flowerMat);

  /* ---------------- grass ---------------- */
  const grassTex = grassTexture(rng.int(1, 1e6));
  const grassGeo = buildGrassTuft();
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.85 });
  addWind(grassMat, wind, { height: 0.5, amount: 0.12, stiffness: 1.5, flutter: 0.02 });
  noFlip(grassMat);
  const nGrass = Math.round(2600 * q);
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, nGrass);
  const grng = rng.fork('grass');
  let gi = 0;
  for (let guard = 0; gi < nGrass && guard < nGrass * 8; guard++) {
    const a = grng.range(0, TAU), e = grng.range(4.0, terrain.R0 + 2);
    const pt = terrain.pointAt(a, e);
    const z = terrain.zone(pt.x, pt.z);
    const w = z.grass + z.sand * smoothstep(3.6, 5.4, e) * 0.35;
    if (grng.next() > w) continue;
    _q.setFromAxisAngle(UP, grng.range(0, TAU));
    const s = grng.range(0.7, 1.35) * (z.grass > 0.5 ? 1 : 0.8);
    _m.compose(_p.set(pt.x, pt.y - 0.03, pt.z), _q, _s.set(s, s * grng.range(0.8, 1.3), s));
    grass.setMatrixAt(gi, _m);
    if (z.grass > 0.5) tint.setRGB(grng.range(0.85, 1.05), grng.range(0.95, 1.1), grng.range(0.75, 0.95));
    else tint.setRGB(1.25, 1.15, 0.7); // dry beach grass
    grass.setColorAt(gi, tint);
    gi++;
  }
  grass.count = gi;
  grass.receiveShadow = true;
  grass.layers.set(LAYER_NO_REFLECT);
  grass.computeBoundingSphere();
  group.add(grass);
  disposables.push(grassTex, grassGeo, grassMat);

  /* ---------------- rocks ---------------- */
  const rockGeos = [buildRock(rng.int(1, 1e6)), buildRock(rng.int(1, 1e6)), buildRock(rng.int(1, 1e6), 2)];
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, envMapIntensity: 0.6 });
  patchMaterial(rockMat, {
    key: 'rockTone',
    vertexHeader: 'varying vec3 vRkPos; varying vec3 vRkN;',
    fragmentHeader: 'varying vec3 vRkPos; varying vec3 vRkN;',
    vertex: { '#include <fog_vertex>': '$&\n vRkPos = (mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix); vRkN = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz);' },
    fragment: {
      '#include <color_fragment>': `$&
        float rkTop = smoothstep(0.55, 0.85, vRkN.y);
        vec3 mossC = mix(vec3(0.62, 0.55, 0.38), vec3(0.24, 0.36, 0.12), smoothstep(0.6, 1.4, vRkPos.y));
        diffuseColor.rgb = mix(diffuseColor.rgb, mossC, rkTop * 0.75 * smoothstep(0.25, 0.6, vRkPos.y));
        float rkWet = 1.0 - smoothstep(0.02, 0.32, vRkPos.y);
        diffuseColor.rgb *= mix(1.0, 0.55, rkWet);
        // barnacle speckles near the waterline
        float sp = step(0.82, fract(sin(dot(floor(vRkPos.xz * 22.0 + vRkPos.y * 9.0), vec2(12.9898, 78.233))) * 43758.5453));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.82, 0.75), sp * rkWet * step(-0.3, vRkPos.y) * 0.6);
      `,
      '#include <roughnessmap_fragment>': '$&\n roughnessFactor = mix(roughnessFactor, 0.3, rkWet * step(-0.05, vRkPos.y));',
    },
  });
  addUnderwater(rockMat, { caustics: true, key: 'rock' });
  const rockSites = [[], [], []];
  const rrng = rng.fork('rocks');
  const hill = terrain.hill;
  // hill outcrop
  for (let i = 0; i < Math.round(lerp(6, 10, q)); i++) {
    const a = rrng.range(0, TAU), d = rrng.range(0.3, hill.r * 1.1);
    const x = hill.x + Math.cos(a) * d, z = hill.z + Math.sin(a) * d;
    const s = rrng.range(1.2, 2.8) * (1 - d / (hill.r * 1.7));
    rockSites[rrng.int(0, 2)].push({ x, y: H(x, z) - 0.25 * s, z, s, ys: rrng.range(0.8, 1.3) });
    occupied.push({ x, z, r: s * 0.8 });
  }
  // beach + shoreline rocks (some in the water → foam)
  const nBeachRocks = Math.round(lerp(8, 14, q));
  for (let i = 0, guard = 0; i < nBeachRocks && guard < 300; guard++) {
    const a = rrng.range(0, TAU), e = rrng.range(-3.2, 2.5);
    const da = Math.abs(Math.atan2(Math.sin(a - terrain.dockAng), Math.cos(a - terrain.dockAng))) * terrain.R0;
    if (da < 3) continue;
    const pt = terrain.pointAt(a, e);
    const s = rrng.range(0.35, 1.15);
    if (!free(pt.x, pt.z, s * 0.7)) continue;
    // cluster of 1–3
    const nn = rrng.int(1, 3);
    for (let k = 0; k < nn; k++) {
      const x = pt.x + rrng.range(-0.9, 0.9) * (k ? 1 : 0), z = pt.z + rrng.range(-0.9, 0.9) * (k ? 1 : 0);
      const sk = s * (k ? rrng.range(0.4, 0.75) : 1);
      const y = H(x, z) - 0.12 * sk;
      rockSites[rrng.int(0, 2)].push({ x, y, z, s: sk, ys: rrng.range(0.7, 1.1) });
      occupied.push({ x, z, r: sk * 0.75 });
      if (y < 0.2 && y + sk * 0.55 > -0.2) terrain.addObstacle(x, z, sk * 0.9, 1);
    }
    i++;
  }
  // coral heads / boulders in the lagoon
  for (let i = 0; i < Math.round(lerp(5, 9, q)); i++) {
    const a = rrng.range(0, TAU), u = rrng.range(4, 9);
    const pt = terrain.pointAt(a, -u);
    const s = rrng.range(0.5, 1.1);
    rockSites[2].push({ x: pt.x, y: pt.y - 0.3 * s, z: pt.z, s, ys: 0.55, coral: true });
  }
  const rockMeshes = rockGeos.map((g, i) => {
    const sites = rockSites[i];
    const mesh = new THREE.InstancedMesh(g, rockMat, Math.max(1, sites.length));
    sites.forEach((r, k) => {
      _e.set(rrng.range(-0.3, 0.3), rrng.range(0, TAU), rrng.range(-0.3, 0.3));
      _q.setFromEuler(_e);
      _m.compose(_p.set(r.x, r.y, r.z), _q, _s.set(r.s, r.s * r.ys, r.s * rrng.range(0.8, 1.2)));
      mesh.setMatrixAt(k, _m);
      mesh.setColorAt(k, r.coral ? rrng.pick(CORAL) : WHITE);
    });
    mesh.count = sites.length;
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    return mesh;
  });
  disposables.push(rockMat, ...rockGeos);

  /* ---------------- shells, starfish, fallen coconuts, driftwood ---------------- */
  const srng = rng.fork('shells');
  const starGeo = buildStarfish();
  const starMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  addUnderwater(starMat, { caustics: false, key: 'star' });
  const nStar = Math.round(lerp(10, 18, q));
  const stars = new THREE.InstancedMesh(starGeo, starMat, nStar);
  const starCols = ['#ff6a2b', '#e8452f', '#ff9a3c', '#b64a9a', '#f2b45a'].map(c => new THREE.Color(c));
  for (let i = 0; i < nStar; i++) {
    const under = i % 2 === 1;
    const pt = terrain.beachPoint(srng, under ? -5 : 0.6, under ? -1.2 : 4.2);
    _q.setFromAxisAngle(UP, srng.range(0, TAU));
    _m.compose(_p.set(pt.x, pt.y + 0.005, pt.z), _q, _s.setScalar(srng.range(0.9, 1.4)));
    stars.setMatrixAt(i, _m);
    stars.setColorAt(i, srng.pick(starCols));
  }
  stars.layers.set(LAYER_NO_REFLECT);
  stars.receiveShadow = true;
  group.add(stars);

  const shellGeo = buildShell();
  const shellMat = new THREE.MeshStandardMaterial({ roughness: 0.45 });
  addUnderwater(shellMat, { key: 'shell' });
  const nShell = Math.round(lerp(16, 30, q));
  const shells = new THREE.InstancedMesh(shellGeo, shellMat, nShell);
  const shellCols = ['#fff3e6', '#ffd9cf', '#f7e3c4', '#ffc4b8', '#efe8ff'].map(c => new THREE.Color(c));
  for (let i = 0; i < nShell; i++) {
    const pt = terrain.beachPoint(srng, -1.5, 3.5);
    _e.set(srng.range(-0.2, 0.2), srng.range(0, TAU), srng.range(-0.2, 0.2));
    _q.setFromEuler(_e);
    _m.compose(_p.set(pt.x, pt.y + 0.01, pt.z), _q, _s.setScalar(srng.range(0.9, 1.6)));
    shells.setMatrixAt(i, _m);
    shells.setColorAt(i, srng.pick(shellCols));
  }
  shells.layers.set(LAYER_NO_REFLECT);
  shells.receiveShadow = true;
  group.add(shells);

  const fallenGeo = new THREE.SphereGeometry(0.14, 10, 8);
  fallenGeo.scale(1, 0.9, 1.15);
  const fallenMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.8 });
  const fallenSites = [];
  for (const ps of palmSites) {
    if (ps.s < 0.8) continue;
    const n = srng.int(0, 2);
    for (let k = 0; k < n; k++) {
      const a = srng.range(0, TAU), d = srng.range(0.8, 2.2);
      const x = ps.x + Math.cos(a) * d, z = ps.z + Math.sin(a) * d;
      if (H(x, z) < 0.1) continue;
      fallenSites.push({ x, y: H(x, z) + 0.08, z, green: srng.chance(0.4) });
    }
  }
  const fallen = new THREE.InstancedMesh(fallenGeo, fallenMat, Math.max(1, fallenSites.length));
  fallenSites.forEach((f, i) => {
    _q.setFromEuler(_e.set(srng.range(0, TAU), srng.range(0, TAU), 0));
    _m.compose(_p.set(f.x, f.y, f.z), _q, _s.setScalar(1));
    fallen.setMatrixAt(i, _m);
    fallen.setColorAt(i, f.green ? new THREE.Color('#9fb05a') : new THREE.Color('#ffffff'));
  });
  fallen.count = fallenSites.length;
  fallen.castShadow = true;
  fallen.layers.set(LAYER_NO_REFLECT);
  group.add(fallen);
  disposables.push(starGeo, starMat, shellGeo, shellMat, fallenGeo, fallenMat);

  const driftTex = woodTexture(rng.int(1, 1e6), { base: [196, 186, 170], planks: 1 });
  const driftMat = new THREE.MeshStandardMaterial({ map: driftTex, roughness: 0.92 });
  const nDrift = rng.int(2, 3);
  for (let i = 0; i < nDrift; i++) {
    const g = buildDriftwood(rng.fork('drift' + i));
    const pt = terrain.beachPoint(srng, 1.0, 3.6, undefined, 4);
    const m = new THREE.Mesh(g, driftMat);
    m.position.set(pt.x, pt.y + 0.04, pt.z);
    m.rotation.y = srng.range(0, TAU);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    disposables.push(g);
  }
  disposables.push(driftTex, driftMat);

  return {
    group, palmTops, palmSites, rockSites: rockSites.flat(), occupied,
    dispose() { disposables.forEach(d => d.dispose && d.dispose()); },
  };
}
