import type { Candidate, JudgeRubric } from "#protocol/build.ts";
import { readLog } from "#build/build-log.ts";
import { judgeFingerprint } from "#build/judge.ts";
import type { BuildWorkspace } from "#build/workspace.ts";
import { readPairRecord } from "./pair-record.ts";

/** A default iteration judges new grids; explicit pools deliberately rejudge. */
export async function defaultPool(
  workspace: BuildWorkspace,
  candidates: readonly Candidate[],
  options: { rubric: JudgeRubric; model: string },
): Promise<string[]> {
  const journal = await readLog(workspace.dir);
  const current = journal.slice(
    journal.findLastIndex((entry) => entry.kind === "capture") + 1,
  );
  const eliminated = new Set<string>();
  for (const entry of current) {
    if (entry.kind !== "reject" && entry.kind !== "accept") continue;
    const record = await readPairRecord(workspace, entry);
    if (
      record?.model !== options.model ||
      entry.rubric !== options.rubric ||
      record.judge !== judgeFingerprint(options.rubric)
    )
      continue;
    if (entry.gridHash === undefined)
      throw new Error(
        "legacy knockout outcome lacks grid identity; pass --among to rejudge explicitly",
      );
    if (entry.kind === "reject") eliminated.add(entry.gridHash);
    else eliminated.delete(entry.gridHash);
  }
  return candidates
    .filter((candidate) => !eliminated.has(candidate.gridHash))
    .map((candidate) => candidate.name);
}
