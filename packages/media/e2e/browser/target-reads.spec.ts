import { expect } from "@playwright/test";
import { ROUTES } from "./routes.ts";
import { open, test, watchForFailures } from "./support.ts";

const SINGLE_READ = /^\/api\/v2\/media\/[^/]+\/targets\/default$/u;
const BATCH_READ = "/api/v2/targets/default";

/** The list pages whose rows each need their title's default-target view. */
const LISTS = [
  { label: "member /requests", rows: 15 },
  // A member is not shown a title another member asked for once it is
  // quarantined, so the fixture lists seven of its eight removals.
  { label: "member /removals", rows: 7 },
] as const;

for (const list of LISTS) {
  test(`${list.label} reads every row's target in one request`, async ({
    page,
    baseURL,
  }) => {
    const route = ROUTES.find((candidate) => candidate.label === list.label);
    if (baseURL === undefined || route === undefined) {
      throw new Error(`${list.label} is not a route this suite can open`);
    }
    const failures = watchForFailures(page, new URL(baseURL).origin);
    const reads: string[] = [];
    page.on("request", (request) => {
      const { pathname } = new URL(request.url());
      if (pathname === BATCH_READ || SINGLE_READ.test(pathname)) {
        reads.push(pathname === BATCH_READ ? "batch" : "single");
      }
    });
    await page.clock.install();
    await open(page, route, baseURL);

    // Every row has its controls, so every row's view arrived.
    const rows = page.locator(".item-list > .request-row");
    await expect(rows).toHaveCount(list.rows);
    await expect(rows.locator(".action-control button").first()).toBeVisible();
    await expect(page.getByText(/Loading (?:request )?controls…/u)).toHaveCount(
      0,
    );
    expect(reads).toEqual(["batch"]);

    // The 15-second refresh is one more batch, never a read per row.
    await page.clock.fastForward(16_000);
    await page.waitForLoadState("networkidle");
    expect(reads).toEqual(["batch", "batch"]);
    expect(failures).toEqual([]);
  });
}
