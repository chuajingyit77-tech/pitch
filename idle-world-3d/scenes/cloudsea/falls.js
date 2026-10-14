// 云海 · waterfalls: water spilling off the islets' edges into the sea of clouds.
//
// Each fall is a ribbon along the water's ballistic path, turned toward the camera about that path so it keeps
// its width from any side. Its texture coordinate along the fall is the time the water has been falling, so a
// texture scrolled at a constant rate moves with the water and speeds up as it falls, exactly like the water.
// Glassy and sky-tinted at the lip, white streaks lower down, thinning into the existing mist veil; a soft
// billowing spray card where it meets the clouds; on the main islet a short runnel brings the water from the
// spring pool to the lip. One draw call for all of it (premultiplied), streaks kept soft so nothing shimmers.
import * as THREE from 'three';
import { TAU, lerp, smoothstep } from '../../lib/util.js';
import { SHARED_GLSL, CLOUD_TOP } from './common.js';

const G = 9.8;

const FALL_VERT = /* glsl */`
${SHARED_GLSL}
attribute vec4 aAxis;    // centre of the ribbon here (xyz), half width (m)
attribute vec4 aTan;     // direction of the water here (xyz), part: 0 fall, 1 spray card, 2 runnel
attribute vec4 aFall;    // fall time here (s), total fall time (s), seed, unused
varying vec2 vUv;
varying vec4 vF;          // fall time, total, seed, part
varying vec3 vW;
void main(){
  vec3 c = aAxis.xyz, p;
  float part = aTan.w;
  if (part < 0.5) {
    // turned toward the camera about the water's own direction
    vec3 across = cross(aTan.xyz, cameraPosition - c);
    float la = length(across);
    across = la > 1e-4 ? across / la : vec3(1.0, 0.0, 0.0);
    p = c + across * (uv.x * 2.0 - 1.0) * aAxis.w;
  } else if (part < 1.5) {
    // spray: a card facing the camera
    vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    p = c + (r * (uv.x * 2.0 - 1.0) + u * (uv.y * 2.0 - 1.0)) * aAxis.w;
  } else {
    // runnel: flat on the lawn, across the flow
    vec3 across = normalize(vec3(-aTan.z, 0.0, aTan.x));
    p = c + across * (uv.x * 2.0 - 1.0) * aAxis.w;
  }
  vW = p; vUv = uv; vF = vec4(aFall.xyz, part);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const FALL_FRAG = /* glsl */`
${SHARED_GLSL}
uniform sampler2D tNoise;
uniform float uFlowT, uSprayT;
varying vec2 vUv;
varying vec4 vF;
varying vec3 vW;
void main(){
  vec3 toC = cameraPosition - vW;
  float dc = length(toC);
  vec3 V = toC / max(dc, 1e-3);
  vec3 L = uLightDir;
  float fwd = pow(max(dot(-V, L), 0.0), 4.0);
  vec3 foam = uAmbient * 1.05 + uBounce * 0.3 + uLightCol * (0.62 + 1.1 * fwd);
  vec3 glass = (uAmbient * 0.9 + uLightCol * 0.25) * vec3(0.62, 0.84, 0.9) + hazeColor(reflect(-V, vec3(0.0, 0.0, 1.0))) * 0.25;
  float part = vF.w, a;
  vec3 col;
  if (part < 0.5) {
    float tf = vF.x, tot = vF.y, sd = vF.z, u = vUv.x * 2.0 - 1.0;
    // streaks travel with the water (the coordinate along is the time fallen)
    float s1 = texture2D(tNoise, vec2(u * 0.55 + sd, (tf - uFlowT) * 0.9)).r;
    float s2 = texture2D(tNoise, vec2(u * 1.3 + sd * 2.0, (tf - uFlowT) * 1.6)).g;
    float streak = s1 * 0.6 + s2 * 0.5;
    // a ragged core that widens and breaks up as it falls
    float edge = 1.0 - smoothstep(0.35 + 0.25 * s2, 1.0, abs(u) + 0.25 * smoothstep(0.2, 1.0, tf / tot) * (s1 - 0.4));
    float white = smoothstep(0.04, 0.5, tf);
    a = edge * mix(0.8, 0.42 + 0.5 * streak, white);
    a *= smoothstep(0.0, 0.05, tf) * (1.0 - smoothstep(0.45 * tot, tot, tf));
    col = mix(glass, foam, white * (0.55 + 0.45 * streak));
  } else if (part < 1.5) {
    vec2 q = vUv * 2.0 - 1.0;
    float r2 = dot(q, q);
    float n1 = texture2D(tNoise, q * 0.32 + vec2(vF.z, uSprayT)).r;
    float n2 = texture2D(tNoise, q * 0.7 + vec2(vF.z * 3.0, uSprayT * 2.0)).g;
    a = clamp((1.0 - r2) * 1.3 + (n1 - 0.5) * 0.9 + (n2 - 0.5) * 0.5 - 0.25, 0.0, 1.0) * 0.55;
    col = foam;
  } else {
    float tf = vF.x, u = vUv.x * 2.0 - 1.0;
    float s1 = texture2D(tNoise, vec2(u * 0.4 + vF.z, tf * 0.6 - uFlowT * 0.5)).r;   // (5 repeats per wrap)
    a = (1.0 - smoothstep(0.5, 1.0, abs(u))) * (0.62 + 0.25 * s1) * smoothstep(0.0, 0.08, vUv.y);
    col = mix(glass, foam, smoothstep(0.55, 0.85, s1) * 0.5);
  }
  // below the cloud tops it dissolves into them; the haze softens it with distance
  a *= smoothstep(uCloudTop - 6.0, uCloudTop + 4.0, vW.y);
  col = mix(col, hazeColor(-V), fogAmountAt(vW));
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a, a);
}`;

/**
 * falls: [{ lip, dir, height, w0, runnel?: { from: Vector3, ground: (x, z) => y } }]
 */
export function createFalls(shared, tex, falls, rng) {
  const axis = [], tan = [], fl = [], uv = [], idx = [];
  const P = new THREE.Vector3(), T = new THREE.Vector3();
  const vert = (c, w, t, part, tf, tot, sd, u, v) => { axis.push(c.x, c.y, c.z, w); tan.push(t.x, t.y, t.z, part); fl.push(tf, tot, sd, 0); uv.push(u, v); };
  for (const f of falls) {
    const sd = rng.next();
    const v0 = 1.5, H = f.lip.y - (CLOUD_TOP - 6);
    const tot = Math.sqrt(2 * H / G);
    const N = 30;
    // the ribbon: centre line along the ballistic path (falling a little short of free fall: it fans out and slows)
    let base = axis.length / 4;
    for (let i = 0; i <= N; i++) {
      const tf = tot * Math.pow(i / N, 1.25);
      P.copy(f.lip).addScaledVector(f.dir, v0 * tf + 0.6 * smoothstep(0, 0.6, tf)); P.y -= 0.5 * G * tf * tf;
      T.copy(f.dir).multiplyScalar(v0 + 1.0 * (1 - smoothstep(0, 0.6, tf))); T.y = -G * tf - 0.4; T.normalize();
      const w = f.w0 * 0.5 + 1.25 * tf + 0.6 * tf * tf;
      vert(P, w, T, 0, tf, tot, sd, 0, i / N);
      vert(P, w, T, 0, tf, tot, sd, 1, i / N);
    }
    for (let i = 0; i < N; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    // spray where it meets the clouds
    base = axis.length / 4;
    P.copy(f.lip).addScaledVector(f.dir, v0 * tot + 0.6); P.y = CLOUD_TOP + 1.5;
    const sw = f.w0 * 0.5 + 1.25 * tot + 0.6 * tot * tot;
    for (let j = 0; j <= 1; j++) for (let k = 0; k <= 1; k++) vert(P, sw * 1.15, T.set(0, 1, 0), 1, 0, tot, sd, k, j);
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    // the runnel from the spring pool to the lip
    if (f.runnel) {
      base = axis.length / 4;
      const from = f.runnel.from, M = 8;
      for (let i = 0; i <= M; i++) {
        const s = i / M;
        P.lerpVectors(from, f.lip, s);
        const g = f.runnel.ground(P.x, P.z);
        P.y = (g === null ? f.lip.y : Math.max(g, f.lip.y)) + 0.035;
        const w = lerp(0.32, f.w0 * 0.5, s);
        vert(P, w, T.copy(f.dir), 2, s * 0.5, tot, sd, 0, s);
        vert(P, w, T, 2, s * 0.5, tot, sd, 1, s);
      }
      for (let i = 0; i < M; i++) { const a = base + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  const n = axis.length / 4;
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aAxis', new THREE.Float32BufferAttribute(axis, 4));
  g.setAttribute('aTan', new THREE.Float32BufferAttribute(tan, 4));
  g.setAttribute('aFall', new THREE.Float32BufferAttribute(fl, 4));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const uniforms = Object.assign({}, shared, { tNoise: { value: tex.noise }, uFlowT: { value: 0 }, uSprayT: { value: 0 } });
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: FALL_VERT, fragmentShader: FALL_FRAG,
    transparent: true, depthWrite: false, premultipliedAlpha: true, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'waterfalls';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2.2;   // over the mist veil it falls through, under the near cloud puffs
  return {
    mesh,
    update(dt, t) {
      // the water's clock wraps every 10 s, a whole number of texture repeats for every layer (9, 16 and 5)
      uniforms.uFlowT.value = t % 10;
      uniforms.uSprayT.value = (t * 0.02) % 1;
    },
  };
}
