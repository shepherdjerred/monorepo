import { expect, test } from "@playwright/test";
import { ACTOR_HEADER } from "#shared/contract.ts";
import { encodeActor } from "./client.ts";
import {
  agentApi,
  commentWithMode,
  enterCommentMode,
  drain,
  KARPATHY,
  openFocused,
  resetAndSeed,
  sharedFixtures,
} from "./review-setup.ts";
import { publishFixture, type SeededBoards } from "./seed.ts";

let seeded: SeededBoards;

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(120_000);
  seeded = await resetAndSeed(baseURL);
});

const FRAME_SANDBOX = "allow-scripts allow-forms allow-popups";

test.describe("inbox", () => {
  test("lists boards with counts and expiry, and keeps and archives them", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Inbox", level: 1 }),
    ).toBeVisible();
    await page.getByRole("radio", { name: /^Active/u }).click();
    const rows = page.getByTestId("inbox-row");
    await expect(rows).toHaveCount(2);
    const demo = rows.filter({ hasText: "Demo board" });
    await expect(demo).toContainText("10 artifacts");
    await expect(demo.getByTestId("expiry")).toHaveText("Expires in 90 days");

    await demo.getByRole("button", { name: "Keep" }).click();
    await expect(demo.getByRole("button", { name: "Kept" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(demo).toContainText("Kept");

    await page.getByRole("radio", { name: /^Kept/u }).click();
    await expect(rows).toHaveCount(1);
    await demo.getByRole("button", { name: "Kept" }).click();

    // Archive confirms first and says when the files go.
    await page.getByRole("radio", { name: /^Active/u }).click();
    await rows
      .filter({ hasText: "Concepts" })
      .getByRole("button", { name: "Archive" })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("7 days");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(rows).toHaveCount(2);
    await rows
      .filter({ hasText: "Concepts" })
      .getByRole("button", { name: "Archive" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Archive board" })
      .click();
    await expect(rows).toHaveCount(1);
    await page.getByRole("radio", { name: /^Archived/u }).click();
    await expect(rows.filter({ hasText: "Concepts" })).toBeVisible();
    await rows.getByRole("button", { name: "Restore" }).click();
    await expect(rows).toHaveCount(0);
  });
});

test.describe("pdf", () => {
  test("a pin on page 2 reaches the agent with its page anchor", async ({
    page,
    baseURL,
  }) => {
    await openFocused(page, seeded.demo.pdf.artifactId);
    const second = page.locator('[data-testid="pdf-page"][data-page="2"]');
    await second.scrollIntoViewIfNeeded();
    await expect(second.locator("canvas")).toBeVisible();

    await enterCommentMode(page);
    await expect(page.getByTestId("comment-mode")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const box = await second.boundingBox();
    if (box === null) throw new Error("page 2 has no box");
    await page.mouse.click(box.x + box.width * 0.25, box.y + box.height * 0.4);
    await commentWithMode(page, "The heading on page two is too small");

    await expect(page.getByTestId("pin")).toHaveText("1");
    await expect(page.getByTestId("delivery-chip")).toHaveText("Queued");

    const claim = await agentApi(baseURL).feedback.claim.mutate({
      scope: { type: "artifact", artifactId: seeded.demo.pdf.artifactId },
    });
    const [item] = claim.items;
    expect(item?.thread.anchor.type).toBe("page");
    if (item?.thread.anchor.type !== "page")
      throw new Error("expected a page anchor");
    expect(item.thread.anchor.page).toBe(2);
    expect(item.thread.anchor.x).toBeCloseTo(0.25, 1);
    expect(item.thread.anchor.y).toBeCloseTo(0.4, 1);
    expect(item.comment.body).toBe("The heading on page two is too small");

    // The live stream moves the chip without a reload.
    await expect(page.getByTestId("delivery-chip")).toHaveText(
      "Sent to karpathy",
    );
    await agentApi(baseURL).feedback.ack.mutate({
      commentIds: [item.comment.id],
    });
    await expect(page.getByTestId("delivery-chip")).toHaveText(
      "Delivered to karpathy",
    );
  });

  test("renders a text layer in the focused view", async ({ page }) => {
    await openFocused(page, seeded.demo.pdf.artifactId);
    await expect(page.locator(".textLayer").first()).toContainText("Page one");
  });
});

test.describe("html frames", () => {
  test("the frame is sandboxed, inert until activated, and exits with Esc or the chip", async ({
    page,
  }) => {
    await page.goto(`/b/concepts`);
    const frame = page.getByTestId("artifact-frame").first();
    await expect(frame).toHaveAttribute("sandbox", FRAME_SANDBOX);
    expect(await frame.getAttribute("sandbox")).not.toContain(
      "allow-same-origin",
    );
    await expect(frame).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(frame).toHaveAttribute("allow", "");
    await expect(frame).toHaveJSProperty("inert", true);

    const cell = page.getByTestId("canvas-frame").first();
    await cell.dblclick();
    await expect(frame).toHaveJSProperty("inert", false);
    const exit = page.getByRole("button", { name: /^Exit/u });
    await expect(exit).toBeVisible();
    await exit.click();
    await expect(frame).toHaveJSProperty("inert", true);

    await cell.dblclick();
    await expect(frame).toHaveJSProperty("inert", false);
    await page.keyboard.press("Escape");
    await expect(frame).toHaveJSProperty("inert", true);
  });

  test("the bridge connects and a pin stores a document anchor", async ({
    page,
    baseURL,
  }) => {
    await openFocused(page, seeded.demo.htmlV2.artifactId);
    const box = page.locator(".ar-frame-box");
    await expect(box).toHaveAttribute("data-bridge", "connected");
    await page.getByTestId("comment-mode").click();
    const rect = await box.boundingBox();
    if (rect === null) throw new Error("frame has no box");
    await page.mouse.click(
      rect.x + rect.width * 0.5,
      rect.y + rect.height * 0.3,
    );
    await commentWithMode(page, "Tighten this hero");
    await expect(page.getByTestId("pin")).toHaveCount(1);
    const claim = await agentApi(baseURL).feedback.claim.mutate({
      scope: { type: "artifact", artifactId: seeded.demo.htmlV2.artifactId },
    });
    const anchor = claim.items.at(-1)?.thread.anchor;
    expect(anchor?.type).toBe("doc");
    if (anchor?.type !== "doc") throw new Error("expected a doc anchor");
    expect(anchor.x).toBeCloseTo(0.5, 1);
    expect(anchor.docWidth).toBeGreaterThan(0);
    expect(anchor.path).toBe("index.html");
  });

  test("a version switch keeps old threads as 'on v1' with a hollow pin", async ({
    page,
    baseURL,
  }) => {
    const fixtures = await sharedFixtures();
    const first = await publishFixture(String(baseURL), {
      board: "versions",
      title: "Versioned page",
      files: fixtures.htmlV1.files,
      entryPath: fixtures.htmlV1.entryPath,
    });
    await publishFixture(String(baseURL), {
      board: "versions",
      title: "Versioned page",
      files: fixtures.htmlV2.files,
      entryPath: fixtures.htmlV2.entryPath,
      artifactId: first.artifactId,
      expectedCurrentVersionId: first.versionId,
    });
    await openFocused(page, first.artifactId, 1);
    await expect(page.locator(".ar-frame-box")).toHaveAttribute(
      "data-bridge",
      "connected",
    );
    await enterCommentMode(page);
    const rect = await page.locator(".ar-frame-box").boundingBox();
    if (rect === null) throw new Error("frame has no box");
    await page.mouse.click(
      rect.x + rect.width * 0.3,
      rect.y + rect.height * 0.2,
    );
    await commentWithMode(page, "Version one needs a logo");
    await expect(page.getByTestId("pin")).toHaveCount(1);
    // Viewing the version it was opened on: no badge, no "View on v1".
    const onV1 = page
      .getByTestId("thread")
      .filter({ hasText: "Version one needs a logo" });
    await expect(onV1).toBeVisible();
    await expect(onV1.getByTestId("on-version")).toHaveCount(0);
    await expect(onV1.getByRole("button", { name: "View on v1" })).toHaveCount(
      0,
    );
    await expect(page.getByTestId("pin")).toHaveAttribute(
      "data-hollow",
      "false",
    );

    await page.getByRole("combobox", { name: "Version" }).selectOption("2");
    await expect(page).toHaveURL(/v=2/u);
    const thread = page
      .getByTestId("thread")
      .filter({ hasText: "Version one needs a logo" });
    await expect(thread.getByTestId("on-version")).toHaveText("on v1");
    await page.keyboard.press("Escape");
    // The pin is drawn hollow when its version is not the one shown.
    await expect(page.getByTestId("pin")).toHaveAttribute(
      "data-hollow",
      "true",
    );
    await thread.getByRole("button", { name: "View on v1" }).click();
    await expect(page).toHaveURL(/v=1/u);
    await expect(thread.getByTestId("on-version")).toHaveCount(0);
    await expect(
      thread.getByRole("button", { name: "View on v1" }),
    ).toHaveCount(0);
    await expect(page.getByTestId("pin")).toHaveAttribute(
      "data-hollow",
      "false",
    );
  });
});

test.describe("other kinds", () => {
  test("video pins sit on a timeline under the player", async ({ page }) => {
    await openFocused(page, seeded.demo.mp4.artifactId);
    const video = page.locator("video");
    await expect(video).toHaveAttribute("preload", "metadata");
    await enterCommentMode(page);
    await video.click({ position: { x: 200, y: 150 } });
    await commentWithMode(page, "Colour bars look clipped");
    await expect(
      page.getByRole("button", { name: /Thread 1 at 0:00/u }),
    ).toBeVisible();
  });

  test("markdown renders without raw HTML and keeps remote images as links", async ({
    page,
  }) => {
    await openFocused(page, seeded.demo.markdown.artifactId);
    const article = page.getByRole("article", { name: "Notes" });
    await expect(
      article.getByRole("heading", { name: "Fixture Markdown" }),
    ).toBeVisible();
    await expect(
      article.getByRole("link", { name: "Remote picture" }),
    ).toBeVisible();
    await expect(article.locator("img:not([src*='/_t/'])")).toHaveCount(0);
    expect(await page.evaluate("'__markdownScriptRan' in window")).toBe(false);
    await enterCommentMode(page);
    await article.getByRole("heading", { name: "A table" }).click();
    await commentWithMode(page, "Table needs units");
    await expect(page.getByTestId("pin")).toHaveCount(1);
  });

  test("an image zooms with the wheel and a cast shows its player", async ({
    page,
  }) => {
    await openFocused(page, seeded.demo.png.artifactId);
    const image = page.getByRole("img", { name: "Gradient" });
    await expect(image).toBeVisible();
    const before = await image.boundingBox();
    await image.hover();
    await page.mouse.wheel(0, -400);
    const widthNow = async () => {
      const box = await image.boundingBox();
      return box?.width ?? 0;
    };
    await expect.poll(widthNow).toBeGreaterThan(before?.width ?? 0);
    await page.getByRole("button", { name: "Fit" }).click();

    await openFocused(page, seeded.demo.cast.artifactId);
    await expect(page.getByTestId("cast-player")).toBeVisible();
  });

  test("an unknown file is a download card", async ({ page }) => {
    await openFocused(page, seeded.demo.bin.artifactId);
    await expect(
      page.getByTestId("file-card").getByRole("link", { name: "Download" }),
    ).toBeVisible();
  });
});

test.describe("board", () => {
  test("renders at most eight previews and loads the rest on request", async ({
    page,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    const api = agentApi(baseURL);
    await api.boards.create.mutate({ slug: "many", title: "Many concepts" });
    const fixtures = await sharedFixtures();
    for (let index = 0; index < 11; index += 1)
      await publishFixture(String(baseURL), {
        board: "many",
        title: `Option ${String(index + 1)}`,
        files: fixtures.htmlV1.files,
        entryPath: fixtures.htmlV1.entryPath,
      });
    await page.goto("/b/many");
    await expect(page.getByTestId("canvas-frame")).toHaveCount(11);
    // Firefox previews fewer frames.
    const cap =
      page.context().browser()?.browserType().name() === "firefox" ? 4 : 8;
    await expect(page.getByTestId("artifact-frame")).toHaveCount(cap);
    const placeholders = page.getByTestId("frame-placeholder");
    await expect(placeholders).toHaveCount(11 - cap);
    await expect(placeholders.first()).toContainText("HTML");
    await expect(placeholders.first()).toContainText("v1");
    await placeholders
      .first()
      .getByRole("button", { name: "Click to load" })
      .click();
    // The requested frame takes a slot; the farthest preview gives one up.
    await expect(page.getByTestId("artifact-frame")).toHaveCount(cap);
    await expect(placeholders).toHaveCount(11 - cap);
  });

  test("the chip opens the focused view and F does too", async ({ page }) => {
    await page.goto("/b/concepts");
    // A narrow chip shows its link only once the frame is selected.
    await page.getByRole("button", { name: /^Concept B,/u }).click();
    await page.getByRole("link", { name: "Open Concept B full size" }).click();
    await expect(page).toHaveURL(/\/a\//u);
    await expect(
      page.getByRole("heading", { name: "Concept B", level: 1 }),
    ).toBeVisible();
    await page.goto("/b/concepts");
    await page.getByRole("button", { name: /^Concept C,/u }).click();
    await page.keyboard.press("f");
    await expect(
      page.getByRole("heading", { name: "Concept C", level: 1 }),
    ).toBeVisible();
  });

  test("board comments are listed in the sidebar", async ({ page }) => {
    await page.goto("/b/concepts");
    await page
      .getByLabel("Comment on the board")
      .fill("Overall direction B looks strongest");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(
      page.getByTestId("thread").filter({ hasText: "direction B" }),
    ).toBeVisible();
  });
});

test.describe("threads", () => {
  test("reply, resolve, reopen, edit and delete inside the settle window", async ({
    page,
  }) => {
    await openFocused(page, seeded.demo.png.artifactId);
    await page.getByLabel("General comment").fill("Needs a caption");
    await page
      .getByRole("button", { name: "Comment", exact: true })
      .last()
      .click();
    const thread = page
      .getByTestId("thread")
      .filter({ hasText: "Needs a caption" });
    await expect(thread).toBeVisible();

    await thread.getByRole("button", { name: "Edit" }).click();
    await thread
      .getByRole("textbox", { name: "Edit comment" })
      .fill("Needs a caption and credit");
    await thread.getByRole("button", { name: "Save" }).click();
    await expect(thread).toContainText("Needs a caption and credit");

    await thread.getByRole("button", { name: "Reply" }).click();
    await thread.getByLabel("Reply").fill("Following up");
    await thread.getByRole("button", { name: "Send reply" }).click();
    await expect(thread).toContainText("Following up");

    await thread.getByRole("button", { name: "Resolve" }).click();
    await expect(thread).toBeHidden();
    await page.getByRole("radio", { name: /^Resolved/u }).click();
    await expect(thread).toContainText("resolved");
    await thread.getByRole("button", { name: "Reopen" }).click();
    await page.getByRole("radio", { name: /^Open/u }).click();
    await expect(thread).toBeVisible();

    await thread.getByRole("button", { name: "Delete" }).first().click();
    await expect(page.getByText("Needs a caption and credit")).toBeHidden();
  });

  test("the header shows who is waiting and the chip follows the agent's reply", async ({
    page,
    baseURL,
  }) => {
    const api = agentApi(baseURL);
    const artifactId = seeded.demo.webm.artifactId;
    await openFocused(page, artifactId);
    // The breadcrumb names the board by its title, not its slug.
    await expect(page.locator(".ar-crumbs")).toHaveText("Demo board");
    await expect(page.getByTestId("waiting")).toHaveText(/No agent waiting/u);

    await page.getByLabel("General comment").fill("Audio is missing");
    await page
      .getByRole("button", { name: "Comment", exact: true })
      .last()
      .click();
    await expect(page.getByTestId("waiting")).toHaveText(/1 queued/u);

    const controller = new AbortController();
    const stream = await fetch(
      `${String(baseURL)}/api/feedback/stream?artifact=${artifactId}`,
      {
        headers: { [ACTOR_HEADER]: encodeActor(KARPATHY) },
        signal: controller.signal,
      },
    );
    expect(stream.status).toBe(200);
    // A stream nobody reads is dropped; an agent's `wait` reads it.
    void drain(stream.body);
    // The stream's connect wakes the page; the 60 s poll is only a fallback.
    await expect(page.getByTestId("waiting")).toHaveText("karpathy waiting", {
      timeout: 5000,
    });

    const claim = await api.feedback.claim.mutate({
      scope: { type: "artifact", artifactId },
    });
    const item = claim.items[0];
    if (item === undefined) throw new Error("nothing to claim");
    await api.feedback.ack.mutate({ commentIds: [item.comment.id] });
    await api.threads.reply.mutate({
      threadId: item.thread.id,
      body: "Added an audio track",
      resolve: false,
    });
    await expect(page.getByTestId("delivery-chip")).toHaveText("Replied");
    controller.abort();
    // Closing the stream is announced too: the header does not wait for the poll.
    await expect(page.getByTestId("waiting")).toHaveText("No agent waiting", {
      timeout: 5000,
    });
  });
});
