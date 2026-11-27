// Generate the tips under src/tips/generated/: matchup tips per ordered
// (champion, opponent, lane), general tips per (champion, lane), and the keyword
// glossary. One model call per unordered pair writes both directions.
//
//   generate-tips.ts --plan                      units and estimated cost, spends nothing
//   generate-tips.ts --max-cost-usd 5 --lane middle --limit 20 --kind matchup
//   generate-tips.ts --max-cost-usd 5 --only middle/Ahri --kind general
//   generate-tips.ts --max-cost-usd 5 --only middle/Ahri,Syndra
//
// Credentials: see tips-model.ts. A set that is current is skipped; a set
// whose facts changed but whose text still validates is re-stamped without a
// model call; a unit that still fails validation after one retry is dropped
// and reported, never written.

import { parseArgs } from "node:util";
import { format, resolveConfig } from "prettier";
import { currentLanePriors } from "#src/lane-priors/current.ts";
import { type GenerationReport, runGeneration } from "#src/tips/generate.ts";
import { estimateWork } from "#src/tips/estimate.ts";
import { GenerationBudget, meteredModel } from "#src/tips/model.ts";
import { planTips } from "#src/tips/plan.ts";
import { lanePriorTipPlanSource } from "#src/tips/plan-sources.ts";
import { TIP_PROMPT_VERSION } from "#src/tips/prompt.ts";
import {
  type TipKind,
  type TipSelection,
  parseTipSelector,
  resolveLane,
  selectWork,
} from "#src/tips/select.ts";
import { type FormatJson, createTipStore } from "#src/tips/store.ts";
import { createWikiClient } from "#src/tips/wiki.ts";
import type { Lane } from "#src/model/riot/lane.ts";
import {
  DEFAULT_TIP_MODEL,
  createLlmTipModel,
  offlineTipModel,
} from "./tips-model.ts";

const DEFAULT_GENERATED_DIRECTORY = `${import.meta.dir}/../src/tips/generated`;
const CACHE_DIRECTORY = `${import.meta.dir}/../.tips-cache`;
const WIKI_CACHE_DIRECTORY = `${import.meta.dir}/../.tips-cache/wiki`;
const MAX_OUTPUT_TOKENS = 14_000;
const DEFAULT_CONCURRENCY = 4;
const PLAN_LIST_LIMIT = 25;

export type GenerateArgs = {
  plan: boolean;
  model: string;
  maxCostUsd: number | undefined;
  promptVersion: string;
  selection: TipSelection;
  concurrency: number;
  list: boolean;
  noCache: boolean;
  /** Skip the League of Legends Wiki: no prefetched notes, no lookup tool. */
  noWiki: boolean;
  /** Where the tips are read and written; the committed directory by default. */
  directory: string;
};

function parseKinds(value: string | undefined): Set<TipKind> {
  if (value === undefined || value === "all") {
    return new Set<TipKind>(["matchup", "general"]);
  }
  if (value === "matchup" || value === "general") {
    return new Set<TipKind>([value]);
  }
  throw new Error(`--kind must be matchup, general or all, not "${value}"`);
}

function parsePositiveNumber(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number, not "${value}"`);
  }
  return parsed;
}

export function parseGenerateArgs(argv: readonly string[]): GenerateArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      plan: { type: "boolean", default: false },
      model: { type: "string", default: DEFAULT_TIP_MODEL },
      "max-cost-usd": { type: "string" },
      only: { type: "string", multiple: true },
      lane: { type: "string" },
      limit: { type: "string" },
      kind: { type: "string" },
      promptVersion: { type: "string", default: TIP_PROMPT_VERSION },
      concurrency: { type: "string", default: DEFAULT_CONCURRENCY.toString() },
      list: { type: "boolean", default: false },
      "no-cache": { type: "boolean", default: false },
      "no-wiki": { type: "boolean", default: false },
      directory: { type: "string", default: DEFAULT_GENERATED_DIRECTORY },
    },
    strict: true,
  });
  let lane: Lane | undefined;
  if (values.lane !== undefined) {
    lane = resolveLane(values.lane);
    if (lane === undefined) {
      throw new Error(`unknown lane "${values.lane}"`);
    }
  }
  const maxCostUsd =
    values["max-cost-usd"] === undefined
      ? undefined
      : parsePositiveNumber("--max-cost-usd", values["max-cost-usd"]);
  if (!values.plan && maxCostUsd === undefined) {
    throw new Error(
      "--max-cost-usd is required for a run that calls the model",
    );
  }
  return {
    plan: values.plan,
    model: values.model,
    maxCostUsd,
    promptVersion: values.promptVersion,
    selection: {
      lane,
      selectors: (values.only ?? []).map((text) => parseTipSelector(text)),
      limit:
        values.limit === undefined
          ? undefined
          : Math.floor(parsePositiveNumber("--limit", values.limit)),
      kinds: parseKinds(values.kind),
    },
    concurrency: Math.floor(
      parsePositiveNumber("--concurrency", values.concurrency),
    ),
    list: values.list,
    noCache: values["no-cache"],
    noWiki: values["no-wiki"],
    directory: values.directory,
  };
}

/** JSON files are formatted the way Prettier (and so the format check) wants them. */
const prettierJson =
  (directory: string): FormatJson =>
  async (path, value) => {
    const filepath = `${directory}/${path}`;
    const config = await resolveConfig(filepath);
    return format(JSON.stringify(value), {
      ...config,
      parser: "json",
      filepath,
    });
  };

function printReport(report: GenerationReport, budgetSummary: unknown): void {
  const lines = [
    "",
    `selected: ${report.selected.general.toString()} general, ${report.selected.matchups.toString()} matchup units`,
    `current (skipped): ${report.current.toString()}`,
    `re-stamped: ${report.restamped.toString()}`,
    `generated: ${report.generated.toString()} (${report.passedFirstAttempt.toString()} passed on the first answer)`,
    `dropped: ${report.dropped.length.toString()}`,
    `not started: ${report.notStarted.toString()}`,
  ];
  for (const unit of report.dropped) {
    lines.push(
      `  dropped ${unit.kind} ${unit.lane} ${unit.championIds.map((id) => id.toString()).join(" vs ")}`,
      ...unit.issues
        .slice(0, 4)
        .map((issue) => `    ${issue.code}: ${issue.message}`),
    );
  }
  if (report.stoppedByBudget !== undefined) {
    lines.push(`STOPPED: ${report.stoppedByBudget}`);
  }
  lines.push(`budget: ${JSON.stringify(budgetSummary)}`);
  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  const args = parseGenerateArgs(Bun.argv.slice(2));
  const source = lanePriorTipPlanSource(currentLanePriors);
  const plan = planTips(source);
  const work = selectWork(plan, source, args.selection);
  const wiki = args.noWiki
    ? undefined
    : createWikiClient({ cacheDirectory: WIKI_CACHE_DIRECTORY });
  const store = createTipStore({
    directory: args.directory,
    format: prettierJson(args.directory),
  });
  console.log(
    `plan source: ${plan.source}\nfull plan: ${plan.counts.championLanes.toString()} general sets, ${plan.counts.units.toString()} matchup units (${plan.counts.orderedSets.toString()} ordered sets)\nselected: ${work.general.length.toString()} general, ${work.matchups.length.toString()} matchup units; model ${args.model}, prompt ${args.promptVersion}`,
  );

  if (args.plan) {
    const estimate = await estimateWork({
      wiki,
      work,
      store,
      promptVersion: args.promptVersion,
      pricing: offlineTipModel(args.model).pricing,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    const shown = args.list
      ? estimate.units
      : estimate.units.slice(0, PLAN_LIST_LIMIT);
    for (const unit of shown) {
      console.log(
        `${unit.state.padEnd(8)} ${unit.label}${unit.reason === undefined ? "" : ` (${unit.reason})`}  ~$${unit.expectedUsd.toFixed(4)}`,
      );
    }
    if (shown.length < estimate.units.length) {
      console.log(
        `... ${(estimate.units.length - shown.length).toString()} more (--list prints all)`,
      );
    }
    console.log(
      `\nto generate: ${estimate.counts.generate.toString()}, re-stamp: ${estimate.counts.restamp.toString()}, current: ${estimate.counts.current.toString()}\nestimated cost: $${estimate.expectedUsd.toFixed(2)} (ceiling if every call retried at the output cap: $${estimate.ceilingUsd.toFixed(2)})`,
    );
    return;
  }

  if (args.maxCostUsd === undefined) {
    throw new Error("--max-cost-usd is required");
  }
  const budget = new GenerationBudget(args.maxCostUsd);
  const model = meteredModel({
    model: createLlmTipModel(args.model),
    budget,
    cacheDirectory: args.noCache ? undefined : CACHE_DIRECTORY,
  });
  const report = await runGeneration({
    wiki,
    store,
    model,
    promptVersion: args.promptVersion,
    work,
    concurrency: args.concurrency,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    log: (line) => {
      console.log(line);
    },
  });
  printReport(report, budget.summary());
  if (report.stoppedByBudget !== undefined) {
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
