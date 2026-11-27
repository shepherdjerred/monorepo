// The state the passes of the pipeline share: units, their sets, every tip and
// combo with its history, and a ledger of what each pass spent.

import type { BatchClient } from "@shepherdjerred/llm-runtime/batch";
import type { Lane } from "#src/model/riot/lane.ts";
import type { UnitEnvironment } from "#src/tips/check-draft.ts";
import type { Combo, ComboRef } from "#src/tips/combos/combo-schema.ts";
import type {
  AbilityNameIndex,
  ChampionGrounding,
} from "#src/tips/grounding.ts";
import type { GenerationBudget } from "#src/tips/model.ts";
import type { Cite, GlossaryEntry, GlossaryId } from "#src/tips/schema.ts";
import type { WikiClient } from "#src/tips/wiki.ts";
import type { createTipDecisions } from "../decisions/client.ts";
import type { SearchLimit } from "../tips-batch.ts";

export type Verdict = "correct" | "wrong" | "not-checkable";

/** One step in a tip's or combo's life; JSON-serialisable, never holds search text. */
export type History = { pass: string } & Record<string, unknown>;

export type TipState = {
  /** Stable: the unit id and the tip's index; a repaired tip keeps its id. */
  id: string;
  text: string;
  cites: Cite[];
  basis: string[];
  history: History[];
  decision?: { verdict: Verdict; pWrong: number } | undefined;
  escalation?: { verdict: Verdict; reason: string } | undefined;
  status: "live" | "dropped";
  droppedBecause?: string | undefined;
};

export type ComboState = {
  combo: Combo;
  history: History[];
  escalation?: { verdict: Verdict; reason: string } | undefined;
  status: "live" | "dropped";
  droppedBecause?: string | undefined;
};

export type ComboRefState = { ref: ComboRef; history: History[] };

export type SetState = {
  /** The unit id with `:forward` or `:reverse` for a pair. */
  id: string;
  subject: ChampionGrounding;
  opponent?: ChampionGrounding | undefined;
  side?: "forward" | "reverse" | undefined;
  tips: TipState[];
  /** The next index a new tip takes, so ids stay stable. */
  nextIndex: number;
  combos: ComboState[];
  comboRefs: ComboRefState[];
};

export type GlossaryDraft = {
  id: string;
  term: string;
  aliases: string[];
  definition: string;
};

export type UnitState = {
  id: string;
  lane: Lane;
  groundings: ChampionGrounding[];
  notes: string[];
  pages: Record<string, number>;
  sets: SetState[];
  glossary: GlossaryDraft[];
  /** Where the first pass's tips came from. */
  origin: "review-set" | "generated" | "failed";
};

export type Thresholds = { lo: number; hi: number };

export type Spend = { usd: number; searches: number; searchUsd: number };

/** What each pass spent, and tip counts after each. */
export class Ledger {
  readonly spend = new Map<string, Spend>();
  readonly counts: { pass: string; sets: Record<string, number> }[] = [];
  /** Batch jobs per pass: how many ran, looked a page up, searched, failed. */
  readonly jobs = new Map<
    string,
    {
      jobs: number;
      withLookup: number;
      lookups: number;
      withSearch: number;
      failed: number;
    }
  >();

  /** Free-form counters per pass (tips added, dropped as duplicates, and so on). */
  readonly stats = new Map<string, Record<string, number>>();

  bump(pass: string, key: string, by = 1): void {
    const current = this.stats.get(pass) ?? {};
    current[key] = (current[key] ?? 0) + by;
    this.stats.set(pass, current);
  }

  add(pass: string, usd: number, searches = 0, searchUsd = 0): void {
    const current = this.spend.get(pass) ?? {
      usd: 0,
      searches: 0,
      searchUsd: 0,
    };
    this.spend.set(pass, {
      usd: current.usd + usd,
      searches: current.searches + searches,
      searchUsd: current.searchUsd + searchUsd,
    });
  }
}

export type Context = {
  client: BatchClient;
  budget: GenerationBudget;
  searches: SearchLimit;
  wiki: WikiClient;
  glossary: ReadonlyMap<GlossaryId, GlossaryEntry>;
  abilityIndex: AbilityNameIndex;
  env: UnitEnvironment;
  generator: string;
  judge: string;
  /** Versioned web search tool type. */
  searchTool: string;
  /** Searches one tip may use in the passes that search. */
  searchesPerTip: number;
  decisions: ReturnType<typeof createTipDecisions>;
  thresholds: Thresholds;
  maxFillPasses: number;
  ledger: Ledger;
  log: (line: string) => void;
};

export const liveTips = (set: SetState): TipState[] =>
  set.tips.filter((tip) => tip.status === "live");

/** Tips per set after a pass, for the report. */
export function snapshot(
  ctx: Context,
  units: readonly UnitState[],
  pass: string,
): void {
  const sets: Record<string, number> = {};
  for (const unit of units) {
    for (const set of unit.sets) {
      sets[set.id] = liveTips(set).length;
    }
  }
  ctx.ledger.counts.push({ pass, sets });
}

export function drop(tip: TipState, pass: string, why: string): void {
  tip.status = "dropped";
  tip.droppedBecause = why;
  tip.history.push({ pass, outcome: "dropped", why });
}
