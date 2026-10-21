import { expect, test } from "@playwright/test";
import { DeploymentDetailSchema } from "#shared/contract.ts";
import { expectNoHorizontalOverflow, openDeployment } from "./helpers.ts";

test("controller upgrade shows original cross-owner image and independent chart inputs", async ({
  page,
}, info) => {
  const selected = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      /\/api\/v1\/deployments\/[^/]+$/u.test(new URL(response.url()).pathname),
  );
  await openDeployment(page, "delivery-control-plane/prod");
  const response = await selected;
  const frozen = DeploymentDetailSchema.parse(await response.json());
  expect(frozen.environment.acceptedDeploymentId).toBeNull();
  expect(frozen.deployment.controlPlaneSnapshot).toMatchObject({
    priorSelectionManaged: true,
    previousArtifact: { id: "controller/image/101" },
    nextArtifact: { id: "controller/image/102" },
    priorChartArtifact: { id: "controller/chart/103" },
    chartArtifact: { id: "controller/chart/104" },
  });
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { name: "Independent control-plane upgrade" }),
  ).toBeVisible();
  await expect(main).toContainText("controller/image/101");
  await expect(main).toContainText("controller/image/102");
  await expect(main).toContainText("Owner temporal");
  await expect(main).toContainText("controller/chart/104");
  await expect(main).toContainText(
    "Prior source includes the exact Helm image parameter.",
  );
  await expect(main).toContainText(
    "Independent native verification must prove the frozen original selection before replacement.",
  );
  await page.screenshot({
    path: info.outputPath("control-plane.png"),
    fullPage: true,
  });
  await expectNoHorizontalOverflow(page);
});

test("human recovery approval binds the exact saved plan and leaves the original result failed", async ({
  page,
}, info) => {
  const stack = info.project.name === "mobile" ? "discord" : "anthropic";
  await openDeployment(page, `gitops/tofu:${stack}`, { status: "failed" });
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", {
      name: "Independent infrastructure recovery",
    }),
  ).toBeVisible();
  await expect(main).toContainText("Recovery plan digest");
  await expect(main).toContainText("disposable-state");
  await expect(main).toContainText("Serial 7");
  const approve = main.getByRole("button", {
    name: "Approve exact recovery plan",
  });
  await expect(approve).toBeDisabled();
  await main
    .getByRole("textbox", { name: "Recovery approval reason" })
    .fill(
      "Reviewed exact native Job, state serial and immutable recovery plan digest",
    );
  await page.screenshot({
    path: info.outputPath("recovery-plan.png"),
    fullPage: true,
  });
  await approve.click();
  await expect(main).toContainText("Plan approved by operator@example.com");
  await expect(main.getByText("failed", { exact: true })).toBeVisible();
  await expect(
    main.getByRole("button", { name: "Retry as a new deployment" }),
  ).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});
