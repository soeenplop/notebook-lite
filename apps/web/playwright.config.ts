import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 3200);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Smoke tests against a production build (`npm run build -w @notebook-lite/web` first).
 * Set E2E_BASE_URL to run them against a deployed environment instead.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  ...(process.env.E2E_BASE_URL
    ? {}
    : {
        webServer: {
          command: `node scripts/next.mjs start -p ${PORT}`,
          url: `${baseURL}/login`,
          reuseExistingServer: !process.env.CI,
          timeout: 60_000,
        },
      }),
});
