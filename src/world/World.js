// Natural environment: terrain + collider, path, trees, rocks, flowers, grass, clouds, lighting.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  terrainHeight, START, POND, WATER_Y, WORLD_HALF, MESH_HALF, pathCurve, distToPath, fbm,
  mulberry32, smoothstep, inPond,
} from './terrain.js';
import { createSky, HORIZON } from './Sky.js';

const GRID = 128;

export class World {
  constructor(scene, physics, quality) {
    this.scene = scene;
    this.physics = physics;
    this.quality = quality;
    this.sunDir = new THREE.Vector3(0.45, 0.78, 0.38).normalize();
    this.treeSpots = [];
    this.windUniform = { value: 0 };
    this.clouds = [];

    scene.background = HORIZON.clone();
    scene.fog = new THREE.Fog(HORIZON.clone(), quality.fog[0], quality.fog[1]);

    this.sky = createSky(this.sunDir);
    scene.add(this.sky);

    this.buildLights();
    this.buildTerrain();
    this.buildPath();
    this.buildTrees();
    this.buildRocksAndFlowers();
    this.buildGrass();
    this.buildClouds();
    this.buildBoundary();
    this.setQuality(quality);
  }

  // ------------------------------------------------------------------ lights

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x6a7a45, 1.15);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.7);
    this.sun.castShadow = true;
    // small biases: just enough to avoid acne, without lifting the shadow off the ground (no gap under blocks)
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.012;
    this.sun.shadow.camera.near = 20;
    this.sun.shadow.camera.far = 125;
    this.sun.castShadow = false; // real-time shadows are opt-in (Settings)
    this.shadowsOn = false;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  setShadows(on) {
    this.shadowsOn = on;
    this.sun.castShadow = on;
  }

  setShadowRange(r) {
    const c = this.sun.shadow.camera;
    c.left = -r;
    c.right = r;
    c.top = r;
    c.bottom = -r;
    c.updateProjectionMatrix();
    this.shadowRange = r;
  }

  // ------------------------------------------------------------------ terrain

  buildTerrain() {
    const n = GRID;
    const size = MESH_HALF * 2;
    const vcount = (n + 1) * (n + 1);
    const pos = new Float32Array(vcount * 3);
    const col = new Float32Array(vcount * 3);
    const nor = new Float32Array(vcount * 3);
    const idx = new Uint32Array(n * n * 6);

    const grassA = new THREE.Color('#5fae3f');
    const grassB = new THREE.Color('#79c250');
    const grassDry = new THREE.Color('#9bb552');
    const dirt = new THREE.Color('#8a6a45');
    const sand = new THREE.Color('#d8c98e');
    const bed = new THREE.Color('#5d8a86');
    const darkHill = new THREE.Color('#3f8a3c');
    const tmp = new THREE.Color();

    for (let j = 0; j <= n; j++) {
      for (let i = 0; i <= n; i++) {
        const k = j * (n + 1) + i;
        const x = -MESH_HALF + (i / n) * size;
        const z = -MESH_HALF + (j / n) * size;
        const h = terrainHeight(x, z);
        pos[k * 3] = x;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = z;

        const e = 0.6;
        const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
        const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
        const l = Math.hypot(dx, 2 * e, dz);
        nor[k * 3] = -dx / l;
        nor[k * 3 + 1] = (2 * e) / l;
        nor[k * 3 + 2] = -dz / l;

        // colour
        const patch = fbm(x * 0.12 + 40, z * 0.12 - 10);
        tmp.copy(grassA).lerp(grassB, smoothstep(0.35, 0.65, patch));
        tmp.lerp(grassDry, smoothstep(0.62, 0.8, fbm(x * 0.05 - 7, z * 0.05 + 3)) * 0.55);
        const fine = (fbm(x * 0.9, z * 0.9) - 0.5) * 0.1;
        tmp.offsetHSL(0, 0, fine);
        // dirt border along the path
        const dp = distToPath(x, z);
        tmp.lerp(dirt, (1 - smoothstep(1.7, 3.1, dp)) * 0.85);
        // sandy banks and dark bed
        const dpond = Math.hypot(x - POND.x, z - POND.z);
        if (dpond < POND.bowl + 3) {
          const wet = 1 - smoothstep(WATER_Y + 0.05, WATER_Y + 0.75, h);
          tmp.lerp(sand, wet * 0.9);
          tmp.lerp(bed, smoothstep(WATER_Y - 0.15, WATER_Y - 1.1, h));
        }
        const edge = Math.max(Math.abs(x), Math.abs(z));
        tmp.lerp(darkHill, smoothstep(WORLD_HALF - 6, WORLD_HALF + 12, edge) * 0.7);
        col[k * 3] = tmp.r;
        col[k * 3 + 1] = tmp.g;
        col[k * 3 + 2] = tmp.b;
      }
    }
    let t = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = j * (n + 1) + i;
        const b = a + 1;
        const c = a + n + 1;
        const d = c + 1;
        idx[t++] = a;
        idx[t++] = c;
        idx[t++] = b;
        idx[t++] = b;
        idx[t++] = c;
        idx[t++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    this.terrain = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.terrain.receiveShadow = true;
    this.scene.add(this.terrain);

    // the render mesh and the physics trimesh are built from the exact same vertices
    this.physics.addStaticTrimesh(pos, new Uint32Array(idx));
  }

  // ------------------------------------------------------------------ path

  buildPath() {
    // alternating stone slabs
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d');
    g.fillStyle = '#6f6a62';
    g.fillRect(0, 0, 256, 256);
    const tones = ['#d9d1c1', '#b9b0a0'];
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        g.fillStyle = tones[(r + c) % 2];
        g.fillRect(c * 64 + 3, r * 64 + 3, 58, 58);
        g.fillStyle = 'rgba(255,255,255,0.12)';
        g.fillRect(c * 64 + 3, r * 64 + 3, 58, 5);
        g.fillStyle = 'rgba(0,0,0,0.08)';
        g.fillRect(c * 64 + 3, r * 64 + 56, 58, 5);
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.pathTex = tex;

    const curve = pathCurve();
    const pts = curve.getSpacedPoints(150);
    const half = 1.55;
    const verts = [];
    const uvs = [];
    const ids = [];
    let dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[Math.min(pts.length - 1, i + 1)];
      const o = pts[Math.max(0, i - 1)];
      const tx = q.x - o.x;
      const tz = q.z - o.z;
      const l = Math.hypot(tx, tz) || 1;
      const nx = -tz / l;
      const nz = tx / l;
      if (i > 0) dist += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      for (const s of [-1, 1]) {
        const x = p.x + nx * half * s;
        const z = p.z + nz * half * s;
        verts.push(x, terrainHeight(x, z) + 0.05, z);
        uvs.push(s < 0 ? 0 : 1.5, dist / 1.5);
      }
      if (i < pts.length - 1) {
        const a = i * 2;
        ids.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(ids);
    geo.computeVertexNormals();
    // make sure normals point up regardless of winding
    const nrm = geo.attributes.normal;
    for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) < 0) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
    const mat = new THREE.MeshLambertMaterial({
      map: tex,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.path = new THREE.Mesh(geo, mat);
    this.path.receiveShadow = true;
    this.scene.add(this.path);
  }

  // ------------------------------------------------------------------ trees

  flat(geo) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    return g;
  }

  buildTrees() {
    const rnd = mulberry32(20241);
    const spots = [];
    const tryPlace = (minDist, tries, accept) => {
      for (let a = 0; a < tries; a++) {
        const x = (rnd() * 2 - 1) * (WORLD_HALF - 2);
        const z = (rnd() * 2 - 1) * (WORLD_HALF - 2);
        if (Math.hypot(x - START.x, z - START.z) < 17) continue; // keep the start area clear
        if (distToPath(x, z) < 4.2) continue;
        if (Math.hypot(x - POND.x, z - POND.z) < POND.bowl + 2.5) continue;
        if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < minDist)) continue;
        spots.push({ x, z, y: terrainHeight(x, z), r: rnd(), s: 0.8 + rnd() * 0.7, rot: rnd() * 6.28 });
        if (accept && !accept(spots[spots.length - 1])) spots.pop();
        if (spots.length >= 90) return;
      }
    };
    tryPlace(5.2, 900);
    this.treeSpots = spots;

    const species = { pine: [], round: [], poplar: [], birch: [] };
    for (const s of spots) {
      const r = s.r;
      (r < 0.34 ? species.pine : r < 0.64 ? species.round : r < 0.82 ? species.poplar : species.birch).push(s);
    }

    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.24, 1, 7).translate(0, 0.5, 0);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5535 });
    const birchMat = new THREE.MeshLambertMaterial({ color: 0xe9e4d6 });

    const pineGeo = this.flat(
      mergeGeometries([
        new THREE.ConeGeometry(1.5, 2.1, 8).translate(0, 2.3, 0),
        new THREE.ConeGeometry(1.2, 1.9, 8).translate(0, 3.3, 0),
        new THREE.ConeGeometry(0.85, 1.7, 8).translate(0, 4.3, 0),
      ]),
    );
    const roundGeo = this.flat(
      mergeGeometries([
        new THREE.IcosahedronGeometry(1.6, 1).translate(0, 3.4, 0),
        new THREE.IcosahedronGeometry(1.1, 1).translate(0.9, 2.8, 0.4),
        new THREE.IcosahedronGeometry(1.0, 1).translate(-0.8, 3.0, -0.5),
      ]),
    );
    const poplarGeo = this.flat(new THREE.IcosahedronGeometry(1, 1).scale(0.95, 3.2, 0.95).translate(0, 4.0, 0));
    const birchGeo = this.flat(
      mergeGeometries([
        new THREE.IcosahedronGeometry(1.25, 1).translate(0, 3.3, 0),
        new THREE.IcosahedronGeometry(0.9, 1).translate(0.7, 2.7, 0.3),
      ]),
    );
    const foliMat = new THREE.MeshLambertMaterial({ flatShading: true });

    const build = (list, foliGeo, tMat, hues, trunkH) => {
      if (!list.length) return;
      const trunk = new THREE.InstancedMesh(trunkGeo, tMat, list.length);
      const foli = new THREE.InstancedMesh(foliGeo, foliMat, list.length);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const c = new THREE.Color();
      list.forEach((s, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rot);
        m.compose(new THREE.Vector3(s.x, s.y - 0.1, s.z), q, new THREE.Vector3(s.s, trunkH * s.s, s.s));
        trunk.setMatrixAt(i, m);
        m.compose(new THREE.Vector3(s.x, s.y - 0.1, s.z), q, new THREE.Vector3(s.s, s.s, s.s));
        foli.setMatrixAt(i, m);
        c.setHSL(hues[0] + (s.r * 7.3 % 1) * hues[1], hues[2], hues[3] + (s.r * 3.7 % 1) * 0.1);
        foli.setColorAt(i, c);
        // static trunk collider
        const desc = this.physics.RAPIER.ColliderDesc.cylinder(1.6, 0.3 * s.s).setTranslation(s.x, s.y + 1.5, s.z);
        this.physics.addStaticCollider(desc);
      });
      for (const mesh of [trunk, foli]) {
        mesh.castShadow = true;
        mesh.receiveShadow = false;
        mesh.instanceMatrix.needsUpdate = true;
        this.scene.add(mesh);
      }
      foli.instanceColor.needsUpdate = true;
    };
    build(species.pine, pineGeo, trunkMat, [0.36, 0.05, 0.5, 0.2], 2.1);
    build(species.round, roundGeo, trunkMat, [0.27, 0.07, 0.5, 0.3], 2.3);
    build(species.poplar, poplarGeo, trunkMat, [0.24, 0.06, 0.55, 0.32], 1.6);
    build(species.birch, birchGeo, birchMat, [0.2, 0.05, 0.6, 0.38], 2.4);
  }

  // ------------------------------------------------------------------ rocks / flowers / bushes

  buildRocksAndFlowers() {
    const rnd = mulberry32(777);
    const R = this.physics.RAPIER;

    // rocks (some around the pond shore)
    const rocks = [];
    for (let a = 0; a < 26; a++) {
      const ang = rnd() * Math.PI * 2;
      const rad = POND.bowl * (0.74 + rnd() * 0.3);
      rocks.push({ x: POND.x + Math.cos(ang) * rad, z: POND.z + Math.sin(ang) * rad, s: 0.35 + rnd() * 0.7 });
    }
    for (let a = 0; a < 40; a++) {
      const x = (rnd() * 2 - 1) * (WORLD_HALF - 3);
      const z = (rnd() * 2 - 1) * (WORLD_HALF - 3);
      if (Math.hypot(x - START.x, z - START.z) < 14 || distToPath(x, z) < 3 || inPond(x, z, 1.5)) continue;
      rocks.push({ x, z, s: 0.3 + rnd() * 0.9 });
    }
    const valid = rocks.filter((r) => distToPath(r.x, r.z) > 2.2 && !inPond(r.x, r.z, -1.2));
    const rockGeo = this.flat(new THREE.DodecahedronGeometry(1, 0));
    this.rockMesh = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ flatShading: true }), valid.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    valid.forEach((r, i) => {
      const y = terrainHeight(r.x, r.z);
      e.set(rnd() * 0.5, rnd() * 6.28, rnd() * 0.5);
      q.setFromEuler(e);
      m.compose(new THREE.Vector3(r.x, y + r.s * 0.18, r.z), q, new THREE.Vector3(r.s * 1.15, r.s * 0.75, r.s));
      this.rockMesh.setMatrixAt(i, m);
      c.setHSL(0.09, 0.05 + rnd() * 0.05, 0.42 + rnd() * 0.16);
      this.rockMesh.setColorAt(i, c);
      this.physics.addStaticCollider(R.ColliderDesc.ball(r.s * 0.72).setTranslation(r.x, y + r.s * 0.12, r.z));
    });
    this.rockMesh.castShadow = true;
    this.rockMesh.receiveShadow = true;
    this.scene.add(this.rockMesh);

    // bushes
    const bushes = [];
    for (let a = 0; a < 220 && bushes.length < 36; a++) {
      const x = (rnd() * 2 - 1) * (WORLD_HALF - 2);
      const z = (rnd() * 2 - 1) * (WORLD_HALF - 2);
      if (Math.hypot(x - START.x, z - START.z) < 13 || distToPath(x, z) < 3 || inPond(x, z, 2)) continue;
      bushes.push({ x, z, s: 0.6 + rnd() * 0.7 });
    }
    const bushGeo = this.flat(
      mergeGeometries([
        new THREE.IcosahedronGeometry(0.6, 1).translate(0, 0.5, 0),
        new THREE.IcosahedronGeometry(0.45, 1).translate(0.45, 0.38, 0.1),
        new THREE.IcosahedronGeometry(0.42, 1).translate(-0.4, 0.36, -0.15),
      ]),
    );
    this.bushMesh = new THREE.InstancedMesh(bushGeo, new THREE.MeshLambertMaterial({ flatShading: true }), bushes.length);
    bushes.forEach((b, i) => {
      m.compose(new THREE.Vector3(b.x, terrainHeight(b.x, b.z) - 0.05, b.z), q.identity(), new THREE.Vector3(b.s, b.s, b.s));
      this.bushMesh.setMatrixAt(i, m);
      c.setHSL(0.27 + rnd() * 0.06, 0.5, 0.28 + rnd() * 0.08);
      this.bushMesh.setColorAt(i, c);
    });
    this.bushMesh.castShadow = true;
    this.scene.add(this.bushMesh);

    // flowers
    const fl = [];
    for (let a = 0; a < 800 && fl.length < 240; a++) {
      const x = (rnd() * 2 - 1) * (WORLD_HALF - 2);
      const z = (rnd() * 2 - 1) * (WORLD_HALF - 2);
      if (distToPath(x, z) < 2.0 || inPond(x, z, 1.2)) continue;
      if (fbm(x * 0.09, z * 0.09) < 0.5) continue; // clustered in meadows
      fl.push({ x, z });
    }
    const petal = new THREE.SphereGeometry(0.09, 6, 5).translate(0, 0.32, 0);
    const stem = new THREE.CylinderGeometry(0.012, 0.012, 0.32, 4).translate(0, 0.16, 0);
    stem.setAttribute('color', new THREE.BufferAttribute(new Float32Array(stem.attributes.position.count * 3).fill(0.35), 3));
    petal.setAttribute('color', new THREE.BufferAttribute(new Float32Array(petal.attributes.position.count * 3).fill(1), 3));
    const flowerGeo = mergeGeometries([stem, petal]);
    this.flowerMesh = new THREE.InstancedMesh(flowerGeo, new THREE.MeshLambertMaterial({ vertexColors: true }), fl.length);
    const palette = ['#ffffff', '#ffe14d', '#ff7aa8', '#c58bff', '#ff9a4d'];
    fl.forEach((f, i) => {
      m.compose(new THREE.Vector3(f.x, terrainHeight(f.x, f.z), f.z), q.identity(), new THREE.Vector3(1, 0.8 + rnd() * 0.7, 1));
      this.flowerMesh.setMatrixAt(i, m);
      this.flowerMesh.setColorAt(i, c.set(palette[Math.floor(rnd() * palette.length)]));
    });
    this.scene.add(this.flowerMesh);

    // fallen logs
    const logGeo = new THREE.CylinderGeometry(0.28, 0.3, 3.4, 8).rotateZ(Math.PI / 2);
    const logMat = new THREE.MeshLambertMaterial({ color: 0x6d4a2e });
    const spots = [[-14, 6, 0.5], [24, 14, 2.2], [-26, -18, 1.1]];
    for (const [x, z, ry] of spots) {
      const lg = new THREE.Mesh(logGeo, logMat);
      const y = terrainHeight(x, z) + 0.26;
      lg.position.set(x, y, z);
      lg.rotation.y = ry;
      lg.castShadow = true;
      lg.receiveShadow = true;
      this.scene.add(lg);
      this.physics.addStaticCollider(
        R.ColliderDesc.cuboid(1.7, 0.28, 0.28).setTranslation(x, y, z).setRotation(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0))),
      );
    }
  }

  // ------------------------------------------------------------------ grass

  buildGrass() {
    const rnd = mulberry32(99);
    const MAX = 7000;
    const blade = (ang, lean) => {
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      const w = 0.05;
      const pts = [
        [-w, 0, 0],
        [w, 0, 0],
        [lean * 0.4, 0.5, 0],
      ];
      return pts.map(([x, y, z]) => [x * ca - z * sa + lean * sa * 0.0, y, x * sa + z * ca + (y > 0.1 ? lean * 0.6 * ca : 0)]);
    };
    const verts = [];
    const colors = [];
    for (let k = 0; k < 4; k++) {
      const ang = (k / 4) * Math.PI + 0.3;
      const tri = blade(ang, 0.12 + 0.05 * k);
      for (const v of tri) {
        verts.push(v[0] * 1.3, v[1] * (0.8 + 0.1 * k), v[2] * 1.3);
        colors.push(v[1] > 0.1 ? 1 : 0.55, v[1] > 0.1 ? 1 : 0.55, v[1] > 0.1 ? 1 : 0.55);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    // normals straight up so blades shade like the ground beneath them
    const n = geo.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);

    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const wind = this.windUniform;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = wind;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWind;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float sw = sin(uWind * 1.7 + instanceMatrix[3].x * 0.4 + instanceMatrix[3].z * 0.33);
           transformed.x += sw * 0.09 * position.y * position.y * 4.0;
           transformed.z += sw * 0.05 * position.y * position.y * 4.0;`,
        );
    };

    this.grassMax = MAX;
    this.grassMesh = new THREE.InstancedMesh(geo, mat, MAX);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    let placed = 0;
    for (let a = 0; a < MAX * 3 && placed < MAX; a++) {
      const x = (rnd() * 2 - 1) * (WORLD_HALF + 4);
      const z = (rnd() * 2 - 1) * (WORLD_HALF + 4);
      if (distToPath(x, z) < 1.6 || inPond(x, z, 0.4)) continue;
      const y = terrainHeight(x, z);
      if (y < WATER_Y + 0.15) continue;
      const s = 0.7 + rnd() * 0.9;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6.28);
      m.compose(new THREE.Vector3(x, y - 0.02, z), q, new THREE.Vector3(s, s * (0.8 + rnd() * 0.6), s));
      this.grassMesh.setMatrixAt(placed, m);
      c.setHSL(0.24 + rnd() * 0.07, 0.5 + rnd() * 0.2, 0.34 + rnd() * 0.16);
      this.grassMesh.setColorAt(placed, c);
      placed++;
    }
    this.grassMesh.count = placed;
    this.grassPlaced = placed;
    this.grassMesh.frustumCulled = false;
    this.grassMesh.receiveShadow = false;
    this.scene.add(this.grassMesh);
  }

  // ------------------------------------------------------------------ clouds

  buildClouds() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.35, 'rgba(255,255,255,0.4)');
    grd.addColorStop(0.7, 'rgba(255,255,255,0.1)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const rnd = mulberry32(5);
    this.cloudGroup = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const cx = (rnd() * 2 - 1) * 160;
      const cz = (rnd() * 2 - 1) * 160;
      const cy = 95 + rnd() * 40;
      for (let k = 0; k < 4; k++) {
        const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.6 });
        const sp = new THREE.Sprite(mat);
        sp.position.set(cx + (k - 1.5) * 16 + rnd() * 6, cy + rnd() * 3, cz + rnd() * 10);
        const s = 34 + rnd() * 24;
        sp.scale.set(s, s * 0.5, 1);
        this.cloudGroup.add(sp);
      }
    }
    this.scene.add(this.cloudGroup);
  }

  buildBoundary() {
    const R = this.physics.RAPIER;
    const w = WORLD_HALF + 3;
    const walls = [
      [w, 0, 0.5, 20, w],
      [-w, 0, 0.5, 20, w],
      [0, w, w, 20, 0.5],
      [0, -w, w, 20, 0.5],
    ];
    for (const [x, z, hx, hy, hz] of walls) {
      this.physics.addStaticCollider(R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, hy - 4, z));
    }
  }

  // ------------------------------------------------------------------ quality + update

  setQuality(q) {
    this.quality = q;
    this.sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.setShadowRange(q.shadowRange);
    this.scene.fog.near = q.fog[0];
    this.scene.fog.far = q.fog[1];
    this.grassMesh.count = Math.min(this.grassPlaced, q.grass);
    this.rockMesh.castShadow = q.rockShadows;
    this.bushMesh.castShadow = q.rockShadows;
  }

  update(dt, t, focus, camera) {
    this.windUniform.value = t;
    this.sky.position.copy(camera.position);
    // shadow camera follows the player, snapped to shadow texels to avoid shimmering
    const texel = (this.shadowRange * 2) / this.quality.shadowMap;
    const sx = Math.round(focus.x / texel) * texel;
    const sy = Math.round(focus.y / texel) * texel;
    const sz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(sx, sy, sz);
    this.sun.position.set(sx + this.sunDir.x * 70, sy + this.sunDir.y * 70, sz + this.sunDir.z * 70);
    this.sun.target.updateMatrixWorld();
    this.cloudGroup.position.x = Math.sin(t * 0.012) * 70; // slow drift, never pops
  }
}
