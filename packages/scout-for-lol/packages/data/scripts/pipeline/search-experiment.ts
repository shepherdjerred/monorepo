// What web search adds. In the full run the model had the search tool in every
// escalation and repair pass and never used it (0 searches): it either settled
// the tip from the wiki notes and lookup or answered "not-checkable". This
// re-judges the tips that were left "not-checkable" after the search arm, this
// time requiring a search before that answer, and compares the verdicts. Only
// URLs are kept; search text is never written.
//
//   pipeline/search-experiment.ts --max-cost-usd 1.5 [--max-searches 40]
//                                 [--v2 <review-set-v2.json>] [--out <file>]

import { parseArgs } from "node:util";
import { z } from "zod";
import { loadAbilityNameIndex } from "#src/tips/grounding.ts";
import { GenerationBudget } from "#src/tips/model.ts";
import { TIP_PROMPT_VERSION } from "#src/tips/prompt.ts";
import { createTipStore } from "#src/tips/store.ts";
import { createWikiClient } from "#src/tips/wiki.ts";
import { createTipDecisions } from "../decisions/client.ts";
import { select } from "../sample/review-set.ts";
import { SearchLimit, createTipBatchClient } from "../tips-batch.ts";
import { escalate } from "./escalate.ts";
import { Ledger, type Context, type TipState } from "./state.ts";
import { THRESHOLDS } from "./triage.ts";
import { loadUnit } from "./units.ts";

const DIRECTORY = "/Users/jerred/.local/share/scout-redesign/tips-review";

const V2Schema = z.array(
  z.object({
    id: z.string(),
    lane: z.string(),
    kind: z.string(),
    champion: z.string(),
    opponent: z.string().optional(),
    tips: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
        history: z.array(z.object({ pass: z.string() }).loose()),
      }),
    ),
  }),
);

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      "max-cost-usd": { type: "string" },
      "max-searches": { type: "string", default: "40" },
      v2: { type: "string", default: `${DIRECTORY}/review-set-v2.json` },
      out: { type: "string", default: `${DIRECTORY}/search-experiment.json` },
    },
    strict: true,
  });
  const v2 = V2Schema.parse(await Bun.file(values.v2).json());
  // The tips the search arm left "not-checkable".
  const targets = new Map(
    v2.flatMap((set) =>
      set.tips.flatMap((tip) => {
        const last = tip.history
          .filter((entry) => entry.pass.startsWith("escalate"))
          .at(-1);
        return last?.["verdict"] === "not-checkable" &&
          last.pass === "escalate:search"
          ? [[tip.id, tip.text] as const]
          : [];
      }),
    ),
  );
  console.log(
    `${targets.size.toString()} tips were not-checkable after the search arm`,
  );

  const wiki = createWikiClient({
    cacheDirectory: `${import.meta.dir}/../../.tips-cache/wiki`,
  });
  const glossary = await createTipStore({
    directory: `${import.meta.dir}/../../src/tips/generated`,
  }).glossary();
  const abilityIndex = await loadAbilityNameIndex();
  const budget = new GenerationBudget(Number(values["max-cost-usd"]));
  const ctx: Context = {
    client: createTipBatchClient(),
    budget,
    searches: new SearchLimit(Number(values["max-searches"])),
    wiki,
    glossary,
    abilityIndex,
    env: {
      model: {
        name: "claude-sonnet-5-5",
        pricing: { inputPerMTok: 0, outputPerMTok: 0 },
        generate: () => Promise.reject(new Error("unused")),
      },
      promptVersion: TIP_PROMPT_VERSION,
      abilityIndex,
      glossary,
      maxOutputTokens: 4500,
    },
    generator: "claude-sonnet-5-5",
    judge: "claude-sonnet-5-5",
    searchTool: "web_search_20260209",
    searchesPerTip: 2,
    decisions: createTipDecisions(),
    thresholds: THRESHOLDS,
    maxFillPasses: 0,
    ledger: new Ledger(),
    log: (line) => {
      console.log(line);
    },
  };

  // Rebuild the units that hold those tips, each with only those tips.
  const earlier = v2.flatMap((set) => [
    {
      id: set.id,
      kind:
        set.kind === "general" ? ("general" as const) : ("matchup" as const),
      champion: set.champion,
      lane: set.lane,
      model: "claude-sonnet-5-5",
      tips: set.tips.filter((tip) => targets.has(tip.id)),
    },
  ]);
  const units = [];
  for (const unit of select().units) {
    const loaded = await loadUnit({
      wiki,
      lane: unit.lane,
      championIds: unit.championIds,
      model: "claude-sonnet-5-5",
      earlier,
      partial: true,
    });
    if (loaded.sets.some((set) => set.tips.length > 0)) {
      units.push(loaded);
    }
  }
  const before = new Map<string, string>();
  const selected = (tip: TipState): boolean => targets.has(tip.id);
  for (const tip of units.flatMap((unit) =>
    unit.sets.flatMap((set) => set.tips),
  )) {
    before.set(tip.id, "not-checkable");
  }
  const results = await escalate(ctx, units, {
    label: "search-experiment",
    search: true,
    forceSearch: true,
    select: selected,
  });

  const changed = results.filter((entry) => entry.verdict !== "not-checkable");
  const stats = ctx.ledger.stats.get("search-experiment") ?? {};
  const jobs = ctx.ledger.jobs.get("search-experiment");
  const spend = ctx.ledger.spend.get("search-experiment");
  const report = {
    tips: results.length,
    searchesUsed: ctx.searches.used,
    jobsWithSearch: jobs?.withSearch ?? 0,
    jobs: jobs?.jobs ?? 0,
    verdicts: stats,
    changedFromNotCheckable: changed.length,
    spendUsd: spend?.usd ?? 0,
    searchFeeUsd: spend?.searchUsd ?? 0,
    perTip: results.map((entry) => ({
      tipId: entry.tip.id,
      text: entry.tip.text,
      before: "not-checkable",
      after: entry.verdict,
      reason: entry.reason,
      urls: entry.tip.history.at(-1)?.["urls"] ?? [],
      sources: entry.tip.history.at(-1)?.["sources"] ?? [],
    })),
  };
  await Bun.write(values.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ...report, perTip: undefined }, null, 2));
  console.log(`wrote ${values.out}`);
}

if (import.meta.main) {
  await main();
}
