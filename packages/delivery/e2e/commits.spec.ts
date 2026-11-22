import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.ts";
import {
  ACCEPTED_POSITION,
  CARRIED_FAILURE_POSITION,
  CARRIER_POSITION,
  FAILED_POSITION,
  PARTIAL_FAILURE_POSITION,
  PARTIAL_FAILURE_REASON,
  QUEUED_POSITION,
  UNRELEASED_POSITION,
  historySha,
} from "./commits.ts";

async function openCommit(page: Page, position: number) {
  const sha = historySha(position);
  await page.goto(`/commits/${sha}`);
  await expect(
    page.getByRole("heading", { level: 1, name: `Commit ${sha.slice(0, 7)}` }),
  ).toBeVisible();
  return page.getByRole("main");
}

test("a commit says deploying only while a deployment that carries it is in flight", async ({
  page,
}) => {
  // Birmel prod has the next release queued: that commit is on its way.
  const queued = await openCommit(page, QUEUED_POSITION);
  await expect(queued.locator(".page-header")).toContainText("Deploying");
  const service = page.getByRole("region", { name: /^By service/u });
  await expect(
    service.getByRole("link", { name: "deploying prod" }),
  ).toHaveAttribute("href", "/deployments/birmel-queued");

  // Nothing was asked for the newest one: it waits on a manual release, and
  // the page names the environment and why instead of saying "deploying".
  const unreleased = await openCommit(page, UNRELEASED_POSITION);
  await expect(unreleased.locator(".page-header")).toContainText(
    "Not released",
  );
  await expect(unreleased.locator(".page-header")).not.toContainText(
    "Deploying",
  );
  await expect(unreleased).toContainText(
    "Birmel prod needs a manual promotion or release; nothing is in flight.",
  );
  await expect(
    service.getByRole("link", { name: "needs manual release prod" }),
  ).toHaveAttribute("href", "/environments/birmel/prod");

  // The accepted one is live.
  const accepted = await openCommit(page, ACCEPTED_POSITION);
  await expect(accepted.locator(".page-header")).toContainText(
    "Its 1 changed service is live.",
  );
  await expectNoHorizontalOverflow(page);
});

test("the list row names the environment that is blocking it", async ({
  page,
}) => {
  const unreleased = await findRow(page, UNRELEASED_POSITION);
  await expect(unreleased).toContainText("Not released");
  await expect(unreleased).toContainText("Birmel / prod: needs manual release");
  await expect(unreleased).not.toContainText("Deploying");
  await expectNoHorizontalOverflow(page);
  await expect(await findRow(page, QUEUED_POSITION)).toContainText(
    "Birmel / prod: deploying",
  );
  await expect(await findRow(page, PARTIAL_FAILURE_POSITION)).toContainText(
    "CI failed for 1 service",
  );
});

/** The list row of a history commit, following "Older" until its page. */
async function findRow(page: Page, position: number) {
  await page.goto("/commits");
  const recent = page.getByRole("region", { name: "Recent commits" });
  await expect(recent.getByRole("listitem").first()).toBeVisible();
  const row = recent.getByRole("listitem").filter({
    has: page.getByRole("link", {
      name: new RegExp(`^${historySha(position).slice(0, 7)}`, "u"),
    }),
  });
  const older = recent
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: "Older" });
  const first = recent.getByRole("listitem").first();
  while ((await row.count()) === 0 && (await older.count()) > 0) {
    const url = page.url();
    const shown = await first.textContent();
    await older.click();
    await expect(page).not.toHaveURL(url);
    // The URL moves before the older page renders; wait for its rows, or the
    // next turn reads the previous page and clicks an "Older" that goes away.
    await expect(first).not.toHaveText(shown ?? "");
  }
  await expect(row).toHaveCount(1);
  return row;
}

test("a commit whose CI failed for one service says its other change is live through newer commits", async ({
  page,
}) => {
  const main = await openCommit(page, PARTIAL_FAILURE_POSITION);
  const header = main.locator(".page-header");
  await expect(header).toContainText("CI failed");
  await expect(header).toContainText(
    "CI failed for 1 service, so Delivery published nothing for it. Its 1 changed service is live because newer commits include it.",
  );
  await expect(header).not.toContainText(
    "nothing from this commit was published",
  );
  // A plain sentence comes before the raw reason Delivery recorded.
  const failed = page.getByRole("region", { name: "CI failed" });
  await expect(failed.locator("p").first()).toHaveText(
    "These services' builds failed CI or qualification, so Delivery published nothing from them. Each line quotes the reason Delivery recorded.",
  );
  await expect(failed).toContainText(PARTIAL_FAILURE_REASON);
  // Its Birmel release ran in prod, then a newer release of a new lineage
  // replaced it; that release still carries the change.
  const service = page.getByRole("region", { name: /^By service/u });
  await expect(
    service.getByRole("link", { name: "live (newer) prod" }),
  ).toBeVisible();
  await expect(service).not.toContainText("replaced");
  await expectNoHorizontalOverflow(page);
});

test("a commit whose failed CI a newer passing commit includes says where its change shipped", async ({
  page,
}) => {
  const carrier = historySha(FAILED_POSITION + 1).slice(0, 7);
  // The next commit kept Birmel's image and composed nothing; the first
  // later release, the accepted one, is what carries the change to prod.
  const release = historySha(ACCEPTED_POSITION).slice(0, 7);
  const row = await findRow(page, FAILED_POSITION);
  await expect(row.locator(".status").first()).toHaveText(/Deployed/u);
  await expect(row).toContainText(
    `Not built on its own; included in ${carrier}, which passed`,
  );
  await expect(row).not.toContainText("CI failed");

  const main = await openCommit(page, FAILED_POSITION);
  const header = main.locator(".page-header");
  await expect(header).toContainText(
    `CI failed for 1 service here, so it was not built on its own; included in ${carrier}, which passed.`,
  );
  const service = page.getByRole("region", { name: /^By service/u });
  await expect(service.getByRole("link", { name: release })).toBeVisible();
  await expect(service.getByRole("link", { name: "live prod" })).toBeVisible();
  await expect(header).not.toContainText(
    "nothing from this commit was published",
  );
  await expect(page.getByRole("region", { name: "CI failed" })).toHaveCount(0);
  const included = page.getByRole("region", {
    name: "Included in a newer commit",
  });
  await expect(included).toContainText("birmel");
  await included.getByRole("link", { name: carrier }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: `Commit ${carrier}` }),
  ).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("a carried CI failure does not outrank what actually blocks the commit", async ({
  page,
}) => {
  const carrier = historySha(CARRIER_POSITION).slice(0, 7);
  const main = await openCommit(page, CARRIED_FAILURE_POSITION);
  const header = main.locator(".page-header");
  await expect(header.locator(".status").first()).toHaveText(/Not released/u);
  await expect(header).toContainText(
    `CI failed for 1 service here, so it was not built on its own; included in ${carrier}, which passed.`,
  );
  await expect(header).toContainText(
    "Birmel prod needs a manual promotion or release; nothing is in flight.",
  );
  const row = await findRow(page, CARRIED_FAILURE_POSITION);
  await expect(row.locator(".status").first()).toHaveText(/Not released/u);
  await expect(row).toContainText("Birmel / prod: needs manual release");
});

test("the commit list lines its columns up and explains each environment tally", async ({
  page,
}) => {
  await page.goto("/commits");
  const recent = page.getByRole("region", { name: "Recent commits" });
  await expect(recent.getByRole("listitem").first()).toBeVisible();
  const lefts = (selector: string) =>
    recent
      .locator(`.commit-row > ${selector}`)
      .evaluateAll((nodes) =>
        nodes.map((node) => Math.round(node.getBoundingClientRect().left)),
      );
  const rights = await recent
    .locator(".commit-row > .commit-meta")
    .evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().right)),
    );
  for (const column of [
    await lefts(".status"),
    await lefts(".commit-subject"),
    await lefts(".commit-detail"),
    rights,
  ])
    expect(new Set(column).size).toBe(1);

  const accepted = await findRow(page, ACCEPTED_POSITION);
  await expect(accepted.locator(".tallies")).toContainText("prod 1/1 live");
  await expect(
    accepted.getByText("prod: 1 of 1 changed service live"),
  ).toBeAttached();
  await expectNoHorizontalOverflow(page);
});

test("a commit that changed nothing counts its other services in good grammar", async ({
  page,
}) => {
  const main = await openCommit(page, ACCEPTED_POSITION + 1);
  await expect(main).toContainText(
    "1 other service built with nothing to deploy.",
  );
});

test("find a commit trims a pasted sha and explains one that is not a sha", async ({
  page,
}) => {
  await page.goto("/commits");
  const search = page.getByRole("search", { name: "Find a commit" });
  const field = search.getByLabel("Commit SHA");
  await field.fill("not a sha");
  await search.getByRole("button", { name: "Find" }).click();
  await expect(page).toHaveURL(/\/commits$/u);
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(search).toContainText(
    "That is not a commit SHA. Paste 7 to 40 hex digits of a commit, such as 0f18e58.",
  );
  const sha = historySha(ACCEPTED_POSITION).slice(0, 7);
  await field.fill(`  ${sha.toUpperCase()} `);
  await search.getByRole("button", { name: "Find" }).click();
  await expect(page).toHaveURL(new RegExp(`/commits/${sha}$`, "u"));
  await expect(
    page.getByRole("heading", { level: 1, name: `Commit ${sha}` }),
  ).toBeVisible();
});
