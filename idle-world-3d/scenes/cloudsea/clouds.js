// 云海 · the cloud sea (displaced, self-shadowed height-field of cumulus billows) and lit cloud
// "puffs" (sphere impostors) for distant towers, banks, islet collars and drifting cloudlets.
import * as THREE from 'three';
import { TAU, clamp, lerp } from '../../lib/util.js';
import { SHARED_GLSL, NOISE_GLSL, CLOUD_TOP } from './common.js';

/* ------------------------------------------------------------------ */
/* Shared cloud lighting GLSL                                          */
/* ------------------------------------------------------------------ */
export const CLOUD_LIGHT_GLSL = /* glsl */`
uniform vec4 uCasters[4];        // xyz centre, w radius of islets casting soft shadows on clouds
uniform vec4 uGlowPos[8];        // xyz, w radius
uniform vec3 uGlowCol[8];
float casterShadow(vec3 p, vec3 L){
  float s = 1.0;
  for (int i = 0; i < 4; i++) {
    vec4 c = uCasters[i];
    if (c.w <= 0.0) continue;
    float t = (c.y - p.y) / max(L.y, 0.02);
    if (t <= 0.0) continue;
    vec3 q = p + L * t;
    float d = length(q.xz - c.xz);
    float pen = c.w * (0.35 + t * 0.012);
    s *= mix(1.0, smoothstep(c.w * 0.55 - pen * 0.4, c.w * 0.95 + pen, d), 0.82);
  }
  return s;
}
vec3 glowLights(vec3 p, vec3 N){
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 g = uGlowPos[i];
    if (g.w <= 0.0) continue;
    vec3 dv = g.xyz - p; float d2 = dot(dv, dv);
    float fall = g.w * g.w / (d2 + g.w * g.w * 0.25);
    acc += uGlowCol[i] * fall * (0.55 + 0.45 * max(dot(N, dv * inversesqrt(d2 + 1e-4)), 0.0));
  }
  return acc;
}
// Soft multiple-scattering cloud shading. hn: 0 deep/valley .. 1 exposed top. sh: light visibility.
// thin: 0 thick core .. 1 optically thin edge (silver lining when back-lit).
vec3 cloudShade(vec3 N, vec3 V, vec3 L, float hn, float sh, float exposure, float thin){
  float ndl = dot(N, L);
  float wrap = clamp((ndl + 0.3) / 1.3, 0.0, 1.0);
  float diffuse = mix(max(ndl, 0.0), wrap * wrap, 0.55);
  float depth = smoothstep(0.0, 1.0, hn);
  vec3 amb = uAmbient * mix(0.32, 1.08, depth) * (0.78 + 0.3 * N.y) + uBounce * 0.1 * (1.0 - N.y);
  vec3 direct = uLightCol * diffuse * sh * mix(0.3, 1.0, depth) * exposure;
  float VL = dot(-V, L);
  float fwd = pow(max(VL, 0.0), 5.0);
  vec3 silver = uLightCol * thin * (0.1 + 2.2 * fwd) * sh * (0.35 + 0.65 * depth);
  vec3 sheen = uLightCol * pow(max(VL, 0.0), 12.0) * 0.3 * sh * depth;
  return vec3(0.97, 0.965, 0.96) * (amb + direct) + silver + sheen;
}
`;

/* ------------------------------------------------------------------ */
/* Cloud sea                                                           */
/* ------------------------------------------------------------------ */
const SEA_VERT = /* glsl */`
${SHARED_GLSL}
uniform sampler2D tBillow;
uniform vec4 uL1, uL2, uL0;   // scale, offset.xy, amplitude
uniform vec2 uRot2;
uniform float uTexSize, uCurve;
attribute float aSpacing;
varying vec3 vW;
varying vec2 vUv1, vUv2;
varying float vHn;
void main(){
  vec2 xz = position.xz;
  vec2 uv1 = xz * uL1.x + uL1.yz;
  vec2 xr = vec2(xz.x * uRot2.x - xz.y * uRot2.y, xz.x * uRot2.y + xz.y * uRot2.x);
  vec2 uv2 = xr * uL2.x + uL2.yz;
  float lod1 = clamp(log2(max(aSpacing * uL1.x * uTexSize, 1.0)), 0.0, 9.0);
  float lod2 = clamp(log2(max(aSpacing * uL2.x * uTexSize, 1.0)), 0.0, 9.0);
  float h1 = textureLod(tBillow, uv1, lod1).r;
  float h2 = textureLod(tBillow, uv2, lod2).r;
  float sw = textureLod(tBillow, xz * uL0.x + uL0.yz, 5.0).a;
  float m = 0.55 + 0.9 * sw;
  float H = (h1 - 0.45) * uL1.w * m + (h2 - 0.5) * uL2.w + (sw - 0.5) * uL0.w;
  float r2 = dot(xz, xz);
  vec3 p = vec3(xz.x, uCloudTop + H - r2 * uCurve, xz.y);
  vW = p; vUv1 = uv1; vUv2 = uv2;
  vHn = clamp(h1 * 0.7 + h2 * 0.3, 0.0, 1.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const SEA_FRAG = /* glsl */`
${SHARED_GLSL}
${CLOUD_LIGHT_GLSL}
uniform sampler2D tBillow, tDetail;
uniform vec4 uL1, uL2, uL0, uLD;
uniform vec2 uRot2;
uniform float uG1, uGD, uCurve;
uniform int uShadowSteps;
varying vec3 vW;
varying vec2 vUv1, vUv2;
varying float vHn;

float heightAt(vec2 xz, float sw){
  vec2 xr = vec2(xz.x * uRot2.x - xz.y * uRot2.y, xz.x * uRot2.y + xz.y * uRot2.x);
  float h1 = texture2D(tBillow, xz * uL1.x + uL1.yz, 1.5).r;
  float h2 = texture2D(tBillow, xr * uL2.x + uL2.yz, 1.5).r;
  return uCloudTop + (h1 - 0.45) * uL1.w * (0.55 + 0.9 * sw) + (h2 - 0.5) * uL2.w + (sw - 0.5) * uL0.w - dot(xz, xz) * uCurve;
}

void main(){
  vec3 toCam = cameraPosition - vW;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec4 b1 = texture2D(tBillow, vUv1);
  vec4 b2 = texture2D(tBillow, vUv2);
  float sw = textureLod(tBillow, vW.xz * uL0.x + uL0.yz, 5.0).a;
  vec2 g1 = (b1.gb - 0.5) * 2.0 * uG1 * uL1.x * uL1.w * (0.55 + 0.9 * sw);
  vec2 g2r = (b2.gb - 0.5) * 2.0 * uG1 * uL2.x * uL2.w;
  vec2 g2 = vec2(uRot2.x * g2r.x + uRot2.y * g2r.y, -uRot2.y * g2r.x + uRot2.x * g2r.y);
  vec2 gw = g1 + g2;
  float detailW = 1.0 - smoothstep(60.0, 500.0, dist);
  vec4 dd = texture2D(tDetail, vW.xz * uLD.x + uLD.yz);
  gw += (dd.gb - 0.5) * 2.0 * uGD * uLD.x * uLD.w * detailW;
  vec3 N = normalize(vec3(-gw.x, 1.0, -gw.y));
  vec3 L = uLightDir;

  // self shadowing: march the height field toward the light
  float sh = 1.0;
  vec2 Lh = L.xz; float lh = length(Lh); Lh = lh > 1e-3 ? Lh / lh : vec2(1.0, 0.0);
  // never march flatter than ~6 degrees: at sunset the tops must still catch the light
  float tanE = max(L.y, 0.105) / max(lh, 1e-3);
  float stepLen = 4.0;
  float t = 0.0;
  for (int i = 0; i < 5; i++) {
    if (i >= uShadowSteps) break;
    t += stepLen; stepLen *= 1.9;
    vec2 q = vW.xz + Lh * t;
    float ry = vW.y + tanE * t + 0.6;
    float hq = heightAt(q, sw);
    sh = min(sh, smoothstep(-1.0 - t * 0.08, 1.5 + t * 0.15, ry - hq));
  }
  sh = mix(sh, 1.0, 0.18);
  sh *= casterShadow(vW, L);
  float hn = clamp(vHn * 0.85 + dd.r * 0.15 * detailW + (sw - 0.5) * 0.3, 0.0, 1.0);
  // Thick-cloud shading: brightness comes mostly from depth in the deck and sun visibility,
  // the surface normal only nudges it (a cloud is not a hard surface).
  float depth = smoothstep(0.08, 0.9, hn);
  float ndl = dot(N, L);
  float soft = clamp((ndl + 0.55) / 1.55, 0.0, 1.0);
  float lit = sh * mix(0.58, 1.0, soft) * mix(0.55, 1.0, depth);
  vec3 shadowC = uAmbient * mix(0.5, 1.0, depth) + uBounce * 0.1;
  vec3 litC = uAmbient * 0.7 + uLightCol * 1.05;
  vec3 col = mix(shadowC, litC, lit);
  float VL = dot(-V, L);
  // forward scattering glow toward the sun and thin bright rims on the tops
  float rimT = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  col += uLightCol * (pow(max(VL, 0.0), 10.0) * 0.45 * depth + rimT * pow(max(VL, 0.0), 4.0) * 1.2 * depth) * sh;
  col += glowLights(vW, N) * (0.6 + 0.4 * hn);
  // haze: the sea dissolves into the horizon
  col = mix(col, hazeColor(-V), fogAmountAt(vW));
  gl_FragColor = vec4(col, 1.0);
}`;

function solveExpGrid(rings, rMax, firstSpacing) {
  // r(i) = A (e^{b i} - 1), A b = firstSpacing, r(rings) = rMax
  let lo = 1e-5, hi = 1;
  for (let it = 0; it < 80; it++) {
    const b = (lo + hi) / 2, A = firstSpacing / b;
    if (A * (Math.exp(b * rings) - 1) > rMax) hi = b; else lo = b;
  }
  const b = (lo + hi) / 2;
  return { A: firstSpacing / b, b };
}

function seaGeometry(rings, segs, rMax, first) {
  const { A, b } = solveExpGrid(rings, rMax, first);
  const n = 1 + rings * segs;
  const pos = new Float32Array(n * 3), spacing = new Float32Array(n);
  spacing[0] = first;
  for (let i = 1; i <= rings; i++) {
    const r = A * (Math.exp(b * i) - 1);
    const dr = A * b * Math.exp(b * i);
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * TAU + (i % 2) * (Math.PI / segs);
      const k = 1 + (i - 1) * segs + j;
      pos[k * 3] = Math.cos(a) * r; pos[k * 3 + 2] = Math.sin(a) * r;
      spacing[k] = Math.max(dr, (TAU * r) / segs);
    }
  }
  const idx = [];
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segs, a1 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      // ring i+1 is rotated by half a segment on odd rings: keep triangles well shaped
      if (i % 2 === 1) { idx.push(a0 + j, a0 + j1, a1 + j1); idx.push(a0 + j, a1 + j1, a1 + j); }
      else { idx.push(a0 + j, a0 + j1, a1 + j); idx.push(a0 + j1, a1 + j1, a1 + j); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSpacing', new THREE.BufferAttribute(spacing, 1));
  g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, CLOUD_TOP, 0), rMax);
  return g;
}

export function createCloudSea(env, shared, tex) {
  const q = env.q;
  const rings = Math.round(lerp(110, 220, clamp((q - 0.45) / 0.55, 0, 1)));
  const segs = Math.round(lerp(150, 300, clamp((q - 0.45) / 0.55, 0, 1)));
  const geo = seaGeometry(rings, segs, 4200, q >= 0.9 ? 0.9 : q >= 0.6 ? 1.4 : 2.2);
  const rot = env.rng.range(0.4, 1.1);
  const casters = [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0));
  const glowPos = [], glowCol = [];
  for (let i = 0; i < 8; i++) { glowPos.push(new THREE.Vector4(0, 0, 0, 0)); glowCol.push(new THREE.Color(0, 0, 0)); }
  const uniforms = Object.assign({}, shared, {
    tBillow: { value: tex.billow.tex },
    tDetail: { value: tex.detail.tex },
    uL1: { value: new THREE.Vector4(1 / 380, env.rng.next(), env.rng.next(), 30) },
    uL2: { value: new THREE.Vector4(1 / 131, env.rng.next(), env.rng.next(), 3.2) },
    uL0: { value: new THREE.Vector4(1 / 2100, env.rng.next(), env.rng.next(), 16) },
    uLD: { value: new THREE.Vector4(1 / 52, env.rng.next(), env.rng.next(), 0.25) },
    uRot2: { value: new THREE.Vector2(Math.cos(rot), Math.sin(rot)) },
    uTexSize: { value: tex.billow.size },
    uG1: { value: tex.billow.G },
    uGD: { value: tex.detail.G },
    uCurve: { value: 1 / (2 * 70000) },
    uShadowSteps: { value: q >= 0.9 ? 4 : q >= 0.6 ? 3 : 2 },
    uCasters: { value: casters },
    uGlowPos: { value: glowPos },
    uGlowCol: { value: glowCol },
  });
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: SEA_VERT, fragmentShader: SEA_FRAG });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;

  // CPU copy of the height field so creatures can skim the tops and feeding can hit them
  const H = tex.billow.heights, S = tex.billow.size;
  const sampleTex = (u, v) => {
    u = (u % 1 + 1) % 1; v = (v % 1 + 1) % 1;
    const x = u * S - 0.5, y = v * S - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const at = (xx, yy) => H[((yy + S) % S) * S + ((xx + S) % S)];
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
  const L1 = uniforms.uL1.value, L2 = uniforms.uL2.value, L0 = uniforms.uL0.value, R2 = uniforms.uRot2.value;
  const v1 = new THREE.Vector2(0.0008, 0.00035), v2 = new THREE.Vector2(-0.0021, 0.0013);
  const heightAt = (x, z) => {
    const h1 = sampleTex(x * L1.x + L1.y, z * L1.x + L1.z);
    const xr = x * R2.x - z * R2.y, zr = x * R2.y + z * R2.x;
    const h2 = sampleTex(xr * L2.x + L2.y, zr * L2.x + L2.z);
    const sw = 0.5; // the swell is low frequency; the mean is good enough on the CPU
    return CLOUD_TOP + (h1 - 0.45) * L1.w * (0.55 + 0.9 * sw) + (h2 - 0.5) * L2.w - (x * x + z * z) * uniforms.uCurve.value;
  };
  return {
    mesh, uniforms, heightAt, casters, glowPos, glowCol,
    update(dt) {
      // the offsets only feed tiling textures (period 1): wrapping keeps them precise in float32 forever
      L1.y = (L1.y + v1.x * dt) % 1; L1.z = (L1.z + v1.y * dt) % 1;
      L2.y = (L2.y + v2.x * dt) % 1; L2.z = (L2.z + v2.y * dt) % 1;
      L0.y = (L0.y + 0.00004 * dt) % 1;
      uniforms.uLD.value.y = (uniforms.uLD.value.y + 0.004 * dt) % 1;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Puffs: lit sphere impostors                                         */
/* ------------------------------------------------------------------ */
const PUFF_VERT = /* glsl */`
attribute vec4 aPuff;     // centre, radius
attribute vec4 aPuff2;    // seed, shade (0 inner/low .. 1 exposed), alpha, unused
attribute vec4 aCluster;  // cluster centre, cluster radius
varying vec2 vUv;
varying vec4 vP2;
varying vec3 vC, vW;
varying vec4 vCl;
varying float vR;
void main(){
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = aPuff.xyz + (right * position.x + up * position.y) * aPuff.w;
  vUv = position.xy; vP2 = aPuff2; vC = aPuff.xyz; vW = wp; vCl = aCluster; vR = aPuff.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;
const PUFF_FRAG = /* glsl */`
${SHARED_GLSL}
${CLOUD_LIGHT_GLSL}
uniform sampler2D tDetail, tNoise;
uniform float uFogMul;
varying vec2 vUv;
varying vec4 vP2;
varying vec3 vC, vW;
varying vec4 vCl;
varying float vR;
void main(){
  float r2 = dot(vUv, vUv);
  if (r2 > 1.0) discard;
  float sd = vP2.x;
  float cs = cos(sd * 6.2831), sn = sin(sd * 6.2831);
  vec2 ruv = vec2(cs * vUv.x - sn * vUv.y, sn * vUv.x + cs * vUv.y);
  float n1 = texture2D(tDetail, ruv * 0.28 + vec2(sd * 3.7, sd * 1.3)).r;
  float n2 = texture2D(tNoise, ruv * 0.45 + vec2(sd * 1.9, sd * 4.1) + uTime * 0.002).g;
  float edge = (1.0 - r2) + (n1 - 0.55) * 0.6 + (n2 - 0.5) * 0.35;
  float a = smoothstep(0.0, 0.55, edge) * vP2.z;
  if (a < 0.004) discard;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 toCam = normalize(cameraPosition - vC);
  vec3 nv = normalize(vec3((vUv + (vec2(n1, n2) - 0.5) * 0.4) * 0.8, sqrt(max(1.0 - r2, 0.0)) + 0.45));
  vec3 N = normalize(right * nv.x + up * nv.y + toCam * nv.z);
  vec3 V = normalize(cameraPosition - vW);
  vec3 L = uLightDir;
  vec3 rel = vC - vCl.xyz;
  float exposure = smoothstep(-0.75, 0.55, dot(rel / max(length(rel), 1e-3), L)) * 0.8 + 0.2 * vP2.y;
  float sh = casterShadow(vW, L);
  vec3 col = cloudShade(N, V, L, clamp(vP2.y * 0.7 + vUv.y * 0.2 + 0.1, 0.0, 1.0), sh, exposure, r2 * r2);
  col += glowLights(vW, N);
  float fog = fogAmountAt(vC) * uFogMul;
  col = mix(col, hazeColor(-V), fog);
  // dissolve where the puff dips into the cloud sea, and when the camera gets close
  a *= smoothstep(uCloudTop - 14.0, uCloudTop + 2.0, vW.y) * 0.6 + 0.4;
  a *= smoothstep(vR * 1.2, vR * 3.5, distance(cameraPosition, vC));
  gl_FragColor = vec4(col * a, a);
}`;

/**
 * A set of puffs in one instanced draw. items: [{x,y,z,r, seed, shade, alpha, cx,cy,cz,cr, grp?, ord?}].
 * dynamic: re-sort (and allow moving) every frame.
 * Items that share a `grp` ({x,y,z}, e.g. a camera-facing swirl) are sorted as one unit by the group's
 * distance and keep a fixed order inside it (`ord`, back to front). Sorting overlapping puffs of one swirl
 * by their own distances made them swap places as the camera bobbed, and every swap popped.
 */
export function createPuffs(shared, tex, items, { dynamic = false, fogMul = 1, glow } = {}) {
  const n = items.length;
  const quad = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const aPuff = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const aPuff2 = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  const aCluster = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  if (dynamic) { aPuff.setUsage(THREE.DynamicDrawUsage); aPuff2.setUsage(THREE.DynamicDrawUsage); aCluster.setUsage(THREE.DynamicDrawUsage); }
  geo.setAttribute('aPuff', aPuff); geo.setAttribute('aPuff2', aPuff2); geo.setAttribute('aCluster', aCluster);
  geo.instanceCount = n;
  const uniforms = Object.assign({}, shared, {
    tDetail: { value: tex.detail.tex }, tNoise: { value: tex.noise }, uFogMul: { value: fogMul },
    uCasters: glow.casters, uGlowPos: glow.glowPos, uGlowCol: glow.glowCol,
  });
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: PUFF_VERT, fragmentShader: PUFF_FRAG,
    transparent: true, depthWrite: false, premultipliedAlpha: true, blending: THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  const order = items.map((_, i) => i);
  const dist = new Float32Array(n), ord = new Float32Array(n);
  items.forEach((it, i) => { ord[i] = it.ord ?? 0; });
  function write() {
    const P = aPuff.array, P2 = aPuff2.array, C = aCluster.array;
    for (let k = 0; k < n; k++) {
      const it = items[order[k]], o = k * 4;
      P[o] = it.x; P[o + 1] = it.y; P[o + 2] = it.z; P[o + 3] = it.r;
      P2[o] = it.seed; P2[o + 1] = it.shade; P2[o + 2] = it.alpha; P2[o + 3] = 0;
      C[o] = it.cx; C[o + 1] = it.cy; C[o + 2] = it.cz; C[o + 3] = it.cr;
    }
    aPuff.needsUpdate = aPuff2.needsUpdate = aCluster.needsUpdate = true;
  }
  function sortFrom(p) {
    for (let i = 0; i < n; i++) { const it = items[i], c = it.grp || it; const dx = c.x - p.x, dy = c.y - p.y, dz = c.z - p.z; dist[i] = dx * dx + dy * dy + dz * dz; }
    // insertion sort (far to near; fixed order inside a group): the order barely changes between frames
    for (let i = 1; i < n; i++) {
      const v = order[i], dv = dist[v], ov = ord[v];
      let j = i - 1;
      while (j >= 0 && (dist[order[j]] < dv || (dist[order[j]] === dv && ord[order[j]] > ov))) { order[j + 1] = order[j]; j--; }
      order[j + 1] = v;
    }
  }
  sortFrom(new THREE.Vector3(0, 20, 0));
  write();
  return {
    mesh, items, uniforms,
    update(camera) { if (!dynamic) return; sortFrom(camera.position); write(); },
    resort(p) { sortFrom(p); write(); },
  };
}

/** Cumulus tower made of puffs: wide base, cauliflower crown. */
export function towerPuffs(rng, base, height, radius, count, out) {
  const cx = base.x, cz = base.z, cy = base.y + height * 0.45, cr = Math.max(radius, height * 0.5);
  for (let i = 0; i < count; i++) {
    const t = Math.pow(rng.next(), 0.85);              // height fraction
    const env = radius * (1 - 0.55 * t) * (0.75 + 0.25 * Math.sin(t * 3.0 + 1.0));
    const a = rng.next() * TAU, rr = Math.sqrt(rng.next()) * env * 0.75;
    const r = radius * lerp(0.42, 0.24, t) * rng.range(0.75, 1.2);
    out.push({
      x: cx + Math.cos(a) * rr, y: base.y + t * height, z: cz + Math.sin(a) * rr, r,
      seed: rng.next(), shade: clamp(0.25 + t * 0.7 + rr / env * 0.2, 0, 1), alpha: rng.range(0.85, 1),
      cx, cy, cz, cr,
    });
  }
  // crown: a ring of domes on top
  const crown = Math.round(count * 0.25);
  for (let i = 0; i < crown; i++) {
    const a = rng.next() * TAU, rr = rng.range(0.1, 0.5) * radius * 0.5;
    out.push({
      x: cx + Math.cos(a) * rr, y: base.y + height * rng.range(0.88, 1.02), z: cz + Math.sin(a) * rr, r: radius * rng.range(0.2, 0.3),
      seed: rng.next(), shade: 1, alpha: 1, cx, cy, cz, cr,
    });
  }
}

/** Low flat bank of puffs resting on the sea. */
export function bankPuffs(rng, center, length, depth, height, count, yaw, out) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (let i = 0; i < count; i++) {
    const u = rng.range(-0.5, 0.5), v = rng.gauss() * 0.22;
    const lx = u * length, lz = v * depth;
    const hump = Math.cos(u * Math.PI) * 0.8 + 0.2;
    const r = height * rng.range(0.45, 0.9) * (0.6 + 0.4 * hump);
    out.push({
      x: center.x + lx * c - lz * s, y: center.y + r * 0.35 + rng.range(0, height * 0.5) * hump, z: center.z + lx * s + lz * c, r,
      seed: rng.next(), shade: clamp(0.4 + hump * 0.5, 0, 1), alpha: rng.range(0.8, 1),
      cx: center.x, cy: center.y, cz: center.z, cr: length * 0.5,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Mist-falls spilling off islet edges                                 */
/* ------------------------------------------------------------------ */
const MIST_VERT = /* glsl */`
varying vec2 vUv; varying vec3 vW;
void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const MIST_FRAG = /* glsl */`
${SHARED_GLSL}
uniform sampler2D tNoise;
uniform float uSpeed, uOpacity, uMistT;
varying vec2 vUv; varying vec3 vW;
void main(){
  float u = vUv.x, v = vUv.y;   // u across, v along the fall (0 lip .. 1 bottom)
  // uMistT wraps every 31.25 s: 31.25 * 0.32 * {1, 1.6, 2.3} are whole texture repeats, so the wrap is seamless
  float s1 = texture2D(tNoise, vec2(u * 1.3, v * 2.2 - uMistT * uSpeed)).r;
  float s2 = texture2D(tNoise, vec2(u * 3.1 + 0.3, v * 5.0 - uMistT * uSpeed * 1.6)).g;
  float s3 = texture2D(tNoise, vec2(u * 7.0, v * 9.0 - uMistT * uSpeed * 2.3)).b;
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

export function mistFall(shared, tex, start, outward, height, width0, width1) {
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

