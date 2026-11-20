import { expect, test, type Page } from "@playwright/test";
import {
  createIssue,
  removeScratchIssues,
  scratchTag,
  scratchTeam,
  toastSaying,
} from "./data-helpers.ts";

test.afterEach(({ request }) => removeScratchIssues(request));

const row = (page: Page, identifier: string) =>
  page.locator(`li[data-row-issue="${identifier}"]`);
const picker = (page: Page, name: string, identifier: string) =>
  page.locator(`[data-picker="${name}"][data-issue="${identifier}"]`);

test("impact and urgency auto-compute priority, manual override pins it, Pinned · Auto resets it, and Cmd/Ctrl+Z undoes", async ({
  page,
  request,
}) => {
  const tag = scratchTag();
  const identifier = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Auto priority ${tag}`,
  });
  await page.goto(`/issues/${identifier}`);

  const priority = page.locator("#property-priority");
  await expect(priority).toHaveValue("0");
  await expect(page.locator(".priority-mode")).toHaveCount(0);
  await expect(page.locator("#property-priority-auto")).toHaveCount(0);

  await page.locator("#property-impact").selectOption("High");
  await expect(
    toastSaying(page, `${identifier} impact set to High`),
  ).toBeVisible();
  await expect(priority).toHaveValue("2");
  await expect(page.locator(".priority-mode")).toHaveText("Auto");

  await page.locator("#property-urgency").selectOption("High");
  await expect(
    toastSaying(page, `${identifier} urgency set to High`),
  ).toBeVisible();
  await expect(priority).toHaveValue("1");
  await expect(page.locator(".priority-mode")).toHaveText("Auto");

  await priority.selectOption("Low");
  await expect(
    toastSaying(page, `${identifier} priority set to Low`),
  ).toBeVisible();
  await expect(priority).toHaveValue("4");
  await expect(page.locator("#property-priority-auto")).toHaveText(
    "Pinned · Auto",
  );
  await expect(page.locator(".priority-mode")).toHaveCount(0);

  await page.locator("#property-priority-auto").click();
  await expect(
    toastSaying(page, `${identifier} priority set to auto (Urgent)`),
  ).toBeVisible();
  await expect(priority).toHaveValue("1");
  await expect(page.locator(".priority-mode")).toHaveText("Auto");
  await expect(page.locator("#property-priority-auto")).toHaveCount(0);

  await page.getByRole("heading", { name: "Properties" }).click();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(toastSaying(page, `${identifier} change undone`)).toBeVisible();
  await expect(priority).toHaveValue("4");
  await expect(page.locator("#property-priority-auto")).toHaveText(
    "Pinned · Auto",
  );

  const saved = page.waitForResponse(
    (response) => response.url().includes("issues.update") && response.ok(),
  );
  await page.locator("#property-priority-auto").click();
  await saved;
  await page.reload();
  await expect(priority).toHaveValue("1");
  await expect(page.locator(".priority-mode")).toHaveText("Auto");
});

test("effort shows on list rows and supports multi-value XS + S filtering", async ({
  page,
  request,
}) => {
  const tag = scratchTag();
  const xsId = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Effort xs ${tag}`,
  });
  const sId = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Effort s ${tag}`,
    effort: "s",
  });
  const xlId = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Effort xl ${tag}`,
    effort: "xl",
  });

  await page.goto(`/issues/${xsId}`);
  const saved = page.waitForResponse(
    (response) => response.url().includes("issues.update") && response.ok(),
  );
  await page.locator("#property-effort").selectOption("XS");
  await expect(toastSaying(page, `${xsId} effort set to XS`)).toBeVisible();
  await saved;

  await page.goto(`/issues?team=${scratchTeam}&group=none&q=${tag}`);
  await expect(picker(page, "effort", xsId)).toHaveValue("xs");
  await expect(row(page, xsId)).toContainText("XS");
  await expect(picker(page, "effort", sId)).toHaveValue("s");
  await expect(picker(page, "effort", xlId)).toHaveValue("xl");

  await page.getByRole("button", { name: /^Filter/u }).click();
  await page.getByRole("combobox", { name: "Filter by" }).fill("effort");
  await page.keyboard.press("Enter");
  await page.getByRole("option", { name: "XS", exact: true }).click();
  await page.getByRole("option", { name: "S", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  const chips = page.getByRole("list", { name: "Active filters" });
  await expect(chips).toContainText("Effort is XS, S");
  await expect(row(page, xsId)).toBeVisible();
  await expect(row(page, sId)).toBeVisible();
  await expect(row(page, xlId)).toHaveCount(0);
});

test("votes self-escalate untriaged issues and display Auto · +votes", async ({
  page,
  request,
}) => {
  const tag = scratchTag();
  const identifier = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Vote escalation ${tag}`,
  });

  for (const index of [1, 2]) {
    const res = await request.post("/trpc/votes.cast", {
      data: {
        actor: {
          key: `codex:voter-${String(index)}-${tag}`,
          name: `Voter ${String(index)}`,
          kind: "agent",
          metadata: {},
        },
        identifier,
      },
    });
    expect(res.ok()).toBe(true);
  }

  await page.goto(`/issues/${identifier}`);
  const priority = page.locator("#property-priority");
  await expect(priority).toHaveValue("0");
  await expect(page.locator(".priority-mode")).toHaveCount(0);

  await page.getByRole("button", { name: /^2 votes$/u }).click();
  await expect(priority).toHaveValue("3");
  await expect(page.locator(".priority-mode")).toHaveText("Auto · +votes");
});
