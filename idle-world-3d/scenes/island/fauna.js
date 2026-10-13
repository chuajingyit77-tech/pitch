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
const _s = new V3(), _p = new V3(), _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3(), _side = new V3(), _n = new V3();
const _e = new THREE.Euler();
const _col = new THREE.Color();
const Q_ZPI = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
// crab legs (local units): hip z offsets, splay, half stride
const LEG_Z = [0.075, 0.03, -0.02, -0.065], LEG_SPREAD = [0.6, 0.18, -0.22, -0.6], LEG_STRIDE = 0.045;

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

  // rocks (their part above the sand) and palm trunks: the crabs walk round them (they used to walk
  // straight through, on some islands for a fifth of the time)
  const obstacles = [];
  for (const rk of ctx.flora.rockSites) if (rk.y + rk.s * 0.62 * rk.ys > H(rk.x, rk.z) + 0.08) obstacles.push({ x: rk.x, z: rk.z, r: rk.s * 0.85 });
  for (const ps of ctx.flora.palmSites) obstacles.push({ x: ps.x, z: ps.z, r: 0.36 * ps.s });
  const CRAB_PAD = 0.2 * CRAB_SCALE; // about half a crab body
  function blocked(x, z) {
    for (const o of obstacles) if (Math.hypot(x - o.x, z - o.z) < o.r + CRAB_PAD + 0.1) return true;
    return false;
  }
  function pushOut(p, pad) {
    for (const o of obstacles) {
      const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), R = o.r + pad;
      if (d < R && d > 1e-4) { p.x = o.x + dx / d * R; p.z = o.z + dz / d * R; p.y = H(p.x, p.z); }
    }
    return p;
  }
  /** Bend the walking direction `dir` (unit, xz) round obstacles ahead, sliding past on one side. */
  function steerAround(c, dir, tgt) {
    let bent = false;
    const pad = 0.2 * c.scale;
    for (const o of obstacles) {
      const ox = c.pos.x - o.x, oz = c.pos.z - o.z, d = Math.hypot(ox, oz), R = o.r + pad;
      if (d > R + 0.8 || d < 1e-4) continue;
      if (Math.hypot(tgt.x - o.x, tgt.z - o.z) < R + 0.1) continue; // the goal is right at it (a snack by a rock)
      const nx = ox / d, nz = oz / d;
      const into = -(nx * dir.x + nz * dir.z);
      if (into <= 0) continue;
      let tx = nz, tz = -nx;
      const along = tx * dir.x + tz * dir.z;
      if (Math.abs(along) > 0.15) c.avoidSide = along > 0 ? 1 : -1; // keep the chosen side when head-on
      tx *= c.avoidSide; tz *= c.avoidSide;
      const w = 1 - smoothstep(R, R + 0.8, d);
      dir.x += (nx + tx * 0.8) * into * w; dir.z += (nz + tz * 0.8) * into * w;
      bent = true;
    }
    if (bent) { const l = Math.hypot(dir.x, dir.z) || 1; dir.x /= l; dir.z /= l; }
  }

  function add(member) {
    const r = makeRng(member.seed || 1);
    const hermit = member.kind === 'hermit';
    const p = pushOut(terrain.beachPoint(r, 0.8, 4.2), CRAB_PAD + 0.15);
    const c = {
      member, hermit, r,
      pos: p.clone(), yaw: r.range(0, TAU), facing: new V3(),
      state: 'idle', timer: r.range(0.5, 3), target: new V3().copy(p), food: null,
      phase: r.range(0, TAU), speed: 0, moveSign: 1, dig: 0, wave: 0, wavePhase: 0, biteT: 0,
      color: hermit ? PALETTE[4].clone().lerp(new THREE.Color('#d98a6a'), 0.5) : r.pick(PALETTE).clone(),
      shellColor: r.pick(HERMIT_SHELLS).clone(),
      radius: 0.5,
    };
    // (drawn after the look so every crab keeps its colours)
    c.burstPh = r.range(0, TAU); c.burstRate = r.range(1.9, 2.7); // own scuttle rhythm
    c.pinch = r.range(0, TAU);   // claw open/close phase (advanced by a rate, so it never jumps)
    c.side = 1;                  // which flank leads (+1: local +X); flips only with hysteresis
    c.proj = 0;                  // signed share of the motion along local X (the legs sweep along it)
    c.gw = 0;                    // gait weight: 0 standing (feet down), 1 walking
    c.scale = CRAB_SCALE;
    c.noticeFood = null; c.noticeT = 0;
    c.avoidSide = 1;
    list.push(c);
    return c;
  }

  function pickWanderTarget(c, hungry) {
    if (hungry) {
      for (let k = 0; k < 6; k++) {
        const a = Math.atan2(props.dockBase.z, props.dockBase.x) + c.r.range(-0.25, 0.25);
        terrain.pointAt(a, c.r.range(0.6, 3.2), c.target);
        if (!blocked(c.target.x, c.target.z)) break;
      }
      return;
    }
    const a0 = Math.atan2(c.pos.z, c.pos.x);
    for (let k = 0; k < 8; k++) {
      terrain.pointAt(a0 + c.r.range(-0.45, 0.45), c.r.range(0.4, 4.6), c.target);
      if (!props.onDock(c.target.x, c.target.z) && !blocked(c.target.x, c.target.z)) break;
    }
  }

  function update(dt, t) {
    bodies.begin(); legs.begin(); claws.begin(); shells.begin();
    for (const c of list) {
      const m = c.member;
      const hungry = env.fullness(m) < 0.3;
      const scale = CRAB_SCALE * (c.hermit ? 0.85 : 1) * (0.85 + (m.size - 1) * 0.6);
      c.scale = scale;
      c.radius = 0.4 * scale;
      // ---- food ----
      // Each crab notices new food after its own short delay (they all used to turn and run on the same
      // frame, in lockstep).
      if (c.state !== 'eat' && c.state !== 'food' && c.dig < 0.5) {
        let best = null, bd = 13;
        for (const f of ctx.fx.foods) {
          if (!f.land || f.state !== 'rest' || f.onDock) continue;
          const d = Math.hypot(f.pos.x - c.pos.x, f.pos.z - c.pos.z);
          if (d < bd) { bd = d; best = f; }
        }
        // (the delay starts when food first shows up and is not restarted when the nearest of two snacks
        // changes, so a crab between two never stalls)
        if (best && !c.noticeFood) { c.noticeFood = best; c.noticeT = c.r.range(0.15, 0.9); }
        else if (!best) c.noticeFood = null;
        if (best && (c.noticeT -= dt) <= 0) { c.food = best; c.state = 'food'; c.noticeFood = null; }
      } else c.noticeFood = null;
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
          if (c.dig < 1 && Math.random() < 1 - Math.exp(-8 * dt)) fx.sandPuff(c.pos, 2, 0.45);
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
          steerAround(c, _d, tgt);
          // face perpendicular to the motion (sideways scuttle). The leading flank only changes when the
          // other one is clearly the shorter turn: picking the nearer of the two every frame made the
          // body dither by half a turn whenever the path ran nearly head-on.
          const fA = Math.atan2(-_d.z, _d.x); // yaw that puts local +X along the motion
          const tKeep = c.side > 0 ? fA : fA + Math.PI, tOther = c.side > 0 ? fA + Math.PI : fA;
          if (Math.abs(angleDelta(c.yaw, tOther)) < Math.abs(angleDelta(c.yaw, tKeep)) - 0.35) c.side = -c.side;
          c.yaw = dampAngle(c.yaw, c.side > 0 ? fA : fA + Math.PI, 6, dt);
          c.proj = Math.cos(c.yaw) * _d.x - Math.sin(c.yaw) * _d.z;
          // turn first, then scuttle (legs only sweep sideways, so a diagonal walk slides); scuttle in
          // bursts with the crab's own rhythm (this used the leg phase, a ~10 Hz wobble that aliased
          // into a stutter and ran 1.3x faster at 30 fps); ease in to the stopping point
          const align = 0.25 + 0.75 * smoothstep(0.5, 0.95, Math.abs(c.proj));
          const burst = 0.65 + 0.35 * Math.sin(t * c.burstRate + c.burstPh);
          const arrive = clamp((dist - reach) / 0.35 + 0.25, 0.25, 1);
          const sp = (c.state === 'food' ? 1.35 : hungry ? 1.0 : 0.75) * burst * (0.8 + 0.2 * scale) * align * arrive;
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
      // gait: the stance sweeps 2 * LEG_STRIDE (local units) while the body covers the same ground, so the
      // planted feet stay put (the cycle used to run ~35 % fast and the feet skated); standing still, the
      // feet settle down instead of freezing mid-step
      const vAct = moving ? c.speed : 0;
      c.gw = damp(c.gw, smoothstep(0.02, 0.18, vAct), 12, dt);
      c.phase = (c.phase + dt * vAct * Math.PI / (2 * LEG_STRIDE * scale)) % TAU;
      c.pinch = (c.pinch + dt * (c.state === 'eat' ? 12 : 3)) % TAU;
      // keep on the beach (never swim off)
      const e = terrain.coastE(c.pos.x, c.pos.z);
      if (e < 0.15) { const a = Math.atan2(c.pos.z, c.pos.x); terrain.pointAt(a, 0.15, _p); c.pos.x = _p.x; c.pos.z = _p.z; }
    }
    // crabs crowding round the same snack shuffle apart instead of sinking into each other
    const kSep = 1 - Math.exp(-10 * dt);
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
        const minD = 0.2 * (a.scale + b.scale);
        if (d >= minD || d < 1e-5 || a.dig > 0.5 || b.dig > 0.5) continue;
        const push = (minD - d) * 0.5 * kSep / d;
        a.pos.x -= dx * push; a.pos.z -= dz * push; b.pos.x += dx * push; b.pos.z += dz * push;
      }
      // and never end up inside a rock or a trunk (eased out, so a nudge never pops)
      for (const o of obstacles) {
        const dx = a.pos.x - o.x, dz = a.pos.z - o.z, d = Math.hypot(dx, dz), R = o.r + 0.2 * a.scale;
        if (d >= R || d < 1e-4) continue;
        if (a.food && Math.hypot(a.food.pos.x - o.x, a.food.pos.z - o.z) < R + 0.1) continue;
        const k = (R - d) * kSep / d;
        a.pos.x += dx * k; a.pos.z += dz * k;
      }
    }
    for (const c of list) {
      const scale = c.scale;
      c.pos.y = H(c.pos.x, c.pos.z);
      // stand on the slope (level on a 15° upper beach, the far feet floated or sank ~10 cm)
      const gx = (H(c.pos.x + 0.25, c.pos.z) - H(c.pos.x - 0.25, c.pos.z)) * 2;
      const gz = (H(c.pos.x, c.pos.z + 0.25) - H(c.pos.x, c.pos.z - 0.25)) * 2;
      _q2.setFromUnitVectors(UP, _n.set(-gx, 1, -gz).normalize());

      // ---- pose ----
      const bodyH = 0.105;
      const gw = c.gw;
      const bob = (0.5 - 0.5 * Math.cos(2 * c.phase)) * 0.011 * gw; // (|sin| had a cusp: a 10 Hz jolt at a run)
      const sink = c.dig * 0.19;
      _q.setFromAxisAngle(UP, c.yaw).premultiply(_q2);
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
      const sweepK = LEG_STRIDE * c.proj * gw;
      for (let s = -1; s <= 1; s += 2) {
        for (let j = 0; j < 4; j++) {
          const zj = LEG_Z[j];
          const spread = LEG_SPREAD[j];
          const lp = c.phase + (((j + (s > 0 ? 1 : 0)) % 2) ? Math.PI : 0) + j * 0.3;
          // u in [0, 0.5): stance, the foot slides back at a constant rate (planted); [0.5, 1): swing
          const u = (lp / TAU) % 1;
          let fwd, lift = 0;
          if (u < 0.5) fwd = 1 - 4 * u;
          else { const w = (u - 0.5) * 2; fwd = -1 + 2 * w * w * (3 - 2 * w); lift = Math.sin(Math.PI * w) * 0.045 * gw; }
          const sweep = fwd * sweepK;
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
        const cw = c.wave * (0.5 + 0.5 * Math.sin(t * 7 + s + c.burstPh)); // (own phase: crabs waved in unison)
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
        // (its own phase: switching sin(t * 3) to sin(t * 12) when eating made the pincers jump)
        const open = 0.25 + 0.25 * Math.sin(c.pinch + s);
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
      perch: null, food: null, roll: 0, biteT: 0, fold: 0, lastPh: 0, up: new V3(0, 1, 0), fwd: new V3(1, 0, 0), radius: 0.9,
      speed: r.range(5.5, 7),
    };
    // heading / pitch angles: the body is built from these (a lerped forward vector flipped over when a
    // new direction lay behind the bird, and pointed straight down in a vertical drop)
    gl.yaw = Math.atan2(gl.vel.x, gl.vel.z); gl.pitch = 0; gl.yawRate = 0; gl.turnSide = 1;
    gl.flapK = r.range(0.93, 1.08); // each bird beats at its own pace
    gl.hPh = r.range(0, TAU);       // and rises and sinks on its own swell (they all bobbed together)
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

  const _want = new V3(), _x = new V3(), _y = new V3(), _z = new V3();
  const GULL_TURN = 2.4; // max heading rate in flight (rad/s)
  /**
   * Ease the velocity toward `want`: the direction of travel turns at most GULL_TURN rad/s, like the body
   * (a vector lerp swung the path round faster than the bird could turn, and it slid sideways after a
   * take-off); speed and climb ease at `rate`.
   */
  function steerToward(gl, want, rate, dt) {
    const k = 1 - Math.exp(-rate * dt);
    const hs = Math.hypot(gl.vel.x, gl.vel.z), ws = Math.hypot(want.x, want.z);
    const cur = hs > 0.4 ? Math.atan2(gl.vel.x, gl.vel.z) : gl.yaw;
    const des = ws > 1e-4 ? Math.atan2(want.x, want.z) : cur;
    // a goal right behind: keep turning the way the bird already banks (the side used to depend on
    // rounding, so a gull could pick either way, or waver)
    let da = angleDelta(cur, des);
    if (Math.abs(da) > Math.PI - 0.35) da = (Math.abs(gl.yawRate) > 0.15 ? Math.sign(gl.yawRate) : gl.turnSide) * Math.abs(da);
    else if (Math.abs(da) > 0.05) gl.turnSide = Math.sign(da);
    const a = cur + clamp(da * k, -GULL_TURN * dt, GULL_TURN * dt);
    const nhs = hs + (ws - hs) * k;
    gl.vel.x = Math.sin(a) * nhs; gl.vel.z = Math.cos(a) * nhs;
    gl.vel.y += (want.y - gl.vel.y) * k;
  }
  function updateGull(gl, dt, t) {
    const m = gl.member;
    const hungry = m ? env.fullness(m) < 0.3 : false;
    gl.mixer.update(dt);
    // pick up food: the moment a gull notices it is drawn once per sighting (an exponential wait, the same
    // odds as the old per-frame dice roll, but not tied to how many frames are drawn)
    let best = null;
    if (!gl.food && (gl.state === 'soar' || gl.state === 'perched') && fx.foods.length) {
      let bd = 1e9;
      for (const f of fx.foods) {
        if (f.state === 'fall' || f.claimed > 1) continue;
        const d = Math.hypot(f.pos.x - gl.pos.x, f.pos.z - gl.pos.z);
        if (d < bd) { bd = d; best = f; }
      }
    }
    if (!best) gl.noticeT = null;
    else {
      if (gl.noticeT === null || gl.noticeT === undefined) gl.noticeT = -Math.log(1 - gl.r.next()) / (hungry ? 2.5 : 0.9);
      if ((gl.noticeT -= dt) <= 0) {
        gl.noticeT = null;
        gl.food = best; best.claimed++;
        if (gl.perch) { perchTaken.delete(gl.perch); gl.perch = null; }
        gl.state = gl.fold > 0.3 ? 'takeoff' : 'dive'; // a perched bird lifts off first, then goes for it
        if (gl.state === 'takeoff') gl.timer = 0.5;
      }
    }
    if (gl.food && !fx.foods.includes(gl.food)) { gl.food = null; if (gl.state === 'dive' || gl.state === 'peck') { gl.state = 'takeoff'; gl.timer = 1.2; } }

    let flap = false, fold = 0, settle = false, flare = 0;
    switch (gl.state) {
      case 'soar': {
        const th = gl.thermal;
        gl.ang += dt * (gl.speed / th.r) * th.dir;
        _want.set(th.x + Math.cos(gl.ang + th.dir * 0.4) * th.r, th.h + Math.sin(t * 0.2 + gl.hPh) * 1.5, th.z + Math.sin(gl.ang + th.dir * 0.4) * th.r);
        _want.sub(gl.pos);
        const d = _want.length();
        _want.multiplyScalar(gl.speed / Math.max(d, 0.001));
        steerToward(gl, _want, 1.3, dt);
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
        const above = gl.state === 'dive' ? 0.25 : 0.32;
        _want.subVectors(tgt, gl.pos);
        const hd = Math.hypot(_want.x, _want.z);
        const dy = gl.pos.y - (tgt.y + above);
        // approach from above along a glide slope, then descend; slow down into the landing (it used to
        // arrive at >= 1.2 m/s and stop dead in one frame)
        const ty = tgt.y + above + Math.min(hd * 0.45, 8);
        _want.y = ty - gl.pos.y;
        const d3 = Math.hypot(hd, dy);
        const sp = clamp(d3 * 0.9 + 0.2, 0.3, gl.state === 'dive' ? 9 : 7);
        const len = _want.length();
        _want.multiplyScalar(sp / Math.max(len, 0.001));
        // Too high above the glide slope to come straight in: keep flying and circle down, never steeper
        // than ~48° (a gull used to arrive over the snack and hang there sinking, nose down, for seconds).
        const high = smoothstep(0, 2, dy - hd * 0.45 - 1);
        const whs = Math.hypot(_want.x, _want.z), minH = 4.5 * high;
        if (whs < minH) {
          const ax = whs > 1e-3 ? _want.x / whs : Math.sin(gl.yaw), az = whs > 1e-3 ? _want.z / whs : Math.cos(gl.yaw);
          _want.x = ax * minH; _want.z = az * minH;
        }
        _want.y = Math.max(_want.y, -Math.max(0.8, Math.hypot(_want.x, _want.z) * 1.1));
        // level out and flare over the last couple of metres, sinking gently
        flare = 1 - smoothstep(0.6, 2.5, d3);
        if (flare > 0) _want.y = Math.max(_want.y, -lerp(5, 0.7, flare));
        steerToward(gl, _want, 2.2, dt);
        flap = hd < 4 || gl.vel.y > 0.2;
        if (d3 < 0.3) {
          if (gl.state === 'dive') { gl.state = 'peck'; gl.biteT = 0.5; gl.timer = 6; }
          else { gl.state = 'perched'; gl.timer = gl.r.range(10, 28) * (hungry ? 2 : 1); gl.faceYaw = gl.yaw + gl.r.range(-2.2, 2.2); }
        }
        break;
      }
      case 'perched':
      case 'peck': {
        const tgt = gl.state === 'peck' ? gl.food.pos : gl.perch;
        const above = gl.state === 'peck' ? 0.25 : 0.32;
        gl.pos.lerp(_p.set(tgt.x, tgt.y + above, tgt.z), 1 - Math.exp(-6 * dt));
        settle = true;
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
        // spring up and forward along the way the bird faces, accelerating from rest (it used to get a
        // random 3 m/s kick and was yanked 1.2 m up by the ground clearance)
        const hs = Math.hypot(gl.vel.x, gl.vel.z);
        if (hs > 0.5) _want.set(gl.vel.x / hs, 0, gl.vel.z / hs);
        else _want.set(Math.sin(gl.yaw), 0, Math.cos(gl.yaw));
        _want.multiplyScalar(5).setY(3);
        steerToward(gl, _want, 2, dt);
        flap = true;
        gl.timer -= dt;
        if (gl.timer <= 0) {
          if (gl.food && fx.foods.includes(gl.food)) gl.state = 'dive';
          else { gl.state = 'soar'; gl.thermal = gl.r.pick(thermals); gl.ang = Math.atan2(gl.pos.z - gl.thermal.z, gl.pos.x - gl.thermal.x); gl.timer = gl.r.range(10, 20); }
        }
        break;
      }
    }
    if (settle) gl.vel.multiplyScalar(Math.exp(-10 * dt));
    gl.pos.addScaledVector(gl.vel, dt);
    // don't clip through the island (soaring keeps clear of the sea too; landing and taking off only
    // keep out of the ground, so they can reach their perch or the food)
    if (gl.state === 'soar') {
      const ground = Math.max(H(gl.pos.x, gl.pos.z), 0) + 1.2;
      if (gl.pos.y < ground) gl.pos.y = damp(gl.pos.y, ground, 4, dt);
    } else if (!settle) {
      const ground = H(gl.pos.x, gl.pos.z) + 0.2;
      if (gl.pos.y < ground) gl.pos.y = damp(gl.pos.y, ground, 8, dt);
    }
    // ---- animation ----
    gl.fold = damp(gl.fold, fold, 6, dt);
    const act = gl.action;
    if (flap && fold <= 0.5) { act.paused = false; act.timeScale = (gl.state === 'dive' || gl.state === 'takeoff' ? 1.7 : 1.15) * gl.flapK; }
    else if (!act.paused) {
      // glide or land: finish the current wing beat and settle on the wings-level frame (landing used to
      // snap the wings to that frame mid-beat)
      if (fold > 0.5) act.timeScale = 2.2;
      const ph = act.time % gullClip.duration;
      if (ph < 0.06 || ph > gullClip.duration - 0.04 || ph < gl.lastPh) { act.paused = true; act.time = 0; }
    }
    gl.lastPh = act.time % gullClip.duration;
    // ---- orientation: heading follows the horizontal flight direction (rate-limited, shortest way
    // round), pitch follows climb / descent (within ±35°, 57° when stooping onto a target), banking
    // from the turn rate ----
    const hs = Math.hypot(gl.vel.x, gl.vel.z);
    let wantYaw = gl.yaw;
    if (hs > 0.3) wantYaw = Math.atan2(gl.vel.x, gl.vel.z);
    else if (gl.state === 'perched' && gl.faceYaw !== undefined) wantYaw = gl.faceYaw;
    const maxTurn = (gl.fold > 0.5 ? 1.5 : GULL_TURN) * dt;
    const dYaw = clamp(angleDelta(gl.yaw, wantYaw) * (1 - Math.exp(-6 * dt)), -maxTurn, maxTurn);
    gl.yaw = (gl.yaw + dYaw) % TAU;
    gl.yawRate = damp(gl.yawRate, dYaw / Math.max(dt, 1e-4), 8, dt);
    const steep = (gl.state === 'dive' || gl.state === 'toPerch') ? 1.0 : 0.6; // stoop nose-down when descending onto a target
    let wantPitch = hs + Math.abs(gl.vel.y) > 0.3 ? clamp(Math.atan2(gl.vel.y, Math.max(hs, 1.0)), -steep, 0.6) : 0;
    if (flare > 0) wantPitch = lerp(wantPitch, 0.15, flare);
    gl.pitch = damp(gl.pitch, wantPitch, 5, dt);
    // bank into turns: lateral acceleration = turn rate x speed (+ rate = turning toward local +X)
    gl.roll = damp(gl.roll, clamp(-gl.yawRate * hs * 0.12, -0.7, 0.7) * (1 - gl.fold), 3, dt);
    const pitch = gl.pitch + gl.fold * 0.42; // perched: chest up
    const cp = Math.cos(pitch);
    _z.set(Math.sin(gl.yaw) * cp, Math.sin(pitch), Math.cos(gl.yaw) * cp);
    gl.fwd.copy(_z);
    _y.copy(UP).applyAxisAngle(_z, gl.roll);
    _x.crossVectors(_y, _z).normalize();
    _y.crossVectors(_z, _x).normalize();
    _m.makeBasis(_x, _y, _z);
    gl.root.quaternion.setFromRotationMatrix(_m);
    const base = GULL_SCALE * (m ? 0.9 + (m.size - 1) * 0.4 : 0.85);
    gl.root.scale.set(base * lerp(1, 0.3, gl.fold), base, base * lerp(1, 0.9, gl.fold));
    gl.root.position.copy(gl.pos);
    gl.root.position.y += 0.05 * smoothstep(0.3, 0.7, gl.fold); // (was a 5 cm step at fold = 0.5)
  }

  // ---- flamingos at dusk ----
  const fMesh = flamingoGltf.scene.getObjectByProperty('isMesh', true);
  const fClip = retargetClip(flamingoGltf.animations[0], 'bird');
  const flamMat = fMesh.material.clone();
  flamMat.vertexColors = true; flamMat.roughness = 0.7;
  disposables.push(flamMat);
  const flock = { active: false, t: 0, cooldown: 0, birds: [], origin: new V3(), dir: new V3(), y: 22, warm: 2 };
  const NF = 7;
  const vrng = makeRng(env.seed ^ 0xf1b); // per-bird variation (kept apart from the flock's own rng)
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
    // drawn (tiny, inside the island) for the first two frames only: the shell's warm-up then compiles
    // their shadow-depth program under the veil instead of hitching the first dusk pass
    root.position.set(0, -40, 0);
    root.visible = true;
    group.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const action = mixer.clipAction(fClip);
    action.play();
    action.time = i * 0.17;
    action.timeScale = 0.9 + (i % 3) * 0.06 + vrng.range(-0.025, 0.025);
    const side = i === 0 ? 0 : (i % 2 ? 1 : -1) * Math.ceil(i / 2);
    flock.birds.push({
      root, mixer, offset: new V3(side * 2.1, Math.sin(i * 1.7) * 0.6, -Math.abs(side) * 2.6),
      // each bird drifts slowly about its slot, so the V breathes instead of moving as one rigid piece
      dr: [vrng.range(0.17, 0.33), vrng.range(0.12, 0.26), vrng.range(0, TAU), vrng.range(0, TAU)],
    });
  }
  const frng = makeRng(env.seed ^ 0xf1a);
  // A pass starts and ends far out over the sea and the birds grow in / shrink out over the first and
  // last few seconds, so they never pop into or out of view (they used to appear 34 m from the island,
  // well inside the picture, and vanish mid-air the minute dusk ended).
  const FLOCK_R = 72, FLOCK_LEN = FLOCK_R * 2 + 10, FLOCK_SCALE = 0.012;
  function updateFlock(dt, t, dusk, timeJump) {
    if (flock.warm > 0 && --flock.warm === 0 && !flock.active) for (const b of flock.birds) b.root.visible = false;
    if (flock.active && timeJump && dusk < 0.02) { // the clock was set by hand: the whole light changed at once anyway
      flock.active = false; flock.cooldown = 2;
      for (const b of flock.birds) b.root.visible = false;
    }
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
      const dr = b.dr;
      _a.set(b.offset.x + Math.sin(t * dr[0] + dr[2]) * 0.35, b.offset.y + Math.sin(t * 0.9 + i) * 0.25, b.offset.z + Math.sin(t * dr[1] + dr[3]) * 0.6).applyAxisAngle(UP, yaw);
      b.root.position.copy(flock.origin).addScaledVector(flock.dir, dist).add(_a);
      b.root.rotation.set(0, yaw, Math.sin(t * 0.7 + i) * 0.06);
    }
    if (dist >= FLOCK_LEN) {
      flock.active = false; flock.cooldown = frng.range(25, 55);
      for (const b of flock.birds) b.root.visible = false;
    }
  }

  return {
    group, gulls, addGull, flock,
    update(dt, t, { dusk, timeJump = false }) {
      for (const g of gulls) updateGull(g, dt, t);
      updateFlock(dt, t, dusk, timeJump);
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
      for (let k = 0; k < 8; k++) {
        out.copy(props.dockEnd).addScaledVector(props.dockPerp, tr.r.range(-3.5, 3.5)).addScaledVector(props.dockDir, tr.r.range(-1, 3));
        if (H(out.x, out.z) < -0.55) break;
      }
      return out;
    }
    for (let k = 0; k < 16; k++) {
      const a = Math.atan2(tr.pos.z, tr.pos.x) + tr.r.range(-0.7, 0.7);
      const lw = terrain.lagoonW(a);
      terrain.pointAt(a, -tr.r.range(2.5, Math.max(3, lw - 0.8)), out);
      // (with a margin below the -0.45 m shallows limit: targets right on it could never be reached)
      if (out.y < -0.55 && out.y > -1.8 && !props.onDock(out.x, out.z)) return out;
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
    tr.speed = 0.5;  // eased swim speed (it used to jump with every change of state)
    tr.headUp = 0;   // eased head lift (breathing / eating)
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
      // food on the water (noticed after a wait drawn once per sighting, not on the very frame it lands)
      let best = null;
      if (!tr.food) {
        let bd = 22;
        for (const f of fx.foods) {
          if (f.state !== 'float') continue;
          const d = Math.hypot(f.pos.x - tr.pos.x, f.pos.z - tr.pos.z);
          if (d < bd && H(f.pos.x, f.pos.z) < -0.45) { bd = d; best = f; }
        }
      }
      if (!best) tr.noticeT = null;
      else {
        if (tr.noticeT === null || tr.noticeT === undefined) tr.noticeT = -Math.log(1 - tr.r.next()) / 1.5;
        if ((tr.noticeT -= dt) <= 0) { tr.noticeT = null; tr.food = best; tr.state = 'food'; }
      }
      if (tr.food && !fx.foods.includes(tr.food)) { tr.food = null; tr.state = 'swim'; lagoonTarget(tr, tr.target, hungry); }
      let tgt = tr.target, speed = 0.75, wantY;
      const seabed = H(tr.pos.x, tr.pos.z);
      const cruiseY = clamp(seabed + 0.3, -0.55, -0.22);
      wantY = cruiseY;
      switch (tr.state) {
        case 'swim': {
          tr.timer -= dt;
          // (a target in the shallows can't be reached past the avoidance: pick another, at most once a second)
          tr.retargetT = (tr.retargetT || 0) - dt;
          if (Math.hypot(tgt.x - tr.pos.x, tgt.z - tr.pos.z) < 1.2 || (H(tgt.x, tgt.z) > -0.45 && tr.retargetT <= 0)) { lagoonTarget(tr, tr.target, hungry); tr.retargetT = 1; }
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
          if (tr.timer <= 0) { tr.state = 'swim'; tr.rippled = false; tr.timer = tr.r.range(25, 55); lagoonTarget(tr, tr.target, hungry); }
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
      // steering; over the shallows the heading bends out toward deeper water (a hard shove used to
      // switch on and off every frame at the -0.45 m line and the turtle juddered sideways)
      _d.set(tgt.x - tr.pos.x, 0, tgt.z - tr.pos.z);
      const dist = _d.length();
      const shallow = tr.state === 'food' ? smoothstep(-0.45, -0.28, seabed) : smoothstep(-0.6, -0.42, seabed);
      let desiredYaw = Math.atan2(_d.x, _d.z);
      if (shallow > 0) desiredYaw += angleDelta(desiredYaw, Math.atan2(tr.pos.x, tr.pos.z)) * shallow;
      const turn = angleDelta(tr.yaw, desiredYaw);
      tr.yaw = (tr.yaw + clamp(turn * (1 - Math.exp(-2.5 * dt)), -0.9 * dt, 0.9 * dt)) % TAU;
      tr.speed = damp(tr.speed, speed * clamp(dist / 1.5, 0.15, 1), 1.5, dt);
      const sp = tr.speed * (0.8 + 0.2 * Math.sin(tr.phase));
      tr.vel.set(Math.sin(tr.yaw) * sp, 0, Math.cos(tr.yaw) * sp);
      tr.pos.addScaledVector(tr.vel, dt);
      // keep in water: a gentle, continuous outward drift only right at the edge
      const sb = H(tr.pos.x, tr.pos.z);
      const edge = smoothstep(-0.42, -0.3, sb);
      if (edge > 0) tr.pos.addScaledVector(_d.set(tr.pos.x, 0, tr.pos.z).normalize(), dt * 0.6 * edge);
      wantY = Math.max(Math.min(wantY, -0.06), sb + 0.25);
      const vy = (wantY - tr.pos.y);
      tr.pos.y = damp(tr.pos.y, wantY, 1.2, dt);
      tr.pitch = damp(tr.pitch, clamp(-vy * 0.9, -0.5, 0.5) + (tr.state === 'breathe' ? -0.15 : 0), 3, dt);
      tr.roll = damp(tr.roll, clamp(-turn * 0.6, -0.35, 0.35), 2, dt);
      tr.phase += dt * (1.6 + sp * 1.4);
      tr.headUp = damp(tr.headUp, tr.state === 'breathe' || tr.state === 'food' ? 0.25 : 0, 3, dt);
      // pose
      const stroke = Math.sin(tr.phase);
      _e.set(tr.pitch + Math.sin(tr.phase * 2) * 0.03, tr.yaw, tr.roll, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p.set(tr.pos.x, tr.pos.y + stroke * 0.02, tr.pos.z), _q, _s.setScalar(scale));
      shells.add(_m);
      // head
      _e.set(0.1 * Math.sin(tr.phase * 0.5) - tr.headUp, 0.18 * Math.sin(t * 0.4 + tr.phase * 0.2), 0);
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
    // start in its own formation slot, heading along the pod's path (all of them used to start on one
    // spot facing +z and fan out)
    const a = pod.ang - k * 3.2 / pod.R * pod.dir, R = pod.R + ((k % 2) ? 2.2 : -1.2);
    d.pos.set(Math.cos(a) * R, -0.85, Math.sin(a) * R);
    d.yaw = Math.atan2(-Math.sin(a) * pod.dir, Math.cos(a) * pod.dir);
    d.speed = 2.4;   // swim speed, eased (speed used to jump between the formation, chase and eating values)
    d.vy = 0;        // vertical speed: depth follows a critically damped spring, so a dive after a leap
                     // carries on and rounds out instead of stopping dead at -0.9 m
    d.amp = 0.13;    // tail-beat amplitude, eased
    d.launchT = 0; d.launchPitch = 0.95; d.launchSpeed = 8.5; d.pr = 0;
    list.push(d);
    return d;
  }
  /** Critically damped spring of d.pos.y / d.vy toward `target`, solved exactly over the step. */
  function springY(d, target, w, dt) {
    const x = d.pos.y - target, v = d.vy, e = Math.exp(-w * dt), k = (v + w * x) * dt;
    d.pos.y = target + (x + k) * e;
    d.vy = (v - w * k) * e;
  }
  const _tgt = new V3();
  function update(dt, t) {
    pod.ang = (pod.ang + dt * 2.4 / pod.R * pod.dir) % TAU;
    const wob = Math.sin(t * 0.05) * 5;
    let k = 0;
    for (const d of list) {
      const m = d.member;
      const hungry = m ? env.fullness(m) < 0.3 : false;
      const scale = (m ? 0.92 + (m.size - 1) * 0.5 : 0.9) * 1.2;
      d.radius = 1.1 * scale;
      // food (noticed after a wait drawn once per sighting, see the gulls)
      let best = null;
      if (!d.food && d.state === 'pod') {
        let bd = 48;
        for (const f of fx.foods) {
          if (f.state !== 'float') continue;
          const dd = Math.hypot(f.pos.x - d.pos.x, f.pos.z - d.pos.z);
          if (dd < bd && H(f.pos.x, f.pos.z) < -1.3) { bd = dd; best = f; }
        }
      }
      if (!best) d.noticeT = null;
      else {
        if (d.noticeT === null || d.noticeT === undefined) d.noticeT = -Math.log(1 - d.r.next()) / 2;
        if ((d.noticeT -= dt) <= 0) { d.noticeT = null; d.food = best; d.state = 'food'; d.bites = 0; }
      }
      if (d.food && !fx.foods.includes(d.food)) { d.food = null; if (d.state === 'food') d.state = 'pod'; }
      let wantY = -0.85, speed = 2.6, ampT = 0.11 + Math.min(0.08, d.speed * 0.012);
      if (d.state === 'leap') {
        // ballistic arc
        d.lv.y -= 9.8 * dt;
        d.pos.addScaledVector(d.lv, dt);
        const above = d.pos.y > 0;
        if (above !== d.wasAbove) {
          fx.splash(_p.set(d.pos.x, 0, d.pos.z), above ? 16 : 26, above ? 0.9 : 1.2);
          fx.ripple(d.pos.x, d.pos.z, 2.2, 2.2, 0.6);
          if (!above) env.sfx('splash');
          d.wasAbove = above;
        }
        const hs = Math.hypot(d.lv.x, d.lv.z);
        d.pitch = Math.atan2(d.lv.y, hs);
        d.yaw = Math.atan2(d.lv.x, d.lv.z);
        d.phase += dt * 3;
        d.turn = damp(d.turn, 0, 4, dt);
        d.vel.copy(d.lv);
        ampT = 0.05;
        if (d.pos.y < -0.9 && d.lv.y < 0) {
          d.state = d.food ? 'food' : 'pod'; d.leapT = d.r.range(14, 40);
          d.speed = hs; d.vy = d.lv.y; // the swim carries on from the dive
        }
      } else if (d.state === 'launch') {
        // run-up to a leap: sound a little deeper, then pitch up and power along the body axis until it
        // breaks the surface (the leap used to start with a one-frame stop and a 50° pitch snap)
        d.launchT += dt;
        if (d.launchT < 0.9) {
          d.speed = damp(d.speed, 4.2, 2, dt);
          d.pos.x += Math.sin(d.yaw) * d.speed * dt; d.pos.z += Math.cos(d.yaw) * d.speed * dt;
          springY(d, Math.max(-1.7, H(d.pos.x, d.pos.z) + 0.8), 2.6, dt);
          d.pitch = damp(d.pitch, clamp(Math.atan2(d.vy, Math.max(d.speed, 1)), -0.9, 0.9), 6, dt);
          d.vel.set(Math.sin(d.yaw) * d.speed, d.vy, Math.cos(d.yaw) * d.speed);
        } else {
          // pitch up on a critically damped spring: the turn eases in instead of starting at full rate
          const x = d.pitch - d.launchPitch, w = 8, e = Math.exp(-w * dt), kk = (d.pr + w * x) * dt;
          d.pitch = d.launchPitch + (x + kk) * e; d.pr = (d.pr - w * kk) * e;
          d.speed = damp(d.speed, d.launchSpeed, 4, dt);
          const cp = Math.cos(d.pitch);
          d.vel.set(Math.sin(d.yaw) * cp * d.speed, Math.sin(d.pitch) * d.speed, Math.cos(d.yaw) * cp * d.speed);
          d.vy = d.vel.y;
          d.pos.addScaledVector(d.vel, dt);
        }
        d.phase += dt * (2.5 + d.speed * 1.6);
        d.turn = damp(d.turn, 0, 4, dt);
        ampT = 0.17;
        if (d.launchT > 0.9 && (d.pos.y > -0.3 || d.launchT > 2.4)) {
          d.state = 'leap'; d.lv.copy(d.vel); d.wasAbove = d.pos.y > 0;
        }
      } else {
        let spT;
        if (d.state === 'food' && d.food) {
          _tgt.copy(d.food.pos);
          const dist = Math.hypot(_tgt.x - d.pos.x, _tgt.z - d.pos.z);
          // race in, then ease off over the last few metres (speed used to step 5.5 → 2.2 → 0.4)
          spT = clamp(0.4 + dist * 0.55, 0.4, 5.5);
          if (dist < 4) wantY = -0.05;
          if (dist < 1.0 * scale) {
            spT = 0.3;
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
          spT = speed * clamp(Math.hypot(_tgt.x - d.pos.x, _tgt.z - d.pos.z) / 2, 0.2, 1.4);
          d.leapT -= dt;
          if (d.leapT <= 0 && d.state === 'pod' && H(d.pos.x, d.pos.z) < -2.5) {
            d.state = 'launch'; d.launchT = 0; d.pr = 0;
            d.launchPitch = 0.95 + d.r.range(-0.08, 0.08); d.launchSpeed = 8.5 + d.r.range(-0.5, 0.8);
          }
        }
        _d.set(_tgt.x - d.pos.x, 0, _tgt.z - d.pos.z);
        const desiredYaw = Math.atan2(_d.x, _d.z);
        const turn = angleDelta(d.yaw, desiredYaw);
        // turn at up to 1.2 rad/s, easing out at the end of the turn (it used to stop turning abruptly)
        d.yaw = (d.yaw + clamp(turn * (1 - Math.exp(-3 * dt)), -1.2 * dt, 1.2 * dt)) % TAU;
        d.turn = damp(d.turn, clamp(-turn * 0.8, -0.4, 0.4), 3, dt);
        d.speed = damp(d.speed, spT, 1.8, dt);
        d.vel.set(Math.sin(d.yaw) * d.speed, 0, Math.cos(d.yaw) * d.speed);
        d.pos.addScaledVector(d.vel, dt);
        // porpoising: surface briefly every few seconds
        d.pPhase = (d.pPhase + dt * d.pRate) % TAU;
        const surf = Math.pow(Math.max(0, Math.sin(d.pPhase)), 4);
        const wy = d.state === 'food' ? wantY : wantY + surf * 0.95;
        const sb = H(d.pos.x, d.pos.z);
        springY(d, Math.max(wy, sb + 0.6), 2.6, dt);
        if (d.pos.y < sb + 0.35) { d.pos.y = sb + 0.35; d.vy = Math.max(d.vy, 0); }
        d.vel.y = d.vy;
        // the body follows its own climb / dive (continuous with the ballistic pitch after a leap)
        d.pitch = damp(d.pitch, clamp(Math.atan2(d.vy, Math.max(d.speed, 1)), -0.9, 0.9), 6, dt);
        d.phase += dt * (2.5 + d.speed * 1.6);
        const surfaced = d.pos.y > -0.15;
        if (surfaced && !d.wasAbove) { fx.spray(_p.set(d.pos.x, 0.05, d.pos.z), d.vel.x * 0.1, d.vel.z * 0.1, 6, 0.7); fx.ripple(d.pos.x, d.pos.z, 1.6, 1.6, 0.45); }
        d.wasAbove = surfaced;
      }
      d.phase %= TAU; // a sin() phase sent to the GPU as float32: wrap it (screens stay on for days)
      d.amp = damp(d.amp, ampT, 5, dt);
      // pose: model axis +X → heading
      _e.set(0, d.yaw - Math.PI / 2, d.pitch, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(d.pos, _q, _s.setScalar(scale));
      mesh.setMatrixAt(k, _m);
      aDol.setXYZW(k, d.phase, d.amp, d.turn, 0);
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
  // per-fish wander (own rng, so the school layout and colours stay as they were)
  const wr = makeRng(env.seed ^ 0x3b1);
  for (const s of schools) for (const f of s.fish) { f.wob = wr.range(0, TAU); f.wobK = wr.range(0.8, 1.25); f.turnSide = 1; }
  const _want = new V3();
  const MAX_OFF = 1.75, MIN_CRUISE = 0.14;
  return {
    group, schools,
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
          // slow wander with each fish's own offset (it used the tail-beat phase, so the fish weaved at
          // their beat rate)
          _want.x += Math.sin(t * 0.7 * f.wobK + f.wob) * 0.6;
          _want.z += Math.cos(t * 0.6 * f.wobK + f.wob) * 0.6;
          const sb = H(f.pos.x, f.pos.z);
          if (f.pos.y < sb + 0.15) _want.y += 0.5;
          if (f.pos.y > -0.15) _want.y -= 0.5;
          // Never ask for a reversal or a hover: the swimmer then rolled its nose through the vertical and
          // spun (dozens of flips a minute at 30 fps). Turn along an arc on a steady side, keep cruising,
          // and climb or dive at a bounded angle.
          let hx = _want.x, hz = _want.z, hl = Math.hypot(hx, hz);
          const fa = Math.atan2(f.fwd.z, f.fwd.x);
          let da = hl > 1e-4 ? angleDelta(fa, Math.atan2(hz, hx)) : Math.PI * f.turnSide;
          if (Math.abs(da) < Math.PI - 0.5) f.turnSide = da >= 0 ? 1 : -1;
          else da = f.turnSide * Math.abs(da);
          if (Math.abs(da) > MAX_OFF || hl < MIN_CRUISE) {
            const a = fa + clamp(da, -MAX_OFF, MAX_OFF);
            hl = Math.max(hl, MIN_CRUISE);
            hx = Math.cos(a) * hl; hz = Math.sin(a) * hl;
          }
          _want.set(hx, clamp(_want.y, -0.55 * hl, 0.55 * hl), hz);
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
  const _tag = [];
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
      for (const c of crabs.list) _tag.push({ member: c.member, pos: c.pos, radius: c.radius + 0.2 });
      for (const g of birds.gulls) if (g.member) _tag.push({ member: g.member, pos: g.pos, radius: 1.0 });
      for (const tr of turtles.list) _tag.push({ member: tr.member, pos: tr.pos, radius: tr.radius + 0.2 });
      for (const d of dolphins.list) if (d.member) _tag.push({ member: d.member, pos: d.pos, radius: d.radius + 0.2 });
      return _tag;
    },
    dispose() { crabs.dispose(); birds.dispose(); turtles.dispose(); dolphins.dispose(); fish.dispose(); },
  };
}
