import { z } from "zod";
import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import { assertAttemptIdentity } from "#infrastructure/acquisition-identity/authority.ts";
import { MediaError } from "#application/errors.ts";
import {
  FileGuardError,
  FilePlanSchema,
  type Transaction,
} from "#automation/files/types.ts";
import { assertFileIdentity, IdentityTorrentFileSchema } from "./evidence.ts";

export async function assertAcquisitionIdentity(
  tx: Transaction,
  attempt: AcquisitionAttempt,
  serverMachineId?: string,
): Promise<void> {
  try {
    const identity = await assertAttemptIdentity(tx, attempt, serverMachineId);
    if (identity === null) {
      if (
        attempt.filePlan !== null &&
        FilePlanSchema.parse(attempt.filePlan).some(
          (entry) => entry.identityEvidence !== undefined,
        )
      )
        throw new Error(
          "Historical acquisition has new file identity evidence",
        );
      return;
    }
    if (attempt.filePlan === null) return;
    if (attempt.torrentId === null) throw new FileGuardError("torrent_missing");
    const torrent = await tx.torrent.findUniqueOrThrow({
      where: { id: attempt.torrentId },
    });
    const observation = z
      .object({ files: z.array(IdentityTorrentFileSchema) })
      .parse(torrent.observation);
    for (const entry of FilePlanSchema.parse(attempt.filePlan))
      assertFileIdentity(identity, entry, observation.files);
  } catch (error) {
    if (error instanceof MediaError) throw new FileGuardError(error.code);
    throw error;
  }
}
