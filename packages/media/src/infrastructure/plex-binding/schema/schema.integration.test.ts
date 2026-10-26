import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { plexCanonicalPathHash } from "#infrastructure/plex-binding/path.ts";
import {
  graph,
  first,
  freshness,
  insertClaims,
  commitClaims,
  snapshot,
  removeClaims,
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

test.each([
  { leaves: 2, groups: 1 },
  { leaves: 1001, groups: 1 },
  { leaves: 1, groups: 100 },
])(
  "complete $leaves-leaf / $groups-group claims commit without truncation or validation residue",
  async (options) => {
    const started = performance.now();
    const groups = await graph(cluster.database, options);
    const prepared = performance.now();
    await commitClaims(cluster.database, groups);
    const committed = performance.now();
    const state = await snapshot(cluster.database, groups);
    expect(state.groups).toHaveLength(options.groups);
    for (const rows of [state.members, state.items, state.pointers])
      expect(rows).toHaveLength(options.leaves * options.groups);
    expect(state.parts).toHaveLength(options.groups);
    expect(state.paths).toHaveLength(options.groups);
    const assets = await cluster.database.libraryAsset.findMany({
      where: {
        id: { in: groups.map((group) => first(group).value.group.assetId) },
      },
      select: { sizeBytes: true },
    });
    expect(assets).toHaveLength(options.groups);
    for (const asset of assets)
      expect(asset.sizeBytes).toBe(9_007_199_254_740_993n);
    expect(state.members.map((row) => row.mediaId).sort()).toEqual(
      groups
        .flatMap((group) =>
          group.associations.map((row) => row.value.scope.mediaId),
        )
        .sort(),
    );
    for (const pointer of state.pointers) expect(pointer.revision).toBe(1);
    console.warn("Plex schema complete-group timing", {
      ...options,
      setupMs: prepared - started,
      commitMs: committed - prepared,
    });
  },
);

test.each(["member", "item", "part", "path", "deleted_work"] as const)(
  "deferred %s incompleteness rejects COMMIT and preserves original claims",
  async (change) => {
    const groups = await graph(cluster.database);
    await commitClaims(cluster.database, groups);
    const group = groups[0];
    if (group === undefined) throw new Error("Missing test group");
    const before = await snapshot(cluster.database, groups);
    let writesFinished = false;
    await expect(
      cluster.database.$transaction(async (tx) => {
        await bindPlexTransactionDeadline(tx, freshness());
        switch (change) {
          case "member": {
            await tx.plexItemClaim.deleteMany({
              where: {
                groupId: group.id,
                mediaId: first(group).value.scope.mediaId,
              },
            });
            await tx.plexClaimGroupMember.deleteMany({
              where: {
                groupId: group.id,
                mediaId: first(group).value.scope.mediaId,
              },
            });
            break;
          }
          case "item":
            await tx.plexItemClaim.deleteMany({ where: { groupId: group.id } });
            break;
          case "part":
            await tx.plexPartClaim.deleteMany({ where: { groupId: group.id } });
            break;
          case "path":
          case "deleted_work":
            await tx.plexPathClaim.deleteMany({ where: { groupId: group.id } });
            break;
        }
        if (change === "deleted_work")
          await tx.plexClaimValidation.deleteMany();
        writesFinished = true;
      }),
    ).rejects.toThrow();
    expect(writesFinished).toBe(true);
    expect(await snapshot(cluster.database, groups)).toEqual(before);
    expect(await cluster.database.plexClaimValidation.count()).toBe(0);
  },
);

test("an initially partial shared group cannot commit even when every inserted pointer matches", async () => {
  const groups = await graph(cluster.database);
  const group = groups[0];
  if (group === undefined) throw new Error("Missing partial fixture");
  const before = await snapshot(cluster.database, groups);
  let wrote = false;
  await expect(
    cluster.database.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness());
      await insertClaims(tx, [{ ...group, associations: [first(group)] }]);
      wrote = true;
    }),
  ).rejects.toThrow("complete physical coverage");
  expect(wrote).toBe(true);
  expect(await snapshot(cluster.database, groups)).toEqual(before);
  expect(await cluster.database.plexClaimValidation.count()).toBe(0);
});

test("a group cannot be deleted while any exact claims remain", async () => {
  const groups = await graph(cluster.database);
  await commitClaims(cluster.database, groups);
  const group = groups[0];
  if (group === undefined) throw new Error("Missing test group");
  const before = await snapshot(cluster.database, groups);
  await expect(
    cluster.database.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness());
      await tx.plexClaimGroup.delete({ where: { id: group.id } });
    }),
  ).rejects.toThrow();
  expect(await snapshot(cluster.database, groups)).toEqual(before);
  expect(await cluster.database.plexClaimValidation.count()).toBe(0);
});

test("identical verification keeps revision; semantic invalidation requires next revision and complete claim removal", async () => {
  const groups = await graph(cluster.database);
  await commitClaims(cluster.database, groups);
  const group = groups[0];
  if (group === undefined) throw new Error("Missing test group");
  const where = {
    mediaId: { in: group.associations.map((row) => row.value.scope.mediaId) },
  };
  await cluster.database.$transaction(async (tx) => {
    await bindPlexTransactionDeadline(tx, freshness());
    await tx.plexBindingCurrent.updateMany({
      where,
      data: { verifiedCompletedAt: new Date() },
    });
  });
  const before = await snapshot(cluster.database, groups);
  expect(before.pointers.map((row) => row.revision)).toEqual([1, 1]);
  const cleared = {
    evidenceId: null,
    associationHash: null,
    verifiedStartedAt: null,
    verifiedCompletedAt: null,
  };
  await expect(
    cluster.database.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness());
      await tx.plexBindingCurrent.updateMany({ where, data: cleared });
    }),
  ).rejects.toThrow("next revision");
  let updated = false;
  await expect(
    cluster.database.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness());
      await tx.plexBindingCurrent.updateMany({
        where,
        data: { ...cleared, revision: 2 },
      });
      updated = true;
    }),
  ).rejects.toThrow("disagree");
  expect(updated).toBe(true);
  expect(await snapshot(cluster.database, groups)).toEqual(before);
  await cluster.database.$transaction(async (tx) => {
    await bindPlexTransactionDeadline(tx, freshness());
    await removeClaims(tx, group);
    await tx.plexBindingCurrent.updateMany({
      where,
      data: { ...cleared, revision: 2 },
    });
  });
  const after = await snapshot(cluster.database, groups);
  expect(after.groups).toEqual([]);
  expect(after.members).toEqual([]);
  expect(
    after.pointers.map((row) => ({
      revision: row.revision,
      evidenceId: row.evidenceId,
    })),
  ).toEqual([
    { revision: 2, evidenceId: null },
    { revision: 2, evidenceId: null },
  ]);
  expect(await cluster.database.plexClaimValidation.count()).toBe(0);
});

test.each([
  "/data/tv/日本語/é.mkv",
  String.raw`C:\TV\quote"'\episode.mkv`,
  "/data/tv/line\nbreak.mkv",
])(
  "canonical path hashing matches PostgreSQL UTF8 for %j",
  async (canonicalPath) => {
    const rows = await cluster.database.$queryRaw<
      { hash: string }[]
    >`SELECT encode(sha256(convert_to(${canonicalPath},'UTF8')),'hex') AS hash`;
    expect(rows).toEqual([{ hash: plexCanonicalPathHash(canonicalPath) }]);
  },
);

test("a supplied alternate hash cannot claim an existing path under a second named definition", async () => {
  const original = await graph(cluster.database);
  const named = await graph(cluster.database, {
    leaves: 1,
    edition: "directors_cut",
  });
  await commitClaims(cluster.database, original);
  const group = named[0],
    existing = original[0];
  if (group === undefined || existing === undefined)
    throw new Error("Missing conflict fixture");
  const value = first(existing).value;
  const before = await snapshot(cluster.database, original);
  await expect(
    cluster.database.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness());
      await tx.plexClaimGroup.create({
        data: {
          id: group.id,
          serverMachineId: value.access.serverMachineId,
          groupHash: identityHash(first(group).value.group),
          group: first(group).value.group,
        },
      });
      await tx.plexPathClaim.create({
        data: {
          groupId: group.id,
          serverMachineId: value.access.serverMachineId,
          canonicalPath: value.group.canonicalPath,
          canonicalPathHash: "0".repeat(64),
        },
      });
    }),
  ).rejects.toThrow("plex_path_hash");
  expect(await snapshot(cluster.database, original)).toEqual(before);
  const uncommittedNamed = await snapshot(cluster.database, named);
  expect(uncommittedNamed.groups).toEqual([]);
  await commitClaims(cluster.database, named);
  const committedNamed = await snapshot(cluster.database, named);
  expect(committedNamed.pointers).toHaveLength(1);
});

test.each(["item", "part"] as const)(
  "a second edition cannot duplicate an existing server %s claim",
  async (kind) => {
    const original = await graph(cluster.database);
    const named = await graph(cluster.database, {
      leaves: 1,
      edition: "directors_cut",
    });
    await commitClaims(cluster.database, original);
    const group = named[0],
      existing = original[0];
    if (group === undefined || existing === undefined)
      throw new Error("Missing duplicate fixture");
    const row = first(group),
      prior = first(existing).value;
    const before = await snapshot(cluster.database, original);
    await expect(
      cluster.database.$transaction(async (tx) => {
        await bindPlexTransactionDeadline(tx, freshness());
        await tx.plexClaimGroup.create({
          data: {
            id: group.id,
            serverMachineId: prior.access.serverMachineId,
            groupHash: identityHash(row.value.group),
            group: row.value.group,
          },
        });
        if (kind === "item") {
          await tx.plexClaimGroupMember.create({
            data: {
              groupId: group.id,
              ...row.value.scope,
              evidenceId: row.id,
              associationHash: row.hash,
            },
          });
          await tx.plexItemClaim.create({
            data: {
              groupId: group.id,
              ...row.value.scope,
              evidenceId: row.id,
              associationHash: row.hash,
              serverMachineId: prior.access.serverMachineId,
              sectionId: prior.access.sectionId,
              ratingKey: prior.item.ratingKey,
            },
          });
        } else
          await tx.plexPartClaim.create({
            data: {
              groupId: group.id,
              serverMachineId: prior.access.serverMachineId,
              partId: prior.item.media[0].parts[0].id,
              canonicalPath: row.value.group.canonicalPath,
            },
          });
      }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(await snapshot(cluster.database, original)).toEqual(before);
    const namedState = await snapshot(cluster.database, named);
    expect(namedState.groups).toEqual([]);
  },
);

test("competing transactions cannot claim one exact server path for two groups", async () => {
  const groups = await graph(cluster.database);
  const rivals = await graph(cluster.database, {
    leaves: 1,
    edition: "extended_cut",
  });
  const original = groups[0],
    rival = rivals[0];
  if (original === undefined || rival === undefined)
    throw new Error("Missing competing graph");
  const value = first(original).value;
  const held = Promise.withResolvers<undefined>();
  const release = Promise.withResolvers<undefined>();
  const secondPid = Promise.withResolvers<number>();
  const winner = cluster.database.$transaction(async (tx) => {
    await bindPlexTransactionDeadline(tx, freshness());
    await insertClaims(tx, groups);
    held.resolve(undefined);
    await release.promise;
  });
  const winnerResult = settleClaimAttempt(winner, (error) =>
    held.reject(error),
  );
  await held.promise;
  const loser = cluster.database.$transaction(async (tx) => {
    await bindPlexTransactionDeadline(tx, freshness());
    await tx.plexClaimGroup.create({
      data: {
        id: rival.id,
        serverMachineId: value.access.serverMachineId,
        groupHash: identityHash(first(rival).value.group),
        group: first(rival).value.group,
      },
    });
    const rows = await tx.$queryRaw<
      { pid: number }[]
    >`SELECT pg_backend_pid() AS pid`;
    const pid = rows[0]?.pid;
    if (pid === undefined) throw new Error("Competing PostgreSQL PID missing");
    secondPid.resolve(pid);
    await tx.plexPathClaim.create({
      data: {
        groupId: rival.id,
        serverMachineId: value.access.serverMachineId,
        canonicalPath: value.group.canonicalPath,
        canonicalPathHash: plexCanonicalPathHash(value.group.canonicalPath),
      },
    });
  });
  const loserResult = settleClaimAttempt(loser, (error) =>
    secondPid.reject(error),
  );
  try {
    const pid = await secondPid.promise;
    await expect
      .poll(async () => {
        const rows = await cluster.database.$queryRaw<
          { waiting: boolean }[]
        >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE pid=${pid} AND wait_event_type='Lock') AS waiting`;
        return rows[0]?.waiting;
      })
      .toBe(true);
  } finally {
    release.resolve(undefined);
    await Promise.all([winnerResult, loserResult]);
  }
  expect(await winnerResult).toEqual({ status: "committed" });
  expect(await loserResult).toMatchObject({
    status: "failed",
    error: { code: "P2002" },
  });
  const winnerState = await snapshot(cluster.database, groups);
  expect(winnerState.paths).toHaveLength(1);
  const rivalState = await snapshot(cluster.database, rivals);
  expect(rivalState.groups).toEqual([]);
  expect(await cluster.database.plexClaimValidation.count()).toBe(0);
});

async function settleClaimAttempt(
  work: Promise<unknown>,
  reject: (error: unknown) => void,
) {
  try {
    await work;
    return { status: "committed" };
  } catch (error: unknown) {
    reject(error);
    return { status: "failed", error };
  }
}
