import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export const PHONE = { width: 375, height: 812 };
export const DESKTOP = { width: 1280, height: 720 };

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
