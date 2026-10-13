import { test, expect } from "@playwright/test";
import { step } from "./helpers.ts";

test("sizes the marker to the active explanation's content, including after resizing", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("./");
  const initial = page.viewportSize();
  if (initial === null) throw new Error("Missing viewport");
  for (const viewport of [
    initial,
    { width: initial.width < 1000 ? 1280 : 390, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    for (const [wave = 0, index = 0] of [
      [0, 1],
      [0, 4],
      [0, 2],
      [5, 0],
      [5, 13],
    ]) {
      await step(page, wave, index);
      const current = page.locator(
        `#wave-${String(wave)} .step[aria-current=step]`,
      );
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute("data-state", String(index));
      const marker = await page
        .locator(`#wave-${String(wave)} .progress-marker`)
        .boundingBox();
      const text = await current.locator(".step-content > div").boundingBox();
      const section = await current.boundingBox();
      if (marker === null || text === null || section === null)
        throw new Error("Missing explanation bounds");
      expect(Math.abs(marker.height - text.height)).toBeLessThan(1);
      expect(Math.abs(marker.y - text.y)).toBeLessThan(1);
      expect(marker.height).toBeLessThan(section.height);
    }
  }
});
