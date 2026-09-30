/**
 * Pavimento mojado.
 *
 * Dos piezas que comparten el mismo mapa de charcos (`wetMask`, en
 * coordenadas de mundo, sin textura y sin repeticion):
 *
 * 1. `applyWetFloor(material)` parchea el MeshStandardMaterial del suelo: en
 *    el charco oscurece el albedo, baja la rugosidad y aplana el relieve,
 *    porque el agua rellena las juntas.
 * 2. `createWetReflection()` es el reflejo de verdad: un `Reflector` que no se
 *    pinta como espejo sino sumado encima del suelo, con Fresnel del agua y
 *    un desenfoque vertical. Asi se ven las rendijas, los filos LED y el
 *    reactor estirados en el charco, como en asfalto mojado, y en seco apenas
 *    queda un velo.
 *
 * Un Reflector grande pintado como espejo daba imagenes nitidas y duras (ver
 * la bitacora); lo que lo hace creible es el desenfoque y que solo refleje
 * donde hay agua.
 */

import { AdditiveBlending, CircleGeometry, Color } from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

/**
 * Capa de lo que la camara principal ve pero los reflejos no: placas de texto
 * y capas de niebla. En un charco se verian como planos pegados al suelo.
 */
export const NO_REFLECTION_LAYER = 1;

/**
 * Limita un Reflector a actualizarse solo para la camara principal.
 *
 * Sin esto, con dos reflectores (suelo y fuente) cada uno vuelve a renderizar
 * la escena dentro del reflejo del otro, y ademas los dos se repiten en la
 * pasada de profundidad del DOF (que usa `overrideMaterial`). Cuatro o cinco
 * renders de la escena por frame en vez de tres.
 */
export function guardReflector(reflector, mainCamera) {
  const update = reflector.onBeforeRender;
  reflector.onBeforeRender = function (renderer, scene, camera, ...rest) {
    if (camera !== mainCamera || scene.overrideMaterial) return;
    update.call(this, renderer, scene, camera, ...rest);
  };
}

/** Ruido y mascara de charcos. GLSL puro: sin comillas invertidas aqui. */
export const WET_GLSL = /* glsl */ `
  float wetHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float wetNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(wetHash(i), wetHash(i + vec2(1.0, 0.0)), u.x),
      mix(wetHash(i + vec2(0.0, 1.0)), wetHash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float wetFbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      sum += amp * wetNoise(p);
      p = p * 2.03 + vec2(17.1, 9.2);
      amp *= 0.5;
    }
    return sum;
  }

  // 0 seco, 1 charco. Cuencas anchas con borde irregular: mucho suelo seco
  // entre charcos, que es lo que hace que el agua se lea como agua.
  float wetMask(vec2 xz) {
    float n = wetFbm(xz * 0.085);
    n = n * 0.78 + wetFbm(xz * 0.7 + 31.0) * 0.22;
    return smoothstep(0.455, 0.53, n);
  }
`;

/**
 * Parchea el material del suelo para que la mojadez module albedo,
 * rugosidad y relieve.
 * @param {import('three').MeshStandardMaterial} material
 * @param {{wetRoughness?: number}} options
 */
export function applyWetFloor(material, { wetRoughness = 0.16 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'varying vec2 vFloorXZ;\n' + shader.vertexShader.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\n  vFloorXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
    );

    shader.fragmentShader = 'varying vec2 vFloorXZ;\n' + WET_GLSL + shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  float wet = wetMask(vFloorXZ);
  // La piedra mojada es mas oscura: el agua reduce la difusion en superficie.
  diffuseColor.rgb *= mix(1.0, 0.45, wet);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
  roughnessFactor = mix(roughnessFactor, ${wetRoughness.toFixed(3)}, wet);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  // El agua rellena juntas y poros: dentro del charco no hay relieve.
  normal = normalize(mix(normal, nonPerturbedNormal, wet));`,
      );
  };
  // Clave de cache propia: sin ella Three puede reutilizar el programa de otro
  // MeshStandardMaterial sin el parche.
  material.customProgramCacheKey = () => 'wet-floor';
  material.needsUpdate = true;
}

const REFLECTION_SHADER = {
  name: 'WetReflection',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uStrength: { value: 1 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;

    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 color;
    uniform float uTime;
    uniform float uStrength;
    varying vec4 vUv;
    varying vec3 vWorld;

    ${WET_GLSL}

    void main() {
      float wet = wetMask(vWorld.xz);

      // Fresnel de Schlick con F0 del agua (0.02): de frente casi no refleja,
      // en rasante refleja casi todo.
      vec3 V = normalize(cameraPosition - vWorld);
      float cosT = clamp(V.y, 0.0, 1.0);
      float fresnel = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);

      vec2 uv = vUv.xy / vUv.w;

      // Rizado muy leve y lento en la superficie del agua.
      vec2 ripple = vec2(
        wetNoise(vWorld.xz * 2.4 + uTime * 0.15),
        wetNoise(vWorld.xz * 2.4 + 13.0 - uTime * 0.12)
      ) - 0.5;
      uv += ripple * 0.005 * wet;

      // Desenfoque vertical: en suelo mojado el reflejo de una luz se estira
      // hacia el observador. En seco se ensancha y se apaga.
      float spread = mix(0.06, 0.016, wet);
      vec3 acc = vec3(0.0);
      float total = 0.0;
      for (int i = -7; i <= 7; i++) {
        float t = float(i) / 7.0;
        float w = exp(-t * t * 2.5);
        acc += texture2D(tDiffuse, uv + vec2(t * spread * 0.12, t * spread)).rgb * w;
        total += w;
      }
      vec3 reflected = acc / total;

      float amount = mix(0.1, 1.0, wet);
      gl_FragColor = vec4(reflected * color * fresnel * amount * uStrength, 1.0);
    }
  `,
};

/**
 * Reflejo del pavimento. Se suma encima del suelo PBR.
 * @param {{radius?: number, resolution?: number}} options
 */
export function createWetReflection({ radius = 30, resolution = 1024 } = {}) {
  const reflector = new Reflector(new CircleGeometry(radius, 128), {
    textureWidth: resolution,
    textureHeight: resolution,
    color: new Color(0xffffff),
    clipBias: 0.003,
    shader: REFLECTION_SHADER,
  });
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.y = 0.004;

  const material = reflector.material;
  material.transparent = true;
  material.blending = AdditiveBlending;
  material.depthWrite = false;
  // Coplanar con el suelo: el desplazamiento evita el z-fighting.
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;

  let time = 0;
  return {
    mesh: reflector,
    /** Ata el reflejo a la camara principal (ver guardReflector). */
    attachTo(camera) {
      guardReflector(reflector, camera);
      reflector.getReflectionCamera(camera).layers.disable(NO_REFLECTION_LAYER);
    },
    setStrength(value) {
      material.uniforms.uStrength.value = value;
    },
    setSize(width, height) {
      reflector.getRenderTarget().setSize(width, height);
    },
    update(dt) {
      time += dt;
      material.uniforms.uTime.value = time;
    },
    dispose() {
      reflector.geometry.dispose();
      reflector.dispose();
    },
  };
}
