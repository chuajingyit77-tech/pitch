// Pond surface, waterfall sheets, plunge mist and splash droplets.
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { TAU, lerp, clamp, makeRng, GLSL } from '../../lib/util.js';
import { JG_GLSL } from './shading.js';
import { WATER_Y, FALL } from './terrain.js';

export const RIPPLES = 14;

/* ------------------------------------------------------------------ */
/* Pond surface                                                         */
/* ------------------------------------------------------------------ */
const WaterShader = {
  name: 'JungleWater',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null } },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix;
    varying vec4 vRUv;
    varying vec3 vWorldP;
    void main(){
      vRUv = textureMatrix * vec4(position, 1.0);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorldP = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    ${JG_GLSL}
    ${GLSL.noise}
    uniform sampler2D tDiffuse, tNormal1, tNormal2, tDepth;
    uniform vec4 uDepthBox;
    uniform vec3 uAmb, uMurk;
    uniform float uRain, uCalm, uMurkAmt, uReflBoost;
    uniform vec4 uRipples[${RIPPLES}];
    uniform vec4 uFall;
    uniform vec4 uScrollA, uScrollB; // normal-map scrolls wrapped to [0,1) and the plunge-wave phase, set in JS
    varying vec4 vRUv;
    vec2 rainRipples(vec2 p, float t){
      vec2 acc = vec2(0.0);
      for (int k = 0; k < 2; k++) {
        vec2 q = p + float(k) * vec2(0.37, 0.71);
        vec2 c = floor(q); vec2 f = fract(q);
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          vec2 g = vec2(float(i), float(j));
          vec2 h = hash22(c + g + float(k) * 13.0);
          float ph = fract(t * (0.9 + h.x * 0.4) + h.y);
          vec2 d = g + h - f;
          float r = length(d);
          float ring = r - ph * 0.9;
          float w = exp(-ring * ring * 160.0) * (1.0 - ph) * (1.0 - ph);
          acc += (d / max(r, 1e-3)) * w * sin(ring * 60.0);
        }
      }
      return acc * 0.5;
    }
    void main(){
      vec2 wp = vWorldP.xz;
      // world size of this pixel on the water: high-frequency ripples fade out where a pixel cannot hold them
      float fw = length(fwidth(wp));
      vec3 n1 = texture2D(tNormal1, wp * 0.085 + uScrollA.xy).xyz * 2.0 - 1.0;
      vec3 n2 = texture2D(tNormal2, wp * 0.13 + uScrollA.zw).xyz * 2.0 - 1.0;
      vec3 n3 = texture2D(tNormal2, wp * 0.45 + uScrollB.xy).xyz * 2.0 - 1.0;
      vec2 nxz = (n1.xy + n2.xy) * 0.5 * uCalm + n3.xy * 0.08 * (uCalm + uRain);
      float dep = texture2D(tDepth, (wp - uDepthBox.xy) / uDepthBox.zw).r * 2.0;
      // event ripples (food, frogs, fish, drops); far away the ring keeps its soft swell but loses the fine
      // carrier wave, which could not be resolved there and shimmered
      float rippleFoam = 0.0;
      float carrierK = smoothstep(0.07, 0.2, fw);
      for (int i = 0; i < ${RIPPLES}; i++) {
        vec4 R = uRipples[i];
        float age = uTime - R.z;
        if (age < 0.0 || age > 5.0 || R.w <= 0.0) continue;
        vec2 dv = wp - R.xy;
        float r = length(dv);
        float front = age * 0.65;
        float dd = r - front;
        float env = R.w * exp(-age * 0.75) * exp(-dd * dd * 10.0);
        nxz += (dv / max(r, 1e-3)) * mix(sin(dd * 22.0), -dd * 2.5, carrierK) * env * 0.5;
        rippleFoam += env * smoothstep(0.6, 0.0, age) * 0.6;
      }
      // waterfall: concentric waves and turbulence around the plunge point
      vec2 fv = (wp - uFall.xy) * vec2(1.0, 1.4);
      float fr = length(fv);
      float wave = sin(fr * 6.5 - uScrollB.w) * exp(-fr * 0.42) * 0.22 * uFall.z;
      nxz += (fv / max(fr, 1e-3)) * wave;
      float turb = exp(-fr * fr * 0.18) * uFall.z;
      vec3 tn = texture2D(tNormal1, wp * 0.6 + vec2(0.0, uScrollB.z)).xyz * 2.0 - 1.0;
      nxz += tn.xy * turb * 0.6;
      // rain rings are ~5 cm across: only where a pixel is small enough to show them
      nxz += rainRipples(wp * 2.2, uTime) * uRain * 0.9 * (1.0 - smoothstep(0.012, 0.035, fw));
      vec3 N = normalize(vec3(-nxz.x, 1.0, -nxz.y));
      vec3 V = normalize(cameraPosition - vWorldP);
      float NdV = max(dot(N, V), 0.0);
      float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
      vec2 ruv = vRUv.xy / vRUv.w + nxz * 0.035;
      vec3 refl = texture2D(tDiffuse, ruv).rgb * uReflBoost;
      float cookie = jgCookie(vWorldP);
      vec3 H = normalize(uLightDirW + V);
      // sun glint: where the ripple normal changes a lot within one pixel, widen and dim the lobe (same energy)
      // instead of letting single pixels flare to hundreds and blink from frame to frame
      vec2 dn = fwidth(nxz);
      float nvar = dot(dn, dn);
      float NdH = max(dot(N, H), 0.0);
      float e1 = max(2.0 / (2.0 / 422.0 + nvar) - 2.0, 1.0);
      float e2 = max(2.0 / (2.0 / 62.0 + nvar) - 2.0, 1.0);
      float spec = pow(NdH, e1) * 9.0 * (e1 + 2.0) / 422.0 + pow(NdH, e2) * 0.18 * (e2 + 2.0) / 62.0;
      vec3 specCol = min(uLightCol * spec * cookie * smoothstep(-0.05, 0.1, uLightDirW.y), vec3(8.0));
      // foam near the plunge
      float fn = vnoise(wp * 3.5 + vec2(0.0, uTime * 0.8)) * 0.6 + vnoise(wp * 9.0 - vec2(uTime * 0.6, 0.0)) * 0.4;
      float foam = smoothstep(0.35, 0.85, fn * exp(-fr * 0.45) * 1.6) * uFall.z;
      foam += smoothstep(0.5, 1.0, fn) * rippleFoam;
      vec3 lightAmt = uAmb + uLightCol * cookie * max(uLightDirW.y, 0.0) * 0.8;
      float shore = smoothstep(0.0, 0.07, dep);
      float a = clamp(F * 1.1 + uMurkAmt * (0.6 + 0.4 * smoothstep(0.0, 1.5, dep)), 0.0, 1.0);
      vec3 col = (refl * F * 1.1 + uMurk * lightAmt * uMurkAmt) / max(a, 1e-3);
      col = mix(col, vec3(0.85, 0.92, 0.9) * lightAmt * 1.1, foam);
      a = max(a, foam * 0.9);
      // the glint is added premultiplied (dividing it by a small alpha used to multiply it up to 20x)
      float aS = clamp(a + length(specCol) * 0.2, 0.0, 1.0);
      col = (col * a + specCol * 0.5) / max(aS, 1e-3);
      a = aS * shore;
      col = jgFog(col, vWorldP);
      gl_FragColor = vec4(col, a);
    }`,
};

export function buildPond(env, shared, L, { normal1, normal2, rtScale = 0.5 }) {
  // depth map of the basin
  const box = [-7.5, -10.5, 16, 16.5]; // x0, z0, w, d
  const N = 96;
  const data = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = box[0] + (i + 0.5) / N * box[2], z = box[1] + (j + 0.5) / N * box[3];
    const d = clamp((WATER_Y - L.groundH(x, z)) / 2, 0, 1);
    const k = (j * N + i) * 4;
    data[k] = d * 255; data[k + 1] = 0; data[k + 2] = 0; data[k + 3] = 255;
  }
  const depthTex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  depthTex.magFilter = THREE.LinearFilter; depthTex.minFilter = THREE.LinearFilter;
  depthTex.needsUpdate = true;

  const size = env.renderer.getDrawingBufferSize(new THREE.Vector2());
  const geo = new THREE.PlaneGeometry(box[2], box[3], 1, 1);
  const water = new Reflector(geo, {
    shader: WaterShader,
    textureWidth: Math.max(256, Math.round(size.x * rtScale)),
    textureHeight: Math.max(144, Math.round(size.y * rtScale)),
    clipBias: 0.003,
    multisample: 0,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(box[0] + box[2] / 2, WATER_Y, box[1] + box[3] / 2);
  const u = water.material.uniforms;
  for (const k of Object.keys(shared)) u[k] = shared[k];
  normal1.wrapS = normal1.wrapT = THREE.RepeatWrapping;
  normal2.wrapS = normal2.wrapT = THREE.RepeatWrapping;
  const ripples = [];
  for (let i = 0; i < RIPPLES; i++) ripples.push(new THREE.Vector4(0, 0, -100, 0));
  Object.assign(u, {
    tNormal1: { value: normal1 }, tNormal2: { value: normal2 }, tDepth: { value: depthTex },
    uDepthBox: { value: new THREE.Vector4(...box) },
    uAmb: { value: new THREE.Color(0.2, 0.3, 0.25) },
    uMurk: { value: new THREE.Color('#2f6b55') },
    uMurkAmt: { value: 0.12 },
    uRain: { value: 0 }, uCalm: { value: 0.22 }, uReflBoost: { value: 1 },
    uRipples: { value: ripples },
    uFall: { value: new THREE.Vector4(FALL.x, FALL.lipZ + 2.0, 1, 0) },
    uScrollA: { value: new THREE.Vector4() }, uScrollB: { value: new THREE.Vector4() },
  });
  water.material.extensions.derivatives = true;
  water.material.transparent = true;
  water.material.depthWrite = false;
  water.renderOrder = 1;
  let next = 0;
  return {
    mesh: water,
    depthTex,
    /** Scroll offsets and wave phase from the clock, wrapped in double precision (seamless: the normal maps
     * repeat and the wave is periodic) so the water still moves smoothly after days of uptime. */
    setTime(t) {
      const fr = x => x - Math.floor(x);
      u.uScrollA.value.set(fr(t * 0.011), fr(t * 0.006), fr(-t * 0.008), fr(t * 0.012));
      u.uScrollB.value.set(fr(t * 0.02), fr(-t * 0.017), fr(t * 0.35), (t * 6) % TAU);
    },
    addRipple(x, z, amp = 1, t) {
      const r = ripples[next];
      r.set(x, z, t, amp);
      next = (next + 1) % RIPPLES;
    },
    dispose() { water.dispose(); depthTex.dispose(); geo.dispose(); },
  };
}

/* ------------------------------------------------------------------ */
/* Waterfall                                                            */
/* ------------------------------------------------------------------ */
const G = 9.8;
/** Streams pouring over the lip: x offset, lip drop, width at the lip, outward speed, layer id. */
export const STREAMS = [
  { dx: 0.0, drop: 0.0, w: 1.75, u0: 1.55, spread: 0.42, id: 0, nu: 16 },
  { dx: 0.05, drop: 0.0, w: 2.0, u0: 1.75, spread: 0.5, id: 1, nu: 12, dz: 0.1 },
  { dx: 1.55, drop: 0.35, w: 0.5, u0: 1.25, spread: 0.6, id: 2, nu: 5 },
  { dx: -1.45, drop: 0.55, w: 0.32, u0: 1.15, spread: 0.7, id: 2, nu: 4 },
];
export function fallPoint(tau, s, st = STREAMS[0]) {
  // s in [-0.5, 0.5] across; returns world position on a stream sheet
  const y = FALL.lipY - st.drop - 0.5 * G * tau * tau;
  const z = FALL.lipZ + 0.12 + st.u0 * tau + 0.12 * Math.cos(s * Math.PI) + (st.dz || 0);
  const widen = 1 + tau * st.spread;
  const x = FALL.x + st.dx + s * st.w * widen + Math.sin(tau * 2.3 + st.dx) * 0.06 * tau;
  return [x, y, z];
}
export const fallT = (st = STREAMS[0]) => Math.sqrt(2 * (FALL.lipY - st.drop - WATER_Y) / G);

export function buildWaterfall(shared, q) {
  const NV = Math.round(40 * Math.max(0.6, q));
  const pos = [], uv = [], lay = [], idx = [];
  let base = 0;
  for (const st of STREAMS) {
    const nu = st.nu;
    const T = fallT(st);
    for (let j = 0; j <= NV; j++) {
      const v = j / NV;
      const tau = -0.25 + v * (T + 0.25);
      for (let i = 0; i <= nu; i++) {
        const s = i / nu - 0.5;
        let x, y, z;
        if (tau < 0) {
          // flowing over the lip, from back on the plateau
          const k = -tau / 0.25;
          [x, y, z] = fallPoint(0, s, st);
          z -= k * 1.2; y += k * 0.06 - 0.02;
        } else {
          [x, y, z] = fallPoint(tau, s, st);
        }
        pos.push(x, y, z);
        uv.push(i / nu, tau);
        lay.push(st.id + (st.dx !== 0 ? 0.25 : 0));
      }
    }
    for (let j = 0; j < NV; j++) for (let i = 0; i < nu; i++) {
      const a = base + j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    base += (NV + 1) * (nu + 1);
  }
  const T = fallT();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('aLayer', new THREE.Float32BufferAttribute(lay, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uAmb: { value: new THREE.Color(0.3, 0.35, 0.33) }, uFallT: { value: T }, uMoon: { value: 0 }, uFlow: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float aLayer;
      varying vec2 vUv; varying float vLayer; varying vec3 vWorldP; varying vec3 vN;
      void main(){
        vUv = uv; vLayer = aLayer;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      ${JG_GLSL}
      ${GLSL.noise}
      uniform vec3 uAmb; uniform float uFallT, uMoon, uFlow;
      varying vec2 vUv; varying float vLayer; varying vec3 vN;
      float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
      void main(){
        float s = vUv.x, tau = vUv.y;
        float t = uTime * uFlow;
        float lay = floor(vLayer + 0.01); float side = fract(vLayer + 0.01) > 0.1 ? 1.0 : 0.0;
        float sp = lay > 1.5 ? 1.4 : (lay > 0.5 ? 1.25 : 1.0);
        // streaks advected with the water: features are fixed in (s, tau - t)
        float a1 = fbm2(vec2(s * 14.0 + lay * 7.0, (tau - t * 1.0 * sp) * 2.6));
        float a2 = fbm2(vec2(s * 33.0 + 5.0 + lay * 3.0, (tau - t * 1.35 * sp) * 5.5));
        float a3 = vnoise(vec2(s * 80.0 + 11.0, (tau - t * 1.7 * sp) * 12.0));
        float streak = a1 * 0.55 + a2 * 0.33 + a3 * 0.2;
        // packets: rounder clumps of aerated water tumbling down
        float pk = vnoise(vec2(s * 7.0 + lay * 3.0, (tau - t * 1.1 * sp) * 6.5));
        float pk2 = vnoise(vec2(s * 13.0 + 4.0, (tau - t * 1.25 * sp) * 11.0));
        streak = streak * 0.7 + smoothstep(0.45, 0.9, pk * 0.65 + pk2 * 0.35) * 0.45;
        float speed = max(tau, 0.0) * 9.8 + 1.5;
        // edges break up into spray
        float e = min(s, 1.0 - s);
        float edgeN = vnoise(vec2(s * 6.0, (tau - t * 1.2) * 3.0)) * 0.12;
        float edge = smoothstep(0.0, 0.16 + edgeN, e);
        float rim = 1.0 - smoothstep(0.0, 0.22, e);
        float top = smoothstep(-0.25, -0.05, tau);
        float lipFoam = smoothstep(0.25, 0.0, abs(tau - 0.02)) * 0.6;
        float bottom = smoothstep(uFallT - 0.35 - side * 0.1, uFallT - side * 0.1, tau);
        float dens = lay > 1.5 ? 0.55 : (lay > 0.5 ? 0.42 : 1.0);
        float alpha = smoothstep(0.36, 0.78, streak + 0.06 * (1.0 - lay) + bottom * 0.25) * edge * top * dens;
        alpha = max(alpha, rim * edge * smoothstep(0.45, 0.8, a2) * 0.6 * top);
        alpha = clamp(alpha + lipFoam * edge * 0.5 + bottom * 0.25 * edge, 0.0, 0.94);
        if (tau < 0.0) alpha *= 0.75 + 0.25 * smoothstep(0.4, 0.7, a1);
        float white = clamp((streak - 0.25) * 1.6 + rim * 0.35 + bottom * 0.4 + lipFoam, 0.0, 1.0);
        vec3 base = mix(vec3(0.3, 0.46, 0.45), vec3(0.95, 0.97, 0.95), white);
        vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 V = normalize(cameraPosition - vWorldP);
        float cookie = jgCookie(vWorldP);
        float wrap = max(dot(N, uLightDirW) * 0.5 + 0.5, 0.0);
        float back = pow(max(dot(-V, uLightDirW), 0.0), 4.0) * 1.2;
        vec3 lit = uAmb * 1.0 + uLightCol * cookie * (wrap * 0.55 + back * 0.8) * smoothstep(-0.1, 0.1, uLightDirW.y + 0.15);
        vec3 col = base * lit;
        // moonlight sheen on the streaks at night
        col += vec3(0.55, 0.72, 0.95) * uMoon * pow(white, 3.0) * (0.6 + 0.4 * sin(tau * 9.0 - t * 6.0 + s * 20.0));
        col = jgFog(col, vWorldP);
        gl_FragColor = vec4(col, alpha);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 3;
  mesh.frustumCulled = false;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Mist and splash particles (GPU animated)                             */
/* ------------------------------------------------------------------ */
export function buildMist(shared, puffTex, q, rng, { count = 70, origin, spread = 2.2 } = {}) {
  const n = Math.max(16, Math.round(count * q));
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const off = new Float32Array(n * 3), prm = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const a = rng.next() * TAU, r = Math.sqrt(rng.next()) * spread;
    off[i * 3] = Math.cos(a) * r * 1.3; off[i * 3 + 1] = rng.range(-0.2, 0.4); off[i * 3 + 2] = Math.sin(a) * r * 0.8;
    prm[i * 4] = rng.next(); prm[i * 4 + 1] = rng.range(0.07, 0.16); prm[i * 4 + 2] = rng.range(1.0, 2.4); prm[i * 4 + 3] = rng.next() * TAU;
  }
  geo.setAttribute('aOff', new THREE.InstancedBufferAttribute(off, 3));
  geo.setAttribute('aPrm', new THREE.InstancedBufferAttribute(prm, 4));
  geo.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, tPuff: { value: puffTex }, uOrigin: { value: origin.clone() }, uAmb: { value: new THREE.Color(0.3, 0.35, 0.33) }, uDensity: { value: 1 }, uRise: { value: 2.6 } },
    vertexShader: /* glsl */`
      uniform vec3 uOrigin; uniform float uTime, uRise;
      attribute vec3 aOff; attribute vec4 aPrm;
      varying vec2 vUv; varying float vAge; varying vec3 vWorldP;
      void main(){
        float age = fract(uTime * aPrm.y + aPrm.x);
        vAge = age;
        vec3 p = uOrigin + aOff * (1.0 + age * 1.6);
        p.y += age * uRise * (0.6 + aPrm.x * 0.6);
        p.x += sin(uTime * 0.3 + aPrm.w) * age * 0.8;
        p.z += age * 1.4;
        vWorldP = p;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        float size = aPrm.z * (0.5 + age * 1.1);
        float rot = aPrm.w + uTime * 0.05;
        vec2 c = position.xy;
        c = vec2(c.x * cos(rot) - c.y * sin(rot), c.x * sin(rot) + c.y * cos(rot));
        mv.xy += c * size;
        vUv = uv;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      ${JG_GLSL}
      uniform sampler2D tPuff; uniform vec3 uAmb; uniform float uDensity;
      varying vec2 vUv; varying float vAge;
      void main(){
        float a = texture2D(tPuff, vUv).a;
        float life = smoothstep(0.0, 0.15, vAge) * (1.0 - smoothstep(0.55, 1.0, vAge));
        a *= life * 0.2 * uDensity;
        if (a < 0.003) discard;
        vec3 V = normalize(cameraPosition - vWorldP);
        float cookie = jgCookie(vWorldP);
        float fwd = pow(max(dot(-V, uLightDirW), 0.0), 3.0);
        vec3 col = uAmb * 1.25 + uLightCol * cookie * (0.35 + fwd * 1.4) * smoothstep(-0.1, 0.1, uLightDirW.y + 0.15);
        col = jgFog(col, vWorldP);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return mesh;
}

export function buildSplash(shared, spriteTex, q, rng, { count = 260, origin } = {}) {
  const n = Math.max(40, Math.round(count * q));
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), prm = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = rng.range(-1.3, 1.3); pos[i * 3 + 1] = 0; pos[i * 3 + 2] = rng.range(-0.3, 0.4);
    prm[i * 4] = rng.next(); prm[i * 4 + 1] = rng.range(0.7, 1.4); prm[i * 4 + 2] = rng.next() * TAU; prm[i * 4 + 3] = rng.range(1.5, 4.5);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPrm', new THREE.BufferAttribute(prm, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, tSprite: { value: spriteTex }, uOrigin: { value: origin.clone() }, uAmb: { value: new THREE.Color(0.3, 0.35, 0.33) }, uScale: { value: 300 }, uSplashT: { value: 0 } },
    vertexShader: /* glsl */`
      uniform vec3 uOrigin; uniform float uSplashT, uScale;
      attribute vec4 aPrm;
      varying float vA; varying vec3 vWorldP;
      void main(){
        // rates on a 1/16 grid: every droplet's cycle repeats after 16 / 0.9 s, where JS wraps uSplashT
        float rate = floor(aPrm.y * 16.0 + 0.5) / 16.0;
        float age = fract(uSplashT * rate * 0.9 + aPrm.x);
        float ang = aPrm.z;
        vec3 v = vec3(cos(ang) * aPrm.w * 0.55, aPrm.w * 0.9, sin(ang) * aPrm.w * 0.35 + 0.8);
        float tt = age * 0.75;
        vec3 p = uOrigin + position + v * tt + vec3(0.0, -4.9 * tt * tt, 0.0);
        vWorldP = p;
        // fade in at birth and out as the droplet drops back into the pool (both used to be hard cuts)
        vA = (1.0 - age) * smoothstep(0.0, 0.05, age) * smoothstep(${WATER_Y.toFixed(3)} - 0.08, ${WATER_Y.toFixed(3)} + 0.02, p.y);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        // at least 2.5 px wide and soft, with the light of the old one-pixel point (see fx.js pointsMaterial)
        float ps = uScale * (0.03 + aPrm.x * 0.04) / max(-mv.z, 0.01);
        float psd = clamp(ps, 2.5, 12.0);
        vA *= min(1.0, max(1.0, 0.226 * ps * ps) / (0.226 * psd * psd));
        gl_PointSize = psd;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      ${JG_GLSL}
      uniform sampler2D tSprite; uniform vec3 uAmb;
      varying float vA;
      void main(){
        float a = texture2D(tSprite, gl_PointCoord).r * vA * 0.75;
        if (a < 0.01) discard;
        float cookie = jgCookie(vWorldP);
        vec3 col = uAmb * 1.6 + uLightCol * cookie * 0.9;
        gl_FragColor = vec4(jgFog(col, vWorldP), a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  pts.userData.period = 16 / 0.9;
  return pts;
}
