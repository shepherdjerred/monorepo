// Re-judge the tips the eval already generated (both runs of all three models)
// with Sonnet, as batches: the same grounding, the same lookup tool, no
// regeneration. Writes .tips-eval/sonnet-judge.json.
//
//   rejudge-tips.ts --max-cost-usd 12 [--variants medium,low] [--runs 1,2]
//                   [--judge claude-sonnet-5-5]

import { parseArgs } from "node:util";
import { format, resolveConfig } from "prettier";
import { getChampionIdByName } from "#src/model/riot/champion-registry.ts";
import {
  JUDGE_PROMPT_VERSION,
  JudgeDraftSchema,
  type TipVerdict,
  TipVerdictSchema,
  buildJudgePrompt,
} from "#src/tips/eval/judge.ts";
import {
  REJUDGE_PATH,
  type RejudgeFile,
  type RejudgedCase,
  readReports,
  reportKey,
} from "#src/tips/eval/rejudge.ts";
import { EVAL_MODELS } from "#src/tips/eval/report.ts";
import { loadChampionGrounding } from "#src/tips/grounding.ts";
import { GenerationBudget } from "#src/tips/model.ts";
import { mapPool } from "#src/tips/pool.ts";
import { knownSources } from "#src/tips/prompt.ts";
import {
  createWikiClient,
  lookupWikiPage,
  prefetchChampionWiki,
} from "#src/tips/wiki.ts";
import {
  type BatchJob,
  createTipBatchClient,
  runBatchJobs,
} from "../tips-batch.ts";

const WIKI_CACHE_DIRECTORY = `${import.meta.dir}/../../.tips-cache/wiki`;
const MAX_TOKENS = 3000;

async function groundingByName(name: string) {
  const id = getChampionIdByName(name);
  if (id === undefined) {
    throw new Error(
      `the report names a champion this registry does not know: ${name}`,
    );
  }
  return loadChampionGrounding(id);
}

type JobMeta = { report: string; caseIndex: number; tipCounts: number[] };

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "max-cost-usd": { type: "string" },
      variants: { type: "string", default: "medium,low" },
      runs: { type: "string", default: "1,2" },
      judge: { type: "string", default: "claude-sonnet-5-5" },
      chunk: { type: "string", default: "40" },
      concurrency: { type: "string", default: "2" },
      ttl: { type: "string", default: "5m" },
      out: { type: "string" },
    },
    strict: true,
  });
  const budget = new GenerationBudget(Number(values["max-cost-usd"]));
  const efforts = values.variants
    .split(",")
    .map((name) => name.trim())
    .map((name) => {
      if (name === "low" || name === "medium" || name === "high") {
        return name;
      }
      throw new Error(`unknown effort ${name}`);
    });
  const runs = values.runs.split(",").map((run) => Number(run));
  const reports = await readReports(EVAL_MODELS, runs);
  const client = createTipBatchClient();
  const wiki = createWikiClient({ cacheDirectory: WIKI_CACHE_DIRECTORY });
  const cache = {
    type: "ephemeral",
    ttl: values.ttl === "1h" ? "1h" : "5m",
  } as const;
  const chunkSize = Math.max(1, Math.floor(Number(values.chunk)));
  const chunkConcurrency = Math.max(1, Math.floor(Number(values.concurrency)));
  const outputPath = values.out ?? REJUDGE_PATH;

  // One job per accepted unit; a unit shares its grounding across reports and variants.
  const units = reports.flatMap((report) =>
    report.cases.flatMap((entry, caseIndex) =>
      entry.status === "dropped" ? [] : [{ report, entry, caseIndex }],
    ),
  );
  const prepared = await Promise.all(
    units.map(async ({ report, entry, caseIndex }) => {
      const sets = await Promise.all(
        entry.sets.map(async (set) => ({
          subject: await groundingByName(set.champion),
          opponent:
            set.opponent === undefined
              ? undefined
              : await groundingByName(set.opponent),
          tips: set.tips.map((tip) => tip.text),
        })),
      );
      const names = [
        ...new Set(
          sets.flatMap((set) => [
            set.subject.name,
            ...(set.opponent === undefined ? [] : [set.opponent.name]),
          ]),
        ),
      ];
      const pre = await prefetchChampionWiki(wiki, names);
      const notes = new Map(
        names.map((name, index) => [name, pre.notes[index] ?? ""] as const),
      );
      const meta: JobMeta = {
        report: reportKey(report),
        caseIndex,
        tipCounts: sets.map((set) => set.tips.length),
      };
      return {
        meta,
        key: `${entry.lane}:${entry.champions.join(":")}`,
        prompt: buildJudgePrompt(
          { lane: entry.lane, sets, notes },
          { shareAll: true },
        ),
      };
    }),
  );
  // Jobs of one unit sit together so its shared prefix is read from the cache.
  prepared.sort((left, right) =>
    left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
  );

  const file: RejudgeFile = {
    generatedAt: new Date().toISOString(),
    judgePromptVersion: JUDGE_PROMPT_VERSION,
    variants: [],
  };
  for (const effort of efforts) {
    const name = `${values.judge.replace(/^claude-/u, "").replace(/-5-5$/u, "")}-${effort}`;
    const jobs: BatchJob<{
      verdicts: {
        index: number;
        correctness: string;
        useful: boolean;
        plain: boolean;
        reason: string;
        sources: string[];
      }[];
    }>[] = prepared.map(({ prompt }, index) => ({
      id: `j${index.toString()}`,
      model: values.judge,
      system: prompt.system,
      prefix: prompt.prefix,
      rest: prompt.rest,
      schema: JudgeDraftSchema,
      effort,
      maxTokens: MAX_TOKENS,
      lookup: (title) => lookupWikiPage(wiki, title),
    }));
    console.log(`${name}: ${jobs.length.toString()} units`);
    // Chunks keep each submitted batch's worst case inside what is left of the
    // budget, and a few run at once to cut the wall time.
    const chunks: (typeof jobs)[] = [];
    for (let from = 0; from < jobs.length; from += chunkSize) {
      chunks.push(jobs.slice(from, from + chunkSize));
    }
    const results = (
      await mapPool(chunks, chunkConcurrency, (chunk, index) =>
        runBatchJobs(client, chunk, {
          budget,
          cache,
          log: (line) => {
            console.log(
              `${name} chunk ${(index + 1).toString()}/${chunks.length.toString()} ${line}`,
            );
          },
        }),
      )
    ).flat();
    const cases: RejudgedCase[] = [];
    let failed = 0;
    for (const [index, result] of results.entries()) {
      const item = prepared[index];
      if (item === undefined) {
        continue;
      }
      const total = item.meta.tipCounts.reduce((sum, count) => sum + count, 0);
      const draft =
        result.outcome.status === "ok" ? result.outcome.object : undefined;
      const lined =
        draft !== undefined &&
        draft.verdicts.length === total &&
        draft.verdicts.every((verdict, position) => verdict.index === position);
      if (draft === undefined || !lined) {
        failed += 1;
        continue;
      }
      let from = 0;
      const sets = item.meta.tipCounts.map((count) => {
        const slice = draft.verdicts
          .slice(from, from + count)
          .map((verdict): TipVerdict =>
            TipVerdictSchema.parse({
              correctness: verdict.correctness,
              useful: verdict.useful,
              plain: verdict.plain,
              reason:
                verdict.reason.trim() === ""
                  ? "no reason"
                  : verdict.reason.trim(),
              sources: knownSources(verdict.sources),
            }),
          );
        from += count;
        return slice;
      });
      cases.push({
        report: item.meta.report,
        case: item.meta.caseIndex,
        sets,
        costUsd: Math.round(result.costUsd * 1e6) / 1e6,
        toolCalls: result.toolCalls,
      });
    }
    const sum = (pick: (result: (typeof results)[number]) => number): number =>
      results.reduce((total, result) => total + pick(result), 0);
    file.variants.push({
      name,
      model: values.judge,
      effort,
      jobs: jobs.length,
      failed,
      rounds: sum((r) => r.rounds),
      toolCalls: sum((r) => r.toolCalls),
      tokens: {
        inputTokens: sum((r) => r.tokens.inputTokens),
        cacheReadTokens: sum((r) => r.tokens.cacheReadTokens),
        cacheWriteTokens: sum((r) => r.tokens.cacheWriteTokens),
        outputTokens: sum((r) => r.tokens.outputTokens),
      },
      costUsd: Math.round(sum((r) => r.costUsd) * 1e6) / 1e6,
      listUsd: Math.round(sum((r) => r.listUsd) * 1e6) / 1e6,
      cases,
    });
    console.log(
      `${name}: ${cases.length.toString()} judged, ${failed.toString()} failed, $${sum((r) => r.costUsd).toFixed(3)} (standard price $${sum((r) => r.listUsd).toFixed(3)}); budget spent $${budget.spentUsd.toFixed(3)}`,
    );
    const config = await resolveConfig(outputPath);
    await Bun.write(
      outputPath,
      await format(JSON.stringify(file), { ...config, filepath: outputPath }),
    );
  }
}

if (import.meta.main) {
  await main();
}
