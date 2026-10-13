// 云海 · flora: the immortal peach tree's crown of blossom and the leafy shrubs on the lawns.
//
// Crown: every bough cluster is a darker, lumpy "blossom mass" (blossoms in the shade inside the crown,
// triplanar-textured) under many alpha-tested blossom sprigs. The sprigs are camera-facing cards, so they
// never turn edge-on into slivers and never cut through each other; they are hand-painted five-petal
// blossoms, buds and twigs (a 2x2 atlas), tinted per card from white-pink to deep pink, darker deeper in the
// crown, and translucent when the sun is behind them.
// Shrubs: leaf-sprig cards instanced with the bushes over a darker, leaf-textured core.
//
// The painted textures hold sRGB colour but are tagged linear and decoded in the shader: on WebGL 1 (Safari 14)
// three r160 uploads sRGB textures through EXT_sRGB, which cannot generate mipmaps, so it turns them off,
// and un-mipmapped cut-outs sparkle as they shrink with distance. These keep their mipmaps everywhere.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, smoothstep, makeRng, patchMaterial } from '../../lib/util.js';
import { patchStd } from './common.js';

const _p = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _m = new THREE.Matrix4(), _c = new THREE.Color();

/* ------------------------------------------------------------------ */
/* Texture plumbing                                                    */
/* ------------------------------------------------------------------ */
export const DECODE_GLSL = /* glsl */`
vec3 csDecodeSRGB(vec3 c){ return mix(pow(c * 0.9478672986 + vec3(0.0521327014), vec3(2.4)), c * 0.0773993808, vec3(lessThanEqual(c, vec3(0.04045)))); }
`;
// map_fragment for the painted maps (sRGB data in a linear-tagged texture)
const MAP_DECODE = /* glsl */`
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  sampledDiffuseColor.rgb = csDecodeSRGB(sampledDiffuseColor.rgb);
  diffuseColor *= sampledDiffuseColor;
#endif
`;

function paintTexture(size, draw, repeat = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;       // sRGB values, decoded in the shader (see the header)
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function mixc(a, b, t, alpha = 1) {
  const A = hexRgb(a), B = hexRgb(b);
  return `rgba(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)},${alpha})`;
}
/** Calls fn(x, y) for every copy of an element (radius r) that shows on a tiling S x S canvas. */
function wrapped(S, x, y, r, fn) {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
    if (x + dx + r < 0 || x + dx - r > S || y + dy + r < 0 || y + dy - r > S) continue;
    fn(x + dx, y + dy);
  }
}

/** Paints into a scratch canvas (draw(g, size) centred on it), then fits the painted part into the tile at
 *  (x0, y0) with a clear margin (scaled to fill it, at most 1.3x): nothing is ever cut off by the tile edge, and
 *  mipmaps never mix tiles. */
function paintFitted(g, x0, y0, S, margin, draw) {
  const W = S * 2, c = document.createElement('canvas');
  c.width = c.height = W;
  const cg = c.getContext('2d');
  cg.translate(S / 2, S / 2);
  draw(cg, S);
  const d = cg.getImageData(0, 0, W, W).data;
  let x1 = W, y1 = W, x2 = -1, y2 = -1;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    if (d[(y * W + x) * 4 + 3] > 6) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  }
  if (x2 < 0) return;
  const bw = x2 - x1 + 1, bh = y2 - y1 + 1, k = Math.min(1.3, (S - 2 * margin) / Math.max(bw, bh));
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(c, x1, y1, bw, bh, x0 + (S - bw * k) / 2, y0 + (S - bh * k) / 2, bw * k, bh * k);
}

/* ------------------------------------------------------------------ */
/* Painting: peach blossom                                             */
/* ------------------------------------------------------------------ */
function blossomPal(v) {
  return {
    base: mixc('#e0739a', '#b51d57', v), mid: mixc('#f3a8c0', '#df5b8b', v), light: mixc('#fcd9e5', '#f4a3bf', v), tip: mixc('#fffafc', '#fde0ea', v),
    edge: `rgba(176,56,102,${(0.34 + 0.16 * v).toFixed(2)})`, vein: `rgba(206,74,124,${(0.16 + 0.1 * v).toFixed(2)})`,
    eye0: '#5e0c26', eye1: mixc('#9a2250', '#821640', v),
  };
}
// a peach petal along -y: a narrow claw at the centre, a broad rounded blade, a faintly uneven tip
function petalPath(g, L, W, tw) {
  g.beginPath();
  g.moveTo(0, 0);
  g.bezierCurveTo(-W * 0.2, -L * 0.12, -W * 0.56, -L * 0.42, -W * 0.5, -L * 0.74);
  g.bezierCurveTo(-W * 0.44, -L * (0.98 + tw), -W * 0.12, -L * 1.02, 0, -L * (0.97 - tw * 0.5));
  g.bezierCurveTo(W * 0.12, -L * 1.02, W * 0.44, -L * (0.98 - tw), W * 0.5, -L * 0.74);
  g.bezierCurveTo(W * 0.56, -L * 0.42, W * 0.2, -L * 0.12, 0, 0);
  g.closePath();
}
/** One open blossom (petal length L) seen at an angle: o = { rot, tilt, squash, tone }; sub: its own rng. */
function drawBlossom(g, x, y, L, o, sub, { shadow = true, detail = true } = {}) {
  const pal = blossomPal(o.tone);
  g.save();
  g.translate(x, y);
  g.rotate(o.tilt); g.scale(1, o.squash); g.rotate(o.rot);
  if (shadow) {
    // contact shadow on whatever is already painted beneath (twig, petals), never on empty texels
    g.globalCompositeOperation = 'source-atop';
    const sh = g.createRadialGradient(L * 0.06, L * 0.12, L * 0.3, L * 0.06, L * 0.12, L * 1.3);
    sh.addColorStop(0, 'rgba(62,8,30,0.42)'); sh.addColorStop(1, 'rgba(62,8,30,0)');
    g.fillStyle = sh; g.fillRect(-L * 1.5, -L * 1.5, L * 3, L * 3);
    g.globalCompositeOperation = 'source-over';
  }
  const a0 = sub.range(0, TAU);
  for (let k = 0; k < 5; k++) {
    const a = a0 + (k / 5) * TAU + sub.range(-0.09, 0.09);
    const Lk = L * sub.range(0.9, 1.05), Wk = Lk * sub.range(0.84, 0.98), tw = sub.range(-0.04, 0.05);
    g.save(); g.rotate(a);
    petalPath(g, Lk, Wk, tw);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, Lk * 1.02);
    grd.addColorStop(0, pal.base); grd.addColorStop(0.26, pal.mid); grd.addColorStop(0.6, pal.light); grd.addColorStop(1, pal.tip);
    g.fillStyle = grd; g.fill();
    if (detail) {
      g.lineWidth = Math.max(0.7, L * 0.024); g.strokeStyle = pal.edge; g.stroke();
      g.strokeStyle = pal.vein; g.lineWidth = Math.max(0.5, L * 0.012);
      for (let v = -2; v <= 2; v++) { g.beginPath(); g.moveTo(0, -Lk * 0.14); g.quadraticCurveTo(v * Wk * 0.07, -Lk * 0.45, v * Wk * 0.15, -Lk * 0.8); g.stroke(); }
    } else {
      g.lineWidth = 1; g.strokeStyle = pal.edge; g.stroke();
    }
    g.restore();
  }
  // a dark wine eye fading into the petal bases
  const eye = g.createRadialGradient(0, 0, 0, 0, 0, L * 0.33);
  eye.addColorStop(0, pal.eye0); eye.addColorStop(0.45, pal.eye1); eye.addColorStop(1, 'rgba(150,30,80,0)');
  g.fillStyle = eye; g.beginPath(); g.arc(0, 0, L * 0.33, 0, TAU); g.fill();
  if (detail) {
    // a ring of long stamens with golden anthers
    const ns = 15 + sub.int(0, 7);
    for (let k = 0; k < ns; k++) {
      const a = sub.range(0, TAU), d = L * sub.range(0.3, 0.52);
      const ex = Math.cos(a) * d, ey = Math.sin(a) * d;
      g.strokeStyle = 'rgba(255,222,234,0.85)'; g.lineWidth = Math.max(0.6, L * 0.016);
      g.beginPath(); g.moveTo(Math.cos(a) * L * 0.08, Math.sin(a) * L * 0.08); g.lineTo(ex, ey); g.stroke();
      g.fillStyle = k % 3 ? '#f6c84a' : '#e39a2e';
      g.beginPath(); g.arc(ex, ey, Math.max(0.9, L * 0.045), 0, TAU); g.fill();
    }
  } else {
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU + sub.range(0, 0.6), d = L * 0.36;
      g.fillStyle = '#efb544'; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, Math.max(0.8, L * 0.06), 0, TAU); g.fill();
    }
  }
  g.fillStyle = '#dfe39a'; g.beginPath(); g.arc(0, 0, Math.max(0.8, L * 0.05), 0, TAU); g.fill();
  g.restore();
}
function drawBud(g, x, y, s, rot, tone) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.fillStyle = '#5a2924';                                   // calyx cup
  g.beginPath(); g.ellipse(0, s * 0.5, s * 0.36, s * 0.26, 0, 0, TAU); g.fill();
  const grd = g.createRadialGradient(-s * 0.18, -s * 0.28, s * 0.05, 0, 0, s * 0.95);
  grd.addColorStop(0, mixc('#ffe1ea', '#ffc2d4', tone)); grd.addColorStop(0.45, mixc('#f07fa4', '#e0477e', tone)); grd.addColorStop(1, mixc('#c23065', '#a0164c', tone));
  g.fillStyle = grd; g.beginPath(); g.ellipse(0, -s * 0.05, s * 0.44, s * 0.66, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(140,20,70,0.35)'; g.lineWidth = Math.max(0.6, s * 0.05);
  g.beginPath(); g.moveTo(0, s * 0.5); g.quadraticCurveTo(s * 0.2, -s * 0.05, -s * 0.04, -s * 0.68); g.stroke();
  g.restore();
}
function drawYoungLeaf(g, x, y, len, wid, rot) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.beginPath(); g.moveTo(0, 0);
  g.quadraticCurveTo(wid, -len * 0.42, 0, -len);
  g.quadraticCurveTo(-wid, -len * 0.42, 0, 0);
  const grd = g.createLinearGradient(0, 0, 0, -len);
  grd.addColorStop(0, '#5f8f2c'); grd.addColorStop(1, '#a9cf62');
  g.fillStyle = grd; g.fill();
  g.strokeStyle = 'rgba(232,246,196,0.55)'; g.lineWidth = 0.8;
  g.beginPath(); g.moveTo(0, -len * 0.06); g.lineTo(0, -len * 0.88); g.stroke();
  g.restore();
}
/** A twig with open blossoms, buds and a few young leaves, inside an S x S tile. dense: a short twig wrapped in
 *  a ball of blossom (most of the crown); otherwise a longer sprig with five to seven blossoms along it. */
function paintSprig(g, S, rng, variant, dense) {
  g.save();
  g.translate(S / 2, S / 2); g.rotate(variant * 1.62 + rng.range(-0.35, 0.35)); g.translate(-S / 2, -S / 2);
  const bend = rng.range(0.07, 0.15) * (rng.chance(0.5) ? 1 : -1), e = dense ? 0.2 : 0;
  const P0 = [S * (0.12 + e), S * (0.9 - e)], P2 = [S * (0.86 - e), S * (0.15 + e)], P1 = [S * (0.5 + bend), S * (0.52 + bend)];
  const at = t => [(1 - t) * (1 - t) * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0], (1 - t) * (1 - t) * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1]];
  const nrm = t => { const tx = 2 * (1 - t) * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]), ty = 2 * (1 - t) * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1]), l = Math.hypot(tx, ty); return [-ty / l, tx / l]; };
  // the twig, tapering, with a lit edge; a short side shoot
  const twig = (pt, w0, w1, steps) => {
    g.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = (i + 1) / steps, [x0, y0] = pt(t0), [x1, y1] = pt(t1), w = lerp(w0, w1, t0);
      if (pass === 0) { g.strokeStyle = '#3c2721'; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
      else { g.strokeStyle = 'rgba(132,96,80,0.75)'; g.lineWidth = w * 0.32; g.beginPath(); g.moveTo(x0 - w * 0.2, y0 - w * 0.2); g.lineTo(x1 - w * 0.2, y1 - w * 0.2); g.stroke(); }
    }
  };
  twig(at, S * 0.034, S * 0.011, 26);
  const ts = rng.range(0.35, 0.55), [sx, sy] = at(ts), [snx, sny] = nrm(ts), sside = rng.chance(0.5) ? 1 : -1, slen = S * rng.range(0.16, 0.24);
  const side = t => [sx + snx * sside * slen * t + (P2[0] - P0[0]) * 0.18 * t, sy + sny * sside * slen * t + (P2[1] - P0[1]) * 0.18 * t];
  twig(side, S * 0.016, S * 0.007, 8);
  // fresh leaves at the tip
  const [lx, ly] = at(0.97), tipA = Math.atan2(P2[1] - P1[1], P2[0] - P1[0]) + Math.PI / 2;
  for (let k = 0; k < 2 + rng.int(0, 1); k++) drawYoungLeaf(g, lx, ly, S * rng.range(0.13, 0.19), S * rng.range(0.035, 0.05), tipA + rng.range(-0.9, 0.9));
  // blossoms along both sides of the twig (all round it when dense), buds toward the tip and on the side shoot
  const items = [];
  const nB = dense ? 10 + rng.int(0, 3) : 5 + rng.int(0, 2);
  for (let k = 0; k < nB; k++) {
    const t = clamp(0.08 + 0.8 * (k + rng.range(-0.3, 0.3)) / (nB - 1), 0.04, 0.92);
    const [x, y] = at(t), [nx, ny] = nrm(t), off = (k % 2 ? 1 : -1) * rng.range(0.02, dense ? 0.17 : 0.07) * S;
    items.push({ bud: false, x: x + nx * off, y: y + ny * off, L: S * rng.range(0.1, 0.14) * lerp(1.06, 0.88, t), z: rng.next(), seed: rng.int(1, 1e9),
      o: { rot: rng.range(0, TAU), tilt: rng.range(0, TAU), squash: rng.chance(0.3) ? rng.range(0.5, 0.75) : rng.range(0.8, 1), tone: rng.range(0, 0.55) } });
  }
  for (let k = 0; k < 3; k++) {
    const onSide = k === 2, t = onSide ? 1 : rng.range(0.82, 0.98);
    const [x, y] = onSide ? side(1) : at(t), [nx, ny] = nrm(Math.min(t, 0.99)), off = rng.range(-0.04, 0.04) * S;
    items.push({ bud: true, x: x + nx * off, y: y + ny * off, s: S * rng.range(0.045, 0.06), rot: rng.range(-0.8, 0.8) + tipA - Math.PI / 2 + Math.PI, z: rng.next() * 0.5, tone: rng.range(0.2, 0.8) });
  }
  items.sort((a, b) => a.z - b.z);
  for (const it of items) {
    if (it.bud) drawBud(g, it.x, it.y, it.s, it.rot, it.tone);
    else drawBlossom(g, it.x, it.y, it.L, it.o, makeRng(it.seed));
  }
  g.restore();
}
/** 2x2 atlas of blossom sprigs (transparent background). */
export function blossomAtlas(seed, size = 512) {
  const rng = makeRng((seed ^ 0x6a09e667) >>> 0);
  return paintTexture(size, (g, S2) => {
    const S = S2 / 2;
    g.clearRect(0, 0, S2, S2);
    // tiles 0 and 3: twigs wrapped in blossom; 1 and 2: open sprigs
    for (let v = 0; v < 4; v++) paintFitted(g, (v % 2) * S, (v >> 1) * S, S, S * 0.03, (cg, s) => paintSprig(cg, s, rng, v, v === 0 || v === 3));
  });
}
/** Tileable "blossom in the shade": layers of small blossoms over dark twigs, deeper layers darker. */
export function blossomMassTexture(seed, size = 256) {
  const rng = makeRng((seed ^ 0xbb67ae85) >>> 0);
  return paintTexture(size, (g, S) => {
    g.fillStyle = '#86404e'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 40; i++) {
      const x = rng.range(0, S), y = rng.range(0, S), r = rng.range(14, 40), dark = rng.chance(0.55);
      wrapped(S, x, y, r, (xx, yy) => {
        const gr = g.createRadialGradient(xx, yy, 0, xx, yy, r);
        gr.addColorStop(0, dark ? 'rgba(40,10,22,0.4)' : 'rgba(176,96,124,0.38)'); gr.addColorStop(1, dark ? 'rgba(40,10,22,0)' : 'rgba(176,96,124,0)');
        g.fillStyle = gr; g.fillRect(xx - r, yy - r, r * 2, r * 2);
      });
    }
    for (let i = 0; i < 8; i++) {
      const x = rng.range(0, S), y = rng.range(0, S), a = rng.range(0, TAU), len = rng.range(40, 90), w = rng.range(1.8, 3.4);
      wrapped(S, x, y, len, (xx, yy) => {
        g.strokeStyle = '#2a1714'; g.lineWidth = w; g.lineCap = 'round';
        g.beginPath(); g.moveTo(xx, yy); g.quadraticCurveTo(xx + Math.cos(a + 0.3) * len * 0.5, yy + Math.sin(a + 0.3) * len * 0.5, xx + Math.cos(a) * len, yy + Math.sin(a) * len); g.stroke();
      });
    }
    const layers = 4, per = 72;
    for (let l = 0; l < layers; l++) {
      for (let i = 0; i < per; i++) {
        const x = rng.range(0, S), y = rng.range(0, S), L = rng.range(7, 12.5);
        const o = { rot: rng.range(0, TAU), tilt: rng.range(0, TAU), squash: rng.range(0.55, 1), tone: rng.range(0.1, 0.65) };
        const sd = rng.int(1, 1e9);
        wrapped(S, x, y, L * 1.4, (xx, yy) => drawBlossom(g, xx, yy, L, o, makeRng(sd), { detail: false }));
      }
      // everything painted so far sinks a little deeper into the shade
      if (l < layers - 1) { g.fillStyle = 'rgba(70,18,30,0.18)'; g.fillRect(0, 0, S, S); }
    }
  }, true);
}

/* ------------------------------------------------------------------ */
/* Painting: shrub leaves                                              */
/* ------------------------------------------------------------------ */
function drawLeaf(g, x, y, a, len, wid, tone, shade, sub) {
  g.save(); g.translate(x, y); g.rotate(a);
  g.globalCompositeOperation = 'source-atop';
  const sh = g.createRadialGradient(0, -len * 0.45, wid * 0.2, 0, -len * 0.45, len * 0.75);
  sh.addColorStop(0, 'rgba(8,20,4,0.2)'); sh.addColorStop(1, 'rgba(8,20,4,0)');
  g.fillStyle = sh; g.fillRect(-len, -len * 1.3, len * 2, len * 1.6);
  g.globalCompositeOperation = 'source-over';
  const bend = sub.range(-0.12, 0.12) * wid;
  g.beginPath(); g.moveTo(0, 0);
  g.bezierCurveTo(wid * 0.62, -len * 0.14, wid * 0.66 + bend, -len * 0.66, bend * 1.4, -len);
  g.bezierCurveTo(-wid * 0.66 + bend, -len * 0.66, -wid * 0.62, -len * 0.14, 0, 0);
  g.closePath();
  const grd = g.createLinearGradient(0, 0, bend, -len);
  const k = shade;
  grd.addColorStop(0, mixc('#3a6a22', '#548a2c', tone * k)); grd.addColorStop(0.55, mixc('#5c9632', '#80b444', tone * k)); grd.addColorStop(1, mixc('#78a83c', '#b2d466', tone * k));
  g.fillStyle = grd; g.fill();
  // the lit half of the blade, a pale midrib and a darker rim
  g.save(); g.clip();
  g.fillStyle = `rgba(200,236,150,${(0.07 + 0.05 * tone).toFixed(2)})`; g.fillRect(bend * 0.5, -len, wid, len);
  g.restore();
  g.strokeStyle = 'rgba(20,44,12,0.22)'; g.lineWidth = 0.8; g.stroke();
  g.strokeStyle = 'rgba(206,232,160,0.3)'; g.lineWidth = Math.max(0.6, wid * 0.07);
  g.beginPath(); g.moveTo(0, -len * 0.04); g.quadraticCurveTo(bend * 0.6, -len * 0.5, bend * 1.3, -len * 0.93); g.stroke();
  g.restore();
}
/** 2x2 atlas of small leafy shoots for the shrubs (transparent background): two rosettes, two sprays. */
export function leafAtlas(seed, size = 256) {
  const rng = makeRng((seed ^ 0x3c6ef372) >>> 0);
  return paintTexture(size, (g, S2) => {
    const S = S2 / 2;
    g.clearRect(0, 0, S2, S2);
    for (let v = 0; v < 4; v++) paintFitted(g, (v % 2) * S, (v >> 1) * S, S, S * 0.03, (cg, s) => {
      const leaves = [];
      if (v < 2) {
        // a rosette round a shoot tip
        const cx = s * 0.5, cy = s * 0.56, n = 8 + rng.int(0, 3);
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + rng.range(-0.25, 0.25), len = s * rng.range(0.3, 0.42), r0 = s * rng.range(0.0, 0.08);
          leaves.push({ x: cx + Math.sin(a) * r0, y: cy - Math.cos(a) * r0, a, len, wid: len * rng.range(0.38, 0.5), z: rng.next() });
        }
      } else {
        // a spray: alternate leaves along an arching stem
        const n = 7 + rng.int(0, 2), bend = rng.range(-0.25, 0.25);
        cg.strokeStyle = '#2c4a1c'; cg.lineWidth = s * 0.02; cg.lineCap = 'round';
        cg.beginPath(); cg.moveTo(s * 0.5, s * 0.95); cg.quadraticCurveTo(s * (0.5 + bend), s * 0.5, s * 0.5, s * 0.08); cg.stroke();
        for (let k = 0; k < n; k++) {
          const t = 0.12 + 0.82 * k / (n - 1), sideK = k % 2 ? 1 : -1;
          const x = (1 - t) * (1 - t) * s * 0.5 + 2 * (1 - t) * t * s * (0.5 + bend) + t * t * s * 0.5, y = (1 - t) * (1 - t) * s * 0.95 + 2 * (1 - t) * t * s * 0.5 + t * t * s * 0.08;
          const len = s * rng.range(0.24, 0.34) * lerp(1.1, 0.7, t);
          leaves.push({ x, y, a: sideK * rng.range(0.6, 1.2), len, wid: len * rng.range(0.38, 0.48), z: t + rng.range(-0.1, 0.1) });
        }
        leaves.push({ x: s * 0.5, y: s * 0.08, a: rng.range(-0.2, 0.2), len: s * 0.2, wid: s * 0.08, z: 2 });
      }
      leaves.sort((p, q) => p.z - q.z);
      const n = leaves.length;
      // back leaves darker, front leaves lighter
      leaves.forEach((L, i) => drawLeaf(cg, L.x, L.y, L.a, L.len, L.wid, rng.next(), 0.62 + 0.38 * (i / (n - 1)), makeRng(rng.int(1, 1e9))));
    });
  });
}
/** Tileable leafy mass for the shrub cores: layered small leaves, deeper ones darker. */
export function leafMassTexture(seed, size = 256) {
  const rng = makeRng((seed ^ 0xa54ff53a) >>> 0);
  return paintTexture(size, (g, S) => {
    g.fillStyle = '#1b3212'; g.fillRect(0, 0, S, S);
    const layers = 4, per = 78;
    for (let l = 0; l < layers; l++) {
      for (let i = 0; i < per; i++) {
        const x = rng.range(0, S), y = rng.range(0, S), a = rng.range(0, TAU), len = rng.range(16, 28), wid = len * rng.range(0.38, 0.5), tone = rng.next(), sd = rng.int(1, 1e9);
        wrapped(S, x, y, len, (xx, yy) => drawLeaf(g, xx, yy, a, len, wid, tone, 0.8, makeRng(sd)));
      }
      if (l < layers - 1) { g.fillStyle = 'rgba(6,16,4,0.26)'; g.fillRect(0, 0, S, S); }
    }
  }, true);
}

/* ------------------------------------------------------------------ */
/* Painting: turf                                                      */
/* ------------------------------------------------------------------ */
/** Tileable grey grain of short, combed grass blades (mean ~0.5): the lawn multiplies its colour by 2x this, so
 *  up close the turf shows blades and from afar (mipmapped to the mean) it is unchanged. */
export function grassTexture(seed, size = 256) {
  const rng = makeRng((seed ^ 0x510e527f) >>> 0);
  return paintTexture(size, (g, S) => {
    g.fillStyle = 'rgb(118,118,118)'; g.fillRect(0, 0, S, S);
    g.lineCap = 'round';
    const comb = rng.range(0, TAU);
    for (let i = 0; i < 2600; i++) {
      const x = rng.range(0, S), y = rng.range(0, S), len = rng.range(5, 12), a = comb + rng.range(-0.9, 0.9), bend = rng.range(-0.35, 0.35);
      const v = Math.round(rng.chance(0.55) ? rng.range(140, 196) : rng.range(56, 104)), w = rng.range(1.0, 1.7);
      wrapped(S, x, y, len, (xx, yy) => {
        g.strokeStyle = `rgb(${v},${v},${v})`; g.lineWidth = w;
        g.beginPath(); g.moveTo(xx, yy);
        g.quadraticCurveTo(xx + Math.cos(a + bend) * len * 0.5, yy + Math.sin(a + bend) * len * 0.5, xx + Math.cos(a) * len, yy + Math.sin(a) * len);
        g.stroke();
      });
    }
  }, true);
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */
// object-space triplanar sample of a tiling, sRGB-encoded texture (three taps, sharp blend)
const TRI_GLSL = /* glsl */`
vec3 csTriplanar(sampler2D t, vec3 p, vec3 n){
  vec3 w = abs(n); w *= w; w *= w; w /= (w.x + w.y + w.z + 1e-5);
  vec3 c = texture2D(t, p.zy).rgb * w.x + texture2D(t, p.xz).rgb * w.y + texture2D(t, p.xy).rgb * w.z;
  return csDecodeSRGB(c);
}
`;
/** Blossom mass inside the crown (uInner < 1: in the shade of the blossoms around it). */
export function blossomMassMaterial(shared, massTex, { inner = 1.3, scale = 0.62, key = 'blossommass' } = {}) {
  // (less blue sky light than open surfaces: inside the crown, light arrives mostly through pink petals)
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, envMapIntensity: 0.6 });
  return patchStd(m, shared, {
    key,
    uniforms: { tMass: { value: massTex }, uInner: { value: inner }, uMassScale: { value: scale } },
    vertexHeader: 'varying vec3 vObjP; varying vec3 vObjN;',
    vertex: { '#include <begin_vertex>': '$&\n vObjP = position; vObjN = normal;' },
    fragmentHeader: DECODE_GLSL + TRI_GLSL + 'uniform sampler2D tMass; uniform float uInner, uMassScale; varying vec3 vObjP; varying vec3 vObjN;',
    fragment: {
      '#include <color_fragment>': /* glsl */`$&
        diffuseColor.rgb *= csTriplanar(tMass, vObjP * uMassScale, vObjN) * uInner;
      `,
      '#include <lights_fragment_end>': /* glsl */`$&
        {
          vec3 Vw = normalize(cameraPosition - vWPos);
          vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float bl = pow(max(dot(-Vw, uLightDir), 0.0), 2.5);
          float wr = clamp((dot(Nw, uLightDir) + 0.6) / 1.6, 0.0, 1.0);
          // light filtering through the petals around it (pinker), and the sky in the gaps
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 0.8, 0.86) * uLightCol * (bl * 0.4 + wr * 0.12) + diffuseColor.rgb * uAmbient * 0.12;
          // light bounced among the blossoms takes on their colour
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 0.62, 0.72) * (uLightCol * 0.1 + uAmbient * 0.35);
        }
      `,
    },
  });
}

/* ------------------------------------------------------------------ */
/* The crown                                                           */
/* ------------------------------------------------------------------ */
// per card: aCard = centre (world) + size; aCardN = lighting normal + (atlas tile * 8 + roll); aTint = tint + depth
const CARD_VERT_HEAD = /* glsl */`
attribute vec4 aCard;
attribute vec4 aCardN;
attribute vec4 aTint;
uniform float uWindTime;
uniform vec2 uWindDir;
varying vec4 vTint;
`;
const CARD_UV = /* glsl */`
#ifdef USE_MAP
  { float ci = floor(aCardN.w * 0.125); vMapUv = vMapUv * 0.5 + vec2(mod(ci, 2.0), floor(ci * 0.5)) * 0.5; }
#endif
`;
const CARD_NORMAL = /* glsl */`
vec3 transformedNormal;
{
  float ci = floor(aCardN.w * 0.125);
  float roll = aCardN.w - ci * 8.0;
  float cr = cos(roll), sr = sin(roll);
  vec2 qn = vec2(cr * position.x - sr * position.y, sr * position.x + cr * position.y);
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  transformedNormal = normalize(normalMatrix * normalize(aCardN.xyz + (camR * qn.x + camU * qn.y) * 0.5));
}
`;
// Camera-facing card (in the shadow pass it faces the light). The sway frequencies (1.7, 3.1 rad/s) complete
// whole cycles in the wind clock's 20π s wrap. A few centimetres at most: the blossom masses do not move.
const CARD_BILLBOARD = /* glsl */`
{
  float ci = floor(aCardN.w * 0.125);
  float roll = aCardN.w - ci * 8.0;
  float cr = cos(roll), sr = sin(roll);
  vec2 qv = vec2(cr * position.x - sr * position.y, sr * position.x + cr * position.y) * aCard.w;
  vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float ph = dot(aCard.xyz, vec3(0.61, 0.37, 0.83));
  float sway = sin(uWindTime * 1.7 + ph) * 0.011 + sin(uWindTime * 3.1 + ph * 1.7) * 0.004;
  transformed = aCard.xyz + vec3(uWindDir.x, 0.3, uWindDir.y) * sway + camR * qv.x + camU * qv.y;
  vTint = aTint;
}
`;

/**
 * The peach tree's crown over its bough clusters ([{ c: Vector3, r }] from peachTree()). `avoid`: points kept
 * clear of sprigs (the hanging peaches). `rng` must be a stream of its own: the garden's main stream also places
 * the peaches, the islets and the cranes' landing spots, and must not change.
 */
export function createBlossomCrown(env, shared, wind, clusters, { rng, noise, avoid = [], count = 1600, shadows = false } = {}) {
  /* ---- blossom masses ---- */
  const massTex = blossomMassTexture(env.seed);
  const parts = [];
  const tones = clusters.map(() => rng.range(0.1, 0.85));
  for (const cl of clusters) {
    const r = cl.r;
    let g = new THREE.IcosahedronGeometry(1, 2);
    g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g);
    const p = g.getAttribute('position'), col = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      _p.fromBufferAttribute(p, i);
      const n1 = noise.noise3(_p.x * 1.5 + cl.c.x, _p.y * 1.5 + cl.c.y, _p.z * 1.5 + cl.c.z);
      const n2 = noise.noise3(_p.x * 3.3 - cl.c.z, _p.y * 3.3 + cl.c.x, _p.z * 3.3);
      const k = r * 0.66 * (1 + 0.2 * n1 + 0.08 * n2);
      p.setXYZ(i, cl.c.x + _p.x * k, cl.c.y + _p.y * k * 0.8, cl.c.z + _p.z * k);
      // darker underneath and in the folds
      const sh = (0.68 + 0.32 * smoothstep(-0.9, 0.9, _p.y)) * (0.88 + 0.12 * n2);
      col[i * 3] = sh; col[i * 3 + 1] = sh * 0.95; col[i * 3 + 2] = sh * 0.97;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    parts.push(g);
  }
  const massMat = blossomMassMaterial(shared, massTex);
  const cores = new THREE.Mesh(mergeGeometries(parts), massMat);
  cores.castShadow = shadows; cores.receiveShadow = shadows;

  /* ---- blossom sprigs ---- */
  const atlas = blossomAtlas(env.seed);
  const total = clusters.reduce((s, cl) => s + cl.r * cl.r, 0);
  const aCard = [], aCardN = [], aTint = [];
  const PALE = new THREE.Color(1.0, 0.9, 0.93), DEEP = new THREE.Color(0.96, 0.5, 0.64);
  const box = new THREE.Box3();
  clusters.forEach((cl, ci) => {
    const n = Math.max(6, Math.round(count * cl.r * cl.r / total));
    for (let k = 0; k < n; k++) {
      let ok = false;
      for (let tries = 0; tries < 4 && !ok; tries++) {
        const z = rng.range(-1, 1), a = rng.range(0, TAU), rr = Math.sqrt(1 - z * z);
        _d.set(rr * Math.cos(a), z * 0.85 + 0.12, rr * Math.sin(a)).normalize();
        const rho = cl.r * lerp(0.6, 1.08, Math.pow(rng.next(), 0.6));
        _p.set(cl.c.x + _d.x * rho, cl.c.y + _d.y * rho * 0.82, cl.c.z + _d.z * rho);
        ok = !avoid.some(v => v.distanceToSquared(_p) < 0.42 * 0.42);
        if (!ok) continue;
        const depth = smoothstep(0.62, 1.04, rho / cl.r);
        _n.set(rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1)).multiplyScalar(0.25).add(_d).normalize();
        const size = rng.range(0.5, 0.72);
        aCard.push(_p.x, _p.y, _p.z, size);
        aCardN.push(_n.x, _n.y, _n.z, rng.int(0, 3) * 8 + rng.range(0, TAU));
        const tone = clamp(tones[ci] + (rng.next() + rng.next() - 1) * 0.3, 0, 1);
        _c.copy(PALE).lerp(DEEP, tone).multiplyScalar(rng.range(0.94, 1.04));
        aTint.push(_c.r, _c.g, _c.b, depth);
        box.expandByPoint(_p);
      }
    }
  });
  const nCards = aCard.length / 4;
  const quad = new THREE.PlaneGeometry(1, 1);
  const ig = new THREE.InstancedBufferGeometry();
  ig.index = quad.index;
  for (const name of ['position', 'normal', 'uv']) ig.setAttribute(name, quad.getAttribute(name));
  ig.setAttribute('aCard', new THREE.InstancedBufferAttribute(new Float32Array(aCard), 4));
  ig.setAttribute('aCardN', new THREE.InstancedBufferAttribute(new Float32Array(aCardN), 4));
  ig.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(aTint), 4));
  ig.instanceCount = nCards;
  // the quad's own bounds are a unit square at the origin: give the culler the crown instead
  box.expandByScalar(0.6);
  ig.boundingBox = box.clone();
  ig.boundingSphere = box.getBoundingSphere(new THREE.Sphere());

  const windU = { uWindTime: wind.uniforms.uWindTime, uWindDir: wind.uniforms.uWindDir };
  const cardMat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.78, metalness: 0, envMapIntensity: 0.65 });
  patchStd(cardMat, shared, {
    key: 'blossomsprig',
    uniforms: windU,
    vertexHeader: CARD_VERT_HEAD,
    vertex: {
      '#include <uv_vertex>': '$&\n' + CARD_UV,
      // lit with the cluster's outward direction (a soft volume), not the card plane, domed a little across the
      // card so neighbouring sprigs blend instead of each taking one flat shade (patchy under lanterns at night)
      '#include <defaultnormal_vertex>': CARD_NORMAL,
      '#include <begin_vertex>': '$&\n' + CARD_BILLBOARD,
    },
    fragmentHeader: DECODE_GLSL + 'varying vec4 vTint;',
    fragment: {
      '#include <map_fragment>': MAP_DECODE,
      // white-pink to deep pink per card; deeper in the crown, darker
      '#include <color_fragment>': '$&\n diffuseColor.rgb *= vTint.rgb * (0.5 + 0.5 * vTint.a);',
      '#include <normal_fragment_begin>': '$&\n normal = normalize(vNormal);',
      '#include <lights_fragment_end>': /* glsl */`$&
        {
          vec3 Vw = normalize(cameraPosition - vWPos);
          vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float back = pow(max(dot(-Vw, uLightDir), 0.0), 3.0);
          float rim = 1.0 - abs(dot(Nw, Vw));
          float through = clamp(dot(Nw, -uLightDir) * 0.5 + 0.5, 0.0, 1.0);
          // thin petals: the sun shines through them (strongest at the crown's rim), a little light everywhere
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 0.78, 0.86) * uLightCol * (back * (0.3 + 0.7 * rim) * 0.85 + through * 0.08) * (0.4 + 0.6 * vTint.a);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * (uAmbient * 0.18 + uBounce * 0.06);
          // light bounced among the blossoms takes on their colour (shaded blossoms stay pink, not lilac)
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 0.66, 0.76) * (uLightCol * 0.08 + uAmbient * 0.3) * (0.5 + 0.5 * vTint.a);
        }
      `,
    },
  });
  const cards = new THREE.Mesh(ig, cardMat);
  // drawn after the masses: sprigs hidden behind a mass are rejected by the depth test before shading
  cards.renderOrder = 1;
  cards.castShadow = shadows;
  if (shadows) {
    const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depthMat.map = atlas; depthMat.alphaTest = 0.4;
    patchMaterial(depthMat, {
      key: 'blossomsprig-depth', uniforms: windU, vertexHeader: CARD_VERT_HEAD,
      vertex: { '#include <uv_vertex>': '$&\n' + CARD_UV, '#include <begin_vertex>': '$&\n' + CARD_BILLBOARD },
    });
    cards.customDepthMaterial = depthMat;
  }
  return { cores, cards, massMat, massTex, atlas, count: nCards };
}

/* ------------------------------------------------------------------ */
/* Shrubs                                                              */
/* ------------------------------------------------------------------ */
/** Leafy core material for the shrubs (object-space leaf texture, darker inside, soft translucency). */
export function leafMassMaterial(shared, massTex, { scale = 0.45, key = 'leafmass' } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  return patchStd(m, shared, {
    key,
    uniforms: { tLeafMass: { value: massTex }, uLeafScale: { value: scale } },
    vertexHeader: 'varying vec3 vObjP; varying vec3 vObjN;',
    vertex: { '#include <begin_vertex>': '$&\n vObjP = position; vObjN = normal;' },
    fragmentHeader: DECODE_GLSL + TRI_GLSL + 'uniform sampler2D tLeafMass; uniform float uLeafScale; varying vec3 vObjP; varying vec3 vObjN;',
    fragment: {
      '#include <color_fragment>': '$&\n diffuseColor.rgb *= csTriplanar(tLeafMass, vObjP * uLeafScale, vObjN) * 5.0;',
      '#include <lights_fragment_end>': /* glsl */`$&
        {
          vec3 Vw = normalize(cameraPosition - vWPos);
          vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float bl = pow(max(dot(-Vw, uLightDir), 0.0), 2.5);
          float wr = clamp((dot(Nw, uLightDir) + 0.4) / 1.4, 0.0, 1.0);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uLightCol * (bl * 0.22 + wr * 0.15);
        }
      `,
    },
  });
}

/**
 * Leaf-sprig cards for one shrub template made of lumps [[x, z, r], ...] (the same lumps the core is built from).
 * Each card sits on a lump's surface, turned any way, so leaves stand out of the silhouette; its normal is the
 * lump's outward direction (a soft, rounded light), its vertex colour a little darker low down.
 */
export function shrubCardGeometry(lumps, rng) {
  const cards = [];
  for (const [x, z, r] of lumps) {
    const n = Math.round(14 * r * r + 3);
    for (let k = 0; k < n; k++) {
      const yy = rng.range(-0.15, 1), a = rng.range(0, TAU), rr = Math.sqrt(1 - yy * yy);
      _d.set(rr * Math.cos(a), yy, rr * Math.sin(a));
      const f = rng.range(0.9, 1.1);
      _p.set(x + _d.x * r * f, 0.16 * r + _d.y * 0.78 * r * f, z + _d.z * r * f);
      // a random orientation, but never lying flat under the camera's grazing view
      _n.set(rng.range(-1, 1), rng.range(-0.4, 1), rng.range(-1, 1)).normalize();
      _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _n);
      const size = rng.range(0.48, 0.68) * (0.75 + 0.25 * r);
      _m.compose(_p, _q, _s.set(size, size, size));
      const g = new THREE.PlaneGeometry(1, 1).applyMatrix4(_m);
      // lighting normal: the lump's outward direction, leaning up
      const on = _d.clone().multiplyScalar(1).add(new THREE.Vector3(0, 0.35, 0)).normalize();
      const nrm = g.getAttribute('normal');
      for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, on.x, on.y, on.z);
      const tile = rng.int(0, 3), uv = g.getAttribute('uv');
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5 + (tile % 2) * 0.5, uv.getY(i) * 0.5 + (tile >> 1) * 0.5);
      const shade = lerp(0.55, 1.0, smoothstep(-0.2, 0.85, _d.y)) * rng.range(0.9, 1.05);
      const col = new Float32Array(nrm.count * 3).fill(shade);
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      cards.push(g);
    }
  }
  return mergeGeometries(cards);
}

/** Material for the shrub leaf cards (the caller adds the same wind as the core's). */
export function leafCardMaterial(shared, atlas) {
  const m = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.7, metalness: 0 });
  return patchStd(m, shared, {
    key: 'leafcard',
    fragmentHeader: DECODE_GLSL,
    fragment: {
      '#include <map_fragment>': MAP_DECODE,
      '#include <normal_fragment_begin>': '$&\n normal = normalize(vNormal);',
      '#include <lights_fragment_end>': /* glsl */`$&
        {
          vec3 Vw = normalize(cameraPosition - vWPos);
          vec3 Nw = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float bl = pow(max(dot(-Vw, uLightDir), 0.0), 2.5);
          float wr = clamp((dot(Nw, uLightDir) + 0.4) / 1.4, 0.0, 1.0);
          // thin leaves glow a warm green against the sun
          reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 1.1, 0.7) * uLightCol * (bl * 0.32 + wr * 0.12);
        }
      `,
    },
  });
}
