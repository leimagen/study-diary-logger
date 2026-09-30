/**
 * Pipeline de post-procesado: depth of field + bloom + tone mapping + acabado
 * de camara (vineta y grano).
 *
 * El DOF (BokehPass) re-renderiza la escena para el mapa de profundidad, así
 * que cuesta el doble. Por eso se puede desactivar; el bloom es barato.
 */

import { DepthTexture, HalfFloatType, Vector2 } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Acabado de camara, ya en espacio de pantalla (despues del tone mapping).
 * La vineta concentra la mirada en el centro; el grano rompe los degradados
 * perfectos de las zonas oscuras, que son lo que delata un render. Ambos muy
 * suaves: si se notan como efecto, sobran.
 */
const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.35 },
    // Muy bajo: un grano animado fuerte se percibe como parpadeo.
    uGrain: { value: 0.018 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 c = vUv - 0.5;
      float vignette = 1.0 - uVignette * smoothstep(0.25, 0.85, dot(c, c) * 2.2);
      // Grano mas visible en sombras y medios que en altas luces, como en
      // pelicula.
      float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      float grain = (hash(vUv * 1024.0 + fract(uTime) * 97.0) - 0.5) * uGrain * (1.0 - luma * 0.7);
      gl_FragColor = vec4(color.rgb * vignette + grain, color.a);
    }
  `,
};

export function createPostFX(renderer, scene, camera, options = {}) {
  const {
    // Radius alto difunde el brillo por media pantalla: el reactor se comia el
    // Bloom generoso: es lo que rompe la oscuridad en un laboratorio con una
    // sola luz principal. Radius alto lo difunde de mas.
    // Solo recoge lo que esta por encima de 1.0 en HDR (LED, rendijas,
    // nucleo). Radio 0: pesan los niveles finos del bloom y el halo se queda
    // pegado al filo. Con radio o fuerza altos, las rendijas velaban toda la
    // imagen de blanco lechoso.
    bloomStrength = 0.2,
    bloomRadius = 0,
    bloomThreshold = 1.0,
    focus = 14,
    // DOF agresivo a proposito: esconde el detalle flojo del fondo y da
    // profundidad. No es "pixelado": eso es aliasing, que se arregla con MSAA.
    aperture = 0.00018,
    maxblur = 0.012,
  } = options;

  const size = renderer.getSize(new Vector2());
  const composer = new EffectComposer(renderer);
  // HalfFloat mantiene el rango HDR necesario para que el bloom no se recorte.
  composer.renderTarget1.texture.type = HalfFloatType;
  composer.renderTarget2.texture.type = HalfFloatType;

  /**
   * MSAA explicito en los render targets del composer.
   *
   * `antialias: true` en el WebGLRenderer solo afecta al framebuffer por
   * defecto, que el composer esquiva por completo: todo se renderiza a un
   * render target. Sin esto, cada arista sale con aliasing: eso es el
   * "pixelado", y no tiene nada que ver con el DOF.
   */
  const samples = renderer.capabilities.isWebGL2 ? 4 : 0;
  composer.renderTarget1.samples = samples;
  composer.renderTarget2.samples = samples;

  // Profundidad de la escena como textura: la lee la niebla volumetrica
  // (mist.js) para saber donde acaba cada rayo. Hace falta en los dos
  // buffers porque el composer los alterna entre frames.
  composer.renderTarget1.depthTexture = new DepthTexture(size.x, size.y);
  composer.renderTarget2.depthTexture = new DepthTexture(size.x, size.y);

  const renderPass = new RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bokehPass = new BokehPass(scene, camera, {
    focus,
    aperture,
    maxblur,
  });
  composer.addPass(bokehPass);

  const bloomPass = new UnrealBloomPass(size, bloomStrength, bloomRadius, bloomThreshold);
  composer.addPass(bloomPass);

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  const finishPass = new ShaderPass(FinishShader);
  composer.addPass(finishPass);

  let dofEnabled = true;

  return {
    composer,
    bloomPass,
    bokehPass,

    /** Inserta un pase justo despues del render de la escena (antes del DOF). */
    addSceneEffect(pass) {
      composer.insertPass(pass, 1);
    },

    setSize(width, height) {
      composer.setSize(width, height);
      bloomPass.setSize(width, height);
    },

    setDofEnabled(enabled) {
      dofEnabled = enabled;
      bokehPass.enabled = enabled;
    },

    isDofEnabled: () => dofEnabled,

    /** Enfoque suave siguiendo la distancia al sujeto central. */
    setFocus(distance) {
      bokehPass.uniforms.focus.value = distance;
    },

    setBloom(strength, radius, threshold) {
      bloomPass.strength = strength;
      if (radius !== undefined) bloomPass.radius = radius;
      if (threshold !== undefined) bloomPass.threshold = threshold;
    },

    render(dt = 0) {
      finishPass.uniforms.uTime.value += dt;
      composer.render();
    },

    dispose() {
      composer.dispose();
      bokehPass.dispose();
      bloomPass.dispose();
    },
  };
}
