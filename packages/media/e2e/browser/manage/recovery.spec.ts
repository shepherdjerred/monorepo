import { expect } from "@playwright/test";
import { MEMBER } from "#testing/fixture-api/personas.ts";
import { fixtureId, sha256 } from "#testing/fixture-api/support.ts";
import { TITLES, titleNamed } from "#testing/fixture-api/fixtures/titles.ts";
import {
  allowWrites,
  horizontalOverflow,
  inScenario,
  openSettled,
  test,
} from "#e2e/browser/support.ts";
import { answerWrites, openManage, violations } from "./support.ts";

const review = (n: number) => fixtureId(16, n);

test.describe("what a restore left, as the owner sees it", () => {
  test("says what is waiting first, then lists the held titles by why they are held", async ({
    page,
  }) => {
    await openManage(page, "/manage/recovery");
    await expect(
      page.getByRole("alert").or(page.getByRole("status")).first(),
    ).toBeVisible();
    await expect(
      page.getByText(
        "1 household review is waiting for declarations and 6 titles are held",
      ),
    ).toBeVisible();
    // The open review is a row of its own; the applied ones are folded away.
    await expect(
      page.getByRole("link", { name: "Open review" }),
    ).toHaveAttribute("href", `/recovery/${review(1)}`);
    await expect(page.getByText("Applied reviews (2)")).toBeVisible();
    await expect(
      page.getByRole("group", { name: /^The restore lost who asked/u }),
    ).toBeVisible();
    expect(await violations(page)).toEqual([]);
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test("prepares a review from ticked titles and says what that does before and after", async ({
    page,
  }) => {
    const writes = await answerWrites(page, "/recovery/reviews", {
      json: { recoveryReviewId: review(9) },
    });
    await openManage(page, "/manage/recovery");
    const prepare = page.getByRole("button", { name: "Prepare review" });
    await expect(prepare).toBeDisabled();
    await expect(
      page.getByText("Tick at least one title to prepare a review."),
    ).toBeVisible();

    await page.getByLabel("Blade Runner 2049").check();
    await page.getByLabel("Interstellar").check();
    await expect(
      page.getByText("Preparing captures 2 titles in one review."),
    ).toBeVisible();
    await expect(page.getByText("2 ticked.")).toBeVisible();
    await prepare.click();

    await expect(page.getByText("Review prepared")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open the exact review" }),
    ).toHaveAttribute("href", `/recovery/${review(9)}`);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/recovery/reviews",
      body: {
        mediaIds: [
          titleNamed("Blade Runner 2049").id,
          titleNamed("Interstellar").id,
        ],
      },
    });
  });

  test("a refused preparation says nothing was prepared and keeps the ticks", async ({
    page,
  }) => {
    await answerWrites(page, "/recovery/reviews", {
      status: 409,
      json: { error: { code: "recovery_changed", message: "A hold changed" } },
    });
    await openManage(page, "/manage/recovery");
    await page.getByLabel("The Wire").check();
    await page.getByRole("button", { name: "Prepare review" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "No review was prepared",
    );
    await expect(page.getByRole("alert")).toContainText("A hold changed");
    await expect(page.getByLabel("The Wire")).toBeChecked();
  });

  test("a filter narrows the held titles and ticks only what it shows", async ({
    page,
  }) => {
    await openManage(page, "/manage/recovery");
    await page.getByLabel("Find a held title").fill("wire");
    await expect(page.getByText("1 of 6 held titles match.")).toBeVisible();
    await page.getByRole("button", { name: "Tick the 1 shown" }).click();
    await expect(page.getByText("1 ticked.")).toBeVisible();
    await page.getByLabel("Find a held title").fill("");
    await expect(page.getByLabel("The Wire")).toBeChecked();
    await expect(page.getByLabel("Alien")).not.toBeChecked();
    await page.getByRole("button", { name: "Clear ticks" }).click();
    await expect(page.getByText("0 ticked.")).toBeVisible();
  });

  test("matches an old-system requester to a household member only with the owner's confirmation", async ({
    page,
  }) => {
    const writes = await answerWrites(page, "/admin/legacy-requester-bindings");
    await openManage(page, "/manage/recovery");
    await page
      .getByLabel("Uploaded source capture")
      .selectOption(fixtureId(17, 102));
    await expect(
      page.getByText("2 of 3 requesters are not matched yet."),
    ).toBeVisible();
    await page.getByText("Source requester u-1001").click();
    const form = page.getByRole("form", { name: "Source requester u-1001" });
    // An identity whose Plex access is not reconciled cannot be chosen.
    await expect(form.getByRole("option", { name: /^Alex/u })).toBeDisabled();

    await form
      .getByRole("button", { name: "Save identity association" })
      .click();
    await expect(
      form
        .getByText("Choose the household identity this requester was.")
        .first(),
    ).toBeVisible();
    expect(writes).toEqual([]);

    await form.getByLabel("Exact household identity").selectOption(MEMBER.id);
    await expect(form.getByText("fixture-server")).toBeVisible();
    await form.getByLabel(/I verified this exact source requester/u).check();
    await form
      .getByRole("button", { name: "Save identity association" })
      .click();
    await expect(form.getByRole("status")).toContainText(
      "Identity association recorded. Prepare a fresh household review for current declarations.",
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/admin/legacy-requester-bindings",
      body: {
        captureId: fixtureId(17, 102),
        requesterSourceId: "u-1001",
        requesterEvidenceHash: sha256("requester-u-1001"),
        userId: MEMBER.id,
        expectedRevision: 0,
        acknowledgeIdentityOnly: true,
      },
    });
  });

  test("links to each file recovery job", async ({ page }) => {
    await openManage(page, "/manage/recovery");
    for (const [name, to] of [
      ["Reprove restored library files", "/manage/recovery/native"],
      ["Review upgrade archives", "/manage/recovery/native/archives"],
      ["Review interrupted upgrades", "/manage/recovery/native/compensations"],
    ] as const) {
      await expect(page.getByRole("link", { name })).toHaveAttribute(
        "href",
        to,
      );
    }
  });
});

test.describe("a household review", () => {
  test("a member answers it: every title needs a choice, then the exact declaration is sent", async ({
    page,
  }) => {
    const writes = await answerWrites(
      page,
      `/recovery/reviews/${review(1)}/responses`,
    );
    await openSettled(page, "member", `/recovery/${review(1)}`);
    await allowWrites(page);
    await expect(
      page.getByText("Your declaration is still needed"),
    ).toBeVisible();

    const submit = page.getByRole("button", { name: "Record my declaration" });
    await submit.click();
    await expect(page.getByRole("alert")).toContainText(
      "Choose what you want for Breaking Bad.",
    );
    expect(writes).toEqual([]);

    const breakingBad = page.getByRole("group", { name: "Breaking Bad" });
    await breakingBad.getByLabel("Keep for 30 days").check();
    await expect(
      page.getByText(
        "It is held for you for 30 days after the owner applies this review.",
      ),
    ).toBeVisible();
    await page
      .getByRole("group", { name: "Better Call Saul" })
      .getByLabel("Keep requesting")
      .check();
    await expect(
      page.getByText(
        "You are recording 1 keep requesting, 1 keep for 30 days.",
      ),
    ).toBeVisible();
    // The pending acknowledgement is still required.
    await submit.click();
    await expect(page.getByRole("alert")).toContainText(
      "Confirm you understand the declaration is pending.",
    );
    expect(writes).toEqual([]);

    await page
      .getByLabel(/I understand these declarations are pending/u)
      .check();
    await submit.click();
    await expect.poll(() => writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/recovery/reviews/${review(1)}/responses`,
      body: {
        scopeHash: sha256("review-1"),
        subjectUserId: MEMBER.id,
        claimAcknowledgements: [],
        acknowledgePending: true,
        declarations: [
          { mediaId: titleNamed("Breaking Bad").id, intent: "keep", days: 30 },
          { mediaId: titleNamed("Better Call Saul").id, intent: "request" },
        ],
      },
    });
  });

  test("a member sees an applied review as done, with what they declared", async ({
    page,
  }) => {
    await openSettled(page, "member", `/recovery/${review(2)}`);
    await expect(
      page.getByText("This review was applied").first(),
    ).toBeVisible();
    await expect(page.getByText("This declaration was applied")).toBeVisible();
    await expect(page.getByRole("button", { name: /Record/u })).toHaveCount(0);
    expect(await violations(page)).toEqual([]);
  });

  test("the owner declares for a managed profile with the actor and subject on the record", async ({
    page,
  }) => {
    const writes = await answerWrites(
      page,
      `/recovery/reviews/${review(1)}/responses`,
    );
    await openManage(page, `/recovery/${review(1)}`);
    await expect(page.getByText("Waiting for Mei, Kids")).toBeVisible();
    const form = page.getByRole("form", { name: "Declare for Kids" });
    for (const title of ["Breaking Bad", "Better Call Saul"]) {
      await form
        .getByRole("group", { name: title })
        .getByLabel("No longer requested")
        .check();
    }
    await form
      .getByLabel(/I understand these declarations are pending/u)
      .check();
    await form
      .getByRole("button", { name: "Record managed-profile declaration" })
      .click();
    await expect.poll(() => writes).toHaveLength(1);
    expect(writes[0]?.body).toMatchObject({
      subjectUserId: fixtureId(1, 5),
      acknowledgePending: true,
      declarations: [
        { mediaId: titleNamed("Breaking Bad").id, intent: "no_longer_request" },
        {
          mediaId: titleNamed("Better Call Saul").id,
          intent: "no_longer_request",
        },
      ],
    });
  });

  test("a review that is missing declarations or has a blocker says why it cannot be applied", async ({
    page,
  }) => {
    await openSettled(page, "owner", `/recovery/${review(1)}`);
    await expect(page.getByText("Not ready to apply")).toBeVisible();
    await expect(page.getByText("Mei has not declared yet.")).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "Apply declarations and release reviewed holds",
      }),
    ).toHaveCount(0);

    await openSettled(page, "owner", `/recovery/${review(5)}`);
    await expect(
      page
        .getByText(
          "Some episodes share a file with a title that is not in this review.",
        )
        .first(),
    ).toBeVisible();
    await expect(
      page.getByText("This review cannot take declarations yet").first(),
    ).toBeVisible();
  });

  test("applying asks three questions, then names the titles in a dialog, then sends the exact release", async ({
    page,
  }) => {
    const writes = await answerWrites(
      page,
      `/recovery/reviews/${review(6)}/release`,
    );
    await openManage(page, `/recovery/${review(6)}`);
    const apply = page.getByRole("button", {
      name: "Apply declarations and release reviewed holds",
    });
    await apply.click();
    await expect(page.getByRole("alert")).toContainText(
      "Confirm that everyone in the household is represented.",
    );
    expect(writes).toEqual([]);

    for (const label of [
      /I confirm everyone in this household is represented/u,
      /I reviewed the existing Keep and pins/u,
      /Lost request history cannot be recovered/u,
    ]) {
      await page.getByLabel(label).check();
    }
    await expect(
      page.getByText(
        "Applying records 3 declarations and releases the recovery hold on 2 titles.",
      ),
    ).toBeVisible();
    await apply.click();
    const dialog = page.getByRole("dialog", {
      name: "Apply this review and release the holds?",
    });
    await expect(dialog).toContainText("Succession");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    expect(await violations(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect(writes).toEqual([]);

    await apply.click();
    await dialog
      .getByRole("button", {
        name: "Apply declarations and release reviewed holds",
      })
      .click();
    await expect(page.getByText("Review applied")).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: "POST",
      path: `/api/v1/recovery/reviews/${review(6)}/release`,
      body: {
        expectedVersion: 2,
        scopeHash: sha256("review-6"),
        responseHash: sha256("responses-6"),
        confirmHouseholdBaseline: true,
        confirmExistingPins: true,
        acknowledgeMissingHistory: true,
      },
    });
  });

  test("a refused release says it was not applied and leaves the form to try again", async ({
    page,
  }) => {
    await answerWrites(page, `/recovery/reviews/${review(6)}/release`, {
      status: 409,
      json: {
        error: { code: "version_conflict", message: "The review changed" },
      },
    });
    await openManage(page, `/recovery/${review(6)}`);
    for (const label of [
      /I confirm everyone in this household/u,
      /I reviewed the existing Keep and pins/u,
      /Lost request history cannot be recovered/u,
    ]) {
      await page.getByLabel(label).check();
    }
    await page
      .getByRole("button", {
        name: "Apply declarations and release reviewed holds",
      })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", {
        name: "Apply declarations and release reviewed holds",
      })
      .click();
    await expect(page.getByRole("alert")).toContainText("The review changed");
    await expect(
      page.getByRole("button", {
        name: "Apply declarations and release reviewed holds",
      }),
    ).toBeVisible();
  });

  test("a long review stays scannable and fits the screen", async ({
    page,
  }) => {
    await openSettled(page, "owner", `/recovery/${review(4)}`);
    await expect(page.getByText("Show the other 14 titles")).toBeVisible();
    await expect(
      page.getByText("Selected legacy claim evidence"),
    ).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    expect(await violations(page)).toEqual([]);
  });
});

test.describe("a member's recovery page", () => {
  test("lists the reviews to answer first and folds the applied ones", async ({
    page,
  }) => {
    await openSettled(page, "member", "/recovery");
    await expect(
      page.getByRole("link", { name: "Open review and respond" }),
    ).toHaveAttribute("href", `/recovery/${review(1)}`);
    await expect(page.getByText("Applied reviews (2)")).toBeVisible();
    // A member is never told what the restore left held.
    await expect(page.getByText("Held titles")).toHaveCount(0);
    expect(await violations(page)).toEqual([]);
  });
});

test.describe("the other states of the page", () => {
  test("a long restore: many held titles in groups, a filter, and no sideways scroll", async ({
    page,
  }) => {
    await inScenario(page, "recovery-long");
    await openManage(page, "/manage/recovery");
    await expect(page.getByText("42 held titles. 0 ticked.")).toBeVisible();
    await expect(
      page.getByRole("group", {
        name: /^(The restore|Requests from|Imported from)/u,
      }),
    ).toHaveCount(3);
    await expect(
      page.getByText(
        "3 household reviews are waiting for declarations and 42 titles are held",
      ),
    ).toBeVisible();
    await expect(page.getByText("Applied reviews (10)")).toBeVisible();
    await page.getByLabel("Find a held title").fill(TITLES[0]?.title ?? "");
    await expect(page.getByText(/^1 of 42 held titles match\./u)).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    expect(await violations(page)).toEqual([]);
  });

  test("a restore that has been dealt with says all clear", async ({
    page,
  }) => {
    await inScenario(page, "recovery-all-clear");
    await openSettled(page, "owner", "/manage/recovery");
    await expect(page.getByText("All clear")).toBeVisible();
    await expect(
      page.getByText("No title is held. Nothing needs a household review."),
    ).toBeVisible();
    await expect(
      page.getByText("Every household review has been applied."),
    ).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });

  test("a failed read says what failed and offers a retry", async ({
    page,
  }) => {
    await inScenario(page, "recovery-unavailable");
    await openSettled(page, "owner", "/manage/recovery");
    await expect(
      page.getByText("Recovery reviews could not be loaded"),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  });
});
