/**
 * Datos de ejemplo para la demo.
 *
 * Quien llega a la demo pública empieza sin datos y ve la sala vacía. Esto
 * genera unas siete semanas de estudio creíbles para que la escena tenga vida
 * en un clic: materias con ritmos distintos (una principal, otras de apoyo,
 * una que se abandonó), días sin estudiar al principio y una racha activa al
 * final, que es lo que enciende el reactor.
 *
 * Determinista (semilla fija): todos los visitantes ven la misma demo y los
 * tests pueden fijar el resultado.
 */

import { addDays, today } from './date.js';
import { createSession } from './model.js';

/** Materia, peso relativo, minutos típicos y temas. */
const PLAN = [
  { subject: 'Matemáticas', weight: 5, minutes: 75, topics: ['Derivadas', 'Integrales', 'Series', 'Límites'] },
  { subject: 'Informática', weight: 4, minutes: 90, topics: ['Grafos', 'Recursividad', 'Complejidad'] },
  { subject: 'Física', weight: 3, minutes: 60, topics: ['Óptica', 'Ondas', 'Termodinámica'] },
  { subject: 'Idiomas', weight: 3, minutes: 30, topics: ['Vocabulario', 'Listening', 'Gramática'] },
  { subject: 'Historia', weight: 1, minutes: 45, topics: ['Revolución francesa', 'Guerra fría'] },
];

/** Días hacia atrás que cubre la demo. */
export const DEMO_DAYS = 49;
/** Los últimos días se estudia sin falta: la racha que ve el visitante. */
export const DEMO_STREAK = 18;

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function pick(list, random) {
  return list[Math.floor(random() * list.length)];
}

function pickWeighted(random) {
  const total = PLAN.reduce((acc, p) => acc + p.weight, 0);
  let r = random() * total;
  for (const p of PLAN) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return PLAN[0];
}

/**
 * @param {Date} [now]
 * @returns {object[]} sesiones normalizadas con createSession
 */
export function generateDemoSessions(now = new Date(), seed = 7) {
  const random = seeded(seed);
  const end = today(now);
  const sessions = [];
  let n = 0;

  for (let back = DEMO_DAYS - 1; back >= 0; back--) {
    const date = addDays(end, -back);
    const inStreak = back < DEMO_STREAK;
    // Fuera de la racha, uno de cada cuatro días no se estudia.
    if (!inStreak && random() < 0.25) continue;
    // Hoy solo a veces: la racha sigue viva aunque hoy aún no haya sesión.
    if (back === 0 && random() < 0.5) continue;

    const count = random() < 0.35 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      // Historia se abandona a mitad: su columna queda baja.
      let plan = pickWeighted(random);
      if (plan.subject === 'Historia' && back < 20) plan = PLAN[0];
      const minutes = Math.round((plan.minutes * (0.6 + random() * 0.8)) / 5) * 5;
      sessions.push(
        createSession({
          id: `demo_${n++}`,
          date,
          subject: plan.subject,
          topic: pick(plan.topics, random),
          minutes,
          difficulty: 2 + Math.floor(random() * 4),
          energy: 2 + Math.floor(random() * 4),
          notes: '',
        }),
      );
    }
  }
  return sessions;
}
