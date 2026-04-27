import { test, expect } from "@playwright/test";

/**
 * Smoke tests — DELIBERATELY MINIMAL.
 *
 * The only invariant we test here is "every public route returns
 * something other than 5xx." That's it. We do NOT assert on copy,
 * button labels, headings, or any UI state, because those change
 * with normal product work and would generate noise.
 *
 * The job of this suite is to catch the class of bugs that took prod
 * down on Apr 26 2026: a Next.js routing-conflict / runtime crash
 * where every URL — including unrelated ones — 500s before reaching
 * any handler code. A single 200/404 on the homepage proves the
 * worker initialised, all dynamic-segment trees are coherent, and
 * top-level imports loaded. That's the signal we need before deploy.
 *
 * If you find yourself adding visual / functional tests, put them in
 * a separate spec file (e.g. `dashboard.spec.ts`) and gate them on a
 * test-account login flow.
 */

const PUBLIC_ROUTES = [
  "/",
  "/auth/login",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/error",
  "/auth/confirmed",
];

const PROTECTED_ROUTES = [
  // Should redirect to /auth/login or render a guarded shell — never 5xx.
  "/host/dashboard",
  "/host/settings",
  "/admin/billing",
];

const API_HEALTH = [
  // Public routes that take no auth and must always respond < 500.
  // 4xx is an acceptable "validation says no" signal; 5xx is a regression.
  { path: "/api/streams/AAAAAA", method: "GET" },
];

test.describe("public routes never 5xx", () => {
  for (const route of PUBLIC_ROUTES) {
    test(`GET ${route}`, async ({ page }) => {
      const response = await page.goto(route);
      const status = response?.status() ?? 0;
      expect(
        status,
        `${route} returned ${status} — expected < 500`,
      ).toBeLessThan(500);
    });
  }
});

test.describe("protected routes redirect, not crash", () => {
  for (const route of PROTECTED_ROUTES) {
    test(`GET ${route}`, async ({ page }) => {
      const response = await page.goto(route);
      const status = response?.status() ?? 0;
      expect(
        status,
        `${route} returned ${status} — expected < 500 (redirect or guarded render)`,
      ).toBeLessThan(500);
    });
  }
});

test.describe("API health", () => {
  for (const probe of API_HEALTH) {
    test(`${probe.method} ${probe.path}`, async ({ request }) => {
      const res = await request.fetch(probe.path, { method: probe.method });
      expect(
        res.status(),
        `${probe.method} ${probe.path} returned ${res.status()} — expected < 500`,
      ).toBeLessThan(500);
    });
  }
});
