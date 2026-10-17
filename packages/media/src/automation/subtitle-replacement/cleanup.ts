import path from "node:path";
import type { Prisma } from "#generated/prisma/client.ts";
import type { FileOperations } from "#filesystem/operations.ts";
import { z } from "zod";
import { ContentProof } from "#filesystem/content-proof.ts";
import { safePath, verifyControlExclusion } from "#filesystem/operations-io.ts";
import { cleanupSubtitleArtifact } from "#filesystem/subtitle-artifacts.ts";
import { fileOperations } from "#automation/files/file-operations.ts";
import { assertRuntime } from "#automation/files/guards.ts";
import {
  FileGuardError,
  now,
  type FileContext,
} from "#automation/files/types.ts";
import type {
  SubtitleReplacementInput,
  SubtitleReplacementResult,
} from "#shared/subtitle-replacement.ts";
import { replacementPaths, type ReplacementPaths } from "./files.ts";
import {
  ArtifactIdentitySchema,
  assertArtifact,
  assertImportJournal,
} from "./execution.ts";
import { lockReplacement, assertReplacementOperation } from "./authority.ts";
import { replacementCandidateBytes } from "./candidate.ts";

const ArtifactName = z.enum([
  "source",
  "staged",
  "partial",
  "oldArchive",
  "rejected",
  "rollbackStaged",
]);
const ReceiptSchema = z.object({
  snapshotHash: z.string(),
  recoveryEpoch: z.int(),
  artifacts: z
    .array(
      z.object({
        name: ArtifactName,
        path: z.string(),
        identity: ArtifactIdentitySchema.nullable(),
      }),
    )
    .length(6),
});

export async function cleanupReplacement(
  context: FileContext,
  input: SubtitleReplacementInput,
): Promise<SubtitleReplacementResult> {
  const row = await context.db.subtitleReplacement.findUniqueOrThrow({
    where: { id: input.replacementId },
    include: { receipt: true },
  });
  if (row.cleanupState === "cleaned") return { state: "cleaned" };
  if (
    row.receipt === null ||
    row.reservationActive ||
    row.archiveExpiresAt === null
  )
    throw new FileGuardError("subtitle_replacement_unsettled");
  if (row.archiveExpiresAt > now(context))
    return { state: "waiting", retryAt: row.archiveExpiresAt.toISOString() };
  const receipt = ReceiptSchema.parse(row.receipt.evidence);
  if (
    receipt.snapshotHash !== row.snapshotHash ||
    receipt.recoveryEpoch !== row.recoveryEpoch ||
    new Set(receipt.artifacts.map((item) => item.name)).size !== 6
  )
    throw new FileGuardError("subtitle_replacement_cleanup_receipt_changed");
  const paths = replacementPaths(context, row);
  if (row.executionEvidence !== null)
    await assertImportJournal({ paths }, row.importOperationId);
  const content = new ContentProof();
  for (const artifact of receipt.artifacts) {
    if (artifact.path !== paths[artifact.name])
      throw new FileGuardError("subtitle_replacement_cleanup_path_changed");
    await safePath(
      paths.roots.control,
      path.relative(paths.roots.control, artifact.path),
      true,
    );
    await content.capture(artifact.path, () =>
      context.checkpoint("subtitle-cleanup-hashing"),
    );
  }
  content.seal();
  const candidate = await context.db.subtitleAsset.findUniqueOrThrow({
    where: { id: row.candidateSubtitleId },
  });
  const bytes = replacementCandidateBytes(candidate);
  await context.db.$transaction(
    async (tx) => {
      const { row: current } = await lockReplacement(tx, row.id);
      await assertReplacementOperation(tx, input, [
        "cleanup_subtitle_replacement",
      ]);
      if (current.cleanupState === "cleaned") return;
      const authorize = () =>
        authorizeCleanup({ tx, context, row, current, paths, receipt });
      await authorize();
      const files = fileOperations(
        { ...context, contentProof: content },
        paths.roots,
        authorize,
      );
      for (const artifact of receipt.artifacts)
        await cleanupRecordedArtifact({
          artifact,
          context,
          row,
          paths,
          content,
          authorize,
          bytes,
          files,
        });
      if (current.receipt?.outcome === "installed")
        await tx.subtitleAsset.update({
          where: { id: row.oldSubtitleId },
          data: { state: "purged", version: { increment: 1 } },
        });
      await tx.subtitleReplacement.update({
        where: { id: row.id },
        data: {
          cleanupState: "cleaned",
          cleanupReason: null,
          version: { increment: 1 },
        },
      });
    },
    { timeout: 30_000 },
  );
  return { state: "cleaned" };
}

type CleanupRow = Prisma.SubtitleReplacementGetPayload<{
  include: { receipt: true };
}>;
async function authorizeCleanup(input: {
  tx: Prisma.TransactionClient;
  context: FileContext;
  row: CleanupRow;
  current: CleanupRow;
  paths: ReplacementPaths;
  receipt: z.infer<typeof ReceiptSchema>;
}) {
  const { tx, context, row, current, paths, receipt } = input;

  await assertRuntime(tx, row.recoveryEpoch);
  if (!(await context.enabled.purge()))
    throw new FileGuardError("purge_disabled");
  if (
    current.reservationActive ||
    current.receipt?.id !== row.receipt?.id ||
    current.archiveExpiresAt?.getTime() !== row.archiveExpiresAt?.getTime()
  )
    throw new FileGuardError("subtitle_replacement_cleanup_changed");
  await context.verifyStorageAuthority(paths.roots);
  await verifyControlExclusion(paths.roots, context.verifyPlexExclusion);
  const filenames = receipt.artifacts.map((item) => item.path);
  if (
    (await tx.libraryAsset.count({
      where: { path: { in: filenames } },
    })) ||
    (await tx.subtitleAsset.count({
      where: { path: { in: filenames }, id: { not: row.oldSubtitleId } },
    }))
  )
    throw new FileGuardError("subtitle_replacement_archive_referenced");
  const old = await tx.subtitleAsset.findUniqueOrThrow({
    where: { id: row.oldSubtitleId },
  });
  if (
    current.receipt?.outcome === "installed" &&
    (old.state !== "superseded" ||
      old.path !== paths.oldArchive ||
      old.ownershipEpoch !== row.recoveryEpoch ||
      old.checksum !== paths.scope.old.checksum)
  )
    throw new FileGuardError("subtitle_replacement_archive_changed");
}

async function cleanupRecordedArtifact(input: {
  artifact: z.infer<typeof ReceiptSchema>["artifacts"][number];
  context: FileContext;
  row: CleanupRow;
  paths: ReplacementPaths;
  content: ContentProof;
  authorize: () => Promise<void>;
  bytes: ReturnType<typeof replacementCandidateBytes>;
  files: FileOperations;
}) {
  const { artifact, context, row, paths, content, authorize, bytes, files } =
    input;

  const digest = await content.digest(artifact.path);
  if (artifact.identity === null) {
    if (digest !== null)
      throw new FileGuardError("subtitle_replacement_artifact_path_reused");
    return;
  }
  if (digest !== null) {
    await assertArtifact({ content }, artifact.path, artifact.identity);
  }
  if (artifact.name === "oldArchive" || artifact.name === "rejected") {
    const archiveId =
      artifact.name === "oldArchive"
        ? row.importOperationId
        : row.rollbackOperationId;
    const purgeId = `subclean-${row.id}-${artifact.name}`;
    if (digest === null)
      await assertArchiveRemoval(
        files,
        purgeId,
        artifact.path,
        artifact.identity.checksum,
      );
    await files.purge({
      operationId: purgeId,
      quarantineId: archiveId,
      sha256: artifact.identity.checksum,
      location: "rollback",
    });
  } else {
    await cleanupSubtitleArtifact({
      roots: paths.roots,
      replacementId: row.id,
      importOperationId: row.importOperationId,
      rollbackOperationId: row.rollbackOperationId,
      artifact:
        artifact.name === "rollbackStaged" ? "rollback-staged" : artifact.name,
      format: bytes.format,
      candidate: bytes.bytes,
      previousChecksum: paths.descriptor.previousSha256,
      identity: artifact.identity,
      content,
      authorize,
      checkpoint: context.checkpoint,
      ...(context.verifyPlexExclusion === undefined
        ? {}
        : { verifyPlexExclusion: context.verifyPlexExclusion }),
    });
  }
}

async function assertArchiveRemoval(
  files: FileOperations,
  operationId: string,
  filename: string,
  checksum: string,
) {
  const journal = await files.readManifest(operationId);
  if (
    journal?.kind !== "purge" ||
    journal.source !== filename ||
    journal.sha256 !== checksum
  )
    throw new FileGuardError("subtitle_replacement_archive_missing_unproven");
}
