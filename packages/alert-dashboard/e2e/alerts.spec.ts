import { expect, test } from "@playwright/test";

test("serves Berkeley Mono as a font instead of the SPA fallback", async ({
  request,
}) => {
  const response = await request.get("/fonts/BerkeleyMono-Regular.woff2");
  const bytes = await response.body();

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("font/woff2");
  expect(String.fromCodePoint(...bytes.subarray(0, 4))).toBe("wOF2");
});

test("URL-backed filters survive navigation, history, and reload", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Active alerts · Alerts");
  await expect(page.getByRole("link", { name: /DiskFull/u })).toBeVisible();
  await page.getByLabel("Severity").selectOption("critical");
  await expect(page).toHaveURL(/severity=critical/u);
  await expect(page.getByText("No alerts match these filters.")).toBeVisible();
  await page.getByRole("link", { name: "History" }).click();
  await expect(page).toHaveTitle("History · Alerts");
  await page.goBack();
  await expect(page).toHaveURL(/severity=critical/u);
  await page.reload();
  await expect(page.getByLabel("Severity")).toHaveValue("critical");
});

test("search input follows browser history", async ({ page }) => {
  await page.goto("/?q=DiskFull");
  const search = page.getByPlaceholder("Search name, summary, fingerprint…");
  await expect(search).toHaveValue("DiskFull");

  await search.fill("first query");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=first\+query/u);
  await expect(search).toHaveValue("first query");

  await search.fill("second query");
  await search.press("Enter");
  await expect(page).toHaveURL(/q=second\+query/u);

  await page.goBack();
  await expect(page).toHaveURL(/q=first\+query/u);
  await expect(search).toHaveValue("first query");

  await page.goForward();
  await expect(page).toHaveURL(/q=second\+query/u);
  await expect(search).toHaveValue("second query");
});

test("bookmarked history leads to delivery evidence and independent preview states", async ({
  page,
}) => {
  await page.goto(
    "/history?type=opened&severity=warning&from=2026-08-08T00%3A00%3A00Z",
  );
  await expect(page.getByLabel("Event")).toHaveValue("opened");
  await expect(page.getByLabel("From")).toHaveValue("2026-08-08T00:00:00Z");
  await page.getByRole("link", { name: "DiskFull" }).click();
  await expect(page).toHaveTitle("DiskFull · Alerts");
  await expect(
    page.getByRole("heading", { name: "Webhook evidence" }),
  ).toBeVisible();
  await expect(page.getByText(/raw retained/u)).toBeVisible();
  await page.getByRole("button", { name: "Load more evidence" }).click();
  const evidence = page.locator("section.panel").filter({
    has: page.getByRole("heading", { name: "Webhook evidence" }),
  });
  await expect(evidence.locator(".timeline article")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: "Load more evidence" }),
  ).not.toBeVisible();
  await expect(page.getByRole("heading", { name: "Prometheus" })).toBeVisible();
  await expect(page.getByText("Loki fixture unavailable")).toBeVisible();
  await expect(page.getByText("No valid trace ID metadata")).toBeVisible();
});

test("malformed alert bookmarks render a not-found state", async ({ page }) => {
  await page.goto("/alerts/foo");

  await expect(page).toHaveTitle("Alert not found · Alerts");
  await expect(page.getByText("Alert not found.")).toBeVisible();
});

test("malformed dashboard bookmarks render a filter error", async ({
  page,
}) => {
  await page.goto("/?state=typo");

  await expect(page).toHaveTitle("Active alerts · Alerts");
  await expect(page.getByText("Invalid active alert filters.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /ResolvedFixture/u }),
  ).not.toBeVisible();
});

test("history date filters retain partial input until blur", async ({
  page,
}) => {
  await page.goto("/history");
  const from = page.getByLabel("From");

  await from.fill("2");
  await expect(page).toHaveURL("/history");
  await expect(page.getByText("Invalid history filters.")).not.toBeVisible();

  await from.blur();
  await expect(page).toHaveURL(/from=2/u);
  await expect(page.getByText("Invalid history filters.")).toBeVisible();

  await from.fill("2026-08-08T00:00:00Z");
  await from.blur();
  await expect(page).toHaveURL(/from=2026-08-08T00%3A00%3A00Z/u);
  await expect(page.getByText("Invalid history filters.")).not.toBeVisible();
});

test("history exposes every cursor page", async ({ page }) => {
  await page.goto("/history?alertname=PaginationFixture");
  await expect(page.locator(".timeline article")).toHaveCount(100);

  await page.getByRole("button", { name: "Load older events" }).click();

  await expect(page.locator(".timeline article")).toHaveCount(101);
  await expect(
    page.getByRole("button", { name: "Load older events" }),
  ).not.toBeVisible();
});

test("dashboard exposes every cursor page", async ({ page }) => {
  await page.goto("/?q=PaginationFixture");
  await expect(page.locator("table tbody tr")).toHaveCount(100);

  await page.getByRole("button", { name: "Load more alerts" }).click();

  await expect(page.locator("table tbody tr")).toHaveCount(101);
  await expect(
    page.getByRole("button", { name: "Load more alerts" }),
  ).not.toBeVisible();
});

test("semantic navigation is keyboard reachable and responsive", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Alerts" })).toBeFocused();
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }),
  ).toBeVisible();
  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  const tableBox = await table.boundingBox();
  if (tableBox === null)
    throw new Error("Responsive alert table has no bounds");
  expect(tableBox.width).toBeLessThanOrEqual(362);
  await expect(table.locator('td[data-label="Last seen"]')).toBeVisible();
  await page.getByRole("link", { name: "System" }).click();
  await expect(page).toHaveTitle("System · Alerts");
  await expect(page.getByRole("heading", { name: "Database" })).toBeVisible();
  await expect(
    page.getByRole("definition").filter({ hasText: "disabled" }),
  ).toBeVisible();
});

test("a failed refresh keeps the alerts on screen behind a stale notice", async ({
  page,
}) => {
  // The degraded state is the one this app gained when it moved to `Loaded`:
  // before, any query error replaced the dashboard, discarding alerts an
  // operator could still act on. Load once so the cache is warm, then fail
  // every subsequent tRPC call and refresh.
  await page.goto("/");
  await expect(page.getByRole("link", { name: /DiskFull/u })).toBeVisible();
  await expect(page.getByRole("status")).toBeHidden();

  await page.route("**/trpc/**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify([
        { error: { message: "upstream unavailable", code: -32_603 } },
      ]),
    });
  });

  await page.getByRole("button", { name: "Refresh alerts" }).click();

  await expect(
    page.getByText(
      "Showing the last known data — the most recent refresh failed.",
    ),
  ).toBeVisible();
  // The point of `degraded`: the data is still there.
  await expect(page.getByRole("link", { name: /DiskFull/u })).toBeVisible();
  await expect(page.getByText("Could not load alerts.")).toBeHidden();
});
