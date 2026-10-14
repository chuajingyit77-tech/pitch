// 芒原 · small life on the path and round the lanterns.
//
// Sparrows (雀, by day): a little flock hops and pecks along the footpath. They fly up into the maples when a fox
// comes near or an offering drops beside them, and come back down a while later; after a fox has eaten they hop
// over to peck at the crumbs. At dusk they go to roost in the maples, and come down again in the morning.
// Lantern moths (by night): pale motes fluttering in loops round each lit lantern, warm in its light.
import * as THREE from 'three';
import { TAU, clamp, lerp, smoothstep, damp, angleDelta, patchMaterial } from '../../lib/util.js';
import { addFog } from './sky.js';

/* ------------------------------------------------------------------ */
/* Sparrow geometry (local: +z beak, +y up), vertex-coloured           */
/* ------------------------------------------------------------------ */
function sparrowGeometry() {
  const P = [], C = [], W = [];
  const col = new THREE.Color();
  const BACK = new THREE.Color('#7e5330'), BELLY = new THREE.Color('#d6c3a0'), CAP = new THREE.Color('#6e3519'), CHEEK = new THREE.Color('#e6e0d2'),
    BIB = new THREE.Color('#1c1611'), BEAK = new THREE.Color('#2e241a'), TAIL = new THREE.Color('#563621'), WING = new THREE.Color('#8a5c34'), BAR = new THREE.Color('#e8dcc4');
  const tri = (a, b, c, ca, cb, cc, wa = 0, wb = 0, wc = 0) => { P.push(...a, ...b, ...c); C.push(ca.r, ca.g, ca.b, cb.r, cb.g, cb.b, cc.r, cc.g, cc.b); W.push(wa, wb, wc); };
  // an ellipsoid as a low lat-long mesh, coloured per vertex
  const ellip = (cx, cy, cz, rx, ry, rz, nu, nv, paint) => {
    const pt = (i, j) => {
      const u = i / nu * TAU, v = j / nv * Math.PI;
      const x = cx + rx * Math.sin(v) * Math.cos(u), y = cy + ry * Math.cos(v), z = cz + rz * Math.sin(v) * Math.sin(u);
      return [x, y, z];
    };
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      const ca = paint(a, col.clone()), cb = paint(b, col.clone()), cc = paint(c, col.clone()), cd = paint(d, col.clone());
      if (j > 0) tri(a, c, b, ca, cc, cb);
      if (j < nv - 1) tri(a, d, c, ca, cd, cc);
    }
  };
  // body: brown back, buff belly
  ellip(0, 0.045, -0.005, 0.026, 0.024, 0.055, 7, 5, (p, c) => c.copy(BELLY).lerp(BACK, smoothstep(0.036, 0.056, p[1])));
  // head: chestnut cap, white cheek, black bib
  ellip(0, 0.068, 0.045, 0.021, 0.02, 0.022, 7, 5, (p, c) => {
    c.copy(CHEEK);
    if (p[1] > 0.074) c.copy(CAP);
    if (p[1] < 0.062 && p[2] > 0.045) c.copy(BIB);
    return c;
  });
  // beak
  tri([-0.006, 0.066, 0.062], [0.006, 0.066, 0.062], [0, 0.064, 0.08], BEAK, BEAK, BEAK);
  tri([0, 0.071, 0.063], [-0.006, 0.066, 0.062], [0, 0.064, 0.08], BEAK, BEAK, BEAK);
  tri([0.006, 0.066, 0.062], [0, 0.071, 0.063], [0, 0.064, 0.08], BEAK, BEAK, BEAK);
  // tail, cocked up a little
  tri([-0.013, 0.052, -0.05], [0.013, 0.052, -0.05], [0, 0.066, -0.115], TAIL, TAIL, TAIL);
  tri([0.013, 0.052, -0.05], [-0.013, 0.052, -0.05], [0, 0.066, -0.115], TAIL, TAIL, TAIL);
  // wings (aWing = ±1 at the tips: they fold along the back and spread to flap)
  for (const s of [-1, 1]) {
    const root0 = [s * 0.02, 0.058, 0.025], root1 = [s * 0.02, 0.058, -0.03], tip0 = [s * 0.03, 0.06, -0.01], tip1 = [s * 0.028, 0.06, -0.06];
    tri(root0, root1, tip0, WING, WING, BAR, 0, 0, s);
    tri(root1, tip1, tip0, WING, WING, BAR, 0, s, s);
    tri(root0, tip0, root1, WING, BAR, WING, 0, s, 0);
    tri(root1, tip0, tip1, WING, BAR, WING, 0, s, s);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aWing', new THREE.Float32BufferAttribute(W, 1));
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* Sparrows                                                            */
/* ------------------------------------------------------------------ */
export function createSparrows({ env, scene, fogU, heightAt, rng, pathPoint, perches }) {
  const n = clamp(Math.round(4 + 6 * env.q), 4, 10);
  const geo = sparrowGeometry();
  const flapA = new THREE.InstancedBufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage);
  const idxA = new THREE.InstancedBufferAttribute(Float32Array.from({ length: n }, (_, i) => i), 1);
  geo.setAttribute('aFlap', flapA); geo.setAttribute('aIdx', idxA);
  const U = { uTime: { value: 0 } };
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  // wings: folded along the back on the ground, beating in flight (about 5 beats a second: wing-whirr without
  // strobing at 30 fps) with short glides
  patchMaterial(mat, {
    key: 'sparrowWing', uniforms: U, vertexHeader: 'attribute float aWing; attribute float aFlap; attribute float aIdx; uniform float uTime;',
    vertex: { '#include <begin_vertex>': `$&
      {
        float beat = sin(uTime * 31.4159 + aIdx * 2.1);
        float ang = aFlap * (0.25 + 0.95 * beat);
        float ax = transformed.x;
        if (aWing != 0.0) {
          float sp = 0.05 * aFlap;
          transformed.x = sign(ax) * (0.02 + (abs(ax) - 0.02 + sp) * cos(ang));
          transformed.y += (abs(ax) - 0.02 + sp) * sin(ang);
        }
      }` },
  });
  addFog(mat, fogU, 'mfogSparrow');
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.name = 'sparrows';
  mesh.frustumCulled = false;
  mesh.castShadow = false; mesh.receiveShadow = false;
  scene.add(mesh);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), sc = new THREE.Vector3(), m = new THREE.Matrix4();
  const groundSpot = (r, out) => {
    pathPoint(r.range(0.08, 0.26), out);
    out.x += r.range(-1.0, 1.0); out.z += r.range(-0.6, 0.6);
    out.y = heightAt(out.x, out.z);
    return out;
  };
  const birds = [];
  for (let i = 0; i < n; i++) {
    const r = rng.fork('sparrow' + i);
    const b = { r, i, pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), ctrl: new THREE.Vector3(), mode: 'ground', t: 0, T: 1,
      heading: r.range(0, TAU), wantH: 0, pitch: 0, wait: r.range(0.2, 1.5), peck: 0, peckT: 0, flap: 0, hopH: 0.04, scale: 1, perch: null, react: -1 };
    groundSpot(r, b.pos);
    b.wantH = b.heading;
    birds.push(b);
  }
  let clock = 0;
  const crumbs = { pos: new THREE.Vector3(), t: -1 };
  // a flight lasts long enough that it never tops ~7 m/s (eased in and out); the bird faces its way first
  const startFlight = (b, to, T, arc) => {
    b.mode = 'fly'; b.t = 0; b.hop = null; b.nextHop = null;
    b.T = Math.max(T, b.pos.distanceTo(to) / 4.5);
    b.from.copy(b.pos); b.to.copy(to);
    b.ctrl.lerpVectors(b.from, b.to, 0.5); b.ctrl.y = Math.max(b.from.y, b.to.y) + arc;
  };
  const flee = (b, delay) => { if (b.mode === 'ground' && b.react < 0) b.react = delay; };
  const api = {
    mesh, birds,
    /** an offering dropped at p: birds close by flush */
    onDrop(p) { for (const b of birds) if (b.mode === 'ground' && b.react < 0 && Math.hypot(b.pos.x - p.x, b.pos.z - p.z) < 2.6) flee(b, b.r.range(0, 0.12)); },
    /** a fox has eaten at p: crumbs to peck at, a little later */
    onCrumbs(p) { crumbs.pos.copy(p); crumbs.t = 0; },
    /** threats: [{x, z, r}] bodies the birds keep away from (foxes, the spirit fox, deer) */
    update(dt, t, { day, threats }) {
      clock = (clock + dt) % (TAU * 20);
      U.uTime.value = clock;
      if (crumbs.t >= 0) { crumbs.t += dt; if (crumbs.t > 40) crumbs.t = -1; }
      const roost = day < 0.3;
      let anyVis = false;
      for (const b of birds) {
        const r = b.r;
        // ---- decisions ----
        if (b.mode === 'ground') {
          // (random draws only on events, never per frame: the same choices at any frame rate)
          if (b.react < 0) for (const th of threats) if (b.react < 0 && Math.hypot(b.pos.x - th.x, b.pos.z - th.z) < th.r) flee(b, r.range(0.0, 0.1));
          if (roost && b.react < 0) flee(b, r.range(0, 3));
          if (b.react >= 0) {
            // startled: pick a perch in a maple, turn toward it (a quick hop-turn), then fly
            if (!b.dest) {
              const p = perches[r.int(0, perches.length - 1)];
              b.dest = (b.destV || (b.destV = new THREE.Vector3())).set(p.x + r.range(-0.8, 0.8), p.y + r.range(-0.4, 0.3), p.z + r.range(-0.8, 0.8));
              b.wantH = Math.atan2(b.dest.x - b.pos.x, b.dest.z - b.pos.z);
              b.hop = null; b.nextHop = null;
            }
            b.react -= dt;
            if (b.react < 0 && Math.abs(angleDelta(b.heading, b.wantH)) < 0.45) {
              startFlight(b, b.dest, r.range(1.3, 2.0), r.range(0.6, 1.4));
              b.perch = 'tree';
              b.react = -1; b.dest = null;
              // the rest of the flock goes with it
              for (const o of birds) if (o !== b && o.mode === 'ground' && o.react < 0 && o.pos.distanceTo(b.pos) < 2.2) flee(o, o.r.range(0.05, 0.3));
            }
          }
        } else if (b.mode === 'perch') {
          b.wait -= dt;
          if (!roost && b.wait <= 0) {
            // back down: to the crumbs if there are fresh ones, else somewhere on the path
            let safe = true;
            if (crumbs.t > 3 && crumbs.t < 35) tmp.copy(crumbs.pos).add(tmp2.set(r.range(-0.5, 0.5), 0, r.range(-0.5, 0.5)));
            else groundSpot(r, tmp);
            for (const th of threats) if (Math.hypot(tmp.x - th.x, tmp.z - th.z) < th.r + 0.7) safe = false;
            if (safe) { tmp.y = heightAt(tmp.x, tmp.z); startFlight(b, tmp, r.range(1.5, 2.3), r.range(0.3, 0.8)); b.perch = 'ground'; }
            else b.wait = r.range(1, 3);
          }
        }
        // ---- motion ----
        if (b.mode === 'fly') {
          b.t += dt / b.T;
          const u = Math.min(b.t, 1), s = u * u * (3 - 2 * u), is = 1 - s;
          tmp.copy(b.from).multiplyScalar(is * is).addScaledVector(b.ctrl, 2 * is * s).addScaledVector(b.to, s * s);
          tmp2.subVectors(tmp, b.pos);
          if (tmp2.x * tmp2.x + tmp2.z * tmp2.z > 1e-8) b.wantH = Math.atan2(tmp2.x, tmp2.z);
          const vy = dt > 1e-6 ? tmp2.y / dt : 0, vh = dt > 1e-6 ? Math.hypot(tmp2.x, tmp2.z) / dt : 0;
          b.pitch = damp(b.pitch, -Math.atan2(vy, Math.max(vh, 0.3)) * 0.6, 8, dt);
          b.pos.copy(tmp);
          b.flap = damp(b.flap, u > 0.85 && b.perch === 'tree' ? 0.4 : 1, 10, dt);
          if (u >= 1) {
            // the time this step ran past the landing counts toward the wait (each landing would otherwise be
            // late by up to a frame, more at 30 fps than at 60, and the flock drifted apart by frame rate)
            const over = (b.t - 1) * b.T;
            if (b.perch === 'tree') { b.mode = 'perch'; b.wait = roost ? 1e9 : r.range(5, 12) - over; }
            else { b.mode = 'ground'; b.wait = r.range(0.3, 1.2) - over; }
          }
        } else {
          b.flap = damp(b.flap, 0, 10, dt);
          b.pitch = damp(b.pitch, b.peck > 0 ? 0.55 : 0, 18, dt);
          if (b.mode === 'ground' && b.react < 0) {
            if (b.hop) {
              // a hop: a short exact arc (the same at any frame rate)
              b.hop.t += dt / b.hop.T;
              const u = Math.min(b.hop.t, 1);
              b.pos.lerpVectors(b.hop.a, b.hop.b, u);
              b.pos.y += 4 * b.hop.h * u * (1 - u);
              if (u >= 1) { const over = (b.hop.t - 1) * b.hop.T; b.hop = null; b.wait = (r.chance(0.3) ? r.range(0.05, 0.15) : r.range(0.3, 1.6)) - over; }
            } else if (b.nextHop) {
              // facing the way it will hop: off it goes
              if (Math.abs(angleDelta(b.heading, b.wantH)) < 0.3) { b.hop = b.nextHop; b.nextHop = null; b.hop.t = 0; b.hop.a.copy(b.pos); }
            } else {
              b.wait -= dt;
              b.peckIn = (b.peckIn ?? r.range(0.2, 1.2)) - dt;
              if (b.peck > 0) b.peck -= dt;
              else if (b.peckIn <= 0) { b.peck = r.range(0.12, 0.2) + b.peck; b.peckIn += r.range(0.35, 1.3); }
              if (b.wait <= 0 && b.peck <= 0) {
                // next hop: toward the crumbs while there are any, otherwise a little wander along the path
                let dx, dz;
                if (crumbs.t > 1 && crumbs.t < 35 && b.pos.distanceTo(crumbs.pos) < 7 && b.pos.distanceTo(crumbs.pos) > 0.3) { dx = crumbs.pos.x - b.pos.x; dz = crumbs.pos.z - b.pos.z; }
                else { const a = b.heading + r.range(-1.6, 1.6); dx = Math.sin(a); dz = Math.cos(a); }
                const dl = Math.hypot(dx, dz) || 1, len = r.range(0.08, 0.2);
                const hop = b.nextHop = b.hopObj || (b.hopObj = { a: new THREE.Vector3(), b: new THREE.Vector3(), t: 0, T: 0.15, h: 0.04 });
                hop.a.copy(b.pos); hop.b.set(b.pos.x + dx / dl * len, 0, b.pos.z + dz / dl * len);
                // stay near the path (they like the bare earth)
                pathPoint(0.18, tmp);
                if (hop.b.distanceTo(tmp) > 9) { hop.b.x = b.pos.x - dx / dl * len; hop.b.z = b.pos.z - dz / dl * len; }
                hop.b.y = heightAt(hop.b.x, hop.b.z);
                hop.t = 0; hop.T = r.range(0.12, 0.17); hop.h = r.range(0.025, 0.05);
                b.wantH = Math.atan2(hop.b.x - b.pos.x, hop.b.z - b.pos.z);
              }
            }
          }
        }
        // turn quickly but not instantly (at most 11 rad/s)
        const err = angleDelta(b.heading, b.wantH);
        b.heading += clamp(err * (1 - Math.exp(-25 * dt)), -11 * dt, 11 * dt);
        // roosting birds sit deep in the canopy: shrink them away once they are there (never on open ground)
        b.scale = damp(b.scale, b.mode === 'perch' && roost ? 0 : 1, 2, dt);
        anyVis = anyVis || b.scale > 0.01;
        e.set(b.pitch, b.heading, 0);
        q.setFromEuler(e);
        sc.setScalar(1.15 * b.scale);
        m.compose(b.pos, q, sc);
        mesh.setMatrixAt(b.i, m);
        flapA.array[b.i] = b.flap;
      }
      mesh.visible = anyVis;
      mesh.instanceMatrix.needsUpdate = true;
      flapA.needsUpdate = true;
      void t;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
  return api;
}

/* ------------------------------------------------------------------ */
/* Lantern moths                                                       */
/* ------------------------------------------------------------------ */
export function createMoths({ env, scene, rng, lanterns }) {
  const per = env.q > 0.6 ? 4 : 3;
  const n = per * lanterns.length;
  const geo = new THREE.BufferGeometry();
  const seeds = new Float32Array(n * 4), base = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const L = lanterns[Math.floor(i / per)];
    base[i * 3] = L.x; base[i * 3 + 1] = L.y + 1.18; base[i * 3 + 2] = L.z;
    for (let k = 0; k < 4; k++) seeds[i * 4 + k] = rng.next();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(base, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const U = { uTime: { value: 0 }, uPR: { value: 1 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(1.6, 1.15, 0.7) } };
  // all rates are whole cycles per 40π s, so the clock wraps seamlessly
  const mat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      attribute vec4 aSeed; uniform float uTime, uPR; varying float vA;
      void main() {
        float t = uTime;
        float r = 0.24 + 0.12 * aSeed.x;
        float a = t * (1.5 + aSeed.y) + aSeed.z * 6.2832;
        vec3 p = position + vec3(cos(a) * r, 0.1 * sin(t * 2.0 + aSeed.w * 6.0) + 0.05 * sin(t * 4.5 + aSeed.x * 9.0), sin(a) * r * 0.8);
        // short darts: the loop jitters on two faster waves
        p.x += 0.05 * sin(t * 5.5 + aSeed.w * 11.0); p.z += 0.05 * cos(t * 6.5 + aSeed.y * 7.0);
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float ps = 26.0 * uPR / max(-mv.z, 0.5);
        float pc = max(ps, 2.5);
        gl_PointSize = pc;
        vA = (ps * ps) / (pc * pc) * (0.6 + 0.4 * sin(t * 3.0 + aSeed.x * 20.0));
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uAlpha; varying float vA;
      void main() {
        float r = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, r); a *= a;
        gl_FragColor = vec4(uColor * a * vA * uAlpha, 1.0);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.name = 'lanternMoths';
  pts.frustumCulled = false;
  pts.renderOrder = 7;
  pts.visible = false;
  scene.add(pts);
  let clock = 0;
  return {
    pts,
    update(dt, lampOn, pr) {
      clock = (clock + dt) % (40 * Math.PI);
      U.uTime.value = clock; U.uPR.value = pr;
      U.uAlpha.value = smoothstep(0.3, 0.9, lampOn);
      pts.visible = U.uAlpha.value > 0.003;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
