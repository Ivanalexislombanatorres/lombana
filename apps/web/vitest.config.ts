import { defineConfig } from 'vitest/config';

// Pruebas unitarias de la web (las e2e van con Playwright en e2e/).
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
