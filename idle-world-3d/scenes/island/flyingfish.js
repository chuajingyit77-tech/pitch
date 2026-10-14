// 晴岛 · 飞鱼 — flying fish. A school cruises unseen just under the surface beyond the reef. By day, when something
// big comes near (the dolphins on their round, the whale) a burst of them breaks out and glides away low over the
// swell on stiff, spread fins, tail-tapping the sea once or twice to stretch the glide, then slips back in; now and
// then one goes up on its own. At night they stay down.
//
// One instanced mesh (one draw call). Each fish lives continuously (underwater it is hidden by the sea), so nothing
// ever appears or vanishes; everything is integrated with dt and eased, the same at 30 and 60 fps.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, damp, angleDelta, makeRng } from '../../lib/util.js';
import { LAYER_NO_REFLECT, addUnderwater } from './shared.js';
import { waveHeight } from './water.js';

const V3 = THREE.Vector3;

/** A flying fish, 0.32 m: head +X, back +Y, right +Z; long pectoral fins spread like wings, a forked tail. */
function buildFlyingFish() {
  const pos = [], col = [], idx = [];
  const BACK = [0.06, 0.16, 0.36], BELLY = [0.82, 0.86, 0.9], FIN = [0.5, 0.62, 0.78];
  const push = (x, y, z, c) => { pos.push(x, y, z); col.push(c[0], c[1], c[2]); return pos.length / 3 - 1; };
  const st = [[0.16, 0.004], [0.13, 0.016], [0.08, 0.024], [0.0, 0.026], [-0.08, 0.02], [-0.13, 0.011], [-0.16, 0.006]];
  const NR = 5;
  for (const [x, r] of st) for (let j = 0; j < NR; j++) { const a = j / NR * TAU; push(x, Math.cos(a) * r, Math.sin(a) * r * 0.85, Math.cos(a) > 0 ? BACK : BELLY); }
  for (let i = 0; i < st.length - 1; i++) for (let j = 0; j < NR; j++) {
    const a = i * NR + j, b = i * NR + (j + 1) % NR, c = a + NR, d = b + NR;
    idx.push(a, c, b, b, c, d);
  }
  // pectoral "wings": long and broad, swept back, slightly raised; a forked tail
  for (const s of [-1, 1]) {
    const r = push(0.06, 0.008, s * 0.018, FIN), tip = push(-0.04, 0.03, s * 0.2, FIN), back = push(-0.07, 0.012, s * 0.13, FIN), rt = push(-0.03, 0.006, s * 0.02, FIN);
    if (s > 0) idx.push(r, tip, rt, tip, back, rt); else idx.push(r, rt, tip, tip, rt, back);
    const t0 = push(-0.15, 0, 0, BACK), t1 = push(-0.25, s * 0.06, 0, FIN), t2 = push(-0.21, s * 0.012, 0, FIN);
    idx.push(t0, t1, t2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createFlyingFish(env, { fx }) {
  const q = env.q;
  const rng = makeRng(env.seed ^ 0xf1f1);
  const N = Math.round(lerp(10, 16, q));
  const geo = buildFlyingFish();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.3, side: THREE.DoubleSide, envMapIntensity: 1.1 });
  addUnderwater(mat, { key: 'flyfish' });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  mesh.name = 'flyingFish';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.layers.set(LAYER_NO_REFLECT);

  // the school: wanders round the open water beyond the reef
  const school = { a: rng.range(0, TAU), r: rng.range(42, 60), da: rng.chance(0.5) ? 0.012 : -0.012, x: 0, z: 0 };
  const fish = [];
  for (let i = 0; i < N; i++) {
    const r = makeRng(env.seed ^ (0xf5 + i * 613));
    const f = {
      r, pos: new V3(), vel: new V3(), yaw: r.range(0, TAU), pitch: 0, roll: 0, speed: 2.4, state: 'swim',
      off: new V3(r.range(-4, 4), 0, r.range(-4, 4)), timer: r.range(25, 80), hops: 0, vy: 0, turn: 0, wob: r.range(0, TAU), wantYaw: 0, cool: 0,
      alarm: 0, react: r.range(0.25, 0.6),
    };
    const a = school.a + r.range(-0.08, 0.08);
    f.pos.set(Math.cos(a) * school.r + f.off.x, -1.3, Math.sin(a) * school.r + f.off.z);
    f.vel.set(Math.sin(f.yaw), 0, Math.cos(f.yaw)).multiplyScalar(f.speed);
    fish.push(f);
  }
  const _w = new V3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YZX'), _s = new V3(1, 1, 1);
  const CRUISE = 2.4;

  /** A fish breaks out and glides off along `yaw`. */
  function launch(f, yaw) {
    f.state = 'launch'; f.timer = 0.9; f.hops = f.r.int(0, 2);
    f.wantYaw = f.yaw + angleDelta(f.yaw, yaw); // it turns onto its line while it speeds up (never in one frame)
  }

  function update(dt, t, { day, dolphins, whale, time }) {
    // the school drifts round the island
    school.a = (school.a + school.da * dt) % TAU;
    const sr = school.r + 8 * Math.sin(t * 0.021);
    school.x = Math.cos(school.a) * sr; school.z = Math.sin(school.a) * sr;
    for (let i = 0; i < fish.length; i++) {
      const f = fish[i];
      const surf = waveHeight(f.pos.x, f.pos.z, time);
      // something big close by: after a moment's alarm (a fraction of a second, its own) the fish breaks out away
      // from it (by day). The alarm builds while the threat stays close, so the moment it goes does not hang on
      // which frame happened to land inside the radius first
      if (f.cool > 0) f.cool -= dt;
      else if (f.state === 'swim' && day > 0.3) {
        let fleeYaw = null, spread = 0;
        for (const d of dolphins) {
          const dx = f.pos.x - d.pos.x, dz = f.pos.z - d.pos.z;
          if (dx * dx + dz * dz < 15 * 15) { fleeYaw = Math.atan2(dx, dz); spread = 0.5; break; }
        }
        if (fleeYaw === null && whale && whale.on) {
          const dx = f.pos.x - whale.x, dz = f.pos.z - whale.z;
          if (dx * dx + dz * dz < 32 * 32) { fleeYaw = Math.atan2(dx, dz); spread = 0.6; }
        }
        f.alarm = fleeYaw !== null ? f.alarm + dt : Math.max(0, f.alarm - dt);
        f.timer -= dt;
        if (fleeYaw !== null && f.alarm >= f.react) { f.alarm = 0; launch(f, fleeYaw + f.r.range(-spread, spread)); }
        else if (f.timer <= 0) { f.timer = f.r.range(40, 110); launch(f, f.yaw + f.r.range(-0.8, 0.8)); }
      }
      switch (f.state) {
        case 'swim': {
          // keep with the school, a little below the surface
          _w.set(school.x + f.off.x, 0, school.z + f.off.z).sub(f.pos);
          _w.x += Math.sin(t * 0.3 + f.wob) * 2; _w.z += Math.cos(t * 0.27 + f.wob) * 2;
          const want = Math.atan2(_w.x, _w.z);
          const da = angleDelta(f.yaw, want);
          f.turn = damp(f.turn, clamp(da, -0.8, 0.8), 2, dt);
          f.yaw += f.turn * dt;
          f.speed = damp(f.speed, CRUISE * clamp(0.6 + _w.length() * 0.05, 0.6, 1.4), 1.5, dt);
          f.vy = damp(f.vy, (-1.3 - f.pos.y) * 1.2, 2, dt);
          break;
        }
        case 'launch': {
          // turn onto its line and speed up just under the surface, then angle up through it
          f.timer -= dt;
          const dy = angleDelta(f.yaw, f.wantYaw);
          f.turn = clamp(dy * 6, -4, 4);
          f.yaw += clamp(dy, -4 * dt, 4 * dt);
          f.speed = damp(f.speed, 12.5, 3.2, dt);
          f.vy = damp(f.vy, f.timer < 0.45 ? 3.2 : 0, 4, dt);
          if (f.pos.y > surf) {
            f.state = 'glide'; f.vy = Math.max(f.vy, 2.2);
            fx.emit(f.pos.x, surf + 0.05, f.pos.z, 0, 1.2, 0, 0.5, 0.12, 0.28, 0.55, 1, 0, 0.6, 9.8, 0.05, 0, 0.04, 0.05);
          } else if (f.timer < -1) { f.state = 'swim'; }
          break;
        }
        case 'glide': {
          // low over the swell: lift nearly holds it up, drag slowly bleeds the speed; a tail-tap stretches it
          f.speed = Math.max(4, f.speed - dt * (0.8 + 0.03 * f.speed * f.speed * 0.1));
          f.vy -= dt * (5.5 - 0.3 * f.speed);
          f.turn = damp(f.turn, Math.sin(t * 0.7 + f.wob) * 0.25, 1, dt);
          f.yaw += f.turn * dt;
          if (f.pos.y < surf + 0.1 && f.vy < 0) {
            if (f.hops > 0 && f.speed > 7) {
              f.hops--; f.vy = 1.7; f.speed += 1.5;
              fx.emit(f.pos.x, surf + 0.03, f.pos.z, -Math.sin(f.yaw) * 1.5, 0.8, -Math.cos(f.yaw) * 1.5, 0.45, 0.1, 0.22, 0.5, 1, 0, 0.6, 9.8, 0.05, 0, 0.04, 0.06);
            } else {
              f.state = 'dive'; f.timer = 1.2;
              fx.emit(f.pos.x, surf + 0.05, f.pos.z, 0, 1.4, 0, 0.5, 0.12, 0.3, 0.6, 1, 0, 0.6, 9.8, 0.05, 0, 0.04, 0.05);
            }
          }
          break;
        }
        case 'dive': {
          // back under, slowing to the school's pace
          f.timer -= dt;
          f.speed = damp(f.speed, CRUISE, 1.6, dt);
          f.vy = damp(f.vy, (-1.3 - f.pos.y) * 1.2, 2.5, dt);
          if (f.timer <= 0) { f.state = 'swim'; f.cool = f.r.range(6, 14); }
          break;
        }
      }
      f.vel.set(Math.sin(f.yaw) * f.speed, f.vy, Math.cos(f.yaw) * f.speed);
      f.pos.addScaledVector(f.vel, dt);
      // keep to the open water (out from the reef), always under the island's dolphins' circle or beyond
      const r = Math.hypot(f.pos.x, f.pos.z);
      if (r < 34) { f.pos.x *= 34 / r; f.pos.z *= 34 / r; }
      f.pitch = damp(f.pitch, clamp(Math.atan2(f.vy, Math.max(f.speed, 0.5)), -0.7, 0.7), 8, dt);
      f.roll = damp(f.roll, clamp(-f.turn * 0.8, -0.5, 0.5), 4, dt);
      _e.set(f.roll, f.yaw - Math.PI / 2, f.pitch);
      _q.setFromEuler(_e);
      _m.compose(f.pos, _q, _s);
      mesh.setMatrixAt(i, _m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  return { mesh, fish, update, dispose() { geo.dispose(); mat.dispose(); } };
}
