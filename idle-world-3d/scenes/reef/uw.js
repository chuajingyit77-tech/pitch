// 深蓝 · 珊瑚礁 — water volume: shared uniforms, GLSL (in-scatter fog, caustics, sway, detail bump),
// material patchers, background dome, the surface seen from below, light shafts, marine snow, bubbles.
import * as THREE from 'three';
import { GLSL, patchMaterial } from '../../lib/util.js';

/* ------------------------------------------------------------------ */
/* Shared uniforms                                                     */
/* ------------------------------------------------------------------ */
export function createWaterUniforms(surfY, refY) {
  return {
    uTime: { value: 0 },
    uSurfY: { value: surfY },
    uRefY: { value: refY },
    uSigma: { value: new THREE.Vector3(0.1, 0.058, 0.05) },  // extinction per metre (r, g, b)
    uKd: { value: new THREE.Vector3(0.075, 0.034, 0.024) },   // downwelling attenuation per metre
    uL0: { value: new THREE.Vector3(0.03, 0.3, 0.4) },         // in-scatter radiance just below the surface
    uSunW: { value: new THREE.Vector3(0, 1, 0) },              // toward the light, underwater (refracted)
    uGlow: { value: new THREE.Vector3(1, 1, 1) },              // forward-scatter glow tint
    uCaustic: { value: 1 },
    uFluor: { value: 0 },
    uCurDir: { value: new THREE.Vector2(0.8, 0.6) },
    uCurStr: { value: 1 },
  };
}

const DECL = /* glsl */`
uniform float uTime;
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
  float t = uTime;
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
vec3 uwFog(vec3 col, vec3 wp){
  vec3 v = wp - cameraPosition; float d = length(v);
  vec3 dir = v / max(d, 1e-4);
  return col * exp(-uSigma * d) + uwScatter(dir, cameraPosition.y, d);
}
vec3 uwAtten(vec3 col, vec3 wp){ return col * exp(-uSigma * length(wp - cameraPosition)); }
// Light reaching a surface at height y relative to the reference depth the lights are tuned for.
vec3 uwTint(float y){ return clamp(exp(uKd * (y - uRefY)), vec3(0.35), vec3(1.7)); }
#endif
`;

const CAUSTIC_GLSL = /* glsl */`
#ifndef REEF_CAUS
#define REEF_CAUS
float uwCaustics(vec3 wp){
  vec2 p = wp.xz - uSunW.xz / max(uSunW.y, 0.35) * (wp.y - uRefY);
  p += 0.25 * vec2(sin(p.y * 0.6 + uTime * 0.5), cos(p.x * 0.5 - uTime * 0.4));
  float c = caustics(p * 0.62, uTime * 1.25);
  return c * exp(-0.03 * clamp(uSurfY - wp.y, 0.0, 60.0));
}
#endif
`;

const LIGHTS_CAUSTIC = THREE.ShaderChunk.lights_fragment_begin
  .replace('IncidentLight directLight;', 'IncidentLight directLight;\nfloat uwCm = 1.0 + uCaustic * (uwCaustics(vUwPos) * 2.1 - 0.32);')
  .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= uwCm;');

const WPOS_FROM_MV = 'vUwPos = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);';

/**
 * Underwater look for a built-in material: depth-tinted light, caustics on the sun light and the
 * in-scatter fog. fog: 'full' | 'atten' (additive things) | 'none'.
 */
export function waterize(mat, W, { caustics = true, fog = 'full', tint = true, key = '' } = {}) {
  const frag = {};
  if (caustics) frag['#include <lights_fragment_begin>'] = LIGHTS_CAUSTIC;
  if (tint) frag['#include <opaque_fragment>'] = 'outgoingLight *= uwTint(vUwPos.y);\n$&';
  frag['#include <fog_fragment>'] = fog === 'full' ? 'gl_FragColor.rgb = uwFog(gl_FragColor.rgb, vUwPos);'
    : fog === 'atten' ? 'gl_FragColor.rgb = uwAtten(gl_FragColor.rgb, vUwPos);' : '';
  return patchMaterial(mat, {
    key: `uw${caustics ? 1 : 0}${fog}${tint ? 1 : 0}${key}`,
    uniforms: W,
    vertexHeader: UW_VERT,
    fragmentHeader: UW_FRAG + (caustics ? NOISE_GLSL + CAUSTIC_GLSL : ''),
    vertex: { '#include <fog_vertex>': '$&\n' + WPOS_FROM_MV },
    fragment: frag,
  });
}

const PERTURB = /* glsl */`
#ifndef REEF_PERTURB
#define REEF_PERTURB
// Mikkelsen bump with unnormalised screen derivatives: h in metres gives true geometric slope.
vec3 reefPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDir){
  vec3 sx = dFdx(surf_pos), sy = dFdy(surf_pos);
  vec3 R1 = cross(sy, surf_norm), R2 = cross(surf_norm, sx);
  float det = dot(sx, R1) * faceDir;
  vec3 g = sign(det) * (dHdxy.x * R1 + dHdxy.y * R2);
  return normalize(abs(det) * surf_norm - g);
}
#endif
`;

/**
 * Procedural surface detail. `glsl` must define
 *   float detailH(vec3 p)                       height in metres (scaled by bump)
 *   vec3 detailCol(vec3 p, float h, vec3 c)     albedo modulation
 * space: 'world' (static things) or 'object' (instanced / moving things; per-instance offset).
 */
export function addDetail(mat, W, { glsl, space = 'world', bump = 1, key = 'd', uniforms = {} }) {
  const vtx = space === 'object'
    ? { '#include <begin_vertex>': '$&\nvDetP = transformed;\n#ifdef USE_INSTANCING\nvDetP += instanceMatrix[3].xyz * 0.618;\n#endif' }
    : { '#include <fog_vertex>': '$&\nvDetP = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);' };
  return patchMaterial(mat, {
    key: 'det' + key + space,
    uniforms: { ...W, uBump: { value: bump }, ...uniforms },
    vertexHeader: UW_VERT + 'varying vec3 vDetP;',
    fragmentHeader: UW_FRAG + NOISE_GLSL + PERTURB + 'varying vec3 vDetP;\nuniform float uBump;\n' + glsl,
    vertex: vtx,
    fragment: {
      '#include <color_fragment>': '$&\nfloat detH = detailH(vDetP);\ndiffuseColor.rgb = detailCol(vDetP, detH, diffuseColor.rgb);',
      '#include <normal_fragment_maps>': '$&\nnormal = reefPerturb(-vViewPosition, normal, vec2(dFdx(detH), dFdy(detH)) * uBump, faceDirection);',
    },
  });
}

/** Night fluorescence: per-vertex amount (attribute aFluor) times a material colour times uFluor. */
export function addFluor(mat, W, color, strength = 1, key = 'f') {
  const u = { uFluorCol: { value: new THREE.Color(color).multiplyScalar(strength) } };
  mat.userData.fluorCol = u.uFluorCol;
  return patchMaterial(mat, {
    key: 'fl' + key,
    uniforms: { ...W, ...u },
    vertexHeader: UW_VERT + 'attribute float aFluor; varying float vFluor;',
    fragmentHeader: UW_FRAG + 'varying float vFluor; uniform vec3 uFluorCol;',
    vertex: { '#include <begin_vertex>': '$&\nvFluor = aFluor;' },
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
        vec3 a = texture2D(tN1, p * 0.035 + uTime * vec2(0.011, 0.006)).xyz * 2.0 - 1.0;
        vec3 b = texture2D(tN2, p * 0.061 + uTime * vec2(-0.008, 0.012)).xyz * 2.0 - 1.0;
        vec3 c = texture2D(tN1, p * 0.013 - uTime * vec2(0.004, 0.0065)).xyz * 2.0 - 1.0;
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
        col = col * exp(-uSigma * d) + uwScatter(dir, cameraPosition.y, d);
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
export function createShafts(W, rng, { count = 32, radius = 26, center = new THREE.Vector3() } = {}) {
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
        top.xz += vec2(sin(uTime * 0.05 + aP.y * 6.28), cos(uTime * 0.04 + aP.y * 4.0)) * 1.6;
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
      void main(){
        float x = vUv.x * 2.0;
        float prof = exp(-x * x * 2.6) - 0.074;
        float st = vnoise(vec2(vUv.x * 5.0 + vPh * 40.0, vUv.y * 0.6 - uTime * 0.05 + vPh * 9.0));
        st = 0.35 + 0.9 * st * st;
        float t = vUv.y;
        float vf = smoothstep(0.0, 0.12, t) * pow(max(1.0 - t, 0.0), 1.7);
        float flick = 0.6 + 0.4 * sin(uTime * 0.53 + vPh * 31.0) * sin(uTime * 0.31 + vPh * 17.0);
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
  /** Set each shaft's length so it fades out above the ground under its lower end. */
  const setLengths = (axis, groundAt) => {
    const c = g.getAttribute('aC');
    for (let i = 0; i < count; i++) {
      const x = c.getX(i * 4), z = c.getZ(i * 4);
      let len = 4;
      for (let s = 2; s < 40; s += 0.5) {
        const px = x + axis.x * s, py = W.uSurfY.value + axis.y * s, pz = z + axis.z * s;
        len = s;
        if (py < groundAt(px, pz) + 1.2) break;
      }
      for (let k = 0; k < 4; k++) c.setY(i * 4 + k, len * 1.05);
    }
    c.needsUpdate = true;
  };
  return { mesh, u, setLengths };
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
  const u = { ...W, uBox: { value: box }, uScale: { value: 800 }, uSnowI: { value: 1 }, uBio: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: UW_VERT + /* glsl */`
      attribute vec4 aSeed;
      uniform float uBox, uScale, uBio;
      varying float vA, vTw, vBio; varying vec3 vWp;
      void main(){
        float s = aSeed.w;
        vec3 p = aSeed.xyz * uBox;
        p += vec3(0.06, -0.035 - s * 0.03, 0.045) * uTime * (0.4 + s);
        p += 0.35 * vec3(sin(uTime * 0.31 + s * 40.0), sin(uTime * 0.23 + s * 23.0), cos(uTime * 0.27 + s * 31.0));
        vec3 c = cameraPosition - uBox * 0.5;
        p = c + mod(p - c, uBox);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float dist = -mv.z;
        float size = 0.018 + s * s * 0.05;
        gl_PointSize = clamp(size * uScale / max(dist, 0.1), 1.0, 28.0);
        float edge = 1.0 - smoothstep(uBox * 0.32, uBox * 0.5, length(p - cameraPosition));
        vA = edge * smoothstep(0.4, 1.6, dist) * step(p.y, uSurfY - 0.1);
        // sparse bioluminescent sparkles at night
        float bio = step(0.82, fract(s * 13.7));
        vTw = pow(max(sin(uTime * (0.6 + s * 1.4) + s * 70.0), 0.0), 18.0) * bio;
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
        vec3 lit = uwLc(vWp.y) * 2.4 * uSnowI + vec3(0.55, 0.65, 0.6) * uSnowI * 0.06;
        vec3 glow = vec3(0.25, 0.95, 1.3) * vTw * uBio * 6.0 + vec3(0.1, 0.5, 0.8) * vBio * uBio * 0.08;
        vec3 col = (lit + glow) * a;
        gl_FragColor = vec4(uwAtten(col, vWp), 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return { mesh: pts, u };
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
  const u = { ...W, uScale: { value: 800 }, uBubI: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: UW_VERT + /* glsl */`
      attribute vec4 aSeed;
      uniform float uScale;
      varying float vA; varying vec3 vWp;
      void main(){
        float H = max(uSurfY - position.y, 1.0);
        float spd = 0.55 * aSeed.z;
        float h = mod(uTime * spd + aSeed.x * H * 1.6, H * 1.6);
        vec3 p = position;
        float wob = 0.03 + h * 0.012;
        p += vec3(sin(uTime * 7.0 * aSeed.z + aSeed.y * 40.0) * wob, h, cos(uTime * 6.3 * aSeed.z + aSeed.w * 40.0) * wob);
        p.xz += vec2(0.18, 0.1) * h * h * 0.02;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float r = (0.012 + aSeed.w * 0.02) * (1.0 + h * 0.06);
        gl_PointSize = clamp(r * 2.0 * uScale / max(-mv.z, 0.1), 1.0, 40.0);
        vA = step(h, H - 0.15) * smoothstep(0.0, 0.2, h);
        vWp = p;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: UW_FRAG + /* glsl */`
      uniform float uBubI;
      varying float vA; varying vec3 vWp;
      void main(){
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r = length(c);
        if (r > 1.0 || vA < 0.01) discard;
        float rim = smoothstep(0.55, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
        float hl = smoothstep(0.38, 0.0, length(c - vec2(-0.3, -0.35)));
        vec3 lc = uwLc(vWp.y);
        vec3 col = (lc * 2.5 + vec3(0.15)) * (rim * 0.9 + 0.06) + (lc * 3.0 + vec3(0.6)) * hl * 0.9;
        gl_FragColor = vec4(uwAtten(col * vA * uBubI, vWp), 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 7;
  return { mesh: pts, u };
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
