import { defineConfig, devices } from '@playwright/test';

/**
 * The end-to-end suite.
 *
 * Runs against the BUILT server, not the dev one: what is being checked is
 * the thing that gets deployed — the content policy comes from the proxy, the
 * fonts and the pdf.js worker come from the emitted assets, and none of that
 * behaves the same under `next dev`.
 *
 * Two projects, because "it works" and "it works on a phone" are different
 * claims and the second is where a signing tool is actually used: somebody
 * receives a contract on their phone and has to sign it there.
 *
 * A throwaway session secret so the suite can forge a cookie and reach the
 * workspace without an identity provider; the OIDC round trip has its own
 * suite.
 */
const PORT = Number(process.env.E2E_PORT ?? 4021);
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const SESSION_SECRET = 'e2e-signdrop-secret-with-at-least-32-bytes';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  // El informe HTML también en CI: la primera vez que Safari falló, el paso
  // que sube el artefacto no encontró nada que subir y hubo que reproducirlo
  // a mano. Un fallo que solo ocurre en CI y no deja rastro es un fallo que
  // se investiga dos veces.
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
    // Safari is where a phone signature actually happens for half the people
    // who will use this, and WebKit is the only way to find out without one.
    // Only in CI: installing it locally needs system packages and root.
    ...(process.env.CI || process.env.SAFARI ? [{ name: 'safari', use: { ...devices['iPhone 14'] } }] : []),
  ],
  webServer: {
    command: 'node scripts/start.js',
    // `/` and not `/api/health`: health answers 503 without an identity
    // provider, on purpose (a service nobody can sign into is not healthy),
    // and this suite deliberately runs without one. What is needed here is
    // only "is it listening".
    url: `${BASE_URL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      SIGNDROP_SESSION_SECRET: SESSION_SECRET,
      SIGNDROP_PUBLIC_HOST: `127.0.0.1:${PORT}`,
    },
  },
});
