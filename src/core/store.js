/**
 * Store reactivo minimalista.
 *
 * Mantiene las sesiones, recalcula los datos derivados y notifica a los
 * suscriptores (UI 3D y paneles DOM) cuando algo cambia.
 */

import { load, save, clearAll, exportJSON, importJSON, storageAvailable } from './storage.js';
import { validateSession } from './model.js';
import { computeAll } from './stats.js';
import { evaluateAchievements, totalXP, levelProgress, sessionXP } from './gamification.js';

export function createStore() {
  const listeners = new Set();

  const initial = load();
  let sessions = initial.sessions;
  /** @type {string[]} ids de logros ya desbloqueados (para no repetir celebración) */
  let unlockedIds = Array.isArray(initial.settings.unlockedAchievements)
    ? initial.settings.unlockedAchievements
    : [];

  let state = buildState();

  function buildState() {
    const stats = computeAll(sessions);
    const xp = totalXP(sessions);
    const level = levelProgress(xp);
    const achievements = evaluateAchievements(stats, unlockedIds);
    return {
      sessions,
      stats,
      xp,
      level,
      achievements,
      storageAvailable,
    };
  }

  function commit() {
    state = buildState();
    // Persistimos el conjunto de logros ya obtenidos: al recargar no se repiten.
    unlockedIds = state.achievements.unlocked.map((a) => a.id);
    save(sessions, { ...state.settings, unlockedAchievements: unlockedIds });
    for (const fn of listeners) fn(state);
  }

  /* ---------------- API pública ---------------- */

  return {
    getState: () => state,

    subscribe(fn) {
      listeners.add(fn);
      fn(state);
      return () => listeners.delete(fn);
    },

    /** @returns {{ok, session?, errors?, unlocked?}} */
    addSession(input) {
      const before = state.achievements.unlocked.map((a) => a.id);
      const result = validateSession(input);
      if (!result.ok) return { ok: false, errors: result.errors };

      sessions = [...sessions, result.value];
      commit();

      const after = state.achievements.unlocked.map((a) => a.id);
      const newly = after.filter((id) => !before.includes(id));
      return {
        ok: true,
        session: result.value,
        xpGained: sessionXP(result.value),
        unlocked: newly.map((id) => state.achievements.byId[id]),
      };
    },

    updateSession(id, input) {
      const index = sessions.findIndex((s) => s.id === id);
      if (index === -1) return { ok: false, errors: { id: 'Sesión no encontrada.' } };
      const merged = validateSession({ ...sessions[index], ...input });
      if (!merged.ok) return { ok: false, errors: merged.errors };

      const next = [...sessions];
      next[index] = { ...merged.value, id, createdAt: sessions[index].createdAt };
      sessions = next;
      commit();
      return { ok: true, session: next[index] };
    },

    removeSession(id) {
      const before = sessions.length;
      sessions = sessions.filter((s) => s.id !== id);
      if (sessions.length === before) return { ok: false };
      commit();
      return { ok: true };
    },

    /** Reemplaza todas las sesiones (importación). */
    replaceAll(list) {
      sessions = list;
      unlockedIds = []; // se recalculan: el import puede desbloquear todo
      commit();
      return { ok: true, count: sessions.length };
    },

    reset() {
      clearAll();
      sessions = [];
      unlockedIds = [];
      commit();
    },

    export: () => exportJSON(sessions, { unlockedAchievements: unlockedIds }),

    import(text) {
      const doc = importJSON(text);
      sessions = doc.sessions;
      unlockedIds = Array.isArray(doc.settings?.unlockedAchievements) ? doc.settings.unlockedAchievements : [];
      commit();
      return { ok: true, count: sessions.length };
    },
  };
}
