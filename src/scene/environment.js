/**
 * El laboratorio: sala futurista procedural.
 *
 * Todo es geometría + shaders (sin assets), pensado para que luego se puedan
 * sustituir las texturas por imágenes generadas con ComfyUI.
 */

import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  FogExp2,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  RingGeometry,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
} from 'three';

/* ------------------------------------------------------------------ */
/* Suelo holográfico                                                   */
/* ------------------------------------------------------------------ */

const FLOOR_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FLOOR_FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uAccent;
  uniform float uGridScale;

  varying vec3 vWorld;

  // Devuelve el antialias de una línea de rejilla de anchura fija en pantalla.
  float gridLine(vec2 p, float scale, float thickness) {
    vec2 coord = p * scale;
    vec2 grid = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
    float line = min(grid.x, grid.y);
    return 1.0 - min(line / thickness, 1.0);
  }

  void main() {
    vec2 p = vWorld.xz;
    float dist = length(p);

    // Dos rejillas: fina y gruesa, para dar sensación de escala.
    float fine = gridLine(p, uGridScale, 1.0);
    float coarse = gridLine(p, uGridScale / 5.0, 1.4);

    // Onda expansiva lenta desde el centro: marca el "pulso" del laboratorio.
    float pulse = sin(dist * 0.6 - uTime * 1.6) * 0.5 + 0.5;
    pulse = pow(pulse, 6.0);

    vec3 color = uColorA;
    color = mix(color, uColorB, coarse * 0.6);
    color += uAccent * fine * 0.35;
    color += uAccent * pulse * 0.5;

    // Difuminado radial: el suelo se pierde en la niebla.
    float fade = 1.0 - smoothstep(12.0, 46.0, dist);
    float alpha = fade * (0.14 + fine * 0.5 + coarse * 0.3);

    gl_FragColor = vec4(color, alpha);
  }
`;

function createFloor({ radius = 46, colorA = 0x0a1622, colorB = 0x123a4d, accent = 0x2ad4ff, gridScale = 1.2 }) {
  const material = new ShaderMaterial({
    vertexShader: FLOOR_VERT,
    fragmentShader: FLOOR_FRAG,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uColorA: { value: new Color(colorA) },
      uColorB: { value: new Color(colorB) },
      uAccent: { value: new Color(accent) },
      uGridScale: { value: gridScale },
    },
  });

  const mesh = new Mesh(new CircleGeometry(radius, 96), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0;
  return { mesh, material };
}

/* ------------------------------------------------------------------ */
/* Cúpula                                                             */
/* ------------------------------------------------------------------ */

function createDome({ radius = 44, color = 0x0a1b2a }) {
  const geometry = new SphereGeometry(radius, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const material = new ShaderMaterial({
    side: BackSide,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new Color(color) },
      uAccent: { value: new Color(0x1b6f8c) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uAccent;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        // Degradado vertical: oscuro arriba, con resplandor en la base.
        float h = clamp((vWorld.y + 8.0) / 40.0, 0.0, 1.0);
        float glow = pow(1.0 - h, 2.0);
        vec3 color = mix(uColor, uAccent, glow * 0.55);
        gl_FragColor = vec4(color, 0.55 - h * 0.35);
      }
    `,
  });
  return new Mesh(geometry, material);
}

/* ------------------------------------------------------------------ */
/* Pilares y elementos de sala                                         */
/* ------------------------------------------------------------------ */

function createPillars({ count = 6, radius = 26, height = 9, color = 0x2ad4ff }) {
  const group = new Group();
  const shaftGeo = new CylinderGeometry(0.32, 0.42, height, 12, 1, true);
  const shaftMat = new MeshStandardMaterial({
    color: 0x0d2233,
    roughness: 0.4,
    metalness: 0.8,
    side: DoubleSide,
  });
  const stripGeo = new BoxGeometry(0.06, height * 0.82, 0.06);
  const stripMat = new MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    const pillar = new Group();
    pillar.position.set(x, 0, z);
    pillar.rotation.y = -angle;

    const shaft = new Mesh(shaftGeo, shaftMat);
    shaft.position.y = height / 2;
    pillar.add(shaft);

    for (const side of [-1, 1]) {
      const strip = new Mesh(stripGeo, stripMat);
      strip.position.set(side * 0.38, height / 2, 0);
      pillar.add(strip);
    }

    // Base iluminada.
    const base = new Mesh(new RingGeometry(0.55, 1.0, 24), stripMat);
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.06;
    pillar.add(base);

    group.add(pillar);
  }

  return group;
}

/** Anillos de techo que giran lentamente. */
function createCeilingRings({ count = 3, radius = [6, 10, 14], y = 12, color = 0x2ad4ff }) {
  const group = new Group();
  const rings = [];
  for (let i = 0; i < count; i++) {
    const geo = new TorusGeometry(radius[i], 0.045, 8, 96);
    const mat = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.35 - i * 0.07,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const ring = new Mesh(geo, mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y + i * 0.8;
    group.add(ring);
    rings.push(ring);
  }
  return { group, rings };
}

/** Circuitos: líneas luminosas en el suelo que conectan zonas. */
function createCircuits({ color = 0x1e7f9c }) {
  const positions = [];
  const hubCount = 8;
  for (let i = 0; i < hubCount; i++) {
    const a1 = (i / hubCount) * Math.PI * 2;
    const a2 = ((i + 1) / hubCount) * Math.PI * 2;
    const r1 = 6.5;
    const r2 = 13.5;
    // Dos segmentos por tramo con un "nodo" intermedio: da elbows de circuito.
    positions.push(Math.cos(a1) * r1, 0.02, Math.sin(a1) * r1);
    positions.push(Math.cos(a1) * r2, 0.02, Math.sin(a1) * r2);
    positions.push(Math.cos(a1) * r2, 0.02, Math.sin(a1) * r2);
    positions.push(Math.cos(a2) * r2, 0.02, Math.sin(a2) * r2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  const material = new LineBasicMaterial({ color, transparent: true, opacity: 0.5 });
  return new LineSegments(geometry, material);
}

/* ------------------------------------------------------------------ */
/* Composición                                                        */
/* ------------------------------------------------------------------ */

export function createEnvironment(scene, options = {}) {
  scene.fog = new FogExp2(0x040a12, 0.021);

  const group = new Group();
  const { mesh: floor, material: floorMat } = createFloor(options.floor ?? {});
  const dome = createDome(options.dome ?? {});
  const pillars = createPillars(options.pillars ?? {});
  const { group: rings, rings: ringMeshes } = createCeilingRings(options.rings ?? {});
  const circuits = createCircuits(options.circuits ?? {});

  group.add(floor, dome, pillars, rings, circuits);
  scene.add(group);

  // Luces: clave fría, relleno azul y un acento cálido para contrastar.
  const keyLight = new PointLight(0x8fe9ff, 90, 40, 2);
  keyLight.position.set(0, 11, 0);
  scene.add(keyLight);

  const accentLight = new PointLight(0xff6ad5, 26, 26, 2);
  accentLight.position.set(-9, 3.2, -8);
  scene.add(accentLight);

  const fillLight = new PointLight(0x2a7fff, 18, 32, 2);
  fillLight.position.set(10, 5, 8);
  scene.add(fillLight);

  let time = 0;

  return {
    group,
    floorMat,

    /** @param {number} dt @param {number} streak usado para modular la luz */
    update(dt, streak = 0) {
      time += dt;
      floorMat.uniforms.uTime.value = time;

      ringMeshes.forEach((ring, i) => {
        ring.rotation.z += dt * (0.05 + i * 0.035) * (i % 2 === 0 ? 1 : -1);
      });

      // La luz late con la racha: el laboratorio "respira" más cuanto más llevas.
      const pulse = 1 + Math.sin(time * 2.2) * 0.08 + Math.min(streak, 10) * 0.05;
      keyLight.intensity = 90 * pulse;
      accentLight.intensity = 26 * (1 + Math.sin(time * 1.3 + 1.2) * 0.15);
    },
  };
}
