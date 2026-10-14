// 云海 · light and air: crepuscular rays streaming through the clouds at sunrise and golden hour, and thin
// mist bands drifting between the islands at three depths (near, middle, far), lit by the sun or the moon.
//
// Both are a handful of soft cards in one draw call each, and cost nothing when they are not shown. Rays are
// additive, mist is premultiplied; both stay thin on screen. The rays lie along the sunlight (so they fan out
// from the sun, or converge opposite it), keep well clear of the island, sink softly into the cloud tops and are
// dimmed by the haze; their streaks drift over minutes, never shimmering. Mist bands turn to face the camera
// around the vertical, fade out where they meet the cloud tops and drift slowly round the island.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep } from '../../lib/util.js';
import { SHARED_GLSL, CLOUD_TOP, CLOCK_PERIOD, angQ } from './common.js';
import { SEA_HEIGHT_GLSL, seaHeightUniforms } from './clouds.js';

/* ------------------------------------------------------------------ */
/* Crepuscular rays                                                    */
/* ------------------------------------------------------------------ */
const RAY_VERT = /* glsl */`
${SHARED_GLSL}
attribute vec4 aRay;    // offset across the sunlight (m), height above the cloud tops (m), length (m), half width (m)
attribute vec4 aRay2;   // position of its middle along the sunlight (m, + toward the sun), seed, strength (< 0: a shadow beam), breathing phase
uniform vec3 uRayC;
varying vec2 vUv;
varying vec4 vR;        // seed, strength, along, breathing phase
varying vec3 vW;
void main(){
  // the light's direction (never flatter than ~3 degrees: rays lie along it)
  vec3 Ls = uSunDir; Ls.y = max(Ls.y, 0.05); Ls = normalize(Ls);
  vec3 hz = normalize(vec3(Ls.x, 0.0, Ls.z) + vec3(1e-5, 0.0, 0.0));
  vec3 side = vec3(-hz.z, 0.0, hz.x);
  vec3 mid = uRayC + hz * aRay2.x + side * aRay.x + vec3(0.0, uCloudTop + aRay.y, 0.0);
  float v = uv.y, u = uv.x * 2.0 - 1.0;
  vec3 axis = mid - Ls * (v - 0.5) * aRay.z;
  // a ribbon turned toward the camera about its own axis
  vec3 toCam = cameraPosition - axis;
  vec3 across = cross(Ls, toCam);
  float la = length(across);
  across = la > 1e-3 ? across / la : vec3(side);
  vec3 p = axis + across * u * aRay.w * mix(0.85, 1.35, v);
  vW = p; vUv = vec2(u, v); vR = vec4(aRay2.y, aRay2.z, v, aRay2.w);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RAY_FRAG = /* glsl */`
${SHARED_GLSL}
uniform sampler2D tNoise;
uniform float uRayAmt, uRayT;
varying vec2 vUv;
varying vec4 vR;
varying vec3 vW;
void main(){
  vec3 V = normalize(cameraPosition - vW);
  vec3 Ls = uSunDir; Ls.y = max(Ls.y, 0.05); Ls = normalize(Ls);
  // soft across, fading in from the far end and out toward the near end
  float across = exp(-vUv.x * vUv.x * 3.2) - 0.04;
  float along = smoothstep(0.0, 0.3, vR.z) * (1.0 - smoothstep(0.55, 1.0, vR.z));
  // a few long streaks inside the beam, drifting over minutes
  float st = texture2D(tNoise, vec2(vR.x + vUv.x * 0.12, vR.z * 0.35 + uRayT)).r;
  // bright looking toward the sun (forward scattering), faint away from it
  float mu = dot(-V, Ls);
  float phase = pow(max(mu, 0.0), 5.0) * 1.6 + pow(max(mu, 0.0), 1.5) * 0.25 + 0.035;
  float breathe = 0.78 + 0.22 * sin(vR.w);
  float a = max(across, 0.0) * along * (0.55 + 0.75 * st) * phase * breathe * abs(vR.y) * uRayAmt;
  a *= smoothstep(uCloudTop + 1.0, uCloudTop + 16.0, vW.y);   // they end in the clouds
  a *= 1.0 - 0.75 * fogAmountAt(vW);                           // and the haze dims them
  if (a < 0.0015) discard;
  // light beams add the sunlight; shadow beams (between them) take some of the lit haze away
  gl_FragColor = vR.y > 0.0 ? vec4(uLightCol * a, 0.0) : vec4(0.0, 0.0, 0.0, min(a * 0.22, 0.3));
}`;

export function createRays(shared, tex, rng, q) {
  const n = q >= 0.7 ? 14 : 11;
  const pos = [], uv = [], a1 = [], a2 = [], idx = [];
  let prev = null;
  for (let i = 0; i < n; i++) {
    // most on the sun's side (seen fanning out from the sun), a few opposite (converging away from it); every
    // other one on the sun's side is a shadow beam laid beside a light beam
    const toward = i < n - 2, shadow = toward && i % 2 === 1 && prev;
    const across = shadow ? prev.across + rng.range(16, 34) * (rng.chance(0.5) ? 1 : -1) : rng.range(140, 520) * (rng.chance(0.5) ? 1 : -1) * (toward ? rng.range(0.3, 1) : 1);
    const len = shadow ? prev.len * rng.range(0.85, 1.1) : rng.range(380, 720);
    const along = shadow ? prev.along : toward ? rng.range(len * 0.5 + 120, len * 0.5 + 520) : -rng.range(len * 0.5 + 160, len * 0.5 + 420);
    const hgt = shadow ? prev.hgt + rng.range(-10, 10) : rng.range(26, 150);
    if (!shadow) prev = { across, len, along, hgt };
    const ray = [across, hgt, len, shadow ? rng.range(9, 18) : rng.range(5, 11)];
    const ray2 = [along, rng.next(), shadow ? -rng.range(0.7, 1) : toward ? rng.range(0.6, 1) : rng.range(0.6, 0.9), rng.range(0, TAU)];
    const b = pos.length / 3;
    for (let j = 0; j <= 1; j++) for (let k = 0; k <= 1; k++) {   // a quad: u across, v along (0 = sun end)
      pos.push(0, 0, 0); uv.push(k, j); a1.push(...ray); a2.push(...ray2);
    }
    idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aRay', new THREE.Float32BufferAttribute(a1, 4));
  g.setAttribute('aRay2', new THREE.Float32BufferAttribute(a2, 4));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const uniforms = Object.assign({}, shared, { tNoise: { value: tex.noise }, uRayC: { value: new THREE.Vector3() }, uRayAmt: { value: 0 }, uRayT: { value: 0 } });
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: RAY_VERT, fragmentShader: RAY_FRAG,
    transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'rays';
  mesh.frustumCulled = false;
  mesh.renderOrder = 0.5;   // before the cloud puffs: a puff in front of a ray covers it
  mesh.visible = false;
  // each ray breathes on its own slow phase (25-45 s); the streaks drift one texture length in ~33 min
  const ph = a2.filter((_, i) => i % 16 === 3);
  const rates = ph.map(() => angQ(TAU / rng.range(25, 45)));
  const attr = g.getAttribute('aRay2');
  return {
    mesh,
    update(dt, t, tod) {
      // sunrise (the sun low in the east) and golden hour; never at noon or at night
      const e = tod.elev;
      const morning = tod.morning * smoothstep(-2, 3, e) * (1 - smoothstep(16, 30, e));
      const amt = Math.max(morning * 0.9, tod.golden) * (1 - tod.night);
      uniforms.uRayAmt.value = amt * 0.75;
      mesh.visible = amt > 0.01;
      if (!mesh.visible) return;
      uniforms.uRayT.value = (t * 0.0005) % 1;
      for (let i = 0; i < n; i++) {
        const p = (ph[i] + rates[i] * (t % CLOCK_PERIOD)) % TAU;
        for (let k = 0; k < 4; k++) attr.array[(i * 4 + k) * 4 + 3] = p;
      }
      attr.needsUpdate = true;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Mist bands                                                          */
/* ------------------------------------------------------------------ */
const MIST_VERT = /* glsl */`
${SHARED_GLSL}
${SEA_HEIGHT_GLSL}
attribute vec4 aBand;    // radius from the island, angle, height, angular speed (rad/s, whole turns per clock wrap)
attribute vec4 aBand2;   // half width, half height, density, seed
uniform vec3 uC;
varying vec2 vUv;
varying vec4 vB;         // density, seed, cloud height under the vertex, unused
varying vec3 vW;
void main(){
  float a = aBand.y + aBand.w * uTime;
  vec3 c = uC + vec3(sin(a) * aBand.x, aBand.z, cos(a) * aBand.x);
  vec2 d = c.xz - cameraPosition.xz;
  float l = length(d);
  d = l > 1e-3 ? d / l : vec2(0.0, 1.0);
  vec3 right = vec3(-d.y, 0.0, d.x);
  vec3 p = c + right * position.x * aBand2.x + vec3(0.0, position.y * aBand2.y, 0.0);
  vW = p; vUv = position.xy;
  vB = vec4(aBand2.z, aBand2.w, seaHeightAt(p.xz), 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const MIST_FRAG = /* glsl */`
${SHARED_GLSL}
uniform sampler2D tNoise;
uniform float uMistT, uMistAmt;
varying vec2 vUv;
varying vec4 vB;
varying vec3 vW;
void main(){
  float x = vUv.x, y = vUv.y;   // -1..1 across, -1..1 up
  // a long soft band, flat-bottomed and thinning upward, its ends trailing away; wispy streaks along it
  float prof = smoothstep(-1.0, -0.35, y) * (1.0 - smoothstep(-0.1, 1.0, y));
  float ends = 1.0 - smoothstep(0.45, 1.0, abs(x));
  float n1 = texture2D(tNoise, vec2(x * 0.9 + vB.y * 7.0 + uMistT, y * 0.18 + vB.y)).r;
  float n2 = texture2D(tNoise, vec2(x * 2.3 - uMistT * 2.0 + vB.y * 3.0, y * 0.4 + 0.5)).g;   // (whole repeats when uMistT wraps)
  float wisp = clamp(n1 * 1.1 + n2 * 0.6 - 0.55, 0.0, 1.0);
  float a = prof * ends * wisp * vB.x * uMistAmt;
  // they never cut into the cloud tops (fading out over the last metres above them), and thin out close to the
  // camera (zoomed far out it can be among the near bands)
  vec3 toC = cameraPosition - vW;
  float dc = length(toC);
  a *= smoothstep(vB.z - 1.0, vB.z + 7.0, vW.y) * smoothstep(12.0, 32.0, dc);
  if (a < 0.003) discard;
  vec3 V = toC / max(dc, 1e-3);
  float fwd = pow(max(dot(-V, uLightDir), 0.0), 4.0);
  vec3 col = (uAmbient * 0.95 + uBounce * 0.4 + uLightCol * (0.38 + 1.4 * fwd)) * 0.96;
  col = mix(col, hazeColor(-V), fogAmountAt(vW) * 0.85);
  gl_FragColor = vec4(col * a, a);
}`;

/** bands: [{ r, a, y, w (rad/s), hw, hh, dens }] round centre c. */
export function createMistBands(shared, tex, sea, rng, bands, c) {
  const SX = 14, SY = 3;   // vertices across / up a band (the cloud height under it is sampled per vertex)
  const pos = [], b1 = [], b2 = [], idx = [];
  for (const B of bands) {
    const base = pos.length / 3;
    const seed = rng.next();
    for (let j = 0; j <= SY; j++) for (let i = 0; i <= SX; i++) {
      pos.push((i / SX) * 2 - 1, (j / SY) * 2 - 1, 0);
      b1.push(B.r, B.a, B.y, B.w); b2.push(B.hw, B.hh, B.dens, seed);
    }
    for (let j = 0; j < SY; j++) for (let i = 0; i < SX; i++) {
      const a = base + j * (SX + 1) + i, b = a + 1, cc = a + SX + 1, d = cc + 1;
      idx.push(a, b, cc, b, d, cc);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aBand', new THREE.Float32BufferAttribute(b1, 4));
  g.setAttribute('aBand2', new THREE.Float32BufferAttribute(b2, 4));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const uniforms = Object.assign({}, shared, seaHeightUniforms(sea), { tNoise: { value: tex.noise }, uC: { value: c.clone() }, uMistT: { value: 0 }, uMistAmt: { value: 1 } });
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: MIST_VERT, fragmentShader: MIST_FRAG, extensions: { shaderTextureLOD: true },
    transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'mistBands';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1.5;   // after the far cloud towers and banks, before the near puffs
  return {
    mesh, uniforms,
    update(dt, t, tod) {
      // the streaks drift one texture length in 1250 s (whole repeats per wrap of the 10000 s clock)
      uniforms.uMistT.value = (t % CLOCK_PERIOD) * 0.0008 % 1;
      // a little denser at dawn and dusk, when low light catches them
      uniforms.uMistAmt.value = 0.85 + 0.35 * Math.max(tod.golden, tod.morning * smoothstep(-2, 4, tod.elev) * (1 - smoothstep(10, 25, tod.elev)));
    },
  };
}
