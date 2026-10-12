// 云海 · effects: peaches (on the tree and as food), drifting blossom petals, golden motes and
// fireflies, sky lanterns rising at dusk, and sparkle bursts. Particles animate on the GPU.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, smoothstep } from '../../lib/util.js';
import { patchStd, SHARED_GLSL, CLOUD_TOP } from './common.js';

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _c = new THREE.Color();

/* ------------------------------------------------------------------ */
/* Peach geometry: the longevity peach (寿桃) with a pointed tip       */
/* ------------------------------------------------------------------ */
export function peachGeometry({ tipUp = true } = {}) {
  let g = new THREE.SphereGeometry(1, 24, 18);
  g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3);
  const cream = new THREE.Color('#f2dca0'), peach = new THREE.Color('#f59a6e'), blush = new THREE.Color('#de3358');
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const up = Math.max(0, y);
    // pull the top into a soft point, crease along one meridian
    const k = 1 - 0.28 * up * up;
    const ang = Math.atan2(z, x);
    const crease = 1 - 0.07 * Math.exp(-Math.pow(Math.abs(Math.cos(ang * 0.5)), 2) * 40) * (1 - Math.abs(y));
    x *= k * crease; z *= k * crease;
    y = y * 1.02 + 0.42 * Math.pow(up, 3.2);
    p.setXYZ(i, x, y, z);
    const t = (y + 1) / 2.4;
    _c.copy(cream).lerp(peach, smoothstep(0.0, 0.45, t)).lerp(blush, smoothstep(0.38, 0.9, t) * (0.8 + 0.2 * Math.cos(ang)));
    col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  // two leaves at the base (stem end)
  const leaf = new THREE.SphereGeometry(1, 10, 6);
  leaf.deleteAttribute('uv');
  leaf.scale(0.32, 0.05, 0.85);
  const lc = new Float32Array(leaf.getAttribute('position').count * 3);
  for (let i = 0; i < lc.length; i += 3) { lc[i] = 0.24; lc[i + 1] = 0.48; lc[i + 2] = 0.18; }
  leaf.setAttribute('color', new THREE.BufferAttribute(lc, 3));
  const l1 = leaf.clone().translate(0, 0, 0.75).rotateX(0.35).rotateY(0.6).translate(0, -0.92, 0);
  const l2 = leaf.clone().translate(0, 0, 0.75).rotateX(0.35).rotateY(0.6 + Math.PI * 0.85).translate(0, -0.92, 0);
  g = mergeGeometries([g, l1, l2]);
  if (!tipUp) g.rotateX(Math.PI);
  return g;
}

function peachMaterial(shared, glowU) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, emissive: new THREE.Color('#ff9c6a') });
  return patchStd(m, shared, {
    key: 'peach',
    uniforms: { uPeachGlow: glowU },
    fragmentHeader: 'uniform float uPeachGlow;',
    fragment: {
      '#include <emissivemap_fragment>': /* glsl */`$&
        totalEmissiveRadiance = vColor.rgb * uPeachGlow * (0.6 + 0.4 * vColor.r);
      `,
      '#include <lights_fragment_end>': /* glsl */`$&
        { vec3 Vw = normalize(cameraPosition - vWPos);
          vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float fuzz = pow(1.0 - clamp(dot(Nw, Vw), 0.0, 1.0), 2.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * (uLightCol * 0.25 + uAmbient * 0.6) * fuzz; }
      `,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Sparkles: a ring buffer of GPU particles                            */
/* ------------------------------------------------------------------ */
const SPARK_VERT = /* glsl */`
uniform float uTime, uPix;
attribute vec4 aStart;   // xyz, birth time
attribute vec4 aVel;     // xyz velocity, life
attribute vec4 aCol;     // rgb, size
attribute float aKind;   // 0 star, 1 soft disc
varying vec3 vCol; varying float vA; varying float vKind;
void main(){
  float age = uTime - aStart.w;
  float life = aVel.w;
  float t = clamp(age / life, 0.0, 1.0);
  float drag = (1.0 - exp(-age * 1.6)) / 1.6;
  vec3 p = aStart.xyz + aVel.xyz * drag + vec3(0.0, 0.25, 0.0) * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float alive = step(0.0, age) * step(age, life);
  vA = alive * smoothstep(0.0, 0.08, t) * (1.0 - t) * (1.0 - t);
  vCol = aCol.rgb; vKind = aKind;
  gl_PointSize = max(aCol.w * uPix / max(-mv.z, 0.1) * (0.6 + 0.4 * (1.0 - t)), 2.0) * alive;
}`;
const SPARK_FRAG = /* glsl */`
varying vec3 vCol; varying float vA; varying float vKind;
void main(){
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r = length(d);
  float core = exp(-r * r * 9.0);
  float star = (exp(-abs(d.x) * 14.0) * exp(-abs(d.y) * 2.5) + exp(-abs(d.y) * 14.0) * exp(-abs(d.x) * 2.5)) * 0.8;
  float a = mix(core + star * (1.0 - smoothstep(0.6, 1.0, r)), smoothstep(1.0, 0.0, r), vKind) * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol * a, 0.0);
}`;
export function createSparkles(max = 800) {
  const geo = new THREE.BufferGeometry();
  const aStart = new THREE.BufferAttribute(new Float32Array(max * 4).fill(-1e5), 4);
  const aVel = new THREE.BufferAttribute(new Float32Array(max * 4), 4);
  const aCol = new THREE.BufferAttribute(new Float32Array(max * 4), 4);
  const aKind = new THREE.BufferAttribute(new Float32Array(max), 1);
  for (let i = 0; i < max; i++) aVel.array[i * 4 + 3] = 1;
  for (const a of [aStart, aVel, aCol, aKind]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
  geo.setAttribute('aStart', aStart); geo.setAttribute('aVel', aVel); geo.setAttribute('aCol', aCol); geo.setAttribute('aKind', aKind);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const uniforms = { uTime: { value: 0 }, uPix: { value: 600 } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: SPARK_VERT, fragmentShader: SPARK_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 6;
  let head = 0, lo = max, hi = -1;
  const mark = i => { lo = Math.min(lo, i); hi = Math.max(hi, i); };
  function emit(x, y, z, vx, vy, vz, life, r, g, b, size, kind = 0) {
    const i = head; head = (head + 1) % max;
    const S = aStart.array, Vl = aVel.array, C = aCol.array, o = i * 4;
    S[o] = x; S[o + 1] = y; S[o + 2] = z; S[o + 3] = uniforms.uTime.value;
    Vl[o] = vx; Vl[o + 1] = vy; Vl[o + 2] = vz; Vl[o + 3] = life;
    C[o] = r; C[o + 1] = g; C[o + 2] = b; C[o + 3] = size;
    aKind.array[i] = kind;
    mark(i);
  }
  return {
    points, uniforms, emit,
    burst(pos, color, n = 40, speed = 2.5, size = 0.35, life = 1.4) {
      for (let k = 0; k < n; k++) {
        const u = Math.random() * 2 - 1, a = Math.random() * TAU, rr = Math.sqrt(1 - u * u), sp = speed * (0.4 + Math.random() * 0.8);
        emit(pos.x, pos.y, pos.z, Math.cos(a) * rr * sp, u * sp + speed * 0.3, Math.sin(a) * rr * sp, life * (0.6 + Math.random() * 0.6), color.r, color.g, color.b, size * (0.6 + Math.random() * 0.8), Math.random() < 0.3 ? 1 : 0);
      }
    },
    update(t, pixelScale) {
      uniforms.uTime.value = t;
      uniforms.uPix.value = pixelScale;
      if (hi >= lo) {
        for (const a of [aStart, aVel, aCol]) { a.clearUpdateRanges(); a.addUpdateRange(lo * 4, (hi - lo + 1) * 4); a.needsUpdate = true; }
        aKind.clearUpdateRanges(); aKind.addUpdateRange(lo, hi - lo + 1); aKind.needsUpdate = true;
        lo = max; hi = -1;
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Petals drifting from the tree, motes and fireflies (GPU loops)      */
/* ------------------------------------------------------------------ */
const PETAL_VERT = /* glsl */`
uniform float uTime, uPix;
uniform vec3 uWind;
attribute vec4 aSpawn;   // xyz spawn, phase 0..1
attribute vec4 aParam;   // life, fall speed, size, spin
varying float vA; varying float vRot; varying float vShade;
void main(){
  float life = aParam.x;
  float age = mod(uTime + aSpawn.w * life, life);
  float sw = sin(age * 1.7 + aSpawn.w * 40.0);
  vec3 p = aSpawn.xyz + uWind * age + vec3(sw * 0.5, -aParam.y * age, cos(age * 1.3 + aSpawn.w * 17.0) * 0.4);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  vA = smoothstep(0.0, 0.08, age / life) * (1.0 - smoothstep(0.75, 1.0, age / life));
  vRot = age * aParam.w + aSpawn.w * 6.28;
  vShade = 0.75 + 0.25 * sw;
  gl_PointSize = max(aParam.z * uPix / max(-mv.z, 0.1), 2.2);
}`;
const PETAL_FRAG = /* glsl */`
uniform vec3 uLightCol, uAmbient;
uniform vec3 uTint;
varying float vA; varying float vRot; varying float vShade;
void main(){
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float c = cos(vRot), s = sin(vRot);
  d = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  d.x *= 1.0 + 0.6 * abs(sin(vRot * 0.7));  // tumbling foreshortening
  float petal = smoothstep(1.0, 0.75, length(vec2(d.x * 1.5, d.y + 0.15 * d.x * d.x)));
  float notch = smoothstep(0.0, 0.18, length(d - vec2(0.0, 0.85)));
  float a = petal * notch * vA;
  if (a < 0.02) discard;
  vec3 col = uTint * (uLightCol * 0.55 * vShade + uAmbient * 1.1 + 0.05);
  gl_FragColor = vec4(col * a, a);
}`;
export function createPetals(shared, spawnPts, count, wind) {
  const geo = new THREE.BufferGeometry();
  const spawn = new Float32Array(count * 4), param = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const s = spawnPts[i % spawnPts.length];
    spawn.set([s.x + (Math.random() - 0.5) * 1.6, s.y + (Math.random() - 0.5) * 1.0, s.z + (Math.random() - 0.5) * 1.6, Math.random()], i * 4);
    param.set([12 + Math.random() * 10, 0.35 + Math.random() * 0.35, 0.09 + Math.random() * 0.07, (Math.random() - 0.5) * 5], i * 4);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSpawn', new THREE.BufferAttribute(spawn, 4));
  geo.setAttribute('aParam', new THREE.BufferAttribute(param, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const uniforms = { uTime: shared.uTime, uPix: { value: 600 }, uWind: { value: new THREE.Vector3(wind.x, 0, wind.y).multiplyScalar(0.7) }, uLightCol: shared.uLightCol, uAmbient: shared.uAmbient, uTint: { value: new THREE.Color('#ffc4d4') } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: PETAL_VERT, fragmentShader: PETAL_FRAG, transparent: true, depthWrite: false, premultipliedAlpha: true });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return { points: pts, uniforms };
}

const MOTE_VERT = /* glsl */`
uniform float uTime, uPix, uNight;
attribute vec4 aHome;   // xyz, phase
attribute vec4 aMove;   // radius, speed, size, kind (0 dust, 1 firefly)
varying float vA; varying float vKind;
void main(){
  float ph = aHome.w * 6.2831;
  float t = uTime * aMove.y;
  vec3 p = aHome.xyz + vec3(sin(t + ph) * aMove.x, sin(t * 0.7 + ph * 2.0) * aMove.x * 0.5, cos(t * 0.9 + ph) * aMove.x);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float blink = aMove.w > 0.5 ? smoothstep(0.2, 0.9, sin(uTime * (0.8 + aHome.w) + ph * 3.0)) : 0.6 + 0.4 * sin(uTime * 2.0 + ph);
  vA = blink * (aMove.w > 0.5 ? uNight : 0.35 + 0.4 * (1.0 - uNight));
  vKind = aMove.w;
  gl_PointSize = max(aMove.z * uPix / max(-mv.z, 0.1), 1.5);
}`;
const MOTE_FRAG = /* glsl */`
uniform vec3 uDust, uFly;
varying float vA; varying float vKind;
void main(){
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  float a = (exp(-r2 * 7.0) + exp(-r2 * 40.0)) * 0.6 * vA;
  if (a < 0.004) discard;
  gl_FragColor = vec4(mix(uDust, uFly, vKind) * a, 0.0);
}`;
export function createMotes(shared, centers, count) {
  const geo = new THREE.BufferGeometry();
  const home = new Float32Array(count * 4), move = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const c = centers[i % centers.length];
    const fly = i % 3 === 0 ? 1 : 0;
    const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * c.r;
    home.set([c.x + Math.cos(a) * r, c.y + Math.random() * c.h, c.z + Math.sin(a) * r, Math.random()], i * 4);
    move.set([0.6 + Math.random() * 1.6, 0.15 + Math.random() * 0.3, fly ? 0.16 : 0.07 + Math.random() * 0.05, fly], i * 4);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aHome', new THREE.BufferAttribute(home, 4));
  geo.setAttribute('aMove', new THREE.BufferAttribute(move, 4));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const uniforms = { uTime: shared.uTime, uPix: { value: 600 }, uNight: shared.uNight, uDust: { value: new THREE.Color(1.6, 1.3, 0.8) }, uFly: { value: new THREE.Color(2.4, 1.9, 0.9) } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return { points: pts, uniforms };
}

/* ------------------------------------------------------------------ */
/* Sky lanterns (孔明灯) rising out of the clouds at dusk and night    */
/* ------------------------------------------------------------------ */
const SKYL_VERT = /* glsl */`
uniform float uTime;
attribute vec4 aL;   // x, z start, phase, speed
varying float vA; varying vec2 vUv; varying float vFl;
void main(){
  float life = 260.0;
  float age = mod(uTime * aL.w + aL.z * life, life);
  float y = ${CLOUD_TOP.toFixed(1)} - 8.0 + age * 0.75;
  vec3 c = vec3(aL.x + sin(age * 0.05 + aL.z * 9.0) * 6.0 + age * 0.12, y, aL.y + cos(age * 0.04 + aL.z * 5.0) * 6.0);
  vec3 p = position * (1.0 + 0.0 * aL.z);
  vec4 mv = modelViewMatrix * vec4(c + p, 1.0);
  gl_Position = projectionMatrix * mv;
  vA = smoothstep(0.0, 0.08, age / life) * (1.0 - smoothstep(0.7, 1.0, age / life));
  vUv = uv; vFl = sin(uTime * 9.0 + aL.z * 50.0) * 0.08 + sin(uTime * 3.7 + aL.z * 20.0) * 0.06;
}`;
const SKYL_FRAG = /* glsl */`
uniform float uShow;
varying float vA; varying vec2 vUv; varying float vFl;
void main(){
  float glow = 0.55 + 0.45 * smoothstep(1.0, 0.0, vUv.y) + vFl;
  vec3 col = vec3(1.0, 0.55, 0.2) * glow * 4.0 + vec3(1.0, 0.85, 0.5) * smoothstep(0.35, 0.0, vUv.y) * 4.0;
  float a = vA * uShow;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * a, a);
}`;
export function createSkyLanterns(count, rng) {
  // a paper lantern: open-bottom truncated box, built from a cylinder with 4 sides
  const g = new THREE.CylinderGeometry(0.42, 0.3, 0.9, 4, 1, true);
  g.rotateY(Math.PI / 4);
  const ig = new THREE.InstancedBufferGeometry();
  ig.index = g.index; ig.setAttribute('position', g.getAttribute('position')); ig.setAttribute('uv', g.getAttribute('uv'));
  const aL = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, TAU), d = rng.range(60, 420);
    aL.set([Math.cos(a) * d, Math.sin(a) * d, rng.next(), rng.range(0.7, 1.3)], i * 4);
  }
  ig.setAttribute('aL', new THREE.InstancedBufferAttribute(aL, 4));
  ig.instanceCount = count;
  const uniforms = { uTime: { value: 0 }, uShow: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: SKYL_VERT, fragmentShader: SKYL_FRAG, transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(ig, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return { mesh, uniforms };
}

/* ------------------------------------------------------------------ */
/* Peaches: fruit on the tree (static) and food (dynamic pool)         */
/* ------------------------------------------------------------------ */
export function createPeaches(shared, treeSpots, maxFood = 12) {
  const glowU = { value: 0.1 }, foodGlowU = { value: 0.5 };
  const mat = peachMaterial(shared, glowU);
  const foodMat = peachMaterial(shared, foodGlowU);
  const hanging = peachGeometry({ tipUp: false });
  const tree = new THREE.InstancedMesh(hanging, mat, Math.max(1, treeSpots.length));
  tree.count = treeSpots.length;
  const treeState = treeSpots.map((p, i) => ({ p, ph: i * 1.3, s: 0.13 + (i % 3) * 0.015 }));
  tree.castShadow = true;
  const food = new THREE.InstancedMesh(peachGeometry({ tipUp: true }), foodMat, maxFood);
  food.count = 0;
  food.castShadow = true;
  food.frustumCulled = false;
  tree.frustumCulled = false;
  function update(t, night, foods) {
    glowU.value = lerp(0.02, 0.9, night);
    foodGlowU.value = lerp(0.45, 1.6, night) * (0.9 + 0.1 * Math.sin(t * 3.1));
    for (let i = 0; i < treeState.length; i++) {
      const st = treeState[i];
      _q.setFromEuler(_e.set(Math.sin(t * 0.8 + st.ph) * 0.08, 0, Math.cos(t * 0.6 + st.ph) * 0.08));
      _m.compose(_p.copy(st.p), _q, _s.set(st.s, st.s, st.s));
      tree.setMatrixAt(i, _m);
    }
    tree.instanceMatrix.needsUpdate = true;
    let n = 0;
    for (const f of foods) {
      if (!f.alive || n >= maxFood) continue;
      const s = f.scale * (0.35 + 0.65 * f.bites / f.maxBites) * (f.held ? 0.9 : 1);
      _q.setFromEuler(_e.set(f.tilt, f.spin, 0));
      _m.compose(f.pos, _q, _s.set(s, s, s));
      food.setMatrixAt(n++, _m);
    }
    food.count = n;
    food.instanceMatrix.needsUpdate = true;
  }
  return { tree, food, update, treeState, glowU };
}

/* ------------------------------------------------------------------ */
/* Halos: a soft pulsing glow with a four-point flare around each peach */
/* ------------------------------------------------------------------ */
const HALO_VERT = /* glsl */`
uniform float uPix;
attribute vec4 aHalo;   // size, pulse phase, intensity, unused
varying float vI; varying float vPh;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  vI = aHalo.z; vPh = aHalo.y;
  gl_PointSize = clamp(aHalo.x * uPix / max(-mv.z, 0.1), 6.0, 260.0);
}`;
const HALO_FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uCol;
varying float vI; varying float vPh;
void main(){
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r = length(d);
  float pulse = 0.85 + 0.15 * sin(uTime * 2.6 + vPh);
  float c = cos(uTime * 0.3 + vPh), s = sin(uTime * 0.3 + vPh);
  vec2 e = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
  float flare = exp(-abs(e.x) * 30.0) * exp(-abs(e.y) * 3.2) + exp(-abs(e.y) * 30.0) * exp(-abs(e.x) * 3.2);
  float a = (exp(-r * r * 7.0) * 0.55 + exp(-r * r * 40.0) * 0.5 + flare * 0.5) * (1.0 - smoothstep(0.75, 1.0, r)) * vI * pulse;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uCol * a, 0.0);
}`;
export function createHalos(max = 16) {
  const geo = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(max * 3), 3), hal = new THREE.BufferAttribute(new Float32Array(max * 4), 4);
  pos.setUsage(THREE.DynamicDrawUsage); hal.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', pos); geo.setAttribute('aHalo', hal);
  geo.setDrawRange(0, 0);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const uniforms = { uTime: { value: 0 }, uPix: { value: 600 }, uCol: { value: new THREE.Color(2.2, 1.35, 0.8) } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: HALO_VERT, fragmentShader: HALO_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.renderOrder = 7;
  return {
    points, uniforms,
    update(t, pix, foods, night) {
      uniforms.uTime.value = t; uniforms.uPix.value = pix;
      let n = 0;
      for (const f of foods) {
        if (!f.alive || n >= max) continue;
        pos.array[n * 3] = f.pos.x; pos.array[n * 3 + 1] = f.pos.y + f.scale * 0.2; pos.array[n * 3 + 2] = f.pos.z;
        hal.array[n * 4] = 2.4 * (0.5 + 0.5 * f.bites / f.maxBites); hal.array[n * 4 + 1] = f.ph; hal.array[n * 4 + 2] = lerp(0.55, 1.1, night) * Math.min(1, f.age * 2); hal.array[n * 4 + 3] = 0;
        n++;
      }
      geo.setDrawRange(0, n);
      pos.needsUpdate = true; hal.needsUpdate = true;
    },
  };
}
