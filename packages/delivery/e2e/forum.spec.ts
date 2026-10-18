import { expect, test } from "@playwright/test";

test("original licensed baseline stays distinct from deployment acceptance and freezes backup provenance", async ({
  page,
}) => {
  await page.goto("/");
  const card = page
    .locator(".environment-card")
    .filter({ hasText: "storm-forum" });
  await card.getByRole("button", { name: "Select release" }).click();
  const baseline = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Original forum baseline",
        exact: true,
      }),
    })
    .last();
  await expect(baseline).toContainText("browser/forum/original");
  await expect(baseline).toContainText("succeeded");
  await baseline
    .getByText("Original native provenance", { exact: true })
    .click();
  await expect(baseline).toContainText("job-uid");
  await expect(baseline).toContainText("forum-bundle");
  await page.getByRole("button", { name: "Deployments", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "storm-forum/prod" })
    .getByRole("button", { name: /Inspect/u })
    .click();
  await expect(
    page.getByRole("heading", { name: "Frozen original forum" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Pre-upgrade backup uses this independently observed original runtime and licensed bundle.",
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: test.info().outputPath("forum-baseline.png"),
    fullPage: true,
  });
});
