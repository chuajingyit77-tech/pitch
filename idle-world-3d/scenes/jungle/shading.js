// Shared shading for the rainforest: one patch applied to every lit material.
//  - canopy light cookie: dappled sun (or moon) light projected from a leaf-gap pattern at canopy height
//  - exponential height fog with sun in-scatter (green-tinted humid air)
//  - rain wetness (darker albedo, glossier surfaces)
//  - leaf translucency when back-lit
//  - world-space moss on up-facing surfaces, caustics under the pond surface
//  - bioluminescence: fake glow lights at night + emissive vertex attribute
import * as THREE from 'three';
import { patchMaterial, GLSL } from '../../lib/util.js';

export const GLOW_N = 8;

/**
 * Shader clock. uTime is wrapped every JG_PERIOD s (setJungleClock) so float32 keeps full precision on a screen
 * left on for days, and the wrap is seamless because every rate that reads it completes whole cycles in that
 * period: all of the fixed rates are multiples of 1/200 rad/s (glow pulses 1.3, 0.9, 0.8; caustics 0.99, 1.265;
 * light shafts 0.25; motes 0.09, 0.21, 1.7; fireflies 3.1; spores 0.4, 0.33, 2.0; plunge mist 0.3, 0.05; the
 * floating fruit's bob 0.3), and per-particle rates are snapped to whole cycles where they are used. Drifting
 * noise does not read uTime at all: its offsets are wrapped in JS to the noise's own period (JG_PNOISE: 256
 * lattice cells; simplex noise: 867) and texture scrolls to 1, all in double precision.
 */
export const JG_PERIOD = 400 * Math.PI;

export function createShared() {
  const glow = [];
  for (let i = 0; i < GLOW_N; i++) glow.push(new THREE.Vector4(0, -100, 0, 0));
  return {
    uTime: { value: 0 },
    uNoiseDrift: { value: new THREE.Vector4() },   // light-shaft noise (0.05, 0.04, 0.06 /s), wrapped to 256
    uPondDrift: { value: new THREE.Vector2() },    // pond foam noise (0.8, 0.6 /s), wrapped to 256
    uSimplexDrift: { value: new THREE.Vector4() }, // sky clouds (0.004, 0.01 /s), fireflies (0.12, 0.1 /s), wrapped to 867
    uMistScroll: { value: new THREE.Vector4() },   // low mist sheets' texture scrolls, wrapped to 1
    uLightDirW: { value: new THREE.Vector3(0.3, 0.9, 0.2).normalize() },
    uLightCol: { value: new THREE.Color(1, 1, 1) },
    uCookieTex: { value: null },
    uCookieScale: { value: 0.05 },
    uCookieDrift: { value: new THREE.Vector2() },
    uCanopyY: { value: 17 },
    uCookieMin: { value: 0.16 },
    uClearing: { value: new THREE.Vector4(0.5, -4.5, 6.5, 11.5) },
    uFogColor: { value: new THREE.Color('#7da08a') },
    uFogSunColor: { value: new THREE.Color('#f0e6c0') },
    uFogDensity: { value: 0.02 },
    uFogFalloff: { value: 0.1 },
    uFogBase: { value: 0 },
    uWet: { value: 0 },
    uNight: { value: 0 },
    uGlowPts: { value: glow },
    uGlowColor: { value: new THREE.Color('#38e8d8') },
    uWaterY: { value: -0.25 },
    uCaustic: { value: 1 },
    uMossColor: { value: new THREE.Color('#4d6b22') },
    uAbsorb: { value: new THREE.Vector3(1.1, 0.3, 0.42) },
    uWaterScatter: { value: new THREE.Color('#1d5a48') },
    uMsaa: { value: 1 }, // 1 while the frame is drawn into a multisampled target (see the scene's onBeforeRender)
  };
}

const HEADER_COMMON = /* glsl */`
  varying vec3 vWorldP;
  uniform float uTime, uWet, uNight, uWaterY, uCaustic;
  uniform vec3 uLightDirW, uLightCol;
  uniform sampler2D uCookieTex;
  uniform float uCookieScale, uCanopyY, uCookieMin;
  uniform vec2 uCookieDrift;
  uniform vec4 uClearing;
  uniform vec3 uFogColor, uFogSunColor;
  uniform float uFogDensity, uFogFalloff, uFogBase;
  uniform vec4 uGlowPts[${GLOW_N}];
  uniform vec3 uGlowColor, uMossColor;
  uniform vec3 uAbsorb, uWaterScatter;
  uniform float uMsaa;
  vec3 jgUnderwater(vec3 col, vec3 wp){
    float dw = uWaterY - wp.y;
    if (dw <= 0.0) return col;
    vec3 V = normalize(cameraPosition - wp);
    float path = dw / max(V.y, 0.12) + dw * 0.6;
    vec3 T = exp(-uAbsorb * path);
    return col * T + uWaterScatter * (1.0 - T);
  }
  float jgCookie(vec3 wp){
    vec3 L = uLightDirW;
    float ly = max(L.y, 0.25);
    vec2 p = wp.xz + L.xz / ly * (uCanopyY - wp.y);
    float a = texture2D(uCookieTex, p * uCookieScale + uCookieDrift).r;
    float b = texture2D(uCookieTex, p * uCookieScale * 2.6 - uCookieDrift * 1.7).g;
    float m = a * 0.72 + b * 0.28;
    float open = smoothstep(0.52, 0.7, m);
    float clr = 1.0 - smoothstep(uClearing.z, uClearing.w, length((p - uClearing.xy) * vec2(1.0, 1.25)));
    return mix(uCookieMin, 1.0, max(open, clr * 0.95));
  }
  vec3 jgFog(vec3 col, vec3 wp){
    vec3 d = wp - cameraPosition;
    float dist = length(d);
    float k = uFogFalloff;
    float h0 = cameraPosition.y - uFogBase;
    float dy = d.y;
    float shape = abs(k * dy) > 0.001 ? (1.0 - exp(-k * dy)) / (k * dy) : 1.0;
    float fi = uFogDensity * exp(-k * h0) * shape * dist;
    float f = 1.0 - exp(-max(fi, 0.0));
    vec3 vd = d / max(dist, 1e-3);
    float sunAmt = pow(max(dot(vd, uLightDirW), 0.0), 5.0);
    return mix(col, mix(uFogColor, uFogSunColor, sunAmt), f);
  }
`;

const VERT_HEADER = /* glsl */`
  varying vec3 vWorldP;
  #ifdef JG_GLOWATTR
    attribute float aGlow;
    varying float vGlow;
  #endif
`;

/**
 * Patch a built-in lit material (Standard/Physical/Lambert) with the jungle shading.
 * opts: { translucent: 0..1, moss: 0..1, caustics: bool, glowAttr: bool, specks: bool, wetDark: 0..1, glowLight: bool, key }
 */
export function jungleMaterial(material, shared, opts = {}) {
  const defines = material.defines || (material.defines = {});
  const translucent = opts.translucent || 0;
  if (translucent) defines.JG_TRANSLUCENT = '';
  if (opts.moss) defines.JG_MOSS = '';
  if (opts.caustics) defines.JG_CAUSTICS = '';
  if (opts.glowAttr) defines.JG_GLOWATTR = '';
  if (opts.specks) defines.JG_SPECKS = '';
  if (opts.glowLight !== false) defines.JG_GLOWLIGHT = '';
  if (opts.glowLeaf) defines.JG_GLOWLEAF = '';
  if (opts.glowTint) defines.JG_GLOWTINT = '';
  // Alpha to coverage for cut-out leaves: a hard alpha test is decided once per pixel, so MSAA cannot smooth
  // it and leaf edges crawl as the wind and the camera move. A one-pixel alpha ramp turned into MSAA coverage
  // gives soft, stable edges (where there is no MSAA it behaves like the plain alpha test).
  if (opts.a2c && material.alphaTest > 0) { defines.JG_A2C = ''; material.alphaToCoverage = true; }
  const uniforms = {
    ...shared,
    uTranslucency: { value: translucent },
    uMossAmt: { value: opts.moss || 0 },
    uWetDark: { value: opts.wetDark ?? 0.35 },
    uGlowAttrColor: { value: new THREE.Color(opts.glowColor || '#46f2e0') },
    uGlowAttrGain: { value: opts.glowGain ?? 3.0 },
  };
  let lightsBegin = THREE.ShaderChunk.lights_fragment_begin.replace(
    'getDirectionalLightInfo( directionalLight, directLight );',
    'getDirectionalLightInfo( directionalLight, directLight ); directLight.color *= jgCookie(vWorldP);');
  lightsBegin = lightsBegin.replace(
    /RE_Direct\( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight \);\s*\}\s*#pragma unroll_loop_end\s*#endif\s*#if \( NUM_RECT_AREA_LIGHTS/,
    m => m.replace('RE_Direct(', 'jgSun = directLight.color; RE_Direct('));
  patchMaterial(material, {
    key: 'jg' + Object.keys(defines).sort().join(','),
    uniforms,
    vertexHeader: VERT_HEADER,
    fragmentHeader: HEADER_COMMON + /* glsl */`
      uniform float uTranslucency, uMossAmt, uWetDark, uGlowAttrGain;
      uniform vec3 uGlowAttrColor;
      #ifdef JG_GLOWATTR
        varying float vGlow;
      #endif
      #ifdef JG_CAUSTICS
        ${GLSL.noise}
        ${GLSL.caustics}
      #endif
    `,
    vertex: {
      '#include <fog_vertex>': `$&
        vWorldP = transposeMat3(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
        #ifdef JG_GLOWATTR
          vGlow = aGlow;
        #endif
      `,
    },
    fragment: {
      '#include <alphatest_fragment>': /* glsl */`
        #if defined(JG_A2C) && defined(USE_ALPHATEST)
          float jgCov = clamp((diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 1e-4) + 0.5, 0.0, 1.0);
          if (jgCov < 0.5 - 0.45 * uMsaa) discard; // without MSAA: exactly the old alpha test
        #else
          #include <alphatest_fragment>
        #endif
      `,
      '#include <opaque_fragment>': /* glsl */`$&
        #if defined(JG_A2C) && defined(USE_ALPHATEST)
          gl_FragColor.a = jgCov;
        #endif
      `,
      '#include <color_fragment>': /* glsl */`$&
        #ifdef JG_MOSS
        {
          vec3 wn = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
          float n = texture2D(uCookieTex, vWorldP.xz * 0.37 + vWorldP.y * 0.11).b;
          float m = smoothstep(0.25, 0.75, wn.y + (n - 0.5) * 0.9) * uMossAmt;
          vec3 moss = uMossColor * (0.65 + 0.7 * n);
          diffuseColor.rgb = mix(diffuseColor.rgb, moss, m);
        }
        #endif
        diffuseColor.rgb *= 1.0 - uWet * uWetDark;
      `,
      '#include <roughnessmap_fragment>': /* glsl */`$&
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.35, uWet);
      `,
      '#include <emissivemap_fragment>': /* glsl */`$&
        #ifdef JG_GLOWATTR
          float pulse = 0.82 + 0.18 * sin(uTime * 1.3 + vWorldP.x * 2.1 + vWorldP.z * 1.7);
          totalEmissiveRadiance += uGlowAttrColor * vGlow * uNight * uGlowAttrGain * pulse;
        #endif
        #ifdef JG_GLOWLEAF
        {
          float vein = smoothstep(0.08, 0.3, diffuseColor.b - diffuseColor.r);
          float pulse2 = 0.8 + 0.2 * sin(uTime * 0.9 + vWorldP.x * 1.3);
          totalEmissiveRadiance += uGlowColor * uNight * (vein * 2.6 + 0.06) * pulse2;
        }
        #endif
        #ifdef JG_GLOWTINT
          totalEmissiveRadiance += diffuseColor.rgb * uNight * 0.9;
        #endif
        #ifdef JG_SPECKS
        {
          // glowing lichen: clusters of luminous dots, denser on top surfaces
          float sp = texture2D(uCookieTex, vWorldP.xz * 1.3 + vWorldP.y * 0.5).a;
          float cl = texture2D(uCookieTex, vWorldP.xz * 0.11 - vWorldP.y * 0.07).b;
          float spk = smoothstep(0.72, 0.84, sp) * smoothstep(0.5, 0.7, cl);
          totalEmissiveRadiance += uGlowColor * spk * uNight * 2.6 * (0.7 + 0.3 * sin(uTime * 0.8 + sp * 40.0));
        }
        #endif
      `,
      '#include <lights_fragment_begin>': 'vec3 jgSun = vec3(0.0);\n' + lightsBegin,
      '#include <lights_fragment_end>': /* glsl */`$&
        #if defined(JG_TRANSLUCENT) && NUM_DIR_LIGHTS > 0
        {
          vec3 Lv = directionalLights[0].direction;
          float back = saturate(dot(-geometryNormal, Lv));
          float thru = pow(saturate(dot(-geometryViewDir, Lv)), 3.0);
          vec3 tint = diffuseColor.rgb * vec3(1.15, 1.3, 0.55) + vec3(0.02, 0.035, 0.0);
          reflectedLight.directDiffuse += jgSun * tint * (back * 0.6 + thru * 0.9) * uTranslucency;
        }
        #endif
        #ifdef JG_CAUSTICS
        if (vWorldP.y < uWaterY) {
          float dep = uWaterY - vWorldP.y;
          float c = caustics(vWorldP.xz * 1.15, uTime * 1.1);
          vec3 wnC = normalize((vec4(geometryNormal, 0.0) * viewMatrix).xyz);
          reflectedLight.directDiffuse += diffuseColor.rgb * jgSun * c * uCaustic * smoothstep(0.0, 0.25, dep) * exp(-dep * 0.8) * saturate(wnC.y) * 1.4;
        }
        #endif
        #ifdef JG_GLOWLIGHT
        if (uNight > 0.01) {
          vec3 wnG = normalize((vec4(geometryNormal, 0.0) * viewMatrix).xyz);
          float gl = 0.0;
          for (int i = 0; i < ${GLOW_N}; i++) {
            vec3 d = uGlowPts[i].xyz - vWorldP;
            float r2 = dot(d, d);
            float att = uGlowPts[i].w / (1.0 + r2 * 0.9);
            gl += att * (0.3 + 0.7 * saturate(dot(wnG, d * inversesqrt(r2 + 1e-4))));
          }
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uGlowColor * gl * uNight;
        }
        #endif
      `,
      '#include <fog_fragment>': `
        #ifdef JG_CAUSTICS
          gl_FragColor.rgb = jgUnderwater(gl_FragColor.rgb, vWorldP);
        #endif
        gl_FragColor.rgb = jgFog(gl_FragColor.rgb, vWorldP);`,
    },
  });
  return material;
}

/** GLSL for custom ShaderMaterials (water, waterfall, particles) that want the same fog/cookie. */
export const JG_GLSL = HEADER_COMMON;

/** Wrap the shader clock and the drift offsets (see JG_PERIOD). t = the scene clock in seconds, unwrapped. */
export function setJungleClock(shared, t) {
  const wrap = (x, n) => x - n * Math.floor(x / n);
  shared.uTime.value = wrap(t, JG_PERIOD);
  shared.uNoiseDrift.value.set(wrap(t * 0.05, 256), wrap(t * 0.04, 256), wrap(t * 0.06, 256), 0);
  shared.uPondDrift.value.set(wrap(t * 0.8, 256), wrap(t * 0.6, 256));
  shared.uSimplexDrift.value.set(wrap(t * 0.004, 867), wrap(t * 0.01, 867), wrap(t * 0.12, 867), wrap(t * 0.1, 867));
  // mist sheets: p = xz * 0.035 + (0.0035, 0.0012) t + seed, and that p * 2.7 - (0.004, 0) t
  shared.uMistScroll.value.set(wrap(t * 0.0035, 1), wrap(t * 0.0012, 1), wrap(t * (2.7 * 0.0035 - 0.004), 1), wrap(t * 2.7 * 0.0012, 1));
}

/** Value noise whose lattice repeats every 256 cells (needs GLSL.noise's hash12): read at drifts wrapped to 256. */
export const JG_PNOISE = /* glsl */`
float vnoiseP(vec2 q) {
  vec2 i = floor(q), f = fract(q); vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 i0 = mod(i, 256.0), i1 = mod(i + 1.0, 256.0);
  return mix(mix(hash12(i0), hash12(vec2(i1.x, i0.y)), u.x), mix(hash12(vec2(i0.x, i1.y)), hash12(i1), u.x), u.y);
}
`;
/** fbm of GLSL.noise's simplex noise with lacunarity exactly 2: periodic with 867 along each axis like snoise. */
export const JG_FBMP = /* glsl */`
float fbmP(vec3 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * snoise(p); p *= 2.0; a *= 0.5; } return s; }
`;
