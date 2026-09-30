/**
 * Paneles de estadísticas: heatmap de constancia, desglose por materia,
 * perfil semanal y últimas sesiones.
 */

import { el, clear } from './dom.js';
import { formatDuration } from '../core/model.js';
import { humanDay, fromISODate } from '../core/date.js';
import { DIFFICULTY_LABELS, ENERGY_LABELS } from '../core/model.js';

const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/* ------------------------------------------------------------------ */
/* Heatmap                                                            */
/* ------------------------------------------------------------------ */

export function createHeatmap() {
  const grid = el('div', { class: 'heatmap-grid' });
  const legend = el('div', { class: 'heatmap-legend' }, [
    el('span', { text: 'Menos' }),
    ...[0, 1, 2, 3, 4].map((lvl) => el('i', { class: `hm-cell hm-cell--${lvl}` })),
    el('span', { text: 'Más' }),
  ]);

  const node = el('div', { class: 'panel-section' }, [
    el('h3', { class: 'panel-title', text: 'Constancia' }),
    el('div', { class: 'heatmap' }, [grid, legend]),
  ]);

  function update({ heatmap }) {
    clear(grid);

    // Cabecera de días de la semana.
    for (const day of ['', ...WEEKDAYS.slice(0, 6)]) {
      grid.append(el('span', { class: 'hm-day', text: day }));
    }

    // Agrupamos por semana (columnas) para que el flujo sea vertical.
    const weeks = [];
    for (const cell of heatmap.cells) {
      const last = weeks[weeks.length - 1];
      if (!last || last.length === 7) weeks.push([]);
      weeks[weeks.length - 1].push(cell);
    }

    const columns = el('div', { class: 'hm-weeks' });
    for (const week of weeks) {
      const column = el('div', { class: 'hm-week' });
      // Rellena hasta 7 celdas para que la última semana no se desalinee.
      for (let i = 0; i < 7; i++) {
        const cell = week[i];
        column.append(
          cell
            ? el('i', {
                class: `hm-cell hm-cell--${cell.level}`,
                title: `${humanDay(cell.date)} · ${cell.minutes > 0 ? formatDuration(cell.minutes) : 'sin registro'}`,
              })
            : el('i', { class: 'hm-cell hm-cell--void' }),
        );
      }
      columns.append(column);
    }
    grid.append(columns);
  }

  return { node, update };
}

/* ------------------------------------------------------------------ */
/* Materias                                                           */
/* ------------------------------------------------------------------ */

export function createSubjectPanel() {
  const list = el('div', { class: 'subject-list' });
  const node = el('div', { class: 'panel-section' }, [
    el('h3', { class: 'panel-title', text: 'Materias' }),
    list,
  ]);

  function update({ subjects, totals }) {
    clear(list);
    if (subjects.length === 0) {
      list.append(el('p', { class: 'empty', text: 'Registra una sesión para ver el desglose.' }));
      return;
    }
    const max = Math.max(...subjects.map((s) => s.minutes));
    const total = Math.max(1, totals.totalMinutes);

    for (const subject of subjects.slice(0, 8)) {
      const pct = (subject.minutes / total) * 100;
      list.append(
        el('div', {
          class: 'subject-row',
          title: `${subject.topTopic || ''} · ${subject.sessions} sesiones`,
          // Mismo matiz que su torre en la escena (ver core/stats.js).
          style: { '--tint': `var(--tint-${subject.tint ?? 0})` },
        }, [
          el('div', { class: 'subject-head' }, [
            el('span', { class: 'subject-name', text: subject.subject }),
            el('span', { class: 'subject-time', text: formatDuration(subject.minutes) }),
          ]),
          el('div', { class: 'subject-track' }, [
            el('div', {
              class: 'subject-fill',
              style: { width: `${(subject.minutes / max) * 100}%` },
            }),
          ]),
          el('div', { class: 'subject-sub' }, [
            el('span', { text: `${pct.toFixed(0)}% del total` }),
            subject.topTopic ? el('span', { text: `· ${subject.topTopic}` }) : null,
          ]),
        ]),
      );
    }
  }

  return { node, update };
}

/* ------------------------------------------------------------------ */
/* Perfil semanal                                                     */
/* ------------------------------------------------------------------ */

export function createWeekdayPanel() {
  const bars = el('div', { class: 'weekday-chart' });
  const node = el('div', { class: 'panel-section' }, [
    el('h3', { class: 'panel-title', text: 'Ritmo semanal' }),
    bars,
  ]);

  function update({ weekdays, ratings }) {
    clear(bars);
    const max = Math.max(1, ...weekdays.map((d) => d.minutes));

    weekdays.forEach((day, i) => {
      bars.append(
        el('div', { class: 'weekday-col', title: `${formatDuration(day.minutes)} · ${day.sessions} sesiones` }, [
          el('div', { class: 'weekday-bar-wrap' }, [
            el('div', {
              class: 'weekday-bar',
              style: { height: `${Math.max(3, (day.minutes / max) * 100)}%` },
            }),
          ]),
          el('span', { class: 'weekday-cap', text: WEEKDAYS[i] }),
        ]),
      );
    });

    if (ratings.sample > 0) {
      bars.append(
        el('div', { class: 'weekday-note' }, [
          el('span', { text: `Dificultad media ${DIFFICULTY_LABELS[Math.round(ratings.difficulty)] ?? '—'}` }),
          el('span', { text: ` · Energía ${ENERGY_LABELS[Math.round(ratings.energy)] ?? '—'}` }),
        ]),
      );
    }
  }

  return { node, update };
}

/* ------------------------------------------------------------------ */
/* Resumen de cifras                                                  */
/* ------------------------------------------------------------------ */

export function createSummaryPanel() {
  const grid = el('div', { class: 'summary-grid' });
  const node = el('div', { class: 'panel-section' }, [
    el('h3', { class: 'panel-title', text: 'Resumen' }),
    grid,
  ]);

  function update(state) {
    clear(grid);
    const { totals, streaks } = state;
    const items = [
      { label: 'Sesiones', value: totals.totalSessions },
      { label: 'Horas', value: `${(totals.totalMinutes / 60).toFixed(1)}` },
      { label: 'Media diaria', value: totals.activeDays ? `${Math.round(totals.totalMinutes / totals.activeDays / 60 * 10) / 10} h` : '0 h' },
      { label: 'Días activos', value: totals.activeDays },
      { label: 'Esta semana', value: formatDuration(totals.weekMinutes) },
      { label: 'Racha', value: `${streaks.current} d` },
    ];
    for (const item of items) {
      grid.append(
        el('div', { class: 'summary-cell' }, [
          el('div', { class: 'summary-value', text: String(item.value) }),
          el('div', { class: 'summary-label', text: item.label }),
        ]),
      );
    }
  }

  return { node, update };
}

/* ------------------------------------------------------------------ */
/* Historial                                                          */
/* ------------------------------------------------------------------ */

export function createHistoryPanel({ onDelete, onFocus }) {
  const list = el('div', { class: 'history-list' });
  const empty = el('p', { class: 'empty', text: 'Aún no hay sesiones registradas.' });
  const node = el('div', { class: 'panel-section panel-section--grow' }, [
    el('h3', { class: 'panel-title', text: 'Historial' }),
    empty,
    list,
  ]);

  function update(state) {
    const { sessions } = state;
    clear(list);

    // `empty` es hermano de `list`, no hijo: nunca se mueve aquí.
    empty.style.display = sessions.length === 0 ? '' : 'none';
    if (sessions.length === 0) return;

    // Solo las 40 más recientes para no saturar el panel.
    for (const session of [...sessions].reverse().slice(0, 40)) {
      const date = fromISODate(session.date);
      const item = el('div', { class: 'history-item', onClick: () => onFocus?.(session) }, [
        el('div', { class: 'history-main' }, [
          el('div', { class: 'history-top' }, [
            el('span', { class: 'history-subject', text: session.subject }),
            el('span', { class: 'history-minutes', text: formatDuration(session.minutes) }),
          ]),
          el('div', { class: 'history-topic', text: session.topic }),
          session.notes
            ? el('div', { class: 'history-notes', text: session.notes })
            : null,
          el('div', { class: 'history-meta' }, [
            el('span', { text: humanDay(session.date) }),
            el('span', { text: `· ${date.getDate()}/${date.getMonth() + 1}` }),
            el('span', { text: `· Dificultad ${session.difficulty}` }),
            el('span', { text: `· Energía ${session.energy}` }),
          ]),
        ]),
        el('button', {
          class: 'history-delete',
          type: 'button',
          title: 'Eliminar sesión',
          text: '✕',
          onClick: (event) => {
            event.stopPropagation();
            onDelete?.(session);
          },
        }),
      ]);
      list.append(item);
    }
  }

  return { node, update };
}
