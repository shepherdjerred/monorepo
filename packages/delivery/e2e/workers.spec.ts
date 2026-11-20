import { approveAndCancel, expectReasonRequired } from "./approval.ts";
import { expect, test, type Page } from "@playwright/test";
import { ArgoRuntimeIntegrationSchema } from "#shared/hub/integration-contract.ts";
import { WorkerPoolStateSchema } from "#shared/worker-contract.ts";
import {
  confirm,
  expectNoHorizontalOverflow,
  expectNoViolations,
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

test("a worker row shortens its identities and keeps the whole ones behind its host line", async ({
  page,
}) => {
  await page.goto("/environments/scout-for-lol/prod");
  const pool = page.getByRole("region", {
    name: "Retained workers",
    exact: true,
  });
  const retained = pool.getByRole("row").filter({ hasText: "1 · retained" });
  const build = "1".padEnd(40, "0");
  const image = `docker.io/shepherdjerred/scout-for-lol@sha256:${"1".padStart(64, "0")}`;
  // Short in sight, whole in the title and for assistive technology.
  await expect(retained.locator(`abbr[title="${build}"]`)).toBeVisible();
  await expect(
    retained.getByText(`${build.slice(0, 12)}…`, { exact: true }),
  ).toBeVisible();
  await expect(retained.getByText(image, { exact: true })).toBeHidden();
  await retained
    .locator("summary", { hasText: "scout-prod-workflows · prod / scout-prod" })
    .click();
  await expect(retained.getByText(image, { exact: true })).toBeVisible();
  await expect(
    retained.getByRole("definition").filter({ hasText: build }),
  ).toBeVisible();
  await expect(retained).toContainText("scout-prod/image/1");
  await expect(retained).toContainText(
    "prod / scout-prod-workflows / scout-prod",
  );
  await expectNoHorizontalOverflow(page);
});

/**
 * Add three retained artifacts with no desired host to the pool the page
 * reads. A per-test UI fixture leaves the shared worker pool unchanged.
 */
async function withRetainedArtifacts(page: Page) {
  await page.route("**/api/v1/environments/*/workers", async (route) => {
    const response = await route.fetch();
    const pool = WorkerPoolStateSchema.parse(await response.json());
    const [template] = pool.versions;
    if (template === undefined) throw new Error("Expected the seeded pool");
    for (const digit of ["c", "d", "e"]) {
      const digest = `sha256:${digit.repeat(64)}`;
      pool.versions.push({
        ...template,
        id: `${template.id}-${digit}`,
        buildId: digit.repeat(40),
        sourceRevision: digit.repeat(40),
        digest,
        image: `docker.io/shepherdjerred/scout-for-lol@${digest}`,
        replicas: 0,
      });
    }
    await route.fulfill({ response, json: pool });
  });
}

const ARTIFACTS = "Retained artifacts with no desired host";

for (const scheme of ["light", "dark"] as const) {
  test(`expanded worker rows and the retirement dialog meet WCAG 2.2 AA in ${scheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await withRetainedArtifacts(page);
    await page.goto("/environments/scout-for-lol/prod");
    const pool = page.getByRole("region", {
      name: "Retained workers",
      exact: true,
    });
    await pool.locator("summary", { hasText: ARTIFACTS }).click();
    for (const host of await pool
      .locator("summary", { hasText: "scout-prod-workflows" })
      .all())
      await host.click();
    await expect(
      pool.getByRole("term").filter({ hasText: "Image" }),
    ).toHaveCount(5);
    await expectNoViolations(page, "scout-for-lol/prod with worker rows open");
    await expectNoHorizontalOverflow(page);
    await pool.getByRole("button", { name: "Request retirement" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoViolations(page, "scout-for-lol/prod with its dialog open");
  });
}

test("retained artifacts with no desired host are collapsed behind their count", async ({
  page,
}) => {
  await withRetainedArtifacts(page);
  await page.goto("/environments/scout-for-lol/prod");
  const pool = page.getByRole("region", {
    name: "Retained workers",
    exact: true,
  });
  // The header and the two builds with a desired host.
  await expect(pool.getByRole("row")).toHaveCount(3);
  await expect(pool).toContainText("1 · selected");
  await expect(pool).toContainText("1 · retained");
  const unhosted = pool.getByText("Zero · artifact retained", { exact: true });
  await expect(unhosted).toHaveCount(3);
  await expect(unhosted.first()).toBeHidden();
  const artifacts = pool.locator("details", {
    has: page.locator("summary", { hasText: ARTIFACTS }),
  });
  await expect(artifacts).toHaveJSProperty("open", false);
  await expect(artifacts.locator("summary").first()).toHaveText(
    /^Retained artifacts with no desired host\s*3$/u,
  );
  await artifacts.locator("summary").first().click();
  for (const row of await unhosted.all()) await expect(row).toBeVisible();
  // Two tables now: each header, two hosted builds and three artifacts.
  await expect(pool.getByRole("row")).toHaveCount(7);
  // Only a build with a host can be retired, so the artifacts add no button.
  await expect(
    pool.getByRole("button", { name: "Request retirement", exact: true }),
  ).toHaveCount(1);
  await expect(page.locator("dialog")).toHaveCount(1);
  await expectNoHorizontalOverflow(page);
});

test("an open question closes without acting when its build leaves the pool", async ({
  page,
}) => {
  // A per-test UI fixture leaves the shared worker pool unchanged: the
  // retained build is gone from every read after the first.
  let reads = 0;
  await page.route("**/api/v1/environments/*/workers", async (route) => {
    const response = await route.fetch();
    const pool = WorkerPoolStateSchema.parse(await response.json());
    reads += 1;
    if (reads > 1)
      pool.versions = pool.versions.filter(
        (version) => version.buildId !== "1".padEnd(40, "0"),
      );
    await route.fulfill({ response, json: pool });
  });
  const retirements: string[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "POST") retirements.push(sent.url());
  });
  await page.clock.install();
  await page.goto("/environments/scout-for-lol/prod");
  const pool = page.getByRole("region", {
    name: "Retained workers",
    exact: true,
  });
  const retire = pool.getByRole("button", { name: "Request retirement" });
  await retire.click();
  const dialog = page.getByRole("dialog", { name: /^Retire build 1/u });
  await expect(dialog).toBeVisible();
  // The pool is read again once it is stale and the window regains focus.
  await page.clock.fastForward(20_000);
  await page.locator("html").dispatchEvent("visibilitychange");
  await expect(retire).toHaveCount(0);
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("dialog")).toHaveJSProperty("open", false);
  await expect(page.locator("dialog h2")).toHaveCount(0);
  expect(retirements).toEqual([]);
  await expect(pool).toContainText("1 · selected");
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
