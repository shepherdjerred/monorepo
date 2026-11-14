import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_CONTRACT_HEADER,
  SCOUT_DESKTOP_CONTRACT_VERSION,
  ScoutDesktopApiErrorSchema,
  ScoutDesktopConversationGetResponseSchema,
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
import startFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-runs-start.json" with { type: "json" };
import stopFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-runs-stop.json" with { type: "json" };
import activeFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-runs-active.json" with { type: "json" };
import outcomeFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-runs-outcome.json" with { type: "json" };
import streamFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-runs-stream.json" with { type: "json" };
import { exploreQuotaLimits } from "#src/config/dynamic.ts";

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
  startRun: vi.fn(),
  stopRun: vi.fn(),
  listRuns: vi.fn(),
  runOutcome: vi.fn(),
  subscribeRun: vi.fn(),
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
// The run manager is the one the web's tRPC procedures use; its methods are
// spies so each test can stand in a run, or route to a real manager.
vi.mock("#src/explore/runs/run-manager.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  exploreRunManager: {
    start: mocks.startRun,
    stop: mocks.stopRun,
    listDurable: mocks.listRuns,
    durableOutcome: mocks.runOutcome,
    subscribeDurable: mocks.subscribeRun,
  },
}));

const { handleScoutClientRoute } = await import("#src/scout-client/http.ts");
const { resetDesktopReadRateLimitForTests, DESKTOP_READ_LIMIT_PER_MINUTE } =
  await import("./rate-limit.ts");
const { resetPairingRateLimitForTests } =
  await import("#src/scout-client/pairing-rate-limit.ts");
const {
  DESKTOP_STREAMS_PER_DEVICE,
  desktopStreamsHeldForTests,
  resetDesktopStreamSlotsForTests,
} = await import("./explore-run-routes.ts");
const {
  ExploreConversationBusyError,
  resetExploreRateLimitStateForTests,
  tryStartExploreTurn,
} = await import("#src/explore/rate-limit.ts");
const { ExploreRunManager, ExploreRunUnavailableError } =
  await import("#src/explore/runs/run-manager.ts");
const { ExploreInvalidTurnError, ExploreNotFoundError } =
  await import("#src/explore/store.ts");

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
  resetDesktopStreamSlotsForTests();
  resetExploreRateLimitStateForTests();
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

const EXPLORE_ROUTES = Object.entries(SCOUT_DESKTOP_API_ROUTES).filter(
  ([name]) => name.startsWith("explore_"),
);

describe("desktop Explore flag", () => {
  test("every Explore route is covered", () => {
    expect(EXPLORE_ROUTES.map(([name]) => name).toSorted()).toEqual([
      "explore_conversations_get",
      "explore_conversations_list",
      "explore_runs_active",
      "explore_runs_outcome",
      "explore_runs_start",
      "explore_runs_stop",
      "explore_runs_stream",
      "explore_status",
    ]);
  });

  test.each(EXPLORE_ROUTES)(
    "%s is refused with feature_disabled when the flag is off",
    async (_name, route) => {
      mocks.isPolicyEnabled.mockResolvedValue(false);

      const response = await send(desktopRequest(route.path));

      expect(response.status).toBe(503);
      expect(await errorCode(response)).toBe("feature_disabled");
      expect(mocks.exploreStatusFor).not.toHaveBeenCalled();
      expect(mocks.startRun).not.toHaveBeenCalled();
      expect(mocks.subscribeRun).not.toHaveBeenCalled();
    },
  );

  test("the flag is evaluated for the owner, then each eligible server", async () => {
    mocks.isPolicyEnabled.mockResolvedValue(false);

    await send(desktopRequest(STATUS_PATH));

    expect(mocks.isPolicyEnabled.mock.calls).toEqual([
      ["scout_desktop_explore_enabled", { user: OWNER_ID }],
      ["scout_desktop_explore_enabled", { server: SHARED_GUILD }],
    ]);
  });

  test("a user-targeted answer is enough", async () => {
    mocks.isPolicyEnabled.mockImplementation(
      (_name: string, attributes: { user?: string }) =>
        Promise.resolve(attributes.user === OWNER_ID),
    );

    const response = await send(desktopRequest(STATUS_PATH));

    expect(response.status).toBe(200);
  });

  test("a server-targeted answer is enough", async () => {
    mocks.isPolicyEnabled.mockImplementation(
      (_name: string, attributes: { server?: string }) =>
        Promise.resolve(attributes.server === SHARED_GUILD),
    );

    const response = await send(desktopRequest(STATUS_PATH));

    expect(response.status).toBe(200);
  });

  test("an unauthenticated request is refused before the flag is read", async () => {
    mocks.findDevice.mockResolvedValue(null);
    mocks.isPolicyEnabled.mockResolvedValue(false);

    const response = await send(desktopRequest(STATUS_PATH));

    expect(await errorCode(response)).toBe("unauthorized");
    expect(mocks.isPolicyEnabled).not.toHaveBeenCalled();
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

    expect(response.headers.get(SCOUT_DESKTOP_CONTRACT_HEADER)).toBe(
      String(SCOUT_DESKTOP_CONTRACT_VERSION),
    );
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

const RUN_ID = startFixture.response.runId;
const OTHER_DEVICE_ID = "5ab3b967-64b0-43b5-96b0-6dd196a053b4";
const START_PATH = SCOUT_DESKTOP_API_ROUTES.explore_runs_start.path;
const STOP_PATH = SCOUT_DESKTOP_API_ROUTES.explore_runs_stop.path;
const ACTIVE_PATH = SCOUT_DESKTOP_API_ROUTES.explore_runs_active.path;
const OUTCOME_PATH = SCOUT_DESKTOP_API_ROUTES.explore_runs_outcome.path;
const STREAM_PATH = SCOUT_DESKTOP_API_ROUTES.explore_runs_stream.path;
const RUN_PATHS = [
  START_PATH,
  STOP_PATH,
  ACTIVE_PATH,
  OUTCOME_PATH,
  STREAM_PATH,
];

/** A golden frame of each type, by type. */
const FRAMES = new Map(
  streamFixture.response.events.map((event) => [event.type, event]),
);
function frame(type: string): unknown {
  const found = FRAMES.get(type);
  if (found === undefined) throw new Error(`no golden ${type} frame`);
  return found;
}

describe("desktop Explore run routes", () => {
  test.each(RUN_PATHS)("%s refuses a cookie-only request", async (path) => {
    const response = await send(
      new Request(`${ORIGIN}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SCOUT_DESKTOP_CONTRACT_HEADER]: "2",
          Cookie: "scout_session=signed.jwt.value; scout_csrf=csrf-token",
          "X-CSRF-Token": "csrf-token",
          Origin: ORIGIN,
        },
        body: JSON.stringify({ runId: RUN_ID }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await errorCode(response)).toBe("unauthorized");
    expect(mocks.createContext).not.toHaveBeenCalled();
    expect(mocks.findDevice).not.toHaveBeenCalled();
    expect(mocks.startRun).not.toHaveBeenCalled();
    expect(mocks.subscribeRun).not.toHaveBeenCalled();
  });

  test.each(RUN_PATHS)("%s needs the explore scope", async (path) => {
    mocks.findDevice.mockResolvedValue(device({ scopes: ["ingest"] }));

    const response = await send(
      desktopRequest(path, { body: { runId: RUN_ID } }),
    );

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("scope_required");
    expect(mocks.startRun).not.toHaveBeenCalled();
    expect(mocks.stopRun).not.toHaveBeenCalled();
    expect(mocks.subscribeRun).not.toHaveBeenCalled();
  });

  test("start answers as the owner, on the desktop surface", async () => {
    mocks.startRun.mockResolvedValue(startFixture.response);

    const response = await send(
      desktopRequest(START_PATH, { body: startFixture.request }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(startFixture.response);
    expect(mocks.startRun).toHaveBeenCalledWith(
      { userId: OWNER_ID },
      startFixture.request,
      [SHARED_GUILD],
      { surface: "desktop" },
    );
  });

  test.each([
    [
      "a busy conversation",
      () => new ExploreConversationBusyError("Busy."),
      "conversation_busy",
    ],
    [
      "Temporal down",
      () => new ExploreRunUnavailableError("Down."),
      "unavailable",
    ],
    [
      "a missing conversation",
      () => new ExploreNotFoundError("Gone."),
      "not_found",
    ],
    [
      "an invalid turn",
      () => new ExploreInvalidTurnError("No question."),
      "invalid_turn",
    ],
  ] as const)("start maps %s as the web does", async (_label, error, code) => {
    mocks.startRun.mockRejectedValue(error());

    const response = await send(
      desktopRequest(START_PATH, { body: startFixture.request }),
    );

    expect(await errorCode(response)).toBe(code);
  });

  test("an unexpected start failure is not dressed up as a refusal", async () => {
    mocks.startRun.mockRejectedValue(new Error("broken invariant"));

    await expect(
      send(desktopRequest(START_PATH, { body: startFixture.request })),
    ).rejects.toThrow("broken invariant");
  });

  test.each([
    ["an unknown key", { ...startFixture.request, surface: "web" }],
    ["no attach point", { conversationId: null, question: "x", attach: {} }],
  ])("start refuses %s before any run", async (_label, body) => {
    const response = await send(desktopRequest(START_PATH, { body }));

    expect(response.status).toBe(400);
    expect(await errorCode(response)).toBe("invalid_request");
    expect(mocks.startRun).not.toHaveBeenCalled();
  });

  test("stop stops the owner's run, and another user's run is not found", async () => {
    mocks.stopRun.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const stopped = await send(
      desktopRequest(STOP_PATH, { body: { runId: RUN_ID } }),
    );
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toEqual(stopFixture.response);
    expect(mocks.stopRun).toHaveBeenCalledWith(RUN_ID, OWNER_ID);

    const foreign = await send(
      desktopRequest(STOP_PATH, { body: { runId: RUN_ID } }),
    );
    expect(foreign.status).toBe(404);
    expect(await errorCode(foreign)).toBe("not_found");
  });

  test("active lists the owner's runs on every surface", async () => {
    mocks.listRuns.mockResolvedValue(activeFixture.response.runs);

    const response = await send(desktopRequest(ACTIVE_PATH));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(activeFixture.response);
    expect(mocks.listRuns).toHaveBeenCalledWith(OWNER_ID);
  });

  test("outcome reads the owner's finished run", async () => {
    mocks.runOutcome.mockResolvedValue("succeeded");

    const response = await send(
      desktopRequest(OUTCOME_PATH, { body: { runId: RUN_ID } }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(outcomeFixture.response);
    expect(mocks.runOutcome).toHaveBeenCalledWith(RUN_ID, OWNER_ID);
  });
});

describe("desktop turns share the owner's Explore quota with the web", () => {
  /** The identity the web's `explore.start` uses for this owner. */
  const OWNER_IDENTITY = { userId: DiscordAccountIdSchema.parse(OWNER_ID) };

  // The web's `explore.start` and the desktop route call the same manager
  // with the same `{ userId }` identity. A real manager (inline, so a refusal
  // never reaches Postgres) proves the desktop is held to what the web spent.
  beforeEach(() => {
    const manager = new ExploreRunManager({ inlineExecutionForTests: true });
    mocks.startRun.mockImplementation((identity, request, guildIds, context) =>
      manager.start(identity, request, guildIds, context),
    );
  });

  test("a web answer in flight holds a desktop turn back", async () => {
    const web = tryStartExploreTurn(OWNER_IDENTITY);
    if (!web.allowed) throw new Error("the web turn should start");

    const response = await send(
      desktopRequest(START_PATH, { body: startFixture.request }),
    );

    expect(response.status).toBe(429);
    expect(await errorCode(response)).toBe("quota_exceeded");
    expect(response.headers.get("Retry-After")).toBe("30");
    web.finish();
  });

  test("questions asked on the web count against the desktop", async () => {
    for (let turn = 0; turn < exploreQuotaLimits().userMinute; turn += 1) {
      const web = tryStartExploreTurn(OWNER_IDENTITY);
      if (!web.allowed) throw new Error("the web turn should start");
      web.commit();
      web.finish();
    }

    const response = await send(
      desktopRequest(START_PATH, { body: startFixture.request }),
    );

    expect(response.status).toBe(429);
    expect(await errorCode(response)).toBe("quota_exceeded");
    expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

type Frame = { readonly event: string; readonly data: unknown };

/** Read SSE frames from a response one at a time, as the client does. */
function frames(response: Response) {
  if (response.body === null) throw new Error("stream has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  return {
    async next(): Promise<Frame | null> {
      for (;;) {
        const end = buffered.indexOf("\n\n");
        if (end !== -1) {
          const [eventLine = "", dataLine = ""] = buffered
            .slice(0, end)
            .split("\n");
          buffered = buffered.slice(end + 2);
          const data: unknown = JSON.parse(dataLine.slice("data: ".length));
          return { event: eventLine.slice("event: ".length), data };
        }
        const chunk = await reader.read();
        if (chunk.done) return null;
        buffered += decoder.decode(chunk.value, { stream: true });
      }
    },
    cancel: () => reader.cancel(),
  };
}

async function openStream(runId: string = RUN_ID): Promise<Response> {
  return await send(desktopRequest(STREAM_PATH, { body: { runId } }));
}

async function openStreamStatus(): Promise<number> {
  const response = await openStream();
  return response.status;
}

/** The next frame's type and body, or undefined once the stream ends. */
async function nextEvent(reader: ReturnType<typeof frames>) {
  const next = await reader.next();
  return next?.event;
}
async function nextData(reader: ReturnType<typeof frames>) {
  const next = await reader.next();
  return next?.data;
}

describe("desktop run stream", () => {
  let subscribers: ((event: unknown) => void)[] = [];
  let unsubscribed = 0;

  beforeEach(() => {
    subscribers = [];
    unsubscribed = 0;
    // What the manager does on every attach: a snapshot, then the table, then
    // live events until `done`.
    mocks.subscribeRun.mockImplementation((runId, userId, subscriber) => {
      if (runId !== RUN_ID || userId !== OWNER_ID) return Promise.resolve(null);
      subscriber(frame("snapshot"));
      subscriber(frame("run_preview"));
      subscribers.push(subscriber);
      return Promise.resolve(() => {
        unsubscribed += 1;
      });
    });
  });

  test("a started run streams its snapshot, live events and done", async () => {
    mocks.startRun.mockResolvedValue(startFixture.response);
    const started = await send(
      desktopRequest(START_PATH, { body: startFixture.request }),
    );
    expect(started.status).toBe(200);

    const response = await openStream();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(response.headers.get(SCOUT_DESKTOP_CONTRACT_HEADER)).toBe(
      String(SCOUT_DESKTOP_CONTRACT_VERSION),
    );
    const reader = frames(response);
    expect(await nextData(reader)).toEqual(frame("snapshot"));
    expect(await nextEvent(reader)).toBe("run_preview");
    expect(desktopStreamsHeldForTests(DEVICE_ID)).toBe(1);

    subscribers[0]?.(frame("answer_delta"));
    subscribers[0]?.(frame("done"));

    expect(await reader.next()).toEqual({
      event: "answer_delta",
      data: frame("answer_delta"),
    });
    expect(await nextData(reader)).toEqual(frame("done"));
    expect(await reader.next()).toBeNull();
    expect(desktopStreamsHeldForTests(DEVICE_ID)).toBe(0);
    expect(mocks.subscribeRun).toHaveBeenCalledWith(
      RUN_ID,
      OWNER_ID,
      expect.any(Function),
    );
  });

  test("a reconnect starts again from a whole snapshot", async () => {
    const first = frames(await openStream());
    expect(await nextEvent(first)).toBe("snapshot");
    await first.cancel();
    expect(unsubscribed).toBe(1);
    expect(desktopStreamsHeldForTests(DEVICE_ID)).toBe(0);

    const second = frames(await openStream());

    expect(await nextData(second)).toEqual(frame("snapshot"));
    expect(desktopStreamsHeldForTests(DEVICE_ID)).toBe(1);
  });

  test("another user's run is not found and holds no slot", async () => {
    const response = await openStream(getFixture.response.conversation.id);

    expect(response.status).toBe(404);
    expect(await errorCode(response)).toBe("not_found");
    expect(desktopStreamsHeldForTests(DEVICE_ID)).toBe(0);
  });

  test("each device may hold only so many streams at once", async () => {
    const open = [];
    for (let stream = 0; stream < DESKTOP_STREAMS_PER_DEVICE; stream += 1) {
      const response = await openStream();
      expect(response.status).toBe(200);
      open.push(frames(response));
    }

    const refused = await openStream();
    expect(refused.status).toBe(429);
    expect(await errorCode(refused)).toBe("stream_limit");
    expect(mocks.subscribeRun).toHaveBeenCalledTimes(
      DESKTOP_STREAMS_PER_DEVICE,
    );

    // The cap is per device: the owner's other computer is unaffected.
    mocks.findDevice.mockResolvedValueOnce(device({ id: OTHER_DEVICE_ID }));
    expect(await openStreamStatus()).toBe(200);

    // Closing one stream frees its slot.
    await open[0]?.cancel();
    expect(await openStreamStatus()).toBe(200);
  });
});

describe("conversation origin by contract version", () => {
  const desktopConversation = {
    ...getFixture.response.conversation,
    origin: "desktop",
  };

  test.each([
    ["1", "web"],
    ["2", "desktop"],
  ])(
    "a version-%s client reads a desktop conversation as %s",
    async (version, origin) => {
      mocks.listConversations.mockResolvedValue([desktopConversation]);
      mocks.loadTranscript.mockResolvedValue({
        ...getFixture.response,
        conversation: desktopConversation,
      });
      const headers = { [SCOUT_DESKTOP_CONTRACT_HEADER]: version };

      const listed = await send(desktopRequest(LIST_PATH, { headers }));
      const list = ScoutDesktopConversationListResponseSchema.parse(
        await listed.json(),
      );
      const read = await send(
        desktopRequest(GET_PATH, {
          headers,
          body: { conversationId: CONVERSATION_ID },
        }),
      );
      const transcript = ScoutDesktopConversationGetResponseSchema.parse(
        await read.json(),
      );

      expect(list.conversations.map((entry) => entry.origin)).toEqual([origin]);
      expect(transcript.conversation.origin).toBe(origin);
    },
  );
});
