/**
 * Charco de agua bajo el reactor.
 *
 * Usa `Reflector`, que renderiza la escena desde una camara especular en un
 * render target: el reflejo del reactor es de verdad, no una aproximacion con
 * un mapa de entorno. Encima se anade una capa con ondas y mascara radial,
 * para que la forma sea un charco y no un disco.
 */

import {
  AdditiveBlending,
  CircleGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
} from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';

export function createWaterPuddle({ radius = 5.2, y = 0.02 } = {}) {
  const group = new Group();

  // Capa 1: el reflejo real del reactor.
  const reflector = new Reflector(new CircleGeometry(radius, 64), {
    textureWidth: 1024,
    textureHeight: 1024,
    color: 0x88aacc,
    clipBias: 0.003,
  });
  reflector.rotation.x = -Math.PI / 2;
  reflector.position.y = y;
  applyRadialMask(reflector, radius);
  group.add(reflector);

  // Capa 2: brillo superficial y ondas por encima del reflejo.
  const sheen = new Mesh(
    new CircleGeometry(radius * 0.98, 64),
    new MeshBasicMaterial({
      color: new Color(0x1a4a66),
      transparent: true,
      opacity: 0.14,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  sheen.rotation.x = -Math.PI / 2;
  sheen.position.y = y + 0.004;
  group.add(sheen);

  let time = 0;

  return {
    group,
    reflector,
    update(dt) {
      time += dt;
      // Respiracion muy lenta del reflejo: el agua nunca esta del todo quieta.
      sheen.material.opacity = 0.12 + Math.sin(time * 0.5) * 0.035;
    },
    dispose() {
      reflector.dispose?.();
    },
  };
}

/**
 * Recorta el reflejo a un charco con borde irregular.
 *
 * El Reflector construye su propio ShaderMaterial opaco, asi que se le
 * inyecta una mascara radial en el fragment shader: fuera del radio el alfa
 * es 0, y el borde se modula con dos senos para que no sea un corte recto.
 */
function applyRadialMask(reflector, radius) {
  const material = reflector.material;
  material.transparent = true;
  material.depthWrite = false;

  const original = material.fragmentShader;
  const marker = original.indexOf('gl_FragColor');

  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'void main() {',
      'uniform float uRadius;\nvoid main() {',
    );
    // Se sustituye la asignacion final conservando el color ya calculado.
    shader.fragmentShader = shader.fragmentShader.replace(
      /gl_FragColor\s*=\s*vec4\([^;]*\);/,
      `
      // vUv en el Reflector es vec4 proyectado: las coordenadas del plano
      // estan en xy (divididas por w para deshacer la proyeccion).
      vec2 p = vUv.xy / max(vUv.w, 0.0001) - 0.5;
      float ang = atan(p.y, p.x);
      float d = length(p) * 2.0;
      d += sin(ang * 5.0) * 0.07 + sin(ang * 9.0) * 0.035;
      float mask = 1.0 - smoothstep(0.45, 0.98, d);
      if (mask <= 0.004) discard;
      // El agua no es negra: recoge algo de luz del suelo y brilla en el
      // borde, que es lo que delata una lamina de agua sobre metal.
      vec3 water = blendOverlay(base.rgb, color) * mask;
      water += color * 0.05 * mask;
      float edge = smoothstep(0.45, 0.92, d) * (1.0 - smoothstep(0.92, 1.0, d));
      water += color * edge * 0.45;
      gl_FragColor = vec4(water, mask);
      `,
    );
    shader.uniforms.uRadius = { value: radius };
  };
  material.needsUpdate = true;
}
