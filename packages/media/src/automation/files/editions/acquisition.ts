import { MediaError } from "#application/errors.ts";
import { assertDefaultAcquisitionEdition } from "#infrastructure/editions/acquisition.ts";
import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import type { CutMember } from "#shared/editions/evidence.ts";
import type { IdentityTorrentFile } from "#automation/files/acquisition-identity/evidence.ts";
import {
  FileGuardError,
  type FilePlanEntry,
  type Transaction,
} from "#automation/files/types.ts";

type Attempt = Pick<
  AcquisitionAttempt,
  "id" | "releaseId" | "mediaIds" | "operationId"
>;
export async function assertObservedEdition(
  tx: Transaction,
  attempt: Attempt,
  files: readonly IdentityTorrentFile[],
): Promise<void> {
  const members: CutMember[] = files.map((file) =>
    file.index === undefined
      ? {
          kind: "legacy_plan_member",
          attemptId: attempt.id,
          operationId: attempt.operationId,
          relativePath: file.name,
        }
      : {
          kind: "torrent_member",
          attemptId: attempt.id,
          torrentFileIndex: file.index,
          relativePath: file.name,
        },
  );
  await assertEdition(tx, attempt, members, []);
}
export async function assertPlanEdition(
  tx: Transaction,
  attempt: Attempt,
  plan: readonly FilePlanEntry[],
): Promise<void> {
  const members: CutMember[] = plan.map((entry) =>
    entry.identityEvidence === undefined
      ? {
          kind: "legacy_plan_member",
          attemptId: attempt.id,
          operationId: entry.operationId,
          relativePath: entry.downloadPath,
        }
      : {
          kind: "torrent_member",
          attemptId: attempt.id,
          torrentFileIndex: entry.identityEvidence.sourceFile.torrentFileIndex,
          relativePath: entry.identityEvidence.sourceFile.relativePath,
        },
  );
  const predecessors = plan.flatMap((entry) =>
    entry.previousAssetId === null ? [] : [entry.previousAssetId],
  );
  await assertEdition(tx, attempt, members, predecessors);
}
async function assertEdition(
  tx: Transaction,
  attempt: Attempt,
  members: readonly CutMember[],
  predecessorAssetIds: readonly string[],
): Promise<void> {
  try {
    await assertDefaultAcquisitionEdition(tx, {
      releaseId: attempt.releaseId,
      mediaIds: attempt.mediaIds,
      members,
      predecessorAssetIds,
    });
  } catch (error) {
    if (error instanceof MediaError) throw new FileGuardError(error.code);
    throw error;
  }
}
