import { exists } from "#filesystem/operations-io.ts";
import type { FileOperationManifest } from "#filesystem/operations-types.ts";
import type { recordedContentIO } from "#filesystem/publication-proof/recorder.ts";
import type { OperationJournal } from "./journal.ts";

/** Preserve the existing duplicate-publication cleanup and journal completion order. */
export async function completeDuplicateImport(input: {
  content: ReturnType<typeof recordedContentIO>;
  journal: OperationJournal;
  manifest: FileOperationManifest;
  staged: string;
  recorded: boolean;
}) {
  if (await exists(input.staged))
    await input.content.unlink(input.staged, {
      manifest: input.manifest,
      step: input.recorded
        ? "import_stage_unlink"
        : "import_duplicate_stage_unlink",
    });
  return await input.journal.complete(input.manifest);
}
