import { afterAll, beforeAll, expect, test } from "vitest";
import type { Prisma } from "#generated/prisma/client.ts";
import { startMediaTestPostgres } from "#testing/postgres.ts";
import { createOutboxActivities } from "#automation/store.ts";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { CommittedQuarantinePlexReceiptSchema } from "#shared/plex-binding/watch.ts";
import { bindPlexTransactionDeadline } from "./freshness.ts";
import { captureRetentionPlexProjection } from "./retention.ts";
import { recordCommittedPlexQuarantine } from "./quarantine-commit.ts";
import {
  commitClaims,
  first,
  freshness,
  graph,
  removeClaims,
} from "./schema/schema.test-support.ts";

let cluster: Awaited<ReturnType<typeof startMediaTestPostgres>>;
beforeAll(async () => {
  cluster = await startMediaTestPostgres();
}, 60_000);
afterAll(async () => {
  await cluster.close();
});

/** Relational guard fixture only; no Plex transport or filesystem effect is claimed. */
async function fixture() {
  const db = cluster.database;
  const groups = await graph(db);
  await commitClaims(db, groups);
  const group = groups[0];
  if (group === undefined) throw new Error("Quarantine fixture group missing");
  const physical = first(group).value.group;
  const bindings = group.associations.map((row) => ({
    scope: row.value.scope,
    evidenceId: row.id,
    associationHash: row.hash,
    revision: 1,
  }));
  const manifest = RemovalPlanSchema.parse({
    assets: [
      {
        assetId: physical.assetId,
        assetVersion: physical.assetVersion,
        libraryKind: "tv",
        libraryPath: physical.canonicalPath.slice("/data/tv/".length),
        checksum: physical.checksum,
        quarantineId: crypto.randomUUID(),
        mediaIds: physical.coverage.map((scope) => scope.mediaId),
        generations: Object.fromEntries(
          physical.coverage.map((scope) => [scope.mediaId, 0]),
        ),
        sidecars: [],
      },
    ],
  });
  const decisions = await db.$transaction(async (tx) => {
    const rows = [];
    for (const scope of physical.coverage) {
      const decision = await tx.retentionDecision.create({
        data: {
          ...scope,
          generation: 0,
          state: "eligible",
          evidence: { recoveryEpoch: 0 },
        },
      });
      const projection = await captureRetentionPlexProjection(tx, {
        decisionId: decision.id,
        groups: [physical],
        bindings,
      });
      await tx.retentionDecision.update({
        where: { id: decision.id },
        data: {
          state: "grace_period",
          version: 1,
          warningAcceptedAt: new Date(0),
          graceUntil: new Date(1),
        },
      });
      rows.push({
        decisionId: decision.id,
        mediaId: decision.mediaId,
        beforeVersion: 1,
        quarantinedVersion: 2,
        projectionHash: identityHash(projection),
      });
    }
    return rows.sort((a, b) => a.decisionId.localeCompare(b.decisionId));
  });
  const primary = decisions[0];
  if (primary === undefined)
    throw new Error("Quarantine primary decision missing");
  const operationId = crypto.randomUUID();
  await db.operation.create({
    data: {
      id: operationId,
      kind: "retain_media",
      targetId: primary.mediaId,
      payload: {
        operationId,
        kind: "retain_media",
        mediaId: primary.mediaId,
        recoveryEpoch: 0,
      },
    },
  });
  const receipt = CommittedQuarantinePlexReceiptSchema.parse({
    schemaVersion: 1,
    operationId,
    decisionId: primary.decisionId,
    recoveryEpoch: 0,
    manifestHash: identityHash(manifest),
    decisions,
    groups: [physical],
    bindings,
    committedAt: new Date().toISOString(),
  });
  return { group, physical, manifest, receipt };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function quarantine(tx: Prisma.TransactionClient, f: Fixture) {
  const quarantinedAt = new Date();
  await tx.libraryAsset.update({
    where: { id: f.physical.assetId },
    data: {
      state: "quarantined",
      version: { increment: 1 },
    },
  });
  await tx.retentionDecision.updateMany({
    where: { id: { in: f.receipt.decisions.map((row) => row.decisionId) } },
    data: {
      state: "quarantined",
      version: { increment: 1 },
      manifest: f.manifest,
      quarantinedAt,
      purgeAfter: new Date(quarantinedAt.getTime() + 7 * 86_400_000),
    },
  });
}

async function write(
  tx: Prisma.TransactionClient,
  operationId: string,
  receipt: unknown,
) {
  await tx.$executeRaw`UPDATE "Operation" SET result=jsonb_build_object('quarantinePlexReceipt',${JSON.stringify(receipt)}::jsonb) WHERE id=${operationId}`;
}

async function commit(f: Fixture) {
  await cluster.database.$transaction(async (tx) => {
    await bindPlexTransactionDeadline(tx, freshness());
    await quarantine(tx, f);
    await write(tx, f.receipt.operationId, f.receipt);
  });
}

async function recordTransition(tx: Prisma.TransactionClient, f: Fixture) {
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: f.receipt.operationId },
  });
  const { committedAt: _time, ...receipt } = f.receipt;
  return recordCommittedPlexQuarantine(
    tx,
    {
      expected: {
        commandHash: identityHash(operation.payload),
        manifest: f.manifest,
        receipt,
      },
    },
    freshness(),
  );
}

test("quarantine record atomically retires whole-group serving claims and watches while preserving recovery parents", async () => {
  const f = await fixture();
  const db = cluster.database;
  const user = await db.mediaUser.create({
    data: {
      plexAccountId: crypto.randomUUID(),
      displayName: "Synthetic quarantine watcher",
    },
  });
  for (const binding of f.receipt.bindings) {
    const key = { userId: user.id, ...binding.scope };
    const observedAt = new Date();
    const authority = { purpose: "current_serving", binding };
    await db.watchState.create({
      data: { ...key, watched: true, observedAt, source: "plex_current" },
    });
    await db.plexWatchProjection.create({
      data: {
        ...key,
        evidenceId: binding.evidenceId,
        associationHash: binding.associationHash,
        bindingRevision: binding.revision,
        purpose: "current_serving",
        watchBatchRevision: 1n,
        watched: true,
        observedAt,
        source: "plex",
        authority,
        authorityHash: identityHash(authority),
      },
    });
  }
  const decisionIds = f.receipt.decisions.map((value) => value.decisionId);
  const projections = await db.retentionPlexProjection.findMany({
    where: { decisionId: { in: decisionIds } },
    orderBy: { decisionId: "asc" },
  });
  const receipt = await db.$transaction(async (tx) => {
    await quarantine(tx, f);
    return recordTransition(tx, f);
  });
  const scopes = f.receipt.bindings.map((binding) => binding.scope);
  const pointers = await db.plexBindingCurrent.findMany({
    where: { OR: scopes },
  });
  expect(pointers).toHaveLength(scopes.length);
  for (const pointer of pointers)
    expect(pointer).toMatchObject({
      evidenceId: null,
      associationHash: null,
      revision: 2,
      verifiedStartedAt: null,
      verifiedCompletedAt: null,
    });
  expect(await db.plexClaimGroup.count({ where: { id: f.group.id } })).toBe(0);
  expect(await db.plexItemClaim.count({ where: { groupId: f.group.id } })).toBe(
    0,
  );
  expect(await db.plexPartClaim.count({ where: { groupId: f.group.id } })).toBe(
    0,
  );
  expect(await db.plexPathClaim.count({ where: { groupId: f.group.id } })).toBe(
    0,
  );
  expect(await db.watchState.count({ where: { OR: scopes } })).toBe(0);
  expect(await db.plexWatchProjection.count({ where: { OR: scopes } })).toBe(0);
  expect(
    await db.retentionPlexProjection.findMany({
      where: { decisionId: { in: decisionIds } },
      orderBy: { decisionId: "asc" },
    }),
  ).toEqual(projections);
  expect(
    await db.plexAssociationEvidence.count({
      where: {
        id: { in: receipt.bindings.map((binding) => binding.evidenceId) },
      },
    }),
  ).toBe(scopes.length);
  const persisted = await state(f);
  expect(persisted.operation.result).toEqual({
    quarantinePlexReceipt: receipt,
  });
  for (const decision of persisted.decisions)
    expect(decision.state).toBe("quarantined");
});

test("quarantine record refuses an incomplete current claim and rolls back its receipt and physical versions", async () => {
  const f = await fixture();
  const before = await state(f);
  await expect(
    cluster.database.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness());
      await tx.plexPartClaim.deleteMany({ where: { groupId: f.group.id } });
      await quarantine(tx, f);
      await recordTransition(tx, f);
    }),
  ).rejects.toMatchObject({ reason: "binding_changed" });
  expect(await state(f)).toEqual(before);
  expect(
    await cluster.database.plexPartClaim.count({
      where: { groupId: f.group.id },
    }),
  ).toBeGreaterThan(0);
});

async function state(f: Fixture) {
  return {
    asset: await cluster.database.libraryAsset.findUniqueOrThrow({
      where: { id: f.physical.assetId },
    }),
    decisions: await cluster.database.retentionDecision.findMany({
      where: { id: { in: f.receipt.decisions.map((row) => row.decisionId) } },
      orderBy: { id: "asc" },
    }),
    operation: await cluster.database.operation.findUniqueOrThrow({
      where: { id: f.receipt.operationId },
    }),
  };
}

test("new complete quarantine receipt commits with its physical rows and survives actual finish reason merge", async () => {
  const f = await fixture();
  await commit(f);
  const before = await state(f);
  expect(before.asset).toMatchObject({ state: "quarantined", version: 1 });
  expect(before.decisions).toHaveLength(2);
  for (const decision of before.decisions)
    expect(decision).toMatchObject({
      state: "quarantined",
      version: 2,
      manifest: f.manifest,
    });
  expect(before.operation.result).toEqual({ quarantinePlexReceipt: f.receipt });
  const activities = createOutboxActivities(cluster.database, async () => {
    throw new Error("This receipt test must not dispatch a Workflow");
  });
  await activities.finishMediaOperation({
    operationId: f.receipt.operationId,
    status: "completed",
    reason: "quarantined",
  });
  const after = await state(f);
  expect(after.operation.result).toEqual({
    quarantinePlexReceipt: f.receipt,
    reason: "quarantined",
  });
  expect(identityHash(after.operation.result)).toBe(
    identityHash({ quarantinePlexReceipt: f.receipt, reason: "quarantined" }),
  );
  expect(after.asset).toEqual(before.asset);
  expect(after.decisions).toEqual(before.decisions);
});

test("already committed legacy quarantine rows cannot receive a receipt in a later transaction", async () => {
  const f = await fixture();
  await cluster.database.$transaction((tx) => quarantine(tx, f));
  const before = await state(f);
  await expect(
    cluster.database.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness());
      await write(tx, f.receipt.operationId, f.receipt);
    }),
  ).rejects.toThrow("this transaction");
  expect(await state(f)).toEqual(before);
});

test("same-transaction decision changes cannot attach proof to an asset quarantined earlier", async () => {
  const f = await fixture();
  await cluster.database.libraryAsset.update({
    where: { id: f.physical.assetId },
    data: { state: "quarantined", version: 1 },
  });
  const before = await state(f);
  await expect(
    cluster.database.$transaction(async (tx) => {
      await bindPlexTransactionDeadline(tx, freshness());
      await tx.retentionDecision.updateMany({
        where: { id: { in: f.receipt.decisions.map((row) => row.decisionId) } },
        data: {
          state: "quarantined",
          version: 2,
          manifest: f.manifest,
          quarantinedAt: new Date(),
          purgeAfter: new Date(Date.now() + 86_400_000),
        },
      });
      await write(tx, f.receipt.operationId, f.receipt);
    }),
  ).rejects.toThrow("this transaction");
  expect(await state(f)).toEqual(before);
});

test("a valid historical association cannot replace the current pointer at quarantine commit", async () => {
  const f = await fixture();
  await cluster.database.$transaction(async (tx) => {
    await bindPlexTransactionDeadline(tx, freshness());
    await removeClaims(tx, f.group);
    await tx.plexBindingCurrent.updateMany({
      where: {
        mediaId: { in: f.physical.coverage.map((scope) => scope.mediaId) },
      },
      data: {
        evidenceId: null,
        associationHash: null,
        revision: 2,
        verifiedStartedAt: null,
        verifiedCompletedAt: null,
      },
    });
  });
  const before = await state(f);
  await expect(commit(f)).rejects.toThrow("captured current pointer");
  expect(await state(f)).toEqual(before);
});

test.each(["reference", "partial_group", "empty_group"] as const)(
  "quarantine receipt rejects %s and rolls back all physical row updates",
  async (change) => {
    const f = await fixture();
    const before = await state(f);
    const receipt = structuredClone(f.receipt);
    if (change === "reference") {
      const binding = receipt.bindings[0];
      if (binding === undefined) throw new Error("Quarantine binding missing");
      binding.evidenceId = crypto.randomUUID();
    } else {
      const group = receipt.groups[0];
      if (group === undefined) throw new Error("Quarantine group missing");
      group.coverage =
        change === "empty_group" ? [] : group.coverage.slice(0, 1);
      group.coverageHash = identityHash(group.coverage);
    }
    await expect(
      cluster.database.$transaction(async (tx) => {
        await bindPlexTransactionDeadline(tx, freshness());
        await quarantine(tx, f);
        await write(tx, receipt.operationId, receipt);
      }),
    ).rejects.toThrow();
    expect(await state(f)).toEqual(before);
  },
);

test.each(["change", "remove", "null"] as const)(
  "committed quarantine subtree refuses %s while retaining literal receipt hash",
  async (change) => {
    const f = await fixture();
    await commit(f);
    const before = await state(f);
    const result =
      change === "remove"
        ? {}
        : {
            quarantinePlexReceipt:
              change === "null"
                ? null
                : { ...f.receipt, manifestHash: "0".repeat(64) },
          };
    await expect(
      cluster.database
        .$executeRaw`UPDATE "Operation" SET result=${JSON.stringify(result)}::jsonb WHERE id=${f.receipt.operationId}`,
    ).rejects.toThrow("immutable");
    expect(await state(f)).toEqual(before);
  },
);
