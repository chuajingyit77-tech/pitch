// 雨林 · pond fish: Amazonian cichlids for the jade pool, registered with lib/fish.js at runtime (lib untouched):
//  - freshwater angelfish (Pterophyllum): silver, four black bars, tall swept fins, trailing pelvic threads, red eye;
//  - peacock bass (Cichla): olive back, golden flanks, three dark bars, red-orange fins, gold-ringed tail eyespot;
//  - turquoise discus (Symphysodon): round, turquoise with wavy rust lines, red eye, blue-edged fins.
// Bright, high-contrast bodies and distinct silhouettes so they still read through the green water.
import * as THREE from 'three';
import { lerp, smoothstep, patchMaterial } from '../../lib/util.js';
import { SHAPES, PAINTERS, REGION } from '../../lib/fish.js';

const hex = h => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const shade = (c, q, amt) => mix3(c, [1, 1, 1], (1 - smoothstep(0.0, 0.45, q)) * amt);
/** Soft-edged band: 1 inside |x| < w, anti-aliased over e. */
const band = (x, w, e = 0.012) => smoothstep(w + e, w - e, Math.abs(x));
/** A clear pectoral fin: base colour c0 to tip c1 (a: base..tip), with soft darker rays across it (b). */
const pectoralRays = (c0, c1, a, b) => {
  const col = mix3(c0, c1, smoothstep(0.0, 1.0, a) * 0.8);
  const ray = 0.5 + 0.5 * Math.cos(b * Math.PI * 12);
  return mix3(col, mix3(col, [0, 0, 0], 0.35), ray * ray * (1 - a * 0.6) * 0.5);
};
const ANGEL_PEC0 = hex('#98a3a8'), ANGEL_PEC1 = hex('#bcc5c9');
const BASS_PEC0 = hex('#a3933e'), BASS_PEC1 = hex('#d0863a');
const DISCUS_PEC0 = hex('#2f8aa0'), DISCUS_PEC1 = hex('#74c0d0');

if (!PAINTERS.jgAngel) {
  const SILVER = hex('#e8edf0'), SILVER2 = hex('#c6d0d6'), BACK = hex('#b9b49c'), BAR = hex('#15171a');
  // bar centres along the body (s: 0 nose .. 1 peduncle), half widths
  const BARS = [[0.165, 0.026], [0.43, 0.05], [0.735, 0.04], [0.955, 0.018]];
  const angelBars = (s, q) => {
    let m = 0;
    for (let i = 0; i < BARS.length; i++) {
      const [c, w] = BARS[i];
      const k = band(s - c - (q - 0.5) * 0.03, w) * (i === 0 ? smoothstep(0.12, 0.2, q) * smoothstep(0.98, 0.9, q) : 1) * (i === 3 ? 0.75 : 1);
      m = Math.max(m, k);
    }
    return m;
  };
  PAINTERS.jgAngel = {
    setup: () => ({}),
    body(s, v, C) {
      const q = C.q;
      let col = mix3(SILVER, SILVER2, smoothstep(0.35, 0.9, q) * 0.6);
      col = mix3(col, BACK, smoothstep(0.82, 1.0, q) * 0.55);
      col = shade(col, q, 0.1);
      // faint iridescent wash between the bars
      col = mix3(col, hex('#d9e6ff'), 0.12 * Math.sin(s * 9 + q * 4) * 0.5 + 0.06);
      return mix3(col, BAR, angelBars(s, q) * 0.92);
    },
    fin(region, a, b) {
      if (region === REGION.pelvic) return [...mix3(hex('#f4f2ea'), hex('#ffffff'), a), lerp(0.95, 0.75, a)];
      if (region === REGION.dorsal || region === REGION.anal) {
        // the body bars run on into the tall fins (the fin sweeps back as it rises)
        const d = region === REGION.dorsal ? SHAPES.jgAngel.dorsal : SHAPES.jgAngel.anal;
        const s = lerp(d.d0, d.d1, b) + d.sweep * d.h * Math.pow(a, 1.25) * 0.55;
        const bar = Math.max(band(s - 0.43, 0.05), band(s - 0.735, 0.045), band(s - 1.0, 0.05) * 0.8);
        let col = mix3(hex('#cfd6d8'), BAR, bar * 0.85);
        col = mix3(col, hex('#2a2c30'), smoothstep(0.86, 0.97, a) * 0.6);
        return [...col, lerp(0.85, 0.5, a) * (0.8 + 0.2 * bar)];
      }
      if (region === REGION.caudal) {
        const e = Math.min(b, 1 - b);
        let col = mix3(hex('#d3dadd'), hex('#3a3d42'), smoothstep(0.1, 0.02, e) * 0.8);
        col = mix3(col, BAR, band(a - 0.08, 0.06) * 0.7);
        return [...col, lerp(0.8, 0.42, a)];
      }
      // pectorals: clear fins (drawn as cut-outs without MSAA), so painted in the flank's grey that shows through
      // them, with fine rays, not as pale patches
      return [...pectoralRays(ANGEL_PEC0, ANGEL_PEC1, a, b), lerp(0.6, 0.25, a)];
    },
    eye: { iris: '#c8322a', pupil: '#060606' },
    material: () => ({ metalness: 0.3, roughness: 0.3, clearcoat: 0.6, iridescence: 0.5, normalScale: 0.1 }),
    scaleDark: () => -0.03,
  };
  SHAPES.jgAngel = {
    ...SHAPES.moorishIdol,
    tailLen: 0.12, height: 0.68, hPos: 0.42, width: 0.09, wPos: 0.38, noseQ: 0.95, noseQw: 0.8, pinch: 0.22, pinchW: 0.4, arch: 0.0, mouthY: 0.06,
    caudal: { type: 'lunate', L: 0.26, S: 0.2, notch: 0.55 },
    dorsal: { d0: 0.3, d1: 0.8, h: 0.6, profile: [0, 0.6, 1.0, 0.85, 0.55, 0.3, 0.1], sweep: 1.15 },
    anal: { d0: 0.42, d1: 0.84, h: 0.56, profile: [0, 0.65, 1.0, 0.8, 0.5, 0.25, 0.08], sweep: 1.05 },
    pectoral: { s: 0.3, L: 0.1, W: 0.06, spread: 0.5, droop: 0.2, y: -0.02 },
    pelvic: { s: 0.34, L: 0.42, W: 0.026 },
    eye: { s: 0.165, r: 0.032, y: 0.16 },
    scales: { along: 70, around: 46, curve: 0.8 },
  };

  const OLIVE = hex('#56722a'), GOLD = hex('#e7c13a'), BELLY = hex('#f3e7b4'), BASS_BAR = hex('#1d2614'), RED = hex('#e2522a');
  PAINTERS.jgPeacock = {
    setup: () => ({}),
    body(s, v, C) {
      const q = C.q;
      let col = mix3(BELLY, GOLD, smoothstep(0.12, 0.4, q));
      col = mix3(col, OLIVE, smoothstep(0.62, 0.92, q));
      // warm orange throat and belly behind the pelvic fins
      col = mix3(col, hex('#ef8a3a'), (1 - smoothstep(0.05, 0.22, q)) * smoothstep(0.12, 0.3, s) * (1 - smoothstep(0.55, 0.75, s)) * 0.55);
      // three dark bars from the back down the flank, tapering
      for (const c of [0.31, 0.5, 0.69]) {
        const w = 0.034 * smoothstep(0.2, 0.55, q) + 0.004;
        col = mix3(col, BASS_BAR, band(s - c + (q - 0.6) * 0.03, w) * smoothstep(0.3, 0.5, q) * 0.85);
      }
      // a few pale spots on the rear flank
      const sp = Math.sin(s * 62) * Math.sin(q * 41 + s * 7);
      col = mix3(col, hex('#fff6c8'), smoothstep(0.86, 0.95, sp) * smoothstep(0.7, 0.9, s) * smoothstep(0.3, 0.5, q) * 0.6);
      // dark gill edge
      col = mix3(col, hex('#3c4a1e'), band(s - 0.205 - (q - 0.5) * 0.04, 0.008) * smoothstep(0.15, 0.3, q) * smoothstep(0.85, 0.7, q) * 0.6);
      return col;
    },
    fin(region, a, b) {
      if (region === REGION.pelvic || region === REGION.anal) return [...mix3(RED, hex('#f58a3a'), a * 0.5), lerp(0.92, 0.7, a)];
      if (region === REGION.caudal) {
        // gold-ringed black eyespot at the base of the upper lobe, orange lower lobe
        const dx = (a - 0.18) / 0.12, dy = (b - 0.62) / 0.16, r = Math.hypot(dx, dy);
        let col = mix3(hex('#9aa04a'), RED, smoothstep(0.55, 0.3, b) * 0.85);
        col = mix3(col, hex('#f6d24a'), smoothstep(1.25, 1.05, r));
        col = mix3(col, hex('#0e0f0a'), smoothstep(0.8, 0.62, r));
        return [...col, lerp(0.92, 0.6, a)];
      }
      if (region === REGION.dorsal) {
        let col = mix3(hex('#6f8040'), hex('#9aa25a'), a);
        col = mix3(col, hex('#f2f0d0'), smoothstep(0.82, 0.95, Math.sin(a * 23) * Math.sin(b * 31)) * smoothstep(0.45, 0.6, b) * 0.6);
        return [...col, lerp(0.88, 0.55, a)];
      }
      return [...pectoralRays(BASS_PEC0, BASS_PEC1, a, b), lerp(0.6, 0.25, a)];
    },
    eye: { iris: '#d23a24', pupil: '#060606' },
    material: () => ({ roughness: 0.36, clearcoat: 0.5, iridescence: 0.25, normalScale: 0.3 }),
    scaleDark: () => 0.12,
  };
  SHAPES.jgPeacock = {
    ...SHAPES.koi,
    tailLen: 0.2, height: 0.27, hPos: 0.4, width: 0.15, wPos: 0.35, noseQ: 0.62, noseQw: 0.6, pinch: 0.3, pinchW: 0.33, arch: 0.02, mouthY: -0.06,
    caudal: { type: 'round', L: 0.22, S: 0.15 },
    dorsal: { d0: 0.24, d1: 0.82, h: 0.1, profile: [0, 1, 0.95, 0.8, 0.35, 0.8, 0.95, 0.7, 0.15], sweep: 0.3 },
    anal: { d0: 0.66, d1: 0.86, h: 0.08, profile: [0, 1, 0.8, 0.15], sweep: 0.35 },
    pectoral: { s: 0.26, L: 0.11, W: 0.06, spread: 0.7, droop: 0.35, y: -0.15 },
    pelvic: { s: 0.32, L: 0.1, W: 0.045 },
    eye: { s: 0.1, r: 0.028, y: 0.12 },
    scales: { along: 56, around: 34, curve: 0.9 },
  };

  const TURQ = hex('#2fb6cc'), TURQ2 = hex('#2c86c4'), RUST = hex('#b4532a');
  PAINTERS.jgDiscus = {
    setup: () => ({}),
    body(s, v, C) {
      const q = C.q;
      let col = mix3(TURQ, TURQ2, smoothstep(0.5, 0.95, q) * 0.6);
      col = shade(col, q, 0.12);
      // wavy rust lines running along the body
      const w = Math.sin((q * 15 + Math.sin(s * 11 + q * 3) * 0.55) * Math.PI);
      col = mix3(col, RUST, smoothstep(0.62, 0.86, w) * smoothstep(0.1, 0.2, s) * 0.75);
      // nine faint vertical bars
      col = mix3(col, hex('#1d4a5c'), smoothstep(0.75, 0.95, Math.cos(s * 9 * Math.PI * 2)) * 0.18);
      // dark eye bar
      col = mix3(col, hex('#3a2a20'), band(s - 0.15, 0.02) * smoothstep(0.2, 0.3, q) * 0.65);
      return col;
    },
    fin(region, a, b) {
      if (region === REGION.dorsal || region === REGION.anal) {
        let col = mix3(RUST, TURQ, smoothstep(0.15, 0.5, a));
        const w = Math.sin((b * 18 + a * 4) * Math.PI);
        col = mix3(col, RUST, smoothstep(0.6, 0.9, w) * smoothstep(0.3, 0.6, a) * 0.6);
        col = mix3(col, hex('#7fe6ff'), smoothstep(0.82, 0.95, a));
        return [...col, lerp(0.92, 0.7, a)];
      }
      if (region === REGION.pelvic) return [...mix3(hex('#d0562a'), hex('#7fe6ff'), smoothstep(0.7, 0.95, a)), 0.9];
      if (region === REGION.caudal) return [...mix3(hex('#3aa8c0'), hex('#9fe8f8'), a), lerp(0.75, 0.4, a)];
      return [...pectoralRays(DISCUS_PEC0, DISCUS_PEC1, a, b), lerp(0.55, 0.22, a)];
    },
    eye: { iris: '#e0301e', pupil: '#060606' },
    material: () => ({ roughness: 0.32, clearcoat: 0.6, iridescence: 0.55, normalScale: 0.15 }),
    scaleDark: () => 0.02,
  };
  SHAPES.jgDiscus = {
    ...SHAPES.emperorAngel,
    tailLen: 0.12, height: 0.7, hPos: 0.46, width: 0.1, wPos: 0.38, noseQ: 0.75, noseQw: 0.7, pinch: 0.2, pinchW: 0.4, arch: 0.0, mouthY: 0.0,
    caudal: { type: 'truncate', L: 0.13, S: 0.13 },
    dorsal: { d0: 0.28, d1: 0.92, h: 0.13, profile: [0, 0.7, 0.9, 1, 1, 0.9, 0.6, 0.2], sweep: 0.55 },
    anal: { d0: 0.45, d1: 0.92, h: 0.12, profile: [0, 0.8, 1, 1, 0.85, 0.5, 0.15], sweep: 0.5 },
    pectoral: { s: 0.3, L: 0.1, W: 0.07, spread: 0.5, droop: 0.2, y: -0.02 },
    pelvic: { s: 0.34, L: 0.12, W: 0.03 },
    eye: { s: 0.15, r: 0.03, y: 0.12 },
    scales: { along: 80, around: 50, curve: 0.8 },
  };
}

/** The pond's species: painter/shape name, how many (the old sets' counts), and how much larger each is drawn
 * than its swimmer's size (the swimmer itself, its pace and tail beat, are unchanged). */
export const POND_FISH = [
  { species: 'jgAngel', n: 3, show: 1.4 },
  { species: 'jgPeacock', n: 4, show: 1.45 },
  { species: 'jgDiscus', n: 3, show: 1.35 },
];

/**
 * Fish keep more of their colour through the green water than the pond floor does: the light transmitted through
 * the water path is absorbed as if the water were `k` clearer (the haze in front of them is unchanged), so their
 * markings still read from the bank. Apply BEFORE jungleMaterial: its fog chunk (underwater tint + fog) then
 * follows this code.
 */
export function clearerUnderwater(material, k = 0.4) {
  return patchMaterial(material, {
    key: 'jgFishClear' + k,
    fragment: {
      '#include <fog_fragment>': /* glsl */`
        {
          float fdw = uWaterY - vWorldP.y;
          if (fdw > 0.0) {
            vec3 fV = normalize(cameraPosition - vWorldP);
            gl_FragColor.rgb *= exp(uAbsorb * (fdw / max(fV.y, 0.12) + fdw * 0.6) * ${k.toFixed(3)});
          }
        }
        $&`,
    },
  });
}

/**
 * Fins are thin membranes: no metal, a light clear coat and no iridescence, and a softer sheen, so a flat fin
 * turned to the light does not flash white like a small mirror (the body keeps its glossy scales). Fin texels are
 * the atlas columns from u = 0.72 (lib/fish.js RECT), less the eye's rect. Apply BEFORE jungleMaterial.
 */
export function matteFins(material) {
  return patchMaterial(material, {
    key: 'jgMatteFins',
    fragment: {
      '#include <roughnessmap_fragment>': /* glsl */`$&
        float jgFin = step(0.72, vMapUv.x) * (1.0 - step(0.88, vMapUv.x) * step(0.9, vMapUv.y));
        roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.62), jgFin);`,
      '#include <metalnessmap_fragment>': /* glsl */`$&
        metalnessFactor *= 1.0 - jgFin;`,
      '#include <lights_physical_fragment>': /* glsl */`$&
        #ifdef USE_CLEARCOAT
          material.clearcoat *= 1.0 - 0.75 * jgFin;
        #endif
        #ifdef USE_IRIDESCENCE
          material.iridescence *= 1.0 - jgFin;
        #endif`,
    },
  });
}

/**
 * Keep a painted fish atlas mip-mapped on WebGL 1: three.js turns mipmaps off for sRGB textures there (EXT_sRGB
 * cannot generate them), so a minified atlas would shimmer. The atlas is uploaded as plain data and decoded
 * from sRGB in the shader instead.
 */
export function mipmappedAtlas(material) {
  const map = material.map;
  map.colorSpace = THREE.NoColorSpace;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.needsUpdate = true;
  return patchMaterial(material, {
    key: 'jgFishAtlas',
    fragment: {
      '#include <map_fragment>': /* glsl */`
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          // sRGB -> linear (polynomial fit, within 0.3%)
          vec3 sdc = sampledDiffuseColor.rgb;
          sampledDiffuseColor.rgb = sdc * (sdc * (sdc * 0.305306011 + 0.682171111) + 0.012522878);
          diffuseColor *= sampledDiffuseColor;
        #endif`,
    },
  });
}

/** What FishInstances.push reads from a swimmer, drawn `show` times larger (one object reused). */
const _shown = { pos: null, quat: null, size: 1, phase: 0, amp: 0, turn: 0, flutter: 0 };
export function pushShown(inst, sw, show) {
  _shown.pos = sw.pos; _shown.quat = sw.quat; _shown.size = sw.size * show;
  _shown.phase = sw.phase; _shown.amp = sw.amp; _shown.turn = sw.turn; _shown.flutter = sw.flutter;
  return inst.push(_shown);
}

