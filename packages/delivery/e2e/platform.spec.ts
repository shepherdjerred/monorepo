import { approveAndCancel } from "./approval.ts";
import { expect, test } from "@playwright/test";
import { OverviewSchema, DeploymentSchema } from "#shared/contract.ts";

test("saved-plan approval exposes exact public identity without encrypted provider data", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/v1/overview");
  const overview = OverviewSchema.parse(await response.json());
  const environment = overview.environments.find(
    (entry) => entry.id === "gitops/tofu:openai",
  );
  const plan = overview.deployments.find(
    (entry) =>
      entry.environmentId === environment?.id &&
      entry.kind === "tofu-plan" &&
      entry.status === "succeeded",
  );
  if (environment === undefined || plan === undefined)
    throw new Error("Real persisted plan required");
  const headers = { Origin: "http://127.0.0.1:17353" };
  for (const deployment of overview.deployments.filter(
    (entry) =>
      entry.environmentId === environment.id &&
      entry.kind === "tofu-apply" &&
      entry.status === "awaiting_approval",
  )) {
    const canceled = await request.post(
      `/api/v1/deployments/${deployment.id}/cancel`,
      { headers },
    );
    expect(canceled.status()).toBe(200);
  }
  const created = await request.post("/api/v1/platform/deployments", {
    headers,
    data: {
      kind: "tofu-apply",
      requestId: crypto.randomUUID(),
      environmentId: environment.id,
      expectedGeneration: environment.generation,
      planDeploymentId: plan.id,
    },
  });
  expect(created.status()).toBe(201);
  const deployment = DeploymentSchema.parse(await created.json());
  await page.goto("/");
  await page.getByRole("button", { name: "Deployments", exact: true }).click();
  await page
    .getByRole("button", {
      name: `Inspect deployment ${deployment.id}`,
      exact: true,
    })
    .click();
  const detail = page.getByRole("region", {
    name: "gitops/tofu:openai",
    exact: true,
  });
  const frozen = detail.getByRole("region", {
    name: "Frozen platform release",
  });
  await expect(frozen).toContainText("Exact saved OpenTofu plan");
  await expect(frozen).toContainText("disposable-state");
  await expect(frozen).toContainText("Serial 7");
  await expect(frozen).toContainText(`sha256:${"c".repeat(64)}`);
  await expect(frozen).toContainText(
    "Create 1 · update 2 · delete 0 · replace 0",
  );
  await expect(detail).not.toContainText("ciphertext");
  await expect(
    detail.getByRole("button", { name: "Approve release" }),
  ).toBeDisabled();
  await detail
    .getByRole("textbox", { name: "Reason" })
    .fill("Reviewed exact plan hash, native producer and state serial");
  await approveAndCancel(detail);
});

test("root review retains original chart provenance and platform destination uses a dedicated request form", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Deployments", exact: true }).click();
  await page
    .locator("tr")
    .filter({ hasText: /gitops\/root.*root-release/s })
    .getByRole("button", { name: "Inspect" })
    .click();
  const frozen = page.getByRole("region", { name: "Frozen platform release" });
  await expect(frozen).toContainText("Exact root chart inventory");
  await expect(frozen).toContainText("platform/chart/apps/1");
  await expect(frozen).toContainText("apps-2.0.0-900.tgz");
  await page.getByRole("button", { name: "Environments", exact: true }).click();
  await page
    .locator(".environment-card")
    .filter({ hasText: "Root" })
    .getByRole("button", { name: "Select release" })
    .click();
  const form = page.getByRole("region", { name: "Platform release request" });
  await expect(
    form.getByRole("combobox", { name: "Qualified source build" }),
  ).toBeVisible();
  await expect(form).not.toContainText("Rollback");
  await expect(
    form.getByRole("button", { name: "Request exact operation" }),
  ).toBeDisabled();
});
