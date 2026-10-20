import { expect, test } from "@playwright/test";
import {
  EnvironmentDetailSchema,
  HubOverviewSchema,
} from "#shared/hub/hub-contract.ts";
import { DeploymentSchema } from "#shared/contract.ts";
import { api, expectNoHorizontalOverflow } from "./helpers.ts";

const ROUTES = [
  ["/pipelines", "Pipelines"],
  ["/pipelines/arcade", "Arcade"],
  ["/pipelines/arcade/executions", "Arcade"],
  ["/environments/arcade/prod", "arcade/prod"],
  ["/environments/gitops/tofu:openai", "gitops/tofu:openai"],
  ["/deployments", "Deployments"],
  ["/approvals", "Approvals"],
  ["/artifacts", "Artifacts"],
  ["/activity", "Activity"],
] as const;

test("every route deep-links to its own page and title", async ({ page }) => {
  for (const [path, title] of ROUTES) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: title, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle(`${title} · Delivery`);
    await expectNoHorizontalOverflow(page);
  }
  const hub = await api(page, "/api/v1/hub", HubOverviewSchema);
  const build = hub.services.find(
    (service) => service.id === "arcade",
  )?.latestBuild;
  if (build === null || build === undefined)
    throw new Error("Arcade build fixture required");
  await page.goto(`/builds/${build.id}`);
  await expect(
    page.getByRole("heading", { level: 1, name: /^Change / }),
  ).toBeVisible();
  await page.goto("/no/such/page");
  await expect(
    page.getByRole("heading", { level: 1, name: "Not found" }),
  ).toBeVisible();
});

test("the pipelines list is home and filters through the URL", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/pipelines$/u);
  const table = page.getByRole("table");
  await expect(
    table.getByRole("row").filter({
      has: page.getByRole("link", { name: "Arcade", exact: true }),
    }),
  ).toContainText("Execution #1");
  const filters = page.getByRole("search", { name: "Filter pipelines" });
  await filters.getByLabel("Name").fill("arcade");
  await filters.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/\/pipelines\?q=arcade$/u);
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/pipelines$/u);
  await expect(rows).not.toHaveCount(1);
});

test("links keep history: back and forward restore each page", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Arcade", exact: true }).click();
  await expect(page).toHaveURL(/\/pipelines\/arcade$/u);
  await expect(page.locator("#main-heading")).toBeFocused();
  await page
    .getByRole("navigation", { name: "Pipeline views" })
    .getByRole("link", { name: "Executions" })
    .click();
  await expect(page).toHaveURL(/\/pipelines\/arcade\/executions$/u);
  await expect(
    page.getByRole("heading", { level: 2, name: "Executions" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/pipelines\/arcade$/u);
  await expect(
    page.getByRole("region", { name: "Arcade pipeline" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveTitle("Pipelines · Delivery");
  await page.goForward();
  await expect(page).toHaveTitle("Arcade · Delivery");
});

test("links are real anchors that open in a new tab", async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name === "mobile", "Modifier clicks need a keyboard");
  await page.goto("/");
  const link = page.getByRole("link", { name: "Arcade", exact: true });
  await expect(link).toHaveAttribute("href", "/pipelines/arcade");
  const opened = context.waitForEvent("page");
  await link.click({ modifiers: ["ControlOrMeta"] });
  const tab = await opened;
  await tab.waitForLoadState();
  expect(new URL(tab.url()).pathname).toBe("/pipelines/arcade");
  await expect(page).toHaveURL(/\/pipelines$/u);
  await tab.close();
});

test("keyboard users reach content first and dialogs return focus", async ({
  page,
}, info) => {
  test.skip(info.project.name === "mobile", "Keyboard-only flow");
  await page.goto("/environments/scout-for-lol/prod");
  await expect(
    page.getByRole("region", { name: "Retained workers" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/u);
  const trigger = page
    .getByRole("region", { name: "Retained workers" })
    .getByRole("button", { name: "Request retirement" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Keep as is" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("committed changes appear live without a reload", async ({ page }) => {
  await page.goto("/deployments?environment=arcade%2Fprod");
  await expect(
    page.getByRole("status").filter({ hasText: "Live" }),
  ).toBeVisible();
  const rows = page.getByRole("main").getByRole("row");
  const before = await rows.count();
  const detail = await api(
    page,
    "/api/v1/environments/arcade%2Fprod",
    EnvironmentDetailSchema,
  );
  const version = detail.versionSets[0];
  if (version === undefined) throw new Error("Arcade version fixture required");
  const headers = { Origin: "http://127.0.0.1:17353" };
  const created = await page.request.post("/api/v1/deployments", {
    headers,
    data: {
      requestId: crypto.randomUUID(),
      environmentId: "arcade/prod",
      versionSetRevisionId: version.id,
      expectedGeneration: detail.environment.generation,
      kind: "deploy",
    },
  });
  expect(created.status()).toBe(201);
  const deployment = DeploymentSchema.parse(await created.json());
  await expect(rows).toHaveCount(before + (before === 0 ? 2 : 1));
  const canceled = await page.request.post(
    `/api/v1/deployments/${deployment.id}/cancel`,
    { headers },
  );
  expect(canceled.status()).toBe(200);
  await expect(
    page.locator(`tr:has(a[href="/deployments/${deployment.id}"])`),
  ).toContainText("canceled");
});
