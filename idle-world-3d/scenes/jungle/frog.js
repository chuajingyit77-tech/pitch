// Red-eyed tree frog (Agalychnis callidryas), fully procedural.
// One InstancedMesh draws every frog; per-instance pose weights (leap, throat, tongue, breath)
// blend between precomputed vertex deltas on the GPU.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep } from '../../lib/util.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchMaterial } from '../../lib/util.js';
import { jungleMaterial } from './shading.js';

const C = {
  green: [0.2, 0.62, 0.12],
  greenDark: [0.12, 0.42, 0.08],
  cream: [0.95, 0.9, 0.72],
  blue: [0.1, 0.22, 0.75],
  yellow: [0.98, 0.78, 0.18],
  orange: [1.0, 0.42, 0.05],
  red: [0.85, 0.03, 0.02],
  black: [0.02, 0.02, 0.02],
  pink: [0.95, 0.35, 0.45],
};

/**
 * Each part is generated twice (sit pose / leap pose) with identical topology; the delta
 * becomes a morph attribute. Parts: list of { sit: BufferGeometry, leap?: BufferGeometry, throat?, tongue? }.
 */
function colorize(g, fn) {
  const p = g.attributes.position, n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  const v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); nn.fromBufferAttribute(n, i);
    const c = fn(v, nn, i);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function ellipsoid(r, at, segW = 18, segH = 12, deform) {
  const g = new THREE.SphereGeometry(1, segW, segH);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i) * r[0], y = p.getY(i) * r[1], z = p.getZ(i) * r[2];
    if (deform) [x, y, z] = deform(x, y, z);
    p.setXYZ(i, x + at[0], y + at[1], z + at[2]);
  }
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** Tube along a polyline (Catmull-Rom), fixed sample count so poses share topology. */
function limb(points, r0, r1, colorFn, samples = 10, radial = 6) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  const frames = curve.computeFrenetFrames(samples, false);
  const pos = [], nor = [], idx = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const P = curve.getPointAt(t);
    const r = lerp(r0, r1, t);
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * TAU;
      const N = frames.normals[i], B = frames.binormals[i];
      const nx = -Math.cos(a) * N.x + Math.sin(a) * B.x, ny = -Math.cos(a) * N.y + Math.sin(a) * B.y, nz = -Math.cos(a) * N.z + Math.sin(a) * B.z;
      pos.push(P.x + nx * r, P.y + ny * r, P.z + nz * r);
      nor.push(nx, ny, nz);
    }
  }
  for (let i = 0; i < samples; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = (i + 1) * (radial + 1) + j;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  const cnt = ng.attributes.position.count;
  const col = new Float32Array(cnt * 3);
  // colour by parameter along the limb: recover t from vertex order (non-indexed copies)
  const idxArr = g.index.array;
  for (let k = 0; k < cnt; k++) {
    const src = idxArr[k];
    const t = Math.floor(src / (radial + 1)) / samples;
    const c = colorFn(t);
    col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}

function sphereAt(r, at, color, seg = 6) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2));
  g.translate(...at);
  const ng = g.toNonIndexed();
  colorize(ng, () => color);
  return ng;
}

/** Build the hind or front leg (+ toes with pads) for one side in a given pose. */
function legSet(side, pose, front) {
  const s = side;
  const parts = [];
  let chain, toes;
  if (front) {
    chain = pose === 'sit'
      ? [[0.2 * s, 0.24, 0.24], [0.33 * s, 0.13, 0.33], [0.3 * s, 0.035, 0.46]]
      : [[0.2 * s, 0.24, 0.22], [0.32 * s, 0.2, 0.1], [0.3 * s, 0.14, -0.04]];
    const w = chain[2];
    toes = [-0.5, -0.15, 0.2, 0.55].map(a => {
      const dir = pose === 'sit' ? [Math.sin(a) * s * 0.9 + 0.25 * s, 0, Math.cos(a)] : [Math.sin(a) * s * 0.5 + 0.2 * s, -0.1, -Math.cos(a)];
      return [w, [w[0] + dir[0] * 0.1, w[1] + dir[1] * 0.1 - 0.01, w[2] + dir[2] * 0.1]];
    });
    parts.push(limb(chain, 0.05, 0.035, t => t < 0.5 ? C.green : C.green));
  } else {
    chain = pose === 'sit'
      ? [[0.24 * s, 0.24, -0.34], [0.42 * s, 0.12, 0.02], [0.3 * s, 0.07, -0.36], [0.4 * s, 0.03, -0.05]]
      : [[0.24 * s, 0.26, -0.38], [0.36 * s, 0.24, -0.78], [0.3 * s, 0.22, -1.14], [0.34 * s, 0.2, -1.4]];
    const w = chain[3];
    toes = [-0.7, -0.3, 0.1, 0.45, 0.8].map(a => {
      const dir = pose === 'sit' ? [Math.sin(a) * s * 0.8 + 0.3 * s, 0, Math.cos(a)] : [Math.sin(a) * s * 0.6, -0.05, -Math.cos(a)];
      return [w, [w[0] + dir[0] * 0.13, w[1] + dir[1] * 0.13 - 0.01, w[2] + dir[2] * 0.13]];
    });
    parts.push(limb(chain, 0.075, 0.035, t => t < 0.33 ? C.blue : (t < 0.66 ? C.green : C.orange), 12, 7));
  }
  for (const [a, b] of toes) {
    parts.push(limb([a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.005, (a[2] + b[2]) / 2], b], 0.016, 0.012, () => C.orange, 3, 4));
    parts.push(sphereAt(0.024, b, C.orange, 6));
  }
  return parts;
}

function buildPose(pose) {
  const parts = [];
  // body: pear shape, flanks blue with cream-yellow bars, green back, cream belly
  const bodyDeform = (x, y, z) => {
    const rear = smoothstep(0.1, -0.5, z);
    y -= rear * 0.06 * (y > 0 ? 1 : 0.4);
    x *= 1 - rear * 0.12;
    if (pose === 'leap') { z *= 1.12; y *= 0.92; }
    return [x, y, z];
  };
  const body = ellipsoid([0.34, 0.22, 0.48], [0, 0.26, -0.06], 22, 14, bodyDeform);
  colorize(body, (v, n) => {
    if (n.y < -0.35) return C.cream;
    const flank = Math.abs(n.x) > 0.55 && n.y < 0.32;
    if (flank) {
      const bar = (((v.z + 2) * 5.2) % 1) < 0.28;
      return bar ? C.yellow : C.blue;
    }
    if (Math.abs(n.x) > 0.45 && n.y < 0.42) return [0.9, 0.92, 0.8];
    return n.y > 0.85 ? C.green : C.green.map((c, k) => c * (k === 1 ? 0.95 : 1));
  });
  parts.push(body);
  // head
  const head = ellipsoid([0.3, 0.17, 0.27], [0, 0.33, 0.34], 20, 12, (x, y, z) => [x, y + (z > 0 ? -z * 0.25 : 0), z]);
  colorize(head, (v, n) => {
    if (n.y < -0.3) return C.cream;
    if (Math.abs(v.y - 0.29) < 0.012 && v.z > 0.4) return C.greenDark; // mouth line
    return C.green;
  });
  parts.push(head);
  // eyes: red with vertical slit pupil
  for (const s of [-1, 1]) {
    const c = [0.19 * s, 0.45, 0.4];
    const g = new THREE.SphereGeometry(0.11, 20, 16);
    g.translate(...c);
    const ng = g.toNonIndexed();
    const axis = new THREE.Vector3(0.85 * s, 0.25, 0.55).normalize();
    const vert = new THREE.Vector3(0, 1, 0);
    const hor = new THREE.Vector3().crossVectors(vert, axis).normalize();
    colorize(ng, v => {
      const d = new THREE.Vector3(v.x - c[0], v.y - c[1], v.z - c[2]).normalize();
      const fa = d.dot(axis);
      if (fa < -0.15) return C.green;
      if (fa > 0.62 && Math.abs(d.dot(hor)) < 0.11) return C.black;
      if (fa < 0.12) return [0.75, 0.55, 0.1];
      return C.red;
    });
    parts.push(ng);
  }
  // throat sac (inflates)
  const throat = ellipsoid([0.15, 0.07, 0.13], [0, 0.2, 0.38], 12, 8);
  colorize(throat, () => C.cream);
  parts.push(throat);
  // tongue (collapsed inside the mouth in the base pose)
  const tongue = limb([[0, 0.29, 0.5], [0, 0.29, 0.53], [0, 0.29, 0.56]], 0.025, 0.035, () => C.pink, 4, 5);
  parts.push(tongue);
  // legs
  for (const s of [-1, 1]) { parts.push(...legSet(s, pose, true)); parts.push(...legSet(s, pose, false)); }
  for (const p of parts) if (p.attributes.uv) p.deleteAttribute('uv');
  return { parts, throatIndex: 4, tongueIndex: 5 };
}

export function buildFrogGeometry() {
  const sit = buildPose('sit');
  const leap = buildPose('leap');
  const geoSit = mergeGeometries(sit.parts);
  const geoLeap = mergeGeometries(leap.parts);
  const n = geoSit.attributes.position.count;
  const dLeap = new Float32Array(n * 3), dThroat = new Float32Array(n * 3), dTongue = new Float32Array(n * 3);
  const ps = geoSit.attributes.position.array, pl = geoLeap.attributes.position.array;
  for (let i = 0; i < n * 3; i++) dLeap[i] = pl[i] - ps[i];
  // offsets of throat and tongue parts inside the merged buffer
  let off = 0;
  sit.parts.forEach((p, k) => {
    const cnt = p.attributes.position.count;
    if (k === sit.throatIndex) {
      for (let i = off; i < off + cnt; i++) {
        const x = ps[i * 3], y = ps[i * 3 + 1] - 0.2, z = ps[i * 3 + 2] - 0.38;
        dThroat[i * 3] = x * 0.85; dThroat[i * 3 + 1] = y * 1.4 - 0.03; dThroat[i * 3 + 2] = z * 0.6 + 0.02;
      }
    }
    if (k === sit.tongueIndex) {
      for (let i = off; i < off + cnt; i++) {
        const along = (ps[i * 3 + 2] - 0.5) / 0.06; // 0 base .. 1 tip
        dTongue[i * 3 + 2] = clamp(along, 0, 1) * 0.95;
        dTongue[i * 3 + 1] = -clamp(along, 0, 1) * 0.04;
      }
    }
    off += cnt;
  });
  geoSit.setAttribute('aDLeap', new THREE.BufferAttribute(dLeap, 3));
  geoSit.setAttribute('aDThroat', new THREE.BufferAttribute(dThroat, 3));
  geoSit.setAttribute('aDTongue', new THREE.BufferAttribute(dTongue, 3));
  geoLeap.dispose();
  // centre so the belly rests at y = 0
  geoSit.computeBoundingBox();
  const minY = geoSit.boundingBox.min.y;
  geoSit.translate(0, -minY, 0);
  geoSit.computeBoundingSphere();
  return geoSit;
}

const POSE_VERT = {
  vertexHeader: /* glsl */`
    attribute vec3 aDLeap, aDThroat, aDTongue;
    attribute vec4 aPose;
  `,
  vertex: {
    '#include <begin_vertex>': /* glsl */`$&
      transformed += aDLeap * aPose.x + aDThroat * aPose.y + aDTongue * aPose.z;
      transformed.y *= 1.0 + aPose.w * 0.04;
    `,
  },
};

export function createFrogMesh(shared, max, castShadow) {
  const geo = buildFrogGeometry();
  const pose = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  pose.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPose', pose);
  const mat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, clearcoat: 0.7, clearcoatRoughness: 0.2, sheen: 0.0 });
  patchMaterial(mat, { key: 'frogpose', ...POSE_VERT });
  jungleMaterial(mat, shared, { translucent: 0.15 });
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  if (castShadow) {
    mesh.castShadow = true;
    const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    patchMaterial(dm, { key: 'frogposedepth', ...POSE_VERT });
    mesh.customDepthMaterial = dm;
  }
  return { mesh, pose };
}
