import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInForAudit } from "#src/auth.ts";
import { themes } from "#src/constants.ts";
import { assertInteractiveStates } from "#src/interactive-checks.ts";
import { assertKeyboardFocus } from "#src/keyboard-checks.ts";
import { auditCaseTags } from "#src/matrix.ts";
import {
  assertLayoutHealth,
  assertRenderedContrast,
  preparePageForScreenshot,
  waitForStablePage,
} from "#src/page-checks.ts";
import { auditRoutes, routeBaseUrl, type AuditRoute } from "#src/routes.ts";

function routeUrl(route: AuditRoute): string {
  return new URL(route.path, routeBaseUrl(route.surface)).toString();
}

function isExpectedNavigationFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized === "canceled" ||
    normalized === "cancelled" ||
    normalized === "load request cancelled" ||
    normalized === "request was cancelled" ||
    normalized === "net::err_aborted"
  );
}

for (const theme of themes) {
  for (const route of auditRoutes()) {
    test(
      `${route.surface}/${route.name} · ${theme.name}`,
      { tag: auditCaseTags(route, theme) },
      async ({ browserName, page }, testInfo) => {
        const targetUrl = routeUrl(route);
        const browserErrors: string[] = [];
        await page.addInitScript((preference) => {
          localStorage.setItem(
            "scout-theme-v1",
            JSON.stringify({
              version: 1,
              skin: preference.skin,
              mode: preference.mode,
            }),
          );
        }, theme);

        if (route.authenticated) {
          const discordId =
            Bun.env["SCOUT_DESIGN_AUDIT_DISCORD_ID"] ?? "000000000000000001";
          await page.addInitScript((seededDiscordId) => {
            // Keep the deliberate incomplete-onboarding banner while avoiding
            // GuildPicker's first-visit redirect into the setup wizard.
            localStorage.setItem(
              `scout_onboarding_seen_${seededDiscordId}`,
              "true",
            );
          }, discordId);
          const baseUrl = routeBaseUrl("app");
          await page.goto(new URL("/app/login", baseUrl).toString(), {
            waitUntil: "domcontentloaded",
          });
          // Establish the session on a neutral route. The audited target then
          // loads exactly once, after the scoped error listeners are active.
          await signInForAudit(page, "/app/login");
          // Authentication renders the app shell, whose background queries can
          // still be in flight when the audit leaves the neutral route. Move to
          // an inert document before listening so setup cancellations cannot be
          // mistaken for failures in the route under test.
          await page.goto("about:blank");
        }

        page.on("pageerror", (error) => {
          browserErrors.push(error.message);
        });
        page.on("console", (message) => {
          if (message.type() === "error") {
            browserErrors.push(message.text());
          }
        });
        page.on("requestfailed", (request) => {
          const failure = request.failure()?.errorText;
          // A route transition or query replacement can deliberately abort an
          // in-flight fetch. Keep the exception at the request transport
          // boundary: console errors, page exceptions, HTTP failures, and all
          // other request failures remain actionable.
          if (failure !== undefined && isExpectedNavigationFailure(failure))
            return;
          if (request.url().startsWith(new URL(routeUrl(route)).origin)) {
            browserErrors.push(
              `${request.method()} ${request.url()}: ${failure ?? "failed"}`,
            );
          }
        });
        page.on("response", (response) => {
          if (
            response.status() >= 400 &&
            response.url().startsWith(new URL(routeUrl(route)).origin)
          ) {
            browserErrors.push(
              `${response.status().toString()} ${response.url()}`,
            );
          }
        });

        // Load the target only after the scoped health listeners exist so its
        // complete initial request, response, console, and page-error surface
        // is audited without canceling an earlier copy of the same route.
        await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        await waitForStablePage(page);
        await expect(page.locator("html")).toHaveAttribute(
          "data-scout-skin",
          theme.skin,
        );
        await expect(page.locator("html")).toHaveAttribute(
          "data-scout-mode",
          theme.mode,
        );

        if (route.authenticated) {
          await expect(page).not.toHaveURL(/\/app\/login/);
        }
        await assertLayoutHealth(page);
        await assertRenderedContrast(page);
        // WebKit models Safari's default keyboard navigation: plain Tab skips
        // links, while Option+Tab traverses every focusable control.
        await assertKeyboardFocus(
          page,
          browserName === "webkit" ? "Alt+Tab" : "Tab",
        );
        await assertInteractiveStates(page);
        const accessibility = await new AxeBuilder({ page })
          .exclude("astro-dev-toolbar")
          .exclude(".iPadShowKeyboard")
          .analyze();
        expect(
          accessibility.violations.map(
            (violation) =>
              `${violation.id}:${violation.impact ?? "unknown"}:${String(violation.nodes.length)}:${violation.nodes
                .map((node) => node.target.join(" > "))
                .join("|")}`,
          ),
          "axe accessibility violations",
        ).toEqual([]);
        expect(browserErrors, "same-origin browser errors").toEqual([]);

        if (route.golden && testInfo.project.name.startsWith("chromium-")) {
          if (route.surface === "docs" && route.name === "first-report") {
            // The tutorial contains an animated GIF. Preserve its layout while
            // keeping screenshot goldens independent of the captured GIF frame.
            await page.locator('img[src$=".gif"]').evaluateAll((images) => {
              for (const image of images) {
                if (image instanceof HTMLImageElement) {
                  image.style.visibility = "hidden";
                }
              }
            });
          }
          await preparePageForScreenshot(page);
          await expect(page).toHaveScreenshot(
            `${route.name}-${theme.name}.png`,
            {
              fullPage: true,
              animations: "disabled",
            },
          );
        }
      },
    );
  }
}
