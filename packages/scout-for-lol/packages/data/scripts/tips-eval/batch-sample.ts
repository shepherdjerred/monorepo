// Measure what the Message Batches API and prompt caching really save, on one
// small real batch: the ten most-played Akali matchups in Mid are generated
// with Haiku and the accepted ones judged with Sonnet, both as batches whose
// prompts lead with the shared champion block marked as a cache breakpoint.
// The result is the measured price the cost projections use.
//
//   batch-sample.ts --max-cost-usd 2 [--units 10] [--champion Akali]
//                   [--ttl 1h|5m] [--generator claude-haiku-5-5]
//                   [--judge claude-sonnet-5-5]

import { parseArgs } from "node:util";
import { format, resolveConfig } from "prettier";
import { currentLanePriors } from "#src/lane-priors/current.ts";
import { checkMatchupDraft } from "#src/tips/check-draft.ts";
import { JudgeDraftSchema, buildJudgePrompt } from "#src/tips/eval/judge.ts";
import { EVAL_RAW_DIRECTORY } from "#src/tips/eval/raw-directory.ts";
import {
  loadAbilityNameIndex,
  loadChampionGrounding,
} from "#src/tips/grounding.ts";
import { GenerationBudget, tokenUpperBound } from "#src/tips/model.ts";
import { planTips } from "#src/tips/plan.ts";
import { lanePriorTipPlanSource } from "#src/tips/plan-sources.ts";
import {
  MATCHUP_SCHEMA_NAME,
  MatchupDraftSchema,
  TIP_PROMPT_VERSION,
  buildMatchupPrompt,
} from "#src/tips/prompt.ts";
import {
  ALL_TIPS,
  type TipKind,
  parseTipSelector,
  selectWork,
} from "#src/tips/select.ts";
import { createTipStore } from "#src/tips/store.ts";
import {
  createWikiClient,
  lookupWikiPage,
  prefetchChampionWiki,
} from "#src/tips/wiki.ts";
import {
  type BatchJob,
  type BatchJobResult,
  createTipBatchClient,
  runBatchJobs,
} from "../tips-batch.ts";

const GENERATED_DIRECTORY = `${import.meta.dir}/../../src/tips/generated`;
const WIKI_CACHE_DIRECTORY = `${import.meta.dir}/../../.tips-cache/wiki`;
const OUTPUT_PATH = `${EVAL_RAW_DIRECTORY}/batch-sample.json`;

function stage<T>(
  name: string,
  model: string,
  results: readonly BatchJobResult<T>[],
  seconds: number,
) {
  const sum = (pick: (result: BatchJobResult<T>) => number): number =>
    results.reduce((total, result) => total + pick(result), 0);
  const input = sum((r) => r.tokens.inputTokens);
  const read = sum((r) => r.tokens.cacheReadTokens);
  const write = sum((r) => r.tokens.cacheWriteTokens);
  const costUsd = sum((r) => r.costUsd);
  const listUsd = sum((r) => r.listUsd);
  return {
    stage: name,
    model,
    jobs: results.length,
    failed: results.filter((r) => r.outcome.status === "failed").length,
    rounds: sum((r) => r.rounds),
    toolCalls: sum((r) => r.toolCalls),
    inputTokens: input,
    cacheReadTokens: read,
    cacheWriteTokens: write,
    outputTokens: sum((r) => r.tokens.outputTokens),
    /** Share of the prompt tokens served from the cache. */
    cacheReadShare:
      Math.round((read / Math.max(1, input + read + write)) * 1e4) / 1e4,
    costUsd: Math.round(costUsd * 1e6) / 1e6,
    /** The same tokens at the standard price, nothing cached. */
    listUsd: Math.round(listUsd * 1e6) / 1e6,
    /** Saved against the standard price with no cache. */
    totalSavings: Math.round((1 - costUsd / listUsd) * 1e4) / 1e4,
    /** Saved by the cache alone, against half the standard price (the batch price with no cache). */
    cacheSavingsOnBatch: Math.round((1 - costUsd / (listUsd / 2)) * 1e4) / 1e4,
    seconds: Math.round(seconds),
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "max-cost-usd": { type: "string" },
      units: { type: "string", default: "10" },
      champion: { type: "string", default: "Akali" },
      ttl: { type: "string", default: "1h" },
      generator: { type: "string", default: "claude-haiku-5-5" },
      judge: { type: "string", default: "claude-sonnet-5-5" },
    },
    strict: true,
  });
  const budget = new GenerationBudget(Number(values["max-cost-usd"]));
  const ttl = values.ttl === "5m" ? "5m" : "1h";
  const source = lanePriorTipPlanSource(currentLanePriors);
  const plan = planTips(source);
  const anchorId = parseTipSelector(`middle/${values.champion}`).champion;
  const units = selectWork(plan, source, {
    ...ALL_TIPS,
    lane: "middle",
    selectors: [parseTipSelector(`middle/${values.champion}`)],
    kinds: new Set<TipKind>(["matchup"]),
    limit: Number(values.units),
  }).matchups;
  const client = createTipBatchClient();
  const wiki = createWikiClient({ cacheDirectory: WIKI_CACHE_DIRECTORY });
  const glossary = await createTipStore({
    directory: GENERATED_DIRECTORY,
  }).glossary();
  const abilityIndex = await loadAbilityNameIndex();
  const cache = { type: "ephemeral", ttl } as const;

  const prepared = await Promise.all(
    units.map(async (unit) => {
      const [first, second] = await Promise.all([
        loadChampionGrounding(unit.championIds[0]),
        loadChampionGrounding(unit.championIds[1]),
      ]);
      const pre = await prefetchChampionWiki(wiki, [first.name, second.name]);
      return { unit, first, second, pre };
    }),
  );

  const generationJobs: BatchJob<typeof MatchupDraftSchema._output>[] =
    prepared.map(({ unit, first, second, pre }) => {
      const [firstNotes = "", secondNotes = ""] = pre.notes;
      const prompt = buildMatchupPrompt({
        lane: "middle",
        first,
        second,
        glossary,
        notes: [firstNotes, secondNotes],
        anchor: first.championId === anchorId ? "first" : "second",
      });
      return {
        id: `gen-${unit.championIds.join("-")}`,
        model: values.generator,
        system: prompt.system,
        prefix: prompt.prefix,
        rest: prompt.rest,
        schema: MatchupDraftSchema,
        effort: "low",
        maxTokens: 4000,
        lookup: (title) => lookupWikiPage(wiki, title),
      };
    });
  console.log(
    `generating ${generationJobs.length.toString()} units on ${values.generator} (batch, cache ttl ${ttl})`,
  );
  const generationStart = Date.now();
  const generated = await runBatchJobs(client, generationJobs, {
    budget,
    cache,
    log: (line) => {
      console.log(line);
    },
  });
  const generationSeconds = (Date.now() - generationStart) / 1000;
  for (const result of generated) {
    if (result.outcome.status === "failed") {
      console.log(`failed ${result.id}: ${result.outcome.reason}`);
    }
  }

  // Validate every answer as the generator would; judge the accepted ones.
  const judgeJobs: BatchJob<typeof JudgeDraftSchema._output>[] = [];
  let accepted = 0;
  for (const [index, result] of generated.entries()) {
    const item = prepared[index];
    if (item === undefined || result.outcome.status !== "ok") {
      continue;
    }
    const checked = checkMatchupDraft({
      env: {
        model: {
          name: values.generator,
          pricing: { inputPerMTok: 0, outputPerMTok: 0 },
          generate: () => Promise.reject(new Error("unused")),
        },
        promptVersion: TIP_PROMPT_VERSION,
        abilityIndex,
        glossary,
        maxOutputTokens: 4000,
      },
      lane: "middle",
      groundings: [item.first, item.second],
      inputHash: "0".repeat(64),
      wiki: item.pre.pages,
      draft: result.outcome.object,
    });
    if (checked.result === undefined) {
      continue;
    }
    accepted += 1;
    const notes = new Map([
      [item.first.name, item.pre.notes[0] ?? ""],
      [item.second.name, item.pre.notes[1] ?? ""],
    ]);
    const prompt = buildJudgePrompt(
      {
        lane: "middle",
        sets: [
          {
            subject: item.first,
            opponent: item.second,
            tips: checked.result.forward.tips.map((tip) => tip.text),
          },
          {
            subject: item.second,
            opponent: item.first,
            tips: checked.result.reverse.tips.map((tip) => tip.text),
          },
        ],
        notes,
      },
      { anchor: values.champion },
    );
    judgeJobs.push({
      id: `judge-${item.unit.championIds.join("-")}`,
      model: values.judge,
      system: prompt.system,
      prefix: prompt.prefix,
      rest: prompt.rest,
      schema: JudgeDraftSchema,
      effort: "medium",
      maxTokens: 3000,
      lookup: (title) => lookupWikiPage(wiki, title),
    });
  }
  console.log(
    `judging ${judgeJobs.length.toString()} accepted units on ${values.judge}`,
  );
  const judgeStart = Date.now();
  const judged = await runBatchJobs(client, judgeJobs, {
    budget,
    cache,
    log: (line) => {
      console.log(line);
    },
  });
  const judgeSeconds = (Date.now() - judgeStart) / 1000;

  const report = {
    generatedAt: new Date().toISOString(),
    anchor: values.champion,
    cacheTtl: ttl,
    units: units.length,
    acceptedUnits: accepted,
    promptVersion: TIP_PROMPT_VERSION,
    promptChars: {
      generationPrefix: generationJobs[0]?.prefix.length ?? 0,
      generationRest: generationJobs[0]?.rest.length ?? 0,
      systemBytes: tokenUpperBound(generationJobs[0]?.system ?? ""),
    },
    generation: stage(
      "generation",
      values.generator,
      generated,
      generationSeconds,
    ),
    judging: stage("judging", values.judge, judged, judgeSeconds),
    spentUsd: Math.round(budget.spentUsd * 1e6) / 1e6,
  };
  const config = await resolveConfig(OUTPUT_PATH);
  await Bun.write(
    OUTPUT_PATH,
    await format(JSON.stringify(report), { ...config, filepath: OUTPUT_PATH }),
  );
  console.log(JSON.stringify(report, null, 2));
  console.log(`MATCHUP_SCHEMA_NAME ${MATCHUP_SCHEMA_NAME}`);
}

if (import.meta.main) {
  await main();
}
