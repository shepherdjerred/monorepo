import { createHash } from "node:crypto";
import {
  JudgeCritiqueRecordSchema,
  type BuildLogEntry,
} from "#protocol/build.ts";
import { buildArtifactPath } from "#build/sidecar.ts";
import type { BuildWorkspace } from "#build/workspace.ts";
import { lowestAxis, rubricAxisIds } from "#build/judge.ts";
import { readLog } from "#build/build-log.ts";

/** A score counts only with the matching, readable record and judge image. */
export async function readCritiqueRecord(
  workspace: BuildWorkspace,
  entry: Extract<BuildLogEntry, { kind: "critique" }>,
) {
  const record = JudgeCritiqueRecordSchema.parse(
    await Bun.file(await buildArtifactPath(workspace, entry.file)).json(),
  );
  if (
    record.iteration !== entry.iteration ||
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
  const bytes = await Bun.file(
    await buildArtifactPath(workspace, record.sheet),
  ).bytes();
  if (createHash("sha256").update(bytes).digest("hex") !== record.sheetHash)
    throw new Error(`critique record ${entry.file} sheet hash does not match`);
  return record;
}

/** The newest validated critique of this grid within the current capture. */
export async function critiqueForGrid(
  workspace: BuildWorkspace,
  hash: string,
  rubric?: string,
) {
  const journal = await readLog(workspace.dir);
  const current = journal.slice(
    journal.findLastIndex((entry) => entry.kind === "capture") + 1,
  );
  for (const entry of current.toReversed()) {
    if (
      entry.kind === "critique" &&
      entry.gridHash === hash &&
      (rubric === undefined || entry.rubric === rubric)
    ) {
      await readCritiqueRecord(workspace, entry);
      return entry;
    }
  }
  return null;
}
