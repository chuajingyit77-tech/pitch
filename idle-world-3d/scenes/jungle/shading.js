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

export function createShared() {
  const glow = [];
  for (let i = 0; i < GLOW_N; i++) glow.push(new THREE.Vector4(0, -100, 0, 0));
  return {
    uTime: { value: 0 },
    uLightDirW: { value: new THREE.Vector3(0.3, 0.9, 0.2).normalize() },
    uLightCol: { value: new THREE.Color(1, 1, 1) },
    uCookieTex: { value: null },
    uCookieScale: { value: 0.05 },
    uCookieDrift: { value: new THREE.Vector2() },
    uCanopyY: { value: 17 },
    uCookieMin: { value: 0.16 },
    uClearing: { value: new THREE.Vector4(0, -5, 5, 9) },
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
        vWorldP = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
        #ifdef JG_GLOWATTR
          vGlow = aGlow;
        #endif
      `,
    },
    fragment: {
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
        #ifdef JG_SPECKS
        {
          float sp = texture2D(uCookieTex, vWorldP.xz * 1.9 + vWorldP.y * 0.7).a;
          float spk = smoothstep(0.78, 0.86, sp);
          totalEmissiveRadiance += uGlowColor * spk * uNight * 1.6 * (0.7 + 0.3 * sin(uTime * 0.8 + sp * 40.0));
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
      '#include <fog_fragment>': 'gl_FragColor.rgb = jgFog(gl_FragColor.rgb, vWorldP);',
    },
  });
  return material;
}

/** GLSL for custom ShaderMaterials (water, waterfall, particles) that want the same fog/cookie. */
export const JG_GLSL = HEADER_COMMON;
