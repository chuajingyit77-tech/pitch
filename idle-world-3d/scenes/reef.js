// 深蓝 · 珊瑚礁 — an underwater coral reef garden on a sandy slope (ABZÛ / Endless Ocean mood).
import * as THREE from 'three';
import { clamp, lerp, smoothstep, damp, TAU } from '../lib/util.js';
import { createWaterUniforms, createBackground, createSurface, createShafts, createSnow, createBubbles, createEnvBuilder } from './reef/uw.js';
import { createGround, buildTerrain, buildRocks, HeightMap } from './reef/terrain.js';

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
  addable: ['clownfish', 'blueTang', 'yellowTang', 'moorishIdol', 'emperorAngel', 'blueTang', 'yellowTang'],
  maxMembers: 16,
  ambience: ['underwater'],
  eatSound: 'eat',

  async create(env) {
    const rng = env.rng;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#05202e');
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    const W = createWaterUniforms(SURF_Y, REF_Y);

    /* ---------------- ground + rocks ---------------- */
    const ground = createGround(env.seed ^ 0x2f1, SURF_Y);
    const hm = new HeightMap(ground, 26, 0.3);
    const terrain = buildTerrain(ground, W, env);
    scene.add(terrain);
    const rocks = buildRocks(ground, hm, W, env, rng.fork('rocks'));
    scene.add(rocks.group);

    /* ---------------- water volume ---------------- */
    const bg = createBackground(W);
    scene.add(bg);
    const n1 = env.loadTexture('textures/Water_1_M_Normal.jpg', { srgb: false, repeat: true });
    const n2 = env.loadTexture('textures/Water_2_M_Normal.jpg', { srgb: false, repeat: true });
    const surface = createSurface(W, n1, n2);
    scene.add(surface);
    const shafts = createShafts(W, rng.fork('shafts'), { count: Math.round(34 * Math.max(0.5, env.q)), radius: 24 });
    scene.add(shafts.mesh);
    const snow = createSnow(W, rng.fork('snow'), { count: Math.round(1800 * env.q) });
    scene.add(snow.mesh);
    const bubbleSrc = [];
    for (const b of rocks.bommies) bubbleSrc.push(new THREE.Vector3(b.x + rng.range(-1, 1), hm.at(b.x, b.z) * 0.3 + ground.height(b.x, b.z) * 0.7 + 0.2, b.z + rng.range(-1, 1)));
    const bubbles = createBubbles(W, rng.fork('bub'), bubbleSrc.slice(0, 3), Math.round(36 * Math.max(0.5, env.q)));
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
    scene.add(sunL, sunL.target);

    const envB = createEnvBuilder(env.pmrem, W);

    /* ---------------- time of day ---------------- */
    const tod = {
      hours: -99, envHours: -99,
      sunW: new THREE.Vector3(0, 1, 0), axis: new THREE.Vector3(0, -1, 0),
      night: 0, day: 1, golden: 0,
    };
    const _c1 = new THREE.Color(), _c2 = new THREE.Color(), _v = new THREE.Vector3(), _v2 = new THREE.Vector2();
    const refract = (d, out) => {
      const h = Math.hypot(d.x, d.z);
      if (h < 1e-5) return out.set(0, 1, 0);
      const hw = Math.min(h, 1) / 1.333, yw = Math.sqrt(1 - hw * hw);
      return out.set((d.x / h) * hw, yw, (d.z / h) * hw);
    };
    const pal = {
      day: { L0: lin(0.035, 0.30, 0.40), glow: lin(0.9, 1.0, 0.95), light: 3.4, lightCol: C('#dff6ff'), hemi: 2.2, sky: C('#9fe6ee'), gnd: C('#3d6a66'), shaft: lin(0.55, 0.85, 0.9), caus: 1.0 },
      gold: { L0: lin(0.05, 0.17, 0.21), glow: lin(1.6, 0.85, 0.45), light: 1.8, lightCol: C('#ffd9a8'), hemi: 1.4, sky: C('#9cc8c4'), gnd: C('#3a4c4a'), shaft: lin(1.0, 0.72, 0.42), caus: 0.7 },
      night: { L0: lin(0.002, 0.014, 0.045), glow: lin(0.25, 0.4, 0.8), light: 0.45, lightCol: C('#9db8ff'), hemi: 0.35, sky: C('#3a5c9a'), gnd: C('#0c1a2a'), shaft: lin(0.18, 0.3, 0.55), caus: 0.3 },
    };
    const mixP = (a, b, t, out) => {
      out.L0.copy(a.L0).lerp(b.L0, t); out.glow.copy(a.glow).lerp(b.glow, t);
      out.light = lerp(a.light, b.light, t); out.lightCol.copy(a.lightCol).lerp(b.lightCol, t);
      out.hemi = lerp(a.hemi, b.hemi, t); out.sky.copy(a.sky).lerp(b.sky, t); out.gnd.copy(a.gnd).lerp(b.gnd, t);
      out.shaft.copy(a.shaft).lerp(b.shaft, t); out.caus = lerp(a.caus, b.caus, t);
      return out;
    };
    const cur = { L0: lin(0, 0, 0), glow: lin(0, 0, 0), light: 0, lightCol: C('#fff'), hemi: 0, sky: C('#fff'), gnd: C('#fff'), shaft: lin(0, 0, 0), caus: 0 };
    const tmpP = { L0: lin(0, 0, 0), glow: lin(0, 0, 0), light: 0, lightCol: C('#fff'), hemi: 0, sky: C('#fff'), gnd: C('#fff'), shaft: lin(0, 0, 0), caus: 0 };

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
      // lights
      sunL.color.copy(cur.lightCol);
      sunL.intensity = cur.light;
      sunL.position.copy(tod.sunW).multiplyScalar(45);
      hemi.color.copy(cur.sky); hemi.groundColor.copy(cur.gnd); hemi.intensity = cur.hemi;
      // surface: sky through Snell's window
      const su = surface.userData.u;
      su.uSunAir.value.copy(useSun ? s.dir : s.moonDir);
      su.uSunCol.value.copy(useSun ? s.sunColor : _c1.set('#c8d8ff'));
      su.uSunI.value = useSun ? s.sunIntensity * 0.6 : 0.08;
      su.uSkyZen.value.copy(s.zenith).multiplyScalar(lerp(0.15, 1.1, s.day));
      su.uSkyHor.value.copy(s.horizon).multiplyScalar(lerp(0.15, 1.1, s.day));
      // shafts follow the light
      shafts.u.uAxis.value.copy(tod.axis);
      _c2.setRGB(cur.shaft.x, cur.shaft.y, cur.shaft.z);
      shafts.u.uShaftCol.value.copy(_c2);
      shafts.u.uShaftI.value = lerp(0.35, 1.0, s.day) * (useSun ? 1 : 0.6);
      shafts.setLengths(tod.axis, (x, z) => ground.height(x, z));
      snow.u.uBio.value = smoothstep(0.3, 1, s.night);
      // environment map for reflections
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

    /* ---------------- camera ---------------- */
    const view = {
      target: new THREE.Vector3(0, 1.8, 0), dist: 14, distRange: [8, 17],
      yaw: rng.range(0, TAU), yawRange: null,
      pitch: 0.16, pitchRange: [-0.1, 0.55],
      drift: 0.035, idlePitch: 0.15, fov: 45, minY: -1,
    };
    const post = {
      bloom: { strength: 0.32, radius: 0.7, threshold: 0.75 },
      exposure: 1.0, toneMapping: 'aces',
      vignette: 0.45, grain: 0.02, saturation: 1.08, contrast: 1.05,
      lift: [0.0, 0.012, 0.022], gain: [1, 1, 1], ca: 0.0015,
    };

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
        view.minY = hm.at(camera.position.x, camera.position.z) + 1.0;
        post.bloom.strength = lerp(0.32, 0.75, tod.night);
        post.bloom.threshold = lerp(0.75, 0.42, tod.night);
      },
      feed(raycaster) {
        const hits = raycaster.intersectObjects([terrain, ...rocks.meshes], false);
        return hits.length ? hits[0].point : raycaster.ray.at(8, new THREE.Vector3());
      },
      creatures() { return []; },
      dispose() { envB.dispose(); },
    };
  },
};
