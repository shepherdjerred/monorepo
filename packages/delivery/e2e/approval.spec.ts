import { expect, test, type Page } from "@playwright/test";
import { confirm } from "./helpers.ts";
import { expectReasonRequired } from "./approval.ts";

const refused = (url: URL) => url.pathname.endsWith("/approval");

/** Request Scout production's newest release and land on its approval. */
async function requestScoutRelease(page: Page) {
  await page.goto("/environments/scout-for-lol/prod");
  const main = page.getByRole("main");
  await expect(main).toContainText("Approval required");
  await main
    .getByRole("combobox", { name: "Version set", exact: true })
    .selectOption({ index: 1 });
  await main
    .getByRole("button", { name: "Request deployment", exact: true })
    .click();
  await expect(page).toHaveURL(/\/deployments\/[\w-]+$/u);
  await expect(
    main.getByText("awaiting approval", { exact: true }),
  ).toBeVisible();
  return main;
}

test("production release stays pending until a human approves its exact revision", async ({
  page,
}) => {
  const main = await requestScoutRelease(page);
  await expectReasonRequired(page);
  await main
    .getByRole("textbox", { name: "Reason (required)" })
    .fill("Reviewed the exact release and required checks");
  await main.getByRole("button", { name: "Approve release" }).click();
  await expect(main.getByText("queued", { exact: true })).toBeVisible();
  // The form left with the decision; focus lands on what it did.
  const outcome = main.getByRole("status").filter({
    hasText: "Release approved.",
  });
  await expect(outcome).toBeFocused();
  // The reason reads once, as the approval's own.
  await expect(
    main.getByText("Reviewed the exact release and required checks"),
  ).toHaveCount(1);
  await expect(main).toContainText("operator@example.com");
  await main.getByRole("button", { name: "Request cancellation" }).click();
  await confirm(page, "Request cancellation");
  await expect(main.getByText("canceled", { exact: true })).toBeVisible();
});

test("a rejection asks first, keeps its reason after a refusal and states its outcome where focus lands", async ({
  page,
}) => {
  const main = await requestScoutRelease(page);
  const reason = main.getByRole("textbox", { name: "Reason (required)" });
  // Without a reason, Reject points at the field instead of asking.
  await main.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(reason).toBeFocused();
  await expect(reason).toHaveAccessibleDescription(
    "Record why this release is rejected",
  );
  await reason.fill("The release notes name the wrong migration");
  await page.route(refused, (route) =>
    route.fulfill({
      status: 409,
      json: {
        error: {
          code: "CONFLICT",
          message: "Approval is bound to a different frozen selection",
          requestId: "e2e-refusal",
        },
      },
    }),
  );
  await main.getByRole("button", { name: "Reject", exact: true }).click();
  await confirm(page, "Reject release");
  const alert = main.getByRole("alert");
  await expect(alert).toHaveText(
    "Approval is bound to a different frozen selection",
  );
  await expect(reason).toHaveValue(
    "The release notes name the wrong migration",
  );
  await page.unroute(refused);
  await main.getByRole("button", { name: "Reject", exact: true }).click();
  await confirm(page, "Reject release");
  await expect(main.getByText("canceled", { exact: true })).toBeVisible();
  await expect(
    main.getByRole("status").filter({ hasText: "Release rejected." }),
  ).toBeFocused();
});
