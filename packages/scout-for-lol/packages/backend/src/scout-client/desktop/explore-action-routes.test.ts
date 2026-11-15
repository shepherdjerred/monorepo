import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  DiscordAccountIdSchema,
  EXPLORE_ATTACHMENT_MAX_BYTES,
  EXPLORE_MODEL_OPTIONS,
  SCOUT_DESKTOP_API_ROUTES,
  SCOUT_DESKTOP_CONTRACT_HEADER,
  ScoutDesktopApiErrorSchema,
  ScoutDesktopModelsResponseSchema,
} from "@scout-for-lol/data";
import { TRPCError } from "@trpc/server";
import { resetConfigurationForTests } from "#src/configuration.ts";
import modelsFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-models.json" with { type: "json" };
import setLeafFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-conversations-set-leaf.json" with { type: "json" };
import shareFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-conversations-share.json" with { type: "json" };
import revokeFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-conversations-revoke-share.json" with { type: "json" };
import uploadFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-attachments-upload.json" with { type: "json" };
import discardFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-attachments-discard.json" with { type: "json" };
import actionsFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-runs-start-actions.json" with { type: "json" };
import startFixture from "@scout-for-lol/data/scout-client/desktop-fixtures/explore-runs-start.json" with { type: "json" };
import { exploreQuotaLimits } from "#src/config/dynamic.ts";

/**
 * Database-free tests of the desktop chat action routes: authentication and
 * scope, the per-device read and write limits, ownership as `not_found`, and
 * what edit and regenerate share with the web. Every store and storage
 * function is a spy; the integration test beside the run routes exercises
 * the real ones against PostgreSQL.
 */

const mocks = vi.hoisted(() => ({
  findDevice: vi.fn(),
  findUser: vi.fn(),
  fetchUserGuilds: vi.fn(),
  createContext: vi.fn(),
  isPolicyEnabled: vi.fn(),
  setLeaf: vi.fn(),
  share: vi.fn(),
  revoke: vi.fn(),
  upload: vi.fn(),
  discard: vi.fn(),
  startRun: vi.fn(),
  pickerEnabled: vi.fn(),
}));

// A cookie session is resolved only by tRPC's context, which these routes
// must never reach; it is a spy that rejects.
vi.mock("#src/trpc/context.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  createContext: mocks.createContext,
}));
vi.mock("#src/database/index.ts", () => ({
  prisma: {
    user: { findUniqueOrThrow: mocks.findUser },
    scoutClientDevice: { findUnique: mocks.findDevice },
  },
}));
vi.mock("#src/lib/discord-rest.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  fetchUserGuilds: mocks.fetchUserGuilds,
}));
vi.mock("#src/configuration/flags.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  isPolicyEnabled: mocks.isPolicyEnabled,
}));
vi.mock("#src/config/dynamic.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  exploreModelPickerEnabled: mocks.pickerEnabled,
}));
vi.mock("#src/explore/store.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  setExploreLeaf: mocks.setLeaf,
  shareExploreConversation: mocks.share,
  revokeExploreShare: mocks.revoke,
}));
vi.mock("#src/explore/attachments/storage.ts", () => ({
  uploadExploreAttachment: mocks.upload,
  discardExploreAttachment: mocks.discard,
}));
vi.mock("#src/explore/runs/run-manager.ts", async (importOriginal) => ({
  ...(await importOriginal()),
  exploreRunManager: { start: mocks.startRun },
}));

const { handleScoutClientRoute } = await import("#src/scout-client/http.ts");
const { resetDesktopReadRateLimitForTests, DESKTOP_READ_LIMIT_PER_MINUTE } =
  await import("./rate-limit.ts");
const { DESKTOP_WRITE_LIMITS_PER_MINUTE, resetDesktopWriteRateLimitsForTests } =
  await import("./rate-limit.ts");
const { UPLOAD_BODY_MAX_BYTES } = await import("./explore-action-routes.ts");
const { resetExploreRateLimitStateForTests, tryStartExploreTurn } =
  await import("#src/explore/rate-limit.ts");
const { ExploreRunManager } = await import("#src/explore/runs/run-manager.ts");

const TOKEN = `sct_${"a".repeat(43)}`;
const OWNER_ID = "160509172704739328";
const DEVICE_ID = "4fa2a856-53af-42a4-85af-5cc085a942a3";
const SHARED_GUILD = "111111111111111111";
const ORIGIN = "https://scout.invalid";
const CONVERSATION_ID = shareFixture.request.conversationId;
const originalEnvironment = Bun.env["ENVIRONMENT"];
const originalAllowlist = Bun.env["EXPLORE_GUILD_ALLOWLIST"];

const MODELS = SCOUT_DESKTOP_API_ROUTES.explore_models.path;
const SET_LEAF = SCOUT_DESKTOP_API_ROUTES.explore_conversations_set_leaf.path;
const SHARE = SCOUT_DESKTOP_API_ROUTES.explore_conversations_share.path;
const REVOKE = SCOUT_DESKTOP_API_ROUTES.explore_conversations_revoke_share.path;
const UPLOAD = SCOUT_DESKTOP_API_ROUTES.explore_attachments_upload.path;
const DISCARD = SCOUT_DESKTOP_API_ROUTES.explore_attachments_discard.path;
const START = SCOUT_DESKTOP_API_ROUTES.explore_runs_start.path;

/** Each new route with a body it accepts, and what answers it. */
const ACTION_ROUTES = [
  ["models", MODELS, modelsFixture.request],
  ["set-leaf", SET_LEAF, setLeafFixture.request],
  ["share", SHARE, shareFixture.request],
  ["revoke-share", REVOKE, revokeFixture.request],
  ["upload", UPLOAD, uploadFixture.request],
  ["discard", DISCARD, discardFixture.request],
] as const;

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

function desktopRequest(path: string, body: unknown = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
      [SCOUT_DESKTOP_CONTRACT_HEADER]: "4",
    },
    body: JSON.stringify(body),
  });
}

async function send(path: string, body: unknown = {}): Promise<Response> {
  const request = desktopRequest(path, body);
  const response = await handleScoutClientRoute(request, new URL(request.url));
  if (response === null) throw new Error("route was not handled");
  return response;
}

async function statusOf(path: string, body: unknown = {}): Promise<number> {
  const response = await send(path, body);
  return response.status;
}

async function codeOf(path: string, body: unknown = {}) {
  const response = await send(path, body);
  return await errorCode(response);
}

async function jsonOf(path: string, body: unknown = {}): Promise<unknown> {
  const response = await send(path, body);
  return await response.json();
}

async function errorCode(response: Response) {
  return ScoutDesktopApiErrorSchema.parse(await response.json()).error;
}

beforeEach(() => {
  vi.clearAllMocks();
  Bun.env["ENVIRONMENT"] = "beta";
  Bun.env["EXPLORE_GUILD_ALLOWLIST"] = SHARED_GUILD;
  resetConfigurationForTests();
  resetDesktopReadRateLimitForTests();
  resetDesktopWriteRateLimitsForTests();
  resetExploreRateLimitStateForTests();
  mocks.isPolicyEnabled.mockResolvedValue(true);
  mocks.findDevice.mockResolvedValue(device());
  mocks.findUser.mockResolvedValue({
    discordId: OWNER_ID,
    discordUsername: "owner",
  });
  mocks.fetchUserGuilds.mockResolvedValue([
    { id: SHARED_GUILD, name: "S", icon: null, owner: false, permissions: "0" },
  ]);
  mocks.createContext.mockRejectedValue(new Error("no cookie sessions here"));
  mocks.pickerEnabled.mockReturnValue(true);
  mocks.setLeaf.mockResolvedValue(true);
  mocks.share.mockResolvedValue(shareFixture.response.shareToken);
  mocks.revoke.mockResolvedValue(true);
  mocks.upload.mockResolvedValue(uploadFixture.response);
  mocks.discard.mockResolvedValue(true);
});

function restoreVariable(name: string, original: string | undefined) {
  if (original === undefined) Reflect.deleteProperty(Bun.env, name);
  else Bun.env[name] = original;
}

afterAll(() => {
  restoreVariable("ENVIRONMENT", originalEnvironment);
  restoreVariable("EXPLORE_GUILD_ALLOWLIST", originalAllowlist);
  resetConfigurationForTests();
});

describe("desktop chat action routes: authentication", () => {
  test.each(ACTION_ROUTES)(
    "%s refuses a request with no device credential",
    async (_name, path, body) => {
      mocks.findDevice.mockResolvedValue(null);

      const response = await send(path, body);

      expect(response.status).toBe(401);
      expect(await errorCode(response)).toBe("unauthorized");
      expect(mocks.createContext).not.toHaveBeenCalled();
    },
  );

  test.each(ACTION_ROUTES)(
    "%s needs the explore scope",
    async (_name, path, body) => {
      mocks.findDevice.mockResolvedValue(device({ scopes: ["ingest"] }));

      const response = await send(path, body);

      expect(response.status).toBe(403);
      expect(await errorCode(response)).toBe("scope_required");
    },
  );

  test.each(ACTION_ROUTES)(
    "%s is refused while the desktop Explore flag is off",
    async (_name, path, body) => {
      mocks.isPolicyEnabled.mockResolvedValue(false);

      const response = await send(path, body);

      expect(response.status).toBe(503);
      expect(await errorCode(response)).toBe("feature_disabled");
      for (const spy of [
        mocks.setLeaf,
        mocks.share,
        mocks.revoke,
        mocks.upload,
        mocks.discard,
      ]) {
        expect(spy).not.toHaveBeenCalled();
      }
    },
  );

  test("an owner who shares no eligible server is forbidden", async () => {
    mocks.fetchUserGuilds.mockResolvedValue([]);

    const response = await send(SHARE, shareFixture.request);

    expect(response.status).toBe(403);
    expect(await errorCode(response)).toBe("explore_forbidden");
    expect(mocks.share).not.toHaveBeenCalled();
  });
});

describe("desktop chat action routes: limits", () => {
  test.each(ACTION_ROUTES)(
    "%s is counted by the per-device read limiter",
    async (_name, path, body) => {
      // A route the read limiter counts is refused once the device has used
      // its minute, before any store call.
      for (let call = 0; call < DESKTOP_READ_LIMIT_PER_MINUTE; call += 1) {
        resetDesktopWriteRateLimitsForTests();
        expect(await statusOf(path, body)).toBe(200);
      }
      resetDesktopWriteRateLimitsForTests();

      const response = await send(path, body);

      expect(response.status).toBe(429);
      expect(await errorCode(response)).toBe("rate_limited");
      expect(response.headers.get("Retry-After")).toBe("60");
    },
  );

  test.each([
    ["share", SHARE, shareFixture.request, () => mocks.share],
    [
      "revoke-share (the same bucket)",
      REVOKE,
      revokeFixture.request,
      () => mocks.revoke,
    ],
  ] as const)(
    "%s is held to the share write limit",
    async (_label, path, body, spy) => {
      for (
        let call = 0;
        call < DESKTOP_WRITE_LIMITS_PER_MINUTE.share;
        call += 1
      ) {
        expect(await statusOf(SHARE, shareFixture.request)).toBe(200);
      }
      spy().mockClear();

      const response = await send(path, body);

      expect(response.status).toBe(429);
      expect(await errorCode(response)).toBe("rate_limited");
      expect(spy()).not.toHaveBeenCalled();
    },
  );

  test("attachment uploads and discards share one write limit", async () => {
    const half = DESKTOP_WRITE_LIMITS_PER_MINUTE.attachment / 2;
    for (let call = 0; call < half; call += 1) {
      expect(await statusOf(UPLOAD, uploadFixture.request)).toBe(200);
      expect(await statusOf(DISCARD, discardFixture.request)).toBe(200);
    }
    mocks.upload.mockClear();

    const response = await send(UPLOAD, uploadFixture.request);

    expect(await errorCode(response)).toBe("rate_limited");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  test("switching versions is held to the edit limit", async () => {
    for (let call = 0; call < DESKTOP_WRITE_LIMITS_PER_MINUTE.edit; call += 1) {
      expect(await statusOf(SET_LEAF, setLeafFixture.request)).toBe(200);
    }

    const response = await send(SET_LEAF, setLeafFixture.request);

    expect(await errorCode(response)).toBe("rate_limited");
  });

  test("a write limit is per device, and reads never spend it", async () => {
    for (
      let call = 0;
      call < DESKTOP_WRITE_LIMITS_PER_MINUTE.share;
      call += 1
    ) {
      await send(SHARE, shareFixture.request);
    }
    expect(await codeOf(SHARE, shareFixture.request)).toBe("rate_limited");

    mocks.findDevice.mockResolvedValue(
      device({ id: "8c1d0f52-9b3e-4f7a-a6d1-2e5b7c9d1f34" }),
    );
    expect(await statusOf(SHARE, shareFixture.request)).toBe(200);
    expect(await statusOf(MODELS, {})).toBe(200);
  });

  test("an upload body over the web's image cap is refused unread", async () => {
    const base64 = "A".repeat(UPLOAD_BODY_MAX_BYTES + 1);

    const response = await send(UPLOAD, { mediaType: "image/png", base64 });

    expect(await errorCode(response)).toBe("invalid_request");
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  test("the upload limit is the web's ten MiB", () => {
    expect(EXPLORE_ATTACHMENT_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(UPLOAD_BODY_MAX_BYTES).toBeGreaterThan(
      Math.ceil((EXPLORE_ATTACHMENT_MAX_BYTES * 4) / 3),
    );
  });
});

describe("desktop chat action routes: ownership", () => {
  test("set-leaf, share, revoke-share and discard act as the owner", async () => {
    await send(SET_LEAF, setLeafFixture.request);
    await send(SHARE, shareFixture.request);
    await send(REVOKE, revokeFixture.request);
    await send(DISCARD, discardFixture.request);

    expect(mocks.setLeaf).toHaveBeenCalledWith(
      expect.anything(),
      setLeafFixture.request.conversationId,
      OWNER_ID,
      setLeafFixture.request.messageId,
    );
    expect(mocks.share).toHaveBeenCalledWith(
      expect.anything(),
      CONVERSATION_ID,
      OWNER_ID,
    );
    expect(mocks.revoke).toHaveBeenCalledWith(
      expect.anything(),
      CONVERSATION_ID,
      OWNER_ID,
    );
    expect(mocks.discard).toHaveBeenCalledWith(
      expect.anything(),
      OWNER_ID,
      discardFixture.request.id,
    );
  });

  test.each([
    {
      label: "set-leaf",
      path: SET_LEAF,
      body: setLeafFixture.request,
      store: "setLeaf",
      refusal: false,
    },
    {
      label: "share",
      path: SHARE,
      body: shareFixture.request,
      store: "share",
      refusal: null,
    },
    {
      label: "revoke-share",
      path: REVOKE,
      body: revokeFixture.request,
      store: "revoke",
      refusal: false,
    },
    {
      label: "discard",
      path: DISCARD,
      body: discardFixture.request,
      store: "discard",
      refusal: false,
    },
  ] as const)(
    "$label of another user's thing is a 404, like a missing one",
    async ({ path, body, store, refusal }) => {
      mocks[store].mockResolvedValue(refusal);

      expect(await statusOf(path, body)).toBe(404);
      expect(await codeOf(path, body)).toBe("not_found");
    },
  );

  test("an upload is stored under the owner and answers the web's body", async () => {
    const response = await send(UPLOAD, uploadFixture.request);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(uploadFixture.response);
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.anything(),
      OWNER_ID,
      uploadFixture.request,
    );
  });

  test.each([
    ["a bad image", "BAD_REQUEST", "invalid_request", 400],
    ["the owner's upload caps", "TOO_MANY_REQUESTS", "quota_exceeded", 429],
    ["missing image storage", "SERVICE_UNAVAILABLE", "unavailable", 503],
  ] as const)(
    "an upload refused for %s is a typed refusal",
    async (_label, code, expected, status) => {
      mocks.upload.mockRejectedValue(new TRPCError({ code, message: "No." }));

      const response = await send(UPLOAD, uploadFixture.request);

      expect(response.status).toBe(status);
      expect(await errorCode(response)).toBe(expected);
    },
  );

  test("an unexpected upload failure is not dressed up as a refusal", async () => {
    mocks.upload.mockRejectedValue(new Error("broken invariant"));

    await expect(send(UPLOAD, uploadFixture.request)).rejects.toThrow(
      "broken invariant",
    );
  });

  test.each([
    ["set-leaf", SET_LEAF, { conversationId: CONVERSATION_ID }],
    ["share", SHARE, { conversationId: "nope" }],
    ["revoke-share", REVOKE, { ...revokeFixture.request, extra: 1 }],
    ["upload", UPLOAD, { mediaType: "image/gif", base64: "AAAA" }],
    ["discard", DISCARD, { id: "1" }],
    ["models", MODELS, { all: true }],
  ] as const)(
    "%s refuses a body that does not match",
    async (_n, path, body) => {
      const response = await send(path, body);

      expect(response.status).toBe(400);
      expect(await errorCode(response)).toBe("invalid_request");
    },
  );
});

describe("desktop chat action routes: models", () => {
  test("lists the web picker's models while the picker is on", async () => {
    const response = await send(MODELS, {});

    expect(
      ScoutDesktopModelsResponseSchema.parse(await response.json()),
    ).toEqual(modelsFixture.response);
    expect(modelsFixture.response.models).toEqual([...EXPLORE_MODEL_OPTIONS]);
  });

  test("offers nothing to pick while the picker is off", async () => {
    mocks.pickerEnabled.mockReturnValue(false);

    const body = ScoutDesktopModelsResponseSchema.parse(
      await jsonOf(MODELS, {}),
    );

    expect(body.pickerEnabled).toBe(false);
    expect(body.models).toEqual([]);
  });
});

describe("edit and regenerate run through runs/start", () => {
  const OWNER_IDENTITY = { userId: DiscordAccountIdSchema.parse(OWNER_ID) };
  const edit = actionsFixture.requests[0]?.request;
  const regenerate = actionsFixture.requests[2]?.request;

  beforeEach(() => {
    const manager = new ExploreRunManager({ inlineExecutionForTests: true });
    mocks.startRun.mockImplementation((identity, request, guildIds, context) =>
      manager.start(identity, request, guildIds, context),
    );
  });

  test("an edit and a regenerate start as the owner with their attach point", async () => {
    mocks.startRun.mockResolvedValue(startFixture.response);

    await send(START, edit);
    await send(START, regenerate);

    expect(mocks.startRun).toHaveBeenNthCalledWith(
      1,
      { userId: OWNER_ID },
      edit,
      [SHARED_GUILD],
      { surface: "desktop" },
    );
    expect(mocks.startRun).toHaveBeenNthCalledWith(
      2,
      { userId: OWNER_ID },
      regenerate,
      [SHARED_GUILD],
      { surface: "desktop" },
    );
  });

  test("forking is held to the edit limit; asking is not", async () => {
    mocks.startRun.mockResolvedValue(startFixture.response);
    for (let call = 0; call < DESKTOP_WRITE_LIMITS_PER_MINUTE.edit; call += 1) {
      expect(await statusOf(START, regenerate)).toBe(200);
    }
    mocks.startRun.mockClear();

    const refused = await send(START, regenerate);
    const asked = await send(START, {
      ...startFixture.request,
      conversationId: CONVERSATION_ID,
    });

    expect(await errorCode(refused)).toBe("rate_limited");
    expect(asked.status).toBe(200);
    expect(mocks.startRun).toHaveBeenCalledTimes(1);
  });

  test("a regenerate spends the quota questions on the web spent", async () => {
    for (let turn = 0; turn < exploreQuotaLimits().userMinute; turn += 1) {
      const web = tryStartExploreTurn(OWNER_IDENTITY);
      if (!web.allowed) throw new Error("the web turn should start");
      web.commit();
      web.finish();
    }

    const response = await send(START, regenerate);

    expect(response.status).toBe(429);
    expect(await errorCode(response)).toBe("quota_exceeded");
  });

  test("an answer already running holds an edit back", async () => {
    const web = tryStartExploreTurn(OWNER_IDENTITY);
    if (!web.allowed) throw new Error("the web turn should start");

    const response = await send(START, edit);

    expect(await errorCode(response)).toBe("quota_exceeded");
    web.finish();
  });
});
