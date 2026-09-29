/**
 * Texturas procedurales para dar aspecto PBR a la escena.
 *
 * Todas se generan en un `<canvas>` en tiempo de carga: cero assets, cero
 * peticiones. Este módulo es **el punto de sustitución por imágenes de
 * ComfyUI**: si más adelante se generan texturas fuera, se cambia el cuerpo de
 * estas funciones por `new TextureLoader().load('ruta')` y el resto de la
 * escena no cambia, porque todas las escenas consumen texturas con la misma
 * interfaz (map, roughnessMap, normalMap).
 */

import { CanvasTexture, RepeatWrapping, SRGBColorSpace, TextureLoader } from 'three';

const cache = new Map();

/**
 * Comprobación de availability de una textura generada por ComfyUI.
 *
 * `HEAD` evita descargar el fichero si no esta. Las texturas procedurales
 * siguen siendo el plan A: si ComfyUI no se ha ejecutado, la app se ve igual,
 * solo que con menos detalle.
 */
const available = new Map();
async function exists(url) {
  if (available.has(url)) return available.get(url);
  try {
    const res = await fetch(url, { method: 'HEAD' });
    const ok = res.ok;
    available.set(url, ok);
    return ok;
  } catch {
    available.set(url, false);
    return false;
  }
}

/**
 * Devuelve una textura generada por ComfyUI si existe, o null.
 * @param {string} name nombre de fichero en public/textures
 */
export async function comfyTexture(name, { srgb = false } = {}) {
  const url = `textures/${name}`;
  if (!(await exists(url))) return null;
  const texture = await new TextureLoader().loadAsync(url);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Canvas 2D con tamaño fijo, listo para pintar. */
function surface(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return { canvas, ctx: canvas.getContext('2d') };
}

/** Ruido de valor con interpolación suave, determinista por semilla. */
function valueNoise(seed) {
  const perm = new Uint8Array(512);
  let state = seed >>> 0 || 1;
  const next = () => {
    // LCG: misma semilla, mismo ruido. Evita Math.random (no reproducible).
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];

  const fade = (t) => t * t * (3 - 2 * t);
  const grad = (h) => (h & 1 ? 1 : -1) * (0.5 + (h & 7) / 14);

  return function noise2D(x, y) {
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
}

/** Suma de octavas: el detalle fino hace que la superficie parezca real. */
function fbm(noise, x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x * frequency, y * frequency) * amplitude;
    total += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / total; // normalizado a ~[-1, 1]
}

/**
 * Convierte un mapa de alturas (escala de grises) en un mapa de normales.
 * Es lo que da la sensación de relieve real bajo una luz rasante.
 */
function normalFromHeight(height, size, strength = 2.4) {
  const { canvas, ctx } = surface(size);
  const img = ctx.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sobel: la dirección de la pendiente da la normal.
      const dx =
        at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1) -
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1));
      const dy =
        at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1) -
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1));

      const nx = dx * strength;
      const ny = dy * strength;
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

function finish(canvas, { repeat = 1, srgb = false } = {}) {
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  // Las mapas de color van en sRGB; los de rugosidad y normales, en lineal.
  if (srgb) texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Chapa metálica industrial: rugosidad irregular con manchas de desgaste.
 * @returns {{roughnessMap: Texture, normalMap: Texture}}
 */
export function metalSurface({ size = 512, repeat = 4, seed = 7 } = {}) {
  const key = `metal-${size}-${seed}`;
  if (cache.has(key)) return cache.get(key);

  const noise = valueNoise(seed);
  const height = new Float32Array(size * size);
  const { canvas: roughCanvas, ctx: roughCtx } = surface(size);
  const rough = roughCtx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 6;
      const v = (y / size) * 6;
      const grain = fbm(noise, u, v, 5);
      const scratches = fbm(noise, u * 9, v * 0.6, 3) * 0.35;
      const h = grain + scratches;
      height[y * size + x] = h;

      // Las zonas pulidas (hundidas) son más brillantes -> menor rugosidad.
      const r = Math.min(1, Math.max(0, 0.62 - h * 0.45));
      const i = (y * size + x) * 4;
      const value = r * 255;
      rough.data[i] = value;
      rough.data[i + 1] = value;
      rough.data[i + 2] = value;
      rough.data[i + 3] = 255;
    }
  }
  roughCtx.putImageData(rough, 0, 0);

  const result = {
    roughnessMap: finish(roughCanvas, { repeat }),
    normalMap: finish(normalFromHeight(height, size), { repeat }),
  };
  cache.set(key, result);
  return result;
}

/**
 * Suelo del laboratorio: placas metálicas con juntas, rejilla y desgaste.
 * El albedo va en sRGB; el resto en lineal.
 */
export function labFloor({ size = 1024, repeat = 10, seed = 21 } = {}) {
  const key = `floor-${size}-${seed}`;
  if (cache.has(key)) return cache.get(key);

  const noise = valueNoise(seed);
  const { canvas, ctx } = surface(size);
  const { canvas: roughCanvas, ctx: roughCtx } = surface(size);
  const rough = roughCtx.createImageData(size, size);
  const height = new Float32Array(size * size);

  const cell = size / 4; // 4x4 placas por textura
  const joint = size * 0.006;

  const img = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * 8;
      const v = (y / size) * 8;
      const grain = fbm(noise, u, v, 5);
      const wear = Math.max(0, fbm(noise, u * 0.35, v * 0.35, 3)) * 0.6;

      // Distancia a la junta más cercana: define la placa.
      const gx = Math.min(x % cell, cell - (x % cell));
      const gy = Math.min(y % cell, cell - (y % cell));
      const edge = Math.min(gx, gy);
      const isJoint = edge < joint;

      // Variación de tono por placa para que el suelo no sea uniforme.
      const plateX = Math.floor(x / cell);
      const plateY = Math.floor(y / cell);
      const plateTone = (valueNoise(seed + plateX * 31 + plateY * 17)(plateX * 0.7, plateY * 0.3) + 1) / 2;

      const base = 0.10 + plateTone * 0.035 + grain * 0.03 + wear * 0.05;
      const i = (y * size + x) * 4;
      const c = isJoint ? base * 0.35 : base;
      img.data[i] = c * 255 * 1.0;
      img.data[i + 1] = c * 255 * 1.08;
      img.data[i + 2] = c * 255 * 1.2;
      img.data[i + 3] = 255;

      // La junta es rugosa; la placa pulida por el tránsito.
      const r = isJoint ? 0.95 : 0.35 + wear * 0.4 + Math.abs(grain) * 0.2;
      const value = Math.min(1, Math.max(0, r)) * 255;
      rough.data[i] = value;
      rough.data[i + 1] = value;
      rough.data[i + 2] = value;
      rough.data[i + 3] = 255;

      height[y * size + x] = isJoint ? -1 : grain * 0.25 + wear * 0.15;
    }
  }

  ctx.putImageData(img, 0, 0);
  roughCtx.putImageData(rough, 0, 0);

  const result = {
    map: finish(canvas, { repeat, srgb: true }),
    roughnessMap: finish(roughCanvas, { repeat }),
    normalMap: finish(normalFromHeight(height, size, 3.2), { repeat }),
  };
  cache.set(key, result);
  return result;
}

/**
 * Panel de pared con juntas horizontales y tornillos.
 * Principalmente aporta rugosidad y relieve; el color va en el material.
 */
export function wallPanels({ size = 512, repeat = 6, seed = 33 } = {}) {
  const key = `wall-${size}-${seed}`;
  if (cache.has(key)) return cache.get(key);

  const noise = valueNoise(seed);
  const { canvas: roughCanvas, ctx: roughCtx } = surface(size);
  const rough = roughCtx.createImageData(size, size);
  const height = new Float32Array(size * size);

  const bands = 4;
  const bandH = size / bands;
  const joint = size * 0.004;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inBand = y % bandH;
      const nearJoint = inBand < joint || inBand > bandH - joint;

      // Tornillos en las esquinas de cada panel.
      const bandIndex = Math.floor(y / bandH);
      const holeX = size * 0.06;
      const screw =
        Math.hypot(x - holeX, inBand - bandH * 0.5) < size * 0.012 ? 1 : 0;

      const grain = fbm(noise, (x / size) * 5, (y / size) * 5, 4);
      const r = nearJoint || screw ? 0.9 : 0.45 + grain * 0.25;
      const i = (y * size + x) * 4;
      const value = Math.min(1, Math.max(0, r)) * 255;
      rough.data[i] = value;
      rough.data[i + 1] = value;
      rough.data[i + 2] = value;
      rough.data[i + 3] = 255;

      height[y * size + x] = nearJoint ? -1 : screw ? -0.6 : grain * 0.2;
    }
  }
  roughCtx.putImageData(rough, 0, 0);

  const result = {
    roughnessMap: finish(roughCanvas, { repeat }),
    normalMap: finish(normalFromHeight(height, size, 2.6), { repeat }),
  };
  cache.set(key, result);
  return result;
}

/**
 * Mejora los materiales de la sala con texturas de ComfyUI cuando existen.
 *
 * No bloquea el arranque: la escena se construye con las texturas
 * procedurales y se actualiza en cuanto llegan las imágenes. Así la app
 * funciona igual sin ComfyUI, solo que con menos detalle.
 *
 * ComfyUI devuelve un PNG de color (albedo). El normal map y el mapa de
 * rugosidad se **derivan en cliente** con el mismo Sobel que usan las
 * texturas procedurales: usar el PNG de color directamente como normalMap
 * daría una superficie irreconocible.
 *
 * @param {object} materials materiales a mejorar, por clave
 * @returns {Promise<string[]>} claves efectivamente actualizadas
 */
export async function upgradeWithComfy(materials) {
  const updated = [];
  const loader = new TextureLoader();

  for (const [key, material] of Object.entries(materials)) {
    const spec = COMFY_MAPS[key];
    if (!spec || !material) continue;
    const url = `textures/${spec.file}`;
    if (!(await exists(url))) continue;

    try {
      const map = await loader.loadAsync(url);
      // Cualquier textura generada por IA tiene bordes que no encajan. El
      // espejado garantiza que la superficie es tileable sin depender de que
      // el modelo acierte: en un material con grano la simetria no se percibe.
      const tiled = mirrorTile(map.image, spec.flip ? 2 : 1);
      map.image = tiled;
      map.needsUpdate = true;

      map.wrapS = RepeatWrapping;
      map.wrapT = RepeatWrapping;
      // Sin esto la textura se estira sobre toda la superficie y el detalle se
      // magnifica hasta quedar liso: parecia que la textura desaparecia.
      map.repeat.set(spec.repeat ?? 1, spec.repeat ?? 1);
      map.colorSpace = SRGBColorSpace;
      map.anisotropy = 8;

      // Derivar relieve y rugosidad a partir del albedo ya espejado.
      const { normalMap, roughnessMap } = deriveMaps(tiled, key);
      // Los mapas derivados nacen con repeat 1: hay que igualarlos al del
      // albedo o el relieve quedaria estirado sobre toda la superficie.
      for (const t of [normalMap, roughnessMap]) {
        t.wrapS = RepeatWrapping;
        t.wrapT = RepeatWrapping;
        t.repeat.set(spec.repeat ?? 1, spec.repeat ?? 1);
        t.anisotropy = 8;
      }

      material.map = map;
      material.normalMap = normalMap;
      material.roughnessMap = roughnessMap;
      material.needsUpdate = true;
      updated.push(key);
    } catch (err) {
      console.warn(`[textures] no se pudo aplicar "${key}":`, err);
    }
  }

  return updated;
}

/**
 * Espeja la imagen en espejo Siegel para que sea tileable.
 *
 * `w` y `h` son divisores: la textura se repite 2x, 3x... creando un patron
 * periodico. Con material de grano (metal, chapa) la simetria pasa
 * desapercibida; sin ella, la costura de la IA se ve a simple vista.
 */
function mirrorTile(image, divisions = 2) {
  const w = image.width;
  const h = image.height;
  const out = document.createElement('canvas');
  out.width = w * divisions;
  out.height = h * divisions;
  const ctx = out.getContext('2d');

  for (let y = 0; y < divisions; y++) {
    for (let x = 0; x < divisions; x++) {
      // Alternar el espejo en cada eje produce una simetria de piso, no de
      // unas Sims, que es lo que hace que el resultado parezca una baldosa.
      ctx.save();
      ctx.translate(x * w, y * h);
      ctx.scale(x % 2 === 0 ? 1 : -1, y % 2 === 0 ? 1 : -1);
      ctx.translate(x % 2 === 0 ? 0 : -w, y % 2 === 0 ? 0 : -h);
      ctx.drawImage(image, 0, 0);
      ctx.restore();
    }
  }
  return out;
}

/** Deriva normal + rugosidad de una imagen de albedo ya cargada. */
function deriveMaps(image, key) {
  const size = Math.min(512, image.width);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, size, size);

  const { data } = ctx.getImageData(0, 0, size, size);
  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    // Luminancia como altura aproximada.
    const j = i * 4;
    height[i] = (data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114) / 255 - 0.5;
  }

  // Strength bajo a proposito: la luminancia de una textura fotorrealista
  // varia mucho, y con un factor alto el Sobel produce normales extremas que
  // hacen que una placa metalica se lea como agua en movimiento.
  const normalMap = finish(normalFromHeight(height, size, 0.35));

  // Rugosidad: zonas oscuras = más brillo = más pulido. Se invierte para que
  // el brillo especular caiga donde hay detalle y no en las zonas planas.
  const rCanvas = document.createElement('canvas');
  rCanvas.width = size;
  rCanvas.height = size;
  const rCtx = rCanvas.getContext('2d');
  const img = rCtx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.min(255, Math.max(0, (0.75 - height[i] * 0.9) * 255));
    const j = i * 4;
    img.data[j] = v;
    img.data[j + 1] = v;
    img.data[j + 2] = v;
    img.data[j + 3] = 255;
  }
  rCtx.putImageData(img, 0, 0);

  return { normalMap, roughnessMap: finish(rCanvas) };
}

/** Qué fichero de public/textures mapea a cada material. */
const COMFY_MAPS = {
  wall: { file: 'wall_panel.png', flip: 1, repeat: 8 },
  pillar: { file: 'pillar_metal.png', flip: 1, repeat: 3 },
  panel: { file: 'panel_dark.png', flip: 1, repeat: 2 },
};

/** Libera las texturas cacheadas (llamar en `dispose`). */
export function disposeTextures() {
  for (const entry of cache.values()) {
    for (const texture of Object.values(entry)) texture.dispose?.();
  }
  cache.clear();
}
