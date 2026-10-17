import { expect, test } from "@playwright/test";

test("select an immutable release, inspect queued execution, and cancel safely", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Environments", exact: true }),
  ).toBeVisible();
  const environment = page
    .locator(".environment-card")
    .filter({ hasText: "arcade" });
  await expect(environment).toContainText("No runtime observation");
  await expect(environment).toContainText("Unknown");
  await environment.getByRole("button", { name: "Select release" }).click();
  await page
    .getByRole("combobox", { name: "Version set", exact: true })
    .selectOption({ index: 1 });
  await expect(
    page.getByRole("heading", { name: "Component changes" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Request deployment", exact: true })
    .click();
  const detail = page.getByRole("region", { name: "arcade/prod" });
  await expect(detail.getByText("queued", { exact: true })).toBeVisible();
  await expect(detail).toContainText("No verification evidence recorded");
  await detail.getByRole("button", { name: "Request cancellation" }).click();
  await expect(detail.getByText("canceled", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Version catalog" }).click();
  await expect(
    page.getByRole("heading", { name: "Build qualification" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Version set revisions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Published artifacts" }),
  ).toBeVisible();
});

test("incoming identity headers cannot override the trusted proxy actor", async ({
  request,
}) => {
  const response = await request.get("/api/v1/identity", {
    headers: { "tailscale-user-login": "spoofed@example.com" },
  });
  expect(response.ok()).toBe(true);
  expect(await response.json()).toMatchObject({
    id: "operator@example.com",
    kind: "human",
  });
});
