// Canvas-painted textures for the rainforest. Everything is procedural and seeded.
import * as THREE from 'three';
import { TAU, clamp, lerp, makeRng, createNoise, makeCanvas, canvasTexture, normalMapFromHeight } from '../../lib/util.js';

const sm = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function tex(canvas, { srgb = true, repeat = false, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

/**
 * Seamless periodic Perlin fbm. Returns (x, y, oct) => ~[-0.5, 0.5] for pixel coords in [0,W)x[0,H).
 * px, py = number of lattice cells across the texture at the base octave (integers).
 */
export function tiler(seed, W, H, px, py = px) {
  const rng = makeRng(seed);
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng.next() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rng.next() * TAU; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  function noise(x, y, PX, PY) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const ix0 = ((x0 % PX) + PX) % PX, iy0 = ((y0 % PY) + PY) % PY;
    const ix1 = (ix0 + 1) % PX, iy1 = (iy0 + 1) % PY;
    const h00 = perm[perm[ix0 & 255] + (iy0 & 255)], h10 = perm[perm[ix1 & 255] + (iy0 & 255)];
    const h01 = perm[perm[ix0 & 255] + (iy1 & 255)], h11 = perm[perm[ix1 & 255] + (iy1 & 255)];
    const n00 = gx[h00] * fx + gy[h00] * fy;
    const n10 = gx[h10] * (fx - 1) + gy[h10] * fy;
    const n01 = gx[h01] * fx + gy[h01] * (fy - 1);
    const n11 = gx[h11] * (fx - 1) + gy[h11] * (fy - 1);
    const u = fade(fx), v = fade(fy);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v);
  }
  return (x, y, oct = 4) => {
    let a = 1, s = 0, n = 0, PX = px, PY = py;
    for (let o = 0; o < oct; o++) {
      s += a * noise((x / W) * PX, (y / H) * PY, PX, PY);
      n += a; a *= 0.5; PX *= 2; PY *= 2;
    }
    return (s / n) * 1.1;
  };
}

/* ------------------------------------------------------------------ */
/* Canopy cookie / multipurpose tiling noise                            */
/* ------------------------------------------------------------------ */
export function makeCookie(seed, size = 256) {
  const S = tiler(seed, size, size, 5);
  const S2 = tiler(seed + 11, size, size, 11);
  const S3 = tiler(seed + 23, size, size, 7);
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const R = new Float32Array(size * size), G = new Float32Array(size * size);
  // cellular speckles for the A channel, painted with radial gradients (wrapped)
  const rng = makeRng(seed + 5);
  const sc = makeCanvas(size, size);
  const sg = sc.getContext('2d');
  sg.fillStyle = '#000'; sg.fillRect(0, 0, size, size);
  for (let i = 0; i < 160; i++) {
    const cx = rng.next() * size, cy = rng.next() * size, cr = rng.range(1.2, 3.5);
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const x = cx + ox, y = cy + oy;
      if (x < -cr || y < -cr || x > size + cr || y > size + cr) continue;
      const gr = sg.createRadialGradient(x, y, 0, x, y, cr);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      sg.fillStyle = gr; sg.fillRect(x - cr, y - cr, cr * 2, cr * 2);
    }
  }
  const spk = sg.getImageData(0, 0, size, size).data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const r = clamp(S(x, y, 4) * 0.95 + 0.5, 0, 1);
      const gg = clamp(S2(x, y, 3) * 1.1 + 0.5, 0, 1);
      const b = clamp(S3(x, y, 5) * 1.0 + 0.5, 0, 1);
      const a = spk[i * 4] / 255;
      R[i] = r; G[i] = gg;
      img.data[i * 4] = r * 255; img.data[i * 4 + 1] = gg * 255; img.data[i * 4 + 2] = b * 255; img.data[i * 4 + 3] = (0.5 + a * 0.5) * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = tex(c, { srgb: false, repeat: true });
  t.premultiplyAlpha = false;
  return { texture: t, R, G, size };
}

/* ------------------------------------------------------------------ */
/* Bark, rock, ground                                                   */
/* ------------------------------------------------------------------ */
export function makeBark(seed, W = 512, H = 512) {
  const S = tiler(seed, W, H, 6, 1);
  const SD = tiler(seed + 1, W, H, 24);
  const height = makeCanvas(W, H), color = makeCanvas(W, H);
  const hg = height.getContext('2d'), cg = color.getContext('2d');
  const himg = hg.createImageData(W, H), cimg = cg.createImageData(W, H);
  const lich = tiler(seed + 3, W, H, 7);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // vertical fissures: stretch noise along y by sampling a squashed coordinate
      const f1 = S(x, y, 4);
      const ridge = 1 - Math.abs(Math.sin((x / W) * TAU * 9 + f1 * 5.0));
      const fiss = Math.pow(ridge, 3.0);
      const det = SD(x, y, 3);
      let h = 0.55 - fiss * 0.45 + det * 0.18;
      h = clamp(h, 0, 1);
      const l = lich(x, y, 4) + 0.5;
      const lichen = sm(0.6, 0.72, l) * (0.6 + det);
      let r = lerp(0.20, 0.36, h), gch = lerp(0.16, 0.30, h), b = lerp(0.12, 0.22, h);
      r = lerp(r, 0.52, lichen * 0.45); gch = lerp(gch, 0.56, lichen * 0.45); b = lerp(b, 0.44, lichen * 0.45);
      const moss = sm(0.42, 0.25, l) * 0.5 * (1 - fiss);
      r = lerp(r, 0.20, moss); gch = lerp(gch, 0.32, moss); b = lerp(b, 0.10, moss);
      cimg.data[i] = r * 255; cimg.data[i + 1] = gch * 255; cimg.data[i + 2] = b * 255; cimg.data[i + 3] = 255;
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = h * 255; himg.data[i + 3] = 255;
    }
  }
  hg.putImageData(himg, 0, 0); cg.putImageData(cimg, 0, 0);
  return { map: tex(color, { repeat: true }), normalMap: normalMapFromHeight(height, 4.5) };
}

export function makeRock(seed, W = 512, H = 512) {
  const S = tiler(seed, W, H, 4);
  const S2 = tiler(seed + 9, W, H, 16);
  const height = makeCanvas(W, H), color = makeCanvas(W, H);
  const hg = height.getContext('2d'), cg = color.getContext('2d');
  const himg = hg.createImageData(W, H), cimg = cg.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const a = S(x, y, 5), b = S2(x, y, 3);
      const strata = Math.sin((y / H) * TAU * 6 + a * 4) * 0.5 + 0.5;
      let h = clamp(0.5 + a * 0.6 + b * 0.25 + strata * 0.12, 0, 1);
      const crack = sm(0.06, 0.0, Math.abs(a * 1.2 + b * 0.3)) * 0.5;
      h = clamp(h - crack, 0, 1);
      const v = 0.26 + h * 0.2 + b * 0.05;
      const warm = clamp(0.5 + a, 0, 1);
      const r = v * lerp(0.92, 1.05, warm), gch = v * lerp(0.96, 0.98, warm), bb = v * lerp(1.02, 0.85, warm);
      cimg.data[i] = clamp(r, 0, 1) * 255; cimg.data[i + 1] = clamp(gch, 0, 1) * 255; cimg.data[i + 2] = clamp(bb, 0, 1) * 255; cimg.data[i + 3] = 255;
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = h * 255; himg.data[i + 3] = 255;
    }
  }
  hg.putImageData(himg, 0, 0); cg.putImageData(cimg, 0, 0);
  return { map: tex(color, { repeat: true }), normalMap: normalMapFromHeight(height, 3.5) };
}

/** Forest floor: dark soil with leaf litter, twigs and small seedlings. */
export function makeGround(seed, W = 1024, H = 1024) {
  const rng = makeRng(seed);
  const S = tiler(seed, W, H, 6);
  const color = makeCanvas(W, H), height = makeCanvas(W, H);
  const cg = color.getContext('2d'), hg = height.getContext('2d');
  // base soil
  const img = cg.createImageData(W, H), himg = hg.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const a = S(x, y, 4) + 0.5;
    img.data[i] = (0.17 + a * 0.08) * 255; img.data[i + 1] = (0.13 + a * 0.07) * 255; img.data[i + 2] = (0.08 + a * 0.04) * 255; img.data[i + 3] = 255;
    himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = a * 90; himg.data[i + 3] = 255;
  }
  cg.putImageData(img, 0, 0); hg.putImageData(himg, 0, 0);
  // leaf litter (wrap-aware drawing)
  const leafCols = ['#6b4421', '#7d5426', '#5a3a1c', '#8a6a2e', '#4b3b1d', '#6e5a2a', '#3f4a1f', '#a06a2a', '#56331a'];
  const drawWrapped = (fn, x, y, r) => {
    for (const ox of [-W, 0, W]) for (const oy of [-H, 0, H]) {
      if (x + ox < -r || x + ox > W + r || y + oy < -r || y + oy > H + r) continue;
      fn(x + ox, y + oy);
    }
  };
  for (let k = 0; k < 1500; k++) {
    const x = rng.next() * W, y = rng.next() * H, L = rng.range(10, 30), Wd = L * rng.range(0.35, 0.55), ang = rng.next() * TAU;
    const col = rng.pick(leafCols), shade = rng.range(0.7, 1.15);
    drawWrapped((px, py) => {
      for (const [ctx, isH] of [[cg, false], [hg, true]]) {
        ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
        ctx.beginPath(); ctx.moveTo(-L / 2, 0); ctx.quadraticCurveTo(0, -Wd, L / 2, 0); ctx.quadraticCurveTo(0, Wd, -L / 2, 0);
        if (isH) { ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.2 * rng.next()})`; ctx.fill(); }
        else {
          ctx.fillStyle = col; ctx.globalAlpha = 0.9; ctx.fill();
          ctx.globalAlpha = 0.35 * shade; ctx.strokeStyle = '#2a1a0c'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-L / 2, 0); ctx.lineTo(L / 2, 0); ctx.stroke();
        }
        ctx.restore();
      }
    }, x, y, L);
  }
  // twigs
  cg.globalAlpha = 1;
  for (let k = 0; k < 90; k++) {
    const x = rng.next() * W, y = rng.next() * H, L = rng.range(25, 80), ang = rng.next() * TAU;
    drawWrapped((px, py) => {
      for (const [ctx, isH] of [[cg, false], [hg, true]]) {
        ctx.save(); ctx.translate(px, py); ctx.rotate(ang);
        ctx.strokeStyle = isH ? 'rgba(255,255,255,0.8)' : '#3a2814'; ctx.lineWidth = rng.range(1.5, 3.5);
        ctx.beginPath(); ctx.moveTo(-L / 2, 0); ctx.quadraticCurveTo(0, rng.range(-6, 6), L / 2, 0); ctx.stroke();
        ctx.restore();
      }
    }, x, y, L);
  }
  // tiny green seedlings / moss specks
  for (let k = 0; k < 900; k++) {
    const x = rng.next() * W, y = rng.next() * H, r = rng.range(1.5, 4.5);
    cg.fillStyle = rng.pick(['#3f6a1f', '#4e7a26', '#2f5418', '#5a8a2a']);
    cg.globalAlpha = 0.8;
    cg.beginPath(); cg.arc(x, y, r, 0, TAU); cg.fill();
  }
  cg.globalAlpha = 1;
  return { map: tex(color, { repeat: true }), normalMap: normalMapFromHeight(height, 2.0) };
}

/* ------------------------------------------------------------------ */
/* Leaves (alpha textures, base at the bottom, tip at the top)          */
/* ------------------------------------------------------------------ */
function veinStroke(g, x0, y0, x1, y1, cx, cy, w, col) {
  g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1); g.stroke();
}

export function makeMonstera(seed, S = 512) {
  const rng = makeRng(seed);
  return canvasTexture(S, S, (g, w, h) => {
    const cx = w / 2, base = h * 0.94, tip = h * 0.04, half = w * 0.47;
    const outline = () => {
      g.beginPath();
      g.moveTo(cx, base - h * 0.06);
      g.bezierCurveTo(cx - half * 0.35, base + h * 0.02, cx - half * 1.02, base - h * 0.12, cx - half, base - h * 0.45);
      g.bezierCurveTo(cx - half * 0.98, base - h * 0.78, cx - half * 0.45, tip + h * 0.02, cx, tip);
      g.bezierCurveTo(cx + half * 0.45, tip + h * 0.02, cx + half * 0.98, base - h * 0.78, cx + half, base - h * 0.45);
      g.bezierCurveTo(cx + half * 1.02, base - h * 0.12, cx + half * 0.35, base + h * 0.02, cx, base - h * 0.06);
      g.closePath();
    };
    outline();
    const grd = g.createLinearGradient(0, tip, 0, base);
    grd.addColorStop(0, '#2f6a26'); grd.addColorStop(0.5, '#265c20'); grd.addColorStop(1, '#1f4d1a');
    g.fillStyle = grd; g.fill();
    // subtle radial sheen
    const rad = g.createRadialGradient(cx, h * 0.45, 10, cx, h * 0.45, half);
    rad.addColorStop(0, 'rgba(120,170,60,0.25)'); rad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rad; g.fill();
    // veins
    const midX = t => cx + Math.sin(t * 3) * 3;
    g.lineCap = 'round';
    veinStroke(g, cx, base - h * 0.06, cx, tip + 8, cx + 6, h * 0.5, 5, '#7fae4a');
    const nV = 9;
    const veinAngles = [];
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < nV; i++) {
        const t = 0.12 + (i / nV) * 0.8;
        const y0 = lerp(base - h * 0.08, tip + h * 0.06, t);
        const x1 = cx + s * half * (0.95 - Math.abs(t - 0.4) * 0.5);
        const y1 = y0 - h * 0.12 * (1 - t * 0.5);
        veinAngles.push([s, t, y0, x1, y1]);
        veinStroke(g, midX(t), y0, x1, y1, cx + s * half * 0.5, y0 - h * 0.02, 2.2, 'rgba(110,160,70,0.75)');
      }
    }
    // cuts: wedge slits from the margin between veins, plus holes near the midrib
    g.globalCompositeOperation = 'destination-out';
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 1; i < nV - 1; i++) {
        const t = 0.12 + ((i + 0.5) / nV) * 0.8;
        const y0 = lerp(base - h * 0.08, tip + h * 0.06, t);
        if (rng.chance(0.85)) {
          // slit
          const inner = rng.range(0.42, 0.62);
          const xIn = cx + s * half * inner, yIn = y0 - h * 0.035;
          const xOut = cx + s * half * 1.1, yOut = y0 - h * 0.12 * (1 - t * 0.5) - h * 0.01;
          const wdt = rng.range(7, 13);
          g.beginPath();
          g.moveTo(xIn, yIn);
          g.quadraticCurveTo((xIn + xOut) / 2, yIn - h * 0.04 - wdt * 0.3, xOut, yOut - wdt);
          g.lineTo(xOut, yOut + wdt);
          g.quadraticCurveTo((xIn + xOut) / 2, yIn - h * 0.04 + wdt * 0.6, xIn, yIn + 2);
          g.closePath(); g.fill();
        }
        if (rng.chance(0.75) && t > 0.2 && t < 0.85) {
          const hx = cx + s * half * rng.range(0.17, 0.3), hy = y0 - h * 0.035;
          g.beginPath(); g.ellipse(hx, hy, rng.range(6, 11), rng.range(11, 19), s * 0.9, 0, TAU); g.fill();
        }
      }
    }
    g.globalCompositeOperation = 'source-over';
    // darken edges slightly
    g.globalCompositeOperation = 'source-atop';
    g.strokeStyle = 'rgba(20,40,10,0.5)'; g.lineWidth = 6; outline(); g.stroke();
    g.globalCompositeOperation = 'source-over';
  });
}

export function makeBanana(seed, W = 256, H = 1024) {
  const rng = makeRng(seed);
  return canvasTexture(W, H, (g, w, h) => {
    const cx = w / 2, base = h * 0.99, tip = h * 0.01;
    const half = w * 0.48;
    const widthAt = t => half * Math.pow(Math.sin(Math.PI * clamp(t * 0.92 + 0.06, 0, 1)), 0.45) * (t < 0.06 ? t / 0.06 : 1);
    g.beginPath();
    g.moveTo(cx, base);
    for (let i = 0; i <= 40; i++) { const t = i / 40; g.lineTo(cx - widthAt(t) * (0.96 + 0.04 * Math.sin(i * 1.7)), lerp(base, tip, t)); }
    for (let i = 40; i >= 0; i--) { const t = i / 40; g.lineTo(cx + widthAt(t) * (0.96 + 0.04 * Math.cos(i * 1.3)), lerp(base, tip, t)); }
    g.closePath();
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#4f8a2a'); grd.addColorStop(0.45, '#6aa53a'); grd.addColorStop(0.55, '#6aa53a'); grd.addColorStop(1, '#4a8428');
    g.fillStyle = grd; g.fill();
    g.save(); g.clip();
    // parallel veins
    g.strokeStyle = 'rgba(40,80,20,0.25)'; g.lineWidth = 1;
    for (let y = base; y > tip; y -= 5) {
      g.beginPath(); g.moveTo(cx, y); g.lineTo(0, y - 22); g.moveTo(cx, y); g.lineTo(w, y - 22); g.stroke();
    }
    // brown patches and dry edges
    for (let k = 0; k < 10; k++) {
      const y = rng.range(tip, base), x = rng.chance(0.5) ? rng.range(0, 30) : rng.range(w - 30, w);
      const r = rng.range(8, 26);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(120,90,40,0.7)'); gr.addColorStop(1, 'rgba(120,90,40,0)');
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    g.restore();
    // midrib
    g.fillStyle = '#b7c97a'; g.fillRect(cx - 4, tip + 20, 8, base - tip - 20);
    g.fillStyle = 'rgba(80,110,40,0.5)'; g.fillRect(cx + 3, tip + 20, 2, base - tip - 20);
    // tears along the vein direction
    g.globalCompositeOperation = 'destination-out';
    const nT = rng.int(9, 15);
    for (let k = 0; k < nT; k++) {
      const s = rng.sign();
      const y = rng.range(base - h * 0.1, tip + h * 0.12);
      const depth = rng.range(0.55, 0.95);
      const xIn = cx + s * (6 + (1 - depth) * half), yIn = y;
      const xOut = cx + s * (half + 8), yOut = y - 22 * ((half) / half) - 2;
      g.beginPath(); g.moveTo(xIn, yIn); g.lineTo(xOut, yOut - 1.5); g.lineTo(xOut, yOut + 3); g.lineTo(xIn, yIn + 1.2); g.closePath(); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  });
}

export function makeElephantEar(seed, S = 512) {
  const rng = makeRng(seed);
  return canvasTexture(S, S, (g, w, h) => {
    const cx = w / 2, att = h * 0.78, tip = h * 0.02, half = w * 0.46;
    g.beginPath();
    g.moveTo(cx, att);
    // left basal lobe down to bottom, then up to the tip, wavy margin
    g.bezierCurveTo(cx - half * 0.2, h * 0.9, cx - half * 0.75, h * 1.0, cx - half * 0.95, h * 0.82);
    g.bezierCurveTo(cx - half * 1.05, h * 0.62, cx - half * 0.85, h * 0.32, cx - half * 0.4, h * 0.14);
    g.bezierCurveTo(cx - half * 0.2, h * 0.07, cx - 6, tip + 6, cx, tip);
    g.bezierCurveTo(cx + 6, tip + 6, cx + half * 0.2, h * 0.07, cx + half * 0.4, h * 0.14);
    g.bezierCurveTo(cx + half * 0.85, h * 0.32, cx + half * 1.05, h * 0.62, cx + half * 0.95, h * 0.82);
    g.bezierCurveTo(cx + half * 0.75, h * 1.0, cx + half * 0.2, h * 0.9, cx, att);
    g.closePath();
    const grd = g.createRadialGradient(cx, att, 10, cx, att, h * 0.85);
    grd.addColorStop(0, '#4f8a33'); grd.addColorStop(0.6, '#3a7428'); grd.addColorStop(1, '#2c5c1f');
    g.fillStyle = grd; g.fill();
    g.save(); g.clip();
    g.lineCap = 'round';
    // primary veins from the attachment point
    veinStroke(g, cx, att, cx, tip + 10, cx, h * 0.4, 6, '#a9cf7a');
    const lobes = [[-1, 0.92], [1, 0.92]];
    for (const [s] of lobes) veinStroke(g, cx, att, cx + s * half * 0.8, h * 0.93, cx + s * half * 0.4, h * 0.86, 4.5, '#a0c873');
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < 6; i++) {
        const t = 0.15 + i * 0.13;
        const y0 = lerp(att - 10, tip + 30, t);
        const x1 = cx + s * half * (1.0 - t * 0.55), y1 = y0 - h * 0.1 + t * 20;
        veinStroke(g, cx, y0, x1, y1, cx + s * half * 0.45, y0 - h * 0.01, 3, 'rgba(160,200,110,0.9)');
        // fine secondary veins
        for (let j = 0; j < 4; j++) {
          const u = 0.3 + j * 0.17;
          const px = lerp(cx, x1, u), py = lerp(y0, y1, u) - h * 0.01;
          veinStroke(g, px, py, px + s * 18, py - 26, px + s * 12, py - 6, 1, 'rgba(150,190,100,0.45)');
        }
      }
    }
    // a few insect bites and a yellowed patch
    g.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 5; k++) { g.beginPath(); g.arc(rng.range(w * 0.15, w * 0.85), rng.range(h * 0.2, h * 0.85), rng.range(2, 6), 0, TAU); g.fill(); }
    g.globalCompositeOperation = 'source-over';
    g.restore();
  });
}

/** Pinnate fern frond. */
export function makeFern(seed, W = 256, H = 1024, { color = ['#3f7a26', '#5f9a34'], density = 1, vein = '#3a5a1c', rachis = '#5a6a28' } = {}) {
  const rng = makeRng(seed);
  return canvasTexture(W, H, (g, w, h) => {
    const cx = w / 2, base = h * 0.995, tip = h * 0.01;
    const n = Math.round(30 * density);
    g.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const y = lerp(base - h * 0.06, tip + h * 0.02, t);
      const len = w * 0.47 * Math.pow(Math.sin(Math.PI * clamp(t * 0.9 + 0.1, 0, 1)), 0.7) * (0.92 + 0.08 * rng.next());
      for (let s = -1; s <= 1; s += 2) {
        const ang = -0.45 - t * 0.25;
        const ex = cx + s * len * Math.cos(ang), ey = y + len * Math.sin(ang);
        // pinna as a series of small pinnules
        const segs = Math.max(4, Math.round(len / 7));
        for (let k = 0; k < segs; k++) {
          const u = k / segs;
          const px = lerp(cx, ex, u), py = lerp(y, ey, u);
          const pl = (1 - u) * 9 + 3;
          g.fillStyle = k % 2 ? color[0] : color[1];
          g.beginPath();
          g.ellipse(px + s * 2, py - pl * 0.35, pl * 0.42, pl * 0.95, s * 0.6, 0, TAU);
          g.fill();
          g.beginPath();
          g.ellipse(px + s * 2, py + pl * 0.35, pl * 0.42, pl * 0.9, -s * 0.6 + Math.PI, 0, TAU);
          g.fill();
        }
        g.strokeStyle = vein; g.lineWidth = 1.6;
        g.beginPath(); g.moveTo(cx, y); g.lineTo(ex, ey); g.stroke();
      }
    }
    // rachis
    g.strokeStyle = rachis; g.lineWidth = 4;
    g.beginPath(); g.moveTo(cx, base); g.lineTo(cx, tip + 10); g.stroke();
    // a little light variation toward the tip
    g.globalCompositeOperation = 'source-atop';
    const grd = g.createLinearGradient(0, base, 0, tip);
    grd.addColorStop(0, 'rgba(0,0,0,0.15)'); grd.addColorStop(1, 'rgba(180,220,90,0.18)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
  });
}

export function makeStrap(seed, W = 128, H = 512, { base = '#7a1f2a', mid = '#3d6e2a', tipC = '#9a2a30' } = {}) {
  return canvasTexture(W, H, (g, w, h) => {
    const cx = w / 2;
    g.beginPath();
    g.moveTo(cx - w * 0.42, h);
    g.quadraticCurveTo(cx - w * 0.48, h * 0.4, cx, 2);
    g.quadraticCurveTo(cx + w * 0.48, h * 0.4, cx + w * 0.42, h);
    g.closePath();
    const grd = g.createLinearGradient(0, h, 0, 0);
    grd.addColorStop(0, base); grd.addColorStop(0.3, mid); grd.addColorStop(0.85, mid); grd.addColorStop(1, tipC);
    g.fillStyle = grd; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 2;
    for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo(cx + k * 9, h); g.lineTo(cx + k * 3, 10); g.stroke(); }
  });
}

/** Dense cluster of small leaves for canopy clumps, background trees and vines. */
export function makeFoliage(seed, S = 512, { palette = ['#1f4a1c', '#2a5e22', '#336b28', '#244f1d', '#3d7a2c', '#18381a'], count = 260, radius = 0.47 } = {}) {
  const rng = makeRng(seed);
  return canvasTexture(S, S, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    for (let k = 0; k < count; k++) {
      const a = rng.next() * TAU, r = Math.sqrt(rng.next()) * w * radius;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.9;
      const L = rng.range(18, 34) * (1 - (r / (w * radius)) * 0.3), Wd = L * rng.range(0.4, 0.55);
      const ang = a + rng.range(-0.8, 0.8);
      g.save(); g.translate(x, y); g.rotate(ang);
      const lit = 1 - r / (w * radius);
      g.fillStyle = rng.pick(palette);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(L * 0.5, -Wd, L, 0); g.quadraticCurveTo(L * 0.5, Wd, 0, 0); g.fill();
      g.strokeStyle = `rgba(150,200,90,${0.12 + lit * 0.2})`; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 0); g.lineTo(L * 0.9, 0); g.stroke();
      g.restore();
    }
  });
}

/** Hanging vine card: a stem with alternating heart-shaped leaves (base at the bottom = attachment at v=0). */
export function makeVineCard(seed, W = 128, H = 512) {
  const rng = makeRng(seed);
  return canvasTexture(W, H, (g, w, h) => {
    const cx = w / 2;
    g.strokeStyle = '#3e5a22'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(cx, h); for (let y = h; y > 0; y -= 16) g.lineTo(cx + Math.sin(y * 0.05) * 6, y); g.stroke();
    for (let y = h - 10; y > 10; y -= rng.range(16, 26)) {
      const s = rng.sign();
      const x = cx + Math.sin(y * 0.05) * 6;
      const L = rng.range(20, 34);
      g.save(); g.translate(x, y); g.rotate(s * rng.range(0.6, 1.2) + Math.PI);
      g.fillStyle = rng.pick(['#2d5e22', '#3a6e28', '#24501c', '#457a2e']);
      g.beginPath(); g.moveTo(0, 0);
      g.bezierCurveTo(-L * 0.6, L * 0.1, -L * 0.5, L * 0.9, 0, L * 1.1);
      g.bezierCurveTo(L * 0.5, L * 0.9, L * 0.6, L * 0.1, 0, 0); g.fill();
      g.strokeStyle = 'rgba(160,210,110,0.3)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, 2); g.lineTo(0, L); g.stroke();
      g.restore();
    }
  });
}

export function makeLilyPad(seed, S = 256) {
  const rng = makeRng(seed);
  return canvasTexture(S, S, (g, w, h) => {
    const cx = w / 2, cy = h / 2, r = w * 0.48;
    g.beginPath();
    g.moveTo(cx, cy);
    const notch = 0.22;
    g.arc(cx, cy, r, -Math.PI / 2 + notch, -Math.PI / 2 - notch + TAU);
    g.closePath();
    const grd = g.createRadialGradient(cx, cy, 2, cx, cy, r);
    grd.addColorStop(0, '#4f8a30'); grd.addColorStop(0.75, '#3c7526'); grd.addColorStop(0.93, '#4a6a22'); grd.addColorStop(1, '#7a3a24');
    g.fillStyle = grd; g.fill();
    g.save(); g.clip();
    g.strokeStyle = 'rgba(150,200,100,0.35)'; g.lineWidth = 1.5;
    for (let k = 0; k < 22; k++) {
      const a = -Math.PI / 2 + notch + (k + 0.5) / 22 * (TAU - notch * 2);
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.stroke();
    }
    for (let k = 0; k < 6; k++) {
      const a = rng.next() * TAU, d = rng.range(0.3, 0.9) * r, rr = rng.range(8, 22);
      const gr = g.createRadialGradient(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr);
      gr.addColorStop(0, 'rgba(120,60,30,0.35)'); gr.addColorStop(1, 'rgba(120,60,30,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }
    g.restore();
  });
}

export function makePetal(seed, W = 128, H = 256, { base = '#fff4f6', tipC = '#e8508a' } = {}) {
  return canvasTexture(W, H, (g, w, h) => {
    const cx = w / 2;
    g.beginPath();
    g.moveTo(cx, h);
    g.bezierCurveTo(cx - w * 0.55, h * 0.75, cx - w * 0.42, h * 0.18, cx, 0);
    g.bezierCurveTo(cx + w * 0.42, h * 0.18, cx + w * 0.55, h * 0.75, cx, h);
    g.closePath();
    const grd = g.createLinearGradient(0, h, 0, 0);
    grd.addColorStop(0, base); grd.addColorStop(0.45, base); grd.addColorStop(1, tipC);
    g.fillStyle = grd; g.fill();
    g.save(); g.clip();
    g.strokeStyle = 'rgba(200,60,110,0.25)'; g.lineWidth = 1;
    for (let k = -5; k <= 5; k++) { g.beginPath(); g.moveTo(cx, h); g.quadraticCurveTo(cx + k * 9, h * 0.5, cx + k * 4, 4); g.stroke(); }
    g.restore();
  });
}

/** Small orchid / flower sprite card (5 petals with a darker lip). */
export function makeOrchid(seed, S = 128, { petal = '#f2a6d8', lip = '#a0167a', center = '#ffe36a' } = {}) {
  return canvasTexture(S, S, (g, w, h) => {
    const cx = w / 2, cy = h / 2;
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + k * TAU / 5;
      g.save(); g.translate(cx, cy); g.rotate(a);
      g.fillStyle = petal;
      g.beginPath(); g.ellipse(w * 0.22, 0, w * 0.22, w * 0.12, 0, 0, TAU); g.fill();
      g.restore();
    }
    g.fillStyle = lip; g.beginPath(); g.ellipse(cx, cy + h * 0.12, w * 0.12, h * 0.14, 0, 0, TAU); g.fill();
    g.fillStyle = center; g.beginPath(); g.arc(cx, cy, w * 0.05, 0, TAU); g.fill();
  });
}

/** Grass / sedge blade card. */
export function makeBlades(seed, W = 128, H = 512) {
  const rng = makeRng(seed);
  return canvasTexture(W, H, (g, w, h) => {
    for (let k = 0; k < 14; k++) {
      const x0 = w * 0.5 + rng.range(-w * 0.15, w * 0.15);
      const lean = rng.range(-w * 0.35, w * 0.35);
      const top = rng.range(h * 0.02, h * 0.35), bw = rng.range(3, 6);
      g.fillStyle = rng.pick(['#4d7d2a', '#5e8f33', '#3f6b22', '#6d9a3a', '#7a8f3a']);
      g.beginPath(); g.moveTo(x0 - bw, h); g.quadraticCurveTo(x0 + lean * 0.3, h * 0.5, x0 + lean, top); g.quadraticCurveTo(x0 + lean * 0.3 + bw, h * 0.5, x0 + bw, h); g.fill();
    }
  });
}

/** Simple lit sprite for soft particles: soft disc with a hint of noise. */
export function makeSoftSprite(size = 64, falloff = 1) {
  return canvasTexture(size, size, (g, w) => {
    const r = w / 2;
    const grd = g.createRadialGradient(r, r, 0, r, r, r);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.35 / falloff, 'rgba(255,255,255,0.55)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
  }, { srgb: false });
}

/** Cloudy puff sprite for mist. */
export function makePuff(seed, size = 128) {
  const n = createNoise(seed);
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = x / size - 0.5, dy = y / size - 0.5;
    const d = Math.sqrt(dx * dx + dy * dy) * 2;
    const v = n.fbm2(x / size * 4, y / size * 4, 4) * 0.5 + 0.5;
    const a = clamp((1 - d) * 1.4, 0, 1) * clamp(v * 1.4 - 0.15, 0, 1);
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a * a * 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}
