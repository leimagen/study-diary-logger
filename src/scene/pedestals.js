/**
 * Logros: medallones suspendidos en anillos alrededor del reactor.
 *
 * El rango se lee en el material, no en una luz de color: bronce, plata y
 * oro son metal de verdad (y reflejan las rendijas del mapa de entorno). La
 * luz sigue siendo el mismo blanco frio de toda la sala y solo indica el
 * estado:
 *
 * - Bloqueado: piedra mate casi negra, sin luz. Casi desaparece.
 * - Desbloqueado: metal pulido del rango, con un aro LED debajo.
 *
 * Al desbloquear uno, `celebrate()` lanza la rafaga de chispas.
 */

import {
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  TorusGeometry,
} from 'three';
import { createLabel } from './labels.js';
import { LIGHT, ledMaterial } from './palette.js';

/**
 * Color por rango. Lo usa tambien la UI (ui/achievements.js) para el borde de
 * cada tarjeta: son tonos de metal, legibles en el panel oscuro.
 */
const TIER_COLORS = {
  bronce: 0xc98a4b,
  plata: 0xc9d6e0,
  oro: 0xe8b94a,
  leyenda: 0xe6e9ee,
};

/** Albedo metalico (lineal aproximado) de cada rango. */
const TIER_METAL = {
  bronce: { color: 0xb87333, roughness: 0.32 },
  plata: { color: 0xd9dde2, roughness: 0.2 },
  oro: { color: 0xf0c060, roughness: 0.22 },
  // Leyenda: platino casi espejo.
  leyenda: { color: 0xf2f4f7, roughness: 0.08 },
};

const LOCKED = { color: new Color(0x0e0f11), roughness: 0.75, metalness: 0 };

export function createAchievementPedestals({ achievements, onSelect, radius = 11.5, ringCount = 3 }) {
  const group = new Group();
  /** @type {Map<string, object>} */
  const items = new Map();
  const raycastTargets = [];

  // Canto con bisel: dos cilindros no bastan para que parezca una moneda; con
  // mas segmentos y un toro fino en el borde el reflejo lo dibuja.
  const medalGeo = new CylinderGeometry(0.28, 0.28, 0.06, 48);
  const rimGeo = new TorusGeometry(0.28, 0.03, 12, 64);
  const haloGeo = new TorusGeometry(0.36, 0.008, 6, 64);

  const perRing = Math.ceil(achievements.length / ringCount);

  achievements.forEach((achievement, i) => {
    const ring = Math.floor(i / perRing);
    const posInRing = i % perRing;
    const countInRing = Math.min(perRing, achievements.length - ring * perRing);
    const angle = (posInRing / countInRing) * Math.PI * 2 + ring * 0.4;
    const r = radius + ring * 1.5;
    const height = 1.5 + ring * 0.5;

    const holder = new Group();
    holder.position.set(Math.cos(angle) * r, height, Math.sin(angle) * r);
    holder.userData.achievementId = achievement.id;

    // El medallon esta de canto, mirando al reactor, como una pieza expuesta.
    const disc = new Group();
    disc.rotation.x = Math.PI / 2;
    holder.add(disc);

    const material = new MeshStandardMaterial({
      color: LOCKED.color.clone(),
      roughness: LOCKED.roughness,
      metalness: LOCKED.metalness,
    });
    const medal = new Mesh(medalGeo, material);
    medal.userData.achievementId = achievement.id;
    medal.castShadow = true;
    disc.add(medal);

    const rim = new Mesh(rimGeo, material);
    rim.rotation.x = Math.PI / 2;
    disc.add(rim);

    const haloMaterial = ledMaterial(0);
    const halo = new Mesh(haloGeo, haloMaterial);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -0.42;
    holder.add(halo);

    const label = createLabel(achievement.icon, {
      fontSize: 48,
      padding: 8,
      background: 'rgba(0,0,0,0)',
      borderColor: null,
      monochrome: true,
    });
    label.position.y = 0.55;
    label.scale.multiplyScalar(0.42);
    holder.add(label);

    group.add(holder);
    raycastTargets.push(medal);

    items.set(achievement.id, {
      achievement,
      holder,
      disc,
      material,
      metal: TIER_METAL[achievement.tier] ?? TIER_METAL.plata,
      haloMaterial,
      label,
      baseY: height,
      phase: Math.random() * Math.PI * 2,
      unlocked: false,
      glow: 0,
      targetGlow: 0,
    });
  });

  /** Sincroniza el estado de desbloqueo. Devuelve los recien desbloqueados. */
  function update(stateList) {
    const unlockedIds = new Set(stateList.filter((a) => a.unlocked).map((a) => a.id));
    const newlyUnlocked = [];

    for (const [id, item] of items) {
      const isUnlocked = unlockedIds.has(id);
      if (isUnlocked && !item.unlocked) newlyUnlocked.push(item.achievement);
      item.unlocked = isUnlocked;
      item.targetGlow = isUnlocked ? 1 : 0;
    }
    return newlyUnlocked;
  }

  const metalColor = new Color();

  function tick(dt, time) {
    for (const item of items.values()) {
      item.glow += (item.targetGlow - item.glow) * Math.min(1, dt * 2.5);
      const g = item.glow;

      // Flotacion lenta; el medallon gira despacio para que el metal recorra
      // los reflejos de las rendijas.
      item.holder.position.y = item.baseY + Math.sin(time * 0.6 + item.phase) * 0.06;
      item.holder.rotation.y += dt * (0.08 + g * 0.22);

      metalColor.set(item.metal.color);
      item.material.color.copy(LOCKED.color).lerp(metalColor, g);
      item.material.metalness = g;
      item.material.roughness = LOCKED.roughness + (item.metal.roughness - LOCKED.roughness) * g;

      item.haloMaterial.color.set(LIGHT.cold).multiplyScalar(g * (2.4 + Math.sin(time * 1.4 + item.phase) * 0.3));
      item.label.material.opacity = 0.12 + g * 0.88;
    }
  }

  /** Posicion mundial de un logro (para lanzar chispas o mover la camara). */
  function worldPositionOf(id) {
    const item = items.get(id);
    if (!item) return null;
    const v = item.holder.position.clone();
    item.holder.parent.localToWorld(v);
    return v;
  }

  return {
    group,
    items,
    update,
    tick,
    worldPositionOf,
    raycastTargets,
    onSelect,
  };
}

export { TIER_COLORS };
