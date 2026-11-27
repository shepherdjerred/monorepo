// Pass 1: write the first tips of the units that have none, as batches, with
// the one retry (the validators' findings fed back), as the interactive path does.

import { lookupWikiPage } from "#src/tips/wiki.ts";
import {
  GeneralDraftSchema,
  MatchupDraftSchema,
  type TipPrompt,
  buildGeneralPrompt,
  buildMatchupPrompt,
  buildRetryPrompt,
} from "#src/tips/prompt.ts";
import type { BatchJob } from "../tips-batch.ts";
import { checkUnit, newTip, runJobs } from "./draft.ts";
import type { TipIssue } from "#src/tips/validate.ts";
import type { Context, GlossaryDraft, UnitState } from "./state.ts";

export const MATCHUP_MAX_TOKENS = 4500;
export const GENERAL_MAX_TOKENS = 3500;

/** The unit's tip-writing prompt: grounding, wiki notes, the task. */
export function basePrompt(ctx: Context, unit: UnitState): TipPrompt {
  const [first, second] = unit.groundings;
  if (first === undefined) {
    throw new Error("a unit has no champion");
  }
  return second === undefined
    ? buildGeneralPrompt({
        lane: unit.lane,
        champion: first,
        glossary: ctx.glossary,
        notes: unit.notes[0],
      })
    : buildMatchupPrompt({
        lane: unit.lane,
        first,
        second,
        glossary: ctx.glossary,
        notes: [unit.notes[0] ?? "", unit.notes[1] ?? ""],
        anchor: "first",
      });
}

export function draftSchemaFor(unit: UnitState) {
  return unit.groundings.length === 2 ? MatchupDraftSchema : GeneralDraftSchema;
}

export function writeJob(
  ctx: Context,
  unit: UnitState,
  id: string,
  rest: string,
  prompt: TipPrompt,
): BatchJob<unknown> {
  return {
    id,
    model: ctx.generator,
    system: prompt.system,
    prefix: prompt.prefix,
    rest,
    schema: draftSchemaFor(unit),
    effort: "low",
    maxTokens:
      unit.groundings.length === 2 ? MATCHUP_MAX_TOKENS : GENERAL_MAX_TOKENS,
    lookup: (title) => lookupWikiPage(ctx.wiki, title),
  };
}

type Draft = {
  forward?: { text: string; cites: unknown[]; basis: string[] }[];
  reverse?: { text: string; cites: unknown[]; basis: string[] }[];
  tips?: { text: string; cites: unknown[]; basis: string[] }[];
  glossary: GlossaryDraft[];
};

/** Put a drafted answer's tips into the unit's sets. */
export function takeDraft(
  unit: UnitState,
  draft: Draft,
  history: Record<string, unknown> & { pass: string },
): void {
  const sides =
    unit.groundings.length === 2
      ? [draft.forward, draft.reverse]
      : [draft.tips];
  for (const [index, set] of unit.sets.entries()) {
    for (const tip of sides[index] ?? []) {
      newTip(
        set,
        {
          text: tip.text,
          cites: tip.cites as never,
          basis: tip.basis,
        },
        history,
      );
    }
  }
  unit.glossary = draft.glossary;
}

export async function generatePass(
  ctx: Context,
  units: readonly UnitState[],
): Promise<void> {
  const todo = units.filter((unit) => unit.origin !== "review-set");
  const prompts = new Map(todo.map((unit) => [unit.id, basePrompt(ctx, unit)]));
  const jobs = todo.map((unit) => {
    const prompt = prompts.get(unit.id);
    if (prompt === undefined) {
      throw new Error("a prompt is missing");
    }
    return writeJob(ctx, unit, `gen:${unit.id}`, prompt.rest, prompt);
  });
  const results = await runJobs(ctx, "generate", jobs);
  const retry: { unit: UnitState; answer: unknown; issues: TipIssue[] }[] = [];
  for (const [index, unit] of todo.entries()) {
    const result = results[index];
    if (result?.outcome.status !== "ok") {
      unit.origin = "failed";
      continue;
    }
    const draft = result.outcome.object as Draft;
    takeDraft(unit, draft, { pass: "generate", origin: "generated" });
    const checked = checkUnit(ctx, unit);
    if (checked.result !== undefined) {
      continue;
    }
    for (const set of unit.sets) {
      set.tips = [];
      set.nextIndex = 0;
    }
    retry.push({ unit, answer: draft, issues: checked.issues });
  }
  const retryJobs = retry.map(({ unit, answer, issues }) => {
    const prompt = prompts.get(unit.id);
    if (prompt === undefined) {
      throw new Error("a prompt is missing");
    }
    return writeJob(
      ctx,
      unit,
      `retry:${unit.id}`,
      buildRetryPrompt({ prompt: prompt.rest, rejected: answer, issues }),
      prompt,
    );
  });
  const retried = await runJobs(ctx, "generate-retry", retryJobs);
  for (const [index, { unit }] of retry.entries()) {
    const result = retried[index];
    if (result?.outcome.status !== "ok") {
      unit.origin = "failed";
      continue;
    }
    takeDraft(unit, result.outcome.object as Draft, {
      pass: "generate",
      origin: "generated",
      retried: true,
    });
    if (checkUnit(ctx, unit).result === undefined) {
      unit.origin = "failed";
      for (const set of unit.sets) {
        set.tips = [];
      }
    }
  }
}
