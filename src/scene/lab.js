/**
 * Orquestador de la escena 3D.
 *
 * Responsabilidades: montar la escena, animarla, traducir el estado del store a
 * la geometría, y exponer la API que consume la UI (celebrar, enfocar, etc.).
 */

import {
  AgXToneMapping,
  Color,
  PCFShadowMap,
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
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

import { createPostFX } from './postfx.js';
import { ROOM, createEnvironment, createEnvironmentMapScene } from './environment.js';
import { disposeTextures, upgradeWithComfy } from './textures.js';
import { createReactor } from './reactor.js';
import { createSparkSystem } from './particles.js';
import { createDust } from './dust.js';
import { createMistPass } from './mist.js';
import { createWind } from './wind.js';
import { createAirUniforms } from './air.js';
import { createFountain } from './fountain.js';
import { createSoundscape } from './audio.js';
import { createSubjectTowers } from './towers.js';
import { createWetReflection } from './wet.js';
import { createAchievementPedestals } from './pedestals.js';
import { LIGHT } from './palette.js';
import { ACHIEVEMENTS } from '../core/gamification.js';

/**
 * Chispas de celebracion. Misma familia de luz que la sala: el rango del
 * logro ya se ve en el metal del medallon.
 */
const PALETTE = {
  burst: LIGHT.cold,
  achievement: 0xfff0d8,
  levelUp: LIGHT.core,
};

const HOME = { position: new Vector3(0, 5.6, 19), target: new Vector3(0, 3.0, 0) };

/**
 * Rendijas de luz del muro. Apagadas a peticion del usuario para probar la
 * sala sin ellas; `lab.setSlitsEnabled(true)` las vuelve a encender.
 */
const SLITS_ON = false;

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
  // AgX: las altas luces (rendijas, nucleo) se desaturan hacia blanco como
  // en una foto, en vez de quedarse en cian quemado como con ACES.
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  // Sombras reales: el contacto entre objetos es lo que separa 3D de formas
  // flotando sobre un fondo.
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  /* ---------------- Escena y cámara ---------------- */
  const scene = new Scene();
  scene.background = new Color(0x000000);

  const camera = new PerspectiveCamera(
    52,
    container.clientWidth / container.clientHeight,
    0.1,
    200,
  );
  camera.position.copy(HOME.position);
  // Las placas de texto viven en la capa 1 (ver labels.js).
  camera.layers.enable(1);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.target.copy(HOME.target);
  controls.minDistance = 6;
  // Siempre dentro de la rotonda: fuera solo se ve el exterior del muro.
  controls.maxDistance = ROOM.radius - 6;
  controls.maxPolarAngle = Math.PI * 0.49; // no bajar del suelo
  controls.enablePan = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.28;

  /* ---------------- Contenido ---------------- */
  // Sin esto los RectAreaLight de las rendijas no iluminan nada.
  RectAreaLightUniformsLib.init();

  // Transmisor de radio junto al muro, lejos de la vista inicial: la radio
  // debe sonar al fondo.
  const RADIO_POSITION = new Vector3(-19.5, 1.0, -21);
  const environment = createEnvironment(scene, { transmitterPosition: RADIO_POSITION });

  /**
   * Mapa de entorno construido con la propia boveda: negra, con las rendijas
   * y el anillo del techo. Con el, metal y laca reflejan lo que hay en la
   * sala. RoomEnvironment era una sala blanca y convertia el suelo en un
   * manchon en rasante (ver bitacora); este no tiene nada blanco que no este
   * tambien en la escena.
   */
  const pmrem = new PMREMGenerator(renderer);
  let envRT = null;
  function buildEnvironmentMap(slits) {
    const envScene = createEnvironmentMapScene({ slits });
    const next = pmrem.fromScene(envScene, 0.02, 0.1, 100, { position: new Vector3(0, 2.6, 0) });
    envScene.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    envRT?.dispose();
    envRT = next;
    scene.environment = envRT.texture;
  }
  scene.environmentIntensity = 1;

  upgradeWithComfy(environment.materials).then((keys) => {
    if (keys.length > 0) {
      console.info(`[scene] texturas de ComfyUI aplicadas: ${keys.join(', ')}`);
    }
  });

  const reactor = createReactor({ ceiling: ROOM.height });
  scene.add(reactor.group);

  // Reflejo del pavimento mojado. Solo se actualiza para la camara principal.
  const wet = createWetReflection({ radius: ROOM.radius });
  scene.add(wet.mesh);
  wet.attachTo(camera);

  // Sonido de ambiente. No suena hasta setSoundEnabled(true) desde un gesto.
  const daisTop = ROOM.dais[ROOM.dais.length - 1][1];
  const sound = createSoundscape({
    camera,
    reactorPosition: reactor.group.position,
    fountainPosition: new Vector3(0, daisTop + 0.42, 0),
    radioPosition: RADIO_POSITION,
  });

  const fountain = createFountain({
    renderer,
    camera,
    baseY: daisTop,
    dripFrom: reactor.lowestPoint,
    onSplash: (x, y, z, amplitude, radius) => sound.drop(x, y, z, amplitude, radius),
  });
  scene.add(fountain.group);

  const sparks = createSparkSystem({ capacity: 1200 });
  scene.add(sparks.points);

  // Aire: viento y luz compartidos por el polvo y la niebla.
  const wind = createWind();
  const air = createAirUniforms({
    spot: { apex: ROOM.height - 0.35, angle: 0.3 },
    slits: ROOM.slitAngles.map((a) => [Math.cos(a) * (ROOM.radius - 0.5), Math.sin(a) * (ROOM.radius - 0.5)]),
    slitHeight: ROOM.slitHeight,
    core: reactor.group.position,
  });

  const dust = createDust({ radius: ROOM.radius - 3, height: ROOM.height - 2, air, wind: wind.uniforms });
  scene.add(dust.points);


  let slitsOn = SLITS_ON;
  function setSlitsEnabled(on) {
    slitsOn = on;
    environment.setSlitsEnabled(on);
    air.uSlitGain.value = on ? 1 : 0;
    buildEnvironmentMap(on);
  }
  setSlitsEnabled(SLITS_ON);

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

  // Niebla volumetrica: un pase tras el render de la escena, antes del DOF,
  // para que se desenfoque con lo que hay detras.
  const mist = createMistPass({ camera, air, wind: wind.uniforms, radius: ROOM.radius - 2 });
  postFX.addSceneEffect(mist.pass);

  /* ---------------- Interacción ---------------- */
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let hovered = null;
  let lastPointerDown = 0;
  const downAt = new Vector2();

  renderer.domElement.addEventListener('pointermove', (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  });

  renderer.domElement.addEventListener('pointerdown', (e) => {
    lastPointerDown = performance.now();
    downAt.set(e.clientX, e.clientY);
  });

  renderer.domElement.addEventListener('click', (e) => {
    // Se ignora el click si ha sido un arrastre de cámara: por tiempo o por
    // recorrido (un arrastre rápido cabe en 250 ms).
    if (performance.now() - lastPointerDown > 250) return;
    if (downAt.distanceTo(new Vector2(e.clientX, e.clientY)) > 6) return;

    const medal = pickMedal();
    if (medal) {
      onAchievementClick?.(medal);
      return;
    }
    // Tocar el agua la agita.
    const water = raycaster.intersectObject(fountain.raycastTarget, false)[0];
    if (water) {
      fountain.drop(water.point.x, water.point.z);
      return;
    }
    // Click en el vacío: vuelta a la vista general, si no se está ya en ella.
    if (isAwayFromHome()) api.resetView();
  });

  const homePolar = Math.acos((HOME.position.y - HOME.target.y) / HOME.position.distanceTo(HOME.target));

  /**
   * ¿Se ha apartado la cámara de la vista general? El giro automático cambia
   * el azimut, así que solo cuentan el objetivo, la distancia y la altura.
   */
  function isAwayFromHome() {
    if (focused) return true;
    const homeDistance = HOME.position.distanceTo(HOME.target);
    const distance = camera.position.distanceTo(controls.target);
    return (
      controls.target.distanceTo(HOME.target) > 0.3 ||
      Math.abs(distance - homeDistance) > 1.5 ||
      Math.abs(controls.getPolarAngle() - homePolar) > 0.08
    );
  }

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

    environment.update(dt, currentStreak);
    reactor.update(dt);
    towers.tick(dt, time);
    pedestals.tick(dt, time);
    wet.update(dt);
    fountain.update(dt);
    wind.update(dt);
    air.uCoreEnergy.value = 0.15 + (Math.min(currentStreak, 30) / 30) * 0.5;
    dust.update(dt);
    mist.update(dt);
    sound.update(dt, { energy: reactor.energy, wind: wind.velocities });
    sparks.update(dt);
    controls.update();

    // El enfoque sigue al reactor: mantiene el DOF con sentido.
    postFX.setFocus(camera.position.distanceTo(reactor.group.position));

    postFX.render(dt);
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
    // Reflejo a media resolucion: se desenfoca de todos modos.
    const ratio = renderer.getPixelRatio();
    wet.setSize(Math.round(w * ratio * 0.5), Math.round(h * ratio * 0.5));
    dust.setViewport(h * ratio, camera.fov);
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

  /* ---------------- Vista ---------------- */
  // Preferencia de giro automático (botón del HUD). Enfocar un logro lo
  // suspende; volver a la vista general lo restaura.
  let rotatePreference = controls.autoRotate;
  let focused = false;
  let viewTimer = null;

  /* ---------------- API pública ---------------- */
  const api = {
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
      // Enfocado se queda quieto: girar alrededor de un medallón marea. Un
      // click en el vacío (o el botón de vista general) devuelve la cámara.
      focused = true;
      clearTimeout(viewTimer);
      controls.autoRotate = false;
      // Distancia suficiente para ver el medallón con contexto, no de cerca
      // hasta taparlo. Se mira desde fuera del anillo hacia el centro.
      const outward = pos.clone().setY(0).normalize();
      const targetPos = pos.clone().addScaledVector(outward, 4).setY(pos.y + 2.2);
      animateCamera(targetPos, pos.clone().setY(pos.y + 0.2), 900);
    },

    /** Vuelve a la vista general. */
    resetView() {
      focused = false;
      clearTimeout(viewTimer);
      controls.autoRotate = false;
      animateCamera(HOME.position.clone(), HOME.target.clone(), 800);
      viewTimer = setTimeout(() => {
        controls.autoRotate = rotatePreference;
      }, 2500);
    },

    /** Preferencia de giro (lo que muestra el botón), aunque esté en pausa. */
    get autoRotate() {
      return rotatePreference;
    },

    setAutoRotate(enabled) {
      rotatePreference = enabled;
      controls.autoRotate = enabled && !focused;
    },

    /** Rendijas de luz del muro (ver SLITS_ON). */
    setSlitsEnabled,
    get slitsEnabled() {
      return slitsOn;
    },

    /** Sonido de ambiente. Activarlo requiere un gesto del usuario. */
    setSoundEnabled(on) {
      sound.setEnabled(on);
    },
    get soundEnabled() {
      return sound.enabled;
    },

    /** Niebla baja: 0 la apaga, 1 es la densidad por defecto. */
    setMistDensity(k) {
      mist.setDensity(k);
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
      dust.dispose();
      mist.dispose();
      sound.dispose();
      fountain.dispose();
      wet.dispose();
      reactor.dispose();
      disposeTextures();
      // El render target del PMREM ocupa VRAM: hay que liberarlo o sobrevive
      // al renderer.
      envRT.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
  return api;

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
