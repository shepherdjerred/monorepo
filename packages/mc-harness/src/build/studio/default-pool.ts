import type { Candidate, JudgeRubric } from "#protocol/build.ts";
import { readLog } from "#build/build-log.ts";
import { judgeFingerprint } from "#build/judge.ts";
import type { BuildWorkspace } from "#build/workspace.ts";
import { readPairRecord } from "./pair-record.ts";

function distinctPool(
  candidates: readonly Candidate[],
  eliminated: ReadonlySet<string>,
  incumbent: string | undefined,
): string[] {
  const distinct = new Map<string, Candidate>();
  for (const candidate of candidates) {
    if (eliminated.has(candidate.gridHash)) continue;
    if (!distinct.has(candidate.gridHash) || candidate.name === incumbent)
      distinct.set(candidate.gridHash, candidate);
  }
  return [...distinct.values()].map((candidate) => candidate.name);
}

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
    if (
      entry.kind === "accept" ||
      (record.grids !== undefined && record.grids.a === record.grids.b)
    )
      eliminated.delete(entry.gridHash);
    else eliminated.add(entry.gridHash);
  }
  const manifest = await workspace.manifest();
  return distinctPool(candidates, eliminated, manifest.best?.candidate);
}
