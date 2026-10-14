// 云海 · small lives: swallows (燕) darting round the pavilion's flying eaves, and butterflies (蝶) visiting the
// peach blossom.
//
// Swallows hunt by day: fast curving dashes round the pavilion, skimming the lawn, sweeping up past the eaves;
// each picks its own next point (never through a roof, the tree or a lantern) and steers to it with a capped
// acceleration, banking with the turn. A crane sweeping close scatters them for a moment. At dusk they go to
// their perches under the pavilion's eaves and sleep there with folded wings until morning.
// Butterflies flutter from blossom to blossom round the crown, land, and slowly open and close their wings; a
// peach lying in the grass draws a few of them down to sip at it. At night they rest folded on the blossoms.
// One instanced draw call for each kind, wing beats in the vertex shader; counts follow env.q.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { TAU, clamp, lerp, smoothstep, damp, angleDelta } from '../../lib/util.js';
import { patchStd } from './common.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const WRAP = 40 * Math.PI;   // wing phases wrap here (sin of phase, half and quarter phase all repeat)

function colored(g, color, part) {
  g.deleteAttribute('uv');
  if (!g.index) { g.deleteAttribute('normal'); g = mergeVertices(g); }
  g.computeVertexNormals();
  const n = g.getAttribute('position').count, c = new THREE.Color(color);
  const col = new Float32Array(n * 3), pa = new Float32Array(n).fill(part);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPart', new THREE.BufferAttribute(pa, 1));
  return g;
}
/** A flat blade from points [x, z] (outline, convex fan from the first point), coloured by fn(x, z). */
function blade(outline, part, colFn, y = 0) {
  const pos = [], col = [], idx = [];
  for (const [x, z] of outline) { pos.push(x, y, z); const c = colFn(x, z); col.push(c.r, c.g, c.b); }
  for (let i = 1; i < outline.length - 1; i++) idx.push(0, i, i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(outline.length).fill(part), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ------------------------------------------------------------------ */
/* Swallows                                                            */
/* ------------------------------------------------------------------ */
// +z forward, wings along x. Steel-blue back, white belly, chestnut throat, long forked tail.
function swallowGeometry() {
  const parts = [];
  const ell = (rx, ry, rz, x, y, z, col, seg = 10) => colored(new THREE.SphereGeometry(1, seg, Math.max(6, seg - 3)).scale(rx, ry, rz).translate(x, y, z), col, 0);
  parts.push(ell(0.03, 0.028, 0.085, 0, 0, 0, '#1b2a4a'));
  parts.push(ell(0.026, 0.02, 0.07, 0, -0.008, -0.004, '#e9e6dc'));
  parts.push(ell(0.026, 0.025, 0.03, 0, 0.008, 0.075, '#1d2c4e'));
  parts.push(ell(0.02, 0.016, 0.018, 0, -0.008, 0.088, '#9c3a20', 8));
  const back = new THREE.Color('#1c2c4f'), under = new THREE.Color('#d8d5cc');
  for (const s of [1, -1]) {
    // a long scimitar wing, swept back; dark above (its two faces are the same blade: shaded by the normal)
    const o = [[0.02, 0.035], [0.08, 0.03], [0.15, -0.005], [0.235, -0.07], [0.2, -0.06], [0.12, -0.035], [0.05, -0.03], [0.02, -0.02]];
    const g = blade(o.map(([x, z]) => [s * x, z]), s > 0 ? 1 : 2, (x) => back.clone().lerp(under, 0.0), 0.012);
    if (s < 0) g.index.array.reverse();
    parts.push(g);
  }
  for (const s of [1, -1]) {
    // forked tail: streamers wide enough to stay a pixel or two at a distance
    const o = [[0.0, -0.06], [0.022, -0.075], [0.05, -0.22], [0.04, -0.222], [0.006, -0.095]];
    const g = blade(o.map(([x, z]) => [s * x, z]), 3, () => back, -0.004);
    if (s < 0) g.index.array.reverse();
    parts.push(g);
  }
  return mergeGeometries(parts);
}
function swallowMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.15, side: THREE.DoubleSide });
  return patchStd(m, shared, {
    key: 'swallow',
    vertexHeader: 'attribute float aPart; attribute vec4 aFly; varying float vUnder;',
    vertex: {
      '#include <begin_vertex>': /* glsl */`$&
        // aFly: wing phase, beat amplitude, fold (0 flying .. 1 perched), unused
        vUnder = (aPart > 0.5 && aPart < 2.5) ? 1.0 : 0.0;
        if (aPart > 0.5 && aPart < 2.5) {
          float side = aPart < 1.5 ? 1.0 : -1.0;
          float span = abs(transformed.x);
          float fold = aFly.z;
          // folded: the wing lies back along the body
          float sx = 0.02 + (span - 0.02) * (1.0 - 0.8 * fold);
          float sz = transformed.z - (span - 0.02) * 0.75 * fold;
          float ang = sin(aFly.x) * aFly.y * (1.0 - fold) * (1.0 + (span - 0.02) * 2.5);
          transformed.x = side * sx * cos(ang);
          transformed.y = transformed.y + sx * sin(ang);
          transformed.z = sz;
        }
        if (aPart > 2.5) transformed.x *= 1.0 + 0.4 * sin(aFly.x * 0.25) * (1.0 - aFly.z);   // the tail fans a little
      `,
    },
    fragmentHeader: 'varying float vUnder;',
    fragment: {
      // pale underwings (the blades' back faces)
      '#include <color_fragment>': '$&\n if (vUnder > 0.5 && !gl_FrontFacing) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.7, 0.66), 0.85);',
    },
  });
}

class Swallow {
  constructor(i, rng, home) {
    this.i = i; this.rng = rng;
    const a = rng.range(0, TAU);
    this.pos = new THREE.Vector3(home.x + Math.cos(a) * 6, home.y + rng.range(2, 5), home.z + Math.sin(a) * 6);
    this.vel = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(7);
    this.target = this.pos.clone(); this.tT = 0;
    this.hd = Math.atan2(this.vel.x, this.vel.z); this.om = 0; this.bank = 0; this.pitch = 0;
    this.ph = rng.range(0, TAU); this.amp = 0.6; this.ampT = 0.6; this.beat = 0; this.fold = 0;
    this.speed = rng.range(6.5, 9); this.flee = 0;
    this.perch = null; this.perched = false; this.gliding = false;
  }
}

export function createSwallows(env, shared, world, garden, rng, count) {
  const geo = swallowGeometry();
  const anim = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  anim.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aFly', anim);
  const mesh = new THREE.InstancedMesh(geo, swallowMaterial(shared), count);
  mesh.name = 'swallows';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  const home = garden.pavPos.clone();
  const base = home.y + 0.62;
  // perches: on the beams under the lower eaves, one bay each
  const perches = [], outs = [];
  for (let i = 0; i < count; i++) {
    const bay = i % 6, a = Math.atan2(-home.x, -home.z) + Math.PI / 6 + (bay + 0.5) * TAU / 6;
    const along = i < 6 ? 0 : 0.45;   // a second bird on a bay sits along the beam from the first
    const p = new THREE.Vector3(home.x + Math.sin(a) * 1.72 + Math.cos(a) * along, base + 0.2 + 2.75 + 0.02, home.z + Math.cos(a) * 1.72 - Math.sin(a) * along);
    perches.push(p);
    // where it starts its glide in under the eave: straight out from the perch, beyond the roof's edge
    outs.push(new THREE.Vector3(home.x + Math.sin(a) * 5.4 + Math.cos(a) * along, p.y + 0.15, home.z + Math.cos(a) * 5.4 - Math.sin(a) * along));
  }
  const birds = [];
  for (let i = 0; i < count; i++) birds.push(new Swallow(i, rng.fork('s' + i), home));
  const W = world;
  const clear = (from, to, m) => {
    const d = from.distanceTo(to), n = Math.max(2, Math.ceil(d / 0.8));
    for (let k = 1; k <= n; k++) { _c.lerpVectors(from, to, k / n); if (W.blocked(_c.x, _c.y, _c.z, m)) return false; }
    return true;
  };
  function pickTarget(b) {
    const r = b.rng;
    for (let k = 0; k < 10; k++) {
      const kind = r.next();
      if (kind < 0.25) {
        // a skim low over the lawn
        const a = r.range(0, TAU), d = r.range(2, 9);
        const x = home.x * 0.6 + Math.cos(a) * d, z = home.z * 0.6 + Math.sin(a) * d, g = W.groundAt(x, z);
        if (g === null) continue;
        b.target.set(x, g + r.range(0.5, 0.9), z);
      } else if (kind < 0.8) {
        // round the pavilion, between the lawn and above the eaves
        const a = r.range(0, TAU), d = r.range(4.6, 8.5);
        b.target.set(home.x + Math.cos(a) * d, base + r.range(1.2, 7.2), home.z + Math.sin(a) * d);
      } else {
        // a sweep out over the edge of the island and back
        const a = Math.atan2(home.z, home.x) + r.range(-1.2, 1.2), d = r.range(11, 16);
        b.target.set(Math.cos(a) * d, base + r.range(2, 8), Math.sin(a) * d);
      }
      if (!W.blocked(b.target.x, b.target.y, b.target.z, 0.5) && clear(b.pos, b.target, 0.35)) { b.tT = r.range(1.4, 3.2); return; }
    }
    // nothing clear from here: climb out of it
    b.target.copy(b.pos).add(_a.set(0, 3, 0)); b.tT = 0.8;
  }
  const _w = new THREE.Vector3();
  const lists = [null, null];
  return {
    mesh, birds,
    /** sys: the residents (its cranes and the distant ones scatter the swallows when they sweep close) */
    update(dt, t, tod, sys) {
      lists[0] = sys.cranes; lists[1] = sys.ambient;
      const awake = tod.day > 0.3 && tod.night < 0.4;
      for (const b of birds) {
        b.tT -= dt;
        if (!awake) {
          // to the perch under the eaves (from outside, straight in under the roof's edge), then sleep there
          if (!b.perch) { b.perch = perches[b.i]; b.perched = false; b.gliding = false; b.target.copy(outs[b.i]); b.tT = 1e9; }
        } else if (b.perch) {
          // morning: out the way it came in
          b.perch = null; b.perched = false; b.gliding = false;
          _a.subVectors(outs[b.i], b.pos).setY(0).normalize();
          b.hd = Math.atan2(_a.x, _a.z);
          b.vel.copy(_a).multiplyScalar(3).setY(0.8);
          b.target.copy(outs[b.i]).addScaledVector(_a, 3); b.tT = 1.2;
        }
        if (b.perch && !b.gliding && b.pos.distanceTo(outs[b.i]) < 1.0) b.gliding = true;
        if (b.perch && b.gliding) {
          const d = _a.subVectors(b.perch, b.pos), dist = d.length();
          if (b.perched || dist < 0.06) {
            b.perched = true;
            b.pos.lerp(b.perch, 1 - Math.exp(-6 * dt));
            b.vel.multiplyScalar(Math.exp(-8 * dt));
          } else {
            // glide in to the perch, slowing down
            const sp = Math.min(6, dist * 2.2 + 0.3);
            _w.copy(d).multiplyScalar(sp / Math.max(dist, 1e-4)).sub(b.vel).multiplyScalar(3);
            b.vel.addScaledVector(_w, dt);
            b.pos.addScaledVector(b.vel, dt);
          }
          b.fold = damp(b.fold, b.perched || dist < 0.8 ? 1 : 0, 5, dt);
          b.ampT = b.perched ? 0 : 0.5;
        } else {
          if (b.perch) { b.target.copy(outs[b.i]); b.tT = 1e9; }
          // a crane sweeping close scatters them
          for (const list of lists) for (const c of list) {
            if (b.perch || b.flee > 0) break;
            if (c.pos.distanceTo(b.pos) < 4.5) {
              b.flee = 1.4;
              _a.subVectors(b.pos, c.pos).setY(0).normalize();
              b.target.copy(b.pos).addScaledVector(_a, 9).add(_c.set(0, 2.5, 0)); b.tT = 1.4;
            }
          }
          b.flee -= dt;
          if (!b.perch && (b.tT <= 0 || b.pos.distanceTo(b.target) < 1.2)) pickTarget(b);
          // steer: seek the target at speed with a capped acceleration (agile, but no instant turns)
          const sp = b.flee > 0 ? 11 : b.speed;
          _w.subVectors(b.target, b.pos);
          const dl = _w.length();
          _w.multiplyScalar(sp / Math.max(dl, 1e-3)).sub(b.vel);
          // look ahead: about to touch a roof, the tree or the lawn? pull up and away
          _a.copy(b.pos).addScaledVector(b.vel, 0.35);
          if (W.blocked(_a.x, _a.y, _a.z, 0.3)) { _w.y += 14; if (!b.perch) pickTarget(b); }
          const acc = _w.length(), aMax = b.flee > 0 ? 34 : 26;
          if (acc > aMax) _w.multiplyScalar(aMax / acc);
          b.vel.addScaledVector(_w, dt);
          const v = b.vel.length();
          if (v > 12) b.vel.multiplyScalar(12 / v);
          b.pos.addScaledVector(b.vel, dt);
          const g = W.groundAt(b.pos.x, b.pos.z);
          if (g !== null && b.pos.y < g + 0.35) { b.pos.y = damp(b.pos.y, g + 0.35, 20, dt); b.vel.y = Math.max(b.vel.y, 0); }
          b.fold = damp(b.fold, 0, 6, dt);
          // bursts of wing beats when climbing or turning hard, glides in between
          b.beat -= dt;
          if (b.beat <= 0) { b.beat = b.rng.range(0.4, 1.1); b.ampT = b.vel.y > 0.5 || b.rng.chance(0.55) ? 0.75 : 0.12; }
        }
        // the body follows its flight (capped turn rate), banks with the turn, pitches with the climb
        const vh = Math.hypot(b.vel.x, b.vel.z);
        if (vh > 0.3 && !b.perched) {
          const e = angleDelta(b.hd, Math.atan2(b.vel.x, b.vel.z));
          const step = clamp(e * (1 - Math.exp(-16 * dt)), -9 * dt, 9 * dt);
          b.hd += step;
          b.om = damp(b.om, step / Math.max(dt, 1e-4), 10, dt);
        } else b.om = damp(b.om, 0, 8, dt);
        if (b.hd > Math.PI * 64 || b.hd < -Math.PI * 64) b.hd %= TAU;
        b.bank = damp(b.bank, clamp(-Math.atan(vh * b.om / 9.8), -1.1, 1.1) * (1 - b.fold), 8, dt);
        b.pitch = damp(b.pitch, clamp(Math.atan2(b.vel.y, Math.max(vh, 0.5)), -0.6, 0.6) * (1 - b.fold), 8, dt);
        b.amp = damp(b.amp, b.ampT, 6, dt);
        // ~3.2 Hz beats (a pixel-sized wing at a faster beat would strobe at 30 fps); wrapped
        b.ph += dt * TAU * lerp(1.2, 3.2, smoothstep(0.1, 0.4, b.amp)) * (1 - b.fold * 0.9);
        if (b.ph > WRAP) b.ph -= WRAP;
        _q.setFromEuler(_e.set(-b.pitch, b.hd, b.bank, 'YXZ'));
        _m.compose(b.pos, _q, _s.set(0.85, 0.85, 0.85));
        mesh.setMatrixAt(b.i, _m);
        anim.array[b.i * 4] = b.ph; anim.array[b.i * 4 + 1] = b.amp; anim.array[b.i * 4 + 2] = b.fold;
      }
      mesh.instanceMatrix.needsUpdate = true;
      anim.needsUpdate = true;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Butterflies                                                         */
/* ------------------------------------------------------------------ */
// +z forward, wings along x, folding up over the back. Opaque polygon wings (no cut-out edges to shimmer),
// coloured per vertex: a pale field, a dark margin, eyespots; three colourings chosen per instance.
const BF_PAL = [
  { field: '#fbe7a1', inner: '#f6c75a', edge: '#2b2620' },   // golden swallowtail
  { field: '#f3f7f4', inner: '#c9eadf', edge: '#3b5f63' },   // white-jade
  { field: '#fbd3d8', inner: '#f39bb0', edge: '#5b2d3a' },   // peach-blossom pink
];
function butterflyGeometry() {
  const parts = [];
  const body = new THREE.SphereGeometry(1, 8, 6).scale(0.0055, 0.0055, 0.032);
  parts.push(colored(body, '#2a2420', 0));
  // fore and hind wing outlines (x outward, z forward), fans round a point inside each wing
  const fore = [[0.004, 0.006], [0.02, 0.035], [0.055, 0.052], [0.082, 0.045], [0.085, 0.02], [0.06, -0.004], [0.012, -0.004]];
  const hind = [[0.004, -0.002], [0.05, -0.006], [0.066, -0.025], [0.058, -0.046], [0.04, -0.062], [0.03, -0.085], [0.022, -0.06], [0.006, -0.03]];
  for (const s of [1, -1]) {
    for (const [o, isFore] of [[fore, 1], [hind, 0]]) {
      // centre vertex plus the outline; the colour attribute carries r = margin weight, b = fore (1) / hind (0),
      // turned into the instance's palette in the shader
      const pos = [0.03 * s, 0, isFore ? 0.022 : -0.03], col = [0, 0, isFore];
      for (const [x, z] of o) {
        pos.push(s * x, 0, z);
        const edge = Math.min(1, Math.hypot(x - 0.03, z - (isFore ? 0.022 : -0.03)) / (isFore ? 0.05 : 0.04));
        col.push(smoothstep(0.55, 1.0, edge), 0, isFore);
      }
      const idx = [];
      const n = o.length;
      for (let i = 1; i < n; i++) idx.push(0, i, i + 1);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Array(n + 1).fill(s > 0 ? 1 : 2), 1));
      g.setIndex(s > 0 ? idx : idx.reverse());
      g.computeVertexNormals();
      parts.push(g);
    }
  }
  return mergeGeometries(parts);
}
function butterflyMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
  const pal = BF_PAL.map(p => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, new THREE.Color(v)])));
  return patchStd(m, shared, {
    key: 'butterfly',
    uniforms: {
      uField: { value: pal.map(p => p.field) }, uInner: { value: pal.map(p => p.inner) }, uEdge: { value: pal.map(p => p.edge) },
    },
    vertexHeader: 'attribute float aPart; attribute vec4 aWing; varying float vVar; uniform vec3 uField[3]; uniform vec3 uInner[3]; uniform vec3 uEdge[3];',
    vertex: {
      '#include <begin_vertex>': /* glsl */`$&
        // aWing: wing angle (rad, 0 flat .. 1.4 closed above the back), variant, unused, unused
        if (aPart > 0.5) {
          float side = aPart < 1.5 ? 1.0 : -1.0;
          float a = aWing.x;
          float x = transformed.x * side;
          transformed.x = side * x * cos(a);
          transformed.y += x * sin(a);
        }
        vVar = aWing.y;
      `,
      '#include <color_vertex>': /* glsl */`$&
        {
          int vi = int(aWing.y + 0.5);
          vec3 f = vi == 0 ? uField[0] : vi == 1 ? uField[1] : uField[2];
          vec3 inn = vi == 0 ? uInner[0] : vi == 1 ? uInner[1] : uInner[2];
          vec3 ed = vi == 0 ? uEdge[0] : vi == 1 ? uEdge[1] : uEdge[2];
          if (aPart > 0.5) vColor.rgb = mix(mix(inn, f, color.b * 0.6 + 0.2), ed, color.r);
          else vColor.rgb = color.rgb;
        }
      `,
    },
    fragmentHeader: 'varying float vVar;',
    fragment: {
      // a little light through the wings when the sun is behind them
      '#include <lights_fragment_end>': /* glsl */`$&
        { vec3 Vw = normalize(cameraPosition - vWPos);
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uLightCol * pow(max(dot(-Vw, uLightDir), 0.0), 3.0) * 0.6; }
      `,
    },
  });
}

export function createButterflies(env, shared, world, garden, foods, rng, count) {
  const geo = butterflyGeometry();
  const wing = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
  wing.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aWing', wing);
  const mesh = new THREE.InstancedMesh(geo, butterflyMaterial(shared), count);
  mesh.name = 'butterflies';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  const cl = garden.tree.clusters;
  // landing spots on the crown's outer blossom (upper half of each cluster, facing out)
  const spot = (r, out) => {
    const c = cl[r.int(0, cl.length - 1)];
    const a = r.range(0, TAU), z = r.range(0.1, 0.85), rr = Math.sqrt(1 - z * z);
    _a.set(rr * Math.cos(a), z, rr * Math.sin(a));
    return out.copy(c.c).addScaledVector(_a, c.r * 1.1);
  };
  const flies = [];
  for (let i = 0; i < count; i++) {
    const r = rng.fork('b' + i);
    const f = {
      i, r, pos: new THREE.Vector3(), vel: new THREE.Vector3(), target: new THREE.Vector3(), state: 'rest', t: r.range(0, 6),
      hd: r.range(0, TAU), ph: r.range(0, TAU), ang: 1.2, var: i % 3, food: null, flap: r.range(3.4, 4.2), seed: r.range(0, 100),
    };
    spot(r, f.pos); f.target.copy(f.pos);
    flies.push(f);
  }
  return {
    mesh, flies,
    update(dt, t, tod) {
      const asleep = tod.night > 0.55 || tod.day < 0.15;
      for (const f of flies) {
        f.t -= dt;
        if (f.state === 'rest') {
          f.vel.multiplyScalar(Math.exp(-10 * dt));
          // resting: wings held closed over the back, opening slowly now and then (in the sun)
          const open = asleep ? 0 : 0.5 + 0.5 * Math.sin(t * 0.9 + f.seed);
          f.ang = damp(f.ang, lerp(1.35, 0.35, open * open), 3, dt);
          if (f.food && (!f.food.alive || f.food.held)) f.t = Math.min(f.t, 0.3);
          if (f.food && f.food.alive) f.pos.copy(f.food.pos).add(_a.set(0, f.food.scale * 0.55, 0));
          if (f.t <= 0 && !asleep) {
            f.food = null;
            // a peach in the grass nearby draws them down (one or two at a time)
            for (const fd of foods) {
              if (!fd.alive || fd.held || fd.state === 'fall' || fd.pos.distanceTo(garden.treePos) > 14) continue;
              if (flies.filter(o => o.food === fd).length >= 2 || f.r.chance(0.35)) continue;
              f.food = fd; break;
            }
            if (f.food) f.target.copy(f.food.pos).add(_a.set(0, f.food.scale * 0.55, 0));
            else spot(f.r, f.target);
            f.state = 'fly'; f.t = 12;
            f.vel.set(0, 0.6, 0);
          }
        } else {
          if (f.food) {
            if (!f.food.alive || f.food.held) { f.food = null; spot(f.r, f.target); }
            else f.target.copy(f.food.pos).add(_a.set(0, f.food.scale * 0.55, 0));
          }
          if (asleep && !f.food && f.t > 4) { spot(f.r, f.target); f.t = 4; }
          // flutter: seek the target slowly, wandering, each downstroke lifting it a little
          const d = _a.subVectors(f.target, f.pos), dist = d.length();
          const sp = lerp(0.35, 1.5, smoothstep(0.05, 1.8, dist));
          d.multiplyScalar(sp / Math.max(dist, 1e-4));
          d.x += Math.sin(t * 1.3 + f.seed) * 0.3; d.z += Math.cos(t * 1.1 + f.seed * 1.7) * 0.3;
          d.y += Math.sin(f.ph) * 0.18;
          _b.subVectors(d, f.vel);
          const acc = _b.length(), aMax = 4;
          if (acc > aMax) _b.multiplyScalar(aMax / acc);
          f.vel.addScaledVector(_b, dt);
          f.pos.addScaledVector(f.vel, dt);
          f.ang = lerp(-0.25, 1.15, 0.5 + 0.5 * Math.sin(f.ph));
          if (dist < 0.06 || f.t <= 0) { f.state = 'rest'; f.t = f.food ? f.r.range(5, 9) : f.r.range(2.5, 7); }
        }
        // heading follows the flight closely, at a capped rate (they flutter, they do not snap round)
        const vh = Math.hypot(f.vel.x, f.vel.z);
        if (vh > 0.12) f.hd += clamp(angleDelta(f.hd, Math.atan2(f.vel.x, f.vel.z)) * (1 - Math.exp(-9 * dt)), -7 * dt, 7 * dt);
        if (f.hd > Math.PI * 64 || f.hd < -Math.PI * 64) f.hd %= TAU;
        // ~3.8 Hz beats in flight, wrapped
        if (f.state === 'fly') { f.ph += dt * TAU * f.flap; if (f.ph > WRAP) f.ph -= WRAP; }
        _q.setFromEuler(_e.set(0, f.hd, 0, 'YXZ'));
        _m.compose(f.pos, _q, _s.set(1.2, 1.2, 1.2));
        mesh.setMatrixAt(f.i, _m);
        wing.array[f.i * 4] = f.ang; wing.array[f.i * 4 + 1] = f.var;
      }
      mesh.instanceMatrix.needsUpdate = true;
      wing.needsUpdate = true;
    },
  };
}
