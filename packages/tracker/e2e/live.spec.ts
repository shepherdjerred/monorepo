import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { createIssue, recordCalls, scratchTeam } from "./data-helpers.ts";

/** Someone else, in another browser, whom this tab has never seen. */
const peer = {
  key: "agent:live-peer",
  kind: "agent",
  name: "Live Peer",
  metadata: { harness: "playwright" },
};
const stream = "**/api/events/stream";

/** The presence indicator for this viewport: sidebar or mobile header. */
const indicator = (page: Page) =>
  page.locator(".live-indicator").filter({ visible: true });

/** A second browser session against the same server. */
async function otherSession(browser: Browser, info: TestInfo) {
  const { baseURL } = info.project.use;
  if (baseURL === undefined) {
    throw new Error("playwright.config.ts sets baseURL for every project");
  }
  return browser.newContext({ baseURL });
}

async function update(
  request: APIRequestContext,
  identifier: string,
  fields: { stateName?: string; title?: string },
) {
  const response = await request.post("/trpc/issues.update", {
    data: { actor: peer, identifier, ...fields },
  });
  expect(response.ok()).toBe(true);
}

/** `issues.byIdentifier` requests, batched or not, that asked for `identifier`. */
const detailFetches = (calls: string[], identifier: string) =>
  calls.filter(
    (call) =>
      call.split("?")[0]?.split(",").includes("issues.byIdentifier") === true &&
      call.includes(`"${identifier}"`),
  ).length;

test("another session's new issue joins the list without a reload", async ({
  page,
  browser,
}, info) => {
  await page.goto(`/issues?team=${scratchTeam}`);
  await expect(indicator(page)).toHaveText("Live");
  const other = await otherSession(browser, info);
  try {
    const identifier = await createIssue(other.request, {
      teamKey: scratchTeam,
      title: `Live arrival ${info.project.name} ${String(Date.now())}`,
    });
    const row = page.locator("li.issue-row", {
      has: page.locator(`[data-issue-row="${identifier}"]`),
    });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-fresh", "");
    // The mark is brief; a later change animates it.
    await expect(row).not.toHaveAttribute("data-fresh");
  } finally {
    await other.close();
  }
});

test("another session's edit reaches the open issue and names who made it", async ({
  page,
  browser,
  request,
}, info) => {
  const title = `Live edit ${info.project.name} ${String(Date.now())}`;
  const identifier = await createIssue(request, {
    teamKey: scratchTeam,
    title,
  });
  await page.goto(`/issues/${identifier}`);
  await expect(indicator(page)).toHaveText("Live");
  const other = await otherSession(browser, info);
  try {
    await update(other.request, identifier, { stateName: "In progress" });
    await expect(
      page.getByRole("combobox", { name: "Status", exact: true }),
    ).toHaveValue("In progress");
    await expect(page.locator(".remote-edit")).toHaveText(
      "Updated by Live Peer just now",
    );

    // A title being typed is not overwritten; the new one lands beneath it.
    const field = page.getByLabel("Issue title", { exact: true });
    await field.fill(`${title} (mine)`);
    await update(other.request, identifier, { title: `${title} (theirs)` });
    await expect(page.locator(".remote-edit")).toBeVisible();
    await expect(field).toHaveValue(`${title} (mine)`);
    await field.press("Escape");
    await expect(field).toHaveValue(`${title} (theirs)`);
  } finally {
    await other.close();
  }
});

test("this tab's own edit is not fetched again when the stream reports it", async ({
  page,
  browser,
  request,
}, info) => {
  const stamp = `${info.project.name} ${String(Date.now())}`;
  const mine = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Own edit ${stamp}`,
  });
  const marker = await createIssue(request, {
    teamKey: scratchTeam,
    title: `Marker ${stamp}`,
  });
  await page.goto(`/issues?team=${scratchTeam}&peek=${mine}`);
  const peek = page.getByRole("dialog");
  await expect(peek.getByLabel("Issue title", { exact: true })).toHaveValue(
    `Own edit ${stamp}`,
  );
  await expect(indicator(page)).toHaveText("Live");
  const calls = recordCalls(page);
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("issues.update") && response.status() === 200,
  );
  await peek.getByLabel("Status", { exact: true }).selectOption("Done");
  await saved;
  // The stream delivers in commit order, so once the later change to the
  // marker has landed, this tab has already received its own change.
  const other = await otherSession(browser, info);
  try {
    await update(other.request, marker, { title: `Marker moved ${stamp}` });
    await expect(page.locator(`[data-issue-row="${marker}"]`)).toContainText(
      `Marker moved ${stamp}`,
    );
  } finally {
    await other.close();
  }
  // One refetch after the save settled, and none for the stream's report.
  expect(detailFetches(calls, mine)).toBe(1);
  expect(detailFetches(calls, marker)).toBe(1);
});

test("a dropped stream shows Reconnecting… and recovers", async ({ page }) => {
  let served = false;
  await page.route(stream, async (route) => {
    if (served) {
      await route.abort();
      return;
    }
    served = true;
    // One short stream that ends at once, as when the server goes away.
    await route.fulfill({
      status: 200,
      headers: { "content-type": "text/event-stream" },
      body: 'retry: 300\nevent: resync\ndata: {"type":"resync"}\n\n',
    });
  });
  await page.goto("/issues");
  await expect(indicator(page)).toHaveText("Reconnecting…");
  await expect(page.getByRole("status")).toHaveText(
    "Live updates lost. Reconnecting…",
  );
  await page.unroute(stream);
  await expect(indicator(page)).toHaveText("Live");
  await expect(page.getByRole("status")).toHaveText("Live updates restored.");
});
