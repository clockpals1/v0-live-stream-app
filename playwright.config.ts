import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke-test configuration.
 *
 * Goals:
 *   - Catch the kinds of bugs that broke prod twice this week:
 *       (a) build succeeds but every page 500s at runtime
 *       (b) Next.js routing conflicts that only surface on first request
 *   - Fast: under 30s on a clean machine, runs before every deploy.
 *   - Cheap: no DB, no fixtures, no auth flows. We only verify that the
 *     public surface returns 200 and renders something sane.
 *
 * The CI workflow boots `next start` against a production build then
 * runs this suite. If anything 500s the deploy is blocked.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    // Smoke tests don't need video/screenshots normally; on failure the
    // CI logs already capture the response. Keep the run lightweight.
    trace: process.env.CI ? "retain-on-failure" : "off",
    video: "off",
    screenshot: "only-on-failure",
    // Production server is slow to start cold on a CI runner.
    navigationTimeout: 20_000,
    actionTimeout: 10_000,
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Boot a production server for the suite. Use the existing build.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
