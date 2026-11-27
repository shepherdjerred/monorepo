// Build eval-filter.md: how well Sonnet works as a filter against the two
// reference judges, what the Message Batches API and prompt caching saved on
// the real sample, and what a full run and a patch cost with each generator
// and the Sonnet filter in the loop.
//
//   eval-filter.ts            (reads the committed reports, the Sonnet verdicts
//                              and the batch sample; writes src/tips/eval/eval-filter.md)

import { format, resolveConfig } from "prettier";
import { z } from "zod";
import {
  type FilterEvaluation,
  cacheBehavior,
  evaluateFilter,
} from "#src/tips/eval/filter.ts";
import { type Projection, project } from "#src/tips/eval/projection.ts";
import {
  REJUDGE_PATH,
  RejudgeFileSchema,
  readReports,
} from "#src/tips/eval/rejudge.ts";
import { EVAL_MODELS, EVAL_RUNS } from "#src/tips/eval/report.ts";
import {
  PATCH_CHAMPIONS,
  multipliersFor,
  planFigures,
} from "./projection-inputs.ts";
import { EVAL_RAW_DIRECTORY } from "#src/tips/eval/raw-directory.ts";
import { tipModelPricing } from "../tips-model.ts";

const EVAL_DIRECTORY = `${import.meta.dir}/../../src/tips/eval`;
const SAMPLE_PATH = `${EVAL_RAW_DIRECTORY}/batch-sample.json`;
const OUTPUT_PATH = `${EVAL_DIRECTORY}/eval-filter.md`;

const StageSchema = z.object({
  model: z.string(),
  jobs: z.number().int(),
  failed: z.number().int(),
  rounds: z.number().int(),
  toolCalls: z.number().int(),
  inputTokens: z.number().int(),
  cacheReadTokens: z.number().int(),
  cacheWriteTokens: z.number().int(),
  outputTokens: z.number().int(),
  cacheReadShare: z.number(),
  costUsd: z.number(),
  listUsd: z.number(),
  totalSavings: z.number(),
  cacheSavingsOnBatch: z.number(),
  seconds: z.number(),
});
const SampleSchema = z.object({
  anchor: z.string(),
  cacheTtl: z.string(),
  units: z.number().int(),
  acceptedUnits: z.number().int(),
  generation: StageSchema,
  judging: StageSchema,
  spentUsd: z.number(),
});

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
const usd = (value: number): string =>
  value < 10 ? `$${value.toFixed(2)}` : `$${value.toFixed(0)}`;

function accuracyTable(evaluations: readonly FilterEvaluation[]): string[] {
  const header =
    "| Filter | Generator | Tips | Both refs wrong | Caught | Recall | False drops | False-drop rate | Dropped share | Shipped wrong | Own wrong | Own useful |";
  const rows = evaluations.flatMap((evaluation) =>
    [
      ["all three", evaluation.overall] as const,
      ...Object.entries(evaluation.byModel),
    ].map(
      ([label, measure]) =>
        `| ${evaluation.variant} | ${label} | ${measure.tips.toString()} | ${measure.bothWrong.toString()} | ${measure.caught.toString()} | ${pct(measure.recall)} | ${measure.falseDrops.toString()} of ${measure.bothCorrect.toString()} | ${pct(measure.falseDropRate)} | ${pct(measure.droppedShare)} | ${pct(measure.shippedWrongRate)} (was ${pct(measure.unfilteredWrongRate)}) | ${pct(measure.variantWrongRate)} | ${pct(measure.variantUsefulRate)} |`,
    ),
  );
  return [
    header,
    `| ${Array.from({ length: 12 }, () => "---").join(" | ")} |`,
    ...rows,
  ];
}

function projectionTable(projections: readonly Projection[]): string[] {
  const header =
    "| Generator + filter | Full run | of which generation / filter | Typical patch | Shipped wrong | Dropped share | False-drop rate | Under $100 |";
  const rows = projections.map(
    (p) =>
      `| ${p.generator} + ${p.filter} | ${usd(p.fullRunUsd)} | ${usd(p.generationFullUsd)} / ${usd(p.filterFullUsd)} | ${usd(p.patchUsd)} | ${pct(p.shippedWrongRate)} (was ${pct(p.unfilteredWrongRate)}) | ${pct(p.droppedShare)} | ${pct(p.falseDropRate)} | ${p.fitsUnder100 ? "yes" : "no"} |`,
  );
  return [
    header,
    `| ${Array.from({ length: 8 }, () => "---").join(" | ")} |`,
    ...rows,
  ];
}

async function main(): Promise<void> {
  const reports = await readReports(EVAL_MODELS, EVAL_RUNS);
  const rejudge = RejudgeFileSchema.parse(await Bun.file(REJUDGE_PATH).json());
  const sample = SampleSchema.parse(await Bun.file(SAMPLE_PATH).json());
  const ttl = sample.cacheTtl === "5m" ? "5m" : "1h";
  const multipliers = multipliersFor("claude-sonnet-5-5", ttl);
  const figures = planFigures();
  const evaluations = rejudge.variants.map((variant) =>
    evaluateFilter(reports, variant),
  );

  const projections: Projection[] = [];
  for (const variant of rejudge.variants) {
    const evaluation = evaluations.find(
      (entry) => entry.variant === variant.name,
    );
    if (evaluation === undefined) {
      continue;
    }
    for (const model of EVAL_MODELS) {
      projections.push(
        project({
          reports: reports.filter((report) => report.model === model),
          generatorPricing: tipModelPricing(model),
          filter: variant,
          judgePricing: tipModelPricing(variant.model),
          filterEvaluation: evaluation,
          generationSample: sample.generation,
          judgingSample: sample.judging,
          multipliers,
          shape: figures.shape,
          fullPlan: figures.reuse,
        }),
      );
    }
  }

  const stageLine = (
    name: string,
    stage: z.infer<typeof StageSchema>,
  ): string =>
    `| ${name} | ${stage.model} | ${stage.jobs.toString()} (${stage.failed.toString()} failed) | ${stage.toolCalls.toString()} | ${pct(stage.cacheReadShare)} | ${usd(stage.listUsd)} | ${usd(stage.costUsd)} | ${pct(stage.totalSavings)} | ${pct(stage.cacheSavingsOnBatch)} | ${stage.seconds.toString()}s |`;
  const genBehavior = cacheBehavior(sample.generation);
  const judgeBehavior = cacheBehavior(sample.judging);

  const markdown = [
    "# Sonnet as a filter",
    "",
    `Every tip the three generators wrote in the eval (both runs each) was re-judged by Sonnet with the same grounding and lookup tool, as batches and without regenerating anything, then compared with what the two reference judges (Opus and GPT) said. "Both refs wrong" are the tips the filter should catch; a "false drop" is a tip the filter calls wrong that both references call correct. Variants: ${rejudge.variants.map((variant) => `${variant.name} (${variant.jobs.toString()} units, ${usd(variant.costUsd)} at the batch price, ${usd(variant.listUsd)} at the standard price)`).join("; ")}.`,
    "",
    ...accuracyTable(evaluations),
    "",
    "## Measured batch and cache savings",
    "",
    `One real batch: the ${sample.units.toString()} most-played ${sample.anchor} matchups in Mid, generated with Haiku and the ${sample.acceptedUnits.toString()} accepted ones judged with Sonnet, each prompt leading with ${sample.anchor}'s block as a ${sample.cacheTtl} cache breakpoint. "Standard" is the same tokens at the list price with nothing cached; "cache alone" is the saving against half that (the batch price with no cache).`,
    "",
    "| Stage | Model | Jobs | Lookups | Prompt tokens read from cache | Standard price | Actual | Saved in total | Saved by cache alone | Wall time |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    stageLine("generation", sample.generation),
    stageLine("judging", sample.judging),
    "",
    `Cache behavior that feeds the projection: generation prefix share ${pct(genBehavior.prefixShare)} of the prompt, hit rate ${pct(genBehavior.hitRate)}; judging prefix share ${pct(judgeBehavior.prefixShare)}, hit rate ${pct(judgeBehavior.hitRate)}. Price multipliers (from the catalog): batch ${multipliers.batch.toString()}, cache read ${multipliers.cacheRead.toString()} of input, ${ttl} cache write ${multipliers.cacheWrite.toString()} of input.`,
    "",
    "## Projection",
    "",
    `Full run: ${figures.shape.matchupUnits.toString()} pairs and ${figures.shape.generalSets.toString()} general sets, ${figures.reuse.anchors.toString()} distinct leading champions, so each prefix is shared by ${(figures.reuse.units / figures.reuse.anchors).toFixed(1)} units on average. Typical patch: ${PATCH_CHAMPIONS.toString()} champions changed, every unit touching them regenerated and re-filtered. Tokens per unit are the eval's (generator) and the re-judge's (filter); both stages at the batch price with the measured cache hit rate. Shipped wrong is the share of kept tips that both reference judges call wrong.`,
    "",
    ...projectionTable(projections),
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
