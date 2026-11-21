import type { Page } from "@playwright/test";
import { EnvironmentPageDetailSchema } from "#shared/hub/hub-contract.ts";
import { EnvironmentSelectionSchema } from "#shared/model/contract.ts";

const TERMINAL = new Set(["succeeded", "failed", "canceled"]);

/**
 * Show an environment page as if nothing were queued, running or awaiting
 * approval there, so a spec can exercise the requests an idle environment
 * offers. The harness keeps a waiting override in Arcade production for the
 * approval specs, and the page rightly refuses every request while it waits.
 * Only the page's read is changed; the server's state stays as seeded. The
 * returned function shows the server's state again.
 */
export async function showIdle(page: Page, environmentId: string) {
  const path = `/api/v1/environments/${encodeURIComponent(environmentId)}`;
  const matches = (url: URL) => url.pathname === path;
  await page.route(matches, async (route) => {
    const response = await route.fetch();
    const detail = EnvironmentPageDetailSchema.parse(await response.json());
    await route.fulfill({
      response,
      json: {
        ...detail,
        environment: { ...detail.environment, activeDeploymentId: null },
        deployments: detail.deployments.filter((deployment) =>
          TERMINAL.has(deployment.status),
        ),
      },
    });
  });
  return async () => {
    await page.unroute(matches);
  };
}

/**
 * Show an environment whose accepted selection already uses its declared
 * recipe and configuration, so nothing is left for a rebind or a promotion
 * of the accepted set revision to change. Only the page's read is changed.
 */
export async function showDeclaredBindingAccepted(
  page: Page,
  environmentId: string,
) {
  const path = `/api/v1/environments/${encodeURIComponent(environmentId)}/selection`;
  await page.route(
    (url) => url.pathname === path,
    async (route) => {
      const response = await route.fetch();
      const view = EnvironmentSelectionSchema.parse(await response.json());
      if (view.accepted === null)
        throw new Error(`${environmentId} has accepted a selection`);
      await route.fulfill({
        response,
        json: {
          ...view,
          declared: {
            ...view.declared,
            recipeRevisionId: view.accepted.recipeRevisionId,
            configurationRevisionId: view.accepted.configurationRevisionId,
          },
        },
      });
    },
  );
}

const deploymentsPath = (url: URL) => url.pathname === "/api/v1/deployments";

/** Answer the next deployment request with the server's refusal, as the API words it. */
export async function refuseDeploymentRequest(
  page: Page,
  status: number,
  error: { code: string; message: string },
) {
  let answered = false;
  await page.route(deploymentsPath, async (route) => {
    if (answered || route.request().method() !== "POST")
      return route.fallback();
    answered = true;
    return route.fulfill({
      status,
      json: { error: { ...error, requestId: "e2e-refusal" } },
    });
  });
}
