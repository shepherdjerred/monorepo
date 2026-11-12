import { expect, test, type Page } from "@playwright/test";
import {
  createIssue,
  removeIssue,
  removeScratchIssues,
  removeViews,
  scratchTag,
  scratchTeam,
  toastSaying,
  uniqueTag,
} from "./data-helpers.ts";
import {
  afterPacing,
  expectCues,
  played,
  recordFeedback,
} from "./delight-helpers.ts";

const statusPicker = (page: Page, identifier: string) =>
  page.locator(`[data-picker="state"][data-issue="${identifier}"]`);

async function openNewIssue(page: Page) {
  await page
    .getByRole("button", { name: "New issue", exact: true })
    .last()
    .click();
  await expect(page.getByLabel("Issue title", { exact: true })).toBeVisible();
}

test("under reduced motion a dialog opens with nothing animating", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/issues");
  await expect(page.getByRole("list", { name: "Issues" })).toBeVisible();
  await openNewIssue(page);
  expect(
    await page.evaluate(() => globalThis.document.getAnimations().length),
  ).toBe(0);
});

test("with motion allowed a dialog animates in", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.addInitScript(() => {
    const started: string[] = [];
    Object.defineProperty(globalThis, "__transitions", { value: started });
    document.addEventListener(
      "transitionrun",
      (event) => {
        if (event.target instanceof Element) {
          started.push(`${event.target.className} ${event.propertyName}`);
        }
      },
      true,
    );
  });
  await page.goto("/issues");
  await expect(page.getByRole("list", { name: "Issues" })).toBeVisible();
  await openNewIssue(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        String(Reflect.get(globalThis, "__transitions")).split(","),
      ),
    )
    .toContainEqual(expect.stringMatching(/^modal .*opacity$/u));
});

test("Settings → Feedback switches start on and persist across reload", async ({
  page,
}) => {
  await page.goto("/settings");
  const sounds = page.getByRole("switch", { name: "Sounds" });
  const haptics = page.getByRole("switch", { name: "Haptics" });
  await expect(sounds).toBeChecked();
  await expect(haptics).toBeChecked();
  await haptics.click();
  await expect(haptics).not.toBeChecked();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Sounds" })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Haptics" })).not.toBeChecked();
  expect(
    await page.evaluate(() =>
      globalThis.localStorage.getItem("tracker.feedback.haptics"),
    ),
  ).toBe("off");
  await expect(
    page.getByText(/silent whenever your system asks for reduced motion/u),
  ).toBeVisible();
});

test("creating an issue sounds the create cue and buzzes success", async ({
  page,
}) => {
  await recordFeedback(page);
  await page.goto(`/issues?team=${scratchTeam}`);
  await openNewIssue(page);
  await page
    .getByLabel("Issue title", { exact: true })
    .fill(`Delight ${uniqueTag()}`);
  await page.getByRole("button", { name: "Create issue", exact: true }).click();
  const toast = page.locator(".toast-title").filter({ hasText: / created$/u });
  await expect(toast).toBeVisible();
  await expectCues(page, ["create"]);
  const created = await played(page);
  expect(created.vibrations).toContainEqual([10, 40, 10]);
  const message = await toast.textContent();
  const [identifier = ""] = (message ?? "").split(" ");
  await removeIssue(page.request, identifier);
});

test("completing from a row's status picker sounds the completion cue", async ({
  page,
}) => {
  await recordFeedback(page);
  const tag = uniqueTag();
  const identifier = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Delight complete ${tag}`,
  });
  await page.goto(`/issues?team=${scratchTeam}&q=${tag}`);
  await statusPicker(page, identifier).click();
  await page.getByRole("option", { name: "Done" }).click();
  await expect(statusPicker(page, identifier)).toHaveValue("Done");
  await expectCues(page, ["complete"]);
  await statusPicker(page, identifier).click();
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("issues.update") &&
      (response.request().postData() ?? "").includes("In progress"),
  );
  await page.getByRole("option", { name: "In progress" }).click();
  await expectCues(page, ["complete", "status"]);
  await saved;
  await removeIssue(page.request, identifier);
});

test("a failed save sounds the error cue and buzzes a warning", async ({
  page,
}) => {
  await recordFeedback(page);
  const tag = uniqueTag();
  const identifier = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Delight error ${tag}`,
  });
  await page.route("**/trpc/issues.update**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify([
        { error: { message: "Refused by the test", code: -32_603, data: {} } },
      ]),
    });
  });
  await page.goto(`/issues?team=${scratchTeam}&q=${tag}`);
  await statusPicker(page, identifier).click();
  await page.getByRole("option", { name: "In progress" }).click();
  await expect(page.locator('.toast[data-type="error"]')).toBeVisible();
  await expectCues(page, ["status", "error"]);
  const failed = await played(page);
  expect(failed.vibrations).toContainEqual([30, 60, 30]);
  await page.unroute("**/trpc/issues.update**");
  await removeIssue(page.request, identifier);
});

test("a change made in another session makes no sound here", async ({
  page,
  browser,
}) => {
  await recordFeedback(page);
  const tag = uniqueTag();
  const identifier = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Delight remote ${tag}`,
  });
  await page.goto(`/issues?team=${scratchTeam}&q=${tag}`);
  await expect(statusPicker(page, identifier)).toHaveValue("Triage");
  await expect(
    page.locator(".live-indicator").filter({ visible: true }),
  ).toHaveText("Live");
  // A gesture here first, so this page is allowed to make sound at all.
  await page.getByRole("heading", { name: "All issues" }).click();
  const other = await browser.newContext();
  const arrived = await (async () => {
    try {
      const elsewhere = await other.newPage();
      await elsewhere.goto(`/issues?team=${scratchTeam}&q=${tag}`);
      await statusPicker(elsewhere, identifier).click();
      const saved = elsewhere.waitForResponse(
        (response) =>
          response.url().includes("issues.update") &&
          (response.request().postData() ?? "").includes("Done") &&
          response.ok(),
      );
      await elsewhere.getByRole("option", { name: "Done" }).click();
      await saved;
      return await createIssue(other.request, {
        teamKey: scratchTeam,
        title: `Delight remote arrival ${tag}`,
      });
    } finally {
      await other.close();
    }
  })();
  // The live stream brings both here: the completion and a fresh row.
  await expect(statusPicker(page, identifier)).toHaveValue("Done");
  await expect(
    page.locator(`li.issue-row[data-row-issue="${arrived}"]`),
  ).toBeVisible();
  await afterPacing(page);
  const heard = await played(page);
  expect(heard.cues).toEqual([]);
  expect(heard.vibrations).toEqual([]);
  await removeIssue(page.request, arrived);
  await removeIssue(page.request, identifier);
});

test("a due date clicks softly, a sub-issue and a saved view sound created", async ({
  page,
}) => {
  await recordFeedback(page);
  const tag = scratchTag();
  const name = `Delight view ${tag}`;
  const parent = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Delight parent ${tag}`,
  });
  try {
    await page.goto(`/issues/${parent}`);
    await page.locator("#property-due").click();
    const words = page.getByRole("textbox", { name: `Due date of ${parent}` });
    await words.fill("tomorrow");
    await words.press("Enter");
    await expect(toastSaying(page, `${parent} due tomorrow`)).toBeVisible();
    await expectCues(page, ["status"]);
    const add = page.getByRole("textbox", {
      name: `Add sub-issue to ${parent}`,
    });
    await add.fill(`Delight child ${tag}`);
    await add.press("Enter");
    await expect(page.locator(".sub-issue")).toHaveCount(1);
    await expectCues(page, ["status", "create"]);
    await page.goto(`/issues?team=${scratchTeam}&q=${tag}&priority=1`);
    await page.locator("#save-view").click();
    const dialog = page.getByRole("dialog", { name: "Save view" });
    await dialog.getByRole("textbox", { name: "Name" }).fill(name);
    await dialog.getByRole("button", { name: "Save view" }).click();
    await expect(toastSaying(page, `View “${name}” saved`)).toBeVisible();
    // The cues recorded before the navigation went with that page.
    await expectCues(page, ["create"]);
  } finally {
    await removeViews(page.request, [name]);
    await removeScratchIssues(page.request);
  }
});
