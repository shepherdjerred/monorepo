import { afterAll, describe, expect, test, vi } from "vitest";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";
import { testAccountId } from "#src/testing/test-ids.ts";

/**
 * The bot-install endpoint must be gated by the same session cookie the
 * rest of the web app uses. An unauthenticated install would bounce a
 * user through Discord only to land on /app/login with the `guild_id`
 * deep-link silently dropped (the /app/installed landing route is gated
 * by RequireSession). So a missing/invalid session must short-circuit to
 * the login page instead, and only a valid session may proceed to
 * Discord's bot-authorize screen.
 */

/**
 * `handleDiscordInstall` (auth-web.ts) and `signSession`/`verifySession`
 * (jwt.ts) read `configuration.{applicationId, webAppOrigin,
 * jwtSigningSecret, discordClientSecret}` lazily at call time. The real
 * configuration module reads these from the environment behind memoized
 * getters, so we set the env and force a re-read rather than swapping in a
 * process-wide Bun module stub (which used to leak into and break sibling
 * S3 test files, since that mock was retroactive and never restored).
 *
 * `webAppOrigin` already defaults to this origin, `applicationId` is supplied
 * by the test preload, and `JWT_SIGNING_SECRET` is set by test-setup.ts — we
 * just pin the origin explicitly so the redirect assertions are stable.
 */
const TEST_APP_ORIGIN = "https://scout-for-lol.com";

Bun.env["WEB_APP_ORIGIN"] = TEST_APP_ORIGIN;
Bun.env["DISCORD_CLIENT_SECRET"] = "test-client-secret";
// The install handler now persists an attribution token, so the database
// singleton (initialized when auth-web.ts is first imported below) must point
// at a migrated test DB rather than test-setup's schemaless stub URL. Env,
// not a module stub, for the same leakage reason as the configuration note
// above; vitest isolates test files, so this cannot bleed into siblings.
const testDb = createTestDatabase("auth-web-test");
Bun.env["DATABASE_URL"] = testDb.dbUrl;
resetConfigurationForTests();

const { handleDiscordCallback, handleDiscordInstall } =
  await import("#src/trpc/auth-web.ts");
const { SESSION_COOKIE } = await import("#src/trpc/context.ts");
const { signSession } = await import("#src/trpc/jwt.ts");

const INSTALL_URL = "https://scout.example/api/discord/install";

function installRequest(
  cookieHeader?: string,
  url: string = INSTALL_URL,
): Request {
  const headers = new Headers();
  if (cookieHeader !== undefined) {
    headers.set("Cookie", cookieHeader);
  }
  return new Request(url, { method: "GET", headers });
}

describe("handleDiscordInstall", () => {
  test("redirects to /app/login when no session cookie is present", async () => {
    const response = await handleDiscordInstall(installRequest());

    expect(response.status).toBe(302);
    const location = response.headers.get("Location");
    expect(location).not.toBeNull();
    const target = new URL(location ?? "");
    // Stays on our own origin's login route — never bounces to Discord.
    expect(target.host).not.toBe("discord.com");
    expect(target.pathname).toBe("/app/login");
    // returnTo brings the user back to the guild picker after sign-in.
    expect(target.searchParams.get("returnTo")).toBe("/app/");
  });

  test("redirects to /app/login when the session cookie is invalid", async () => {
    const response = await handleDiscordInstall(
      installRequest(`${SESSION_COOKIE}=not-a-real-jwt`),
    );

    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("Location") ?? "");
    expect(target.host).not.toBe("discord.com");
    expect(target.pathname).toBe("/app/login");
    expect(target.searchParams.get("returnTo")).toBe("/app/");
  });

  test("redirects to Discord bot-authorize when the session is valid", async () => {
    // The subject must be a Discord-shaped snowflake: the handler binds the
    // minted attribution token to it. testAccountId builds the same
    // deterministic test snowflakes the rest of the suite uses.
    const { jwt } = await signSession({ discordId: testAccountId("4242") });
    const response = await handleDiscordInstall(
      installRequest(`${SESSION_COOKIE}=${jwt}`),
    );

    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("Location") ?? "");
    expect(target.host).toBe("discord.com");
    expect(target.pathname).toBe("/api/oauth2/authorize");
    // The bot-install URL carries the install scopes + permission bits and
    // points the post-install redirect at the SPA's landing route.
    expect(target.searchParams.get("scope")).toBe(
      "bot applications.commands identify",
    );
    expect(target.searchParams.get("permissions")).not.toBeNull();
    expect(target.searchParams.get("redirect_uri")).toBe(
      `${TEST_APP_ORIGIN}/api/auth/discord/callback`,
    );
    // The identify scope opts into Discord's redirecting authorization-code
    // flow; bot-only authorization ends on Discord's close-this-window page.
    expect(target.searchParams.get("response_type")).toBe("code");

    // The `state` param is the single-use attribution token, persisted and
    // bound to the session user + originating surface (default guild_picker).
    const state = target.searchParams.get("state");
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    const tokenRow = await testDb.prisma.installAttributionToken.findUnique({
      where: { token: state ?? "" },
    });
    expect(tokenRow).toMatchObject({
      discordId: testAccountId("4242"),
      surface: "guild_picker",
      consumedAt: null,
    });
  });

  test("records the onboarding surface from the query param", async () => {
    const { jwt } = await signSession({ discordId: testAccountId("4242") });
    const response = await handleDiscordInstall(
      installRequest(
        `${SESSION_COOKIE}=${jwt}`,
        `${INSTALL_URL}?surface=onboarding_wizard`,
      ),
    );

    const target = new URL(response.headers.get("Location") ?? "");
    const state = target.searchParams.get("state");
    const tokenRow = await testDb.prisma.installAttributionToken.findUnique({
      where: { token: state ?? "" },
    });
    expect(tokenRow?.surface).toBe("onboarding_wizard");
  });

  test("returns advanced bot installs to the installed landing page", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          access_token: "temporary-access-token",
          token_type: "Bearer",
          expires_in: 604_800,
          refresh_token: "temporary-refresh-token",
          scope: "bot applications.commands identify",
        },
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      const state = "a".repeat(64);
      const response = await handleDiscordCallback(
        installRequest(
          undefined,
          `${INSTALL_URL}?code=install-code&state=${state}&guild_id=${testAccountId("4242")}`,
        ),
      );

      expect(response.status).toBe(302);
      const location = new URL(response.headers.get("Location") ?? "");
      expect(location.pathname).toBe("/app/installed");
      expect(location.searchParams.get("state")).toBe(state);
      expect(location.searchParams.get("guild_id")).toBe(testAccountId("4242"));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

afterAll(async () => {
  await testDb.prisma.$disconnect();
});
