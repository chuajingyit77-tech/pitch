// Shared helpers for every scene: math, seeded randomness, noise, canvas textures,
// shader snippets and a simple time-of-day model.
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => clamp((v - a) / (b - a), 0, 1);
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** Frame-rate independent exponential smoothing toward a target. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const dampVec = (v, target, lambda, dt) => v.lerp(target, 1 - Math.exp(-lambda * dt));
/** Shortest signed angle from a to b. */
export const angleDelta = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
export const dampAngle = (a, b, lambda, dt) => a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));

/* ------------------------------------------------------------------ */
/* Seeded randomness                                                   */
/* ------------------------------------------------------------------ */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** mulberry32 based generator with a few conveniences. */
export function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  const next = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    random: next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => Math.floor(a + (b - a + 1) * next()),
    pick: arr => arr[Math.floor(next() * arr.length)],
    chance: p => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    gauss: () => { let u = 0, v = 0; while (u === 0) u = next(); while (v === 0) v = next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); },
    /** Independent child stream, stable for a given salt. */
    fork: salt => makeRng(hashString(String(salt)) ^ seed),
    shuffle: arr => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; },
    onSphere: (v = new THREE.Vector3()) => { const z = next() * 2 - 1, a = next() * TAU, r = Math.sqrt(1 - z * z); return v.set(r * Math.cos(a), z, r * Math.sin(a)); },
  };
  return rng;
}

/* ------------------------------------------------------------------ */
/* Simplex noise (2D / 3D), seeded                                     */
/* ------------------------------------------------------------------ */
export function createNoise(seed = 1) {
  const rng = makeRng(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512), pm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm12[i] = perm[i] % 12; }
  const g = [1,1,0, -1,1,0, 1,-1,0, -1,-1,0, 1,0,1, -1,0,1, 1,0,-1, -1,0,-1, 0,1,1, 0,-1,1, 0,1,-1, 0,-1,-1];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6, F3 = 1 / 3, G3 = 1 / 6;

  function noise2(xin, yin) {
    let n0 = 0, n1 = 0, n2 = 0;
    const s = (xin + yin) * F2, i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2, x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) { const gi = pm12[ii + perm[jj]] * 3; t0 *= t0; n0 = t0 * t0 * (g[gi] * x0 + g[gi + 1] * y0); }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) { const gi = pm12[ii + i1 + perm[jj + j1]] * 3; t1 *= t1; n1 = t1 * t1 * (g[gi] * x1 + g[gi + 1] * y1); }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) { const gi = pm12[ii + 1 + perm[jj + 1]] * 3; t2 *= t2; n2 = t2 * t2 * (g[gi] * x2 + g[gi + 1] * y2); }
    return 70 * (n0 + n1 + n2);
  }

  function noise3(xin, yin, zin) {
    let n0, n1, n2, n3;
    const s = (xin + yin + zin) * F3, i = Math.floor(xin + s), j = Math.floor(yin + s), k = Math.floor(zin + s);
    const t = (i + j + k) * G3, x0 = xin - (i - t), y0 = yin - (j - t), z0 = zin - (k - t);
    let i1, j1, k1, i2, j2, k2;
    if (x0 >= y0) {
      if (y0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
      else if (x0 >= z0) { i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1; }
      else { i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1; }
    } else {
      if (y0 < z0) { i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1; }
      else if (x0 < z0) { i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1; }
      else { i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0; }
    }
    const x1 = x0 - i1 + G3, y1 = y0 - j1 + G3, z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3, y2 = y0 - j2 + 2 * G3, z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3, y3 = y0 - 1 + 3 * G3, z3 = z0 - 1 + 3 * G3;
    const ii = i & 255, jj = j & 255, kk = k & 255;
    let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
    if (t0 < 0) n0 = 0; else { const gi = pm12[ii + perm[jj + perm[kk]]] * 3; t0 *= t0; n0 = t0 * t0 * (g[gi] * x0 + g[gi + 1] * y0 + g[gi + 2] * z0); }
    let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
    if (t1 < 0) n1 = 0; else { const gi = pm12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3; t1 *= t1; n1 = t1 * t1 * (g[gi] * x1 + g[gi + 1] * y1 + g[gi + 2] * z1); }
    let t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
    if (t2 < 0) n2 = 0; else { const gi = pm12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3; t2 *= t2; n2 = t2 * t2 * (g[gi] * x2 + g[gi + 1] * y2 + g[gi + 2] * z2); }
    let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
    if (t3 < 0) n3 = 0; else { const gi = pm12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3; t3 *= t3; n3 = t3 * t3 * (g[gi] * x3 + g[gi + 1] * y3 + g[gi + 2] * z3); }
    return 32 * (n0 + n1 + n2 + n3);
  }

  const fbm2 = (x, y, oct = 4, lac = 2, gain = 0.5) => { let a = 1, f = 1, s = 0, n = 0; for (let o = 0; o < oct; o++) { s += a * noise2(x * f, y * f); n += a; a *= gain; f *= lac; } return s / n; };
  const fbm3 = (x, y, z, oct = 4, lac = 2, gain = 0.5) => { let a = 1, f = 1, s = 0, n = 0; for (let o = 0; o < oct; o++) { s += a * noise3(x * f, y * f, z * f); n += a; a *= gain; f *= lac; } return s / n; };
  /** Ridged multifractal, 0..1, good for rocks and mountains. */
  const ridged2 = (x, y, oct = 4) => { let a = 0.5, f = 1, s = 0, n = 0; for (let o = 0; o < oct; o++) { const v = 1 - Math.abs(noise2(x * f, y * f)); s += a * v * v; n += a; a *= 0.5; f *= 2; } return s / n; };
  return { noise2, noise3, fbm2, fbm3, ridged2 };
}

/* ------------------------------------------------------------------ */
/* Canvas textures                                                     */
/* ------------------------------------------------------------------ */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * Paint a texture with a 2D canvas callback.
 * opts: { srgb = true, repeat = false | [x, y], mipmaps = true, anisotropy = 8, flipY }
 */
export function canvasTexture(w, h, draw, opts = {}) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  draw(g, w, h, c);
  const tex = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat) {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (Array.isArray(opts.repeat)) tex.repeat.set(opts.repeat[0], opts.repeat[1]);
  }
  tex.anisotropy = opts.anisotropy ?? 8;
  if (opts.flipY !== undefined) tex.flipY = opts.flipY;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Turn a height field (canvas or ImageData-like gray canvas) into a tangent-space normal map.
 * strength ~ 1..8. Wraps at edges when `wrap` is true.
 */
export function normalMapFromHeight(heightCanvas, strength = 2, wrap = true) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const og = out.getContext('2d');
  const img = og.createImageData(w, h);
  const H = (x, y) => {
    if (wrap) { x = (x + w) % w; y = (y + h) % h; } else { x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1); }
    return src[(y * w + x) * 4] / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  og.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.NoColorSpace;
  if (wrap) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/** Fill a canvas with fbm noise (grayscale or colored via a mapping function). */
export function noiseCanvas(w, h, { seed = 1, scale = 4, octaves = 5, map = v => [v * 255, v * 255, v * 255], tile = true } = {}) {
  const n = createNoise(seed);
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v;
      if (tile) {
        // Sample a 4D torus via two circles so the result tiles seamlessly.
        const a = (x / w) * TAU, b = (y / h) * TAU, r = scale / TAU;
        v = n.fbm3(Math.cos(a) * r, Math.sin(a) * r, Math.cos(b) * r + Math.sin(b) * r * 0.5, octaves);
        v = v * 0.5 + 0.5;
      } else {
        v = n.fbm2((x / w) * scale, (y / h) * scale, octaves) * 0.5 + 0.5;
      }
      const [r, gg, b, a = 255] = map(clamp(v, 0, 1), x, y);
      const i = (y * w + x) * 4;
      img.data[i] = r; img.data[i + 1] = gg; img.data[i + 2] = b; img.data[i + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Soft round sprite for particles (white, alpha falloff). */
export function softDiscTexture(size = 64, hardness = 0.0) {
  return canvasTexture(size, size, (g, w) => {
    const r = w / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(clamp(hardness, 0, 0.95), 'rgba(255,255,255,0.85)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  });
}

/* ------------------------------------------------------------------ */
/* Time of day                                                         */
/* ------------------------------------------------------------------ */
const _sunKeys = [
  // elevation (deg), zenith, horizon, sun color, sun intensity, ambient sky, ambient ground, ambient intensity
  [-90, '#03060f', '#070d1c', '#9db4ff', 0.10, '#1b2440', '#07080c', 0.22],
  [-14, '#050a1c', '#0e1a35', '#9db4ff', 0.12, '#1d2846', '#090a10', 0.25],
  [-5, '#14244c', '#4b5b88', '#ff8f6a', 0.10, '#3a4a72', '#1a1414', 0.35],
  [1, '#35558f', '#ff9a68', '#ff7a3c', 0.9, '#8c7e94', '#3a2a22', 0.55],
  [8, '#4a84cc', '#ffc189', '#ffad62', 2.0, '#a6b2c6', '#5a4a38', 0.75],
  [25, '#3c82d4', '#bcd9f0', '#fff0d8', 2.8, '#b6cde8', '#6b6150', 0.9],
  [90, '#2c72d0', '#cfe6f7', '#ffffff', 3.2, '#c0d8f0', '#706a58', 1.0],
];
const _c = new THREE.Color(), _c2 = new THREE.Color();

/**
 * Sun state for a local hour (0..24). Uses a real solar-elevation formula for latitude ~25°N
 * at equinox: sunrise ~6:00, noon elevation ~65°, sunset ~18:00.
 * Direction convention: +x = east, -x = west, +z = south, +y = up. Pass azimuthOffset (radians)
 * to rotate the sun path around the scene.
 */
export function sunState(hours, { latitude = 25, azimuthOffset = 0 } = {}) {
  const lat = THREE.MathUtils.degToRad(latitude);
  const H = THREE.MathUtils.degToRad((hours - 12) * 15);
  const sinE = Math.cos(lat) * Math.cos(H);
  const elevation = Math.asin(clamp(sinE, -1, 1));
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat)) + azimuthOffset;
  const ce = Math.cos(elevation);
  const dir = new THREE.Vector3(-Math.sin(az) * ce, Math.sin(elevation), Math.cos(az) * ce).normalize();
  const eDeg = THREE.MathUtils.radToDeg(elevation);
  // Moon roughly opposite the sun, a bit higher so nights are not pitch black.
  const moonDir = new THREE.Vector3(-dir.x, Math.max(0.25, -dir.y * 0.8 + 0.2), -dir.z).normalize();

  let i = 0;
  while (i < _sunKeys.length - 2 && eDeg > _sunKeys[i + 1][0]) i++;
  const a = _sunKeys[i], b = _sunKeys[i + 1];
  const t = invLerp(a[0], b[0], eDeg);
  const mix = (ia, ib) => new THREE.Color(a[ia]).lerp(_c2.set(b[ia]), t);
  return {
    hours,
    elevation, // radians
    elevationDeg: eDeg,
    azimuth: az,
    dir, // unit vector toward the sun
    moonDir,
    day: smoothstep(-4, 6, eDeg), // 0 at night, 1 in daylight
    night: 1 - smoothstep(-10, -2, eDeg),
    golden: smoothstep(-3, 2, eDeg) * (1 - smoothstep(6, 20, eDeg)), // peaks around sunrise / sunset
    zenith: mix(1, 1),
    horizon: mix(2, 2),
    sunColor: mix(3, 3),
    sunIntensity: lerp(a[4], b[4], t),
    skyAmbient: mix(5, 5),
    groundAmbient: mix(6, 6),
    ambientIntensity: lerp(a[7], b[7], t),
  };
}

/* ------------------------------------------------------------------ */
/* GLSL snippets                                                       */
/* ------------------------------------------------------------------ */
export const GLSL = {
  /** hash12, hash22, value noise, simplex 3D (Ashima/Gustavson, MIT), fbm. */
  noise: /* glsl */`
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+10.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857; vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z); vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0; vec4 s1 = floor(b1)*2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0); m = m * m;
  return 105.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm3(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * snoise(p); p *= 2.02; a *= 0.5; } return s; }
`,
  /** Voronoi-edge caustics: bright web of light lines, 0..~1.5. */
  caustics: /* glsl */`
float causticEdge(vec2 p, float t){
  vec2 n = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(n + g); o = 0.5 + 0.45 * sin(t + 6.2831 * o);
    vec2 r = g + o - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return sqrt(d2) - sqrt(d1);
}
float caustics(vec2 p, float t){
  float e1 = causticEdge(p, t * 0.9);
  float e2 = causticEdge(p * 1.37 + vec2(3.1, 1.7), t * 1.15 + 2.0);
  return exp(-e1 * e1 * 55.0) * 0.75 + exp(-e2 * e2 * 70.0) * 0.55;
}
`,
};

/**
 * Small wrapper around onBeforeCompile. Each hook is a string or (source) => source.
 * { uniforms, vertexHeader, fragmentHeader, vertex: { '#include <chunk>': 'replacement' }, fragment: {...}, key }
 * Replacement strings may contain $& to keep the original chunk.
 */
export function patchMaterial(material, { uniforms = {}, vertexHeader = '', fragmentHeader = '', vertex = {}, fragment = {}, key = 'patched' } = {}) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = vertexHeader + '\n' + shader.vertexShader;
    shader.fragmentShader = fragmentHeader + '\n' + shader.fragmentShader;
    for (const [k, v] of Object.entries(vertex)) shader.vertexShader = shader.vertexShader.replace(k, v.replace('$&', k));
    for (const [k, v] of Object.entries(fragment)) shader.fragmentShader = shader.fragmentShader.replace(k, v.replace('$&', k));
    material.userData.shader = shader;
  };
  const prevKey = material.customProgramCacheKey?.bind(material);
  material.customProgramCacheKey = () => (prevKey ? prevKey() : '') + '|' + key;
  material.needsUpdate = true;
  return material;
}

/**
 * Wind sway for vegetation (grass, leaves, fronds, branches). Works with plain meshes and
 * InstancedMesh (instances may be rotated/scaled freely). Displacement grows with object-space
 * height (position.y / height) raised to `stiffness`. Shared uniforms let one wind drive a scene.
 *
 *   const wind = createWind();           // in update(): wind.update(dt, t)
 *   addWind(material, wind, { height: 1.2, amount: 0.25 });
 */
export function createWind({ direction = new THREE.Vector2(1, 0.3), strength = 1, gust = 1 } = {}) {
  const uniforms = {
    uWindTime: { value: 0 },
    uWindDir: { value: direction.clone().normalize() },
    uWindStrength: { value: strength },
    uWindGust: { value: gust },
    uWindScroll: { value: new THREE.Vector2() },
  };
  return {
    uniforms,
    update(dt) {
      uniforms.uWindTime.value += dt;
      // gusts travel with the wind; integrating keeps them continuous when the direction changes
      uniforms.uWindScroll.value.addScaledVector(uniforms.uWindDir.value, dt * 0.45 * Math.max(0.3, uniforms.uWindStrength.value));
    },
    set(dir, strength) { if (dir) uniforms.uWindDir.value.copy(dir).normalize(); if (strength !== undefined) uniforms.uWindStrength.value = strength; },
  };
}

export function addWind(material, wind, { height = 1, amount = 0.2, stiffness = 1.6, flutter = 0.0, key = 'wind' } = {}) {
  return patchMaterial(material, {
    key: key + height + amount + stiffness + flutter,
    uniforms: { ...wind.uniforms, uWindHeight: { value: height }, uWindAmount: { value: amount }, uWindStiff: { value: stiffness }, uWindFlutter: { value: flutter } },
    vertexHeader: /* glsl */`
      uniform float uWindTime, uWindStrength, uWindGust, uWindHeight, uWindAmount, uWindStiff, uWindFlutter;
      uniform vec2 uWindDir, uWindScroll;
      float windHash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 45758.5453); }
      // inverse() is GLSL ES 3.0 only; this works in WebGL 1 too (Safari 14)
      mat3 windInverse3(mat3 m){
        vec3 a = m[0], b = m[1], c = m[2];
        vec3 r0 = cross(b, c), r1 = cross(c, a), r2 = cross(a, b);
        float det = dot(a, r0);
        return mat3(r0.x, r1.x, r2.x, r0.y, r1.y, r2.y, r0.z, r1.z, r2.z) / (abs(det) > 1e-12 ? det : 1.0);
      }
      float windNoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(windHash(i), windHash(i+vec2(1,0)), u.x), mix(windHash(i+vec2(0,1)), windHash(i+vec2(1,1)), u.x), u.y); }
    `,
    vertex: {
      '#include <project_vertex>': /* glsl */`
        vec4 mvPosition = vec4(transformed, 1.0);
        vec3 windOrigin = vec3(0.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          windOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        #endif
        vec3 wo = (modelMatrix * vec4(windOrigin, 1.0)).xyz;
        float wh = clamp(transformed.y / uWindHeight, 0.0, 1.5);
        float bendW = pow(wh, uWindStiff);
        // Large travelling gusts plus a smaller per-plant sway.
        float gust = windNoise(wo.xz * 0.06 - uWindScroll) * uWindGust;
        float sway = sin(uWindTime * 1.7 + wo.x * 0.7 + wo.z * 0.9) * 0.35 + sin(uWindTime * 3.1 + wo.z * 1.3) * 0.15;
        float push = uWindStrength * uWindAmount * bendW * (0.35 + gust * 1.1 + sway * 0.6);
        vec3 disp = vec3(uWindDir.x, 0.0, uWindDir.y) * push;
        disp.y -= push * push * 0.35; // keep the plant's length roughly constant
        disp += vec3(sin(uWindTime * 9.0 + wo.x * 5.0 + transformed.y * 7.0), 0.0, cos(uWindTime * 8.0 + wo.z * 5.0)) * uWindFlutter * bendW * uWindStrength;
        mvPosition.xyz += windInverse3(mat3(modelMatrix)) * disp;
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
      `,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */
/** Dispose geometries, materials and textures under an object. */
export function disposeObject(root) {
  const seen = new Set();
  root.traverse(o => {
    if (o.isSkinnedMesh && o.skeleton && !seen.has(o.skeleton)) { seen.add(o.skeleton); o.skeleton.dispose(); }
    if (o.isLight && o.shadow && o.shadow.map) { o.shadow.map.dispose(); o.shadow.map = null; }
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      for (const v of Object.values(m)) if (v && v.isTexture && !seen.has(v)) { seen.add(v); v.dispose(); }
      if (m.uniforms) for (const u of Object.values(m.uniforms)) if (u && u.value && u.value.isTexture && !seen.has(u.value)) { seen.add(u.value); u.value.dispose(); }
      m.dispose();
    }
  });
}

/** Distance from point p to the ray. */
export function rayPointDistance(ray, p) {
  return ray.distanceToPoint(p);
}

/** Place a quaternion so local +X points along `forward` with world-up bias, plus roll. */
const _m = new THREE.Matrix4(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
export function quatFromForward(q, forward, roll = 0, up = _up) {
  _x.copy(forward).normalize();
  _z.crossVectors(_x, up);
  if (_z.lengthSq() < 1e-6) _z.set(0, 0, 1);
  _z.normalize();
  _y.crossVectors(_z, _x).normalize();
  if (roll) { const c = Math.cos(roll), s = Math.sin(roll); const y2 = _y.clone().multiplyScalar(c).addScaledVector(_z, s); _z.multiplyScalar(c).addScaledVector(_y, -s); _y.copy(y2); }
  _m.makeBasis(_x, _y, _z);
  return q.setFromRotationMatrix(_m);
}
