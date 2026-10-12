// 云海 · sky dome (gradient, sun, crepuscular rays, cirrus, stars, moon), aurora ribbons and the
// image-based lighting environment rendered from the same sky.
import * as THREE from 'three';
import { SHARED_GLSL, NOISE_GLSL } from './common.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main(){
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */`
${SHARED_GLSL}
${NOISE_GLSL}
uniform sampler2D tCirrus, tNoise;
uniform float uCirrusAmt;
uniform vec3 uFloorCol;
varying vec3 vDir;

vec3 hazeBase(vec3 dir){
  vec2 a = dir.xz; float la = length(a); a = la > 1e-4 ? a / la : vec2(1.0, 0.0);
  vec2 s = uSunDir.xz; float ls = length(s); s = ls > 1e-4 ? s / ls : vec2(1.0, 0.0);
  float az = dot(a, s) * 0.5 + 0.5;
  return mix(uHazeA, uHazeB, az * az * az);
}

void main(){
  vec3 d = normalize(vDir);
  float y = d.y;
  float h = max(y, 0.0);
  float mu = dot(d, uSunDir);
  float mup = max(mu, 0.0);
  vec3 base = hazeBase(d);

  // vertical gradient: haze band -> lavender mid sky -> zenith
  vec3 col = mix(base, uMidSky, smoothstep(0.0, 0.34, pow(h, 0.72)));
  col = mix(col, uZenith, smoothstep(0.16, 0.8, h));

  // Belt of Venus (pink band) above the earth shadow on the anti-solar side at twilight
  vec2 a = normalize(d.xz + 1e-5), s = normalize(uSunDir.xz + 1e-5);
  float anti = pow(clamp(-dot(a, s) * 0.5 + 0.5, 0.0, 1.0), 2.0);
  // (squares written out: pow() of a negative base is undefined and returns NaN on several mobile GPUs)
  float yb = (y - 0.085) / 0.055, ys = y / 0.03;
  float belt = exp(-yb * yb) * anti * uGolden;
  col += vec3(0.95, 0.52, 0.66) * belt * 0.22 * (1.0 - uNight);
  col = mix(col, col * vec3(0.78, 0.8, 1.0), exp(-ys * ys) * anti * uGolden * 0.5);

  // sun glow: wide warm halo + tight corona, brighter toward the horizon
  float horizonBoost = 1.0 + 1.5 * exp(-h * 9.0);
  vec3 glow = uGlow * (pow(mup, 4.0) * 0.22 + pow(mup, 24.0) * 0.55 + pow(mup, 200.0) * 1.2) * horizonBoost;
  // crepuscular rays fanning from the sun
  vec3 sT = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
  vec3 sB = cross(sT, uSunDir);
  vec3 rel = d - uSunDir * mu;
  float ang = atan(dot(rel, sB), dot(rel, sT) + 1e-7);   // atan(0, 0) is undefined at the sun's centre
  float r1 = texture2D(tNoise, vec2(ang / 6.2831853 * 2.0, uTime * 0.0021)).r;
  float r2 = texture2D(tNoise, vec2(ang / 6.2831853 * 4.0, 0.37 - uTime * 0.0013)).g;
  float rays = smoothstep(0.4, 0.75, r1 * 0.7 + r2 * 0.4);
  float rayMask = pow(mup, 5.0) * (1.0 - pow(mup, 60.0)) * smoothstep(-0.02, 0.1, y);
  glow *= 0.92 + 0.2 * rays * rayMask;
  col += glow + uGlow * rays * rayMask * (0.04 + 0.12 * uGolden);

  // sun disc (stylised, larger than life) with a soft limb
  float cosR = 0.99955;
  float disc = smoothstep(cosR - 0.00018, cosR + 0.00006, mu);
  vec3 discCol = mix(vec3(1.0, 0.6, 0.3), vec3(1.0, 0.95, 0.86), smoothstep(0.0, 0.25, uSunDir.y)) * 22.0;
  col += discCol * disc * uSunUp * (1.0 - 0.96 * uEnvPass) * smoothstep(-0.012, 0.004, y);
  col += uGlow * pow(mup, 1800.0) * 6.0 * (1.0 - 0.9 * uEnvPass);

  // cirrus: fibrous high veils, lit pink-gold from below at dusk, silver in the moonlight
  if (y > 0.0) {
    vec2 cp = d.xz / (y + 0.07) * 0.16 + vec2(uTime * 0.0012, uTime * 0.0005);
    vec4 c1 = texture2D(tCirrus, cp);
    vec4 c2 = texture2D(tCirrus, cp * 0.31 + vec2(0.3, 0.7));
    float cov = smoothstep(0.38, 0.72, c2.b);
    float fib = smoothstep(0.48, 0.86, c1.r) * 0.85 + smoothstep(0.52, 0.9, c1.g) * 0.45;
    float dens = clamp(fib * cov, 0.0, 1.0) * smoothstep(0.0, 0.22, y) * uCirrusAmt;
    vec3 lit = uLightCol * 0.55 + uAmbient * 0.9 + uGlow * (0.35 + 2.2 * pow(mup, 5.0)) + uHazeB * 0.25 * uGolden;
    col = mix(col, lit, dens * 0.6);
  }

  // night: stars, milky way, moon
  float night = uNight * (1.0 - uEnvPass);
  if (night > 0.001 && y > -0.02) {
    vec3 sp = d * 120.0;
    vec3 cell = floor(sp), f = fract(sp);
    vec3 rnd = hash33(cell);
    float stars = 0.0;
    if (rnd.x > 0.86) {
      vec3 c = 0.25 + 0.5 * hash33(cell + 7.13);
      float dist = length(f - c);
      float sz = 0.05 + 0.1 * rnd.y * rnd.y;
      float tw = 0.65 + 0.35 * sin(uTime * (1.3 + rnd.z * 3.0) + rnd.y * 40.0);
      stars = smoothstep(sz, 0.0, dist) * tw * (0.35 + 2.5 * pow(rnd.z, 6.0));
    }
    vec3 mwN = normalize(vec3(0.42, 0.62, -0.66));
    float b = dot(d, mwN);
    float band = exp(-b * b / 0.022);
    vec4 nz = texture2D(tNoise, vec2(atan(d.z, d.x) / 6.2831853 * 3.0, b * 1.4 + 0.5));
    float mw = band * smoothstep(0.35, 0.8, nz.r * 0.6 + nz.g * 0.5);
    vec3 mwCol = mix(vec3(0.36, 0.3, 0.75), vec3(0.85, 0.55, 0.8), nz.b) * mw * 0.09;
    float horizonFade = smoothstep(-0.02, 0.18, y);
    col += (vec3(0.85, 0.9, 1.0) * stars * (1.0 + band * 1.5) + mwCol) * night * horizonFade;

    float md = dot(d, uMoonDir);
    float cosM = 0.99975;
    vec3 mT = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
    vec3 mB = cross(mT, uMoonDir);
    vec2 mp = vec2(dot(d, mT), dot(d, mB)) / 0.02236;
    float r2m = dot(mp, mp);
    float mdisc = smoothstep(cosM - 0.00006, cosM + 0.00003, md);
    vec4 mn = texture2D(tNoise, mp * 0.22 + 0.5);
    vec3 mN = vec3(mp, sqrt(max(1.0 - r2m, 0.0)));
    float phase = smoothstep(-0.25, 0.3, dot(mN, normalize(vec3(-0.75, 0.25, 0.6))));
    vec3 moonCol = vec3(1.0, 0.97, 0.92) * (0.72 + 0.45 * (mn.r - 0.5) + 0.25 * (mn.b - 0.5)) * (0.25 + 0.75 * phase) * 5.0;
    col = mix(col, moonCol, mdisc * night);
    float mh = max(md, 0.0);
    col += vec3(0.62, 0.72, 1.0) * (pow(mh, 3000.0) * 1.2 + pow(mh, 250.0) * 0.25 + pow(mh, 20.0) * 0.05) * night;
  }

  // below the horizon: the endless cloud sea dissolving into haze
  vec3 below = base + uGlow * (pow(mup, 4.0) * 0.22 + pow(mup, 24.0) * 0.55 + pow(mup, 200.0) * 1.2);
  if (uEnvPass > 0.5) below = mix(uFloorCol, below, exp(y * 6.0));
  col = mix(col, below, smoothstep(0.004, -0.03, y));
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky(shared, tex) {
  const uniforms = Object.assign({}, shared, {
    tCirrus: { value: tex.cirrus },
    tNoise: { value: tex.noise },
    uCirrusAmt: { value: 1 },
    uFloorCol: { value: new THREE.Color() },
  });
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 32), material);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return { mesh, material, uniforms };
}

/* ------------------------------------------------------------------ */
/* Aurora                                                              */
/* ------------------------------------------------------------------ */
const AURORA_VERT = /* glsl */`
uniform float uTime;
attribute vec4 aRib;     // x: t along ribbon 0..1, y: v 0..1, z: seed, w: ribbon index
uniform vec4 uRib[4];    // per ribbon: yaw, distance, length, height
varying vec2 vUv;
varying float vSeed;
void main(){
  vec4 R = uRib[int(aRib.w)];
  float t = aRib.x, v = aRib.y, sd = aRib.z;
  float x = (t - 0.5) * R.z;
  float z = sin(t * 4.2 + uTime * 0.045 + sd) * R.z * 0.09 + sin(t * 11.0 - uTime * 0.07 + sd * 2.0) * R.z * 0.025;
  float yb = R.w * 0.55 + sin(t * 6.0 + uTime * 0.06 + sd) * R.w * 0.08;
  float y = yb + v * R.w * (0.75 + 0.25 * sin(t * 9.0 + uTime * 0.11 + sd));
  float c = cos(R.x), s = sin(R.x);
  vec3 p = vec3(x * c - (z - R.y) * s, y, x * s + (z - R.y) * c);
  vUv = vec2(t, v); vSeed = sd;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w * 0.99999;
}`;
const AURORA_FRAG = /* glsl */`
uniform float uTime, uAurora;
uniform sampler2D tNoise;
varying vec2 vUv;
varying float vSeed;
void main(){
  float t = vUv.x, v = vUv.y;
  float s1 = texture2D(tNoise, vec2(t * 9.0 + vSeed + uTime * 0.004, 0.31)).r;
  float s2 = texture2D(tNoise, vec2(t * 23.0 - uTime * 0.006, 0.73 + vSeed)).g;
  float s3 = texture2D(tNoise, vec2(t * 3.0 + uTime * 0.002, 0.5 + vSeed * 0.3)).b;
  float rays = pow(clamp(s1 * 0.6 + s2 * 0.55 - 0.32, 0.0, 1.0) * 1.7, 1.6);
  float prof = smoothstep(0.0, 0.06, v) * pow(1.0 - v, 1.6);
  float ends = smoothstep(0.0, 0.18, t) * smoothstep(1.0, 0.82, t);
  float curtain = smoothstep(0.25, 0.75, s3);
  vec3 low = vec3(0.25, 1.0, 0.72), mid = vec3(0.3, 0.75, 1.0), top = vec3(0.78, 0.42, 1.0);
  vec3 col = mix(low, mid, smoothstep(0.05, 0.35, v));
  col = mix(col, top, smoothstep(0.35, 0.9, v));
  float a = rays * prof * ends * (0.35 + 0.65 * curtain) * uAurora;
  gl_FragColor = vec4(col * a * 1.6, 1.0);
}`;

export function createAurora(shared, tex, rng) {
  const ribbons = 3, seg = 120;
  const pos = [], rib = [], idx = [];
  let base = 0;
  for (let r = 0; r < ribbons; r++) {
    const seed = rng.range(0, 6);
    for (let i = 0; i <= seg; i++) for (let j = 0; j < 2; j++) { pos.push(0, 0, 0); rib.push(i / seg, j, seed, r); }
    for (let i = 0; i < seg; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    base += (seg + 1) * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aRib', new THREE.Float32BufferAttribute(rib, 4));
  geo.setIndex(idx);
  const yaw0 = rng.range(0, Math.PI * 2);
  const uRib = [];
  for (let r = 0; r < 4; r++) uRib.push(new THREE.Vector4(yaw0 + r * 0.9 + rng.range(-0.2, 0.2), 1500 + r * 350, 2600 + rng.range(-300, 600), 380 + rng.range(-60, 120)));
  const uniforms = { uTime: shared.uTime, uAurora: { value: 0 }, tNoise: { value: tex.noise }, uRib: { value: uRib } };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: AURORA_VERT, fragmentShader: AURORA_FRAG,
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide, transparent: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -9;
  return { mesh, uniforms };
}

/* ------------------------------------------------------------------ */
/* Image based lighting from the sky                                   */
/* ------------------------------------------------------------------ */
// Sky values the environment map is built from: rebuild when any of them has moved by more than ~2.5%
// (or the sun by ~1°), so image-based light follows the sky in small steps instead of a 3-minute jump.
const ENV_COLORS = ['uZenith', 'uMidSky', 'uHazeA', 'uHazeB', 'uGlow', 'uLightCol', 'uAmbient', 'uBounce'];
export function createEnvironment(env, shared, skyMaterial) {
  const envScene = new THREE.Scene();
  const m = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial);
  envScene.add(m);
  let rt = null, lastT = -99;
  const sig = new Float32Array(ENV_COLORS.length * 3 + 5), last = new Float32Array(sig.length).fill(-1);
  function change() {
    let k = 0;
    for (const n of ENV_COLORS) { const c = shared[n].value; sig[k++] = c.r; sig[k++] = c.g; sig[k++] = c.b; }
    const nc = k;
    const sd = shared.uSunDir.value; sig[k++] = sd.x; sig[k++] = sd.y; sig[k++] = sd.z;
    sig[k++] = shared.uGolden.value; sig[k++] = shared.uSunUp.value;
    let d = 0;
    for (let i = 0; i < nc; i++) d = Math.max(d, Math.abs(sig[i] - last[i]) / (Math.abs(last[i]) + 0.03));
    for (let i = nc; i < nc + 3; i++) d = Math.max(d, Math.abs(sig[i] - last[i]) * 1.4);
    for (let i = nc + 3; i < sig.length; i++) d = Math.max(d, Math.abs(sig[i] - last[i]));
    return d;
  }
  return {
    get texture() { return rt ? rt.texture : null; },
    update(elapsed, force) {
      if (!force && elapsed - lastT < 0.5) return false;
      if (change() < 0.025 && !force) return false;
      last.set(sig); lastT = elapsed;
      shared.uEnvPass.value = 1;
      const old = rt;
      rt = env.pmrem.fromScene(envScene, 0.02, 0.1, 100);
      shared.uEnvPass.value = 0;
      if (old) old.dispose();   // swapped in the same frame: there is never a frame without an env map
      return true;
    },
    dispose() { if (rt) rt.dispose(); m.geometry.dispose(); },
  };
}
