import { expect, test } from "@playwright/test";
import { confirm } from "./helpers.ts";
import { expectReasonRequired } from "./approval.ts";

test("production release stays pending until a human approves its exact revision", async ({
  page,
}) => {
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
  await expectReasonRequired(page);
  await main
    .getByRole("textbox", { name: "Reason" })
    .fill("Reviewed the exact release and required checks");
  await main.getByRole("button", { name: "Approve release" }).click();
  await expect(main.getByText("queued", { exact: true })).toBeVisible();
  await expect(main).toContainText("operator@example.com");
  await main.getByRole("button", { name: "Request cancellation" }).click();
  await confirm(page, "Request cancellation");
  await expect(main.getByText("canceled", { exact: true })).toBeVisible();
});
