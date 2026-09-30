/**
 * Polvo en suspension: la boveda lleva milenios cerrada.
 *
 * El polvo no brilla por si mismo: solo se ve donde lo atraviesa la luz
 * (`airLight`, ver air.js). Fuera de los haces queda practicamente invisible,
 * y asi el cono del foco se dibuja solo, sin geometria falsa.
 *
 * Se mueve con las corrientes de wind.js: cada mota sigue a la corriente de
 * su zona, con una sensibilidad propia (las mas finas se las lleva antes el
 * aire). Encima, una caida muy lenta y un temblor minimo. Todo va en el vertex
 * shader, sin tocar buffers en CPU.
 *
 * Las motas viven en una caja de lado 2R que se repite: al salir por un lado
 * entran por el otro. El salto queda fuera del circulo de la sala, donde la
 * mota ya se ha desvanecido.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Points,
  ShaderMaterial,
} from 'three';
import { LIGHT } from './palette.js';
import { AIR_LIGHT_GLSL } from './air.js';
import { WIND_GLSL } from './wind.js';

const VERTEX = /* glsl */ `
  attribute float aSeed;

  uniform float uTime;
  uniform float uHeight;
  uniform float uRadius;
  uniform float uPixelScale;

  ${AIR_LIGHT_GLSL}
  ${WIND_GLSL}

  varying float vLight;
  varying float vSize;

  void main() {
    vec3 p = position;

    // Arrastre del viento: la corriente de su zona, con sensibilidad propia.
    p += windOffsetAt(position.xz) * (0.5 + aSeed * 0.9);

    // Caida muy lenta.
    p.y -= uTime * (0.006 + aSeed * 0.012);

    // Temblor: aire quieto a escala de centimetros.
    float t = uTime * 0.21;
    p.x += sin(t * (1.0 + aSeed) + aSeed * 40.0) * 0.12;
    p.y += sin(t * 1.3 + aSeed * 17.0) * 0.06;
    p.z += cos(t * (0.8 + aSeed) + aSeed * 23.0) * 0.12;

    // Caja periodica.
    p.xz = mod(p.xz + uRadius, 2.0 * uRadius) - uRadius;
    p.y = mod(p.y, uHeight);

    float fade = (1.0 - smoothstep(uRadius * 0.82, uRadius, length(p.xz)))
      * smoothstep(0.0, 0.6, p.y) * (1.0 - smoothstep(uHeight - 1.0, uHeight, p.y));

    // Un minimo fuera de los haces; mas alto, el aire parece un cielo
    // estrellado.
    vLight = (airLight(p) + 0.006) * fade;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    // Motas de 4 a 10 mm: polvo fino, no copos. Muchas y pequenas: solo se
    // ven las pocas que cruzan un haz, asi que hace falta densidad.
    float size = (0.004 + aSeed * 0.006) * uPixelScale / max(-mv.z, 0.1);

    // Tamano en pantalla fijo entre 2.5 y 3 px, con el brillo repartido por
    // el area real. Un punto de 1 px con MSAA cubre mas o menos muestras
    // segun su posicion subpixel: al moverse titila. Con 2.5 px la cobertura
    // es estable.
    float drawn = clamp(size, 2.5, 3.0);
    vSize = min(1.0, (size * size) / (drawn * drawn));

    // Las motas pegadas a la camara se apagan: a esa distancia eran discos
    // grandes y borrosos que tapaban la escena.
    vSize *= smoothstep(1.5, 4.0, -mv.z);
    gl_PointSize = drawn;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vLight;
  varying float vSize;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float soft = 1.0 - smoothstep(0.0, 0.5, d);
    float a = soft * soft * vLight * vSize * uIntensity;
    // El blending aditivo ya multiplica por alfa.
    gl_FragColor = vec4(uColor, a);
  }
`;

/**
 * @param {{count?: number, radius?: number, height?: number, air: object, wind: object}} options
 *   `air` y `wind` son los uniforms compartidos de air.js y wind.js.
 */
export function createDust({ count = 24000, radius = 26, height = 14, air, wind }) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    // Uniforme en la caja: el viento las recoloca de todos modos.
    positions[i * 3] = (Math.random() * 2 - 1) * radius;
    // Mas densa abajo: el polvo se acumula cerca del suelo.
    positions[i * 3 + 1] = Math.pow(Math.random(), 1.4) * height;
    positions[i * 3 + 2] = (Math.random() * 2 - 1) * radius;
    seeds[i] = Math.random();
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new BufferAttribute(seeds, 1));

  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...air,
      ...wind,
      uTime: { value: 0 },
      uHeight: { value: height },
      uRadius: { value: radius },
      uPixelScale: { value: 600 },
      uColor: { value: new Color(LIGHT.dust) },
      // Alto a proposito: las motas son subpixel y solo brillan dentro de un
      // haz. Con 3 no se veia ninguna.
      uIntensity: { value: 10 },
    },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const points = new Points(geometry, material);
  points.frustumCulled = false;

  return {
    points,
    /** Altura del viewport en px y fov: el tamano de mota es fisico. */
    setViewport(heightPx, fovDeg) {
      material.uniforms.uPixelScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    },
    update(dt) {
      material.uniforms.uTime.value += dt;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
