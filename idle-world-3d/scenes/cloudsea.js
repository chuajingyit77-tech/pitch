// 云海 · 光之鳐 — a dreamlike realm above a sea of clouds (inspired by Sky: Children of the Light
// and Journey). Floating ruins, manta rays of light, sky jellyfish and flocks of light birds.
import * as THREE from 'three';
import { createWind, clamp, lerp, damp, smoothstep, TAU } from '../lib/util.js';
import { createShared, createTimeOfDay, makeBillowTexture, makeDetailTexture, makeCirrusTexture, makeNoiseTexture, makeRockTexture, CLOUD_TOP } from './cloudsea/common.js';
import { createSky, createAurora, createEnvironment } from './cloudsea/sky.js';
import { createCloudSea, createPuffs, towerPuffs, bankPuffs } from './cloudsea/clouds.js';
import { createIslands } from './cloudsea/islands.js';

export default {
  id: 'cloudsea',
  food: '星光',
  kinds: { manta: { zh: '光之鳐' }, jelly: { zh: '天水母' }, spirit: { zh: '光灵' } },
  starter: ['manta', 'jelly', 'spirit', 'manta', 'jelly'],
  addable: ['manta', 'jelly', 'spirit'],
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

    /* ---- sky, aurora, image based lighting ---- */
    const sky = createSky(shared, tex);
    scene.add(sky.mesh);
    const aurora = createAurora(shared, tex, rng.fork('aurora'));
    scene.add(aurora.mesh);
    const envMap = createEnvironment(env, shared, sky.material);

    /* ---- cloud sea ---- */
    const sea = createCloudSea(env, shared, tex);
    scene.add(sea.mesh);

    /* ---- islands ---- */
    const wind = createWind({ direction: new THREE.Vector2(0.8, 0.4), strength: 0.8 });
    const isl = createIslands(env, shared, tex, wind);
    scene.add(isl.group);
    isl.casters.slice(0, 4).forEach((c, i) => sea.casters[i].copy(c));

    /* ---- cloud puffs: far towers & banks (static), near cloudlets (dynamic) ---- */
    const glowU = { casters: sea.uniforms.uCasters, glowPos: sea.uniforms.uGlowPos, glowCol: sea.uniforms.uGlowCol };
    const crng = rng.fork('puffs');
    const farItems = [];
    const nTowers = q >= 0.7 ? 8 : 5;
    const a0 = crng.range(0, TAU);
    for (let i = 0; i < nTowers; i++) {
      const a = a0 + (i / nTowers) * TAU + crng.range(-0.25, 0.25);
      const d = crng.range(950, 2300);
      towerPuffs(crng, new THREE.Vector3(Math.cos(a) * d, CLOUD_TOP - 25, Math.sin(a) * d), crng.range(170, 460), crng.range(80, 170), Math.round(lerp(22, 40, q)), farItems);
    }
    for (let i = 0; i < 11; i++) {
      const a = crng.range(0, TAU), d = crng.range(190, 760);
      bankPuffs(crng, new THREE.Vector3(Math.cos(a) * d, CLOUD_TOP - 2, Math.sin(a) * d), crng.range(110, 280), crng.range(40, 80), crng.range(14, 30), Math.round(lerp(9, 15, q)), crng.range(0, TAU), farItems);
    }
    const farPuffs = createPuffs(shared, tex, farItems, { glow: glowU, fogMul: 0.6 });
    farPuffs.mesh.renderOrder = 1;
    scene.add(farPuffs.mesh);

    const nearItems = [];
    const cloudlets = [];
    for (let i = 0; i < (q >= 0.7 ? 7 : 4); i++) {
      const a = crng.range(0, TAU), d = crng.range(80, 150), y = CLOUD_TOP + crng.range(6, 30);
      const cl = { a, d, y, speed: crng.range(0.0025, 0.006) * crng.sign(), items: [] };
      const n = crng.int(5, 9), size = crng.range(3, 6.5);
      for (let k = 0; k < n; k++) {
        const it = { ox: crng.range(-1.6, 1.6) * size, oy: crng.range(-0.3, 0.6) * size, oz: crng.range(-0.8, 0.8) * size, r: size * crng.range(0.55, 1.0), seed: crng.next(), shade: 0.5, alpha: crng.range(0.75, 0.95), x: 0, y: 0, z: 0, cx: 0, cy: 0, cz: 0, cr: size * 2 };
        it.shade = clamp(0.45 + it.oy / size * 0.5, 0, 1);
        cl.items.push(it); nearItems.push(it);
      }
      cloudlets.push(cl);
    }
    // collars where the islets dip toward the sea, and mist where the fall meets the clouds
    const addStatic = (x, y, z, r, alpha, shade = 0.6) => nearItems.push({ x, y, z, r, seed: crng.next(), shade, alpha, cx: x, cy: y - r, cz: z, cr: r * 2 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + crng.range(-0.2, 0.2), rr = crng.range(3, 8);
      addStatic(Math.cos(a) * rr, crng.range(-27, -19), Math.sin(a) * rr, crng.range(4, 7), 0.75, 0.5);
    }
    for (let i = 0; i < 5; i++) {
      const v = i / 4;
      const p = isl.lip.clone().addScaledVector(isl.fallDir, 2 + v * 2.5);
      p.y -= Math.pow(v, 1.5) * 32 + 1;
      addStatic(p.x, p.y, p.z, lerp(1.4, 8, v), lerp(0.35, 0.8, v), 0.7);
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
      c.left = -19; c.right = 19; c.top = 19; c.bottom = -19; c.near = 1; c.far = 140;
      keyLight.shadow.bias = -0.0004;
      keyLight.shadow.normalBias = 0.04;
    }
    scene.add(keyLight, keyLight.target);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.5);
    scene.add(hemi);

    /* ---- post ---- */
    const post = {
      bloom: { strength: 0.7, radius: 0.75, threshold: 1.6 },
      exposure: 1, toneMapping: 'aces',
      vignette: 0.4, grain: 0.018, saturation: 1.06, contrast: 0.96,
      lift: [0.02, 0.01, 0.045], gain: [1.02, 1.0, 0.98], ca: 0.0015,
    };

    const view = {
      target: new THREE.Vector3(0, 2.0, 0), dist: 30, distRange: [18, 60],
      yaw: 1.22, yawRange: null, pitch: 0.12, pitchRange: [0.05, 0.45],
      drift: 0.025, fov: 42,
    };

    envMap.update(env.hours(), 0, true);
    scene.environment = envMap.texture;

    let elapsed = 0;
    const tmpV = new THREE.Vector3();
    function update(dt, t) {
      elapsed = t;
      shared.uTime.value = t;
      tod.update();
      wind.update(dt);
      if (envMap.update(tod.hours, t, false)) scene.environment = envMap.texture;
      sky.mesh.position.copy(camera.position);
      aurora.mesh.position.copy(camera.position);
      aurora.uniforms.uAurora.value = smoothstep(0.35, 0.95, tod.night);
      sea.update(dt);
      // drifting cloudlets
      for (const cl of cloudlets) {
        cl.a += cl.speed * dt;
        const cx = Math.cos(cl.a) * cl.d, cz = Math.sin(cl.a) * cl.d, cy = cl.y + Math.sin(t * 0.1 + cl.d) * 1.5;
        for (const it of cl.items) {
          it.x = cx + it.ox; it.y = cy + it.oy; it.z = cz + it.oz;
          it.cx = cx; it.cy = cy - 2; it.cz = cz;
        }
      }
      nearPuffs.update(camera);
      isl.update(dt, t, tod);

      // key light follows the sun / moon
      keyLight.position.copy(tod.lightDir).multiplyScalar(70);
      keyLight.target.position.set(0, 0, 0);
      keyLight.color.copy(tod.pal.light);
      keyLight.intensity = tod.lightI * Math.PI;
      hemi.color.copy(shared.uAmbient.value).multiplyScalar(1.2);
      hemi.groundColor.copy(shared.uBounce.value).multiplyScalar(1.2);
      hemi.intensity = Math.PI * 0.35;

      // grade with the time of day
      const n = tod.night, g = tod.golden, d = tod.day;
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
