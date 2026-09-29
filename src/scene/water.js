/**
 * Pavimento mojado bajo el reactor.
 *
 * La intencion no es un charco perfecto, sino un suelo de placas con agua
 * irregular: zonas secas mates y charcos que reflejan. Se consigue con
 * tres capas sobre el suelo existente:
 *
 *   1. un mapa de "mojadez" procedural (fbm) que decide donde hay agua
 *   2. un `Reflector` real para el reflejo, y su fragment shader se modifica
 *      para (a) deformar la muestreo con un normal map de ondas y (b) modular
 *      intensidad y opacidad con la Mojadez
 *   3. un normal map de ondas concentricas
 *
 * El reflejo es real: `Reflector` renderiza la escena desde una camara
 * especular, no la simula con un mapa de entorno.
 */

import {
  AdditiveBlending,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
} from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

/* ------------------------------------------------------------------ */
/* Mapas procedurales                                                 */
/* ------------------------------------------------------------------ */

/** fbm 2D con LCG, para que sea reproducible. */
function fbm2(seed) {
  const perm = new Uint8Array(512);
  let state = seed >>> 0 || 1;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];

  const fade = (t) => t * t * (3 - 2 * t);
  const grad = (h) => (h & 1 ? 1 : -1) * (0.5 + (h & 7) / 14);

  const noise = (x, y) => {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[xi] + yi];
    const ab = perm[perm[xi] + yi + 1];
    const ba = perm[perm[xi + 1] + yi];
    const bb = perm[perm[xi + 1] + yi + 1];
    const x1 = grad(aa) * xf + grad(ba) * (1 - xf);
    const x2 = grad(ab) * xf + grad(bb) * (1 - xf);
    return x1 * v + x2 * (1 - v);
  };

  return (x, y, octaves = 5) => {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let total = 0;
    for (let i = 0; i < octaves; i++) {
      sum += noise(x * freq, y * freq) * amp;
      total += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / total;
  };
}

/**
 * Mojadez: 1 = charco (espejo), 0 = seco (mate).
 * Cuencas Broad, no manchas redondas: asi aparecen bolsas de agua entre las
 * juntas del pavement, como en la referencia.
 */
function wetnessTexture(size = 512, seed = 19) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const fbm = fbm2(seed);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 3.2;
      const v = (y / size) * 3.2;

      // Base de cuencas grandes.
      let n = fbm(u, v, 5) * 0.5 + 0.5;
      // Detalle fino: rompe el borde de las bolsas.
      n = n * 0.78 + (fbm(u * 5, v * 5, 4) * 0.5 + 0.5) * 0.22;

      // Contraste fuerte: la mayoria del suelo queda seco y solo quedan
      // bolsasmojadas bien definidas.
      const wet = Math.max(0, Math.min(1, (n - 0.44) / 0.3));

      const i = (y * size + x) * 4;
      const value = wet * 255;
      img.data[i] = value;
      img.data[i + 1] = value;
      img.data[i + 2] = value;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** Ondas de la superficie del agua: rizado fino mas laansion suave. */
function rippleNormalTexture(size = 512) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const fbm = fbm2(77);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 6;
      const v = (y / size) * 6;
      // Dos escalas de rizado. La pendiente sale del propio campo.
      const e = 0.02;
      const h = (a, b) =>
        fbm(a, b, 4) * 0.6 + Math.sin(a * 14 + b * 9) * 0.2;
      const dx = (h(u + e, v) - h(u - e, v)) / (2 * e);
      const dy = (h(u, v + e) - h(u, v - e)) / (2 * e);

      const nx = -dx * 0.16;
      const ny = -dy * 0.16;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);

      const i = (y * size + x) * 4;
      img.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function toTexture(canvas, { srgb = false, repeat = 1 } = {}) {
  const t = new Texture(canvas);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/* ------------------------------------------------------------------ */
/* Componente                                                         */
/* ------------------------------------------------------------------ */

export function createWaterPuddle({ size = 26, y = 0.015, intensity = 1 } = {}) {
  const wetness = toTexture(wetnessTexture(), { repeat: 1 });
  const ripples = toTexture(rippleNormalTexture(), { repeat: 1 });

  // Reflector sobre un plano amplio, no un disco: el agua se reparte por el
  // pavement y la mascara decide que parte queda mojada.
  const reflector = new Reflector(new PlaneGeometry(size, size), {
    textureWidth: 1024,
    textureHeight: 1024,
    color: 0x9fc4e0,
    clipBias: 0.004,
  });
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.y = y;
  reflector.material.transparent = true;
  reflector.material.depthWrite = false;

  reflector.material.onBeforeCompile = (shader) => {
    // El Reflector no expone la posicion en el plano: hace falta para
    // muestrear los mapas con repeat sin depender de la proyeccion.
    shader.vertexShader = 'varying vec3 vLocalPos;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      'void main() {\n  vLocalPos = position;',
    );

    shader.uniforms.uWetness = { value: wetness };
    shader.uniforms.uRipples = { value: ripples };
    shader.uniforms.uIntensity = { value: intensity };

    // El Reflector declara vUv como vec4 proyectado. Para muestrear con
    // repeat hay que deshacer la proyeccion (xy/w) y pasar a coordenadas de
    // objeto con uv plano.
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `
      uniform sampler2D uWetness;
      uniform sampler2D uRipples;
      uniform float uIntensity;
      varying vec3 vLocalPos;
      void main() {
      `,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      /gl_FragColor\s*=\s*vec4\([^;]*\);/,
      `
      vec2 flatUv = vLocalPos.xz / ${size.toFixed(1)} + 0.5;
      float wet = texture2D(uWetness, flatUv).r;

      // Las ondas desplazan la muestra del reflejo: es lo que convierte un
      // espejo plano en agua. Solo dentro del charco.
      vec3 ripple = texture2D(uRipples, flatUv * 2.5).rgb * 2.0 - 1.0;
      vec2 projected = vUv.xy / max(vUv.w, 0.0001);
      vec2 distorted = projected + ripple.xy * 0.018 * wet * uIntensity;

      // El Reflector ya declara una variable llamada base: hay que
      // nombrarla de otra forma o el shader no compila.
      vec4 warped = vec4(texture2DProj(tDiffuse, vec4(distorted, vUv.zw)).rgb, 1.0);

      // Bordes de las bolsas algo mas brillantes: el menisco mojado.
      float rim = smoothstep(0.06, 0.16, wet) * (1.0 - smoothstep(0.16, 0.34, wet));
      vec3 water = blendOverlay(warped.rgb, color);
      water += color * rim * 0.45 * uIntensity;
      // Zonas secas: casi transparente, se ve el pavement de debajo.
      float alpha = smoothstep(0.10, 0.30, wet) * 0.92;
      if (alpha <= 0.01) discard;
      gl_FragColor = vec4(water, alpha);
      `,
    );
  };
  reflector.material.needsUpdate = true;

  // Brillo residual encima: da el punto de luz sobre el agua mojada.
  const sheen = new Mesh(
    new PlaneGeometry(size, size),
    new MeshBasicMaterial({
      color: new Color(0x2a6a8a),
      transparent: true,
      opacity: 0.05,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  sheen.rotation.x = -Math.PI / 2;
  sheen.position.y = y + 0.003;

  reflector.add(sheen);

  let time = 0;
  return {
    group: reflector,
    reflector,
    update(dt) {
      time += dt;
      // El agua respira: el rizado no esta nunca del todo quieto.
      ripples.offset.set(Math.sin(time * 0.05) * 0.02, time * 0.012);
    },
    dispose() {
      wetness.dispose();
      ripples.dispose();
      reflector.dispose?.();
    },
  };
}
