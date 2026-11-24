import { expect, type Page } from "@playwright/test";
import {
  ARCHIVE_REVIEW_IDS,
  archiveReviewDetail,
} from "#testing/fixture-api/fixtures/migration/archive.ts";
import {
  COMPENSATION_REVIEW_IDS,
  compensationReviewDetail,
} from "#testing/fixture-api/fixtures/migration/compensation.ts";
import {
  QUARANTINE_REVIEW_IDS,
  quarantineReviewDetail,
} from "#testing/fixture-api/fixtures/migration/quarantine.ts";
import {
  SERIES_PACK_REVIEW_IDS,
  seriesPackReviewDetail,
} from "#testing/fixture-api/fixtures/migration/series-pack.ts";
import { horizontalOverflow, test } from "#e2e/browser/support.ts";
import { answerWrites, dropWrites, openManage, violations } from "./support.ts";

const NATIVE = "/manage/recovery/native";

const PHYSICAL = {
  acknowledgePhysicalOwnershipOnly: true,
  acknowledgeRecoveryHolds: true,
  acknowledgeSubtitlePolicies: true,
};
const COMPENSATION = {
  acknowledgeCompensationOnly: true,
  acknowledgeRecoveryHolds: true,
  acknowledgeSuccessorRetained: true,
};

type Kind = {
  name: string;
  heading: string;
  ids: { awaitingReview: string; preparing: string; applied: string };
  detail: (id: string) => { version: number; planHash: string | null } | null;
  acknowledgement: RegExp;
  button: string;
  dialog: string;
  confirm: string;
  acknowledgements: Record<string, boolean>;
  /** What the awaiting review lists, so the page is known to show its scope. */
  shows: string[];
  /** A sentence only the applied review says. */
  applied: string;
};

const KINDS: Kind[] = [
  {
    name: "quarantined files",
    heading: "Recover quarantined file ownership",
    ids: QUARANTINE_REVIEW_IDS,
    detail: quarantineReviewDetail,
    acknowledgement: /I reviewed these titles, subtitle policies/u,
    button: "Apply this exact physical review",
    dialog: "Renew file ownership?",
    confirm: "Renew ownership",
    acknowledgements: PHYSICAL,
    shows: ["Affected titles", "Heat", "Moonlight"],
    applied: "Held in quarantine",
  },
  {
    name: "an archive cleanup",
    heading: "Resume archive expiry cleanup",
    ids: ARCHIVE_REVIEW_IDS,
    detail: archiveReviewDetail,
    acknowledgement: /I reviewed the selected cleanups/u,
    button: "Resume archive expiry cleanup",
    dialog: "Resume expiry cleanup?",
    confirm: "Resume cleanup",
    acknowledgements: PHYSICAL,
    shows: ["Selected and retained files", "Selected for expiry cleanup"],
    applied: "A current Keep choice or pin protects these files.",
  },
  {
    name: "an interrupted upgrade",
    heading: "Restore reviewed predecessor files",
    ids: COMPENSATION_REVIEW_IDS,
    detail: compensationReviewDetail,
    acknowledgement: /I reviewed the predecessor restoration/u,
    button: "Approve this exact predecessor restoration",
    dialog: "Approve this predecessor restoration?",
    confirm: "Approve restoration",
    acknowledgements: COMPENSATION,
    shows: ["Complete upgrade coverage", "Interstellar", "Knives Out"],
    applied: "Plex has verified the restored files",
  },
  {
    name: "a season pack",
    heading: "Restore the reviewed earlier TV files",
    ids: SERIES_PACK_REVIEW_IDS,
    detail: seriesPackReviewDetail,
    acknowledgement: /I reviewed all covered titles/u,
    button: "Approve this exact predecessor restoration",
    dialog: "Approve this restoration?",
    confirm: "Approve restoration",
    acknowledgements: COMPENSATION,
    shows: ["Complete title coverage", "The Bear S01E01"],
    applied: "Plex has verified the restored files",
  },
];

function reviewOf(kind: Kind, id: string) {
  const found = kind.detail(id);
  if (found === null) throw new Error(`No ${kind.name} fixture ${id}`);
  return found;
}

async function approve(page: Page, kind: Kind) {
  await page.getByRole("checkbox", { name: kind.acknowledgement }).check();
  await page.getByRole("button", { name: kind.button }).click();
}

for (const kind of KINDS) {
  test.describe(`a review of ${kind.name}`, () => {
    test("shows what it covers and fits the screen", async ({ page }) => {
      await openManage(page, `${NATIVE}/${kind.ids.awaitingReview}`);
      await expect(
        page.getByRole("heading", { level: 1, name: kind.heading }),
      ).toBeVisible();
      for (const text of kind.shows) {
        await expect(page.getByText(text).first()).toBeVisible();
      }
      expect(await horizontalOverflow(page)).toBe(0);
      expect(await violations(page)).toEqual([]);
    });

    test("is approved only after the acknowledgement and the confirmation", async ({
      page,
    }) => {
      const review = reviewOf(kind, kind.ids.awaitingReview);
      const writes = await answerWrites(
        page,
        `/admin/native-recovery/${kind.ids.awaitingReview}/apply`,
        { json: { status: "queued" } },
      );
      await openManage(page, `${NATIVE}/${kind.ids.awaitingReview}`);
      const button = page.getByRole("button", { name: kind.button });
      await expect(button).toBeDisabled();
      await approve(page, kind);
      const dialog = page.getByRole("dialog", { name: kind.dialog });
      await expect(dialog).toContainText("cannot undo it");
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect(writes).toEqual([]);
      await button.click();
      await dialog.getByRole("button", { name: kind.confirm }).click();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]).toMatchObject({
        method: "POST",
        path: `/api/v1/admin/native-recovery/${kind.ids.awaitingReview}/apply`,
        body: {
          expectedVersion: review.version,
          planHash: review.planHash,
          recoveryEpoch: 1,
          runtimeVersion: 12,
          ...kind.acknowledgements,
        },
      });
      expect(await violations(page)).toEqual([]);
    });

    test("says nothing was changed when the approval is refused", async ({
      page,
    }) => {
      await answerWrites(
        page,
        `/admin/native-recovery/${kind.ids.awaitingReview}/apply`,
        {
          status: 403,
          json: {
            error: {
              code: "runtime_protected",
              message: "Media is not ready to apply this review",
            },
          },
        },
      );
      await openManage(page, `${NATIVE}/${kind.ids.awaitingReview}`);
      await approve(page, kind);
      await page
        .getByRole("dialog", { name: kind.dialog })
        .getByRole("button", { name: kind.confirm })
        .click();
      const alert = page.getByRole("alert");
      await expect(alert).toContainText("The approval was not submitted");
      await expect(alert).toContainText("Media is not ready to apply");
      await expect(alert).toContainText("nothing was changed");
    });

    test("says the review changed when the version is stale", async ({
      page,
    }) => {
      await answerWrites(
        page,
        `/admin/native-recovery/${kind.ids.awaitingReview}/apply`,
        {
          status: 409,
          json: {
            error: {
              code: "stale_version",
              message: "The review changed after you opened it",
            },
          },
        },
      );
      await openManage(page, `${NATIVE}/${kind.ids.awaitingReview}`);
      await approve(page, kind);
      await page
        .getByRole("dialog", { name: kind.dialog })
        .getByRole("button", { name: kind.confirm })
        .click();
      await expect(page.getByRole("alert")).toContainText(
        "The review changed after you opened it",
      );
    });

    test("keeps its proofs behind technical details", async ({ page }) => {
      const review = reviewOf(kind, kind.ids.awaitingReview);
      await openManage(page, `${NATIVE}/${kind.ids.awaitingReview}`);
      const digest = page.getByText(review.planHash ?? "");
      await expect(digest).toBeHidden();
      await page.getByText("Technical details").click();
      await expect(digest).toBeVisible();
    });

    test("waits while it is prepared, with nothing to approve", async ({
      page,
    }) => {
      await openManage(page, `${NATIVE}/${kind.ids.preparing}`);
      await expect(
        page.getByRole("heading", { name: "Being prepared" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: kind.button })).toHaveCount(
        0,
      );
      expect(await horizontalOverflow(page)).toBe(0);
    });

    test("shows where it ended up once applied", async ({ page }) => {
      await openManage(page, `${NATIVE}/${kind.ids.applied}`);
      await expect(
        page.getByRole("heading", { name: "Applied" }),
      ).toBeVisible();
      await expect(page.getByText(kind.applied).first()).toBeVisible();
      await expect(page.getByRole("button", { name: kind.button })).toHaveCount(
        0,
      );
      expect(await horizontalOverflow(page)).toBe(0);
      expect(await violations(page)).toEqual([]);
    });
  });
}

test.describe("restoring an interrupted upgrade", () => {
  test("says restoration is waiting, not in progress, while playback is held", async ({
    page,
  }) => {
    await openManage(page, `${NATIVE}/${COMPENSATION_REVIEW_IDS.applying}`);
    const status = page.getByRole("region", {
      name: "Restoration and playback",
    });
    await expect(status.getByText("Waiting", { exact: true })).toBeVisible();
    await expect(status.getByText("In progress")).toHaveCount(0);
  });

  test("says stopped work needs a review, not that it is in progress", async ({
    page,
  }) => {
    await openManage(page, `${NATIVE}/${COMPENSATION_REVIEW_IDS.stopped}`);
    const status = page.getByRole("region", {
      name: "Restoration and playback",
    });
    await expect(
      status.getByText("Stopped: needs your review", { exact: true }),
    ).toBeVisible();
    await expect(status.getByText("In progress")).toHaveCount(0);
    await expect(status.getByText("Waiting", { exact: true })).toHaveCount(0);
    expect(await violations(page)).toEqual([]);
  });

  test("confirms one upgrade of two files, not two upgrades", async ({
    page,
  }) => {
    await openManage(
      page,
      `${NATIVE}/${COMPENSATION_REVIEW_IDS.awaitingReview}`,
    );
    await page
      .getByRole("checkbox", {
        name: /I reviewed the predecessor restoration/u,
      })
      .check();
    await page
      .getByRole("button", {
        name: "Approve this exact predecessor restoration",
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Approve this predecessor restoration?",
    });
    await expect(dialog).toContainText("The earlier files of this upgrade");
    await expect(dialog).toContainText("(2 files)");
    await expect(dialog).not.toContainText("2 upgrades");
  });

  test("retries the current restoration, and says what the state is if it is refused", async ({
    page,
  }) => {
    const retrying = compensationReviewDetail(COMPENSATION_REVIEW_IDS.applied);
    if (retrying === null) throw new Error("No compensation fixture");
    // The approved review is being worked on: its restoration can be retried.
    const waiting = `${NATIVE}/${COMPENSATION_REVIEW_IDS.applying}`;
    const writes = await answerWrites(
      page,
      "/admin/native-recovery/compensations/*/retry",
      { json: { status: "queued" } },
    );
    await openManage(page, waiting);
    await page
      .getByRole("button", { name: "Check and retry current restoration" })
      .click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      body: { expectedVersion: 2 },
    });
    expect(await violations(page)).toEqual([]);
  });

  test("says it cannot tell whether the retry was recorded when the response is lost", async ({
    page,
  }) => {
    const writes = await dropWrites(
      page,
      "/admin/native-recovery/compensations/*/retry",
    );
    await openManage(page, `${NATIVE}/${COMPENSATION_REVIEW_IDS.applying}`);
    await page
      .getByRole("button", { name: "Check and retry current restoration" })
      .click();
    await expect.poll(() => writes.length).toBe(1);
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      "cannot tell whether the retry was recorded",
    );
    await expect(alert).not.toContainText("nothing was changed");
  });

  test("says the retry was not submitted when it is refused", async ({
    page,
  }) => {
    await answerWrites(page, "/admin/native-recovery/compensations/*/retry", {
      status: 409,
      json: {
        error: { code: "stale_version", message: "Work is still running" },
      },
    });
    await openManage(page, `${NATIVE}/${COMPENSATION_REVIEW_IDS.applying}`);
    await page
      .getByRole("button", { name: "Check and retry current restoration" })
      .click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("The retry was not submitted");
    await expect(alert).toContainText("Work is still running");
  });
});
