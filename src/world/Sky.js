// Static space skybox: one painted equirectangular texture on an inside-out sphere that follows the
// camera. No per-pixel sky maths, no per-frame work except moving the sphere.
import * as THREE from 'three';
import { paintSkyCanvas, toTexture } from './SpaceArt.js';

export const HORIZON = new THREE.Color().setRGB(0.012, 0.012, 0.05, THREE.LinearSRGBColorSpace);

let _tex = null;
export function getSkyTexture() {
  if (!_tex) {
    _tex = toTexture(paintSkyCanvas(), { aniso: 2 });
  }
  return _tex;
}

export function createSky() {
  const mat = new THREE.MeshBasicMaterial({ map: getSkyTexture(), side: THREE.BackSide, depthWrite: false, fog: false });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 18), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
