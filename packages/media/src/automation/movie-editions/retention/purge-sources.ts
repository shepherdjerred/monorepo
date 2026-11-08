import {
  FileGuardError,
  type FileContext,
  type RemovalEntry,
} from "#automation/files/types.ts";
import type { FileOperations } from "#filesystem/operations.ts";
import { safePath } from "#filesystem/operations-io.ts";

/** Absence permits recovery only after this exact purge recorded its original intent. */
export async function assertMoviePurgeSources(
  context: FileContext,
  operations: FileOperations,
  entry: RemovalEntry,
  operationId: string,
) {
  if (context.contentProof === undefined)
    throw new FileGuardError("purge_content_proof_missing");
  for (const file of [...entry.sidecars, entry]) {
    const source = await safePath(
      context.roots.movies.control,
      `quarantine/${file.quarantineId}`,
      true,
    );
    const digest = await context.contentProof.digest(source);
    if (digest !== null) {
      if (digest !== file.checksum)
        throw new FileGuardError("purge_content_changed");
      continue;
    }
    const id = `${operationId}-purge-${file.quarantineId}`;
    const journal = await operations.readManifest(id);
    if (
      journal?.operationId !== id ||
      journal.kind !== "purge" ||
      journal.source !== source ||
      journal.target !== source ||
      journal.sha256 !== file.checksum ||
      journal.previousSha256 !== null ||
      !["prepared", "complete"].includes(journal.phase)
    )
      throw new FileGuardError("purge_source_missing_without_journal");
    await context.checkpoint("purge-source-verification");
  }
}
