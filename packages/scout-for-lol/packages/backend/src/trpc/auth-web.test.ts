import { describe, expect, test } from "bun:test";
import { handleDiscordInstall } from "#src/trpc/auth-web.ts";
import { SESSION_COOKIE } from "#src/trpc/context.ts";
import { signSession } from "#src/trpc/jwt.ts";

/**
 * The bot-install endpoint must be gated by the same session cookie the
 * rest of the web app uses. An unauthenticated install would bounce a
 * user through Discord only to land on /app/login with the `guild_id`
 * deep-link silently dropped (the /app/installed landing route is gated
 * by RequireSession). So a missing/invalid session must short-circuit to
 * the login page instead, and only a valid session may proceed to
 * Discord's bot-authorize screen.
 */
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
      "https://scout-for-lol.com/app/installed",
    );
    // No response_type=code: this is a pure bot install, not a token grant.
    expect(target.searchParams.get("response_type")).toBeNull();
  });
});
