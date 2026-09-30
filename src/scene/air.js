/**
 * Luz que recibe el aire de la boveda.
 *
 * Polvo y niebla no brillan por si mismos: se ven donde los cruza la luz.
 * Esta funcion aproxima cuanta llega a un punto desde el cono del foco, las
 * rendijas del muro y el nucleo del reactor. La comparten dust.js y mist.js,
 * con los mismos uniforms (mismos objetos), para que las dos cosas se
 * iluminen igual.
 */

import { Vector2, Vector3 } from 'three';

/** GLSL. Sin comillas invertidas en los comentarios. */
export const AIR_LIGHT_GLSL = /* glsl */ `
  uniform float uSpotApex;
  uniform float uSpotTan;
  uniform vec2 uSlits[4];
  uniform float uSlitHeight;
  uniform float uSlitGain;
  uniform vec3 uCore;
  uniform float uCoreEnergy;

  float airLight(vec3 p) {
    // Cono del foco: mas denso en el eje.
    float depth = max(uSpotApex - p.y, 0.0);
    float coneR = depth * uSpotTan;
    float axial = length(p.xz) / max(coneR, 0.001);
    float spot = (1.0 - smoothstep(0.55, 1.0, axial)) * smoothstep(0.0, 2.0, depth);

    // Rendijas: cae con la distancia a la tira vertical.
    float slit = 0.0;
    float inside = step(0.0, p.y) * (1.0 - smoothstep(uSlitHeight - 1.0, uSlitHeight + 1.0, p.y));
    for (int i = 0; i < 4; i++) {
      slit += exp(-length(p.xz - uSlits[i]) * 0.55) * inside;
    }

    // Halo del reactor.
    vec3 dc = p - uCore;
    float core = uCoreEnergy / (1.0 + dot(dc, dc) * 0.6);

    return spot + slit * 0.9 * uSlitGain + core * 0.25;
  }
`;

/**
 * @param {{spot: {apex: number, angle: number}, slits: Array<[number, number]>, slitHeight: number, core: Vector3}} options
 */
export function createAirUniforms({ spot, slits, slitHeight, core }) {
  return {
    uSpotApex: { value: spot.apex },
    uSpotTan: { value: Math.tan(spot.angle) },
    uSlits: { value: slits.map(([x, z]) => new Vector2(x, z)) },
    uSlitHeight: { value: slitHeight },
    uSlitGain: { value: 1 },
    uCore: { value: new Vector3().copy(core) },
    uCoreEnergy: { value: 0.2 },
  };
}
