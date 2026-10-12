// 芒原 · particles and small life: pampas fluff, fireflies, falling maple leaves, Guiding-Wind stream,
// crumb puffs, red dragonflies (akatombo), glow sprites.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, damp, patchMaterial, makeRng } from '../../lib/util.js';
import { addFog } from './sky.js';
import { translucentLambert } from './flora.js';

/* ------------------------------------------------------------------ */
/* GPU drifting points (fluff by day, fireflies by night)              */
/* ------------------------------------------------------------------ */
function driftPoints({ count, rng, color, size, box, blink = false, back = 0 }) {
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seeds[i] = rng.next();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const uniforms = {
    uTime: { value: 0 }, uPR: { value: 1 }, uSize: { value: size },
    uCenter: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...box) },
    uDrift: { value: new THREE.Vector2() }, uColor: { value: new THREE.Color(color) },
    uSunDir: { value: new THREE.Vector3(0, 0.2, -1) }, uBack: { value: back }, uAlpha: { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec4 aSeed;
      uniform float uTime, uPR, uSize; uniform vec3 uCenter, uBox, uSunDir; uniform vec2 uDrift;
      varying float vA; varying float vB;
      void main(){
        vec3 p = aSeed.xyz * uBox - uBox * 0.5;
        float sp = 0.65 + aSeed.w * 0.7;
        p.xz += uDrift * sp;
        p.x += sin(uTime * (0.5 + aSeed.y) + aSeed.z * 20.0) * 0.5;
        p.z += cos(uTime * (0.4 + aSeed.x * 0.5) + aSeed.y * 25.0) * 0.5;
        p.y += sin(uTime * (0.35 + aSeed.w * 0.6) + aSeed.x * 30.0) * 0.35;
        p = mod(p + uBox * 0.5, uBox) - uBox * 0.5;
        vec3 wp = uCenter + p;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mv;
        float d = -mv.z;
        gl_PointSize = uSize * uPR * (0.55 + aSeed.w * 0.9) / max(d, 0.6);
        vec3 e = abs(p) / (uBox * 0.5);
        vA = (1.0 - smoothstep(0.7, 1.0, max(e.x, e.z))) * (1.0 - smoothstep(0.75, 1.0, e.y)) * smoothstep(0.4, 2.0, d);
        ${blink ? 'float ph = uTime * (0.7 + aSeed.w * 1.3) + aSeed.x * 40.0; vA *= pow(max(sin(ph), 0.0), 3.0) * 0.9 + 0.1 * (0.5 + 0.5 * sin(ph * 0.31));' : ''}
        vec3 vd = normalize(wp - cameraPosition);
        vB = pow(max(dot(vd, uSunDir), 0.0), 5.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uBack, uAlpha; varying float vA; varying float vB;
      void main(){
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, r);
        a = a * a * (${blink ? '0.6 + 0.4 * smoothstep(0.18, 0.0, r)' : '1.0'});
        gl_FragColor = vec4(uColor * (1.0 + vB * uBack), a * vA * uAlpha);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 5;
  return { pts, uniforms };
}

/* ------------------------------------------------------------------ */
/* CPU points (stream fluff, crumbs, sparkles)                         */
/* ------------------------------------------------------------------ */
function cpuPoints(max) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 3), sz = new Float32Array(max);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sz, 1).setUsage(THREE.DynamicDrawUsage));
  const uniforms = { uPR: { value: 1 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true,
    vertexShader: /* glsl */`
      attribute float aSize; uniform float uPR; varying vec3 vC;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPR / max(-mv.z, 0.3); }`,
    fragmentShader: /* glsl */`
      varying vec3 vC;
      void main(){ float r = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, r); gl_FragColor = vec4(vC, a * a); }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 6;
  return { pts, pos, col, sz, geo, uniforms };
}

export function createFx({ env, scene, rng, heightAt, fogU, wind, leafTex, discTex, trees, quality }) {
  const q = env.q;
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
  const fx = {};
  const MOONFLUFF = new THREE.Color(0.6, 0.7, 0.9);

  /* ---------------- fluff + fireflies ---------------- */
  const fluff = driftPoints({ count: Math.round(520 * q), rng: rng.fork('fluff'), color: '#fff3dc', size: 34, box: [36, 5, 36], back: 3.5 });
  const flies = driftPoints({ count: Math.round(150 * q), rng: rng.fork('flies'), color: '#c8ff6a', size: 46, box: [26, 2.6, 26], blink: true });
  flies.uniforms.uColor.value.multiplyScalar(5.0);
  scene.add(fluff.pts, flies.pts);

  /* ---------------- falling maple leaves ---------------- */
  const LEAVES = Math.round(90 * Math.max(q, 0.6));
  const STREAM_LEAVES = 36;
  const leafGeo = new THREE.PlaneGeometry(0.11, 0.11);
  const leafMat = new THREE.MeshLambertMaterial({ map: leafTex, side: THREE.DoubleSide, alphaTest: 0.5 });
  patchMaterial(leafMat, {
    key: 'fallLeaf', uniforms: { uTransl: { value: 0.6 }, uWrap: { value: 0.6 } }, fragmentHeader: 'uniform float uTransl, uWrap;',
    fragment: {
      '#include <normal_fragment_begin>': THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''),
      '#include <lights_lambert_pars_fragment>': translucentLambert('1.0'),
    },
  });
  addFog(leafMat, fogU, 'mfogFL');
  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, LEAVES + STREAM_LEAVES);
  leafMesh.frustumCulled = false;
  leafMesh.castShadow = false;
  const leafCols = ['#c0141a', '#d42a16', '#e2501a', '#a80f22', '#e87a1c', '#cf3a14', '#b8301c', '#d8a02a'].map(c => new THREE.Color(c));
  const leaves = [];
  const lrng = rng.fork('leaves');
  for (let i = 0; i < LEAVES + STREAM_LEAVES; i++) {
    const l = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), axis: new THREE.Vector3(), ang: lrng.range(0, TAU), spin: lrng.range(2, 6) * lrng.sign(), phase: lrng.range(0, TAU), stream: i >= LEAVES, active: i < LEAVES, life: 0, scale: lrng.range(0.75, 1.25) };
    l.axis.set(lrng.range(-1, 1), lrng.range(-1, 1), lrng.range(-1, 1)).normalize();
    leafMesh.setColorAt(i, lrng.pick(leafCols).clone().multiplyScalar(lrng.range(0.8, 1.05)));
    leaves.push(l);
  }
  leafMesh.instanceColor.needsUpdate = true;
  scene.add(leafMesh);
  const spawnLeaf = (l, center, initial) => {
    if (trees.length && lrng.chance(0.55)) {
      const t = lrng.pick(trees);
      const c = lrng.pick(t.clusters);
      l.pos.set(t.x + c.p.x + lrng.range(-0.8, 0.8), t.y + c.p.y + lrng.range(-0.4, 0.4), t.z + c.p.z + lrng.range(-0.8, 0.8));
    } else {
      l.pos.set(center.x + lrng.range(-18, 18), center.y + lrng.range(2.5, 7), center.z + lrng.range(-18, 10));
    }
    if (initial) l.pos.y -= lrng.range(0, 3);
    l.vel.set(0, 0, 0);
    l.life = 0;
  };
  const leafCenter = new THREE.Vector3();
  leaves.forEach(l => { if (!l.stream) spawnLeaf(l, leafCenter, true); });

  /* ---------------- Guiding Wind streamers ---------------- */
  const SP = cpuPoints(220);
  scene.add(SP.pts);
  const streamers = [];
  const srng = rng.fork('stream');
  const sFwd = new THREE.Vector3(), sRight = new THREE.Vector3();
  /** Stream of fluff + leaves from around the camera to `to`. */
  fx.stream = (camera, to) => {
    const fwd = sFwd.set(0, 0, -1).applyQuaternion(camera.quaternion); fwd.y = 0; fwd.normalize();
    const right = sRight.set(-fwd.z, 0, fwd.x);
    let leafSlots = leaves.filter(l => l.stream && !l.active);
    for (let i = 0; i < 46; i++) {
      const s = {
        p0: new THREE.Vector3(), p1: new THREE.Vector3(), p2: new THREE.Vector3(), pos: new THREE.Vector3(), to: to.clone(),
        t: -srng.range(0, 1.1), dur: srng.range(1.5, 2.4), orbit: srng.range(0.25, 0.7), phase: srng.range(0, TAU), leaf: null,
        kind: srng.chance(0.25) ? 'leaf' : 'fluff',
      };
      const side = srng.range(-1, 1);
      s.p0.copy(camera.position).addScaledVector(fwd, srng.range(3.5, 7.5)).addScaledVector(right, side * srng.range(2, 6));
      s.p0.y = Math.max(heightAt(s.p0.x, s.p0.z) + 1.2, camera.position.y - srng.range(0.4, 2.2));
      s.p1.lerpVectors(s.p0, to, 0.5).addScaledVector(right, side * srng.range(0.5, 3)).add(tmp.set(0, srng.range(0.8, 2.4), 0));
      s.p2.copy(to).add(tmp.set(srng.range(-0.3, 0.3), 0.35, srng.range(-0.3, 0.3)));
      if (s.kind === 'leaf' && leafSlots.length) { s.leaf = leafSlots.pop(); s.leaf.active = true; s.leaf.life = 0; }
      else s.kind = 'fluff';
      streamers.push(s);
    }
    while (streamers.length > 60) { const s = streamers.shift(); if (s.leaf) s.leaf.active = false; }
  };

  /* ---------------- crumbs / sparkles ---------------- */
  const puffs = [];
  const crumbA = new THREE.Color('#e0a050'), crumbB = new THREE.Color('#ffe7b0');
  fx.puff = (p, n = 14, sparkle = false) => {
    for (let i = 0; i < n; i++) {
      const sp = sparkle && i % 3 === 0;
      puffs.push({ pos: p.clone().add(tmp.set(srng.range(-0.05, 0.05), 0.05, srng.range(-0.05, 0.05))), vel: new THREE.Vector3(srng.range(-0.8, 0.8), srng.range(0.6, 1.8), srng.range(-0.8, 0.8)), life: 0, max: srng.range(0.5, 1.0), col: (sp ? crumbB : crumbA).clone().multiplyScalar(sp ? 3 : 1.2), size: sp ? 70 : srng.range(28, 45) });
    }
    while (puffs.length > 150) puffs.shift();
  };

  /* ---------------- red dragonflies ---------------- */
  const DF = Math.round(14 * Math.max(q, 0.5));
  const body = new THREE.BoxGeometry(0.009, 0.009, 0.085); body.translate(0, 0, -0.01);
  const head = new THREE.SphereGeometry(0.009, 6, 4); head.translate(0, 0, 0.036);
  const bodyGeo = mergeSimple([body, head]);
  const bodyMat = addFog(new THREE.MeshLambertMaterial({ color: '#c8281a', emissive: '#300804' }), fogU, 'mfogDF');
  const dfBody = new THREE.InstancedMesh(bodyGeo, bodyMat, DF);
  const wingGeo = new THREE.BufferGeometry();
  {
    const P = [], W = [];
    for (const zc of [0.016, 0.004]) for (const s of [-1, 1]) {
      const x0 = s * 0.004, x1 = s * 0.06;
      P.push(x0, 0, zc + 0.006, x1, 0, zc + 0.004, x1, 0, zc - 0.006, x0, 0, zc + 0.006, x1, 0, zc - 0.006, x0, 0, zc - 0.004);
      for (let k = 0; k < 6; k++) W.push(s);
    }
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    wingGeo.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1));
  }
  const wingU = { uTime: { value: 0 } };
  const wingMat = new THREE.MeshBasicMaterial({ color: '#e6eef6', transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false });
  patchMaterial(wingMat, {
    key: 'dfWing', uniforms: wingU, vertexHeader: 'attribute float aWing; uniform float uTime;',
    vertex: { '#include <begin_vertex>': '$&\n float wa = sin(uTime * 55.0 + float(gl_InstanceID) * 1.7) * 0.6 * aWing; float wx = transformed.x; transformed.x = wx * cos(wa); transformed.y = abs(wx) * sin(wa) * aWing;' },
  });
  const dfWing = new THREE.InstancedMesh(wingGeo, wingMat, DF);
  dfBody.frustumCulled = dfWing.frustumCulled = false;
  scene.add(dfBody, dfWing);
  const drng = rng.fork('dragonflies');
  const dflies = [];
  for (let i = 0; i < DF; i++) dflies.push({ pos: new THREE.Vector3(drng.range(-10, 10), 2, drng.range(-4, 14)), goal: new THREE.Vector3(), vel: new THREE.Vector3(), timer: drng.range(0, 2), heading: drng.range(0, TAU), hover: true });

  /* ---------------- songbird flock ---------------- */
  const NB = Math.round(18 * Math.max(q, 0.6));
  const birdGeo = new THREE.BufferGeometry();
  {
    const P = [
      0, 0, 0.1, -0.02, 0.004, -0.01, 0.02, 0.004, -0.01,
      -0.02, 0.004, -0.01, 0, 0, -0.09, 0.02, 0.004, -0.01,
      -0.014, 0, 0.03, -0.15, 0, -0.005, -0.014, 0, -0.03,
      0.014, 0, 0.03, 0.014, 0, -0.03, 0.15, 0, -0.005,
    ];
    const W = [0, 0, 0, 0, 0, 0, 0.1, 1, 0.1, 0.1, 0.1, 1];
    birdGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    birdGeo.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1));
    birdGeo.computeVertexNormals();
  }
  const birdU = { uTime: { value: 0 } };
  const birdMat = new THREE.MeshLambertMaterial({ color: '#2a2420', side: THREE.DoubleSide });
  patchMaterial(birdMat, {
    key: 'songbird', uniforms: birdU, vertexHeader: 'attribute float aWing; uniform float uTime;',
    vertex: { '#include <begin_vertex>': '$&\n float fl = sin(uTime * 17.0 + float(gl_InstanceID) * 2.31); float glide = step(0.0, sin(uTime * 0.9 + float(gl_InstanceID) * 0.7)); transformed.y += aWing * mix(fl * 0.1, 0.012, glide * 0.0 + 0.0) * 1.0;' },
  });
  addFog(birdMat, fogU, 'mfogBird');
  const birds = new THREE.InstancedMesh(birdGeo, birdMat, NB);
  birds.frustumCulled = false;
  scene.add(birds);
  const brng = rng.fork('birds');
  const flock = [];
  for (let i = 0; i < NB; i++) flock.push({ off: new THREE.Vector3(brng.range(-4, 4), brng.range(-1.2, 1.2), brng.range(-4, 4)), ph: brng.range(0, TAU), pos: new THREE.Vector3(), prev: new THREE.Vector3(), heading: 0 });
  const fc = new THREE.Vector3(brng.range(-15, 15), 0, brng.range(-45, -30));
  const leader = new THREE.Vector3(), leaderPrev = new THREE.Vector3();

  /* ---------------- glow sprites (food marker, kitsunebi, lanterns) ---------------- */
  fx.glow = (color, size, intensity = 1) => {
    const m = new THREE.SpriteMaterial({ map: discTex, color: new THREE.Color(color).multiplyScalar(intensity), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const s = new THREE.Sprite(m);
    s.scale.setScalar(size);
    s.renderOrder = 7;
    return s;
  };

  const mtx = new THREE.Matrix4(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), e = new THREE.Euler();
  fx.update = (dt, t, ctx) => {
    const { camera, target, windDir, windSpeed, drift, light, day, night, golden, sunDir, pr } = ctx;
    // fluff / fireflies
    fluff.uniforms.uTime.value = t; flies.uniforms.uTime.value = t;
    fluff.uniforms.uPR.value = pr; flies.uniforms.uPR.value = pr;
    fluff.uniforms.uDrift.value.copy(drift);
    flies.uniforms.uDrift.value.copy(drift).multiplyScalar(0.06);
    tmp.lerpVectors(camera.position, target, 0.55);
    fluff.uniforms.uCenter.value.set(tmp.x, heightAt(tmp.x, tmp.z) + 2.4, tmp.z);
    flies.uniforms.uCenter.value.set(target.x * 0.6 + tmp.x * 0.4, heightAt(tmp.x, tmp.z) + 1.0, target.z * 0.5 + tmp.z * 0.5);
    fluff.uniforms.uSunDir.value.copy(sunDir);
    fluff.uniforms.uColor.value.copy(light).multiplyScalar(0.35 + 0.25 * day).lerp(MOONFLUFF, night * 0.5);
    fluff.uniforms.uAlpha.value = lerp(0.85, 0.25, night);
    fluff.uniforms.uBack.value = 2 + golden * 6;
    flies.uniforms.uAlpha.value = smoothstep(0.25, 0.9, night);
    flies.pts.visible = night > 0.2;

    // falling leaves
    leafCenter.copy(target);
    const wx = windDir.x * windSpeed, wz = windDir.y * windSpeed;
    for (let i = 0; i < leaves.length; i++) {
      const l = leaves[i];
      if (!l.active) { mtx.makeScale(0, 0, 0); leafMesh.setMatrixAt(i, mtx); continue; }
      if (!l.stream) {
        l.life += dt;
        const sway = Math.sin(t * 1.7 + l.phase);
        l.vel.x = damp(l.vel.x, wx * 0.55 + sway * 0.35, 1.5, dt);
        l.vel.z = damp(l.vel.z, wz * 0.55 + Math.cos(t * 1.3 + l.phase) * 0.3, 1.5, dt);
        l.vel.y = damp(l.vel.y, -0.55 - 0.25 * Math.sin(t * 2.3 + l.phase * 2.0), 2, dt);
        l.pos.addScaledVector(l.vel, dt);
        const gy = heightAt(l.pos.x, l.pos.z);
        if (l.pos.y < gy + 0.8 || l.life > 40 || l.pos.distanceToSquared(target) > 40 * 40) spawnLeaf(l, leafCenter, false);
      }
      l.ang += l.spin * dt;
      tmpQ.setFromAxisAngle(l.axis, l.ang);
      sc.setScalar(l.scale * (l.stream ? 1.3 : 1));
      mtx.compose(l.pos, tmpQ, sc);
      leafMesh.setMatrixAt(i, mtx);
    }
    leafMesh.instanceMatrix.needsUpdate = true;

    // streamers
    let np = 0;
    for (let i = streamers.length - 1; i >= 0; i--) {
      const s = streamers[i];
      s.t += dt / s.dur;
      if (s.t < 0) { if (s.leaf) s.leaf.pos.set(0, -999, 0); continue; }
      let a = 1;
      if (s.t <= 1) {
        const u = s.t, iu = 1 - u;
        const k = u * u * (3 - 2 * u) * 0.35 + u * 0.65;
        const ik = 1 - k;
        s.pos.set(0, 0, 0).addScaledVector(s.p0, ik * ik).addScaledVector(s.p1, 2 * ik * k).addScaledVector(s.p2, k * k);
        a = smoothstep(0, 0.15, u);
        void iu;
      } else {
        const o = (s.t - 1) * s.dur;
        const r = s.orbit * Math.max(0, 1 - o / 1.4);
        s.pos.set(s.to.x + Math.cos(s.phase + o * 5) * r, s.to.y + 0.3 + o * (s.kind === 'leaf' ? -0.2 : 0.5), s.to.z + Math.sin(s.phase + o * 5) * r);
        a = 1 - smoothstep(0.6, 1.6, o);
        if (o > 1.6) { streamers.splice(i, 1); if (s.leaf) s.leaf.active = false; continue; }
      }
      if (s.leaf) s.leaf.pos.copy(s.pos);
      else if (np < 200) {
        SP.pos[np * 3] = s.pos.x; SP.pos[np * 3 + 1] = s.pos.y; SP.pos[np * 3 + 2] = s.pos.z;
        const b = (1.6 + golden) * a;
        SP.col[np * 3] = light.r * b; SP.col[np * 3 + 1] = light.g * b * 0.97; SP.col[np * 3 + 2] = light.b * b * 0.9;
        SP.sz[np] = 38;
        np++;
      }
    }
    // crumbs
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.life += dt;
      if (p.life > p.max) { puffs.splice(i, 1); continue; }
      p.vel.y -= 4.5 * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (np < 220) {
        const f = 1 - p.life / p.max;
        SP.pos[np * 3] = p.pos.x; SP.pos[np * 3 + 1] = p.pos.y; SP.pos[np * 3 + 2] = p.pos.z;
        SP.col[np * 3] = p.col.r * f; SP.col[np * 3 + 1] = p.col.g * f; SP.col[np * 3 + 2] = p.col.b * f;
        SP.sz[np] = p.size;
        np++;
      }
    }
    SP.geo.setDrawRange(0, np);
    SP.geo.attributes.position.needsUpdate = SP.geo.attributes.color.needsUpdate = SP.geo.attributes.aSize.needsUpdate = true;
    SP.uniforms.uPR.value = pr;

    // dragonflies: hover, dart, hover; daytime only
    const dfVis = day * (1 - night);
    dfBody.visible = dfWing.visible = dfVis > 0.05;
    wingU.uTime.value = t;
    if (dfBody.visible) {
      for (let i = 0; i < dflies.length; i++) {
        const d = dflies[i];
        d.timer -= dt;
        if (d.timer <= 0) {
          d.hover = !d.hover;
          if (!d.hover) {
            // dart to a new spot between the camera and the torii
            const base = tmp.lerpVectors(camera.position, target, drng.range(0.25, 0.8));
            d.goal.set(base.x + drng.range(-6, 6), 0, base.z + drng.range(-4, 4));
            d.goal.y = heightAt(d.goal.x, d.goal.z) + drng.range(1.3, 2.4);
            d.timer = drng.range(0.4, 0.9);
          } else d.timer = drng.range(0.6, 2.2);
        }
        if (d.hover) {
          d.vel.multiplyScalar(Math.exp(-6 * dt));
          d.vel.x += Math.sin(t * 7 + i) * dt * 0.6; d.vel.y += Math.sin(t * 5 + i * 2) * dt * 0.4;
        } else {
          tmp.subVectors(d.goal, d.pos);
          const dl = tmp.length();
          tmp.multiplyScalar(Math.min(4.5, dl * 4) / Math.max(dl, 1e-3));
          d.vel.lerp(tmp, 1 - Math.exp(-8 * dt));
        }
        d.pos.addScaledVector(d.vel, dt);
        const gy = heightAt(d.pos.x, d.pos.z) + 1.1;
        if (d.pos.y < gy) d.pos.y = gy;
        if (d.vel.lengthSq() > 0.04) d.heading = Math.atan2(d.vel.x, d.vel.z);
        e.set(0, d.heading, 0);
        tmpQ.setFromEuler(e);
        sc.setScalar(1.5);
        mtx.compose(d.pos, tmpQ, sc);
        dfBody.setMatrixAt(i, mtx); dfWing.setMatrixAt(i, mtx);
      }
      dfBody.instanceMatrix.needsUpdate = dfWing.instanceMatrix.needsUpdate = true;
    }
  };
  fx.updateBirds = (dt, t, day) => {
    birds.visible = day > 0.35;
    if (!birds.visible) return;
    birdU.uTime.value = t;
    leaderPrev.copy(leader);
    leader.set(fc.x + Math.sin(t * 0.07) * 38 + Math.sin(t * 0.19) * 8, 9 + Math.sin(t * 0.11) * 3.5, fc.z + Math.sin(t * 0.05 + 1.3) * 16);
    leader.y += heightAt(leader.x, leader.z);
    for (let i = 0; i < flock.length; i++) {
      const b = flock[i];
      b.prev.copy(b.pos);
      b.pos.copy(leader).add(b.off);
      b.pos.x += Math.sin(t * 0.6 + b.ph) * 1.6; b.pos.y += Math.sin(t * 0.9 + b.ph * 2) * 0.6; b.pos.z += Math.cos(t * 0.5 + b.ph) * 1.6;
      tmp.subVectors(b.pos, b.prev);
      if (tmp.lengthSq() > 1e-6) b.heading = Math.atan2(tmp.x, tmp.z);
      e.set(-tmp.y * 2, b.heading, Math.sin(t + b.ph) * 0.3);
      tmpQ.setFromEuler(e);
      sc.setScalar(1);
      mtx.compose(b.pos, tmpQ, sc);
      birds.setMatrixAt(i, mtx);
    }
    birds.instanceMatrix.needsUpdate = true;
  };
  fx.dispose = () => {};
  void quality; void up; void wind;
  return fx;
}

function mergeSimple(geos) {
  const P = [], N = [], I = [];
  let off = 0;
  for (const g0 of geos) {
    const g = g0.index ? g0 : g0;
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) { P.push(p.getX(i), p.getY(i), p.getZ(i)); N.push(n.getX(i), n.getY(i), n.getZ(i)); }
    const idx = g.index;
    if (idx) for (let i = 0; i < idx.count; i++) I.push(idx.getX(i) + off); else for (let i = 0; i < p.count; i++) I.push(i + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  out.setIndex(I);
  return out;
}
