/**
 * El reactor: núcleo central que representa la racha actual.
 *
 * A mayor racha, más energía: el núcleo crece, late más rápido, los anillos
 * orbitan más deprisa y aparece un halo. Es el "corazón" de la escena.
 */

import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';

const CORE_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec3 vNormalW;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const CORE_FRAG = /* glsl */ `
  uniform float uTime;
  uniform float uEnergy;     // 0..1 normalizado desde la racha
  uniform vec3 uColorInner;
  uniform vec3 uColorOuter;

  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    // Fresnel: el borde brilla, el centro es translúcido. Da volumen de plasma.
    float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.5);

    // Ondas de energía que recorren la superficie.
    float waves = sin(vNormal.y * 12.0 - uTime * 3.0) * 0.5 + 0.5;
    waves = pow(waves, 3.0) * uEnergy;

    float pulse = 0.85 + 0.15 * sin(uTime * (2.0 + uEnergy * 3.0));

    vec3 color = mix(uColorInner, uColorOuter, fresnel);
    color += uColorOuter * waves * 0.6;
    color *= pulse;

    // El centro se mantiene translúcido: el volumen lo aporta el fresnel, no
    // un núcleo blanco (que el bloom convertía en una bola plana).
    float alpha = (0.10 + fresnel * 0.85 + waves * 0.30) * (0.45 + uEnergy * 0.55);
    gl_FragColor = vec4(color, clamp(alpha, 0.0, 1.0));
  }
`;

// `cap` limita el tamaño: con rachas muy altas el núcleo se comía la escena.
const MAX_ENERGY_SCALE = 0.55;
const ENERGY_SATURATION = 30;

export function createReactor({ position = [0, 2.6, 0] } = {}) {
  const group = new Group();
  group.position.set(...position);

  /* --- Núcleo de plasma --- */
  const coreMaterial = new ShaderMaterial({
    vertexShader: CORE_VERT,
    fragmentShader: CORE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uEnergy: { value: 0 },
      uColorInner: { value: new Color(0x9fe4ff) },
      uColorOuter: { value: new Color(0x35d6ff) },
    },
  });
  const core = new Mesh(new SphereGeometry(1, 48, 32), coreMaterial);
  group.add(core);

  /* --- Cáscara poliédrica (wireframe) --- */
  const shellMaterial = new MeshBasicMaterial({
    color: 0x4fe3ff,
    wireframe: true,
    transparent: true,
    opacity: 0.28,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const shell = new Mesh(new IcosahedronGeometry(1.42, 1), shellMaterial);
  group.add(shell);

  /* --- Anillos orbitales --- */
  const ringColors = [0x35d6ff, 0xff6ad5, 0xa78bfa];
  const rings = ringColors.map((color, i) => {
    const mesh = new Mesh(
      new TorusGeometry(1.9 + i * 0.55, 0.028, 8, 96),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.6,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    mesh.rotation.x = Math.PI / 2 + (i - 1) * 0.55;
    mesh.rotation.z = i * 0.4;
    group.add(mesh);
    return mesh;
  });

  /* --- Halo plano bajo el núcleo --- */
  const halo = new Mesh(
    new RingGeometry(1.3, 2.3, 64),
    new MeshBasicMaterial({
      color: 0x35d6ff,
      transparent: true,
      opacity: 0.25,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -position[1] + 0.05;
  group.add(halo);

  const light = new PointLight(0x35d6ff, 40, 22, 2);
  group.add(light);

  let time = 0;
  let energy = 0;      // valor actual, interpolado
  let targetEnergy = 0; // valor objetivo según la racha

  return {
    group,
    core,
    light,

    /** Racha -> energía normalizada (satura a los 30 días). */
    setStreak(streak) {
      targetEnergy = Math.min(1, streak / ENERGY_SATURATION);
    },

    update(dt) {
      time += dt;
      // Interpolación suave para que los cambios de racha no sean un salto.
      energy += (targetEnergy - energy) * Math.min(1, dt * 2.2);

      coreMaterial.uniforms.uTime.value = time;
      coreMaterial.uniforms.uEnergy.value = energy;

      const breathe = 1 + Math.sin(time * (1.6 + energy * 2.4)) * (0.05 + energy * 0.08);
      core.scale.setScalar((0.62 + energy * MAX_ENERGY_SCALE) * breathe);
      shell.scale.setScalar(core.scale.x * 1.06);
      shell.rotation.y += dt * (0.15 + energy * 0.5);
      shell.rotation.x += dt * 0.07;

      rings.forEach((ring, i) => {
        ring.rotation.z += dt * (0.3 + i * 0.22) * (0.6 + energy * 1.8) * (i % 2 === 0 ? 1 : -1);
        ring.scale.setScalar(0.85 + energy * 0.4);
      });

      halo.material.opacity = 0.05 + energy * 0.1 + Math.sin(time * 2) * 0.015;
      halo.scale.setScalar(0.9 + energy * 0.25);

      light.intensity = 18 + energy * 42 + Math.sin(time * 2.2) * 4;
    },

    dispose() {
      core.geometry.dispose();
      coreMaterial.dispose();
      shell.geometry.dispose();
      shellMaterial.dispose();
      rings.forEach((r) => {
        r.geometry.dispose();
        r.material.dispose();
      });
      halo.geometry.dispose();
      halo.material.dispose();
    },
  };
}
