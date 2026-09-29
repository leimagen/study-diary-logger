/**
 * Orquestador de la escena 3D.
 *
 * Responsabilidades: montar la escena, animarla, traducir el estado del store a
 * la geometría, y exponer la API que consume la UI (celebrar, enfocar, etc.).
 */

import {
  ACESFilmicToneMapping,
  Color,
  PCFSoftShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Timer,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import { createPostFX } from './postfx.js';
import { createEnvironment } from './environment.js';
import { disposeTextures, upgradeWithComfy } from './textures.js';
import { createReactor } from './reactor.js';
import { createSparkSystem } from './particles.js';
import { createSubjectTowers } from './towers.js';
import { createAchievementPedestals } from './pedestals.js';
import { ACHIEVEMENTS } from '../core/gamification.js';

const PALETTE = {
  burst: 0x35d6ff,
  achievement: 0xffc53d,
  levelUp: 0xa78bfa,
};

export function createLab({ canvas, container, onAchievementClick } = {}) {
  /* ---------------- Renderer ---------------- */
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  // Sombras reales: el contacto entre objetos es lo que separa 3D de formas
  // flotando sobre un fondo.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFSoftShadowMap;

  /* ---------------- Escena y cámara ---------------- */
  const scene = new Scene();
  scene.background = new Color(0x03070d);

  const camera = new PerspectiveCamera(
    52,
    container.clientWidth / container.clientHeight,
    0.1,
    200,
  );
  camera.position.set(0, 7.5, 19);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.set(0, 2.4, 0);
  controls.minDistance = 6;
  controls.maxDistance = 42;
  controls.maxPolarAngle = Math.PI * 0.52; // no bajar del suelo
  controls.enablePan = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.28;

  /* ---------------- Contenido ---------------- */
  const environment = createEnvironment(scene);

  // Mapa de entorno (IBL). Es lo que mas aporta al realismo: sin el, un
  // MeshStandardMaterial con metalness alto no tiene nada que reflejar y sale
  // negro. RoomEnvironment se convierte en un PMREM y se asigna a la escena.
  const pmrem = new PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  // La IBL es una fuente de luz INVISIBLE que inunda toda la sala. Se deja
  // una fraccion para que los reflejos sigan siendo creibles sin que el
  // ambiente washes out la penumbra que quiero.
  scene.environmentIntensity = 0.12;

  // Si existen texturas generadas con ComfyUI en public/textures, se aplican
  // encima de las procedurales. No bloquea: la escena ya esta visible.
  upgradeWithComfy(environment.materials).then((keys) => {
    if (keys.length > 0) {
      console.info(`[scene] texturas de ComfyUI aplicadas: ${keys.join(', ')}`);
    }
  });

  const reactor = createReactor();
  scene.add(reactor.group);

  const sparks = createSparkSystem({ capacity: 1600 });
  scene.add(sparks.points);
  // Polvo continuo: se mantiene reemitiendo, no se siembra una vez. No se
  // prellena porque las particiones deben entrar con fade-in, no de golpe.
  const dust = sparks.createAmbientDust({ bounds: { x: 40, y: 13, z: 40 }, rate: 70 });

  const towers = createSubjectTowers({ maxSubjects: 10, radius: 8.5 });
  scene.add(towers.group);

  const pedestals = createAchievementPedestals({
    achievements: ACHIEVEMENTS,
    radius: 13.5,
    ringCount: 3,
    onSelect: onAchievementClick,
  });
  scene.add(pedestals.group);

  const postFX = createPostFX(renderer, scene, camera, { focus: 19 });

  /* ---------------- Interacción ---------------- */
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let hovered = null;
  let lastPointerDown = 0;

  renderer.domElement.addEventListener('pointermove', (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  });

  renderer.domElement.addEventListener('pointerdown', () => {
    lastPointerDown = performance.now();
  });

  renderer.domElement.addEventListener('click', () => {
    // Se ignora el click si ha sido un arrastre de cámara.
    if (performance.now() - lastPointerDown > 250) return;
    const hit = pickMedal();
    if (hit && onAchievementClick) onAchievementClick(hit);
  });

  function pickMedal() {
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(pedestals.raycastTargets, false);
    if (hits.length === 0) return null;
    return hits[0].object.userData.achievementId ?? null;
  }

  function updateHover() {
    const id = pickMedal();
    if (id !== hovered) {
      hovered = id;
      renderer.domElement.style.cursor = id ? 'pointer' : 'grab';
    }
  }

  /* ---------------- Bucle ---------------- */
  const timer = new Timer();
  let rafId = null;
  let running = false;
  let time = 0;
  let currentStreak = 0;

  function frame() {
    rafId = requestAnimationFrame(frame);
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    time += dt;

    environment.update(dt, currentStreak, envRT.texture);
    reactor.update(dt);
    towers.tick(dt, time);
    pedestals.tick(dt, time);
    dust.update(dt);
    sparks.update(dt);
    controls.update();

    // El enfoque sigue al reactor: mantiene el DOF con sentido.
    const focusTarget = camera.position.distanceTo(reactor.group.position);
    postFX.setFocus(focusTarget);

    // Bloom generoso: es lo que hace legibles las torres, las tiras de los
    // pilares y el reactor en una sala por lo demas a oscuras.
    postFX.setBloom(0.62 + Math.min(currentStreak, 20) * 0.015, 0.42, 0.55);

    postFX.render();
    updateHover();
  }

  function start() {
    if (running) return;
    running = true;
    timer.update();
    frame();
  }

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;

    camera.aspect = w / h;

    // El panel lateral tapa la parte derecha del canvas. Desplazamos el
    // frustum para que la escena quede centrada en el hueco visible.
    const panel = document.querySelector('.panel');
    const occluded = panel && w > 820 ? panel.getBoundingClientRect().width : 0;
    if (occluded > 0) {
      camera.setViewOffset(w, h, occluded / 2, 0, w, h);
    } else {
      camera.clearViewOffset();
    }

    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    postFX.setSize(w, h);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  /* ---------------- Celebraciones ---------------- */

  /**
   * Ráfaga de chispas en un punto.
   * @param {string|{x,y,z}} target id de logro o posición en el mundo
   */
  function celebrate(target, { big = false, color = PALETTE.burst } = {}) {
    const origin =
      typeof target === 'string' ? pedestals.worldPositionOf(target) : target;
    const point = origin ?? new Vector3(0, reactor.group.position.y, 0);

    sparks.burst({
      origin: point,
      count: big ? 150 : 60,
      color,
      speed: big ? 6 : 3.4,
      size: big ? 1.7 : 1.1,
      life: big ? 2.0 : 1.2,
      upward: 0.7,
    });
    sparks.burst({
      origin: point,
      count: big ? 60 : 25,
      color: 0xffffff,
      speed: big ? 3.5 : 2,
      size: 0.85,
      life: big ? 1.2 : 0.8,
      upward: 0.9,
    });
  }

  /** Explosión en el reactor al subir de nivel. */
  function celebrateLevel(level) {
    const colors = Object.values(PALETTE);
    const color = colors[level % colors.length];
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        sparks.burst({
          origin: new Vector3(0, reactor.group.position.y, 0),
          count: 90,
          color,
          speed: 7,
          size: 1.5,
          life: 1.8,
          upward: 0.8,
        });
      }, i * 180);
    }
  }

  /* ---------------- API pública ---------------- */
  return {
    scene,
    camera,
    controls,
    renderer,
    postFX,

    start,
    stop,
    resize,
    celebrate,
    celebrateLevel,

    /** Sincroniza la escena con el estado del store. */
    sync(state) {
      currentStreak = state.stats.streaks.current;
      reactor.setStreak(currentStreak);
      towers.update(state.stats.subjects);
      const newlyUnlocked = pedestals.update(state.achievements.all);
      for (const achievement of newlyUnlocked) {
        celebrate(achievement.id, { big: true });
      }
      return newlyUnlocked;
    },

    /** Encuadra la cámara en un logro. */
    focusAchievement(id) {
      const pos = pedestals.worldPositionOf(id);
      if (!pos) return;
      controls.autoRotate = false;
      // Distancia suficiente para ver el medallón con contexto, no de cerca
      // hasta taparlo. Se mira desde fuera del anillo hacia el centro.
      const outward = pos.clone().setY(0).normalize();
      const targetPos = pos.clone().addScaledVector(outward, 4).setY(pos.y + 2.2);
      animateCamera(targetPos, pos.clone().setY(pos.y + 0.2), 900);
      setTimeout(() => {
        controls.autoRotate = true;
      }, 9000);
    },

    /** Vuelve a la vista general. */
    resetView() {
      controls.autoRotate = false;
      animateCamera(new Vector3(0, 7.5, 19), new Vector3(0, 2.4, 0), 800);
      setTimeout(() => {
        controls.autoRotate = true;
      }, 8000);
    },

    setAutoRotate(enabled) {
      controls.autoRotate = enabled;
    },

    setDofEnabled(enabled) {
      postFX.setDofEnabled(enabled);
    },

    setQuality(low) {
      renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 2));
      postFX.setDofEnabled(!low);
      resize();
    },

    dispose() {
      stop();
      resizeObserver.disconnect();
      controls.dispose();
      postFX.dispose();
      sparks.dispose();
      reactor.dispose();
      disposeTextures();
      // El render target del PMREM ocupa VRAM: hay que liberarlo o sobrevive
      // al renderer.
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };

  /** Interpola cámara y objetivo con easeInOutCubic. */
  function animateCamera(toPosition, toTarget, duration) {
    const fromPosition = camera.position.clone();
    const fromTarget = controls.target.clone();
    const start = performance.now();

    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camera.position.lerpVectors(fromPosition, toPosition, eased);
      controls.target.lerpVectors(fromTarget, toTarget, eased);
      controls.update();
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
}
