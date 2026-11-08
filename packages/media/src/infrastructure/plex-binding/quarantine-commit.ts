import path from "node:path";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  RemovalPlanSchema,
  type RemovalEntry,
} from "#automation/files/types.ts";
import { CAPACITY_ROOTS } from "#shared/capacity/contract.ts";
import {
  CommittedQuarantinePlexReceiptSchema,
  RetentionPlexProjectionV1Schema,
  type CommittedQuarantinePlexReceipt,
} from "#shared/plex-binding/watch.ts";
import type {
  PlexAccess,
  PlexBindingFreshness,
  PlexPhysicalGroup,
} from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { readCurrentPlexBindings, readPlexPhysicalGroup } from "./read.ts";
import { parsePlexRecord, readPlexPointers } from "./records.ts";
import { bindPlexTransactionDeadline } from "./freshness.ts";
import { PlexBindingProtection } from "./errors.ts";
import { retireQuarantinedPlexBindings } from "./quarantine-invalidation.ts";

export type PlexQuarantineCommitExpected = {
  commandHash: string;
  manifest: { assets: RemovalEntry[] };
  receipt: Omit<CommittedQuarantinePlexReceipt, "committedAt">;
};

/** Call under the final retention locks, in the physical transaction, before its first syscall. */
export async function capturePlexQuarantineCommit(
  tx: Prisma.TransactionClient,
  input: {
    operationId: string;
    decisionId: string;
    plan: RemovalEntry[];
    access: readonly PlexAccess[];
  },
  freshness: PlexBindingFreshness,
): Promise<PlexQuarantineCommitExpected> {
  freshness.assertActive();
  const manifest = { assets: input.plan };
  RemovalPlanSchema.parse(manifest);
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: input.operationId },
  });
  const groups: PlexPhysicalGroup[] = [];
  for (const entry of input.plan) {
    const { asset, group } = await readPlexPhysicalGroup(tx, entry.assetId);
    freshness.assertActive();
    if (
      asset.state !== "published" ||
      group.ownershipEpoch !== runtime.recoveryEpoch ||
      group.assetVersion !== entry.assetVersion ||
      group.checksum !== entry.checksum ||
      group.canonicalPath !==
        path.posix.join(CAPACITY_ROOTS[entry.libraryKind], entry.libraryPath) ||
      identityHash(group.coverage.map((scope) => scope.mediaId)) !==
        identityHash([...entry.mediaIds].sort())
    )
      throw new PlexBindingProtection("ownership_changed");
    groups.push(group);
  }
  groups.sort((a, b) => a.assetId.localeCompare(b.assetId));
  const scopes = groups
    .flatMap((group) => group.coverage)
    .sort((a, b) => a.mediaId.localeCompare(b.mediaId));
  const pointers = await readPlexPointers(tx, scopes);
  freshness.assertActive();
  const reads = pointers.map((pointer) => {
    if (pointer.current === null)
      throw new PlexBindingProtection("missing_binding");
    const { association } = pointer.current;
    const access = input.access.find(
      (value) => value.sectionType === association.access.sectionType,
    );
    if (access === undefined) throw new PlexBindingProtection("wrong_section");
    return {
      scope: association.scope,
      assetId: association.group.assetId,
      access,
    };
  });
  const current = await readCurrentPlexBindings(tx, reads);
  freshness.assertActive();
  const bindings = current.map((value) => {
    if (value.status !== "current")
      throw new PlexBindingProtection(value.reason);
    return value.snapshot;
  });
  const decisions = await tx.retentionDecision.findMany({
    where: {
      mediaId: { in: scopes.map((scope) => scope.mediaId) },
      edition: "default",
      state: "grace_period",
    },
    include: { plexProjection: true },
    orderBy: { id: "asc" },
  });
  freshness.assertActive();
  const proof = decisions.map((decision) => {
    if (decision.plexProjection === null)
      throw new PlexBindingProtection("reconciliation_required");
    const projection = parsePlexRecord(
      RetentionPlexProjectionV1Schema,
      decision.plexProjection.projection,
      decision.plexProjection.projectionHash,
    );
    if (
      projection.decisionId !== decision.id ||
      identityHash(projection.bindings) !== identityHash(bindings) ||
      identityHash(projection.groupHashes) !==
        identityHash(groups.map((group) => identityHash(group)).sort())
    )
      throw new PlexBindingProtection("binding_changed");
    return {
      decisionId: decision.id,
      mediaId: decision.mediaId,
      beforeVersion: decision.version,
      quarantinedVersion: decision.version + 1,
      projectionHash: decision.plexProjection.projectionHash,
    };
  });
  const receipt = CommittedQuarantinePlexReceiptSchema.parse({
    schemaVersion: 1,
    operationId: input.operationId,
    decisionId: input.decisionId,
    recoveryEpoch: runtime.recoveryEpoch,
    manifestHash: identityHash(manifest),
    decisions: proof,
    groups,
    bindings,
    committedAt: new Date().toISOString(),
  });
  assertQuarantineOperation(operation, receipt);
  if (
    z
      .object({ quarantinePlexReceipt: z.unknown().optional() })
      .nullable()
      .parse(operation.result)?.quarantinePlexReceipt !== undefined
  )
    throw new PlexBindingProtection("scope_changed");
  const { committedAt: _time, ...expected } = receipt;
  freshness.assertActive();
  return {
    commandHash: identityHash(operation.payload),
    manifest,
    receipt: expected,
  };
}

/** Called after actual quarantine and DB version updates, in the same already-locked transaction. */
export async function recordCommittedPlexQuarantine(
  tx: Prisma.TransactionClient,
  input: {
    expected: PlexQuarantineCommitExpected;
  },
  freshness: PlexBindingFreshness,
): Promise<CommittedQuarantinePlexReceipt> {
  freshness.assertActive();
  const { expected } = input;
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: expected.receipt.operationId },
  });
  if (
    identityHash(operation.payload) !== expected.commandHash ||
    identityHash(expected.manifest) !== expected.receipt.manifestHash
  )
    throw new PlexBindingProtection("scope_changed");
  let committedAt: number | undefined;
  for (const decision of expected.receipt.decisions) {
    const current = await tx.retentionDecision.findUniqueOrThrow({
      where: { id: decision.decisionId },
      include: { plexProjection: true },
    });
    freshness.assertActive();
    committedAt = quarantineCommitTime(current, decision, {
      manifestHash: expected.receipt.manifestHash,
      committedAt,
    });
  }
  if (committedAt === undefined)
    throw new PlexBindingProtection("scope_changed");
  const receipt = CommittedQuarantinePlexReceiptSchema.parse({
    ...expected.receipt,
    committedAt: new Date(committedAt).toISOString(),
  });
  assertQuarantineOperation(operation, receipt);
  for (const group of receipt.groups) {
    const current = await readPlexPhysicalGroup(tx, group.assetId);
    freshness.assertActive();
    if (
      current.asset.state !== "quarantined" ||
      identityHash(current.group) !==
        identityHash({ ...group, assetVersion: group.assetVersion + 1 })
    )
      throw new PlexBindingProtection("ownership_changed");
  }
  await bindPlexTransactionDeadline(tx, freshness);
  const written =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('quarantinePlexReceipt',${JSON.stringify(receipt)}::jsonb)
    WHERE id=${operation.id} AND NOT (COALESCE(result,'{}'::jsonb) ? 'quarantinePlexReceipt')`;
  if (written !== 1) throw new PlexBindingProtection("scope_changed");
  freshness.assertActive();
  await retireQuarantinedPlexBindings(tx, receipt, freshness);
  return receipt;
}

export function assertQuarantineOperation(
  operation: {
    id: string;
    kind: string;
    targetId: string | null;
    payload: unknown;
  },
  receipt: CommittedQuarantinePlexReceipt,
) {
  const command = z
    .object({
      operationId: z.uuid(),
      kind: z.literal("retain_media"),
      mediaId: z.uuid(),
      recoveryEpoch: z.int().nonnegative(),
    })
    .parse(operation.payload);
  const primary = receipt.decisions.find(
    (decision) => decision.decisionId === receipt.decisionId,
  );
  if (
    operation.id !== receipt.operationId ||
    operation.kind !== command.kind ||
    command.operationId !== operation.id ||
    command.recoveryEpoch !== receipt.recoveryEpoch ||
    primary?.mediaId !== command.mediaId ||
    operation.targetId !== command.mediaId
  )
    throw new Error("Plex quarantine operation parent changed");
}

function quarantineCommitTime(
  current: Prisma.RetentionDecisionGetPayload<{
    include: { plexProjection: true };
  }>,
  decision: CommittedQuarantinePlexReceipt["decisions"][number],
  expected: { manifestHash: string; committedAt: number | undefined },
) {
  if (current.quarantinedAt === null || current.purgeAfter === null)
    throw new PlexBindingProtection("scope_changed");
  if (
    current.state !== "quarantined" ||
    current.version !== decision.quarantinedVersion ||
    current.mediaId !== decision.mediaId ||
    current.edition !== "default" ||
    identityHash(current.manifest) !== expected.manifestHash ||
    current.plexProjection?.projectionHash !== decision.projectionHash ||
    current.purgeAfter.getTime() !==
      current.quarantinedAt.getTime() + 7 * 86_400_000 ||
    (expected.committedAt !== undefined &&
      expected.committedAt !== current.quarantinedAt.getTime())
  )
    throw new PlexBindingProtection("scope_changed");
  return current.quarantinedAt.getTime();
}
