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
  CircleGeometry,
  Color,
  CylinderGeometry,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RectAreaLight,
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
    // Con 1.1 el mapa de entorno (RoomEnvironment es muy claro) inundaba el
    // suelo de blanco y lo dejaba plano. Por debajo de 0.5 se ve el metal.
    envMapIntensity: 0.45,
  });

  // Sin capa emisiva encima. Cuando el suelo era un shader plano esto le
  // daba lectura holografica; ahora que es PBR con textura, el bloom de esta
  // capa la inundaba y hacia parecer que la textura desaparecia.
  const mesh = new Mesh(new CircleGeometry(radius, 96), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;

  return { group: mesh, material };
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

/**
 * Luz deArea sobre el reactor: el foco de museo.
 *
 * Un RectAreaLight da una luz suave y con forma, imposible con un PointLight.
 * Es lo que convierte el reactor en "objeto milenario exhibited en el centro".
 */
function createSpotlightRig() {
  const light = new RectAreaLight(0xdff2ff, 22, 7, 7);
  light.position.set(0, 11.5, 0);
  // Mira hacia abajo: el reactor queda bajo el cono.
  light.lookAt(0, 0, 0);
  return { light };
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
  const { group: props, material: panelMat } = createProps();

  // Fuera createCircuits() y createPipes(): el octogono cian del suelo no
  // estaba alineado con las torres de materia y las barras inclinadas del
  // techo no aportaban nada. decided que sobraban, no estaban escaladas.

  group.add(floorGroup, dome, pillarGroup, ceiling, rings, props);
  scene.add(group);

  // Iluminacion.
  //
  // Solo hay UNA fuente real: el area light del reactor. Todo lo demas que
  //未见 se apaga, incluida la IBL, que ademas de ser una fuente invisible
  // inundaba la sala entera. Los siguientes elementos NO son luces: brillan
  // por emisivo, y el bloom los hace leer como fuentes de luz.
  //   - las torres de materia
  //   - las tiras de los pilares
  const showcase = createSpotlightRig().light;
  scene.add(showcase);

  // Un mínimo de rebote: sin nada, las caras no iluminadas son negro puro y
  // los objetos pierden volumen. Muy bajo a propósito.
  const ambient = new HemisphereLight(0x2b4a5e, 0x04080c, 0.07);
  scene.add(ambient);

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

      // El foco de museo late muy despacio y crece con la racha: es la
      // referencia dramatic a la que se ajusta el resto.
      showcase.intensity = 22 * (1 + Math.sin(time * 0.5) * 0.04) * (1 + Math.min(streak, 10) * 0.03);
    },
  };
}
