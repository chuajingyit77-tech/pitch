// 深蓝 · 珊瑚礁 — an underwater coral reef garden on a sandy slope (ABZÛ / Endless Ocean mood).
// Modules: reef/uw.js (water volume), reef/terrain.js (seabed, rocks, height map), reef/corals.js
// (the living reef), reef/life.js (fish, turtles, feeding), reef/pelagic.js (manta, jellies),
// reef/giant.js (the whale shark that passes through the blue every few minutes).
import * as THREE from 'three';
import { clamp, lerp, smoothstep, damp, TAU } from '../lib/util.js';
import { createWaterUniforms, setWaterTime, createBackground, createSurface, createShafts, createSnow, createGlow, createBubbles, createEnvBuilder, DETAIL } from './reef/uw.js';
import { createGround, buildTerrain, buildRocks, HeightMap } from './reef/terrain.js';
import { buildReef } from './reef/corals.js';
import { createLife } from './reef/life.js';
import { Manta, Jellies } from './reef/pelagic.js';
import { WhaleShark } from './reef/giant.js';
import { Cuttlefish } from './reef/cuttle.js';

const SURF_Y = 12;
const REF_Y = 0.5;

const C = (hex) => new THREE.Color(hex);
const lin = (r, g, b) => new THREE.Vector3(r, g, b);

export default {
  id: 'reef',
  food: '鱼食',
  kinds: {
    clownfish: { zh: '小丑鱼' }, blueTang: { zh: '蓝吊' }, yellowTang: { zh: '黄金吊' },
    moorishIdol: { zh: '镰鱼' }, emperorAngel: { zh: '皇后神仙鱼' }, turtle: { zh: '海龟' },
  },
  starter: ['clownfish', 'clownfish', 'blueTang', 'yellowTang', 'moorishIdol', 'emperorAngel', 'turtle'],
  addable: ['clownfish', 'blueTang', 'yellowTang', 'moorishIdol', 'emperorAngel', 'blueTang', 'yellowTang', 'turtle'],
  maxMembers: 16,
  ambience: ['underwater'],
  eatSound: 'eat',

  async create(env) {
    const rng = env.rng;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#05202e');
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    const W = createWaterUniforms(SURF_Y, REF_Y);
    const disposeList = [];
    DETAIL.on = env.quality !== 'low';

    /* ---------------- ground, rocks, reef ---------------- */
    const ground = createGround(env.seed ^ 0x2f1, SURF_Y);
    const hm = new HeightMap(ground, 26, 0.3);
    const terrain = buildTerrain(ground, W, env);
    scene.add(terrain);
    const rocks = buildRocks(ground, hm, W, env, rng.fork('rocks'));
    scene.add(rocks.group);
    const reef = buildReef({ W, env, hm, ground, rocks, rng: rng.fork('reef') });
    scene.add(reef.group);
    const mainB = rocks.bommies.find(b => b.main) || rocks.bommies[0];
    const an0 = reef.anemones[0];
    const center = new THREE.Vector3(0, 0, 0);
    center.y = ground.height(0, 0);
    const floorAt = (x, z) => hm.at(x, z);

    /* ---------------- water volume ---------------- */
    const bg = createBackground(W);
    bg.name = 'waterDome';
    scene.add(bg);
    const n1 = env.loadTexture('textures/Water_1_M_Normal.jpg', { srgb: false, repeat: true });
    const n2 = env.loadTexture('textures/Water_2_M_Normal.jpg', { srgb: false, repeat: true });
    disposeList.push(n1, n2);
    const surface = createSurface(W, n1, n2);
    surface.name = 'surface';
    scene.add(surface);
    const shafts = createShafts(W, rng.fork('shafts'), { count: Math.round(34 * Math.max(0.5, env.q)), radius: 24, center, far: Math.round(9 * Math.max(0.55, env.q)), frng: rng.fork('farShafts') });
    scene.add(shafts.mesh);
    const snow = createSnow(W, rng.fork('snow'), { count: Math.round(1800 * env.q) });
    scene.add(snow.mesh);
    // glowing plankton at night (drawn only after dusk; shown for the first frames so it compiles with the rest)
    const glow = createGlow(W, rng.fork('glow'), { count: Math.round(2600 * Math.max(0.45, env.q)) });
    glow.mesh.name = 'plankton';
    scene.add(glow.mesh);
    let warmFrames = 6;
    const bubbleSrc = [];
    if (an0) bubbleSrc.push(an0.pos.clone().add(new THREE.Vector3(0.7, -0.2, 0.3)));
    for (const b of rocks.bommies.slice(1)) {
      const a = rng.range(0, TAU);
      const x = b.x + Math.cos(a) * b.r * 0.8, z = b.z + Math.sin(a) * b.r * 0.8;
      bubbleSrc.push(new THREE.Vector3(x, ground.height(x, z) + 0.05, z));
    }
    const bubbles = createBubbles(W, rng.fork('bub'), bubbleSrc.slice(0, 3), Math.round(40 * Math.max(0.5, env.q)));
    scene.add(bubbles.mesh);

    /* ---------------- lights ---------------- */
    const hemi = new THREE.HemisphereLight('#7fd6e0', '#2a4a50', 1.5);
    scene.add(hemi);
    const sunL = new THREE.DirectionalLight('#ffffff', 3);
    sunL.castShadow = env.shadows;
    const sm = env.q >= 0.9 ? 2048 : 1024;
    sunL.shadow.mapSize.set(sm, sm);
    Object.assign(sunL.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 90 });
    sunL.shadow.bias = -0.0004;
    sunL.shadow.normalBias = 0.03;
    sunL.shadow.radius = 3;
    sunL.target.position.copy(center);
    scene.add(sunL, sunL.target);
    const envB = createEnvBuilder(env.pmrem, W);

    /* ---------------- life ---------------- */
    const tod = { hours: -99, envHours: -99, sunW: new THREE.Vector3(0, 1, 0), axis: new THREE.Vector3(0, -1, 0), night: 0, day: 1, golden: 0 };
    // the whale shark's state (filled in by reef/giant.js each frame): the schools part round it
    const giantState = { on: false, head: new THREE.Vector3(), tail: new THREE.Vector3(), mid: new THREE.Vector3(), fwd: new THREE.Vector3(1, 0, 0), r: 1, vis: 0, speed: 0 };
    const life = await createLife({ W, env, hm, scene, anemones: reef.anemones, bommies: rocks.bommies, surfY: SURF_Y, camera, center, thickets: reef.thickets, tod, giant: giantState });
    life.group.name = 'life';
    scene.add(life.group);
    const manta = new Manta(W, rng.fork('manta'), center);
    manta.mesh.name = 'manta';
    scene.add(manta.mesh);
    const eagle = new Manta(W, rng.fork('eagle'), center, { eagle: true });
    eagle.mesh.name = 'eagleRay';
    scene.add(eagle.mesh);
    const jellies = new Jellies(W, rng.fork('jelly'), Math.round(9 * Math.max(0.5, env.q)), center);
    jellies.group.name = 'jellies';
    scene.add(jellies.group);

    /* ---------------- time of day ---------------- */
    const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _v = new THREE.Vector3(), _v2 = new THREE.Vector2();
    const refract = (d, out) => {
      const h = Math.hypot(d.x, d.z);
      if (h < 1e-5) return out.set(0, 1, 0);
      const hw = Math.min(h, 1) / 1.333, yw = Math.sqrt(1 - hw * hw);
      return out.set((d.x / h) * hw, yw, (d.z / h) * hw);
    };
    const pal = {
      day: { L0: lin(0.022, 0.21, 0.4), glow: lin(0.9, 1.0, 0.95), light: 5.6, lightCol: C('#f4fbff'), hemi: 0.78, sky: C('#b8dcdc'), gnd: C('#5c6658'), shaft: lin(0.55, 0.85, 0.95), caus: 1.0 },
      gold: { L0: lin(0.04, 0.135, 0.27), glow: lin(2.6, 1.05, 0.4), light: 3.4, lightCol: C('#ffc890'), hemi: 0.78, sky: C('#a8b8c8'), gnd: C('#4a4840'), shaft: lin(1.35, 0.78, 0.38), caus: 0.85 },
      night: { L0: lin(0.004, 0.02, 0.065), glow: lin(0.3, 0.45, 0.9), light: 0.75, lightCol: C('#9db8ff'), hemi: 0.45, sky: C('#4a6aa8'), gnd: C('#10203a'), shaft: lin(0.22, 0.36, 0.65), caus: 0.35 },
    };
    const mkP = () => ({ L0: lin(0, 0, 0), glow: lin(0, 0, 0), light: 0, lightCol: C('#fff'), hemi: 0, sky: C('#fff'), gnd: C('#fff'), shaft: lin(0, 0, 0), caus: 0 });
    const mixP = (a, b, t, out) => {
      out.L0.copy(a.L0).lerp(b.L0, t); out.glow.copy(a.glow).lerp(b.glow, t);
      out.light = lerp(a.light, b.light, t); out.lightCol.copy(a.lightCol).lerp(b.lightCol, t);
      out.hemi = lerp(a.hemi, b.hemi, t); out.sky.copy(a.sky).lerp(b.sky, t); out.gnd.copy(a.gnd).lerp(b.gnd, t);
      out.shaft.copy(a.shaft).lerp(b.shaft, t); out.caus = lerp(a.caus, b.caus, t);
      return out;
    };
    const cur = mkP(), tmpP = mkP();
    // Targets are evaluated when the clock moves (once a minute). Brightness and colour then ease toward
    // them (~1 s), so dusk and dawn glide instead of stepping every minute; directions (light, shadows,
    // caustic projection, shafts) still step in their tiny per-minute increments, as the shell intends.
    const mkT = () => ({ L0: lin(0, 0, 0), glow: lin(0, 0, 0), caus: 0, fluor: 0, lightCol: C('#fff'), light: 0, sky: C('#fff'), gnd: C('#fff'), hemi: 0,
      sunCol: C('#fff'), sunI: 0, skyZen: C('#fff'), skyHor: C('#fff'), shaftCol: C('#fff'), shaftI: 0, bio: 0, night: 0, day: 1, golden: 0 });
    const tgt = mkT(), app = mkT();
    const NUM = ['caus', 'fluor', 'light', 'hemi', 'sunI', 'shaftI', 'bio', 'night', 'day', 'golden'];
    const VEC = ['L0', 'glow', 'lightCol', 'sky', 'gnd', 'sunCol', 'skyZen', 'skyHor', 'shaftCol'];
    const su = surface.userData.u;
    let todSettled = false;
    // Light direction (refracted sun or moon): targets step with the clock, the applied direction eases
    // toward them, so the dusk/dawn swing over the zenith slides shadows, caustics and shafts instead of
    // jumping (outside twilight a step is a fraction of a degree and the glide is invisible).
    const dirA = new THREE.Vector3(0, 1, 0), airT = new THREE.Vector3(0, 1, 0), airA = new THREE.Vector3(0, 1, 0);
    const _sunR = new THREE.Vector3(), _moonR = new THREE.Vector3();
    let dirSettled = false;
    function applyDir() {
      W.uSunW.value.copy(dirA);
      shafts.u.uAxis.value.copy(dirA).negate();
      sunL.position.copy(center).addScaledVector(dirA, 45);
      su.uSunAir.value.copy(airA);
    }
    function glideDir(k) {
      if (dirSettled) return;
      dirA.lerp(tod.sunW, k).normalize();
      airA.lerp(airT, k);
      if (airA.lengthSq() < 1e-8) airA.set(0, 1, 0); else airA.normalize();
      if (dirA.angleTo(tod.sunW) < 2e-4 && airA.angleTo(airT) < 2e-4) { dirA.copy(tod.sunW); airA.copy(airT); dirSettled = true; }
      applyDir();
    }
    function blendTod(k) {
      if (todSettled) return;
      let err = 0;
      for (const n of NUM) { app[n] += (tgt[n] - app[n]) * k; err = Math.max(err, Math.abs(tgt[n] - app[n])); }
      for (const n of VEC) {
        const a = app[n], b = tgt[n];
        if (a.isColor) { a.r += (b.r - a.r) * k; a.g += (b.g - a.g) * k; a.b += (b.b - a.b) * k; err = Math.max(err, Math.abs(b.r - a.r), Math.abs(b.g - a.g), Math.abs(b.b - a.b)); }
        else { a.lerp(b, k); err = Math.max(err, Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z)); }
      }
      if (err < 1e-5) todSettled = true;
      W.uL0.value.copy(app.L0);
      W.uGlow.value.copy(app.glow);
      W.uCaustic.value = app.caus;
      W.uFluor.value = app.fluor;
      sunL.color.copy(app.lightCol);
      sunL.intensity = app.light;
      hemi.color.copy(app.sky); hemi.groundColor.copy(app.gnd); hemi.intensity = app.hemi;
      su.uSunCol.value.copy(app.sunCol);
      su.uSunI.value = app.sunI;
      su.uSkyZen.value.copy(app.skyZen);
      su.uSkyHor.value.copy(app.skyHor);
      shafts.u.uShaftCol.value.copy(app.shaftCol);
      shafts.u.uShaftI.value = app.shaftI;
      snow.u.uBio.value = app.bio;
      tod.night = app.night; tod.day = app.day; tod.golden = app.golden;
      applyEnvScale();
    }
    // Reflections: the environment map is built from the minute's targets while the rest eases toward
    // them, so every material's envMapIntensity follows (eased L0 / L0 the map was built with).
    const envMats = new Map();
    const collectEnvMats = () => scene.traverse(o => {
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
        if (m.isMeshStandardMaterial && !envMats.has(m)) envMats.set(m, m.envMapIntensity);
      }
    });
    const lumV = v => 0.2126 * v.x + 0.7152 * v.y + 0.0722 * v.z;
    let envScale = 1;
    function applyEnvScale() {
      const k = lumV(app.L0) / Math.max(lumV(envLast.L0), 1e-5);
      if (Math.abs(k - envScale) < 1e-4) return;
      envScale = k;
      for (const [m, base] of envMats) m.envMapIntensity = base * k;
    }
    // The environment map is rebuilt from the targets whenever they have moved enough to matter (at
    // most once a clock minute, mostly around dawn and dusk) instead of in a visible step every 12 min.
    const envLast = { L0: lin(-1, -1, -1), glow: lin(-1, -1, -1), sunW: new THREE.Vector3(0, -1, 0) };
    const _keepL0 = new THREE.Vector3(), _keepGlow = new THREE.Vector3();
    function envMoved() {
      let d = 1 - tod.sunW.dot(envLast.sunW) > 0.0014; // ~3 degrees
      for (const k of ['x', 'y', 'z']) {
        if (Math.abs(tgt.L0[k] - envLast.L0[k]) > Math.max(envLast.L0[k], 0.004) * 0.04) d = true;
        if (Math.abs(tgt.glow[k] - envLast.glow[k]) > 0.06) d = true;
      }
      return d;
    }
    function rebuildEnv() {
      envLast.L0.copy(tgt.L0); envLast.glow.copy(tgt.glow); envLast.sunW.copy(tod.sunW);
      _keepL0.copy(W.uL0.value); _keepGlow.copy(W.uGlow.value);
      W.uL0.value.copy(tgt.L0); W.uGlow.value.copy(tgt.glow); W.uSunW.value.copy(tod.sunW);
      envB.u.uEnvY.value = 4;
      envB.u.uWin.value.setRGB(tgt.L0.x, tgt.L0.y, tgt.L0.z).multiplyScalar(3);
      const r = envB.build();
      scene.environment = r.texture;
      r.old?.dispose();
      W.uL0.value.copy(_keepL0); W.uGlow.value.copy(_keepGlow); W.uSunW.value.copy(dirA);
    }
    const groundAt = (x, z) => ground.height(x, z);

    function applyTod(force) {
      const h = env.hours();
      if (!force && Math.abs(h - tod.hours) < 0.003) return;
      // a changed clock setting (or the first frame) snaps; the minute tick glides
      const jump = force || Math.abs(h - tod.hours) > 0.25;
      tod.hours = h;
      const s = env.sun();
      mixP(pal.night, pal.day, s.day, tmpP);
      mixP(tmpP, pal.gold, Math.min(1, s.golden * 1.1), cur);
      // Sun and moon hand over around -3 deg. This used to flip the light direction (shadows, caustics,
      // shafts, glow, sun disc) and step glow, shafts and the disc in a single frame. Now the light
      // swings from the sun's side over the zenith to the moon's between -5 and -1 deg, and every
      // sun/moon quantity blends with the same weight; no dark gap, no jump.
      const u = smoothstep(-5, -1, s.elevationDeg);
      refract(s.dir, _sunR); refract(s.moonDir, _moonR);
      tod.sunW.copy(_moonR).lerp(_sunR, u).normalize();
      tod.axis.copy(tod.sunW).negate();
      airT.copy(s.moonDir).lerp(s.dir, u);
      if (airT.lengthSq() < 1e-8) airT.set(0, 1, 0); else airT.normalize();
      shafts.setLengths(tod.axis, groundAt, jump);
      dirSettled = false;
      if (jump) { dirA.copy(tod.sunW); airA.copy(airT); dirSettled = true; applyDir(); }
      tgt.L0.copy(cur.L0);
      tgt.glow.copy(cur.glow).multiplyScalar(lerp(0.5, 1, u));
      tgt.caus = cur.caus;
      tgt.fluor = smoothstep(0.2, 0.9, s.night) * 0.32;
      tgt.lightCol.copy(cur.lightCol);
      tgt.light = cur.light;
      tgt.sky.copy(cur.sky); tgt.gnd.copy(cur.gnd); tgt.hemi = cur.hemi;
      tgt.sunCol.copy(_c1.set('#c8d8ff')).lerp(s.sunColor, u);
      tgt.sunI = lerp(0.08, s.sunIntensity * 0.6, u);
      tgt.skyZen.copy(s.zenith).multiplyScalar(lerp(0.15, 1.1, s.day));
      tgt.skyHor.copy(s.horizon).multiplyScalar(lerp(0.15, 1.1, s.day));
      tgt.shaftCol.setRGB(cur.shaft.x, cur.shaft.y, cur.shaft.z);
      tgt.shaftI = lerp(0.35, 1.0, s.day) * lerp(0.6, 1, u);
      tgt.bio = smoothstep(0.3, 1, s.night);
      tgt.night = s.night; tgt.day = s.day; tgt.golden = s.golden;
      todSettled = false;
      if (jump || envMoved()) rebuildEnv();
      if (jump) blendTod(1);
    }
    collectEnvMats();
    applyTod(true);

    /* ---------------- camera + post ---------------- */
    const tgtY = clamp(hm.at(0, 0) + 0.2, 1.6, 3.4);
    const view = {
      target: new THREE.Vector3(mainB.x * 0.4, tgtY, mainB.z * 0.4), dist: 14, distRange: [8, 17],
      yaw: rng.range(0, TAU), yawRange: null,
      pitch: 0.16, pitchRange: [-0.1, 0.55],
      drift: 0.035, idlePitch: 0.15, fov: 45, minY: -1,
    };
    /* ---------------- the gentle giant ---------------- */
    // kept clear of the haze pinnacles and the kelp; planned against this view when each visit starts
    // (rounded rocks: an ellipsoid round each, a little larger than the displaced rock template)
    const obstacles = rocks.far.map(f => ({ x: f.pos.x, z: f.pos.z, y: f.pos.y, r: Math.max(f.scale.x, f.scale.z) * 1.3, ry: f.scale.y * 1.35 }));
    for (const k of reef.kelpClumps || []) obstacles.push(k);
    // the manta's visits are predictable: the giant's path keeps clear of it (moving obstacle)
    const movers = [{ r: manta.scale + 2.2, predict: (ahead, out) => manta.predict(ahead, out) }];
    const giant = new WhaleShark({ W, env, camera, view, floorAt, surfY: SURF_Y, obstacles, movers, rng: rng.fork('giant'), state: giantState });
    scene.add(giant.group);

    /* ---------------- a cuttlefish on the coral head that faces the default view ---------------- */
    const cutHome = (() => {
      const dx = Math.sin(view.yaw), dz = Math.cos(view.yaw);   // from the reef toward the camera
      const x = mainB.x + dx * (mainB.r + 0.7) - dz * 1.1, z = mainB.z + dz * (mainB.r + 0.7) + dx * 1.1;
      return new THREE.Vector3(x, hm.at(x, z), z);
    })();
    const cuttle = new Cuttlefish({ W, rng: rng.fork('cuttle'), floorAt, home: cutHome, seed: env.seed >>> 0 });
    scene.add(cuttle.mesh);
    collectEnvMats();
    for (const [mat, base] of envMats) mat.envMapIntensity = base * envScale;

    const post = {
      bloom: { strength: 0.3, radius: 0.7, threshold: 0.8 },
      exposure: 1.0, toneMapping: 'aces',
      vignette: 0.45, grain: 0.02, saturation: 1.1, contrast: 1.06,
      lift: [0.0, 0.012, 0.022], gain: [1, 1, 1], ca: 0.0015,
    };

    /* ---------------- feeding ---------------- */
    const _hit = new THREE.Vector3();
    function rayHit(ray, out) {
      for (let s = 0.5; s < 45; s += 0.12) {
        ray.at(s, out);
        if (out.y > SURF_Y) return null;
        if (out.y <= hm.at(out.x, out.z)) return out;
      }
      return null;
    }
    function dropAt(p, n) {
      p.y = clamp(p.y, hm.at(p.x, p.z) + 0.7, SURF_Y - 0.8);
      const made = life.spawnFood(p, n);
      if (made) env.sfx('drop');
      return made;
    }

    /* ---------------- garden eels: duck when something big passes over ---------------- */
    const eelNight = () => smoothstep(0.25, 0.75, tod.night);
    function updateEels(dt) {
      for (const c of reef.eelColonies || []) {
        let threat = 0;
        const g = giantState;
        if (g.on) {
          // horizontal distance from the colony to the shark's body (tail .. snout)
          const bx = g.head.x - g.tail.x, bz = g.head.z - g.tail.z, px = c.x - g.tail.x, pz = c.z - g.tail.z;
          const u = clamp((px * bx + pz * bz) / Math.max(bx * bx + bz * bz, 1e-6), 0, 1);
          threat = smoothstep(11, 6.5, Math.hypot(px - bx * u, pz - bz * u)) * g.vis;
        }
        threat = Math.max(threat, smoothstep(4.6, 2.6, Math.hypot(eagle.pos.x - c.x, eagle.pos.z - c.z)));
        const want = Math.max(threat > 0.15 ? 1 : 0, eelNight());
        c.duck = c.init ? damp(c.duck, want, want > c.duck ? 5 : 0.3, dt) : want;   // a night-time visit starts with them in
        c.init = true;
        c.u.value.set(c.x, c.z, c.duck, 0);
      }
    }

    /* ---------------- hover tags ---------------- */
    const tagCache = [];
    const tag = (i) => (tagCache[i] || (tagCache[i] = { member: null, label: null, pos: null, radius: 0.5 }));

    let time = 0;
    return {
      scene, camera, view, post,
      debug: { anemones: reef.anemones, bommies: rocks.bommies, life, manta, eagle, hm, giant, cuttle },
      /** Test hook: start a whale-shark visit now and jump to t s from its closest pass (0 = crossing the view). */
      debugGiant(t = 0) { return giant.debug(t); },
      update(dt, t) {
        time += dt;
        setWaterTime(W, time);
        snow.syncHi(W.uTimeHi.value);
        glow.syncHi(W.uTimeHi.value);
        bubbles.syncHi(W.uTimeHi.value);
        applyTod(false);
        blendTod(1 - Math.exp(-dt / 1.2));
        glideDir(1 - Math.exp(-dt / 2.5));
        shafts.tick(dt);
        bg.position.copy(camera.position);
        surface.position.set(camera.position.x, SURF_Y, camera.position.z);
        const ph = env.renderer.getDrawingBufferSize(_v2).y || 720;
        const sc = ph / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
        snow.u.uScale.value = sc; bubbles.u.uScale.value = sc; glow.u.uScale.value = sc;
        view.minY = hm.at(camera.position.x, camera.position.z) + 1.1;
        giant.update(dt, time);
        life.update(dt, time);
        // the manta waits while the whale shark has the stage
        if (manta.active || !giant.active) manta.update(dt, time);
        eagle.update(dt, time, floorAt);
        jellies.update(dt, time, tod.night, floorAt, giantState);
        cuttle.update(dt, time, { night: tod.night, giant: giantState, food: life.food, camera });
        // plankton: night only (kept on for the first frames so its program compiles under the veil)
        glow.u.uBio.value = smoothstep(0.25, 0.9, tod.night);
        camera.getWorldDirection(_v);
        glow.u.uBoxC.value.copy(camera.position).addScaledVector(_v, 8);
        giant.setNight(glow.u.uBio.value);
        glow.mesh.visible = glow.u.uBio.value > 0.004 || warmFrames > 0;
        if (giantState.on) { glow.u.uGiantA.value.set(giantState.tail.x, giantState.tail.y, giantState.tail.z, giantState.vis); glow.u.uGiantB.value.set(giantState.head.x, giantState.head.y, giantState.head.z, giantState.r); }
        else glow.u.uGiantA.value.w = 0;
        // Things that start hidden (the manta between visits, the jellies by day, the plankton) would compile
        // their shaders when they first appear, mid-play (a visible stall on Safari 14). For the frames before
        // the world is revealed they are drawn: the manta far out of sight, the others at zero light.
        if (warmFrames > 0) {
          warmFrames--;
          if (!manta.active) { manta.mesh.visible = warmFrames > 0; manta.mesh.position.set(0, -500, 0); }
          if (!jellies.group.visible) jellies.group.visible = warmFrames > 0;
        }
        updateEels(dt);
        post.bloom.strength = lerp(0.3, 0.62, tod.night);
        post.bloom.threshold = lerp(0.8, 0.48, tod.night);
        post.exposure = lerp(1.0, 1.3, tod.night);
      },
      feed(raycaster) {
        const hit = rayHit(raycaster.ray, _hit);
        const p = new THREE.Vector3();
        if (hit) {
          p.copy(hit).addScaledVector(raycaster.ray.direction, -Math.min(2.0, hit.distanceTo(raycaster.ray.origin) * 0.2));
          p.y += 1.4;
        } else raycaster.ray.at(8, p);
        const n = 6 + Math.floor(Math.random() * 5);
        return dropAt(p, n) ? p : null;
      },
      feedRandom(n) {
        camera.getWorldDirection(_v);
        let made = 0;
        for (let k = 0; k < 3; k++) {
          const p = new THREE.Vector3(view.target.x, 0, view.target.z).addScaledVector(_v, -2.5 + k * 0.8);
          p.x += (Math.random() - 0.5) * 3; p.z += (Math.random() - 0.5) * 3;
          p.y = hm.at(p.x, p.z) + 1.8 + Math.random();
          made += dropAt(p, Math.ceil(n / 2) + 1);
        }
        return made ? n : 0;
      },
      addMember(m) { life.addMember(m); collectEnvMats(); for (const [mat, base] of envMats) mat.envMapIntensity = base * envScale; },
      creatures() {
        let i = 0;
        for (const f of life.residents) { const c = tag(i++); c.member = f.m; c.label = null; c.pos = f.sw.pos; c.radius = Math.max(0.35, f.size * 0.9); }
        for (const tu of life.turtles) { const c = tag(i++); c.member = tu.m; c.label = null; c.pos = tu.pos; c.radius = 0.8 * tu.size; }
        { const c = tag(i++); c.member = null; c.label = '青魔鱼群'; c.pos = life.schoolC; c.radius = 1.4; }
        { const c = tag(i++); c.member = null; c.label = '银汉鱼群'; c.pos = life.silCenter; c.radius = 2.0; }
        for (const b of life.barra) { const c = tag(i++); c.member = null; c.label = '尖吻鲈'; c.pos = b.pos; c.radius = 0.6; }
        if (manta.mesh.visible) { const c = tag(i++); c.member = null; c.label = '蝠鲼'; c.pos = manta.pos; c.radius = 2.2; }
        { const c = tag(i++); c.member = null; c.label = '乌贼'; c.pos = cuttle.pos; c.radius = 0.45; }
        if (giant.active && giant.state.vis > 0.3) { const c = tag(i++); c.member = null; c.label = '鲸鲨'; c.pos = giant.pos; c.radius = giant.TL * 0.3; }
        { const c = tag(i++); c.member = null; c.label = '鹰鳐'; c.pos = eagle.pos; c.radius = 1.0; }
        for (const g of life.hoverGroups) { if (g.kind !== 'anthias') continue; const c = tag(i++); c.member = null; c.label = '金拟花鮨'; c.pos = g.c; c.radius = 1.3; }
        if (life.butter[0]) { const c = tag(i++); c.member = null; c.label = '蝴蝶鱼'; c.pos = life.butter[0].pos; c.radius = 0.5; }
        { const c = tag(i++); c.member = null; c.label = '清洁站 · 裂唇鱼'; c.pos = life.station.wall; c.radius = 0.6; }
        { const c = tag(i++); c.member = null; c.label = '鲹鱼群'; c.pos = life.jackC; c.radius = 4.0; }
        { const c = tag(i++); c.member = null; c.label = '梅鲷鱼群'; c.pos = life.fus.c; c.radius = 2.5; }
        return tagCache.slice(0, i);
      },
      dispose() {
        envB.dispose();
        giant.dispose();
        cuttle.dispose();
        life.dispose();
        for (const t of disposeList) t.dispose?.();
      },
    };
  },
};
