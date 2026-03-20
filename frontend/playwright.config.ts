import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests run against the isolated docker-compose test stack.
 * Start it first:  make test-up
 * Then run E2E:    npx playwright test
 * Or both at once: make e2e
 */

const GAME_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // avoid race conditions on shared test DB
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: GAME_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Global setup: wait for game service healthcheck to pass
  globalSetup: "./e2e/global-setup.ts",
});
