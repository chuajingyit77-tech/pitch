// 晴岛 water: one continuous surface from the lapping shoreline to the horizon.
// - Planar mirror reflection (one extra pass, reduced resolution, adapted from three/examples Water.js, MIT)
// - Gerstner swell that calms down over the lagoon (seabed height from the shared field texture)
// - Transparent, Fresnel-weighted surface: the clear water body itself is the seabed tinted by the
//   shared absorption (see shared.js), so turquoise shallows fade seamlessly into deep blue.
// - Foam: swash edge, incoming wavelets, reef surf, rocks/posts, whitecaps; bioluminescent at night.
import * as THREE from 'three';
import { GLSL, TAU, smoothstep } from '../../lib/util.js';
import { waterUniforms } from './shared.js';
import { fieldUniforms, SWASH_GLSL } from './terrain.js';

const WAVES = [
  [1.0, 0.35, 0.11, 17.0],
  [0.55, 0.9, 0.09, 9.7],
  [-0.4, 1.0, 0.075, 6.1],
  [0.92, -0.5, 0.055, 3.7],
];
const WV = WAVES.map(([dx, dz, st, len]) => {
  const l = Math.hypot(dx, dz), k = TAU / len;
  return { dx: dx / l, dz: dz / l, k, c: Math.sqrt(9.8 / k), a: st / k };
});
const AMP_SUM = WV.reduce((s, w) => s + w.a, 0);

/** Vertical wave displacement on the CPU (for floating things). depth = seabed depth below 0. */
export function waveHeight(x, z, t, depth = 20) {
  const atten = smoothstep(0.3, 5.5, depth);
  if (atten <= 0) return 0;
  let y = 0;
  for (const w of WV) y += w.a * Math.sin(w.k * (w.dx * x + w.dz * z - w.c * t));
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
    float c = sqrt(9.8 / k);
    float f = k * (dot(w.xy, p.xz) - c * uWTime);
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
uniform float uWTime;
uniform vec3 uSunDir, uSunCol, uMoonDir, uMoonCol;
uniform vec3 uSSS, uFoamCol, uGlow, uHorizon;
uniform float uNight, uReflStrength, uHazeNear, uHazeFar, uMirrorOn;
uniform vec3 uSkyFallback;
${GLSL.noise}
${SWASH_GLSL}
varying vec4 vMirror;
varying vec3 vWPos;
varying vec3 vN;
varying float vCrest;

float sparkle(vec2 p, float t, float density) {
  vec2 c = floor(p);
  vec2 f = fract(p) - 0.5;
  float h = hash12(c);
  float tt = t * (1.2 + h * 2.2) + h * 37.0;
  float seed = floor(tt);
  float on = step(1.0 - density, hash12(c + seed * 7.13));
  vec2 o = (hash22(c + seed * 3.7) - 0.5) * 0.55;
  return on * sin(fract(tt) * 3.14159) * smoothstep(0.2, 0.0, length(f - o));
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

  // detail normals (three scrolling octaves), calmer over the lagoon, fading with distance
  vec3 n1 = texture2D(tNormal, p * 0.105 + vec2(t * 0.021, t * 0.013)).rgb * 2.0 - 1.0;
  vec3 n2 = texture2D(tNormal, p * 0.043 - vec2(t * 0.011, -t * 0.016)).rgb * 2.0 - 1.0;
  vec3 n3 = texture2D(tNormal, p * 0.26 + vec2(-t * 0.031, t * 0.027)).rgb * 2.0 - 1.0;
  vec2 slope = n1.xy * 0.45 + n2.xy * 0.6 + n3.xy * 0.28;
  float calm = mix(0.5, 1.0, smoothstep(0.3, 3.5, depth));
  float farK = 1.0 - smoothstep(50.0, 900.0, dist) * 0.75;
  vec3 N = normalize(vN + vec3(slope.x, 0.0, slope.y) * 0.32 * calm * farK);

  float NdV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  F = clamp(F * uReflStrength, 0.0, 1.0);

  // rougher, blurrier reflections over the open swell; crisp over the calm lagoon
  float rough = smoothstep(1.0, 6.0, depth);
  vec2 ruv = vMirror.xy / vMirror.w + N.xz * mix(0.03, 0.075, rough) / (1.0 + dist * 0.006);
  vec3 refl = mix(uSkyFallback, textureLod(tMirror, ruv, mix(1.1, 3.6, rough)).rgb, uMirrorOn);

  // sun + moon speculars and a glittering path made of discrete sparkles
  vec3 R = reflect(-V, N);
  float sd = max(dot(R, uSunDir), 0.0);
  float spk = sparkle(p * 3.1, t, 0.085) + sparkle(p * 5.7 + 17.0, t * 1.3, 0.07) * 0.8;
  vec3 spec = uSunCol * (pow(sd, 1200.0) * 9.0 + pow(sd, 160.0) * 0.45 + pow(sd, 48.0) * spk * 14.0 * farK);
  float md = max(dot(R, uMoonDir), 0.0);
  spec += uMoonCol * (pow(md, 2600.0) * 2.2 + pow(md, 160.0) * 0.12 + pow(md, 30.0) * spk * 8.0 * farK);

  // subsurface glow through the swell crests (Sea of Thieves turquoise)
  float crest = clamp(vCrest * 1.15, 0.0, 1.0);
  float back = pow(max(dot(-V, uSunDir), 0.0), 2.5);
  vec3 sss = uSSS * crest * crest * (0.35 + 1.6 * back) * smoothstep(2.0, 7.0, depth);

  // ---- foam ----
  float fn = vnoise(p * 1.55 + vec2(t * 0.25, -t * 0.18)) * 0.6 + vnoise(p * 4.3 - vec2(t * 0.33, t * 0.29)) * 0.4;
  float edge = 1.0 - smoothstep(0.0, 0.13, depth);
  float foamEdge = edge * smoothstep(0.28, 0.5, fn + edge * 0.35);
  float uu = max(u, 0.0);
  float ph = swashPhase(p, uu, t);
  float lines = pow(0.5 + 0.5 * sin(ph + 1.35), 9.0) * (1.0 - smoothstep(0.6, 6.5, u)) * step(-0.3, u);
  lines *= smoothstep(0.32, 0.62, fn);
  float lace = smoothstep(0.6, 0.82, vnoise(p * 2.4 + vec2(t * 0.07, -t * 0.05))) * (1.0 - smoothstep(0.0, 2.6, u)) * 0.32 * smoothstep(0.3, 0.6, fn);
  float ob = fld.b * smoothstep(0.3, 0.7, fn * 0.8 + 0.3 * sin(t * 1.6 + p.x * 1.7 + p.y * 1.3));
  // reef surf: streaks running along the reef edge, rolling shoreward in sets
  float ang = atan(p.y, p.x);
  float rr = length(p);
  vec2 rp = vec2(ang * 18.0, rr * 1.4 + t * 0.35);
  float streak = vnoise(rp * vec2(1.0, 1.6)) * 0.65 + vnoise(rp * vec2(2.3, 3.1) + 7.0) * 0.35;
  float reefSet = smoothstep(0.35, 0.9, 0.5 + 0.5 * sin(t * 0.6 + ang * 3.0 + vnoise(p * 0.05) * 6.0));
  float reef = fld.a * smoothstep(0.5, 0.8, streak) * (0.35 + 0.65 * reefSet) * 0.65;
  // whitecaps: sparse lacy streaks riding the swell crests (stretched along the wind)
  vec2 wp2 = vec2(p.x * 0.8 + p.y * 0.35, p.y * 1.6 - p.x * 0.5);
  float lacyN = vnoise(wp2 * 2.2 + vec2(t * 0.4, 0.0)) * 0.55 + vnoise(wp2 * 6.5 - vec2(0.0, t * 0.5)) * 0.45;
  float lacy = smoothstep(0.52, 0.78, lacyN);
  float caps = smoothstep(0.7, 1.0, vCrest + (fn - 0.5) * 0.45) * lacy * smoothstep(5.0, 9.0, depth) * 0.6;
  float foam = clamp(foamEdge + lines + lace + ob * 0.85 + reef + caps, 0.0, 1.0) * 0.92;

  // bioluminescent plankton: the shore foam and the shallows glow blue at night
  float bio = (foamEdge * 1.0 + lines * 1.1 + lace * 0.3 + ob * 0.5 + reef * 0.06) * (0.7 + 0.3 * sin(t * 2.3 + p.x * 3.1 + p.y * 2.3));
  bio += sparkle(p * 2.7 + 3.0, t * 0.7, 0.12) * (1.0 - smoothstep(0.0, 4.0, u)) * 1.4;
  vec3 glow = uGlow * bio;

  vec3 surf = refl * F + spec + sss * (1.0 - F);
  vec3 foamC = uFoamCol * (0.85 + 0.15 * fn) * (1.0 - uNight * 0.6);
  vec3 rgb = surf * (1.0 - foam) + foamC * foam + glow;
  float alpha = 1.0 - (1.0 - F) * (1.0 - foam);

  // soft contact with the beach
  float soft = smoothstep(0.0, 0.04, depth);
  rgb *= soft; alpha *= soft;
  // horizon haze
  float hz = smoothstep(uHazeNear, uHazeFar, dist);
  rgb = mix(rgb, uHorizon, hz);
  alpha = mix(alpha, 1.0, hz);
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
    uTexMat: { value: new THREE.Matrix4() },
    uWaves: { value: WV.map(w => new THREE.Vector4(w.dx, w.dz, 0, 0)) },
    uAmpSum: { value: AMP_SUM },
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
    uSkyFallback: { value: new THREE.Color(0.4, 0.55, 0.7) },
    uNight: { value: 0 },
    uReflStrength: { value: 1 },
    uHazeNear: { value: 600 },
    uHazeFar: { value: 6000 },
    uMirrorOn: { value: 1 },
  };
  WAVES.forEach((w, i) => { uniforms.uWaves.value[i].z = w[2]; uniforms.uWaves.value[i].w = w[3]; });

  const material = new THREE.ShaderMaterial({
    name: 'IslandWater',
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
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
  const rtSize = () => {
    const s = env.renderer.getDrawingBufferSize(new THREE.Vector2());
    const k = 0.5 * Math.max(0.55, q);
    return [Math.max(64, Math.round(s.x * k)), Math.max(64, Math.round(s.y * k))];
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

  return {
    mesh, material, uniforms, state,
    resize() { const [w, h] = rtSize(); rt.setSize(w, h); },
    dispose() { rt.dispose(); geo.dispose(); material.dispose(); },
  };
}
