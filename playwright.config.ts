import { defineConfig, devices } from '@playwright/test';

// The app under test talks to a Supabase URL that nothing is listening on:
// every request is intercepted in the browser (see e2e/mockBackend.ts), so the
// suite needs no Supabase project, no credentials and no LLM calls.
const PORT = Number(process.env.E2E_PORT ?? 3000);

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // `serve` the production build: far faster and more stable than the CRA dev
    // server, and it exercises the same bundle CI ships.
    command: `npx serve -s build -l ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
