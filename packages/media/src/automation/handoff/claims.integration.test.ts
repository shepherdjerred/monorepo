import { afterAll, beforeAll, expect, test } from "vitest";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { PrismaAuthStore } from "#infrastructure/auth-store.ts";
import { applyPreparedHandoff } from "./apply.ts";
import { handoffFixture } from "./test-fixture.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
const directories: string[] = [];
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
  for (const directory of directories)
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const value = await handoffFixture(cluster.database);
  directories.push(value.directory);
  return value;
}

async function changeAccess(
  f: Awaited<ReturnType<typeof fixture>>,
  kind: "mapping" | "credential",
) {
  const db = cluster.database;
  const auth = new PrismaAuthStore(db);
  if (kind === "mapping") {
    await auth.updateAccess(f.network.actor.id, {
      accountId: f.network.actor.plexAccountId,
      serverMachineId: "server",
      permittedSectionIds: [],
      permittedMediaKinds: [],
      plexRestricted: false,
    });
  } else {
    const credential = await db.credential.findUniqueOrThrow({
      where: {
        userId_kind: { userId: f.network.actor.id, kind: "plex" },
      },
    });
    expect(
      await auth.updateCredential(
        f.network.actor.id,
        f.network.context.cipher.encrypt(
          JSON.stringify({ token: "replacement-fixture-token" }),
          `plex:${f.network.actor.plexAccountId}`,
        ),
        credential.ciphertext,
      ),
    ).toBe(true);
  }
}

async function waitForBlockedQuery(table: string) {
  const pattern = `%${table}%`;
  await expect
    .poll(
      async () => {
        const rows = z
          .array(z.object({ waiting: z.boolean() }))
          .parse(
            await cluster.database
              .$queryRaw`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE ${pattern} AND pid <> pg_backend_pid()) AS waiting`,
          );
        return rows[0]?.waiting;
      },
      { timeout: 2000, interval: 10 },
    )
    .toBe(true);
}

test.each(["mapping", "credential"] as const)(
  "a committed %s revocation rejects reviewed adoption without claims or ownership",
  async (kind) => {
    const f = await fixture();
    const ready = await f.ready();
    await changeAccess(f, kind);
    await expect(
      applyPreparedHandoff(f.context, ready.input, ready.prepared),
    ).rejects.toThrow("Handoff requester access changed");
    expect(
      await cluster.database.mediaRequest.count({
        where: { mediaId: f.network.media.id },
      }),
    ).toBe(0);
    expect(
      await cluster.database.libraryAsset.findUnique({
        where: { path: f.target },
      }),
    ).toBeNull();
    expect(
      await cluster.database.mediaHandoffReceipt.count({
        where: { planId: f.planId },
      }),
    ).toBe(0);
  },
);

test.each(["mapping", "credential"] as const)(
  "%s updates cannot commit between final claim validation and adoption",
  async (kind) => {
    const f = await fixture();
    const db = cluster.database;
    const ready = await f.ready();
    const locked = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    // This pauses actual apply immediately after its claim checks, before the
    // first storage read. No production hook or mocked transaction is involved.
    const blocker = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE "MediaStorageAuthority" IN ACCESS EXCLUSIVE MODE`;
        locked.resolve(undefined);
        await release.promise;
      },
      { timeout: 10_000 },
    );
    await locked.promise;
    const apply = applyPreparedHandoff(f.context, ready.input, ready.prepared);
    let change: Promise<void> | undefined;
    try {
      await waitForBlockedQuery("MediaStorageAuthority");
      change = changeAccess(f, kind);
      // Access refresh serializes its account/version before the mapping write;
      // adoption already holds that account fence through its final commit.
      await waitForBlockedQuery(
        kind === "mapping" ? "MediaUser" : "Credential",
      );
      expect(
        await db.mediaHandoffReceipt.count({ where: { planId: f.planId } }),
      ).toBe(0);
    } finally {
      release.resolve(undefined);
      await blocker;
      await Promise.allSettled([apply, change]);
    }
    const receiptId = await apply;
    await change;
    expect(
      await db.mediaHandoffReceipt.findUniqueOrThrow({
        where: { id: receiptId },
      }),
    ).toMatchObject({ planId: f.planId });
    expect(
      await db.mediaRequest.findUniqueOrThrow({
        where: {
          userId_mediaId_edition: {
            edition: "default",
            userId: f.network.actor.id,
            mediaId: f.network.media.id,
          },
        },
      }),
    ).toMatchObject({ active: true });
    if (kind === "mapping") {
      expect(
        await db.plexIdentityMapping.findUniqueOrThrow({
          where: { userId: f.network.actor.id },
        }),
      ).toMatchObject({ permittedSectionIds: [], version: 1 });
      expect(
        await db.mediaUser.findUniqueOrThrow({
          where: { id: f.network.actor.id },
        }),
      ).toMatchObject({ version: f.network.actor.version + 1 });
    }
  },
);
