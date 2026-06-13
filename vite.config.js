import { defineConfig } from 'vite';

// The image assets live in the project root (alongside index.html). They are
// pulled into the bundle via import.meta.glob in src/assets.js, so no special
// publicDir handling is needed. base './' keeps the build portable.
export default defineConfig({
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    open: false,
  },
});
