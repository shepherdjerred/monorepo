import { expect, type Page } from "@playwright/test";

function appUrl(page: Page): URL {
  return new URL(page.url());
}

function requiredSecret(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required for beta Scout design checks`);
  }
  return value;
}

export async function signInForAudit(
  page: Page,
  returnTo = "/app/",
): Promise<void> {
  const url = appUrl(page);

  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    const discordId =
      process.env["SCOUT_DESIGN_AUDIT_DISCORD_ID"] ?? "000000000000000001";
    const login = new URL("/api/dev/login", url.origin);
    login.searchParams.set("discordId", discordId);
    login.searchParams.set("returnTo", returnTo);
    await page.goto(login.toString(), { waitUntil: "domcontentloaded" });
  } else {
    const login = new URL("/app/login", url.origin);
    login.searchParams.set("returnTo", returnTo);
    await page.goto(login.toString(), {
      waitUntil: "domcontentloaded",
    });
    const loginLink = page.getByRole("link", { name: /discord/i });
    await expect(
      loginLink,
      "beta login must expose Discord OAuth",
    ).toBeVisible();
    await loginLink.click();
    await expect(page).toHaveURL(/discord\.com/);
    await page
      .getByLabel(/email/i)
      .fill(requiredSecret("SCOUT_DESIGN_AUDIT_DISCORD_EMAIL"));
    await page
      .getByLabel(/password/i)
      .fill(requiredSecret("SCOUT_DESIGN_AUDIT_DISCORD_PASSWORD"));
    await page.getByRole("button", { name: /log in|login/i }).click();
    const oneTimeCode = process.env["SCOUT_DESIGN_AUDIT_DISCORD_TOTP"];
    if (oneTimeCode !== undefined && oneTimeCode.length > 0) {
      const code = page.getByLabel(/authenticator|verification|code/i);
      if (await code.isVisible()) {
        await code.fill(oneTimeCode);
        await page
          .getByRole("button", { name: /submit|verify|continue/i })
          .click();
      }
    }
    const authorize = page.getByRole("button", { name: /authorize|allow/i });
    if (
      (await authorize.count()) > 0 &&
      (await authorize.first().isVisible())
    ) {
      await authorize.first().click();
    }
    await page.waitForURL(
      (candidate) =>
        candidate.origin === url.origin &&
        candidate.pathname.startsWith("/app"),
    );
  }

  // Assert where we landed, not merely where we did not. `not.toHaveURL(/login/)`
  // also passes while sitting on `/api/dev/login` itself, which is exactly what
  // happened when the backend was unreachable: the proxy returned 502, the
  // browser never followed a redirect, and this guard waved it through.
  await expect(page, "dev login must land on the app").toHaveURL(/\/app(\/|$)/);

  // Assert the login response established the browser session without issuing
  // a second request on Playwright's separate API connection. The protected
  // target route then independently proves the backend accepts this cookie;
  // duplicating its session query introduced an ECONNRESET race under the
  // three-worker audit load.
  const cookies = await page.context().cookies(url.origin);
  expect(
    cookies.some(
      (cookie) => cookie.name === "scout_session" && cookie.value.length > 0,
    ),
    "design audit login must establish a session cookie",
  ).toBe(true);
}
