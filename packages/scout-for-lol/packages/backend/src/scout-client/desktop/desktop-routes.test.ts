import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_CONTRACT_HEADER,
  ScoutDesktopApiErrorSchema,
  ScoutDesktopConversationListResponseSchema,
  ScoutDesktopExploreStatusResponseSchema,
  ScoutDesktopPairingV2ResponseSchema,
} from "@scout-for-lol/data";
import { z } from "zod";
import { resetConfigurationForTests } from "#src/configuration.ts";
import { DiscordUpstreamError } from "#src/lib/discord-rest.ts";
import { secretDigest } from "#src/scout-client/secrets.ts";
import statusFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-status.json" with { type: "json" };
import getFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-conversations-get.json" with { type: "json" };

const mocks = vi.hoisted(() => ({
  findDevice: vi.fn(),
  findUser: vi.fn(),
  createPairing: vi.fn(),
  deletePairings: vi.fn(),
  fetchUserGuilds: vi.fn(),
  createContext: vi.fn(),
  isPolicyEnabled: vi.fn(),
  exploreStatusFor: vi.fn(),
  listConversations: vi.fn(),
  loadTranscript: vi.fn(),
}));

vi.mock("#src/database/index.ts", () => ({
  prisma: {
    scoutClientDevice: { findUnique: mocks.findDevice },
    user: { findUniqueOrThrow: mocks.findUser },
    scoutClientPairing: {
      create: mocks.createPairing,
      deleteMany: mocks.deletePairings,
    },
  },
}));
vi.mock("#src/lib/discord-rest.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchUserGuilds: mocks.fetchUserGuilds,
}));
// A cookie session is resolved only by tRPC's context. The desktop routes must
// never reach it, so it is replaced with a spy that every test checks.
vi.mock("#src/trpc/context.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  createContext: mocks.createContext,
}));
vi.mock("#src/configuration/flags.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  isPolicyEnabled: mocks.isPolicyEnabled,
}));
vi.mock("#src/explore/spending/status.ts", () => ({
  exploreStatusFor: mocks.exploreStatusFor,
}));
vi.mock("#src/explore/store.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  listExploreConversations: mocks.listConversations,
  loadExploreTranscript: mocks.loadTranscript,
}));
vi.mock("#src/trpc/auth-web-helpers.ts", () => ({
  getAppOrigin: () => "https://scout.invalid",
}));

const { handleScoutClientRoute } = await import("#src/scout-client/http.ts");
const { resetDesktopReadRateLimitForTests, DESKTOP_READ_LIMIT_PER_MINUTE } =
  await import("./rate-limit.ts");
const { resetPairingRateLimitForTests } =
  await import("#src/scout-client/pairing-rate-limit.ts");

const TOKEN = `sct_${"a".repeat(43)}`;
const OWNER_ID = "160509172704739328";
const DEVICE_ID = "4fa2a856-53af-42a4-85af-5cc085a942a3";
const SHARED_GUILD = "111111111111111111";
const OTHER_GUILD = "222222222222222222";
const CONVERSATION_ID = "0f4d6c1e-8a51-4c62-9a1e-3b7f2d9c5e10";
const ORIGIN = "https://scout.invalid";
const originalEnvironment = Bun.env["ENVIRONMENT"];
const originalAllowlist = Bun.env["EXPLORE_GUILD_ALLOWLIST"];

function guild(id: string) {
  return { id, name: "Server", icon: null, owner: false, permissions: "0" };
}

function device(overrides: Record<string, unknown> = {}) {
  return {
    id: DEVICE_ID,
    ownerId: OWNER_ID,
    appVersion: "0.4.0",
    deviceState: "ACTIVE",
    scopes: ["ingest", "explore"],
    ...overrides,
  };
}

function desktopRequest(
  path: string,
  options: {
    readonly body?: unknown;
    readonly headers?: Record<string, string>;
    readonly method?: string;
  } = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: options.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      [SCOUT_DESKTOP_CONTRACT_HEADER]: "1",
      ...options.headers,
    },
    ...(options.method === "GET"
      ? {}
      : { body: JSON.stringify(options.body ?? {}) }),
  });
}

async function send(request: Request): Promise<Response> {
  const response = await handleScoutClientRoute(request, new URL(request.url));
  if (response === null) throw new Error("route was not handled");
  return response;
}

async function errorCode(response: Response) {
  const body = ScoutDesktopApiErrorSchema.parse(await response.json());
  return body.error;
}

const STATUS_PATH = SCOUT_DESKTOP_API_ROUTES.explore_status.path;
const LIST_PATH = SCOUT_DESKTOP_API_ROUTES.explore_conversations_list.path;
const GET_PATH = SCOUT_DESKTOP_API_ROUTES.explore_conversations_get.path;

beforeEach(() => {
  vi.clearAllMocks();
  Bun.env["ENVIRONMENT"] = "beta";
  Bun.env["EXPLORE_GUILD_ALLOWLIST"] = SHARED_GUILD;
  resetConfigurationForTests();
  resetDesktopReadRateLimitForTests();
  resetPairingRateLimitForTests();
  mocks.isPolicyEnabled.mockResolvedValue(true);
  mocks.findDevice.mockResolvedValue(device());
  mocks.findUser.mockResolvedValue({
    discordId: OWNER_ID,
    discordUsername: "owner",
  });
  mocks.fetchUserGuilds.mockResolvedValue([guild(SHARED_GUILD)]);
  mocks.exploreStatusFor.mockResolvedValue(statusFixture.response);
  mocks.createContext.mockRejectedValue(
    new Error("desktop routes must not resolve a cookie session"),
  );
});

afterAll(() => {
  if (originalEnvironment === undefined) delete Bun.env["ENVIRONMENT"];
  else Bun.env["ENVIRONMENT"] = originalEnvironment;
  if (originalAllowlist === undefined) {
    delete Bun.env["EXPLORE_GUILD_ALLOWLIST"];
  } else {
    Bun.env["EXPLORE_GUILD_ALLOWLIST"] = originalAllowlist;
  }
  resetConfigurationForTests();
});

describe("desktop Explore authentication", () => {
  test("refuses a cookie-only request without reading a session", async () => {
    const response = await send(
      new Request(`${ORIGIN}${STATUS_PATH}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SCOUT_DESKTOP_CONTRACT_HEADER]: "1",
          Cookie: "scout_session=signed.jwt.value; scout_csrf=csrf-token",
          "X-CSRF-Token": "csrf-token",
          Origin: ORIGIN,
        },
        body: "{}",
      }),
    );

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthorized");
    expect(mocks.createContext).not.toHaveBeenCalled();
    expect(mocks.findDevice).not.toHaveBeenCalled();
    expect(mocks.exploreStatusFor).not.toHaveBeenCalled();
  });

  test("a cookie beside a non-device bearer is still refused", async () => {
    const response = await send(
      desktopRequest(STATUS_PATH, {
        headers: {
          Authorization: "Bearer not-a-device-token",
          Cookie: "scout_session=signed.jwt.value",
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.createContext).not.toHaveBeenCalled();
  });

  test("a revoked device is unauthorized", async () => {
    mocks.findDevice.mockResolvedValue(device({ deviceState: "REVOKED" }));

    const response = await send(desktopRequest(STATUS_PATH));

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthorized");
    expect(mocks.findDevice).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenDigest: secretDigest(TOKEN) } }),
    );
    expect(mocks.findUser).not.toHaveBeenCalled();
  });

  test("an ingest-only device needs the explore scope", async () => {
    mocks.findDevice.mockResolvedValue(device({ scopes: ["ingest"] }));

    const response = await send(desktopRequest(STATUS_PATH));

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("scope_required");
    expect(mocks.findUser).not.toHaveBeenCalled();
    expect(mocks.fetchUserGuilds).not.toHaveBeenCalled();
  });

  test("Explore is not gated by the capture policy", async () => {
    const response = await send(desktopRequest(STATUS_PATH));

    expect(response.status).toBe(200);
    expect(mocks.isPolicyEnabled).not.toHaveBeenCalledWith(
      "scout_client_ingestion",
      expect.anything(),
    );
  });

  test("an owner who shares no eligible server is forbidden", async () => {
    mocks.fetchUserGuilds.mockResolvedValue([guild(OTHER_GUILD)]);

    const response = await send(desktopRequest(LIST_PATH));

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("explore_forbidden");
    expect(mocks.listConversations).not.toHaveBeenCalled();
  });

  test("a failed Discord token refresh asks the owner to sign in again", async () => {
    mocks.fetchUserGuilds.mockRejectedValue(
      new DiscordUpstreamError("token_refresh_failed", "revoked", 401),
    );

    const response = await send(desktopRequest(STATUS_PATH));

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("reauthorize_required");
  });

  test("a Discord outage is unavailable, never a denial", async () => {
    mocks.fetchUserGuilds.mockRejectedValue(
      new DiscordUpstreamError("fetch_error", "timeout"),
    );

    const response = await send(desktopRequest(STATUS_PATH));

    expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe("unavailable");
  });
});

describe("desktop contract version", () => {
  test.each([
    ["missing", undefined],
    ["below the minimum", "0"],
    ["malformed", "1.0"],
  ])("a %s contract header is upgrade-required", async (_label, version) => {
    const request = desktopRequest(STATUS_PATH);
    if (version === undefined) {
      request.headers.delete(SCOUT_DESKTOP_CONTRACT_HEADER);
    } else {
      request.headers.set(SCOUT_DESKTOP_CONTRACT_HEADER, version);
    }

    const response = await send(request);

    expect(response.status).toBe(426);
    expect(await errorCode(response)).toBe("contract_unsupported");
    expect(mocks.findDevice).not.toHaveBeenCalled();
  });

  test("every answer names the server's contract version", async () => {
    const response = await send(desktopRequest(STATUS_PATH));

    expect(response.headers.get(SCOUT_DESKTOP_CONTRACT_HEADER)).toBe("1");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("desktop Explore read routes", () => {
  test("status answers from the shared status function", async () => {
    const response = await send(desktopRequest(STATUS_PATH));

    expect(response.status).toBe(200);
    expect(
      ScoutDesktopExploreStatusResponseSchema.parse(await response.json()),
    ).toEqual(statusFixture.response);
    expect(mocks.exploreStatusFor).toHaveBeenCalledWith(OWNER_ID);
  });

  test("list reads the owner's conversations without the model preference", async () => {
    mocks.listConversations.mockResolvedValue([
      { ...getFixture.response.conversation, preferredModel: "gpt-6.1-sol" },
    ]);

    const response = await send(desktopRequest(LIST_PATH));

    expect(response.status).toBe(200);
    const body = ScoutDesktopConversationListResponseSchema.parse(
      await response.json(),
    );
    expect(body.conversations).toHaveLength(1);
    expect(body.conversations[0]).not.toHaveProperty("preferredModel");
    expect(mocks.listConversations).toHaveBeenCalledWith(
      expect.anything(),
      OWNER_ID,
    );
  });

  test("get returns the owner's transcript", async () => {
    mocks.loadTranscript.mockResolvedValue(getFixture.response);

    const response = await send(
      desktopRequest(GET_PATH, { body: { conversationId: CONVERSATION_ID } }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(getFixture.response);
    expect(mocks.loadTranscript).toHaveBeenCalledWith(
      expect.anything(),
      CONVERSATION_ID,
      OWNER_ID,
    );
  });

  test("another user's conversation is not found", async () => {
    mocks.loadTranscript.mockResolvedValue(null);

    const response = await send(
      desktopRequest(GET_PATH, { body: { conversationId: CONVERSATION_ID } }),
    );

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("not_found");
  });

  test.each([
    ["an unknown key", { conversationId: CONVERSATION_ID, version: 4 }],
    ["a malformed id", { conversationId: "nope" }],
  ])("get refuses %s", async (_label, body) => {
    const response = await send(desktopRequest(GET_PATH, { body }));

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_request");
    expect(mocks.loadTranscript).not.toHaveBeenCalled();
  });

  test("a body that is not JSON is an invalid request", async () => {
    const request = new Request(`${ORIGIN}${STATUS_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Authorization: `Bearer ${TOKEN}`,
        [SCOUT_DESKTOP_CONTRACT_HEADER]: "1",
      },
      body: "{}",
    });

    const response = await send(request);

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_request");
  });

  test("only POST is served", async () => {
    const response = await send(desktopRequest(STATUS_PATH, { method: "GET" }));

    expect(response.status).toBe(405);
    expect(mocks.findDevice).not.toHaveBeenCalled();
  });

  test("each device is limited before any Explore read", async () => {
    for (let call = 0; call < DESKTOP_READ_LIMIT_PER_MINUTE; call += 1) {
      const allowed = await send(desktopRequest(STATUS_PATH));
      expect(allowed.status).toBe(200);
    }

    const response = await send(desktopRequest(STATUS_PATH));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(await errorCode(response)).toBe("rate_limited");
    expect(mocks.exploreStatusFor).toHaveBeenCalledTimes(
      DESKTOP_READ_LIMIT_PER_MINUTE,
    );
  });
});

describe("desktop pairing", () => {
  const PAIRING_ID = "4fa2a856-53af-42a4-85af-5cc085a942a3";
  const pairingBody = {
    deviceName: "Scout Desktop",
    platform: "windows",
    architecture: "x86_64",
    appVersion: "0.4.0",
    protocolVersion: 1,
  };

  function pairingRequest(path: string, contract: string | null) {
    return new Request(`${ORIGIN}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": "192.0.2.30",
        ...(contract === null
          ? {}
          : { [SCOUT_DESKTOP_CONTRACT_HEADER]: contract }),
      },
      body: JSON.stringify(pairingBody),
    });
  }

  beforeEach(() => {
    mocks.deletePairings.mockResolvedValue({ count: 0 });
    mocks.createPairing.mockResolvedValue({ id: PAIRING_ID });
  });

  test("v2 asks for ingest and explore and returns a match code", async () => {
    const response = await send(
      pairingRequest(SCOUT_DESKTOP_API_ROUTES.pairings_v2.path, "1"),
    );

    expect(response.status).toBe(201);
    const body = ScoutDesktopPairingV2ResponseSchema.parse(
      await response.json(),
    );
    expect(body.scopes).toEqual(["ingest", "explore"]);
    expect(body.pairingId).toBe(PAIRING_ID);
    expect(mocks.createPairing).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scopes: ["ingest", "explore"] }),
      }),
    );
  });

  test("v2 refuses a client without the contract header", async () => {
    const response = await send(
      pairingRequest(SCOUT_DESKTOP_API_ROUTES.pairings_v2.path, null),
    );

    expect(response.status).toBe(426);
    expect(mocks.createPairing).not.toHaveBeenCalled();
  });

  test("the original route still grants ingest only, with its old body", async () => {
    const response = await send(
      pairingRequest("/api/scout-client/v1/pairings", null),
    );

    expect(response.status).toBe(201);
    expect(
      Object.keys(
        z.record(z.string(), z.unknown()).parse(await response.json()),
      ).sort(),
    ).toEqual(["approvalUrl", "expiresAt", "pairingId", "pairingSecret"]);
    expect(mocks.createPairing).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ scopes: ["ingest"] }),
      }),
    );
  });
});
