// 深蓝 · 珊瑚礁 — surface detail for every quality tier: small tileable textures painted once at load
// (periodic noise and cells into typed arrays, so they tile seamlessly and need no canvas) and a cheap
// triplanar shader patch that maps them in world space. This replaces per-pixel procedural noise, which
// was too heavy for the low tier (old iPads), so reef rock and corals there looked like smooth clay.
//
// Detail texture layout (RGBA8, power of two, mipmapped, repeat):
//   R, G  tangent-space normal x, y (z is implied)       B  albedo factor (x2, 0.5 = unchanged)
//   A     a material field (0..1), meaning per texture (rock: coralline <-> turf potential)
import * as THREE from 'three';
import { patchMaterial } from '../../lib/util.js';
import { UW_FRAG } from './uw.js';

/* ------------------------------------------------------------------ */
/* Periodic noise (all lattices wrap, so every texture tiles)          */
/* ------------------------------------------------------------------ */
function hashU32(x, y, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const hash01 = (x, y, s) => hashU32(x, y, s) / 4294967296;

/** Periodic 2D gradient noise, period P lattice cells over the unit square, about -0.7..0.7. */
function makePerlin(P, seed) {
  const gx = new Float32Array(P * P), gy = new Float32Array(P * P);
  for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) {
    const a = hash01(i, j, seed) * Math.PI * 2;
    gx[j * P + i] = Math.cos(a); gy[j * P + i] = Math.sin(a);
  }
  return (u, v) => {
    const x = u * P, y = v * P;
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const i0 = ((xi % P) + P) % P, j0 = ((yi % P) + P) % P, i1 = (i0 + 1) % P, j1 = (j0 + 1) % P;
    const d = (i, j, ox, oy) => gx[j * P + i] * ox + gy[j * P + i] * oy;
    const n00 = d(i0, j0, fx, fy), n10 = d(i1, j0, fx - 1, fy), n01 = d(i0, j1, fx, fy - 1), n11 = d(i1, j1, fx - 1, fy - 1);
    const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10), sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = n00 + (n10 - n00) * sx, b = n01 + (n11 - n01) * sx;
    return a + (b - a) * sy;
  };
}
/** Periodic fbm: octaves at periods P, 2P, 4P... Returns roughly -1..1 (normalised by the amplitude sum). */
function makeFbm(P, octaves, seed, gain = 0.5) {
  const oct = [];
  let amp = 1, sum = 0;
  for (let o = 0; o < octaves; o++) { oct.push({ n: makePerlin(P << o, seed + o * 101), a: amp }); sum += amp; amp *= gain; }
  const k = 1.45 / sum;
  return (u, v) => { let s = 0; for (const o of oct) s += o.n(u, v) * o.a; return s * k; };
}
/**
 * Periodic cells: G x G grid, one jittered point per cell. Returns a function filling `out` with
 * [F1, F2, id (0..1 hash of the nearest cell)] in cell units. The points are stored with a one-cell
 * wrapped border, so a lookup needs no modulo.
 */
function makeCells(G, seed, jitter = 0.85) {
  const W2 = G + 2, px = new Float32Array(W2 * W2), py = new Float32Array(W2 * W2), id = new Float32Array(W2 * W2);
  for (let j = -1; j <= G; j++) for (let i = -1; i <= G; i++) {
    const wi = (i + G) % G, wj = (j + G) % G, k = (j + 1) * W2 + (i + 1);
    px[k] = i + 0.5 + (hash01(wi, wj, seed) - 0.5) * jitter;
    py[k] = j + 0.5 + (hash01(wi, wj, seed + 7) - 0.5) * jitter;
    id[k] = hash01(wi, wj, seed + 13);
  }
  return (u, v, out) => {
    u -= Math.floor(u); v -= Math.floor(v);
    const x = u * G, y = v * G, xi = Math.min(G - 1, x | 0), yi = Math.min(G - 1, y | 0);
    let d1 = 1e9, d2 = 1e9, best = 0;
    for (let oj = 0; oj < 3; oj++) {
      const row = (yi + oj) * W2 + xi;
      for (let oi = 0; oi < 3; oi++) {
        const k = row + oi, dx = px[k] - x, dy = py[k] - y, d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; best = k; } else if (d < d2) d2 = d;
      }
    }
    out[0] = Math.sqrt(d1); out[1] = Math.sqrt(d2); out[2] = id[best];
    return out;
  };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Separable wrap-around box blur of a Float32Array field (radius in texels), `passes` times (~gaussian). */
function blurWrap(src, S, r, passes = 2) {
  let a = Float32Array.from(src), b = new Float32Array(S * S);
  const n = 2 * r + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < S; y++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += a[y * S + ((k % S) + S) % S];
      for (let x = 0; x < S; x++) {
        b[y * S + x] = acc / n;
        acc += a[y * S + (x + r + 1) % S] - a[y * S + ((x - r) % S + S) % S];
      }
    }
    for (let x = 0; x < S; x++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += b[(((k % S) + S) % S) * S + x];
      for (let y = 0; y < S; y++) {
        a[y * S + x] = acc / n;
        acc += b[((y + r + 1) % S) * S + x] - b[(((y - r) % S + S) % S) * S + x];
      }
    }
  }
  return a;
}

/** Pack height (metres per texel grid of `texel` m), albedo factor and field into RGBA8. */
function packDetail(S, h, alb, field, texel, strength = 1) {
  const out = new Uint8Array(S * S * 4);
  const k = strength / (2 * texel);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const dx = (h[y * S + (x + 1) % S] - h[y * S + (x - 1 + S) % S]) * k;
    const dy = (h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x]) * k;
    const l = Math.sqrt(dx * dx + dy * dy + 1);
    out[i * 4] = Math.round(clamp01(-dx / l * 0.5 + 0.5) * 255);
    out[i * 4 + 1] = Math.round(clamp01(-dy / l * 0.5 + 0.5) * 255);
    out[i * 4 + 2] = Math.round(clamp01(alb[i] * 0.5) * 255);
    out[i * 4 + 3] = Math.round(clamp01(field[i]) * 255);
  }
  return out;
}

/** Sample a smooth periodic field into an L x L grid (to be read back with bilinear `lerpGrid`). */
function grid(L, f) {
  const g = new Float32Array(L * L);
  for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) g[y * L + x] = f(x / L, y / L);
  return g;
}
/** Bilinear, wrapping read of a grid made by `grid` at (u, v) in [0, 1). */
function lerpGrid(g, L, u, v) {
  const x = u * L, y = v * L, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const x0 = xi % L, y0 = yi % L, x1 = (x0 + 1) % L, y1 = (y0 + 1) % L;
  const a = g[y0 * L + x0] + (g[y0 * L + x1] - g[y0 * L + x0]) * fx;
  const b = g[y1 * L + x0] + (g[y1 * L + x1] - g[y1 * L + x0]) * fx;
  return a + (b - a) * fy;
}

/* ------------------------------------------------------------------ */
/* Texture painters (pure: typed arrays in, typed arrays out)          */
/* ------------------------------------------------------------------ */
/**
 * Reef rock: knobbly, bioeroded limestone (cemented rubble knobs, irregular cavities, pits and pores in
 * porous zones, fine grain, a few crevices), with smooth crusts of coralline algae (raised, with a lip at
 * the growing margin) where the field is high and fuzzy turf where it is low. The field keeps a ragged
 * fine-scale edge so the shader's thresholds draw organic patch outlines at any distance.
 * tile = metres covered by one repeat.
 */
export function paintRock(S, seed, tile) {
  const texel = tile / S, L = 128, N = S * S, L2 = S >> 1;
  // smooth fields at low resolution (bilinear upsampling keeps them exact enough and is far cheaper)
  const gWarpA = grid(L, makeFbm(3, 3, seed + 2)), gWarpB = grid(L, makeFbm(3, 3, seed + 3));
  const potF = makeFbm(3, 4, seed + 4, 0.5);
  const gPot = grid(L, (u, v) => potF(u + lerpGrid(gWarpA, L, u, v) * 0.12, v + lerpGrid(gWarpB, L, u, v) * 0.12));
  const gLump = grid(L, makeFbm(4, 4, seed + 1));
  const poroF = makeFbm(4, 3, seed + 11);
  const gPoro = grid(L, (u, v) => 0.5 + 0.5 * poroF(u, v));
  const gFine = grid(L2, makeFbm(32, 3, seed + 5, 0.6));
  const gFine2 = grid(L2, makeFbm(16, 2, seed + 6));
  // knobs of cemented rubble at two sizes, cavities and pits: smooth enough for half resolution
  const knobA = makeCells(11, seed + 30, 0.8), knobB = makeCells(27, seed + 31, 0.8);
  const cavC = makeCells(9, seed + 40, 0.7), pitC = makeCells(26, seed + 50, 0.7), poreC = makeCells(70, seed + 60, 0.7);
  const c = new Float32Array(3);
  const hole = (t, r) => { const q = t / r; return q >= 1 ? 0 : 1 - q * q * q; };
  const hK = new Float32Array(L2 * L2), hG = new Float32Array(L2 * L2), hCav = new Float32Array(L2 * L2), hPit = new Float32Array(L2 * L2);
  for (let y = 0; y < L2; y++) for (let x = 0; x < L2; x++) {
    const u = x / L2, v = y / L2, i = y * L2 + x;
    const fn = gFine[i], fn2 = gFine2[i];
    const wa = lerpGrid(gWarpA, L, u, v), wb = lerpGrid(gWarpB, L, u, v), poro = lerpGrid(gPoro, L, u, v);
    knobA(u + wa * 0.03 + fn2 * 0.01, v + wb * 0.03 - fn2 * 0.01, c);
    const k1 = Math.sqrt(Math.max(0, 1 - c[0] * c[0] * 1.6));
    knobB(u + wb * 0.02 + fn * 0.006, v - wa * 0.02, c);
    const k2 = Math.sqrt(Math.max(0, 1 - c[0] * c[0] * 1.8));
    hK[i] = k1 * 0.009 + k2 * 0.0035;
    hG[i] = 1 - Math.max(k1, k2 * 0.8);
    cavC(u + fn2 * 0.02 + wa * 0.02, v + fn * 0.02, c);
    hCav[i] = c[2] < 0.12 + 0.35 * poro ? hole(c[0], 0.17 + 0.17 * (c[2] * 7.3 % 1)) * (0.012 + 0.012 * (c[2] * 3.7 % 1)) : 0;
    pitC(u + fn * 0.012 + fn2 * 0.006, v + fn2 * 0.012, c);
    hPit[i] = c[2] < 0.15 + 0.6 * poro ? hole(c[0], 0.15 + 0.2 * (c[2] * 5.1 % 1)) * 0.006 : 0;
  }
  const h = new Float32Array(N), dark = new Float32Array(N), field = new Float32Array(N), poroA = new Float32Array(N);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const fn = lerpGrid(gFine, L2, u, v);
    // coralline (+) <-> turf (-) potential with a ragged fine edge
    const P0 = lerpGrid(gPot, L, u, v) * 1.25;
    const P = P0 + fn * (0.12 + 0.22 * smooth(0.15, -0.3, P0));
    const crust = smooth(0.0, 0.25, P), turf = smooth(-0.05, -0.35, P);
    const poro = lerpGrid(gPoro, L, u, v);
    poroA[i] = poro;
    let hh = lerpGrid(gLump, L, u, v) * 0.012 + lerpGrid(hK, L2, u, v) * (1 - crust * 0.35) + fn * 0.0008;
    // holes, clustered in porous zones; crusts and turf cover the small ones
    let dep = Math.max(lerpGrid(hCav, L2, u, v) * (1 - crust * 0.35), lerpGrid(hPit, L2, u, v) * (1 - crust * 0.6) * (1 - turf * 0.5));
    poreC(u + fn * 0.004, v - fn * 0.004, c);
    if (c[2] < 0.1 + 0.75 * poro) dep = Math.max(dep, hole(c[0], 0.2 + 0.14 * (c[2] * 9.7 % 1)) * 0.0022 * (1 - crust * 0.9) * (1 - turf * 0.75));
    // coralline crusts rise and smooth over, a slightly thicker growing margin; turf is a fine fuzz
    const lip = crust * (1 - smooth(0.25, 0.6, P));
    hh += -dep + crust * 0.0022 + lip * 0.0012 + turf * (fn * 0.5 + 0.5) * 0.0014;
    h[i] = hh;
    // grooves between knobs and the holes go dark
    const gr = lerpGrid(hG, L2, u, v) * (1 - crust * 0.5) * (1 - turf * 0.3);
    dark[i] = Math.max(smooth(0.0012, 0.012, dep), gr * gr * 0.45);
    field[i] = 0.5 + 0.5 * Math.max(-1, Math.min(1, P));
  }
  const alb = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    let a = 1 - dark[i] * 0.7;
    a *= (0.88 + 0.24 * poroA[i] * 0.5) * (0.93 + 0.14 * hash01(i % S, (i / S) | 0, seed + 99));
    alb[i] = Math.max(0.12, Math.min(1.4, a));
  }
  return packDetail(S, h, alb, field, texel, 1);
}

/**
 * Soft-coral polyp clusters: rounded florets (G1 per tile) covered in small domed polyps with a tiny
 * mouth dimple (G2 per tile); creases between florets go dark. A = a random value per polyp.
 */
export function paintPolyps(S, seed, tile, G1 = 6, G2 = 40) {
  const texel = tile / S, N = S * S;
  const flo = makeCells(G1, seed + 1, 0.9), pol = makeCells(G2, seed + 2, 0.75);
  const gW = grid(64, makeFbm(4, 2, seed + 3)), gW2 = grid(64, makeFbm(4, 2, seed + 4));
  const h = new Float32Array(N), alb = new Float32Array(N), field = new Float32Array(N);
  const c = new Float32Array(3);
  const flH = tile / G1 * 0.3, poH = tile / G2 * 0.32;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x, w = lerpGrid(gW, 64, u, v), w2 = lerpGrid(gW2, 64, u, v);
    // florets: round, tightly packed domes (warped so they are not on a grid); the narrow gaps between
    // them are shaded hollows
    flo(u + w * 0.03, v + w2 * 0.03, c);
    // one radius for every floret: the dome is then continuous across cell borders (no straight seams)
    const q = c[0] / 0.64;
    const fd = Math.sqrt(Math.max(0, 1 - q * q)), hollow = 1 - smooth(0.0, 0.35, fd), fid = (c[2] - 0.5) * smooth(0.0, 0.3, fd);
    pol(u, v, c);
    const pd = Math.sqrt(Math.max(0, 1 - (c[0] / 0.6) ** 2)), mouth = smooth(0.12, 0.0, c[0]);
    h[i] = fd * flH + (pd - mouth * 0.4) * poH * (1 - hollow * 0.5);
    alb[i] = (0.72 + 0.36 * fd) * (0.86 + 0.24 * pd - 0.22 * mouth) * (1 + 0.2 * fid);
    field[i] = c[2];
  }
  return packDetail(S, h, alb, field, texel, 1);
}

/**
 * Corallite cups / sponge pores: a shallow pit with a raised rim per cell on a finely rough surface
 * (G cells per tile). A = a random value per cup.
 */
export function paintCups(S, seed, tile, G = 22, rim = 0.42) {
  const texel = tile / S, N = S * S;
  const cup = makeCells(G, seed + 1, 0.7);
  const gF = grid(S >> 1, makeFbm(G * 2, 2, seed + 2));
  const h = new Float32Array(N), alb = new Float32Array(N), field = new Float32Array(N);
  const c = new Float32Array(3), cell = tile / G;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const f = lerpGrid(gF, S >> 1, u, v);
    cup(u + f * 0.01, v - f * 0.01, c);
    const r = rim * (0.8 + 0.4 * c[2]);
    const ring = Math.exp(-(((c[0] - r) / (r * 0.35)) ** 2)), pit = smooth(r * 0.9, r * 0.25, c[0]);
    h[i] = (ring * 0.1 - pit * 0.22 + f * 0.04) * cell;
    alb[i] = (1 + ring * 0.14 - pit * 0.42) * (0.94 + 0.12 * f);
    field[i] = c[2];
  }
  return packDetail(S, h, alb, field, texel, 1);
}

/**
 * Brain coral: long meandering ridges and valleys of about equal width (contours of a warped field),
 * rounded ridge tops, fine septa ticks across the valleys. A = valley mask (1 in the grooves).
 */
export function paintBrain(S, seed, tile, k = 6) {
  const texel = tile / S, N = S * S, L = 128;
  const wA = grid(L, makeFbm(3, 2, seed + 1)), wB = grid(L, makeFbm(3, 2, seed + 2));
  const base = makeFbm(3, 2, seed + 3, 0.35);
  const gN0 = grid(L, (u, v) => base(u + lerpGrid(wA, L, u, v) * 0.1, v + lerpGrid(wB, L, u, v) * 0.1));
  // even out the meander spacing: integrate the field divided by its (smoothed) slope, so flat
  // stretches get more grooves instead of wide blobs
  const gs = new Float32Array(L * L);
  for (let y = 0; y < L; y++) for (let x = 0; x < L; x++) {
    const dx = gN0[y * L + (x + 1) % L] - gN0[y * L + (x + L - 1) % L], dy = gN0[((y + 1) % L) * L + x] - gN0[((y + L - 1) % L) * L + x];
    gs[y * L + x] = Math.hypot(dx, dy);
  }
  const gsm = blurWrap(gs, L, 6, 2);
  let mean = 0; for (let i = 0; i < L * L; i++) mean += gsm[i]; mean /= L * L;
  const gN = new Float32Array(L * L);
  for (let i = 0; i < L * L; i++) gN[i] = gN0[i] * mean / Math.max(gsm[i], mean * 0.45);
  const gF = grid(S >> 1, makeFbm(48, 2, seed + 4));
  const h = new Float32Array(N), alb = new Float32Array(N), field = new Float32Array(N);
  const period = tile / (k * 2.5);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = y * S + x;
    const n = lerpGrid(gN, L, u, v), f = lerpGrid(gF, S >> 1, u, v);
    const c = Math.cos(n * k * Math.PI * 2);            // +1 ridge crest, -1 valley floor
    const ridge = smooth(-0.35, 0.75, c), valley = 1 - smooth(-0.6, 0.05, c);
    const sept = valley * (0.5 + 0.5 * Math.sin(f * 46));
    // rounded ridges (sine relief flattened a little on top), septa ticks in the grooves
    h[i] = (Math.sign(c) * Math.pow(Math.abs(c), 0.8) * 0.2 + sept * 0.035 + f * 0.02) * period;
    alb[i] = (0.74 + 0.32 * ridge) * (1 - valley * 0.12 + sept * 0.1) * (0.95 + 0.1 * f);
    field[i] = valley;
  }
  return packDetail(S, h, alb, field, texel, 1);
}

/** Four independent smooth fields (RGBA) for world-scale variation; tiles seamlessly. */
export function paintMacro(S, seed) {
  const f = [makeFbm(2, 4, seed + 11), makeFbm(2, 4, seed + 12), makeFbm(3, 3, seed + 13), makeFbm(4, 3, seed + 14)];
  const out = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S, i = (y * S + x) * 4;
    for (let k = 0; k < 4; k++) out[i + k] = Math.round(clamp01(0.5 + f[k](u, v) * 0.75) * 255);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* GPU side                                                            */
/* ------------------------------------------------------------------ */
/** Textures do not depend on the world seed: paint each once per page and share it across visits. */
const cache = new Map();
export function cachedTexture(name, S, paint) {
  let t = cache.get(name);
  if (!t || !t.image || !t.image.data) {
    t = dataTexture(paint(), S);
    // a world's dispose() may free the GPU copy; three re-uploads from the kept data on next use
    cache.set(name, t);
  }
  return t;
}

export function dataTexture(data, S) {
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

const lin = hex => new THREE.Color(hex);

/**
 * Triplanar detail for a standard material: three samples of a detail texture, projected along the
 * world axes and blended by the surface normal; the normal is perturbed with a UDN blend.
 *   space 'world'  world position (static things)
 *         'rest'   world position before the vertex sway (swaying things: the texture stays on them)
 * `color` GLSL runs after the vertex colours and can read
 *   vec4 tpT (blended texel), vec3 tpN (world normal), vec3 tpQ (world position), float tpBump (writable)
 * `roughness` and `emissive` GLSL run in those steps and can read the same names.
 */
export function addTriplanar(mat, W, { tex, tile, bump = 1, space = 'world', key, uniforms = {}, header = '', color = '', roughness = '', emissive = '', geoNormal = false }) {
  const rest = space === 'rest';
  const u = { tTp: { value: tex }, uTpS: { value: 1 / tile }, uTpBump: { value: bump }, ...uniforms };
  // geoNormal: the geometry carries aGeoN, its true (unsmoothed) vertex normals. They pick the
  // projections (no texture stretched across a facet), while the smoothed shading normals stay the
  // base of the lighting.
  const vtx = {};
  let vHead = rest ? 'varying vec3 vTpP;\n' : '';
  if (rest) vtx['#include <begin_vertex>'] = '$&\nvTpP = transformed;\n#ifdef USE_INSTANCING\nvTpP = (instanceMatrix * vec4(vTpP, 1.0)).xyz;\n#endif\nvTpP = (modelMatrix * vec4(vTpP, 1.0)).xyz;';
  if (geoNormal) {
    vHead += 'attribute vec3 aGeoN;\nvarying vec3 vTpGN;\n';
    vtx['#include <beginnormal_vertex>'] = '$&\n{\n vec3 gn = aGeoN;\n#ifdef USE_INSTANCING\n mat3 gim = mat3(instanceMatrix);\n gn /= vec3(dot(gim[0], gim[0]), dot(gim[1], gim[1]), dot(gim[2], gim[2]));\n gn = gim * gn;\n#endif\n vTpGN = mat3(modelMatrix) * gn;\n}';
  }
  const frag = {
    '#include <color_fragment>': '$&\n' + /* glsl */`
      vec3 tpN = inverseTransformDirection(normalize(vNormal), viewMatrix);
      #ifdef DOUBLE_SIDED
        tpN *= gl_FrontFacing ? 1.0 : -1.0;
      #endif
      vec3 tpW = ${geoNormal ? 'normalize(vTpGN)' : 'tpN'};
      tpW *= tpW; tpW *= tpW; tpW /= tpW.x + tpW.y + tpW.z;
      vec3 tpQ = ${rest ? 'vTpP' : 'vUwPos'};
      vec3 tpP = tpQ * uTpS;
      vec4 tpX = texture2D(tTp, tpP.zy + vec2(0.37, 0.11));
      vec4 tpY = texture2D(tTp, tpP.xz);
      vec4 tpZ = texture2D(tTp, tpP.xy + vec2(0.61, 0.83));
      vec4 tpT = tpX * tpW.x + tpY * tpW.y + tpZ * tpW.z;
      float tpBump = uTpBump;
      ${color}`,
    '#include <normal_fragment_maps>': '$&\n' + /* glsl */`
      {
        vec2 nx = tpX.rg * 2.0 - 1.0, ny = tpY.rg * 2.0 - 1.0, nz = tpZ.rg * 2.0 - 1.0;
        vec3 pt = tpBump * (vec3(0.0, nx.y, nx.x) * tpW.x + vec3(ny.x, 0.0, ny.y) * tpW.y + vec3(nz.x, nz.y, 0.0) * tpW.z);
        // keep the tilt tangential to the surface: |tpN + pt| >= 1, so the normal can neither vanish
        // (NaN) nor flip where projections mix on a slanted face
        pt -= tpN * dot(pt, tpN);
        normal = normalize((viewMatrix * vec4(tpN + pt, 0.0)).xyz);
      }`,
  };
  if (roughness) frag['#include <roughnessmap_fragment>'] = '$&\n' + roughness;
  if (emissive) frag['#include <emissivemap_fragment>'] = '$&\n' + emissive;
  return patchMaterial(mat, {
    key: 'tp' + key + space + (geoNormal ? 'gn' : ''),
    uniforms: { ...W, ...u },
    vertexHeader: vHead,
    vertex: vtx,
    fragmentHeader: UW_FRAG + (rest ? 'varying vec3 vTpP;\n' : '') + (geoNormal ? 'varying vec3 vTpGN;\n' : '') + 'uniform sampler2D tTp;\nuniform float uTpS, uTpBump;\n' + header,
    fragment: frag,
  });
}

/**
 * Living reef rock for every tier: triplanar rock detail (normal, albedo, coralline/turf field) plus
 * one sample of a world-scale zone texture. Coralline crusts, turf and encrusting colonies are
 * thresholds of the field that move with the zones, so patches grow, shrink and vanish smoothly and keep
 * crisp, anti-aliased outlines at any distance. Vertex colour carries ambient occlusion only. Night
 * fluorescence follows the coralline crusts.
 */
export function addRockSurface(mat, W, { detail, macro, tile = 1.4, bump = 1, fluor = '#ff6fb0', fluorK = 0.1225, key = 'rk' } = {}) {
  const u = {
    tRkM: { value: macro },
    uRkLime: { value: lin('#766e60') }, uRkLime2: { value: lin('#7a6a4e') },
    uRkCor: { value: lin('#b25c6e') }, uRkCor2: { value: lin('#93547e') }, uRkCorM: { value: lin('#d29aa8') },
    uRkTurf: { value: lin('#655a33') }, uRkTurf2: { value: lin('#566038') },
    // encrusting sponges, colonial ascidians and coral recruits: the vivid accents on the rock
    uRkE0: { value: lin('#d0602a') }, uRkE1: { value: lin('#b8383c') }, uRkE2: { value: lin('#7a46a8') },
    uRkE3: { value: lin('#c4b03c') }, uRkE4: { value: lin('#2f8f96') }, uRkE5: { value: lin('#b8448e') },
    uRkFl: { value: lin(fluor).multiplyScalar(fluorK) },
  };
  mat.userData.rockU = u;
  return addTriplanar(mat, W, {
    tex: detail, tile, bump, space: 'world', key: 'rock' + key, uniforms: u, geoNormal: true,
    header: /* glsl */`
      uniform sampler2D tRkM;
      uniform vec3 uRkLime, uRkLime2, uRkCor, uRkCor2, uRkCorM, uRkTurf, uRkTurf2, uRkE0, uRkE1, uRkE2, uRkE3, uRkE4, uRkE5, uRkFl;
      vec3 rkPal(float k){
        vec3 c = uRkE0;
        c = k >= 1.0 ? uRkE1 : c; c = k >= 2.0 ? uRkE2 : c; c = k >= 3.0 ? uRkE3 : c;
        c = k >= 4.0 ? uRkE4 : c; c = k >= 5.0 ? uRkE5 : c;
        return c;
      }`,
    color: /* glsl */`
      vec4 rkM = texture2D(tRkM, (tpQ.xz + tpQ.y * vec2(0.45, -0.3)) * 0.085);
      float rkF = tpT.a * 2.0 - 1.0;
      float rkFw = max(fwidth(rkF), 0.006);
      float rkUp = smoothstep(0.25, 0.85, tpN.y);
      // thresholds move with the world-scale zones (r: coralline, g: turf) and exposure (turf on tops)
      float rkTc = mix(0.42, -0.25, rkM.r) + rkUp * 0.25;
      float rkTt = mix(-0.75, -0.05, rkM.g) + rkUp * 0.35 - 0.05;
      // edges a few millimetres soft (crusts and turf have no sticker-sharp outline), never aliased
      float rkCo = smoothstep(rkTc - rkFw - 0.03, rkTc + rkFw + 0.03, rkF);
      float rkTu = smoothstep(rkTt + rkFw + 0.03, rkTt - rkFw - 0.03, rkF) * (1.0 - rkCo);
      // encrusting colonies and sponges take over the turf shapes in sparse zones (a)
      // (rare accents: frequent ones turned the rock into paint confetti)
      float rkEn = rkTu * smoothstep(0.69, 0.75, rkM.a);
      rkTu -= rkEn;
      float rkAO = diffuseColor.r;
      vec3 rkLime = mix(uRkLime, uRkLime2, smoothstep(0.3, 0.75, rkM.b));
      vec3 rkTurfC = mix(uRkTurf, uRkTurf2, smoothstep(0.35, 0.7, rkM.a)) * (0.85 + 0.3 * rkM.b);
      vec3 rkCorC = mix(uRkCor, uRkCor2, smoothstep(0.35, 0.68, rkM.b));
      float rkMg = rkCo * (1.0 - smoothstep(rkTc + rkFw, rkTc + 0.2, rkF));
      rkCorC = mix(rkCorC, uRkCorM, rkMg * 0.5);
      vec3 rkCol = rkLime;
      rkCol = mix(rkCol, rkTurfC, rkTu);
      rkCol = mix(rkCol, mix(rkPal(floor(fract(rkM.b * 3.7 + rkM.r) * 5.999)), rkLime, 0.2), rkEn);
      rkCol = mix(rkCol, rkCorC, rkCo);
      diffuseColor.rgb = rkCol * rkAO * (tpT.b * 2.0);`,
    roughness: /* glsl */`
      roughnessFactor = mix(roughnessFactor, 0.74, rkCo * 0.8);
      roughnessFactor = mix(roughnessFactor, 1.0, rkTu);`,
    emissive: /* glsl */`
      totalEmissiveRadiance += uRkFl * rkCo * uFluor;`,
  });
}

/**
 * Soft-tissue translucency (anemone tentacles, polyps): light from the key light seeps through to the
 * side facing away from it, and a little of the surrounding water light glows through, so thin living
 * tissue never shades flat and dark like painted plastic.
 */
export function addTranslucency(mat, W, { amount = 0.3, ambient = 0.1, key = 'tl' } = {}) {
  const u = { uTlK: { value: amount }, uTlA: { value: ambient } };
  return patchMaterial(mat, {
    key: 'transl' + key,
    uniforms: { ...W, ...u },
    fragmentHeader: UW_FRAG + 'uniform float uTlK, uTlA;',
    fragment: {
      '#include <lights_fragment_end>': '$&\n' + /* glsl */`
        #if NUM_DIR_LIGHTS > 0
        {
          float tlBack = clamp(0.5 - 0.5 * dot(normal, directionalLights[0].direction), 0.0, 1.0);
          reflectedLight.indirectDiffuse += directionalLights[0].color * BRDF_Lambert(diffuseColor.rgb) * (uTlK * tlBack);
        }
        #endif
        reflectedLight.indirectDiffuse += uwLc(vUwPos.y) * diffuseColor.rgb * uTlA;`,
    },
  });
}
