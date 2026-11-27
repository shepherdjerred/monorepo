// The multi-pass tip pipeline, batch and cache throughout:
//   1 generate (tips-4, with the retry)       4 escalate: Sonnet medium, lookup, web search
//   2 fill passes (more distinct, true tips)  5 repair (rewrite once, re-triage, else drop)
//   3 triage: Decisions API on every tip      6 combos, tricks, rotations, terrain (beside 2-5)
// Pass 1 can come from an earlier review set, so tip ids (and Jerred's marks on
// them) carry over; units without tips there are generated.
//
//   pipeline/run.ts --max-cost-usd 9 [--max-searches 60] [--generator claude-sonnet-5-5]
//                   [--review-set <file>] [--out <file>] [--plan]
//
// Search results are never stored: only the URLs a search returned are kept, in
// a tip's history.

import { parseArgs } from "node:util";
import { mkdir } from "node:fs/promises";
import { createTipBatchClient, SearchLimit } from "../tips-batch.ts";
import { currentLanePriors } from "#src/lane-priors/current.ts";
import { GenerationBudget } from "#src/tips/model.ts";
import { loadAbilityNameIndex } from "#src/tips/grounding.ts";
import { TIP_PROMPT_VERSION } from "#src/tips/prompt.ts";
import { createTipStore } from "#src/tips/store.ts";
import { createWikiClient } from "#src/tips/wiki.ts";
import { planTips } from "#src/tips/plan.ts";
import { lanePriorTipPlanSource } from "#src/tips/plan-sources.ts";
import { createTipDecisions } from "../decisions/client.ts";
import { select } from "../sample/review-set.ts";
import { escalateCombos, generateCombos, referenceCombos } from "./combos.ts";
import { generatePass } from "./generate.ts";
import { MARKS_PATH, agreementWithMarks, readMarks } from "./marks.ts";
import { tipPasses } from "./passes.ts";
import { Ledger, type Context, type UnitState } from "./state.ts";
import { THRESHOLDS } from "./triage.ts";
import { loadUnit, modelShort, readReviewSet } from "./units.ts";
import { serialize } from "./output.ts";

const DIRECTORY = "/Users/jerred/.local/share/scout-redesign/tips-review";
const GENERATED_DIRECTORY = `${import.meta.dir}/../../src/tips/generated`;
const WIKI_CACHE_DIRECTORY = `${import.meta.dir}/../../.tips-cache/wiki`;

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "max-cost-usd": { type: "string" },
      "max-searches": { type: "string", default: "60" },
      "searches-per-tip": { type: "string", default: "2" },
      "search-tool": { type: "string", default: "web_search_20260209" },
      generator: { type: "string", default: "claude-sonnet-5-5" },
      judge: { type: "string", default: "claude-sonnet-5-5" },
      "review-set": { type: "string", default: `${DIRECTORY}/review-set.json` },
      out: { type: "string", default: `${DIRECTORY}/review-set-v2.json` },
      marks: { type: "string", default: MARKS_PATH },
      lo: { type: "string" },
      hi: { type: "string" },
      "max-fill": { type: "string", default: "3" },
      limit: { type: "string" },
      plan: { type: "boolean", default: false },
    },
    strict: true,
  });
  const all = select();
  const selection = {
    ...all,
    units:
      values.limit === undefined
        ? all.units
        : all.units.slice(0, Number(values.limit)),
  };
  console.log(selection.notes.join("\n"));
  console.log(`${selection.units.length.toString()} units`);
  if (values.plan) {
    return;
  }
  const log = (line: string): void => {
    console.log(line);
  };
  const budget = new GenerationBudget(Number(values["max-cost-usd"]));
  const wiki = createWikiClient({ cacheDirectory: WIKI_CACHE_DIRECTORY });
  const glossary = await createTipStore({
    directory: GENERATED_DIRECTORY,
  }).glossary();
  const abilityIndex = await loadAbilityNameIndex();
  const ctx: Context = {
    client: createTipBatchClient(),
    budget,
    searches: new SearchLimit(Number(values["max-searches"])),
    wiki,
    glossary,
    abilityIndex,
    env: {
      model: {
        name: values.generator,
        pricing: { inputPerMTok: 0, outputPerMTok: 0 },
        generate: () => Promise.reject(new Error("unused")),
      },
      promptVersion: TIP_PROMPT_VERSION,
      abilityIndex,
      glossary,
      maxOutputTokens: 4500,
    },
    generator: values.generator,
    judge: values.judge,
    searchTool: values["search-tool"],
    searchesPerTip: Number(values["searches-per-tip"]),
    decisions: createTipDecisions(),
    thresholds: {
      lo: values.lo === undefined ? THRESHOLDS.lo : Number(values.lo),
      hi: values.hi === undefined ? THRESHOLDS.hi : Number(values.hi),
    },
    maxFillPasses: Number(values["max-fill"]),
    ledger: new Ledger(),
    log,
  };

  const earlier = await readReviewSet(values["review-set"], values.generator);
  const units: UnitState[] = [];
  for (const unit of selection.units) {
    units.push(
      await loadUnit({
        wiki,
        lane: unit.lane,
        championIds: unit.championIds,
        model: values.generator,
        earlier,
      }),
    );
  }
  log(
    `${units.filter((unit) => unit.origin === "review-set").length.toString()} units start from the review set, ${units.filter((unit) => unit.origin !== "review-set").length.toString()} are generated`,
  );

  await generatePass(ctx, units);
  const working = units.filter((unit) => unit.origin !== "failed");
  const failed = units
    .filter((unit) => unit.origin === "failed")
    .map((unit) => unit.id);
  log(
    `${working.length.toString()} units have first tips; failed: ${failed.join(", ") || "none"}`,
  );

  await Promise.all([
    tipPasses(ctx, working),
    (async () => {
      await generateCombos(ctx, working);
      await escalateCombos(ctx, working);
    })(),
  ]);
  await referenceCombos(ctx, working);

  const marks = await readMarks(values.marks);
  await mkdir(values.out.slice(0, values.out.lastIndexOf("/")), {
    recursive: true,
  });
  const written = serialize(working, ctx.generator);
  await Bun.write(values.out, `${JSON.stringify(written, null, 2)}\n`);

  const plan = planTips(lanePriorTipPlanSource(currentLanePriors));
  const report = {
    generatedAt: new Date().toISOString(),
    generator: ctx.generator,
    judge: ctx.judge,
    thresholds: ctx.thresholds,
    unitsRun: working.length,
    failedUnits: failed,
    spendByPass: Object.fromEntries(ctx.ledger.spend),
    stats: Object.fromEntries(ctx.ledger.stats),
    jobs: Object.fromEntries(ctx.ledger.jobs),
    tipsPerSetAfterEachPass: ctx.ledger.counts,
    searchesUsed: ctx.searches.used,
    maxSearches: ctx.searches.max,
    spentUsd:
      budget.spentUsd +
      [...ctx.ledger.spend.entries()]
        .filter(([pass]) => pass === "triage" || pass === "retriage")
        .reduce((sum, [, spend]) => sum + spend.usd, 0),
    plan: { pairs: plan.counts.units, general: plan.counts.championLanes },
    marks: {
      file: values.marks,
      count: marks.length,
      agreement: agreementWithMarks(working, marks),
    },
    shortModel: modelShort(ctx.generator),
  };
  await Bun.write(
    values.out.replace(/\.json$/u, ".report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report, null, 2));
  console.log(`wrote ${values.out}`);
}

if (import.meta.main) {
  await main();
}
