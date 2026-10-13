import { expect, test, type Page } from "@playwright/test";

async function prepareBoard(page: Page, title: string) {
  await page.goto("/board");
  await page
    .getByRole("button", { name: "New issue", exact: true })
    .last()
    .click();
  await page.getByLabel("Issue title", { exact: true }).fill(title);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page).toHaveURL(/\/issues\/AI-\d+$/u);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const identifier = page.url().split("/").at(-1);
  await page
    .getByRole("combobox", { name: "Status", exact: true })
    .selectOption("In progress");
  await expect(
    page.getByRole("combobox", { name: "Status", exact: true }),
  ).toHaveValue("In progress");
  await page.goto("/board");
  const card = page.locator(".board-card").filter({ hasText: title });
  const target = page.getByRole("region", { name: "Todo", exact: true });
  const handle = card.getByRole("button", {
    name: `Move ${identifier ?? ""}`,
    exact: true,
  });
  await handle.scrollIntoViewIfNeeded();
  return { card, target, handle };
}

async function moveBoardCardWithKeyboard(
  page: Page,
  { card, handle }: Awaited<ReturnType<typeof prepareBoard>>,
) {
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(card).toHaveClass(/dragging/u);
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(
    "over Todo",
  );
  await page.keyboard.press("Space");
}

test("board also supports desktop keyboard and mobile long-press touch", async ({
  page,
}, info) => {
  const title = `Accessible board ${info.project.name} ${String(Date.now())}`;
  const { card, target, handle } = await prepareBoard(page, title);
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("issues.move") &&
      response.request().method() === "POST",
  );
  if (info.project.name === "desktop") {
    await moveBoardCardWithKeyboard(page, { card, target, handle });
  } else {
    const origin = await handle.boundingBox();
    if (origin === null) throw new Error("Touch handle is not visible");
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: origin.x + origin.width / 2, y: origin.y + origin.height / 2 },
      ],
    });
    await expect(card).toHaveClass(/dragging/u);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: 5, y: origin.y + origin.height / 2 }],
    });
    await expect
      .poll(async () => {
        const rect = await target.boundingBox();
        return rect !== null && rect.x >= 0;
      })
      .toBe(true);
    const destination = await target.boundingBox();
    if (destination === null)
      throw new Error("Touch destination is not visible");
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: destination.x + 140, y: Math.max(70, destination.y + 80) },
      ],
    });
    await expect(page.locator('[id^="DndLiveRegion"]')).toContainText(
      "over Todo",
    );
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await cdp.detach();
  }
  const response = await saved;
  expect(response.ok()).toBe(true);
  await expect(target).toContainText(title);
  await page.reload();
  await expect(target).toContainText(title);
});

test("creates an issue, comments, votes, attaches and retains edit history", async ({
  page,
}, info) => {
  await page.goto("/issues");
  const title = `Acceptance ${info.project.name} ${String(Date.now())}`;
  if (info.project.name === "desktop") await page.keyboard.press("c");
  else
    await page
      .getByRole("button", { name: "New issue", exact: true })
      .last()
      .click();
  await page.getByLabel("Issue title", { exact: true }).fill(title);
  await page
    .getByPlaceholder("Add a description…")
    .fill("## Expected behavior\nA reproducible acceptance case.");
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page).toHaveURL(/\/issues\/AI-\d+$/u);
  await expect(page.getByLabel("Issue title", { exact: true })).toHaveValue(
    title,
  );
  await page.getByLabel("Status", { exact: true }).selectOption("In progress");
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue(
    "In progress",
  );
  await page.getByRole("button", { name: "0 votes", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "1 vote", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByPlaceholder("Leave a comment…")
    .fill("Verified with a screenshot and a fresh session.");
  await page
    .locator('input[type="file"]')
    .last()
    .setInputFiles({
      name: "acceptance.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Acceptance attachment"),
    });
  await expect(page.getByPlaceholder("Leave a comment…")).toHaveValue(
    /acceptance\.txt/u,
  );
  const commentSaved = page.waitForResponse(
    (response) =>
      response.url().includes("comments.create") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  const commentResponse = await commentSaved;
  expect(commentResponse.ok()).toBe(true);
  await expect(
    page
      .getByText("Verified with a screenshot and a fresh session.", {
        exact: false,
      })
      .first(),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator(".comment")).toContainText(
    "Verified with a screenshot and a fresh session.",
  );
  await expect(
    page
      .locator(".comment")
      .getByRole("link", { name: "acceptance.txt", exact: true }),
  ).toHaveAttribute("href", /\/attachments\//u);
  await expect(page.getByLabel("Status", { exact: true })).toHaveValue(
    "In progress",
  );
  await expect(
    page.getByRole("button", { name: "1 vote", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Edit history", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("updated");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page.screenshot({
    path: test.info().outputPath(`detail-${info.project.name}.png`),
    fullPage: true,
  });
});

test("palette searches typos, list peeks, themes and mobile layout work", async ({
  page,
}, info) => {
  await page.goto("/issues");
  await page.keyboard.press("ControlOrMeta+k");
  await page.getByLabel("Search issues and commands").fill("reconciliaton");
  await expect(page.getByRole("dialog")).toContainText(
    "Investigate worker restart during reconciliation",
  );
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Issue title", { exact: true })).toHaveValue(
    "Investigate worker restart during reconciliation",
  );
  await page.goto("/settings");
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/issues");
  await page.screenshot({
    path: test.info().outputPath(`list-dark-${info.project.name}.png`),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: /Polish the issue creation flow/u })
    .click();
  await expect(page.getByRole("dialog")).toContainText("AI-1");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .first()
    .click();
  const overflow = await page.evaluate(
    () =>
      globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
  );
  expect(overflow).toBe(false);
});

test("board drag persists after reload", async ({ page }, info) => {
  const title = `Board ${info.project.name} ${String(Date.now())}`;
  const { card, target, handle } = await prepareBoard(page, title);
  const origin = await handle.boundingBox();
  const destination = await target.boundingBox();
  if (origin === null || destination === null)
    throw new Error("Board drag targets are not visible");
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("issues.move") &&
      response.request().method() === "POST",
  );
  if (info.project.name === "mobile") {
    await moveBoardCardWithKeyboard(page, { card, target, handle });
  } else {
    await page.mouse.move(
      origin.x + origin.width / 2,
      origin.y + origin.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(destination.x + 100, destination.y + 100, {
      steps: 15,
    });
    await page.mouse.up();
  }
  const response = await saved;
  expect(response.ok()).toBe(true);
  await expect(target).toContainText(title);
  await page.reload();
  await expect(target).toContainText(title);
  await page.screenshot({
    path: test.info().outputPath("board-desktop.png"),
    fullPage: true,
  });
});
