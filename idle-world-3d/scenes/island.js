// 晴岛 · 热带海岛 — a small tropical island in an open ocean, seen from an aerial 3/4 orbit.
// Art direction: Sea of Thieves water (rich reflective deep ocean, sun glitter, turquoise swell glow)
// + Animal Crossing coziness (soft sand, palms, a little dock, hut and lantern, friendly residents).
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, createNoise, createWind, sunState } from '../lib/util.js';
import { waterUniforms, LAYER_NO_REFLECT } from './island/shared.js';
import { createTerrain } from './island/terrain.js';
import { createWater, waveHeight } from './island/water.js';
import { createSky } from './island/sky.js';
import { createFlora } from './island/flora.js';
import { planProps, createProps } from './island/props.js';
import { createFx } from './island/fx.js';
import { createFauna } from './island/fauna.js';

export default {
  id: 'island',
  food: '小鱼干',
  kinds: {
    crab: { zh: '螃蟹' },
    hermit: { zh: '寄居蟹' },
    gull: { zh: '海鸥' },
    turtle: { zh: '海龟' },
    dolphin: { zh: '海豚' },
  },
  starter: ['crab', 'crab', 'hermit', 'gull', 'gull', 'turtle', 'dolphin', 'dolphin'],
  addable: ['crab', 'hermit', 'gull', 'turtle', 'dolphin'],
  maxMembers: 16,
  ambience: hours => ['ocean', hours >= 19.3 || hours < 5.6 ? 'insects' : 'gulls'],
  eatSound: 'eat',

  async create(env) {
    const rng = env.rng;
    const noise = createNoise(env.seed);
    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 12000);
    camera.layers.enable(LAYER_NO_REFLECT);
    const wind = createWind({ direction: new THREE.Vector2(1, 0.45), strength: 1, gust: 1 });

    /* ---------------- world ---------------- */
    const terrain = createTerrain(env, rng.fork('terrain'), noise);
    const plan = planProps(terrain, rng.fork('plan'));
    const flora = createFlora(env, rng.fork('flora'), terrain, wind, plan.reserved);
    const props = createProps(env, rng.fork('props'), terrain, plan);
    terrain.finalizeField();
    const normalTex = await env.loadTextureAsync('textures/waternormals.jpg', { srgb: false, repeat: true });
    const water = createWater(env, camera, { normalTex });
    const sky = createSky(env, rng.fork('sky'));
    const fx = createFx(env, terrain, props);
    const fauna = await createFauna(env, { terrain, props, fx, flora });
    for (const m of env.members) fauna.addMember(m);
    scene.add(terrain.mesh, terrain.deep, water.mesh, sky.sky, sky.clouds.mesh, flora.group, props.group, fx.group, fauna.group);

    /* ---------------- lights ---------------- */
    const sun = new THREE.DirectionalLight(0xffffff, 3);
    sun.castShadow = !!env.shadows;
    const sm = env.q >= 0.9 ? 2048 : 1024;
    sun.shadow.mapSize.set(sm, sm);
    const sc = sun.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 5; sc.far = 160;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 2.5;
    sun.target.position.set(0, 0, 0);
    scene.add(sun, sun.target);
    const hemi = new THREE.HemisphereLight(0xbcd8ff, 0xd8c9a0, 0.4);
    scene.add(hemi);

    /* ---------------- camera ---------------- */
    const dockA = terrain.dockAng + 0.55;
    const viewYaw = Math.atan2(Math.cos(dockA), Math.sin(dockA));
    const view = {
      target: new THREE.Vector3(0, 1.4, 0),
      dist: 45, distRange: [25, 80],
      yaw: viewYaw, yawRange: null,
      pitch: 0.35, pitchRange: [0.12, 0.9],
      drift: 0.03, fov: 50, minY: 2.5,
    };
    // The sun sets roughly behind the island as seen from the opening view (sun path on the water),
    // and the solar clock is nudged ~20 min later so 18:00–18:20 is a real golden sunset.
    const SUN_SHIFT = 0.32;
    const sunYaw = viewYaw + 0.38;
    const SUN_AZ = Math.atan2(Math.cos(sunYaw), Math.sin(sunYaw));

    /* ---------------- time of day ---------------- */
    const post = {
      bloom: { strength: 0.35, radius: 0.55, threshold: 1.0 },
      exposure: 1.0, toneMapping: 'aces',
      vignette: 0.35, grain: 0.02, saturation: 1.12, contrast: 1.05,
      lift: [0, 0.004, 0.012], gain: [1, 1, 1], ca: 0.0012,
      tilt: { amount: 0.22, center: 0.52, width: 0.24 },
    };
    const tod = { hours: -1, elev: 0, day: 1, night: 0, golden: 0, lantern: 0, dusk: 0, envElev: -999, envNight: -1, timer: 0 };
    const C = {
      sunCol: new THREE.Color(), moon: new THREE.Color('#9fb6ff'), tmp: new THREE.Color(), tmp2: new THREE.Color(),
      deepDay: new THREE.Color(0.0045, 0.042, 0.105), deepGold: new THREE.Color(0.012, 0.035, 0.08), deepNight: new THREE.Color(0.0012, 0.006, 0.02),
      horizon: new THREE.Color(), seaEnv: new THREE.Color(),
    };
    const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3();

    function applyTime(force = false) {
      const h = env.hours();
      if (!force && Math.abs(h - tod.hours) < 0.0015) return;
      tod.hours = h;
      const s = sunState(h - SUN_SHIFT, { azimuthOffset: SUN_AZ });
      sunDir.copy(s.dir); moonDir.copy(s.moonDir);
      tod.elev = s.elevationDeg; tod.day = s.day; tod.night = s.night; tod.golden = s.golden;
      const day = s.day, night = s.night, golden = s.golden;
      tod.dusk = smoothstep(-6, 1, s.elevationDeg) * (1 - smoothstep(9, 16, s.elevationDeg));
      C.sunCol.copy(s.sunColor);

      // sky
      const su = sky.uniforms;
      su.sunPosition.value.copy(sunDir);
      su.turbidity.value = lerp(2.2, 4.6, golden);
      su.rayleigh.value = lerp(1.15, 2.4, golden) + night * 0.5;
      su.mieCoefficient.value = lerp(0.0035, 0.009, golden);
      su.mieDirectionalG.value = lerp(0.8, 0.86, golden);
      su.uNight.value = smoothstep(0.0, 1.0, night * 1.1);
      su.uMoonDir.value.copy(moonDir);
      su.uSunGlow.value.copy(C.sunCol).multiplyScalar(golden * 0.3);
      su.uSkyGain.value = lerp(0.46, 0.6, golden);
      su.uLowTint.value.setRGB(1, 1, 1).lerp(C.tmp.setRGB(1.25, 0.95, 1.05), golden * 0.6);
      su.uArtZen.value.copy(s.zenith).lerp(C.tmp.set('#1f6fd6'), 0.45 * day * (1 - golden));
      su.uArtHor.value.copy(s.horizon).lerp(C.tmp.set('#86c4ee'), 0.55 * day * (1 - golden));
      su.uArtSun.value.copy(C.sunCol).multiplyScalar(1.1);
      const twi = smoothstep(2, -4, s.elevationDeg);
      su.uArtMix.value = lerp(lerp(0.68, 0.5, golden), 0.88, twi);
      su.uArtGain.value = lerp(1.18, 1.35, Math.max(golden, twi)) * (1 - night * 0.5);
      su.uSkySat.value = 1.25;

      // key light: the sun by day, the moon by night
      const sunVis = smoothstep(-3.5, 2.5, s.elevationDeg);
      const sunI = s.sunIntensity * 1.15 * sunVis;
      const moonI = 0.36 * night;
      if (sunVis > 0.02) { sun.position.copy(sunDir).multiplyScalar(80); sun.color.copy(C.sunCol); sun.intensity = sunI + moonI * 0.2; }
      else { sun.position.copy(moonDir).multiplyScalar(80); sun.color.copy(C.moon); sun.intensity = moonI; }
      hemi.color.copy(s.skyAmbient);
      hemi.groundColor.copy(s.groundAmbient).lerp(C.tmp.set('#e2cfa0'), 0.35 * day);
      hemi.intensity = s.ambientIntensity * lerp(0.75, 0.45, day);

      // water volume (shared by every submerged material)
      const light = sunI * 0.28 * Math.max(0.15, Math.sin(Math.max(s.elevation, 0.05))) + s.ambientIntensity * 0.55 + moonI * 0.2;
      waterUniforms.uDeep.value.copy(C.deepDay).lerp(C.deepGold, golden * 0.7).lerp(C.deepNight, night).multiplyScalar(lerp(light, 1, night));
      waterUniforms.uCaustic.value.copy(C.sunCol).multiplyScalar(sunI * 0.55 + moonI * 0.25);

      // water surface
      const wu = water.uniforms;
      wu.uSunDir.value.copy(sunVis > 0.02 ? sunDir : moonDir);
      wu.uSunCol.value.copy(C.sunCol).multiplyScalar(sunI * 1.1);
      wu.uMoonDir.value.copy(moonDir);
      wu.uMoonCol.value.copy(C.moon).multiplyScalar(night * 0.7);
      wu.uSSS.value.setRGB(0.0, 0.55, 0.42).multiplyScalar(sunI * 0.11 + 0.02 * day).lerp(C.tmp.setRGB(0.25, 0.32, 0.15).multiplyScalar(sunI * 0.12), golden * 0.5);
      wu.uFoamCol.value.copy(C.sunCol).multiplyScalar(sunI * 0.26).add(C.tmp.copy(s.skyAmbient).multiplyScalar(s.ambientIntensity * 0.5));
      wu.uGlow.value.setRGB(0.04, 0.5, 1.6).multiplyScalar(1.6 * smoothstep(0.35, 0.95, night));
      wu.uNight.value = night;
      C.horizon.copy(su.uArtHor.value).lerp(C.tmp.copy(su.uArtZen.value), 0.15).multiplyScalar(lerp(1.05, 0.85, golden) * (1 - night * 0.7));
      wu.uHorizon.value.copy(C.horizon);
      wu.uSkyFallback.value.copy(C.horizon);

      // clouds
      const cu = sky.clouds.uniforms;
      cu.uSunDir.value.copy(sunVis > 0.02 ? sunDir : moonDir);
      cu.uLit.value.copy(C.sunCol).multiplyScalar(sunI * 0.42 + 0.05).add(C.tmp.copy(s.skyAmbient).multiplyScalar(0.35 * s.ambientIntensity));
      if (sunVis <= 0.02) cu.uLit.value.copy(C.moon).multiplyScalar(0.1 + 0.12 * night).add(C.tmp.copy(s.horizon).multiplyScalar(0.5));
      cu.uShade.value.copy(s.skyAmbient).multiplyScalar(0.55 * s.ambientIntensity).lerp(C.tmp.copy(s.horizon).multiplyScalar(0.55), 0.35);
      if (golden > 0) cu.uShade.value.lerp(C.tmp.setRGB(0.42, 0.26, 0.36), golden * 0.5);
      cu.uShade.value.multiplyScalar(1 - night * 0.35);
      cu.uRim.value.copy(C.sunCol).multiplyScalar(sunI * 0.45 + 0.02);
      cu.uHaze.value.copy(C.horizon);
      cu.uOpacity.value = lerp(1, 0.6, night);

      // lights on the dock come on at dusk
      tod.lantern = smoothstep(3, -3, s.elevationDeg);

      // post
      post.exposure = lerp(1.0, 1.32, night) * lerp(1, 0.94, golden);
      post.bloom.strength = lerp(0.3, 0.8, night) + golden * 0.12;
      post.bloom.threshold = lerp(1.2, 0.5, night) + golden * 0.4;
      post.saturation = lerp(1.13, 1.04, night) + golden * 0.05;
      post.contrast = lerp(1.06, 1.03, night);
      post.lift = [lerp(0.0, 0.006, night), lerp(0.004, 0.012, night), lerp(0.012, 0.035, night)];
      post.gain = [1 + golden * 0.05, 1 - golden * 0.005, 1 - golden * 0.06];

      // environment map (PMREM of the sky), refreshed when the light changed noticeably
      if (force || Math.abs(tod.envElev - s.elevationDeg) > 1.2 || Math.abs(tod.envNight - night) > 0.06) {
        tod.envElev = s.elevationDeg; tod.envNight = night;
        C.seaEnv.copy(waterUniforms.uDeep.value).multiplyScalar(2.5);
        scene.environment = sky.updateEnv(C.seaEnv);
      }
    }
    applyTime(true);

    /* ---------------- feeding ---------------- */
    const H = terrain.height;
    const _o = new THREE.Vector3(), _p = new THREE.Vector3();
    function groundAt(x, z) { return props.onDock(x, z) ? Math.max(H(x, z), props.deckY + 0.03) : H(x, z); }
    function raycastWorld(ray) {
      const o = ray.origin, d = ray.direction;
      if (d.y > -0.01) return null;
      const tWater = -o.y / d.y;
      let t0 = Math.max(0, (o.y - 10) / -d.y);
      const step = 0.35;
      let prev = t0;
      for (let t = t0; t <= tWater; t += step) {
        _p.copy(d).multiplyScalar(t).add(o);
        if (_p.y <= groundAt(_p.x, _p.z)) {
          let a = prev, b = t;
          for (let k = 0; k < 10; k++) {
            const m = (a + b) / 2;
            _p.copy(d).multiplyScalar(m).add(o);
            if (_p.y <= groundAt(_p.x, _p.z)) b = m; else a = m;
          }
          _p.copy(d).multiplyScalar(b).add(o);
          return _p.clone();
        }
        prev = t;
      }
      return _o.copy(d).multiplyScalar(tWater).add(o).clone();
    }
    function feed(raycaster) {
      const hit = raycastWorld(raycaster.ray);
      if (!hit || Math.hypot(hit.x, hit.z) > 75) return null;
      fx.spawnFood(hit);
      return hit;
    }
    function feedRandom(n) {
      const frng = Math.random;
      for (let i = 0; i < n; i++) {
        const land = i % 2 === 0;
        let p;
        if (land) {
          const a = Math.atan2(props.dockBase.z, props.dockBase.x) + (frng() - 0.5) * 0.7;
          p = terrain.pointAt(a, 0.8 + frng() * 3.2);
        } else {
          p = props.dockEnd.clone().addScaledVector(props.dockDir, 2 + frng() * 6).addScaledVector(props.dockPerp, (frng() - 0.5) * 9);
          p.y = 0;
        }
        fx.spawnFood(p, { sound: i === 0 });
      }
      return n;
    }

    /* ---------------- per-frame ---------------- */
    let todTimer = 0;
    const camPos = new THREE.Vector3();
    function update(dt, t) {
      waterUniforms.uWTime.value = t;
      sky.uniforms.uTime.value = t;
      wind.update(dt);
      todTimer -= dt;
      if (todTimer <= 0) { todTimer = 0.25; applyTime(); }
      camera.getWorldPosition(camPos);
      sky.clouds.update(dt, camPos);
      // lantern + windows
      const fl = 0.88 + 0.08 * Math.sin(t * 13.1) * Math.sin(t * 7.7 + 1.3) + 0.04 * Math.sin(t * 3.1);
      props.glassMat.emissiveIntensity = tod.lantern * 3.2 * fl;
      props.lanternLight.intensity = tod.lantern * 7.5 * fl;
      props.winMat.emissiveIntensity = tod.lantern * 2.0 * (0.95 + 0.05 * Math.sin(t * 5.3));
      // rowboat bobbing
      const b = props.boat, bb = props.boatBase;
      b.position.y = waveHeight(bb.x, bb.z, t, -H(bb.x, bb.z)) - 0.14 + Math.sin(t * 1.3) * 0.025;
      b.rotation.z = Math.sin(t * 1.1) * 0.035;
      b.rotation.x = Math.sin(t * 0.9 + 1) * 0.03;
      b.rotation.y = bb.yaw + Math.sin(t * 0.21) * 0.06;
      fauna.update(dt, t, { dusk: tod.dusk, night: tod.night });
      fx.update(dt, t, { night: smoothstep(0.4, 0.95, tod.night) });
    }

    return {
      scene, camera, view, post,
      update,
      feed,
      feedRandom,
      addMember: m => fauna.addMember(m),
      creatures: () => fauna.creatures(),
      resize() { water.resize(); },
      _debug: { terrain, props, fx, fauna, water, sky },
      dispose() {
        water.dispose(); sky.dispose(); terrain.dispose(); flora.dispose(); props.dispose(); fx.dispose(); fauna.dispose();
        normalTex.dispose();
        if (scene.environment) scene.environment = null;
      },
    };
  },
};
