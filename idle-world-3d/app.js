// 栖境 — app shell: renderer, post-processing, camera rig, feeding input, residents,
// per-computer save data, idle/screensaver mode, ambience, the HUD and the guardians' lessons (lib/guide.js), with the
// company's own lessons and learning records when the screen is connected to them (lib/school.js).
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { makeRng, hashString, sunState, disposeObject, clamp, lerp, damp, TAU } from './lib/util.js';
import { Ambience } from './lib/audio.js';
import { createGuide } from './lib/guide.js';
import { createSchool } from './lib/school.js';
import { BACKEND } from './lessons/backend.js';

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
  timeMode: 'real', manualHour: 12, rotate: 0, sound: false, idle30: false, showClock: true, worlds: {},
}, loadSave() || {});
// 'powerSave' (30 fps in screensaver mode) used to be on by default; screensaver mode now stays smooth
// unless 30 fps is chosen in the settings
delete save.powerSave;
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
// Which browser generation is this? Older iPads and iPhones (iOS / iPadOS before 17, A8–A12 era) get a
// lighter tier, and Safari 14 (iOS 14) runs on WebGL 1: its WebGL 2 is an unfinished experimental switch.
// iPadOS Safari reports a Mac user agent, so the OS version comes from "CPU OS 14_8", "Version/14.1", or,
// when neither is present (home-screen web apps), from whether the browser can do import maps (16.4+).
const UA = navigator.userAgent;
const IS_APPLE_TOUCH = /iPad|iPhone|iPod/.test(UA) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(UA));
const APPLE_OS = (() => {
  const m = UA.match(/OS (\d+)_\d+(?:_\d+)? like Mac OS X/) || UA.match(/Version\/(\d+)(?:\.\d+)*(?: Mobile\/\S+)? Safari/);
  return m ? +m[1] : 0;
})();
const IMPORT_MAPS = !!(window.HTMLScriptElement && HTMLScriptElement.supports && HTMLScriptElement.supports('importmap'));
const OLD_APPLE = IS_APPLE_TOUCH && (APPLE_OS ? APPLE_OS < 17 : !IMPORT_MAPS);
const SAFARI_14 = /Safari/.test(UA) && !/Chrome|Chromium|Edg|Firefox/.test(UA) && APPLE_OS > 0 && APPLE_OS < 15;

let renderer;
try {
  const attrs = { antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false };
  const context = SAFARI_14 ? canvas.getContext('webgl', attrs) || undefined : undefined;
  renderer = new THREE.WebGLRenderer({ canvas, context, ...attrs });
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
const CAN_HALF = IS_WEBGL2
  ? (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'))
  : (renderer.extensions.has('OES_texture_half_float') && renderer.extensions.has('OES_texture_half_float_linear') && renderer.extensions.has('EXT_color_buffer_half_float'));
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
  // phones and tablets (older iPads too): the adaptive resolution and frame cap below fit it to the device
  low: { pr: 1.5, maxPixels: 1.2e6, samples: 4, shadows: false, q: 0.45 },
};
function effectiveQuality() {
  if (save.quality && save.quality !== 'auto' && QUALITY[save.quality]) return save.quality;
  if (IS_MOBILE || OLD_APPLE) return 'low';
  return WEAK_GPU ? 'medium' : 'high';
}
let qName = effectiveQuality();
const tier = name => ({ ...QUALITY[name], shadows: QUALITY[name].shadows && IS_WEBGL2 });
let Q = tier(qName);

/* Post-processing in as few full-screen passes as possible. On the iPad's tile-based GPU every full-screen pass
   carries the whole frame out to memory and back, so after the world itself there are two:
     the world      -> its own HDR buffer (multisampled where the GPU can: WebGL 2)
     bloom          reads that buffer straight away, at half resolution and below
     output         the HDR buffer, cleaned, plus bloom; exposure, tone mapping, sRGB, colour grade, vignette and
                    a static dither -> an 8-bit buffer
     final          FXAA (WebGL 1, where there is no MSAA) or chromatic aberration and tilt-shift -> the screen
   It used to be five, each through a half-float buffer: a cleaning copy, bloom added onto the frame in a pass of
   its own, output, FXAA, and grade. */

// NaN/Inf are cleared and extreme highlights soft-limited wherever the HDR frame is read. A single NaN pixel (or a
// one-pixel specular sparkle worth 1000x) would otherwise be smeared by bloom into flashing blocks.
const HDR_CLEAN = /* glsl */`
  uniform float uKnee;
  bool hdrBad(float x){
    #if __VERSION__ >= 300
      return isnan(x) || isinf(x);
    #else
      return !(x < 1e20 && x > -1e20); // WebGL1 has no isnan(): NaN fails every comparison
    #endif
  }
  vec3 hdrClean(vec3 v){
    if (hdrBad(v.r) || hdrBad(v.g) || hdrBad(v.b)) return vec3(0.0);
    v = clamp(v, vec3(0.0), vec3(65000.0));
    float m = max(max(v.r, v.g), v.b);
    if (m > uKnee) v *= (uKnee + (m - uKnee) / (1.0 + (m - uKnee) / uKnee)) / m;
    return v;
  }`;
// Static sub-LSB dither against banding, applied before the picture is stored in 8 bits. No animated film grain:
// moving noise reads as flicker, most of all in dark scenes on phone screens.
const DITHER = /* glsl */`
  float dither(){ return (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0; }`;
const QUAD_VS = /* glsl */`
  precision highp float;
  uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
  attribute vec3 position; attribute vec2 uv;
  varying vec2 vUv;
  void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// Bloom read straight from the world's buffer. Its first step samples the frame where three's bloom always did (one
// bilinear sample per half-resolution texel), but blends the four pixels itself, each cleaned first: exactly what
// sampling the old cleaned copy gave. (Cleaning after the filtering would let a lone sparkle bloom 30x brighter, and
// a plain 2x2 average, a texel off on odd sizes, dimmed thin glowing lines below the threshold.) The result is left
// at half resolution (`texture`, to add as rgb * a) instead of being blended onto the frame in a pass of its own.
class Bloom extends UnrealBloomPass {
  constructor(size, strength, radius, threshold) {
    super(size, strength, radius, threshold);
    const u = this.highPassUniforms;
    u.uKnee = { value: 12 };
    u.uTexel = { value: new THREE.Vector2(1 / size.x, 1 / size.y) };
    const m = this.materialHighPassFilter, src = m.fragmentShader;
    const read = 'vec4 texel = texture2D( tDiffuse, vUv );';
    if (!src.includes(read)) console.warn('[post] bloom input not patched');
    m.fragmentShader = HDR_CLEAN + '\nuniform vec2 uTexel;\n' + src.replace(read, `
      vec2 tp = vUv / uTexel - 0.5, tf = fract(tp), t0 = (floor(tp) + 0.5) * uTexel;
      vec3 c00 = hdrClean(texture2D(tDiffuse, t0).rgb), c10 = hdrClean(texture2D(tDiffuse, t0 + vec2(uTexel.x, 0.0)).rgb);
      vec3 c01 = hdrClean(texture2D(tDiffuse, t0 + vec2(0.0, uTexel.y)).rgb), c11 = hdrClean(texture2D(tDiffuse, t0 + uTexel).rgb);
      vec4 texel = vec4(mix(mix(c00, c10, tf.x), mix(c01, c11, tf.x), tf.y), 1.0);`);
    m.needsUpdate = true;
  }
  setSize(w, h) { super.setSize(w, h); this.highPassUniforms.uTexel.value.set(1 / w, 1 / h); }
  get texture() { return this.renderTargetsHorizontal[0].texture; }
  /** UnrealBloomPass.render (three r160) up to its composite, from `tex`; the result is this.texture. */
  renderFrom(r, tex) {
    r.getClearColor(this._oldClearColor);
    const oldAlpha = r.getClearAlpha(), oldAutoClear = r.autoClear;
    r.autoClear = false;
    r.setClearColor(this.clearColor, 0);
    this.highPassUniforms.tDiffuse.value = tex;
    this.highPassUniforms.luminosityThreshold.value = this.threshold;
    this.fsQuad.material = this.materialHighPassFilter;
    r.setRenderTarget(this.renderTargetBright); r.clear(); this.fsQuad.render(r);
    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i];
      this.fsQuad.material = m;
      m.uniforms.colorTexture.value = input.texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      r.setRenderTarget(this.renderTargetsHorizontal[i]); r.clear(); this.fsQuad.render(r);
      m.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      r.setRenderTarget(this.renderTargetsVertical[i]); r.clear(); this.fsQuad.render(r);
      input = this.renderTargetsVertical[i];
    }
    const cu = this.compositeMaterial.uniforms;
    cu.bloomStrength.value = this.strength; cu.bloomRadius.value = this.radius; cu.bloomTintColors.value = this.bloomTintColors;
    this.fsQuad.material = this.compositeMaterial;
    r.setRenderTarget(this.renderTargetsHorizontal[0]); r.clear(); this.fsQuad.render(r);
    r.setClearColor(this._oldClearColor, oldAlpha);
    r.autoClear = oldAutoClear;
    return this.texture;
  }
}

// HDR frame (+ bloom) -> exposure, tone mapping (three's own, as its OutputPass), sRGB, colour grade, vignette,
// dither -> 8 bits
const OutputShader = {
  uniforms: {
    tScene: { value: null }, tBloom: { value: null }, uBloom: { value: 0 }, uKnee: { value: 12 }, toneMappingExposure: { value: 1 },
    uRes: { value: new THREE.Vector2(1, 1) }, uVignette: { value: 0.35 }, uSat: { value: 1.04 }, uContrast: { value: 1.02 },
    uLift: { value: new THREE.Vector3(0, 0, 0) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
  },
  vertexShader: QUAD_VS,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tScene, tBloom; uniform float uBloom;
    uniform vec2 uRes; uniform float uVignette, uSat, uContrast; uniform vec3 uLift, uGain;
    varying vec2 vUv;
    ${HDR_CLEAN}
    ${DITHER}
    #include <tonemapping_pars_fragment>
    #include <colorspace_pars_fragment>
    vec3 toneMapped(vec2 uv){
      vec4 c = vec4(hdrClean(texture2D(tScene, uv).rgb), 1.0);
      if (uBloom > 0.5) { vec4 b = texture2D(tBloom, uv); c.rgb += b.rgb * b.a; }
      #ifdef LINEAR_TONE_MAPPING
        c.rgb = LinearToneMapping(c.rgb);
      #elif defined( REINHARD_TONE_MAPPING )
        c.rgb = ReinhardToneMapping(c.rgb);
      #elif defined( CINEON_TONE_MAPPING )
        c.rgb = OptimizedCineonToneMapping(c.rgb);
      #elif defined( ACES_FILMIC_TONE_MAPPING )
        c.rgb = ACESFilmicToneMapping(c.rgb);
      #elif defined( AGX_TONE_MAPPING )
        c.rgb = AgXToneMapping(c.rgb);
      #endif
      #ifdef SRGB_TRANSFER
        c = sRGBTransferOETF(c);
      #endif
      return c.rgb;
    }
    void main(){
      vec2 dc = vUv - 0.5;
      vec3 col = toneMapped(vUv);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = (col - 0.5) * uContrast + 0.5;
      col = col * uGain + uLift * (1.0 - col);
      float vig = smoothstep(0.95, 0.2, length(dc * vec2(uRes.x / uRes.y, 1.0) * 0.82));
      col *= mix(1.0, vig, uVignette);
      gl_FragColor = vec4(clamp(col + dither(), 0.0, 1.0), 1.0);
    }`,
};

// The last pass where the GPU multisamples: chromatic aberration and tilt-shift blur of the graded picture (with a
// fresh dither where it was blurred: the blur's average needs one before the screen's 8 bits)
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) },
    uCA: { value: 0 }, uTilt: { value: 0 }, uTiltCenter: { value: 0.5 }, uTiltWidth: { value: 0.18 },
  },
  vertexShader: QUAD_VS,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse; uniform vec2 uRes;
    uniform float uCA, uTilt, uTiltCenter, uTiltWidth;
    varying vec2 vUv;
    ${DITHER}
    float blurAt(vec2 uv){ return uTilt * smoothstep(uTiltWidth, uTiltWidth + 0.38, abs(uv.y - uTiltCenter)); }
    vec3 tap(vec2 uv){
      float blur = blurAt(uv);
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
      if (blurAt(uv) >= 0.02) col += dither();
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

// FXAA runs only where the scene buffer cannot be multisampled (WebGL 1: the iPad). three's port leaves alone every
// pixel whose neighbours all differ from it by less than its threshold, 0.2 of the full range, so an edge between two
// similar surfaces kept its stair-steps: a white fox's jaw over its chest, a misty ridge against a grey sky, a giant
// in haze. At 0.06 those edges are smoothed too. Textures stay as sharp (it follows long edges, not texture grain),
// and the flicker probe measured less flicker in 10 of 12 world/hour views (none above 0.7 per mille).
// Where it runs, FXAA is the last pass, so the chromatic aberration is folded into it: red and blue are each smoothed
// at their own shifted spot, which is FXAA first and the aberration after, as the two passes used to do. (Shifting
// before FXAA fringed leaves with bright purple and orange pixels; leaving it out let edges near the corners flicker
// more: its sub-pixel shifts soften them, reef 0.70 -> 0.93 per mille without it.)
const FXAA_MAIN = /* glsl */`
  uniform float uCA;
  void main() {
    const float q = .06;
    vec4 g = FxaaPixelShader(vUv, tDiffuse, resolution, q, 1. / q);
    if (uCA > 0.0) {
      vec2 dc = vUv - 0.5;
      g.r = FxaaPixelShader(vUv + dc * uCA, tDiffuse, resolution, q, 1. / q).r;
      g.b = FxaaPixelShader(vUv - dc * uCA, tDiffuse, resolution, q, 1. / q).b;
    }
    gl_FragColor = vec4(g.rgb, 1.0);
  }`;
const FXAA_SHADER = { ...FXAAShader, uniforms: { ...FXAAShader.uniforms, uCA: { value: 0 } }, fragmentShader: FXAAShader.fragmentShader.replace(/void main\(\) \{[\s\S]*$/, FXAA_MAIN) };
if (!FXAA_SHADER.fragmentShader.includes('uniform float uCA;') || !FXAAShader.fragmentShader.includes('const float edgeDetectionQuality = .2;')) console.warn('[post] FXAA not patched');

class PostChain {
  constructor(samples, w, h) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera();
    this.target = new THREE.WebGLRenderTarget(w, h, { type: HDR_TYPE, samples });   // the world, in HDR
    this.target.texture.name = 'scene';
    this.ldr = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false });          // graded, 8 bits
    this.ldr.texture.name = 'graded';
    this.bloom = new Bloom(new THREE.Vector2(w, h), 0.3, 0.6, 0.85);
    this.bloomOn = false;
    const mat = sh => new THREE.RawShaderMaterial({ uniforms: THREE.UniformsUtils.clone(sh.uniforms), vertexShader: sh.vertexShader, fragmentShader: sh.fragmentShader, depthTest: false, depthWrite: false });
    this.output = mat(OutputShader);
    this.final = mat(FinalShader);
    // FXAA only where the GPU cannot multisample the HDR buffer
    this.fxaa = samples === 0 ? new THREE.ShaderMaterial({ uniforms: THREE.UniformsUtils.clone(FXAA_SHADER.uniforms), vertexShader: FXAA_SHADER.vertexShader, fragmentShader: FXAA_SHADER.fragmentShader, depthTest: false, depthWrite: false }) : null;
    this.quad = new FullScreenQuad(this.output);
    this.tm = this.cs = null;
    this.setSize(w, h);
  }
  setSize(w, h) {
    this.target.setSize(w, h);
    this.ldr.setSize(w, h);
    this.bloom.setSize(w, h);
    this.output.uniforms.uRes.value.set(w, h);
    this.final.uniforms.uRes.value.set(w, h);
    if (this.fxaa) this.fxaa.uniforms.resolution.value.set(1 / w, 1 / h);
  }
  render() {
    const r = renderer;
    r.setRenderTarget(this.target);
    r.clear();
    r.render(this.scene, this.camera);
    const ou = this.output.uniforms;
    if (this.bloomOn) { ou.tBloom.value = this.bloom.renderFrom(r, this.target.texture); ou.uBloom.value = 1; } else ou.uBloom.value = 0;
    // tone mapping and colour space as three's OutputPass sets them up
    if (this.tm !== r.toneMapping || this.cs !== r.outputColorSpace) {
      this.tm = r.toneMapping; this.cs = r.outputColorSpace;
      const d = {};
      if (THREE.ColorManagement.getTransfer(this.cs) === THREE.SRGBTransfer) d.SRGB_TRANSFER = '';
      const k = { [THREE.LinearToneMapping]: 'LINEAR', [THREE.ReinhardToneMapping]: 'REINHARD', [THREE.CineonToneMapping]: 'CINEON', [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC', [THREE.AgXToneMapping]: 'AGX' }[this.tm];
      if (k) d[k + '_TONE_MAPPING'] = '';
      this.output.defines = d;
      this.output.needsUpdate = true;
    }
    ou.tScene.value = this.target.texture;
    ou.toneMappingExposure.value = r.toneMappingExposure;
    this.quad.material = this.output;
    r.setRenderTarget(this.ldr);
    this.quad.render(r);
    const fin = this.fxaa || this.final;
    fin.uniforms.tDiffuse.value = this.ldr.texture;
    this.quad.material = fin;
    r.setRenderTarget(null);
    this.quad.render(r);
  }
  dispose() {
    this.target.dispose(); this.ldr.dispose(); this.bloom.dispose();
    this.output.dispose(); this.final.dispose(); if (this.fxaa) this.fxaa.dispose();
    this.quad.dispose();
  }
}
// (composer: the chain; scenePass: the same object, for the world's buffer, scene and camera)
let composer, scenePass;
function buildComposer() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  if (composer) composer.dispose();
  composer = scenePass = new PostChain(Math.min(Q.samples, MAX_SAMPLES), size.x, size.y);
  if (current) { scenePass.scene = current.inst.scene; scenePass.camera = current.inst.camera; }
  post.snap = true;
}

/* Dynamic resolution. Frame times are judged against the display's own refresh interval (so 30 Hz
   screens, 75 Hz monitors and phones in low-power mode are not mistaken for slow GPUs). It steps down
   quickly when frames are late — slow on average, or ragged (a picture that keeps missing refreshes
   stutters even when the average looks fine) — and creeps back up only after a long comfortable stretch,
   backing off when a step up does not hold, so the picture settles instead of pumping between sharp and
   soft. Above the tier's pixel budget there is one sharper step, tried only after a long smooth stretch
   (never past the screen's own pixels). Past the smallest picture there is one more step, an even 30 fps,
   which looks smoother than a ragged 40. Each world remembers its own level per detail tier and starts
   there next time. */
const DYN_STEPS = [1.15, 1, 0.87, 0.76, 0.66, 0.57, 0.5];
const DYN_START = 1; // the tier's own budget
const DYN_CAP = DYN_STEPS.length; // the extra last step: smallest picture at 30 fps
const dyn = { i: DYN_START, ema: 0, late: 0, slow: 0, fast: 0, settleUntil: 0, vsync: Infinity, lastUpAt: -1e9, upBlockedUntil: 0, backoff: 300e3 };
const dynScale = () => DYN_STEPS[Math.min(dyn.i, DYN_STEPS.length - 1)];
const dynCapped = () => dyn.i >= DYN_CAP;
const dynKey = id => `qijing-r2-${qName}-${id}`;
function dynRestore(id) {
  let i = DYN_START;
  try { const v = parseInt(localStorage.getItem(dynKey(id)), 10); if (v >= 0 && v <= DYN_CAP) i = v; } catch (e) {}
  dyn.i = i; // a sharper step is tried later, once frames have been comfortable for a while
  dyn.ema = dyn.late = 0; dyn.slow = dyn.fast = 0; dyn.lastUpAt = -1e9;
  dyn.settleUntil = performance.now() + 3000;
  needsResize = true;
}
// Every rAF tick, rendered or not, tracks the display refresh: dyn.vsync follows the shortest interval
// (fast down, very slow drift up); pace.v averages whole refresh intervals (dropped frames count as 2, 3…
// intervals), which is precise enough to pace the animation by.
const pace = { v: 0, n: 0, carry: 0, e30: 0, e75: 0, slowRun: 0, slowMin: Infinity };
function dynTick(rawMs) {
  if (!(rawMs > 3 && rawMs < 120)) return;
  dyn.vsync = Math.min(rawMs, dyn.vsync + 0.0005);
  const k = pace.v ? Math.max(1, Math.round(rawMs / pace.v)) : 1;
  const per = rawMs / k;
  if (!pace.v || per < pace.v * 0.7) { pace.v = per; pace.n = 0; } // first tick, or a faster screen than we thought
  else if (k <= 4 && Math.abs(per - pace.v) < pace.v * 0.12) { pace.v += (per - pace.v) * 0.02; pace.n++; }
  // a screen that has slowed its refresh (a phone in low-power mode runs pages at 30 Hz): after 30 s
  // without a single interval near the old one, take the new cadence instead of shrinking the picture
  if (rawMs > pace.v * 1.6) {
    pace.slowRun += rawMs; pace.slowMin = Math.min(pace.slowMin, rawMs);
    if (pace.slowRun > 30e3) { pace.v = pace.slowMin; pace.n = 0; pace.slowRun = 0; pace.slowMin = Infinity; }
  } else { pace.slowRun = 0; pace.slowMin = Infinity; }
}
const refreshMs = () => pace.n > 20 ? pace.v : isFinite(dyn.vsync) ? clamp(dyn.vsync, 4, 70) : 1000 / 60;
// rendered frames per refresh: 30 fps when throttled; at most ~75 fps on fast (> 90 Hz) screens. The
// choice is sticky: on a 75 Hz screen 30 fps is 2.5 refreshes, and flipping between 2 and 3 would judder.
function frameEvery(throttled) {
  const v = refreshMs(), r = throttled ? 1000 / 30 / v : v < 11 ? 1000 / 75 / v : 1, key = throttled ? 'e30' : 'e75';
  let e = pace[key] || Math.max(1, Math.round(r));
  if (Math.abs(r - e) > 0.6) e = Math.max(1, Math.round(r));
  return (pace[key] = e);
}
function dynSample(frameMs, now, throttled) {
  if (TEST || now < dyn.settleUntil || frameMs > 250 || !isFinite(dyn.vsync)) return;
  dyn.ema = dyn.ema ? dyn.ema * 0.9 + frameMs * 0.1 : frameMs;
  const vs = refreshMs();
  // the frame cadence we expect when the GPU keeps up (every refresh, every other refresh at 30 fps…).
  // Awake we accept down to ~43 fps on average, but not a picture that keeps missing refreshes.
  const expect = vs * frameEvery(throttled);
  dyn.late = dyn.late * 0.95 + (frameMs > expect + vs * 0.5 ? 0.05 : 0);
  const budget = throttled ? expect * 1.3 : Math.max(23, expect * 1.3);
  const roomy = expect * 1.04;
  dyn.slow = dyn.ema > budget || dyn.late > 0.08 ? dyn.slow + frameMs : 0;
  dyn.fast = dyn.ema < roomy && dyn.late < 0.015 ? dyn.fast + frameMs : 0;
  let next = dyn.i;
  // the 30 fps step is only taken from an un-throttled picture (screensaver 30 fps is already there)
  const lowest = throttled ? Math.max(dyn.i, DYN_STEPS.length - 1) : DYN_CAP;
  if (dyn.slow > (throttled ? 2500 : 1500) && dyn.i < lowest) {
    next = dyn.i + 1;
    if (now - dyn.lastUpAt < 30e3) { dyn.upBlockedUntil = now + dyn.backoff; dyn.backoff = Math.min(dyn.backoff * 2, 3600e3); }
  } else if (dyn.fast > 20e3 && dyn.i > 0 && now > dyn.upBlockedUntil) {
    next = dyn.i - 1;
    dyn.lastUpAt = now;
  }
  if (next !== dyn.i) {
    dyn.i = next; dyn.slow = dyn.fast = 0; dyn.ema = dyn.late = 0; dyn.settleUntil = now + 1500;
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
  pr = Math.max(0.35, Math.min(pr * dynScale(), Math.max(pr, window.devicePixelRatio || 1)));
  const key = `${w}x${h}@${pr.toFixed(3)}`;
  if (!force && key === lastSize) return;
  lastSize = key;
  view.w = w; view.h = h;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  composer.setSize(size.x, size.y);
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

  const bloom = composer.bloom;
  bloom.strength = post.strength;
  bloom.radius = post.radius;
  bloom.threshold = post.threshold;
  composer.bloomOn = CAN_HALF && post.strength > 0.001; // bloom's own buffers need half-float support
  renderer.toneMappingExposure = post.exposure;
  const tm = p.toneMapping === 'agx' ? THREE.AgXToneMapping : p.toneMapping === 'linear' ? THREE.LinearToneMapping : THREE.ACESFilmicToneMapping;
  if (renderer.toneMapping !== tm) renderer.toneMapping = tm;
  const u = composer.output.uniforms;
  u.uVignette.value = post.vignette;
  u.uSat.value = post.sat;
  u.uContrast.value = post.contrast;
  u.uLift.value.set(post.lift[0], post.lift[1], post.lift[2]);
  u.uGain.value.set(post.gain[0], post.gain[1], post.gain[2]);
  // chromatic aberration in whichever pass comes last (FXAA's, or the final one); tilt-shift only in the final one
  // (it is off on the iPad's tier anyway)
  if (composer.fxaa) composer.fxaa.uniforms.uCA.value = post.ca;
  const f = composer.final.uniforms;
  f.uCA.value = post.ca;
  f.uTilt.value = post.tilt;
  f.uTiltCenter.value = tilt.center ?? 0.5;
  f.uTiltWidth.value = tilt.width ?? 0.18;
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
/* Cut-out leaves, petals and plumes are painted on a cleared canvas, so their transparent texels are black.
   Texture filtering and mipmaps mix that black into the visible edge and draw a dark outline round every
   leaf (worst without MSAA, as on the iPad). Once per texture, before its first upload, the colour of the
   nearest painted texels is spread into the transparent ones; alpha is untouched. A canvas cannot keep the
   colour of a fully transparent pixel (it stores premultiplied colour), so the result is uploaded from an
   ImageData, resized to a power of two first where WebGL 1 needs one for mipmaps or tiling. */
const bledImages = new WeakMap();
const bleedStats = { textures: 0, ms: 0 };
function bleedRGBA(d, w, h) {
  const n = w * h, state = new Uint8Array(n), queue = new Int32Array(n);
  let empties = 0, qt = 0;
  for (let i = 0; i < n; i++) if (d[i * 4 + 3] >= 128) state[i] = 1; else empties++;
  if (!empties || empties === n) return false;
  for (let i = 0; i < n; i++) {
    if (state[i]) continue;
    const x = i % w, y = (i - x) / w;
    let touch = false;
    for (let dy = -1; dy <= 1 && !touch; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < w && state[yy * w + xx] === 1) { touch = true; break; } }
    }
    if (touch) { state[i] = 2; queue[qt++] = i; }
  }
  for (let qh = 0; qh < qt; qh++) {
    const i = queue[qh], x = i % w, y = (i - x) / w;
    let r = 0, g = 0, b = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx; if (xx < 0 || xx >= w) continue;
        const j = yy * w + xx;
        if (state[j] === 1) { r += d[j * 4]; g += d[j * 4 + 1]; b += d[j * 4 + 2]; c++; }
        else if (state[j] === 0) { state[j] = 2; queue[qt++] = j; }
      }
    }
    if (c) { d[i * 4] = r / c; d[i * 4 + 1] = g / c; d[i * 4 + 2] = b / c; }
    state[i] = 1;
  }
  return true;
}
const isPow2 = v => (v & (v - 1)) === 0;
function bleedTexture(tex) {
  const img = tex.image;
  if (!img || tex.isCompressedTexture || tex.isVideoTexture || tex.isCubeTexture || tex.isDataTexture || tex.isData3DTexture || tex.isDataArrayTexture) return;
  if (bledImages.has(img)) { const out = bledImages.get(img); if (out && tex.image !== out) { tex.image = out; tex.needsUpdate = true; } return; }
  bledImages.set(img, null);
  const ok = (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) || (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) || (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap);
  let w = img.width, h = img.height;
  if (!ok || !w || !h || w * h > 4.2e6) return;
  const t0 = performance.now();
  // WebGL 1 can only mipmap or tile power-of-two textures (three.js would otherwise resize it itself)
  const needsPOT = !IS_WEBGL2 && (tex.wrapS !== THREE.ClampToEdgeWrapping || tex.wrapT !== THREE.ClampToEdgeWrapping || (tex.minFilter !== THREE.NearestFilter && tex.minFilter !== THREE.LinearFilter));
  if (needsPOT && !(isPow2(w) && isPow2(h))) { w = THREE.MathUtils.floorPowerOfTwo(w); h = THREE.MathUtils.floorPowerOfTwo(h); }
  let data;
  try {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(img, 0, 0, w, h);
    data = g.getImageData(0, 0, w, h);
  } catch (e) { return; } // e.g. a cross-origin image
  if (!bleedRGBA(data.data, w, h)) return;
  bledImages.set(img, data);
  tex.image = data;
  tex.needsUpdate = true;
  bleedStats.textures++; bleedStats.ms += performance.now() - t0;
}
function bleedCutouts(root) {
  root.traverse(o => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      // solid cut-outs only (leaves, petals, fronds: alpha test 0.4 and up). Soft, feathery cut-outs (pampas
      // plumes, fins, small petals, alpha test below 0.4) look right darkened at their wispy edges, and
      // brightening those makes them shimmer as they sway. Blended textures may be live canvases.
      if (m && m.map && m.alphaTest >= 0.4) bleedTexture(m.map);
    }
  });
}

/* WebGL 1 (iPad) mipmaps for colour textures. three r160 uploads an sRGB texture under WebGL 1 through
   EXT_sRGB, which cannot build mipmaps, so it switches them off: every leaf, petal, grass and ground texture
   then breaks into sparkling pixel noise as it shrinks with distance (on the iPad's path the meadow flickered
   ten times as much as on WebGL 2). Colour maps of the stock materials are uploaded as plain textures
   instead, with mipmaps, and decoded from sRGB in the shader by three's own inline decode. A texture is
   converted only when every use of it is such a colour map, in a shader that still samples it the stock way;
   anything a world samples itself keeps the browser's sRGB decode. */
const gl1MipStats = { converted: 0, kept: 0 };
function gl1ColorMipmaps(root) {
  if (IS_WEBGL2 || !root || !renderer.extensions.has('EXT_sRGB')) return;
  const uses = new Map();
  const note = (tex, ok, m) => {
    if (!tex || !tex.isTexture) return;
    let u = uses.get(tex);
    if (!u) uses.set(tex, u = { ok: true, mats: new Set() });
    if (!ok) u.ok = false; else if (m) u.mats.add(m);
  };
  const stock = new Map();
  // does the material still sample its map through three's chunk? (dry-run its shader patches)
  const stockMap = m => {
    if (stock.has(m)) return stock.get(m);
    let ok = true;
    if (m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile) {
      const sh = { vertexShader: '', fragmentShader: '#include <map_fragment>', uniforms: {}, defines: {} };
      const had = Object.prototype.hasOwnProperty.call(m.userData, 'shader'), prev = m.userData.shader;
      try {
        m.onBeforeCompile(sh, renderer);
        ok = sh.fragmentShader.includes('#include <map_fragment>');
        for (const k in sh.uniforms) { const v = sh.uniforms[k] && sh.uniforms[k].value; if (v && v.isTexture) note(v, false); }
      } catch (e) { ok = false; }
      if (had) m.userData.shader = prev; else delete m.userData.shader;
    }
    stock.set(m, ok);
    return ok;
  };
  const OTHER = ['emissiveMap', 'specularColorMap', 'sheenColorMap', 'specularIntensityMap', 'alphaMap', 'lightMap', 'aoMap', 'bumpMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'displacementMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'sheenRoughnessMap', 'anisotropyMap', 'envMap', 'gradientMap', 'matcap'];
  root.traverse(o => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      if (m.isShaderMaterial) { for (const k in m.uniforms) { const v = m.uniforms[k] && m.uniforms[k].value; if (v && v.isTexture) note(v, false); } continue; }
      for (const k of OTHER) if (m[k]) note(m[k], false);
      if (m.map) note(m.map, stockMap(m) && !m.map.isVideoTexture && !m.map.isCompressedTexture && !m.map.isRenderTargetTexture && !m.map.isDataTexture, m);
    }
  });
  if (root.background && root.background.isTexture) note(root.background, false);
  if (root.environment && root.environment.isTexture) note(root.environment, false);
  for (const [tex, u] of uses) {
    if (tex.colorSpace !== THREE.SRGBColorSpace || !u.mats.size) continue;
    if (!u.ok) { gl1MipStats.kept++; continue; }
    tex.colorSpace = THREE.NoColorSpace;
    // an earlier upload through EXT_sRGB may already have switched this texture's mipmaps off
    if (tex.format === THREE._SRGBAFormat) { tex.format = THREE.RGBAFormat; tex.generateMipmaps = true; if (tex.minFilter === THREE.LinearFilter) tex.minFilter = THREE.LinearMipmapLinearFilter; }
    tex.needsUpdate = true;
    for (const m of u.mats) { if (!m.defines || !('DECODE_VIDEO_TEXTURE' in m.defines)) { m.defines = Object.assign({}, m.defines, { DECODE_VIDEO_TEXTURE: '' }); m.needsUpdate = true; } }
    gl1MipStats.converted++;
  }
}

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

/* WebGL 1 (Safari 14 / iOS 14): GLSL ES 1.0 only has screen-space derivatives (fwidth, dFdx — used by
   the anti-aliasing tricks in every world) behind an extension, which three.js turns on per material. */
function gl1Material(m, o) {
  if (!m.userData.gl1) {
    m.userData.gl1 = true;
    if (!(m.extensions && m.extensions.derivatives)) {
      m.extensions = Object.assign({}, m.extensions || {}, { derivatives: true });
      m.needsUpdate = true;
    }
  }
  if (o.isSkinnedMesh && o.skeleton && !m.userData.gl1skin) webgl1Skinning(m, o.skeleton);
}
function webgl1Materials(root) {
  if (IS_WEBGL2 || !root) return;
  root.traverse(o => {
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) gl1Material(m, o);
  });
}
// Objects and materials a world makes later (food, effects) get the same treatment just before their
// first draw, so they compile once, correctly, instead of failing and being fixed up afterwards.
if (!IS_WEBGL2) {
  THREE.Object3D.prototype.onBeforeRender = function (r, scene, camera, geometry, m) {
    if (m && (!m.userData.gl1 || (this.isSkinnedMesh && !m.userData.gl1skin))) gl1Material(m, this);
  };
}
// three.js r160 reads bones with texelFetch/textureSize (WebGL 2 only). For WebGL 1, read the same bone
// texture (4 RGBA texels per matrix, size × size) with texture2D at texel centres.
function webgl1Skinning(m, skeleton) {
  if (!skeleton.boneTexture) skeleton.computeBoneTexture();
  const size = skeleton.boneTexture.image.width;
  m.userData.gl1skin = size;
  const prevCompile = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey
    ? () => prevCompile.toString() : m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = function (sh, r) {
    prevCompile.call(this, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <skinning_pars_vertex>', `
      #ifdef USE_SKINNING
        uniform mat4 bindMatrix;
        uniform mat4 bindMatrixInverse;
        uniform highp sampler2D boneTexture;
        mat4 getBoneMatrix( const in float i ) {
          float size = ${size.toFixed(1)};
          float j = i * 4.0;
          float x = mod( j, size );
          float v = ( floor( j / size ) + 0.5 ) / size;
          vec4 v1 = texture2D( boneTexture, vec2( ( x + 0.5 ) / size, v ) );
          vec4 v2 = texture2D( boneTexture, vec2( ( x + 1.5 ) / size, v ) );
          vec4 v3 = texture2D( boneTexture, vec2( ( x + 2.5 ) / size, v ) );
          vec4 v4 = texture2D( boneTexture, vec2( ( x + 3.5 ) / size, v ) );
          return mat4( v1, v2, v3, v4 );
        }
      #endif`);
  };
  m.customProgramCacheKey = () => prevKey() + '|gl1skin' + size;
  m.needsUpdate = true;
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
const rig = { target: new THREE.Vector3(), yaw: 0, pitch: 0.3, dist: 10, yawT: 0, pitchT: 0.3, distT: 10, view: null, idlePhase: 0, wasIdle: false, bobW: 0, focus: null, before: null };
function vec3(v, fallback = [0, 0, 0]) { if (!v) v = fallback; return v.isVector3 ? v : new THREE.Vector3(v[0], v[1], v[2]); }
function configureRig(view) {
  rig.view = view || {};
  const v = rig.view;
  rig.target.copy(vec3(v.target));
  rig.yaw = rig.yawT = v.yaw ?? 0;
  rig.pitch = rig.pitchT = v.pitch ?? 0.3;
  rig.dist = rig.distT = v.dist ?? 10;
  rig.idlePhase = 0;
  rig.focus = rig.before = null;
  if (current && v.fov) { current.inst.camera.fov = v.fov; current.inst.camera.updateProjectionMatrix(); }
}
/* While a guardian talks (lib/guide.js) the camera is lent to it: { target, yaw, pitch, dist }, the target following
   the animal. The view can still be turned and zoomed a little; afterwards it goes back to where it was. */
function focusRig(f) {
  if (f) {
    if (!rig.focus) rig.before = { yaw: rig.yawT, pitch: rig.pitchT, dist: rig.distT };
    rig.focus = f;
    rig.yawT = f.yaw; rig.pitchT = f.pitch; rig.distT = f.dist;
  } else if (rig.focus) {
    rig.focus = null;
    const b = rig.before;
    if (b) { rig.yawT = b.yaw; rig.pitchT = b.pitch; rig.distT = b.dist; }
    rig.before = null;
  }
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
  const F = rig.focus;
  if (v.yawRange) rig.yawT = clamp(rig.yawT, v.yawRange[0], v.yawRange[1]);
  if (v.pitchRange) rig.pitchT = clamp(rig.pitchT, F ? Math.min(0.12, v.pitchRange[0]) : v.pitchRange[0], v.pitchRange[1]);
  if (F) rig.distT = clamp(rig.distT, F.dist * 0.7, F.dist * 2.2);
  else if (v.distRange) rig.distT = clamp(rig.distT, v.distRange[0], v.distRange[1]);
  rig.yaw = damp(rig.yaw, rig.yawT, 3.5, dt);
  rig.pitch = damp(rig.pitch, rig.pitchT, 3.5, dt);
  rig.dist = damp(rig.dist, rig.distT, 3, dt);
  const tgt = F ? F.target : vec3(v.target);
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
// The clock the worlds see: real time, continuous to the millisecond, so the sun, the sky and the light of dawn
// and dusk move a little every frame, as real light does. (It used to move in whole minutes, each glided over
// ~2 s: every minute's change of light then arrived as a 2-3 s pulse through dawn and dusk, lanterns brightening
// by a notch and long golden-hour shadows sliding by up to a metre.) A small jump of the clock (set by the
// network, a short sleep) still glides over ~2 s; a big one cuts straight to the new time.
const clock = { shown: null };
function targetHours() {
  if (save.timeMode === 'manual') return save.manualHour;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + (d.getSeconds() + d.getMilliseconds() / 1000) / 3600;
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
  guide.leaveWorld();
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
    webgl1Materials(inst.scene);
    smoothCutouts(inst.scene);
    bleedCutouts(inst.scene);
    scenePass.scene = inst.scene;
    scenePass.camera = inst.camera;
    dynRestore(meta.id);
    resize(true);
    configureRig(inst.view);
    updateRig(0, 0);
    post.snap = true;
    // one step before compiling: worlds set their environment map, lights and time of day in update(),
    // and programs compiled before that would all be rebuilt on the first frame (hidden objects only
    // when they first appear, mid-play: a visible stall on Safari 14, which compiles synchronously)
    // (tests can start the world clock as if the page had been open for days: TEST.t0 seconds)
    elapsed = ((TEST && TEST.t0) || 0) + 1 / 60;
    inst.update(1 / 60, elapsed);
    updateRig(1 / 60, elapsed);
    gl1ColorMipmaps(inst.scene);
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
    loading = false;
    try { guide.worldReady(); } catch (e) { console.error('[guide]', e); }
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
  if (!hover || idle || !current || guide.open) { if (!tag.hidden) tag.hidden = true; return; }
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
    } else if (c.guardian && guide.who(c.guardian)) {
      const g = guide.who(c.guardian);
      tag.innerHTML = `<span class="nm">${g.name}</span><span class="kd">${g.title}</span><div class="ln">点一下，跟它学东西</div>`;
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
  if (p && press && press.moved <= 6 && performance.now() - press.t < 700 && !guide.tap(e.clientX, e.clientY)) feedAt(e.clientX, e.clientY);
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

/** A resident given for a finished lesson (lib/guide.js): this kind, this name if it is free, coming in at `at` (a
 *  point in the world, or anywhere). Nothing when the world is full. */
function grantResident(kind, name, at) {
  if (!current) return null;
  const def = current.def, ms = current.env.members;
  if (!def.kinds || !def.kinds[kind] || ms.length >= (def.maxMembers || 16)) return null;
  const m = makeMember(def, kind, makeRng(randomSeed()), ms.map(x => x.name));
  if (name && !ms.some(x => x.name === name)) m.name = name;
  m.lastAte = Date.now(); // fed: it shows itself instead of begging at the shore
  ms.push(m);
  dirty = true;
  current.inst.addMember?.(m, at || undefined);
  updateStatus();
  return m;
}

window.addEventListener('keydown', e => {
  wake();
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  if (guide.key(e)) return;
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
  renderSchoolRow();
  $('schoolMsg').hidden = true;
  $('schoolConfirm').hidden = true;
  $('seedText').textContent = '#' + (save.seed >>> 0).toString(16).toUpperCase().padStart(8, '0').replace(/(.{4})/, '$1-');
  seg('segTime', save.timeMode, v => { save.timeMode = v; dirty = true; $('manualTime').hidden = v !== 'manual'; });
  $('manualTime').hidden = save.timeMode !== 'manual';
  $('hourRange').value = save.manualHour;
  $('hourText').textContent = fmtHour(save.manualHour);
  seg('segQuality', save.quality, v => { save.quality = v; dirty = true; setQuality(effectiveQuality()); updateQualityHint(); });
  updateQualityHint();
  seg('segRotate', save.rotate, v => { save.rotate = +v; dirty = true; });
  seg('segPower', save.idle30 ? 1 : 0, v => { save.idle30 = v === '1'; dirty = true; });
  seg('segClock', save.showClock ? 1 : 0, v => { save.showClock = v === '1'; dirty = true; document.body.classList.toggle('hide-clock', !save.showClock); });
}
function updateQualityHint() {
  const pct = Math.round(dynScale() * 100);
  $('qualityHint').textContent = `当前：${{ high: '高', medium: '中', low: '低' }[qName]}画质，渲染分辨率 ${pct}%${dynCapped() ? '，每秒 30 帧' : ''}。“自动”会按这台设备的显卡选择画质，并根据流畅度平滑调整分辨率，不会重新加载画面。`;
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
  qName = name; Q = tier(name);
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
/* New versions                                                        */
/* ------------------------------------------------------------------ */
// A screen that stays on for weeks (an iPad on a shelf) should pick up improvements by itself: every
// 15 minutes look at version.json, and when the build changes, reload quietly while the screensaver runs
// (the world and its residents are saved first). Hosts that pin every file to one version simply never
// report a change.
const build = { id: null, pending: false };
async function checkForUpdate() {
  if (TEST) return;
  try {
    const r = await fetch(new URL('./version.json', import.meta.url).href + '?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const id = (await r.json()).build;
    if (!id) return;
    if (build.id === null) build.id = id;
    else if (id !== build.id) build.pending = true;
  } catch (e) {}
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */
let last = performance.now(), elapsed = 0, acc = 0, minuteTimer = 0, lastRenderAt = 0;
function frame(now) {
  requestAnimationFrame(frame);
  school.tick();
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
    if (build.pending && idle && !loading && performance.now() - lastInput > 60e3) {
      build.pending = false;
      persist();
      location.reload();
      return;
    }
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
  const idleNow = !(TEST && TEST.noIdle) && performance.now() - lastInput > 8000 && !$('settings').classList.contains('open') && !guide.open && document.activeElement?.tagName !== 'INPUT';
  if (idleNow !== idle) { idle = idleNow; document.body.classList.toggle('idle', idle); }
  // 30 fps in screensaver mode when chosen in the settings, or on the last resolution step; otherwise
  // every refresh, at most ~75 fps (120/144 Hz screens would run a phone hot rendering twice as many
  // frames as anyone can see). Frames are skipped in whole refresh intervals so the cadence stays even.
  const throttled = ((idle && save.idle30) || dynCapped()) && !TEST;
  acc += rawDt;
  const every = TEST ? 1 : frameEvery(throttled);
  if (every > 1 && acc * 1000 < (every - 0.5) * refreshMs()) return;
  // Frame pacing: the screen shows frames at an exact cadence, but rAF timestamps wobble by a millisecond
  // or two (Safari rounds them to whole milliseconds). Animating by the raw intervals makes everything
  // that moves wobble with them, so each step is snapped to whole refresh intervals; the rounding error
  // is carried and fed back slowly, which keeps the animation clock on real time.
  let dt = acc;
  if (!TEST && pace.n > 20) {
    const v = pace.v / 1000, want = acc + pace.carry;
    const k = Math.max(1, Math.round(acc / v));
    dt = k * v + (want - k * v) * 0.1;
    pace.carry = want - dt;
  }
  if (dt > 0.05) { dt = 0.05; pace.carry = 0; }
  acc = 0;
  if (contextLost) return;
  if (needsResize) { needsResize = false; resize(); }
  // tests that step the world themselves (simulate / diagnose) stop it here, so a result does not depend on how
  // many real frames happened to run in between
  if (TEST && TEST.manualClock) return;
  if (current && !loading) {
    elapsed += dt;
    tickHours(dt);
    try { current.inst.update(dt, elapsed); } catch (e) { console.error(e); window.__idle.error = String(e.stack || e); }
    updateRig(dt, elapsed);
    guide.tick(dt);
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
/* The company's lessons and learning records (a screen registered with the learning backend), and the guardians who
   teach them (or the demo lessons) */
const school = createSchool({
  backend: (TEST && TEST.backend) || BACKEND,
  signOut: (TEST && TEST.signOut) || undefined,
  lastInput: () => lastInput,
  onChange: what => {
    try { guide.onSchool(what); } catch (e) { console.error('[guide]', e); }
    if ($('settings').classList.contains('open')) renderSchoolRow();
  },
});
const guide = createGuide({
  school,
  save: () => save, markDirty: () => { dirty = true; }, persist,
  worlds: WORLDS, world: () => (loading ? null : current), loading: () => loading, enterWorld,
  focus: focusRig, rigYaw: () => rig.yawT, toScreen, pick: pickCreature,
  wake, idle: () => idle, lastInput: () => lastInput,
  toast, sfx: name => audio.sfx(name), hours, grant: grantResident, asset,
});

// Settings → 公司学习: connect this screen with a code, or let it go
function renderSchoolRow() {
  const d = school.device();
  $('schoolOff').hidden = !!d;
  $('schoolOn').hidden = !d;
  if (!d) return;
  $('schoolDev').textContent = `已连接 · ${d.label || '这台设备'}`;
  $('schoolHint').textContent = d.personal
    ? '个人设备：登录一次就一直保持登录（30 天不用才需要重新登录）。课程每 10 分钟更新一次。'
    : '共享设备：员工 3 分钟不操作会自动退出登录。员工名单和课程每 10 分钟更新一次。';
}
async function joinSchool(code) {
  const msg = $('schoolMsg');
  msg.hidden = false; msg.className = 'hint msg'; msg.textContent = '正在连接…';
  $('schoolJoin').disabled = true;
  const r = await school.register(code);
  $('schoolJoin').disabled = false;
  if (r.ok) {
    msg.hidden = true;
    $('schoolCode').value = '';
    renderSchoolRow();
    toast(`已连上公司学习 · ${r.device.label || '这台设备'}`);
    return;
  }
  msg.className = 'hint msg err';
  msg.textContent = r.error === 'code' ? '登记码不对，或者已经用过、过期了。请向管理员要一个新的。'
    : r.error === 'busy' ? '尝试次数太多，请 10 分钟后再试。'
    : r.error === 'net' ? '连不上网络，请检查网络后再试。' : '暂时连不上，请稍后再试。';
}
$('schoolJoin').addEventListener('click', () => joinSchool($('schoolCode').value));
$('schoolCode').addEventListener('keydown', e => { if (e.key === 'Enter') joinSchool($('schoolCode').value); });
$('schoolForget').addEventListener('click', () => {
  const n = school.pending;
  $('schoolConfirmText').textContent = n
    ? `断开后，这台设备回到示范课。还有 ${n} 条学习记录没送出，会先试着送出；没有网络的话，这些记录会丢失。`
    : '断开后，这台设备回到示范课。员工的学习记录都在公司后台，不会丢失；要再连上，需要管理员给一个新的登记码。';
  $('schoolConfirm').hidden = false;
});
$('schoolForgetNo').addEventListener('click', () => { $('schoolConfirm').hidden = true; });
$('schoolForgetYes').addEventListener('click', async () => {
  $('schoolConfirm').hidden = true;
  await school.forget();
  renderSchoolRow();
  toast('已断开公司学习，现在显示示范课');
});
// A link ending in #join=XXXX-XXXX (a team code an admin shared with the staff) connects this screen once; the code
// leaves the address so a reload does not use it again.
(function joinFromLink() {
  const m = /(?:^#|&)join=([0-9A-Za-z-]{8,12})/.exec(location.hash || '');
  if (!m) return;
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  const later = text => { const t = setInterval(() => { if ($('veil').classList.contains('clear')) { clearInterval(t); toast(text); } }, 400); };
  if (school.registered) { later('这台设备已经连上公司学习了'); return; }
  school.register(m[1]).then(r => later(r.ok ? `已连上公司学习 · ${r.device.label || '这台设备'}`
    : r.error === 'net' ? '连不上网络，没能连上公司学习，请稍后再打开这个链接' : '这个链接里的码已经用完或过期了，请向管理员要一个新的'));
})();

window.__idle = {
  ready: null, sceneId: null, error: null,
  enterWorld, feedAt, feedHandful, addResident,
  setHours: h => { save.timeMode = 'manual'; save.manualHour = h; clock.shown = h; },
  /** Advance the simulation without rendering (test harness). */
  simulate(seconds, step = 1 / 30) {
    if (!current) return;
    // a whole number of steps: adding up the step drifted, so 4 s at 1/60 could take 241 steps, and runs at two time
    // steps ended a step apart
    const n = seconds > 0 ? Math.max(1, Math.round(seconds / step)) : 0;
    for (let k = 0; k < n; k++) { elapsed += step; current.inst.update(step, elapsed); updateRig(step, elapsed); applyPost(current.inst.post || {}, step); }
  },
  setView(v) { Object.assign(rig, v); if (v.yaw !== undefined) rig.yawT = v.yaw; if (v.pitch !== undefined) rig.pitchT = v.pitch; if (v.dist !== undefined) rig.distT = v.dist; },
  /** Render one frame of the current state (tests that stop the page's own loop, manualClock, render with this). */
  renderNow() { if (current) composer.render(1 / 60); },
  /** One frame exactly as the page's own loop runs it, the clock of day included (tests that stop the loop and step
   *  real time themselves, e.g. with a stand-in Date). */
  frame(dt = 1 / 60, render = true) {
    if (!current) return;
    elapsed += dt;
    tickHours(dt);
    current.inst.update(dt, elapsed);
    updateRig(dt, elapsed);
    guide.tick(dt);
    applyPost(current.inst.post || {}, dt);
    if (render) composer.render(dt);
  },
  /** The clock of day the worlds see right now (hours). */
  shownHours: () => hours(),
  /** The post-processing chain (tests that look at its buffers). */
  get post() { return composer; },
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
  /** the guardians' lessons (tools/qa/lesson.cjs) */
  guide: guide.test,
  /** the company connection (tools/qa/school.cjs) */
  school: Object.assign({ api: school }, school.test),
  bleedStats, gl1MipStats,
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
checkForUpdate();
setInterval(checkForUpdate, 15 * 60e3);
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
