import { expect } from "@playwright/test";
import {
  NATIVE_REVIEW_IDS,
  nativeArchiveInventory,
  nativeCompensationInventory,
  nativeRecoveryDetail,
  nativeRecoveryInventory,
} from "#testing/fixture-api/fixtures/migration/native-recovery.ts";
import { sha256 } from "#testing/fixture-api/support.ts";
import { horizontalOverflow, test } from "#e2e/browser/support.ts";
import { answerWrites, openManage, violations } from "./support.ts";

const NATIVE = "/manage/recovery/native";

function detail(id: string) {
  const found = nativeRecoveryDetail(id);
  if (found === null) throw new Error(`No native review fixture ${id}`);
  return found;
}

test.describe("reproving restored library files", () => {
  test("lists the files, the reviews, and what is outstanding, and fits the screen", async ({
    page,
  }) => {
    const inventory = nativeRecoveryInventory();
    await openManage(page, NATIVE);
    await expect(
      page.getByText("Recorded prerequisites are present."),
    ).toBeVisible();
    const files = page;
    await expect(files.getByRole("checkbox", { name: /Dune/u })).toBeEnabled();
    await expect(
      files.getByRole("checkbox", { name: /Blade Runner 2049/u }),
    ).toBeDisabled();
    await expect(page.getByText("Plex exclusion missing")).toBeVisible();
    // A quarantined file belongs to the other kind of review.
    await expect(files.getByRole("checkbox", { name: /Heat/u })).toHaveCount(0);
    await expect(
      page
        .getByRole("list", { name: "Prepared reviews" })
        .getByRole("listitem"),
    ).toHaveCount(inventory.plans.length);
    expect(await horizontalOverflow(page)).toBe(0);
    expect(await violations(page)).toEqual([]);
  });

  test("prepares exactly the chosen files and opens the review", async ({
    page,
  }) => {
    const inventory = nativeRecoveryInventory();
    const dune = inventory.assets[0];
    if (dune === undefined) throw new Error("No first asset");
    const writes = await answerWrites(page, "/admin/native-recovery", {
      json: { nativeRecoveryId: NATIVE_REVIEW_IDS.awaitingReview },
    });
    await openManage(page, NATIVE);
    const prepare = page.getByRole("button", {
      name: "Prepare exact file review",
    });
    await expect(prepare).toBeDisabled();
    await page.getByRole("checkbox", { name: /Dune/u }).check();
    await prepare.click();
    await expect(page).toHaveURL(
      new RegExp(`${NATIVE}/${NATIVE_REVIEW_IDS.awaitingReview}$`, "u"),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/admin/native-recovery",
      body: {
        restoreOperationId: inventory.restoreOperationId,
        recoveryEpoch: 1,
        runtimeVersion: 12,
        activation: "extend",
        assetIds: [dune.id],
      },
    });
    await expect(page.getByText("Needs your approval").first()).toBeVisible();
  });

  test("prepares quarantined files through their own request", async ({
    page,
  }) => {
    const heat = nativeRecoveryInventory().assets[2];
    if (heat === undefined) throw new Error("No quarantined asset");
    const writes = await answerWrites(
      page,
      "/admin/native-recovery/quarantine",
      { json: { nativeRecoveryId: NATIVE_REVIEW_IDS.awaitingReview } },
    );
    await openManage(page, NATIVE);
    await page.getByRole("radio", { name: "Committed quarantine" }).check();
    await expect(page.getByText("does not authorize deletion")).toBeVisible();
    await page.getByRole("checkbox", { name: /Heat/u }).check();
    await page
      .getByRole("button", { name: "Prepare exact file review" })
      .click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({
      path: "/api/v1/admin/native-recovery/quarantine",
      body: { lifecycleKind: "committed_quarantine", assetIds: [heat.id] },
    });
  });

  test("will not prepare while a prerequisite is outstanding", async ({
    page,
  }) => {
    const blocked = nativeRecoveryInventory({
      prerequisites: ["legacy_writers_running"],
    });
    await page.route("**/api/v1/admin/native-recovery", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({ json: blocked });
        return;
      }
      await route.fallback();
    });
    await openManage(page, NATIVE);
    await expect(page.getByText("Legacy writers running")).toBeVisible();
    await page.getByRole("checkbox", { name: /Dune/u }).check();
    await expect(
      page.getByRole("button", { name: "Prepare exact file review" }),
    ).toBeDisabled();
  });
});

test.describe("a prepared file review", () => {
  test("is applied only after the acknowledgement and the confirmation", async ({
    page,
  }) => {
    const review = detail(NATIVE_REVIEW_IDS.awaitingReview);
    const writes = await answerWrites(
      page,
      `/admin/native-recovery/${review.id}/apply`,
      { json: { status: "queued" } },
    );
    await openManage(page, `${NATIVE}/${review.id}`);
    await expect(page.getByText("Affected titles")).toBeVisible();
    await expect(
      page.getByText("Subtitle policies being renewed"),
    ).toBeVisible();
    const button = page.getByRole("button", {
      name: "Apply this exact physical review",
    });
    await expect(button).toBeDisabled();
    await page
      .getByRole("checkbox", {
        name: /I reviewed these titles, subtitle policies/u,
      })
      .check();
    await button.click();
    const dialog = page.getByRole("dialog", { name: "Renew file ownership?" });
    await expect(dialog).toContainText("2 files");
    await expect(dialog).toContainText("cannot undo it");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(writes).toEqual([]);
    await button.click();
    await dialog.getByRole("button", { name: "Renew ownership" }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/admin/native-recovery/${review.id}/apply`,
      body: {
        expectedVersion: review.version,
        planHash: sha256("native-plan:awaiting_review"),
        recoveryEpoch: 1,
        runtimeVersion: 12,
        acknowledgePhysicalOwnershipOnly: true,
        acknowledgeRecoveryHolds: true,
        acknowledgeSubtitlePolicies: true,
      },
    });
    expect(await violations(page)).toEqual([]);
  });

  test("says nothing was changed when the approval is refused", async ({
    page,
  }) => {
    await answerWrites(
      page,
      `/admin/native-recovery/${NATIVE_REVIEW_IDS.awaitingReview}/apply`,
      {
        status: 409,
        json: {
          error: { code: "stale_version", message: "The proof changed" },
        },
      },
    );
    await openManage(page, `${NATIVE}/${NATIVE_REVIEW_IDS.awaitingReview}`);
    await page
      .getByRole("checkbox", {
        name: /I reviewed these titles, subtitle policies/u,
      })
      .check();
    await page
      .getByRole("button", { name: "Apply this exact physical review" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Renew ownership" })
      .click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("The approval was not submitted");
    await expect(alert).toContainText("The proof changed");
    await expect(alert).toContainText("nothing was changed");
  });

  test("keeps paths and checksums behind technical details", async ({
    page,
  }) => {
    const review = detail(NATIVE_REVIEW_IDS.awaitingReview);
    const [file] = review.scope.files;
    await openManage(page, `${NATIVE}/${review.id}`);
    const checksum = page.getByText(file?.checksum ?? "");
    await expect(checksum).toBeHidden();
    await page.getByText("Technical details").click();
    await expect(checksum).toBeVisible();
  });

  const STATES = [
    ["preparing", NATIVE_REVIEW_IDS.preparing, "Being prepared"],
    ["applying", NATIVE_REVIEW_IDS.applying, "Approval queued"],
    ["applied", NATIVE_REVIEW_IDS.applied, "Applied"],
  ] as const;
  for (const [name, id, label] of STATES) {
    test(`shows a review that is ${name} with nothing to approve`, async ({
      page,
    }) => {
      await openManage(page, `${NATIVE}/${id}`);
      await expect(page.getByRole("heading", { name: label })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Apply this exact physical review" }),
      ).toHaveCount(0);
      expect(await horizontalOverflow(page)).toBe(0);
    });
  }

  test("sends the old address to the same review", async ({ page }) => {
    await openManage(page, `/recovery/native/${NATIVE_REVIEW_IDS.applied}`);
    await expect(page).toHaveURL(
      new RegExp(`${NATIVE}/${NATIVE_REVIEW_IDS.applied}$`, "u"),
    );
  });
});

test.describe("upgrade archives and interrupted upgrades", () => {
  test("prepares the chosen cleanups only", async ({ page }) => {
    const inventory = nativeArchiveInventory();
    const [alien] = inventory.cleanups;
    if (alien === undefined) throw new Error("No cleanup fixture");
    const writes = await answerWrites(page, "/admin/native-recovery/archives", {
      json: { nativeRecoveryId: NATIVE_REVIEW_IDS.awaitingReview },
    });
    await openManage(page, `${NATIVE}/archives`);
    await expect(
      page.getByRole("checkbox", { name: /Moonlight/u }),
    ).toBeDisabled();
    await expect(
      page.getByText("A current Keep choice or pin protects"),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: /Alien/u }).check();
    await page
      .getByRole("button", { name: "Prepare exact archive review" })
      .click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({
      path: "/api/v1/admin/native-recovery/archives",
      body: {
        restoreOperationId: inventory.restoreOperationId,
        recoveryEpoch: 1,
        runtimeVersion: 12,
        activation: "extend",
        cleanupIds: [alien.id],
      },
    });
    expect(await violations(page)).toEqual([]);
  });

  test("prepares one complete interrupted upgrade, and not a protected one", async ({
    page,
  }) => {
    const inventory = nativeCompensationInventory();
    const [first] = inventory.items;
    if (first === undefined) throw new Error("No upgrade fixture");
    const writes = await answerWrites(
      page,
      "/admin/native-recovery/compensations",
      { json: { nativeRecoveryId: NATIVE_REVIEW_IDS.awaitingReview } },
    );
    await openManage(page, `${NATIVE}/compensations`);
    await expect(page.getByRole("radio", { name: /Arrival/u })).toBeDisabled();
    await page.getByRole("radio", { name: /Interstellar/u }).check();
    await page
      .getByRole("button", { name: "Prepare predecessor restoration review" })
      .click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({
      path: "/api/v1/admin/native-recovery/compensations",
      body: {
        lifecycleKind: "publication_compensation",
        transitionId: first.transitionId,
        recoveryEpoch: 1,
        runtimeVersion: 12,
        activation: "extend",
      },
    });
    expect(await horizontalOverflow(page)).toBe(0);
    expect(await violations(page)).toEqual([]);
  });
});
