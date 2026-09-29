/**
 * Pipeline de post-procesado: depth of field + bloom + tone mapping.
 *
 * El DOF (BokehPass) re-renderiza la escena para el mapa de profundidad, así
 * que cuesta el doble. Por eso se puede desactivar; el bloom es barato.
 */

import { Vector2, HalfFloatType } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export function createPostFX(renderer, scene, camera, options = {}) {
  const {
    // Radius alto difunde el brillo por media pantalla: el reactor se comia el
    // centro de la imagen. Threshold alto evita que todo lo emisivo florezca.
    bloomStrength = 0.15,
    bloomRadius = 0.1,
    bloomThreshold = 0.95,
    focus = 14,
    // Apertura y maxblur altos emborronaban media escena: la falta de nitidez
    // se leia como "pixelado" aunque el canvas fuese nativo.
    aperture = 0.00006,
    maxblur = 0.006,
  } = options;

  const size = renderer.getSize(new Vector2());

  const composer = new EffectComposer(renderer);
  // HalfFloat mantiene el rango HDR necesario para que el bloom no se recorte.
  composer.renderTarget1.texture.type = HalfFloatType;
  composer.renderTarget2.texture.type = HalfFloatType;

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

  let dofEnabled = true;

  return {
    composer,
    bloomPass,
    bokehPass,

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

    render() {
      composer.render();
    },

    dispose() {
      composer.dispose();
      bokehPass.dispose();
      bloomPass.dispose();
    },
  };
}
