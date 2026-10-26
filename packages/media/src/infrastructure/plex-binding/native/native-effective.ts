import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeArchiveContinuationSchema,
  type NativeArchiveScope,
} from "#shared/native-recovery/archive.ts";
import {
  NativeCompensationDescriptorSchema,
  type NativeCompensationScope,
} from "#shared/native-recovery/compensation.ts";
import { NativeCompensationSelectionSchema } from "#shared/native-recovery/compensation-runtime.ts";
import type { NativeCatalogScopeSnapshot } from "#shared/plex-binding/native-scope.ts";
import type { NativePlexProofParent } from "#shared/plex-binding/native.ts";
import { identityHash } from "#infrastructure/acquisition-identity/snapshot.ts";
import { NativeHouseholdSchema } from "#infrastructure/native-recovery/snapshots.ts";
import { effectiveGrant } from "#infrastructure/native-archive/physical-identity.ts";
import { assertArchiveImmutableCompletion } from "#infrastructure/native-archive/completion.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

type Receipt = Prisma.NativeRecoveryReceiptGetPayload<{
  include: { plan: true };
}>;
type Continuation = {
  id: string;
  descriptor: unknown;
  descriptorHash: string;
  receiptId: string;
  recoveryEpoch: number;
};
type NativeEffectiveInput = {
  parent: Extract<NativePlexProofParent, { purpose: "native_execution" }>;
  receipt: Receipt;
  continuation: Continuation;
  effectiveScope: NativeCatalogScopeSnapshot;
  validateReceipt: (receipt: Receipt) => Promise<void>;
};

/** The effective snapshot is immutable evidence; only exact descriptor-authorized differences are permitted. */
export async function assertNativeEffectiveScope(
  tx: Prisma.TransactionClient,
  input: NativeEffectiveInput,
  budget: PublicationAuthorityReadBudget,
) {
  const { effectiveScope: scope, parent, receipt, continuation } = input;
  if (scope.schemaVersion !== 2 || scope.lifecycleKind !== parent.lifecycleKind)
    throw new Error("Native effective lifecycle changed");
  if (scope.lifecycleKind === "publication_compensation") {
    assertCompensationEffective(scope, receipt, continuation);
    return;
  }
  await assertArchiveEffectiveScope(tx, input, budget);
}

async function assertArchiveEffectiveScope(
  tx: Prisma.TransactionClient,
  input: NativeEffectiveInput,
  budget: PublicationAuthorityReadBudget,
) {
  const { effectiveScope: scope, parent, receipt, continuation } = input;
  if (scope.schemaVersion !== 2 || scope.lifecycleKind !== "superseded_archive")
    throw new Error("Native execution lifecycle unsupported");
  const descriptor = NativeArchiveContinuationSchema.parse(
    continuation.descriptor,
  );
  const selection = z
    .object({ scope: z.json(), bindings: z.json(), reusedBindings: z.json() })
    .parse(receipt.selection);
  if (
    identityHash(selection.scope) !== parent.scopeHash ||
    identityHash(descriptor.scope) !== parent.scopeHash ||
    identityHash(selection.bindings) !== identityHash(descriptor.bindings) ||
    identityHash(selection.reusedBindings) !==
      identityHash(descriptor.reusedBindings)
  )
    throw new Error("Native archive effective grant selection changed");
  const { files, terminalDependencies, ...fixed } = scope;
  const {
    files: originalFiles,
    terminalDependencies: originalTerminal,
    ...originalFixed
  } = descriptor.scope;
  if (
    identityHash(fixed) !== identityHash(originalFixed) ||
    identityHash(terminalDependencies.slice(0, originalTerminal.length)) !==
      identityHash(originalTerminal)
  )
    throw new Error("Native archive effective scope changed immutable fields");
  const added = terminalDependencies.slice(originalTerminal.length);
  const removed = originalFiles.filter(
    (file) => !files.some((current) => current.assetId === file.assetId),
  );
  if (
    files.length + removed.length !== originalFiles.length ||
    added.length !== removed.length ||
    new Set(files.map((file) => file.assetId)).size !== files.length
  )
    throw new Error("Native archive effective scope changed group closure");
  for (const current of files) {
    const original = originalFiles.find(
      (file) => file.assetId === current.assetId,
    );
    if (original === undefined)
      throw new Error("Native effective scope added an unreviewed group");
    const grant = effectiveGrant(receipt, descriptor, original);
    if (
      identityHash(current) !==
      identityHash({ ...grant.current, authority: grant.reference })
    )
      throw new Error("Native archive effective physical binding changed");
  }
  for (const original of removed) {
    const { edge, dependency } = reviewedRemovedGroup(
      original,
      descriptor.scope,
      added,
    );
    if (dependency.kind === "archive_completion") {
      await assertArchiveTerminalCompletion(
        tx,
        { dependency, original },
        input,
        budget,
      );
    } else assertLegacyTerminalJournals(dependency, edge);
  }
}

function reviewedRemovedGroup(
  original: NativeArchiveScope["files"][number],
  scope: NativeArchiveScope,
  added: NativeArchiveScope["terminalDependencies"],
) {
  const edge = scope.edges.find((value) => value.assetId === original.assetId);
  const terminal = added.filter(
    (value) => value.dependency.cleanupId === edge?.id,
  );
  const dependency = terminal[0];
  if (
    edge === undefined ||
    dependency === undefined ||
    original.role === "current_playback" ||
    terminal.length !== 1 ||
    identityHash(dependency.dependency.assetIds) !==
      identityHash([edge.assetId, edge.successorAssetId]) ||
    dependency.dependency.birthEpoch !== edge.recoveryEpoch ||
    identityHash(
      dependency.dependency.files.map((file) => file.canonicalPath).sort(),
    ) !==
      identityHash(edge.derivedPlan.files.map((file) => file.path).sort()) ||
    dependency.dependency.files.some((file) => file.expectedChecksum !== null)
  )
    throw new Error("Native effective terminal group changed");
  return { edge, dependency };
}

async function assertArchiveTerminalCompletion(
  tx: Prisma.TransactionClient,
  input: {
    dependency: Extract<
      NativeArchiveScope["terminalDependencies"][number],
      { kind: "archive_completion" }
    >;
    original: NativeArchiveScope["files"][number];
  },
  authority: Pick<NativeEffectiveInput, "validateReceipt">,
  budget: PublicationAuthorityReadBudget,
) {
  const { dependency, original } = input;
  const row = await tx.nativeArchiveCleanupContinuation.findUniqueOrThrow({
    where: { id: dependency.continuationId },
    include: { receipt: { include: { plan: true } } },
  });
  budget.consume(3);
  if (
    row.receiptId !== dependency.receiptId ||
    row.originalCleanupId !== dependency.originalCleanupId ||
    row.descriptorHash !== dependency.descriptorHash ||
    identityHash(row.completion) !== dependency.completionHash
  )
    throw new Error("Native effective terminal receipt reference changed");
  const verified = assertArchiveImmutableCompletion(row);
  if (
    verified.proof.asset.assetId !== original.assetId ||
    identityHash(
      verified.proof.absences.map((value) => value.canonicalPath).sort(),
    ) !==
      identityHash(
        dependency.dependency.files.map((value) => value.canonicalPath).sort(),
      ) ||
    identityHash(
      verified.proof.journals.map(
        ({ phase: _phase, manifestHash: _hash, ...journal }) => journal,
      ),
    ) !== identityHash(dependency.dependency.journals)
  )
    throw new Error("Native effective terminal completion projection changed");
  await authority.validateReceipt(row.receipt);
}

function sortedJournals<T extends { operationId: string }>(values: T[]) {
  return values.toSorted((a, b) => a.operationId.localeCompare(b.operationId));
}

function assertLegacyTerminalJournals(
  terminal: NativeArchiveScope["terminalDependencies"][number],
  edge: NativeArchiveScope["edges"][number],
) {
  const expected = edge.derivedPlan.files.map((file) => ({
    operationId: `upgrade-purge-${edge.id}-${file.id}`,
    kind: "purge",
    source: file.path,
    target: file.path,
    sha256: file.checksum,
    previousSha256: null,
  }));
  if (
    identityHash(sortedJournals(terminal.dependency.journals)) !==
    identityHash(sortedJournals(expected))
  )
    throw new Error("Native effective legacy purge journal changed");
}

function assertCompensationEffective(
  scope: NativeCompensationScope,
  receipt: Receipt,
  continuation: Continuation,
) {
  const descriptor = NativeCompensationDescriptorSchema.parse(
    continuation.descriptor,
  );
  const selected = z
    .object({
      compensationAuthorization:
        NativeCompensationSelectionSchema.shape.compensationAuthorization,
      scope: z.json(),
    })
    .parse(receipt.selection);
  if (
    identityHash(selected.scope) !== identityHash(descriptor.scope) ||
    selected.compensationAuthorization.continuationId !== continuation.id ||
    selected.compensationAuthorization.descriptorHash !==
      continuation.descriptorHash
  )
    throw new Error("Native compensation effective receipt changed");
  const { household, ...fixed } = scope,
    { household: oldHousehold, ...oldFixed } = descriptor.scope;
  if (identityHash(fixed) !== identityHash(oldFixed))
    throw new Error("Native compensation effective scope changed");
  const current = NativeHouseholdSchema.parse(household),
    previous = NativeHouseholdSchema.parse(oldHousehold);
  for (const key of ["requests", "coverage", "personalHolds"] as const)
    if (identityHash(current[key]) !== identityHash(previous[key]))
      throw new Error("Native compensation effective household changed");
  const holds = selected.compensationAuthorization.recoveryHoldBindings;
  if (
    current.recoveryHolds.length !== holds.length ||
    new Set(current.recoveryHolds.map((hold) => hold.mediaId)).size !==
      holds.length ||
    current.recoveryHolds.some(
      (hold) =>
        hold["releasedAt"] !== null ||
        !holds.some(
          (binding) =>
            binding.mediaId === hold.mediaId &&
            binding.version === hold.version &&
            binding.recoveryEpoch === hold.recoveryEpoch,
        ),
    )
  )
    throw new Error("Native compensation effective hold binding changed");
}
