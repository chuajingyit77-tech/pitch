// 晴岛 · weathered coastal rock: welded, smooth-shaded boulders with weathered joint faces (same shapes, heights
// and seeds as before), baked crease and underside occlusion, and a world-space triplanar surface: mottled
// grey-brown basalt with vesicle pits, cracks and coastal lichen, moss on the tops, a dark wet band with
// barnacles at the waterline.
//
// One packed RGBA data texture carries the surface: RG = height slope (detail normal), B = albedo (gamma-
// encoded, decoded as B²), A = lichen. Linear on purpose: in WebGL 1 three.js turns mipmapping off for sRGB
// textures, and an unfiltered detail texture would sparkle on the iPad.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, smoothstep, makeRng, createNoise, patchMaterial } from '../../lib/util.js';

/* ------------------------------------------------------------------ */
/* Tileable noise helpers                                              */
/* ------------------------------------------------------------------ */
/** Gradient noise in about [-1, 1], periodic with p cells (p ≤ 256) in x and y. */
function periodicNoise(seed) {
  const rng = makeRng(seed);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rng.next() * TAU; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y, p) => {
    const xf = Math.floor(x), yf = Math.floor(y), fx = x - xf, fy = y - yf;
    const x0 = ((xf % p) + p) % p, y0 = ((yf % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
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
/** Anti-aliased soft disc added into a wrapped S×S float image. */
function splat(arr, S, cx, cy, r, amount, edge = 1) {
  for (let y = Math.floor(cy - r - edge); y <= Math.ceil(cy + r + edge); y++) for (let x = Math.floor(cx - r - edge); x <= Math.ceil(cx + r + edge); x++) {
    const c = clamp((r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)) / edge + 0.5, 0, 1);
    if (c > 0) arr[(((y % S) + S) % S) * S + (((x % S) + S) % S)] += amount * c;
  }
}

/* ------------------------------------------------------------------ */
/* Surface texture                                                     */
/* ------------------------------------------------------------------ */
/** Weathered coastal basalt, tileable; one tile = 1 / uRkScale metres (about 2 m). */
export function islandRockTexture(seed, S = 512) {
  const rng = makeRng(seed);
  const nA = periodicNoise(seed), nB = periodicNoise(seed + 1), nC = periodicNoise(seed + 2);
  const H = new Float32Array(S * S), L = new Float32Array(S * S), Li = new Float32Array(S * S);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const u = i / S, v = j / S, k = j * S + i;
    const wx = pfbm(nB, u, v, 3, 1) * 0.03, wy = pfbm(nC, u, v, 3, 1) * 0.03;
    const big = pfbm(nA, u + wx, v + wy, 5, 5);
    // weathered layering (world-horizontal on the sides): ~7 beds a tile, each its own tone, the softer seams between
    // them etched back by salt and spray
    const sv = (v + big * 0.05 + wy * 1.5) * 7, bed = ((Math.floor(sv) % 7) + 7) % 7, fb = sv - Math.floor(sv);
    const bedTone = ((Math.sin(bed * 12.9898 + 4.1) * 43758.5453) % 1 + 1) % 1;
    const seam = (1 - smoothstep(0.0, 0.09, Math.min(fb, 1 - fb))) * (0.55 + 0.45 * smoothstep(-0.3, 0.3, nC(u * 5, bed * 0.83, 5)));
    const fine = pfbm(nB, u + 0.5, v + 0.25, 40, 2);
    H[k] = big * 0.38 + fine * 0.05 - seam * 0.07 + Math.sin(fb * Math.PI) * 0.03;
    L[k] = 0.66 + big * 0.24 + fine * 0.07 + (bedTone - 0.5) * 0.12 - seam * 0.2;
  }
  // vesicles and pits: many small, a few larger
  const pits = new Float32Array(S * S);
  for (let i = 0; i < Math.round(S * S / 260); i++) splat(pits, S, rng.next() * S, rng.next() * S, rng.range(0.6, 1.8), rng.range(0.4, 1), 1);
  for (let i = 0; i < Math.round(S * S / 5200); i++) splat(pits, S, rng.next() * S, rng.next() * S, rng.range(2, 4.5), rng.range(0.6, 1), 1.4);
  // cracks: jittered, tapering, with the odd branch
  const crack = new Float32Array(S * S);
  const drawCrack = (x, y, a, len, w, depth) => {
    for (let d = 0; d < len; d += 0.8) {
      const t = d / len;
      splat(crack, S, x, y, w * (1 - t * 0.75), 0.35 * (1 - t * 0.4), 0.9);
      a += rng.range(-0.1, 0.1) + (rng.next() < 0.025 ? rng.range(-0.7, 0.7) : 0);
      x += Math.cos(a) * 0.8; y += Math.sin(a) * 0.8;
      if (depth < 2 && rng.next() < 0.005) drawCrack(x, y, a + rng.sign() * rng.range(0.5, 1.2), len * (1 - t) * rng.range(0.3, 0.6), w * 0.8, depth + 1);
    }
  };
  // a few wide fissures that still read from across the island, and finer cracks
  for (let c = 0; c < 4; c++) drawCrack(rng.next() * S, rng.next() * S, rng.range(0, TAU), rng.range(0.3, 0.6) * S, rng.range(2.4, 3.6), 0);
  for (let c = 0; c < 10; c++) drawCrack(rng.next() * S, rng.next() * S, rng.range(0, TAU), rng.range(0.12, 0.35) * S, rng.range(0.9, 1.6), 0);
  // coastal lichen: irregular round patches (orange or grey in the shader), mottled, clustered
  for (let c = 0, guard = 0; c < Math.round(S * S / 9000) && guard < 4000; guard++) {
    const cx = rng.next() * S, cy = rng.next() * S;
    if (pfbm(nC, cx / S + 0.4, cy / S + 0.9, 2, 2) < rng.range(-0.1, 0.2)) continue;
    c++;
    const R = rng.range(8, 36) * S / 512;
    const h1 = [rng.range(0.05, 0.12), rng.int(2, 4), rng.range(0, TAU)], h2 = [rng.range(0.03, 0.07), rng.int(5, 8), rng.range(0, TAU)], h3 = [rng.range(0.015, 0.035), rng.int(11, 17), rng.range(0, TAU)];
    const mot = rng.range(0, 50);
    for (let y = Math.floor(cy - R * 1.3 - 2); y <= Math.ceil(cy + R * 1.3 + 2); y++) for (let x = Math.floor(cx - R * 1.3 - 2); x <= Math.ceil(cx + R * 1.3 + 2); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, a = Math.atan2(dy, dx);
      const rr = R * (1 + h1[0] * Math.sin(a * h1[1] + h1[2]) + h2[0] * Math.sin(a * h2[1] + h2[2]) + h3[0] * Math.sin(a * h3[1] + h3[2]));
      let cov = clamp((rr - Math.hypot(dx, dy)) / 1.3 + 0.5, 0, 1);
      if (cov <= 0) continue;
      cov *= 0.8 + 0.2 * nB((x + mot) * 0.25, (y + mot) * 0.25, 128);
      const k = (((y % S) + S) % S) * S + (((x % S) + S) % S);
      Li[k] = Math.max(Li[k], cov);
    }
  }
  for (let k = 0; k < S * S; k++) {
    const pt = Math.min(pits[k], 1), cr = Math.min(crack[k], 1);
    H[k] += -pt * 0.06 - cr * 0.25 + Li[k] * 0.02;
    L[k] = clamp(L[k] - pt * 0.22 - cr * 0.4, 0.06, 1);
    Li[k] *= 1 - cr;
  }
  const data = new Uint8Array(S * S * 4);
  const K = S / 8;
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const k = j * S + i;
    const dx = (H[j * S + ((i + 1) % S)] - H[j * S + ((i - 1 + S) % S)]) * 0.5 * K, dy = (H[((j + 1) % S) * S + i] - H[((j - 1 + S) % S) * S + i]) * 0.5 * K;
    data[k * 4] = Math.round((clamp(dx, -1, 1) * 0.5 + 0.5) * 255);
    data[k * 4 + 1] = Math.round((clamp(dy, -1, 1) * 0.5 + 0.5) * 255);
    data[k * 4 + 2] = Math.round(L[k] * 255);
    data[k * 4 + 3] = Math.round(clamp(Li[k], 0, 1) * 255);
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.anisotropy = 4; tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Material                                                            */
/* ------------------------------------------------------------------ */
/**
 * The rock material (before the underwater patch): triplanar surface (3 texture reads), lichen on exposed faces,
 * moss and grass on the tops (edge broken up by the stone's mottling), the wet band with barnacles at the
 * waterline, and the vertex colours (tone × baked occlusion).
 */
export function makeIslandRockMaterial(tex) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, envMapIntensity: 0.6 });
  const U = {
    tRock: { value: tex },
    uRkScale: { value: 0.3 },                   // tiles per metre: the outcrop is seen from 10–20 m
    uRkBump: { value: 0.6 },
    uRkLichenA: { value: new THREE.Color('#b8894c') },
    uRkLichenB: { value: new THREE.Color('#b8b6a0') },
  };
  m.userData.rockU = U;
  return patchMaterial(m, {
    key: 'islandRock',
    uniforms: U,
    vertexHeader: 'attribute float aRockH;\nvarying vec3 vRkPos; varying vec3 vRkN; varying float vRkH;',
    fragmentHeader: /* glsl */`
      varying vec3 vRkPos; varying vec3 vRkN; varying float vRkH;
      uniform sampler2D tRock;
      uniform float uRkScale, uRkBump;
      uniform vec3 uRkLichenA, uRkLichenB;`,
    vertex: { '#include <fog_vertex>': '$&\n vRkPos = (mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix); vRkN = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz); vRkH = aRockH;' },
    fragment: {
      '#include <map_fragment>': /* glsl */`
        vec3 rkN = normalize(vRkN);
        vec3 rkB = rkN * rkN; rkB *= rkB; rkB /= (rkB.x + rkB.y + rkB.z);
        vec3 rkP = vRkPos * uRkScale;
        vec4 rkX = texture2D(tRock, rkP.zy);
        vec4 rkY = texture2D(tRock, rkP.xz + vec2(0.37, 0.61));
        vec4 rkZ = texture2D(tRock, rkP.xy + vec2(0.73, 0.0)); // same v as the x projection: strata meet at corners
        float rkL = rkX.b * rkB.x + rkY.b * rkB.y + rkZ.b * rkB.z;
        float rkLi = rkX.a * rkB.x + rkY.a * rkB.y + rkZ.a * rkB.z;
        diffuseColor.rgb *= (rkL * rkL) * 2.7;
        // coastal lichen above the spray line: orange and grey patches on the exposed faces
        float rkExp = smoothstep(-0.3, 0.45, rkN.y) * smoothstep(0.35, 0.9, vRkPos.y);
        vec3 lichC = mix(uRkLichenB, uRkLichenA, smoothstep(0.42, 0.6, fract(rkY.b * 7.0 + rkX.b * 3.0))) * (0.7 + 0.5 * rkL);
        float rkLiA = rkLi * rkExp * 0.6;`,
      '#include <color_fragment>': /* glsl */`$&
        diffuseColor.rgb = mix(diffuseColor.rgb, lichC, rkLiA);
        // moss and grass on the tops, their margin broken up by the stone's own mottling
        float rkTop = smoothstep(0.5, 0.82, rkN.y + (rkL - 0.62) * 0.9);
        vec3 mossC = mix(vec3(0.62, 0.55, 0.38), vec3(0.24, 0.36, 0.12), smoothstep(0.6, 1.4, vRkPos.y)) * (0.7 + 0.55 * rkL);
        float rkMoss = rkTop * 0.85 * smoothstep(0.25, 0.6, vRkPos.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, mossC, rkMoss);
        float rkWet = (1.0 - smoothstep(0.02, 0.32, vRkPos.y)) * smoothstep(-0.5, -0.1, vRkPos.y);
        diffuseColor.rgb *= mix(1.0, 0.55, rkWet);
        // the damp foot where the stone meets the soil: darker, faintly green
        float rkDp = (1.0 - smoothstep(0.12, 0.42, vRkH)) * (1.0 - rkMoss) * smoothstep(0.25, 0.6, vRkPos.y);
        diffuseColor.rgb *= mix(vec3(1.0), vec3(0.58, 0.62, 0.52), rkDp);
        // barnacle speckles near the waterline (4.5 cm cells: their average once a cell is under ~2 px)
        vec2 bq = vRkPos.xz * 22.0 + vRkPos.y * 9.0;
        vec2 bqx = dFdx(bq), bqy = dFdy(bq);
        float sp = step(0.82, fract(sin(dot(floor(bq), vec2(12.9898, 78.233))) * 43758.5453));
        sp = mix(sp, 0.18, smoothstep(0.3, 0.75, sqrt(max(dot(bqx, bqx), dot(bqy, bqy)))));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.85, 0.82, 0.75), sp * rkWet * step(-0.3, vRkPos.y) * 0.6);`,
      '#include <roughnessmap_fragment>': '$&\n roughnessFactor = mix(mix(clamp(roughnessFactor + (0.6 - rkL) * 0.12 + rkMoss * 0.1, 0.6, 1.0), 0.5, rkDp), 0.3, rkWet * step(-0.05, vRkPos.y));',
      '#include <normal_fragment_maps>': /* glsl */`
        {
          vec2 gX = rkX.rg * 2.0 - 1.0, gY = rkY.rg * 2.0 - 1.0, gZ = rkZ.rg * 2.0 - 1.0;
          vec3 G = vec3(gY.x * rkB.y + gZ.x * rkB.z, gX.y * rkB.x + gZ.y * rkB.z, gX.x * rkB.x + gY.y * rkB.y);
          G -= rkN * dot(G, rkN);
          normal = normalize((viewMatrix * vec4(normalize(rkN - G * uRkBump * (1.0 - 0.55 * rkMoss)), 0.0)).xyz);
        }`,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */
const _p = new THREE.Vector3();
const TONE_A = new THREE.Color('#8f877b'), TONE_B = new THREE.Color('#6a6259'), TONE_C = new THREE.Color('#a39a8b');

const ROCK_STRETCH = [0.8, 1.0, 1.2]; // z stretches the rocks are drawn with (flora.js: s × 0.8–1.2 in z, s in x)

/**
 * One boulder (unit size): the old displaced icosphere's shape at a finer, welded tessellation with smooth
 * normals, a few weathered joint faces and fine relief. The height is fitted back to the old rock's (icosphere
 * `refDetail`) and it never reaches wider than the old rock did, so footprints (crab obstacles, foam) and gull
 * perches stay where they were.
 * Vertex colours: the old grey-brown tones × crease / underside occlusion.
 */
export function buildRock(seed, detail = 6, refDetail = 3) {
  const nz = createNoise(seed);
  const shape = (x, y, z, out) => {
    const k = 1 + 0.28 * nz.fbm3(x * 1.2, y * 1.2, z * 1.2, 4) + 0.06 * nz.noise3(x * 5, y * 5, z * 5);
    out.set(x * k, y * k * 0.62, z * k);
    if (out.y < -0.25) out.y = -0.25 + (out.y + 0.25) * 0.4;
    return out;
  };
  // the old rock's height and widest reach (the low-poly icosphere it used to be: refDetail)
  let yLo = Infinity, yHi = -Infinity;
  const rOld = [0, 0, 0];
  {
    const ref = new THREE.IcosahedronGeometry(1, refDetail), rp = ref.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      shape(rp.getX(i), rp.getY(i), rp.getZ(i), _p);
      yLo = Math.min(yLo, _p.y); yHi = Math.max(yHi, _p.y);
      for (let a = 0; a < 3; a++) rOld[a] = Math.max(rOld[a], Math.hypot(_p.x, _p.z * ROCK_STRETCH[a]));
    }
    ref.dispose();
  }
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position, N = p.count, pos = p.array;
  for (let i = 0; i < N; i++) { shape(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], _p); pos[i * 3] = _p.x; pos[i * 3 + 1] = _p.y; pos[i * 3 + 2] = _p.z; }
  const r = makeRng(seed * 7 + 3);
  const dir = (el, az) => new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
  const planes = [{ n: dir(Math.PI / 2 - r.range(0.05, 0.4), r.range(0, TAU)), depth: r.range(0.08, 0.14) }];
  const az0 = r.range(0, TAU);
  for (let k = 0; k < 6; k++) planes.push({ n: dir(r.range(-0.05, 0.65), az0 + (k + r.range(-0.3, 0.3)) / 6 * TAU), depth: r.range(0.04, 0.1) });
  for (const pl of planes) {
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < N; i++) { const d = pos[i * 3] * pl.n.x + pos[i * 3 + 1] * pl.n.y + pos[i * 3 + 2] * pl.n.z; hi = Math.max(hi, d); lo = Math.min(lo, d); }
    const o = hi - pl.depth * (hi - lo);
    for (let i = 0; i < N; i++) {
      const d = pos[i * 3] * pl.n.x + pos[i * 3 + 1] * pl.n.y + pos[i * 3 + 2] * pl.n.z - o;
      if (d > 0) { pos[i * 3] -= pl.n.x * d * 0.8; pos[i * 3 + 1] -= pl.n.y * d * 0.8; pos[i * 3 + 2] -= pl.n.z * d * 0.8; }
    }
  }
  const ra = r.range(0, 50), rb = r.range(0, 50);
  for (let i = 0; i < N; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1] / 0.62, z = pos[i * 3 + 2];
    const k = 1 + Math.sin(x * 7.1 + ra) * Math.sin(y * 6.3 + 1.7) * Math.sin(z * 6.7 + rb) * 0.02 + Math.sin(x * 13.3 + 2.1) * Math.sin(y * 12.1 + ra) * Math.sin(z * 14.2 + 0.4) * 0.008 - 0.012;
    pos[i * 3] *= k; pos[i * 3 + 1] *= k; pos[i * 3 + 2] *= k;
  }
  // the old height, and never wider than the old rock's widest reach (the finer mesh can catch a bulge between
  // the old vertices)
  let nl = Infinity, nh = -Infinity;
  const rNew = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    nl = Math.min(nl, pos[i * 3 + 1]); nh = Math.max(nh, pos[i * 3 + 1]);
    for (let a = 0; a < 3; a++) rNew[a] = Math.max(rNew[a], Math.hypot(pos[i * 3], pos[i * 3 + 2] * ROCK_STRETCH[a]));
  }
  let kr = 1;
  for (let a = 0; a < 3; a++) kr = Math.min(kr, rOld[a] / Math.max(rNew[a], 1e-6));
  for (let i = 0; i < N; i++) {
    pos[i * 3 + 1] = yLo + (pos[i * 3 + 1] - nl) * (yHi - yLo) / Math.max(nh - nl, 1e-6);
    pos[i * 3] *= kr; pos[i * 3 + 2] *= kr;
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  // tone (as before) × occlusion: creases from the neighbour ring, the underside, the foot
  const nr = g.attributes.normal.array, idx = g.index.array;
  const sum = new Float32Array(N * 3), cnt = new Float32Array(N), edge = new Float32Array(N);
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + (e + 1) % 3];
      for (const [u, w] of [[a, b], [b, a]]) {
        sum[u * 3] += pos[w * 3]; sum[u * 3 + 1] += pos[w * 3 + 1]; sum[u * 3 + 2] += pos[w * 3 + 2]; cnt[u]++;
        edge[u] += Math.hypot(pos[w * 3] - pos[u * 3], pos[w * 3 + 1] - pos[u * 3 + 1], pos[w * 3 + 2] - pos[u * 3 + 2]);
      }
    }
  }
  const cols = new Float32Array(N * 3), col = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const v = nz.noise3(pos[i * 3] * 2.2, pos[i * 3 + 1] * 2.2, pos[i * 3 + 2] * 2.2) * 0.5 + 0.5;
    col.copy(TONE_A).lerp(TONE_B, smoothstep(0.55, 0.8, v)).lerp(TONE_C, smoothstep(0.45, 0.2, v) * 0.6);
    const c = Math.max(cnt[i], 1), el = Math.max(edge[i] / c, 1e-6);
    const curv = ((sum[i * 3] / c - pos[i * 3]) * nr[i * 3] + (sum[i * 3 + 1] / c - pos[i * 3 + 1]) * nr[i * 3 + 1] + (sum[i * 3 + 2] / c - pos[i * 3 + 2]) * nr[i * 3 + 2]) / (el * el);
    let ao = 1 - clamp((curv + 0.5) * 0.1, -0.12, 0.35);
    ao *= lerp(0.8, 1, smoothstep(-0.8, 0.3, nr[i * 3 + 1]));
    ao *= lerp(0.78, 1, smoothstep(yLo, yLo + (yHi - yLo) * 0.4, pos[i * 3 + 1]));
    cols[i * 3] = col.r * ao; cols[i * 3 + 1] = col.g * ao; cols[i * 3 + 2] = col.b * ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  // height within the rock, 0 at its (buried) foot: the shader dampens the base with it
  const hf = new Float32Array(N);
  for (let i = 0; i < N; i++) hf[i] = clamp((pos[i * 3 + 1] - yLo) / Math.max(yHi - yLo, 1e-6), 0, 1);
  g.setAttribute('aRockH', new THREE.BufferAttribute(hf, 1));
  return g;
}
