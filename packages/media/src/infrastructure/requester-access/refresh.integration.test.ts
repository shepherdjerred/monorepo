import { expect, test } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { rm } from "node:fs/promises";
import { automationTestHarness } from "#testing/automation.ts";
import { identityFixture } from "#infrastructure/acquisition-identity/test-fixture.ts";
import { createAcquisitionActivities } from "#automation/acquisition.ts";
import { requesterAccessRefresher } from "./refresh.ts";
import { PlexPinAuthentication } from "#infrastructure/plex-auth.ts";
import { authorizeRequester } from "#infrastructure/requester-authorization.ts";
import { testPlexBindingExecution } from "#testing/plex-binding-execution.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { NativeArchiveScopeProtection } from "#infrastructure/native-archive/errors.ts";
import { PrismaAuthStore } from "#infrastructure/auth-store.ts";
import { permissionSnapshot } from "#application/plex-account-access.ts";

const h = automationTestHarness();
let nextAccount = 90_000;
type Mode =
  | "allowed"
  | "revoked"
  | "restricted"
  | "unavailable"
  | "mismatch"
  | "expired"
  | "library_changed";

function failureStatus(mode: Mode, token: string | null) {
  if (mode === "unavailable") return 503;
  return mode === "expired" && token === "account-token" ? 401 : null;
}

async function fixture() {
  const db = h.database();
  const f = await identityFixture(db, h.context());
  const accountId = String(++nextAccount);
  await db.mediaUser.update({
    where: { id: f.actor.id },
    data: { plexAccountId: accountId },
  });
  await db.plexIdentityMapping.update({
    where: { userId: f.actor.id },
    data: { serverAccountId: accountId },
  });
  const key = generateKeyPairSync("ed25519");
  const credential = {
    token: "account-token",
    serverToken: "old-server-token",
    deviceState: JSON.stringify({
      clientId: "registered-device",
      keyId: "registered-key",
      privateKey: key.privateKey.export({ format: "pem", type: "pkcs8" }),
    }),
  };
  await db.credential.create({
    data: {
      userId: f.actor.id,
      kind: "plex",
      ciphertext: f.network.cipher.encrypt(
        JSON.stringify(credential),
        `plex:${accountId}`,
      ),
    },
  });
  const acquired = await f.acquire();
  const state: { mode: Mode; profileMode: Mode; profileAccount: number } = {
    mode: "allowed",
    profileMode: "allowed",
    profileAccount: Number(accountId) + 1000,
  };
  const calls: { path: string; token: string | null }[] = [];
  const auth = new PlexPinAuthentication(
    {
      serverMachineId: "fixture-server",
      serverUrl: "http://plex.fixture",
      permittedMovieSectionId: "1",
      permittedTvSectionId: "2",
      applicationName: "Media",
      returnUrl: "http://media.fixture",
    },
    async (input, init) => {
      const url = new URL(input);
      const token = new Headers(init?.headers).get("X-Plex-Token");
      calls.push({ path: url.pathname, token });
      if (url.pathname === "/api/v2/auth/nonce")
        return Response.json({ nonce: "synthetic-nonce" });
      if (url.pathname === "/api/v2/auth/token")
        return Response.json({ auth_token: "renewed-account-token" });
      const profile =
        token === "profile-token" || token === "profile-server-token";
      const mode = profile ? state.profileMode : state.mode;
      const status = failureStatus(mode, token);
      if (status !== null) return new Response(null, { status });
      const id = profile ? state.profileAccount : Number(accountId);
      const sections =
        mode === "library_changed"
          ? [{ key: "1", title: "Movies", type: "movie" }]
          : [{ key: "2", title: "TV", type: "show" }];
      const responses: Record<string, unknown> = {
        "/api/v2/resources":
          mode === "revoked"
            ? []
            : [
                {
                  clientIdentifier: "fixture-server",
                  provides: "server",
                  accessToken: profile
                    ? "profile-server-token"
                    : "account-server-token",
                },
              ],
        "/api/v2/user": {
          id: mode === "mismatch" ? id + 1 : id,
          restricted: mode === "restricted",
        },
        "/identity": {
          MediaContainer: { machineIdentifier: "fixture-server" },
        },
        "/library/sections": {
          MediaContainer: { size: sections.length, Directory: sections },
        },
      };
      if (!(url.pathname in responses))
        throw new Error("Unexpected Plex permission protocol request");
      if (url.hostname === "plex.fixture")
        expect(token).toBe(
          profile ? "profile-server-token" : "account-server-token",
        );
      return Response.json(responses[url.pathname]);
    },
  );
  const refresh = requesterAccessRefresher(
    db,
    f.network.cipher,
    () => Promise.resolve(auth),
    { serverUrl: "http://plex.fixture", serverMachineId: "fixture-server" },
  );
  const activities = createAcquisitionActivities({
    ...f.network,
    refreshRequesterAccess: refresh,
  });
  const expire = async (userId = f.actor.id) => {
    const verifiedAt = new Date(Date.now() - 301_000);
    await db.plexIdentityMapping.update({
      where: { userId },
      data: { verifiedAt },
    });
    return verifiedAt;
  };
  return {
    db,
    f,
    acquired,
    accountId,
    credential,
    state,
    calls,
    refresh,
    auth,
    activities,
    expire,
    close: () => rm(f.files.directory, { recursive: true, force: true }),
  };
}

test("a personal TV observation renews access older than five minutes through the real resolver without changing its birth or torrent", async () => {
  const f = await fixture();
  try {
    const before = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: f.acquired.attempt.id },
    });
    expect(before.identityEvidence).toMatchObject({ schemaVersion: 1 });
    await f.expire();
    expect(
      await f.activities.observeMediaAcquisition(f.acquired.input),
    ).toEqual({ status: "downloading", reason: null });
    expect(f.calls.map((call) => call.path)).toEqual([
      "/api/v2/resources",
      "/api/v2/user",
      "/identity",
      "/library/sections",
    ]);
    const after = await f.db.acquisitionAttempt.findUniqueOrThrow({
      where: { id: before.id },
    });
    expect(after.identityEvidence).toEqual(before.identityEvidence);
    expect(after.operationId).toBe(before.operationId);
    expect(after.sponsorRequestId).toBe(before.sponsorRequestId);
    expect(after.torrentId).toBe(before.torrentId);
    expect(f.f.adds()).toBe(1);
    const count = f.calls.length;
    expect(
      await f.activities.observeMediaAcquisition(f.acquired.input),
    ).toMatchObject({ status: "downloading" });
    expect(f.calls).toHaveLength(count);
  } finally {
    await f.close();
  }
});

test("an expired account token uses its registered device and stores refreshed encrypted credentials", async () => {
  const f = await fixture();
  try {
    await f.expire();
    f.state.mode = "expired";
    expect(
      await f.activities.observeMediaAcquisition(f.acquired.input),
    ).toMatchObject({ status: "downloading" });
    expect(f.calls.map((call) => call.path)).toContain("/api/v2/auth/token");
    const stored = await f.db.credential.findUniqueOrThrow({
      where: { userId_kind: { userId: f.f.actor.id, kind: "plex" } },
    });
    expect(
      JSON.parse(
        f.f.network.cipher.decrypt(stored.ciphertext, `plex:${f.accountId}`),
      ),
    ).toEqual({
      ...f.credential,
      token: "renewed-account-token",
      serverToken: "account-server-token",
    });
  } finally {
    await f.close();
  }
});

test("requester renewal retains the original shared record allowance and cannot call Plex after cancellation", async () => {
  const f = await fixture();
  try {
    const before = await f.expire();
    const sponsors = [{ userId: f.f.actor.id, actorId: f.f.actor.id }];
    const budget = new PublicationAuthorityReadBudget();
    budget.consume(99);
    await expect(
      f.refresh(sponsors, testPlexBindingExecution(), budget),
    ).rejects.toThrow(NativeArchiveScopeProtection);
    const execution = testPlexBindingExecution();
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.refresh(
        sponsors,
        {
          ...execution,
          signal: controller.signal,
          assertActive: () => controller.signal.throwIfAborted(),
        },
        new PublicationAuthorityReadBudget(),
      ),
    ).rejects.toThrow();
    expect(f.calls).toEqual([]);
    const mapping = await f.db.plexIdentityMapping.findUniqueOrThrow({
      where: { userId: f.f.actor.id },
    });
    expect(mapping.verifiedAt).toEqual(before);
  } finally {
    await f.close();
  }
});

test("an access snapshot cannot commit after the original SQL deadline", async () => {
  const f = await fixture();
  try {
    const before = await f.expire();
    const access = await f.auth.resolveServerAccess("account-token");
    if (access === null)
      throw new Error("Permission fixture omitted its real resolver result");
    await f.db.$executeRawUnsafe(
      "CREATE FUNCTION requester_access_commit_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.15); RETURN NEW; END $$",
    );
    await f.db.$executeRawUnsafe(
      'CREATE TRIGGER requester_access_commit_delay AFTER UPDATE ON "PlexIdentityMapping" FOR EACH ROW EXECUTE FUNCTION requester_access_commit_delay()',
    );
    const execution = testPlexBindingExecution();
    const store = new PrismaAuthStore(f.db, {
      expiresAtMs: Date.now() + 75,
      assertActive: execution.assertActive,
    });
    await expect(
      store.updateAccess(f.f.actor.id, permissionSnapshot(access)),
    ).rejects.toThrow("Plex authority deadline missing or expired");
    const mapping = await f.db.plexIdentityMapping.findUniqueOrThrow({
      where: { userId: f.f.actor.id },
    });
    expect(mapping.verifiedAt).toEqual(before);
  } finally {
    await f.db.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS requester_access_commit_delay ON "PlexIdentityMapping"',
    );
    await f.db.$executeRawUnsafe(
      "DROP FUNCTION IF EXISTS requester_access_commit_delay()",
    );
    await f.close();
  }
});

test.each(["revoked", "restricted", "unavailable", "mismatch"] as const)(
  "personal TV refresh fails closed when Plex access is %s",
  async (mode) => {
    const f = await fixture();
    try {
      const expired = await f.expire();
      f.state.mode = mode;
      expect(
        await f.activities.observeMediaAcquisition(f.acquired.input),
      ).toEqual({
        status: "blocked",
        reason:
          mode === "unavailable"
            ? "plex_unavailable"
            : "plex_library_access_required",
      });
      const mapping = await f.db.plexIdentityMapping.findUniqueOrThrow({
        where: { userId: f.f.actor.id },
      });
      if (mode === "unavailable") expect(mapping.verifiedAt).toEqual(expired);
      if (mode === "revoked" || mode === "mismatch")
        expect(mapping.verifiedAt).toBeNull();
      expect(f.f.adds()).toBe(1);
    } finally {
      await f.close();
    }
  },
);

test.each([
  "allowed",
  "revoked",
  "missing",
  "changed_actor",
  "restricted_owner",
  "library_changed",
  "mismatch",
] as const)(
  "background managed Home access uses its exact stored profile capability: %s",
  async (mode) => {
    const f = await fixture();
    try {
      const owner = await f.db.mediaUser.findUniqueOrThrow({
        where: { id: f.f.actor.id },
      });
      const profile = await f.db.mediaUser.create({
        data: {
          plexAccountId: String(f.state.profileAccount),
          displayName: "Managed profile",
          plexIdentity: {
            create: {
              kind: "managed",
              homeUserId: String(f.state.profileAccount),
              serverAccountId: String(f.state.profileAccount),
              serverMachineId: "fixture-server",
              verifiedAt: new Date(Date.now() - 301_000),
              permittedSectionIds: ["2"],
              permittedMediaKinds: ["series"],
            },
          },
        },
      });
      if (mode !== "missing")
        await f.db.credential.create({
          data: {
            userId: profile.id,
            kind: "plex",
            ciphertext: f.f.network.cipher.encrypt(
              JSON.stringify({
                token: "profile-token",
                serverToken: "old-profile-server-token",
              }),
              `plex:${profile.plexAccountId}`,
            ),
          },
        });
      await f.expire();
      if (mode === "revoked") f.state.profileMode = "revoked";
      if (mode === "mismatch") f.state.profileMode = "mismatch";
      if (mode === "library_changed") f.state.profileMode = "library_changed";
      if (mode === "changed_actor")
        await f.db.mediaUser.update({
          where: { id: owner.id },
          data: { role: "member" },
        });
      if (mode === "restricted_owner")
        await f.db.mediaUser.update({
          where: { id: owner.id },
          data: { restricted: true },
        });
      const execute = () =>
        f.refresh(
          [{ userId: profile.id, actorId: owner.id }],
          testPlexBindingExecution(),
          new PublicationAuthorityReadBudget(),
        );
      if (mode === "allowed" || mode === "library_changed") {
        await execute();
        expect(
          f.calls
            .filter((call) => call.path === "/api/v2/resources")
            .map((call) => call.token),
        ).toEqual(["account-token", "profile-token"]);
        const authorize = () =>
          f.db.$transaction((tx) =>
            authorizeRequester(tx, owner, profile.id, {
              kind: "episode",
              serverMachineId: "fixture-server",
              sectionId: "2",
            }),
          );
        if (mode === "allowed")
          await expect(authorize()).resolves.toMatchObject({ id: owner.id });
        else
          await expect(authorize()).rejects.toMatchObject({
            code: "plex_library_access_required",
          });
      } else {
        await expect(execute()).rejects.toMatchObject({
          code:
            new Map([
              ["missing", "plex_credentials_required"],
              ["changed_actor", "forbidden"],
              ["restricted_owner", "requests_restricted"],
            ]).get(mode) ?? "plex_profile_reconnect",
        });
        const mapping = await f.db.plexIdentityMapping.findUniqueOrThrow({
          where: { userId: profile.id },
        });
        expect(
          mapping.verifiedAt === null ||
            mapping.verifiedAt.getTime() < Date.now() - 300_000,
        ).toBe(true);
      }
    } finally {
      await f.close();
    }
  },
);
