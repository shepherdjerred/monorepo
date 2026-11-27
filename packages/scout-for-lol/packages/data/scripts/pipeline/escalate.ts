// Escalation: Sonnet (medium) re-judges the tips triage could not settle. It
// must look a page of the wiki up before answering about any claim the given
// facts and wiki notes do not state, and, in the search arm, may use web search
// only when neither settles it. The model reads community pages for what the
// game does; nothing from a search is stored but the URLs it returned.

import { JudgeDraftSchema, buildJudgePrompt } from "#src/tips/eval/judge.ts";
import { lookupWikiPage } from "#src/tips/wiki.ts";
import type { BatchJob } from "../tips-batch.ts";
import { runJobs } from "./draft.ts";
import {
  type Context,
  type TipState,
  type UnitState,
  type Verdict,
  liveTips,
} from "./state.ts";

export const ESCALATION_RULES = `
How to check, which overrides any softer wording above:
- Answer from the facts and the wiki notes you were given when they state the claim.
- If a tip's claim (what an ability blocks, stops, reveals, interrupts or collides with; how long, how far, whether it can be dodged) is NOT stated in them, you MUST call the lookup tool for the relevant wiki page before you answer; do not answer from memory. Look up the page of the ability, item or status the claim is about.
- Only when lookup still does not settle it, and the web_search tool is available, search. Prefer a search that names the champion and the ability. Community pages (Reddit, Mobafire, guides, tutorials) can tell you how an interaction really plays; weigh them against the wiki, and judge what the game actually does, not what a page says about a tip.
- Judge the tip's claims; never copy a page's wording into your reason.
- In "sources" list every source you used for that tip: "facts", "wiki-notes", "wiki-lookup", "web-search", or "general-knowledge" when nothing given supports your answer. A tip you could not verify is "not-checkable", not "correct".`;

/** The search arm's stricter rule: a tip may not end "not-checkable" before the model has searched for it. */
const FORCE_SEARCH =
  '\n- For every tip you cannot confirm from the facts, the wiki notes or a lookup, you MUST run a web_search for it before you answer "not-checkable". Search for the specific claim (champion, ability, the interaction). Only answer "not-checkable" after a search that found nothing.';

const SEARCH_ONLY_WHEN_LEFT =
  " web_search is not available in this check; answer from the facts, the notes and lookup.";

export type EscalationOptions = {
  /** Label of the pass, for history and the ledger. */
  label: string;
  search: boolean;
  /** Require a search before "not-checkable". */
  forceSearch?: boolean;
  select: (tip: TipState) => boolean;
};

export type Escalated = { tip: TipState; verdict: Verdict; reason: string };

/** Judge the selected live tips with lookup (and search); records the verdict on each tip. */
export async function escalate(
  ctx: Context,
  units: readonly UnitState[],
  options: EscalationOptions,
): Promise<Escalated[]> {
  const work = units.flatMap((unit) => {
    const sets = unit.sets.map((set) => ({
      set,
      tips: liveTips(set).filter((tip) => options.select(tip)),
    }));
    return sets.some((entry) => entry.tips.length > 0) ? [{ unit, sets }] : [];
  });
  const jobs = work.map(
    ({ unit, sets }): BatchJob<typeof JudgeDraftSchema._output> => {
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
      const count = sets.reduce((sum, entry) => sum + entry.tips.length, 0);
      return {
        id: `${options.label}:${unit.id}`,
        model: ctx.judge,
        system: `${prompt.system}\n${ESCALATION_RULES}${options.search ? (options.forceSearch === true ? FORCE_SEARCH : "") : SEARCH_ONLY_WHEN_LEFT}`,
        prefix: prompt.prefix,
        rest: prompt.rest,
        schema: JudgeDraftSchema,
        effort: "medium",
        maxTokens: 4000,
        lookup: (title) => lookupWikiPage(ctx.wiki, title),
        ...(options.search
          ? {
              search: {
                type: ctx.searchTool,
                maxUses: ctx.searchesPerTip * count,
              },
            }
          : {}),
      };
    },
  );
  const results = await runJobs(ctx, options.label, jobs);
  const out: Escalated[] = [];
  for (const [index, entry] of work.entries()) {
    const result = results[index];
    const verdicts =
      result?.outcome.status === "ok" ? result.outcome.object.verdicts : [];
    let position = 0;
    for (const { tips } of entry.sets) {
      for (const tip of tips) {
        const verdict = verdicts.find(
          (candidate) => candidate.index === position,
        );
        position += 1;
        const decided: Escalated = {
          tip,
          verdict: verdict?.correctness ?? "not-checkable",
          reason: verdict?.reason ?? "the judge gave no verdict for this tip",
        };
        const previous = tip.escalation?.verdict;
        tip.escalation = { verdict: decided.verdict, reason: decided.reason };
        const sources = verdict?.sources ?? [];
        tip.history.push({
          pass: options.label,
          judge: "sonnet-medium",
          verdict: decided.verdict,
          reason: decided.reason,
          sources,
          lookups: result?.toolCalls ?? 0,
          searches: result?.searches ?? 0,
          urls: result?.searchUrls ?? [],
        });
        ctx.ledger.bump(options.label, "tips escalated");
        ctx.ledger.bump(options.label, `verdict ${decided.verdict}`);
        if (sources.includes("wiki-lookup")) {
          ctx.ledger.bump(options.label, "tips citing a wiki lookup");
        }
        if (sources.includes("web-search")) {
          ctx.ledger.bump(options.label, "tips citing web search");
        }
        if (previous !== undefined) {
          ctx.ledger.bump(
            options.label,
            `verdict ${previous} to ${decided.verdict}`,
          );
        }
        out.push(decided);
      }
    }
  }
  return out;
}
