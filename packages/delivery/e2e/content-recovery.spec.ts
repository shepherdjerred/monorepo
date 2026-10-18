import { expect, test } from "@playwright/test";

test("content quarantine exposes immutable refusal and native receipts while retry stays blocked", async ({
  page,
}, info) => {
  await page.goto("/");
  const response = await page.request.get(
    "/api/v1/content-recovery/browser%2Fcontent%2Frefused",
  );
  expect(response.status()).toBe(200);
  const inspection: unknown = await response.json();
  expect(inspection).toMatchObject({
    intent: {
      status: "failed",
      message: "Local fixture: foreign maintenance owner; ownership retained",
    },
    deployment: { deployment: { status: "failed", recoveryRequired: true } },
  });
  await page.getByRole("button", { name: "Deployments", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "storm-forum/prod" })
    .getByRole("button", { name: /Inspect/u })
    .click();
  const detail = page.getByRole("region", { name: "storm-forum/prod" });
  const recovery = detail.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Independent forum recovery",
      exact: true,
    }),
  });
  await expect(recovery).toContainText("toolkit deploy forum recover");
  await expect(recovery).toContainText(
    "preserves the failed release and accepted version",
  );
  await expect(recovery).toContainText("browser/content/refused");
  await expect(recovery).toContainText(
    "foreign maintenance owner; ownership retained",
  );
  await expect(recovery).toContainText("browser/content/pending");
  await recovery
    .getByRole("listitem")
    .filter({ hasText: "browser/content/refused" })
    .getByText("Frozen recovery operation and native receipts", { exact: true })
    .click();
  await expect(recovery).toContainText("storm-forum-release-");
  await expect(recovery).toContainText("81716b2a-415d-49bc-adbd-aadf761050aa");
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
  await recovery.screenshot({ path: info.outputPath("content-recovery.png") });
});
