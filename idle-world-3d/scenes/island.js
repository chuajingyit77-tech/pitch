// 晴岛 · 热带海岛 — a small tropical island in an open ocean, seen from an aerial 3/4 orbit.
// Art direction: Sea of Thieves water (rich reflective deep ocean, sun glitter, turquoise swell glow)
// + Animal Crossing coziness (soft sand, palms, a little dock, hut and lantern, friendly residents).
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, createNoise, createWind, sunState } from '../lib/util.js';
import { waterUniforms, WATER_PERIOD, LAYER_NO_REFLECT } from './island/shared.js';
import { createTerrain } from './island/terrain.js';
import { createWater, waveHeight } from './island/water.js';
import { createSky } from './island/sky.js';
import { createFlora } from './island/flora.js';
import { planProps, createProps } from './island/props.js';
import { createFx } from './island/fx.js';
import { createFauna } from './island/fauna.js';
import { createGiant } from './island/whale.js';
import { createWhaleFx } from './island/whalefx.js';
import { createAtmos } from './island/atmos.js';
import { createSeabirds } from './island/seabirds.js';
import { createFlyingFish } from './island/flyingfish.js';

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
    // PCF-soft compares texels up to ~2 away; a normal offset of two texels keeps grazing light (golden
    // hour, the moon low over the sea) free of acne stripes that crawl as the camera drifts
    sun.shadow.normalBias = 2 * (sc.right - sc.left) / sm;
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
    const SUN_OPTS = { azimuthOffset: SUN_AZ };
    // The moon hangs low over the sea in front of the opening view so its path glitters behind the island.
    const moonYaw = viewYaw - 0.3;
    const moonFlat = new THREE.Vector2(-Math.sin(moonYaw), -Math.cos(moonYaw));

    /* ---------------- the gentle giant (a humpback passing far out every few minutes) ---------------- */
    const whaleFx = createWhaleFx(env, { wind });
    // what hides the sea behind the island (palm crowns, the hill, the hut): passes keep clear of it
    const occluders = flora.palmTops.map(p => ({ x: p.x, y: p.y, z: p.z, r: 3.4 }));
    occluders.push({ x: terrain.hill.x, y: terrain.hill.h, z: terrain.hill.z, r: terrain.hill.r * 0.8 });
    occluders.push({ x: plan.hut.x, y: plan.hut.y + 3.5, z: plan.hut.z, r: 2.4 });
    const giant = createGiant(env, { camera, view, fx: whaleFx, wind, occluders });
    scene.add(giant.group, whaleFx.group);
    const GL = { rim: new THREE.Color(), haze: new THREE.Color() };
    // layered light (rays through the cloud bank, dawn mist) and the life around the giant: a flock of boobies,
    // flying fish
    const atmos = createAtmos(env);
    const boobies = createSeabirds(env, { fx: whaleFx });
    const flyfish = createFlyingFish(env, { fx: whaleFx });
    scene.add(atmos.group, boobies.mesh, flyfish.mesh);
    const AL = { sunDir: new THREE.Vector3(), sunCol: new THREE.Color(), elev: 0, golden: 0, hours: 12, horizon: new THREE.Color(), zenith: new THREE.Color() };
    const FXL = { keyDir: new THREE.Vector3(0, 1, 0), key: new THREE.Color(), amb: new THREE.Color(), backK: 0.4, glow: new THREE.Color(), haze: new THREE.Color() };

    /* ---------------- time of day ---------------- */
    const post = {
      bloom: { strength: 0.35, radius: 0.55, threshold: 1.0 },
      exposure: 1.0, toneMapping: 'aces',
      vignette: 0.35, grain: 0.02, saturation: 1.12, contrast: 1.05,
      lift: [0, 0.004, 0.012], gain: [1, 1, 1], ca: 0.0012,
      tilt: { amount: 0.22, center: 0.52, width: 0.24 },
    };
    const tod = { hours: -1, keyHours: -1, elev: 0, day: 1, night: 0, golden: 0, lantern: 0, dusk: 0, envElev: -999, envNight: -1, timer: 0 };
    const C = {
      sunCol: new THREE.Color(), moon: new THREE.Color('#9fb6ff'), tmp: new THREE.Color(), tmp2: new THREE.Color(),
      deepDay: new THREE.Color(0.0045, 0.042, 0.105), deepGold: new THREE.Color(0.012, 0.035, 0.08), deepNight: new THREE.Color(0.0012, 0.006, 0.02),
      horizon: new THREE.Color(), seaEnv: new THREE.Color(),
      // parsed once: applyTime runs every frame while the clock glides to each new minute
      artZen: new THREE.Color('#1f6fd6'), artHor: new THREE.Color('#6cb8ec'), sand: new THREE.Color('#e2cfa0'),
    };
    const sunDir = new THREE.Vector3(), moonDir = new THREE.Vector3(), keyDir = new THREE.Vector3();
    // The key light is one shadow-casting DirectionalLight: the sun by day, the moon by night. It may only
    // change direction while it is dark, so the sun's share fades to exactly 0 at KEY_SWAP (deg of sun
    // elevation) and the moon's share starts from 0 there. (It used to jump between the two at full strength.)
    const KEY_SWAP = -3.5;
    const MIN_KEY_SIN = Math.sin(THREE.MathUtils.degToRad(0.5)); // never light the island from below the horizon

    function moonDirAt(h, out) {
      // 0 at dusk → 1 at dawn; by day (moon invisible) it glides back, so the path never jumps at 18:30
      const ph = (h + 24 - 18.5) % 24;
      const nightPhase = ph <= 11 ? ph / 11 : 1 - (ph - 11) / 13;
      const el = THREE.MathUtils.degToRad(12 + 16 * Math.sin(nightPhase * Math.PI));
      const sway = (nightPhase - 0.5) * 0.9;
      const cx = moonFlat.x * Math.cos(sway) - moonFlat.y * Math.sin(sway), cz = moonFlat.x * Math.sin(sway) + moonFlat.y * Math.cos(sway);
      return out.set(cx * Math.cos(el), Math.sin(el), cz * Math.cos(el)).normalize();
    }

    /**
     * h: the (eased) hour all colours, the sky and the water follow; hKey: the clock's own hour, which
     * only steps once a minute and sets the shadow-casting light's direction (stepping shadows beat
     * shadows that slide and shimmer). Easing h over ~1 s turns each minute's small step in sky, ambient
     * and water brightness into a glide instead of a once-a-minute pulse.
     */
    function applyTime(force = false, h = env.hours(), hKey = h) {
      if (!force && h === tod.hours && hKey === tod.keyHours) return;
      tod.hours = h; tod.keyHours = hKey;
      const s = sunState(h - SUN_SHIFT, SUN_OPTS);
      sunDir.copy(s.dir);
      moonDirAt(h, moonDir);
      const sKey = hKey === h ? s : sunState(hKey - SUN_SHIFT, SUN_OPTS);
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
      su.uArtZen.value.copy(s.zenith).lerp(C.artZen, 0.45 * day * (1 - golden));
      su.uArtHor.value.copy(s.horizon).lerp(C.artHor, 0.75 * day * (1 - golden));
      su.uArtSun.value.copy(C.sunCol).multiplyScalar(1.1);
      const twi = smoothstep(2, -4, s.elevationDeg);
      su.uArtMix.value = lerp(lerp(0.84, 0.5, golden), 0.88, twi);
      su.uArtGain.value = lerp(1.18, 1.35, Math.max(golden, twi)) * (1 - night * 0.5);
      su.uSkySat.value = 1.25;

      // key light: the sun by day, the moon by night (see KEY_SWAP)
      const sunVis = smoothstep(KEY_SWAP, 2.5, s.elevationDeg);
      const sunI = s.sunIntensity * 1.15 * sunVis;
      const moonI = 0.36 * night;
      if (sKey.elevationDeg > KEY_SWAP) {
        keyDir.copy(sKey.dir);
        if (keyDir.y < MIN_KEY_SIN) {
          const k = Math.sqrt(1 - MIN_KEY_SIN * MIN_KEY_SIN) / (Math.hypot(keyDir.x, keyDir.z) || 1);
          keyDir.set(keyDir.x * k, MIN_KEY_SIN, keyDir.z * k);
        }
        sun.color.copy(C.sunCol);
        sun.intensity = sunI + moonI * 0.2 * sunVis;
      } else {
        moonDirAt(hKey, keyDir);
        sun.color.copy(C.moon);
        sun.intensity = moonI * smoothstep(KEY_SWAP, KEY_SWAP - 3.5, s.elevationDeg);
      }
      sun.position.copy(keyDir).multiplyScalar(80);
      hemi.color.copy(s.skyAmbient);
      hemi.groundColor.copy(s.groundAmbient).lerp(C.sand, 0.35 * day);
      hemi.intensity = s.ambientIntensity * lerp(0.75, 0.45, day);

      // water volume (shared by every submerged material)
      const light = sunI * 0.28 * Math.max(0.15, Math.sin(Math.max(s.elevation, 0.05))) + s.ambientIntensity * 0.55 + moonI * 0.2;
      waterUniforms.uDeep.value.copy(C.deepDay).lerp(C.deepGold, golden * 0.7).lerp(C.deepNight, night).multiplyScalar(lerp(light, 1, night));
      waterUniforms.uCaustic.value.copy(C.sunCol).multiplyScalar(sunI * 0.55 + moonI * 0.25);

      // water surface
      const wu = water.uniforms;
      wu.uSunDir.value.copy(sunDir);
      wu.uSunCol.value.copy(C.sunCol).multiplyScalar(sunI * 1.1);
      wu.uMoonDir.value.copy(moonDir);
      wu.uMoonCol.value.copy(C.moon).multiplyScalar(night * 0.7);
      wu.uSSS.value.setRGB(0.0, 0.55, 0.42).multiplyScalar(sunI * 0.11 + 0.02 * day).lerp(C.tmp.setRGB(0.25, 0.32, 0.15).multiplyScalar(sunI * 0.12), golden * 0.5);
      wu.uFoamCol.value.copy(C.sunCol).lerp(C.tmp.setRGB(1, 1, 1), 0.45).multiplyScalar(sunI * 0.26 * (1 - golden * 0.45)).add(C.tmp.copy(s.skyAmbient).multiplyScalar(s.ambientIntensity * 0.5));
      wu.uGlow.value.setRGB(0.04, 0.5, 1.6).multiplyScalar(1.6 * smoothstep(0.35, 0.95, night));
      wu.uNight.value = night;
      // the far sea fades into the colour the sky has right at the horizon (sky.js: its art gradient, weighted as the
      // sky weights it, plus the night glow), away from the sun and toward it. It used to fade to a far darker
      // colour at night, which drew a black line with a red fringe under the sky's lit horizon all night long
      const kArt = lerp(lerp(1.05, 0.85, golden), su.uArtMix.value * su.uArtGain.value, night);
      C.tmp2.copy(su.uNightHor.value).multiplyScalar(su.uNight.value);
      C.horizon.copy(su.uArtHor.value).lerp(C.tmp.copy(su.uArtZen.value), 0.15).multiplyScalar(kArt).add(C.tmp2);
      wu.uHorizonSun.value.copy(su.uArtSun.value).lerp(C.tmp.copy(su.uArtZen.value), 0.15).multiplyScalar(kArt).add(C.tmp2);
      wu.uHorizon.value.copy(C.horizon);
      wu.uSkyFallback.value.copy(C.horizon);

      // clouds
      const cu = sky.clouds.uniforms;
      cu.uSunDir.value.copy(sunDir);
      cu.uMoonDir.value.copy(moonDir);
      cu.uLit.value.copy(C.sunCol).multiplyScalar(sunI * 0.42 + 0.05).add(C.tmp.copy(s.skyAmbient).multiplyScalar(0.35 * s.ambientIntensity));
      cu.uLitMoon.value.copy(C.moon).multiplyScalar(0.16 + 0.2 * night).add(C.tmp.copy(s.horizon).multiplyScalar(0.6));
      cu.uMoonW.value = smoothstep(0.5, -7, s.elevationDeg);
      cu.uShade.value.copy(s.skyAmbient).multiplyScalar(0.55 * s.ambientIntensity).lerp(C.tmp.copy(s.horizon).multiplyScalar(0.55), 0.35);
      if (golden > 0) cu.uShade.value.lerp(C.tmp.setRGB(0.42, 0.26, 0.36), golden * 0.5);
      cu.uShade.value.multiplyScalar(1 - night * 0.2).add(C.tmp.copy(C.moon).multiplyScalar(0.035 * night));
      cu.uRim.value.copy(C.sunCol).multiplyScalar(sunI * 0.45 + 0.02);
      cu.uHaze.value.copy(C.horizon);
      cu.uOpacity.value = lerp(1, 0.6, night);

      // the gentle giant: a soft sheen on its wet skin (sky by day, moon by night) and the haze it sits in; its
      // spray lit by the key light, glowing gold against a low sun and blue with plankton at night
      GL.rim.copy(s.skyAmbient).multiplyScalar(0.16 * s.ambientIntensity).lerp(C.tmp.copy(C.moon).multiplyScalar(0.2), night);
      GL.haze.copy(C.horizon);
      giant.setLight(GL);
      FXL.keyDir.copy(keyDir);
      FXL.key.copy(sun.color).multiplyScalar(sun.intensity);
      FXL.amb.copy(hemi.color).multiplyScalar(hemi.intensity * 1.6).add(C.tmp.copy(C.horizon).multiplyScalar(0.25));
      FXL.backK = 0.35 + golden * 1.3;
      FXL.glow.copy(wu.uGlow.value);
      FXL.haze.copy(C.horizon);
      whaleFx.setLight(FXL);
      AL.sunDir.copy(sunDir); AL.sunCol.copy(C.sunCol).multiplyScalar(s.sunIntensity); AL.elev = s.elevationDeg; AL.golden = golden;
      AL.hours = h; AL.horizon.copy(C.horizon); AL.zenith.copy(su.uArtZen.value);
      atmos.setLight(AL);

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

      // environment map (PMREM of the sky), refreshed when the light changed noticeably. Small steps: each
      // rebuild swaps the whole image-based light at once, so big steps read as a brightness pop at dusk.
      // (The old texture is only disposed after the new one exists: never a frame without an env map.)
      if (force || Math.abs(tod.envElev - s.elevationDeg) > 0.5 || Math.abs(tod.envNight - night) > 0.025) {
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
    let todTimer = 0, hEased = env.hours();
    const faunaInfo = { dusk: 0, night: 0, timeJump: false }, fxInfo = { night: 0 }, giantInfo = { glow: 0 }; // reused every frame
    const whaleNow = { on: false, x: 0, z: 0 };
    const birdInfo = { day: 1, focus: giant.focus, time: 0 }, fishInfo = { day: 1, dolphins: fauna.dolphins.list, whale: whaleNow, time: 0 };
    const _buf = new THREE.Vector2();
    function update(dt, t) {
      // shader clocks wrapped seamlessly (every rate reading them completes whole cycles: island/shared.js), so
      // float32 keeps full precision on a screen left on for days; scrolls and drifts are wrapped in setTime
      const tw = t % WATER_PERIOD;
      waterUniforms.uWTime.value = tw;
      sky.uniforms.uTime.value = tw;
      water.setTime(t);
      wind.update(dt);
      // ease toward the clock (it steps once a minute); snap on big jumps (time set by hand, a new day)
      const hClock = env.hours();
      let dh = hClock - hEased;
      if (dh > 12) dh -= 24; else if (dh < -12) dh += 24;
      const timeJump = Math.abs(dh) > 0.25;
      if (timeJump || Math.abs(dh) < 2e-5) hEased = hClock;
      else hEased = (hEased + dh * (1 - Math.exp(-dt / 0.4)) + 24) % 24;
      todTimer -= dt;
      if (todTimer <= 0 || hEased !== tod.hours || hClock !== tod.keyHours || timeJump) { todTimer = 0.25; applyTime(false, hEased, hClock); }
      sky.clouds.update(dt);
      // lantern + windows
      const fl = 0.89 + 0.045 * Math.sin(t * 7.3) * Math.sin(t * 4.1 + 1.3) + 0.055 * Math.sin(t * 2.3);
      props.glassMat.emissiveIntensity = tod.lantern * 3.2 * fl;
      props.lanternLight.intensity = tod.lantern * 7.5 * fl;
      props.winMat.emissiveIntensity = tod.lantern * 2.0 * (0.95 + 0.05 * Math.sin(t * 5.3));
      // rowboat bobbing
      const b = props.boat, bb = props.boatBase;
      b.position.y = waveHeight(bb.x, bb.z, t, -H(bb.x, bb.z)) - 0.14 + Math.sin(t * 1.3) * 0.025;
      b.rotation.z = Math.sin(t * 1.1) * 0.035;
      b.rotation.x = Math.sin(t * 0.9 + 1) * 0.03;
      b.rotation.y = bb.yaw + Math.sin(t * 0.21) * 0.06;
      faunaInfo.dusk = tod.dusk; faunaInfo.night = tod.night; faunaInfo.timeJump = timeJump;
      fauna.update(dt, t, faunaInfo);
      fxInfo.night = smoothstep(0.4, 0.95, tod.night);
      fx.update(dt, t, fxInfo);
      giantInfo.glow = fxInfo.night;
      giant.update(dt, t, giantInfo);
      const mom = giant.whales[0];
      whaleNow.on = mom.mesh.visible; whaleNow.x = mom.pose.root.x; whaleNow.z = mom.pose.root.z;
      const bufH = env.renderer.getDrawingBufferSize(_buf).y;
      birdInfo.day = tod.day; birdInfo.time = t;
      boobies.setView(bufH, camera.projectionMatrix);
      boobies.update(dt, t, birdInfo);
      fishInfo.day = tod.day; fishInfo.time = t;
      flyfish.update(dt, t, fishInfo);
      atmos.update(dt, t);
      whaleFx.setView(bufH, camera.projectionMatrix);
      whaleFx.update(dt);
    }

    return {
      scene, camera, view, post,
      update,
      feed,
      feedRandom,
      addMember: m => fauna.addMember(m),
      creatures: () => fauna.creatures(),
      resize() { water.resize(); },
      /** Test hook: start a whale pass now (if none is on) and play it to pass time t (s); returns its timeline. */
      debugGiant: (t = 0, opts = {}) => giant.debug(t, opts),
      giantTimeline: () => giant.timeline(),
      _debug: { terrain, props, fx, fauna, water, sky, flora, giant, whaleFx, atmos, boobies, flyfish },
      dispose() {
        water.dispose(); sky.dispose(); terrain.dispose(); flora.dispose(); props.dispose(); fx.dispose(); fauna.dispose();
        giant.dispose(); whaleFx.dispose(); atmos.dispose(); boobies.dispose(); flyfish.dispose();
        normalTex.dispose();
        if (scene.environment) scene.environment = null;
      },
    };
  },
};
