// 深蓝 · 珊瑚礁 — water volume: shared uniforms, GLSL (in-scatter fog, caustics, sway, detail bump),
// material patchers, background dome, the surface seen from below, light shafts, marine snow, bubbles.
import * as THREE from 'three';
import { GLSL, patchMaterial } from '../../lib/util.js';

/* ------------------------------------------------------------------ */
/* Shared uniforms                                                     */
/* ------------------------------------------------------------------ */
export function createWaterUniforms(surfY, refY) {
  return {
    // Wrapped clocks (see setWaterTime): float32 shader time loses precision after hours of uptime,
    // so periodic motion runs on clocks that wrap exactly at a common period of their frequencies.
    // No shader gets the raw, unbounded world time.
    uTimeS: { value: 0 },   // sway, shaft drift, snow wobble, jelly pulse: every frequency a multiple of 0.01 rad/s
    uTimeC: { value: 0 },   // caustics (already scaled by CAUSTIC_SPEED): frequencies multiples of 1/80 rad/s
    uTimeW: { value: 0 },   // surface normal-map scroll and shaft streaks: both repeat every 2000 s
    uTimeHi: { value: 0 },  // world time split as hi + lo (hi a multiple of 1024 s) for linear drifts; the
    uTimeLo: { value: 0 },  // hi part reaches snow and bubbles as exact per-particle offsets (syncHi)
    uSurfY: { value: surfY },
    uRefY: { value: refY },
    uSigma: { value: new THREE.Vector3(0.085, 0.05, 0.042) },  // extinction per metre (r, g, b)
    uKd: { value: new THREE.Vector3(0.065, 0.032, 0.02) },    // downwelling attenuation per metre
    uL0: { value: new THREE.Vector3(0.03, 0.3, 0.4) },         // in-scatter radiance just below the surface
    uSunW: { value: new THREE.Vector3(0, 1, 0) },              // toward the light, underwater (refracted)
    uGlow: { value: new THREE.Vector3(1, 1, 1) },              // forward-scatter glow tint
    uCaustic: { value: 1 },
    uFluor: { value: 0 },
    uCurDir: { value: new THREE.Vector2(0.8, 0.6) },
    uCurStr: { value: 1 },
  };
}

/** Caustic animation speed (1 = the original pace; slower reads as calm water instead of flicker). */
const CAUSTIC_SPEED = 0.6;
const PERIOD_S = 200 * Math.PI, PERIOD_C = 160 * Math.PI, PERIOD_W = 2000;
/** Advance the shared clocks. `time` is the world's unbounded seconds counter (kept in double precision). */
export function setWaterTime(W, time) {
  W.uTimeS.value = time % PERIOD_S;
  W.uTimeC.value = (time * CAUSTIC_SPEED) % PERIOD_C;
  W.uTimeW.value = time % PERIOD_W;
  const hi = Math.floor(time / 1024) * 1024;
  W.uTimeHi.value = hi;
  W.uTimeLo.value = time - hi;
}

const DECL = /* glsl */`
uniform float uTimeS;
uniform float uTimeC;
uniform float uTimeW;
uniform float uTimeHi;
uniform float uTimeLo;
uniform float uSurfY;
uniform float uRefY;
uniform float uCaustic;
uniform float uFluor;
uniform float uCurStr;
uniform vec3 uSigma;
uniform vec3 uKd;
uniform vec3 uL0;
uniform vec3 uSunW;
uniform vec3 uGlow;
uniform vec2 uCurDir;
`;

export const NOISE_GLSL = /* glsl */`
#ifndef REEF_NOISE
#define REEF_NOISE
${GLSL.noise}
${GLSL.caustics}
float vnoise3(vec3 p){
  vec3 i = floor(p), f = fract(p); vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i.xy + i.z * 17.17), b = hash12(i.xy + vec2(1, 0) + i.z * 17.17);
  float c = hash12(i.xy + vec2(0, 1) + i.z * 17.17), d = hash12(i.xy + vec2(1, 1) + i.z * 17.17);
  float e = hash12(i.xy + (i.z + 1.0) * 17.17), f2 = hash12(i.xy + vec2(1, 0) + (i.z + 1.0) * 17.17);
  float g = hash12(i.xy + vec2(0, 1) + (i.z + 1.0) * 17.17), h = hash12(i.xy + vec2(1, 1) + (i.z + 1.0) * 17.17);
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f2, u.x), mix(g, h, u.x), u.y), u.z);
}
vec2 cell2(vec2 p){
  vec2 n = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 o = hash22(n + g);
    vec2 r = g + o - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return vec2(sqrt(d1), sqrt(d2));
}
#endif
`;

/** Vertex-side common: uniforms, world position varying and the current sway. */
export const UW_VERT = /* glsl */`
#ifndef REEF_UWV
#define REEF_UWV
${DECL}
varying vec3 vUwPos;
// Surge sway: plants rock back and forth with the swell, plus a little turbulence.
vec3 reefSway(vec3 o, float h, float amt, float flut, float len){
  float t = uTimeS;
  float ph = dot(o.xz, vec2(0.23, 0.31));
  float surge = sin(t * 0.72 + ph) * 0.72 + sin(t * 1.23 + ph * 1.7 + 1.3) * 0.28;
  vec2 d = uCurDir * (surge + 0.22) * amt * uCurStr * h;
  vec2 pp = vec2(-uCurDir.y, uCurDir.x) * sin(t * 0.97 + ph * 2.3) * 0.3 * amt * uCurStr * h;
  vec3 disp = vec3(d.x + pp.x, 0.0, d.y + pp.y);
  float rp = fract(sin(dot(o, vec3(12.9898, 78.233, 37.719))) * 43758.5453) * 6.2831;
  disp += vec3(sin(t * 2.1 + rp + h * 4.0), 0.3 * sin(t * 1.8 + rp * 1.3), cos(t * 1.9 + rp * 0.7 + h * 3.5)) * flut * h;
  disp.y -= dot(disp.xz, disp.xz) * 0.5 / max(len, 0.05);
  return disp;
}
#endif
`;

/** Fragment-side common: in-scatter fog model shared by every surface and the background. */
export const UW_FRAG = /* glsl */`
#ifndef REEF_UWF
#define REEF_UWF
${DECL}
varying vec3 vUwPos;
// Downwelling in-scatter radiance at height y.
vec3 uwLc(float y){ return uL0 * exp(-uKd * clamp(uSurfY - y, 0.0, 60.0)); }
// Light scattered toward the eye along a ray of length d starting at height y0 in direction dir.
// Closed form of  integral sigma * Lc(y0 + t*dir.y) * exp(-sigma t) dt  so fog and background agree.
vec3 uwScatter(vec3 dir, float y0, float d){
  vec3 a = max(uSigma - uKd * dir.y, vec3(0.004));
  vec3 s = uSigma * uwLc(y0) * (1.0 - exp(-a * d)) / a;
  float mu = max(dot(dir, uSunW), 0.0);
  float ph = 0.4 * mu * mu * mu + 1.2 * pow(mu, 18.0) + 2.5 * pow(mu, 90.0);
  return s * (1.0 + ph * uGlow);
}
// A few metres of clear water in front of the lens keep near colours vivid (stylised, like ABZU).
#define UW_CLEAR 3.5
vec3 uwFog(vec3 col, vec3 wp){
  vec3 v = wp - cameraPosition; float d = length(v);
  vec3 dir = v / max(d, 1e-4);
  float de = max(d - UW_CLEAR, 0.0);
  return col * exp(-uSigma * de) + uwScatter(dir, cameraPosition.y, de);
}
vec3 uwAtten(vec3 col, vec3 wp){ return col * exp(-uSigma * max(length(wp - cameraPosition) - UW_CLEAR, 0.0)); }
// Light reaching a surface at height y relative to the reference depth the lights are tuned for.
vec3 uwTint(float y){ return clamp(exp(uKd * (y - uRefY)), vec3(0.35), vec3(1.7)); }
#endif
`;

const CAUSTIC_GLSL = /* glsl */`
#ifndef REEF_CAUS
#define REEF_CAUS
// The caustic web of lib caustics(), pre-filtered for the pixel footprint fw (in cells): where a
// pixel spans more than a line width (distance, grazing sand) the thin lines used to crawl and sparkle;
// each line profile is now widened by the footprint with its energy kept, so far away the web turns
// soft and calm instead of aliasing. Identical to caustics() when fw -> 0.
float uwCausticsAA(vec2 p, float t, float fw){
  // box-filter width in edge-distance units, tuned against a supersampled reference
  float w1 = 1.3 * fw, w2 = 1.78 * fw;
  float k1 = 1.0 / (1.0 / 55.0 + w1 * w1 / 6.0), k2 = 1.0 / (1.0 / 70.0 + w2 * w2 / 6.0);
  float e1 = causticEdge(p, t * 0.9);
  float e2 = causticEdge(p * 1.37 + vec2(3.1, 1.7), t * 1.15 + 2.0);
  float c = exp(-e1 * e1 * k1) * 0.75 * sqrt(k1 / 55.0) + exp(-e2 * e2 * k2) * 0.55 * sqrt(k2 / 70.0);
  c += min(0.2 * fw * fw + 0.03 * fw, 0.12);   // wide lines overlap their cell: keep the mean light
  return mix(c, 0.356, smoothstep(0.6, 1.2, fw));
}
float uwCaustics(vec3 wp){
  vec2 p = wp.xz - uSunW.xz / max(uSunW.y, 0.35) * (wp.y - uRefY);
  p += 0.25 * vec2(sin(p.y * 0.6 + uTimeC * 0.5), cos(p.x * 0.5 - uTimeC * 0.4));
  vec2 q = p * 0.62;
  float c = uwCausticsAA(q, uTimeC * 1.25, length(fwidth(q)));
  return c * exp(-0.03 * clamp(uSurfY - wp.y, 0.0, 60.0));
}
#endif
`;

// Caustics modulate the sun light around its old average (x1.43) with a softer swing than before
// (0.82..3.0 instead of 0.68..3.4), so the floor shimmers instead of strobing.
const LIGHTS_CAUSTIC = THREE.ShaderChunk.lights_fragment_begin
  .replace('IncidentLight directLight;', 'IncidentLight directLight;\nfloat uwCm = 1.0 + uCaustic * (uwCaustics(vUwPos) * 1.7 - 0.18);')
  .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= uwCm;');

// Soft limit for direct specular highlights (knee 3, ceiling 6). Glossy fish, clam mantles and eyes
// under the caustic-boosted sun produced single-pixel glints worth 100+ that bloom turned into
// blinking blobs; everything below the knee is untouched.
const SPEC_CLAMP = /* glsl */`
#if defined( RE_Direct ) && ( defined( STANDARD ) || defined( PHYSICAL ) )
{
  float uwM = max(max(reflectedLight.directSpecular.r, reflectedLight.directSpecular.g), reflectedLight.directSpecular.b);
  if (uwM > 3.0) reflectedLight.directSpecular *= (3.0 + (uwM - 3.0) / (1.0 + (uwM - 3.0) / 3.0)) / uwM;
  #ifdef USE_CLEARCOAT
  float uwC = max(max(clearcoatSpecularDirect.r, clearcoatSpecularDirect.g), clearcoatSpecularDirect.b);
  if (uwC > 3.0) clearcoatSpecularDirect *= (3.0 + (uwC - 3.0) / (1.0 + (uwC - 3.0) / 3.0)) / uwC;
  #endif
}
#endif
`;

const WPOS_FROM_MV = 'vUwPos = transposeMat3(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);';

/**
 * Underwater look for a built-in material: depth-tinted light, caustics on the sun light and the
 * in-scatter fog. fog: 'full' | 'atten' (additive things) | 'none'.
 */
export function waterize(mat, W, { caustics = true, fog = 'full', tint = true, rim = 0, key = '' } = {}) {
  const frag = {};
  if (caustics) frag['#include <lights_fragment_begin>'] = LIGHTS_CAUSTIC;
  frag['#include <lights_fragment_end>'] = '$&\n' + SPEC_CLAMP;
  // rim: light scattered around silhouettes, so creatures read against the bright water
  const rimCode = rim > 0 ? 'outgoingLight += uwLc(vUwPos.y) * uRim * pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);\n' : '';
  if (tint || rim > 0) frag['#include <opaque_fragment>'] = (tint ? 'outgoingLight *= uwTint(vUwPos.y);\n' : '') + rimCode + '$&';
  frag['#include <fog_fragment>'] = fog === 'full' ? 'gl_FragColor.rgb = uwFog(gl_FragColor.rgb, vUwPos);'
    : fog === 'atten' ? 'gl_FragColor.rgb = uwAtten(gl_FragColor.rgb, vUwPos);' : '';
  return patchMaterial(mat, {
    key: `uw${caustics ? 1 : 0}${fog}${tint ? 1 : 0}${rim > 0 ? 'r' : ''}${key}sc`,
    uniforms: rim > 0 ? { ...W, uRim: { value: rim } } : W,
    vertexHeader: UW_VERT,
    fragmentHeader: UW_FRAG + (rim > 0 ? 'uniform float uRim;\n' : '') + (caustics ? NOISE_GLSL + CAUSTIC_GLSL : ''),
    vertex: { '#include <fog_vertex>': '$&\n' + WPOS_FROM_MV },
    fragment: frag,
  });
}

const PERTURB = /* glsl */`
#ifndef REEF_PERTURB
#define REEF_PERTURB
vec3 gWN = vec3(0.0, 1.0, 0.0);   // world normal of the fragment, set before detailH()
vec3 cellid(vec2 p){
  vec2 n = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 o = hash22(n + g);
    vec2 r = g + o - f; float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; id = n + g; } else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), hash12(id + 0.37));
}
// Mikkelsen bump with unnormalised screen derivatives: h in metres gives true geometric slope.
// Edge-on and silhouette pixels drive det toward 0, where the old form flipped the normal at random
// (sparkling speckles) or normalised a zero vector (NaN): the tilt is capped at ~56 degrees and a
// degenerate result falls back to the surface normal.
vec3 reefPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir){
  vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos);
  vec3 R1 = cross(sy, surf_norm), R2 = cross(surf_norm, sx);
  float det = dot(sx, R1) * faceDir;
  float ad = abs(det);
  vec3 g = (det < 0.0 ? -1.0 : 1.0) * (dHdxy.x * R1 + dHdxy.y * R2);
  float gl = length(g);
  if (gl > 1.5 * ad) g *= 1.5 * ad / gl;
  vec3 n = ad * surf_norm - g;
  float l2 = dot(n, n);
  return l2 > 1e-30 ? n * inversesqrt(l2) : surf_norm;
}
#endif
`;

/**
 * Procedural surface detail. `glsl` must define
 *   float detailH(vec3 p)                       height in metres (scaled by bump)
 *   vec3 detailCol(vec3 p, float h, vec3 c)     albedo modulation
 * space: 'world' (static things) or 'object' (instanced / moving things; per-instance offset).
 */
/** Procedural detail is the heaviest per-pixel cost; the low quality tier turns it off. */
export const DETAIL = { on: true };
export function addDetail(mat, W, { glsl, space = 'world', bump = 1, key = 'd', uniforms = {} }) {
  if (!DETAIL.on) return mat;
  const vtx = space === 'object'
    ? { '#include <begin_vertex>': '$&\nvDetP = transformed;\n#ifdef USE_INSTANCING\nvDetP += instanceMatrix[3].xyz * 0.618;\n#endif' }
    : { '#include <fog_vertex>': '$&\nvDetP = transposeMat3(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);' };
  return patchMaterial(mat, {
    key: 'det' + key + space,
    uniforms: { ...W, uBump: { value: bump }, ...uniforms },
    vertexHeader: UW_VERT + 'varying vec3 vDetP;',
    fragmentHeader: UW_FRAG + NOISE_GLSL + PERTURB + 'varying vec3 vDetP;\nuniform float uBump;\n' + glsl,
    vertex: vtx,
    fragment: {
      '#include <color_fragment>': '$&\n#ifndef FLAT_SHADED\ngWN = inverseTransformDirection(normalize(vNormal), viewMatrix);\n#endif\nfloat detH = detailH(vDetP);\ndiffuseColor.rgb = detailCol(vDetP, detH, diffuseColor.rgb);',
      '#include <normal_fragment_maps>': '$&\nnormal = reefPerturb(-vViewPosition, normal, vec2(dFdx(detH), dFdy(detH)) * uBump, faceDirection);',
    },
  });
}

/**
 * Night fluorescence: per-vertex amount (attribute aFluor) times a material colour times uFluor. Each
 * colony breathes slowly on its own phase (from where it stands): about +-25 % over 15 and 27 s, so the
 * reef's glow lives without anything flashing or pulsing in step.
 */
export function addFluor(mat, W, color, strength = 1, key = 'f') {
  const u = { uFluorCol: { value: new THREE.Color(color).multiplyScalar(strength) } };
  mat.userData.fluorCol = u.uFluorCol;
  return patchMaterial(mat, {
    key: 'fl' + key,
    uniforms: { ...W, ...u },
    vertexHeader: UW_VERT + 'attribute float aFluor; varying float vFluor;',
    fragmentHeader: UW_FRAG + 'varying float vFluor; uniform vec3 uFluorCol;',
    vertex: { '#include <begin_vertex>': /* glsl */`$&
      {
        vec3 flO = modelMatrix[3].xyz;
        #ifdef USE_INSTANCING
          flO += instanceMatrix[3].xyz;
        #endif
        float flP = dot(flO, vec3(0.73, 0.21, 1.13));
        vFluor = aFluor * (1.0 + 0.25 * (0.62 * sin(uTimeS * 0.42 + flP) + 0.38 * sin(uTimeS * 0.23 + flP * 1.7)));
      }` },
    fragment: { '#include <emissivemap_fragment>': '$&\ntotalEmissiveRadiance += uFluorCol * vFluor * uFluor;' },
  });
}

/**
 * Sway soft things in the surge. Height factor = (hExpr / height)^stiff where hExpr defaults to
 * object-space position.y. Works with InstancedMesh (displacement in world space, model matrix
 * assumed translation-only).
 */
export function addSway(mat, W, { height = 1, amount = 0.15, stiff = 1.6, flutter = 0, hExpr = 'position.y', key = 's' } = {}) {
  return patchMaterial(mat, {
    key: 'sway' + key + hExpr,
    uniforms: { ...W, uSwH: { value: height }, uSwAmt: { value: amount }, uSwStiff: { value: stiff }, uSwFlut: { value: flutter } },
    vertexHeader: UW_VERT + 'uniform float uSwH, uSwAmt, uSwStiff, uSwFlut;',
    vertex: {
      '#include <project_vertex>': /* glsl */`
        vec4 mvPosition = vec4(transformed, 1.0);
        vec3 swO = vec3(0.0);
        #ifdef USE_INSTANCING
          mvPosition = instanceMatrix * mvPosition;
          swO = instanceMatrix[3].xyz;
        #endif
        swO += modelMatrix[3].xyz;
        float swH = pow(clamp((${hExpr}) / uSwH, 0.0, 1.5), uSwStiff);
        mvPosition.xyz += reefSway(swO, swH, uSwAmt, uSwFlut, uSwH);
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;
      `,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Background dome                                                     */
/* ------------------------------------------------------------------ */
export function createBackground(W) {
  const mat = new THREE.ShaderMaterial({
    uniforms: W,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    vertexShader: UW_VERT + /* glsl */`
      varying vec3 vDir;
      void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: UW_FRAG + NOISE_GLSL + /* glsl */`
      varying vec3 vDir;
      void main(){
        vec3 dir = normalize(vDir);
        vec3 col = uwScatter(dir, cameraPosition.y, 2000.0);
        col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0 * col * 3.0;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(150, 48, 24), mat);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Water surface seen from below (Snell's window)                      */
/* ------------------------------------------------------------------ */
export function createSurface(W, n1, n2) {
  const u = {
    ...W,
    tN1: { value: n1 }, tN2: { value: n2 },
    uSunAir: { value: new THREE.Vector3(0, 1, 0) },
    uSunCol: { value: new THREE.Color(1, 1, 1) },
    uSkyZen: { value: new THREE.Color(0.2, 0.4, 0.8) },
    uSkyHor: { value: new THREE.Color(0.6, 0.7, 0.8) },
    uSkyGain: { value: 1 },
    uSunI: { value: 1 },
    uRipple: { value: 0.32 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: UW_VERT + /* glsl */`
      varying vec3 vWp;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWp = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: UW_FRAG + NOISE_GLSL + /* glsl */`
      uniform sampler2D tN1, tN2;
      uniform vec3 uSunAir, uSunCol, uSkyZen, uSkyHor;
      uniform float uSkyGain, uSunI, uRipple;
      varying vec3 vWp;
      void main(){
        vec3 v = vWp - cameraPosition; float d = length(v); vec3 dir = v / d;
        vec2 p = vWp.xz;
        vec3 a = texture2D(tN1, p * 0.035 + uTimeW * vec2(0.011, 0.006)).xyz * 2.0 - 1.0;
        vec3 b = texture2D(tN2, p * 0.061 + uTimeW * vec2(-0.008, 0.012)).xyz * 2.0 - 1.0;
        vec3 c = texture2D(tN1, p * 0.013 - uTimeW * vec2(0.004, 0.0065)).xyz * 2.0 - 1.0;
        vec2 nxy = (a.xy + b.xy * 0.8 + c.xy * 1.2) * uRipple / (1.0 + d * 0.012);
        vec3 N = normalize(vec3(nxy.x, -1.0, nxy.y));
        vec3 R = refract(dir, N, 1.333);
        vec3 refl = reflect(dir, N);
        // mirror of the bright water just under the surface (total internal reflection)
        vec3 under = uwScatter(refl, uSurfY - 0.5, 400.0);
        vec3 col = under;
        if (dot(R, R) > 1e-5) {
          float ct = clamp(R.y, 0.0, 1.0);
          float F = 0.02 + 0.98 * pow(1.0 - ct, 5.0);
          vec3 sky = mix(uSkyHor, uSkyZen, pow(ct, 0.5));
          float sd = max(dot(R, uSunAir), 0.0);
          sky += uSunCol * uSunI * (pow(sd, 1200.0) * 90.0 + pow(sd, 90.0) * 3.0 + pow(sd, 8.0) * 0.35);
          col = mix(sky * uSkyGain, under, F);
        }
        // bright filaments where the ripples focus light (seen from below)
        float foc = smoothstep(0.35, 1.0, length(nxy) / max(uRipple, 1e-3) * 0.55);
        col += uwLc(uSurfY) * foc * 0.6;
        col = uwFog(col, vWp);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(700, 700, 1, 1), mat);
  mesh.rotation.x = Math.PI / 2;
  mesh.frustumCulled = false;
  mesh.renderOrder = -50;
  mesh.userData.u = u;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Light shafts: camera-facing ribbons along the refracted light       */
/* ------------------------------------------------------------------ */
export function createShafts(W, rng, { count = 32, radius = 26, center = new THREE.Vector3(), far = 0, farR = [34, 58], frng = null } = {}) {
  const pos = [], aC = [], aP = [], idx = [];
  for (let i = 0; i < count; i++) {
    const a = rng.range(0, Math.PI * 2), r = radius * Math.sqrt(rng.next());
    const wide = rng.chance(0.25);
    const cx = center.x + Math.cos(a) * r, cz = center.z + Math.sin(a) * r;
    const base = pos.length / 3;
    for (const [x, y] of [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]]) {
      pos.push(x, y, 0);
      aC.push(cx, 0, cz);
      aP.push(wide ? rng.range(2.2, 4.2) : rng.range(0.5, 1.6), rng.next(), wide ? rng.range(0.35, 0.6) : rng.range(0.5, 1.0), 1);
    }
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  // Far layer: broad cathedral shafts out in the blue, spread round the reef (own random stream, so the
  // near shafts above keep their places). Brighter at the source: the water between them and the eye
  // dims them into soft, wide columns, a second depth layer behind the reef's crisp near shafts.
  for (let k = 0; k < far; k++) {
    const a = (k / far) * Math.PI * 2 + frng.range(-0.3, 0.3), r = frng.range(farR[0], farR[1]);
    const cx = center.x + Math.cos(a) * r, cz = center.z + Math.sin(a) * r;
    const w = frng.range(4.5, 7.5), ph = frng.next(), I = frng.range(2.2, 3.2);
    const base = pos.length / 3;
    for (const [x, y] of [[-0.5, 0], [0.5, 0], [-0.5, 1], [0.5, 1]]) {
      pos.push(x, y, 0);
      aC.push(cx, 0, cz);
      aP.push(w, ph, I, 1);
    }
    idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  count += far;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aC', new THREE.Float32BufferAttribute(aC, 3));
  g.setAttribute('aP', new THREE.Float32BufferAttribute(aP, 4));
  g.setIndex(idx);
  const u = { ...W, uAxis: { value: new THREE.Vector3(0, -1, 0) }, uShaftCol: { value: new THREE.Color(1, 1, 1) }, uShaftI: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: UW_VERT + /* glsl */`
      attribute vec3 aC; attribute vec4 aP;
      uniform vec3 uAxis;
      varying vec2 vUv; varying float vI, vPh, vFace; varying vec3 vWp;
      void main(){
        vec3 top = vec3(aC.x, uSurfY, aC.z);
        top.xz += vec2(sin(uTimeS * 0.05 + aP.y * 6.28), cos(uTimeS * 0.04 + aP.y * 4.0)) * 1.6;
        float len = aC.y;
        vec3 mid = top + uAxis * len * 0.5;
        vec3 side = normalize(cross(uAxis, cameraPosition - mid));
        float w = aP.x * (0.7 + position.y * 0.8);
        vec3 p = top + uAxis * (position.y * len) + side * (position.x * w);
        vec3 nrm = normalize(cross(side, uAxis));
        vFace = abs(dot(normalize(cameraPosition - p), nrm));
        vUv = position.xy; vI = aP.z; vPh = aP.y; vWp = p;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: UW_FRAG + NOISE_GLSL + /* glsl */`
      uniform vec3 uShaftCol; uniform float uShaftI;
      varying vec2 vUv; varying float vI, vPh, vFace; varying vec3 vWp;
      // Value noise whose lattice repeats every 100 cells along y. The streaks scroll 0.05 cells/s on
      // the 2000-s clock (= 100 cells per wrap), so the wrap is seamless and the scroll never runs on raw,
      // ever-growing float32 time (which made the streaks step after many hours). Cell indices are
      // wrapped with +0.5 so the float mod lands on exact integers.
      float vnoiseWrapY(vec2 p){
        vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        float y0 = floor(mod(i.y + 0.5, 100.0)), y1 = floor(mod(i.y + 1.5, 100.0));
        return mix(mix(hash12(vec2(i.x, y0)), hash12(vec2(i.x + 1.0, y0)), u.x),
                   mix(hash12(vec2(i.x, y1)), hash12(vec2(i.x + 1.0, y1)), u.x), u.y);
      }
      void main(){
        float x = vUv.x * 2.0;
        float prof = exp(-x * x * 2.6) - 0.074;
        float st = vnoiseWrapY(vec2(vUv.x * 5.0 + vPh * 40.0, vUv.y * 0.6 - uTimeW * 0.05 + vPh * 9.0));
        st = 0.35 + 0.9 * st * st;
        float t = vUv.y;
        float vf = smoothstep(0.0, 0.12, t) * pow(max(1.0 - t, 0.0), 1.7);
        float flick = 0.6 + 0.4 * sin(uTimeS * 0.53 + vPh * 31.0) * sin(uTimeS * 0.31 + vPh * 17.0);
        float d = length(vWp - cameraPosition);
        float nearF = smoothstep(2.0, 9.0, d);
        float face = smoothstep(0.05, 0.6, vFace);
        float a = max(prof, 0.0) * st * vf * flick * nearF * face * vI * uShaftI;
        vec3 col = uShaftCol * a;
        gl_FragColor = vec4(uwAtten(col, vWp), 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  /**
   * Set each shaft's length so it fades out above the ground under its lower end. The crossing is
   * refined by bisection (the old 0.5 m march made lengths jump as the light turned), and lengths
   * ease toward their targets in tick() so a shaft that starts to miss a rock grows instead of popping.
   */
  const lenT = new Float32Array(count).fill(-1), lenC = new Float32Array(count).fill(-1);
  const lenAxis = new THREE.Vector3(0, 0, 0);
  const setLengths = (axis, groundAt, snap = false) => {
    // the clock glides, so this is asked several times a minute: skip turns under ~0.2 degrees
    if (!snap && lenAxis.dot(axis) > 0.999994) return;
    lenAxis.copy(axis);
    const c = g.getAttribute('aC');
    const sy = W.uSurfY.value;
    for (let i = 0; i < count; i++) {
      const x = c.getX(i * 4), z = c.getZ(i * 4);
      const below = s => sy + axis.y * s < groundAt(x + axis.x * s, z + axis.z * s) + 1.2;
      let len = 39.5;
      for (let s = 2; s < 40; s += 0.5) {
        if (!below(s)) continue;
        len = s;
        if (s > 2) {
          let lo = s - 0.5, hi = s;
          for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (below(m)) hi = m; else lo = m; }
          len = (lo + hi) / 2;
        }
        break;
      }
      lenT[i] = len * 1.05;
      if (snap || lenC[i] < 0) lenC[i] = lenT[i];
    }
    write();
  };
  const write = () => {
    const c = g.getAttribute('aC');
    for (let i = 0; i < count; i++) for (let k = 0; k < 4; k++) c.setY(i * 4 + k, lenC[i]);
    c.needsUpdate = true;
  };
  const tick = dt => {
    const k = 1 - Math.exp(-dt / 1.5);
    let moved = false;
    for (let i = 0; i < count; i++) {
      const d = lenT[i] - lenC[i];
      if (Math.abs(d) < 1e-3) { if (d !== 0) { lenC[i] = lenT[i]; moved = true; } continue; }
      lenC[i] += d * k; moved = true;
    }
    if (moved) write();
  };
  return { mesh, u, setLengths, tick };
}

/* ------------------------------------------------------------------ */
/* Marine snow / plankton (wrapped around the camera)                  */
/* ------------------------------------------------------------------ */
export function createSnow(W, rng, { count = 1500, box = 26 } = {}) {
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seeds[i] = rng.next();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  // drift * hi (mod box) per particle, in double precision (see syncHi)
  const hiOff = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  hiOff.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aHi', hiOff);
  const u = { ...W, uBox: { value: box }, uScale: { value: 800 }, uSnowI: { value: 1 }, uBio: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: UW_VERT + /* glsl */`
      attribute vec4 aSeed;
      attribute vec3 aHi;
      uniform float uBox, uScale, uBio;
      varying float vA, vTw, vBio; varying vec3 vWp;
      void main(){
        float s = aSeed.w;
        vec3 drift = vec3(0.06, -0.035 - s * 0.03, 0.045) * (0.4 + s);
        // aHi = drift * hi (mod box), exact at any uptime; float32 drift * uTimeHi lost millimetres
        // per 1024-s step after days, which made the specks hop
        vec3 p = aSeed.xyz * uBox + aHi + drift * uTimeLo;
        p += 0.35 * vec3(sin(uTimeS * 0.31 + s * 40.0), sin(uTimeS * 0.23 + s * 23.0), cos(uTimeS * 0.27 + s * 31.0));
        vec3 c = cameraPosition - uBox * 0.5;
        p = c + mod(p - c, uBox);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        float size = 0.022 + s * s * 0.06;
        // Sprites under ~3 px alias: a drifting speck pulses in brightness and hops between pixels
        // (twinkling noise, worst without MSAA). Draw at least 3 px, dimmed by the area ratio.
        float px = size * uScale / max(dist, 0.1);
        float ps = clamp(px, 3.0, 28.0);
        gl_PointSize = ps;
        float edge = 1.0 - smoothstep(uBox * 0.32, uBox * 0.5, length(p - cameraPosition));
        vA = edge * smoothstep(0.4, 1.6, dist) * step(p.y, uSurfY - 0.1) * max(px * px / (ps * ps), 0.12);
        // sparse bioluminescent specks at night that breathe, a soft swell over a few seconds (they were
        // sharp 0.3-s twinkles); rates are whole multiples of 0.01 rad/s, so the wrapped clock stays seamless
        float bio = step(0.82, fract(s * 13.7));
        float twf = floor((0.3 + s * 0.7) * 100.0 + 0.5) * 0.01;
        vTw = pow(0.5 + 0.5 * sin(uTimeS * twf + s * 70.0), 6.0) * bio;
        vBio = bio;
        vWp = p;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: UW_FRAG + /* glsl */`
      uniform float uSnowI, uBio;
      varying float vA, vTw, vBio; varying vec3 vWp;
      void main(){
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r = dot(c, c);
        if (r > 1.0) discard;
        float a = exp(-r * 3.5) * vA;
        vec3 lit = uwLc(vWp.y) * 3.2 * uSnowI + vec3(0.55, 0.65, 0.6) * uSnowI * 0.08;
        // night: twinkles plus a faint steady glow of the luminous plankton (steady, so no flicker)
        vec3 glow = vec3(0.25, 0.95, 1.3) * vTw * uBio * 2.6 + vec3(0.1, 0.5, 0.8) * vBio * uBio * 0.13;
        vec3 col = (lit + glow) * a;
        gl_FragColor = vec4(uwAtten(col, vWp), 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  let hiLast = 0;
  /** Call every frame with W.uTimeHi.value: refreshes the per-particle drift offsets when it steps. */
  const syncHi = hi => {
    if (hi === hiLast) return;
    hiLast = hi;
    const a = hiOff.array;
    for (let i = 0; i < count; i++) {
      const s = seeds[i * 4 + 3], k = 0.4 + s;
      const d = [0.06 * k, (-0.035 - s * 0.03) * k, 0.045 * k];
      for (let c = 0; c < 3; c++) a[i * 3 + c] = (((d[c] * hi) % box) + box) % box;
    }
    hiOff.needsUpdate = true;
  };
  return { mesh: pts, u, syncHi };
}

/* ------------------------------------------------------------------ */
/* Bioluminescent plankton (night)                                     */
/* ------------------------------------------------------------------ */
/**
 * Glowing motes hanging in the water column at night, drifting with the current round the camera (the
 * snow's wrap-around box). Each breathes on its own slow cycle (7–25 s, a soft swell, never a flash).
 * Where the whale shark pushes through them they brighten round its body and in its wake, a glow that
 * builds over a second or two and fades back over the ~8 m behind it. Sized from the drawing buffer;
 * under 3 px a mote keeps 3 px and dims with its area instead of shrinking into twinkling aliasing.
 */
export function createGlow(W, rng, { count = 500, box = 22 } = {}) {
  const seeds = new Float32Array(count * 4), glow = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 4; k++) seeds[i * 4 + k] = rng.next();
    // breathing rate (whole 0.01 rad/s, so the wrapped clock stays seamless), phase, size (m), hue
    glow[i * 4] = Math.round(rng.range(0.25, 0.85) * 100) / 100;
    glow[i * 4 + 1] = rng.range(0, Math.PI * 2);
    glow[i * 4 + 2] = rng.range(0.03, 0.07);
    glow[i * 4 + 3] = rng.next();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  g.setAttribute('aGlow', new THREE.BufferAttribute(glow, 4));
  const hiOff = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  hiOff.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aHi', hiOff);
  // the wrap-around box sits mostly in front of the camera (uBoxC, set each frame), where the motes are seen
  const u = { ...W, uBox: { value: box }, uBoxC: { value: new THREE.Vector3() }, uScale: { value: 800 }, uBio: { value: 0 },
    uGiantA: { value: new THREE.Vector4(0, -999, 0, 0) }, uGiantB: { value: new THREE.Vector4(0, -999, 0, 1) } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: UW_VERT + /* glsl */`
      attribute vec4 aSeed, aGlow;
      attribute vec3 aHi;
      uniform float uBox, uScale, uBio;
      uniform vec3 uBoxC;
      uniform vec4 uGiantA, uGiantB;   // tail (xyz, on), snout (xyz, body radius)
      varying float vA, vHue; varying vec3 vWp;
      void main(){
        float s = aSeed.w;
        vec3 drift = vec3(0.045, 0.01, 0.032) * (0.5 + s);
        vec3 p = aSeed.xyz * uBox + aHi + drift * uTimeLo;
        p += 0.3 * vec3(sin(uTimeS * 0.21 + s * 40.0), sin(uTimeS * 0.17 + s * 23.0), cos(uTimeS * 0.19 + s * 31.0));
        vec3 c = uBoxC - uBox * 0.5;
        p = c + mod(p - c, uBox);
        // fade near the box faces, so motes that wrap (or that the box leaves as the view turns) ease out
        vec3 bq = abs(p - uBoxC) / (uBox * 0.5);
        float edge = 1.0 - smoothstep(0.72, 0.98, max(bq.x, max(bq.y, bq.z)));
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        float b = 0.5 + 0.5 * sin(uTimeS * aGlow.x + aGlow.y);
        b = b * b;
        // the whale shark stirs them: brighter round its body and along a fading wake behind it
        vec3 ab = uGiantB.xyz - uGiantA.xyz; float L = max(length(ab), 1e-3); vec3 f = ab / L;
        vec3 ap = p - uGiantA.xyz; float t = dot(ap, f);
        float d = length(ap - f * clamp(t, -8.0, L + 1.0));
        float wake = t < 0.0 ? clamp(1.0 + t / 8.0, 0.0, 1.0) : 1.0;
        float R = uGiantB.w * (t < 0.0 ? 0.9 - t * 0.1 : 1.0) + 1.3;
        float stir = (1.0 - smoothstep(R * 0.5, R, d)) * wake * uGiantA.w;
        float px = aGlow.z * (1.0 + stir * 0.6) * uScale / max(dist, 0.1);
        float ps = clamp(px, 3.0, 22.0);
        gl_PointSize = ps;
        vA = edge * smoothstep(0.5, 2.0, dist) * step(p.y, uSurfY - 0.4) * min(px * px / (ps * ps), 1.0)
           * uBio * (0.18 + 1.1 * b + 2.6 * stir);
        vHue = aGlow.w + stir;
        vWp = p;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: UW_FRAG + /* glsl */`
      varying float vA, vHue; varying vec3 vWp;
      void main(){
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r = dot(c, c);
        if (r > 1.0 || vA < 0.002) discard;
        float a = (exp(-r * 6.0) + exp(-r * 2.2) * 0.25) * vA;
        // mostly blue-cyan dinoflagellate light, a few greener motes
        vec3 col = mix(vec3(0.16, 0.6, 1.25), vec3(0.22, 1.1, 0.72), step(0.78, fract(vHue)));
        gl_FragColor = vec4(uwAtten(col * a, vWp), 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  let hiLast = 0;
  /** Call every frame with W.uTimeHi.value: refreshes the per-mote drift offsets when it steps. */
  const syncHi = hi => {
    if (hi === hiLast) return;
    hiLast = hi;
    const a = hiOff.array;
    for (let i = 0; i < count; i++) {
      const k = 0.5 + seeds[i * 4 + 3];
      const d = [0.045 * k, 0.01 * k, 0.032 * k];
      for (let c = 0; c < 3; c++) a[i * 3 + c] = (((d[c] * hi) % box) + box) % box;
    }
    hiOff.needsUpdate = true;
  };
  return { mesh: pts, u, syncHi };
}

/* ------------------------------------------------------------------ */
/* Bubble streams                                                      */
/* ------------------------------------------------------------------ */
export function createBubbles(W, rng, emitters, perEmitter = 36) {
  const n = emitters.length * perEmitter;
  const base = new Float32Array(n * 3), seed = new Float32Array(n * 4);
  let k = 0;
  for (const e of emitters) {
    let tBurst = 0;
    for (let i = 0; i < perEmitter; i++, k++) {
      base[k * 3] = e.x; base[k * 3 + 1] = e.y; base[k * 3 + 2] = e.z;
      if (i % 5 === 0) tBurst = rng.next();
      seed[k * 4] = (tBurst + rng.range(0, 0.035)) % 1; // bursts of bubbles rising together
      seed[k * 4 + 1] = rng.next();
      seed[k * 4 + 2] = rng.range(0.75, 1.25);
      seed[k * 4 + 3] = rng.next();
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(base, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  // hi * speed (mod cycle) per bubble, in double precision (see syncHi)
  const hiOff = new THREE.BufferAttribute(new Float32Array(n), 1);
  hiOff.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aHi', hiOff);
  const u = { ...W, uScale: { value: 800 }, uBubI: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: UW_VERT + /* glsl */`
      attribute vec4 aSeed;
      attribute float aHi;
      uniform float uScale;
      varying float vA, vSmall; varying vec3 vWp;
      void main(){
        float H = max(uSurfY - position.y, 1.0);
        float spd = 0.55 * aSeed.z;
        float cyc = H * 1.6;
        // aHi = uTimeHi * spd (mod cyc), exact at any uptime (see syncHi)
        float h = mod(aHi + uTimeLo * spd + aSeed.x * cyc, cyc);
        vec3 p = position;
        float wob = 0.03 + h * 0.012;
        // wobble keyed to the height risen (same 7 and 6.3 rad/s at 0.55 m/s), precise at any uptime
        p += vec3(sin(h * 12.73 + aSeed.y * 40.0) * wob, h, cos(h * 11.45 + aSeed.w * 40.0) * wob);
        p.xz += vec2(0.18, 0.1) * h * h * 0.02;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float r = (0.012 + aSeed.w * 0.02) * (1.0 + h * 0.06);
        float px = r * 2.0 * uScale / max(-mv.z, 0.1);
        float ps = clamp(px, 3.0, 40.0);
        gl_PointSize = ps;
        vSmall = 1.0 - smoothstep(3.0, 7.0, px);
        // fade out just under the surface instead of vanishing in one frame
        vA = (1.0 - smoothstep(H - 0.6, H - 0.15, h)) * smoothstep(0.0, 0.2, h) * max(px * px / (ps * ps), 0.12);
        vWp = p;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: UW_FRAG + /* glsl */`
      uniform float uBubI;
      varying float vA, vSmall; varying vec3 vWp;
      void main(){
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r = length(c);
        if (r > 1.0 || vA < 0.01) discard;
        float rim = smoothstep(0.55, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
        float hl = smoothstep(0.38, 0.0, length(c - vec2(-0.3, -0.35)));
        vec3 lc = uwLc(vWp.y);
        vec3 col = (lc * 2.5 + vec3(0.15)) * (rim * 0.9 + 0.06) + (lc * 3.0 + vec3(0.6)) * hl * 0.9;
        // a bubble a few pixels wide cannot show rim and highlight without sparkling: draw a soft dot
        // with the same average light instead
        vec3 dotc = ((lc * 2.5 + vec3(0.15)) * 1.434 + (lc * 3.0 + vec3(0.6)) * 0.141) * exp(-r * r * 3.5);
        col = mix(col, dotc, vSmall);
        gl_FragColor = vec4(uwAtten(col * vA * uBubI, vWp), 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 7;
  let hiLast = 0;
  const surfY = W.uSurfY.value;
  /** Call every frame with W.uTimeHi.value: refreshes the per-bubble rise offsets when it steps. */
  const syncHi = hi => {
    if (hi === hiLast) return;
    hiLast = hi;
    const a = hiOff.array;
    for (let i = 0; i < n; i++) {
      const spd = 0.55 * seed[i * 4 + 2], cyc = Math.max(surfY - base[i * 3 + 1], 1) * 1.6;
      a[i] = (hi * spd) % cyc;
    }
    hiOff.needsUpdate = true;
  };
  return { mesh: pts, u, syncHi };
}

/* ------------------------------------------------------------------ */
/* Environment map (reflections on fish scales, wet rock)              */
/* ------------------------------------------------------------------ */
export function createEnvBuilder(pmrem, W) {
  const u = { ...W, uEnvY: { value: 4 }, uWin: { value: new THREE.Color(1, 1, 1) } };
  const scene = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: UW_VERT + 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: UW_FRAG + /* glsl */`
      uniform float uEnvY; uniform vec3 uWin;
      varying vec3 vDir;
      void main(){
        vec3 dir = normalize(vDir);
        vec3 col = uwScatter(dir, uEnvY, 2000.0);
        col += uWin * smoothstep(0.55, 0.8, dir.y);
        col += vec3(0.5, 0.45, 0.35) * uwLc(uEnvY) * smoothstep(-0.2, -0.6, dir.y) * 0.5;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), mat));
  let rt = null;
  return {
    u,
    build() {
      const next = pmrem.fromScene(scene, 0.02, 0.1, 50);
      const old = rt; rt = next;
      return { texture: next.texture, old };
    },
    dispose() { rt?.dispose(); mat.dispose(); scene.children[0].geometry.dispose(); },
  };
}
