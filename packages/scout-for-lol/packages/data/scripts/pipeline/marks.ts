// Jerred's marks: gold labels on the review set's tips. The file is an export of
// the review artifact's `marks` collection, an array of
// { tipId, unitId, verdict: good | meh | wrong, note, model }. When it exists,
// each pass's verdicts are compared with it.

import { z } from "zod";
import type { UnitState } from "./state.ts";

export const MARKS_PATH =
  "/Users/jerred/.local/share/scout-redesign/tips-review/marks.json";

export const MarkSchema = z.object({
  tipId: z.string(),
  unitId: z.string(),
  verdict: z.enum(["good", "meh", "wrong"]),
  note: z.string().optional(),
  model: z.string().optional(),
  champion: z.string().optional(),
});
export type Mark = z.infer<typeof MarkSchema>;

export async function readMarks(path: string): Promise<Mark[]> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return [];
  }
  return z.array(MarkSchema).parse(await file.json());
}

type Agreement = {
  /** Marks that matched a tip of this run. */
  marked: number;
  /** The pass called the tip wrong when he marked it wrong, or not wrong when he did not. */
  agree: number;
  /** He marked it wrong and the pass did not call it wrong. */
  missed: number;
  /** The pass called it wrong and he marked it good. */
  falseAlarm: number;
};

/** Each pass's agreement with the marks, over the tips both have a view on. */
export function agreementWithMarks(
  units: readonly UnitState[],
  marks: readonly Mark[],
): Record<string, Agreement> {
  const byTip = new Map(marks.map((mark) => [mark.tipId, mark.verdict]));
  const passes = new Map<string, Agreement>();
  const note = (
    pass: string,
    wrongByPass: boolean,
    mark: Mark["verdict"],
  ): void => {
    const current = passes.get(pass) ?? {
      marked: 0,
      agree: 0,
      missed: 0,
      falseAlarm: 0,
    };
    current.marked += 1;
    const wrongByHim = mark === "wrong";
    if (wrongByPass === wrongByHim) {
      current.agree += 1;
    } else if (wrongByHim) {
      current.missed += 1;
    } else if (mark === "good") {
      current.falseAlarm += 1;
    } else {
      // "meh" is neither right nor wrong; a pass that flags it is not penalised.
      current.agree += 1;
    }
    passes.set(pass, current);
  };
  for (const unit of units) {
    for (const set of unit.sets) {
      for (const tip of set.tips) {
        const mark = byTip.get(tip.id);
        if (mark === undefined) {
          continue;
        }
        for (const entry of tip.history) {
          if (
            typeof entry["verdict"] === "string" &&
            typeof entry["judge"] === "string"
          ) {
            note(
              `${entry.pass} (${String(entry["judge"])})`,
              entry["verdict"] === "wrong",
              mark,
            );
          }
        }
        // The final decision: dropped counts as "wrong".
        note("final (kept or dropped)", tip.status === "dropped", mark);
      }
    }
  }
  return Object.fromEntries(passes);
}
