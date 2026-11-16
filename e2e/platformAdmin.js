// [Sprint 6 · M8] FR-27: the Platform Admin used by the end-to-end tests.
// start-backend.js passes these to the API as PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD, so the server creates
// the account when it starts (backend/src/lib/platformAdmin.js); tests/platform-admin.spec.js logs in with them.
// Test-only values for the throw-away e2e database. Never use them for a real deployment.
export const E2E_PLATFORM_ADMIN = Object.freeze({
  name: 'E2E Platform Admin',
  email: 'e2e-platform-admin@example.com',
  password: 'e2e admin password 2026',
});
