/**
 * Persistencia en localStorage.
 *
 * Todo pasa por un único documento versionado para que migrar el formato más
 * adelante sea trivial. Si someday se quiere un backend, basta con
 * implementar la misma interfaz (load/save/clear) contra una API.
 */

import { createSession } from './model.js';

const KEY = 'studyforge.v1';
const SCHEMA_VERSION = 1;

function hasStorage() {
  try {
    const probe = '__studyforge_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false; // modo privado / storage deshabilitado
  }
}

const available = hasStorage();

/** Caché en memoria: permite seguir funcionando aunque localStorage falle. */
let memory = { version: SCHEMA_VERSION, sessions: [], settings: {} };

function normalize(doc) {
  if (!doc || typeof doc !== 'object') return { version: SCHEMA_VERSION, sessions: [], settings: {} };
  return {
    version: doc.version ?? SCHEMA_VERSION,
    sessions: Array.isArray(doc.sessions) ? doc.sessions.map((s) => createSession(s)) : [],
    settings: typeof doc.settings === 'object' && doc.settings !== null ? doc.settings : {},
  };
}

/** @returns {{sessions: object[], settings: object}} */
export function load() {
  if (!available) return { ...memory, sessions: [...memory.sessions] };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { version: SCHEMA_VERSION, sessions: [], settings: {} };
    memory = normalize(JSON.parse(raw));
  } catch (err) {
    console.warn('[storage] no se pudo leer, se empieza vacío', err);
    return { version: SCHEMA_VERSION, sessions: [], settings: {} };
  }
  return { ...memory, sessions: [...memory.sessions] };
}

export function save(sessions, settings = memory.settings) {
  memory = { version: SCHEMA_VERSION, sessions, settings };
  if (!available) return false;
  try {
    localStorage.setItem(KEY, JSON.stringify(memory));
    return true;
  } catch (err) {
    console.warn('[storage] no se pudo guardar', err);
    return false;
  }
}

export function clearAll() {
  memory = { version: SCHEMA_VERSION, sessions: [], settings: {} };
  if (available) localStorage.removeItem(KEY);
}

/** Exporta a JSON para backup. */
export function exportJSON(sessions, settings) {
  return JSON.stringify(
    { version: SCHEMA_VERSION, exportedAt: new Date().toISOString(), sessions, settings },
    null,
    2,
  );
}

/** Importa un backup. Descarta entradas corruptas en vez de fallar entero. */
export function importJSON(text) {
  const parsed = JSON.parse(text);
  const doc = normalize(parsed);
  if (doc.sessions.length === 0 && !Array.isArray(parsed?.sessions)) {
    throw new Error('El archivo no contiene un array de sesiones válido.');
  }
  return doc;
}

export const storageAvailable = available;
