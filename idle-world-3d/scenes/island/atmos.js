// 晴岛 · layered light: rays of sunlight streaming down through gaps in the cloud bank toward the low sun (morning and
// golden hour), and banks of sea mist lying far out on the water at dawn, in depth (near, middle and far).
// Two draw calls, both off (invisible) whenever they have nothing to show; everything is made here, in create().
//
// Rays: a few long soft cards, each turned about its own axis to face the camera, laid parallel to the sunlight from
// up in the cloud bank down to the sea. Additive, faded toward both ends (into the cloud above, into the sea below,
// so they never meet the water with an edge), dimmed with distance and when looking away from the sun (light
// scatters forward). They change only over tens of seconds (cloud gaps opening and closing), never flicker.
// Mist: wide cards standing on the sea around the horizon, facing the camera, premultiplied; their billowing top is
// a soft noise texture that drifts slowly with the wind.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, makeRng } from '../../lib/util.js';
import { LAYER_NO_REFLECT } from './shared.js';

const RAY_VERT = /* glsl */`
attribute vec4 aBot;   // where the ray meets the sea (xyz), half-width (m)
attribute vec4 aTop;   // where it leaves the cloud (xyz), strength
varying vec2 vUv;
varying vec3 vW;
varying float vK;
void main() {
  vec3 axis = aTop.xyz - aBot.xyz;
  vec3 mid = (aTop.xyz + aBot.xyz) * 0.5;
  vec3 toCam = normalize(cameraPosition - mid);
  vec3 side = normalize(cross(axis, toCam));
  // position: x in [-0.5, 0.5] across, y in [-0.5, 0.5] along (bottom to top)
  vec3 wp = mix(aBot.xyz, aTop.xyz, position.y + 0.5) + side * position.x * 2.0 * aBot.w * (1.35 - 0.35 * (position.y + 0.5));
  vUv = vec2(position.x * 2.0, position.y + 0.5);
  vW = wp;
  vK = aTop.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const RAY_FRAG = /* glsl */`
uniform vec3 uRayCol, uSunDir;
varying vec2 vUv;
varying vec3 vW;
varying float vK;
void main() {
  float across = 1.0 - vUv.x * vUv.x;
  float a = across * across;
  // into the cloud at the top, into the sea's haze at the bottom (never an edge on the water)
  a *= smoothstep(1.0, 0.72, vUv.y) * smoothstep(0.0, 6.0, vW.y);
  vec3 V = vW - cameraPosition;
  float dist = length(V);
  V /= dist;
  // light scatters forward: brightest looking toward the sun, still there across the light, faint looking away;
  // nothing right by the camera
  float cs = max(dot(V, uSunDir), 0.0);
  float phase = 0.3 + 0.7 * cs * cs * cs;
  a *= phase * smoothstep(40.0, 110.0, dist) * (1.0 - smoothstep(1400.0, 2600.0, dist));
  // a couple of soft bands down its length (fixed: nothing in a ray ever moves fast enough to shimmer)
  a *= 0.78 + 0.22 * sin(vUv.x * 3.1 + vK * 40.0);
  a *= fract(vK);
  if (a < 0.002) discard;
  gl_FragColor = vec4(uRayCol * a, 0.0);
}
`;

const MIST_VERT = /* glsl */`
attribute vec4 aM;    // centre xz, half-width, height
attribute vec4 aM2;   // density, seed, distance band (0 near .. 1 far), unused
uniform float uDrift;
varying vec2 vUv;
varying vec3 vW;
varying vec4 vM;
void main() {
  vec3 c = vec3(aM.x, 0.0, aM.y);
  vec3 toCam = cameraPosition - c; toCam.y = 0.0;
  toCam = normalize(toCam);
  vec3 side = vec3(toCam.z, 0.0, -toCam.x);
  vec3 wp = c + side * position.x * 2.0 * aM.z + vec3(0.0, (position.y + 0.5) * aM.w - 1.0, 0.0);
  vUv = vec2(position.x * 2.0, position.y + 0.5);
  vW = wp;
  vM = vec4(aM2.xyz, uDrift + aM2.y * 13.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;
const MIST_FRAG = /* glsl */`
uniform sampler2D tNoise;
uniform vec3 uMistLit, uMistShade, uSunDir;
uniform float uMistK;
varying vec2 vUv;
varying vec3 vW;
varying vec4 vM;
void main() {
  // billows: two drifts of a soft tiling noise, coarse enough never to alias
  float n = texture2D(tNoise, vec2(vUv.x * 2.2 + vM.w * 0.004, vUv.y * 0.55 + vM.y)).r * 0.65
          + texture2D(tNoise, vec2(vUv.x * 5.1 - vM.w * 0.006 + 0.37, vUv.y * 1.3 + 0.21)).r * 0.35;
  float h = vUv.y;
  // thickest a few metres above the water, a ragged top; soft at both ends; it rises out of the sea from nothing
  float mound = 1.0 - 0.45 * vUv.x * vUv.x;                 // each bank rises toward its middle
  float top = smoothstep(0.95 * mound, (0.3 + 0.4 * n) * mound, h);
  float a = top * smoothstep(-1.0, 3.0, vW.y) * (1.0 - smoothstep(0.6, 1.0, abs(vUv.x)));
  // a bank never comes up close (where it would veil the view): it thins away within ~150 m of the camera
  a *= smoothstep(70.0, 150.0, length(vW.xz - cameraPosition.xz));
  a *= vM.x * uMistK * (0.65 + 0.5 * n);
  if (a < 0.003) discard;
  vec3 V = normalize(vW - cameraPosition);
  float fwd = pow(max(dot(V, uSunDir), 0.0), 4.0);
  vec3 col = mix(uMistShade, uMistLit, 0.35 + 0.4 * n + 0.6 * fwd);
  gl_FragColor = vec4(col * a, a);
}
`;

export function createAtmos(env, rng0) {
  const q = env.q;
  const rng = makeRng(env.seed ^ 0xa7);
  const group = new THREE.Group();
  group.name = 'atmos';

  /* ---------------- rays ---------------- */
  const NR = q >= 0.9 ? 11 : q >= 0.6 ? 9 : 8;
  const quad = new THREE.PlaneGeometry(1, 1, 1, 6); // a few rows: the width flares toward the sea
  const rgeo = new THREE.InstancedBufferGeometry();
  rgeo.index = quad.index;
  rgeo.setAttribute('position', quad.attributes.position);
  const aBot = new THREE.InstancedBufferAttribute(new Float32Array(NR * 4), 4);
  const aTop = new THREE.InstancedBufferAttribute(new Float32Array(NR * 4), 4);
  aBot.setUsage(THREE.DynamicDrawUsage); aTop.setUsage(THREE.DynamicDrawUsage);
  rgeo.setAttribute('aBot', aBot); rgeo.setAttribute('aTop', aTop);
  rgeo.instanceCount = NR;
  const RU = { uRayCol: { value: new THREE.Color(0, 0, 0) }, uSunDir: { value: new THREE.Vector3(0, 1, 0) } };
  const rmat = new THREE.ShaderMaterial({
    name: 'SunRays', uniforms: RU, vertexShader: RAY_VERT, fragmentShader: RAY_FRAG,
    transparent: true, depthWrite: false,
    // light added straight onto what is behind (colour ONE + ONE, alpha left alone): three's AdditiveBlending
    // weights the source by its alpha, which is 0 here, so the rays added nothing at all
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
  });
  const rays = new THREE.Mesh(rgeo, rmat);
  rays.name = 'sunRays';
  rays.frustumCulled = false;
  rays.renderOrder = 4.6;
  rays.layers.set(LAYER_NO_REFLECT);
  rays.visible = false;
  group.add(rays);
  // each ray: its place relative to the sun's bearing, length, width, and its own slow life (a cloud gap that opens
  // and closes over a minute or two). Half stand toward the sun; the rest ring the island further out, so wherever
  // the screensaver has turned there are shafts slanting down across the far sea behind it
  const R = [];
  const nSun = Math.ceil(NR / 2);
  for (let i = 0; i < NR; i++) {
    const sunward = i < nSun;
    const off = sunward ? (i / (nSun - 1) - 0.5) * 1.4 + rng.range(-0.08, 0.08)
      : 0.9 + ((i - nSun + 0.5) / (NR - nSun)) * (TAU - 1.8) + rng.range(-0.15, 0.15);
    R.push({
      off, dist: sunward ? rng.range(70, 200) : rng.range(100, 240), top: rng.range(85, 135),
      w: rng.range(7, 17), rate: TAU / rng.range(70, 140), ph: rng.range(0, TAU), k: rng.range(0.7, 1), seed: rng.range(0, 1),
    });
  }

  /* ---------------- mist banks ---------------- */
  const NM = q >= 0.9 ? 14 : q >= 0.6 ? 11 : 9;
  const mquad = new THREE.PlaneGeometry(1, 1, 8, 2);
  const mgeo = new THREE.InstancedBufferGeometry();
  mgeo.index = mquad.index;
  mgeo.setAttribute('position', mquad.attributes.position);
  const aM = new THREE.InstancedBufferAttribute(new Float32Array(NM * 4), 4);
  const aM2 = new THREE.InstancedBufferAttribute(new Float32Array(NM * 4), 4);
  mgeo.setAttribute('aM', aM); mgeo.setAttribute('aM2', aM2);
  mgeo.instanceCount = NM;
  // banks around the whole horizon (the screensaver orbits), in three depth bands
  const banks = [];
  for (let i = 0; i < NM; i++) {
    const band = i % 3;                                       // 0 near, 1 middle, 2 far
    const ang = i / NM * TAU + rng.range(-0.25, 0.25);
    const r = [rng.range(110, 170), rng.range(220, 320), rng.range(420, 640)][band];
    const half = r * rng.range(0.18, 0.32);                  // separate banks with open sea between them
    const h = [rng.range(10, 15), rng.range(15, 24), rng.range(24, 36)][band];
    const dens = [0.6, 0.72, 0.85][band] * rng.range(0.8, 1.1);
    aM.setXYZW(i, Math.cos(ang) * r, Math.sin(ang) * r, half, h);
    aM2.setXYZW(i, dens, rng.range(0, 1), band / 2, 0);
    banks.push({ ang, r });
  }
  aM.needsUpdate = true; aM2.needsUpdate = true;
  const noise = mistNoise(rng.int(1, 1e6));
  const MU = {
    tNoise: { value: noise }, uDrift: { value: 0 }, uMistK: { value: 0 },
    uMistLit: { value: new THREE.Color(1, 0.8, 0.7) }, uMistShade: { value: new THREE.Color(0.5, 0.55, 0.7) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  };
  const mmat = new THREE.ShaderMaterial({
    name: 'SeaMist', uniforms: MU, vertexShader: MIST_VERT, fragmentShader: MIST_FRAG,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  const mist = new THREE.Mesh(mgeo, mmat);
  mist.name = 'seaMist';
  mist.frustumCulled = false;
  mist.renderOrder = 2;
  mist.layers.set(LAYER_NO_REFLECT);
  mist.visible = false;
  group.add(mist);

  /* ---------------- light ---------------- */
  const S = { rays: 0, mist: 0, sunDir: new THREE.Vector3(0, 1, 0) };
  const _d = new THREE.Vector3();
  /** From the time of day (island.js): sun direction and colour (× intensity), horizon and sky colours, the hour. */
  function setLight(L) {
    S.sunDir.copy(L.sunDir);
    const e = L.elev, morning = L.hours < 12;
    // rays: while the sun is low but up (morning, and the golden hours before sunset)
    S.rays = smoothstep(1.5, 5, e) * (1 - smoothstep(morning ? 28 : 24, morning ? 42 : 34, e)) * (morning ? 0.85 : 1);
    RU.uSunDir.value.copy(L.sunDir);
    // sunlight scattered by the haze in the shaft: the sun's colour, a little of the sky's
    RU.uRayCol.value.copy(L.sunCol).multiplyScalar(0.4).add(_c.copy(L.horizon).multiplyScalar(0.15)).multiplyScalar(S.rays * (1 + 0.4 * L.golden));
    // mist: dawn, from first light until the sun has climbed a little
    S.mist = morning ? smoothstep(-10, -4, e) * (1 - smoothstep(5, 14, e)) : 0;
    MU.uMistK.value = S.mist;
    MU.uSunDir.value.copy(L.sunDir);
    // mist scatters the whole sky's light: a little brighter than the hazy sea it lies on, warm where the first sun
    // catches it (it must read as banks of mist, not as more haze)
    MU.uMistLit.value.copy(L.horizon).multiplyScalar(1.3).add(_c.copy(L.sunCol).multiplyScalar(0.22));
    MU.uMistShade.value.copy(L.horizon).lerp(_c.copy(L.zenith), 0.25).multiplyScalar(1.2);
  }
  const _c = new THREE.Color();

  let t0 = 0;
  function update(dt, t) {
    t0 = (t0 + dt) % 1e4;
    rays.visible = S.rays > 0.003;
    if (rays.visible) {
      // the rays stand where the sun is: on the sea toward the sun's bearing, rising (parallel to the sunlight, at
      // least 14 degrees up so they stay a sensible length) into the cloud bank
      const sd = S.sunDir, el = Math.max(Math.asin(clamp(sd.y, -1, 1)), THREE.MathUtils.degToRad(14));
      const az = Math.atan2(sd.x, sd.z);
      for (let i = 0; i < NR; i++) {
        const r = R[i];
        const a = az + r.off;
        const bx = Math.sin(a) * r.dist, bz = Math.cos(a) * r.dist;
        const len = r.top / Math.sin(el);
        const tx = bx + Math.sin(az) * Math.cos(el) * len, tz = bz + Math.cos(az) * Math.cos(el) * len;
        // a gap in the clouds opening and closing (strength in the fraction, an id in the integer part)
        const life = smoothstep(0.15, 0.75, 0.5 + 0.5 * Math.sin(t * r.rate + r.ph));
        aBot.setXYZW(i, bx, 0, bz, r.w);
        aTop.setXYZW(i, tx, r.top, tz, i + Math.min(0.999, r.k * life));
      }
      aBot.needsUpdate = true; aTop.needsUpdate = true;
    }
    mist.visible = S.mist > 0.003;
    if (mist.visible) MU.uDrift.value = t0;
  }

  return {
    group, setLight, update,
    dispose() { quad.dispose(); rgeo.dispose(); rmat.dispose(); mquad.dispose(); mgeo.dispose(); mmat.dispose(); noise.dispose(); },
  };
}

/** Soft tiling noise for the mist's billows (two octaves of value noise on a torus; linear, mipmapped). */
function mistNoise(seed) {
  const rng = makeRng(seed);
  const N = 128, M = 16;
  const g = new Float32Array(M * M);
  for (let i = 0; i < M * M; i++) g[i] = rng.next();
  const v = (x, y, p) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const i0 = ((xi % p) + p) % p, j0 = ((yi % p) + p) % p, i1 = (i0 + 1) % p, j1 = (j0 + 1) % p;
    const a = g[j0 * M + i0], b = g[j0 * M + i1], c = g[j1 * M + i0], d = g[j1 * M + i1];
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const n = v(x / N * 4, y / N * 4, 4) * 0.62 + v(x / N * 8 + 0.5, y / N * 8 + 0.5, 8) * 0.38;
    const o = (y * N + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = Math.round(clamp(n, 0, 1) * 255); data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}
