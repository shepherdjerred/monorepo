// Checking a unit's tips with the generator's own validators, and running
// batch jobs with their spend recorded under the pass that asked for them.

import { WEB_SEARCH_USD } from "@shepherdjerred/llm-runtime/batch";
import {
  type Checked,
  type GeneralResult,
  type MatchupResult,
  checkGeneralDraft,
  checkMatchupDraft,
} from "#src/tips/check-draft.ts";
import {
  GeneralDraftSchema,
  MatchupDraftSchema,
  type MatchupDraft,
} from "#src/tips/prompt.ts";
import {
  type BatchJob,
  type BatchJobResult,
  runBatchJobs,
} from "../tips-batch.ts";
import {
  type Context,
  type SetState,
  type TipState,
  type UnitState,
  liveTips,
} from "./state.ts";

const ZERO_HASH = "0".repeat(64);

function draftTips(set: SetState): MatchupDraft["forward"] {
  return liveTips(set).map((tip) => ({
    text: tip.text,
    // A tip's cites are ability and keyword cites only, as the draft schema takes.
    cites: tip.cites.filter(
      (cite) => cite.kind === "ability" || cite.kind === "keyword",
    ) as unknown as MatchupDraft["forward"][number]["cites"],
    basis: tip.basis,
  }));
}

/** Run the generator's validators over a unit's live tips as they stand. */
export function checkUnit(
  ctx: Context,
  unit: UnitState,
): Checked<MatchupResult | GeneralResult> {
  const [forward, reverse] = unit.sets;
  const [first, second] = unit.groundings;
  if (forward === undefined || first === undefined) {
    throw new Error(`unit ${unit.id} has no sets`);
  }
  if (reverse !== undefined && second !== undefined) {
    return checkMatchupDraft({
      env: ctx.env,
      lane: unit.lane,
      groundings: [first, second],
      inputHash: ZERO_HASH,
      wiki: unit.pages,
      draft: MatchupDraftSchema.parse({
        forward: draftTips(forward),
        reverse: draftTips(reverse),
        glossary: unit.glossary,
      }),
    });
  }
  return checkGeneralDraft({
    env: ctx.env,
    lane: unit.lane,
    grounding: first,
    inputHash: ZERO_HASH,
    wiki: unit.pages,
    draft: GeneralDraftSchema.parse({
      tips: draftTips(forward),
      glossary: unit.glossary,
    }),
  });
}

/** Run jobs as batches and record what they cost, searches included, under `pass`. */
export async function runJobs<T>(
  ctx: Context,
  pass: string,
  jobs: readonly BatchJob<T>[],
): Promise<BatchJobResult<T>[]> {
  if (jobs.length === 0) {
    return [];
  }
  ctx.log(`${pass}: ${jobs.length.toString()} jobs`);
  // The batch API takes ids of word characters and dashes, up to 64: results come back in job order.
  const safe = jobs.map((job, index) => ({
    ...job,
    id: `j${index.toString()}`,
  }));
  const results = await runBatchJobs(ctx.client, safe, {
    budget: ctx.budget,
    searches: ctx.searches,
    cache: { type: "ephemeral", ttl: "5m" },
    log: (line) => {
      ctx.log(`[${pass}] ${line}`);
    },
  });
  const searches = results.reduce((sum, result) => sum + result.searches, 0);
  ctx.ledger.add(
    pass,
    results.reduce((sum, result) => sum + result.costUsd, 0),
    searches,
    searches * WEB_SEARCH_USD,
  );
  const stats = ctx.ledger.jobs.get(pass) ?? {
    jobs: 0,
    withLookup: 0,
    lookups: 0,
    withSearch: 0,
    failed: 0,
  };
  ctx.ledger.jobs.set(pass, {
    jobs: stats.jobs + results.length,
    withLookup:
      stats.withLookup + results.filter((r) => r.toolCalls > 0).length,
    lookups: stats.lookups + results.reduce((sum, r) => sum + r.toolCalls, 0),
    withSearch: stats.withSearch + results.filter((r) => r.searches > 0).length,
    failed:
      stats.failed +
      results.filter((r) => r.outcome.status === "failed").length,
  });
  return results;
}

export function newTip(
  set: SetState,
  fields: Pick<TipState, "text" | "cites" | "basis">,
  history: TipState["history"][number],
): TipState {
  const tip: TipState = {
    id: `${set.id}:${set.nextIndex.toString()}`,
    text: fields.text,
    cites: fields.cites,
    basis: fields.basis,
    history: [history],
    status: "live",
  };
  set.nextIndex += 1;
  set.tips.push(tip);
  return tip;
}
