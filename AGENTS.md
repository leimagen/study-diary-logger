# AGENTS.md

Diario de estudio gamificado sobre una escena Three.js. Vite + Three.js, sin
framework de UI, sin backend. Datos en `localStorage`.

## Comandos

```bash
npm run dev      # servidor de desarrollo
npm test         # src/core/selftest.js (harness propio, exit 1 si falla)
npm run build    # bundle de producción
```

No hay linter, formateador ni typecheck configurado. No los inventes.
`npm run build` avisa de un chunk >500 kB: es Three.js, es esperado.

## Frontera entre `core/` y el resto

`src/core/` es JavaScript puro, sin DOM ni Three.js, y es lo único que se puede
importar y ejecutar en Node. `src/scene/` y `src/ui/` asumen navegador.

Regla práctica: la lógica que se pueda testear va a `core/`. Si añades un
cálculo a `scene/` o `ui/` que se pueda aislar, muévelo a `core/`.

`src/core/selftest.js` es un arnés escrito a mano con `check()` / `ok()`, no
`node:test` (el comentario de cabecera que menciona `node --test` es obsoleto).
Añade casos ahí; es la única red de seguridad.

## Contrato de estado (fácil de romper en silencio)

`store.subscribe()` entrega dos formas distintas y los paneles no son
interchangeables:

- `state.stats` → `summaryPanel`, `heatmap`, `weekdayPanel`, `subjectsPanel`, `historyPanel`
- `state` completo → `achievementsPanel` (necesita `state.achievements`)

`lab.sync(state)` debe invocarse en ese mismo suscriptor. Si no, la escena 3D
se queda congelada en el estado inicial sin ningún error visible: ni torres, ni
logros, ni racha. Ya pasó una vez.

## GLSL

Los shaders viven en template literals JS. **Nada de backticks en comentarios
dentro de un literal GLSL**: cierra el template y tumba la escena entera con un
`SyntaxError`. Comenta sin comillas invertidas.

## Texturas: procedural o ComfyUI

`src/scene/textures.js` genera las texturas en un `<canvas>` (losas de piedra
del suelo, paneles hexagonales del muro). Son el sustituto de los assets y
funcionan sin nada externo.

Si hay imágenes generadas en `public/textures/`, pueden cargarse en su lugar
(`upgradeWithComfy`). Ahora mismo no se usa ninguna: las que hay son chapa
cepillada y no encajan con el muro hexagonal. `environment.materials` está
vacío a propósito. Ese es
el punto de extensión para ComfyUI: `tools/generate-textures.mjs` las produce
vía la API HTTP y la app las consume como ficheros estáticos, sin dependencia
en runtime. ComfyUI vive fuera del repo, en `C:\AI\ComfyUI_windows_portable`.

El realismo depende de PBR, no de bloom: `MeshStandardMaterial` con
`roughnessMap` + `normalMap` + `scene.environment` (PMREM). Un `MeshBasicMaterial`
coloreado no refleja nada y se lee plano por muchos efectos que se le sumen.

## Dirección de arte

Museo futurista sellado durante milenios (referencia del usuario: sala oscura,
paneles hexagonales, contraluz de una rendija vertical, filos LED, suelo
mojado). Reglas:

- **Una sola familia de luz**: blanco frío, en `src/scene/palette.js`. Nada
  de neones por objeto. El rango de un logro se lee en el material (bronce,
  plata, oro), no en un color de luz.
- **Objetos físicos, no hologramas**: cerámica negra lacada, piedra pulida,
  vidrio con transmisión. Nada de wireframes ni aros aditivos.
- **El polvo solo se ve donde hay luz** (`dust.js`): cono del foco, junto a
  las rendijas y cerca del reactor.
- **El agua es un campo en coordenadas de mundo** (`wetMask` en `wet.js`),
  compartido por el material del suelo y el reflejo. Nunca en la textura: se
  repetiría con ella.
- **La interfaz usa la misma paleta** (`style.css`): negro neutro, acento
  `--accent` (blanco frío), rojo y verde apagados solo con significado.
- **Matices de materia**: seis blancos fríos (`SUBJECT_TINTS` en
  `scene/palette.js` y `--tint-0..5` en CSS, deben coincidir). El índice
  (`tint`) lo calcula `core/stats.js` por orden de primera aparición, no por
  minutos: así el color de una materia no salta al cambiar el ranking.

## Mapa de la escena

- `environment.js`: rotonda, suelo, rendijas (`setSlitsEnabled`), bañadores
  de pared, tarima, foco del techo, escena mínima para el mapa de entorno.
- `reactor.js`: giroscopio de cerámica, vidrio con núcleo, cable.
  `lowestPoint` es de donde caen las gotas a la fuente.
- `fountain.js`: pilón, agua con simulación de ondas en GPU
  (`GPUComputationRenderer`, 256²), cáusticas en el fondo, gotas del reactor
  y brisa.
- `wet.js`: suelo mojado (máscara + reflejo), `NO_REFLECTION_LAYER`,
  `guardReflector`.
- `wind.js`: tres corrientes con ráfagas aleatorias; los shaders solo leen
  el desplazamiento acumulado.
- `air.js`: cuánta luz recibe un punto del aire. La comparten polvo y niebla.
- `dust.js`: polvo, iluminado por `airLight` y arrastrado por el viento.
- `mist.js`: niebla volumétrica. Es un pase de post-proceso (raymarching
  contra la profundidad de la escena), no geometría. Necesita las
  `DepthTexture` de los render targets del composer (`postfx.js`).

## Fechas

Todo se trabaja en hora local. No uses `new Date('2026-01-01')`: se interpreta
como UTC y en husos negativos retrocede un día. Construye desde componentes
numéricos con los helpers de `core/date.js` (`fromISODate`, `addDays`, ...).

## Verificar en el navegador

`main.js` expone `window.studyLab = { store, lab, renderTab, hud }`. Úsalo para
comprobar cambios sin tests: siembra sesiones con
`store.replaceAll([...])`, dispara `store.reset()`, inspecciona
`store.getState()`. Los toasts y el estado del DOM también se leen desde ahí.

## Aprendizajes y errores a evitar

Lo que costó tiempo descubrir en este repo. Comprobar antes de actuar.

### El log de un dev server es histórico, no el estado actual

Vite cachea módulos con un parámetro `?t=<timestamp>`. Un error puede llevar
minutos apareciendo en la consola para código que ya no existe. **Si el mensaje
trae `?t=`, es una versión anterior: el fichero en disco manda.** Verificar con
`grep` antes de reportar un bug. Pasó una vez: se reportó un `TypeError` en
`towers.js` que ya estaba corregido.

### Fallos silenciosos (sin error visible)

- **`lab.sync(state)` sin llamar** → la escena 3D ignora el estado entero: sin
  torres, logros todos bloqueados, racha a cero. Ni un error en consola.
- **Los paneles esperando el shape equivocado** → cinco paneles quieren
  `state.stats`, `achievementsPanel` quiere `state`. Cambia solo una llamada y
  rompe el arranque.
- **Avisos de "logro nuevo" o "subida de nivel" en cada recarga** → inicializar
  el valor de comparación a `null`, no a un valor por defecto.

### GLSL

- **Nada de backticks en comentarios dentro de un literal GLSL**: cierra el
  template y tumba la escena con un `SyntaxError` y la página en blanco. Si la
  escena desaparece de golpe, sospechar de esto primero.
- **No escalar en Y geometrías cónicas**: `CylinderGeometry(0.42, 0.55, 1)`
  escalada en Y deforma el cónico y cada barra parece una campana. Usar radios
  iguales arriba y abajo.
- **Blending aditivo satura a blanco muy rápido.** Subir alfa, tamaño o
  emissive de golpe produce orbes planos que tapan la escena. Subir de uno en
  uno y comprobar con captura.

### PBR, texturas y post-proceso

- **Un mapa de entorno lo es todo.** Sin `scene.environment` (PMREM de
  `RoomEnvironment`), cualquier material con `metalness` alto sale negro: no
  tiene nada que reflejar. `MeshStandardMaterial` sin IBL no es «plano» por
  casualidad.
- **Al pasar a PBR, las intensidades de luz bajan mucho.** Three usa unidades
  físicas; valores que funcionaban con materiales `Basic` (key a 120) lavan la
  imagen. Con PBR, key ≈ 26.
- **El bloom con `radius` alto difunde por media pantalla.** Un halo de cientos
  de px tapaba el reactor; el núcleo real medía 100. `radius 0.1`,
  `threshold 0.95`, fuerza ~0.15.
- **El normal map derivado del albedo es traicionero.** Sobel sobre la
  luminancia de una textura fotorrealista con `strength` alto produce normales
  extremas: el suelo metálico se ve como agua. Usar 0.35 o menos.
- **El prompt decide el material, no el adjetivo.** Pedir «wet reflective» a
  SD 1.5 devuelve agua. Para metal: «flat matte, no reflections» más términos
  negativos explícitos.
- El estado vacío de la escena debe seguir leyéndose: comprobar con captura y
  sin datos, no solo con datos.
- **Los albedos del canvas están en sRGB.** Pintar `0.03` en una textura
  `SRGBColorSpace` son `0.002` en lineal: más negro que el terciopelo, y
  ninguna luz lo saca. La piedra negra real ronda 0.04 lineal, unos 0.2 en el
  canvas. Si una superficie no reacciona a la luz, sospechar de esto.
- **El velo lechoso sobre toda la imagen era el bloom**, no la luz: emisivos
  HDR muy altos (14×) se esparcen por los niveles gruesos del bloom aunque la
  fuerza sea baja. Emisivos ≤ 6, `radius 0`, `threshold 1.0`. Para aislarlo:
  apagar todas las luces; si el suelo sigue gris, es post-proceso.
- **El mapa de entorno se construye con la propia sala**
  (`createEnvironmentMapScene`): negra con las rendijas. `RoomEnvironment`
  es blanca y quemaba el metal en rasante.
- **`RectAreaLight` necesita `RectAreaLightUniformsLib.init()`** o no
  ilumina nada, y emite hacia su `-Z` (al revés que un mesh tras
  `lookAt`).
- **Vidrio esmerilado + núcleo brillante = bola blanca plana.** La
  transmisión con rugosidad reparte el núcleo por toda la esfera. Vidrio claro
  (`roughness` ~0.04) y núcleo contenido.
- **Las etiquetas van en la capa 1**: la cámara principal la ve y la del
  `Reflector` no. Si no, las placas de texto aparecen en los charcos.
- `PCFSoftShadowMap` ya no existe en esta versión de Three: usar
  `PCFShadowMap`.
- **Cada `Reflector` debe pasar por `guardReflector`.** Si no, con dos
  reflectores cada uno re-renderiza la escena dentro del reflejo del otro, y
  los dos se repiten en la pasada de profundidad del DOF.
- **Polvo invisible no es polvo roto.** Las motas son subpíxel y solo brillan
  dentro de un haz: la intensidad tiene que ser alta (~10). Para depurarlo,
  subir `uIntensity` a 40 en vivo y ver dónde están.
- **La simulación de agua con gotas pequeñas (pocas celdas) da ruido en
  cruz**: la malla dispersa las altas frecuencias por los ejes. Gotas de
  radio ≥ 6-7 celdas.
- **Velocidad de las ondas = `uSpeed` (k = c²).** La fórmula clásica de
  «media de vecinos» es k = 0.5: a 60 Hz, ondas de 1.5 m/s, nerviosas. Con
  k = 0.045 van a ~0.2 m/s. Al bajar k hay que subir la amortiguación por
  paso (0.9965) o las ondas mueren antes de llegar a la pared.
- **Pared del agua: Neumann, no Dirichlet.** Fijar la altura a 0 fuera del
  círculo invierte la onda al rebotar y se siente falso. El vecino exterior
  toma la altura de la celda actual.
- **Gotas siempre en el mismo punto = anillo perfecto.** Posición aleatoria y
  salpicaduras satélite desfasadas.
- **Niebla con capas horizontales = anillos en las columnas.** Cada capa
  corta la geometría en una línea que parpadea al moverse el ruido. Por eso
  la niebla es volumétrica. No volver a capas ni a billboards sin depth.
- **Puntos de 1 px con MSAA titilan**: la cobertura de muestras cambia con la
  posición subpíxel. El polvo se dibuja a 2.5-3 px con el brillo repartido
  por el área real.
- **El grano de película animado se lee como parpadeo** si pasa de ~0.02.
- **Una cruz oscura en el fondo de la fuente es la sombra de los anillos**,
  proyectada por el foco que tienen encima. Es correcta.
- Las capturas del panel del navegador se reducen a 800 px: a 1400 de
  viewport, lo subpíxel (polvo) desaparece. Para verlo, viewport a 800.

### Interfaz

- **`el()` con `style` no aplicaba variables CSS**: `Object.assign` sobre
  `node.style` ignora `--algo` sin error. Ahora usa `setProperty` para
  ellas. Por eso el color de rango de las tarjetas de logros nunca se veía.
- **El HUD pasa por debajo del panel lateral.** Sin el `padding-right` del
  ancho del panel, los controles de cámara (incluido volver a la vista
  general) quedaban tapados.

### Escalas y visualización
- **Escala lineal aplasta datos desiguales.** Las materias con pocas horas
  quedaban indistinguibles de un anillo en el suelo; acabó en escala
  logarítmica. Con horas acumulándose, pensar en log antes que en lineal.
- **`uFill` debe ser el peso sobre el total**, no el ratio con el máximo: así
  la barra es comparable entre días.
- **Normalizar a un máximo hace que todo parezca igual.** Si tres valores están
  en 4, 4 y 4, una escala relativa al máximo dibuja tres barras idénticas de
  altas y no comunica nada.
- Un objeto oscuro y sin emisión en el suelo se lee como escombro, no como
  parte de la escena. Los pedestales bloqueados casi desaparecen; los
  desbloqueados brillan.

### Entorno

- **No usar PowerShell `WriteAllLines` / `Set-Content` para tocar código con
  acentos.** Destruye el UTF-8 (`cámara` → `cÃ¡mara`) y produce errores
  desconcertantes del tipo «`console` is undefined» dentro de una función, con
  globales que sí existen. Usar la herramienta de edición o `git checkout`.
- `Rename-Item` falla al renombrar la carpeta del proyecto: es el cwd de la
  sesión y Windows la marca «in use». Usar `cmd /c move` desde el directorio
  padre.
- `gh repo create --source=. --push` puede devolver exit code 1 con un mensaje
  de error en stderr aunque **sí** haya funcionado. Confirmar con
  `git ls-remote` antes de asumir que falló.
- Consola de Windows en `ibm850`: la salida con acentos o `✅` se ve corrupta
  aunque el test pase. Los ficheros están en UTF-8 sin BOM.
- La herramienta de edición falla de forma intermitente si el contenido lleva
  backticks. Reformular sin ellos y reintentar.

## Other

- `storage.js` cae a memoria si `localStorage` no existe (modo privado). La
  app debe funcionar igual; `storageAvailable` lo expone por si hay que avisar.
- `store.commit()` persiste el conjunto de logros ya obtenidos para no repetir
  la celebración al recargar. Si añades un logro, su `progress(stats)` recibe
  el resultado de `computeAll`, así que necesitas el campo en `core/stats.js`.
- Consola de Windows en `ibm850`: la salida con acentos o `✅` se ve
  corrompida aunque el test pase. Los ficheros están en UTF-8 sin BOM.
- `git config core.autocrlf=true`; el índice guarda LF.
- Three.js deprecó `Clock` a favor de `Timer` (usado en `scene/lab.js`).
- El historial de trabajo por sesión está en [MEMORY.md](./MEMORY.md). Solo se
  escribe cuando el usuario marca el inicio o el fin de una sesión.
