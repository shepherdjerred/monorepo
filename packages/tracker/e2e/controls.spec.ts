import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";
import {
  createIssue,
  recordCalls,
  removeIssue,
  scratchTeam,
  toastSaying,
  undo,
  uniqueTag,
} from "./data-helpers.ts";

const row = (page: Page, identifier: string) =>
  page.locator(`li[data-row-issue="${identifier}"]`);
const picker = (page: Page, name: string, identifier: string) =>
  page.locator(`[data-picker="${name}"][data-issue="${identifier}"]`);
const PrioritySchema = z.object({
  result: z.object({ data: z.object({ priority: z.number() }) }),
});
/** The priority the server holds for an issue. */
async function serverPriority(page: Page, identifier: string) {
  const input = encodeURIComponent(JSON.stringify({ identifier }));
  const response = await page.request.get(
    `/trpc/issues.byIdentifier?input=${input}`,
  );
  return PrioritySchema.parse(await response.json()).result.data.priority;
}
const saved = (page: Page, text: string) =>
  page.waitForResponse(
    (response) =>
      response.url().includes("issues.update") &&
      (response.request().postData() ?? "").includes(text) &&
      response.ok(),
  );

/** Issues of the scratch team that only this test's list shows. */
async function scratchIssues(
  page: Page,
  count: number,
  extra: { priority?: number } = {},
) {
  const tag = uniqueTag();
  const identifiers: string[] = [];
  for (let index = 0; index < count; index += 1) {
    identifiers.push(
      await createIssue(page.request, {
        teamKey: scratchTeam,
        title: `Controls ${tag} ${String(index + 1)}`,
        ...extra,
      }),
    );
  }
  return { tag, identifiers };
}

/** Open the issue menu as the platform does: right click, or long press. */
async function openMenu(page: Page, identifier: string, mobile: boolean) {
  const link = page.locator(`a[data-issue-row="${identifier}"]`);
  if (!mobile) {
    await link.click({ button: "right" });
    return;
  }
  const box = await link.boundingBox();
  if (box === null) throw new Error(`${identifier} is not on screen`);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  await expect(page.getByRole("menu")).toBeVisible();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}

test("a row's status changes in place, through the customizable select, without a peek", async ({
  page,
}) => {
  const { tag, identifiers } = await scratchIssues(page, 1);
  const [identifier = ""] = identifiers;
  await page.goto(`/issues?team=${scratchTeam}&q=${tag}`);
  const status = picker(page, "state", identifier);
  await expect(status).toHaveValue("Triage");
  // Chromium renders the customizable select; other engines get Base UI.
  expect(
    await status.evaluate((element) => getComputedStyle(element).appearance),
  ).toBe("base-select");
  const done = saved(page, "In progress");
  await status.click();
  await page.getByRole("option", { name: "In progress" }).click();
  await expect(status).toHaveValue("In progress");
  await expect(
    toastSaying(page, `${identifier} status set to In progress`),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/peek=/u);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await done;
  await page.reload();
  await expect(picker(page, "state", identifier)).toHaveValue("In progress");
});

test("the assignee picker filters as you type and Enter assigns", async ({
  page,
}) => {
  const { tag, identifiers } = await scratchIssues(page, 1);
  const [identifier = ""] = identifiers;
  await page.goto(`/issues?team=${scratchTeam}&q=${tag}`);
  await picker(page, "assignee", identifier).click();
  const search = page.getByRole("combobox", {
    name: `Assignee of ${identifier}`,
  });
  await expect(search).toBeFocused();
  // People come first, and the browser's own actor heads the list.
  const options = page.locator(".search-picker").getByRole("option");
  await expect(options.first()).toContainText("Assign to me");
  await search.fill("migr");
  await expect(options).toHaveCount(1);
  const done = saved(page, "system:migration");
  await page.keyboard.press("Enter");
  await expect(
    toastSaying(page, `${identifier} assigned to Migration`),
  ).toBeVisible();
  await expect(picker(page, "assignee", identifier)).toHaveAttribute(
    "aria-label",
    `Assignee of ${identifier}: Migration`,
  );
  await done;
});

test("labels toggle in the picker without closing it", async ({ page }) => {
  // Labels belong to the team that has them.
  const identifier = await createIssue(page.request, {
    teamKey: "AI",
    title: `Label toggles ${String(Date.now())}`,
  });
  await page.goto(`/issues/${identifier}`);
  await page.locator("#property-labels").click();
  const listbox = page.getByRole("listbox");
  await listbox.getByRole("option", { name: "bug" }).click();
  await listbox.getByRole("option", { name: "feature" }).click();
  await expect(listbox).toBeVisible();
  await expect(listbox.getByRole("option", { name: "bug" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(page.locator("#property-labels")).toContainText("bug");
  await expect(page.locator("#property-labels")).toContainText("feature");
  await page.reload();
  await expect(page.locator("#property-labels")).toContainText("bug");
  await expect(page.locator("#property-labels")).toContainText("feature");
  await removeIssue(page.request, identifier);
});

test("three selected issues change priority in one atomic request and one Undo reverts all", async ({
  page,
}, info) => {
  const mobile = info.project.name === "mobile";
  const { tag, identifiers } = await scratchIssues(page, 3);
  await page.goto(`/issues?team=${scratchTeam}&group=none&q=${tag}`);
  for (const identifier of identifiers) {
    await openMenu(page, identifier, mobile);
    await page.getByRole("menuitem", { name: "Select", exact: true }).click();
    await expect(row(page, identifier)).toHaveAttribute(
      "data-selected",
      "true",
    );
  }
  const bar = page.getByRole("region", { name: "Selected issues" });
  await expect(bar).toContainText("3 selected");
  const calls = recordCalls(page);
  const sent = (procedure: string) =>
    calls.filter((call) =>
      (call.split("?")[0] ?? "").split(",").includes(procedure),
    );
  await bar.locator("#bulk-priority").selectOption("Urgent");
  await expect(toastSaying(page, "Set 3 issues to Urgent")).toBeVisible();
  for (const identifier of identifiers) {
    await expect(picker(page, "priority", identifier)).toHaveValue("1");
  }
  // One toast for the three edits, not one each.
  await expect(page.locator(".toast")).toHaveCount(1);
  for (const identifier of identifiers) {
    await expect.poll(() => serverPriority(page, identifier)).toBe(1);
  }
  // All three in one bulk request; never an update per issue.
  expect(sent("issues.bulkUpdate")).toHaveLength(1);
  expect(sent("issues.update")).toEqual([]);
  await undo(page).click();
  for (const identifier of identifiers) {
    await expect(picker(page, "priority", identifier)).toHaveValue("0");
  }
  for (const identifier of identifiers) {
    await expect.poll(() => serverPriority(page, identifier)).toBe(0);
  }
  // They all had the same priority before, so the undo is one request too.
  expect(sent("issues.bulkUpdate")).toHaveLength(2);
  expect(sent("issues.update")).toEqual([]);
  await page.reload();
  for (const identifier of identifiers) {
    await expect(picker(page, "priority", identifier)).toHaveValue("0");
  }
});

test("the context menu copies an issue's ID to the clipboard", async ({
  page,
  context,
}, info) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const { tag, identifiers } = await scratchIssues(page, 1);
  const [identifier = ""] = identifiers;
  await page.goto(`/issues?team=${scratchTeam}&q=${tag}`);
  await openMenu(page, identifier, info.project.name === "mobile");
  await page.getByRole("menuitem", { name: "Copy ID" }).click();
  await expect(toastSaying(page, `Copied ${identifier}`)).toBeVisible();
  expect(
    await page.evaluate(() => globalThis.navigator.clipboard.readText()),
  ).toBe(identifier);
});

test("grouping by priority shows headers, and a collapsed group stays collapsed after reload", async ({
  page,
}) => {
  const urgent = await scratchIssues(page, 1, { priority: 1 });
  const high = await createIssue(page.request, {
    teamKey: scratchTeam,
    title: `Controls ${urgent.tag} high`,
    priority: 2,
  });
  await page.goto(`/issues?team=${scratchTeam}&q=${urgent.tag}&group=priority`);
  const highGroup = page.locator(".group-row .group-toggle", {
    hasText: "High",
  });
  await expect(
    page.locator(".group-row .group-toggle", { hasText: "Urgent" }),
  ).toBeVisible();
  await expect(highGroup).toHaveAttribute("aria-expanded", "true");
  await expect(row(page, high)).toBeVisible();
  await highGroup.click();
  await expect(page).toHaveURL(/collapsed=2/u);
  await expect(row(page, high)).toHaveCount(0);
  await expect(row(page, urgent.identifiers[0] ?? "")).toBeVisible();
  // Only the issues a reader can reach are counted.
  await expect(row(page, urgent.identifiers[0] ?? "")).toHaveAttribute(
    "aria-posinset",
    "1",
  );
  await expect(row(page, urgent.identifiers[0] ?? "")).toHaveAttribute(
    "aria-setsize",
    "1",
  );
  await expect(page.locator("li[aria-posinset]")).toHaveCount(1);
  await page.reload();
  await expect(highGroup).toHaveAttribute("aria-expanded", "false");
  await expect(row(page, high)).toHaveCount(0);
});

test("filters are picked in one popover and removed as chips", async ({
  page,
}) => {
  await page.goto("/issues?state=Done");
  const chips = page.getByRole("list", { name: "Active filters" });
  await expect(chips).toContainText("Status is Done");
  await expect(
    page.getByRole("link", { name: /Keep session identity stable/u }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Make attachment uploads resumable/u }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Remove filter: Status is Done" })
    .click();
  await expect(page).toHaveURL(/\/issues$/u);
  await expect(
    page.getByRole("link", { name: /Make attachment uploads resumable/u }),
  ).toBeVisible();

  await page.getByRole("button", { name: /^Filter/u }).click();
  const field = page.getByRole("combobox", { name: "Filter by" });
  await field.fill("lab");
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: "bug" }).click();
  await expect(page).toHaveURL(/label=bug/u);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(chips).toContainText("Label has bug");
  await expect(
    page.getByRole("link", { name: /Make attachment uploads resumable/u }),
  ).toHaveCount(0);
});

test("the palette steps into Set status and back out again", async ({
  page,
}) => {
  const { identifiers } = await scratchIssues(page, 1);
  const [identifier = ""] = identifiers;
  await page.goto(`/issues?team=${scratchTeam}&peek=${identifier}`);
  const peek = page.getByRole("dialog");
  await expect(peek.getByLabel("Status", { exact: true })).toHaveValue(
    "Triage",
  );
  await page.keyboard.press("ControlOrMeta+k");
  const root = page.getByRole("combobox", {
    name: "Search issues and commands",
  });
  await root.fill("set status");
  await page.keyboard.press("Enter");
  const step = page.getByRole("combobox", { name: "Set status" });
  await expect(step).toBeFocused();
  await expect(page.getByRole("option", { name: /Triage/u })).toBeVisible();
  // Backspace on an empty query steps back out, as Escape does.
  await page.keyboard.press("Backspace");
  await expect(root).toBeVisible();
  await root.fill("set status");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(root).toBeVisible();
  await root.fill("set status");
  await page.keyboard.press("Enter");
  await step.fill("progress");
  await page.keyboard.press("Enter");
  await expect(
    toastSaying(page, `${identifier} status set to In progress`),
  ).toBeVisible();
  await expect(peek.getByLabel("Status", { exact: true })).toHaveValue(
    "In progress",
  );
});

test("a relation's target is found by searching, or typed in full", async ({
  page,
}) => {
  const { identifiers } = await scratchIssues(page, 2);
  const [from = "", to = ""] = identifiers;
  await page.goto(`/issues/${from}`);
  await page.getByRole("button", { name: "+ Add relation" }).click();
  const dialog = page.getByRole("dialog", { name: "Add relation" });
  const field = dialog.getByRole("combobox", { name: "Issue" });
  await field.fill("attachment uploads");
  await page
    .getByRole("option", { name: /AI-2 Make attachment uploads resumable/u })
    .click();
  await expect(field).toHaveValue("AI-2");
  await dialog.getByRole("button", { name: "Add relation" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("section.relations")).toContainText("AI-2");

  await page.getByRole("button", { name: "+ Add relation" }).click();
  await page
    .getByRole("dialog", { name: "Add relation" })
    .getByRole("combobox", { name: "Issue" })
    .fill(to.toLowerCase());
  // A typed identifier needs no pick, and survives closing the results.
  await expect(
    page.getByRole("option", { name: new RegExp(to, "u") }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page
      .getByRole("dialog", { name: "Add relation" })
      .getByRole("combobox", { name: "Issue" }),
  ).toHaveValue(new RegExp(to, "iu"));
  await page
    .getByRole("dialog", { name: "Add relation" })
    .getByRole("button", { name: "Add relation" })
    .click();
  await expect(page.locator("section.relations")).toContainText(to);
});
