import { approveAndCancel, expectReasonRequired } from "./approval.ts";
import { expect, test } from "@playwright/test";
import { ArgoRuntimeIntegrationSchema } from "#shared/hub/integration-contract.ts";
import {
  confirm,
  expectNoHorizontalOverflow,
  openDeployment,
} from "./helpers.ts";

test("live runtime explains a retained worker build beside the accepted digest", async ({
  page,
}) => {
  await page.goto("/environments/scout-for-lol/prod");
  const runtime = page.getByRole("region", { name: "Live runtime" });
  await expect(runtime).toContainText(
    "image:scout-for-lol runs the accepted digest · 1 retained worker build",
  );
  await expect(runtime.getByText("succeeded", { exact: true })).toBeVisible();
  await expect(runtime).toContainText("ArgoCD reconciled");
  const state = page.getByRole("region", { name: "Release state" });
  await expect(state).toContainText(
    "Observed when the last deployment finished",
  );
  await expect(state).not.toContainText("stale");
  await expectNoHorizontalOverflow(page);
});

test("live runtime names an image neither the accepted release nor a retained worker explains", async ({
  page,
}) => {
  const stray = `docker.io/shepherdjerred/scout-for-lol@sha256:${"9".repeat(64)}`;
  // A per-test UI fixture leaves the shared worker pool unchanged.
  await page.route("**/api/v1/environments/*/runtime", async (route) => {
    const response = await route.fetch();
    const runtime = ArgoRuntimeIntegrationSchema.parse(await response.json());
    if (runtime.state !== "available")
      throw new Error("Expected the ArgoCD double to answer");
    const [check] = runtime.data.imageChecks;
    if (check === undefined) throw new Error("Expected the worker image check");
    check.live.push(stray);
    check.unexpected.push(stray);
    check.matches = false;
    await route.fulfill({ response, json: runtime });
  });
  await page.goto("/environments/scout-for-lol/prod");
  const runtime = page.getByRole("region", { name: "Live runtime" });
  await expect(runtime).toContainText(
    "image:scout-for-lol runs the accepted digest · 1 unexpected image · 1 retained worker build",
  );
  await expect(runtime.getByText("failed", { exact: true })).toBeVisible();
  await expect(
    runtime.getByRole("list", {
      name: "image:scout-for-lol unexpected images",
    }),
  ).toContainText(stray);
  await expectNoHorizontalOverflow(page);
});

test("review exact retained worker retirement before production approval without stopping the host", async ({
  page,
  request,
}) => {
  await page.goto("/environments/scout-for-lol/prod");
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
  await confirm(page, "Confirm retirement request");
  await expect(page).toHaveURL(/\/deployments\/[\w-]+$/u);
  const detail = page.getByRole("main");
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
  await expectReasonRequired(page);
  await detail
    .getByRole("textbox", { name: "Reason" })
    .fill(
      "Reviewed exact retained artifact and fixed routing before executor drain proof",
    );
  await approveAndCancel(page);
});

test("host-only baseline review distinguishes routed worker identity from full-app provenance and acceptance", async ({
  page,
}) => {
  await openDeployment(page, "temporal/prod", { kind: "adopt-worker" });
  const detail = page.getByRole("main");
  await expect(
    detail.getByRole("region", { name: "Frozen worker pool" }),
  ).toContainText("Host-only baseline adoption");
  await expect(detail).toContainText(
    "It does not accept or change the full application release",
  );
  await expect(detail).toContainText("1".padEnd(40, "0"));
  await expect(detail).toContainText("3".padEnd(40, "0"));
  await expect(
    detail.getByRole("region", { name: "Frozen control-plane upgrade" }),
  ).toHaveCount(0);
  await expect(
    detail.getByRole("region", { name: "Frozen worker pool" }),
  ).toHaveCount(1);
  await page.goto("/environments/temporal/prod");
  await expect(
    page.getByRole("region", { name: "Release state" }),
  ).toContainText("Unknown");
});

test("upstream acquisition displays original verification without inventing a CI link", async ({
  page,
}) => {
  await page.goto("/artifacts?service=minecraft");
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
