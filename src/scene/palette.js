/**
 * Paleta unica de la escena.
 *
 * Direccion de arte: museo sellado. Materiales casi negros y una sola familia
 * de luz, blanco frio. Todo lo que brilla sale de aqui; si un objeto necesita
 * un color propio, primero hay que preguntarse si no basta con el material
 * (metal, piedra, vidrio) para distinguirlo.
 */

import { Color, MeshBasicMaterial } from 'three';

export const LIGHT = {
  /** Tiras LED, rendijas, anillos: el unico acento de la sala. */
  cold: 0xdcefff,
  /** Nucleo del reactor: un punto mas azul que el resto. */
  core: 0xb8e2ff,
  /** Polvo en suspension: calido, como en un haz de luz real. */
  dust: 0xfff1de,
  /** Foco del techo. */
  spot: 0xf2f6ff,
};

/**
 * Matices de materia: seis blancos frios con un punto de color cada uno. Solo
 * se distinguen al compararlos, que es la idea: la sala sigue teniendo una
 * sola luz. El indice lo calcula core/stats.js (`tint`, por orden de primera
 * aparicion). Deben coincidir con --tint-0..5 de style.css.
 */
export const SUBJECT_TINTS = [
  0xdcefff, // hielo
  0xa8e4f4, // cian palido
  0xb2f0d6, // menta fria
  0xb8c8ff, // pervinca
  0xd6c8ff, // lavanda fria
  0x9fd0ff, // celeste
];

export const SURFACE = {
  /** Piedra negra pulida (tarima, pedestales). */
  stone: 0x0b0c0e,
  /** Ceramica negra con laca (reactor, columnas). */
  ceramic: 0x07080a,
};

/**
 * Material emisivo en HDR. La intensidad multiplica el color por encima de
 * 1.0, que es lo que el bloom recoge (umbral ~0.9) y lo que el reflejo del
 * suelo devuelve como estela brillante.
 */
export function ledMaterial(intensity = 4, color = LIGHT.cold) {
  return new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity) });
}
