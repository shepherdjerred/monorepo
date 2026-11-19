import { vi } from "vitest";
import type { MediaAppDependencies } from "./app.ts";
import { MediaError } from "#application/errors.ts";
import type { MediaActor } from "#application/auth.ts";
import type { MediaApplication } from "#application/ports.ts";
import type { NotificationApplication } from "#application/notification-ports.ts";

export const actor: MediaActor = {
  id: "member",
  plexAccountId: "plex-member",
  displayName: "Member",
  role: "member",
  restricted: false,
  version: 0,
};
const migrationFixture: MediaAppDependencies["migrationAdmin"] = {
  discover() {
    return Promise.reject(
      new MediaError("unavailable", "No fixture catalog", 503),
    );
  },
  bundles: {
    create() {
      return Promise.reject(
        new MediaError("invalid_bundle", "No fixture bundle", 422),
      );
    },
    detail() {
      return Promise.reject(
        new MediaError("not_found", "No fixture bundle", 404),
      );
    },
    list() {
      return Promise.resolve([]);
    },
    review() {
      return Promise.resolve({ status: "completed" });
    },
  },
  detail() {
    return Promise.reject(
      new MediaError("not_found", "No fixture proposal", 404),
    );
  },
  list() {
    return Promise.resolve([]);
  },
  upload() {
    return Promise.reject(
      new MediaError("invalid_capture", "No fixture capture", 422),
    );
  },
  review() {
    return Promise.resolve({ status: "completed" });
  },
};

export const handoffFixture = {
  subtitlePolicyVersions() {
    return Promise.reject(
      new Error("Unexpected fixture subtitle policy versions"),
    );
  },
  prepare() {
    return Promise.reject(new Error("Unexpected fixture handoff prepare"));
  },
  detail() {
    return Promise.reject(new Error("Unexpected fixture handoff detail"));
  },
  apply() {
    return Promise.reject(new Error("Unexpected fixture handoff apply"));
  },
};
const numberingFixture = {
  groups: unavailableSubtitleReplacement,
  group: unavailableSubtitleReplacement,
  previewGroup: unavailableSubtitleReplacement,
  commitGroup: unavailableSubtitleReplacement,
  series() {
    return Promise.resolve([]);
  },
  episodes() {
    return Promise.resolve([]);
  },
  save() {
    return Promise.resolve({ status: "completed" as const });
  },
};
const recoveryFixture = {
  list: () => Promise.resolve({ authority: null, holds: [], reviews: [] }),
  detail: () => Promise.reject(new Error("Unexpected recovery detail")),
  prepare: () => Promise.reject(new Error("Unexpected recovery prepare")),
  respond: () => Promise.reject(new Error("Unexpected recovery response")),
  release: () => Promise.reject(new Error("Unexpected recovery release")),
};

function nativeRecoveryFixture() {
  return {
    prepareCompensation(): Promise<never> {
      return Promise.reject(
        new MediaError("conflict", "No fixture publication compensation", 409),
      );
    },
    retryCompensation(): Promise<never> {
      return Promise.reject(
        new MediaError("conflict", "No fixture publication compensation", 409),
      );
    },
    compensationInventory() {
      return Promise.resolve({ items: [], nextCursor: null });
    },
    prepareArchive(): Promise<never> {
      return Promise.reject(
        new MediaError("conflict", "No fixture archive recovery", 409),
      );
    },
    archiveInventory() {
      return Promise.resolve({
        nextCursor: null,
        runtime: { mode: "observe", recoveryEpoch: 0, version: 0 },
        restoreOperationId: null,
        prerequisites: [],
        cleanups: [],
      });
    },
    prepareQuarantine(): Promise<never> {
      return Promise.reject(
        new MediaError("conflict", "No fixture quarantine recovery", 409),
      );
    },
    inventory() {
      return Promise.resolve({
        runtime: { mode: "observe", recoveryEpoch: 0, version: 0 },
        restoreOperationId: null,
        assets: [],
        plans: [],
        nextCursor: null,
        prerequisites: [],
      });
    },
    prepare(): Promise<never> {
      return Promise.reject(
        new MediaError("conflict", "No fixture native recovery", 409),
      );
    },
    detail(): Promise<never> {
      return Promise.reject(
        new MediaError("conflict", "No fixture native recovery", 409),
      );
    },
    apply(): Promise<never> {
      return Promise.reject(
        new MediaError("conflict", "No fixture native recovery", 409),
      );
    },
  };
}

function unavailableSubtitleReplacement(): Promise<never> {
  return Promise.reject(
    new MediaError("conflict", "No fixture subtitle replacement", 409),
  );
}
function subtitleReplacementFixture() {
  return {
    list: () => Promise.resolve({ items: [], nextCursor: null }),
    detail: unavailableSubtitleReplacement,
    prepare: unavailableSubtitleReplacement,
    apply: unavailableSubtitleReplacement,
    reconcile: unavailableSubtitleReplacement,
  };
}

function mediaFixture() {
  const act = vi.fn<MediaApplication["act"]>(() =>
    Promise.resolve({
      status: "queued",
      operationId: "operation",
    }),
  );
  const createRequest = vi.fn<MediaApplication["createRequest"]>(() =>
    Promise.resolve({
      status: "queued",
      operationId: "operation",
    }),
  );
  const media: MediaApplication = {
    getMovieEditionContext: unavailableSubtitleReplacement,
    listMovieEditionRequests: unavailableSubtitleReplacement,
    requestMovieEdition: unavailableSubtitleReplacement,
    cancelMovieEditionRequest: unavailableSubtitleReplacement,
    revokeMovieEditionChoice: unavailableSubtitleReplacement,
    getDefaultCommandContext: unavailableSubtitleReplacement,
    executeDefaultCommand: unavailableSubtitleReplacement,
    identityPreview: unavailableSubtitleReplacement,
    createRequest,
    act,
    cancelRequest() {
      return Promise.resolve({ status: "completed" });
    },
    listRequests() {
      return Promise.resolve([]);
    },
    getMedia() {
      return Promise.reject(new MediaError("media_not_found", "Missing", 404));
    },
    activity() {
      return Promise.resolve([]);
    },
    removals() {
      return Promise.resolve([]);
    },
    notifications() {
      return Promise.resolve([]);
    },
    profiles() {
      return Promise.resolve([]);
    },
    profileDefaults() {
      return Promise.resolve([]);
    },
    setProfileDefault() {
      return Promise.resolve({ status: "completed" });
    },
    listUsers() {
      return Promise.resolve([]);
    },
    restrictUser() {
      return Promise.resolve({ status: "completed" });
    },
    releases() {
      return Promise.resolve([]);
    },
    saveProfile() {
      return Promise.resolve({ status: "completed" });
    },
    assignProfile() {
      return Promise.resolve({ status: "queued" });
    },
  };
  return { media, act, createRequest };
}

export function fixture() {
  const { media, act, createRequest } = mediaFixture();
  const notifications: NotificationApplication = {
    acknowledgeRead() {
      return Promise.resolve({ status: "completed" });
    },
    retryDelivery() {
      return Promise.resolve({ status: "queued" });
    },
    reconcileDelivery() {
      return Promise.resolve({ status: "queued" });
    },
    preferences() {
      return Promise.resolve({
        email: null,
        emailVerified: false,
        discordLinked: false,
        discordAvailable: false,
        emailEnabled: false,
        discordEnabled: false,
        upgrades: false,
        removalCompleted: false,
        version: 0,
      });
    },
    updatePreferences() {
      return Promise.resolve({ status: "completed" });
    },
    requestEmailVerification() {
      return Promise.resolve({ status: "queued" });
    },
    verifyEmail() {
      return Promise.resolve({ status: "completed" });
    },
    startDiscordLink() {
      return Promise.resolve({
        authorizationUrl: "https://discord.com/oauth2/authorize",
      });
    },
    completeDiscordLink() {
      return Promise.resolve({ status: "completed" });
    },
    unlinkDiscord() {
      return Promise.resolve({ status: "completed" });
    },
  };
  const dependencies: MediaAppDependencies = {
    plexEvents: {
      secret: undefined,
      enabled: () => Promise.resolve(false),
      ingress: {
        accept: () => Promise.reject(new Error("Unexpected Plex event")),
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
      start() {
        return Promise.resolve({
          id: crypto.randomUUID(),
          authorizationUrl: "https://app.plex.tv/auth",
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
          browserToken: "browser-token",
        });
      },
      poll() {
        return Promise.resolve({
          actor,
          sessionToken: "session-token",
          csrfToken: "csrf-token",
          expiresAt: new Date(Date.now() + 60_000),
        });
      },
      authenticate(token) {
        return token === "session-token"
          ? Promise.resolve({ actor, csrfHash: "csrf-hash" })
          : Promise.reject(new MediaError("unauthenticated", "Sign in", 401));
      },
      verifyCsrf(token) {
        if (token !== "csrf-token")
          throw new MediaError("csrf_required", "CSRF required", 403);
      },
      logout() {
        return Promise.resolve();
      },
    },
    media,
    notifications,
    admin: {
      runtime() {
        return Promise.resolve({
          mode: "observe",
          recoveryEpoch: 0,
          ownershipConfirmed: false,
          version: 0,
        });
      },
      setRuntime(_actor, _key, input) {
        return Promise.resolve({
          mode: input.mode,
          recoveryEpoch: 0,
          ownershipConfirmed: input.mode === "active",
          version: input.expectedVersion + 1,
        });
      },
      providers() {
        return Promise.resolve([]);
      },
      saveProvider() {
        return Promise.resolve({ status: "completed" });
      },
      subtitleTargets() {
        return Promise.resolve([]);
      },
      uploadSubtitle() {
        return Promise.resolve({ status: "queued" });
      },
    },
    plexAdmin: {
      profiles() {
        return Promise.resolve({
          homeUsers: [],
          serverAccounts: [],
          mappings: [],
        });
      },
      saveProfile() {
        return Promise.resolve({ status: "completed" });
      },
      refreshProfileAccess() {
        /* Fixture explicitly authorizes the profile. */
        return Promise.resolve();
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
      list() {
        return Promise.resolve({
          runtime: { mode: "observe", recoveryEpoch: 0, version: 0 },
          runs: [],
        });
      },
      recover() {
        return Promise.reject(
          new MediaError("conflict", "No fixture exclusion plan", 409),
        );
      },
      prepare() {
        return Promise.reject(
          new MediaError("conflict", "No fixture exclusion plan", 409),
        );
      },
      detail() {
        return Promise.reject(
          new MediaError("not_found", "No fixture exclusion plan", 404),
        );
      },
      execute() {
        return Promise.reject(
          new MediaError("conflict", "No fixture exclusion plan", 409),
        );
      },
    },
    catalog: {
      search() {
        return Promise.resolve({ page: 1, totalPages: 0, results: [] });
      },
      details() {
        return Promise.reject(new MediaError("not_found", "Missing", 404));
      },
      adopt() {
        return Promise.resolve({ mediaId: "media" });
      },
    },
    publicOrigin: "https://media.example.test",
    requestsEnabled: () => Promise.resolve(true),
    onError: vi.fn(),
  };
  return { dependencies, act, createRequest };
}

export const headers = {
  Origin: "https://media.example.test",
  Cookie: "__Host-media-session=session-token",
  "X-CSRF-Token": "csrf-token",
  "Content-Type": "application/json",
  "Idempotency-Key": "request-key",
};
