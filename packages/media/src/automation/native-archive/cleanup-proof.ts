import path from "node:path";
import { ContentProof } from "#filesystem/content-proof.ts";
import { FileOperations } from "#filesystem/operations.ts";
import { safePath } from "#filesystem/operations-io.ts";
import { FileOperationConflict } from "#filesystem/operations-types.ts";
import {
  NativeArchiveExecutionSchema,
  type NativeArchiveContinuation,
  type NativeArchiveScope,
} from "#shared/native-recovery/archive.ts";
import { nativeLocalPath } from "#automation/native-recovery/files.ts";
import { snapshotHash } from "#migration/profile-import.ts";
import {
  assertArchiveActive,
  archiveAwait,
  type ArchiveFileContext,
} from "./execution.ts";
import { archiveAllPaths } from "./paths.ts";
import { assertArchiveNeighbors } from "./subtitle-proof.ts";
import { prepareCleanupJournalProof } from "./journal-proof.ts";
import { archivePurgeManifest } from "./purge-manifest.ts";
import type {
  ArchiveExecution,
  ArchiveParticipant,
  ArchiveCleanupBase,
} from "./cleanup-types.ts";
function executionFor(
  row: { id: string; descriptorHash: string; recoveryEpoch: number },
  descriptor: NativeArchiveContinuation,
): ArchiveExecution {
  const edge = descriptor.scope.edges.find(
    (item) => item.id === descriptor.selectedCleanupId && item.selected,
  );
  const file = descriptor.scope.files.find(
    (item) => item.assetId === edge?.assetId,
  );
  const evidence = descriptor.fileEvidence.files.find(
    (item) => item.assetId === file?.assetId,
  );
  if (edge === undefined || file === undefined || evidence === undefined)
    throw new Error("Archive selected physical proof missing");
  return NativeArchiveExecutionSchema.parse({
    schemaVersion: 1,
    continuationId: row.id,
    descriptorHash: row.descriptorHash,
    recoveryEpoch: row.recoveryEpoch,
    participants: edge.derivedPlan.files.map((item) => {
      const subtitle =
        item.subtitleId === null
          ? null
          : evidence.subtitles.find((entry) => entry.id === item.subtitleId);
      const identity =
        subtitle === null ? evidence.identity : subtitle?.identity;
      const sizeBytes =
        subtitle === null ? evidence.sizeBytes : subtitle?.sizeBytes;
      const canonicalPath =
        subtitle === null ? evidence.canonicalPath : subtitle?.canonicalPath;
      if (
        identity == null ||
        sizeBytes == null ||
        canonicalPath !== item.path ||
        item.checksum !==
          (subtitle === null ? evidence.checksum : subtitle?.checksum)
      )
        throw new Error(
          "Archive participant is not bound to reviewed physical evidence",
        );
      return {
        assetId: file.assetId,
        subtitleId: item.subtitleId,
        libraryKind: edge.derivedPlan.libraryKind,
        location: item.location,
        id: item.id,
        canonicalPath,
        checksum: item.checksum,
        sizeBytes,
        identity,
      };
    }),
  });
}

export async function prepareArchiveCleanupProof(
  context: ArchiveFileContext,
  row: {
    id: string;
    descriptorHash: string;
    recoveryEpoch: number;
    executionEvidence: unknown;
  },
  descriptor: NativeArchiveContinuation,
  scope: NativeArchiveScope,
) {
  const expected = executionFor(row, descriptor);
  const committed =
    row.executionEvidence === null
      ? null
      : NativeArchiveExecutionSchema.parse(row.executionEvidence);
  if (committed !== null && snapshotHash(committed) !== snapshotHash(expected))
    throw new Error("Archive execution identity changed");
  const content = new ContentProof();
  const paths = [
    ...new Set([
      ...archiveAllPaths(descriptor.scope),
      ...archiveAllPaths(scope),
    ]),
  ].sort();
  for (const name of paths) {
    const kind = name.startsWith("/data/movies/") ? "movies" : "tv";
    const roots = context.files.roots[kind];
    const root = name.startsWith(`/data/${kind}/.media-control/`)
      ? roots.control
      : roots.library;
    const local = nativeLocalPath(context, name);
    await safePath(root, path.relative(root, local), true);
    await content.capture(local, () =>
      context.files.checkpoint("native-archive-cleanup-hashing"),
    );
  }
  content.seal();
  const proof = {
    content,
    paths,
    execution: expected,
    executionCommitted: committed !== null,
    descriptor,
    scope,
  };
  await assertCleanupContent(context, proof);
  const journals = await prepareCleanupJournalProof(context, proof);
  return { ...proof, journals };
}

async function assertParticipant(
  context: ArchiveFileContext,
  proof: ArchiveCleanupBase,
  item: ArchiveParticipant,
) {
  const local = nativeLocalPath(context, item.canonicalPath);
  const digest = await proof.content.digest(local);
  const operations = new FileOperations(context.files.roots[item.libraryKind], {
    authorize: () =>
      Promise.reject(new Error("Archive inspection cannot mutate")),
    ...(context.files.verifyPlexExclusion === undefined
      ? {}
      : { verifyPlexExclusion: context.files.verifyPlexExclusion }),
  });
  const expected = archivePurgeManifest(
    context,
    proof.execution.continuationId,
    item,
  );
  const journal = await archiveAwait(
    context.execution,
    operations.readManifest(expected.operationId),
  );
  if (
    journal !== null &&
    (!proof.executionCommitted ||
      !["prepared", "complete"].includes(journal.phase) ||
      snapshotHash({ ...journal, phase: "prepared" }) !==
        snapshotHash(expected))
  )
    throw new FileOperationConflict(
      "Archive effect journal lacks its exact persisted execution",
    );
  if (digest === null) {
    if (journal === null || !proof.executionCommitted)
      throw new FileOperationConflict(
        "Archive missing bytes have no owned purge evidence",
      );
    const absence = await proof.content.reviewAbsence(local);
    if (
      snapshotHash(absence.ancestors) !== snapshotHash(item.identity.ancestors)
    )
      throw new FileOperationConflict("Archive absent path ancestor changed");
  } else if (
    digest !== item.checksum ||
    journal?.phase === "complete" ||
    snapshotHash(await proof.content.reviewIdentity(local)) !==
      snapshotHash(item.identity)
  )
    throw new FileOperationConflict(
      "Archive physical participant was replaced",
    );
}

export async function assertCleanupContent(
  context: ArchiveFileContext,
  proof: ArchiveCleanupBase,
) {
  assertArchiveActive(context.execution);
  const selected = new Set(
    proof.execution.participants.map((item) => item.canonicalPath),
  );
  for (const item of proof.execution.participants)
    await assertParticipant(context, proof, item);
  await assertRetainedContent(context, proof, selected);
  for (const terminal of proof.scope.terminalDependencies)
    for (const item of terminal.dependency.files)
      if (
        (await proof.content.digest(
          nativeLocalPath(context, item.canonicalPath),
        )) !== item.expectedChecksum
      )
        throw new FileOperationConflict("Archive terminal dependency changed");
  for (const item of proof.descriptor.fileEvidence.artifactAbsences) {
    const absence = await proof.content.reviewAbsence(
      nativeLocalPath(context, item.canonicalPath),
    );
    if (snapshotHash(absence.ancestors) !== snapshotHash(item.absentAncestors))
      throw new FileOperationConflict("Archive artifact absence changed");
  }
  await assertArchiveNeighbors(context, proof.scope);
  assertArchiveActive(context.execution);
}

async function assertRetainedContent(
  context: ArchiveFileContext,
  proof: ArchiveCleanupBase,
  selected: ReadonlySet<string>,
) {
  for (const file of proof.scope.files) {
    const evidence = proof.descriptor.fileEvidence.files.find(
      (item) => item.assetId === file.assetId,
    );
    if (evidence === undefined)
      throw new Error(
        "Archive current dependency lacks original physical evidence",
      );
    const participants = [
      {
        canonicalPath: file.canonicalPath,
        checksum: file.checksum,
        identity: evidence.identity,
      },
      ...evidence.subtitles.flatMap((item) =>
        item.canonicalPath === null
          ? []
          : [
              {
                canonicalPath: item.canonicalPath,
                checksum: item.checksum,
                identity: item.identity,
              },
            ],
      ),
    ];
    for (const item of participants) {
      if (selected.has(item.canonicalPath)) continue;
      const local = nativeLocalPath(context, item.canonicalPath);
      if (
        (await proof.content.digest(local)) !== item.checksum ||
        snapshotHash(await proof.content.reviewIdentity(local)) !==
          snapshotHash(item.identity)
      )
        throw new FileOperationConflict(
          "Archive retained or playback physical identity changed",
        );
    }
  }
}
