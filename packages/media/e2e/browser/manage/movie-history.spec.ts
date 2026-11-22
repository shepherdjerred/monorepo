import { expect, type Page } from "@playwright/test";
import { MEMBER } from "#testing/fixture-api/personas.ts";
import { fixtureId, sha256 } from "#testing/fixture-api/support.ts";
import { definitionDigest } from "#testing/fixture-api/fixtures/movie-requests.ts";
import { titleNamed } from "#testing/fixture-api/fixtures/titles.ts";
import {
  allowWrites,
  horizontalOverflow,
  openSettled,
  test,
} from "#e2e/browser/support.ts";
import { answerWrites, openManage, violations } from "./support.ts";

const review = (n: number) => fixtureId(19, n);
const page3 = (n: number) => `/recovery/movies/${review(n)}`;
const REVIEWS = `/movie-history/reviews`;

/** Opens a review as the member, ready to send commands. */
async function openAsMember(page: Page, n: number) {
  await openSettled(page, "member", page3(n));
  await allowWrites(page);
}

/** Ticks the three statements and confirms the release in its dialog. */
async function tickAll(page: Page) {
  for (const label of [
    /Everyone applicable is listed/u,
    /Preserve existing Keep, pins/u,
    /I accept that files cannot prove/u,
  ]) {
    await page.getByLabel(label).check();
  }
  await page
    .getByRole("button", { name: "Release this edition’s history hold" })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Release this edition’s history hold" })
    .click();
}

test.describe("a member answers an edition review", () => {
  test("every declaration says what it records, and the one that is not open says why", async ({
    page,
  }) => {
    await openAsMember(page, 1);
    const intent = page.getByRole("group", {
      name: "Your present intent for this edition",
    });
    await expect(intent.getByLabel(/^I request this edition/u)).toBeEnabled();
    await expect(intent.getByLabel(/^Keep this edition/u)).toBeEnabled();
    const no = intent.getByLabel(/^I no longer request/u);
    await expect(no).toBeDisabled();
    await expect(
      page.getByText(
        "Not available: An active request is still captured; cancel it first.",
      ),
    ).toBeVisible();
    await expect(
      page.getByText("requested captions: zh-Hans, en"),
    ).toBeVisible();
    expect(await violations(page)).toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test("a Keep declaration needs its hold, then sends the exact declaration", async ({
    page,
  }) => {
    const writes = await answerWrites(
      page,
      `${REVIEWS}/${review(1)}/responses`,
      {
        json: { recoveryReviewId: review(1), status: "completed", version: 3 },
      },
      3,
    );
    await openAsMember(page, 1);
    const submit = page.getByRole("button", { name: "Record my declaration" });
    await submit.click();
    await expect(page.getByRole("alert")).toContainText(
      "Choose what is declared for this edition.",
    );
    expect(writes).toEqual([]);

    await page.getByLabel(/^Keep this edition/u).check();
    await expect(
      page.getByText(
        "You are recording: Keep this edition using my captured choice and hold.",
      ),
    ).toBeVisible();
    await page.getByLabel(/I declare the visible edition/u).check();
    await submit.click();
    await expect(page.getByRole("alert")).toContainText(
      "Choose which captured Keep or pin this declaration uses.",
    );
    expect(writes).toEqual([]);

    // The first hold after the prompt is the member's Keep.
    await page.getByLabel("Captured Keep or pin").selectOption({ index: 1 });
    await submit.click();
    await expect(page.getByText("Recorded", { exact: true })).toBeVisible();
    expect(writes).toHaveLength(1);
    const title = titleNamed("Blade Runner");
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: `/api/v3/movie-history/reviews/${review(1)}/responses`,
      body: {
        schemaVersion: 3,
        scope: {
          rootMediaId: title.id,
          mediaId: title.id,
          edition: "final_cut",
        },
        scopeHash: sha256("history-scope-1"),
        subjectUserId: MEMBER.id,
        definition: {
          definitionVersion: 0,
          definitionDigest: definitionDigest(title, "final_cut"),
        },
        registryVersion: 1,
        declaration: {
          intent: "keep",
          currentChoice: {
            requestId: fixtureId(23, 11),
            requestVersion: 7,
            choiceId: fixtureId(24, 11),
            choiceRevision: 1,
            subtitleLanguages: ["zh-Hans", "en"],
          },
          currentKeep: {
            id: fixtureId(25, 11),
            userId: MEMBER.id,
            isPin: false,
          },
        },
        acknowledgeMissingHistory: true,
      },
    });
    expect(writes[0]?.body).toHaveProperty("claimAcknowledgements.length", 1);
  });

  test("with no captured choice a member can only say they no longer request it", async ({
    page,
  }) => {
    const writes = await answerWrites(
      page,
      `${REVIEWS}/${review(3)}/responses`,
      {
        json: { recoveryReviewId: review(3), status: "completed", version: 4 },
      },
      3,
    );
    await openAsMember(page, 3);
    await expect(
      page.getByText(
        "No explicit current choice for this edition was captured.",
      ),
    ).toBeVisible();
    await expect(page.getByLabel(/^I request this edition/u)).toBeDisabled();
    await expect(page.getByLabel(/^Keep this edition/u)).toBeDisabled();
    await page.getByLabel(/^I no longer request/u).check();
    await page.getByLabel(/I declare the visible edition/u).check();
    await page.getByRole("button", { name: "Record my declaration" }).click();
    await expect.poll(() => writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      body: {
        subjectUserId: MEMBER.id,
        declaration: { intent: "no_longer_request" },
      },
    });
  });

  test("a declaration already recorded is shown as done, with no form", async ({
    page,
  }) => {
    await openSettled(page, "member", page3(2));
    await expect(
      page.getByText("Your declaration is recorded").first(),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Recorded: Keep this edition using my captured choice and hold",
      ),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Record/u })).toHaveCount(0);
    expect(await violations(page)).toEqual([]);
  });

  test("a member is never shown the household's declarations or the release", async ({
    page,
  }) => {
    await openSettled(page, "member", page3(1));
    await expect(page.getByText("Household declarations")).toHaveCount(0);
    await expect(page.getByText("Technical details")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Release/u })).toHaveCount(0);
  });
});

test.describe("the owner's side of an edition review", () => {
  test("lists who has declared and who the review waits for", async ({
    page,
  }) => {
    await openSettled(page, "owner", page3(1));
    await expect(page.getByText("Waiting for Mei, Kids")).toBeVisible();
    const list = page.getByRole("list", { name: "Household declarations" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await expect(list.getByText("Declaration needed")).toHaveCount(2);
    await expect(page.getByText("Not ready to release")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Release this edition’s history hold" }),
    ).toHaveCount(0);
    expect(await violations(page)).toEqual([]);
  });

  test("declares for the managed profile only, with the actor and subject on the record", async ({
    page,
  }) => {
    const writes = await answerWrites(
      page,
      `${REVIEWS}/${review(1)}/responses`,
      {
        json: { recoveryReviewId: review(1), status: "completed", version: 3 },
      },
      3,
    );
    await openManage(page, page3(1));
    const form = page.getByRole("form", { name: "Owner declaration for Kids" });
    // The managed profile has no Keep to keep with.
    await expect(form.getByLabel(/^Keep this edition/u)).toBeDisabled();
    await form.getByLabel(/^I request this edition/u).check();
    await form.getByLabel(/I declare the visible edition/u).check();
    await form
      .getByRole("button", { name: "Record Kids’s declaration" })
      .click();
    await expect.poll(() => writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      body: {
        subjectUserId: fixtureId(1, 5),
        declaration: { intent: "request" },
      },
    });
  });

  test("a blocked review says what blocks it", async ({ page }) => {
    await openSettled(page, "owner", page3(3));
    await expect(
      page.getByText("The film is still being downloaded or imported."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Release this edition’s history hold" }),
    ).toHaveCount(0);
  });

  test("releasing asks three questions, names the film in a dialog, then sends the exact release", async ({
    page,
  }) => {
    const writes = await answerWrites(
      page,
      `${REVIEWS}/${review(2)}/release`,
      {
        json: { recoveryReviewId: review(2), status: "completed", version: 4 },
      },
      3,
    );
    await openManage(page, page3(2));
    await expect(
      page.getByText("Everyone has declared. It is ready for you to release."),
    ).toBeVisible();
    const release = page.getByRole("button", {
      name: "Release this edition’s history hold",
    });
    await release.click();
    await expect(page.getByRole("alert")).toContainText(
      "Confirm that everyone applicable has declared.",
    );
    expect(writes).toEqual([]);

    for (const label of [
      /Everyone applicable is listed/u,
      /Preserve existing Keep, pins/u,
      /I accept that files cannot prove/u,
    ]) {
      await page.getByLabel(label).check();
    }
    await release.click();
    const dialog = page.getByRole("dialog", {
      name: "Release this edition’s history hold?",
    });
    await expect(dialog).toContainText("Alien");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    expect(await violations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    expect(writes).toEqual([]);

    await release.click();
    await dialog
      .getByRole("button", { name: "Release this edition’s history hold" })
      .click();
    await expect(page.getByText("Recorded", { exact: true })).toBeVisible();
    const title = titleNamed("Alien");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: `/api/v3/movie-history/reviews/${review(2)}/release`,
      body: {
        schemaVersion: 3,
        scope: {
          rootMediaId: title.id,
          mediaId: title.id,
          edition: "directors_cut",
        },
        expectedVersion: 3,
        scopeHash: sha256("history-scope-2"),
        responseHash: sha256("history-responses-2"),
        confirmHouseholdBaseline: true,
        confirmExistingPins: true,
        acknowledgeMissingHistory: true,
      },
    });
  });

  test("a release the review no longer matches says nothing was recorded and sends nothing more", async ({
    page,
  }) => {
    const writes = await answerWrites(
      page,
      `${REVIEWS}/${review(2)}/release`,
      {
        status: 409,
        json: { error: { code: "version_conflict", message: "Changed" } },
      },
      3,
    );
    await openManage(page, page3(2));
    await tickAll(page);
    await expect(
      page.getByText("Nothing was recorded: this review is out of date"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Release this edition’s history hold" }),
    ).toBeDisabled();
    expect(writes).toHaveLength(1);
  });

  test("a release that may or may not have been recorded can be retried as the same command", async ({
    page,
  }) => {
    const writes = await answerWrites(
      page,
      `${REVIEWS}/${review(2)}/release`,
      {
        status: 500,
        json: { error: { code: "internal_error", message: "Try later" } },
      },
      3,
    );
    await openManage(page, page3(2));
    await tickAll(page);
    await expect(
      page.getByText("Media did not confirm whether this was recorded"),
    ).toBeVisible();
    await page.getByRole("button", { name: "Retry original action" }).click();
    await expect.poll(() => writes).toHaveLength(2);
    expect(writes[1]?.idempotencyKey).toBe(writes[0]?.idempotencyKey);
    expect(writes[1]?.body).toEqual(writes[0]?.body);
  });
});

test.describe("capturing a review from the film", () => {
  test("is offered for a held edition, asks first, and sends the captured facts", async ({
    page,
  }) => {
    const film = titleNamed("Interstellar");
    const writes = await answerWrites(
      page,
      REVIEWS,
      {
        json: { recoveryReviewId: review(3), status: "completed", version: 1 },
      },
      3,
    );
    await openManage(page, `/media/${film.id}?view=manage`);
    await page.getByLabel("Movie edition").selectOption("default");
    await page
      .getByText("Household history for Unmarked release", { exact: false })
      .click();
    await expect(page.getByText("Your declaration is needed")).toBeVisible();
    const capture = page.getByRole("button", {
      name: "Capture this edition’s review",
    });
    await capture.click();
    await expect(page.getByRole("alert")).toContainText(
      "Confirm you asked each person to set their choice and Keep first.",
    );
    expect(writes).toEqual([]);
    await page.getByLabel(/I asked each person/u).check();
    await capture.click();
    await expect(
      page.getByRole("link", { name: "Open the captured edition review" }),
    ).toHaveAttribute("href", page3(3));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: "/api/v3/movie-history/reviews",
      body: {
        schemaVersion: 3,
        scope: { rootMediaId: film.id, mediaId: film.id, edition: "default" },
        expected: {
          mediaVersion: 4,
          targetVersion: 3,
          holdVersion: 1,
          definition: {
            definitionVersion: 0,
            definitionDigest: definitionDigest(film, "default"),
          },
        },
      },
    });
  });
});
