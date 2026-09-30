/**
 * Sonido de ambiente de la boveda. Todo procedural con Web Audio: sin
 * ficheros de audio.
 *
 * Capas:
 * - Tono de sala: ruido marron muy grave, el aire de un espacio cerrado.
 * - Zumbido del reactor: crece con la racha.
 * - Viento: una voz por corriente de wind.js, con su volumen, su tono y su
 *   lado (segun la direccion de la corriente respecto a la camara).
 * - Agua: chapoteo suave desde la fuente y un "plip" por cada gota o toque,
 *   en el punto exacto del impacto.
 * - Radio: un transmisor que lleva milenios emitiendo solo, junto al muro.
 *   Estatica, silbido de sintonia, una voz ininteligible y morse, con la
 *   senal que se desvanece y vuelve.
 * - Crujidos graves y lejanos de la estructura, muy de vez en cuando.
 *
 * Distancia: cada fuente con posicion es una "voz espacial" con dos caminos.
 * El directo pasa por un filtro de aire (menos agudos cuanto mas lejos) y un
 * panner que lo atenua con la distancia. El envio a la reverberacion NO pasa
 * por esa atenuacion: en una sala la cola llena el espacio y apenas cambia.
 * Asi, de cerca se oye la fuente nitida y presente; de lejos, sobre todo su
 * eco. Si el envio se tomara despues del panner, la proporcion entre directo
 * y eco seria la misma a cualquier distancia y todo sonaria igual de "cerca".
 *
 * Los parametros (cuanto y como suena cada cosa) se deciden en
 * core/soundscape.js; aqui solo se aplican.
 *
 * El navegador no deja sonar nada sin un gesto del usuario: el contexto se
 * crea en el primer `setEnabled(true)`, que debe llamarse desde un click o
 * una tecla.
 */

import { Vector3 } from 'three';
import {
  VOWELS,
  airCutoff,
  dropVoice,
  morseSequence,
  reactorHum,
  reverbSend,
  windPan,
  windVoice,
} from '../core/soundscape.js';

const MASTER_LEVEL = 0.9;
const REVERB_SECONDS = 5.5;

/** Palabras que teclea el transmisor en morse. */
const MORSE_WORDS = ['vigil', 'archive', 'sealed', 'awaken', 'record', 'hold', 'signal', 'return'];

/**
 * Respuesta al impulso de una sala de piedra: primeras reflexiones discretas
 * y una cola de ruido que decae y se oscurece (la piedra y el aire absorben
 * antes los agudos).
 */
function vaultImpulse(ctx, seconds) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(2, length, rate);
  const preDelay = Math.floor(rate * 0.025);
  const t60 = seconds * 0.85;

  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    let lowpassed = 0;
    for (let i = preDelay; i < length; i++) {
      const t = (i - preDelay) / rate;
      const decay = Math.exp((-6.9 * t) / t60);
      // El filtro se cierra con el tiempo: cola cada vez mas oscura.
      const closing = 0.2 + 0.75 * Math.min(1, t / (seconds * 0.6));
      lowpassed += (Math.random() * 2 - 1 - lowpassed) * (1 - closing);
      data[i] = lowpassed * decay;
    }
    // Primeras reflexiones: el muro a unos 30 m, el suelo, el techo.
    for (const [ms, gain] of [[18, 0.5], [41, 0.35], [67, 0.3], [95, 0.22], [131, 0.18]]) {
      const at = preDelay + Math.floor((rate * ms) / 1000) + (ch ? 37 : 0);
      if (at < length) data[at] += gain * (ch ? 0.9 : 1);
    }
  }
  return buffer;
}

/** Buffer de ruido en bucle. `brown` integra el ruido blanco: rumor grave. */
function noiseBuffer(ctx, seconds, brown = false) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (brown) {
      last = (last + white * 0.02) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = white;
    }
  }
  return buffer;
}

/** Curva de saturacion suave: el altavoz viejo de la radio. */
function softClipCurve(amount = 3) {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

/**
 * @param {{camera: import('three').Camera, reactorPosition: Vector3, fountainPosition: Vector3, radioPosition: Vector3}} options
 */
export function createSoundscape({ camera, reactorPosition, fountainPosition, radioPosition }) {
  let ctx = null;
  let enabled = false;
  let graph = null;
  let rumbleTimer = 20 + Math.random() * 30;
  let lapTarget = 0.5;
  let lapTimer = 0;

  /** Voces espaciales persistentes: se recalcula su distancia cada frame. */
  const voices = [];

  const listener = new Vector3();
  const forward = new Vector3();
  const up = new Vector3();
  const right = new Vector3();

  /* ---------------------------------------------------------------- */
  /* Utilidades de grafo                                               */
  /* ---------------------------------------------------------------- */

  function loop(buffer) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start(0, Math.random() * buffer.duration);
    return source;
  }

  /** Sonido sin posicion (tono de sala, viento): mezcla seca + eco fijo. */
  function ambient(node, wet) {
    node.connect(graph.master);
    const g = ctx.createGain();
    g.gain.value = wet;
    node.connect(g).connect(graph.reverb);
  }

  /**
   * Voz espacial: directo (aire + panner) y envio al eco sin atenuar.
   * Se conecta a `voice.input`.
   */
  function spatial(at, { refDistance = 3, rolloff = 1.3, wet = 0.5, persistent = true } = {}) {
    const input = ctx.createGain();
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.Q.value = 0.5;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = refDistance;
    pan.rolloffFactor = rolloff;
    pan.positionX.value = at.x;
    pan.positionY.value = at.y;
    pan.positionZ.value = at.z;
    input.connect(air).connect(pan).connect(graph.master);

    const send = ctx.createGain();
    input.connect(send).connect(graph.reverb);

    const voice = { input, air, send, at: at.clone(), wet };
    applyDistance(voice, true);
    if (persistent) voices.push(voice);
    return voice;
  }

  function applyDistance(voice, immediate = false) {
    const d = listener.distanceTo(voice.at);
    const cutoff = airCutoff(d);
    const wet = reverbSend(d, voice.wet);
    if (immediate) {
      voice.air.frequency.value = cutoff;
      voice.send.gain.value = wet;
    } else {
      const now = ctx.currentTime;
      voice.air.frequency.setTargetAtTime(cutoff, now, 0.15);
      voice.send.gain.setTargetAtTime(wet, now, 0.15);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Construccion                                                      */
  /* ---------------------------------------------------------------- */

  function build() {
    ctx = new AudioContext();
    camera.getWorldPosition(listener);

    const master = ctx.createGain();
    master.gain.value = 0;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 3;
    master.connect(compressor);
    compressor.connect(ctx.destination);

    const reverb = ctx.createConvolver();
    reverb.buffer = vaultImpulse(ctx, REVERB_SECONDS);
    const reverbReturn = ctx.createGain();
    reverbReturn.gain.value = 0.6;
    reverb.connect(reverbReturn);
    reverbReturn.connect(master);

    graph = { master, reverb };
    graph.white = noiseBuffer(ctx, 4);
    graph.brown = noiseBuffer(ctx, 6, true);

    /* --- Tono de sala --- */
    const room = loop(graph.brown);
    const roomFilter = ctx.createBiquadFilter();
    roomFilter.type = 'lowpass';
    roomFilter.frequency.value = 150;
    const roomGain = ctx.createGain();
    roomGain.gain.value = 0.1;
    room.connect(roomFilter).connect(roomGain);
    ambient(roomGain, 0.3);

    /* --- Reactor --- */
    const humBus = ctx.createGain();
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.Q.value = 0.7;
    const humGain = ctx.createGain();
    humGain.gain.value = 0;
    // Fundamental, segundo armonico ligeramente desafinado (batido lento) y
    // un tercero tenue: un transformador, no un tono de prueba.
    const partials = [
      ['sine', 1, 1],
      ['sine', 2.006, 0.35],
      ['triangle', 3, 0.08],
    ].map(([type, ratio, level]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      const g = ctx.createGain();
      g.gain.value = level;
      osc.connect(g).connect(humBus);
      osc.start();
      return { osc, ratio };
    });
    humBus.connect(humFilter).connect(humGain).connect(spatial(reactorPosition, { refDistance: 3, wet: 0.35 }).input);

    /* --- Viento --- */
    const winds = [0, 1, 2].map(() => {
      const source = loop(graph.white);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = 0.9;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      source.connect(band).connect(gain).connect(pan);
      ambient(pan, 0.5);
      return { band, gain, pan };
    });

    /* --- Agua: chapoteo continuo --- */
    const lap = loop(graph.white);
    const lapBand = ctx.createBiquadFilter();
    lapBand.type = 'bandpass';
    lapBand.frequency.value = 850;
    lapBand.Q.value = 1.4;
    const lapGain = ctx.createGain();
    lapGain.gain.value = 0;
    lap.connect(lapBand).connect(lapGain).connect(spatial(fountainPosition, { refDistance: 2.5, wet: 0.45 }).input);

    Object.assign(graph, { humFilter, humGain, partials, winds, lapGain, lapBand });
    buildRadio();

    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      // En segundo plano la escena no se anima: el sonido tampoco.
      if (document.hidden) ctx.suspend();
      else if (enabled) ctx.resume();
    });
  }

  /* ---------------------------------------------------------------- */
  /* Radio                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Cadena de onda corta: todo lo que entra en `bus` sale con banda estrecha
   * (300-3200 Hz), saturado por un altavoz viejo y con desvanecimiento.
   */
  function buildRadio() {
    const bus = ctx.createGain();
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 320;
    const band = ctx.createBiquadFilter();
    band.type = 'peaking';
    band.frequency.value = 1500;
    band.gain.value = 5;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 3200;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClipCurve(2.5);
    const fade = ctx.createGain();
    fade.gain.value = 0.6;
    const out = ctx.createGain();
    out.gain.value = 0.7;
    bus.connect(highpass).connect(band).connect(lowpass).connect(shaper).connect(fade).connect(out);
    out.connect(spatial(radioPosition, { refDistance: 3, wet: 0.55 }).input);

    // Estatica de fondo.
    const hiss = loop(graph.white);
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0.05;
    hiss.connect(hissGain).connect(bus);

    // Silbido de sintonia (heterodino): un tono que se desliza despacio.
    const whistle = ctx.createOscillator();
    whistle.frequency.value = 900;
    const whistleGain = ctx.createGain();
    whistleGain.gain.value = 0;
    whistle.connect(whistleGain).connect(bus);
    whistle.start();

    // Voz: diente de sierra con vibrato, filtrado por tres formantes.
    const voiceOsc = ctx.createOscillator();
    voiceOsc.type = 'sawtooth';
    voiceOsc.frequency.value = 130;
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 5.2;
    const vibratoDepth = ctx.createGain();
    vibratoDepth.gain.value = 3;
    vibrato.connect(vibratoDepth).connect(voiceOsc.frequency);
    const voiceEnv = ctx.createGain();
    voiceEnv.gain.value = 0;
    const formants = [0, 1, 2].map((i) => {
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.Q.value = [9, 12, 14][i];
      const g = ctx.createGain();
      g.gain.value = [1, 0.6, 0.3][i];
      voiceOsc.connect(f).connect(g).connect(voiceEnv);
      return f;
    });
    voiceEnv.connect(bus);
    voiceOsc.start();
    vibrato.start();

    // Morse: tono puro de 720 Hz.
    const morseOsc = ctx.createOscillator();
    morseOsc.frequency.value = 720;
    const morseEnv = ctx.createGain();
    morseEnv.gain.value = 0;
    morseOsc.connect(morseEnv).connect(bus);
    morseOsc.start();

    graph.radio = {
      bus,
      fade,
      whistle,
      whistleGain,
      voiceOsc,
      voiceEnv,
      formants,
      morseEnv,
      fadeTimer: 0,
      whistleTimer: 4,
      nextTransmission: 4 + Math.random() * 6,
    };
  }

  /** Chasquido de estatica: un pico de ruido muy corto. */
  function crackle() {
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = graph.white;
    const gain = ctx.createGain();
    // Contenidos: de cerca, chasquidos fuertes resultaban asperos.
    const level = 0.1 + Math.random() * 0.35;
    gain.gain.setValueAtTime(level, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.004 + Math.random() * 0.012);
    source.connect(gain).connect(graph.radio.bus);
    source.start(now, Math.random() * 3);
    source.stop(now + 0.03);
  }

  /**
   * Una frase de voz ininteligible: silabas con vocales al azar, entonacion
   * que cae al final y pausas cortas entre "palabras". Todo se programa por
   * adelantado en la linea de tiempo de audio.
   */
  function speak(start) {
    const r = graph.radio;
    const duration = 2.5 + Math.random() * 3.5;
    const basePitch = 100 + Math.random() * 70;
    const vowels = Object.values(VOWELS);
    let t = start;
    const end = start + duration;
    r.voiceOsc.frequency.setTargetAtTime(basePitch, t, 0.05);
    while (t < end) {
      const syllable = 0.09 + Math.random() * 0.17;
      const [f1, f2, f3] = vowels[Math.floor(Math.random() * vowels.length)];
      [f1, f2, f3].forEach((f, i) => r.formants[i].frequency.setTargetAtTime(f, t, 0.025));
      // Entonacion: sube y baja un poco por silaba y cae al final de la frase.
      const progress = (t - start) / duration;
      const pitch = basePitch * (1.08 - progress * 0.18) * (0.95 + Math.random() * 0.1);
      r.voiceOsc.frequency.setTargetAtTime(pitch, t, 0.04);
      r.voiceEnv.gain.setTargetAtTime(0.5, t, 0.015);
      r.voiceEnv.gain.setTargetAtTime(0.12, t + syllable * 0.7, 0.03);
      t += syllable;
      if (Math.random() < 0.18) {
        r.voiceEnv.gain.setTargetAtTime(0, t, 0.03);
        t += 0.15 + Math.random() * 0.3;
      }
    }
    r.voiceEnv.gain.setTargetAtTime(0, t, 0.05);
    return t - start;
  }

  /** Una o dos palabras en morse. */
  function tapMorse(start) {
    const r = graph.radio;
    const words = [MORSE_WORDS[Math.floor(Math.random() * MORSE_WORDS.length)]];
    if (Math.random() < 0.5) words.push(MORSE_WORDS[Math.floor(Math.random() * MORSE_WORDS.length)]);
    const unit = 0.065 + Math.random() * 0.025;
    let t = start;
    for (const [on, units] of morseSequence(words.join(' '))) {
      if (on) {
        r.morseEnv.gain.setTargetAtTime(0.35, t, 0.004);
        r.morseEnv.gain.setTargetAtTime(0, t + units * unit, 0.004);
      }
      t += units * unit;
    }
    return t - start;
  }

  function updateRadio(dt) {
    const r = graph.radio;
    const now = ctx.currentTime;

    // Desvanecimiento de la senal, como la onda corta de verdad.
    r.fadeTimer -= dt;
    if (r.fadeTimer <= 0) {
      r.fadeTimer = 1.5 + Math.random() * 5;
      const target = Math.random() < 0.15 ? 0.08 : 0.35 + Math.random() * 0.65;
      r.fade.gain.setTargetAtTime(target, now, 0.8 + Math.random() * 1.5);
    }

    // Chasquidos: unos pocos por segundo, al azar.
    if (Math.random() < dt * 5) crackle();

    // Silbido: aparece a ratos y se desliza.
    r.whistleTimer -= dt;
    if (r.whistleTimer <= 0) {
      r.whistleTimer = 3 + Math.random() * 8;
      const on = Math.random() < 0.45;
      r.whistleGain.gain.setTargetAtTime(on ? 0.015 + Math.random() * 0.015 : 0, now, 1.2);
      r.whistle.frequency.setTargetAtTime(500 + Math.random() * 1100, now, 2.5);
    }

    // Transmisiones: voz o morse, con silencios largos entre medias.
    r.nextTransmission -= dt;
    if (r.nextTransmission <= 0) {
      const length = Math.random() < 0.6 ? speak(now + 0.05) : tapMorse(now + 0.05);
      r.nextTransmission = length + 7 + Math.random() * 18;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Otros sonidos                                                     */
  /* ---------------------------------------------------------------- */

  /** Crujido grave de la estructura: rumor que sube, se sostiene y se va. */
  function rumble() {
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = graph.brown;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 70 + Math.random() * 40;
    const gain = ctx.createGain();
    const peak = 0.25 + Math.random() * 0.2;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(peak, now + 2.5 + Math.random() * 2);
    gain.gain.linearRampToValueAtTime(0, now + 8 + Math.random() * 4);
    source.connect(filter).connect(gain);
    ambient(gain, 1.2);
    source.start(now, Math.random() * 3);
    source.stop(now + 13);
  }

  function updateListener() {
    const l = ctx.listener;
    const now = ctx.currentTime;
    camera.getWorldPosition(listener);
    camera.getWorldDirection(forward);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    const set = (param, value) => param.setTargetAtTime(value, now, 0.05);
    set(l.positionX, listener.x);
    set(l.positionY, listener.y);
    set(l.positionZ, listener.z);
    set(l.forwardX, forward.x);
    set(l.forwardY, forward.y);
    set(l.forwardZ, forward.z);
    set(l.upX, up.x);
    set(l.upY, up.y);
    set(l.upZ, up.z);
    right.crossVectors(forward, up).normalize();
  }

  return {
    get enabled() {
      return enabled;
    },

    /** Debe llamarse desde un gesto del usuario la primera vez. */
    setEnabled(on) {
      enabled = on;
      if (on && !ctx) build();
      if (!ctx) return;
      const now = ctx.currentTime;
      graph.master.gain.cancelScheduledValues(now);
      graph.master.gain.setValueAtTime(graph.master.gain.value, now);
      if (on) {
        ctx.resume();
        // Entrada lenta: el ambiente aparece, no arranca.
        graph.master.gain.linearRampToValueAtTime(MASTER_LEVEL, now + 3);
      } else {
        graph.master.gain.linearRampToValueAtTime(0, now + 0.6);
        setTimeout(() => {
          if (!enabled) ctx.suspend();
        }, 700);
      }
    },

    /**
     * @param {number} dt
     * @param {{energy: number, wind: Array<Vector3>}} state
     */
    update(dt, { energy, wind }) {
      if (!ctx || !enabled || ctx.state !== 'running') return;
      const now = ctx.currentTime;
      updateListener();
      for (const voice of voices) applyDistance(voice);

      const hum = reactorHum(energy);
      for (const { osc, ratio } of graph.partials) osc.frequency.setTargetAtTime(hum.freq * ratio, now, 0.5);
      graph.humFilter.frequency.setTargetAtTime(hum.cutoff, now, 0.5);
      graph.humGain.gain.setTargetAtTime(hum.gain, now, 0.5);

      wind.forEach((velocity, i) => {
        const voice = windVoice(Math.hypot(velocity.x, velocity.z));
        const w = graph.winds[i];
        w.gain.gain.setTargetAtTime(voice.gain, now, 0.4);
        w.band.frequency.setTargetAtTime(voice.freq, now, 0.4);
        w.pan.pan.setTargetAtTime(windPan(velocity.x, velocity.z, right.x, right.z), now, 0.4);
      });

      // Chapoteo: el volumen deriva despacio, como el agua que nunca para.
      lapTimer -= dt;
      if (lapTimer <= 0) {
        lapTimer = 0.8 + Math.random() * 1.6;
        lapTarget = Math.random();
      }
      graph.lapGain.gain.setTargetAtTime(0.012 + lapTarget * 0.02, now, 0.6);
      graph.lapBand.frequency.setTargetAtTime(700 + lapTarget * 500, now, 0.6);

      updateRadio(dt);

      rumbleTimer -= dt;
      if (rumbleTimer <= 0) {
        rumbleTimer = 35 + Math.random() * 60;
        rumble();
      }
    },

    /** "Plip" de una gota en el agua, en su posicion. */
    drop(x, y, z, amplitude, radius) {
      if (!ctx || !enabled || ctx.state !== 'running') return;
      const voice = dropVoice(amplitude, radius);
      if (voice.gain <= 0) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(voice.startFreq, now);
      osc.frequency.exponentialRampToValueAtTime(voice.endFreq, now + voice.duration);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(voice.gain, now + 0.003);
      env.gain.exponentialRampToValueAtTime(0.0001, now + voice.duration * 1.8);

      // El impacto en si: un chasquido de ruido agudo muy corto.
      const click = ctx.createBufferSource();
      click.buffer = graph.white;
      const clickFilter = ctx.createBiquadFilter();
      clickFilter.type = 'highpass';
      clickFilter.frequency.value = 2500;
      const clickEnv = ctx.createGain();
      clickEnv.gain.setValueAtTime(voice.gain * 0.35, now);
      clickEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);

      // Voz espacial de un solo uso: la distancia se fija al caer la gota.
      // Mucho eco: en una boveda la gota se oye, sobre todo de lejos, por su
      // cola.
      const at = spatial(new Vector3(x, y, z), { refDistance: 1.5, rolloff: 1.4, wet: 0.9, persistent: false });
      osc.connect(env).connect(at.input);
      click.connect(clickFilter).connect(clickEnv).connect(at.input);

      osc.start(now);
      osc.stop(now + voice.duration * 2);
      click.start(now, Math.random() * 3);
      click.stop(now + 0.02);
    },

    dispose() {
      ctx?.close();
      ctx = null;
    },
  };
}
