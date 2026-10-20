import { expect, type Page } from "@playwright/test";
import { confirm } from "./helpers.ts";

/** Exercise approval/cancellation with the same real server state assertions. */
export async function approveAndCancel(page: Page) {
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "Approve release" }).click();
  await expect(main.getByText("queued", { exact: true })).toBeVisible();
  await main.getByRole("button", { name: "Request cancellation" }).click();
  await confirm(page, "Request cancellation");
  await expect(main.getByText("canceled", { exact: true })).toBeVisible();
  await expect(
    main.getByRole("button", { name: "Retry as a new deployment" }),
  ).toHaveCount(0);
}

/** An empty reason never reaches the server: the browser blocks the submit. */
export async function expectReasonRequired(page: Page) {
  const main = page.getByRole("main");
  const reason = main.getByRole("textbox", { name: "Reason" });
  await expect(reason).toHaveValue("");
  await main.getByRole("button", { name: "Approve release" }).click();
  expect(await reason.evaluate((element) => element.matches(":invalid"))).toBe(
    true,
  );
  await expect(
    main.getByText("awaiting approval", { exact: true }),
  ).toBeVisible();
}
