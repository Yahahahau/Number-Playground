// Shared block geometry (rounded cube + six number faces in ONE geometry with two material groups)
// and a ref-counted cache of number textures.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fmtLabel } from '../core/bignum.js';

export const CORNER = 0.1; // corner radius as a fraction of the edge

let _geo = null;
export function getBlockGeometry() {
  if (_geo) return _geo;
  const box = new RoundedBoxGeometry(1, 1, 1, 3, CORNER);
  const faces = [
    { n: [0, 0, 1], u: [0, 1, 0] },
    { n: [0, 0, -1], u: [0, 1, 0] },
    { n: [1, 0, 0], u: [0, 1, 0] },
    { n: [-1, 0, 0], u: [0, 1, 0] },
    { n: [0, 1, 0], u: [0, 0, -1] },
    { n: [0, -1, 0], u: [0, 0, 1] },
  ];
  const quads = faces.map(({ n, u }) => {
    const N = new THREE.Vector3(...n);
    const U = new THREE.Vector3(...u);
    const R = new THREE.Vector3().crossVectors(U, N);
    const q = new THREE.PlaneGeometry(0.84, 0.84);
    q.translate(0, 0, 0.5 + 0.004);
    q.applyMatrix4(new THREE.Matrix4().makeBasis(R, U, N));
    const ni = q.toNonIndexed(); // RoundedBoxGeometry is non-indexed, so every part must be too
    q.dispose();
    return ni;
  });
  const labels = mergeGeometries(quads);
  _geo = mergeGeometries([box, labels], true); // group 0 = block, group 1 = numbers
  box.dispose();
  quads.forEach((q) => q.dispose());
  labels.dispose();
  return _geo;
}

export class LabelCache {
  constructor(maxAniso = 4) {
    this.map = new Map();
    this.aniso = maxAniso;
  }

  acquire(value) {
    const key = fmtLabel(value);
    let e = this.map.get(key);
    if (!e) {
      e = { key, refs: 0, tex: this.make(key) };
      this.map.set(key, e);
    }
    e.refs++;
    return e;
  }

  release(e) {
    if (!e) return;
    e.refs--;
    if (e.refs <= 0) {
      e.tex.dispose();
      this.map.delete(e.key);
    }
  }

  make(text) {
    const S = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const g = cv.getContext('2d');
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const family = '"Arial Black", "Segoe UI", system-ui, sans-serif';
    // adaptive size: long numbers shrink (and tighten) to always fit the face
    let size = text.length <= 2 ? 170 : text.length <= 3 ? 150 : 128;
    const maxW = 206;
    g.font = `900 ${size}px ${family}`;
    let w = g.measureText(text).width;
    if (w > maxW) {
      size = Math.max(34, Math.floor((size * maxW) / w));
      g.font = `900 ${size}px ${family}`;
    }
    const x = S / 2;
    const y = S / 2 + size * 0.04;
    g.strokeStyle = 'rgba(255,255,255,0.95)'; // thin highlight rim
    g.lineWidth = size * 0.2;
    g.strokeText(text, x, y);
    g.strokeStyle = 'rgba(8,16,36,0.96)'; // dark outline for contrast
    g.lineWidth = size * 0.13;
    g.strokeText(text, x, y);
    g.fillStyle = '#ffffff';
    g.fillText(text, x, y);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.aniso;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    return tex;
  }
}
