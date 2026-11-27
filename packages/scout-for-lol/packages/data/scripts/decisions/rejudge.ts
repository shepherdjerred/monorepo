// Re-judge the tips the eval already generated with the Decisions API judge
// (gpt-6-luna): the same units, the same grounding and wiki notes, no tool, no
// regeneration. Writes .tips-eval/decisions-judge.json.
//
//   decisions/rejudge.ts --max-cost-usd 2 [--concurrency 8]

import { parseArgs } from "node:util";
import { format, resolveConfig } from "prettier";
import { getChampionIdByName } from "#src/model/riot/champion-registry.ts";
import {
  DECISIONS_PATH,
  type DecisionCase,
  type DecisionsFile,
} from "#src/tips/eval/decisions.ts";
import { buildJudgePrompt } from "#src/tips/eval/judge.ts";
import { readReports, reportKey } from "#src/tips/eval/rejudge.ts";
import { EVAL_MODELS } from "#src/tips/eval/report.ts";
import { loadChampionGrounding } from "#src/tips/grounding.ts";
import { mapPool } from "#src/tips/pool.ts";
import { createWikiClient, prefetchChampionWiki } from "#src/tips/wiki.ts";
import {
  DECISION_MODEL,
  type DecisionTipInput,
  createTipDecisions,
} from "./client.ts";

const WIKI_CACHE_DIRECTORY = `${import.meta.dir}/../../.tips-cache/wiki`;

async function groundingByName(name: string) {
  const id = getChampionIdByName(name);
  if (id === undefined) {
    throw new Error(`the report names an unknown champion: ${name}`);
  }
  return loadChampionGrounding(id);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "max-cost-usd": { type: "string" },
      concurrency: { type: "string", default: "8" },
    },
    strict: true,
  });
  const maxCostUsd = Number(values["max-cost-usd"]);
  const concurrency = Math.max(1, Math.floor(Number(values.concurrency)));
  const reports = await readReports(EVAL_MODELS, [1, 2]);
  const wiki = createWikiClient({ cacheDirectory: WIKI_CACHE_DIRECTORY });
  const decisions = createTipDecisions();

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
      let index = 0;
      const tips: DecisionTipInput[] = sets.flatMap((set) =>
        set.tips.map((text) => {
          const tip = {
            index,
            text,
            subject: set.subject.name,
            opponent: set.opponent?.name,
          };
          index += 1;
          return tip;
        }),
      );
      return {
        report: reportKey(report),
        caseIndex,
        tipCounts: sets.map((set) => set.tips.length),
        tips,
        prompt: buildJudgePrompt(
          { lane: entry.lane, sets, notes },
          { shareAll: true },
        ),
      };
    }),
  );

  console.log(
    `${prepared.length.toString()} units, concurrency ${concurrency.toString()}`,
  );
  const started = Date.now();
  let spent = 0;
  const cases = await mapPool(
    prepared,
    concurrency,
    async (unit): Promise<DecisionCase> => {
      if (spent >= maxCostUsd) {
        throw new Error(`the $${maxCostUsd.toString()} budget is spent`);
      }
      const result = await decisions.judgeUnit(unit.prompt, unit.tips);
      spent += result.costUsd;
      let from = 0;
      const sets = unit.tipCounts.map((count) => {
        const slice = result.scores.slice(from, from + count);
        from += count;
        return slice;
      });
      return {
        report: unit.report,
        case: unit.caseIndex,
        sets,
        costUsd: result.costUsd,
        inputTokens: result.inputTokens,
        cachedInputTokens: result.cachedInputTokens,
        milliseconds: result.milliseconds,
      };
    },
  );
  const file: DecisionsFile = {
    generatedAt: new Date().toISOString(),
    model: DECISION_MODEL,
    concurrency,
    seconds: Math.round((Date.now() - started) / 1000),
    cases,
  };
  const config = await resolveConfig(DECISIONS_PATH);
  await Bun.write(
    DECISIONS_PATH,
    await format(JSON.stringify(file), { ...config, filepath: DECISIONS_PATH }),
  );
  console.log(
    `${cases.length.toString()} units judged in ${file.seconds.toString()}s for $${spent.toFixed(4)}`,
  );
}

if (import.meta.main) {
  await main();
}
