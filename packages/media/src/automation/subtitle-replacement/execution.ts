import { z } from "zod";
import type { SubtitleReplacement } from "#generated/prisma/client.ts";
import { FileGuardError } from "#automation/files/types.ts";
import { SubtitleReplacementObservationSchema } from "#shared/subtitle-replacement.ts";
import {
  type ReplacementProof,
  readReplacementJournal,
  assertReviewedProof,
} from "./files.ts";

export const ArtifactIdentitySchema = z.strictObject({
  device: z.string(),
  inode: z.string(),
  mtimeNs: z.string(),
  sizeBytes: z.string(),
  checksum: z.string(),
});
export const ExecutionSchema = z.strictObject({
  schemaVersion: z.literal(1),
  source: ArtifactIdentitySchema,
  staged: ArtifactIdentitySchema,
});

export async function artifactIdentity(
  proof: Pick<ReplacementProof, "content">,
  filename: string,
) {
  const info = await proof.content.verifiedFile(filename);
  return {
    device: info.dev.toString(),
    inode: info.ino.toString(),
    mtimeNs: info.mtimeNs.toString(),
    sizeBytes: info.sizeBytes,
    checksum: info.sha256,
  };
}

export async function assertArtifact(
  proof: Pick<ReplacementProof, "content">,
  filename: string,
  expected: z.infer<typeof ArtifactIdentitySchema>,
) {
  const current = await artifactIdentity(proof, filename);
  if (JSON.stringify(current) !== JSON.stringify(expected))
    throw new FileGuardError("subtitle_replacement_artifact_identity_changed");
}

export async function replacementEffectState(
  proof: ReplacementProof,
  row: SubtitleReplacement,
  observation: unknown,
) {
  const { paths, content } = proof;
  const execution = ExecutionSchema.parse(row.executionEvidence);
  const reviewed = SubtitleReplacementObservationSchema.parse(observation);
  const oldIdentity = {
    device: reviewed.old.identity.device,
    inode: reviewed.old.identity.inode,
    mtimeNs: reviewed.old.identity.mtimeNs,
    sizeBytes: reviewed.old.sizeBytes,
    checksum: reviewed.old.checksum,
  };
  const target = await content.digest(paths.target);
  const oldArchive = await content.digest(paths.oldArchive);
  const rejected = await content.digest(paths.rejected);
  const staged = await content.digest(paths.staged);
  const rollbackStaged = await content.digest(paths.rollbackStaged);
  if ((await content.digest(paths.partial)) !== null)
    throw new FileGuardError("subtitle_replacement_partial_unowned");
  await assertArtifact(proof, paths.source, execution.source);
  await assertImportJournal(proof, row.importOperationId);
  if (oldArchive !== null)
    await assertArtifact(proof, paths.oldArchive, oldIdentity);
  if (staged !== null)
    await assertArtifact(proof, paths.staged, execution.staged);
  if (rejected !== null)
    await assertArtifact(proof, paths.rejected, execution.staged);
  if (rollbackStaged !== null)
    await assertArtifact(proof, paths.rollbackStaged, oldIdentity);
  await assertReviewedProof(
    proof,
    observation,
    target === paths.scope.old.checksum && oldArchive === null,
  );
  if (target === paths.scope.old.checksum) {
    await assertArtifact(proof, paths.target, oldIdentity);
    if (rejected !== null) {
      if (oldArchive === null)
        throw new FileGuardError("subtitle_replacement_archive_missing");
      await assertRollbackJournal(proof, row.rollbackOperationId);
      return "restored" as const;
    }
    return "old" as const;
  }
  if (
    oldArchive !== null &&
    rejected === null &&
    target === paths.scope.candidate.checksum
  ) {
    await assertArtifact(proof, paths.target, execution.staged);
    return "promoted" as const;
  }
  throw new FileGuardError("subtitle_replacement_effect_unknown");
}

export async function assertImportJournal(
  proof: Pick<ReplacementProof, "paths">,
  operationId: string,
) {
  const { paths } = proof;
  const journal = await readReplacementJournal(paths, operationId);
  if (
    journal?.kind !== "import" ||
    journal.operationId !== operationId ||
    journal.source !== paths.source ||
    journal.target !== paths.target ||
    journal.sha256 !== paths.scope.candidate.checksum ||
    journal.previousSha256 !== paths.scope.old.checksum
  )
    throw new FileGuardError("subtitle_replacement_import_journal_changed");
}

async function assertRollbackJournal(
  proof: ReplacementProof,
  operationId: string,
) {
  const { paths } = proof;
  const journal = await readReplacementJournal(paths, operationId);
  if (
    journal?.kind !== "rollback" ||
    journal.operationId !== operationId ||
    journal.source !== paths.oldArchive ||
    journal.target !== paths.target ||
    journal.sha256 !== paths.scope.old.checksum ||
    journal.previousSha256 !== paths.scope.candidate.checksum
  )
    throw new FileGuardError("subtitle_replacement_rollback_journal_changed");
}
