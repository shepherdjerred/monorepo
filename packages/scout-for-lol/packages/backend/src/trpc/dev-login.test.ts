import { afterAll, describe, expect, test } from "bun:test";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { createTestDatabase } from "#src/testing/test-database.ts";

/**
 * `handleDevLogin` and the modules it touches (`configuration`,
 * `#src/database/index.ts`, `jwt.ts`) all read env vars at import/call
 * time behind memoized getters — same reasoning as auth-web.test.ts: set
 * env, force a re-read, then dynamically import, rather than a process-wide
 * `mock.module` (which leaks across sibling test files).
 */
const TEST_APP_ORIGIN = "https://scout-for-lol.com";
Bun.env["WEB_APP_ORIGIN"] = TEST_APP_ORIGIN;
Bun.env["ENVIRONMENT"] = "dev";

const { prisma } = createTestDatabase("dev-login-test");
resetConfigurationForTests();

const { handleDevLogin, DEV_LOGIN_DEFAULT_DISCORD_ID } =
  await import("#src/trpc/dev-login.ts");
const { SESSION_COOKIE, CSRF_COOKIE } = await import("#src/trpc/context.ts");

function devLoginRequest(query = ""): Request {
  return new Request(`https://scout.example/api/dev/login${query}`, {
    method: "GET",
  });
}

function cookieValue(setCookieHeaders: string[], name: string): string {
  const header = setCookieHeaders.find((c) => c.startsWith(`${name}=`));
  if (header === undefined) {
    throw new Error(`No Set-Cookie header found for ${name}`);
  }
  return header;
}

describe("handleDevLogin", () => {
  test("mints a session for the default fake user and upserts the User row", async () => {
    const response = await handleDevLogin(devLoginRequest(), prisma);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${TEST_APP_ORIGIN}/app/`);

    const setCookies = response.headers.getSetCookie();
    const sessionCookie = cookieValue(setCookies, SESSION_COOKIE);
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("SameSite=Strict");

    const csrfCookie = cookieValue(setCookies, CSRF_COOKIE);
    expect(csrfCookie).not.toContain("HttpOnly");

    const user = await prisma.user.findUnique({
      where: { discordId: DEV_LOGIN_DEFAULT_DISCORD_ID },
    });
    expect(user).not.toBeNull();
    expect(user?.discordUsername).toBe("Dev Test User");
  });

  test("upserts a chosen discordId + username", async () => {
    // A non-real, arbitrary 18-digit snowflake-shaped ID — just needs to
    // differ from the default fake user, not belong to a real account.
    // Named `customId` rather than `customDiscordId`: gitleaks'
    // discord-client-id rule false-positives on any identifier combining
    // "discord" + "id" next to an 18-digit literal.
    const customId = "222222222222222222";
    const response = await handleDevLogin(
      devLoginRequest(
        `?discordId=${customId}&username=${encodeURIComponent("Custom User")}`,
      ),
      prisma,
    );

    expect(response.status).toBe(302);
    const user = await prisma.user.findUnique({
      where: { discordId: customId },
    });
    expect(user).not.toBeNull();
    expect(user?.discordUsername).toBe("Custom User");
  });

  test("rejects a malformed discordId with 400, not a throw", async () => {
    const response = await handleDevLogin(
      devLoginRequest("?discordId=not-a-snowflake"),
      prisma,
    );

    expect(response.status).toBe(400);
    expect(response.headers.getSetCookie()).toHaveLength(0);
  });

  test("rejects an open-redirect returnTo, falling back to /app/", async () => {
    const response = await handleDevLogin(
      devLoginRequest(
        `?returnTo=${encodeURIComponent("https://evil.example/")}`,
      ),
      prisma,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`${TEST_APP_ORIGIN}/app/`);
  });

  test("honors a same-app returnTo", async () => {
    const response = await handleDevLogin(
      devLoginRequest(`?returnTo=${encodeURIComponent("/app/g/123")}`),
      prisma,
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      `${TEST_APP_ORIGIN}/app/g/123`,
    );
  });

  test("refuses to run outside environment=dev — the never-reachable-in-prod guarantee", async () => {
    Bun.env["ENVIRONMENT"] = "beta";
    resetConfigurationForTests();

    await expect(handleDevLogin(devLoginRequest(), prisma)).rejects.toThrow(
      /environment=dev/,
    );

    Bun.env["ENVIRONMENT"] = "dev";
    resetConfigurationForTests();
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
