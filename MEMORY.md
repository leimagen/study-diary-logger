# MEMORY.md

Bitácora de sesiones de trabajo.

Contexto técnico permanente en [AGENTS.md](./AGENTS.md) y descripción del
proyecto en [README.md](./README.md). Este fichero es solo historial.

## Protocolo

**Una entrada por sesión de trabajo, no por turno de conversación.**

El usuario marca los límites explícitamente con frases como:

- «empecemos una sesión» / «arrancamos»
- «listo, eso es todo por ahora» / «ya por hoy terminamos»

- **Al empezar** una sesión: se anota la fecha y el objetivo, aunque todavía no
  haya trabajo hecho. Si la sesión muere a medias, esa entrada sirve de hilo.
- **Al terminar**: se completa el resumen, se registran los bugs corregidos con
  su causa y se commit.

No se crea una entrada por cada tarea o cada mensaje. Si una misma sesión dura
muchos turnos, sigue siendo **una** entrada.

Los aprendizajes técnicos que sobreviven a la sesión van a `AGENTS.md`
(apartado «Aprendizajes y errores a evitar»); aquí va lo narrativo del
trabajo. Evitar duplicar la misma lista en los dos ficheros.

---

## Sesión 1 — 2026-09-29 · Proyecto completo y publicación

**Objetivo:** diario de estudio gamificado con laboratorio 3D, desde cero.
Directorio de partida vacío. Node 22, npm 10, git 2.54.

### Decisiones de producto

| Decisión | Elegido | Descartado |
|---|---|---|
| Persistencia | `localStorage` primero | Backend SQLite, API REST |
| Stack 3D | Three.js + Vite vanilla | React Three Fiber |
| ComfyUI | Generar assets por adelantado | Integrarlo en runtime |
| Campos del log | Fecha, materia, tema, duración, notas + dificultad y energía | Definición mínima |

El usuario propuso ComfyUI para el estilo visual, pero se acordó generar los
assets por adelantado, no llamarlo desde la app. La escena quedó **100 %
procedural** para que cualquier textura futura encaje.

### Qué se construyó

Vite (template vanilla) + `three`. 22 ficheros en `src/`.

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
- `npm run build` compila (652 kB, casi todo Three.js).
- Flujo end-to-end en navegador: alta de sesión, persistencia tras recarga,
  validación (fecha futura y duración 0 rechazadas), atajos, desbloqueo de
  logros con 40 días de racha, y `dispose()` detiene el bucle de render.

### Publicación

Repo `leimagen/study-diary-logger`, público, rama `main`. `gh` ya estaba
autenticado con scope `repo`, no hizo falta configurarlo. El paquete se renombró
de `aic-proj1` a `study-diary-logger` y la carpeta local se renombró después con
`cmd /c move` (`Rename-Item` falla: la carpeta es el cwd de la sesión y está
«in use»).

Commits: `87f05d6` implementación, `2f607b2` documentación, `dbff2bc` bitácora.

### Incidente: reporte de bug que no existía

El usuario preguntó por un `TypeError ... reading 'position'` en
`towers.js:213`. **No había tal bug.** Venía del log del dev server con el
parámetro `?t=1790706852127`, una versión cacheada por HMR de un estado
intermedio de esta misma sesión. El `grep` de `cap` en el fichero no devolvía
nada: la referencia ya se había eliminado.

El coste de affirmar sin verificar fue convencer al usuario de que había un
problema que no existía, y que lo arreglara él.

### Pendiente

- **Realismo visual**: sustituir los shaders de `createFloor` / `createDome` por
  texturas y materiales PBR. Ver la nota de la Sesión 2.
- **Backend**: `storage.js` está aislado tras `load` / `save` / `import` /
  `export`. Implementar esas cuatro funciones contra una API REST migraría a
  multi-dispositivo sin tocar nada más.
- **Edición de sesiones**: `store.updateSession` existe y el store lo soporta,
  pero la UI solo permite añadir y borrar.

---

## Sesión 2 — 2026-09-29 · Realismo visual, ComfyUI y organización del repo

*(en curso)*

### Problema: ComfyUI no arrancaba

**Diagnóstico real: no estaba instalado.** No era un fallo de configuración,
nunca estuvo en la máquina. Se comprobó buscando directorios, procesos, el
puerto 8188 y `pip list`.

Dos suposiciones que resultaron falsas y que hubo que corregir verificando:

- «Python 3.14 bloquearía PyTorch». Falso: torch 2.14 trae wheels
  `cp314 win_amd64`. Se comprobó en la API de PyPI antes de recomendar nada.
- «El modelo de SD 1.5 ocupa 2 GB». Falso: el checkpoint fp32 son 4068 MB.

Datos del equipo que condicionan el diseño:

| | |
|---|---|
| GPU | RTX 3050 Laptop, **4 GB VRAM** (el cuello de botella real) |
| RAM | 15,4 GB |
| Disco libre | 141,6 GB |
| Python | 3.14.5 en el sistema; el portable trae 3.13.14 con torch 2.13+cu130 |

Instalación: portable NVIDIA de `C:\AI\ComfyUI_windows_portable`, extraída con
WinRAR (7-Zip no está instalado). Se arranca con
`--lowvram` porque 4 GB no dan para más. Modelo: `v1-5-pruned-emaonly.safetensors`.

### Realismo: qué lo aporta de verdad

El salto visual vino de PBR, no de más post-proceso:

- `scene.environment` con `PMREMGenerator` + `RoomEnvironment`. Sin mapa de
  entorno, un material con `metalness` alto no tiene nada que reflejar y sale
  negro. Es el cambio más importante.
- Texturas procedurales (`src/scene/textures.js`): rugosidad y normales derivadas
  con Sobel, con ruido determinista (LCG, no `Math.random`).
- Sombras reales (`shadowMap` + `castShadow`/`receiveShadow`) y mobiliario
  (consolas, cajas, vigas, conduitos) que da escala.

Con PBR las luces son intensidades físicas: los valores que funcionaban con
materiales `Basic` (key a 120) lavaron la imagen por completo. Bajados a ~26.

### El mapa de normales derivado es un arma de doble filo

`deriveMaps()` saca el normal map de la luminancia del albedo. Con
`strength = 1.6` el suelo metálico se leía como **agua en movimiento**: la
luminancia de una textura fotorrealista varía mucho y el Sobel amplifica. Bajado
a 0.35.

Corolario: pedir «wet reflective surface» a SD 1.5 devuelve agua, no metal. El
prompt del suelo se reescribió con «flat matte, no reflections» y términos
negativos explícitos.

### El bloom era el culpable del centro blanco

Un halo blanco de ~350 px tapaba el reactor. Con bloom a 0 se vio que el núcleo
real medía unos 100 px: era el `UnrealBloomPass` con `radius = 0.5`, que
difunde el brillo por media pantalla. Bajado a `radius = 0.1`, `threshold = 0.95`,
fuerza 0.12-0.15.

### Bug de UX encontrado por el camino

Importar un backup con muchas sesiones desbloqueaba decenas de logros y llenaba
la pantalla de toasts. Se añadió tope de 4 simultáneos en `hud.js`.

### Error propio: PowerShell corrompió la codificación

Al insertar una línea de diagnóstico con `[System.IO.File]::WriteAllLines` se
destrozo el UTF-8 de `lab.js` (`geometria` con acento -> `geometr??a`, `camara` con acento -> `cÃ¡mara`).
El síntoma fue desconcertante: errores como «`renderer` is undefined» y
«`console` is undefined» **dentro de una función**, cuando ambos eran globales
válidos. La causa era un comentario partido que dejaba una cadena suelta.

Se diagnostico comparando el código servido por el servidor contra el disco, y
se revirtió con `git checkout` antes de reaplicar los cambios con la herramienta
de edición, que respeta UTF-8.

**Lección: no usar PowerShell `WriteAllLines` / `Set-Content` para tocar ficheros
de código con acentos en este proyecto.**

### El usuario es diseñador gráfico

Corrijo terminología y hay que respetarla. Señaló que diferenciaba «pixelado» de
«borroso» y tenía razón: yo estaba confundiendo aliasing con desenfoque y por
eso había rebajado el DOF que le gustaba. Cuando use vocabulario visual,
comprobar antes de asumir.

### Aliasing, no blur (el bug real del pixelado)

`new EffectComposer(renderer)` crea los render targets con `samples: 0`. El
`antialias: true` del renderer solo afecta al framebuffer por defecto, que el
composer esquiva por completo. Todo se renderizaba sin multisampling. El DOF
no tiene nada que ver. MSAA a 4x en ambos render targets.

### Diagnósticos que salieron mal

Dos correcciones de rumbo, ambas por affirmar sin verificar:

1. **La textura del suelo «desaparecía».** Medí el material cada 400 ms: estable.
   Concluí que era la capa emisiva. Estaba mal: la textura no desaparecía, se
   sustituía por una **peor**. La procedural dibuja una rejilla de placas con
   juntas; la generada por ComfyUI solo tiene cepillado vertical. Ahora el suelo
   **no** se sustituye: la procedural gana en pantalla.
2. **El «atardecer» en el suelo.** Lo atribuí a la IBL y la apagué. No era: con
   `metalness 0.85` el suelo es casi un espejo y el foco genera un lóbulo
   especular enorme en ángulo rasante. Se ve solo desde ciertos ángulos, y por
   eso la sala «no parecía oscura». Bajado a `metalness 0.22` / `roughness 0.88`.

### La IBL casi nunca es la culpable

`RoomEnvironment` es una sala **blanca**. En metal con Fresnel, cualquier resto
de IBL se multiplica hacia 1 en ángulo rasante. `environmentIntensity` está a 0
y no se va a subir: la única fuente es el foco.

### Un `Reflector` grande produce artefactos, uno pequeño no

El charco de 26×26 devolvía imágenes **nítidas** de los aros del techo en forma
de franjas duras cruzando el suelo. Bajar la intensidad solo lo atenuaba: un
espejo no difunde. La solución fue cambiar de estrategia: el pavimento mojado lo
hace el **motor PBR** con rugosidad variable (`wetLabFloor()`), y el `Reflector`
se reservó para un círculo pequeño (la fuente), donde el reflejo nítido del
reactor es justo lo que se quiere.

### GLSL: tres fallos propios

- **Un bloque `{ }` no es una expresión.** Envolver una deformación de UVs en
  llaves rompe la compilación: hay que calcular el valor antes.
- El `Reflector` ya declara `base` y `vUv` es `vec4` proyectado (usar `xy/w`).
  Redeclarar `base` da `'base' : redefinition`.
- Un shader roto **no lanza error visible**: deja el objeto como un disco
  oscuro. Solo se ve en la consola. Mirar siempre la consola tras tocar shaders.

### Estado visual al cerrar

Lucha cuerpo a cuerpo con la iluminación, ganada. Sala a oscuras con un único
foco de museo (panel suspendido + `SpotLight` con cono), torres como vidrio
oscuro con filo luminoso que **iluminan de verdad** (`PointLight` propia por
torre), pavimento mojado irregular por PBR, y fuente bajo el reactor con
oleaje y reflejo real.

Limpieza acumulada: fuera los aros del techo (salían casi siempre como franjas
reflejadas), las barras inclinadas, el octógono, las vigas, el cono de luz y la
capa emisiva del suelo.

### Pendiente

- **Anillos del techo**: siguen reflejándose en el pavimento. Están en el borde
  de lo aceptable; si molestan, quitarlos también.
- **El agua es un espejo casi perfecto.** El objetivo de pavimento mojado real
  pediría difuminar el reflejo con la rugosidad, no solo con normales.
- **Backend**: `storage.js` aislado tras `load`/`save`/`import`/`export`.
- **Edición de sesiones**: `store.updateSession` existe; la UI solo añade y
  borra.


