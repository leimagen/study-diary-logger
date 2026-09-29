/**
 * Formulario de registro de una sesión de estudio.
 *
 * Campos: fecha, materia, tema, duración, dificultad, energía y notas.
 * Incluye presets de duración y validación en línea.
 */

import { el, clear } from './dom.js';
import { SUBJECTS, DIFFICULTY_LABELS, ENERGY_LABELS, LIMITS, formatDuration } from '../core/model.js';
import { today } from '../core/date.js';

const DURATION_PRESETS = [15, 25, 45, 60, 90, 120];

export function createLogForm({ onSubmit }) {
  const errors = el('div', { class: 'form-errors', role: 'alert' });

  /* ---------- Fecha ---------- */
  const dateInput = el('input', {
    type: 'date',
    name: 'date',
    class: 'field-input',
    max: today(),
    required: true,
  });
  dateInput.value = today();

  const dateField = el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: 'Fecha' }),
    dateInput,
    fieldError('date'),
  ]);

  /* ---------- Materia ---------- */
  const subjectSelect = el(
    'select',
    { name: 'subject', class: 'field-input' },
    [
      el('option', { value: '', text: 'Selecciona materia' }),
      ...SUBJECTS.map((s) => el('option', { value: s, text: s })),
    ],
  );

  const subjectField = el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: 'Materia' }),
    subjectSelect,
    fieldError('subject'),
  ]);

  /* ---------- Tema ---------- */
  const topicInput = el('input', {
    type: 'text',
    name: 'topic',
    class: 'field-input',
    placeholder: 'Ej. Derivadas encadenadas',
    maxlength: LIMITS.topic,
    required: true,
  });

  const topicField = el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: 'Tema' }),
    topicInput,
    fieldError('topic'),
  ]);

  /* ---------- Duración ---------- */
  const minutesInput = el('input', {
    type: 'number',
    name: 'minutes',
    class: 'field-input',
    min: LIMITS.minutes.min,
    max: LIMITS.minutes.max,
    step: 5,
    placeholder: '60',
    required: true,
  });

  const durationPreview = el('span', { class: 'field-hint', text: '0 min' });
  minutesInput.addEventListener('input', () => {
    const n = Number(minutesInput.value);
    durationPreview.textContent = n > 0 ? formatDuration(n) : '—';
  });

  const presets = el(
    'div',
    { class: 'presets' },
    DURATION_PRESETS.map((m) =>
      el('button', {
        type: 'button',
        class: 'preset',
        text: `${m}m`,
        onClick: () => {
          minutesInput.value = m;
          minutesInput.dispatchEvent(new Event('input'));
          minutesInput.focus();
        },
      }),
    ),
  );

  const minutesField = el('label', { class: 'field' }, [
    el('span', { class: 'field-label' }, ['Duración ', durationPreview]),
    el('div', { class: 'field-row' }, [minutesInput, presets]),
    fieldError('minutes'),
  ]);

  /* ---------- Dificultad y energía ---------- */
  const difficultyInput = el('input', {
    type: 'range',
    name: 'difficulty',
    class: 'range',
    min: LIMITS.rating.min,
    max: LIMITS.rating.max,
    step: 1,
    value: 3,
  });
  const difficultyValue = el('span', { class: 'rating-value', text: DIFFICULTY_LABELS[3] });
  difficultyInput.addEventListener('input', () => {
    difficultyValue.textContent = DIFFICULTY_LABELS[Number(difficultyInput.value)];
  });

  const difficultyField = el('div', { class: 'field' }, [
    el('span', { class: 'field-label', text: 'Dificultad' }),
    el('div', { class: 'range-row' }, [difficultyInput, difficultyValue]),
    fieldError('difficulty'),
  ]);

  const energyInput = el('input', {
    type: 'range',
    name: 'energy',
    class: 'range range--energy',
    min: LIMITS.rating.min,
    max: LIMITS.rating.max,
    step: 1,
    value: 3,
  });
  const energyValue = el('span', { class: 'rating-value', text: ENERGY_LABELS[3] });
  energyInput.addEventListener('input', () => {
    energyValue.textContent = ENERGY_LABELS[Number(energyInput.value)];
  });

  const energyField = el('div', { class: 'field' }, [
    el('span', { class: 'field-label', text: 'Energía' }),
    el('div', { class: 'range-row' }, [energyInput, energyValue]),
    fieldError('energy'),
  ]);

  /* ---------- Notas ---------- */
  const notesInput = el('textarea', {
    name: 'notes',
    class: 'field-input field-textarea',
    rows: 3,
    maxlength: LIMITS.notes,
    placeholder: 'Qué aprendiste, dudas, próximos pasos…',
  });

  const notesField = el('label', { class: 'field' }, [
    el('span', { class: 'field-label', text: 'Notas (opcional)' }),
    notesInput,
  ]);

  /* ---------- Envío ---------- */
  const submitBtn = el('button', { type: 'submit', class: 'btn btn--primary', text: 'Registrar sesión' });

  const form = el('form', { class: 'log-form', novalidate: true }, [
    el('div', { class: 'form-grid' }, [dateField, subjectField]),
    topicField,
    minutesField,
    el('div', { class: 'form-grid' }, [difficultyField, energyField]),
    notesField,
    errors,
    submitBtn,
  ]);

  function collect() {
    return {
      date: dateInput.value,
      subject: subjectSelect.value,
      topic: topicInput.value,
      minutes: minutesInput.value,
      difficulty: difficultyInput.value,
      energy: energyInput.value,
      notes: notesInput.value,
    };
  }

  function showErrors(map = {}) {
    clear(errors);
    for (const node of form.querySelectorAll('.field-error')) node.textContent = '';
    const entries = Object.entries(map);
    if (entries.length === 0) {
      errors.classList.remove('is-visible');
      return;
    }
    for (const [field, message] of entries) {
      form.querySelector(`.field-error[data-for="${field}"]`)?.replaceChildren(message);
    }
    errors.textContent = entries.length === 1 ? entries[0][1] : 'Revisa los campos marcados.';
    errors.classList.add('is-visible');
  }

  function reset() {
    form.reset();
    dateInput.value = today();
    difficultyInput.value = 3;
    energyInput.value = 3;
    difficultyValue.textContent = DIFFICULTY_LABELS[3];
    energyValue.textContent = ENERGY_LABELS[3];
    durationPreview.textContent = '0 min';
    showErrors({});
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    showErrors({});
    onSubmit(collect(), { form, reset, showErrors });
  });

  return { form, reset, showErrors, collect };
}

function fieldError(name) {
  return el('span', { class: 'field-error', dataset: { for: name } });
}
