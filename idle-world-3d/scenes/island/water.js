// 晴岛 water: one continuous surface from the lapping shoreline to the horizon.
// - Planar mirror reflection (one extra pass, reduced resolution, adapted from three/examples Water.js, MIT)
// - Gerstner swell that calms down over the lagoon (seabed height from the shared field texture)
// - Transparent, Fresnel-weighted surface: the clear water body itself is the seabed tinted by the
//   shared absorption (see shared.js), so turquoise shallows fade seamlessly into deep blue.
// - Foam: swash edge, incoming wavelets, reef surf, rocks/posts, whitecaps; bioluminescent at night.
import * as THREE from 'three';
import { GLSL, TAU, smoothstep } from '../../lib/util.js';
import { waterUniforms, WATER_PERIOD, whaleFieldUniforms } from './shared.js';
import { fieldUniforms, SWASH_GLSL } from './terrain.js';

const WAVES = [
  [1.0, 0.35, 0.11, 17.0],
  [0.55, 0.9, 0.09, 9.7],
  [-0.4, 1.0, 0.075, 6.1],
  [0.92, -0.5, 0.055, 3.7],
];
// Deep-water waves (omega = sqrt(g k)), each angular frequency snapped to a whole number of cycles per
// WATER_PERIOD so the wrapped shader clock is seamless (CPU and GPU use the same speeds)
const WV = WAVES.map(([dx, dz, st, len]) => {
  const l = Math.hypot(dx, dz), k = TAU / len;
  const omega = Math.round(Math.sqrt(9.8 * k) * WATER_PERIOD / TAU) * TAU / WATER_PERIOD;
  return { dx: dx / l, dz: dz / l, k, c: omega / k, a: st / k };
});
const AMP_SUM = WV.reduce((s, w) => s + w.a, 0);

/** The swell as shader uniforms (shared by the water surface and things that ride on it, e.g. ripples). */
export const swellUniforms = {
  uWaves: { value: WAVES.map(([, , st, len], i) => new THREE.Vector4(WV[i].dx, WV[i].dz, st, len)) },
  uWaveC: { value: WV.map(w => w.c) }, // phase speeds (snapped, see WV)
  uAmpSum: { value: AMP_SUM },
};

/** GLSL: Gerstner displacement of the water grid point p (needs uWaves, uWTime). */
export const SWELL_GLSL = /* glsl */`
uniform float uWaveC[4];
vec3 swellDisp(vec2 p, float atten) {
  vec3 disp = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    vec4 w = uWaves[i];
    float k = 6.2831853 / w.w;
    float f = k * (dot(w.xy, p) - uWaveC[i] * uWTime);
    float a = w.z * atten / k;
    disp += vec3(w.x * a * cos(f), a * sin(f), w.y * a * cos(f));
  }
  return disp;
}
`;

/** Height of the swell at (x, z) on the CPU (for floating things). depth = seabed depth below 0. */
export function waveHeight(x, z, t, depth = 20) {
  const atten = smoothstep(0.3, 5.5, depth);
  if (atten <= 0) return 0;
  // the water mesh also moves its points sideways: first find the point that the swell carries onto
  // (x, z), as the GPU surface does, so floating things sit on the drawn surface instead of dipping in
  let gx = x, gz = z;
  for (let it = 0; it < 3; it++) {
    let ox = 0, oz = 0;
    for (const w of WV) {
      const c = w.a * atten * Math.cos(w.k * (w.dx * gx + w.dz * gz - w.c * t));
      ox += w.dx * c; oz += w.dz * c;
    }
    gx = x - ox; gz = z - oz;
  }
  let y = 0;
  for (const w of WV) y += w.a * Math.sin(w.k * (w.dx * gx + w.dz * gz - w.c * t));
  return y * atten;
}

function polarGrid(nAng, r0, rMax) {
  const g = 1 + TAU / nAng;
  const radii = [];
  for (let r = r0; r < rMax; r *= g) radii.push(r);
  radii.push(rMax);
  const nR = radii.length;
  const pos = new Float32Array(nR * nAng * 3);
  let k = 0;
  for (let i = 0; i < nR; i++) {
    for (let j = 0; j < nAng; j++) {
      const a = (j + (i % 2) * 0.5) / nAng * TAU;
      pos[k++] = Math.cos(a) * radii[i]; pos[k++] = 0; pos[k++] = Math.sin(a) * radii[i];
    }
  }
  const idx = [];
  for (let i = 0; i < nR - 1; i++) {
    for (let j = 0; j < nAng; j++) {
      const a = i * nAng + j, b = i * nAng + (j + 1) % nAng, c = (i + 1) * nAng + j, d = (i + 1) * nAng + (j + 1) % nAng;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rMax);
  return geo;
}

const VERT = /* glsl */`
uniform mat4 uTexMat;
uniform float uWTime;
uniform vec4 uWaves[4];
uniform float uWaveC[4];
uniform float uAmpSum;
uniform sampler2D tField;
uniform vec4 uField;
${GLSL.noise}
${SWASH_GLSL}
varying vec4 vMirror;
varying vec3 vWPos;
varying vec3 vN;
varying float vCrest;
void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 fld = texture2D(tField, (p.xz - uField.xy) * uField.zw);
  float depth = -fld.r;
  float u = -fld.g;
  float r = length(p.xz);
  float atten = smoothstep(0.3, 5.5, depth) * (1.0 - smoothstep(160.0, 520.0, r));
  vec3 disp = vec3(0.0);
  vec3 tang = vec3(1.0, 0.0, 0.0), bin = vec3(0.0, 0.0, 1.0);
  for (int i = 0; i < 4; i++) {
    vec4 w = uWaves[i];
    float k = 6.2831853 / w.w;
    float f = k * (dot(w.xy, p.xz) - uWaveC[i] * uWTime);
    float st = w.z * atten;
    float a = st / k;
    float sf = sin(f), cf = cos(f);
    disp += vec3(w.x * a * cf, a * sf, w.y * a * cf);
    tang += vec3(-w.x * w.x * st * sf, w.x * st * cf, -w.x * w.y * st * sf);
    bin += vec3(-w.x * w.y * st * sf, w.y * st * cf, -w.y * w.y * st * sf);
  }
  vec3 wp = p + disp;
  wp.y += swashHeight(p.xz, u, uWTime) * (1.0 - smoothstep(1.5, 5.0, depth));
  vN = normalize(cross(bin, tang));
  vCrest = disp.y / uAmpSum;
  vMirror = uTexMat * vec4(p, 1.0);
  vWPos = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */`
uniform sampler2D tMirror;
uniform sampler2D tNormal;
uniform sampler2D tField;
uniform vec4 uField;
uniform float uWTime, uWPeriod;
uniform vec4 uNScroll, uFoamOff, uDriftOff;  // texture scrolls (wrapped to 1) and noise drifts (wrapped to 1024)
uniform vec2 uNScroll3, uCapOff;
uniform vec3 uSunDir, uSunCol, uMoonDir, uMoonCol;
uniform vec3 uSSS, uFoamCol, uGlow, uHorizon, uHorizonSun;
uniform float uNight, uReflStrength, uHazeNear, uHazeFar, uMirrorOn;
uniform vec3 uSkyFallback;
uniform sampler2D tWhaleFx;   // the gentle giant's marks (whalefx.js): R white water, G calm slick
uniform vec4 uWhaleFx;
uniform float uWhaleFxOn;
${GLSL.noise}
${SWASH_GLSL}
varying vec4 vMirror;
varying vec3 vWPos;
varying vec3 vN;
varying float vCrest;

// ---- anti-aliasing helpers --------------------------------------------------------------------------
// fp = metres covered by one pixel on the water. A noise octave with freq lattice cells per metre fades
// to its mean before its cells get smaller than ~2 px, so it cannot crawl or shimmer as the swell and the
// camera slide it across pixel centres.
float aaFade(float freq, float fp) { return smoothstep(0.3, 0.75, freq * fp); }
float vnoiseAA(vec2 q, float freq, float fp) { return mix(vnoise(q), 0.5, aaFade(freq, fp)); }
// Value noise whose lattice repeats every 1024 cells: the drifting foam reads it at offsets wrapped to 1024 in JS,
// so the drift never jumps (and never grows past float32 precision)
float vnoiseP(vec2 q) {
  vec2 i = floor(q), f = fract(q); vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 i0 = mod(i, 1024.0), i1 = mod(i + 1.0, 1024.0);
  return mix(mix(hash12(i0), hash12(vec2(i1.x, i0.y)), u.x), mix(hash12(vec2(i0.x, i1.y)), hash12(i1), u.x), u.y);
}
float vnoiseAAP(vec2 q, float freq, float fp) { return mix(vnoiseP(q), 0.5, aaFade(freq, fp)); }

// One level of the glitter: a sparse field of short-lived sparkles (one per lit cell). Each cell's twinkle rate
// is snapped to a whole number of cycles per clock period, and its seed counts cycles modulo that number, so the
// wrapped clock (uWTime, period uWPeriod) carries every sparkle on without a jump.
float sparkleCell(vec2 p, float t, float rate, float density) {
  vec2 c = floor(p);
  vec2 f = fract(p) - 0.5;
  float h = hash12(c);
  float nc = floor((1.2 + h * 2.2) * rate * uWPeriod + 0.5);
  float tt = t * (nc / uWPeriod) + h * 37.0;
  float seed = mod(mod(floor(tt), nc), 1024.0);   // small hash inputs
  float on = step(1.0 - density, hash12(c + seed * 7.13));
  vec2 o = (hash22(c + seed * 3.7) - 0.5) * 0.55;
  return on * sin(fract(tt) * 3.14159) * (1.0 - smoothstep(0.0, 0.2, length(f - o)));
}
// Glitter at any distance, mip-mapped like a texture: the cell size follows the pixel footprint in powers
// of two (neighbouring levels cross-faded), so a sparkle always covers more than a pixel and the field keeps
// the same density and mean brightness. Sub-pixel sparkles used to blink on and off from frame to frame.
float sparkle(vec2 p, float t, float rate, float density, float freq, float fp) {
  float lv = max(log2(fp * freq / 0.16), 0.0);
  float l0 = floor(lv), k = lv - l0;
  float s0 = freq * exp2(-l0);
  float a = sparkleCell(p * s0 + l0 * 17.0, t, rate, density);
  float b = sparkleCell(p * s0 * 0.5 + (l0 + 1.0) * 17.0, t, rate, density);
  return mix(a, b, k);
}
// Specular lobe pow(c, n), widened by the slope variance s2 (rad^2) hidden inside the pixel and dimmed to
// keep its energy (Toksvig): far or small on screen the glitter path stays a smooth sheen instead of a
// few pixels worth 30+ that flash as the swell moves.
float lobe(float c, float n, float s2) {
  float ne = n / (1.0 + 4.0 * n * s2);
  return pow(c, ne) * (ne / n);
}

void main() {
  vec4 fld = texture2D(tField, (vWPos.xz - uField.xy) * uField.zw);
  float seabed = fld.r;
  float u = -fld.g;
  float depth = vWPos.y - seabed;
  vec3 V = cameraPosition - vWPos;
  float dist = length(V);
  V /= dist;
  vec2 p = vWPos.xz;
  float t = uWTime;
  // size of this pixel on the surface: along its longer axis (fp) and on average (fpG)
  vec2 pdx = dFdx(p), pdy = dFdy(p);
  float lx = length(pdx), ly = length(pdy);
  float fp = max(max(lx, ly), 1e-4);
  float fpG = max(sqrt(lx * ly), 1e-4);

  // where the whale has been: white water (R) and a smooth slick (G), one lookup and only while there is any
  vec2 wfx = vec2(0.0);
  if (uWhaleFxOn > 0.5) wfx = texture2D(tWhaleFx, clamp((p - uWhaleFx.xy) * uWhaleFx.zw, 0.0, 1.0)).rg;

  // detail normals (three scrolling octaves), calmer over the lagoon, fading with distance
  vec3 n1 = texture2D(tNormal, p * 0.105 + uNScroll.xy).rgb * 2.0 - 1.0;
  vec3 n2 = texture2D(tNormal, p * 0.043 + uNScroll.zw).rgb * 2.0 - 1.0;
  vec3 n3 = texture2D(tNormal, p * 0.26 + uNScroll3).rgb * 2.0 - 1.0;
  vec2 slope = n1.xy * 0.45 + n2.xy * 0.6 + n3.xy * 0.28;
  float calm = mix(0.5, 1.0, smoothstep(0.3, 3.5, depth));
  float farK = 1.0 - smoothstep(50.0, 900.0, dist) * 0.75;
  float nk = 0.32 * calm * farK * (1.0 - 0.8 * wfx.g);
  vec3 N = normalize(vN + vec3(slope.x, 0.0, slope.y) * nk);
  // slope variance of the normal map that mip filtering removed inside this pixel (measured from the
  // 1024x1024 texture: the share lost per mip level follows smoothstep(1, 8.5, level); total xy variance 0.055)
  float lost = 0.2025 * smoothstep(1.0, 8.5, log2(fpG * 107.5))    // octave 1 (0.45^2), 1024 * 0.105
             + 0.36 * smoothstep(1.0, 8.5, log2(fpG * 44.0))       // octave 2 (0.6^2),  1024 * 0.043
             + 0.0784 * smoothstep(1.0, 8.5, log2(fpG * 266.2));   // octave 3 (0.28^2), 1024 * 0.26
  float sig2 = lost * 0.055 * nk * nk;

  float NdV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  F = clamp(F * uReflStrength, 0.0, 1.0);

  // rougher, blurrier reflections over the open swell; crisp over the calm lagoon
  float rough = smoothstep(1.0, 6.0, depth) * (1.0 - 0.7 * wfx.g);
  vec2 ruv = vMirror.xy / vMirror.w + N.xz * mix(0.03, 0.075, rough) / (1.0 + dist * 0.006);
  #if __VERSION__ >= 300
    vec3 mirror = textureLod(tMirror, ruv, mix(1.1, 3.6, rough)).rgb;
  #elif defined(GL_EXT_shader_texture_lod)
    vec3 mirror = texture2DLodEXT(tMirror, ruv, mix(1.1, 3.6, rough)).rgb; // WebGL 1 (Safari 14)
  #else
    vec3 mirror = texture2D(tMirror, ruv, mix(1.1, 3.6, rough)).rgb;
  #endif
  // (far out the mirror image is clipped right at the horizon by its skewed far plane, which drew a dark line along
  // the horizon at night: there the sea reflects the sky's horizon colour instead)
  vec3 refl = mix(uSkyFallback, mirror, uMirrorOn * (1.0 - smoothstep(1500.0, 3500.0, dist)));

  // sun + moon speculars and a glittering path made of discrete sparkles (each part is skipped while its
  // light is off or far from the reflection, which keeps the per-pixel cost down)
  vec3 R = reflect(-V, N);
  float sunOn = max(max(uSunCol.r, uSunCol.g), uSunCol.b), moonOn = max(max(uMoonCol.r, uMoonCol.g), uMoonCol.b);
  float sd = max(dot(R, uSunDir), 0.0), md = max(dot(R, uMoonDir), 0.0);
  float gSun = sunOn > 0.0 ? pow(sd, 48.0) : 0.0;
  float gMoon = moonOn > 0.0 ? pow(md, 30.0) : 0.0;
  float spk = 0.0;
  if (max(gSun * sunOn, gMoon * moonOn) > 0.002) spk = sparkle(p, t, 1.0, 0.085, 3.1, fp) + sparkle(p + 17.0 / 5.7, t, 1.3, 0.07, 5.7, fp) * 0.8;
  vec3 spec = vec3(0.0);
  if (sunOn > 0.0) spec += uSunCol * (lobe(sd, 1200.0, sig2) * 9.0 + lobe(sd, 240.0, sig2) * 0.3 + gSun * spk * 14.0 * farK);
  if (moonOn > 0.0) spec += uMoonCol * (lobe(md, 2600.0, sig2) * 2.2 + lobe(md, 160.0, sig2) * 0.12 + gMoon * spk * 8.0 * farK);
  // no highlight brighter than 8 (hue kept): bloom would turn a moving hot pixel into a blinking blob
  spec *= 8.0 / max(max(max(spec.r, spec.g), spec.b), 8.0);

  // subsurface glow through the swell crests (Sea of Thieves turquoise)
  float crest = clamp(vCrest * 1.15, 0.0, 1.0);
  float back = pow(max(dot(-V, uSunDir), 0.0), 2.5);
  vec3 sss = uSSS * crest * crest * (0.35 + 1.6 * back) * smoothstep(2.0, 7.0, depth);

  // ---- foam (every noise octave is filtered to its mean before it would alias) ----
  float fn = vnoiseAAP(p * 1.55 + uFoamOff.xy, 1.55, fp) * 0.6 + vnoiseAAP(p * 4.3 + uFoamOff.zw, 4.3, fp) * 0.4;
  float edge = 1.0 - smoothstep(0.0, 0.13, depth);
  float foamEdge = edge * smoothstep(0.28, 0.5, fn + edge * 0.35);
  float uu = max(u, 0.0);
  float ph = swashPhase(p, uu, t);
  float lines = pow(0.5 + 0.5 * sin(ph + 1.35), 9.0) * (1.0 - smoothstep(0.6, 6.5, u)) * step(-0.3, u);
  lines *= smoothstep(0.32, 0.62, fn);
  float laceN = mix(smoothstep(0.6, 0.82, vnoiseAAP(p * 2.4 + uDriftOff.xy, 2.4, fp)), 0.1, aaFade(2.4, fp));
  float lace = laceN * (1.0 - smoothstep(0.0, 2.6, u)) * 0.32 * smoothstep(0.3, 0.6, fn);
  float ob = fld.b * smoothstep(0.3, 0.7, fn * 0.8 + 0.3 * sin(t * 1.6 + p.x * 1.7 + p.y * 1.3));
  // reef surf: streaks running along the reef edge, rolling shoreward in sets
  float ang = atan(p.y, p.x);
  float rr = length(p);
  vec2 rp = vec2(ang * 18.0, rr * 1.4);   // the shoreward roll (0.35 /s) is in uDriftOff.zw
  float streak = vnoiseAAP(rp * vec2(1.0, 1.6) + vec2(0.0, uDriftOff.z), max(18.0 / max(rr, 1.0), 2.24), fp) * 0.65
               + vnoiseAAP(rp * vec2(2.3, 3.1) + vec2(7.0, 7.0 + uDriftOff.w), max(41.4 / max(rr, 1.0), 4.34), fp) * 0.35;
  float reefSet = smoothstep(0.35, 0.9, 0.5 + 0.5 * sin(t * 0.6 + ang * 3.0 + vnoise(p * 0.05) * 6.0));
  float reef = fld.a * smoothstep(0.5, 0.8, streak) * (0.35 + 0.65 * reefSet) * 0.65;
  // whitecaps: sparse lacy streaks riding the swell crests (stretched along the wind); far away they become
  // their average coverage instead of sub-pixel speckles
  vec2 wp2 = vec2(p.x * 0.8 + p.y * 0.35, p.y * 1.6 - p.x * 0.5);
  float lacyN = vnoiseAAP(wp2 * 2.2 + vec2(uCapOff.x, 0.0), 3.74, fp) * 0.55 + vnoiseAAP(wp2 * 6.5 + vec2(0.0, uCapOff.y), 11.05, fp) * 0.45;
  float lacy = mix(smoothstep(0.52, 0.78, lacyN), 0.12, aaFade(3.74, fp));
  float caps = smoothstep(0.7, 1.0, vCrest + (fn - 0.5) * 0.45) * lacy * smoothstep(5.0, 9.0, depth) * 0.6;
  float wFoam = smoothstep(0.22, 0.85, wfx.r * (0.4 + 1.0 * fn));   // lacy toward its edges and as it fades
  float foam = clamp(foamEdge + lines + lace + ob * 0.85 + reef + caps + wFoam, 0.0, 1.0) * 0.92;

  // bioluminescent plankton: the shore foam, the shallows and whatever the whale stirs up glow blue at night. The glow
  // breathes slowly (about 8 s, its phase drifting in broad patches), and the odd plankton glint fades in and out
  // over a second or more (the old glow rippled at 2.3 rad/s, which read as shimmer)
  float breath = 0.64 + 0.36 * sin(t * 0.8 + vnoise(p * 0.045) * 6.2831);
  float bio = (foamEdge * 1.0 + lines * 1.1 + lace * 0.3 + ob * 0.5 + reef * 0.06 + wFoam * 1.2) * breath;
  if (uGlow.b > 0.0 && u < 4.0) bio += sparkle(p + 3.0 / 2.7, t, 0.28, 0.12, 2.7, fp) * (1.0 - smoothstep(0.0, 4.0, u)) * 1.4 * (0.75 + 0.25 * breath);
  vec3 glow = uGlow * bio;

  vec3 surf = refl * F + spec + sss * (1.0 - F);
  vec3 foamC = uFoamCol * (0.85 + 0.15 * fn) * (1.0 - uNight * 0.6);
  vec3 rgb = surf * (1.0 - foam) + foamC * foam + glow;
  float alpha = 1.0 - (1.0 - F) * (1.0 - foam);

  // soft contact with the beach
  float soft = smoothstep(0.0, 0.04, depth);
  rgb *= soft; alpha *= soft;
  // horizon haze: the sky's own horizon colour, warmer and brighter toward the sun's bearing as the sky is
  vec2 vxz = normalize(vWPos.xz - cameraPosition.xz + 1e-5), sxz = normalize(uSunDir.xz + 1e-5);
  float toward = max(dot(vxz, sxz), 0.0);
  float hz = smoothstep(uHazeNear, uHazeFar, dist);
  rgb = mix(rgb, mix(uHorizon, uHorizonSun, toward * toward * toward * 0.85), hz);
  alpha = mix(alpha, 1.0, hz);
  // the last stretch (1.5-3 km out) fades into the sky dome behind (just below the horizon it is the horizon's own colour,
  // in every direction and at every hour), so sea and sky meet without a seam. (A uniform haze colour can only
  // approximate the sky there: at night it was far darker and drew a black line along the horizon.)
  float rimFade = 1.0 - smoothstep(1500.0, 3000.0, dist);
  rgb *= rimFade; alpha *= rimFade;   // (premultiplied: the light goes with the coverage)
  gl_FragColor = vec4(rgb, alpha);
}
`;

export function createWater(env, camera, { normalTex }) {
  const q = env.q;
  const nAng = q >= 0.9 ? 256 : q >= 0.6 ? 192 : 144;
  const geo = polarGrid(nAng, 6.5, 6500);

  const uniforms = {
    ...waterUniforms,
    ...fieldUniforms,
    ...swellUniforms,
    ...whaleFieldUniforms,
    uTexMat: { value: new THREE.Matrix4() },
    tMirror: { value: null },
    tNormal: { value: normalTex },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonCol: { value: new THREE.Color(0, 0, 0) },
    uSSS: { value: new THREE.Color(0.0, 0.25, 0.2) },
    uFoamCol: { value: new THREE.Color(1, 1, 1) },
    uGlow: { value: new THREE.Color(0, 0, 0) },
    uHorizon: { value: new THREE.Color(0.6, 0.7, 0.8) },
    uHorizonSun: { value: new THREE.Color(0.6, 0.7, 0.8) },
    uSkyFallback: { value: new THREE.Color(0.4, 0.55, 0.7) },
    uNight: { value: 0 },
    uReflStrength: { value: 1 },
    uHazeNear: { value: 600 },
    uHazeFar: { value: 6000 },
    uMirrorOn: { value: 1 },
    uWPeriod: { value: WATER_PERIOD },
    uNScroll: { value: new THREE.Vector4() }, uNScroll3: { value: new THREE.Vector2() },
    uFoamOff: { value: new THREE.Vector4() }, uDriftOff: { value: new THREE.Vector4() }, uCapOff: { value: new THREE.Vector2() },
  };

  const material = new THREE.ShaderMaterial({
    name: 'IslandWater',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    extensions: { derivatives: true, shaderTextureLOD: true }, // pixel-footprint filtering, blurred mirror (built in on WebGL2)
    transparent: true,
    depthWrite: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  mesh.name = 'water';

  /* ---------------- planar mirror ---------------- */
  // WebGL 1 (the iPad) builds mip levels only for power-of-two targets. The roughness blur reads levels 1.1-3.6, so
  // a 348x261 mirror had none there and the iPad's reflections came out sharp and grainy where they should be soft.
  const pot = n => 2 ** Math.round(Math.log2(n));
  const rtSize = () => {
    const s = env.renderer.getDrawingBufferSize(new THREE.Vector2());
    const k = 0.5 * Math.max(0.55, q);
    const w = Math.max(64, Math.round(s.x * k)), h = Math.max(64, Math.round(s.y * k));
    return env.renderer.capabilities.isWebGL2 ? [w, h] : [pot(w), pot(h)];
  };
  const [rw, rh] = rtSize();
  const rt = new THREE.WebGLRenderTarget(rw, rh, { type: THREE.HalfFloatType, minFilter: THREE.LinearMipmapLinearFilter, generateMipmaps: true });
  uniforms.tMirror.value = rt.texture;
  const mirrorCam = new THREE.PerspectiveCamera();
  mirrorCam.layers.set(0);
  const normal = new THREE.Vector3(0, 1, 0), mirrorPos = new THREE.Vector3();
  const camPos = new THREE.Vector3(), rot = new THREE.Matrix4(), lookAt = new THREE.Vector3();
  const view = new THREE.Vector3(), target = new THREE.Vector3(), plane = new THREE.Plane();
  const clip = new THREE.Vector4(), qv = new THREE.Vector4();
  const texMat = uniforms.uTexMat.value;
  const state = { enabled: true };

  mesh.onBeforeRender = (renderer, scene, cam) => {
    if (cam !== camera || !state.enabled) return;
    camPos.setFromMatrixPosition(cam.matrixWorld);
    view.subVectors(mirrorPos, camPos);
    if (view.dot(normal) > 0) return;
    view.reflect(normal).negate().add(mirrorPos);
    rot.extractRotation(cam.matrixWorld);
    lookAt.set(0, 0, -1).applyMatrix4(rot).add(camPos);
    target.subVectors(mirrorPos, lookAt).reflect(normal).negate().add(mirrorPos);
    mirrorCam.position.copy(view);
    mirrorCam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
    mirrorCam.lookAt(target);
    mirrorCam.far = cam.far;
    mirrorCam.updateMatrixWorld();
    mirrorCam.projectionMatrix.copy(cam.projectionMatrix);
    texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    texMat.multiply(mirrorCam.projectionMatrix).multiply(mirrorCam.matrixWorldInverse);
    plane.setFromNormalAndCoplanarPoint(normal, mirrorPos).applyMatrix4(mirrorCam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const e = mirrorCam.projectionMatrix.elements;
    qv.set((Math.sign(clip.x) + e[8]) / e[0], (Math.sign(clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    clip.multiplyScalar(2 / clip.dot(qv));
    e[2] = clip.x; e[6] = clip.y; e[10] = clip.z + 1.0 - 0.003; e[14] = clip.w;

    const prevRT = renderer.getRenderTarget();
    const prevXR = renderer.xr.enabled, prevShadow = renderer.shadowMap.autoUpdate;
    mesh.visible = false;
    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(rt);
    renderer.state.buffers.depth.setMask(true);
    if (renderer.autoClear === false) renderer.clear();
    renderer.render(scene, mirrorCam);
    mesh.visible = true;
    renderer.xr.enabled = prevXR;
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.setRenderTarget(prevRT);
  };

  // Texture scrolls (the normal map repeats every 1 in uv) and foam drifts (the noise repeats every 1024 cells),
  // wrapped here in double precision: continuous for ever, and always small numbers for the GPU.
  const fr = x => x - Math.floor(x), w1k = x => x - 1024 * Math.floor(x / 1024);
  function setTime(t) {
    uniforms.uNScroll.value.set(fr(t * 0.021), fr(t * 0.013), fr(-t * 0.011), fr(t * 0.016));
    uniforms.uNScroll3.value.set(fr(-t * 0.031), fr(t * 0.027));
    uniforms.uFoamOff.value.set(w1k(t * 0.25), w1k(-t * 0.18), w1k(-t * 0.33), w1k(-t * 0.29));
    uniforms.uDriftOff.value.set(w1k(t * 0.07), w1k(-t * 0.05), w1k(t * 0.35 * 1.6), w1k(t * 0.35 * 3.1));
    uniforms.uCapOff.value.set(w1k(t * 0.4), w1k(-t * 0.5));
  }

  return {
    mesh, material, uniforms, state, setTime,
    resize() { const [w, h] = rtSize(); rt.setSize(w, h); },
    dispose() { rt.dispose(); geo.dispose(); material.dispose(); },
  };
}
