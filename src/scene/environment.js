/**
 * El laboratorio: sala industrial futurista.
 *
 * Todo es geometría + texturas procedurales, sin assets. El realismo viene de
 * lo que hace PBR de verdad: materiales `MeshStandardMaterial` con mapas de
 * rugosidad y normales, un mapa de entorno para los reflejos, y luces físicas
 * con sombras reales. Un `MeshBasicMaterial` coloreado no refleja nada y se lee
 * como plano, por mucho bloom que se le ponga.
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
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { metalSurface, labFloor, wallPanels } from './textures.js';

/* ------------------------------------------------------------------ */
/* Suelo                                                              */
/* ------------------------------------------------------------------ */

/**
 * Suelo de placas metálicas.
 *
 * El detalle viene de las texturas (albedo, rugosidad, normales) y de una
 * ligera capa de rejilla emisiva encima, que aporta la lectura "suelo
 * holográfico" sin renunciar a la superficie física.
 */
function createFloor({ radius = 44 } = {}) {
  const { map, roughnessMap, normalMap } = labFloor({ repeat: 14 });

  const material = new MeshStandardMaterial({
    map,
    roughnessMap,
    normalMap,
    color: 0x3c5a72,
    roughness: 0.62,
    metalness: 0.85,
    // Un pelo de clearcoat: capa Barniz sobre metal, muy de nave espacial.
    envMapIntensity: 1.1,
  });

  // Segunda capa: rejilla emisiva sutil, la parte "holográfica".
  const grid = new Mesh(
    new CircleGeometry(radius, 96),
    new MeshStandardMaterial({
      color: 0x0a1622,
      emissive: new Color(0x1d7fa8),
      emissiveIntensity: 0.35,
      roughness: 0.3,
      metalness: 0.6,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  );
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = 0.012;

  const mesh = new Mesh(new CircleGeometry(radius, 96), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;

  const group = new Group();
  group.add(mesh, grid);
  return { group, mesh, material };
}

/* ------------------------------------------------------------------ */
/* Cúpula / techo                                                     */
/* ------------------------------------------------------------------ */

function createDome({ radius = 44 } = {}) {
  const { roughnessMap, normalMap } = wallPanels({ repeat: 8 });

  const geometry = new SphereGeometry(radius, 48, 24, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const material = new MeshStandardMaterial({
    side: BackSide,
    roughnessMap,
    normalMap,
    // La textura de pared sale muy oscura de SD 1.5: sin subir el color base
    // las paredes se pierden por completo en la penumbra.
    color: 0x5b7d94,
    emissive: new Color(0x0d2233),
    emissiveIntensity: 0.6,
    roughness: 0.8,
    metalness: 0.55,
    envMapIntensity: 0.5,
  });
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Estructura                                                         */
/* ------------------------------------------------------------------ */

/** Columnas de carga con perfil metálico real. */
function createPillars({ count = 6, radius = 24, height = 9 } = {}) {
  const group = new Group();
  const { roughnessMap, normalMap } = metalSurface({ repeat: 2, seed: 11 });

  const baseMat = new MeshStandardMaterial({
    color: 0x33454f,
    roughnessMap,
    normalMap,
    roughness: 0.5,
    metalness: 0.9,
    envMapIntensity: 1.2,
  });
  const trimMat = new MeshStandardMaterial({
    color: 0x1b2a33,
    roughness: 0.65,
    metalness: 0.8,
  });
  const stripMat = new MeshStandardMaterial({
    color: 0x0a1420,
    emissive: new Color(0x2ad4ff),
    emissiveIntensity: 2.2,
    roughness: 0.4,
    metalness: 0.2,
  });

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const pillar = new Group();
    pillar.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    pillar.rotation.y = -angle;

    // Fuste octogonal: lee como metal mecanizado, no como un tubo liso.
    const shaft = new Mesh(new CylinderGeometry(0.34, 0.44, height, 8, 1), baseMat);
    shaft.position.y = height / 2;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    pillar.add(shaft);

    // Collarines arriba y abajo: dan escala y sombra de contacto.
    for (const y of [0.12, height - 0.12]) {
      const collar = new Mesh(new CylinderGeometry(0.5, 0.5, 0.16, 8), trimMat);
      collar.position.y = y;
      collar.castShadow = true;
      pillar.add(collar);
    }

    // Tiras de luz emisivas incrustadas.
    for (const side of [-1, 1]) {
      const strip = new Mesh(new BoxGeometry(0.05, height * 0.8, 0.1), stripMat);
      strip.position.set(side * 0.4, height / 2, 0);
      pillar.add(strip);
    }

    group.add(pillar);
  }
  return { group, material: baseMat };
}

/** Vigas del techo: dan techo real y sombras proyectadas. */
function createCeiling({ radius = 22, y = 12, count = 5 } = {}) {
  const group = new Group();
  const mat = new MeshStandardMaterial({
    color: 0x22333e,
    roughness: 0.6,
    metalness: 0.85,
  });

  for (let i = 0; i < count; i++) {
    const z = -radius + ((i + 0.5) / count) * radius * 2;
    const beam = new Mesh(new BoxGeometry(radius * 2, 0.5, 0.45), mat);
    beam.position.set(0, y + (i % 2) * 0.7, z);
    beam.castShadow = true;
    group.add(beam);
  }
  return group;
}

/** Anillos de techo que giran: detalle de la atmosphere. */
function createCeilingRings({ count = 3, radius = [6, 10, 14], y = 11, color = 0x2ad4ff } = {}) {
  const group = new Group();
  const rings = [];
  for (let i = 0; i < count; i++) {
    const ring = new Mesh(
      new TorusGeometry(radius[i], 0.05, 8, 96),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.4 - i * 0.08,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y - i * 0.8;
    group.add(ring);
    rings.push(ring);
  }
  return { group, rings };
}

/** Circuitos luminosos incrustados en el suelo. */
function createCircuits({ color = 0x2ad4ff, hubCount = 8 } = {}) {
  const positions = [];
  for (let i = 0; i < hubCount; i++) {
    const a1 = (i / hubCount) * Math.PI * 2;
    const a2 = ((i + 1) / hubCount) * Math.PI * 2;
    positions.push(Math.cos(a1) * 6.5, 0.03, Math.sin(a1) * 6.5);
    positions.push(Math.cos(a1) * 13.5, 0.03, Math.sin(a1) * 13.5);
    positions.push(Math.cos(a1) * 13.5, 0.03, Math.sin(a1) * 13.5);
    positions.push(Math.cos(a2) * 13.5, 0.03, Math.sin(a2) * 13.5);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  return new LineSegments(
    geometry,
    new LineBasicMaterial({ color, transparent: true, opacity: 0.55 }),
  );
}

/**
 * Consolas y cajas: mobiliario que da escala y puntos de apoyo visual.
 * Sin ellos la sala es un suelo y un techo: no hay dónde mirar.
 */
function createProps() {
  const group = new Group();
  const { roughnessMap, normalMap } = metalSurface({ repeat: 1, seed: 5 });
  const bodyMat = new MeshStandardMaterial({
    color: 0x2b3d47,
    roughnessMap,
    normalMap,
    roughness: 0.55,
    metalness: 0.9,
    envMapIntensity: 1.1,
  });
  const screenMat = new MeshStandardMaterial({
    color: 0x05121a,
    emissive: new Color(0x1a7fa8),
    emissiveIntensity: 1.6,
    roughness: 0.15,
    metalness: 0.1,
  });

  // Consolas repartidas por el anillo exterior, mirando al centro.
  const consoles = 5;
  for (let i = 0; i < consoles; i++) {
    const angle = (i / consoles) * Math.PI * 2 + 0.5;
    const x = Math.cos(angle) * 17;
    const z = Math.sin(angle) * 17;

    const unit = new Group();
    unit.position.set(x, 0, z);
    unit.rotation.y = -angle + Math.PI / 2;

    // Mueble bajo.
    const body = new Mesh(new BoxGeometry(2.6, 1.1, 0.9), bodyMat);
    body.position.y = 0.55;
    body.castShadow = true;
    body.receiveShadow = true;
    unit.add(body);

    // Pantalla inclinada.
    const screen = new Mesh(new BoxGeometry(2.3, 0.06, 0.7), screenMat);
    screen.position.set(0, 1.24, 0.05);
    screen.rotation.x = -0.42;
    unit.add(screen);

    // Soporte.
    const stand = new Mesh(new BoxGeometry(0.16, 0.25, 0.16), bodyMat);
    stand.position.set(0, 1.1, 0.3);
    unit.add(stand);

    group.add(unit);
  }

  // Cajas de equipo apiladas en dos puntos.
  for (const [cx, cz, rot] of [[-19, 6, 0.4], [15, -14, -0.9]]) {
    const stack = new Group();
    stack.position.set(cx, 0, cz);
    stack.rotation.y = rot;

    const sizes = [
      [1.4, 0.9, 1.0, 0],
      [1.1, 0.7, 0.9, 0.9],
      [0.8, 0.5, 0.7, 1.5],
    ];
    for (const [w, h, d, y] of sizes) {
      const crate = new Mesh(new BoxGeometry(w, h, d), bodyMat);
      crate.position.set((Math.random() - 0.5) * 0.15, y + h / 2, (Math.random() - 0.5) * 0.15);
      crate.castShadow = true;
      crate.receiveShadow = true;
      stack.add(crate);
    }
    group.add(stack);
  }

  return { group, material: bodyMat };
}

/** Conduitos y cableado colgando del techo: detalle secundario pero vende la escala. */
function createPipes() {
  const group = new Group();
  const mat = new MeshStandardMaterial({
    color: 0x3a4c56,
    roughness: 0.45,
    metalness: 0.95,
    envMapIntensity: 1.3,
  });

  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const pipe = new Mesh(new CylinderGeometry(0.09, 0.09, 18, 10), mat);
    pipe.position.set(Math.cos(angle) * 12, 9, Math.sin(angle) * 12);
    pipe.rotation.z = 0.12 * Math.cos(angle);
    pipe.rotation.x = 0.12 * Math.sin(angle);
    pipe.castShadow = true;
    group.add(pipe);
  }
  return group;
}

/* ------------------------------------------------------------------ */
/* Composición                                                        */
/* ------------------------------------------------------------------ */

export function createEnvironment(scene) {
  scene.fog = new FogExp2(0x060d16, 0.018);

  const group = new Group();
  const { group: floorGroup, mesh: floorMesh, material: floorMat } = createFloor();
  const dome = createDome();
  const { group: pillarGroup, material: pillarMat } = createPillars();
  const ceiling = createCeiling();
  const { group: rings, rings: ringMeshes } = createCeilingRings();
  const circuits = createCircuits();
  const { group: props, material: panelMat } = createProps();
  const pipes = createPipes();

  group.add(floorGroup, dome, pillarGroup, ceiling, rings, circuits, props, pipes);
  scene.add(group);

  // Iluminacion.
  // El hemisférico da la base (cielo frío / suelo oscuro); sin él, las caras
  // no iluminadas son negro puro y la escena pierde volumen.
  const ambient = new HemisphereLight(0x5aa8d0, 0x0a1218, 0.35);
  scene.add(ambient);

  // Intensidades en candelas (Three usa unidades físicas): con PBR + mapa de
  // entorno, valores en decenas saturan la imagen. Subir de golpe.
  const keyLight = new PointLight(0xbfefff, 26, 44, 2);
  keyLight.position.set(0, 10, 0);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 40;
  keyLight.shadow.bias = -0.002;
  scene.add(keyLight);

  const accentLight = new PointLight(0xff6ad5, 14, 26, 2);
  accentLight.position.set(-10, 3.2, -9);
  scene.add(accentLight);

  const fillLight = new PointLight(0x2a7fff, 10, 32, 2);
  fillLight.position.set(11, 5, 9);
  scene.add(fillLight);

  // Luz rasante desde atrás: define los bordes de las columnas y las cajas.
  const rimLight = new DirectionalLight(0x7fd4ff, 0.7);
  rimLight.position.set(-9, 13, -17);
  rimLight.target.position.set(0, 0, 0);
  scene.add(rimLight, rimLight.target);

  let time = 0;

  return {
    group,
    floorMat,
    /** Materiales expuestos para el upgrade de texturas de ComfyUI. */
    materials: { floor: floorMat, wall: dome.material, pillar: pillarMat, panel: panelMat },

    /**
     * @param {number} dt
     * @param {number} streak
     * @param {import('three').Texture} [envMap] se inyecta desde lab.js
     */
    update(dt, streak = 0, envMap = null) {
      time += dt;

      if (envMap && floorMat.envMap !== envMap) {
        floorMat.envMap = envMap;
        floorMat.needsUpdate = true;
      }

      ringMeshes.forEach((ring, i) => {
        ring.rotation.z += dt * (0.05 + i * 0.035) * (i % 2 === 0 ? 1 : -1);
      });

      const pulse = 1 + Math.sin(time * 2.2) * 0.06 + Math.min(streak, 10) * 0.04;
      keyLight.intensity = 26 * pulse;
      accentLight.intensity = 14 * (1 + Math.sin(time * 1.3 + 1.2) * 0.12);
      rimLight.intensity = 0.7 * (1 + Math.sin(time * 0.7) * 0.05);
    },
  };
}
