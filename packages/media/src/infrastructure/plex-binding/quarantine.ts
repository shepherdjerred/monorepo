import { Prisma } from "#generated/prisma/client.ts";
import { z } from "zod";
import { RemovalPlanSchema } from "#automation/files/types.ts";
import {
  CommittedQuarantinePlexReceiptSchema,
  QuarantinePlexRefSchema,
  RetentionPlexProjectionV1Schema,
  type BoundWatchAuthority,
} from "#shared/plex-binding/watch.ts";
import {
  PlexAssociationV1Schema,
  plexScopeKey,
  type PlexAccess,
  type PlexAssociationV1,
  type PlexAssociation,
  type PlexBindingReason,
  type PlexBindingScope,
  type PlexPhysicalGroup,
} from "#shared/plex-binding/contract.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { recordsAuthorized } from "#infrastructure/handoff/authority.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { readPlexCanonicalTargets } from "./canonical.ts";
import { readPlexDefinition, readPlexPhysicalGroup } from "./read.ts";
import { parsePlexRecord } from "./records.ts";
import { assertQuarantineOperation } from "./quarantine-commit.ts";
import { quarantinePlexRebindings } from "./native/quarantine-native.ts";
import { PlexBindingProtection } from "./errors.ts";
import { NativeQuarantineContinuationSchema } from "#shared/native-recovery/quarantine.ts";
import {
  readMovieQuarantinedPlexWatchAuthority,
  assertCapturedMovieQuarantinedPlexWatchScope,
} from "#infrastructure/movie-editions/retention/quarantine-watch.ts";

type QuarantineWatchInput = {
  decisionId: string;
  scope: PlexBindingScope;
  assetId: string;
  access: PlexAccess;
};
export type QuarantinedPlexWatchScope = {
  input: QuarantineWatchInput;
  authority: Extract<BoundWatchAuthority, { purpose: "quarantined" }>;
  mediaIds: string[];
  assetIds: string[];
  continuationIds: string[];
  cohortHash: string;
};

/** Discover the complete immutable receipt/continuation union before acquiring canonical locks. */
export async function captureQuarantinedPlexWatchScope(
  tx: Prisma.TransactionClient,
  input: QuarantineWatchInput,
  budget?: PublicationAuthorityReadBudget,
): Promise<
  | { status: "current"; scope: QuarantinedPlexWatchScope }
  | { status: "protected"; reason: PlexBindingReason }
> {
  const current = await readQuarantinedPlexWatchAuthority(tx, input, budget);
  if (current.status !== "current") return current;
  const ref = current.authority.quarantine;
  if ("schemaVersion" in ref) {
    const cohort = {
      mediaIds: [ref.scope.mediaId],
      assetIds: [ref.group.assetId],
      continuationIds: [],
    };
    return {
      status: "current",
      scope: {
        input,
        authority: current.authority,
        ...cohort,
        cohortHash: identityHash({ authority: current.authority, ...cohort }),
      },
    };
  }
  const operation = await tx.operation.findUniqueOrThrow({
    where: { id: ref.operationId },
  });
  budget?.consume(1);
  const raw = z
    .object({ quarantinePlexReceipt: z.json() })
    .parse(operation.result).quarantinePlexReceipt;
  const receipt = parsePlexRecord(
    CommittedQuarantinePlexReceiptSchema,
    raw,
    ref.operationResultHash,
  );
  const mediaIds = new Set(
    receipt.groups.flatMap((group) =>
      group.coverage.map((scope) => scope.mediaId),
    ),
  );
  const assetIds = new Set(receipt.groups.map((group) => group.assetId));
  const continuationIds = ref.nativeReceipts
    .map((parent) => parent.continuationId)
    .sort();
  const rows = await tx.nativeQuarantineContinuation.findMany({
    where: { id: { in: continuationIds } },
  });
  budget?.consume(rows.length);
  if (rows.length !== continuationIds.length)
    throw new Error("Quarantine watch lock parent disappeared");
  const parents = new Map(
    ref.nativeReceipts.map((parent) => [parent.continuationId, parent]),
  );
  for (const row of rows) {
    const parent = parents.get(row.id);
    if (row.receiptId !== parent?.receiptId)
      throw new Error("Quarantine watch lock parent changed");
    const descriptor = parsePlexRecord(
      NativeQuarantineContinuationSchema,
      row.descriptor,
      parent.descriptorHash,
    );
    if (identityHash(descriptor.bindings) !== parent.bindingHash)
      throw new Error("Quarantine watch lock binding changed");
    for (const id of descriptor.group.mediaIds) mediaIds.add(id);
    for (const id of descriptor.group.assetIds) assetIds.add(id);
  }
  if (
    mediaIds.size > 10_000 ||
    assetIds.size > 100 ||
    continuationIds.length > 100
  )
    throw new PlexBindingProtection("scope_changed");
  const cohort = {
    mediaIds: [...mediaIds].sort(),
    assetIds: [...assetIds].sort(),
    continuationIds,
  };
  return {
    status: "current",
    scope: {
      input,
      authority: current.authority,
      ...cohort,
      cohortHash: identityHash({ authority: current.authority, ...cohort }),
    },
  };
}

/** Recheck under the exact captured union; never expand locks after the caller's prelude. */
export async function assertQuarantinedPlexWatchScope(
  tx: Prisma.TransactionClient,
  expected: QuarantinedPlexWatchScope,
  budget?: PublicationAuthorityReadBudget,
) {
  if ("schemaVersion" in expected.authority.quarantine) {
    const current = await readQuarantinedPlexWatchAuthority(
      tx,
      expected.input,
      budget,
    );
    if (current.status !== "current")
      throw new PlexBindingProtection(current.reason);
    assertCapturedMovieQuarantinedPlexWatchScope(expected, current);
    return current.authority;
  }
  const captured = await captureQuarantinedPlexWatchScope(
    tx,
    expected.input,
    budget,
  );
  if (captured.status !== "current")
    throw new PlexBindingProtection(captured.reason);
  if (
    identityHash({
      authority: expected.authority,
      mediaIds: expected.mediaIds,
      assetIds: expected.assetIds,
      continuationIds: expected.continuationIds,
    }) !== expected.cohortHash ||
    captured.scope.cohortHash !== expected.cohortHash
  )
    throw new PlexBindingProtection("scope_changed");
  return captured.scope.authority;
}

export type QuarantinedPlexWatchRead =
  | {
      status: "current";
      authority: Extract<BoundWatchAuthority, { purpose: "quarantined" }>;
      association: PlexAssociation;
    }
  | { status: "protected"; reason: PlexBindingReason };

/** Historical association plus exact committed physical quarantine, never a serving pointer. */
export async function readQuarantinedPlexWatchAuthority(
  tx: Prisma.TransactionClient,
  input: {
    decisionId: string;
    scope: PlexBindingScope;
    assetId: string;
    access: PlexAccess;
  },
  budget?: PublicationAuthorityReadBudget,
): Promise<QuarantinedPlexWatchRead> {
  try {
    return await resolveQuarantine(tx, input, budget);
  } catch (error) {
    if (error instanceof PlexBindingProtection)
      return { status: "protected", reason: error.reason };
    throw error;
  }
}

async function resolveQuarantine(
  tx: Prisma.TransactionClient,
  input: {
    decisionId: string;
    scope: PlexBindingScope;
    assetId: string;
    access: PlexAccess;
  },
  budget?: PublicationAuthorityReadBudget,
): Promise<Extract<QuarantinedPlexWatchRead, { status: "current" }>> {
  const decision = await tx.retentionDecision.findUniqueOrThrow({
    where: { id: input.decisionId },
    include: { plexProjection: true },
  });
  budget?.consume(1 + (decision.plexProjection === null ? 0 : 1));
  if (
    decision.state !== "quarantined" ||
    decision.mediaId !== input.scope.mediaId ||
    decision.edition !== input.scope.edition ||
    decision.plexProjection === null
  )
    throw new PlexBindingProtection("reconciliation_required");
  const operations = await tx.operation.findMany({
    where: {
      OR: [
        {
          kind: "retain_media",
          result: {
            path: ["quarantinePlexReceipt", "decisions"],
            array_contains: [{ decisionId: decision.id }],
          },
        },
        {
          kind: "retain_movie_edition_v4",
          result: {
            path: ["movieQuarantinePlexReceiptV2", "decisions"],
            array_contains: [{ decisionId: decision.id }],
          },
        },
      ],
    },
    take: 2,
  });
  budget?.consume(operations.length);
  const operation = operations[0];
  if (operation === undefined)
    throw new PlexBindingProtection("reconciliation_required");
  if (operations.length !== 1)
    throw new Error("Quarantine has ambiguous committed association receipts");
  if (operation.kind === "retain_movie_edition_v4")
    return readMovieQuarantinedPlexWatchAuthority(
      tx,
      { ...input, decision, operation },
      budget,
    );
  if (input.scope.edition !== "default")
    throw new PlexBindingProtection("reconciliation_required");
  const rawReceipt = z
    .object({ quarantinePlexReceipt: z.json() })
    .parse(operation.result).quarantinePlexReceipt;
  const receiptHash = identityHash(rawReceipt);
  const receipt = parsePlexRecord(
    CommittedQuarantinePlexReceiptSchema,
    rawReceipt,
    receiptHash,
  );
  assertQuarantineOperation(operation, receipt);
  const rawManifest = decision.manifest;
  const manifest = parsePlexRecord(
    RemovalPlanSchema,
    rawManifest,
    receipt.manifestHash,
  );
  const { selectedDecision, original, binding } =
    selectQuarantineReceiptParents(receipt, decision, input);
  assertQuarantineProjection(decision.plexProjection, {
    decisionId: decision.id,
    projectionHash: selectedDecision.projectionHash,
    receipt,
  });
  const associations = await readOriginalAssociations(tx, receipt, budget);
  const association = associations.get(binding.evidenceId);
  if (association?.group.assetId !== original.assetId)
    throw new Error("Quarantine original association is missing");
  const { asset, group } = await readPlexPhysicalGroup(tx, input.assetId);
  const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  if (
    asset.state !== "quarantined" ||
    !(await recordsAuthorized(tx, {
      epoch: runtime.recoveryEpoch,
      mediaIds: group.coverage.map((scope) => scope.mediaId),
      assetIds: [asset.id],
    }))
  )
    throw new PlexBindingProtection("ownership_changed");
  if (
    await tx.nativePublicationCompensationContinuation.count({
      where: {
        fenceRelease: { equals: Prisma.DbNull },
        OR: [
          { assetIds: { has: asset.id } },
          {
            mediaIds: { hasSome: group.coverage.map((scope) => scope.mediaId) },
          },
        ],
      },
    })
  )
    throw new PlexBindingProtection("compensation_fence_active");
  const nativeReceipts = await quarantinePlexRebindings(
    tx,
    { original, current: group, decisionId: decision.id },
    budget ?? new PublicationAuthorityReadBudget(),
  );
  await assertQuarantineIdentity(tx, association, input.access);
  const assets = receipt.groups.map((value) =>
    quarantineManifestAsset(manifest, value),
  );
  if (assets.length !== manifest.assets.length)
    throw new Error("Quarantine receipt omitted original manifest assets");
  const quarantine = QuarantinePlexRefSchema.parse({
    decisionId: decision.id,
    decisionVersion: decision.version,
    manifestHash: receipt.manifestHash,
    operationId: operation.id,
    operationResultHash: receiptHash,
    recoveryEpoch: runtime.recoveryEpoch,
    group,
    assets,
    nativeReceipts,
  });
  return {
    status: "current",
    authority: {
      purpose: "quarantined",
      binding,
      quarantine,
      quarantineHash: identityHash(quarantine),
    },
    association,
  };
}

function selectQuarantineReceiptParents(
  receipt: z.infer<typeof CommittedQuarantinePlexReceiptSchema>,
  decision: { id: string; mediaId: string; version: number },
  input: Pick<QuarantineWatchInput, "assetId" | "scope">,
) {
  const selectedDecision = receipt.decisions.find(
    (row) => row.decisionId === decision.id,
  );
  const original = receipt.groups.find(
    (group) => group.assetId === input.assetId,
  );
  const binding = receipt.bindings.find(
    (row) => plexScopeKey(row.scope) === plexScopeKey(input.scope),
  );
  if (
    selectedDecision === undefined ||
    original === undefined ||
    binding === undefined ||
    selectedDecision.mediaId !== decision.mediaId ||
    decision.version < selectedDecision.quarantinedVersion ||
    !original.coverage.some(
      (scope) => plexScopeKey(scope) === plexScopeKey(input.scope),
    )
  )
    throw new Error(
      "Quarantine receipt omitted its selected complete physical group",
    );
  return { selectedDecision, original, binding };
}

async function readOriginalAssociations(
  tx: Prisma.TransactionClient,
  receipt: z.infer<typeof CommittedQuarantinePlexReceiptSchema>,
  budget?: PublicationAuthorityReadBudget,
) {
  const rows = await tx.plexAssociationEvidence.findMany({
    where: { id: { in: receipt.bindings.map((row) => row.evidenceId) } },
  });
  budget?.consume(rows.length);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const associations = new Map<string, PlexAssociationV1>();
  const groups = new Map(
    receipt.groups.map((group) => [group.assetId, identityHash(group)]),
  );
  for (const binding of receipt.bindings) {
    const row = byId.get(binding.evidenceId);
    if (row?.associationHash !== binding.associationHash)
      throw new Error("Quarantine binding evidence is missing");
    const association = parsePlexRecord(
      PlexAssociationV1Schema,
      row.evidence,
      binding.associationHash,
    );
    if (
      identityHash(association.scope) !== identityHash(binding.scope) ||
      row.mediaId !== binding.scope.mediaId ||
      row.edition !== binding.scope.edition ||
      row.assetId !== association.group.assetId ||
      row.serverMachineId !== association.access.serverMachineId ||
      groups.get(row.assetId) !== identityHash(association.group)
    )
      throw new Error("Quarantine binding immutable parent changed");
    associations.set(row.id, association);
  }
  return associations;
}

async function assertQuarantineIdentity(
  tx: Prisma.TransactionClient,
  association: PlexAssociationV1,
  access: PlexAccess,
) {
  if (association.access.serverMachineId !== access.serverMachineId)
    throw new PlexBindingProtection("wrong_server");
  if (identityHash(association.access) !== identityHash(access))
    throw new PlexBindingProtection("wrong_section");
  const targets = await readPlexCanonicalTargets(tx, [association.scope]);
  const canonical = targets[0];
  if (
    canonical?.canonicalRootId !== association.editionRootId ||
    canonical.canonicalIdentityHash !== association.canonicalIdentityHash ||
    canonical.numberingHash !== association.numberingHash
  )
    throw new PlexBindingProtection("metadata_changed");
  const definition = await readPlexDefinition(
    tx,
    association.scope,
    association.editionRootId,
  );
  if (identityHash(definition) !== identityHash(association.definition))
    throw new PlexBindingProtection("binding_changed");
}

function quarantineManifestAsset(
  manifest: z.infer<typeof RemovalPlanSchema>,
  value: PlexPhysicalGroup,
) {
  const entry = manifest.assets.find((row) => row.assetId === value.assetId);
  if (
    entry?.assetVersion !== value.assetVersion ||
    entry.checksum !== value.checksum ||
    identityHash([...entry.mediaIds].sort()) !==
      identityHash(value.coverage.map((scope) => scope.mediaId))
  )
    throw new Error(
      "Quarantine manifest differs from the original committed group",
    );
  return {
    assetId: value.assetId,
    planAssetVersion: value.assetVersion,
    quarantinedAssetVersion: value.assetVersion + 1,
    checksum: value.checksum,
    coverageHash: value.coverageHash,
  };
}

function assertQuarantineProjection(
  record: { projection: unknown; projectionHash: string },
  expected: {
    decisionId: string;
    projectionHash: string;
    receipt: z.infer<typeof CommittedQuarantinePlexReceiptSchema>;
  },
) {
  const projection = parsePlexRecord(
    RetentionPlexProjectionV1Schema,
    record.projection,
    record.projectionHash,
  );
  if (
    record.projectionHash !== expected.projectionHash ||
    projection.decisionId !== expected.decisionId ||
    identityHash(projection.bindings) !==
      identityHash(expected.receipt.bindings) ||
    identityHash(projection.groupHashes) !==
      identityHash(
        expected.receipt.groups.map((group) => identityHash(group)).sort(),
      )
  )
    throw new Error("Quarantine original retention projection changed");
}
