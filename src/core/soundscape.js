/**
 * Paisaje sonoro: traducciones puras de estado a parámetros de audio.
 *
 * Sin Web Audio ni DOM: aquí solo se decide cuánto y cómo suena cada cosa, y
 * se puede testear en Node. El motor de audio (scene/audio.js) aplica estos
 * valores a sus nodos.
 */

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * Zumbido del reactor según su energía (0..1, derivada de la racha).
 * Sube de tono muy poco y de volumen algo más: debe notarse que la racha lo
 * alimenta sin llegar nunca a molestar.
 * @returns {{freq: number, gain: number, cutoff: number}}
 */
export function reactorHum(energy) {
  const e = clamp01(energy);
  return {
    freq: 48 + e * 7,
    gain: 0.025 + e * 0.03,
    // Con más energía se abre el filtro y aparecen armónicos.
    cutoff: 220 + e * 480,
  };
}

/**
 * Viento según la velocidad de una corriente (unidades de escena por
 * segundo, ~0..0.6). Por debajo de un umbral no suena: la calma es silencio.
 * @returns {{gain: number, freq: number}}
 */
export function windVoice(speed) {
  const s = clamp01((speed - 0.05) / 0.5);
  return {
    gain: s * s * 0.07,
    // Las ráfagas fuertes silban más agudo.
    freq: 280 + s * 700,
  };
}

/**
 * Gota que cae al agua. Una gota real suena por la burbuja que atrapa: un
 * tono corto que sube de frecuencia al cerrarse. Gotas más grandes, más
 * graves y más fuertes.
 *
 * @param {number} amplitude fuerza del impacto en la simulación (~0.02..0.5)
 * @param {number} radius radio del impacto en metros (~0.05..0.3)
 * @param {() => number} [random] fuente de aleatoriedad (inyectable en tests)
 * @returns {{startFreq: number, endFreq: number, duration: number, gain: number}}
 */
export function dropVoice(amplitude, radius, random = Math.random) {
  const size = clamp01(radius / 0.3);
  const startFreq = 1700 - size * 900 + (random() - 0.5) * 300;
  return {
    startFreq,
    endFreq: startFreq * (1.5 + random() * 0.6),
    duration: 0.06 + size * 0.08,
    // Claramente por encima del fondo: la gota es el sonido protagonista.
    gain: clamp01(Math.abs(amplitude) / 0.45) * 0.5,
  };
}

/**
 * Paneo estéreo de una corriente de viento: su dirección proyectada sobre el
 * eje derecho de la cámara. -1 izquierda, 1 derecha.
 */
export function windPan(dirX, dirZ, rightX, rightZ) {
  const len = Math.hypot(dirX, dirZ);
  if (len === 0) return 0;
  return Math.max(-1, Math.min(1, ((dirX * rightX + dirZ * rightZ) / len) * 0.7));
}

/* ------------------------------------------------------------------ */
/* Distancia                                                          */
/* ------------------------------------------------------------------ */

/**
 * Absorción del aire: cuanto más lejos está una fuente, menos agudos llegan
 * del sonido directo. Frecuencia de corte del filtro paso bajo, en Hz.
 */
export function airCutoff(distance) {
  return 18000 / (1 + Math.max(0, distance) / 6);
}

/**
 * Envío a la reverberación según la distancia. En una sala el sonido directo
 * cae con la distancia, pero la cola llena todo el espacio y apenas cambia:
 * de lejos se oye sobre todo el eco. Por eso el envío es casi constante (sube
 * un poco lejos) y NO pasa por la atenuación del directo.
 */
export function reverbSend(distance, base) {
  return base * (0.55 + 0.45 * clamp01(distance / 30));
}

/* ------------------------------------------------------------------ */
/* Radio                                                              */
/* ------------------------------------------------------------------ */

/**
 * Formantes (F1, F2, F3 en Hz) de cinco vocales. La voz de la radio encadena
 * sílabas eligiendo una vocal cada vez: suena a habla sin decir nada.
 */
export const VOWELS = {
  a: [800, 1150, 2900],
  e: [400, 1700, 2600],
  i: [300, 2200, 3000],
  o: [450, 800, 2830],
  u: [325, 700, 2530],
};

const MORSE = {
  a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....',
  i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.',
  q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-',
  y: '-.--', z: '--..',
};

/**
 * Secuencia de morse para un texto: pares [encendido, unidades]. Punto 1,
 * raya 3; silencio de 1 entre símbolos, 3 entre letras, 7 entre palabras.
 * @returns {Array<[boolean, number]>}
 */
export function morseSequence(text) {
  const out = [];
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  words.forEach((word, wi) => {
    [...word].forEach((letter, li) => {
      const code = MORSE[letter];
      if (!code) return;
      [...code].forEach((symbol, si) => {
        out.push([true, symbol === '.' ? 1 : 3]);
        if (si < code.length - 1) out.push([false, 1]);
      });
      if (li < word.length - 1) out.push([false, 3]);
    });
    if (wi < words.length - 1) out.push([false, 7]);
  });
  return out;
}
