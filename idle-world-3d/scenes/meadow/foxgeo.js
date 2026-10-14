// Fox.glb is a 576-triangle low-poly model: its outline is a handful of straight facets, which reads as blocky once
// a fox walks up close. This rebuilds it as curved point-normal triangles (Vlachos et al. 2001, "PN triangles"):
// every facet becomes a cubic patch through the same corners, bulging along the smoothed normals, so the outline
// and the shading come out round while the model's proportions, paws, ears and tail tip stay where they were (the
// patch passes through every original vertex). Skinning, UVs and the texture are carried over, so the clips play
// as before.
import * as THREE from 'three';

/**
 * Smooth, subdivided copy of a skinned glTF geometry (indexed or not). Each triangle becomes `level`² triangles.
 * Vertices that share a position share one normal (UV seams do not crease the shading), and points on a shared edge
 * are computed once from that edge alone, so neighbouring patches meet exactly (no cracks when skinned).
 * @param {THREE.BufferGeometry} src  position, uv, skinIndex, skinWeight (other attributes are dropped)
 * @param {{ level?: number }} [opts]
 */
export function pnSmoothSkinned(src, { level = 3 } = {}) {
  const n = Math.max(1, Math.round(level));
  const P = src.attributes.position, UV = src.attributes.uv, SI = src.attributes.skinIndex, SW = src.attributes.skinWeight;
  const idx = src.index;
  const triCount = (idx ? idx.count : P.count) / 3;
  const corner = (t, c) => (idx ? idx.getX(t * 3 + c) : t * 3 + c);

  // 1. weld positions (the glTF splits them along UV seams); scale-relative tolerance
  src.computeBoundingBox();
  const bb = src.boundingBox, tol = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) * 1e-5;
  const pid = new Int32Array(P.count), pos = [], skin = [];
  const weld = new Map();
  for (let i = 0; i < P.count; i++) {
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    const key = `${Math.round(x / tol)},${Math.round(y / tol)},${Math.round(z / tol)}`;
    let id = weld.get(key);
    if (id === undefined) {
      id = pos.length / 3; weld.set(key, id); pos.push(x, y, z);
      // skin as {bone: weight}; a welded position always carries one skin (the glTF splits only UVs)
      const w = {};
      for (let k = 0; k < 4; k++) { const b = SI.getComponent(i, k), wt = SW.getComponent(i, k); if (wt > 0) w[b] = (w[b] || 0) + wt; }
      skin.push(w);
    }
    pid[i] = id;
  }
  const NP = pos.length / 3;

  // 2. one normal per position: faces weighted by their corner angle (stable on long thin facets)
  const nrm = new Float64Array(NP * 3);
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), fn = new THREE.Vector3();
  const at = (v, id) => v.set(pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]);
  for (let t = 0; t < triCount; t++) {
    const ids = [pid[corner(t, 0)], pid[corner(t, 1)], pid[corner(t, 2)]];
    at(A, ids[0]); at(B, ids[1]); at(C, ids[2]);
    fn.subVectors(B, A).cross(e1.subVectors(C, A));
    if (fn.lengthSq() < 1e-20) continue;
    fn.normalize();
    const P3 = [A, B, C];
    for (let c = 0; c < 3; c++) {
      e1.subVectors(P3[(c + 1) % 3], P3[c]); e2.subVectors(P3[(c + 2) % 3], P3[c]);
      const ang = e1.angleTo(e2);
      if (!(ang > 0)) continue;
      nrm[ids[c] * 3] += fn.x * ang; nrm[ids[c] * 3 + 1] += fn.y * ang; nrm[ids[c] * 3 + 2] += fn.z * ang;
    }
  }
  for (let i = 0; i < NP; i++) {
    const l = Math.hypot(nrm[i * 3], nrm[i * 3 + 1], nrm[i * 3 + 2]) || 1;
    nrm[i * 3] /= l; nrm[i * 3 + 1] /= l; nrm[i * 3 + 2] /= l;
  }

  // PN control point next to corner i on the edge toward corner j: (2 Pi + Pj - ((Pj - Pi)·Ni) Ni) / 3
  const ctrl = (i, j, out) => {
    const px = pos[i * 3], py = pos[i * 3 + 1], pz = pos[i * 3 + 2], qx = pos[j * 3], qy = pos[j * 3 + 1], qz = pos[j * 3 + 2];
    const nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
    const w = (qx - px) * nx + (qy - py) * ny + (qz - pz) * nz;
    out[0] = (2 * px + qx - w * nx) / 3; out[1] = (2 * py + qy - w * ny) / 3; out[2] = (2 * pz + qz - w * nz) / 3;
    return out;
  };
  // blend skins with barycentric weights, keep the 4 strongest bones
  const blendSkin = (ws, ids) => {
    const acc = {};
    for (let c = 0; c < ids.length; c++) { if (!(ws[c] > 0)) continue; const s = skin[ids[c]]; for (const b in s) acc[b] = (acc[b] || 0) + s[b] * ws[c]; }
    const top = Object.keys(acc).map(b => [+b, acc[b]]).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 4);
    const sum = top.reduce((x, y) => x + y[1], 0) || 1;
    const bi = [0, 0, 0, 0], bw = [0, 0, 0, 0];
    top.forEach(([b, w], k) => { bi[k] = b; bw[k] = w / sum; });
    return { bi, bw };
  };

  // 3. points on an edge, computed once per welded edge from its lower id (both neighbours get the same bits)
  const edgePts = new Map();
  const c0 = [0, 0, 0], c1 = [0, 0, 0];
  const edgePoint = (i, j, k) => {      // k/n of the way from i to j (0 < k < n)
    if (i > j) return edgePoint(j, i, n - k);
    const key = i * NP + j;
    let pts = edgePts.get(key);
    if (!pts) {
      pts = [];
      ctrl(i, j, c0); ctrl(j, i, c1);
      for (let s = 1; s < n; s++) {
        const b = s / n, a = 1 - b;
        const wa = a * a * a, wb = b * b * b, w0 = 3 * a * a * b, w1 = 3 * a * b * b;
        const p = [0, 1, 2].map(d => pos[i * 3 + d] * wa + pos[j * 3 + d] * wb + c0[d] * w0 + c1[d] * w1);
        pts.push({ p, sk: blendSkin([a, b], [i, j]) });
      }
      edgePts.set(key, pts);
    }
    return pts[k - 1];
  };

  // 4. tessellate; output vertices are shared by (point, uv). The point and its skin are only worked out for a
  // vertex not emitted yet (`make` returns [position, skin]).
  const outPos = [], outUV = [], outSI = [], outSW = [], outIdx = [];
  const vmap = new Map();
  const emit = (pointKey, uv, make) => {
    const key = `${pointKey}|${uv[0].toFixed(5)},${uv[1].toFixed(5)}`;
    let v = vmap.get(key);
    if (v === undefined) {
      const [p, sk] = make();
      v = outPos.length / 3; vmap.set(key, v);
      outPos.push(p[0], p[1], p[2]); outUV.push(uv[0], uv[1]); outSI.push(...sk.bi); outSW.push(...sk.bw);
    }
    return v;
  };
  const b210 = [0, 0, 0], b120 = [0, 0, 0], b021 = [0, 0, 0], b012 = [0, 0, 0], b102 = [0, 0, 0], b201 = [0, 0, 0];
  for (let t = 0; t < triCount; t++) {
    const vi = [corner(t, 0), corner(t, 1), corner(t, 2)];
    const ids = vi.map(i => pid[i]);
    const uvs = vi.map(i => [UV.getX(i), UV.getY(i)]);
    const [i0, i1, i2] = ids;
    ctrl(i0, i1, b210); ctrl(i1, i0, b120); ctrl(i1, i2, b021); ctrl(i2, i1, b012); ctrl(i2, i0, b102); ctrl(i0, i2, b201);
    const b111 = [0, 1, 2].map(d => {
      const E = (b210[d] + b120[d] + b021[d] + b012[d] + b102[d] + b201[d]) / 6, V = (pos[i0 * 3 + d] + pos[i1 * 3 + d] + pos[i2 * 3 + d]) / 3;
      return E + (E - V) / 2;
    });
    // grid vertex (a, b, c) = barycentric (a/n, b/n, c/n) toward corners 0, 1, 2
    const grid = [];
    for (let a = n; a >= 0; a--) {
      const row = [];
      for (let b = n - a; b >= 0; b--) {
        const c = n - a - b;
        const u = a / n, v = b / n, w = c / n;
        const uv = [uvs[0][0] * u + uvs[1][0] * v + uvs[2][0] * w, uvs[0][1] * u + uvs[1][1] * v + uvs[2][1] * w];
        let id;
        const cornerOf = i => () => [pos.slice(i * 3, i * 3 + 3), blendSkin([1], [i])];
        const onEdge = (i, j, k) => () => { const e = edgePoint(i, j, k); return [e.p, e.sk]; };
        if (a === n) id = emit(`p${i0}`, uv, cornerOf(i0));
        else if (b === n) id = emit(`p${i1}`, uv, cornerOf(i1));
        else if (c === n) id = emit(`p${i2}`, uv, cornerOf(i2));
        // an edge point's key counts its steps from the edge's lower id, the same from either face
        else if (c === 0) id = emit(`e${Math.min(i0, i1)},${Math.max(i0, i1)},${i0 < i1 ? b : a}`, uv, onEdge(i0, i1, b));
        else if (a === 0) id = emit(`e${Math.min(i1, i2)},${Math.max(i1, i2)},${i1 < i2 ? c : b}`, uv, onEdge(i1, i2, c));
        else if (b === 0) id = emit(`e${Math.min(i2, i0)},${Math.max(i2, i0)},${i2 < i0 ? a : c}`, uv, onEdge(i2, i0, a));
        else {
          id = emit(`t${t},${a},${b}`, uv, () => [[0, 1, 2].map(d => pos[i0 * 3 + d] * u * u * u + pos[i1 * 3 + d] * v * v * v + pos[i2 * 3 + d] * w * w * w
            + 3 * (b210[d] * u * u * v + b120[d] * u * v * v + b201[d] * u * u * w + b021[d] * v * v * w + b102[d] * u * w * w + b012[d] * v * w * w)
            + 6 * b111[d] * u * v * w), blendSkin([u, v, w], ids)]);
        }
        row.push(id);
      }
      grid.push(row);
    }
    // rows: grid[r] has r + 1 vertices; same winding as the source triangle (0, 1, 2)
    for (let r = 0; r < n; r++) {
      for (let k = 0; k <= r; k++) {
        outIdx.push(grid[r][k], grid[r + 1][k], grid[r + 1][k + 1]);
        if (k < r) outIdx.push(grid[r][k], grid[r + 1][k + 1], grid[r][k + 1]);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(outPos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(outUV, 2));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(outSI, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(outSW, 4));
  g.setIndex(outIdx);
  // final normals, again one per position (the patches meet smoothly; seams must not show in the shading)
  const nv = outPos.length / 3, grp = new Map(), gid = new Int32Array(nv);
  for (let i = 0; i < nv; i++) {
    const key = `${Math.round(outPos[i * 3] / tol)},${Math.round(outPos[i * 3 + 1] / tol)},${Math.round(outPos[i * 3 + 2] / tol)}`;
    let id = grp.get(key); if (id === undefined) { id = grp.size; grp.set(key, id); } gid[i] = id;
  }
  const gn = new Float64Array(grp.size * 3);
  const gp = g.attributes.position;
  for (let k = 0; k < outIdx.length; k += 3) {
    const ia = outIdx[k], ib = outIdx[k + 1], ic = outIdx[k + 2];
    A.fromBufferAttribute(gp, ia); B.fromBufferAttribute(gp, ib); C.fromBufferAttribute(gp, ic);
    fn.subVectors(B, A).cross(e1.subVectors(C, A));
    if (fn.lengthSq() < 1e-20) continue;
    fn.normalize();
    const P3 = [A, B, C], V3 = [ia, ib, ic];
    for (let c = 0; c < 3; c++) {
      e1.subVectors(P3[(c + 1) % 3], P3[c]); e2.subVectors(P3[(c + 2) % 3], P3[c]);
      const ang = e1.angleTo(e2);
      if (!(ang > 0)) continue;
      const q = gid[V3[c]];
      gn[q * 3] += fn.x * ang; gn[q * 3 + 1] += fn.y * ang; gn[q * 3 + 2] += fn.z * ang;
    }
  }
  const outN = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) {
    const q = gid[i], l = Math.hypot(gn[q * 3], gn[q * 3 + 1], gn[q * 3 + 2]) || 1;
    outN[i * 3] = gn[q * 3] / l; outN[i * 3 + 1] = gn[q * 3 + 1] / l; outN[i * 3 + 2] = gn[q * 3 + 2] / l;
  }
  g.setAttribute('normal', new THREE.BufferAttribute(outN, 3));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}
