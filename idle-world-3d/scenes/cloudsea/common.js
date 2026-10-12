// 云海 · shared state: time-of-day palette, uniforms shared by every material, sky-matched fog,
// material patching and procedural textures (billow height field, detail, cirrus, noise).
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, invLerp, makeRng, patchMaterial, sunState } from '../../lib/util.js';

export const CLOUD_TOP = -26;          // nominal height of the cloud-sea tops (billows rise ~10 m above)

/* ------------------------------------------------------------------ */
/* Palette (Journey / Sky: peach, rose, gold, lavender, indigo)         */
/* ------------------------------------------------------------------ */
// e = sun elevation in degrees. Colours are sRGB hex; *I values are linear radiance scales.
// zen/mid: sky, hzA: horizon away from the sun, hzB: horizon toward the sun, glow: sun halo,
// light: key light colour (sun or moon), li: key light radiance, amb: sky ambient (cloud shadows),
// bounce: light bounced up from the cloud sea, fog: haze density.
const DUSK = [
  { e: -90, zen: '#02040d', mid: '#060a20', hzA: '#121a44', hzB: '#141c48', glow: '#000000', light: '#a4b8ff', li: 0.34, amb: '#1b2350', ai: 0.20, bounce: '#202a58', bi: 0.18, sky: 1.0, fog: 0.0011 },
  { e: -15, zen: '#040924', mid: '#0b1546', hzA: '#1d2a62', hzB: '#222e68', glow: '#06070e', light: '#a4b8ff', li: 0.34, amb: '#1d2654', ai: 0.22, bounce: '#232c5c', bi: 0.2, sky: 1.0, fog: 0.0011 },
  { e: -7, zen: '#0d1850', mid: '#28337c', hzA: '#55529a', hzB: '#a8629a', glow: '#5a2a40', light: '#9888d0', li: 0.06, amb: '#3a3a80', ai: 0.30, bounce: '#4a3f86', bi: 0.25, sky: 1.0, fog: 0.0012 },
  { e: -2, zen: '#1c2a6c', mid: '#5c4f9c', hzA: '#b07cae', hzB: '#f88e6c', glow: '#b84e34', light: '#ff8462', li: 0.45, amb: '#6a5aa6', ai: 0.40, bounce: '#9a6a9a', bi: 0.35, sky: 1.0, fog: 0.0012 },
  { e: 1.5, zen: '#2c3c88', mid: '#a676aa', hzA: '#f0a49c', hzB: '#ffb460', glow: '#ffa044', light: '#ffa262', li: 1.6, amb: '#9476b8', ai: 0.42, bounce: '#f0a890', bi: 0.55, sky: 1.0, fog: 0.0012 },
  { e: 6, zen: '#33529c', mid: '#ae90c0', hzA: '#f6b8a8', hzB: '#ffcc80', glow: '#ffb85a', light: '#ffc07a', li: 1.95, amb: '#9a8ec4', ai: 0.46, bounce: '#f0c0b8', bi: 0.65, sky: 1.0, fog: 0.0011 },
  { e: 14, zen: '#3a6cc4', mid: '#82a9de', hzA: '#d6dcee', hzB: '#fbe2c6', glow: '#ffe0b0', light: '#ffe6c8', li: 1.9, amb: '#9fb2de', ai: 0.5, bounce: '#e8e4ea', bi: 0.7, sky: 1.0, fog: 0.0010 },
  { e: 30, zen: '#2c6cd4', mid: '#6aa2e6', hzA: '#c0daf4', hzB: '#deeaf8', glow: '#fff0d8', light: '#fff4e6', li: 1.8, amb: '#98b2e2', ai: 0.48, bounce: '#e4ecf6', bi: 0.75, sky: 1.0, fog: 0.0009 },
  { e: 90, zen: '#2660ca', mid: '#629ae4', hzA: '#bcd8f6', hzB: '#d8e8f8', glow: '#fff6ea', light: '#ffffff', li: 1.85, amb: '#9ab4e4', ai: 0.5, bounce: '#e6eef8', bi: 0.78, sky: 1.0, fog: 0.0009 },
];
// Sunrise: softer, paler pastels (mint-lilac-apricot) instead of the saturated golden-pink dusk.
const DAWN = [
  DUSK[0], DUSK[1],
  { e: -7, zen: '#14205a', mid: '#3a4488', hzA: '#6a64a8', hzB: '#b07aa8', glow: '#603050', light: '#a8a0e0', li: 0.08, amb: '#4a4a90', ai: 0.32, bounce: '#5a5098', bi: 0.28, sky: 1.0, fog: 0.0012 },
  { e: -2, zen: '#334a92', mid: '#8a86c4', hzA: '#d4a8c8', hzB: '#ffbfa0', glow: '#d07a60', light: '#ffaa90', li: 0.5, amb: '#8a84c4', ai: 0.45, bounce: '#c0a0c0', bi: 0.4, sky: 1.0, fog: 0.0013 },
  { e: 1.5, zen: '#4a68b0', mid: '#aaa8dc', hzA: '#f2c8d6', hzB: '#ffd6b4', glow: '#ffc49a', light: '#ffc6a4', li: 1.1, amb: '#a6a2d8', ai: 0.55, bounce: '#ecc8d4', bi: 0.6, sky: 1.0, fog: 0.0013 },
  { e: 6, zen: '#5a7cc4', mid: '#b4bce6', hzA: '#f6d4dc', hzB: '#ffe2c4', glow: '#ffd8b0', light: '#ffdcbc', li: 1.5, amb: '#b0b2e2', ai: 0.6, bounce: '#f4dcdc', bi: 0.7, sky: 1.0, fog: 0.0012 },
  { e: 14, zen: '#4a7ccc', mid: '#94b6e4', hzA: '#e2e2f0', hzB: '#fdeedc', glow: '#ffe8cc', light: '#fff0dc', li: 1.8, amb: '#acbce2', ai: 0.62, bounce: '#ecebf2', bi: 0.72, sky: 1.0, fog: 0.0010 },
  DUSK[7], DUSK[8],
];
const COLOR_KEYS = ['zen', 'mid', 'hzA', 'hzB', 'glow', 'light', 'amb', 'bounce'];
function prepKeys(keys) {
  return keys.map(k => {
    const o = { ...k };
    for (const c of COLOR_KEYS) o[c] = new THREE.Color(k[c]);
    return o;
  });
}
const DUSK_K = prepKeys(DUSK), DAWN_K = prepKeys(DAWN);
const _ca = new THREE.Color(), _cb = new THREE.Color();
function sampleKeys(keys, e, out) {
  let i = 0;
  while (i < keys.length - 2 && e > keys[i + 1].e) i++;
  const a = keys[i], b = keys[i + 1];
  const t = smoothstep(0, 1, invLerp(a.e, b.e, e));
  for (const c of COLOR_KEYS) out[c].copy(a[c]).lerp(b[c], t);
  out.li = lerp(a.li, b.li, t); out.ai = lerp(a.ai, b.ai, t); out.bi = lerp(a.bi, b.bi, t);
  out.sky = lerp(a.sky, b.sky, t); out.fog = lerp(a.fog, b.fog, t);
  return out;
}
function makePal() { const o = { li: 0, ai: 0, bi: 0, sky: 1, fog: 0.001 }; for (const c of COLOR_KEYS) o[c] = new THREE.Color(); return o; }

/* ------------------------------------------------------------------ */
/* Shared uniforms                                                     */
/* ------------------------------------------------------------------ */
export function createShared() {
  return {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uLightCol: { value: new THREE.Color(1, 1, 1) },
    uZenith: { value: new THREE.Color() },
    uMidSky: { value: new THREE.Color() },
    uHazeA: { value: new THREE.Color() },
    uHazeB: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uAmbient: { value: new THREE.Color() },
    uBounce: { value: new THREE.Color() },
    uCloudFog: { value: new THREE.Color() },
    uFogDensity: { value: 0.001 },
    uCloudTop: { value: CLOUD_TOP },
    uNight: { value: 0 },
    uDay: { value: 1 },
    uGolden: { value: 0 },
    uSunUp: { value: 1 },
    uEnvPass: { value: 0 },
    uGlowBoost: { value: 1 },
  };
}

/**
 * Per-frame time-of-day: writes the palette into the shared uniforms and returns a state object
 * (reused, no allocations).
 */
export function createTimeOfDay(env, shared) {
  const dusk = makePal(), dawn = makePal(), pal = makePal();
  const st = {
    hours: -1, sun: null, elev: 0, night: 0, day: 1, golden: 0, sunW: 1, moonW: 0, morning: 0,
    pal, sunDir: new THREE.Vector3(0, 1, 0), moonDir: new THREE.Vector3(0, 1, 0), lightDir: new THREE.Vector3(0, 1, 0),
    lightCol: new THREE.Color(), lightI: 1,
  };
  st.update = force => {
    const h = env.hours();
    if (!force && Math.abs(h - st.hours) < 0.0015) return st;
    st.hours = h;
    // The sun runs ~15 min late so that 18:00 is golden hour rather than a half-sunk sun.
    const s = sunState(h - 0.25);
    st.sun = s;
    st.elev = s.elevationDeg;
    st.sunDir.copy(s.dir);
    st.moonDir.copy(s.moonDir);
    const e = st.elev;
    st.morning = h < 12 ? 1 : 0;
    sampleKeys(DUSK_K, e, dusk);
    sampleKeys(DAWN_K, e, dawn);
    const m = st.morning;
    for (const c of COLOR_KEYS) pal[c].copy(dusk[c]).lerp(dawn[c], m);
    for (const k of ['li', 'ai', 'bi', 'sky', 'fog']) pal[k] = lerp(dusk[k], dawn[k], m);
    st.night = 1 - smoothstep(-12, -3, e);
    st.day = smoothstep(-3, 8, e);
    st.golden = smoothstep(-5, 1, e) * (1 - smoothstep(8, 22, e));
    st.sunW = smoothstep(-4, 0.5, e);
    st.moonW = 1 - smoothstep(-9, -4, e);
    // Key light: sun by day, moon by night; the switch happens while both are dim.
    if (st.sunW >= st.moonW) { st.lightDir.copy(st.sunDir); st.lightI = pal.li * st.sunW; }
    else { st.lightDir.copy(st.moonDir); st.lightI = pal.li * st.moonW; }
    if (st.lightDir.y < 0.035) { st.lightDir.y = 0.035; st.lightDir.normalize(); }
    st.lightCol.copy(pal.light).multiplyScalar(st.lightI);

    const u = shared;
    u.uSunDir.value.copy(st.sunDir);
    u.uMoonDir.value.copy(st.moonDir);
    u.uLightDir.value.copy(st.lightDir);
    u.uLightCol.value.copy(st.lightCol);
    u.uZenith.value.copy(pal.zen).multiplyScalar(pal.sky);
    u.uMidSky.value.copy(pal.mid).multiplyScalar(pal.sky);
    u.uHazeA.value.copy(pal.hzA).multiplyScalar(pal.sky);
    u.uHazeB.value.copy(pal.hzB).multiplyScalar(pal.sky);
    u.uGlow.value.copy(pal.glow).multiplyScalar(st.sunW * 1.0);
    u.uAmbient.value.copy(pal.amb).multiplyScalar(pal.ai);
    u.uBounce.value.copy(pal.bounce).multiplyScalar(pal.bi);
    // colour things dissolve into below the cloud tops: average lit cloud
    u.uCloudFog.value.copy(pal.amb).multiplyScalar(pal.ai * 1.15).add(_ca.copy(pal.light).multiplyScalar(st.lightI * 0.28));
    u.uFogDensity.value = pal.fog;
    u.uNight.value = st.night;
    u.uDay.value = st.day;
    u.uGolden.value = st.golden;
    u.uSunUp.value = st.sunW;
    return st;
  };
  return st;
}

/* ------------------------------------------------------------------ */
/* GLSL                                                                */
/* ------------------------------------------------------------------ */
export const SHARED_GLSL = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir, uMoonDir, uLightDir, uLightCol;
uniform vec3 uZenith, uMidSky, uHazeA, uHazeB, uGlow, uAmbient, uBounce, uCloudFog;
uniform float uFogDensity, uCloudTop, uNight, uDay, uGolden, uSunUp, uEnvPass, uGlowBoost;
// Horizon haze colour in a direction: rose/lavender away from the sun, gold toward it.
vec3 hazeColor(vec3 dir){
  vec2 a = dir.xz; float la = length(a); a = la > 1e-4 ? a / la : vec2(1.0, 0.0);
  vec2 s = uSunDir.xz; float ls = length(s); s = ls > 1e-4 ? s / ls : vec2(1.0, 0.0);
  float az = dot(a, s) * 0.5 + 0.5;
  vec3 c = mix(uHazeA, uHazeB, az * az * az);
  float mu = max(dot(dir, uSunDir), 0.0);
  c += uGlow * (pow(mu, 4.0) * 0.22 + pow(mu, 24.0) * 0.55 + pow(mu, 200.0) * 1.2);
  return c;
}
// Exponential height fog: dense at the cloud tops, thinning with altitude (scale height 130 m).
float fogAmountAt(vec3 wpos){
  vec3 v = wpos - cameraPosition; float D = length(v);
  const float k = 1.0 / 130.0;
  float y0 = max(cameraPosition.y - uCloudTop, -30.0) * k, y1 = max(wpos.y - uCloudTop, -30.0) * k;
  float dy = y1 - y0;
  float avg = abs(dy) > 1e-3 ? (exp(-y0) - exp(-y1)) / dy : exp(-y0);
  return 1.0 - exp(-uFogDensity * D * avg);
}
vec3 applyFog(vec3 col, vec3 wpos){
  vec3 v = wpos - cameraPosition; float d = length(v); vec3 dir = v / max(d, 1e-4);
  // things below the cloud tops sink into the cloud colour
  float sink = smoothstep(uCloudTop + 5.0, uCloudTop - 7.0, wpos.y);
  col = mix(col, uCloudFog, sink * 0.94);
  return mix(col, hazeColor(dir), fogAmountAt(wpos));
}
`;

export const NOISE_GLSL = /* glsl */`
float hash11(float p){ p = fract(p * .1031); p *= p + 33.33; p *= p + p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
`;

/**
 * Add the sky-matched fog (and optional extra hooks) to a built-in material.
 * opts.fragment / vertex / headers are merged with the fog hooks.
 */
export function patchStd(material, shared, opts = {}) {
  const vertex = Object.assign({}, opts.vertex || {});
  const fogV = /* glsl */`
    vec4 csWorld = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      csWorld = instanceMatrix * csWorld;
    #endif
    csWorld = modelMatrix * csWorld;
    vWPos = csWorld.xyz;
  `;
  vertex['#include <fog_vertex>'] = (vertex['#include <fog_vertex>'] || '$&') + fogV;
  const fragment = Object.assign({}, opts.fragment || {});
  fragment['#include <fog_fragment>'] = (fragment['#include <fog_fragment>'] || '') + `\n gl_FragColor.rgb = applyFog(min(gl_FragColor.rgb, vec3(24.0)), vWPos);`;
  return patchMaterial(material, {
    key: 'cs-' + (opts.key || 'std'),
    uniforms: Object.assign({}, shared, opts.uniforms || {}),
    vertexHeader: 'varying vec3 vWPos;\n' + (opts.vertexHeader || ''),
    fragmentHeader: 'varying vec3 vWPos;\n' + SHARED_GLSL + (opts.fragmentHeader || ''),
    vertex, fragment,
  });
}

/* ------------------------------------------------------------------ */
/* Procedural textures (tileable)                                      */
/* ------------------------------------------------------------------ */
/** Periodic gradient noise (Perlin) in 2D; period in lattice cells (<= 256). */
export function makePerlin(seed) {
  const rng = makeRng(seed);
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rng.next() * TAU; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  return function perlin(x, y, period = 256, periodY = period) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X0 = ((xi % period) + period) % period, Y0 = ((yi % periodY) + periodY) % periodY;
    const X1 = (X0 + 1) % period, Y1 = (Y0 + 1) % periodY;
    const h00 = perm[perm[X0] + Y0], h10 = perm[perm[X1] + Y0], h01 = perm[perm[X0] + Y1], h11 = perm[perm[X1] + Y1];
    const n00 = gx[h00] * xf + gy[h00] * yf, n10 = gx[h10] * (xf - 1) + gy[h10] * yf;
    const n01 = gx[h01] * xf + gy[h01] * (yf - 1), n11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1);
    const u = fade(xf), v = fade(yf);
    return (n00 + (n10 - n00) * u + (n01 - n00) * v + (n00 - n10 - n01 + n11) * u * v) * 1.41;
  };
}
/** Tileable fbm on the unit square: u,v in [0,1), base period in cells. */
export function tileFbm(perlin, u, v, period, oct = 4, gain = 0.5) {
  let s = 0, a = 1, n = 0, p = period;
  for (let o = 0; o < oct; o++) { s += a * perlin(u * p + o * 17.3, v * p + o * 9.1, p); n += a; a *= gain; p *= 2; }
  return s / n;
}

function dataTex(data, w, h, { repeat = true, mip = true } = {}) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mip;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/**
 * Cumulus "cauliflower" height field: unions of soft domes at three scales plus fbm.
 * Returns { tex, heights(Float32Array), size, sample(u,v) } — R height, G/B gradient, A low-freq swell.
 */
export function makeBillowTexture(seed, size = 512) {
  const rng = makeRng(seed);
  const perlin = makePerlin(seed ^ 0x51ed);
  const H = new Float32Array(size * size);
  const layers = [
    { n: 5, w: 0.52, rMin: 0.8, rMax: 1.3, k: 0.28 },
    { n: 11, w: 0.28, rMin: 0.75, rMax: 1.25, k: 0.25 },
    { n: 23, w: 0.14, rMin: 0.7, rMax: 1.2, k: 0.22 },
    { n: 47, w: 0.06, rMin: 0.7, rMax: 1.2, k: 0.2 },
  ];
  for (const L of layers) {
    const N = L.n;
    L.px = new Float32Array(N * N); L.py = new Float32Array(N * N); L.r = new Float32Array(N * N); L.s = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) { L.px[i] = rng.next(); L.py[i] = rng.next(); L.r[i] = rng.range(L.rMin, L.rMax); L.s[i] = rng.range(0.55, 1.0); }
  }
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      let h = 0;
      for (const L of layers) {
        const N = L.n, fx = u * N, fy = v * N, cx = Math.floor(fx), cy = Math.floor(fy);
        // smooth union of round domes: rounded valleys instead of sharp creases
        let best = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
          const ix = ((cx + i) % N + N) % N, iy = ((cy + j) % N + N) % N, k = iy * N + ix;
          const dx = cx + i + L.px[k] - fx, dy = cy + j + L.py[k] - fy;
          const d2 = (dx * dx + dy * dy) / (L.r[k] * L.r[k]);
          if (d2 < 1.6) {
            const dome = Math.sqrt(Math.max(0, 1 - d2 / 1.6)) * L.s[k];
            const hh = Math.max(L.k - Math.abs(best - dome), 0) / L.k;
            best = Math.max(best, dome) + hh * hh * L.k * 0.25;
          }
        }
        h += best * L.w;
      }
      h += tileFbm(perlin, u, v, 16, 3) * 0.05;
      H[y * size + x] = h;
    }
  }
  // normalise to 0..1
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < H.length; i++) { if (H[i] < mn) mn = H[i]; if (H[i] > mx) mx = H[i]; }
  for (let i = 0; i < H.length; i++) H[i] = (H[i] - mn) / (mx - mn);
  const data = new Uint8Array(size * size * 4);
  const G = 16; // gradient range in height-per-uv
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const gu = (at(x + 1, y) - at(x - 1, y)) * size * 0.5, gv = (at(x, y + 1) - at(x, y - 1)) * size * 0.5;
    data[i] = Math.round(H[y * size + x] * 255);
    data[i + 1] = Math.round(clamp(0.5 + gu / (2 * G), 0, 1) * 255);
    data[i + 2] = Math.round(clamp(0.5 + gv / (2 * G), 0, 1) * 255);
    data[i + 3] = Math.round(clamp(tileFbm(perlin, x / size, y / size, 2, 3) * 0.75 + 0.5, 0, 1) * 255);
  }
  const tex = dataTex(data, size, size);
  return { tex, G, size, heights: H };
}

/** Small-scale detail (fine billows/fuzz): R height, G/B gradient, A fbm. */
export function makeDetailTexture(seed, size = 256) {
  const rng = makeRng(seed);
  const perlin = makePerlin(seed ^ 0x7711);
  const N = 9, px = [], py = [], rr = [];
  for (let i = 0; i < N * N; i++) { px.push(rng.next()); py.push(rng.next()); rr.push(rng.range(0.7, 1.2)); }
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, fx = u * N, fy = v * N, cx = Math.floor(fx), cy = Math.floor(fy);
    let best = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const ix = ((cx + i) % N + N) % N, iy = ((cy + j) % N + N) % N, k = iy * N + ix;
      const dx = cx + i + px[k] - fx, dy = cy + j + py[k] - fy;
      const d2 = (dx * dx + dy * dy) / (rr[k] * rr[k]);
      if (d2 < 1) best = Math.max(best, Math.pow(1 - d2, 0.6));
    }
    H[y * size + x] = best * 0.7 + (tileFbm(perlin, u, v, 12, 3) * 0.5 + 0.5) * 0.3;
  }
  const data = new Uint8Array(size * size * 4);
  const G = 10;
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const gu = (at(x + 1, y) - at(x - 1, y)) * size * 0.5, gv = (at(x, y + 1) - at(x, y - 1)) * size * 0.5;
    data[i] = Math.round(clamp(H[y * size + x], 0, 1) * 255);
    data[i + 1] = Math.round(clamp(0.5 + gu / (2 * G), 0, 1) * 255);
    data[i + 2] = Math.round(clamp(0.5 + gv / (2 * G), 0, 1) * 255);
    data[i + 3] = Math.round(clamp(tileFbm(perlin, x / size, y / size, 6, 4) * 0.6 + 0.5, 0, 1) * 255);
  }
  return { tex: dataTex(data, size, size), G };
}

/** Fibrous cirrus streaks (R), broader veils (G), coverage (B), fine fbm (A). */
export function makeCirrusTexture(seed, size = 512) {
  const p1 = makePerlin(seed ^ 0x1234), p2 = makePerlin(seed ^ 0x4321), p3 = makePerlin(seed ^ 0x9999);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    // domain warp, then strongly anisotropic noise for brush-stroke fibres
    const wx = tileFbm(p2, u, v, 3, 3) * 0.12, wy = tileFbm(p2, u + 0.37, v + 0.71, 3, 3) * 0.12;
    const uu = u + wx, vv = v + wy;
    let fib = 0, a = 1, n = 0;
    for (let o = 0; o < 4; o++) {
      const f = 2 << o;            // 2, 4, 8, 16 cells across, 9x denser along v: long thin fibres
      fib += a * p1(uu * f, vv * f * 9, f, f * 9); n += a; a *= 0.55;
    }
    fib = fib / n;
    const veil = tileFbm(p3, uu, vv, 4, 4);
    const cov = tileFbm(p3, u + 0.5, v + 0.25, 2, 3);
    const i = (y * size + x) * 4;
    data[i] = Math.round(clamp(fib * 0.9 + 0.5, 0, 1) * 255);
    data[i + 1] = Math.round(clamp(veil * 0.8 + 0.5, 0, 1) * 255);
    data[i + 2] = Math.round(clamp(cov * 0.9 + 0.5, 0, 1) * 255);
    data[i + 3] = Math.round(clamp(tileFbm(p1, u, v, 24, 3) * 0.7 + 0.5, 0, 1) * 255);
  }
  return dataTex(data, size, size);
}

/** General purpose tileable noise: R/G/B/A = fbm at 4, 8, 16, 32 cells. */
export function makeNoiseTexture(seed, size = 256) {
  const p = makePerlin(seed ^ 0x2468);
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, i = (y * size + x) * 4;
    data[i] = Math.round(clamp(tileFbm(p, u, v, 4, 4) * 0.75 + 0.5, 0, 1) * 255);
    data[i + 1] = Math.round(clamp(tileFbm(p, u + 0.3, v + 0.6, 8, 4) * 0.75 + 0.5, 0, 1) * 255);
    data[i + 2] = Math.round(clamp(tileFbm(p, u + 0.7, v + 0.1, 16, 3) * 0.75 + 0.5, 0, 1) * 255);
    data[i + 3] = Math.round(clamp(tileFbm(p, u + 0.2, v + 0.9, 32, 2) * 0.75 + 0.5, 0, 1) * 255);
  }
  return dataTex(data, size, size);
}

/** Rock surface: RGB tangent-space normal, A height (fbm + ridges + pits), tileable. */
export function makeRockTexture(seed, size = 256) {
  const p = makePerlin(seed ^ 0x3c3c), p2 = makePerlin(seed ^ 0x5a5a);
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const base = tileFbm(p, u, v, 4, 5, 0.55);
    let ridge = 0, a = 0.5, f = 6, n = 0;
    for (let o = 0; o < 3; o++) { const r = 1 - Math.abs(p2(u * f, v * f, f)); ridge += a * r * r; n += a; a *= 0.5; f *= 2; }
    H[y * size + x] = base * 0.6 + (ridge / n) * 0.55;
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < H.length; i++) { mn = Math.min(mn, H[i]); mx = Math.max(mx, H[i]); }
  const data = new Uint8Array(size * size * 4);
  const at = (x, y) => (H[((y + size) % size) * size + ((x + size) % size)] - mn) / (mx - mn);
  const k = 2.2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * k, dy = (at(x, y + 1) - at(x, y - 1)) * k;
    const l = Math.hypot(dx, dy, 1 / 6);
    const i = (y * size + x) * 4;
    data[i] = Math.round((-dx / l * 0.5 + 0.5) * 255);
    data[i + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
    data[i + 2] = Math.round(((1 / 6) / l * 0.5 + 0.5) * 255);
    data[i + 3] = Math.round(at(x, y) * 255);
  }
  return dataTex(data, size, size);
}

/** Soft radial sprite with a hot core (for motes, orbs, flames). */
export function glowSprite(size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x + 0.5) / size * 2 - 1, dy = (y + 0.5) / size * 2 - 1, r = Math.sqrt(dx * dx + dy * dy);
    const v = clamp(Math.exp(-r * r * 9) * 0.85 + Math.exp(-r * r * 60) * 0.6, 0, 1) * (1 - smoothstep(0.85, 1, r));
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(v * 255);
  }
  return dataTex(data, size, size, { repeat: false });
}
