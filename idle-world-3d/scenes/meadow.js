// 芒原 · 狐与鸟居 — a golden susuki field rolling in the wind, a vermilion torii on a rise, crimson
// maples, misty layered mountains; foxes (and Inari's white fox) that come running for fried tofu.
// Art direction inspired by Ghost of Tsushima; all assets procedural except the CC0 Fox / Stork models.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { TAU, clamp, lerp, smoothstep, damp, angleDelta, createNoise, createWind, addWind, patchMaterial, softDiscTexture } from '../lib/util.js';
import { samplePalette, makeFogUniforms, addFog, createSkyMaterial, buildMountains, SKY_PERIOD } from './meadow/sky.js';
import { makeWindUniforms, makeGrassColorUniforms, grassMaterial, buildClump, buildPlumeStalk, instancedFrom, windowedInstances, buildMaple, mapleLeafMaterial, mapleLeafDepthMaterial, buildGrove, WIND_GLSL, SPIRIT_GLSL, SWAY_RATE, FLUTTER_RATE } from './meadow/flora.js';
import { buildTorii, buildHokora, buildLantern, makeStoneMaterial, makeTofuFactory } from './meadow/props.js';
import { buildRocks, makeRockMaterial, rockSurfaceTexture, rockFootTufts } from './meadow/rock.js';
import * as TX from './meadow/tex.js';
import { createFx } from './meadow/fx.js';
import { applyFoxPose, findFoxBones } from './meadow/foxpose.js';
import { pnSmoothSkinned } from './meadow/foxgeo.js';
import { Giants } from './meadow/giants.js';
import { createShafts, createMist } from './meadow/light.js';
import { createSparrows, createMoths } from './meadow/fauna.js';
import { createEnvRefresher } from '../lib/envmap.js';

const FOX_SCALE = 0.0078;     // ≈1.2 m nose to tail
const CLOUD_TAU = 300000;     // s: the sky's cloud drift runs on sin(t / CLOUD_TAU), a period of 22 days
const WALK_REF = 115;         // walking ground speed in model units / s (× scale = m/s)
const RUN_REF = 240;          // running ground speed / 1.45
const CLIPS = ['Survey', 'Walk', 'Run'];
// Ground speed of each locomotion clip at timeScale 1 (model units / s): the backward speed of its planted paws,
// measured from Fox.glb (Walk 94-117 depending on how strictly "planted" is taken; Run 194-215 for the hind paws,
// its forepaws never plant cleanly). Playback rates are derived from these so the paws stay planted.
const WALK_GROUND = 115;
const RUN_GROUND = 210;
const RUN_PHASE = 0.15;       // Run cycle offset against Walk so the hind paws land together in a walk/run blend
const PAW_ARM = 27;           // paws' distance from the turning pivot (model units): turning on the spot steps the legs
const AVOID_CLEAR = 0.45;     // clearance kept around props when walking past them (m)

export default {
  id: 'meadow',
  food: '油豆腐',
  kinds: { fox: { zh: '狐狸' }, whiteFox: { zh: '白狐' } },
  starter: ['fox', 'whiteFox', 'fox'],
  addable: ['fox', 'fox', 'whiteFox'],
  maxMembers: 8,
  ambience: hours => (hours >= 18.8 || hours < 5.3 ? ['wind', 'insects'] : ['wind', 'birds']),
  eatSound: 'eat',

  async create(env) {
    const q = env.q;
    const rng = env.rng;
    const noise = createNoise(env.seed);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.15, 4200);
    const disposables = [];
    const own = x => { disposables.push(x); return x; };

    /* ================================================================ */
    /* Terrain + layout                                                  */
    /* ================================================================ */
    const lay = rng.fork('layout');
    function baseHeight(x, z) {
      let h = noise.fbm2(x * 0.0105 + 3.7, z * 0.0105 - 1.3, 4) * 3.2;
      h += noise.fbm2(x * 0.042 - 8.1, z * 0.042 + 2.2, 3) * 0.45;
      const r2 = x * x + (z + 1.5) * (z + 1.5);
      h += 1.7 * Math.exp(-r2 / (2 * 9.5 * 9.5));
      h -= 0.8 * smoothstep(4, 24, z);
      const d = Math.hypot(x, z);
      h += smoothstep(70, 300, d) * (noise.fbm2(x * 0.0045 + 11, z * 0.0045 - 7, 3) * 7 + 1.5);
      return h;
    }
    // A gentle knoll on the far side of the field, right of the torii in the default view, its top a grazed lawn:
    // the sika herd's stage (they are shorter than the susuki, and the field lies below the torii's mound). The
    // ground blends to a flat crest a little above the mound's height, whatever the seed's terrain (an added bump
    // left the slope facing the viewer higher than the crest on some seeds, hiding the herd); exactly the old
    // ground outside its footprint, so nothing near the torii moves. (Its own fork: the layout stream is untouched.)
    const knr = rng.fork('knoll');
    const KNOLL = { x: knr.range(3.5, 6.0), z: knr.range(-23, -20.5), rx: 24, rz: 17, top: 0, lx: 9.5, lz: 9, lzo: 3 };
    KNOLL.top = baseHeight(0, 0) + 0.8;
    function rawHeight(x, z) {
      const h = baseHeight(x, z);
      const dx = (x - KNOLL.x) / KNOLL.rx, dz = (z - KNOLL.z) / KNOLL.rz, r2 = dx * dx + dz * dz;
      return r2 < 1 ? h + (KNOLL.top - h) * smoothstep(1, 0.4, Math.sqrt(r2)) : h;
    }
    /** 1 on the knoll's grazed lawn (its crest and the slope toward the view: short, greener grass), 0 off it. */
    function lawnAt(x, z) {
      const dx = (x - KNOLL.x) / KNOLL.lx, dz = (z - KNOLL.z - KNOLL.lzo) / KNOLL.lz;
      return 1 - smoothstep(0.72, 1.1, Math.sqrt(dx * dx + dz * dz) + 0.18 * noise.noise2(x * 0.21 + 5.1, z * 0.21 - 2.7));
    }
    const H0 = rawHeight(0, 0);
    const heightAt = (x, z) => rawHeight(x, z) - H0;

    const SHRINE = new THREE.Vector3(lay.range(-0.5, 0.5), 0, -4.4);
    SHRINE.y = heightAt(SHRINE.x, SHRINE.z);
    // footpath: from the shrine, through the torii, meandering toward the viewer
    const ctrl = [new THREE.Vector3(SHRINE.x, 0, SHRINE.z + 0.9), new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 3.2)];
    let px = 0;
    for (let i = 0; i < 6; i++) { px += lay.range(1.0, 2.6) * (i % 2 ? -1 : 1) * (i === 0 ? 0.6 : 1) * (lay.chance(0.5) ? 1 : -1) * (i === 0 ? 1 : 1); px = clamp(px, -5, 5); ctrl.push(new THREE.Vector3(px, 0, 3.2 + (i + 1) * 5.6)); }
    const pathCurve = new THREE.CatmullRomCurve3(ctrl, false, 'centripetal');
    const path = pathCurve.getSpacedPoints(90).map(p => new THREE.Vector2(p.x, p.z));
    function pathDist(x, z) {
      let best = 1e9;
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1];
        const bx = b.x - a.x, bz = b.y - a.y, ax = x - a.x, az = z - a.y;
        const h = clamp((ax * bx + az * bz) / (bx * bx + bz * bz), 0, 1);
        const dx = ax - bx * h, dz = az - bz * h;
        const d = dx * dx + dz * dz;
        if (d < best) best = d;
      }
      return Math.sqrt(best);
    }
    const pathPoint = (t, out = new THREE.Vector3()) => { const p = pathCurve.getPointAt(clamp(t, 0, 1)); return out.set(p.x, heightAt(p.x, p.z), p.z); };

    const TARGET = new THREE.Vector3(1.7, 1.45, 0.2);
    const LANTERNS = [new THREE.Vector3(-1.8, 0, 2.6), new THREE.Vector3(1.8, 0, 2.6)];
    LANTERNS.forEach(l => { l.y = heightAt(l.x, l.z); });
    // maples: hero tree beside the torii, others layered behind
    const treeSpots = [
      { x: lay.range(-6.4, -5.4), z: lay.range(-3.6, -1.6), s: lay.range(1.05, 1.2) },
      { x: lay.range(5.5, 8.0), z: lay.range(-9.5, -6.0), s: lay.range(0.9, 1.05) },
      { x: lay.range(-17, -12), z: lay.range(-20, -12), s: lay.range(1.0, 1.25) },
      { x: lay.range(13, 19), z: lay.range(-30, -20), s: lay.range(1.1, 1.3) },
    ];
    if (q > 0.6) treeSpots.push({ x: lay.range(-30, -22), z: lay.range(-45, -34), s: 1.3 }, { x: lay.range(24, 34), z: lay.range(-12, -4), s: 1.15 });
    treeSpots.forEach(t => { t.y = heightAt(t.x, t.z); });
    const rockList = [{ x: 2.7, z: 1.3, s: 0.45 }, { x: -2.6, z: -1.7, s: 0.55 }, { x: SHRINE.x + 1.3, z: SHRINE.z + 0.3, s: 0.35 }];
    for (let i = 0; i < 16; i++) {
      const a = lay.range(-2.4, 2.4) - Math.PI / 2 + Math.PI / 2, r = lay.range(4, 28);
      const x = Math.sin(a) * r * 1.2, z = -Math.cos(a) * r + 6;
      if (pathDist(x, z) < 1.3 || Math.hypot(x, z) < 3.5) continue;
      rockList.push({ x, z, s: lay.range(0.3, 1.0) });
    }
    for (let i = 0; i < 8; i++) {
      const p = pathCurve.getPointAt(lay.range(0.08, 0.95));
      const side = lay.sign();
      rockList.push({ x: p.x + side * lay.range(0.75, 1.1), z: p.z + lay.range(-0.3, 0.3), s: lay.range(0.1, 0.22) });
    }
    // obstacles for fox steering (the shrine circle also covers the two stone-fox pedestals beside it)
    const obstacles = [
      { x: -1.375, z: 0, r: 0.42 }, { x: 1.375, z: 0, r: 0.42 },
      { x: LANTERNS[0].x, z: LANTERNS[0].z, r: 0.5 }, { x: LANTERNS[1].x, z: LANTERNS[1].z, r: 0.5 },
      { x: SHRINE.x, z: SHRINE.z + 0.3, r: 1.55 },
      ...treeSpots.map(t => ({ x: t.x, z: t.z, r: 0.45 })),
      ...rockList.filter(r => r.s > 0.3).map(r => ({ x: r.x, z: r.z, r: r.s * 1.1 })),
    ];
    /** Push a ground point radially out of every prop (goals and offerings must be reachable and visible). */
    function clearOfObstacles(p, margin) {
      for (let pass = 0; pass < 3; pass++) {
        for (const o of obstacles) {
          const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), R = o.r + margin;
          if (d >= R) continue;
          if (d > 1e-4) { p.x = o.x + dx / d * R; p.z = o.z + dz / d * R; } else p.z = o.z + R;
        }
      }
      return p;
    }

    function grassFactor(x, z) {
      if (x * x + z * z > 3600) return 1;
      const pd = pathDist(x, z);
      let f = smoothstep(0.55, 2.6, pd);
      const dT = Math.hypot(x, z - 0.2);
      f = Math.min(f, 0.22 + 0.78 * smoothstep(2.4, 5.2, dT));
      const dS = Math.hypot(x - SHRINE.x, z - SHRINE.z);
      f = Math.min(f, 0.2 + 0.8 * smoothstep(1.6, 3.8, dS));
      for (const l of LANTERNS) f = Math.min(f, smoothstep(0.35, 1.2, Math.hypot(x - l.x, z - l.z)));
      for (const t of treeSpots) f = Math.min(f, 0.42 + 0.58 * smoothstep(0.8, 3.4, Math.hypot(x - t.x, z - t.z)));
      for (const r of rockList) if (r.s > 0.28) f = Math.min(f, smoothstep(r.s * 0.7, r.s * 1.5, Math.hypot(x - r.x, z - r.z)));
      return f;
    }

    /* ================================================================ */
    /* Atmosphere: sky, sun/moon, fog, mountains                         */
    /* ================================================================ */
    const SUN_AZ = 1.78 + rng.range(-0.06, 0.06);
    const sunOpts = { azimuthOffset: SUN_AZ };
    const fogU = makeFogUniforms();
    const skyMat = own(createSkyMaterial(fogU));
    const sky = new THREE.Mesh(new THREE.SphereGeometry(3000, 48, 24), skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    scene.add(sky);
    const envScene = new THREE.Scene();
    const envSky = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), skyMat);
    envScene.add(envSky);
    // refreshed in place (lib/envmap.js): fromScene made a new target every refresh, a hitch on the iPad
    const envMap = createEnvRefresher(env.renderer, envScene, { near: 0.1, far: 100 });
    let envKey = -999, envRefL = 1, envMats = null;
    const lumOf = c => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    // sunset azimuth (from the torii, angle around -Z toward +X)
    const ss = THREE.MathUtils.degToRad;
    const sDir18 = (() => { const s = sunStateDir(17.9); return Math.atan2(s.x, -s.z); })();
    function sunStateDir(h) { const H = ss((h - 12) * 15), lat = ss(25); const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat)) + SUN_AZ; return new THREE.Vector3(-Math.sin(az), 0, Math.cos(az)); }
    const mountains = buildMountains({ noise: createNoise(env.seed ^ 0x51ed), rng: rng.fork('mtn'), fogU, sunsetAz: sDir18 });
    scene.add(mountains);

    const sunLight = new THREE.DirectionalLight('#ffffff', 3);
    sunLight.castShadow = !!env.shadows;
    const smap = q >= 0.9 ? 2048 : 1024;
    sunLight.shadow.mapSize.set(smap, smap);
    Object.assign(sunLight.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 180 });
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.035;
    scene.add(sunLight, sunLight.target);
    const hemi = new THREE.HemisphereLight('#a8c0e0', '#806a48', 0.8);
    scene.add(hemi);

    /* ================================================================ */
    /* Terrain mesh                                                      */
    /* ================================================================ */
    const windU = makeWindUniforms();
    const baseWind = new THREE.Vector2(rng.range(0.55, 0.95), rng.range(-0.75, -0.35)).normalize(); // blowing away from the viewer, toward the torii
    windU.uWindDir.value.copy(baseWind);
    {
      const n = q >= 0.9 ? 230 : q >= 0.6 ? 190 : 150;
      const f = u => Math.sign(u) * (38 * Math.abs(u) + 760 * Math.pow(Math.abs(u), 3.3));
      const P = [], I = [];
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
        const x = f(-1 + 2 * i / n), z = f(-1 + 2 * j / n);
        P.push(x, heightAt(x, z), z);
      }
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i, b = a + n + 1;
        I.push(a, b, a + 1, a + 1, b, b + 1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setIndex(I);
      geo.computeVertexNormals();
      const pathU = new Array(24).fill(0).map((_, i) => { const p = pathCurve.getPointAt(i / 23); return new THREE.Vector2(p.x, p.z); });
      const tmat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
      patchMaterial(tmat, {
        key: 'meadowTerrain',
        uniforms: { ...windU, uPath: { value: pathU }, uPathW: { value: 0.58 }, uNearCol: { value: new THREE.Color('#3e3622') }, uFarCol: { value: new THREE.Color('#8c7442') }, uFarCol2: { value: new THREE.Color('#4e4a2a') }, uDirtCol: { value: new THREE.Color('#7c6548') },
          uLawn: { value: new THREE.Vector4(KNOLL.x, KNOLL.z + KNOLL.lzo, 1 / KNOLL.lx, 1 / KNOLL.lz) }, uTurfCol: { value: new THREE.Color('#6a6a32') } },
        vertexHeader: '',
        fragmentHeader: WIND_GLSL.replace(/uniform vec4 uPress\[4\];/, 'uniform vec4 uPress[4];') + SPIRIT_GLSL + `
          uniform vec2 uPath[24]; uniform float uPathW; uniform vec3 uNearCol, uFarCol, uFarCol2, uDirtCol, uTurfCol; uniform vec4 uLawn;
          float pathDistF(vec2 p){ float d = 1e9; for (int i = 0; i < 23; i++){ vec2 a = uPath[i], b = uPath[i + 1]; vec2 pa = p - a, ba = b - a;
            float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); d = min(d, length(pa - ba * h)); } return d; }`,
        fragment: {
          '#include <color_fragment>': /* glsl */`
            {
              vec3 wp = vFogWorld;
              float dc = length(wp.xz - cameraPosition.xz);
              float pat = mNoise(wp.xz * 0.13) * 0.6 + mNoise(wp.xz * 0.55 + 3.0) * 0.4;
              vec3 nearC = uNearCol * (0.7 + 0.6 * pat);
              float g = gustAt(wp.xz);
              float big = mNoise(wp.xz * 0.012 + 7.0) * 0.6 + mNoise(wp.xz * 0.035) * 0.4;
              float streak = mNoise(vec2(wp.x * 0.02, wp.z * 0.2));
              vec3 farC = mix(uFarCol, uFarCol2, smoothstep(0.45, 0.8, big)) * (0.72 + 0.3 * pat + 0.18 * streak + 0.32 * g);
              vec3 c = mix(nearC, farC, smoothstep(12.0, 55.0, dc));
              // the knoll's grazed lawn: short green-gold turf
              vec2 lq = (wp.xz - uLawn.xy) * uLawn.zw;
              float lawn = 1.0 - smoothstep(0.72, 1.1, length(lq) + 0.18 * (mNoise(wp.xz * 0.21) * 2.0 - 1.0));
              c = mix(c, uTurfCol * (0.72 + 0.5 * pat + 0.2 * big), lawn * 0.8);
              if (dot(wp.xz, wp.xz) < 3600.0) {
                float pd = pathDistF(wp.xz);
                float edge = uPathW + (mNoise(wp.xz * 2.1) - 0.5) * 0.32;
                float pm = 1.0 - smoothstep(edge - 0.2, edge + 0.15, pd);
                float wear = 1.0 - smoothstep(edge * 0.2, edge * 0.9, pd);
                vec3 dirt = uDirtCol * (0.72 + 0.4 * mNoise(wp.xz * 4.7) + 0.15 * wear);
                dirt *= 1.0 - 0.3 * smoothstep(0.74, 0.86, mNoise(wp.xz * 13.0 + 5.0)) * (1.0 - smoothstep(9.0, 22.0, dc));
                c = mix(c, dirt, pm);
              }
              diffuseColor.rgb = c;
            }`,
          // a pool of the spirit fox's light on the ground under it
          '#include <opaque_fragment>': 'outgoingLight += spiritGlow(vFogWorld, 0.3);\n$&',
        },
      });
      addFog(tmat, fogU, 'mfogTerr');
      const terrain = new THREE.Mesh(geo, tmat);
      terrain.receiveShadow = true;
      terrain.frustumCulled = false;
      scene.add(terrain);
    }

    /* ================================================================ */
    /* Susuki field                                                      */
    /* ================================================================ */
    const grng = rng.fork('grass');
    const colors = makeGrassColorUniforms();
    const plumeTex = own(TX.plumeTexture(env.seed & 0xffff));
    const grassMat = grassMaterial({ wind: windU, colors, fogU, plume: false, transl: 0.32 });
    const plumeMat = grassMaterial({ wind: windU, colors, fogU, plume: true, map: plumeTex, transl: 0.45, wrap: 0.6 });
    // plumes use alpha-to-coverage; on a target without multisampling they fall back to a plain cut-out
    const plumeU = plumeMat.userData.U;
    const probeMsaa = (r) => { const rt = r.getRenderTarget(); plumeU.uNoMsaa.value = rt && rt.samples > 0 ? 0 : 1; };
    {
      const camSamples = [];
      for (const d of [11, 16, 23]) for (let k = 0; k <= 8; k++) { const yaw = -0.9 + 1.8 * k / 8; camSamples.push([TARGET.x + d * Math.sin(yaw), TARGET.z + d * Math.cos(yaw)]); }
      const cosHalf = Math.cos(0.82);
      const visible = (x, z) => {
        for (const [cx, cz] of camSamples) {
          const vx = x - cx, vz = z - cz, dl = Math.hypot(vx, vz);
          if (dl < 0.6) return false;
          const fx = TARGET.x - cx, fz = TARGET.z - cz, fl = Math.hypot(fx, fz);
          if ((vx * fx + vz * fz) / (dl * fl) > cosHalf) return true;
        }
        return false;
      };
      const regions = [
        { r0: 0, r1: 24, step: 0.48, geo: buildClump(grng, { blades: 15, segs: 4, width: 0.024 }), pgeo: buildPlumeStalk({ planes: 3, segs: 3, plumeFrom: 0.72, width: 0.07 }), xz: 1.0, y: 1.0, pp: 0.34, chunk: 3 },
        { r0: 24, r1: 72, step: 0.92, geo: buildClump(grng, { blades: 11, segs: 3, width: 0.032 }), pgeo: buildPlumeStalk({ planes: 3, segs: 2, plumeFrom: 0.72, width: 0.075 }), xz: 1.3, y: 1.06, pp: 0.36, chunk: 6 },
        { r0: 72, r1: 200, step: 1.8, geo: buildClump(grng, { blades: 8, segs: 2, width: 0.05 }), pgeo: buildPlumeStalk({ planes: 2, segs: 2, plumeFrom: 0.7, width: 0.095 }), xz: 1.75, y: 1.14, pp: 0.3, chunk: 10 },
      ];
      // each draw covers only the plants that can be in view (windowedInstances): sorted by bearing around a point
      // 4 m behind the default camera (the views orbit the target from +z)
      const pivot = { x: TARGET.x, z: TARGET.z + 20 };
      for (const R of regions) {
        const step = R.step / Math.sqrt(Math.max(q, 0.3));
        const clumps = [], plumes = [];
        for (let gz = -R.r1; gz <= R.r1; gz += step) for (let gx = -R.r1; gx <= R.r1; gx += step) {
          const x = gx + grng.range(-0.45, 0.45) * step, z = gz + grng.range(-0.45, 0.45) * step;
          const d = Math.hypot(x, z);
          if (d < R.r0 || d >= R.r1) continue;
          if (!visible(x, z)) continue;
          const f = grassFactor(x, z);
          if (f < 0.1) continue;
          if (f < 0.4 && grng.chance(0.35)) continue;
          const patch = noise.fbm2(x * 0.06 + 40, z * 0.06, 2) * 0.5 + 0.5;
          // the knoll's grazed lawn: short, greener tussocks and no plumes (applied after the same random draws,
          // so every other plant of the field keeps its place)
          const lk = lawnAt(x, z);
          const H = (1.15 + 0.6 * grng.next()) * (0.78 + 0.4 * patch) * (0.24 + 0.76 * f) * R.y * (1 - 0.7 * lk);
          const y = heightAt(x, z) - 0.04;
          const hue = clamp((noise.fbm2(x * 0.03 - 9, z * 0.03 + 4, 2)) * 1.3 + (1 - f) * 0.7 + grng.range(-0.25, 0.25) + 0.85 * lk, -1, 1);
          const rec = { x, y, z, rot: grng.range(0, TAU), sx: H * grng.range(0.7, 1.0) * R.xz, sy: H, inst: [hue, grng.next(), grng.next(), grng.next()] };
          clumps.push(rec);
          if (f > 0.55 && grng.chance(R.pp * (0.6 + 0.8 * patch))) {
            const nP = grng.chance(0.35) ? 2 : 1;
            for (let k = 0; k < nP; k++) {
              const ph = H * grng.range(1.15, 1.45);
              const pl = { x: x + grng.range(-0.15, 0.15) * rec.sx, y, z: z + grng.range(-0.15, 0.15) * rec.sx, rot: Math.atan2(-baseWind.y, baseWind.x) + grng.range(-0.7, 0.7), sx: ph * grng.range(0.85, 1.1) * (R.xz > 1.5 ? 1.25 : 1), sy: ph, inst: [grng.range(-0.3, 0.3), grng.next(), grng.next(), grng.next()] };
              if (lk < 0.25) plumes.push(pl);
            }
          }
        }
        const gm = windowedInstances(R.geo, grassMat, clumps, { pivot, wind: windU, flex: 1, chunk: R.chunk });
        const pm = windowedInstances(R.pgeo, plumeMat, plumes, { pivot, wind: windU, flex: 1.3, chunk: R.chunk, before: probeMsaa });
        R.geo.dispose(); R.pgeo.dispose();
        scene.add(gm, pm);
      }
    }

    /* ================================================================ */
    /* Props: torii, shrine, lanterns, rocks, maples                     */
    /* ================================================================ */
    const stoneMaps = TX.stoneTextures(env.seed % 997);
    own(stoneMaps.map); own(stoneMaps.normalMap);
    const stoneMat = makeStoneMaterial(stoneMaps, fogU);
    const lacquer = own(TX.lacquerTexture());
    const torii = buildTorii({ fogU, lacquerMap: lacquer, plaqueMap: own(TX.plaqueTexture()), stoneMat, heightAt });
    torii.rotation.y = rng.range(-0.06, 0.06);
    scene.add(torii);
    const hokora = buildHokora({ fogU, woodMap: own(TX.woodTexture()), roofMap: own(TX.roofTexture()), stoneMat, shideMap: own(TX.shideTexture()) });
    hokora.position.copy(SHRINE);
    hokora.rotation.y = rng.range(-0.12, 0.12);
    scene.add(hokora);
    const winTex = own(TX.windowMaskTexture());
    winTex.wrapS = THREE.RepeatWrapping; winTex.repeat.set(6, 1);
    const windowMat = addFog(new THREE.MeshStandardMaterial({ map: stoneMaps.map, color: '#a39d90', roughness: 0.9, emissive: '#ffb066', emissiveMap: winTex, emissiveIntensity: 0 }), fogU, 'mfogWin');
    const discTex = own(softDiscTexture(64));
    const lanternLights = [];
    LANTERNS.forEach(l => {
      const lan = buildLantern({ stoneMat, windowMat });
      lan.position.copy(l);
      lan.rotation.y = rng.range(0, 1);
      scene.add(lan);
      const pl = new THREE.PointLight('#ffad5c', 0, 9, 2);
      pl.position.set(l.x, l.y + 1.18, l.z);
      scene.add(pl);
      lanternLights.push(pl);
    });
    // field boulders: ancient weathered stone with strata, cracks, lichen, moss on top and a damp foot (one merged
    // mesh), with grass tufts nestled at their feet (the field's clump material, one instanced mesh)
    const rockMat = makeRockMaterial(own(rockSurfaceTexture((env.seed % 997) + 31)), fogU);
    const rocks = buildRocks({ rng: rng.fork('rocks'), noise, list: rockList, heightAt, material: rockMat });
    scene.add(rocks);
    {
      const trng = rng.fork('rockTufts');
      const tuftGeo = buildClump(trng, { blades: 11, segs: 3, width: 0.026, spread: 0.07, leanMin: 0.3, leanMax: 0.85 });
      scene.add(instancedFrom(tuftGeo, grassMat, rockFootTufts(rocks.userData.feet, trng, heightAt)));
      tuftGeo.dispose();
    }

    const wind = createWind({ direction: new THREE.Vector2(baseWind.x, baseWind.y), strength: 1, gust: 1 });
    const mapleTex = own(TX.mapleAtlasTexture(env.seed % 1013));
    const barkT = TX.barkTextures(7);
    own(barkT.map); own(barkT.normalMap);
    const trees = [];
    const trng = rng.fork('trees');
    treeSpots.forEach((spot, i) => {
      const t = buildMaple(trng, { scale: spot.s });
      const bmat = addFog(new THREE.MeshStandardMaterial({ map: barkT.map, normalMap: barkT.normalMap, color: '#9a8a80', roughness: 0.9, envMapIntensity: 0.3 }), fogU, 'mfogBark');
      const lmat = mapleLeafMaterial({ map: mapleTex, wind, fogU, height: t.height });
      const grp = new THREE.Group();
      grp.position.set(spot.x, spot.y, spot.z);
      grp.rotation.y = trng.range(0, TAU);
      // the wind sways branches and leaves up to ~0.35 m: pad the culling bounds so the tree never pops at the frame edge
      for (const g of [t.branches, t.leaves]) { g.computeBoundingSphere(); g.boundingSphere.radius += 0.6; }
      const bm = new THREE.Mesh(t.branches, bmat); bm.castShadow = true; bm.receiveShadow = true;
      const lm = new THREE.Mesh(t.leaves, lmat); lm.castShadow = true; lm.receiveShadow = true;
      lm.customDepthMaterial = mapleLeafDepthMaterial({ map: mapleTex, wind, height: t.height });
      own(lm.customDepthMaterial);
      grp.add(bm, lm);
      // keep branches swaying with the leaves
      patchBranchesWind(bmat, wind, t.height);
      scene.add(grp);
      grp.updateMatrixWorld(true);
      trees.push({ x: spot.x, y: spot.y, z: spot.z, clusters: t.clusters.map(c => ({ p: c.p.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), grp.rotation.y) })), group: grp, height: t.height });
      void i;
    });
    function patchBranchesWind(mat, w, height) {
      addWind(mat, w, { height, amount: 0.16, stiffness: 1.7, flutter: 0, key: 'mapleBranchW' });
    }
    // distant groves (red / gold / evergreen) for depth, merged per palette
    {
      const frng = rng.fork('farTrees');
      const groups = { red: [], gold: [], green: [] };
      const nClusters = Math.round(10 * Math.max(q, 0.5));
      for (let c = 0; c < nClusters; c++) {
        const a = frng.range(-1.2, 1.2), d = frng.range(48, 190);
        const cx = Math.sin(a) * d, cz = -Math.cos(a) * d + 8;
        if (Math.abs(Math.atan2(cx - TARGET.x, -(cz - TARGET.z)) - sDir18) < 0.08 && d > 60) continue; // keep the sunset gap clear
        const kind = frng.chance(0.45) ? 'green' : frng.chance(0.6) ? 'red' : 'gold';
        const nT = frng.int(3, 7);
        const dir = frng.range(0, TAU);
        for (let i = 0; i < nT; i++) {
          const off = (i - nT / 2) * frng.range(3.5, 5.5);
          const x = cx + Math.cos(dir) * off + frng.range(-2.5, 2.5), z = cz + Math.sin(dir) * off + frng.range(-2.5, 2.5);
          const k = i === 0 ? kind : (frng.chance(0.7) ? kind : frng.pick(['red', 'gold', 'green']));
          groups[k].push({ x, z, s: frng.range(1.0, 1.6) * (d > 120 ? 1.25 : 1) });
        }
      }
      const groveBark = addFog(new THREE.MeshLambertMaterial({ color: '#3a3028' }), fogU, 'mfogGroveBark');
      for (const [k, spots] of Object.entries(groups)) {
        if (!spots.length) continue;
        const tex = k === 'red' ? mapleTex : own(TX.mapleAtlasTexture((env.seed % 977) + k.length, k));
        scene.add(buildGrove({ rng: frng, spots, heightAt, map: tex, barkMat: groveBark, fogU, density: 0.5 }));
      }
    }
    // fallen maple leaves on the ground beneath the trees
    const leafTex = own(TX.leafTexture());
    {
      const list = [];
      const frng = rng.fork('fallen');
      for (const t of trees) {
        const n = Math.round(260 * Math.max(q, 0.5));
        for (let i = 0; i < n; i++) {
          const a = frng.range(0, TAU), r = Math.sqrt(frng.next()) * 4.2;
          const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
          list.push({ x, z, y: heightAt(x, z) + 0.02, rot: frng.range(0, TAU) });
        }
      }
      for (let i = 0; i < 160 * Math.max(q, 0.5); i++) {
        const p = pathCurve.getPointAt(frng.range(0, 0.45));
        const x = p.x + frng.range(-1.1, 1.1), z = p.z + frng.range(-0.8, 0.8);
        list.push({ x, z, y: heightAt(x, z) + 0.02, rot: frng.range(0, TAU) });
      }
      const fgeo = new THREE.PlaneGeometry(0.12, 0.12); fgeo.rotateX(-Math.PI / 2);
      const fmat = addFog(new THREE.MeshLambertMaterial({ map: leafTex, alphaTest: 0.5, side: THREE.DoubleSide }), fogU, 'mfogFallen');
      const fallen = new THREE.InstancedMesh(fgeo, fmat, list.length);
      const m = new THREE.Matrix4(), qq = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), c = new THREE.Color();
      const cols = ['#9a1a16', '#b8301a', '#c8501c', '#7a2a18', '#a8681e', '#8a3a1c'];
      list.forEach((l, i) => {
        e.set(frng.range(-0.25, 0.25), l.rot, frng.range(-0.25, 0.25));
        qq.setFromEuler(e); s.setScalar(frng.range(0.8, 1.3));
        m.compose(new THREE.Vector3(l.x, l.y, l.z), qq, s);
        fallen.setMatrixAt(i, m);
        fallen.setColorAt(i, c.set(frng.pick(cols)).multiplyScalar(frng.range(0.7, 1.0)));
      });
      fallen.receiveShadow = true;
      fallen.frustumCulled = false;
      scene.add(fallen);
    }

    /* ================================================================ */
    /* Foxes                                                             */
    /* ================================================================ */
    const foxG = await env.loadGLTF('models/Fox.glb');
    let baseFoxMat = null, foxGeo = null;
    foxG.scene.traverse(o => { if (o.isMesh && !baseFoxMat) { baseFoxMat = o.material; foxGeo = o.geometry; } });
    // the glTF fox ships without normals (flat-shaded via derivatives) and as 576 facets: rebuilt as curved PN
    // patches with smooth normals (round outline and shading up close; same proportions, skinning and texture)
    foxGeo = own(pnSmoothSkinned(foxGeo, { level: 3 }));
    const foxMat = addFog(baseFoxMat.clone(), fogU, 'mfogFox');
    foxMat.flatShading = false;
    foxMat.envMapIntensity = 0.6;
    const whiteU = { uGlow: { value: 0 } };
    const whiteMat = baseFoxMat.clone();
    whiteMat.flatShading = false;
    whiteMat.envMapIntensity = 0.45;
    whiteMat.roughness = 0.75;
    patchMaterial(whiteMat, {
      key: 'whiteFox', uniforms: whiteU, fragmentHeader: 'uniform float uGlow;',
      fragment: {
        '#include <map_fragment>': `$&
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = vec3(1.0, 0.95, 0.86) * (0.16 + 0.86 * smoothstep(0.06, 0.62, lum));`,
        // the glow gathers toward the outline, a soft aura, and stays fainter where the body faces the viewer, so
        // the moonlit form still reads (an even glow lit every part alike and the fox looked flat)
        '#include <emissivemap_fragment>': `$&
          float foxRim = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
          totalEmissiveRadiance += vec3(0.62, 0.78, 1.0) * uGlow * (0.35 + 0.65 * diffuseColor.r) * (0.4 + 1.1 * foxRim * foxRim);`,
      },
    });
    addFog(whiteMat, fogU, 'mfogWFox');
    own(foxMat); own(whiteMat);
    const clip = n => foxG.animations.find(a => a.name === n) || foxG.animations[0];
    const statueMat = stoneMat;
    // stone kitsune guardians beside the shrine (static bind pose, red bibs)
    {
      const bibMat = addFog(new THREE.MeshStandardMaterial({ color: '#c0281c', roughness: 0.8, side: THREE.DoubleSide }), fogU, 'mfogBib');
      for (const s of [-1, 1]) {
        const st = SkeletonUtils.clone(foxG.scene);
        st.traverse(o => { if (o.isMesh) { o.geometry = foxGeo; o.material = statueMat; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
        const ped = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.62, 0.62), stoneMat);
        const px2 = SHRINE.x + s * 1.15, pz2 = SHRINE.z + 0.75;
        const py = heightAt(px2, pz2);
        ped.position.set(px2, py + 0.16, pz2);
        ped.castShadow = ped.receiveShadow = true;
        scene.add(ped);
        st.scale.setScalar(0.0048);
        const sdrop = applyFoxPose(findFoxBones(st), st, { sit: 1 }, 0);
        st.position.set(px2, py + 0.47 - sdrop * 0.0048, pz2 - 0.12);
        st.rotation.y = -s * 0.35;
        scene.add(st);
        const neck = st.getObjectByName('b_Neck_04');
        if (neck) {
          const bib = new THREE.Mesh(new THREE.ConeGeometry(9, 14, 3, 1, true), bibMat);
          bib.rotation.z = Math.PI / 2;
          bib.position.set(4, 2, 0);
          neck.add(bib);
        }
      }
    }

    // One hidden, never-animated clone per fox material: the shell compiles both skinned programs at world entry,
    // so the first white (or red) fox added later as a resident does not stall the frame on a shader compile.
    for (const m of [foxMat, whiteMat]) {
      const pre = SkeletonUtils.clone(foxG.scene);
      pre.traverse(o => { if (o.isMesh) { o.geometry = foxGeo; o.material = m; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      pre.scale.setScalar(FOX_SCALE);
      pre.position.set(0, -50, 0);
      pre.visible = false;
      pre.name = 'foxPrewarm';
      scene.add(pre);
    }

    const foxes = [];
    const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), zAxis = new THREE.Vector3(0, 0, 1);
    const foods = [];
    const frngGlobal = rng.fork('foxbrain');

    class Fox {
      constructor(member, spawnAtEdge = false) {
        this.member = member;
        this.white = member.kind === 'whiteFox';
        this.rng = rng.fork('fox:' + member.id);
        this.root = SkeletonUtils.clone(foxG.scene);
        this.root.traverse(o => { if (o.isMesh) { o.geometry = foxGeo; o.material = this.white ? whiteMat : foxMat; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
        this.obj = new THREE.Group();
        this.obj.add(this.root);
        scene.add(this.obj);
        this.mixer = new THREE.AnimationMixer(this.root);
        this.act = {};
        this.w = { Survey: 1, Walk: 0, Run: 0 };
        this.tgtW = { Survey: 1, Walk: 0, Run: 0 };
        this.restNight = false;
        for (const n of ['Survey', 'Walk', 'Run']) {
          const a = this.mixer.clipAction(clip(n));
          a.play(); a.setEffectiveWeight(this.w[n]); a.time = this.rng.range(0, a.getClip().duration);
          this.act[n] = a;
        }
        // Walk and Run are posed from one gait phase (set every frame, see update), so their own clocks stand still
        this.walkDur = this.act.Walk.getClip().duration;
        this.runDur = this.act.Run.getClip().duration;
        this.gait = this.act.Walk.time / this.walkDur;
        this.act.Walk.timeScale = this.act.Run.timeScale = 0;
        this.bones = findFoxBones(this.root);
        this.poseW = { eat: 0, rest: 0, sit: 0 };
        this.pos = new THREE.Vector3();
        this.goal = new THREE.Vector3();
        this.heading = this.rng.range(0, TAU);
        this.turnV = 0;            // angular velocity (rad/s): turns ease in and out instead of snapping
        this.pitch = 0;
        this.speed = 0;
        this.state = 'idle';
        this.timer = this.rng.range(0.5, 3);
        this.food = null;
        this.foodCool = 0;
        this.bestD = 1e9; this.stuckT = 0;
        this.detour = null; this.detourSide = 1;
        this.eatT = 0; this.bites = 0;
        this.labelPos = new THREE.Vector3();
        this.obj.name = this.white ? 'whiteFox' : 'fox';
        this.applyScale();
        if (spawnAtEdge) {
          // a new resident walks in from the field's rim, at a spot the camera cannot see (no popping into view)
          for (let k = 0; k < 16; k++) {
            const a = this.rng.range(-1.2, 1.2) * (k < 8 ? 1 : 1.8);
            this.pos.set(Math.sin(a) * 22, 0, -Math.cos(a) * 18 - 2);
            tmpV.set(this.pos.x, heightAt(this.pos.x, this.pos.z) + 0.4, this.pos.z).project(camera);
            if (Math.abs(tmpV.x) > 1.1 || tmpV.z > 1) break;
          }
          this.pickGoal(true);
          this.setState('walk', 30);
        } else {
          const t = this.rng.range(0.02, 0.28);
          pathPoint(t, this.pos);
          this.pos.x += this.rng.range(-0.6, 0.6);
        }
        this.pos.y = heightAt(this.pos.x, this.pos.z);
        this.wisps = [];
        if (this.white) {
          for (let i = 0; i < 3; i++) { const s = fx.glow('#9fdcff', 0.22, 1.3); s.visible = false; scene.add(s); this.wisps.push(s); }
        }
      }
      applyScale() {
        this.s = FOX_SCALE * Math.pow(this.member.size || 1, 0.65) * (this.white ? 1.06 : 1);
        this.root.scale.setScalar(this.s);
        this.walkSpeed = WALK_REF * this.s * 1.0;
        this.runSpeed = RUN_REF * this.s * 1.45;
      }
      hungry() { return env.fullness(this.member) < 0.3; }
      pickGoal(entering = false) {
        const r = this.rng;
        const night = world.night;
        if (night > 0.6 && !entering && r.chance(0.75)) {
          // rest near the shrine / torii
          const a = r.range(-1.2, 1.2);
          this.goal.set(SHRINE.x + Math.sin(a) * r.range(1.4, 2.4), 0, SHRINE.z + 1.6 + Math.cos(a) * r.range(0.6, 1.8));
          this.wantRest = true;
        } else if (this.hungry() && r.chance(0.7)) {
          pathPoint(r.range(0.14, 0.3), this.goal);
          this.goal.x += r.range(-0.8, 0.8);
          this.wantRest = false;
        } else {
          const k = r.next();
          if (k < 0.5) { pathPoint(r.range(0.0, 0.3), this.goal); this.goal.x += r.range(-0.7, 0.7); }
          else if (k < 0.78) { const a = r.range(0, TAU), d = r.range(1.6, 4.2); this.goal.set(Math.sin(a) * d, 0, 0.6 + Math.cos(a) * d); }
          else { this.goal.set(r.range(-9, 10), 0, r.range(-7, 8.5)); }
          this.wantRest = false;
        }
        // never a spot inside a rock, lantern or the shrine (the fox used to circle it until its walk timed out),
        // and not on top of another fox's spot (they would settle into each other)
        clearOfObstacles(this.goal, 0.6);
        for (const f2 of foxes) {
          if (f2 === this) continue;
          const dx = this.goal.x - f2.goal.x, dz = this.goal.z - f2.goal.z, d = Math.hypot(dx, dz);
          if (d < 0.9) { const k = d > 1e-3 ? 0.9 / d : 0; if (k) { this.goal.x = f2.goal.x + dx * k; this.goal.z = f2.goal.z + dz * k; } else this.goal.x += 0.9; }
        }
        clearOfObstacles(this.goal, 0.6);
        this.goal.y = heightAt(this.goal.x, this.goal.z);
      }
      setState(s, timer = 0) {
        this.state = s; this.timer = timer;
        if (s === 'toFood') { this.bestD = 1e9; this.stuckT = 0; }
      }
      /**
       * Heading toward `goal` (distance d) that walks around props instead of into them. The nearest prop blocking
       * the straight line is passed along its tangent, on the side chosen when it first blocked (no flip-flopping).
       * The old attraction + repulsion sum had dead spots behind rocks where a fox spun on the spot for 30 s.
       */
      steerHeading(goal, d) {
        const px = this.pos.x, pz = this.pos.z;
        const gx = (goal.x - px) / d, gz = (goal.z - pz) / d;
        let block = null, bt = 1e9;
        for (const o of obstacles) {
          const R = o.r + AVOID_CLEAR;
          const cx = o.x - px, cz = o.z - pz;
          const along = cx * gx + cz * gz;
          if (along < 0 || along > d + R * 0.5) continue;            // behind the fox / beyond the goal
          if (Math.abs(cx * gz - cz * gx) >= R) continue;             // the straight line misses it
          if (Math.hypot(goal.x - o.x, goal.z - o.z) < R) continue;   // goal right beside it: walk straight in
          if (along < bt) { bt = along; block = o; }
        }
        const toG = Math.atan2(gx, gz);
        if (!block) { this.detour = null; return toG; }
        const cx = block.x - px, cz = block.z - pz, cd = Math.hypot(cx, cz), R = block.r + AVOID_CLEAR;
        const toC = Math.atan2(cx, cz);
        if (this.detour !== block) { this.detour = block; this.detourSide = angleDelta(toC, toG) >= 0 ? 1 : -1; }
        return toC + this.detourSide * (cd > R ? Math.asin(R / cd) : Math.PI / 2);
      }
      update(dt, t) {
        const r = this.rng;
        const pw = this.poseW;
        this.timer -= dt;
        if (this.foodCool > 0) this.foodCool -= dt;
        // food has priority
        if (this.food && this.food.dead) { this.food = null; if (this.state === 'toFood' || this.state === 'notice') this.setState('idle', r.range(0.6, 1.4)); }
        let targetSpeed = 0, steer = false, lookAt = null, goalD = 1;
        switch (this.state) {
          case 'idle':
            if (this.timer <= 0) {
              if (!this.hungry() && r.chance(0.22)) { this.restNight = false; this.setState('rest', r.range(8, 20)); }
              else { this.pickGoal(); this.setState('walk', 30); }
            }
            break;
          case 'rest':
            if (this.timer <= 0 || (this.restNight && world.night < 0.4)) { this.pickGoal(); this.setState('walk', 30); }
            break;
          case 'walk': {
            steer = true;
            const d = goalD = Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z);
            // slow down into the goal instead of stopping dead on it
            targetSpeed = this.walkSpeed * (this.hungry() ? 1.15 : 1) * clamp(d / 1.1, 0.35, 1);
            if (d < 0.35 || this.timer <= 0) {
              if (this.wantRest) { this.restNight = true; this.setState('rest', r.range(25, 70)); }
              else this.setState('idle', r.range(2.5, 7) * (this.hungry() ? 1.6 : 1));
            }
            break;
          }
          case 'notice':
            lookAt = this.food.pos;
            if (this.timer <= 0) this.setState('toFood', 40);
            break;
          case 'toFood': {
            steer = true;
            const f = this.food;
            this.goal.copy(f.pos);
            const d = goalD = Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z);
            targetSpeed = d > 2.2 ? this.runSpeed : lerp(this.walkSpeed * 0.6, this.runSpeed, clamp((d - 0.6) / 1.6, 0, 1));
            // close by while the tofu is still falling: wait and watch it land rather than run past it
            if (!f.landed) targetSpeed *= smoothstep(0.55, 1.5, d);
            if (d < this.mouthDist() + 0.05 && f.landed) { this.setState('eat', 2.6); this.eatT = 0; this.bites = 0; break; }
            // no progress for 3 s (blocked): eat from here if it is within reach, otherwise leave it for a while
            if (d < this.bestD - 0.05) { this.bestD = d; this.stuckT = 0; } else this.stuckT += dt;
            if (this.stuckT > 3 && f.landed) {
              if (d < this.mouthDist() + 0.45) { this.setState('eat', 2.6); this.eatT = 0; this.bites = 0; }
              else { f.claimed = null; this.food = null; this.foodCool = 6; this.setState('idle', 1); }
            } else if (this.timer <= 0) { f.claimed = null; this.food = null; this.setState('idle', 1); }
            break;
          }
          case 'eat': {
            lookAt = this.food ? this.food.pos : null;
            this.eatT += dt;
            const f = this.food;
            if (f && !f.dead) {
              if (this.bites === 0 && this.eatT > 0.75) { this.bites = 1; f.bite(this, 1); }
              if (this.bites === 1 && this.eatT > 1.75) { this.bites = 2; f.bite(this, 2); }
            }
            if (this.eatT > 2.5) { this.food = null; this.setState('idle', r.range(1.0, 2.5)); }
            break;
          }
        }
        // steering
        let desired = this.heading;
        if (steer) {
          const h = this.steerHeading(this.goal, Math.max(goalD, 1e-3));
          let dx = Math.sin(h), dz = Math.cos(h);
          // too close to a prop: ease back out
          for (const o of obstacles) {
            const ox = this.pos.x - o.x, oz = this.pos.z - o.z, od = Math.hypot(ox, oz), rr = o.r + 0.35;
            if (od < rr && od > 1e-4) { const k = (rr - od) / 0.15; dx += (ox / od) * k; dz += (oz / od) * k; }
          }
          // keep apart from the others while walking, but let them crowd in at their own offering
          const sepW = this.state === 'toFood' ? clamp(goalD / 1.5, 0.2, 1) : 1;
          for (const f2 of foxes) {
            if (f2 === this) continue;
            const ox = this.pos.x - f2.pos.x, oz = this.pos.z - f2.pos.z, od = Math.hypot(ox, oz);
            if (od < 1.0 && od > 1e-3) { const k = (1.0 - od) * 1.5 * sepW; dx += (ox / od) * k; dz += (oz / od) * k; }
          }
          desired = Math.atan2(dx, dz);
        } else if (lookAt) {
          desired = Math.atan2(lookAt.x - this.pos.x, lookAt.z - this.pos.z);
        } else if (this.state === 'idle' && this.hungry()) {
          desired = Math.atan2(camera.position.x - this.pos.x, camera.position.z - this.pos.z);
        }
        // Turning has momentum and a top speed (rad/s): the angular velocity eases in and out, so the body never
        // snaps round or spins; a running fox turns in wider arcs, a seated one stands up before it turns.
        const err = angleDelta(this.heading, desired);
        const urgent = this.state === 'toFood' || this.state === 'notice';
        const runK = clamp((this.speed - this.walkSpeed) / Math.max(this.runSpeed - this.walkSpeed, 1e-3), 0, 1);
        const wMax = lerp(urgent ? 4.2 : 2.8, 2.3, runK) * clamp(1 - pw.sit * 1.6, 0.08, 1);
        this.turnV = damp(this.turnV, clamp(err * (urgent ? 5 : 2.6), -wMax, wMax), 9, dt);
        this.heading += this.turnV * dt;
        if (this.heading > Math.PI) this.heading -= TAU; else if (this.heading < -Math.PI) this.heading += TAU;
        if (steer) targetSpeed *= clamp(1.25 - Math.abs(err) / 1.3, 0.12, 1);
        // stand up fully before walking off (legs folded under a moving body read as sliding)
        targetSpeed *= clamp(1 - pw.sit * 2.5, 0, 1);
        this.speed = damp(this.speed, targetSpeed, targetSpeed > this.speed ? 2.6 : 5, dt);
        this.pos.x += Math.sin(this.heading) * this.speed * dt;
        this.pos.z += Math.cos(this.heading) * this.speed * dt;
        // bodies never interpenetrate: an overlapping pair eases apart (each fox takes its half)
        for (const f2 of foxes) {
          if (f2 === this) continue;
          const ox = this.pos.x - f2.pos.x, oz = this.pos.z - f2.pos.z, od = Math.hypot(ox, oz);
          if (od < 0.5 && od > 1e-4) { const k = (0.5 - od) * 0.5 * (1 - Math.exp(-6 * dt)); this.pos.x += ox / od * k; this.pos.z += oz / od * k; }
        }
        // hard collision with props
        for (const o of obstacles) {
          const ox = this.pos.x - o.x, oz = this.pos.z - o.z, od = Math.hypot(ox, oz), rr = o.r + 0.2;
          if (od < rr && od > 1e-4) { this.pos.x = o.x + ox / od * rr; this.pos.z = o.z + oz / od * rr; }
        }
        const hc = heightAt(this.pos.x, this.pos.z);
        this.pos.y = hc;
        const fx_ = Math.sin(this.heading) * 0.35, fz_ = Math.cos(this.heading) * 0.35;
        const pitch = Math.atan2(heightAt(this.pos.x - fx_, this.pos.z - fz_) - heightAt(this.pos.x + fx_, this.pos.z + fz_), 0.7);
        this.pitch = damp(this.pitch, pitch, 6, dt);
        this.obj.position.copy(this.pos);
        this.obj.rotation.set(0, 0, 0);
        this.obj.rotateY(this.heading);
        this.obj.rotateX(this.pitch);
        // ---- locomotion clips ----
        // The legs cover the ground speed plus the arc the paws sweep when the body turns, so turning on the spot
        // steps instead of sliding round. Below ~0.5 m/s the Walk is only partly blended in (short steps).
        const sp = this.speed;
        const fs = Math.hypot(sp, this.turnV * PAW_ARM * this.s);
        const G = WALK_GROUND * this.s;
        const xm = fs / (0.65 * G);
        const wMove = xm >= 1 ? 1 : xm * (2 - xm);
        const wRun = smoothstep(this.walkSpeed * 1.25, this.runSpeed * 0.75, sp);
        const tg = this.tgtW;
        tg.Survey = 1 - wMove; tg.Walk = wMove * (1 - wRun); tg.Run = wMove * wRun;
        for (const n of CLIPS) {
          this.w[n] = damp(this.w[n], tg[n], 10, dt);
          this.act[n].setEffectiveWeight(this.w[n]);
        }
        // One gait phase poses both Walk and Run (Run offset so the hind paws land together), advancing at the
        // rate that keeps the planted paws still: speed / (clip stride speed x its share of the blend). The old
        // per-clip timeScales (clamped to >= 0.5) skated the paws at low speed and blended out-of-step cycles.
        const mw = Math.max(this.w.Walk + this.w.Run, 0.15);
        const rs = this.w.Run / Math.max(this.w.Walk + this.w.Run, 1e-4);
        const tsW = Math.min(fs / (G * mw), 2.4), tsR = Math.min(fs / (RUN_GROUND * this.s * mw), 2.4);
        this.gait = (this.gait + ((1 - rs) * tsW / this.walkDur + rs * tsR / this.runDur) * dt) % 1;
        this.act.Walk.time = this.gait * this.walkDur;
        this.act.Run.time = ((this.gait + RUN_PHASE) % 1) * this.runDur;
        this.act.Survey.timeScale = damp(this.act.Survey.timeScale, this.state === 'eat' ? 0.25 : this.state === 'rest' ? 0.45 : 1, 3, dt);
        this.mixer.update(dt);
        pw.eat = damp(pw.eat, this.state === 'eat' ? 1 : 0, 6, dt);
        const sitT = this.state === 'rest' && this.speed < 0.05 ? 1 : 0;
        pw.sit = damp(pw.sit, sitT, sitT > pw.sit ? 2.2 : 4.5, dt);
        pw.rest = 0;
        const drop = applyFoxPose(this.bones, this.root, pw, t);
        this.root.position.y = -drop * this.s;
        // label + wisps
        this.labelPos.set(this.pos.x, this.pos.y + 0.55 * this.s / FOX_SCALE, this.pos.z);
        if (this.white) {
          const vis = world.night > 0.35 || world.dusk > 0.5;
          const a = smoothstep(0.35, 0.9, Math.max(world.night, world.dusk * 0.6));
          whiteU.uGlow.value = 0.5 * a;
          const kTrail = 1 - Math.exp(-5 * dt);
          for (let i = 0; i < this.wisps.length; i++) {
            const s = this.wisps[i];
            const ang = t * 0.7 + i * TAU / 3;
            tmpV2.set(this.pos.x + Math.cos(ang) * 0.75, this.pos.y + 0.75 + Math.sin(t * 1.3 + i * 2) * 0.15, this.pos.z + Math.sin(ang) * 0.75);
            // fox-fire drifts after the fox (a little lag when it runs) instead of being bolted to it
            if (vis && s.visible) s.position.lerp(tmpV2, kTrail); else s.position.copy(tmpV2);
            s.visible = vis;
            // a slow, breathing flicker (was 13 rad/s, which read as flashing)
            s.material.opacity = a * (0.55 + 0.28 * Math.sin(t * 2.9 + i * 3) + 0.17 * Math.sin(t * 6.1 + i));
            s.scale.setScalar(0.18 + 0.05 * Math.sin(t * 2.3 + i * 2));
          }
        }
      }
      mouthDist() { return 0.43 * this.s / FOX_SCALE; }
      dispose() {
        this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root);
        this.root.traverse(o => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose(); });
        scene.remove(this.obj);
        this.wisps.forEach(s => { scene.remove(s); s.material.dispose(); });
      }
    }

    /* ================================================================ */
    /* FX                                                                */
    /* ================================================================ */
    const fx = createFx({ env, scene, rng: rng.fork('fx'), heightAt, fogU, wind, leafTex, discTex, trees, quality: env.quality });
    // lantern glow sprites
    const lanternGlows = LANTERNS.map(l => { const s = fx.glow('#ffb468', 1.1, 1.0); s.position.set(l.x, l.y + 1.18, l.z); scene.add(s); return s; });
    // crepuscular rays: a big additive sprite along the sun direction, occluded by everything nearer
    const raysMat = new THREE.SpriteMaterial({ map: own(TX.sunRaysTexture(env.seed & 255)), color: '#ffffff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const rays = new THREE.Sprite(raysMat);
    rays.renderOrder = 4;
    scene.add(rays);
    const shrineGlow = fx.glow('#ffa050', 0.9, 1.0);
    shrineGlow.position.set(SHRINE.x, SHRINE.y + 0.95, SHRINE.z + 0.4);
    scene.add(shrineGlow);

    /* ================================================================ */
    /* Gentle giants (the spirit fox by night, the sika herd by day),    */
    /* light shafts and banks of ground mist                             */
    /* ================================================================ */
    const giants = new Giants({ env, scene, heightAt, fogU, seed: env.seed, obstacles, target: TARGET, shrine: SHRINE, knoll: KNOLL });
    const shafts = createShafts({ scene, fogU, trees, heightAt, rng: rng.fork('shafts'), q, target: TARGET });
    const mist = createMist({ scene, fogU, heightAt, rng: rng.fork('mist'), target: TARGET, noiseTex: giants.fox.tNoise });
    // Upload the giants' textures now, under the loading veil: they are first drawn mid-play, when a pass begins,
    // and an upload then (canvas read-back and mipmaps) would cost the iPad a frame.
    if (env.renderer && env.renderer.initTexture) for (const tx of [giants.fox.tNoise, giants.fox.tMark, giants.herd.tex]) env.renderer.initTexture(tx);
    const giantCtx = { night: 0, el: 30, pr: 1, pxK: 1000, wind: new THREE.Vector2(1, 0), rim: new THREE.Color(), sunDir: new THREE.Vector3(0, 1, 0), fill: new THREE.Color() };
    let giantSlot = -1;   // the grass-press slot the spirit fox holds while it parts the susuki
    // small life: sparrows on the path (perching in the two nearest maples), moths round the lit lanterns
    const perches = [];
    for (const tr of trees.slice(0, 2)) for (const c of tr.clusters) perches.push(new THREE.Vector3(tr.x + c.p.x, tr.y + c.p.y - 0.2, tr.z + c.p.z));
    const sparrows = createSparrows({ env, scene, fogU, heightAt, rng: rng.fork('sparrows'), pathPoint, perches });
    const moths = createMoths({ env, scene, rng: rng.fork('moths'), lanterns: LANTERNS });
    const threats = [], threatPool = Array.from({ length: 20 }, () => ({ x: 0, z: 0, r: 0 }));
    let threatN = 0;
    const threat = (x, z, r) => { if (threatN < threatPool.length) { const o = threatPool[threatN++]; o.x = x; o.z = z; o.r = r; threats.push(o); } };

    const world = { night: 0, dusk: 0, day: 1, golden: 0, el: 30, sunVis: 1, morning: false };
    for (const m of env.members) foxes.push(new Fox(m));

    /* ================================================================ */
    /* Cranes (ambient)                                                  */
    /* ================================================================ */
    const storkG = await env.loadGLTF('models/Stork.glb');
    const cranes = [];
    let craneMat = null;
    {
      let smat = null;
      storkG.scene.traverse(o => { if (o.isMesh) smat = o.material; });
      const cmat = addFog(smat.clone(), fogU, 'mfogCrane');
      cmat.color = new THREE.Color('#ffffff');
      cmat.emissive = new THREE.Color('#ffffff');
      cmat.emissiveIntensity = 0.0;
      // always blended (opacity 1 by day) so the flock can fade out at dusk without a material/program switch
      cmat.transparent = true;
      craneMat = cmat;
      own(cmat);
      const crng = rng.fork('cranes');
      const nC = 3 + (q > 0.6 ? 1 : 0);
      // Stork.glb nodes are unnamed, so its tracks bind by the original node's uuid; retarget a cloned
      // clip onto a named mesh so the mixer on each scene clone actually drives the flap morphs.
      const flapClip = storkG.animations[0].clone();
      flapClip.tracks.forEach(tr => { tr.name = 'craneBody' + tr.name.slice(tr.name.indexOf('.')); });
      const center = new THREE.Vector3(crng.range(-12, 8), crng.range(11, 14), crng.range(-62, -52));
      for (let i = 0; i < nC; i++) {
        const o = storkG.scene.clone();
        o.traverse(m => { if (m.isMesh) { m.name = 'craneBody'; m.material = cmat; m.castShadow = false; m.frustumCulled = false; } });
        o.scale.setScalar(0.0135);
        scene.add(o);
        o.name = 'crane' + i;
        const mixer = new THREE.AnimationMixer(o);
        const a = mixer.clipAction(flapClip);
        // the flap clock is driven by hand (see updateCranes), so the action's own clock stands still
        const t0 = crng.range(0, 1.2), rate = crng.range(0.75, 0.9);
        a.play(); a.time = t0; a.timeScale = 0;
        cranes.push({ o, mixer, act: a, off: new THREE.Vector3(-i * 3.2 * (i % 2 ? 1 : -1) * 0.5, crng.range(-1.5, 1.5), i * 3.5), phase: crng.range(0, 0.15), center, rx: crng.range(34, 44), rz: crng.range(14, 20), glide: crng.range(0, 6), prev: new THREE.Vector3(), ft: t0, rate, rs: rate, dur: flapClip.duration });
      }
    }
    // Stork flap keyframes with the wings spread level (0.7 s and the loop point 1.3 s = 0 s): a glide holds one
    const CRANE_SPREAD = 0.7;

    /* ================================================================ */
    /* Food                                                              */
    /* ================================================================ */
    const tofuMaps = TX.tofuTextures(5);
    own(tofuMaps.map); own(tofuMaps.bumpMap);
    const tofuF = makeTofuFactory({ maps: tofuMaps, fogU });
    own(tofuF.geo);
    // Tofu meshes are built up front, hidden, and reused: the shell compiles every material in the scene graph at
    // world entry, so the first offering no longer compiles its shader mid-play (a 100+ ms stall on WebGL 1 Safari).
    const tofuPool = [], fadingFoods = [];
    for (let i = 0; i < 6; i++) { const m = tofuF.make(); m.visible = false; m.name = 'tofu'; scene.add(m); tofuPool.push(m); }
    class Food {
      constructor(pos) {
        this.pos = pos.clone();
        this.mesh = tofuPool.pop() || tofuF.make();
        this.mesh.visible = true;
        this.mesh.scale.setScalar(1);
        this.mesh.position.set(pos.x, pos.y + 2.2, pos.z);
        this.mesh.rotation.set(0.3, Math.random() * TAU, 0.2);
        this.vy = 0;
        this.landed = false;
        this.dead = false;
        this.claimed = null;
        this.scale = 1;
        this.age = 0;
        this.glowK = 0; this.fadeT = 0;
        this.slot = -1;   // grass-press slot (see updateWind)
        this.glow = fx.glow('#ffd49a', 1.1, 0.9);
        this.glow.material.depthTest = false;
        this.glow.renderOrder = 9;
        this.glow.position.copy(pos).y += 0.25;
        if (!this.mesh.parent) scene.add(this.mesh);
        scene.add(this.glow);
      }
      bite(fox, n) {
        this.scale = n === 1 ? 0.55 : 0;
        tmpV.copy(this.pos).y += 0.08;
        fx.puff(tmpV, 16, true);
        if (n === 2) sparrows.onCrumbs(this.pos);
        env.onEat(fox ? fox.member : null, tmpV);
        if (n === 2) this.kill(true);
      }
      /** soft: the last morsel shrinks away and its glow fades for a moment (it used to vanish in one frame). */
      kill(soft = false) {
        if (this.dead) return;
        this.dead = true;
        this.scale = 0;
        if (soft) { this.fadeT = 0; fadingFoods.push(this); } else this.release();
      }
      release() {
        this.mesh.visible = false; tofuPool.push(this.mesh);
        scene.remove(this.glow); this.glow.material.dispose();
      }
      /** after kill(true): returns true once released */
      fade(dt) {
        this.fadeT += dt;
        this.mesh.scale.setScalar(Math.max(damp(this.mesh.scale.x, 0, 10, dt), 0.001));
        this.glowK = damp(this.glowK, 0, 8, dt);
        this.glow.material.opacity = 0.5 * this.glowK;
        if (this.fadeT < 0.5) return false;
        this.release();
        return true;
      }
      update(dt, t) {
        this.age += dt;
        if (!this.landed) {
          // exact constant-gravity step: the drop and its bounces play out the same at 30 and 60 fps
          const vy0 = this.vy;
          this.vy -= 9.8 * dt;
          this.mesh.position.y += (vy0 + this.vy) * 0.5 * dt;
          this.mesh.rotation.x = damp(this.mesh.rotation.x, 0, 3, dt);
          this.mesh.rotation.z = damp(this.mesh.rotation.z, 0, 3, dt);
          if (this.mesh.position.y <= this.pos.y + 0.06) {
            this.mesh.position.y = this.pos.y + 0.06;
            if (Math.abs(this.vy) > 1.2) { this.vy = -this.vy * 0.28; env.sfx('tok'); } else { this.vy = 0; this.landed = true; this.mesh.rotation.x = this.mesh.rotation.z = 0; }
          }
        }
        const s = damp(this.mesh.scale.x, this.scale, 10, dt);
        this.mesh.scale.setScalar(Math.max(s, 0.001));
        // glow strength eases between falling / landed / being eaten (and in at spawn) instead of stepping
        const gk = (this.landed ? 1 : 0.6) * (this.claimed && this.claimed.state === 'eat' ? 0.35 : 1);
        this.glowK = damp(this.glowK, gk, 5, dt);
        this.glow.material.opacity = (0.5 + 0.18 * Math.sin(t * 3)) * this.glowK;
        this.glow.position.set(this.pos.x, this.pos.y + 0.22 + Math.sin(t * 2) * 0.03, this.pos.z);
        if (this.age > 90 && !this.claimed) this.kill(true);
      }
    }
    const guide = { w: 0, t: 99, dir: new THREE.Vector2(), pos: new THREE.Vector3() };
    let lastChime = -99;
    function rayGround(ray, out) {
      let t0 = 0, t = 0.5;
      const p = tmpV2;
      for (let i = 0; i < 240; i++) {
        p.copy(ray.direction).multiplyScalar(t).add(ray.origin);
        if (p.y < heightAt(p.x, p.z)) {
          let a = t0, b = t;
          for (let k = 0; k < 24; k++) { const m = (a + b) / 2; p.copy(ray.direction).multiplyScalar(m).add(ray.origin); if (p.y < heightAt(p.x, p.z)) b = m; else a = m; }
          out.copy(ray.direction).multiplyScalar(b).add(ray.origin);
          out.y = heightAt(out.x, out.z);
          return out;
        }
        t0 = t;
        t = t * 1.035 + 0.12;
        if (t > 200) break;
      }
      return null;
    }
    function spawnFood(p) {
      // an offering that would land inside a rock, lantern or the shrine is set down just beside it, where it can
      // be seen and a fox can reach it (no tofu hidden in stone, no fox circling it)
      clearOfObstacles(p, 0.5);
      p.y = heightAt(p.x, p.z);
      const f = new Food(p);
      foods.push(f);
      env.sfx('drop');
      if (lastT - lastChime > 2.5) { lastChime = lastT; setTimeout(() => env.sfx('chime'), 180); }
      // Guiding Wind: the field turns toward the offering, a stream of leaves and fluff follows
      guide.t = 0;
      guide.pos.copy(p);
      guide.dir.set(p.x - camera.position.x, p.z - camera.position.z).normalize();
      fx.stream(camera, p);
      // the sika herd startles at an offering landing near it; sparrows beside it flush
      giants.onFood(p);
      sparrows.onDrop(p);
      // the nearest free fox notices
      assignFoxes();
      return f;
    }
    function assignFoxes() {
      for (const f of foods) {
        if (f.dead || f.claimed) continue;
        let best = null, bd = 1e9;
        for (const fox of foxes) {
          if (fox.food || fox.foodCool > 0) continue;
          const d = fox.pos.distanceTo(f.pos) - (fox.hungry() ? 4 : 0);
          if (d < bd) { bd = d; best = fox; }
        }
        if (best) {
          f.claimed = best; best.food = f;
          best.setState('notice', best.rng.range(0.25, 0.7));
        }
      }
    }

    /* ================================================================ */
    /* Per-frame state                                                   */
    /* ================================================================ */
    const pal = {};
    const WHITE = new THREE.Color(1, 1, 1), MOONRAY = new THREE.Color('#8fa8e0'), MOONLIGHT = new THREE.Color('#9db4ff');
    const lightCol = new THREE.Color();
    const sunDirV = new THREE.Vector3(), lightDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
    const windDir = new THREE.Vector2().copy(baseWind);
    let windSpeed = 2.4;
    const post = {
      bloom: { strength: 0.45, radius: 0.7, threshold: 0.9 },
      exposure: 0.9, toneMapping: 'aces',
      vignette: 0.4, grain: 0.035, saturation: 1.06, contrast: 1.05,
      lift: [0.0, 0.0, 0.0], gain: [1, 1, 1], ca: 0,
      tilt: { amount: 0, center: 0.5, width: 0.2 },
    };
    const view = {
      target: TARGET.clone(),
      dist: 16, distRange: [8, 26],
      yaw: 0.05, yawRange: [-0.8, 0.8],
      pitch: 0.07, pitchRange: [0.02, 0.55],
      drift: 0.03,
      idlePitch: 0.065, idleDist: 16.5,
      fov: 38,
    };
    {
      let maxH = -1e9;
      for (let k = 0; k <= 16; k++) for (const d of [8, 16, 26]) { const yaw = -0.8 + 1.6 * k / 16; maxH = Math.max(maxH, heightAt(TARGET.x + d * Math.sin(yaw), TARGET.z + d * Math.cos(yaw))); }
      view.minY = maxH + 1.4;
    }
    const prVec = new THREE.Vector2();
    const fxCtx = { camera, target: view.target, windDir, windSpeed: 0, light: lightCol, day: 1, night: 0, golden: 0, sunDir: sunDirV, pr: 1 };

    // env.hours() runs continuously; this short ease also turns any small jump of the clock into a glide, so sun
    // and moon light, shadows, sky, fog, exposure and bloom never change in a single frame (around sunset one
    // minute is 5-10 % of the sunlight). Big jumps (manual time change, waking from sleep) still cut at once.
    let hS = null;
    function easedHours(dt) {
      const h = env.hours();
      if (hS === null) { hS = h; return hS; }
      let d = h - hS;
      if (d > 12) d -= 24; else if (d < -12) d += 24;
      if (Math.abs(d) > 0.25) hS = h;
      else hS = (((hS + d * (1 - Math.exp(-1.6 * dt))) % 24) + 24) % 24;
      return hS;
    }
    // The fields of util's sunState() this world reads, computed in place: the clock runs continuously, so the sun
    // is re-evaluated every ~0.1 s of it, and sunState() allocates vectors and parses colours on every call (GC on
    // the iPad).
    const sunS = { dir: new THREE.Vector3(0, 1, 0), elevationDeg: 0, day: 1, night: 0, golden: 0 };
    const LAT = THREE.MathUtils.degToRad(25);
    function sunLite(hours) {
      const H = THREE.MathUtils.degToRad((hours - 12) * 15);
      const elevation = Math.asin(clamp(Math.cos(LAT) * Math.cos(H), -1, 1));
      const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(LAT)) + sunOpts.azimuthOffset;
      const ce = Math.cos(elevation);
      sunS.dir.set(-Math.sin(az) * ce, Math.sin(elevation), Math.cos(az) * ce).normalize();
      const e = THREE.MathUtils.radToDeg(elevation);
      sunS.elevationDeg = e;
      sunS.day = smoothstep(-4, 6, e);
      sunS.night = 1 - smoothstep(-10, -2, e);
      sunS.golden = smoothstep(-3, 2, e) * (1 - smoothstep(6, 20, e));
      return sunS;
    }
    let sunCache = null, sunCacheH = -1;
    function updateTimeOfDay(dt, t) {
      const hours = easedHours(dt);
      if (!sunCache || Math.abs(hours - sunCacheH) > 1 / 36000) { sunCache = sunLite(hours); sunCacheH = hours; }
      const s = sunCache;
      const el = s.elevationDeg;
      const morning = hours < 12;
      samplePalette(el, morning, pal);
      sunDirV.copy(s.dir);
      // artistic moon: rises on the left in the evening, crosses in front, sets on the right before dawn
      const np = (((hours - 18) % 24) + 24) % 24 / 12;
      moonDir.set(-0.95 + 1.7 * clamp(np, 0, 1), 0.1 + 0.2 * Math.sin(Math.PI * clamp(np, 0, 1)), -1).normalize();
      const night = s.night, day = s.day;
      world.night = night; world.day = day; world.golden = s.golden; world.el = el; world.morning = morning;
      world.dusk = smoothstep(-9, -1, el) * (1 - smoothstep(0, 4, el));
      // horizon occlusion of the sun by the ridges
      const az = Math.atan2(sunDirV.x, -sunDirV.z);
      const ridge = THREE.MathUtils.radToDeg(mountains.userData.horizonAt(az));
      const sunVis = smoothstep(ridge - 0.5, ridge + 0.6, el);
      world.sunVis = sunVis;
      // light: sun by day, moon by night
      if (el > -5) {
        lightDir.copy(sunDirV);
        if (lightDir.y < 0.035) lightDir.y = 0.035;
        lightCol.copy(pal.sun);
        sunLight.intensity = pal.sunI * lerp(0.35, 1, sunVis);
      } else {
        lightDir.copy(moonDir);
        lightCol.copy(MOONLIGHT);
        sunLight.intensity = 0.55 * smoothstep(-5, -12, el);
      }
      lightDir.normalize();
      sunLight.color.copy(lightCol);
      sunLight.position.copy(TARGET).addScaledVector(lightDir, 90);
      sunLight.target.position.copy(TARGET);
      hemi.color.copy(pal.hemiS); hemi.groundColor.copy(pal.hemiG); hemi.intensity = pal.hemiI;
      // fog + sky. The forward-scatter glow follows the sun, then the moon: it fades out around the hand-over
      // (el = -8) so the glow never jumps across the sky in one frame.
      fogU.uFogColor.value.copy(pal.hor);
      fogU.uFogSunColor.value.copy(pal.hor).lerp(pal.glow, smoothstep(0, 2.5, Math.abs(el + 8)));
      fogU.uFogMistColor.value.copy(pal.mistC);
      fogU.uFogSunDir.value.copy(el > -8 ? sunDirV : moonDir);
      fogU.uFogHaze.value = pal.haze;
      fogU.uFogMist.value = pal.mist;
      fogU.uCloudShadow.value = 0.5 * smoothstep(4, 20, el) * (0.7 + 0.3 * Math.sin(t * 0.017));
      fogU.uCloudShadowOff.value.x = (fogU.uCloudShadowOff.value.x - baseWind.x * dt * 0.022) % 128;
      fogU.uCloudShadowOff.value.y = (fogU.uCloudShadowOff.value.y - baseWind.y * dt * 0.022) % 128;
      const su = skyMat.uniforms;
      su.uZenith.value.copy(pal.zen);
      su.uSunDir.value.copy(sunDirV);
      su.uSunHalo.value.copy(pal.halo).multiplyScalar(smoothstep(-10, 0, el) * (0.55 + 0.45 * sunVis));
      su.uSunDisk.value.copy(pal.halo).lerp(WHITE, 0.25 + 0.5 * smoothstep(5, 30, el)).multiplyScalar(32 * smoothstep(-1.0, 0.6, el) * sunVis);
      su.uMoonDir.value.copy(moonDir);
      su.uMoonAmt.value = smoothstep(-5, -13, el);
      su.uStars.value = smoothstep(-7, -16, el);
      su.uCloudLit.value.copy(pal.cl);
      su.uCloudDark.value.copy(pal.cd);
      su.uTime.value = t % SKY_PERIOD;
      // cloud drift (0.004 /s along the wind) and warp (0.003 /s) on one slow sine of 22 days' period: their speed
      // stays within 1% over the first 12 h and 4% over a day, and the offsets stay bounded (unbounded, a page left
      // on for weeks fed float32 offsets so large that the fine cloud detail crept in steps)
      const cs = Math.sin(t / CLOUD_TAU) * CLOUD_TAU;
      su.uCloudWarp.value = cs * 0.003;
      su.uCloudOff.value.set(baseWind.x, baseWind.y).multiplyScalar(cs * 0.004);
      su.uCloudCover.value = 0.57 + 0.06 * Math.sin(t * 0.01 + env.seed % 10) + (morning ? 0.04 * smoothstep(-6, 10, el) * (1 - smoothstep(10, 25, el)) : 0);
      // god rays toward the low sun (or the moon, faintly)
      {
        const lowSun = smoothstep(-2.5, 1.5, el) * (1 - smoothstep(14, 32, el)) * (0.35 + 0.65 * sunVis);
        const moonRays = smoothstep(-8, -16, el) * 0.18;
        const a = Math.max(lowSun * (morning ? 0.65 : 1.0), moonRays);
        rays.visible = a > 0.01;
        const dirR = lowSun >= moonRays ? sunDirV : moonDir;
        rays.position.copy(camera.position).addScaledVector(dirR, 140);
        rays.scale.setScalar(260);
        raysMat.rotation = (t * 0.004) % TAU;
        raysMat.color.copy(lowSun >= moonRays ? pal.halo : MOONRAY).multiplyScalar(a * 0.55);
      }
      // lanterns / shrine glow
      const lampOn = smoothstep(-1, -7, el);
      world.lampOn = lampOn;
      for (let i = 0; i < lanternLights.length; i++) { const l = lanternLights[i]; l.intensity = 9 * lampOn * (0.92 + 0.08 * Math.sin(t * 9.0 + l.position.x)); }
      windowMat.emissiveIntensity = 3.2 * lampOn;
      for (let i = 0; i < lanternGlows.length; i++) { const g = lanternGlows[i]; g.material.opacity = lampOn * (0.85 + 0.15 * Math.sin(t * 7 + i)); g.visible = lampOn > 0.01; }
      shrineGlow.material.opacity = lampOn * 0.6; shrineGlow.visible = lampOn > 0.01;
      hokora.userData.doorMat.emissiveIntensity = lampOn * 0.6;
      // grass tuning per time of day
      colors.uGustBright.value = lerp(0.2, 0.55, day);
      plumeMat.userData.U.uTransl.value = lerp(0.5, 0.2, night);
      // post
      post.exposure = pal.exp;
      post.bloom.strength = 0.32 + 0.2 * s.golden + 0.25 * night;
      post.bloom.threshold = lerp(1.0, 0.65, night);
      post.bloom.radius = 0.72;
      post.saturation = lerp(1.06, 0.92, night) + 0.06 * s.golden;
      post.contrast = 1.06;
      post.lift[0] = lerp(0.012, 0.0, night); post.lift[1] = lerp(0.006, 0.012, night); post.lift[2] = lerp(0.0, 0.03, night);
      post.gain[0] = lerp(1.03 + 0.03 * s.golden, 0.94, night); post.gain[1] = lerp(1.0, 1.0, night); post.gain[2] = lerp(0.95 - 0.04 * s.golden, 1.06, night);
      // environment map: re-render the sky into PMREM every 2 minutes (the new map is complete before it is
      // swapped in). In between, the IBL strength of the standard materials follows the sky's brightness, so a
      // rebuild at dusk never shows as a step on the torii, the stones or the foxes.
      const skyL = 0.4 * lumOf(pal.hor) + 0.3 * lumOf(pal.zen) + 0.15 * lumOf(pal.cl) + 0.15 * lumOf(fogU.uFogSunColor.value);
      const key = Math.round(hours * 30);
      if (key !== envKey) {
        envKey = key;
        const tex = envMap.update();
        if (scene.environment !== tex) scene.environment = tex;
        envRefL = skyL;
      }
      if (!envMats) {
        envMats = [];
        const seen = new Set();
        const addM = m => { if (m && m.isMeshStandardMaterial && !seen.has(m)) { seen.add(m); envMats.push({ m, base: m.envMapIntensity }); } };
        scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(addM); });
        [foxMat, whiteMat, tofuF.mat, craneMat].forEach(addM);
      }
      const envK = clamp(skyL / Math.max(envRefL, 1e-5), 0.6, 1.6);
      for (const e of envMats) e.m.envMapIntensity = e.base * envK;
      return { el, sunVis };
    }

    function updateWind(dt, t) {
      // guiding wind toward the latest offering
      guide.t += dt;
      const gw = guide.t < 0.35 ? smoothstep(0, 0.35, guide.t) : 1 - smoothstep(3.5, 6.5, guide.t);
      guide.w = gw;
      const tx = lerp(baseWind.x, guide.dir.x, gw), tz = lerp(baseWind.y, guide.dir.y, gw);
      const l = Math.hypot(tx, tz) || 1;
      windDir.x = damp(windDir.x, tx / l, 3, dt);
      windDir.y = damp(windDir.y, tz / l, 3, dt);
      windDir.normalize();
      const gustiness = 0.85 + 0.25 * Math.sin(t * 0.13) + 0.15 * Math.sin(t * 0.37 + 1.3);
      const str = gustiness * (1 + 0.65 * gw);
      windU.uWindStr.value = damp(windU.uWindStr.value, str, 2, dt);
      windU.uWindDir.value.copy(windDir);
      // gust fronts roll across the field at ~4.7 m/s (was 7): big, slow waves rather than fast whipping
      const sp = 0.21 * (1 + 0.9 * gw);
      const sc = windU.uWindScroll.value;
      sc.x = (sc.x + windDir.x * sp * dt) % 256;
      sc.y = (sc.y + windDir.y * sp * dt) % 256;
      // sway / flutter phases advance here and wrap at 2π: smooth however long the page stays open
      const ph = windU.uWindPh.value;
      ph.x = (ph.x + SWAY_RATE * dt) % TAU;
      ph.y = (ph.y + FLUTTER_RATE * dt) % TAU;
      windSpeed = 2.2 * str;
      wind.update(dt);
      // the tree wind's rates (1.7, 3.1, 8, 9 rad/s) all complete whole cycles in 20π s, so its clock wraps seamlessly
      wind.uniforms.uWindTime.value %= 20 * Math.PI;
      // press grass around food so the offering stays visible. Each offering keeps its own slot: the slots used to
      // be re-dealt by recency every frame, so when one was eaten every press shifted and the grass where it lay
      // sprang upright in a single frame (and a new one flattened its grass at once, before the tofu had landed).
      // A slot only moves to a new offering once its grass has eased back up.
      const press = windU.uPress.value;
      for (let i = 0; i < 4; i++) pressHeld[i] = false;
      for (const f of foods) if (!f.dead && f.slot >= 0) pressHeld[f.slot] = true;
      // The spirit fox parts the susuki as it walks. It takes a slot only when one is free and that slot's grass has
      // eased back up (like an offering), follows the fox with it, and lets it go once its grass is upright again.
      const fw = giants.kind === 'fox' ? giants.fox.pressW : 0;
      if (giantSlot < 0 && fw > 0.01) for (let i = 3; i >= 0; i--) if (!pressHeld[i] && press[i].w <= 0.02) { giantSlot = i; break; }
      if (giantSlot >= 0) pressHeld[giantSlot] = true;
      for (const f of foods) {
        if (f.dead || f.slot >= 0) continue;
        for (let i = 0; i < 4; i++) {
          if (pressHeld[i] || press[i].w > 0.02) continue;
          f.slot = i; pressHeld[i] = true; press[i].set(f.pos.x, f.pos.y, f.pos.z, press[i].w);
          break;
        }
      }
      for (let i = 0; i < 4; i++) if (i !== giantSlot) press[i].w = pressHeld[i] ? damp(press[i].w, 0.9, 3, dt) : damp(press[i].w, 0, 2, dt);
      if (giantSlot >= 0) {
        const gs = press[giantSlot], gp = giants.fox.pressPos;
        if (fw > 0.01) gs.set(gp.x, gp.y, gp.z, gs.w);
        gs.w = damp(gs.w, fw, 3, dt);
        if (fw <= 0.01 && gs.w < 0.02) giantSlot = -1;
      }
    }
    const pressHeld = [false, false, false, false];

    function updateCranes(dt, t) {
      // fade the flock over dusk / dawn instead of popping it in or out
      const fade = smoothstep(0.1, 0.45, world.day);
      const vis = fade > 0.003;
      if (craneMat) { craneMat.emissiveIntensity = 0.22 * world.day * (1 - world.golden); craneMat.opacity = fade; }
      for (const c of cranes) {
        c.o.visible = vis;
        if (!vis) continue;
        const a = t * 0.045 + c.phase;
        const sa = Math.sin(a), ca = Math.cos(a);
        c.o.position.set(c.center.x + ca * c.rx + c.off.x, c.center.y + Math.sin(a * 2) * 3 + c.off.y, c.center.z + sa * c.rz + c.off.z);
        // heading, pitch and bank from the path's analytic derivatives (no stale previous position after being
        // hidden). The loop always turns right, so the bank leans right everywhere, most where the turn is tightest
        // (it used to follow -cos(a) and leaned out of the turn on half of the loop); pitch follows the climb.
        const vx = -sa * c.rx, vz = ca * c.rz, vh2 = vx * vx + vz * vz;
        const bank = 0.25 * (c.rx * c.rz / vh2) / (c.rx / c.rz);
        c.o.rotation.set(-Math.atan2(6 * Math.cos(2 * a), Math.sqrt(vh2)), Math.atan2(vx, vz), bank, 'YXZ');
        // flap / glide. A glide finishes the stroke into the next spread-wing keyframe and holds it (the old
        // timeScale 0.08 froze the wings wherever they were, often raised in a V); flapping then resumes gently,
        // each crane at its own rate (they all used to converge on the same one).
        c.glide -= dt;
        if (c.glide < -5) c.glide = 4 + Math.random() * 3;
        let rate = c.rate, stop = Infinity;
        if (c.glide > 0) {
          stop = c.ft <= CRANE_SPREAD + 1e-4 ? CRANE_SPREAD : c.dur;
          rate = c.rate * clamp((stop - c.ft) / 0.25, 0, 1);
        }
        c.rs = damp(c.rs, rate, c.glide > 0 ? 10 : 2.5, dt);
        c.ft = Math.min(c.ft + c.rs * dt, stop);
        if (c.ft > c.dur) c.ft -= c.dur;
        c.act.time = c.ft;
        c.mixer.update(dt);
      }
    }

    // Layered light for each hour. Shafts: the low sun through the maples and over the field (strongest at the
    // evening's golden hour, looking into the light), the moon's faint silver ones at night. Mist: thick banks at
    // dawn, a light veil at dusk, a moonlit haze at night, none by day.
    const shaftL = new THREE.Vector3(), shaftCol = new THREE.Color(), mistCol = new THREE.Color(), mistGlow = new THREE.Color(), glowDir = new THREE.Vector3();
    function updateLight(dt) {
      const el = world.el, morning = world.morning;
      const dawn = morning ? smoothstep(-9, -3, el) * (1 - smoothstep(5, 13, el)) : 0;
      const dusk = morning ? 0 : smoothstep(6, 0, el) * (1 - smoothstep(-4, -9, el));
      const sunK = smoothstep(-1.5, 2.5, el) * (1 - smoothstep(14, 28, el)) * (0.35 + 0.65 * world.sunVis) * (morning ? 0.5 + 0.5 * dawn : 1);
      const moonK = smoothstep(-6, -14, el) * 0.3;
      let k;
      if (sunK >= moonK) { shaftL.copy(sunDirV).negate(); shaftCol.copy(pal.halo).lerp(pal.sun, 0.35); k = sunK * 1.25; }
      else { shaftL.copy(moonDir).negate(); shaftCol.copy(MOONRAY); k = moonK * 0.9; }
      if (shaftL.y > -0.07) { shaftL.y = -0.07; shaftL.normalize(); }
      shafts.update(dt, shaftL, shaftCol, k);
      const amount = Math.max(dawn * 0.75, dusk * 0.3, world.night * 0.34);
      if (world.night > 0.5) {
        mistCol.copy(pal.mistC).multiplyScalar(2.4);
        mistGlow.copy(MOONRAY).multiplyScalar(0.3);
        glowDir.copy(moonDir);
      } else {
        mistCol.copy(pal.mistC).multiplyScalar(morning ? 0.95 : 0.8);
        mistGlow.copy(pal.glow).multiplyScalar(0.35 * (0.3 + 0.7 * world.sunVis));
        glowDir.copy(sunDirV);
      }
      mist.update(dt, amount, mistCol, mistGlow, glowDir, windDir, camera.position.distanceTo(view.target), Math.max(dawn, dusk * 0.7) / Math.max(amount, 1e-3) * 0.75);
    }

    let lastT = 0;
    const inst = {
      scene, camera, view, post,
      update(dt, t) {
        lastT = t;
        const tod = updateTimeOfDay(dt, t);
        updateWind(dt, t);
        let unclaimed = false;
        for (let i = foods.length - 1; i >= 0; i--) {
          const f = foods[i];
          if (!f.dead) f.update(dt, t);
          if (f.dead) foods.splice(i, 1); else if (!f.claimed) unclaimed = true;
        }
        if (unclaimed) assignFoxes();
        for (let i = fadingFoods.length - 1; i >= 0; i--) if (fadingFoods[i].fade(dt)) fadingFoods.splice(i, 1);
        for (const f of foxes) f.update(dt, t);
        updateCranes(dt, t);
        fx.updateBirds(dt, t, world.day * (1 - world.night));
        // frame the action: drift the look-at point toward live offerings, then settle back
        {
          let fx_ = 0, fz_ = 0, n = 0;
          for (const f of foods) if (!f.dead) { fx_ += f.pos.x; fz_ += f.pos.z; n++; }
          const k = n ? 0.32 : 0;
          const tx = n ? TARGET.x + clamp((fx_ / n - TARGET.x) * k, -4, 4) : TARGET.x;
          const tz = n ? TARGET.z + clamp((fz_ / n - TARGET.z) * k, -4, 3) : TARGET.z;
          view.target.x = damp(view.target.x, tx, 1.2, dt);
          view.target.z = damp(view.target.z, tz, 1.2, dt);
        }
        sky.position.copy(camera.position);
        env.renderer.getDrawingBufferSize(prVec);
        windU.uHalfRes.value.set(prVec.x * 0.5, prVec.y * 0.5);
        fxCtx.windSpeed = windSpeed; fxCtx.day = world.day; fxCtx.night = world.night; fxCtx.golden = world.golden;
        fxCtx.pr = prVec.y / 720 + 0.0001;
        fx.update(dt, t, fxCtx);
        // gentle giants, and the light the spirit fox throws on the grass round it
        giantCtx.night = world.night; giantCtx.el = world.el; giantCtx.pr = fxCtx.pr;
        giantCtx.pxK = prVec.y / (2 * Math.tan(camera.fov * Math.PI / 360));
        giantCtx.wind.copy(windDir);
        giantCtx.rim.copy(lightCol).multiplyScalar(world.day * (0.55 + 0.6 * world.golden) * (0.4 + 0.6 * world.sunVis));
        giantCtx.sunDir.copy(lightDir);
        giantCtx.fill.copy(hemi.color).multiplyScalar(hemi.intensity * 0.45);
        giants.update(dt, t, giantCtx);
        const sp = windU.uSpirit.value;
        if (giants.kind === 'fox') sp.set(giants.fox.glowPos.x, giants.fox.glowPos.y, giants.fox.glowPos.z, 0.5 * giants.fox.glow);
        else sp.w = 0;
        updateLight(dt);
        // sparrows keep clear of foxes (more so of a running one), of the spirit fox and of the deer
        threats.length = 0; threatN = 0;
        for (const f of foxes) threat(f.pos.x, f.pos.z, f.speed > f.walkSpeed * 1.3 ? 2.4 : 1.3);
        if (giants.kind === 'fox') threat(giants.fox.anchor.position.x, giants.fox.anchor.position.z, 5);
        if (giants.kind === 'deer') for (const d of giants.herd.deer) threat(d.pos.x, d.pos.z, 3);
        sparrows.update(dt, t, { day: world.day, threats });
        moths.update(dt, world.lampOn || 0, fxCtx.pr);
        void tod;
      },
      feed(raycaster) {
        const hit = rayGround(raycaster.ray, new THREE.Vector3());
        if (!hit) return null;
        if (Math.hypot(hit.x - TARGET.x, hit.z - TARGET.z) > 24) return null;
        spawnFood(hit);
        return hit;
      },
      feedRandom(n) {
        let k = 0;
        for (let i = 0; i < n; i++) {
          const t = frngGlobal.range(0.05, 0.3);
          const p = pathPoint(t, new THREE.Vector3());
          p.x += frngGlobal.range(-1.8, 1.8); p.z += frngGlobal.range(-1.2, 1.2);
          p.y = heightAt(p.x, p.z);
          spawnFood(p);
          k++;
        }
        return k;
      },
      addMember(member) {
        foxes.push(new Fox(member, true));
      },
      creatures() {
        return giants.tags(foxes.map(f => ({ member: f.member, pos: f.labelPos, radius: 0.55 })));
      },
      /** Test hook: start a giant's pass now ('fox' | 'deer', or by the hour) and run it `secs` s on. */
      debugGiant(kind = null, secs = 25) { return giants.debug(kind, secs, giantCtx); },
      debug: { foxes, foods, world, heightAt, pathPoint, spawnFood: p => spawnFood(p), giants, shafts, mist, sparrows, moths, knoll: KNOLL },
      dispose() {
        foxes.forEach(f => f.dispose());
        cranes.forEach(c => { c.mixer.stopAllAction(); c.mixer.uncacheRoot(c.o); });
        foods.forEach(f => f.kill());
        fadingFoods.forEach(f => f.release());
        scene.traverse(o => { if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose(); });
        sunLight.dispose();
        lanternLights.forEach(l => l.dispose());
        envMap.dispose();
        envSky.geometry.dispose();
        disposables.forEach(d => d && d.dispose && d.dispose());
        fx.dispose();
        giants.dispose(); shafts.dispose(); mist.dispose(); sparrows.dispose(); moths.dispose();
      },
    };
    void lastT; void tmpV2;
    // Set the time of day once now, environment map included: the shell compiles every material right after
    // create(), and a PBR material compiled before scene.environment exists gets a program without the env map.
    // Hidden objects (the tofu pool, the fox pre-warm clones) are not drawn in the warm-up frames, so they kept
    // that variant and recompiled on their first visible frame, e.g. the first offering.
    updateTimeOfDay(0, 0);
    return inst;
  },
};
