import type { Lane } from "#src/model/riot/lane.ts";
import {
  loadAbilityNameIndex,
  loadChampionGrounding,
} from "#src/tips/grounding.ts";
import {
  type UnitState,
  classifyGeneralUnit,
  classifyMatchupUnit,
} from "#src/tips/generate.ts";
import {
  type TipModelPricing,
  costUsd,
  tokenUpperBound,
} from "#src/tips/model.ts";
import { buildGeneralPrompt, buildMatchupPrompt } from "#src/tips/prompt.ts";
import type { SelectedWork } from "#src/tips/select.ts";
import type { TipStore } from "#src/tips/store.ts";
import { type WikiClient, prefetchChampionWiki } from "#src/tips/wiki.ts";

/**
 * What a run would do and roughly what it would cost, without calling a model.
 * Expected tokens are calibrated against the pilot (see the constants); the
 * ceiling is the worst case the budget reserves per call.
 */

/** Characters per input token, measured on the pilot and eval prompts (Haiku 5.5). */
export const CHARS_PER_TOKEN = 1.5;
/** Average output tokens per call measured on the pilot and eval, thinking included. */
export const EXPECTED_OUTPUT_TOKENS = { matchup: 1900, general: 850 };
/** Share of units that needed a second call on the pilot and eval (15 to 25%). */
export const EXPECTED_RETRY_SHARE = 0.2;

export type PlannedUnitCost = {
  kind: "matchup" | "general";
  lane: Lane;
  label: string;
  state: UnitState["state"];
  reason: string | undefined;
  inputTokens: number;
  expectedUsd: number;
  ceilingUsd: number;
};

export type WorkEstimate = {
  units: PlannedUnitCost[];
  counts: Record<UnitState["state"], number>;
  expectedUsd: number;
  ceilingUsd: number;
};

export async function estimateWork(input: {
  work: SelectedWork;
  store: TipStore;
  promptVersion: string;
  pricing: TipModelPricing;
  maxOutputTokens: number;
  /** When set, the prompts carry the wiki ability notes and edited pages are detected. */
  wiki?: WikiClient | undefined;
}): Promise<WorkEstimate> {
  const abilityIndex = await loadAbilityNameIndex();
  const context = {
    store: input.store,
    promptVersion: input.promptVersion,
    abilityIndex,
    wiki: input.wiki,
  };
  const glossary = await input.store.glossary();
  const units: PlannedUnitCost[] = [];

  const price = (
    kind: "matchup" | "general",
    system: string,
    prompt: string,
    state: UnitState["state"],
  ): Pick<PlannedUnitCost, "inputTokens" | "expectedUsd" | "ceilingUsd"> => {
    const inputTokens = Math.ceil(
      (system.length + prompt.length) / CHARS_PER_TOKEN,
    );
    if (state !== "generate") {
      return { inputTokens, expectedUsd: 0, ceilingUsd: 0 };
    }
    const first = costUsd(input.pricing, {
      input: inputTokens,
      output: EXPECTED_OUTPUT_TOKENS[kind],
    });
    // A retry resends the prompt and the rejected answer.
    const retry = costUsd(input.pricing, {
      input: inputTokens + EXPECTED_OUTPUT_TOKENS[kind],
      output: EXPECTED_OUTPUT_TOKENS[kind],
    });
    const worst = costUsd(input.pricing, {
      input: tokenUpperBound(system) + tokenUpperBound(prompt),
      output: input.maxOutputTokens,
    });
    return {
      inputTokens,
      expectedUsd: first + EXPECTED_RETRY_SHARE * retry,
      ceilingUsd: worst * 2,
    };
  };

  for (const entry of input.work.general) {
    const grounding = await loadChampionGrounding(entry.championId);
    const classified = await classifyGeneralUnit(context, entry);
    const prefetched =
      input.wiki === undefined
        ? undefined
        : await prefetchChampionWiki(input.wiki, [grounding.name]);
    const request = buildGeneralPrompt({
      lane: entry.lane,
      champion: grounding,
      glossary,
      notes: prefetched?.notes[0],
    });
    units.push({
      kind: "general",
      lane: entry.lane,
      label: `${grounding.name} ${entry.lane} general`,
      state: classified.state,
      reason: "reason" in classified ? classified.reason : undefined,
      ...price("general", request.system, request.prompt, classified.state),
    });
  }
  for (const unit of input.work.matchups) {
    const [first, second] = await Promise.all([
      loadChampionGrounding(unit.championIds[0]),
      loadChampionGrounding(unit.championIds[1]),
    ]);
    const classified = await classifyMatchupUnit(context, unit);
    const prefetched =
      input.wiki === undefined
        ? undefined
        : await prefetchChampionWiki(input.wiki, [first.name, second.name]);
    const [firstNotes, secondNotes] = prefetched?.notes ?? [];
    const request = buildMatchupPrompt({
      lane: unit.lane,
      first,
      second,
      glossary,
      notes:
        firstNotes === undefined || secondNotes === undefined
          ? undefined
          : [firstNotes, secondNotes],
    });
    units.push({
      kind: "matchup",
      lane: unit.lane,
      label: `${first.name} vs ${second.name} ${unit.lane}`,
      state: classified.state,
      reason: "reason" in classified ? classified.reason : undefined,
      ...price("matchup", request.system, request.prompt, classified.state),
    });
  }

  const counts: Record<UnitState["state"], number> = {
    current: 0,
    restamp: 0,
    generate: 0,
  };
  for (const unit of units) {
    counts[unit.state] += 1;
  }
  return {
    units,
    counts,
    expectedUsd: units.reduce((sum, unit) => sum + unit.expectedUsd, 0),
    ceilingUsd: units.reduce((sum, unit) => sum + unit.ceilingUsd, 0),
  };
}
