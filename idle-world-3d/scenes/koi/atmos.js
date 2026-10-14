// Layered light for the koi pond: low mist banks drifting over the water at dawn and dusk (computed in the shaders of
// the surfaces they lie on, so they cost no extra fill), soft sun shafts through the cherry tree and the bamboo at
// golden hour (a few thin additive cards that fade toward their ends and with the fog), and at night slowly breathing
// pools of lantern light on the water plus the fireflies' reflections. Everything is built up front; nothing flashes.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, makeRng, createNoise, patchMaterial } from '../../lib/util.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

/* ------------------------------------------------------------------ */
/* Mist                                                                 */
/* ------------------------------------------------------------------ */
/** Tileable two-channel noise (R: broad banks, G: finer wisps). */
function mistNoise(seed, S = 128) {
  const n = createNoise(seed);
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = (x / S) * TAU, b = (y / S) * TAU;
    const p = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)];
    const v1 = n.fbm3(p[0] * 0.9 + p[2] * 0.3, p[1] * 0.9, p[3] * 0.9 + p[2] * 0.6, 4) * 0.5 + 0.5;
    const v2 = n.fbm3(p[0] * 1.8 + 5, p[1] * 1.8 + p[3] * 0.6, p[2] * 1.8, 4) * 0.5 + 0.5;
    const o = (y * S + x) * 4;
    data[o] = clamp(v1, 0, 1) * 255; data[o + 1] = clamp(v2, 0, 1) * 255; data[o + 2] = 0; data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}
/** Where mist may lie: over the pond and a metre or so of its banks (soft), as a small clamped texture. */
function mistMask(pond, box, S = 64) {
  const data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const wx = box[0] + (x + 0.5) / S * box[2], wz = box[1] + (y + 0.5) / S * box[3];
    const d = pond.sdf(wx, wz);
    const v = 1 - smoothstep(-0.6, 1.4, d);
    const o = (y * S + x) * 4;
    data[o] = v * 255; data[o + 1] = data[o + 2] = 0; data[o + 3] = 255;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
  t.generateMipmaps = false; t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
  return t;
}

export class Mist {
  constructor(pond) {
    this.pond = pond;
    const box = [-14, -14, 28, 28];
    this.noise = mistNoise(pond.env.seed % 997 + 3);
    this.mask = mistMask(pond, box);
    this.U = {
      uMist: { value: 0 }, uMistH: { value: 0.55 }, uMistCol: { value: new THREE.Color('#cfd8dc') },
      uMistTex: { value: this.noise }, uMistMask: { value: this.mask },
      uMistBox: { value: new THREE.Vector4(box[0], box[1], 1 / box[2], 1 / box[3]) },
      uMistDrift: { value: new THREE.Vector2() },
    };
    this.drift = 0;
  }
  /**
   * Add the mist to a material: the length of the view ray inside the mist layer (0 .. uMistH above the water) above
   * this surface, times a drifting patchy density masked to the pond. `premul`: the water's premultiplied alpha.
   */
  apply(material, { premul = false, under = false, key = '' } = {}) {
    return patchMaterial(material, {
      key: 'koiMist' + (premul ? 'P' : '') + (under ? 'U' : '') + key,
      uniforms: this.U,
      vertexHeader: 'varying vec3 vMistW;',
      // world position from the final view-space position (whatever wind or bend patches did before): works after
      // patches that replace project_vertex outright
      vertex: { '#include <fog_vertex>': '$&\n vMistW = (mvPosition.xyz - viewMatrix[3].xyz) * mat3(viewMatrix);' },
      fragmentHeader: `varying vec3 vMistW;
        uniform float uMist, uMistH; uniform vec3 uMistCol; uniform sampler2D uMistTex, uMistMask; uniform vec4 uMistBox; uniform vec2 uMistDrift;`,
      fragment: {
        '#include <fog_fragment>': /* glsl */`$&
          if (uMist > 0.001) {
            float mhy = vMistW.y;
            // below the water line the water's own surface carries the mist (no double layer at the waterline)
            ${under ? '' : 'if (mhy > 0.0) {'}
            float ml = (uMistH - clamp(mhy, 0.0, uMistH)) * length(vMistW - cameraPosition) / max(cameraPosition.y - vMistW.y, 0.3);
            vec2 mp = vMistW.xz;
            float mmask = texture2D(uMistMask, (mp - uMistBox.xy) * uMistBox.zw).r;
            float mn = texture2D(uMistTex, mp * 0.05 + uMistDrift).r * 0.62 + texture2D(uMistTex, mp * 0.12 - uMistDrift * 1.5 + vec2(0.37, 0.61)).g * 0.48;
            float mm = (1.0 - exp(-uMist * min(ml, 5.0) * smoothstep(0.42, 0.86, mn) * mmask)) * 0.85;
            gl_FragColor.rgb = mix(gl_FragColor.rgb, uMistCol, mm);
            ${premul ? 'gl_FragColor.a = mix(gl_FragColor.a, 1.0, mm);' : ''}
            ${under ? '' : '}'}
          }`,
      },
    });
  }
  update(dt, S, hours, fogColor) {
    // dawn mist is the thickest, dusk lighter, a faint veil at night, none by day
    const dawn = smoothstep(4.6, 5.8, hours) * (1 - smoothstep(7.4, 9.2, hours));
    const dusk = smoothstep(17.2, 18.4, hours) * (1 - smoothstep(20.2, 21.8, hours));
    const night = S.night * 0.3;
    this.U.uMist.value = Math.max(dawn * 0.42, dusk * 0.3, night * 0.4);
    // lit by the sky: pale, warmed a little where the low sun catches it, cool in the blue hour and by moonlight
    const c = this.U.uMistCol.value;
    c.copy(fogColor).lerp(this.pale || (this.pale = new THREE.Color('#dfe6ea')), 0.35).lerp(S.sunColor, S.golden * 0.12).multiplyScalar(lerp(1.0, 0.8, S.night));
    // a slow drift with the breeze (~0.12 m/s). The offset wraps at 4: both layers then move by whole texture tiles
    // (layer 1 by (4, 2), layer 2 at 1.5x by (6, 3)), so the wrap is seamless
    this.drift = (this.drift + dt * 0.006) % 4;
    this.U.uMistDrift.value.set(this.drift, this.drift * 0.5);
  }
  dispose() { this.noise.dispose(); this.mask.dispose(); }
}

/* ------------------------------------------------------------------ */
/* Sun shafts                                                           */
/* ------------------------------------------------------------------ */
export class Shafts {
  constructor(pond) {
    this.pond = pond;
    const r = makeRng(pond.env.seed + 77);
    const n = 6;
    this.n = n;
    // one quad per shaft (two triangles); per-vertex: (t along, s across), per-shaft attributes repeated
    const pos = [], start = [], size = [], seed = [], idx = [];
    for (let i = 0; i < n; i++) {
      const b = pos.length / 3;
      const len = r.range(4.2, 5.6), wid = r.range(0.32, 0.7), sd = i / n + r.range(0, 0.1);
      for (const [t, s] of [[0, -1], [0, 1], [1, -1], [1, 1]]) { pos.push(t, s, 0); start.push(0, 0, 0); size.push(len, wid); seed.push(sd); }
      // wound so the camera-facing billboard is a front face: normal ∝ side × dir points toward the viewer
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.startAttr = new THREE.Float32BufferAttribute(start, 3); this.startAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aStart', this.startAttr);
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 2));
    g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1));
    g.setIndex(idx);
    this.U = { uDir: { value: new THREE.Vector3(0, -1, 0) }, uCol: { value: new THREE.Color() }, uI: { value: 0 }, uT: { value: 0 }, uFogD: { value: 0.012 } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.U, transparent: true, depthWrite: false, depthTest: true,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
      vertexShader: /* glsl */`
        attribute vec3 aStart; attribute vec2 aSize; attribute float aSeed;
        uniform vec3 uDir; uniform float uT, uFogD;
        varying float vT, vS, vK;
        void main(){
          float t = position.x, s = position.y;
          // a slow sway of each shaft (minutes, never a flicker)
          vec3 sway = vec3(sin(uT * 0.05 + aSeed * 6.3), 0.0, cos(uT * 0.04 + aSeed * 5.1)) * 0.15;
          vec3 p0 = aStart + sway + uDir * (t * aSize.x);
          vec3 toCam = normalize(cameraPosition - p0);
          vec3 side = normalize(cross(uDir, toCam) + vec3(1e-5, 0.0, 0.0));
          vec3 p = p0 + side * s * aSize.y * (0.55 + 0.45 * t);
          // brighter when looking toward the light (forward scattering), dimmed by the fog
          vec3 vd = normalize(p - cameraPosition);
          float phase = 0.4 + 0.6 * pow(max(0.0, dot(vd, uDir)), 3.0);
          float dist = length(p - cameraPosition);
          float fog = exp(-uFogD * uFogD * dist * dist);
          vK = phase * fog * (0.8 + 0.2 * sin(uT * 0.13 + aSeed * 12.0));
          vT = t; vS = s;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uCol; uniform float uI;
        varying float vT, vS, vK;
        void main(){
          float across = exp(-vS * vS * 3.2) - 0.04;
          float along = smoothstep(0.0, 0.18, vT) * (1.0 - smoothstep(0.3, 1.0, vT));
          float k = max(across, 0.0) * along * vK * uI;
          gl_FragColor = vec4(uCol * k, 0.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.name = 'sunShafts';
    this.mesh.visible = false;
    pond.scene.add(this.mesh);
    this.geo = g;
    this.seeds = Array.from({ length: n }, (_, i) => r.range(0, 1) + i);
  }
  update(dt, time, S) {
    const P = this.pond;
    // shafts at golden hour (and faintly through the early morning), from the sun's side
    const k = S.golden * smoothstep(-2.5, 1.5, S.elevationDeg) + 0.25 * smoothstep(3, 10, S.elevationDeg) * (1 - smoothstep(18, 28, S.elevationDeg)) * S.day;
    this.U.uI.value = k * 0.55;
    this.mesh.visible = k > 0.01;
    if (!this.mesh.visible) return;
    this.U.uT.value = time % (TAU / 0.01);
    this.U.uFogD.value = P.scene.fog.density;
    // Light falling through the foliage, stylized: along the sun's bearing but at least 40° steep (a low sun's
    // level beams would pass above this high view), each placed so its middle crosses the far side of the garden
    // by the cherry tree, where the view sees it; the lower end fades out before the ground
    const hx = -S.dir.x, hz = -S.dir.z, hl = Math.hypot(hx, hz) || 1;
    const el = Math.max(Math.asin(clamp(S.dir.y, -1, 1)), 0.7);
    const dir = this.U.uDir.value.set(hx / hl * Math.cos(el), -Math.sin(el), hz / hl * Math.cos(el));
    this.U.uCol.value.copy(S.sunColor).multiplyScalar(0.9);
    const A = this.startAttr.array, sizes = this.geo.attributes.aSize.array;
    const fx = P.farDir.x, fz = P.farDir.z, rx = P.rightDir.x, rz = P.rightDir.z;
    for (let i = 0; i < this.n; i++) {
      // middle points: three through the cherry canopy's side of the far shore, three spread along the far bank
      let mx, mz;
      if (i < 3 && P.treeBase) { mx = P.treeBase.x + (i - 1) * 1.1 * rx - fx * 2.4; mz = P.treeBase.z + (i - 1) * 1.1 * rz - fz * 2.4; }
      else { const k = i - 4; mx = P.viewTarget.x + fx * 2.8 + rx * k * 2.6; mz = P.viewTarget.z + fz * 2.8 + rz * k * 2.6; }
      const len = sizes[i * 8];
      _a.set(mx, 1.7 + (i % 2) * 0.35, mz).addScaledVector(dir, -len * 0.42);
      for (let v = 0; v < 4; v++) { A[(i * 4 + v) * 3] = _a.x; A[(i * 4 + v) * 3 + 1] = _a.y; A[(i * 4 + v) * 3 + 2] = _a.z; }
    }
    this.startAttr.needsUpdate = true;
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

/* ------------------------------------------------------------------ */
/* Night: breathing pools of lantern light on the water                 */
/* ------------------------------------------------------------------ */
export class GlowPools {
  constructor(pond) {
    this.pond = pond;
    const n = 1 + (pond.floaters ? pond.floaters.length : 0);
    this.n = n;
    const disc = new THREE.PlaneGeometry(2, 2, 1, 1);
    disc.rotateX(-Math.PI / 2);
    this.glow = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    this.glow.setUsage(THREE.DynamicDrawUsage);
    disc.setAttribute('aGlow', this.glow);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
      uniforms: {},
      vertexShader: /* glsl */`
        attribute vec4 aGlow; varying vec2 vP; varying vec4 vG;
        void main(){ vP = position.xz; vG = aGlow; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        varying vec2 vP; varying vec4 vG;
        void main(){
          float r2 = dot(vP, vP);
          float k = (exp(-r2 * 3.2) - 0.04) * vG.a;
          if (k <= 0.0) discard;
          gl_FragColor = vec4(vG.rgb * k, 0.0);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(disc, this.mat, n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'lanternPools';
    this.mesh.visible = false;
    pond.scene.add(this.mesh);
    this.geo = disc;
    // the stone lantern's pool: on the water just in front of it
    this.lanternPool = new THREE.Vector3();
    if (pond.lanternPos) {
      const p = this.lanternPool.copy(pond.lanternPos).setY(0);
      for (let i = 0; i < 30 && pond.sdf(p.x, p.z) > -0.45; i++) { pond.sdfGrad(p.x, p.z, _a); p.x -= _a.x * 0.08; p.z -= _a.z * 0.08; }
    }
    this.phase = Array.from({ length: n }, (_, i) => i * 1.7 + 0.3);
  }
  update(dt, time, glow) {
    this.mesh.visible = glow > 0.01;
    if (!this.mesh.visible) return;
    const P = this.pond, cam = P.camera.position;
    this.i = 0;
    const warm = this._c || (this._c = new THREE.Color('#ffb062'));
    if (P.lanternPos) {
      // stretched toward the viewer, like the light's reflection lying on the water
      const yaw = Math.atan2(cam.x - this.lanternPool.x, cam.z - this.lanternPool.z);
      this.put(time, this.lanternPool.x, this.lanternPool.z, 0.9, 1.5, yaw, warm, glow * 0.55);
    }
    const fvis = P.floaters && P.floaters.length ? smoothstep(0.3, 0.75, P.sunState ? P.sunState.night : 0) : 0;
    if (P.floaters) for (const f of P.floaters) {
      const g = f.group;
      this.put(time, g.position.x, g.position.z, 0.45, 0.45, 0, warm, (g.visible ? fvis : 0) * 0.4);
    }
    this.mesh.count = this.i;
    this.mesh.instanceMatrix.needsUpdate = true; this.glow.needsUpdate = true;
  }
  put(time, x, z, rx, rz, yaw, col, k) {
    const i = this.i++;
    _q.setFromAxisAngle(_a.set(0, 1, 0), yaw);
    _m.compose(_b.set(x, 0.004, z), _q, _s.set(rx, 1, rz));
    this.mesh.setMatrixAt(i, _m);
    // a slow breath (period ~6-9 s), never a flicker
    const br = 0.8 + 0.2 * Math.sin(time * TAU / (6 + (i % 3) * 1.4) + this.phase[i]);
    this.glow.setXYZW(i, col.r, col.g, col.b, k * br);
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

/* ------------------------------------------------------------------ */
/* Firefly reflections, drawn on the water surface itself               */
/* ------------------------------------------------------------------ */
export class FireflyReflections {
  constructor(pond) {
    this.pond = pond;
    const src = pond.flyPoints.geometry, n = pond.flies.length;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 3);
    this.k = new Float32Array(n);
    this.posAttr = new THREE.BufferAttribute(this.pos, 3); this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.kAttr = new THREE.BufferAttribute(this.k, 1); this.kAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aPhase', src.getAttribute('aPhase'));
    g.setAttribute('aK', this.kAttr);
    const fu = pond.flyMat.uniforms;
    // the fireflies' own blink and sprite size, dimmed and slightly shrunk, only where there is water beneath
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uMap: fu.uMap, uT: fu.uT, uNight: fu.uNight, uScale: fu.uScale },
      vertexShader: 'attribute float aPhase; attribute float aK; varying float vA; uniform float uT, uNight, uScale; void main(){ vA = uNight * aK * pow(max(sin(uT * 1.6 + aPhase * 3.0), 0.0), 3.0); vec4 mv = modelViewMatrix * vec4(position, 1.0); float ps = uScale * 0.11 * 600.0 / max(-mv.z, 0.05) * 0.8; vA *= clamp(ps * ps / 2.25, 0.0, 1.0); gl_PointSize = max(ps, 1.5); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D uMap; varying float vA; void main(){ float a = texture2D(uMap, gl_PointCoord).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(vec3(0.75, 1.0, 0.5) * a * 1.4, a); }',
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.name = 'fireflyReflections';
    this.points.visible = false;
    pond.scene.add(this.points);
    this.geo = g;
  }
  update(glow) {
    this.points.visible = glow > 0.01;
    if (!this.points.visible) return;
    const P = this.pond, C = P.camera.position, src = P.flyPos;
    for (let i = 0; i < P.flies.length; i++) {
      const x = src[i * 3], h = src[i * 3 + 1], z = src[i * 3 + 2];
      // mirror image (x, -h, z) seen from the camera crosses the water plane here
      const t = C.y / Math.max(C.y + h, 1e-3);
      const wx = C.x + (x - C.x) * t, wz = C.z + (z - C.z) * t;
      this.pos[i * 3] = wx; this.pos[i * 3 + 1] = 0.003; this.pos[i * 3 + 2] = wz;
      // only over open water (not under the shore or a rock), softly at the edge
      this.k[i] = h > 0 ? (1 - smoothstep(-0.25, -0.05, P.sdf(wx, wz))) * smoothstep(-0.02, 0.12, P.obstacleGap(wx, wz)) * 0.55 : 0;
    }
    this.posAttr.needsUpdate = true; this.kAttr.needsUpdate = true;
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}
