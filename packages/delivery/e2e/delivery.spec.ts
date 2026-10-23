import { expect, test } from "@playwright/test";
import { DeploymentDetailSchema } from "#shared/contract.ts";
import {
  confirm,
  expectNoHorizontalOverflow,
  openDeployment,
} from "./helpers.ts";

test("quarantined Minecraft release shows independent recovery identity and keeps retry blocked", async ({
  page,
}) => {
  await openDeployment(page, "minecraft/tsmc", { status: "failed" });
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { name: "Original server recovery" }),
  ).toBeVisible();
  await expect(main).toContainText("toolkit deploy minecraft recover");
  // The binding generation moves only on acceptance; this release never accepted.
  await expect(main).toContainText("--expected-generation 0");
  await expect(main).toContainText("browser/minecraft/recovery");
  await expect(main.getByText("pending", { exact: true })).toBeVisible();
  await main.getByText("Frozen recovery identity", { exact: true }).click();
  await expect(main).toContainText(
    "delivery-minecraft-recovery/browser/minecraft/recovery",
  );
  await expect(
    main.getByRole("button", { name: "Retry as a new deployment" }),
  ).toBeDisabled();
  await expectNoHorizontalOverflow(page);
});

test("routine Minecraft restart keeps the ordinary lock notice without preservation-controller instructions", async ({
  page,
}) => {
  // A per-test UI fixture leaves the real shared legacy quarantine unchanged.
  await page.route("**/api/v1/deployments/*", async (route) => {
    const response = await route.fetch();
    const detail = DeploymentDetailSchema.parse(await response.json());
    if (detail.environment.id === "minecraft/tsmc") {
      if (
        detail.pipeline.definition.kind !== "argocd" ||
        !detail.pipeline.definition.minecraftUpgrade
      )
        throw new Error("Expected the specialized Minecraft fixture");
      detail.pipeline.definition.minecraftUpgrade.releaseMode =
        "retained-volume-restart";
      detail.pipeline.id = "minecraft-tsmc/2";
      detail.deployment.pipelineRevisionId = "minecraft-tsmc/2";
      detail.environment.pipelineRevisionId = "minecraft-tsmc/2";
      detail.minecraftRecoveries = [];
      detail.stages = [];
    }
    await route.fulfill({ response, json: detail });
  });
  await openDeployment(page, "minecraft/tsmc", { status: "failed" });
  const detail = page.getByRole("main");
  await expect(detail).toContainText("Operator recovery is required");
  await expect(
    detail.getByRole("heading", { name: "Original server recovery" }),
  ).toHaveCount(0);
  await expect(detail).not.toContainText("toolkit deploy minecraft recover");
  await expect(
    detail.getByRole("button", { name: "Retry as a new deployment" }),
  ).toBeDisabled();
});

test("select an immutable release, inspect queued execution, and cancel safely", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: "Arcade", exact: true }) })
    .getByRole("link", { name: /prod/u })
    .click();
  await expect(page).toHaveURL(/\/environments\/arcade\/prod$/u);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("heading", { level: 1, name: "arcade/prod" }),
  ).toBeVisible();
  await expect(main).toContainText("No runtime observation");
  await expect(main).toContainText("Unknown");
  await main
    .getByRole("combobox", { name: "Version set", exact: true })
    .selectOption({ index: 1 });
  await expect(
    main.getByRole("heading", { name: "Component changes" }),
  ).toBeVisible();
  await main
    .getByRole("button", { name: "Request deployment", exact: true })
    .click();
  await expect(main.getByText("queued", { exact: true })).toBeVisible();
  await expect(main).toContainText("No verification evidence recorded");
  await main.getByRole("button", { name: "Request cancellation" }).click();
  await confirm(page, "Request cancellation");
  await expect(main.getByText("canceled", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Artifacts" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Build qualification" }),
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
