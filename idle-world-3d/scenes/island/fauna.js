// 晴岛 residents: crabs & hermit crabs (procedural, instanced parts), gulls (Stork.glb recoloured),
// sea turtles (procedural), a dolphin pod (procedural, vertex-flexed), dusk flamingos, lagoon fish.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, smoothstep, damp, dampAngle, angleDelta, makeRng, patchMaterial } from '../../lib/util.js';
import { buildFishGeometry, paintFish, createFishMaterial, FishInstances, Swimmer } from '../../lib/fish.js';
import { Batch, segmentMatrix, addUnderwater, LAYER_NO_REFLECT } from './shared.js';
import { turtleShellTexture } from './textures.js';
import { waveHeight } from './water.js';

const V3 = THREE.Vector3;
const UP = new V3(0, 1, 0);
// scratch objects (no per-frame allocation)
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _m3 = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _s = new V3(), _p = new V3(), _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _side = new V3();
const _e = new THREE.Euler();
const _col = new THREE.Color();
const Q_ZPI = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);

function colorize(geo, r, g, b) {
  const n = geo.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = g; c[i * 3 + 2] = b; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

/** Tube along points with per-point radius. */
function loft(points, radii, radial = 10) {
  const pos = [], idx = [];
  const T = new V3(), N = new V3(), B = new V3(), d = new V3();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    T.subVectors(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]).normalize();
    B.crossVectors(T, Math.abs(T.y) > 0.9 ? new V3(1, 0, 0) : UP).normalize();
    N.crossVectors(B, T).normalize();
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * TAU;
      d.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(B, Math.sin(a));
      pos.push(p.x + d.x * radii[i], p.y + d.y * radii[i], p.z + d.z * radii[i]);
    }
  }
  for (let i = 0; i < points.length - 1; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + 1, c = a + radial + 1, e = c + 1;
    idx.push(a, c, b, b, c, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ================================================================== */
/* Crabs                                                               */
/* ================================================================== */
function buildCrabGeometries() {
  const body = new THREE.SphereGeometry(0.5, 20, 10);
  body.scale(0.34, 0.13, 0.25);
  {
    const p = body.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i), x = p.getX(i), z = p.getZ(i);
      if (y < 0) y *= 0.5;
      // front edge a little flatter and wider
      if (z > 0.06) y *= 0.85;
      p.setXYZ(i, x * (1 + 0.12 * Math.max(0, z / 0.125)), y + 0.01, z);
    }
    body.computeVertexNormals();
  }
  colorize(body, 1, 1, 1);
  {
    const p = body.attributes.position, c = body.attributes.color;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.0) c.setXYZ(i, 1.7, 1.45, 1.15);
  }
  const parts = [body];
  for (const s of [-1, 1]) {
    const st = new THREE.CylinderGeometry(0.008, 0.011, 0.07, 5); st.translate(s * 0.045, 0.07, 0.1); parts.push(colorize(st, 1.2, 1.1, 1.0));
    const ey = new THREE.SphereGeometry(0.02, 8, 6); ey.translate(s * 0.045, 0.108, 0.1); parts.push(colorize(ey, 0.02, 0.02, 0.025));
  }
  const crabBody = mergeGeometries(parts);
  parts.forEach(g => g.dispose());
  const leg = new THREE.CylinderGeometry(1, 0.65, 1, 6, 1);
  leg.translate(0, 0.5, 0);
  const blob = new THREE.SphereGeometry(1, 12, 8);
  // hermit shell: a turbo spiral
  const pts = [], radii = [];
  const turns = 2.6, n = 46;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const R = 0.11 * Math.pow(1 - t, 1.1);
    const a = t * turns * TAU;
    pts.push(new V3(Math.cos(a) * R, t * 0.2, Math.sin(a) * R));
    radii.push(0.105 * Math.pow(1 - t, 1.15) + 0.006);
  }
  const shell = loft(pts, radii, 12);
  shell.rotateX(-1.15);
  shell.translate(0, 0.07, -0.02);
  {
    const p = shell.attributes.position;
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const k = Math.floor(i / 13);
      const stripe = 0.5 + 0.5 * Math.sin(k * 0.9);
      c[i * 3] = lerp(1.0, 0.75, stripe); c[i * 3 + 1] = lerp(0.92, 0.55, stripe); c[i * 3 + 2] = lerp(0.82, 0.42, stripe);
    }
    shell.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  return { crabBody, leg, blob, shell };
}

function createCrabs(env, ctx, max) {
  const geos = buildCrabGeometries();
  const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, envMapIntensity: 0.8 });
  const legMat = new THREE.MeshStandardMaterial({ roughness: 0.5 });
  const shellMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 });
  const bodies = new Batch(geos.crabBody, bodyMat, max, { color: true, layer: LAYER_NO_REFLECT });
  const legs = new Batch(geos.leg, legMat, max * 20, { color: true, layer: LAYER_NO_REFLECT });
  const claws = new Batch(geos.blob, legMat, max * 4, { color: true, layer: LAYER_NO_REFLECT });
  const shells = new Batch(geos.shell, shellMat, max, { color: true, layer: LAYER_NO_REFLECT });
  const group = new THREE.Group();
  group.add(bodies.mesh, legs.mesh, claws.mesh, shells.mesh);
  const list = [];
  const { terrain, fx, props } = ctx;
  const H = terrain.height;
  const CRAB_SCALE = 1.95;
  const PALETTE = [new THREE.Color('#e5482c'), new THREE.Color('#f06a2a'), new THREE.Color('#d8342f'), new THREE.Color('#e88a3a'), new THREE.Color('#b8452f')];
  const HERMIT_SHELLS = [new THREE.Color('#ffffff'), new THREE.Color('#ffd7c8'), new THREE.Color('#e9d3ff'), new THREE.Color('#d8f0ff')];

  function add(member) {
    const r = makeRng(member.seed || 1);
    const hermit = member.kind === 'hermit';
    const p = terrain.beachPoint(r, 0.8, 4.2);
    const c = {
      member, hermit, r,
      pos: p.clone(), yaw: r.range(0, TAU), facing: new V3(),
      state: 'idle', timer: r.range(0.5, 3), target: new V3().copy(p), food: null,
      phase: r.range(0, TAU), speed: 0, moveSign: 1, dig: 0, wave: 0, wavePhase: 0, biteT: 0,
      color: hermit ? PALETTE[4].clone().lerp(new THREE.Color('#d98a6a'), 0.5) : r.pick(PALETTE).clone(),
      shellColor: r.pick(HERMIT_SHELLS).clone(),
      radius: 0.5,
    };
    list.push(c);
    return c;
  }

  function pickWanderTarget(c, hungry) {
    if (hungry) {
      const a = Math.atan2(props.dockBase.z, props.dockBase.x) + c.r.range(-0.25, 0.25);
      terrain.pointAt(a, c.r.range(0.6, 3.2), c.target);
      return;
    }
    const a0 = Math.atan2(c.pos.z, c.pos.x);
    for (let k = 0; k < 8; k++) {
      terrain.pointAt(a0 + c.r.range(-0.45, 0.45), c.r.range(0.4, 4.6), c.target);
      if (!props.onDock(c.target.x, c.target.z)) break;
    }
  }

  function update(dt, t) {
    bodies.begin(); legs.begin(); claws.begin(); shells.begin();
    for (const c of list) {
      const m = c.member;
      const hungry = env.fullness(m) < 0.3;
      const scale = CRAB_SCALE * (c.hermit ? 0.85 : 1) * (0.85 + (m.size - 1) * 0.6);
      c.radius = 0.4 * scale;
      // ---- food ----
      if (c.state !== 'eat' && c.state !== 'food' && c.dig < 0.5) {
        let best = null, bd = 13;
        for (const f of ctx.fx.foods) {
          if (!f.land || f.state !== 'rest' || f.onDock) continue;
          const d = Math.hypot(f.pos.x - c.pos.x, f.pos.z - c.pos.z);
          if (d < bd) { bd = d; best = f; }
        }
        if (best) { c.food = best; c.state = 'food'; }
      }
      if (c.food && !ctx.fx.foods.includes(c.food)) { c.food = null; if (c.state === 'food' || c.state === 'eat') { c.state = 'idle'; c.timer = c.r.range(0.5, 1.5); } }
      // ---- state machine ----
      let moving = false;
      switch (c.state) {
        case 'idle':
          c.timer -= dt;
          if (c.timer <= 0) {
            const roll = c.r.next();
            if (roll < 0.62 || hungry) { pickWanderTarget(c, hungry); c.state = 'walk'; }
            else if (roll < 0.82) { c.state = 'wave'; c.timer = c.r.range(1.2, 2.4); }
            else { c.state = 'dig'; c.timer = c.r.range(5, 12); fx.sandPuff(c.pos, 8, 0.6); }
          }
          break;
        case 'wave':
          c.timer -= dt; c.wave = Math.min(1, c.wave + dt * 3);
          if (c.timer <= 0) { c.state = 'idle'; c.timer = c.r.range(0.5, 2.5); }
          break;
        case 'dig':
          c.dig = Math.min(1, c.dig + dt * 0.8);
          if (c.dig < 1 && Math.random() < dt * 8) fx.sandPuff(c.pos, 2, 0.45);
          if (c.dig >= 1) { c.timer -= dt; if (c.timer <= 0) { c.state = 'emerge'; fx.sandPuff(c.pos, 8, 0.6); } }
          break;
        case 'emerge':
          c.dig = Math.max(0, c.dig - dt * 1.2);
          if (c.dig <= 0) { c.state = 'idle'; c.timer = c.r.range(0.3, 1.2); }
          break;
        case 'walk':
        case 'food': {
          if (c.dig > 0) { c.dig = Math.max(0, c.dig - dt * 1.5); break; }
          const tgt = c.state === 'food' && c.food ? c.food.pos : c.target;
          _d.set(tgt.x - c.pos.x, 0, tgt.z - c.pos.z);
          const dist = _d.length();
          const reach = c.state === 'food' ? 0.32 * scale : 0.12;
          if (dist < reach) {
            if (c.state === 'food') { c.state = 'eat'; c.biteT = 0.3; }
            else { c.state = 'idle'; c.timer = c.r.range(0.8, 4); }
            break;
          }
          _d.divideScalar(dist);
          // face perpendicular to the motion (sideways scuttle), keep the smaller turn
          const fA = Math.atan2(-_d.z, _d.x); // yaw that puts local +X along the motion
          const fB = fA + Math.PI;
          const target = Math.abs(angleDelta(c.yaw, fA)) < Math.abs(angleDelta(c.yaw, fB)) ? fA : fB;
          c.yaw = dampAngle(c.yaw, target, 6, dt);
          c.moveSign = Math.sign(Math.cos(c.yaw) * _d.x - Math.sin(c.yaw) * _d.z) || 1;
          const burst = 0.65 + 0.35 * Math.sin(t * 2.3 + c.phase * 3);
          const sp = (c.state === 'food' ? 1.35 : hungry ? 1.0 : 0.75) * burst * (0.8 + 0.2 * scale);
          c.speed = damp(c.speed, sp, 6, dt);
          c.pos.x += _d.x * c.speed * dt; c.pos.z += _d.z * c.speed * dt;
          moving = true;
          break;
        }
        case 'eat': {
          const f = c.food;
          c.biteT -= dt; c.wave = Math.min(1, c.wave + dt * 4);
          if (!f) { c.state = 'idle'; break; }
          if (c.biteT <= 0) {
            c.biteT = 0.85;
            env.onEat(m, _p.copy(c.pos).add(_a.set(0, 0.35, 0)));
            if (fx.biteFood(f)) { c.food = null; c.state = 'wave'; c.timer = 1.5; }
          }
          break;
        }
      }
      if (!moving) c.speed = damp(c.speed, 0, 8, dt);
      if (c.state !== 'wave' && c.state !== 'eat') c.wave = Math.max(0, c.wave - dt * 2);
      c.phase += dt * (c.speed * 26 + (moving ? 2 : 0));
      // keep on the beach (never swim off)
      const e = terrain.coastE(c.pos.x, c.pos.z);
      if (e < 0.15) { const a = Math.atan2(c.pos.z, c.pos.x); terrain.pointAt(a, 0.15, _p); c.pos.x = _p.x; c.pos.z = _p.z; }
      c.pos.y = H(c.pos.x, c.pos.z);

      // ---- pose ----
      const bodyH = 0.105;
      const bob = moving ? Math.abs(Math.sin(c.phase)) * 0.012 : 0;
      const sink = c.dig * 0.19;
      _q.setFromAxisAngle(UP, c.yaw);
      _m.compose(_p.set(c.pos.x, c.pos.y - sink * scale, c.pos.z), _q, _s.setScalar(scale)); // crab root (ground level)
      // body
      _m2.makeTranslation(0, bodyH + bob, 0);
      _m3.multiplyMatrices(_m, _m2);
      bodies.add(_m3, c.hermit ? _col.copy(c.color).multiplyScalar(0.9) : c.color);
      if (c.hermit) {
        _m2.makeTranslation(0, bodyH + bob + 0.03, -0.03);
        _m3.multiplyMatrices(_m, _m2);
        _m2.makeScale(1.25, 1.25, 1.25);
        _m3.multiply(_m2);
        shells.add(_m3, c.shellColor);
      }
      // legs
      _side.set(0, 1, 0).applyQuaternion(_q);
      const legCol = _col.copy(c.color).multiplyScalar(1.1);
      for (let s = -1; s <= 1; s += 2) {
        for (let j = 0; j < 4; j++) {
          const zj = [0.075, 0.03, -0.02, -0.065][j];
          const spread = [0.6, 0.18, -0.22, -0.6][j];
          const lp = c.phase + (((j + (s > 0 ? 1 : 0)) % 2) ? Math.PI : 0) + j * 0.3;
          const lift = Math.max(0, Math.sin(lp)) * 0.045;
          const sweep = -Math.cos(lp) * 0.045 * c.moveSign * (c.speed > 0.05 ? 1 : 0);
          const dx = s, dz = spread;
          const dl = Math.hypot(dx, dz);
          _a.set(s * 0.14, bodyH + bob, zj);                                         // hip
          _b.set(s * 0.14 + dx / dl * 0.15, bodyH + bob + 0.085, zj + dz / dl * 0.15); // knee
          _c.set(s * 0.14 + dx / dl * 0.32 + sweep, lift + 0.005 + sink * 0.6, zj + dz / dl * 0.3);   // foot
          _a.applyMatrix4(_m); _b.applyMatrix4(_m); _c.applyMatrix4(_m);
          legs.add(segmentMatrix(_m3, _a, _b, 0.022 * scale, _side), legCol);
          legs.add(segmentMatrix(_m3, _b, _c, 0.015 * scale, _side), legCol);
        }
        // claws
        const cw = c.wave * (0.5 + 0.5 * Math.sin(t * 7 + s));
        const clawK = c.hermit ? 0.75 : 1;
        _a.set(s * 0.1, bodyH + bob, 0.1);
        _b.set(s * 0.19, bodyH + bob + 0.05 + cw * 0.12, 0.2 + cw * 0.04);
        _a.applyMatrix4(_m); _b.applyMatrix4(_m);
        legs.add(segmentMatrix(_m3, _a, _b, 0.03 * scale * clawK, _side), legCol);
        // palm + finger
        _e.set(-0.25 - cw * 0.5, -s * 0.5, 0);
        _q2.setFromEuler(_e).premultiply(_q);
        _p.set(s * 0.17, bodyH + bob + 0.06 + cw * 0.13, 0.27 + cw * 0.04).multiplyScalar(1).applyMatrix4(_m);
        _m3.compose(_p, _q2, _s.set(0.06, 0.045, 0.09).multiplyScalar(scale * clawK));
        claws.add(_m3, c.color);
        const open = 0.25 + 0.25 * Math.sin(t * (c.state === 'eat' ? 12 : 3) + s);
        _e.set(-0.25 - cw * 0.5 + open, -s * 0.5 - s * 0.25, 0);
        _q2.setFromEuler(_e).premultiply(_q);
        _p.set(s * 0.13, bodyH + bob + 0.07 + cw * 0.13, 0.3 + cw * 0.04).applyMatrix4(_m);
        _m3.compose(_p, _q2, _s.set(0.025, 0.022, 0.075).multiplyScalar(scale * clawK));
        claws.add(_m3, _col.copy(c.color).multiplyScalar(1.15));
      }
    }
    bodies.end(); legs.end(); claws.end(); shells.end();
  }

  return {
    group, list, add, update,
    remove(member) { const i = list.findIndex(c => c.member === member); if (i >= 0) list.splice(i, 1); },
    dispose() { Object.values(geos).forEach(g => g.dispose()); bodyMat.dispose(); legMat.dispose(); shellMat.dispose(); },
  };
}

/* ================================================================== */
/* Birds (gulls from Stork.glb, flamingos)                             */
/* ================================================================== */
function retargetClip(clip, name) {
  const c = clip.clone();
  for (const tr of c.tracks) tr.name = name + tr.name.slice(tr.name.indexOf('.'));
  return c;
}

/** Recolour the stork into a gull: white body, pale grey wings, black tips, yellow bill; shorter legs/neck. */
function makeGullGeometry(src) {
  const g = src.clone();
  const p = g.attributes.position, c = g.attributes.color;
  const cnt = p.count;
  const isRed = [], isBlack = [];
  for (let i = 0; i < cnt; i++) {
    const r = c.getX(i), gg = c.getY(i), b = c.getZ(i);
    isRed.push(r > 0.5 && gg < 0.3);
    isBlack.push(r < 0.1 && gg < 0.1 && b < 0.1);
  }
  for (let i = 0; i < cnt; i++) {
    const x = Math.abs(p.getX(i)), y = p.getY(i), z = p.getZ(i);
    if (isRed[i]) c.setXYZ(i, 0.98, 0.72, 0.12);
    else if (isBlack[i]) { if (x > 64) c.setXYZ(i, 0.03, 0.03, 0.035); else c.setXYZ(i, 0.62, 0.66, 0.72); }
    else if (x > 14) c.setXYZ(i, 0.72, 0.76, 0.82);
    else c.setXYZ(i, 0.98, 0.98, 0.98);
    // tuck the long stork legs and shorten the neck so it reads as a gull
    let nz = z;
    if (z < -30) nz = -30 + (z + 30) * 0.22;
    if (z > 38) nz = 38 + (z - 38) * 0.5;
    p.setZ(i, nz);
    if (z > 38) p.setY(i, y * 0.85);
  }
  const morph = g.morphAttributes.position || [];
  for (const m of morph) {
    for (let i = 0; i < cnt; i++) {
      const z = src.attributes.position.getZ(i);
      if (z < -30) m.setXYZ(i, m.getX(i) * 0.3, m.getY(i) * 0.3, m.getZ(i) * 0.3);
    }
  }
  c.needsUpdate = true; p.needsUpdate = true;
  g.computeBoundingSphere();
  return g;
}

function createBirds(env, ctx, storkGltf, flamingoGltf) {
  const group = new THREE.Group();
  const { terrain, props, fx } = ctx;
  const H = terrain.height;
  const disposables = [];
  // ---- gull template ----
  const sMesh = storkGltf.scene.getObjectByProperty('isMesh', true);
  const gullGeo = makeGullGeometry(sMesh.geometry);
  const gullMat = sMesh.material.clone();
  gullMat.vertexColors = true;
  gullMat.roughness = 0.75;
  gullMat.envMapIntensity = 0.9;
  disposables.push(gullGeo, gullMat);
  const gullClip = retargetClip(storkGltf.animations[0], 'bird');
  const GULL_SCALE = 0.0095;
  const gulls = [];
  const thermals = [];
  const trng = makeRng(env.seed ^ 0x51ab);
  for (let i = 0; i < 3; i++) thermals.push({ x: trng.range(-14, 14), z: trng.range(-14, 14), r: trng.range(9, 17), h: trng.range(9, 17), dir: trng.sign(), drift: trng.range(0, TAU) });

  function addGull(member, seed) {
    const r = makeRng(seed);
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(gullGeo, gullMat);
    mesh.name = 'bird';
    mesh.morphTargetInfluences = sMesh.morphTargetInfluences ? sMesh.morphTargetInfluences.slice() : [];
    mesh.morphTargetDictionary = sMesh.morphTargetDictionary;
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    root.add(mesh);
    root.scale.setScalar(GULL_SCALE * (member ? 0.9 + (member.size - 1) * 0.4 : 0.9));
    group.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(gullClip);
    action.play();
    action.time = r.range(0, 1.2);
    const th = r.pick(thermals);
    const a = r.range(0, TAU);
    const gl = {
      member, r, root, mesh, mixer, action,
      pos: new V3(th.x + Math.cos(a) * th.r, th.h, th.z + Math.sin(a) * th.r),
      vel: new V3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(6 * th.dir),
      thermal: th, ang: a, state: 'soar', timer: r.range(8, 25), flapT: r.range(0, 3), gliding: false,
      perch: null, food: null, roll: 0, biteT: 0, fold: 0, up: new V3(0, 1, 0), fwd: new V3(1, 0, 0), radius: 0.9,
      speed: r.range(5.5, 7),
    };
    gulls.push(gl);
    return gl;
  }

  const perchTaken = new Set();
  function freePerch(gl, hungry) {
    const list = props.perches;
    const opts = list.filter(p => !perchTaken.has(p));
    if (!opts.length) return null;
    // hungry gulls prefer the dock bollards (first four perches)
    const pool = hungry ? opts.filter(p => list.indexOf(p) < 4) : opts;
    return gl.r.pick(pool.length ? pool : opts);
  }
  // rocks also make good perches
  const rockPerches = ctx.flora.rockSites
    .filter(rk => rk.s > 0.6 && rk.y + rk.s * 0.5 > 0.2)
    .slice(0, 6)
    .map(rk => new V3(rk.x, rk.y + rk.s * 0.55 * rk.ys, rk.z));
  props.perches.push(...rockPerches);

  const _want = new V3(), _acc = new V3(), _prevVel = new V3(), _x = new V3(), _y = new V3(), _z = new V3();
  function updateGull(gl, dt, t) {
    const m = gl.member;
    const hungry = m ? env.fullness(m) < 0.3 : false;
    gl.mixer.update(dt);
    _prevVel.copy(gl.vel);
    // pick up food
    if (!gl.food && (gl.state === 'soar' || gl.state === 'perched') && fx.foods.length) {
      let best = null, bd = 1e9;
      for (const f of fx.foods) {
        if (f.state === 'fall' || f.claimed > 1) continue;
        const d = Math.hypot(f.pos.x - gl.pos.x, f.pos.z - gl.pos.z);
        if (d < bd) { bd = d; best = f; }
      }
      if (best && gl.r.next() < dt * (hungry ? 2.5 : 0.9)) {
        gl.food = best; best.claimed++;
        if (gl.perch) { perchTaken.delete(gl.perch); gl.perch = null; }
        gl.state = 'dive';
      }
    }
    if (gl.food && !fx.foods.includes(gl.food)) { gl.food = null; if (gl.state === 'dive' || gl.state === 'peck') { gl.state = 'takeoff'; gl.timer = 1.2; } }

    let flap = false, fold = 0;
    switch (gl.state) {
      case 'soar': {
        const th = gl.thermal;
        gl.ang += dt * (gl.speed / th.r) * th.dir;
        _want.set(th.x + Math.cos(gl.ang + th.dir * 0.4) * th.r, th.h + Math.sin(t * 0.2 + gl.r.next() * 0.0) * 1.5, th.z + Math.sin(gl.ang + th.dir * 0.4) * th.r);
        _want.sub(gl.pos);
        const d = _want.length();
        _want.multiplyScalar(gl.speed / Math.max(d, 0.001));
        gl.vel.lerp(_want, 1 - Math.exp(-1.3 * dt));
        gl.flapT -= dt;
        if (gl.flapT < 0) { gl.gliding = !gl.gliding; gl.flapT = gl.gliding ? gl.r.range(2.5, 6) : gl.r.range(0.8, 1.8); }
        flap = !gl.gliding || gl.vel.y > 0.4;
        gl.timer -= dt;
        if (gl.timer <= 0) {
          const roll = gl.r.next();
          if (roll < (hungry ? 0.8 : 0.45)) {
            const p = freePerch(gl, hungry);
            if (p) { gl.perch = p; perchTaken.add(p); gl.state = 'toPerch'; }
          } else if (roll < 0.75) { gl.thermal = gl.r.pick(thermals); }
          gl.timer = gl.r.range(10, 26);
        }
        break;
      }
      case 'toPerch':
      case 'dive': {
        const tgt = gl.state === 'dive' ? gl.food.pos : gl.perch;
        _want.subVectors(tgt, gl.pos);
        const hd = Math.hypot(_want.x, _want.z);
        const above = gl.state === 'dive' ? 0.25 : 0.32;
        // approach from above, then descend
        const ty = tgt.y + above + Math.min(hd * 0.45, 8);
        _want.y = ty - gl.pos.y;
        const sp = clamp(hd * 0.8 + 1.2, 1.2, gl.state === 'dive' ? 9 : 7);
        const len = _want.length();
        _want.multiplyScalar(sp / Math.max(len, 0.001));
        gl.vel.lerp(_want, 1 - Math.exp(-2.2 * dt));
        flap = hd < 4 || gl.vel.y > 0.2;
        if (hd < 0.35 && Math.abs(gl.pos.y - (tgt.y + above)) < 0.4) {
          if (gl.state === 'dive') { gl.state = 'peck'; gl.biteT = 0.5; gl.timer = 6; }
          else { gl.state = 'perched'; gl.timer = gl.r.range(10, 28) * (hungry ? 2 : 1); gl.faceYaw = gl.r.range(0, TAU); }
          gl.vel.set(0, 0, 0);
        }
        break;
      }
      case 'perched':
      case 'peck': {
        const tgt = gl.state === 'peck' ? gl.food.pos : gl.perch;
        const above = gl.state === 'peck' ? 0.25 : 0.32;
        gl.pos.lerp(_p.set(tgt.x, tgt.y + above, tgt.z), 1 - Math.exp(-6 * dt));
        gl.vel.set(0, 0, 0);
        fold = 1;
        if (gl.state === 'peck') {
          gl.biteT -= dt;
          if (gl.biteT <= 0) {
            gl.biteT = 0.9;
            env.onEat(m || null, _p.copy(gl.pos).add(_a.set(0, 0.4, 0)));
            if (gl.food && fx.biteFood(gl.food)) gl.food = null;
            if (gl.food && gl.r.chance(0.35)) { gl.food.claimed = Math.max(0, gl.food.claimed - 1); gl.food = null; }
            if (!gl.food) { gl.state = 'takeoff'; gl.timer = 1.0; }
          }
        } else {
          gl.timer -= dt;
          if (gl.timer <= 0) { perchTaken.delete(gl.perch); gl.perch = null; gl.state = 'takeoff'; gl.timer = 1.2; }
        }
        break;
      }
      case 'takeoff': {
        if (gl.vel.lengthSq() < 0.01) { const a = gl.r.range(0, TAU); gl.vel.set(Math.cos(a) * 2, 2.5, Math.sin(a) * 2); }
        _want.copy(gl.vel).setY(0).normalize().multiplyScalar(5).setY(3);
        gl.vel.lerp(_want, 1 - Math.exp(-2 * dt));
        flap = true;
        gl.timer -= dt;
        if (gl.timer <= 0) { gl.state = 'soar'; gl.thermal = gl.r.pick(thermals); gl.ang = Math.atan2(gl.pos.z - gl.thermal.z, gl.pos.x - gl.thermal.x); gl.timer = gl.r.range(10, 20); }
        break;
      }
    }
    gl.pos.addScaledVector(gl.vel, dt);
    // don't clip through the island
    const ground = Math.max(H(gl.pos.x, gl.pos.z), 0) + (fold ? 0 : 1.2);
    if (gl.state !== 'perched' && gl.state !== 'peck' && gl.pos.y < ground && gl.state !== 'dive' && gl.state !== 'toPerch') gl.pos.y = damp(gl.pos.y, ground, 4, dt);
    // ---- animation ----
    gl.fold = damp(gl.fold, fold, 6, dt);
    const act = gl.action;
    if (flap && fold <= 0.5) { act.paused = false; act.timeScale = gl.state === 'dive' || gl.state === 'takeoff' ? 1.7 : 1.15; }
    else if (!act.paused) {
      // glide or land: finish the current wing beat and settle on the wings-level frame (landing used to
      // snap the wings to that frame mid-beat)
      if (fold > 0.5) act.timeScale = 2.2;
      const ph = act.time % gullClip.duration;
      if (ph < 0.06 || ph > gullClip.duration - 0.04) { act.paused = true; act.time = 0; }
    }
    // ---- orientation (bank into turns) ----
    _acc.subVectors(gl.vel, _prevVel).divideScalar(Math.max(dt, 1e-3));
    const sp = gl.vel.length();
    if (sp > 0.3) {
      _z.copy(gl.vel).divideScalar(sp);
      _z.y = clamp(_z.y, -0.6, 0.6);
      _z.normalize();
      gl.fwd.lerp(_z, 1 - Math.exp(-6 * dt)).normalize();
      const lat = _x.crossVectors(UP, gl.fwd).normalize().dot(_acc);
      gl.roll = damp(gl.roll, clamp(-lat * 0.12, -0.7, 0.7), 3, dt);
    } else {
      if (gl.faceYaw !== undefined && gl.state === 'perched') _z.set(Math.cos(gl.faceYaw), 0, Math.sin(gl.faceYaw));
      else _z.copy(gl.fwd).setY(0);
      if (_z.lengthSq() < 1e-4) _z.set(1, 0, 0);
      gl.fwd.lerp(_z.normalize(), 1 - Math.exp(-3 * dt)).normalize();
      gl.roll = damp(gl.roll, 0, 4, dt);
    }
    _z.copy(gl.fwd);
    if (gl.fold > 0.01) { _z.y += gl.fold * 0.45; _z.normalize(); } // perched: chest up
    _y.copy(UP).applyAxisAngle(_z, gl.roll);
    _x.crossVectors(_y, _z).normalize();
    _y.crossVectors(_z, _x).normalize();
    _m.makeBasis(_x, _y, _z);
    gl.root.quaternion.setFromRotationMatrix(_m);
    const base = GULL_SCALE * (m ? 0.9 + (m.size - 1) * 0.4 : 0.85);
    gl.root.scale.set(base * lerp(1, 0.3, gl.fold), base, base * lerp(1, 0.9, gl.fold));
    gl.root.position.copy(gl.pos);
    if (gl.fold > 0.5) gl.root.position.y += 0.05;
  }

  // ---- flamingos at dusk ----
  const fMesh = flamingoGltf.scene.getObjectByProperty('isMesh', true);
  const fClip = retargetClip(flamingoGltf.animations[0], 'bird');
  const flamMat = fMesh.material.clone();
  flamMat.vertexColors = true; flamMat.roughness = 0.7;
  disposables.push(flamMat);
  const flock = { active: false, t: 0, cooldown: 0, birds: [], origin: new V3(), dir: new V3(), y: 22 };
  const NF = 7;
  for (let i = 0; i < NF; i++) {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(fMesh.geometry, flamMat);
    mesh.name = 'bird';
    mesh.morphTargetInfluences = fMesh.morphTargetInfluences ? fMesh.morphTargetInfluences.slice() : [];
    mesh.morphTargetDictionary = fMesh.morphTargetDictionary;
    mesh.frustumCulled = false;
    mesh.castShadow = true;
    root.add(mesh);
    root.scale.setScalar(0.012 * 0.002);
    root.visible = false;
    group.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(fClip);
    action.play();
    action.time = i * 0.17;
    action.timeScale = 0.9 + (i % 3) * 0.06;
    const side = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
    flock.birds.push({ root, mixer, offset: new V3(side * 2.1, Math.sin(i * 1.7) * 0.6, -Math.abs(side) * 2.6) });
  }
  const frng = makeRng(env.seed ^ 0xf1a);
  // A pass starts and ends far out over the sea and the birds grow in / shrink out over the first and
  // last few seconds, so they never pop into or out of view (they used to appear 34 m from the island,
  // well inside the picture, and vanish mid-air the minute dusk ended).
  const FLOCK_R = 72, FLOCK_LEN = FLOCK_R * 2 + 10, FLOCK_SCALE = 0.012;
  function updateFlock(dt, t, dusk) {
    if (!flock.active) {
      flock.cooldown -= dt;
      if (dusk > 0.2 && flock.cooldown <= 0) {
        flock.active = true; flock.t = 0;
        const a = frng.range(0, TAU);
        const off = frng.range(-10, 10);
        flock.dir.set(Math.cos(a), 0, Math.sin(a));
        flock.origin.set(-Math.cos(a) * FLOCK_R - Math.sin(a) * off, frng.range(7, 11), -Math.sin(a) * FLOCK_R + Math.cos(a) * off);
      }
      return;
    }
    // a pass that has started always finishes, even if dusk ends meanwhile
    flock.t += dt;
    const speed = 7.5;
    const dist = flock.t * speed;
    const yaw = Math.atan2(flock.dir.x, flock.dir.z);
    const grow = smoothstep(0, 3, flock.t) * (1 - smoothstep(FLOCK_LEN - 24, FLOCK_LEN, dist));
    for (let i = 0; i < flock.birds.length; i++) {
      const b = flock.birds[i];
      b.root.visible = grow > 0.002; // (a zero scale would give the normals NaN)
      b.root.scale.setScalar(FLOCK_SCALE * Math.max(grow, 0.002));
      b.mixer.update(dt);
      _a.copy(b.offset).applyAxisAngle(UP, yaw);
      b.root.position.copy(flock.origin).addScaledVector(flock.dir, dist).add(_a);
      b.root.position.y += Math.sin(t * 0.9 + i) * 0.25;
      b.root.rotation.set(0, yaw, Math.sin(t * 0.7 + i) * 0.06);
    }
    if (dist >= FLOCK_LEN) {
      flock.active = false; flock.cooldown = frng.range(25, 55);
      for (const b of flock.birds) b.root.visible = false;
    }
  }

  return {
    group, gulls, addGull, flock,
    update(dt, t, { dusk }) {
      for (const g of gulls) updateGull(g, dt, t);
      updateFlock(dt, t, dusk);
    },
    remove(member) {
      const i = gulls.findIndex(g => g.member === member);
      if (i >= 0) { const g = gulls[i]; group.remove(g.root); g.mixer.stopAllAction(); g.mixer.uncacheRoot(g.root); if (g.perch) perchTaken.delete(g.perch); gulls.splice(i, 1); }
    },
    dispose() {
      for (const g of gulls) { g.mixer.stopAllAction(); g.mixer.uncacheRoot(g.root); }
      for (const b of flock.birds) { b.mixer.stopAllAction(); b.mixer.uncacheRoot(b.root); }
      disposables.forEach(d => d.dispose());
    },
  };
}

/* ================================================================== */
/* Sea turtles                                                         */
/* ================================================================== */
function createTurtles(env, ctx, max) {
  const { terrain, fx, props } = ctx;
  const H = terrain.height;
  const shellTex = turtleShellTexture(env.seed ^ 0x7e);
  const shellGeo = new THREE.SphereGeometry(0.5, 26, 14);
  {
    shellGeo.scale(0.72, 0.26, 0.94);
    const p = shellGeo.attributes.position, uv = shellGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      let y = p.getY(i);
      if (y < 0) y *= 0.4;
      // slight keel ridge and a pointed rear
      const z = p.getZ(i), x = p.getX(i);
      y += Math.max(0, 0.03 - Math.abs(x) * 0.12) * (y > 0 ? 1 : 0);
      p.setXYZ(i, x * (z < -0.2 ? 1 - (-0.2 - z) * 0.9 : 1), y, z);
      uv.setXY(i, x / 0.72 + 0.5, z / 0.94 + 0.5);
    }
    shellGeo.computeVertexNormals();
  }
  const skin = new THREE.Color('#8a9566');
  const headParts = [];
  {
    const h = new THREE.SphereGeometry(0.1, 14, 10); h.scale(0.95, 0.8, 1.35); headParts.push(colorize(h, skin.r, skin.g, skin.b));
    const neck = new THREE.CylinderGeometry(0.075, 0.09, 0.14, 10); neck.rotateX(Math.PI / 2); neck.translate(0, -0.01, -0.1); headParts.push(colorize(neck, skin.r * 0.9, skin.g * 0.9, skin.b * 0.85));
    for (const s of [-1, 1]) { const e = new THREE.SphereGeometry(0.02, 8, 6); e.translate(s * 0.07, 0.035, 0.055); headParts.push(colorize(e, 0.02, 0.02, 0.02)); }
    const beak = new THREE.SphereGeometry(0.04, 8, 6); beak.scale(1.1, 0.7, 1); beak.translate(0, -0.02, 0.12); headParts.push(colorize(beak, 0.75, 0.7, 0.5));
  }
  const headGeo = mergeGeometries(headParts);
  headParts.forEach(g => g.dispose());
  const flipF = new THREE.SphereGeometry(0.5, 14, 8);
  flipF.scale(0.44, 0.045, 0.15); flipF.translate(0.21, 0, 0);
  {
    const p = flipF.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) - Math.pow(p.getX(i), 2) * 0.9 - p.getX(i) * 0.1);
    flipF.computeVertexNormals();
  }
  const flipR = new THREE.SphereGeometry(0.5, 10, 6);
  flipR.scale(0.18, 0.035, 0.14); flipR.translate(0.08, 0, -0.03);
  const shellMat = new THREE.MeshStandardMaterial({ map: shellTex, roughness: 0.42, envMapIntensity: 0.9 });
  const skinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const flipMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.6, side: THREE.DoubleSide });
  for (const m of [shellMat, skinMat, flipMat]) addUnderwater(m, { key: 'turtle' });
  const shells = new Batch(shellGeo, shellMat, max, { layer: LAYER_NO_REFLECT });
  const heads = new Batch(headGeo, skinMat, max, { layer: LAYER_NO_REFLECT });
  const fronts = new Batch(flipF, flipMat, max * 2, { layer: LAYER_NO_REFLECT });
  const rears = new Batch(flipR, flipMat, max * 2, { layer: LAYER_NO_REFLECT });
  const group = new THREE.Group();
  group.add(shells.mesh, heads.mesh, fronts.mesh, rears.mesh);
  const list = [];

  function lagoonTarget(tr, out, hungry) {
    if (hungry) {
      out.copy(props.dockEnd).addScaledVector(props.dockPerp, tr.r.range(-3.5, 3.5)).addScaledVector(props.dockDir, tr.r.range(-1, 3));
      return out;
    }
    for (let k = 0; k < 16; k++) {
      const a = Math.atan2(tr.pos.z, tr.pos.x) + tr.r.range(-0.7, 0.7);
      const lw = terrain.lagoonW(a);
      terrain.pointAt(a, -tr.r.range(2.5, Math.max(3, lw - 0.8)), out);
      if (out.y < -0.42 && out.y > -1.8 && !props.onDock(out.x, out.z)) return out;
    }
    return out;
  }
  function add(member) {
    const r = makeRng(member.seed || 7);
    const a = r.range(0, TAU);
    const p = terrain.pointAt(a, -r.range(3, Math.max(3.2, terrain.lagoonW(a) - 1)));
    const tr = {
      member, r, pos: new V3(p.x, -0.45, p.z), vel: new V3(), yaw: r.range(0, TAU), pitch: 0, roll: 0,
      phase: r.range(0, TAU), target: new V3(), state: 'swim', timer: r.range(20, 45), food: null, biteT: 0, surface: 0, radius: 0.7,
    };
    lagoonTarget(tr, tr.target, false);
    list.push(tr);
    return tr;
  }
  function update(dt, t) {
    shells.begin(); heads.begin(); fronts.begin(); rears.begin();
    for (const tr of list) {
      const m = tr.member;
      const hungry = env.fullness(m) < 0.3;
      const scale = 1.2 * (0.85 + (m.size - 1) * 0.5);
      tr.radius = 0.6 * scale;
      // food on the water
      if (!tr.food) {
        let best = null, bd = 22;
        for (const f of fx.foods) {
          if (f.state !== 'float') continue;
          const d = Math.hypot(f.pos.x - tr.pos.x, f.pos.z - tr.pos.z);
          if (d < bd && H(f.pos.x, f.pos.z) < -0.35) { bd = d; best = f; }
        }
        if (best) { tr.food = best; tr.state = 'food'; }
      }
      if (tr.food && !fx.foods.includes(tr.food)) { tr.food = null; tr.state = 'swim'; lagoonTarget(tr, tr.target, hungry); }
      let tgt = tr.target, speed = 0.75, wantY;
      const seabed = H(tr.pos.x, tr.pos.z);
      const cruiseY = clamp(seabed + 0.3, -0.55, -0.22);
      wantY = cruiseY;
      switch (tr.state) {
        case 'swim': {
          tr.timer -= dt;
          if (Math.hypot(tgt.x - tr.pos.x, tgt.z - tr.pos.z) < 1.2) lagoonTarget(tr, tr.target, hungry);
          if (tr.timer <= 0) { tr.state = 'breathe'; tr.timer = 3.2; }
          if (hungry) wantY = -0.12;
          break;
        }
        case 'breathe': {
          wantY = -0.08; speed = 0.35;
          if (tr.pos.y > -0.15) {
            tr.timer -= dt;
            if (tr.timer > 3.0 && !tr.rippled) { fx.ripple(tr.pos.x, tr.pos.z, 1.3, 2, 0.5); tr.rippled = true; }
          }
          if (tr.timer <= 0) { tr.state = 'swim'; tr.rippled = false; tr.timer = tr.r.range(25, 55); }
          break;
        }
        case 'food': {
          tgt = tr.food.pos; speed = 1.35;
          const d = Math.hypot(tgt.x - tr.pos.x, tgt.z - tr.pos.z);
          if (d < 2.5) wantY = -0.07;
          if (d < 0.55 * scale) {
            speed = 0.05;
            tr.biteT -= dt;
            if (tr.biteT <= 0) {
              tr.biteT = 1.25;
              env.onEat(m, _p.copy(tr.pos).add(_a.set(0, 0.4, 0)));
              if (fx.biteFood(tr.food)) { tr.food = null; tr.state = 'swim'; tr.timer = tr.r.range(15, 30); lagoonTarget(tr, tr.target, hungry); }
            }
          }
          break;
        }
      }
      // steering
      _d.set(tgt.x - tr.pos.x, 0, tgt.z - tr.pos.z);
      const dist = _d.length();
      const desiredYaw = Math.atan2(_d.x, _d.z);
      const turn = angleDelta(tr.yaw, desiredYaw);
      tr.yaw += clamp(turn, -0.9 * dt, 0.9 * dt);
      const sp = speed * clamp(dist / 1.5, 0.15, 1) * (0.8 + 0.2 * Math.sin(tr.phase));
      tr.vel.set(Math.sin(tr.yaw) * sp, 0, Math.cos(tr.yaw) * sp);
      tr.pos.addScaledVector(tr.vel, dt);
      // keep in water
      const sb = H(tr.pos.x, tr.pos.z);
      if (sb > -0.45) { tr.pos.addScaledVector(_d.set(tr.pos.x, 0, tr.pos.z).normalize(), dt * 0.8); }
      wantY = Math.max(Math.min(wantY, -0.06), sb + 0.25);
      const vy = (wantY - tr.pos.y);
      tr.pos.y = damp(tr.pos.y, wantY, 1.2, dt);
      tr.pitch = damp(tr.pitch, clamp(-vy * 0.9, -0.5, 0.5) + (tr.state === 'breathe' ? -0.15 : 0), 3, dt);
      tr.roll = damp(tr.roll, clamp(-turn * 0.6, -0.35, 0.35), 2, dt);
      tr.phase += dt * (1.6 + sp * 1.4);
      // pose
      const stroke = Math.sin(tr.phase);
      _e.set(tr.pitch + Math.sin(tr.phase * 2) * 0.03, tr.yaw, tr.roll, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p.set(tr.pos.x, tr.pos.y + stroke * 0.02, tr.pos.z), _q, _s.setScalar(scale));
      shells.add(_m);
      // head
      _e.set(0.1 * Math.sin(tr.phase * 0.5) - (tr.state === 'breathe' || tr.state === 'food' ? 0.25 : 0), 0.18 * Math.sin(t * 0.4 + tr.phase * 0.2), 0);
      _q2.setFromEuler(_e);
      _m2.compose(_p.set(0, 0.0, 0.53), _q2, _s.setScalar(1));
      _m3.multiplyMatrices(_m, _m2);
      heads.add(_m3);
      for (let s = -1; s <= 1; s += 2) {
        // left limbs = right limbs rotated half a turn about the body axis (no negative scale)
        _e.set(0, s * (0.35 * Math.cos(tr.phase) - 0.25), s * (0.5 * stroke + 0.05), 'YXZ');
        _q2.setFromEuler(_e);
        if (s < 0) _q2.multiply(Q_ZPI);
        _m2.compose(_p.set(s * 0.25, -0.02, 0.2), _q2, _s.set(1, 1, 1));
        _m3.multiplyMatrices(_m, _m2);
        fronts.add(_m3);
        _e.set(0, s * (0.6 + 0.2 * Math.sin(tr.phase + 1.2)), s * 0.15 * Math.sin(tr.phase + 1.2), 'YXZ');
        _q2.setFromEuler(_e);
        if (s < 0) _q2.multiply(Q_ZPI);
        _m2.compose(_p.set(s * 0.2, -0.04, -0.34), _q2, _s.set(1, 1, 1));
        _m3.multiplyMatrices(_m, _m2);
        rears.add(_m3);
      }
    }
    shells.end(); heads.end(); fronts.end(); rears.end();
  }
  return {
    group, list, add, update,
    remove(member) { const i = list.findIndex(x => x.member === member); if (i >= 0) list.splice(i, 1); },
    dispose() { [shellTex, shellGeo, headGeo, flipF, flipR, shellMat, skinMat, flipMat].forEach(d => d.dispose()); },
  };
}

/* ================================================================== */
/* Dolphins                                                            */
/* ================================================================== */
function buildDolphinGeometry() {
  const L = 2.2, NS = 40, NR = 16;
  const ctrl = [[0, 0.03], [0.1, 0.05], [0.25, 0.1], [0.42, 0.19], [0.58, 0.235], [0.72, 0.225], [0.82, 0.18], [0.88, 0.13], [0.915, 0.075], [0.96, 0.05], [1.0, 0.02]];
  const rad = s => {
    let i = 0; while (i < ctrl.length - 2 && s > ctrl[i + 1][0]) i++;
    const [s0, r0] = ctrl[i], [s1, r1] = ctrl[i + 1];
    const k = smoothstep(s0, s1, s);
    return lerp(r0, r1, k);
  };
  const pos = [], col = [], idx = [];
  const dark = new THREE.Color('#2f3c48'), mid = new THREE.Color('#5f6f7c'), belly = new THREE.Color('#d6d8dc');
  const c = new THREE.Color();
  for (let i = 0; i <= NS; i++) {
    const s = i / NS;
    const x = (s - 0.5) * L;
    const r = rad(s);
    const yc = 0.025 * Math.sin(Math.PI * s) - 0.04 * smoothstep(0.88, 1.0, s) + 0.03 * Math.exp(-Math.pow((s - 0.82) / 0.05, 2));
    for (let j = 0; j <= NR; j++) {
      const a = j / NR * TAU;
      const sy = Math.sin(a), cz = Math.cos(a);
      pos.push(x, yc + sy * r * 1.12, cz * r);
      const h = sy + 0.15 * Math.sin(s * 14);
      c.copy(belly).lerp(mid, smoothstep(-0.55, -0.1, h)).lerp(dark, smoothstep(0.15, 0.6, h));
      if (s > 0.83 && s < 0.86 && Math.abs(cz) > 0.75 && sy > 0.05 && sy < 0.45) c.setRGB(0.02, 0.02, 0.03); // eye
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < NR; j++) {
    const a = i * (NR + 1) + j, b = a + 1, cc = a + NR + 1, d = cc + 1;
    idx.push(a, b, cc, b, d, cc);
  }
  const body = new THREE.BufferGeometry();
  body.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  body.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  body.setIndex(idx);
  body.computeVertexNormals();
  const fin = (shape, depth, rot, tr, colr) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: depth * 0.4, bevelSegments: 1, curveSegments: 6 });
    g.translate(0, 0, -depth / 2);
    if (rot) rot(g);
    g.translate(tr[0], tr[1], tr[2]);
    g.deleteAttribute('uv');
    return colorize(g.toNonIndexed ? g : g, colr.r, colr.g, colr.b);
  };
  // dorsal fin (XY plane)
  const ds = new THREE.Shape();
  ds.moveTo(0.18, 0); ds.quadraticCurveTo(0.05, 0.1, -0.12, 0.3); ds.quadraticCurveTo(-0.1, 0.12, -0.2, 0); ds.lineTo(0.18, 0);
  const dorsal = fin(ds, 0.035, null, [0.05, 0.2, 0], dark);
  // flukes (XZ plane)
  const fs = new THREE.Shape();
  fs.moveTo(0.02, 0); fs.quadraticCurveTo(-0.08, 0.16, -0.24, 0.33); fs.quadraticCurveTo(-0.16, 0.12, -0.22, 0.02); fs.lineTo(-0.2, 0);
  fs.lineTo(-0.22, -0.02); fs.quadraticCurveTo(-0.16, -0.12, -0.24, -0.33); fs.quadraticCurveTo(-0.08, -0.16, 0.02, 0);
  const fluke = fin(fs, 0.03, g => g.rotateX(Math.PI / 2), [-1.08, 0.0, 0], dark);
  // pectoral fins
  const ps = new THREE.Shape();
  ps.moveTo(0.06, 0); ps.quadraticCurveTo(0.0, 0.05, -0.16, 0.2); ps.quadraticCurveTo(-0.08, 0.02, -0.06, 0); ps.lineTo(0.06, 0);
  const pects = [-1, 1].map(s => fin(ps, 0.025, g => { g.rotateX(Math.PI / 2 * s); g.rotateX(s * -0.6); }, [0.45, -0.12, s * 0.17], mid));
  const parts = [body, dorsal, fluke, ...pects].map(g => { const n = g.index ? g.toNonIndexed() : g; return n; });
  const merged = mergeGeometries(parts);
  parts.forEach(g => g.dispose());
  return merged;
}

function createDolphins(env, ctx, max) {
  const { terrain, fx, props } = ctx;
  const H = terrain.height;
  const geo = buildDolphinGeometry();
  const aDol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  aDol.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aDol', aDol);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.0, envMapIntensity: 0.55 });
  const bend = {
    key: 'dolphinBend',
    vertexHeader: 'attribute vec4 aDol;',
    vertex: {
      '#include <begin_vertex>': /* glsl */`$&
        {
          float xn = (1.1 - position.x) / 2.2;
          float w = smoothstep(0.3, 1.05, xn);
          float wave = sin(aDol.x - xn * 2.4) * aDol.y;
          transformed.y += wave * w * w * 0.62;
          transformed.z += aDol.z * xn * xn * 0.45;
        }`,
    },
  };
  patchMaterial(mat, bend);
  addUnderwater(mat, { key: 'dolphin' });
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  patchMaterial(depthMat, bend);
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.customDepthMaterial = depthMat;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.count = 0;
  const list = [];
  const pod = { ang: makeRng(env.seed ^ 0xd01).range(0, TAU), R: terrain.R0 + 19, dir: 1 };
  function add(member) {
    const r = makeRng(member ? member.seed : 99);
    const k = list.length;
    const d = {
      member, r, slot: k,
      pos: new V3(Math.cos(pod.ang) * pod.R, -0.8, Math.sin(pod.ang) * pod.R), vel: new V3(), yaw: 0, pitch: 0, roll: 0,
      phase: r.range(0, TAU), pPhase: r.range(0, TAU), pRate: r.range(0.75, 1.0), state: 'pod', leapT: r.range(6, 22), lv: new V3(), spin: 0,
      food: null, biteT: 0, bites: 0, turn: 0, radius: 1.2, wasAbove: false,
    };
    list.push(d);
    return d;
  }
  const _tgt = new V3();
  function update(dt, t) {
    pod.ang += dt * 2.4 / pod.R * pod.dir;
    const wob = Math.sin(t * 0.05) * 5;
    const n = list.length;
    let k = 0;
    for (const d of list) {
      const m = d.member;
      const hungry = m ? env.fullness(m) < 0.3 : false;
      const scale = (m ? 0.92 + (m.size - 1) * 0.5 : 0.9) * 1.2;
      d.radius = 1.1 * scale;
      // food
      if (!d.food && d.state === 'pod') {
        let best = null, bd = 48;
        for (const f of fx.foods) {
          if (f.state !== 'float') continue;
          const dd = Math.hypot(f.pos.x - d.pos.x, f.pos.z - d.pos.z);
          if (dd < bd && H(f.pos.x, f.pos.z) < -1.3) { bd = dd; best = f; }
        }
        if (best && d.r.next() < dt * 2) { d.food = best; d.state = 'food'; d.bites = 0; }
      }
      if (d.food && !fx.foods.includes(d.food)) { d.food = null; if (d.state === 'food') d.state = 'pod'; }
      let wantY = -0.85, speed = 2.6;
      if (d.state === 'leap') {
        // ballistic arc
        d.lv.y -= 9.8 * dt;
        d.pos.addScaledVector(d.lv, dt);
        d.spin += dt * (d.r.next() < 0.5 ? 0 : 0);
        const above = d.pos.y > 0;
        if (above !== d.wasAbove) {
          fx.splash(_p.set(d.pos.x, 0, d.pos.z), above ? 16 : 26, above ? 0.9 : 1.2);
          fx.ripple(d.pos.x, d.pos.z, 2.2, 2.2, 0.6);
          if (!above) env.sfx('splash');
          d.wasAbove = above;
        }
        if (d.pos.y < -0.9 && d.lv.y < 0) { d.state = d.food ? 'food' : 'pod'; d.leapT = d.r.range(14, 40); }
        const hs = Math.hypot(d.lv.x, d.lv.z);
        d.pitch = Math.atan2(d.lv.y, hs);
        d.yaw = Math.atan2(d.lv.x, d.lv.z);
        d.phase += dt * 3;
        d.turn = damp(d.turn, 0, 4, dt);
      } else {
        if (d.state === 'food' && d.food) {
          _tgt.copy(d.food.pos);
          speed = 5.5;
          const dist = Math.hypot(_tgt.x - d.pos.x, _tgt.z - d.pos.z);
          if (dist < 4) { wantY = -0.05; speed = 2.2; }
          if (dist < 1.0 * scale) {
            speed = 0.4;
            d.biteT -= dt;
            if (d.biteT <= 0) {
              d.biteT = 1.0;
              env.onEat(m || null, _p.copy(d.pos).add(_a.set(0, 0.6, 0)));
              d.bites++;
              const gone = fx.biteFood(d.food);
              if (gone || d.bites >= 2) {
                d.food = null; d.state = 'pod';
                d.leapT = 1.2; // celebratory leap
              }
            }
          }
        } else {
          // formation around the pod centre; hungry ones wait off the dock end
          if (hungry) {
            _tgt.copy(props.dockEnd).addScaledVector(props.dockDir, 9 + (d.slot % 3) * 1.5).addScaledVector(props.dockPerp, Math.sin(t * 0.3 + d.slot * 2) * 5);
            speed = 2.0;
          } else {
            const lag = d.slot * 3.2 / pod.R;
            const a = pod.ang - lag * pod.dir;
            const R = pod.R + wob + ((d.slot % 2) ? 2.2 : -1.2) + Math.sin(t * 0.21 + d.slot) * 1.5;
            _tgt.set(Math.cos(a) * R, 0, Math.sin(a) * R);
          }
          d.leapT -= dt;
          if (d.leapT <= 0 && H(d.pos.x, d.pos.z) < -2.5) {
            d.state = 'leap';
            const hsp = 5.5;
            d.lv.set(Math.sin(d.yaw) * hsp, 6.2 + d.r.range(-0.6, 1.0), Math.cos(d.yaw) * hsp);
            d.wasAbove = d.pos.y > 0;
          }
        }
        if (d.state !== 'leap') {
          _d.set(_tgt.x - d.pos.x, 0, _tgt.z - d.pos.z);
          const desiredYaw = Math.atan2(_d.x, _d.z);
          const turn = angleDelta(d.yaw, desiredYaw);
          const tr = clamp(turn, -1.2 * dt, 1.2 * dt);
          d.yaw += tr;
          d.turn = damp(d.turn, clamp(-turn * 0.8, -0.4, 0.4), 3, dt);
          const dist = _d.length();
          const sp = speed * clamp(dist / 2, 0.2, 1.4);
          d.vel.set(Math.sin(d.yaw) * sp, 0, Math.cos(d.yaw) * sp);
          d.pos.addScaledVector(d.vel, dt);
          // porpoising: surface briefly every few seconds
          d.pPhase += dt * d.pRate;
          const surf = Math.pow(Math.max(0, Math.sin(d.pPhase)), 4);
          const wy = d.state === 'food' ? wantY : wantY + surf * 0.95;
          const sb = H(d.pos.x, d.pos.z);
          const ty = Math.max(wy, sb + 0.6);
          const vy = (ty - d.pos.y);
          d.pos.y = damp(d.pos.y, ty, 2.2, dt);
          d.pitch = damp(d.pitch, clamp(vy * 0.9, -0.5, 0.5), 3, dt);
          d.phase += dt * (2.5 + sp * 1.6);
          const surfaced = d.pos.y > -0.15;
          if (surfaced && !d.wasAbove) { fx.spray(_p.set(d.pos.x, 0.05, d.pos.z), d.vel.x * 0.1, d.vel.z * 0.1, 6, 0.7); fx.ripple(d.pos.x, d.pos.z, 1.6, 1.6, 0.45); }
          d.wasAbove = surfaced;
        }
      }
      // pose: model axis +X → heading
      _e.set(0, d.yaw - Math.PI / 2, d.pitch, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(d.pos, _q, _s.setScalar(scale));
      mesh.setMatrixAt(k, _m);
      aDol.setXYZW(k, d.phase, d.state === 'leap' ? 0.05 : 0.11 + Math.min(0.08, d.vel.length() * 0.012), d.turn, 0);
      k++;
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    aDol.needsUpdate = true;
  }
  return {
    mesh, list, add, update,
    remove(member) { const i = list.findIndex(x => x.member === member); if (i >= 0) list.splice(i, 1); list.forEach((d, j) => d.slot = j); },
    dispose() { geo.dispose(); mat.dispose(); depthMat.dispose(); },
  };
}

/* ================================================================== */
/* Lagoon fish                                                         */
/* ================================================================== */
function createFish(env, ctx) {
  const { terrain } = ctx;
  const H = terrain.height;
  const rng = makeRng(env.seed ^ 0xf15);
  const schools = [];
  const group = new THREE.Group();
  const defs = [['yellowTang', 12], ['blueTang', 9], ['chromis', 14]];
  for (const [sp, n0] of defs) {
    const n = Math.round(n0 * lerp(0.6, 1, env.q));
    const geo = buildFishGeometry(sp, { detail: env.q > 0.8 ? 1 : 0.7 });
    const painted = paintFish(sp, { seed: rng.int(1, 1e6) });
    const mat = createFishMaterial(painted, { clearcoat: 0.2, iridescence: 0.0 });
    addUnderwater(mat, { key: 'fish' });
    const inst = new FishInstances(geo, mat, n, { castShadow: true });
    inst.mesh.layers.set(LAYER_NO_REFLECT);
    group.add(inst.mesh);
    geo.dispose();
    const a = rng.range(0, TAU);
    const c = terrain.pointAt(a, -rng.range(4, 7));
    const school = { inst, painted, mat, center: new V3(c.x, -0.4, c.z), target: new V3(c.x, -0.4, c.z), fish: [], timer: 0, ang: a };
    for (let i = 0; i < n; i++) {
      const sw = new Swimmer({ pos: new V3(c.x + rng.range(-1, 1), -0.4, c.z + rng.range(-1, 1)), size: rng.range(0.2, 0.28), speed: 0.4, rng, agility: 2.5 });
      sw.off = new V3(rng.range(-1.2, 1.2), rng.range(-0.1, 0.1), rng.range(-1.2, 1.2));
      school.fish.push(sw);
    }
    schools.push(school);
  }
  const _want = new V3();
  return {
    group,
    update(dt, t) {
      for (const s of schools) {
        s.timer -= dt;
        if (s.timer <= 0 || s.center.distanceTo(s.target) < 1) {
          s.timer = rng.range(6, 14);
          s.ang += rng.range(-0.5, 0.5);
          terrain.pointAt(s.ang, -rng.range(3.5, terrain.lagoonW(s.ang) - 1), s.target);
          s.target.y = clamp(s.target.y + 0.35, -0.6, -0.3);
        }
        _want.subVectors(s.target, s.center);
        const d = _want.length();
        if (d > 0.01) s.center.addScaledVector(_want, Math.min(1, dt * 0.55 / d));
        s.inst.begin();
        for (const f of s.fish) {
          _want.copy(s.center).add(f.off).sub(f.pos);
          _want.x += Math.sin(t * 0.7 + f.phase) * 0.6;
          _want.z += Math.cos(t * 0.6 + f.phase) * 0.6;
          const sb = H(f.pos.x, f.pos.z);
          if (f.pos.y < sb + 0.15) _want.y += 0.5;
          if (f.pos.y > -0.15) _want.y -= 0.5;
          _want.clampLength(0, 0.9);
          f.steer(_want, dt).integrate(dt);
          s.inst.push(f);
        }
        s.inst.end(t);
      }
    },
    dispose() { for (const s of schools) { s.inst.geometry.dispose(); s.mat.dispose(); s.painted.map?.dispose(); s.painted.normalMap?.dispose(); } },
  };
}

/* ================================================================== */
/* Facade                                                              */
/* ================================================================== */
export async function createFauna(env, ctx) {
  const [stork, flamingo] = await Promise.all([env.loadGLTF('models/Stork.glb'), env.loadGLTF('models/Flamingo.glb')]);
  const group = new THREE.Group();
  group.name = 'fauna';
  const crabs = createCrabs(env, ctx, 16);
  const birds = createBirds(env, ctx, stork, flamingo);
  const turtles = createTurtles(env, ctx, 16);
  const dolphins = createDolphins(env, ctx, 18);
  const fish = createFish(env, ctx);
  group.add(crabs.group, birds.group, turtles.group, dolphins.mesh, fish.group);
  // ambient (non-member) extras keep the world lively
  birds.addGull(null, env.seed ^ 0xa1);
  birds.addGull(null, env.seed ^ 0xa2);
  const ambientDolphin = dolphins.add(null);

  function addMember(member) {
    switch (member.kind) {
      case 'crab': case 'hermit': return crabs.add(member);
      case 'gull': return birds.addGull(member, member.seed || 3);
      case 'turtle': return turtles.add(member);
      case 'dolphin': return dolphins.add(member);
    }
    return null;
  }
  const _tag = [], _tagPool = [];
  const tagOf = (member, pos, radius) => {
    const o = _tagPool[_tag.length] || (_tagPool[_tag.length] = { member: null, pos: null, radius: 0 });
    o.member = member; o.pos = pos; o.radius = radius;
    _tag.push(o);
  };
  return {
    group, crabs, birds, turtles, dolphins, fish, addMember, ambientDolphin,
    update(dt, t, info) {
      crabs.update(dt, t);
      birds.update(dt, t, info);
      turtles.update(dt, t);
      dolphins.update(dt, t);
      fish.update(dt, t);
    },
    creatures() {
      _tag.length = 0;
      for (const c of crabs.list) tagOf(c.member, c.pos, c.radius + 0.2);
      for (const g of birds.gulls) if (g.member) tagOf(g.member, g.pos, 1.0);
      for (const tr of turtles.list) tagOf(tr.member, tr.pos, tr.radius + 0.2);
      for (const d of dolphins.list) if (d.member) tagOf(d.member, d.pos, d.radius + 0.2);
      return _tag;
    },
    dispose() { crabs.dispose(); birds.dispose(); turtles.dispose(); dolphins.dispose(); fish.dispose(); },
  };
}
