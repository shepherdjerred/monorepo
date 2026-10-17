import { describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { createMediaApp, type MediaAppDependencies } from "./app.ts";
import { MediaError } from "#application/errors.ts";
import type { MediaActor } from "#application/auth.ts";
import type { MediaApplication } from "#application/ports.ts";
import type { NotificationApplication } from "#application/notification-ports.ts";
import { verifyRevokedRetryHttp } from "./retry-http.test-support.ts";
import { verifyIdentityHttp } from "./media/identity-http.test-support.ts";
import { verifyVisibilityHttp } from "./media/visibility-http.test-support.ts";
import { verifyDefaultCommandsHttp } from "./media/edition-http.test-support.ts";
import { verifyDefaultReplayHttp } from "./media/edition-replay.test-support.ts";
import { verifyPlexEventHttp } from "./plex-events/http.test-support.ts";

const actor: MediaActor = {
  id: "member",
  plexAccountId: "plex-member",
  displayName: "Member",
  role: "member",
  restricted: false,
  version: 0,
};
const migrationFixture: MediaAppDependencies["migrationAdmin"] = {
  async discover() {
    throw new MediaError("unavailable", "No fixture catalog", 503);
  },
  bundles: {
    async create() {
      throw new MediaError("invalid_bundle", "No fixture bundle", 422);
    },
    async detail() {
      throw new MediaError("not_found", "No fixture bundle", 404);
    },
    async list() {
      return [];
    },
    async review() {
      return { status: "completed" };
    },
  },
  async detail() {
    throw new MediaError("not_found", "No fixture proposal", 404);
  },
  async list() {
    return [];
  },
  async upload() {
    throw new MediaError("invalid_capture", "No fixture capture", 422);
  },
  async review() {
    return { status: "completed" };
  },
};

const handoffFixture = {
  async prepare() {
    throw new Error("Unexpected fixture handoff prepare");
  },
  async detail() {
    throw new Error("Unexpected fixture handoff detail");
  },
  async apply() {
    throw new Error("Unexpected fixture handoff apply");
  },
};
const numberingFixture = {
  groups: unavailableSubtitleReplacement,
  group: unavailableSubtitleReplacement,
  previewGroup: unavailableSubtitleReplacement,
  commitGroup: unavailableSubtitleReplacement,
  async series() {
    return [];
  },
  async episodes() {
    return [];
  },
  async save() {
    return { status: "completed" as const };
  },
};
const recoveryFixture = {
  list: async () => ({ authority: null, holds: [], reviews: [] }),
  detail: async () => {
    throw new Error("Unexpected recovery detail");
  },
  prepare: async () => {
    throw new Error("Unexpected recovery prepare");
  },
  respond: async () => {
    throw new Error("Unexpected recovery response");
  },
  release: async () => {
    throw new Error("Unexpected recovery release");
  },
};

function nativeRecoveryFixture() {
  return {
    async prepareQuarantine(): Promise<never> {
      throw new MediaError("conflict", "No fixture quarantine recovery", 409);
    },
    async inventory() {
      return {
        runtime: { mode: "observe", recoveryEpoch: 0, version: 0 },
        restoreOperationId: null,
        assets: [],
        plans: [],
        nextCursor: null,
        prerequisites: [],
      };
    },
    async prepare(): Promise<never> {
      throw new MediaError("conflict", "No fixture native recovery", 409);
    },
    async detail(): Promise<never> {
      throw new MediaError("conflict", "No fixture native recovery", 409);
    },
    async apply(): Promise<never> {
      throw new MediaError("conflict", "No fixture native recovery", 409);
    },
  };
}

async function unavailableSubtitleReplacement(): Promise<never> {
  throw new MediaError("conflict", "No fixture subtitle replacement", 409);
}
function subtitleReplacementFixture() {
  return {
    list: async () => ({ items: [], nextCursor: null }),
    detail: unavailableSubtitleReplacement,
    prepare: unavailableSubtitleReplacement,
    apply: unavailableSubtitleReplacement,
    reconcile: unavailableSubtitleReplacement,
  };
}

function mediaFixture() {
  const act = vi.fn<MediaApplication["act"]>(async () => ({
    status: "queued",
    operationId: "operation",
  }));
  const createRequest = vi.fn<MediaApplication["createRequest"]>(async () => ({
    status: "queued",
    operationId: "operation",
  }));
  const media: MediaApplication = {
    getDefaultCommandContext: unavailableSubtitleReplacement,
    executeDefaultCommand: unavailableSubtitleReplacement,
    identityPreview: unavailableSubtitleReplacement,
    createRequest,
    act,
    async cancelRequest() {
      return { status: "completed" };
    },
    async listRequests() {
      return [];
    },
    async getMedia() {
      throw new MediaError("media_not_found", "Missing", 404);
    },
    async activity() {
      return [];
    },
    async removals() {
      return [];
    },
    async notifications() {
      return [];
    },
    async profiles() {
      return [];
    },
    async profileDefaults() {
      return [];
    },
    async setProfileDefault() {
      return { status: "completed" };
    },
    async listUsers() {
      return [];
    },
    async restrictUser() {
      return { status: "completed" };
    },
    async releases() {
      return [];
    },
    async saveProfile() {
      return { status: "completed" };
    },
    async assignProfile() {
      return { status: "queued" };
    },
  };
  return { media, act, createRequest };
}

function fixture() {
  const { media, act, createRequest } = mediaFixture();
  const notifications: NotificationApplication = {
    async retryDelivery() {
      return { status: "queued" };
    },
    async reconcileDelivery() {
      return { status: "queued" };
    },
    async preferences() {
      return {
        email: null,
        emailVerified: false,
        discordLinked: false,
        discordAvailable: false,
        emailEnabled: false,
        discordEnabled: false,
        upgrades: false,
        removalCompleted: false,
        version: 0,
      };
    },
    async updatePreferences() {
      return { status: "completed" };
    },
    async requestEmailVerification() {
      return { status: "queued" };
    },
    async verifyEmail() {
      return { status: "completed" };
    },
    async startDiscordLink() {
      return { authorizationUrl: "https://discord.com/oauth2/authorize" };
    },
    async completeDiscordLink() {
      return { status: "completed" };
    },
    async unlinkDiscord() {
      return { status: "completed" };
    },
  };
  const dependencies: MediaAppDependencies = {
    plexEvents: {
      secret: undefined,
      enabled: async () => false,
      ingress: {
        accept: async () => {
          throw new Error("Unexpected Plex event");
        },
      },
    },
    capacityAdmin: {
      capacity: () =>
        Promise.resolve({
          schemaVersion: 1,
          samplingEnabled: false,
          asOf: new Date().toISOString(),
          roles: [
            {
              role: "movies",
              state: "missing",
              reason: "mount_missing",
              sampledAt: null,
              totalBytes: null,
              availableBytes: null,
            },
            {
              role: "tv",
              state: "missing",
              reason: "mount_missing",
              sampledAt: null,
              totalBytes: null,
              availableBytes: null,
            },
          ],
        }),
    },
    auth: {
      async start() {
        return {
          id: crypto.randomUUID(),
          authorizationUrl: "https://app.plex.tv/auth",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          browserToken: "browser-token",
        };
      },
      async poll() {
        return {
          actor,
          sessionToken: "session-token",
          csrfToken: "csrf-token",
          expiresAt: new Date(Date.now() + 60_000),
        };
      },
      async authenticate(token) {
        if (token !== "session-token")
          throw new MediaError("unauthenticated", "Sign in", 401);
        return { actor, csrfHash: "csrf-hash" };
      },
      verifyCsrf(token) {
        if (token !== "csrf-token")
          throw new MediaError("csrf_required", "CSRF required", 403);
      },
      async logout() {
        return;
      },
    },
    media,
    notifications,
    admin: {
      async providers() {
        return [];
      },
      async saveProvider() {
        return { status: "completed" };
      },
      async subtitleTargets() {
        return [];
      },
      async uploadSubtitle() {
        return { status: "queued" };
      },
    },
    plexAdmin: {
      async profiles() {
        return { homeUsers: [], serverAccounts: [], mappings: [] };
      },
      async saveProfile() {
        return { status: "completed" };
      },
      async refreshProfileAccess() {
        /* Fixture explicitly authorizes the profile. */
      },
    },
    numberingAdmin: numberingFixture,
    migrationAdmin: migrationFixture,
    handoffAdmin: handoffFixture,
    nativeRecoveryAdmin: nativeRecoveryFixture(),
    subtitleReplacements: subtitleReplacementFixture(),
    recoveryAdmin: recoveryFixture,
    legacyRequesterBindings: {
      list: unavailableSubtitleReplacement,
      bind: unavailableSubtitleReplacement,
    },
    plexExclusionAdmin: {
      async list() {
        return {
          runtime: { mode: "observe", recoveryEpoch: 0, version: 0 },
          runs: [],
        };
      },
      async recover() {
        throw new MediaError("conflict", "No fixture exclusion plan", 409);
      },
      async prepare() {
        throw new MediaError("conflict", "No fixture exclusion plan", 409);
      },
      async detail() {
        throw new MediaError("not_found", "No fixture exclusion plan", 404);
      },
      async execute() {
        throw new MediaError("conflict", "No fixture exclusion plan", 409);
      },
    },
    catalog: {
      async search() {
        return { page: 1, totalPages: 0, results: [] };
      },
      async details() {
        throw new MediaError("not_found", "Missing", 404);
      },
      async adopt() {
        return { mediaId: "media" };
      },
    },
    publicOrigin: "https://media.example.test",
    requestsEnabled: async () => true,
    onError: vi.fn(),
  };
  return { dependencies, act, createRequest };
}

const headers = {
  Origin: "https://media.example.test",
  Cookie: "__Host-media-session=session-token",
  "X-CSRF-Token": "csrf-token",
  "Content-Type": "application/json",
  "Idempotency-Key": "request-key",
};

test("detail GET rechecks current role/library and does not leak raw observations or other household data", async () => {
  await verifyVisibilityHttp(fixture().dependencies, headers);
}, 60_000);

test("v2 commands use current scoped CAS and preserve revoked-access request controls", async () => {
  await verifyDefaultCommandsHttp(fixture().dependencies, headers);
});

test("v2 HTTP replay precedes mutable gate/proxy refresh but fresh commands remain authorized", async () => {
  await verifyDefaultReplayHttp(fixture().dependencies, headers);
});

test("capacity route is registered behind normal session authentication", async () => {
  const { dependencies } = fixture();
  const app = createMediaApp(dependencies);
  const denied = await app.request("/api/v1/admin/capacity");
  expect(denied.status).toBe(401);
  const response = await app.request("/api/v1/admin/capacity", { headers });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    schemaVersion: 1,
    samplingEnabled: false,
  });
});

test("Plex hints authenticate before body reads and sanitize all event errors", async () => {
  await verifyPlexEventHttp(fixture().dependencies);
});

describe("media HTTP security and errors", () => {
  test("identity preview and selection use current scoped owner authority and strict input", async () => {
    await verifyIdentityHttp(fixture().dependencies, headers);
  });
  test("Retry reauthorizes current DB access after authentication while Keep remains protective", async () => {
    await verifyRevokedRetryHttp(fixture().dependencies, headers);
  }, 60_000);
  test("recovery declarations use current authenticated identity and enforce CSRF before service calls", async () => {
    const { dependencies } = fixture();
    const respond = vi.fn<MediaAppDependencies["recoveryAdmin"]["respond"]>(
      async () => ({ status: "completed" }),
    );
    dependencies.recoveryAdmin = { ...dependencies.recoveryAdmin, respond };
    const app = createMediaApp(dependencies);
    const id = crypto.randomUUID();
    const input = {
      scopeHash: "a".repeat(64),
      acknowledgePending: true,
      declarations: [{ mediaId: crypto.randomUUID(), intent: "request" }],
    };
    const rejected = await app.request(
      `/api/v1/recovery/reviews/${id}/responses`,
      {
        method: "POST",
        headers: { ...headers, "X-CSRF-Token": "wrong" },
        body: JSON.stringify(input),
      },
    );
    expect(rejected.status).toBe(403);
    expect(respond).not.toHaveBeenCalled();
    const accepted = await app.request(
      `/api/v1/recovery/reviews/${id}/responses`,
      { method: "POST", headers, body: JSON.stringify(input) },
    );
    expect(accepted.status).toBe(200);
    expect(respond).toHaveBeenCalledWith(
      actor,
      headers["Idempotency-Key"],
      id,
      input,
    );
  });
  test("handoff apply forwards the authenticated actor and exact reviewed hash; malformed scope is rejected", async () => {
    const { dependencies } = fixture();
    const apply = vi.fn<MediaAppDependencies["handoffAdmin"]["apply"]>(
      async () => ({ status: "queued", operationId: crypto.randomUUID() }),
    );
    dependencies.handoffAdmin = { ...handoffFixture, apply };
    const app = createMediaApp(dependencies);
    const id = crypto.randomUUID();
    const input = {
      expectedVersion: 2,
      planHash: "a".repeat(64),
      recoveryEpoch: 3,
      runtimeVersion: 4,
      acknowledgeProtectedLegacySources: true,
      acknowledgeRecoveryHolds: true,
    };
    const response = await app.request(`/api/v1/admin/handoffs/${id}/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(202);
    expect(apply).toHaveBeenCalledWith(
      actor,
      headers["Idempotency-Key"],
      id,
      input,
    );
    const invalid = await app.request(`/api/v1/admin/handoffs/${id}/apply`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...input, acknowledgeRecoveryHolds: false }),
    });
    expect(invalid.status).toBe(400);
    expect(apply).toHaveBeenCalledOnce();
  });
  test("only manual subtitle upload accepts a body larger than the normal API limit", async () => {
    const { dependencies } = fixture();
    const app = createMediaApp(dependencies);
    const contentBase64 = Buffer.from(
      "subtitle fixture\n".repeat(5000),
    ).toString("base64");
    const upload = await app.request("/api/v1/admin/subtitles", {
      method: "POST",
      headers,
      body: JSON.stringify({
        assetId: "00000000-0000-4000-8000-000000000001",
        expectedAssetVersion: 0,
        expectedChecksum: "a".repeat(64),
        language: "en",
        filename: "fixture.srt",
        description: "Human translation",
        contentBase64,
        confirmedMatchingVideo: true,
      }),
    });
    expect(upload.status).toBe(202);
    const ordinary = await app.request("/api/v1/requests", {
      method: "POST",
      headers,
      body: JSON.stringify({ mediaId: contentBase64 }),
    });
    expect(ordinary.status).toBe(413);
  });
  test("anonymous access is denied and health remains public", async () => {
    const { dependencies } = fixture();
    const app = createMediaApp(dependencies);
    const health = await app.request("/health");
    const denied = await app.request("/api/v1/requests");
    expect(health.status).toBe(200);
    expect(denied.status).toBe(401);
  });

  test("cross-origin requests and missing CSRF never reach commands", async () => {
    const { dependencies, createRequest } = fixture();
    const app = createMediaApp(dependencies);
    const foreign = await app.request("/api/v1/requests", {
      method: "POST",
      headers: { ...headers, Origin: "https://attacker.example" },
      body: JSON.stringify({ mediaId: "media" }),
    });
    const missingCsrf = await app.request("/api/v1/requests", {
      method: "POST",
      headers: { ...headers, "X-CSRF-Token": "wrong" },
      body: JSON.stringify({ mediaId: "media" }),
    });
    expect(foreign.status).toBe(403);
    expect(missingCsrf.status).toBe(403);
    expect(createRequest).not.toHaveBeenCalled();
  });

  test("request identity comes from the session and body cannot impersonate another user", async () => {
    const { dependencies, createRequest } = fixture();
    const app = createMediaApp(dependencies);
    const rejected = await app.request("/api/v1/requests", {
      method: "POST",
      headers,
      body: JSON.stringify({ mediaId: "media", userId: "owner" }),
    });
    expect(rejected.status).toBe(400);
    const accepted = await app.request("/api/v1/requests", {
      method: "POST",
      headers,
      body: JSON.stringify({ mediaId: "media" }),
    });
    expect(accepted.status).toBe(202);
    expect(createRequest.mock.calls[0]?.[0]).toEqual(actor);
  });

  test("Keep remains available while new requests are gated off", async () => {
    const { dependencies, act } = fixture();
    dependencies.requestsEnabled = async () => false;
    const app = createMediaApp(dependencies);
    const request = await app.request("/api/v1/requests", {
      method: "POST",
      headers,
      body: JSON.stringify({ mediaId: "media" }),
    });
    const keep = await app.request("/api/v1/media/media/actions", {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "keep", expectedVersion: 0 }),
    });
    expect(request.status).toBe(503);
    expect(keep.status).toBe(202);
    expect(act).toHaveBeenCalledOnce();
  });

  test("invalid inbound JSON returns400, corrupt internal data returns500", async () => {
    const { dependencies } = fixture();
    dependencies.media.profiles = async () => {
      z.string().parse(123);
      return [];
    };
    const app = createMediaApp(dependencies);
    const invalid = await app.request("/api/v1/requests", {
      method: "POST",
      headers,
      body: "{",
    });
    expect(invalid.status).toBe(400);
    const response = await app.request("/api/v1/profiles", { headers });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("123");
    expect(dependencies.onError).toHaveBeenCalledOnce();
  });

  test("Plex login sets secure session cookies without exposing credentials", async () => {
    const { dependencies } = fixture();
    const app = createMediaApp(dependencies);
    const response = await app.request("/api/v1/auth/plex/poll/login", {
      method: "POST",
      headers: {
        Origin: headers.Origin,
        Cookie: "__Host-media-login=browser-token",
      },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Set-Cookie")).toContain("HttpOnly");
    expect(response.headers.get("Set-Cookie")).toContain("Secure");
    expect(await response.text()).not.toContain("session-token");
  });
});
