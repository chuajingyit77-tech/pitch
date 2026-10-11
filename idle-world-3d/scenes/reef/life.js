// 深蓝 · 珊瑚礁 — reef life: named residents (clownfish in their anemone, tangs, idol, angelfish,
// turtles), a chromis school, a silverside bait ball, cruising barramundi, and the feeding system.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU, makeRng, quatFromForward, damp } from '../../lib/util.js';
import { SHAPES, PAINTERS, REGION, buildFishGeometry, paintFish, createFishMaterial, applySwim, prepareSwimGeometry, FishInstances, Swimmer } from '../../lib/fish.js';
import { waterize } from './uw.js';
import { Turtle } from './turtle.js';

const hex = h => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/* ------------------------------------------------------------------ */
/* Extra painters / shapes (registered at runtime, lib untouched)      */
/* ------------------------------------------------------------------ */
if (!PAINTERS.reefPaletteTang) {
  // Palette surgeonfish: royal blue, black "palette" band and loop, yellow tail.
  PAINTERS.reefPaletteTang = {
    setup: () => ({}),
    body(s, v, C) {
      const q = C.q;
      let col = mix3(hex('#1749d6'), hex('#2a6cf2'), smoothstep(0.2, 0.75, q) * 0.7);
      col = mix3(col, hex('#4a9cff'), (1 - smoothstep(0.0, 0.32, q)) * 0.35);
      const sm = (e, w = 0.012) => smoothstep(-w, w, e);
      const qc = 0.64 + 0.16 * Math.sin(Math.PI * clamp((s - 0.12) / 0.84, 0, 1)) - 0.08 * smoothstep(0.82, 0.96, s);
      const bandW = 0.075 + 0.035 * Math.sin(Math.PI * clamp(s, 0, 1));
      const band = sm(bandW - Math.abs(q - qc)) * sm(s - 0.1) * sm(0.975 - s);
      const ex = (s - 0.67) / 0.25, ey = (q - 0.49) / 0.21;
      const lobe = sm(1 - (ex * ex + ey * ey), 0.06) * sm(s - 0.42);
      const hx = (s - 0.61) / 0.115, hy = (q - 0.57) / 0.07;
      const hole = sm(1 - (hx * hx + hy * hy), 0.08);
      const eyeBar = sm(0.022 - Math.abs(s - 0.125)) * sm(q - 0.52) * sm(0.74 - q);
      const black = Math.max(Math.max(band, lobe) * (1 - hole), eyeBar);
      col = mix3(col, hex('#090c1a'), black);
      col = mix3(col, hex('#ffd21f'), smoothstep(0.93, 0.985, s) * (1 - sm(Math.abs(q - 0.5) - 0.32)));
      return col;
    },
    fin(region, a, b) {
      if (region === REGION.caudal) {
        const edge = Math.min(b, 1 - b);
        const k = smoothstep(0.1, 0.16, edge);
        return [...mix3(hex('#0a0d1c'), hex('#ffcf1a'), k), 0.96];
      }
      if (region === REGION.pectoral) return [...mix3(hex('#1747c9'), hex('#ffd21f'), smoothstep(0.5, 0.85, a)), 0.88];
      const col = mix3(hex('#1a4ad0'), hex('#0a0d1c'), smoothstep(0.6, 0.86, a));
      return [...mix3(col, hex('#58b0ff'), a > 0.93 ? 1 : 0), 0.95];
    },
    eye: { iris: '#1a1a2a', pupil: '#050505' },
    material: () => ({ roughness: 0.34, clearcoat: 0.6, iridescence: 0.35, normalScale: 0.2 }),
    scaleDark: () => 0.03,
  };
  PAINTERS.reefSilver = {
    setup: () => ({}),
    body(s, v, C) {
      const q = C.q;
      let col = mix3(hex('#e6eef2'), hex('#2f6684'), smoothstep(0.58, 0.86, q));
      col = mix3(col, hex('#ffffff'), smoothstep(0.035, 0.0, Math.abs(q - 0.56)) * 0.8);
      col = mix3(col, hex('#c9d6dc'), (1 - smoothstep(0.0, 0.3, q)) * 0.5);
      return col;
    },
    fin(region, a) { return [...hex('#d6e6ee'), lerp(0.55, 0.2, a)]; },
    eye: { iris: '#c8d0d8', pupil: '#050505' },
    material: () => ({ metalness: 0.6, roughness: 0.22, clearcoat: 0.7, iridescence: 0.6, normalScale: 0.2 }),
    scaleDark: () => -0.12,
  };
  SHAPES.reefSilver = {
    ...SHAPES.chromis, tailLen: 0.24, height: 0.2, hPos: 0.42, width: 0.13, wPos: 0.38, noseQ: 0.62, noseQw: 0.6, arch: 0.02,
    caudal: { type: 'fork', L: 0.25, S: 0.13, notch: 0.38 },
    dorsal: { d0: 0.36, d1: 0.58, h: 0.07, profile: [0, 1, 0.6, 0.1], sweep: 0.35 },
    anal: { d0: 0.62, d1: 0.8, h: 0.05, profile: [0, 1, 0.6, 0.1], sweep: 0.3 },
    scales: { along: 50, around: 30, curve: 0.9 },
  };
}

if (!PAINTERS.reefAnthias) {
  // Sea goldie / lyretail anthias: orange-pink with a lavender cheek stripe, lyre tail.
  PAINTERS.reefAnthias = {
    setup: () => ({}),
    body(s, v, C) {
      const q = C.q;
      let col = mix3(hex('#ff5f24'), hex('#ff8a3c'), smoothstep(0.2, 0.8, q) * 0.6);
      col = mix3(col, hex('#ffb070'), (1 - smoothstep(0, 0.35, q)) * 0.45);
      const st = smoothstep(0.035, 0.0, Math.abs(s - 0.17 - (0.62 - q) * 0.3)) * smoothstep(0.2, 0.35, q) * (1 - smoothstep(0.62, 0.7, q)) * (s < 0.32 ? 1 : 0);
      return mix3(col, hex('#c88cff'), st);
    },
    fin(region, a, b) {
      if (region === REGION.caudal) { const e = Math.min(b, 1 - b); return [...mix3(hex('#ff6a2a'), hex('#ff2a7a'), smoothstep(0.25, 0.02, e)), 0.92]; }
      if (region === REGION.dorsal) return [...mix3(hex('#ff7a3a'), hex('#ff2a4a'), smoothstep(0.4, 0.9, a)), 0.9];
      return [...hex('#ffa060'), lerp(0.85, 0.5, a)];
    },
    eye: { iris: '#ff7040', pupil: '#050505' },
    material: () => ({ roughness: 0.34, clearcoat: 0.5, iridescence: 0.35, normalScale: 0.25 }),
    scaleDark: () => 0.04,
  };
  PAINTERS.reefAnthiasPurple = {
    setup: () => ({}),
    body(s, v, C) {
      const q = C.q;
      let col = mix3(hex('#7a3ae0'), hex('#a46aff'), smoothstep(0.2, 0.8, q) * 0.6);
      col = mix3(col, hex('#d0a8ff'), (1 - smoothstep(0, 0.35, q)) * 0.4);
      return mix3(col, hex('#ffd23a'), smoothstep(0.9, 0.97, q) * smoothstep(0.3, 0.4, s) * 0.8);
    },
    fin(region, a, b) {
      if (region === REGION.caudal) { const e = Math.min(b, 1 - b); return [...mix3(hex('#8a4aff'), hex('#3a1a8a'), smoothstep(0.25, 0.02, e)), 0.92]; }
      if (region === REGION.dorsal) return [...mix3(hex('#ffd23a'), hex('#ff9a2a'), a), 0.9];
      return [...hex('#b088ff'), lerp(0.8, 0.45, a)];
    },
    eye: { iris: '#c0a0ff', pupil: '#050505' },
    material: () => ({ roughness: 0.34, clearcoat: 0.5, iridescence: 0.45, normalScale: 0.25 }),
    scaleDark: () => 0.04,
  };
  // Threadfin butterflyfish: white with chevrons, yellow rear, black eye band and dorsal spot.
  PAINTERS.reefButterfly = {
    setup: () => ({}),
    body(s, v, C) {
      const q = C.q;
      let col = hex('#f7f5ee');
      col = mix3(col, hex('#ffd018'), smoothstep(0.48, 0.66, s + (q - 0.5) * 0.3));
      const ln = Math.sin(s * 34 + q * 20);
      if (s > 0.22 && s < 0.6 && ln > 0.82) col = mix3(col, hex('#4a4a4a'), 0.55);
      if (Math.abs(s - 0.17) < 0.04 && q > 0.2) col = hex('#121212');
      if (Math.hypot((s - 0.8) / 0.07, (q - 0.82) / 0.09) < 1) col = hex('#121212');
      return countershadeL(col, q, 0.06);
    },
    fin(region, a) {
      if (region === REGION.dorsal || region === REGION.anal) return [...mix3(hex('#ffd018'), hex('#121212'), smoothstep(0.84, 0.9, a)), 0.95];
      if (region === REGION.caudal) return [...mix3(hex('#ffd018'), hex('#f0f0e8'), smoothstep(0.7, 0.9, a)), 0.9];
      return [...hex('#f0eee0'), lerp(0.75, 0.4, a)];
    },
    eye: { iris: '#202020', pupil: '#050505' },
    material: () => ({ roughness: 0.36, clearcoat: 0.5, iridescence: 0.15, normalScale: 0.2 }),
    scaleDark: () => 0.03,
  };
  // Bluestreak cleaner wrasse: pale front, electric blue rear, black stripe widening to the tail.
  PAINTERS.reefCleaner = {
    setup: () => ({}),
    body(s, v, C) {
      const q = C.q;
      let col = mix3(hex('#eaf2ff'), hex('#1f7aff'), smoothstep(0.25, 0.9, s));
      const w = 0.035 + s * 0.09;
      col = mix3(col, hex('#0c0c16'), smoothstep(w + 0.01, w - 0.01, Math.abs(q - 0.56)) * smoothstep(0.02, 0.08, s));
      return col;
    },
    fin(region, a, b) {
      if (region === REGION.caudal) return [...(Math.abs(b - 0.5) < 0.16 ? hex('#0c0c16') : hex('#3a8aff')), 0.92];
      return [...hex('#4a9aff'), lerp(0.8, 0.4, a)];
    },
    eye: { iris: '#202030', pupil: '#050505' },
    material: () => ({ roughness: 0.3, clearcoat: 0.6, iridescence: 0.5, normalScale: 0.2 }),
    scaleDark: () => 0.02,
  };
  SHAPES.reefAnthias = { ...SHAPES.chromis, height: 0.32, tailLen: 0.22, caudal: { type: 'fork', L: 0.36, S: 0.24, notch: 0.28 }, dorsal: { d0: 0.26, d1: 0.78, h: 0.11, profile: [0, 1.3, 0.7, 0.65, 0.7, 0.2], sweep: 0.3 } };
  SHAPES.reefButterfly = { ...SHAPES.emperorAngel, height: 0.62, noseQ: 1.05, mouthY: 0.08, tailLen: 0.15,
    dorsal: { d0: 0.26, d1: 0.9, h: 0.13, profile: [0, 0.8, 1, 1, 0.9, 0.6, 0.35], sweep: 0.55 }, anal: { d0: 0.52, d1: 0.9, h: 0.11, profile: [0, 0.8, 1, 0.9, 0.5], sweep: 0.5 },
    caudal: { type: 'truncate', L: 0.15, S: 0.16 } };
  SHAPES.reefCleaner = { ...SHAPES.chromis, height: 0.2, width: 0.12, hPos: 0.4, tailLen: 0.18, noseQ: 0.7,
    caudal: { type: 'truncate', L: 0.14, S: 0.1 }, dorsal: { d0: 0.3, d1: 0.86, h: 0.045, profile: [0, 1, 1, 1, 0.6], sweep: 0.2 }, anal: { d0: 0.55, d1: 0.86, h: 0.04, profile: [0, 1, 1, 0.5], sweep: 0.2 } };
}
const countershadeL = (c, q, amt) => mix3(c, [1, 1, 1], (1 - smoothstep(0.0, 0.45, q)) * amt);

const SPEC = {
  clownfish: { shape: 'clownfish', painter: 'clownfish', size: 0.38, cruise: 0.45, sprint: 1.35, agility: 3.4, notice: 4 },
  blueTang: { shape: 'blueTang', painter: 'reefPaletteTang', size: 0.6, cruise: 0.66, sprint: 1.8, agility: 2.8, notice: 11 },
  yellowTang: { shape: 'yellowTang', painter: 'yellowTang', size: 0.55, cruise: 0.58, sprint: 1.7, agility: 2.8, notice: 11 },
  moorishIdol: { shape: 'moorishIdol', painter: 'moorishIdol', size: 0.64, cruise: 0.52, sprint: 1.5, agility: 2.2, notice: 10 },
  emperorAngel: { shape: 'emperorAngel', painter: 'emperorAngel', size: 0.7, cruise: 0.5, sprint: 1.5, agility: 2.2, notice: 10 },
};

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3();
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------ */
/* Food                                                                */
/* ------------------------------------------------------------------ */
class Food {
  constructor(W, env, max = 64) {
    this.env = env;
    this.max = max;
    const g = new THREE.IcosahedronGeometry(1, 0);
    g.scale(1, 0.38, 0.8);
    const mat = new THREE.MeshStandardMaterial({ color: '#d9822e', roughness: 0.55, emissive: '#5a2a08', emissiveIntensity: 0.6, envMapIntensity: 0.6, flatShading: true });
    waterize(mat, W, { key: 'food' });
    this.mesh = new THREE.InstancedMesh(g, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.items = [];
    for (let i = 0; i < max; i++) this.items.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, rest: false, rot: new THREE.Euler(), spin: new THREE.Vector3(), size: 0.05, claim: 0, ph: 0 });
    this.active = 0;
    // crumbs puff when a pellet is eaten
    const NC = 96;
    this.crumbPos = new Float32Array(NC * 3);
    this.crumbs = [];
    for (let i = 0; i < NC; i++) this.crumbs.push({ life: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3() });
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(this.crumbPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.crumbMat = new THREE.PointsMaterial({ color: '#e8a050', size: 0.035, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false });
    waterize(this.crumbMat, W, { caustics: false, key: 'crumb' });
    this.crumbPts = new THREE.Points(cg, this.crumbMat);
    this.crumbPts.frustumCulled = false;
    this.ci = 0;
  }
  spawnCloud(center, n, rng, floorAt, surfY) {
    let made = 0;
    for (const it of this.items) {
      if (it.alive) continue;
      it.alive = true; it.rest = false; it.age = 0; it.claim = 0;
      it.pos.set(center.x + rng.range(-0.4, 0.4), center.y + rng.range(-0.25, 0.35), center.z + rng.range(-0.4, 0.4));
      it.pos.y = clamp(it.pos.y, floorAt(it.pos.x, it.pos.z) + 0.3, surfY - 0.4);
      it.vel.set(rng.range(-0.15, 0.15), rng.range(-0.25, 0.05), rng.range(-0.15, 0.15));
      it.rot.set(rng.range(0, TAU), rng.range(0, TAU), rng.range(0, TAU));
      it.spin.set(rng.range(-2, 2), rng.range(-2, 2), rng.range(-2, 2));
      it.size = rng.range(0.038, 0.058);
      it.ph = rng.range(0, TAU);
      if (++made >= n) break;
    }
    return made;
  }
  nearest(pos, radius, filter) {
    let best = null, bd = radius * radius;
    for (const it of this.items) {
      if (!it.alive) continue;
      const d = it.pos.distanceToSquared(pos);
      if (d < bd && (!filter || filter(it))) { bd = d; best = it; }
    }
    return best;
  }
  eat(it) {
    it.alive = false;
    for (let k = 0; k < 6; k++) {
      const c = this.crumbs[this.ci]; this.ci = (this.ci + 1) % this.crumbs.length;
      c.life = 1; c.pos.copy(it.pos);
      c.vel.set(Math.random() - 0.5, Math.random() * 0.6, Math.random() - 0.5).multiplyScalar(0.5);
    }
  }
  any() { return this.items.some(i => i.alive); }
  update(dt, time, floorAt, cur) {
    let n = 0;
    for (const it of this.items) {
      if (!it.alive) continue;
      it.age += dt;
      if (!it.rest) {
        it.vel.y = lerp(it.vel.y, -0.2, 1 - Math.exp(-1.5 * dt));
        it.vel.x = lerp(it.vel.x, cur.x * 0.05 + Math.sin(time * 2.3 + it.ph) * 0.08, 1 - Math.exp(-1.2 * dt));
        it.vel.z = lerp(it.vel.z, cur.y * 0.05 + Math.cos(time * 2.0 + it.ph) * 0.08, 1 - Math.exp(-1.2 * dt));
        it.pos.addScaledVector(it.vel, dt);
        it.rot.x += it.spin.x * dt; it.rot.y += it.spin.y * dt; it.rot.z += it.spin.z * dt;
        const fl = floorAt(it.pos.x, it.pos.z) + 0.02;
        if (it.pos.y <= fl) { it.pos.y = fl; it.rest = true; it.rot.x = 0; it.rot.z = 0; }
      }
      const fade = it.age > 50 ? clamp(1 - (it.age - 50) / 4, 0, 1) : 1;
      if (fade <= 0) { it.alive = false; continue; }
      _q.setFromEuler(it.rot);
      _s.set(it.size, it.size, it.size).multiplyScalar(fade * Math.min(1, it.age * 6));
      _m4.compose(it.pos, _q, _s);
      this.mesh.setMatrixAt(n++, _m4);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.active = n;
    // crumbs
    const cp = this.crumbPos;
    let anyC = false;
    for (let i = 0; i < this.crumbs.length; i++) {
      const c = this.crumbs[i];
      if (c.life > 0) {
        c.life -= dt * 0.9; anyC = true;
        c.vel.multiplyScalar(Math.exp(-2.5 * dt)); c.vel.y -= 0.08 * dt;
        c.pos.addScaledVector(c.vel, dt);
        cp[i * 3] = c.pos.x; cp[i * 3 + 1] = c.pos.y; cp[i * 3 + 2] = c.pos.z;
      } else { cp[i * 3 + 1] = -999; }
    }
    this.crumbPts.visible = anyC;
    if (anyC) this.crumbPts.geometry.getAttribute('position').needsUpdate = true;
  }
}

/* ------------------------------------------------------------------ */
/* Life                                                                */
/* ------------------------------------------------------------------ */
export async function createLife(ctx) {
  const { W, env, hm, scene, anemones, bommies, surfY, camera, center, thickets = [], tod = { night: 0 } } = ctx;
  const rng = env.rng.fork('life');
  const q = Math.max(0.45, env.q);
  const group = new THREE.Group();
  const disposables = [];
  const floorAt = (x, z) => hm.at(x, z);

  /* ---- species meshes ---- */
  const species = {};
  for (const [kind, sp] of Object.entries(SPEC)) {
    const geo = buildFishGeometry(sp.shape, { detail: 1 });
    const painted = paintFish(sp.painter, { seed: 7 + kind.length, shape: sp.shape, size: [1024, 512] });
    const mat = createFishMaterial(painted, { envMapIntensity: 1.1 });
    waterize(mat, W, { key: 'fish' });
    const inst = new FishInstances(geo, mat, 16, { castShadow: env.shadows });
    group.add(inst.mesh);
    species[kind] = inst;
    disposables.push(geo, painted.map);
  }

  /* ---- residents ---- */
  const residents = [];
  const turtles = [];
  const bommieList = bommies;
  const addResident = (m) => {
    if (m.kind === 'turtle') { addTurtle(m); return; }
    const sp = SPEC[m.kind];
    if (!sp) return;
    const r = makeRng(m.seed || 1);
    const size = sp.size * (m.size || 1);
    const home = m.kind === 'clownfish' ? anemones[residents.filter(x => x.kind === 'clownfish').length % 2 === 0 || anemones.length < 2 ? 0 : 1] : null;
    const b = home ? null : bommieList[Math.floor(r.next() * bommieList.length)];
    const start = home ? home.pos.clone().add(new THREE.Vector3(r.range(-0.4, 0.4), 0.45, r.range(-0.4, 0.4)))
      : new THREE.Vector3(b.x + r.range(-3, 3), 0, b.z + r.range(-3, 3));
    if (!home) start.y = floorAt(start.x, start.z) + r.range(0.8, 2.4);
    const sw = new Swimmer({ pos: start, size, speed: sp.cruise, rng: r, agility: sp.agility, maxPitch: 0.65 });
    residents.push({ m, kind: m.kind, sp, size, sw, home, rng: r, state: 'roam', timer: r.range(0, 4), target: start.clone(), spot: null, food: null, begSlot: residents.length, begPhase: r.range(0, 60), speedK: r.range(0.85, 1.15), bob: r.range(0, TAU), clear: size * 0.45 + 0.15 });
  };

  /* ---- turtles ---- */
  const addTurtle = (m) => {
    const t = new Turtle(W, env, (m.seed || 7) >>> 0);
    const r = makeRng(m.seed || 3);
    const s = 0.95 * (m.size || 1);
    t.root.scale.setScalar(s);
    const a = r.range(0, TAU);
    const pos = new THREE.Vector3(Math.cos(a) * 7, 0, Math.sin(a) * 7);
    pos.y = floorAt(pos.x, pos.z) + 3;
    group.add(t.root);
    turtles.push({ m, t, pos, vel: new THREE.Vector3(Math.cos(a + 1.6), 0, Math.sin(a + 1.6)).multiplyScalar(0.4), fwd: new THREE.Vector3(Math.cos(a + 1.6), 0, Math.sin(a + 1.6)), quat: new THREE.Quaternion(), roll: 0, target: pos.clone(), timer: 0, rng: r, size: s, food: null, stroke: 1, state: 'cruise' });
  };
  for (const m of env.members) addResident(m);

  /* ---- chromis school ---- */
  const nSchool = Math.round(clamp(85 * q, 40, 100));
  const nChromHover = Math.round(3 * q) * 18;
  const chromGeo = buildFishGeometry('chromis', { detail: 0.5 });
  const chromPaint = paintFish('chromis', { seed: 3, size: [512, 256] });
  const chromMat = createFishMaterial(chromPaint, { envMapIntensity: 1.2 });
  waterize(chromMat, W, { key: 'fish' });
  const chromInst = new FishInstances(chromGeo, chromMat, nSchool + nChromHover, { castShadow: false });
  group.add(chromInst.mesh);
  disposables.push(chromGeo, chromPaint.map);
  const school = [];
  const sRng = rng.fork('school');
  const anchor = new THREE.Vector3(3, 2.5, 2);
  for (let i = 0; i < nSchool; i++) {
    const p = anchor.clone().add(new THREE.Vector3(sRng.range(-2, 2), sRng.range(-0.8, 0.8), sRng.range(-2, 2)));
    const sw = new Swimmer({ pos: p, size: sRng.range(0.19, 0.27), speed: 0.8, rng: sRng, agility: 3.2, maxPitch: 0.5 });
    sw.food = null; sw.dart = 0;
    school.push(sw);
  }
  const schoolC = new THREE.Vector3();

  /* ---- silverside bait ball (further out) ---- */
  const nSilver = Math.round(clamp(110 * q, 50, 130));
  const silGeo = buildFishGeometry(SHAPES.reefSilver, { detail: 0.4 });
  const silPaint = paintFish('reefSilver', { seed: 5, shape: 'reefSilver', size: [512, 256] });
  const silMat = createFishMaterial(silPaint, { envMapIntensity: 1.6 });
  waterize(silMat, W, { key: 'fish' });
  const silInst = new FishInstances(silGeo, silMat, nSilver, { castShadow: false });
  group.add(silInst.mesh);
  disposables.push(silGeo, silPaint.map);
  const silver = [];
  const silRng = rng.fork('silver');
  const silA = silRng.range(0, TAU);
  const silCenter = new THREE.Vector3(Math.cos(silA) * 13, 0, Math.sin(silA) * 13);
  silCenter.y = floorAt(silCenter.x, silCenter.z) + 5;
  for (let i = 0; i < nSilver; i++) {
    const a = silRng.range(0, TAU), r = silRng.range(0.8, 2.4);
    const p = silCenter.clone().add(new THREE.Vector3(Math.cos(a) * r, silRng.range(-1, 1), Math.sin(a) * r));
    silver.push(new Swimmer({ pos: p, size: silRng.range(0.14, 0.19), speed: 1.1, rng: silRng, agility: 4, maxPitch: 0.35 }));
  }


  /* ---- hovering groups: anthias clouds over the coral heads, chromis over staghorn ---- */
  const mkSpecies = (painter, shape, n, detail, seed) => {
    const g = buildFishGeometry(shape, { detail });
    const pt = paintFish(painter, { seed, shape, size: [512, 256] });
    const m = createFishMaterial(pt, { envMapIntensity: 1.2 });
    waterize(m, W, { key: 'fish' });
    const inst = new FishInstances(g, m, n, { castShadow: false });
    group.add(inst.mesh);
    disposables.push(g, pt.map);
    return inst;
  };
  const hoverGroups = [];
  const hRng = rng.fork('hover');
  const mkGroup = (centerPos, n, sizeLo, sizeHi, spread, kind) => {
    const fish = [];
    for (let i = 0; i < n; i++) {
      const off = new THREE.Vector3(hRng.range(-1, 1) * spread, hRng.range(0.15, 1) * spread * 0.55, hRng.range(-1, 1) * spread);
      const p = centerPos.clone().add(off);
      const sw = new Swimmer({ pos: p, size: hRng.range(sizeLo, sizeHi), speed: 0.1, rng: hRng, agility: 3.5, maxPitch: 0.4 });
      sw.off = off; sw.jit = hRng.range(0, 100); sw.food = null; sw.dart = 0;
      fish.push(sw);
    }
    hoverGroups.push({ c: centerPos.clone(), fish, kind, spread });
    return fish;
  };
  const coralHeads = bommies.map(b => new THREE.Vector3(b.x, b.top + 0.15, b.z));
  const anthO = [], anthP = [];
  const nAnth = Math.round(30 * q);
  const heads = [...coralHeads, ...thickets.slice(0, 3)];
  heads.forEach((c, i) => {
    if (i >= Math.round(7 * q) + 1) return;
    const list = i % 3 === 2 ? anthP : anthO;
    list.push(...mkGroup(c.clone().add(new THREE.Vector3(0, 0.1, 0)), nAnth, 0.17, 0.23, 1.25, 'anthias'));
  });
  const anthOInst = anthO.length ? mkSpecies('reefAnthias', 'reefAnthias', anthO.length, 0.5, 11) : null;
  const anthPInst = anthP.length ? mkSpecies('reefAnthiasPurple', 'reefAnthias', anthP.length, 0.5, 12) : null;
  const chromHover = [];
  thickets.slice(3, 3 + Math.round(3 * q)).forEach(c => chromHover.push(...mkGroup(c.clone(), 18, 0.18, 0.24, 0.8, 'chromis')));
  if (thickets.length < 4) coralHeads.slice(1, 3).forEach(c => chromHover.push(...mkGroup(c.clone().add(new THREE.Vector3(1.5, -0.6, 0)), 18, 0.18, 0.24, 0.8, 'chromis')));

  /* ---- butterflyfish pairs grazing the reef ---- */
  const butter = [];
  const bfInst = mkSpecies('reefButterfly', 'reefButterfly', 6, 0.8, 13);
  const bfRng = rng.fork('butterfly');
  for (let pI = 0; pI < (q > 0.6 ? 3 : 2); pI++) {
    const b = bommies[(pI + 1) % bommies.length];
    const p0 = new THREE.Vector3(b.x + 1.5, b.top - 0.6, b.z + 1.2);
    for (let k = 0; k < 2; k++) {
      const sw = new Swimmer({ pos: p0.clone().add(new THREE.Vector3(k * 0.4, 0, k * 0.3)), size: bfRng.range(0.36, 0.44), speed: 0.4, rng: bfRng, agility: 2.6, maxPitch: 0.6 });
      sw.lead = k === 0 ? null : butter[butter.length - 1];
      sw.target = p0.clone(); sw.spot = new THREE.Vector3(); sw.timer = 0; sw.state = 'roam'; sw.food = null; sw.r = bfRng;
      butter.push(sw);
    }
  }

  /* ---- cleaner station on the flank of a coral head ---- */
  const station = (() => {
    const b = bommies[bommies.length > 2 ? 2 : 0];
    const a = rng.range(0, TAU);
    const y = (b.top + hm.at(b.x + Math.cos(a) * (b.r + 2), b.z + Math.sin(a) * (b.r + 2))) * 0.5;
    let rr = 0.3;
    while (rr < b.r * 1.8 && hm.at(b.x + Math.cos(a) * rr, b.z + Math.sin(a) * rr) > y) rr += 0.1;
    const wall = new THREE.Vector3(b.x + Math.cos(a) * rr, y, b.z + Math.sin(a) * rr);
    const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    return { wall, out, hover: wall.clone().addScaledVector(out, 0.9), client: null, t: 0 };
  })();
  const cleanerInst = mkSpecies('reefCleaner', 'reefCleaner', 5, 0.6, 14);
  const cleaners = [];
  const clRng = rng.fork('cleaner');
  for (let i = 0; i < (q > 0.6 ? 5 : 3); i++) {
    const sw = new Swimmer({ pos: station.wall.clone().addScaledVector(station.out, 0.25).add(new THREE.Vector3(clRng.range(-0.3, 0.3), clRng.range(-0.2, 0.2), clRng.range(-0.3, 0.3))), size: clRng.range(0.13, 0.17), speed: 0.2, rng: clRng, agility: 5, maxPitch: 0.7 });
    sw.ph = clRng.range(0, TAU); sw.k = clRng.range(-0.4, 0.4);
    cleaners.push(sw);
  }

  /* ---- distant school of jacks: silhouettes in the blue ---- */
  const nJack = Math.round(clamp(150 * q, 60, 160));
  const jackInst = new FishInstances(silGeo, silMat, nJack, { castShadow: false });
  group.add(jackInst.mesh);
  const jRng = rng.fork('jacks');
  const jA = -Math.PI / 2 + jRng.range(-0.6, 0.6);
  const jackC = new THREE.Vector3(Math.cos(jA) * 31, 0, Math.sin(jA) * 31);
  jackC.y = Math.max(hm.at(jackC.x, jackC.z) + 6, center.y + 4.5);
  const jacks = [];
  for (let i = 0; i < nJack; i++) {
    const a = jRng.range(0, TAU), r = jRng.range(2.5, 5.5);
    jacks.push(new Swimmer({ pos: jackC.clone().add(new THREE.Vector3(Math.cos(a) * r, jRng.range(-1.5, 1.5), Math.sin(a) * r)), size: jRng.range(0.55, 0.8), speed: 1.0, rng: jRng, agility: 2.4, maxPitch: 0.3 }));
  }

  /* ---- barramundi ---- */
  const barra = [];
  let barraInst = null;
  try {
    const gltf = await env.loadGLTF('models/Barramundi.glb');
    let src = null;
    gltf.scene.traverse(o => { if (o.isMesh && !src) src = o; });
    if (src) {
      const g = src.geometry.clone();
      g.rotateY(-Math.PI / 2);                    // head (raw -Z) -> +X, right side -> +Z
      g.computeBoundingBox();
      const bb = g.boundingBox, len = bb.max.x - bb.min.x;
      g.translate(-(bb.max.x + bb.min.x) / 2, -(bb.max.y + bb.min.y) / 2, -(bb.max.z + bb.min.z) / 2);
      g.scale(1 / len, 1 / len, 1 / len);
      prepareSwimGeometry(g);
      const mat = src.material.clone();
      mat.envMapIntensity = 0.9;
      applySwim(mat, { waveK: 6.0 });
      waterize(mat, W, { key: 'barra' });
      barraInst = new FishInstances(g, mat, 2, { castShadow: env.shadows });
      group.add(barraInst.mesh);
      disposables.push(g);
      const bRng = rng.fork('barra');
      const nB = q > 0.6 ? 2 : 1;
      for (let i = 0; i < nB; i++) {
        const a = bRng.range(0, TAU);
        const p = new THREE.Vector3(Math.cos(a) * 10, 0, Math.sin(a) * 10);
        p.y = floorAt(p.x, p.z) + bRng.range(1.5, 3);
        const sw = new Swimmer({ pos: p, size: bRng.range(1.05, 1.3), speed: 0.5, rng: bRng, agility: 0.9, maxPitch: 0.25 });
        sw.target = p.clone(); sw.timer = 0; sw.food = null;
        barra.push(sw);
      }
    }
  } catch (e) { console.warn('[reef] barramundi unavailable', e); }

  /* ---- food ---- */
  const food = new Food(W, env, 72);
  group.add(food.mesh, food.crumbPts);

  /* ---- helpers ---- */
  const camFwd = new THREE.Vector3(), camRight = new THREE.Vector3();
  function avoid(sw, desired, clear, dt, ignoreFloorNear = null) {
    const p = sw.pos;
    let fl = floorAt(p.x, p.z) + clear;
    if (ignoreFloorNear && Math.hypot(p.x - ignoreFloorNear.x, p.z - ignoreFloorNear.z) < 0.9) fl = Math.min(fl, ignoreFloorNear.y + 0.08);
    const ax = p.x + sw.vel.x * 0.9, az = p.z + sw.vel.z * 0.9;
    let fla = floorAt(ax, az) + clear;
    if (ignoreFloorNear && Math.hypot(ax - ignoreFloorNear.x, az - ignoreFloorNear.z) < 0.9) fla = Math.min(fla, ignoreFloorNear.y + 0.08);
    const need = Math.max(fl, fla);
    if (p.y < need + 0.25) desired.y += (need + 0.25 - p.y) * 3.0;
    if (p.y > surfY - 1.2) desired.y -= (p.y - surfY + 1.2) * 2;
    const r = Math.hypot(p.x - center.x, p.z - center.z);
    if (r > 20) { desired.x -= (p.x - center.x) / r * (r - 20) * 0.6; desired.z -= (p.z - center.z) / r * (r - 20) * 0.6; }
    return desired;
  }
  function clampAbove(sw, clear, ignore = null) {
    const p = sw.pos;
    let fl = floorAt(p.x, p.z) + clear * 0.6;
    if (ignore && Math.hypot(p.x - ignore.x, p.z - ignore.z) < 0.9) fl = Math.min(fl, ignore.y + 0.05);
    if (p.y < fl) { p.y = lerp(p.y, fl, 0.3); if (sw.vel.y < 0) sw.vel.y *= 0.5; }
  }
  const randomReefPoint = (r, out, lo = 0.6, hi = 2.6) => {
    const b = bommieList[Math.floor(r.next() * bommieList.length)];
    const a = r.range(0, TAU), rr = r.range(0.5, b.r + 2.5);
    out.set(b.x + Math.cos(a) * rr, 0, b.z + Math.sin(a) * rr);
    out.y = floorAt(out.x, out.z) + r.range(lo, hi);
    return out;
  };
  const begPoint = (slot, t, out) => {
    camera.getWorldDirection(camFwd);
    camRight.crossVectors(camFwd, _up).normalize();
    const col = (slot % 5) - 2, row = Math.floor(slot / 5) % 3;
    out.copy(camera.position).addScaledVector(camFwd, 5.2 + row * 0.8).addScaledVector(camRight, col * 0.7 + Math.sin(t * 0.4 + slot) * 0.25);
    out.y += -0.35 + row * 0.45 + Math.sin(t * 0.9 + slot * 1.7) * 0.12;
    out.y = clamp(out.y, floorAt(out.x, out.z) + 0.6, surfY - 1.5);
    return out;
  };

  /* ---- per-frame ---- */
  let time = 0;
  const foodAvail = it => it.alive;
  function updateResidents(dt, t) {
    const anyFood = food.active > 0;
    for (const f of residents) {
      const sw = f.sw, sp = f.sp, r = f.rng;
      const full = env.fullness(f.m);
      const hungry = full < 0.35;
      f.timer -= dt;
      _d.set(0, 0, 0);
      let speed = sp.cruise * f.speedK;
      let arrive = 0.6;
      // food first
      if (anyFood) {
        const noticeFrom = f.home ? f.home.pos : sw.pos;
        const it = food.nearest(noticeFrom, f.home ? 3.6 : sp.notice * (hungry ? 1.4 : 1), foodAvail);
        f.food = it;
      } else f.food = null;
      if (f.food) {
        f.state = 'food';
        const it = f.food;
        _v1.copy(sw.fwd).multiplyScalar(f.size * 0.45).add(sw.pos);          // mouth
        const dist = _v1.distanceTo(it.pos);
        speed = sp.sprint * (dist > 1.5 ? 1 : 0.6);
        sw.seek(it.pos, speed, 0.4, _d);
        _d.addScaledVector(_v2.subVectors(it.pos, _v1), 0.8);
        if (dist < 0.1 + f.size * 0.22) {
          food.eat(it);
          env.onEat(f.m, it.pos.clone());
          f.timer = r.range(0.6, 1.4);
          f.state = 'gulp';
        }
      } else {
        if (f.state === 'food' || f.state === 'gulp') { f.state = 'roam'; f.timer = 0; }
        const begOn = hungry && ((t + f.begPhase) % 40) < 17;
        if (begOn) {
          if (f.state !== 'beg') { f.state = 'beg'; }
          if (f.home) {
            // clownfish beg in front of their anemone, never far from home
            camera.getWorldDirection(camFwd);
            f.target.copy(f.home.pos).addScaledVector(camFwd, -1.5);
            f.target.y = f.home.pos.y + 0.7 + Math.sin(t * 1.1 + f.bob) * 0.15;
            f.target.x += Math.sin(t * 0.7 + f.bob) * 0.3;
          } else begPoint(f.begSlot, t, f.target);
          const dist = sw.pos.distanceTo(f.target);
          speed = dist > 2 ? sp.sprint * 0.75 : sp.cruise * 0.6;
          sw.seek(f.target, speed, 1.2, _d);
          if (dist < 1.2) {
            _v1.subVectors(camera.position, sw.pos).normalize().multiplyScalar(0.07);
            _d.add(_v1);
            _d.y += Math.sin(t * 2.2 + f.bob) * 0.06;
          }
        } else if (f.home) {
          // clownfish: loops above the anemone, then nestle into the tentacles
          if (f.state === 'beg') f.state = 'home';
          if (f.timer <= 0) {
            if (f.state === 'nestle' || r.chance(0.45)) {
              f.state = 'home'; f.timer = r.range(3, 7);
              const a = r.range(0, TAU), rr = r.range(0.2, 0.75);
              f.target.set(f.home.pos.x + Math.cos(a) * rr, f.home.pos.y + r.range(0.35, 0.85), f.home.pos.z + Math.sin(a) * rr);
            } else {
              f.state = 'nestle'; f.timer = r.range(5, 11);
              const a = r.range(0, TAU), rr = r.range(0.0, f.home.r * 0.55);
              f.target.set(f.home.pos.x + Math.cos(a) * rr, f.home.pos.y + 0.2, f.home.pos.z + Math.sin(a) * rr);
            }
          }
          if (f.state === 'nestle') {
            speed = 0.16; arrive = 0.35;
            sw.seek(f.target, speed, arrive, _d);
            _d.x += Math.sin(t * 1.3 + f.bob) * 0.05; _d.z += Math.cos(t * 1.1 + f.bob) * 0.05;
          } else {
            speed = sp.cruise * f.speedK;
            sw.seek(f.target, speed, 0.5, _d);
            if (sw.pos.distanceTo(f.target) < 0.25) f.timer = Math.min(f.timer, 0.4);
          }
        } else {
          // reef fish: roam between coral heads and graze on the rock
          if (f.state === 'beg') { f.state = 'roam'; f.timer = 0; }
          if (f.timer <= 0) {
            if (f.state === 'roam' && r.chance(0.4)) {
              f.state = 'graze'; f.timer = r.range(3, 6);
              const b = bommieList[Math.floor(r.next() * bommieList.length)];
              const a = r.range(0, TAU), rr = r.range(0, b.r * 0.85);
              const x = b.x + Math.cos(a) * rr, z = b.z + Math.sin(a) * rr;
              const n = hm.normal(x, z, _v3);
              f.spot = (f.spot || new THREE.Vector3()).set(x, floorAt(x, z), z);
              f.target.copy(f.spot).addScaledVector(n, f.size * 0.55 + 0.12);
            } else {
              f.state = 'roam'; f.timer = r.range(5, 11);
              randomReefPoint(r, f.target, 0.7, 2.8);
            }
          }
          if (f.state === 'graze') {
            const dist = sw.pos.distanceTo(f.target);
            if (dist > 0.4) sw.seek(f.target, speed, 0.8, _d);
            else {
              // nose down to the rock, little pecks
              _d.subVectors(f.spot, sw.pos).normalize().multiplyScalar(0.06 + 0.05 * Math.max(0, Math.sin(t * 6 + f.bob)));
              _d.addScaledVector(_v1.subVectors(f.target, sw.pos), 0.8);
            }
          } else {
            sw.seek(f.target, speed, 1.2, _d);
            if (sw.pos.distanceTo(f.target) < 0.6) f.timer = Math.min(f.timer, 0.5);
          }
        }
      }
      // separation from other residents
      for (const o of residents) {
        if (o === f) continue;
        const dx = sw.pos.x - o.sw.pos.x, dy = sw.pos.y - o.sw.pos.y, dz = sw.pos.z - o.sw.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz, rr = (f.size + o.size) * 0.7;
        if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2), k = (rr - d) / d * 1.5; _d.x += dx * k; _d.y += dy * k; _d.z += dz * k; }
      }
      const ign = f.home && (f.state === 'nestle' || f.state === 'home' || f.state === 'food' || f.state === 'gulp') ? f.home.pos : null;
      avoid(sw, _d, f.clear, dt, ign);
      sw.steer(_d, dt).integrate(dt);
      clampAbove(sw, f.clear, ign);
      if (f.state === 'nestle') sw.amp *= 0.7;
    }
    for (const kind in species) species[kind].begin();
    for (const f of residents) species[f.kind].push(f.sw);
    for (const kind in species) species[kind].end(t);
  }

  function updateTurtles(dt, t) {
    for (const tu of turtles) {
      const full = env.fullness(tu.m);
      const hungry = full < 0.35;
      tu.timer -= dt;
      let speed = 0.42;
      const it = food.active ? food.nearest(tu.pos, 9, foodAvail) : null;
      if (it) {
        tu.state = 'food';
        _v1.copy(tu.fwd).multiplyScalar(0.8 * tu.size).add(tu.pos);
        const d = _v1.distanceTo(it.pos);
        tu.target.copy(it.pos);
        speed = d > 2 ? 0.75 : 0.35;
        if (d < 0.22 * tu.size + 0.12) { food.eat(it); env.onEat(tu.m, it.pos.clone()); }
      } else if (hungry && ((t + tu.size * 77) % 50) < 22) {
        tu.state = 'beg';
        begPoint(7, t, tu.target);
        tu.target.y += 0.6;
        speed = 0.5;
      } else {
        if (tu.state !== 'cruise' || tu.timer <= 0 || tu.pos.distanceTo(tu.target) < 1.5) {
          tu.state = 'cruise';
          tu.timer = tu.rng.range(12, 22);
          const a = tu.rng.range(0, TAU), r = tu.rng.range(3, 12);
          tu.target.set(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r);
          tu.target.y = floorAt(tu.target.x, tu.target.z) + tu.rng.range(1.6, 4.5);
        }
      }
      _d.subVectors(tu.target, tu.pos);
      const dist = _d.length();
      _d.multiplyScalar(speed * clamp(dist / 2.5, 0.25, 1) / Math.max(dist, 1e-3));
      // avoid the reef
      const fl = floorAt(tu.pos.x + tu.vel.x, tu.pos.z + tu.vel.z) + 0.7 * tu.size;
      if (tu.pos.y < fl + 0.4) _d.y += (fl + 0.4 - tu.pos.y) * 1.5;
      if (tu.pos.y > surfY - 1.5) _d.y -= 0.5;
      for (const f of residents) {
        const dx = tu.pos.x - f.sw.pos.x, dy = tu.pos.y - f.sw.pos.y, dz = tu.pos.z - f.sw.pos.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1.0) f.sw.vel.addScaledVector(_v1.set(-dx, -dy, -dz).normalize(), dt * 2);
      }
      tu.vel.lerp(_d, 1 - Math.exp(-0.7 * dt));
      tu.pos.addScaledVector(tu.vel, dt);
      const sp = tu.vel.length();
      if (sp > 0.02) {
        _f.copy(tu.vel).divideScalar(sp);
        _f.y = clamp(_f.y, -0.35, 0.35);
        const prevYaw = Math.atan2(tu.fwd.z, tu.fwd.x);
        tu.fwd.lerp(_f.normalize(), 1 - Math.exp(-1.2 * dt)).normalize();
        const yawRate = -((Math.atan2(tu.fwd.z, tu.fwd.x) - prevYaw + Math.PI * 3) % TAU - Math.PI) / Math.max(dt, 1e-3);
        tu.roll = lerp(tu.roll, clamp(-yawRate * 0.6, -0.35, 0.35), 1 - Math.exp(-1.5 * dt));
      }
      const stroke = tu.state === 'food' ? 1 : clamp(0.35 + (0.5 + 0.5 * Math.sin(t * 0.13 + tu.size * 10)) * 0.8, 0, 1);
      const bob = tu.t.animate(dt, t, stroke, tu.state === 'food' ? 1.4 : 1);
      quatFromForward(tu.quat, tu.fwd, tu.roll);
      tu.t.root.quaternion.copy(tu.quat);
      tu.t.root.position.copy(tu.pos);
      tu.t.root.position.y += bob;
    }
  }

  const neigh = [];
  function updateSchool(dt, t) {
    // the school wanders around the reef, swirling; it is drawn to food
    let fx = 0, fz = 0, fy = 0, fn = 0;
    if (food.active) for (const it of food.items) if (it.alive) { fx += it.pos.x; fy += it.pos.y; fz += it.pos.z; fn++; }
    const ax = center.x + Math.cos(t * 0.045) * 6.5 + Math.sin(t * 0.11) * 2;
    const az = center.z + Math.sin(t * 0.037) * 6 + Math.cos(t * 0.09) * 2;
    _v3.set(ax, 0, az);
    _v3.y = floorAt(ax, az) + 2.2 + Math.sin(t * 0.07) * 0.8;
    if (fn) { _v2.set(fx / fn, fy / fn, fz / fn); if (_v2.distanceTo(schoolC) < 12) _v3.lerp(_v2, 0.7); }
    anchor.lerp(_v3, 1 - Math.exp(-0.4 * dt));
    schoolC.set(0, 0, 0);
    for (const s of school) schoolC.add(s.pos);
    schoolC.divideScalar(school.length);
    const n = school.length;
    for (let i = 0; i < n; i++) {
      const s = school[i];
      let sx = 0, sy = 0, sz = 0, ax2 = 0, ay2 = 0, az2 = 0, cx = 0, cy = 0, cz = 0, cn = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const o = school[j];
        const dx = o.pos.x - s.pos.x, dy = o.pos.y - s.pos.y, dz = o.pos.z - s.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 1.7) continue;
        cn++; cx += dx; cy += dy; cz += dz;
        ax2 += o.vel.x; ay2 += o.vel.y; az2 += o.vel.z;
        if (d2 < 0.13 && d2 > 1e-6) { const k = (0.36 - Math.sqrt(d2)) / Math.sqrt(d2); sx -= dx * k; sy -= dy * k; sz -= dz * k; }
      }
      _d.set(0, 0, 0);
      if (cn) {
        _d.x += cx / cn * 0.35 + (ax2 / cn - s.vel.x) * 0.6 + sx * 2.2;
        _d.y += cy / cn * 0.35 + (ay2 / cn - s.vel.y) * 0.6 + sy * 2.2;
        _d.z += cz / cn * 0.35 + (az2 / cn - s.vel.z) * 0.6 + sz * 2.2;
      }
      // swirl around the anchor
      const rx = s.pos.x - anchor.x, rz = s.pos.z - anchor.z;
      const rr = Math.hypot(rx, rz) + 1e-3;
      _d.x += -rz / rr * 0.75 + (-rx / rr) * clamp(rr - 1.8, -1, 2) * 0.45;
      _d.z += rx / rr * 0.75 + (-rz / rr) * clamp(rr - 1.8, -1, 2) * 0.45;
      _d.y += (anchor.y - s.pos.y) * 0.35 + Math.sin(t * 0.7 + i) * 0.05;
      // food: darting at pellets nearby
      if (fn && (i % 3 === 0)) {
        if (!s.food || !s.food.alive) s.food = food.nearest(s.pos, 3.2, foodAvail);
        if (s.food) {
          _v1.copy(s.fwd).multiplyScalar(s.size * 0.45).add(s.pos);
          _d.addScaledVector(_v2.subVectors(s.food.pos, _v1), 2.2);
          if (_v1.distanceTo(s.food.pos) < 0.12) { food.eat(s.food); env.onEat(null, s.food.pos.clone()); s.food = null; }
        }
      } else s.food = null;
      const sp = _d.length();
      const maxS = s.food ? 1.7 : 1.0;
      if (sp > maxS) _d.multiplyScalar(maxS / sp);
      avoid(s, _d, 0.35, dt);
      s.steer(_d, dt).integrate(dt);
      clampAbove(s, 0.3);
    }
    chromInst.begin();
    for (const s of school) chromInst.push(s);
    for (const s of chromHover) chromInst.push(s);
    chromInst.end(t);
  }

  function updateSilver(dt, t) {
    const c = silCenter;
    const n = silver.length;
    for (let i = 0; i < n; i++) {
      const s = silver[i];
      const rx = s.pos.x - c.x, ry = s.pos.y - c.y, rz = s.pos.z - c.z;
      const rr = Math.hypot(rx, rz) + 1e-3;
      const R = 1.9 + Math.sin(t * 0.2 + i * 0.37) * 0.5;
      _d.set(-rz / rr * 1.25, 0, rx / rr * 1.25);
      _d.x += -rx / rr * (rr - R) * 0.9; _d.z += -rz / rr * (rr - R) * 0.9;
      _d.y = -ry * 0.6 + Math.sin(t * 0.5 + i * 0.7) * 0.25;
      // light separation with a few neighbours
      for (let k = 1; k <= 3; k++) {
        const o = silver[(i + k * 7) % n];
        const dx = s.pos.x - o.pos.x, dy = s.pos.y - o.pos.y, dz = s.pos.z - o.pos.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.06 && d2 > 1e-6) { _d.x += dx * 4; _d.y += dy * 4; _d.z += dz * 4; }
      }
      s.steer(_d, dt).integrate(dt);
    }
    // the ball drifts slowly
    c.x += Math.sin(t * 0.03) * dt * 0.15; c.z += Math.cos(t * 0.025) * dt * 0.15;
    silInst.begin();
    for (const s of silver) silInst.push(s);
    silInst.end(t);
  }


  function updateHover(dt, t) {
    const cur = W.uCurDir.value;
    const night = tod.night;
    for (const g of hoverGroups) {
      for (const s of g.fish) {
        // stations above the coral head; at night they sink into the reef
        _v1.copy(g.c).add(s.off);
        _v1.x += Math.sin(t * 0.21 + s.jit) * 0.35; _v1.z += Math.cos(t * 0.17 + s.jit) * 0.35; _v1.y += Math.sin(t * 0.3 + s.jit) * 0.12;
        _v1.y = lerp(_v1.y, hm.at(_v1.x, _v1.z) + 0.25, night * 0.8);
        _d.subVectors(_v1, s.pos).multiplyScalar(0.9);
        // hold station facing into the current
        _d.x -= cur.x * 0.16; _d.z -= cur.y * 0.16;
        s.dart -= dt;
        if (s.dart < 0) { s.dart = 1.5 + Math.random() * 5; s.vel.addScaledVector(_v2.set(Math.random() - 0.5, (Math.random() - 0.5) * 0.4, Math.random() - 0.5), 0.6); }
        if (food.active && !s.food) s.food = food.nearest(s.pos, 3.0, foodAvail);
        if (s.food) {
          if (!s.food.alive) s.food = null;
          else {
            _v2.copy(s.fwd).multiplyScalar(s.size * 0.45).add(s.pos);
            _d.addScaledVector(_v3.subVectors(s.food.pos, _v2), 2.4);
            if (_v2.distanceTo(s.food.pos) < 0.11) { food.eat(s.food); env.onEat(null, s.food.pos.clone()); s.food = null; }
          }
        }
        const sp = _d.length(), maxS = s.food ? 1.6 : 0.6;
        if (sp > maxS) _d.multiplyScalar(maxS / sp);
        s.steer(_d, dt).integrate(dt);
        s.pos.x += cur.x * 0.16 * dt; s.pos.z += cur.y * 0.16 * dt;
        clampAbove(s, 0.25);
      }
    }
    if (anthOInst) { anthOInst.begin(); for (const s of anthO) anthOInst.push(s); anthOInst.end(t); }
    if (anthPInst) { anthPInst.begin(); for (const s of anthP) anthPInst.push(s); anthPInst.end(t); }
  }

  function updateButterfly(dt, t) {
    for (const s of butter) {
      const r = s.r;
      s.timer -= dt;
      _d.set(0, 0, 0);
      if (s.lead) {
        // the partner follows close behind and slightly to the side
        _v1.copy(s.lead.pos).addScaledVector(s.lead.fwd, -0.45).add(_v2.set(-s.lead.fwd.z, 0.08, s.lead.fwd.x).multiplyScalar(0.3));
        s.seek(_v1, 0.9, 0.6, _d);
      } else {
        const it = food.active ? food.nearest(s.pos, 6, foodAvail) : null;
        if (it) {
          s.seek(it.pos, 1.3, 0.3, _d);
          _v1.copy(s.fwd).multiplyScalar(s.size * 0.45).add(s.pos);
          if (_v1.distanceTo(it.pos) < 0.14) { food.eat(it); env.onEat(null, it.pos.clone()); }
        } else {
          if (s.timer <= 0) {
            if (s.state === 'roam' && r.chance(0.5)) {
              s.state = 'graze'; s.timer = r.range(3, 6);
              const b = bommies[Math.floor(r.next() * bommies.length)];
              const a = r.range(0, TAU), rr = r.range(0.3, b.r * 1.3);
              const x = b.x + Math.cos(a) * rr, z = b.z + Math.sin(a) * rr;
              s.spot.set(x, hm.at(x, z), z);
              s.target.copy(s.spot).addScaledVector(hm.normal(x, z, _v3), 0.35);
            } else { s.state = 'roam'; s.timer = r.range(5, 10); randomReefPoint(r, s.target, 0.6, 2.2); }
          }
          if (s.state === 'graze' && s.pos.distanceTo(s.target) < 0.4) {
            _d.subVectors(s.spot, s.pos).normalize().multiplyScalar(0.06 + 0.05 * Math.max(0, Math.sin(t * 5 + s.phase)));
          } else s.seek(s.target, 0.45, 1.0, _d);
        }
      }
      avoid(s, _d, 0.3, dt);
      s.steer(_d, dt).integrate(dt);
      clampAbove(s, 0.3);
    }
    bfInst.begin(); for (const s of butter) bfInst.push(s); bfInst.end(t);
  }

  function updateCleaners(dt, t) {
    const cl = station.client;
    for (let i = 0; i < cleaners.length; i++) {
      const s = cleaners[i];
      if (cl && cl.state === 'cleaning') {
        // pick along the client's flanks, gills and fins
        const along = Math.sin(t * 0.7 + s.ph) * 0.42 * cl.size;
        const ang = t * (0.9 + i * 0.13) + s.ph;
        _v1.copy(cl.pos).addScaledVector(cl.fwd, along);
        _v2.set(-cl.fwd.z, 0, cl.fwd.x).normalize();
        _v1.addScaledVector(_v2, Math.cos(ang) * cl.size * 0.2).add(_v3.set(0, Math.sin(ang) * cl.size * 0.15, 0));
        s.seek(_v1, 0.9, 0.25, _d);
      } else {
        // dance at the station to advertise
        _v1.copy(station.wall).addScaledVector(station.out, 0.25 + 0.12 * Math.sin(t * 1.7 + s.ph));
        _v1.y += Math.sin(t * 2.1 + s.ph * 2) * 0.18 + s.k * 0.3;
        _v1.x += Math.cos(t * 1.3 + s.ph) * 0.2; _v1.z += Math.sin(t * 1.5 + s.ph) * 0.2;
        s.seek(_v1, 0.5, 0.3, _d);
      }
      s.steer(_d, dt).integrate(dt);
    }
    cleanerInst.begin(); for (const s of cleaners) cleanerInst.push(s); cleanerInst.end(t);
  }

  function updateJacks(dt, t) {
    const c = jackC, n = jacks.length;
    for (let i = 0; i < n; i++) {
      const s = jacks[i];
      const rx = s.pos.x - c.x, ry = s.pos.y - c.y, rz = s.pos.z - c.z;
      const rr = Math.hypot(rx, rz) + 1e-3;
      const R = 4.2 + Math.sin(t * 0.15 + i * 0.3) * 1.0;
      _d.set(-rz / rr * 1.1, 0, rx / rr * 1.1);
      _d.x += -rx / rr * (rr - R) * 0.5; _d.z += -rz / rr * (rr - R) * 0.5;
      _d.y = -ry * 0.35 + Math.sin(t * 0.4 + i) * 0.2;
      s.steer(_d, dt).integrate(dt);
    }
    c.x += Math.sin(t * 0.02) * dt * 0.2;
    jackInst.begin(); for (const s of jacks) jackInst.push(s); jackInst.end(t);
  }

  function updateBarra(dt, t) {
    if (!barraInst) return;
    for (const b of barra) {
      b.timer -= dt;
      const it = food.active ? food.nearest(b.pos, 6, foodAvail) : null;
      let speed = 0.5;
      b.cleanT = (b.cleanT ?? (20 + barra.indexOf(b) * 35)) - dt;
      if (!it && b.cleanT < 0 && !station.client) { station.client = b; b.state = 'toStation'; }
      if (station.client === b && !it) {
        if (b.state === 'toStation') {
          b.seek(station.hover, 0.5, 2.0, _d);
          if (b.pos.distanceTo(station.hover) < 0.5) { b.state = 'cleaning'; b.cleanDur = 14 + Math.random() * 6; }
        } else {
          // hover still, nose slightly up, while the wrasse work
          _d.subVectors(station.hover, b.pos).multiplyScalar(0.6);
          _d.addScaledVector(_v2.set(-station.out.x, 0.25, -station.out.z), 0.02);
          b.cleanDur -= dt;
          if (b.cleanDur < 0) { station.client = null; b.state = 'cruise'; b.cleanT = 60 + Math.random() * 60; b.timer = 0; }
        }
        avoid(b, _d, 0.7, dt);
        b.steer(_d, dt).integrate(dt);
        b.amp *= b.state === 'cleaning' ? 0.4 : 1;
        continue;
      }
      if (station.client === b) { station.client = null; b.state = 'cruise'; }
      if (it) {
        b.target.copy(it.pos); speed = 1.2;
        _v1.copy(b.fwd).multiplyScalar(b.size * 0.48).add(b.pos);
        if (_v1.distanceTo(it.pos) < 0.2) { food.eat(it); env.onEat(null, it.pos.clone()); }
      } else if (b.timer <= 0 || b.pos.distanceTo(b.target) < 2) {
        b.timer = 10 + Math.random() * 12;
        const a = Math.random() * TAU, r = 6 + Math.random() * 9;
        b.target.set(center.x + Math.cos(a) * r, 0, center.z + Math.sin(a) * r);
        b.target.y = floorAt(b.target.x, b.target.z) + 1.4 + Math.random() * 2.5;
      }
      b.seek(b.target, speed, 3, _d);
      avoid(b, _d, 0.7, dt);
      b.steer(_d, dt).integrate(dt);
      clampAbove(b, 0.6);
    }
    barraInst.begin();
    for (const b of barra) barraInst.push(b);
    barraInst.end(t);
  }

  return {
    group, food, residents, turtles, school, schoolC, barra, silver, silCenter, hoverGroups, butter, station, jackC,
    addMember(m) { addResident(m); },
    update(dt, t) {
      time = t;
      food.update(dt, t, floorAt, W.uCurDir.value);
      updateResidents(dt, t);
      updateTurtles(dt, t);
      updateSchool(dt, t);
      updateSilver(dt, t);
      updateBarra(dt, t);
      updateHover(dt, t);
      updateButterfly(dt, t);
      updateCleaners(dt, t);
      updateJacks(dt, t);
    },
    spawnFood(center, n) { return food.spawnCloud(center, n, rng, floorAt, surfY); },
    dispose() {
      for (const d of disposables) d.dispose?.();
      for (const tu of turtles) tu.t.dispose();
    },
  };
}
