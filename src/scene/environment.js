/**
 * La boveda: un museo sellado.
 *
 * Rotonda de paneles hexagonales casi negros, suelo de losas de piedra con
 * charcos y una tarima escalonada en el centro. La luz es escasa y toda del
 * mismo blanco frio:
 *
 * - Rendijas verticales en el muro. Son la contraluz de la escena y alumbran
 *   de verdad: cada una es un `RectAreaLight`, que ademas deja una estela
 *   alargada en las zonas pulidas del suelo y de los paneles.
 * - Un foco con anillo LED en el techo, sobre el reactor.
 * - Filos LED en los escalones de la tarima y en el zocalo del muro.
 *
 * El realismo sale de PBR: `MeshStandardMaterial` con mapas de rugosidad y
 * normales, y un mapa de entorno construido con esta misma sala (ver
 * `createEnvironmentMapScene`). Nada de `RoomEnvironment`: es una sala blanca
 * y en rasante convertia el metal en un manchon.
 */

import {
  BackSide,
  BoxGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RectAreaLight,
  Scene,
  SpotLight,
  TorusGeometry,
} from 'three';
import { hexPanels, stoneFloor } from './textures.js';
import { applyWetFloor } from './wet.js';
import { LIGHT, SURFACE, ledMaterial } from './palette.js';

/** Medidas de la sala. La camara nunca debe salir del radio. */
export const ROOM = {
  radius: 30,
  height: 16,
  /** Rendijas en los cuatro puntos cardinales: la vista inicial mira a una. */
  slitAngles: [-Math.PI / 2, 0, Math.PI / 2, Math.PI],
  slitWidth: 0.42,
  slitHeight: 13,
  /** Escalones de la tarima central: [radio, altura de la cara superior]. */
  dais: [
    [4.8, 0.18],
    [3.6, 0.36],
  ],
};

/**
 * Emisivo de la tira (lo que se ve) frente a la potencia del RectAreaLight (lo
 * que ilumina). La tira no necesita ser mucho mas que blanco: por encima de
 * ~6 el bloom la esparce por toda la imagen como un velo lechoso.
 */
const SLIT_EMISSIVE = 6;
const SLIT_LIGHT = 16;

/* ------------------------------------------------------------------ */
/* Superficies                                                        */
/* ------------------------------------------------------------------ */

function createFloor() {
  const { map, roughnessMap, normalMap } = stoneFloor({ repeat: 6 });
  const material = new MeshStandardMaterial({
    map,
    roughnessMap,
    normalMap,
    roughness: 1,
    metalness: 0,
    // El reflejo nitido lo pone wet.js; el entorno solo aporta el velo.
    envMapIntensity: 0.35,
  });
  applyWetFloor(material);

  const mesh = new Mesh(new CircleGeometry(ROOM.radius, 128), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return { mesh, material };
}

function createWall() {
  const hex = hexPanels();
  const circumference = Math.PI * 2 * ROOM.radius;
  // Repeticiones enteras alrededor: con un numero fraccionario la costura del
  // cilindro partiria una fila de hexagonos.
  const repeatU = Math.round(circumference / 4.4);
  const tileHeight = (circumference / repeatU) * hex.aspect;
  for (const t of [hex.map, hex.roughnessMap, hex.normalMap]) {
    t.repeat.set(repeatU, ROOM.height / tileHeight);
  }

  const material = new MeshStandardMaterial({
    map: hex.map,
    roughnessMap: hex.roughnessMap,
    normalMap: hex.normalMap,
    roughness: 1,
    metalness: 0.35,
    side: BackSide,
  });
  const mesh = new Mesh(
    new CylinderGeometry(ROOM.radius, ROOM.radius, ROOM.height, 160, 1, true),
    material,
  );
  mesh.position.y = ROOM.height / 2;
  mesh.receiveShadow = true;
  return { mesh, material };
}

function createCeiling() {
  const mesh = new Mesh(
    new CircleGeometry(ROOM.radius, 96),
    new MeshStandardMaterial({ color: 0x050607, roughness: 0.92, metalness: 0.2 }),
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = ROOM.height;
  return mesh;
}

/* ------------------------------------------------------------------ */
/* Luz                                                                */
/* ------------------------------------------------------------------ */

/** Posicion de la rendija `i` sobre el muro, un pelo hacia dentro. */
function slitPosition(angle, inset = 0.02) {
  const r = ROOM.radius - inset;
  return [Math.cos(angle) * r, Math.sin(angle) * r];
}

/**
 * Rendijas de luz en el muro.
 *
 * La tira emisiva es lo que se ve; el RectAreaLight del mismo tamano es lo
 * que ilumina. Las dos jambas negras a los lados dan profundidad: sin ellas
 * la rendija parece pegada al muro.
 */
function createSlits() {
  const group = new Group();
  const lights = [];
  const { slitWidth: w, slitHeight: h } = ROOM;
  const y = h / 2 + 0.25;

  const stripGeo = new PlaneGeometry(w, h);
  const stripMat = ledMaterial(SLIT_EMISSIVE);
  const jambGeo = new BoxGeometry(0.16, h + 0.3, 0.5);
  const jambMat = new MeshStandardMaterial({ color: SURFACE.ceramic, roughness: 0.35, metalness: 0.4 });

  for (const angle of ROOM.slitAngles) {
    const holder = new Group();
    const [x, z] = slitPosition(angle);
    holder.position.set(x, y, z);
    holder.lookAt(0, y, 0);

    const strip = new Mesh(stripGeo, stripMat);
    holder.add(strip);

    for (const side of [-1, 1]) {
      const jamb = new Mesh(jambGeo, jambMat);
      jamb.position.set(side * (w / 2 + 0.08), 0, 0.2);
      holder.add(jamb);
    }

    const light = new RectAreaLight(LIGHT.cold, SLIT_LIGHT, w, h);
    light.position.set(0, 0, 0.03);
    // Las luces emiten hacia su -Z; el holder mira al centro con su +Z.
    light.rotation.y = Math.PI;
    holder.add(light);
    lights.push(light);

    group.add(holder);
  }
  return { group, lights };
}

/**
 * Luminaria del techo: carcasa negra con dos anillos LED y el foco.
 * Es la unica luz que proyecta sombras.
 */
function createCeilingLight() {
  const group = new Group();
  const top = ROOM.height;

  const housing = new Mesh(
    new CylinderGeometry(2.1, 2.1, 0.3, 96),
    new MeshStandardMaterial({ color: SURFACE.ceramic, roughness: 0.4, metalness: 0.5 }),
  );
  housing.position.y = top - 0.15;
  group.add(housing);

  for (const [radius, intensity] of [[1.7, 4], [1.25, 2]]) {
    const ring = new Mesh(new TorusGeometry(radius, 0.035, 12, 160), ledMaterial(intensity));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = top - 0.31;
    group.add(ring);
  }

  const spot = new SpotLight(LIGHT.spot, 0, 0, 0.3, 0.7, 2);
  spot.position.set(0, top - 0.35, 0);
  spot.target.position.set(0, 0, 0);
  spot.castShadow = true;
  spot.shadow.mapSize.set(2048, 2048);
  spot.shadow.bias = -0.0002;
  spot.shadow.normalBias = 0.02;
  spot.shadow.camera.near = 4;
  spot.shadow.camera.far = 20;
  group.add(spot, spot.target);

  return { group, spot };
}

/* ------------------------------------------------------------------ */
/* Tarima central                                                     */
/* ------------------------------------------------------------------ */

/** Escalones de piedra negra pulida con un filo LED en cada canto. */
function createDais() {
  const group = new Group();
  const stone = new MeshPhysicalMaterial({
    color: SURFACE.stone,
    roughness: 0.3,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });

  let previous = 0;
  for (const [radius, top] of ROOM.dais) {
    const height = top - previous;
    const step = new Mesh(new CylinderGeometry(radius, radius, height, 160), stone);
    step.position.y = previous + height / 2;
    step.castShadow = true;
    step.receiveShadow = true;
    group.add(step);

    // Banda en la cara vertical, justo bajo el canto: asi la linea de luz
    // dibuja el contorno del escalon y se refleja en el charco de delante.
    const band = new Mesh(
      new CylinderGeometry(radius + 0.004, radius + 0.004, 0.022, 256, 1, true),
      ledMaterial(3),
    );
    band.position.y = top - 0.045;
    group.add(band);

    previous = top;
  }
  return group;
}

/**
 * Banadores de pared: focos en el suelo, pegados al muro, que suben rasantes
 * por los paneles. Es como se ilumina un muro en un museo, y el abanico de luz
 * que dejan es lo unico que hace visible el relieve hexagonal. Sin ellos el
 * muro es negro puro y la sala no tiene limites.
 *
 * Van entre rendija y rendija, sin sombras: son baratos.
 */
function createWallWashers({ count = 8 } = {}) {
  const group = new Group();
  const step = (Math.PI * 2) / count;
  for (let i = 0; i < count; i++) {
    const angle = ROOM.slitAngles[0] + step * (i + 0.5);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    // Separado del muro lo justo para que el haz no llegue rasante del todo:
    // pegado a la pared, la luz entra a casi 90 grados de la normal y no
    // alumbra nada.
    const light = new SpotLight(LIGHT.cold, 160, 18, 0.5, 1, 2);
    light.position.set(c * (ROOM.radius - 1.6), 0.15, s * (ROOM.radius - 1.6));
    light.target.position.set(c * ROOM.radius, 8, s * ROOM.radius);
    group.add(light, light.target);

    // La luminaria: una pastilla negra con la cara superior encendida.
    const fixture = new Mesh(
      new CylinderGeometry(0.16, 0.18, 0.1, 24),
      new MeshStandardMaterial({ color: SURFACE.ceramic, roughness: 0.4, metalness: 0.5 }),
    );
    fixture.position.set(c * (ROOM.radius - 1.6), 0.05, s * (ROOM.radius - 1.6));
    const lens = new Mesh(new CircleGeometry(0.11, 24), ledMaterial(3));
    lens.rotation.x = -Math.PI / 2;
    lens.position.set(fixture.position.x, 0.101, fixture.position.z);
    group.add(fixture, lens);
  }
  return group;
}

/** Zocalo luminoso: marca el limite de la sala y da escala. */
function createBaseStrip() {
  const band = new Mesh(
    new CylinderGeometry(ROOM.radius - 0.03, ROOM.radius - 0.03, 0.03, 256, 1, true),
    new MeshBasicMaterial({ color: new Color(LIGHT.cold).multiplyScalar(1.6), side: DoubleSide }),
  );
  band.position.y = 0.14;
  return band;
}

/* ------------------------------------------------------------------ */
/* Mapa de entorno                                                    */
/* ------------------------------------------------------------------ */

/**
 * Version minima de la sala para generar el mapa de entorno (PMREM): negro,
 * con las rendijas y los anillos del techo en su sitio. Asi el metal y la
 * laca reflejan lo que hay de verdad en la boveda, y no una sala blanca.
 */
export function createEnvironmentMapScene({ slits = true } = {}) {
  const scene = new Scene();
  scene.background = new Color(0x000000);

  const shell = new Mesh(
    new CylinderGeometry(ROOM.radius, ROOM.radius, ROOM.height, 64, 1, true),
    new MeshBasicMaterial({ color: 0x020304, side: BackSide }),
  );
  shell.position.y = ROOM.height / 2;
  scene.add(shell);

  const floor = new Mesh(new CircleGeometry(ROOM.radius, 64), new MeshBasicMaterial({ color: 0x010101 }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const strip = ledMaterial(SLIT_EMISSIVE);
  const geo = new PlaneGeometry(ROOM.slitWidth * 1.6, ROOM.slitHeight);
  for (const angle of slits ? ROOM.slitAngles : []) {
    const [x, z] = slitPosition(angle, 0.1);
    const mesh = new Mesh(geo, strip);
    mesh.position.set(x, ROOM.slitHeight / 2 + 0.25, z);
    mesh.lookAt(0, mesh.position.y, 0);
    scene.add(mesh);
  }

  const ring = new Mesh(new TorusGeometry(1.7, 0.08, 8, 64), ledMaterial(4));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = ROOM.height - 0.3;
  scene.add(ring);

  return scene;
}

/* ------------------------------------------------------------------ */
/* Composicion                                                        */
/* ------------------------------------------------------------------ */

export function createEnvironment(scene) {
  // Niebla casi negra y ligera: apaga el fondo sin velar las rendijas.
  scene.fog = new FogExp2(0x010203, 0.012);

  const group = new Group();
  const floor = createFloor();
  const wall = createWall();
  const slits = createSlits();
  const ceilingLight = createCeilingLight();

  group.add(
    floor.mesh,
    wall.mesh,
    createCeiling(),
    slits.group,
    ceilingLight.group,
    createWallWashers(),
    createDais(),
    createBaseStrip(),
  );
  scene.add(group);

  // Un minimo de rebote para que las caras en sombra no sean negro absoluto.
  scene.add(new HemisphereLight(0x9bb4c8, 0x000000, 0.02));

  let time = 0;

  return {
    group,
    floorMat: floor.material,
    /**
     * Materiales expuestos para el upgrade de texturas de ComfyUI. Vacio a
     * proposito: las texturas actuales de public/textures son chapa cepillada
     * y no encajan con los paneles hexagonales. Para volver a usarlas, generar
     * texturas nuevas y anadir aqui la clave correspondiente.
     */
    materials: {},

    /**
     * Enciende o apaga las rendijas del muro (tira, jambas y luz). El mapa de
     * entorno hay que regenerarlo aparte: lo hace lab.js.
     */
    setSlitsEnabled(on) {
      slits.group.visible = on;
    },

    /**
     * @param {number} dt
     * @param {number} streak racha actual: el foco crece un poco con ella
     */
    update(dt, streak = 0) {
      time += dt;
      const boost = 1 + Math.min(streak, 30) * 0.012;
      ceilingLight.spot.intensity = 420 * boost * (1 + Math.sin(time * 0.4) * 0.02);
    },
  };
}
