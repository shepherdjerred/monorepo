import { expect, type Page } from "@playwright/test";
import { z } from "zod";

/**
 * The tRPC HTTP envelope for `auth.sessionState`. Parsed rather than cast so a
 * shape change surfaces here instead of silently reading `undefined` and
 * passing the not-null assertion below.
 */
const SessionStateSchema = z.object({
  result: z.object({
    data: z.object({
      user: z.object({ discordId: z.string() }).loose().nullable(),
    }),
  }),
});

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

export async function signInForAudit(page: Page): Promise<void> {
  const url = appUrl(page);

  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    const discordId =
      process.env["SCOUT_DESIGN_AUDIT_DISCORD_ID"] ?? "000000000000000001";
    const login = new URL("/api/dev/login", url.origin);
    login.searchParams.set("discordId", discordId);
    login.searchParams.set("returnTo", "/app/");
    await page.goto(login.toString(), { waitUntil: "domcontentloaded" });
  } else {
    await page.goto(new URL("/app/login", url.origin).toString(), {
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

  const sessionState = await page.request.get(
    new URL("/trpc/auth.sessionState", url.origin).toString(),
  );
  expect(
    sessionState.status(),
    "design audit session probe did not reach the backend",
  ).toBe(200);

  // `auth.sessionState` is a public query: it answers `{ user: null }` with HTTP
  // 200 for anonymous callers, so a status check alone proves only that the
  // backend is up. The session itself is the body.
  const sessionBody: unknown = await sessionState.json();
  const signedInUser = SessionStateSchema.parse(sessionBody).result.data.user;
  expect(
    signedInUser,
    "design audit login did not create a valid session",
  ).not.toBeNull();
}
