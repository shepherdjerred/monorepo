import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { PERSONA_COOKIE } from "#testing/fixture-api/server.ts";
import { KNOWN_VIOLATIONS } from "./axe-baseline.ts";
import { ROUTES, type RouteCase } from "./routes.ts";

/** Everything a page can do wrong without failing an assertion on its text. */
function watchForFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      failures.push(`console error: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    failures.push(`uncaught error: ${error.message}`);
  });
  page.on("response", (response) => {
    const { pathname } = new URL(response.url());
    if (pathname.startsWith("/api/") && response.status() >= 400) {
      failures.push(`HTTP ${String(response.status())} from ${pathname}`);
    }
  });
  return failures;
}

async function open(page: Page, route: RouteCase, origin: string) {
  await page
    .context()
    .addCookies([{ name: PERSONA_COOKIE, value: route.persona, url: origin }]);
  await page.goto(route.path);
  await expect(
    page.getByRole("heading", { level: 1, name: route.heading, exact: true }),
  ).toBeVisible();
  // Secondary panels load after the heading; wait for all of them.
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("status").filter({ hasText: "Loading" }),
  ).toHaveCount(0);
}

function knownRules(route: RouteCase): string[] {
  return KNOWN_VIOLATIONS.filter((known) => known.routes.includes(route.label))
    .map((known) => known.rule)
    .sort((left, right) => left.localeCompare(right));
}

test("the axe baseline names only routes this suite visits", () => {
  const labels = ROUTES.map((route) => route.label);
  expect(new Set(labels).size).toBe(labels.length);
  for (const known of KNOWN_VIOLATIONS) {
    expect(new Set(known.routes).size, known.rule).toBe(known.routes.length);
    expect(
      known.routes.filter((label) => !labels.includes(label)),
      known.rule,
    ).toEqual([]);
  }
});

for (const route of ROUTES) {
  test(`${route.label} renders its fixtures`, async ({ page, baseURL }) => {
    if (baseURL === undefined) {
      throw new Error("The Playwright project has no baseURL");
    }
    const failures = watchForFailures(page);
    await open(page, route, baseURL);

    // The shared error notice, by its class: `role="alert"` alone also
    // matches product copy such as a bounced-email warning on a notification.
    await expect(page.locator(".notice-error")).toHaveCount(0);
    expect(failures).toEqual([]);

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    const found = results.violations
      .map((violation) => violation.id)
      .sort((left, right) => left.localeCompare(right));
    // On a mismatch, the selectors say where to look.
    const detail = results.violations
      .map(
        (violation) =>
          `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
      )
      .join("\n");
    expect(found, detail).toEqual(knownRules(route));
  });
}
