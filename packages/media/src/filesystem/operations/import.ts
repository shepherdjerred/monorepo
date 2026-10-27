import nodePath from "node:path";
import { exists, syncDirectory } from "#filesystem/operations-io.ts";
import {
  FileOperationConflict,
  type FileOperationManifest,
  type ImportFile,
} from "#filesystem/operations-types.ts";
import type { recordedContentIO } from "#filesystem/publication-proof/recorder.ts";
import type { OperationJournal } from "./journal.ts";

/** Preserve the existing duplicate-publication cleanup and journal completion order. */
export async function completeDuplicateImport(input: {
  content: ReturnType<typeof recordedContentIO>;
  journal: OperationJournal;
  manifest: FileOperationManifest;
  staged: string;
  recorded: boolean;
  allowDuplicateTarget?: boolean;
}) {
  if (input.allowDuplicateTarget === false)
    throw new FileOperationConflict(
      "Existing caption destination requires owner review",
    );
  if (await exists(input.staged))
    await input.content.unlink(input.staged, {
      manifest: input.manifest,
      step: input.recorded
        ? "import_stage_unlink"
        : "import_duplicate_stage_unlink",
    });
  return await input.journal.complete(input.manifest);
}

/** Preserve the same recorded backup, checkpoint and verification before replacing recognized bytes. */
export async function preserveImportPredecessor(input: {
  file: ImportFile;
  digest: string;
  target: string;
  backup: string;
  manifest: FileOperationManifest;
  content: ReturnType<typeof recordedContentIO>;
  checkpoint: () => Promise<void>;
}) {
  const previous = input.file.previousSha256;
  if (previous === undefined || input.digest !== previous)
    throw new FileOperationConflict(
      "Publication would replace an unrecognized file",
    );
  if (await exists(input.backup))
    await input.content.requireDigest(input.backup, previous);
  else {
    await input.content.link(input.target, input.backup, {
      manifest: input.manifest,
      step: "import_backup_link",
    });
    await syncDirectory(nodePath.dirname(input.backup));
  }
  await input.checkpoint();
  await input.content.requireDigest(input.target, previous);
}
