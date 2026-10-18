import { expect, test } from "@playwright/test";

test("controller upgrade shows original cross-owner image and independent chart inputs", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Deployments", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: "delivery-control-plane/prod" })
    .getByRole("button", { name: /Inspect deployment/ })
    .click();
  const detail = page.getByRole("region", {
    name: "delivery-control-plane/prod",
    exact: true,
  });
  await expect(
    detail.getByRole("heading", { name: "Independent control-plane upgrade" }),
  ).toBeVisible();
  await expect(detail).toContainText("controller/image/101");
  await expect(detail).toContainText("controller/image/102");
  await expect(detail).toContainText("Owner temporal");
  await expect(detail).toContainText("controller/chart/104");
  await expect(detail).toContainText("Initial adoption independently observes");
  await page.screenshot({
    path: info.outputPath("control-plane.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
});
test("human recovery approval binds the exact saved plan and leaves the original result failed", async ({
  page,
}, info) => {
  const stack = info.project.name === "mobile" ? "discord" : "anthropic";
  await page.goto("/");
  await page.getByRole("button", { name: "Deployments", exact: true }).click();
  await page
    .getByRole("row")
    .filter({ hasText: `gitops/tofu:${stack}` })
    .getByRole("button", { name: /Inspect deployment/ })
    .click();
  const detail = page.getByRole("region", {
    name: `gitops/tofu:${stack}`,
    exact: true,
  });
  await expect(
    detail.getByRole("heading", {
      name: "Independent infrastructure recovery",
    }),
  ).toBeVisible();
  await expect(detail).toContainText("Recovery plan digest");
  await expect(detail).toContainText("disposable-state");
  await expect(detail).toContainText("Serial 7");
  const approve = detail.getByRole("button", {
    name: "Approve exact recovery plan",
  });
  await expect(approve).toBeDisabled();
  await detail
    .getByRole("textbox", { name: "Recovery approval reason" })
    .fill(
      "Reviewed exact native Job, state serial and immutable recovery plan digest",
    );
  await page.screenshot({
    path: info.outputPath("recovery-plan.png"),
    fullPage: true,
  });
  await approve.click();
  await expect(detail).toContainText("Plan approved by operator@example.com");
  await expect(detail.getByText("failed", { exact: true })).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "Retry as a new deployment" }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
  ).toBe(true);
});
