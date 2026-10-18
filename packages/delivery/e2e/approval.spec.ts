import { expect, test } from "@playwright/test";

test("production release stays pending until a human approves its exact revision", async ({
  page,
}) => {
  await page.goto("/");
  const environment = page
    .locator(".environment-card")
    .filter({ hasText: "scout-for-lol" });
  await expect(environment).toContainText("Approval required");
  await environment.getByRole("button", { name: "Select release" }).click();
  await page
    .getByRole("combobox", { name: "Version set", exact: true })
    .selectOption({ index: 1 });
  await page
    .getByRole("button", { name: "Request deployment", exact: true })
    .click();
  const detail = page.locator("section[aria-labelledby='deployment-heading']");
  await expect(
    detail.getByText("awaiting approval", { exact: true }),
  ).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Approve release" }),
  ).toBeDisabled();
  await detail
    .getByRole("textbox", { name: "Reason" })
    .fill("Reviewed the exact release and required checks");
  await detail.getByRole("button", { name: "Approve release" }).click();
  await expect(detail.getByText("queued", { exact: true })).toBeVisible();
  await expect(detail).toContainText("operator@example.com");
  await detail.getByRole("button", { name: "Request cancellation" }).click();
  await expect(detail.getByText("canceled", { exact: true })).toBeVisible();
});
