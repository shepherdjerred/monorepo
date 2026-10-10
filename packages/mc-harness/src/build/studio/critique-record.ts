import {
  JudgeCritiqueRecordSchema,
  type BuildLogEntry,
} from "#protocol/build.ts";
import { buildArtifactPath } from "#build/sidecar.ts";
import type { BuildWorkspace } from "#build/workspace.ts";

/** A score counts only with the matching, readable record and judge image. */
export async function readCritiqueRecord(
  workspace: BuildWorkspace,
  entry: Extract<BuildLogEntry, { kind: "critique" }>,
) {
  const record = JudgeCritiqueRecordSchema.parse(
    await Bun.file(await buildArtifactPath(workspace, entry.file)).json(),
  );
  if (
    record.render !== entry.render ||
    record.gridHash !== entry.gridHash ||
    record.rubric !== entry.rubric ||
    record.total !== entry.total ||
    record.max !== entry.max ||
    record.lowest !== entry.lowest
  ) {
    throw new Error(
      `critique record ${entry.file} does not match its journal entry`,
    );
  }
  await Bun.file(await buildArtifactPath(workspace, record.sheet)).bytes();
  return record;
}
