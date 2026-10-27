import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  LibraryPlexReceiptV1Schema,
  type LibraryPlexReceiptV1,
  type LibraryPlexExpectedV2,
} from "#shared/plex-binding/library.ts";
import {
  PlexBindingSnapshotSchema,
  plexScopeKey,
  type PlexBindingFreshness,
} from "#shared/plex-binding/contract.ts";
import type {
  LibraryPlexBindingInputV1,
  PlexBindingExecution,
} from "#shared/plex-binding/activities.ts";
import { bindPlexTransactionDeadline } from "#infrastructure/plex-binding/freshness.ts";
import { replacePlexClaims } from "#infrastructure/plex-binding/claims.ts";
import { writePlexBindingPointers } from "#infrastructure/plex-binding/commit.ts";
import { PlexBindingProtection } from "#infrastructure/plex-binding/errors.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  captureLibraryPlexExpectedV2,
  lockLibraryPlexScope,
} from "./authority.ts";
import {
  libraryPlexCommand,
  readLibraryPlexCompletion,
  type LibraryPlexRequest,
} from "./records.ts";
import { assertLibraryPlexObservation } from "./observation.ts";

export async function commitLibraryPlexBinding(
  tx: Prisma.TransactionClient,
  input: {
    input: LibraryPlexBindingInputV1;
    request: LibraryPlexRequest;
    expected: LibraryPlexExpectedV2;
    observation: LibraryPlexReceiptV1["observation"];
    freshness: PlexBindingFreshness;
    execution: PlexBindingExecution;
    writerExpiresAtMs: number;
  },
  budget: PublicationAuthorityReadBudget,
) {
  const { freshness, expected } = input;
  await lockLibraryPlexScope(tx, expected, freshness);
  await tx.$queryRaw`SELECT id FROM "Operation" WHERE id=${input.input.operationId} FOR UPDATE`;
  const prior = await readLibraryPlexCompletion(
    tx,
    input.input,
    input.request,
    budget,
  );
  if (prior !== null) return prior;
  const current = await captureLibraryPlexExpectedV2(
    tx,
    {
      command: input.input,
      parent: input.request.parent,
      birth: input.request.birth,
      access: expected.access,
    },
    budget,
  );
  if (identityHash(current.expected) !== identityHash(expected))
    throw new PlexBindingProtection("scope_changed");
  if (
    freshness.expiresAtMs >
    Math.min(
      current.writerExpiresAtMs,
      input.writerExpiresAtMs,
      input.execution.expiresAtMs,
    )
  )
    throw new PlexBindingProtection("verification_expired");
  await bindPlexTransactionDeadline(tx, freshness);
  const associations = assertLibraryPlexObservation(
    expected,
    input.observation,
    freshness.expiresAtMs,
  );
  const rows = associations.map((association) => ({
    id: crypto.randomUUID(),
    ...association.scope,
    assetId: association.group.assetId,
    serverMachineId: association.access.serverMachineId,
    associationHash: identityHash(association),
    evidence: z.record(z.string(), z.json()).parse(association),
  }));
  await tx.plexAssociationEvidence.createMany({
    data: rows,
    skipDuplicates: true,
  });
  const stored = await tx.plexAssociationEvidence.findMany({
    where: {
      OR: rows.map(({ mediaId, edition, associationHash }) => ({
        mediaId,
        edition,
        associationHash,
      })),
    },
    take: budget.take,
  });
  budget.consume(stored.length);
  const members = associations.map((association) => {
    const hash = identityHash(association);
    const row = stored.find(
      (candidate) =>
        candidate.mediaId === association.scope.mediaId &&
        candidate.edition === association.scope.edition &&
        candidate.associationHash === hash,
    );
    if (
      row === undefined ||
      identityHash(row.evidence) !== hash ||
      row.assetId !== input.input.assetId ||
      row.serverMachineId !== association.access.serverMachineId
    )
      throw new Error("Library Plex immutable association insert changed");
    return { association, evidenceId: row.id, associationHash: hash };
  });
  const bindings = members.map((member) => {
    const previous = expected.previous.find(
      (pointer) =>
        plexScopeKey(pointer.scope) === plexScopeKey(member.association.scope),
    );
    if (previous === undefined)
      throw new Error("Library Plex prior pointer missing");
    return PlexBindingSnapshotSchema.parse({
      scope: member.association.scope,
      evidenceId: member.evidenceId,
      associationHash: member.associationHash,
      revision:
        previous.revision +
        (previous.evidence?.associationHash === member.associationHash ? 0 : 1),
    });
  });
  const server = expected.access[0];
  if (server === undefined)
    throw new Error("Library Plex configured server missing");
  await replacePlexClaims(
    tx,
    {
      serverMachineId: server.serverMachineId,
      oldGroups: expected.oldGroups,
      members,
    },
    freshness,
  );
  await writePlexBindingPointers(
    tx,
    {
      expected,
      bindings,
      startedAt: input.observation.verification.startedAt,
      completedAt: input.observation.verification.completedAt,
    },
    freshness,
  );
  const changed = bindings
    .filter(
      (binding) =>
        expected.previous.find(
          (pointer) =>
            plexScopeKey(pointer.scope) === plexScopeKey(binding.scope),
        )?.evidence?.associationHash !== binding.associationHash,
    )
    .map((binding) => binding.scope);
  await invalidateConsequences(tx, changed);
  await tx.libraryAsset.updateMany({
    where: { id: input.input.assetId, plexPublishedAt: null },
    data: { plexPublishedAt: new Date() },
  });
  const receipt = LibraryPlexReceiptV1Schema.parse({
    schemaVersion: 1,
    input: input.input,
    command: libraryPlexCommand(input.request.command),
    expected,
    observation: input.observation,
    bindings,
    sdk: {
      observedAt: new Date(input.execution.observed.wall).toISOString(),
      expiresAt: new Date(input.execution.expiresAtMs).toISOString(),
    },
    writerExpiresAt: new Date(input.writerExpiresAtMs).toISOString(),
    committedAt: new Date().toISOString(),
  });
  const envelope = {
    receipt: z.json().parse(receipt),
    receiptHash: identityHash(receipt),
  };
  const updated =
    await tx.$executeRaw`UPDATE "Operation" SET result=COALESCE(result,'{}'::jsonb) || jsonb_build_object('libraryPlexReceiptV1',${JSON.stringify(envelope)}::jsonb) WHERE id=${input.input.operationId} AND NOT (COALESCE(result,'{}'::jsonb) ? 'libraryPlexReceiptV1')`;
  if (updated !== 1)
    throw new Error("Library Plex completion was already recorded");
  freshness.assertActive();
  return receipt;
}

async function invalidateConsequences(
  tx: Prisma.TransactionClient,
  scopes: LibraryPlexReceiptV1["bindings"][number]["scope"][],
) {
  if (scopes.length === 0) return;
  await tx.plexWatchProjection.deleteMany({ where: { OR: scopes } });
  await tx.watchState.deleteMany({ where: { OR: scopes } });
  await tx.retentionDecision.updateMany({
    where: {
      OR: scopes,
      state: { in: ["eligible", "warning_pending", "grace_period"] },
    },
    data: { state: "cancelled", version: { increment: 1 } },
  });
}
