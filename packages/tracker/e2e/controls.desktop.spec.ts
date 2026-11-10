import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import {
  createIssue,
  removeIssue,
  scratchTeam,
  toastSaying,
  uniqueTag,
} from "./data-helpers.ts";

// Keyboard-first controls; the mobile project ignores *.desktop.spec.ts.
const link = (page: Page, identifier: string) =>
  page.locator(`a[data-issue-row="${identifier}"]`);
const picker = (page: Page, name: string, identifier: string) =>
  page.locator(`[data-picker="${name}"][data-issue="${identifier}"]`);

async function scratchIssues(page: Page, count: number) {
  const tag = uniqueTag();
  const identifiers: string[] = [];
  for (let index = 0; index < count; index += 1) {
    identifiers.push(
      await createIssue(page.request, {
        teamKey: scratchTeam,
        title: `Keyboard ${tag} ${String(index + 1)}`,
      }),
    );
  }
  return { tag, identifiers };
}

test("S, I and the arrow keys edit the focused row without opening it", async ({
  page,
}) => {
  const { tag, identifiers } = await scratchIssues(page, 1);
  const [identifier = ""] = identifiers;
  await page.goto(`/issues?team=${scratchTeam}&q=${tag}`);
  await link(page, identifier).focus();
  await page.keyboard.press("s");
  const option = page.getByRole("option", { name: "Done" });
  await expect(option).toBeVisible();
  await option.click();
  await expect(picker(page, "state", identifier)).toHaveValue("Done");
  await expect(
    toastSaying(page, `${identifier} status set to Done`),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/peek=/u);
  // Focus rests on the row's own picker, where the row's keys still work.
  await page.keyboard.press("i");
  await expect(
    toastSaying(page, `${identifier} assigned to Jerred`),
  ).toBeVisible();
  await expect(picker(page, "assignee", identifier)).toHaveAttribute(
    "aria-label",
    `Assignee of ${identifier}: Jerred`,
  );
  await page.keyboard.press("a");
  const search = page.getByRole("combobox", {
    name: `Assignee of ${identifier}`,
  });
  await expect(search).toBeFocused();
  // With nothing typed, a number picks that row: 2 is "Unassigned".
  await page.keyboard.press("2");
  await expect(toastSaying(page, `${identifier} unassigned`)).toBeVisible();
  await expect(search).toHaveCount(0);
});

test("x, Shift+J, ⌘ A and Esc select rows, and one Undo reverts a bulk edit", async ({
  page,
}) => {
  const { tag, identifiers } = await scratchIssues(page, 4);
  await page.goto(
    `/issues?team=${scratchTeam}&group=none&sort=created&q=${tag}`,
  );
  const rows = page.locator("li[data-row-issue]");
  await expect(rows).toHaveCount(4);
  const ordered = await rows.evaluateAll((items) =>
    items.map((item) =>
      item instanceof HTMLElement ? (item.dataset["rowIssue"] ?? "") : "",
    ),
  );
  await link(page, ordered[0] ?? "").focus();
  await page.keyboard.press("x");
  await page.keyboard.press("Shift+J");
  await page.keyboard.press("Shift+J");
  const selected = page.locator('li[data-selected="true"]');
  await expect(selected).toHaveCount(3);
  await page.keyboard.press("Shift+K");
  await expect(selected).toHaveCount(2);
  await page.keyboard.press("Escape");
  await expect(selected).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+a");
  await expect(selected).toHaveCount(4);
  // P opens the bulk priority picker while issues are selected.
  await page.keyboard.press("p");
  await page.getByRole("option", { name: "High" }).click();
  await expect(toastSaying(page, "Set 4 issues to High")).toBeVisible();
  for (const identifier of identifiers) {
    await expect(picker(page, "priority", identifier)).toHaveValue("2");
  }
  await page.keyboard.press("ControlOrMeta+z");
  for (const identifier of identifiers) {
    await expect(picker(page, "priority", identifier)).toHaveValue("0");
  }
});

test("⌘ . copies the focused issue's ID and ⌘ ⇧ , its link", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { tag, identifiers } = await scratchIssues(page, 1);
  const [identifier = ""] = identifiers;
  await page.goto(`/issues?team=${scratchTeam}&q=${tag}`);
  await link(page, identifier).focus();
  const clipboard = () =>
    page.evaluate(() => globalThis.navigator.clipboard.readText());
  await page.keyboard.press("ControlOrMeta+Period");
  await expect(toastSaying(page, `Copied ${identifier}`)).toBeVisible();
  expect(await clipboard()).toBe(identifier);
  await page.keyboard.press("ControlOrMeta+Shift+Comma");
  await expect(toastSaying(page, "Copied link")).toBeVisible();
  expect(await clipboard()).toMatch(new RegExp(`/issues/${identifier}$`, "u"));
});

const IssueSchema = z.object({
  result: z.object({
    data: z.object({
      state: z.object({ name: z.string() }),
      labels: z.array(z.object({ name: z.string() })),
    }),
  }),
});

test("Shift+C creates an issue in the view, ⌘ Enter stays and ⌘ ⇧ Enter opens it", async ({
  page,
}) => {
  await page.goto("/issues?state=Todo&label=feature");
  await expect(page.locator("a[data-issue-row]").first()).toBeVisible();
  await page.keyboard.press("Shift+C");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Status", { exact: true })).toHaveValue(
    "Todo",
  );
  await expect(
    dialog.getByRole("button", { name: "feature", exact: true }),
  ).toBeVisible();
  const title = `Prefilled ${String(Date.now())}`;
  await dialog.getByLabel("Issue title", { exact: true }).fill(title);
  await page.keyboard.press("ControlOrMeta+Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/issues\?state=Todo&label=feature$/u);
  const created = page.getByRole("link", { name: new RegExp(title, "u") });
  await expect(created).toBeVisible();
  const identifier = (await created.getAttribute("data-issue-row")) ?? "";
  const input = encodeURIComponent(JSON.stringify({ identifier }));
  const response = await page.request.get(
    `/trpc/issues.byIdentifier?input=${input}`,
  );
  const issue = IssueSchema.parse(await response.json()).result.data;
  expect(issue.state.name).toBe("Todo");
  expect(issue.labels.map(({ name }) => name)).toEqual(["feature"]);

  await page.keyboard.press("Shift+C");
  await page
    .getByRole("dialog")
    .getByLabel("Issue title", { exact: true })
    .fill(`${title} opened`);
  await page.keyboard.press("ControlOrMeta+Shift+Enter");
  await expect(page).toHaveURL(/\/issues\/AI-\d+$/u);
  await expect(page.getByLabel("Issue title", { exact: true })).toHaveValue(
    `${title} opened`,
  );
  await removeIssue(page.request, identifier);
  await removeIssue(page.request, page.url().split("/").at(-1) ?? "");
});
