import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import {
  DESKTOP,
  expectPagesFitViewport,
  gotoLoadedPage,
  PHONE,
  violations,
} from "./helpers.ts";

test("/reports renders KPIs, 13-stream matrix, feed filters, and navigates into run, digest, and incident inspectors", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/reports");
  await expect(page).toHaveTitle("Reports · Hub");
  await expect(
    page.getByRole("heading", { level: 1, name: "Reports" }),
  ).toBeVisible();

  // 5 KPI cards
  await expect(page.locator(".eng-kpi-card")).toHaveCount(5);
  await expect(
    page.locator(".eng-kpi-card", { hasText: "Needs Review" }),
  ).toContainText("1");
  await expect(
    page.locator(".eng-kpi-card", { hasText: "Automated PRs (7d)" }),
  ).toContainText("2");
  await expect(
    page.locator(".eng-kpi-card", { hasText: "Schedule Freshness" }),
  ).toContainText("13 / 13");
  await expect(
    page.locator(".eng-kpi-card", { hasText: "Incident Outbox" }),
  ).toContainText("0 pending · 0 failed");

  // 13-stream schedule matrix
  const matrix = page.getByRole("region", {
    name: "Recurring report schedules",
  });
  await expect(matrix).toBeVisible();
  await expect(matrix.locator(".rep-schedule-row")).toHaveCount(13);
  await expect(matrix).toContainText("Weekly link-rot scan");
  await expect(matrix).toContainText("The Storm promotion summary");
  await expect(matrix).toContainText("Auto-merge PR");
  await expect(matrix).toContainText("LLM Review PR");

  // Filter feed to one stream via matrix button
  await matrix
    .getByRole("button", { name: "Filter feed by Weekly vulnerability scan" })
    .click();
  await expect(page).toHaveURL(/scheduleId=main-vuln-scan-weekly/u);
  const feedTable = page.getByRole("table", {
    name: "Unified reports and outbound mail feed",
  });
  await expect(feedTable).toContainText(
    "Security scan: 1 advisory needs review (PR #3072)",
  );

  // Navigate into ReportRunPage deep-dive inspector
  await feedTable
    .getByRole("link", {
      name: "Security scan: 1 advisory needs review (PR #3072)",
    })
    .click();
  await expect(page).toHaveURL(
    /\/reports\/runs\/main-vuln-scan-weekly%3Alatest$/u,
  );
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Security scan: 1 advisory needs review (PR #3072)",
    }),
  ).toBeVisible();

  // Remediation banner & header links
  await expect(
    page.getByRole("region", { name: "Remediation and next steps" }),
  ).toContainText("Awaiting human review");
  await expect(
    page.getByRole("region", { name: "Remediation and next steps" }),
  ).toContainText("auto/vuln-remediation");
  await expect(
    page.getByRole("link", { name: /View workflow run/u }),
  ).toBeVisible();

  // Findings state filter: All (2) -> Active (1) -> Recovered (1)
  const findingsSection = page.locator("section", {
    has: page.getByRole("heading", { name: /Findings/u }),
  });
  await expect(findingsSection.locator(".rep-finding-card")).toHaveCount(2);
  await findingsSection.getByRole("button", { name: "Recovered" }).click();
  await expect(findingsSection.locator(".rep-finding-card")).toHaveCount(1);
  await expect(findingsSection).toContainText(
    "Previously tracked lodash advisory resolved on main",
  );
  await findingsSection.getByRole("button", { name: "Active" }).click();
  await expect(findingsSection.locator(".rep-finding-card")).toHaveCount(1);
  await expect(findingsSection).toContainText(
    "Moderate advisory awaiting upstream patch release",
  );

  // Click receipt chip to highlight raw evidence receipt below
  await findingsSection
    .getByRole("link", { name: "#receipt-vuln-scan" })
    .click();
  const receiptCard = page.locator("#receipt-receipt-vuln-scan");
  await expect(receiptCard).toHaveClass(/\brep-receipt-highlighted\b/u);
  await expect(receiptCard).toContainText("bun audit --json");
  await expect(receiptCard).toContainText("GHSA-sample-1");

  // Checks breakdown includes both failed required check and passed optional check
  const checksTable = page.getByRole("table", {
    name: "Report verification checks",
  });
  await expect(checksTable).toContainText("Workspace vulnerability audit");
  await expect(checksTable).toContainText("Container & filesystem scan");

  // Switch to ?view=email and toggle HTML iframe vs Plain text
  await page.getByRole("tab", { name: "Rendered Email" }).click();
  await expect(page).toHaveURL(/view=email/u);
  await expect(
    page.locator('iframe[title="Rendered email preview"]'),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Plain text" }).click();
  await expect(page.locator(".rep-plain-email")).toContainText(
    "Weekly vulnerability scan",
  );

  // Navigate back to /reports, switch to Digests tab, open DigestRunPage
  await page
    .getByRole("link", { name: "Reports", exact: true })
    .first()
    .click();
  await page.getByRole("tab", { name: "Digests" }).click();
  await expect(page).toHaveURL(/tab=digests/u);
  await feedTable.locator("tbody a.rep-feed-subject-link").first().click();
  await expect(page).toHaveURL(/\/reports\/digests\/(daily|weekly)\//u);
  await expect(page.getByRole("heading", { name: "Incidents" })).toBeVisible();
  await page.getByRole("tab", { name: "Rendered Email" }).click();
  await expect(
    page.locator('iframe[title="Rendered email preview"]'),
  ).toBeVisible();

  // Navigate to Incident Mail tab -> IncidentMailPage -> linked /alerts/:id
  await page.getByRole("link", { name: /Reports · Digests/u }).click();
  await page.getByRole("tab", { name: "Incident mail" }).click();
  await expect(page).toHaveURL(/tab=incidents/u);
  await feedTable
    .getByRole("link", { name: "Warning: Storage volume is nearly full" })
    .click();
  await expect(page).toHaveURL(
    /\/reports\/mail\/123e4567-e89b-42d3-a456-426614174099$/u,
  );
  await expect(
    page.getByRole("heading", { name: "Outbox & delivery metadata" }),
  ).toBeVisible();
  await expect(
    page.locator('iframe[title="Rendered email preview"]'),
  ).toBeVisible();
  await page.getByRole("link", { name: "DiskFull" }).click();
  await expect(page).toHaveURL(/\/alerts\/alert_a{32}$/u);
});

const REPORT_PATHS = [
  "/reports",
  "/reports?tab=digests",
  "/reports/runs/main-vuln-scan-weekly%3Alatest",
  "/reports/runs/main-vuln-scan-weekly%3Alatest?view=email",
  "/reports/mail/123e4567-e89b-42d3-a456-426614174099",
] as const;

for (const viewport of [PHONE, DESKTOP]) {
  test(`Reports pages fit ${String(viewport.width)}px without horizontal overflow`, async ({
    page,
  }) => {
    await expectPagesFitViewport(page, viewport, REPORT_PATHS);
  });
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`Reports pages have zero axe-core WCAG 2.2 AA violations in ${colorScheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize(DESKTOP);
    for (const path of REPORT_PATHS) {
      await gotoLoadedPage(page, path);
      // Email previews intentionally set `sandbox=""` (opaque origin, scripts
      // disabled), so legacy mode runs axe on the host document (including
      // `<iframe title>`) without `runPartial` cross-frame script injection.
      const builder = new AxeBuilder({ page }).setLegacyMode(true);
      expect(await violations(builder), path).toEqual([]);
    }
  });
}
