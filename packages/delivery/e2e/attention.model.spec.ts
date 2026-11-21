import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.ts";

// Served by e2e/model-server.ts: Arcade prod's accepted release has a firing
// critical alarm under a hold policy, and Cloudflare's tofu stack has a saved
// plan waiting for a decision.

async function openOverview(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview", exact: true }),
  ).toBeVisible();
  return page.getByRole("region", { name: "Needs attention" });
}

function tile(page: Page, title: string) {
  return page
    .getByRole("main")
    .getByRole("listitem")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });
}

test("an alarm on an accepted release needs attention and marks its chip", async ({
  page,
}) => {
  const attention = await openOverview(page);
  const alarm = attention
    .getByRole("listitem")
    .filter({ hasText: "Arcade prod monitor alarm" });
  await expect(alarm).toContainText("Alarm");
  await expect(alarm).toContainText(
    /A monitor alarm fired on the accepted release r\d+\. It stays live until a rollback or a new release replaces it\./u,
  );
  await expect(
    alarm.getByRole("link", { name: "Arcade prod monitor alarm" }),
  ).toHaveAttribute("href", "/environments/arcade/prod");
  const prod = tile(page, "Arcade").getByRole("link", { name: /^prod / });
  await expect(prod).toContainText("alarm firing");
  await expectNoHorizontalOverflow(page);
});

test("a saved plan waiting for a decision is awaiting approval, not running", async ({
  page,
}) => {
  const attention = await openOverview(page);
  await expect(
    attention.getByRole("link", {
      name: "OpenTofu cloudflare stack prod awaits plan approval",
    }),
  ).toBeVisible();
  const chip = tile(page, "OpenTofu cloudflare stack").getByRole("link", {
    name: /^prod /u,
  });
  await expect(chip).toContainText("awaiting approval");
  await expect(chip).not.toContainText("running");
  await expectNoHorizontalOverflow(page);
});

test("the pipelines list calls a locked environment recovery required beside its passed CI run", async ({
  page,
}) => {
  await page.goto("/pipelines");
  const row = page
    .getByRole("table")
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "Arcade", exact: true }) });
  await expect(
    row.getByRole("link", { name: "CI run #104", exact: true }),
  ).toBeVisible();
  await expect(
    row.getByRole("link", { name: "recovery required beta" }),
  ).toHaveAttribute("href", "/environments/arcade/beta");
  await expect(
    row.getByRole("link", { name: "awaiting approval prod" }),
  ).toBeVisible();
});
