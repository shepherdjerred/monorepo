import { expect, test } from "@playwright/test";
import {
  HubGridSchema,
  ServicePipelineSchema,
} from "#shared/hub/hub-contract.ts";
import { api, expectNoHorizontalOverflow } from "./helpers.ts";

test("activity rows show a clock reading, plain actions and where each entity belongs", async ({
  page,
}) => {
  await page.goto("/activity?action=deployment.");
  const entries = page.locator("ol.activity > li");
  await expect(entries.first()).toBeVisible();
  // Every row says when to the second in sight, not only in a title.
  await expect(entries.first().locator(".activity-when .clock")).toHaveText(
    /\d{2}:\d{2}:\d{2}/u,
  );
  // A deployment entry names its environment by the overview's name and its release.
  const named = entries.filter({ has: page.locator(".activity-where") });
  await expect(named.first()).toBeVisible();
  await expect(named.first().locator(".activity-where")).toContainText(/r\d+/u);
  await expect(page.locator(".activity-action").first()).toHaveAttribute(
    "title",
    /^deployment\./u,
  );
  await expectNoHorizontalOverflow(page);
});

test("activity filters to problems and a time range through the URL", async ({
  page,
}) => {
  await page.goto("/activity");
  const form = page.getByRole("search", { name: "Filter activity" });
  await form.getByLabel("Show").selectOption("only");
  await form.getByLabel("Time range").selectOption("day");
  await form.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/[?&]problems=only/u);
  await expect(page).toHaveURL(/[?&]within=day/u);
  const entries = page.locator("ol.activity > li");
  await expect(entries.first()).toBeVisible();
  // The unfiltered rows stay until the filtered page arrives, so wait for it.
  const problem =
    /(?:failed|recovery_required|rejected|incompatible|expired|alarmed)$/u;
  await expect
    .poll(async () => {
      const titles = await entries
        .locator(".activity-action")
        .evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute("title") ?? ""),
        );
      return titles.filter((title) => !problem.test(title));
    })
    .toEqual([]);
  // The form shows what the URL carries after a reload.
  await page.reload();
  await expect(form.getByLabel("Show")).toHaveValue("only");
  await expect(form.getByLabel("Time range")).toHaveValue("day");
});

test("a burst of commit records folds into one counted row", async ({
  page,
}) => {
  await page.goto("/activity?action=build.source_recorded");
  const folded = page
    .locator("ol.activity > li")
    .filter({ has: page.locator(".activity-count") });
  await expect(folded.first()).toBeVisible();
  await expect(folded.first().locator(".activity-action")).toContainText(
    /Commit recorded ×\d+/u,
  );
  await folded.first().locator("summary").click();
  await expect(
    folded.first().locator(".activity-repeated > li").first(),
  ).toBeVisible();
});

test("each environment stage says what runs and what is ready for it", async ({
  page,
}) => {
  const path = "/api/v1/services/scout-for-lol/pipeline";
  const pipeline = await api(page, path, ServicePipelineSchema);
  const prod = pipeline.stages.find(
    (stage) => stage.environmentId === "scout-for-lol/prod",
  );
  const running = prod?.accepted?.revision;
  if (running === undefined) throw new Error("Expected an accepted release");
  await page.goto("/pipelines/scout-for-lol");
  const stage = page.getByRole("region", { name: "prod", exact: true });
  await expect(stage.locator(".stage-standing")).toHaveText(
    `Running r${String(running)} · up to date`,
  );
  // A newer composed release waits for this approval-gated environment.
  await page.route(`**${path}`, async (route) => {
    const response = await route.fetch();
    const body = ServicePipelineSchema.parse(await response.json());
    for (const entry of body.stages)
      if (entry.kind === "version" && entry.execution !== null)
        entry.execution.revision = running + 20;
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  const ready = stage.getByRole("link", {
    name: `r${String(running + 20)} ready · needs approval`,
  });
  await expect(ready).toHaveAttribute(
    "href",
    "/environments/scout-for-lol/prod",
  );
  await expect(stage.locator(".stage-standing")).toContainText(
    `Running r${String(running)}`,
  );
  await expectNoHorizontalOverflow(page);
});

test("deployments and the environment page name an environment as the overview does", async ({
  page,
}) => {
  const grid = await api(page, "/api/v1/hub/grid", HubGridSchema);
  const scout = grid.groups
    .flatMap((group) => group.services)
    .find((service) => service.id === "scout-for-lol");
  if (scout === undefined) throw new Error("Expected Scout in the catalog");
  await page.goto("/deployments?environment=scout-for-lol%2Fprod");
  const name = page
    .getByRole("main")
    .locator("tbody tr th")
    .first()
    .locator(`span[title="scout-for-lol/prod"]`);
  await expect(name).toHaveText(`${scout.title} prod`);
  await page.goto("/environments/scout-for-lol/prod");
  // The heading keeps the slug; the eyebrow says what the overview calls it.
  await expect(
    page.getByRole("heading", { level: 1, name: "scout-for-lol/prod" }),
  ).toBeVisible();
  await expect(page.locator(".page-header .eyebrow")).toContainText(
    `${scout.title} · prod`,
  );
  // Argo's own revision is labelled as Argo's, apart from Delivery's r-numbers.
  const runtime = page.getByRole("region", { name: "Live runtime" });
  await expect(
    runtime.getByText("Argo revision", { exact: true }),
  ).toBeVisible();
  const state = page.getByRole("region", { name: "Release state" });
  await expect(
    state.getByRole("link", { name: /^r\d+$/u }).first(),
  ).toBeVisible();
});
