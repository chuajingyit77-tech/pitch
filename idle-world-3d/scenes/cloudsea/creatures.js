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
  const la = mid.position.length(), lb = end.position.length();
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
    this.walkPh = 0; this.food = null; this.timer = 0; this.glow = 0; this.eatHand = 1;
    this.headLook = new THREE.Vector3();
    this.handT = [V(), V()]; this.footT = [V(), V()];
    this.radius = 1.0;
    this.tmpPos = V();
  }
  get headPos() { return this.B.head.getWorldPosition(this.tmpPos); }
  wantsFood(f) { return this.state === 'taichi' && f.onMain && f.state !== 'float' && this.pos.distanceTo(f.pos) < 13; }
  update(dt, t) {
    const sys = this.sys, B = this.B, R = this.rest;
    if (this.member) { const s = 1.42 * (this.member.size || 1); if (s !== this.scale) { this.scale = s; this.mesh.scale.setScalar(s); } }
    this.glow = Math.max(0, this.glow - dt * 0.12);
    this.uniforms.uGlowAmt.value = this.glow * 0.8;
    this.uniforms.uShellGlow.value = lerp(0.03, 0.5, sys.tod.night) + this.glow * 0.6;
    // hunger: practise closer to the viewer
    const hungry = this.member && sys.env.fullness(this.member) < 0.3;
    let speed = 0, bend = 0, crouch = 0;
    let taiW = 0;
    if (this.state === 'taichi') {
      taiW = 1;
      const goal = hungry ? sys.world.hungrySpot(this.home, sys.camera) : this.home;
      const dx = goal.p.x - this.pos.x, dz = goal.p.z - this.pos.z;
      if (Math.hypot(dx, dz) > 0.6) { this.state = 'walk'; this.walkGoal = goal.p.clone(); this.afterWalk = 'taichi'; this.faceYaw = goal.yaw; }
      else this.yaw = dampAngle(this.yaw, hungry ? Math.atan2(sys.camera.position.x - this.pos.x, sys.camera.position.z - this.pos.z) : goal.yaw, 0.6, dt);
    }
    if (this.state === 'walk' || this.state === 'toFood') {
      const g = this.state === 'toFood' ? this.food.pos : this.walkGoal;
      const dx = g.x - this.pos.x, dz = g.z - this.pos.z, d = Math.hypot(dx, dz);
      const stop = this.state === 'toFood' ? 0.55 * this.scale : 0.15;
      const want = Math.atan2(dx, dz);
      this.yaw = dampAngle(this.yaw, want, 2.2, dt);
      const facing = Math.cos(angleDelta(this.yaw, want));
      speed = d > stop ? 0.42 * this.scale * smoothstep(0.2, 0.9, facing) * smoothstep(0, 0.5, d - stop + 0.2) : 0;
      this.pos.x += Math.sin(this.yaw) * speed * dt; this.pos.z += Math.cos(this.yaw) * speed * dt;
      const gy = sys.world.mainGround(this.pos.x, this.pos.z);
      if (gy !== null) this.pos.y = damp(this.pos.y, gy, 8, dt);
      if (this.state === 'toFood' && (!this.food.alive || this.food.state === 'float')) { this.state = 'walk'; this.walkGoal = this.home.p.clone(); this.food = null; }
      else if (d <= stop + 0.02) {
        if (this.state === 'toFood') { this.state = 'reach'; this.timer = 0; this.eatHand = this.food.pos.clone().sub(this.pos).dot(_a.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw))) > 0 ? 0 : 1; }
        else { this.state = this.afterWalk || 'taichi'; }
      }
    }
    if (this.state === 'reach' || this.state === 'lift' || this.state === 'munch') {
      this.timer += dt;
      const f = this.food;
      if (this.state === 'reach') {
        crouch = smoothstep(0, 1.2, this.timer);
        if (this.timer > 1.4) { this.state = 'lift'; this.timer = 0; if (f && f.alive) { f.held = this; f.state = 'held'; } }
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
          this.food = null; this.state = 'walk'; this.walkGoal = this.home.p.clone(); this.afterWalk = 'taichi'; this.timer = 0;
        }
      }
    }

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
    const walkW = smoothstep(0.02, 0.2, speed);
    const stanceW = taiW * (1 - walkW);
    // hips
    const sway = Math.sin(ph) * 0.07 * cloud * stanceW;
    const sink = (0.06 + 0.04 * (0.5 - 0.5 * Math.cos(2 * ph)) * cloud + 0.08 * (0.5 - 0.5 * Math.cos(ph)) * open) * stanceW + crouch * 0.3 + walkW * 0.02;
    this.walkPh += speed / (0.22 * this.scale) * dt;
    const wp = this.walkPh;
    B.root.position.set(R.root.x + sway + Math.sin(wp) * 0.04 * walkW, R.root.y - sink + Math.abs(Math.sin(wp)) * 0.025 * walkW, R.root.z);
    B.root.rotation.set(0.05 * stanceW + bend + crouch * 0.25, Math.sin(ph) * 0.22 * cloud * stanceW + Math.sin(wp) * 0.08 * walkW, Math.sin(wp) * 0.06 * walkW);
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
    // walking arm swing
    hL.z += Math.sin(wp) * 0.12 * walkW; hR.z -= Math.sin(wp) * 0.12 * walkW;
    // reaching for / lifting / eating the peach
    if (this.state === 'reach' || this.state === 'lift' || this.state === 'munch') {
      const h = this.eatHand === 0 ? hL : hR;
      const s = this.eatHand === 0 ? 1 : -1;
      if (this.state === 'reach') {
        const k = smoothstep(0.1, 1.2, this.timer);
        const fp = this.mesh.worldToLocal(_c3.copy(this.food.pos));
        h.set(lerp(h.x, fp.x, k), lerp(h.y, fp.y + 0.08, k), lerp(h.z, fp.z, k));
      } else {
        const k = this.state === 'lift' ? smoothstep(0, 1, this.timer) : 1;
        const bob = this.state === 'munch' ? Math.max(0, Math.sin(this.timer * 5.5)) * 0.04 : 0;
        h.set(lerp(s * 0.3, s * 0.06, k), lerp(0.6, 1.5 - bob, k), lerp(0.45, 0.42, k));
      }
    }
    // IK arms (poles: elbows down and out)
    const tw = this.mesh.localToWorld(_t.copy(hL));
    const pole = this.mesh.localToWorld(_pole.set(1.2, 0.6, -0.3));
    ik2(B.shoulderL, B.elbowL, B.handL, tw, pole);
    const tw2 = this.mesh.localToWorld(_t.copy(hR));
    const pole2 = this.mesh.localToWorld(_pole.set(-1.2, 0.6, -0.3));
    ik2(B.shoulderR, B.elbowR, B.handR, tw2, pole2);
    B.handL.rotation.set(0.3 + 0.4 * cloud * Math.sin(ph), 0, 0.2);
    B.handR.rotation.set(0.3 + 0.4 * cloud * Math.sin(ph + Math.PI), 0, -0.2);
    // held peach follows the hand
    if (this.food && this.food.held === this) {
      const hb = this.eatHand === 0 ? B.handL : B.handR;
      hb.updateWorldMatrix(true, false);
      hb.getWorldPosition(this.food.pos);
      this.food.pos.y -= 0.05 * this.scale; this.food.pos.add(_a.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(0.08 * this.scale));
    }
    // feet: planted (tai chi stance wider), stepping when walking
    const stance = 0.27;
    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? 1 : -1;
      const ft = this.footT[k];
      const swing = Math.sin(wp + (k ? Math.PI : 0));
      ft.set(s * lerp(0.23, stance, stanceW), 0.08 + Math.max(0, swing) * 0.1 * walkW, 0.07 + Math.cos(wp + (k ? Math.PI : 0)) * 0.13 * walkW);
      const fw = this.mesh.localToWorld(_t.copy(ft));
      const fpole = this.mesh.localToWorld(_pole.set(s * 0.3, 0.4, 1.4));
      ik2(k ? B.hipR : B.hipL, k ? B.kneeR : B.kneeL, k ? B.footR : B.footL, fw, fpole);
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
    this.lookYaw = damp(this.lookYaw || 0, lookYaw, 2, dt); this.lookPitch = damp(this.lookPitch || 0, lookPitch, 2, dt);
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
    this.glow = 0; this.food = null; this.ground = 0; this.pose = { fly: 1, fold: 0, legs: 0, flare: 0, peck: 0 };
    this.walkPh = 0; this.radius = 1.2;
    this.tmpPos = V(); this.carrot = V(); this.path = null;
    this.restTime = rng.range(25, 60);
  }
  get position() { return this.B.root.getWorldPosition(this.tmpPos); }
  wantsFood(f) { return !this.ambient && !this.food && (this.state === 'fly' || this.state === 'stand' || this.state === 'walk'); }
  /** Bezier glide/landing path */
  startPath(to, kind, arriveDir) {
    const p0 = this.pos.clone();
    const v = this.vel.clone(); if (v.lengthSq() < 0.01) v.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    v.normalize();
    const dist = p0.distanceTo(to);
    const ad = arriveDir || to.clone().sub(p0).setY(0).normalize();
    const p1 = p0.clone().addScaledVector(v, Math.min(dist * 0.45, 14));
    const p2 = to.clone().addScaledVector(ad, -Math.min(dist * 0.4, 9)).add(new THREE.Vector3(0, kind === 'land' ? 3 : 0, 0));
    this.path = { p0, p1, p2, p3: to.clone(), t: 0, len: dist * 1.25 + 4, kind };
  }
  pathPoint(t, out) {
    const P = this.path, u = 1 - t;
    return out.set(0, 0, 0).addScaledVector(P.p0, u * u * u).addScaledVector(P.p1, 3 * u * u * t).addScaledVector(P.p2, 3 * u * t * t).addScaledVector(P.p3, t * t * t);
  }
  update(dt, t) {
    const sys = this.sys, B = this.B;
    if (this.member) { const s = 1.25 * (this.member.size || 1); if (s !== this.scale) { this.scale = s; this.mesh.scale.setScalar(s); } }
    this.glow = Math.max(0, this.glow - dt * 0.15);
    this.uniforms.uGlowAmt.value = this.glow * 0.6;
    this.timer += dt;
    const P = this.pose;
    let flapAmp = 0, flapRate = 0, speed = this.vel.length();
    const hungry = this.member && sys.env.fullness(this.member) < 0.3;
    if (this.state === 'fly') {
      // follow an orbit with a wandering carrot; avoid islets; occasionally decide to land
      const o = this.orbit;
      o.a += o.w * dt;
      const cx = hungry ? sys.camera.position.x * 0.6 : 0, cz = hungry ? sys.camera.position.z * 0.6 : 0;
      const ra = o.r * (1 + 0.18 * Math.sin(t * 0.07 + o.ph)) * (hungry ? 0.6 : 1);
      this.carrot.set(cx + Math.cos(o.a + 0.35 * Math.sign(o.w)) * ra, o.h + Math.sin(t * 0.11 + o.ph) * 4 + Math.cos(o.a * 2) * o.tilt * 8, cz + Math.sin(o.a + 0.35 * Math.sign(o.w)) * ra);
      const want = _a.subVectors(this.carrot, this.pos).normalize();
      sys.world.avoid(this.pos, this.vel, want, 1.5);
      want.normalize();
      const sp = this.ambient ? 9 : 6.5;
      const cur = _b.copy(this.vel).normalize();
      cur.lerp(want, 1 - Math.exp(-0.9 * dt)).normalize();
      this.vel.copy(cur).multiplyScalar(damp(speed, sp, 1, dt));
      this.pos.addScaledVector(this.vel, dt);
      if (!this.ambient && this.timer > this.restTime && !this.food) {
        const spot = sys.world.landingSpot(this.rng, hungry ? sys.camera : null);
        if (spot) { this.landSpot = spot; this.startPath(spot, 'land'); this.state = 'glide'; this.timer = 0; }
      }
      // flapping bouts between long glides
      if (t > this.nextFlap) { this.flapUntil = t + this.rng.range(2.2, 3.6); this.nextFlap = this.flapUntil + this.rng.range(3, 7); }
      const flapping = t < this.flapUntil || this.vel.y > 0.8;
      flapAmp = flapping ? 0.95 : 0.06; flapRate = flapping ? 1.25 : 0.25;
      P.fly = damp(P.fly, 1, 3, dt); P.fold = damp(P.fold, 0, 4, dt); P.legs = damp(P.legs, 0, 3, dt); P.flare = damp(P.flare, 0, 3, dt);
    } else if (this.state === 'glide') {
      // scripted approach & landing along a Bezier
      const Pth = this.path;
      const remaining = (1 - Pth.t) * Pth.len;
      const sp = lerp(1.6, 6.5, smoothstep(0, 14, remaining));
      Pth.t = Math.min(1, Pth.t + (sp * dt) / Pth.len);
      const prev = _c3.copy(this.pos);
      this.pathPoint(Pth.t, this.pos);
      this.vel.subVectors(this.pos, prev).multiplyScalar(1 / Math.max(dt, 1e-4));
      const near = 1 - smoothstep(0, 10, remaining);
      flapAmp = lerp(0.2, 0.9, smoothstep(0.5, 1, near)); flapRate = lerp(0.3, 1.8, near);
      P.fly = damp(P.fly, 1, 3, dt); P.legs = damp(P.legs, near, 3, dt); P.flare = damp(P.flare, near, 3, dt); P.fold = damp(P.fold, 0, 4, dt);
      if (Pth.t >= 1) { this.state = 'stand'; this.timer = 0; this.vel.set(0, 0, 0); this.ground = this.pos.y; this.restTime = this.rng.range(18, 40); }
    } else if (this.state === 'stand' || this.state === 'walk' || this.state === 'peck') {
      flapAmp = 0; P.fly = damp(P.fly, 0, 3, dt); P.fold = damp(P.fold, 1, 2.5, dt); P.legs = damp(P.legs, 0, 3, dt); P.flare = damp(P.flare, 0, 3, dt);
      const f = this.food;
      if (f && f.alive && f.state !== 'float') {
        const dx = f.pos.x - this.pos.x, dz = f.pos.z - this.pos.z, d = Math.hypot(dx, dz);
        const want = Math.atan2(dx, dz);
        this.yaw = dampAngle(this.yaw, want, 2.5, dt);
        const reach = 0.62 * this.scale;
        if (d > reach) { this.state = 'walk'; const sp = 0.7 * this.scale; this.pos.x += Math.sin(this.yaw) * sp * dt; this.pos.z += Math.cos(this.yaw) * sp * dt; this.walkPh += dt * 5; }
        else {
          this.state = 'peck';
          P.peck = damp(P.peck, 1, 5, dt);
          if (this.timer > 1.1) { this.timer = 0; sys.bite(f, this, 1); this.glow = Math.min(1.5, this.glow + 0.5); }
        }
        const gy = sys.world.groundAt(this.pos.x, this.pos.z); if (gy !== null) this.pos.y = damp(this.pos.y, gy, 6, dt);
      } else {
        if (f) this.food = null;
        P.peck = damp(P.peck, 0, 3, dt);
        // idle: occasional stroll and ground pecking, then fly off
        if (this.state === 'walk' && !this.stroll) this.state = 'stand';
        if (this.state === 'stand' && this.rng.chance(dt * 0.12)) this.stroll = { t: this.rng.range(1.5, 3.5), yaw: this.yaw + this.rng.range(-1.2, 1.2) };
        if (this.stroll) {
          this.stroll.t -= dt; this.yaw = dampAngle(this.yaw, this.stroll.yaw, 2, dt);
          const nx = this.pos.x + Math.sin(this.yaw) * 0.55 * dt, nz = this.pos.z + Math.cos(this.yaw) * 0.55 * dt;
          const gy = sys.world.groundAt(nx, nz);
          if (gy !== null && Math.abs(gy - this.pos.y) < 0.6) { this.pos.x = nx; this.pos.z = nz; this.pos.y = damp(this.pos.y, gy, 6, dt); this.walkPh += dt * 4; this.state = 'walk'; }
          else this.stroll.t = 0;
          if (this.stroll.t <= 0) { this.stroll = null; this.state = 'stand'; }
        }
        if (this.timer > this.restTime && !hungry || this.timer > this.restTime * 2.5) {
          // take off along the facing direction
          const dir = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          const to = this.pos.clone().addScaledVector(dir, 16); to.y += 7;
          this.vel.copy(dir).multiplyScalar(0.5);
          this.startPath(to, 'takeoff', dir);
          this.state = 'takeoff'; this.timer = 0; this.stroll = null;
        }
      }
    } else if (this.state === 'takeoff') {
      const Pth = this.path;
      const sp = lerp(1.0, 6.5, smoothstep(0, 1, Pth.t));
      Pth.t = Math.min(1, Pth.t + (sp * dt) / Pth.len);
      const prev = _c3.copy(this.pos);
      this.pathPoint(Pth.t, this.pos);
      this.vel.subVectors(this.pos, prev).multiplyScalar(1 / Math.max(dt, 1e-4));
      flapAmp = 1.0; flapRate = 1.7;
      P.fly = damp(P.fly, 1, 4, dt); P.fold = damp(P.fold, 0, 6, dt); P.legs = damp(P.legs, 0, 1.5, dt); P.flare = damp(P.flare, 0.3, 3, dt);
      if (Pth.t >= 1) { this.state = 'fly'; this.timer = 0; this.restTime = this.rng.range(30, 70); this.orbit.a = Math.atan2(this.pos.z, this.pos.x); }
    } else if (this.state === 'snatch') {
      // fly straight through a floating peach
      const f = this.food;
      if (!f || !f.alive) { this.state = 'fly'; this.food = null; }
      else {
        const want = _a.subVectors(f.pos, this.pos);
        const d = want.length(); want.normalize();
        const cur = _b.copy(this.vel).normalize();
        cur.lerp(want, 1 - Math.exp(-2.2 * dt)).normalize();
        this.vel.copy(cur).multiplyScalar(damp(speed, 8, 1, dt));
        this.pos.addScaledVector(this.vel, dt);
        flapAmp = 0.8; flapRate = 1.4;
        const hd = this.B.head.getWorldPosition(_d).distanceTo(f.pos);
        if (hd < 0.8 * this.scale || d < 0.6 * this.scale) { sys.bite(f, this, 2); this.glow = Math.min(1.5, this.glow + 0.6); if (!f.alive) { this.food = null; this.state = 'fly'; } else this.timer = 0; }
        if (this.timer > 12) { this.food = null; this.state = 'fly'; }
      }
      P.fly = damp(P.fly, 1, 3, dt); P.fold = damp(P.fold, 0, 4, dt); P.legs = damp(P.legs, 0, 3, dt);
    }

    /* ---- orientation ---- */
    const vh = Math.hypot(this.vel.x, this.vel.z);
    if (this.state === 'fly' || this.state === 'glide' || this.state === 'takeoff' || this.state === 'snatch') {
      if (vh > 0.3) {
        const ny = Math.atan2(this.vel.x, this.vel.z);
        const yawRate = angleDelta(this.yaw, ny) / Math.max(dt, 1e-3);
        this.yaw = dampAngle(this.yaw, ny, 6, dt);
        this.bank = damp(this.bank, clamp(-yawRate * 0.45, -0.7, 0.7), 3, dt);
      }
      this.pitch = damp(this.pitch, clamp(Math.atan2(this.vel.y, Math.max(vh, 0.5)), -0.5, 0.5) - P.flare * 0.5, 3, dt);
    } else { this.bank = damp(this.bank, 0, 4, dt); this.pitch = damp(this.pitch, 0, 4, dt); }
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(-this.pitch, this.yaw, this.bank, 'YXZ');

    /* ---- skeleton pose ---- */
    this.flapPh += dt * TAU * flapRate;
    const fa = damp(this.flapA || 0, flapAmp, 4, dt); this.flapA = fa;
    const fl = Math.sin(this.flapPh) * fa, fl2 = Math.sin(this.flapPh - 0.9) * fa;
    const fly = P.fly, fold = P.fold;
    // wings: spread + flap when flying, folded along the body when standing
    for (const s of [1, -1]) {
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
    // legs: trailing behind in flight, swinging down to land, walking on the ground
    const walking = this.state === 'walk' ? 1 : 0;
    this.walkW = damp(this.walkW || 0, walking, 5, dt);
    for (const s of [1, -1]) {
      const hip = s > 0 ? B.hipL : B.hipR, knee = s > 0 ? B.kneeL : B.kneeR;
      const ph = this.walkPh + (s > 0 ? 0 : Math.PI);
      const step = Math.sin(ph) * 0.35 * this.walkW;
      const trail = fly * (1 - P.legs);
      hip.rotation.set(lerp(step - 0.05, 1.45, trail) - P.legs * 0.35, 0, 0);
      knee.rotation.set(lerp(Math.max(0, -Math.cos(ph)) * -0.6 * this.walkW, 0.15, trail) + P.legs * 0.25, 0, 0);
    }
    this.mesh.position.y += Math.abs(Math.sin(this.walkPh)) * 0.02 * this.walkW;
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
      this.birds.push({
        i: startIndex + i, leader: i === 0, pos: this.center.clone().add(new THREE.Vector3(rng.range(-2, 2), rng.range(-1, 1), rng.range(-2, 2))),
        vel: new THREE.Vector3(rng.range(-1, 1), 0, rng.range(-1, 1)), ph: rng.range(0, TAU), fold: 0, perch: null, glow: 0, peckT: rng.range(0, 1), s: i === 0 ? 1.35 * (member ? member.size || 1 : 1) : rng.range(0.85, 1.05),
        bank: 0,
      });
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
        const perches = sys.world.perches;
        for (const b of this.birds) b.perch = perches[this.rng.int(0, perches.length - 1)].clone().add(new THREE.Vector3(this.rng.range(-0.15, 0.15), 0.05, this.rng.range(-0.15, 0.15)));
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
        if (dist > 0.05) {
          const sp = Math.min(4.5, dist * 1.8 + 0.5);
          b.vel.lerp(d.normalize().multiplyScalar(sp), 1 - Math.exp(-4 * dt));
          b.pos.addScaledVector(b.vel, dt);
          b.fold = damp(b.fold, dist < 0.4 ? 1 : 0, 6, dt);
          b.flap = dist < 0.4 ? 0.2 : 0.9;
        } else {
          b.vel.multiplyScalar(0.8); b.fold = damp(b.fold, 1, 6, dt); b.flap = 0;
          if (this.rng.chance(dt * 0.3)) b.pos.y += 0.04; // hop
          b.pos.lerp(b.perch, 1 - Math.exp(-6 * dt));
        }
      } else {
        // boids: cohesion toward the target, separation, alignment
        const steer = _b.subVectors(this.target, b.pos);
        const dl = steer.length();
        steer.multiplyScalar((b.leader ? 1.4 : 0.9) / Math.max(dl, 1e-3) * Math.min(dl, 6));
        if (!b.leader) steer.addScaledVector(_c3.subVectors(this.leader.pos, b.pos), 0.35);
        for (let j = 0; j < n; j++) {
          if (j === k) continue;
          const o = this.birds[j];
          const dx = b.pos.x - o.pos.x, dy = b.pos.y - o.pos.y, dz = b.pos.z - o.pos.z, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < 1.0) { const k2 = 1.5 / Math.max(d2, 0.05); steer.x += dx * k2; steer.y += dy * k2; steer.z += dz * k2; }
          steer.addScaledVector(o.vel, 0.04);
        }
        // feeding: hover and peck in turns
        if (this.state === 'feed' && this.food) {
          const fd = b.pos.distanceTo(this.food.pos);
          if (fd < 1.6) {
            b.peckT += dt;
            const orbitA = t * 2.2 + k * (TAU / n);
            steer.add(_d.set(Math.cos(orbitA), 0.4, Math.sin(orbitA)).multiplyScalar(1.4));
            if (b.peckT > (b.leader ? 1.4 : 2.6) && fd < 1.2) {
              b.peckT = 0;
              sys.bite(this.food, b.leader ? this : null, 1, b.pos);
              b.glow = 1.2;
              if (!this.food || !this.food.alive) { this.food = null; this.state = 'roam'; this.timer = 0; break; }
            }
          }
        }
        sys.world.avoid(b.pos, b.vel, steer, 0.6);
        b.vel.addScaledVector(steer, dt * 2.2);
        const sp = b.vel.length(), maxS = this.state === 'feed' ? 4.5 : 5.5;
        if (sp > maxS) b.vel.multiplyScalar(maxS / sp);
        if (sp < 1.2) b.vel.multiplyScalar(1.2 / Math.max(sp, 1e-3));
        b.pos.addScaledVector(b.vel, dt);
        b.fold = damp(b.fold, 0, 6, dt);
        b.flap = b.vel.y > 0.3 ? 1.0 : 0.75 + 0.25 * Math.sin(t * 0.7 + k);
      }
      // flap ~1.5-2 Hz (was 2-3 Hz): at 60 fps (30 in power save) faster wings jumped more than their own
      // width between frames and strobed; wrap the phase (sin(ph), sin(ph/2), sin(0.35 ph) all repeat in 40π)
      b.ph += dt * (b.flap > 0.05 ? 9.5 + 0.6 * k : 2);
      if (b.ph > BIRD_PHASE_WRAP) b.ph -= BIRD_PHASE_WRAP;
    }
  }
  write(mesh, anim, night) {
    const m = _m4;
    for (const b of this.birds) {
      const vh = Math.hypot(b.vel.x, b.vel.z);
      const yaw = Math.atan2(b.vel.x, b.vel.z);
      const pitch = clamp(Math.atan2(b.vel.y, Math.max(vh, 0.6)), -0.45, 0.45) * (1 - b.fold);
      b.bank = damp(b.bank, 0, 3, 0.016);
      _e2.set(-pitch, b.perch && b.fold > 0.8 ? b.perchYaw ?? (b.perchYaw = yaw) : yaw, 0, 'YXZ');
      if (!(b.perch && b.fold > 0.8)) b.perchYaw = undefined;
      _q2.setFromEuler(_e2);
      const s = b.s * 1.15;
      m.compose(b.pos, _q2, _s2.set(s, s, s));
      mesh.setMatrixAt(b.i, m);
      anim.array[b.i * 4] = b.ph; anim.array[b.i * 4 + 1] = (b.flap || 0) * 0.9; anim.array[b.i * 4 + 2] = b.fold; anim.array[b.i * 4 + 3] = (b.leader ? 0.5 : 0.25) * lerp(0.2, 1.6, night) + b.glow;
    }
  }
}
const _m4 = new THREE.Matrix4(), _e2 = new THREE.Euler(), _q2 = new THREE.Quaternion(), _s2 = new THREE.Vector3();
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
  birdMesh.count = 0;
  birdMesh.frustumCulled = false;
  // no shadows from the little birds: their thin wing shadows crossing the sunlit terrace and lawn at flight
  // speed shade each pixel for about one frame and flickered (and the depth pass ignores the wing flap anyway)
  birdMesh.castShadow = false;
  group.add(birdMesh);
  const sys = {
    env, shared, world, rng, fx, camera: null, tod: null,
    tortoises: [], cranes: [], flocks: [], ambient: [], foods: [],
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
      sys.tortoises.push(tt); group.add(tt.mesh);
    } else if (m.kind === 'crane') {
      const c = new Crane(sys, m, cRig, cGeo, rng.fork(m.id));
      c.orbit.a = 2.9 + sys.cranes.length * 2.1;
      c.orbit.r = sys.cranes.length % 2 ? c.rng.range(32, 42) : c.rng.range(14, 18); c.orbit.h = c.rng.range(6, 12);
      c.pos.set(Math.cos(c.orbit.a) * c.orbit.r, c.orbit.h, Math.sin(c.orbit.a) * c.orbit.r);
      c.vel.set(-Math.sin(c.orbit.a), 0, Math.cos(c.orbit.a)).multiplyScalar(6 * Math.sign(c.orbit.w));
      sys.cranes.push(c); group.add(c.mesh);
      // start some cranes on the ground for a calmer first impression
      if (sys.cranes.length % 3 === 0) {
        const spot = world.landingSpot(c.rng, null);
        if (spot) { c.pos.copy(spot); c.state = 'stand'; c.vel.set(0, 0, 0); c.pose.fly = 0; c.pose.fold = 1; c.timer = 0; c.restTime = c.rng.range(15, 40); }
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
  for (let i = 0; i < 2; i++) { const c = new Crane(sys, null, cRig, cGeo, rng.fork('amb' + i), true); c.orbit.a += i * 0.08; c.orbit.r = 180 + i * 6; c.orbit.h = 30 + i * 3; c.orbit.w = 0.03; sys.ambient.push(c); group.add(c.mesh); }
  if (birdCount + 6 <= maxBirds) { const f = new BirdFlock(sys, null, 6, rng.fork('ambflock'), birdCount); birdCount += 6; birdMesh.count = birdCount; f.ph += 2; sys.flocks.push(f); }

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
        c.food = f;
        if (f.state === 'float') { c.state = 'snatch'; c.timer = 0; }
        else if (c.state === 'fly') {
          const ground = world.groundAt(f.pos.x, f.pos.z);
          if (ground === null) { c.state = 'snatch'; c.timer = 0; }
          else { const dir = f.pos.clone().sub(c.pos).setY(0).normalize(); const spot = f.pos.clone().addScaledVector(dir, -0.9 * c.scale); spot.y = world.groundAt(spot.x, spot.z) ?? f.pos.y; c.startPath(spot, 'land', dir); c.state = 'glide'; c.timer = 0; }
        } else if (c.pos.distanceTo(f.pos) > 7) { c.food = null; continue; }
        sent++;
      } else { c.food = f; c.state = 'feed'; c.timer = 0; for (const b of c.birds) b.perch = null; sent++; }
    }
  }
  return {
    group, sys, addMember, notice,
    update(dt, t, camera, tod) {
      sys.camera = camera; sys.tod = tod;
      for (const tt of sys.tortoises) tt.update(dt, t);
      for (const c of sys.cranes) c.update(dt, t);
      for (const c of sys.ambient) c.update(dt, t);
      for (const f of sys.flocks) { f.update(dt, t); f.write(birdMesh, anim, tod.night); }
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
