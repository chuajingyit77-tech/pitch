// 芒原 · procedural pose layers for the glTF Fox (applied after the AnimationMixer each frame):
// head dip for eating, drowsy head for resting, and a seated pose built from model-space bone rotations.
import * as THREE from 'three';

const X = new THREE.Vector3(1, 0, 0);
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

// model-space rotation of a bone: parent rotations premultiplied walking up to the root (no per-call array, these
// run for ~20 bones per frame while a fox sits or eats)
function modelQuat(bone, root, out) {
  out.identity();
  for (let o = bone; o && o !== root; o = o.parent) out.premultiply(o.quaternion);
  return out;
}
/** Rotate a bone about a model-space axis through its own pivot. */
export function rotateBoneModel(bone, root, axis, angle) {
  if (!bone || Math.abs(angle) < 1e-5) return;
  modelQuat(bone.parent, root, _q1);
  _q2.setFromAxisAngle(axis, angle);
  _q3.copy(_q1).invert();
  bone.quaternion.premultiply(_q1).premultiply(_q2).premultiply(_q3);
}

export const FOX_BONES = {
  hip: 'b_Hip_01', spine1: 'b_Spine01_02', spine2: 'b_Spine02_03', neck: 'b_Neck_04', head: 'b_Head_05',
  armL: 'b_LeftUpperArm_09', foreL: 'b_LeftForeArm_010', handL: 'b_LeftHand_011',
  armR: 'b_RightUpperArm_06', foreR: 'b_RightForeArm_07', handR: 'b_RightHand_08',
  thighL: 'b_LeftLeg01_015', shinL: 'b_LeftLeg02_016', hockL: 'b_LeftFoot01_017', toeL: 'b_LeftFoot02_018',
  thighR: 'b_RightLeg01_019', shinR: 'b_RightLeg02_020', hockR: 'b_RightFoot01_021', toeR: 'b_RightFoot02_022',
  tail1: 'b_Tail01_012', tail2: 'b_Tail02_013', tail3: 'b_Tail03_014',
};
// bones the pose layers rotate
const POSED = ['hip', 'thighL', 'shinL', 'hockL', 'toeL', 'armL', 'foreL', 'handL', 'thighR', 'shinR', 'hockR', 'toeR', 'armR', 'foreR', 'handR', 'neck', 'head', 'tail1', 'tail2', 'tail3'];
export function findFoxBones(root) {
  const b = {};
  for (const [k, n] of Object.entries(FOX_BONES)) b[k] = root.getObjectByName(n);
  // per posed bone: its animation value (_base) and the posed value it was left with last frame (_posed)
  b._list = POSED.map(k => b[k]).filter(Boolean);
  b._base = b._list.map(o => o.quaternion.clone());
  b._posed = b._list.map(o => o.quaternion.clone());
  return b;
}

// Seated pose parameters (radians; positive = nose-up / limb swings backward around the lateral axis).
export const SIT = { hip: 0.72, drop: 27, thigh: -0.95, shin: 2.0, hock: -1.2, toe: 0.2, arm: 0.58, fore: 0.05, hand: 0.15, neck: -0.45, head: -0.05, tail1: 0.55, tail2: 0.35, tail3: 0.25 };

/**
 * Apply pose layers. w = { eat, rest, sit } in 0..1, t = time (s). Returns the vertical drop (model units)
 * the caller should apply to the model root.
 */
export function applyFoxPose(b, root, w, t, P = SIT) {
  // The layers are offsets on top of the animation, which assumes the AnimationMixer rewrote each bone this frame.
  // It only writes a bone whose blended value changed: the toes are in no clip at all, and Survey holds the hip
  // still, so once Walk/Run had faded out those bones kept last frame's pose and the offsets piled up frame after
  // frame (a seated fox's paws, then its whole body, whirled round). Put the animation value back first.
  const L = b._list;
  if (L) {
    for (let i = 0; i < L.length; i++) {
      const q = L[i].quaternion;
      if (q.equals(b._posed[i])) q.copy(b._base[i]); else b._base[i].copy(q);
    }
  }
  const s = w.sit || 0;
  if (s > 0.001) {
    rotateBoneModel(b.hip, root, X, -P.hip * s);
    for (let k = 0; k < 2; k++) {
      const left = k === 0;
      rotateBoneModel(left ? b.thighL : b.thighR, root, X, P.thigh * s);
      rotateBoneModel(left ? b.shinL : b.shinR, root, X, P.shin * s);
      rotateBoneModel(left ? b.hockL : b.hockR, root, X, P.hock * s);
      rotateBoneModel(left ? b.toeL : b.toeR, root, X, P.toe * s);
      rotateBoneModel(left ? b.armL : b.armR, root, X, P.arm * s);
      rotateBoneModel(left ? b.foreL : b.foreR, root, X, P.fore * s);
      rotateBoneModel(left ? b.handL : b.handR, root, X, P.hand * s);
    }
    rotateBoneModel(b.neck, root, X, P.neck * s);
    rotateBoneModel(b.head, root, X, P.head * s);
    rotateBoneModel(b.tail1, root, X, P.tail1 * s);
    rotateBoneModel(b.tail2, root, X, P.tail2 * s);
    rotateBoneModel(b.tail3, root, X, P.tail3 * s);
  }
  const e = w.eat || 0, r = w.rest || 0;
  if (e > 0.001 || r > 0.001) {
    const bob = e * (0.95 + 0.25 * Math.sin(t * 10.0)) + r * 0.32;
    rotateBoneModel(b.neck, root, X, bob * 0.7);
    rotateBoneModel(b.head, root, X, bob * 0.45);
  }
  if (L) for (let i = 0; i < L.length; i++) b._posed[i].copy(L[i].quaternion);
  return s * P.drop;
}
