// 芒原 · 狐与鸟居 — a golden susuki field rolling in the wind, a vermilion torii on a rise, crimson
// maples, misty layered mountains; foxes (and Inari's white fox) that come running for fried tofu.
// Art direction inspired by Ghost of Tsushima; all assets procedural except the CC0 Fox / Stork models.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, smoothstep, damp, dampAngle, angleDelta, createNoise, createWind, addWind, patchMaterial, softDiscTexture } from '../lib/util.js';
import { samplePalette, makeFogUniforms, addFog, createSkyMaterial, buildMountains } from './meadow/sky.js';
import { makeWindUniforms, makeGrassColorUniforms, grassMaterial, buildClump, buildPlumeStalk, instancedFrom, buildMaple, mapleLeafMaterial, mapleLeafDepthMaterial, WIND_GLSL } from './meadow/flora.js';
import { buildTorii, buildHokora, buildLantern, buildRocks, makeStoneMaterial, makeTofuFactory } from './meadow/props.js';
import * as TX from './meadow/tex.js';
import { createFx } from './meadow/fx.js';

const FOX_SCALE = 0.0078;     // ≈1.2 m nose to tail
const WALK_REF = 115;         // stride speed of the Walk clip in model units / s
const RUN_REF = 240;

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
    function rawHeight(x, z) {
      let h = noise.fbm2(x * 0.0105 + 3.7, z * 0.0105 - 1.3, 4) * 3.2;
      h += noise.fbm2(x * 0.042 - 8.1, z * 0.042 + 2.2, 3) * 0.45;
      const r2 = x * x + (z + 1.5) * (z + 1.5);
      h += 1.7 * Math.exp(-r2 / (2 * 9.5 * 9.5));
      h -= 0.8 * smoothstep(4, 24, z);
      const d = Math.hypot(x, z);
      h += smoothstep(70, 300, d) * (noise.fbm2(x * 0.0045 + 11, z * 0.0045 - 7, 3) * 12 + 3);
      return h;
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
    const tPathTorii = 0.9 / pathCurve.getLength();

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
    // obstacles for fox steering
    const obstacles = [
      { x: -1.375, z: 0, r: 0.42 }, { x: 1.375, z: 0, r: 0.42 },
      { x: LANTERNS[0].x, z: LANTERNS[0].z, r: 0.5 }, { x: LANTERNS[1].x, z: LANTERNS[1].z, r: 0.5 },
      { x: SHRINE.x, z: SHRINE.z, r: 0.95 },
      ...treeSpots.map(t => ({ x: t.x, z: t.z, r: 0.45 })),
      ...rockList.filter(r => r.s > 0.3).map(r => ({ x: r.x, z: r.z, r: r.s * 1.1 })),
    ];

    function grassFactor(x, z) {
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
    let envRT = null, envKey = -999;
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
        uniforms: { ...windU, uPath: { value: pathU }, uPathW: { value: 0.58 }, uNearCol: { value: new THREE.Color('#3e3622') }, uFarCol: { value: new THREE.Color('#8c7442') }, uFarCol2: { value: new THREE.Color('#4e4a2a') }, uDirtCol: { value: new THREE.Color('#7c6548') } },
        vertexHeader: '',
        fragmentHeader: WIND_GLSL.replace(/uniform vec4 uPress\[4\];/, 'uniform vec4 uPress[4];') + `
          uniform vec2 uPath[24]; uniform float uPathW; uniform vec3 uNearCol, uFarCol, uFarCol2, uDirtCol;
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
              if (dot(wp.xz, wp.xz) < 3600.0) {
                float pd = pathDistF(wp.xz);
                float edge = uPathW + (mNoise(wp.xz * 2.1) - 0.5) * 0.32;
                float pm = 1.0 - smoothstep(edge - 0.2, edge + 0.15, pd);
                float wear = 1.0 - smoothstep(edge * 0.2, edge * 0.9, pd);
                vec3 dirt = uDirtCol * (0.72 + 0.4 * mNoise(wp.xz * 4.7) + 0.15 * wear);
                dirt *= 1.0 - 0.3 * step(0.8, mNoise(wp.xz * 13.0 + 5.0));
                c = mix(c, dirt, pm);
              }
              diffuseColor.rgb = c;
            }`,
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
        { r0: 0, r1: 24, step: 0.48, geo: buildClump(grng, { blades: 15, segs: 4, width: 0.024 }), pgeo: buildPlumeStalk({ planes: 3, segs: 3, plumeFrom: 0.72, width: 0.07 }), xz: 1.0, y: 1.0, pp: 0.34 },
        { r0: 24, r1: 72, step: 0.92, geo: buildClump(grng, { blades: 11, segs: 3, width: 0.032 }), pgeo: buildPlumeStalk({ planes: 3, segs: 2, plumeFrom: 0.72, width: 0.075 }), xz: 1.3, y: 1.06, pp: 0.36 },
        { r0: 72, r1: 200, step: 1.8, geo: buildClump(grng, { blades: 8, segs: 2, width: 0.05 }), pgeo: buildPlumeStalk({ planes: 2, segs: 2, plumeFrom: 0.7, width: 0.095 }), xz: 1.75, y: 1.14, pp: 0.3 },
      ];
      const camDefault = new THREE.Vector2(TARGET.x, TARGET.z + 16);
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
          const H = (1.15 + 0.6 * grng.next()) * (0.78 + 0.4 * patch) * (0.24 + 0.76 * f) * R.y;
          const y = heightAt(x, z) - 0.04;
          const hue = clamp((noise.fbm2(x * 0.03 - 9, z * 0.03 + 4, 2)) * 1.3 + (1 - f) * 0.7 + grng.range(-0.25, 0.25), -1, 1);
          const rec = { x, y, z, rot: grng.range(0, TAU), sx: H * grng.range(0.7, 1.0) * R.xz, sy: H, inst: [hue, grng.next(), grng.next(), grng.next()], d: Math.hypot(x - camDefault.x, z - camDefault.y) };
          clumps.push(rec);
          if (f > 0.55 && grng.chance(R.pp * (0.6 + 0.8 * patch))) {
            const nP = grng.chance(0.35) ? 2 : 1;
            for (let k = 0; k < nP; k++) {
              const ph = H * grng.range(1.15, 1.45);
              plumes.push({ x: x + grng.range(-0.15, 0.15) * rec.sx, y, z: z + grng.range(-0.15, 0.15) * rec.sx, rot: Math.atan2(-baseWind.y, baseWind.x) + grng.range(-0.7, 0.7), sx: ph * grng.range(0.85, 1.1) * (R.xz > 1.5 ? 1.25 : 1), sy: ph, inst: [grng.range(-0.3, 0.3), grng.next(), grng.next(), grng.next()], d: rec.d });
            }
          }
        }
        clumps.sort((a, b) => a.d - b.d);
        plumes.sort((a, b) => a.d - b.d);
        const gm = instancedFrom(R.geo, grassMat, clumps);
        const pm = instancedFrom(R.pgeo, plumeMat, plumes);
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
    scene.add(buildRocks({ rng: rng.fork('rocks'), noise, list: rockList, heightAt, stoneMat }));

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
    // the glTF fox ships without normals (flat-shaded via derivatives); build smooth normals so any material works
    foxGeo = own(mergeVertices(foxGeo.clone(), 1e-3));
    foxGeo.computeVertexNormals();
    const foxMat = addFog(baseFoxMat.clone(), fogU, 'mfogFox');
    foxMat.flatShading = false;
    foxMat.envMapIntensity = 0.6;
    const whiteU = { uGlow: { value: 0 } };
    const whiteMat = baseFoxMat.clone();
    whiteMat.flatShading = false;
    whiteMat.envMapIntensity = 0.7;
    patchMaterial(whiteMat, {
      key: 'whiteFox', uniforms: whiteU, fragmentHeader: 'uniform float uGlow;',
      fragment: {
        '#include <map_fragment>': `$&
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb = vec3(0.97, 0.94, 0.88) * (0.26 + 0.78 * smoothstep(0.02, 0.6, lum));`,
        '#include <emissivemap_fragment>': '$&\n totalEmissiveRadiance += vec3(0.62, 0.78, 1.0) * uGlow * (0.35 + 0.65 * diffuseColor.r);',
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
        st.scale.setScalar(0.0042);
        st.position.set(px2, py + 0.47, pz2 - 0.05);
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
        for (const n of ['Survey', 'Walk', 'Run']) {
          const a = this.mixer.clipAction(clip(n));
          a.play(); a.setEffectiveWeight(this.w[n]); a.time = this.rng.range(0, a.getClip().duration);
          this.act[n] = a;
        }
        this.bones = {};
        this.root.traverse(o => { if (o.isBone) this.bones[o.name] = o; });
        this.pos = new THREE.Vector3();
        this.goal = new THREE.Vector3();
        this.heading = this.rng.range(0, TAU);
        this.pitch = 0;
        this.speed = 0;
        this.state = 'idle';
        this.timer = this.rng.range(0.5, 3);
        this.food = null;
        this.eatT = 0; this.bites = 0; this.eatW = 0; this.lookW = 0; this.restW = 0;
        this.labelPos = new THREE.Vector3();
        this.applyScale();
        if (spawnAtEdge) {
          const a = this.rng.range(-1.2, 1.2);
          this.pos.set(Math.sin(a) * 22, 0, -Math.cos(a) * 18 - 2);
          this.state = 'walk';
          this.pickGoal(true);
        } else {
          const t = this.rng.range(0.02, 0.5);
          pathPoint(t, this.pos);
          this.pos.x += this.rng.range(-0.6, 0.6);
        }
        this.pos.y = heightAt(this.pos.x, this.pos.z);
        this.wisps = [];
        if (this.white) {
          for (let i = 0; i < 3; i++) { const s = fx.glow('#9fdcff', 0.34, 2.2); s.visible = false; scene.add(s); this.wisps.push(s); }
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
          pathPoint(r.range(0.12, 0.45), this.goal);
          this.goal.x += r.range(-0.8, 0.8);
          this.wantRest = false;
        } else {
          const k = r.next();
          if (k < 0.5) { pathPoint(r.range(0.0, 0.7), this.goal); this.goal.x += r.range(-0.7, 0.7); }
          else if (k < 0.78) { const a = r.range(0, TAU), d = r.range(1.6, 4.2); this.goal.set(Math.sin(a) * d, 0, 0.6 + Math.cos(a) * d); }
          else { this.goal.set(r.range(-9, 10), 0, r.range(-6, 11)); }
          this.wantRest = false;
        }
        this.goal.y = heightAt(this.goal.x, this.goal.z);
      }
      setState(s, timer = 0) { this.state = s; this.timer = timer; }
      update(dt, t) {
        const r = this.rng;
        this.timer -= dt;
        // food has priority
        if (this.food && this.food.dead) { this.food = null; if (this.state === 'toFood' || this.state === 'notice') this.setState('idle', r.range(0.6, 1.4)); }
        let targetSpeed = 0, steer = false, lookAt = null;
        switch (this.state) {
          case 'idle':
            if (this.timer <= 0) { this.pickGoal(); this.setState('walk', 30); }
            break;
          case 'rest':
            if (this.timer <= 0 || world.night < 0.4) { this.pickGoal(); this.setState('walk', 30); }
            break;
          case 'walk': {
            steer = true;
            targetSpeed = this.walkSpeed * (this.hungry() ? 1.15 : 1);
            const d = Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z);
            if (d < 0.35 || this.timer <= 0) {
              if (this.wantRest) this.setState('rest', r.range(25, 70));
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
            this.goal.copy(this.food.pos);
            const d = Math.hypot(this.goal.x - this.pos.x, this.goal.z - this.pos.z);
            targetSpeed = d > 2.2 ? this.runSpeed : lerp(this.walkSpeed * 0.6, this.runSpeed, clamp((d - 0.6) / 1.6, 0, 1));
            if (d < this.mouthDist() + 0.05 && this.food.landed) { this.setState('eat', 2.6); this.eatT = 0; this.bites = 0; }
            if (this.timer <= 0) { this.food.claimed = null; this.food = null; this.setState('idle', 1); }
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
          let dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z;
          const dl = Math.hypot(dx, dz) || 1;
          dx /= dl; dz /= dl;
          for (const o of obstacles) {
            const ox = this.pos.x - o.x, oz = this.pos.z - o.z, od = Math.hypot(ox, oz);
            const rr = o.r + 0.45;
            if (od < rr + 0.8) { const k = (rr + 0.8 - od) / 0.8; dx += (ox / od) * k * 1.2; dz += (oz / od) * k * 1.2; }
          }
          for (const f2 of foxes) {
            if (f2 === this) continue;
            const ox = this.pos.x - f2.pos.x, oz = this.pos.z - f2.pos.z, od = Math.hypot(ox, oz);
            if (od < 1.0 && od > 1e-3) { dx += (ox / od) * (1.0 - od) * 1.5; dz += (oz / od) * (1.0 - od) * 1.5; }
          }
          desired = Math.atan2(dx, dz);
        } else if (lookAt) {
          desired = Math.atan2(lookAt.x - this.pos.x, lookAt.z - this.pos.z);
        } else if (this.state === 'idle' && this.hungry()) {
          desired = Math.atan2(camera.position.x - this.pos.x, camera.position.z - this.pos.z);
        }
        const turnRate = this.state === 'toFood' ? 5 : 2.6;
        this.heading = dampAngle(this.heading, desired, turnRate, dt);
        const err = Math.abs(angleDelta(this.heading, desired));
        if (steer) targetSpeed *= clamp(1.25 - err / 1.3, 0.12, 1);
        this.speed = damp(this.speed, targetSpeed, targetSpeed > this.speed ? 2.6 : 5, dt);
        this.pos.x += Math.sin(this.heading) * this.speed * dt;
        this.pos.z += Math.cos(this.heading) * this.speed * dt;
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
        // animation weights
        const sp = this.speed;
        const wRun = smoothstep(this.walkSpeed * 1.25, this.runSpeed * 0.75, sp);
        const wMove = smoothstep(0.03, this.walkSpeed * 0.45, sp);
        const tgt = { Survey: 1 - wMove, Walk: wMove * (1 - wRun), Run: wMove * wRun };
        for (const n of ['Survey', 'Walk', 'Run']) {
          this.w[n] = damp(this.w[n], tgt[n], 7, dt);
          this.act[n].setEffectiveWeight(this.w[n]);
        }
        this.act.Walk.timeScale = clamp(sp / Math.max(this.walkSpeed, 1e-3), 0.5, 2.2);
        this.act.Run.timeScale = clamp(sp / Math.max(RUN_REF * this.s, 1e-3), 0.6, 2.2);
        this.act.Survey.timeScale = this.state === 'eat' ? 0.25 : this.state === 'rest' ? 0.35 : 1;
        this.mixer.update(dt);
        // procedural head: dip to eat, lower when resting
        this.eatW = damp(this.eatW, this.state === 'eat' ? 1 : 0, 6, dt);
        this.restW = damp(this.restW, this.state === 'rest' ? 1 : 0, 1.5, dt);
        const neck = this.bones.b_Neck_04, head = this.bones.b_Head_05;
        if (neck && (this.eatW > 0.001 || this.restW > 0.001)) {
          const bob = this.eatW * (0.95 + 0.22 * Math.sin(t * 10.0)) + this.restW * 0.35;
          tmpQ.setFromAxisAngle(zAxis, -bob * 0.75);
          neck.quaternion.multiply(tmpQ);
          if (head) { tmpQ.setFromAxisAngle(zAxis, -bob * 0.45); head.quaternion.multiply(tmpQ); }
        }
        // label + wisps
        this.labelPos.set(this.pos.x, this.pos.y + 0.55 * this.s / FOX_SCALE, this.pos.z);
        if (this.white) {
          const vis = world.night > 0.35 || world.dusk > 0.5;
          const a = smoothstep(0.35, 0.9, Math.max(world.night, world.dusk * 0.6));
          whiteU.uGlow.value = 0.5 * a;
          this.wisps.forEach((s, i) => {
            s.visible = vis;
            const ang = t * 0.7 + i * TAU / 3;
            s.position.set(this.pos.x + Math.cos(ang) * 0.75, this.pos.y + 0.75 + Math.sin(t * 1.3 + i * 2) * 0.15, this.pos.z + Math.sin(ang) * 0.75);
            s.material.opacity = a * (0.75 + 0.25 * Math.sin(t * 5 + i * 3));
          });
        }
      }
      mouthDist() { return 0.52 * this.s / FOX_SCALE; }
      dispose() {
        this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root);
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
    const shrineGlow = fx.glow('#ffa050', 0.9, 1.0);
    shrineGlow.position.set(SHRINE.x, SHRINE.y + 0.95, SHRINE.z + 0.4);
    scene.add(shrineGlow);

    const world = { night: 0, dusk: 0, day: 1, golden: 0 };
    for (const m of env.members) foxes.push(new Fox(m));

    /* ================================================================ */
    /* Cranes (ambient)                                                  */
    /* ================================================================ */
    const storkG = await env.loadGLTF('models/Stork.glb');
    const cranes = [];
    {
      let smat = null;
      storkG.scene.traverse(o => { if (o.isMesh) smat = o.material; });
      const cmat = addFog(smat.clone(), fogU, 'mfogCrane');
      cmat.color = new THREE.Color('#ffffff');
      own(cmat);
      const crng = rng.fork('cranes');
      const nC = 3 + (q > 0.6 ? 1 : 0);
      const center = new THREE.Vector3(crng.range(-25, 5), crng.range(22, 30), crng.range(-95, -70));
      for (let i = 0; i < nC; i++) {
        const o = storkG.scene.clone();
        o.traverse(m => { if (m.isMesh) { m.material = cmat; m.castShadow = false; m.frustumCulled = false; } });
        o.scale.setScalar(0.011);
        scene.add(o);
        const mixer = new THREE.AnimationMixer(o);
        const a = mixer.clipAction(storkG.animations[0]);
        a.play(); a.time = crng.range(0, 1.2); a.timeScale = crng.range(0.75, 0.9);
        cranes.push({ o, mixer, act: a, off: new THREE.Vector3(-i * 3.2 * (i % 2 ? 1 : -1) * 0.5, crng.range(-1.5, 1.5), i * 3.5), phase: crng.range(0, 0.15), center, rx: crng.range(48, 70), rz: crng.range(22, 34), glide: crng.range(0, 6), prev: new THREE.Vector3() });
      }
    }

    /* ================================================================ */
    /* Food                                                              */
    /* ================================================================ */
    const tofuMaps = TX.tofuTextures(5);
    own(tofuMaps.map); own(tofuMaps.bumpMap);
    const tofuF = makeTofuFactory({ maps: tofuMaps, fogU });
    own(tofuF.geo);
    class Food {
      constructor(pos) {
        this.pos = pos.clone();
        this.mesh = tofuF.make();
        this.mesh.position.set(pos.x, pos.y + 2.2, pos.z);
        this.mesh.rotation.set(0.3, Math.random() * TAU, 0.2);
        this.vy = 0;
        this.landed = false;
        this.dead = false;
        this.claimed = null;
        this.scale = 1;
        this.age = 0;
        this.glow = fx.glow('#ffd49a', 0.9, 0.9);
        this.glow.position.copy(pos).y += 0.25;
        scene.add(this.mesh, this.glow);
      }
      bite(fox, n) {
        this.scale = n === 1 ? 0.55 : 0;
        tmpV.copy(this.pos).y += 0.08;
        fx.puff(tmpV, 16, true);
        env.onEat(fox ? fox.member : null, tmpV);
        if (n === 2) this.kill();
      }
      kill() { this.dead = true; scene.remove(this.mesh, this.glow); this.glow.material.dispose(); }
      update(dt, t) {
        this.age += dt;
        if (!this.landed) {
          this.vy -= 9.8 * dt;
          this.mesh.position.y += this.vy * dt;
          this.mesh.rotation.x = damp(this.mesh.rotation.x, 0, 3, dt);
          this.mesh.rotation.z = damp(this.mesh.rotation.z, 0, 3, dt);
          if (this.mesh.position.y <= this.pos.y + 0.045) {
            this.mesh.position.y = this.pos.y + 0.045;
            if (Math.abs(this.vy) > 1.2) { this.vy = -this.vy * 0.28; env.sfx('tok'); } else { this.vy = 0; this.landed = true; this.mesh.rotation.x = this.mesh.rotation.z = 0; }
          }
        }
        const s = damp(this.mesh.scale.x, this.scale, 10, dt);
        this.mesh.scale.setScalar(Math.max(s, 0.001));
        this.glow.material.opacity = (0.55 + 0.25 * Math.sin(t * 3)) * (this.landed ? 1 : 0.5);
        this.glow.position.set(this.pos.x, this.pos.y + 0.22 + Math.sin(t * 2) * 0.03, this.pos.z);
        if (this.age > 90 && !this.claimed) this.kill();
      }
    }
    const guide = { w: 0, t: 99, dir: new THREE.Vector2(), pos: new THREE.Vector3() };
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
      const f = new Food(p);
      foods.push(f);
      env.sfx('drop');
      // Guiding Wind: the field turns toward the offering, a stream of leaves and fluff follows
      guide.t = 0;
      guide.pos.copy(p);
      guide.dir.set(p.x - camera.position.x, p.z - camera.position.z).normalize();
      fx.stream(camera, p);
      // the nearest free fox notices
      assignFoxes();
      return f;
    }
    function assignFoxes() {
      for (const f of foods) {
        if (f.dead || f.claimed) continue;
        let best = null, bd = 1e9;
        for (const fox of foxes) {
          if (fox.food) continue;
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
    const WHITE = new THREE.Color(1, 1, 1);
    const lightCol = new THREE.Color();
    const sunDirV = new THREE.Vector3(), lightDir = new THREE.Vector3(), moonDir = new THREE.Vector3();
    const windDir = new THREE.Vector2().copy(baseWind);
    const drift = new THREE.Vector2();
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

    function updateTimeOfDay(dt, t) {
      const hours = env.hours();
      const s = env.sun(sunOpts);
      const el = s.elevationDeg;
      const morning = hours < 12;
      samplePalette(el, morning, pal);
      sunDirV.copy(s.dir);
      // artistic moon: rises on the left in the evening, crosses in front, sets on the right before dawn
      const np = (((hours - 18) % 24) + 24) % 24 / 12;
      moonDir.set(-0.95 + 1.7 * clamp(np, 0, 1), 0.1 + 0.2 * Math.sin(Math.PI * clamp(np, 0, 1)), -1).normalize();
      const night = s.night, day = s.day;
      world.night = night; world.day = day; world.golden = s.golden;
      world.dusk = smoothstep(-9, -1, el) * (1 - smoothstep(0, 4, el));
      // horizon occlusion of the sun by the ridges
      const az = Math.atan2(sunDirV.x, -sunDirV.z);
      const ridge = THREE.MathUtils.radToDeg(mountains.userData.horizonAt(az));
      const sunVis = smoothstep(ridge - 0.5, ridge + 0.6, el);
      // light: sun by day, moon by night
      if (el > -5) {
        lightDir.copy(sunDirV);
        if (lightDir.y < 0.035) lightDir.y = 0.035;
        lightCol.copy(pal.sun);
        sunLight.intensity = pal.sunI * lerp(0.35, 1, sunVis);
      } else {
        lightDir.copy(moonDir);
        lightCol.set('#9db4ff');
        sunLight.intensity = 0.55 * smoothstep(-5, -12, el);
      }
      lightDir.normalize();
      sunLight.color.copy(lightCol);
      sunLight.position.copy(TARGET).addScaledVector(lightDir, 90);
      sunLight.target.position.copy(TARGET);
      hemi.color.copy(pal.hemiS); hemi.groundColor.copy(pal.hemiG); hemi.intensity = pal.hemiI;
      // fog + sky
      fogU.uFogColor.value.copy(pal.hor);
      fogU.uFogSunColor.value.copy(pal.glow);
      fogU.uFogMistColor.value.copy(pal.mistC);
      fogU.uFogSunDir.value.copy(el > -8 ? sunDirV : moonDir);
      fogU.uFogHaze.value = pal.haze;
      fogU.uFogMist.value = pal.mist;
      const su = skyMat.uniforms;
      su.uZenith.value.copy(pal.zen);
      su.uSunDir.value.copy(sunDirV);
      su.uSunHalo.value.copy(pal.halo).multiplyScalar(smoothstep(-10, 0, el) * (0.55 + 0.45 * sunVis));
      su.uSunDisk.value.copy(pal.halo).lerp(WHITE, smoothstep(5, 30, el) * 0.6).multiplyScalar(60 * smoothstep(-1.0, 0.6, el) * sunVis);
      su.uMoonDir.value.copy(moonDir);
      su.uMoonAmt.value = smoothstep(-5, -13, el);
      su.uStars.value = smoothstep(-7, -16, el);
      su.uCloudLit.value.copy(pal.cl);
      su.uCloudDark.value.copy(pal.cd);
      su.uTime.value = t;
      su.uCloudOff.value.x += dt * 0.004 * baseWind.x;
      su.uCloudOff.value.y += dt * 0.004 * baseWind.y;
      su.uCloudCover.value = 0.57 + 0.06 * Math.sin(t * 0.01 + env.seed % 10);
      // lanterns / shrine glow
      const lampOn = smoothstep(-1, -7, el);
      lanternLights.forEach(l => { l.intensity = 9 * lampOn * (0.92 + 0.08 * Math.sin(t * 9.0 + l.position.x)); });
      windowMat.emissiveIntensity = 3.2 * lampOn;
      lanternGlows.forEach((g, i) => { g.material.opacity = lampOn * (0.85 + 0.15 * Math.sin(t * 7 + i)); g.visible = lampOn > 0.01; });
      shrineGlow.material.opacity = lampOn * 0.6; shrineGlow.visible = lampOn > 0.01;
      hokora.userData.doorMat.emissiveIntensity = lampOn * 0.6;
      // grass tuning per time of day
      colors.uGustBright.value = lerp(0.2, 0.55, day);
      plumeMat.userData.U.uTransl.value = lerp(0.5, 0.2, night);
      // post
      post.exposure = pal.exp;
      post.bloom.strength = 0.32 + 0.3 * s.golden + 0.25 * night;
      post.bloom.threshold = lerp(1.0, 0.65, night);
      post.bloom.radius = 0.72;
      post.saturation = lerp(1.06, 0.92, night) + 0.06 * s.golden;
      post.contrast = 1.06;
      post.lift[0] = lerp(0.012, 0.0, night); post.lift[1] = lerp(0.006, 0.012, night); post.lift[2] = lerp(0.0, 0.03, night);
      post.gain[0] = lerp(1.03 + 0.03 * s.golden, 0.94, night); post.gain[1] = lerp(1.0, 1.0, night); post.gain[2] = lerp(0.95 - 0.04 * s.golden, 1.06, night);
      // environment map (re-render the sky into PMREM when the hour moves)
      const key = Math.round(hours * 12);
      if (key !== envKey) {
        envKey = key;
        const rt = env.pmrem.fromScene(envScene, 0, 0.1, 100);
        if (envRT) envRT.dispose();
        envRT = rt;
        scene.environment = rt.texture;
      }
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
      const sp = 0.32 * (1 + 0.9 * gw);
      const sc = windU.uWindScroll.value;
      sc.x = (sc.x + windDir.x * sp * dt) % 256;
      sc.y = (sc.y + windDir.y * sp * dt) % 256;
      windU.uTime.value = t;
      windSpeed = 2.2 * str;
      drift.x += windDir.x * windSpeed * 0.5 * dt;
      drift.y += windDir.y * windSpeed * 0.5 * dt;
      if (Math.abs(drift.x) > 1e5 || Math.abs(drift.y) > 1e5) drift.set(0, 0);
      wind.update(dt);
      // press grass around food so the offering stays visible
      const press = windU.uPress.value;
      for (let i = 0; i < 4; i++) {
        const f = foods[foods.length - 1 - i];
        if (f && !f.dead) press[i].set(f.pos.x, f.pos.y, f.pos.z, damp(press[i].w, 0.9, 3, dt));
        else press[i].w = damp(press[i].w, 0, 2, dt);
      }
    }

    function updateCranes(dt, t) {
      const vis = world.day > 0.15;
      for (const c of cranes) {
        c.o.visible = vis;
        if (!vis) continue;
        const a = t * 0.045 + c.phase;
        c.prev.copy(c.o.position);
        c.o.position.set(c.center.x + Math.cos(a) * c.rx + c.off.x, c.center.y + Math.sin(a * 2) * 3 + c.off.y, c.center.z + Math.sin(a) * c.rz + c.off.z);
        tmpV.subVectors(c.o.position, c.prev);
        if (tmpV.lengthSq() > 1e-8) {
          const yaw = Math.atan2(tmpV.x, tmpV.z);
          c.o.rotation.set(0, yaw, -Math.cos(a) * 0.25);
        }
        c.glide -= dt;
        if (c.glide < -5) c.glide = 4 + Math.random() * 3;
        c.act.timeScale = damp(c.act.timeScale, c.glide > 0 ? 0.08 : 0.85, 2, dt);
        c.mixer.update(dt);
      }
    }

    let lastT = 0;
    const inst = {
      scene, camera, view, post,
      update(dt, t) {
        lastT = t;
        const tod = updateTimeOfDay(dt, t);
        updateWind(dt, t);
        for (let i = foods.length - 1; i >= 0; i--) { const f = foods[i]; if (!f.dead) f.update(dt, t); if (f.dead) foods.splice(i, 1); }
        if (foods.some(f => !f.claimed && !f.dead)) assignFoxes();
        for (const f of foxes) f.update(dt, t);
        updateCranes(dt, t);
        sky.position.copy(camera.position);
        env.renderer.getDrawingBufferSize(prVec);
        fx.update(dt, t, {
          camera, target: view.target, windDir, windSpeed, drift, light: lightCol, day: world.day, night: world.night, golden: world.golden,
          sunDir: sunDirV, pr: prVec.y / 720 * 1.0 + 0.0001,
        });
        void tod;
      },
      feed(raycaster) {
        const hit = rayGround(raycaster.ray, new THREE.Vector3());
        if (!hit) return null;
        if (Math.hypot(hit.x - TARGET.x, hit.z - TARGET.z) > 30) return null;
        spawnFood(hit);
        return hit;
      },
      feedRandom(n) {
        let k = 0;
        for (let i = 0; i < n; i++) {
          const t = frngGlobal.range(0.06, 0.42);
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
        return foxes.map(f => ({ member: f.member, pos: f.labelPos, radius: 0.55 }));
      },
      dispose() {
        foxes.forEach(f => f.dispose());
        cranes.forEach(c => { c.mixer.stopAllAction(); c.mixer.uncacheRoot(c.o); });
        foods.forEach(f => f.kill());
        if (envRT) envRT.dispose();
        envSky.geometry.dispose();
        disposables.forEach(d => d && d.dispose && d.dispose());
        fx.dispose();
      },
    };
    void lastT; void tmpV2;
    return inst;
  },
};
