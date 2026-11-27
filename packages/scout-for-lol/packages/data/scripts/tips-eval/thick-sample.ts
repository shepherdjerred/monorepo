// The sample for thick tip sets: one generator writes 20 units (the most- and
// least-played matchups and general sets in Mid) with the 3 to 20 (matchup) and
// 3 to 15 (general) tip counts; the pipeline validates, retries once and judges
// them with Sonnet (medium, batch) and the Decisions API. Nothing is written
// under src/tips/generated; the result is
// .tips-eval/thick-sample.<generator>.json, which thick-report.ts
// reads.
//
//   thick-sample.ts --max-cost-usd 5 [--popular 5] [--niche 5]
//                   [--generator claude-sonnet-5-5] [--judge claude-sonnet-5-5]

import { parseArgs } from "node:util";
import { format, resolveConfig } from "prettier";
import { currentLanePriors } from "#src/lane-priors/current.ts";
import { GenerationBudget } from "#src/tips/model.ts";
import { planTips } from "#src/tips/plan.ts";
import { lanePriorTipPlanSource } from "#src/tips/plan-sources.ts";
import { ALL_TIPS, type TipKind, selectWork } from "#src/tips/select.ts";
import { EVAL_RAW_DIRECTORY } from "#src/tips/eval/raw-directory.ts";
import { type PipelineUnit, runPipeline } from "../sample/pipeline.ts";

const outputPath = (generator: string): string =>
  `${EVAL_RAW_DIRECTORY}/thick-sample.${generator}.json`;
const LANE = "middle";

type SampleUnit = PipelineUnit & {
  popularity: "popular" | "niche";
  games: number;
};

/** Popular units are the most played in the lane; niche ones are the least played the plan still includes. */
function pickUnits(
  popularCount: number,
  nicheCount: number,
): readonly SampleUnit[] {
  const source = lanePriorTipPlanSource(currentLanePriors);
  const plan = planTips(source);
  const work = selectWork(plan, source, {
    ...ALL_TIPS,
    lane: LANE,
    kinds: new Set<TipKind>(["matchup", "general"]),
  });
  const matchups = work.matchups.filter((unit) => unit.games > 0);
  const generals = work.general.toSorted(
    (left, right) => right.games - left.games,
  );
  const picks = <T>(list: readonly T[]): [T[], T[]] => [
    list.slice(0, popularCount),
    list.slice(-nicheCount),
  ];
  const units = (
    popularity: "popular" | "niche",
    list: readonly { games: number; ids: PipelineUnit["championIds"] }[],
  ): SampleUnit[] =>
    list.map((entry) => ({
      lane: LANE,
      championIds: entry.ids,
      popularity,
      games: entry.games,
    }));
  const asMatchup = (unit: (typeof matchups)[number]) => ({
    games: unit.games,
    ids: [unit.championIds[0], unit.championIds[1]],
  });
  const asGeneral = (entry: (typeof generals)[number]) => ({
    games: entry.games,
    ids: [entry.championId],
  });
  const [popularMatchups, nicheMatchups] = picks(matchups.map(asMatchup));
  const [popularGenerals, nicheGenerals] = picks(generals.map(asGeneral));
  return [
    ...units("popular", popularMatchups),
    ...units("niche", nicheMatchups),
    ...units("popular", popularGenerals),
    ...units("niche", nicheGenerals),
  ];
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "max-cost-usd": { type: "string" },
      popular: { type: "string", default: "5" },
      niche: { type: "string", default: "5" },
      generator: { type: "string", default: "claude-sonnet-5-5" },
      judge: { type: "string", default: "claude-sonnet-5-5" },
    },
    strict: true,
  });
  const units = pickUnits(Number(values.popular), Number(values.niche));
  const result = await runPipeline({
    units,
    generator: values.generator,
    judge: values.judge,
    budget: new GenerationBudget(Number(values["max-cost-usd"])),
    maxTokens: { matchup: 14_000, general: 10_000 },
    log: (line) => {
      console.log(line);
    },
  });
  const report = {
    generatedAt: new Date().toISOString(),
    promptVersion: result.promptVersion,
    generator: result.generator,
    judge: result.judge,
    generation: result.generation,
    retried: result.retried,
    sonnet: result.sonnet,
    decisions: result.decisions,
    units: result.outcomes.map((outcome) => {
      const sample = units.find(
        (unit) =>
          unit.championIds.join() ===
          outcome.groundings.map((grounding) => grounding.championId).join(),
      );
      return {
        kind: outcome.groundings.length === 2 ? "matchup" : "general",
        popularity: sample?.popularity ?? "niche",
        games: sample?.games ?? 0,
        champions: outcome.groundings.map((grounding) => grounding.name),
        passed: outcome.passed,
        passedFirst: outcome.passedFirst,
        issues: outcome.issues.slice(0, 6),
        retryIssues: outcome.retryIssues.slice(0, 6),
        sets: outcome.sets?.map((set) => ({
          champion: set.subject.name,
          opponent: set.opponent?.name,
          tips: set.tips.map((tip) => tip.text),
        })),
        sonnet: outcome.sonnet,
        decisions: outcome.decisions,
        generationCostUsd: outcome.generationCostUsd,
        outputTokens: outcome.outputTokens,
      };
    }),
    spentUsd: result.spentUsd,
  };
  const path = outputPath(values.generator);
  const config = await resolveConfig(path);
  await Bun.write(
    path,
    await format(JSON.stringify(report), { ...config, filepath: path }),
  );
  console.log(
    `wrote ${path}; spent $${report.spentUsd.toFixed(4)} (generation $${report.generation.costUsd.toFixed(4)}, sonnet $${report.sonnet.costUsd.toFixed(4)}, decisions $${report.decisions.costUsd.toFixed(4)})`,
  );
}

if (import.meta.main) {
  await main();
}
