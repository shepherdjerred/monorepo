import type {
  MovieRollbackIntentV1,
  MovieRollbackPhysicalV1,
} from "#shared/movie-editions/rollback/physical.ts";
import type { PublicationParticipant } from "#shared/publication-proof/intent.ts";

function sameInode(
  before: PublicationParticipant | undefined,
  after: PublicationParticipant | undefined,
) {
  if (
    before?.physical.state !== "present" ||
    after?.physical.state !== "present" ||
    before.physical.sha256 !== after.physical.sha256 ||
    before.physical.sizeBytes !== after.physical.sizeBytes ||
    before.physical.identity.device !== after.physical.identity.device ||
    before.physical.identity.inode !== after.physical.identity.inode
  )
    throw new Error(
      "Movie rollback physical identity is not its actual immutable original inode",
    );
}

/** Hard-link/rename inverse retains original inode ownership even when A and B
 * happen to contain matching video or caption checksums. */
export function assertMovieRollbackOriginalIdentitiesV1(
  intent: MovieRollbackIntentV1,
  receipt: MovieRollbackPhysicalV1,
) {
  const parent = intent.source.reference.intent.entries[0];
  const original = parent.participants.filter(
    (row) =>
      row.physical.root === "library" &&
      ["video", "sidecar"].includes(row.role),
  );
  for (const before of original) {
    const after = receipt.participants.find(
      (row) =>
        row.assetId === before.assetId &&
        row.subtitleId === before.subtitleId &&
        row.role === before.role &&
        row.physical.root === "library" &&
        row.physical.path === before.physical.path,
    );
    sameInode(before, after);
  }
  const publishedB = intent.source.outcome.entries[0].participants.find(
    (row) =>
      row.assetId === intent.successor.id &&
      row.subtitleId === null &&
      row.role === "video" &&
      row.physical.root === "library",
  );
  const retainedB = receipt.participants.find(
    (row) =>
      row.assetId === intent.successor.id &&
      row.subtitleId === null &&
      row.physical.root === "control" &&
      row.physical.path === `rollback/recover-${intent.successor.id}`,
  );
  sameInode(publishedB, retainedB);
}
