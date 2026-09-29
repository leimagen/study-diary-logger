# Laboratorio de Estudio

Diario de estudio gamificado dentro de un laboratorio 3D futurista. Registras
cada sesión de estudio y la escena reacciona: el reactor late más fuerte con tu
racha, las torres de materia crecen según tus horas y los logros se iluminan.

## Stack

- **Vite + Three.js** (sin framework de UI; la interfaz es DOM plano)
- **localStorage** para persistencia, con fallback en memoria
- **Shaders GLSL propios** para suelo, cúpula, reactor y torres
- Sin dependencias de red ni backend

## Puesta en marcha

```bash
npm install
npm run dev      # servidor de desarrollo
npm test         # 82 comprobaciones de la lógica central
npm run build    # bundle de producción
```

## Estructura

```
src/
  core/          Lógica pura, sin DOM ni Three.js (testeable en node)
    date.js      Fechas en zona horaria local, semanas ISO
    model.js     Esquema de sesión + validación
    storage.js   Persistencia en localStorage
    stats.js     Rachas, totales, heatmap, desgloses
    gamification.js  XP, niveles, 22 logros
    store.js     Estado reactivo + CRUD
    selftest.js  Suite de comprobaciones
  scene/         Escena 3D
    lab.js       Orquestador: cámara, bucle, picking
    environment.js  Sala procedural (suelo, cúpula, pilares)
    reactor.js   Núcleo que representa la racha
    towers.js    Columnas por materia
    pedestals.js Medallones de logro
    particles.js Chispas (pool de 1600)
    postfx.js    DOF + bloom
    labels.js    Etiquetas de texto vía CanvasTexture
  ui/            Interfaz DOM
    hud.js       Nivel, XP, racha, avisos
    logForm.js   Formulario de registro
    panels.js    Heatmap, materias, ritmo semanal, historial
    achievements.js  Rejilla de logros con progreso
```

## Cómo funcionan las mecánicas

**Racha.** Días consecutivos con al menos una sesión. Si hoy todavía no has
estudiado pero sí ayer, la racha sigue viva: solo se rompe tras dos días
completos sin estudiar.

**XP.** 1 XP por minuto (con techo a las 4 h para no premiar maratones), más
8 por punto de dificultad y 4 por punto de energía.

**Niveles.** Curva `100 · (nivel - 1)^1.55`: sube rápido al principio y exige
constancia real después. Cada rango tiene título (Aprendiz → Director de
Investigación).

**Logros.** 22 logros en cuatro rangos (bronce, plata, oro, leyenda), cada uno
con progreso parcial visible en la interfaz.

## Detalles de implementación

Las fechas se trabajan en hora local, nunca con `new Date('YYYY-MM-DD')`, que se
interpreta como UTC y en husos negativos retrocede un día.

El frustum se desplaza con `camera.setViewOffset` para compensar el panel lateral
y que la escena quede centrada en el hueco visible.

El DOF sigue automáticamente la distancia entre la cámara y el reactor.

## Controles

- Arrastrar: orbitar. Rueda: zoom.
- `N` o `1`: registro. `2`: progreso. `3`: logros. `4`: historial.
- Botones `DOF` y `AUTO` alternan profundidad de campo y cámara automática.
- Clic en un medallón 3D: la cámara lo enfoca.

## Datos

Todo vive en `localStorage` bajo la clave `studyforge.v1`. Los botones
**Exportar** / **Importar** permiten respaldar y migrar los datos en JSON.

## Ampliable

- **ComfyUI**: la escena es 100 % procedural, así que cualquier textura o
  imagen generada puede sustituir a los shaders. Los puntos de entrada son
  `createFloor`, `createDome` y los materiales de `towers.js`.
- **Backend**: `storage.js` está aislado tras `load` / `save` / `import` /
  `export`. Implementar esas cuatro funciones contra una API REST es suficiente
  para migrar a multi-dispositivo sin tocar nada más.
