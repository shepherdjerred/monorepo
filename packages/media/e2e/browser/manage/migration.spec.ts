import { expect } from "@playwright/test";
import { migrationProposalDetail } from "#testing/fixture-api/fixtures/migration.ts";
import { horizontalOverflow, inScenario, test } from "#e2e/browser/support.ts";
import { SNAPSHOT, openCapture, proposalSummary } from "./migration-support.ts";
import { answerWrites, openManage, violations } from "./support.ts";

test.describe("the migration page", () => {
  test("shows where each step stands and fits the screen", async ({ page }) => {
    await openManage(page, "/manage/migration");
    const steps = page.getByRole("navigation", { name: "Migration steps" });
    await expect(steps.getByRole("listitem")).toHaveText([
      /Add a capture\s*5 saved/u,
      /Review captures\s*1 to review/u,
      /Library report\s*1 to review/u,
      /Prepare files\s*Ready/u,
      /Review and adopt\s*No plan open/u,
    ]);
    await expect(
      page.getByRole("heading", { level: 2 }).filter({ hasText: /^\d\./u }),
    ).toHaveText([
      "1. Add a capture",
      "2. Review each capture",
      "3. Build and approve the library report",
      "4. Prepare files for adoption",
      "5. Review and adopt files",
    ]);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(await violations(page)).toEqual([]);
  });

  test("says so when nothing has been captured or built", async ({ page }) => {
    await inScenario(page, "new-household");
    await openManage(page, "/manage/migration");
    await expect(
      page.getByText(
        "No captures yet. Existing library ownership is unchanged.",
      ),
    ).toBeVisible();
    await expect(page.getByText("No library report yet.")).toBeVisible();
    await expect(page.getByText("No plan is open.")).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test("sends the capture file as it always did and opens its review", async ({
    page,
  }) => {
    const sonarr = proposalSummary("sonarr");
    const writes = await answerWrites(page, "/admin/migration", {
      json: migrationProposalDetail(sonarr),
    });
    await openManage(page, "/manage/migration");
    await page.getByLabel("Capture JSON").setInputFiles({
      name: "capture.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ snapshot: SNAPSHOT })),
    });
    await page.getByRole("button", { name: "Upload and compare" }).click();
    await expect(
      page.getByText("Capture saved. Review the comparison in step 2."),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/admin/migration",
      body: { snapshot: SNAPSHOT },
    });
    await expect(
      page.getByRole("heading", { name: /^Review: Sonarr/ }),
    ).toBeVisible();
  });

  test("refuses to send with no file chosen", async ({ page }) => {
    const writes = await answerWrites(page, "/admin/migration");
    await openManage(page, "/manage/migration");
    await page.getByRole("button", { name: "Upload and compare" }).click();
    await expect(
      page.getByText("Choose the capture file.").first(),
    ).toBeVisible();
    expect(writes).toEqual([]);
  });

  test("approves a capture only after the acknowledgement", async ({
    page,
  }) => {
    const sonarr = proposalSummary("sonarr");
    const detail = migrationProposalDetail(sonarr);
    const writes = await answerWrites(
      page,
      `/admin/migration/${sonarr.id}/review`,
      { json: { status: "completed", version: sonarr.version + 1 } },
    );
    await openManage(page, "/manage/migration");
    await openCapture(page, /Review the Sonarr/u);
    const approve = page.getByRole("button", { name: "Record approval" });
    await expect(approve).toBeDisabled();
    await page
      .getByRole("checkbox", { name: /I reviewed this evidence/u })
      .check();
    await approve.click();
    await expect(
      page.getByText("Approval recorded. This capture counts as reviewed."),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/admin/migration/${sonarr.id}/review`,
      body: {
        action: "approve",
        expectedVersion: sonarr.version,
        reportHash: sonarr.reportHash,
        captureHash: detail.captureHash,
        recoveryEpoch: 1,
        runtimeVersion: 12,
        acknowledgeNoOwnershipTransfer: true,
      },
    });
  });

  test("says that a stale review saved nothing and offers the current one", async ({
    page,
  }) => {
    const sonarr = proposalSummary("sonarr");
    await answerWrites(page, `/admin/migration/${sonarr.id}/review`, {
      status: 409,
      json: {
        error: {
          code: "migration_review_stale",
          message: "Bundle, report or runtime changed; regenerate review",
        },
      },
    });
    await openManage(page, "/manage/migration");
    await openCapture(page, /Review the Sonarr/u);
    await page
      .getByRole("checkbox", { name: /I reviewed this evidence/u })
      .check();
    await page.getByRole("button", { name: "Record approval" }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("The approval was not recorded");
    await expect(alert).toContainText(
      "Bundle, report or runtime changed; regenerate review",
    );
    await expect(alert).toContainText("so nothing was saved");
    await expect(
      alert.getByRole("button", { name: "Load the current review" }),
    ).toBeVisible();
  });

  test("asks before revoking a capture's approval", async ({ page }) => {
    const radarr = proposalSummary("radarr");
    const writes = await answerWrites(
      page,
      `/admin/migration/${radarr.id}/review`,
      { json: { status: "completed", version: radarr.version + 1 } },
    );
    await openManage(page, "/manage/migration");
    await openCapture(page, /Review the Radarr 5.14.0.9383 capture/u);
    await page.getByRole("button", { name: "Revoke approval" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Revoke approval of the Radarr capture?",
    });
    await expect(dialog).toContainText("upload a fresh capture");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(writes).toEqual([]);
    await page.getByRole("button", { name: "Revoke approval" }).click();
    await dialog.getByRole("button", { name: "Revoke approval" }).click();
    await expect(
      page.getByText("Approval revoked. This capture no longer counts"),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      body: { action: "revoke", expectedVersion: radarr.version },
    });
  });

  test("keeps the long proofs behind technical details", async ({ page }) => {
    const sonarr = proposalSummary("sonarr");
    await openManage(page, "/manage/migration");
    await openCapture(page, /Review the Sonarr/u);
    const hash = page.getByText(sonarr.captureHash);
    await expect(hash).toBeHidden();
    await page.getByText("Technical details").first().click();
    await expect(hash).toBeVisible();
    await expect(page.getByText(sonarr.reportHash)).toBeVisible();
  });

  test("reads a long capture fifty records at a time", async ({ page }) => {
    await openManage(page, "/manage/migration");
    await openCapture(page, /Review the Sonarr/u);
    await expect(page.getByText("1–50 of 54 records")).toBeVisible();
    await page.getByRole("button", { name: "Next records" }).click();
    await expect(page.getByText("51–54 of 54 records")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Next records" }),
    ).toBeDisabled();
  });
});
