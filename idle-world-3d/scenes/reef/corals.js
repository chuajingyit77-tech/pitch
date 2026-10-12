// 深蓝 · 珊瑚礁 — the living reef: staghorn thickets, brain corals, table and shelf corals, sea fans,
// soft tree corals, tube sponges, anemones, seagrass and kelp, starfish, urchins and rubble.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createNoise, clamp, lerp, smoothstep, TAU, canvasTexture, makeRng, patchMaterial } from '../../lib/util.js';
import { waterize, addDetail, addFluor, addSway } from './uw.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _e = new THREE.Euler(), _n = new THREE.Vector3(), _c = new THREE.Color();
const C = h => new THREE.Color(h);

/** Write per-vertex colour and fluorescence. fn(x, y, z, i) -> [Color, fluor] */
function paint(g, fn) {
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 3), fl = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const [c, f] = fn(p.getX(i), p.getY(i), p.getZ(i), i);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; fl[i] = f;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aFluor', new THREE.BufferAttribute(fl, 1));
  return g;
}
const strip = g => { g.deleteAttribute('uv'); return g; };
function stdMat(W, opts, { caustics = true, key } = {}) {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, envMapIntensity: 0.35, ...opts });
  waterize(m, W, { caustics, key });
  return m;
}
/** pad: how far (m) the vertex shader can push geometry out of its rest pose (surge sway), so the
 *  culling sphere never drops a swaying tip that is still on screen. */
function instanced(geo, mat, list, { shadow = true, receive = true, pad = 0 } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  list.forEach((it, i) => {
    im.setMatrixAt(i, _m.compose(it.pos, it.quat, it.scale));
    if (it.color) im.setColorAt(i, it.color);
  });
  im.count = list.length;
  im.castShadow = shadow; im.receiveShadow = receive;
  im.computeBoundingSphere();
  if (pad && im.boundingSphere && im.boundingSphere.radius > 0) im.boundingSphere.radius += pad;
  return im;
}
/** Does the shell's scene pass have MSAA? Mirrors app.js (every quality tier asks for samples; the
 *  device may not support them for the HDR format, in which case the shell falls back to FXAA). */
function sceneMSAA(renderer) {
  try {
    if (!renderer || !renderer.capabilities.isWebGL2 || !(renderer.capabilities.maxSamples > 0)) return false;
    const gl = renderer.getContext();
    const half = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
    const s = gl.getInternalformatParameter(gl.RENDERBUFFER, half ? gl.RGBA16F : gl.RGBA8, gl.SAMPLES);
    return !!(s && s.length && Math.max(...s) > 0);
  } catch (e) { return false; }
}
/**
 * Alpha-tested lace (sea fans, feather stars, kelp): the painted lines are thinner than a pixel at a
 * distance, so their mip-averaged alpha hovers around the cutoff and they sparkle and vanish as they
 * sway. With MSAA the material manages its own alpha-to-coverage (the shell then leaves it alone):
 * near, a sharpened one-pixel edge; far, where the mip has averaged the lines away, the mip alpha is
 * the lace's real coverage and goes to the samples as is, so distant fans read as soft, steady lace
 * instead of a threshold flickering on and off. Without MSAA the alpha is scaled up with the mip level
 * so the lace keeps its coverage under the plain cutoff. alphaTest itself is unchanged (same shadows).
 */
function stableCutout(mat, tex, env) {
  const img = tex.image || { width: 256, height: 256 };
  const msaa = sceneMSAA(env.renderer);
  if (msaa) mat.alphaToCoverage = true;
  return patchMaterial(mat, {
    key: 'cutoutlod' + (msaa ? 'a2c' : ''),
    uniforms: { uTexSize: { value: new THREE.Vector2(img.width, img.height) } },
    fragmentHeader: 'uniform vec2 uTexSize;',
    fragment: {
      '#include <alphatest_fragment>': `
        float cutLod = 0.0, cutCov = 1.0;
        #ifdef USE_MAP
        { vec2 tp = vMapUv * uTexSize;
          cutLod = max(0.0, 0.5 * log2(max(max(dot(dFdx(tp), dFdx(tp)), dot(dFdy(tp), dFdy(tp))), 1e-8))); }
        #endif
        #ifdef USE_ALPHATEST
        ${msaa ? `cutCov = mix(clamp((diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 1e-4) + 0.5, 0.0, 1.0),
                     clamp(diffuseColor.a, 0.0, 1.0), smoothstep(0.75, 2.25, cutLod));
        if (cutCov < 0.02) discard;` : `diffuseColor.a *= 1.0 + cutLod * 0.3;
        if (diffuseColor.a < alphaTest) discard;`}
        #endif`,
      ...(msaa ? { '#include <opaque_fragment>': '#include <opaque_fragment>\n\tgl_FragColor.a = cutCov;' } : {}),
    },
  });
}
/** Quaternion that stands an object on a surface with normal n (blend toward up), plus spin. */
function standOn(n, spin, upright = 0.5, out = new THREE.Quaternion()) {
  _n.copy(n).lerp(_up, upright).normalize();
  out.setFromUnitVectors(_up, _n);
  _q2.setFromAxisAngle(_up, spin);
  return out.multiply(_q2);
}

/* ------------------------------------------------------------------ */
/* Geometry builders                                                   */
/* ------------------------------------------------------------------ */
function staghornGeo(rng, base, tip, maxD = 4) {
  const segs = [], tips = [];
  const grow = (a, dir, len, r, d) => {
    const b = a.clone().addScaledVector(dir, len);
    segs.push({ a, b, r0: r, r1: r * 0.84, d });
    if (d >= maxD || r < 0.012) { tips.push({ p: b, r: r * 0.86 }); return; }
    const nk = rng.chance(0.3) ? 3 : 2;
    for (let k = 0; k < nk; k++) {
      const axis = rng.onSphere(new THREE.Vector3()).cross(dir).normalize();
      const ang = k === 0 ? rng.range(0.05, 0.25) : rng.range(0.45, 0.9);
      const nd = dir.clone().applyAxisAngle(axis, ang);
      nd.y += 0.2; nd.normalize();
      grow(b, nd, len * rng.range(0.74, 0.92), r * 0.79, d + 1);
    }
  };
  const trunks = rng.int(6, 9);
  for (let t = 0; t < trunks; t++) {
    const a = (t / trunks) * TAU + rng.range(-0.4, 0.4);
    const sp = rng.range(0.35, 1.0);
    const dir = new THREE.Vector3(Math.cos(a) * sp, 1, Math.sin(a) * sp).normalize();
    grow(new THREE.Vector3(Math.cos(a) * 0.06, -0.06, Math.sin(a) * 0.06), dir, rng.range(0.24, 0.34), rng.range(0.045, 0.06), 0);
  }
  const parts = [];
  const dir = new THREE.Vector3();
  for (const s of segs) {
    dir.subVectors(s.b, s.a); const len = dir.length(); dir.divideScalar(len);
    const e = s.r0 * 0.7;
    const g = new THREE.CylinderGeometry(s.r1, s.r0, len + e, 5, 1, true);
    g.translate(0, (len - e) / 2, 0);
    g.applyQuaternion(_q.setFromUnitVectors(_up, dir));
    g.translate(s.a.x, s.a.y, s.a.z);
    const d0 = s.d;
    paint(strip(g), (x, y, z, i) => {
      const lt = (i / g.getAttribute('position').count);
      const t = clamp((d0 + 0.5) / (maxD + 1), 0, 1);
      return [_c.copy(base).lerp(tip, Math.pow(t, 1.6)).clone(), Math.pow(t, 2) * 0.6];
    });
    parts.push(g);
  }
  for (const tp of tips) {
    const g = new THREE.SphereGeometry(tp.r * 1.1, 5, 3);
    g.translate(tp.p.x, tp.p.y, tp.p.z);
    paint(strip(g), () => [tip, 1]);
    parts.push(g);
  }
  const g = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  g.computeBoundingSphere();
  return g;
}

function brainGeo(seed) {
  const g = strip(new THREE.SphereGeometry(1, 56, 22, 0, TAU, 0, Math.PI * 0.62));
  const n = createNoise(seed);
  const p = g.getAttribute('position'), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const k = 1 + n.noise3(v.x * 1.4, v.y * 1.4, v.z * 1.4) * 0.07;
    p.setXYZ(i, v.x * k, (v.y * 0.8 - 0.06) * k, v.z * k);
  }
  g.computeVertexNormals();
  paint(g, (x, y) => [C('#ffffff'), 0.7]);
  return g;
}

/** Plate coral: a slightly cupped, uneven disc with a rim, optionally on a stalk. */
function tableGeo(seed, { stalk = true, NS = 56, NR = 9, top = '#6a5c3a', rim = '#a89870', under = '#3a3024' } = {}) {
  const n = createNoise(seed);
  const R = [];
  for (let k = 0; k <= NS; k++) { const a = (k / NS) * TAU; R.push(1 + n.noise2(Math.cos(a) * 1.3, Math.sin(a) * 1.3) * 0.13 + n.noise2(Math.cos(a) * 4, Math.sin(a) * 4) * 0.04); }
  const pos = [], col = [], fl = [], idx = [];
  const cTop = C(top), cRim = C(rim), cUnder = C(under);
  const surf = (j, k, under) => {
    const a = (k / NS) * TAU, rr = (j / NR) * R[k];
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    let y = 0.07 * rr * rr + n.noise2(x * 2.2, z * 2.2) * 0.025;
    if (under) y -= 0.075 * (1 - rr * 0.75) + 0.018;
    return [x, y, z, rr];
  };
  for (const under of [false, true]) {
    const base = pos.length / 3;
    for (let j = 0; j <= NR; j++) for (let k = 0; k <= NS; k++) {
      const [x, y, z, rr] = surf(j, k, under);
      pos.push(x, y, z);
      const t = j / NR;
      _c.copy(under ? cUnder : cTop).lerp(cRim, under ? smoothstep(0.85, 1, t) * 0.6 : smoothstep(0.55, 1, t));
      col.push(_c.r, _c.g, _c.b); fl.push(under ? 0 : smoothstep(0.6, 1, t));
    }
    for (let j = 0; j < NR; j++) for (let k = 0; k < NS; k++) {
      const a = base + j * (NS + 1) + k, b = a + 1, c = a + NS + 1, d = c + 1;
      if (!under) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  // rim band
  const off = (NR + 1) * (NS + 1);
  for (let k = 0; k < NS; k++) {
    const a = NR * (NS + 1) + k, b = a + 1, c = off + NR * (NS + 1) + k, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aFluor', new THREE.Float32BufferAttribute(fl, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (stalk) {
    const s = strip(new THREE.CylinderGeometry(0.13, 0.2, 0.7, 10, 3, false));
    const sp = s.getAttribute('position');
    for (let i = 0; i < sp.count; i++) { const y = sp.getY(i); const k = 1 + smoothstep(0.1, 0.35, y) * 0.8; sp.setX(i, sp.getX(i) * k); sp.setZ(i, sp.getZ(i) * k); }
    s.translate(0, -0.33, 0);
    s.computeVertexNormals();
    paint(s, () => [cUnder, 0]);
    g = mergeGeometries([g, s]);
  }
  g.computeBoundingSphere();
  return g;
}

function fanTexture(seed) {
  const rng = makeRng(seed);
  return canvasTexture(512, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const pts = [];
    const inFan = (x, y) => { const dx = (x - w / 2) / (w * 0.48), dy = (h - 8 - y) / (h * 0.92); return dy > 0 && dx * dx + (dy - 0.45) * (dy - 0.45) / 0.3 < 1 && dx * dx + dy * dy < 1; };
    const br = (x, y, ang, len, wid, d) => {
      let cx = x, cy = y, a = ang;
      const steps = 5;
      for (let s = 0; s < steps; s++) {
        a += rng.range(-0.1, 0.1);
        const nx = cx + (Math.cos(a) * len) / steps, ny = cy - (Math.sin(a) * len) / steps;
        if (!inFan(nx, ny)) return;
        const ww = wid * (1 - (s / steps) * 0.2);
        g.lineWidth = ww;
        const shade = Math.round(lerp(185, 255, clamp(d / 7, 0, 1)));
        g.strokeStyle = `rgb(${shade},${shade},${shade})`;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(nx, ny); g.stroke();
        cx = nx; cy = ny;
        pts.push([cx, cy, ww]);
      }
      if (d < 8 && len > 6) {
        const spread = rng.range(0.22, 0.5);
        br(cx, cy, a + spread, len * rng.range(0.74, 0.9), Math.max(1.2, wid * 0.72), d + 1);
        br(cx, cy, a - spread, len * rng.range(0.74, 0.9), Math.max(1.2, wid * 0.72), d + 1);
      }
    };
    br(w / 2, h - 4, Math.PI / 2 + rng.range(-0.1, 0.1), h * 0.2, 11, 0);
    br(w / 2, h - 30, Math.PI / 2 + 0.55, h * 0.18, 7, 1);
    br(w / 2, h - 30, Math.PI / 2 - 0.55, h * 0.18, 7, 1);
    // anastomosing mesh between neighbouring twigs
    g.strokeStyle = 'rgb(235,235,235)';
    for (let i = 0; i < pts.length; i += 1) {
      const [x, y] = pts[i];
      let best = -1, bd = 1e9, best2 = -1, bd2 = 1e9;
      for (let j = 0; j < pts.length; j++) {
        if (Math.abs(i - j) < 3) continue;
        const d = (pts[j][0] - x) ** 2 + (pts[j][1] - y) ** 2;
        if (d < bd) { bd2 = bd; best2 = best; bd = d; best = j; } else if (d < bd2) { bd2 = d; best2 = j; }
      }
      for (const [b, dd] of [[best, bd], [best2, bd2]]) {
        if (b < 0 || dd > 26 * 26) continue;
        g.lineWidth = 1.3;
        g.beginPath(); g.moveTo(x, y); g.lineTo(pts[b][0], pts[b][1]); g.stroke();
      }
    }
  }, { srgb: true });
}

function anemoneTentacleGeo(len = 0.3) {
  const g = strip(new THREE.CylinderGeometry(0.014, 0.026, len, 5, 4, true));
  g.translate(0, len / 2, 0);
  const tipG = strip(new THREE.SphereGeometry(0.02, 5, 3));
  tipG.translate(0, len, 0);
  const merged = mergeGeometries([g, tipG]);
  g.dispose(); tipG.dispose();
  // gentle curl so a bunch looks soft
  const p = merged.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setX(i, p.getX(i) + Math.pow(y / len, 2) * 0.05); }
  merged.computeVertexNormals();
  return merged;
}

function softCoralGeo(rng, stem, blossom) {
  // Carnation tree coral: a translucent trunk, a few branches, each ending in a lumpy
  // cauliflower crown of polyp clusters.
  const parts = [];
  const nn = createNoise(Math.floor(rng.next() * 1e6));
  const trunkH = rng.range(0.3, 0.46);
  const tr = strip(new THREE.CylinderGeometry(0.04, 0.08, trunkH, 8, 3, false));
  tr.translate(0, trunkH / 2, 0);
  paint(tr, () => [stem, 0.1]);
  parts.push(tr);
  const nb = rng.int(5, 8);
  for (let b = 0; b < nb; b++) {
    const a = (b / nb) * TAU + rng.range(-0.3, 0.3);
    const h0 = trunkH * rng.range(0.45, 0.95);
    const dir = new THREE.Vector3(Math.cos(a) * rng.range(0.6, 1.1), rng.range(0.7, 1.25), Math.sin(a) * rng.range(0.6, 1.1)).normalize();
    const L = rng.range(0.14, 0.28);
    const br = strip(new THREE.CylinderGeometry(0.014, 0.026, L, 6, 1, true));
    br.translate(0, L / 2, 0);
    br.applyQuaternion(_q.setFromUnitVectors(_up, dir));
    br.translate(0, h0, 0);
    paint(br, () => [stem, 0.1]);
    parts.push(br);
    const end = new THREE.Vector3(0, h0, 0).addScaledVector(dir, L);
    const R = rng.range(0.07, 0.12);
    const crown = strip(new THREE.SphereGeometry(1, 12, 9));
    const p = crown.getAttribute('position'), v = new THREE.Vector3();
    const off = rng.range(0, 100);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const k = 1 + nn.noise3(v.x * 2.6 + off, v.y * 2.6, v.z * 2.6) * 0.32 + nn.noise3(v.x * 6 + off, v.y * 6, v.z * 6) * 0.12;
      p.setXYZ(i, end.x + v.x * R * k, end.y + (v.y * 0.8 + 0.25) * R * k, end.z + v.z * R * k);
    }
    crown.computeVertexNormals();
    const cc = blossom.clone().offsetHSL(rng.range(-0.02, 0.02), 0, rng.range(-0.06, 0.05));
    paint(crown, (x, y) => [_c.copy(cc).multiplyScalar(lerp(0.75, 1.1, clamp((y - end.y) / R * 0.5 + 0.5, 0, 1))).clone(), 0.8]);
    parts.push(crown);
  }
  const g = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  g.computeBoundingSphere();
  return g;
}

function spongeGeo(rng, color) {
  const parts = [];
  const n = rng.int(3, 6);
  for (let i = 0; i < n; i++) {
    const h = rng.range(0.35, 0.85), r = rng.range(0.06, 0.1);
    const g = strip(new THREE.CylinderGeometry(r * 1.25, r * 0.85, h, 14, 4, true));
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) { const y = p.getY(k) / h + 0.5; const fl = 1 + smoothstep(0.75, 1, y) * 0.25; p.setX(k, p.getX(k) * fl); p.setZ(k, p.getZ(k) * fl); }
    g.translate(0, h / 2 - 0.04, 0);
    const a = (i / n) * TAU + rng.range(-0.4, 0.4), off = i === 0 ? 0 : rng.range(0.08, 0.16);
    g.applyQuaternion(_q.setFromEuler(_e.set(Math.sin(a) * 0.18, 0, -Math.cos(a) * 0.18)));
    g.translate(Math.cos(a) * off, 0, Math.sin(a) * off);
    g.computeVertexNormals();
    const cc = color.clone().offsetHSL(0, 0, rng.range(-0.06, 0.06));
    paint(g, (x, y) => [_c.copy(cc).multiplyScalar(lerp(0.65, 1.1, clamp(y / h, 0, 1))).clone(), 0.3]);
    parts.push(g);
  }
  const g = mergeGeometries(parts);
  parts.forEach(p => p.dispose());
  g.computeBoundingSphere();
  return g;
}

function starGeo() {
  const shape = new THREE.Shape();
  const N = 5, R = 1, r = 0.34, S = 80;
  for (let i = 0; i <= S; i++) {
    const a = (i / S) * TAU + Math.PI / 2;
    const k = Math.cos(a * N - Math.PI * N / 2) * 0.5 + 0.5;
    const rad = r + (R - r) * Math.pow(k, 2.4);
    const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.11, bevelSize: 0.1, bevelSegments: 3, curveSegments: 4 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0.1, 0);
  strip(g);
  // squash the arms so they hug the ground
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const rr = Math.hypot(p.getX(i), p.getZ(i)); p.setY(i, p.getY(i) * (1 - rr * 0.55)); }
  g.computeVertexNormals();
  paint(g, () => [C('#ffffff'), 0.4]);
  return g;
}

function kelpTexture(seed) {
  const rng = makeRng(seed);
  return canvasTexture(128, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgb(120,96,40)';
    g.fillRect(w / 2 - 3, 0, 6, h);
    for (let y = h - 20; y > 10; y -= rng.range(26, 40)) {
      const side = rng.chance(0.5) ? 1 : -1;
      const L = rng.range(40, 58), Wd = rng.range(9, 14);
      g.save();
      g.translate(w / 2, y);
      g.rotate(side * rng.range(0.5, 0.9) - Math.PI / 2 * 0);
      const grd = g.createLinearGradient(0, 0, side * L, 0);
      grd.addColorStop(0, 'rgb(150,120,45)'); grd.addColorStop(1, 'rgb(200,170,70)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(side * L * 0.5, -Wd, side * L, -4);
      g.quadraticCurveTo(side * L * 0.5, Wd * 0.6, 0, 0);
      g.fill();
      g.fillStyle = 'rgb(170,140,50)';
      g.beginPath(); g.arc(side * 6, -1, 4, 0, TAU); g.fill();
      g.restore();
    }
  }, { srgb: true });
}

/* ------------------------------------------------------------------ */
/* Detail shaders                                                      */
/* ------------------------------------------------------------------ */
const BRAIN_GLSL = /* glsl */`
float detailH(vec3 p){
  vec3 q = p * 2.1;
  q += 0.6 * vec3(snoise(q * 0.45), snoise(q * 0.45 + 11.3), snoise(q * 0.45 + 23.1));
  float n = snoise(q) + 0.22 * snoise(q * 2.1 + 5.0);
  float k = n * 2.3;
  float w = fwidth(k);
  float ridge = 0.5 + 0.5 * cos(k * 6.2831853);
  ridge = mix(ridge, 0.5, smoothstep(0.1, 0.35, w));
  float d = length(vUwPos - cameraPosition);
  return (ridge * 0.014 - 0.007) * (1.0 - smoothstep(12.0, 30.0, d));
}
vec3 detailCol(vec3 p, float h, vec3 c){
  float r = smoothstep(-0.006, 0.006, h);
  vec3 groove = c * vec3(0.5, 0.58, 0.42);
  vec3 ridge = c * 1.1 + vec3(0.02, 0.03, 0.01);
  return mix(groove, ridge, r);
}
`;
const POLYP_GLSL = /* glsl */`
// Fine polyp texture as anti-aliased colour only (derivative bumps of high-frequency patterns
// shade in 2x2 blocks); a gentle low-frequency bump keeps the surface lumpy.
float detailH(vec3 p){ return snoise(p * 6.0) * 0.006; }
vec3 detailCol(vec3 p, float h, vec3 c){
  vec2 q = p.xz * 18.0 + p.y * 13.0;
  float aa = 1.0 - smoothstep(0.15, 0.45, length(fwidth(q)));
  vec2 cc = cell2(q);
  float dots = smoothstep(0.42, 0.12, cc.x);
  return c * (0.92 + (dots - 0.45) * 0.2 * aa) * (0.92 + h * 12.0);
}
`;
const TABLE_GLSL = /* glsl */`
float detailH(vec3 p){ return snoise(p * 4.0) * 0.006; }
vec3 detailCol(vec3 p, float h, vec3 c){
  float a = atan(p.z, p.x);
  vec2 q = p.xz * 22.0;
  float aa = 1.0 - smoothstep(0.2, 0.55, length(fwidth(q)));
  // the 70 radial ridges converge at the centre: fade them where they get closer than ~2 px
  float aas = 1.0 - smoothstep(0.6, 1.6, 70.0 * length(fwidth(p.xz)) / max(length(p.xz), 1e-3));
  float st = mix(0.5, sin(a * 70.0 + snoise(p * 3.0) * 4.0) * 0.5 + 0.5, aas);
  float cells = smoothstep(0.05, 0.4, cell2(q).x);
  vec3 col = c * (0.78 + (st * 0.12 + cells * 0.2) * aa + h * 20.0);
  return col * (0.8 + 0.3 * (snoise(p * 2.5) * 0.5 + 0.5));
}
`;
const STAR_GLSL = /* glsl */`
float detailH(vec3 p){
  vec2 c = cell2(p.xz * 9.0 + p.y * 3.0);
  return (1.0 - smoothstep(0.0, 0.3, c.x)) * 0.05;
}
vec3 detailCol(vec3 p, float h, vec3 c){ return mix(c, c * 1.35 + 0.05, h * 15.0); }
`;
const SPONGE_GLSL = /* glsl */`
float detailH(vec3 p){ return snoise(p * 5.0) * 0.006; }
vec3 detailCol(vec3 p, float h, vec3 c){
  vec2 q = vec2(atan(p.z, p.x) * 6.0, p.y * 30.0);
  float aa = 1.0 - smoothstep(0.2, 0.55, length(fwidth(q)));
  float pores = smoothstep(0.25, 0.0, cell2(q).x);
  return c * (1.0 - pores * 0.45 * aa) * (0.9 + h * 15.0);
}
`;

/* ------------------------------------------------------------------ */
/* More reef dwellers: giant clams, feather stars, barrel sponges,      */
/* mushroom corals                                                      */
/* ------------------------------------------------------------------ */
function clamShellGeo() {
  const g = strip(new THREE.SphereGeometry(1, 36, 8, 0, TAU, Math.PI / 2, Math.PI / 2));
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.atan2(z, x), rim = 1 - Math.abs(y);
    const rib = 1 + 0.07 * Math.abs(Math.sin(a * 5));
    p.setXYZ(i, x * rib, y * 0.55 + Math.pow(rim, 5) * 0.09 * Math.sin(a * 10), z * 0.62 * rib);
  }
  g.computeVertexNormals();
  paint(g, (x, y) => [_c.set('#d8d2c0').multiplyScalar(lerp(0.55, 1.0, clamp(y + 0.6, 0, 1))).clone(), 0]);
  return g;
}
function clamMantleGeo() {
  const NR = 7, NS = 40, pos = [], idx = [], col = [], fl = [];
  for (let j = 0; j <= NR; j++) for (let k = 0; k <= NS; k++) {
    const r = j / NR, a = (k / NS) * TAU;
    const x = Math.cos(a) * r * 0.97, z = Math.sin(a) * r * 0.58;
    const y = 0.02 + 0.05 * r * r + Math.pow(r, 4) * 0.075 * Math.sin(a * 10) - (1 - r) * 0.03;
    pos.push(x, y, z);
    const slit = Math.exp(-(z * z) / 0.004) * (1 - smoothstep(0.25, 0.45, Math.abs(x)));
    const k2 = 1 - slit * 0.8;
    col.push(k2, k2, k2); fl.push(r);
  }
  for (let j = 0; j < NR; j++) for (let k = 0; k < NS; k++) {
    const a = j * (NS + 1) + k, b = a + 1, c = a + NS + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aFluor', new THREE.Float32BufferAttribute(fl, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const CLAM_GLSL = /* glsl */`
float detailH(vec3 p){ return 0.0; }
vec3 detailCol(vec3 p, float h, vec3 c){
  float w = sin(p.x * 18.0 + snoise(p * 5.0) * 3.0) * 0.5 + 0.5;
  vec2 q = p.xz * vec2(16.0, 22.0);
  float aa = 1.0 - smoothstep(0.2, 0.55, length(fwidth(q)));
  float spots = smoothstep(0.3, 0.05, cell2(q).x) * aa;
  vec3 col = c * (0.7 + 0.5 * w);
  col = mix(col, vec3(0.75, 0.95, 1.0), spots * 0.55);
  col = mix(col, c * 0.25, smoothstep(0.82, 0.97, length(p.xz * vec2(1.0, 1.7))) * 0.6);
  return col;
}
`;

function featherTexture(seed) {
  const rng = makeRng(seed);
  return canvasTexture(64, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#fff'; g.lineCap = 'round';
    g.lineWidth = 4;
    g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 4); g.stroke();
    g.lineWidth = 2;
    for (let y = h - 6; y > 6; y -= 5) {
      const L = (w / 2 - 3) * (0.55 + 0.45 * Math.sin((y / h) * Math.PI)) * rng.range(0.85, 1);
      for (const sd of [1, -1]) { g.beginPath(); g.moveTo(w / 2, y); g.lineTo(w / 2 + sd * L, y - 7); g.stroke(); }
    }
  }, { srgb: true });
}
function featherArmGeo() {
  const g = new THREE.PlaneGeometry(0.09, 1, 1, 8);
  g.translate(0, 0.5, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i);
    // arc outward then curl at the tip
    const ang = t * 1.6;
    const R = 0.42;
    p.setXYZ(i, p.getX(i), Math.sin(ang) * R + t * 0.25, (1 - Math.cos(ang)) * R);
  }
  g.computeVertexNormals();
  return g;
}

function barrelGeo(seed) {
  const prof = [[0.0, 0.0], [0.24, 0.0], [0.33, 0.22], [0.4, 0.55], [0.44, 0.85], [0.44, 0.93], [0.39, 0.96], [0.35, 0.88], [0.31, 0.6], [0.27, 0.42], [0.0, 0.4]]
    .map(([r, y]) => new THREE.Vector2(r, y));
  const g = strip(new THREE.LatheGeometry(prof, 30));
  const p = g.getAttribute('position');
  const nn = createNoise(seed);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const r = Math.hypot(x, z); if (r < 1e-4) continue;
    const a = Math.atan2(z, x);
    const k = 1 + (r > 0.3 ? 0.07 * Math.pow(Math.abs(Math.sin(a * 9 + y * 2)), 0.6) : 0) + nn.noise3(x * 3, y * 3, z * 3) * 0.05;
    p.setXYZ(i, x * k, y, z * k);
  }
  g.computeVertexNormals();
  paint(g, (x, y, z) => { const inner = Math.hypot(x, z) < 0.36 && y > 0.38; return [_c.setRGB(1, 1, 1).multiplyScalar(inner ? 0.45 : lerp(0.75, 1.05, y)).clone(), 0.2]; });
  return g;
}

function mushroomGeo() {
  const NR = 6, NS = 44, pos = [], idx = [], col = [], fl = [];
  for (let j = 0; j <= NR; j++) for (let k = 0; k <= NS; k++) {
    const r = j / NR, a = (k / NS) * TAU;
    const x = Math.cos(a) * r, z = Math.sin(a) * r * 0.8;
    const sept = Math.pow(Math.abs(Math.cos(a * 22)), 0.6) * 0.05 * r;
    const y = 0.22 * Math.pow(1 - r * r, 0.6) + sept;
    pos.push(x, y, z);
    const slit = Math.exp(-(z * z) / 0.003) * (1 - smoothstep(0.2, 0.35, Math.abs(x)));
    const v = (0.85 + sept * 3) * (1 - slit * 0.7);
    col.push(v, v, v); fl.push(0.6 + 0.4 * r);
  }
  for (let j = 0; j < NR; j++) for (let k = 0; k < NS; k++) {
    const a = j * (NS + 1) + k, b = a + 1, c = a + NS + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aFluor', new THREE.Float32BufferAttribute(fl, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Spatial hash for "is this spot free" checks while placing thousands of things. */
class Occupancy {
  constructor(cell = 0.6) { this.cell = cell; this.m = new Map(); this.maxR = 0.1; }
  key(i, j) { return (i + 2048) * 4096 + (j + 2048); }
  free(x, z, r, k = 0.85) {
    const R = r + this.maxR, c = this.cell;
    const i0 = Math.floor((x - R) / c), i1 = Math.floor((x + R) / c), j0 = Math.floor((z - R) / c), j1 = Math.floor((z + R) / c);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const l = this.m.get(this.key(i, j));
      if (l) for (const o of l) if (Math.hypot(o.x - x, o.z - z) < (o.r + r) * k) return false;
    }
    return true;
  }
  add(x, z, r) {
    const k = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    let l = this.m.get(k); if (!l) this.m.set(k, (l = []));
    l.push({ x, z, r }); this.maxR = Math.max(this.maxR, r);
  }
}

/* ------------------------------------------------------------------ */
/* Reef assembly                                                       */
/* ------------------------------------------------------------------ */
export function buildReef(ctx) {
  const { W, env, hm, ground, rocks, rng } = ctx;
  const q = Math.max(0.5, env.q);
  const group = new THREE.Group();
  const occ = new Occupancy(0.6);
  const curDir = W.uCurDir.value;
  const N = (n) => Math.round(n * q);

  // candidate spots on the reef surface and on the sand around it
  const reefSpots = [], sandSpots = [];
  const step = 0.3;
  for (let z = -17; z <= 17; z += step) for (let x = -17; x <= 17; x += step) {
    const px = x + rng.range(-0.12, 0.12), pz = z + rng.range(-0.12, 0.12);
    const y = hm.at(px, pz), gy = ground.height(px, pz), h = y - gy;
    if (h > 0.12) reefSpots.push({ x: px, y, z: pz, h, n: null });
    else if (Math.hypot(px, pz) < 16.5 && rocks.field(px, pz) > 0.02) sandSpots.push({ x: px, y: gy, z: pz, h: 0, n: null });
  }
  rng.shuffle(reefSpots); rng.shuffle(sandSpots);
  const nrm = s => s.n || (s.n = hm.normal(s.x, s.z, new THREE.Vector3(), 0.25));
  /** Try to take spots matching pred; returns spot or null. */
  const take = (list, pred, r, k = 0.85) => {
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.used || !pred(s) || !occ.free(s.x, s.z, r, k)) continue;
      s.used = true; occ.add(s.x, s.z, r);
      return s;
    }
    return null;
  };
  /** A spot at a given xz (for clusters). */
  const at = (x, z, r, k = 0.85) => {
    if (!occ.free(x, z, r, k)) return null;
    const y = hm.at(x, z), h = y - ground.height(x, z);
    occ.add(x, z, r);
    return { x, y, z, h, n: hm.normal(x, z, new THREE.Vector3(), 0.25) };
  };
  const bommies = rocks.bommies;
  const nearB = (s, d = 1.0) => bommies.some(b => Math.hypot(b.x - s.x, b.z - s.z) < b.r * d);

  /* ---- anemones (clownfish homes) ---- */
  const anemones = [];
  const mainB = bommies.find(b => b.main) || bommies[0];
  const nAn = Math.max(2, N(4));
  for (let k = 0; k < nAn; k++) {
    let s = null;
    if (k === 0) {
      // the main anemone sits high on the reef in front of the main coral head
      s = take(reefSpots, s2 => nrm(s2).y > 0.85 && s2.h > 1.0 && Math.hypot(s2.x - mainB.x, s2.z - mainB.z) < mainB.r * 1.6, 0.8);
    }
    if (!s) s = take(reefSpots, s2 => nrm(s2).y > 0.82 && s2.h > 0.5, 0.75);
    if (!s) continue;
    anemones.push({ pos: new THREE.Vector3(s.x, s.y - 0.05, s.z), r: k === 0 ? 0.55 : rng.range(0.38, 0.5), n: nrm(s).clone() });
  }

  /* ---- table corals: single plates on the reef and stacked tiers on coral heads ---- */
  const tableMat = stdMat(W, { vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }, { key: 'table' });
  addDetail(tableMat, W, { glsl: TABLE_GLSL, space: 'object', bump: 1, key: 'table' });
  addFluor(tableMat, W, '#7dff6a', 0.7, 'table');
  const tableG = tableGeo(env.seed ^ 31);
  const shelfG = tableGeo(env.seed ^ 57, { stalk: false, top: '#7b5e78', rim: '#d9b8d8', under: '#4a3448' });
  const tables = [], shelves = [];
  const tableCols = [C('#c8b898'), C('#a8b888'), C('#b8a0b8'), C('#98a8a0')];
  for (let i = N(7); i > 0; i--) {
    const s = take(reefSpots, s2 => nrm(s2).y > 0.75 && s2.h > 0.5, 1.0);
    if (!s) break;
    const r = rng.range(0.6, 1.0), lift = 0.42 * r;
    tables.push({ pos: new THREE.Vector3(s.x, s.y + lift, s.z), quat: _q.setFromEuler(_e.set(rng.range(-0.08, 0.08), rng.range(0, TAU), rng.range(-0.08, 0.08))).clone(), scale: new THREE.Vector3(r, r * 0.9, r), color: rng.pick(tableCols) });
    hm.addDisc(s.x, s.z, r, s.y + lift + 0.12);
  }
  // tiers: shelves stepping up the flanks of the coral heads
  for (const b of bommies) {
    const tiers = rng.int(2, 4) * (q > 0.6 ? 1 : 0.5);
    let a = rng.range(0, TAU);
    for (let t = 0; t < tiers; t++) {
      const yT = ground.height(b.x, b.z) + (b.top - ground.height(b.x, b.z)) * (0.35 + t * 0.2);
      a += rng.range(0.7, 1.5);
      // walk outward until we leave the rock at that height
      let rr = 0.3;
      while (rr < b.r * 1.6 && hm.at(b.x + Math.cos(a) * rr, b.z + Math.sin(a) * rr) > yT) rr += 0.1;
      const x = b.x + Math.cos(a) * (rr + 0.15), z = b.z + Math.sin(a) * (rr + 0.15);
      const r = rng.range(0.42, 0.7);
      shelves.push({ pos: new THREE.Vector3(x, yT, z), quat: _q.setFromEuler(_e.set(rng.range(-0.08, 0.08), -a, rng.range(0.02, 0.15))).clone(), scale: new THREE.Vector3(r * 1.2, r * 0.8, r), color: rng.pick([C('#ffffff'), C('#c8e0c0'), C('#f0d0b0'), C('#d0c0f0')]) });
    }
  }
  for (let i = N(14); i > 0; i--) {
    const s = take(reefSpots, s2 => { const n = nrm(s2); return n.y < 0.75 && n.y > 0.12 && s2.h > 0.4; }, 0.32);
    if (!s) break;
    const n = nrm(s), r = rng.range(0.32, 0.55);
    const out = _p.set(n.x, 0, n.z).normalize();
    const pos = new THREE.Vector3(s.x, s.y - 0.08, s.z).addScaledVector(out, r * 0.45);
    const yaw = Math.atan2(-out.z, out.x);
    shelves.push({ pos, quat: _q.setFromEuler(_e.set(rng.range(-0.1, 0.1), yaw, rng.range(0.05, 0.25))).clone(), scale: new THREE.Vector3(r, r * 0.8, r), color: rng.pick([C('#ffffff'), C('#c8e0c0'), C('#f0d0b0')]) });
  }
  group.add(instanced(tableG, tableMat, tables));
  group.add(instanced(shelfG, tableMat, shelves));

  /* ---- barrel sponges ---- */
  const barrelMat = stdMat(W, { vertexColors: true, roughness: 0.9 }, { key: 'barrel' });
  addDetail(barrelMat, W, { glsl: SPONGE_GLSL, space: 'object', bump: 1, key: 'barrel' });
  const barrels = [];
  for (let i = N(7); i > 0; i--) {
    const s = take(reefSpots, s2 => nrm(s2).y > 0.6 && s2.h < 1.8, 0.55) || take(sandSpots, () => true, 0.55);
    if (!s) break;
    const sc = rng.range(0.85, 1.45);
    barrels.push({ pos: new THREE.Vector3(s.x, s.y - 0.08, s.z), quat: standOn(nrm(s), rng.range(0, TAU), 0.7), scale: new THREE.Vector3(sc, sc * rng.range(0.9, 1.25), sc), color: rng.pick([C('#a0563c'), C('#8a4a52'), C('#b0703a'), C('#7a4a6a')]) });
    hm.addDisc(s.x, s.z, 0.45 * sc, s.y + 0.9 * sc);
  }
  group.add(instanced(barrelGeo(env.seed ^ 3), barrelMat, barrels));

  /* ---- giant clams ---- */
  const clamShellMat = stdMat(W, { vertexColors: true, roughness: 0.7 }, { key: 'clamshell' });
  const clamMantleMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0, iridescence: 0.9, iridescenceIOR: 1.5, iridescenceThicknessRange: [250, 650], clearcoat: 0.5, clearcoatRoughness: 0.25, envMapIntensity: 1.0, emissive: '#0a2a3a', emissiveIntensity: 0.6 });
  waterize(clamMantleMat, W, { key: 'clam' });
  addDetail(clamMantleMat, W, { glsl: CLAM_GLSL, space: 'object', bump: 0, key: 'clam' });
  addFluor(clamMantleMat, W, '#3ad8ff', 1.2, 'clam');
  const clams = [];
  const clamCols = [C('#2a7bff'), C('#14c8d8'), C('#3ad07a'), C('#7a5aff'), C('#1aa0ff'), C('#c0d830')];
  for (let i = N(11); i > 0; i--) {
    const s = take(reefSpots, s2 => nrm(s2).y > 0.7 && s2.h > 0.3, 0.3);
    if (!s) break;
    const sc = rng.range(0.2, 0.34);
    clams.push({ pos: new THREE.Vector3(s.x, s.y + 0.02, s.z), quat: standOn(nrm(s), rng.range(0, TAU), 0.4), scale: new THREE.Vector3(sc, sc, sc), color: rng.pick(clamCols) });
  }
  group.add(instanced(clamShellGeo(), clamShellMat, clams));
  group.add(instanced(clamMantleGeo(), clamMantleMat, clams, { shadow: false }));

  /* ---- staghorn thickets ---- */
  const stagPal = [
    [C('#9a6c3c'), C('#f6e2b0')], [C('#6a4a8e'), C('#dcb0ff')], [C('#3f6f98'), C('#86d8ff')], [C('#a85a72'), C('#ffb4cc')], [C('#77803a'), C('#dcf27e')], [C('#8a5a2a'), C('#ffcf7a')],
  ];
  const stagWeights = [0, 0, 5, 5, 1, 2, 3, 4, 4];
  const stagGeos = stagPal.map(([b, t], i) => staghornGeo(rng.fork('stag' + i), b, t));
  const stagMat = stdMat(W, { vertexColors: true, roughness: 0.72 }, { key: 'stag' });
  addDetail(stagMat, W, { glsl: POLYP_GLSL, space: 'object', bump: 1, key: 'polyp' });
  addFluor(stagMat, W, '#47ffb0', 0.7, 'stag');
  const stagLists = stagGeos.map(() => []);
  const thickets = [];
  for (let c = N(13); c > 0; c--) {
    const s0 = take(reefSpots, s2 => nrm(s2).y > 0.55, 0.55);
    if (!s0) break;
    const t = rng.pick(stagWeights);
    const n = rng.int(2, 5);
    const colonies = [s0];
    for (let k = 0; k < n * 3 && colonies.length < n; k++) {
      const a = rng.range(0, TAU), r = rng.range(0.6, 1.3);
      const s = at(s0.x + Math.cos(a) * r, s0.z + Math.sin(a) * r, 0.5);
      if (s && (s.h > 0.1 || rng.chance(0.3))) colonies.push(s);
    }
    for (const s of colonies) {
      const sc = rng.range(0.95, 1.5);
      stagLists[t].push({ pos: new THREE.Vector3(s.x, s.y - 0.05, s.z), quat: standOn(nrm(s), rng.range(0, TAU), 0.6), scale: new THREE.Vector3(sc, sc * rng.range(0.85, 1.15), sc), color: _c.setHSL(0, 0, rng.range(0.85, 1.05)).clone() });
      hm.addDisc(s.x, s.z, 0.5 * sc, s.y + 0.8 * sc);
    }
    thickets.push(new THREE.Vector3(s0.x, s0.y + 0.9, s0.z));
  }
  stagGeos.forEach((g, i) => group.add(instanced(g, stagMat, stagLists[i])));

  /* ---- brain and boulder corals ---- */
  const brainG = brainGeo(env.seed ^ 77);
  const brainMat = stdMat(W, { vertexColors: true, roughness: 0.8 }, { key: 'brain' });
  addDetail(brainMat, W, { glsl: BRAIN_GLSL, space: 'object', bump: 0.9, key: 'brain' });
  addFluor(brainMat, W, '#3dff8a', 0.55, 'brain');
  const brainCols = [C('#a8905a'), C('#7e8a52'), C('#a8785a'), C('#8f9a6a'), C('#c0a070'), C('#b0a060'), C('#8a7a9a')];
  const brains = [];
  for (let i = N(26); i > 0; i--) {
    const s = rng.chance(0.75) ? take(reefSpots, s2 => nrm(s2).y > 0.6, 0.5) : take(sandSpots, () => true, 0.5);
    if (!s) continue;
    const r = rng.range(0.32, 0.75);
    brains.push({ pos: new THREE.Vector3(s.x, s.y - 0.06, s.z), quat: standOn(nrm(s), rng.range(0, TAU), 0.5), scale: new THREE.Vector3(r, r * rng.range(0.75, 1.0), r * rng.range(0.9, 1.1)), color: rng.pick(brainCols).clone() });
    hm.addDisc(s.x, s.z, r, s.y + r * 0.7);
  }
  group.add(instanced(brainG, brainMat, brains));

  /* ---- sea fans (face the surge) ---- */
  const fanTex = fanTexture(env.seed ^ 99);
  const fanMat = new THREE.MeshStandardMaterial({ map: fanTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, envMapIntensity: 0.35 });
  waterize(fanMat, W, { key: 'fan' });
  addSway(fanMat, W, { height: 1.4, amount: 0.12, stiff: 1.4, flutter: 0.015, key: 'fan' });
  stableCutout(fanMat, fanTex, env);
  const fanG = new THREE.PlaneGeometry(1.5, 1.4, 6, 6);
  fanG.translate(0, 0.68, 0);
  const fans = [];
  const fanCols = [C('#b03cc8'), C('#d84aa8'), C('#9a3fe0'), C('#ff5a3a'), C('#ffb02a'), C('#e8303a'), C('#ff7a2a')];
  for (let i = N(26); i > 0; i--) {
    const s = rng.chance(0.8) ? take(reefSpots, s2 => nrm(s2).y > 0.4, 0.35) : take(sandSpots, () => true, 0.35);
    if (!s) continue;
    const sc = rng.range(0.8, 1.5);
    const yaw = Math.atan2(curDir.x, curDir.y) + rng.range(-0.35, 0.35);
    fans.push({ pos: new THREE.Vector3(s.x, s.y - 0.05, s.z), quat: _q.setFromEuler(_e.set(rng.range(-0.12, 0.12), yaw, rng.range(-0.1, 0.1))).clone(), scale: new THREE.Vector3(sc, sc * rng.range(0.85, 1.15), sc), color: rng.chance(0.4) ? rng.pick(fanCols.slice(0, 3)) : rng.pick(fanCols.slice(3)) });
  }
  group.add(instanced(fanG, fanMat, fans, { pad: 0.25 }));

  /* ---- soft tree corals ---- */
  const softMat = stdMat(W, { vertexColors: true, roughness: 0.6 }, { key: 'soft' });
  addDetail(softMat, W, { glsl: POLYP_GLSL, space: 'object', bump: 1.4, key: 'softpolyp' });
  addSway(softMat, W, { height: 0.6, amount: 0.06, stiff: 1.3, flutter: 0.01, key: 'soft' });
  addFluor(softMat, W, '#ff5aa0', 0.8, 'soft');
  const softDefs = [[C('#f1d6dc'), C('#ff3f7f')], [C('#f3e3d0'), C('#ff7a2a')], [C('#e8d8f0'), C('#b44ae8')], [C('#f6e8d8'), C('#ffcf3a')], [C('#f6dce0'), C('#e8203a')]];
  const softGeos = softDefs.map(([a, b], i) => softCoralGeo(rng.fork('soft' + i), a, b));
  const softLists = softGeos.map(() => []);
  for (let i = N(40); i > 0; i--) {
    const s = take(reefSpots, s2 => nrm(s2).y > 0.3, 0.3);
    if (!s) break;
    const sc = rng.range(1.0, 1.8);
    softLists[i % softGeos.length].push({ pos: new THREE.Vector3(s.x, s.y - 0.04, s.z), quat: standOn(nrm(s), rng.range(0, TAU), 0.55), scale: new THREE.Vector3(sc, sc, sc) });
  }
  softGeos.forEach((g, i) => group.add(instanced(g, softMat, softLists[i], { pad: 0.12 })));

  /* ---- encrusting mound corals (Porites lumps) fill the gaps with colour ---- */
  const moundG = (() => {
    const g = strip(new THREE.SphereGeometry(1, 18, 9, 0, TAU, 0, Math.PI * 0.55));
    const nn = createNoise(env.seed ^ 404), p = g.getAttribute('position'), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const k = 1 + nn.fbm3(v.x * 1.8, v.y * 1.8, v.z * 1.8, 3) * 0.28;
      p.setXYZ(i, v.x * k, (v.y * 0.75 - 0.05) * k, v.z * k);
    }
    g.computeVertexNormals();
    paint(g, (x, y) => [_c.setRGB(1, 1, 1).multiplyScalar(lerp(0.7, 1.05, clamp(y * 1.4, 0, 1))).clone(), 0.5 + y * 0.5]);
    return g;
  })();
  const moundMat = stdMat(W, { vertexColors: true, roughness: 0.7 }, { key: 'mound' });
  addDetail(moundMat, W, { glsl: POLYP_GLSL, space: 'object', bump: 1, key: 'mound' });
  addFluor(moundMat, W, '#36ffd0', 0.35, 'mound');
  const moundCols = [C('#c8a060'), C('#b89a50'), C('#9a8a5a'), C('#a8b060'), C('#c09080'), C('#9a7aa8'), C('#7a9ab0'), C('#d0b070'), C('#e0906a'), C('#b88cc8')];
  const mounds = [];
  for (let i = N(190); i > 0; i--) {
    const s = rng.chance(0.88) ? take(reefSpots, () => true, 0.2) : take(sandSpots, () => true, 0.25);
    if (!s) continue;
    const r = rng.range(0.13, 0.36);
    mounds.push({ pos: new THREE.Vector3(s.x, s.y - r * 0.15, s.z), quat: standOn(nrm(s), rng.range(0, TAU), 0.25), scale: new THREE.Vector3(r * rng.range(0.9, 1.4), r, r * rng.range(0.9, 1.4)), color: rng.pick(moundCols).clone().offsetHSL(0, 0, rng.range(-0.06, 0.04)) });
  }
  group.add(instanced(moundG, moundMat, mounds));

  /* ---- tube sponges ---- */
  const spongeMat = stdMat(W, { vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }, { key: 'sponge' });
  addDetail(spongeMat, W, { glsl: SPONGE_GLSL, space: 'object', bump: 1, key: 'sponge' });
  const spongeGeos = [spongeGeo(rng.fork('sp1'), C('#8a3fa8')), spongeGeo(rng.fork('sp2'), C('#e08a2c')), spongeGeo(rng.fork('sp3'), C('#d8c838'))];
  const spongeLists = spongeGeos.map(() => []);
  for (let i = N(16); i > 0; i--) {
    const s = take(reefSpots, s2 => nrm(s2).y > 0.45, 0.3);
    if (!s) break;
    const sc = rng.range(0.9, 1.4);
    spongeLists[i % spongeGeos.length].push({ pos: new THREE.Vector3(s.x, s.y - 0.03, s.z), quat: standOn(nrm(s), rng.range(0, TAU), 0.7), scale: new THREE.Vector3(sc, sc, sc) });
  }
  spongeGeos.forEach((g, i) => group.add(instanced(g, spongeMat, spongeLists[i])));

  /* ---- feather stars perched on high points ---- */
  const featherTex = featherTexture(env.seed ^ 21);
  const featherMat = new THREE.MeshStandardMaterial({ map: featherTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.7, envMapIntensity: 0.4 });
  waterize(featherMat, W, { key: 'feather' });
  addSway(featherMat, W, { height: 0.5, amount: 0.05, stiff: 1.2, flutter: 0.05, key: 'feather' });
  stableCutout(featherMat, featherTex, env);
  const arms = [];
  const featherCols = [C('#ff8a1a'), C('#ffd23a'), C('#e8303a'), C('#2a2a2a'), C('#f0f0e0'), C('#9a3ad8')];
  for (let i = N(16); i > 0; i--) {
    const s = take(reefSpots, s2 => s2.h > 0.6 && nrm(s2).y > 0.6, 0.35);
    if (!s) break;
    const col = rng.pick(featherCols);
    const base = new THREE.Vector3(s.x, s.y + 0.05, s.z);
    const nArm = rng.int(14, 20), sc = rng.range(0.32, 0.5);
    for (let k = 0; k < nArm; k++) {
      const a = (k / nArm) * TAU + rng.range(-0.1, 0.1);
      const tilt = rng.range(0.25, 0.75);
      _q.setFromEuler(_e.set(0, -a + Math.PI / 2, 0));
      _q2.setFromAxisAngle(new THREE.Vector3(1, 0, 0), tilt);
      arms.push({ pos: base, quat: _q.clone().multiply(_q2), scale: new THREE.Vector3(1, sc * rng.range(0.8, 1.15), sc), color: col });
    }
  }
  group.add(instanced(featherArmGeo(), featherMat, arms, { shadow: false, pad: 0.2 }));

  /* ---- mushroom corals on the sand and reef flats ---- */
  const mushMat = stdMat(W, { vertexColors: true, roughness: 0.6 }, { key: 'mush' });
  addFluor(mushMat, W, '#5aff7a', 1.2, 'mush');
  const mushes = [];
  const mushCols = [C('#e8e0b0'), C('#b0e0a0'), C('#f0b0c0'), C('#d0c090'), C('#a0d0e0')];
  for (let i = N(40); i > 0; i--) {
    const s = rng.chance(0.55) ? take(sandSpots, () => true, 0.12) : take(reefSpots, s2 => nrm(s2).y > 0.8, 0.12);
    if (!s) continue;
    const sc = rng.range(0.1, 0.18);
    mushes.push({ pos: new THREE.Vector3(s.x, s.y - 0.01, s.z), quat: standOn(nrm(s), rng.range(0, TAU), 0.3), scale: new THREE.Vector3(sc, sc, sc), color: rng.pick(mushCols) });
  }
  group.add(instanced(mushroomGeo(), mushMat, mushes, { shadow: false }));

  /* ---- anemones ---- */
  const tentLen = 0.34;
  const tentG = anemoneTentacleGeo(tentLen);
  paint(tentG, (x, y) => { const t = clamp(y / tentLen, 0, 1); return [_c.copy(C('#c8b45a')).lerp(C('#ff4fa8'), smoothstep(0.6, 1, t)).clone(), smoothstep(0.5, 1, t)]; });
  const tentMat = stdMat(W, { vertexColors: true, roughness: 0.45, envMapIntensity: 0.6 }, { key: 'tent' });
  addSway(tentMat, W, { height: tentLen, amount: 0.07, stiff: 1.5, flutter: 0.045, key: 'tent' });
  addFluor(tentMat, W, '#7dff3a', 1.4, 'tent');
  const tents = [], baseList = [];
  const tentCols = [C('#ffffff'), C('#d8ffb0'), C('#ffe8a8'), C('#ffd0f0')];
  anemones.forEach((a, ai) => {
    const nT = Math.round((ai === 0 ? 260 : 170) * q);
    const tc = tentCols[ai % tentCols.length];
    for (let i = 0; i < nT; i++) {
      const r = a.r * Math.sqrt(rng.range(0.03, 1));
      const ang = rng.range(0, TAU);
      const x = a.pos.x + Math.cos(ang) * r, z = a.pos.z + Math.sin(ang) * r;
      const y = a.pos.y + 0.12 + (1 - (r / a.r) ** 2) * 0.05;
      const tilt = 0.12 + 1.0 * (r / a.r) + rng.range(-0.15, 0.15);
      _q.setFromEuler(_e.set(0, -ang, 0));
      _q2.setFromAxisAngle(new THREE.Vector3(0, 0, -1), tilt);
      const sc = rng.range(0.75, 1.2);
      tents.push({ pos: new THREE.Vector3(x, y, z), quat: _q.clone().multiply(_q2), scale: new THREE.Vector3(sc, sc * rng.range(0.85, 1.2), sc), color: tc });
    }
    baseList.push({ pos: a.pos.clone(), quat: new THREE.Quaternion(), scale: new THREE.Vector3(a.r, 1, a.r), color: rng.pick([C('#8a1f3a'), C('#c0602a'), C('#5a2a8a')]) });
  });
  group.add(instanced(tentG, tentMat, tents, { shadow: false, pad: 0.15 }));
  const anBaseG = strip(new THREE.CylinderGeometry(0.62, 0.48, 0.16, 28, 2, false));
  anBaseG.translate(0, 0.06, 0);
  paint(anBaseG, () => [C('#ffffff'), 0.2]);
  group.add(instanced(anBaseG, stdMat(W, { vertexColors: true, roughness: 0.5 }, { key: 'anbase' }), baseList));

  /* ---- seagrass meadows on the sand apron ---- */
  const bladeG = new THREE.PlaneGeometry(0.05, 1, 1, 5);
  bladeG.translate(0, 0.5, 0);
  { const p = bladeG.getAttribute('position'); for (let i = 0; i < p.count; i++) { const y = p.getY(i); p.setZ(i, y * y * 0.12); p.setX(i, p.getX(i) * (1 - y * 0.5)); } bladeG.computeVertexNormals(); }
  strip(bladeG);
  paint(bladeG, (x, y) => [_c.setRGB(1, 1, 1).multiplyScalar(lerp(0.45, 1.05, y)).clone(), 0]);
  const grassMat = stdMat(W, { vertexColors: true, side: THREE.DoubleSide, roughness: 0.65 }, { key: 'grass' });
  addSway(grassMat, W, { height: 1, amount: 0.32, stiff: 1.5, flutter: 0.03, key: 'grass' });
  const blades = [];
  const grassCols = [C('#7d8a2c'), C('#93a03a'), C('#6a7a2a'), C('#a39a3c')];
  for (let pI = N(10); pI > 0; pI--) {
    const a = rng.range(0, TAU), r = rng.range(13, 24);
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const pr = rng.range(1.8, 4.2);
    const nb = Math.round(rng.range(200, 400) * q);
    for (let i = 0; i < nb; i++) {
      const ra = rng.range(0, TAU), rr = Math.abs(rng.gauss()) * pr * 0.55;
      const x = cx + Math.cos(ra) * rr, z = cz + Math.sin(ra) * rr;
      if (hm.at(x, z) > ground.height(x, z) + 0.1) continue;
      const h = rng.range(0.35, 0.95) * (1 - clamp(rr / pr, 0, 1) * 0.5);
      blades.push({ pos: new THREE.Vector3(x, ground.height(x, z) - 0.02, z), quat: _q.setFromEuler(_e.set(rng.range(-0.15, 0.15), rng.range(0, TAU), rng.range(-0.15, 0.15))).clone(), scale: new THREE.Vector3(1, h, 1), color: rng.pick(grassCols).clone().offsetHSL(0, 0, rng.range(-0.05, 0.05)) });
    }
  }
  group.add(instanced(bladeG, grassMat, blades, { shadow: false, pad: 0.6 }));

  /* ---- garden eels poking out of the sand apron ---- */
  const eelG = (() => {
    const g = strip(new THREE.CylinderGeometry(0.014, 0.017, 1, 6, 10, false));
    g.translate(0, 0.5, 0);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      // question-mark curve leaning into the current, head slightly thicker
      const k = 1 + smoothstep(0.82, 0.95, y) * 0.35 - smoothstep(0.97, 1.0, y) * 0.5;
      p.setXYZ(i, p.getX(i) * k + Math.sin(y * 2.6) * 0.07 * y, y, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    paint(g, (x, y, z, i) => [_c.setRGB(0.85, 0.84, 0.78).multiplyScalar(((i * 7) % 11) === 0 ? 0.35 : 1).clone(), 0]);
    return g;
  })();
  const eelMat = stdMat(W, { vertexColors: true, roughness: 0.5, envMapIntensity: 0.6 }, { key: 'eel' });
  addSway(eelMat, W, { height: 1, amount: 0.08, stiff: 1.3, flutter: 0.06, key: 'eel' });
  const eels = [];
  const eelYaw = Math.atan2(-curDir.y, curDir.x);
  for (let c = q > 0.6 ? 2 : 1; c > 0; c--) {
    const a = rng.range(0, TAU), r = rng.range(13.5, 17);
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    for (let i = N(26); i > 0; i--) {
      const x = cx + rng.gauss() * 1.4, z = cz + rng.gauss() * 1.4;
      if (hm.at(x, z) > ground.height(x, z) + 0.05) continue;
      const h = rng.range(0.25, 0.45);
      eels.push({ pos: new THREE.Vector3(x, ground.height(x, z) - 0.03, z), quat: _q.setFromEuler(_e.set(rng.range(-0.08, 0.08), eelYaw + rng.range(-0.4, 0.4), rng.range(-0.06, 0.06))).clone(), scale: new THREE.Vector3(1, h, 1) });
    }
  }
  group.add(instanced(eelG, eelMat, eels, { shadow: false, pad: 0.25 }));

  /* ---- a few ribbon-kelp clumps far out on the slope ---- */
  const kelpTex = kelpTexture(env.seed ^ 5);
  const kelpMat = new THREE.MeshStandardMaterial({ map: kelpTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, envMapIntensity: 0.3 });
  waterize(kelpMat, W, { key: 'kelp' });
  addSway(kelpMat, W, { height: 1, amount: 0.9, stiff: 1.25, flutter: 0.06, key: 'kelp' });
  stableCutout(kelpMat, kelpTex, env);
  const kelpG = new THREE.PlaneGeometry(1, 1, 1, 20);
  kelpG.translate(0, 0.5, 0);
  const kelps = [];
  for (let c = N(3); c > 0; c--) {
    const a = rng.range(0, TAU), r = rng.range(19, 28);
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    for (let i = rng.int(4, 7); i > 0; i--) {
      const x = cx + rng.range(-1.6, 1.6), z = cz + rng.range(-1.6, 1.6);
      const h = rng.range(4.5, 8.5), w = rng.range(0.45, 0.65), yaw = rng.range(0, TAU);
      for (const extra of [0, Math.PI / 2]) kelps.push({ pos: new THREE.Vector3(x, ground.height(x, z) - 0.1, z), quat: _q.setFromEuler(_e.set(0, yaw + extra, 0)).clone(), scale: new THREE.Vector3(w, h, 1), color: _c.setHSL(0.11, 0.5, rng.range(0.55, 0.75)).clone() });
    }
  }
  group.add(instanced(kelpG, kelpMat, kelps, { shadow: false, pad: 1.6 }));

  /* ---- starfish ---- */
  const starMat = stdMat(W, { vertexColors: true, roughness: 0.7 }, { key: 'star' });
  addDetail(starMat, W, { glsl: STAR_GLSL, space: 'object', bump: 0.25, key: 'star' });
  const stars = [];
  const starCols = [C('#ff6a1f'), C('#e8402a'), C('#2f6fe0'), C('#ff9a2a'), C('#c8304a')];
  for (let i = N(16); i > 0; i--) {
    const s = rng.chance(0.5) ? take(reefSpots, s2 => nrm(s2).y > 0.6, 0.15) : take(sandSpots, () => true, 0.15);
    if (!s) continue;
    const sc = rng.range(0.11, 0.17);
    stars.push({ pos: new THREE.Vector3(s.x, s.y - 0.005, s.z), quat: standOn(nrm(s), rng.range(0, TAU), 0.0), scale: new THREE.Vector3(sc, sc, sc), color: rng.pick(starCols) });
  }
  group.add(instanced(starGeo(), starMat, stars, { shadow: false }));

  /* ---- urchins in the crevices ---- */
  const urchinBodyG = strip(new THREE.SphereGeometry(0.09, 12, 8));
  paint(urchinBodyG, () => [C('#2a1830'), 0]);
  const spineG = strip(new THREE.ConeGeometry(0.011, 1, 4, 1));
  spineG.translate(0, 0.5, 0);
  paint(spineG, (x, y) => [_c.copy(C('#1c1024')).lerp(C('#5a3a6a'), clamp(y, 0, 1)).clone(), 0]);
  const urchinMat = stdMat(W, { vertexColors: true, roughness: 0.4, envMapIntensity: 0.6 }, { key: 'urchin' });
  const urchins = [], spines = [];
  for (let i = N(11); i > 0; i--) {
    const s = rng.chance(0.6) ? take(reefSpots, s2 => nrm(s2).y > 0.3, 0.25) : take(sandSpots, () => true, 0.25);
    if (!s) continue;
    const c = new THREE.Vector3(s.x, s.y + 0.04, s.z);
    urchins.push({ pos: c, quat: new THREE.Quaternion(), scale: new THREE.Vector3(1, 0.8, 1) });
    for (let k = 0; k < 60; k++) {
      const d = rng.onSphere(new THREE.Vector3());
      if (d.y < -0.25) d.y = -d.y * 0.3;
      d.normalize();
      spines.push({ pos: c.clone().addScaledVector(d, 0.07), quat: _q.setFromUnitVectors(_up, d).clone(), scale: new THREE.Vector3(1, rng.range(0.16, 0.32), 1) });
    }
  }
  group.add(instanced(urchinBodyG, urchinMat, urchins));
  group.add(instanced(spineG, urchinMat, spines, { shadow: false }));

  /* ---- rubble along the reef edge ---- */
  const rubG = strip(new THREE.IcosahedronGeometry(1, 1));
  { const p = rubG.getAttribute('position'), nn = createNoise(3); for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const k = 1 + nn.noise3(x * 2, y * 2, z * 2) * 0.3; p.setXYZ(i, x * k, y * k * 0.6, z * k); } rubG.computeVertexNormals(); }
  paint(rubG, () => [C('#ffffff'), 0]);
  const rubMat = stdMat(W, { vertexColors: true, roughness: 0.9, flatShading: true }, { key: 'rub' });
  const rubble = [];
  const rubCols = [C('#d8d0bc'), C('#c8bca0'), C('#e0c8c0'), C('#b8b0a0'), C('#cfc4b2')];
  for (let i = N(380); i > 0; i--) {
    const s = sandSpots[(i * 7919) % Math.max(1, sandSpots.length)];
    if (!s) break;
    const x = s.x + rng.range(-0.15, 0.15), z = s.z + rng.range(-0.15, 0.15);
    const sc = rng.range(0.03, 0.1);
    rubble.push({ pos: new THREE.Vector3(x, ground.height(x, z) + sc * 0.15, z), quat: _q.setFromEuler(_e.set(rng.range(-0.3, 0.3), rng.range(0, TAU), rng.range(-0.3, 0.3))).clone(), scale: new THREE.Vector3(sc * rng.range(1, 2.2), sc, sc), color: rng.pick(rubCols) });
  }
  group.add(instanced(rubG, rubMat, rubble, { shadow: false }));

  return { group, anemones, thickets, reefSpots };
}
