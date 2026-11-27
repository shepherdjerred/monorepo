// Build eval-decisions.md: the Decisions API judge (gpt-6-luna) measured as a
// filter against the two reference judges, next to the Sonnet variants, with
// its cost per unit and latency.
//
//   judge-report.ts   (reads the committed reports, the Decisions verdicts and
//                        the Sonnet verdicts; writes src/tips/eval/eval-decisions.md)

import { format, resolveConfig } from "prettier";
import {
  DECISIONS_PATH,
  DecisionsFileSchema,
  latencyOf,
  variantFromDecisions,
} from "#src/tips/eval/decisions.ts";
import {
  type FilterEvaluation,
  evaluateFilter,
} from "#src/tips/eval/filter.ts";
import {
  REJUDGE_PATH,
  RejudgeFileSchema,
  readReports,
} from "#src/tips/eval/rejudge.ts";
import { EVAL_MODELS, EVAL_RUNS } from "#src/tips/eval/report.ts";

const OUTPUT_PATH = `${import.meta.dir}/../../src/tips/eval/eval-decisions.md`;
/** The thresholds on p(wrong) a tip is dropped at, besides "wrong is the likeliest answer". */
const THRESHOLDS = [0.5, 0.3, 0.2, 0.1] as const;

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

function row(label: string, evaluation: FilterEvaluation): string {
  const measure = evaluation.overall;
  return `| ${label} | ${measure.tips.toString()} | ${measure.bothWrong.toString()} | ${measure.caught.toString()} | ${pct(measure.recall)} | ${measure.falseDrops.toString()} of ${measure.bothCorrect.toString()} | ${pct(measure.falseDropRate)} | ${pct(measure.droppedShare)} | ${pct(measure.shippedWrongRate)} (was ${pct(measure.unfilteredWrongRate)}) | ${pct(measure.variantUsefulRate)} |`;
}

async function main(): Promise<void> {
  const reports = await readReports(EVAL_MODELS, EVAL_RUNS);
  const file = DecisionsFileSchema.parse(await Bun.file(DECISIONS_PATH).json());
  const rejudge = RejudgeFileSchema.parse(await Bun.file(REJUDGE_PATH).json());

  const decisionRows = [
    row(
      "Decisions, likeliest answer",
      evaluateFilter(
        reports,
        variantFromDecisions(file, { name: "decisions" }),
      ),
    ),
    ...THRESHOLDS.map((threshold) =>
      row(
        `Decisions, drop at p(wrong) >= ${threshold.toString()}`,
        evaluateFilter(
          reports,
          variantFromDecisions(file, {
            name: `decisions-${threshold.toString()}`,
            wrongThreshold: threshold,
          }),
        ),
      ),
    ),
  ];
  const sonnetRows = rejudge.variants.map((variant) =>
    row(variant.name, evaluateFilter(reports, variant)),
  );

  const units = file.cases.length;
  const costUsd = file.cases.reduce((sum, entry) => sum + entry.costUsd, 0);
  const input = file.cases.reduce((sum, entry) => sum + entry.inputTokens, 0);
  const cached = file.cases.reduce(
    (sum, entry) => sum + entry.cachedInputTokens,
    0,
  );
  const latency = latencyOf(file.cases);
  const sonnetBatch = rejudge.variants.map(
    (variant) =>
      `${variant.name}: $${(variant.costUsd / variant.jobs).toFixed(4)} per unit at the batch price`,
  );

  const markdown = [
    "# The Decisions API as a judge",
    "",
    `OpenAI's Decisions API (\`POST /v1/decisions\`, model ${file.model}) answers several bounded questions about one input and returns a probability for each answer. Each unit's prefetched grounding and wiki notes go in as the input, followed by its tips; every tip gets a correct / wrong / not checkable choice and a useful yes/no. It has no tool use, so it judges from the grounding alone. The same ${units.toString()} units (both runs of the three generators) were re-judged, with no regeneration, and measured against the two reference judges exactly as the Sonnet variants were: "both refs wrong" are the tips the filter should catch, a "false drop" is a tip it calls wrong that both references call correct.`,
    "",
    "| Filter | Tips | Both refs wrong | Caught | Recall | False drops | False-drop rate | Dropped share | Shipped wrong | Own useful |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...decisionRows,
    ...sonnetRows,
    "",
    "## Cost and latency",
    "",
    `Decisions: $${costUsd.toFixed(4)} for ${units.toString()} units ($${(costUsd / units).toFixed(5)} per unit; output tokens are free, ${pct(cached / Math.max(1, input))} of the ${input.toString()} input tokens were served from the cache). One request per unit, ${file.concurrency.toString()} in flight: ${file.seconds.toString()}s for the whole set; per request mean ${(latency.meanMs / 1000).toFixed(1)}s, p95 ${(latency.p95Ms / 1000).toFixed(1)}s, max ${(latency.maxMs / 1000).toFixed(1)}s. It answers synchronously, so a full run needs no batch wait.`,
    "",
    `Sonnet for comparison: ${sonnetBatch.join("; ")}; its batches take minutes to tens of minutes.`,
    "",
  ].join("\n");
  const config = await resolveConfig(OUTPUT_PATH);
  await Bun.write(
    OUTPUT_PATH,
    await format(markdown, { ...config, filepath: OUTPUT_PATH }),
  );
  console.log(await Bun.file(OUTPUT_PATH).text());
}

if (import.meta.main) {
  await main();
}
