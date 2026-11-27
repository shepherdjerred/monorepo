// Repair: a tip judged wrong is rewritten once, from the judge's reason and the
// grounding (with lookup and web search to check against). The rewrite must be
// our own words: a run of eight words shared with the wiki notes or with any
// search result the model read in the call rejects it. The caller re-triages
// the rewrite and drops it if it is still wrong or uncertain.

import { z } from "zod";
import { sharedWordRun } from "#src/tips/copy-check.ts";
import { DraftTipSchema } from "#src/tips/prompt.ts";
import { lookupWikiPage } from "#src/tips/wiki.ts";
import type { BatchJob } from "../tips-batch.ts";
import { checkUnit, runJobs } from "./draft.ts";
import { MATCHUP_MAX_TOKENS, basePrompt } from "./generate.ts";
import {
  type Context,
  type TipState,
  type UnitState,
  drop,
  liveTips,
} from "./state.ts";

const RepairDraftSchema = z.object({
  repairs: z.array(
    z.object({
      index: z.number().int(),
      action: z.enum(["rewrite", "keep", "drop"]),
      text: z.string(),
      cites: DraftTipSchema.shape.cites,
      basis: z.array(z.string()),
    }),
  ),
});

export type RepairOutcome = {
  /** Tips with a new text, to be triaged again. */
  rewritten: TipState[];
  /** Tips the repair pass checked and found correct as written, to be arbitrated. */
  confirmed: TipState[];
};

function reasonFor(tip: TipState): string {
  if (tip.escalation?.verdict === "wrong") {
    return `a fact check found it wrong: ${tip.escalation.reason}`;
  }
  return `a quick check rated it likely wrong (probability ${(tip.decision?.pWrong ?? 0).toFixed(2)}) and gave no reason; verify it yourself`;
}

export async function repair(
  ctx: Context,
  units: readonly UnitState[],
  pass: string,
  select: (tip: TipState) => boolean,
): Promise<RepairOutcome> {
  const work = units.flatMap((unit) => {
    const flagged = unit.sets.flatMap((set) =>
      liveTips(set)
        .filter((tip) => select(tip))
        .map((tip) => ({ set, tip })),
    );
    return flagged.length > 0 ? [{ unit, flagged }] : [];
  });
  const jobs = work.map(
    ({ unit, flagged }): BatchJob<typeof RepairDraftSchema._output> => {
      const prompt = basePrompt(ctx, unit);
      const lines = flagged.map(
        ({ set, tip }, index) =>
          `${index.toString()}. [${set.side === undefined ? "general" : `${set.subject.name} against ${set.opponent?.name ?? ""}`}] "${tip.text}"\n   Flagged: ${reasonFor(tip)}`,
      );
      return {
        id: `${pass}:${unit.id}`,
        model: ctx.generator,
        system: prompt.system,
        prefix: prompt.prefix,
        rest: [
          prompt.rest,
          "",
          "Repair these tips. Each was flagged as possibly wrong:",
          ...lines,
          "",
          'For each, check the claim against the facts, the wiki notes, the lookup tool and, only if those do not settle it, web search, then answer with an action: "rewrite" with a corrected tip that is true (keep the advice if you can, change only what was wrong), "keep" with the unchanged text if you find it is actually correct, or "drop" if it cannot be made true. Write your own words: never reuse a run of eight words from any page you read. Every rule above still applies (plain sentences, no statistics, cite every ability you name). Return one entry per tip, with its index.',
        ].join("\n"),
        schema: RepairDraftSchema,
        effort: "medium",
        maxTokens: MATCHUP_MAX_TOKENS,
        lookup: (title) => lookupWikiPage(ctx.wiki, title),
        search: {
          type: ctx.searchTool,
          maxUses: ctx.searchesPerTip * flagged.length,
        },
      };
    },
  );
  const results = await runJobs(ctx, pass, jobs);
  const outcome: RepairOutcome = { rewritten: [], confirmed: [] };
  for (const [index, entry] of work.entries()) {
    const result = results[index];
    const repairs =
      result?.outcome.status === "ok" ? result.outcome.object.repairs : [];
    const seen = result?.searchTexts ?? [];
    for (const [position, { tip }] of entry.flagged.entries()) {
      const fix = repairs.find((candidate) => candidate.index === position);
      const urls = result?.searchUrls ?? [];
      if (fix === undefined || fix.action === "drop") {
        drop(
          tip,
          pass,
          fix === undefined
            ? "the repair gave no answer"
            : "the repair found it cannot be made true",
        );
        ctx.ledger.bump(pass, "dropped by repair");
        continue;
      }
      if (fix.action === "keep") {
        tip.history.push({ pass, action: "keep", urls });
        outcome.confirmed.push(tip);
        ctx.ledger.bump(pass, "confirmed as written");
        continue;
      }
      const copied = sharedWordRun(fix.text, [...entry.unit.notes, ...seen]);
      if (copied !== undefined) {
        drop(tip, pass, `the rewrite copies a source: "${copied}"`);
        ctx.ledger.bump(pass, "rewrites rejected as copies");
        continue;
      }
      const before = { text: tip.text, cites: tip.cites, basis: tip.basis };
      tip.text = fix.text;
      tip.cites = fix.cites as never;
      tip.basis = fix.basis;
      const checked = checkUnit(ctx, entry.unit);
      if (
        checked.result === undefined &&
        checked.issues.some((issue) => issue.tip === fix.text)
      ) {
        Object.assign(tip, before);
        drop(tip, pass, "the rewrite failed the validators");
        ctx.ledger.bump(pass, "rewrites rejected by the validators");
        continue;
      }
      tip.history.push({ pass, action: "rewrite", from: before.text, urls });
      tip.decision = undefined;
      tip.escalation = undefined;
      outcome.rewritten.push(tip);
      ctx.ledger.bump(pass, "rewritten");
    }
  }
  return outcome;
}
