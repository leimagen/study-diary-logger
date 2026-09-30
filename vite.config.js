import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas: la demo en GitHub Pages vive en /study-diary-logger/,
  // no en la raíz. Con './' el mismo build sirve ahí y en local.
  base: './',
});
