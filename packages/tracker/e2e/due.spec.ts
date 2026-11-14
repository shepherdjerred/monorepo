import { expect, test, type Page } from "@playwright/test";
import {
  createIssue,
  recordCalls,
  selectRows,
  scratchTeam,
  toastSaying,
  removeScratchIssues,
  scratchTag,
  undo,
} from "./data-helpers.ts";

test.afterEach(({ request }) => removeScratchIssues(request));

/** A calendar day `offset` days from the local today, as the browser counts. */
function localDay(offset: number) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

const row = (page: Page, identifier: string) =>
  page.locator(`li[data-row-issue="${identifier}"]`);

test("a due date typed in words is saved as that day and shown as a chip", async ({
  page,
}) => {
  const tag = scratchTag();
  const identifier = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Due words ${tag}`,
  });
  await page.goto(`/issues/${identifier}`);
  await page.locator("#property-due").click();
  const words = page.getByRole("textbox", {
    name: `Due date of ${identifier}`,
  });
  await expect(words).toBeFocused();
  // The month grid is there too, with today marked.
  await expect(page.getByRole("grid")).toBeVisible();
  await expect(page.locator('td[aria-current="date"]')).toHaveCount(1);
  await words.fill("tomorrow");
  await words.press("Enter");
  await expect(toastSaying(page, `${identifier} due tomorrow`)).toBeVisible();
  const chip = page.locator("#property-due time");
  await expect(chip).toHaveText("Tomorrow");
  await expect(chip).toHaveAttribute("datetime", localDay(1));
  await page.goto(`/issues?team=${scratchTeam}&q=${tag}`);
  const due = row(page, identifier).locator(".due-chip");
  await expect(due).toHaveText("Tomorrow");
  await expect(due).toHaveAttribute("data-tone", "soon");
});

test("the Overdue filter lists open work past its date and leaves out finished work", async ({
  page,
}) => {
  const tag = scratchTag();
  const late = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Late ${tag}`,
    dueDate: localDay(-3),
  });
  const finished = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Finished ${tag}`,
    dueDate: localDay(-3),
    stateName: "Done",
  });
  const later = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Later ${tag}`,
    dueDate: localDay(20),
  });
  await page.goto(`/issues?team=${scratchTeam}&group=none&q=${tag}`);
  await expect(row(page, later)).toBeVisible();
  await expect(row(page, late).locator(".due-chip")).toHaveAttribute(
    "data-tone",
    "overdue",
  );
  await expect(row(page, finished).locator(".due-chip")).toHaveAttribute(
    "data-tone",
    "later",
  );
  await page.getByRole("button", { name: /^Filter/u }).click();
  await page.getByRole("option", { name: "Due date" }).click();
  await page.getByRole("option", { name: "Overdue" }).click();
  await expect(page).toHaveURL(/due=overdue/u);
  await expect(
    page.getByRole("list", { name: "Active filters" }),
  ).toContainText("Overdue");
  await expect(row(page, late)).toBeVisible();
  await expect(row(page, finished)).toHaveCount(0);
  await expect(row(page, later)).toHaveCount(0);
});

test("a due date set on three selected issues is one bulkUpdate request", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile";
  const tag = scratchTag();
  const identifiers: string[] = [];
  for (const index of [1, 2, 3]) {
    identifiers.push(
      await createIssue(page.request, {
        teamKey: scratchTeam,
        title: `Bulk due ${tag} ${String(index)}`,
      }),
    );
  }
  await page.goto(`/issues?team=${scratchTeam}&group=none&q=${tag}`);
  await selectRows(page, identifiers, mobile);
  const calls = recordCalls(page);
  // The reload below must not cut off the save it then checks.
  const saved = page.waitForResponse(
    (response) => response.url().includes("issues.bulkUpdate") && response.ok(),
  );
  const bar = page.getByRole("region", { name: "Selected issues" });
  await bar.locator("#bulk-due").click();
  await page
    .getByRole("dialog", { name: "Due date of 3 issues" })
    .getByRole("button", { name: /^In 1 week/u })
    .click();
  await expect(toastSaying(page, "Set 3 issues due")).toBeVisible();
  for (const identifier of identifiers) {
    await expect(
      row(page, identifier).locator(".due-chip time"),
    ).toHaveAttribute("datetime", localDay(7));
  }
  await expect
    .poll(() => calls.filter((call) => call.startsWith("issues.bulkUpdate")))
    .toHaveLength(1);
  expect(calls.filter((call) => call.startsWith("issues.update"))).toEqual([]);
  await saved;
  await page.reload();
  for (const identifier of identifiers) {
    await expect(
      row(page, identifier).locator(".due-chip time"),
    ).toHaveAttribute("datetime", localDay(7));
  }
});

test("Undo takes a bulk due date back in one request", async ({
  page,
}, info) => {
  const tag = scratchTag();
  const identifiers: string[] = [];
  for (const index of [1, 2, 3]) {
    identifiers.push(
      await createIssue(page.request, {
        teamKey: scratchTeam,
        title: `Undo due ${tag} ${String(index)}`,
      }),
    );
  }
  await page.goto(`/issues?team=${scratchTeam}&group=none&q=${tag}`);
  await selectRows(page, identifiers, info.project.name === "mobile");
  const calls = recordCalls(page);
  await page
    .getByRole("region", { name: "Selected issues" })
    .locator("#bulk-due")
    .click();
  await page
    .getByRole("dialog", { name: "Due date of 3 issues" })
    .getByRole("button", { name: /^Tomorrow/u })
    .click();
  for (const identifier of identifiers) {
    await expect(row(page, identifier).locator(".due-chip")).toHaveText(
      "Tomorrow",
    );
  }
  await expect
    .poll(() => calls.filter((call) => call.startsWith("issues.bulkUpdate")))
    .toHaveLength(1);
  await undo(page).click();
  await expect(toastSaying(page, "Undone: Set 3 issues due")).toBeVisible();
  for (const identifier of identifiers) {
    await expect(row(page, identifier).locator(".due-chip")).toHaveCount(0);
  }
  // All three had no due date, so the undo is one request too.
  expect(
    calls.filter((call) => call.startsWith("issues.bulkUpdate")),
  ).toHaveLength(2);
  await page.reload();
  for (const identifier of identifiers) {
    await expect(row(page, identifier)).toBeVisible();
    await expect(row(page, identifier).locator(".due-chip")).toHaveCount(0);
  }
});
