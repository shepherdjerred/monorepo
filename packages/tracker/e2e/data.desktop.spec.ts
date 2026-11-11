import { expect, test } from "@playwright/test";
import {
  createIssue,
  recordCalls,
  scratchTeam,
  toastSaying,
} from "./data-helpers.ts";

test("Cmd/Ctrl+Z undoes the newest change, but not while typing", async ({
  page,
  request,
}) => {
  const identifier = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Keyboard undo ${String(Date.now())}`,
  });
  await page.goto(`/issues/${identifier}`);
  const priority = page.locator("#property-priority");
  await priority.selectOption("High");
  await expect(
    toastSaying(page, `${identifier} priority set to High`),
  ).toBeVisible();
  // In a text field the chord belongs to the field's own undo history.
  await page.getByPlaceholder("Leave a comment…").click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(priority).toHaveValue("2");

  await page.getByRole("heading", { name: "Properties" }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(priority).toHaveValue("0");
  await expect(toastSaying(page, `${identifier} change undone`)).toBeVisible();
  await page.reload();
  await expect(priority).toHaveValue("0");
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog")).toContainText("Undo the last change");
});

test("Escape in the title field takes back an unsaved title", async ({
  page,
  request,
}) => {
  const original = `Title revert ${String(Date.now())}`;
  const identifier = await createIssue(request, {
    teamKey: scratchTeam,
    title: original,
  });
  const calls = recordCalls(page);
  await page.goto(`/issues?team=${scratchTeam}&peek=${identifier}`);
  const title = page
    .getByRole("dialog")
    .getByLabel("Issue title", { exact: true });
  await expect(title).toHaveValue(original);
  await title.fill("Something else entirely");
  await page.keyboard.press("Escape");
  await expect(title).toHaveValue(original);
  // The first Escape reverted the title; the peek is still open.
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Tab");
  expect(calls.filter((call) => call.includes("issues.update"))).toEqual([]);
});
