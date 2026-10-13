// 雨林 · the waterfall cliff's rock surface: wet layered rock instead of a repeating embossed pattern.
//  - a packed, tileable data texture: wavy laminations that pinch out, recessed soft layers, stepped vertical
//    joints, granular roughness and pits; RG = height slope (detail normal), B = albedo (gamma-encoded, decoded as
//    B²), A = crevice mask (blurred, so moss margins are soft). Linear on purpose: WebGL 1 gets no mipmaps for sRGB
//    textures and an unfiltered detail texture would sparkle on the iPad.
//  - sampled twice: the detail tile, and a copy stretched along the fall line that gives seep streaks and slow tonal
//    variation, so the tile never reads as a repeat. (Two reads, as many as the old colour + normal maps.)
//  - moss grows in the crevices (the texture's and the geometry's own columns and ledges), wet streaks are darker
//    and glossy, the moss stays matte.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, makeRng, patchMaterial } from '../../lib/util.js';

/** Gradient noise in about [-1, 1], periodic with px cells in x and py in y (≤ 256). */
function periodicNoise(seed) {
  const rng = makeRng(seed);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rng.next() * TAU; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y, px, py = px) => {
    const xf = Math.floor(x), yf = Math.floor(y), fx = x - xf, fy = y - yf;
    const x0 = ((xf % px) + px) % px, y0 = ((yf % py) + py) % py, x1 = (x0 + 1) % px, y1 = (y0 + 1) % py;
    const h00 = perm[(perm[x0] + y0) & 255], h10 = perm[(perm[x1] + y0) & 255], h01 = perm[(perm[x0] + y1) & 255], h11 = perm[(perm[x1] + y1) & 255];
    const u = fade(fx), v = fade(fy);
    return 1.4 * lerp(lerp(gx[h00] * fx + gy[h00] * fy, gx[h10] * (fx - 1) + gy[h10] * fy, u), lerp(gx[h01] * fx + gy[h01] * (fy - 1), gx[h11] * (fx - 1) + gy[h11] * (fy - 1), u), v);
  };
}
/** fbm of periodic noise; odd octaves on a 45°-turned lattice ((u+v, u−v) keeps the period), so no grid shows. */
function pfbm(n, u, v, p, oct) {
  let s = 0, a = 0.5, f = p;
  for (let o = 0; o < oct; o++) { s += a * (o & 1 ? n((u + v) * f + 0.31, (u - v) * f + 0.67, f) : n(u * f, v * f, f)); f *= 2; a *= 0.5; }
  return s;
}
function splat(arr, S, cx, cy, r, amount, edge = 1) {
  for (let y = Math.floor(cy - r - edge); y <= Math.ceil(cy + r + edge); y++) for (let x = Math.floor(cx - r - edge); x <= Math.ceil(cx + r + edge); x++) {
    const c = clamp((r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)) / edge + 0.5, 0, 1);
    if (c > 0) { const k = (((y % S) + S) % S) * S + (((x % S) + S) % S); arr[k] = Math.max(arr[k], amount * c); }
  }
}

/** The cliff's surface, one tile (the material maps it to about 4 m of rock). */
export function cliffRockTexture(seed, S = 512) {
  const rng = makeRng(seed);
  const nA = periodicNoise(seed), nB = periodicNoise(seed + 1), nC = periodicNoise(seed + 2), nD = periodicNoise(seed + 3);
  // laminations: a periodic stack of layers 5–40 texels thick (≈4–33 cm), each with its own tone, a few recessed
  const layers = [];
  for (let tot = 0; tot < S;) {
    // mostly thin laminations, now and then a thick massive bed (breaks up the stripes)
    const t = rng.next() < 0.1 ? rng.range(45, 80) : rng.range(5, 30) * (rng.next() < 0.18 ? 1.8 : 1);
    layers.push({ t, tone: rng.range(-0.09, 0.07), recess: rng.next() < 0.3 ? rng.range(0.025, 0.07) : rng.range(0, 0.01), rough: rng.range(0.5, 1.4), edge: rng.range(0.3, 1), ph: rng.range(0, 50) });
    tot += t;
  }
  {
    const sum = layers.reduce((a, L) => a + L.t, 0);
    let acc = 0;
    for (const L of layers) { L.t *= S / sum; L.y0 = acc; acc += L.t; }
  }
  const NL = layers.length;
  const layerAt = y => { // y in [0, S)
    let lo = 0, hi = NL - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (layers[m].y0 <= y) lo = m; else hi = m - 1; }
    return lo;
  };
  const H = new Float32Array(S * S), L = new Float32Array(S * S), A = new Float32Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = i / S, v = j / S, k = j * S + i;
    // wavy bedding: the boundaries drift up and down along the face (everything here tiles in u and v)
    const yw = j + pfbm(nB, u, v, 2, 3) * 18 + nC(u * 7, v * 2, 7, 2) * 3.5;
    const ym = ((yw % S) + S) % S;
    const li = layerAt(ym), Ly = layers[li];
    const f = (ym - Ly.y0) / Ly.t;
    const db = Math.min(f, 1 - f) * Ly.t; // texels to the nearest bedding plane
    // the bedding plane comes and goes along the face (layers merge and pinch out)
    const vis = Ly.edge * smoothstep(-0.05, 0.45, nD(u * 5 + Ly.ph, li * 0.37, 5));
    const groove = (1 - smoothstep(0.3, 2.2, db)) * vis;
    const broad = pfbm(nC, u + 0.3, v + 0.7, 6, 3);
    const fine = pfbm(nA, u, v, 16, 3), grain = pfbm(nD, u + 0.5, v + 0.5, 64, 2);
    const rec = Ly.recess * smoothstep(0.5, 3.0, db) * smoothstep(-0.3, 0.2, broad + 0.15);
    H[k] = broad * 0.1 + fine * 0.09 + grain * 0.03 * Ly.rough - rec - groove * 0.045;
    L[k] = 0.62 + Ly.tone + broad * 0.08 + fine * 0.12 + grain * 0.05 * Ly.rough - groove * 0.22 - rec * 2.0;
    A[k] = Math.max(groove, smoothstep(0.02, 0.06, Ly.recess) * (1 - smoothstep(1, 7, db)) * 0.7);
  }
  // vertical joints: irregular cracks through one to five layers, often stepping sideways at a bedding plane
  const joint = new Float32Array(S * S);
  for (let c = 0; c < Math.round(S * S / 6500); c++) {
    let x = rng.next() * S, li = rng.int(0, NL - 1);
    const n = rng.int(1, 5), w0 = rng.range(0.5, 1.4);
    for (let m = 0; m < n; m++) {
      const Ly = layers[(li + m) % NL];
      let y = Ly.y0, a = Math.PI / 2 + rng.range(-0.3, 0.3);
      const y1 = Ly.y0 + Ly.t, w = w0 * (1 - 0.5 * m / n) * rng.range(0.7, 1.1);
      while (y < y1) { splat(joint, S, x, y, w, 1, 0.9); a += rng.range(-0.12, 0.12); x += Math.cos(a) * 0.8; y += Math.sin(a) * 0.8; }
      if (rng.next() < 0.65) x += rng.range(-11, 11); // a step at the bedding plane
    }
  }
  // spalls: patches where a skin of rock has broken away, leaving a rough, slightly paler hollow
  const spall = new Float32Array(S * S);
  for (let c = 0; c < Math.round(S * S / 11000); c++) {
    const cx = rng.next() * S, cy = rng.next() * S, R = rng.range(5, 18), ph = rng.range(0, TAU), ph2 = rng.range(0, TAU);
    for (let y = Math.floor(cy - R * 1.4); y <= Math.ceil(cy + R * 1.4); y++) for (let x = Math.floor(cx - R * 1.4); x <= Math.ceil(cx + R * 1.4); x++) {
      const dx = x + 0.5 - cx, dy = (y + 0.5 - cy) * 1.6, a = Math.atan2(dy, dx);
      const rr = R * (1 + 0.22 * Math.sin(a * 3 + ph) + 0.1 * Math.sin(a * 7 + ph2));
      const cov = clamp((rr - Math.hypot(dx, dy)) / 1.5 + 0.5, 0, 1);
      if (cov > 0) { const k = (((y % S) + S) % S) * S + (((x % S) + S) % S); spall[k] = Math.max(spall[k], cov); }
    }
  }
  // pits in the softer layers
  const pits = new Float32Array(S * S);
  for (let i = 0; i < Math.round(S * S / 700); i++) splat(pits, S, rng.next() * S, rng.next() * S, rng.range(0.6, 2.2), rng.range(0.5, 1), 1.2);
  for (let k = 0; k < S * S; k++) {
    const jt = joint[k], pt = pits[k], sp = spall[k];
    const rim = sp * (1 - sp) * 4; // the broken edge
    H[k] -= jt * 0.09 + pt * 0.03 + sp * 0.035;
    L[k] = clamp(L[k] - jt * 0.32 - pt * 0.12 + sp * 0.05 - rim * 0.08, 0.06, 1);
    A[k] = Math.max(A[k], Math.max(jt, rim * 0.5));
  }
  // soft crevice mask (moss spreads a little out of the cracks): three passes of a 5-tap box blur, wrapped
  const tmp = new Float32Array(S * S);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { let s = 0; for (let d = -2; d <= 2; d++) s += A[j * S + ((i + d + S) % S)]; tmp[j * S + i] = s / 5; }
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { let s = 0; for (let d = -2; d <= 2; d++) s += tmp[((j + d + S) % S) * S + i]; A[j * S + i] = s / 5; }
  }
  const data = new Uint8Array(S * S * 4);
  const K = S / 8;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const k = j * S + i;
    const dx = (H[j * S + ((i + 1) % S)] - H[j * S + ((i - 1 + S) % S)]) * 0.5 * K, dy = (H[((j + 1) % S) * S + i] - H[((j - 1 + S) % S) * S + i]) * 0.5 * K;
    data[k * 4] = Math.round((clamp(dx, -1, 1) * 0.5 + 0.5) * 255);
    data[k * 4 + 1] = Math.round((clamp(dy, -1, 1) * 0.5 + 0.5) * 255);
    data[k * 4 + 2] = Math.round(L[k] * 255);
    data[k * 4 + 3] = Math.round(clamp(A[k] * 2.0, 0, 1) * 255);
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.anisotropy = 8; tex.colorSpace = THREE.NoColorSpace;
  tex.repeat.set(0.85, 0.85); // the cliff's uv runs 1 per 3.5 m; one tile ≈ 4.1 m
  tex.needsUpdate = true;
  return tex;
}

/**
 * Cliff shading on a MeshStandardMaterial that already has jungleMaterial (apply this after it: its colour and
 * roughness code then runs first, and the jungle's ledge moss, rain and glow apply on top). Needs the cliff
 * geometry's `aCliff` attribute (crevice, wet, stain) and `material.map` = cliffRockTexture.
 */
export function cliffSurface(material) {
  const U = { uCkBump: { value: 0.75 }, uCkGain: { value: 0.58 } };
  material.userData.cliffU = U;
  return patchMaterial(material, {
    key: 'jgCliff',
    uniforms: U,
    vertexHeader: 'attribute vec3 aCliff;\nvarying vec3 vCliff;',
    fragmentHeader: 'varying vec3 vCliff;\nuniform float uCkBump, uCkGain;',
    vertex: { '#include <begin_vertex>': '$&\n vCliff = aCliff;' },
    fragment: {
      '#include <map_fragment>': /* glsl */`
        vec4 ckD = texture2D(map, vMapUv);
        // the same tile stretched along the fall line: seep streaks and a slow tonal drift (no visible repeat)
        vec4 ckS = texture2D(map, vec2(vMapUv.x * 1.37 + 0.21, vMapUv.y * 0.17 + 0.53));
        float ckL = ckD.b * (0.8 + 0.4 * ckS.b);
        float ckSeep = smoothstep(0.5, 0.8, ckS.b) * (0.35 + 0.65 * vCliff.y);
        diffuseColor.rgb *= ckL * ckL * uCkGain * (1.0 - 0.28 * ckSeep);
        float ckWet = clamp(max(vCliff.y, ckSeep), 0.0, 1.0);`,
      '#include <color_fragment>': /* glsl */`$&
        // moss in the crevices: the texture's joints and bedding planes, and the geometry's own columns and ledges
        float ckMoss = smoothstep(0.32, 0.66, ckD.a * 0.7 + vCliff.x * 0.85 + (ckS.a - 0.5) * 0.4) * (1.0 - 0.4 * ckSeep);
        diffuseColor.rgb = mix(diffuseColor.rgb, uMossColor * (0.55 + 0.8 * ckD.b) * (0.85 + 0.3 * ckS.b), ckMoss * 0.85);`,
      '#include <roughnessmap_fragment>': '$&\n roughnessFactor = mix(roughnessFactor, 0.34, ckWet * (1.0 - ckMoss)) + ckMoss * 0.08;',
      '#include <normal_fragment_maps>': /* glsl */`
        {
          // tangent frame from screen-space derivatives (no tangent attribute), as three.js does for normal maps
          vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
          vec2 st0 = dFdx(vMapUv), st1 = dFdy(vMapUv);
          vec3 q1perp = cross(q1, normal), q0perp = cross(normal, q0);
          vec3 T = q1perp * st0.x + q0perp * st1.x, B = q1perp * st0.y + q0perp * st1.y;
          float det = max(dot(T, T), dot(B, B));
          float sc = det == 0.0 ? 0.0 : inversesqrt(det);
          vec2 g = ckD.rg * 2.0 - 1.0;
          normal = normalize(normal - (T * g.x + B * g.y) * sc * uCkBump * (1.0 - 0.45 * ckMoss));
        }`,
    },
  });
}
