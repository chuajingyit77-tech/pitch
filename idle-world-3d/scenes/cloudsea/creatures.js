// 云海 · residents: the old tortoise who practises tai chi under the peach tree (神龟), red-crowned
// cranes (仙鹤) and flocks of little blue spirit birds (青鸟). Procedural skinned rigs with IK.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, smoothstep, damp, dampAngle, angleDelta } from '../../lib/util.js';
import { patchStd } from './common.js';

const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c3 = V(), _d = V(), _t = V(), _u = V(), _l = V(), _n = V(), _pw = V(), _pole = V();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qp = new THREE.Quaternion(), _qi = new THREE.Quaternion();
const _col = new THREE.Color();

/* ------------------------------------------------------------------ */
/* Rig definition: bones in rest space + skinned parts                 */
/* ------------------------------------------------------------------ */
class RigDef {
  constructor() { this.defs = []; this.idx = new Map(); this.parts = []; }
  bone(name, parent, x, y, z) { this.idx.set(name, this.defs.length); this.defs.push({ name, parent, rest: new THREE.Vector3(x, y, z) }); return this; }
  rest(n) { return this.defs[this.idx.get(n)].rest; }
  /** geo in rest space; color: Color | (p, n) => Color; bind: bone name or chain of names; mat: shader id */
  part(geo, color, bind, mat = 0) {
    geo.deleteAttribute('uv');
    if (!geo.index) { geo.deleteAttribute('normal'); geo = mergeVertices(geo); }
    geo.computeVertexNormals();
    const p = geo.getAttribute('position'), nr = geo.getAttribute('normal'), n = p.count;
    const col = new Float32Array(n * 3), si = new Float32Array(n * 4), sw = new Float32Array(n * 4), mt = new Float32Array(n);
    const chain = Array.isArray(bind) ? bind.map(b => this.idx.get(b)) : null;
    const rigid = chain ? -1 : this.idx.get(bind);
    for (let i = 0; i < n; i++) {
      _a.fromBufferAttribute(p, i); _n.fromBufferAttribute(nr, i);
      const c = typeof color === 'function' ? color(_a, _n) : color;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      mt[i] = mat;
      if (!chain) { si[i * 4] = rigid; sw[i * 4] = 1; continue; }
      let best = 1e9, bi = 0, bt = 0;
      for (let k = 0; k < chain.length - 1; k++) {
        const A = this.defs[chain[k]].rest, B = this.defs[chain[k + 1]].rest;
        _b.subVectors(B, A); const L2 = _b.lengthSq();
        const tt = clamp(_c3.subVectors(_a, A).dot(_b) / L2, 0, 1);
        const d = _d.copy(A).addScaledVector(_b, tt).distanceToSquared(_a);
        if (d < best) { best = d; bi = k; bt = tt; }
      }
      let i0 = chain[bi], i1 = i0, w1 = 0;
      if (bt > 0.5) { i1 = chain[bi + 1]; w1 = 0.5 * smoothstep(0.5, 1, bt); if (bi + 1 === chain.length - 1 && bt > 0.999) w1 = 0.5; }
      else if (bi > 0) { i1 = chain[bi - 1]; w1 = 0.5 * smoothstep(0.5, 0, bt); }
      si[i * 4] = i0; si[i * 4 + 1] = i1; sw[i * 4] = 1 - w1; sw[i * 4 + 1] = w1;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geo.setAttribute('aMat', new THREE.BufferAttribute(mt, 1));
    this.parts.push(geo);
    return this;
  }
  geometry() { const g = mergeGeometries(this.parts); g.computeBoundingSphere(); g.boundingSphere.radius *= 2.5; return g; }
  instantiate(geo, material) {
    const bones = this.defs.map(d => { const b = new THREE.Bone(); b.name = d.name; return b; });
    this.defs.forEach((d, i) => {
      if (d.parent) { const pi = this.idx.get(d.parent); bones[pi].add(bones[i]); bones[i].position.copy(d.rest).sub(this.defs[pi].rest); }
      else bones[i].position.copy(d.rest);
    });
    const mesh = new THREE.SkinnedMesh(geo, material);
    this.defs.forEach((d, i) => { if (!d.parent) mesh.add(bones[i]); });
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(bones));
    mesh.frustumCulled = false;
    const B = {}, rest = {};
    this.defs.forEach((d, i) => { B[d.name] = bones[i]; rest[d.name] = bones[i].position.clone(); });
    return { mesh, B, rest };
  }
}

/** Two-bone IK in world space. Rest rotations are identity, so rest directions are the child offsets. */
function ik2(root, mid, end, target, pole) {
  root.parent.updateWorldMatrix(true, false);
  root.updateWorldMatrix(false, false);
  const A = root.getWorldPosition(_pw);
  // bone lengths in world units: the meshes are scaled (x1.25..2.1) and the targets are world points (with the
  // local lengths the limbs over-reached: the tortoise's feet ended ~9 cm inside the ground)
  const me = root.parent.matrixWorld.elements, ws = Math.hypot(me[0], me[1], me[2]);   // uniform scale
  const la = mid.position.length() * ws, lb = end.position.length() * ws;
  _d.subVectors(target, A);
  let dist = _d.length();
  const dir = _d.multiplyScalar(1 / Math.max(dist, 1e-5));
  dist = clamp(dist, Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
  const cosA = clamp((la * la + dist * dist - lb * lb) / (2 * la * dist), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  // bend direction: toward the pole, perpendicular to dir
  _n.subVectors(pole, A); _n.addScaledVector(dir, -_n.dot(dir));
  if (_n.lengthSq() < 1e-8) _n.set(0, -1, 0);
  _n.normalize();
  _u.copy(dir).multiplyScalar(cosA).addScaledVector(_n, sinA);        // upper bone direction (world)
  const E = _c3.copy(A).addScaledVector(_u, la);
  _l.copy(A).addScaledVector(dir, dist).sub(E).normalize();           // lower bone direction (world)
  root.parent.getWorldQuaternion(_qp);
  _qa.setFromUnitVectors(_a.copy(mid.position).normalize(), _u);      // world rotation of root
  root.quaternion.copy(_qi.copy(_qp).invert().multiply(_qa));
  _qb.setFromUnitVectors(_b.copy(end.position).normalize(), _l);      // world rotation of mid
  mid.quaternion.copy(_qi.copy(_qa).invert().multiply(_qb));
  return _qb; // world rotation of the mid bone
}

/* ------------------------------------------------------------------ */
/* Creature material                                                   */
/* ------------------------------------------------------------------ */
function creatureMaterial(shared, uniforms) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
  return patchStd(m, shared, {
    key: 'creature',
    uniforms,
    vertexHeader: 'attribute float aMat; varying float vMat; varying vec3 vRest;',
    vertex: { '#include <begin_vertex>': '$&\n vMat = aMat; vRest = position;' },
    fragmentHeader: /* glsl */`
      uniform float uGlowAmt, uShellGlow;
      uniform vec3 uShellC;
      varying float vMat; varying vec3 vRest;
      vec2 chash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
    `,
    fragment: {
      '#include <color_fragment>': /* glsl */`$&
        float shellLine = 0.0;
        if (vMat > 0.5 && vMat < 1.5) {
          vec3 sp = vRest - uShellC;
          vec2 uv = vec2(atan(sp.x, -sp.z) * 1.9, sp.y * 4.6);
          vec2 cell = floor(uv), f = fract(uv); float d1 = 8.0, d2 = 8.0;
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 g = vec2(float(i), float(j)); vec2 o = 0.2 + 0.6 * chash(cell + g);
            vec2 r = g + o - f; float d = dot(r, r);
            if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
          }
          float edge = sqrt(d2) - sqrt(d1);
          // At a distance the scute lines are thinner than a pixel and the growth rings several per pixel:
          // keep the lines at least ~1 px wide (dimmed to the same weight) and fade rings out before they alias.
          float fe = max(fwidth(edge), 1e-4);
          float lw = max(0.0675, fe);
          shellLine = (1.0 - smoothstep(lw - 0.0325 - fe * 0.5, lw + 0.0325 + fe * 0.5, edge)) * (0.0675 / lw);
          float rings = 0.5 + 0.5 * sin(edge * 55.0) * (1.0 - smoothstep(0.4, 0.9, fe * 55.0 / 6.2832));
          vec3 base = mix(vec3(0.19, 0.25, 0.15), vec3(0.42, 0.40, 0.2), smoothstep(0.1, 0.6, edge)) * (0.85 + 0.15 * rings);
          diffuseColor.rgb = mix(base, vec3(0.78, 0.58, 0.22), shellLine);
        } else if (vMat > 1.5 && vMat < 2.5) {
          float seg = abs(fract(vRest.y * 6.5) - 0.5);
          diffuseColor.rgb *= 0.82 + 0.18 * smoothstep(0.02, 0.12, seg);
          diffuseColor.rgb *= 0.9 + 0.1 * smoothstep(0.02, 0.06, abs(vRest.x));
        }
      `,
      '#include <emissivemap_fragment>': /* glsl */`$&
        totalEmissiveRadiance += vec3(1.0, 0.72, 0.3) * shellLine * uShellGlow;
        totalEmissiveRadiance += diffuseColor.rgb * uGlowAmt * (vMat > 2.5 ? 2.5 : 0.35);
        if (vMat > 2.5 && vMat < 3.5) totalEmissiveRadiance += diffuseColor.rgb * (0.4 + uShellGlow * 2.0);
      `,
      '#include <lights_fragment_end>': /* glsl */`$&
        { vec3 Vw = normalize(cameraPosition - vWPos);
          vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float rim = pow(1.0 - clamp(dot(Nw, Vw), 0.0, 1.0), 3.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * (uLightCol * pow(max(dot(-Vw, uLightDir), 0.0), 2.0) * 0.6 + uAmbient * 0.4) * rim; }
      `,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */
const ell = (rx, ry, rz, cx, cy, cz, seg = 18) => new THREE.SphereGeometry(1, seg, Math.max(8, Math.round(seg * 0.7))).scale(rx, ry, rz).translate(cx, cy, cz);
function tubeBetween(pts, r0, r1, radial = 10) {
  const curve = new THREE.CatmullRomCurve3(pts);
  const g = new THREE.TubeGeometry(curve, Math.max(6, pts.length * 4), 1, radial, false);
  // taper along the length (TubeGeometry is uniform): rescale rings around the curve
  const p = g.getAttribute('position'), segs = Math.max(6, pts.length * 4);
  const frames = curve.computeFrenetFrames(segs, false);
  for (let i = 0; i <= segs; i++) {
    const c = curve.getPointAt(i / segs), r = lerp(r0, r1, i / segs);
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      _a.fromBufferAttribute(p, k).sub(c).multiplyScalar(r).add(c);
      p.setXYZ(k, _a.x, _a.y, _a.z);
    }
  }
  // close the ends with small spheres so joints read solid
  return mergeGeometries([g.toNonIndexed(), ell(r0, r0, r0, pts[0].x, pts[0].y, pts[0].z, 10).toNonIndexed(), ell(r1, r1, r1, pts[pts.length - 1].x, pts[pts.length - 1].y, pts[pts.length - 1].z, 10).toNonIndexed()].map(x => { x.deleteAttribute('uv'); return x; }));
}
const cone = (r, h, x, y, z, rx = 0, ry = 0, rz = 0) => { const g = new THREE.ConeGeometry(r, h, 8); g.translate(0, h / 2, 0); g.rotateX(rx); g.rotateY(ry); g.rotateZ(rz); return g.translate(x, y, z); };

/* ------------------------------------------------------------------ */
/* Tortoise (神龟)                                                      */
/* ------------------------------------------------------------------ */
function tortoiseRig() {
  const R = new RigDef();
  R.bone('root', null, 0, 0.62, -0.02)
    .bone('spine', 'root', 0, 0.92, -0.06)
    .bone('chest', 'spine', 0, 1.2, -0.02)
    .bone('neck1', 'chest', 0, 1.34, 0.08).bone('neck2', 'neck1', 0, 1.47, 0.16).bone('head', 'neck2', 0, 1.58, 0.22)
    .bone('shoulderL', 'chest', 0.3, 1.24, 0.04).bone('elbowL', 'shoulderL', 0.41, 0.98, 0.12).bone('handL', 'elbowL', 0.43, 0.75, 0.16)
    .bone('shoulderR', 'chest', -0.3, 1.24, 0.04).bone('elbowR', 'shoulderR', -0.41, 0.98, 0.12).bone('handR', 'elbowR', -0.43, 0.75, 0.16)
    .bone('hipL', 'root', 0.19, 0.6, 0.0).bone('kneeL', 'hipL', 0.22, 0.33, 0.06).bone('footL', 'kneeL', 0.23, 0.08, 0.07)
    .bone('hipR', 'root', -0.19, 0.6, 0.0).bone('kneeR', 'hipR', -0.22, 0.33, 0.06).bone('footR', 'kneeR', -0.23, 0.08, 0.07)
    .bone('tail', 'root', 0, 0.48, -0.28);
  const skin = new THREE.Color('#93a46a'), skinDark = new THREE.Color('#62704a'), belly = new THREE.Color('#c8c08a');
  const skinFn = (p, n) => _col.copy(skin).lerp(skinDark, smoothstep(0.1, -0.8, n.z) * 0.6).lerp(belly, smoothstep(0.3, 0.9, n.z) * smoothstep(1.0, 1.5, p.y) * 0.3);
  const torso = ['root', 'spine', 'chest'];
  // body core, plastron, carapace
  R.part(ell(0.35, 0.5, 0.22, 0, 0.92, -0.05, 22), skinFn, torso);
  R.part(ell(0.33, 0.48, 0.13, 0, 0.92, 0.04, 22), new THREE.Color('#dacb92'), torso, 2);
  const shell = new THREE.SphereGeometry(1, 30, 22, Math.PI * 0.62, Math.PI * 1.76, 0.12, Math.PI * 0.8);
  shell.scale(0.47, 0.62, 0.38).translate(0, 0.94, -0.08);
  R.part(shell, new THREE.Color('#3d4b33'), torso, 1);
  // shell rim
  const rim = new THREE.TorusGeometry(1, 0.06, 6, 40); rim.scale(0.47, 1, 0.38); rim.rotateX(Math.PI / 2);
  const rimP = rim.getAttribute('position');
  for (let i = 0; i < rimP.count; i++) { const x = rimP.getX(i), z = rimP.getZ(i); rimP.setY(i, rimP.getY(i) * 0.5 + z * 0.0); rimP.setZ(i, z - 0.08); rimP.setX(i, x); }
  // neck, head
  R.part(tubeBetween([new THREE.Vector3(0, 1.22, 0.0), new THREE.Vector3(0, 1.36, 0.09), new THREE.Vector3(0, 1.48, 0.17), new THREE.Vector3(0, 1.56, 0.22)], 0.095, 0.075), skinFn, ['chest', 'neck1', 'neck2', 'head']);
  R.part(ell(0.105, 0.098, 0.13, 0, 1.6, 0.26), skinFn, 'head');
  R.part(ell(0.075, 0.062, 0.07, 0, 1.578, 0.355), skinFn, 'head');
  R.part(ell(0.05, 0.016, 0.04, 0, 1.553, 0.392), new THREE.Color('#3a3328'), 'head');
  for (const s of [-1, 1]) {
    R.part(ell(0.024, 0.024, 0.02, s * 0.068, 1.637, 0.335), new THREE.Color('#14100c'), 'head', 3);
    R.part(ell(0.008, 0.008, 0.006, s * 0.072, 1.645, 0.352), new THREE.Color('#ffffff'), 'head', 3);
    // long white sage eyebrows drooping out to the sides
    R.part(tubeBetween([new THREE.Vector3(s * 0.045, 1.672, 0.34), new THREE.Vector3(s * 0.11, 1.675, 0.32), new THREE.Vector3(s * 0.17, 1.64, 0.27), new THREE.Vector3(s * 0.2, 1.57, 0.22)], 0.016, 0.004, 6), new THREE.Color('#f6f3ea'), 'head');
    R.part(tubeBetween([new THREE.Vector3(s * 0.05, 1.664, 0.345), new THREE.Vector3(s * 0.1, 1.662, 0.33), new THREE.Vector3(s * 0.15, 1.625, 0.29)], 0.012, 0.004, 6), new THREE.Color('#eae6dc'), 'head');
  }
  // wispy beard: a few strands curling down from the chin
  for (const [x, len, cz] of [[0, 0.3, 0.02], [0.025, 0.24, 0.0], [-0.025, 0.25, 0.0], [0.045, 0.17, -0.01], [-0.045, 0.18, -0.01]]) {
    R.part(tubeBetween([new THREE.Vector3(x, 1.535, 0.33), new THREE.Vector3(x * 1.2, 1.535 - len * 0.45, 0.35 + cz), new THREE.Vector3(x * 0.9, 1.535 - len * 0.8, 0.34 + cz), new THREE.Vector3(x * 0.6 + 0.01, 1.535 - len, 0.37 + cz)], 0.018, 0.003, 6), new THREE.Color('#f6f3ea'), 'head');
  }
  // arms + hands
  for (const [s, L] of [[1, 'L'], [-1, 'R']]) {
    R.part(tubeBetween([new THREE.Vector3(s * 0.24, 1.24, 0.02), new THREE.Vector3(s * 0.3, 1.24, 0.04), new THREE.Vector3(s * 0.41, 0.98, 0.12), new THREE.Vector3(s * 0.43, 0.76, 0.16)], 0.085, 0.064), skinFn, ['chest', 'shoulder' + L, 'elbow' + L, 'hand' + L]);
    R.part(ell(0.068, 0.045, 0.085, s * 0.435, 0.7, 0.18), skinFn, 'hand' + L);
    for (let k = -1; k <= 1; k++) R.part(cone(0.012, 0.05, s * (0.435 + k * 0.03), 0.66, 0.24, Math.PI * 0.55, 0, 0), new THREE.Color('#3a3328'), 'hand' + L);
    // legs + feet
    R.part(tubeBetween([new THREE.Vector3(s * 0.17, 0.66, -0.01), new THREE.Vector3(s * 0.19, 0.6, 0.0), new THREE.Vector3(s * 0.22, 0.33, 0.06), new THREE.Vector3(s * 0.23, 0.1, 0.07)], 0.115, 0.09), skinFn, ['root', 'hip' + L, 'knee' + L, 'foot' + L]);
    R.part(ell(0.095, 0.055, 0.13, s * 0.23, 0.05, 0.12), skinFn, 'foot' + L);
    for (let k = -1; k <= 1; k++) R.part(cone(0.014, 0.05, s * (0.23 + k * 0.04), 0.03, 0.24, Math.PI / 2, 0, 0), new THREE.Color('#3a3328'), 'foot' + L);
  }
  R.part(cone(0.06, 0.2, 0, 0.5, -0.24, -2.2, 0, 0), skinFn, 'tail');
  return R;
}

const _fh = [V(), V()], _w1 = V(), _w2 = V(), _w3 = V();
const _qh = new THREE.Quaternion(), _qk = new THREE.Quaternion(), _qh2 = new THREE.Quaternion(), _qk2 = new THREE.Quaternion();
const easeStep = s => s * s * (3 - 2 * s);
/** Follow the ground height gy with an exact critically damped spring (p.y, velocity o.vyG): a step off the terrace eases
 *  down instead of dropping with an instant ~3 m/s (an exponential damp starts at full speed). */
function groundSpring(o, p, gy, w, dt) {
  const x0 = p.y - gy, c = o.vyG + w * x0, e = Math.exp(-w * dt);
  p.y = gy + (x0 + c * dt) * e;
  o.vyG = (o.vyG - w * c * dt) * e;
}

/**
 * Two feet planted in world space. Each frame the walker passes the spots under its hips (world, on the ground);
 * a foot that the body has carried away lifts and swings to its spot while the other stays planted, so feet never
 * slide, also when the walker starts, stops or turns on the spot.
 */
class Stepper {
  constructor() { this.F = [0, 1].map(() => ({ p: V(), from: V(), s: 0, swing: false })); this.ready = false; this.last = 1; this.ph = 0; this.w = 0; this.idleT = 0; }
  /** homes: [Vector3, Vector3]; thr / idleThr: step distances when moving / settling; dur: swing time (s) */
  update(dt, homes, moving, thr, idleThr, dur, lift) {
    const F = this.F;
    if (!this.ready) { F[0].p.copy(homes[0]); F[1].p.copy(homes[1]); F[0].swing = F[1].swing = false; this.ready = true; }
    this.idleT = moving ? 0 : this.idleT + dt;
    let sw = F[0].swing ? 0 : F[1].swing ? 1 : -1;
    if (sw < 0) {
      const e0 = Math.hypot(F[0].p.x - homes[0].x, F[0].p.z - homes[0].z), e1 = Math.hypot(F[1].p.x - homes[1].x, F[1].p.z - homes[1].z);
      const k = e0 > e1 * 1.2 ? 0 : e1 > e0 * 1.2 ? 1 : 1 - this.last;
      if ((k ? e1 : e0) > (moving ? thr : this.idleT > 0.4 ? idleThr : 1e9)) { sw = k; F[k].swing = true; F[k].s = 0; F[k].from.copy(F[k].p); this.last = k; }
    }
    if (sw >= 0) {
      const f = F[sw], h = homes[sw];
      f.s = Math.min(1, f.s + dt / dur);
      const e = easeStep(f.s), dist = Math.hypot(h.x - f.from.x, h.z - f.from.z);
      f.p.x = lerp(f.from.x, h.x, e); f.p.z = lerp(f.from.z, h.z, e);
      f.p.y = lerp(f.from.y, h.y, e) + Math.sin(Math.PI * f.s) * Math.min(lift, lift * 0.3 + dist * 0.5);
      if (f.s >= 1) f.swing = false;
      // continuous gait phase for body sway and arm swing: left foot in the air on 0..π, right on π..2π
      this.ph = (sw ? Math.PI : 0) + Math.PI * f.s;
    }
    this.w = damp(this.w, sw >= 0 ? 1 : 0, 6, dt);
  }
}

class Tortoise {
  constructor(sys, member, rigDef, geo, index) {
    this.sys = sys; this.member = member; this.kind = 'tortoise';
    this.uniforms = { uGlowAmt: { value: 0 }, uShellGlow: { value: 0 }, uShellC: { value: new THREE.Vector3(0, 0.94, -0.08) } };
    const inst = rigDef.instantiate(geo, creatureMaterial(sys.shared, this.uniforms));
    Object.assign(this, inst);
    this.mesh.castShadow = sys.env.shadows;
    this.scale = 1.42 * (member ? member.size || 1 : 1);
    this.mesh.scale.setScalar(this.scale);
    this.home = sys.world.taijiSpot(index);
    this.pos = this.home.p.clone();
    this.yaw = this.home.yaw;
    this.state = 'taichi';
    this.phase = sys.rng.range(0, TAU);
    this.form = 0; this.formT = 0; this.formBlend = 0;
    this.food = null; this.timer = 0; this.glow = 0; this.eatHand = 1;
    this.handT = [V(), V()];
    this.radius = 1.0;
    this.tmpPos = V();
    // Locomotion: an eased ground speed and a capped, eased turn rate (the old dampAngle spun a 180° turn at up
    // to 400°/s). The feet are planted in world space and step when the body has carried their spot away, so
    // they never slide, also when the tortoise turns on the spot (they used to swing backwards in the air and
    // slide forwards on the ground: a moonwalk).
    this.spd = 0; this.turnRate = 0; this.walkGoal = this.pos.clone(); this.afterWalk = 'taichi'; this.vyG = 0;
    this.steps = new Stepper();
    // pose blends: the tai-chi stance, the munching bow and the eating hand ease in and out instead of snapping
    this.taiW = 1; this.bendS = 0; this.crouchS = 0; this.eatW = 0; this.eatFrom = V(); this.eatLast = V();
    this.lookYaw = 0; this.lookPitch = 0;
  }
  get headPos() { return this.B.head.getWorldPosition(this.tmpPos); }
  wantsFood(f) { return this.state === 'taichi' && f.onMain && f.state !== 'float' && this.pos.distanceTo(f.pos) < 13; }
  /** Feet: home spots under the hips (wider in the tai-chi stance, a little ahead when walking). */
  stepFeet(dt, stanceW) {
    const W = this.sys.world, S = this.scale;
    const stance = lerp(0.23, 0.27, stanceW), lead = 0.22 * this.spd;
    const fx = Math.sin(this.yaw) * lead, fz = Math.cos(this.yaw) * lead;
    for (let k = 0; k < 2; k++) {
      const h = this.mesh.localToWorld(_fh[k].set(k ? -stance : stance, 0.08, 0.07));
      h.x += fx; h.z += fz;
      const g = W.mainGround(h.x, h.z);
      h.y = (g === null ? this.pos.y : g) + 0.08 * S;
    }
    // walking: step once a foot is 8 cm (x scale) behind; standing: settle a foot that is 4 cm off
    this.steps.update(dt, _fh, this.spd > 0.04 || Math.abs(this.turnRate) > 0.08, 0.08 * S, 0.04 * S, this.spd > 0.12 ? 0.42 : 0.5, 0.1 * S);
  }
  update(dt, t) {
    const sys = this.sys, B = this.B, R = this.rest, W = sys.world, S = this.scale;
    if (this.member) { const s = 1.42 * (this.member.size || 1); if (s !== this.scale) { this.scale = s; this.mesh.scale.setScalar(s); } }
    this.glow = Math.max(0, this.glow - dt * 0.12);
    this.uniforms.uGlowAmt.value = this.glow * 0.8;
    this.uniforms.uShellGlow.value = lerp(0.03, 0.5, sys.tod.night) + this.glow * 0.6;
    // hunger: practise closer to the viewer
    const hungry = this.member && sys.env.fullness(this.member) < 0.3;
    let spT = 0, wantYaw = null, turnK = 2.0, bend = 0, crouch = 0;
    if (this.state === 'taichi') {
      const goal = hungry ? W.hungrySpot(this.home, sys.camera) : this.home;
      const dx = goal.p.x - this.pos.x, dz = goal.p.z - this.pos.z;
      // (the hungry spot follows the drifting camera: move in fewer, longer walks rather than a shuffle every few s)
      if (Math.hypot(dx, dz) > (hungry ? 1.2 : 0.6)) { this.state = 'walk'; this.walkGoal.copy(goal.p); this.afterWalk = 'taichi'; }
      else { wantYaw = hungry ? Math.atan2(sys.camera.position.x - this.pos.x, sys.camera.position.z - this.pos.z) : goal.yaw; turnK = 0.6; }
    }
    if (this.state === 'walk' || this.state === 'toFood') {
      if (this.state === 'toFood' && (!this.food.alive || this.food.state === 'float')) { this.state = 'walk'; this.walkGoal.copy(this.home.p); this.food = null; }
      const g = this.state === 'toFood' ? this.food.pos : this.walkGoal;
      const dx = g.x - this.pos.x, dz = g.z - this.pos.z, d = Math.hypot(dx, dz);
      const stop = this.state === 'toFood' ? 0.55 * S : 0.15;
      // round the trunk, the stone lanterns, the pond and the pavilion instead of walking through them
      wantYaw = d > 0.05 ? W.walkHeading(this.pos.x, this.pos.z, g.x, g.z, 0.45 * S, sys.dyn, this) : this.yaw;
      const facing = Math.cos(angleDelta(this.yaw, wantYaw));
      // turn toward the goal before setting off, slow down on arrival
      spT = d > stop ? 0.42 * S * smoothstep(0.3, 0.95, facing) * smoothstep(0, 0.5, d - stop + 0.2) : 0;
      if (d <= stop + 0.02) {
        if (this.state === 'toFood') { this.state = 'reach'; this.timer = 0; this.eatHand = _w1.copy(this.food.pos).sub(this.pos).dot(_w2.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))) > 0 ? 0 : 1; }
        else { this.state = this.afterWalk || 'taichi'; }
      }
    }
    if (this.state === 'reach' || this.state === 'lift' || this.state === 'munch') {
      this.timer += dt;
      const f = this.food;
      if (this.state === 'reach') {
        crouch = smoothstep(0, 1.2, this.timer);
        if (!f || !f.alive) { this.food = null; this.state = 'walk'; this.walkGoal.copy(this.home.p); this.afterWalk = 'taichi'; this.timer = 0; }
        else if (this.timer > 1.4) { this.state = 'lift'; this.timer = 0; this.eatFrom.copy(this.eatLast); f.held = this; f.state = 'held'; }
      } else if (this.state === 'lift') {
        crouch = 1 - smoothstep(0, 1.0, this.timer);
        if (this.timer > 1.2) { this.state = 'munch'; this.timer = 0; this.bites = 0; }
      } else {
        bend = 0.12;
        const biteAt = 0.5 + this.bites * 1.1;
        if (this.timer > biteAt && f && f.alive) {
          this.bites++;
          sys.bite(f, this, this.bites >= 3 ? f.bites : 2);
          this.glow = Math.min(1.5, this.glow + 0.6);
        }
        if (this.bites >= 3 || !f || !f.alive) {
          if (f && f.alive) sys.bite(f, this, f.bites);
          this.food = null; this.state = 'walk'; this.walkGoal.copy(this.home.p); this.afterWalk = 'taichi'; this.timer = 0;
        }
      }
    }
    // heading: proportional, capped at ~50°/s and eased in and out; speed eased (no instant starts or stops)
    const omT = wantYaw === null ? 0 : clamp(angleDelta(this.yaw, wantYaw) * turnK, -0.9, 0.9);
    this.turnRate = damp(this.turnRate, omT, 5, dt);
    this.yaw += this.turnRate * dt;
    this.spd = damp(this.spd, spT, 3, dt);
    this.pos.x += Math.sin(this.yaw) * this.spd * dt; this.pos.z += Math.cos(this.yaw) * this.spd * dt;
    // body height: the floor under it, or a step just ahead (rise onto the terrace before reaching its edge)
    let gy = W.mainGround(this.pos.x, this.pos.z);
    const ga = W.mainGround(this.pos.x + Math.sin(this.yaw) * 0.3 * S, this.pos.z + Math.cos(this.yaw) * 0.3 * S);
    if (gy === null || (ga !== null && ga > gy)) gy = ga;
    if (gy !== null) groundSpring(this, this.pos, gy, 7, dt);

    /* ---- pose ---- */
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, this.yaw, 0);
    this.mesh.updateMatrixWorld(true);
    const ph = (this.phase += dt * (TAU / 11));
    // form schedule: cloud hands x3, opening x2
    this.formT += dt;
    const formLen = this.form === 0 ? 33 : 22;
    if (this.formT > formLen) { this.formT = 0; this.form = 1 - this.form; }
    const fb = smoothstep(0, 3, this.formT) * smoothstep(formLen, formLen - 3, this.formT);
    const cloud = this.form === 0 ? fb : 0, open = this.form === 1 ? fb : 0;
    const walkW = smoothstep(0.02, 0.2, this.spd);
    this.taiW = damp(this.taiW, this.state === 'taichi' ? 1 : 0, 2.5, dt);
    this.bendS = damp(this.bendS, bend, 4, dt);
    crouch = this.crouchS = damp(this.crouchS, crouch, 8, dt);   // (a reach cut short no longer pops upright)
    const stanceW = this.taiW * (1 - walkW);
    // gait sway: walking, or a single step on the spot
    const gw = Math.max(walkW, this.steps.w * 0.6), wp = this.steps.ph;
    // hips (the weight shifts over the planted foot, the hip of the lifted leg rises and swings forward)
    const sway = Math.sin(ph) * 0.07 * cloud * stanceW;
    const sink = (0.06 + 0.04 * (0.5 - 0.5 * Math.cos(2 * ph)) * cloud + 0.08 * (0.5 - 0.5 * Math.cos(ph)) * open) * stanceW + crouch * 0.3 + walkW * 0.02;
    B.root.position.set(R.root.x + sway - Math.sin(wp) * 0.04 * gw, R.root.y - sink + Math.abs(Math.sin(wp)) * 0.025 * gw, R.root.z);
    B.root.rotation.set(0.05 * stanceW + this.bendS + crouch * 0.25, Math.sin(ph) * 0.22 * cloud * stanceW - Math.sin(wp) * 0.08 * gw, Math.sin(wp) * 0.06 * gw);
    B.spine.rotation.set(0.04 + crouch * 0.3, Math.sin(ph - 0.5) * 0.1 * cloud * stanceW, 0);
    B.chest.rotation.set(-0.04 + crouch * 0.15, Math.sin(ph - 0.8) * 0.06 * cloud * stanceW, 0);
    B.tail.rotation.set(0, Math.sin(t * 1.3) * 0.2, 0);
    this.mesh.updateMatrixWorld(true);
    // hand targets in body-local space: rest -> cloud hands / opening (forms crossfade through rest)
    const hL = this.handT[0], hR = this.handT[1];
    const cy = 1.0, cz = 0.4;
    const cw = cloud * stanceW, ow = open * stanceW;
    hL.set(0.4, 0.8, 0.16); hR.set(-0.4, 0.8, 0.16);
    // cloud hands: vertical circles in front of the body, half a cycle apart
    hL.lerp(_a.set(0.08 + 0.3 * Math.cos(ph), cy + 0.24 * Math.sin(ph), cz + 0.06 * Math.sin(ph)), cw);
    hR.lerp(_a.set(-0.08 + 0.3 * Math.cos(ph + Math.PI), cy + 0.24 * Math.sin(ph + Math.PI), cz + 0.06 * Math.sin(ph + Math.PI)), cw);
    // opening: both arms float up to shoulder height and sink while the knees bend
    const o = 0.5 - 0.5 * Math.cos(ph);
    hL.lerp(_a.set(0.24, lerp(0.82, 1.22, o), lerp(0.28, 0.48, o)), ow);
    hR.lerp(_a.set(-0.24, lerp(0.82, 1.22, o), lerp(0.28, 0.48, o)), ow);
    // walking arm swing, opposite to the legs
    hL.z -= Math.sin(wp) * 0.12 * gw; hR.z += Math.sin(wp) * 0.12 * gw;
    // reaching for / lifting / eating the peach; afterwards the hand eases back instead of snapping down
    const eating = this.state === 'reach' || this.state === 'lift' || this.state === 'munch';
    const h = this.eatHand === 0 ? hL : hR;
    if (eating) {
      const s = this.eatHand === 0 ? 1 : -1;
      if (this.state === 'reach') {
        const k = smoothstep(0.1, 1.2, this.timer);
        const fp = this.mesh.worldToLocal(_c3.copy(this.food.pos));
        h.set(lerp(h.x, fp.x, k), lerp(h.y, fp.y + 0.08, k), lerp(h.z, fp.z, k));
      } else {
        // lift from wherever the hand took the peach (it used to jump to a fixed spot, peach and all)
        const k = this.state === 'lift' ? smoothstep(0, 1, this.timer) : 1;
        const bob = this.state === 'munch' ? Math.max(0, Math.sin(this.timer * 5.5)) * 0.04 : 0;
        h.lerpVectors(this.eatFrom, _a.set(s * 0.06, 1.5 - bob, 0.42), k);
      }
      this.eatLast.copy(h); this.eatW = 1;
    } else if (this.eatW > 0.002) {
      this.eatW = damp(this.eatW, 0, 2.5, dt);
      h.lerp(this.eatLast, this.eatW);
    }
    // IK arms (poles: elbows down and out)
    const tw = this.mesh.localToWorld(_t.copy(hL));
    const pole = this.mesh.localToWorld(_pole.set(1.2, 0.6, -0.3));
    ik2(B.shoulderL, B.elbowL, B.handL, tw, pole);
    const tw2 = this.mesh.localToWorld(_t.copy(hR));
    const pole2 = this.mesh.localToWorld(_pole.set(-1.2, 0.6, -0.3));
    ik2(B.shoulderR, B.elbowR, B.handR, tw2, pole2);
    B.handL.rotation.set(0.3 + 0.4 * cw * Math.sin(ph), 0, 0.2);
    B.handR.rotation.set(0.3 + 0.4 * cw * Math.sin(ph + Math.PI), 0, -0.2);
    // held peach follows the hand
    if (this.food && this.food.held === this) {
      const hb = this.eatHand === 0 ? B.handL : B.handR;
      hb.updateWorldMatrix(true, false);
      hb.getWorldPosition(this.food.pos);
      this.food.pos.y -= 0.05 * this.scale; this.food.pos.add(_a.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(0.08 * this.scale));
    }
    // feet: planted in world space (tai chi stance wider), stepping when walking or turning
    this.stepFeet(dt, stanceW);
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? 1 : -1;
      const fpole = this.mesh.localToWorld(_pole.set(s * 0.3, 0.4, 1.4));
      ik2(k ? B.hipR : B.hipL, k ? B.kneeR : B.kneeL, k ? B.footR : B.footL, _w3.copy(this.steps.F[k].p), fpole);
      // keep the foot flat
      const knee = k ? B.kneeR : B.kneeL, foot = k ? B.footR : B.footL;
      knee.updateWorldMatrix(true, false);
      knee.getWorldQuaternion(_qp);
      this.mesh.getWorldQuaternion(_qa);
      foot.quaternion.copy(_qp.invert().multiply(_qa));
    }
    // head follows the upper hand during tai chi, the peach when eating
    let lookYaw = 0, lookPitch = 0.05;
    if (this.state === 'taichi') { const up = Math.sin(ph) > 0 ? hL : hR; lookYaw = Math.atan2(up.x, 0.6) * 0.8 * cloud; lookPitch = -0.15 * open + (up.y - 1.1) * -0.4 * cloud; }
    if (this.state === 'reach') lookPitch = 0.6;
    if (this.state === 'munch') lookPitch = 0.15 + Math.max(0, Math.sin(this.timer * 5.5)) * 0.12;
    this.lookYaw = damp(this.lookYaw, lookYaw, 2, dt); this.lookPitch = damp(this.lookPitch, lookPitch, 2, dt);
    B.neck1.rotation.set(this.lookPitch * 0.4, this.lookYaw * 0.4, 0);
    B.neck2.rotation.set(this.lookPitch * 0.3, this.lookYaw * 0.3, 0);
    B.head.rotation.set(this.lookPitch * 0.3, this.lookYaw * 0.3, Math.sin(t * 0.3) * 0.04);
  }
  get position() { return this.B.chest.getWorldPosition(this.tmpPos); }
}

/* ------------------------------------------------------------------ */
/* Crane (仙鹤)                                                        */
/* ------------------------------------------------------------------ */
function craneRig() {
  const R = new RigDef();
  R.bone('root', null, 0, 0.98, 0)
    .bone('neck1', 'root', 0, 1.08, 0.2).bone('neck2', 'neck1', 0, 1.24, 0.25).bone('neck3', 'neck2', 0, 1.4, 0.24).bone('head', 'neck3', 0, 1.52, 0.27)
    .bone('wingL1', 'root', 0.12, 1.06, 0.1).bone('wingL2', 'wingL1', 0.58, 1.06, 0.06).bone('wingL3', 'wingL2', 1.15, 1.06, -0.04)
    .bone('wingR1', 'root', -0.12, 1.06, 0.1).bone('wingR2', 'wingR1', -0.58, 1.06, 0.06).bone('wingR3', 'wingR2', -1.15, 1.06, -0.04)
    .bone('hipL', 'root', 0.08, 0.92, -0.02).bone('kneeL', 'hipL', 0.085, 0.5, -0.06).bone('footL', 'kneeL', 0.085, 0.03, 0.0)
    .bone('hipR', 'root', -0.08, 0.92, -0.02).bone('kneeR', 'hipR', -0.085, 0.5, -0.06).bone('footR', 'kneeR', -0.085, 0.03, 0.0)
    .bone('tail', 'root', 0, 0.97, -0.34);
  const white = new THREE.Color('#f4f2ec'), black = new THREE.Color('#151517'), red = new THREE.Color('#d41e2a'), bill = new THREE.Color('#7c7f5c'), leg = new THREE.Color('#2a2a2c');
  R.part(ell(0.15, 0.155, 0.36, 0, 0.98, -0.02, 22).rotateX(0.0), white, 'root');
  for (const s of [-1, 1]) R.part(ell(0.07, 0.11, 0.3, s * 0.1, 1.0, -0.08, 16).rotateX(0.0), (p) => (p.z < -0.2 && p.y < 1.02 ? black : white), 'root');
  R.part(ell(0.115, 0.125, 0.15, 0, 1.0, 0.17), white, ['root', 'neck1']);
  // drooping black tertials over the tail
  for (const [x, y, z, ry] of [[0.06, 0.95, -0.3, 0.15], [-0.06, 0.95, -0.3, -0.15], [0.0, 0.97, -0.33, 0], [0.09, 0.93, -0.25, 0.3], [-0.09, 0.93, -0.25, -0.3]]) {
    const g = ell(0.05, 0.03, 0.2, 0, 0, 0, 12); g.rotateX(0.45); g.rotateY(ry); g.translate(x, y, z);
    R.part(g, black, ['root', 'tail']);
  }
  // neck: black, with a white nape on the upper part
  R.part(tubeBetween([new THREE.Vector3(0, 1.02, 0.15), new THREE.Vector3(0, 1.1, 0.21), new THREE.Vector3(0, 1.24, 0.25), new THREE.Vector3(0, 1.4, 0.24), new THREE.Vector3(0, 1.5, 0.265)], 0.045, 0.03, 9),
    (p, n) => (n.z < -0.35 && p.y > 1.2 ? white : black), ['root', 'neck1', 'neck2', 'neck3', 'head']);
  R.part(ell(0.04, 0.046, 0.068, 0, 1.53, 0.29), (p, n) => (n.z < -0.2 && p.y > 1.52 ? white : (p.y < 1.535 || p.z > 0.31 ? black : white)), 'head');
  R.part(ell(0.03, 0.013, 0.042, 0, 1.572, 0.285), red, 'head', 3);
  R.part(cone(0.014, 0.17, 0, 1.522, 0.34, Math.PI / 2, 0, 0), bill, 'head');
  for (const s of [-1, 1]) R.part(ell(0.008, 0.008, 0.006, s * 0.034, 1.54, 0.315), new THREE.Color('#0a0a0a'), 'head');
  // wings (spread rest pose): inner white with black secondaries, outer white primaries with fingers
  for (const [s, L] of [[1, 'L'], [-1, 'R']]) {
    const pos = [], idx = [];
    const N = 14;
    for (let i = 0; i <= N; i++) {
      const u = i / N, x = lerp(0.1, 1.15, u);
      const inner = x < 0.58;
      const v = (x - 0.58) / 0.57;
      const le = inner ? lerp(0.15, 0.1, (x - 0.1) / 0.48) : lerp(0.1, 0.02, v) - 0.06 * Math.pow(Math.max(0, v - 0.75) / 0.25, 2);
      let te = inner ? lerp(-0.34, -0.32, (x - 0.1) / 0.48) : lerp(-0.32, -0.22, v) + 0.18 * Math.pow(Math.max(0, v - 0.7) / 0.3, 1.5);
      if (!inner) te -= 0.06 * Math.max(0, Math.sin(u * 34)) * smoothstep(0.55, 0.85, u);
      const y = 1.06 + 0.012 * Math.sin(u * Math.PI);
      pos.push(s * x, y, le, s * x, y - 0.005, lerp(le, te, 0.5), s * x, y, te);
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < 2; j++) { const a = i * 3 + j, b = a + 3; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    R.part(g, (p) => (Math.abs(p.x) < 0.6 && p.z < -0.12 ? black : white), ['wing' + L + '1', 'wing' + L + '2', 'wing' + L + '3']);
    // legs
    R.part(ell(0.05, 0.1, 0.06, s * 0.08, 0.86, -0.03), white, 'hip' + L);
    R.part(tubeBetween([new THREE.Vector3(s * 0.08, 0.86, -0.03), new THREE.Vector3(s * 0.085, 0.5, -0.06), new THREE.Vector3(s * 0.085, 0.05, 0.0)], 0.013, 0.011, 6), leg, ['hip' + L, 'knee' + L, 'foot' + L]);
    for (const [ry, len] of [[0, 0.1], [0.45, 0.085], [-0.45, 0.085], [Math.PI, 0.04]]) R.part(cone(0.007, len, s * 0.085, 0.02, 0.0, Math.PI / 2, ry, 0), leg, 'foot' + L);
  }
  return R;
}

/** Cubic Bezier point of a landing curve {p0..p3} at t. */
function bez(P, t, out) {
  const u = 1 - t;
  return out.set(0, 0, 0).addScaledVector(P.p0, u * u * u).addScaledVector(P.p1, 3 * u * u * t).addScaledVector(P.p2, 3 * u * t * t).addScaledVector(P.p3, t * t * t);
}
const AIR = { fly: 1, approach: 1, glide: 1, takeoff: 1, snatch: 1 };
const GROUND = { stand: 1, walk: 1, peck: 1, turn: 1 };
/** Is another resident standing within r of (x, z)? (the tortoises and the cranes on the ground) */
function occupied(sys, self, x, z, r) {
  for (const o of sys.tortoises) if (o !== self && Math.hypot(o.pos.x - x, o.pos.z - z) < r) return o;
  for (const o of sys.cranes) if (o !== self && GROUND[o.state] === 1 && Math.hypot(o.pos.x - x, o.pos.z - z) < r) return o;
  return null;
}
const NOTICE_STATES = { fly: 1, approach: 1, stand: 1, walk: 1, peck: 1, turn: 1 };

class Crane {
  constructor(sys, member, rigDef, geo, rng, ambient = false) {
    this.sys = sys; this.member = member; this.kind = 'crane'; this.ambient = ambient;
    this.uniforms = { uGlowAmt: { value: 0 }, uShellGlow: { value: 0 }, uShellC: { value: new THREE.Vector3() } };
    Object.assign(this, rigDef.instantiate(geo, creatureMaterial(sys.shared, this.uniforms)));
    this.mesh.castShadow = sys.env.shadows && !ambient;
    this.scale = (ambient ? 1.6 : 1.25) * (member ? member.size || 1 : 1);
    this.mesh.scale.setScalar(this.scale);
    this.rng = rng;
    const a = rng.range(0, TAU);
    this.orbit = { r: ambient ? rng.range(140, 260) : rng.range(17, 34), h: ambient ? rng.range(10, 60) : rng.range(5, 14), a, w: (ambient ? 0.025 : rng.range(0.07, 0.1)) * rng.sign(), tilt: rng.range(-0.3, 0.3), ph: rng.range(0, TAU) };
    this.pos = new THREE.Vector3(Math.cos(a) * this.orbit.r, this.orbit.h, Math.sin(a) * this.orbit.r);
    this.vel = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(6 * Math.sign(this.orbit.w));
    this.yaw = Math.atan2(this.vel.x, this.vel.z); this.pitch = 0; this.bank = 0;
    this.state = 'fly'; this.timer = rng.range(0, 20); this.flapPh = rng.range(0, TAU); this.flapUntil = 0; this.nextFlap = rng.range(1, 5);
    this.glow = 0; this.food = null; this.ground = 0; this.pose = { fly: 1, fold: 0, legs: 0, flare: 0, peck: 0, air: 1 };
    this.radius = 1.2;
    this.tmpPos = V();
    this.restTime = rng.range(25, 60);
    // Flight: heading, horizontal / vertical speed and a smoothed turn rate. The heading turns at a capped rate
    // and the bank comes from the real turn rate (it was the heading error divided by the frame time, so the
    // cranes banked twice as hard at 60 fps as at 30, and mostly sat at the 40° limit).
    this.hd = this.yaw; this.vh = 6; this.vy = 0; this.om = 0;
    this.flapRate = 0.25; this.flapA = 0;
    // ground: eased walking speed and turn rate
    this.walkSpd = 0; this.turnRate = 0; this.stroll = null; this.steps = new Stepper(); this.legDrop = 0; this.vyG = 0;
    this.land = { spot: V(), ad: 0, phase: 'in' }; this.toHd = 0; this.lift = 0; this.extend = false;
    this.path = { p0: V(), p1: V(), p2: V(), p3: V(), len: 1, s: 0, v0: 6 };
    this.arc = new Float32Array(33);   // arc length table of the landing curve (constant speed along it)
  }
  get position() { return this.B.root.getWorldPosition(this.tmpPos); }
  wantsFood(f) { return !this.ambient && !this.food && NOTICE_STATES[this.state] === 1; }
  /** Re-derive the flight state after the position / velocity were set from outside. */
  resetFlight() {
    this.vh = Math.hypot(this.vel.x, this.vel.z); this.vy = this.vel.y; this.om = 0;
    if (this.vh > 0.01) this.yaw = this.hd = Math.atan2(this.vel.x, this.vel.z); else this.hd = this.yaw;
  }
  /** Fly toward (tx,ty,tz): capped turn rate, eased speed and climb; islets and buildings bend the heading. */
  steer(tx, ty, tz, cruise, dt, turnMax, avoidK, climbK = 0.45, climbMax = 1.6) {
    const p = this.pos, dx = tx - p.x, dz = tz - p.z, d = Math.max(Math.hypot(dx, dz), 1e-3);
    this.flyDir(dx / d, dz / d, ty, cruise, dt, turnMax, avoidK, climbK, climbMax);
  }
  /** Fly along the horizontal direction (wx, wz) at height ty. */
  flyDir(wx, wz, ty, cruise, dt, turnMax, avoidK, climbK = 0.45, climbMax = 1.6) {
    const p = this.pos, want = _w1.set(wx, 0, wz);
    if (avoidK) this.sys.world.avoid(p, this.vel, want, avoidK);
    const omT = clamp(angleDelta(this.hd, Math.atan2(want.x, want.z)) * 1.1, -turnMax, turnMax);
    this.om = damp(this.om, omT, 2.5, dt);
    this.hd += this.om * dt;
    this.vy = damp(this.vy, clamp((ty - p.y) * climbK + want.y * 1.2, -climbMax, climbMax), 1.5, dt);
    this.vh = damp(this.vh, cruise, 0.9, dt);
    this.vel.set(Math.sin(this.hd) * this.vh, this.vy, Math.cos(this.hd) * this.vh);
    p.addScaledVector(this.vel, dt);
  }
  /** Choose a clear final approach into `target` (on a lawn); touch down `offset` m short of it. */
  planLanding(target, offset) {
    const W = this.sys.world, p = this.pos;
    const toT = Math.atan2(target.x - p.x, target.z - p.z);
    let best = null, bestCost = 1e9;
    for (let i = 0; i < 16; i++) {
      const a = toT + (i < 8 ? i : i - 16) * (TAU / 16);
      const sx = Math.sin(a), sz = Math.cos(a);
      const tx = target.x - sx * offset, tz = target.z - sz * offset;
      const gy = W.groundAt(tx, tz);
      if (gy === null || W.blocked(tx, gy + 1.2, tz, 0.6)) continue;   // not under a low bough
      if (occupied(this.sys, this, tx, tz, 1.3)) continue;              // nor on top of another resident
      let ok = true;
      for (let k = 1; k <= 9 && ok; k++) {
        const back = 2 * k;   // the final leg: 18 m out, descending ~0.22 m per m
        if (W.blocked(tx - sx * back, gy + 1.0 + Math.max(0, back - 4) * 0.22, tz - sz * back, 1.1)) ok = false;
      }
      if (!ok) continue;
      // prefer lines the crane is already behind and flying along (less circling to line up)
      const along = (tx - p.x) * sx + (tz - p.z) * sz;
      const cost = Math.abs(angleDelta(toT, a)) + 0.5 * Math.abs(angleDelta(this.hd, a)) + 0.03 * Math.max(0, 30 - along);
      if (cost < bestCost) { bestCost = cost; best = a; }
    }
    if (best === null) return false;
    const L = this.land;
    L.ad = best;
    { const ax = L.ad, along = (target.x - p.x) * Math.sin(ax) + (target.z - p.z) * Math.cos(ax);
      L.phase = along > 28 && Math.abs(angleDelta(this.hd, ax)) < 1.6 ? 'in' : 'out'; }
    L.spot.set(target.x - Math.sin(best) * offset, 0, target.z - Math.cos(best) * offset);
    L.spot.y = W.groundAt(L.spot.x, L.spot.z);
    this.state = 'approach'; this.timer = 0;
    return true;
  }
  /** Final glide: a short curve from the line-up point onto the spot, flown at a set speed. */
  startGlide() {
    const L = this.land, P = this.path, p = this.pos;
    const d = p.distanceTo(L.spot);
    P.p0.copy(p);
    P.p1.copy(this.vel).normalize().multiplyScalar(d * 0.38).add(p);
    P.p2.set(-Math.sin(L.ad), 0, -Math.cos(L.ad)).multiplyScalar(d * 0.32).add(L.spot); P.p2.y += 0.8;
    P.p3.copy(L.spot);
    let acc = 0;
    bez(P, 0, _w1); this.arc[0] = 0;
    for (let i = 1; i <= 32; i++) { bez(P, i / 32, _w2); acc += _w2.distanceTo(_w1); this.arc[i] = acc; _w1.copy(_w2); }
    P.len = acc; P.s = 0; P.v0 = Math.max(this.vel.length(), 3);
    this.state = 'glide'; this.timer = 0;
  }
  /** Curve parameter at arc length s. */
  tAt(s) {
    const A = this.arc;
    let i = 1;
    while (i < 32 && A[i] < s) i++;
    return (i - 1 + clamp((s - A[i - 1]) / Math.max(A[i] - A[i - 1], 1e-6), 0, 1)) / 32;
  }
  /** Pick a take-off heading with a clear climb-out, preferring the way the crane already faces. */
  planTakeoff() {
    const W = this.sys.world, p = this.pos;
    let best = this.yaw, bestN = -1;
    for (let i = 0; i < 16; i++) {
      const a = this.yaw + (i & 1 ? -1 : 1) * Math.ceil(i / 2) * (TAU / 16);
      const sx = Math.sin(a), sz = Math.cos(a);
      let n = 0;
      for (let d = 2; d <= 26; d += 2) {
        if (W.blocked(p.x + sx * d, p.y + 0.9 + Math.max(0, d - 3) * 0.36, p.z + sz * d, 1.0)) break;
        n++;
      }
      if (n > bestN) { bestN = n; best = a; }
      if (n === 13) break;
    }
    this.toHd = best; this.state = 'turn'; this.timer = 0; this.stroll = null;
  }
  update(dt, t) {
    const sys = this.sys, B = this.B, W = sys.world, p = this.pos;
    if (this.member) { const s = 1.25 * (this.member.size || 1); if (s !== this.scale) { this.scale = s; this.mesh.scale.setScalar(s); } }
    this.glow = Math.max(0, this.glow - dt * 0.15);
    this.uniforms.uGlowAmt.value = this.glow * 0.6;
    this.timer += dt;
    const P = this.pose;
    let flapAmp = 0, flapRateT = 0.25;
    const hungry = this.member && sys.env.fullness(this.member) < 0.3;
    const cruise = this.ambient ? 9 : 6.5;
    if (this.state === 'fly' || this.state === 'approach') {
      // flapping bouts between long glides: a little faster while the wings beat, sinking a little in the glide
      if (t > this.nextFlap) { this.flapUntil = t + this.rng.range(2.2, 3.6); this.nextFlap = this.flapUntil + this.rng.range(3, 7); }
      const flapping = t < this.flapUntil || this.vy > 0.6;
      flapAmp = flapping ? 0.95 : 0.06; flapRateT = flapping ? 1.25 : 0.25;
      const sp = cruise * (flapping ? 1.04 : 0.96), sink = flapping ? 0 : 0.6;
      if (this.state === 'fly') {
        // follow the orbit circle: chase a point a little ahead of the crane on it (a carrot that moved with
        // the clock was far slower than the bird, which caught it and looped round it)
        const o = this.orbit;
        const cx = hungry ? sys.camera.position.x * 0.6 : 0, cz = hungry ? sys.camera.position.z * 0.6 : 0;
        const ra = o.r * (1 + 0.18 * Math.sin(t * 0.07 + o.ph)) * (hungry ? 0.6 : 1);
        o.a = Math.atan2(p.z - cz, p.x - cx);
        const aC = o.a + Math.sign(o.w) * (this.vh * 1.5 + 4) / Math.max(ra, 6);
        const hT = o.h + Math.sin(t * 0.11 + o.ph) * 3 + Math.cos(aC * 2) * o.tilt * 6;
        this.steer(cx + Math.cos(aC) * ra, hT - sink, cz + Math.sin(aC) * ra, sp, dt, this.ambient ? 0.45 : 0.8, 1.5);
        if (!this.ambient && this.timer > this.restTime && !this.food) {
          const spot = W.landingSpot(this.rng, hungry ? sys.camera : null);
          if (!spot || !this.planLanding(spot, 0)) this.timer = this.restTime - 6;   // look again a little later
        }
      } else {
        // Approach: if too close or facing away, fly out beside the approach line ('out', a downwind leg), turn
        // and follow the line in ('in': steer toward the line, at most 60° off it). Lined up -> final glide.
        const L = this.land, sx = Math.sin(L.ad), sz = Math.cos(L.ad);
        const rx = L.spot.x - p.x, rz = L.spot.z - p.z;
        const along = rx * sx + rz * sz, lat = rx * sz - rz * sx, herr = angleDelta(this.hd, L.ad);
        if (L.phase === 'in' && (along < 9 || (along < 20 && (Math.abs(lat) > 3.5 || Math.abs(herr) > 0.7)))) L.phase = 'out';
        if (L.phase === 'out' && along > 34) L.phase = 'in';
        const cy = L.spot.y + 1.0 + clamp(along - 4, 0, 40) * 0.22 - sink;   // a shallow glide slope (~12°)
        if (L.phase === 'in' && along < 24 && Math.abs(lat) < 2.5 && Math.abs(herr) < 0.45) this.startGlide();
        else if (L.phase === 'in') {
          const h = L.ad + clamp(Math.atan(lat * 0.18), -1.05, 1.05);
          // on the final leg the path is known to be clear: no avoidance pushes (they fought the descent)
          this.flyDir(Math.sin(h), Math.cos(h), cy, sp, dt, 0.8, along < 32 ? 0 : 1.0);
        } else {
          const side = lat > 0 ? -1 : 1;   // stay on the side of the line the crane is on
          this.steer(L.spot.x - sx * 40 + sz * side * 16, L.spot.y + 7.5 - sink, L.spot.z - sz * 40 - sx * side * 16, sp, dt, 0.8, 1.0);
        }
        if (this.timer > 50) { this.state = 'fly'; this.timer = this.restTime - 10; this.food = null; }
      }
      P.fly = damp(P.fly, 1, 3, dt); P.fold = damp(P.fold, 0, 4, dt); P.legs = damp(P.legs, 0, 3, dt); P.flare = damp(P.flare, 0, 3, dt); P.air = damp(P.air, 1, 3, dt);
    }
    if (this.state === 'glide') {
      // the final glide, flown at a set speed along the curve (the old curve parameter ran at a varying speed,
      // so the crane braked and surged on the way in); braking wing beats, legs forward, a nose-up flare
      const Pt = this.path, rem = Pt.len - Pt.s;
      const sp = lerp(0.9, Pt.v0, smoothstep(0.5, 10, rem));
      const over = Pt.s + sp * dt - Pt.len;
      Pt.s = Math.min(Pt.len, Pt.s + sp * dt);
      _w3.copy(p);
      bez(Pt, this.tAt(Pt.s), p);
      if (over > 0) { p.x += Math.sin(this.hd) * over; p.z += Math.cos(this.hd) * over; }   // run on past the spot: no stutter at touchdown
      this.vel.subVectors(p, _w3).multiplyScalar(1 / Math.max(dt, 1e-4));
      const vh = Math.hypot(this.vel.x, this.vel.z);
      if (vh > 0.2) { const d = angleDelta(this.hd, Math.atan2(this.vel.x, this.vel.z)); this.hd += d; this.om = damp(this.om, clamp(d / Math.max(dt, 1e-4), -1.5, 1.5), 6, dt); }
      this.vh = vh; this.vy = this.vel.y;
      const near = 1 - smoothstep(0, 9, rem);
      flapAmp = lerp(0.2, 0.9, smoothstep(0.45, 1, near)); flapRateT = lerp(0.3, 1.7, near);
      P.fly = damp(P.fly, 1, 3, dt); P.legs = damp(P.legs, near, 3, dt); P.flare = damp(P.flare, near, 3, dt); P.fold = damp(P.fold, 0, 4, dt); P.air = damp(P.air, 1, 3, dt);
      if (Pt.s >= Pt.len) {
        // touch down and run out a step or two
        this.state = 'stand'; this.timer = 0; this.yaw = this.hd; this.walkSpd = sp; this.turnRate = 0; this.vyG = 0;
        this.vel.set(0, 0, 0); this.ground = p.y; this.restTime = this.rng.range(18, 40);
      }
    } else if (this.state === 'stand' || this.state === 'walk' || this.state === 'peck' || this.state === 'turn') {
      flapAmp = 0;
      P.fly = damp(P.fly, 0, 3, dt); P.fold = damp(P.fold, 1, 2.5, dt); P.legs = damp(P.legs, 0, 3, dt); P.flare = damp(P.flare, 0, 3, dt); P.air = damp(P.air, 0, 4, dt);
      let spT = 0, wantYaw = null;
      const f = this.food;
      if (this.state === 'turn') {
        // turn on the spot toward the chosen take-off heading, then run
        if (f) this.state = 'stand';
        else {
          wantYaw = this.toHd;
          if (Math.abs(angleDelta(this.yaw, this.toHd)) < 0.1 && Math.abs(this.turnRate) < 0.3) {
            this.state = 'takeoff'; this.timer = 0; this.hd = this.yaw; this.vh = this.walkSpd; this.vy = 0; this.om = 0; this.lift = 0; this.ground = p.y; this.vyG = 0;
          }
        }
      } else if (f && f.alive && f.state !== 'float') {
        this.stroll = null;
        const dx = f.pos.x - p.x, dz = f.pos.z - p.z, d = Math.hypot(dx, dz);
        const reach = 0.62 * this.scale;
        wantYaw = d > 0.2 ? W.walkHeading(p.x, p.z, f.pos.x, f.pos.z, 0.3 * this.scale, sys.dyn, this) : this.yaw;
        if (d > reach) {
          this.state = 'walk';
          spT = 0.7 * this.scale * smoothstep(0.2, 0.9, Math.cos(angleDelta(this.yaw, wantYaw))) * smoothstep(0, 0.35, d - reach + 0.05);
          // someone already at the peach: wait rather than walk into them
          if (occupied(sys, this, p.x + Math.sin(this.yaw) * 0.6, p.z + Math.cos(this.yaw) * 0.6, 0.75)) spT = 0;
          P.peck = damp(P.peck, 0, 5, dt);
        } else {
          this.state = 'peck';
          P.peck = damp(P.peck, 1, 5, dt);
          if (this.timer > 1.1) { this.timer = 0; sys.bite(f, this, 1); this.glow = Math.min(1.5, this.glow + 0.5); }
        }
      } else {
        if (f) this.food = null;
        if (this.state === 'peck') this.state = 'stand';
        P.peck = damp(P.peck, 0, 3, dt);
        // idle: an occasional stroll, then fly off
        if (!this.stroll && this.state === 'stand' && this.walkSpd < 0.05 && this.rng.chance(dt * 0.12)) this.stroll = { t: this.rng.range(1.5, 3.5), yaw: this.yaw + this.rng.range(-1.2, 1.2) };
        if (this.stroll) {
          this.stroll.t -= dt; wantYaw = this.stroll.yaw;
          // look ahead: stop before the lawn's edge, a step or an obstacle
          const ax = p.x + Math.sin(this.yaw) * 0.9, az = p.z + Math.cos(this.yaw) * 0.9, gy = W.groundAt(ax, az);
          if (gy === null || Math.abs(gy - p.y) > 0.35 || Math.abs(angleDelta(W.walkHeading(p.x, p.z, ax, az, 0.25), Math.atan2(ax - p.x, az - p.z))) > 0.05) this.stroll.t = 0;
          if (this.stroll.t > 0) { this.state = 'walk'; spT = 0.55 * smoothstep(0.3, 0.9, Math.cos(angleDelta(this.yaw, wantYaw))); }
          else this.stroll = null;
        }
        if (!this.stroll && this.state === 'walk' && this.walkSpd < 0.05) this.state = 'stand';
        if ((this.timer > this.restTime && !hungry || this.timer > this.restTime * 2.5) && this.walkSpd < 0.1) this.planTakeoff();
      }
      // turn on the spot at a calm, capped rate; ease the walking speed in and out
      const omT = wantYaw === null ? 0 : clamp(angleDelta(this.yaw, wantYaw) * 2.5, -1.6, 1.6);
      this.turnRate = damp(this.turnRate, omT, 6, dt);
      this.yaw += this.turnRate * dt;
      this.walkSpd = damp(this.walkSpd, spT, 4, dt);
      p.x += Math.sin(this.yaw) * this.walkSpd * dt; p.z += Math.cos(this.yaw) * this.walkSpd * dt;
      let gy = W.groundAt(p.x, p.z);
      const ga = W.groundAt(p.x + Math.sin(this.yaw) * 0.3 * this.scale, p.z + Math.cos(this.yaw) * 0.3 * this.scale);
      if (gy === null || (ga !== null && ga > gy)) gy = ga;
      if (gy !== null) groundSpring(this, p, gy, 8, dt);
      this.hd = this.yaw; this.om = 0;
    } else if (this.state === 'takeoff') {
      // a short run with the wings beating, lift-off once there is some speed, then a steady climb-out
      this.vh = damp(this.vh, cruise, 0.9, dt);
      this.lift = Math.max(this.lift, smoothstep(2.0, 3.2, this.vh));
      this.vy = damp(this.vy, 2.3 * this.lift, 2.5, dt);
      if (this.lift > 0.5) {
        const want = _w1.set(Math.sin(this.toHd), 0, Math.cos(this.toHd));
        W.avoid(p, this.vel, want, 1.0);
        this.om = damp(this.om, clamp(angleDelta(this.hd, Math.atan2(want.x, want.z)) * 1.1, -0.8, 0.8), 2.5, dt);
        this.hd += this.om * dt;
      }
      this.vel.set(Math.sin(this.hd) * this.vh, this.vy, Math.cos(this.hd) * this.vh);
      p.addScaledVector(this.vel, dt);
      // on the ground until lift-off (eased over a terrace edge: it snapped 0.3 m in one frame)
      const gy = W.groundAt(p.x, p.z);
      if (gy !== null && (this.lift < 0.05 || p.y < gy)) groundSpring(this, p, gy, 10, dt); else this.vyG = 0;
      this.walkSpd = this.vh * (1 - this.lift);
      flapAmp = 1.0; flapRateT = 1.8;
      P.fly = damp(P.fly, 1, 4, dt); P.fold = damp(P.fold, 0, 6, dt); P.legs = damp(P.legs, 0, 1.5, dt); P.flare = damp(P.flare, 0.3 * (1 - this.lift), 3, dt); P.air = damp(P.air, this.lift, 3, dt);
      if (p.y > this.ground + 6.5 || this.timer > 10) { this.state = 'fly'; this.timer = 0; this.restTime = this.rng.range(30, 70); this.walkSpd = 0; this.orbit.a = Math.atan2(p.z, p.x); }
    } else if (this.state === 'snatch') {
      // fly through a floating peach and take it in one pass; if it is too close to turn onto, extend
      // straight ahead first and come round (it used to circle the peach, taking two bites per pass)
      const f = this.food;
      if (!f || !f.alive || (f.state !== 'float' && f.state !== 'fall')) { this.state = 'fly'; this.food = null; }
      else {
        const dx = f.pos.x - p.x, dz = f.pos.z - p.z, dh = Math.hypot(dx, dz);
        const err = Math.abs(angleDelta(this.hd, Math.atan2(dx, dz))), Rt = this.vh / 1.1;
        if (this.extend || (err > 1.2 && dh < 2.2 * Rt)) this.extend = dh < 2.6 * Rt;
        const tx = this.extend ? p.x + Math.sin(this.hd) * 10 : f.pos.x, tz = this.extend ? p.z + Math.cos(this.hd) * 10 : f.pos.z;
        this.steer(tx, f.pos.y - 0.35 * this.scale, tz, 7.5, dt, 1.1, 1.0, 0.9, 2.4);
        flapAmp = 0.8; flapRateT = 1.4;
        const hdist = this.B.head.getWorldPosition(_w3).distanceTo(f.pos);
        if (hdist < 0.8 * this.scale || p.distanceTo(f.pos) < 0.6 * this.scale) {
          sys.bite(f, this, f.bites); this.glow = Math.min(1.5, this.glow + 0.8); this.food = null; this.state = 'fly'; this.timer = 0;
        } else if (this.timer > 14) { this.food = null; this.state = 'fly'; }
      }
      P.fly = damp(P.fly, 1, 3, dt); P.fold = damp(P.fold, 0, 4, dt); P.legs = damp(P.legs, 0, 3, dt); P.flare = damp(P.flare, 0, 3, dt); P.air = damp(P.air, 1, 3, dt);
    }

    /* ---- orientation: the body follows the flight path; banks from the turn rate, pitches with the climb ---- */
    if (AIR[this.state] === 1) {
      this.yaw = this.hd;
      this.bank = damp(this.bank, clamp(-Math.atan(this.vh * this.om / 9.8) * 1.2, -0.6, 0.6), 4, dt);
      const climb = clamp(Math.atan2(this.vy, Math.max(this.vh, 0.5)), -0.45, 0.45);
      // flare nose-up to land (it pitched nose-down by the flare amount), lean into the take-off run
      const flare = this.state === 'glide' ? P.flare : 0, lean = this.state === 'takeoff' ? 0.18 * (1 - this.lift) : 0;
      this.pitch = damp(this.pitch, lerp(climb, 0.5, flare) - lean, 3, dt);
    } else { this.bank = damp(this.bank, 0, 4, dt); this.pitch = damp(this.pitch, 0, 4, dt); }
    this.mesh.position.copy(p);
    this.mesh.rotation.set(-this.pitch, this.yaw, this.bank, 'YXZ');

    /* ---- skeleton pose ---- */
    // the wing-beat rate eases between beating and gliding (it switched instantly) and the phase is wrapped
    this.flapRate = damp(this.flapRate, flapRateT, 3, dt);
    this.flapPh += dt * TAU * this.flapRate;
    if (this.flapPh > TAU * 64) this.flapPh -= TAU * 64;
    const fa = this.flapA = damp(this.flapA, flapAmp, 4, dt);
    const fl = Math.sin(this.flapPh) * fa, fl2 = Math.sin(this.flapPh - 0.9) * fa;
    const fly = P.fly, fold = P.fold;
    // wings: spread + flap when flying, folded along the body when standing
    for (let s = 1; s >= -1; s -= 2) {
      const w1 = s > 0 ? B.wingL1 : B.wingR1, w2 = s > 0 ? B.wingL2 : B.wingR2;
      const flapZ = (fl * 0.62 + 0.08 - P.flare * 0.15) * s;
      w1.rotation.set(lerp(0, -1.4, fold) + P.flare * 0.25, s * lerp(0, 1.45, fold), lerp(flapZ * fly, s * -0.12, fold), 'YXZ');
      w2.rotation.set(0, s * lerp(-P.flare * 0.2, -2.8, fold), lerp(fl2 * 0.4 * s * fly, 0, fold), 'YXZ');
      // once folded, the wing tucks away into the body (the body carries folded-wing shapes)
      w1.scale.setScalar(lerp(1, 0.04, smoothstep(0.45, 0.95, fold)));
    }
    // neck: extended forward in flight, S-curve standing, down when pecking
    const peck = P.peck;
    const jab = peck * (0.5 + 0.5 * Math.sin(this.timer * 5.7)) * 0.25;
    const look = Math.sin(t * 0.37 + this.orbit.ph) * 0.5 * (1 - fly) * (1 - peck);
    B.neck1.rotation.set(lerp(lerp(0, 1.25, fly), 1.15 + jab, peck), look * 0.3, 0);
    B.neck2.rotation.set(lerp(lerp(0, 0.25, fly), 0.45, peck), look * 0.3, 0);
    B.neck3.rotation.set(lerp(lerp(0, 0.05, fly), 0.2 + jab, peck), look * 0.3, 0);
    B.head.rotation.set(lerp(lerp(0, -1.3, fly), 0.1, peck), look * 0.2, 0);
    B.root.rotation.set(peck * 0.25, 0, 0);
    B.tail.rotation.set(fly * 0.3, 0, 0);
    // legs: trailing in flight and swung forward to land (posed); on the ground the feet are planted by IK and
    // step when the body has carried their spot away, so they never slide (the old walk cycle ran at a fixed rate
    // whatever the speed, and bent the knee forward like a person's; a crane's ankle bends back)
    const trail = P.air * (1 - P.legs), groundW = 1 - P.air;
    for (let k = 0; k < 2; k++) {
      (k ? B.hipR : B.hipL).rotation.set(lerp(-0.05, 1.45, trail) - P.legs * 0.35, 0, 0);
      (k ? B.kneeR : B.kneeL).rotation.set(lerp(0, 0.15, trail) + P.legs * 0.25, 0, 0);
      (k ? B.footR : B.footL).quaternion.identity();
    }
    if (groundW > 0.01) {
      const S = this.scale, v = this.walkSpd;
      this.mesh.updateMatrixWorld(true);
      if (!this.steps.ready) {
        // touching down: plant the feet where the posed legs put them
        for (let k = 0; k < 2; k++) {
          (k ? B.footR : B.footL).getWorldPosition(_w1);
          const g = W.groundAt(_w1.x, _w1.z);
          this.steps.F[k].p.set(_w1.x, (g === null ? p.y : g) + 0.03 * S, _w1.z); this.steps.F[k].swing = false;
        }
        this.steps.ready = true;
      }
      // where the feet belong: under the hips, a little ahead when walking
      const lead = 0.18 * v, fx = Math.sin(this.yaw) * lead, fz = Math.cos(this.yaw) * lead;
      for (let k = 0; k < 2; k++) {
        const h = this.mesh.localToWorld(_fh[k].set(k ? -0.085 : 0.085, 0.03, 0.02));
        h.x += fx; h.z += fz;
        const g = W.groundAt(h.x, h.z);
        h.y = (g === null ? p.y : g) + 0.03 * S;
      }
      this.steps.update(dt, _fh, v > 0.05 || Math.abs(this.turnRate) > 0.1, 0.11 * S, 0.035 * S, clamp(0.34 - 0.06 * v, 0.16, 0.34), 0.12 * S);
      // lower the body while a planted foot is beyond the leg's reach (legs slightly bent, never over-stretched)
      let drop = 0;
      for (let k = 0; k < 2; k++) {
        const f = this.steps.F[k];
        if (f.swing) continue;
        const hp = this.mesh.localToWorld(_w2.set(k ? -0.08 : 0.08, 0.92, -0.02)), L = 0.86 * S;
        const dh = Math.hypot(hp.x - f.p.x, hp.z - f.p.z);
        drop = Math.max(drop, hp.y - f.p.y - Math.sqrt(Math.max(L * L - dh * dh, 0.01)));
      }
      this.legDrop = damp(this.legDrop, Math.max(0, drop), 12, dt);
      this.mesh.position.y -= this.legDrop * groundW;
      this.mesh.updateMatrixWorld(true);
      for (let k = 0; k < 2; k++) {
        const hip = k ? B.hipR : B.hipL, knee = k ? B.kneeR : B.kneeL, foot = k ? B.footR : B.footL;
        _qh.copy(hip.quaternion); _qk.copy(knee.quaternion);
        ik2(hip, knee, foot, _w3.copy(this.steps.F[k].p), this.mesh.localToWorld(_pole.set(k ? -0.12 : 0.12, 0.5, -1.5)));
        if (groundW < 0.999) { _qh2.copy(hip.quaternion); hip.quaternion.copy(_qh).slerp(_qh2, groundW); _qk2.copy(knee.quaternion); knee.quaternion.copy(_qk).slerp(_qk2, groundW); }
        // toes flat on the ground
        knee.updateWorldMatrix(true, false);
        knee.getWorldQuaternion(_qp);
        this.mesh.getWorldQuaternion(_qa);
        foot.quaternion.copy(_qp.invert().multiply(_qa));
        if (groundW < 0.999) foot.quaternion.slerp(_qi.identity(), 1 - groundW);
      }
    } else this.steps.ready = false;
  }
}

/* ------------------------------------------------------------------ */
/* Blue spirit birds (青鸟): instanced, wing flap in the vertex shader  */
/* ------------------------------------------------------------------ */
function birdGeometry() {
  const parts = [];
  const add = (g, part, color) => {
    g.deleteAttribute('uv'); if (!g.index) { g.deleteAttribute('normal'); g = mergeVertices(g); } g.computeVertexNormals();
    const n = g.getAttribute('position').count;
    const pa = new Float32Array(n).fill(part), c = new Float32Array(n * 3);
    const col = new THREE.Color(color);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    g.setAttribute('aPart', new THREE.BufferAttribute(pa, 1)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  };
  add(ell(0.045, 0.045, 0.11, 0, 0, 0, 12), 0, '#1f53c8');
  add(ell(0.04, 0.04, 0.045, 0, 0.025, 0.1, 10), 0, '#3d86e8');
  add(cone(0.012, 0.05, 0, 0.022, 0.14, Math.PI / 2, 0, 0), 0, '#e8c050');
  add(ell(0.012, 0.012, 0.008, 0.024, 0.04, 0.125, 6), 0, '#ffffff');
  add(ell(0.012, 0.012, 0.008, -0.024, 0.04, 0.125, 6), 0, '#ffffff');
  // wings: flat feathered blades
  for (const s of [1, -1]) {
    const pos = [], idx = [];
    const N = 6;
    for (let i = 0; i <= N; i++) { const u = i / N, x = s * (0.03 + u * 0.26), le = 0.05 - u * 0.09, te = -0.06 - u * 0.05 + 0.05 * u * u; pos.push(x, 0.01, le, x, 0.01, te); }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    add(g, s > 0 ? 1 : 2, '#36c6e6');
  }
  // two long tail streamers
  for (const s of [1, -1]) {
    const pos = [], idx = [];
    const N = 8;
    for (let i = 0; i <= N; i++) { const u = i / N, z = -0.08 - u * 0.42, w = 0.01 + 0.012 * Math.sin(u * Math.PI) + (u > 0.82 ? 0.022 : 0); pos.push(s * (0.01 + u * 0.045) - w, -0.005 - u * 0.03, z, s * (0.01 + u * 0.045) + w, -0.005 - u * 0.03, z); }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    add(g, 3, '#2a6fe0');
  }
  return mergeGeometries(parts);
}

function birdMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide, emissive: new THREE.Color('#2fb8ff') });
  return patchStd(m, shared, {
    key: 'bird',
    vertexHeader: 'attribute float aPart; attribute vec4 aAnim; varying float vGlow; varying float vPart;',
    vertex: {
      '#include <begin_vertex>': /* glsl */`$&
        // aAnim: phase, flap amplitude, fold, glow
        float side = aPart < 1.5 ? 1.0 : -1.0;
        if (aPart > 0.5 && aPart < 2.5) {
          float span = abs(transformed.x);
          float fold = aAnim.z;
          // fold: pull the wing in and sweep it back along the body
          float sx = 0.03 + (span - 0.03) * (1.0 - 0.75 * fold);
          float sz = transformed.z - (span - 0.03) * 0.8 * fold;
          // stroke ~±45° at the tip (was ~±70°): thin wing blades sweeping a pixel or more per frame strobe
          float ang = sin(aAnim.x) * aAnim.y * 0.8 * (1.0 - fold) * (1.0 + (span - 0.03) * 1.8);
          transformed.x = side * sx * cos(ang);
          transformed.y = transformed.y + sx * sin(ang);
          transformed.z = sz;
        }
        if (aPart > 2.5) {
          float u = clamp(-(transformed.z + 0.08) / 0.55, 0.0, 1.0);
          transformed.y += sin(aAnim.x * 0.5 - u * 4.0) * 0.04 * u;
          transformed.x += sin(aAnim.x * 0.35 - u * 3.0) * 0.03 * u;
        }
        vGlow = aAnim.w; vPart = aPart;
      `,
    },
    fragmentHeader: 'varying float vGlow; varying float vPart;',
    fragment: {
      // the flapping wings glow a little less than the body: at night bright wing blades sweeping a pixel or
      // more per frame strobe against the dark sky
      '#include <emissivemap_fragment>': '$&\n totalEmissiveRadiance = mix(diffuseColor.rgb, vec3(0.4, 0.9, 1.0), 0.4) * vGlow * (vPart > 0.5 && vPart < 2.5 ? 0.4 : 1.0);',
    },
  });
}

class BirdFlock {
  constructor(sys, member, count, rng, startIndex) {
    this.sys = sys; this.member = member; this.kind = 'bird'; this.rng = rng;
    this.birds = [];
    const a = rng.range(0, TAU);
    this.center = new THREE.Vector3(Math.cos(a) * 12, 8, Math.sin(a) * 12);
    this.target = this.center.clone();
    this.state = 'roam'; this.timer = rng.range(0, 10); this.ph = rng.range(0, TAU);
    for (let i = 0; i < count; i++) {
      const b = {
        i: startIndex + i, leader: i === 0, pos: this.center.clone().add(new THREE.Vector3(rng.range(-2, 2), rng.range(-1, 1), rng.range(-2, 2))),
        vel: new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)), ph: rng.range(0, TAU), fold: 0, perch: null, glow: 0, peckT: rng.range(0, 1), s: i === 0 ? 1.35 * (member ? member.size || 1 : 1) : rng.range(0.85, 1.05),
        // rendered heading / bank / pitch (smoothed), eased wing beat, perch state, hop progress, own circling rate
        hd: 0, om: 0, bank: 0, pitch: 0, flap: 0.8, flapS: 0.8, perchV: new THREE.Vector3(), perched: false, hop: 0, orbitW: 1.9 + 0.13 * ((i * 5) % 7),
      };
      b.hd = Math.atan2(b.vel.x, b.vel.z);
      this.birds.push(b);
    }
    this.food = null; this.radius = 0.8;
  }
  get leader() { return this.birds[0]; }
  wantsFood() { return !this.food; }
  update(dt, t) {
    const sys = this.sys;
    this.timer += dt;
    const hungry = this.member && sys.env.fullness(this.member) < 0.3;
    // pick the flock goal
    if (this.food && (!this.food.alive)) { this.food = null; this.state = 'roam'; }
    if (this.state === 'roam') {
      const tp = sys.world.treeTop;
      const r = hungry ? 4 : 9 + 4 * Math.sin(t * 0.05 + this.ph);
      const base = hungry ? _a.copy(sys.camera.position).lerp(tp, 0.55) : tp;
      this.target.set(base.x + Math.cos(t * 0.23 + this.ph) * r, base.y + 2 + Math.sin(t * 0.31 + this.ph) * 3, base.z + Math.sin(t * 0.19 + this.ph) * r);
      if (!hungry && this.timer > 25 && this.rng.chance(dt * 0.08)) {
        this.state = 'perch'; this.timer = 0;
        // neighbouring twigs, one bird each (two birds sent to one twig sat inside each other)
        const perches = sys.world.perches, np = perches.length, o = this.rng.int(0, np - 1);
        for (let k = 0; k < this.birds.length; k++) {
          const b = this.birds[k];
          b.perch = b.perchV.copy(perches[(o + k) % np]).add(_d.set(this.rng.range(-0.12, 0.12) + (k >= np ? 0.3 : 0), 0.05, this.rng.range(-0.12, 0.12)));
          b.perched = false;
        }
      }
    } else if (this.state === 'perch') {
      if (this.timer > 22 || hungry) { this.state = 'roam'; this.timer = 0; for (const b of this.birds) b.perch = null; }
    } else if (this.state === 'feed') {
      this.target.copy(this.food.pos).add(_a.set(0, 0.6, 0));
    }
    const n = this.birds.length;
    for (let k = 0; k < n; k++) {
      const b = this.birds[k];
      b.glow = Math.max(0, b.glow - dt * 0.4);
      if (b.perch && this.state === 'perch') {
        const d = _a.subVectors(b.perch, b.pos);
        const dist = d.length();
        if (!b.perched) {
          const sp = Math.min(4.5, dist * 1.8 + 0.5);
          b.vel.lerp(d.multiplyScalar(sp / Math.max(dist, 1e-4)), 1 - Math.exp(-4 * dt));
          b.pos.addScaledVector(b.vel, dt);
          b.fold = damp(b.fold, dist < 0.4 ? 1 : 0, 6, dt);
          b.flap = dist < 0.4 ? 0.2 : 0.9;
          if (dist < 0.06) b.perched = true;
        } else {
          b.vel.multiplyScalar(Math.pow(0.8, dt * 60));
          b.fold = damp(b.fold, 1, 6, dt); b.flap = 0;
          // now and then a little hop on the twig (it jumped up 4 cm in one frame)
          if (b.hop === 0 && this.rng.chance(dt * 0.3)) b.hop = 1e-4;
          if (b.hop > 0) { b.hop += dt / 0.3; if (b.hop >= 1) b.hop = 0; }
          b.pos.lerp(b.perch, 1 - Math.exp(-6 * dt));
        }
      } else {
        if (b.perched) {
          // leave the twig forwards and upwards (at rest it had no velocity, so its heading flipped at take-off)
          b.perched = false; b.hop = 0;
          b.vel.set(Math.sin(b.hd) * 1.6, 1.3, Math.cos(b.hd) * 1.6);
        }
        // boids: cohesion toward the target, separation, alignment
        const steer = _b.subVectors(this.target, b.pos);
        const dl = steer.length();
        const feeding = this.state === 'feed' && this.food;
        // feeding: arrive rather than seek -- slow down near the peach and hover round it (seeking at full speed
        // they swung past it, and with direction flips capped they could circle it without ever reaching it)
        if (feeding) steer.multiplyScalar(lerp(1.4, 4.5, smoothstep(1.0, 6, dl)) / Math.max(dl, 1e-3)).sub(b.vel).multiplyScalar(b.leader ? 1.6 : 1.2);
        else steer.multiplyScalar((b.leader ? 1.4 : 0.9) / Math.max(dl, 1e-3) * Math.min(dl, 6));
        if (!b.leader) steer.addScaledVector(_c3.subVectors(this.leader.pos, b.pos), 0.35);
        for (let j = 0; j < n; j++) {
          if (j === k) continue;
          const o = this.birds[j];
          const dx = b.pos.x - o.pos.x, dy = b.pos.y - o.pos.y, dz = b.pos.z - o.pos.z, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 1.0) { const k2 = 1.5 / Math.max(d2, 0.05); steer.x += dx * k2; steer.y += dy * k2; steer.z += dz * k2; }
          steer.addScaledVector(o.vel, 0.04);
        }
        // feeding: hover and peck in turns, each bird circling at its own rate
        let fd = 1e9;
        if (feeding) {
          fd = b.pos.distanceTo(this.food.pos);
          if (fd < 1.6) {
            b.peckT += dt;
            const orbitA = t * b.orbitW + k * (TAU / n);
            steer.add(_d.set(Math.cos(orbitA), 0.4, Math.sin(orbitA)).multiplyScalar(1.4));
            if (b.peckT > (b.leader ? 1.4 : 2.6) && fd < 1.2) {
              b.peckT = 0;
              sys.bite(this.food, b.leader ? this : null, 1, b.pos);
              b.glow = 1.2;
              if (!this.food || !this.food.alive) { this.food = null; this.state = 'roam'; this.timer = 0; }
            }
          }
        }
        // the flock turns mostly level: half the vertical pull, and climbs / dives no steeper than ~26° (it looped
        // in 3D around its target and spent nearly half its time climbing or diving at 30-90°, its body pitch
        // capped at 26°, so it flew tail-first up and down)
        steer.y *= 0.5;
        sys.world.avoid(b.pos, b.vel, steer, 0.6);
        // cap the steering acceleration: separation, cohesion and the feeding swirl added up to pulls that
        // flipped a slow bird's direction within a frame or two (7x as often at 30 fps)
        const acc = steer.length() * 2.2;
        b.vel.addScaledVector(steer, dt * 2.2 * Math.min(1, 14 / Math.max(acc, 1e-6)));
        const sp = b.vel.length(), maxS = feeding ? lerp(1.6, 4.5, smoothstep(1.2, 6, fd)) : 5.5;
        if (sp > maxS) b.vel.multiplyScalar(maxS / sp);
        if (sp < 1.2) b.vel.multiplyScalar(1.2 / Math.max(sp, 1e-3));
        const vyMax = 0.5 * Math.max(Math.hypot(b.vel.x, b.vel.z), 1.2);
        b.vel.y = clamp(b.vel.y, -vyMax, vyMax);
        b.pos.addScaledVector(b.vel, dt);
        b.fold = damp(b.fold, 0, 6, dt);
        b.flap = b.vel.y > 0.3 ? 1.0 : 0.75 + 0.25 * Math.sin(t * 0.7 + k);
      }
      // the body follows the flight direction at a capped rate (it was set straight from the velocity and snapped
      // whenever that swung), banks into turns and pitches with the climb; a perched bird keeps its heading
      const vh = Math.hypot(b.vel.x, b.vel.z);
      if (vh > 0.45 && !b.perched) {
        const e = angleDelta(b.hd, Math.atan2(b.vel.x, b.vel.z));
        const step = clamp(e * (1 - Math.exp(-18 * dt)), -10 * dt, 10 * dt);
        b.hd += step;
        b.om = damp(b.om, step / Math.max(dt, 1e-4), 10, dt);
      } else b.om = damp(b.om, 0, 10, dt);
      b.bank = damp(b.bank, clamp(-Math.atan(vh * b.om / 9.8) * 1.3, -0.8, 0.8) * (1 - b.fold), 8, dt);
      b.pitch = damp(b.pitch, clamp(Math.atan2(b.vel.y, Math.max(vh, 0.6)), -0.45, 0.45) * (1 - b.fold), 8, dt);
      // wing beat: amplitude and rate ease in and out (they switched between 0, 0.2, 0.75 and 1 in one frame)
      b.flapS = damp(b.flapS, b.flap, 8, dt);
      // flap ~1.5-2 Hz (was 2-3 Hz): at 60 fps (30 in power save) faster wings jumped more than their own
      // width between frames and strobed; wrap the phase (sin(ph), sin(ph/2), sin(0.35 ph) all repeat in 40π)
      b.ph += dt * lerp(2, 9.5 + 0.6 * k, smoothstep(0.05, 0.3, b.flapS));
      if (b.ph > BIRD_PHASE_WRAP) b.ph -= BIRD_PHASE_WRAP;
    }
  }
  write(mesh, anim, night) {
    const m = _m4;
    for (const b of this.birds) {
      if (b.hd > Math.PI * 64 || b.hd < -Math.PI * 64) b.hd %= TAU;
      _q2.setFromEuler(_e2.set(-b.pitch, b.hd, b.bank, 'YXZ'));
      const s = b.s * 1.15;
      _p2.copy(b.pos);
      if (b.hop > 0) _p2.y += Math.sin(Math.PI * b.hop) * 0.045;
      m.compose(_p2, _q2, _s2.set(s, s, s));
      mesh.setMatrixAt(b.i, m);
      anim.array[b.i * 4] = b.ph; anim.array[b.i * 4 + 1] = b.flapS * 0.9; anim.array[b.i * 4 + 2] = b.fold; anim.array[b.i * 4 + 3] = (b.leader ? 0.5 : 0.25) * lerp(0.2, 1.6, night) + b.glow;
    }
  }
}
const _m4 = new THREE.Matrix4(), _e2 = new THREE.Euler(), _q2 = new THREE.Quaternion(), _s2 = new THREE.Vector3(), _p2 = new THREE.Vector3();
const BIRD_PHASE_WRAP = 40 * Math.PI;

/* ------------------------------------------------------------------ */
/* Manager                                                             */
/* ------------------------------------------------------------------ */
export function createCreatures(env, shared, world, fx) {
  const rng = env.rng.fork('creatures');
  const group = new THREE.Group();
  const tRig = tortoiseRig(), tGeo = tRig.geometry();
  const cRig = craneRig(), cGeo = cRig.geometry();
  const bGeo = birdGeometry();
  const maxBirds = 80;
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(maxBirds * 4), 4);
  anim.setUsage(THREE.DynamicDrawUsage);
  bGeo.setAttribute('aAnim', anim);
  const birdMesh = new THREE.InstancedMesh(bGeo, birdMaterial(shared), maxBirds);
  birdMesh.name = 'birds';   // names only label the motion probe's output
  group.name = 'creatures';
  birdMesh.count = 0;
  birdMesh.frustumCulled = false;
  // no shadows from the little birds: their thin wing shadows crossing the sunlit terrace and lawn at flight
  // speed shade each pixel for about one frame and flickered (and the depth pass ignores the wing flap anyway)
  birdMesh.castShadow = false;
  group.add(birdMesh);
  const sys = {
    env, shared, world, rng, fx, camera: null, tod: null,
    tortoises: [], cranes: [], flocks: [], ambient: [], foods: [],
    dyn: { n: 0, list: [] },   // residents standing on the ground, as circles walkers steer around
    bite(f, who, n, at) {
      if (!f.alive) return;
      const take = Math.min(n, f.bites);
      f.bites -= take;
      const member = who && who.member ? who.member : null;
      const p = at || f.pos;
      env.onEat(member, p.clone());
      fx.sparkles.burst(f.pos, _col.setRGB(2.6, 1.6, 1.1), 14 + take * 6, 1.8, 0.28, 1.2);
      if (f.bites <= 0) {
        f.alive = false;
        fx.sparkles.burst(f.pos, _col.setRGB(3, 2.2, 1.3), 40, 3, 0.35, 1.6);
      }
    },
  };
  let birdCount = 0;
  function addMember(m) {
    if (m.kind === 'tortoise') {
      const tt = new Tortoise(sys, m, tRig, tGeo, sys.tortoises.length);
      tt.mesh.name = 'tortoise' + sys.tortoises.length;
      sys.tortoises.push(tt); group.add(tt.mesh);
    } else if (m.kind === 'crane') {
      const c = new Crane(sys, m, cRig, cGeo, rng.fork(m.id));
      c.orbit.a = 2.9 + sys.cranes.length * 2.1;
      c.orbit.r = sys.cranes.length % 2 ? c.rng.range(32, 42) : c.rng.range(14, 18); c.orbit.h = c.rng.range(6, 12);
      c.pos.set(Math.cos(c.orbit.a) * c.orbit.r, c.orbit.h, Math.sin(c.orbit.a) * c.orbit.r);
      c.vel.set(-Math.sin(c.orbit.a), 0, Math.cos(c.orbit.a)).multiplyScalar(6 * Math.sign(c.orbit.w));
      c.resetFlight();
      c.mesh.name = 'crane' + sys.cranes.length;
      sys.cranes.push(c); group.add(c.mesh);
      // start some cranes on the ground for a calmer first impression
      if (sys.cranes.length % 3 === 0) {
        const spot = world.landingSpot(c.rng, null);
        if (spot) { c.pos.copy(spot); c.state = 'stand'; c.vel.set(0, 0, 0); c.resetFlight(); c.pose.fly = 0; c.pose.fold = 1; c.pose.air = 0; c.timer = 0; c.restTime = c.rng.range(15, 40); }
      }
    } else if (m.kind === 'bird') {
      const n = Math.min(7, maxBirds - birdCount);
      if (n <= 0) return;
      const f = new BirdFlock(sys, m, n, rng.fork(m.id), birdCount);
      birdCount += n; birdMesh.count = birdCount;
      sys.flocks.push(f);
    }
  }
  for (const m of env.members) addMember(m);
  // ambient: a distant pair of cranes and a wild flock
  for (let i = 0; i < 2; i++) { const c = new Crane(sys, null, cRig, cGeo, rng.fork('amb' + i), true); c.orbit.a += i * 0.08; c.orbit.r = 180 + i * 6; c.orbit.h = 30 + i * 3; c.orbit.w = 0.03; c.mesh.name = 'craneFar' + i; sys.ambient.push(c); group.add(c.mesh); }
  if (birdCount + 6 <= maxBirds) { const f = new BirdFlock(sys, null, 6, rng.fork('ambflock'), birdCount); birdCount += 6; birdMesh.count = birdCount; f.ph += 2; sys.flocks.push(f); }

  const _nv = new THREE.Vector3();
  function addDyn(o, r) {
    const D = sys.dyn, e = D.list[D.n] || (D.list[D.n] = { x: 0, z: 0, r: 0, ref: null });
    e.x = o.pos.x; e.z = o.pos.z; e.r = r; e.ref = o; D.n++;
  }
  function separate(a, ra, b, rb, k) {
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz), R = ra + rb;
    if (d >= R || d < 1e-4) return;
    const push = (R - d) * 0.5 * k / d;
    a.pos.x -= dx * push; a.pos.z -= dz * push; b.pos.x += dx * push; b.pos.z += dz * push;
  }
  /** A new peach exists: send the nearest interested creatures. */
  function notice(f) {
    const cand = [];
    for (const tt of sys.tortoises) if (tt.wantsFood(f)) cand.push({ c: tt, d: tt.pos.distanceTo(f.pos) * 0.7 });
    for (const c of sys.cranes) if (c.wantsFood(f)) cand.push({ c, d: c.pos.distanceTo(f.pos) });
    for (const fl of sys.flocks) if (fl.wantsFood(f)) cand.push({ c: fl, d: fl.leader.pos.distanceTo(f.pos) * (fl.member ? 1 : 1.5) });
    cand.sort((a, b) => a.d - b.d);
    let sent = 0;
    for (const { c } of cand) {
      if (sent >= 3) break;
      if (c.kind === 'tortoise') { if (f.claimT) continue; c.food = f; c.state = 'toFood'; f.claimT = c; sent++; }
      else if (c.kind === 'crane') {
        const flying = c.state === 'fly' || c.state === 'approach';
        const ground = f.state === 'float' ? null : f.ground ?? world.groundAt(f.pos.x, f.pos.z);
        if (ground === null) {
          // a hovering peach: only a crane on the wing goes for it (a standing one used to take off without a run),
          // and not one tucked among the boughs or under a roof that it could only circle
          if (!flying || world.blocked(f.pos.x, f.pos.y, f.pos.z, 0.9)) continue;
          c.food = f; c.state = 'snatch'; c.timer = 0; c.extend = false;
        } else if (flying) {
          // line up and land just short of the peach, on an approach clear of the tree and the buildings
          if (!c.planLanding(_nv.set(f.pos.x, ground, f.pos.z), 0.9 * c.scale)) continue;
          c.food = f;
        } else if (c.pos.distanceTo(f.pos) > 7) continue;
        else c.food = f;
        sent++;
      } else { c.food = f; c.state = 'feed'; c.timer = 0; for (const b of c.birds) b.perch = null; sent++; }
    }
  }
  return {
    group, sys, addMember, notice,
    update(dt, t, camera, tod) {
      sys.camera = camera; sys.tod = tod;
      // residents on the ground keep a little personal space (at a peach they stood inside each other)
      const k = 1 - Math.exp(-8 * dt), T = sys.tortoises, C = sys.cranes;
      for (let i = 0; i < T.length; i++) {
        for (let j = i + 1; j < T.length; j++) separate(T[i], 0.3 * T[i].scale, T[j], 0.3 * T[j].scale, k);
        for (const c of C) if (GROUND[c.state] === 1) separate(T[i], 0.3 * T[i].scale, c, 0.27 * c.scale, k);
      }
      for (let i = 0; i < C.length; i++) if (GROUND[C[i].state] === 1) for (let j = i + 1; j < C.length; j++) if (GROUND[C[j].state] === 1) separate(C[i], 0.27 * C[i].scale, C[j], 0.27 * C[j].scale, k);
      sys.dyn.n = 0;
      for (const tt of T) addDyn(tt, 0.3 * tt.scale);
      for (const c of C) if (GROUND[c.state] === 1) addDyn(c, 0.27 * c.scale);
      for (const tt of sys.tortoises) tt.update(dt, t);
      for (const c of sys.cranes) c.update(dt, t);
      for (const c of sys.ambient) c.update(dt, t);
      // the flocks' steering forces are stiff: step them at 60 Hz or finer so they fly the same at 30 fps
      const nSub = Math.max(1, Math.ceil(dt * 60 - 0.01)), sdt = dt / nSub;
      for (const f of sys.flocks) { for (let i = 1; i <= nSub; i++) f.update(sdt, t - dt + i * sdt); f.write(birdMesh, anim, tod.night); }
      birdMesh.instanceMatrix.needsUpdate = true;
      anim.needsUpdate = true;
      // unclaimed food gets noticed again a little later
      for (const f of sys.foods) {
        if (!f.alive) continue;
        f.noticeT = (f.noticeT || 0) + dt;
        if (f.noticeT > 6) { f.noticeT = 0; const busy = sys.cranes.some(c => c.food === f) || sys.flocks.some(fl => fl.food === f) || sys.tortoises.some(tt => tt.food === f); if (!busy) notice(f); }
      }
    },
    dispose() {
      for (const c of [...sys.tortoises, ...sys.cranes, ...sys.ambient]) c.mesh.skeleton && c.mesh.skeleton.dispose();
    },
    list() {
      const out = [];
      for (const tt of sys.tortoises) out.push({ member: tt.member, pos: tt.position, radius: 1.0 * tt.scale });
      for (const c of sys.cranes) out.push({ member: c.member, pos: c.position, radius: 0.9 * c.scale });
      for (const f of sys.flocks) if (f.member) out.push({ member: f.member, pos: f.leader.pos, radius: 0.7 });
      return out;
    },
  };
}
