import { expect, type Page } from "@playwright/test";
import { REPLACEMENT_IDS } from "#testing/fixture-api/fixtures/subtitle-replacements.ts";
import { FEATURED } from "#testing/fixture-api/fixtures/titles.ts";
import { horizontalOverflow, test } from "#e2e/browser/support.ts";
import { answerWrites, openManage, violations } from "./support.ts";

const movie = FEATURED.movie;

async function openReplacement(page: Page) {
  await openManage(page, `/media/${movie.id}?view=manage`);
  await page.getByLabel("Movie edition").selectOption({ index: 1 });
  await page.getByText(/^Replace captions for/u).click();
  await page.getByLabel("Installed sidecar").selectOption({ index: 1 });
  await expect(
    page.getByRole("heading", { name: /^Upload a replacement for/u }),
  ).toBeVisible();
}

test.describe("replacing the captions of a movie edition", () => {
  test("uploads a candidate for the chosen caption only once its match is confirmed", async ({
    page,
  }) => {
    const writes = await answerWrites(
      page,
      `/media/${movie.id}/movie-editions/*/subtitle-replacements/candidates`,
      { json: { status: "completed", subtitleId: REPLACEMENT_IDS.applied } },
      2,
    );
    await openReplacement(page);
    await page
      .getByRole("button", { name: "Upload replacement candidate" })
      .click();
    await expect(
      page.getByText("Choose the subtitle file.").first(),
    ).toBeVisible();
    expect(writes).toEqual([]);
    await page.getByLabel("Subtitle file").setInputFiles({
      name: "replacement.srt",
      mimeType: "application/x-subrip",
      buffer: Buffer.from("1\n00:00:01,000 --> 00:00:02,000\nHello\n"),
    });
    await page
      .getByLabel("Source and quality notes")
      .fill("Timed for the 2160p remux");
    await page.getByRole("checkbox", { name: /I checked this file/u }).check();
    await page
      .getByRole("button", { name: "Upload replacement candidate" })
      .click();
    await expect(
      page.getByText("Candidate uploaded. Choose it below"),
    ).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      body: {
        schemaVersion: 2,
        filename: "replacement.srt",
        description: "Timed for the 2160p remux",
        confirmedMatchingVideo: true,
        language: "en",
        hearingImpaired: true,
        replacementFor: { expectedOldVersion: 1 },
      },
    });
    expect(writes[0]?.path).toMatch(
      new RegExp(
        `/api/v2/media/${movie.id}/movie-editions/[a-z_]+/subtitle-replacements/candidates$`,
        "u",
      ),
    );
  });

  test("prepares a review from a validated candidate and links to it", async ({
    page,
  }) => {
    const writes = await answerWrites(
      page,
      `/media/${movie.id}/movie-editions/*/subtitle-replacements`,
      {
        json: {
          status: "completed",
          subtitleReplacementId: REPLACEMENT_IDS.awaitingReview,
        },
      },
      2,
    );
    await openReplacement(page);
    const prepare = page.getByRole("button", {
      name: "Prepare replacement review",
    });
    await prepare.click();
    await expect(
      page
        .getByText("Choose the validated caption that replaces this one.")
        .first(),
    ).toBeVisible();
    expect(writes).toEqual([]);
    await page.getByLabel("Validated candidate").selectOption({ index: 1 });
    await prepare.click();
    await expect(page.getByText("Review prepared")).toBeVisible();
    await expect(
      page.getByRole("link", {
        name: "Inspect and approve the exact replacement",
      }),
    ).toHaveAttribute(
      "href",
      `/manage/subtitles/replacements/${REPLACEMENT_IDS.awaitingReview}`,
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      body: {
        schemaVersion: 2,
        oldSubtitleId: expect.any(String),
        candidateSubtitleId: expect.any(String),
      },
    });
  });

  test("says the title changed when the server finds a conflict", async ({
    page,
  }) => {
    await answerWrites(
      page,
      `/media/${movie.id}/movie-editions/*/subtitle-replacements`,
      {
        status: 409,
        json: {
          error: { code: "stale_version", message: "The video changed" },
        },
      },
      2,
    );
    await openReplacement(page);
    await page.getByLabel("Validated candidate").selectOption({ index: 1 });
    await page
      .getByRole("button", { name: "Prepare replacement review" })
      .click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("The preparation was not applied");
    await expect(alert).toContainText("Nothing was changed");
    expect(await horizontalOverflow(page)).toBe(0);
    expect(await violations(page)).toEqual([]);
  });
});
