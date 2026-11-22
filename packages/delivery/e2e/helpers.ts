import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";
import { DeploymentSchema } from "#shared/contract.ts";
import {
  DeploymentPageSchema,
  EnvironmentDetailSchema,
} from "#shared/hub/hub-contract.ts";

/** Open the newest matching deployment of an environment by its deep link. */
export async function openDeployment(
  page: Page,
  environmentId: string,
  match: { kind?: string; status?: string } = {},
) {
  const response = await page.request.get(
    `/api/v1/deployments?environmentId=${encodeURIComponent(environmentId)}`,
  );
  expect(response.status()).toBe(200);
  const deployments = DeploymentPageSchema.parse(await response.json()).items;
  const selected = deployments.find(
    (deployment) =>
      (match.kind === undefined || deployment.kind === match.kind) &&
      (match.status === undefined || deployment.status === match.status),
  );
  if (selected === undefined)
    throw new Error(`No ${environmentId} deployment matches the fixture`);
  await page.goto(`/deployments/${selected.id}`);
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: `Deployment to ${environmentId}`,
    }),
  ).toBeVisible();
  return selected.id;
}

/**
 * Accept the open native confirmation dialog. Every confirm button asks
 * through the page's one dialog element, so the open one is the only one.
 */
export async function confirm(page: Page, label: string) {
  await expect(page.locator("dialog")).toHaveCount(1);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/**
 * The page is no wider than the device. A phone grows its layout viewport,
 * and so `innerWidth`, to fit content that overflows, so the content is
 * measured against the document's own client width.
 */
export async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(() => {
      const root = globalThis.document.documentElement;
      return root.scrollWidth <= root.clientWidth;
    }),
  ).toBe(true);
}

/** Read one validated API response through the browser's authenticated proxy. */
export async function api<T>(
  page: Page,
  path: string,
  schema: { parse: (value: unknown) => T },
) {
  const response = await page.request.get(path);
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  return schema.parse(body);
}

/**
 * Request a deploy of Arcade production's newest version set through the
 * API, as another client would while a page is open. Returns the deployment
 * and a `cancel` that requests its cancellation.
 */
export async function requestArcadeDeployment(
  page: Page,
  baseURL: string | undefined,
) {
  const detail = await api(
    page,
    "/api/v1/environments/arcade%2Fprod",
    EnvironmentDetailSchema,
  );
  const version = detail.versionSets[0];
  if (version === undefined) throw new Error("Arcade version fixture required");
  if (baseURL === undefined) throw new Error("Playwright baseURL required");
  const headers = { Origin: baseURL };
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
  return {
    deployment,
    cancel: async () => {
      const canceled = await page.request.post(
        `/api/v1/deployments/${deployment.id}/cancel`,
        { headers },
      );
      expect(canceled.status()).toBe(200);
    },
  };
}

/** Open a page once it has loaded and require no WCAG 2.2 AA violation. */
export async function expectAccessible(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.locator("[role=status]", { hasText: "Loading" }),
  ).toHaveCount(0);
  await expectNoViolations(page, path);
}

/**
 * Require no WCAG 2.2 AA violation in the page as it now stands, such as with
 * a disclosure expanded or a dialog open; `path` names the state in a failure.
 */
export async function expectNoViolations(page: Page, path: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    results.violations.map((violation) => ({
      path,
      id: violation.id,
      nodes: violation.nodes.map((node) => node.target.join(" ")),
    })),
  ).toEqual([]);
}

/**
 * Open every collapsed disclosure, then require that nothing inside any
 * overview tile reaches past the tile's right edge: a long status pill wraps
 * in its chip instead of spilling out of the card.
 */
export async function expectContainedInTiles(page: Page) {
  await page.evaluate(() => {
    for (const details of globalThis.document.querySelectorAll<HTMLDetailsElement>(
      "main details",
    ))
      details.open = true;
  });
  const escapes = await page.evaluate(() => {
    const found: string[] = [];
    for (const tile of globalThis.document.querySelectorAll(".overview-tile")) {
      if (!tile.checkVisibility()) continue;
      const edge = tile.getBoundingClientRect().right;
      for (const element of tile.querySelectorAll("*")) {
        const box = element.getBoundingClientRect();
        // The words a glyph already says are clipped to one pixel, by design.
        if (box.width > 1 && box.right > edge + 0.5)
          found.push(
            `${tile.querySelector("a")?.textContent ?? "tile"}: ${element.textContent}`,
          );
      }
    }
    return found;
  });
  expect(escapes).toEqual([]);
}

/** Whether the page has a phone's width, where tables stack and the nav wraps. */
export function isPhone(page: Page) {
  return (page.viewportSize()?.width ?? 0) < 600;
}

/**
 * A record table at phone width: each row a stacked block under its labels,
 * nothing scrolling sideways, and every short id on one line.
 */
export async function expectStackedTable(region: Locator) {
  const table = region.locator(".stack-table").first();
  await expect(table.locator("thead")).toBeHidden();
  await expect(
    table.locator("tbody tr").first().locator("td[data-label='Requested']"),
  ).toBeVisible();
  expect(
    await table.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  for (const id of await table.locator(".identifier").all()) {
    const box = await id.boundingBox();
    if (box !== null) expect(box.height).toBeLessThan(24);
  }
}
