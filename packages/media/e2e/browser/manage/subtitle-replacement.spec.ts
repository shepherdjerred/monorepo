import { expect, type Page } from "@playwright/test";
import {
  REPLACEMENT_IDS,
  subtitleReplacementDetail,
} from "#testing/fixture-api/fixtures/movies/subtitle-replacements.ts";
import { subtitleTargets } from "#testing/fixture-api/fixtures/owner.ts";
import { horizontalOverflow, test } from "#e2e/browser/support.ts";
import { answerWrites, openManage, violations } from "./support.ts";

const REVIEW = "/manage/subtitles/replacements";

function detail(id: string) {
  const found = subtitleReplacementDetail(id);
  if (found === null) throw new Error(`No replacement fixture ${id}`);
  return found;
}

async function approve(page: Page) {
  await page
    .getByRole("checkbox", { name: /I reviewed every affected title/u })
    .check();
  await page.getByRole("button", { name: "Approve this replacement" }).click();
}

test.describe("the subtitle replacement list", () => {
  test("prepares nothing until a pair is chosen, then prepares exactly that pair", async ({
    page,
  }) => {
    const [first] = subtitleTargets("");
    const installed = first?.subtitles.find(
      (item) => item.state === "installed",
    );
    const candidate = first?.subtitles.find(
      (item) => item.state === "validated",
    );
    if (installed === undefined || candidate === undefined)
      throw new Error("The first video has no pair to choose");
    const writes = await answerWrites(page, "/admin/subtitle-replacements", {
      json: { subtitleReplacementId: REPLACEMENT_IDS.awaitingReview },
    });
    await openManage(page, REVIEW);
    await page
      .getByRole("button", { name: "Prepare replacement review" })
      .click();
    await expect(
      page.getByText("Choose the subtitle that is installed now.").first(),
    ).toBeVisible();
    expect(writes).toEqual([]);
    await page.getByLabel("Installed sidecar").selectOption(installed.id);
    await page.getByLabel("Validated replacement").selectOption(candidate.id);
    await page
      .getByRole("button", { name: "Prepare replacement review" })
      .click();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Replace an installed subtitle",
      }),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/admin/subtitle-replacements",
      body: {
        oldSubtitleId: installed.id,
        candidateSubtitleId: candidate.id,
        expectedOldVersion: installed.version,
        expectedCandidateVersion: candidate.version,
      },
    });
  });

  test("lists every review with where it stands and fits the screen", async ({
    page,
  }) => {
    await openManage(page, REVIEW);
    const reviews = page.getByRole("list", { name: "Replacement reviews" });
    await expect(reviews.getByRole("listitem")).toHaveCount(9);
    for (const label of [
      "Needs your approval",
      "Being prepared",
      "Being replaced",
      "Being reconciled",
      "Replaced",
      "Rolled back",
      "Protected",
      "Ended without a replacement",
    ]) {
      await expect(
        reviews.getByText(label, { exact: true }).first(),
      ).toBeVisible();
    }
    expect(await horizontalOverflow(page)).toBe(0);
    expect(await violations(page)).toEqual([]);
  });
});

test.describe("one replacement", () => {
  test("is approved only after the acknowledgement and the confirmation", async ({
    page,
  }) => {
    const review = detail(REPLACEMENT_IDS.awaitingReview);
    const writes = await answerWrites(
      page,
      `/admin/subtitle-replacements/${review.id}/apply`,
      { json: { status: "queued" } },
    );
    await openManage(page, `${REVIEW}/${review.id}`);
    await expect(page.getByText("Needs your approval").first()).toBeVisible();
    const button = page.getByRole("button", {
      name: "Approve this replacement",
    });
    await expect(button).toBeDisabled();
    await approve(page);
    const dialog = page.getByRole("dialog", {
      name: `Replace ${review.destinationName}?`,
    });
    await expect(dialog).toContainText("does not offer undo");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(writes).toEqual([]);
    await button.click();
    await dialog.getByRole("button", { name: "Replace subtitle" }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/admin/subtitle-replacements/${review.id}/apply`,
      body: {
        expectedVersion: review.version,
        observationHash: review.observationHash,
        acknowledgeReplacement: true,
      },
    });
  });

  test("says the title changed and that nothing was applied when the server finds a conflict", async ({
    page,
  }) => {
    await answerWrites(
      page,
      `/admin/subtitle-replacements/${REPLACEMENT_IDS.awaitingReview}/apply`,
      {
        status: 409,
        json: {
          error: { code: "stale_version", message: "The video changed" },
        },
      },
    );
    await openManage(page, `${REVIEW}/${REPLACEMENT_IDS.awaitingReview}`);
    await approve(page);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Replace subtitle" })
      .click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("The action was not applied");
    await expect(alert).toContainText("The video changed");
    await expect(alert).toContainText("Nothing was changed");
    await alert.getByRole("button", { name: "Review latest details" }).click();
    await expect(alert).toHaveCount(0);
  });

  test("offers the original action again, unchanged, when no answer came", async ({
    page,
  }) => {
    const bodies: unknown[] = [];
    const keys: (string | undefined)[] = [];
    await page.route(
      `**/api/v1/admin/subtitle-replacements/${REPLACEMENT_IDS.awaitingReview}/apply`,
      async (route) => {
        const request = route.request();
        if (request.method() === "GET") {
          await route.fallback();
          return;
        }
        bodies.push(request.postDataJSON());
        keys.push(request.headers()["idempotency-key"]);
        await (bodies.length === 1
          ? route.fulfill({
              status: 500,
              json: { error: { code: "internal_error", message: "Try later" } },
            })
          : route.fulfill({ json: { status: "queued" } }));
      },
    );
    await openManage(page, `${REVIEW}/${REPLACEMENT_IDS.awaitingReview}`);
    await approve(page);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Replace subtitle" })
      .click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      "cannot tell whether the action was applied",
    );
    await alert
      .getByRole("button", { name: "Retry the original action" })
      .click();
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]).toEqual(bodies[0]);
    expect(keys[1]).toBe(keys[0]);
  });

  test("keeps the hashes behind technical details", async ({ page }) => {
    const review = detail(REPLACEMENT_IDS.awaitingReview);
    await openManage(page, `${REVIEW}/${review.id}`);
    const hash = page.getByText(review.observationHash ?? "");
    await expect(hash).toBeHidden();
    await page.getByText("Technical details").click();
    await expect(hash).toBeVisible();
  });

  test("cannot be approved once its review has expired", async ({ page }) => {
    await openManage(page, `${REVIEW}/${REPLACEMENT_IDS.expired}`);
    await expect(page.getByText("This review has expired.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Approve this replacement" }),
    ).toHaveCount(0);
  });

  const STATES = [
    ["preparing", REPLACEMENT_IDS.preparing, "No file has been replaced."],
    ["applying", REPLACEMENT_IDS.applying, "Your approval is queued."],
    ["applied", REPLACEMENT_IDS.applied, "This page does not offer undo."],
    [
      "rolled back",
      REPLACEMENT_IDS.rolledBack,
      "The previous subtitle was restored.",
    ],
    ["abandoned", REPLACEMENT_IDS.abandoned, "Prepare a new review"],
  ] as const;
  for (const [name, id, text] of STATES) {
    test(`shows a replacement that is ${name} with nothing to approve`, async ({
      page,
    }) => {
      await openManage(page, `${REVIEW}/${id}`);
      await expect(page.getByText(text).first()).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Approve this replacement" }),
      ).toHaveCount(0);
      expect(await horizontalOverflow(page)).toBe(0);
    });
  }

  test("explains a protected replacement and reconciles it on request", async ({
    page,
  }) => {
    const review = detail(REPLACEMENT_IDS.protectedState);
    const writes = await answerWrites(
      page,
      `/admin/subtitle-replacements/${review.id}/reconcile`,
      { json: { status: "queued" } },
    );
    await openManage(page, `${REVIEW}/${review.id}`);
    await expect(
      page.getByText("Subtitle replacement artifact ownership unconfirmed"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reconcile operation" }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/admin/subtitle-replacements/${review.id}/reconcile`,
      body: { expectedVersion: review.version },
    });
    expect(await violations(page)).toEqual([]);
  });
});
