import { expect, test, type Page } from "@playwright/test";
import { agentApi, resetAndSeed, sharedFixtures } from "./review-setup.ts";
import { publishFixture, type SeededBoards } from "./seed.ts";

let seeded: SeededBoards;

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(120_000);
  seeded = await resetAndSeed(baseURL);
});

const SETTLE_MS = 450;

type Camera = { x: number; y: number; s: number };

async function camera(page: Page): Promise<Camera> {
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

async function zoomOf(page: Page): Promise<number> {
  const { s } = await camera(page);
  return s;
}

async function cameraOf(page: Page): Promise<Camera> {
  return camera(page);
}

async function viewportBox(page: Page) {
  const box = await page.getByTestId("canvas-viewport").boundingBox();
  if (box === null) throw new Error("the canvas has no box");
  return box;
}

/** Dispatches a wheel event on the viewport (Playwright's mouse cannot set both modifiers and integer points). */
async function wheel(
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

async function openBoard(page: Page, slug: string): Promise<void> {
  await page.goto(`/b/${slug}`);
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  await expect(page.getByTestId("canvas-frame").first()).toBeVisible();
  // The first view fits every frame.
  await page.waitForTimeout(SETTLE_MS);
}

function frame(page: Page, artifactId: string) {
  return page.locator(`[data-frame-id="${artifactId}"]`);
}

test.describe("canvas", () => {
  test("lays frames out from the index and fits them all on first open", async ({
    page,
  }) => {
    await openBoard(page, "concepts");
    await expect(page.getByTestId("canvas-frame")).toHaveCount(3);
    const view = await viewportBox(page);
    for (const box of await page.getByTestId("canvas-frame").all()) {
      const rect = await box.boundingBox();
      if (rect === null) throw new Error("a frame has no box");
      expect(rect.x).toBeGreaterThanOrEqual(view.x - 1);
      expect(rect.x + rect.width).toBeLessThanOrEqual(view.x + view.width + 1);
    }
    expect(await zoomOf(page)).toBeLessThanOrEqual(1);
  });

  test("zoom at the cursor keeps the world point under it", async ({
    page,
  }) => {
    await openBoard(page, "concepts");
    const view = await viewportBox(page);
    const target = frame(page, seeded.concepts[0]?.artifactId ?? "");
    const cursor = {
      x: Math.round(view.x + view.width * 0.4),
      y: Math.round(view.y + view.height * 0.5),
    };
    const before = await target.boundingBox();
    if (before === null) throw new Error("no frame box");
    // The point of the frame under the cursor, as a fraction of the frame.
    const u = (cursor.x - before.x) / before.width;
    const v = (cursor.y - before.y) / before.height;
    for (const dy of [-12, -30, -30, 8, -20, 15, -30]) {
      await wheel(page, {
        dy,
        ctrl: true,
        x: cursor.x,
        y: cursor.y,
      });
      await page.waitForTimeout(40);
      const now = await target.boundingBox();
      if (now === null) throw new Error("no frame box");
      expect(Math.abs(now.x + u * now.width - cursor.x)).toBeLessThan(1);
      expect(Math.abs(now.y + v * now.height - cursor.y)).toBeLessThan(1);
    }
    await page.waitForTimeout(SETTLE_MS);
    const settled = await target.boundingBox();
    if (settled === null) throw new Error("no frame box");
    expect(Math.abs(settled.x + u * settled.width - cursor.x)).toBeLessThan(1);
  });

  test("a plain wheel pans by exactly the delta and the camera survives a reload", async ({
    page,
  }) => {
    await openBoard(page, "concepts");
    const before = await camera(page);
    await wheel(page, { dx: 37, dy: -21, x: 300, y: 300 });
    await page.waitForTimeout(SETTLE_MS);
    const after = await camera(page);
    expect(after.x - before.x).toBeCloseTo(-37, 6);
    expect(after.y - before.y).toBeCloseTo(21, 6);
    expect(after.s).toBe(before.s);
    await page.reload();
    await expect(page.getByTestId("canvas-frame").first()).toBeVisible();
    await page.waitForTimeout(SETTLE_MS);
    const restored = await camera(page);
    expect(restored.x).toBeCloseTo(after.x, 3);
    expect(restored.s).toBeCloseTo(after.s, 6);
  });

  test("dragging with Space held, and with the hand tool, pans", async ({
    page,
  }) => {
    await openBoard(page, "concepts");
    const view = await viewportBox(page);
    const start = { x: view.x + 200, y: view.y + view.height - 120 };
    const before = await camera(page);
    await page.keyboard.down("Space");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 80, start.y + 30, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.up("Space");
    await page.waitForTimeout(SETTLE_MS);
    const moved = await camera(page);
    expect(moved.x - before.x).toBeCloseTo(80, 0);
    expect(moved.y - before.y).toBeCloseTo(30, 0);

    await page.keyboard.press("h");
    await expect(
      page.getByRole("button", { name: "Hand tool" }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x - 50, start.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(SETTLE_MS);
    const dragged = await cameraOf(page);
    expect(dragged.x - moved.x).toBeCloseTo(-50, 0);
  });

  test("1 fits all, 2 fits the selection, 0 is 100 %", async ({ page }) => {
    await openBoard(page, "concepts");
    await page.keyboard.press("0");
    await page.waitForTimeout(SETTLE_MS);
    expect(await zoomOf(page)).toBe(1);
    await expect(page.getByTestId("zoom-readout")).toHaveText("100%");
    await page.getByRole("button", { name: /^Concept B,/u }).click();
    await page.keyboard.press("2");
    await page.waitForTimeout(SETTLE_MS);
    const selected = await camera(page);
    expect(selected.s).toBeGreaterThan(0.5);
    await page.keyboard.press("1");
    await page.waitForTimeout(SETTLE_MS);
    expect(await zoomOf(page)).toBeLessThan(selected.s);
  });

  test("double-click, Enter and Esc activate and exit the live frame without reloading it", async ({
    page,
  }) => {
    const documents: string[] = [];
    page.on("request", (request) => {
      if (
        request.resourceType() === "document" &&
        request.frame().parentFrame() !== null
      )
        documents.push(request.url());
    });
    await openBoard(page, "concepts");
    await expect(page.getByTestId("artifact-frame")).toHaveCount(3);
    await page.waitForTimeout(500);
    const loaded = documents.length;
    expect(loaded).toBe(3);

    const target = frame(page, seeded.concepts[1]?.artifactId ?? "");
    const iframe = target.getByTestId("artifact-frame");
    await target.dblclick();
    await expect(iframe).toHaveJSProperty("inert", false);
    await expect(page.getByTestId("exit-live")).toBeVisible();
    await expect(page.getByTestId("selection-ring")).toHaveAttribute(
      "data-active",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(iframe).toHaveJSProperty("inert", true);

    // Enter on the selected frame, Esc from inside the page via the bridge.
    await page.getByRole("button", { name: /^Concept B,/u }).focus();
    await page.keyboard.press("Enter");
    await expect(iframe).toHaveJSProperty("inert", false);
    const inside = page
      .frames()
      .find(
        (candidate) =>
          candidate.url().includes("/_t/") &&
          candidate.url().includes("/index.html"),
      );
    expect(inside).toBeDefined();
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await expect(iframe).toHaveJSProperty("inert", true);

    // Select, deselect, select others: still no navigation of any frame.
    await frame(page, seeded.concepts[0]?.artifactId ?? "").click();
    await page
      .getByTestId("canvas-viewport")
      .click({ position: { x: 20, y: 20 } });
    await page.waitForTimeout(500);
    expect(documents.length).toBe(loaded);
  });

  test("a ctrl-wheel the live frame forwards zooms the canvas", async ({
    page,
  }) => {
    await openBoard(page, "concepts");
    const target = frame(page, seeded.concepts[1]?.artifactId ?? "");
    await target.dblclick();
    await expect(target.getByTestId("artifact-frame")).toHaveJSProperty(
      "inert",
      false,
    );
    await expect
      .poll(
        () =>
          page.frames().filter((candidate) => candidate.url().includes("/_t/"))
            .length,
      )
      .toBeGreaterThan(0);
    await page.waitForTimeout(500);
    const before = await camera(page);
    const inside = page
      .frames()
      .filter((candidate) => candidate.url().includes("/_t/"));
    for (const candidate of inside)
      await candidate
        .evaluate(() => {
          globalThis.dispatchEvent(
            new WheelEvent("wheel", {
              deltaY: -40,
              ctrlKey: true,
              clientX: 100,
              clientY: 100,
              bubbles: true,
              cancelable: true,
            }),
          );
        })
        .catch(() => 0);
    await expect.poll(() => zoomOf(page)).toBeGreaterThan(before.s);
  });

  test("an agent publish adds a frame without moving the camera or reloading others", async ({
    page,
    baseURL,
  }) => {
    const api = agentApi(baseURL);
    await api.boards.create.mutate({ slug: "live", title: "Live updates" });
    const fixtures = await sharedFixtures();
    const publish = (title: string) =>
      publishFixture(String(baseURL), {
        board: "live",
        title,
        files: fixtures.htmlV1.files,
        entryPath: fixtures.htmlV1.entryPath,
      });
    await publish("First");
    await publish("Second");
    const documents: string[] = [];
    page.on("request", (request) => {
      if (
        request.resourceType() === "document" &&
        request.frame().parentFrame() !== null
      )
        documents.push(request.url());
    });
    await openBoard(page, "live");
    await expect(page.getByTestId("artifact-frame")).toHaveCount(2);
    await page.waitForTimeout(500);
    const before = await camera(page);
    const loaded = documents.length;

    await publish("Third");
    await expect(page.getByTestId("canvas-frame")).toHaveCount(3);
    await page.waitForTimeout(800);
    expect(await camera(page)).toEqual(before);
    // The new frame loads once; the two that were there never reload.
    expect(documents.length).toBe(loaded + 1);
  });

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
    // The pin's tip is where the click was.
    expect(Math.abs(pinBox.x + 2 - at.x)).toBeLessThan(3);
    expect(Math.abs(pinBox.y + pinBox.height - at.y)).toBeLessThan(3);

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

  test("reduced motion leaves nothing animating on the canvas", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openBoard(page, "concepts");
    await page.keyboard.press("0");
    // The camera jumps: there is no transition to wait for.
    await expect.poll(() => zoomOf(page)).toBe(1);
    // The global reduced-motion rule clamps durations to 0.01 ms.
    const animated = await page.locator(".ar-cv, .ar-cv *").evaluateAll(
      (elements) =>
        elements.filter((element) => {
          const style = getComputedStyle(element);
          const durations = [
            ...style.transitionDuration.split(","),
            ...(style.animationName === "none"
              ? []
              : style.animationDuration.split(",")),
          ].map((value) => Number.parseFloat(value));
          return Math.max(...durations) > 0.001;
        }).length,
    );
    expect(animated).toBe(0);
  });

  test("keyboard: Tab reaches the outline link first, then the frames in reading order", async ({
    page,
  }) => {
    await openBoard(page, "concepts");
    const webkit = page.context().browser()?.browserType().name() === "webkit";
    const tab = webkit ? "Alt+Tab" : "Tab";
    await page.keyboard.press(tab);
    await expect(page.locator(":focus")).toHaveText(
      "Review this board as a list",
    );
    const names: string[] = [];
    for (let press = 0; press < 40 && names.length < 3; press += 1) {
      await page.keyboard.press(tab);
      const label = await page.locator(":focus").getAttribute("aria-label");
      if (label?.startsWith("Concept") === true && label.includes("HTML"))
        names.push(label.slice(0, 9));
    }
    expect(names).toEqual(["Concept A", "Concept B", "Concept C"]);
  });

  test("the canvas has no axe violations, with a live frame and a pin", async ({
    page,
  }) => {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    await openBoard(page, "concepts");
    await page.keyboard.press("c");
    const view = await viewportBox(page);
    await page.mouse.click(view.x + 30, view.y + view.height - 30);
    const composer = page.getByTestId("placement-composer");
    await expect(composer).toBeVisible();
    await composer.getByRole("textbox").fill("A board note");
    await composer.getByRole("button", { name: "Comment" }).click();
    await expect(page.getByTestId("pin").first()).toBeVisible();
    // A corner: an earlier spec's pin sits at the middle of this frame.
    await frame(page, seeded.concepts[0]?.artifactId ?? "").dblclick({
      position: { x: 12, y: 12 },
    });
    await expect(page.getByTestId("exit-live")).toBeVisible();
    await page.waitForTimeout(800);
    // axe cannot see into a sandboxed opaque-origin frame, and WebKit hangs
    // waiting for the one that is live; the frame's content is not ours to check.
    const results = await new AxeBuilder({ page })
      .exclude("iframe")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      results.violations.map(
        (violation) =>
          `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
      ),
    ).toEqual([]);
  });
});
