// 芒原 · procedural canvas textures (plumes, maple leaves, bark, stone, wood, tofu, plaque...).
import * as THREE from 'three';
import { canvasTexture, makeCanvas, makeRng, createNoise, normalMapFromHeight, clamp, lerp } from '../../lib/util.js';

/** Pampas plume (susuki) card: a loose brush of silky racemes fanning up and drooping to one side.
 * White with alpha; a thin opaque column at u<0.03 is reused for the stem. */
export function plumeTexture(seed = 7) {
  const rng = makeRng(seed);
  return canvasTexture(128, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 4, h);
    const bx = 52, by = h - 3;
    // faint core so the plume survives mip-mapping at a distance
    for (let i = 0; i < 18; i++) {
      const s = i / 17;
      const x = bx + s * s * 14, y = by - s * (h - 30);
      const r = 5 + Math.sin(Math.PI * Math.min(1, s * 1.1)) * 13;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,248,236,0.42)');
      grd.addColorStop(1, 'rgba(255,248,236,0)');
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(x, y, r, r * 1.6, 0, 0, Math.PI * 2); g.fill();
    }
    g.lineCap = 'round';
    const nR = 22;
    for (let k = 0; k < nR; k++) {
      const spread = k / (nR - 1) - 0.5;
      const len = (h - 30) * rng.range(0.6, 0.95) * (1 - Math.abs(spread) * 0.55);
      let a = -Math.PI / 2 + spread * 0.5 + rng.range(-0.08, 0.08);
      const curl = rng.range(0.35, 0.9);
      let x = bx + rng.range(-2, 2), y = by - rng.range(0, 40);
      const steps = 26, pts = [];
      for (let i = 0; i <= steps; i++) {
        pts.push([x, y, a]);
        x += Math.cos(a) * len / steps; y += Math.sin(a) * len / steps;
        a += curl * 0.075 * Math.pow(i / steps, 1.5);
      }
      for (let i = 3; i < pts.length; i++) {
        const [px, py, pa] = pts[i];
        const t = i / steps;
        for (let j = 0; j < 3; j++) {
          const ha = pa + rng.sign() * rng.range(0.25, 1.0);
          const hl = rng.range(3, 10) * (0.45 + t * 0.8);
          const warm = rng.next();
          g.strokeStyle = `rgba(255,${Math.round(lerp(252, 232, warm))},${Math.round(lerp(244, 208, warm))},${rng.range(0.4, 0.9)})`;
          g.lineWidth = rng.range(0.6, 1.25);
          g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(ha) * hl, py + Math.sin(ha) * hl); g.stroke();
        }
      }
      g.strokeStyle = 'rgba(236,224,200,0.95)'; g.lineWidth = 1.2;
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
    }
  });
}

const MAPLE_COLS = ['#b3101c', '#c41a1a', '#d42c18', '#a60c22', '#cf3a16', '#e0521a', '#bf1e1e', '#e86f1c', '#9e1020', '#d84818'];

/** Draw one palmate (Acer palmatum) leaf centred at the origin, petiole toward +y. */
export function drawMapleLeaf(g, size, fill, vein, lobes = 7) {
  const span = 4.5;
  const step = span / (lobes - 1);
  g.beginPath();
  const lens = [0.32, 0.45, 0.53, 0.58, 0.53, 0.45, 0.32];
  for (let k = 0; k < lobes; k++) {
    const a = -Math.PI / 2 - span / 2 + step * k;
    const len = size * (lens[k] ?? 0.45);
    const aN = a + step / 2;
    const sinus = size * 0.16;
    if (k === 0) g.moveTo(Math.cos(a - step / 2) * sinus * 0.6, Math.sin(a - step / 2) * sinus * 0.6);
    // left edge with a small serration, tip, right edge
    g.quadraticCurveTo(Math.cos(a - 0.36) * len * 0.6, Math.sin(a - 0.36) * len * 0.6, Math.cos(a - 0.07) * len * 0.9, Math.sin(a - 0.07) * len * 0.9);
    g.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    g.lineTo(Math.cos(a + 0.07) * len * 0.9, Math.sin(a + 0.07) * len * 0.9);
    g.quadraticCurveTo(Math.cos(a + 0.36) * len * 0.6, Math.sin(a + 0.36) * len * 0.6, Math.cos(aN) * sinus, Math.sin(aN) * sinus);
  }
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  if (vein) {
    g.strokeStyle = vein; g.lineWidth = Math.max(0.6, size * 0.02);
    for (let k = 0; k < lobes; k++) {
      const a = -Math.PI / 2 - span / 2 + step * k;
      const len = size * (lens[k] ?? 0.45) * 0.85;
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * len, Math.sin(a) * len); g.stroke();
    }
  }
}

/** 2x2 atlas of maple sprigs (leaf cards for the canopy). */
const GOLD_COLS = ['#d8a020', '#e0b030', '#c88a18', '#e8c040', '#b87818', '#d89a28'];
const GREEN_COLS = ['#2e4a22', '#3a5a2a', '#28401e', '#4a6a30', '#34502a', '#22381a'];
export function mapleAtlasTexture(seed = 11, palette = 'red') {
  const rng = makeRng(seed);
  const COLS = palette === 'gold' ? GOLD_COLS : palette === 'green' ? GREEN_COLS : MAPLE_COLS;
  return canvasTexture(512, 512, (g, W) => {
    g.clearRect(0, 0, W, W);
    for (let cell = 0; cell < 4; cell++) {
      const ox = (cell % 2) * 256, oy = Math.floor(cell / 2) * 256;
      g.save();
      g.beginPath(); g.rect(ox + 2, oy + 2, 252, 252); g.clip();
      g.translate(ox, oy);
      // twigs
      const twigs = [];
      const nT = 2 + (cell % 2);
      for (let t = 0; t < nT; t++) {
        const pts = [];
        let x = 128 + rng.range(-30, 30), y = 250, a = -Math.PI / 2 + rng.range(-0.7, 0.7);
        for (let i = 0; i < 7; i++) { pts.push([x, y]); x += Math.cos(a) * 34; y += Math.sin(a) * 34; a += rng.range(-0.35, 0.35); }
        twigs.push(pts);
        g.strokeStyle = '#4a1e16'; g.lineWidth = 2.2; g.lineCap = 'round';
        g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
      }
      // leaves: back layer darker, front layer brighter
      const n = 34 + cell * 3;
      for (let i = 0; i < n; i++) {
        const tw = rng.pick(twigs);
        const p = tw[1 + Math.floor(rng.next() * (tw.length - 1))];
        const x = clamp(p[0] + rng.range(-40, 40), 42, 214), y = clamp(p[1] + rng.range(-34, 30), 42, 214);
        const size = rng.range(44, 72);
        const back = i < n * 0.4;
        let col = new THREE.Color(rng.pick(COLS));
        if (back) col.multiplyScalar(0.62);
        else col.offsetHSL(rng.range(-0.012, 0.02), rng.range(-0.05, 0.05), rng.range(-0.03, 0.06));
        g.strokeStyle = '#5a1a12'; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(x, y); g.stroke();
        g.save(); g.translate(x, y); g.rotate(rng.range(-Math.PI, Math.PI));
        const grd = g.createRadialGradient(0, 0, 0, 0, 0, size * 0.6);
        const c0 = col.clone().multiplyScalar(0.72), c1 = col.clone().offsetHSL(0.01, 0, 0.05);
        grd.addColorStop(0, '#' + c0.getHexString());
        grd.addColorStop(1, '#' + c1.getHexString());
        drawMapleLeaf(g, size, grd, 'rgba(255,190,140,0.25)');
        g.restore();
      }
      g.restore();
    }
  });
}

/** Single maple leaf, near-white so instanceColor sets the hue. */
export function leafTexture() {
  return canvasTexture(128, 128, (g, w) => {
    g.clearRect(0, 0, w, w);
    g.translate(w / 2, w / 2 + 6);
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, 60);
    grd.addColorStop(0, '#d8d0cc'); grd.addColorStop(1, '#ffffff');
    drawMapleLeaf(g, 104, grd, 'rgba(120,90,80,0.55)');
    g.strokeStyle = '#8a6a60'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 50); g.stroke();
  });
}

/** Bark with vertical fissures; returns { map, normalMap }. */
export function barkTextures(seed = 3) {
  const rng = makeRng(seed);
  const n = createNoise(seed);
  const W = 128, H = 256;
  const hc = makeCanvas(W, H), hg = hc.getContext('2d');
  const img = hg.createImageData(W, H);
  const cc = makeCanvas(W, H), cg = cc.getContext('2d');
  const cimg = cg.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const fiss = Math.abs(n.noise2(Math.cos(u * Math.PI * 2) * 2.2 + 9, Math.sin(u * Math.PI * 2) * 2.2 + v * 1.2));
    const fine = n.fbm2(u * 24, v * 6, 3) * 0.5 + 0.5;
    const hgt = clamp(0.25 + fiss * 0.9 + fine * 0.25, 0, 1);
    const lich = clamp((n.fbm2(u * 6 + 30, v * 3, 3) - 0.25) * 3, 0, 1);
    const i = (y * W + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = hgt * 255; img.data[i + 3] = 255;
    const base = 0.26 + hgt * 0.32;
    cimg.data[i] = (base * 0.95 + lich * 0.18) * 255;
    cimg.data[i + 1] = (base * 0.82 + lich * 0.22) * 255;
    cimg.data[i + 2] = (base * 0.72 + lich * 0.12) * 255;
    cimg.data[i + 3] = 255;
  }
  hg.putImageData(img, 0, 0); cg.putImageData(cimg, 0, 0);
  const map = new THREE.CanvasTexture(cc); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
  const normalMap = normalMapFromHeight(hc, 3);
  void rng;
  return { map, normalMap };
}

/** Grey granite with lichen, tileable; returns { map, normalMap }. */
export function stoneTextures(seed = 5) {
  const n = createNoise(seed);
  const W = 256;
  const hc = makeCanvas(W, W), hg = hc.getContext('2d');
  const img = hg.createImageData(W, W);
  const cc = makeCanvas(W, W), cg = cc.getContext('2d');
  const cimg = cg.createImageData(W, W);
  const TAU = Math.PI * 2;
  const tor = (u, v, s, o) => n.fbm3(Math.cos(u * TAU) * s + o, Math.sin(u * TAU) * s, Math.cos(v * TAU) * s + Math.sin(v * TAU) * s * 0.5 + o * 0.3, 5);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / W;
    const a = tor(u, v, 1.6, 0) * 0.5 + 0.5;
    const b = tor(u, v, 5.0, 11) * 0.5 + 0.5;
    const speck = tor(u, v, 22, 40) * 0.5 + 0.5;
    const lich = clamp((tor(u, v, 2.4, 70) - 0.12) * 4, 0, 1);
    const hgt = clamp(a * 0.6 + b * 0.3 + speck * 0.1, 0, 1);
    const i = (y * W + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = hgt * 255; img.data[i + 3] = 255;
    let g0 = 0.42 + (a - 0.5) * 0.25 + (speck - 0.5) * 0.22;
    let r = g0, gg = g0 * 0.98, bb = g0 * 0.94;
    r = lerp(r, 0.62, lich * 0.55); gg = lerp(gg, 0.6, lich * 0.55); bb = lerp(bb, 0.42, lich * 0.55);
    cimg.data[i] = clamp(r, 0, 1) * 255; cimg.data[i + 1] = clamp(gg, 0, 1) * 255; cimg.data[i + 2] = clamp(bb, 0, 1) * 255; cimg.data[i + 3] = 255;
  }
  hg.putImageData(img, 0, 0); cg.putImageData(cimg, 0, 0);
  const map = new THREE.CanvasTexture(cc); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 4;
  const normalMap = normalMapFromHeight(hc, 2.5);
  return { map, normalMap };
}

/** Weathered dark cedar planks. */
export function woodTexture(seed = 9) {
  const rng = makeRng(seed);
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#4a3324'; g.fillRect(0, 0, w, h);
    const planks = 6;
    for (let p = 0; p < planks; p++) {
      const x0 = (p / planks) * w, pw = w / planks;
      const tone = rng.range(-14, 14);
      g.fillStyle = `rgb(${76 + tone},${54 + tone * 0.8},${38 + tone * 0.6})`;
      g.fillRect(x0, 0, pw, h);
      g.strokeStyle = 'rgba(30,20,14,0.35)';
      for (let i = 0; i < 18; i++) {
        g.lineWidth = rng.range(0.5, 1.6);
        const xx = x0 + rng.range(2, pw - 2);
        g.beginPath(); g.moveTo(xx, 0);
        for (let y = 0; y <= h; y += 16) g.lineTo(xx + Math.sin(y * 0.03 + i) * 2.5, y);
        g.stroke();
      }
      g.fillStyle = 'rgba(20,12,8,0.75)'; g.fillRect(x0, 0, 2, h);
    }
    // weathering streaks
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `rgba(${rng.chance(0.5) ? '150,140,120' : '20,14,10'},${rng.range(0.03, 0.09)})`;
      g.fillRect(rng.range(0, w), rng.range(0, h), rng.range(2, 6), rng.range(20, 120));
    }
  }, { repeat: true });
}

/** Lantern / shrine wall with a window mask in the middle: returns emissive mask (white window). */
export function windowMaskTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, 26);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(1, '#ffd9a0');
    g.fillStyle = grd; g.fillRect(14, 12, 36, 40);
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(30, 12, 3, 40); g.fillRect(14, 30, 36, 3);
  }, { srgb: true });
}

/** Golden-brown fried tofu skin with small bubbles; returns { map, bumpMap }. */
export function tofuTextures(seed = 13) {
  const rng = makeRng(seed);
  const draw = (g, w, h, bump) => {
    g.fillStyle = bump ? '#808080' : '#c98a3a'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 900; i++) {
      const x = rng.range(0, w), y = rng.range(0, h), r = rng.range(1, 5);
      if (bump) g.fillStyle = `rgba(${rng.chance(0.5) ? '255,255,255' : '0,0,0'},${rng.range(0.15, 0.45)})`;
      else g.fillStyle = rng.chance(0.55) ? `rgba(120,62,18,${rng.range(0.15, 0.4)})` : `rgba(240,190,100,${rng.range(0.12, 0.35)})`;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  };
  const s1 = rng.next(); void s1;
  const map = canvasTexture(128, 128, (g, w, h) => draw(g, w, h, false));
  const bumpMap = canvasTexture(128, 128, (g, w, h) => draw(g, w, h, true), { srgb: false });
  return { map, bumpMap };
}

/** Black lacquer plaque with gold border and 稲荷. */
export function plaqueTexture() {
  return canvasTexture(128, 192, (g, w, h) => {
    g.fillStyle = '#121010'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9a24a'; g.lineWidth = 6; g.strokeRect(7, 7, w - 14, h - 14);
    g.lineWidth = 2; g.strokeRect(16, 16, w - 32, h - 32);
    g.fillStyle = '#e2bb5c';
    g.font = 'bold 56px "WenQuanYi Zen Hei","Noto Serif CJK SC","Noto Sans CJK SC","Songti SC","SimSun",serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('稲', w / 2, h * 0.34);
    g.fillText('荷', w / 2, h * 0.68);
  });
}

/** White zigzag paper streamer (shide). */
export function shideTexture() {
  return canvasTexture(64, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#f6f3ea';
    const steps = 4, sw = 22;
    g.beginPath();
    for (let i = 0; i < steps; i++) {
      const y0 = (i / steps) * h, y1 = ((i + 1) / steps) * h;
      const x0 = i % 2 === 0 ? 8 : w - 8 - sw;
      g.rect(x0, y0, sw, y1 - y0 + 2);
      if (i < steps - 1) g.rect(Math.min(x0, i % 2 === 0 ? w - 8 - sw : 8), y1 - 6, w - 16, 8);
    }
    g.fill();
  });
}

/** Thatch / cypress-bark roof shingles. */
export function roofTexture(seed = 21) {
  const rng = makeRng(seed);
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#3a2e26'; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 16; row++) {
      const y = row * 16;
      for (let x = -(row % 2) * 10; x < w; x += 20) {
        const t = rng.range(-12, 12);
        g.fillStyle = `rgb(${62 + t},${50 + t},${42 + t})`;
        g.fillRect(x + 1, y, 18, 15);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 1, y + 13, 18, 3);
      }
    }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(90,110,60,${rng.range(0.08, 0.2)})`; g.beginPath(); g.arc(rng.range(0, w), rng.range(0, h), rng.range(6, 22), 0, 6.283); g.fill(); }
  }, { repeat: true });
}

/** Subtle lacquer weathering for the torii (vertical streaks, darker toward the bottom). */
export function lacquerTexture(seed = 17) {
  const rng = makeRng(seed);
  return canvasTexture(128, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.75, '#f4ecea'); grd.addColorStop(1, '#c9b8b0');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(${rng.chance(0.6) ? '60,30,25' : '255,240,230'},${rng.range(0.03, 0.1)})`;
      const x = rng.range(0, w), y = rng.range(0, h);
      g.fillRect(x, y, rng.range(1, 3), rng.range(10, 90));
    }
    for (let i = 0; i < 30; i++) {
      g.fillStyle = `rgba(80,60,50,${rng.range(0.04, 0.1)})`;
      g.beginPath(); g.ellipse(rng.range(0, w), rng.range(h * 0.6, h), rng.range(4, 14), rng.range(6, 20), 0, 0, 6.283); g.fill();
    }
  }, { repeat: true });
}

/** Radial light-shaft texture (crepuscular rays) for an additive sun sprite. */
export function sunRaysTexture(seed = 3) {
  const rng = makeRng(seed);
  return canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 70; i++) {
      const a = rng.range(0, Math.PI * 2);
      const spread = rng.range(0.006, 0.035);
      const len = rng.range(0.55, 1.0) * w * 0.5;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, len);
      const al = rng.range(0.05, 0.22);
      grd.addColorStop(0, `rgba(255,255,255,${al})`);
      grd.addColorStop(0.35, `rgba(255,255,255,${al * 0.6})`);
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(cx, cy);
      g.arc(cx, cy, len, a - spread, a + spread);
      g.closePath(); g.fill();
    }
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, w * 0.5);
    core.addColorStop(0, 'rgba(255,255,255,0.35)'); core.addColorStop(0.25, 'rgba(255,255,255,0.08)'); core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
  });
}
