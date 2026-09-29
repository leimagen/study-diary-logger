/**
 * Sistema de partículas de chispas.
 *
 * Un único `Points` con un pool de partículas y atributos dinámicos
 * (posición, color, tamaño, vida). Todo se integra en CPU: con ~1500
 * partículas es perfectamente fluido y evita el complejidad de un GPGPU pass.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
} from 'three';

const VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aLife;
  attribute vec3 aColor;

  varying float vLife;
  varying vec3 vColor;

  void main() {
    vLife = aLife;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // Las partículas se encogen al morir y crecen al nacer.
    float grow = smoothstep(0.0, 0.15, aLife) * (1.0 - smoothstep(0.6, 1.0, 1.0 - aLife));
    gl_PointSize = aSize * grow * (300.0 / max(0.001, -mvPosition.z));
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const FRAGMENT = /* glsl */ `
  varying float vLife;
  varying vec3 vColor;

  void main() {
    // vLife va de 1 (nace) a 0 (muere): 1.0 - aLife normaliza la vida.
    float life = 1.0 - vLife;
    if (life <= 0.0) discard;

    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;

    // Núcleo brillante + halo suave.
    float core = smoothstep(0.5, 0.0, d);
    float halo = pow(core, 3.0);
    float fade = 1.0 - smoothstep(0.0, 1.0, life);

    vec3 color = mix(vColor, vec3(1.0), halo * 0.8);
    gl_FragColor = vec4(color, (halo * 0.9 + core * 0.25) * fade);
  }
`;

export function createSparkSystem({ capacity = 1500 } = {}) {
  const geometry = new BufferGeometry();

  const positions = new Float32Array(capacity * 3);
  const colors = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const lives = new Float32Array(capacity); // 0 = muerta, 1 = recién nacida

  // Buffers de integración en CPU (no subidos a GPU).
  const velocities = new Float32Array(capacity * 3);
  const maxLifes = new Float32Array(capacity);
  const ages = new Float32Array(capacity);
  const drag = new Float32Array(capacity);
  const gravity = new Float32Array(capacity);

  // Empezamos con todo muerto y enterrado lejos de la cámara.
  for (let i = 0; i < capacity; i++) {
    lives[i] = 0;
    positions[i * 3 + 1] = -9999;
  }

  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
  geometry.setAttribute('aLife', new BufferAttribute(lives, 1));

  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const points = new Points(geometry, material);
  points.frustumCulled = false; // el pool se mueve por toda la escena

  let cursor = 0;
  let activeCount = 0;

  /**
   * Emite una chispa. Si el pool está lleno, recicla la más antigua.
   */
  function emit({ position, velocity, color, size, life, dragFactor = 0.6, gravityFactor = -1.2 }) {
    const i = cursor;
    cursor = (cursor + 1) % capacity;

    positions[i * 3] = position.x;
    positions[i * 3 + 1] = position.y;
    positions[i * 3 + 2] = position.z;

    velocities[i * 3] = velocity.x;
    velocities[i * 3 + 1] = velocity.y;
    velocities[i * 3 + 2] = velocity.z;

    const c = color instanceof Color ? color : new Color(color);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;

    sizes[i] = size;
    lives[i] = 1;
    maxLifes[i] = life;
    ages[i] = 0;
    drag[i] = dragFactor;
    gravity[i] = gravityFactor;
  }

  const tmp = { x: 0, y: 0, z: 0 };

  /**
   * Ráfaga esférica de chispas.
   * @param {{origin, count, color, speed, spread, size, life, upward}} opts
   */
  function burst({
    origin,
    count = 40,
    color = 0x4dd6ff,
    speed = 3,
    speedVariance = 0.6,
    size = 1.0,
    sizeVariance = 0.5,
    life = 1.4,
    lifeVariance = 0.4,
    upward = 0.5,
    dragFactor = 0.85,
    gravityFactor = -2.2,
  }) {
    const base = color instanceof Color ? color : new Color(color);
    for (let n = 0; n < count; n++) {
      // Dirección aleatoria uniforme en una esfera (muestreo por normal invertida).
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const dir = { x: r * Math.cos(theta), y: u, z: r * Math.sin(theta) };

      // Sesgo hacia arriba para que las chispas "suban" como en una reacción.
      dir.y += upward;
      const norm = Math.hypot(dir.x, dir.y, dir.z) || 1;
      dir.x /= norm;
      dir.y /= norm;
      dir.z /= norm;

      const s = speed * (1 - speedVariance + Math.random() * speedVariance * 2);
      const jitter = new Color(base).offsetHSL(
        (Math.random() - 0.5) * 0.06,
        0,
        (Math.random() - 0.5) * 0.25,
      );

      emit({
        position: { x: origin.x, y: origin.y, z: origin.z },
        velocity: { x: dir.x * s, y: dir.y * s, z: dir.z * s },
        color: jitter,
        size: size * (1 - sizeVariance + Math.random() * sizeVariance * 2),
        life: life * (1 - lifeVariance + Math.random() * lifeVariance * 2),
        dragFactor,
        gravityFactor,
      });
    }
  }

  /**
   * Polvo ambiental continuo.
   *
   * No se siembra una vez: se mantiene un presupuesto por segundo y se
   * reemite en `update`. Con un `seed` único, las partículas mueren a los
   * 6-12 s y el aire se queda permanentemente vacío.
   *
   * @param {{bounds, rate, color, size}} opts
   */
  function createAmbientDust({ bounds, rate = 55, color = 0x9fd8ff } = {}) {
    let carry = 0;
    return {
      bounds,
      rate,
      color,
      /** @param {number} dt */
      update(dt) {
        // Presupuesto fraccionario: a 10 fps no se emiten 5,5 partículas.
        carry += rate * dt;
        let n = Math.floor(carry);
        if (n <= 0) return;
        carry -= n;

        for (let i = 0; i < n; i++) {
          emit({
            position: {
              x: (Math.random() - 0.5) * bounds.x,
              y: Math.random() * bounds.y,
              z: (Math.random() - 0.5) * bounds.z,
            },
            // Deriva lenta lateral y ascenso tenue: se percibe como polvo en
            // suspension, no como lluvia.
            velocity: {
              x: (Math.random() - 0.5) * 0.14,
              y: 0.05 + Math.random() * 0.12,
              z: (Math.random() - 0.5) * 0.14,
            },
            color: Math.random() < 0.15 ? 0xffe9c4 : color,
            // Tamaño convariante en pantalla gracias al factor 300/-z del
            // shader: por eso 0.1-0.3 ya son varios píxeles de cerca.
            size: 0.1 + Math.random() * 0.3,
            life: 8 + Math.random() * 8,
            dragFactor: 0.15,
            gravityFactor: 0.01,
          });
        }
      },
    };
  }

  function update(dt) {
    let alive = 0;
    const step = Math.min(dt, 0.05); // evita saltos al volver de una pestaña inactiva

    for (let i = 0; i < capacity; i++) {
      if (lives[i] <= 0) continue;

      ages[i] += step;
      const t = ages[i] / maxLifes[i];

      if (t >= 1) {
        lives[i] = 0;
        positions[i * 3 + 1] = -9999;
        continue;
      }
      alive += 1;

      const i3 = i * 3;
      // Amortiguamiento exponencial independiente del framerate.
      const damping = Math.pow(1 - drag[i], step * 60);
      velocities[i3] *= damping;
      velocities[i3 + 1] *= damping;
      velocities[i3 + 2] *= damping;
      velocities[i3 + 1] += gravity[i] * step;

      positions[i3] += velocities[i3] * step;
      positions[i3 + 1] += velocities[i3 + 1] * step;
      positions[i3 + 2] += velocities[i3 + 2] * step;

      // Las chispas ambientales rebotan softly en el suelo para no perderse.
      if (positions[i3 + 1] < 0.05 && gravity[i] <= 0.05) {
        positions[i3 + 1] = 0.05;
        velocities[i3 + 1] = Math.abs(velocities[i3 + 1]) * 0.4;
      }

      lives[i] = 1 - t;
    }

    activeCount = alive;
    if (alive > 0) {
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.aColor.needsUpdate = true;
      geometry.attributes.aSize.needsUpdate = true;
      geometry.attributes.aLife.needsUpdate = true;
    }
  }

  return {
    points,
    burst,
    emit,
    createAmbientDust,
    update,
    get activeCount() {
      return activeCount;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
