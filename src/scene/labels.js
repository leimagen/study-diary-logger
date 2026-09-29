/**
 * Etiquetas de texto flotantes generadas con CanvasTexture.
 *
 * Evita depender de fuentes 3D (necesitan un loader) y permite reetiquetar
 * cualquier objeto dinámicamente, que es justo lo que necesitamos aquí.
 */

import { CanvasTexture, LinearFilter, Sprite, SpriteMaterial, SRGBColorSpace } from 'three';

const FONT_STACK = '"Segoe UI", "Inter", system-ui, sans-serif';

/**
 * Crea un sprite con texto.
 * @param {string} text
 * @param {{color?: string, background?: string, size?: number, weight?: number}} options
 */
export function createLabel(text, options = {}) {
  const {
    color = '#d8f6ff',
    background = 'rgba(6, 18, 28, 0.72)',
    fontSize = 44,
    weight = 600,
    padding = 22,
    borderColor = 'rgba(53, 214, 255, 0.5)',
  } = options;

  const measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  const font = `${weight} ${fontSize}px ${FONT_STACK}`;
  ctx.font = font;

  const metrics = ctx.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  const width = textWidth + padding * 2;
  const height = fontSize + padding * 1.4;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext('2d');

  // Fondo con esquinas redondeadas.
  const radius = height * 0.28;
  c.beginPath();
  roundRect(c, 0.5, 0.5, width - 1, height - 1, radius);
  c.fillStyle = background;
  c.fill();
  if (borderColor) {
    c.strokeStyle = borderColor;
    c.lineWidth = 2;
    c.stroke();
  }

  // Texto centrado.
  c.font = font;
  c.fillStyle = color;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, width / 2, height / 2 + 1);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.generateMipmaps = false;

  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const sprite = new Sprite(material);

  // Escala en unidades de mundo: ~0.0038 por píxel de textura.
  const scale = 0.0038;
  sprite.scale.set(width * scale, height * scale, 1);
  sprite.userData.aspect = width / height;
  sprite.userData.text = text;

  return sprite;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
