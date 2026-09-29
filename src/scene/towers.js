/**
 * Torres de materia: una columna holográfica por asignatura.
 *
 * La altura codifica los minutos acumulados y el color la intensidad. Sirven
 * de "vista de datos" dentro del propio laboratorio: se comparan de un vistazo
 * sin salir de la escena 3D.
 */

import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  CircleGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PointLight,
  RingGeometry,
  ShaderMaterial,
} from 'three';
import { createLabel } from './labels.js';

/** Paleta estable: cada materia siempre tiene el mismo color. */
const PALETTE = [
  0x35d6ff, 0xa78bfa, 0xff6ad5, 0x4ade80, 0xfbbf24,
  0xfb7185, 0x22d3ee, 0xc084fc, 0x60a5fa, 0xf472b6,
  0x34d399, 0xfacc15, 0xf87171,
];

function colorFor(index) {
  return PALETTE[index % PALETTE.length];
}

const TOWER_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const TOWER_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uFill;   // 0..1, cuánto se "rellena" la barra
  uniform float uEnergy;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    // Fresnel fuerte: el filo del cilindro es lo unico que brilla, el
    // interior se queda en penumbra. Es lo que diferencia vidrio oscuro de
    // barra de luz.
    float fresnel = pow(1.0 - max(dot(vNormal, vViewDir), 0.0), 2.6);
    float rim = smoothstep(0.25, 1.0, fresnel);

    // Barrido de energia ascendente, muy contenido.
    float sweep = fract(vUv.y * 3.0 - uTime * 0.55);
    float band = pow(1.0 - abs(sweep - 0.5) * 2.0, 10.0);

    // Escala de medicion: solo visible en el filo, no en el cuerpo.
    float segments = smoothstep(0.44, 0.5, abs(fract(vUv.y * 22.0) - 0.5));

    // Parte "llena" = proporcion que representa esta materia en el total.
    float filled = step(vUv.y, uFill);

    // Cuerpo de vidrio oscuro: casi negro, con un toque del color de la materia.
    vec3 body = uColor * 0.10 + vec3(0.02, 0.05, 0.07);

    // Filo luminoso: aqui vive el color saturado.
    vec3 rimColor = uColor * (1.0 + uEnergy * 0.5);

    vec3 color = mix(body, rimColor, rim);
    color += uColor * band * 0.35 * rim;
    color += vec3(1.0) * segments * 0.06 * rim;
    // La parte rellena se intuye por unPlus de luz, no por opacidad.
    color += rimColor * filled * 0.12;

    // Opacidad: baja en el cuerpo, alta en el filo. Asi el cilindro se lee
    // como un tubo de vidrio y no como un cubo solido.
    float alpha = (0.18 + rim * 0.62 + band * 0.10) * (0.7 + filled * 0.3);

    gl_FragColor = vec4(color, clamp(alpha, 0.0, 0.85));
  }
`;

export function createSubjectTowers({ maxSubjects = 10, radius = 10.5 } = {}) {
  const group = new Group();
  /** @type {Map<string, object>} materia -> torre */
  const towers = new Map();

  // Radio superior = inferior: si la torre es cónica, escalar en Y deforma el
  // cónico y cada barra parece una campana en vez de un tubo de medición.
  const geometry = new CylinderGeometry(0.46, 0.46, 1, 28, 1, true);
  geometry.translate(0, 0.5, 0); // origen en la base para escalar en Y

  // Tapa: sin ella el DoubleSide deja ver la pared interior y la torre se lee
  // como un cubo abierto. Material simple, sin uFill: con el shader de la
  // barra el disco mostraria un corte tipo porcion de pizza.
  const capGeometry = new CircleGeometry(0.46, 28);
  capGeometry.rotateX(-Math.PI / 2);

  function createTower(subject, index, stats) {
    const color = colorFor(index);
    const material = new ShaderMaterial({
      vertexShader: TOWER_VERT,
      fragmentShader: TOWER_FRAG,
      transparent: true,
      depthWrite: false,
      // Blending normal, no aditivo: el aditivo saturaba el color de la
      // materia hasta pastel y lo convertia en plastico.
      blending: NormalBlending,
      uniforms: {
        uColor: { value: new Color(color) },
        uTime: { value: index * 0.7 },
        uFill: { value: 0 },
        uEnergy: { value: 0 },
      },
    });

    const mesh = new Mesh(geometry, material);
    const holder = new Group();
    holder.add(mesh);

    // Tapa superior en el color de la materia, con material simple: usar el
    // shader de la barra haria que el disco mostrara un corte tipo porcion
    // de pizza, porque uFill se evalua sobre vUv.y.
    const cap = new Mesh(
      capGeometry,
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.38,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    holder.add(cap);

    // Anillo de base: marca la posición sin dominar la torre.
    const base = new Mesh(
      new RingGeometry(0.46, 0.6, 32),
      new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.18,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    base.rotation.x = -Math.PI / 2;
    base.position.y = 0.04;
    holder.add(base);

    // Luz real de la torre. Una torre que solo brilla con emisivo se lee como
    // un objeto pintado; para que ilumine de verdad hace falta una fuente en
    // la escena. El color es el de la materia.
    const lamp = new PointLight(color, 0, 11, 2);
    lamp.position.y = 0.6;
    holder.add(lamp);

    // La etiqueta muestra horas y minutos: "3 h" frente a "3 h 20 min" no
    // permite comparar materias con precisión.
    const label = createLabel(subject, { color: '#e8fbff', borderColor: hexToRgba(color, 0.6) });
    holder.add(label);

    // Disposición circular, evenly spaced, mirando al centro.
    const angle = (index / maxSubjects) * Math.PI * 2;
    holder.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    holder.rotation.y = -angle;

    group.add(holder);
    return { holder, mesh, material, base, cap, lamp, label, index, color, currentHeight: 0, targetHeight: 0 };
  }

  /**
   * Sincroniza las torres con las estadísticas actuales.
   * @param {Array<{subject: string, minutes: number, sessions: number}>} subjects
   */
  function update(subjects) {
    const top = subjects.slice(0, maxSubjects);
    const totalMinutes = Math.max(1, top.reduce((acc, s) => acc + s.minutes, 0));

    top.forEach((stats, index) => {
      let tower = towers.get(stats.subject);
      if (!tower) {
        tower = createTower(stats.subject, index, stats);
        towers.set(stats.subject, tower);
      }
      // `uFill` es el peso real de la materia sobre el total, no sobre el
      // máximo: así la barra es comparable entre sesiones y días.
      const share = stats.minutes / Math.max(1, totalMinutes);
      tower.material.uniforms.uFill.value = Math.min(1, Math.sqrt(share * 6));

      // Escala logarítmica: en la práctica se acumulan muchas más horas que
      // minutos, y una escala lineal aplasta a las materias pequeñas hasta
      // hacerlas indistinguibles de un anillo en el suelo.
      const hours = stats.minutes / 60;
      tower.targetHeight = 0.7 + Math.log10(1 + hours) * 1.5;
      // Saturación rápida: con /20 la barra se apagaba casi siempre.
      tower.material.uniforms.uEnergy.value = Math.min(1, stats.sessions / 5);

      // La etiqueta se mueve con la torre y muestra el tiempo.
      const text = `${stats.subject} · ${formatHours(stats.minutes)}`;
      if (tower.label.userData.text !== text) {
        replaceLabel(tower, text);
      }
    });

    // Retira las materias que ya no tienen sesiones.
    for (const [subject, tower] of towers) {
      if (!top.some((s) => s.subject === subject)) {
        group.remove(tower.holder);
        tower.label.material.map.dispose();
        tower.label.material.dispose();
        towers.delete(subject);
      }
    }
  }

  function replaceLabel(tower, text) {
    const old = tower.label;
    const label = createLabel(text, { color: '#e8fbff', borderColor: hexToRgba(tower.color, 0.6) });
    label.position.copy(old.position);
    tower.holder.add(label);
    tower.holder.remove(old);
    old.material.map.dispose();
    old.material.dispose();
    tower.label = label;
  }

  function tick(dt, time) {
    for (const tower of towers.values()) {
      tower.currentHeight += (tower.targetHeight - tower.currentHeight) * Math.min(1, dt * 3);
      tower.mesh.scale.y = tower.currentHeight;
      // La tapa sigue a la punta del tubo, que está escalada en Y.
      tower.cap.position.y = tower.currentHeight;
      tower.material.uniforms.uTime.value = time * 0.6 + tower.index;
      tower.label.position.set(0, tower.currentHeight + 0.55, 0);
      // La luz crece con la altura: una materia que ha studiado mas ilumina
      // mas, que es justo lo que hace que la torre se lea como fuente.
      const energy = tower.material.uniforms.uEnergy.value;
      tower.lamp.intensity = 5 + tower.currentHeight * 3.2 * (0.4 + energy * 0.6);
      tower.lamp.position.y = tower.currentHeight * 0.55 + 0.4;
      // La etiqueta siempre mira a cámara: los sprites ya lo hacen solos.
      tower.base.material.opacity = 0.25 + energy * 0.35;
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

function hexToRgba(hex, alpha) {
  const c = new Color(hex);
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
}
