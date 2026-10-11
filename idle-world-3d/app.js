// 栖境 — app shell: renderer, post-processing, camera rig, feeding input, residents,
// per-computer save data, idle/screensaver mode, ambience and the HUD.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { makeRng, hashString, sunState, disposeObject, clamp, lerp, damp, TAU } from './lib/util.js';
import { Ambience } from './lib/audio.js';

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
  if (!Array.isArray(w.members)) {
    const rng = makeRng(hashString(save.seed + ':' + id + ':members'));
    w.members = [];
    for (const kind of def.starter || []) w.members.push(makeMember(def, kind, rng, w.members.map(m => m.name)));
    dirty = true;
  }
  // drop residents of kinds this scene no longer knows
  w.members = w.members.filter(m => def.kinds && def.kinds[m.kind]);
  return w.members;
}
const fullness = m => clamp(1 - (Date.now() - (m.lastAte || 0)) / (4 * 3600e3), 0, 1);

/* ------------------------------------------------------------------ */
/* Renderer + post                                                     */
/* ------------------------------------------------------------------ */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const pmrem = new THREE.PMREMGenerator(renderer);

const QUALITY = {
  high: { pr: 2, maxPixels: 3.8e6, samples: 4, shadows: true, q: 1 },
  medium: { pr: 1.25, maxPixels: 2.2e6, samples: 2, shadows: true, q: 0.7 },
  low: { pr: 0.85, maxPixels: 1.2e6, samples: 0, shadows: false, q: 0.45 },
};
function effectiveQuality() {
  if (save.quality !== 'auto') return save.quality;
  if (save.autoQuality) return save.autoQuality;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  return mobile ? 'medium' : 'high';
}
let qName = effectiveQuality();
let Q = QUALITY[qName];

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 },
    uVignette: { value: 0.35 }, uGrain: { value: 0.03 }, uSat: { value: 1.04 }, uContrast: { value: 1.02 },
    uLift: { value: new THREE.Vector3(0, 0, 0) }, uGain: { value: new THREE.Vector3(1, 1, 1) },
    uCA: { value: 0 }, uTilt: { value: 0 }, uTiltCenter: { value: 0.5 }, uTiltWidth: { value: 0.18 },
  },
  vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime;
    uniform float uVignette, uGrain, uSat, uContrast, uCA, uTilt, uTiltCenter, uTiltWidth;
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
      float n = fract(sin(dot(uv * uRes + fract(uTime) * 91.7, vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }`,
};

let composer, renderPass, bloomPass, outputPass, finalPass;
function buildComposer() {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q.samples });
  composer?.dispose?.();
  composer = new EffectComposer(renderer, rt);
  renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.6, 0.85);
  outputPass = new OutputPass();
  finalPass = new ShaderPass(FinalShader);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  composer.addPass(outputPass);
  composer.addPass(finalPass);
  if (current) { renderPass.scene = current.inst.scene; renderPass.camera = current.inst.camera; }
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  let pr = Math.min(window.devicePixelRatio || 1, Q.pr);
  if (w * h * pr * pr > Q.maxPixels) pr = Math.sqrt(Q.maxPixels / (w * h));
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  composer?.setPixelRatio(pr);
  composer?.setSize(w, h);
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  finalPass && finalPass.uniforms.uRes.value.set(size.x, size.y);
  if (current) {
    const cam = current.inst.camera;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    current.inst.resize?.(w, h);
  }
}

function applyPost(p = {}) {
  const b = p.bloom || {};
  bloomPass.strength = b.strength ?? 0.3;
  bloomPass.radius = b.radius ?? 0.6;
  bloomPass.threshold = b.threshold ?? 0.85;
  bloomPass.enabled = (b.strength ?? 0.3) > 0.001;
  renderer.toneMappingExposure = p.exposure ?? 1;
  renderer.toneMapping = p.toneMapping === 'agx' ? THREE.AgXToneMapping : p.toneMapping === 'linear' ? THREE.LinearToneMapping : THREE.ACESFilmicToneMapping;
  const u = finalPass.uniforms;
  u.uVignette.value = p.vignette ?? 0.35;
  u.uGrain.value = p.grain ?? 0.025;
  u.uSat.value = p.saturation ?? 1.04;
  u.uContrast.value = p.contrast ?? 1.02;
  const lift = p.lift || [0, 0, 0], gain = p.gain || [1, 1, 1];
  u.uLift.value.set(lift[0], lift[1], lift[2]);
  u.uGain.value.set(gain[0], gain[1], gain[2]);
  u.uCA.value = p.ca ?? 0;
  const tilt = p.tilt || {};
  u.uTilt.value = Q.q < 0.6 ? 0 : (tilt.amount ?? 0);
  u.uTiltCenter.value = tilt.center ?? 0.5;
  u.uTiltWidth.value = tilt.width ?? 0.18;
}

/* ------------------------------------------------------------------ */
/* Assets                                                              */
/* ------------------------------------------------------------------ */
const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const rgbeLoader = new RGBELoader();
const assetCache = new Map();
const asset = p => new URL(p, ASSET_BASE).href;
function cached(key, fn) { if (!assetCache.has(key)) assetCache.set(key, fn()); return assetCache.get(key); }
const loadGLTF = path => cached('g:' + path, () => gltfLoader.loadAsync(asset(path)));
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
const rig = { target: new THREE.Vector3(), yaw: 0, pitch: 0.3, dist: 10, yawT: 0, pitchT: 0.3, distT: 10, view: null, idlePhase: 0, wasIdle: false };
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
  const bob = Math.sin(t * 0.21) * 0.012 * rig.dist;
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
const hours = () => {
  if (save.timeMode === 'manual') return save.manualHour;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
};

function makeEnv(meta, def) {
  const seed = hashString(save.seed + ':' + meta.id);
  const members = ensureMembers(def, meta.id);
  return {
    THREE, renderer, pmrem,
    quality: qName, q: Q.q, shadows: Q.shadows,
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
    inst.camera.aspect = window.innerWidth / window.innerHeight;
    inst.camera.updateProjectionMatrix();
    current = { meta, def, inst, env };
    renderPass.scene = inst.scene;
    renderPass.camera = inst.camera;
    configureRig(inst.view);
    updateRig(0, 0);
    applyPost(inst.post);
    try { await renderer.compileAsync(inst.scene, inst.camera); } catch (e) { /* older drivers */ }
    // warm-up: let the world settle for a moment before revealing
    for (let i = 0; i < 3; i++) { inst.update(1 / 60, i / 60); composer.render(1 / 60); }
    save.scene = meta.id; dirty = true;
    sceneStart = performance.now();
    perf.reset();
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
  return { x: (_proj.x * 0.5 + 0.5) * window.innerWidth, y: (-_proj.y * 0.5 + 0.5) * window.innerHeight };
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
  ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
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
  if (!hover || idle || !current) { tag.hidden = true; return; }
  const c = hover;
  const s = toScreen(_proj.copy(c.pos).add(new THREE.Vector3(0, (c.radius || 0.5) * 1.1, 0)));
  if (!s) { tag.hidden = true; return; }
  tag.hidden = false;
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
  ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
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
  for (let i = 0; i < 24 && ok < 6; i++) if (feedAt(window.innerWidth * (0.3 + Math.random() * 0.4), window.innerHeight * (0.35 + Math.random() * 0.35))) ok++;
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
window.addEventListener('resize', resize);

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
  seg('segQuality', save.quality, v => { save.quality = v; save.autoQuality = null; dirty = true; setQuality(effectiveQuality(), true); });
  $('qualityHint').textContent = `当前：${{ high: '高', medium: '中', low: '低' }[qName]}画质。画面卡顿时选低一档，安静的办公电脑也能流畅待机。`;
  seg('segRotate', save.rotate, v => { save.rotate = +v; dirty = true; });
  seg('segPower', save.powerSave ? 1 : 0, v => { save.powerSave = v === '1'; dirty = true; });
  seg('segClock', save.showClock ? 1 : 0, v => { save.showClock = v === '1'; dirty = true; document.body.classList.toggle('hide-clock', !save.showClock); });
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

function setQuality(name, rebuild) {
  if (name === qName && !rebuild) return;
  qName = name; Q = QUALITY[name];
  renderer.shadowMap.enabled = Q.shadows;
  buildComposer();
  resize();
  if (current) {
    const id = current.meta.id;
    current.meta = { ...current.meta, id: '__reload' };
    enterWorld(id);
  }
}

/* ------------------------------------------------------------------ */
/* Performance watchdog                                                */
/* ------------------------------------------------------------------ */
const perf = {
  frames: 0, time: 0, done: false,
  reset() { this.frames = 0; this.time = 0; this.done = false; },
  sample(dt) {
    if (this.done || save.quality !== 'auto' || TEST) return;
    if (performance.now() - sceneStart < 2500) return;
    this.frames++; this.time += dt;
    if (this.time < 4) return;
    this.done = true;
    const fps = this.frames / this.time;
    const order = ['high', 'medium', 'low'];
    const i = order.indexOf(qName);
    if (fps < 38 && i < 2) {
      save.autoQuality = order[i + 1]; dirty = true;
      toast(`画面有点吃力，已自动切换到${{ medium: '中', low: '低' }[order[i + 1]]}画质`);
      setQuality(order[i + 1], true);
    }
  },
};

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */
let last = performance.now(), elapsed = 0, acc = 0, minuteTimer = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const rawDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  // idle state
  const idleNow = !(TEST && TEST.noIdle) && performance.now() - lastInput > 8000 && !$('settings').classList.contains('open') && document.activeElement?.tagName !== 'INPUT';
  if (idleNow !== idle) { idle = idleNow; document.body.classList.toggle('idle', idle); }
  // power save: 30 fps in screensaver mode
  if (idle && save.powerSave && !TEST) { acc += rawDt; if (acc < 1 / 31) return; }
  const dt = Math.min(0.05, idle && save.powerSave && !TEST ? acc : rawDt);
  acc = 0;
  elapsed += dt;
  if (current && !loading) {
    try { current.inst.update(dt, elapsed); } catch (e) { console.error(e); window.__idle.error = String(e.stack || e); }
    updateRig(dt, elapsed);
    if (current.inst.post) applyPost(current.inst.post);
    finalPass.uniforms.uTime.value = elapsed;
    composer.render(dt);
    perf.sample(rawDt);
    updateTag();
  }
  minuteTimer += rawDt;
  if (minuteTimer > 15) {
    minuteTimer = 0;
    tickClock();
    updateStatus();
    updateAmbience();
    if (dirty) persist();
    if (idle && save.rotate > 0 && current && performance.now() - sceneStart > save.rotate * 60e3) {
      const i = WORLDS.findIndex(w => w.id === current.meta.id);
      enterWorld(WORLDS[(i + 1) % WORLDS.length].id);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */
window.__idle = {
  ready: null, sceneId: null, error: null,
  enterWorld, feedAt, feedHandful, addResident,
  setHours: h => { save.timeMode = 'manual'; save.manualHour = h; },
  /** Advance the simulation without rendering (test harness). */
  simulate(seconds, step = 1 / 30) {
    if (!current) return;
    for (let s = 0; s < seconds; s += step) { elapsed += step; current.inst.update(step, elapsed); updateRig(step, elapsed); }
  },
  setView(v) { Object.assign(rig, v); if (v.yaw !== undefined) rig.yawT = v.yaw; if (v.pitch !== undefined) rig.pitchT = v.pitch; if (v.dist !== undefined) rig.distT = v.dist; },
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
resize();
tickClock();
setInterval(tickClock, 10000);
window.addEventListener('beforeunload', () => { if (dirty) persist(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && dirty) persist(); });
if (save.sound) {
  // browsers need a gesture before audio can start
  $('btnSound').setAttribute('aria-pressed', 'true');
  const startAudio = async () => { await audio.enable(); updateAmbience(); window.removeEventListener('pointerdown', startAudio); };
  window.addEventListener('pointerdown', startAudio);
}
window.__idle.ready = enterWorld(save.scene, { first: true });
requestAnimationFrame(frame);
