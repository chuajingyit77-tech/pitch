// 栖境 — app shell: renderer, post-processing, camera rig, feeding input, residents,
// per-computer save data, idle/screensaver mode, ambience and the HUD.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { makeRng, hashString, sunState, disposeObject, clamp, lerp, damp, TAU } from './lib/util.js';
import { Ambience } from './lib/audio.js';

// Point and spot lights get a small physical radius (25 cm). Without it, a surface a few centimetres from
// a lamp (the inside of a stone lantern, a leaf next to a glow) receives hundreds of times the light, and
// that hot spot blooms and sparkles as things move.
THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin.replace(
  'float getDistanceAttenuation( const in float lightDistance, const in float cutoffDistance, const in float decayExponent ) {',
  'float getDistanceAttenuation( const in float lightDistanceIn, const in float cutoffDistance, const in float decayExponent ) {\n\tfloat lightDistance = max( lightDistanceIn, 0.25 );');

/* ------------------------------------------------------------------ */
/* Registry                                                            */
/* ------------------------------------------------------------------ */
export const WORLDS = [
  { id: 'reef', file: './scenes/reef.js', name: '深蓝', sub: '珊瑚礁', ref: 'inspired by ABZÛ · Endless Ocean', g: 'linear-gradient(160deg,#0f6f8c 0%,#0a3a57 55%,#c98a4c 120%)' },
  { id: 'koi', file: './scenes/koi.js', name: '锦鲤', sub: '庭院池塘', ref: 'inspired by Sekiro · Ghost of Tsushima', g: 'linear-gradient(160deg,#2f4a3a 0%,#1b2b26 50%,#d0453a 130%)' },
  { id: 'meadow', file: './scenes/meadow.js', name: '芒原', sub: '狐与鸟居', ref: 'inspired by Ghost of Tsushima', g: 'linear-gradient(160deg,#e3b46a 0%,#a8582f 60%,#5a2a2a 120%)' },
  { id: 'island', file: './scenes/island.js', name: '晴岛', sub: '热带海岛', ref: 'inspired by Sea of Thieves · Animal Crossing', g: 'linear-gradient(160deg,#5ec3e8 0%,#1d8fb0 50%,#f2d59a 110%)' },
  { id: 'jungle', file: './scenes/jungle.js', name: '雨林', sub: '瀑布与萤火', ref: 'inspired by Ori · Horizon', g: 'linear-gradient(160deg,#2f6b45 0%,#15331f 60%,#8fd06a 140%)' },
  { id: 'cloudsea', file: './scenes/cloudsea.js', name: '云海', sub: '蟠桃仙境', ref: 'inspired by Kung Fu Panda · Chinese celestial paintings', g: 'linear-gradient(160deg,#ffd1b8 0%,#f29bb0 45%,#6f7fc4 110%)' },
];

const NAMES = ['年糕', '麻薯', '汤圆', '芝麻', '团子', '布丁', '奶盖', '可乐', '柚子', '椰椰', '栗子', '米粒', '小满', '豆豆', '泡泡', '阿橙',
  '花卷', '大福', '毛豆', '咕噜', '闪闪', '跳跳', '奶糖', '雪球', '桃桃', '橘子', '波波', '饭团', '小酥', '蛋挞', '云朵', '星星', '月饼', '糯米',
  '阿福', '小蓝', '金金', '红豆', '绿豆', '黑糖', '杏仁', '可可', '拿铁', '抹茶', '乌龙', '蜜柑', '樱桃', '山楂', '烧卖', '锅贴', '馒头', '包子',
  '小鱼干', '虾饺', '丸子', '酥酥', '甜甜', '乐乐', '笨笨', '胖丁', '旺财', '来福', '如意', '吉祥', '平安', '富贵', '招财', '元宝'];

const STORE_KEY = 'qijing-v1';
const TEST = window.__IDLE_TEST__ || null;
if (TEST && TEST.scene && !WORLDS.some(w => w.id === TEST.scene)) {
  WORLDS.push({ id: TEST.scene, file: `./scenes/${TEST.scene}.js`, name: TEST.scene, sub: 'test', ref: '', g: '#333' });
}
const ASSET_BASE = new URL('./assets/', import.meta.url);
const $ = id => document.getElementById(id);
const today = () => new Date().toDateString();

/* ------------------------------------------------------------------ */
/* Save data                                                           */
/* ------------------------------------------------------------------ */
function randomSeed() {
  try { return crypto.getRandomValues(new Uint32Array(1))[0] >>> 0; } catch (e) { return (Math.random() * 4294967296) >>> 0; }
}
function loadSave() { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || null; } catch (e) { return null; } }
let save = Object.assign({
  name: '我的电脑', seed: randomSeed(), scene: 'reef', quality: 'auto', autoQuality: null,
  timeMode: 'real', manualHour: 12, rotate: 0, sound: false, powerSave: true, showClock: true, worlds: {},
}, loadSave() || {});
if (TEST) {
  if (TEST.seed !== undefined) save.seed = TEST.seed;
  if (TEST.scene) save.scene = TEST.scene;
  if (TEST.hours !== undefined) { save.timeMode = 'manual'; save.manualHour = TEST.hours; }
  if (TEST.quality) save.quality = TEST.quality;
}
// A link ending in #koi, #reef, #meadow, #island, #jungle or #cloudsea opens that world on this computer.
const hashWorld = () => decodeURIComponent((location.hash || '').slice(1)).trim().toLowerCase();
if (!TEST && WORLDS.some(w => w.id === hashWorld())) save.scene = hashWorld();
if (!WORLDS.some(w => w.id === save.scene)) save.scene = 'reef';
let dirty = false;
function persist() { try { localStorage.setItem(STORE_KEY, JSON.stringify(save)); } catch (e) {} dirty = false; }

function worldSave(id) {
  if (!save.worlds[id]) save.worlds[id] = { members: null, fedDay: today(), fed: 0 };
  const w = save.worlds[id];
  if (w.fedDay !== today()) { w.fedDay = today(); w.fed = 0; }
  return w;
}
function makeMember(def, kind, rng, used) {
  const free = NAMES.filter(n => !used.includes(n));
  return {
    id: Math.floor(rng.next() * 2 ** 31).toString(36),
    kind,
    name: rng.pick(free.length ? free : NAMES),
    size: rng.range(0.9, 1.1),
    eaten: 0,
    lastAte: Date.now() - rng.range(0.2, 3) * 3600e3,
    born: Date.now(),
    seed: rng.int(1, 2 ** 30),
  };
}
function ensureMembers(def, id) {
  const w = worldSave(id);
  // drop residents of kinds this world no longer knows (a world can be redesigned between versions)
  if (Array.isArray(w.members)) w.members = w.members.filter(m => def.kinds && def.kinds[m.kind]);
  if (!Array.isArray(w.members) || !w.members.length) {
    const rng = makeRng(hashString(save.seed + ':' + id + ':members'));
    w.members = [];
    for (const kind of def.starter || []) w.members.push(makeMember(def, kind, rng, w.members.map(m => m.name)));
    dirty = true;
  }
  return w.members;
}
const fullness = m => clamp(1 - (Date.now() - (m.lastAte || 0)) / (4 * 3600e3), 0, 1);

/* ------------------------------------------------------------------ */
/* Renderer + post                                                     */
/* ------------------------------------------------------------------ */
const canvas = $('gl');
function fatal(msg) {
  $('veilMsg').textContent = msg;
  $('veil').classList.remove('clear');
  const sp = document.querySelector('#veil .spin');
  if (sp) sp.hidden = true;
}
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false });
} catch (e) {
  fatal('这台设备的浏览器没有开启 3D 加速（WebGL），请用最新版 Chrome、Edge 或 Safari 打开');
  throw e;
}
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const pmrem = new THREE.PMREMGenerator(renderer);

// What this device can do
const glx = renderer.getContext();
const GPU = (() => { try { const e = glx.getExtension('WEBGL_debug_renderer_info'); return e ? String(glx.getParameter(e.UNMASKED_RENDERER_WEBGL)) : ''; } catch (err) { return ''; } })();
const IS_MOBILE = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const WEAK_GPU = /Intel|UHD|Iris|HD Graphics|Mali|Adreno|PowerVR|Apple A\d|SwiftShader|llvmpipe|Basic Render|Microsoft|Radeon\(TM\)( Vega \d+)? Graphics|Radeon Vega|Radeon R\d/i.test(GPU);
const IS_WEBGL2 = renderer.capabilities.isWebGL2;
const CAN_HALF = IS_WEBGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
const HDR_TYPE = CAN_HALF ? THREE.HalfFloatType : THREE.UnsignedByteType;
// MSAA sample counts this GPU really supports for the scene buffer's format (half-float MSAA is not universal)
function formatSamples(fmt) {
  try { const s = glx.getInternalformatParameter(glx.RENDERBUFFER, fmt, glx.SAMPLES); return s && s.length ? Math.max(...s) : 0; } catch (e) { return 0; }
}
const MAX_SAMPLES = IS_WEBGL2 ? Math.min(renderer.capabilities.maxSamples || 0, formatSamples(CAN_HALF ? glx.RGBA16F : glx.RGBA8)) : 0;

// Scene detail tiers. Resolution then adapts on its own (see `dyn`) — quality changes never reload a world.
// Anti-aliasing stays on for every tier (it is applied to the scene render only, so it is cheap): thin grass,
// fins and branches crawl and shimmer without it, which reads as flicker, especially on phones.
const QUALITY = {
  high: { pr: 1.5, maxPixels: 2.6e6, samples: 4, shadows: true, q: 1 },
  medium: { pr: 1.25, maxPixels: 1.5e6, samples: 2, shadows: true, q: 0.7 },
  low: { pr: 1.5, maxPixels: 0.8e6, samples: 4, shadows: false, q: 0.45 },
};
function effectiveQuality() {
  if (save.quality && save.quality !== 'auto' && QUALITY[save.quality]) return save.quality;
  if (IS_MOBILE) return 'low';
  return WEAK_GPU ? 'medium' : 'high';
}
let qName = effectiveQuality();
let Q = QUALITY[qName];

// Removes NaN/Inf from the HDR frame and soft-limits extreme highlights. A single NaN pixel (or a
// one-pixel specular sparkle worth 1000×) would otherwise be smeared by bloom into flashing blocks.
const SanitizeShader = {
  uniforms: { tDiffuse: { value: null }, uKnee: { value: 12.0 } },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uKnee; varying vec2 vUv;
    bool bad(float x){
      #if __VERSION__ >= 300
        return isnan(x) || isinf(x);
      #else
        return !(x < 1e20 && x > -1e20); // WebGL1 has no isnan(): NaN fails every comparison
      #endif
    }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 v = c.rgb;
      if (bad(v.r) || bad(v.g) || bad(v.b)) v = vec3(0.0);
      v = clamp(v, vec3(0.0), vec3(65000.0));
      float m = max(max(v.r, v.g), v.b);
      if (m > uKnee) v *= (uKnee + (m - uKnee) / (1.0 + (m - uKnee) / uKnee)) / m;
      gl_FragColor = vec4(v, 1.0);
    }`,
};

// Renders the world into its own multisampled HDR buffer, then writes a sanitized copy into the
// composer's (single-sample) chain. Only this pass pays for MSAA; bloom and grading stay cheap.
class ScenePass extends Pass {
  constructor(samples) {
    super();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera();
    this.target = new THREE.WebGLRenderTarget(1, 1, { type: HDR_TYPE, samples });
    this.target.texture.name = 'scene';
    this.quad = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(SanitizeShader.uniforms),
      vertexShader: SanitizeShader.vertexShader, fragmentShader: SanitizeShader.fragmentShader,
      depthTest: false, depthWrite: false,
    }));
  }
  setSize(w, h) { this.target.setSize(w, h); }
  render(r, writeBuffer) {
    r.setRenderTarget(this.target);
    r.clear();
    r.render(this.scene, this.camera);
    this.quad.material.uniforms.tDiffuse.value = this.target.texture;
    r.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(r);
  }
  dispose() { this.target.dispose(); this.quad.material.dispose(); this.quad.dispose(); }
}

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 0.35 }, uSat: { value: 1.04 }, uContrast: { value: 1.02 },
    uLift: { value: new THREE.Vector3(0, 0, 0) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
    uCA: { value: 0 }, uTilt: { value: 0 }, uTiltCenter: { value: 0.5 }, uTiltWidth: { value: 0.18 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 uRes;
    uniform float uVignette, uSat, uContrast, uCA, uTilt, uTiltCenter, uTiltWidth;
    uniform vec3 uLift, uGain;
    varying vec2 vUv;
    vec3 tap(vec2 uv){
      float blur = uTilt * smoothstep(uTiltWidth, uTiltWidth + 0.38, abs(uv.y - uTiltCenter));
      if (blur < 0.02) return texture2D(tDiffuse, uv).rgb;
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 2.39996;
        float r = sqrt(float(i) + 0.5) / 3.4641;
        acc += texture2D(tDiffuse, uv + vec2(cos(a), sin(a)) * r * blur * 9.0 / uRes).rgb;
      }
      return acc / 12.0;
    }
    void main(){
      vec2 uv = vUv; vec2 dc = uv - 0.5;
      vec3 col = uCA > 0.0 ? vec3(tap(uv + dc * uCA).r, tap(uv).g, tap(uv - dc * uCA).b) : tap(uv);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;
      col = col * uGain + uLift * (1.0 - col);
      float vig = smoothstep(0.95, 0.2, length(dc * vec2(uRes.x / uRes.y, 1.0) * 0.82));
      col *= mix(1.0, vig, uVignette);
      // Static sub-LSB dither against banding. No animated film grain: moving noise reads as flicker,
      // most of all in dark scenes on phone screens.
      float n = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      col += (n - 0.5) / 255.0;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

let composer, scenePass, bloomPass, outputPass, fxaaPass, finalPass;
function buildComposer() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (composer) {
    for (const p of composer.passes) p.dispose?.();
    composer.dispose();
  }
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: HDR_TYPE }));
  scenePass = new ScenePass(Math.min(Q.samples, MAX_SAMPLES));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.6, 0.85);
  outputPass = new OutputPass();
  fxaaPass = new ShaderPass(FXAAShader);
  finalPass = new ShaderPass(FinalShader);
  composer.addPass(scenePass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);
  composer.addPass(fxaaPass);
  composer.addPass(finalPass);
  // FXAA only where the GPU cannot multisample the HDR buffer
  fxaaPass.enabled = scenePass.target.samples === 0;
  if (current) { scenePass.scene = current.inst.scene; scenePass.camera = current.inst.camera; }
  post.snap = true;
}

/* Dynamic resolution. Frame times are judged against the display's own refresh interval (so 30 Hz
   screens, 75 Hz monitors and phones in low-power mode are not mistaken for slow GPUs). It steps down
   quickly when frames are late and creeps back up only after a long comfortable stretch, backing off
   when a step up does not hold — so the picture settles instead of pumping between sharp and soft.
   Each world remembers its own level per detail tier. */
const DYN_STEPS = [1, 0.87, 0.76, 0.66, 0.57, 0.5];
const dyn = { i: 0, ema: 0, slow: 0, fast: 0, settleUntil: 0, vsync: Infinity, lastUpAt: -1e9, upBlockedUntil: 0, backoff: 300e3 };
const dynKey = id => `qijing-res-${qName}-${id}`;
function dynRestore(id) {
  let i = 0;
  try { const v = parseInt(localStorage.getItem(dynKey(id)), 10); if (v >= 0 && v < DYN_STEPS.length) i = v; } catch (e) {}
  dyn.i = Math.max(0, i - 1); // try one step sharper than last time
  dyn.ema = 0; dyn.slow = dyn.fast = 0; dyn.lastUpAt = -1e9;
  dyn.settleUntil = performance.now() + 3000;
  needsResize = true;
}
// every rAF tick, rendered or not: track the display refresh interval (fast down, very slow drift up)
function dynTick(rawMs) {
  if (rawMs > 3 && rawMs < 120) dyn.vsync = Math.min(rawMs, dyn.vsync + 0.0005);
}
function dynSample(frameMs, now, throttled) {
  if (TEST || now < dyn.settleUntil || frameMs > 250 || !isFinite(dyn.vsync)) return;
  dyn.ema = dyn.ema ? dyn.ema * 0.9 + frameMs * 0.1 : frameMs;
  const vs = clamp(dyn.vsync, 4, 70);
  // the frame cadence we expect when the GPU keeps up: every refresh, or the 75 fps cap on fast screens,
  // or the 30 fps screensaver cadence. Awake we accept down to ~43 fps (or every refresh on slow screens).
  const cadence = throttled ? 1000 / 31 : vs < 11 ? 1000 / 75 : 0;
  const expect = cadence ? vs * Math.max(1, Math.ceil(cadence / vs - 0.05)) : vs;
  const budget = throttled ? expect * 1.3 : Math.max(23, expect * 1.3);
  const roomy = expect * 1.04;
  dyn.slow = dyn.ema > budget ? dyn.slow + frameMs : 0;
  dyn.fast = dyn.ema < roomy ? dyn.fast + frameMs : 0;
  let next = dyn.i;
  if (dyn.slow > (throttled ? 2500 : 1500) && dyn.i < DYN_STEPS.length - 1) {
    next = dyn.i + 1;
    if (now - dyn.lastUpAt < 30e3) { dyn.upBlockedUntil = now + dyn.backoff; dyn.backoff = Math.min(dyn.backoff * 2, 3600e3); }
  } else if (dyn.fast > 20e3 && dyn.i > 0 && now > dyn.upBlockedUntil) {
    next = dyn.i - 1;
    dyn.lastUpAt = now;
  }
  if (next !== dyn.i) {
    dyn.i = next; dyn.slow = dyn.fast = 0; dyn.ema = 0; dyn.settleUntil = now + 1500;
    needsResize = true;
    if (current) try { localStorage.setItem(dynKey(current.meta.id), String(next)); } catch (e) {}
  }
}

const view = { w: 1, h: 1 };
let needsResize = true, lastSize = '';
function resize(force = false) {
  // size from the canvas' own box (what the compositor stretches), falling back to the window
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width) || window.innerWidth), h = Math.max(1, Math.round(rect.height) || window.innerHeight);
  let pr = Math.min(window.devicePixelRatio || 1, Q.pr);
  if (w * h * pr * pr > Q.maxPixels) pr = Math.sqrt(Q.maxPixels / (w * h));
  pr = Math.max(0.35, pr * DYN_STEPS[dyn.i]);
  const key = `${w}x${h}@${pr.toFixed(3)}`;
  if (!force && key === lastSize) return;
  lastSize = key;
  view.w = w; view.h = h;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  finalPass.uniforms.uRes.value.set(size.x, size.y);
  fxaaPass.material.uniforms.resolution.value.set(1 / size.x, 1 / size.y);
  if (current) {
    const cam = current.inst.camera;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    current.inst.resize?.(w, h);
  }
}

/* Post settings. Worlds describe their look every frame; the shell eases toward it (and caps the
   extremes) so no world can ever make the whole screen jump or strobe. */
const post = { snap: true, exposure: 1, strength: 0.3, radius: 0.6, threshold: 0.85, vignette: 0.35, sat: 1.04, contrast: 1.02, lift: [0, 0, 0], gain: [1, 1, 1], ca: 0, tilt: 0 };
function applyPost(p = {}, dt = 0) {
  const b = p.bloom || {};
  const k = post.snap ? 1 : 1 - Math.exp(-dt / 0.6);
  post.snap = false;
  const ease = (cur, target) => cur + (target - cur) * k;
  post.exposure = ease(post.exposure, clamp(p.exposure ?? 1, 0.2, 3));
  post.strength = ease(post.strength, clamp(b.strength ?? 0.3, 0, 0.7));
  post.radius = ease(post.radius, clamp(b.radius ?? 0.6, 0, 0.9));
  post.threshold = ease(post.threshold, Math.max(0.45, b.threshold ?? 0.85));
  post.vignette = ease(post.vignette, clamp(p.vignette ?? 0.35, 0, 1));
  post.sat = ease(post.sat, clamp(p.saturation ?? 1.04, 0, 2));
  post.contrast = ease(post.contrast, clamp(p.contrast ?? 1.02, 0.5, 1.5));
  post.ca = ease(post.ca, clamp(p.ca ?? 0, 0, 0.02));
  const tilt = p.tilt || {};
  post.tilt = ease(post.tilt, Q.q < 0.6 ? 0 : clamp(tilt.amount ?? 0, 0, 1));
  const lift = p.lift || [0, 0, 0], gain = p.gain || [1, 1, 1];
  for (let i = 0; i < 3; i++) { post.lift[i] = ease(post.lift[i], clamp(lift[i] ?? 0, -0.2, 0.2)); post.gain[i] = ease(post.gain[i], clamp(gain[i] ?? 1, 0.5, 1.5)); }

  bloomPass.strength = post.strength;
  bloomPass.radius = post.radius;
  bloomPass.threshold = post.threshold;
  bloomPass.enabled = CAN_HALF && post.strength > 0.001; // bloom's own buffers need half-float support
  renderer.toneMappingExposure = post.exposure;
  const tm = p.toneMapping === 'agx' ? THREE.AgXToneMapping : p.toneMapping === 'linear' ? THREE.LinearToneMapping : THREE.ACESFilmicToneMapping;
  if (renderer.toneMapping !== tm) renderer.toneMapping = tm;
  const u = finalPass.uniforms;
  u.uVignette.value = post.vignette;
  u.uSat.value = post.sat;
  u.uContrast.value = post.contrast;
  u.uLift.value.set(post.lift[0], post.lift[1], post.lift[2]);
  u.uGain.value.set(post.gain[0], post.gain[1], post.gain[2]);
  u.uCA.value = post.ca;
  u.uTilt.value = post.tilt;
  u.uTiltCenter.value = tilt.center ?? 0.5;
  u.uTiltWidth.value = tilt.width ?? 0.18;
}

/* Cut-out foliage (alpha-tested leaves, petals, grass cards) gets anti-aliased edges: with MSAA on, the
   alpha test becomes a sharpened alpha-to-coverage, so leaf edges stop crawling and sparkling as they
   sway. Applied to every world after it is built; materials that already manage coverage are skipped. */
const A2C_TEST = /* glsl */`
  float a2cAlpha = 1.0;
  #ifdef USE_ALPHATEST
    a2cAlpha = clamp((diffuseColor.a - alphaTest) / max(fwidth(diffuseColor.a), 0.0001) + 0.5, 0.0, 1.0);
    if (a2cAlpha <= 0.0) discard;
  #endif`;
function smoothCutouts(root) {
  if (!scenePass.target.samples) return;
  root.traverse(o => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || m.userData.a2c || !(m.alphaTest > 0) || m.transparent || m.alphaToCoverage || m.isShaderMaterial) continue;
      m.userData.a2c = true;
      m.alphaToCoverage = true;
      const prevCompile = m.onBeforeCompile;
      // keep the previous program key: the default key is the source of onBeforeCompile, which we replace
      const prevKey = m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey
        ? () => prevCompile.toString() : m.customProgramCacheKey.bind(m);
      m.onBeforeCompile = function (sh, r) {
        prevCompile.call(this, sh, r);
        const fs = sh.fragmentShader;
        if (!fs.includes('#include <alphatest_fragment>') || !fs.includes('#include <opaque_fragment>')) return;
        sh.fragmentShader = fs.replace('#include <alphatest_fragment>', A2C_TEST)
          .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n\tgl_FragColor.a = a2cAlpha;');
      };
      m.customProgramCacheKey = () => prevKey() + '|a2c';
      m.needsUpdate = true;
    }
  });
}

// Lost GPU context (driver reset, GPU switch, memory pressure on phones): show a calm message, rebuild
// once the browser hands the context back.
let contextLost = false;
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  contextLost = true;
  $('veilMsg').textContent = '画面正在恢复…';
  $('veil').classList.remove('clear');
}, false);
canvas.addEventListener('webglcontextrestored', () => {
  const rebuild = () => {
    if (loading) { setTimeout(rebuild, 250); return; }
    contextLost = false;
    buildComposer();
    resize(true);
    const id = current ? current.meta.id : save.scene;
    if (current) current.meta = { ...current.meta, id: '__reload' };
    enterWorld(id);
  };
  rebuild();
}, false);

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */
const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const rgbeLoader = new RGBELoader();
const assetCache = new Map();
const asset = p => new URL(p, ASSET_BASE).href;
function cached(key, fn) { if (!assetCache.has(key)) assetCache.set(key, fn()); return assetCache.get(key); }
// .glb models ship as base64 script modules (`<name>.glb.js`) because the artifact host only serves
// web media types; decode and hand the bytes to GLTFLoader.
function decodeBase64(b64) {
  const s = atob(b64), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}
const loadGLTF = path => cached('g:' + path, async () => {
  if (path.endsWith('.glb')) {
    const mod = await import(asset(path + '.js'));
    return gltfLoader.parseAsync(decodeBase64(mod.default), new URL('.', asset(path)).href);
  }
  return gltfLoader.loadAsync(asset(path));
});
function loadTexture(path, { srgb = true, repeat = false } = {}) {
  const t = texLoader.load(asset(path));
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
const loadTextureAsync = (path, opts = {}) => new Promise((res, rej) => {
  texLoader.load(asset(path), t => { if (opts.srgb !== false) t.colorSpace = THREE.SRGBColorSpace; if (opts.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; res(t); }, undefined, rej);
});
const loadHDR = path => cached('h:' + path, () => rgbeLoader.loadAsync(asset(path)).then(t => { t.mapping = THREE.EquirectangularReflectionMapping; return t; }));

/* ------------------------------------------------------------------ */
/* Camera rig                                                          */
/* ------------------------------------------------------------------ */
const rig = { target: new THREE.Vector3(), yaw: 0, pitch: 0.3, dist: 10, yawT: 0, pitchT: 0.3, distT: 10, view: null, idlePhase: 0, wasIdle: false, bobW: 0 };
function vec3(v, fallback = [0, 0, 0]) { if (!v) v = fallback; return v.isVector3 ? v : new THREE.Vector3(v[0], v[1], v[2]); }
function configureRig(view) {
  rig.view = view || {};
  const v = rig.view;
  rig.target.copy(vec3(v.target));
  rig.yaw = rig.yawT = v.yaw ?? 0;
  rig.pitch = rig.pitchT = v.pitch ?? 0.3;
  rig.dist = rig.distT = v.dist ?? 10;
  rig.idlePhase = 0;
  if (current && v.fov) { current.inst.camera.fov = v.fov; current.inst.camera.updateProjectionMatrix(); }
}
function updateRig(dt, t) {
  const v = rig.view;
  if (!v || v.custom || !current) return;
  const cam = current.inst.camera;
  if (idle && v.drift) {
    if (v.yawRange) {
      const c = (v.yawRange[0] + v.yawRange[1]) / 2, a = (v.yawRange[1] - v.yawRange[0]) / 2 * 0.9;
      if (!rig.wasIdle) rig.idlePhase = Math.asin(clamp((rig.yawT - c) / Math.max(a, 1e-3), -1, 1));
      rig.idlePhase += dt * v.drift / Math.max(a, 0.05);
      rig.yawT = c + a * Math.sin(rig.idlePhase);
    } else rig.yawT += v.drift * dt;
    if (v.idlePitch !== undefined) rig.pitchT = damp(rig.pitchT, v.idlePitch, 0.2, dt);
    if (v.idleDist !== undefined) rig.distT = damp(rig.distT, v.idleDist, 0.2, dt);
  }
  rig.wasIdle = idle;
  if (v.yawRange) rig.yawT = clamp(rig.yawT, v.yawRange[0], v.yawRange[1]);
  if (v.pitchRange) rig.pitchT = clamp(rig.pitchT, v.pitchRange[0], v.pitchRange[1]);
  if (v.distRange) rig.distT = clamp(rig.distT, v.distRange[0], v.distRange[1]);
  rig.yaw = damp(rig.yaw, rig.yawT, 3.5, dt);
  rig.pitch = damp(rig.pitch, rig.pitchT, 3.5, dt);
  rig.dist = damp(rig.dist, rig.distT, 3, dt);
  const tgt = vec3(v.target);
  rig.target.lerp(tgt, 1 - Math.exp(-2 * dt));
  // a slow breathing bob only while the screensaver runs: with someone looking, the camera stays put
  // (even sub-pixel motion makes thin grass and fins crawl)
  rig.bobW = damp(rig.bobW || 0, idle ? 1 : 0, 0.6, dt);
  const bob = Math.sin(t * 0.21) * 0.012 * rig.dist * rig.bobW;
  const cp = Math.cos(rig.pitch);
  cam.position.set(
    rig.target.x + rig.dist * cp * Math.sin(rig.yaw),
    rig.target.y + rig.dist * Math.sin(rig.pitch) + bob,
    rig.target.z + rig.dist * cp * Math.cos(rig.yaw));
  if (v.minY !== undefined && cam.position.y < v.minY) cam.position.y = v.minY;
  cam.lookAt(rig.target);
}

/* ------------------------------------------------------------------ */
/* World lifecycle                                                     */
/* ------------------------------------------------------------------ */
let current = null; // { meta, def, inst, env }
let loading = false;
let sceneStart = 0;
const audio = new Ambience();
// The clock the worlds see: real time in whole minutes, glided over ~2 s each time the minute ticks
// over. The sun then neither slides every frame (shadow edges would shimmer) nor jumps once a minute
// (long golden-hour shadows would hop by a metre).
const clock = { shown: null };
function targetHours() {
  if (save.timeMode === 'manual') return save.manualHour;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}
function tickHours(dt) {
  const target = targetHours();
  if (clock.shown === null) { clock.shown = target; return; }
  let diff = target - clock.shown;
  if (diff > 12) diff -= 24; else if (diff < -12) diff += 24; // across midnight
  // a manual change, a woken laptop or a hidden tab: cut straight to the new time
  if (Math.abs(diff) > 5 / 60 || Math.abs(diff) < 1e-6) { clock.shown = target; return; }
  clock.shown += diff * (1 - Math.exp(-dt * 1.6));
  if (clock.shown >= 24) clock.shown -= 24; else if (clock.shown < 0) clock.shown += 24;
}
const hours = () => clock.shown ?? targetHours();

function makeEnv(meta, def) {
  const seed = hashString(save.seed + ':' + meta.id);
  const members = ensureMembers(def, meta.id);
  return {
    THREE, renderer, pmrem,
    quality: qName, q: Q.q, shadows: Q.shadows,
    get msaa() { return scenePass ? scenePass.target.samples : 0; }, // MSAA samples of the scene buffer (0 = none)
    seed, rng: makeRng(seed),
    hours, sun: opts => sunState(hours(), opts),
    members,
    kinds: def.kinds,
    fullness,
    isIdle: () => idle,
    asset, loadGLTF, loadTexture, loadTextureAsync, loadHDR,
    onEat: (member, pos) => onEat(meta, def, member, pos),
    toast,
    sfx: name => audio.sfx(name),
    markDirty: () => { dirty = true; },
  };
}

async function enterWorld(id, { first = false } = {}) {
  if (loading) return;
  const meta = WORLDS.find(w => w.id === id) || WORLDS[0];
  if (current && current.meta.id === meta.id && !first) return;
  loading = true;
  hideTitleCard();
  $('veilMsg').textContent = `正在前往 · ${meta.name}`;
  $('veil').classList.remove('clear');
  await sleep(first ? 0 : 950);
  if (current) {
    try { current.inst.dispose?.(); } catch (e) { console.error(e); }
    try { disposeObject(current.inst.scene); } catch (e) { console.error(e); }
    current = null;
  }
  try {
    const mod = await import(meta.file);
    const def = mod.default;
    const env = makeEnv(meta, def);
    const inst = await def.create(env);
    current = { meta, def, inst, env };
    smoothCutouts(inst.scene);
    scenePass.scene = inst.scene;
    scenePass.camera = inst.camera;
    dynRestore(meta.id);
    resize(true);
    configureRig(inst.view);
    updateRig(0, 0);
    post.snap = true;
    applyPost(inst.post);
    // compile against the scene buffer so the programs match what the frames will use
    try {
      const prevTarget = renderer.getRenderTarget();
      renderer.setRenderTarget(scenePass.target);
      await renderer.compileAsync(inst.scene, inst.camera);
      renderer.setRenderTarget(prevTarget);
    } catch (e) { renderer.setRenderTarget(null); }
    // warm-up: let the world settle for a moment before revealing (also builds shadow maps and
    // compiles the depth programs under the veil instead of hitching the first visible frames)
    elapsed = 0;
    for (let i = 0; i < 3; i++) { elapsed += 1 / 60; inst.update(1 / 60, elapsed); updateRig(1 / 60, elapsed); composer.render(1 / 60); }
    save.scene = meta.id; dirty = true;
    sceneStart = performance.now();
    lastRenderAt = 0;
    updateDock(); updateStatus(); updateAmbience();
    $('feedLabel').textContent = '撒一把' + (def.food || '食物');
    $('veil').classList.add('clear');
    showTitleCard(meta);
    if (!save.hinted && !TEST) {
      save.hinted = true;
      setTimeout(() => toast('点击水面或地面投喂 · 拖动旋转视角 · 鼠标不动 8 秒进入待机'), 3800);
    }
    window.__idle.sceneId = meta.id;
    window.__idle.error = null;
  } catch (e) {
    console.error('[scene]', meta.id, e);
    window.__idle.error = String(e && e.stack || e);
    $('veilMsg').textContent = `${meta.name} 暂时无法打开，请换一个世界`;
  }
  loading = false;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function onEat(meta, def, member, pos) {
  audio.sfx(def.eatSound || 'eat');
  if (!member) return;
  member.eaten = (member.eaten || 0) + 1;
  member.lastAte = Date.now();
  member.size = Math.min(1.5, (member.size || 1) + 0.012);
  dirty = true;
  if (pos) heartAt(pos);
  const kind = def.kinds[member.kind]?.zh || '';
  if (member.eaten % 10 === 0) toast(`${member.name}（${kind}）吃了第 ${member.eaten} 顿，又长大了一点`);
  else if (Math.random() < 0.35) toast(`${member.name} 吃到了${def.food || '食物'}`);
  updateStatus();
}

/* ------------------------------------------------------------------ */
/* HUD                                                                 */
/* ------------------------------------------------------------------ */
function buildDock() {
  const dock = $('dock');
  dock.innerHTML = '';
  WORLDS.forEach((w, i) => {
    const b = document.createElement('button');
    b.className = 'card';
    b.style.setProperty('--g', `url("${asset('thumbs/' + w.id + '.jpg')}") center/cover no-repeat, ${w.g}`);
    b.dataset.id = w.id;
    b.title = `${w.name} · ${w.sub}（${w.ref.replace('inspired by ', '灵感：')}）`;
    b.innerHTML = `<span class="key">${i + 1}</span><span class="nm">${w.name}</span><span class="sb">${w.sub}</span>`;
    b.addEventListener('click', () => { wake(); enterWorld(w.id); });
    dock.appendChild(b);
  });
}
function updateDock() {
  for (const b of $('dock').children) b.setAttribute('aria-current', current && b.dataset.id === current.meta.id ? 'true' : 'false');
}
function updateStatus() {
  if (!current) return;
  const w = worldSave(current.meta.id);
  const ms = current.env.members;
  const hungry = ms.filter(m => fullness(m) < 0.3).length;
  $('statusLine').innerHTML = `${current.meta.sub}里住着 <b>${ms.length}</b> 位居民 · 今天投喂 <b>${w.fed}</b> 次` + (hungry ? ` · <b>${hungry}</b> 位饿了` : '');
  $('clockWhere').textContent = `${current.meta.name} · ${current.meta.sub}`;
}
function tickClock() {
  const d = new Date();
  $('clockTime').textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  $('clockDate').textContent = `${d.getMonth() + 1}月${d.getDate()}日 · 星期${'日一二三四五六'[d.getDay()]}`;
  // gentle drift so a screen left on all day does not burn in
  const m = d.getMinutes();
  $('clock').style.transform = `translate(${-Math.sin(m / 60 * TAU) * 6}px, ${-Math.cos(m / 60 * TAU) * 4}px)`;
}
let titleTimer = 0;
function showTitleCard(meta) {
  const i = WORLDS.indexOf(meta) + 1;
  $('tcEyebrow').textContent = `第 ${'一二三四五六七八'[i - 1]} 境`;
  $('tcName').textContent = meta.name;
  $('tcSub').textContent = meta.sub;
  $('tcRef').textContent = meta.ref;
  $('titleCard').classList.add('show');
  clearTimeout(titleTimer);
  titleTimer = setTimeout(hideTitleCard, 3400);
}
function hideTitleCard() { $('titleCard').classList.remove('show'); }
function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast glass';
  el.textContent = text;
  $('toasts').appendChild(el);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  setTimeout(() => el.remove(), 3300);
}
const _proj = new THREE.Vector3();
function toScreen(pos) {
  if (!current) return null;
  _proj.copy(pos).project(current.inst.camera);
  if (_proj.z > 1) return null;
  return { x: (_proj.x * 0.5 + 0.5) * view.w, y: (-_proj.y * 0.5 + 0.5) * view.h };
}
function heartAt(pos) {
  const s = toScreen(pos);
  if (!s) return;
  const el = document.createElement('div');
  el.className = 'heart';
  el.textContent = '♥';
  el.style.left = s.x + 'px';
  el.style.top = s.y + 'px';
  $('fx').appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

/* hover tag */
let hover = null;
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickCreature(clientX, clientY) {
  if (!current || !current.inst.creatures) return null;
  ndc.set((clientX / view.w) * 2 - 1, -(clientY / view.h) * 2 + 1);
  raycaster.setFromCamera(ndc, current.inst.camera);
  let best = null, bestT = Infinity;
  for (const c of current.inst.creatures()) {
    if (!c.member && !c.label) continue;
    const toC = _proj.copy(c.pos).sub(raycaster.ray.origin);
    const along = toC.dot(raycaster.ray.direction);
    if (along < 0) continue;
    const d = raycaster.ray.distanceToPoint(c.pos);
    if (d < (c.radius || 0.5) * 1.3 && along < bestT) { bestT = along; best = c; }
  }
  return best;
}
function updateTag() {
  const tag = $('tag');
  if (!hover || idle || !current) { if (!tag.hidden) tag.hidden = true; return; }
  const c = hover;
  const s = toScreen(_proj.copy(c.pos).add(new THREE.Vector3(0, (c.radius || 0.5) * 1.1, 0)));
  if (!s) { if (!tag.hidden) tag.hidden = true; return; }
  if (tag.hidden) tag.hidden = false;
  tag.style.left = s.x + 'px';
  tag.style.top = (s.y - 8) + 'px';
  const key = c.member ? c.member.id + ':' + c.member.eaten : c.label;
  if (tag.dataset.key !== key) {
    tag.dataset.key = key;
    if (c.member) {
      const m = c.member, f = Math.round(fullness(m) * 100);
      const kind = current.def.kinds[m.kind]?.zh || '';
      const days = Math.max(1, Math.round((Date.now() - (m.born || Date.now())) / 864e5));
      tag.innerHTML = `<span class="nm">${m.name}</span><span class="kd">${kind}</span><div class="meter"><i style="width:${f}%"></i></div><div class="ln">饱腹 ${f}% · 吃过 ${m.eaten} 顿 · 来了 ${days} 天</div>`;
    } else tag.innerHTML = `<span class="nm">${c.label}</span>`;
  }
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */
let idle = false;
let lastInput = performance.now();
function wake() { lastInput = performance.now(); if (idle) { idle = false; document.body.classList.remove('idle'); } }
const pointers = new Map();
let press = null, pinchDist = 0;
canvas.addEventListener('pointerdown', e => {
  wake();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) press = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 };
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDist = Math.hypot(a.x - b.x, a.y - b.y); press = null; }
});
canvas.addEventListener('pointermove', e => {
  wake();
  const p = pointers.get(e.pointerId);
  if (!p) { hover = pickCreature(e.clientX, e.clientY); return; }
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinchDist > 0) rig.distT *= pinchDist / Math.max(d, 1);
    pinchDist = d;
    return;
  }
  if (press) press.moved += Math.abs(dx) + Math.abs(dy);
  if (press && press.moved > 6) {
    canvas.classList.add('dragging');
    rig.yawT -= dx * 0.0045;
    rig.pitchT += dy * 0.0035;
    hover = null;
  }
});
const endPointer = e => {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  canvas.classList.remove('dragging');
  if (p && press && press.moved <= 6 && performance.now() - press.t < 700) feedAt(e.clientX, e.clientY);
  if (pointers.size < 2) pinchDist = 0;
  press = null;
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); press = null; canvas.classList.remove('dragging'); });
canvas.addEventListener('wheel', e => { wake(); e.preventDefault(); rig.distT *= Math.exp(e.deltaY * 0.0012); }, { passive: false });

function feedAt(x, y) {
  if (!current || loading) return false;
  ndc.set((x / view.w) * 2 - 1, -(y / view.h) * 2 + 1);
  raycaster.setFromCamera(ndc, current.inst.camera);
  const hit = current.inst.feed?.(raycaster);
  if (hit) countFeed();
  return !!hit;
}
function countFeed(n = 1) {
  const w = worldSave(current.meta.id);
  w.fed += n;
  dirty = true;
  updateStatus();
}
function feedHandful() {
  if (!current || loading) return;
  wake();
  if (current.inst.feedRandom) { const n = current.inst.feedRandom(6); countFeed(typeof n === 'number' ? n : 1); return; }
  let ok = 0;
  for (let i = 0; i < 24 && ok < 6; i++) if (feedAt(view.w * (0.3 + Math.random() * 0.4), view.h * (0.35 + Math.random() * 0.35))) ok++;
}
function addResident() {
  if (!current) return;
  const def = current.def, ms = current.env.members;
  const max = def.maxMembers || 16;
  if (ms.length >= max) { toast(`${current.meta.sub}已经住满 ${max} 位居民了`); return; }
  const rng = makeRng(randomSeed());
  const kind = rng.pick(def.addable || Object.keys(def.kinds));
  const m = makeMember(def, kind, rng, ms.map(x => x.name));
  ms.push(m);
  dirty = true;
  current.inst.addMember?.(m);
  toast(`欢迎新居民 ${m.name}（${def.kinds[kind].zh}）`);
  updateStatus();
}

window.addEventListener('keydown', e => {
  wake();
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= WORLDS.length) enterWorld(WORLDS[n - 1].id);
  else if (e.key === ' ') { e.preventDefault(); feedHandful(); }
  else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
  else if (e.key === 'm' || e.key === 'M') toggleSound();
  else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('noui');
  else if (e.key === 'Escape') closeSettings();
});
window.addEventListener('resize', () => { needsResize = true; });
try { new ResizeObserver(() => { needsResize = true; }).observe(canvas); } catch (e) {}
(function watchDpr() {
  try {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mq.addEventListener('change', () => { needsResize = true; watchDpr(); }, { once: true });
  } catch (e) {}
})();
window.addEventListener('hashchange', () => { const id = hashWorld(); if (WORLDS.some(w => w.id === id)) enterWorld(id); });

$('btnFeed').addEventListener('click', feedHandful);
$('btnAdd').addEventListener('click', () => { wake(); addResident(); });
$('btnFull').addEventListener('click', toggleFullscreen);
$('btnSound').addEventListener('click', toggleSound);
$('btnSettings').addEventListener('click', () => { wake(); $('settings').classList.contains('open') ? closeSettings() : openSettings(); });
$('btnClose').addEventListener('click', closeSettings);

let wakeLock = null;
async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch (e) {}
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch (e) {}
  lastInput = -1e9; // go straight to screensaver mode
}
async function toggleSound() {
  save.sound = !save.sound;
  dirty = true;
  if (save.sound) { const ok = await audio.enable(); if (!ok) save.sound = false; }
  else audio.disable();
  $('btnSound').setAttribute('aria-pressed', String(save.sound));
  if (save.sound) updateAmbience();
}
function updateAmbience() {
  if (!current) return;
  const a = current.def.ambience;
  audio.set(typeof a === 'function' ? a(hours()) : a || []);
}

/* settings */
function seg(id, value, onPick) {
  const el = $(id);
  for (const b of el.querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String(b.dataset.v === String(value)));
    b.onclick = () => { for (const x of el.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b)); onPick(b.dataset.v); };
  }
}
function fmtHour(h) { const hh = Math.floor(h) % 24, mm = Math.round((h - Math.floor(h)) * 60); return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; }
function openSettings() {
  $('settings').classList.add('open');
  $('settings').setAttribute('aria-hidden', 'false');
  $('pcName2').value = save.name;
  $('seedText').textContent = '#' + (save.seed >>> 0).toString(16).toUpperCase().padStart(8, '0').replace(/(.{4})/, '$1-');
  seg('segTime', save.timeMode, v => { save.timeMode = v; dirty = true; $('manualTime').hidden = v !== 'manual'; });
  $('manualTime').hidden = save.timeMode !== 'manual';
  $('hourRange').value = save.manualHour;
  $('hourText').textContent = fmtHour(save.manualHour);
  seg('segQuality', save.quality, v => { save.quality = v; dirty = true; setQuality(effectiveQuality()); updateQualityHint(); });
  updateQualityHint();
  seg('segRotate', save.rotate, v => { save.rotate = +v; dirty = true; });
  seg('segPower', save.powerSave ? 1 : 0, v => { save.powerSave = v === '1'; dirty = true; });
  seg('segClock', save.showClock ? 1 : 0, v => { save.showClock = v === '1'; dirty = true; document.body.classList.toggle('hide-clock', !save.showClock); });
}
function updateQualityHint() {
  const pct = Math.round(DYN_STEPS[dyn.i] * 100);
  $('qualityHint').textContent = `当前：${{ high: '高', medium: '中', low: '低' }[qName]}画质，渲染分辨率 ${pct}%。“自动”会按这台设备的显卡选择画质，并根据流畅度平滑调整分辨率，不会重新加载画面。`;
}
function closeSettings() { $('settings').classList.remove('open'); $('settings').setAttribute('aria-hidden', 'true'); $('reseedConfirm').hidden = true; }
$('hourRange').addEventListener('input', e => { save.manualHour = parseFloat(e.target.value); $('hourText').textContent = fmtHour(save.manualHour); dirty = true; });
const syncName = v => { save.name = v.trim() || '我的电脑'; dirty = true; $('pcName').value = save.name; $('pcName2').value = save.name; document.title = `栖境 · ${save.name}`; };
$('pcName').addEventListener('change', e => syncName(e.target.value));
$('pcName2').addEventListener('change', e => syncName(e.target.value));
$('pcName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
$('btnReseed').addEventListener('click', () => { $('reseedConfirm').hidden = false; });
$('reseedNo').addEventListener('click', () => { $('reseedConfirm').hidden = true; });
$('reseedYes').addEventListener('click', () => {
  save.seed = randomSeed(); save.worlds = {}; persist();
  $('reseedConfirm').hidden = true;
  closeSettings();
  const id = current ? current.meta.id : save.scene;
  current && (current.meta = { ...current.meta, id: '__reload' });
  enterWorld(id, { first: false });
  toast('这台电脑的世界已经重新生成');
});

// Only an explicit choice in Settings changes the detail tier (instance counts are built per world,
// so the world is rebuilt once). Automatic adaptation is resolution-only and never reloads.
function setQuality(name) {
  if (name === qName) return;
  qName = name; Q = QUALITY[name];
  dynRestore(current ? current.meta.id : save.scene);
  renderer.shadowMap.enabled = Q.shadows;
  buildComposer();
  resize(true);
  if (current) {
    const id = current.meta.id;
    current.meta = { ...current.meta, id: '__reload' };
    enterWorld(id);
  }
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */
let last = performance.now(), elapsed = 0, acc = 0, minuteTimer = 0, lastRenderAt = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rawMs = now - last;
  last = now;
  dynTick(rawMs);
  const rawDt = Math.min(0.1, Math.max(0, rawMs) / 1000);
  minuteTimer += rawDt;
  if (minuteTimer > 15) {
    minuteTimer = 0;
    tickClock();
    updateStatus();
    updateAmbience();
    if (dirty) persist();
    if (idle && save.rotate > 0 && current && !loading && performance.now() - sceneStart > save.rotate * 60e3) {
      const i = WORLDS.findIndex(w => w.id === current.meta.id);
      enterWorld(WORLDS[(i + 1) % WORLDS.length].id);
    } else if (idle && current && !loading && !TEST && new Date().getHours() === 4 && performance.now() - sceneStart > 6 * 3600e3) {
      // A screen left on for days: rebuild the world once at 4 a.m. so animation clocks start fresh
      // (GPU float time loses precision after a day or two and motion would start to stutter).
      const id = current.meta.id;
      current.meta = { ...current.meta, id: '__reload' };
      enterWorld(id);
    }
  }
  // idle state
  const idleNow = !(TEST && TEST.noIdle) && performance.now() - lastInput > 8000 && !$('settings').classList.contains('open') && document.activeElement?.tagName !== 'INPUT';
  if (idleNow !== idle) { idle = idleNow; document.body.classList.toggle('idle', idle); }
  // power save: 30 fps in screensaver mode; awake, at most ~75 fps (120/144 Hz screens would otherwise
  // run a phone hot rendering twice as many frames as anyone can see)
  const throttled = idle && save.powerSave && !TEST;
  acc += rawDt;
  if (throttled ? acc < 1 / 31 : (!TEST && dyn.vsync < 11 && acc < 1 / 75)) return;
  const dt = Math.min(0.05, acc);
  acc = 0;
  if (contextLost) return;
  if (needsResize) { needsResize = false; resize(); }
  if (current && !loading) {
    elapsed += dt;
    tickHours(dt);
    try { current.inst.update(dt, elapsed); } catch (e) { console.error(e); window.__idle.error = String(e.stack || e); }
    updateRig(dt, elapsed);
    applyPost(current.inst.post || {}, dt);
    composer.render(dt);
    if (lastRenderAt) dynSample(now - lastRenderAt, now, throttled);
    lastRenderAt = now;
    updateTag();
  } else lastRenderAt = 0;
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
window.__idle = {
  ready: null, sceneId: null, error: null,
  enterWorld, feedAt, feedHandful, addResident,
  setHours: h => { save.timeMode = 'manual'; save.manualHour = h; clock.shown = h; },
  /** Advance the simulation without rendering (test harness). */
  simulate(seconds, step = 1 / 30) {
    if (!current) return;
    for (let s = 0; s < seconds; s += step) { elapsed += step; current.inst.update(step, elapsed); updateRig(step, elapsed); applyPost(current.inst.post || {}, step); }
  },
  setView(v) { Object.assign(rig, v); if (v.yaw !== undefined) rig.yawT = v.yaw; if (v.pitch !== undefined) rig.pitchT = v.pitch; if (v.dist !== undefined) rig.distT = v.dist; },
  /**
   * Test-only stability probe: NaN/Inf and extreme values in the HDR scene buffer, plus temporal
   * flicker (pixels that swing up then down between consecutive 60 fps frames) on the final image.
   */
  diagnose({ frames = 8, dt = 1 / 60, w = 320, h = 180, heatmap = false } = {}) {
    if (!current) return null;
    const inst = current.inst;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(inst.scene, inst.camera);
    const fb = new Float32Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, fb);
    renderer.setRenderTarget(prevTarget);
    rt.dispose();
    let nan = 0, inf = 0, maxL = 0, over32 = 0, maxAt = null, nanAt = null;
    for (let i = 0; i < w * h; i++) {
      const r = fb[i * 4], g = fb[i * 4 + 1], b = fb[i * 4 + 2];
      // positions as [x, y] fractions of the screen, origin top-left
      const at = () => [+((i % w) / w).toFixed(3), +(1 - Math.floor(i / w) / h).toFixed(3)];
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) { nan++; nanAt = nanAt || at(); continue; }
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) { inf++; nanAt = nanAt || at(); continue; }
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (L > maxL) { maxL = L; maxAt = at(); }
      if (L > 32) over32++;
    }
    const gl = renderer.getContext();
    const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight;
    const px = new Uint8Array(W * H * 4);
    const lums = [];
    const means = [];
    for (let f = 0; f < frames; f++) {
      elapsed += dt;
      inst.update(dt, elapsed);
      updateRig(dt, elapsed);
      applyPost(inst.post || {}, dt);
      composer.render(dt);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const L = new Float32Array(W * H);
      let sum = 0;
      for (let i = 0; i < W * H; i++) { const v = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255; L[i] = v; sum += v; }
      lums.push(L); means.push(sum / (W * H));
    }
    let osc = 0, total = 0, meanDelta = 0;
    const hits = heatmap ? new Uint8Array(W * H) : null;
    for (let f = 2; f < lums.length; f++) {
      const a = lums[f - 2], b = lums[f - 1], c = lums[f];
      for (let i = 0; i < a.length; i++) {
        const d1 = b[i] - a[i], d2 = c[i] - b[i];
        if (d1 * d2 < 0 && Math.min(Math.abs(d1), Math.abs(d2)) > 0.12) { osc++; if (hits) hits[i]++; }
        meanDelta += Math.abs(d2);
        total++;
      }
    }
    let globalJump = 0;
    for (let f = 1; f < means.length; f++) globalJump = Math.max(globalJump, Math.abs(means[f] - means[f - 1]));
    let map = null;
    if (hits) {
      // dimmed last frame, flickering pixels in red (brighter = flickered in more frame pairs)
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      const cx = cv.getContext('2d'), img = cx.createImageData(W, H), L = lums[lums.length - 1];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const src = (H - 1 - y) * W + x, dst = (y * W + x) * 4, g = L[src] * 110, k = hits[src];
        img.data[dst] = k ? 150 + Math.min(105, k * 25) : g; img.data[dst + 1] = k ? 20 : g; img.data[dst + 2] = k ? 20 : g; img.data[dst + 3] = 255;
      }
      cx.putImageData(img, 0, 0);
      map = cv.toDataURL('image/png');
    }
    return { nan, inf, nanAt, maxL: +maxL.toFixed(1), maxAt, over32, flickerPermille: +(1000 * osc / Math.max(1, total)).toFixed(3), meanDelta: +(meanDelta / Math.max(1, total)).toFixed(4), globalJump: +globalJump.toFixed(4), size: [W, H], map };
  },
  /**
   * Test-only NaN hunt: tags every material so a fragment that outputs NaN/Inf writes its material id
   * instead, renders a few frames into a float target and reports which materials (and meshes) did it.
   */
  nanHunt({ frames = 12, dt = 1 / 30, w = 320, h = 180 } = {}) {
    if (!current) return null;
    const inst = current.inst, mats = [], owners = new Map();
    inst.scene.traverse(o => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m) continue;
        if (!mats.includes(m)) mats.push(m);
        if (!owners.has(m)) owners.set(m, []);
        if (owners.get(m).length < 3) owners.get(m).push(`${o.type}${o.name ? ':' + o.name : ''}${o.isInstancedMesh ? '[' + o.count + ']' : ''}`);
      }
    });
    mats.forEach((m, i) => {
      if (m.userData.nanTag) return;
      m.userData.nanTag = i + 1;
      const prev = m.onBeforeCompile;
      const prevKey = m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey ? () => prev.toString() : m.customProgramCacheKey.bind(m);
      m.onBeforeCompile = function (sh, r) {
        prev.call(this, sh, r);
        const fs = sh.fragmentShader, end = fs.lastIndexOf('}');
        sh.fragmentShader = fs.slice(0, end) + `\n#if __VERSION__ >= 300\n  if (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) gl_FragColor = vec4(${(i + 1).toFixed(1)}, -1.0, 0.0, 1.0);\n#endif\n` + fs.slice(end);
      };
      m.customProgramCacheKey = () => prevKey() + '|nan' + (i + 1);
      m.needsUpdate = true;
    });
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
    const fb = new Float32Array(w * h * 4), hits = {};
    const prevTarget = renderer.getRenderTarget();
    for (let f = 0; f < frames; f++) {
      elapsed += dt; inst.update(dt, elapsed); updateRig(dt, elapsed);
      renderer.setRenderTarget(rt); renderer.render(inst.scene, inst.camera);
      renderer.readRenderTargetPixels(rt, 0, 0, w, h, fb);
      for (let i = 0; i < w * h; i++) {
        const r = fb[i * 4], g = fb[i * 4 + 1];
        if (g === -1) { const id = Math.round(r); hits[id] = hits[id] || { n: 0, at: [+((i % w) / w).toFixed(3), +(1 - Math.floor(i / w) / h).toFixed(3)] }; hits[id].n++; }
        else if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(fb[i * 4 + 2])) { hits.untagged = hits.untagged || { n: 0 }; hits.untagged.n++; }
      }
    }
    renderer.setRenderTarget(prevTarget);
    rt.dispose();
    return Object.entries(hits).map(([id, v]) => {
      const m = mats[+id - 1];
      return m ? { id: +id, ...v, type: m.type, name: m.name, owners: owners.get(m), uniforms: m.uniforms ? Object.keys(m.uniforms).slice(0, 8) : undefined } : { id, ...v };
    });
  },
  get current() { return current; },
  get rig() { return rig; },
  renderer,
};
buildDock();
$('pcName').value = save.name;
document.title = `栖境 · ${save.name}`;
document.body.classList.toggle('hide-clock', !save.showClock);
if (TEST && TEST.noUI) document.body.classList.add('noui');
renderer.shadowMap.enabled = Q.shadows;
buildComposer();
resize(true);
tickClock();
setInterval(tickClock, 10000);
window.addEventListener('beforeunload', () => { if (dirty) persist(); });
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) { if (dirty) persist(); return; }
  // the screen wake lock is dropped whenever the page is hidden; take it back for full-screen screensavers
  if (document.fullscreenElement && navigator.wakeLock && (!wakeLock || wakeLock.released)) {
    try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
  }
});
if (save.sound) {
  // browsers need a gesture before audio can start
  $('btnSound').setAttribute('aria-pressed', 'true');
  const startAudio = async () => { await audio.enable(); updateAmbience(); window.removeEventListener('pointerdown', startAudio); };
  window.addEventListener('pointerdown', startAudio);
}
window.__idle.ready = enterWorld(save.scene, { first: true });
requestAnimationFrame(frame);
