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

`environment.js` usa `fwidth` (antialias de rejilla): requiere WebGL2.

## Fechas

Todo se trabaja en hora local. No uses `new Date('2026-01-01')`: se interpreta
como UTC y en husos negativos retrocede un día. Construye desde componentes
numéricos con los helpers de `core/date.js` (`fromISODate`, `addDays`, ...).

## Verificar en el navegador

`main.js` expone `window.studyLab = { store, lab, renderTab, hud }`. Úsalo para
comprobar cambios sin tests: siembra sesiones con
`store.replaceAll([...])`, dispara `store.reset()`, inspecciona
`store.getState()`. Los toasts y el estado del DOM también se leen desde ahí.

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
