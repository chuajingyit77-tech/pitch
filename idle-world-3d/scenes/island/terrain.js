// 晴岛 terrain: analytic heightfield (beach rings → grass → rocky hill, lagoon shelf, reef drop-off),
// the island mesh with painted zones, and a half-float "field" texture (seabed height, distance to
// shore, obstacle foam, reef crest) shared with the water shader.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, patchMaterial, GLSL } from '../../lib/util.js';
import { waterUniforms, UNDERWATER_GLSL } from './shared.js';

export const FIELD_SIZE = 100;       // metres covered by the field texture / terrain mesh
export const FIELD_RES = 256;

/** GLSL for the shoreline swash (shared by terrain wetness and the water surface). */
export const SWASH_GLSL = /* glsl */`
uniform float uSwashAmp;
float swashPhase(vec2 xz, float u, float t) { return t * 0.9 + u * 0.75 + vnoise(xz * 0.07) * 6.2831; }
float swashHeight(vec2 xz, float u, float t) {
  float uu = max(u, 0.0);
  return uSwashAmp * sin(swashPhase(xz, uu, t)) * (1.0 - smoothstep(1.5, 10.0, uu));
}
`;

export const fieldUniforms = {
  tField: { value: null },
  uField: { value: new THREE.Vector4(-FIELD_SIZE / 2, -FIELD_SIZE / 2, 1 / FIELD_SIZE, 1 / FIELD_SIZE) },
  uSwashAmp: { value: 0.075 },
};

export function createTerrain(env, rng, noise) {
  const q = env.q;
  /* ---------------- layout ---------------- */
  const R0 = rng.range(12.6, 14.0);
  const hillAng = rng.range(0, TAU);
  const hillDist = rng.range(2.6, 4.2);
  const hx = Math.cos(hillAng) * hillDist, hz = Math.sin(hillAng) * hillDist;
  const hillH = rng.range(4.4, 5.8), hillR = rng.range(3.8, 4.6);
  const dockAng = hillAng + Math.PI + rng.range(-0.45, 0.45);
  const o1 = rng.range(0, 50), o2 = rng.range(0, 50), o3 = rng.range(0, 50), o4 = rng.range(0, 50);

  const coast = a => {
    const c = Math.cos(a), s = Math.sin(a);
    let k = 1 + 0.11 * noise.noise2(c * 1.1 + o1, s * 1.1 - o2) + 0.055 * noise.noise2(c * 2.7 - o3, s * 2.7 + o4) + 0.02 * noise.noise2(c * 6.0 + o2, s * 6.0 + o1);
    // flatten the coastline a little where the dock lands so it meets a straight beach
    const dd = Math.abs(Math.atan2(Math.sin(a - dockAng), Math.cos(a - dockAng)));
    k = lerp(k, 1.02, Math.exp(-dd * dd * 8) * 0.6);
    return R0 * k;
  };
  const lagoonW = a => {
    const c = Math.cos(a), s = Math.sin(a);
    return 9.0 + 3.6 * noise.noise2(c * 1.3 + o4, s * 1.3 - o3) + 1.2 * noise.noise2(c * 3.1 - o1, s * 3.1 + o2);
  };
  /** Signed distance (m) from the coastline along the radius: + inland, - offshore. */
  const coastE = (x, z) => coast(Math.atan2(z, x)) - Math.hypot(x, z);

  function height(x, z) {
    const r = Math.hypot(x, z), a = Math.atan2(z, x);
    const e = coast(a) - r;
    let h;
    if (e >= 0) {
      h = Math.min(e, 2.8) * 0.085;
      h += 0.52 * smoothstep(2.2, 6.6, e);
      h += Math.max(0, e - 6.6) * 0.1;
      h += noise.fbm2(x * 0.11 + 3.1, z * 0.11 - 1.7, 3) * 0.45 * smoothstep(3.5, 8.5, e);
    } else {
      const u = -e, lw = lagoonW(a);
      h = -0.09 * Math.min(u, 2.5) - 0.105 * clamp(u - 2.5, 0, lw - 2.5);
      h += noise.fbm2(x * 0.085 - 5.0, z * 0.085 + 2.0, 3) * 0.32 * smoothstep(2.5, 6, u) * (1 - smoothstep(lw - 1, lw + 2, u));
      // reef crest then the drop-off to the open ocean
      h += 0.28 * Math.exp(-Math.pow((u - lw - 0.4) / 1.3, 2));
      h -= 9.2 * smoothstep(lw + 0.8, lw + 10.5, u);
      h -= 2.6 * smoothstep(lw + 9, lw + 26, u);
    }
    const dh = Math.hypot(x - hx, z - hz) / hillR;
    if (dh < 3) h += hillH * Math.exp(-dh * dh * 1.5) * (0.78 + 0.4 * noise.ridged2(x * 0.24 + o1, z * 0.24, 3)) * smoothstep(3, 7.5, e);
    return h;
  }

  /** Material weights at a point: sand, grass, rock (0..1, sum ~1). */
  const _zone = { sand: 0, grass: 0, rock: 0 };
  function zone(x, z, h = height(x, z), slope = 0) {
    const e = coastE(x, z);
    const nz = noise.noise2(x * 0.32 + 11, z * 0.32 - 7) * 1.1 + noise.noise2(x * 1.1, z * 1.1) * 0.35;
    let sand = 1 - smoothstep(4.6, 6.4, e + nz);
    let rock = clamp(smoothstep(0.42, 0.75, slope) + smoothstep(hillH * 0.55, hillH * 0.9, h - 1.2 + nz * 0.6) * 0.9, 0, 1);
    rock *= 1 - sand * 0.85;
    const grass = Math.max(0, 1 - sand - rock);
    _zone.sand = sand; _zone.rock = rock; _zone.grass = grass;
    return _zone;
  }

  /** Point at polar angle a, `e` metres inland (negative = offshore). */
  const pointAt = (a, e, out = new THREE.Vector3()) => {
    const r = coast(a) - e;
    out.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    out.y = height(out.x, out.z);
    return out;
  };

  /* ---------------- mesh ---------------- */
  const SEG = q >= 0.9 ? 250 : q >= 0.6 ? 200 : 150;
  const geo = new THREE.PlaneGeometry(FIELD_SIZE, FIELD_SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, height(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const mats = new Float32Array(pos.count * 3);
  const C = {
    sandDry: new THREE.Color('#f3e0b6'), sandWarm: new THREE.Color('#ead09c'), sandPale: new THREE.Color('#f7ead0'),
    sandSea: new THREE.Color('#ece6d4'), seagrass: new THREE.Color('#5d6e3a'), coral: new THREE.Color('#c99d8c'), deepSand: new THREE.Color('#b9c4b8'),
    grass1: new THREE.Color('#5fae3c'), grass2: new THREE.Color('#79c04a'), grass3: new THREE.Color('#4e9433'), jungle: new THREE.Color('#3f7d2c'),
    rock1: new THREE.Color('#8d877c'), rock2: new THREE.Color('#6f6860'), moss: new THREE.Color('#62783f'),
  };
  const col = new THREE.Color(), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = pos.getY(i);
    const slope = 1 - nrm.getY(i);
    const zn = zone(x, z, h, slope * 2.2);
    const n1 = noise.noise2(x * 0.21 + 3, z * 0.21 - 9) * 0.5 + 0.5;
    const n2 = noise.noise2(x * 0.06 - 2, z * 0.06 + 4) * 0.5 + 0.5;
    // sand
    col.copy(C.sandDry).lerp(C.sandWarm, n1 * 0.55).lerp(C.sandPale, smoothstep(0.55, 0.9, n2) * 0.5);
    if (h < 0.05) {
      const e = coastE(x, z), u = -e;
      col.lerp(C.sandSea, smoothstep(0.05, -0.4, h));
      // seagrass beds and coral rubble patches in the lagoon
      const sg = noise.fbm2(x * 0.09 + 21, z * 0.09 - 13, 3);
      const cr = noise.fbm2(x * 0.16 - 31, z * 0.16 + 5, 3);
      const inLagoon = smoothstep(3.5, 6, u) * (1 - smoothstep(lagoonW(Math.atan2(z, x)) - 1, lagoonW(Math.atan2(z, x)) + 3, u));
      col.lerp(C.seagrass, smoothstep(0.18, 0.42, sg) * inLagoon * 0.85);
      col.lerp(C.coral, smoothstep(0.28, 0.5, cr) * smoothstep(5, 9, u) * 0.75);
      col.lerp(C.deepSand, smoothstep(-2, -7, h) * 0.6);
    }
    // grass
    tmp.copy(C.grass1).lerp(C.grass2, n1).lerp(C.grass3, smoothstep(0.4, 0.8, n2) * 0.6);
    tmp.lerp(C.jungle, smoothstep(9, 12, coastE(x, z)) * 0.6);
    col.lerp(tmp, zn.grass);
    // rock
    tmp.copy(C.rock1).lerp(C.rock2, n1).lerp(C.moss, (1 - slope * 3) * 0.45 * (1 - n2));
    col.lerp(tmp, zn.rock);
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    mats[i * 3] = zn.sand; mats[i * 3 + 1] = zn.grass; mats[i * 3 + 2] = zn.rock;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aMat', new THREE.BufferAttribute(mats, 3));

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, envMapIntensity: 0.55 });
  patchMaterial(mat, {
    key: 'islandTerrain',
    uniforms: { ...waterUniforms, ...fieldUniforms },
    vertexHeader: 'attribute vec3 aMat; varying vec3 vMat; varying vec3 vTPos;',
    fragmentHeader: 'varying vec3 vMat; varying vec3 vTPos; uniform sampler2D tField; uniform vec4 uField;\n' + GLSL.noise + GLSL.caustics + UNDERWATER_GLSL + SWASH_GLSL,
    vertex: {
      '#include <begin_vertex>': '$&\n vMat = aMat; vTPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    },
    fragment: {
      '#include <color_fragment>': /* glsl */`$&
        float tDist = length(cameraPosition - vTPos);
        float tAA = 1.0 - smoothstep(25.0, 70.0, tDist);
        vec4 tFld = texture2D(tField, (vTPos.xz - uField.xy) * uField.zw);
        float tU = -tFld.g;
        float tSw = swashHeight(vTPos.xz, tU, uWTime);
        float tSand = vMat.x;
        // grain and dune ripples
        float grain = vnoise(vTPos.xz * 11.0) * 0.6 + vnoise(vTPos.xz * 31.0) * 0.4;
        diffuseColor.rgb *= mix(1.0, 0.9 + 0.2 * grain, tSand * tAA);
        // wet band: everything the swash reaches stays dark, the freshly exposed strip glistens
        float tAbove = vTPos.y - tSw;
        float wetStatic = 1.0 - smoothstep(0.0, uSwashAmp * 1.7 + 0.06, vTPos.y);
        float wetNow = 1.0 - smoothstep(0.0, 0.07, tAbove);
        float tWet = clamp(max(wetStatic * 0.8, wetNow), 0.0, 1.0) * max(tSand, 0.4 * vMat.z);
        diffuseColor.rgb *= mix(1.0, 0.6, tWet * smoothstep(-0.3, 0.0, vTPos.y));
        // grass: big soft patches, sun-bleached spots
        float gp = vnoise(vTPos.xz * 0.35) * 0.65 + vnoise(vTPos.xz * 1.7) * 0.35;
        diffuseColor.rgb *= mix(1.0, 0.82 + 0.34 * gp, vMat.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.18, 1.1, 0.75), vMat.y * smoothstep(0.62, 0.85, gp) * 0.6);
        // rock: crevices and strata
        float rk = vnoise(vTPos.xz * 1.3 + vTPos.y * 0.7) * 0.6 + vnoise(vec2(vTPos.x + vTPos.z, vTPos.y * 6.0)) * 0.4;
        diffuseColor.rgb *= mix(1.0, 0.7 + 0.5 * rk, vMat.z);
      `,
      '#include <roughnessmap_fragment>': '$&\n roughnessFactor = mix(roughnessFactor, 0.28, tWet * step(-0.02, vTPos.y));',
      '#include <normal_fragment_maps>': /* glsl */`$&
        {
          // sand ripples: wind ripples on the dry beach, finer wave ripples underwater
          vec2 p = vTPos.xz;
          float warp = vnoise(p * 0.45) * 5.0;
          vec2 dir = normalize(vec2(0.8, 0.6) + vec2(vnoise(p * 0.2) - 0.5, vnoise(p * 0.2 + 7.0) - 0.5) * 0.8);
          float k = mix(9.0, 16.0, step(vTPos.y, 0.0));
          float ph = dot(p, dir) * k + warp;
          float amp = 0.06 * tSand * tAA * (1.0 - smoothstep(-6.0, -1.5, -vTPos.y) * 0.0);
          vec2 g = dir * cos(ph) * amp * (0.6 + 0.4 * vnoise(p * 2.0));
          float rr = vMat.z * tAA * 0.35;
          g += vec2(vnoise(p * 3.1) - 0.5, vnoise(p * 3.1 + 3.3) - 0.5) * rr;
          normal = normalize(normal + (viewMatrix * vec4(-g.x, 0.0, -g.y, 0.0)).xyz);
        }
      `,
      '#include <opaque_fragment>': /* glsl */`$&
        {
          float d = -vTPos.y;
          if (d > 0.0) {
            float cs = caustics(vTPos.xz * 0.55, uWTime * 0.7) + caustics(vTPos.xz * 0.23 + 4.0, uWTime * 0.45) * 0.6;
            gl_FragColor.rgb += diffuseColor.rgb * uCaustic * cs * 0.3 * smoothstep(0.0, 0.3, d) * exp(-d * 0.2);
          }
          gl_FragColor.rgb = underwaterFog(gl_FragColor.rgb, vTPos);
        }
      `,
    },
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  mesh.name = 'terrain';

  // Endless deep floor beyond the terrain so the far ocean has something to tint.
  const deepGeo = new THREE.RingGeometry(FIELD_SIZE * 0.45, 9000, 64, 1);
  deepGeo.rotateX(-Math.PI / 2);
  const deepMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
  patchMaterial(deepMat, {
    key: 'deepFloor', uniforms: waterUniforms,
    fragmentHeader: 'uniform vec3 uDeep;',
    fragment: { '#include <opaque_fragment>': '$&\n gl_FragColor.rgb = uDeep;' },
  });
  const deep = new THREE.Mesh(deepGeo, deepMat);
  deep.position.y = -14;
  deep.name = 'deepFloor';

  /* ---------------- field texture ---------------- */
  const N = FIELD_RES;
  const fH = new Float32Array(N * N), fE = new Float32Array(N * N), fB = new Float32Array(N * N), fA = new Float32Array(N * N);
  const cellX = i => -FIELD_SIZE / 2 + (i + 0.5) / N * FIELD_SIZE;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = cellX(i), z = cellX(j), k = j * N + i;
      fH[k] = height(x, z);
      const e = coastE(x, z);
      fE[k] = e;
      const u = -e, lw = lagoonW(Math.atan2(z, x));
      fA[k] = u > 0 ? Math.exp(-Math.pow((u - lw - 0.6) / 1.5, 2)) : 0;
    }
  }
  const obstacles = [];
  function addObstacle(x, z, r, strength = 1) { obstacles.push({ x, z, r, s: strength }); }
  function finalizeField() {
    for (const o of obstacles) {
      const R = o.r + 1.4;
      const i0 = Math.max(0, Math.floor((o.x - R + FIELD_SIZE / 2) / FIELD_SIZE * N)), i1 = Math.min(N - 1, Math.ceil((o.x + R + FIELD_SIZE / 2) / FIELD_SIZE * N));
      const j0 = Math.max(0, Math.floor((o.z - R + FIELD_SIZE / 2) / FIELD_SIZE * N)), j1 = Math.min(N - 1, Math.ceil((o.z + R + FIELD_SIZE / 2) / FIELD_SIZE * N));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(cellX(i) - o.x, cellX(j) - o.z);
        const v = clamp(1 - (d - o.r) / 1.3, 0, 1) * o.s;
        const k = j * N + i;
        if (v > fB[k]) fB[k] = v;
      }
    }
    const data = new Uint16Array(N * N * 4);
    const toHalf = THREE.DataUtils.toHalfFloat;
    for (let k = 0; k < N * N; k++) {
      data[k * 4] = toHalf(fH[k]); data[k * 4 + 1] = toHalf(fE[k]); data[k * 4 + 2] = toHalf(fB[k]); data[k * 4 + 3] = toHalf(fA[k]);
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    fieldUniforms.tField.value = tex;
    return tex;
  }

  /** Random point on the beach between e0 and e1 metres inland, avoiding the dock strip. */
  function beachPoint(r, e0, e1, out = new THREE.Vector3(), avoidDock = 1.6) {
    for (let k = 0; k < 30; k++) {
      const a = r.range(0, TAU);
      const da = Math.abs(Math.atan2(Math.sin(a - dockAng), Math.cos(a - dockAng))) * R0;
      if (da < avoidDock) continue;
      pointAt(a, r.range(e0, e1), out);
      return out;
    }
    return pointAt(r.range(0, TAU), (e0 + e1) / 2, out);
  }

  return {
    mesh, deep, material: mat,
    R0, hill: { x: hx, z: hz, h: hillH, r: hillR }, dockAng,
    coast, coastE, lagoonW, height, zone, pointAt, beachPoint,
    addObstacle, finalizeField,
    dispose() { fieldUniforms.tField.value?.dispose(); fieldUniforms.tField.value = null; deepGeo.dispose(); deepMat.dispose(); },
  };
}
