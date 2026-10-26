import type { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { RetentionPlexProjectionV1Schema } from "#shared/plex-binding/watch.ts";
import type {
  PlexBindingFreshness,
  PlexBindingScope,
  PlexBindingSnapshot,
  PlexPhysicalGroup,
} from "#shared/plex-binding/contract.ts";
import { plexScopeKey } from "#shared/plex-binding/contract.ts";
import type { PlexBindingExpected } from "#shared/plex-binding/expected.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { parsePlexRecord, readPlexPointers } from "./records.ts";
import { PlexBindingProtection } from "./errors.ts";

type ProjectionInput = {
  decisionId: string;
  groups: readonly PlexPhysicalGroup[];
  bindings: readonly PlexBindingSnapshot[];
};

function projection(input: ProjectionInput) {
  const scopes = input.groups
    .flatMap((group) => group.coverage.map((scope) => plexScopeKey(scope)))
    .sort();
  if (
    new Set(scopes).size !== scopes.length ||
    identityHash(scopes) !==
      identityHash(input.bindings.map((binding) => plexScopeKey(binding.scope)))
  )
    throw new Error(
      "Retention binding projection omitted complete physical coverage",
    );
  return RetentionPlexProjectionV1Schema.parse({
    schemaVersion: 1,
    decisionId: input.decisionId,
    groupHashes: input.groups.map((group) => identityHash(group)).sort(),
    bindings: input.bindings,
  });
}

/** Only the transaction creating a new eligible decision may attach its initial authority. */
export async function captureRetentionPlexProjection(
  tx: Prisma.TransactionClient,
  input: ProjectionInput,
) {
  const value = projection(input);
  const existing = await tx.retentionPlexProjection.findUnique({
    where: { decisionId: input.decisionId },
  });
  if (existing !== null) {
    const stored = parsePlexRecord(
      RetentionPlexProjectionV1Schema,
      existing.projection,
      existing.projectionHash,
    );
    if (identityHash(stored) !== identityHash(value))
      throw new Error("Retention association authority is immutable");
    return stored;
  }
  const decision = await tx.retentionDecision.findUniqueOrThrow({
    where: { id: input.decisionId },
  });
  const born = z.array(z.object({ currentTransaction: z.boolean() })).parse(
    await tx.$queryRaw`
    SELECT xmin::text = (txid_current() % 4294967296)::text AS "currentTransaction"
    FROM "RetentionDecision" WHERE id=${input.decisionId}`,
  );
  if (
    born[0]?.currentTransaction !== true ||
    decision.state !== "eligible" ||
    decision.version !== 0 ||
    decision.warningAcceptedAt !== null ||
    decision.graceUntil !== null ||
    decision.manifest !== null ||
    !input.bindings.some(
      (binding) =>
        binding.scope.mediaId === decision.mediaId &&
        binding.scope.edition === decision.edition,
    )
  )
    throw new PlexBindingProtection("reconciliation_required");
  const pointers = await readPlexPointers(
    tx,
    input.bindings.map((binding) => binding.scope),
  );
  for (const [index, pointer] of pointers.entries()) {
    const expected = input.bindings[index];
    if (
      expected === undefined ||
      pointer.current === null ||
      identityHash(pointer.current.snapshot) !== identityHash(expected) ||
      !value.groupHashes.includes(
        identityHash(pointer.current.association.group),
      )
    )
      throw new PlexBindingProtection("binding_changed");
  }
  await tx.retentionPlexProjection.create({
    data: {
      decisionId: input.decisionId,
      projection: z.record(z.string(), z.json()).parse(value),
      projectionHash: identityHash(value),
    },
  });
  return value;
}

/** Current serving or quarantine authority is independently checked by the purpose-specific caller. */
export async function assertRetentionPlexProjection(
  tx: Prisma.TransactionClient,
  input: ProjectionInput,
  freshness: PlexBindingFreshness,
): Promise<void> {
  const row = await tx.retentionPlexProjection.findUnique({
    where: { decisionId: input.decisionId },
  });
  freshness.assertActive();
  if (row === null) throw new PlexBindingProtection("reconciliation_required");
  const stored = parsePlexRecord(
    RetentionPlexProjectionV1Schema,
    row.projection,
    row.projectionHash,
  );
  if (identityHash(stored) !== identityHash(projection(input)))
    throw new PlexBindingProtection("binding_changed");
}

export async function invalidateRetentionPlexProjections(
  tx: Prisma.TransactionClient,
  input: {
    expected: PlexBindingExpected;
    changedScopes: readonly PlexBindingScope[];
  },
  freshness: PlexBindingFreshness,
): Promise<{ cancelledDecisionIds: string[] }> {
  const changed = new Set(
    input.changedScopes.map((scope) => plexScopeKey(scope)),
  );
  if (changed.size === 0) return { cancelledDecisionIds: [] };
  const mediaIds = [
    ...new Set(
      [...input.expected.oldGroups, ...input.expected.newGroups]
        .filter((group) =>
          group.coverage.some((scope) => changed.has(plexScopeKey(scope))),
        )
        .flatMap((group) => group.coverage.map((scope) => scope.mediaId)),
    ),
  ].sort();
  const decisions = await tx.retentionDecision.findMany({
    where: {
      mediaId: { in: mediaIds },
      edition: "default",
      state: { in: ["eligible", "warning_pending", "grace_period"] },
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  freshness.assertActive();
  const cancelledDecisionIds = decisions.map((decision) => decision.id);
  await tx.retentionDecision.updateMany({
    where: { id: { in: cancelledDecisionIds } },
    data: { state: "cancelled", version: { increment: 1 } },
  });
  freshness.assertActive();
  return { cancelledDecisionIds };
}
