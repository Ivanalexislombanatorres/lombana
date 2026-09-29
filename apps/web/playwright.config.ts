import { defineConfig } from '@playwright/test';

// Pruebas de extremo a extremo contra el build de producción, una base local de
// pruebas y el simulador de Supabase Auth (e2e/mock-auth.mjs).
const PORT = 3210;
const AUTH_PORT = 54399;
const APP_PW = process.env.LOMBANA_APP_DB_PASSWORD ?? 'dev_app_pw';
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? `postgres://lombana_app:${APP_PW}@localhost/lombana_test?host=/tmp`;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  webServer: [
    {
      command: 'node e2e/mock-auth.mjs',
      port: AUTH_PORT,
      reuseExistingServer: false,
      env: { MOCK_AUTH_PORT: String(AUTH_PORT) },
    },
    {
      command: `npx next start -p ${PORT} -H 127.0.0.1`,
      port: PORT,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL,
        APP_ENV: 'test',
        SITE_URL: `http://localhost:${PORT}`,
        GEMINI_API_KEY: 'gemini-e2e',
        GEMINI_API_BASE: `http://127.0.0.1:${AUTH_PORT}`,
        GEMINI_MODEL: 'modelo-e2e',
        NEXT_TELEMETRY_DISABLED: '1',
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${AUTH_PORT}`,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e',
      },
    },
  ],
});
