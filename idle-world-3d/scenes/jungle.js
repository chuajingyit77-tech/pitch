// 雨林 · 瀑布与萤火 — a rainforest clearing: a waterfall pours from a mossy cliff into a jade pond.
// Art direction borrows from Ori and the Blind Forest (glowing blue-teal nights, bioluminescence)
// and Horizon Zero Dawn (lush, sunlit, hazy greenery).
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, damp, makeRng, createWind, addWind, patchMaterial, disposeObject } from '../lib/util.js';
import { buildFishGeometry, paintFish, createFishMaterial, FishInstances, Swimmer } from '../lib/fish.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createShared, jungleMaterial, GLOW_N } from './jungle/shading.js';
import * as TX from './jungle/textures.js';
import { createLayout, buildTerrain, buildCliff, sampleCliff, buildBoulder, buildLog, WATER_Y, POND, FALL } from './jungle/terrain.js';
import { buildTree, buildTrunk, taperTube, lianaCurve, dropCurve, buildClump } from './jungle/trees.js';
import * as P from './jungle/plants.js';
import { buildPond, buildWaterfall, buildMist, buildSplash, fallT } from './jungle/water.js';
import { buildSky, buildGodRays, buildPoints, buildRain, buildMistSheets } from './jungle/fx.js';
import { createFrogMesh } from './jungle/frog.js';
import { loadMacawKit, Macaw } from './jungle/macaw.js';
import { makeWingAtlas, createButterflyMesh, Butterfly, createDragonflyMesh, Dragonfly } from './jungle/insects.js';
import { FruitSystem, FRUIT_KINDS } from './jungle/fruit.js';

/* ------------------------------------------------------------------ */
/* Weather schedule (shared by the scene and the ambience helper)       */
/* ------------------------------------------------------------------ */
let RAIN_SALT = 0;
function dayIndex() { const d = new Date(); return Math.floor((d.getTime() - d.getTimezoneOffset() * 6e4) / 864e5); }
/** 0..1 rain intensity for an hour of the local day: afternoon shower 15:00–16:30 daily, some nights 1:30–3:00. */
export function rainAmount(h) {
  let r = 0;
  if (h >= 14.95 && h < 16.55) r = smoothstep(14.95, 15.2, h) * (1 - smoothstep(16.3, 16.55, h));
  const k = Math.abs(Math.sin((dayIndex() + RAIN_SALT) * 12.9898) * 43758.5453) % 1;
  if (k < 0.4 && h >= 1.4 && h < 3.1) r = Math.max(r, smoothstep(1.4, 1.65, h) * (1 - smoothstep(2.85, 3.1, h)));
  return r;
}
/** Surfaces stay wet for a while after a shower. */
function wetAmount(h) {
  let w = rainAmount(h);
  if (h >= 16.3 && h < 18.3) w = Math.max(w, (1 - smoothstep(16.3, 18.3, h)) * 0.85);
  return w;
}
const isNightHour = h => h >= 18.9 || h < 5.6;
export function ambienceFor(h) {
  if (rainAmount(h) > 0.25) return ['rain', 'waterfall'];
  return isNightHour(h) ? ['waterfall', 'insects', 'frogs'] : ['waterfall', 'birds'];
}

const VIEW_TARGET = new THREE.Vector3(1.4, 2.4, -3.6);
const VIEW_PITCH = 0.14;
const SUN_AZ = Math.PI * 0.35;
const LATITUDE = 25;

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _m4 = new THREE.Matrix4(), _s = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

export default {
  id: 'jungle',
  food: '热带水果',
  kinds: { frog: { zh: '红眼树蛙' }, macaw: { zh: '金刚鹦鹉' }, morpho: { zh: '蓝闪蝶' } },
  starter: ['frog', 'frog', 'macaw', 'morpho', 'morpho', 'morpho'],
  addable: ['frog', 'macaw', 'morpho', 'frog', 'morpho'],
  maxMembers: 14,
  ambience: h => ambienceFor(h),
  eatSound: 'eat',

  async create(env) {
    const { renderer, q } = env;
    const seed = env.seed >>> 0;
    RAIN_SALT = seed % 9973;
    const rng = env.rng;
    const R = salt => rng.fork(salt);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 900);
    camera.layers.enable(1);
    const shared = createShared();
    const wind = createWind({ direction: new THREE.Vector2(1, 0.35), strength: 1, gust: 1 });
    const owned = []; // disposables not reachable from the scene graph
    const ONLY_MAIN = o => { o.layers.set(1); return o; };

    /* ---------------- textures ---------------- */
    const cookie = TX.makeCookie((seed % 10000) + 1, 256);
    shared.uCookieTex.value = cookie.texture;
    owned.push(cookie.texture);
    const bark = TX.makeBark((seed % 1000) + 5, 512, 512);
    const rock = TX.makeRock((seed % 1000) + 9, 512, 512);
    const ground = TX.makeGround((seed % 1000) + 13, q >= 0.9 ? 1024 : 512, q >= 0.9 ? 1024 : 512);
    const atlas = P.makeAtlas((seed % 1000) + 21, q);
    const puff = TX.makePuff(seed % 1000 + 3, 128);
    const sprite = TX.makeSoftSprite(64);
    owned.push(puff, sprite);
    const wN1 = env.loadTexture('textures/Water_1_M_Normal.jpg', { srgb: false, repeat: true });
    const wN2 = env.loadTexture('textures/Water_2_M_Normal.jpg', { srgb: false, repeat: true });

    const camPos0 = new THREE.Vector3(VIEW_TARGET.x, VIEW_TARGET.y + 14 * Math.sin(VIEW_PITCH), VIEW_TARGET.z + 14 * Math.cos(VIEW_PITCH));
    /* ---------------- layout + ground ---------------- */
    const L = createLayout((seed % 100000) + 17);
    const groundMat = new THREE.MeshStandardMaterial({ map: ground.map, normalMap: ground.normalMap, normalScale: new THREE.Vector2(0.9, 0.9), vertexColors: true, roughness: 0.93, envMapIntensity: 0.45 });
    jungleMaterial(groundMat, shared, { caustics: true, wetDark: 0.4 });
    const terrain = new THREE.Mesh(buildTerrain(L, q, rng), groundMat);
    terrain.receiveShadow = true;
    scene.add(terrain);

    const rockMat = new THREE.MeshStandardMaterial({ map: rock.map, normalMap: rock.normalMap, normalScale: new THREE.Vector2(1.1, 1.1), vertexColors: true, roughness: 0.82, envMapIntensity: 0.6 });
    jungleMaterial(rockMat, shared, { moss: 0.9, caustics: true, specks: true });
    const cliffGeo = buildCliff(L, q, seed % 100000);
    const cliff = new THREE.Mesh(cliffGeo, rockMat);
    cliff.castShadow = true; cliff.receiveShadow = true;
    scene.add(cliff);

    /* ---------------- boulders ---------------- */
    const boulderGeos = [0, 1, 2].map(i => buildBoulder((seed % 1000) + 40 + i, q > 0.6 ? 3 : 2, { flat: [0.3, 0.45, 0.2][i], rough: [0.3, 0.22, 0.35][i] }));
    const boulderMat = new THREE.MeshStandardMaterial({ map: rock.map, normalMap: rock.normalMap, roughness: 0.8, envMapIntensity: 0.6 });
    jungleMaterial(boulderMat, shared, { moss: 1.0, caustics: true, specks: true });
    const boulderSpots = [];
    const rr = R('rocks');
    const boulderList = [[], [], []];
    const addBoulder = (x, z, s, sy = 1, sink = 0.35) => {
      const kind = rr.int(0, 2);
      const y = L.groundH(x, z) - s * sink;
      const rot = rr.next() * TAU;
      boulderList[kind].push({ x, y, z, s, sy, rot });
      // top surface for frogs/butterflies
      const top = y + s * sy * (1 - [0.3, 0.45, 0.2][kind]) * 0.95;
      boulderSpots.push({ pos: new THREE.Vector3(x, top, z), r: s * 0.5, kind: 'rock' });
    };
    // plunge pool boulders
    addBoulder(FALL.x - 2.6, FALL.lipZ + 2.3, 1.5, 0.9, 0.45);
    addBoulder(FALL.x + 2.5, FALL.lipZ + 2.0, 1.3, 1.0, 0.45);
    addBoulder(FALL.x + 3.9, FALL.lipZ + 3.4, 0.9, 0.8, 0.4);
    addBoulder(FALL.x - 4.0, FALL.lipZ + 3.6, 1.0, 0.85, 0.4);
    // shore rocks (half in water)
    for (let i = 0; i < Math.round(16 * Math.max(q, 0.6)); i++) {
      const a = rr.next() * TAU;
      const x = POND.cx + Math.cos(a) * POND.rx * rr.range(0.92, 1.12);
      const z = POND.cz + Math.sin(a) * (Math.sin(a) < 0 ? POND.rzBack : POND.rzFront) * rr.range(0.92, 1.12);
      if (z < FALL.lipZ + 2.8 && Math.abs(x - FALL.x) < 4.5) continue;
      addBoulder(x, z, rr.range(0.35, 0.95), rr.range(0.7, 1.0), 0.4);
    }
    // stepping stones
    for (let i = 0; i < 3; i++) addBoulder(POND.cx + 1.5 + i * 1.1, POND.cz + 2.2 - i * 0.6, rr.range(0.3, 0.42), 0.8, 0.5);
    // floor rocks
    for (let i = 0; i < 9; i++) {
      const x = rr.range(-16, 16), z = rr.range(-6, 12);
      if (L.pondD(x, z) < 1.25) continue;
      addBoulder(x, z, rr.range(0.4, 1.3), rr.range(0.6, 1.0), 0.45);
    }
    const boulders = boulderList.map((list, k) => {
      const m = new THREE.InstancedMesh(boulderGeos[k], boulderMat, Math.max(1, list.length));
      list.forEach((b, i) => {
        _q.setFromAxisAngle(UP, b.rot);
        _m4.compose(_v.set(b.x, b.y, b.z), _q, _s.set(b.s, b.s * b.sy, b.s));
        m.setMatrixAt(i, _m4);
        m.setColorAt(i, _c.setHSL(0.1 + rr.range(-0.03, 0.03), rr.range(0.05, 0.15), rr.range(0.55, 0.75)));
      });
      m.count = list.length;
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      return m;
    });

    /* ---------------- trees ---------------- */
    const barkMat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, normalScale: new THREE.Vector2(1.3, 1.3), vertexColors: true, roughness: 0.9, envMapIntensity: 0.5 });
    jungleMaterial(barkMat, shared, { moss: 0.75, specks: true });
    const toPond = (x, z) => Math.atan2(POND.cz - z, POND.cx - x);
    const treeDefs = [
      { at: [-7.6, -3.2], opt: { height: 32, r0: 1.25, fins: 7, finLen: 3.3, finH: 4.4, limbs: 5, limbMin: 8.5, limbMax: 21, limbLen: [6, 10] } },
      { at: [9.8, -3.0], opt: { height: 30, r0: 1.05, fins: 6, finLen: 2.7, finH: 3.6, limbs: 4, limbMin: 9.5, limbMax: 20, limbLen: [5, 9] } },
      { at: [-15.5, -6.5], opt: { height: 28, r0: 0.9, fins: 5, finLen: 2.2, finH: 3, limbs: 3, limbMin: 11, limbMax: 20 } },
      { at: [17.5, 3], opt: { height: 28, r0: 0.95, fins: 5, finLen: 2.4, finH: 3.2, limbs: 3, limbMin: 11, limbMax: 21 } },
      { at: [-19, 6.5], opt: { height: 26, r0: 0.8, fins: 5, finLen: 2, finH: 2.8, limbs: 2, limbMin: 12, limbMax: 20 } },
    ];
    const trees = treeDefs.map((d, i) => {
      const [x, z] = d.at;
      const y = L.groundH(x, z) - 0.15;
      return { def: d, ...buildTree((seed % 1000) + 300 + i * 17, new THREE.Vector3(x, y, z), { ...d.opt, towards: toPond(x, z), q }) };
    });
    const treeAxes = trees.map(t => ({ x: t.def.at[0], z: t.def.at[1], r: t.def.opt.r0 + t.def.opt.finLen * 0.9 }));
    // background trees on the plateau and at the sides
    const bgParts = [];
    const bgTops = [];
    const rb = R('bgtrees');
    for (let i = 0; i < Math.round(22 * Math.max(q, 0.6)); i++) {
      const x = rb.range(-34, 34);
      const back = rb.range(3, 26);
      const z = L.cliffZ(x) - back;
      const y = L.cliffH(x) + back * 0.05 - 0.6;
      const h = rb.range(6, 13) + back * 0.25, r0 = rb.range(0.3, 0.6);
      const lean = new THREE.Vector3(rb.range(-1.2, 1.2), 0, rb.range(-1.2, 1.2));
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, y - 1, z), new THREE.Vector3(x + lean.x * 0.3, y + h * 0.5, z + lean.z * 0.3), new THREE.Vector3(x + lean.x, y + h, z + lean.z)]);
      const g = taperTube(curve, t => lerp(r0 * 1.4, r0 * 0.5, Math.pow(t, 0.7)), { tubular: 8, radial: 7, tint: [0.85, 0.9, 0.8], uvScale: [2, 0.4] });
      bgParts.push(g);
      bgTops.push(new THREE.Vector3(x + lean.x, y + h, z + lean.z));
    }
    // side forest wall (lower ground, left and right)
    for (let i = 0; i < Math.round(12 * Math.max(q, 0.6)); i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * rb.range(20, 32), z = rb.range(-8, 16);
      const y = L.groundH(x, z) - 0.2;
      const h = rb.range(16, 26), r0 = rb.range(0.4, 0.8);
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x, y, z), new THREE.Vector3(x + rb.range(-0.5, 0.5), y + h * 0.5, z), new THREE.Vector3(x + rb.range(-1, 1), y + h, z + rb.range(-1, 1))]);
      bgParts.push(taperTube(curve, t => lerp(r0 * 1.5, r0 * 0.5, Math.pow(t, 0.7)), { tubular: 8, radial: 7, uvScale: [2, 0.4] }));
      bgTops.push(curve.getPointAt(1));
    }
    // two low, gnarled branches reaching over the pond: visible macaw perches
    const lowPerches = [];
    for (const [ti, y0, len, rise, tz] of [[0, 5.0, 5.8, 1.1, 1.5], [1, 6.2, 5.0, 0.8, 1.5], [0, 3.6, 5.2, 0.7, 6.5]]) {
      const t = trees[ti];
      const base = t.axis(y0);
      const dir = new THREE.Vector3(POND.cx - base.x, 0, POND.cz + tz - base.z).normalize();
      const pts = [base.clone().addScaledVector(dir, -0.4), base.clone().addScaledVector(dir, len * 0.35).add(new THREE.Vector3(0, rise, 0)), base.clone().addScaledVector(dir, len * 0.7).add(new THREE.Vector3(0, rise * 1.2, 0.3)), base.clone().addScaledVector(dir, len).add(new THREE.Vector3(0, rise * 0.8, 0.4))];
      const curve = new THREE.CatmullRomCurve3(pts);
      const r0 = t.rTrunk(y0) * 0.3;
      bgParts.push(taperTube(curve, u => lerp(r0, 0.07, Math.pow(u, 0.8)), { tubular: 22, radial: 9, tintFn: (u, nn) => { const m = clamp(nn.y, 0, 1); return [lerp(1, 0.6, m), lerp(1, 1.15, m), lerp(1, 0.45, m)]; }, uvScale: [2, 0.4] }));
      for (const u of [0.45, 0.62, 0.8]) {
        const p = curve.getPointAt(u);
        lowPerches.push({ pos: p.add(new THREE.Vector3(0, lerp(r0, 0.07, Math.pow(u, 0.8)) * 0.9, 0)), r: 0.1 });
      }
      t.hangs.push(curve.getPointAt(0.55), curve.getPointAt(0.85));
    }
    const barkGeo = mergeGeometries([...trees.map(t => t.geometry), ...bgParts]);
    trees.forEach(t => t.geometry.dispose()); bgParts.forEach(g => g.dispose());
    const treeMesh = new THREE.Mesh(barkGeo, barkMat);
    treeMesh.castShadow = true; treeMesh.receiveShadow = true;
    scene.add(treeMesh);

    /* ---------------- lianas, aerial roots ---------------- */
    const vineMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, color: '#ffffff', envMapIntensity: 0.4 });
    patchMaterial(vineMat, {
      key: 'hangsway',
      uniforms: { uWT: wind.uniforms.uWindTime },
      vertexHeader: 'uniform float uWT; attribute float aHang;',
      vertex: { '#include <begin_vertex>': '$&\n transformed.x += sin(uWT * 0.7 + position.y * 0.15 + position.z * 0.3) * aHang * aHang * 0.22; transformed.z += cos(uWT * 0.55 + position.x * 0.2) * aHang * aHang * 0.16;' },
    });
    jungleMaterial(vineMat, shared, { moss: 0.5 });
    const vineParts = [];
    const rl = R('lianas');
    const withHang = (g, hangFn) => {
      const p = g.attributes.position;
      const h = new Float32Array(p.count);
      for (let i = 0; i < p.count; i++) h[i] = hangFn(i, p);
      g.setAttribute('aHang', new THREE.BufferAttribute(h, 1));
      return g;
    };
    const allHangs = trees.slice(0, 2).flatMap(t => t.hangs);
    const innerHangs = trees.slice(0, 4).flatMap(t => t.limbs.map(lb => lb.curve.getPointAt(0.25 + rl.next() * 0.3)));
    const lianaTint = (t, n) => { const m = clamp(n.y, 0, 1) * 0.6; return [lerp(0.55, 0.4, m), lerp(0.48, 0.6, m), lerp(0.36, 0.25, m)]; };
    const sideHangs = allHangs.filter(h => Math.abs(Math.atan2(h.x - VIEW_TARGET.x, -(h.z - (VIEW_TARGET.z + 14)))) > 0.36);
    for (let i = 0; i < Math.min(9, allHangs.length); i++) {
      let a = allHangs[rl.int(0, allHangs.length - 1)];
      if (sideHangs.length && rl.chance(0.85)) a = sideHangs[rl.int(0, sideHangs.length - 1)];
      if (rl.chance(0.35)) {
        const curve = dropCurve(a, L.groundH(a.x, a.z), rl);
        const g = taperTube(curve, t => lerp(0.09, 0.06, t), { tubular: 28, radial: 6, tintFn: lianaTint, uvScale: [1, 0.5] });
        const top = a.y, len = a.y - L.groundH(a.x, a.z);
        vineParts.push(withHang(g, (k, p) => clamp((top - p.getY(k)) / len, 0, 1) * smoothstep(0, 0.25, (p.getY(k) - L.groundH(a.x, a.z)) / len)));
      } else {
        const b = allHangs[rl.int(0, allHangs.length - 1)];
        if (a.distanceTo(b) < 3 || a.distanceTo(b) > 14) continue;
        const curve = lianaCurve(a, b, rl.range(1.5, 3.5));
        const g = taperTube(curve, t => 0.075, { tubular: 24, radial: 6, tintFn: lianaTint });
        vineParts.push(withHang(g, (k, p) => { const tt = Math.floor(k / 7) / 24; return Math.sin(Math.PI * tt) * 0.6; }));
      }
    }
    // aerial roots: thin straight strands hanging from limbs
    const rootTops = [];
    for (let i = 0; i < Math.round(3 * Math.max(q, 0.5)); i++) {
      const a = innerHangs[rl.int(0, innerHangs.length - 1)];
      const end = Math.max(L.groundH(a.x, a.z) + rl.range(0.3, 3.5), WATER_Y + 0.4);
      if (a.y - end < 2) continue;
      const pts = [a.clone(), new THREE.Vector3(a.x + rl.range(-0.2, 0.2), (a.y + end) / 2, a.z + rl.range(-0.2, 0.2)), new THREE.Vector3(a.x + rl.range(-0.3, 0.3), end, a.z + rl.range(-0.3, 0.3))];
      const g = taperTube(new THREE.CatmullRomCurve3(pts), () => 0.022, { tubular: 6, radial: 4, tint: [0.5, 0.45, 0.35] });
      const len = a.y - end;
      vineParts.push(withHang(g, (k, p) => clamp((a.y - p.getY(k)) / len, 0, 1)));
      rootTops.push(a);
    }
    let vineMesh = null;
    if (vineParts.length) {
      const vg = mergeGeometries(vineParts);
      vineParts.forEach(g => g.dispose());
      vineMesh = new THREE.Mesh(vg, vineMat);
      vineMesh.castShadow = true;
      scene.add(vineMesh);
    }

    /* ---------------- fallen logs ---------------- */
    const logMat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, vertexColors: true, roughness: 0.9 });
    jungleMaterial(logMat, shared, { moss: 1.0, specks: true });
    const logs = [];
    const addLog = (x, z, rot, len, r0, r1, tilt = 0) => {
      const g = buildLog((seed % 1000) + 70 + logs.length, { length: len, r0, r1 });
      const m = new THREE.Mesh(g, logMat);
      const y = L.groundH(x, z) + r0 * 0.45;
      m.position.set(x, y, z);
      m.rotation.set(0, rot, tilt);
      m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      m.updateMatrixWorld();
      logs.push({ mesh: m, x, z, rot, len, r0, y });
    };
    addLog(-5.2, 4.6, 0.55, 7.5, 0.62, 0.45, 0.02);
    addLog(6.9, -0.4, -0.95, 6.0, 0.48, 0.36, -0.06);
    const logSpots = [];
    for (const lg of logs) {
      for (let k = -2; k <= 2; k++) {
        const along = k / 2 * lg.len * 0.38;
        logSpots.push({ pos: new THREE.Vector3(lg.x + Math.cos(lg.rot) * along, lg.y + lg.r0 * 0.9, lg.z - Math.sin(lg.rot) * along), r: 0.3, kind: 'log' });
      }
    }

    /* ---------------- plants ---------------- */
    const WIND_LOW = { height: 1.0, amount: 0.07, stiffness: 1.5, flutter: 0.012 };
    const WIND_MID = { height: 2.2, amount: 0.13, stiffness: 1.7, flutter: 0.02 };
    const WIND_TALL = { height: 4.5, amount: 0.22, stiffness: 2.0, flutter: 0.02 };
    const foliageMats = new Map();
    const foliageMat = (preset, extra = {}) => {
      const key = JSON.stringify(preset) + JSON.stringify(extra);
      if (foliageMats.has(key)) return foliageMats.get(key);
      const m = new THREE.MeshStandardMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.58, envMapIntensity: 0.7 });
      if (preset) addWind(m, wind, preset);
      jungleMaterial(m, shared, { translucent: 0.85, ...extra });
      // wind presets only differ in uniform values: let them share one compiled program
      m.customProgramCacheKey = () => 'jgfoliage' + (preset ? 'w' : '') + JSON.stringify(extra);
      foliageMats.set(key, m);
      return m;
    };
    const plantMeshes = [];
    const blocked = (x, z, r = 0.5) => {
      if (L.pondD(x, z) < 1.08) return true;
      if (z < L.cliffZ(x) + 0.8) return true;
      for (const t of treeAxes) if (Math.hypot(x - t.x, z - t.z) < t.r * 0.8 + r) return true;
      return false;
    };
    const camRing = (x, z) => Math.abs(Math.hypot(x - VIEW_TARGET.x, z - VIEW_TARGET.z) - 13.9);
    // camera-space helpers for framing: horizontal angle from the default view axis and distance from the camera
    const camAng = (x, z) => Math.atan2(x - camPos0.x, -(z - camPos0.z));
    const camDist = (x, z) => Math.hypot(x - camPos0.x, z - camPos0.z);
    /** Instance a plant geometry at a list of {x,y,z,s,rot,tilt?}. */
    const instance = (geo, mat, list, { shadow = true, mainOnly = false } = {}) => {
      if (!list.length) return null;
      const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((p, i) => {
        if (p.normal) { _q.setFromUnitVectors(UP, p.normal); _q.multiply(_q2.setFromAxisAngle(UP, p.rot)); }
        else { _e.set(p.tiltX || 0, p.rot, p.tiltZ || 0, 'YXZ'); _q.setFromEuler(_e); }
        _m4.compose(_v.set(p.x, p.y, p.z), _q, _s.set(p.s * (p.sx || 1), p.s * (p.sy || 1), p.s * (p.sx || 1)));
        m.setMatrixAt(i, _m4);
        const v = rtint.range(0.8, 1.08);
        m.setColorAt(i, _c.setRGB(v * rtint.range(0.93, 1.07), v, v * rtint.range(0.84, 1.0)));
      });
      m.castShadow = shadow; m.receiveShadow = true;
      m.computeBoundingSphere();
      if (mainOnly) ONLY_MAIN(m);
      scene.add(m);
      plantMeshes.push(m);
      return m;
    };
    const rp = R('plants');
    const rtint = R('tint');
    const scatter = (n, { region, minR = 0.5, test, s = [1, 1], y = 0 }) => {
      const out = [];
      let guard = 0;
      while (out.length < n && guard++ < n * 40) {
        const x = rp.range(region[0], region[1]), z = rp.range(region[2], region[3]);
        if (blocked(x, z, minR)) continue;
        if (test && !test(x, z)) continue;
        out.push({ x, y: L.groundH(x, z) + y, z, s: rp.range(s[0], s[1]), rot: rp.next() * TAU, tiltX: rp.range(-0.08, 0.08), tiltZ: rp.range(-0.08, 0.08) });
      }
      return out;
    };
    const nearShore = (x, z) => { const d = L.pondD(x, z); return d > 1.08 && d < 1.5; };
    // tall shore plants only on the sides / back of the pond so the water stays visible
    const tallShore = (x, z) => nearShore(x, z) && (z < POND.cz + 0.5 || Math.abs(camAng(x, z)) > 0.42);
    const frontFrame = (x, z) => { const a = Math.abs(camAng(x, z)), d = camDist(x, z); return d > 3.5 && d < 9 && a > 0.48 && a < 0.8; };

    // ground ferns: everywhere on the floor, denser toward the edges
    const fernGeo = P.fern(atlas, R('fernG'), { fronds: 9 });
    const fernList = scatter(Math.round(150 * q), { region: [-24, 24, -9, 18], minR: 0.3, s: [0.7, 1.6], test: (x, z) => rp.chance(0.35 + Math.min(1, Math.abs(x) / 14) * 0.6) && (L.pondD(x, z) > 1.15) });
    for (const f of fernList) { if (Math.abs(camAng(f.x, f.z)) < 0.45 && f.z > POND.cz + 2) f.s *= 0.65; }
    // low ground cover in front of the pond (keeps the view open but hides bare soil)
    for (let i = 0; i < Math.round(70 * Math.max(q, 0.5)); i++) {
      const x = camPos0.x + rp.range(-7, 7), z = rp.range(POND.cz + POND.rzFront * 0.95, camPos0.z - 1);
      if (blocked(x, z, 0.2) || L.pondD(x, z) < 1.12) continue;
      fernList.push({ x, y: L.groundH(x, z), z, s: rp.range(0.3, 0.55), rot: rp.next() * TAU, tiltX: rp.range(-0.1, 0.1) });
    }
    // ferns on cliff ledges
    const cliffPts = sampleCliff(cliffGeo, R('cliffp'), Math.round(60 * q), { minY: 0.8, maxNy: 0.75, minNy: 0.1 });
    for (const c of cliffPts) fernList.push({ x: c.p.x, y: c.p.y - 0.05, z: c.p.z, s: rp.range(0.6, 1.2), rot: rp.next() * TAU, normal: c.n.clone().lerp(UP, 0.5).normalize() });
    instance(fernGeo, foliageMat(WIND_LOW), fernList, { shadow: false, mainOnly: true });
    // glowing ferns near the water and the log (bioluminescent veins at night)
    const glowFernGeo = P.fern(atlas, R('fernGlow'), { fronds: 8, rect: 'glowfern' });
    const glowFernList = scatter(Math.round(16 * Math.max(q, 0.6)), { region: [-9, 9, -8, 6], s: [0.5, 0.9], test: nearShore });
    instance(glowFernGeo, foliageMat(WIND_LOW, { glowLeaf: true }), glowFernList, { shadow: false, mainOnly: true });
    // monstera
    const monGeo = P.monstera(atlas, R('mon'), { leaves: 9 });
    const monList = [
      ...scatter(4, { region: [-13, 13, -6, 11], s: [1.2, 1.7], test: (x, z) => frontFrame(x, z) && camRing(x, z) > 1.0 }),
      ...scatter(6, { region: [-16, 16, -8, 4], s: [1.0, 1.5], test: (x, z) => !nearShore(x, z) && Math.abs(camAng(x, z)) > 0.3 }),
    ];
    instance(monGeo, foliageMat(WIND_MID), monList);
    // banana
    const banGeo = P.banana(atlas, R('ban'), { leaves: 8 });
    const banList = scatter(Math.round(7 * Math.max(q, 0.7)), { region: [-18, 18, -8, 8], s: [0.95, 1.25], test: (x, z) => Math.abs(x) > 6.5 && camRing(x, z) > 2.5 && (camDist(x, z) > 10 || Math.abs(camAng(x, z)) > 0.7) });
    instance(banGeo, foliageMat(WIND_TALL), banList);
    // elephant ears along the shore and in the foreground
    const eeGeo = P.elephantEar(atlas, R('ee'), { leaves: 6 });
    const eeList = [
      ...scatter(5, { region: [-9, 9, -9, 3], s: [1.0, 1.4], test: tallShore }),
      ...scatter(3, { region: [-12, 12, -2, 11], s: [1.1, 1.6], test: (x, z) => frontFrame(x, z) && camRing(x, z) > 1.0 }),
    ];
    instance(eeGeo, foliageMat(WIND_MID), eeList);
    // tree ferns at the back corners
    const tfGeo = P.treeFern(atlas, R('tf'), { height: 3.2 });
    const tfList = scatter(Math.round(7 * Math.max(q, 0.7)), { region: [-16, 16, -9, 5], s: [0.9, 1.35], test: (x, z) => (Math.abs(x) > 5 || z < -7) && camRing(x, z) > 3 && (camDist(x, z) > 11 || Math.abs(camAng(x, z)) > 0.75) });
    instance(tfGeo, foliageMat(WIND_TALL), tfList);
    // heliconia colour pops
    const helGeo = P.heliconia(atlas, R('hel'), { stems: 4 });
    const helList = [
      ...scatter(4, { region: [-10, 10, -8, 4], s: [0.9, 1.2], test: tallShore }),
      ...scatter(2, { region: [-12, 12, 0, 11], s: [1.0, 1.25], test: (x, z) => frontFrame(x, z) }),
    ];
    instance(helGeo, foliageMat(WIND_MID), helList);
    // sedges along the margin
    const sedgeGeo = P.sedge(atlas, R('sedge'), { cards: 4, height: 0.9 });
    const sedgeList = [];
    const rs = R('sedgeL');
    for (let i = 0; i < Math.round(40 * q); i++) {
      const a = rs.next() * TAU;
      const k = rs.range(0.97, 1.08);
      const x = POND.cx + Math.cos(a) * POND.rx * k, z = POND.cz + Math.sin(a) * (Math.sin(a) < 0 ? POND.rzBack : POND.rzFront) * k;
      if (z < FALL.lipZ + 3 && Math.abs(x - FALL.x) < 4) continue;
      sedgeList.push({ x, y: Math.max(L.groundH(x, z), WATER_Y - 0.1), z, s: rs.range(0.6, 1.3), rot: rs.next() * TAU });
    }
    instance(sedgeGeo, foliageMat(WIND_LOW), sedgeList, { shadow: false, mainOnly: true });

    // epiphytes on limbs and trunks: bromeliads + orchid sprays
    const re = R('epi');
    const limbSpots = [];
    for (const t of trees.slice(0, 4)) {
      for (const p of t.perches) limbSpots.push({ x: p.pos.x, y: p.pos.y - 0.05, z: p.pos.z });
      for (let k = 0; k < 4; k++) {
        const y = re.range(3, 12);
        const c = t.axis(y);
        const a = re.next() * TAU;
        const r = t.rTrunk(y) * 0.95;
        limbSpots.push({ x: c.x + Math.cos(a) * r, y: c.y, z: c.z + Math.sin(a) * r, out: new THREE.Vector3(Math.cos(a), 0.6, Math.sin(a)).normalize() });
      }
    }
    const bromGeo = P.bromeliad(atlas, R('brom'), { leaves: 12, size: 0.65 });
    const bromRedGeo = P.bromeliad(atlas, R('brom2'), { leaves: 10, size: 0.55, red: true });
    const bromList = [], bromRedList = [];
    re.shuffle(limbSpots);
    limbSpots.forEach((sp, i) => {
      const item = { x: sp.x, y: sp.y, z: sp.z, s: re.range(0.7, 1.3), rot: re.next() * TAU, normal: sp.out || UP };
      (i % 3 === 0 ? bromRedList : bromList).push(item);
    });
    for (const c of sampleCliff(cliffGeo, R('cliffb'), Math.round(14 * q), { minY: 2, maxNy: 0.9, minNy: 0.2 })) bromList.push({ x: c.p.x, y: c.p.y, z: c.p.z, s: re.range(0.8, 1.3), rot: re.next() * TAU, normal: c.n.clone().lerp(UP, 0.6).normalize() });
    instance(bromGeo, foliageMat(WIND_LOW), bromList, { shadow: false, mainOnly: true });
    instance(bromRedGeo, foliageMat(WIND_LOW), bromRedList, { shadow: false, mainOnly: true });
    const orchGeos = ['orchid', 'orchid2', 'orchid3'].map((rect, i) => P.orchidSpray(atlas, R('orch' + i), { rect, flowers: 6 }));
    const orchLists = [[], [], []];
    for (let i = 0; i < Math.round(18 * Math.max(q, 0.6)); i++) {
      const sp = i < limbSpots.length * 0.5 ? limbSpots[(i * 7) % limbSpots.length] : null;
      const spot = sp ? { x: sp.x, y: sp.y + 0.1, z: sp.z } : (() => { const b = boulderSpots[re.int(0, boulderSpots.length - 1)]; return { x: b.pos.x, y: b.pos.y - 0.05, z: b.pos.z }; })();
      orchLists[i % 3].push({ ...spot, s: re.range(1.0, 1.6), rot: re.next() * TAU });
    }
    orchGeos.forEach((g, i) => instance(g, foliageMat(WIND_LOW), orchLists[i], { shadow: false, mainOnly: true }));

    // hanging vine curtains: from limbs and the cliff rim
    const curtainGeo = P.vineCurtain(atlas, R('curt'), { strands: 6, len: 4.5 });
    const curtList = [];
    for (let i = 0; i < Math.round(14 * Math.max(q, 0.6)); i++) {
      const a = allHangs[re.int(0, allHangs.length - 1)];
      curtList.push({ x: a.x, y: a.y, z: a.z, s: re.range(0.8, 1.6), rot: re.next() * TAU });
    }
    const rimR = R('rim');
    for (let i = 0; i < Math.round(26 * Math.max(q, 0.6)); i++) {
      const x = rimR.range(-20, 20);
      if (Math.abs(x - FALL.x) < 2.2) continue;
      const z = L.cliffZ(x) + 0.35, y = L.cliffH(x) + 0.1;
      curtList.push({ x, y, z, s: rimR.range(0.8, 1.9), sy: rimR.range(0.8, 1.6), rot: rimR.range(-0.4, 0.4) });
    }
    const curtMat = new THREE.MeshStandardMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 });
    patchMaterial(curtMat, {
      key: 'curtsway', uniforms: { uWT: wind.uniforms.uWindTime },
      vertexHeader: 'uniform float uWT;',
      vertex: { '#include <begin_vertex>': '$&\n { float hd = clamp(-position.y / 4.5, 0.0, 1.2); vec3 io = vec3(0.0); \n #ifdef USE_INSTANCING\n io = instanceMatrix[3].xyz;\n #endif\n transformed.x += sin(uWT * 0.9 + io.x * 0.7 + position.y * 0.6) * hd * hd * 0.18; transformed.z += cos(uWT * 0.7 + io.z * 0.5) * hd * hd * 0.12; }' },
    });
    jungleMaterial(curtMat, shared, { translucent: 0.8 });
    instance(curtainGeo, curtMat, curtList, { shadow: false });

    // mushrooms (bioluminescent at night)
    const mushGeo = P.mushroomCluster(R('mush'), { count: 6 });
    const mushMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    jungleMaterial(mushMat, shared, { glowAttr: true, glowGain: 4.0, translucent: 0.3 });
    const mushList = [];
    const rmu = R('mushL');
    for (const lg of logs) for (let k = 0; k < 4; k++) {
      const along = rmu.range(-0.4, 0.4) * lg.len;
      const side = rmu.sign();
      mushList.push({ x: lg.x + Math.cos(lg.rot) * along + Math.sin(lg.rot) * side * lg.r0 * 0.7, y: lg.y + lg.r0 * 0.25, z: lg.z - Math.sin(lg.rot) * along + Math.cos(lg.rot) * side * lg.r0 * 0.7, s: rmu.range(2.4, 3.6), rot: rmu.next() * TAU, tiltZ: side * 0.5 });
    }
    for (const t of trees.slice(0, 3)) for (let k = 0; k < 3; k++) {
      const a = rmu.next() * TAU, r = t.def.opt.r0 * rmu.range(1.25, 1.9);
      const x = t.def.at[0] + Math.cos(a) * r, z = t.def.at[1] + Math.sin(a) * r;
      mushList.push({ x, y: L.groundH(x, z), z, s: rmu.range(2.6, 4.0), rot: rmu.next() * TAU });
    }
    for (let k = 0; k < 6; k++) {
      const b = boulderSpots[rmu.int(0, boulderSpots.length - 1)];
      const a = rmu.next() * TAU;
      const x = b.pos.x + Math.cos(a) * b.r * 1.6, z = b.pos.z + Math.sin(a) * b.r * 1.6;
      if (L.inPond(x, z, -0.05)) continue;
      mushList.push({ x, y: L.groundH(x, z), z, s: rmu.range(2.2, 3.4), rot: rmu.next() * TAU });
    }
    instance(mushGeo, mushMat, mushList, { shadow: false });
    // glow pods around the pond and in the foreground
    const podGeo = P.glowPods(R('pods'), { stems: 6 });
    const podList = [];
    for (let i = 0; i < Math.round(26 * Math.max(q, 0.6)); i++) {
      let x, z, guard = 0;
      do {
        if (i % 3 === 0) { x = camPos0.x + rmu.range(-6, 6); z = rmu.range(POND.cz + POND.rzFront, camPos0.z - 2.5); }
        else { const a = rmu.next() * TAU; x = POND.cx + Math.cos(a) * POND.rx * rmu.range(1.08, 1.35); z = POND.cz + Math.sin(a) * (Math.sin(a) < 0 ? POND.rzBack : POND.rzFront) * rmu.range(1.08, 1.35); }
      } while ((blocked(x, z, 0.1) || L.inPond(x, z, -0.1)) && guard++ < 20);
      if (guard >= 20) continue;
      podList.push({ x, y: L.groundH(x, z), z, s: rmu.range(0.9, 1.6), rot: rmu.next() * TAU });
    }
    instance(podGeo, mushMat, podList, { shadow: false });
    // glow light sources for night (strongest clusters)
    const glowSources = mushList.map(m => new THREE.Vector4(m.x, m.y + 0.3, m.z, 0.2 * m.s));
    glowFernList.forEach(f => glowSources.push(new THREE.Vector4(f.x, f.y + 0.4, f.z, 0.4 * f.s)));
    podList.forEach(f => glowSources.push(new THREE.Vector4(f.x, f.y + 0.6, f.z, 0.5 * f.s)));
    // the strongest lights go to sources the camera sees best (near, in front)
    glowSources.sort((a, b) => (camDist(a.x, a.z) - Math.abs(camAng(a.x, a.z)) * 4) - (camDist(b.x, b.z) - Math.abs(camAng(b.x, b.z)) * 4));
    for (let i = 0; i < GLOW_N; i++) if (glowSources[i]) shared.uGlowPts.value[i].copy(glowSources[i]);

    // lily pads and lotus
    const lilyGeo = P.lilyPad(atlas);
    const lilyMat = new THREE.MeshStandardMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45, envMapIntensity: 0.9 });
    addWind(lilyMat, wind, { height: 0.05, amount: 0.012, stiffness: 1, flutter: 0.004 });
    jungleMaterial(lilyMat, shared, { translucent: 0.4 });
    const rli = R('lily');
    const lilyList = [];
    const padSpots = [];
    for (let c = 0; c < 5; c++) {
      let cx, cz, guard = 0;
      do { const a = rli.next() * TAU, r = rli.range(0.35, 0.82); cx = POND.cx + Math.cos(a) * POND.rx * r; cz = POND.cz + Math.sin(a) * POND.rzFront * r; } while ((Math.hypot(cx - FALL.x, cz - (FALL.lipZ + 2)) < 4 || !L.inPond(cx, cz, 0.15)) && guard++ < 30);
      const n = rli.int(4, 8);
      for (let i = 0; i < n; i++) {
        const x = cx + rli.range(-1.1, 1.1), z = cz + rli.range(-0.8, 0.8);
        if (!L.inPond(x, z, 0.08)) continue;
        if (lilyList.some(l => Math.hypot(l.x - x, l.z - z) < (l.s + 0.3))) continue;
        const s = rli.range(0.22, 0.48);
        lilyList.push({ x, y: WATER_Y + 0.012, z, s, rot: rli.next() * TAU });
        if (s > 0.3) padSpots.push({ pos: new THREE.Vector3(x, WATER_Y + 0.02, z), r: s * 0.6, kind: 'pad' });
      }
    }
    instance(lilyGeo, lilyMat, lilyList, { shadow: false, mainOnly: true });
    const lotusGeos = [P.lotus(atlas, R('lot1'), { open: 0.7 }), P.lotus(atlas, R('lot2'), { open: 0.25, rect: 'petal' })];
    const lotusLeafGeo = P.lotusLeaf(atlas, R('lotl'));
    const lotusLists = [[], []], lotusLeafList = [];
    for (let i = 0; i < 6; i++) {
      const l = lilyList[rli.int(0, Math.max(0, lilyList.length - 1))];
      if (!l) break;
      const x = l.x + rli.range(-0.6, 0.6), z = l.z + rli.range(-0.6, 0.6);
      if (!L.inPond(x, z, 0.1)) continue;
      if (i < 3) lotusLists[i % 2].push({ x, y: WATER_Y, z, s: rli.range(1.0, 1.3), rot: rli.next() * TAU });
      else lotusLeafList.push({ x, y: WATER_Y, z, s: rli.range(0.9, 1.4), rot: rli.next() * TAU });
    }
    lotusGeos.forEach((g, i) => instance(g, foliageMat(WIND_LOW, { glowTint: true }), lotusLists[i], { shadow: false }));
    instance(lotusLeafGeo, foliageMat(WIND_LOW), lotusLeafList, { shadow: false });

    /* ---------------- canopy ---------------- */
    const clumpGeoA = buildClumpOnAtlas(atlas, 'foliage3', (seed % 1000) + 5, 10);
    const clumpGeoB = buildClumpOnAtlas(atlas, 'foliage', (seed % 1000) + 6, 9);
    const clumpMat = new THREE.MeshStandardMaterial({ map: atlas.texture, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.7, envMapIntensity: 0.5 });
    addWind(clumpMat, wind, { height: 2.0, amount: 0.12, stiffness: 1.2, flutter: 0.03 });
    jungleMaterial(clumpMat, shared, { translucent: 1.0 });
    const rc = R('canopy');
    const clumpsA = [], clumpsB = [];
    // limb ends of the big trees
    for (const t of trees) for (const lb of t.limbs) {
      for (let k = 0; k < 3; k++) {
        const p = lb.curve.getPointAt(rc.range(0.55, 1));
        clumpsB.push({ x: p.x + rc.range(-1.2, 1.2), y: p.y + rc.range(-0.4, 1.2), z: p.z + rc.range(-1.2, 1.2), s: rc.range(1.8, 3.0), rot: rc.next() * TAU });
      }
      const top = t.axis(t.def.opt.height);
      for (let k = 0; k < 4; k++) clumpsA.push({ x: top.x + rc.range(-3, 3), y: top.y + rc.range(-3, 1), z: top.z + rc.range(-3, 3), s: rc.range(3, 4.5), rot: rc.next() * TAU });
    }
    // ring around the clearing, high up (leaves a gap above the pond)
    for (let i = 0; i < Math.round(46 * Math.max(q, 0.6)); i++) {
      const a = rc.next() * TAU;
      const r = rc.range(13, 26);
      const x = POND.cx + Math.cos(a) * r, z = POND.cz - 2 + Math.sin(a) * r * 0.9;
      const y = rc.range(14, 23) + Math.max(0, -z - 10) * 0.25;
      if (Math.hypot(x - VIEW_TARGET.x, z - VIEW_TARGET.z) > 12 && Math.hypot(x - VIEW_TARGET.x, z - VIEW_TARGET.z) < 16 && y < 13) continue;
      clumpsA.push({ x, y, z, s: rc.range(3, 5.5), rot: rc.next() * TAU });
    }
    // over the camera: overhanging fronds at the top of the frame
    for (let i = 0; i < 10; i++) clumpsB.push({ x: rc.range(-12, 12), y: rc.range(13.5, 17), z: rc.range(6, 14), s: rc.range(2.5, 4), rot: rc.next() * TAU });
    // background crowns
    for (const p of bgTops) for (let k = 0; k < 4; k++) clumpsA.push({ x: p.x + rc.range(-2.8, 2.8), y: p.y + rc.range(-3, 0.5), z: p.z + rc.range(-2.8, 2.8), s: rc.range(2.6, 4.6), rot: rc.next() * TAU });
    // layered forest wall on the plateau, receding into the haze
    for (let i = 0; i < Math.round(40 * Math.max(q, 0.6)); i++) {
      const x = rc.range(-34, 34);
      const back = rc.range(4, 30);
      clumpsA.push({ x, y: L.cliffH(x) + rc.range(2, 7) + back * 0.18, z: L.cliffZ(x) - back, s: rc.range(3, 5.5), rot: rc.next() * TAU });
    }
    // plateau undergrowth (lower crowns along the rim)
    for (let i = 0; i < 26; i++) {
      const x = rc.range(-26, 26);
      if (Math.abs(x - FALL.x) < 2.5) continue;
      const back = rc.range(0.8, 6);
      clumpsB.push({ x, y: L.cliffH(x) + rc.range(0.2, 1.5), z: L.cliffZ(x) - back, s: rc.range(1.6, 3), rot: rc.next() * TAU });
    }
    const canopyA = instance(clumpGeoA, clumpMat, clumpsA, { shadow: false, mainOnly: true });
    const canopyB = instance(clumpGeoB, clumpMat, clumpsB, { shadow: false });

    /* ---------------- water ---------------- */
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const pond = buildPond(env, shared, L, { normal1: wN1, normal2: wN2, rtScale: q >= 0.9 ? 0.5 : q >= 0.6 ? 0.4 : 0.32 });
    scene.add(pond.mesh);
    const waterfall = buildWaterfall(shared, q);
    scene.add(waterfall);
    const plunge = new THREE.Vector3(FALL.x, WATER_Y, FALL.lipZ + 0.1 + 1.55 * fallT());
    const mist = buildMist(shared, puff, q, R('mist'), { count: 34, origin: plunge.clone().add(new THREE.Vector3(0, 0.1, 0.2)), spread: 1.8 });
    scene.add(mist);
    const splash = buildSplash(shared, sprite, q, R('splash'), { count: 280, origin: plunge.clone().add(new THREE.Vector3(0, 0, 0.1)) });
    scene.add(splash);
    pond.mesh.material.uniforms.uFall.value.set(plunge.x, plunge.z, 1, 0);

    /* ---------------- sky, lights, environment ---------------- */
    const sky = buildSky(shared);
    sky.renderOrder = 900; // after the opaque world so hidden sky pixels are never shaded
    scene.add(sky);
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.castShadow = env.shadows;
    const sm = q >= 0.9 ? 2048 : 1024;
    sun.shadow.mapSize.set(sm, sm);
    const sc = sun.shadow.camera;
    sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 1; sc.far = 150;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.05;
    sun.target.position.set(0, 2, -3);
    scene.add(sun, sun.target);
    const hemi = new THREE.HemisphereLight(0xbfd8c0, 0x2a3018, 0.6);
    scene.add(hemi);
    const envScene = new THREE.Scene();
    const envMat = new THREE.ShaderMaterial({
      uniforms: { uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uLow: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform vec3 uTop, uMid, uLow, uSunDir, uSunCol; varying vec3 vD;
        void main(){ vec3 d = normalize(vD); float h = d.y;
          vec3 c = h > 0.0 ? mix(uMid, uTop, smoothstep(0.05, 0.7, h)) : mix(uMid, uLow, smoothstep(0.0, 0.4, -h));
          c += uSunCol * pow(max(dot(d, uSunDir), 0.0), 24.0) * 2.0;
          gl_FragColor = vec4(c, 1.0); }`,
      side: THREE.BackSide,
    });
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 24, 12), envMat));
    let envRT = null, envKey = '';

    /* ---------------- atmosphere fx ---------------- */
    // god-ray ground spots: the shader shows each one only while the canopy above it is open
    const rayAnchors = [];
    {
      const rr3 = R('rays0');
      for (let i = 0; i < Math.round(38 * Math.max(q, 0.6)); i++) {
        let x, z, guard = 0;
        do { x = rr3.range(-13, 15); z = rr3.range(-9, 7); } while ((rayAnchors.some(r => Math.hypot(r.x - x, r.z - z) < 2.0) || camDist(x, z) < 6) && guard++ < 30);
        const y = Math.max(L.groundH(x, z), WATER_Y) + 0.2;
        const broad = L.pondD(x, z) < 1.1 && rr3.chance(0.5);
        rayAnchors.push(Object.assign(new THREE.Vector4(x, y, z, broad ? rr3.range(1.4, 2.4) : rr3.range(0.6, 1.5)), { len: rr3.range(24, 32), k: broad ? rr3.range(0.4, 0.6) : rr3.range(0.55, 1.0) }));
      }
    }
    const godRays = ONLY_MAIN(buildGodRays(shared, rayAnchors, R('rays')));
    scene.add(godRays);
    const rm = R('motes');
    const motePos = [];
    for (let i = 0; i < Math.round(320 * q); i++) motePos.push(new THREE.Vector3(rm.range(-14, 14), rm.range(0.3, 10), rm.range(-10, 9)));
    const motes = ONLY_MAIN(buildPoints(shared, sprite, 'motes', motePos, rm, [0.03, 0.07]));
    scene.add(motes);
    const ffPos = [];
    for (let i = 0; i < Math.round(140 * q); i++) {
      const x = rm.range(-15, 15), z = rm.range(-9, 10);
      ffPos.push(new THREE.Vector3(x, Math.max(L.groundH(x, z), WATER_Y) + rm.range(0.4, 3.2), z));
    }
    const fireflies = buildPoints(shared, sprite, 'fireflies', ffPos, rm, [0.06, 0.12]);
    scene.add(fireflies);
    const spPos = [];
    for (let i = 0; i < Math.round(220 * q); i++) {
      const g = glowSources[rm.int(0, glowSources.length - 1)];
      spPos.push(new THREE.Vector3(g.x + rm.range(-1.2, 1.2), g.y - 0.1, g.z + rm.range(-1.2, 1.2)));
    }
    const spores = buildPoints(shared, sprite, 'spores', spPos, rm, [0.025, 0.05]);
    scene.add(spores);
    const rain = ONLY_MAIN(buildRain(shared, q, R('rain'), new THREE.Vector3(0, 0, -1)));
    scene.add(rain);
    const mistSheets = ONLY_MAIN(buildMistSheets(shared, R('ms'), [
      { x: POND.cx, y: WATER_Y + 0.5, z: POND.cz, w: 16, d: 12 },
      { x: POND.cx - 2, y: 1.4, z: POND.cz - 3, w: 26, d: 10 },
      { x: 0, y: 3.2, z: -9, w: 40, d: 12 },
      { x: 0, y: 6.5, z: -14, w: 50, d: 14 },
    ]));
    scene.add(mistSheets);

    /* ---------------- fish (ambient) ---------------- */
    const fishGeo = buildFishGeometry('koi', { detail: q > 0.8 ? 1 : 0.6 });
    const fishSets = [['ogon', 3], ['chagoi', 4], ['asagi', 3]].map(([variety, n], k) => {
      const painted = paintFish('koi', { seed: (seed % 1000) + 90 + k, variety, size: [512, 256] });
      const mat = createFishMaterial(painted, { roughness: 0.4 });
      jungleMaterial(mat, shared, { caustics: true, glowLight: false });
      const inst = new FishInstances(fishGeo, mat, n);
      ONLY_MAIN(inst.mesh);
      scene.add(inst.mesh);
      owned.push(painted.map);
      const rf = R('fish' + k);
      const fish = [];
      for (let i = 0; i < n; i++) {
        let x, z, guard = 0;
        do { x = POND.cx + rf.range(-4, 4); z = POND.cz + rf.range(-2.5, 3); } while (!L.inPond(x, z, 0.5) && guard++ < 40);
        const sw = new Swimmer({ pos: new THREE.Vector3(x, WATER_Y - 0.4, z), size: rf.range(0.22, 0.32), speed: 0.25, rng: rf });
        sw.home = new THREE.Vector3(x, 0, z); sw.wanderT = 0; sw.goal = sw.pos.clone(); sw.nibbleT = rf.range(1, 3);
        fish.push(sw);
      }
      return { inst, fish };
    });
    fishGeo.dispose();

    /* ---------------- residents ---------------- */
    const members = env.members;
    const fruits = new FruitSystem(shared, 8, env.shadows);
    fruits.meshes.forEach(m => scene.add(m));
    // spots for frogs & butterflies
    const frogSpots = [...padSpots, ...boulderSpots.filter(b => b.pos.y > WATER_Y + 0.05 && b.r < 0.7), ...logSpots];
    for (let i = 0; i < 14; i++) {
      const a = rp.next() * TAU;
      const x = POND.cx + Math.cos(a) * POND.rx * 1.12, z = POND.cz + Math.sin(a) * (Math.sin(a) < 0 ? POND.rzBack : POND.rzFront) * 1.12;
      if (z < FALL.lipZ + 3) continue;
      frogSpots.push({ pos: new THREE.Vector3(x, L.groundH(x, z), z), r: 0.3, kind: 'ground' });
    }
    frogSpots.forEach(s => { s.camD = s.pos.distanceTo(camPos0); s.visible = (s.kind === 'pad' || s.kind === 'rock' || s.kind === 'log') && Math.abs(camAng(s.pos.x, s.pos.z)) < 0.45 && s.camD > 6 && s.camD < 12.5; });
    const frogKit = createFrogMesh(shared, 16, env.shadows);
    ONLY_MAIN(frogKit.mesh);
    scene.add(frogKit.mesh);
    const macawKit = await loadMacawKit(env, shared);
    const butterflyKit = createButterflyMesh(shared, 24, makeWingAtlas());
    owned.push(butterflyKit.mesh.material.uniforms.tWings.value);
    scene.add(butterflyKit.mesh);
    const dragonKit = createDragonflyMesh(shared, 6);
    scene.add(dragonKit.mesh);
    const rd = R('dragon');
    const dragonflies = [];
    const dfCols = [[0.75, 0.08, 0.05], [0.08, 0.35, 0.85], [0.1, 0.55, 0.3], [0.7, 0.1, 0.25], [0.1, 0.4, 0.8]];
    for (let i = 0; i < Math.round(5 * Math.max(q, 0.6)); i++) {
      dragonflies.push(new Dragonfly(rd, { x0: POND.cx - 5, x1: POND.cx + 5, y0: WATER_Y + 0.3, y1: 1.6, z0: POND.cz - 2.5, z1: POND.cz + 3.5 }));
      const c = dfCols[i % dfCols.length];
      dragonKit.col.setXYZW(i, c[0], c[1], c[2], rd.next());
    }
    dragonKit.col.needsUpdate = true;
    dragonKit.mesh.count = dragonflies.length;

    // perches for macaws: limb perches facing the clearing + cliff rim spots
    const perches = [];
    for (const p of lowPerches) perches.push({ pos: p.pos.clone(), face: new THREE.Vector3(camPos0.x - p.pos.x, 0, camPos0.z - p.pos.z).normalize(), taken: null, low: true });
    for (const t of trees.slice(0, 4)) for (const p of t.perches) {
      if (p.pos.y < 3.5 || p.pos.y > 11 || Math.abs(camAng(p.pos.x, p.pos.z)) > 0.62) continue;
      const face = new THREE.Vector3(VIEW_TARGET.x - p.pos.x, 0, VIEW_TARGET.z + 8 - p.pos.z).normalize();
      perches.push({ pos: p.pos.clone(), face, taken: null });
    }
    for (let i = 0; i < 6; i++) {
      const x = rp.range(-12, 12);
      if (Math.abs(x - FALL.x) < 2) continue;
      const p = new THREE.Vector3(x, L.cliffH(x) + 0.15, L.cliffZ(x) + 0.2);
      perches.push({ pos: p, face: new THREE.Vector3(0, 0, 1), taken: null, rim: true });
    }
    perches.forEach(p => { p.camD = p.pos.distanceTo(camPos0); });

    const frogs = [], macaws = [], butterflies = [];
    const wf = R('flutter');
    const homeB = new THREE.Vector3(POND.cx, 1.6, POND.cz + 3);

    class Frog {
      constructor(member) {
        this.member = member;
        this.rng = R('frog' + member.id);
        let free = frogSpots.filter(s => !s.taken && s.visible);
        if (!free.length) free = frogSpots.filter(s => !s.taken);
        this.spot = free.length ? free[this.rng.int(0, free.length - 1)] : frogSpots[0];
        this.spot.taken = this;
        this.pos = this.spot.pos.clone();
        this.yaw = Math.atan2(camPos0.x - this.pos.x, camPos0.z - this.pos.z) + this.rng.range(-0.8, 0.8);
        this.state = 'sit'; this.timer = this.rng.range(3, 10);
        this.leap = 0; this.throat = 0; this.tongue = 0; this.breath = 0;
        this.callT = this.rng.range(1, 6); this.call = 0;
        this.hop = null; this.food = null; this.flicks = 0; this.flickT = 0;
        this.swim = false;
      }
      get scale() { return 0.36 * (0.85 + 0.15 * (this.member.size || 1)); }
      hopTo(target, spot = null) {
        const from = this.pos.clone();
        const dist = from.distanceTo(target);
        this.hop = { from, to: target.clone(), t: 0, dur: 0.32 + dist * 0.12, h: 0.18 + dist * 0.28, spot };
        this.yaw = Math.atan2(target.x - from.x, target.z - from.z);
        this.state = 'hop';
        if (this.spot) { this.spot.taken = null; this.spot = null; }
      }
      update(dt, t) {
        const r = this.rng;
        this.breath = 0.5 + 0.5 * Math.sin(t * 2.4 + this.member.seed);
        // calling (throat pulses) — more often at night
        this.callT -= dt;
        if (this.callT <= 0 && this.state === 'sit') { this.call = 1.2; this.callT = r.range(night > 0.5 ? 3 : 8, night > 0.5 ? 9 : 22); }
        if (this.call > 0) { this.call -= dt; this.throat = Math.max(0, Math.sin((1.2 - this.call) * 18)) * 0.9; } else this.throat = damp(this.throat, 0, 10, dt);
        if (this.state === 'sit') {
          this.leap = damp(this.leap, 0, 12, dt);
          this.timer -= dt;
          const f = this.food && !this.food.dead && this.food.bites > 0 ? this.food : null;
          if (!f) this.food = null;
          if (f) {
            const d = Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z);
            if (d < 0.55 && f.pos.y - this.pos.y < 1.0 && f.pos.y - this.pos.y > -0.6) { this.state = 'eat'; this.flicks = 0; this.flickT = 0.3; this.yaw = Math.atan2(f.pos.x - this.pos.x, f.pos.z - this.pos.z); }
            else if (this.timer <= 0) this.stepToward(f.pos);
          } else if (this.timer <= 0 || (this.foodT = (this.foodT ?? 1) - dt) <= 0) {
            this.foodT = 1.5;
            const food = findFoodFor(this);
            if (food) { this.food = food; food.claims.push(this); this.timer = 0.2; }
            else if (this.timer <= 0) this.wander();
          }
        } else if (this.state === 'hop') {
          const H = this.hop;
          H.t += dt / H.dur;
          const tt = Math.min(H.t, 1);
          this.pos.lerpVectors(H.from, H.to, tt);
          this.pos.y += 4 * H.h * tt * (1 - tt);
          this.leap = Math.pow(Math.sin(Math.PI * Math.min(tt * 1.15, 1)), 0.6);
          if (H.t >= 1) {
            this.pos.copy(H.to);
            this.leap = 0.3;
            if (H.spot) { this.spot = H.spot; H.spot.taken = this; }
            if (H.to.y <= WATER_Y + 0.05) pond.addRipple(H.to.x, H.to.z, 0.6, shared.uTime.value);
            this.swim = L.inPond(H.to.x, H.to.z, 0.02) && !(H.spot && H.spot.kind === 'pad');
            this.state = this.swim ? 'swim' : 'sit';
            this.timer = this.food ? 0.25 : r.range(4, 14);
            this.hop = null;
          }
        } else if (this.state === 'swim') {
          // paddle toward the next goal on the surface
          const g = this.swimGoal || this.pos;
          _v.subVectors(g, this.pos); _v.y = 0;
          const d = _v.length();
          this.pos.y = WATER_Y - 0.04;
          this.leap = 0.5 + 0.5 * Math.sin(t * 7);
          if (d > 0.05) { this.yaw = dampAngle(this.yaw, Math.atan2(_v.x, _v.z), 4, dt); this.pos.addScaledVector(_v.normalize(), Math.min(d, 0.45 * dt)); }
          if (Math.random() < dt * 1.5) pond.addRipple(this.pos.x, this.pos.z, 0.25, shared.uTime.value);
          if (d < 0.3 || !this.swimGoal) { this.state = 'sit'; this.swim = !this.swimGoal || L.inPond(this.pos.x, this.pos.z, 0.02); this.timer = 0.2; }
          if (this.swimGoal && !L.inPond(this.pos.x, this.pos.z, 0.0)) { this.pos.y = L.groundH(this.pos.x, this.pos.z); this.state = 'sit'; this.swim = false; this.swimGoal = null; this.timer = 0.3; }
        } else if (this.state === 'eat') {
          const f = this.food;
          if (!f || f.dead || f.bites <= 0) { this.state = 'sit'; this.food = null; this.timer = r.range(2, 5); this.tongue = 0; }
          else {
            this.yaw = dampAngle(this.yaw, Math.atan2(f.pos.x - this.pos.x, f.pos.z - this.pos.z), 8, dt);
            this.flickT -= dt;
            if (this.flickT <= 0 && this.flickT > -0.28) this.tongue = Math.sin((-this.flickT / 0.28) * Math.PI) * clamp(Math.hypot(f.pos.x - this.pos.x, f.pos.z - this.pos.z) / (this.scale * 0.95), 0.2, 1);
            else this.tongue = 0;
            if (this.flickT <= -0.14 && !this.bit) { this.bit = true; bite(this, f); }
            if (this.flickT <= -0.28) { this.flickT = r.range(0.9, 1.6); this.flicks++; this.bit = false; if (this.flicks >= r.int(3, 5)) { this.state = 'sit'; this.food = null; this.timer = r.range(3, 8); } }
          }
        }
      }
      stepToward(target) {
        _v.subVectors(target, this.pos); _v.y = 0;
        const d = _v.length();
        const stepLen = Math.min(d - 0.32, 1.5);
        if (stepLen < 0.05) { this.timer = 0.3; return; }
        _v.normalize();
        const x = this.pos.x + _v.x * stepLen, z = this.pos.z + _v.z * stepLen;
        const pad = padSpots.find(p => Math.hypot(p.pos.x - x, p.pos.z - z) < 0.5 && !p.taken);
        if (pad) this.hopTo(pad.pos, pad);
        else if (L.inPond(x, z, 0.02)) { this.swimGoal = target.clone(); this.hopTo(new THREE.Vector3(x, WATER_Y - 0.04, z)); }
        else {
          const y = Math.max(L.groundH(x, z), target.y - 0.02 > L.groundH(x, z) && d < 1.6 ? target.y - 0.05 : L.groundH(x, z));
          this.hopTo(new THREE.Vector3(x, y, z));
        }
      }
      wander() {
        const hungry = env.fullness(this.member) < 0.3;
        const r = this.rng;
        let cands = frogSpots.filter(s => !s.taken && s.pos.distanceTo(this.pos) < (hungry ? 6 : 3.2) && s.pos.distanceTo(this.pos) > 0.3);
        if (cands.some(s => s.visible) && r.chance(0.75)) cands = cands.filter(s => s.visible);
        if (hungry) cands = cands.filter(s => s.camD < this.pos.distanceTo(camPos0) + 0.5);
        if (!cands.length || r.chance(0.25)) {
          // just turn around on the spot (small hop in place)
          this.yaw += r.range(-1.2, 1.2);
          this.timer = r.range(4, 10);
          return;
        }
        const s = cands[r.int(0, cands.length - 1)];
        const d = s.pos.distanceTo(this.pos);
        if (d > 1.7 || (this.swim && s.kind !== 'pad')) {
          if (L.inPond(s.pos.x, s.pos.z, 0.02) || this.swim) { this.swimGoal = s.pos.clone(); this.state = 'swim'; if (this.spot) { this.spot.taken = null; this.spot = null; } return; }
          this.stepToward(s.pos); return;
        }
        this.hopTo(s.pos, s);
      }
      write(i) {
        const s = this.scale;
        _e.set(this.state === 'hop' ? -0.35 * Math.sin(Math.PI * this.hop.t) : 0, this.yaw, 0, 'YXZ');
        _q.setFromEuler(_e);
        _m4.compose(this.pos, _q, _s.setScalar(s));
        frogKit.mesh.setMatrixAt(i, _m4);
        frogKit.pose.setXYZW(i, this.leap, this.throat, this.tongue, this.breath);
      }
    }
    const dampAngle = (a, b, l, dt) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * (1 - Math.exp(-l * dt));

    const findFoodFor = (c) => {
      const list = fruits.alive();
      if (!list.length) return null;
      const hungry = c.member ? env.fullness(c.member) < 0.75 : false;
      let best = null, bd = Infinity;
      for (const f of list) {
        if (f.heldBy) continue;
        const d = f.pos.distanceTo(c.pos);
        const claims = f.claims.filter(x => x.food === f).length;
        if (c instanceof Frog) {
          if (claims >= 2 || d > 9) continue;
          if (f.state === 'float' && !hungry && d > 4) continue;
        }
        if (d < bd) { bd = d; best = f; }
      }
      return best;
    };
    const bite = (c, f, amount = 1) => {
      if (!f || f.dead || f.bites <= 0) return;
      fruits.bite(f, amount);
      const pos = c.member ? f.pos.clone().add(_v.set(0, 0.25, 0)) : f.pos;
      env.onEat(c.member || null, pos);
      if (f.state === 'float') pond.addRipple(f.pos.x, f.pos.z, 0.3, shared.uTime.value);
    };
    const butterflyCtx = {
      pickTarget(b, out) {
        const hungry = b.member && env.fullness(b.member) < 0.3;
        if (!b.food) { const f = findFoodFor(b); if (f && (hungry || wf.chance(0.6))) { const claims = f.claims.filter(x => x.food === f).length; if (claims < 4) { b.food = f; f.claims.push(b); return; } } }
        if (wf.chance(0.18)) {
          const spots = [...boulderSpots.filter(s => s.pos.y > WATER_Y + 0.1), ...logSpots];
          const s = spots[wf.int(0, spots.length - 1)];
          b.restSpot = s.pos.clone().add(_v.set(wf.range(-0.1, 0.1), 0.02, wf.range(-0.1, 0.1)));
          out.copy(b.restSpot);
          return;
        }
        if (hungry) out.set(camera.position.x * 0.55 + wf.range(-2.5, 2.5), wf.range(1.2, 3.2), lerp(VIEW_TARGET.z, camera.position.z, 0.62) + wf.range(-1.5, 1.5));
        else if (b.kind === 0) out.set(POND.cx + wf.range(-5, 5), wf.range(0.9, 3.6), POND.cz + wf.range(-1, 6.5));
        else out.set(POND.cx + wf.range(-8, 8), wf.range(0.6, 4.5), POND.cz + wf.range(-5, 7));
      },
      foodTarget(b, out) {
        const f = b.food;
        if (f.heldBy) { b.food = null; b.state = 'fly'; b.timer = 0; out.copy(b.pos).add(_v.set(0, 1, 0)); return; }
        const k = (butterflies.indexOf(b) * 2.4) % TAU;
        out.copy(f.pos).add(_v.set(Math.cos(k) * f.r * 0.5 * f.fade, f.r * 1.6 * (0.5 + 0.5 * f.bites / f.maxBites), Math.sin(k) * f.r * 0.5));
      },
      hasFoodFor(b) { if (b.food) return true; const f = findFoodFor(b); if (f && b.member && env.fullness(b.member) < 0.6) { b.food = f; f.claims.push(b); return true; } return false; },
      bite: (b, f) => bite(b, f),
    };
    const macawCtx = {
      wantsFood(m) {
        const f = fruits.alive().find(f => !f.heldBy && !macaws.some(o => o.target === f));
        return !!f && (env.fullness(m.member) < 0.6 || wf.chance(0.35));
      },
      decide(m) {
        const hungry = env.fullness(m.member) < 0.3;
        const f = fruits.alive().find(f => !f.heldBy && !macaws.some(o => o.target === f));
        if (f && (hungry || wf.chance(0.7))) {
          m.target = f;
          const land = f.pos.clone().add(_v.set(0, f.state === 'float' ? 0.35 : 0.12, 0));
          m.flyTo(land, { land: true, speed: 6, arrive: mm => { mm.state = 'grab'; mm.timer = 0.8; if (f.state === 'float') pond.addRipple(f.pos.x, f.pos.z, 0.8, shared.uTime.value); } });
          return;
        }
        if (wf.chance(0.25)) {
          // scenic pass across the clearing, then back to a perch
          const p = choosePerch(m);
          const mid = new THREE.Vector3(wf.range(-6, 6), wf.range(5, 9), wf.range(-6, 2));
          m.flyTo(mid, { land: false, speed: 6.5, arrive: mm => { mm.flyTo(p.pos, { land: true, arrive: m3 => m3.placeAt(p) }); p.taken = mm; } });
          return;
        }
        const p = choosePerch(m);
        p.taken = m;
        m.flyTo(p.pos, { land: true, arrive: mm => mm.placeAt(p) });
      },
      afterGrab(m) {
        const f = m.target;
        m.target = null;
        if (f && !f.dead && f.bites > 0 && !f.heldBy) { f.heldBy = m; m.carry = f; f.state = 'held'; m.biteT = 1.2; }
        const p = choosePerch(m);
        p.taken = m;
        m.flyTo(p.pos, { land: true, speed: 5, arrive: mm => mm.placeAt(p) });
      },
      bite: (m, f) => { bite(m, f); if (f.bites <= 0) { f.heldBy = null; } },
    };
    const choosePerch = (m) => {
      const hungry = env.fullness(m.member) < 0.3;
      let free = perches.filter(p => !p.taken || p.taken === m);
      if (hungry) { free.sort((a, b) => a.camD - b.camD); free = free.slice(0, Math.max(2, Math.ceil(free.length / 3))); }
      return free.length ? free[wf.int(0, free.length - 1)] : perches[0];
    };

    const spawnMember = (member) => {
      if (member.kind === 'frog') frogs.push(new Frog(member));
      else if (member.kind === 'macaw') {
        const m = new Macaw(macawKit, member, R('macaw' + member.id), { shadows: env.shadows });
        const free = perches.filter(p => !p.taken);
        m.placeAt(free.length ? free[R('mp' + member.id).int(0, free.length - 1)] : perches[0]);
        m.timer = m.rng.range(3, 12);
        scene.add(m.mesh);
        macaws.push(m);
      } else if (member.kind === 'morpho') {
        butterflies.push(new Butterfly(member, 0, R('bf' + member.id), homeB));
      }
    };
    members.forEach(spawnMember);
    // ambient butterflies (heliconius, sulphur, extra morphos)
    const ra = R('ambBf');
    for (let i = 0; i < Math.round(5 * Math.max(q, 0.6)); i++) butterflies.push(new Butterfly(null, [1, 2, 0, 1, 2][i % 5], ra.fork(i), homeB));

    /* ---------------- feeding ---------------- */
    const rcast = new THREE.Raycaster();
    rcast.layers.enableAll();
    const feedTargets = [terrain, ...boulders, ...logs.map(l => l.mesh)];
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_Y);
    const rfood = R('food');
    const dropFruit = (pt, onWater) => {
      const kind = rfood.int(0, FRUIT_KINDS.length - 1);
      const f = fruits.spawn(kind, pt, onWater, rfood);
      env.sfx('drop');
      return f;
    };
    const fruitHooks = {
      splash: f => { pond.addRipple(f.pos.x, f.pos.z, 1.2, shared.uTime.value); env.sfx('splash'); },
      thud: f => env.sfx('thud'),
      drift: (f, dt) => {
        // stay inside the pond, drift gently away from the plunge
        _v.set(f.pos.x - plunge.x, 0, f.pos.z - plunge.z);
        const d = _v.length();
        if (d < 4) f.vel.addScaledVector(_v.normalize(), dt * 0.25 * (4 - d));
        if (!L.inPond(f.pos.x + f.vel.x * 0.5, f.pos.z + f.vel.z * 0.5, 0.25)) f.vel.multiplyScalar(-0.5);
        f.vel.x += Math.sin(shared.uTime.value * 0.3 + f.bob) * 0.01 * dt;
      },
      held: f => {
        const m = f.heldBy;
        if (!m) return;
        m.beak(f.pos);
      },
    };

    /* ---------------- view + post ---------------- */
    const view = {
      target: VIEW_TARGET.clone(),
      dist: 14, distRange: [6.5, 19],
      yaw: 0, yawRange: [-0.9, 0.9],
      pitch: VIEW_PITCH, pitchRange: [0.04, 0.5],
      drift: 0.03, idlePitch: VIEW_PITCH, idleDist: 14,
      fov: 50, minY: 0.7,
    };
    const post = {
      bloom: { strength: 0.35, radius: 0.7, threshold: 0.85 },
      exposure: 1.0, toneMapping: 'aces',
      vignette: 0.45, grain: 0.03, saturation: 1.08, contrast: 1.06,
      lift: [0, 0.008, 0.012], gain: [1, 1, 1], ca: 0.0012,
      tilt: { amount: 0.22, center: 0.52, width: 0.3 },
    };

    /* ---------------- time of day ---------------- */
    let night = 0;
    const lightCol = new THREE.Color();
    const state = { lastH: -1, wet: 0 };
    const pal = {
      fogDay: new THREE.Color('#86ad97'), fogDawn: new THREE.Color('#a9b9b3'), fogGold: new THREE.Color('#7f8c78'), fogDusk: new THREE.Color('#4f5a82'), fogNight: new THREE.Color('#0b1d29'), fogRain: new THREE.Color('#6d8077'),
      hemiSkyDay: new THREE.Color('#bcd6c4'), hemiGround: new THREE.Color('#2b3a1c'), hemiSkyNight: new THREE.Color('#1d4258'), hemiGroundNight: new THREE.Color('#0a1712'),
      moon: new THREE.Color('#9fbcff'), murkDay: new THREE.Color('#2c6a52'), murkNight: new THREE.Color('#06222b'),
      rainAmb: new THREE.Color('#9aa8a2'), zenTint: new THREE.Color('#3e6f8a'), zenNight: new THREE.Color('#071622'), zenRain: new THREE.Color('#7d8a88'),
      scatter: new THREE.Color('#1b5a49'), scatterRain: new THREE.Color('#3a5a50'), murkRain: new THREE.Color('#20403a'),
      envGreen: new THREE.Color('#3d6a3a'), envLow: new THREE.Color('#1d2414'), envLowNight: new THREE.Color('#05090b'),
    };
    function applyTime(dt, force) {
      const h = env.hours();
      const s = env.sun({ latitude: LATITUDE, azimuthOffset: SUN_AZ });
      const rainA = rainAmount(h);
      const wetT = wetAmount(h);
      state.wet = force ? wetT : damp(state.wet, wetT, 0.5, dt);
      const e = s.elevationDeg;
      const day = s.day, golden = s.golden;
      night = smoothstep(-1, -9, e);
      const dusk = smoothstep(4, -2, e) * (1 - night);
      const morning = h < 12;
      const dawnMist = morning ? smoothstep(-6, 2, e) * (1 - smoothstep(10, 26, e)) : 0;
      // light: sun by day, moon by night
      const useMoon = e < -3;
      const L0 = useMoon ? s.moonDir : s.dir;
      shared.uLightDirW.value.copy(L0);
      let li;
      const lc = lightCol;
      if (useMoon) { lc.copy(pal.moon); li = 0.55 * smoothstep(-3, -10, e); }
      else { lc.copy(s.sunColor); li = s.sunIntensity * 1.9; }
      li *= 1 - rainA * 0.82;
      sun.color.copy(lc);
      sun.intensity = li;
      shared.uLightCol.value.copy(lc).multiplyScalar(li);
      sun.position.copy(sun.target.position).addScaledVector(L0, 70);
      // ambient
      hemi.color.copy(pal.hemiSkyDay).lerp(s.skyAmbient, 0.35).lerp(pal.hemiSkyNight, night).lerp(pal.rainAmb, rainA * 0.5);
      hemi.groundColor.copy(pal.hemiGround).lerp(pal.hemiGroundNight, night);
      hemi.intensity = lerp(s.ambientIntensity * 1.05, 0.5, night) + rainA * 0.25 + dawnMist * 0.1;
      const amb = _c2.copy(hemi.color).multiplyScalar(hemi.intensity * 0.8);
      // fog
      const fog = shared.uFogColor.value;
      fog.copy(pal.fogDay).lerp(pal.fogGold, golden * (morning ? 0.4 : 0.85)).lerp(pal.fogDawn, dawnMist * 0.8).lerp(pal.fogDusk, dusk).lerp(pal.fogNight, night).lerp(pal.fogRain, rainA * (1 - night * 0.7));
      fog.multiplyScalar(lerp(1, 0.75, rainA * (1 - night)));
      shared.uFogSunColor.value.copy(lc).multiplyScalar(Math.min(li, 3) * (0.3 + golden * 0.55)).add(_c.copy(fog).multiplyScalar(0.8));
      shared.uFogDensity.value = 0.011 + dawnMist * 0.018 + rainA * 0.026 + night * 0.01 + dusk * 0.008 - golden * (morning ? 0 : 0.003);
      shared.uFogFalloff.value = lerp(0.09, 0.22, dawnMist);
      shared.uCookieMin.value = lerp(lerp(0.17, 0.3, night), 0.75, rainA);
      shared.uWaterScatter.value.copy(pal.scatter).multiplyScalar(lerp(0.5 + day * 0.7, 0.12, night)).lerp(pal.scatterRain, rainA * 0.3);
      shared.uNight.value = smoothstep(-2, -10, e);
      shared.uWet.value = state.wet;
      shared.uCaustic.value = (1 - rainA * 0.8) * lerp(1, 0.35, night);
      // sky
      const su = sky.material.uniforms;
      su.uZenith.value.copy(s.zenith).lerp(pal.zenTint, 0.15 * day).lerp(pal.zenNight, night * 0.6).lerp(pal.zenRain, rainA * day);
      su.uHorizon.value.copy(s.horizon).lerp(fog, 0.35);
      su.uSunDir.value.copy(s.dir); su.uSunCol.value.copy(s.sunColor).multiplyScalar(s.sunIntensity * 0.5);
      su.uMoonDir.value.copy(s.moonDir); su.uOvercast.value = rainA; su.uDay.value = day;
      // water, waterfall, mist
      const wu = pond.mesh.material.uniforms;
      wu.uAmb.value.copy(amb);
      wu.uMurk.value.copy(pal.murkDay).lerp(pal.murkNight, night);
      wu.uRain.value = rainA;
      wu.uCalm.value = 0.2 + rainA * 0.15;
      wu.uMurkAmt.value = 0.12 + rainA * 0.2;
      wu.uMurk.value.lerp(pal.murkRain, rainA * 0.6);
      wu.uReflBoost.value = 1 - rainA * 0.35;
      waterfall.material.uniforms.uAmb.value.copy(amb);
      waterfall.material.uniforms.uMoon.value = night * (1 - rainA * 0.6);
      mist.material.uniforms.uAmb.value.copy(amb);
      mist.material.uniforms.uDensity.value = 1 + rainA * 0.5 + dawnMist * 0.4;
      splash.material.uniforms.uAmb.value.copy(amb);
      // fx
      const ru = godRays.material.uniforms;
      ru.uRayCol.value.copy(lc).multiplyScalar(useMoon ? 0.26 : (0.075 + golden * 0.12 + dawnMist * 0.06) * Math.min(li, 4));
      ru.uRayAmt.value = (1 - rainA * 0.85) * (useMoon ? smoothstep(-4, -12, e) : smoothstep(0, 8, e));
      godRays.visible = ru.uRayAmt.value > 0.01;
      motes.material.uniforms.uAmt.value = (0.35 + day * 0.65) * (1 - rainA) * (1 - night * 0.7);
      motes.material.uniforms.uAmb.value.copy(amb);
      fireflies.material.uniforms.uAmt.value = smoothstep(2, -5, e) * (1 - rainA * 0.85);
      spores.material.uniforms.uAmt.value = shared.uNight.value * (1 - rainA * 0.5);
      rain.material.uniforms.uRain.value = rainA;
      rain.visible = rainA > 0.002;
      fireflies.visible = fireflies.material.uniforms.uAmt.value > 0.01;
      spores.visible = spores.material.uniforms.uAmt.value > 0.01;
      motes.visible = motes.material.uniforms.uAmt.value > 0.01;
      rain.material.uniforms.uAmb.value.copy(amb);
      mistSheets.material.uniforms.uAmt.value = clamp(dawnMist * 0.8 + rainA * 0.18 + night * 0.3 + dusk * 0.25 + 0.03, 0, 0.95);
      mistSheets.material.uniforms.uAmb.value.copy(amb);
      // environment map (re-filtered when the light changes noticeably)
      const key = Math.round(h * 4) + ':' + Math.round(rainA * 4);
      if (key !== envKey) {
        envKey = key;
        const eu = envMat.uniforms;
        eu.uTop.value.copy(su.uZenith.value).lerp(fog, 0.3).multiplyScalar(lerp(1.0, 0.5, night));
        eu.uMid.value.copy(fog).lerp(pal.envGreen, 0.55 * (1 - night)).multiplyScalar(0.8);
        eu.uLow.value.copy(pal.envLow).lerp(pal.envLowNight, night);
        eu.uSunDir.value.copy(L0); eu.uSunCol.value.copy(lc).multiplyScalar(li * 0.12);
        const old = envRT;
        envRT = env.pmrem.fromScene(envScene, 0.02, 0.1, 100);
        scene.environment = envRT.texture;
        if (old) old.dispose();
      }
      // post
      const b = post.bloom;
      b.strength = lerp(0.32 + golden * 0.12, 0.95, night) * (1 - rainA * 0.25);
      b.radius = lerp(0.65, 0.85, night);
      b.threshold = lerp(0.85, 0.42, night);
      post.exposure = lerp(1.06, 1.18, night) * lerp(1, 1.06, rainA) * lerp(1, 1.05, dawnMist);
      post.saturation = lerp(lerp(1.14, 1.15, night), 0.88, rainA);
      post.contrast = lerp(1.1, 1.1, night) - rainA * 0.05;
      post.lift = [lerp(0.0, 0.0, night), lerp(0.008, 0.02, night), lerp(0.012, 0.045, night)];
      const warm = golden * (morning ? 0.4 : 1);
      post.gain = [lerp(1 + warm * 0.06, 0.86, night), lerp(1, 0.97, night), lerp(1 - warm * 0.08, 1.1, night)];
    }

    /* ---------------- update ---------------- */
    let simT = 0;
    const floating = [];
    const fishGoal = new THREE.Vector3();
    function update(dt, t) {
      if (compileRTLive && simT > 0) {
        compileRTLive = false;
        if (renderer.getRenderTarget() === compileRT) renderer.setRenderTarget(null);
        compileRT.dispose();
      }
      simT += dt;
      shared.uTime.value = t;
      shared.uCookieDrift.value.set(Math.sin(t * 0.05) * 0.004, Math.cos(t * 0.043) * 0.004);
      wind.update(dt);
      applyTime(dt, simT < 0.2);
      // fruit
      fruits.update(dt, t, fruitHooks);
      // frogs
      frogs.forEach((f, i) => { f.update(dt, t); f.write(i); });
      frogKit.mesh.count = frogs.length;
      frogKit.mesh.instanceMatrix.needsUpdate = true;
      frogKit.pose.needsUpdate = true;
      // macaws
      for (const m of macaws) m.update(dt, t, macawCtx);
      // butterflies
      butterflies.forEach((b, i) => { b.update(dt, t, butterflyCtx); b.write(butterflyKit.mesh, butterflyKit.wing, i); });
      butterflyKit.mesh.count = butterflies.length;
      butterflyKit.mesh.instanceMatrix.needsUpdate = true;
      butterflyKit.wing.needsUpdate = true;
      // dragonflies
      dragonflies.forEach((d, i) => { d.update(dt, t); d.write(dragonKit.mesh, i, 0.22); });
      dragonKit.mesh.instanceMatrix.needsUpdate = true;
      // fish
      floating.length = 0;
      for (const f of fruits.items) if (!f.dead && f.state === 'float' && f.bites > 0) floating.push(f);
      for (const set of fishSets) {
        set.inst.begin();
        for (const sw of set.fish) {
          sw.wanderT -= dt;
          let goal = sw.goal;
          const fr = floating.length ? floating[(set.fish.indexOf(sw) + fishSets.indexOf(set)) % floating.length] : null;
          if (fr) { goal = fishGoal.set(fr.pos.x, WATER_Y - 0.12, fr.pos.z); }
          else if (sw.wanderT <= 0) {
            sw.wanderT = 3 + Math.random() * 5;
            for (let k = 0; k < 8; k++) {
              const x = POND.cx + (Math.random() - 0.5) * 10, z = POND.cz + (Math.random() - 0.5) * 7;
              if (L.inPond(x, z, 0.45)) { sw.goal.set(x, Math.max(L.groundH(x, z) + 0.25, WATER_Y - 0.9 + Math.random() * 0.5), z); break; }
            }
          }
          const des = sw.seek(goal, fr ? 0.55 : 0.28, 0.8, _v);
          if (!L.inPond(sw.pos.x + sw.vel.x * 0.8, sw.pos.z + sw.vel.z * 0.8, 0.3)) des.add(_v2.set(POND.cx - sw.pos.x, 0, POND.cz - sw.pos.z).normalize().multiplyScalar(0.4));
          sw.steer(des, dt).integrate(dt);
          sw.pos.y = Math.min(sw.pos.y, WATER_Y - 0.08);
          if (fr && fr.age > 8 && sw.pos.distanceTo(goal) < 0.25) {
            sw.nibbleT -= dt;
            if (sw.nibbleT <= 0) { sw.nibbleT = 4 + Math.random() * 4; bite({ member: null }, fr, 0.35); }
          }
          set.inst.push(sw);
        }
        set.inst.end(t);
      }
    }

    // The shell pre-compiles with whatever render target is bound; frames render into a linear
    // render target, so bind a tiny linear target now to avoid compiling every program twice.
    const compileRT = new THREE.WebGLRenderTarget(1, 1);
    renderer.setRenderTarget(compileRT);
    let compileRTLive = true;
    if (window.__IDLE_TEST__) window.__jungle = { scene, shared, pond, godRays, waterfall, mist, sun, hemi, fruits, frogs, macaws, butterflies, post, view, L };
    // initial pose
    update(1 / 60, 0);

    /* ---------------- instance API ---------------- */
    const pickPool = [];
    return {
      scene, camera, view, post,
      update,
      feed(raycaster) {
        rcast.ray.copy(raycaster.ray);
        rcast.far = 80;
        const hits = rcast.intersectObjects(feedTargets, false);
        const ground = hits.length ? hits[0] : null;
        const wp = rcast.ray.intersectPlane(plane, _v3);
        if (wp && L.inPond(wp.x, wp.z, 0.08) && (!ground || rcast.ray.origin.distanceTo(wp) < ground.distance - 0.02)) {
          const pt = wp.clone();
          dropFruit(pt, true);
          return pt;
        }
        if (ground && ground.point.distanceTo(camera.position) < 40) {
          const pt = ground.point.clone();
          dropFruit(pt, false);
          return pt;
        }
        return null;
      },
      feedRandom(n) {
        const rr2 = R('fr' + Math.floor(simT * 10));
        for (let i = 0; i < n; i++) {
          if (rr2.chance(0.35)) {
            for (let k = 0; k < 10; k++) {
              const x = POND.cx + rr2.range(-4, 4), z = POND.cz + rr2.range(-1, 3.5);
              if (L.inPond(x, z, 0.3)) { dropFruit(new THREE.Vector3(x, WATER_Y, z), true); break; }
            }
          } else {
            const spots = [...boulderSpots.filter(s => s.pos.y > WATER_Y + 0.1 && s.camD !== 0), ...logSpots];
            for (let k = 0; k < 12; k++) {
              const x = POND.cx + rr2.range(-6, 6), z = POND.cz + rr2.range(3.5, 8);
              if (!L.inPond(x, z, -0.2)) { dropFruit(new THREE.Vector3(x, L.groundH(x, z), z), false); break; }
            }
          }
        }
        return n;
      },
      addMember(member) { spawnMember(member); },
      creatures() {
        pickPool.length = 0;
        for (const f of frogs) pickPool.push({ member: f.member, pos: f.pos.clone().add(_v.set(0, 0.1, 0)), radius: 0.35 });
        for (const m of macaws) pickPool.push({ member: m.member, pos: m.mesh.position.clone(), radius: 0.7 });
        for (const b of butterflies) if (b.member) pickPool.push({ member: b.member, pos: b.pos.clone(), radius: 0.35 });
        return pickPool;
      },
      resize(w, h) {
        const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
        const k = q >= 0.9 ? 0.5 : q >= 0.6 ? 0.4 : 0.32;
        pond.mesh.getRenderTarget().setSize(Math.max(256, Math.round(sz.x * k)), Math.max(144, Math.round(sz.y * k)));
      },
      dispose() {
        compileRT.dispose();
        sun.dispose();
        pond.dispose();
        envRT?.dispose();
        envScene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
        owned.forEach(t => t.dispose?.());
        wN1.dispose(); wN2.dispose();
        fruits.dispose();
        frogKit.mesh.customDepthMaterial?.dispose();
        macawKit.geo.dispose(); macawKit.mat.dispose();
      },
    };
  },
};

/** Canopy clump with UVs mapped onto an atlas rect. */
function buildClumpOnAtlas(atlas, rect, seed, cards) {
  const g = buildClump(seed, cards);
  const uv = g.attributes.uv, r = atlas.rects[rect];
  for (let i = 0; i < uv.count; i++) uv.setXY(i, lerp(r[0], r[2], uv.getX(i)), lerp(r[1], r[3], uv.getY(i)));
  const cnt = g.attributes.position.count;
  const col = new Float32Array(cnt * 3);
  const rng = makeRng(seed);
  for (let i = 0; i < cnt; i += 9) { const v = rng.range(0.75, 1.1); for (let k = i; k < Math.min(cnt, i + 9); k++) { col[k * 3] = v * 0.95; col[k * 3 + 1] = v; col[k * 3 + 2] = v * 0.9; } }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
