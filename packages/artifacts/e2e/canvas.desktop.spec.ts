import { expect, test } from "@playwright/test";
import { agentApi, resetAndSeed, sharedFixtures } from "./review-setup.ts";
import {
  SETTLE_MS,
  camera,
  cameraOf,
  frame,
  openBoard,
  viewportBox,
  wheel,
  zoomOf,
} from "./canvas-helpers.ts";
import { publishFixture, type SeededBoards } from "./seed.ts";

let seeded: SeededBoards;

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(120_000);
  seeded = await resetAndSeed(baseURL);
});

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

  test("the tool pill shows the active tool: V select, H hand, C comment", async ({
    page,
  }) => {
    await openBoard(page, "concepts");
    const select = page.getByRole("button", { name: "Select tool" });
    const hand = page.getByRole("button", { name: "Hand tool" });
    const comment = page.getByRole("button", { name: "Comment mode" });
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("h");
    await expect(hand).toHaveAttribute("aria-pressed", "true");
    await expect(select).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("c");
    await expect(comment).toHaveAttribute("aria-pressed", "true");
    await expect(hand).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("v");
    await expect(select).toHaveAttribute("aria-pressed", "true");
    await expect(comment).toHaveAttribute("aria-pressed", "false");
    // Zoom and fit live in their own pill.
    await expect(
      page.getByRole("toolbar", { name: "Zoom" }).getByTestId("zoom-readout"),
    ).toBeVisible();
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
