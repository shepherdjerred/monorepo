import { expect, type Locator } from "@playwright/test";

/** Exercise approval/cancellation with the same real server state assertions. */
export async function approveAndCancel(detail: Locator) {
  await detail.getByRole("button", { name: "Approve release" }).click();
  await expect(detail.getByText("queued", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Request cancellation" }).click();
  await expect(detail.getByText("canceled", { exact: true })).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Retry as a new deployment" }),
  ).toHaveCount(0);
}
