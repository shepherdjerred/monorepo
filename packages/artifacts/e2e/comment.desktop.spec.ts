import { expect, test } from "@playwright/test";
import {
  SETTLE_MS,
  frame,
  openBoard,
  viewportBox,
  wheel,
} from "./canvas-helpers.ts";
import { agentApi, openFocused, resetAndSeed } from "./review-setup.ts";
import { PIN_TIP } from "#client/lib/pin-shape.ts";
import type { SeededBoards } from "./seed.ts";

let seeded: SeededBoards;

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(120_000);
  seeded = await resetAndSeed(baseURL);
});

test.describe("comments on the canvas", () => {
  test("a board pin is placed on empty canvas, round-trips, and stays glued while panning", async ({
    page,
    baseURL,
  }) => {
    await openBoard(page, "demo");
    await page.keyboard.press("c");
    await expect(page.getByTestId("comment-mode")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const view = await viewportBox(page);
    const at = { x: view.x + 120, y: view.y + 120 };
    await page.mouse.click(at.x, at.y);
    const composer = page.getByTestId("placement-composer");
    await expect(composer).toBeVisible();
    await composer.getByRole("textbox").fill("The spacing here is off");
    await composer.getByRole("button", { name: "Comment" }).click();
    await expect(composer).toBeHidden();
    const pin = page.getByTestId("pin");
    await expect(pin).toHaveCount(1);
    const pinBox = await pin.boundingBox();
    if (pinBox === null) throw new Error("no pin box");
    // The speech bubble's tail tip (1 px in, on the bottom edge) is where the click was.
    expect(Math.abs(pinBox.x + PIN_TIP.x - at.x)).toBeLessThan(1.5);
    expect(Math.abs(pinBox.y + PIN_TIP.y - at.y)).toBeLessThan(1.5);

    const claim = await agentApi(baseURL).feedback.claim.mutate({
      scope: { type: "board", board: "demo" },
    });
    const anchor = claim.items.at(-1)?.thread.anchor;
    expect(anchor?.type).toBe("board");

    // Panning moves the pin with the world, by exactly the delta.
    await wheel(page, { dx: -60, dy: -25, x: 400, y: 400 });
    await page.waitForTimeout(40);
    await expect
      .poll(async () => {
        const box = await pin.boundingBox();
        return box?.x ?? 0;
      })
      .toBeCloseTo(pinBox.x + 60, 0);

    // And it is still where it was after a reload (the camera is restored too).
    await page.waitForTimeout(SETTLE_MS);
    const moved = await pin.boundingBox();
    await page.reload();
    await expect(page.getByTestId("pin")).toHaveCount(1);
    await page.waitForTimeout(SETTLE_MS);
    const restored = await page.getByTestId("pin").boundingBox();
    expect(Math.abs((restored?.x ?? 0) - (moved?.x ?? 0))).toBeLessThan(1.5);
    expect(Math.abs((restored?.y ?? 0) - (moved?.y ?? 0))).toBeLessThan(1.5);
  });

  test("a frame pin is placed on a frame and follows it", async ({ page }) => {
    await openBoard(page, "concepts");
    await page.getByRole("button", { name: /^Concept A,/u }).click();
    await page.keyboard.press("2");
    await page.waitForTimeout(SETTLE_MS);
    await page.keyboard.press("c");
    const target = frame(page, seeded.concepts[0]?.artifactId ?? "");
    const box = await target.boundingBox();
    if (box === null) throw new Error("no frame box");
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    const composer = page.getByTestId("placement-composer");
    await expect(composer).toBeVisible();
    await composer.getByRole("textbox").fill("Heading is too small");
    await composer.getByRole("button", { name: "Comment" }).click();
    await expect(composer).toBeHidden();
    const pin = page.getByTestId("pin");
    await expect(pin).toHaveCount(1);
    await expect(page.getByTestId("thread")).toContainText("Concept A");
    const first = await pin.boundingBox();
    const frameBefore = await target.boundingBox();
    if (first === null || frameBefore === null) throw new Error("no boxes");
    await wheel(page, { dx: -90, dy: 0, x: 300, y: 300 });
    await page.waitForTimeout(SETTLE_MS);
    const frameAfter = await target.boundingBox();
    const second = await pin.boundingBox();
    if (second === null || frameAfter === null) throw new Error("no boxes");
    expect(second.x - first.x).toBeCloseTo(frameAfter.x - frameBefore.x, 0);
  });

  test("comment mode shows the MessageCircle cursor on the canvas and in the focused view", async ({
    page,
  }) => {
    const cursorOf = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((element) => getComputedStyle(element).cursor);
    await openBoard(page, "concepts");
    expect(await cursorOf('[data-testid="canvas-viewport"]')).not.toContain(
      "url(",
    );
    await page.keyboard.press("c");
    await expect(page.getByTestId("comment-mode")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // Over the world and a frame the bubble; over the toolbar the normal cursor.
    expect(await cursorOf('[data-testid="canvas-viewport"]')).toContain("url(");
    expect(await cursorOf('[data-testid="canvas-frame"]')).toContain("url(");
    expect(await cursorOf('[role="toolbar"]')).not.toContain("url(");
    await page.keyboard.press("Escape");
    expect(await cursorOf('[data-testid="canvas-viewport"]')).not.toContain(
      "url(",
    );

    await openFocused(page, seeded.demo.htmlV2.artifactId);
    expect(await cursorOf(".ar-stage")).not.toContain("url(");
    await page.keyboard.press("c");
    await expect(page.getByTestId("comment-mode")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await cursorOf(".ar-stage")).toContain("url(");
    // The overlay over the inert frame carries it: iframe content cannot.
    expect(await cursorOf('[data-testid="comment-catcher"]')).toContain("url(");
    await page.keyboard.press("Escape");
    expect(await cursorOf(".ar-stage")).not.toContain("url(");
  });
});
