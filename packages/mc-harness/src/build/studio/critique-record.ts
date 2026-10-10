import {
  JudgeCritiqueRecordSchema,
  type BuildLogEntry,
} from "#protocol/build.ts";
import { buildArtifactPath } from "#build/sidecar.ts";
import type { BuildWorkspace } from "#build/workspace.ts";
import { lowestAxis, rubricAxisIds } from "#build/judge.ts";

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
  const ids = rubricAxisIds(record.rubric);
  if (
    Object.keys(record.axes).length !== ids.length ||
    ids.some((id) => record.axes[id] === undefined) ||
    record.total !== ids.reduce((sum, id) => sum + (record.axes[id] ?? 0), 0) ||
    record.max !== ids.length * 5 ||
    record.lowest !== lowestAxis(record.rubric, record.axes)
  ) {
    throw new Error(
      `critique record ${entry.file} has inconsistent rubric scores`,
    );
  }
  await Bun.file(await buildArtifactPath(workspace, record.sheet)).bytes();
  return record;
}
