import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { signInForAudit } from "#src/auth.ts";
import { themes } from "#src/constants.ts";
import {
  assertKeyboardFocus,
  assertInteractiveStates,
  assertLayoutHealth,
  assertRenderedContrast,
  waitForStablePage,
} from "#src/page-checks.ts";
import { auditRoutes, routeBaseUrl, type AuditRoute } from "#src/routes.ts";

function routeUrl(route: AuditRoute): string {
  return new URL(route.path, routeBaseUrl(route.surface)).toString();
}

for (const theme of themes) {
  for (const route of auditRoutes()) {
    test(`${route.surface}/${route.name} · ${theme.name}`, async ({
      page,
    }, testInfo) => {
      const browserErrors: string[] = [];
      page.on("pageerror", (error) => browserErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") browserErrors.push(message.text());
      });
      page.on("requestfailed", (request) => {
        if (request.failure()?.errorText === "net::ERR_ABORTED") return;
        if (request.url().startsWith(new URL(routeUrl(route)).origin)) {
          browserErrors.push(
            `${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "failed"}`,
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
        const baseUrl = routeBaseUrl("app");
        await page.goto(new URL("/app/login", baseUrl).toString(), {
          waitUntil: "domcontentloaded",
        });
        await signInForAudit(page);
      }

      await page.goto(routeUrl(route), { waitUntil: "domcontentloaded" });
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
      await assertKeyboardFocus(page);
      await assertInteractiveStates(page);
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(
        accessibility.violations.map(
          (violation) =>
            `${violation.id}:${violation.impact ?? "unknown"}:${String(violation.nodes.length)}`,
        ),
        "axe accessibility violations",
      ).toEqual([]);
      expect(browserErrors, "same-origin browser errors").toEqual([]);

      if (route.golden && testInfo.project.name.startsWith("chromium-")) {
        await expect(page).toHaveScreenshot(`${route.name}-${theme.name}.png`, {
          fullPage: true,
          animations: "disabled",
        });
      }
    });
  }
}
