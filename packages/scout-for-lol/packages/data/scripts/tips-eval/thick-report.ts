// Build thick-sample.md from thick-sample.generated.json: tips per set before
// and after filtering, sets that fall below the minimum, projected cost of a
// full run and of a patch for Haiku plus each judge, and four example sets.
//
//   thick-report.ts

import { format, resolveConfig } from "prettier";
import { z } from "zod";
import { cacheBehavior, inputFactor } from "#src/tips/eval/filter.ts";
import { GENERAL_TIPS_MIN, MATCHUP_TIPS_MIN } from "#src/tips/schema.ts";
import {
  PATCH_CHAMPIONS,
  multipliersFor,
  planFigures,
} from "./projection-inputs.ts";
import { EVAL_RAW_DIRECTORY } from "#src/tips/eval/raw-directory.ts";
import { tipModelPricing } from "../tips-model.ts";

const DIRECTORY = `${import.meta.dir}/../../src/tips/eval`;
const GENERATORS = ["claude-sonnet-5-5", "claude-opus-5-5"] as const;
const samplePath = (generator: string): string =>
  `${EVAL_RAW_DIRECTORY}/thick-sample.${generator}.json`;
const BATCH_SAMPLE_PATH = `${EVAL_RAW_DIRECTORY}/batch-sample.json`;
const OUTPUT_PATH = `${DIRECTORY}/thick-sample.md`;

const StageSchema = z.object({
  jobs: z.number(),
  failed: z.number(),
  inputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  outputTokens: z.number(),
  costUsd: z.number(),
  seconds: z.number(),
});
const ScoreSchema = z.object({
  pCorrect: z.number(),
  pWrong: z.number(),
  pNotCheckable: z.number(),
  pUseful: z.number(),
});
const SampleSchema = z.object({
  promptVersion: z.string(),
  retried: z.number(),
  generator: z.string(),
  judge: z.string(),
  generation: StageSchema,
  sonnet: StageSchema,
  decisions: z.object({
    units: z.number(),
    costUsd: z.number(),
    inputTokens: z.number(),
    cachedInputTokens: z.number(),
    seconds: z.number(),
    msPerUnit: z.array(z.number()),
  }),
  units: z.array(
    z.object({
      kind: z.enum(["matchup", "general"]),
      popularity: z.enum(["popular", "niche"]),
      games: z.number(),
      champions: z.array(z.string()),
      passed: z.boolean(),
      passedFirst: z.boolean(),
      retryIssues: z.array(z.string()),
      issues: z.array(z.string()),
      sets: z
        .array(
          z.object({
            champion: z.string(),
            opponent: z.string().optional(),
            tips: z.array(z.string()),
          }),
        )
        .optional(),
      sonnet: z
        .array(
          z.object({
            index: z.number(),
            correctness: z.enum(["correct", "wrong", "not-checkable"]),
            useful: z.boolean(),
            reason: z.string(),
          }),
        )
        .optional(),
      decisions: z.array(ScoreSchema).optional(),
      outputTokens: z.number().optional(),
      generationCostUsd: z.number().optional(),
    }),
  ),
  spentUsd: z.number(),
});
type Sample = z.infer<typeof SampleSchema>;
type Unit = Sample["units"][number];

const BatchSampleSchema = z.object({
  cacheTtl: z.string(),
  generation: z.object({
    jobs: z.number(),
    inputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheWriteTokens: z.number(),
  }),
  judging: z.object({
    jobs: z.number(),
    inputTokens: z.number(),
    cacheReadTokens: z.number(),
    cacheWriteTokens: z.number(),
  }),
});

const usd = (value: number): string =>
  value < 10 ? `$${value.toFixed(2)}` : `$${value.toFixed(0)}`;
const mean = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;

type Policy = {
  name: string;
  /** Which tips (flat index across the unit's sets) the policy drops. */
  drops: (unit: Unit, index: number) => boolean;
};

const POLICIES: readonly Policy[] = [
  {
    name: "Sonnet medium",
    drops: (unit, index) =>
      unit.sonnet?.find((verdict) => verdict.index === index)?.correctness ===
      "wrong",
  },
  {
    name: "Decisions, likeliest answer",
    drops: (unit, index) => {
      const score = unit.decisions?.[index];
      return (
        score !== undefined &&
        score.pWrong > score.pCorrect &&
        score.pWrong > score.pNotCheckable
      );
    },
  },
  {
    name: "Decisions, p(wrong) >= 0.3",
    drops: (unit, index) => (unit.decisions?.[index]?.pWrong ?? 0) >= 0.3,
  },
];

type SetCounts = {
  kind: Unit["kind"];
  popularity: Unit["popularity"];
  before: number;
  after: number;
};

function setCounts(units: readonly Unit[], policy: Policy): SetCounts[] {
  return units.flatMap((unit) => {
    let offset = 0;
    return (unit.sets ?? []).map((set) => {
      const kept = set.tips.filter(
        (_tip, position) => !policy.drops(unit, offset + position),
      ).length;
      offset += set.tips.length;
      return {
        kind: unit.kind,
        popularity: unit.popularity,
        before: set.tips.length,
        after: kept,
      };
    });
  });
}

function minimum(kind: Unit["kind"]): number {
  return kind === "matchup" ? MATCHUP_TIPS_MIN : GENERAL_TIPS_MIN;
}

function countsTable(sample: Sample): string[] {
  const accepted = sample.units.filter((unit) => unit.sets !== undefined);
  const lines = [
    "| Kind | Filter | Sets | Tips per set before (min / mean / max) | after | Sets below the minimum after filtering |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const kind of ["matchup", "general"] as const) {
    for (const policy of POLICIES) {
      const sets = setCounts(accepted, policy).filter(
        (entry) => entry.kind === kind,
      );
      const stat = (values: readonly number[]): string =>
        `${Math.min(...values).toString()} / ${mean(values).toFixed(1)} / ${Math.max(...values).toString()}`;
      const below = sets.filter((entry) => entry.after < minimum(kind)).length;
      lines.push(
        `| ${kind} | ${policy.name} | ${sets.length.toString()} | ${stat(sets.map((entry) => entry.before))} | ${stat(sets.map((entry) => entry.after))} | ${below.toString()} of ${sets.length.toString()} |`,
      );
    }
  }
  return lines;
}

type StageUnitCost = { inputUsd: number; outputUsd: number };

/** Standard-price input and output cost of one unit of each kind, from a stage's token totals. */
function perKind(
  stage: z.infer<typeof StageSchema>,
  units: readonly Unit[],
  pricing: { inputPerMTok: number; outputPerMTok: number },
  outputOf: (unit: Unit) => number,
): Record<Unit["kind"], StageUnitCost> {
  const inputTotal =
    stage.inputTokens + stage.cacheReadTokens + stage.cacheWriteTokens;
  // Input grows with the champion blocks in the prompt; output is measured per unit.
  const weight = (unit: Unit): number => unit.champions.length;
  const inputWeight = units.reduce((sum, unit) => sum + weight(unit), 0);
  const outputWeight = units.reduce((sum, unit) => sum + outputOf(unit), 0);
  const cost = (kind: Unit["kind"]): StageUnitCost => {
    const of = units.filter((unit) => unit.kind === kind);
    const inputShare = mean(of.map(weight)) / Math.max(1, inputWeight);
    const outputShare = mean(of.map(outputOf)) / Math.max(1, outputWeight);
    return {
      inputUsd: (inputTotal * inputShare * pricing.inputPerMTok) / 1_000_000,
      outputUsd:
        (stage.outputTokens * outputShare * pricing.outputPerMTok) / 1_000_000,
    };
  };
  return { matchup: cost("matchup"), general: cost("general") };
}

function exampleSection(unit: Unit | undefined, label: string): string[] {
  if (unit?.sets === undefined) {
    return [
      `### ${label}`,
      "",
      "No unit of this kind passed the validators.",
      "",
    ];
  }
  const lines = [
    `### ${label}: ${unit.champions.join(" vs ")} (${unit.games.toFixed(0)} games in the plan)`,
    "",
  ];
  let offset = 0;
  for (const set of unit.sets) {
    lines.push(
      `**${set.champion}${set.opponent === undefined ? " in Mid, general" : ` against ${set.opponent}`}** (${set.tips.length.toString()} tips)`,
      "",
    );
    for (const [position, tip] of set.tips.entries()) {
      const index = offset + position;
      const sonnet = unit.sonnet?.find((verdict) => verdict.index === index);
      const decision = unit.decisions?.[index];
      const marks = [
        sonnet?.correctness === "wrong" ? "Sonnet: wrong" : undefined,
        decision === undefined
          ? undefined
          : `p(wrong) ${decision.pWrong.toFixed(2)}`,
      ].filter((mark) => mark !== undefined);
      lines.push(
        `${(position + 1).toString()}. ${tip}${marks.length > 0 ? ` _(${marks.join("; ")})_` : ""}`,
      );
    }
    lines.push("");
    offset += set.tips.length;
  }
  return lines;
}

type Shared = {
  batch: z.infer<typeof BatchSampleSchema>;
  ttl: "5m" | "1h";
  figures: ReturnType<typeof planFigures>;
};

type Costs = {
  generator: string;
  /** [generation, filter] for each judge. */
  full: Record<"sonnet" | "decisions", [number, number]>;
  patch: Record<"sonnet" | "decisions", [number, number]>;
  pairs: { full: number; patch: number };
};

function analyze(
  sample: Sample,
  shared: Shared,
): { section: string[]; costs: Costs } {
  const { batch, ttl, figures } = shared;
  const accepted = sample.units.filter((unit) => unit.sets !== undefined);

  const generatorPricing = tipModelPricing(sample.generator);
  const sonnetPricing = tipModelPricing(sample.judge);
  const multipliers = multipliersFor(sample.judge, ttl);
  const haikuMultipliers = multipliersFor(sample.generator, ttl);

  const generation = perKind(
    sample.generation,
    sample.units,
    generatorPricing,
    (unit) => unit.outputTokens ?? 0,
  );
  const tipCount = (unit: Unit): number =>
    (unit.sets ?? []).reduce((sum, set) => sum + set.tips.length, 0);
  const sonnet = perKind(sample.sonnet, accepted, sonnetPricing, tipCount);

  const decisionPerUnit = sample.decisions.costUsd / sample.decisions.units;

  const generationFactor = (reuse: { units: number; anchors: number }) =>
    inputFactor(cacheBehavior(batch.generation), reuse, haikuMultipliers);
  const judgingFactor = (reuse: { units: number; anchors: number }) =>
    inputFactor(cacheBehavior(batch.judging), reuse, multipliers);

  const stage = (
    cost: Record<Unit["kind"], StageUnitCost>,
    counts: { matchup: number; general: number },
    factor: number,
    batchMultiplier: number,
  ): number =>
    (["matchup", "general"] as const).reduce(
      (sum, kind) =>
        sum +
        counts[kind] *
          (cost[kind].inputUsd * factor +
            cost[kind].outputUsd * batchMultiplier),
      0,
    );

  const full = {
    matchup: figures.shape.matchupUnits,
    general: figures.shape.generalSets,
  };
  const patch = {
    matchup: PATCH_CHAMPIONS * figures.shape.unitsPerChampion,
    general: PATCH_CHAMPIONS * figures.shape.generalPerChampion,
  };
  const reuseFull = figures.reuse;
  const reusePatch = {
    units: patch.matchup + patch.general,
    anchors: PATCH_CHAMPIONS,
  };
  const generationFull = stage(
    generation,
    full,
    generationFactor(reuseFull),
    haikuMultipliers.batch,
  );
  const generationPatch = stage(
    generation,
    patch,
    generationFactor(reusePatch),
    haikuMultipliers.batch,
  );
  const sonnetFull = stage(
    sonnet,
    full,
    judgingFactor(reuseFull),
    multipliers.batch,
  );
  const sonnetPatch = stage(
    sonnet,
    patch,
    judgingFactor(reusePatch),
    multipliers.batch,
  );
  const decisionsFull = decisionPerUnit * (full.matchup + full.general);
  const decisionsPatch = decisionPerUnit * (patch.matchup + patch.general);

  const first = (
    kind: Unit["kind"],
    popularity: Unit["popularity"],
  ): Unit | undefined =>
    accepted.find(
      (unit) => unit.kind === kind && unit.popularity === popularity,
    );
  const unitsOf = (kind: Unit["kind"], popularity: Unit["popularity"]) =>
    accepted.filter(
      (unit) => unit.kind === kind && unit.popularity === popularity,
    );
  // The example is the set with the most tips of its group, so the reader sees thick output.
  const richest = (kind: Unit["kind"], popularity: Unit["popularity"]) =>
    unitsOf(kind, popularity).toSorted(
      (a, b) => tipCount(b) - tipCount(a),
    )[0] ?? first(kind, popularity);

  const passRate = `${accepted.length.toString()} of ${sample.units.length.toString()}`;
  const failures = sample.units
    .filter((unit) => !unit.passed)
    .map(
      (unit) =>
        `- ${unit.kind} ${unit.champions.join(" vs ")}: ${unit.issues.slice(0, 3).join(" | ")}`,
    );
  const latencies = sample.decisions.msPerUnit;
  const section = [
    `## ${sample.generator}`,
    "",
    `${passRate} units passed the validators after the one retry (${sample.units.filter((unit) => unit.passedFirst).length.toString()} on the first answer; ${sample.retried.toString()} resubmitted)${failures.length > 0 ? "; still failing:" : "."}`,
    "",
    ...failures,
    "",
    `Spend: ${usd(sample.spentUsd)} in total; generation ${usd(sample.generation.costUsd)} (${sample.generation.seconds.toString()}s), Sonnet ${usd(sample.sonnet.costUsd)} (${sample.sonnet.seconds.toString()}s), Decisions ${usd(sample.decisions.costUsd)} (${sample.decisions.seconds.toString()}s, ${(mean(latencies) / 1000).toFixed(1)}s per request).`,
    "",
    "### Tips per set, before and after filtering",
    "",
    "A filter drops the tips its judge calls wrong. A set that ends with fewer tips than the minimum is hidden, like a stale one.",
    "",
    ...countsTable(sample),
    "",
    "### Example sets",
    "",
    "Marks show what each judge said about a tip; a tip marked wrong by the filter would be dropped.",
    "",
    ...exampleSection(richest("matchup", "popular"), "Matchup, popular"),
    ...exampleSection(richest("matchup", "niche"), "Matchup, niche"),
    ...exampleSection(richest("general", "popular"), "General, popular"),
    ...exampleSection(richest("general", "niche"), "General, niche"),
  ];
  const pair = (generation: number, filter: number): [number, number] => [
    generation,
    filter,
  ];
  return {
    section,
    costs: {
      generator: sample.generator,
      full: {
        sonnet: pair(generationFull, sonnetFull),
        decisions: pair(generationFull, decisionsFull),
      },
      patch: {
        sonnet: pair(generationPatch, sonnetPatch),
        decisions: pair(generationPatch, decisionsPatch),
      },
      pairs: {
        full: full.matchup + full.general,
        patch: patch.matchup + patch.general,
      },
    },
  };
}

async function main(): Promise<void> {
  const batch = BatchSampleSchema.parse(
    await Bun.file(BATCH_SAMPLE_PATH).json(),
  );
  const shared: Shared = {
    batch,
    ttl: batch.cacheTtl === "5m" ? "5m" : "1h",
    figures: planFigures(),
  };
  const samples = await Promise.all(
    GENERATORS.map(async (generator) =>
      SampleSchema.parse(await Bun.file(samplePath(generator)).json()),
    ),
  );
  const results = samples.map((sample) => analyze(sample, shared));
  const spent = samples.reduce((sum, sample) => sum + sample.spentUsd, 0);
  const costRows = (pick: "full" | "patch"): string[] =>
    results.flatMap(({ costs }) =>
      (
        [
          ["Sonnet medium", "sonnet"],
          ["Decisions", "decisions"],
        ] as const
      ).map(([name, key]) => {
        const [generation, filter] = costs[pick][key];
        return `| ${costs.generator} + ${name} | ${usd(generation + filter)} | ${usd(generation)} / ${usd(filter)} |`;
      }),
    );
  const markdown = [
    "# Thick tip sets: Sonnet and Opus on 20 units",
    "",
    `The same 20 units (10 matchups and 10 general sets in Mid; the most-played and the least-played the plan includes) written with prompt ${samples[0]?.promptVersion ?? ""} as one batch per generator, 3 to 20 tips per matchup side and 3 to 15 per general set. A unit that fails the validators is resubmitted once with the findings, as the interactive path does; a keyword cite the text does not contain is dropped rather than failing the unit. Every accepted unit is judged by Sonnet (medium, batch) and by the Decisions API; a filter drops the tips its judge calls wrong, and a set left under the minimum is hidden. Spend for the samples: ${usd(spent)}.`,
    "",
    "## Projected cost",
    "",
    `Over the ${shared.figures.shape.matchupUnits.toString()} pairs and ${shared.figures.shape.generalSets.toString()} general sets of the plan, at each sample's tokens per unit (input split by champion blocks, output by tips), the batch price and the cache hit rate measured on the one-champion batch. The Decisions API has no batch tier and free output, so it costs what the sample measured.`,
    "",
    "| Full run | Total | generation / filter |",
    "| --- | --- | --- |",
    ...costRows("full"),
    "",
    `A typical patch (${PATCH_CHAMPIONS.toString()} champions changed; every unit touching them regenerated and re-filtered):`,
    "",
    "| Per patch | Total | generation / filter |",
    "| --- | --- | --- |",
    ...costRows("patch"),
    "",
    ...results.flatMap(({ section }) => section),
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
