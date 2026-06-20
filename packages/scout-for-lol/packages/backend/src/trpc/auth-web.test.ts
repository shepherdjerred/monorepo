import { describe, expect, mock, test } from "bun:test";

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
 * Pin a COMPLETE `configuration` for this file before importing the
 * modules under test.
 *
 * `handleDiscordInstall` (auth-web.ts) and `signSession`/`verifySession`
 * (jwt.ts) read `configuration.default.{applicationId, webAppOrigin,
 * jwtSigningSecret, discordClientSecret}` lazily at call time. Several
 * sibling test files install a *partial* `mock.module("#src/configuration.ts")`
 * (only `version`/`gitSha`/`s3BucketName`/…) at their top level, and Bun's
 * `mock.module` is process-wide, retroactive, and never restored between
 * files. If one of those evaluated before this file in the full suite, our
 * code would read an undefined `webAppOrigin`/`jwtSigningSecret` and throw —
 * which is exactly why these tests passed in isolation but failed in CI.
 *
 * Installing our own fully-populated mock here (last-write-wins, retroactive)
 * makes this file order-independent, and because every field is present it
 * can't break a later file that reads configuration.
 */
const TEST_APP_ORIGIN = "https://scout-for-lol.com";
// Non-numeric placeholder so gitleaks doesn't read an 18-digit snowflake as
// a real discord-client-id. The handler only echoes this into the client_id
// query param; the tests don't assert on it, so any string works.
const TEST_APPLICATION_ID = "test-application-id";
// Reuse the throwaway HS256 signing key the test preload (test-setup.ts)
// already exports via JWT_SIGNING_SECRET — single source of truth, and it
// keeps a high-entropy literal out of this file (gitleaks reads such a
// literal as a generic-api-key). jwt.ts#getKey requires >= 32 chars; the
// fallback (built from benign words) clears that bar without looking like a
// real key.
const TEST_JWT_SIGNING_SECRET =
  Bun.env["JWT_SIGNING_SECRET"] ??
  "scout-for-lol-test-signing-key-not-a-real-key";

void mock.module("#src/configuration.ts", () => ({
  default: {
    version: "test",
    gitSha: "test",
    environment: "dev",
    sentryDsn: undefined,
    s3BucketName: "test-bucket",
    applicationId: TEST_APPLICATION_ID,
    webAppOrigin: TEST_APP_ORIGIN,
    jwtSigningSecret: TEST_JWT_SIGNING_SECRET,
    discordClientSecret: undefined,
  },
}));

const { handleDiscordInstall } = await import("#src/trpc/auth-web.ts");
const { SESSION_COOKIE } = await import("#src/trpc/context.ts");
const { signSession } = await import("#src/trpc/jwt.ts");

const INSTALL_URL = "https://scout.example/api/discord/install";

function installRequest(cookieHeader?: string): Request {
  const headers = new Headers();
  if (cookieHeader !== undefined) {
    headers.set("Cookie", cookieHeader);
  }
  return new Request(INSTALL_URL, { method: "GET", headers });
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
    // The install handler only requires a verifiable session (non-null
    // claims), not a DB lookup, so any non-empty subject works. Use a
    // non-numeric placeholder so gitleaks doesn't mistake an 18-digit
    // snowflake for a real Discord client id.
    const { jwt } = await signSession({ discordId: "test-discord-user" });
    const response = await handleDiscordInstall(
      installRequest(`${SESSION_COOKIE}=${jwt}`),
    );

    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("Location") ?? "");
    expect(target.host).toBe("discord.com");
    expect(target.pathname).toBe("/api/oauth2/authorize");
    // The bot-install URL carries the install scopes + permission bits and
    // points the post-install redirect at the SPA's landing route.
    expect(target.searchParams.get("scope")).toBe("bot applications.commands");
    expect(target.searchParams.get("permissions")).not.toBeNull();
    expect(target.searchParams.get("redirect_uri")).toBe(
      `${TEST_APP_ORIGIN}/app/installed`,
    );
    // No response_type=code: this is a pure bot install, not a token grant.
    expect(target.searchParams.get("response_type")).toBeNull();
  });
});
