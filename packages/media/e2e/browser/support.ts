import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type { Persona } from "#testing/fixture-api/personas.ts";
import { PERSONA_COOKIE } from "#testing/fixture-api/server.ts";
import type { RouteCase } from "./routes.ts";

const POLICY_TAG = "content-security-policy:";

/**
 * Every Content-Security-Policy violation any page of the context reports,
 * as `directive blocked what`, plus the browser's own console errors about
 * the policy. The harness sends the production policy
 * (`src/server/static/security-headers.ts`), so this is what a browser would
 * refuse on the real site. A blocked `eval` is reported as an event only,
 * never on the console, so the event is what counts.
 */
async function watchPolicyViolations(
  context: BrowserContext,
): Promise<string[]> {
  const violations: string[] = [];
  await context.addInitScript((tag) => {
    globalThis.document.addEventListener("securitypolicyviolation", (event) => {
      console.error(
        `${tag} ${event.effectiveDirective} blocked ${event.blockedURI}`,
      );
    });
  }, POLICY_TAG);
  context.on("console", (message) => {
    const text = message.text();
    if (text.startsWith(POLICY_TAG)) {
      violations.push(text.slice(POLICY_TAG.length + 1));
    } else if (
      message.type() === "error" &&
      text.includes("Content Security Policy")
    ) {
      violations.push(`console: ${text}`);
    }
  });
  return violations;
}

/**
 * The suite's `test`: every test, whatever it does, also fails when a page
 * it opened violated the Content-Security-Policy. A test that provokes a
 * violation on purpose empties `policyViolations` before it ends.
 */
export const test = base.extend<{ policyViolations: string[] }>({
  policyViolations: [
    async ({ context }, use) => {
      const violations = await watchPolicyViolations(context);
      await use(violations);
      // One trip to each page, so a report still on its way has arrived.
      for (const page of context.pages()) {
        await page.evaluate(
          async () =>
            new Promise((resolve) => {
              globalThis.setTimeout(resolve, 0);
            }),
        );
      }
      expect(violations, "Content-Security-Policy violations").toEqual([]);
    },
    { auto: true },
  ],
});

/** Opens `path` as a persona and waits for the shell to hold a page. */
export async function openAs(page: Page, persona: Persona, path: string) {
  const origin = test.info().project.use.baseURL;
  if (origin === undefined) {
    throw new Error("The Playwright project has no baseURL");
  }
  await page
    .context()
    .addCookies([{ name: PERSONA_COOKIE, value: persona, url: origin }]);
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

/**
 * Everything a page can do wrong without failing an assertion on its text.
 * Content-Security-Policy violations are watched for every test, by the
 * suite's own `test` above.
 */
export function watchForFailures(page: Page, origin: string): string[] {
  const failures: string[] = [];
  // The client is self-contained: fonts, styles, and scripts all come from
  // its own origin.
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith("http") && url.origin !== origin) {
      failures.push(`third-party request: ${request.url()}`);
    }
  });
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

/** Sign in as the route's persona and wait until the page has settled. */
export async function open(page: Page, route: RouteCase, origin: string) {
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

/** The computed background of the page canvas, as the browser serializes it. */
export async function canvasColor(page: Page): Promise<string> {
  return page
    .locator("html")
    .evaluate((root) => globalThis.getComputedStyle(root).backgroundColor);
}

/** `#rrggbb` as the `rgb(r, g, b)` string a computed style reports. */
export function computedForm(hex: string): string {
  const channels = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/iu.exec(hex);
  if (channels === null) throw new Error(`Not a six-digit hex color: ${hex}`);
  return `rgb(${channels
    .slice(1)
    .map((channel) => String(Number.parseInt(channel, 16)))
    .join(", ")})`;
}

/**
 * The WCAG 2.2 AA violations on the page as it stands: each rule that failed
 * and, as `rule: selectors`, where to look.
 */
export async function accessibilityViolations(
  page: Page,
): Promise<{ rule: string; detail: string }[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map((violation) => ({
    rule: violation.id,
    detail: `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`,
  }));
}

/** Those violations as `rule: selectors`; empty when the page is clean. */
export async function violationDetails(page: Page): Promise<string[]> {
  const found = await accessibilityViolations(page);
  return found.map((violation) => violation.detail);
}
