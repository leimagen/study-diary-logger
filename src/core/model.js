/**
 * Modelo de datos de una sesión de estudio.
 *
 * Una sesión es el registro de un bloque de estudio:
 *   - date      : día calendario (YYYY-MM-DD) en que ocurrió
 *   - subject   : materia broad ("Cálculo", "Historia de España")
 *   - topic     : tema concreto dentro de la materia ("Derivadas encadenadas")
 *   - minutes   : duración en minutos
 *   - difficulty: dificultad percibida, 1-5
 *   - energy    : energía/anonadato percibido, 1-5
 *   - notes     : notas libres (opcional)
 */

export const SUBJECTS = [
  'Matemáticas',
  'Física',
  'Química',
  'Biología',
  'Informática',
  'Historia',
  'Filosofía',
  'Idiomas',
  'Literatura',
  'Economía',
  'Derecho',
  'Arte',
  'Otros',
];

export const DIFFICULTY_LABELS = ['', 'Muy fácil', 'Fácil', 'Media', 'Difícil', 'Muy difícil'];
export const ENERGY_LABELS = ['', 'Agotado', 'Bajo', 'Normal', 'Alto', 'En racha'];

export const LIMITS = {
  minutes: { min: 1, max: 1440 },
  rating: { min: 1, max: 5 },
  subject: 60,
  topic: 120,
  notes: 2000,
};

let counter = 0;

/** Identificador legible y único (id + timestamp). */
export function createId() {
  counter = (counter + 1) % 1_000_000;
  return `s_${Date.now().toString(36)}_${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** @returns {object} sesión normalizada con todos los campos presentes */
export function createSession(input = {}) {
  const now = new Date();
  return {
    id: input.id ?? createId(),
    date: input.date ?? '',
    subject: clean(input.subject, LIMITS.subject),
    topic: clean(input.topic, LIMITS.topic),
    minutes: clampInt(input.minutes, LIMITS.minutes),
    difficulty: clampInt(input.difficulty, LIMITS.rating),
    energy: clampInt(input.energy, LIMITS.rating),
    notes: clean(input.notes, LIMITS.notes),
    createdAt: input.createdAt ?? now.toISOString(),
  };
}

/**
 * Valida el input del formulario.
 * @returns {{ok: boolean, errors: Record<string,string>, value?: object}}
 */
export function validateSession(input) {
  const errors = {};

  const date = String(input.date ?? '').trim();
  if (!date) errors.date = 'Selecciona una fecha.';
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.date = 'Fecha con formato inválido.';
  else {
    const d = new Date(date + 'T00:00:00');
    if (Number.isNaN(d.getTime())) errors.date = 'Fecha inválida.';
    else if (d > new Date()) errors.date = 'No puedes registrar sesiones futuras.';
  }

  const subject = String(input.subject ?? '').trim();
  if (!subject) errors.subject = 'Indica la materia.';

  const topic = String(input.topic ?? '').trim();
  if (!topic) errors.topic = 'Indica el tema.';

  const minutes = Number(input.minutes);
  if (!Number.isFinite(minutes) || minutes < LIMITS.minutes.min) {
    errors.minutes = `Mínimo ${LIMITS.minutes.min} minuto.`;
  } else if (minutes > LIMITS.minutes.max) {
    errors.minutes = `Máximo ${LIMITS.minutes.max} minutos.`;
  }

  for (const field of ['difficulty', 'energy']) {
    const v = Number(input[field]);
    if (!Number.isFinite(v) || v < LIMITS.rating.min || v > LIMITS.rating.max) {
      errors[field] = 'Valor entre 1 y 5.';
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return { ok: true, errors: {}, value: createSession({ ...input, date, subject, topic, notes: input.notes }) };
}

function clampInt(value, { min, max }) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function clean(value, maxLength) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** "95 min" / "1 h 35 min" */
export function formatDuration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/** "95 min" → "1.6 h" */
export function toHours(minutes) {
  return minutes / 60;
}
