# MEMORY.md

Bitácora de sesiones. Al arrancar una sesión nueva, léeme esto primero para no
repetir trabajo ni reintroducir errores ya resueltos.

Contexto técnico permanente en [AGENTS.md](./AGENTS.md) y en
[README.md](./README.md). Este fichero es solo el historial cronológico.

---

## Sesión 1 — 2026-09-29 · scaffolding y primera versión completa

**Punto de partida:** directorio vacío. Node 22, npm 10, git 2.54.

### Decisiones de producto (acordadas con el usuario)

Se plantearon cuatro decisiones y se eligieron estas:

| Decisión | Elegido | Descartado |
|---|---|---|
| Persistencia | `localStorage` primero | Backend SQLite, API REST |
| Stack 3D | Three.js + Vite vanilla | React Three Fiber |
| ComfyUI | Generar assets por adelantado | Integrarlo en runtime |
| Campos del log | Fecha, materia, tema, duración, notas + dificultad y energía | Definición mínima |

El usuario propuso usar ComfyUI para el estilo visual, pero se acordó generar
los assets por adelantado, no llamarlo desde la app: la escena quedó
**100 % procedural** para que cualquier textura futura encaje.

### Qué se construyó

`npm create vite@latest` (template vanilla) + `three`. 22 ficheros en `src/`.

- `core/` — lógica pura y testeable: fechas, modelo, storage, stats,
  gamificación, store. Sin DOM ni Three.js.
- `scene/` — sala procedural, reactor, torres por materia, pedestales de logro,
  partículas, post-proceso, etiquetas.
- `ui/` — HUD, formulario, paneles de estadísticas, logros.

Mecánicas: rachas con regla de gracia (si estudiaste ayer, hoy sigues a salvo),
XP = minutos + dificultad + energía, 30 niveles con títulos, 22 logros en 4
rangos con progreso parcial.

### Verificación

- `src/core/selftest.js`: **82/82 comprobaciones**. Arnés propio, no `node:test`.
- `npm run build` compila (652 kB, casi todo Three.js; el aviso de chunk >500 kB
  es esperado).
- Flujo end-to-end probado en navegador: alta de sesión, persistencia tras
  recarga, validación, atajos de teclado, desbloqueo de logros con 40 días de
  racha, y `dispose()` detiene el bucle de render.

### Bugs encontrados y corregidos (importantes para futuras sesiones)

Estos son los que costaron tiempo. No reintroducirlos:

1. **`heatmap` perdía los últimos días.** Al retroceder hasta un lunes para
   alinear columnas, el bucle `for (i < days)` cortaba antes de llegar a hoy. Se
   cambió a recorrer de `start` a `end` inclusivo.

2. **`lab.sync(state)` no se llamaba nunca.** Consecuencia silenciosa: la escena
   3D ignoraba el estado — sin torres, todos los logros bloqueados, racha a
   cero. Sin error en consola. Fácil de reintroducir al tocar `main.js`.

3. **Los paneles recibían el shape equivocado.** `state` en vez de `state.stats`
   en cinco paneles, y `state` completo en `achievementsPanel`. Rompía el
   arranque con `TypeError` en `hud.js`.

4. **Aviso de nivel en cada recarga.** `lastLevel` arrancaba en 1, así que el
   primer `update` con nivel 16 disparaba el toast. Ahora es `null` hasta el
   primer update.

5. **Backtick en comentario GLSL.** ``// `uFill` marca...`` dentro de un template
   literal cerró el string y tumbó la escena entera con `SyntaxError`. La
   página quedaba en blanco. Buscar backticks dentro de bloques GLSL.

6. **Torres como vasos abiertos.** Se escalaba en Y una `CylinderGeometry`
   cónica (0.42/0.55), deformándola; y la parte "vacía" era casi invisible.
   Radio igual arriba y abajo + `DoubleSide`.

7. **Partículas gigantes.** `size` en el shader se escala por `300.0 / -mv.z`;
   los valores iniciales producían orbes enormes que dominaban la escena.

### Iteración visual posterior

Tras la primera versión correcta se iteró sobre la legibilidad, con capturas y
varias rondas:

- Reactor quemado a blanco: el blending aditivo con `uColorInner` crema
  saturaba. Bajado a azul y con alfa menor.
- Escalas de las torres: se probó relativa al máximo, luego absoluta con
  referencia de 10 h, y finalmente **logarítmica** (`log10(1+horas) * 1.5`) —
  la lineal aplastaba las materias pequeñas hasta hacerlas indistinguibles.
- `uFill` pasó a ser el peso sobre el total (comparable entre días), no el
  ratio con el máximo.
- Pedestales: de manchas negras legibles como escombro a casi invisibles cuando
  están bloqueados y brillantes al desbloquearlos. El suelo queda limpio.
- Bloom y exposición con techo para no lavar la imagen con rachas altas.
- Etiquetas de horas con minutos (`3 h 20 min`), no `3.2 h`.

### Estado al cerrar

Commit `87f05d6`. `AGENTS.md` y este `MEMORY.md` sin commitear.

---

## Sesión 2 — 2026-09-29 · `AGENTS.md`

Sin cambios de código. Se creó `AGENTS.md` tras investigar el repo (scripts,
frontera `core/` vs resto, contrato de estado, trampas de GLSL y fechas).

Nota de método: al escribir el fichero salió un texto corrupto
(`sin(unittest) tests`); corregido en el turno siguiente.

---

## Sesión 3 — 2026-09-29 · reporte de bug falso

El usuario preguntó por un `TypeError ... reading 'position'` en
`towers.js:213`.

**Diagnóstico correcto:** el error no existía. Venía del log del servidor con
el parámetro `?t=1790706852127`, una versión cacheada por HMR de las 8:34 PM de
un estado intermedio de la Sesión 1. El `grep` de `cap` en el fichero no
devolvía nada: la referencia colgante ya se había eliminado.

**Lección:** el log de un servidor de desarrollo en marcha es histórico. Un
parámetro `?t=` distinto del actual delata que el código cambió. Verificar en
el fichero antes de afirmar un bug. Se verificó después: 0 errores de consola
con 24 sesiones, cámara moviéndose entre frames, estado vacío correcto.

**También se aclaró por qué da blank el `index.html`:** Vite sirve módulos ES y
`file://` no puede cargarlos. Hace falta `npm run dev` (o `npm run preview` para
el build de producción), siempre por HTTP.

Sin cambios de código.

---

## Pendiente / ideas

Nada comprometido. Ideas que se comentaron y siguen abiertas:

- **ComfyUI**: sustituir los shaders de `createFloor` / `createDome` por
  texturas generadas. Los puntos de entrada están identificados.
- **Backend**: `storage.js` está aislado tras `load` / `save` / `import` /
  `export`. Implementar esas cuatro funciones contra una API REST migraría a
  multi-dispositivo sin tocar el resto.
- **Edición de sesiones**: existe `store.updateSession` y el store lo soporta,
  pero la UI solo permite añadir y borrar.
