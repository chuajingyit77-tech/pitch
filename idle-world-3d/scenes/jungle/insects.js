// Blue morpho butterflies (plus a few ambient heliconius / sulphurs) and dragonflies.
// One InstancedMesh each; wing flapping happens in the vertex shader from a per-instance angle.
import * as THREE from 'three';
import { TAU, clamp, lerp, damp, makeRng, makeCanvas } from '../../lib/util.js';
import { JG_GLSL } from './shading.js';

/* ------------------------------------------------------------------ */
/* Wing atlas: rows = species, columns = dorsal | ventral               */
/* ------------------------------------------------------------------ */
function wingPath(g, o) {
  // right wing pair in a 128x128 cell; root at left middle, forewing on top (toward the head)
  const P = (x, y) => [o[0] + x, o[1] + y];
  g.beginPath();
  g.moveTo(...P(4, 60));
  g.bezierCurveTo(...P(30, 18), ...P(70, 4), ...P(104, 5));
  g.bezierCurveTo(...P(124, 6), ...P(127, 24), ...P(118, 42));
  g.bezierCurveTo(...P(112, 54), ...P(96, 62), ...P(70, 64));
  // hindwing
  g.bezierCurveTo(...P(100, 72), ...P(118, 92), ...P(108, 110));
  g.bezierCurveTo(...P(96, 126), ...P(60, 126), ...P(36, 116));
  g.bezierCurveTo(...P(18, 106), ...P(8, 86), ...P(4, 66));
  g.closePath();
}
function eyespot(g, x, y, r) {
  g.fillStyle = '#e8c050'; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  g.fillStyle = '#1a120a'; g.beginPath(); g.arc(x, y, r * 0.7, 0, TAU); g.fill();
  g.fillStyle = '#f4f0e0'; g.beginPath(); g.arc(x + r * 0.15, y - r * 0.15, r * 0.22, 0, TAU); g.fill();
}
export function makeWingAtlas() {
  const W = 256, H = 384;
  const c = makeCanvas(W, H);
  const g = c.getContext('2d');
  // --- morpho dorsal
  let o = [0, 0];
  wingPath(g, o); g.save(); g.clip();
  let grd = g.createRadialGradient(20, 64, 4, 30, 64, 120);
  grd.addColorStop(0, '#0d2fa0'); grd.addColorStop(0.25, '#2a7cff'); grd.addColorStop(0.65, '#45b8ff'); grd.addColorStop(1, '#1a5be0');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#06090f'; g.lineWidth = 16; wingPath(g, o); g.stroke();
  g.fillStyle = '#06090f'; g.beginPath(); g.moveTo(40, 0); g.lineTo(128, 0); g.lineTo(128, 40); g.quadraticCurveTo(95, 20, 40, 14); g.fill();
  g.fillStyle = '#e8f0ff';
  for (const [x, y] of [[104, 14], [112, 24], [96, 22], [116, 36], [110, 100], [96, 114]]) { g.beginPath(); g.arc(x, y, 2.2, 0, TAU); g.fill(); }
  g.strokeStyle = 'rgba(0,10,40,0.35)'; g.lineWidth = 1;
  for (let k = 0; k < 7; k++) { g.beginPath(); g.moveTo(6, 63); g.lineTo(60 + k * 10, k < 4 ? 10 + k * 14 : 70 + (k - 4) * 18); g.stroke(); }
  g.restore();
  // --- morpho ventral
  o = [128, 0];
  wingPath(g, o); g.save(); g.clip();
  grd = g.createLinearGradient(128, 0, 256, 128);
  grd.addColorStop(0, '#5a3b20'); grd.addColorStop(0.5, '#7a5530'); grd.addColorStop(1, '#4a301a');
  g.fillStyle = grd; g.fillRect(128, 0, 128, 128);
  g.strokeStyle = 'rgba(30,18,8,0.6)'; g.lineWidth = 4;
  for (let k = 0; k < 3; k++) { g.beginPath(); g.moveTo(128 + 20 + k * 25, 0); g.quadraticCurveTo(128 + 30 + k * 25, 64, 128 + 10 + k * 28, 128); g.stroke(); }
  for (const [x, y, r] of [[60, 30, 7], [86, 40, 6], [70, 84, 8], [92, 100, 7], [50, 104, 6]]) eyespot(g, 128 + x, y, r);
  g.restore();
  // --- heliconius dorsal (black, orange-red forewing patch, yellow band)
  o = [0, 128];
  wingPath(g, o); g.save(); g.clip();
  g.fillStyle = '#0c0a08'; g.fillRect(0, 128, 128, 128);
  g.fillStyle = '#e8501a'; g.beginPath(); g.ellipse(48, 128 + 40, 34, 16, -0.4, 0, TAU); g.fill();
  g.fillStyle = '#ffd34a'; g.beginPath(); g.ellipse(90, 128 + 24, 18, 7, -0.2, 0, TAU); g.fill();
  g.fillStyle = '#ffd34a'; g.beginPath(); g.ellipse(60, 128 + 96, 34, 6, 0.3, 0, TAU); g.fill();
  g.restore();
  // --- heliconius ventral (duller)
  o = [128, 128];
  wingPath(g, o); g.save(); g.clip();
  g.fillStyle = '#2a1a12'; g.fillRect(128, 128, 128, 128);
  g.fillStyle = '#b0502a'; g.beginPath(); g.ellipse(128 + 48, 128 + 40, 34, 16, -0.4, 0, TAU); g.fill();
  g.fillStyle = '#e0c060'; g.beginPath(); g.ellipse(128 + 60, 128 + 96, 34, 6, 0.3, 0, TAU); g.fill();
  g.restore();
  // --- sulphur (yellow both sides)
  for (const [ox, col] of [[0, '#ffe24a'], [128, '#f0d860']]) {
    o = [ox, 256];
    wingPath(g, o); g.save(); g.clip();
    grd = g.createRadialGradient(ox + 20, 256 + 64, 4, ox + 30, 256 + 64, 110);
    grd.addColorStop(0, '#fff1a0'); grd.addColorStop(1, col);
    g.fillStyle = grd; g.fillRect(ox, 256, 128, 128);
    g.fillStyle = '#d07a10'; g.beginPath(); g.arc(ox + 64, 256 + 40, 4, 0, TAU); g.fill();
    g.restore();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/* ------------------------------------------------------------------ */
/* Butterfly geometry: two wing quads (span 1) + a slim body            */
/* ------------------------------------------------------------------ */
function butterflyGeometry() {
  const pos = [], uv = [], part = [], idx = [];
  const quad = (side) => {
    const b = pos.length / 3;
    const xs = [0, 0.5];
    // corners: (x, z): root-back, tip-back, root-front, tip-front
    const pts = [[0, -0.27], [0.5, -0.27], [0, 0.23], [0.5, 0.23]];
    for (const [x, z] of pts) {
      pos.push(side * x, 0, z);
      uv.push(x / 0.5, (z + 0.27) / 0.5);
      part.push(1);
    }
    if (side > 0) idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    else idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  };
  quad(1); quad(-1);
  // body: a thin diamond tube along z
  const segs = 6, L = 0.36;
  const b0 = pos.length / 3;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, z = -0.2 + t * L;
    const r = 0.022 * Math.sin(Math.PI * clamp(t * 1.1, 0, 1)) + 0.006;
    for (let j = 0; j < 4; j++) {
      const a = j / 4 * TAU;
      pos.push(Math.cos(a) * r, Math.sin(a) * r, z);
      uv.push(0.5, 0.5); part.push(0);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < 4; j++) {
    const a = b0 + i * 4 + j, b = b0 + i * 4 + (j + 1) % 4, c = a + 4, d = b + 4;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createButterflyMesh(shared, max, tex) {
  const geo = butterflyGeometry();
  const wing = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  wing.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aWing', wing);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, tWings: { value: tex }, uAmb: { value: new THREE.Color(0.3, 0.35, 0.3) } },
    vertexShader: /* glsl */`
      attribute float aPart; attribute vec4 aWing;
      varying vec2 vUv; varying vec3 vWorldP; varying vec3 vN; varying float vKind; varying float vPart;
      void main(){
        vec3 p = position; vec3 n = vec3(0.0, 1.0, 0.0);
        if (aPart > 0.5) {
          float s = sign(p.x); float r = abs(p.x);
          float ang = aWing.x * (1.0 - 0.15 * (p.z + 0.27));
          p.x = s * r * cos(ang); p.y = r * sin(ang);
          n = normalize(vec3(-s * sin(ang), cos(ang), 0.0));
        } else n = normalize(normal);
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorldP = wp.xyz;
        vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
        vUv = uv; vKind = aWing.y; vPart = aPart;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      ${JG_GLSL}
      uniform sampler2D tWings; uniform vec3 uAmb;
      varying vec2 vUv; varying vec3 vN; varying float vKind; varying float vPart;
      void main(){
        vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 V = normalize(cameraPosition - vWorldP);
        float cookie = jgCookie(vWorldP);
        vec3 L = uLightDirW;
        if (vPart < 0.5) {
          vec3 c = vec3(0.05, 0.04, 0.035) * (uAmb + uLightCol * cookie * max(dot(N, L), 0.0));
          gl_FragColor = vec4(jgFog(c, vWorldP), 1.0);
          return;
        }
        float row = 2.0 - floor(vKind + 0.5);
        vec2 cell = vec2(gl_FrontFacing ? 0.0 : 0.5, row / 3.0);
        vec4 tex = texture2D(tWings, cell + vUv * vec2(0.5, 1.0 / 3.0));
        if (tex.a < 0.5) discard;
        float diff = max(dot(N, L), 0.0);
        float thru = max(dot(-N, L), 0.0) * 0.45;
        vec3 col = tex.rgb * (uAmb * 1.1 + uLightCol * cookie * (diff + thru) * 0.9);
        // structural blue: bright view-dependent flash on the morpho's upper side
        float morpho = (gl_FrontFacing && vKind < 0.5) ? smoothstep(0.05, 0.35, tex.b - tex.r) : 0.0;
        vec3 H = normalize(L + V);
        float ndv = abs(dot(N, V));
        vec3 iri = mix(vec3(0.05, 0.45, 1.0), vec3(0.25, 0.95, 1.0), pow(1.0 - ndv, 2.0));
        float flash = pow(max(dot(N, H), 0.0), 12.0) * cookie;
        col += iri * morpho * (uAmb * 0.7 + uLightCol * cookie * (flash * 1.6 + 0.18));
        gl_FragColor = vec4(jgFog(col, vWorldP), 1.0);
      }`,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.frustumCulled = false;
  return { mesh, wing };
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();

export class Butterfly {
  constructor(member, kind, rng, home) {
    this.member = member; this.kind = kind; this.rng = rng;
    this.pos = home.clone().add(new THREE.Vector3(rng.range(-2, 2), rng.range(0, 1.5), rng.range(-2, 2)));
    this.vel = new THREE.Vector3();
    this.target = this.pos.clone();
    this.phase = rng.next() * TAU;
    this.freq = kind === 0 ? rng.range(4.2, 5.4) : rng.range(6, 8);
    this.angle = 0.5;
    this.state = 'fly';
    this.timer = rng.range(2, 6);
    this.glide = 0;
    this.yaw = rng.next() * TAU;
    this.food = null;
    this.restSpot = null;
    this.biteT = 0;
    this.size = (kind === 0 ? 0.38 : 0.22) * (member ? (0.85 + 0.15 * member.size) : rng.range(0.85, 1.05));
  }
  update(dt, t, ctx) {
    const r = this.rng;
    if (this.state === 'fly') {
      this.timer -= dt;
      if (this.timer <= 0 || this.pos.distanceToSquared(this.target) < 0.3) {
        this.timer = r.range(1.5, 4);
        ctx.pickTarget(this, this.target);
      }
      // seek with erratic wobble
      _v.subVectors(this.target, this.pos);
      const d = _v.length();
      const speed = this.food ? 1.6 : (this.kind === 0 ? 1.3 : 1.6);
      _v.multiplyScalar(speed / Math.max(d, 0.4));
      _v.x += Math.sin(t * 1.3 + this.phase) * 0.7; _v.z += Math.cos(t * 1.1 + this.phase * 1.7) * 0.7;
      this.vel.lerp(_v, 1 - Math.exp(-2.2 * dt));
      // flap: each downstroke gives lift → bouncy flight
      const gl = this.kind === 0 && Math.sin(t * 0.7 + this.phase) > 0.75;
      this.glide = damp(this.glide, gl ? 1 : 0, 5, dt);
      this.phase += dt * this.freq * TAU * (1 - this.glide * 0.85);
      const s = Math.sin(this.phase);
      this.angle = lerp(lerp(-0.25, 1.25, 0.5 + 0.5 * s), 0.12, this.glide);
      this.pos.addScaledVector(this.vel, dt);
      this.pos.y += Math.cos(this.phase) * 0.35 * dt * (1 - this.glide) * this.freq * 0.25;
      if (this.food && !this.food.dead) {
        ctx.foodTarget(this, this.target);
        if (this.pos.distanceTo(this.target) < 0.12) { this.state = 'feed'; this.biteT = r.range(1.5, 3); }
      } else if (this.food) this.food = null;
      if (this.restSpot && this.pos.distanceTo(this.restSpot) < 0.1) { this.state = 'rest'; this.timer = r.range(5, 14) * (ctx.raining && ctx.raining() ? 3 : 1); }
      if (this.vel.lengthSq() > 0.01) this.yaw = Math.atan2(this.vel.x, this.vel.z);
    } else if (this.state === 'feed') {
      if (!this.food || this.food.dead) { this.state = 'fly'; this.food = null; this.timer = 0; }
      else {
        ctx.foodTarget(this, this.target);
        this.pos.lerp(this.target, 1 - Math.exp(-8 * dt));
        this.phase += dt * 1.2;
        this.angle = 1.15 + 0.35 * Math.max(0, Math.sin(this.phase));
        this.biteT -= dt;
        if (this.biteT <= 0) { this.biteT = r.range(2.5, 4.5); ctx.bite(this, this.food); }
      }
    } else if (this.state === 'rest') {
      this.timer -= dt;
      this.phase += dt * 0.8;
      // wings closed (brown underside), occasionally opening to flash blue
      const open = Math.sin(this.phase) > 0.8 ? 1 : 0;
      this.angle = damp(this.angle, open ? 0.25 : 1.5, 4, dt);
      if (this.timer <= 0 || ctx.hasFoodFor(this)) { this.state = 'fly'; this.restSpot = null; this.timer = 0; this.pos.y += 0.05; }
    }
  }
  write(mesh, wing, i) {
    _e.set(this.state === 'fly' ? -this.vel.y * 0.3 : -0.25, this.yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(this.pos, _q, _s.setScalar(this.size));
    mesh.setMatrixAt(i, _m);
    wing.setXYZW(i, this.angle, this.kind, 0, 0);
  }
}

/* ------------------------------------------------------------------ */
/* Dragonflies                                                          */
/* ------------------------------------------------------------------ */
function dragonflyGeometry() {
  const pos = [], part = [], idx = [];
  // body: abdomen + thorax + head as a tapered square tube along +z
  const prof = [[-0.62, 0.012], [-0.4, 0.016], [-0.1, 0.02], [0.0, 0.035], [0.08, 0.04], [0.12, 0.03], [0.16, 0.045], [0.2, 0.02]];
  prof.forEach(([z, r]) => { for (let j = 0; j < 4; j++) { const a = j / 4 * TAU + Math.PI / 4; pos.push(Math.cos(a) * r, Math.sin(a) * r, z); part.push(0); } });
  for (let i = 0; i < prof.length - 1; i++) for (let j = 0; j < 4; j++) {
    const a = i * 4 + j, b = i * 4 + (j + 1) % 4, c = a + 4, d = b + 4;
    idx.push(a, c, b, b, c, d);
  }
  // 4 wings
  const wingQ = (side, z0, len, w) => {
    const b = pos.length / 3;
    pos.push(0.02 * side, 0.02, z0 + w / 2, side * len, 0.02, z0 + w * 0.3, 0.02 * side, 0.02, z0 - w / 2, side * len, 0.02, z0 - w * 0.2);
    part.push(1, 2, 1, 2);
    if (side > 0) idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); else idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  };
  wingQ(1, 0.06, 0.5, 0.09); wingQ(-1, 0.06, 0.5, 0.09); wingQ(1, -0.04, 0.46, 0.11); wingQ(-1, -0.04, 0.46, 0.11);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createDragonflyMesh(shared, max) {
  const geo = dragonflyGeometry();
  const col = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
  geo.setAttribute('aCol', col);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uAmb: { value: new THREE.Color(0.3, 0.35, 0.3) }, uWingPh: { value: 0 } },
    vertexShader: /* glsl */`
      uniform float uWingPh; // (t * 70) mod 2pi from JS: uTime * 70 runs out of float precision within hours
      attribute float aPart; attribute vec4 aCol;
      varying vec3 vWorldP; varying vec3 vN; varying float vPart; varying vec3 vCol; varying vec2 vW;
      void main(){
        vec3 p = position;
        if (aPart > 0.5) {
          float ang = sin(uWingPh + aCol.w * 10.0 + p.z * 4.0) * 0.25 * (aPart - 0.5) * 2.0;
          float r = abs(p.x);
          p.y += r * ang;
        }
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        vWorldP = wp.xyz; vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
        vPart = aPart; vCol = aCol.rgb; vW = vec2(abs(position.x) / 0.5, position.z);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */`
      ${JG_GLSL}
      uniform vec3 uAmb;
      varying vec3 vN; varying float vPart; varying vec3 vCol; varying vec2 vW;
      void main(){
        vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
        vec3 V = normalize(cameraPosition - vWorldP);
        float cookie = jgCookie(vWorldP);
        vec3 L = uLightDirW;
        vec3 H = normalize(L + V);
        if (vPart < 0.5) {
          vec3 c = vCol * (uAmb + uLightCol * cookie * max(dot(N, L), 0.0)) + uLightCol * cookie * pow(max(dot(N, H), 0.0), 40.0) * 0.6;
          gl_FragColor = vec4(jgFog(c, vWorldP), 1.0);
          return;
        }
        float veins = smoothstep(0.92, 1.0, fract(vW.x * 9.0)) * 0.5 + smoothstep(0.9, 1.0, fract(vW.y * 40.0)) * 0.3;
        float stigma = smoothstep(0.86, 0.9, vW.x) * (1.0 - smoothstep(0.95, 0.98, vW.x));
        float ndv = abs(dot(N, V));
        vec3 iri = mix(vec3(0.6, 0.9, 1.0), vec3(1.0, 0.8, 0.95), pow(1.0 - ndv, 2.0));
        vec3 c = iri * (uAmb * 0.8 + uLightCol * cookie * (0.3 + pow(max(dot(N, H), 0.0), 30.0) * 2.0));
        float a = 0.12 + veins * 0.25 + stigma * 0.6 + pow(1.0 - ndv, 3.0) * 0.25;
        c = mix(c, vec3(0.05), stigma);
        gl_FragColor = vec4(jgFog(c, vWorldP), a);
      }`,
    side: THREE.DoubleSide,
    transparent: true,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, col };
}

export class Dragonfly {
  constructor(rng, area) {
    this.rng = rng; this.area = area;
    this.pos = new THREE.Vector3(rng.range(area.x0, area.x1), rng.range(area.y0, area.y1), rng.range(area.z0, area.z1));
    this.target = this.pos.clone();
    this.state = 'hover'; this.timer = rng.range(0.5, 2);
    this.yaw = rng.next() * TAU; this.tyaw = this.yaw;
    this.jit = rng.next() * 100;
  }
  update(dt, t) {
    const r = this.rng, A = this.area;
    this.timer -= dt;
    if (this.state === 'hover') {
      this.pos.x += Math.sin(t * 7 + this.jit) * 0.02 * dt * 10;
      this.pos.y += Math.sin(t * 5.3 + this.jit) * 0.015 * dt * 10;
      if (this.timer <= 0) {
        this.state = 'dart';
        this.target.set(r.range(A.x0, A.x1), r.range(A.y0, A.y1), r.range(A.z0, A.z1));
        _v.subVectors(this.target, this.pos);
        this.tyaw = Math.atan2(_v.x, _v.z);
        this.timer = 2;
      }
    } else {
      this.yaw = this.yaw + Math.atan2(Math.sin(this.tyaw - this.yaw), Math.cos(this.tyaw - this.yaw)) * (1 - Math.exp(-12 * dt));
      this.pos.lerp(this.target, 1 - Math.exp(-4.5 * dt));
      if (this.pos.distanceToSquared(this.target) < 0.01 || this.timer <= 0) { this.state = 'hover'; this.timer = r.range(0.6, 3); }
    }
  }
  write(mesh, i, size) {
    _e.set(0, this.yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(this.pos, _q, _s.setScalar(size));
    mesh.setMatrixAt(i, _m);
  }
}
