// 深蓝 · 珊瑚礁 — procedural green sea turtle: scute-patterned carapace, scaled skin, flying
// front-flipper strokes with glides, rudder rear flippers. Local frame: head toward +X, up +Y.
import * as THREE from 'three';
import { canvasTexture, createNoise, makeRng, clamp, lerp, smoothstep, TAU, makeCanvas } from '../../lib/util.js';
import { waterize } from './uw.js';

const L = 0.62, Wd = 0.5; // carapace half length / half width

/**
 * Tangent-space normal map from a height canvas with separate slope strengths along x and y (same
 * formula as lib normalMapFromHeight, clamped edges).
 */
function normalMapXY(heightCanvas, sx, sy) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h), og = out.getContext('2d'), img = og.createImageData(w, h);
  const H = (x, y) => src[(clamp(y, 0, h - 1) * w + clamp(x, 0, w - 1)) * 4] / 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (H(x + 1, y) - H(x - 1, y)) * sx, dy = (H(x, y + 1) - H(x, y - 1)) * sy;
    const len = Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
    img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
    img.data[i + 1] = ((dy / len) * 0.5 + 0.5) * 255;
    img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  og.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(out);
  tex.colorSpace = THREE.NoColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function shellTextures(seed) {
  const rng = makeRng(seed), n = createNoise(seed);
  // Power-of-two size: WebGL 1 (Safari 14) needs it for mipmaps and resized the old 640×512 shell
  // to 512×512 on every load. The shell is painted at 512×512 directly now (same normalised layout);
  // x keeps the normal-map slope it had at 640 px (strength 3 × 512 / 640), so the look is unchanged.
  const TW = 512, TH = 512;
  const seeds = [];
  [-0.7, -0.36, -0.02, 0.32, 0.64].forEach(x => seeds.push({ x, z: 0, k: 0 }));
  [-0.52, -0.18, 0.16, 0.48].forEach(x => { seeds.push({ x, z: 0.5, k: 1 }); seeds.push({ x, z: -0.5, k: 1 }); });
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    seeds.push({ x: Math.cos(a) * 0.98, z: Math.sin(a) * 0.92, k: 2 });
    if (i > 0 && i < 12) seeds.push({ x: Math.cos(a) * 0.98, z: -Math.sin(a) * 0.92, k: 2 });
  }
  seeds.forEach(s => { s.hue = rng.next(); s.dark = rng.next(); });
  const col = makeCanvas(TW, TH), hgt = makeCanvas(TW, TH);
  const cg = col.getContext('2d'), hg = hgt.getContext('2d');
  const ci = cg.createImageData(TW, TH), hi = hg.createImageData(TW, TH);
  const base = [[96, 70, 34], [122, 88, 40], [78, 60, 32], [140, 104, 48]];
  for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
    const X = (x / TW) * 2 - 1, Z = (y / TH) * 2 - 1;
    let d1 = 9, d2 = 9, b = null;
    for (const s of seeds) {
      const sx = (X - s.x) * (s.k === 2 ? 1.6 : 1), sz = (Z - s.z) * (s.k === 0 ? 1.25 : 1);
      const d = sx * sx + sz * sz;
      if (d < d1) { d2 = d1; d1 = d; b = s; } else if (d < d2) d2 = d;
    }
    const e = Math.sqrt(d2) - Math.sqrt(d1);
    const seam = 1 - smoothstep(0.0, 0.035, e);
    const ang = Math.atan2(Z - b.z, X - b.x), rr = Math.sqrt(d1);
    const streak = n.noise2(ang * 2.2 + b.hue * 10, rr * 1.5) * 0.6 + n.noise2(ang * 6 + b.hue * 7, rr * 4) * 0.4;
    const c0 = base[Math.floor(b.hue * base.length)];
    let r = c0[0], g = c0[1], bb = c0[2];
    const amber = smoothstep(0.1, 0.5, streak), dark = smoothstep(-0.1, -0.5, streak);
    r = lerp(r, 196, amber * 0.7); g = lerp(g, 140, amber * 0.7); bb = lerp(bb, 54, amber * 0.7);
    r = lerp(r, 40, dark * 0.75); g = lerp(g, 30, dark * 0.75); bb = lerp(bb, 18, dark * 0.75);
    const k = 0.85 + rr * 0.3;
    r *= k; g *= k; bb *= k;
    r = lerp(r, 58, seam * 0.8); g = lerp(g, 48, seam * 0.8); bb = lerp(bb, 34, seam * 0.8);
    const o = (y * TW + x) * 4;
    ci.data[o] = r; ci.data[o + 1] = g; ci.data[o + 2] = bb; ci.data[o + 3] = 255;
    const h = (1 - seam) * (0.6 + 0.4 * (1 - smoothstep(0, 0.5, rr))) * 255;
    hi.data[o] = hi.data[o + 1] = hi.data[o + 2] = h; hi.data[o + 3] = 255;
  }
  cg.putImageData(ci, 0, 0); hg.putImageData(hi, 0, 0);
  const map = new THREE.CanvasTexture(col); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
  const normalMap = normalMapXY(hgt, 3 * 512 / 640, 3);
  return { map, normalMap };
}

function skinTexture(seed) {
  const rng = makeRng(seed);
  const pts = [];
  for (let i = 0; i < 90; i++) pts.push([rng.next(), rng.next(), rng.next()]);
  const S = 256;
  return canvasTexture(S, S, (g) => {
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      let d1 = 9, d2 = 9, best = null;
      for (const p of pts) for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const dx = u - p[0] - ox, dy = v - p[1] - oy, d = dx * dx + dy * dy;
        if (d < d1) { d2 = d1; d1 = d; best = p; } else if (d < d2) d2 = d;
      }
      const e = Math.sqrt(d2) - Math.sqrt(d1);
      const border = 1 - smoothstep(0.004, 0.018, e);
      const t = best[2];
      let r = lerp(88, 128, t), gg = lerp(66, 92, t), b = lerp(40, 52, t);
      r = lerp(r, 214, border); gg = lerp(gg, 196, border); b = lerp(b, 140, border);
      const o = (y * S + x) * 4;
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { repeat: true });
}

function flipperGeo(pts, depth) {
  const shape = new THREE.Shape();
  pts.forEach(([u, w], i) => (i ? shape.lineTo(u, w) : shape.moveTo(u, w)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.8, bevelSize: 0.012, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  // shape (u span, w chord, depth) -> turtle (x = w, y = depth, z = u)
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0));
  g.applyMatrix4(m);
  // thinner toward the tip
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const z = p.getZ(i); p.setY(i, p.getY(i) * (1 - clamp(z / 0.75, 0, 1) * 0.55)); }
  g.computeVertexNormals();
  // uv from planform
  const uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getZ(i) * 2.2, p.getX(i) * 2.2);
  return g;
}

export class Turtle {
  /**
   * `reuse`: another Turtle whose painted textures this one shares (with its own tint). Painting them
   * takes ~0.3-0.7 s of canvas loops, which froze the screen when a turtle was added from the "new
   * resident" button; at world creation every turtle still gets its own.
   */
  constructor(W, env, seed, reuse = null) {
    this.root = new THREE.Group();
    let tex, skin;
    if (reuse) { tex = { map: reuse.shellMap, normalMap: reuse.shellNormal }; skin = reuse.skinMap; this.textures = []; }
    else { tex = shellTextures(seed); skin = skinTexture(seed + 1); this.textures = [tex.map, tex.normalMap, skin]; }
    this.shellMap = tex.map; this.shellNormal = tex.normalMap; this.skinMap = skin;
    const shellMat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.48, metalness: 0, envMapIntensity: 0.8 });
    if (reuse) { const tr = makeRng(seed + 7); shellMat.color.setRGB(tr.range(0.86, 1.05), tr.range(0.88, 1.04), tr.range(0.82, 1.0)); }
    const skinMat = new THREE.MeshStandardMaterial({ map: skin, roughness: 0.62, metalness: 0, envMapIntensity: 0.5, side: THREE.DoubleSide });
    const plastMat = new THREE.MeshStandardMaterial({ color: '#d9cf9c', roughness: 0.6, envMapIntensity: 0.5 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.15, envMapIntensity: 1.2 });
    for (const m of [shellMat, skinMat, plastMat, eyeMat]) waterize(m, W, { key: 'turtle', rim: 1.0 });
    this.materials = [shellMat, skinMat, plastMat, eyeMat];

    // carapace (upper half) with top-down uv
    const top = new THREE.SphereGeometry(1, 48, 20, 0, TAU, 0, Math.PI / 2);
    const bot = new THREE.SphereGeometry(1, 48, 8, 0, TAU, Math.PI / 2, Math.PI / 2);
    for (const [g, hgt] of [[top, 0.25], [bot, 0.1]]) {
      const p = g.getAttribute('position'), uv = g.getAttribute('uv');
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const taper = x < 0 ? 1 - 0.28 * x * x : 1 - 0.1 * x * x;
        const keel = hgt > 0.2 ? 0.035 * Math.exp(-z * z * 30) * (1 - x * x) : 0;
        uv.setXY(i, x * 0.5 + 0.5, 1 - (z * 0.5 + 0.5));
        p.setXYZ(i, x * L, y * hgt + keel * Math.sign(y + 1e-3), z * Wd * taper);
      }
      g.computeVertexNormals();
    }
    const shell = new THREE.Mesh(top, shellMat);
    const plast = new THREE.Mesh(bot, plastMat);
    this.root.add(shell, plast);

    // neck + head
    this.headPivot = new THREE.Group();
    this.headPivot.position.set(L * 0.86, 0.0, 0);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.1, 0.2, 14, 1, true).rotateZ(Math.PI / 2).translate(0.07, 0, 0), skinMat);
    const headG = new THREE.SphereGeometry(1, 28, 18);
    { const p = headG.getAttribute('position');
      for (let i = 0; i < p.count; i++) { const x = p.getX(i); const k = x > 0.3 ? 1 - (x - 0.3) * 0.35 : 1; p.setXYZ(i, x * 0.15, p.getY(i) * 0.1 * k, p.getZ(i) * 0.105 * k); }
      headG.computeVertexNormals(); }
    const head = new THREE.Mesh(headG, skinMat);
    head.position.set(0.22, 0.015, 0);
    const eyeG = new THREE.SphereGeometry(0.022, 10, 8);
    for (const s of [1, -1]) { const e = new THREE.Mesh(eyeG, eyeMat); e.position.set(0.29, 0.04, s * 0.075); this.headPivot.add(e); }
    this.headPivot.add(neck, head);
    this.root.add(this.headPivot);

    // flippers
    const front = flipperGeo([[0, 0.08], [0.12, 0.1], [0.3, 0.09], [0.5, 0.05], [0.66, -0.02], [0.76, -0.1], [0.66, -0.09], [0.46, -0.07], [0.22, -0.07], [0, -0.06]], 0.016);
    const rear = flipperGeo([[0, 0.06], [0.1, 0.07], [0.22, 0.05], [0.29, -0.01], [0.25, -0.07], [0.12, -0.08], [0, -0.06]], 0.012);
    const mk = (geo, x, y, z, side) => {
      const piv = new THREE.Group();
      piv.position.set(x, y, z);
      const m = new THREE.Mesh(geo, skinMat);
      if (side < 0) m.scale.z = -1;
      piv.add(m);
      this.root.add(piv);
      return piv;
    };
    this.fr = mk(front, 0.26, -0.03, Wd * 0.62, 1);
    this.fl = mk(front, 0.26, -0.03, -Wd * 0.62, -1);
    this.rr = mk(rear, -0.46, -0.03, Wd * 0.42, 1);
    this.rl = mk(rear, -0.46, -0.03, -Wd * 0.42, -1);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.14, 8).rotateZ(Math.PI / 2).translate(-0.06, 0, 0), skinMat);
    tail.position.set(-L * 0.95, -0.02, 0);
    this.root.add(tail);
    this.root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.phase = 0;
    this.glide = 0;
  }
  /** stroke: 0 (glide) .. 1 (full power); speed scales the beat. */
  animate(dt, t, stroke, beat = 1) {
    this.glide = lerp(this.glide, 1 - stroke, 1 - Math.exp(-1.5 * dt));
    const amp = 1 - this.glide;
    this.phase += dt * TAU / 3.4 * beat * (0.35 + 0.65 * amp);
    const ph = this.phase;
    const flap = Math.sin(ph) * 0.8 * amp + 0.12 * this.glide;
    const sweep = Math.cos(ph) * 0.38 * amp - 0.2 - 0.55 * this.glide;
    const feather = -Math.cos(ph) * 0.45 * amp;
    this.fr.rotation.set(flap, sweep, feather);
    this.fl.rotation.set(-flap, -sweep, feather);
    const rr = Math.sin(ph * 1 + 1.2) * 0.25 * amp;
    this.rr.rotation.set(0.25 + rr, -0.5, 0);
    this.rl.rotation.set(-0.25 - rr, 0.5, 0);
    this.headPivot.rotation.set(0, Math.sin(t * 0.27) * 0.22, Math.sin(ph) * 0.05 * amp + Math.sin(t * 0.19) * 0.06);
    // body bobs with the power stroke
    return Math.sin(ph - 0.6) * 0.03 * amp;
  }
  dispose() {
    this.textures.forEach(t => t.dispose());
  }
}
