/**
 * Torres de materia: una columna por asignatura, como piezas en una sala.
 *
 * Columnas de ceramica negra sobre un plinto de piedra, con un filo LED en
 * la cabeza y otro en el plinto. Codifican:
 *
 * - Altura: horas acumuladas, en escala logaritmica (ver la bitacora: la
 *   lineal aplastaba las materias pequenas hasta dejarlas en un anillo).
 * - Rendija LED vertical: el peso de la materia sobre el total. Repite el
 *   motivo de las rendijas del muro.
 * - Brillo de los LED: regularidad (numero de sesiones).
 *
 * Cada materia tiene un blanco frio con un punto de color propio (ver
 * SUBJECT_TINTS), el mismo que su barra en el panel. Son matices, no neones:
 * cinco colores saturados eran lo que mas alejaba la escena de un espacio
 * fisico.
 */

import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  PointLight,
  TorusGeometry,
} from 'three';
import { createLabel } from './labels.js';
import { LIGHT, SUBJECT_TINTS, SURFACE, ledMaterial } from './palette.js';

const COLUMN_RADIUS = 0.36;
const PLINTH_RADIUS = 0.62;
const PLINTH_HEIGHT = 0.14;

export function createSubjectTowers({ maxSubjects = 10, radius = 8.5 } = {}) {
  const group = new Group();
  /** @type {Map<string, object>} materia -> torre */
  const towers = new Map();

  // Radio superior = inferior: escalar en Y un cono lo deforma (ver bitacora).
  const columnGeo = new CylinderGeometry(COLUMN_RADIUS, COLUMN_RADIUS, 1, 64);
  columnGeo.translate(0, 0.5, 0); // origen en la base para escalar en Y
  const plinthGeo = new CylinderGeometry(PLINTH_RADIUS, PLINTH_RADIUS, PLINTH_HEIGHT, 64);
  plinthGeo.translate(0, PLINTH_HEIGHT / 2, 0);
  const plinthLedGeo = new CylinderGeometry(PLINTH_RADIUS + 0.003, PLINTH_RADIUS + 0.003, 0.014, 96, 1, true);
  const capLedGeo = new TorusGeometry(COLUMN_RADIUS - 0.005, 0.009, 6, 96);
  capLedGeo.rotateX(Math.PI / 2);
  const slitGeo = new BoxGeometry(0.026, 1, 0.02);
  slitGeo.translate(0, 0.5, 0);

  const ceramic = new MeshPhysicalMaterial({
    color: SURFACE.ceramic,
    roughness: 0.3,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
  const stone = new MeshPhysicalMaterial({
    color: SURFACE.stone,
    roughness: 0.35,
    clearcoat: 0.8,
    clearcoatRoughness: 0.1,
  });

  function createTower(subject, index) {
    const holder = new Group();

    const plinth = new Mesh(plinthGeo, stone);
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    holder.add(plinth);

    const ledMat = ledMaterial(3);
    const plinthLed = new Mesh(plinthLedGeo, ledMat);
    plinthLed.position.y = PLINTH_HEIGHT - 0.03;
    holder.add(plinthLed);

    const column = new Mesh(columnGeo, ceramic);
    column.position.y = PLINTH_HEIGHT;
    column.castShadow = true;
    column.receiveShadow = true;
    holder.add(column);

    const capLed = new Mesh(capLedGeo, ledMat);
    holder.add(capLed);

    // Rendijas en las dos caras que mas se ven: hacia fuera (torres cercanas
    // a camara) y hacia el centro (torres del fondo). El +X local del holder
    // apunta hacia fuera del anillo.
    const slits = [1, -1].map((side) => {
      const slit = new Mesh(slitGeo, ledMat);
      slit.position.set(side * (COLUMN_RADIUS + 0.004), PLINTH_HEIGHT, 0);
      slit.rotation.y = Math.PI / 2;
      holder.add(slit);
      return slit;
    });

    // Luz real en la cabeza de la columna: deja un charco de luz en el suelo
    // mojado, que es lo que hace que la torre ilumine y no solo brille.
    const lamp = new PointLight(LIGHT.cold, 0, 6, 2);
    holder.add(lamp);

    const label = createLabel(subject);
    holder.add(label);

    const angle = (index / maxSubjects) * Math.PI * 2;
    holder.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    holder.rotation.y = -angle;

    group.add(holder);
    return {
      holder,
      column,
      capLed,
      slits,
      ledMat,
      lamp,
      label,
      energy: 0,
      tint: LIGHT.cold,
      share: 0,
      currentShare: 0,
      currentHeight: 0,
      targetHeight: 0,
    };
  }

  /**
   * Sincroniza las torres con las estadisticas actuales.
   * @param {Array<{subject: string, minutes: number, sessions: number}>} subjects
   */
  function update(subjects) {
    const top = subjects.slice(0, maxSubjects);
    const totalMinutes = Math.max(1, top.reduce((acc, s) => acc + s.minutes, 0));

    top.forEach((stats, index) => {
      let tower = towers.get(stats.subject);
      if (!tower) {
        tower = createTower(stats.subject, index);
        towers.set(stats.subject, tower);
      }
      // Peso sobre el total, no sobre el maximo (ver bitacora). La raiz
      // separa las materias pequenas sin que la grande llene siempre la barra.
      tower.share = Math.min(1, Math.sqrt(stats.minutes / totalMinutes));

      const hours = stats.minutes / 60;
      tower.targetHeight = 0.7 + Math.log10(1 + hours) * 1.5;
      tower.energy = Math.min(1, stats.sessions / 5);
      tower.tint = SUBJECT_TINTS[stats.tint ?? 0];
      tower.lamp.color.set(tower.tint);

      const text = `${stats.subject} · ${formatHours(stats.minutes)}`;
      if (tower.label.userData.text !== text) replaceLabel(tower, text);
    });

    for (const [subject, tower] of towers) {
      if (!top.some((s) => s.subject === subject)) {
        group.remove(tower.holder);
        tower.ledMat.dispose();
        tower.label.material.map.dispose();
        tower.label.material.dispose();
        towers.delete(subject);
      }
    }
  }

  function replaceLabel(tower, text) {
    const old = tower.label;
    // El filo de la placa lleva el matiz de la materia, muy tenue.
    const c = new Color(tower.tint);
    const border = `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, 0.4)`;
    const label = createLabel(text, { borderColor: border });
    label.position.copy(old.position);
    tower.holder.add(label);
    tower.holder.remove(old);
    old.material.map.dispose();
    old.material.dispose();
    tower.label = label;
  }

  function tick(dt) {
    const k = Math.min(1, dt * 3);
    for (const tower of towers.values()) {
      tower.currentHeight += (tower.targetHeight - tower.currentHeight) * k;
      tower.currentShare += (tower.share - tower.currentShare) * k;
      const h = tower.currentHeight;
      const top = PLINTH_HEIGHT + h;

      tower.column.scale.y = h;
      tower.capLed.position.y = top - 0.02;
      for (const slit of tower.slits) {
        // La rendija arranca un poco por encima del plinto y nunca toca la
        // cabeza: asi se lee como una ranura en la pieza, no como una raya.
        slit.position.y = PLINTH_HEIGHT + 0.12;
        slit.scale.y = Math.max(0.001, (h - 0.3) * tower.currentShare);
      }

      tower.ledMat.color.set(tower.tint).multiplyScalar(1.2 + tower.energy * 1.8);
      tower.lamp.position.y = top + 0.25;
      tower.lamp.intensity = 0.8 + tower.energy * 2.2;
      tower.label.position.set(0, top + 0.55, 0);
    }
  }

  return { group, update, tick, towers };
}

function formatHours(minutes) {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
