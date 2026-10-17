import { NativeArchiveScopeProtection } from "./errors.ts";
import { z } from "zod";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeStoredScopeSchema,
  FinishedNativeV2Schema,
} from "#shared/native-recovery/lifecycle.ts";
import {
  PriorNativeBindingSchema,
  NativeArchiveSubtitleSnapshotSchema,
  type NativeArchiveFile,
  type PriorNativeBinding,
} from "#shared/native-recovery/archive.ts";
import { NativeRecoveryFileEvidenceSchema } from "#shared/native-recovery.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativePhysicalIdentity } from "./physical-identity.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import type { PublicationSubtitleLineage } from "#shared/publication-proof/subtitle-lineage.ts";
import { archivePublicationSnapshot } from "#infrastructure/publication-proof/projection.ts";
import { compensationSubtitleLineage } from "#infrastructure/native-compensation/subtitle-lineage.ts";
import { assertRecordedCaptionLineage } from "#infrastructure/publication-proof/caption-authority.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";

const Version = z.object({
  version: z.int(),
  ownershipEpoch: z.int(),
  videoVersion: z.int(),
});
const Binding = z.object({
  assetId: z.uuid(),
  beforeVersion: z.int(),
  assetVersion: z.int(),
  checksum: z.string(),
  mediaIds: z.array(z.uuid()),
  ownershipEpoch: z.int(),
  subtitles: z.array(
    z.object({
      id: z.uuid(),
      before: Version,
      after: Version,
      qualityStatus: z.string(),
    }),
  ),
  physicalIdentityHash: z.string().optional(),
});
const Selection = z.object({
  scope: z.json(),
  fileEvidence: z.object({ files: z.array(z.json()) }).catchall(z.json()),
  networkEvidence: z.json(),
  bindings: z.array(z.json()),
});
const Finished = z.union([
  z.strictObject({
    schemaVersion: z.literal(1),
    scopeHash: z.string(),
    network: z.json(),
    files: z.json(),
  }),
  FinishedNativeV2Schema,
]);
type Receipt = Prisma.NativeRecoveryReceiptGetPayload<{
  include: { plan: true };
}>;

function grant(
  row: Receipt,
  file: NativeArchiveFile,
  lineage?: PublicationSubtitleLineage,
) {
  const scope = NativeStoredScopeSchema.parse(row.plan.scope);
  if (
    scope.schemaVersion === 2 &&
    scope.lifecycleKind === "committed_quarantine"
  )
    return null;
  const selection = Selection.parse(row.selection);
  const bindings = selection.bindings.filter(
    (raw) => Binding.parse(raw).assetId === file.assetId,
  );
  const raw = bindings[0];
  if (raw === undefined) return null;
  if (bindings.length !== 1)
    throw new NativeArchiveScopeProtection("Archive prior grant is ambiguous");
  const binding = Binding.parse(raw);
  if (
    binding.assetVersion !== file.assetVersion ||
    binding.ownershipEpoch !== file.ownershipEpoch
  )
    return null;
  assertReceipt(row, file, selection);
  const snapshots = scope.files.filter((item) => item.assetId === file.assetId);
  const before = snapshots[0];
  if (
    before === undefined ||
    snapshots.length !== 1 ||
    binding.beforeVersion !== before.assetVersion ||
    binding.assetVersion !== before.assetVersion + 1 ||
    before.ownershipEpoch >= binding.ownershipEpoch ||
    binding.checksum !== file.checksum ||
    snapshotHash([...binding.mediaIds].sort()) !==
      snapshotHash([...file.mediaIds].sort())
  )
    throw new NativeArchiveScopeProtection(
      "Archive prior grant does not bind current file",
    );
  const subtitles = boundSubtitles(before, binding);
  if (lineage === undefined) {
    if (
      snapshotHash(nativeJson(subtitles)) !==
      snapshotHash(nativeJson(file.subtitles))
    )
      throw new NativeArchiveScopeProtection(
        "Archive prior subtitle association changed",
      );
  } else assertRecordedCaptionLineage(lineage, subtitles, file.subtitles);
  assertPhysicalSnapshot(before, binding, file);
  assertLifecycle(scope, file);
  const evidence = selection.fileEvidence.files.filter(
    (item) =>
      NativeRecoveryFileEvidenceSchema.shape.files.element.parse(item)
        .assetId === file.assetId,
  );
  if (evidence.length !== 1)
    throw new NativeArchiveScopeProtection(
      "Archive prior physical evidence missing",
    );
  const physicalEvidenceHash = snapshotHash(
    nativePhysicalIdentity(evidence[0]),
  );
  assertPhysicalGrant(scope, binding, physicalEvidenceHash);
  return {
    reference: PriorNativeBindingSchema.parse({
      kind: "prior_native_binding",
      receiptLifecycle:
        scope.schemaVersion === 2 ? scope.lifecycleKind : "published",
      receiptId: row.id,
      planHash: row.planHash,
      assetId: file.assetId,
      bindingHash: snapshotHash(raw),
      physicalEvidenceHash,
      ...(lineage === undefined ? {} : { subtitleLineage: lineage }),
    }),
    binding,
  };
}

export async function findPriorNativeBinding(
  tx: Prisma.TransactionClient,
  file: NativeArchiveFile,
  currentEpoch: number,
  budget?: PublicationAuthorityReadBudget,
): Promise<PriorNativeBinding | null> {
  if (file.ownershipEpoch !== currentEpoch)
    throw new NativeArchiveScopeProtection(
      "Archive reuse requires exact current epoch",
    );
  const rows = await tx.nativeRecoveryReceipt.findMany({
    where: {
      recoveryEpoch: currentEpoch,
      selection: {
        path: ["bindings"],
        array_contains: [{ assetId: file.assetId }],
      },
    },
    include: { plan: true },
    orderBy: { createdAt: "desc" },
    take: budget?.take ?? 101,
  });
  budget?.consume(rows.length);
  if (rows.length > 100)
    throw new NativeArchiveScopeProtection(
      "Archive prior receipt lookup exceeds bound",
    );
  const matches = [];
  for (const row of rows) {
    const match = await currentGrant(tx, { row, file }, budget);
    if (match !== null) matches.push(match);
  }
  const match = matches[0];
  if (matches.length === 0) return null;
  if (match === undefined || matches.length !== 1)
    throw new NativeArchiveScopeProtection(
      "Current archive participant needs an unchanged prior native grant; transition reconciliation required",
    );
  return match.reference;
}
export async function resolvePriorNativeBinding(
  tx: Prisma.TransactionClient,
  file: NativeArchiveFile,
  currentEpoch: number,
  budget?: PublicationAuthorityReadBudget,
): Promise<PriorNativeBinding> {
  const reference = await findPriorNativeBinding(
    tx,
    file,
    currentEpoch,
    budget,
  );
  if (reference === null)
    throw new NativeArchiveScopeProtection(
      "Current archive participant needs an unchanged prior native grant; transition reconciliation required",
    );
  return reference;
}
export async function assertPriorNativeBinding(
  tx: Prisma.TransactionClient,
  file: NativeArchiveFile,
  reference: PriorNativeBinding,
  budget?: PublicationAuthorityReadBudget,
) {
  budget?.consume(1);
  const row = await tx.nativeRecoveryReceipt.findUniqueOrThrow({
    where: { id: reference.receiptId },
    include: { plan: true },
  });
  const result = grant(row, file, reference.subtitleLineage);
  if (
    result === null ||
    snapshotHash(nativeJson(result.reference)) !==
      snapshotHash(nativeJson(reference))
  )
    throw new NativeArchiveScopeProtection(
      "Archive prior binding reference changed",
    );
  return result.binding;
}

export async function priorNativeFileEvidence(
  tx: Prisma.TransactionClient,
  file: NativeArchiveFile,
  reference: PriorNativeBinding,
  budget?: PublicationAuthorityReadBudget,
) {
  await assertPriorNativeBinding(tx, file, reference, budget);
  budget?.consume(1);
  const row = await tx.nativeRecoveryReceipt.findUniqueOrThrow({
    where: { id: reference.receiptId },
  });
  const matches = Selection.parse(row.selection)
    .fileEvidence.files.map((raw) =>
      NativeRecoveryFileEvidenceSchema.shape.files.element.parse(raw),
    )
    .filter((item) => item.assetId === file.assetId);
  const evidence = matches[0];
  if (
    evidence === undefined ||
    matches.length !== 1 ||
    snapshotHash(nativePhysicalIdentity(evidence)) !==
      reference.physicalEvidenceHash
  )
    throw new Error("Native original physical evidence changed");
  return evidence;
}

function assertReceipt(
  row: Receipt,
  file: NativeArchiveFile,
  selection: z.infer<typeof Selection>,
) {
  const finished = Finished.parse(row.plan.plan);
  if (
    row.plan.state !== "applied" ||
    row.plan.planHash !== row.planHash ||
    row.plan.recoveryEpoch !== row.recoveryEpoch ||
    row.recoveryEpoch !== file.ownershipEpoch ||
    snapshotHash(z.json().parse(row.plan.plan)) !== row.planHash ||
    snapshotHash(z.json().parse(row.plan.scope)) !== finished.scopeHash ||
    snapshotHash(selection.scope) !== finished.scopeHash ||
    snapshotHash(z.json().parse(selection.fileEvidence)) !==
      snapshotHash(finished.files) ||
    snapshotHash(selection.networkEvidence) !== snapshotHash(finished.network)
  )
    throw new NativeArchiveScopeProtection(
      "Archive prior receipt authority changed",
    );
}

function boundSubtitles(
  before:
    | NativeArchiveFile
    | z.infer<typeof NativeStoredScopeSchema>["files"][number],
  binding: z.infer<typeof Binding>,
) {
  const subtitles = before.subtitles.map((subtitle) => {
    const matches = binding.subtitles.filter((item) => item.id === subtitle.id);
    const change = matches[0];
    if (
      change === undefined ||
      matches.length !== 1 ||
      change.qualityStatus !== subtitle.qualityStatus ||
      snapshotHash(change.before) !==
        snapshotHash({
          version: subtitle.version,
          ownershipEpoch: subtitle.ownershipEpoch,
          videoVersion: subtitle.videoVersion,
        }) ||
      snapshotHash(change.after) !==
        snapshotHash({
          version: subtitle.version + 1,
          ownershipEpoch: binding.ownershipEpoch,
          videoVersion: binding.assetVersion,
        })
    )
      throw new NativeArchiveScopeProtection(
        "Archive prior subtitle transition changed",
      );
    return NativeArchiveSubtitleSnapshotSchema.parse({
      ...subtitle,
      ...change.after,
    });
  });
  if (binding.subtitles.length !== subtitles.length)
    throw new NativeArchiveScopeProtection(
      "Archive prior subtitle association changed",
    );
  return subtitles;
}

function assertPhysicalSnapshot(
  before: z.infer<typeof NativeStoredScopeSchema>["files"][number],
  binding: z.infer<typeof Binding>,
  file: NativeArchiveFile,
) {
  const expected = {
    assetId: before.assetId,
    assetVersion: binding.assetVersion,
    canonicalPath: before.canonicalPath,
    libraryKind: before.libraryKind,
    checksum: before.checksum,
    sizeBytes: before.sizeBytes,
    ownershipEpoch: binding.ownershipEpoch,
    properties: before.properties,
    mediaIds: before.mediaIds,
  };
  const actual = {
    assetId: file.assetId,
    assetVersion: file.assetVersion,
    canonicalPath: file.canonicalPath,
    libraryKind: file.libraryKind,
    checksum: file.checksum,
    sizeBytes: file.sizeBytes,
    ownershipEpoch: file.ownershipEpoch,
    properties: file.properties,
    mediaIds: file.mediaIds,
  };
  if (snapshotHash(expected) !== snapshotHash(actual))
    throw new NativeArchiveScopeProtection(
      "Archive prior physical snapshot changed",
    );
}

function assertLifecycle(
  scope: z.infer<typeof NativeStoredScopeSchema>,
  file: NativeArchiveFile,
) {
  if (
    scope.schemaVersion === 2 &&
    scope.lifecycleKind === "superseded_archive"
  ) {
    const previous = scope.files.find((item) => item.assetId === file.assetId);
    if (
      previous === undefined ||
      snapshotHash({
        state: previous.state,
        edition: previous.edition,
        editionRootId: previous.editionRootId,
        sourcePath: previous.sourcePath,
        supersededByAssetId: previous.supersededByAssetId,
        plexPublishedAt: previous.plexPublishedAt,
        rollbackExpiresAt: previous.rollbackExpiresAt,
        coverage: previous.coverage,
      }) !==
        snapshotHash({
          state: file.state,
          edition: file.edition,
          editionRootId: file.editionRootId,
          sourcePath: file.sourcePath,
          supersededByAssetId: file.supersededByAssetId,
          plexPublishedAt: file.plexPublishedAt,
          rollbackExpiresAt: file.rollbackExpiresAt,
          coverage: file.coverage,
        })
    )
      throw new NativeArchiveScopeProtection(
        "Archive prior lifecycle association changed",
      );
  } else if (
    file.state !== "published" ||
    file.role !== "current_playback" ||
    file.coverage.some((item) => !item.current)
  )
    throw new NativeArchiveScopeProtection(
      "Published receipt cannot grant a later archive transition",
    );
}

function assertPhysicalGrant(
  scope: z.infer<typeof NativeStoredScopeSchema>,
  binding: z.infer<typeof Binding>,
  physicalEvidenceHash: string,
) {
  if (
    scope.schemaVersion === 2 &&
    scope.lifecycleKind === "superseded_archive" &&
    binding.physicalIdentityHash !== physicalEvidenceHash
  )
    throw new NativeArchiveScopeProtection(
      "Archive physical grant hash changed",
    );
}

async function currentGrant(
  tx: Prisma.TransactionClient,
  input: { row: Receipt; file: NativeArchiveFile },
  budget?: PublicationAuthorityReadBudget,
) {
  const { row, file } = input;
  const scope = NativeStoredScopeSchema.parse(row.plan.scope);
  if (
    scope.schemaVersion === 2 &&
    scope.lifecycleKind === "committed_quarantine"
  )
    return null;
  const selection = Selection.parse(row.selection);
  const bindings = selection.bindings
    .map((raw) => Binding.parse(raw))
    .filter(
      (item) =>
        item.assetId === file.assetId &&
        item.assetVersion === file.assetVersion &&
        item.ownershipEpoch === file.ownershipEpoch,
    );
  const binding = bindings[0];
  if (binding === undefined) return null;
  if (bindings.length !== 1)
    throw new Error("Native prior caption binding is ambiguous");
  const before = scope.files.find((item) => item.assetId === file.assetId);
  if (before === undefined)
    throw new Error("Native prior caption snapshot missing");
  const baseline = { ...file, subtitles: boundSubtitles(before, binding) };
  const original = grant(row, baseline);
  if (original === null)
    throw new Error("Native prior caption baseline changed");
  let lineage: PublicationSubtitleLineage | undefined;
  if (
    snapshotHash(nativeJson(baseline.subtitles)) !==
    snapshotHash(nativeJson(file.subtitles))
  ) {
    const resolved = await compensationSubtitleLineage(
      tx,
      {
        baseline: archivePublicationSnapshot(baseline),
        current: archivePublicationSnapshot(file),
        libraryKind: file.libraryKind,
      },
      budget,
    );
    lineage = resolved.lineage;
  }
  return {
    ...original,
    reference: PriorNativeBindingSchema.parse({
      ...original.reference,
      ...(lineage === undefined ? {} : { subtitleLineage: lineage }),
    }),
  };
}
