// End-to-end tests for DevOrbit: the real API + the built frontend, driven in Chromium.
// Run with `npm test` in this folder (see e2e/README.md).
import { defineConfig, devices } from '@playwright/test';

// Override with E2E_API_PORT / E2E_WEB_PORT if something else uses these ports
// (on macOS, port 5000 is often taken by AirPlay Receiver).
const API_PORT = Number(process.env.E2E_API_PORT || 5000);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 5173);
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false, // one shared backend; keep the run predictable
  workers: 1,
  retries: isCI ? 1 : 0,
  forbidOnly: isCI,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    // Must be "localhost" (not 127.0.0.1) to match CLIENT_ORIGIN and the refresh cookie.
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Never reuse a running dev server: it would point at your real development database.
      command: 'node start-backend.js',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { PORT: String(API_PORT), CLIENT_ORIGIN: `http://localhost:${WEB_PORT}` },
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Build with the API address baked in, then serve the production build.
      command: `npm run build --prefix ../frontend && npm run preview --prefix ../frontend -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 180_000,
      env: { VITE_API_URL: `http://localhost:${API_PORT}/api` },
    },
  ],
});
