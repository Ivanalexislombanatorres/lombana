import { defineConfig } from 'vitest/config';

// Pruebas unitarias de la web (las e2e van con Playwright en e2e/).
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], alias: { 'server-only': new URL('./test/server-only.ts', import.meta.url).pathname }, environment: 'node' },
});
