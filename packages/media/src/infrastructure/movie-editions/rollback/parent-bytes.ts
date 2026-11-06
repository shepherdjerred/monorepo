import type { AcquisitionAttempt } from "#generated/prisma/client.ts";
import { assertMovieRollbackCanonical } from "./canonical.ts";

/** New rollback records carry literal canonical bytes so SQL can validate each
 * digest against the actual source row without changing old receipt formats. */
export function assertMovieRollbackAttemptBytesV1(
  attempt: AcquisitionAttempt,
  raw: { identityRaw: string; birthRaw: string; generationsRaw: string },
  hashes: { identityHash: string; birthHash: string; generationsHash: string },
) {
  assertMovieRollbackCanonical(
    raw.identityRaw,
    attempt.identityEvidence,
    hashes.identityHash,
  );
  assertMovieRollbackCanonical(
    raw.birthRaw,
    {
      choiceId: attempt.movieEditionChoiceId,
      choiceRevision: attempt.movieEditionChoiceRevision,
      authority: attempt.movieEditionAuthority,
    },
    hashes.birthHash,
  );
  assertMovieRollbackCanonical(
    raw.generationsRaw,
    attempt.generations,
    hashes.generationsHash,
  );
}
