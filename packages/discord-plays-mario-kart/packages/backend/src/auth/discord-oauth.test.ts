// The sign-in flow against a fake Discord API and a real session table.
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { PrismaClient } from "#generated/prisma/client/index.js";
import { MeSchema } from "@discord-plays-mario-kart/common";
import { openTestDatabase } from "#src/database/test-database.ts";
import { createPlayerDirectory } from "./player-directory.ts";
import { createWebSessionStore } from "./session-store.ts";
import {
  DiscordAuth,
  SESSION_COOKIE,
  cookieValue,
  type AuthResult,
  type FetchLike,
} from "./discord-oauth.ts";

const ORIGIN = "https://mariokart.example.com";

let prisma: PrismaClient;
let auth: DiscordAuth;
let requests: { url: string; body: string | undefined }[];

function discordReply(url: string, init: RequestInit): Response {
  requests.push({
    url,
    body:
      init.body instanceof URLSearchParams ? init.body.toString() : undefined,
  });
  if (url.endsWith("/oauth2/token")) {
    return Response.json({ access_token: "access" });
  }
  if (url.endsWith("/users/@me")) {
    return Response.json({
      id: "4242",
      username: "speedy",
      global_name: "Speedy ⚡",
      avatar: "hash",
    });
  }
  return new Response("not found", { status: 404 });
}

const fakeDiscord: FetchLike = (url, init) =>
  Promise.resolve(discordReply(url, init));

beforeEach(async () => {
  prisma = await openTestDatabase();
  requests = [];
  const players = createPlayerDirectory(prisma);
  auth = new DiscordAuth({
    config: { publicOrigin: ORIGIN, clientId: "99", clientSecret: "secret" },
    sessions: createWebSessionStore(prisma, players),
    fetch: fakeDiscord,
  });
});

afterEach(async () => {
  await prisma.$disconnect();
});

function cookies(result: AuthResult): string {
  return result.cookies.map((cookie) => cookie.split(";")[0]).join("; ");
}

function redirectOf(result: AuthResult): URL {
  if (result.kind !== "redirect") throw new Error("expected a redirect");
  return new URL(result.location, ORIGIN);
}

async function signIn(): Promise<{ result: AuthResult; cookieHeader: string }> {
  const start = auth.start();
  const state = redirectOf(start).searchParams.get("state") ?? "";
  const result = await auth.callback({
    url: `/api/auth/discord/callback?code=abc&state=${encodeURIComponent(state)}`,
    cookieHeader: cookies(start),
  });
  return { result, cookieHeader: cookies(result) };
}

describe("DiscordAuth", () => {
  test("starts at Discord with identify scope and the configured callback", () => {
    const target = redirectOf(auth.start());
    expect(target.origin + target.pathname).toBe(
      "https://discord.com/oauth2/authorize",
    );
    expect(target.searchParams.get("scope")).toBe("identify");
    expect(target.searchParams.get("client_id")).toBe("99");
    expect(target.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/api/auth/discord/callback`,
    );
  });

  test("signs in, and /api/me then reports the Discord user", async () => {
    const { result, cookieHeader } = await signIn();
    expect(redirectOf(result).pathname).toBe("/");
    expect(result.cookies.find((c) => c.startsWith(SESSION_COOKIE))).toMatch(
      /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/u,
    );
    expect(requests[0]?.body).toContain(
      "redirect_uri=https%3A%2F%2Fmariokart.example.com",
    );

    const me = await auth.me({ url: "/api/me", cookieHeader });
    expect(me.kind === "json" && MeSchema.parse(me.body)).toEqual({
      signedIn: true,
      user: {
        discordId: "4242",
        username: "speedy",
        name: "Speedy",
        avatarUrl: "https://cdn.discordapp.com/avatars/4242/hash.png?size=128",
      },
    });
  });

  test("rejects a state that this browser did not start", async () => {
    const mine = auth.start();
    const theirs = redirectOf(auth.start()).searchParams.get("state") ?? "";
    const result = await auth.callback({
      url: `/api/auth/discord/callback?code=abc&state=${encodeURIComponent(theirs)}`,
      cookieHeader: cookies(mine),
    });
    expect(redirectOf(result).search).toBe("?signin=expired");
    expect(requests).toHaveLength(0);
  });

  test("rejects an expired or replayed state", async () => {
    const start = auth.start(Date.now() - 10 * 60 * 1000);
    const state = redirectOf(start).searchParams.get("state") ?? "";
    const url = `/api/auth/discord/callback?code=abc&state=${encodeURIComponent(state)}`;
    const expired = await auth.callback({ url, cookieHeader: cookies(start) });
    expect(redirectOf(expired).search).toBe("?signin=expired");

    const fresh = auth.start();
    const freshState = redirectOf(fresh).searchParams.get("state") ?? "";
    const freshUrl = `/api/auth/discord/callback?code=abc&state=${encodeURIComponent(freshState)}`;
    await auth.callback({ url: freshUrl, cookieHeader: cookies(fresh) });
    const replay = await auth.callback({
      url: freshUrl,
      cookieHeader: cookies(fresh),
    });
    expect(redirectOf(replay).search).toBe("?signin=expired");
  });

  test("treats a declined consent as cancelled", async () => {
    const start = auth.start();
    const state = redirectOf(start).searchParams.get("state") ?? "";
    const result = await auth.callback({
      url: `/api/auth/discord/callback?error=access_denied&state=${encodeURIComponent(state)}`,
      cookieHeader: cookies(start),
    });
    expect(redirectOf(result).search).toBe("?signin=cancelled");
  });

  test("signs out by deleting the session", async () => {
    const { cookieHeader } = await signIn();
    await auth.logout({ url: "/api/auth/logout", cookieHeader });
    expect(await auth.identify(cookieHeader)).toBeUndefined();
    expect(await prisma.webSession.count()).toBe(0);
  });
});

describe("cookieValue", () => {
  test("finds one cookie among several", () => {
    expect(cookieValue("a=1; mk64_session=tok; b=2", SESSION_COOKIE)).toBe(
      "tok",
    );
    expect(cookieValue(undefined, SESSION_COOKIE)).toBeUndefined();
  });
});
