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

`src/scene/textures.js` genera las texturas en un `<canvas>` (metal, suelo,
paredes). Son el sustituto de los assets y funcionan sin nada externo.

Si hay imágenes generadas en `public/textures/`, se cargan en su lugar. Ese es
el punto de extensión para ComfyUI: `tools/generate-textures.mjs` las produce
vía la API HTTP y la app las consume como ficheros estáticos, sin dependencia
en runtime. ComfyUI vive fuera del repo, en `C:\AI\ComfyUI_windows_portable`.

El realismo depende de PBR, no de bloom: `MeshStandardMaterial` con
`roughnessMap` + `normalMap` + `scene.environment` (PMREM). Un `MeshBasicMaterial`
coloreado no refleja nada y se lee plano por muchos efectos que se le sumen.

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
