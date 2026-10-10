import type { AbsoluteScores } from "#build/judge.ts";
import type {
  BuildLogEntry,
  RenderSidecar,
  JudgeRubric,
} from "#protocol/build.ts";
import type { BuildWorkspace } from "#build/workspace.ts";
import { readCritiqueRecord } from "./critique-record.ts";

/** What the critic saw and said: the judge sheet, the scores, and who gave them. */
export type Visual = {
  sheet: string;
  sheetHash: string;
  scores: AbsoluteScores;
  model: string;
};

/**
 * The visual critique a code-only pass builds on: the newest critique of
 * this render, of this exact grid, on this rubric. Nothing is drawn and no
 * vision call is made, so `--stage code` costs one code review and leaves
 * the render's recorded score as it was.
 */
export async function reuseVisual(
  workspace: BuildWorkspace,
  journal: readonly BuildLogEntry[],
  input: { name: string; sidecar: RenderSidecar; rubric: JudgeRubric },
): Promise<Visual> {
  for (let index = journal.length - 1; index >= 0; index -= 1) {
    const entry = journal[index];
    if (
      entry?.kind !== "critique" ||
      entry.render !== input.name ||
      entry.iteration !== input.sidecar.iteration ||
      entry.gridHash !== input.sidecar.gridHash ||
      entry.rubric !== input.rubric
    ) {
      continue;
    }
    const record = await readCritiqueRecord(workspace, entry);
    return {
      sheet: record.sheet,
      sheetHash: record.sheetHash,
      scores: {
        rubric: record.rubric,
        model: record.visualModel ?? record.model,
        axes: record.axes,
        overallAesthetic: record.overallAesthetic,
        notes: record.notes,
        total: record.total,
        max: record.max,
      },
      model: record.visualModel ?? record.model,
    };
  }
  throw new Error(
    `no visual critique of render "${input.name}" on the ${input.rubric} rubric yet; run --stage visual or --stage both first`,
  );
}
