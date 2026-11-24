import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const PHONE = { width: 375, height: 812 };
export const DESKTOP = { width: 1280, height: 720 };

export async function gotoLoadedPage(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator("main h1")).toBeVisible();
  await expect(page.locator(".loading-state")).toHaveCount(0);
}

export async function expectPagesFitViewport(
  page: Page,
  viewport: { readonly width: number; readonly height: number },
  paths: readonly string[],
): Promise<void> {
  await page.setViewportSize(viewport);
  for (const path of paths) {
    await gotoLoadedPage(page, path);
    const overflow = await horizontalOverflow(page);
    expect(overflow.document, path).toBeLessThanOrEqual(0);
    expect(overflow.main, path).toBeLessThanOrEqual(0);
  }
}

/**
 * How far the page scrolls sideways, and how far the page's own `<main>`
 * overflows its box. The content column is a size container, and a browser
 * may keep a container's overflow out of the document's scrollable area, so
 * the document width alone would not notice content cut off inside it.
 */
export async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const main = globalThis.document.querySelector("main");
    return {
      document:
        globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
      main: main === null ? 0 : main.scrollWidth - main.clientWidth,
    };
  });
}

export async function violations(target: Page | AxeBuilder) {
  const builder =
    target instanceof AxeBuilder ? target : new AxeBuilder({ page: target });
  const results = await builder
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map((violation) => ({
    id: violation.id,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));
}
