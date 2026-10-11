// 云海 · floating islets with ruins, grass, trees, a mist-fall and giant silhouettes in the haze.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, smoothstep, createNoise, addWind } from '../../lib/util.js';
import { patchStd, SHARED_GLSL, CLOUD_TOP } from './common.js';

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */
const BUMP_HEADER = /* glsl */`
uniform sampler2D tNoise;
uniform float uBump, uBumpScale, uMossAmt;
float rockH(vec3 p, vec3 n){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  vec3 q = p * uBumpScale;
  float a = texture2D(tNoise, q.zy).g * w.x + texture2D(tNoise, q.xz).g * w.y + texture2D(tNoise, q.xy).g * w.z;
  float b = texture2D(tNoise, q.zy * 3.1).b * w.x + texture2D(tNoise, q.xz * 3.1).b * w.y + texture2D(tNoise, q.xy * 3.1).b * w.z;
  float strata = sin(p.y * 3.1 + a * 6.0) * 0.5 + 0.5;
  return a * 0.55 + b * 0.25 + strata * 0.35 * (1.0 - w.y);
}
`;
/** Rock/stone: vertex colours + triplanar procedural bump, moss on top faces, sky fog. */
export function stoneMaterial(shared, tex, { bump = 0.6, scale = 0.18, moss = 0.6, roughness = 0.9, color = 0xffffff, key = 'stone' } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0, color });
  return patchStd(m, shared, {
    key,
    uniforms: { tNoise: { value: tex.noise }, uBump: { value: bump }, uBumpScale: { value: scale }, uMossAmt: { value: moss } },
    fragmentHeader: BUMP_HEADER,
    fragment: {
      '#include <color_fragment>': /* glsl */`$&
        vec3 wN0 = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
        float rh = rockH(vWPos, wN0);
        diffuseColor.rgb *= 0.78 + 0.42 * rh;
        float mossy = smoothstep(0.55, 0.9, wN0.y + (rh - 0.5) * 0.6) * uMossAmt;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.42, 0.2) * (0.8 + 0.4 * rh), mossy * 0.75);
      `,
      '#include <normal_fragment_maps>': /* glsl */`$&
        {
          vec3 vp = -vViewPosition;
          vec3 dpx = dFdx(vp), dpy = dFdy(vp);
          float dhx = dFdx(rh), dhy = dFdy(rh);
          vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
          float det = dot(dpx, r1);
          vec3 sg = sign(det) * (dhx * r1 + dhy * r2);
          normal = normalize(abs(det) * normal - sg * uBump);
        }
      `,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Islet geometry                                                      */
/* ------------------------------------------------------------------ */
const _c = new THREE.Color();
/**
 * Floating islet: a grassy, slightly domed top with a rounded lip and a rocky, stratified,
 * multi-lobed underside tapering into hanging spikes. Returns { geometry, topY(x,z), rimR(angle) }.
 */
export function makeIslet(rng, { radius = 10, depth = 18, nT = 44, nA = 88, grassColor = '#6f8f3e', rock = ['#b59c88', '#8f7a72', '#6a5a62'], lobes = 3 } = {}) {
  const noise = createNoise(rng.int(1, 1e9));
  const ph = rng.range(0, TAU), ph2 = rng.range(0, TAU);
  const rimR = a => radius * (1 + 0.09 * Math.sin(a * 2 + ph) + 0.06 * Math.sin(a * 3 + ph2) + 0.05 * noise.noise2(Math.cos(a) * 1.3, Math.sin(a) * 1.3));
  const topY = (x, z) => {
    const r = Math.hypot(x, z) / radius;
    return 0.35 * (1 - r * r) + 0.28 * noise.fbm2(x * 0.09, z * 0.09, 3) + 0.08 * noise.noise2(x * 0.4, z * 0.4);
  };
  const tTop = 0.34, tRim = 0.44, lip = Math.min(1.1, radius * 0.11);
  const lobePh = rng.range(0, TAU), lobeK = lobes;
  const pos = [], col = [];
  const grassA = new THREE.Color(grassColor), grassB = new THREE.Color(grassColor).offsetHSL(0.03, -0.05, 0.08);
  const rockA = new THREE.Color(rock[0]), rockB = new THREE.Color(rock[1]), rockC = new THREE.Color(rock[2]);
  const dirt = new THREE.Color('#7a6150');
  const pushV = (x, y, z, c) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); };
  // centre vertex
  _c.copy(grassA); pushV(0, topY(0, 0), 0, _c);
  for (let i = 1; i <= nT; i++) {
    const t = i / nT;
    for (let j = 0; j < nA; j++) {
      const a = (j / nA) * TAU;
      const R = rimR(a);
      const ca = Math.cos(a), sa = Math.sin(a);
      let r, y;
      const lob = Math.pow(Math.max(0, Math.cos(lobeK * a + lobePh)), 2);
      if (t <= tTop) {
        r = (t / tTop) * R; y = topY(ca * r, sa * r);
        const n = noise.noise2(ca * r * 0.25, sa * r * 0.25) * 0.5 + 0.5;
        _c.copy(grassA).lerp(grassB, n);
        _c.lerp(dirt, smoothstep(0.85, 1, t / tTop) * 0.35);
      } else if (t <= tRim) {
        const s = (t - tTop) / (tRim - tTop);
        const ang = s * Math.PI * 0.5;
        r = R + Math.sin(ang) * lip * 0.35; y = topY(ca * R, sa * R) - (1 - Math.cos(ang)) * lip;
        _c.copy(grassA).lerp(dirt, smoothstep(0.1, 0.8, s));
      } else {
        const s = (t - tRim) / (1 - tRim);
        const depthHere = depth * (0.72 + 0.4 * lob) * (0.9 + 0.2 * noise.noise2(ca * 2, sa * 2));
        const prof = Math.pow(1 - s, 0.85 + 0.5 * lob) * (1 + 0.12 * Math.sin(s * Math.PI));
        r = (R + lip * 0.35) * prof * (1 - 0.22 * (1 - lob) * s);
        y = topY(ca * R, sa * R) - lip - s * depthHere;
        // strata ledges and vertical gullies
        const n3 = noise.fbm3(ca * 2.2, y * 0.18, sa * 2.2, 4);
        const gully = Math.abs(noise.noise2(a * 6, y * 0.05));
        r *= 1 + 0.16 * n3 - 0.07 * gully + 0.04 * Math.sin(y * 1.9 + n3 * 3);
        const band = 0.5 + 0.5 * Math.sin(y * 1.3 + n3 * 4);
        _c.copy(rockA).lerp(rockB, band * 0.7).lerp(rockC, smoothstep(0.25, 1.0, s) * 0.85);
        _c.lerp(grassA, smoothstep(0.12, 0.0, s) * 0.55 * (0.5 + 0.5 * noise.noise2(a * 5, 0.3)));
      }
      pushV(ca * r, y, sa * r, _c);
    }
  }
  // tip vertex
  pushV(0, -depth * 1.02, 0, rockC);
  const idx = [];
  for (let j = 0; j < nA; j++) idx.push(0, 1 + ((j + 1) % nA), 1 + j);
  for (let i = 1; i < nT; i++) {
    const a0 = 1 + (i - 1) * nA, a1 = 1 + i * nA;
    for (let j = 0; j < nA; j++) {
      const j1 = (j + 1) % nA;
      idx.push(a0 + j, a0 + j1, a1 + j, a0 + j1, a1 + j1, a1 + j);
    }
  }
  const tip = pos.length / 3 - 1, last = 1 + (nT - 1) * nA;
  for (let j = 0; j < nA; j++) idx.push(last + j, last + ((j + 1) % nA), tip);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return { geometry: g, topY, rimR, radius, depth };
}

/* ------------------------------------------------------------------ */
/* Ruins                                                               */
/* ------------------------------------------------------------------ */
function prep(geo, color, { ao = 0.35, jitter = 0.05, rng } = {}) {
  geo = geo.index ? geo : geo;
  geo.deleteAttribute('uv');
  geo.computeBoundingBox();
  const bb = geo.boundingBox, p = geo.getAttribute('position');
  const n = p.count, c = new Float32Array(n * 3);
  const base = new THREE.Color(color);
  if (rng) base.offsetHSL(rng.range(-0.01, 0.01), rng.range(-jitter, jitter) * 0.5, rng.range(-jitter, jitter));
  const h = Math.max(bb.max.y - bb.min.y, 1e-3);
  for (let i = 0; i < n; i++) {
    const t = (p.getY(i) - bb.min.y) / h;
    const k = 1 - ao * (1 - smoothstep(0, 0.35, t));
    c[i * 3] = base.r * k; c[i * 3 + 1] = base.g * k; c[i * 3 + 2] = base.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function place(geo, x, y, z, rx = 0, ry = 0, rz = 0, s = 1) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _s.set(s, s, s); _p.set(x, y, z);
  geo.applyMatrix4(_m.compose(_p, _q, _s));
  return geo;
}

function column(rng, list, x, y, z, h, { r = 0.17, broken = 0, tilt = 0, yaw = 0, color = '#d9cbb8' } = {}) {
  const parts = [];
  parts.push(prep(new THREE.CylinderGeometry(r * 1.55, r * 1.7, 0.18, 14), color, { rng }).translate(0, 0.09, 0));
  parts.push(prep(new THREE.CylinderGeometry(r * 1.32, r * 1.45, 0.12, 14), color, { rng }).translate(0, 0.24, 0));
  const shaftH = h * (broken ? rng.range(0.35, 0.75) : 1);
  const shaft = new THREE.CylinderGeometry(r * 0.9, r, shaftH, 16, 6);
  // fluting
  const sp = shaft.getAttribute('position');
  for (let i = 0; i < sp.count; i++) {
    const vx = sp.getX(i), vz = sp.getZ(i), a = Math.atan2(vz, vx), rr = Math.hypot(vx, vz);
    if (rr < 1e-4) continue;
    const k = 1 - 0.045 * Math.pow(Math.abs(Math.cos(a * 8)), 3);
    sp.setX(i, vx * k); sp.setZ(i, vz * k);
  }
  shaft.computeVertexNormals();
  parts.push(prep(shaft, color, { rng, ao: 0.15 }).translate(0, 0.3 + shaftH / 2, 0));
  if (!broken) {
    parts.push(prep(new THREE.CylinderGeometry(r * 1.45, r * 0.95, 0.2, 14), color, { rng }).translate(0, 0.3 + shaftH + 0.1, 0));
    parts.push(prep(new THREE.BoxGeometry(r * 3.2, 0.14, r * 3.2), color, { rng }).translate(0, 0.3 + shaftH + 0.27, 0));
  } else {
    // jagged broken top
    const cap = new THREE.CylinderGeometry(r * 0.9, r * 0.9, 0.3, 10, 1);
    const cp = cap.getAttribute('position');
    for (let i = 0; i < cp.count; i++) if (cp.getY(i) > 0) cp.setY(i, cp.getY(i) + rng.range(-0.25, 0.2) + cp.getX(i) * 0.8);
    cap.computeVertexNormals();
    parts.push(prep(cap, color, { rng, ao: 0 }).translate(0, 0.3 + shaftH + 0.1, 0));
  }
  const g = mergeGeometries(parts);
  place(g, x, y, z, tilt, yaw, tilt * 0.5);
  list.push(g);
  return 0.3 + shaftH;
}

function arch(rng, list, x, y, z, yaw, { span = 3.2, h = 3.4, broken = true, color = '#d2c3ae' } = {}) {
  const parts = [];
  const half = span / 2;
  for (const sx of [-1, 1]) {
    parts.push(prep(new THREE.BoxGeometry(0.62, 0.22, 0.62), color, { rng }).translate(sx * half, 0.11, 0));
    parts.push(prep(new THREE.BoxGeometry(0.48, h, 0.48, 1, 4, 1), color, { rng, ao: 0.2 }).translate(sx * half, 0.22 + h / 2, 0));
    parts.push(prep(new THREE.BoxGeometry(0.6, 0.16, 0.6), color, { rng }).translate(sx * half, 0.22 + h + 0.08, 0));
  }
  // voussoirs on a semicircle, some missing
  const n = 11, R = half, cy = 0.22 + h + 0.16;
  for (let i = 0; i < n; i++) {
    if (broken && i >= 7 && i !== 10) continue;
    const a0 = Math.PI - (i / n) * Math.PI, a1 = Math.PI - ((i + 1) / n) * Math.PI, am = (a0 + a1) / 2;
    const b = new THREE.BoxGeometry(0.46, (R * Math.PI) / n * 0.96, 0.5);
    prep(b, color, { rng, ao: 0 });
    b.rotateZ(am - Math.PI / 2 + Math.PI / 2);
    b.translate(Math.cos(am) * (R), cy + Math.sin(am) * (R), 0);
    parts.push(b);
  }
  if (broken) {
    // the fallen keystone pieces at the foot
    for (let i = 0; i < 3; i++) parts.push(place(prep(new THREE.BoxGeometry(0.46, 0.5, 0.5), color, { rng }), half + rng.range(0.3, 1.4), 0.2, rng.range(-0.8, 0.8), rng.range(-0.4, 0.4), rng.range(0, 3), rng.range(0.6, 1.4)));
  }
  const g = mergeGeometries(parts);
  place(g, x, y, z, 0, yaw, 0);
  list.push(g);
}

function temple(rng, stoneList, accentList, x, y, z, yaw, color = '#ddd0bd') {
  const parts = [];
  const steps = [[3.5, 0.28], [3.1, 0.28], [2.72, 0.3]];
  let sy = 0;
  for (const [r, h] of steps) { parts.push(prep(new THREE.CylinderGeometry(r, r + 0.06, h, 40), color, { rng, ao: 0.25 }).translate(0, sy + h / 2, 0)); sy += h; }
  const colH = 2.7, ringY = sy + 0.3 + colH + 0.34;
  const cols = 8;
  const local = [];
  for (let i = 0; i < cols; i++) {
    const a = (i / cols) * TAU + Math.PI / cols;
    const broken = i === 3;
    column(rng, local, Math.cos(a) * 2.28, sy, Math.sin(a) * 2.28, colH, { r: 0.16, broken, color });
    if (broken) {
      // its fallen drum lies on the steps
      parts.push(place(prep(new THREE.CylinderGeometry(0.15, 0.16, 1.1, 14), color, { rng }), Math.cos(a) * 3.6, 0.3, Math.sin(a) * 3.6 + 0.4, Math.PI / 2, a + 0.6, 0));
    }
  }
  // entablature ring
  const ringShape = [new THREE.Vector2(2.0, 0), new THREE.Vector2(2.62, 0), new THREE.Vector2(2.62, 0.16), new THREE.Vector2(2.55, 0.2), new THREE.Vector2(2.55, 0.42), new THREE.Vector2(2.68, 0.48), new THREE.Vector2(2.68, 0.58), new THREE.Vector2(2.0, 0.58)];
  parts.push(prep(new THREE.LatheGeometry(ringShape, 48), color, { rng, ao: 0.1 }).translate(0, ringY - 0.32, 0));
  // dome (slightly ogival) in pale stone with a gold finial
  const domeR = 2.42, domePts = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; const a = t * Math.PI / 2; domePts.push(new THREE.Vector2(Math.cos(a) * domeR * (1 - 0.06 * t), Math.sin(a) * domeR * 1.08)); }
  const dome = new THREE.LatheGeometry(domePts, 48);
  parts.push(prep(dome, '#e6dccb', { rng, ao: 0.05 }).translate(0, ringY + 0.26, 0));
  const topY = ringY + 0.26 + domeR * 1.08;
  const g = mergeGeometries([...parts, ...local]);
  place(g, x, y, z, 0, yaw, 0);
  stoneList.push(g);
  // gold accents: finial + a band on the dome
  const acc = [];
  acc.push(new THREE.CylinderGeometry(0.07, 0.16, 0.5, 12).translate(0, topY + 0.2, 0));
  acc.push(new THREE.SphereGeometry(0.16, 16, 10).translate(0, topY + 0.55, 0));
  acc.push(new THREE.ConeGeometry(0.06, 0.55, 10).translate(0, topY + 0.95, 0));
  acc.push(new THREE.TorusGeometry(2.33, 0.05, 6, 64).rotateX(Math.PI / 2).translate(0, ringY + 0.62, 0));
  for (const a of acc) { a.deleteAttribute('uv'); }
  const ga = mergeGeometries(acc);
  place(ga, x, y, z, 0, yaw, 0);
  accentList.push(ga);
  return { floorY: y + sy, ringY: y + ringY, topY: y + topY };
}

/* ------------------------------------------------------------------ */
/* Trees                                                               */
/* ------------------------------------------------------------------ */
function taperedTube(curve, r0, r1, segs = 10, radial = 7) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], idx = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p);
    const r = lerp(r0, r1, Math.pow(t, 0.8));
    const N = frames.normals[i], B = frames.binormals[i];
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * TAU;
      pos.push(p.x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * r, p.y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * r, p.z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * r);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * radial + j, b = i * radial + (j + 1) % radial, c = (i + 1) * radial + j, d = (i + 1) * radial + (j + 1) % radial;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function blob(rng, noise, r, detail = 2) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.getAttribute('position');
  const o = rng.range(0, 100);
  for (let i = 0; i < p.count; i++) {
    _p.fromBufferAttribute(p, i);
    const n = noise.noise3(_p.x / r * 1.3 + o, _p.y / r * 1.3, _p.z / r * 1.3);
    const k = 1 + n * 0.22 - (_p.y < 0 ? 0.25 * (-_p.y / r) : 0);
    p.setXYZ(i, _p.x * k, _p.y * k * 0.85, _p.z * k);
  }
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  return mergeVerticesSafe(g);
}
function mergeVerticesSafe(g) { return g; }

/** Stylised tree: tapered trunk with branches and lumpy canopy clusters. */
function makeTree(rng, noise, { h = 4.5, canopy = '#5f8f3c', canopy2 = '#9dbb54', bark = '#6b5446', clusters = 6, spread = 1.6 } = {}) {
  const trunkParts = [], leafParts = [];
  const lean = new THREE.Vector3(rng.range(-0.5, 0.5), 0, rng.range(-0.5, 0.5));
  const pts = [new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(lean.x * 0.3, h * 0.35, lean.z * 0.3), new THREE.Vector3(lean.x * 0.7 - lean.z * 0.3, h * 0.7, lean.z * 0.7 + lean.x * 0.3), new THREE.Vector3(lean.x, h, lean.z)];
  const trunk = new THREE.CatmullRomCurve3(pts);
  trunkParts.push(prep(taperedTube(trunk, h * 0.07, h * 0.022, 12, 8), bark, { ao: 0.3 }));
  const tips = [pts[3].clone()];
  for (let i = 0; i < clusters - 1; i++) {
    const t = rng.range(0.5, 0.9);
    const o = trunk.getPointAt(t);
    const a = rng.next() * TAU;
    const len = h * rng.range(0.25, 0.42);
    const end = o.clone().add(new THREE.Vector3(Math.cos(a) * len, len * rng.range(0.35, 0.8), Math.sin(a) * len));
    const mid = o.clone().lerp(end, 0.5).add(new THREE.Vector3(0, len * 0.15, 0));
    trunkParts.push(prep(taperedTube(new THREE.CatmullRomCurve3([o, mid, end]), h * 0.03, h * 0.012, 6, 6), bark, { ao: 0.1 }));
    tips.push(end);
  }
  const cA = new THREE.Color(canopy), cB = new THREE.Color(canopy2);
  for (const tp of tips) {
    const n = rng.int(2, 3);
    for (let k = 0; k < n; k++) {
      const r = h * rng.range(0.2, 0.3) * spread * 0.62;
      const b = blob(rng, noise, r, 2);
      b.translate(tp.x + rng.range(-0.4, 0.4) * r, tp.y + rng.range(-0.1, 0.35) * r, tp.z + rng.range(-0.4, 0.4) * r);
      // colour: darker underneath / inside, sun-bleached on top
      const p = b.getAttribute('position'), nn = b.getAttribute('normal');
      const c = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) {
        const up = nn.getY(i) * 0.5 + 0.5;
        const v = noise.noise3(p.getX(i) * 0.9, p.getY(i) * 0.9, p.getZ(i) * 0.9) * 0.5 + 0.5;
        _c.copy(cA).lerp(cB, clamp(up * 0.75 + v * 0.35 - 0.15, 0, 1)).multiplyScalar(0.55 + 0.45 * up);
        c[i * 3] = _c.r; c[i * 3 + 1] = _c.g; c[i * 3 + 2] = _c.b;
      }
      b.setAttribute('color', new THREE.BufferAttribute(c, 3));
      leafParts.push(b);
    }
  }
  return { trunk: mergeGeometries(trunkParts), leaves: mergeGeometries(leafParts), height: h };
}

/* ------------------------------------------------------------------ */
/* Grass                                                               */
/* ------------------------------------------------------------------ */
function bladeGeometry() {
  const segs = 4, w = 0.075, pos = [], col = [], nor = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const ww = w * (1 - t) * (1 - t * 0.2);
    const bend = t * t * 0.18;
    pos.push(-ww, t, bend, ww, t, bend);
    const k = 0.35 + 0.65 * t;
    col.push(k, k, k, k, k, k);
    nor.push(0, 1, 0, 0, 1, 0);
  }
  for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

/* ------------------------------------------------------------------ */
/* Mist-fall                                                           */
/* ------------------------------------------------------------------ */
const MIST_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vW;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const MIST_FRAG = /* glsl */`
${SHARED_GLSL}
uniform sampler2D tNoise;
uniform float uSpeed, uOpacity;
varying vec2 vUv; varying vec3 vW;
void main(){
  float u = vUv.x, v = vUv.y;   // u across, v along the fall (0 lip .. 1 bottom)
  float s1 = texture2D(tNoise, vec2(u * 1.3, v * 2.2 - uTime * uSpeed)).r;
  float s2 = texture2D(tNoise, vec2(u * 3.1 + 0.3, v * 5.0 - uTime * uSpeed * 1.6)).g;
  float s3 = texture2D(tNoise, vec2(u * 7.0, v * 9.0 - uTime * uSpeed * 2.3)).b;
  float streak = clamp(s1 * 0.55 + s2 * 0.45 + s3 * 0.3 - 0.35, 0.0, 1.0);
  float across = smoothstep(0.0, 0.3, u) * smoothstep(1.0, 0.7, u);
  float along = smoothstep(0.0, 0.05, v) * (1.0 - smoothstep(0.55, 1.0, v));
  float a = streak * across * along * uOpacity * (1.25 - v * 0.6);
  vec3 V = normalize(cameraPosition - vW);
  float fwd = pow(max(dot(-V, uLightDir), 0.0), 5.0);
  vec3 col = vec3(0.95) * (uAmbient * 1.2 + uLightCol * (0.55 + 1.6 * fwd)) + uBounce * 0.2;
  col = mix(col, hazeColor(-V), fogAmountAt(vW));
  gl_FragColor = vec4(col * a, a);
}`;

function mistFall(shared, tex, start, outward, height, width0, width1) {
  const segs = 40, across = 8, pos = [], uv = [], idx = [];
  const side = new THREE.Vector3(-outward.z, 0, outward.x);
  for (let i = 0; i <= segs; i++) {
    const v = i / segs;
    const out = (1 - Math.exp(-v * 5)) * 2.2 + v * 1.5;
    const y = -Math.pow(v, 1.6) * height;
    const w = lerp(width0, width1, Math.pow(v, 0.8));
    for (let j = 0; j <= across; j++) {
      const u = j / across;
      const curl = Math.sin(u * Math.PI) * w * 0.35; // curved sheet
      const c = start.clone().addScaledVector(outward, out + curl).addScaledVector(side, (u - 0.5) * w);
      c.y += y;
      pos.push(c.x, c.y, c.z); uv.push(u, v);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < across; j++) {
    const a = i * (across + 1) + j, b = a + 1, c = a + across + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: Object.assign({}, shared, { tNoise: { value: tex.noise }, uSpeed: { value: 0.32 }, uOpacity: { value: 0.75 } }),
    vertexShader: MIST_VERT, fragmentShader: MIST_FRAG,
    transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 2;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Pool water (the spring that feeds the mist-fall)                    */
/* ------------------------------------------------------------------ */
function poolMaterial(shared, tex) {
  const m = new THREE.MeshStandardMaterial({ color: '#2d4f5e', roughness: 0.06, metalness: 0.1, envMapIntensity: 1.2 });
  return patchStd(m, shared, {
    key: 'pool',
    uniforms: { tNoise: { value: tex.noise } },
    fragmentHeader: 'uniform sampler2D tNoise;',
    fragment: {
      '#include <normal_fragment_maps>': /* glsl */`$&
        vec2 pq = vWPos.xz * 0.35;
        vec3 n1 = texture2D(tNoise, pq + uTime * 0.02).rgb - 0.5;
        vec3 n2 = texture2D(tNoise, pq * 1.7 - uTime * 0.03).gba - 0.5;
        normal = normalize(normal + (viewMatrix * vec4(n1.x + n2.y, 0.0, n1.y + n2.x, 0.0)).xyz * 0.35);
      `,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Build everything                                                    */
/* ------------------------------------------------------------------ */
export function createIslands(env, shared, tex) {
  const rng = env.rng.fork('islands');
  const q = env.q;
  const group = new THREE.Group();
  const noise = createNoise(rng.int(1, 1e9));
  const pickables = [];
  const colliders = [];   // spheres creatures steer around: { c: Vector3, r }
  const casters = [];     // big shadow casters for the cloud shader
  const bobbers = [];     // { obj, base, amp, speed, phase }
  const wind = env.wind;
  const updaters = [];

  const rockMat = stoneMaterial(shared, tex, { key: 'rock', bump: 0.9, scale: 0.12, moss: 0.55 });
  const ruinMat = stoneMaterial(shared, tex, { key: 'ruin', bump: 0.35, scale: 0.35, moss: 0.35, roughness: 0.82 });
  const goldMat = patchStd(new THREE.MeshStandardMaterial({ color: '#d8a64a', metalness: 1, roughness: 0.32, envMapIntensity: 1.3 }), shared, { key: 'gold' });
  const barkMat = stoneMaterial(shared, tex, { key: 'bark', bump: 0.5, scale: 0.9, moss: 0.2, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  addWind(leafMat, wind, { height: 6, amount: 0.12, stiffness: 1.2, flutter: 0.02, key: 'leafwind' });
  patchStd(leafMat, shared, {
    key: 'leaf',
    fragment: {
      // soft translucency when backlit
      '#include <lights_fragment_end>': /* glsl */`$&
        {
          vec3 Vw = normalize(cameraPosition - vWPos);
          float bl = pow(max(dot(-Vw, uLightDir), 0.0), 3.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uLightCol * bl * 0.9;
        }
      `,
    },
  });

  /* ---- main islet ---- */
  const mainR = 11.5, mainD = 21;
  const main = makeIslet(rng, { radius: mainR, depth: mainD, nT: Math.round(lerp(30, 52, q)), nA: Math.round(lerp(60, 110, q)), lobes: 3 });
  const mainMesh = new THREE.Mesh(main.geometry, rockMat);
  mainMesh.castShadow = env.shadows; mainMesh.receiveShadow = env.shadows;
  group.add(mainMesh);
  pickables.push(mainMesh);
  colliders.push({ c: new THREE.Vector3(0, -4, 0), r: mainR + 2.5 }, { c: new THREE.Vector3(0, -14, 0), r: mainR * 0.6 + 2 }, { c: new THREE.Vector3(0, 3, 0), r: 7.5 });
  casters.push(new THREE.Vector4(0, -6, 0, mainR * 0.95));

  // Layout on the top (local = world for the main islet)
  const tY = (x, z) => main.topY(x, z);
  const templePos = new THREE.Vector3(-2.6, 0, -1.2);
  templePos.y = tY(templePos.x, templePos.z) - 0.05;
  const stoneGeos = [], accentGeos = [];
  const tInfo = temple(rng, stoneGeos, accentGeos, templePos.x, templePos.y, templePos.z, rng.range(0, TAU));
  const reserved = [{ x: templePos.x, z: templePos.z, r: 3.8 }];

  // broken arch near the rim, framing the view
  const archA = rng.range(0.15, 0.6);
  const archP = new THREE.Vector3(Math.cos(archA) * 7.8, 0, Math.sin(archA) * 7.8);
  archP.y = tY(archP.x, archP.z) - 0.1;
  arch(rng, stoneGeos, archP.x, archP.y, archP.z, -archA + Math.PI / 2 + 0.25, { span: 3.0, h: 3.0 });
  reserved.push({ x: archP.x, z: archP.z, r: 2.2 });

  // free-standing columns (some broken), and fallen drums
  const colSpots = [];
  for (let i = 0; i < 6; i++) {
    const a = rng.range(0, TAU), rr = rng.range(4.5, 9.2);
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (reserved.some(r => Math.hypot(r.x - x, r.z - z) < r.r + 1.2) || colSpots.some(p => Math.hypot(p.x - x, p.z - z) < 2.4)) continue;
    colSpots.push({ x, z });
    const broken = i % 2 === 1;
    column(rng, stoneGeos, x, tY(x, z) - 0.08, z, rng.range(2.6, 3.8), { r: rng.range(0.19, 0.26), broken, tilt: rng.range(-0.06, 0.06), yaw: rng.range(0, TAU) });
    if (broken) stoneGeos.push(place(prep(new THREE.CylinderGeometry(0.22, 0.23, rng.range(0.7, 1.2), 14), '#d4c6b2', { rng }), x + rng.range(0.8, 1.4), tY(x, z) + 0.15, z + rng.range(-0.8, 0.8), Math.PI / 2, rng.range(0, TAU), 0.1));
    reserved.push({ x, z, r: 0.6 });
  }

  // stairs from the temple platform down to the rim, then floating steps into the void
  const stairA = rng.range(Math.PI * 0.95, Math.PI * 1.35);
  const sd = new THREE.Vector3(Math.cos(stairA), 0, Math.sin(stairA));
  const stairStart = templePos.clone().addScaledVector(sd, 3.6);
  for (let i = 0; i < 9; i++) {
    const p = stairStart.clone().addScaledVector(sd, i * 0.85);
    const ground = Math.hypot(p.x, p.z) < main.rimR(Math.atan2(p.z, p.x)) * 0.92 ? tY(p.x, p.z) : null;
    let y = templePos.y + 0.7 - i * 0.28;
    if (ground !== null) y = Math.max(y, ground - 0.15);
    else y -= (i - 5) * 0.35;
    const step = prep(new THREE.BoxGeometry(1.9, 0.26, 0.8), '#d6c8b4', { rng, ao: 0.2 });
    place(step, p.x, y, p.z, rng.range(-0.03, 0.03), -stairA + Math.PI / 2, rng.range(-0.03, 0.03));
    if (ground === null) {
      // floating step: give it a little rock underneath
      const under = prep(new THREE.IcosahedronGeometry(0.55, 1), '#9a857a', { rng, ao: 0.4 });
      under.scale(1.4, 0.8, 0.9);
      place(under, p.x, y - 0.45, p.z, 0, rng.range(0, 3), 0);
      stoneGeos.push(under);
    }
    stoneGeos.push(step);
    reserved.push({ x: p.x, z: p.z, r: 0.9 });
  }

  // spring pool feeding the mist-fall on the rim
  const fallA = archA + rng.range(1.1, 1.6);
  const fallDir = new THREE.Vector3(Math.cos(fallA), 0, Math.sin(fallA));
  const rimAtFall = main.rimR(fallA);
  const poolC = fallDir.clone().multiplyScalar(rimAtFall - 2.6);
  poolC.y = tY(poolC.x, poolC.z);
  const ring = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU;
    if (Math.cos(a - fallA) > 0.88) continue; // the gap where water spills
    const s = prep(new THREE.BoxGeometry(0.55, 0.32, 0.38), '#cbbba6', { rng, ao: 0.3 });
    place(s, poolC.x + Math.cos(a) * 1.55, poolC.y + 0.08, poolC.z + Math.sin(a) * 1.55, 0, -a, rng.range(-0.08, 0.08));
    ring.push(s);
  }
  stoneGeos.push(...ring);
  reserved.push({ x: poolC.x, z: poolC.z, r: 2.1 });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.45, 32).rotateX(-Math.PI / 2), poolMaterial(shared, tex));
  pool.position.set(poolC.x, poolC.y + 0.12, poolC.z);
  group.add(pool);
  const lip = fallDir.clone().multiplyScalar(rimAtFall + 0.2);
  lip.y = tY(fallDir.x * rimAtFall * 0.98, fallDir.z * rimAtFall * 0.98) - 0.1;
  const mist = mistFall(shared, tex, lip, fallDir, 34, 1.3, 7.5);
  group.add(mist);
  // a narrow glassy water ribbon from pool to lip
  const runG = new THREE.PlaneGeometry(0.8, 2.6, 1, 4).rotateX(-Math.PI / 2);
  const run = new THREE.Mesh(runG, pool.material);
  run.position.copy(poolC).addScaledVector(fallDir, 1.9); run.position.y = lip.y + 0.1;
  run.rotation.y = -fallA + Math.PI / 2;
  group.add(run);

  // ruins mesh
  const ruins = new THREE.Mesh(mergeGeometries(stoneGeos), ruinMat);
  ruins.castShadow = env.shadows; ruins.receiveShadow = env.shadows;
  group.add(ruins);
  pickables.push(ruins);
  const gold = new THREE.Mesh(mergeGeometries(accentGeos), goldMat);
  gold.castShadow = env.shadows;
  group.add(gold);

  // lantern under the dome: warm core + light
  const lanternPos = new THREE.Vector3(templePos.x, tInfo.floorY + 1.55, templePos.z);
  const lanternCore = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.62, 0.28).multiplyScalar(14) }));
  lanternCore.position.copy(lanternPos);
  group.add(lanternCore);
  const cage = [];
  cage.push(new THREE.CylinderGeometry(0.012, 0.012, tInfo.ringY - lanternPos.y + 0.2, 4).translate(0, (tInfo.ringY - lanternPos.y) / 2 + 0.25, 0));
  for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; cage.push(new THREE.BoxGeometry(0.025, 0.5, 0.025).translate(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22)); }
  cage.push(new THREE.CylinderGeometry(0.06, 0.28, 0.12, 8).translate(0, 0.3, 0));
  cage.push(new THREE.CylinderGeometry(0.26, 0.2, 0.06, 8).translate(0, -0.27, 0));
  for (const c of cage) c.deleteAttribute('uv');
  const cageMesh = new THREE.Mesh(mergeGeometries(cage), goldMat);
  cageMesh.position.copy(lanternPos);
  group.add(cageMesh);
  const lanternLight = new THREE.PointLight(new THREE.Color('#ffb066'), 10, 16, 1.6);
  lanternLight.position.copy(lanternPos);
  group.add(lanternLight);

  // candles on the temple steps (flames are drawn by the fx module)
  const candleSpots = [];
  const candleGeos = [];
  for (let i = 0; i < 11; i++) {
    const a = stairA + rng.range(-0.9, 0.9);
    const rr = rng.range(2.75, 3.4);
    const x = templePos.x + Math.cos(a) * rr, z = templePos.z + Math.sin(a) * rr;
    const stepY = rr > 3.1 ? 0.28 : 0.56;
    const h = rng.range(0.12, 0.34);
    const c = prep(new THREE.CylinderGeometry(0.045, 0.05, h, 8), '#f1e6d2', { ao: 0.1 });
    c.translate(x, templePos.y + stepY + h / 2, z);
    candleGeos.push(c);
    candleSpots.push(new THREE.Vector3(x, templePos.y + stepY + h + 0.06, z));
  }
  // candles inside around the lantern pedestal
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + rng.range(-0.2, 0.2), rr = rng.range(0.7, 1.3);
    const x = templePos.x + Math.cos(a) * rr, z = templePos.z + Math.sin(a) * rr, h = rng.range(0.15, 0.4);
    const c = prep(new THREE.CylinderGeometry(0.05, 0.055, h, 8), '#efe2cc', { ao: 0.1 });
    c.translate(x, tInfo.floorY + h / 2, z);
    candleGeos.push(c);
    candleSpots.push(new THREE.Vector3(x, tInfo.floorY + h + 0.06, z));
  }
  const candleMat = patchStd(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: new THREE.Color('#ff9a50'), emissiveIntensity: 0.25 }), shared, { key: 'candle' });
  group.add(new THREE.Mesh(mergeGeometries(candleGeos), candleMat));

  // trees
  const treeSpots = [];
  const treeDefs = [
    { h: rng.range(4.6, 5.6), canopy: '#e9a7b6', canopy2: '#fbe0e6', bark: '#5e4a44', clusters: 7, spread: 1.9 },  // blossom
    { h: rng.range(4.0, 5.0), canopy: '#4f7f38', canopy2: '#a8c25a', bark: '#6b5446', clusters: 6, spread: 1.6 },
    { h: rng.range(3.0, 3.8), canopy: '#5a8a3a', canopy2: '#b4c862', bark: '#6b5446', clusters: 5, spread: 1.5 },
  ];
  const trunkGeos = [], leafGeos = [];
  for (const def of treeDefs) {
    let x = 0, z = 0, ok = false;
    for (let k = 0; k < 40 && !ok; k++) {
      const a = rng.range(0, TAU), rr = rng.range(4, 8.5);
      x = Math.cos(a) * rr; z = Math.sin(a) * rr;
      ok = !reserved.some(r => Math.hypot(r.x - x, r.z - z) < r.r + 1.8) && !treeSpots.some(p => Math.hypot(p.x - x, p.z - z) < 4.5);
    }
    const t = makeTree(rng, noise, def);
    const y = tY(x, z);
    t.trunk.translate(x, y, z); t.leaves.translate(x, y, z);
    trunkGeos.push(t.trunk); leafGeos.push(t.leaves);
    treeSpots.push({ x, z, h: t.height });
    reserved.push({ x, z, r: 1.0 });
    colliders.push({ c: new THREE.Vector3(x, y + t.height, z), r: t.height * 0.6 });
  }
  const trunks = new THREE.Mesh(mergeGeometries(trunkGeos), barkMat);
  trunks.castShadow = env.shadows; trunks.receiveShadow = env.shadows;
  const leaves = new THREE.Mesh(mergeGeometries(leafGeos), leafMat);
  leaves.castShadow = env.shadows; leaves.receiveShadow = env.shadows;
  group.add(trunks, leaves);

  /* ---- grass ---- */
  const grassMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  addWind(grassMat, wind, { height: 0.8, amount: 0.22, stiffness: 1.5, flutter: 0.015, key: 'grasswind' });
  patchStd(grassMat, shared, {
    key: 'grass',
    fragment: {
      '#include <lights_fragment_end>': /* glsl */`$&
        {
          vec3 Vw = normalize(cameraPosition - vWPos);
          float bl = pow(max(dot(-Vw, uLightDir), 0.0), 2.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uLightCol * bl * 0.8;
        }
      `,
    },
  });
  const blade = bladeGeometry();
  function grassOn(islet, ox, oy, oz, count, reservedList) {
    const mesh = new THREE.InstancedMesh(blade, grassMat, count);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    const gA = new THREE.Color('#5c8236'), gB = new THREE.Color('#a7b84c'), gC = new THREE.Color('#c9b766');
    let n = 0;
    for (let k = 0; k < count * 3 && n < count; k++) {
      const a = rng.range(0, TAU), rr = Math.sqrt(rng.next()) * islet.rimR(a) * 0.97;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (reservedList && reservedList.some(r => Math.hypot(r.x - x, r.z - z) < r.r)) continue;
      const clump = noise.noise2(x * 0.3 + ox, z * 0.3 + oz) * 0.5 + 0.5;
      if (rng.next() > 0.25 + clump * 0.9) continue;
      const h = rng.range(0.35, 0.85) * (0.6 + 0.6 * clump);
      _q.setFromEuler(_e.set(rng.range(-0.25, 0.25), rng.range(0, TAU), rng.range(-0.25, 0.25)));
      m.compose(_p.set(x + ox, islet.topY(x, z) + oy - 0.04, z + oz), _q, _s.set(rng.range(0.8, 1.3), h, 1));
      mesh.setMatrixAt(n, m);
      c.copy(gA).lerp(gB, rng.next() * 0.8 + clump * 0.2);
      if (rng.chance(0.12)) c.lerp(gC, 0.6);
      mesh.setColorAt(n, c);
      n++;
    }
    mesh.count = n;
    mesh.receiveShadow = env.shadows;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }
  group.add(grassOn(main, 0, 0, 0, Math.round(9000 * q), reserved));

  // glowing flowers sprinkled in the grass (positions for the fx module)
  const flowerSpots = [];
  for (let k = 0; k < 400 && flowerSpots.length < Math.round(90 * q + 30); k++) {
    const a = rng.range(0, TAU), rr = Math.sqrt(rng.next()) * main.rimR(a) * 0.92;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    if (reserved.some(r => Math.hypot(r.x - x, r.z - z) < r.r)) continue;
    flowerSpots.push(new THREE.Vector3(x, tY(x, z) + rng.range(0.25, 0.5), z));
  }

  /* ---- secondary islets ---- */
  const nSmall = q >= 0.7 ? 7 : 5;
  const small = [];
  const baseAng = rng.range(0, TAU);
  for (let i = 0; i < nSmall; i++) {
    const a = baseAng + (i / nSmall) * TAU + rng.range(-0.3, 0.3);
    const dist = i < 3 ? rng.range(30, 55) : rng.range(60, 150);
    const R = i < 3 ? rng.range(2.6, 4.8) : rng.range(4, 9);
    const D = R * rng.range(1.5, 2.3);
    const isl = makeIslet(rng, { radius: R, depth: D, nT: Math.round(lerp(18, 30, q)), nA: Math.round(lerp(28, 52, q)), lobes: rng.int(1, 3), grassColor: rng.pick(['#6f8f3e', '#7d9443', '#668a40']) });
    const mesh = new THREE.Mesh(isl.geometry, rockMat);
    const y = rng.range(-12, 14) + (i >= 3 ? rng.range(-6, 18) : 0);
    mesh.position.set(Math.cos(a) * dist, y, Math.sin(a) * dist);
    mesh.rotation.y = rng.range(0, TAU);
    mesh.castShadow = env.shadows && i < 3; mesh.receiveShadow = env.shadows && i < 3;
    group.add(mesh);
    pickables.push(mesh);
    const deco = [];
    const kind = rng.pick(['tree', 'pillars', 'shrine', 'tree', 'arch', 'bare']);
    const dg = [], tg = [], lg = [];
    if (kind === 'pillars' || kind === 'shrine') {
      for (let k = 0; k < (kind === 'shrine' ? 4 : 2); k++) {
        const aa = (k / (kind === 'shrine' ? 4 : 2)) * TAU + 0.4, rr = Math.min(R * 0.5, 1.6);
        const x = Math.cos(aa) * rr, z = Math.sin(aa) * rr;
        column(rng, dg, x, isl.topY(x, z) - 0.08, z, rng.range(2.2, 3.2), { r: 0.18, broken: rng.chance(0.5) });
      }
      if (kind === 'shrine') dg.push(prep(new THREE.BoxGeometry(2.6, 0.2, 2.6), '#d6c8b4', { rng }).translate(0, isl.topY(0, 0) + 3.1, 0));
    } else if (kind === 'arch') {
      arch(rng, dg, 0, isl.topY(0, 0) - 0.1, 0, rng.range(0, TAU), { span: 2.4, h: 2.4 });
    }
    if (kind === 'tree') {
      const t = makeTree(rng, noise, { h: rng.range(3, 4.4), canopy: rng.chance(0.4) ? '#e3a2b4' : '#55853a', canopy2: rng.chance(0.4) ? '#f8d8e2' : '#a9c25c', bark: '#5e4a44', clusters: 5, spread: 1.5 });
      t.trunk.translate(0, isl.topY(0, 0), 0); t.leaves.translate(0, isl.topY(0, 0), 0);
      tg.push(t.trunk); lg.push(t.leaves);
    }
    if (dg.length) { const mm = new THREE.Mesh(mergeGeometries(dg), ruinMat); mm.castShadow = env.shadows && i < 3; mesh.add(mm); }
    if (tg.length) { mesh.add(new THREE.Mesh(tg[0], barkMat), new THREE.Mesh(lg[0], leafMat)); }
    mesh.add(grassOn(isl, 0, 0, 0, Math.round(R * R * 25 * q), null));
    small.push({ mesh, islet: isl, R });
    colliders.push({ c: new THREE.Vector3(mesh.position.x, y - D * 0.35, mesh.position.z), r: R + 2.5 + D * 0.2 });
    if (i < 3) casters.push(new THREE.Vector4(mesh.position.x, y - 2, mesh.position.z, R));
    bobbers.push({ obj: mesh, base: y, amp: rng.range(0.25, 0.6), speed: rng.range(0.15, 0.3), phase: rng.range(0, TAU) });
  }

  /* ---- floating debris rocks around the main islet ---- */
  const nDeb = Math.round(16 * q + 6);
  const debGeo = new THREE.IcosahedronGeometry(1, 1);
  {
    const p = debGeo.getAttribute('position');
    for (let i = 0; i < p.count; i++) { _p.fromBufferAttribute(p, i); const k = 1 + noise.noise3(_p.x * 1.5, _p.y * 1.5, _p.z * 1.5) * 0.3; p.setXYZ(i, _p.x * k, _p.y * k * 0.8, _p.z * k); }
    debGeo.deleteAttribute('uv'); debGeo.computeVertexNormals();
    const c = new Float32Array(p.count * 3); const rc = new THREE.Color('#9b8478');
    for (let i = 0; i < p.count; i++) { const t = p.getY(i) > 0.3 ? 0.7 : 0; _c.copy(rc).lerp(new THREE.Color('#6f8f3e'), t); c[i * 3] = _c.r; c[i * 3 + 1] = _c.g; c[i * 3 + 2] = _c.b; }
    debGeo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  const debris = new THREE.InstancedMesh(debGeo, rockMat, nDeb);
  const debState = [];
  for (let i = 0; i < nDeb; i++) {
    const a = rng.range(0, TAU), rr = rng.range(mainR + 1.5, mainR + 9);
    debState.push({ x: Math.cos(a) * rr, y: rng.range(-16, 2), z: Math.sin(a) * rr, s: rng.range(0.25, 1.1), ph: rng.range(0, TAU), sp: rng.range(0.2, 0.5), rx: rng.range(0, TAU), ry: rng.range(0, TAU) });
  }
  debris.castShadow = env.shadows;
  group.add(debris);

  /* ---- giant silhouettes far away in the haze ---- */
  const farMat = stoneMaterial(shared, tex, { key: 'far', bump: 0.1, scale: 0.01, moss: 0.0, roughness: 1 });
  const farGeos = [];
  const farRng = rng.fork('far');
  const fa = farRng.range(0, TAU);
  {
    // colossal broken spire
    const pts = [];
    const H = 520;
    for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push(new THREE.Vector2((48 * (1 - t * 0.78) + 10 * Math.sin(t * 22) * (1 - t)) * (t > 0.93 ? 0.6 : 1), t * H)); }
    const spire = prep(new THREE.LatheGeometry(pts, 16), '#b7a8b4', { ao: 0.5 });
    place(spire, Math.cos(fa) * 1700, CLOUD_TOP - 60, Math.sin(fa) * 1700, 0.05, 0, -0.04);
    farGeos.push(spire);
    // ring gate standing in the sea
    const ringG = prep(new THREE.TorusGeometry(130, 16, 10, 48), '#b4a6b2', { ao: 0.3 });
    place(ringG, Math.cos(fa + 1.9) * 1250, CLOUD_TOP + 40, Math.sin(fa + 1.9) * 1250, 0, fa + 1.9 + 0.5, 0);
    farGeos.push(ringG);
    // twin colossal columns
    for (const k of [0, 1]) {
      const col = prep(new THREE.CylinderGeometry(22, 26, k ? 300 : 420, 14), '#bba9b2', { ao: 0.5 });
      place(col, Math.cos(fa + 3.6 + k * 0.06) * 2000, CLOUD_TOP + (k ? 110 : 170), Math.sin(fa + 3.6 + k * 0.06) * 2000, 0, 0, k ? 0.08 : 0);
      farGeos.push(col);
    }
  }
  const far = new THREE.Mesh(mergeGeometries(farGeos), farMat);
  group.add(far);
  // a great floating mountain-islet in the middle distance
  const bigIsl = makeIslet(farRng, { radius: 70, depth: 140, nT: 30, nA: 56, lobes: 3 });
  const big = new THREE.Mesh(bigIsl.geometry, rockMat);
  big.position.set(Math.cos(fa - 1.6) * 760, 70, Math.sin(fa - 1.6) * 760);
  group.add(big);
  {
    // a temple silhouette on it
    const sg = [], ag = [];
    temple(farRng, sg, ag, 0, bigIsl.topY(0, 0) - 0.2, 0, 0);
    const tm = new THREE.Mesh(mergeGeometries(sg), ruinMat);
    tm.scale.setScalar(4.5);
    big.add(tm);
    const t2 = makeTree(farRng, noise, { h: 5, canopy: '#4f7f38', canopy2: '#9dbb54', clusters: 6 });
    const tr = new THREE.Mesh(t2.leaves, leafMat); tr.scale.setScalar(5); tr.position.set(30, bigIsl.topY(30, 10), 10);
    const tt = new THREE.Mesh(t2.trunk, barkMat); tt.scale.setScalar(5); tt.position.copy(tr.position);
    big.add(tr, tt);
  }
  bobbers.push({ obj: big, base: 70, amp: 2.5, speed: 0.05, phase: 0 });

  const dbM = new THREE.Matrix4();
  return {
    group, pickables, colliders, casters, small, main, mainMesh,
    templePos, tInfo, lanternPos, lanternLight, lanternCore, candleSpots, flowerSpots, poolC, lip, fallDir, mist,
    archP, treeSpots,
    update(dt, t, tod) {
      for (const b of bobbers) b.obj.position.y = b.base + Math.sin(t * b.speed + b.phase) * b.amp;
      for (let i = 0; i < debState.length; i++) {
        const d = debState[i];
        _q.setFromEuler(_e.set(d.rx + t * 0.03 * d.sp, d.ry + t * 0.05 * d.sp, 0));
        dbM.compose(_p.set(d.x, d.y + Math.sin(t * d.sp + d.ph) * 0.4, d.z), _q, _s.set(d.s, d.s, d.s));
        debris.setMatrixAt(i, dbM);
      }
      debris.instanceMatrix.needsUpdate = true;
      // lantern flicker; brighter as night falls
      const fl = 0.85 + 0.1 * Math.sin(t * 9.3) + 0.05 * Math.sin(t * 23.1 + 1.3);
      const nightK = lerp(0.35, 1.0, tod.night);
      lanternLight.intensity = 9 * fl * nightK;
      lanternCore.material.color.setRGB(1, 0.6, 0.26).multiplyScalar(lerp(6, 16, tod.night) * fl);
    },
  };
}
