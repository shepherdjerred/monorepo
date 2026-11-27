/**
 * The UI under the app host's Content-Security-Policy (`appPolicy` in
 * `src/domain/csp.ts`, served by `start.ts`): no route or viewer may trip it, so pdf.js, the terminal
 * player, markdown images, video and frames all work with only the content
 * origin allowed beyond 'self'.
 */
import { expect, test } from "@playwright/test";
import { resetAndSeed } from "./review-setup.ts";
import type { SeededBoards } from "./seed.ts";

let seeded: SeededBoards;

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(120_000);
  seeded = await resetAndSeed(baseURL);
});

test("the app sends the policy", async ({ request }) => {
  const response = await request.get("/");
  const policy = response.headers()["content-security-policy"] ?? "";
  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("frame-ancestors 'none'");
  // Only WebAssembly may compile; script text may not be evaluated.
  expect(policy.replaceAll("wasm-unsafe-eval", "")).not.toContain(
    "unsafe-eval",
  );
});

test("no route or viewer violates it", async ({ page }) => {
  await page.addInitScript(() => {
    const seen: string[] = [];
    Reflect.set(globalThis, "__violations", seen);
    document.addEventListener("securitypolicyviolation", (event) => {
      seen.push(`${event.violatedDirective} ${event.blockedURI}`);
    });
  });
  const routes = [
    "/",
    "/b/demo",
    "/b/demo/outline",
    ...(
      [
        "htmlV2",
        "site",
        "png",
        "pdf",
        "mp4",
        "markdown",
        "cast",
        "mermaid",
        "bin",
      ] as const
    ).map((name) => `/a/${seeded.demo[name].artifactId}`),
  ];
  for (const route of routes) {
    await page.goto(route);
    await expect(page.getByRole("main")).toBeVisible();
    await page.waitForTimeout(1200);
  }
  // pdf.js text layer and the cast player load lazily; give them their turn.
  await page.goto(`/a/${seeded.demo.pdf.artifactId}`);
  await expect(page.locator(".textLayer").first()).toContainText("Page one");
  await page.goto(`/a/${seeded.demo.cast.artifactId}`);
  await expect(page.getByTestId("cast-player")).toBeVisible();
  await page.waitForTimeout(1500);
  const violations = await page.evaluate("globalThis.__violations");
  expect(violations).toEqual([]);
});
