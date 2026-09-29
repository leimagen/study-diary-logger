/**
 * Utilidades de fecha lavoradas en zona horaria LOCAL.
 *
 * Importante: no usar `new Date('2026-01-01')` para parsear, porque ISO se
 * interpreta como UTC y en husos negativos retrocede un día. Por eso
 * construimos Dates a partir de componentes numéricos locales.
 */

const MS_PER_DAY = 86_400_000;

/** @returns {string} fecha actual en formato `YYYY-MM-DD` (hora local) */
export function today(now = new Date()) {
  return toISODate(now);
}

/** @returns {string} `YYYY-MM-DD` de un Date local */
export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parseo local y seguro de `YYYY-MM-DD`. */
export function fromISODate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function isValidISODate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const d = fromISODate(iso);
  return !Number.isNaN(d.getTime()) && toISODate(d) === iso;
}

/** Suma días a una fecha ISO, preservando la hora local (evita saltos DST). */
export function addDays(iso, amount) {
  const d = fromISODate(iso);
  d.setDate(d.getDate() + amount);
  return toISODate(d);
}

/** Días de calendario entre dos fechas ISO (`b - a`). */
export function diffDays(aIso, bIso) {
  return Math.round((fromISODate(bIso) - fromISODate(aIso)) / MS_PER_DAY);
}

export function isSameOrAfter(aIso, bIso) {
  return diffDays(aIso, bIso) >= 0;
}

/** Etiqueta corta legible: "Hoy", "Ayer", "hace 3 días" o `DD/MM/YYYY`. */
export function humanDay(iso, now = new Date()) {
  const delta = diffDays(iso, today(now));
  if (delta === 0) return 'Hoy';
  if (delta === 1) return 'Ayer';
  if (delta > 1 && delta < 7) return `Hace ${delta} días`;
  if (delta === -1) return 'Mañana';
  const d = fromISODate(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** Rango de las últimas `count` fechas ISO, incluida hoy, en orden ascendente. */
export function lastNDays(count, now = new Date()) {
  const end = today(now);
  const out = [];
  for (let i = count - 1; i >= 0; i--) out.push(addDays(end, -i));
  return out;
}

/** Clave de semana ISO (p. ej. "2026-W05") para agrupar por semana. */
export function isoWeekKey(iso) {
  const d = fromISODate(iso);
  // Jueves de la semana actual define el año ISO.
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayNr = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstDayNr = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNr + 3);
  const week = 1 + Math.round((target - firstThursday) / (7 * MS_PER_DAY));
  return `${target.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** 0 = lunes … 6 = domingo */
export function weekdayIndex(iso) {
  return (fromISODate(iso).getDay() + 6) % 7;
}
