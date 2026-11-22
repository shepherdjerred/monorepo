import { expect } from "@playwright/test";
import { MEMBER } from "#testing/fixture-api/personas.ts";
import { fixtureId, sha256 } from "#testing/fixture-api/support.ts";
import { TITLES, titleNamed } from "#testing/fixture-api/fixtures/titles.ts";
import {
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

  test("choosing a different identity clears the verification, so each person is confirmed on their own", async ({
    page,
  }) => {
    const writes = await answerWrites(page, "/admin/legacy-requester-bindings");
    await openManage(page, "/manage/recovery");
    await page
      .getByLabel("Uploaded source capture")
      .selectOption(fixtureId(17, 102));
    await page.getByText("Source requester u-1001").click();
    const form = page.getByRole("form", { name: "Source requester u-1001" });
    const verified = form.getByLabel(/I verified this exact source requester/u);
    await form.getByLabel("Exact household identity").selectOption(MEMBER.id);
    await verified.check();
    await expect(verified).toBeChecked();

    // A different person is a different claim: the confirmation given for
    // the first does not carry over.
    await form
      .getByLabel("Exact household identity")
      .selectOption(fixtureId(1, 5));
    await expect(verified).not.toBeChecked();
    await form
      .getByRole("button", { name: "Save identity association" })
      .click();
    await expect(
      form
        .getByText("Confirm you verified this requester and identity.")
        .first(),
    ).toBeVisible();
    expect(writes).toEqual([]);

    await verified.check();
    await form
      .getByRole("button", { name: "Save identity association" })
      .click();
    await expect.poll(() => writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      body: {
        requesterSourceId: "u-1001",
        userId: fixtureId(1, 5),
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
