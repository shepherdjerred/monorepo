import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { DiscordAccountIdSchema, LeaguePuuidSchema } from "@scout-for-lol/data";
import configuration, {
  resetConfigurationForTests,
} from "#src/configuration.ts";
import type { FlagAttributes } from "#src/configuration/flags.ts";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";
import { signSession, verifySession } from "#src/trpc/jwt.ts";
import {
  createRiotLinkAttempt,
  riotLinkDigest,
} from "#src/database/riot-accounts.ts";
import {
  encryptRiotLinkFlow,
  newRiotLinkFlow,
  RIOT_LINK_COOKIE,
} from "./link-cookie.ts";

const stubs = vi.hoisted(() => ({
  enabled: true,
  betaOnly: false,
  verify: vi.fn(),
}));
vi.mock("#src/configuration/flags.ts", async () => ({
  ...(await vi.importActual<Record<string, unknown>>(
    "#src/configuration/flags.ts",
  )),
  isPolicyEnabled: async (_name: string, attributes: FlagAttributes = {}) =>
    stubs.enabled && (!stubs.betaOnly || attributes["stage"] === "beta"),
}));
vi.mock("./provider.ts", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("./provider.ts")),
  verifyRiotAuthorization: stubs.verify,
}));

Bun.env["JWT_SIGNING_SECRET"] =
  "test-session-signing-secret-at-least-thirty-two-bytes";
Bun.env["RIOT_RSO_CLIENT_ID"] = "test-rso-client";
Bun.env["RIOT_RSO_CLIENT_SECRET"] = "test-rso-secret";
resetConfigurationForTests();
const harness = await createOfflineTrpcHarness("riot-account-web");
const { prisma: db } = harness;
const { handleRiotAuthRoutes, RiotLinkStartResponseSchema } =
  await import("./http.ts");
const owner = DiscordAccountIdSchema.parse("300000000000000081");
const other = DiscordAccountIdSchema.parse("300000000000000082");
const puuid = LeaguePuuidSchema.parse("Q".repeat(78));
const identity = { puuid, gameName: "Northstar", tagLine: "NA1" };
function testAppOrigin(): string {
  const origin = configuration.webAppOrigin;
  if (origin === undefined) throw new Error("Missing test app origin");
  return origin;
}
const appOrigin = testAppOrigin();

beforeEach(async () => {
  stubs.enabled = true;
  stubs.betaOnly = false;
  stubs.verify.mockReset();
  stubs.verify.mockResolvedValue(identity);
  await db.riotOAuthLinkAttempt.deleteMany();
  await db.riotAccountPreference.deleteMany();
  await db.user.deleteMany();
  for (const discordId of [owner, other])
    await db.user.create({ data: { discordId, discordUsername: "test-user" } });
});
afterAll(async () => {
  await db.$disconnect();
});

async function caller(
  discordId = owner,
  options: {
    sessionId?: string;
    cookie?: string;
    csrf?: string;
    origin?: string;
  } = {},
) {
  const user = await db.user.findUniqueOrThrow({ where: { discordId } });
  return harness.appRouter.createCaller({
    user,
    webSession: {
      discordId,
      sessionId: options.sessionId ?? "session",
      riotLinkCookie: options.cookie,
      csrfToken: "csrf",
      csrfHeader: options.csrf ?? "csrf",
      origin: options.origin ?? configuration.webAppOrigin ?? null,
      ipAddress: null,
      userAgent: "test",
    },
    clientIp: null,
    requestId: "test-riot-settings",
  });
}

async function ownedAccount() {
  return db.riotAccountPreference.create({
    data: { ...identity, ownerDiscordId: owner, verifiedAt: new Date() },
  });
}

describe("personal Riot notification settings", () => {
  test("needs no guild permission and honors an existing preference when linking is disabled", async () => {
    await ownedAccount();
    stubs.enabled = false;
    const ownerCaller = await caller();
    const before = await ownerCaller.riotAccount.list();
    expect(before.accounts).toHaveLength(1);
    await expect(
      ownerCaller.riotAccount.setMatchNotifications({ puuid, enabled: false }),
    ).resolves.toEqual({ enabled: false });
    const after = await ownerCaller.riotAccount.list();
    expect(after.linkingEnabled).toBe(false);
    const preference = await db.riotAccountPreference.findUniqueOrThrow({
      where: { puuid },
    });
    expect(preference.matchNotificationsEnabled).toBe(false);
  });
  test("does not expose another user's links or allow editing them", async () => {
    await ownedAccount();
    const otherCaller = await caller(other);
    const listing = await otherCaller.riotAccount.list();
    expect(listing.accounts).toEqual([]);
    await expect(
      otherCaller.riotAccount.setMatchNotifications({ puuid, enabled: false }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const preference = await db.riotAccountPreference.findUniqueOrThrow({
      where: { puuid },
    });
    expect(preference.matchNotificationsEnabled).toBe(true);
  });
  test("rejects anonymous, cross-origin, and missing-CSRF edits", async () => {
    await ownedAccount();
    await expect(harness.anonCaller().riotAccount.list()).rejects.toMatchObject(
      { code: "UNAUTHORIZED" },
    );
    for (const options of [
      { csrf: "wrong" },
      { origin: "https://untrusted.invalid" },
    ]) {
      const invalidCaller = await caller(owner, options);
      await expect(
        invalidCaller.riotAccount.setMatchNotifications({
          puuid,
          enabled: false,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
  test("finishes a verified proof only under its initiating session", async () => {
    const flow = newRiotLinkFlow();
    const secret = configuration.jwtSigningSecret;
    if (secret === undefined) throw new Error("Missing test secret");
    const cookie = await encryptRiotLinkFlow(flow, secret);
    await createRiotLinkAttempt(
      { state: flow.state, discordId: owner, sessionId: "original-session" },
      db,
    );
    await db.riotOAuthLinkAttempt.update({
      where: { stateDigest: riotLinkDigest(flow.state) },
      data: {
        verifiedPuuid: puuid,
        gameName: identity.gameName,
        tagLine: identity.tagLine,
        verifiedAt: new Date(),
        claimedAt: new Date(),
      },
    });
    const wrongSession = await caller(owner, {
      cookie,
      sessionId: "another-session",
    });
    const originalSession = await caller(owner, {
      cookie,
      sessionId: "original-session",
    });
    await expect(wrongSession.riotAccount.completeLink()).resolves.toEqual({
      kind: "expired",
    });
    await expect(originalSession.riotAccount.completeLink()).resolves.toEqual({
      kind: "linked",
    });
    await expect(originalSession.riotAccount.completeLink()).resolves.toEqual({
      kind: "expired",
    });
  });
});

async function route(request: Request) {
  const response = await handleRiotAuthRoutes(request, new URL(request.url));
  if (response === null) throw new Error("Riot route was not handled");
  return response;
}

async function requestStart() {
  const { jwt } = await signSession({ discordId: owner });
  const claims = await verifySession(jwt);
  if (claims === null) throw new Error("Invalid test session");
  const response = await route(
    new Request(`${appOrigin}/api/auth/riot/start`, {
      method: "POST",
      headers: {
        Cookie: `scout_session=${jwt}; scout_csrf=csrf`,
        Origin: appOrigin,
        "X-CSRF-Token": "csrf",
      },
    }),
  );
  return { response, claims };
}

async function startFlow() {
  const { response, claims } = await requestStart();
  expect(response.status).toBe(200);
  const authorize = new URL(
    RiotLinkStartResponseSchema.parse(await response.json()).authorizeUrl,
  );
  const header = response.headers.get("Set-Cookie");
  if (header === null) throw new Error("No Riot flow cookie");
  const first = header.split(";")[0];
  if (first === undefined) throw new Error("No cookie value");
  return {
    state: authorize.searchParams.get("state"),
    cookieHeader: first,
    cookie: decodeURIComponent(first.slice(RIOT_LINK_COOKIE.length + 1)),
    sessionId: claims.jti,
    header,
  };
}

describe("Riot HTTP handshake", () => {
  test.each(["beta", "prod"] as const)(
    "applies beta-only linking to both settings and sign-in in %s",
    async (stage) => {
      stubs.betaOnly = true;
      const environment = vi
        .spyOn(configuration, "environment", "get")
        .mockReturnValue(stage);
      try {
        const ownerCaller = await caller();
        const listing = await ownerCaller.riotAccount.list();
        expect(listing.linkingEnabled).toBe(stage === "beta");
        const { response } = await requestStart();
        expect(response.status).toBe(stage === "beta" ? 200 : 403);
        expect(await db.riotOAuthLinkAttempt.count()).toBe(
          stage === "beta" ? 1 : 0,
        );
      } finally {
        environment.mockRestore();
      }
    },
  );
  test("uses a Lax HttpOnly flow cookie and finishes under the existing Strict session", async () => {
    const flow = await startFlow();
    expect(flow.header).toContain("HttpOnly");
    expect(flow.header).toContain("SameSite=Lax");
    const callback = await route(
      new Request(
        `${appOrigin}/api/auth/riot/callback?state=${flow.state ?? ""}&code=test-code`,
        { headers: { Cookie: flow.cookieHeader } },
      ),
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.get("Location")).toContain(
      "/app/settings?riot=complete",
    );
    expect(await db.riotAccountPreference.count()).toBe(0);
    const ownerCaller = await caller(owner, {
      sessionId: flow.sessionId,
      cookie: flow.cookie,
    });
    await expect(ownerCaller.riotAccount.completeLink()).resolves.toEqual({
      kind: "linked",
    });
    expect(await db.riotAccountPreference.count()).toBe(1);
    const secondCallback = await route(
      new Request(
        `${appOrigin}/api/auth/riot/callback?state=${flow.state ?? ""}&code=test-code`,
        { headers: { Cookie: flow.cookieHeader } },
      ),
    );
    expect(secondCallback.headers.get("Location")).toContain("riot=expired");
    expect(stubs.verify).toHaveBeenCalledTimes(1);
  });
  test.each(["wrong-state", "cancelled"])(
    "does not verify a denied or mismatched flow: %s",
    async (kind) => {
      const flow = await startFlow();
      const query =
        kind === "wrong-state"
          ? "state=wrong&code=test-code"
          : `state=${flow.state ?? ""}&error=access_denied`;
      const response = await route(
        new Request(`${appOrigin}/api/auth/riot/callback?${query}`, {
          headers: { Cookie: flow.cookieHeader },
        }),
      );
      expect(response.status).toBe(303);
      expect(stubs.verify).not.toHaveBeenCalled();
      expect(await db.riotAccountPreference.count()).toBe(0);
    },
  );
  test("rejects a start without authentication and refuses new links behind the flag", async () => {
    const anonymous = await route(
      new Request(`${appOrigin}/api/auth/riot/start`, {
        method: "POST",
      }),
    );
    expect(anonymous.status).toBe(401);
    stubs.enabled = false;
    const { response: disabled } = await requestStart();
    expect(disabled.status).toBe(403);
  });
});
