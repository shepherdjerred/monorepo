/**
 * What a build's journal says about how it got there: iterations rendered,
 * critiques and their totals in order, candidates accepted and rejected.
 * Read from `journal.jsonl`, never from the agent's own report, so the eval
 * records what happened rather than what was claimed. Scores are read on the
 * task's rubric only: a total on the other rubric is a different number.
 */
import path from "node:path";
import { readLog } from "#build/build-log.ts";
import { BuildWorkspace } from "#build/workspace.ts";
import { readCritiqueRecord } from "#build/studio/critique-record.ts";
import { readPairRecord } from "#build/studio/pair-record.ts";
import { outcomeCritique } from "#build/studio/score-evidence.ts";
import {
  BUILD_FILES,
  type BuildLogEntry,
  type JudgeRubric,
} from "#protocol/build.ts";
import type { GradeCheck, Trajectory } from "#evals/lib/types.ts";

/** A journal as the grader found it: absent, unreadable, or its entries. */
export type JournalRead =
  { entries: BuildLogEntry[] } | { error: string } | null;

/**
 * Reads the build's journal with the same parser the build commands use.
 * A corrupt or foreign line is reported, not thrown: the grade goes on and
 * the process checks fail with the reason.
 */
export async function readJournal(buildDir: string): Promise<JournalRead> {
  const file = Bun.file(path.join(buildDir, BUILD_FILES.journal));
  if (!(await file.exists())) return null;
  try {
    const entries = await readLog(buildDir);
    const workspace = new BuildWorkspace(buildDir);
    for (const entry of currentCapture(entries)) {
      if (entry.kind === "critique") await readCritiqueRecord(workspace, entry);
      if (entry.kind === "accept" || entry.kind === "reject")
        await readPairRecord(workspace, entry);
    }
    return { entries };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Recapturing starts a new trajectory while retaining the earlier evidence. */
function currentCapture(
  entries: readonly BuildLogEntry[],
): readonly BuildLogEntry[] {
  const index = entries.findLastIndex((entry) => entry.kind === "capture");
  return index === -1 ? entries : entries.slice(index + 1);
}

export function trajectoryOf(
  entries: readonly BuildLogEntry[],
  rubric: JudgeRubric,
): Trajectory {
  const critiques: number[] = [];
  let iterations = 0;
  let accepted = 0;
  let rejected = 0;
  for (const entry of currentCapture(entries)) {
    if (entry.kind === "render") iterations += 1;
    if (entry.kind === "critique" && entry.rubric === rubric) {
      critiques.push(entry.total);
    }
    if (entry.kind === "accept" && entry.rubric === rubric) accepted += 1;
    if (entry.kind === "reject" && entry.rubric === rubric) rejected += 1;
  }
  return { iterations, critiques, accepted, rejected };
}

/**
 * True when every accepted candidate on the rubric was critiqued and kept
 * or raised the last accepted score. The score travels with the accept entry
 * (the candidate's own critique), so a critique of some other version in
 * between cannot stand in for it, and an unscored winner fails: a build whose
 * final version was never looked at has not kept the trajectory.
 */
export function acceptedNonDecreasing(
  entries: readonly BuildLogEntry[],
  rubric: JudgeRubric,
): boolean {
  let last: number | null = null;
  for (const entry of currentCapture(entries)) {
    if (entry.kind !== "accept" || entry.rubric !== rubric) continue;
    if (entry.score === null) return false;
    try {
      outcomeCritique(entries, entry);
    } catch {
      return false;
    }
    if (last !== null && entry.score < last) return false;
    last = entry.score;
  }
  return true;
}

/** How many distinct rendered grids were critiqued on the rubric (renaming or rescoring an unchanged grid adds nothing). */
export function critiquedIterations(
  entries: readonly BuildLogEntry[],
  rubric: JudgeRubric,
): number {
  const rendered = new Map<string, number>();
  const critiqued = new Set<string>();
  for (const entry of currentCapture(entries)) {
    if (entry.kind === "render") rendered.set(entry.name, entry.iteration);
    if (
      entry.kind === "critique" &&
      entry.rubric === rubric &&
      rendered.get(entry.render) === entry.iteration
    ) {
      critiqued.add(entry.gridHash);
    }
  }
  return critiqued.size;
}

const JOURNAL_CHECK = "build kept a journal (journal.jsonl)";

export function trajectoryChecks(
  journal: JournalRead,
  rubric: JudgeRubric,
): GradeCheck[] {
  if (journal === null) {
    return [
      {
        name: JOURNAL_CHECK,
        pass: false,
        detail: "no journal.jsonl in the build directory",
      },
    ];
  }
  if ("error" in journal) {
    return [
      {
        name: JOURNAL_CHECK,
        pass: false,
        detail: `journal.jsonl does not parse or its judge evidence is invalid: ${journal.error}`,
      },
    ];
  }
  const { entries } = journal;
  const trajectory = trajectoryOf(entries, rubric);
  const critiqued = critiquedIterations(entries, rubric);
  return [
    {
      name: JOURNAL_CHECK,
      pass: true,
      detail: `${entries.length.toString()} entries, ${trajectory.iterations.toString()} iteration(s)`,
    },
    {
      name: `at least two iterations critiqued on the ${rubric} rubric`,
      pass: critiqued >= 2,
      detail: `critiques: ${trajectory.critiques.length === 0 ? "none" : trajectory.critiques.join(" → ")} over ${critiqued.toString()} iteration(s)`,
    },
    {
      name: "every accepted candidate was critiqued and never lowered the total",
      pass: acceptedNonDecreasing(entries, rubric),
      detail: `${trajectory.accepted.toString()} accepted, ${trajectory.rejected.toString()} rejected`,
    },
  ];
}
