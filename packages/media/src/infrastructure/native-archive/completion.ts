import { z } from "zod";
import { createHash } from "node:crypto";
import type { Prisma } from "#generated/prisma/client.ts";
import {
  NativeArchiveCompletionSchema,
  NativeArchiveContinuationSchema,
  NativeArchiveTerminalDependencySchema,
  NativeArchiveExecutionSchema,
} from "#shared/native-recovery/archive.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import type { archiveClosure } from "./closure.ts";
import { stableArchiveFiles } from "./plan.ts";
type Asset = Awaited<ReturnType<typeof archiveClosure>>["assets"][number];
type Completion = z.infer<typeof NativeArchiveCompletionSchema>;
type Descriptor = z.infer<typeof NativeArchiveContinuationSchema>;
type OriginalFile = Descriptor["scope"]["files"][number];
type ArchiveEdge = Descriptor["scope"]["edges"][number];
type Binding = Descriptor["bindings"][number];
type CompletionRow = Prisma.NativeArchiveCleanupContinuationGetPayload<{
  include: { receipt: { include: { plan: true } } };
}>;
/** Historical completion closure, without consulting current asset versions or ownership. */
export function assertArchiveImmutableCompletion(
  row: Prisma.NativeArchiveCleanupContinuationGetPayload<{
    include: { receipt: { include: { plan: true } } };
  }>,
) {
  if (snapshotHash(z.json().parse(row.descriptor)) !== row.descriptorHash)
    throw new Error("Archive immutable descriptor changed");
  const descriptor = NativeArchiveContinuationSchema.parse(row.descriptor);
  const proof = NativeArchiveCompletionSchema.parse(row.completion);
  const originalFile = descriptor.scope.files.find(
    (file) => file.assetId === proof.asset.assetId,
  );
  const selectedEdge = descriptor.scope.edges.find(
    (value) => value.id === descriptor.selectedCleanupId && value.selected,
  );
  const binding = descriptor.bindings.find(
    (value) => value.assetId === proof.asset.assetId,
  );
  const execution = NativeArchiveExecutionSchema.parse(row.executionEvidence);
  const { before, edge } = immutableCompletionSelection(
    originalFile,
    selectedEdge,
  );
  assertImmutableCompletionRow(row, proof, edge);
  assertImmutableCompletionAsset(proof, before, binding, edge);
  if (
    snapshotHash(
      execution.participants.map((value) => value.canonicalPath).sort(),
    ) !== snapshotHash(edge.derivedPlan.files.map((value) => value.path).sort())
  )
    throw new Error("Archive immutable execution participant closure changed");
  assertImmutableSubtitleTransitions(proof, before, binding);
  for (const file of edge.derivedPlan.files)
    if (
      proof.absences.filter((value) => value.canonicalPath === file.path)
        .length !== 1 ||
      proof.journals.filter(
        (value) =>
          value.source === file.path &&
          value.target === file.path &&
          value.sha256 === file.checksum,
      ).length !== 1
    )
      throw new Error("Archive immutable completion omitted participant");
  assertCompletionReceipt(row, descriptor);
  assertCompletedExecution(row, proof, descriptor);
  return { descriptor, proof };
}

function immutableCompletionSelection(
  before: OriginalFile | undefined,
  edge: ArchiveEdge | undefined,
) {
  if (before?.role !== "selected_archive" || edge?.assetId !== before.assetId)
    throw new Error("Archive immutable completion binding changed");
  return { before, edge };
}

function assertImmutableCompletionRow(
  row: CompletionRow,
  proof: Completion,
  edge: ArchiveEdge,
) {
  if (
    row.receiptId !== row.receipt.id ||
    row.receipt.planId !== row.receipt.plan.id ||
    row.receipt.actorId !== row.receipt.plan.actorId ||
    row.state !== "cleaned" ||
    row.originalCleanupId !== edge.id ||
    proof.originalCleanupId !== edge.id ||
    proof.continuationId !== row.id ||
    proof.receiptId !== row.receiptId ||
    proof.descriptorHash !== row.descriptorHash ||
    proof.recoveryEpoch !== row.recoveryEpoch
  )
    throw new Error("Archive immutable completion binding changed");
}

function assertImmutableCompletionAsset(
  proof: Completion,
  before: OriginalFile,
  binding: Binding | undefined,
  edge: ArchiveEdge,
) {
  if (
    proof.asset.beforeVersion !==
      (binding?.assetVersion ?? before.assetVersion) ||
    proof.asset.assetVersion !== proof.asset.beforeVersion + 1 ||
    proof.asset.checksum !== before.checksum ||
    proof.asset.ownershipEpoch !==
      (binding?.ownershipEpoch ?? before.ownershipEpoch) ||
    snapshotHash(proof.asset.mediaIds.toSorted()) !==
      snapshotHash(before.mediaIds.toSorted()) ||
    proof.subtitles.length !== before.subtitles.length ||
    proof.absences.length !== edge.derivedPlan.files.length ||
    proof.journals.length !== edge.derivedPlan.files.length
  )
    throw new Error("Archive immutable completion binding changed");
}

function assertImmutableSubtitleTransitions(
  proof: Completion,
  before: OriginalFile,
  binding: Binding | undefined,
) {
  for (const subtitle of before.subtitles) {
    const expected = binding?.subtitles.find(
      (value) => value.id === subtitle.id,
    )?.after ?? {
      version: subtitle.version,
      ownershipEpoch: subtitle.ownershipEpoch,
      videoVersion: subtitle.videoVersion,
    };
    const changes = proof.subtitles.filter((value) => value.id === subtitle.id);
    const change = changes[0];
    if (
      change === undefined ||
      changes.length !== 1 ||
      snapshotHash(change.before) !== snapshotHash(expected) ||
      snapshotHash(change.after) !==
        snapshotHash({
          version: expected.version + 1,
          ownershipEpoch: expected.ownershipEpoch,
          videoVersion: proof.asset.assetVersion,
        }) ||
      change.checksum !== subtitle.checksum ||
      change.qualityStatus !== subtitle.qualityStatus
    )
      throw new Error("Archive immutable subtitle transition changed");
  }
}

export function archiveCompletionDependency(
  row: Prisma.NativeArchiveCleanupContinuationGetPayload<{
    include: { receipt: { include: { plan: true } } };
  }>,
  cleanup: Prisma.UpgradeCleanupGetPayload<object>,
  old: Asset,
  successor: Asset,
) {
  const proof = NativeArchiveCompletionSchema.parse(row.completion);
  const descriptor = NativeArchiveContinuationSchema.parse(row.descriptor);
  assertCompletionRows(row, cleanup, old, { proof, descriptor });
  const dependency = {
    cleanupId: cleanup.id,
    kind: "purged",
    birthEpoch: cleanup.recoveryEpoch,
    assetIds: [old.id, successor.id],
    rowDigest: snapshotHash(
      nativeJson({
        cleanup,
        old: { ...old, sizeBytes: old.sizeBytes.toString() },
        completion: proof,
      }),
    ),
    files: proof.absences.map((item) => ({
      canonicalPath: item.canonicalPath,
      expectedChecksum: null,
    })),
    journals: proof.journals.map(
      ({ phase: _phase, manifestHash: _hash, ...journal }) => journal,
    ),
  };
  return NativeArchiveTerminalDependencySchema.parse({
    kind: "archive_completion",
    continuationId: row.id,
    receiptId: row.receiptId,
    originalCleanupId: cleanup.id,
    descriptorHash: row.descriptorHash,
    completionHash: snapshotHash(z.json().parse(row.completion)),
    dependency,
  });
}

function assertCompletionRows(
  row: Prisma.NativeArchiveCleanupContinuationGetPayload<{
    include: { receipt: { include: { plan: true } } };
  }>,
  cleanup: Prisma.UpgradeCleanupGetPayload<object>,
  old: Asset,
  evidence: {
    proof: z.infer<typeof NativeArchiveCompletionSchema>;
    descriptor: z.infer<typeof NativeArchiveContinuationSchema>;
  },
) {
  const { proof, descriptor } = evidence;
  const edge = descriptor.scope.edges.find(
    (item) => item.id === cleanup.id && item.selected,
  );
  if (
    edge === undefined ||
    proof.continuationId !== row.id ||
    proof.receiptId !== row.receiptId ||
    proof.originalCleanupId !== cleanup.id ||
    proof.descriptorHash !== row.descriptorHash ||
    snapshotHash(z.json().parse(row.descriptor)) !== row.descriptorHash ||
    proof.recoveryEpoch !== row.recoveryEpoch ||
    proof.asset.assetId !== old.id ||
    proof.asset.assetVersion !== proof.asset.beforeVersion + 1 ||
    proof.asset.checksum !== old.checksum ||
    proof.asset.ownershipEpoch !== old.ownershipEpoch ||
    snapshotHash([...proof.asset.mediaIds].sort()) !==
      snapshotHash(old.coverage.map((item) => item.mediaId).sort()) ||
    proof.absences.length !== edge.derivedPlan.files.length ||
    proof.journals.length !== edge.derivedPlan.files.length
  )
    throw new Error("Archive completion binding changed");
  for (const file of edge.derivedPlan.files) {
    if (
      !proof.absences.some((item) => item.canonicalPath === file.path) ||
      proof.journals.filter(
        (item) =>
          item.source === file.path &&
          item.target === file.path &&
          item.sha256 === file.checksum,
      ).length !== 1
    )
      throw new Error("Archive completion omitted physical participant");
  }

  assertCompletionReceipt(row, descriptor);
  assertCompletedExecution(row, proof, descriptor);
  assertPurgedSubtitles(old, proof, descriptor);
}
function assertCompletionReceipt(
  row: Prisma.NativeArchiveCleanupContinuationGetPayload<{
    include: { receipt: { include: { plan: true } } };
  }>,
  descriptor: z.infer<typeof NativeArchiveContinuationSchema>,
) {
  const receipt = row.receipt;
  const selected = z
    .object({
      scope: z.json(),
      fileEvidence: z.json(),
      bindings: z.json(),
      reusedBindings: z.json(),
    })
    .parse(receipt.selection);
  const plan = z
    .object({ scopeHash: z.string(), files: z.json() })
    .parse(receipt.plan.plan);
  if (
    receipt.plan.state !== "applied" ||
    receipt.recoveryEpoch !== row.recoveryEpoch ||
    receipt.plan.recoveryEpoch !== row.recoveryEpoch ||
    descriptor.scope.request.recoveryEpoch !== row.recoveryEpoch ||
    receipt.planHash !== receipt.plan.planHash ||
    snapshotHash(z.json().parse(receipt.plan.plan)) !== receipt.planHash ||
    snapshotHash(z.json().parse(receipt.plan.scope)) !== plan.scopeHash ||
    snapshotHash(selected.scope) !== plan.scopeHash ||
    snapshotHash(selected.scope) !==
      snapshotHash(z.json().parse(descriptor.scope)) ||
    snapshotHash(selected.bindings) !== snapshotHash(descriptor.bindings) ||
    snapshotHash(nativeJson(selected.reusedBindings)) !==
      snapshotHash(nativeJson(descriptor.reusedBindings)) ||
    snapshotHash(selected.fileEvidence) !== snapshotHash(plan.files) ||
    snapshotHash(nativeJson(stableArchiveFiles(descriptor.fileEvidence))) !==
      snapshotHash(selected.fileEvidence)
  )
    throw new Error("Archive terminal parent receipt changed");
}
function assertPurgedSubtitles(
  old: Asset,
  proof: z.infer<typeof NativeArchiveCompletionSchema>,
  descriptor: z.infer<typeof NativeArchiveContinuationSchema>,
) {
  const before = descriptor.scope.files.find((file) => file.assetId === old.id);
  if (before?.role !== "selected_archive")
    throw new Error("Archive completion selection changed");
  const grant = descriptor.bindings.find((item) => item.assetId === old.id);
  if (
    proof.asset.beforeVersion !==
      (grant?.assetVersion ?? before.assetVersion) ||
    proof.subtitles.length !== before.subtitles.length ||
    proof.subtitles.length !== old.subtitles.length
  )
    throw new Error("Archive completion version or subtitle coverage changed");
  for (const subtitle of before.subtitles) {
    const binding = grant?.subtitles.find((item) => item.id === subtitle.id);
    const expectedBefore = binding?.after ?? {
      version: subtitle.version,
      ownershipEpoch: subtitle.ownershipEpoch,
      videoVersion: subtitle.videoVersion,
    };
    const change = proof.subtitles.find((item) => item.id === subtitle.id);
    const actual = old.subtitles.find((item) => item.id === subtitle.id);
    if (
      change === undefined ||
      actual === undefined ||
      snapshotHash(change.before) !== snapshotHash(expectedBefore) ||
      snapshotHash(change.after) !==
        snapshotHash({
          version: expectedBefore.version + 1,
          ownershipEpoch: expectedBefore.ownershipEpoch,
          videoVersion: proof.asset.assetVersion,
        }) ||
      change.qualityStatus !== subtitle.qualityStatus ||
      change.checksum !== subtitle.checksum
    )
      throw new Error("Archive completed subtitle transition changed");
    assertPurgedSubtitle(actual, change, subtitle);
  }
}
function assertPurgedSubtitle(
  actual: Asset["subtitles"][number],
  change: z.infer<typeof NativeArchiveCompletionSchema>["subtitles"][number],
  subtitle: z.infer<
    typeof NativeArchiveContinuationSchema
  >["scope"]["files"][number]["subtitles"][number],
) {
  if (
    actual.state !== "purged" ||
    actual.version !== change.after.version ||
    actual.videoVersion !== change.after.videoVersion ||
    actual.ownershipEpoch !== change.after.ownershipEpoch ||
    actual.checksum !== subtitle.checksum ||
    actual.path !== subtitle.path ||
    actual.qualityStatus !== subtitle.qualityStatus
  )
    throw new Error("Archive completed subtitle binding changed");
}
function assertCompletedExecution(
  row: Prisma.NativeArchiveCleanupContinuationGetPayload<object>,
  proof: z.infer<typeof NativeArchiveCompletionSchema>,
  descriptor: z.infer<typeof NativeArchiveContinuationSchema>,
) {
  const execution = NativeArchiveExecutionSchema.parse(row.executionEvidence);
  if (
    execution.continuationId !== row.id ||
    execution.descriptorHash !== row.descriptorHash ||
    execution.recoveryEpoch !== row.recoveryEpoch ||
    execution.participants.length !== proof.journals.length
  )
    throw new Error("Archive terminal execution identity changed");
  for (const item of execution.participants) {
    const file = descriptor.fileEvidence.files.find(
      (entry) => entry.assetId === item.assetId,
    );
    const evidence =
      item.subtitleId === null
        ? file
        : file?.subtitles.find((entry) => entry.id === item.subtitleId);
    if (
      evidence?.canonicalPath !== item.canonicalPath ||
      evidence.checksum !== item.checksum ||
      evidence.sizeBytes !== item.sizeBytes ||
      snapshotHash(evidence.identity) !== snapshotHash(item.identity)
    )
      throw new Error("Archive terminal execution lacks reviewed identity");
    const operationId = `native-archive-${row.id}-${createHash("sha256").update(item.canonicalPath).digest("hex").slice(0, 20)}`;
    const expected = {
      version: 1,
      operationId,
      kind: "purge",
      source: item.canonicalPath,
      target: item.canonicalPath,
      sha256: item.checksum,
      previousSha256: null,
      phase: "complete",
    };
    const journal = proof.journals.find(
      (entry) => entry.operationId === operationId,
    );
    const absent = proof.absences.find(
      (entry) => entry.canonicalPath === item.canonicalPath,
    );
    if (
      absent === undefined ||
      journal?.manifestHash !== snapshotHash(expected) ||
      snapshotHash(absent.ancestors) !== snapshotHash(item.identity.ancestors)
    )
      throw new Error("Archive terminal journal or absence identity changed");
  }
}
