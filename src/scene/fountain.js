/**
 * Fuente bajo el reactor: pilon de piedra con agua viva.
 *
 * El agua es una simulacion de ondas real en GPU (GPUComputationRenderer): un
 * campo de alturas de 256x256 que resuelve la ecuacion de onda con una
 * velocidad de propagacion explicita. La perturban:
 *
 * - gotas de condensacion que caen del giroscopio del reactor, cada una en un
 *   punto distinto y con salpicaduras satelite,
 * - una brisa de rizos pequenos e irregulares,
 * - un click sobre el agua.
 *
 * Del mismo campo salen la superficie (normales -> reflejo distorsionado) y
 * las causticas del fondo (curvatura de la superficie -> luz concentrada).
 */

import {
  BackSide,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  Vector2,
  Vector4,
} from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { SURFACE, ledMaterial } from './palette.js';
import { guardReflector, NO_REFLECTION_LAYER } from './wet.js';

const SIM_SIZE = 256;
const MAX_DROPS = 6;
const SIM_HZ = 60;
/** Radio del agua en uv de la simulacion (el borde, 0.5, es la pared). */
const SIM_RADIUS = 0.49;

/* ------------------------------------------------------------------ */
/* Simulacion                                                         */
/* ------------------------------------------------------------------ */

/**
 * Ecuacion de onda: h' = 2h - h_prev + k * laplaciano, amortiguada. x es la
 * altura, y la altura del paso anterior.
 *
 * - k = c^2 es la velocidad de la onda en celdas por paso, al cuadrado. La
 *   formula clasica de "media de vecinos" equivale a k = 0.5, que a 60 Hz
 *   daba ondas de metro y medio por segundo: un chapoteo nervioso. Con k
 *   bajo las ondas viajan despacio, como en un pilon de verdad.
 * - Pared: condicion de Neumann (no pasa agua a traves de la piedra). Un
 *   vecino fuera del circulo toma la altura de la celda actual, asi que la
 *   onda rebota sin invertirse. Fijar la altura a cero (Dirichlet) la
 *   invertia y el rebote se sentia artificial.
 * - Junto a la pared se amortigua algo mas: la piedra y el menisco se comen
 *   parte de la energia en cada rebote.
 */
const SIM_SHADER = /* glsl */ `
  uniform vec4 uDrops[${MAX_DROPS}];
  uniform float uSpeed;
  uniform float uDamping;
  uniform float uWallDamping;

  float neighbour(vec2 q, float fallback) {
    return length(q - 0.5) > ${SIM_RADIUS.toFixed(3)} ? fallback : texture2D(heightmap, q).x;
  }

  void main() {
    vec2 cell = 1.0 / resolution.xy;
    vec2 uv = gl_FragCoord.xy * cell;
    float r = length(uv - 0.5);

    vec4 here = texture2D(heightmap, uv);
    float h = here.x;
    float n = neighbour(uv + vec2(0.0, cell.y), h);
    float s = neighbour(uv - vec2(0.0, cell.y), h);
    float e = neighbour(uv + vec2(cell.x, 0.0), h);
    float w = neighbour(uv - vec2(cell.x, 0.0), h);

    float lap = n + s + e + w - 4.0 * h;
    float damping = mix(uDamping, uWallDamping, smoothstep(${(SIM_RADIUS - 0.035).toFixed(3)}, ${SIM_RADIUS.toFixed(3)}, r));
    float next = (2.0 * h - here.y + uSpeed * lap) * damping;

    // Gotas: xy posicion en uv, z amplitud (negativa hunde), w radio en uv.
    for (int i = 0; i < ${MAX_DROPS}; i++) {
      vec4 drop = uDrops[i];
      float d = length(uv - drop.xy);
      if (drop.w > 0.0 && d < drop.w) {
        next += drop.z * (cos(d / drop.w * 3.14159265) * 0.5 + 0.5);
      }
    }

    if (r > ${SIM_RADIUS.toFixed(3)}) next = 0.0;
    gl_FragColor = vec4(next, h, 0.0, 1.0);
  }
`;

/* ------------------------------------------------------------------ */
/* Superficie del agua                                                */
/* ------------------------------------------------------------------ */

const WATER_SHADER = {
  name: 'FountainWater',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uHeight: { value: null },
    uTexel: { value: new Vector2(1 / SIM_SIZE, 1 / SIM_SIZE) },
    uNormalScale: { value: 16 },
    uDeep: { value: new Color(0x02080b) },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec2 vSurfaceUv;
    varying vec3 vWorld;

    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vSurfaceUv = uv;
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D uHeight;
    uniform vec3 color;
    uniform vec2 uTexel;
    uniform float uNormalScale;
    uniform vec3 uDeep;
    varying vec4 vUv;
    varying vec2 vSurfaceUv;
    varying vec3 vWorld;

    void main() {
      vec2 uv = vSurfaceUv;
      float r = length(uv - 0.5);
      if (r > 0.5) discard;

      // Diferencias a dos celdas: suaviza el ruido de la malla sin perder
      // la forma de la onda.
      vec2 o = uTexel * 2.0;
      float hL = texture2D(uHeight, uv - vec2(o.x, 0.0)).x;
      float hR = texture2D(uHeight, uv + vec2(o.x, 0.0)).x;
      float hD = texture2D(uHeight, uv - vec2(0.0, o.y)).x;
      float hU = texture2D(uHeight, uv + vec2(0.0, o.y)).x;
      vec3 n = normalize(vec3((hL - hR) * uNormalScale, (hD - hU) * uNormalScale, 1.0));

      // El plano esta tumbado: su z local es la y del mundo, su y es la -z.
      vec3 N = normalize(vec3(n.x, n.z, -n.y));
      vec3 V = normalize(cameraPosition - vWorld);
      float cosT = clamp(dot(N, V), 0.0, 1.0);
      float fresnel = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

      vec2 ruv = vUv.xy / vUv.w + n.xy * 0.08;
      vec3 reflected = texture2D(tDiffuse, ruv).rgb * color;

      // Alfa premultiplicado: el reflejo se suma, el cuerpo del agua vela un
      // poco el fondo. De frente se ve el fondo; en rasante, el reflejo.
      float body = 0.3;
      float alpha = fresnel + (1.0 - fresnel) * body;
      vec3 rgb = reflected * fresnel + uDeep * (1.0 - fresnel) * body;

      // Menisco: el agua se oscurece un poco contra la piedra.
      float rim = smoothstep(0.46, 0.5, r);
      rgb *= 1.0 - rim * 0.4;

      gl_FragColor = vec4(rgb, alpha);
    }
  `,
};

/* ------------------------------------------------------------------ */
/* Fuente                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param {{renderer: import('three').WebGLRenderer, camera: import('three').Camera, baseY: number, dripFrom?: number, onSplash?: Function}} options
 *   baseY: altura de la tarima donde se apoya el pilon.
 *   dripFrom: altura desde la que caen las gotas (punto bajo del reactor).
 */
export function createFountain({
  renderer,
  camera,
  baseY,
  dripFrom = 1.8,
  innerRadius = 2.35,
  outerRadius = 2.6,
  onSplash = null,
}) {
  const group = new Group();
  const wallTop = baseY + 0.52;
  const floorY = baseY + 0.03;
  const waterY = baseY + 0.42;

  /* --- Simulacion --- */
  const gpu = new GPUComputationRenderer(SIM_SIZE, SIM_SIZE, renderer);
  const heightVar = gpu.addVariable('heightmap', SIM_SHADER, gpu.createTexture());
  gpu.setVariableDependencies(heightVar, [heightVar]);
  heightVar.minFilter = LinearFilter;
  heightVar.magFilter = LinearFilter;
  const drops = Array.from({ length: MAX_DROPS }, () => new Vector4());
  Object.assign(heightVar.material.uniforms, {
    uDrops: { value: drops },
    // c = 0.2 celdas por paso: ~0.2 m/s con esta resolucion. Ondas lentas y
    // pesadas, como las de un pilon; no un chapoteo.
    uSpeed: { value: 0.045 },
    // Por paso a 60 Hz. Con ondas lentas la energia debe durar mas pasos;
    // con 0.985 se apagaban antes de llegar a la pared.
    uDamping: { value: 0.9965 },
    uWallDamping: { value: 0.975 },
  });
  const error = gpu.init();
  if (error) console.error('[fountain]', error);

  const pending = [];

  /** Perturba el agua en coordenadas de mundo. */
  function drop(x, z, amplitude = 0.3, radius = 0.12) {
    const u = x / (innerRadius * 2) + 0.5;
    // El plano tumbado lleva su v hacia -z del mundo.
    const v = -z / (innerRadius * 2) + 0.5;
    pending.push(new Vector4(u, v, amplitude, radius / (innerRadius * 2)));
  }

  /**
   * Una gota real no deja un anillo perfecto: el impacto levanta una corona
   * y salpicaduras que vuelven a caer alrededor, desfasadas.
   */
  function splash(x, z, amplitude, radius) {
    drop(x, z, amplitude, radius);
    // Solo los impactos suenan; la brisa (drop directo) no.
    onSplash?.(x, waterY, z, amplitude, radius);
    const satellites = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < satellites; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = radius * (0.6 + Math.random() * 1.4);
      const delay = 60 + Math.random() * 220;
      setTimeout(() => {
        drop(x + Math.cos(a) * d, z + Math.sin(a) * d, amplitude * (0.15 + Math.random() * 0.25), radius * 0.5);
      }, delay);
    }
  }

  /* --- Pilon --- */
  const stone = new MeshPhysicalMaterial({
    color: SURFACE.stone,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
  const wallHeight = wallTop - baseY;

  const outer = new Mesh(new CylinderGeometry(outerRadius, outerRadius, wallHeight, 160, 1, true), stone);
  outer.position.y = baseY + wallHeight / 2;
  outer.castShadow = true;
  outer.receiveShadow = true;

  const inner = new Mesh(
    new CylinderGeometry(innerRadius, innerRadius, wallHeight, 160, 1, true),
    new MeshPhysicalMaterial({ color: SURFACE.stone, roughness: 0.45, clearcoat: 0.5, side: BackSide }),
  );
  inner.position.y = outer.position.y;
  inner.receiveShadow = true;

  const top = new Mesh(new RingGeometry(innerRadius, outerRadius + 0.05, 160), stone);
  top.rotation.x = -Math.PI / 2;
  top.position.y = wallTop;
  top.receiveShadow = true;

  // Labio saliente: da sombra sobre la pared y un canto que coge luz.
  const lip = new Mesh(new CylinderGeometry(outerRadius + 0.05, outerRadius + 0.05, 0.06, 160, 1, true), stone);
  lip.position.y = wallTop - 0.03;

  // Filo LED bajo el labio, como en los escalones.
  const led = new Mesh(
    new CylinderGeometry(outerRadius + 0.004, outerRadius + 0.004, 0.018, 256, 1, true),
    ledMaterial(2.2),
  );
  led.position.y = wallTop - 0.12;

  /* --- Fondo con causticas --- */
  const caustics = {
    uHeightField: { value: null },
    uBasin: { value: new Vector4(0, 0, innerRadius, 0) },
    uCausticGain: { value: 0.9 },
  };
  const bottomMat = new MeshStandardMaterial({ color: 0x1c2024, roughness: 0.65, metalness: 0 });
  bottomMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, caustics);
    shader.vertexShader = 'varying vec2 vBasinXZ;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n  vBasinXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
    );
    shader.fragmentShader = `
      varying vec2 vBasinXZ;
      uniform sampler2D uHeightField;
      uniform vec4 uBasin;
      uniform float uCausticGain;
    ` + shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
      {
        // Donde la superficie es concava (laplaciano negativo) la luz del
        // foco se concentra en el fondo; donde es convexa, se abre.
        vec2 cuv = vec2(
          (vBasinXZ.x - uBasin.x) / (uBasin.z * 2.0) + 0.5,
          -(vBasinXZ.y - uBasin.y) / (uBasin.z * 2.0) + 0.5
        );
        // A tres celdas: a una sola recoge el ruido de la malla.
        float c = 3.0 / ${SIM_SIZE.toFixed(1)};
        float h = texture2D(uHeightField, cuv).x;
        float lap = texture2D(uHeightField, cuv + vec2(c, 0.0)).x
          + texture2D(uHeightField, cuv - vec2(c, 0.0)).x
          + texture2D(uHeightField, cuv + vec2(0.0, c)).x
          + texture2D(uHeightField, cuv - vec2(0.0, c)).x - 4.0 * h;
        float caustic = smoothstep(0.0, 1.0, -lap * 12.0);
        totalEmissiveRadiance += vec3(0.85, 0.93, 1.0) * caustic * uCausticGain;
      }`,
    );
  };
  bottomMat.customProgramCacheKey = () => 'fountain-bottom';
  const bottom = new Mesh(new CircleGeometry(innerRadius, 96), bottomMat);
  bottom.rotation.x = -Math.PI / 2;
  bottom.position.y = floorY;
  bottom.receiveShadow = true;

  group.add(outer, inner, top, lip, led, bottom);

  /* --- Agua --- */
  const water = new Reflector(new PlaneGeometry(innerRadius * 2, innerRadius * 2), {
    textureWidth: 512,
    textureHeight: 512,
    color: new Color(0xffffff),
    clipBias: 0.003,
    shader: WATER_SHADER,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = waterY;
  water.material.transparent = true;
  water.material.premultipliedAlpha = true;
  water.material.blending = NormalBlending;
  water.material.side = DoubleSide;
  guardReflector(water, camera);
  water.getReflectionCamera(camera).layers.disable(NO_REFLECTION_LAYER);
  group.add(water);

  /* --- Gotas de condensacion --- */
  const dripGeo = new SphereGeometry(0.018, 10, 8);
  dripGeo.scale(1, 1.6, 1);
  const dripMat = new MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transmission: 1, thickness: 0.05 });
  const drip = new Mesh(dripGeo, dripMat);
  drip.visible = false;
  group.add(drip);
  let dripTimer = 1.5;
  let dripVelocity = 0;

  function updateDrip(dt) {
    if (drip.visible) {
      dripVelocity += 9.8 * dt;
      drip.position.y -= dripVelocity * dt;
      if (drip.position.y <= waterY) {
        drip.visible = false;
        splash(drip.position.x, drip.position.z, 0.22 + Math.random() * 0.14, 0.14 + Math.random() * 0.08);
      }
      return;
    }
    dripTimer -= dt;
    if (dripTimer <= 0) {
      dripTimer = 3 + Math.random() * 6;
      dripVelocity = 0;
      // Condensacion de cualquier punto de los anillos, no siempre del mismo:
      // una gota en el centro exacto cada pocos segundos dibujaba un anillo
      // perfecto que delataba el truco.
      const a = Math.random() * Math.PI * 2;
      const r = 0.2 + Math.random() * 1.1;
      drip.position.set(Math.cos(a) * r, dripFrom + Math.random() * 0.6, Math.sin(a) * r);
      drip.visible = true;
    }
  }

  /* --- Bucle --- */
  let accumulator = 0;
  let breezeTimer = 0;

  function step() {
    for (let i = 0; i < MAX_DROPS; i++) {
      const next = pending[i];
      if (next) drops[i].copy(next);
      else drops[i].set(0, 0, 0, 0);
    }
    pending.splice(0, MAX_DROPS);
    gpu.compute();
  }

  return {
    group,
    water,
    /** Altura de la superficie del agua (para situar sonidos). */
    waterY,
    /** Objetos sobre los que un click cuenta como tocar el agua. */
    raycastTarget: water,
    drop: (x, z) => splash(x, z, 0.45, 0.22),
    update(dt) {
      // Paso fijo: la velocidad de las ondas no depende de los fps.
      accumulator = Math.min(accumulator + dt, 3 / SIM_HZ);

      // Brisa: rizos pequenos, frecuentes y de tamano variable. Muchos y
      // solapados, la superficie se riza de forma irregular en vez de dibujar
      // circulos aislados.
      breezeTimer -= dt;
      if (breezeTimer <= 0) {
        breezeTimer = 0.12 + Math.random() * 0.3;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * innerRadius * 0.95;
        drop(Math.cos(a) * r, Math.sin(a) * r, (Math.random() - 0.4) * 0.02, 0.15 + Math.random() * 0.3);
      }

      updateDrip(dt);
      while (accumulator >= 1 / SIM_HZ) {
        step();
        accumulator -= 1 / SIM_HZ;
      }
      const texture = gpu.getCurrentRenderTarget(heightVar).texture;
      water.material.uniforms.uHeight.value = texture;
      caustics.uHeightField.value = texture;
    },
    dispose() {
      gpu.dispose();
      water.dispose();
      group.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          if (o.material !== water.material) o.material.dispose?.();
        }
      });
    },
  };
}
