// 云海 · 蟠桃仙境 — the Queen Mother's heavenly peach garden floating above a sea of clouds.
// Chinese pavilions with flying eaves, an immortal peach tree, an old tortoise practising tai chi,
// red-crowned cranes and flocks of little blue spirit birds. Feed them glowing peaches (蟠桃).
import * as THREE from 'three';
import { createWind, clamp, lerp, damp, smoothstep, TAU } from '../lib/util.js';
import { createShared, createTimeOfDay, makeBillowTexture, makeDetailTexture, makeCirrusTexture, makeNoiseTexture, makeRockTexture, CLOUD_TOP, CLOCK_PERIOD } from './cloudsea/common.js';
import { createSky, createEnvironment } from './cloudsea/sky.js';
import { createCloudSea, createPuffs, towerPuffs, bankPuffs, mistFall } from './cloudsea/clouds.js';
import { createGarden } from './cloudsea/garden.js';
import { createCreatures } from './cloudsea/creatures.js';
import { createSparkles, createPetals, createMotes, createSkyLanterns, createPeaches, createHalos, SKYL_PERIOD } from './cloudsea/fx.js';

// lib/util.js addWind() uses uWindTime at 1.7, 3.1, 8 and 9 rad/s: all whole cycles in 20π s, so wrapping the
// clock there is seamless and keeps the sway precise in float32 however long the page stays open.
const WIND_PERIOD = 20 * Math.PI;

const NAME_POOL = ['寿星', '团团', '云朵', '桃桃', '阿福', '仙仙', '青青', '鹤鹤', '如意', '吉祥', '平安', '小满', '星星', '月饼', '糯米', '汤圆'];

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
    const nSwirls = q >= 0.7 ? 5 : 3;
    for (let i = 0; i < nSwirls; i++) {
      const a = crng.range(0, TAU), d = i < 2 ? crng.range(45, 70) : crng.range(90, 170);
      const sw = { a, d, y: crng.range(-4, 16) + (i < 2 ? 0 : 10), speed: crng.range(0.005, 0.01) * crng.sign(), size: i < 2 ? crng.range(2.6, 3.4) : crng.range(4.5, 7), pts: [], dir: crng.sign(), c: { x: 0, y: 0, z: 0 } };
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
      // the swirl is sorted as one unit; inside it the puffs keep a fixed back-to-front order (by their offset
      // toward the viewer), so overlapping puffs never swap places and pop as the camera moves
      sw.pts.forEach((p, k) => { p.it = { x: 0, y: 0, z: 0, r: p.r * 1.15, seed: crng.next(), shade: 1.0, alpha: 0.5, cx: 0, cy: 0, cz: 0, cr: 4 * S, grp: sw.c, ord: p.w + k * 1e-4 }; nearItems.push(p.it); });
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

    /* ---- effects ---- */
    const fx = { sparkles: createSparkles(q >= 0.7 ? 900 : 500) };
    scene.add(fx.sparkles.points);
    const petals = createPetals(shared, garden.tree.clusters, Math.round(300 * q + 150), new THREE.Vector2(0.8, 0.4));
    scene.add(petals.points);
    const tp = garden.tree.top;
    const motes = createMotes(shared, [{ x: 0, y: 0.3, z: 0, r: 12, h: 7 }, { x: tp.x, y: tp.y - 1, z: tp.z, r: 6, h: 6 }, { x: garden.A.x, y: garden.A.y, z: garden.A.z, r: 7, h: 6 }], Math.round(170 * q + 60));
    scene.add(motes.points);
    const skyLanterns = createSkyLanterns(Math.round(26 * q + 10), rng.fork('skylanterns'));
    scene.add(skyLanterns.mesh);
    const peaches = createPeaches(shared, garden.peachSpots, 14);
    scene.add(peaches.tree, peaches.food);
    const halos = createHalos(16);
    scene.add(halos.points);

    /* ---- residents ---- */
    // older saves may only hold kinds this world no longer has: give them fresh residents
    if (!env.members.length) {
      const mr = rng.fork('members');
      for (const kind of this.starter) env.members.push({ id: Math.floor(mr.next() * 2 ** 31).toString(36), kind, name: mr.pick(NAME_POOL), size: mr.range(0.9, 1.1), eaten: 0, lastAte: Date.now() - mr.range(0.2, 3) * 3600e3, born: Date.now(), seed: mr.int(1, 2 ** 30) });
      env.markDirty();
    }
    const islets = [
      { x: 0, z: 0, R: garden.main.radius + 1.5, top: 0.6, bottom: -garden.main.depth },
      { x: garden.A.x, z: garden.A.z, R: garden.islA.radius + 1.5, top: garden.A.y + 0.6, bottom: garden.A.y - garden.islA.depth },
      { x: garden.Bp.x, z: garden.Bp.z, R: garden.islB.radius + 1.5, top: garden.Bp.y + 0.6, bottom: garden.Bp.y - garden.islB.depth },
    ];
    const spheres = [
      { c: garden.tree.top.clone().add(new THREE.Vector3(0, 1.8, 0)), r: 5.6 },
      { c: garden.pavPos.clone().add(new THREE.Vector3(0, 4.2, 0)), r: 4.3 },
      { c: garden.A.clone().add(new THREE.Vector3(0, 5, 0)), r: 6.0 },
      { c: garden.Bp.clone().add(new THREE.Vector3(0, 3.5, 0)), r: 4.5 },
    ];
    const tmpA = new THREE.Vector3();
    // The jade tai-chi terrace stands ~25 cm proud of the lawn: anything that walks or rests on it uses its top
    // (walking used the lawn height and sank the tortoise and peaches into the stone).
    const tj = garden.taiji, TERRACE_R = 2.3;
    const onTerrace = (x, z) => Math.hypot(x - tj.x, z - tj.z) < TERRACE_R;
    const floorAt = (x, z, g) => (g !== null && onTerrace(x, z) ? Math.max(g, garden.taijiFloor) : g);
    // Obstacles for flight-path planning (landing approaches and take-offs) and for walking around. The peach
    // tree sprawls ~8 m from its trunk with boughs hanging low, so it is modelled as trunk + limbs + foliage.
    const trunk = garden.treePos, treeTop = garden.tree.top, cl = garden.tree.clusters;
    const segDist2 = (x, y, z, a, b) => {   // squared distance from (x,y,z) to the segment a-b
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, wx = x - a.x, wy = y - a.y, wz = z - a.z;
      const t = clamp((wx * ux + wy * uy + wz * uz) / Math.max(ux * ux + uy * uy + uz * uz, 1e-6), 0, 1);
      const dx = wx - ux * t, dy = wy - uy * t, dz = wz - uz * t;
      return dx * dx + dy * dy + dz * dz;
    };
    const trunkBase = trunk.clone();
    const builds = [   // footprint radius and roof height of the buildings
      { x: garden.pavPos.x, z: garden.pavPos.z, r: 3.9, top: garden.pavPos.y + 7.5 },
      { x: garden.A.x, z: garden.A.z, r: 4.8, top: garden.A.y + 10 },
      { x: garden.Bp.x, z: garden.Bp.z, r: 4.4, top: garden.Bp.y + 6.5 },
    ];
    const lanternsAt = [-1, 1].map(s => ({ x: tj.x + 1.2, z: tj.z + s * 3.2 }));
    // circles a walker steers around on the main lawn (a goal inside one is walked straight into)
    const walkObs = [
      { x: trunk.x, z: trunk.z, r: 1.25 },
      { x: garden.pavPos.x, z: garden.pavPos.z, r: 3.3 },
      { x: garden.poolC.x, z: garden.poolC.z, r: 1.55 },
      ...lanternsAt.map(l => ({ x: l.x, z: l.z, r: 0.42 })),
    ];
    const hungryOut = { p: new THREE.Vector3(), yaw: 0 };
    const world = {
      mainGround: (x, z) => floorAt(x, z, garden.mainGround(x, z)),
      groundAt: (x, z) => floorAt(x, z, garden.groundAt(x, z)),
      treeTop: garden.tree.top.clone().add(new THREE.Vector3(0, 1.2, 0)),
      perches: garden.perches.length ? garden.perches : [garden.tree.top.clone()],
      taijiSpot(i) {
        const tr = garden.treePos;
        const yaw = Math.atan2(tj.x - tr.x, tj.z - tr.z);
        if (i === 0) return { p: new THREE.Vector3(tj.x, garden.taijiFloor, tj.z), yaw };
        const a = yaw + (i % 2 ? 1 : -1) * (1.2 + Math.floor((i - 1) / 2) * 0.8);
        const p = new THREE.Vector3(tj.x + Math.sin(a) * 3.6, 0, tj.z + Math.cos(a) * 3.6);
        p.y = world.mainGround(p.x, p.z) ?? garden.taijiFloor;
        return { p, yaw };
      },
      // (reuses one object: it is asked every frame while a resident is hungry)
      hungrySpot(home, cam) {
        const d = tmpA.set(cam.position.x - home.p.x, 0, cam.position.z - home.p.z).normalize();
        const p = hungryOut.p.copy(home.p).addScaledVector(d, 3.5);
        const g = world.mainGround(p.x, p.z);
        if (g === null) return home;
        p.y = g;
        hungryOut.yaw = Math.atan2(d.x, d.z);
        return hungryOut;
      },
      /** True if a flying crane (half-span margin m) at x,y,z would touch the tree, a building, a lantern or an islet. */
      blocked(x, y, z, m) {
        if (segDist2(x, y, z, trunkBase, treeTop) < (1.1 + m) ** 2) return true;
        for (const c of cl) {
          const dx = x - c.c.x, dy = y - c.c.y, dz = z - c.c.z, R = c.r + m;
          if (dx * dx + dy * dy + dz * dz < R * R || segDist2(x, y, z, treeTop, c.c) < (0.35 + m) ** 2) return true;
        }
        for (const b of builds) if (y < b.top + m && Math.hypot(x - b.x, z - b.z) < b.r + m) return true;
        for (const l of lanternsAt) if (Math.hypot(x - l.x, z - l.z) < 0.5 + m && y < garden.taijiFloor + 2.1 + m) return true;
        const g = garden.groundAt(x, z);
        if (g !== null && y < g + 0.3) return true;
        for (const il of islets) if (Math.hypot(x - il.x, z - il.z) < il.R - 1.5 && y < il.top && y > il.bottom) return true;
        return false;
      },
      /** Heading from (x,z) toward (gx,gz) that passes the trunk, buildings, pond and lanterns (and the residents
       *  in `extra`, other than `self`) at clearance c. */
      walkHeading(x, z, gx, gz, c, extra = null, self = null) {
        let dx = gx - x, dz = gz - z;
        const D = Math.hypot(dx, dz) || 1e-6;
        dx /= D; dz /= D;
        let head = Math.atan2(dx, dz), near = 1e9;
        const nS = walkObs.length, n = nS + (extra ? extra.n : 0);
        for (let i = 0; i < n; i++) {
          const o = i < nS ? walkObs[i] : extra.list[i - nS];
          if (o.ref === self && self) continue;
          const R = o.r + c, ox = o.x - x, oz = o.z - z;
          const along = ox * dx + oz * dz, lat = ox * dz - oz * dx, d = Math.hypot(ox, oz);
          if (along <= 0 || along > D + R || Math.abs(lat) >= R || along > near) continue;
          if (Math.hypot(gx - o.x, gz - o.z) < R) continue;
          near = along;
          const a0 = Math.atan2(ox, oz);
          // the tangent on the side the path already leans to; inside the ring, walk round it
          const off = d > R ? Math.asin(R / d) : Math.PI / 2;
          head = lat > 0 ? a0 - off : a0 + off;
        }
        return head;
      },
      landingSpot(r, cam) {
        const spots = garden.landSpots;
        if (!spots.length) return null;
        if (cam) { let best = null, bd = 1e9; for (const s of spots) { const d = s.distanceTo(cam.position); if (d < bd) { bd = d; best = s; } } return best.clone(); }
        return spots[r.int(0, spots.length - 1)].clone();
      },
      avoid(pos, vel, out, k = 1) {
        const px = pos.x + vel.x * 1.2, py = pos.y + vel.y * 1.2, pz = pos.z + vel.z * 1.2;
        for (const il of islets) {
          const dx = px - il.x, dz = pz - il.z, d = Math.hypot(dx, dz);
          if (d < il.R + 2 && py < il.top + 1.5 && py > il.bottom - 2) {
            const push = (il.R + 2 - d) / (il.R + 2);
            out.x += dx / Math.max(d, 0.1) * push * 2 * k; out.z += dz / Math.max(d, 0.1) * push * 2 * k;
            out.y += (py > il.top - 3 ? 1.5 : -0.5) * push * k;
          }
        }
        for (const sp of spheres) {
          const dx = px - sp.c.x, dy = py - sp.c.y, dz = pz - sp.c.z, d = Math.hypot(dx, dy, dz), R = sp.r + 1.5;
          if (d < R) { const push = (R - d) / R * 2.5 * k / Math.max(d, 0.1); out.x += dx * push; out.y += dy * push; out.z += dz * push; }
        }
        if (py < CLOUD_TOP + 10) out.y += (CLOUD_TOP + 10 - py) * 0.15 * k;
      },
    };
    const creatures = createCreatures(env, shared, world, fx);
    scene.add(creatures.group);
    const foods = creatures.sys.foods;
    const _ray = new THREE.Vector3();
    function spawnPeach(p, { ground = null, float = false, onMain = false, drop = 2.6 } = {}) {
      if (foods.filter(f => f.alive).length >= 12) return null;
      const f = {
        pos: p.clone(), vel: new THREE.Vector3(), alive: true, bites: 6, maxBites: 6, scale: 0.27, tilt: rng.range(-0.15, 0.15), spin: rng.range(0, TAU),
        state: float ? 'float' : 'fall', ground, onMain, baseY: p.y, ph: rng.range(0, TAU), age: 0, held: null, claimT: null, noticeT: 0, bitesS: 6, heldS: 0,
      };
      if (!float) f.pos.y += drop;
      foods.push(f);
      fx.sparkles.burst(f.pos, new THREE.Color(2.4, 1.7, 1.0), 26, 1.6, 0.3, 1.2);
      env.sfx('pop');
      creatures.notice(f);
      return f;
    }

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

    // the default view looks west-southwest: the sunset (and the evening moon) sit to the left of the tree
    const yaw0 = 1.2;
    const target = new THREE.Vector3(1.6, 2.3, 0.25);
    const view = {
      target, dist: 24, distRange: [14, 60], idleDist: 25,
      yaw: yaw0, yawRange: null, pitch: 0.13, pitchRange: [0.04, 0.45],
      drift: 0.025, fov: 42,
    };

    envMap.update(0, true);
    scene.environment = envMap.texture;

    function update(dt, t) {
      // wrapped: every shader that reads uTime completes whole cycles in CLOCK_PERIOD (common.js), so this is seamless
      shared.uTime.value = t % CLOCK_PERIOD;
      shared.uMistT.value = t % 31.25;
      tod.update(false, dt);
      wind.update(dt);
      if (wind.uniforms.uWindTime.value > WIND_PERIOD) wind.uniforms.uWindTime.value -= WIND_PERIOD;
      if (envMap.update(t, false)) scene.environment = envMap.texture;
      sky.mesh.position.copy(camera.position);
      sea.update(dt);
      // swirls drift around the garden and turn to face the viewer
      for (const sw of swirls) {
        sw.a += sw.speed * dt;
        const cx = Math.cos(sw.a) * sw.d, cz = Math.sin(sw.a) * sw.d, cy = sw.y + Math.sin(t * 0.12 + sw.d) * 1.2;
        sw.c.x = cx; sw.c.y = cy; sw.c.z = cz;
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

      // residents & food
      creatures.update(dt, t, camera, tod);
      for (let i = foods.length - 1; i >= 0; i--) {
        const f = foods[i];
        if (!f.alive) { foods.splice(i, 1); continue; }
        f.age += dt;
        if (f.state === 'fall') {
          f.vel.y -= 7.5 * dt; f.pos.addScaledVector(f.vel, dt); f.spin += dt * 1.5;
          if (f.ground !== null && f.pos.y <= f.ground + f.scale) {
            f.pos.y = f.ground + f.scale;
            if (Math.abs(f.vel.y) > 1.4) { f.vel.y *= -0.3; env.sfx('thud'); }
            else { f.vel.set(0, 0, 0); f.state = 'rest'; }
          } else if (f.ground === null && f.age > 1.2) { f.state = 'float'; f.baseY = f.pos.y; }
        } else if (f.state === 'float') {
          // the bob fades in (it started mid-swing and the peach jumped up to 22 cm on its first frame)
          f.pos.y = f.baseY + Math.sin(t * 1.3 + f.ph) * 0.22 * Math.min(1, f.age); f.spin += dt * 0.6;
        }
        // shown size eases after each bite (~0.1 s) instead of stepping down in one frame
        f.bitesS = damp(f.bitesS, f.bites, 14, dt); f.heldS = damp(f.heldS, f.held ? 1 : 0, 8, dt);
        if (f.state !== 'held' && Math.random() < dt * 5) {
          const a = Math.random() * TAU;
          fx.sparkles.emit(f.pos.x + Math.cos(a) * 0.3, f.pos.y + 0.1, f.pos.z + Math.sin(a) * 0.3, 0, 0.35, 0, 1.6, 2.2, 1.5, 0.7, 0.16, 0);
        }
        // forgotten peaches slowly fade into light
        if (f.age > 150) { f.bites = 0; f.alive = false; fx.sparkles.burst(f.pos, new THREE.Color(2, 1.5, 1), 20, 1.2, 0.25, 1.2); }
      }
      peaches.update(t, tod.night, foods);
      const pix = env.renderer.domElement.height * 0.5 * camera.projectionMatrix.elements[5];
      halos.update(t, pix, foods, tod.night);
      fx.sparkles.update(t, pix);
      petals.uniforms.uPix.value = pix; motes.uniforms.uPix.value = pix; skyLanterns.uniforms.uPix.value = pix;
      skyLanterns.uniforms.uTime.value = t % SKYL_PERIOD;
      skyLanterns.uniforms.uShow.value = clamp(smoothstep(0.2, 0.7, tod.night) + tod.golden * 0.35, 0, 1);

      // key light follows the sun / moon
      keyLight.position.copy(tod.lightDir).multiplyScalar(80);
      keyLight.target.position.set(0, 0, 0);
      keyLight.color.copy(tod.pal.light);
      keyLight.intensity = tod.lightI * Math.PI;
      hemi.color.copy(shared.uAmbient.value).multiplyScalar(1.2);
      hemi.groundColor.copy(shared.uBounce.value).multiplyScalar(1.2);
      hemi.intensity = Math.PI * lerp(0.9, 0.6, tod.day);
      // lantern light: a slow, shallow flicker (±3%): at night these lights cover the terrace and pavilion,
      // and the old ±10% at ~1-2 Hz made large parts of the screen pulse
      const fl = 0.97 + 0.03 * Math.sin(t * 2.1) * Math.sin(t * 1.3 + 0.7);
      warmLight.intensity = lerp(0.6, 16, tod.night) * fl;
      terraceLight.intensity = lerp(0.3, 9, tod.night) * fl;

      // grade with the time of day
      const n = tod.night, g = tod.golden;
      post.bloom.threshold = lerp(lerp(2.6, 2.0, g), 0.9, n);
      post.bloom.strength = lerp(lerp(0.55, 0.68, g), 0.95, n);
      post.exposure = lerp(lerp(0.86, 0.97, g), 1.35, n);
      post.saturation = lerp(1.06, 1.12, g);
      post.contrast = lerp(0.98, 1.04, g);
      post.lift[0] = lerp(0.02, 0.03, n); post.lift[1] = lerp(0.012, 0.02, n); post.lift[2] = lerp(0.045, 0.07, n);
    }

    return {
      scene, camera, view, post,
      update,
      feed(raycaster) {
        const hits = raycaster.intersectObjects(garden.pickables, false);
        if (hits.length && hits[0].distance < 400) {
          const p = hits[0].point;
          const g = world.groundAt(p.x, p.z);
          // on lawns (and the terrace) the peach drops and rests; on roofs, rails, platforms or rock faces it hovers
          // just off the surface (a peach dropped to the lawn under a platform or rail rested inside it, and the
          // tortoise and cranes walked into the stone to reach it)
          const onLawn = g !== null && p.y - g < 0.35 && g - p.y < 1.2;
          const f = onLawn ? spawnPeach(p, { ground: g, onMain: garden.mainGround(p.x, p.z) !== null })
            : spawnPeach(_ray.copy(p).addScaledVector(raycaster.ray.direction, -0.8), { float: true });
          return f ? p.clone() : null;
        }
        const o = raycaster.ray.origin, d = raycaster.ray.direction;
        let p;
        if (d.y < -0.03) {
          const tt = (CLOUD_TOP + 4 - o.y) / d.y;
          if (tt < 110) { p = _ray.copy(o).addScaledVector(d, tt); p.y = sea.heightAt(p.x, p.z) + 1.2; }
        }
        if (!p) p = _ray.copy(o).addScaledVector(d, 25);
        const f = spawnPeach(p, { float: true });
        return f ? p.clone() : null;
      },
      feedRandom(n) {
        let k = 0;
        const c = garden.taiji.clone().lerp(garden.treePos, 0.4);
        for (let i = 0; i < n * 4 && k < n; i++) {
          const a = rng.range(0, TAU), r = rng.range(1.5, 6.5);
          const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
          const g = garden.mainGround(x, z);
          if (g === null || garden.reserved.some(o => Math.hypot(o.x - x, o.z - z) < o.r * 0.8)) continue;
          if (spawnPeach(new THREE.Vector3(x, g, z), { ground: g, onMain: true, drop: rng.range(2.5, 4.5) })) k++;
        }
        return k;
      },
      creatures: () => creatures.list(),
      addMember(m) { creatures.addMember(m); },
      // test handle (motion probes read the creatures' state through it)
      debug: { sys: creatures.sys, foods, garden, world },
      dispose() {
        envMap.dispose();
        creatures.dispose();
        garden.dispose();
        for (const k of ['billow', 'detail']) tex[k].tex.dispose();
        tex.cirrus.dispose(); tex.noise.dispose(); tex.rock.dispose();
      },
    };
  },
};
