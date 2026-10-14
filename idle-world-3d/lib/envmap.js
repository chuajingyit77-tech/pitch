// Image-based light refreshed in place. pmrem.fromScene makes a new 6 MB render target for every refresh, and the
// new texture makes every standard material in the world re-resolve its program: on the old iPad each refresh was a
// CPU and GPU hitch, and a world that follows the sky through dawn and dusk refreshes every few seconds to minutes.
// This keeps one cube camera, one PMREM generator and one persistent target: a refresh allocates nothing, and
// scene.environment keeps the same texture object (the koi, island and jungle worlds do the same in their own code).
import * as THREE from 'three';

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {THREE.Scene} envScene  what the environment is rendered from (usually just the sky dome)
 * @param {{ size?: number, near?: number, far?: number, sigma?: number }} [opts]  sigma: the pre-blur in radians
 *   that fromScene(scene, sigma) applied (fromCubemap skips it)
 */
export function createEnvRefresher(renderer, envScene, { size = 256, near = 0.1, far = 100, sigma = 0 } = {}) {
  const cube = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const cam = new THREE.CubeCamera(near, far, cube);
  const gen = new THREE.PMREMGenerator(renderer);
  if (sigma > 0) {
    // three r160's fromScene blurs by sigma just before _applyPMREM; fromCubemap goes straight to _applyPMREM
    const apply = gen._applyPMREM;
    gen._applyPMREM = function (rt) { this._blur(rt, 0, 0, sigma); apply.call(this, rt); };
  }
  let rt = null;
  return {
    /** The environment texture (null before the first update). The same object after every update. */
    get texture() { return rt ? rt.texture : null; },
    /** Re-render the environment scene and refilter it into the persistent target. */
    update() {
      const target = renderer.getRenderTarget(), autoClear = renderer.autoClear;
      renderer.autoClear = true;
      cam.update(renderer, envScene);
      renderer.autoClear = autoClear;
      rt = gen.fromCubemap(cube.texture, rt);
      renderer.setRenderTarget(target);
      return rt.texture;
    },
    dispose() { if (rt) rt.dispose(); rt = null; cube.dispose(); gen.dispose(); },
  };
}
