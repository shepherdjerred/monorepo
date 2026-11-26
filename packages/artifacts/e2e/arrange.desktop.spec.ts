import { expect, test, type Page } from "@playwright/test";
import { agentApi, resetAndSeed, sharedFixtures } from "./review-setup.ts";
import { publishFixture } from "./seed.ts";

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(120_000);
  await resetAndSeed(baseURL);
});

const SAVED_MS = 6000;
/** The camera every spec opens at: 100 %, so a screen pixel is a world pixel. */
const CAMERA = { x: 40, y: 80, s: 1 };

type Ids = readonly string[];

/** A board of `count` HTML frames: a row of 640 x 420 frames 680 apart, from the origin. */
async function makeBoard(
  baseURL: string | undefined,
  slug: string,
  options: { count?: number; viewport?: boolean } = {},
): Promise<Ids> {
  const api = agentApi(baseURL);
  await api.boards.create.mutate({ slug, title: `Board ${slug}` });
  const fixtures = await sharedFixtures();
  const ids: string[] = [];
  for (let at = 0; at < (options.count ?? 3); at += 1) {
    const published = await publishFixture(String(baseURL), {
      board: slug,
      title: `Frame ${String(at + 1)}`,
      files: fixtures.htmlV1.files,
      entryPath: fixtures.htmlV1.entryPath,
      ...(options.viewport === false
        ? {}
        : { viewport: { width: 1440, height: 900 } }),
    });
    ids.push(published.artifactId);
  }
  return ids;
}

async function open(page: Page, slug: string): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(String(key), String(value));
    },
    [`artifacts.canvas.camera.v1:${slug}`, JSON.stringify(CAMERA)],
  );
  await page.goto(`/b/${slug}`);
  await expect(page.getByTestId("canvas-frame").first()).toBeVisible();
  await page.waitForTimeout(500);
}

function frame(page: Page, id: string) {
  return page.locator(`[data-frame-id="${id}"]`);
}

async function centre(page: Page, id: string) {
  const box = await frame(page, id).boundingBox();
  if (box === null) throw new Error("frame has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function drag(
  page: Page,
  from: { x: number; y: number },
  by: { x: number; y: number },
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + by.x / 2, from.y + by.y / 2, { steps: 4 });
  await page.mouse.move(from.x + by.x, from.y + by.y, { steps: 4 });
  await page.mouse.up();
}

async function serverFrame(
  baseURL: string | undefined,
  slug: string,
  id: string,
) {
  const board = await agentApi(baseURL).boards.get.query({ slug });
  return board.index.frames[id];
}

async function serverOrder(baseURL: string | undefined, slug: string) {
  const board = await agentApi(baseURL).boards.get.query({ slug });
  return board.index.order;
}

async function cameraTransform(page: Page): Promise<string> {
  return page
    .getByTestId("canvas-world")
    .evaluate((element) =>
      element instanceof HTMLElement ? element.style.transform : "",
    );
}

test.describe("arranging", () => {
  test("click selects, Shift-click adds, a marquee selects what it touches", async ({
    page,
    baseURL,
  }) => {
    const [a = "", b = "", c = ""] = await makeBoard(baseURL, "select");
    await open(page, "select");
    const rings = page.getByTestId("selection-ring");
    await expect(rings).toHaveCount(0);
    const first = await centre(page, a);
    await page.mouse.click(first.x, first.y);
    await expect(rings).toHaveCount(1);
    const second = await centre(page, b);
    await page.keyboard.down("Shift");
    await page.mouse.click(second.x, second.y);
    await page.keyboard.up("Shift");
    await expect(rings).toHaveCount(2);
    // A click on empty canvas clears.
    const view = await page.getByTestId("canvas-viewport").boundingBox();
    if (view === null) throw new Error("no viewport");
    await page.mouse.click(view.x + 10, view.y + 10);
    await expect(rings).toHaveCount(0);

    // A marquee from empty canvas across the first two frames and not the third.
    await page.mouse.move(view.x + 10, view.y + 10);
    await page.mouse.down();
    await page.mouse.move(view.x + 780, view.y + 300, { steps: 6 });
    await expect(page.getByTestId("marquee")).toBeVisible();
    await expect(rings).toHaveCount(2);
    await page.mouse.up();
    await expect(page.getByTestId("marquee")).toHaveCount(0);
    await expect(rings).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: /^Frame 3,/u }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(c).toBeDefined();
  });

  test("dragging moves a frame on the 8 px grid, Alt moves it freely, and it persists", async ({
    page,
    baseURL,
  }) => {
    const [a = ""] = await makeBoard(baseURL, "drag");
    await open(page, "drag");
    const start = await centre(page, a);
    await drag(page, start, { x: 101, y: 53 });
    await expect
      .poll(() => serverFrame(baseURL, "drag", a), { timeout: SAVED_MS })
      .toMatchObject({ x: 104, y: 56 });

    await page.keyboard.down("Alt");
    const next = await centre(page, a);
    await drag(page, next, { x: 13, y: 9 });
    await page.keyboard.up("Alt");
    await expect
      .poll(() => serverFrame(baseURL, "drag", a), { timeout: SAVED_MS })
      .toMatchObject({ x: 117, y: 65 });

    await page.reload();
    await expect(page.getByTestId("canvas-frame").first()).toBeVisible();
    await page.waitForTimeout(500);
    const box = await frame(page, a).boundingBox();
    const view = await page.getByTestId("canvas-viewport").boundingBox();
    if (box === null || view === null) throw new Error("no boxes");
    expect(box.x - view.x).toBeCloseTo(CAMERA.x + 117, 0);
    expect(box.y - view.y).toBeCloseTo(CAMERA.y + 65, 0);
  });

  test("a fixed-viewport frame keeps its aspect on resize, a responsive one resizes freely", async ({
    page,
    baseURL,
  }) => {
    const [fixed = ""] = await makeBoard(baseURL, "resize-fixed", { count: 1 });
    await open(page, "resize-fixed");
    await page.getByRole("button", { name: /^Frame 1,/u }).click();
    await expect(page.locator("[data-handle]")).toHaveCount(8);
    const handle = await page.locator('[data-handle="se"]').boundingBox();
    if (handle === null) throw new Error("no handle");
    await drag(
      page,
      { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 },
      { x: 160, y: 10 },
    );
    await expect
      .poll(() => serverFrame(baseURL, "resize-fixed", fixed), {
        timeout: SAVED_MS,
      })
      .toMatchObject({ w: 800, h: 500 });

    const [free = ""] = await makeBoard(baseURL, "resize-free", {
      count: 1,
      viewport: false,
    });
    await open(page, "resize-free");
    await page.getByRole("button", { name: /^Frame 1,/u }).click();
    const corner = await page.locator('[data-handle="se"]').boundingBox();
    if (corner === null) throw new Error("no handle");
    await drag(
      page,
      { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 },
      { x: 160, y: 10 },
    );
    await expect
      .poll(() => serverFrame(baseURL, "resize-free", free), {
        timeout: SAVED_MS,
      })
      .toMatchObject({ w: 800, h: 432 });
  });

  test("an agent publish during a drag keeps both changes and does not move the camera", async ({
    page,
    baseURL,
  }) => {
    const [a = ""] = await makeBoard(baseURL, "midair");
    await open(page, "midair");
    const cameraBefore = await cameraTransform(page);
    const start = await centre(page, a);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y + 24, { steps: 4 });
    await page.mouse.move(start.x + 64, start.y + 40, { steps: 2 });

    // The agent publishes while the drag is held.
    const fixtures = await sharedFixtures();
    await publishFixture(String(baseURL), {
      board: "midair",
      title: "Agent frame",
      files: fixtures.htmlV1.files,
      entryPath: fixtures.htmlV1.entryPath,
      viewport: { width: 1440, height: 900 },
    });
    await expect(page.getByTestId("canvas-frame")).toHaveCount(4);
    // The dragged frame is still under the pointer after the refetch.
    const during = await frame(page, a).boundingBox();
    expect(during?.x).toBeGreaterThan(start.box.x + 50);
    await page.mouse.move(start.x + 80, start.y + 56, { steps: 3 });
    await page.mouse.up();

    await expect
      .poll(() => serverFrame(baseURL, "midair", a), {
        timeout: SAVED_MS,
      })
      .toMatchObject({ x: 80, y: 56 });
    const board = await agentApi(baseURL).boards.get.query({ slug: "midair" });
    expect(Object.keys(board.index.frames)).toHaveLength(4);
    expect(await cameraTransform(page)).toBe(cameraBefore);

    const toast = page.getByTestId("new-frame-toast");
    await expect(toast).toContainText("New frame: Agent frame");
    await toast.getByRole("button", { name: "Jump to" }).click();
    await expect(page.getByTestId("selection-ring")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: /^Agent frame,/u }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(toast).toHaveCount(0);
  });

  test("undo and redo walk the applied ops", async ({ page, baseURL }) => {
    const [a = ""] = await makeBoard(baseURL, "history");
    await open(page, "history");
    const start = await centre(page, a);
    await drag(page, start, { x: 96, y: 48 });
    await expect
      .poll(() => serverFrame(baseURL, "history", a), {
        timeout: SAVED_MS,
      })
      .toMatchObject({ x: 96, y: 48 });
    await page.keyboard.press("Control+z");
    await expect
      .poll(() => serverFrame(baseURL, "history", a), {
        timeout: SAVED_MS,
      })
      .toMatchObject({ x: 0, y: 0 });
    const undone = await frame(page, a).boundingBox();
    expect(undone?.x).toBeCloseTo(start.box.x, 0);
    await page.keyboard.press("Control+Shift+z");
    await expect
      .poll(() => serverFrame(baseURL, "history", a), {
        timeout: SAVED_MS,
      })
      .toMatchObject({ x: 96, y: 48 });
  });

  test("arrows nudge by 1 px and Shift by 10, and a run is one undo", async ({
    page,
    baseURL,
  }) => {
    const [a = ""] = await makeBoard(baseURL, "nudge");
    await open(page, "nudge");
    await page.getByRole("button", { name: /^Frame 1,/u }).click();
    for (let press = 0; press < 3; press += 1)
      await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    await expect
      .poll(() => serverFrame(baseURL, "nudge", a), { timeout: SAVED_MS })
      .toMatchObject({ x: 3, y: 10 });
    await expect(
      page.getByRole("status").filter({ hasText: "Moved" }),
    ).toBeVisible();
    await page.keyboard.press("Control+z");
    await expect
      .poll(() => serverFrame(baseURL, "nudge", a), { timeout: SAVED_MS })
      .toMatchObject({ x: 0, y: 0 });
  });

  test("[ and ] change z-order and the stacking follows without moving iframes", async ({
    page,
    baseURL,
  }) => {
    const [a = "", b = "", c = ""] = await makeBoard(baseURL, "order");
    await open(page, "order");
    const iframes = await page
      .locator("iframe")
      .evaluateAll((all) =>
        all.map((element) => element.getAttribute("title")),
      );
    await page.getByRole("button", { name: /^Frame 1,/u }).click();
    await page.keyboard.press("]");
    await expect
      .poll(() => serverOrder(baseURL, "order"), { timeout: SAVED_MS })
      .toEqual([b, a, c]);
    await expect(frame(page, a)).toHaveCSS("z-index", "2");
    await page.keyboard.press("}");
    await expect
      .poll(() => serverOrder(baseURL, "order"), { timeout: SAVED_MS })
      .toEqual([b, c, a]);
    await page.keyboard.press("[");
    await expect
      .poll(() => serverOrder(baseURL, "order"), { timeout: SAVED_MS })
      .toEqual([b, a, c]);
    // The iframes are in the same DOM order: nothing was moved, so nothing reloaded.
    expect(
      await page
        .locator("iframe")
        .evaluateAll((all) =>
          all.map((element) => element.getAttribute("title")),
        ),
    ).toEqual(iframes);
  });

  test("delete asks first, removes only from the board, and undo brings it back", async ({
    page,
    baseURL,
  }) => {
    const [, b = ""] = await makeBoard(baseURL, "remove");
    await open(page, "remove");
    await page.getByRole("button", { name: /^Frame 2,/u }).click();
    await page.keyboard.press("Delete");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Remove “Frame 2” from the board?");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("canvas-frame")).toHaveCount(3);

    await page.keyboard.press("Delete");
    await page.getByTestId("confirm-remove").click();
    await expect(page.getByTestId("canvas-frame")).toHaveCount(2);
    await expect
      .poll(() => serverFrame(baseURL, "remove", b), {
        timeout: SAVED_MS,
      })
      .toBeUndefined();
    // The artifact itself is untouched.
    const artifact = await agentApi(baseURL).artifacts.get.query({
      id: b,
    });
    expect(artifact.title).toBe("Frame 2");

    await page.keyboard.press("Control+z");
    await expect(page.getByTestId("canvas-frame")).toHaveCount(3);
    await expect
      .poll(() => serverFrame(baseURL, "remove", b), {
        timeout: SAVED_MS,
      })
      .toMatchObject({ x: 680, y: 0, w: 640, h: 420 });
  });

  test("hiding the page flushes the save at once", async ({
    page,
    baseURL,
  }) => {
    const [a = ""] = await makeBoard(baseURL, "flush");
    await open(page, "flush");
    const requests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("boards.applyOps"))
        requests.push(request.url());
    });
    await page.getByRole("button", { name: /^Frame 1,/u }).click();
    await page.keyboard.press("ArrowRight");
    await page.evaluate(() => {
      globalThis.dispatchEvent(new globalThis.Event("pagehide"));
    });
    // The beacon is not a batch call; the debounced save would be.
    await expect
      .poll(() => requests.some((url) => !url.includes("batch=1")), {
        timeout: 2000,
      })
      .toBe(true);
    await expect
      .poll(() => serverFrame(baseURL, "flush", a), { timeout: SAVED_MS })
      .toMatchObject({ x: 1 });
  });

  test("dragging to the edge pans the camera and the frame follows", async ({
    page,
    baseURL,
  }) => {
    const [a = ""] = await makeBoard(baseURL, "edge");
    await open(page, "edge");
    const view = await page.getByTestId("canvas-viewport").boundingBox();
    if (view === null) throw new Error("no viewport");
    const start = await centre(page, a);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 20, start.y, { steps: 2 });
    await page.mouse.move(view.x + view.width - 6, start.y, { steps: 6 });
    const before = await cameraTransform(page);
    await page.waitForTimeout(600);
    expect(await cameraTransform(page)).not.toBe(before);
    await page.mouse.up();
    const pointerTravel = view.width - 6 - (start.x - view.x);
    await expect
      .poll(
        async () => {
          const moved = await serverFrame(baseURL, "edge", a);
          return moved?.x ?? 0;
        },
        { timeout: SAVED_MS },
      )
      .toBeGreaterThan(pointerTravel + 40);
  });

  test("Escape cancels a drag", async ({ page, baseURL }) => {
    const [a = ""] = await makeBoard(baseURL, "cancel", { count: 1 });
    await open(page, "cancel");
    const start = await centre(page, a);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 120, start.y + 80, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(800);
    const box = await frame(page, a).boundingBox();
    expect(box?.x).toBeCloseTo(start.box.x, 0);
    expect(await serverFrame(baseURL, "cancel", a)).toMatchObject({
      x: 0,
      y: 0,
    });
  });

  test("the arranged canvas has no axe violations", async ({
    page,
    baseURL,
  }) => {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    await makeBoard(baseURL, "axe");
    await open(page, "axe");
    await page.getByRole("button", { name: /^Frame 1,/u }).click();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("[data-handle]")).toHaveCount(8);
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
