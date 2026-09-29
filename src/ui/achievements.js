/**
 * Panel de logros: rejilla de medallones con progreso parcial.
 * Al hacer clic se le pasa el id a la escena para que enfoque el pedestal.
 */

import { el, clear } from './dom.js';
import { TIER_COLORS } from '../scene/pedestals.js';

const TIER_LABEL = {
  bronce: 'Bronce',
  plata: 'Plata',
  oro: 'Oro',
  leyenda: 'Leyenda',
};

function tierColorCss(tier) {
  return `#${(TIER_COLORS[tier] ?? 0x8fa3b3).toString(16).padStart(6, '0')}`;
}

export function createAchievementsPanel({ onSelect }) {
  const grid = el('div', { class: 'ach-grid' });
  const summary = el('div', { class: 'ach-summary' });

  const node = el('div', { class: 'panel-section panel-section--grow' }, [
    el('h3', { class: 'panel-title', text: 'Logros' }),
    summary,
    grid,
  ]);

  function update(state) {
    clear(grid);
    const all = state.achievements.all;
    const unlocked = all.filter((a) => a.unlocked);
    const percent = Math.round((unlocked.length / all.length) * 100);

    summary.textContent = `${unlocked.length} de ${all.length} · ${percent}%`;

    // Desbloqueados primero, luego los más cerca de completarse.
    const ordered = [
      ...unlocked.slice().reverse(),
      ...all
        .filter((a) => !a.unlocked)
        .sort((a, b) => b.progress - a.progress),
    ];

    for (const achievement of ordered) {
      const color = tierColorCss(achievement.tier);
      const card = el(
        'button',
        {
          type: 'button',
          class: `ach-card${achievement.unlocked ? ' is-unlocked' : ''}`,
          style: achievement.unlocked ? { '--tier': color } : {},
          title: `${achievement.name} — ${achievement.desc}`,
          onClick: () => onSelect?.(achievement.id),
        },
        [
          el('div', { class: 'ach-icon', text: achievement.icon }),
          el('div', { class: 'ach-info' }, [
            el('div', { class: 'ach-name', text: achievement.name }),
            el('div', { class: 'ach-desc', text: achievement.desc }),
            achievement.unlocked
              ? el('div', { class: 'ach-tier', text: TIER_LABEL[achievement.tier] ?? '' })
              : el('div', { class: 'ach-progress' }, [
                  el('div', { class: 'ach-track' }, [
                    el('div', {
                      class: 'ach-fill',
                      style: { width: `${Math.round(achievement.progress * 100)}%` },
                    }),
                  ]),
                  el('span', { class: 'ach-count', text: `${achievement.current}/${achievement.goal}` }),
                ]),
          ]),
        ],
      );
      grid.append(card);
    }
  }

  return { node, update };
}
