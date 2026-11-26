import { expect, test, type Page } from "@playwright/test";
import { agentApi, resetAndSeed } from "./review-setup.ts";

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(120_000);
  await resetAndSeed(baseURL);
});

const SAVED_MS = 6000;
/** 100 %, so a screen pixel is a world pixel. */
const CAMERA = { x: 40, y: 140, s: 1 };

async function makeBoard(
  baseURL: string | undefined,
  slug: string,
): Promise<void> {
  await agentApi(baseURL).boards.create.mutate({
    slug,
    title: `Board ${slug}`,
  });
}

async function open(page: Page, slug: string): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      localStorage.setItem(String(key), String(value));
    },
    [`artifacts.canvas.camera.v1:${slug}`, JSON.stringify(CAMERA)],
  );
  await page.goto(`/b/${slug}`);
  await expect(page.getByTestId("canvas-viewport")).toBeVisible();
  await page.waitForTimeout(500);
}

type At = { x: number; y: number };

/** A world point as page coordinates at the camera every spec opens at. */
async function at(page: Page, world: At): Promise<At> {
  const box = await page.getByTestId("canvas-viewport").boundingBox();
  if (box === null) throw new Error("no viewport");
  return { x: box.x + CAMERA.x + world.x, y: box.y + CAMERA.y + world.y };
}

async function dragWorld(page: Page, from: At, to: At): Promise<void> {
  const start = await at(page, from);
  const end = await at(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move((start.x + end.x) / 2, (start.y + end.y) / 2, {
    steps: 4,
  });
  await page.mouse.move(end.x, end.y, { steps: 4 });
  await page.mouse.up();
}

async function notesOf(baseURL: string | undefined, slug: string) {
  const board = await agentApi(baseURL).boards.get.query({ slug });
  return board.index.notes;
}

async function noteOf(baseURL: string | undefined, slug: string, id: string) {
  const notes = await notesOf(baseURL, slug);
  return notes[id];
}

/** The only note of a kind, once it has been saved. */
async function waitForNote(
  baseURL: string | undefined,
  slug: string,
  type: string,
) {
  let found: unknown;
  await expect
    .poll(
      async () => {
        const notes = await notesOf(baseURL, slug);
        found = Object.entries(notes).find(([, note]) => note.type === type);
        return found !== undefined;
      },
      { timeout: SAVED_MS },
    )
    .toBe(true);
  const notes = await notesOf(baseURL, slug);
  const entry = Object.entries(notes).find(([, note]) => note.type === type);
  if (entry === undefined) throw new Error(`no ${type} note`);
  return { id: entry[0], note: entry[1] };
}

function selectTool(page: Page) {
  return page.getByRole("button", { name: "Select tool" });
}

test.describe("annotations", () => {
  test("a box, line, arrow and pen stroke are drawn with a drag and the tool reverts", async ({
    page,
    baseURL,
  }) => {
    await makeBoard(baseURL, "draw");
    await open(page, "draw");
    const cases = [
      ["b", "box", { x: 40, y: 40 }, { x: 240, y: 160 }],
      ["l", "line", { x: 300, y: 60 }, { x: 460, y: 60 }],
      ["a", "arrow", { x: 300, y: 140 }, { x: 460, y: 200 }],
    ] as const;
    for (const [key, type, from, to] of cases) {
      await page.keyboard.press(key);
      await expect(
        page.getByRole("button", { name: new RegExp(`^${type} tool$`, "iu") }),
      ).toHaveAttribute("aria-pressed", "true");
      await dragWorld(page, from, to);
      const { note } = await waitForNote(baseURL, "draw", type);
      expect(note.type).toBe(type);
      // One shape, then back to select.
      await expect(selectTool(page)).toHaveAttribute("aria-pressed", "true");
    }
    const found = await waitForNote(baseURL, "draw", "box");
    expect(found.note).toMatchObject({ type: "box", w: 200, h: 120 });

    await page.keyboard.press("p");
    const start = await at(page, { x: 100, y: 300 });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (let step = 1; step <= 40; step += 1)
      await page.mouse.move(
        start.x + step * 6,
        start.y + Math.sin(step / 4) * 40,
      );
    await page.mouse.up();
    const pen = await waitForNote(baseURL, "draw", "pen");
    if (pen.note.type !== "pen") throw new Error("expected a pen note");
    expect(pen.note.points.length).toBeGreaterThanOrEqual(2);
    expect(pen.note.points.length).toBeLessThanOrEqual(500);
    // Simplified: far fewer points than mouse events.
    expect(pen.note.points.length).toBeLessThan(41);
    await expect(page.getByTestId("note")).toHaveCount(4);
  });

  test("holding Shift when a shape ends keeps the tool", async ({
    page,
    baseURL,
  }) => {
    await makeBoard(baseURL, "lock");
    await open(page, "lock");
    await page.keyboard.press("b");
    await page.keyboard.down("Shift");
    await dragWorld(page, { x: 20, y: 20 }, { x: 120, y: 100 });
    await dragWorld(page, { x: 200, y: 20 }, { x: 300, y: 100 });
    await page.keyboard.up("Shift");
    await expect
      .poll(async () => Object.keys(await notesOf(baseURL, "lock")).length, {
        timeout: SAVED_MS,
      })
      .toBe(2);
    await expect(
      page.getByRole("button", { name: "Box tool" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("a sticky and a title are typed into an overlay textarea, and empty ones are dropped", async ({
    page,
    baseURL,
  }) => {
    await makeBoard(baseURL, "text");
    await open(page, "text");
    await page.keyboard.press("s");
    await dragWorld(page, { x: 40, y: 40 }, { x: 260, y: 200 });
    const editor = page.getByTestId("note-editor");
    await expect(editor).toBeVisible();
    await editor.fill("Needs a sharper headline");
    await page.keyboard.press("Control+Enter");
    const sticky = await waitForNote(baseURL, "text", "sticky");
    expect(sticky.note).toMatchObject({
      text: "Needs a sharper headline",
      w: 220,
      h: 160,
    });
    await expect(page.getByTestId("note-editor")).toHaveCount(0);
    await expect(page.locator('[data-kind="sticky"]').first()).toContainText(
      "Needs a sharper headline",
    );

    await page.keyboard.press("t");
    const click = await at(page, { x: 400, y: 80 });
    await page.mouse.click(click.x, click.y);
    await page.getByTestId("note-editor").fill("Option B");
    await page.keyboard.press("Control+Enter");
    const title = await waitForNote(baseURL, "text", "title");
    expect(title.note).toMatchObject({ text: "Option B", size: "m" });

    // An empty sticky is not kept.
    await page.keyboard.press("s");
    const empty = await at(page, { x: 400, y: 300 });
    await page.mouse.click(empty.x, empty.y);
    await expect(page.getByTestId("note-editor")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    expect(Object.keys(await notesOf(baseURL, "text"))).toHaveLength(2);
  });

  test("double-click and Enter edit a sticky's text, and undo restores it", async ({
    page,
    baseURL,
  }) => {
    await makeBoard(baseURL, "edit");
    await open(page, "edit");
    await page.keyboard.press("s");
    await dragWorld(page, { x: 40, y: 40 }, { x: 260, y: 200 });
    await page.getByTestId("note-editor").fill("First");
    await page.keyboard.press("Control+Enter");
    const { id } = await waitForNote(baseURL, "edit", "sticky");

    const inside = await at(page, { x: 100, y: 100 });
    await page.mouse.dblclick(inside.x, inside.y);
    const editor = page.getByTestId("note-editor");
    await expect(editor).toBeVisible();
    await editor.fill("Second");
    await page.keyboard.press("Control+Enter");
    await expect
      .poll(() => noteOf(baseURL, "edit", id), {
        timeout: SAVED_MS,
      })
      .toMatchObject({ text: "Second" });

    await page.keyboard.press("Enter");
    await expect(page.getByTestId("note-editor")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("note-editor")).toHaveCount(0);

    await page.keyboard.press("Control+z");
    await expect
      .poll(() => noteOf(baseURL, "edit", id), {
        timeout: SAVED_MS,
      })
      .toMatchObject({ text: "First" });
  });

  test("a box is grabbed by its border, not its empty middle; a line within 6 px", async ({
    page,
    baseURL,
  }) => {
    await makeBoard(baseURL, "hit");
    await open(page, "hit");
    await page.keyboard.press("b");
    await dragWorld(page, { x: 40, y: 40 }, { x: 240, y: 160 });
    await page.keyboard.press("l");
    await dragWorld(page, { x: 300, y: 100 }, { x: 460, y: 100 });
    await waitForNote(baseURL, "hit", "line");
    const rings = page.getByTestId("selection-ring");
    // Empty middle of the box: nothing is selected.
    const middle = await at(page, { x: 140, y: 100 });
    await page.mouse.click(middle.x, middle.y);
    await expect(rings).toHaveCount(0);
    // Its border.
    const border = await at(page, { x: 140, y: 41 });
    await page.mouse.click(border.x, border.y);
    await expect(rings).toHaveCount(1);
    await page.mouse.click(middle.x, middle.y);
    await expect(rings).toHaveCount(0);
    // 5 px from the line hits, 12 px does not.
    const near = await at(page, { x: 380, y: 105 });
    await page.mouse.click(near.x, near.y);
    await expect(rings).toHaveCount(1);
    const far = await at(page, { x: 380, y: 112 });
    await page.mouse.click(far.x, far.y);
    await expect(rings).toHaveCount(0);
  });

  test("move, resize a box and drag a line's end, each saved as one op and undoable", async ({
    page,
    baseURL,
  }) => {
    await makeBoard(baseURL, "arrange");
    await open(page, "arrange");
    await page.keyboard.press("b");
    await dragWorld(page, { x: 40, y: 40 }, { x: 240, y: 160 });
    const box = await waitForNote(baseURL, "arrange", "box");

    // Move by its border (away from the resize handles).
    await dragWorld(page, { x: 90, y: 160 }, { x: 106, y: 192 });
    await expect
      .poll(() => noteOf(baseURL, "arrange", box.id), {
        timeout: SAVED_MS,
      })
      .toMatchObject({ x: 56, y: 72 });

    // Resize from the south-east handle.
    const handle = await page.locator('[data-handle="se"]').boundingBox();
    if (handle === null) throw new Error("no handle");
    const from = {
      x: handle.x + handle.width / 2,
      y: handle.y + handle.height / 2,
    };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, from.y + 30, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(() => noteOf(baseURL, "arrange", box.id), {
        timeout: SAVED_MS,
      })
      .toMatchObject({ w: 240, h: 152 });
    await page.keyboard.press("Control+z");
    await expect
      .poll(() => noteOf(baseURL, "arrange", box.id), {
        timeout: SAVED_MS,
      })
      .toMatchObject({ w: 200, h: 120 });
    await page.keyboard.press("Control+Shift+z");

    // A line's end.
    await page.keyboard.press("Escape");
    await page.keyboard.press("l");
    await dragWorld(page, { x: 400, y: 300 }, { x: 500, y: 300 });
    const line = await waitForNote(baseURL, "arrange", "line");
    const onLine = await at(page, { x: 450, y: 300 });
    await page.mouse.click(onLine.x, onLine.y);
    await expect(page.locator(`[data-endpoint="end"]`)).toBeVisible();
    const end = await page.locator('[data-endpoint="end"]').boundingBox();
    if (end === null) throw new Error("no endpoint");
    const endAt = { x: end.x + end.width / 2, y: end.y + end.height / 2 };
    await page.mouse.move(endAt.x, endAt.y);
    await page.mouse.down();
    await page.mouse.move(endAt.x + 20, endAt.y + 60, { steps: 5 });
    await page.mouse.up();
    await expect
      .poll(() => noteOf(baseURL, "arrange", line.id), {
        timeout: SAVED_MS,
      })
      .toMatchObject({ x: 400, y: 300, x2: 520, y2: 360 });
  });

  test("delete removes an annotation at once and undo brings it back; z-order and colour work", async ({
    page,
    baseURL,
  }) => {
    await makeBoard(baseURL, "life");
    await open(page, "life");
    await page.keyboard.press("s");
    await dragWorld(page, { x: 40, y: 40 }, { x: 240, y: 200 });
    await page.getByTestId("note-editor").fill("Keep me");
    await page.keyboard.press("Control+Enter");
    const sticky = await waitForNote(baseURL, "life", "sticky");
    await page.keyboard.press("b");
    await dragWorld(page, { x: 100, y: 100 }, { x: 300, y: 260 });
    await waitForNote(baseURL, "life", "box");
    const stickyPoint = await at(page, { x: 60, y: 60 });
    await page.mouse.click(stickyPoint.x, stickyPoint.y);

    // Colour the selected sticky.
    await page.getByRole("button", { name: "Blue" }).click();
    await expect
      .poll(() => noteOf(baseURL, "life", sticky.id), {
        timeout: SAVED_MS,
      })
      .toMatchObject({ color: "blue" });

    // Bring it to the front with `}`: the order puts it last.
    await page.keyboard.press("}");
    await expect
      .poll(
        async () => {
          const board = await agentApi(baseURL).boards.get.query({
            slug: "life",
          });
          return board.index.order.at(-1);
        },
        { timeout: SAVED_MS },
      )
      .toBe(sticky.id);

    // No confirm for an annotation.
    await page.keyboard.press("Delete");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(() => noteOf(baseURL, "life", sticky.id), {
        timeout: SAVED_MS,
      })
      .toBeUndefined();
    await page.keyboard.press("Control+z");
    await expect
      .poll(() => noteOf(baseURL, "life", sticky.id), {
        timeout: SAVED_MS,
      })
      .toMatchObject({ text: "Keep me", color: "blue" });
    await page.keyboard.press("Control+Shift+z");
    await expect
      .poll(() => noteOf(baseURL, "life", sticky.id), {
        timeout: SAVED_MS,
      })
      .toBeUndefined();
  });

  test("annotations persist across a reload, and an agent's putNote appears live", async ({
    page,
    baseURL,
  }) => {
    await makeBoard(baseURL, "live-notes");
    await open(page, "live-notes");
    await page.keyboard.press("a");
    await dragWorld(page, { x: 40, y: 40 }, { x: 240, y: 120 });
    await waitForNote(baseURL, "live-notes", "arrow");
    await page.reload();
    await expect(page.locator('[data-kind="arrow"]')).toHaveCount(1);
    await page.waitForTimeout(500);

    await agentApi(baseURL).boards.applyOps.mutate({
      slug: "live-notes",
      ops: [
        {
          op: "putNote",
          id: "agent-sticky",
          note: {
            type: "sticky",
            page: 0,
            x: 300,
            y: 40,
            w: 200,
            h: 120,
            text: "From the agent",
            color: "green",
          },
        },
        {
          op: "putNote",
          id: "agent-pen",
          note: {
            type: "pen",
            page: 0,
            x: 300,
            y: 220,
            points: [
              [0, 0],
              [40, 30],
              [80, 0],
            ],
            color: "red",
          },
        },
      ],
    });
    const sticky = page.locator('[data-note-id="agent-sticky"]');
    await expect(sticky).toContainText("From the agent");
    await expect(page.locator('[data-note-id="agent-pen"] path')).toHaveCount(
      1,
    );
    // The outline, the screen-reader path, lists the text of stickies and titles.
    await page.goto("/b/live-notes/outline");
    await expect(
      page.getByRole("list", { name: "Annotations on the board" }),
    ).toContainText("From the agent");
    await page.goBack();
    await expect(sticky).toContainText("From the agent");
    // The camera did not move.
    const transform = await page
      .getByTestId("canvas-world")
      .evaluate((element) =>
        element instanceof HTMLElement ? element.style.transform : "",
      );
    expect(transform).toBe("translate(40px, 140px) scale(1)");
  });

  test("annotations render in the world layer, which is not promoted at rest", async ({
    page,
    baseURL,
  }) => {
    await makeBoard(baseURL, "sharp");
    await open(page, "sharp");
    await page.keyboard.press("b");
    await dragWorld(page, { x: 40, y: 40 }, { x: 240, y: 160 });
    await waitForNote(baseURL, "sharp", "box");
    const inWorld = await page
      .getByTestId("canvas-world")
      .locator('[data-testid="note"]')
      .count();
    expect(inWorld).toBe(1);
    await page.waitForTimeout(500);
    // `will-change: transform` is only set while the camera moves, so host-DOM
    // text and strokes stay crisp once it settles.
    const willChange = await page
      .getByTestId("canvas-world")
      .evaluate((element) => getComputedStyle(element).willChange);
    expect(willChange).toBe("auto");
  });

  test("the annotated canvas has no axe violations, with the palette and an editor open", async ({
    page,
    baseURL,
  }) => {
    const { default: AxeBuilder } = await import("@axe-core/playwright");
    await makeBoard(baseURL, "axe-notes");
    await open(page, "axe-notes");
    await page.keyboard.press("s");
    await dragWorld(page, { x: 40, y: 40 }, { x: 240, y: 200 });
    await page.getByTestId("note-editor").fill("Hello");
    await page.keyboard.press("Control+Enter");
    await waitForNote(baseURL, "axe-notes", "sticky");
    await page.keyboard.press("t");
    const click = await at(page, { x: 400, y: 80 });
    await page.mouse.click(click.x, click.y);
    await expect(page.getByTestId("note-editor")).toBeVisible();
    await expect(page.getByTestId("palette")).toBeVisible();
    const results = await new AxeBuilder({ page })
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
