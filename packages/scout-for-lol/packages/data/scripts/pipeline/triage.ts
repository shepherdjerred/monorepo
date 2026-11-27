// Triage: the Decisions API judges every tip cheaply; a tip is confidently
// correct (keep), confidently wrong (repair) or uncertain (escalate). A tip is
// uncertain when p(wrong) lies between two thresholds, or when it asserts an
// interaction between abilities (blocks, interrupts, reveals, collides,
// cancels, stops), the claims the models most often invent.

import { buildJudgePrompt } from "#src/tips/eval/judge.ts";
import { verdictFromScores } from "#src/tips/eval/decisions.ts";
import { mapPool } from "#src/tips/pool.ts";
import type { DecisionTipInput } from "../decisions/client.ts";

const DECISIONS_CONCURRENCY = 8;
import {
  type Context,
  type Thresholds,
  type TipState,
  type UnitState,
  liveTips,
} from "./state.ts";

/**
 * Chosen from `pipeline/calibrate.ts` against the 1,280 cached tips the two
 * reference judges labelled: below `lo` and no interaction, a tip is kept;
 * from `hi` up it is repaired; between, it is escalated.
 */
export const THRESHOLDS: Thresholds = { lo: 0.15, hi: 0.85 };

/** The interactions models invent most: one ability stopping, revealing or blocking another. */
const INTERACTION =
  /\b(?:block(?:s|ed|ing)?|interrupt(?:s|ed|ing)?|reveal(?:s|ed|ing)?|collid(?:e|es|ed|ing)|collision|cancel(?:s|led|ed|ling|ing)?|stop(?:s|ped|ping)?|dispel(?:s|led)?|cleanse(?:s|d)?)\b/iu;

export function asksAboutInteraction(text: string): boolean {
  return INTERACTION.test(text);
}

export type Route = "keep" | "repair" | "escalate";

export function routeOf(
  pWrong: number,
  text: string,
  thresholds: Thresholds = THRESHOLDS,
): Route {
  if (pWrong >= thresholds.hi) {
    return "repair";
  }
  if (pWrong < thresholds.lo && !asksAboutInteraction(text)) {
    return "keep";
  }
  return "escalate";
}

export function routeOfTip(tip: TipState, thresholds: Thresholds): Route {
  if (tip.decision === undefined) {
    throw new Error(`tip ${tip.id} was not triaged`);
  }
  return routeOf(tip.decision.pWrong, tip.text, thresholds);
}

/** Judge the selected live tips of every unit with the Decisions API and record verdict and route. */
export async function triage(
  ctx: Context,
  units: readonly UnitState[],
  pass: string,
  select: (tip: TipState) => boolean = () => true,
): Promise<number> {
  let judged = 0;
  const work = units.flatMap((unit) => {
    const sets = unit.sets.map((set) => ({
      set,
      tips: liveTips(set).filter((tip) => select(tip)),
    }));
    return sets.some((entry) => entry.tips.length > 0) ? [{ unit, sets }] : [];
  });
  await mapPool(work, DECISIONS_CONCURRENCY, async ({ unit, sets }) => {
    const notes = new Map(
      unit.groundings.map(
        (grounding, position) =>
          [grounding.name, unit.notes[position] ?? ""] as const,
      ),
    );
    const prompt = buildJudgePrompt(
      {
        lane: unit.lane,
        sets: sets.map(({ set, tips }) => ({
          subject: set.subject,
          ...(set.opponent === undefined ? {} : { opponent: set.opponent }),
          tips: tips.map((tip) => tip.text),
        })),
        notes,
      },
      { anchor: unit.groundings[0]?.name, shareAll: false },
    );
    let index = 0;
    const inputs: DecisionTipInput[] = sets.flatMap(({ set, tips }) =>
      tips.map((tip) => {
        const entry = {
          index,
          text: tip.text,
          subject: set.subject.name,
          opponent: set.opponent?.name,
        };
        index += 1;
        return entry;
      }),
    );
    const result = await ctx.decisions.judgeUnit(prompt, inputs);
    ctx.ledger.add(pass, result.costUsd);
    let position = 0;
    for (const { tips } of sets) {
      for (const tip of tips) {
        const scores = result.scores[position];
        position += 1;
        if (scores === undefined) {
          throw new Error(`no Decisions score for ${tip.id}`);
        }
        const verdict = verdictFromScores(scores).correctness;
        tip.decision = { verdict, pWrong: scores.pWrong };
        tip.history.push({
          pass,
          judge: "decisions",
          verdict,
          pWrong: scores.pWrong,
          interaction: asksAboutInteraction(tip.text),
          route: routeOf(scores.pWrong, tip.text, ctx.thresholds),
        });
        judged += 1;
      }
    }
  });
  return judged;
}
