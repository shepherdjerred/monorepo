import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export async function step(
  page: Page,
  wave: number,
  index: number,
): Promise<void> {
  await page.evaluate(
    ({ wave: waveNumber, index: stateIndex }) => {
      const element = globalThis.document.querySelector(
        `#wave-${String(waveNumber)}-${String(stateIndex)}`,
      );
      if (element === null) throw new Error("Missing step");
      const cursor =
        globalThis.innerWidth < 1000
          ? globalThis.innerHeight * 0.72
          : globalThis.innerHeight / 2;
      globalThis.scrollTo({
        top:
          element.getBoundingClientRect().top +
          globalThis.scrollY -
          cursor +
          24,
        behavior: "instant",
      });
    },
    { wave, index },
  );
  await expect(page.locator(`#wave-${String(wave)}`)).toHaveAttribute(
    "data-active-state",
    String(index),
    { timeout: 10_000 },
  );
  await expect(page.locator(`#wave-${String(wave)}`)).toHaveClass(
    /active-wave/,
  );
}
