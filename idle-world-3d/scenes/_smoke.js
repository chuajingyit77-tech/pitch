// Smoke test world: validates the shell, the fish library and feeding. Not listed in the dock.
import * as THREE from 'three';
import { buildFishGeometry, paintFish, createFishMaterial, FishInstances, Swimmer } from '../lib/fish.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { createWind, addWind } from '../lib/util.js';

export default {
  id: '_smoke',
  food: '鱼食',
  kinds: { koi: { zh: '锦鲤' }, clownfish: { zh: '小丑鱼' }, blueTang: { zh: '蓝吊' }, yellowTang: { zh: '黄金吊' }, chromis: { zh: '青魔' }, moorishIdol: { zh: '镰鱼' }, emperorAngel: { zh: '皇后神仙' } },
  starter: ['koi', 'clownfish', 'blueTang', 'yellowTang', 'chromis', 'moorishIdol', 'emperorAngel'],
  async create(env) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#203040');
    scene.environment = env.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    const sun = new THREE.DirectionalLight('#ffffff', 2.5); sun.position.set(3, 6, 4); scene.add(sun);
    scene.add(new THREE.HemisphereLight('#bcd', '#432', 0.6));
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: '#3a3f44', roughness: 0.9 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1.2; scene.add(ground);
    const fishes = [];
    const species = ['koi', 'clownfish', 'blueTang', 'yellowTang', 'chromis', 'moorishIdol', 'emperorAngel'];
    species.forEach((sp, i) => {
      const geo = buildFishGeometry(sp);
      const painted = paintFish(sp, { seed: 10 + i, variety: ['kohaku', 'sanke', 'showa', 'tancho', 'ogon'][i % 5] });
      const mat = createFishMaterial(painted);
      const inst = new FishInstances(geo, mat, 1);
      scene.add(inst.mesh);
      const sw = new Swimmer({ pos: new THREE.Vector3((i - 3) * 1.25, 0, 0), size: 1, speed: 0.0, rng: env.rng });
      sw.vel.set(0, 0, 0.0001); sw.fwd.set(1, 0, 0.0);
      fishes.push({ sp, inst, sw });
    });
    // models
    const fox = await env.loadGLTF('models/Fox.glb');
    const foxObj = SkeletonUtils.clone(fox.scene); foxObj.scale.setScalar(0.012); foxObj.position.set(-2, -1.2, -2); scene.add(foxObj);
    const mixer = new THREE.AnimationMixer(foxObj);
    console.warn('fox clips', fox.animations.map(a => a.name).join(','));
    mixer.clipAction(fox.animations.find(a => a.name === 'Walk') || fox.animations[0]).play();
    const parrot = await env.loadGLTF('models/Parrot.glb');
    const pObj = parrot.scene.clone(); pObj.scale.setScalar(0.012); pObj.position.set(1.5, 1.4, -1.5); scene.add(pObj);
    const pm = new THREE.AnimationMixer(pObj); pm.clipAction(parrot.animations[0]).play();
    let bb = new THREE.Box3().setFromObject(pObj); console.warn('parrot box', JSON.stringify(bb.min), JSON.stringify(bb.max));
    bb = new THREE.Box3().setFromObject(foxObj); console.warn('fox box', JSON.stringify(bb.min), JSON.stringify(bb.max));
    const bar = await env.loadGLTF('models/Barramundi.glb');
    const bObj = bar.scene.clone(); bObj.position.set(2.5, -0.8, 1); bObj.scale.setScalar(3); scene.add(bObj);
    // grass
    const wind = createWind();
    const blade = new THREE.PlaneGeometry(0.05, 0.6, 1, 4); blade.translate(0, 0.3, 0);
    const gm = new THREE.MeshStandardMaterial({ color: '#7a9a3a', side: THREE.DoubleSide });
    addWind(gm, wind, { height: 0.6, amount: 0.25 });
    const grass = new THREE.InstancedMesh(blade, gm, 3000);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 3000; i++) { m4.makeRotationY(Math.random() * 6.28); m4.setPosition(-6 + Math.random() * 12, -1.2, -4 + Math.random() * 3); grass.setMatrixAt(i, m4); }
    scene.add(grass);
    return {
      scene, camera,
      view: { target: [0, 0, 0], dist: 6.5, yaw: 0, pitch: 0.25, drift: 0.05 },
      post: { bloom: { strength: 0.1 } },
      update(dt, t) {
        mixer.update(dt); pm.update(dt); wind.update(dt);
        for (const f of fishes) {
          f.sw.phase += dt * 4; f.sw.amp = 0.05; f.sw.turn = Math.sin(t * 0.5) * 0.1;
          f.sw.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.5);
          f.inst.begin(); f.inst.push(f.sw); f.inst.end(t);
        }
      },
      feed(ray) { return ray.ray.origin; },
      creatures: () => fishes.map(f => ({ pos: f.sw.pos, radius: 0.5, label: f.sp })),
    };
  },
};
