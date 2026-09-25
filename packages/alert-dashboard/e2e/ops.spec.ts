import { expect, test } from "@playwright/test";

test("overview ranks attention, lists what waits on me, and marks all seen", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Overview · Ops");
  const banner = page.getByRole("region", { name: "Overall status" });
  await expect(banner).toContainText("7 areas need attention");
  await expect(banner).toContainText("Error");

  const attention = page.locator("section", {
    has: page.getByRole("heading", { name: /Needs attention/u }),
  });
  await expect(attention.locator(".signal").first()).toContainText(
    "Velero backup is 41 hours old",
  );
  const waiting = page.locator("section", {
    has: page.getByRole("heading", { name: /Waiting on you/u }),
  });
  await expect(waiting.locator(".signal")).toHaveCount(4);
  await expect(
    page.getByRole("region", { name: "Areas" }).locator(".section-card"),
  ).toHaveCount(9);

  const fresh = page.locator("section", {
    has: page.getByRole("heading", { name: /New since last visit/u }),
  });
  await expect(fresh.locator(".signal").first()).toBeVisible();
  await page.getByRole("button", { name: "Mark all seen" }).click();
  await expect(fresh).toContainText("Nothing new since you last marked");
  await page.reload();
  await expect(fresh).toContainText("Nothing new since you last marked");
});

test("service detail joins signals, the change timeline, and drill-down links", async ({
  page,
}) => {
  await page.goto("/services/scout-for-lol");
  await expect(page).toHaveTitle("scout-for-lol · Ops");
  await expect(
    page.getByRole("heading", { name: "Scout for LoL", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("scout-beta is OutOfSync")).toBeVisible();
  const timeline = page.locator("section", {
    has: page.getByRole("heading", { name: "What changed" }),
  });
  await expect(timeline).toContainText("scout-beta synced to 8f3c2d1");
  await expect(timeline).toContainText(
    "Resolved: scout-beta worker restarted repeatedly",
  );
  const logs = page.getByRole("link", { name: "Logs" });
  await expect(logs).toHaveAttribute(
    "href",
    /^https:\/\/grafana\.tailnet-1a49\.ts\.net\/explore\?/u,
  );
  await page.goto("/services/not-a-service");
  await expect(page.getByText("No service")).toBeVisible();
});

test("AI page shows quota windows, spend against budget, and charts", async ({
  page,
}) => {
  await page.goto("/ai?range=24h");
  await expect(page).toHaveTitle("AI · Ops");
  await expect(page.getByRole("meter")).toHaveCount(5);
  await expect(
    page.getByRole("meter", { name: "claude 7d quota used" }),
  ).toHaveAttribute("aria-valuenow", "84");
  await expect(page.getByText("$86.40")).toBeVisible();
  await expect(page.getByText(/Projected month end \$112\.10/u)).toBeVisible();
  const costChart = page.locator("figure", {
    has: page.getByRole("heading", { name: "AI cost by source" }),
  });
  await expect(costChart.locator("canvas")).toBeVisible();
  await expect(costChart.getByRole("img")).toHaveAttribute(
    "aria-label",
    /claude-code/u,
  );
  await page.getByRole("radio", { name: "7d" }).click();
  await expect(page).toHaveURL(/range=7d/u);
});

test("the ops layout fits a phone without horizontal scrolling", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ["/", "/services/scout-for-lol", "/ai", "/review"]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    const overflow = await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth - globalThis.innerWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});
