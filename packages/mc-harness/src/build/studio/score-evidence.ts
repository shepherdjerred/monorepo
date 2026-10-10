import type { BuildLogEntry } from "#protocol/build.ts";
import { readLog } from "#build/build-log.ts";
import type { BuildWorkspace } from "#build/workspace.ts";
import { readCritiqueRecord } from "./critique-record.ts";

type Outcome = Extract<BuildLogEntry, { kind: "accept" | "reject" }>;

/** Resolve a scored outcome to the critique of the exact accepted/rejected grid. */
export function outcomeCritique(
  entries: readonly BuildLogEntry[],
  entry: Outcome,
) {
  if (entry.score === null) {
    if (entry.critique !== undefined && entry.critique !== null)
      throw new Error("unscored outcome references a critique");
    return null;
  }
  const capture = entries.findLastIndex((item) => item.kind === "capture");
  const critique = entries
    .slice(capture + 1)
    .find((item) => item.kind === "critique" && item.file === entry.critique);
  if (
    critique?.kind !== "critique" ||
    entry.gridHash === undefined ||
    critique.gridHash !== entry.gridHash ||
    critique.rubric !== entry.rubric ||
    critique.total !== entry.score
  )
    throw new Error(
      `outcome for ${entry.candidate} does not match critique evidence`,
    );
  return critique;
}

export async function readOutcomeScore(
  workspace: BuildWorkspace,
  entry: Outcome,
) {
  const critique = outcomeCritique(await readLog(workspace.dir), entry);
  if (critique !== null) await readCritiqueRecord(workspace, critique);
}
