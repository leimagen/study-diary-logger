/**
 * Punto de entrada: monta la escena 3D, el store y la interfaz DOM.
 */

import './style.css';
import { createStore } from './core/store.js';
import { createLab } from './scene/lab.js';
import { createHUD } from './ui/hud.js';
import { createLogForm } from './ui/logForm.js';
import {
  createHeatmap,
  createSubjectPanel,
  createWeekdayPanel,
  createSummaryPanel,
  createHistoryPanel,
} from './ui/panels.js';
import { createAchievementsPanel } from './ui/achievements.js';
import { el, $ } from './ui/dom.js';
import { formatDuration } from './core/model.js';
import { storageAvailable } from './core/storage.js';

/* ------------------------------------------------------------------ */
/* Montaje                                                             */
/* ------------------------------------------------------------------ */

const app = $('#app');

const stage = el('div', { class: 'stage' }, [el('canvas', { id: 'scene' })]);
const panelHost = el('aside', { class: 'panel', id: 'panel' });
const overlay = el('div', { class: 'overlay' });

app.append(stage, overlay, panelHost);

const store = createStore();

const lab = createLab({
  canvas: $('#scene'),
  container: stage,
  onAchievementClick: (id) => {
    lab.focusAchievement(id);
    const achievement = store.getState().achievements.byId[id];
    if (achievement) {
      hud.showToast({
        icon: achievement.icon,
        title: achievement.name,
        message: achievement.desc,
        kind: 'peek',
        duration: 3000,
      });
    }
  },
});

const hud = createHUD({ root: overlay, lab });

/* ------------------------------------------------------------------ */
/* Paneles                                                             */
/* ------------------------------------------------------------------ */

const form = createLogForm({
  onSubmit: (values, helpers) => {
    const result = store.addSession(values);
    if (!result.ok) {
      helpers.showErrors(result.errors);
      return;
    }
    helpers.reset();

    // Celebración: chispas + avisos de XP y logros.
    lab.celebrate({ x: 0, y: 2.6, z: 0 });
    hud.showToast({
      icon: '⏱️',
      kind: 'session',
      title: `${formatDuration(result.session.minutes)} de ${result.session.subject}`,
      message: `+${result.xpGained} XP · ${result.session.topic}`,
      duration: 3200,
    });

    for (const achievement of result.unlocked ?? []) {
      hud.showToast({
        icon: achievement.icon,
        title: `Logro: ${achievement.name}`,
        message: achievement.desc,
        duration: 5200,
      });
    }
  },
});

const heatmap = createHeatmap();
const subjectsPanel = createSubjectPanel();
const weekdayPanel = createWeekdayPanel();
const summaryPanel = createSummaryPanel();
const historyPanel = createHistoryPanel({
  onDelete: (session) => {
    if (!confirm(`¿Eliminar la sesión de ${session.subject} — ${session.topic}?`)) return;
    store.removeSession(session.id);
    lab.celebrate({ x: 0, y: 1.4, z: 0 }, { color: 0xd98a8a, big: false });
  },
  onFocus: (session) => {
    lab.focusAchievement('first-session');
    void session;
  },
});
const achievementsPanel = createAchievementsPanel({
  onSelect: (id) => lab.focusAchievement(id),
});

/* Pestañas */
const TABS = [
  { id: 'log', label: 'Registrar', nodes: () => [form.form] },
  { id: 'stats', label: 'Progreso', nodes: () => [summaryPanel.node, heatmap.node, weekdayPanel.node, subjectsPanel.node] },
  { id: 'ach', label: 'Logros', nodes: () => [achievementsPanel.node] },
  { id: 'history', label: 'Historial', nodes: () => [historyPanel.node] },
];

const tabBar = el('nav', { class: 'tabs' });
const tabBody = el('div', { class: 'tab-body' });
let activeTab = 'log';

function renderTab(id) {
  activeTab = id;
  tabBody.replaceChildren(...TABS.find((t) => t.id === id).nodes());
  for (const button of tabBar.children) {
    button.classList.toggle('is-active', button.dataset.tab === id);
  }
  panelHost.classList.toggle('is-narrow', id === 'ach');
}

for (const tab of TABS) {
  tabBar.append(
    el('button', {
      class: 'tab',
      type: 'button',
      dataset: { tab: tab.id },
      text: tab.label,
      onClick: () => renderTab(tab.id),
    }),
  );
}

panelHost.append(tabBar, tabBody);

/* ------------------------------------------------------------------ */
/* Datos: import / export / reset                                     */
/* ------------------------------------------------------------------ */

const dataActions = el('div', { class: 'data-actions' }, [
  el('button', {
    class: 'btn btn--ghost',
    type: 'button',
    text: 'Exportar',
    title: 'Descarga una copia en JSON',
    onClick: () => {
      const blob = new Blob([store.export()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: `estudio-${new Date().toISOString().slice(0, 10)}.json` });
      a.click();
      URL.revokeObjectURL(url);
    },
  }),
  el('label', { class: 'btn btn--ghost', text: 'Importar' }, [
    (() => {
      const input = el('input', {
        type: 'file',
        accept: 'application/json',
        style: { display: 'none' },
        onChange: async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          try {
            const { count } = store.import(await file.text());
            hud.showToast({ icon: '📥', kind: 'session', title: 'Datos importados', message: `${count} sesiones`, duration: 3600 });
          } catch (error) {
            hud.showToast({ icon: '⚠️', kind: 'level', title: 'No se pudo importar', message: String(error.message ?? error), duration: 5000 });
          }
          event.target.value = '';
        },
      });
      return input;
    })(),
  ]),
  el('button', {
    class: 'btn btn--danger',
    type: 'button',
    text: 'Borrar todo',
    onClick: () => {
      if (!confirm('Se borrarán todas las sesiones. ¿Continuar?')) return;
      store.reset();
      hud.showToast({ icon: '🧹', kind: 'session', title: 'Datos borrados', message: 'Empezamos de cero.', duration: 3200 });
    },
  }),
]);

panelHost.append(dataActions);
renderTab('log');

if (!storageAvailable) {
  hud.showToast({
    icon: '⚠️',
    kind: 'level',
    title: 'Almacenamiento no disponible',
    message: 'Los datos se perderán al cerrar la pestaña.',
    duration: 7000,
  });
}

/* ------------------------------------------------------------------ */
/* Reacción al estado                                                  */
/* ------------------------------------------------------------------ */

store.subscribe((state) => {
  const { stats } = state;

  // La escena 3D refleja el estado: racha, materias y logros.
  lab.sync(state);

  hud.update(state);
  // Los paneles de datos consumen el bloque `stats`; el de logros, el estado completo.
  summaryPanel.update(stats);
  heatmap.update(stats);
  weekdayPanel.update(stats);
  subjectsPanel.update(stats);
  historyPanel.update(stats);
  achievementsPanel.update(state);
});

/* ------------------------------------------------------------------ */
/* Arranque                                                            */
/* ------------------------------------------------------------------ */

// Expuesto para depuración manual desde la consola del navegador.
window.studyLab = { store, lab, renderTab, hud };

lab.start();

// Atajos de teclado: N = nueva sesión, 1-4 = pestañas.
window.addEventListener('keydown', (event) => {
  if (event.target.matches('input, textarea, select')) return;
  if (event.key.toLowerCase() === 'n') {
    renderTab('log');
    form.form.querySelector('input[name="topic"]')?.focus();
  }
  const index = ['1', '2', '3', '4'].indexOf(event.key);
  if (index !== -1) renderTab(TABS[index].id);
});
