import { approveAndCancel } from "./approval.ts";
import { expect, test } from "@playwright/test";

test("review exact retained worker retirement before production approval without stopping the host", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .locator(".environment-card")
    .filter({ hasText: "scout-for-lol" })
    .getByRole("button", { name: "Select release" })
    .click();
  const pool = page.getByRole("region", {
    name: "Retained workers",
    exact: true,
  });
  await expect(pool).toContainText("1 · selected");
  await expect(pool).toContainText("1 · retained");
  await expect(pool).toContainText("scout-prod-workflows");
  await pool
    .getByRole("button", { name: "Request retirement", exact: true })
    .click();
  await pool
    .getByRole("button", { name: "Confirm retirement request" })
    .click();
  const detail = page.getByRole("region", {
    name: "scout-for-lol/prod",
    exact: true,
  });
  await expect(
    detail.getByText("awaiting approval", { exact: true }),
  ).toBeVisible();
  const frozen = detail.getByRole("region", {
    name: "Frozen worker pool",
    exact: true,
  });
  await expect(frozen).toContainText("Retirement requested");
  await expect(frozen).not.toContainText("Restores target from");
  await expect(frozen).toContainText("Zero · artifact retained");
  await expect(frozen).toContainText("2".padEnd(40, "0"));
  await expect(frozen).toContainText("scout-prod/image/1");
  await expect(frozen).toContainText("sha256:");
  const state = await request.get(
    "/api/v1/environments/scout-for-lol%2Fprod/workers",
  );
  const metadata: unknown = await state.json();
  expect(metadata).toMatchObject({
    versions: expect.arrayContaining([
      expect.objectContaining({ buildId: "1".padEnd(40, "0"), replicas: 1 }),
    ]),
  });
  await expect(
    detail.getByRole("button", { name: "Approve release" }),
  ).toBeDisabled();
  await detail
    .getByRole("textbox", { name: "Reason" })
    .fill(
      "Reviewed exact retained artifact and fixed routing before executor drain proof",
    );
  await approveAndCancel(detail);
});

test("host-only baseline review distinguishes routed worker identity from full-app provenance and acceptance", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Deployments", exact: true }).click();
  await page
    .locator("tr")
    .filter({ hasText: /temporal\/prod.*adopt-worker/s })
    .getByRole("button", { name: "Inspect" })
    .click();
  const detail = page.getByRole("region", {
    name: "temporal/prod",
    exact: true,
  });
  await expect(
    detail.getByRole("region", { name: "Frozen worker pool" }),
  ).toContainText("Host-only baseline adoption");
  await expect(detail).toContainText(
    "It does not accept or change the full application release",
  );
  await expect(detail).toContainText("1".padEnd(40, "0"));
  await expect(detail).toContainText("3".padEnd(40, "0"));
  await expect(
    detail.getByRole("region", { name: "Frozen control-plane image" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Environments", exact: true }).click();
  await expect(
    page.locator(".environment-card").filter({ hasText: "temporal" }),
  ).toContainText("Unknown");
});

test("upstream acquisition displays original verification without inventing a CI link", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Version catalog", exact: true })
    .click();
  const builds = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Build qualification",
      exact: true,
    }),
  });
  const upstream = builds
    .getByRole("row")
    .filter({ hasText: "minecraft" })
    .filter({ hasText: "Original upstream bytes verified" });
  await expect(upstream).toContainText("Original upstream bytes verified");
  await expect(upstream.getByRole("link", { name: "View CI" })).toHaveCount(0);
});
