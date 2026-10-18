import { expect, test } from "@playwright/test";

test("quarantined Minecraft release shows independent recovery identity and keeps retry blocked", async ({
  page,
}) => {
  await page.goto("/");
  const environment = page
    .locator(".environment-card")
    .filter({ hasText: "minecraft" });
  await environment
    .getByRole("button", { name: "failed", exact: true })
    .click();
  const detail = page.getByRole("region", { name: "minecraft/tsmc" });
  await expect(
    detail.getByRole("heading", { name: "Original server recovery" }),
  ).toBeVisible();
  await expect(detail).toContainText("toolkit deploy minecraft recover");
  await expect(detail).toContainText("--expected-generation 1");
  await expect(detail).toContainText("browser/minecraft/recovery");
  await expect(detail.getByText("pending", { exact: true })).toBeVisible();
  await detail.getByText("Frozen recovery identity", { exact: true }).click();
  await expect(detail).toContainText(
    "delivery-minecraft-recovery/browser/minecraft/recovery",
  );
  await expect(
    detail.getByRole("button", { name: "Retry as a new deployment" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
});

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
