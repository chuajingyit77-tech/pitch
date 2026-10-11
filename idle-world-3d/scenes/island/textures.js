// 晴岛 painted canvas textures. Everything is procedural (no downloaded images).
import * as THREE from 'three';
import { canvasTexture, makeRng, createNoise, makeCanvas, clamp, lerp, TAU } from '../../lib/util.js';

const rgba = (r, g, b, a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;

/** Palm bark: grey-brown fibres with stepped ring grooves (4 rings per tile, tile = 1 m). */
export function barkTexture(seed) {
  return canvasTexture(128, 256, (g, w, h) => {
    const rng = makeRng(seed);
    const grd0 = g.createLinearGradient(0, 0, w, 0);
    grd0.addColorStop(0, '#6e5d4b'); grd0.addColorStop(0.5, '#857160'); grd0.addColorStop(1, '#6e5d4b');
    g.fillStyle = grd0; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 420; i++) {
      const x = rng.range(0, w), y = rng.range(0, h), len = rng.range(8, 50);
      const v = rng.range(0, 1);
      g.strokeStyle = v < 0.5 ? rgba(60, 48, 38, rng.range(0.15, 0.4)) : rgba(170, 150, 125, rng.range(0.12, 0.3));
      g.lineWidth = rng.range(0.6, 1.8);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.range(-2, 2), y + len); g.stroke();
    }
    const n = 4;
    for (let i = 0; i < n; i++) {
      const y = (i + 1) * h / n;
      const band = h / n;
      const grd = g.createLinearGradient(0, y - band, 0, y);
      grd.addColorStop(0, 'rgba(190,170,140,0.0)');
      grd.addColorStop(0.55, 'rgba(185,165,135,0.28)');
      grd.addColorStop(0.86, 'rgba(70,55,42,0.35)');
      grd.addColorStop(0.97, 'rgba(38,28,20,0.85)');
      grd.addColorStop(1, 'rgba(38,28,20,0.9)');
      g.fillStyle = grd; g.fillRect(0, y - band, w, band);
      g.strokeStyle = 'rgba(30,22,16,0.9)'; g.lineWidth = 2.2;
      g.beginPath();
      for (let x = 0; x <= w; x += 6) g.lineTo(x, y - 2 + Math.sin(x * 0.09 + i * 2.1) * 1.6 + rng.range(-0.8, 0.8));
      g.stroke();
      // leaf scars: little crescents
      for (let k = 0; k < 5; k++) {
        const x = rng.range(0, w);
        g.strokeStyle = 'rgba(50,38,28,0.55)'; g.lineWidth = 1.4;
        g.beginPath(); g.arc(x, y - band * 0.35, rng.range(6, 12), 0.2, Math.PI - 0.2); g.stroke();
      }
    }
  }, { repeat: true });
}

/** Pinnate palm frond (alpha): v = base→tip (canvas bottom→top), u = left→right edge. */
export function frondTexture(seed, { hue = 0 } = {}) {
  return canvasTexture(256, 512, (g, w, h) => {
    const rng = makeRng(seed);
    g.clearRect(0, 0, w, h);
    const cx = w / 2;
    const N = 52;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      const y = h * (1 - t) - 4;
      const len = (w * 0.49) * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.72)), 0.7) * rng.range(0.86, 1.0) + 6;
      for (const s of [-1, 1]) {
        const droop = rng.range(0.42, 0.62);
        const ex = cx + s * len, ey = y - len * droop;
        const base = rng.range(0, 1);
        const gr = g.createLinearGradient(cx, y, ex, ey);
        const c0 = [52 + hue * 10 + base * 14, 98 + base * 22, 34 + base * 10];
        const c1 = [118 + hue * 16 + base * 30, 170 + base * 20, 62 + base * 16];
        gr.addColorStop(0, rgba(c0[0], c0[1], c0[2]));
        gr.addColorStop(0.7, rgba(c1[0], c1[1], c1[2]));
        gr.addColorStop(1, rgba(c1[0] + 30, c1[1] + 12, c1[2] + 6));
        g.fillStyle = gr;
        const wb = rng.range(4.5, 6.5);
        g.beginPath();
        g.moveTo(cx, y + wb);
        g.quadraticCurveTo(cx + s * len * 0.45, y - len * droop * 0.25 + wb * 1.2, ex, ey);
        g.quadraticCurveTo(cx + s * len * 0.5, y - len * droop * 0.55 - wb * 0.6, cx, y - wb * 0.4);
        g.closePath();
        g.fill();
        // midrib highlight
        g.strokeStyle = rgba(190, 205, 120, 0.35); g.lineWidth = 1;
        g.beginPath(); g.moveTo(cx, y); g.quadraticCurveTo(cx + s * len * 0.48, y - len * droop * 0.38, ex, ey); g.stroke();
      }
    }
    // a few torn / brown leaflets for realism
    for (let i = 0; i < 6; i++) {
      const t = rng.range(0.1, 0.9), y = h * (1 - t), s = rng.sign();
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = rgba(150, 120, 60, 0.6);
      g.fillRect(cx + s * rng.range(30, 90), y - 20, s * 30, 14);
      g.globalCompositeOperation = 'source-over';
    }
    // rachis
    const rg = g.createLinearGradient(0, h, 0, 0);
    rg.addColorStop(0, '#9c8f4a'); rg.addColorStop(1, '#c2c27a');
    g.strokeStyle = rg; g.lineWidth = 7;
    g.beginPath(); g.moveTo(cx, h); g.lineTo(cx, 6); g.stroke();
  });
}

/** Cluster of broad tropical leaves (alpha), used on bush cards. */
export function leafClusterTexture(seed, palette) {
  return canvasTexture(256, 256, (g, w, h) => {
    const rng = makeRng(seed);
    g.clearRect(0, 0, w, h);
    const leaves = [];
    for (let i = 0; i < 64; i++) {
      const a = rng.range(0, TAU), r = Math.pow(rng.next(), 0.6) * w * 0.36;
      leaves.push({ x: w / 2 + Math.cos(a) * r, y: h / 2 + Math.sin(a) * r, a, r });
    }
    leaves.sort((p, q) => q.r - p.r); // outer first, inner on top
    for (const l of leaves) {
      const L = rng.range(30, 52), W = L * rng.range(0.34, 0.5);
      const rot = l.a + rng.range(-0.7, 0.7);
      const c = rng.pick(palette);
      const shade = rng.range(0.78, 1.15) * (0.82 + 0.3 * (1 - l.r / (w * 0.36)));
      g.save();
      g.translate(l.x, l.y); g.rotate(rot);
      const gr = g.createLinearGradient(-L * 0.5, 0, L * 0.5, 0);
      gr.addColorStop(0, rgba(c[0] * shade * 0.75, c[1] * shade * 0.75, c[2] * shade * 0.75));
      gr.addColorStop(1, rgba(Math.min(255, c[0] * shade * 1.12), Math.min(255, c[1] * shade * 1.12), Math.min(255, c[2] * shade * 1.12)));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(-L * 0.5, 0);
      g.quadraticCurveTo(-L * 0.05, -W, L * 0.5, 0);
      g.quadraticCurveTo(-L * 0.05, W, -L * 0.5, 0);
      g.fill();
      g.strokeStyle = rgba(c[0] * 1.3, c[1] * 1.25, c[2] * 1.1, 0.45); g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(-L * 0.45, 0); g.lineTo(L * 0.45, 0); g.stroke();
      g.restore();
    }
  });
}

/** Grass tuft (alpha): blades fanning out of the bottom centre. */
export function grassTexture(seed) {
  return canvasTexture(128, 128, (g, w, h) => {
    const rng = makeRng(seed);
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 34; i++) {
      const x0 = w / 2 + rng.range(-16, 16);
      const lean = rng.range(-0.75, 0.75);
      const len = rng.range(0.55, 0.98) * h;
      const x1 = x0 + lean * len * 0.6, y1 = h - len;
      const bw = rng.range(2.2, 4.2);
      const gr = g.createLinearGradient(0, h, 0, y1);
      const k = rng.range(0.8, 1.15);
      gr.addColorStop(0, rgba(46 * k, 86 * k, 30 * k));
      gr.addColorStop(0.6, rgba(96 * k, 158 * k, 56 * k));
      gr.addColorStop(1, rgba(160 * k, 200 * k, 104 * k));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x0 - bw, h);
      g.quadraticCurveTo(x0 + lean * len * 0.15, h - len * 0.5, x1, y1);
      g.quadraticCurveTo(x0 + lean * len * 0.15 + bw, h - len * 0.5, x0 + bw, h);
      g.fill();
    }
  });
}

/** Hibiscus bloom seen from the front (white petals so instance colour tints them). */
export function flowerTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    for (let i = 0; i < 5; i++) {
      g.save();
      g.translate(cx, cy); g.rotate(i / 5 * TAU);
      const gr = g.createRadialGradient(0, -12, 2, 0, -12, 17);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.75, '#f2f2f2'); gr.addColorStop(1, '#dcdcdc');
      g.fillStyle = gr;
      g.beginPath(); g.ellipse(0, -13, 11, 15, 0, 0, TAU); g.fill();
      g.restore();
    }
    const c = g.createRadialGradient(cx, cy, 0, cx, cy, 10);
    c.addColorStop(0, 'rgba(90,0,20,1)'); c.addColorStop(1, 'rgba(120,10,30,0)');
    g.fillStyle = c; g.beginPath(); g.arc(cx, cy, 10, 0, TAU); g.fill();
    g.strokeStyle = '#fff2a0'; g.lineWidth = 2.2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + 9, cy - 9); g.stroke();
    g.fillStyle = '#ffe680'; g.beginPath(); g.arc(cx + 10, cy - 10, 2.6, 0, TAU); g.fill();
  });
}

/** Straw thatch for the hut roof (tile). */
export function thatchTexture(seed) {
  return canvasTexture(256, 256, (g, w, h) => {
    const rng = makeRng(seed);
    g.fillStyle = '#a7834e'; g.fillRect(0, 0, w, h);
    const rows = 6;
    for (let r = 0; r < rows; r++) {
      const y0 = r * h / rows;
      for (let i = 0; i < 220; i++) {
        const x = rng.range(-10, w + 10), y = y0 + rng.range(-4, h / rows * 0.4);
        const len = rng.range(h / rows * 0.8, h / rows * 1.4);
        const v = rng.range(0, 1);
        g.strokeStyle = v < 0.3 ? rgba(120, 90, 50, 0.8) : v < 0.8 ? rgba(200, 165, 105, 0.75) : rgba(230, 200, 140, 0.7);
        g.lineWidth = rng.range(1, 2.4);
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + rng.range(-5, 5), y + len); g.stroke();
      }
      const sh = g.createLinearGradient(0, y0 + h / rows * 0.75, 0, y0 + h / rows);
      sh.addColorStop(0, 'rgba(50,35,15,0)'); sh.addColorStop(1, 'rgba(50,35,15,0.55)');
      g.fillStyle = sh; g.fillRect(0, y0 + h / rows * 0.75, w, h / rows * 0.25);
    }
  }, { repeat: true });
}

/** Weathered wood planks (grain along u). */
export function woodTexture(seed, { base = [138, 104, 72], planks = 4 } = {}) {
  return canvasTexture(256, 128, (g, w, h) => {
    const rng = makeRng(seed);
    for (let p = 0; p < planks; p++) {
      const y0 = p * h / planks, ph = h / planks;
      const k = rng.range(0.82, 1.12);
      g.fillStyle = rgba(base[0] * k, base[1] * k, base[2] * k);
      g.fillRect(0, y0, w, ph);
      for (let i = 0; i < 40; i++) {
        const y = y0 + rng.range(1, ph - 1);
        g.strokeStyle = rng.next() < 0.6 ? rgba(base[0] * 0.6, base[1] * 0.6, base[2] * 0.58, 0.35) : rgba(base[0] * 1.25, base[1] * 1.22, base[2] * 1.2, 0.25);
        g.lineWidth = rng.range(0.5, 1.5);
        g.beginPath(); g.moveTo(0, y);
        for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.03 + i) * rng.range(0.3, 1.4));
        g.stroke();
      }
      if (rng.chance(0.6)) { // knot
        const kx = rng.range(20, w - 20), ky = y0 + ph * 0.5;
        g.fillStyle = rgba(base[0] * 0.5, base[1] * 0.45, base[2] * 0.4, 0.8);
        g.beginPath(); g.ellipse(kx, ky, 5, 2.5, 0, 0, TAU); g.fill();
      }
      g.fillStyle = 'rgba(25,18,12,0.85)'; g.fillRect(0, y0, w, 1.5);
    }
  }, { repeat: true });
}

/** Sea-turtle carapace seen from above (planar UV): scutes with radiating streaks. */
export function turtleShellTexture(seed) {
  return canvasTexture(256, 256, (g, w, h) => {
    const rng = makeRng(seed);
    g.fillStyle = '#4a3a22'; g.fillRect(0, 0, w, h);
    const scute = (pts, c) => {
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      g.save();
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath();
      const gr = g.createRadialGradient(cx, cy, 2, cx, cy, 34);
      gr.addColorStop(0, rgba(c[0] * 1.35, c[1] * 1.3, c[2] * 1.1));
      gr.addColorStop(1, rgba(c[0] * 0.75, c[1] * 0.72, c[2] * 0.7));
      g.fillStyle = gr; g.fill();
      g.clip();
      for (let i = 0; i < 26; i++) {
        const a = rng.range(0, TAU), L = rng.range(10, 40);
        g.strokeStyle = rng.next() < 0.5 ? rgba(230, 190, 110, 0.35) : rgba(40, 26, 12, 0.35);
        g.lineWidth = rng.range(1, 3);
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); g.stroke();
      }
      g.restore();
      g.strokeStyle = 'rgba(35,25,12,0.9)'; g.lineWidth = 3;
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.stroke();
    };
    const cx = w / 2;
    const base = [128, 92, 48];
    // vertebral row (top of texture = front of turtle = +z mapped to v=1)
    const rows = [0.2, 0.36, 0.52, 0.68, 0.82];
    rows.forEach((v, i) => {
      const y = h * v, hw = 22 - Math.abs(i - 2) * 3, hh = 18;
      scute([[cx - hw, y - hh * 0.6], [cx, y - hh], [cx + hw, y - hh * 0.6], [cx + hw, y + hh * 0.6], [cx, y + hh], [cx - hw, y + hh * 0.6]], base.map(c => c * rng.range(0.9, 1.1)));
    });
    // costal rows
    for (const s of [-1, 1]) {
      [0.28, 0.44, 0.6, 0.75].forEach(v => {
        const y = h * v, x0 = cx + s * 22, x1 = cx + s * 72;
        scute([[x0, y - 20], [x1, y - 16], [x1 + s * 4, y + 16], [x0, y + 20]], base.map(c => c * rng.range(0.85, 1.1)));
      });
    }
    // marginal ring
    g.strokeStyle = 'rgba(220,190,120,0.55)'; g.lineWidth = 7;
    g.beginPath(); g.ellipse(cx, h / 2, w * 0.43, h * 0.46, 0, 0, TAU); g.stroke();
  });
}

/** Cloud puff (alpha + density in red channel). Lumpy, cauliflower edge. */
export function puffTexture(seed) {
  const n = createNoise(seed);
  const S = 128;
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1;
      const r = Math.hypot(u, v);
      const nn = n.fbm2(u * 2.2 + 5, v * 2.2 - 3, 4) * 0.5 + 0.5;
      const edge = 1 - clamp((r - 0.42 - nn * 0.38) / 0.22, 0, 1);
      const a = clamp(edge, 0, 1) * clamp((1 - r) * 3, 0, 1);
      const dens = clamp(1 - r * 0.9 + (nn - 0.5) * 0.5, 0, 1);
      const i = (y * S + x) * 4;
      img.data[i] = dens * 255; img.data[i + 1] = nn * 255; img.data[i + 2] = 255; img.data[i + 3] = a * a * (3 - 2 * a) * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Dried fish (小鱼干) skin: golden-brown with a darker back and silvery flank. */
export function driedFishTexture() {
  return canvasTexture(128, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#7a3f12'); gr.addColorStop(0.4, '#d0791f'); gr.addColorStop(0.7, '#f0b04a'); gr.addColorStop(1, '#ffe2a0');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(80,45,15,0.35)'; g.lineWidth = 1;
    for (let x = 8; x < w; x += 7) { g.beginPath(); g.moveTo(x, 4); g.quadraticCurveTo(x + 4, h * 0.5, x, h - 4); g.stroke(); }
    g.fillStyle = '#1b120a'; g.beginPath(); g.arc(w * 0.88, h * 0.4, 3.2, 0, TAU); g.fill();
  });
}

/** Tiny lookup of tropical palettes. */
export const PALETTES = {
  bush: [[46, 112, 44], [64, 140, 52], [38, 96, 40], [82, 150, 60], [52, 124, 70]],
  bushDark: [[30, 84, 38], [40, 98, 44], [26, 70, 34], [54, 112, 48]],
  bushLight: [[96, 160, 60], [120, 176, 70], [80, 146, 56], [140, 186, 84]],
};

export { lerp };
