import { test, expect } from "@playwright/test";

/**
 * Smoke tests: every public route must return 200 and render its
 * landmark element. If this suite fails, do NOT deploy — production
 * will 500 on first request.
 *
 * NOTE: We avoid testing anything behind auth here. A real login flow
 * needs Supabase test credentials, and you can layer that on later as
 * an "auth.spec.ts" using the Playwright global setup pattern. The
 * goal of THIS file is to catch:
 *
 *   1. Next.js routing conflicts that throw at module load (this is
 *      what took down the site on Apr 26 after the [streamId]/[roomCode]
 *      collision — every route 500s, including '/').
 *   2. Top-level imports that fail in the Workers runtime but pass the
 *      build step.
 *   3. Missing required env vars surfaced as 500s.
 */

test.describe("public routes return 200", () => {
  test("homepage", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status(), "homepage status").toBe(200);
    // Landing copy from the hero section.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("login page", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.status(), "login status").toBe(200);
    await expect(page.getByRole("button", { name: /sign in|log in/i })).toBeVisible();
  });

  test("auth/error displays a message", async ({ page }) => {
    // A page Next.js renders when an OAuth callback fails. It must
    // not itself crash.
    const response = await page.goto("/auth/error");
    expect(response?.status(), "auth/error status").toBe(200);
  });
});

test.describe("protected routes redirect, not crash", () => {
  test("/host/dashboard redirects unauthenticated users", async ({ page }) => {
    const response = await page.goto("/host/dashboard");
    // Expect either a 200 (login page rendered after server redirect)
    // or a 3xx — NOT a 5xx. Next's middleware does the redirect with
    // status 307; Playwright follows automatically so we typically see
    // the final 200.
    expect(
      response?.status(),
      "/host/dashboard must not 500",
    ).toBeLessThan(500);
    await expect(page).toHaveURL(/\/login/);
  });

  test("/admin/billing redirects unauthenticated users", async ({ page }) => {
    const response = await page.goto("/admin/billing");
    expect(
      response?.status(),
      "/admin/billing must not 500",
    ).toBeLessThan(500);
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("API health", () => {
  test("auth callback returns a sane error rather than 500 on missing args", async ({
    request,
  }) => {
    const res = await request.get("/api/auth/callback");
    // 4xx is fine; 5xx is a regression. The route must validate args.
    expect(res.status(), "/api/auth/callback must not 500").toBeLessThan(500);
  });

  test("public stream lookup returns a structured 404 for unknown rooms", async ({
    request,
  }) => {
    const res = await request.get("/api/streams/AAAAAA");
    expect(res.status()).toBeLessThan(500);
    // 404 (not found) or 400 (bad code) — both are acceptable signals
    // the route ran. The previous routing-conflict bug returned 500.
    expect([400, 404, 410]).toContain(res.status());
  });
});
