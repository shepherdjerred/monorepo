import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { DeploymentPageSchema } from "#shared/hub/hub-contract.ts";

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

/** Accept the open native confirmation dialog. */
export async function confirm(page: Page, label: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: label, exact: true }).click();
  await expect(dialog).toBeHidden();
}

export async function expectNoHorizontalOverflow(page: Page) {
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth <=
        globalThis.innerWidth,
    ),
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

/** Open a page once it has loaded and require no WCAG 2.2 AA violation. */
export async function expectAccessible(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.locator("[role=status]", { hasText: "Loading" }),
  ).toHaveCount(0);
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
