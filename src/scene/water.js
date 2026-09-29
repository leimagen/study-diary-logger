/**
 * Fuente bajo el reactor.
 *
 * Circulo pequeno de agua con movimiento de fluido. Usa `Reflector`, que
 * renderiza la escena desde una camara especular: el reflejo es real, y al
 * ser pequeno y estar justo bajo el reactor, lo que se refleja es el reactor.
 *
 * El pavement mojado del resto de la sala NO usa Reflector: lo hace el
 * motor PBR con rugosidad variable. Un espejo grande devolvia imagenes
 * nitidas de los aros del techo en forma de franjas duras.
 */

import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Texture,
} from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

/** fbm 2D determinista (LCG) para el oleaje. */
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

  return (x, y, octaves = 4) => {
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
 * Normal map de oleaje: ondas concentricas que se abren desde el centro
 * (como una fuente) mas rizado superficial. La pendiente sale del campo de
 * altura por diferencias centrales.
 */
function rippleNormalTexture(size = 256) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const fbm = fbm2(91);

  const height = (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2;
    // Anillos que nacen en el centro y se propagan hacia fuera.
    const rings = Math.sin(d * 22 - 0.4) * 0.5 + 0.5;
    // Rizado fino encima.
    const chop = fbm(u * 7, v * 7, 4) * 0.35;
    return rings * 0.55 + chop;
  };

  const e = 1 / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const dx = (height(u + e, v) - height(u - e, v)) / (2 * e);
      const dy = (height(u, v + e) - height(u, v - e)) / (2 * e);

      const nx = -dx * 0.0009;
      const ny = -dy * 0.0009;
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

export function createFountain({ radius = 3.4, y = 0.03 } = {}) {
  const canvas = rippleNormalTexture();
  const ripples = new Texture(canvas);
  ripples.wrapS = RepeatWrapping;
  ripples.wrapT = RepeatWrapping;
  ripples.colorSpace = SRGBColorSpace;
  ripples.anisotropy = 8;
  ripples.needsUpdate = true;

  const reflector = new Reflector(new CircleGeometry(radius, 64), {
    textureWidth: 1024,
    textureHeight: 1024,
    color: 0xaac4d8,
    clipBias: 0.003,
  });
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.y = y;

  reflector.material.onBeforeCompile = (shader) => {
    shader.uniforms.uRipples = { value: ripples };
    shader.uniforms.uTime = { value: 0 };
    // El vUv deformado se calcula ANTES de la muestreo y se usa despues.
    // Envolver la expresion en llaves no vale: en GLSL un bloque no es una
    // expresion.
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      `
      uniform sampler2D uRipples;
      uniform float uTime;
      void main() {
        // vUv es vec4 proyectado: xy/w son las coordenadas planas.
        vec2 puv = vUv.xy / max(vUv.w, 0.0001);
        // Dos capas de oleaje a distinta velocidad y escala.
        vec2 uv1 = puv * 2.2 + vec2(0.0, uTime * 0.035);
        vec2 uv2 = puv * 4.7 - vec2(uTime * 0.021, uTime * 0.017);
        vec3 n1 = texture2D(uRipples, uv1).rgb * 2.0 - 1.0;
        vec3 n2 = texture2D(uRipples, uv2).rgb * 2.0 - 1.0;
        vec2 warp = (n1.xy * 0.5 + n2.xy * 0.3) * 0.012;
        // Mas rizado en el borde, como si el agua chocara con la piedra.
        float edge = smoothstep(0.25, 0.5, length(puv - 0.5));
        warp *= 1.0 + edge * 1.6;
        vec4 vUvWarped = vec4(vUv.xy + warp * vUv.w, vUv.zw);
      `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      /texture2DProj\(\s*tDiffuse\s*,\s*vUv\s*\)/g,
      'texture2DProj(tDiffuse, vUvWarped)',
    );
    // uTime se actualiza desde update(); se guarda la referencia del uniform.
    reflector.userData.shader = shader;
  };
  reflector.material.needsUpdate = true;

  // Brocal: anillo de piedra. Un disco opaco taparia el agua; hace falta un
  // anillo con hueco central.
  const rim = new Mesh(
    new RingGeometry(radius, radius * 1.09, 64),
    new MeshBasicMaterial({ color: new Color(0x1a2b36) }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = y + 0.002;

  // Brillo de la superficie: pequeños puntos que se mueven con el oleaje.
  const sparkle = new Mesh(
    new CircleGeometry(radius * 0.96, 64),
    new MeshBasicMaterial({
      color: new Color(0x3d7a96),
      transparent: true,
      opacity: 0.1,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  sparkle.rotation.x = -Math.PI / 2;
  sparkle.position.y = y + 0.004;

  const group = new Group();
  group.add(reflector, rim, sparkle);

  let time = 0;
  return {
    group,
    reflector,
    update(dt) {
      time += dt;
      const shader = reflector.userData.shader;
      if (shader) shader.uniforms.uTime.value = time;
      sparkle.material.opacity = 0.08 + Math.sin(time * 1.1) * 0.025;
    },
    dispose() {
      ripples.dispose();
      reflector.dispose?.();
    },
  };
}
