// 锦鲤 · 庭院池塘 — a Japanese stroll-garden koi pond seen from above
// (art direction after Sekiro and Ghost of Tsushima gardens).
// Refractive water with ripples, koi with unique patterns and shadows on the pond floor,
// a vermilion arched bridge, a snow-viewing lantern, a cherry tree shedding petals on the water,
// water lilies that open by day and close at night, a bamboo spout and a bamboo grove.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  TAU, clamp, lerp, smoothstep, damp, makeRng, createNoise, canvasTexture, normalMapFromHeight,
  makeCanvas, noiseCanvas, GLSL, patchMaterial, createWind, addWind, softDiscTexture,
} from '../lib/util.js';
import { buildFishGeometry, paintFish, createFishMaterial, createSwimDepthMaterial, Swimmer } from '../lib/fish.js';

const KINDS = {
  kohaku: { zh: '红白' }, tancho: { zh: '丹顶' }, sanke: { zh: '大正三色' }, showa: { zh: '昭和三色' },
  ogon: { zh: '黄金' }, platinum: { zh: '白金' }, asagi: { zh: '浅黄' }, chagoi: { zh: '茶鲤' },
  kigoi: { zh: '黄鲤' }, benigoi: { zh: '红鲤' }, hirenaga: { zh: '蝶尾锦鲤' },
};
const WATER_Y = 0;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0), _zAxis = new THREE.Vector3(0, 0, 1);

export default {
  id: 'koi',
  food: '鱼食',
  kinds: KINDS,
  starter: ['kohaku', 'kohaku', 'tancho', 'sanke', 'showa', 'ogon', 'asagi', 'chagoi', 'platinum', 'hirenaga'],
  addable: ['kohaku', 'tancho', 'sanke', 'showa', 'ogon', 'platinum', 'asagi', 'chagoi', 'kigoi', 'benigoi', 'hirenaga'],
  maxMembers: 18,
  ambience: h => (h > 19.5 || h < 5) ? ['stream', 'insects', 'shishi'] : ['stream', 'birds', 'shishi'],
  eatSound: 'eat',
  async create(env) { return new KoiPond(env).build(); },
};

/* ------------------------------------------------------------------ */
/* Shared underwater look: depth tint + caustics on anything below the */
/* water line (pond floor, rocks, koi, bridge piers).                  */
/* ------------------------------------------------------------------ */
function makeUnderwaterUniforms() {
  return {
    uWaterY: { value: WATER_Y },
    uWaterDensity: { value: 0.95 },
    uWaterColor: { value: new THREE.Color('#1f3a2c') },
    uCaustic: { value: 1 },
    uKTime: { value: 0 },
    uMoss: { value: new THREE.Color('#4d6a2a') },
  };
}
function addUnderwater(material, U, { caustic = 1, tint = 1, moss = 0, key = '' } = {}) {
  return patchMaterial(material, {
    key: `koi-uw-${caustic}-${tint}-${moss}-${key}`,
    uniforms: U,
    vertexHeader: 'varying vec3 vUWPos;',
    vertex: {
      '#include <project_vertex>': `$&
        { vec4 uwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          uwp = instanceMatrix * uwp;
        #endif
        vUWPos = (modelMatrix * uwp).xyz; }`,
    },
    fragmentHeader: `varying vec3 vUWPos;
      uniform float uWaterY, uWaterDensity, uCaustic, uKTime; uniform vec3 uWaterColor, uMoss;
      ${GLSL.noise}
      ${GLSL.caustics}`,
    fragment: {
      '#include <color_fragment>': moss > 0 ? `$&
        { vec3 wN = normalize(inverseTransformDirection(vNormal, viewMatrix));
          float mo = smoothstep(0.42, 0.85, wN.y) * smoothstep(0.25, 0.65, vnoise(vUWPos.xz * 2.7) * 0.7 + vnoise(vUWPos.xz * 9.0) * 0.3);
          mo *= smoothstep(-0.05, 0.06, vUWPos.y - uWaterY);
          diffuseColor.rgb = mix(diffuseColor.rgb, uMoss * (0.75 + 0.5 * vnoise(vUWPos.xz * 21.0)), mo * ${moss.toFixed(2)}); }` : '$&',
      '#include <fog_fragment>': `{
          float dUW = uWaterY - vUWPos.y;
          if (dUW > 0.0) {
            float kk = 1.0 - exp(-dUW * uWaterDensity);
            float c = caustics(vUWPos.xz * 1.1, uKTime * 0.8) * uCaustic * ${caustic.toFixed(2)} * exp(-dUW * 0.9) * smoothstep(0.0, 0.06, dUW);
            gl_FragColor.rgb += gl_FragColor.rgb * c * 1.8;
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uWaterColor, kk * ${tint.toFixed(2)});
          }
        }
        $&`,
    },
  });
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */
/** Tapered tube along a list of points (radius r0 -> r1). */
function taperedTube(points, r0, r1, radial = 7, rng = null, wobble = 0) {
  const curve = new THREE.CatmullRomCurve3(points);
  const segs = Math.max(2, points.length * 3);
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = curve.getPointAt(t);
    const N = frames.normals[i], B = frames.binormals[i];
    const r = lerp(r0, r1, t);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * TAU;
      const w = wobble ? 1 + Math.sin(a * 3 + t * 9) * wobble : 1;
      const nx = Math.cos(a) * N.x + Math.sin(a) * B.x, ny = Math.cos(a) * N.y + Math.sin(a) * B.y, nz = Math.cos(a) * N.z + Math.sin(a) * B.z;
      pos.push(p.x + nx * r * w, p.y + ny * r * w, p.z + nz * r * w);
      nor.push(nx, ny, nz);
      uv.push(j / radial, t * curve.getLength() * 1.2);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Lumpy rock: displaced icosphere, flattened. */
function rockGeometry(rng, noise, detail = 3) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const off = rng.range(0, 100);
  for (let i = 0; i < p.count; i++) {
    _v.fromBufferAttribute(p, i);
    const n = noise.fbm3(_v.x * 1.1 + off, _v.y * 1.1, _v.z * 1.1, 4);
    const ridge = Math.abs(noise.noise3(_v.x * 2.3 + off, _v.y * 2.3, _v.z * 2.3));
    const s = 1 + n * 0.32 - ridge * 0.1;
    _v.multiplyScalar(s);
    if (_v.y < -0.2) _v.y = -0.2 + (_v.y + 0.2) * 0.3; // flatter bottom
    p.setXYZ(i, _v.x, _v.y, _v.z);
  }
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */
function groundDetail(seed) {
  // velvety moss: soft multi-scale speckle, tileable
  const rng = makeRng(seed);
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  const base = noiseCanvas(256, 256, { seed, scale: 5, octaves: 3, map: v => { const k = 175 + (v - 0.5) * 60; return [k, k, k]; } });
  g.drawImage(base, 0, 0);
  for (let i = 0; i < 5200; i++) {
    const x = rng.range(0, 256), y = rng.range(0, 256), r = rng.range(0.6, 2.2), k = rng.range(120, 235);
    g.fillStyle = `rgba(${k},${k},${k},${rng.range(0.25, 0.7)})`;
    for (const [ox, oy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) { g.beginPath(); g.arc(x + ox, y + oy, r, 0, TAU); g.fill(); }
  }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8;
  const normal = normalMapFromHeight(c, 1.2);
  return { map, normal };
}
function stoneTexture(seed) {
  const n = createNoise(seed);
  const c = makeCanvas(256, 256), g = c.getContext('2d'), img = g.createImageData(256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const a = (x / 256) * TAU, b = (y / 256) * TAU;
    const v = n.fbm3(Math.cos(a) * 1.4, Math.sin(a) * 1.4, Math.cos(b) * 1.4 + Math.sin(b) * 0.7, 5) * 0.5 + 0.5;
    const speck = n.noise3(Math.cos(a) * 9, Math.sin(a) * 9, Math.cos(b) * 9 + Math.sin(b) * 4.5) > 0.55 ? 0.82 : 1;
    const g0 = (95 + v * 120) * speck;
    const i = (y * 256 + x) * 4;
    img.data[i] = g0 * 0.98; img.data[i + 1] = g0 * 0.97; img.data[i + 2] = g0 * 0.93; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return { map, normal: normalMapFromHeight(c, 4) };
}
function woodTexture(seed, base = [122, 92, 64]) {
  const n = createNoise(seed);
  return canvasTexture(256, 256, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const grain = Math.sin((y / h) * 60 + n.fbm2(x / 40, y / 12, 3) * 6) * 0.5 + 0.5;
      const v = 0.75 + grain * 0.25 + n.noise2(x / 6, y / 50) * 0.06;
      const i = (y * w + x) * 4;
      img.data[i] = base[0] * v; img.data[i + 1] = base[1] * v; img.data[i + 2] = base[2] * v; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { repeat: true });
}
function blossomTexture(seed) {
  const rng = makeRng(seed);
  return canvasTexture(256, 256, (g, w) => {
    g.clearRect(0, 0, w, w);
    const flower = (x, y, r, rot, tint) => {
      g.save(); g.translate(x, y); g.rotate(rot);
      for (let k = 0; k < 5; k++) {
        g.rotate(TAU / 5);
        const grd = g.createRadialGradient(0, -r * 0.55, r * 0.05, 0, -r * 0.5, r * 0.75);
        grd.addColorStop(0, `rgba(255,${238 - tint * 30},${244 - tint * 20},1)`);
        grd.addColorStop(1, `rgba(${246 - tint * 10},${170 - tint * 40},${196 - tint * 30},1)`);
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(0, 0);
        g.bezierCurveTo(r * 0.55, -r * 0.3, r * 0.45, -r * 1.0, r * 0.08, -r * 0.95);
        g.lineTo(0, -r * 0.82);
        g.lineTo(-r * 0.08, -r * 0.95);
        g.bezierCurveTo(-r * 0.45, -r * 1.0, -r * 0.55, -r * 0.3, 0, 0);
        g.fill();
      }
      g.fillStyle = '#c2405e'; g.beginPath(); g.arc(0, 0, r * 0.16, 0, TAU); g.fill();
      g.fillStyle = '#f5d36a';
      for (let k = 0; k < 7; k++) { const a = rng.range(0, TAU), d = rng.range(r * 0.12, r * 0.3); g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, r * 0.04, 0, TAU); g.fill(); }
      g.restore();
    };
    // a few leaves under the flowers
    for (let i = 0; i < 6; i++) {
      g.save(); g.translate(rng.range(40, 216), rng.range(40, 216)); g.rotate(rng.range(0, TAU));
      g.fillStyle = `rgba(${90 + rng.int(0, 30)},${120 + rng.int(0, 30)},60,1)`;
      g.beginPath(); g.ellipse(0, 0, 9, 22, 0, 0, TAU); g.fill(); g.restore();
    }
    for (let i = 0; i < 26; i++) {
      const a = rng.range(0, TAU), d = Math.sqrt(rng.next()) * 92;
      flower(128 + Math.cos(a) * d, 128 + Math.sin(a) * d, rng.range(16, 26), rng.range(0, TAU), rng.next());
    }
  });
}
function petalTexture() {
  return canvasTexture(64, 64, (g) => {
    const grd = g.createLinearGradient(0, 64, 0, 0);
    grd.addColorStop(0, '#f6b8c9'); grd.addColorStop(1, '#fff1f5');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(32, 62);
    g.bezierCurveTo(4, 44, 4, 10, 24, 4);
    g.lineTo(32, 12); g.lineTo(40, 4);
    g.bezierCurveTo(60, 10, 60, 44, 32, 62);
    g.fill();
  });
}
function lilyPadTexture(seed) {
  const rng = makeRng(seed);
  return canvasTexture(256, 256, (g, w) => {
    const c = w / 2;
    const grd = g.createRadialGradient(c, c, 4, c, c, c);
    grd.addColorStop(0, '#6f8f3a'); grd.addColorStop(0.65, '#4f7a2c'); grd.addColorStop(0.92, '#3f6a26'); grd.addColorStop(1, '#8a7a3a');
    g.fillStyle = grd; g.fillRect(0, 0, w, w);
    g.strokeStyle = 'rgba(190,220,120,0.35)'; g.lineWidth = 1.3;
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * TAU + rng.range(-0.04, 0.04);
      g.beginPath(); g.moveTo(c, c);
      g.quadraticCurveTo(c + Math.cos(a + 0.1) * c * 0.5, c + Math.sin(a + 0.1) * c * 0.5, c + Math.cos(a) * c, c + Math.sin(a) * c);
      g.stroke();
    }
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(30,50,20,${rng.range(0.05, 0.15)})`; g.beginPath(); g.arc(rng.range(0, w), rng.range(0, w), rng.range(2, 9), 0, TAU); g.fill(); }
  });
}
function lilyPetalTexture() {
  return canvasTexture(64, 128, (g) => {
    const grd = g.createLinearGradient(0, 128, 0, 0);
    grd.addColorStop(0, '#fffaf4'); grd.addColorStop(0.55, '#ffe9ef'); grd.addColorStop(1, '#f08fb0');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(32, 126); g.bezierCurveTo(2, 90, 6, 24, 32, 2); g.bezierCurveTo(58, 24, 62, 90, 32, 126); g.fill();
    g.strokeStyle = 'rgba(240,160,190,0.35)'; g.lineWidth = 1;
    for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(32, 124); g.quadraticCurveTo(32 + i * 9, 64, 32 + i * 4, 10); g.stroke(); }
  });
}
function bambooTexture() {
  return canvasTexture(64, 512, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#4f6a2a'); grd.addColorStop(0.45, '#8aa04a'); grd.addColorStop(0.55, '#97ad55'); grd.addColorStop(1, '#4a6226');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 64) {
      g.fillStyle = 'rgba(40,50,20,0.55)'; g.fillRect(0, y, w, 3);
      g.fillStyle = 'rgba(230,235,190,0.35)'; g.fillRect(0, y + 3, w, 2);
      const lg = g.createLinearGradient(0, y + 5, 0, y + 30); lg.addColorStop(0, 'rgba(220,230,180,0.25)'); lg.addColorStop(1, 'rgba(220,230,180,0)');
      g.fillStyle = lg; g.fillRect(0, y + 5, w, 25);
    }
  }, { repeat: true });
}
function bambooLeafTexture(seed) {
  const rng = makeRng(seed);
  return canvasTexture(128, 128, (g, w) => {
    g.clearRect(0, 0, w, w);
    for (let i = 0; i < 14; i++) {
      g.save(); g.translate(64, 64); g.rotate(rng.range(0, TAU));
      g.translate(0, rng.range(8, 30));
      const len = rng.range(30, 46);
      const grd = g.createLinearGradient(0, 0, 0, len); grd.addColorStop(0, '#3e5a22'); grd.addColorStop(1, '#6f8f36');
      g.fillStyle = grd;
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(5, len * 0.4, 0, len); g.quadraticCurveTo(-5, len * 0.4, 0, 0); g.fill();
      g.restore();
    }
  });
}
function leafyTexture(seed, base = [52, 84, 34]) {
  const rng = makeRng(seed);
  const c = makeCanvas(256, 256), g = c.getContext('2d');
  g.fillStyle = `rgb(${base[0] * 0.6},${base[1] * 0.6},${base[2] * 0.6})`; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 900; i++) {
    const x = rng.range(0, 256), y = rng.range(0, 256), r = rng.range(3, 7), k = rng.range(0.7, 1.35);
    g.fillStyle = `rgb(${base[0] * k},${base[1] * k},${base[2] * k})`;
    g.beginPath(); g.ellipse(x, y, r, r * 0.55, rng.range(0, TAU), 0, TAU); g.fill();
  }
  const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return { map, normal: normalMapFromHeight(c, 3) };
}

/* ------------------------------------------------------------------ */
/* The pond                                                            */
/* ------------------------------------------------------------------ */
class KoiPond {
  constructor(env) {
    this.env = env;
    this.q = env.q;
    this.rng = env.rng;
    this.noise = createNoise(env.seed);
    this.time = 0;
    this.koi = [];
    this.foods = [];
    this.ripples = [];
    this.disposables = [];
    this.U = makeUnderwaterUniforms();
  }

  /* ---------- pond shape ---------- */
  setupShape() {
    const r = this.rng.fork('shape');
    const flip = r.chance(0.5) ? 1 : -1;
    this.lobes = [
      { x: -1.7 * flip, z: r.range(-0.4, 0.4), r: r.range(3.0, 3.35) },
      { x: 3.0 * flip, z: r.range(0.3, 1.0), r: r.range(2.05, 2.35) },
    ];
    this.shoreNoise = r.range(0, 100);
    this.flip = flip;
    this.yaw0 = -flip * Math.PI / 2 + 0.42;
    this.viewTarget = new THREE.Vector3(lerp(this.lobes[0].x, this.lobes[1].x, 0.3), 0.2, lerp(this.lobes[0].z, this.lobes[1].z, 0.3));
    // direction away from the default camera, and its right-hand side
    this.farDir = new THREE.Vector3(-Math.sin(this.yaw0), 0, -Math.cos(this.yaw0));
    this.rightDir = new THREE.Vector3(-this.farDir.z, 0, this.farDir.x);
  }
  /** Score a ground point for background props: far from the camera, off to one side. */
  framing(x, z, side) {
    const dx = x - this.viewTarget.x, dz = z - this.viewTarget.z;
    const far = dx * this.farDir.x + dz * this.farDir.z;
    const lat = dx * this.rightDir.x + dz * this.rightDir.z;
    return far * 0.6 - Math.abs(lat - side * 3.2) * 0.5;
  }
  sdf(x, z) {
    const k = 1.4;
    let acc = 0;
    for (const L of this.lobes) acc += Math.exp(-(Math.hypot(x - L.x, z - L.z) - L.r) / k);
    const d = -k * Math.log(acc);
    return d + this.noise.fbm2(x * 0.32 + this.shoreNoise, z * 0.32, 3) * 0.55;
  }
  height(x, z) {
    const d = this.sdf(x, z);
    const n = this.noise.fbm2(x * 0.5 + 7, z * 0.5 - 3, 3);
    if (d < 0) return -0.07 - 1.05 * smoothstep(0, 2.2, -d) + n * 0.05;
    const s = smoothstep(0, 0.75, d);
    const rr = Math.hypot(x, z);
    const berm = smoothstep(10.5, 15, rr) * (0.9 + n * 0.5) + smoothstep(15, 22, rr) * 1.2;
    const mound = Math.max(0, this.noise.fbm2(x * 0.18 - 11, z * 0.18 + 5, 3)) * 0.9 * smoothstep(1.5, 4, d);
    return lerp(-0.07, 0.17, s) + berm + mound + n * 0.04 * s;
  }
  sdfGrad(x, z, out) {
    const e = 0.08;
    out.set(this.sdf(x + e, z) - this.sdf(x - e, z), 0, this.sdf(x, z + e) - this.sdf(x, z - e));
    const l = Math.hypot(out.x, out.z) || 1;
    return out.set(out.x / l, 0, out.z / l);
  }
  randomInPond(rng, margin = 1.0, out = new THREE.Vector3()) {
    for (let i = 0; i < 60; i++) {
      const L = rng.pick(this.lobes);
      const a = rng.range(0, TAU), rr = Math.sqrt(rng.next()) * L.r;
      const x = L.x + Math.cos(a) * rr, z = L.z + Math.sin(a) * rr;
      if (this.sdf(x, z) < -margin) return out.set(x, 0, z);
    }
    return out.set(this.lobes[0].x, 0, this.lobes[0].z);
  }

  /* ---------- build ---------- */
  async build() {
    const env = this.env;
    this.setupShape();
    const scene = this.scene = new THREE.Scene();
    const camera = this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 900);

    this.buildSky();
    this.buildLights();
    this.buildTerrain();
    await this.buildWater();
    this.buildBridge();
    this.buildRocks();
    this.buildLantern();
    this.buildTree();
    this.buildPaths();
    this.buildBamboo();
    this.buildShrubs();
    this.buildLilies();
    this.buildFloatLanterns();
    this.buildSpout();
    this.buildParticles();
    this.buildKoi();
    this.updateTimeOfDay(true);

    return {
      scene, camera,
      view: {
        target: this.viewTarget.clone(),
        dist: 9.2, distRange: [4.5, 22],
        yaw: this.yaw0, yawRange: [this.yaw0 - 1.15, this.yaw0 + 1.15],
        pitch: 0.56, pitchRange: [0.22, 1.38],
        drift: 0.016, idlePitch: 0.52, fov: 42,
      },
      post: this.post = {
        bloom: { strength: 0.25, radius: 0.55, threshold: 0.9 },
        exposure: 1.0, vignette: 0.48, grain: 0.028, saturation: 1.06, contrast: 1.05,
        lift: [0.0, 0.01, 0.01], gain: [1.02, 1.0, 0.97], ca: 0.0008,
        tilt: { amount: 0.3, center: 0.55, width: 0.24 },
      },
      update: (dt, t) => this.update(dt, t),
      feed: ray => this.feed(ray),
      feedRandom: n => this.feedRandom(n),
      addMember: m => this.addKoi(m, true),
      creatures: () => this.koi.map(k => ({ member: k.member, pos: k.sw.pos, radius: 0.32 * k.scale + 0.1 })),
      dispose: () => this.dispose(),
    };
  }

  /* ---------- sky + env ---------- */
  buildSky() {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color('#1d2216') },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uMoonDir: { value: new THREE.Vector3(0, 1, 0) }, uNight: { value: 0 },
      },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: /* glsl */`
        uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor, uMoonDir; uniform float uNight; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir); float h = d.y;
          vec3 col = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.5));
          col = mix(col, uGround, smoothstep(0.0, -0.2, h));
          float sd = max(dot(d, uSunDir), 0.0);
          col += uSunColor * (pow(sd, 1200.0) * 40.0 + pow(sd, 16.0) * 0.35 + pow(sd, 3.0) * 0.08) * (1.0 - uNight);
          if (h > 0.0 && uNight > 0.01) {
            vec3 sp = d * 260.0; vec3 id = floor(sp);
            float r = fract(sin(dot(id, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
            float st = step(0.9972, r) * smoothstep(0.45, 0.0, length(fract(sp) - 0.5));
            col += vec3(st) * uNight * 2.0 * smoothstep(0.0, 0.3, h);
          }
          float md = dot(d, uMoonDir);
          col += vec3(0.92, 0.95, 1.0) * (smoothstep(0.99955, 0.99972, md) * 4.0 + pow(max(md, 0.0), 80.0) * 0.12) * uNight;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.skyMat = mat;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(420, 48, 24), mat);
    dome.frustumCulled = false;
    this.scene.add(dome);
    this.skyScene = new THREE.Scene();
    this.skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), mat));
    this.scene.fog = new THREE.FogExp2('#9fb4b8', 0.012);
  }

  buildLights() {
    const sun = this.sun = new THREE.DirectionalLight('#ffffff', 2.5);
    sun.castShadow = this.env.shadows;
    const ms = this.q >= 0.9 ? 2048 : 1024;
    sun.shadow.mapSize.set(ms, ms);
    const sc = sun.shadow.camera;
    sc.left = -15; sc.right = 15; sc.top = 15; sc.bottom = -15; sc.near = 1; sc.far = 80;
    sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
    this.scene.add(sun, sun.target);
    this.hemi = new THREE.HemisphereLight('#bcd4e6', '#3a3a24', 0.8);
    this.scene.add(this.hemi);
  }

  /* ---------- terrain ---------- */
  buildTerrain() {
    const size = 64, seg = Math.round(lerp(130, 230, clamp((this.q - 0.45) / 0.55, 0, 1)));
    const g = new THREE.PlaneGeometry(size, size, seg, seg);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color(), silt = new THREE.Color('#5d5640'), pebble = new THREE.Color('#7a6e58'), mud = new THREE.Color('#3a3324'),
      moss1 = new THREE.Color('#5a7a2c'), moss2 = new THREE.Color('#82983c'), moss3 = new THREE.Color('#41592199'.slice(0, 7)), soil = new THREE.Color('#5c4a32');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const h = this.height(x, z);
      p.setY(i, h);
      const d = this.sdf(x, z);
      const n = this.noise.fbm2(x * 0.7, z * 0.7, 3) * 0.5 + 0.5;
      const n2 = this.noise.fbm2(x * 2.4 + 9, z * 2.4, 2) * 0.5 + 0.5;
      if (d < -0.15) c.copy(silt).lerp(pebble, n2 * 0.8).multiplyScalar(0.85 + n * 0.3);
      else if (d < 0.55) c.copy(mud).lerp(soil, smoothstep(0.1, 0.55, d) * n);
      else c.copy(moss3).lerp(moss1, n).lerp(moss2, smoothstep(0.55, 0.9, n2) * 0.7);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const det = groundDetail(this.env.seed + 3);
    det.map.repeat.set(70, 70); det.normal.repeat.set(70, 70);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: det.map, normalMap: det.normal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.97 });
    addUnderwater(mat, this.U, { caustic: 1, tint: 1, key: 'ground' });
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.terrain = mesh;
  }

  /* ---------- water ---------- */
  async buildWater() {
    const env = this.env;
    const [na, nb] = await Promise.all([
      env.loadTextureAsync('textures/Water_1_M_Normal.jpg', { srgb: false, repeat: true }),
      env.loadTextureAsync('textures/Water_2_M_Normal.jpg', { srgb: false, repeat: true }),
    ]);
    this.disposables.push(na, nb);
    const useTransmission = this.q >= 0.6;
    const mat = new THREE.MeshPhysicalMaterial({
      color: '#ffffff', roughness: 0.035, metalness: 0, ior: 1.333,
      transmission: useTransmission ? 1 : 0, thickness: 0.8,
      attenuationColor: new THREE.Color('#3f8a6a'), attenuationDistance: 2.2,
      transparent: !useTransmission, opacity: 0.42,
      specularIntensity: 1, envMapIntensity: 1.5,
    });
    this.rippleUniform = { value: Array.from({ length: 32 }, () => new THREE.Vector4(0, 0, -99, 0)) };
    this.waterU = { uNA: { value: na }, uNB: { value: nb }, uWTime: { value: 0 }, uNStr: { value: 0.11 }, uRip: this.rippleUniform };
    patchMaterial(mat, {
      key: 'koi-water',
      uniforms: this.waterU,
      vertexHeader: 'varying vec3 vWWPos;',
      vertex: { '#include <project_vertex>': '$&\nvWWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;' },
      fragmentHeader: 'varying vec3 vWWPos; uniform sampler2D uNA, uNB; uniform float uWTime, uNStr; uniform vec4 uRip[32];',
      fragment: {
        '#include <normal_fragment_maps>': /* glsl */`
          {
            vec2 pp = vWWPos.xz;
            vec3 a = texture2D(uNA, pp * 0.15 + vec2(uWTime * 0.010, uWTime * 0.006)).xyz * 2.0 - 1.0;
            vec3 b = texture2D(uNB, pp * 0.26 + vec2(-uWTime * 0.008, uWTime * 0.012)).xyz * 2.0 - 1.0;
            vec2 sl = (a.xy + b.xy) * uNStr;
            vec3 nW = vec3(sl.x, 1.0, -sl.y);
            for (int i = 0; i < 32; i++) {
              vec4 r = uRip[i];
              if (r.w <= 0.0) continue;
              float age = uWTime - r.z;
              if (age < 0.0 || age > 5.0) continue;
              vec2 dv = pp - r.xy; float d = length(dv) + 1e-4;
              float x = d - age * 0.5;
              float en = exp(-x * x * 10.0) * exp(-age * 0.85) * r.w * smoothstep(0.0, 0.12, age);
              nW.xz += (dv / d) * cos(x * 24.0) * en * 0.55;
            }
            normal = normalize((viewMatrix * vec4(normalize(nW), 0.0)).xyz);
          }`,
      },
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(40, 40, 1, 1), mat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_Y;
    water.renderOrder = 2;
    this.scene.add(water);
    this.water = water;
    this.waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y);
  }
  addRipple(x, z, amp = 1) {
    const arr = this.rippleUniform.value;
    let slot = 0, oldest = Infinity;
    for (let i = 0; i < arr.length; i++) { const age = arr[i].w <= 0 ? -Infinity : arr[i].z; if (age < oldest) { oldest = age; slot = i; } }
    arr[slot].set(x, z, this.time, amp);
    this.ripples.push({ x, z, t: this.time, amp });
    if (this.ripples.length > 40) this.ripples.shift();
  }

  /* ---------- rocks ---------- */
  buildRocks() {
    const r = this.rng.fork('rocks');
    const tex = stoneTexture(this.env.seed + 11);
    tex.map.repeat.set(2, 2); tex.normal.repeat.set(2, 2);
    const mat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normal, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.88 });
    addUnderwater(mat, this.U, { caustic: 0.8, tint: 1, moss: 0.85, key: 'rock' });
    this.rockMat = mat;
    const variants = [];
    for (let i = 0; i < 6; i++) variants.push(rockGeometry(r, this.noise, this.q >= 0.6 ? 3 : 2));
    const placements = variants.map(() => []);
    // shoreline stones
    const n = Math.round(lerp(34, 60, this.q));
    let tries = 0;
    const placed = [];
    while (placements.flat().length < n && tries++ < 3000) {
      const a = r.range(0, TAU);
      const L = r.pick(this.lobes);
      let x = L.x + Math.cos(a) * (L.r + 0.6), z = L.z + Math.sin(a) * (L.r + 0.6);
      // walk to the shoreline
      for (let k = 0; k < 12; k++) { const d = this.sdf(x, z); this.sdfGrad(x, z, _v); x -= _v.x * (d - 0.15); z -= _v.z * (d - 0.15); }
      if (Math.abs(this.sdf(x, z) - 0.15) > 0.3) continue;
      if (this.nearBridge(x, z, 1.2)) continue;
      const s = r.chance(0.15) ? r.range(0.55, 0.85) : r.range(0.22, 0.48);
      if (placed.some(p => Math.hypot(p.x - x, p.z - z) < (p.s + s) * 0.95)) continue;
      placed.push({ x, z, s });
      placements[r.int(0, variants.length - 1)].push({ x, y: this.height(x, z) + s * 0.05, z, s, sy: r.range(0.5, 0.8), rot: r.range(0, TAU) });
    }
    // a few feature stones in the garden and one island stone in the pond
    for (let i = 0; i < 7; i++) {
      const a = r.range(0, TAU), rr = r.range(7.5, 10.5);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (this.sdf(x, z) < 1.2) continue;
      placements[i % variants.length].push({ x, y: this.height(x, z) + 0.05, z, s: r.range(0.5, 1.0), sy: r.range(0.6, 1.1), rot: r.range(0, TAU) });
    }
    const isle = this.randomInPond(r, 2.0, new THREE.Vector3());
    placements[0].push({ x: isle.x, y: -0.35, z: isle.z, s: 0.7, sy: 0.75, rot: 1 });
    this.islandStone = isle;
    const col = new THREE.Color();
    variants.forEach((geo, vi) => {
      const list = placements[vi];
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => {
        _m.compose(_v.set(p.x, p.y, p.z), _q.setFromEuler(_e.set(r.range(-0.15, 0.15), p.rot, r.range(-0.15, 0.15))), _s.set(p.s * r.range(0.9, 1.3), p.s * p.sy, p.s));
        im.setMatrixAt(i, _m);
        col.setHSL(0.09 + r.range(-0.02, 0.03), r.range(0.05, 0.14), r.range(0.42, 0.62));
        im.setColorAt(i, col);
      });
      im.castShadow = true; im.receiveShadow = true;
      this.scene.add(im);
    });
    this.stones = placed;
  }

  nearBridge(x, z, pad = 0) {
    if (!this.bridgeLine) return false;
    const B = this.bridgeLine;
    const t = clamp(((x - B.a.x) * B.dir.x + (z - B.a.z) * B.dir.z) / B.len, -0.1, 1.1);
    const px = B.a.x + B.dir.x * t * B.len, pz = B.a.z + B.dir.z * t * B.len;
    return Math.hypot(x - px, z - pz) < B.halfW + pad && t > -0.08 && t < 1.08;
  }

  /* ---------- vermilion arched bridge ---------- */
  buildBridge() {
    // Find the waist between the two lobes and span it.
    const L0 = this.lobes[0], L1 = this.lobes[1];
    let best = null;
    for (let t = 0.35; t <= 0.75; t += 0.02) {
      const cx = lerp(L0.x, L1.x, t), cz = lerp(L0.z, L1.z, t);
      const dx = L1.x - L0.x, dz = L1.z - L0.z, l = Math.hypot(dx, dz);
      const px = -dz / l, pz = dx / l;
      let a = 0, b = 0;
      while (this.sdf(cx + px * a, cz + pz * a) < 0.35 && a < 12) a += 0.05;
      while (this.sdf(cx - px * b, cz - pz * b) < 0.35 && b < 12) b += 0.05;
      if (!best || a + b < best.w) best = { w: a + b, cx, cz, px, pz, a, b };
    }
    const ext = 0.9;
    const A = new THREE.Vector3(best.cx - best.px * (best.b + ext), 0, best.cz - best.pz * (best.b + ext));
    const B = new THREE.Vector3(best.cx + best.px * (best.a + ext), 0, best.cz + best.pz * (best.a + ext));
    A.y = this.height(A.x, A.z); B.y = this.height(B.x, B.z);
    const len = A.distanceTo(new THREE.Vector3(B.x, A.y, B.z));
    const dir = new THREE.Vector3(B.x - A.x, 0, B.z - A.z).normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    this.bridgeLine = { a: A, b: B, dir, len, halfW: 0.85 };
    const W = 1.05, rise = clamp(len * 0.21, 0.8, 1.35);
    const deckY = t => lerp(A.y, B.y, t) + 0.16 + Math.sin(Math.PI * t) * rise;
    const at = (t, s, y = 0, out = new THREE.Vector3()) => out.set(A.x + dir.x * len * t + side.x * s, deckY(t) + y, A.z + dir.z * len * t + side.z * s);

    const group = new THREE.Group();
    const lacquer = new THREE.MeshPhysicalMaterial({ color: '#b8321e', roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.35 });
    const wood = new THREE.MeshStandardMaterial({ map: woodTexture(this.env.seed + 21, [118, 88, 62]), roughness: 0.8 });
    const darkWood = new THREE.MeshStandardMaterial({ color: '#3a2a1e', roughness: 0.9 });
    addUnderwater(darkWood, this.U, { caustic: 0.7, tint: 1, key: 'pier' });
    const bronze = new THREE.MeshStandardMaterial({ color: '#5f6f4c', metalness: 0.7, roughness: 0.45 });
    this.disposables.push(wood.map);

    // deck planks
    const N = Math.round(len / 0.19);
    const plank = new THREE.BoxGeometry(len / N * 0.92, 0.055, W);
    const planks = new THREE.InstancedMesh(plank, wood, N);
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N;
      at(t, 0, 0, _v);
      const slope = (deckY(t + 0.001) - deckY(t - 0.001)) / (0.002 * len);
      _q.setFromUnitVectors(_zAxis, side).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0));
      const yaw = Math.atan2(dir.x, dir.z) - Math.PI / 2;
      _q.setFromEuler(_e.set(0, yaw, Math.atan(slope), 'YXZ'));
      _m.compose(_v, _q, _s.set(1, 1, 1));
      planks.setMatrixAt(i, _m);
    }
    planks.castShadow = true; planks.receiveShadow = true;
    group.add(planks);
    // side beams (geta) as tapered tubes along the arc
    for (const s of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 16; i++) pts.push(at(i / 16, s * (W / 2 + 0.02), -0.09));
      const beam = new THREE.Mesh(taperedTube(pts, 0.085, 0.085, 6), lacquer);
      beam.castShadow = true;
      group.add(beam);
      // railing
      const posts = Math.max(5, Math.round(len / 0.8));
      const top = [], mid = [];
      for (let i = 0; i <= posts; i++) {
        const t = i / posts;
        const p = at(t, s * (W / 2 - 0.04), 0);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.82, 0.085), lacquer);
        post.position.copy(p).add(new THREE.Vector3(0, 0.41, 0));
        post.castShadow = true;
        group.add(post);
        top.push(p.clone().add(new THREE.Vector3(0, 0.78, 0)));
        mid.push(p.clone().add(new THREE.Vector3(0, 0.42, 0)));
        if (i === 0 || i === posts || i === Math.round(posts / 2)) {
          const cap = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.001, 0.3), new THREE.Vector2(0.03, 0.27), new THREE.Vector2(0.075, 0.17), new THREE.Vector2(0.07, 0.08), new THREE.Vector2(0.05, 0.03), new THREE.Vector2(0.06, 0.0)], 12), bronze);
          cap.position.copy(p).add(new THREE.Vector3(0, 0.8, 0));
          group.add(cap);
        }
      }
      group.add(new THREE.Mesh(taperedTube(top, 0.045, 0.045, 7), lacquer));
      group.add(new THREE.Mesh(taperedTube(mid, 0.026, 0.026, 6), lacquer));
    }
    // piers
    for (const t of [0.3, 0.7]) for (const s of [-1, 1]) {
      const p = at(t, s * W * 0.38, 0);
      const h = p.y + 1.3;
      const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, h, 8), darkWood);
      pier.position.set(p.x, p.y - h / 2 - 0.1, p.z);
      group.add(pier);
    }
    this.scene.add(group);
    this.bridge = group;
  }

  /* ---------- stone lantern (kasuga-dōrō) ---------- */
  buildLantern() {
    const r = this.rng.fork('lantern');
    // pick a shoreline spot on the big lobe, facing the camera side
    let spot = null, best = -Infinity;
    for (let i = 0; i < 120; i++) {
      const L = r.pick(this.lobes);
      const a = r.range(0, TAU);
      let x = L.x + Math.cos(a) * L.r, z = L.z + Math.sin(a) * L.r;
      for (let k = 0; k < 10; k++) { const d = this.sdf(x, z); this.sdfGrad(x, z, _v); x -= _v.x * (d - 0.3); z -= _v.z * (d - 0.3); }
      if (this.nearBridge(x, z, 1.6) || Math.abs(this.sdf(x, z) - 0.3) > 0.2) continue;
      const dx = x - this.viewTarget.x, dz = z - this.viewTarget.z;
      const far = dx * this.farDir.x + dz * this.farDir.z, lat = dx * this.rightDir.x + dz * this.rightDir.z;
      const sc = -Math.abs(far - 0.4) * 0.7 - Math.abs(lat - 3.1) * 0.6 + r.range(0, 0.2);
      if (sc > best) { best = sc; spot = new THREE.Vector3(x, this.height(x, z), z); }
    }
    spot = spot || new THREE.Vector3(this.lobes[0].x, 0.1, this.lobes[0].z + this.lobes[0].r);
    const stone = new THREE.MeshStandardMaterial({ map: this.rockMat.map, normalMap: this.rockMat.normalMap, normalScale: new THREE.Vector2(1, 1), color: '#b9b4a6', roughness: 0.9 });
    addUnderwater(stone, this.U, { caustic: 0.6, tint: 1, moss: 0.9, key: 'lantern' });
    // Kasuga-style lantern: base, pole with ring, platform, light box, hexagonal roof with curled corners, jewel
    const g = new THREE.Group();
    const add = (geo, y) => { const m = new THREE.Mesh(geo, stone); m.position.y = y; g.add(m); return m; };
    add(new THREE.CylinderGeometry(0.36, 0.4, 0.14, 6), 0.07);
    add(new THREE.CylinderGeometry(0.2, 0.33, 0.12, 6), 0.2);
    add(new THREE.CylinderGeometry(0.092, 0.112, 0.92, 14), 0.72);
    add(new THREE.TorusGeometry(0.108, 0.022, 6, 18), 0.72).rotation.x = Math.PI / 2;
    add(new THREE.CylinderGeometry(0.31, 0.15, 0.15, 6), 1.255);
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 6), 1.5);
    this.lanternGlow = new THREE.MeshStandardMaterial({ color: '#f2e2c0', emissive: '#ffb25a', emissiveIntensity: 0, roughness: 0.9 });
    const ap = 0.2 * Math.cos(Math.PI / 6) + 0.003;
    for (let i = 0; i < 6; i += 2) {
      const phi = (i / 6) * TAU + Math.PI / 6;
      const win = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.2), this.lanternGlow);
      win.position.set(Math.sin(phi) * ap, 1.5, Math.cos(phi) * ap);
      win.lookAt(new THREE.Vector3(Math.sin(phi) * 2, 1.5, Math.cos(phi) * 2));
      g.add(win);
    }
    const roofProfile = [new THREE.Vector2(0.0, 0.3), new THREE.Vector2(0.08, 0.29), new THREE.Vector2(0.3, 0.12), new THREE.Vector2(0.44, 0.035), new THREE.Vector2(0.48, 0.07), new THREE.Vector2(0.47, 0.0), new THREE.Vector2(0.2, -0.02), new THREE.Vector2(0.14, -0.02)];
    add(new THREE.LatheGeometry(roofProfile, 6), 1.68);
    for (let i = 0; i < 6; i++) {
      const phi = (i / 6) * TAU;
      const curl = add(new THREE.SphereGeometry(0.034, 8, 6), 1.76);
      curl.position.x = Math.sin(phi) * 0.475; curl.position.z = Math.cos(phi) * 0.475;
    }
    add(new THREE.CylinderGeometry(0.07, 0.09, 0.05, 10), 1.99);
    add(new THREE.LatheGeometry([new THREE.Vector2(0.001, 0.2), new THREE.Vector2(0.035, 0.17), new THREE.Vector2(0.075, 0.09), new THREE.Vector2(0.06, 0.03), new THREE.Vector2(0.045, 0.0)], 12), 2.01);
    g.position.copy(spot);
    g.rotation.y = r.range(0, TAU);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(g);
    this.lanternLight = new THREE.PointLight('#ffb062', 0, 12, 1.6);
    this.lanternLight.position.copy(spot).add(new THREE.Vector3(0, 1.5, 0));
    this.scene.add(this.lanternLight);
    this.lanternPos = this.lanternLight.position.clone();
  }

  /* ---------- floating paper lanterns (tōrō nagashi), only at night ---------- */
  buildFloatLanterns() {
    const r = this.rng.fork('floaters');
    const n = Math.round(lerp(4, 7, this.q));
    const paper = canvasTexture(128, 128, (g, w) => {
      g.fillStyle = '#f6e6c8'; g.fillRect(0, 0, w, w);
      for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(150,110,60,${r.range(0.02, 0.09)})`; g.fillRect(r.range(0, w), r.range(0, w), r.range(2, 14), 1); }
      // a small vermilion lotus on each panel
      g.fillStyle = 'rgba(196,58,40,0.9)';
      for (let k = -2; k <= 2; k++) {
        g.save(); g.translate(w / 2, w * 0.68); g.rotate(k * 0.42);
        g.beginPath(); g.ellipse(0, -22, 7, 22, 0, 0, TAU); g.fill(); g.restore();
      }
      g.strokeStyle = '#3a2416'; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, w - 8);
      g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, 4); g.lineTo(w / 2, 18); g.stroke();
    });
    this.disposables.push(paper);
    const boxGeo = new THREE.BoxGeometry(0.17, 0.2, 0.17); boxGeo.translate(0, 0.12, 0);
    const baseGeo = new THREE.BoxGeometry(0.23, 0.03, 0.23); baseGeo.translate(0, 0.012, 0);
    const baseMat = new THREE.MeshStandardMaterial({ color: '#3b2a1c', roughness: 0.8 });
    this.floaters = [];
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshStandardMaterial({ map: paper, emissiveMap: paper, emissive: '#ff9f4a', emissiveIntensity: 0, roughness: 0.9 });
      const g = new THREE.Group();
      g.add(new THREE.Mesh(baseGeo, baseMat), new THREE.Mesh(boxGeo, mat));
      const p = this.randomInPond(r, 0.8, new THREE.Vector3());
      g.position.set(p.x, WATER_Y, p.z);
      g.rotation.y = r.range(0, TAU);
      g.visible = false;
      this.scene.add(g);
      this.floaters.push({ group: g, mat, vel: new THREE.Vector3(), ph: r.range(0, TAU), spin: r.range(-0.08, 0.08) });
    }
    this.floatLight = new THREE.PointLight('#ffb468', 0, 7, 1.4);
    this.scene.add(this.floatLight);
  }

  updateFloatLanterns(dt, time) {
    if (!this.floaters) return;
    const vis = smoothstep(0.3, 0.75, this.sunState ? this.sunState.night : 0);
    const c = _v3.set(0, 0, 0);
    let count = 0;
    for (const f of this.floaters) {
      const g = f.group;
      g.visible = vis > 0.02;
      if (!g.visible) continue;
      const P = g.position;
      // a slow swirl around the nearest lobe plus a gentle wander
      const L = this.lobes.reduce((a, b) => (Math.hypot(P.x - a.x, P.z - a.z) - a.r < Math.hypot(P.x - b.x, P.z - b.z) - b.r ? a : b));
      const dx = P.x - L.x, dz = P.z - L.z, d = Math.hypot(dx, dz) || 1;
      f.vel.x += (-dz / d * 0.05 + Math.sin(time * 0.13 + f.ph) * 0.03 - f.vel.x) * dt * 0.5;
      f.vel.z += (dx / d * 0.05 + Math.cos(time * 0.11 + f.ph) * 0.03 - f.vel.z) * dt * 0.5;
      const e = this.sdf(P.x, P.z);
      if (e > -0.55) { this.sdfGrad(P.x, P.z, _v); f.vel.addScaledVector(_v, -(e + 0.55) * dt * 0.8); }
      for (const o of this.floaters) {
        if (o === f || !o.group.visible) continue;
        const ox = P.x - o.group.position.x, oz = P.z - o.group.position.z, od = Math.hypot(ox, oz);
        if (od < 0.45 && od > 1e-4) { f.vel.x += ox / od * 0.05 * dt; f.vel.z += oz / od * 0.05 * dt; }
      }
      P.x += f.vel.x * dt; P.z += f.vel.z * dt;
      P.y = WATER_Y + Math.sin(time * 1.3 + f.ph) * 0.006;
      g.rotation.y += f.spin * dt;
      g.rotation.x = Math.sin(time * 0.9 + f.ph) * 0.03;
      g.scale.setScalar(Math.max(0.001, vis));
      f.mat.emissiveIntensity = vis * (1.6 + Math.sin(time * 11 + f.ph * 7) * 0.1 + Math.sin(time * 23 + f.ph) * 0.06);
      c.add(P); count++;
    }
    if (count) {
      c.divideScalar(count);
      this.floatLight.position.set(c.x, 0.55, c.z);
    }
    this.floatLight.intensity = vis * 5;
  }


  /* ---------- cherry tree ---------- */
  buildTree() {
    const r = this.rng.fork('tree');
    // stand on the far shore of the big lobe so branches reach over the water
    let base = null, best = -Infinity, L = this.lobes[0];
    for (let i = 0; i < 160; i++) {
      const lobe = r.pick(this.lobes);
      const a = r.range(0, TAU);
      const x = lobe.x + Math.cos(a) * (lobe.r + 1.5), z = lobe.z + Math.sin(a) * (lobe.r + 1.5);
      if (this.sdf(x, z) < 0.9 || this.nearBridge(x, z, 2)) continue;
      if (this.lanternPos && Math.hypot(x - this.lanternPos.x, z - this.lanternPos.z) < 3) continue;
      const sc = this.framing(x, z, -1) + r.range(0, 0.3);
      if (sc > best) { best = sc; base = new THREE.Vector3(x, this.height(x, z) - 0.05, z); L = lobe; }
    }
    base = base || new THREE.Vector3(L.x, 0.2, L.z - L.r - 1.5);
    const toPond = new THREE.Vector3(L.x - base.x, 0, L.z - base.z).normalize();
    const geos = [];
    const tips = [];
    const grow = (p0, dirV, len, rad, depth) => {
      const pts = [p0.clone()];
      const bend = new THREE.Vector3(r.range(-0.3, 0.3), r.range(-0.15, 0.1), r.range(-0.3, 0.3));
      for (let k = 1; k <= 3; k++) {
        const t = k / 3;
        pts.push(p0.clone().addScaledVector(dirV, len * t).addScaledVector(bend, len * 0.25 * Math.sin(Math.PI * t * 0.8)));
      }
      geos.push(taperedTube(pts, rad, rad * 0.62, depth > 2 ? 8 : 5, r, depth > 3 ? 0.06 : 0));
      const end = pts[pts.length - 1];
      if (depth <= 0) { tips.push(end); return; }
      if (depth <= 1) tips.push(end.clone().lerp(p0, 0.4));
      const kids = depth >= 3 ? r.int(2, 3) : r.int(2, 3);
      for (let i = 0; i < kids; i++) {
        const nd = dirV.clone();
        const axis = new THREE.Vector3(r.range(-1, 1), r.range(-0.2, 0.2), r.range(-1, 1)).normalize();
        nd.applyAxisAngle(axis, r.range(0.35, 0.75));
        nd.addScaledVector(toPond, 0.12).normalize();
        if (nd.y < -0.1) nd.y = -0.1;
        nd.normalize();
        grow(end, nd, len * r.range(0.62, 0.78), rad * 0.6, depth - 1);
      }
    };
    const trunkDir = new THREE.Vector3(toPond.x * 0.42, 1, toPond.z * 0.42).normalize();
    grow(base, trunkDir, 2.0, 0.2, 5);
    const barkMap = woodTexture(this.env.seed + 31, [70, 58, 52]);
    barkMap.repeat.set(1, 3);
    const bark = new THREE.MeshStandardMaterial({ map: barkMap, color: '#c9bdb6', roughness: 0.92 });
    this.disposables.push(barkMap);
    const trunk = new THREE.Mesh(mergeGeometries(geos), bark);
    trunk.castShadow = true; trunk.receiveShadow = true;
    this.scene.add(trunk);
    geos.forEach(g => g.dispose());

    // blossom cards clustered around twig tips
    const tex = blossomTexture(this.env.seed + 41);
    const card = new THREE.PlaneGeometry(0.46, 0.46);
    const per = Math.round(lerp(7, 14, this.q));
    const count = tips.length * per;
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.75, emissive: new THREE.Color('#5a2a38'), emissiveIntensity: 0.25 });
    this.treeBase = base;
    this.blossomU = { uBTime: { value: 0 }, uBase: { value: base.clone() } };
    patchMaterial(mat, {
      key: 'blossom',
      uniforms: this.blossomU,
      vertexHeader: 'uniform float uBTime; uniform vec3 uBase;',
      vertex: {
        '#include <project_vertex>': `
          vec4 mvPosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
            vec3 o = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #else
            vec3 o = vec3(0.0);
          #endif
          float hgt = max(o.y - uBase.y, 0.0) / 4.0;
          float sw = sin(uBTime * 1.1 + o.x * 0.8 + o.z * 0.6) * 0.06 + sin(uBTime * 2.3 + o.z * 2.0) * 0.025;
          mvPosition.xyz += vec3(sw, sw * 0.3, sw * 0.6) * hgt;
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`,
      },
    });
    const im = new THREE.InstancedMesh(card, mat, count);
    const col = new THREE.Color();
    let i = 0;
    this.canopy = [];
    for (const tip of tips) {
      for (let k = 0; k < per; k++) {
        _v.copy(tip).add(_v2.set(r.gauss() * 0.3, r.gauss() * 0.2 + 0.05, r.gauss() * 0.3));
        _q.setFromEuler(_e.set(r.range(0, TAU), r.range(0, TAU), r.range(0, TAU)));
        _m.compose(_v, _q, _s.setScalar(r.range(0.75, 1.25)));
        im.setMatrixAt(i, _m);
        col.setHSL(0.95 + r.range(-0.02, 0.02), r.range(0.5, 0.8), r.range(0.85, 1.0));
        im.setColorAt(i, col);
        i++;
        if (k === 0) this.canopy.push(_v.clone());
      }
    }
    im.castShadow = true;
    this.scene.add(im);
    this.disposables.push(tex);
  }

  /* ---------- stepping stones and a raked gravel bed ---------- */
  buildPaths() {
    const r = this.rng.fork('paths');
    const tex = stoneTexture(this.env.seed + 13);
    const mat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normal, color: '#d8d2c4', roughness: 0.85 });
    addUnderwater(mat, this.U, { caustic: 0.5, tint: 1, moss: 0.35, key: 'step' });
    this.disposables.push(tex.map, tex.normal);
    const geo = new THREE.CylinderGeometry(1, 1, 1, 14, 1);
    const gp = geo.attributes.position;
    for (let i = 0; i < gp.count; i++) {
      const x = gp.getX(i), y = gp.getY(i), z = gp.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + Math.sin(a * 3 + 1) * 0.08 + Math.sin(a * 5) * 0.05;
      gp.setXYZ(i, x * k, y > 0 ? y + (1 - (x * x + z * z)) * 0.15 : y, z * k);
    }
    geo.computeVertexNormals();
    const stones = [];
    const B = this.bridgeLine;
    for (const [end, sgn] of [[B.a, -1], [B.b, 1]]) {
      let x = end.x, z = end.z;
      let dir = new THREE.Vector3(B.dir.x * sgn, 0, B.dir.z * sgn);
      for (let i = 0; i < 9; i++) {
        x += dir.x * 0.62; z += dir.z * 0.62;
        dir.applyAxisAngle(_up, r.range(-0.25, 0.25)).normalize();
        if (this.sdf(x, z) < 0.6 || Math.hypot(x, z) > 11) break;
        const side = (i % 2 ? 1 : -1) * 0.12;
        stones.push({ x: x - dir.z * side, z: z + dir.x * side, s: r.range(0.24, 0.34) });
      }
    }
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, stones.length));
    stones.forEach((st, i) => {
      _m.compose(_v.set(st.x, this.height(st.x, st.z) + 0.02, st.z), _q.setFromEuler(_e.set(0, r.range(0, TAU), 0)), _s.set(st.s * r.range(1, 1.3), 0.09, st.s));
      im.setMatrixAt(i, _m);
    });
    im.count = stones.length;
    im.receiveShadow = true; im.castShadow = true;
    this.scene.add(im);
    this.stepStones = stones;

    // raked gravel bed (karesansui) with rings around a feature stone, in the foreground on the left
    let best = null, bs = -Infinity;
    for (let i = 0; i < 200; i++) {
      const a = r.range(0, TAU), rr = r.range(4, 9);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (this.sdf(x, z) < 2.2 || this.nearBridge(x, z, 2.5)) continue;
      if (stones.some(st => Math.hypot(st.x - x, st.z - z) < 2.2)) continue;
      if (this.treeBase && Math.hypot(x - this.treeBase.x, z - this.treeBase.z) < 2.8) continue;
      if (this.lanternPos && Math.hypot(x - this.lanternPos.x, z - this.lanternPos.z) < 2.4) continue;
      const sc = -Math.abs(this.framing(x, z, -1) + 2.5) + r.range(0, 0.4);
      if (sc > bs) { bs = sc; best = { x, z }; }
    }
    if (best) {
      const R = 1.9;
      const gtex = canvasTexture(512, 512, (g, w) => {
        const img = g.createImageData(w, w);
        const n = createNoise(this.env.seed + 99);
        for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
          const u = x / w * 2 - 1, v = y / w * 2 - 1;
          const d = Math.hypot(u, v);
          const ring = d < 0.36 ? 0 : Math.sin(d * 52) * 0.5 + 0.5;
          const lines = Math.sin((v + n.noise2(u * 3, v * 3) * 0.01) * 70) * 0.5 + 0.5;
          const pat = d < 0.62 ? ring : lines;
          const grain = (n.noise2(x * 0.9, y * 0.9) * 0.5 + 0.5) * 0.35 + 0.65;
          const g0 = (168 + pat * 52) * grain;
          const i = (y * w + x) * 4;
          img.data[i] = g0; img.data[i + 1] = g0 * 0.98; img.data[i + 2] = g0 * 0.94;
          img.data[i + 3] = d > 0.98 ? 0 : 255;
        }
        g.putImageData(img, 0, 0);
      });
      const hcanvas = gtex.image;
      const gnorm = normalMapFromHeight(hcanvas, 3, false);
      const gm = new THREE.MeshStandardMaterial({ map: gtex, normalMap: gnorm, alphaTest: 0.5, roughness: 0.95 });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(R, 48), gm);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(best.x, this.height(best.x, best.z) + 0.035, best.z);
      disc.receiveShadow = true;
      this.scene.add(disc);
      // a raised rim of small stones
      const rim = new THREE.InstancedMesh(geo, mat, 40);
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * TAU;
        const x = best.x + Math.cos(a) * R * 1.0, z = best.z + Math.sin(a) * R * 1.0;
        _m.compose(_v.set(x, this.height(x, z) + 0.02, z), _q.setFromEuler(_e.set(0, a, 0)), _s.set(0.12, 0.07, 0.09));
        rim.setMatrixAt(i, _m);
      }
      this.scene.add(rim);
      const rock = rockGeometry(r, this.noise, 3);
      const fr = new THREE.Mesh(rock, this.rockMat);
      fr.position.set(best.x, this.height(best.x, best.z) + 0.1, best.z);
      fr.scale.set(0.5, 0.42, 0.42);
      fr.castShadow = true;
      this.scene.add(fr);
      this.disposables.push(gtex, gnorm);
    }
  }

  /* ---------- bamboo grove around the garden ---------- */
  buildBamboo() {
    const r = this.rng.fork('bamboo');
    this.wind = createWind({ direction: new THREE.Vector2(0.8, 0.4), strength: 1, gust: 1 });
    const n = Math.round(lerp(70, 150, this.q));
    const culm = new THREE.CylinderGeometry(0.06, 0.075, 1, 7, 10, true);
    culm.translate(0, 0.5, 0);
    const tex = bambooTexture();
    tex.repeat.set(1, 6);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55 });
    addWind(mat, this.wind, { height: 1, amount: 0.035, stiffness: 2.2, key: 'bamboo' });
    const im = new THREE.InstancedMesh(culm, mat, n);
    const leafGeo = new THREE.PlaneGeometry(1.4, 1.4);
    leafGeo.translate(0, 0.0, 0);
    const leafTex = bambooLeafTexture(this.env.seed + 51);
    const leafMat = new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7 });
    addWind(leafMat, this.wind, { height: 1, amount: 0.25, stiffness: 1, flutter: 0.04, key: 'bambooleaf' });
    const leavesPer = Math.round(lerp(4, 8, this.q));
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, n * leavesPer);
    let li = 0, ci = 0;
    for (let i = 0; i < n * 3 && ci < n; i++) {
      const a = r.range(0, TAU), rr = r.range(13.5, 21);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (this.sdf(x, z) < 3) continue;
      const h = r.range(6, 10.5);
      const y = this.height(x, z) - 0.1;
      _m.compose(_v.set(x, y, z), _q.setFromEuler(_e.set(r.range(-0.06, 0.06), r.range(0, TAU), r.range(-0.06, 0.06))), _s.set(r.range(0.8, 1.3), h, r.range(0.8, 1.3)));
      im.setMatrixAt(ci++, _m);
      for (let k = 0; k < leavesPer && li < n * leavesPer; k++) {
        const ly = y + h * r.range(0.55, 1.0);
        _m.compose(_v.set(x + r.gauss() * 0.6, ly, z + r.gauss() * 0.6), _q.setFromEuler(_e.set(r.range(-0.6, 0.6), r.range(0, TAU), r.range(-0.6, 0.6))), _s.setScalar(r.range(0.8, 1.4)));
        leaves.setMatrixAt(li++, _m);
      }
    }
    im.count = ci; leaves.count = li;
    im.castShadow = true; leaves.castShadow = true;
    this.scene.add(im, leaves);
    this.disposables.push(tex, leafTex);
  }

  /* ---------- clipped azalea mounds, ferns, iris ---------- */
  buildShrubs() {
    const r = this.rng.fork('shrubs');
    const leafy = leafyTexture(this.env.seed + 61, [74, 112, 46]);
    leafy.map.repeat.set(3, 3); leafy.normal.repeat.set(3, 3);
    const mat = new THREE.MeshStandardMaterial({ map: leafy.map, normalMap: leafy.normal, normalScale: new THREE.Vector2(1.4, 1.4), roughness: 0.85 });
    const geo = new THREE.IcosahedronGeometry(1, 4);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i);
      const s = 1 + this.noise.fbm3(_v.x * 1.6, _v.y * 1.6, _v.z * 1.6, 3) * 0.12;
      _v.multiplyScalar(s);
      if (_v.y < -0.3) _v.y = -0.3;
      p.setXYZ(i, _v.x, _v.y, _v.z);
    }
    geo.computeVertexNormals();
    const list = [];
    for (let i = 0; i < 300 && list.length < Math.round(lerp(12, 22, this.q)); i++) {
      const a = r.range(0, TAU), rr = r.range(6.5, 12.5);
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      if (this.sdf(x, z) < 0.9 || this.nearBridge(x, z, 1.5)) continue;
      if (this.treeBase && Math.hypot(x - this.treeBase.x, z - this.treeBase.z) < 1.4) continue;
      if (this.lanternPos && Math.hypot(x - this.lanternPos.x, z - this.lanternPos.z) < 1.3) continue;
      if (list.some(o => Math.hypot(o.x - x, o.z - z) < 1.6)) continue;
      list.push({ x, z, s: r.range(0.5, 1.05) });
    }
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    const col = new THREE.Color();
    list.forEach((o, i) => {
      _m.compose(_v.set(o.x, this.height(o.x, o.z) + 0.15 * o.s, o.z), _q.setFromEuler(_e.set(0, r.range(0, TAU), 0)), _s.set(o.s * r.range(1.1, 1.5), o.s * r.range(0.62, 0.8), o.s * r.range(1.0, 1.3)));
      im.setMatrixAt(i, _m);
      col.setHSL(r.range(0.2, 0.3), r.range(0.35, 0.55), r.range(0.55, 0.8));
      im.setColorAt(i, col);
    });
    im.castShadow = true; im.receiveShadow = true;
    this.scene.add(im);

    // grass / fern tufts along the shore and around stones
    const blade = new THREE.PlaneGeometry(0.03, 0.3, 1, 4);
    blade.translate(0, 0.15, 0);
    const pa = blade.attributes.position;
    for (let i = 0; i < pa.count; i++) { const y = pa.getY(i); pa.setX(i, pa.getX(i) * (1 - y / 0.33)); pa.setZ(i, (y / 0.3) ** 2 * 0.06); }
    blade.computeVertexNormals();
    const gmat = new THREE.MeshStandardMaterial({ color: '#7d9a3c', side: THREE.DoubleSide, roughness: 0.8 });
    addWind(gmat, this.wind, { height: 0.3, amount: 0.1, stiffness: 1.6, key: 'tuft' });
    const nb = Math.round(lerp(1500, 4000, this.q));
    const grass = new THREE.InstancedMesh(blade, gmat, nb);
    let gi = 0;
    for (let i = 0; i < nb * 4 && gi < nb; i++) {
      const a = r.range(0, TAU), rr = Math.sqrt(r.next()) * 14;
      const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const d = this.sdf(x, z);
      const nearShore = d > 0.3 && d < 0.9;
      const clumpy = this.noise.noise2(x * 1.3, z * 1.3) > 0.45;
      if (!(nearShore && r.chance(0.55)) && !(d > 1 && clumpy && r.chance(0.3))) continue;
      if (this.nearBridge(x, z, 0.2)) continue;
      _m.compose(_v.set(x, this.height(x, z) - 0.01, z), _q.setFromEuler(_e.set(r.range(-0.25, 0.25), r.range(0, TAU), r.range(-0.25, 0.25))), _s.set(1, r.range(0.6, 1.4), 1));
      grass.setMatrixAt(gi, _m);
      col.setHSL(r.range(0.2, 0.27), r.range(0.4, 0.6), r.range(0.3, 0.45));
      grass.setColorAt(gi, col);
      gi++;
    }
    grass.count = gi;
    grass.receiveShadow = true;
    this.scene.add(grass);

    // iris clumps at the water's edge
    const irisLeaf = new THREE.PlaneGeometry(0.05, 0.8, 1, 5); irisLeaf.translate(0, 0.4, 0);
    const il = irisLeaf.attributes.position;
    for (let i = 0; i < il.count; i++) { const y = il.getY(i); il.setX(i, il.getX(i) * (1 - (y / 0.85) ** 2)); il.setZ(i, (y / 0.8) ** 2 * 0.12); }
    irisLeaf.computeVertexNormals();
    const leafMat = new THREE.MeshStandardMaterial({ color: '#4f7a33', side: THREE.DoubleSide, roughness: 0.7 });
    addWind(leafMat, this.wind, { height: 0.8, amount: 0.08, stiffness: 1.8, key: 'iris' });
    const flowerGeo = new THREE.SphereGeometry(0.06, 8, 6); flowerGeo.scale(1.4, 0.8, 1.4);
    const flowerMat = new THREE.MeshStandardMaterial({ color: '#6d4fc4', roughness: 0.6, emissive: '#2a1660', emissiveIntensity: 0.2 });
    const clumps = 5, leavesPer = 14;
    const irisL = new THREE.InstancedMesh(irisLeaf, leafMat, clumps * leavesPer);
    const irisF = new THREE.InstancedMesh(flowerGeo, flowerMat, clumps * 3);
    let li = 0, fi = 0;
    for (let c = 0; c < clumps; c++) {
      let x = 0, z = 0, ok = false;
      for (let k = 0; k < 40 && !ok; k++) {
        const L = r.pick(this.lobes), a = r.range(0, TAU);
        x = L.x + Math.cos(a) * L.r; z = L.z + Math.sin(a) * L.r;
        for (let j = 0; j < 8; j++) { const d = this.sdf(x, z); this.sdfGrad(x, z, _v); x -= _v.x * (d - 0.05); z -= _v.z * (d - 0.05); }
        ok = !this.nearBridge(x, z, 1.2);
      }
      const y = Math.max(this.height(x, z), -0.05);
      for (let k = 0; k < leavesPer; k++) {
        _m.compose(_v.set(x + r.gauss() * 0.12, y, z + r.gauss() * 0.12), _q.setFromEuler(_e.set(r.range(-0.3, 0.3), r.range(0, TAU), r.range(-0.3, 0.3))), _s.set(1, r.range(0.7, 1.2), 1));
        irisL.setMatrixAt(li++, _m);
      }
      for (let k = 0; k < 3; k++) {
        _m.compose(_v.set(x + r.gauss() * 0.15, y + r.range(0.6, 0.85), z + r.gauss() * 0.15), _q.identity(), _s.setScalar(r.range(0.8, 1.2)));
        irisF.setMatrixAt(fi++, _m);
      }
    }
    this.scene.add(irisL, irisF);
    this.disposables.push(leafy.map, leafy.normal);
  }

  /* ---------- water lilies ---------- */
  buildLilies() {
    const r = this.rng.fork('lilies');
    const padTex = lilyPadTexture(this.env.seed + 71);
    const padMat = new THREE.MeshStandardMaterial({ map: padTex, roughness: 0.38, side: THREE.DoubleSide });
    const petalTex = lilyPetalTexture();
    const petalMat = new THREE.MeshStandardMaterial({ map: petalTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.6, emissive: '#3a2a30', emissiveIntensity: 0.15 });
    const petalGeo = new THREE.PlaneGeometry(0.09, 0.2, 1, 3); petalGeo.translate(0, 0.1, 0);
    const pp = petalGeo.attributes.position;
    for (let i = 0; i < pp.count; i++) { const y = pp.getY(i); pp.setZ(i, -Math.pow(y / 0.2, 2) * 0.03); }
    petalGeo.computeVertexNormals();
    const centerMat = new THREE.MeshStandardMaterial({ color: '#f2c330', emissive: '#7a5a00', emissiveIntensity: 0.3, roughness: 0.6 });
    this.pads = [];
    this.flowers = [];
    const groups = r.int(2, 3);
    for (let gI = 0; gI < groups; gI++) {
      const c = this.randomInPond(r, 1.3, new THREE.Vector3());
      if (this.nearBridge(c.x, c.z, 1.8)) continue;
      const n = r.int(4, 7);
      for (let i = 0; i < n; i++) {
        const rad = r.range(0.22, 0.42);
        const geo = new THREE.CircleGeometry(rad, 28, r.range(0, TAU), TAU - r.range(0.35, 0.55));
        geo.rotateX(-Math.PI / 2);
        const gp = geo.attributes.position;
        for (let k = 0; k < gp.count; k++) { const x = gp.getX(k), z = gp.getZ(k); gp.setY(k, (x * x + z * z) / (rad * rad) * 0.018); }
        geo.computeVertexNormals();
        const pad = new THREE.Mesh(geo, padMat);
        const x = c.x + r.gauss() * 0.7, z = c.z + r.gauss() * 0.7;
        if (this.sdf(x, z) > -0.5) { geo.dispose(); continue; }
        pad.position.set(x, WATER_Y + 0.006, z);
        pad.rotation.y = r.range(0, TAU);
        pad.receiveShadow = true;
        this.scene.add(pad);
        this.pads.push({ mesh: pad, home: pad.position.clone(), phase: r.range(0, TAU), spin: r.range(-0.02, 0.02), bob: 0 });
        if (r.chance(0.32) && this.flowers.length < 5) {
          const f = new THREE.Group();
          const petals = [];
          for (let ring = 0; ring < 3; ring++) {
            const cnt = 10 - ring * 2;
            for (let k = 0; k < cnt; k++) {
              const m = new THREE.Mesh(petalGeo, petalMat);
              const holder = new THREE.Group();
              holder.rotation.y = (k / cnt) * TAU + ring * 0.3;
              m.scale.setScalar(1 - ring * 0.18);
              holder.add(m);
              f.add(holder);
              petals.push({ m, ring });
            }
          }
          const center = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), centerMat);
          center.scale.y = 0.6; center.position.y = 0.02;
          f.add(center);
          f.position.set(x + r.range(-0.08, 0.08), WATER_Y + 0.02, z + r.range(-0.08, 0.08));
          f.scale.setScalar(r.range(0.9, 1.25));
          this.scene.add(f);
          this.flowers.push({ group: f, petals, open: 1, pad: this.pads[this.pads.length - 1] });
        }
      }
    }
    this.disposables.push(padTex, petalTex);
  }

  /* ---------- bamboo spout (kakei) pouring into the pond ---------- */
  buildSpout() {
    const r = this.rng.fork('spout');
    const L = this.lobes[1];
    let x = L.x, z = L.z;
    for (let i = 0; i < 40; i++) {
      const a = r.range(0, TAU);
      x = L.x + Math.cos(a) * L.r; z = L.z + Math.sin(a) * L.r;
      for (let k = 0; k < 10; k++) { const d = this.sdf(x, z); this.sdfGrad(x, z, _v); x -= _v.x * (d - 0.6); z -= _v.z * (d - 0.6); }
      if (!this.nearBridge(x, z, 2)) break;
    }
    this.sdfGrad(x, z, _v);
    const inward = _v.clone().negate();
    const y0 = this.height(x, z);
    const mouth = new THREE.Vector3(x + inward.x * 0.75, y0 + 0.55, z + inward.z * 0.75);
    const back = new THREE.Vector3(x - inward.x * 0.9, y0 + 0.75, z - inward.z * 0.9);
    const tex = bambooTexture(); tex.repeat.set(1, 1);
    const bamboo = new THREE.MeshStandardMaterial({ map: tex, color: '#c9c08a', roughness: 0.6 });
    const pipe = new THREE.Mesh(taperedTube([back, back.clone().lerp(mouth, 0.5), mouth], 0.05, 0.045, 8), bamboo);
    pipe.castShadow = true;
    this.scene.add(pipe);
    for (const t of [0.25, 0.75]) {
      const p = back.clone().lerp(mouth, t);
      const gy = this.height(p.x, p.z);
      for (const s of [-1, 1]) {
        const side = new THREE.Vector3(-inward.z, 0, inward.x).multiplyScalar(0.1 * s);
        const stick = new THREE.Mesh(taperedTube([new THREE.Vector3(p.x + side.x, gy - 0.05, p.z + side.z), new THREE.Vector3(p.x - side.x * 0.3, p.y + 0.06, p.z - side.z * 0.3)], 0.022, 0.018, 5), bamboo);
        this.scene.add(stick);
      }
    }
    // the falling stream
    const hit = new THREE.Vector3(mouth.x + inward.x * 0.16, WATER_Y, mouth.z + inward.z * 0.16);
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(new THREE.Vector3(lerp(mouth.x + inward.x * 0.03, hit.x, t), lerp(mouth.y - 0.01, hit.y, t * t), lerp(mouth.z + inward.z * 0.03, hit.z, t)));
    }
    const alpha = canvasTexture(16, 128, (g, w, h) => { for (let y = 0; y < h; y++) { const v = 0.55 + 0.45 * Math.sin(y * 0.35) * Math.sin(y * 0.13 + 1); g.fillStyle = `rgb(${v * 255},${v * 255},${v * 255})`; g.fillRect(0, y, w, 1); } }, { srgb: false, repeat: [1, 3] });
    this.streamAlpha = alpha;
    const streamMat = new THREE.MeshStandardMaterial({ color: '#e8f4ff', roughness: 0.1, transparent: true, opacity: 0.75, alphaMap: alpha, emissive: '#3a4a55', emissiveIntensity: 0.4, depthWrite: false });
    const stream = new THREE.Mesh(taperedTube(pts, 0.016, 0.022, 6), streamMat);
    this.scene.add(stream);
    this.spoutHit = hit;
    this.disposables.push(tex, alpha);
  }

  /* ---------- petals, splashes, fireflies, food ---------- */
  buildParticles() {
    const r = this.rng.fork('particles');
    // petals
    this.petalMax = Math.round(lerp(220, 520, this.q));
    const petalGeo = new THREE.PlaneGeometry(0.075, 0.09);
    const petalMat = new THREE.MeshStandardMaterial({ map: petalTexture(), alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.6, emissive: '#4a2a32', emissiveIntensity: 0.25 });
    this.disposables.push(petalMat.map);
    this.petalMesh = new THREE.InstancedMesh(petalGeo, petalMat, this.petalMax);
    this.petalMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.petalMesh.frustumCulled = false;
    this.scene.add(this.petalMesh);
    this.petals = [];
    // pre-seed floating petals so the pond already looks lived in
    for (let i = 0; i < this.petalMax * 0.3; i++) {
      const p = this.spawnPetal(r);
      const c = this.randomInPond(r, 0.3, _v);
      if (r.chance(0.6) && this.canopy.length) { const t = r.pick(this.canopy); c.set(t.x + r.gauss() * 1.6, 0, t.z + r.gauss() * 1.6); }
      if (this.sdf(c.x, c.z) < -0.15) { p.pos.set(c.x, WATER_Y + 0.003, c.z); p.mode = 1; p.age = r.range(0, 60); }
      else { p.pos.set(c.x, this.height(c.x, c.z) + 0.01, c.z); p.mode = 2; p.age = r.range(0, 20); }
    }
    this.petalTimer = 0;

    // splash droplets
    this.dropMax = 220;
    const dg = new THREE.BufferGeometry();
    this.dropPos = new Float32Array(this.dropMax * 3);
    this.dropAlpha = new Float32Array(this.dropMax);
    dg.setAttribute('position', new THREE.BufferAttribute(this.dropPos, 3));
    dg.setAttribute('aAlpha', new THREE.BufferAttribute(this.dropAlpha, 1));
    const sprite = softDiscTexture(64, 0.3);
    this.disposables.push(sprite);
    const dm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uMap: { value: sprite }, uScale: { value: 1 }, uColor: { value: new THREE.Color('#dff3ff') } },
      vertexShader: 'attribute float aAlpha; varying float vA; uniform float uScale; void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = uScale * 0.06 * 600.0 / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D uMap; uniform vec3 uColor; varying float vA; void main(){ float a = texture2D(uMap, gl_PointCoord).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(uColor * a, a); }',
    });
    this.dropPoints = new THREE.Points(dg, dm);
    this.dropPoints.frustumCulled = false;
    this.scene.add(this.dropPoints);
    this.drops = [];

    // fireflies
    const nf = Math.round(lerp(30, 70, this.q));
    const fg = new THREE.BufferGeometry();
    this.flyPos = new Float32Array(nf * 3);
    const phase = new Float32Array(nf);
    this.flies = [];
    for (let i = 0; i < nf; i++) {
      const L = r.pick(this.lobes), a = r.range(0, TAU), rr = L.r + r.range(-0.5, 2.5);
      const x = L.x + Math.cos(a) * rr, z = L.z + Math.sin(a) * rr;
      this.flies.push({ base: new THREE.Vector3(x, Math.max(this.height(x, z), 0) + r.range(0.25, 1.6), z), ph: r.range(0, TAU), sp: r.range(0.3, 0.8) });
      phase[i] = r.range(0, TAU);
    }
    fg.setAttribute('position', new THREE.BufferAttribute(this.flyPos, 3));
    fg.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    this.flyMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uMap: { value: sprite }, uT: { value: 0 }, uNight: { value: 0 } },
      vertexShader: 'attribute float aPhase; varying float vA; uniform float uT, uNight; void main(){ vA = uNight * pow(max(sin(uT * 1.6 + aPhase * 3.0), 0.0), 3.0); vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = 0.11 * 600.0 / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D uMap; varying float vA; void main(){ float a = texture2D(uMap, gl_PointCoord).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(0.85, 1.0, 0.45) * a * 3.0, a); }',
    });
    this.flyPoints = new THREE.Points(fg, this.flyMat);
    this.flyPoints.frustumCulled = false;
    this.scene.add(this.flyPoints);

    // floating food pellets
    this.foodMax = 90;
    const pellet = new THREE.SphereGeometry(0.024, 10, 8);
    const foodMat = new THREE.MeshStandardMaterial({ color: '#b5652a', roughness: 0.55 });
    this.foodMesh = new THREE.InstancedMesh(pellet, foodMat, this.foodMax);
    this.foodMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.foodMesh.frustumCulled = false;
    this.foodMesh.count = 0;
    this.scene.add(this.foodMesh);
  }

  spawnPetal(r = this.rng) {
    const p = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(r.range(0, TAU), r.range(0, TAU), r.range(0, TAU)), spin: new THREE.Vector3(r.range(-3, 3), r.range(-2, 2), r.range(-3, 3)), mode: 0, age: 0, life: r.range(70, 140), ph: r.range(0, TAU) };
    if (this.petals.length >= this.petalMax) this.petals.shift();
    this.petals.push(p);
    return p;
  }

  splash(x, y, z, n = 8, power = 1) {
    for (let i = 0; i < n; i++) {
      if (this.drops.length >= this.dropMax) this.drops.shift();
      const a = Math.random() * TAU, s = (0.25 + Math.random() * 0.5) * power;
      this.drops.push({ p: new THREE.Vector3(x, y + 0.02, z), v: new THREE.Vector3(Math.cos(a) * s * 0.6, (0.8 + Math.random() * 0.9) * power, Math.sin(a) * s * 0.6), life: 1 });
    }
  }

  /* ---------- koi ---------- */
  buildKoi() {
    this.koiGeo = buildFishGeometry('koi', { detail: this.q >= 0.6 ? 1 : 0.65 });
    this.butterflyGeo = buildFishGeometry('koiButterfly', { detail: this.q >= 0.6 ? 1 : 0.65 });
    for (const m of this.env.members) this.addKoi(m, false);
  }
  addKoi(member, fresh) {
    const r = makeRng(member.seed || 1);
    let variety = member.kind;
    let shape = 'koi';
    if (member.kind === 'hirenaga') { shape = 'koiButterfly'; variety = r.pick(['kohaku', 'ogon', 'platinum', 'showa', 'kigoi']); }
    const painted = paintFish('koi', { seed: member.seed, variety, shape, size: this.q >= 0.6 ? [768, 384] : [512, 256] });
    const mat = createFishMaterial(painted, { waveK: 6.0 });
    addUnderwater(mat, this.U, { caustic: 0.9, tint: 0.92, key: 'koi' });
    const mesh = new THREE.Mesh(shape === 'koi' ? this.koiGeo : this.butterflyGeo, mat);
    mesh.castShadow = true;
    mesh.customDepthMaterial = createSwimDepthMaterial(mat.userData.swimUniforms);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const start = this.randomInPond(r, 0.9, new THREE.Vector3());
    const depth = r.range(0.2, 0.6);
    start.y = WATER_Y - depth;
    const sw = new Swimmer({ pos: start, size: 1, speed: 0.25, rng: r, maxPitch: 0.35, agility: 1.4, beat: 0.75 });
    const k = { member, mesh, mat, sw, painted, rng: r, depth, target: this.randomInPond(r, 1.0, new THREE.Vector3()), retarget: r.range(2, 8), gulp: 0, wakeT: r.range(0, 1), mode: 'cruise', scale: 0.6, speed: r.range(0.18, 0.32) };
    k.target.y = WATER_Y - depth;
    this.koi.push(k);
    if (fresh) { this.addRipple(start.x, start.z, 1.2); this.splash(start.x, WATER_Y, start.z, 10, 1); }
    return k;
  }

  /* ---------- feeding ---------- */
  feed(raycaster) {
    // the bridge blocks clicks behind it
    const hitB = raycaster.intersectObject(this.bridge, true)[0];
    const p = raycaster.ray.intersectPlane(this.waterPlane, _v3);
    if (!p) return null;
    if (hitB && hitB.distance < raycaster.ray.origin.distanceTo(p)) return null;
    if (this.sdf(p.x, p.z) > -0.12) return null;
    this.dropFood(p.x, p.z, 6);
    return p.clone();
  }
  feedRandom() {
    // toss near the koi that are closest to the camera so it is visible
    const cam = this.camera.position;
    let best = null, bd = Infinity;
    for (const k of this.koi) { const d = k.sw.pos.distanceTo(cam); if (d < bd) { bd = d; best = k; } }
    const c = best ? best.sw.pos.clone() : this.randomInPond(this.rng, 1.2, new THREE.Vector3());
    for (let i = 0; i < 3; i++) {
      const x = c.x + (Math.random() - 0.5) * 2.4, z = c.z + (Math.random() - 0.5) * 2.4;
      if (this.sdf(x, z) < -0.25) this.dropFood(x, z, 5);
    }
    return 1;
  }
  dropFood(x, z, n) {
    for (let i = 0; i < n; i++) {
      if (this.foods.length >= this.foodMax) this.foods.shift();
      const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * 0.22;
      this.foods.push({ pos: new THREE.Vector3(x + Math.cos(a) * rr, WATER_Y + 0.004, z + Math.sin(a) * rr), vel: new THREE.Vector3((Math.random() - 0.5) * 0.04, 0, (Math.random() - 0.5) * 0.04), age: 0, ph: Math.random() * TAU, taken: false });
    }
    this.addRipple(x, z, 0.9);
    this.splash(x, WATER_Y, z, 6, 0.6);
    this.env.sfx('drop');
  }

  /* ---------- time of day ---------- */
  updateTimeOfDay(force = false) {
    const S = this.env.sun({ azimuthOffset: 0.7 });
    const night = S.night, day = S.day;
    this.sunState = S;
    // sun or moon drives the key light
    const useMoon = S.elevationDeg < -2;
    const dir = useMoon ? S.moonDir : S.dir;
    const center = new THREE.Vector3(0, 0, 0);
    this.sun.position.copy(center).addScaledVector(dir, 40);
    this.sun.target.position.copy(center);
    this.sun.color.copy(useMoon ? new THREE.Color('#a9bfff') : S.sunColor);
    this.sun.intensity = useMoon ? 0.95 : S.sunIntensity * 1.15 + S.golden * 0.6;
    this.hemi.color.copy(S.skyAmbient).lerp(new THREE.Color('#3a5288'), night * 0.6);
    this.hemi.groundColor.copy(S.groundAmbient).lerp(new THREE.Color('#3a4a22'), 0.4);
    this.hemi.intensity = Math.max(0.45, S.ambientIntensity) * 0.95 + night * 0.75;
    const u = this.skyMat.uniforms;
    u.uZenith.value.copy(S.zenith); u.uHorizon.value.copy(S.horizon);
    u.uSunDir.value.copy(S.dir); u.uSunColor.value.copy(S.sunColor);
    u.uMoonDir.value.copy(S.moonDir); u.uNight.value = night;
    u.uGround.value.copy(S.groundAmbient).multiplyScalar(0.5);
    this.scene.fog.color.copy(S.horizon).lerp(S.zenith, 0.35).multiplyScalar(lerp(1, 0.75, night));
    this.scene.fog.density = lerp(0.01, 0.016, Math.max(night, S.golden * 0.5));
    // underwater look
    this.U.uCaustic.value = useMoon ? 0.08 : clamp(S.sunIntensity / 2.8, 0, 1.1);
    this.U.uWaterColor.value.copy(new THREE.Color('#1f4535')).lerp(new THREE.Color('#0b1a2c'), night).multiplyScalar(lerp(1, 0.85, night));
    // lantern
    const glow = smoothstep(0.15, 0.7, night);
    this.lanternGlow.emissiveIntensity = glow * 3.2;
    this.lanternLight.intensity = glow * 14;
    this.flyMat.uniforms.uNight.value = glow;
    // env map from the sky, refreshed when the light changes
    const key = Math.round(S.hours * 6);
    if (force || key !== this.envKey) {
      this.envKey = key;
      const rt = this.env.pmrem.fromScene(this.skyScene, 0.02);
      if (this.envRT) this.envRT.dispose();
      this.envRT = rt;
      this.scene.environment = rt.texture;
    }
    // post
    if (this.post) {
      this.post.bloom.strength = lerp(0.22, 0.65, night);
      this.post.bloom.threshold = lerp(0.9, 0.55, night);
      this.post.exposure = lerp(1.0, 1.45, night) + S.golden * 0.15;
      this.post.gain = [lerp(1.02, 0.95, night) + S.golden * 0.04, 1.0, lerp(0.97, 1.08, night) - S.golden * 0.04];
      this.post.saturation = lerp(1.06, 0.92, night);
    }
  }

  /* ---------- per frame ---------- */
  update(dt, t) {
    this.time += dt;
    const time = this.time;
    this.U.uKTime.value = time;
    this.waterU.uWTime.value = time;
    this.blossomU.uBTime.value = time;
    this.flyMat.uniforms.uT.value = time;
    this.wind.update(dt);
    this.streamAlpha.offset.y -= dt * 2.2;
    this.todTimer = (this.todTimer || 0) - dt;
    if (this.todTimer <= 0) { this.todTimer = 0.5; this.updateTimeOfDay(); }

    this.updateFood(dt);
    this.updateKoi(dt, time);
    this.updatePetals(dt, time);
    this.updatePads(dt, time);
    this.updateDrops(dt);
    this.updateFlies(time);
    this.updateFloatLanterns(dt, time);

    // spout keeps the water alive
    this.spoutT = (this.spoutT || 0) - dt;
    if (this.spoutT <= 0) {
      this.spoutT = 0.45 + Math.random() * 0.35;
      this.addRipple(this.spoutHit.x + (Math.random() - 0.5) * 0.04, this.spoutHit.z + (Math.random() - 0.5) * 0.04, 0.45);
      if (Math.random() < 0.6) this.splash(this.spoutHit.x, WATER_Y, this.spoutHit.z, 2, 0.35);
    }
  }

  updateFood(dt) {
    const fm = this.foodMesh;
    let n = 0;
    for (let i = this.foods.length - 1; i >= 0; i--) {
      const f = this.foods[i];
      f.age += dt;
      f.pos.addScaledVector(f.vel, dt);
      f.vel.multiplyScalar(Math.exp(-0.3 * dt));
      // ripples nudge floating food
      for (const rp of this.ripples) {
        const age = this.time - rp.t;
        if (age < 0 || age > 2.5) continue;
        const d = Math.hypot(f.pos.x - rp.x, f.pos.z - rp.z);
        if (Math.abs(d - age * 0.5) < 0.12 && d > 1e-3) { f.vel.x += (f.pos.x - rp.x) / d * 0.03 * rp.amp * dt * 8; f.vel.z += (f.pos.z - rp.z) / d * 0.03 * rp.amp * dt * 8; }
      }
      if (this.sdf(f.pos.x, f.pos.z) > -0.15) { this.sdfGrad(f.pos.x, f.pos.z, _v); f.vel.addScaledVector(_v, -0.05); }
      if (f.age > 90) { this.foods.splice(i, 1); continue; }
    }
    for (const f of this.foods) {
      const sink = f.age > 70 ? (f.age - 70) * 0.004 : 0;
      _m.compose(_v.set(f.pos.x, WATER_Y + 0.002 + Math.sin(this.time * 2 + f.ph) * 0.003 - sink, f.pos.z), _q.identity(), _s.setScalar(1));
      fm.setMatrixAt(n++, _m);
    }
    fm.count = n;
    fm.instanceMatrix.needsUpdate = true;
  }

  updateKoi(dt, time) {
    const cam = this.camera.position;
    const desired = _v2;
    // begging spot: shoreline toward the camera
    if (!this.begSpot || (this.begT = (this.begT || 0) - dt) <= 0) {
      this.begT = 3;
      const L = this.lobes.reduce((a, b) => (Math.hypot(a.x - cam.x, a.z - cam.z) < Math.hypot(b.x - cam.x, b.z - cam.z) ? a : b));
      const dx = cam.x - L.x, dz = cam.z - L.z, l = Math.hypot(dx, dz) || 1;
      let s = 0;
      while (this.sdf(L.x + dx / l * s, L.z + dz / l * s) < -0.8 && s < 12) s += 0.1;
      this.begSpot = new THREE.Vector3(L.x + dx / l * s, WATER_Y - 0.08, L.z + dz / l * s);
    }
    const night = this.sunState ? this.sunState.night : 0;
    for (const k of this.koi) {
      const sw = k.sw, m = k.member;
      k.scale = 0.7 * (m.size || 1) * (k.mesh.geometry === this.butterflyGeo ? 1.08 : 1);
      const hungry = this.env.fullness(m) < 0.3;
      // nearest food
      let food = null, fd = 7.5;
      for (const f of this.foods) { const d = Math.hypot(f.pos.x - sw.pos.x, f.pos.z - sw.pos.z); if (d < fd) { fd = d; food = f; } }
      let speed = k.speed * (1 - night * 0.45);
      if (food) {
        k.mode = 'feed';
        _v.set(food.pos.x, WATER_Y - 0.075, food.pos.z);
        // aim the mouth, not the centre
        sw.seek(_v, 0.85, 0.35, desired);
        speed = 0.85;
        const head = _v3.copy(sw.fwd).multiplyScalar(0.42 * k.scale).add(sw.pos);
        if (Math.hypot(head.x - food.pos.x, head.z - food.pos.z) < 0.09 + 0.05 * k.scale && sw.pos.y > WATER_Y - 0.25) {
          this.foods.splice(this.foods.indexOf(food), 1);
          k.gulp = 1;
          this.addRipple(food.pos.x, food.pos.z, 0.8);
          this.splash(food.pos.x, WATER_Y, food.pos.z, 4, 0.45);
          this.env.onEat(m, _v.set(food.pos.x, WATER_Y + 0.05, food.pos.z));
        }
      } else {
        if (k.mode === 'feed') { k.mode = 'cruise'; k.retarget = 0; }
        k.retarget -= dt;
        const wantBeg = hungry && this.begSpot && (m.seed % 3 !== 0);
        if (wantBeg) {
          k.mode = 'beg';
          _v.copy(this.begSpot).add(_v3.set(Math.sin(time * 0.3 + m.seed) * 0.7, 0, Math.cos(time * 0.27 + m.seed) * 0.7));
          sw.seek(_v, 0.3, 0.8, desired);
          // gulping air at the surface
          k.wakeT -= dt;
          if (k.wakeT <= 0 && sw.pos.distanceTo(this.begSpot) < 1.5) { k.wakeT = 1.5 + Math.random() * 2.5; k.gulp = 0.7; this.addRipple(sw.pos.x + sw.fwd.x * 0.3 * k.scale, sw.pos.z + sw.fwd.z * 0.3 * k.scale, 0.5); }
        } else {
          k.mode = 'cruise';
          if (k.retarget <= 0 || sw.pos.distanceTo(k.target) < 0.6) {
            k.retarget = k.rng.range(4, 11);
            // sometimes follow another koi
            if (k.rng.chance(0.35) && this.koi.length > 1) {
              const o = k.rng.pick(this.koi);
              if (o !== k) k.follow = o;
            } else k.follow = null;
            this.randomInPond(k.rng, 0.9, k.target);
            k.depth = clamp(k.depth + k.rng.range(-0.2, 0.2), 0.16, 0.7) * (1 + night * 0.25);
            k.target.y = WATER_Y - k.depth;
          }
          if (k.follow) { _v.copy(k.follow.sw.pos).addScaledVector(k.follow.sw.fwd, -0.55); _v.y = WATER_Y - k.depth; sw.seek(_v, speed * 1.3, 0.6, desired); }
          else sw.seek(k.target, speed, 1.2, desired);
        }
      }
      // keep inside the pond with a look-ahead
      const ax = sw.pos.x + sw.vel.x * 1.4, az = sw.pos.z + sw.vel.z * 1.4;
      const d = this.sdf(ax, az);
      if (d > -0.55) { this.sdfGrad(ax, az, _v); desired.addScaledVector(_v, -(d + 0.55) * 1.6); }
      // avoid the island stone and bridge piers a little
      if (this.islandStone) { const dx = sw.pos.x - this.islandStone.x, dz = sw.pos.z - this.islandStone.z, dd = Math.hypot(dx, dz); if (dd < 1.1) { desired.x += dx / dd * 0.4; desired.z += dz / dd * 0.4; } }
      // separation
      for (const o of this.koi) {
        if (o === k) continue;
        const dx = sw.pos.x - o.sw.pos.x, dy = sw.pos.y - o.sw.pos.y, dz = sw.pos.z - o.sw.pos.z;
        const dd = Math.hypot(dx, dy * 2, dz);
        const minD = 0.32 * (k.scale + o.scale);
        if (dd < minD && dd > 1e-4) { const f = (minD - dd) / minD * 0.9; desired.x += dx / dd * f; desired.y += dy / dd * f * 0.3; desired.z += dz / dd * f; }
      }
      // never break the surface or touch the floor
      const floor = this.height(sw.pos.x, sw.pos.z) + 0.16;
      if (sw.pos.y < floor) desired.y += (floor - sw.pos.y) * 2;
      if (sw.pos.y > WATER_Y - 0.05) desired.y -= (sw.pos.y - (WATER_Y - 0.05)) * 4;
      sw.steer(desired, dt, k.mode === 'feed' ? 2.6 : 1.4).integrate(dt);
      sw.size = k.scale;
      // wake ripples when cruising near the surface
      if (sw.pos.y > WATER_Y - 0.14 && sw.vel.length() > 0.12) {
        k.wakeT -= dt;
        if (k.wakeT <= 0) { k.wakeT = 0.5 + Math.random() * 0.5; this.addRipple(sw.pos.x, sw.pos.z, 0.25); }
      }
      // pose: swimmer orientation plus a gulp (nose up)
      k.gulp = Math.max(0, k.gulp - dt * 1.8);
      const gulpAng = Math.sin(Math.min(1, k.gulp) * Math.PI) * 0.35;
      k.mesh.position.copy(sw.pos);
      k.mesh.quaternion.copy(sw.quat).multiply(_q.setFromAxisAngle(_zAxis, gulpAng));
      k.mesh.scale.setScalar(k.scale);
      const u = k.mat.userData.swimUniforms;
      u.uSwim.value.set(sw.phase, sw.amp * 1.1, sw.turn * 1.2, sw.flutter);
      u.uFishTime.value = time;
    }
  }

  updatePetals(dt, time) {
    const r = this.rng;
    // shed new petals
    this.petalTimer -= dt;
    const rate = lerp(2.5, 7, this.q);
    while (this.petalTimer <= 0 && this.canopy.length) {
      this.petalTimer += 1 / rate;
      const c = r.pick(this.canopy);
      const p = this.spawnPetal(r);
      p.pos.set(c.x + r.gauss() * 0.6, c.y + r.gauss() * 0.3, c.z + r.gauss() * 0.6);
      p.vel.set(0, -0.3, 0);
    }
    const wd = this.wind.uniforms.uWindDir.value;
    const mesh = this.petalMesh;
    let n = 0;
    for (let i = this.petals.length - 1; i >= 0; i--) {
      const p = this.petals[i];
      p.age += dt;
      if (p.mode === 0) {
        const flutter = Math.sin(time * 3 + p.ph) * 0.35;
        p.vel.set(wd.x * 0.35 + flutter * 0.4, -0.32 + Math.sin(time * 2.1 + p.ph) * 0.12, wd.y * 0.35 + Math.cos(time * 2.7 + p.ph) * 0.25);
        p.pos.addScaledVector(p.vel, dt);
        p.rot.x += p.spin.x * dt; p.rot.y += p.spin.y * dt; p.rot.z += p.spin.z * dt;
        const g = this.height(p.pos.x, p.pos.z);
        if (this.sdf(p.pos.x, p.pos.z) < -0.15 && p.pos.y <= WATER_Y + 0.003) {
          p.mode = 1; p.pos.y = WATER_Y + 0.003; p.rot.set(-Math.PI / 2, 0, p.rot.z); p.vel.set(0, 0, 0);
          if (Math.random() < 0.35) this.addRipple(p.pos.x, p.pos.z, 0.12);
        } else if (p.pos.y <= g + 0.01) {
          p.mode = 2; p.pos.y = g + 0.012; p.rot.set(-Math.PI / 2, 0, p.rot.z);
        }
      } else if (p.mode === 1) {
        // drift on the surface; ripples push them
        p.vel.x += (wd.x * 0.012 - p.vel.x * 0.5) * dt; p.vel.z += (wd.y * 0.012 - p.vel.z * 0.5) * dt;
        for (const rp of this.ripples) {
          const age = this.time - rp.t;
          if (age < 0 || age > 2.5) continue;
          const d = Math.hypot(p.pos.x - rp.x, p.pos.z - rp.z);
          if (Math.abs(d - age * 0.5) < 0.1 && d > 1e-3) { p.vel.x += (p.pos.x - rp.x) / d * rp.amp * 0.06 * dt * 8; p.vel.z += (p.pos.z - rp.z) / d * rp.amp * 0.06 * dt * 8; }
        }
        p.pos.addScaledVector(p.vel, dt);
        if (this.sdf(p.pos.x, p.pos.z) > -0.12) { this.sdfGrad(p.pos.x, p.pos.z, _v); p.pos.addScaledVector(_v, -0.01); p.vel.multiplyScalar(0.5); }
        p.rot.z += p.vel.length() * dt * 2;
      }
      if (p.age > p.life) { this.petals.splice(i, 1); continue; }
    }
    for (const p of this.petals) {
      const fade = p.mode === 0 ? 1 : clamp((p.life - p.age) / 8, 0, 1);
      _m.compose(p.pos, _q.setFromEuler(p.rot), _s.setScalar(fade));
      mesh.setMatrixAt(n++, _m);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  }

  updatePads(dt, time) {
    for (const p of this.pads) {
      let bob = 0;
      for (const rp of this.ripples) {
        const age = this.time - rp.t;
        if (age < 0 || age > 3) continue;
        const d = Math.hypot(p.home.x - rp.x, p.home.z - rp.z);
        const x = d - age * 0.5;
        bob += Math.cos(x * 12) * Math.exp(-x * x * 8) * Math.exp(-age) * rp.amp * 0.012;
      }
      // koi passing underneath nudge the pads
      for (const k of this.koi) {
        if (k.sw.pos.y < WATER_Y - 0.3) continue;
        const dx = p.mesh.position.x - k.sw.pos.x, dz = p.mesh.position.z - k.sw.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.45 && d > 1e-3) { p.home.x += dx / d * 0.08 * dt; p.home.z += dz / d * 0.08 * dt; }
      }
      p.mesh.position.set(p.home.x + Math.sin(time * 0.2 + p.phase) * 0.03, WATER_Y + 0.006 + bob, p.home.z + Math.cos(time * 0.17 + p.phase) * 0.03);
      p.mesh.rotation.y += p.spin * dt;
      p.mesh.rotation.x = bob * 3; p.mesh.rotation.z = bob * 2;
    }
    // water lilies open by day and close at dusk
    const h = this.env.hours();
    const openTarget = smoothstep(6.5, 9.5, h) * (1 - smoothstep(16.5, 18.5, h));
    for (const f of this.flowers) {
      f.open = damp(f.open, openTarget, 0.4, dt);
      for (const pt of f.petals) {
        const up = lerp(0.22 + pt.ring * 0.04, lerp(1.32, 0.72, pt.ring / 2), f.open);
        pt.m.rotation.x = -up;
      }
      f.group.position.y = f.pad.mesh.position.y + 0.012;
      f.group.position.x += (f.pad.mesh.position.x + 0.05 - f.group.position.x) * 0.02;
      f.group.position.z += (f.pad.mesh.position.z + 0.05 - f.group.position.z) * 0.02;
    }
  }

  updateDrops(dt) {
    let n = 0;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.v.y -= 6.5 * dt;
      d.p.addScaledVector(d.v, dt);
      d.life -= dt * 1.5;
      if (d.p.y < WATER_Y && d.v.y < 0) { if (Math.random() < 0.3) this.addRipple(d.p.x, d.p.z, 0.08); d.life = 0; }
      if (d.life <= 0) { this.drops.splice(i, 1); continue; }
    }
    for (const d of this.drops) {
      this.dropPos[n * 3] = d.p.x; this.dropPos[n * 3 + 1] = d.p.y; this.dropPos[n * 3 + 2] = d.p.z;
      this.dropAlpha[n] = clamp(d.life, 0, 1) * 0.8;
      n++;
    }
    this.dropPoints.geometry.setDrawRange(0, n);
    this.dropPoints.geometry.attributes.position.needsUpdate = true;
    this.dropPoints.geometry.attributes.aAlpha.needsUpdate = true;
  }

  updateFlies(time) {
    const pos = this.flyPos;
    this.flies.forEach((f, i) => {
      pos[i * 3] = f.base.x + Math.sin(time * f.sp + f.ph) * 0.8;
      pos[i * 3 + 1] = f.base.y + Math.sin(time * f.sp * 1.7 + f.ph * 2) * 0.25;
      pos[i * 3 + 2] = f.base.z + Math.cos(time * f.sp * 0.8 + f.ph) * 0.8;
    });
    this.flyPoints.geometry.attributes.position.needsUpdate = true;
  }

  dispose() {
    this.envRT?.dispose();
    for (const t of this.disposables) t.dispose?.();
    for (const k of this.koi) { k.painted.map.dispose(); k.mesh.customDepthMaterial?.dispose(); }
    this.koiGeo.dispose(); this.butterflyGeo.dispose();
  }
}
