/**
 * Corrientes de aire de la boveda.
 *
 * Tres corrientes independientes. Cada una cambia de direccion y de fuerza a
 * intervalos aleatorios (rafagas), con su propia inercia para subir y bajar,
 * y a veces se calma del todo. El desplazamiento acumulado de cada corriente
 * se integra aqui, en CPU, y se pasa como uniform: los shaders de polvo y
 * niebla solo lo aplican, sin estado propio.
 *
 * Cada punto de la sala sigue sobre todo a una corriente (`windWeights`, un
 * campo suave en el plano), asi que en un mismo instante el aire se mueve en
 * direcciones distintas segun la zona: remolinos, no un ventilador.
 */

import { Vector3 } from 'three';

export const WIND_CURRENTS = 3;

/** GLSL compartido. Sin comillas invertidas en los comentarios. */
export const WIND_GLSL = /* glsl */ `
  uniform vec3 uWindOffset[3];

  // Peso de cada corriente en un punto del plano: tres ondas largas cruzadas
  // normalizadas como softmax. Zonas de decenas de metros.
  vec3 windWeights(vec2 xz) {
    vec3 a = vec3(
      sin(xz.x * 0.11 + xz.y * 0.05),
      sin(xz.y * 0.09 - xz.x * 0.06 + 2.0),
      sin((xz.x + xz.y) * 0.07 + 4.0)
    );
    vec3 e = exp(a * 2.2);
    return e / (e.x + e.y + e.z);
  }

  vec3 windOffsetAt(vec2 xz) {
    vec3 w = windWeights(xz);
    return uWindOffset[0] * w.x + uWindOffset[1] * w.y + uWindOffset[2] * w.z;
  }
`;

export function createWind({ maxSpeed = 0.55 } = {}) {
  const currents = Array.from({ length: WIND_CURRENTS }, () => ({
    velocity: new Vector3(),
    target: new Vector3(),
    response: 0.5,
    timer: Math.random() * 4,
    offset: new Vector3(),
  }));

  /** Nueva rafaga (o calma) para una corriente. */
  function retarget(current) {
    const calm = Math.random() < 0.3;
    const speed = calm ? Math.random() * 0.05 : (0.15 + Math.random() * 0.85) * maxSpeed;
    const angle = Math.random() * Math.PI * 2;
    current.target.set(Math.cos(angle) * speed, (Math.random() - 0.5) * speed * 0.25, Math.sin(angle) * speed);
    // Rafagas que entran de golpe y otras que crecen despacio.
    current.response = 0.15 + Math.random() * 1.1;
    current.timer = 3 + Math.random() * 10;
  }

  const uniforms = {
    uWindOffset: { value: currents.map((c) => c.offset) },
  };

  return {
    uniforms,
    /** Velocidad actual de cada corriente (la usa el sonido del viento). */
    velocities: currents.map((c) => c.velocity),
    update(dt) {
      for (const current of currents) {
        current.timer -= dt;
        if (current.timer <= 0) retarget(current);
        current.velocity.lerp(current.target, Math.min(1, dt * current.response));
        current.offset.addScaledVector(current.velocity, dt);
      }
    },
  };
}
