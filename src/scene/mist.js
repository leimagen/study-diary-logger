/**
 * Niebla baja volumetrica.
 *
 * Es un pase de post-proceso, no geometria: para cada pixel recorre el rayo
 * desde la camara hasta la superficie que hay detras (se lee del buffer de
 * profundidad) y acumula niebla por el camino. La niebla vive en una losa
 * desde el suelo hasta `top`, mas densa abajo, con un ruido 3D que arrastran
 * las corrientes de wind.js.
 *
 * Antes eran capas horizontales apiladas. Donde cada capa cortaba una columna
 * dibujaba un anillo, y al moverse la niebla esos anillos parpadeaban a
 * distintas alturas: parecia que algo subia por las torres. Con un volumen no
 * hay cortes.
 *
 * Como el polvo, la niebla toma la luz de `airLight` (air.js): se enciende en
 * el cono del foco y junto al reactor, y en lo oscuro solo vela un poco.
 *
 * El punto de partida del rayo lleva un dither fijo por pixel, no animado:
 * uno animado se ve como parpadeo.
 */

import { Color, Matrix4, ShaderMaterial, Vector3 } from 'three';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { AIR_LIGHT_GLSL } from './air.js';
import { WIND_GLSL } from './wind.js';

const STEPS = 28;

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform mat4 uProjInv;
  uniform mat4 uCamWorld;
  uniform vec3 uCamPos;
  uniform float uTime;
  uniform float uTop;
  uniform float uFalloff;
  uniform float uDensity;
  uniform float uAmbient;
  uniform float uRadius;
  uniform vec3 uColor;

  ${AIR_LIGHT_GLSL}
  ${WIND_GLSL}

  varying vec2 vUv;

  float mHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float mNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(mHash(i), mHash(i + vec3(1, 0, 0)), f.x),
          mix(mHash(i + vec3(0, 1, 0)), mHash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(mHash(i + vec3(0, 0, 1)), mHash(i + vec3(1, 0, 1)), f.x),
          mix(mHash(i + vec3(0, 1, 1)), mHash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z
    );
  }

  float mFbm(vec3 p) {
    float sum = 0.0;
    float amp = 0.55;
    for (int i = 0; i < 3; i++) {
      sum += amp * mNoise(p);
      p = p * 2.03 + vec3(11.3, 5.7, 3.1);
      amp *= 0.5;
    }
    return sum;
  }

  float density(vec3 p) {
    // Advectar: muestrear el ruido en el punto de donde viene el aire.
    vec3 q = p;
    q.xz -= windOffsetAt(p.xz).xz;
    q *= vec3(0.13, 0.3, 0.13);
    q += vec3(uTime * 0.008, -uTime * 0.004, uTime * 0.005);
    float n = smoothstep(0.28, 0.72, mFbm(q));

    // Mas densa abajo y sin techo duro.
    float height = exp(-max(p.y, 0.0) / uFalloff) * (1.0 - smoothstep(uTop * 0.65, uTop, p.y));
    // Se disipa hacia el muro y se espesa junto a la fuente, que la alimenta.
    float r2 = dot(p.xz, p.xz);
    float edge = 1.0 - smoothstep(uRadius * 0.7, uRadius, sqrt(r2));
    float fountain = 1.0 + 0.7 * exp(-r2 / 30.0);
    return n * height * edge * fountain;
  }

  // Dither fijo por pixel (interleaved gradient noise): reparte el error del
  // muestreo en grano estatico en vez de en bandas.
  float dither(vec2 px) {
    return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715))));
  }

  void main() {
    vec4 scene = texture2D(tDiffuse, vUv);
    float depth = texture2D(tDepth, vUv).x;

    vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 view = uProjInv * ndc;
    view /= view.w;
    vec3 world = (uCamWorld * view).xyz;

    vec3 ro = uCamPos;
    vec3 dir = world - ro;
    float tMax = length(dir);
    dir /= max(tMax, 0.0001);
    if (depth >= 1.0) tMax = 80.0;

    // Tramo del rayo dentro de la losa de niebla [0, uTop].
    float tEnter = 0.0;
    float tExit = tMax;
    if (abs(dir.y) > 0.0001) {
      float ta = (0.0 - ro.y) / dir.y;
      float tb = (uTop - ro.y) / dir.y;
      tEnter = max(tEnter, min(ta, tb));
      tExit = min(tExit, max(ta, tb));
    } else if (ro.y < 0.0 || ro.y > uTop) {
      tExit = -1.0;
    }
    tExit = min(tExit, tEnter + 50.0);
    if (tExit <= tEnter) {
      gl_FragColor = scene;
      return;
    }

    float dt = (tExit - tEnter) / float(${STEPS});
    float jitter = dither(gl_FragCoord.xy);
    float transmittance = 1.0;
    float light = 0.0;
    for (int i = 0; i < ${STEPS}; i++) {
      vec3 p = ro + dir * (tEnter + (float(i) + jitter) * dt);
      float d = density(p) * uDensity;
      if (d > 0.0005) {
        float a = 1.0 - exp(-d * dt);
        light += transmittance * a * (airLight(p) + uAmbient);
        transmittance *= 1.0 - a;
      }
    }

    gl_FragColor = vec4(scene.rgb * transmittance + uColor * light, scene.a);
  }
`;

/**
 * @param {{camera: import('three').Camera, air: object, wind: object, radius?: number, top?: number}} options
 */
export function createMistPass({ camera, air, wind, radius = 28, top = 5.5 }) {
  const material = new ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      ...air,
      ...wind,
      tDiffuse: { value: null },
      tDepth: { value: null },
      uProjInv: { value: new Matrix4() },
      uCamWorld: { value: new Matrix4() },
      uCamPos: { value: new Vector3() },
      uTime: { value: 0 },
      uTop: { value: top },
      // Escala de altura: a 1.8 m la densidad cae a un tercio.
      uFalloff: { value: 1.8 },
      uDensity: { value: 0.07 },
      // Luz minima fuera de los haces: lo que hace que la niebla se lea
      // blanca-azulada en toda la sala, muy tenue.
      uAmbient: { value: 0.08 },
      uRadius: { value: radius },
      // Blanco azulado.
      uColor: { value: new Color(0xd2e4f4) },
    },
    depthTest: false,
    depthWrite: false,
  });

  const quad = new FullScreenQuad(material);
  const baseDensity = material.uniforms.uDensity.value;

  class MistPass extends Pass {
    render(renderer, writeBuffer, readBuffer) {
      const u = material.uniforms;
      u.tDiffuse.value = readBuffer.texture;
      u.tDepth.value = readBuffer.depthTexture;
      u.uProjInv.value.copy(camera.projectionMatrixInverse);
      u.uCamWorld.value.copy(camera.matrixWorld);
      u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
      renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      quad.render(renderer);
    }

    dispose() {
      material.dispose();
      quad.dispose();
    }
  }

  const pass = new MistPass();

  return {
    pass,
    /** 0 apaga la niebla, 1 es la densidad por defecto. */
    setDensity(k) {
      material.uniforms.uDensity.value = baseDensity * k;
      pass.enabled = k > 0;
    },
    update(dt) {
      material.uniforms.uTime.value += dt;
    },
    dispose() {
      pass.dispose();
    },
  };
}
