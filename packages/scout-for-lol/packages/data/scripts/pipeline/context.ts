// The shared context of a pipeline run: clients, budget, search allowance,
// thresholds and the ledger.

import { loadAbilityNameIndex } from "#src/tips/grounding.ts";
import { GenerationBudget } from "#src/tips/model.ts";
import { TIP_PROMPT_VERSION } from "#src/tips/prompt.ts";
import { createTipStore } from "#src/tips/store.ts";
import { createWikiClient } from "#src/tips/wiki.ts";
import { createTipDecisions } from "../decisions/client.ts";
import { SearchLimit, createTipBatchClient } from "../tips-batch.ts";
import { Ledger, type Context, type Thresholds } from "./state.ts";
import { THRESHOLDS } from "./triage.ts";

const GENERATED_DIRECTORY = `${import.meta.dir}/../../src/tips/generated`;
const WIKI_CACHE_DIRECTORY = `${import.meta.dir}/../../.tips-cache/wiki`;

export async function createContext(options: {
  maxCostUsd: number;
  maxSearches: number;
  searchesPerTip?: number;
  searchTool?: string;
  generator?: string;
  judge?: string;
  thresholds?: Partial<Thresholds>;
  maxFillPasses?: number;
}): Promise<Context> {
  const generator = options.generator ?? "claude-sonnet-5-5";
  const glossary = await createTipStore({
    directory: GENERATED_DIRECTORY,
  }).glossary();
  const abilityIndex = await loadAbilityNameIndex();
  return {
    client: createTipBatchClient(),
    budget: new GenerationBudget(options.maxCostUsd),
    searches: new SearchLimit(options.maxSearches),
    wiki: createWikiClient({ cacheDirectory: WIKI_CACHE_DIRECTORY }),
    glossary,
    abilityIndex,
    env: {
      model: {
        name: generator,
        pricing: { inputPerMTok: 0, outputPerMTok: 0 },
        generate: () => Promise.reject(new Error("unused")),
      },
      promptVersion: TIP_PROMPT_VERSION,
      abilityIndex,
      glossary,
      maxOutputTokens: 4500,
    },
    generator,
    judge: options.judge ?? generator,
    searchTool: options.searchTool ?? "web_search_20260209",
    searchesPerTip: options.searchesPerTip ?? 2,
    decisions: createTipDecisions(),
    thresholds: { ...THRESHOLDS, ...options.thresholds },
    maxFillPasses: options.maxFillPasses ?? 3,
    ledger: new Ledger(),
    log: (line) => {
      console.log(line);
    },
  };
}

export { GenerationBudget };
