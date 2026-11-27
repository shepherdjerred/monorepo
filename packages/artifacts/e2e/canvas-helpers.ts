import { expect, type Page } from "@playwright/test";

export const SETTLE_MS = 450;

export type Camera = { x: number; y: number; s: number };

export async function camera(page: Page): Promise<Camera> {
  return page.getByTestId("canvas-world").evaluate((element) => {
    const match =
      /translate\((?<x>[\d.e+-]+)px, (?<y>[\d.e+-]+)px\) scale\((?<s>[\d.e+-]+)\)/u.exec(
        element instanceof HTMLElement ? element.style.transform : "",
      );
    const groups = match?.groups;
    return {
      x: Number(groups?.["x"]),
      y: Number(groups?.["y"]),
      s: Number(groups?.["s"]),
    };
  });
}

export async function zoomOf(page: Page): Promise<number> {
  const { s } = await camera(page);
  return s;
}

export async function cameraOf(page: Page): Promise<Camera> {
  return camera(page);
}

export async function viewportBox(page: Page) {
  const box = await page.getByTestId("canvas-viewport").boundingBox();
  if (box === null) throw new Error("the canvas has no box");
  return box;
}

/** Dispatches a wheel event on the viewport (Playwright's mouse cannot set both modifiers and integer points). */
export async function wheel(
  page: Page,
  init: { dx?: number; dy?: number; ctrl?: boolean; x: number; y: number },
): Promise<void> {
  await page.getByTestId("canvas-viewport").evaluate((element, value) => {
    element.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: value.dx ?? 0,
        deltaY: value.dy ?? 0,
        ctrlKey: value.ctrl ?? false,
        clientX: value.x,
        clientY: value.y,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, init);
}

export async function openBoard(page: Page, slug: string): Promise<void> {
  await page.goto(`/b/${slug}`);
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  await expect(page.getByTestId("canvas-frame").first()).toBeVisible();
  // The first view fits every frame.
  await page.waitForTimeout(SETTLE_MS);
}

export function frame(page: Page, artifactId: string) {
  return page.locator(`[data-frame-id="${artifactId}"]`);
}
