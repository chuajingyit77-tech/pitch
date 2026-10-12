// 深蓝 · 珊瑚礁 — open-water visitors: a manta ray gliding overhead and glowing moon jellies at night.
import * as THREE from 'three';
import { clamp, lerp, smoothstep, TAU, quatFromForward, patchMaterial, angleDelta } from '../../lib/util.js';
import { waterize, addDetail, UW_VERT, UW_FRAG, NOISE_GLSL } from './uw.js';

/* ------------------------------------------------------------------ */
/* Manta                                                               */
/* ------------------------------------------------------------------ */
function mantaGeometry(eagle = false) {
  const NS = 48, NU = 18;
  const pos = [], col = [], idx = [];
  const xF = eagle
    ? s => { const a = Math.abs(s); return 0.34 - 0.5 * Math.pow(a, 1.05) + 0.16 * Math.exp(-((s / 0.085) ** 2)); }
    : s => { const a = Math.abs(s); return 0.42 - 0.48 * Math.pow(a, 1.25) + 0.07 * Math.exp(-(((a - 0.13) / 0.045) ** 2)) - 0.035 * Math.exp(-((s / 0.06) ** 2)); };
  const xB = s => { const a = Math.abs(s); return -0.42 + 0.36 * Math.pow(a, 0.75); };
  const black = new THREE.Color('#15171c'), grey = new THREE.Color('#3a3f47'), white = new THREE.Color('#e9edf0'), belly = new THREE.Color('#f2f2ee'), edge = new THREE.Color('#4a4e56');
  const c = new THREE.Color();
  for (const side of [1, -1]) {
    const base = pos.length / 3;
    for (let i = 0; i <= NS; i++) {
      const s = (i / NS) * 2 - 1, a = Math.abs(s);
      for (let j = 0; j <= NU; j++) {
        const u = j / NU;
        const x = lerp(xF(s), xB(s), u);
        const th = (0.12 * Math.pow(1 - a, 1.8) + 0.006) * Math.pow(Math.sin(Math.PI * u), 0.5);
        const arch = 0.045 * (1 - s * s);
        pos.push(x, arch + (side * th) / 2, s);
        if (side > 0) {
          c.copy(black).lerp(grey, 0.25 * Math.sin(u * 3 + s * 5) ** 2);
          // chevron shoulder patches
          const pu = (a - 0.14) / 0.42, pv = u / 0.55;
          if (eagle) c.copy(black).lerp(grey, 0.3);
          else if (pu > 0 && pu < 1 && pv < 1 && pv < pu * 1.3 + 0.15 && pv > pu * 0.5 - 0.2) c.lerp(white, 0.85 * smoothstep(0, 0.15, Math.min(pu, 1 - pu)) * smoothstep(0, 0.15, 1 - pv));
        } else {
          c.copy(belly).lerp(edge, smoothstep(0.75, 1, u) * 0.8 + smoothstep(0.7, 0.98, a) * 0.6);
          if (Math.sin(s * 37) * Math.sin(u * 23) > 0.93) c.lerp(black, 0.7);
        }
        col.push(c.r, c.g, c.b);
      }
    }
    for (let i = 0; i < NS; i++) for (let j = 0; j < NU; j++) {
      const a = base + i * (NU + 1) + j, b = a + 1, cc = a + NU + 1, d = cc + 1;
      if (side > 0) idx.push(a, b, cc, b, d, cc); else idx.push(a, cc, b, b, cc, d);
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // tail
  const tL = eagle ? 1.7 : 0.6;
  const tail = new THREE.CylinderGeometry(0.004, 0.014, tL, 5, 6, true).rotateZ(Math.PI / 2).translate(-0.4 - tL / 2, 0.02, 0);
  tail.deleteAttribute('uv');
  const tc = new Float32Array(tail.getAttribute('position').count * 3).fill(0.1);
  tail.setAttribute('color', new THREE.BufferAttribute(tc, 3));
  const parts = [g, tail];
  // cephalic fins: small curled flaps beside the mouth
  for (const s of eagle ? [] : [1, -1]) {
    const f = new THREE.PlaneGeometry(0.12, 0.05, 4, 1);
    const p = f.getAttribute('position');
    for (let i = 0; i < p.count; i++) { const x = p.getX(i) + 0.06, y = p.getY(i); p.setXYZ(i, 0.43 + x, 0.03 - x * x * 3 + y * 0.2, s * (0.12 + y * 0.3)); }
    f.deleteAttribute('uv');
    f.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.count * 3).fill(0.08), 3));
    f.computeVertexNormals();
    parts.push(f);
  }
  const merged = mergeAll(parts);
  return merged;
}
function mergeAll(geos) {
  let n = 0, ni = 0;
  for (const g of geos) { n += g.getAttribute('position').count; ni += g.index.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), idx = new Uint32Array(ni);
  let o = 0, oi = 0;
  for (const g of geos) {
    pos.set(g.getAttribute('position').array, o * 3);
    nor.set(g.getAttribute('normal').array, o * 3);
    col.set(g.getAttribute('color').array, o * 3);
    const ix = g.index.array;
    for (let i = 0; i < ix.length; i++) idx[oi + i] = ix[i] + o;
    o += g.getAttribute('position').count; oi += ix.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

const EAGLE_GLSL = /* glsl */`
float detailH(vec3 p){ return 0.0; }
vec3 detailCol(vec3 p, float h, vec3 c){
  float lum = dot(c, vec3(0.333));
  vec2 cc = cell2(p.xz * 12.0);
  float spot = smoothstep(0.24, 0.15, cc.x) * (1.0 - step(0.3, lum));
  return mix(c, vec3(0.9, 0.92, 0.95), spot);
}
`;

const _tmpV = new THREE.Vector3();
export class Manta {
  constructor(W, rng, center, { eagle = false } = {}) {
    this.rng = rng;
    this.eagle = eagle;
    this.center = center.clone();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0, envMapIntensity: 0.7, side: THREE.DoubleSide });
    this.u = { uFlap: { value: 0 }, uAmp: { value: 0.22 } };
    patchMaterial(mat, {
      key: 'mantaflap',
      uniforms: this.u,
      vertexHeader: 'uniform float uFlap, uAmp;',
      vertex: {
        '#include <beginnormal_vertex>': /* glsl */`$&
          { float az = abs(position.z); float w = pow(az, 1.6) * uAmp; float ph = uFlap - position.x * 2.0 - az * 0.9;
            float dydx = -cos(ph) * 2.0 * w; float dydz = sign(position.z) * (1.6 * pow(az, 0.6) * uAmp * sin(ph) - cos(ph) * 0.9 * w);
            objectNormal = normalize(objectNormal + vec3(-dydx, 0.0, -dydz) * sign(objectNormal.y + 1e-4)); }`,
        '#include <begin_vertex>': /* glsl */`$&
          { float az = abs(position.z); float ph = uFlap - position.x * 2.0 - az * 0.9;
            transformed.y += sin(ph) * pow(az, 1.6) * uAmp;
            transformed.x -= pow(az, 2.0) * 0.05 * (1.0 + sin(ph)); }`,
      },
    });
    waterize(mat, W, { key: 'manta', rim: 1.0 });
    if (eagle) addDetail(mat, W, { space: 'object', bump: 0, key: 'eaglespots', glsl: EAGLE_GLSL });
    this.mesh = new THREE.Mesh(mantaGeometry(eagle), mat);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.scale = eagle ? rng.range(0.95, 1.15) : rng.range(2.1, 2.5);
    this.theta = rng.range(0, TAU);
    this.mesh.scale.setScalar(this.scale);
    this.mesh.visible = false;
    this.pos = new THREE.Vector3();
    this.dir = new THREE.Vector3(1, 0, 0);
    this.fwd = new THREE.Vector3(1, 0, 0);
    this.quat = new THREE.Quaternion();
    this.t = 0; this.dur = 60; this.wait = 2; this.active = false;
    this.flap = 0; this.roll = 0;
    this.start = new THREE.Vector3(); this.end = new THREE.Vector3(); this.side = new THREE.Vector3();
  }
  begin() {
    const a = this.rng.range(0, TAU);
    this.dir.set(Math.cos(a), 0, Math.sin(a));
    this.side.set(-this.dir.z, 0, this.dir.x);
    const off = this.rng.range(-5, 5);
    this.height = this.center.y + this.rng.range(5.5, 7.5);
    this.start.copy(this.center).addScaledVector(this.dir, -36).addScaledVector(this.side, off);
    this.end.copy(this.center).addScaledVector(this.dir, 36).addScaledVector(this.side, -off * 0.5);
    this.wig = this.rng.range(0, TAU);
    this.dur = 72 / this.rng.range(1.05, 1.3);
    // the first visit starts part-way in so a new viewer meets the manta within half a minute
    this.t = this.first === false ? 0 : this.dur * 0.22; this.first = false; this.active = true;
    this.mesh.visible = true;
  }
  update(dt, time, floorAt) {
    if (this.eagle) return this.updateEagle(dt, time, floorAt);
    if (!this.active) {
      this.wait -= dt;
      if (this.wait <= 0) this.begin();
      return;
    }
    this.t += dt;
    const k = this.t / this.dur;
    if (k >= 1) { this.active = false; this.mesh.visible = false; this.wait = this.rng.range(45, 110); return; }
    const s = k;
    this.pos.lerpVectors(this.start, this.end, s);
    const sway = Math.sin(s * TAU * 1.1 + this.wig) * 3.0;
    this.pos.addScaledVector(this.side, sway);
    this.pos.y = this.height + Math.sin(s * TAU * 0.8 + this.wig) * 1.2;
    // heading from the path derivative
    const dsway = Math.cos(s * TAU * 1.1 + this.wig) * 3.0 * TAU * 1.1 / this.dur;
    const dy = Math.cos(s * TAU * 0.8 + this.wig) * 1.2 * TAU * 0.8 / this.dur;
    const v = 72 / this.dur;
    this.fwd.copy(this.dir).multiplyScalar(v).addScaledVector(this.side, dsway);
    this.fwd.y = dy;
    this.fwd.normalize();
    this.roll = lerp(this.roll, -dsway * 0.35, 1 - Math.exp(-dt));
    quatFromForward(this.quat, this.fwd, this.roll);
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.quat);
    // slow majestic wing beats with glides
    const beat = 0.55 + 0.45 * Math.sin(time * 0.11 + this.wig);
    this.flap += dt * TAU / 5.2 * (0.6 + 0.4 * beat);
    this.u.uFlap.value = this.flap;
    this.u.uAmp.value = lerp(0.07, 0.24, smoothstep(0.2, 0.8, beat));
  }
  /** Spotted eagle ray: endless slow loops over the sand apron around the reef. */
  updateEagle(dt, time, floorAt) {
    this.mesh.visible = true;
    const R0 = 15.5 + 2.2 * Math.sin(this.theta * 2 + 1.3);
    this.theta += dt * 1.05 / R0;
    const th = this.theta;
    const R = 15.5 + 2.2 * Math.sin(th * 2 + 1.3);
    const x = this.center.x + Math.cos(th) * R, z = this.center.z + Math.sin(th) * R;
    const y = Math.max(floorAt(x, z) + 0.75, this.center.y - 30) + 0.25 * Math.sin(time * 0.3);
    _tmpV.set(x, y, z);
    this.fwd.subVectors(_tmpV, this.pos);
    const sp = this.fwd.length();
    if (sp > 1e-4) {
      this.fwd.divideScalar(sp);
      const prev = Math.atan2(this.dir.z, this.dir.x);
      this.dir.lerp(this.fwd, 1 - Math.exp(-2 * dt)).normalize();
      const yawRate = angleDelta(prev, Math.atan2(this.dir.z, this.dir.x)) / Math.max(dt, 1e-3);
      this.roll = lerp(this.roll, clamp(-yawRate * 1.2, -0.4, 0.4), 1 - Math.exp(-dt));
    }
    this.pos.copy(_tmpV);
    quatFromForward(this.quat, this.dir, this.roll);
    this.mesh.position.copy(this.pos);
    this.mesh.quaternion.copy(this.quat);
    const beat = 0.5 + 0.5 * Math.sin(time * 0.17 + 1.0);
    this.flap += dt * TAU / 3.4 * (0.7 + 0.3 * beat);
    this.u.uFlap.value = this.flap;
    this.u.uAmp.value = lerp(0.05, 0.17, smoothstep(0.3, 0.8, beat));
  }
}

/* ------------------------------------------------------------------ */
/* Moon jellies (night)                                                */
/* ------------------------------------------------------------------ */
export class Jellies {
  constructor(W, rng, count, center) {
    this.count = count;
    this.rng = rng;
    this.center = center.clone();
    const prof = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, a = t * Math.PI * 0.5;
      prof.push(new THREE.Vector2(Math.sin(a) * 0.36 * (1 + 0.04 * Math.sin(t * 9)), Math.cos(a) * 0.24 - 0.02));
    }
    prof.push(new THREE.Vector2(0.37, -0.05), new THREE.Vector2(0.34, -0.06));
    const g = new THREE.LatheGeometry(prof, 32);
    const ph = new Float32Array(count), hue = new Float32Array(count);
    for (let i = 0; i < count; i++) { ph[i] = rng.range(0, TAU); hue[i] = rng.next(); }
    g.setAttribute('aPh', new THREE.InstancedBufferAttribute(ph, 1));
    g.setAttribute('aHue', new THREE.InstancedBufferAttribute(hue, 1));
    this.u = { ...W, uNight: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: UW_VERT + /* glsl */`
        attribute float aPh, aHue;
        varying vec3 vN, vWp, vL; varying float vHue, vPulse;
        void main(){
          float pulse = pow(max(sin(uTime * 1.25 + aPh), 0.0), 2.0);
          vec3 p = position;
          float r = length(p.xz);
          p.xz *= 1.0 - 0.2 * pulse * smoothstep(0.0, 0.36, r);
          p.y *= 1.0 + 0.12 * pulse;
          p.y -= 0.03 * pulse * smoothstep(0.25, 0.37, r);
          vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vWp = wp.xyz; vL = position; vHue = aHue; vPulse = pulse;
          vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: UW_FRAG + /* glsl */`
        uniform float uNight;
        varying vec3 vN, vWp, vL; varying float vHue, vPulse;
        void main(){
          vec3 V = normalize(cameraPosition - vWp);
          float fr = pow(1.0 - abs(dot(normalize(vN), V)), 2.2);
          vec3 base = mix(vec3(0.35, 0.7, 1.0), vec3(0.85, 0.45, 1.0), vHue);
          float r = length(vL.xz);
          float ang = atan(vL.z, vL.x);
          // four horseshoe gonads
          float gon = smoothstep(0.05, 0.0, abs(r - 0.12 - 0.02 * cos(ang * 4.0))) * smoothstep(0.2, 0.6, abs(sin(ang * 2.0)));
          float rim = smoothstep(0.3, 0.36, r);
          vec3 col = base * (fr * 0.7 + 0.03) + vec3(1.0, 0.55, 0.85) * gon * 0.45 + base * rim * (0.32 + vPulse * 0.5);
          col *= uNight * (0.6 + 0.4 * vPulse);
          gl_FragColor = vec4(uwAtten(col, vWp), 1.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(g, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    // tentacles as glowing lines
    this.NT = 14; this.NSeg = 7;
    const nv = count * this.NT * this.NSeg * 2;
    this.linePos = new Float32Array(nv * 3);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3).setUsage(THREE.DynamicDrawUsage));
    const lmat = new THREE.LineBasicMaterial({ color: new THREE.Color(0.4, 0.75, 1.2), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false });
    waterize(lmat, W, { caustics: false, tint: false, fog: 'atten', key: 'jline' });
    this.lmat = lmat;
    this.lines = new THREE.LineSegments(lg, lmat);
    this.lines.frustumCulled = false;
    this.items = [];
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, TAU), r = rng.range(3, 13);
      this.items.push({ pos: new THREE.Vector3(center.x + Math.cos(a) * r, center.y + rng.range(1.5, 7), center.z + Math.sin(a) * r), vel: new THREE.Vector3(), ph: ph[i], scale: rng.range(0.55, 1.0), drift: new THREE.Vector3(rng.range(-0.06, 0.06), 0, rng.range(-0.06, 0.06)), tilt: rng.range(-0.25, 0.25), spin: rng.range(0, TAU) });
    }
    this.group = new THREE.Group();
    this.group.add(this.mesh, this.lines);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._e = new THREE.Euler();
  }
  update(dt, time, night, floorAt) {
    const vis = night > 0.02;
    this.group.visible = vis;
    this.u.uNight.value = night;
    this.lmat.opacity = 0.4 * night;
    if (!vis) return;
    const lp = this.linePos;
    let o = 0;
    for (let i = 0; i < this.count; i++) {
      const it = this.items[i];
      const pulse = Math.pow(Math.max(Math.sin(time * 1.25 + it.ph), 0), 2);
      it.vel.y = lerp(it.vel.y, -0.035 + pulse * 0.16, 1 - Math.exp(-2 * dt));
      it.pos.addScaledVector(it.vel, dt).addScaledVector(it.drift, dt);
      const floor = floorAt(it.pos.x, it.pos.z) + 1.5;
      if (it.pos.y < floor) it.pos.y = floor;
      if (it.pos.y > this.center.y + 8.5) it.pos.y -= 0.02;
      const dx = it.pos.x - this.center.x, dz = it.pos.z - this.center.z;
      if (dx * dx + dz * dz > 15 * 15) { it.drift.x = -dx * 0.004; it.drift.z = -dz * 0.004; }
      this._q.setFromEuler(this._e.set(it.tilt * Math.sin(time * 0.2 + it.ph), it.spin + time * 0.05, it.tilt * Math.cos(time * 0.17 + it.ph)));
      this._s.setScalar(it.scale);
      this._m.compose(it.pos, this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
      // tentacles trail below the margin
      const R = 0.34 * it.scale * (1 - 0.2 * pulse);
      for (let k = 0; k < this.NT; k++) {
        const a = (k / this.NT) * TAU + it.spin;
        let x = it.pos.x + Math.cos(a) * R, y = it.pos.y - 0.05 * it.scale, z = it.pos.z + Math.sin(a) * R;
        const len = (k % 3 === 0 ? 1.4 : 0.7) * it.scale;
        for (let sgm = 0; sgm < this.NSeg; sgm++) {
          const f = (sgm + 1) / this.NSeg;
          const nx = it.pos.x + Math.cos(a) * R * (1 - f * 0.3) + Math.sin(time * 0.9 + k + f * 3 + it.ph) * 0.05 * f;
          const ny = it.pos.y - 0.05 * it.scale - len * f - it.vel.y * f * 0.8;
          const nz = it.pos.z + Math.sin(a) * R * (1 - f * 0.3) + Math.cos(time * 0.8 + k * 1.3 + f * 3) * 0.05 * f;
          lp[o++] = x; lp[o++] = y; lp[o++] = z;
          lp[o++] = nx; lp[o++] = ny; lp[o++] = nz;
          x = nx; y = ny; z = nz;
        }
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.lines.geometry.getAttribute('position').needsUpdate = true;
  }
}
