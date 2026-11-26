import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./helpers.ts";
import {
  ACCEPTED_POSITION,
  CARRIED_FAILURE_POSITION,
  CARRIER_POSITION,
  FAILED_POSITION,
  PARTIAL_FAILURE_POSITION,
  PARTIAL_FAILURE_REASON,
  PIPELINE_CARRIER_POSITION,
  PIPELINE_FAILURE_POSITION,
  QUEUED_POSITION,
  STORED_PIPELINE_AUTHOR,
  STORED_PIPELINE_TITLE,
  UNCAPTURED_POSITION,
  UNRELEASED_POSITION,
  historyPipeline,
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

test("a commit says deploying only once a deployment that carries it is claimed, and queued before", async ({
  page,
}) => {
  // Birmel prod has the next release queued: that commit is on its way, but
  // no executor has claimed the deployment, as the Overview also says.
  const queued = await openCommit(page, QUEUED_POSITION);
  await expect(queued.locator(".page-header")).toContainText("Queued");
  await expect(queued.locator(".page-header")).not.toContainText("Deploying");
  const service = page.getByRole("region", { name: /^By service/u });
  await expect(
    service.getByRole("link", { name: "queued prod" }),
  ).toHaveAttribute("href", "/deployments/birmel-queued");

  // Nothing was asked for the newest one: it waits on a manual release, and
  // the pill and the page name that instead of saying "deploying" or "not
  // released", since a release of it exists.
  const unreleased = await openCommit(page, UNRELEASED_POSITION);
  const header = unreleased.locator(".page-header");
  await expect(header.locator(".status").first()).toHaveText(
    /Needs manual release/u,
  );
  await expect(header).not.toContainText("Not released");
  await expect(header).not.toContainText("Deploying");
  await expect(header).toContainText(
    "The changed service needs a manual release: Birmel prod.",
  );
  await expect(
    service.getByRole("link", { name: "needs manual release prod" }),
  ).toHaveAttribute("href", "/environments/birmel/prod");

  // By environment reads as a heading, one sentence and a row per service,
  // not a run of glyphs and labels.
  const byEnvironment = page.getByRole("region", { name: "prod" });
  await expect(byEnvironment.getByRole("heading", { level: 3 })).toHaveText(
    "prod",
  );
  await expect(byEnvironment.locator(".env-group-summary")).toContainText(
    "0 of 1 service live.",
  );
  await expect(
    byEnvironment.getByRole("link", {
      name: "Birmel: needs manual release",
    }),
  ).toHaveAttribute("href", "/environments/birmel/prod");

  // The accepted one is live.
  const accepted = await openCommit(page, ACCEPTED_POSITION);
  await expect(accepted.locator(".page-header")).toContainText(
    "The changed service is live.",
  );
  await expectNoHorizontalOverflow(page);
});

test("the list row names the environment that is blocking it", async ({
  page,
}) => {
  const unreleased = await findRow(page, UNRELEASED_POSITION);
  await expect(unreleased.locator(".status").first()).toHaveText(
    /Needs manual release/u,
  );
  await expect(unreleased).toContainText("Birmel / prod: needs manual release");
  await expect(unreleased).not.toContainText("Deploying");
  await expectNoHorizontalOverflow(page);
  await expect(await findRow(page, QUEUED_POSITION)).toContainText(
    "Birmel / prod: queued",
  );
  // The service whose CI failed is named, not counted.
  await expect(await findRow(page, PARTIAL_FAILURE_POSITION)).toContainText(
    "CI failed for Arcade",
  );
});

test("a commit Delivery never captured a title for says so and offers Woodpecker's stored pipeline instead of a blank", async ({
  page,
}) => {
  const main = await openCommit(page, UNCAPTURED_POSITION);
  const header = main.locator(".page-header");
  await expect(header).toContainText(
    "Title and author were not captured for this commit.",
  );
  await expect(header).toContainText(
    `Woodpecker pipeline #${String(historyPipeline(UNCAPTURED_POSITION))} has the title "${STORED_PIPELINE_TITLE}" and the author ${STORED_PIPELINE_AUTHOR}.`,
  );
  // A recorded commit shows its own title and author and no such note.
  const recorded = await openCommit(page, ACCEPTED_POSITION);
  await expect(recorded.locator(".page-header")).not.toContainText(
    "not captured",
  );
  await expect(recorded.locator(".page-header .commit-title")).toBeVisible();
  await page.goto(`/commits/${historySha(UNCAPTURED_POSITION)}`);
  await expectNoHorizontalOverflow(page);
});

test("the commit list says how many commits it shows", async ({ page }) => {
  await page.goto("/commits");
  const recent = page.getByRole("region", { name: "Recent commits" });
  await expect(recent.getByRole("status")).toHaveText(
    "Showing the 25 newest commits. Older ones are on the next page.",
  );
  await recent
    .getByRole("navigation", { name: "Pages" })
    .getByRole("link", { name: "Older" })
    .click();
  await expect(recent.getByRole("status")).toContainText(
    "older than the previous page",
  );
});

test("a commit whose whole pipeline failed stands where the next passing commit's release stands", async ({
  page,
}) => {
  const carrier = historySha(PIPELINE_CARRIER_POSITION).slice(0, 7);
  const main = await openCommit(page, PIPELINE_FAILURE_POSITION);
  const header = main.locator(".page-header");
  // Its change ships in the carrier's Birmel release, which waits on a
  // manual release: never "not released" while that release carries it.
  await expect(header.locator(".status").first()).toHaveText(
    /Needs manual release/u,
  );
  await expect(header).toContainText(
    `The changed service needs a manual release: Birmel prod. Not built on its own; included in ${carrier} (whose build of CI (Woodpecker) passed).`,
  );
  const service = page.getByRole("region", { name: /^By service/u });
  await expect(service.getByRole("rowheader")).toHaveCount(1);
  await expect(service.getByRole("rowheader")).toContainText("Birmel");
  await expect(service.getByRole("link", { name: carrier })).toBeVisible();
  await expect(service).not.toContainText("CI (Woodpecker)");
  await expect(service).not.toContainText("No newer release carries it yet");
  // The failed build names its service and links its CI run.
  const included = page.getByRole("region", {
    name: "Included in a newer commit",
  });
  await expect(
    included.getByRole("link", { name: "CI (Woodpecker)" }),
  ).toBeVisible();
  const pipeline = String(historyPipeline(PIPELINE_FAILURE_POSITION));
  await expect(
    included.getByRole("link", { name: `Woodpecker #${pipeline}` }),
  ).toHaveAttribute(
    "href",
    `https://woodpecker.sjer.red/repos/1/pipeline/${pipeline}`,
  );

  // The list row says the same thing in the same words.
  const row = await findRow(page, PIPELINE_FAILURE_POSITION);
  await expect(row.locator(".status").first()).toHaveText(
    /Needs manual release/u,
  );
  await expect(row).toContainText(
    `Not built on its own; included in ${carrier} (whose build of CI (Woodpecker) passed)`,
  );
  await expect(row).toContainText("Birmel / prod: needs manual release");
  await expectNoHorizontalOverflow(page);
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
    "CI failed for Arcade, so Delivery published nothing for it. The changed service is live because newer commits include it.",
  );
  await expect(header).not.toContainText(
    "nothing from this commit was published",
  );
  // A plain sentence comes before the raw reason Delivery recorded, and the
  // build is named by its service with a link to the run that failed.
  const failed = page.getByRole("region", { name: "CI failed" });
  await expect(failed.locator("p").first()).toHaveText(
    "These services' builds failed CI or qualification, so Delivery published nothing from them. Each line quotes the reason Delivery recorded.",
  );
  await expect(failed).toContainText(PARTIAL_FAILURE_REASON);
  await expect(failed.getByRole("link", { name: "Arcade" })).toBeVisible();
  const pipeline = String(historyPipeline(PARTIAL_FAILURE_POSITION));
  await expect(
    failed.getByRole("link", { name: `Woodpecker #${pipeline}` }),
  ).toHaveAttribute(
    "href",
    `https://woodpecker.sjer.red/repos/1/pipeline/${pipeline}`,
  );
  // Its Birmel release ran in prod, then a newer release of a new lineage
  // replaced it; that release still carries the change.
  const service = page.getByRole("region", { name: /^By service/u });
  // The row names its own release and says so: superseded by the accepted
  // release, which is deployed, never the service's plain "Deployed".
  await expect(
    service.getByRole("link", {
      name: /^superseded by r\d+, which is deployed prod$/u,
    }),
  ).toBeVisible();
  await expect(service.locator("tbody tr").first()).toContainText("Superseded");
  await expect(service.locator("tbody tr").first()).not.toContainText(
    "Deployed",
  );
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
    `Not built on its own; included in ${carrier} (whose build of Birmel passed)`,
  );
  await expect(row).not.toContainText("CI failed");

  const main = await openCommit(page, FAILED_POSITION);
  const header = main.locator(".page-header");
  await expect(header).toContainText(
    `Not built on its own; included in ${carrier} (whose build of Birmel passed).`,
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
  await expect(included).toContainText("Birmel");
  // Nothing else was built on this commit: the whole commit was carried.
  await expect(included).toContainText(
    "CI failed for Birmel on this commit, so it was not built on its own.",
  );
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
  await expect(header.locator(".status").first()).toHaveText(
    /Needs manual release/u,
  );
  // The real blocker leads; the carried failure follows.
  await expect(header).toContainText(
    `The changed service needs a manual release: Birmel prod. Built on its own for 2 services (1 changed); 1 service (Golink) was built by a later commit: included in ${carrier} (whose build of Golink passed).`,
  );
  // The detail section names only the service CI failed for and agrees with
  // the header: the commit built Birmel itself.
  const included = page.getByRole("region", {
    name: "Included in a newer commit",
  });
  await expect(included).toContainText(
    "CI failed for Golink on this commit, so it was built by a later commit.",
  );
  await expect(included).not.toContainText("not built on its own");
  // Golink has no environment, so its carried failure adds no row.
  const service = page.getByRole("region", { name: /^By service/u });
  await expect(service).not.toContainText("Golink");
  const row = await findRow(page, CARRIED_FAILURE_POSITION);
  await expect(row.locator(".status").first()).toHaveText(
    /Needs manual release/u,
  );
  await expect(row).toContainText("Birmel / prod: needs manual release");
  // Only Golink went through the carrier; the row says what the commit built itself.
  await expect(row).toContainText(
    `Built on its own for 2 services (1 changed); 1 service (Golink) was built by a later commit: included in ${carrier} (whose build of Golink passed)`,
  );
  await expect(row).not.toContainText("Not built on its own");
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
