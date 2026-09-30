/**
 * HUD superior: rango, barra de XP, racha y controles de escena.
 * Incluye el sistema de avisos (toasts) para logros y subida de nivel.
 */

import { el } from './dom.js';
import { formatDuration } from '../core/model.js';

export function createHUD({ root, lab }) {
  /* ---------- Barra de rango ---------- */
  const levelBadge = el('div', { class: 'hud-level' }, [
    el('span', { class: 'hud-level-num', text: '1' }),
    el('span', { class: 'hud-level-cap', text: 'NIVEL' }),
  ]);

  const rankTitle = el('span', { class: 'hud-rank', text: 'Aprendiz' });
  const xpFill = el('div', { class: 'hud-xp-fill' });
  const xpText = el('span', { class: 'hud-xp-text', text: '0 / 100 XP' });

  const levelBlock = el('div', { class: 'hud-level-block' }, [
    rankTitle,
    el('div', { class: 'hud-xp-track' }, [xpFill]),
    xpText,
  ]);

  /* ---------- Racha ---------- */
  const streakFlame = el('div', { class: 'streak-flame', text: '🔥' });
  const streakNumber = el('div', { class: 'streak-number', text: '0' });
  const streakLabel = el('div', { class: 'streak-label', text: 'días seguidos' });
  const streakSub = el('div', { class: 'streak-sub', text: 'Récord: 0' });

  const streakBlock = el('div', { class: 'streak-block', title: 'Días consecutivos estudiando' }, [
    streakFlame,
    el('div', {}, [streakNumber, streakLabel, streakSub]),
  ]);

  /* ---------- Resumen de hoy ---------- */
  const todayValue = el('div', { class: 'stat-value', text: '0 min' });
  const totalValue = el('div', { class: 'stat-value', text: '0 h' });
  const todayBlock = el('div', { class: 'stat' }, [
    todayValue,
    el('div', { class: 'stat-cap', text: 'Hoy' }),
  ]);
  const totalBlock = el('div', { class: 'stat' }, [
    totalValue,
    el('div', { class: 'stat-cap', text: 'Total' }),
  ]);

  /* ---------- Controles ---------- */
  const dofBtn = el('button', {
    class: 'ctl',
    type: 'button',
    title: 'Profundidad de campo',
    text: 'DOF',
    onClick: () => {
      const next = !lab.postFX.isDofEnabled();
      lab.setDofEnabled(next);
      dofBtn.classList.toggle('is-off', !next);
    },
  });
  const rotateBtn = el('button', {
    class: 'ctl',
    type: 'button',
    title: 'Cámara automática',
    text: 'AUTO',
    onClick: () => {
      lab.setAutoRotate(!lab.autoRotate);
      rotateBtn.classList.toggle('is-off', !lab.autoRotate);
    },
  });
  const slitsBtn = el('button', {
    class: lab.slitsEnabled ? 'ctl' : 'ctl is-off',
    type: 'button',
    title: 'Rendijas de luz del muro',
    text: 'LUZ',
    onClick: () => {
      lab.setSlitsEnabled(!lab.slitsEnabled);
      slitsBtn.classList.toggle('is-off', !lab.slitsEnabled);
    },
  });
  const resetBtn = el('button', {
    class: 'ctl',
    type: 'button',
    title: 'Volver a la vista general',
    text: '⌂',
    onClick: () => lab.resetView(),
  });

  const bar = el('header', { class: 'hud' }, [
    el('div', { class: 'hud-brand' }, [
      el('span', { class: 'hud-logo', text: '⚛' }),
      el('div', { class: 'hud-name', text: 'Laboratorio de Estudio' }),
    ]),
    levelBadge,
    levelBlock,
    streakBlock,
    el('div', { class: 'hud-stats' }, [todayBlock, totalBlock]),
    el('div', { class: 'hud-controls' }, [slitsBtn, dofBtn, rotateBtn, resetBtn]),
  ]);

  /* ---------- Toasts ---------- */
  const toastLayer = el('div', { class: 'toast-layer' });
  const MAX_TOASTS = 4;
  root.append(bar, toastLayer);

  function showToast({ icon, title, message, kind = 'achievement', duration = 4200 }) {
    // Al importar un backup se pueden desbloquear decenas de logros a la vez.
    // Sin tope, la pantalla se llena y tapa la escena.
    while (toastLayer.children.length >= MAX_TOASTS) {
      toastLayer.firstElementChild.remove();
    }

    const node = el('div', { class: `toast toast--${kind}` }, [
      el('div', { class: 'toast-icon', text: icon ?? '✨' }),
      el('div', { class: 'toast-body' }, [
        el('div', { class: 'toast-title', text: title }),
        message ? el('div', { class: 'toast-msg', text: message }) : null,
      ]),
    ]);
    toastLayer.append(node);
    requestAnimationFrame(() => node.classList.add('is-in'));

    setTimeout(() => {
      node.classList.remove('is-in');
      setTimeout(() => node.remove(), 400);
    }, duration);
  }

  /* ---------- Actualización ---------- */
  // `null` hasta el primer update: así el estado inicial no dispara el aviso
  // de subida de nivel cada vez que se abre la app.
  let lastLevel = null;

  function update(state) {
    const { level, stats } = state;
    const { streaks, totals } = stats;

    levelBadge.querySelector('.hud-level-num').textContent = level.level;
    rankTitle.textContent = level.title;
    xpFill.style.width = `${Math.round(level.progress * 100)}%`;
    xpText.textContent = `${level.xpIntoLevel} / ${level.xpForNextLevel} XP · ${level.xp} total`;

    streakNumber.textContent = streaks.current;
    streakSub.textContent = `Récord: ${streaks.longest}`;
    streakFlame.classList.toggle('is-hot', streaks.current >= 7);
    streakBlock.classList.toggle('is-done', streaks.studiedToday);
    streakBlock.title = streaks.studiedToday
      ? '¡Hoy ya has estudiado! La racha está a salvo.'
      : 'Aún no has estudiado hoy. ¡Rompe la racha!';

    todayValue.textContent = totals.todayMinutes > 0 ? formatDuration(totals.todayMinutes) : '—';
    totalValue.textContent = `${(totals.totalMinutes / 60).toFixed(1)} h`;

    // Aviso de subida de nivel (solo si el nivel cambió de verdad).
    if (lastLevel !== null && level.level > lastLevel) {
      lab.celebrateLevel(level.level);
      showToast({
        icon: '🎖️',
        kind: 'level',
        title: `¡Nivel ${level.level}!`,
        message: `Ahora eres ${level.title}.`,
        duration: 5200,
      });
    }
    lastLevel = level.level;
  }

  return { update, showToast, bar, streakBlock };
}
