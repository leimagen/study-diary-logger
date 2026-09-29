/**
 * Gamificación: XP, niveles y logros.
 *
 * La XP premia el volumen (minutos) y la calidad percibida (dificultad y
 * energía). Los niveles usan una curva polinómica para que al principio
 * suban rápido y luego exijan constancia real.
 */

import { isoWeekKey, diffDays } from './date.js';

/**
 * XP de una sesión.
 * - 1 XP por minuto (con techo suave a partir de 4 h, para no premiar maratones)
 * - +8 XP por punto de dificultad
 * - +4 XP por punto de energía
 */
export function sessionXP(session) {
  const base = Math.min(session.minutes, 240);
  const capped = session.minutes > 240 ? (session.minutes - 240) * 0.25 : 0;
  return Math.round(base + capped + (session.difficulty - 1) * 8 + (session.energy - 1) * 4);
}

export function totalXP(sessions) {
  return sessions.reduce((acc, s) => acc + sessionXP(s), 0);
}

/** XP total necesario para alcanzar `level` (acumulado desde el nivel 1). */
export function xpForLevel(level) {
  if (level <= 1) return 0;
  return Math.floor(100 * Math.pow(level - 1, 1.55));
}

/** XP necesario para pasar de `level` a `level+1`. */
export function xpPerLevel(level) {
  return xpForLevel(level + 1) - xpForLevel(level);
}

export function levelFromXP(xp) {
  let level = 1;
  while (xpForLevel(level + 1) <= xp && level < 200) level += 1;
  return level;
}

/** @returns {{level, xp, xpIntoLevel, xpForNextLevel, progress, title}} */
export function levelProgress(xp) {
  const level = levelFromXP(xp);
  const base = xpForLevel(level);
  const span = xpPerLevel(level);
  const into = xp - base;
  return {
    level,
    xp,
    xpIntoLevel: into,
    xpForNextLevel: span,
    progress: span > 0 ? Math.min(1, into / span) : 1,
    title: rankTitle(level),
  };
}

/** Rango temático de "laboratorio". */
export function rankTitle(level) {
  const ranks = [
    [1, 'Aprendiz'],
    [3, 'Aspirante'],
    [5, 'Investigador Jr.'],
    [8, 'Analista'],
    [12, 'Científico'],
    [16, 'Investigador Sr.'],
    [22, 'Docente'],
    [30, 'Titular de Cátedra'],
    [40, 'Jefe de Laboratorio'],
    [55, 'Director de Investigación'],
  ];
  let title = ranks[0][1];
  for (const [min, name] of ranks) if (level >= min) title = name;
  return title;
}

/* ------------------------------------------------------------------ */
/* Logros                                                              */
/* ------------------------------------------------------------------ */

/**
 * Cada logro expone `progress(stats) -> {current, goal, unlocked}` para que la
 * UI pueda pintar barras parciales, no solo el estado final.
 */
export const ACHIEVEMENTS = [
  {
    id: 'first-session',
    name: 'Primer experimento',
    desc: 'Registra tu primera sesión de estudio.',
    icon: '⚗️',
    tier: 'bronce',
    progress: (s) => ratio(s.totals.totalSessions, 1),
  },
  {
    id: 'streak-3',
    name: 'Encendido',
    desc: '3 días seguidos estudiando.',
    icon: '🔥',
    tier: 'bronce',
    progress: (s) => ratio(s.streaks.longest, 3),
  },
  {
    id: 'streak-7',
    name: 'Racha estable',
    desc: '7 días seguidos estudiando.',
    icon: '⚡',
    tier: 'plata',
    progress: (s) => ratio(s.streaks.longest, 7),
  },
  {
    id: 'streak-14',
    name: 'Constancia',
    desc: '14 días seguidos estudiando.',
    icon: '🧲',
    tier: 'plata',
    progress: (s) => ratio(s.streaks.longest, 14),
  },
  {
    id: 'streak-30',
    name: 'Mes limpio',
    desc: '30 días seguidos estudiando.',
    icon: '💠',
    tier: 'oro',
    progress: (s) => ratio(s.streaks.longest, 30),
  },
  {
    id: 'streak-100',
    name: 'Centenario',
    desc: '100 días seguidos estudiando.',
    icon: '👑',
    tier: 'leyenda',
    progress: (s) => ratio(s.streaks.longest, 100),
  },
  {
    id: 'sessions-10',
    name: 'Muestra inicial',
    desc: 'Acumula 10 sesiones registradas.',
    icon: '📊',
    tier: 'bronce',
    progress: (s) => ratio(s.totals.totalSessions, 10),
  },
  {
    id: 'sessions-50',
    name: 'Acervo',
    desc: 'Acumula 50 sesiones registradas.',
    icon: '🗄️',
    tier: 'plata',
    progress: (s) => ratio(s.totals.totalSessions, 50),
  },
  {
    id: 'sessions-100',
    name: 'Científico prolifico',
    desc: 'Acumula 100 sesiones registradas.',
    icon: '🧪',
    tier: 'oro',
    progress: (s) => ratio(s.totals.totalSessions, 100),
  },
  {
    id: 'hours-10',
    name: 'Diez horas',
    desc: 'Acumula 10 horas de estudio.',
    icon: '⏱️',
    tier: 'bronce',
    progress: (s) => ratio(s.totals.totalMinutes, 600),
  },
  {
    id: 'hours-50',
    name: 'Cincuenta horas',
    desc: 'Acumula 50 horas de estudio.',
    icon: '🌌',
    tier: 'plata',
    progress: (s) => ratio(s.totals.totalMinutes, 3000),
  },
  {
    id: 'hours-100',
    name: 'Cien horas',
    desc: 'Acumula 100 horas de estudio.',
    icon: '🌟',
    tier: 'leyenda',
    progress: (s) => ratio(s.totals.totalMinutes, 6000),
  },
  {
    id: 'marathon',
    name: 'Maratón',
    desc: 'Registra una sesión de 2 h o más.',
    icon: '🏃',
    tier: 'plata',
    progress: (s) => {
      const best = s.sessions.reduce((m, x) => Math.max(m, x.minutes), 0);
      return ratio(best, 120);
    },
  },
  {
    id: 'multi-subject',
    name: 'Polivalente',
    desc: 'Estudia 3 materias diferentes.',
    icon: '🧭',
    tier: 'plata',
    progress: (s) => ratio(s.subjects.length, 3),
  },
  {
    id: 'polymath',
    name: 'Polímata',
    desc: 'Estudia 5 materias diferentes.',
    icon: '🎓',
    tier: 'oro',
    progress: (s) => ratio(s.subjects.length, 5),
  },
  {
    id: 'notes-writer',
    name: 'Buen archivista',
    desc: 'Escribe notas en 10 sesiones.',
    icon: '📝',
    tier: 'plata',
    progress: (s) => ratio(s.sessions.filter((x) => x.notes.trim().length > 0).length, 10),
  },
  {
    id: 'deep-focus',
    name: 'Trabajo duro',
    desc: '5 sesiones seguidas con dificultad 4 o 5.',
    icon: '🔥',
    tier: 'oro',
    progress: (s) => {
      const dates = new Set(
        s.sessions.filter((x) => x.difficulty >= 4).map((x) => x.date),
      );
      return ratio(dates.size, 5);
    },
  },
  {
    id: 'comeback',
    name: 'Regreso al laboratorio',
    desc: 'Retoma el estudio tras 7+ días de pausa.',
    icon: '🚪',
    tier: 'plata',
    progress: (s) => {
      const dates = s.sessions.map((x) => x.date);
      for (let i = 1; i < dates.length; i++) {
        if (diffDays(dates[i - 1], dates[i]) >= 7) {
          return { current: 1, goal: 1, unlocked: true };
        }
      }
      return { current: 0, goal: 1, unlocked: false };
    },
  },
  {
    id: 'triple-day',
    name: 'Triple dosis',
    desc: 'Registra 3 sesiones en un mismo día.',
    icon: '☕',
    tier: 'oro',
    progress: (s) => {
      const counts = new Map();
      for (const x of s.sessions) counts.set(x.date, (counts.get(x.date) ?? 0) + 1);
      const best = Math.max(0, ...counts.values());
      return ratio(best, 3);
    },
  },
  {
    id: 'early-bird',
    name: 'Madrugador',
    desc: 'Registra 5 sesiones antes de las 8:00.',
    icon: '🌅',
    tier: 'plata',
    progress: (s) => {
      const n = s.sessions.filter((x) => hourOf(x.createdAt) < 8).length;
      return ratio(n, 5);
    },
  },
  {
    id: 'night-owl',
    name: 'Nocturno',
    desc: 'Registra 5 sesiones después de las 23:00.',
    icon: '🦉',
    tier: 'plata',
    progress: (s) => {
      const n = s.sessions.filter((x) => hourOf(x.createdAt) >= 23).length;
      return ratio(n, 5);
    },
  },
  {
    id: 'week-streak',
    name: 'Semana perfecta',
    desc: 'Registra sesión los 7 días de una misma semana.',
    icon: '🗓️',
    tier: 'oro',
    progress: (s) => {
      const byWeek = new Map();
      for (const x of s.sessions) {
        const k = isoWeekKey(x.date);
        if (!byWeek.has(k)) byWeek.set(k, new Set());
        byWeek.get(k).add(x.date);
      }
      const best = Math.max(0, ...[...byWeek.values()].map((v) => v.size));
      return ratio(best, 7);
    },
  },
];

export const TIER_ORDER = ['bronce', 'plata', 'oro', 'leyenda'];

function ratio(current, goal) {
  const c = Math.min(current, goal);
  return { current: c, goal, unlocked: current >= goal, progress: goal > 0 ? c / goal : 0 };
}

function hourOf(isoString) {
  const d = new Date(isoString);
  return Number.isNaN(d.getTime()) ? 12 : d.getHours();
}

function weekKey(iso) {
  return isoWeekKey(iso);
}

/**
 * Estado de todos los logros.
 * @returns {{unlocked: object[], locked: object[], byId: object, justUnlocked: object[]}}
 */
export function evaluateAchievements(stats, unlockedIds = []) {
  const seen = new Set(unlockedIds);
  const justUnlocked = [];

  const evaluated = ACHIEVEMENTS.map((a) => {
    const p = a.progress(stats);
    if (p.unlocked && !seen.has(a.id)) justUnlocked.push({ ...a, ...p });
    return { ...a, ...p };
  });

  return {
    unlocked: evaluated.filter((a) => a.unlocked),
    locked: evaluated.filter((a) => !a.unlocked),
    all: evaluated,
    byId: Object.fromEntries(evaluated.map((a) => [a.id, a])),
    justUnlocked,
  };
}

/**
 * Logros recién desbloqueados por añadir esta sesión concreta.
 * Se evalúa el estado antes y después para detectar los que cambian de estado.
 */
export function diffAchievements(before, after) {
  const beforeSet = new Set(before.map((a) => a.id));
  return after.filter((a) => a.unlocked && !beforeSet.has(a.id));
}
