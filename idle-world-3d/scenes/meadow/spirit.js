// 芒原 · the night's gentle giant: a luminous nine-tailed spirit fox (九尾狐), about 3 m from nose to tail tips.
//
// A procedural body (quad.js) drawn as soft, translucent light: a depth pre-pass, then one premultiplied colour
// pass that keeps only the nearest surface (no inner faces, no sorting flicker). Pale moonlit body with a fresnel
// rim, slow inner currents of light, vermilion kumadori marks and amber eyes; nine tails swaying in an unhurried,
// layered rhythm (each tail its own phase), tips burning with fox-fire. It sheds drifting motes that fade over a
// few seconds and leaves glowing paw prints. It walks the susuki at the edge of the view, stops to look toward the
// torii or the shrine, then walks on and dissolves into the mist. Night only (fades in at dusk).
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, damp, angleDelta, createNoise, canvasTexture, makeRng } from '../../lib/util.js';
import { FOG_GLSL } from './sky.js';
import { SkinGeo, SegRig, Animal } from './quad.js';

/* ------------------------------------------------------------------ */
/* Body plan (metres, bind pose facing +z, paws on y = 0)              */
/* ------------------------------------------------------------------ */
export const FOX_SPEC = {
  // spine joints [y, z]: pelvis, waist, withers, neck base, mid neck, atlas, nose tip (pelvis and withers level)
  spine: { P: [1.06, -0.46], M: [1.05, -0.04], C: [1.06, 0.40], N1: [1.16, 0.60], N2: [1.28, 0.73], H: [1.38, 0.85], S: [1.31, 1.37] },
  // loft sections [z, y, half-width, upper half-height, lower half-height, keel]: rump → nose
  sections: [
    [-0.86, 1.12, 0.06, 0.06, 0.06, 0],
    [-0.78, 1.11, 0.15, 0.13, 0.15, 0],
    [-0.66, 1.095, 0.21, 0.155, 0.21, 0.05],
    [-0.50, 1.075, 0.23, 0.165, 0.22, 0.1],
    [-0.29, 1.06, 0.2, 0.165, 0.2, 0.1],
    [-0.08, 1.05, 0.185, 0.17, 0.21, 0.14],
    [0.13, 1.025, 0.21, 0.2, 0.31, 0.3],
    [0.32, 1.02, 0.22, 0.225, 0.35, 0.34],
    [0.48, 1.06, 0.205, 0.22, 0.33, 0.38],
    [0.6, 1.15, 0.185, 0.195, 0.26, 0.32],
    [0.7, 1.24, 0.165, 0.165, 0.2, 0.24],
    [0.79, 1.31, 0.152, 0.145, 0.16, 0.16],
    [0.87, 1.365, 0.158, 0.143, 0.142, 0.18],
    [0.96, 1.39, 0.18, 0.132, 0.14, 0.34],
    [1.05, 1.385, 0.138, 0.113, 0.108, 0.38],
    [1.14, 1.36, 0.088, 0.083, 0.075, 0.3],
    [1.24, 1.335, 0.06, 0.058, 0.052, 0.2],
    [1.32, 1.316, 0.038, 0.038, 0.033, 0.1],
    [1.37, 1.31, 0.01, 0.01, 0.01, 0],
  ],
  bodyRings: 44, segBody: 22, headDense: 1.35,
  pawH: 0.055,
  legs: {
    F: { hip: [0.105, 0.92, 0.44], foot: [0.12, 0.47], L: [0.34, 0.40, 0.22, 0.12], alpha: 0.1, flex: 1.25, curl: 0.85, align: 0.7, scap: 0.08,
      r: [0.1, 0.1, 0.085, 0.062, 0.052, 0.044, 0.038, 0.037], seg: 10, topUp: 0.1,
      paw: { w: 0.047, h: 0.034, back: 0.035, lift: 0.45, seg: 8, prof: [0.1, 0.85, 1, 0.92, 0.6, 0.05] } },
    H: { hip: [0.11, 0.95, -0.46], foot: [0.115, -0.48], L: [0.37, 0.40, 0.30, 0.12], alpha: 0.28, flex: 0.62, curl: 0.6, align: 0.6,
      r: [0.16, 0.15, 0.115, 0.068, 0.055, 0.045, 0.038, 0.037], seg: 10, topUp: 0.12,
      paw: { w: 0.046, h: 0.033, back: 0.04, lift: 0.45, seg: 8, prof: [0.1, 0.85, 1, 0.92, 0.6, 0.05] } },
  },
  // ears in the head frame (from the atlas): [lateral, up, forward] at the base and the tip
  ears: { base: [0.08, 0.075, 0.025], tip: [0.13, 0.31, -0.045], w: 0.088, d: 0.024, turn: 0.5,
    shape: f => Math.pow(1 - f, 0.8) * (0.8 + 0.2 * Math.sin(Math.PI * f)) + 0.015 },
  tails: { n: 9, segs: 5, len: 1.5, rMax: 0.175, rings: 18, seg: 12, root: [1.13, -0.76], fan: 1.05, lift: 0.36, liftC: 0.3, curl: [0, 0.2, 0.38, 0.45, 0.24],
    // a full brush: slim at the root, fullest past the middle, drawn to a soft point
    prof: s => (0.42 + 0.58 * Math.pow(Math.sin(Math.PI * Math.min(1, Math.pow(s, 0.7) * 0.92)), 0.5)) * Math.sqrt(Math.max(0, 1 - Math.pow(s, 6))) },
  graze: { n1: 0.2, n2: -0.25, h: -0.75 },
  gait: { duty: 0.7, L0: 1.1, vRef: 1.0, swingH: 0.14, off: [0, 0.25, 0.5, 0.75], tMin: 0.26, tMax: 0.6 },
};

/* ------------------------------------------------------------------ */
/* Textures                                                            */
/* ------------------------------------------------------------------ */
/** Tiling noise (three independent fbm channels), linear data. */
export function spiritNoiseTexture(seed) {
  const n = createNoise(seed);
  return canvasTexture(64, 64, (g, w, h) => {
    const img = g.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const a = x / w * TAU, b = y / h * TAU;
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const r = (1.2 + c * 0.9) / TAU * 4;
        const v = n.fbm3(Math.cos(a) * r + c * 7.1, Math.sin(a) * r, Math.cos(b) * r + Math.sin(b) * r * 0.5 + c * 3.3, 3) * 0.5 + 0.5;
        img.data[i + c] = clamp(Math.round((v - 0.15) / 0.7 * 255), 0, 255);
      }
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }, { srgb: false, repeat: true });
}

/** Face marks on the body loft's uv (u along the spine, v round the section from the top): red = vermilion
 * kumadori, green = eyes. */
function markTexture(animal) {
  const curve = animal.bodyCurve;
  // arc-length fraction where the centreline passes a given z
  const uAt = z => { let best = 0, bd = 1e9; for (let i = 0; i <= 400; i++) { const p = curve.getPointAt(i / 400); const d = Math.abs(p.z - z); if (d < bd) { bd = d; best = i / 400; } } return best; };
  const uE = uAt(1.06), uB = uAt(0.93), uC = uAt(0.985), uM = uAt(1.2);
  return canvasTexture(512, 256, (g, W, H) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    const X = u => u * W, Y = v => v * H;
    // soft-edged brush strokes, feathered by hand (Safari 14's canvas has no filter): wide faint passes under the
    // stroke itself, so the marks stay smooth when magnified and mip-map cleanly
    const FEATHER = [[2.2, 0.08], [1.7, 0.14], [1.3, 0.3], [1.0, 1.0]];
    const stroke = (pts, w0, w1, rgb) => {
      g.lineCap = 'round';
      for (const [k, al] of FEATHER) {
        g.strokeStyle = `rgba(${rgb},${al})`;
        for (let i = 0; i < pts.length - 1; i++) {
          const t = i / (pts.length - 1);
          g.lineWidth = lerp(w0, w1, t) * k;
          g.beginPath(); g.moveTo(pts[i][0], pts[i][1]); g.lineTo(pts[i + 1][0], pts[i + 1][1]); g.stroke();
        }
      }
    };
    const blob = (cx, cy, rx, ry, rot, rgb) => {
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      grd.addColorStop(0, `rgba(${rgb},1)`); grd.addColorStop(0.6, `rgba(${rgb},0.85)`); grd.addColorStop(1, `rgba(${rgb},0)`);
      g.save(); g.translate(cx, cy); g.rotate(rot); g.scale(rx, ry);
      g.fillStyle = grd; g.beginPath(); g.arc(0, 0, 1, 0, TAU); g.fill(); g.restore();
    };
    for (const side of [1, -1]) {
      const v = vv => (side > 0 ? vv : 1 - vv);
      // a sweeping flame from the inner corner of the eye back toward the ear
      const pts = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([X(lerp(uE - 0.002, uE - 0.055, t)), Y(v(lerp(0.185, 0.115, Math.pow(t, 0.7))))]); }
      stroke(pts, 6, 1, '255,0,0');
      // a short stroke down the cheek
      const p2 = [];
      for (let i = 0; i <= 6; i++) { const t = i / 6; p2.push([X(lerp(uE - 0.006, uC - 0.03, t)), Y(v(lerp(0.215, 0.29, t)))]); }
      stroke(p2, 4, 1, '200,0,0');
      // eye: an almond of light
      blob(X(uE + 0.003), Y(v(0.175)), 6, 3.6, side * 0.3, '0,255,0');
    }
    // forehead jewel: a small flame on the brow, drawn on both edges of the wrap (v = 0 = 1)
    for (const yy of [0, H]) {
      stroke([[X(uB - 0.012), yy], [X(uB + 0.004), yy], [X(uB + 0.02), yy]], 2, 9, '255,40,0');
      blob(X(uB + 0.022), yy, 6, 5, 0, '255,90,0');
      // a faint line down the muzzle ridge
      stroke([[X(uB + 0.03), yy], [X(uM), yy]], 2.5, 1, '110,0,0');
    }
    g.globalCompositeOperation = 'source-over';
  }, { srgb: false });
}

/* ------------------------------------------------------------------ */
/* Materials                                                           */
/* ------------------------------------------------------------------ */
const VS = /* glsl */`
#include <common>
#include <skinning_pars_vertex>
attribute vec4 aAux;
uniform float uMinW;
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
varying vec4 vAux;
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  vec4 wp = modelMatrix * vec4(transformed, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * objectNormal);
  // thin parts keep a minimum on-screen width (no sub-pixel crawling at a distance)
  float dist = length(wp.xyz - cameraPosition);
  wp.xyz += n * max(uMinW * dist - aAux.z, 0.0);
  vW = wp.xyz; vN = n; vUv = uv; vAux = aAux;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// shared by both passes: which part, and the dissolve mask (noise, plus a bias so tail tips and paws go first)
const PARTS = /* glsl */`
uniform float uDissolve, uAlpha;
uniform sampler2D tNoise;
float isPart(float id){ return step(id - 0.5, vAux.x) * step(vAux.x, id + 0.5); }
float dissolveMask(){
  float n = texture2D(tNoise, vec2(vUv.y * 1.3 + vAux.w * 0.173, vUv.x * 2.1 + vAux.w * 0.31)).g;
  float bias = isPart(2.0) * (0.75 - 0.75 * vAux.y) + isPart(1.0) * (0.55 - 0.45 * vUv.x) + isPart(5.0) * 0.1 + isPart(3.0) * 0.35
             + isPart(0.0) * (0.5 + 0.3 * vUv.x);
  return n * 0.62 + bias * 0.38;
}
float dissolveVis(float m){ return smoothstep(uDissolve - 0.09, uDissolve + 0.03, m); }`;

const FS_DEPTH = /* glsl */`
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec4 vAux;
${PARTS}
void main() {
  if (dissolveVis(dissolveMask()) * uAlpha < 0.06) discard;
  gl_FragColor = vec4(0.0);
}`;

const FS_COLOR = /* glsl */`
varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying vec4 vAux;
uniform vec3 uBody, uRim, uMark, uEye, uTip;
uniform float uTime, uBreath, uEyeK;
uniform sampler2D tMark;
${PARTS}
${FOG_GLSL}
void main() {
  vec3 V = normalize(cameraPosition - vW);
  vec3 N = normalize(vN);
  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
  float fr = 1.0 - ndv;
  float rim = fr * fr * (3.0 - 2.0 * fr);
  float body = isPart(0.0), tail = isPart(2.0), ear = isPart(3.0), paw = isPart(5.0);
  // slow currents of light running back along the body and out along each tail
  float f1 = texture2D(tNoise, vec2(vUv.y * 2.0 + vAux.w * 0.21, vUv.x * 3.0 - uTime * 0.045)).r;
  float f2 = texture2D(tNoise, vec2(vUv.y * 5.0 + 0.37, vUv.x * 7.0 - uTime * 0.09)).b;
  float flow = f1 * 0.62 + f2 * 0.38;
  vec3 col = uBody * (0.55 + 0.9 * flow * flow);
  col += uRim * rim * (1.7 + 0.6 * flow);
  // tails: brighter toward the tips, where the fox-fire burns
  float tipK = tail * smoothstep(0.5, 1.0, vAux.y);
  col += uTip * tipK * (1.2 + 0.8 * f2);
  col += uRim * (paw * 0.35 + ear * 0.25 * (1.0 - vAux.y));
  // kumadori marks and eyes (face)
  vec4 mk = texture2D(tMark, vUv) * body;
  col = mix(col, uMark * (0.9 + 0.5 * flow), clamp(mk.r * 0.9, 0.0, 1.0));
  col += uEye * mk.g * uEyeK;
  col *= uBreath;
  float a = mix(0.42, 0.9, rim);
  // the silhouette is a soft fringe of fur, not a hard line: the last few degrees fade out, raggedly
  float fur = texture2D(tNoise, vec2(vUv.y * 9.0 + vAux.w * 0.3, vUv.x * 13.0)).g;
  a *= 1.0 - smoothstep(0.8, 1.0, fr) * (0.45 + 0.55 * fur);
  a = max(a, mk.r * 0.85);
  a = mix(a, 0.95, tipK * 0.5);
  // dissolving edge burns brighter as it goes
  float m = dissolveMask();
  float vis = dissolveVis(m);
  float edge = (1.0 - smoothstep(0.0, 0.1, abs(m - uDissolve))) * step(-0.05, uDissolve);
  col += uTip * edge * 2.2;
  a *= vis * uAlpha;
  col = applyMeadowFog(col, vW);
  gl_FragColor = vec4(col * a, a);
}`;

/* ------------------------------------------------------------------ */
/* Light motes (GPU drift, CPU ring buffer of spawns)                  */
/* ------------------------------------------------------------------ */
export const MOTE_PERIOD = 600;
export class Motes {
  constructor(n, { minPx = 2.5 } = {}) {
    this.n = n; this.head = 0; this.clock = 0; this.sd = 12345;
    const g = new THREE.BufferGeometry();
    this.aP = new Float32Array(n * 4); this.aV = new Float32Array(n * 4); this.aS = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { this.aP[i * 4 + 3] = -1e4; this.aV[i * 4 + 3] = 0.001; }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('aP', new THREE.BufferAttribute(this.aP, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aV', new THREE.BufferAttribute(this.aV, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aS', new THREE.BufferAttribute(this.aS, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.U = {
      uTime: { value: 0 }, uPR: { value: 1 }, uMinPx: { value: minPx }, uAlpha: { value: 1 },
      uColA: { value: new THREE.Color(0.55, 0.85, 1.6) }, uColB: { value: new THREE.Color(1.6, 1.25, 0.8) },
      uWind: { value: new THREE.Vector3() },
    };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        attribute vec4 aP; attribute vec4 aV; attribute vec4 aS;
        uniform float uTime, uPR, uMinPx; uniform vec3 uWind;
        varying float vA; varying float vHue; varying float vK;
        void main() {
          float age = mod(uTime - aP.w + ${MOTE_PERIOD.toFixed(1)}, ${MOTE_PERIOD.toFixed(1)});
          float life = aV.w;
          float k = age / life;
          vec3 p = aP.xyz + aV.xyz * age + uWind * age * age * 0.12;
          // a slow curling drift, its own phase per mote
          p.x += sin(age * 1.3 + aS.y * 40.0) * 0.12 * age;
          p.z += cos(age * 1.1 + aS.y * 23.0) * 0.12 * age;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = max(-mv.z, 0.3);
          float ps = aS.x * uPR / d * (1.0 - 0.35 * k);
          float pc = max(ps, uMinPx);
          gl_PointSize = pc;
          // fades in over half a second and out over the last 45 % of its life; never a pop
          vA = smoothstep(0.0, 0.5, age) * (1.0 - smoothstep(0.55, 1.0, k)) * step(k, 1.0) * (ps * ps) / (pc * pc);
          vHue = aS.z; vK = aS.w;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uColA, uColB; uniform float uAlpha;
        varying float vA; varying float vHue; varying float vK;
        void main() {
          float r = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, r);
          a = a * a * (0.65 + 0.35 * smoothstep(0.22, 0.0, r));
          vec3 c = mix(uColA, uColB, vHue);
          gl_FragColor = vec4(c * a * vA * uAlpha, 1.0);
        }`,
    });
    this.pts = new THREE.Points(g, this.mat);
    this.pts.frustumCulled = false;
    this.pts.renderOrder = 6;
    this.dirty = false;
  }
  spawn(p, vx, vy, vz, life, size, hue, kind = 0) {
    const i = this.head; this.head = (this.head + 1) % this.n;
    const o = i * 4;
    this.aP[o] = p.x; this.aP[o + 1] = p.y; this.aP[o + 2] = p.z; this.aP[o + 3] = this.clock;
    this.aV[o] = vx; this.aV[o + 1] = vy; this.aV[o + 2] = vz; this.aV[o + 3] = life;
    this.sd = (this.sd * 16807) % 2147483647;
    this.aS[o] = size; this.aS[o + 1] = this.sd / 2147483647; this.aS[o + 2] = hue; this.aS[o + 3] = kind;
    this.dirty = true;
  }
  update(dt, pr) {
    this.clock = (this.clock + dt) % MOTE_PERIOD;
    this.U.uTime.value = this.clock;
    this.U.uPR.value = pr;
    if (this.dirty) {
      const a = this.geo.attributes;
      a.aP.needsUpdate = a.aV.needsUpdate = a.aS.needsUpdate = true;
      this.dirty = false;
    }
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

/* ------------------------------------------------------------------ */
/* The spirit fox                                                      */
/* ------------------------------------------------------------------ */
export class SpiritFox {
  constructor({ env, scene, heightAt, fogU, seed }) {
    this.env = env; this.heightAt = heightAt;
    const geo = new SkinGeo(), rig = new SegRig();
    this.animal = new Animal(FOX_SPEC, geo, rig, { idx: 0, heightAt });
    this.rig = rig;
    this.skeleton = rig.skeleton();
    this.geometry = geo.build();
    this.tNoise = spiritNoiseTexture(seed ^ 0x5f0c);
    this.tMark = markTexture(this.animal);
    const U = this.U = {
      ...fogU,
      uMinW: { value: 0.0006 }, uDissolve: { value: 1.2 }, uAlpha: { value: 0 }, uTime: { value: 0 }, uBreath: { value: 1 }, uEyeK: { value: 1 },
      uBody: { value: new THREE.Color(0.3, 0.45, 0.72) }, uRim: { value: new THREE.Color(0.6, 0.85, 1.3) },
      uMark: { value: new THREE.Color(1.5, 0.22, 0.08) }, uEye: { value: new THREE.Color(2.6, 1.7, 0.6) }, uTip: { value: new THREE.Color(0.9, 1.15, 1.5) },
      tNoise: { value: this.tNoise }, tMark: { value: this.tMark },
    };
    this.depthMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: FS_DEPTH, transparent: true, colorWrite: false, depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 2 });
    this.colorMat = new THREE.ShaderMaterial({ uniforms: U, vertexShader: VS, fragmentShader: FS_COLOR, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });
    this.bones = new THREE.Group();
    this.bones.name = 'spiritFoxBones';
    for (const b of this.skeleton.bones) this.bones.add(b);
    scene.add(this.bones);
    this.sphere = new THREE.Sphere(new THREE.Vector3(), 3.2);
    const id = new THREE.Matrix4();
    const mk = (mat, ro, name) => {
      const m = new THREE.SkinnedMesh(this.geometry, mat);
      m.bind(this.skeleton, id);
      m.boundingSphere = this.sphere;
      m.renderOrder = ro; m.name = name;
      m.castShadow = m.receiveShadow = false;
      m.visible = false;
      scene.add(m);
      return m;
    };
    this.depthMesh = mk(this.depthMat, 2, 'spiritFoxDepth');
    this.colorMesh = mk(this.colorMat, 2.1, 'spiritFox');
    // motes and paw prints
    const q = env.q;
    this.motes = new Motes(Math.round(lerp(140, 300, clamp((q - 0.45) / 0.55, 0, 1))));
    this.motes.pts.visible = false;
    this.motes.pts.name = 'spiritMotes';
    scene.add(this.motes.pts);
    // anchor (labels, tests): the middle of the body, facing the way it walks
    this.anchor = new THREE.Object3D();
    this.anchor.name = 'spiritFoxBody';
    scene.add(this.anchor);
    // state
    this.active = false;
    this.rng = makeRng(seed ^ 0x9e37);
    const r = this.rng;
    this.tailPh = Array.from({ length: 9 }, () => ({ a: r.range(0, TAU), b: r.range(0, TAU), wa: r.range(1.35, 1.9), wb: r.range(1.05, 1.5), amp: r.range(0.85, 1.15) }));
    this._to = [0, 0];
    this.path = null;
    this.P = new THREE.Vector3(); this.C = new THREE.Vector3(); this.vP = new THREE.Vector3(); this.vC = new THREE.Vector3();
    this.pPrev = new THREE.Vector3(); this.cPrev = new THREE.Vector3();
    this.tmp = new THREE.Vector3(); this.tmp2 = new THREE.Vector3();
    this.glowPos = new THREE.Vector3(); this.glow = 0;
    this.pressPos = new THREE.Vector3(); this.pressW = 0;
    this.labelPos = new THREE.Vector3();
    this.stance = [true, true, true, true];
    this.clock = 0;
    this.tailsFn = (i, s) => this.tailOffset(i, s);
  }

  /** Path table: equally spaced points along a centripetal spline through the route's control points. */
  setPath(pts) {
    const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal');
    const N = 600;
    this.pathPts = curve.getSpacedPoints(N);
    this.pathLen = curve.getLength();
    this.pathStep = this.pathLen / N;
    return curve;
  }
  at(s, out) {
    // clamp to the ends and extend straight beyond them (the pelvis trails the chest before the path starts)
    const P = this.pathPts, N = P.length - 1;
    if (s <= 0) { const a = P[0], b = P[1]; const k = s / this.pathStep; return out.set(a.x + (b.x - a.x) * k, 0, a.z + (b.z - a.z) * k); }
    if (s >= this.pathLen) { const a = P[N - 1], b = P[N]; const k = (s - this.pathLen) / this.pathStep; return out.set(b.x + (b.x - a.x) * k, 0, b.z + (b.z - a.z) * k); }
    const f = s / this.pathStep, i = Math.min(Math.floor(f), N - 1), t = f - i;
    return out.set(lerp(P[i].x, P[i + 1].x, t), 0, lerp(P[i].z, P[i + 1].z, t));
  }

  /**
   * Begin a pass. route = { pts: [{x, z}], pause: index of the control point where it stops, look: Vector3, speed,
   * pauseFor (s) }.
   */
  begin(route) {
    const curve = this.setPath(route.pts);
    // arc length of the pause point: nearest table point to that control point
    const pp = route.pts[route.pause];
    let best = 0, bd = 1e9;
    this.pathPts.forEach((p, i) => { const d = (p.x - pp.x) ** 2 + (p.z - pp.z) ** 2; if (d < bd) { bd = d; best = i; } });
    this.sPause = best * this.pathStep;
    this.look = route.look.clone();
    this.vWalk = route.speed;
    this.pauseFor = route.pauseFor;
    this.T = this.animal.T;
    this.s = this.T + 0.2;        // chest starts just inside the path, the pelvis at its very start
    this.v = route.speed;
    this.paused = 0; this.pauseDone = false;
    this.dis = 1;                 // fully dissolved: it materialises over the first seconds
    this.mat = 0;
    this.lookYaw = 0; this.lookPitch = 0; this.earL = 0; this.earR = 0;
    this.spread = 0;
    this.active = true; this.ending = false;
    this.moteAcc = 0;
    this.at(this.s, this.C); this.at(this.s - this.T, this.P);
    this.place(0);
    this.cPrev.copy(this.C); this.pPrev.copy(this.P);
    this.vC.set(0, 0, 0); this.vP.set(0, 0, 0);
    this.animal.plant(this.P, this.C, this.v);
    this.stance = [true, true, true, true];
    this.depthMesh.visible = this.colorMesh.visible = true;
    this.motes.pts.visible = true;
    this.bones.matrixWorldAutoUpdate = true;
    void curve;
  }
  /** Spine points at their heights (with the gait's gentle rise and fall). */
  place(bobK) {
    const a = this.animal, ph = a.phase;
    const bobC = 0.022 * bobK * (0.5 + 0.5 * Math.cos(TAU * 2 * (ph - 0.32)));
    const bobP = 0.022 * bobK * (0.5 + 0.5 * Math.cos(TAU * 2 * (ph - 0.07)));
    this.C.y = this.heightAt(this.C.x, this.C.z) + a.chestH - bobC - (a.dropC || 0);
    this.P.y = this.heightAt(this.P.x, this.P.z) + a.hipH - bobP - (a.dropP || 0);
  }
  tailOffset(i, s) {
    const ph = this.tailPh[i], o = this._to;
    const c = (i - 4) / 4;
    // a slow wave runs out along each tail (its own phase and rate): layered, never in step with its neighbours
    const lag = s * 0.62;
    const sway = Math.sin(ph.a - lag) * (0.07 + 0.045 * s) * ph.amp;
    const lift = Math.sin(ph.b - lag * 0.9) * (0.05 + 0.03 * s) * ph.amp;
    // walking draws the tails back and together; standing lets them open out
    const mv = this.moveK;
    o[0] = lift - mv * (0.16 + 0.05 * s) + this.spread * 0.08 * (1 - Math.abs(c));
    o[1] = sway + c * (this.spread * 0.18 - mv * 0.16);
    return o;
  }

  /** ctx: { dt, t, night (0..1), pr, wind (Vector2), cam }; returns false once the pass is over. */
  update(dt, t, ctx) {
    if (!this.active) return false;
    const a = this.animal;
    this.clock = (this.clock + dt) % MOTE_PERIOD;
    // ---- speed along the route: walk, ease to a stop at the pause point, stand, walk on ----
    // (the braking curve reaches zero 1 cm short of the mark, so it settles without a last-frame jolt)
    let vT = this.vWalk;
    if (!this.pauseDone) {
      const dPause = this.sPause - this.s;
      vT = Math.min(this.vWalk, Math.sqrt(2 * 0.2 * Math.max(dPause - 0.01, 0)));
      if (this.paused > 0 || (dPause < 0.06 && this.v < 0.03)) {
        this.paused += dt;
        if (this.paused > this.pauseFor) this.pauseDone = true;
      }
    }
    const acc = vT > this.v ? 0.26 : 0.55;
    this.v = vT > this.v ? Math.min(vT, this.v + acc * dt) : Math.max(vT, this.v - acc * dt);
    this.s += this.v * dt;
    if (!this.pauseDone && this.s > this.sPause) { this.s = this.sPause; this.v = 0; }
    // ---- materialise, then dissolve over the last stretch ----
    const left = this.pathLen - this.s;
    if (left < 6.5) this.ending = true;
    this.dis = this.ending ? Math.min(1, this.dis + dt / 4.8) : Math.max(0, this.dis - dt / 4.2);
    if (this.ending && this.dis >= 1) { this.end(); return false; }
    // ---- spine on the path ----
    this.at(this.s, this.C); this.at(this.s - this.T, this.P);
    this.moveK = smoothstep(0.05, 0.8, this.v);
    this.place(this.moveK);
    const kv = 1 - Math.exp(-14 * dt);
    if (dt > 1e-6) {
      this.vC.lerp(this.tmp.subVectors(this.C, this.cPrev).divideScalar(dt), kv);
      this.vP.lerp(this.tmp.subVectors(this.P, this.pPrev).divideScalar(dt), kv);
    }
    this.cPrev.copy(this.C); this.pPrev.copy(this.P);
    const yaw = Math.atan2(this.C.x - this.P.x, this.C.z - this.P.z);
    if (this.yawPrev === undefined) this.yawPrev = yaw;
    const turn = dt > 1e-6 ? angleDelta(this.yawPrev, yaw) / dt : 0;
    this.turn = damp(this.turn || 0, turn, 10, dt);
    this.yawPrev = yaw;
    // ---- look toward the torii / shrine while standing ----
    const standing = this.paused > 0.3 && !this.pauseDone;
    let ly = 0, lp = 0;
    if (standing) {
      const mx = (this.C.x + this.P.x) / 2, mz = (this.C.z + this.P.z) / 2;
      const to = Math.atan2(this.look.x - mx, this.look.z - mz);
      ly = clamp(angleDelta(yaw, to), -1.25, 1.25);
      lp = clamp(Math.atan2(this.look.y - this.C.y - 0.4, Math.hypot(this.look.x - mx, this.look.z - mz)), -0.3, 0.35);
    }
    this.lookYaw = damp(this.lookYaw, ly, 1.1, dt);
    this.lookPitch = damp(this.lookPitch, lp, 1.1, dt);
    this.spread = damp(this.spread, standing ? 1 : 0, 0.7, dt);
    this.earL = damp(this.earL, standing ? 0.15 : 0.0, 3, dt);
    this.earR = damp(this.earR, standing ? 0.15 : 0.0, 3, dt);
    // ---- tail rhythm ----
    for (const ph of this.tailPh) { ph.a = (ph.a + ph.wa * dt * (0.75 + 0.25 * this.moveK)) % TAU; ph.b = (ph.b + ph.wb * dt) % TAU; }
    // ---- pose ----
    const ph = a.phase;
    const st = this.st || (this.st = { ears: [0, 0] });
    st.P = this.P; st.C = this.C; st.vP = this.vP; st.vC = this.vC;
    st.speed = this.v; st.turn = this.turn;
    st.roll = 0.035 * this.moveK * Math.sin(TAU * ph);
    st.bend = clamp(-this.turn * 0.12, -0.08, 0.08);
    st.down = 0; st.nod = 0.035 * this.moveK * Math.sin(TAU * 2 * ph + 0.9);
    st.lookYaw = this.lookYaw; st.lookPitch = this.lookPitch;
    st.ears[0] = this.earL; st.ears[1] = this.earR; st.earBack = 0.15 * this.moveK;
    st.tails = this.tailsFn;
    a.pose(dt, st);
    // ---- light ----
    const night = ctx.night;
    const vis = (1 - this.dis);
    const breath = 0.93 + 0.07 * Math.sin(this.clock * TAU / 5.5);
    const U = this.U;
    U.uDissolve.value = lerp(-0.12, 1.06, this.dis);
    U.uAlpha.value = night;
    U.uTime.value = this.clock;
    U.uBreath.value = breath;
    U.uEyeK.value = 0.85 + 0.15 * Math.sin(this.clock * TAU / 7.0 + 1.0);
    U.uMinW.value = 0.5 * 1.6 / Math.max(ctx.pxK, 1);
    const mid = this.tmp.addVectors(this.P, this.C).multiplyScalar(0.5);
    this.sphere.center.copy(mid).y += 0.6;
    this.anchor.position.copy(mid);
    this.anchor.rotation.set(0, yaw, 0);
    this.labelPos.copy(mid).y += 1.0;
    this.glowPos.copy(mid).y += 0.25;
    this.glow = night * vis * breath;
    this.pressPos.copy(mid);
    this.pressW = 0.9 * vis * smoothstep(0.05, 0.4, night);
    // ---- motes: tail tips, the body, and a few at each paw as it lands ----
    const nm = this.motes;
    const emit = night * (0.25 + 0.75 * vis);
    this.moteAcc += dt * (14 + 10 * this.moveK) * emit * (this.ending ? 1.8 : 1);
    const r = this.rng;
    while (this.moteAcc >= 1) {
      this.moteAcc -= 1;
      const tl = a.tails[r.int(0, 8)];
      const k = r.chance(0.7) ? 5 : r.int(2, 4);
      const p = this.tmp2.copy(tl.J[k]).add(this.tmp.set(r.range(-0.12, 0.12), r.range(-0.1, 0.1), r.range(-0.12, 0.12)));
      if (r.chance(0.25)) { p.lerpVectors(this.P, this.C, r.next()); p.y += r.range(-0.05, 0.25); }
      nm.spawn(p, r.range(-0.08, 0.08) - this.vC.x * 0.15, r.range(0.12, 0.32), r.range(-0.08, 0.08) - this.vC.z * 0.15, r.range(2.6, 4.6), r.range(26, 44), r.chance(0.25) ? 1 : 0);
    }
    for (let i = 0; i < 4; i++) {
      const g = a.legs[i];
      if (g.stance && !this.stance[i] && emit > 0.05) {
        for (let k = 0; k < 3; k++) nm.spawn(this.tmp2.copy(g.foot).add(this.tmp.set(r.range(-0.06, 0.06), 0.02, r.range(-0.06, 0.06))), r.range(-0.03, 0.03), r.range(0.03, 0.09), r.range(-0.03, 0.03), r.range(2.5, 3.6), r.range(30, 46), 0, 1);
      }
      this.stance[i] = g.stance;
    }
    nm.U.uWind.value.set(ctx.wind.x * 0.25, 0.02, ctx.wind.y * 0.25);
    nm.U.uAlpha.value = night;
    nm.update(dt, ctx.pr);
    return true;
  }
  /** Motes keep drifting (and fading) after the fox is gone; call every frame. */
  idle(dt, ctx) {
    if (this.active || !this.motes.pts.visible) return;
    this.fadeOut = (this.fadeOut || 0) + dt;
    this.motes.update(dt, ctx.pr);
    if (this.fadeOut > 6) { this.motes.pts.visible = false; this.fadeOut = 0; }
  }
  end() {
    this.active = false;
    this.depthMesh.visible = this.colorMesh.visible = false;
    this.bones.matrixWorldAutoUpdate = false;
    this.glow = 0; this.pressW = 0;
    this.fadeOut = 0;
  }
  dispose() {
    this.geometry.dispose(); this.depthMat.dispose(); this.colorMat.dispose();
    this.tNoise.dispose(); this.tMark.dispose(); this.skeleton.dispose(); this.motes.dispose();
  }
}
