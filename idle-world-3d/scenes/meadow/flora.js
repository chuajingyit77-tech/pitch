// 芒原 · flora: susuki tussocks + plumes (instanced, custom wind), maple trees, fallen leaves.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, patchMaterial, addWind } from '../../lib/util.js';
import { addFog } from './sky.js';

/* ------------------------------------------------------------------ */
/* Shared wind for the field. Gust noise is periodic (256 lattice      */
/* units) so the scroll can wrap without a visible jump.               */
/* ------------------------------------------------------------------ */
export function makeWindUniforms() {
  return {
    uTime: { value: 0 },
    uWindDir: { value: new THREE.Vector2(1, 0) },
    uWindScroll: { value: new THREE.Vector2() },
    uWindStr: { value: 1 },
    uPress: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -100, 0, 0)) },
  };
}

export const WIND_GLSL = /* glsl */`
uniform float uTime, uWindStr;
uniform vec2 uWindDir, uWindScroll;
uniform vec4 uPress[4];
float mHash(vec2 p){ p = mod(p, 256.0); return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
float mNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(mHash(i), mHash(i+vec2(1.0,0.0)), u.x), mix(mHash(i+vec2(0.0,1.0)), mHash(i+vec2(1.0,1.0)), u.x), u.y); }
float gustAt(vec2 p){
  vec2 q = p * 0.045 - uWindScroll;
  float g = mNoise(q) * 0.62 + mNoise(q * 3.0 + vec2(7.1, 3.3)) * 0.38;
  return smoothstep(0.3, 0.8, g);
}
vec3 bendPlant(vec3 wp, vec3 root, float hN, float H, float rnd, float flex, out float gust){
  gust = gustAt(root.xz);
  float sway = sin(uTime * 1.35 + dot(root.xz, vec2(0.23, 0.19)) + rnd * 6.2831);
  float bend = uWindStr * (0.1 + 0.55 * gust + 0.08 * sway) * flex;
  vec2 dir = uWindDir * bend;
  float squash = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 dv = root.xz - uPress[i].xz;
    float dd = length(dv) + 1e-3;
    float k = uPress[i].w * (1.0 - smoothstep(0.2, 2.4, dd));
    dir += dv / dd * k * 1.1;
    squash = max(squash, uPress[i].w * (1.0 - smoothstep(0.4, 2.0, dd)));
  }
  float w = hN * hN;
  vec2 off = dir * w * H;
  vec2 perp = vec2(-uWindDir.y, uWindDir.x);
  off += perp * sin(uTime * 4.7 + rnd * 37.0 + hN * 2.5) * 0.03 * w * H * uWindStr * flex;
  float y = wp.y - root.y;
  float l2 = dot(off, off);
  float ny = max(y - l2 / max(2.0 * y, 0.05), y * 0.2);
  ny *= 1.0 - 0.72 * squash;
  wp.xz += off;
  wp.y = root.y + ny;
  return wp;
}
`;

const NFB_NOFLIP = THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', '');
const A2C_SOFT = /* glsl */`
#ifdef USE_ALPHATEST
  diffuseColor.a = clamp((diffuseColor.a - alphaTest * 0.5) / (1.0 - alphaTest * 0.5), 0.0, 1.0);
  if (diffuseColor.a < 0.06) discard;
#endif
`;
const A2C_ALPHATEST = /* glsl */`
#ifdef USE_ALPHATEST
  diffuseColor.a = clamp((diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 1e-4) + 0.5, 0.0, 1.0);
  if (diffuseColor.a < 0.02) discard;
#endif
`;

/** Lambert direct term with wrap lighting and back-light translucency. weightExpr is GLSL. */
export function translucentLambert(weightExpr = '1.0') {
  return /* glsl */`
$&
void RE_Direct_Meadow( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in LambertMaterial material, inout ReflectedLight reflectedLight ) {
  float nl = dot( geometryNormal, directLight.direction );
  float wrapNL = saturate( ( nl + uWrap ) / ( 1.0 + uWrap ) );
  reflectedLight.directDiffuse += wrapNL * directLight.color * BRDF_Lambert( material.diffuseColor );
  float back = pow( saturate( dot( -geometryViewDir, directLight.direction ) ), 4.0 );
  reflectedLight.directDiffuse += directLight.color * material.diffuseColor * back * uTransl * (${weightExpr});
}
#undef RE_Direct
#define RE_Direct RE_Direct_Meadow
`;
}

export function makeGrassColorUniforms() {
  return {
    uRootCol: { value: new THREE.Color('#4a4220') },
    uMidCol: { value: new THREE.Color('#b08a40') },
    uTipCol: { value: new THREE.Color('#ecd79c') },
    uPlumeCol: { value: new THREE.Color('#ddd0b6') },
    uGustBright: { value: 0.4 },
  };
}

/** Material for susuki leaves (plume=false) or plume stalks (plume=true). */
export function grassMaterial({ wind, colors, fogU, plume = false, map = null, transl = 0.35, wrap = 0.35, msaa = true }) {
  const soft = plume && msaa;
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, map, alphaTest: plume ? (msaa ? 0.3 : 0.42) : 0, alphaToCoverage: plume && msaa });
  const U = { ...wind, ...colors, uTransl: { value: transl }, uWrap: { value: wrap } };
  mat.userData.U = U;
  patchMaterial(mat, {
    key: plume ? (soft ? 'mgPlumeS' : 'mgPlumeH') : 'mgGrass2',
    uniforms: U,
    vertexHeader: WIND_GLSL + `
      attribute vec4 aInst; attribute float aSide; ${plume ? 'attribute float aPart;' : ''}
      varying float vH; varying float vGust; varying vec4 vInst; varying float vPart; varying float vSide;`,
    fragmentHeader: `
      uniform vec3 uRootCol, uMidCol, uTipCol, uPlumeCol; uniform float uTransl, uWrap, uGustBright;
      varying float vH; varying float vGust; varying vec4 vInst; varying float vPart; varying float vSide;`,
    vertex: {
      '#include <project_vertex>': /* glsl */`
        vec3 root = instanceMatrix[3].xyz;
        float Hs = length(instanceMatrix[1].xyz);
        float hN = clamp(transformed.y, 0.0, 1.3);
        vec4 wp4 = instanceMatrix * vec4(transformed, 1.0);
        float gst;
        wp4.xyz = bendPlant(wp4.xyz, root, hN, Hs, aInst.z, ${plume ? '1.3' : '1.0'}, gst);
        vH = hN; vGust = gst; vInst = aInst; vPart = ${plume ? 'aPart' : '0.0'}; vSide = aSide;
        vec4 mvPosition = modelViewMatrix * wp4;
        gl_Position = projectionMatrix * mvPosition;`,
      '#include <worldpos_vertex>': 'vec4 worldPosition = modelMatrix * wp4;',
    },
    fragment: {
      '#include <color_fragment>': /* glsl */`
        {
          float h = vH;
          vec3 c = mix(uRootCol, uMidCol, smoothstep(0.0, 0.5, h));
          c = mix(c, uTipCol, smoothstep(0.42, 1.02, h));
          float hv = vInst.x;
          c *= mix(vec3(1.0), hv > 0.0 ? vec3(0.78, 0.95, 0.6) : vec3(1.1, 0.78, 0.58), abs(hv) * 0.65);
          c *= 0.78 + 0.44 * vInst.y;
          c *= mix(0.55, 1.0, smoothstep(0.0, 0.55, h));
          c *= 1.0 + 0.22 * (1.0 - smoothstep(0.0, 0.35, abs(vSide))) * smoothstep(0.1, 0.5, h);
          c *= 1.0 + vGust * uGustBright * h;
          ${plume ? `
          vec3 pc = uPlumeCol * (0.82 + 0.3 * vInst.y) * mix(vec3(1.07, 0.94, 0.9), vec3(0.95, 0.99, 1.05), vInst.w);
          pc *= 1.0 + vGust * uGustBright * 0.7;
          diffuseColor.rgb = mix(c * 1.15, pc * diffuseColor.rgb, vPart);` : 'diffuseColor.rgb = c;'}
        }`,
      '#include <alphatest_fragment>': soft ? A2C_SOFT : A2C_ALPHATEST,
      '#include <normal_fragment_begin>': NFB_NOFLIP,
      '#include <lights_lambert_pars_fragment>': translucentLambert(plume ? 'mix(0.3 + 0.7 * vH, 1.6, vPart)' : '0.12 + 0.88 * vH * vH'),
      '#include <opaque_fragment>': 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
    },
  });
  addFog(mat, fogU, plume ? 'mfogP' : 'mfogG');
  return mat;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */
/** A susuki tussock: arching, twisted, tapering leaf blades. Unit height. */
export function buildClump(rng, { blades = 12, segs = 4, width = 0.04, spread = 0.1, leanMin = 0.15, leanMax = 0.6 } = {}) {
  const P = [], N = [], S = [], I = [];
  const up = new THREE.Vector3(0, 1, 0);
  const tan = new THREE.Vector3(), side = new THREE.Vector3(), nrm = new THREE.Vector3(), c0 = new THREE.Vector3(), c1 = new THREE.Vector3();
  for (let k = 0; k < blades; k++) {
    const th = (k / blades) * TAU + rng.range(-0.35, 0.35);
    const b = { dx: Math.cos(th), dz: Math.sin(th) };
    const r0 = rng.range(0, spread);
    b.x = b.dx * r0; b.z = b.dz * r0;
    b.h = rng.range(0.5, 1.0);
    b.lean = rng.range(leanMin, leanMax) * (1.2 - b.h * 0.45);
    b.droop = rng.range(0.0, 0.32) * b.h;
    const curve = (t, out) => {
      const o = b.lean * Math.pow(t, 1.6);
      return out.set(b.x + b.dx * o, b.h * t - b.droop * Math.pow(t, 2.6), b.z + b.dz * o);
    };
    const w = width * rng.range(0.7, 1.35);
    const twist = rng.range(-1.0, 1.0);
    const base = P.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      curve(t, c0);
      if (s < segs) { curve(t + 0.02, c1); tan.subVectors(c1, c0); } else { curve(t - 0.02, c1); tan.subVectors(c0, c1); }
      tan.normalize();
      side.set(-b.dz, 0, b.dx).applyAxisAngle(tan, twist * t);
      nrm.crossVectors(tan, side).normalize();
      if (nrm.y < 0) nrm.negate();
      nrm.lerp(up, 0.5).normalize();
      if (s < segs) {
        const ww = w * (1 - Math.pow(t, 1.8)) * 0.5;
        P.push(c0.x - side.x * ww, c0.y - side.y * ww, c0.z - side.z * ww, c0.x + side.x * ww, c0.y + side.y * ww, c0.z + side.z * ww);
        N.push(nrm.x, nrm.y, nrm.z, nrm.x, nrm.y, nrm.z);
        S.push(-1, 1);
      } else {
        P.push(c0.x, c0.y, c0.z); N.push(nrm.x, nrm.y, nrm.z); S.push(0);
      }
    }
    for (let s = 0; s < segs - 1; s++) { const a = base + s * 2; I.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    const a = base + (segs - 1) * 2;
    I.push(a, a + 1, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(S, 1));
  g.setIndex(I);
  return g;
}

/** Flower stalk with a drooping feathery plume made of crossed cards. Unit height. */
export function buildPlumeStalk({ planes = 3, segs = 3, plumeFrom = 0.64, width = 0.085, droop = 0.1 } = {}) {
  const P = [], N = [], UV = [], PART = [], S = [], I = [];
  const lean = y => 0.05 * y * y;
  for (let r = 0; r < 2; r++) {
    const ang = r * Math.PI / 2, sx = Math.cos(ang), sz = Math.sin(ang);
    const base = P.length / 3;
    const top = plumeFrom + 0.06;
    for (let s = 0; s <= 4; s++) {
      const y = top * s / 4, x = lean(y), hw = 0.0065 * (1 - s / 6);
      P.push(x - sx * hw, y, -sz * hw, x + sx * hw, y, sz * hw);
      N.push(0, 1, 0, 0, 1, 0); UV.push(0.012, 0.5, 0.02, 0.5); PART.push(0, 0); S.push(-1, 1);
    }
    for (let s = 0; s < 4; s++) { const a = base + s * 2; I.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  }
  for (let k = 0; k < planes; k++) {
    const ang = k * Math.PI / planes + 0.3, sx = Math.cos(ang), sz = Math.sin(ang);
    const base = P.length / 3;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const y = plumeFrom + (1 - plumeFrom) * t - droop * 0.35 * t * t;
      const x = lean(y) + droop * t * t;
      const hw = width * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.12)));
      P.push(x - sx * hw, y, -sz * hw, x + sx * hw, y, sz * hw);
      const nx = -sz * 0.3, nz = sx * 0.3;
      N.push(nx, 0.95, nz, -nx, 0.95, -nz);
      UV.push(0.06, t, 1.0, t); PART.push(1, 1); S.push(-1, 1);
    }
    for (let s = 0; s < segs; s++) { const a = base + s * 2; I.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(PART, 1));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(S, 1));
  g.setIndex(I);
  return g;
}

/** InstancedMesh from a list of {x,y,z,rot,sx,sy,inst:[4]} records. */
export function instancedFrom(geo, mat, list) {
  const g = geo.clone();
  const n = list.length;
  const aInst = new Float32Array(n * 4);
  const mesh = new THREE.InstancedMesh(g, mat, Math.max(1, n));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
  list.forEach((r, i) => {
    q.setFromAxisAngle(yAxis, r.rot);
    p.set(r.x, r.y, r.z); s.set(r.sx, r.sy, r.sx);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    aInst.set(r.inst, i * 4);
  });
  mesh.count = n;
  g.setAttribute('aInst', new THREE.InstancedBufferAttribute(aInst, 4));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Maple trees                                                         */
/* ------------------------------------------------------------------ */
function tubeAlong(points, radii, radial, out, vScale = 1.2) {
  const n = points.length;
  const T = [];
  for (let i = 0; i < n; i++) {
    const t = new THREE.Vector3();
    if (i < n - 1) t.subVectors(points[i + 1], points[i]); else t.subVectors(points[i], points[i - 1]);
    T.push(t.normalize());
  }
  const nrm = Math.abs(T[0].y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  nrm.sub(T[0].clone().multiplyScalar(nrm.dot(T[0]))).normalize();
  const axis = new THREE.Vector3(), b = new THREE.Vector3(), dir = new THREE.Vector3();
  const base = out.P.length / 3;
  let vAcc = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      axis.crossVectors(T[i - 1], T[i]);
      const s = axis.length();
      if (s > 1e-6) nrm.applyAxisAngle(axis.divideScalar(s), Math.asin(Math.min(1, s)));
      vAcc += points[i].distanceTo(points[i - 1]);
    }
    b.crossVectors(T[i], nrm).normalize();
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      dir.copy(nrm).multiplyScalar(Math.cos(a)).addScaledVector(b, Math.sin(a));
      const r = radii[i];
      out.P.push(points[i].x + dir.x * r, points[i].y + dir.y * r, points[i].z + dir.z * r);
      out.N.push(dir.x, dir.y, dir.z);
      out.UV.push(j / radial, vAcc * vScale);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < radial; j++) {
    const a = base + i * (radial + 1) + j, c = a + radial + 1;
    out.I.push(a, c, a + 1, a + 1, c, c + 1);
  }
}

function branchPath(rng, start, dir, length, steps, curl, gravity) {
  const pts = [start.clone()];
  const d = dir.clone().normalize();
  const p = start.clone();
  for (let i = 1; i <= steps; i++) {
    d.x += rng.range(-curl, curl); d.z += rng.range(-curl, curl); d.y += rng.range(-curl, curl) * 0.5 - gravity;
    d.normalize();
    p.addScaledVector(d, length / steps);
    pts.push(p.clone());
  }
  return pts;
}

/** Procedural Japanese maple: returns { branches: BufferGeometry, leaves: BufferGeometry, height, radius, canopy }. */
export function buildMaple(rng, { scale = 1, density = 1 } = {}) {
  const wood = { P: [], N: [], UV: [], I: [] };
  const clusters = [];
  const up = new THREE.Vector3(0, 1, 0);
  const trunkH = rng.range(1.3, 1.9) * scale;
  const tl = new THREE.Vector3(rng.range(-0.25, 0.25), 1, rng.range(-0.25, 0.25));
  const trunk = branchPath(rng, new THREE.Vector3(0, -0.3, 0), tl, trunkH + 0.3, 5, 0.08, 0);
  const r0 = 0.2 * scale;
  tubeAlong(trunk, trunk.map((_, i) => r0 * (1.25 - 0.4 * i / (trunk.length - 1)) * (i === 0 ? 1.25 : 1)), 9, wood);
  const top = trunk[trunk.length - 1];
  const nLimbs = rng.int(4, 6);
  const az0 = rng.range(0, TAU);
  for (let l = 0; l < nLimbs; l++) {
    const az = az0 + (l / nLimbs) * TAU + rng.range(-0.35, 0.35);
    const tilt = rng.range(0.55, 1.0);
    const dir = new THREE.Vector3(Math.cos(az) * Math.sin(tilt), Math.cos(tilt), Math.sin(az) * Math.sin(tilt));
    const len = rng.range(1.9, 2.9) * scale;
    const startT = rng.range(0.7, 1.0);
    const sp = trunk[Math.floor(startT * (trunk.length - 1))].clone();
    const limb = branchPath(rng, sp, dir, len, 6, 0.12, 0.05);
    const lr = 0.12 * scale;
    tubeAlong(limb, limb.map((_, i) => lr * (1 - 0.72 * i / (limb.length - 1))), 7, wood);
    clusters.push({ p: limb[limb.length - 1].clone().add(new THREE.Vector3(0, 0.25, 0)), r: rng.range(0.85, 1.15) * scale });
    clusters.push({ p: limb[3].clone().add(new THREE.Vector3(0, 0.35, 0)), r: rng.range(0.7, 0.95) * scale });
    const nSub = rng.int(2, 3);
    for (let s = 0; s < nSub; s++) {
      const k = rng.int(2, limb.length - 2);
      const sdir = dir.clone().applyAxisAngle(up, rng.range(-0.9, 0.9));
      sdir.y = Math.abs(sdir.y) + rng.range(0.1, 0.5);
      const sub = branchPath(rng, limb[k], sdir, rng.range(0.9, 1.6) * scale, 4, 0.18, 0.08);
      tubeAlong(sub, sub.map((_, i) => lr * 0.5 * (1 - 0.75 * i / (sub.length - 1))), 5, wood);
      clusters.push({ p: sub[sub.length - 1].clone().add(new THREE.Vector3(0, 0.2, 0)), r: rng.range(0.7, 1.0) * scale });
    }
  }
  // canopy centre for outward normals
  const cc = new THREE.Vector3();
  clusters.forEach(c => cc.add(c.p));
  cc.divideScalar(clusters.length);
  cc.y -= 0.6 * scale;
  // leaf cards
  const L = { P: [], N: [], UV: [], C: [], I: [] };
  const q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), nOut = new THREE.Vector3(), tint = new THREE.Color();
  const corners = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  let maxY = 0, maxR = 0;
  for (const c of clusters) {
    const nCards = Math.max(3, Math.round(rng.range(11, 16) * c.r * density));
    for (let i = 0; i < nCards; i++) {
      const cpos = new THREE.Vector3(rng.range(-1, 1), rng.range(-0.5, 0.7), rng.range(-1, 1)).multiplyScalar(c.r).add(c.p);
      const size = rng.range(0.75, 1.1) * scale;
      e.set(rng.range(-1.2, 1.2), rng.range(0, TAU), rng.range(-1.2, 1.2));
      q.setFromEuler(e);
      nOut.subVectors(cpos, cc); nOut.y = nOut.y * 0.6 + 0.8; nOut.normalize();
      const cell = rng.int(0, 3);
      const u0 = (cell % 2) * 0.5, v0 = cell < 2 ? 0.5 : 0;
      const base = L.P.length / 3;
      tint.setRGB(1, 1, 1).offsetHSL(rng.range(-0.015, 0.02), 0, rng.range(-0.06, 0.06));
      for (const [cx, cy] of corners) {
        v.set(cx * size, cy * size, 0).applyQuaternion(q).add(cpos);
        L.P.push(v.x, v.y, v.z);
        L.N.push(nOut.x, nOut.y, nOut.z);
        L.UV.push(u0 + (cx + 0.5) * 0.5, v0 + (cy + 0.5) * 0.5);
        L.C.push(tint.r, tint.g, tint.b);
        maxY = Math.max(maxY, v.y); maxR = Math.max(maxR, Math.hypot(v.x, v.z));
      }
      L.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const branches = new THREE.BufferGeometry();
  branches.setAttribute('position', new THREE.Float32BufferAttribute(wood.P, 3));
  branches.setAttribute('normal', new THREE.Float32BufferAttribute(wood.N, 3));
  branches.setAttribute('uv', new THREE.Float32BufferAttribute(wood.UV, 2));
  branches.setIndex(wood.I);
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(L.P, 3));
  leaves.setAttribute('normal', new THREE.Float32BufferAttribute(L.N, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(L.UV, 2));
  leaves.setAttribute('color', new THREE.Float32BufferAttribute(L.C, 3));
  leaves.setIndex(L.I);
  return { branches, leaves, height: maxY, radius: maxR, canopy: cc, clusters };
}

/** Leaf-card material for maple canopies (wind sway + flutter, translucent when back-lit). */
export function mapleLeafMaterial({ map, wind, fogU, height }) {
  const mat = new THREE.MeshLambertMaterial({ map, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: true });
  addWind(mat, wind, { height, amount: 0.16, stiffness: 1.7, flutter: 0.035, key: 'mapleLeafW' });
  patchMaterial(mat, {
    key: 'mapleLeafT',
    uniforms: { uTransl: { value: 0.55 }, uWrap: { value: 0.5 } },
    fragmentHeader: 'uniform float uTransl, uWrap;',
    fragment: {
      '#include <alphatest_fragment>': A2C_ALPHATEST,
      '#include <normal_fragment_begin>': NFB_NOFLIP,
      '#include <lights_lambert_pars_fragment>': translucentLambert('1.0'),
      '#include <opaque_fragment>': 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
    },
  });
  addFog(mat, fogU, 'mfogLeaf');
  return mat;
}

export function mapleLeafDepthMaterial({ map, wind, height }) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5, side: THREE.DoubleSide });
  addWind(m, wind, { height, amount: 0.16, stiffness: 1.7, flutter: 0.035, key: 'mapleLeafW' });
  return m;
}

/* ------------------------------------------------------------------ */
/* Distant groves: several procedural trees merged into one leaf mesh  */
/* and one branch mesh (static, cheap: 2 draw calls per palette).      */
/* ------------------------------------------------------------------ */
function mergeList(geos) {
  let n = 0, ni = 0;
  for (const g of geos) { n += g.attributes.position.count; ni += g.index.count; }
  const names = Object.keys(geos[0].attributes);
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = geos[0].attributes[name].itemSize;
    const arr = new Float32Array(n * size);
    let o = 0;
    for (const g of geos) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const idx = new Uint32Array(ni);
  let oi = 0, ov = 0;
  for (const g of geos) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[oi++] = a[i] + ov; ov += g.attributes.position.count; }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  geos.forEach(g => g.dispose());
  return out;
}
export function buildGrove({ rng, spots, heightAt, map, barkMat, fogU, density = 0.55 }) {
  const leaves = [], branches = [];
  for (const sp of spots) {
    const t = buildMaple(rng, { scale: sp.s, density });
    const y = heightAt(sp.x, sp.z);
    const rot = rng.range(0, TAU);
    for (const g of [t.leaves, t.branches]) { g.rotateY(rot); g.translate(sp.x, y, sp.z); }
    leaves.push(t.leaves); branches.push(t.branches);
  }
  const lmat = new THREE.MeshLambertMaterial({ map, vertexColors: true, side: THREE.DoubleSide, alphaTest: 0.45, alphaToCoverage: true });
  patchMaterial(lmat, {
    key: 'groveLeafT',
    uniforms: { uTransl: { value: 0.5 }, uWrap: { value: 0.5 } },
    fragmentHeader: 'uniform float uTransl, uWrap;',
    fragment: {
      '#include <alphatest_fragment>': A2C_ALPHATEST,
      '#include <normal_fragment_begin>': NFB_NOFLIP,
      '#include <lights_lambert_pars_fragment>': translucentLambert('1.0'),
      '#include <opaque_fragment>': 'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
    },
  });
  addFog(lmat, fogU, 'mfogGrove');
  const lm = new THREE.Mesh(mergeList(leaves), lmat);
  const bm = new THREE.Mesh(mergeList(branches), barkMat);
  lm.frustumCulled = bm.frustumCulled = false;
  const g = new THREE.Group();
  g.add(bm, lm);
  return g;
}
