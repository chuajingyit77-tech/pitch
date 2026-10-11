// 晴岛 sky: three/addons Sky.js (Preetham) patched with a night sky (stars, milky band, moon),
// a softer sunset halo, a PMREM environment generated from it, and lit billboard cumulus clouds.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { TAU, lerp } from '../../lib/util.js';
import { puffTexture } from './textures.js';

export function createSky(env, rng) {
  const sky = new Sky();
  sky.scale.setScalar(8000);
  sky.frustumCulled = false;
  const u = sky.material.uniforms;
  u.turbidity.value = 2.4;
  u.rayleigh.value = 1.25;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.82;
  Object.assign(u, {
    uNight: { value: 0 }, uSkyGain: { value: 0.5 }, uTime: { value: 0 },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uNightZen: { value: new THREE.Color('#040917') }, uNightHor: { value: new THREE.Color('#13224a') },
    uMoonCol: { value: new THREE.Color(1.0, 0.96, 0.88) },
    uSunGlow: { value: new THREE.Color(0, 0, 0) },
    uLowTint: { value: new THREE.Color(1, 1, 1) },
  });
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('uniform vec3 up;', /* glsl */`uniform vec3 up;
      uniform float uNight, uSkyGain, uTime;
      uniform vec3 uMoonDir, uNightZen, uNightHor, uMoonCol, uSunGlow, uLowTint;
      float sHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    `)
    .replace('gl_FragColor = vec4( retColor, 1.0 );', /* glsl */`
      vec3 col = retColor * uSkyGain;
      float upv = direction.y;
      col *= mix(uLowTint, vec3(1.0), smoothstep(0.0, 0.35, upv));
      float cs = max(dot(direction, vSunDirection), 0.0);
      col += uSunGlow * (pow(cs, 700.0) * 3.0 + pow(cs, 60.0) * 0.35 + pow(cs, 8.0) * 0.12);
      // ---- night ----
      vec3 night = mix(uNightHor, uNightZen, pow(clamp(upv, 0.0, 1.0), 0.45));
      vec3 sp = direction * 240.0;
      vec3 cell = floor(sp);
      vec3 fr = fract(sp) - 0.5;
      float h = sHash(cell);
      float bright = pow(sHash(cell + 7.7), 4.0) * 3.5 + 0.35;
      float tw = 0.6 + 0.4 * sin(uTime * (1.3 + h * 3.0) + h * 61.0);
      float star = step(0.9925, h) * bright * tw * smoothstep(0.45, 0.04, length(fr));
      star *= smoothstep(0.03, 0.3, upv);
      float band = exp(-pow(dot(direction, normalize(vec3(0.35, 0.5, -0.79))) * 3.0, 2.0));
      night += vec3(0.022, 0.03, 0.055) * band * smoothstep(0.0, 0.35, upv) * (0.55 + 0.45 * sHash(floor(direction * 70.0)));
      float md = dot(direction, uMoonDir);
      float disc = smoothstep(0.99955, 0.99966, md);
      vec3 mx = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.001)));
      vec3 my = cross(mx, uMoonDir);
      vec2 mp = vec2(dot(direction, mx), dot(direction, my)) / 0.0262;
      float crater = 0.84 + 0.1 * sin(mp.x * 7.0 + 1.3) * sin(mp.y * 6.0 - 0.4) - 0.12 * smoothstep(0.35, 0.0, length(mp - vec2(0.3, 0.2))) - 0.08 * smoothstep(0.25, 0.0, length(mp + vec2(0.35, -0.1)));
      float limb = sqrt(max(0.0, 1.0 - dot(mp, mp)));
      vec3 moon = uMoonCol * disc * crater * (0.75 + 0.25 * limb) * 9.0;
      float glow = pow(max(md, 0.0), 1400.0) * 1.4 + pow(max(md, 0.0), 60.0) * 0.12 + pow(max(md, 0.0), 6.0) * 0.03;
      night += star * vec3(0.85, 0.92, 1.0) * (1.0 - disc) + moon + uMoonCol * glow * vec3(0.55, 0.68, 0.9);
      col += night * uNight;
      gl_FragColor = vec4(col, 1.0);
    `);
  sky.material.needsUpdate = true;

  /* ---------------- environment (PMREM) ---------------- */
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(sky.geometry, sky.material);
  envSky.scale.setScalar(4000);
  envScene.add(envSky);
  const seaMat = new THREE.MeshBasicMaterial({ color: 0x0a2a40 });
  const seaDisc = new THREE.Mesh(new THREE.CircleGeometry(3000, 32).rotateX(-Math.PI / 2), seaMat);
  seaDisc.position.y = -30;
  envScene.add(seaDisc);
  let envRT = null;
  function updateEnv(seaColor) {
    seaMat.color.copy(seaColor);
    const rt = env.pmrem.fromScene(envScene, 0, 1, 10000);
    if (envRT) envRT.dispose();
    envRT = rt;
    return rt.texture;
  }

  /* ---------------- clouds ---------------- */
  const clouds = createClouds(env, rng);

  return {
    sky, uniforms: u, updateEnv, clouds,
    dispose() {
      envRT?.dispose();
      seaDisc.geometry.dispose(); seaMat.dispose();
      clouds.dispose();
    },
  };
}

function createClouds(env, rng) {
  const q = env.q;
  const tex = puffTexture(rng.int(1, 1e6));
  const nClouds = Math.round(lerp(13, 22, q));
  const P = [];
  for (let c = 0; c < nClouds; c++) {
    const a = rng.range(0, TAU);
    const dist = rng.range(170, 760);
    const cx = Math.cos(a) * dist, cz = Math.sin(a) * dist;
    const big = rng.range(0, 1);
    const size = (26 + big * 50) * (0.75 + dist / 760 * 0.6);
    const cy = rng.range(60, 120) + dist * 0.06 + size * 0.2;
    const n = Math.round((9 + big * 8) * lerp(0.75, 1, q));
    const rot = rng.range(0, TAU), cr = Math.cos(rot), sr = Math.sin(rot);
    const stretch = rng.range(1.0, 1.8);
    for (let i = 0; i < n; i++) {
      const ua = rng.range(-1, 1), wa = rng.range(-1, 1);
      const edge = 1 - Math.min(1, Math.hypot(ua * 0.9, wa));
      const lx = ua * size * 0.6 * stretch, lz = wa * size * 0.32;
      const r = size * rng.range(0.24, 0.4) * (0.55 + edge * 0.65);
      const ly = Math.pow(rng.next(), 0.8) * size * 0.32 * (0.25 + edge * 1.1) + r * 0.32;
      P.push({
        x: cx + lx * cr - lz * sr, y: cy + ly, z: cz + lx * sr + lz * cr, r,
        cx, cy: cy - size * 0.05, cz, rel: Math.min(1, ly / (size * 0.42 + 1e-3)),
      });
    }
  }
  const N = P.length;
  const base = new THREE.PlaneGeometry(2, 2);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const aPuff = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  const aInfo = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  aPuff.setUsage(THREE.DynamicDrawUsage); aInfo.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPuff', aPuff);
  geo.setAttribute('aInfo', aInfo);
  geo.instanceCount = N;

  const uniforms = {
    tPuff: { value: tex },
    uSpin: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uLit: { value: new THREE.Color(1, 1, 1) },
    uShade: { value: new THREE.Color(0.5, 0.55, 0.65) },
    uRim: { value: new THREE.Color(1, 1, 1) },
    uHaze: { value: new THREE.Color(0.7, 0.8, 0.9) },
    uOpacity: { value: 1 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      attribute vec4 aPuff;
      attribute vec4 aInfo;
      uniform float uSpin;
      varying vec2 vUv;
      varying vec3 vPos, vRight, vUp, vMacro;
      varying float vRel;
      void main() {
        float c = cos(uSpin), s = sin(uSpin);
        mat2 R = mat2(c, s, -s, c);
        vec3 p = aPuff.xyz; p.xz = R * p.xz;
        vec3 cc = aInfo.xyz; cc.xz = R * cc.xz;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 wp = p + (right * position.x + up * position.y) * aPuff.w;
        vUv = uv; vPos = wp; vRight = right; vUp = up;
        vMacro = normalize((p - cc) * vec3(1.0, 1.7, 1.0) + vec3(0.0, aPuff.w * 0.35, 0.0));
        vRel = aInfo.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D tPuff;
      uniform vec3 uSunDir, uLit, uShade, uRim, uHaze;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vPos, vRight, vUp, vMacro;
      varying float vRel;
      void main() {
        vec4 tx = texture2D(tPuff, vUv);
        float a = tx.a * uOpacity;
        if (a < 0.004) discard;
        vec2 q = vUv * 2.0 - 1.0;
        float z = sqrt(max(0.0, 1.0 - dot(q, q)));
        vec3 fwd = normalize(cameraPosition - vPos);
        vec3 n = normalize(normalize(vRight * q.x + vUp * q.y + fwd * z) * 0.55 + vMacro * 0.85);
        float ndl = dot(n, uSunDir);
        float lit = smoothstep(-0.45, 0.85, ndl) * (0.5 + 0.5 * smoothstep(0.0, 0.8, vRel + 0.25));
        vec3 col = mix(uShade, uLit, lit);
        col *= 0.86 + 0.24 * tx.g;
        float fs = pow(max(dot(-fwd, uSunDir), 0.0), 7.0);
        col += uRim * fs * (1.0 - tx.r) * 1.8;
        float d = length(vPos - cameraPosition);
        col = mix(col, uHaze, smoothstep(220.0, 1200.0, d) * 0.6);
        gl_FragColor = vec4(col * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  mesh.name = 'clouds';

  // back-to-front sort (relative to the main camera), refreshed a few times per second
  const order = P.map((_, i) => i);
  const dists = new Float32Array(N);
  let sortTimer = 0;
  function sort(camPos, spin) {
    const c = Math.cos(spin), s = Math.sin(spin);
    for (let i = 0; i < N; i++) {
      const p = P[i];
      const x = c * p.x - s * p.z, z = s * p.x + c * p.z;
      dists[i] = (x - camPos.x) ** 2 + (p.y - camPos.y) ** 2 + (z - camPos.z) ** 2;
    }
    order.sort((a, b) => dists[b] - dists[a]);
    for (let k = 0; k < N; k++) {
      const p = P[order[k]];
      aPuff.setXYZW(k, p.x, p.y, p.z, p.r);
      aInfo.setXYZW(k, p.cx, p.cy, p.cz, p.rel);
    }
    aPuff.needsUpdate = true; aInfo.needsUpdate = true;
  }
  return {
    mesh, uniforms,
    update(dt, camPos) {
      uniforms.uSpin.value += dt * 0.0035;
      sortTimer -= dt;
      if (sortTimer <= 0) { sortTimer = 0.4; sort(camPos, uniforms.uSpin.value); }
    },
    dispose() { tex.dispose(); geo.dispose(); base.dispose(); material.dispose(); },
  };
}
