import {
  NativeArchiveContinuationSchema,
  NativeArchiveExecutionSchema,
  type NativeArchiveScope,
} from "#shared/native-recovery/archive.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import { nativeJson } from "#infrastructure/native-recovery/snapshots.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import type { ContentProof } from "#filesystem/content-proof.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import { executionFor } from "./cleanup-proof.ts";
import { archivePurgeId } from "./purge-manifest.ts";
import type { ArchiveFileContext } from "./execution.ts";

export async function captureArchiveSupersessions(
  context: ArchiveFileContext,
  scope: NativeArchiveScope,
  content: ContentProof,
  budget: PublicationAuthorityReadBudget,
) {
  const selections = [];
  const paths = new Set<string>();
  for (const target of scope.supersessions ?? []) {
    budget.consume(1);
    const row =
      await context.files.db.nativeArchiveCleanupContinuation.findUniqueOrThrow(
        { where: { id: target.continuationId } },
      );
    if (
      row.version !== target.version ||
      row.descriptorHash !== target.descriptorHash ||
      row.completion !== null ||
      row.supersession !== null ||
      row.coordinatorOperationId !== target.coordinatorOperationId ||
      snapshotHash(nativeJson(row.descriptor)) !== row.descriptorHash ||
      (row.executionEvidence === null
        ? null
        : snapshotHash(nativeJson(row.executionEvidence))) !==
        target.executionHash
    )
      throw new FileOperationConflict("Archive supersession selection changed");
    const descriptor = NativeArchiveContinuationSchema.parse(row.descriptor);
    const expected = executionFor(row, descriptor);
    if (
      row.executionEvidence !== null &&
      snapshotHash(
        NativeArchiveExecutionSchema.parse(row.executionEvidence),
      ) !== snapshotHash(expected)
    )
      throw new FileOperationConflict(
        "Archive supersession execution identity changed",
      );
    const journals = expected.participants.map((item) => ({
      libraryKind: item.libraryKind,
      canonicalPath: `/data/${item.libraryKind}/.media-control/journal/${archivePurgeId(row.id, item.canonicalPath)}.json`,
    }));
    for (const item of expected.participants) paths.add(item.canonicalPath);
    for (const journal of journals) paths.add(journal.canonicalPath);
    selections.push({ target, participants: expected.participants, journals });
  }
  for (const name of [...paths].sort())
    await content.capture(nativeLocalPath(context, name), () =>
      context.files.checkpoint("archive-supersession-hashing"),
    );
  return { selections, paths: [...paths].sort() };
}

export async function archiveSupersessionEvidence(
  context: ArchiveFileContext,
  content: ContentProof,
  captured: Awaited<ReturnType<typeof captureArchiveSupersessions>>,
) {
  const evidence = [];
  for (const { target, participants, journals } of captured.selections) {
    for (const participant of participants) {
      const local = nativeLocalPath(context, participant.canonicalPath);
      const actual = await content.verifiedFile(local);
      if (
        actual.sha256 !== participant.checksum ||
        actual.sizeBytes !== participant.sizeBytes ||
        snapshotHash(nativeJson(await content.reviewIdentity(local))) !==
          snapshotHash(nativeJson(participant.identity))
      )
        throw new FileOperationConflict(
          "Archive supersession cannot prove unchanged original bytes and identity",
        );
    }
    const absentJournals = [];
    for (const journal of journals)
      absentJournals.push({
        ...journal,
        ...(await content.reviewAbsence(
          nativeLocalPath(context, journal.canonicalPath),
        )),
      });
    evidence.push({
      continuationId: target.continuationId,
      descriptorHash: target.descriptorHash,
      executionHash: target.executionHash,
      participants,
      absentJournals,
    });
  }
  return evidence;
}
