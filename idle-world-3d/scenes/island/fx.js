// 晴岛 effects: 小鱼干 food items, billboard particles (sand puffs, splashes, plankton glow) and ripples.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, GLSL, makeRng } from '../../lib/util.js';
import { driedFishTexture } from './textures.js';
import { waveHeight, swellUniforms, SWELL_GLSL } from './water.js';
import { LAYER_NO_REFLECT, waterUniforms } from './shared.js';
import { fieldUniforms, SWASH_GLSL } from './terrain.js';

const V3 = THREE.Vector3;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new V3(), _p = new V3(), _e = new THREE.Euler();

function buildDriedFish() {
  const s = new THREE.Shape();
  s.moveTo(0.16, 0.0);
  s.quadraticCurveTo(0.14, 0.05, 0.06, 0.055);
  s.quadraticCurveTo(-0.05, 0.05, -0.1, 0.012);
  s.lineTo(-0.16, 0.05);
  s.quadraticCurveTo(-0.15, 0.0, -0.165, -0.05);
  s.lineTo(-0.1, -0.012);
  s.quadraticCurveTo(-0.05, -0.05, 0.06, -0.052);
  s.quadraticCurveTo(0.14, -0.045, 0.16, 0.0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2, curveSegments: 8 });
  g.translate(0, 0, -0.01);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    uv.setXY(i, (p.getX(i) + 0.17) / 0.34, (p.getY(i) + 0.06) / 0.12);
    // slight curl like a real dried fish
    p.setZ(i, p.getZ(i) + p.getX(i) * p.getX(i) * 1.6);
  }
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

export function createFx(env, terrain, props) {
  const group = new THREE.Group();
  group.name = 'fx';
  const H = terrain.height;

  /* ---------------- particles ---------------- */
  const MAXP = Math.round(lerp(260, 600, env.q));
  const base = new THREE.PlaneGeometry(1, 1);
  const pgeo = new THREE.InstancedBufferGeometry();
  pgeo.index = base.index;
  pgeo.setAttribute('position', base.attributes.position);
  pgeo.setAttribute('uv', base.attributes.uv);
  const aP = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4); // xyz, size
  const aC = new THREE.InstancedBufferAttribute(new Float32Array(MAXP * 4), 4); // rgb, alpha
  aP.setUsage(THREE.DynamicDrawUsage); aC.setUsage(THREE.DynamicDrawUsage);
  pgeo.setAttribute('aP', aP); pgeo.setAttribute('aC', aC);
  pgeo.instanceCount = 0;
  const pmat = new THREE.ShaderMaterial({
    vertexShader: /* glsl */`
      attribute vec4 aP; attribute vec4 aC;
      varying vec2 vUv; varying vec4 vC;
      void main() {
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vec3 wp = aP.xyz + (right * position.x + up * position.y) * aP.w;
        vUv = uv; vC = aC;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying vec4 vC;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float a = smoothstep(1.0, 0.15, r) * vC.a;
        if (a < 0.003) discard;
        gl_FragColor = vec4(vC.rgb * a, a);
      }`,
    transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const pmesh = new THREE.Mesh(pgeo, pmat);
  pmesh.frustumCulled = false;
  pmesh.renderOrder = 4;
  pmesh.layers.set(LAYER_NO_REFLECT);
  group.add(pmesh);
  const parts = [];
  for (let i = 0; i < MAXP; i++) parts.push({ alive: false, p: new V3(), v: new V3(), life: 0, age: 0, s0: 0, s1: 0, c: new THREE.Color(), a: 1, g: 0, drag: 0, add: 0 });
  let pCursor = 0;
  function emit(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a = 1, grav = 0, drag = 0) {
    const pt = parts[pCursor]; pCursor = (pCursor + 1) % MAXP;
    pt.alive = true; pt.p.set(x, y, z); pt.v.set(vx, vy, vz); pt.life = life; pt.age = 0; pt.s0 = s0; pt.s1 = s1;
    pt.c.setRGB(r, g, b); pt.a = a; pt.g = grav; pt.drag = drag;
  }
  const rnd = Math.random;
  function sandPuff(pos, n = 14, k = 1) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, sp = (0.4 + rnd() * 1.2) * k;
      emit(pos.x + Math.cos(a) * 0.1, pos.y + 0.05, pos.z + Math.sin(a) * 0.1, Math.cos(a) * sp, 0.3 + rnd() * 0.9 * k, Math.sin(a) * sp,
        0.7 + rnd() * 0.6, 0.12 * k, (0.5 + rnd() * 0.5) * k, 0.95, 0.86, 0.68, 0.75, -0.4, 2.5);
    }
  }
  let glowK = 0;
  function splash(pos, n = 18, k = 1) {
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, sp = (0.3 + rnd() * 1.4) * k;
      const gl = glowK;
      emit(pos.x, pos.y + 0.05, pos.z, Math.cos(a) * sp, (1.6 + rnd() * 2.4) * k, Math.sin(a) * sp,
        0.6 + rnd() * 0.5, 0.06 * k + rnd() * 0.06, 0.12 * k, lerp(0.95, 0.4, gl), lerp(0.98, 1.6, gl), lerp(1.0, 2.6, gl), 0.95, 9.8, 0.6);
    }
    for (let i = 0; i < n / 3; i++) {
      const a = rnd() * TAU;
      emit(pos.x + Math.cos(a) * 0.2, pos.y + 0.1, pos.z + Math.sin(a) * 0.2, Math.cos(a) * 0.4, 0.5 + rnd() * 0.5, Math.sin(a) * 0.4,
        0.9 + rnd() * 0.5, 0.2 * k, 0.9 * k, lerp(0.95, 0.3, glowK), lerp(0.97, 1.2, glowK), lerp(1.0, 2.0, glowK), 0.45, 0.2, 1.8);
    }
  }
  function spray(pos, dirx, dirz, n = 10, k = 1) {
    for (let i = 0; i < n; i++) {
      const sp = (0.5 + rnd() * 2) * k;
      emit(pos.x + (rnd() - 0.5) * 0.4, pos.y, pos.z + (rnd() - 0.5) * 0.4, dirx * sp + (rnd() - 0.5), 1 + rnd() * 2.2 * k, dirz * sp + (rnd() - 0.5),
        0.5 + rnd() * 0.5, 0.05 + rnd() * 0.06, 0.1, lerp(0.95, 0.4, glowK), lerp(0.98, 1.5, glowK), lerp(1.0, 2.4, glowK), 0.9, 9.8, 0.5);
    }
  }

  /* ---------------- ripples ---------------- */
  const MAXR = 40;
  const rgeo0 = new THREE.PlaneGeometry(2, 2, 12, 12); // subdivided: it rides the swell (vertex shader)
  rgeo0.rotateX(-Math.PI / 2);
  const rgeo = new THREE.InstancedBufferGeometry();
  rgeo.index = rgeo0.index;
  rgeo.setAttribute('position', rgeo0.attributes.position);
  rgeo.setAttribute('uv', rgeo0.attributes.uv);
  const aR = new THREE.InstancedBufferAttribute(new Float32Array(MAXR * 4), 4); // x, y, z, radius
  const aRA = new THREE.InstancedBufferAttribute(new Float32Array(MAXR), 1);
  aR.setUsage(THREE.DynamicDrawUsage); aRA.setUsage(THREE.DynamicDrawUsage);
  rgeo.setAttribute('aR', aR); rgeo.setAttribute('aRA', aRA);
  rgeo.instanceCount = 0;
  const rUniforms = { uRipCol: { value: new THREE.Color(1, 1, 1) }, uWTime: waterUniforms.uWTime, ...swellUniforms, ...fieldUniforms };
  const rmat = new THREE.ShaderMaterial({
    uniforms: rUniforms,
    // The rings follow the same swell as the water mesh (a flat quad 2 m wide cut through the waves, so
    // parts of the ring kept vanishing under the surface and popping back as the swell rolled by).
    vertexShader: /* glsl */`
      attribute vec4 aR; attribute float aRA;
      uniform float uWTime;
      uniform vec4 uWaves[4];
      uniform sampler2D tField;
      uniform vec4 uField;
      ${GLSL.noise}
      ${SWASH_GLSL}
      ${SWELL_GLSL}
      varying vec2 vUv; varying float vA;
      void main() {
        vec2 q = aR.xz + position.xz * aR.w;
        vec4 fld = texture2D(tField, (q - uField.xy) * uField.zw);
        float depth = -fld.r;
        float atten = smoothstep(0.3, 5.5, depth) * (1.0 - smoothstep(160.0, 520.0, length(q)));
        // the water grid point the swell carries onto q (fixed point; the swell's slope is < 0.35)
        vec2 g = q;
        for (int i = 0; i < 3; i++) g = q - swellDisp(g, atten).xz;
        float y = swellDisp(g, atten).y + swashHeight(g, -fld.g, uWTime) * (1.0 - smoothstep(1.5, 5.0, depth));
        vUv = uv; vA = aRA;
        gl_Position = projectionMatrix * viewMatrix * vec4(q.x, y + 0.035, q.y, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uRipCol;
      varying vec2 vUv; varying float vA;
      void main() {
        float r = length(vUv - 0.5) * 2.0;
        float ring = smoothstep(0.78, 0.9, r) * (1.0 - smoothstep(0.9, 1.0, r)) + smoothstep(0.5, 0.6, r) * (1.0 - smoothstep(0.6, 0.7, r)) * 0.5;
        float a = ring * vA;
        if (a < 0.003) discard;
        gl_FragColor = vec4(uRipCol * a, a);
      }`,
    transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const rmesh = new THREE.Mesh(rgeo, rmat);
  rmesh.frustumCulled = false;
  rmesh.renderOrder = 3;
  rmesh.layers.set(LAYER_NO_REFLECT);
  group.add(rmesh);
  const ripples = [];
  for (let i = 0; i < MAXR; i++) ripples.push({ alive: false, x: 0, z: 0, age: 0, life: 1, r1: 1, a: 1 });
  let rCursor = 0;
  function ripple(x, z, r1 = 1.2, life = 1.6, a = 0.6) {
    const rp = ripples[rCursor]; rCursor = (rCursor + 1) % MAXR;
    rp.alive = true; rp.x = x; rp.z = z; rp.age = 0; rp.life = life; rp.r1 = r1; rp.a = a;
  }

  /* ---------------- food ---------------- */
  const MAXF = 32;
  const fishGeo = buildDriedFish();
  const fishTex = driedFishTexture();
  const fishMat = new THREE.MeshStandardMaterial({ map: fishTex, roughness: 0.38, metalness: 0.15, emissive: 0x6a3008, emissiveIntensity: 0.6, color: 0xffd9a0 });
  const foodMesh = new THREE.InstancedMesh(fishGeo, fishMat, MAXF);
  foodMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  foodMesh.count = 0;
  foodMesh.castShadow = true;
  foodMesh.frustumCulled = false;
  foodMesh.layers.set(LAYER_NO_REFLECT);
  group.add(foodMesh);
  const foods = [];
  const FOOD_SCALE = 2.3;
  // food draws from its own rng: where a snack lands no longer depends on how many particles happened to
  // be emitted before (Math.random), which made the animals' choices differ from one frame rate to another
  const frnd = (r => () => r.next())(makeRng(env.seed ^ 0xf00d));
  function spawnFood(point, { sound = true } = {}) {
    if (foods.length >= MAXF) foods.shift();
    const onDock = props.onDock(point.x, point.z);
    const ground = onDock ? props.deckY + 0.04 : H(point.x, point.z);
    const land = onDock || ground > 0.02;
    const f = {
      pos: new V3(point.x + (frnd() - 0.5) * 0.3, (land ? ground : 0) + 2.4 + frnd() * 0.6, point.z + (frnd() - 0.5) * 0.3),
      vel: new V3((frnd() - 0.5) * 0.6, -1, (frnd() - 0.5) * 0.6),
      state: 'fall', land, onDock, ground: land ? ground : 0, bites: 4, maxBites: 4,
      yaw: frnd() * TAU, spin: (frnd() - 0.5) * 8, tilt: 0, t: 0, scale: 1, sound,
      claimed: 0, // number of eaters heading here
      // own drift / bob phase (the list index was used, so every floating snack jumped when one was eaten)
      ph: frnd() * TAU, roll: 0, tiltT: 0, fade: 1, tiltR: (frnd() - 0.5) * 0.3,
    };
    foods.push(f);
    return f;
  }
  function biteFood(f) {
    f.bites--;
    f.scale = 0.45 + 0.55 * (f.bites / f.maxBites);
    if (f.land) sandPuff(f.pos, 4, 0.5); else ripple(f.pos.x, f.pos.z, 0.7, 0.8, 0.5);
    if (f.bites <= 0) { const i = foods.indexOf(f); if (i >= 0) foods.splice(i, 1); return true; }
    return false;
  }

  function update(dt, t, { night = 0 } = {}) {
    glowK = night;
    rUniforms.uRipCol.value.setRGB(lerp(0.95, 0.35, night), lerp(0.98, 1.3, night), lerp(1.0, 2.2, night));
    // food
    for (let i = foods.length - 1; i >= 0; i--) {
      const f = foods[i];
      f.t += dt;
      if (f.state === 'fall') {
        f.vel.y -= 9.8 * dt;
        f.pos.addScaledVector(f.vel, dt);
        f.yaw += f.spin * dt;
        f.roll = Math.sin(f.t * 9) * 0.5;
        if (f.pos.y <= f.ground + 0.03) {
          f.pos.y = f.ground + 0.03;
          if (f.land) {
            f.state = 'rest';
            f.tiltT = f.tiltR;
            if (!f.onDock) sandPuff(f.pos, 16, 1);
            if (f.sound) env.sfx(f.onDock ? 'tok' : 'thud');
          } else {
            f.state = 'float';
            splash(f.pos, 14, 0.8);
            ripple(f.pos.x, f.pos.z, 1.6, 1.8, 0.7);
            ripple(f.pos.x, f.pos.z, 1.0, 1.2, 0.5);
            if (f.sound) env.sfx('splash');
          }
        }
      } else if (f.state === 'float') {
        const depth = -H(f.pos.x, f.pos.z);
        f.pos.y = waveHeight(f.pos.x, f.pos.z, t, depth) + 0.02;
        f.pos.x += Math.sin(t * 0.3 + f.ph) * 0.05 * dt;
        f.pos.z += Math.cos(t * 0.27 + f.ph) * 0.05 * dt;
        f.tiltT = Math.sin(t * 1.7 + f.ph) * 0.12;
        f.yaw += Math.sin(t * 0.4 + f.ph) * 0.1 * dt;
        if (depth < 0.02) { // washed ashore
          f.state = 'rest'; f.land = true; f.ground = H(f.pos.x, f.pos.z); f.pos.y = f.ground + 0.03; f.tiltT = 0;
        }
      }
      if (f.state !== 'fall') { // settle from the tumble onto the sand / the swell in a blink, not one frame
        const k = 1 - Math.exp(-14 * dt);
        f.roll += (0 - f.roll) * k; f.tilt += (f.tiltT - f.tilt) * k;
      }
      // eventually washed away: shrink out over the last second and a half instead of vanishing
      if (f.t > 148.5) f.fade = Math.max(0.02, 1 - (f.t - 148.5) / 1.5);
      if (f.t > 150) foods.splice(i, 1);
    }
    foodMesh.count = foods.length;
    for (let i = 0; i < foods.length; i++) {
      const f = foods[i];
      _e.set(f.tilt, f.yaw, f.roll);
      _q.setFromEuler(_e);
      _m.compose(f.pos, _q, _s.setScalar(FOOD_SCALE * f.scale * f.fade));
      foodMesh.setMatrixAt(i, _m);
    }
    foodMesh.instanceMatrix.needsUpdate = true;
    // particles
    let n = 0;
    for (const pt of parts) {
      if (!pt.alive) continue;
      pt.age += dt;
      if (pt.age >= pt.life) { pt.alive = false; continue; }
      pt.v.y -= pt.g * dt;
      pt.v.multiplyScalar(Math.exp(-pt.drag * dt));
      pt.p.addScaledVector(pt.v, dt);
      if (pt.g > 5 && pt.p.y < 0 && pt.v.y < 0) { pt.alive = false; continue; }
      const k = pt.age / pt.life;
      const size = lerp(pt.s0, pt.s1, Math.sqrt(k));
      const a = pt.a * (1 - k) * smoothstep(0, 0.08, pt.age);
      aP.setXYZW(n, pt.p.x, pt.p.y, pt.p.z, size);
      aC.setXYZW(n, pt.c.r, pt.c.g, pt.c.b, a);
      n++;
    }
    pgeo.instanceCount = n;
    aP.needsUpdate = true; aC.needsUpdate = true;
    // ripples
    let m = 0;
    for (const rp of ripples) {
      if (!rp.alive) continue;
      rp.age += dt;
      if (rp.age >= rp.life) { rp.alive = false; continue; }
      const k = rp.age / rp.life;
      aR.setXYZW(m, rp.x, 0, rp.z, lerp(0.15, rp.r1, 1 - Math.pow(1 - k, 2))); // height: vertex shader
      aRA.setX(m, rp.a * (1 - k));
      m++;
    }
    rgeo.instanceCount = m;
    aR.needsUpdate = true; aRA.needsUpdate = true;
  }

  return {
    group, foods, spawnFood, biteFood, sandPuff, splash, spray, ripple, update,
    dispose() {
      base.dispose(); pgeo.dispose(); pmat.dispose(); rgeo0.dispose(); rgeo.dispose(); rmat.dispose();
      fishGeo.dispose(); fishTex.dispose(); fishMat.dispose();
    },
  };
}
