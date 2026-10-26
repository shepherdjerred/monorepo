import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { BoundWatchAuthoritySchema } from "#shared/plex-binding/watch.ts";
import { PlexBindingExpectedSchema } from "#shared/plex-binding/expected.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import {
  graph,
  first,
  freshness,
  insertClaims,
  commitClaims,
  snapshot,
} from "./schema.test-support.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});
afterEach(async () => {
  expect(await cluster.database.plexClaimValidation.count()).toBe(0);
});

test("missing and expired SQL-local bounds reject writes or deferred COMMIT without residue", async () => {
  const groups = await graph(cluster.database);
  const before = await snapshot(cluster.database, groups);
  await expect(
    cluster.database.$transaction((tx) => insertClaims(tx, groups)),
  ).rejects.toThrow("deadline");
  let wrote = false;
  let expiredPid: number | undefined;
  await expect(
    cluster.database.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness());
      await insertClaims(tx, groups);
      wrote = true;
      const sessions = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      expiredPid = sessions[0]?.pid;
      await bindPlexTransactionDeadline(tx, freshness(100));
      // Cross a real post-write expiry. Concurrency tests below use explicit barriers.
      await tx.$queryRaw`SELECT 1 FROM pg_sleep(0.15)`;
    }),
  ).rejects.toThrow("deadline");
  expect(wrote).toBe(true);
  expect(await snapshot(cluster.database, groups)).toEqual(before);
  expect(await cluster.database.plexClaimValidation.count()).toBe(0);
  await cluster.database.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { pid: number; deadline: string | null }[]
    >`SELECT pg_backend_pid() AS pid, NULLIF(current_setting('media.plex_deadline_ms',true),'') AS deadline`;
    expect(expiredPid).toBeDefined();
    expect(rows).toEqual([{ pid: expiredPid, deadline: null }]);
  });
  await commitClaims(cluster.database, groups);
});

test("a later helper cannot extend the first transaction deadline", async () => {
  const session = await cluster.database.$transaction(async (tx) => {
    const earlier = freshness(10_000);
    await bindPlexTransactionDeadline(tx, earlier);
    await bindPlexTransactionDeadline(tx, freshness(20_000));
    const rows = await tx.$queryRaw<
      { pid: number; deadline: string }[]
    >`SELECT pg_backend_pid() AS pid, current_setting('media.plex_deadline_ms') AS deadline`;
    const row = rows[0];
    if (row === undefined) throw new Error("Missing deadline session");
    expect(row.deadline).toBe(String(earlier.expiresAtMs));
    return row.pid;
  });
  await cluster.database.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      { pid: number; deadline: string | null }[]
    >`SELECT pg_backend_pid() AS pid, NULLIF(current_setting('media.plex_deadline_ms',true),'') AS deadline`;
    expect(rows).toEqual([{ pid: session, deadline: null }]);
  });
});

test("full BigInt watch ordering survives binding projection without number coercion", async () => {
  const groups = await graph(cluster.database);
  await commitClaims(cluster.database, groups);
  const group = groups[0];
  if (group === undefined) throw new Error("Missing watch fixture");
  const row = first(group);
  const db = cluster.database;
  const user = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Watch schema fixture",
    },
  });
  const revision = 9_223_372_036_854_775_807n;
  await db.watchObservationFence.create({
    data: {
      ...row.value.scope,
      issuedRevision: revision,
      settledRevision: revision,
    },
  });
  const authority = BoundWatchAuthoritySchema.parse({
    purpose: "current_serving",
    binding: {
      scope: row.value.scope,
      evidenceId: row.id,
      associationHash: row.hash,
      revision: 1,
    },
  });
  await db.plexWatchProjection.create({
    data: {
      userId: user.id,
      ...row.value.scope,
      evidenceId: row.id,
      associationHash: row.hash,
      bindingRevision: 1,
      purpose: "current_serving",
      watchBatchRevision: revision,
      observedAt: new Date(),
      watched: true,
      source: "plex",
      authority,
      authorityHash: identityHash(authority),
    },
  });
  const projection = await db.plexWatchProjection.findUniqueOrThrow({
    where: { userId_mediaId_edition: { userId: user.id, ...row.value.scope } },
  });
  const fence = await db.watchObservationFence.findUniqueOrThrow({
    where: { mediaId_edition: row.value.scope },
  });
  expect(projection.watchBatchRevision).toBe(revision);
  expect(projection.watchBatchRevision).toBe(fence.settledRevision);
});

test("wider named claim schemas do not open cold reverify request admission", async () => {
  const groups = await graph(cluster.database, {
    leaves: 1,
    edition: "theatrical_cut",
  });
  const group = groups[0];
  if (group === undefined) throw new Error("Missing named fixture");
  const value = first(group).value;
  const expected = PlexBindingExpectedSchema.parse({
    schemaVersion: 1,
    recoveryEpoch: 0,
    access: [value.access],
    targets: [
      {
        scope: value.scope,
        editionRootId: value.editionRootId,
        mediaVersion: 0,
        intentVersion: 0,
        generation: 0,
        automationEpoch: 0,
        definition: value.definition,
        canonicalIdentityHash: value.canonicalIdentityHash,
        numberingHash: value.numberingHash,
      },
    ],
    previous: [{ scope: value.scope, revision: 0, evidence: null }],
    oldGroups: [],
    newGroups: [value.group],
    parents: [
      {
        kind: "existing_asset",
        assetId: value.group.assetId,
        assetVersion: 0,
        recoveryEpoch: 0,
        physicalGrant: null,
      },
    ],
  });
  const operationId = crypto.randomUUID();
  await expect(
    cluster.database.$transaction(async (tx) => {
      await tx.operation.create({
        data: {
          id: operationId,
          kind: "reverify_plex_binding",
          payload: {
            schemaVersion: 1,
            kind: "reverify_plex_binding",
            operationId,
            recoveryEpoch: 0,
            assetIds: [value.group.assetId],
          },
        },
      });
      await tx.plexBindingVerificationRequest.create({
        data: {
          operationId,
          expected,
          expectedHash: identityHash(expected),
          recoveryEpoch: 0,
          assetIds: [value.group.assetId],
        },
      });
    }),
  ).rejects.toThrow("default targets only");
  expect(
    await cluster.database.operation.findUnique({ where: { id: operationId } }),
  ).toBeNull();
  expect(
    await cluster.database.plexBindingVerificationRequest.findUnique({
      where: { operationId },
    }),
  ).toBeNull();
});
