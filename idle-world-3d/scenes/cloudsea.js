// 云海 · 蟠桃仙境 — the Queen Mother's heavenly peach garden floating above a sea of clouds.
// Chinese pavilions with flying eaves, an immortal peach tree, an old tortoise practising tai chi,
// red-crowned cranes and flocks of little blue spirit birds. Feed them glowing peaches (蟠桃).
import * as THREE from 'three';
import { createWind, clamp, lerp, damp, smoothstep, TAU } from '../lib/util.js';
import { createShared, createTimeOfDay, makeBillowTexture, makeDetailTexture, makeCirrusTexture, makeNoiseTexture, makeRockTexture, CLOUD_TOP } from './cloudsea/common.js';
import { createSky, createEnvironment } from './cloudsea/sky.js';
import { createCloudSea, createPuffs, towerPuffs, bankPuffs, mistFall } from './cloudsea/clouds.js';
import { createGarden } from './cloudsea/garden.js';

export default {
  id: 'cloudsea',
  food: '蟠桃',
  kinds: { tortoise: { zh: '神龟' }, crane: { zh: '仙鹤' }, bird: { zh: '青鸟' } },
  starter: ['tortoise', 'crane', 'crane', 'bird', 'bird'],
  addable: ['crane', 'bird', 'crane', 'bird', 'tortoise'],
  maxMembers: 12,
  ambience: ['pad', 'wind'],
  eatSound: 'chime',

  async create(env) {
    const q = env.q;
    const rng = env.rng;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 9000);

    /* ---- procedural textures ---- */
    const tex = {
      billow: makeBillowTexture(env.seed ^ 0xb1110, q >= 0.7 ? 512 : 256),
      detail: makeDetailTexture(env.seed ^ 0xde7a11, 256),
      cirrus: makeCirrusTexture(env.seed ^ 0xc1c1, q >= 0.7 ? 512 : 256),
      noise: makeNoiseTexture(env.seed ^ 0x9015e, 256),
      rock: makeRockTexture(env.seed ^ 0x70c4, 256),
    };

    /* ---- shared time-of-day state ---- */
    const shared = createShared();
    const tod = createTimeOfDay(env, shared);
    tod.update(true);

    /* ---- sky + image based lighting ---- */
    const sky = createSky(shared, tex);
    scene.add(sky.mesh);
    const envMap = createEnvironment(env, shared, sky.material);

    /* ---- cloud sea ---- */
    const sea = createCloudSea(env, shared, tex);
    scene.add(sea.mesh);

    /* ---- the garden ---- */
    const wind = createWind({ direction: new THREE.Vector2(0.8, 0.4), strength: 0.8 });
    const garden = createGarden(env, shared, tex, wind);
    scene.add(garden.group);
    garden.casters.slice(0, 4).forEach((c, i) => sea.casters[i].copy(c));
    for (const f of garden.mistFalls) scene.add(mistFall(shared, tex, f.lip, f.dir, f.height, f.w0, f.w1));

    /* ---- clouds: far towers & banks (static), auspicious swirls + collars (dynamic) ---- */
    const glowU = { casters: sea.uniforms.uCasters, glowPos: sea.uniforms.uGlowPos, glowCol: sea.uniforms.uGlowCol };
    const crng = rng.fork('puffs');
    const farItems = [];
    const nTowers = q >= 0.7 ? 8 : 5;
    const a0 = crng.range(0, TAU);
    for (let i = 0; i < nTowers; i++) {
      const a = a0 + (i / nTowers) * TAU + crng.range(-0.25, 0.25);
      const d = crng.range(950, 2300);
      towerPuffs(crng, new THREE.Vector3(Math.cos(a) * d, CLOUD_TOP - 25, Math.sin(a) * d), crng.range(170, 420), crng.range(80, 170), Math.round(lerp(22, 40, q)), farItems);
    }
    for (let i = 0; i < 11; i++) {
      const a = crng.range(0, TAU), d = crng.range(190, 760);
      bankPuffs(crng, new THREE.Vector3(Math.cos(a) * d, CLOUD_TOP - 2, Math.sin(a) * d), crng.range(110, 280), crng.range(40, 80), crng.range(14, 30), Math.round(lerp(9, 15, q)), crng.range(0, TAU), farItems);
    }
    const farPuffs = createPuffs(shared, tex, farItems, { glow: glowU, fogMul: 0.6 });
    farPuffs.mesh.renderOrder = 1;
    scene.add(farPuffs.mesh);

    const nearItems = [];
    // 祥云: puffs strung along ruyi-style double spirals; each swirl turns to face the camera
    const swirls = [];
    const nSwirls = q >= 0.7 ? 7 : 4;
    for (let i = 0; i < nSwirls; i++) {
      const a = crng.range(0, TAU), d = i < 3 ? crng.range(34, 55) : crng.range(70, 140);
      const sw = { a, d, y: crng.range(-6, 18) + (i < 3 ? 0 : 6), speed: crng.range(0.006, 0.012) * crng.sign(), size: i < 3 ? crng.range(1.6, 2.4) : crng.range(3, 5.5), pts: [], dir: crng.sign() };
      const S = sw.size;
      const curl = (cx, cy, R0, turns, sign, k0) => {
        const n = Math.round(26 * turns);
        for (let k = 0; k < n; k++) {
          const t = k / n, th = t * turns * TAU;
          const r = R0 * Math.exp(-0.32 * th);
          sw.pts.push({ u: cx + sign * Math.cos(th + k0) * r, v: cy + Math.sin(th + k0) * r, w: crng.range(-0.15, 0.15) * S, r: Math.max(0.3, 0.5 * r + 0.18) * S * 0.7 });
        }
      };
      curl(0, 0, 1.6, 1.25, sw.dir, Math.PI);
      curl(sw.dir * 2.3, -0.35, 1.05, 1.1, -sw.dir, 0);
      // trailing tail
      for (let k = 0; k < 16; k++) { const t = k / 15; sw.pts.push({ u: -sw.dir * (1.2 + t * 4.4), v: -1.25 + Math.sin(t * 3.2) * 0.35, w: 0, r: (0.85 - t * 0.55) * S * 0.7 }); }
      for (const p of sw.pts) { p.it = { x: 0, y: 0, z: 0, r: p.r, seed: crng.next(), shade: clamp(0.6 + p.v * 0.12, 0.25, 1), alpha: 0.8, cx: 0, cy: 0, cz: 0, cr: 4 * S }; nearItems.push(p.it); }
      swirls.push(sw);
    }
    // collars where the islets dip toward the sea, and mist where the falls meet the clouds
    const addStatic = (x, y, z, r, alpha, shade = 0.6) => nearItems.push({ x, y, z, r, seed: crng.next(), shade, alpha, cx: x, cy: y - r, cz: z, cr: r * 2 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + crng.range(-0.2, 0.2), rr = crng.range(3, 8);
      addStatic(Math.cos(a) * rr, crng.range(-28, -20), Math.sin(a) * rr, crng.range(4, 7), 0.75, 0.5);
    }
    for (const f of garden.mistFalls) {
      for (let i = 0; i < 5; i++) {
        const v = i / 4;
        const p = f.lip.clone().addScaledVector(f.dir, 2 + v * 2.5);
        p.y -= Math.pow(v, 1.5) * f.height * 0.92 + 1;
        addStatic(p.x, p.y, p.z, lerp(1.2, f.w1 * 0.9, v), lerp(0.3, 0.75, v), 0.7);
      }
    }
    const nearPuffs = createPuffs(shared, tex, nearItems, { dynamic: true, glow: glowU });
    nearPuffs.mesh.renderOrder = 3;
    scene.add(nearPuffs.mesh);

    /* ---- lights ---- */
    const keyLight = new THREE.DirectionalLight(0xffffff, 3);
    keyLight.castShadow = env.shadows;
    if (env.shadows) {
      const s = q >= 0.9 ? 2048 : 1024;
      keyLight.shadow.mapSize.set(s, s);
      const c = keyLight.shadow.camera;
      c.left = -20; c.right = 20; c.top = 20; c.bottom = -20; c.near = 1; c.far = 160;
      keyLight.shadow.bias = -0.0004;
      keyLight.shadow.normalBias = 0.04;
    }
    scene.add(keyLight, keyLight.target);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.5);
    scene.add(hemi);
    const warmLight = new THREE.PointLight(new THREE.Color('#ff9a52'), 0, 18, 1.6);
    warmLight.position.copy(garden.pavPos).add(new THREE.Vector3(0, 3.0, 0));
    scene.add(warmLight);
    const terraceLight = new THREE.PointLight(new THREE.Color('#ffb070'), 0, 14, 1.6);
    terraceLight.position.copy(garden.taiji).add(new THREE.Vector3(1.4, 1.6, 0));
    scene.add(terraceLight);

    /* ---- post ---- */
    const post = {
      bloom: { strength: 0.7, radius: 0.75, threshold: 1.6 },
      exposure: 1, toneMapping: 'aces',
      vignette: 0.4, grain: 0.018, saturation: 1.06, contrast: 0.96,
      lift: [0.02, 0.01, 0.045], gain: [1.02, 1.0, 0.98], ca: 0.0015,
    };

    // frame the moon at night, the sunset in the evening
    let yaw0 = 1.2;
    if (tod.night > 0.5) {
      const md = tod.moonDir;
      yaw0 = Math.atan2(-md.x, -md.z) - 0.35;
    }
    const target = new THREE.Vector3(0.6, 2.4, 0.3);
    const view = {
      target, dist: 28, distRange: [16, 60],
      yaw: yaw0, yawRange: null, pitch: 0.13, pitchRange: [0.04, 0.45],
      drift: 0.025, fov: 42,
    };

    envMap.update(env.hours(), 0, true);
    scene.environment = envMap.texture;

    function update(dt, t) {
      shared.uTime.value = t;
      tod.update();
      wind.update(dt);
      if (envMap.update(tod.hours, t, false)) scene.environment = envMap.texture;
      sky.mesh.position.copy(camera.position);
      sea.update(dt);
      // swirls drift around the garden and turn to face the viewer
      for (const sw of swirls) {
        sw.a += sw.speed * dt;
        const cx = Math.cos(sw.a) * sw.d, cz = Math.sin(sw.a) * sw.d, cy = sw.y + Math.sin(t * 0.12 + sw.d) * 1.2;
        let rx = camera.position.z - cz, rz = -(camera.position.x - cx);
        const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
        const fx = -rz, fz = rx;
        for (const p of sw.pts) {
          const it = p.it;
          it.x = cx + rx * p.u * sw.size + fx * p.w; it.y = cy + p.v * sw.size; it.z = cz + rz * p.u * sw.size + fz * p.w;
          it.cx = cx; it.cy = cy - sw.size; it.cz = cz;
        }
      }
      nearPuffs.update(camera);
      garden.update(dt, t, tod);

      // key light follows the sun / moon
      keyLight.position.copy(tod.lightDir).multiplyScalar(80);
      keyLight.target.position.set(0, 0, 0);
      keyLight.color.copy(tod.pal.light);
      keyLight.intensity = tod.lightI * Math.PI;
      hemi.color.copy(shared.uAmbient.value).multiplyScalar(1.2);
      hemi.groundColor.copy(shared.uBounce.value).multiplyScalar(1.2);
      hemi.intensity = Math.PI * 0.35;
      const fl = 0.9 + 0.1 * Math.sin(t * 7.7) * Math.sin(t * 3.1);
      warmLight.intensity = lerp(0.6, 16, tod.night) * fl;
      terraceLight.intensity = lerp(0.3, 9, tod.night) * fl;

      // grade with the time of day
      const n = tod.night, g = tod.golden;
      post.bloom.threshold = lerp(lerp(2.6, 1.5, g), 0.9, n);
      post.bloom.strength = lerp(lerp(0.55, 0.8, g), 0.95, n);
      post.exposure = lerp(lerp(0.86, 1.0, g), 1.35, n);
      post.saturation = lerp(1.05, 1.1, g);
      post.lift[0] = lerp(0.02, 0.03, n); post.lift[1] = lerp(0.012, 0.02, n); post.lift[2] = lerp(0.045, 0.07, n);
    }

    return {
      scene, camera, view, post,
      update,
      feed(raycaster) { return null; },
      creatures: () => [],
      addMember() {},
      dispose() {
        envMap.dispose();
        for (const k of ['billow', 'detail']) tex[k].tex.dispose();
        tex.cirrus.dispose(); tex.noise.dispose(); tex.rock.dispose();
      },
    };
  },
};
