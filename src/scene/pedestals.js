/**
 * Pedestales de logros: medallones flotantes en un anillo alrededor del reactor.
 *
 * - Bloqueado: metal apagado, sin emisión, ligero cabeceo.
 * - Desbloqueado: emisivo con el color de su rango y órbita lenta.
 *
 * Al desbloquear uno, `celebrate()` lanza la explosión de chispas.
 */

import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RingGeometry,
  TorusGeometry,
} from 'three';
import { createLabel } from './labels.js';

const TIER_COLORS = {
  bronce: 0xc98a4b,
  plata: 0xc9d6e0,
  oro: 0xffc53d,
  leyenda: 0xff5ad0,
};

export function createAchievementPedestals({ achievements, onSelect, radius = 11.5, ringCount = 3 }) {
  const group = new Group();
  /** @type {Map<string, object>} */
  const items = new Map();
  const raycastTargets = [];

  const medalGeo = new CylinderGeometry(0.26, 0.26, 0.08, 20);
  const ringGeo = new TorusGeometry(0.34, 0.016, 6, 32);

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

    const material = new MeshStandardMaterial({
      color: 0x16242e,
      emissive: new Color(0x0d1a24),
      roughness: 0.35,
      metalness: 0.85,
    });
    const medal = new Mesh(medalGeo, material);
    medal.userData.achievementId = achievement.id;
    holder.add(medal);

    const tierColor = TIER_COLORS[achievement.tier] ?? 0x8fa3b3;
    const haloMaterial = new MeshStandardMaterial({
      color: 0x0e1a24,
      emissive: new Color(tierColor),
      emissiveIntensity: 0,
      roughness: 0.3,
      metalness: 0.9,
    });
    const halo = new Mesh(ringGeo, haloMaterial);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.02;
    holder.add(halo);

    // Sin base opaca: el medallón flota. Una masa negra se leía como escombro
    // en el suelo y ensuciaba la escena.
    const footMaterial = new MeshBasicMaterial({
      color: tierColor,
      transparent: true,
      opacity: 0.14,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const foot = new Mesh(new RingGeometry(0.3, 0.44, 24), footMaterial);
    foot.rotation.x = -Math.PI / 2;
    foot.position.y = -0.36;
    holder.add(foot);

    // Sin etiqueta: el nombre del logro ya está en el panel lateral. En 3D el
    // ícono repetido 22 veces solo añade ruido.
    const label = createLabel(achievement.icon, {
      color: '#ffffff',
      fontSize: 48,
      padding: 8,
      background: 'rgba(0,0,0,0)',
      borderColor: null,
    });
    label.position.y = 0.52;
    label.scale.multiplyScalar(0.42);
    holder.add(label);

    group.add(holder);
    raycastTargets.push(medal);

    items.set(achievement.id, {
      achievement,
      holder,
      medal,
      material,
      halo,
      haloMaterial,
      label,
      foot,
      footMaterial,
      baseY: height,
      phase: Math.random() * Math.PI * 2,
      unlocked: false,
      glow: 0,
      targetGlow: 0,
    });
  });

  /** Sincroniza el estado de desbloqueo. Devuelve los recién desbloqueados. */
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

  function tick(dt, time) {
    for (const item of items.values()) {
      item.glow += (item.targetGlow - item.glow) * Math.min(1, dt * 3.5);
      const tierColor = TIER_COLORS[item.achievement.tier] ?? 0x8fa3b3;

      // Flotación y rotación.
      const bob = Math.sin(time * 0.8 + item.phase) * 0.09;
      item.holder.position.y = item.baseY + bob;
      item.holder.rotation.y += dt * (0.15 + item.glow * 0.5);

      // Bloqueado: casi invisible (el suelo queda limpio).
      // Desbloqueado: brilla con el color de su rango.
      item.material.emissive.setHex(item.unlocked ? tierColor : 0x0d1a24);
      item.material.emissiveIntensity = item.unlocked
        ? 0.5 + item.glow * (0.7 + Math.sin(time * 2 + item.phase) * 0.2)
        : 0.06;
      item.material.metalness = 0.85;
      item.material.roughness = 0.35 - item.glow * 0.2;

      item.haloMaterial.emissiveIntensity = item.glow * 1.6;
      item.halo.rotation.z += dt * (0.3 + item.glow * 1.2);
      item.halo.scale.setScalar(1 + item.glow * 0.12 + Math.sin(time * 3 + item.phase) * 0.02);

      item.label.material.opacity = 0.1 + item.glow * 0.9;
      item.footMaterial.opacity = 0.04 + item.glow * 0.55;
      item.foot.scale.setScalar(1 + item.glow * 0.15 + Math.sin(time * 2.2 + item.phase) * 0.02);
    }
  }

  /** Posición mundial de un logro (para lanzar chispas o mover la cámara). */
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
