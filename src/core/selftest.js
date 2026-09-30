/**
 * Verificación de la lógica central (sin DOM ni Three.js).
 * Ejecutar con:  node --test  o  node src/core/selftest.js
 */

import { addDays, diffDays, today, isoWeekKey, humanDay, lastNDays } from './date.js';
import { validateSession, formatDuration, createSession } from './model.js';
import { computeStreaks, computeAll, heatmap, bySubject } from './stats.js';
import { sessionXP, totalXP, levelProgress, xpForLevel, evaluateAchievements } from './gamification.js';
import { createStore } from './store.js';
import { generateDemoSessions, DEMO_STREAK } from './demo.js';
import { reactorHum, windVoice, dropVoice, windPan, airCutoff, reverbSend, morseSequence, VOWELS } from './soundscape.js';

let failures = 0;
let count = 0;

function check(label, actual, expected) {
  count += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.log(`  ✗ ${label}\n      esperado: ${e}\n      actual:   ${a}`);
  } else {
    console.log(`  ✓ ${label}`);
  }
}

function ok(label, condition) {
  check(label, Boolean(condition), true);
}

const NOW = new Date(2026, 0, 15, 14, 30); // jueves 15/01/2026
const T = today(NOW); // '2026-01-15'

console.log('\n── fechas ──');
check('today() usa hora local', T, '2026-01-15');
check('addDays cruza meses', addDays('2026-01-31', 1), '2026-02-01');
check('addDays respeta año bisiesto', addDays('2028-02-28', 1), '2028-02-29');
check('addDays negativo', addDays('2026-01-01', -1), '2025-12-31');
check('diffDays', diffDays('2026-01-01', '2026-01-15'), 14);
check('diffDays negativo', diffDays('2026-01-15', '2026-01-01'), -14);
check('sin salto por DST (mar)', diffDays('2026-03-01', '2026-04-01'), 31);
check('isoWeekKey lunes', isoWeekKey('2026-01-12'), '2026-W03');
check('isoWeekKey jueves', isoWeekKey('2026-01-15'), '2026-W03');
check('isoWeekKey domingo (misma semana ISO)', isoWeekKey('2026-01-18'), '2026-W03');
check('isoWeekKey lunes siguiente', isoWeekKey('2026-01-19'), '2026-W04');
check('humanDay hoy', humanDay(T, NOW), 'Hoy');
check('humanDay ayer', humanDay(addDays(T, -1), NOW), 'Ayer');
check('humanDay hace 3', humanDay(addDays(T, -3), NOW), 'Hace 3 días');
check('lastNDays longitud', lastNDays(7, NOW).length, 7);
check('lastNDays último = hoy', lastNDays(7, NOW)[6], T);

console.log('\n── modelo ──');
const valid = validateSession({
  date: T,
  subject: 'Matemáticas',
  topic: 'Derivadas encadenadas',
  minutes: 45,
  difficulty: 4,
  energy: 3,
  notes: '  varios   espacios  ',
});
ok('entrada válida aceptada', valid.ok);
check('notas normalizadas', valid.value.notes, 'varios espacios');
ok('id generado', typeof valid.value.id === 'string' && valid.value.id.length > 0);

const noDate = validateSession({ subject: 'X', topic: 'Y', minutes: 30, difficulty: 3, energy: 3, date: '' });
ok('sin fecha -> error', !noDate.ok && Boolean(noDate.errors.date));
const realToday = today(new Date());
const future = validateSession({ date: addDays(realToday, 3), subject: 'X', topic: 'Y', minutes: 30, difficulty: 3, energy: 3 });
ok('fecha futura -> error', !future.ok && Boolean(future.errors.date));
const past = validateSession({ date: addDays(realToday, -3), subject: 'X', topic: 'Y', minutes: 30, difficulty: 3, energy: 3 });
ok('fecha pasada -> válida', past.ok);
const todaySession = validateSession({ date: realToday, subject: 'X', topic: 'Y', minutes: 30, difficulty: 3, energy: 3 });
ok('fecha de hoy -> válida', todaySession.ok);
const zeroMin = validateSession({ date: T, subject: 'X', topic: 'Y', minutes: 0, difficulty: 3, energy: 3 });
ok('0 minutos -> error', !zeroMin.ok && Boolean(zeroMin.errors.minutes));
const badRating = validateSession({ date: T, subject: 'X', topic: 'Y', minutes: 30, difficulty: 9, energy: 3 });
ok('dificultad 9 -> error', !badRating.ok && Boolean(badRating.errors.difficulty));
const noTopic = validateSession({ date: T, subject: 'X', topic: '  ', minutes: 30, difficulty: 3, energy: 3 });
ok('tema vacío -> error', !noTopic.ok && Boolean(noTopic.errors.topic));

check('formatDuration 45', formatDuration(45), '45 min');
check('formatDuration 60', formatDuration(60), '1 h');
check('formatDuration 95', formatDuration(95), '1 h 35 min');

console.log('\n── rachas ──');
const daysAgo = (n) => ({ date: addDays(T, -n), subject: 'Física', topic: 'Termodinámica', minutes: 30, difficulty: 3, energy: 3, notes: '', createdAt: addDays(T, -n) + 'T12:00:00.000Z' });

check('sin sesiones -> racha 0', computeStreaks([], NOW).current, 0);
check('racha de 3', computeStreaks([daysAgo(0), daysAgo(1), daysAgo(2)], NOW).current, 3);
check('racha viva sin estudiar hoy', computeStreaks([daysAgo(1), daysAgo(2), daysAgo(3)], NOW).current, 3);
check('racha rota por hueco', computeStreaks([daysAgo(3), daysAgo(4), daysAgo(5)], NOW).current, 0);
check('racha máxima sobrevive hueco', computeStreaks([daysAgo(3), daysAgo(4), daysAgo(5)], NOW).longest, 3);
check('studiedToday', computeStreaks([daysAgo(0)], NOW).studiedToday, true);
check('no studiedToday', computeStreaks([daysAgo(1)], NOW).studiedToday, false);

console.log('\n── agregaciones ──');
const many = [daysAgo(0), daysAgo(0), daysAgo(1), daysAgo(4)];
const all = computeAll(many, NOW);
check('total sesiones', all.totals.totalSessions, 4);
check('total minutos', all.totals.totalMinutes, 120);
check('días activos', all.totals.activeDays, 3);
check('media por sesión', all.totals.avgSessionMinutes, 30);
check('minutos de hoy', all.totals.todayMinutes, 60);
const subs = bySubject([...many, { ...daysAgo(0), subject: 'Historia', topic: 'Guerra Fría' }]);
check('nº materias', subs.length, 2);
check('materia principal', subs[0].subject, 'Física');
{
  // El matiz sigue la primera aparición, no el ranking por minutos.
  const early = { ...daysAgo(5), subject: 'Latín', topic: 'x', minutes: 10 };
  const late = { ...daysAgo(1), subject: 'Química', topic: 'y', minutes: 300 };
  const tinted = bySubject([late, early]);
  check('matiz: la materia más antigua recibe el 0', tinted.find((s) => s.subject === 'Latín').tint, 0);
  check('matiz: no depende de los minutos', tinted.find((s) => s.subject === 'Química').tint, 1);
}

const hm = heatmap([daysAgo(0), daysAgo(1)], 119, NOW);
ok('heatmap tiene celdas', hm.cells.length > 100);
ok('heatmap nivel máximo = 4', hm.cells.some((c) => c.level === 4));
ok('heatmap alineado en lunes', new Date(hm.cells[0].date + 'T00:00:00').getDay() === 1);
ok('heatmap nivel 0 para hoy sin sesión', (() => {
  const h2 = heatmap([daysAgo(2)], 119, NOW);
  return h2.cells.find((c) => c.date === T).level === 0;
})());

console.log('\n── gamificación ──');
check('XP mínimo (1 min, d1, e1)', sessionXP({ minutes: 1, difficulty: 1, energy: 1 }), 1);
check('XP con dificultad y energía', sessionXP({ minutes: 60, difficulty: 3, energy: 4 }), 60 + 16 + 12);
check('XP con techo a las 4h', sessionXP({ minutes: 300, difficulty: 1, energy: 1 }), 255);
check('nivel 1 con 0 XP', levelProgress(0).level, 1);
check('nivel 2 con 150 XP', levelProgress(150).level, 2);
ok('curva creciente', xpForLevel(5) > xpForLevel(4) && xpForLevel(4) > xpForLevel(3));
ok('progreso en [0,1]', (() => { const p = levelProgress(137); return p.progress >= 0 && p.progress <= 1; })());

const s1 = createSession({ date: T, subject: 'Matemáticas', topic: 'Límites', minutes: 60, difficulty: 4, energy: 4 });
const a1 = evaluateAchievements(computeAll([s1], NOW));
ok('primer experimento desbloqueado', a1.byId['first-session'].unlocked);
ok('estrella 3 días bloqueado', !a1.byId['streak-3'].unlocked);
ok('10 horas bloqueado', !a1.byId['hours-10'].unlocked);

const hundred = Array.from({ length: 30 }, (_, i) => ({ ...daysAgo(i), minutes: 60 }));
const a30 = evaluateAchievements(computeAll(hundred, NOW));
ok('racha 30 días', a30.byId['streak-30'].unlocked);
ok('30 sesiones', a30.byId['sessions-10'].unlocked);
ok('10 horas (30x60=1800)', a30.byId['hours-10'].unlocked);
ok('racha 7 también', a30.byId['streak-7'].unlocked);
ok('racha 100 NO con 30 días', !a30.byId['streak-100'].unlocked);

const triple = [daysAgo(0), { ...daysAgo(0) }, { ...daysAgo(0), minutes: 90 }];
ok('triple dosis', evaluateAchievements(computeAll(triple, NOW)).byId['triple-day'].unlocked);

const marathon = [{ ...daysAgo(0), minutes: 150 }];
ok('maratón', evaluateAchievements(computeAll(marathon, NOW)).byId['marathon'].unlocked);

const comeback = [daysAgo(0), daysAgo(20)];
ok('regreso al laboratorio', evaluateAchievements(computeAll(comeback, NOW)).byId['comeback'].unlocked);

console.log('\n── store ──');
// localStorage no existe en node: el store debe funcionar en memoria.
// El store usa el reloj real, así que usamos fechas relativas a "hoy" de verdad.
const RT = realToday;
const store = createStore();
let notified = 0;
store.subscribe(() => notified++);

const r1 = store.addSession({ date: RT, subject: 'Física', topic: 'Óptica', minutes: 50, difficulty: 3, energy: 4 });
ok('addSession ok', r1.ok);
ok('notifica suscriptores', notified > 0);
ok('devuelve XP ganada', r1.xpGained > 0);
ok('logro primer experimento en respuesta', r1.unlocked.some((a) => a.id === 'first-session'));

const r2 = store.addSession({ date: addDays(RT, -1), subject: 'Historia', topic: 'Revolución', minutes: 20, difficulty: 2, energy: 2 });
ok('racha 2 días', store.getState().stats.streaks.current, 2);
ok('XP acumulada', store.getState().xp === r1.xpGained + r2.xpGained, true);

const bad = store.addSession({ date: '', subject: '', topic: '', minutes: 0, difficulty: 0, energy: 0 });
ok('rechaza entrada inválida', !bad.ok);
ok('no ensucia el estado', store.getState().sessions.length, 2);

const idToEdit = r1.session.id;
ok('updateSession', store.updateSession(idToEdit, { minutes: 75 }).ok);
check('minutos actualizados', store.getState().sessions.find((s) => s.id === idToEdit).minutes, 75);
ok('updateSession inválido', !store.updateSession('no_existe', { minutes: 10 }).ok);
ok('removeSession', store.removeSession(idToEdit).ok);
check('queda 1 sesión', store.getState().sessions.length, 1);
ok('removeSession inexistente falla', !store.removeSession('no_existe').ok);

const exported = store.export();
check('export es JSON', JSON.parse(exported).sessions.length, 1);
const store2 = createStore();
ok('import ok', store2.import(exported).ok);
check('import conserva sesiones', store2.getState().sessions.length, 1);

console.log('\n── importación sin valoraciones ──');
{
  // Sesiones antiguas o hechas a mano pueden no traer energía ni dificultad.
  const legacy = [{ id: 'x1', date: RT, subject: 'Latín', topic: 'Declinaciones', minutes: 40 }];

  const s1 = createStore();
  s1.replaceAll(legacy);
  ok('replaceAll: XP finita sin energía', Number.isFinite(s1.getState().xp));
  check('replaceAll: energía ausente es neutra', s1.getState().sessions[0].energy, 3);
  check('replaceAll: dificultad ausente es neutra', s1.getState().sessions[0].difficulty, 3);

  const s2 = createStore();
  ok('import sin energía', s2.import(JSON.stringify({ sessions: legacy })).ok);
  ok('import: XP finita sin energía', Number.isFinite(s2.getState().xp));

  check('valoración explícita se respeta', createSession({ energy: 1 }).energy, 1);
  check('valoración fuera de rango se acota', createSession({ energy: 9 }).energy, 5);
}

console.log('\n── datos de ejemplo ──');
{
  const demo = generateDemoSessions(NOW);
  ok('genera varias semanas de sesiones', demo.length > 40);
  check('determinista', generateDemoSessions(NOW).map((s) => s.minutes), demo.map((s) => s.minutes));
  ok('todas las sesiones son válidas', demo.every((s) => validateSession(s).ok));
  ok('ninguna sesión futura', demo.every((s) => s.date <= T));
  ok('ids únicos', new Set(demo.map((s) => s.id)).size === demo.length);
  const stats = computeAll(demo, NOW);
  ok('racha activa al menos de ' + DEMO_STREAK + ' días', stats.streaks.current >= DEMO_STREAK - 1);
  ok('cinco materias', stats.subjects.length === 5);
  ok('una materia claramente principal', stats.subjects[0].minutes > stats.subjects[4].minutes * 3);
  const demoStore = createStore();
  demoStore.replaceAll(demo);
  ok('desbloquea logros', demoStore.getState().achievements.all.some((a) => a.unlocked));
  ok('XP finita', Number.isFinite(demoStore.getState().xp));
}

console.log('\n── sonido ──');
ok('zumbido sube con la energía', reactorHum(1).gain > reactorHum(0).gain && reactorHum(1).freq > reactorHum(0).freq);
check('zumbido acota la energía', reactorHum(5), reactorHum(1));
check('viento en calma no suena', windVoice(0.02).gain, 0);
ok('ráfaga suena más y más aguda', windVoice(0.5).gain > windVoice(0.2).gain && windVoice(0.5).freq > windVoice(0.2).freq);
{
  const fixed = () => 0.5;
  const small = dropVoice(0.3, 0.06, fixed);
  const big = dropVoice(0.3, 0.3, fixed);
  ok('gota grande más grave', big.startFreq < small.startFreq);
  ok('la burbuja sube de tono', small.endFreq > small.startFreq);
  check('gota sin fuerza no suena', dropVoice(0, 0.1, fixed).gain, 0);
}
check('paneo: viento hacia la derecha', windPan(1, 0, 1, 0), 0.7);
check('paneo: sin viento, centrado', windPan(0, 0, 1, 0), 0);

ok('lejos suena más apagado', airCutoff(30) < airCutoff(5) && airCutoff(5) < airCutoff(0));
ok('distancia negativa no rompe el filtro', airCutoff(-3) === airCutoff(0));
ok('el eco apenas cambia con la distancia', reverbSend(40, 1) / reverbSend(0, 1) < 2);
ok('de lejos, algo más de eco', reverbSend(30, 1) > reverbSend(2, 1));
check('morse de SOS', morseSequence('sos').map(([on, u]) => (on ? (u === 1 ? '.' : '-') : u === 3 ? ' ' : '')).join(''), '... --- ...');
check('morse ignora símbolos raros', morseSequence('ñ'), []);
ok('cinco vocales con tres formantes', Object.values(VOWELS).every((f) => f.length === 3));

console.log(`\n${failures === 0 ? '✅' : '❌'} ${count - failures}/${count} comprobaciones correctas\n`);
process.exit(failures === 0 ? 0 : 1);
