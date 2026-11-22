import { expect } from "@playwright/test";
import { RecoveryDetailSchema } from "#shared/recovery.ts";
import { MEMBER } from "#testing/fixture-api/personas.ts";
import { fixtureId, sha256 } from "#testing/fixture-api/support.ts";
import { titleNamed } from "#testing/fixture-api/fixtures/titles.ts";
import {
  allowWrites,
  horizontalOverflow,
  openSettled,
  test,
} from "#e2e/browser/support.ts";
import { answerWrites, openManage, violations } from "./support.ts";

const review = (n: number) => fixtureId(16, n);

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

  test("statements ticked for one set of declarations are cleared when the reviewed set changes", async ({
    page,
  }) => {
    let changed = false;
    await page.route(
      `**/api/v1/recovery/reviews/${review(6)}`,
      async (route) => {
        const response = await route.fetch();
        const body = RecoveryDetailSchema.parse(await response.json());
        await route.fulfill({
          response,
          json: changed
            ? {
                ...body,
                version: 9,
                responseHash: sha256("responses-6-changed"),
              }
            : body,
        });
      },
    );
    await page.clock.install();
    await openManage(page, `/recovery/${review(6)}`);
    const first = page.getByLabel(/I confirm everyone in this household/u);
    await first.check();
    await page.getByLabel(/I reviewed the existing Keep and pins/u).check();
    await expect(first).toBeChecked();

    // A declaration arrives while the owner is reading: the page reads the
    // review again, and the new set has to be confirmed afresh.
    changed = true;
    await page.clock.fastForward(60_000);
    await page.evaluate(() => {
      globalThis.dispatchEvent(new globalThis.Event("visibilitychange"));
    });
    await expect(first).not.toBeChecked();
    await expect(
      page.getByLabel(/I reviewed the existing Keep and pins/u),
    ).not.toBeChecked();
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
