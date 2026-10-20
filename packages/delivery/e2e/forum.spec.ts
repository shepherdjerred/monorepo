import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, openDeployment } from "./helpers.ts";

test("original licensed baseline stays distinct from deployment acceptance and freezes backup provenance", async ({
  page,
}) => {
  await page.goto("/environments/storm-forum/prod");
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
  await openDeployment(page, "storm-forum/prod");
  await expect(
    page.getByRole("heading", { name: "Frozen original forum" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Pre-upgrade backup uses this independently observed original runtime and licensed bundle.",
    ),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: test.info().outputPath("forum-baseline.png"),
    fullPage: true,
  });
});
