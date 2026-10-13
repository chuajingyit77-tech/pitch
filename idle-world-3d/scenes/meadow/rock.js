// 芒原 · ancient field boulders: welded, smooth-shaded rock geometry with a few weathered joint faces, baked
// cavity / ground-contact occlusion, and a world-space triplanar surface: weathered strata, grain, cracks, crustose
// lichen, moss cushions on the upper surfaces, a damp earth-stained foot, and grass tufts nestled at the feet.
//
// One packed RGBA data texture carries the whole surface: RG = height slope (detail normal), B = albedo
// (gamma-encoded), A = lichen cover. It is linear (NoColorSpace) on purpose: in WebGL 1 three.js turns
// mipmapping off for sRGB textures, and an unfiltered detail texture would sparkle on the iPad.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, smoothstep, makeRng, patchMaterial } from '../../lib/util.js';
import { addFog } from './sky.js';

/* ------------------------------------------------------------------ */
/* Tileable gradient noise (fast, periodic in both axes)               */
/* ------------------------------------------------------------------ */
function periodicNoise(seed) {
  const rng = makeRng(seed);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rng.next() * TAU; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  /** Gradient noise in about [-1, 1], periodic with `p` cells (p ≤ 256) in x and y. */
  return (x, y, p) => {
    const xf = Math.floor(x), yf = Math.floor(y);
    const fx = x - xf, fy = y - yf;
    const x0 = ((xf % p) + p) % p, y0 = ((yf % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const h00 = perm[(perm[x0] + y0) & 255], h10 = perm[(perm[x1] + y0) & 255];
    const h01 = perm[(perm[x0] + y1) & 255], h11 = perm[(perm[x1] + y1) & 255];
    const n00 = gx[h00] * fx + gy[h00] * fy, n10 = gx[h10] * (fx - 1) + gy[h10] * fy;
    const n01 = gx[h01] * fx + gy[h01] * (fy - 1), n11 = gx[h11] * (fx - 1) + gy[h11] * (fy - 1);
    const u = fade(fx), v = fade(fy);
    return 1.4 * lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
  };
}

/* ------------------------------------------------------------------ */
/* Surface texture                                                     */
/* ------------------------------------------------------------------ */
/** fbm of periodic noise; odd octaves run on a 45°-turned lattice ((u+v, u−v) keeps the tile period), so the
 *  lattice never shows as a grid. u, v in tile units, p = cells per tile of the first octave. */
function pfbm(n, u, v, p, oct) {
  let s = 0, a = 0.5, f = p;
  for (let o = 0; o < oct; o++) {
    s += a * (o & 1 ? n((u + v) * f + 0.31, (u - v) * f + 0.67, f) : n(u * f, v * f, f));
    f *= 2; a *= 0.5;
  }
  return s;
}
/** A smooth tileable field evaluated on an R×R grid and read back bilinearly (for slow masks and warps). */
function lowres(R, fn) {
  const g = new Float32Array(R * R);
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) g[j * R + i] = fn(i / R, j / R);
  return (u, v) => {
    const x = u * R - 0.5, y = v * R - 0.5, xf = Math.floor(x), yf = Math.floor(y), fx = x - xf, fy = y - yf;
    const x0 = ((xf % R) + R) % R, y0 = ((yf % R) + R) % R, x1 = (x0 + 1) % R, y1 = (y0 + 1) % R;
    return lerp(lerp(g[y0 * R + x0], g[y0 * R + x1], fx), lerp(g[y1 * R + x0], g[y1 * R + x1], fx), fy);
  };
}
/** Add an anti-aliased soft disc (wrapped) into `arr`: arr += amount * coverage. */
function splat(arr, S, cx, cy, r, amount, edge = 1) {
  const x0 = Math.floor(cx - r - edge), x1 = Math.ceil(cx + r + edge), y0 = Math.floor(cy - r - edge), y1 = Math.ceil(cy + r + edge);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const c = clamp((r - Math.hypot(x + 0.5 - cx, y + 0.5 - cy)) / edge + 0.5, 0, 1);
    if (c > 0) arr[(((y % S) + S) % S) * S + (((x % S) + S) % S)] += amount * c;
  }
}

/**
 * Weathered, layered andesite, tileable, S×S texels for one tile (the material maps one tile to 1/uRkScale m).
 * R,G: slope of the height field (0.5 = flat), B: albedo, gamma-encoded (decoded as B² in the shader),
 * A: crustose lichen cover.
 */
export function rockSurfaceTexture(seed, S = 512) {
  const rng = makeRng(seed);
  const nA = periodicNoise(seed), nB = periodicNoise(seed + 1), nC = periodicNoise(seed + 2), nD = periodicNoise(seed + 3);
  const warpX = lowres(128, (u, v) => pfbm(nB, u, v, 3, 2) * 0.03);
  const warpY = lowres(128, (u, v) => pfbm(nC, u, v, 3, 2) * 0.03);
  const crackMask = lowres(64, (u, v) => smoothstep(0.04, 0.4, pfbm(nC, u + 0.37, v + 0.11, 2, 2)));
  const lichenBed = lowres(64, (u, v) => pfbm(nB, u + 0.71, v + 0.53, 2, 3));
  const H = new Float32Array(S * S), L = new Float32Array(S * S), Li = new Float32Array(S * S);
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const u = i / S, v = j / S, k = j * S + i;
      // broad mottling (domain-warped; the stone's form itself comes from the geometry, so only a little of it
      // goes into the relief) and a finer, rougher weathering texture
      const big = pfbm(nA, u + warpX(u, v), v + warpY(u, v), 4, 5);
      const fine = pfbm(nB, u, v, 24, 3);
      // weathered strata along v (world-horizontal on the stone's sides): beds ~13 cm thick, wavy, each with its own
      // tone, a thin eroded groove between them
      const sv = (v + warpY(u, v) * 1.5 + big * 0.012) * 9, bed = Math.floor(sv), fb = sv - bed;
      const bedTone = (Math.sin(((bed % 9) + 9) % 9 * 12.9898) * 43758.5453 % 1 + 1) % 1;
      const groove = (1 - smoothstep(0.0, 0.07, Math.min(fb, 1 - fb))) * smoothstep(-0.2, 0.3, nC(u * 6, ((bed % 9) + 9) % 9 * 0.71, 6));
      H[k] = big * 0.1 + fine * 0.09 - groove * 0.05 + Math.sin(fb * Math.PI) * 0.02;
      L[k] = 0.6 + big * 0.18 + fine * 0.06 + (bedTone - 0.5) * 0.09 - groove * 0.18;
    }
  }
  // fractures: a few jittered, tapering hairline cracks with the odd branch, slightly sunken with a dark core
  const crack = new Float32Array(S * S);
  const drawCrack = (x, y, a, len, w, depth) => {
    for (let s2 = 0; s2 < len; s2 += 0.8) {
      const t = s2 / len, ww = w * (1 - t * 0.8) * (0.8 + 0.2 * Math.sin(s2 * 0.7));
      splat(crack, S, x, y, ww, 0.35 * (1 - t * 0.5), 0.9);
      a += rng.range(-0.11, 0.11) + (rng.next() < 0.03 ? rng.range(-0.6, 0.6) : 0);
      x += Math.cos(a) * 0.8; y += Math.sin(a) * 0.8;
      if (depth < 2 && rng.next() < 0.006) drawCrack(x, y, a + rng.sign() * rng.range(0.5, 1.1), len * (1 - t) * rng.range(0.3, 0.6), ww * 0.8, depth + 1);
    }
  };
  for (let c = 0; c < Math.round(S * S / 11000); c++) {
    const cx = rng.next() * S, cy = rng.next() * S;
    if (crackMask(cx / S, cy / S) < 0.08) continue;
    drawCrack(cx, cy, rng.range(0, TAU), rng.range(0.12, 0.35) * S, rng.range(0.7, 1.1), 0);
  }
  for (let k = 0; k < S * S; k++) { const c = Math.min(crack[k], 1); H[k] -= c * 0.22; L[k] -= c * 0.38; }
  // mineral grain: dark mica / hornblende and pale feldspar, 1–3 texels, anti-aliased
  const G = Math.round(S / 3.2);
  const grainD = new Float32Array(S * S), grainP = new Float32Array(S * S);
  for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
    if (rng.next() > 0.55) continue;
    const cx = (gx + rng.next()) * S / G, cy = (gy + rng.next()) * S / G, r = rng.range(0.45, 1.25);
    if (rng.next() < 0.42) splat(grainD, S, cx, cy, r, rng.range(0.6, 1)); else splat(grainP, S, cx, cy, r, rng.range(0.5, 1));
  }
  // weathering pits
  const pits = new Float32Array(S * S);
  for (let i = 0; i < Math.round(S * S / 900); i++) splat(pits, S, rng.next() * S, rng.next() * S, rng.range(0.7, 2.4), rng.range(0.5, 1), 1.2);
  // crustose lichen rosettes (2–7 cm), clustered on a slow field, with lobed margins and a darker rim
  const lich = new Float32Array(S * S), rim = new Float32Array(S * S);
  const nRos = Math.round(S * S / 5200);
  for (let c = 0, guard = 0; c < nRos && guard < nRos * 30; guard++) {
    const cx = rng.next() * S, cy = rng.next() * S;
    if (lichenBed(cx / S, cy / S) < rng.range(-0.05, 0.25)) continue;
    c++;
    // an irregular round patch: three random harmonics on the margin, mottled inside, older ones paler centred
    const R = rng.range(5, 24) * S / 512;
    const h1 = [rng.range(0.04, 0.11), rng.int(2, 4), rng.range(0, TAU)], h2 = [rng.range(0.03, 0.07), rng.int(5, 8), rng.range(0, TAU)], h3 = [rng.range(0.015, 0.035), rng.int(11, 17), rng.range(0, TAU)];
    const old = rng.next() < 0.35 ? rng.range(0.3, 0.6) : 0, mot = rng.range(0, 50);
    const x0 = Math.floor(cx - R * 1.3 - 2), x1 = Math.ceil(cx + R * 1.3 + 2), y0 = Math.floor(cy - R * 1.3 - 2), y1 = Math.ceil(cy + R * 1.3 + 2);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
      const rr = R * (1 + h1[0] * Math.sin(a * h1[1] + h1[2]) + h2[0] * Math.sin(a * h2[1] + h2[2]) + h3[0] * Math.sin(a * h3[1] + h3[2]));
      let cov = clamp((rr - d) / 1.3 + 0.5, 0, 1);
      if (cov <= 0) continue;
      const q = d / rr;
      cov *= 1 - old * (1 - smoothstep(0.25, 0.7, q));
      cov *= 0.82 + 0.18 * nC((x + mot) * 0.25, (y + mot) * 0.25, 128);
      const k = (((y % S) + S) % S) * S + (((x % S) + S) % S);
      lich[k] = Math.max(lich[k], cov);
      rim[k] = Math.max(rim[k], clamp((rr - d) / 1.3 + 0.5, 0, 1) * smoothstep(0.78, 0.97, q));
    }
  }
  for (let k = 0; k < S * S; k++) {
    const gd = Math.min(grainD[k], 1), gp = Math.min(grainP[k], 1), pt = Math.min(pits[k], 1);
    H[k] += -gd * 0.012 + gp * 0.01 - pt * 0.05 + lich[k] * 0.025;
    L[k] = clamp(L[k] - gd * 0.26 + gp * 0.15 - pt * 0.16 - rim[k] * 0.16, 0.06, 1);
    Li[k] = lich[k];
  }
  // slopes from the float height field (no 8-bit terracing), wrapped
  const data = new Uint8Array(S * S * 4);
  const K = S / 8; // slope scale: height units per tile -> encoded range
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const k = j * S + i;
      const dx = (H[j * S + ((i + 1) % S)] - H[j * S + ((i - 1 + S) % S)]) * 0.5 * K;
      const dy = (H[((j + 1) % S) * S + i] - H[((j - 1 + S) % S) * S + i]) * 0.5 * K;
      data[k * 4] = Math.round((clamp(dx, -1, 1) * 0.5 + 0.5) * 255);
      data[k * 4 + 1] = Math.round((clamp(dy, -1, 1) * 0.5 + 0.5) * 255);
      data[k * 4 + 2] = Math.round(L[k] * 255);
      data[k * 4 + 3] = Math.round(clamp(Li[k], 0, 1) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Material                                                            */
/* ------------------------------------------------------------------ */
/**
 * Standard material with the triplanar rock surface (3 texture reads), lichen on exposed faces, moss cushions on the
 * upper surfaces (one more read of the lichen pattern at a larger scale), a damp foot (aRockH: height above the
 * ground), and the baked occlusion from the vertex colours.
 */
export function makeRockMaterial(tex, fogU) {
  const m = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.9, metalness: 0, envMapIntensity: 0.4 });
  const U = {
    tRock: { value: tex },
    uRkScale: { value: 0.85 },                       // tiles per metre
    uRkBump: { value: 0.55 },
    uRkTint: { value: new THREE.Color('#7c7266') },  // base albedo of the stone (× texture): warm dark grey
    uRkLichen: { value: new THREE.Color('#a9a796') },
    uRkLichen2: { value: new THREE.Color('#b3a670') },
    uRkMoss: { value: new THREE.Color('#56602a') },  // autumn moss, olive with golden tips
    uRkDamp: { value: new THREE.Color('#3b3a2c') },  // the damp, earth-stained foot
  };
  patchMaterial(m, {
    key: 'meadowRock',
    uniforms: U,
    vertexHeader: 'attribute float aRockH;\nvarying vec3 vRkW; varying float vRkH;',
    fragmentHeader: /* glsl */`
      varying vec3 vRkW; varying float vRkH;
      uniform sampler2D tRock;
      uniform float uRkScale, uRkBump;
      uniform vec3 uRkTint, uRkLichen, uRkLichen2, uRkMoss, uRkDamp;`,
    vertex: { '#include <fog_vertex>': '$&\n vRkW = (mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix); vRkH = aRockH;' },
    fragment: {
      '#include <map_fragment>': /* glsl */`
        // world-space triplanar rock surface (weights sharpened so the three projections barely overlap)
        vec3 rkN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
        vec3 rkB = rkN * rkN; rkB *= rkB; rkB /= (rkB.x + rkB.y + rkB.z);
        vec3 rkP = vRkW * uRkScale;
        vec4 rkX = texture2D(tRock, rkP.zy);
        vec4 rkY = texture2D(tRock, rkP.xz + vec2(0.37, 0.61));
        vec4 rkZ = texture2D(tRock, rkP.xy + vec2(0.73, 0.0)); // same v as the x projection: the strata meet at corners
        float rkL = rkX.b * rkB.x + rkY.b * rkB.y + rkZ.b * rkB.z;
        float rkLi = rkX.a * rkB.x + rkY.a * rkB.y + rkZ.a * rkB.z;
        vec3 rkCol = uRkTint * (rkL * rkL) * 1.9;
        // lichen grows on the exposed upper and side faces, not under the overhangs
        float rkExp = smoothstep(-0.35, 0.5, rkN.y);
        vec3 lichC = mix(uRkLichen, uRkLichen2, smoothstep(0.45, 0.8, rkY.b)) * (0.7 + 0.45 * rkL);
        rkCol = mix(rkCol, lichC, rkLi * rkExp * 0.7);
        // moss cushions on the upper surfaces: the lichen pattern read 3.7x larger gives the cushions, the stone's
        // own mottling breaks up their margin
        float rkMc = texture2D(tRock, rkP.xz * 0.27 + vec2(0.11, 0.83)).a;
        float rkMo = smoothstep(0.5, 0.78, rkN.y + (rkMc - 0.35) * 0.9 + (rkL - 0.6) * 0.5) * smoothstep(0.15, 0.4, vRkH);
        rkCol = mix(rkCol, uRkMoss * (0.6 + 0.7 * rkL) * mix(vec3(1.0), vec3(1.18, 1.08, 0.7), rkLi), rkMo * 0.92);
        // the damp foot: darker, earth-stained, lichen-free
        float rkDp = 1.0 - smoothstep(0.0, 0.32, vRkH);
        rkCol = mix(rkCol, uRkDamp * (0.55 + 0.7 * rkL), rkDp * 0.75);
        diffuseColor.rgb *= rkCol;`,
      '#include <roughnessmap_fragment>': '$&\n roughnessFactor = mix(clamp(roughnessFactor + (0.55 - rkL) * 0.12 + rkLi * 0.05 + rkMo * 0.08, 0.6, 1.0), 0.55, rkDp * (1.0 - rkMo));',
      '#include <normal_fragment_maps>': /* glsl */`
        {
          vec2 gX = rkX.rg * 2.0 - 1.0, gY = rkY.rg * 2.0 - 1.0, gZ = rkZ.rg * 2.0 - 1.0;
          vec3 G = vec3(gY.x * rkB.y + gZ.x * rkB.z, gX.y * rkB.x + gZ.y * rkB.z, gX.x * rkB.x + gY.y * rkB.y);
          G -= rkN * dot(G, rkN);
          normal = normalize((viewMatrix * vec4(normalize(rkN - G * uRkBump * (1.0 - 0.5 * rkMo)), 0.0)).xyz);
        }`,
    },
  });
  m.userData.rockU = U;
  return addFog(m, fogU, 'mfogRock');
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */
const _p = new THREE.Vector3(), _n = new THREE.Vector3();

/** Bounding box [min, max] per axis and widest horizontal reach of the original low-poly rock (icosphere detail 3
 * with the same shape); the reach is measured with the stone's x stretch `ax` (its x scale / z scale). */
function referenceBox(macro, yClamp, ax = 1) {
  const g = new THREE.IcosahedronGeometry(1, 3), p = g.attributes.position;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  let reach = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), d = macro(x, y, z);
    const v = [x * d, Math.max(y * d, yClamp), z * d];
    for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], v[a]); hi[a] = Math.max(hi[a], v[a]); }
    reach = Math.max(reach, Math.hypot(v[0] * ax, v[2]));
  }
  g.dispose();
  return { lo, hi, reach, ax };
}

/**
 * One boulder in local space (unit size), welded and smooth. `macro(x, y, z)` returns the radial scale of the
 * original rock shape; joint faces and fine relief are added on top. The height is fitted back to the original
 * rock's (`box`), and the stone never reaches wider than the original did (the finer mesh can catch a bulge between
 * the old vertices), so its footprint stays put.
 */
function boulderGeometry(detail, macro, yClamp, seed, box) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position, N = p.count;
  const base = new Float32Array(N * 3), pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = macro(x, y, z);
    base[i * 3] = x * d; base[i * 3 + 1] = Math.max(y * d, yClamp); base[i * 3 + 2] = z * d;
  }
  pos.set(base);
  // weathered joint faces: a few planes shave the bulges partway flat (their edges stay rounded)
  const r = makeRng(seed);
  const planes = [];
  const dir = (el, az) => new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
  planes.push({ n: dir(Math.PI / 2 - r.range(0.05, 0.42), r.range(0, TAU)), depth: r.range(0.07, 0.13) });
  const K = 5, az0 = r.range(0, TAU);
  for (let k = 0; k < K; k++) planes.push({ n: dir(r.range(-0.05, 0.6), az0 + (k + r.range(-0.3, 0.3)) / K * TAU), depth: r.range(0.04, 0.09) });
  for (const pl of planes) {
    let hi = -Infinity, lo = Infinity;
    for (let i = 0; i < N; i++) { const s = pos[i * 3] * pl.n.x + pos[i * 3 + 1] * pl.n.y + pos[i * 3 + 2] * pl.n.z; hi = Math.max(hi, s); lo = Math.min(lo, s); }
    const o = hi - pl.depth * (hi - lo);
    for (let i = 0; i < N; i++) {
      const s = pos[i * 3] * pl.n.x + pos[i * 3 + 1] * pl.n.y + pos[i * 3 + 2] * pl.n.z - o;
      if (s <= 0) continue;
      const k = s * 0.8;
      pos[i * 3] -= pl.n.x * k; pos[i * 3 + 1] -= pl.n.y * k; pos[i * 3 + 2] -= pl.n.z * k;
    }
  }
  // fine relief (a few centimetres on a metre-sized stone)
  const rx = r.range(0, 50), rz = r.range(0, 50);
  for (let i = 0; i < N; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.sin(x * 7.1 + rx) * Math.sin(y * 6.3 + 1.7) * Math.sin(z * 6.7 + rz);
    const b = Math.sin(x * 13.3 + 2.1) * Math.sin(y * 12.1 + rx) * Math.sin(z * 14.2 + 0.4);
    const k = 1 + a * 0.02 + b * 0.008 - 0.012; // biased inward
    pos[i * 3] *= k; pos[i * 3 + 2] *= k;
    if (pos[i * 3 + 1] > yClamp + 1e-4) pos[i * 3 + 1] = Math.max(yClamp, pos[i * 3 + 1] * k);
  }
  // the same height as the original rock (the top joint face would lower it), and no wider than its widest reach
  {
    let nl = Infinity, nh = -Infinity, reach = 0;
    for (let i = 0; i < N; i++) { nl = Math.min(nl, pos[i * 3 + 1]); nh = Math.max(nh, pos[i * 3 + 1]); reach = Math.max(reach, Math.hypot(pos[i * 3] * box.ax, pos[i * 3 + 2])); }
    const k = (box.hi[1] - box.lo[1]) / Math.max(nh - nl, 1e-6), kr = Math.min(1, box.reach / Math.max(reach, 1e-6));
    for (let i = 0; i < N; i++) { pos[i * 3 + 1] = box.lo[1] + (pos[i * 3 + 1] - nl) * k; pos[i * 3] *= kr; pos[i * 3 + 2] *= kr; }
  }
  p.array.set(pos);
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Curvature per vertex from the neighbour ring: + in creases, − on crests (a unit sphere gives −0.5). */
function cavity(g) {
  const p = g.attributes.position.array, n = g.attributes.normal.array, idx = g.index.array, N = g.attributes.position.count;
  const sum = new Float32Array(N * 3), cnt = new Float32Array(N), edge = new Float32Array(N);
  for (let t = 0; t < idx.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + (e + 1) % 3];
      for (const [u, w] of [[a, b], [b, a]]) {
        sum[u * 3] += p[w * 3]; sum[u * 3 + 1] += p[w * 3 + 1]; sum[u * 3 + 2] += p[w * 3 + 2]; cnt[u]++;
        edge[u] += Math.hypot(p[w * 3] - p[u * 3], p[w * 3 + 1] - p[u * 3 + 1], p[w * 3 + 2] - p[u * 3 + 2]);
      }
    }
  }
  const out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const c = Math.max(cnt[i], 1);
    const dx = sum[i * 3] / c - p[i * 3], dy = sum[i * 3 + 1] / c - p[i * 3 + 1], dz = sum[i * 3 + 2] / c - p[i * 3 + 2];
    const e = Math.max(edge[i] / c, 1e-6);
    out[i] = (dx * n[i * 3] + dy * n[i * 3 + 1] + dz * n[i * 3 + 2]) / (e * e);
  }
  return out;
}

/**
 * The meadow's rocks, merged into one mesh. Same layout, sizes and random sequence as before (footprints are
 * fox obstacles); only the shape quality, shading and surface changed.
 */
export function buildRocks({ rng, noise, list, heightAt, material }) {
  const geos = [], feet = [];
  for (const r of list) {
    const ph = rng.range(0, 100);
    const sx = r.s * rng.range(0.9, 1.25), sy = r.s * rng.range(0.6, 0.95), sz = r.s * rng.range(0.8, 1.1); // as before
    const detail = r.s >= 0.6 ? 7 : r.s >= 0.3 ? 6 : 4;
    const macro = (x, y, z) => 1 + noise.fbm3(x * 1.3 + ph, y * 1.3, z * 1.3, 4) * 0.35 + Math.abs(noise.noise3(x * 3 + ph, y * 3, z * 3)) * 0.08;
    const geo = boulderGeometry(detail, macro, -0.35, Math.floor(ph * 1000) + 17, referenceBox(macro, -0.35, sx / sz));
    // occlusion in the creases, before the stone is scaled
    const cav = cavity(geo);
    geo.scale(sx, sy, sz);
    geo.rotateY(rng.range(0, TAU));
    const gy = heightAt(r.x, r.z);
    geo.translate(r.x, gy + r.s * 0.12, r.z);
    const pa = geo.attributes.position, nrm = geo.attributes.normal;
    const col = new Float32Array(pa.count * 3), hgt = new Float32Array(pa.count);
    const foot = r.s > 0.25 ? { x: r.x, z: r.z, s: r.s, ground: gy, rad: new Float32Array(16) } : null;
    for (let i = 0; i < pa.count; i++) {
      _p.fromBufferAttribute(pa, i);
      _n.fromBufferAttribute(nrm, i);
      // creases darker, crests a touch lighter (worn edges)
      let ao = 1 - clamp((cav[i] + 0.5) * 0.12, -0.12, 0.42);
      // contact with the ground: the soil and grass shade the foot of the stone
      const above = _p.y - heightAt(_p.x, _p.z);
      ao *= lerp(0.42, 1, smoothstep(-0.02, 0.18 + r.s * 0.25, above));
      // faces turned to the ground see less sky
      ao *= lerp(0.72, 1, smoothstep(-0.8, 0.3, _n.y));
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
      // height above the ground, scaled to the stone (the shader darkens and dampens the foot with it)
      hgt[i] = clamp(above / (0.25 + r.s * 0.55), 0, 1);
      // the outline where the stone meets the ground, per direction (grass tufts gather there)
      if (foot && above > -0.03 && above < 0.12) {
        const dx = _p.x - r.x, dz = _p.z - r.z, sec = Math.floor(((Math.atan2(dz, dx) / TAU) + 1) % 1 * 16) % 16;
        foot.rad[sec] = Math.max(foot.rad[sec], Math.hypot(dx, dz));
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aRockH', new THREE.BufferAttribute(hgt, 1));
    geos.push(geo);
    if (foot) feet.push(foot);
  }
  const merged = mergeGeometries(geos);
  geos.forEach(g => g.dispose());
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.feet = feet;
  return mesh;
}

/**
 * Grass tufts nestled at the stones' feet (instances for the field's own clump material): short, spreading tussocks
 * along the outline where each larger stone meets the ground, so the stones sit in the meadow instead of on a
 * bare ring of soil.
 */
export function rockFootTufts(feet, rng, heightAt) {
  const list = [];
  for (const f of feet) {
    const n = Math.round(6 + f.s * 10);
    for (let k = 0; k < n; k++) {
      const a0 = (k + rng.range(-0.35, 0.35)) / n * TAU, sec = Math.floor(((a0 / TAU) + 1) % 1 * 16) % 16;
      const rr = (f.rad[sec] || f.s * 0.9) + rng.range(0.0, 0.14);
      const x = f.x + Math.cos(a0) * rr, z = f.z + Math.sin(a0) * rr;
      const H = rng.range(0.22, 0.48) * (0.8 + f.s * 0.4);
      list.push({ x, y: heightAt(x, z) - 0.03, z, rot: rng.range(0, TAU), sx: H * rng.range(0.9, 1.3), sy: H, inst: [rng.range(-0.6, 0.5), rng.next(), rng.next(), rng.next()] });
    }
  }
  return list;
}
