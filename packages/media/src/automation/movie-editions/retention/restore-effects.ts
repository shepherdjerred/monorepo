import { safePath } from "#filesystem/operations-io.ts";
import { durablePublicationJournal } from "#filesystem/publication-proof/journal.ts";
import { fileOperations } from "#automation/files/file-operations.ts";
import { FileGuardError, type RemovalEntry } from "#automation/files/types.ts";
import type { PublicationContext } from "#automation/publication-proof/invocation.ts";
import {
  PhysicalPathStateSchema,
  type PublicationJournal,
} from "#shared/publication-proof/effects.ts";
import type { PublicationParticipant } from "#shared/publication-proof/intent.ts";

/** Use the existing journaled restore engine and retain its actual durable ACK, including inode/ancestor identity. */
export async function restoreMovieEntryV1(
  context: PublicationContext,
  input: {
    entry: RemovalEntry;
    operationId: string;
    authorize: () => Promise<void>;
    assertActive: () => void;
  },
) {
  const operations = fileOperations(
    context,
    context.roots.movies,
    input.authorize,
    input.assertActive,
  );
  const files = [{ ...input.entry, subtitleId: null }, ...input.entry.sidecars];
  const journals: PublicationJournal[] = [];
  const participants: PublicationParticipant[] = [];
  for (const file of files) {
    const manifest = await operations.restore({
      operationId: `${input.operationId}-restore-${file.quarantineId}`,
      quarantineId: file.quarantineId,
      libraryPath: file.libraryPath,
      sha256: file.checksum,
    });
    input.assertActive();
    journals.push(
      await durablePublicationJournal(context.roots.movies, manifest),
    );
    for (const path of [
      {
        root: "library" as const,
        path: file.libraryPath,
        role:
          file.subtitleId === null ? ("video" as const) : ("sidecar" as const),
      },
      {
        root: "control" as const,
        path: `quarantine/${file.quarantineId}`,
        role: "quarantine" as const,
      },
    ]) {
      const physical = await observeRestoredPath(context, path);
      participants.push({
        assetId: input.entry.assetId,
        subtitleId: file.subtitleId,
        libraryKind: "movies",
        role: path.role,
        physical,
      });
    }
  }
  input.assertActive();
  return { participants, journals };
}

async function observeRestoredPath(
  context: PublicationContext,
  path: { root: "library" | "control"; path: string },
) {
  const proof = context.contentProof;
  if (proof === undefined) throw new FileGuardError("content_proof_missing");
  const filename = await safePath(
    context.roots.movies[path.root],
    path.path,
    false,
  );
  const reference = { root: path.root, path: path.path };
  const checksum = await proof.digest(filename);
  if (checksum === null)
    return PhysicalPathStateSchema.parse({
      ...reference,
      state: "absent",
      ...(await proof.reviewAbsence(filename)),
    });
  const verified = await proof.verifiedFile(filename);
  return PhysicalPathStateSchema.parse({
    ...reference,
    state: "present",
    sha256: checksum,
    sizeBytes: verified.sizeBytes,
    identity: await proof.reviewIdentity(filename),
  });
}
