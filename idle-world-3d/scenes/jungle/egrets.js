// 雨林 · a flock of white egrets in the vista. They roost in the trees along the ridge; when a gentle giant walks up
// close they lift off one after another, climb and wheel over the valley as a loose flock, and settle again in trees
// further from the giants. By day they also change roosts now and then; at dusk they settle for the night and stay.
// Small and white against the dark canopy and the giants, they give the scale of everything out there.
//
// One InstancedMesh; each bird is a small body with two wings whose flap angle is a per-instance attribute (the
// vertex shader folds the wings), so a bird costs a few triangles and no extra draw call.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, damp } from '../../lib/util.js';
import { JG_GLSL } from './shading.js';
import { VISTA_GLSL } from './far.js';

function birdGeometry() {
  // body along +z (head forward), wings along ±x; aPart: 0 body, 1 inner wing, 2 wing tip
  const pos = [], part = [], idx = [];
  const v = (x, y, z, p) => { pos.push(x, y, z); part.push(p); return pos.length / 3 - 1; };
  // body: a slim double cone with an S-neck tucked in flight (a few triangles)
  const tail = v(0, 0, -0.42, 0), head = v(0, 0.04, 0.46, 0), l = v(0.07, 0, 0, 0), r = v(-0.07, 0, 0, 0), up = v(0, 0.07, 0.02, 0), dn = v(0, -0.07, 0.02, 0);
  idx.push(tail, up, l, tail, r, up, tail, l, dn, tail, dn, r, head, l, up, head, up, r, head, dn, l, head, r, dn);
  // wings: inner panel and tip on each side (tips bend further)
  for (const s of [1, -1]) {
    const a = v(0.05 * s, 0.01, 0.12, 1), b = v(0.05 * s, 0.01, -0.14, 1), c = v(0.5 * s, 0.01, 0.06, 1), d = v(0.5 * s, 0.01, -0.16, 1), e = v(0.95 * s, 0.01, -0.12, 2);
    if (s > 0) idx.push(a, b, c, b, d, c, c, d, e); else idx.push(a, c, b, b, c, d, c, e, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const angleTo = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/**
 * @param perches  [{ pos: Vector3, near }] roosts in the vista's trees
 * @param rng      seeded stream
 */
export function createEgrets(shared, vistaU, perches, rng, { count = 12 } = {}) {
  const roosts = perches.filter(p => p.near && Math.abs(p.th) < 1.0).map(p => ({ pos: p.pos.clone(), th: p.th, taken: 0 }));
  const geo = birdGeometry();
  const wing = new THREE.InstancedBufferAttribute(new Float32Array(count * 2), 2); // flap angle, fold
  wing.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aWing', wing);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, ...vistaU },
    vertexShader: /* glsl */`
      attribute float aPart; attribute vec2 aWing;
      varying vec3 vWorldP; varying vec3 vN;
      void main(){
        vec3 p = position; vec3 n = normal;
        if (aPart > 0.5) {
          // wing: rotate about the body axis by the flap angle (tips a little further), folded in to the body at rest
          float s = sign(p.x);
          float ang = aWing.x * (aPart > 1.5 ? 1.35 : 1.0);
          float r = abs(p.x) * mix(1.0, 0.22, aWing.y);
          p.x = s * r * cos(ang); p.y += r * sin(ang);
          p.z = mix(p.z, p.z - 0.18 * abs(position.x), aWing.y);
          n = normalize(vec3(-s * sin(ang), cos(ang), 0.0));
        }
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorldP = wp.xyz;
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      ${JG_GLSL}
      ${VISTA_GLSL}
      varying vec3 vN;
      void main(){
        vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 V = normalize(cameraPosition - vWorldP);
        vec3 col = vistaLight(vec3(0.78, 0.78, 0.74), N, V, 1.0, 0.5);
        // back-lit feathers glow through
        col += uLightCol * pow(max(dot(-V, uLightDirW), 0.0), 3.0) * 0.25;
        vec3 d = vWorldP - cameraPosition;
        float tSurf = length(d);
        gl_FragColor = vec4(vistaAtmos(col, vWorldP, tSurf, d / tSurf), 1.0);
      }`,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'egrets';
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.layers.set(1);

  const birds = [];
  const pickRoost = (b, avoid, far) => {
    let best = null, bs = -Infinity;
    for (const r of roosts) {
      if (r.taken >= 2) continue;
      let sc = -Math.abs(r.th - b.homeTh) * 0.5 + b.rng.next() * 0.8;
      if (avoid) for (const a of avoid) { const d = Math.hypot(r.pos.x - a.x, r.pos.z - a.z); sc += Math.min(d, far) * 0.06; if (d < 30) sc -= 8; }
      if (sc > bs) { bs = sc; best = r; }
    }
    return best || roosts[0];
  };
  for (let i = 0; i < count; i++) {
    const r = rng.fork('egret' + i);
    const b = { rng: r, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: r.next() * TAU, pitch: 0, bank: 0, flap: r.next() * TAU, wing: 0, fold: 1,
      state: 'perch', roost: null, timer: r.range(40, 160), homeTh: r.range(-0.6, 0.6), target: new THREE.Vector3(), size: r.range(0.85, 1.05), delay: 0, circle: r.next() * TAU };
    b.roost = pickRoost(b, null, 0);
    b.roost.taken++;
    b.pos.copy(b.roost.pos).add(_v.set(r.range(-0.8, 0.8), 0, r.range(-0.8, 0.8)));
    b.perchAt = b.pos.clone();
    birds.push(b);
  }
  const flock = { center: new THREE.Vector3(), alarm: 0 };
  const scare = []; // giant positions this frame

  function takeOff(b, delay, avoid) {
    if (b.state !== 'perch') return;
    b.state = 'rise'; b.delay = delay; b.timer = b.rng.range(14, 26);
    if (b.roost) b.roost.taken--;
    const nr = pickRoost(b, avoid, 120);
    b.roost = nr; nr.taken++;
    b.vel.set(Math.sin(b.yaw) * 2, 3.5, Math.cos(b.yaw) * 2);
  }

  return {
    mesh,
    /** giants: Vector3[] of animals out on the ridge; night: 0..1 */
    update(dt, t, giants, night) {
      scare.length = 0;
      for (const g of giants) scare.push(g);
      // a giant walking up close scares the roost; by day the flock also changes roosts now and then
      for (const b of birds) {
        if (b.state === 'perch') {
          b.timer -= dt;
          let near = Infinity;
          for (const g of scare) near = Math.min(near, Math.hypot(g.x - b.pos.x, g.z - b.pos.z));
          if (near < 26) {
            // the whole roost goes, one after another
            for (const o of birds) if (o.state === 'perch' && o.pos.distanceTo(b.pos) < 30) takeOff(o, o.rng.range(0, 1.6), scare);
          } else if (b.timer <= 0) {
            if (night < 0.5) { for (const o of birds) if (o.state === 'perch' && o.rng.chance(0.85)) takeOff(o, o.rng.range(0, 3), scare); }
            for (const o of birds) if (o.state === 'perch') o.timer = o.rng.range(70, 200);
          }
        }
      }
      for (let i = 0; i < birds.length; i++) {
        const b = birds[i];
        if (b.state === 'perch') {
          // standing on the roost: a few slow adjustments of the wings, settled at night
          b.pos.lerp(b.perchAt, 1 - Math.exp(-4 * dt));
          b.vel.multiplyScalar(Math.exp(-6 * dt));
          b.fold = damp(b.fold, 1, 3, dt);
          b.wing = damp(b.wing, 0.15 + 0.1 * Math.sin(t * 0.7 + i), 3, dt);
          b.pitch = damp(b.pitch, -0.35, 3, dt);
          b.bank = damp(b.bank, 0, 3, dt);
        } else {
          if (b.delay > 0) { b.delay -= dt; continue; }
          b.timer -= dt;
          // the flock circles over the valley for a while, then each bird glides down to its new roost
          const goal = _v;
          if (b.state === 'rise' && b.timer > 0) {
            const c = b.roost.pos;
            b.circle += dt * 0.32;
            goal.set(c.x + Math.cos(b.circle) * 22, c.y + 12 + 3 * Math.sin(b.circle * 1.7), c.z + Math.sin(b.circle) * 14);
          } else {
            b.state = 'land';
            goal.copy(b.roost.pos);
          }
          _v2.subVectors(goal, b.pos);
          const d = _v2.length();
          const sp = b.state === 'land' ? Math.min(7, 1.2 + d * 0.5) : 8.5;
          _v2.multiplyScalar(sp / Math.max(d, 1e-3));
          b.vel.lerp(_v2, 1 - Math.exp(-1.6 * dt));
          b.pos.addScaledVector(b.vel, dt);
          const hs = Math.hypot(b.vel.x, b.vel.z);
          const yawT = Math.atan2(b.vel.x, b.vel.z);
          const turn = angleTo(b.yaw, yawT);
          b.yaw += turn * (1 - Math.exp(-4 * dt));
          b.bank = damp(b.bank, clamp(-turn * 1.4, -0.7, 0.7), 4, dt);
          b.pitch = damp(b.pitch, clamp(-Math.atan2(b.vel.y, Math.max(hs, 0.5)) * 0.6, -0.5, 0.5), 4, dt);
          // flap while climbing or slow, glide when level and fast; the flap clock runs at the bird's own rate
          const effort = clamp(0.35 + b.vel.y * 0.25 + (b.state === 'land' ? 0.25 : 0), 0, 1);
          b.flap = (b.flap + dt * TAU * lerp(1.6, 2.6, effort)) % TAU;
          const glide = smoothstep(0.55, 0.25, effort);
          b.wing = lerp(Math.sin(b.flap) * 0.85, 0.05, glide);
          b.fold = damp(b.fold, 0, 6, dt);
          if (b.state === 'land' && d < 0.6) {
            b.state = 'perch'; b.perchAt = b.roost.pos.clone().add(_v.set(b.rng.range(-0.8, 0.8), 0, b.rng.range(-0.8, 0.8))); b.timer = b.rng.range(60, 180);
          }
        }
        _e.set(b.pitch, b.yaw, b.bank, 'YXZ');
        _q.setFromEuler(_e);
        _m.compose(b.pos, _q, _s.setScalar(b.size));
        mesh.setMatrixAt(i, _m);
        wing.setXY(i, b.wing, b.fold);
      }
      mesh.instanceMatrix.needsUpdate = true;
      wing.needsUpdate = true;
    },
    birds,
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
