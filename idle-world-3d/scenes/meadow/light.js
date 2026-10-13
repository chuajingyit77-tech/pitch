// 芒原 · layered light: shafts of low sun (or moon) through the maples and across the field, and ground mist in
// near, mid and far banks drifting over the grass.
//
// Fill-rate is the iPad's limit, so both are cheap: a handful of thin additive shaft cards (one draw), and three
// low mist ribbons (premultiplied, one texture pair each) that are switched off entirely while they are not wanted.
// Nothing shimmers: every gradient is soft, the shafts turn only with the sun, and both drift on wrapped clocks.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep } from '../../lib/util.js';
import { FOG_GLSL } from './sky.js';

/* ------------------------------------------------------------------ */
/* Light shafts                                                        */
/* ------------------------------------------------------------------ */
// A shaft is a card along the light's travel direction, turned about that axis to face the camera. It fades in
// from its origin inside a canopy, fades out before it reaches the grass (no hard line where it meets the ground),
// gets weaker looking away from the light (forward scattering), and fades near the camera and into the haze.
const SHAFT_VS = /* glsl */`
attribute vec4 aO;     // origin, length
attribute vec4 aW;     // width at the origin, at the end, seed, strength
uniform vec3 uL;
varying vec2 vC; varying float vSeed; varying float vK; varying vec3 vW;
void main() {
  float along = position.y, side = position.x;
  vec3 p = aO.xyz + uL * (along * aO.w);
  vec3 toCam = cameraPosition - p;
  float dc = length(toCam);
  toCam /= max(dc, 1e-3);
  vec3 ax = cross(uL, toCam);
  float al = length(ax);
  ax = al > 1e-3 ? ax / al : vec3(1.0, 0.0, 0.0);
  p += ax * side * mix(aW.x, aW.y, along);
  // forward scattering: brightest looking toward the light; a shaft seen end-on (al small) narrows away
  float ph = 0.18 + 0.82 * pow(max(dot(-toCam, uL), 0.0), 3.0);
  vK = aW.w * ph * smoothstep(0.08, 0.3, al) * smoothstep(2.5, 7.0, dc);
  vC = vec2(side, along); vSeed = aW.z; vW = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const SHAFT_FS = /* glsl */`
uniform vec3 uColor; uniform float uTime;
varying vec2 vC; varying float vSeed; varying float vK; varying vec3 vW;
${FOG_GLSL}
void main() {
  float across = 1.0 - vC.x * vC.x; across *= across;
  float ends = smoothstep(0.0, 0.2, vC.y) * (1.0 - smoothstep(0.5, 1.0, vC.y));
  // motes of dust drift slowly down the beam (two slow waves, wrapped clock)
  float dust = 0.8 + 0.2 * sin(vC.y * 7.0 - uTime * 0.2 + vSeed * 6.3) * sin(vC.y * 3.1 + uTime * 0.13 + vSeed * 2.1);
  vec3 rd = vW - cameraPosition; float dist = length(rd); rd /= max(dist, 1e-3);
  float haze = fogLayer(cameraPosition, rd, dist, uFogHaze, uFogHazeFall) + fogLayer(cameraPosition, rd, dist, uFogMist, uFogMistFall);
  float a = across * ends * dust * vK * (1.0 - clamp(haze, 0.0, 1.0));
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

export function createShafts({ scene, fogU, trees, heightAt, rng, q, target }) {
  const nTree = q > 0.6 ? 3 : 2, nField = q > 0.6 ? 4 : 2;
  const hero = trees.slice(0, 2);
  const shafts = [];
  for (const t of hero) {
    // the upper, outer clusters of the canopy: light breaks through its gaps
    const cl = t.clusters.slice().sort((a, b) => b.p.y - a.p.y).slice(0, Math.max(nTree + 1, 3));
    for (let i = 0; i < nTree; i++) {
      const c = cl[i % cl.length];
      shafts.push({ kind: 'tree', base: new THREE.Vector3(t.x + c.p.x + rng.range(-0.5, 0.5), t.y + c.p.y - rng.range(0.2, 0.6), t.z + c.p.z + rng.range(-0.5, 0.5)),
        w0: rng.range(0.22, 0.4), w1: rng.range(0.55, 0.95), k: rng.range(0.75, 1.0), seed: rng.next() });
    }
  }
  for (let i = 0; i < nField; i++) {
    // long beams over the field, from the light's side: placed relative to it every frame
    shafts.push({ kind: 'field', lat: lerp(-16, 16, (i + 0.5) / nField) + rng.range(-3, 3), back: rng.range(26, 40), h: rng.range(7, 11),
      w0: rng.range(0.9, 1.5), w1: rng.range(2.2, 3.4), k: rng.range(0.4, 0.6), seed: rng.next(), base: new THREE.Vector3() });
  }
  const n = shafts.length;
  const geo = new THREE.InstancedBufferGeometry();
  const P = [], I = [];
  const SEG = 6;
  for (let s = 0; s <= SEG; s++) { const y = s / SEG; P.push(-1, y, 0, 1, y, 0); }
  for (let s = 0; s < SEG; s++) { const a = s * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setIndex(I);
  const aO = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aW = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  shafts.forEach((s, i) => aW.setXYZW(i, s.w0, s.w1, s.seed, s.k));
  geo.setAttribute('aO', aO); geo.setAttribute('aW', aW);
  geo.instanceCount = n;
  const U = { ...fogU, uL: { value: new THREE.Vector3(0, -1, 0) }, uColor: { value: new THREE.Color() }, uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: SHAFT_VS, fragmentShader: SHAFT_FS, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'lightShafts';
  mesh.frustumCulled = false;
  mesh.renderOrder = 4.5;
  mesh.visible = false;
  scene.add(mesh);
  const lastL = new THREE.Vector3(9, 9, 9), side = new THREE.Vector3(), o = new THREE.Vector3();
  let clock = 0;
  return {
    mesh,
    /** L: light travel direction (unit, pointing down), col: colour × strength (linear HDR); 0 hides them. */
    update(dt, L, col, strength) {
      clock = (clock + dt) % (TAU * 100);
      U.uTime.value = clock;
      mesh.visible = strength > 0.004;
      if (!mesh.visible) return;
      U.uColor.value.copy(col).multiplyScalar(strength);
      U.uL.value.copy(L);
      if (lastL.distanceToSquared(L) < 1e-6) return;
      lastL.copy(L);
      side.set(-L.z, 0, L.x).normalize();
      shafts.forEach((s, i) => {
        if (s.kind === 'field') {
          // start high over the field on the light's side, aimed across it toward the view
          o.copy(target).addScaledVector(L, -s.back).addScaledVector(side, s.lat);
          o.y = Math.max(o.y, heightAt(o.x, o.z) + s.h);
        } else o.copy(s.base);
        // length: until the beam is down in the grass (it has faded out by then), at most 26 m
        let len = 26;
        for (let d = 1; d <= 26; d += 0.5) {
          const x = o.x + L.x * d, y = o.y + L.y * d, z = o.z + L.z * d;
          if (y < heightAt(x, z) + 0.9) { len = d; break; }
        }
        aO.setXYZW(i, o.x, o.y, o.z, Math.max(len, 1.5));
      });
      aO.needsUpdate = true;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}

/* ------------------------------------------------------------------ */
/* Ground mist                                                         */
/* ------------------------------------------------------------------ */
// Three low ribbons bent round the view's centre: near (between the viewer and the torii), mid (behind the shrine)
// and far (across the far field). Each is a soft curtain standing in the grass, its foot below the ground and
// faded out (no line where it meets the terrain), its noise drifting with the wind on two layers.
const MIST_VS = /* glsl */`
varying vec2 vUv; varying vec3 vW;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const MIST_FS = /* glsl */`
uniform sampler2D tNoise; uniform vec3 uColor, uGlow, uGlowDir; uniform float uAlpha, uSpan; uniform vec2 uDrift, uDrift2;
varying vec2 vUv; varying vec3 vW;
${FOG_GLSL}
void main() {
  float n1 = texture2D(tNoise, vec2(vUv.x * 0.055 + uDrift.x, vUv.y * 0.32 + uDrift.y)).r;
  float n2 = texture2D(tNoise, vec2(vUv.x * 0.13 - uDrift2.x, vUv.y * 0.55 + 0.37)).g;
  float n = n1 * 0.62 + n2 * 0.38;
  float prof = smoothstep(0.08, 0.42, vUv.y) * (1.0 - smoothstep(0.42, 1.0, vUv.y));
  float ends = smoothstep(0.0, 0.18, vUv.x / uSpan) * (1.0 - smoothstep(0.82, 1.0, vUv.x / uSpan));
  vec3 rd = vW - cameraPosition; float dist = length(rd); rd /= max(dist, 1e-3);
  float a = prof * ends * smoothstep(0.22, 0.78, n) * uAlpha * smoothstep(1.5, 5.0, dist);
  float sc = pow(max(dot(rd, uGlowDir), 0.0), 4.0);
  vec3 col = uColor + uGlow * sc;
  col = applyMeadowFog(col, vW);
  gl_FragColor = vec4(col * a, a);
}`;

export function createMist({ scene, fogU, heightAt, rng, target, noiseTex }) {
  const layers = [
    { name: 'mistNear', r: 7.5, a0: -1.5, a1: 1.5, h: 0.95, k: 0.55, seg: 28, sink: 0.35 },
    { name: 'mistMid', r: 19, a0: Math.PI - 1.15, a1: Math.PI + 1.15, h: 2.3, k: 0.8, seg: 32, sink: 0.4 },
    { name: 'mistFar', r: 50, a0: Math.PI - 1.05, a1: Math.PI + 1.05, h: 5.5, k: 1.0, seg: 40, sink: 0.6 },
  ];
  const out = [];
  for (const L of layers) {
    const P = [], UV = [], I = [];
    const span = (L.a1 - L.a0) * L.r;
    for (let i = 0; i <= L.seg; i++) {
      const a = lerp(L.a0, L.a1, i / L.seg);
      const r = L.r * (1 + 0.06 * Math.sin(a * 3.1 + rng.range(0, TAU)));
      const x = target.x + Math.sin(a) * r, z = target.z + Math.cos(a) * r;
      const g = heightAt(x, z);
      P.push(x, g - L.sink, z, x, g + L.h, z);
      const u = span * i / L.seg;
      UV.push(u, 0, u, 1);
    }
    for (let i = 0; i < L.seg; i++) { const a = i * 2; I.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    geo.setIndex(I);
    const U = { ...fogU, tNoise: { value: noiseTex }, uColor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uGlowDir: { value: new THREE.Vector3(0, 0, -1) },
      uAlpha: { value: 0 }, uSpan: { value: span }, uDrift: { value: new THREE.Vector2(rng.next(), rng.next()) }, uDrift2: { value: new THREE.Vector2(rng.next(), 0) } };
    const mat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: MIST_VS, fragmentShader: MIST_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = L.name;
    mesh.frustumCulled = false;
    mesh.renderOrder = 3 + out.length * -0.1;   // far first
    mesh.visible = false;
    scene.add(mesh);
    out.push({ L, U, mesh, geo, mat, span });
  }
  return {
    layers: out,
    /**
     * amount: 0..1 overall density for this hour; col / glow: mist colour and the forward-scatter tint (linear);
     * glowDir: toward the sun or moon; wind: Vector2 direction (drift); camDist: camera distance to the target.
     */
    update(dt, amount, col, glow, glowDir, wind, camDist) {
      for (const m of out) {
        let a = amount * m.L.k;
        // the near bank thins away as the camera closes in on it (and costs nothing then)
        if (m.L.name === 'mistNear') a *= smoothstep(10.5, 14, camDist);
        m.mesh.visible = a > 0.003;
        if (!m.mesh.visible) continue;
        m.U.uAlpha.value = a;
        m.U.uColor.value.copy(col);
        m.U.uGlow.value.copy(glow);
        m.U.uGlowDir.value.copy(glowDir);
        // drift along the ribbon with the wind (texture repeats: wrap at whole tiles)
        const d = m.U.uDrift.value, d2 = m.U.uDrift2.value;
        d.x = (d.x + wind.x * dt * 0.012) % 1; d.y = (d.y + dt * 0.003) % 1;
        d2.x = (d2.x + wind.x * dt * 0.02 + dt * 0.004) % 1;
      }
    },
    dispose() { out.forEach(m => { m.geo.dispose(); m.mat.dispose(); }); },
  };
}
