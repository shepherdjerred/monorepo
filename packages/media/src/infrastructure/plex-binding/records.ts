import type { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import {
  PlexAssociationV1Schema,
  PlexBindingSnapshotSchema,
  type PlexBindingScope,
} from "#shared/plex-binding/contract.ts";
import { PlexBindingExpectedSchema } from "#shared/plex-binding/expected.ts";
import {
  ReverifyPlexBindingInputSchema,
  ReverifyPlexBindingResultSchema,
  type ReverifyPlexBindingInput,
} from "#shared/plex-binding/activities.ts";
import { PlexBindingVerificationCompletionSchema } from "#shared/plex-binding/observations.ts";

/** Hash the literal stored JSON before any parser may strip or normalize fields. */
export function parsePlexRecord<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  hash: string,
): T {
  if (identityHash(raw) !== hash)
    throw new Error("Plex immutable evidence hash changed");
  return schema.parse(raw);
}

export async function readPlexPointer(
  tx: Prisma.TransactionClient,
  scope: PlexBindingScope,
) {
  const pointers = await readPlexPointers(tx, [scope]);
  const pointer = pointers[0];
  if (pointer === undefined)
    throw new Error("Plex pointer query omitted requested scope");
  return pointer;
}

export async function readPlexPointers(
  tx: Prisma.TransactionClient,
  scopes: readonly PlexBindingScope[],
) {
  const rows = await tx.plexBindingCurrent.findMany({
    where: { OR: [...scopes] },
    include: { evidence: true },
  });
  const byScope = new Map(
    rows.map((row) => [`${row.mediaId}/${row.edition}`, row]),
  );
  return scopes.map((scope) =>
    pointerRecord(
      scope,
      byScope.get(`${scope.mediaId}/${scope.edition}`) ?? null,
    ),
  );
}

function pointerRecord(
  scope: PlexBindingScope,
  row: Prisma.PlexBindingCurrentGetPayload<{
    include: { evidence: true };
  }> | null,
) {
  if (row?.evidenceId == null)
    return {
      expected: { scope, revision: row?.revision ?? 0, evidence: null },
      current: null,
    };
  if (row.evidence === null || row.associationHash === null)
    throw new Error("Plex current evidence is missing");
  const association = parsePlexRecord(
    PlexAssociationV1Schema,
    row.evidence.evidence,
    row.associationHash,
  );
  if (
    association.scope.mediaId !== scope.mediaId ||
    association.scope.edition !== scope.edition ||
    association.group.assetId !== row.evidence.assetId ||
    association.access.serverMachineId !== row.evidence.serverMachineId
  )
    throw new Error("Plex evidence relational identity changed");
  const snapshot = PlexBindingSnapshotSchema.parse({
    scope,
    evidenceId: row.evidenceId,
    associationHash: row.associationHash,
    revision: row.revision,
  });
  return {
    expected: {
      scope,
      revision: row.revision,
      evidence: { id: row.evidenceId, associationHash: row.associationHash },
    },
    current: { snapshot, association },
  };
}

export async function loadPlexVerificationRequest(
  tx: Prisma.TransactionClient,
  raw: ReverifyPlexBindingInput,
) {
  const input = ReverifyPlexBindingInputSchema.parse(raw);
  const request = await tx.plexBindingVerificationRequest.findUniqueOrThrow({
    where: { operationId: input.operationId },
    include: { operation: true },
  });
  const command = ReverifyPlexBindingInputSchema.parse(
    request.operation.payload,
  );
  if (
    identityHash(command) !== identityHash(input) ||
    request.operation.kind !== input.kind ||
    request.operation.targetId !== input.assetIds[0] ||
    request.recoveryEpoch !== input.recoveryEpoch ||
    identityHash(request.assetIds) !== identityHash(input.assetIds)
  )
    throw new Error("Plex verification command parent changed");
  const expected = parsePlexRecord(
    PlexBindingExpectedSchema,
    request.expected,
    request.expectedHash,
  );
  if (
    expected.recoveryEpoch !== input.recoveryEpoch ||
    identityHash(expected.newGroups.map((group) => group.assetId)) !==
      identityHash(input.assetIds)
  )
    throw new Error("Plex verification expected coverage changed");
  return { input, request, expected };
}

/** Exact ACK only: does not consult or grant current-serving authority. */
export async function readPlexVerificationCompletion(
  tx: Prisma.TransactionClient,
  input: ReverifyPlexBindingInput,
) {
  const parent = await loadPlexVerificationRequest(tx, input);
  const receipt = await tx.plexBindingVerificationReceipt.findUnique({
    where: { operationId: input.operationId },
  });
  if (receipt === null) return null;
  const completion = parsePlexRecord(
    PlexBindingVerificationCompletionSchema,
    receipt.completion,
    receipt.completionHash,
  );
  assertCompletionParent(receipt, parent, completion, input);
  const evidence = await tx.plexAssociationEvidence.findMany({
    where: {
      id: { in: completion.bindings.map((binding) => binding.evidenceId) },
    },
  });
  const byId = new Map(evidence.map((row) => [row.id, row]));
  const groupHashes = new Set(
    parent.expected.newGroups.map((group) => identityHash(group)),
  );
  const targets = new Map(
    parent.expected.targets.map((target) => [
      `${target.scope.mediaId}/${target.scope.edition}`,
      target,
    ]),
  );
  const accessHashes = new Set(
    parent.expected.access.map((access) => identityHash(access)),
  );
  const expectedScopes = parent.expected.newGroups
    .flatMap((group) => group.coverage)
    .map((scope) => `${scope.mediaId}/${scope.edition}`)
    .sort();
  if (
    identityHash(expectedScopes) !==
    identityHash(
      completion.bindings.map(
        (binding) => `${binding.scope.mediaId}/${binding.scope.edition}`,
      ),
    )
  )
    throw new Error("Plex completion omitted expected coverage");
  for (const binding of completion.bindings) {
    const row = byId.get(binding.evidenceId);
    if (row?.associationHash !== binding.associationHash)
      throw new Error("Plex completion evidence missing");
    const association = parsePlexRecord(
      PlexAssociationV1Schema,
      row.evidence,
      row.associationHash,
    );
    const target = targets.get(
      `${binding.scope.mediaId}/${binding.scope.edition}`,
    );
    if (target === undefined)
      throw new Error("Plex completion physical parent changed");
    if (
      identityHash(association.scope) !== identityHash(binding.scope) ||
      row.mediaId !== binding.scope.mediaId ||
      row.edition !== binding.scope.edition ||
      row.assetId !== association.group.assetId ||
      row.serverMachineId !== association.access.serverMachineId ||
      !groupHashes.has(identityHash(association.group)) ||
      target.editionRootId !== association.editionRootId ||
      target.canonicalIdentityHash !== association.canonicalIdentityHash ||
      target.numberingHash !== association.numberingHash ||
      identityHash(target.definition) !==
        identityHash(association.definition) ||
      !accessHashes.has(identityHash(association.access))
    )
      throw new Error("Plex completion physical parent changed");
  }
  return ReverifyPlexBindingResultSchema.parse({
    status: "verified",
    bindingCount: completion.bindingCount,
  });
}

function assertCompletionParent(
  receipt: { expectedHash: string },
  parent: Awaited<ReturnType<typeof loadPlexVerificationRequest>>,
  completion: z.infer<typeof PlexBindingVerificationCompletionSchema>,
  input: ReverifyPlexBindingInput,
) {
  if (
    receipt.expectedHash !== parent.request.expectedHash ||
    completion.expectedHash !== receipt.expectedHash ||
    completion.inputHash !== identityHash(parent.input) ||
    completion.operationId !== input.operationId ||
    completion.recoveryEpoch !== input.recoveryEpoch
  )
    throw new Error("Plex completion immutable parent changed");
}
