// 深蓝 · 珊瑚礁 — an underwater coral reef garden on a sandy slope (ABZÛ / Endless Ocean mood).
// Modules: reef/uw.js (water volume), reef/terrain.js (seabed, rocks, height map), reef/corals.js
// (the living reef), reef/life.js (fish, turtles, feeding), reef/pelagic.js (manta, jellies).
import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU } from '../lib/util.js';
import { createWaterUniforms, createBackground, createSurface, createShafts, createSnow, createBubbles, createEnvBuilder } from './reef/uw.js';
import { createGround, buildTerrain, buildRocks, HeightMap } from './reef/terrain.js';
import { buildReef } from './reef/corals.js';
import { createLife } from './reef/life.js';
import { Manta, Jellies } from './reef/pelagic.js';

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
    scene.add(bg);
    const n1 = env.loadTexture('textures/Water_1_M_Normal.jpg', { srgb: false, repeat: true });
    const n2 = env.loadTexture('textures/Water_2_M_Normal.jpg', { srgb: false, repeat: true });
    disposeList.push(n1, n2);
    const surface = createSurface(W, n1, n2);
    scene.add(surface);
    const shafts = createShafts(W, rng.fork('shafts'), { count: Math.round(34 * Math.max(0.5, env.q)), radius: 24, center });
    scene.add(shafts.mesh);
    const snow = createSnow(W, rng.fork('snow'), { count: Math.round(1800 * env.q) });
    scene.add(snow.mesh);
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
    const life = await createLife({ W, env, hm, scene, anemones: reef.anemones, bommies: rocks.bommies, surfY: SURF_Y, camera, center, thickets: reef.thickets, tod });
    scene.add(life.group);
    const manta = new Manta(W, rng.fork('manta'), center);
    scene.add(manta.mesh);
    const eagle = new Manta(W, rng.fork('eagle'), center, { eagle: true });
    scene.add(eagle.mesh);
    const jellies = new Jellies(W, rng.fork('jelly'), Math.round(9 * Math.max(0.5, env.q)), center);
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
      day: { L0: lin(0.03, 0.26, 0.42), glow: lin(0.9, 1.0, 0.95), light: 4.8, lightCol: C('#f2fbff'), hemi: 1.05, sky: C('#b8dcdc'), gnd: C('#5c6658'), shaft: lin(0.55, 0.85, 0.9), caus: 1.0 },
      gold: { L0: lin(0.05, 0.16, 0.22), glow: lin(1.7, 0.85, 0.42), light: 2.2, lightCol: C('#ffd2a0'), hemi: 0.95, sky: C('#a6c4c4'), gnd: C('#45504c'), shaft: lin(1.0, 0.7, 0.4), caus: 0.75 },
      night: { L0: lin(0.002, 0.012, 0.04), glow: lin(0.25, 0.4, 0.8), light: 0.5, lightCol: C('#9db8ff'), hemi: 0.32, sky: C('#3a5c9a'), gnd: C('#0c1a2a'), shaft: lin(0.18, 0.3, 0.55), caus: 0.3 },
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

    function applyTod(force) {
      const h = env.hours();
      if (!force && Math.abs(h - tod.hours) < 0.003) return;
      tod.hours = h;
      const s = env.sun();
      tod.day = s.day; tod.night = s.night; tod.golden = s.golden;
      mixP(pal.night, pal.day, s.day, tmpP);
      mixP(tmpP, pal.gold, s.golden * 0.85, cur);
      const useSun = s.elevationDeg > -3;
      refract(useSun ? s.dir : s.moonDir, tod.sunW);
      tod.axis.copy(tod.sunW).negate();
      W.uSunW.value.copy(tod.sunW);
      W.uL0.value.copy(cur.L0);
      W.uGlow.value.copy(cur.glow).multiplyScalar(useSun ? 1 : 0.5);
      W.uCaustic.value = cur.caus;
      W.uFluor.value = smoothstep(0.2, 0.9, s.night);
      sunL.color.copy(cur.lightCol);
      sunL.intensity = cur.light;
      sunL.position.copy(center).addScaledVector(tod.sunW, 45);
      hemi.color.copy(cur.sky); hemi.groundColor.copy(cur.gnd); hemi.intensity = cur.hemi;
      const su = surface.userData.u;
      su.uSunAir.value.copy(useSun ? s.dir : s.moonDir);
      su.uSunCol.value.copy(useSun ? s.sunColor : _c1.set('#c8d8ff'));
      su.uSunI.value = useSun ? s.sunIntensity * 0.6 : 0.08;
      su.uSkyZen.value.copy(s.zenith).multiplyScalar(lerp(0.15, 1.1, s.day));
      su.uSkyHor.value.copy(s.horizon).multiplyScalar(lerp(0.15, 1.1, s.day));
      shafts.u.uAxis.value.copy(tod.axis);
      _c2.setRGB(cur.shaft.x, cur.shaft.y, cur.shaft.z);
      shafts.u.uShaftCol.value.copy(_c2);
      shafts.u.uShaftI.value = lerp(0.35, 1.0, s.day) * (useSun ? 1 : 0.6);
      shafts.setLengths(tod.axis, (x, z) => ground.height(x, z));
      snow.u.uBio.value = smoothstep(0.3, 1, s.night);
      if (force || Math.abs(h - tod.envHours) > 0.2) {
        tod.envHours = h;
        envB.u.uEnvY.value = 4;
        envB.u.uWin.value.setRGB(cur.L0.x, cur.L0.y, cur.L0.z).multiplyScalar(3);
        const r = envB.build();
        scene.environment = r.texture;
        r.old?.dispose();
      }
    }
    applyTod(true);

    /* ---------------- camera + post ---------------- */
    const tgtY = clamp(hm.at(0, 0) + 0.2, 1.6, 3.4);
    const view = {
      target: new THREE.Vector3(mainB.x * 0.4, tgtY, mainB.z * 0.4), dist: 14, distRange: [8, 17],
      yaw: rng.range(0, TAU), yawRange: null,
      pitch: 0.16, pitchRange: [-0.1, 0.55],
      drift: 0.035, idlePitch: 0.15, fov: 45, minY: -1,
    };
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

    /* ---------------- hover tags ---------------- */
    const tagCache = [];
    const tag = (i) => (tagCache[i] || (tagCache[i] = { member: null, label: null, pos: null, radius: 0.5 }));

    let time = 0;
    return {
      scene, camera, view, post,
      update(dt, t) {
        time += dt;
        W.uTime.value = time;
        applyTod(false);
        bg.position.copy(camera.position);
        surface.position.set(camera.position.x, SURF_Y, camera.position.z);
        const ph = env.renderer.getDrawingBufferSize(_v2).y || 720;
        const sc = ph / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
        snow.u.uScale.value = sc; bubbles.u.uScale.value = sc;
        view.minY = hm.at(camera.position.x, camera.position.z) + 1.1;
        life.update(dt, time);
        manta.update(dt, time);
        eagle.update(dt, time, floorAt);
        jellies.update(dt, time, tod.night, (x, z) => hm.at(x, z));
        post.bloom.strength = lerp(0.3, 0.8, tod.night);
        post.bloom.threshold = lerp(0.8, 0.38, tod.night);
        post.exposure = lerp(1.0, 1.25, tod.night);
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
      addMember(m) { life.addMember(m); },
      creatures() {
        let i = 0;
        for (const f of life.residents) { const c = tag(i++); c.member = f.m; c.label = null; c.pos = f.sw.pos; c.radius = Math.max(0.35, f.size * 0.9); }
        for (const tu of life.turtles) { const c = tag(i++); c.member = tu.m; c.label = null; c.pos = tu.pos; c.radius = 0.8 * tu.size; }
        { const c = tag(i++); c.member = null; c.label = '青魔鱼群'; c.pos = life.schoolC; c.radius = 1.4; }
        { const c = tag(i++); c.member = null; c.label = '银汉鱼群'; c.pos = life.silCenter; c.radius = 2.0; }
        for (const b of life.barra) { const c = tag(i++); c.member = null; c.label = '尖吻鲈'; c.pos = b.pos; c.radius = 0.6; }
        if (manta.mesh.visible) { const c = tag(i++); c.member = null; c.label = '蝠鲼'; c.pos = manta.pos; c.radius = 2.2; }
        { const c = tag(i++); c.member = null; c.label = '鹰鳐'; c.pos = eagle.pos; c.radius = 1.0; }
        for (const g of life.hoverGroups) { if (g.kind !== 'anthias') continue; const c = tag(i++); c.member = null; c.label = '金拟花鮨'; c.pos = g.c; c.radius = 1.3; }
        if (life.butter[0]) { const c = tag(i++); c.member = null; c.label = '蝴蝶鱼'; c.pos = life.butter[0].pos; c.radius = 0.5; }
        { const c = tag(i++); c.member = null; c.label = '清洁站 · 裂唇鱼'; c.pos = life.station.wall; c.radius = 0.6; }
        { const c = tag(i++); c.member = null; c.label = '鲹鱼群'; c.pos = life.jackC; c.radius = 4.0; }
        return tagCache.slice(0, i);
      },
      dispose() {
        envB.dispose();
        life.dispose();
        for (const t of disposeList) t.dispose?.();
      },
    };
  },
};
