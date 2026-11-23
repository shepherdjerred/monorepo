import { expect, type Page } from "@playwright/test";
import {
  BUNDLE_IDS,
  CAPTURES,
  bundleReviewDetail,
} from "#testing/fixture-api/fixtures/migration/migration.ts";
import { HANDOFF_IDS } from "#testing/fixture-api/fixtures/migration/handoff.ts";
import { PROFILE_IDS } from "#testing/fixture-api/fixtures/profiles.ts";
import { sha256 } from "#testing/fixture-api/support.ts";
import { horizontalOverflow, test } from "#e2e/browser/support.ts";
import { bundleSummary, openReport } from "./migration-support.ts";
import { answerWrites, dropWrites, openManage, violations } from "./support.ts";

test.describe("the library report", () => {
  test("is built from the chosen captures and the library locations", async ({
    page,
  }) => {
    const created = bundleReviewDetail(
      BUNDLE_IDS.awaitingReview,
      bundleSummary(BUNDLE_IDS.awaitingReview),
    );
    const writes = await answerWrites(page, "/admin/migration/bundles", {
      json: created,
    });
    await openManage(page, "/manage/migration");
    const form = page.getByRole("form", { name: "Compare your captures" });
    await form
      .getByLabel("Movies, from Radarr")
      .selectOption(CAPTURES.radarr.captureId);
    await form
      .getByLabel("TV and anime, from Sonarr")
      .selectOption(CAPTURES.sonarr.captureId);
    await form.getByLabel("Movie root in Radarr").fill("/movies");
    await form.getByLabel("TV root in Sonarr").fill("/tv");
    await form.getByRole("button", { name: "Build library report" }).click();
    await expect(
      page.getByText("Library report built. Review it below."),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/admin/migration/bundles",
      body: {
        schemaVersion: 2,
        purpose: "initial_library",
        captureIds: [CAPTURES.radarr.captureId, CAPTURES.sonarr.captureId],
        rootMappings: [
          {
            captureId: CAPTURES.radarr.captureId,
            sourceRoot: "/movies",
            canonicalRoot: "/data/movies",
            verified: false,
          },
          {
            captureId: CAPTURES.sonarr.captureId,
            sourceRoot: "/tv",
            canonicalRoot: "/data/tv",
            verified: false,
          },
        ],
      },
    });
    await expect(
      page.getByRole("heading", { name: /^Library report built / }),
    ).toBeVisible();
  });

  test("asks for the captures it needs and a usable location", async ({
    page,
  }) => {
    const writes = await answerWrites(page, "/admin/migration/bundles");
    await openManage(page, "/manage/migration");
    const form = page.getByRole("form", { name: "Compare your captures" });
    await form.getByLabel("Movie root in Radarr").fill("/movies/../etc");
    await form.getByRole("button", { name: "Build library report" }).click();
    await expect(
      page.getByText("Choose a Radarr capture.").first(),
    ).toBeVisible();
    await expect(
      page.getByText("Choose a Sonarr capture.").first(),
    ).toBeVisible();
    await expect(
      page.getByText("Enter an absolute path such as /data/movies").first(),
    ).toBeVisible();
    expect(writes).toEqual([]);
  });

  test("approves exactly the records that were selected", async ({ page }) => {
    const summary = bundleSummary(BUNDLE_IDS.awaitingReview);
    const review = bundleReviewDetail(BUNDLE_IDS.awaitingReview, summary);
    const file = review.report.entries.find(
      (entry) => entry.sourceId === "movie-file-1",
    );
    if (file === undefined)
      throw new Error("The report has no first movie file");
    const writes = await answerWrites(
      page,
      `/admin/migration/bundles/${BUNDLE_IDS.awaitingReview}/review`,
      { json: { status: "completed", version: summary.version + 1 } },
    );
    await openManage(page, "/manage/migration");
    await openReport(page, 0);
    const approve = page.getByRole("button", {
      name: "Record selection approval",
    });
    await expect(approve).toBeDisabled();
    await expect(
      page.getByText("Select at least one record to approve."),
    ).toBeVisible();
    await page
      .getByRole("checkbox", { name: "Select File movie-file-1" })
      .check();
    await page
      .getByRole("checkbox", {
        name: /I understand that approval only records/u,
      })
      .check();
    await approve.click();
    await expect(page.getByText("Selection approved.")).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/admin/migration/bundles/${BUNDLE_IDS.awaitingReview}/review`,
      body: {
        action: "approve",
        expectedVersion: summary.version,
        reportHash: review.report.reportHash,
        bundleHash: review.manifest.bundleHash,
        recoveryEpoch: 1,
        runtimeVersion: 12,
        acknowledgeNoOwnershipTransfer: true,
        selected: [
          {
            provenanceKey: file.provenanceKey,
            evidenceHash: file.observationHash,
          },
        ],
      },
    });
  });

  test("cannot select a record that is still protected", async ({ page }) => {
    await openManage(page, "/manage/migration");
    await openReport(page, 0);
    await page.getByRole("button", { name: "Next records" }).click();
    await expect(
      page.getByRole("checkbox", { name: "Select Torrent torrent-1" }),
    ).toBeDisabled();
  });
});

test.describe("preparing files and adopting them", () => {
  test("prepares the chosen files for review without adopting anything", async ({
    page,
  }) => {
    const approved = bundleSummary(BUNDLE_IDS.approved);
    const review = bundleReviewDetail(BUNDLE_IDS.approved, approved);
    const file = review.report.entries.find(
      (entry) => entry.sourceId === "movie-file-1",
    );
    if (file === undefined)
      throw new Error("The report has no first movie file");
    await page.route(
      "**/api/v1/admin/migration/personal/passive?*",
      async (route) => route.fulfill({ json: [] }),
    );
    const writes = await answerWrites(page, "/admin/handoffs", {
      json: { status: "queued", handoffId: HANDOFF_IDS.awaitingReview },
    });
    await openManage(page, "/manage/migration");
    await expect(
      page.getByText("Choose a library report in step 3"),
    ).toBeVisible();
    await openReport(page, 1);
    const form = page.getByRole("form", { name: "Files to prepare" });
    await form
      .getByRole("button", { name: "Check files and prepare review" })
      .click();
    await expect(
      page.getByText("Select at least one file.").first(),
    ).toBeVisible();
    expect(writes).toEqual([]);
    await form.getByRole("checkbox", { name: /Dune/u }).check();
    await form
      .getByRole("button", { name: "Check files and prepare review" })
      .click();
    await expect(
      page.getByText("Review prepared. It is open in step 5."),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/admin/handoffs",
      body: {
        schemaVersion: 3,
        purpose: "migration",
        plexEditionLabels: "update_in_place",
        bundleReviewId: BUNDLE_IDS.approved,
        bundleReviewVersion: approved.version,
        bundleHash: review.manifest.bundleHash,
        reportHash: review.report.reportHash,
        recoveryEpoch: 1,
        runtimeVersion: 12,
        activation: "extend",
        selected: [
          {
            provenanceKey: file.provenanceKey,
            evidenceHash: file.observationHash,
          },
        ],
        profiles: [
          {
            captureId: CAPTURES.radarr.captureId,
            sourceProfileId: "4",
            profileId: PROFILE_IDS.captured,
          },
        ],
        movies: [],
        subtitlePolicies: [],
      },
    });
    await expect(page).toHaveURL(
      new RegExp(`handoff=${HANDOFF_IDS.awaitingReview}`, "u"),
    );
    await expect(page.getByText("Needs your approval")).toBeVisible();
  });

  const STATES = [
    ["preparing", "preparing", "Being prepared"],
    ["applying", "applying", "Being adopted"],
    ["applied", "applied", "Adopted"],
  ] as const;
  for (const [name, key, title] of STATES) {
    test(`shows a plan that is ${name} and offers nothing to approve`, async ({
      page,
    }) => {
      await openManage(page, `/manage/migration?handoff=${HANDOFF_IDS[key]}`);
      await expect(
        page
          .getByRole("region", { name: "5. Review and adopt files" })
          .getByText(title)
          .first(),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: "Adopt files and correct Plex labels",
        }),
      ).toHaveCount(0);
      expect(await horizontalOverflow(page)).toBe(0);
    });
  }

  test("shows a plan the server stopped for review, with its files and nothing to approve", async ({
    page,
  }) => {
    await openManage(
      page,
      `/manage/migration?handoff=${HANDOFF_IDS.requiresReview}`,
    );
    const plan = page.getByRole("region", {
      name: "5. Review and adopt files",
    });
    await expect(plan.getByText("Stopped for review")).toBeVisible();
    await expect(
      plan.getByText("failed or was cancelled before it finished"),
    ).toBeVisible();
    await expect(
      plan.getByText("Nothing more will run for this plan"),
    ).toBeVisible();
    await expect(
      plan.getByRole("link", { name: "View activity" }),
    ).toHaveAttribute("href", "/manage/activity");
    // The page still shows what the plan held, not a load error.
    await expect(
      plan.getByText("/data/movies/Dune (2021)/Dune (2021) Bluray-1080p.mkv"),
    ).toBeVisible();
    await expect(page.getByText("could not be loaded")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Adopt files and correct Plex labels" }),
    ).toHaveCount(0);
    await plan.getByText("Technical details").click();
    await expect(plan.getByText(/Review reference/u)).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    expect(await violations(page)).toEqual([]);
  });

  test("does not let an expired plan be approved", async ({ page }) => {
    await openManage(page, `/manage/migration?handoff=${HANDOFF_IDS.expired}`);
    await expect(page.getByText("This review expired")).toBeVisible();
    await page
      .getByRole("checkbox", { name: /I approve these file classifications/u })
      .check();
    await expect(
      page.getByRole("button", { name: "Adopt files and correct Plex labels" }),
    ).toBeDisabled();
  });

  test("adopts the files only after the acknowledgement and the confirmation", async ({
    page,
  }) => {
    const writes = await answerWrites(
      page,
      `/admin/handoffs/${HANDOFF_IDS.awaitingReview}/apply`,
      { json: { status: "queued" } },
    );
    await openManage(
      page,
      `/manage/migration?handoff=${HANDOFF_IDS.awaitingReview}`,
    );
    const adopt = page.getByRole("button", {
      name: "Adopt files and correct Plex labels",
    });
    await expect(adopt).toBeDisabled();
    await page
      .getByRole("checkbox", { name: /I approve these file classifications/u })
      .check();
    await adopt.click();
    const dialog = page.getByRole("dialog", { name: "Adopt these files?" });
    await expect(dialog).toContainText("2 files");
    await expect(dialog).toContainText("1 Plex edition label");
    await expect(dialog).toContainText("1 series");
    await expect(dialog).toContainText("cannot undo it");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(writes).toEqual([]);
    await adopt.click();
    await dialog.getByRole("button", { name: "Adopt files" }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/admin/handoffs/${HANDOFF_IDS.awaitingReview}/apply`,
      body: {
        schemaVersion: 3,
        expectedVersion: 3,
        planHash: sha256(`plan:${HANDOFF_IDS.awaitingReview}`),
        recoveryEpoch: 1,
        runtimeVersion: 12,
        acknowledgeRecoveryHolds: true,
      },
    });
  });

  test("says what the state is when adopting was refused", async ({ page }) => {
    await answerWrites(
      page,
      `/admin/handoffs/${HANDOFF_IDS.awaitingReview}/apply`,
      {
        status: 409,
        json: {
          error: {
            code: "handoff_stale",
            message: "The plan changed; prepare it again",
          },
        },
      },
    );
    await openManage(
      page,
      `/manage/migration?handoff=${HANDOFF_IDS.awaitingReview}`,
    );
    await adoptFiles(page);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("The adoption was not submitted");
    await expect(alert).toContainText("The plan changed; prepare it again");
    await expect(alert).toContainText("nothing was adopted");
    expect(await violations(page)).toEqual([]);
  });
});

test("says the outcome is unknown, not that nothing was adopted, when the adoption's response is lost", async ({
  page,
}) => {
  const writes = await dropWrites(
    page,
    `/admin/handoffs/${HANDOFF_IDS.awaitingReview}/apply`,
  );
  await openManage(
    page,
    `/manage/migration?handoff=${HANDOFF_IDS.awaitingReview}`,
  );
  await adoptFiles(page);
  await expect.poll(() => writes.length).toBe(1);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(
    "cannot tell whether the adoption was submitted",
  );
  await expect(alert).not.toContainText("nothing was adopted");
  await expect(
    alert.getByRole("button", { name: "Refresh the plan" }),
  ).toBeVisible();
});

/** Acknowledges the classifications and confirms the adoption in the dialog. */
async function adoptFiles(page: Page) {
  await page
    .getByRole("checkbox", { name: /I approve these file classifications/u })
    .check();
  await page
    .getByRole("button", { name: "Adopt files and correct Plex labels" })
    .click();
  await page
    .getByRole("dialog", { name: "Adopt these files?" })
    .getByRole("button", { name: "Adopt files" })
    .click();
}
