import { readdir } from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import { PERSONA_COOKIE } from "#testing/fixture-api/server.ts";
import { openAs, test } from "./support.ts";

/**
 * The Content-Security-Policy, on the built client. Every other test in this
 * suite also fails on a violation (`support.ts`); these cover what no route
 * fixture reaches: the headers themselves, the sign-in page, and the two
 * places the client hands the browser to another site.
 */

const DIST = path.resolve(import.meta.dir, "../../dist");
const PLEX = "https://app.plex.tv/auth#?clientID=fixture&code=fixture";
const DISCORD = "https://discord.com/oauth2/authorize?client_id=fixture";
const ELSEWHERE = "<!doctype html><title>Elsewhere</title>";

function origin(): string {
  const base = test.info().project.use.baseURL;
  if (base === undefined)
    throw new Error("The Playwright project has no baseURL");
  return base;
}

test("the shell, an asset, and the API carry one enforced policy", async ({
  request,
}) => {
  const files = await readdir(path.join(DIST, "assets"));
  const script = files.find((file) => file.endsWith(".js"));
  if (script === undefined) throw new Error("The build emitted no script");
  const policies = [];
  for (const route of ["/library", `/assets/${script}`, "/api/v1/me"]) {
    const response = await request.get(route);
    expect(response.status(), route).toBe(200);
    policies.push(response.headers()["content-security-policy"]);
  }
  const [shell] = policies;
  expect(shell).toContain("default-src 'none'");
  expect(shell).toContain("script-src 'self'");
  expect(policies).toEqual([shell, shell, shell]);
});

test("the built shell has nothing inline, and the stylesheet no data URL", async () => {
  const shell = await Bun.file(path.join(DIST, "index.html")).text();
  const scripts = shell.match(/<script\b[^>]*>/gu) ?? [];
  expect(scripts).not.toEqual([]);
  for (const script of scripts) expect(script).toMatch(/\ssrc="\/assets\//u);
  expect(shell).not.toMatch(/<style\b/u);
  expect(shell).not.toMatch(/\s(?:style|on[a-z]+)=/u);
  expect(shell).not.toMatch(/<base\b/u);

  const files = await readdir(path.join(DIST, "assets"));
  for (const sheet of files.filter((file) => file.endsWith(".css"))) {
    const css = await Bun.file(path.join(DIST, "assets", sheet)).text();
    expect(css, sheet).not.toContain("data:");
  }
});

// The violation check lives in the suite's own `test`; a spec that took
// Playwright's instead would run without it.
test("every spec in this suite runs under the violation check", async () => {
  const files = await readdir(import.meta.dir);
  const specs = files.filter((file) => file.endsWith(".spec.ts"));
  expect(specs).toContain("policy.spec.ts");
  for (const spec of specs) {
    const source = await Bun.file(path.join(import.meta.dir, spec)).text();
    expect(source, spec).toMatch(
      /import \{[^}]*\btest\b[^}]*\} from "\.\/support\.ts";/u,
    );
    expect(source, spec).not.toMatch(
      /import \{[^}]*\btest\b[^}]*\} from "@playwright\/test";/u,
    );
  }
});

// Proves the policy is enforced and that this suite would notice: without
// this, a harness that stopped sending the header would pass every test.
test("the browser refuses injected content, and the suite sees each refusal", async ({
  page,
  policyViolations,
}) => {
  await openAs(page, "member", "/library");
  const heading = page.getByRole("heading", { level: 1, name: "Library" });
  expect(policyViolations).toEqual([]);

  await page.locator("body").evaluate((body) => {
    const owner = body.ownerDocument;
    const script = owner.createElement("script");
    script.textContent = "document.title = 'injected'";
    const style = owner.createElement("style");
    style.textContent = "#root { display: none }";
    const image = owner.createElement("img");
    image.src = "https://media-policy.invalid/poster.png";
    owner.head.append(script, style);
    body.append(image);
    body.setAttribute("style", "display: none");
  });
  await expect
    .poll(() =>
      policyViolations
        .filter((violation) => !violation.startsWith("console: "))
        .sort((left, right) => left.localeCompare(right)),
    )
    .toEqual([
      "img-src blocked https://media-policy.invalid/poster.png",
      "script-src-elem blocked inline",
      "style-src-attr blocked inline",
      "style-src-elem blocked inline",
    ]);
  // Chrome also says so on the console, once per refusal.
  expect(
    policyViolations.filter((violation) => violation.startsWith("console: ")),
  ).toHaveLength(4);
  await expect(heading).toBeVisible();
  await expect(page).toHaveTitle("Library · Media");
  policyViolations.length = 0;
});

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("the sign-in page renders, and Plex opens in its own tab", async ({
      page,
    }) => {
      // The fixture API always has someone signed in; these are the answers
      // a signed-out browser gets.
      await page.route("**/api/v1/me", async (route) =>
        route.fulfill({
          status: 401,
          json: { error: { code: "unauthorized", message: "Sign in" } },
        }),
      );
      await page.route("**/api/v1/auth/plex/start", async (route) =>
        route.fulfill({
          json: {
            id: "fixture",
            authorizationUrl: PLEX,
            expiresAt: "2099-01-01T00:00:00.000Z",
          },
        }),
      );
      await page.route("**/api/v1/auth/plex/poll/*", async (route) =>
        route.fulfill({ json: { status: "pending" } }),
      );
      await page
        .context()
        .route("https://app.plex.tv/**", async (route) =>
          route.fulfill({ contentType: "text/html", body: ELSEWHERE }),
        );

      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        "Your next watch.",
      );
      await page.getByRole("button", { name: "Sign in with Plex" }).click();
      const opened = page.waitForEvent("popup");
      await page.getByRole("link", { name: "Continue to Plex" }).click();
      const plex = await opened;
      await plex.waitForLoadState();
      expect(plex.url()).toBe(PLEX);
      await expect(page.getByRole("status")).toContainText(
        "Finish signing in in the Plex tab.",
      );
    });
  });
}

test("linking Discord leaves for Discord's own page", async ({ page }) => {
  await page.context().addCookies([
    { name: PERSONA_COOKIE, value: "member", url: origin() },
    { name: "media-csrf", value: "fixture", url: origin() },
  ]);
  // The fixture API refuses writes; this is the one the link needs.
  await page.route("**/api/v1/notifications/discord/start", async (route) =>
    route.fulfill({ json: { authorizationUrl: DISCORD } }),
  );
  await page
    .context()
    .route("https://discord.com/**", async (route) =>
      route.fulfill({ contentType: "text/html", body: ELSEWHERE }),
    );

  await page.goto("/notifications/settings");
  await page.getByRole("button", { name: "Link Discord" }).click();
  await page.waitForURL(DISCORD);
  await expect(page).toHaveTitle("Elsewhere");
});
