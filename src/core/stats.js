/**
 * Agregaciones derivadas de las sesiones: rachas, totales,heatmap y
 * desgloses. Todo es puro: recibe sesiones, devuelve estadísticas.
 */

import { addDays, diffDays, today, weekdayIndex, isoWeekKey } from './date.js';

export function sortByDate(sessions) {
  return [...sessions].sort((a, b) =>
    a.date === b.date ? String(a.createdAt).localeCompare(String(b.createdAt)) : a.date.localeCompare(b.date),
  );
}

/** Conjunto de fechas con al menos una sesión. */
export function activeDates(sessions) {
  return new Set(sessions.map((s) => s.date));
}

/**
 * Rachas de días consecutivos con al menos una sesión.
 *
 * `current` ignora hoy: si hoy no hay sesión pero sí ayer, la racha sigue viva
 * (todavía puedes estudiar hoy). Solo se rompe tras 2 días completos sin estudiar.
 */
export function computeStreaks(sessions, now = new Date()) {
  const dates = activeDates(sessions);
  if (dates.size === 0) return { current: 0, longest: 0, studiedToday: false, lastActiveDate: null };

  const sorted = [...dates].sort();
  const lastActiveDate = sorted[sorted.length - 1];
  const todayISO = today(now);

  // Racha actual: retrocedemos desde hoy (o ayer si hoy aún no hay sesión).
  let current = 0;
  let cursor = dates.has(todayISO) ? todayISO : addDays(todayISO, -1);
  if (dates.has(cursor)) {
    while (dates.has(cursor)) {
      current += 1;
      cursor = addDays(cursor, -1);
    }
  }

  // Racha máxima: recorrido lineal sobre fechas ordenadas.
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const iso of sorted) {
    run = prev !== null && diffDays(prev, iso) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = iso;
  }

  return { current, longest, studiedToday: dates.has(todayISO), lastActiveDate };
}

/** Mapa fecha -> minutos acumulados. */
export function dailyMinutes(sessions) {
  const map = new Map();
  for (const s of sessions) {
    map.set(s.date, (map.get(s.date) ?? 0) + s.minutes);
  }
  return map;
}

/** Totales globales y por periodo. */
export function computeTotals(sessions, now = new Date()) {
  const minutes = sessions.reduce((acc, s) => acc + s.minutes, 0);
  const t = today(now);

  const within = (days) => {
    const from = addDays(t, -(days - 1));
    return sessions.filter((s) => s.date >= from && s.date <= t);
  };

  const last7 = within(7);
  const last30 = within(30);

  return {
    totalSessions: sessions.length,
    totalMinutes: minutes,
    activeDays: activeDates(sessions).size,
    avgSessionMinutes: sessions.length ? Math.round(minutes / sessions.length) : 0,
    todayMinutes: sessions.filter((s) => s.date === t).reduce((a, s) => a + s.minutes, 0),
    weekMinutes: last7.reduce((a, s) => a + s.minutes, 0),
    monthMinutes: last30.reduce((a, s) => a + s.minutes, 0),
    weekSessions: last7.length,
    monthSessions: last30.length,
  };
}

/** Número de matices de materia (ver scene/palette.js y --tint-N en CSS). */
export const SUBJECT_TINT_COUNT = 6;

/**
 * Desglose por materia: minutos, sesiones y tema más frecuente.
 *
 * `tint` es el matiz de la materia en la escena y en el panel. Se asigna por
 * orden de primera aparición, no por minutos: el ranking cambia al estudiar y
 * el color de una materia no debe saltar de una a otra.
 */
export function bySubject(sessions) {
  const map = new Map();
  for (const s of sessions) {
    if (!map.has(s.subject)) {
      map.set(s.subject, {
        subject: s.subject,
        minutes: 0,
        sessions: 0,
        topics: new Map(),
        firstDate: s.date,
        lastDate: s.date,
      });
    }
    const e = map.get(s.subject);
    e.minutes += s.minutes;
    e.sessions += 1;
    e.firstDate = s.date < e.firstDate ? s.date : e.firstDate;
    e.lastDate = s.date > e.lastDate ? s.date : e.lastDate;
    e.topics.set(s.topic, (e.topics.get(s.topic) ?? 0) + s.minutes);
  }

  const tints = new Map(
    [...map.values()]
      .sort((a, b) => a.firstDate.localeCompare(b.firstDate) || a.subject.localeCompare(b.subject))
      .map((e, i) => [e.subject, i % SUBJECT_TINT_COUNT]),
  );

  return [...map.values()]
    .map((e) => ({
      ...e,
      tint: tints.get(e.subject),
      topTopic: [...e.topics.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '',
    }))
    .sort((a, b) => b.minutes - a.minutes);
}

/** Media de dificultad/energía sobre las últimas `n` sesiones. */
export function averageRatings(sessions, n = 20) {
  const recent = sortByDate(sessions).slice(-n);
  if (recent.length === 0) return { difficulty: 0, energy: 0, sample: 0 };
  const avg = (key) => recent.reduce((a, s) => a + s[key], 0) / recent.length;
  return { difficulty: avg('difficulty'), energy: avg('energy'), sample: recent.length };
}

/** Celdas del heatmap: fecha -> minutos, nivel 0-4 para colorear. */
export function heatmap(sessions, days = 119, now = new Date()) {
  const perDay = dailyMinutes(sessions);
  const end = today(now);
  const cells = [];
  // Retrocedemos hasta que la primera celda caiga en lunes (columna izquierda).
  let start = addDays(end, -(days - 1));
  while (weekdayIndex(start) !== 0) start = addDays(start, -1);

  let max = 0;
  // Se recorre desde `start` hasta `end` (incluido) para que hoy siempre
  // esté presente, aunque la ventana se haya alargado al alinear semanas.
  for (let iso = start; iso <= end; iso = addDays(iso, 1)) {
    const m = perDay.get(iso) ?? 0;
    if (m > max) max = m;
    cells.push({ date: iso, minutes: m, level: 0 });
  }
  for (const c of cells) {
    c.level = c.minutes === 0 || max === 0 ? 0 : Math.min(4, Math.ceil((c.minutes / max) * 4));
  }
  return { cells, max };
}

/** Minutos por día de la semana (lunes…domingo). */
export function weekdayProfile(sessions) {
  const buckets = Array.from({ length: 7 }, () => ({ minutes: 0, sessions: 0 }));
  for (const s of sessions) {
    const b = buckets[weekdayIndex(s.date)];
    b.minutes += s.minutes;
    b.sessions += 1;
  }
  return buckets;
}

/** Minutos por semana ISO, ordenado ascendentemente. */
export function weeklyProfile(sessions, lastWeeks = 12, now = new Date()) {
  const map = new Map();
  for (const s of sessions) {
    const key = isoWeekKey(s.date);
    map.set(key, (map.get(key) ?? 0) + s.minutes);
  }
  const keys = [...map.keys()].sort().slice(-lastWeeks);
  return keys.map((key) => ({ week: key, minutes: map.get(key) }));
}

/**
 * Racha más larga y "racha detopics": topics con sesiones en días consecutivos.
 * Se usa para logros de constancia.
 */
export function topicStreaks(sessions) {
  const best = new Map();
  for (const subject of new Set(sessions.map((s) => s.subject))) {
    const dates = [...new Set(sessions.filter((s) => s.subject === subject).map((s) => s.date))].sort();
    let run = 0;
    let prev = null;
    let max = 0;
    for (const iso of dates) {
      run = prev !== null && diffDays(prev, iso) === 1 ? run + 1 : 1;
      max = Math.max(max, run);
      prev = iso;
    }
    best.set(subject, max);
  }
  return best;
}

/** Un único objeto con todo lo derivado, para la UI y los logros. */
export function computeAll(sessions, now = new Date()) {
  const sorted = sortByDate(sessions);
  const streaks = computeStreaks(sessions, now);
  return {
    sessions: sorted,
    streaks,
    totals: computeTotals(sessions, now),
    subjects: bySubject(sessions),
    ratings: averageRatings(sorted),
    heatmap: heatmap(sorted, 119, now),
    weekdays: weekdayProfile(sessions),
    weekly: weeklyProfile(sessions, 12, now),
    topicStreaks: topicStreaks(sessions),
  };
}
