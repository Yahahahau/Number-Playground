// Procedural sky: one GLSL function shared by the sky dome, the water reflection and the PMREM
// environment used for glossy block reflections, so everything agrees on the same colours.
import * as THREE from 'three';

export const SKY_GLSL = /* glsl */ `
vec3 skyColor(vec3 dir, vec3 sunDir) {
  float h = clamp(dir.y, -0.3, 1.0);
  vec3 horizon = vec3(0.70, 0.86, 0.97);
  vec3 zenith  = vec3(0.14, 0.42, 0.85);
  vec3 col = mix(horizon, zenith, pow(max(h, 0.0), 0.5));
  float sd = max(dot(dir, sunDir), 0.0);
  col += vec3(1.0, 0.82, 0.55) * (pow(sd, 900.0) * 4.0 + pow(sd, 14.0) * 0.22);
  col = mix(col, horizon * 0.85, smoothstep(0.0, -0.25, dir.y));
  return col;
}
`;

export const HORIZON = new THREE.Color().setRGB(0.7, 0.86, 0.97, THREE.LinearSRGBColorSpace);

export function createSky(sunDir) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { uSun: { value: sunDir.clone() } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uSun;
      varying vec3 vDir;
      ${SKY_GLSL}
      void main() {
        gl_FragColor = vec4(skyColor(normalize(vDir), uSun), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(450, 24, 14), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}
