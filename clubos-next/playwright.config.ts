import { defineConfig, devices } from '@playwright/test';

/**
 * Configuración de Playwright para los E2E de ClubOS.
 *
 * Levanta el frontend en :3001 y corre los flujos críticos contra él. Asume
 * que la API está corriendo (BASE_API) con una base de test. En CI se levanta
 * todo con docker compose antes de esto.
 *
 *   npm run test:e2e        headless
 *   npm run test:e2e:ui     con inspector visual
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: process.env.WEB_BASE_URL ?? 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Levanta el front automáticamente si no está corriendo (dev local).
  webServer: process.env.CI
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3001',
        reuseExistingServer: true,
        timeout: 60_000,
      },
});
