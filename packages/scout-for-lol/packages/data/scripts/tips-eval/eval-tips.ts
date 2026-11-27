// Run the tip generator over the fixed eval cases, judge every generated unit
// with two judge models from different families, and write the committed report
// for the generator model and run. The generated tips under src/tips/generated/
// are read (for the glossary) but never written.
//
//   eval-tips.ts --max-cost-usd 8 [--model claude-haiku-5-5] [--run 1]
//                [--judge-models claude-opus-5-5,gpt-6.1-terra]
//                [--promptVersion tips-2]
//   eval-tips.ts --summary     rebuild eval-summary.md from the committed reports
//
// The generator and both judges read the League of Legends Wiki (ability notes
// up front, a `lookup` tool for anything else). The budget covers the generator
// and both judges together. A second run of the same model passes --run 2, which
// is mixed into every request key so the models are asked again. Credentials:
// see tips-model.ts (an Anthropic key and an OpenAI key).

import { parseArgs } from "node:util";
import { format, resolveConfig } from "prettier";
import { currentLanePriors } from "#src/lane-priors/current.ts";
import { runEval } from "#src/tips/eval/eval.ts";
import {
  EVAL_CASES_PATH,
  EVAL_MODELS,
  EVAL_RUNS,
  EVAL_SUMMARY_PATH,
  EvalCasesSchema,
  EvalReportSchema,
  evalReportPath,
} from "#src/tips/eval/report.ts";
import { type PlanShape, renderSummary } from "#src/tips/eval/summary.ts";
import { GenerationBudget, meteredModel } from "#src/tips/model.ts";
import { planTips } from "#src/tips/plan.ts";
import { lanePriorTipPlanSource } from "#src/tips/plan-sources.ts";
import { TIP_PROMPT_VERSION } from "#src/tips/prompt.ts";
import { createTipStore } from "#src/tips/store.ts";
import { createWikiClient } from "#src/tips/wiki.ts";
import { DEFAULT_TIP_MODEL, createLlmTipModel } from "../tips-model.ts";

const GENERATED_DIRECTORY = `${import.meta.dir}/../../src/tips/generated`;
const CACHE_DIRECTORY = `${import.meta.dir}/../../.tips-cache`;
const WIKI_CACHE_DIRECTORY = `${import.meta.dir}/../../.tips-cache/wiki`;
const MAX_OUTPUT_TOKENS = 4000;
/** One judge per model family: Anthropic's and the OpenAI model Explore's own judge uses. */
const DEFAULT_JUDGE_MODELS = "claude-opus-5-5,gpt-6.1-terra";
/** Champions a typical patch changes (Riot's balance patches touch 10 to 15). */
const PATCH_CHAMPIONS = 12;

async function writeFormatted(path: string, text: string): Promise<void> {
  const config = await resolveConfig(path);
  await Bun.write(path, await format(text, { ...config, filepath: path }));
}

function planShape(): PlanShape {
  const plan = planTips(lanePriorTipPlanSource(currentLanePriors));
  const champions = new Set([
    ...plan.units.flatMap((unit) => unit.championIds),
    ...plan.championLanes.map((entry) => entry.championId),
  ]);
  return {
    matchupUnits: plan.counts.units,
    generalSets: plan.counts.championLanes,
    unitsPerChampion: (2 * plan.counts.units) / champions.size,
    generalPerChampion: plan.counts.championLanes / champions.size,
    patchChampions: PATCH_CHAMPIONS,
  };
}

async function writeSummary(): Promise<void> {
  const reports = await Promise.all(
    EVAL_MODELS.flatMap((model) =>
      EVAL_RUNS.map(async (run) =>
        EvalReportSchema.parse(
          await Bun.file(evalReportPath(model, run)).json(),
        ),
      ),
    ),
  );
  await writeFormatted(EVAL_SUMMARY_PATH, renderSummary(reports, planShape()));
  console.log(await Bun.file(EVAL_SUMMARY_PATH).text());
}

function judgeEffort(value: string): "low" | "medium" | "high" {
  if (value === "low" || value === "medium" || value === "high") {
    return value;
  }
  throw new Error(`--judge-effort must be low, medium or high, not "${value}"`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      model: { type: "string", default: DEFAULT_TIP_MODEL },
      run: { type: "string", default: "1" },
      "judge-models": { type: "string", default: DEFAULT_JUDGE_MODELS },
      "judge-effort": { type: "string", default: "medium" },
      "max-cost-usd": { type: "string" },
      promptVersion: { type: "string", default: TIP_PROMPT_VERSION },
      concurrency: { type: "string", default: "4" },
      "no-cache": { type: "boolean", default: false },
      "no-wiki": { type: "boolean", default: false },
      summary: { type: "boolean", default: false },
    },
    strict: true,
  });
  if (values.summary) {
    await writeSummary();
    return;
  }
  const maxCostUsd = Number(values["max-cost-usd"]);
  if (!Number.isFinite(maxCostUsd) || maxCostUsd <= 0) {
    throw new Error("--max-cost-usd is required and must be positive");
  }
  const run = Math.floor(Number(values.run));
  if (!Number.isFinite(run) || run < 1) {
    throw new Error("--run must be a positive number");
  }
  const judgeNames = values["judge-models"]
    .split(",")
    .map((name) => name.trim());
  const [firstJudge, secondJudge, ...extraJudges] = judgeNames;
  if (
    firstJudge === undefined ||
    secondJudge === undefined ||
    extraJudges.length > 0
  ) {
    throw new Error(
      "--judge-models must name exactly two models, comma separated",
    );
  }
  const cases = EvalCasesSchema.parse(await Bun.file(EVAL_CASES_PATH).json());
  const glossary = await createTipStore({
    directory: GENERATED_DIRECTORY,
  }).glossary();
  const budget = new GenerationBudget(maxCostUsd);
  const cacheDirectory = values["no-cache"] ? undefined : CACHE_DIRECTORY;
  const salt = `run-${run.toString()}`;
  const metered = (model: ReturnType<typeof createLlmTipModel>) =>
    meteredModel({ model, budget, cacheDirectory, salt });
  const effort = judgeEffort(values["judge-effort"]);
  const judge = (name: string) => ({
    model: metered(createLlmTipModel(name, { reasoningEffort: effort })),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
  });
  const report = await runEval({
    model: metered(createLlmTipModel(values.model)),
    judges: [judge(firstJudge), judge(secondJudge)],
    wiki: values["no-wiki"]
      ? undefined
      : createWikiClient({ cacheDirectory: WIKI_CACHE_DIRECTORY }),
    promptVersion: values.promptVersion,
    run,
    cases,
    glossary,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    concurrency: Math.max(1, Math.floor(Number(values.concurrency))),
    now: new Date(),
    log: (line) => {
      console.log(line);
    },
  });
  await writeFormatted(
    evalReportPath(values.model, run),
    JSON.stringify(report),
  );
  console.log(
    JSON.stringify(
      {
        totals: report.totals,
        judges: report.judges,
        agreement: report.agreement,
        judgeToolCallsPerUnit: report.judgeToolCallsPerUnit,
      },
      null,
      2,
    ),
  );
  console.log(`budget: ${JSON.stringify(budget.summary())}`);
}

if (import.meta.main) {
  await main();
}
