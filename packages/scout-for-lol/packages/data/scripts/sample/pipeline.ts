// Generate, validate, retry once, and judge a list of tip units, all as batches:
// the shared pipeline of the thick sample and the review set. Nothing is
// written under src/tips/generated.
//
// Units of one lead champion are adjacent so the shared block is a cache read;
// a unit that fails the validators is resubmitted once with its rejected answer
// and the findings (as the interactive path does); every accepted unit is
// judged by Sonnet (medium, batch) and by the Decisions API, and no tip is
// dropped here.

import type { ChampionId } from "#src/model/core/identifiers.ts";
import type { Lane } from "#src/model/riot/lane.ts";
import { checkGeneralDraft, checkMatchupDraft } from "#src/tips/check-draft.ts";
import { JudgeDraftSchema, buildJudgePrompt } from "#src/tips/eval/judge.ts";
import {
  type ChampionGrounding,
  loadAbilityNameIndex,
  loadChampionGrounding,
} from "#src/tips/grounding.ts";
import type { GenerationBudget } from "#src/tips/model.ts";
import { mapPool } from "#src/tips/pool.ts";
import {
  GeneralDraftSchema,
  MatchupDraftSchema,
  TIP_PROMPT_VERSION,
  buildGeneralPrompt,
  buildMatchupPrompt,
  buildRetryPrompt,
} from "#src/tips/prompt.ts";
import type { Tip } from "#src/tips/schema.ts";
import { createTipStore } from "#src/tips/store.ts";
import type { TipIssue } from "#src/tips/validate.ts";
import {
  createWikiClient,
  lookupWikiPage,
  prefetchChampionWiki,
} from "#src/tips/wiki.ts";
import {
  type DecisionTipInput,
  createTipDecisions,
} from "../decisions/client.ts";
import {
  type BatchJob,
  type BatchJobResult,
  createTipBatchClient,
  runBatchJobs,
} from "../tips-batch.ts";
import type { TipScores } from "#src/tips/eval/decisions.ts";

const GENERATED_DIRECTORY = `${import.meta.dir}/../../src/tips/generated`;
const WIKI_CACHE_DIRECTORY = `${import.meta.dir}/../../.tips-cache/wiki`;

export type PipelineUnit = {
  lane: Lane;
  /** One champion is a general set; two are a pair written in both directions. */
  championIds: readonly ChampionId[];
};

export type PipelineSet = {
  subject: ChampionGrounding;
  opponent?: ChampionGrounding;
  /** Which side of a pair, as the generator writes it: forward is the first champion. */
  side?: "forward" | "reverse";
  tips: Tip[];
};

export type SonnetVerdict = {
  index: number;
  correctness: "correct" | "wrong" | "not-checkable";
  useful: boolean;
  plain: boolean;
  reason: string;
  sources: string[];
};

export type UnitOutcome = {
  unit: PipelineUnit;
  groundings: ChampionGrounding[];
  passed: boolean;
  passedFirst: boolean;
  issues: string[];
  retryIssues: string[];
  sets: PipelineSet[] | undefined;
  /** Verdicts numbered across the unit's sets, as the judge saw them. */
  sonnet: SonnetVerdict[] | undefined;
  decisions: TipScores[] | undefined;
  generationCostUsd: number;
  outputTokens: number;
};

export type StageTotals = {
  jobs: number;
  failed: number;
  toolCalls: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  costUsd: number;
  seconds: number;
};

export type PipelineResult = {
  generator: string;
  judge: string;
  promptVersion: string;
  generation: StageTotals;
  retried: number;
  sonnet: StageTotals;
  decisions: {
    units: number;
    costUsd: number;
    inputTokens: number;
    cachedInputTokens: number;
    seconds: number;
    msPerUnit: number[];
  };
  outcomes: UnitOutcome[];
  spentUsd: number;
};

function stageTotals<T>(
  results: readonly BatchJobResult<T>[],
  seconds: number,
): StageTotals {
  const sum = (pick: (result: BatchJobResult<T>) => number): number =>
    results.reduce((total, result) => total + pick(result), 0);
  return {
    jobs: results.length,
    failed: results.filter((result) => result.outcome.status === "failed")
      .length,
    toolCalls: sum((result) => result.toolCalls),
    inputTokens: sum((result) => result.tokens.inputTokens),
    cacheReadTokens: sum((result) => result.tokens.cacheReadTokens),
    cacheWriteTokens: sum((result) => result.tokens.cacheWriteTokens),
    outputTokens: sum((result) => result.tokens.outputTokens),
    costUsd: sum((result) => result.costUsd),
    seconds: Math.round(seconds),
  };
}

type Prepared = {
  unit: PipelineUnit;
  groundings: ChampionGrounding[];
  notes: string[];
  pages: Record<string, number>;
};

type Checked = { sets: PipelineSet[] | undefined; issues: TipIssue[] };

export async function runPipeline(input: {
  units: readonly PipelineUnit[];
  generator: string;
  judge: string;
  budget: GenerationBudget;
  maxTokens: { matchup: number; general: number };
  log: (line: string) => void;
}): Promise<PipelineResult> {
  const { budget, log } = input;
  const client = createTipBatchClient();
  const wiki = createWikiClient({ cacheDirectory: WIKI_CACHE_DIRECTORY });
  const glossary = await createTipStore({
    directory: GENERATED_DIRECTORY,
  }).glossary();
  const abilityIndex = await loadAbilityNameIndex();
  const cache = { type: "ephemeral", ttl: "5m" } as const;

  const prepared: Prepared[] = await Promise.all(
    input.units.map(async (unit) => {
      const groundings = await Promise.all(
        unit.championIds.map((id) => loadChampionGrounding(id)),
      );
      const pre = await prefetchChampionWiki(
        wiki,
        groundings.map((grounding) => grounding.name),
      );
      return { unit, groundings, notes: pre.notes, pages: pre.pages };
    }),
  );
  prepared.sort((left, right) =>
    (left.groundings[0]?.name ?? "").localeCompare(
      right.groundings[0]?.name ?? "",
    ),
  );

  const generationJobs: BatchJob<unknown>[] = prepared.map((item, index) => {
    const [first, second] = item.groundings;
    if (first === undefined) {
      throw new Error("a unit has no champion");
    }
    const id = `gen-${index.toString()}`;
    const shared = {
      id,
      model: input.generator,
      effort: "low" as const,
      lookup: (title: string) => lookupWikiPage(wiki, title),
    };
    if (second !== undefined) {
      const prompt = buildMatchupPrompt({
        lane: item.unit.lane,
        first,
        second,
        glossary,
        notes: [item.notes[0] ?? "", item.notes[1] ?? ""],
        anchor: "first",
      });
      return {
        ...shared,
        system: prompt.system,
        prefix: prompt.prefix,
        rest: prompt.rest,
        schema: MatchupDraftSchema,
        maxTokens: input.maxTokens.matchup,
      };
    }
    const prompt = buildGeneralPrompt({
      lane: item.unit.lane,
      champion: first,
      glossary,
      notes: item.notes[0],
    });
    return {
      ...shared,
      system: prompt.system,
      prefix: prompt.prefix,
      rest: prompt.rest,
      schema: GeneralDraftSchema,
      maxTokens: input.maxTokens.general,
    };
  });
  log(
    `generating ${generationJobs.length.toString()} units on ${input.generator} (batch)`,
  );
  const generationStart = Date.now();
  const generated = await runBatchJobs(client, generationJobs, {
    budget,
    cache,
    log,
  });
  const generationSeconds = (Date.now() - generationStart) / 1000;

  const env = {
    model: {
      name: input.generator,
      pricing: { inputPerMTok: 0, outputPerMTok: 0 },
      generate: () => Promise.reject(new Error("unused")),
    },
    promptVersion: TIP_PROMPT_VERSION,
    abilityIndex,
    glossary,
    maxOutputTokens: input.maxTokens.matchup,
  };
  const hash = "0".repeat(64);
  const checkUnit = (item: Prepared, object: unknown): Checked => {
    const [first, second] = item.groundings;
    if (first === undefined) {
      throw new Error("a unit has no champion");
    }
    if (second !== undefined) {
      const outcome = checkMatchupDraft({
        env,
        lane: item.unit.lane,
        groundings: [first, second],
        inputHash: hash,
        wiki: item.pages,
        draft: MatchupDraftSchema.parse(object),
      });
      return {
        sets:
          outcome.result === undefined
            ? undefined
            : [
                {
                  subject: first,
                  opponent: second,
                  side: "forward",
                  tips: outcome.result.forward.tips,
                },
                {
                  subject: second,
                  opponent: first,
                  side: "reverse",
                  tips: outcome.result.reverse.tips,
                },
              ],
        issues: outcome.issues,
      };
    }
    const outcome = checkGeneralDraft({
      env,
      lane: item.unit.lane,
      grounding: first,
      inputHash: hash,
      wiki: item.pages,
      draft: GeneralDraftSchema.parse(object),
    });
    return {
      sets:
        outcome.result === undefined
          ? undefined
          : [{ subject: first, tips: outcome.result.set.tips }],
      issues: outcome.issues,
    };
  };
  const firstPass = prepared.map((item, index): Checked => {
    const result = generated[index];
    if (result === undefined) {
      throw new Error("a batch result is missing");
    }
    return result.outcome.status === "ok"
      ? checkUnit(item, result.outcome.object)
      : {
          sets: undefined,
          issues: [{ code: "set", message: result.outcome.reason }],
        };
  });

  const retryIndexes = firstPass.flatMap((entry, index) =>
    entry.sets === undefined && generated[index]?.outcome.status === "ok"
      ? [index]
      : [],
  );
  const retryJobs: BatchJob<unknown>[] = retryIndexes.map((index) => {
    const job = generationJobs[index];
    const outcome = generated[index]?.outcome;
    if (job === undefined || outcome?.status !== "ok") {
      throw new Error("a retry has no first answer");
    }
    return {
      ...job,
      id: `retry-${index.toString()}`,
      rest: buildRetryPrompt({
        prompt: job.rest,
        rejected: outcome.object,
        issues: firstPass[index]?.issues ?? [],
      }),
    };
  });
  log(`retrying ${retryJobs.length.toString()} units that failed validation`);
  const retryStart = Date.now();
  const retried = await runBatchJobs(client, retryJobs, { budget, cache, log });
  const retrySeconds = (Date.now() - retryStart) / 1000;

  const checked = prepared.map((item, index) => {
    const first = firstPass[index];
    const position = retryIndexes.indexOf(index);
    const retry = position < 0 ? undefined : retried[position];
    const second =
      retry?.outcome.status === "ok"
        ? checkUnit(item, retry.outcome.object)
        : undefined;
    const text = (issues: readonly TipIssue[]): string[] =>
      issues.map((issue) => `${issue.code}: ${issue.message}`);
    return {
      item,
      passedFirst: first?.sets !== undefined,
      sets: first?.sets ?? second?.sets,
      issues: first?.sets === undefined ? text(first?.issues ?? []) : [],
      retryIssues: text(second?.issues ?? []),
      retryCostUsd: retry?.costUsd ?? 0,
      retryOutputTokens: retry?.tokens.outputTokens ?? 0,
    };
  });
  const accepted = checked.flatMap((entry, index) =>
    entry.sets === undefined ? [] : [{ ...entry, sets: entry.sets, index }],
  );
  log(
    `${accepted.length.toString()} of ${checked.length.toString()} units passed the validators`,
  );

  const judgePrompts = accepted.map((entry) => {
    const notes = new Map(
      entry.item.groundings.map(
        (grounding, position) =>
          [grounding.name, entry.item.notes[position] ?? ""] as const,
      ),
    );
    return buildJudgePrompt(
      {
        lane: entry.item.unit.lane,
        sets: entry.sets.map((set) => ({
          subject: set.subject,
          ...(set.opponent === undefined ? {} : { opponent: set.opponent }),
          tips: set.tips.map((tip) => tip.text),
        })),
        notes,
      },
      { anchor: entry.item.groundings[0]?.name, shareAll: false },
    );
  });
  const judgeJobs: BatchJob<typeof JudgeDraftSchema._output>[] = accepted.map(
    (entry, position) => {
      const prompt = judgePrompts[position];
      if (prompt === undefined) {
        throw new Error("a judge prompt is missing");
      }
      return {
        id: `judge-${entry.index.toString()}`,
        model: input.judge,
        system: prompt.system,
        prefix: prompt.prefix,
        rest: prompt.rest,
        schema: JudgeDraftSchema,
        effort: "medium",
        maxTokens: 4000,
        lookup: (title: string) => lookupWikiPage(wiki, title),
      };
    },
  );
  log(`judging ${judgeJobs.length.toString()} units on ${input.judge}`);
  const judgeStart = Date.now();
  const sonnetPromise = runBatchJobs(client, judgeJobs, { budget, cache, log });

  const decisions = createTipDecisions();
  const decisionStart = Date.now();
  const decided = await mapPool(accepted, 4, async (entry, position) => {
    const prompt = judgePrompts[position];
    if (prompt === undefined) {
      throw new Error("a judge prompt is missing");
    }
    let index = 0;
    const tips: DecisionTipInput[] = entry.sets.flatMap((set) =>
      set.tips.map((tip) => {
        const entryTip = {
          index,
          text: tip.text,
          subject: set.subject.name,
          opponent: set.opponent?.name,
        };
        index += 1;
        return entryTip;
      }),
    );
    return decisions.judgeUnit(prompt, tips);
  });
  const decisionSeconds = (Date.now() - decisionStart) / 1000;
  const sonnet = await sonnetPromise;
  const judgeSeconds = (Date.now() - judgeStart) / 1000;
  const decisionsCost = decided.reduce(
    (sum, result) => sum + result.costUsd,
    0,
  );

  return {
    generator: input.generator,
    judge: input.judge,
    promptVersion: TIP_PROMPT_VERSION,
    generation: stageTotals(
      [...generated, ...retried],
      generationSeconds + retrySeconds,
    ),
    retried: retryJobs.length,
    sonnet: stageTotals(sonnet, judgeSeconds),
    decisions: {
      units: decided.length,
      costUsd: decisionsCost,
      inputTokens: decided.reduce((sum, result) => sum + result.inputTokens, 0),
      cachedInputTokens: decided.reduce(
        (sum, result) => sum + result.cachedInputTokens,
        0,
      ),
      seconds: Math.round(decisionSeconds),
      msPerUnit: decided.map((result) => result.milliseconds),
    },
    outcomes: checked.map((entry, index): UnitOutcome => {
      const position = accepted.findIndex((item) => item.index === index);
      const outcome = position < 0 ? undefined : sonnet[position]?.outcome;
      return {
        unit: entry.item.unit,
        groundings: entry.item.groundings,
        passed: entry.sets !== undefined,
        passedFirst: entry.passedFirst,
        issues: entry.issues,
        retryIssues: entry.retryIssues,
        sets: entry.sets,
        sonnet: outcome?.status === "ok" ? outcome.object.verdicts : undefined,
        decisions: position < 0 ? undefined : decided[position]?.scores,
        generationCostUsd:
          (generated[index]?.costUsd ?? 0) + entry.retryCostUsd,
        outputTokens:
          (generated[index]?.tokens.outputTokens ?? 0) +
          entry.retryOutputTokens,
      };
    }),
    spentUsd: budget.spentUsd + decisionsCost,
  };
}
