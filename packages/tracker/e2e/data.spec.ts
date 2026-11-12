import { expect, test, type Page } from "@playwright/test";
import {
  createIssue,
  recordCalls,
  scratchTeam,
  toast,
  toastSaying,
  undo,
} from "./data-helpers.ts";

const status = (page: Page) =>
  page.getByRole("combobox", { name: "Status", exact: true });
test("a status change shows before the server answers, and Undo reverts it", async ({
  page,
  request,
}, info) => {
  const identifier = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Optimistic status ${info.project.name} ${String(Date.now())}`,
  });
  await page.goto(`/issues/${identifier}`);
  await expect(status(page)).toHaveValue("Triage");

  const held = Promise.withResolvers<undefined>();
  await page.route(/\/trpc\/issues\.update/u, async (route) => {
    await held.promise;
    await route.continue();
  });
  await status(page).selectOption("In progress");
  // The request is still held: what shows is the optimistic value.
  await expect(status(page)).toHaveValue("In progress");
  // A toast is a labelled group, never a dialog that would take the keyboard.
  await expect(toast(page)).toHaveAttribute("role", "group");
  await expect(toast(page)).not.toHaveAttribute("aria-modal");
  await expect(
    toastSaying(page, `${identifier} status set to In progress`),
  ).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("issues.update") && response.status() === 200,
  );
  held.resolve(undefined);
  await saved;
  await page.unroute(/\/trpc\/issues\.update/u);
  await page.reload();
  await expect(status(page)).toHaveValue("In progress");

  await status(page).selectOption("Done");
  await expect(
    toastSaying(page, `${identifier} status set to Done`),
  ).toBeVisible();
  const undone = page.waitForResponse(
    (response) =>
      response.url().includes("issues.update") &&
      (response.request().postData() ?? "").includes("In progress"),
  );
  await undo(page).click();
  await expect(status(page)).toHaveValue("In progress");
  const reverted = await undone;
  expect(reverted.ok()).toBe(true);
  await page.reload();
  await expect(status(page)).toHaveValue("In progress");
});

test("Undo is offered from inside a peek without closing it", async ({
  page,
  request,
}, info) => {
  const title = `Peek undo ${info.project.name} ${String(Date.now())}`;
  const identifier = await createIssue(request, {
    teamKey: scratchTeam,
    title,
  });
  await page.goto(`/issues?team=${scratchTeam}&peek=${identifier}`);
  const peek = page.getByRole("dialog");
  await expect(peek.getByLabel("Issue title", { exact: true })).toHaveValue(
    title,
  );
  await peek.getByLabel("Status", { exact: true }).selectOption("Done");
  await undo(page).click();
  await expect(peek.getByLabel("Status", { exact: true })).toHaveValue(
    "Triage",
  );
  await expect(peek).toBeVisible();
  await expect(toastSaying(page, `${identifier} change undone`)).toBeVisible();
});

async function deleteOpenIssue(page: Page, identifier: string) {
  await page.getByRole("button", { name: "Delete issue", exact: true }).click();
  await page
    .getByRole("button", { name: `Delete ${identifier}`, exact: true })
    .click();
  await expect(page).toHaveURL(/\/issues$/u);
  await expect(toastSaying(page, `${identifier} deleted`)).toBeVisible();
}

test("a deleted issue can be undone, and is only deleted once the toast is gone", async ({
  page,
  request,
}, info) => {
  const title = `Deferred delete ${info.project.name} ${String(Date.now())}`;
  const identifier = await createIssue(request, { teamKey: "AI", title });
  const calls = recordCalls(page);
  await page.goto(`/issues/${identifier}`);
  await expect(page.getByLabel("Issue title", { exact: true })).toHaveValue(
    title,
  );
  await deleteOpenIssue(page, identifier);
  const row = page.getByRole("link", { name: new RegExp(title, "u") });
  await expect(row).toHaveCount(0);
  await undo(page).click();
  await expect(row).toBeVisible();
  await expect(toastSaying(page, `${identifier} restored`)).toBeVisible();
  expect(calls.filter((call) => call.includes("issues.delete"))).toEqual([]);
  await page.reload();
  await expect(row).toBeVisible();

  await row.click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Open full issue", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/issues/${identifier}$`, "u"));
  const deleted = page.waitForResponse(
    (response) =>
      response.url().includes("issues.delete") && response.status() === 200,
    { timeout: 15_000 },
  );
  await deleteOpenIssue(page, identifier);
  await expect(row).toHaveCount(0);
  // Nothing is sent while Undo is still on offer.
  expect(calls.filter((call) => call.includes("issues.delete"))).toEqual([]);
  await deleted;
  await expect(toast(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("list", { name: "Issues" })).toBeVisible();
  await expect(row).toHaveCount(0);
  await page.goto(`/issues/${identifier}`);
  await expect(page.getByRole("alert")).toContainText("not found");
});

test("leaving the page sends a waiting delete instead of losing it", async ({
  page,
  request,
}, info) => {
  const title = `Delete on unload ${info.project.name} ${String(Date.now())}`;
  const identifier = await createIssue(request, { teamKey: "AI", title });
  await page.goto(`/issues/${identifier}`);
  await expect(page.getByLabel("Issue title", { exact: true })).toHaveValue(
    title,
  );
  await deleteOpenIssue(page, identifier);
  // The delete leaves in a request that outlives the page; the page that
  // loads next may still list the issue until that request has landed.
  await page.reload();
  await expect
    .poll(async () => {
      const input = encodeURIComponent(JSON.stringify({ identifier }));
      const response = await request.get(
        `/trpc/issues.byIdentifier?input=${input}`,
      );
      return response.status();
    })
    .toBe(404);
  await page.reload();
  await expect(page.getByRole("list", { name: "Issues" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: new RegExp(title, "u") }),
  ).toHaveCount(0);
});

/** The keys of every draft and unanswered send this tab is holding. */
const storedText = (page: Page) =>
  page.evaluate(() =>
    Object.keys(globalThis.sessionStorage).filter(
      (key) =>
        key.startsWith("tracker.draft.") || key.startsWith("tracker.pending."),
    ),
  );

test("unsent text survives navigation and a reload, and is cleared once sent", async ({
  page,
  request,
}, info) => {
  const identifier = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Drafts ${info.project.name} ${String(Date.now())}`,
  });
  const draft = "A thought I have not finished";
  // Unsent text makes the browser ask before the tab unloads.
  let asked = 0;
  page.on("dialog", (dialog) => {
    asked += 1;
    void dialog.accept();
  });
  await page.goto(`/issues/${identifier}`);
  const box = page.getByPlaceholder("Leave a comment…");
  await box.fill(draft);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Issues", exact: true })
    .click();
  await expect(page.getByRole("list", { name: "Issues" })).toBeVisible();
  await page.goBack();
  await expect(box).toHaveValue(draft);
  expect(asked).toBe(0);

  await page.reload();
  await expect(box).toHaveValue(draft);
  expect(asked).toBe(1);

  // Sent text stops being a draft at once, before the server has answered:
  // a reload while the request is in flight must not offer it again.
  const held = Promise.withResolvers<undefined>();
  await page.route(/\/trpc\/comments\.create/u, async (route) => {
    await held.promise;
    await route.continue();
  });
  const posted = page.waitForResponse(
    (response) =>
      response.url().includes("comments.create") && response.status() === 200,
  );
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.locator(".comment")).toContainText(draft);
  await expect(box).toHaveValue("");
  expect(
    await page.evaluate(() =>
      Object.keys(globalThis.sessionStorage).filter((key) =>
        key.startsWith("tracker.draft."),
      ),
    ),
  ).toEqual([]);
  held.resolve(undefined);
  await posted;
  await page.unroute(/\/trpc\/comments\.create/u);
  await expect.poll(() => storedText(page)).toEqual([]);
  await page.reload();
  await expect(page.locator(".comment")).toContainText(draft);
  await expect(box).toHaveValue("");
  expect(asked).toBe(1);

  // The new-issue dialog keeps what was typed when it is closed.
  await page
    .getByRole("button", { name: "New issue", exact: true })
    .last()
    .click();
  const title = page
    .getByRole("dialog")
    .getByLabel("Issue title", { exact: true });
  await title.fill("Half-written issue");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("button", { name: "New issue", exact: true })
    .last()
    .click();
  await expect(title).toHaveValue("Half-written issue");
  await page
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(title).toHaveValue("");
});

test("a comment the server saved as the page unloaded is not offered again", async ({
  page,
  request,
}, info) => {
  const identifier = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Saved on unload ${info.project.name} ${String(Date.now())}`,
  });
  const text = "Sent just before the reload";
  await page.goto(`/issues/${identifier}`);
  const box = page.getByPlaceholder("Leave a comment…");
  await box.fill(text);
  // The server commits the comment, but its answer never reaches the page.
  const committed = Promise.withResolvers<undefined>();
  await page.route(/\/trpc\/comments\.create/u, async (route) => {
    await route.fetch();
    committed.resolve(undefined);
  });
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await committed.promise;
  await page.reload();
  await expect(page.locator(".comment")).toHaveCount(1);
  await expect(page.locator(".comment")).toContainText(text);
  // The text is recognised as saved: not put back, and nothing said about it.
  await expect.poll(() => storedText(page)).toEqual([]);
  await expect(box).toHaveValue("");
  await expect(toastSaying(page, "Restored")).toHaveCount(0);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("a comment that never reached the server comes back after a reload", async ({
  page,
  request,
}, info) => {
  const identifier = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Lost on unload ${info.project.name} ${String(Date.now())}`,
  });
  const text = "Typed, sent, and cut off";
  await page.goto(`/issues/${identifier}`);
  const box = page.getByPlaceholder("Leave a comment…");
  await box.fill(text);
  // The request is held in the browser and dies with the page.
  const never = Promise.withResolvers<undefined>();
  await page.route(/\/trpc\/comments\.create/u, () => never.promise);
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.locator(".comment")).toContainText(text);
  await expect(box).toHaveValue("");
  await page.reload();
  // Nothing was saved, so the text returns to the box, and says so. The
  // page first gives a send this recent a few seconds to land.
  await expect(box).toHaveValue(text, { timeout: 15_000 });
  await expect(toastSaying(page, "Restored your unsent comment")).toBeVisible();
  await expect(page.locator(".comment")).toHaveCount(0);
  // It is a draft again, never sent by itself.
  expect(await storedText(page)).toEqual([
    `tracker.draft.comment:${identifier}`,
  ]);
  await box.fill("");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
