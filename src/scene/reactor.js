/**
 * El reactor: pieza central de la boveda, representa la racha actual.
 *
 * Es un objeto fisico, no un holograma: una esfera de vidrio con un nucleo de
 * luz dentro, suspendida de un cable y rodeada por dos anillos de
 * ceramica negra en cardan con un filo LED interior. Recuerda al anillo
 * luminoso de la referencia.
 *
 * A mas racha, mas energia: el nucleo brilla mas y alumbra mas lejos, los
 * anillos giran algo mas deprisa. Los cambios son lentos y contenidos: una
 * pieza de museo no parpadea.
 */

import {
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PointLight,
  SphereGeometry,
  TorusGeometry,
} from 'three';
import { LIGHT, SURFACE, ledMaterial } from './palette.js';

const ENERGY_SATURATION = 30;

export function createReactor({ position = [0, 3.7, 0], ceiling = 16 } = {}) {
  const group = new Group();
  group.position.set(...position);

  const ceramic = new MeshPhysicalMaterial({
    color: SURFACE.ceramic,
    roughness: 0.28,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
  });

  /* --- Nucleo: luz dentro de vidrio --- */
  const coreColor = new Color(LIGHT.core);
  const coreMaterial = new MeshBasicMaterial({ color: coreColor.clone() });
  const core = new Mesh(new SphereGeometry(0.3, 32, 16), coreMaterial);
  group.add(core);

  // Transmision real, casi sin rugosidad. Esmerilado (roughness 0.2-0.3) el
  // vidrio repartia el nucleo por toda la superficie y se leia como una bola
  // blanca maciza. Claro, refracta el nucleo y muestra las rendijas en el
  // borde, que es lo que lo hace leerse como vidrio.
  const glass = new Mesh(
    new SphereGeometry(0.82, 64, 32),
    new MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.04,
      metalness: 0,
      transmission: 1,
      thickness: 0.7,
      ior: 1.45,
      attenuationColor: new Color(0xcfe6f5),
      attenuationDistance: 2.5,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
    }),
  );
  group.add(glass);

  /* --- Anillos en cardan --- */
  function ring(radius, tube) {
    const holder = new Group();
    const body = new Mesh(new TorusGeometry(radius, tube, 32, 192), ceramic);
    body.castShadow = true;
    holder.add(body);
    // Filo LED en la cara interior del anillo.
    const led = new Mesh(new TorusGeometry(radius - tube * 0.92, 0.011, 8, 192), ledMaterial(4));
    holder.add(led);
    return { holder, led };
  }

  const outer = ring(1.85, 0.1);
  const inner = ring(1.45, 0.075);
  // El exterior gira sobre el eje vertical; el interior, dentro de el, sobre
  // el horizontal. Juntos se leen como un giroscopio.
  outer.holder.add(inner.holder);
  inner.holder.rotation.y = Math.PI / 2;
  group.add(outer.holder);

  /* --- Suspension --- */
  // Cable desde el anillo exterior hasta el techo. Sin el, el conjunto flota
  // y se lee como efecto, no como objeto colgado.
  const cableTop = ceiling - position[1];
  const cableBottom = 1.85 + 0.1;
  const cable = new Mesh(
    new CylinderGeometry(0.014, 0.014, cableTop - cableBottom, 8),
    new MeshPhysicalMaterial({ color: 0x0a0b0c, roughness: 0.4, metalness: 0.8 }),
  );
  cable.position.y = (cableTop + cableBottom) / 2;
  group.add(cable);

  const light = new PointLight(LIGHT.core, 0, 14, 2);
  group.add(light);

  let time = 0;
  let energy = 0;
  let targetEnergy = 0;

  return {
    group,
    core,
    light,
    /** Punto mas bajo del anillo exterior: de ahi caen las gotas a la fuente. */
    lowestPoint: position[1] - cableBottom,

    /** Racha -> energia normalizada (satura a los 30 dias). */
    setStreak(streak) {
      targetEnergy = Math.min(1, streak / ENERGY_SATURATION);
    },

    update(dt) {
      time += dt;
      energy += (targetEnergy - energy) * Math.min(1, dt * 1.5);

      // Respiracion lenta; con energia cero el nucleo sigue encendido, tenue.
      const breathe = 1 + Math.sin(time * (0.9 + energy * 0.6)) * 0.06;
      // Contenido a proposito: si el nucleo satura, el vidrio desaparece y
      // queda una bola blanca plana.
      const glow = (1.2 + energy * 2.8) * breathe;
      coreMaterial.color.copy(coreColor).multiplyScalar(glow);
      core.scale.setScalar(0.45 + energy * 0.25);

      outer.holder.rotation.y += dt * (0.08 + energy * 0.12);
      inner.holder.rotation.x += dt * (0.12 + energy * 0.18);

      const ledLevel = 1.6 + energy * 2;
      outer.led.material.color.set(LIGHT.cold).multiplyScalar(ledLevel);
      inner.led.material.color.set(LIGHT.cold).multiplyScalar(ledLevel);

      light.intensity = (3 + energy * 14) * breathe;
    },

    dispose() {
      group.traverse((object) => {
        if (object.isMesh) {
          object.geometry.dispose();
          object.material.dispose();
        }
      });
    },
  };
}
