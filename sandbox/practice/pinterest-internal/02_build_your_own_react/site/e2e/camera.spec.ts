import { test, expect } from "@playwright/test";
import { step } from "./helpers.ts";

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

test("keeps the active pane at full height across section boundaries", async ({
  page,
  isMobile,
}) => {
  await page.goto("./");
  for (const [wave = 0, index = 0] of [
    [4, 33],
    [5, 0],
    [4, 33],
  ]) {
    await step(page, wave, index);
    await expect(page.locator(".active-wave")).toHaveCount(1);
    await expect(page.locator(".progress-marker:visible")).toHaveCount(1);
    const bounds = await page
      .locator(`#wave-${String(wave)} .sticker`)
      .boundingBox();
    const viewport = page.viewportSize();
    if (bounds === null || viewport === null)
      throw new Error("Missing pane bounds");
    expect(bounds.y).toBe(isMobile ? 0 : 32);
    expect(bounds.height).toBe(
      isMobile ? viewport.height / 2 : viewport.height - 64,
    );
  }
});

test("opens types on pointer movement and dismisses them when the explanation changes", async ({
  page,
}) => {
  await page.goto("./");
  await step(page, 0, 1);
  const token = page
    .locator("#wave-0 .type-token")
    .filter({ hasText: /^element$/ })
    .first();
  await token.hover();
  await expect(page.locator("#type-popup")).toBeVisible();
  await step(page, 0, 2);
  await expect(page.locator("#type-popup")).toBeHidden();
});

test("uses the top of the pane for a short example, including a focus near its end", async ({
  page,
}) => {
  await page.goto("./");
  await step(page, 0, 4);
  const viewport = page.locator("#wave-0 .viewport");
  const bounds = await viewport.boundingBox();
  const first = await page
    .locator("#wave-0 .code-line")
    .filter({ hasText: /^const element =/ })
    .boundingBox();
  if (bounds === null || first === null) throw new Error("Missing code bounds");
  expect(first.y - bounds.y).toBeCloseTo(16, 0);
  expect(await viewport.evaluate((element) => element.scrollHeight)).toBe(
    await viewport.evaluate((element) => element.clientHeight),
  );
});

test("fills the bottom of the pane when the explanation focuses the example's end", async ({
  page,
}) => {
  await page.goto("./");
  await step(page, 5, 0);
  const coverage = await page
    .locator("#wave-5 .viewport")
    .evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const rows = [...element.querySelectorAll(".code-line")].map((line) =>
        line.getBoundingClientRect(),
      );
      return {
        top: Math.min(...rows.map((row) => row.top)) - bounds.top,
        bottom: bounds.bottom - Math.max(...rows.map((row) => row.bottom)),
      };
    });
  expect(coverage.top).toBeLessThanOrEqual(28);
  expect(coverage.bottom).toBeCloseTo(16, 0);
});

test("keeps context above and below the focused code reachable", async ({
  page,
}) => {
  await page.goto("./");
  await step(page, 5, 13);
  const viewport = page.locator("#wave-5 .viewport");
  const code = page.locator("#wave-5 .code-line");
  await expect(code.filter({ hasText: "actions.forEach" })).toBeVisible();
  expect(
    await viewport.evaluate((element) => element.scrollTop),
  ).toBeGreaterThan(0);
  await viewport.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(
    code.filter({ hasText: "function createElement" }),
  ).toBeVisible();
  await viewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    code.filter({ hasText: "Didact.render(element, container)" }),
  ).toBeVisible();
});
