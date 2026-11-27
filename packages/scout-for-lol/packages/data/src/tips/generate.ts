import type { ChampionId } from "#src/model/core/identifiers.ts";
import type { Lane } from "#src/model/riot/lane.ts";
import type { UnitEnvironment } from "#src/tips/check-draft.ts";
import {
  type AbilityNameIndex,
  type ChampionGrounding,
  loadAbilityNameIndex,
  loadChampionGrounding,
} from "#src/tips/grounding.ts";
import {
  type UnitAttempt,
  generalUnitHash,
  generateGeneralUnit,
  generateMatchupUnit,
  matchupUnitHash,
} from "#src/tips/generate-unit.ts";
import {
  type TipModel,
  type TipUsage,
  EMPTY_USAGE,
  TipBudgetExceededError,
  addUsage,
} from "#src/tips/model.ts";
import type { PlannedChampionLane } from "#src/tips/plan.ts";
import type { RankedMatchupUnit, SelectedWork } from "#src/tips/select.ts";
import type { TipStore } from "#src/tips/store.ts";
import type {
  GeneralTipSet,
  MatchupTipSet,
  WikiRevisions,
} from "#src/tips/schema.ts";
import type { WikiClient } from "#src/tips/wiki.ts";
import {
  type TipIssue,
  validateGeneralTipSet,
  validateMatchupPair,
} from "#src/tips/validate.ts";

/**
 * The generator run: for each selected unit, skip what is current, re-stamp
 * what only its input hash lost (the text still validates against the new
 * facts, so no model call), and generate the rest. The disk layout and the
 * rules for stale sets are in `schema.ts` and `input-hash.ts`.
 */

export type UnitState =
  | { state: "current" }
  | { state: "restamp"; reason: string }
  | { state: "generate"; reason: string };

export type MatchupSetPair = {
  forward: MatchupTipSet;
  reverse: MatchupTipSet;
};

export type UnitContext = {
  store: TipStore;
  promptVersion: string;
  abilityIndex: AbilityNameIndex;
  /** The wiki, to see whether a page a set used has been edited since. */
  wiki?: WikiClient | undefined;
};

/**
 * The pages of `stored` whose current revision differs from the one the set
 * was written from, or that no longer exist.
 */
async function editedWikiPages(
  wiki: WikiClient | undefined,
  stored: WikiRevisions | undefined,
): Promise<string[]> {
  const titles = Object.keys(stored ?? {});
  if (wiki === undefined || stored === undefined || titles.length === 0) {
    return [];
  }
  const current = await wiki.revisions(titles);
  return titles.filter((title) => current.get(title)?.revid !== stored[title]);
}

async function groundingsOf(
  unit: RankedMatchupUnit,
): Promise<readonly [ChampionGrounding, ChampionGrounding]> {
  const [first, second] = unit.championIds;
  return [
    await loadChampionGrounding(first),
    await loadChampionGrounding(second),
  ];
}

async function generalSetsOf(
  store: TipStore,
  lane: Lane,
  championIds: readonly ChampionId[],
): Promise<GeneralTipSet[]> {
  const sets = await Promise.all(
    championIds.map((championId) => store.generalSet(lane, championId)),
  );
  return sets.filter((set) => set !== undefined);
}

function summarize(issues: readonly TipIssue[]): string {
  return issues
    .slice(0, 2)
    .map((issue) => issue.message)
    .join("; ");
}

export async function classifyMatchupUnit(
  context: UnitContext,
  unit: RankedMatchupUnit,
): Promise<UnitState & { sets?: MatchupSetPair }> {
  const [first, second] = unit.championIds;
  const [forward, reverse] = await Promise.all([
    context.store.matchupSet(unit.lane, first, second),
    context.store.matchupSet(unit.lane, second, first),
  ]);
  if (forward === undefined || reverse === undefined) {
    return { state: "generate", reason: "missing" };
  }
  if (
    forward.promptVersion !== context.promptVersion ||
    reverse.promptVersion !== context.promptVersion
  ) {
    return { state: "generate", reason: "other prompt version" };
  }
  const edited = await editedWikiPages(context.wiki, forward.wiki);
  if (edited.length > 0) {
    return {
      state: "generate",
      reason: `wiki edited: ${edited.join(", ")}`,
    };
  }
  const groundings = await groundingsOf(unit);
  const hash = matchupUnitHash(
    context.promptVersion,
    { lane: unit.lane, championIds: unit.championIds, groundings },
    { wiki: forward.wiki, groundingVersion: forward.groundingVersion ?? 1 },
  );
  if (forward.inputHash === hash && reverse.inputHash === hash) {
    return { state: "current" };
  }
  const issues = validateMatchupPair(
    {
      forward: { ...forward, inputHash: hash },
      reverse: { ...reverse, inputHash: hash },
      general: await generalSetsOf(context.store, unit.lane, unit.championIds),
    },
    {
      champions: groundings,
      abilityIndex: context.abilityIndex,
      glossary: await context.store.glossary(),
    },
  );
  return issues.length === 0
    ? {
        state: "restamp",
        reason: "facts changed, text still valid",
        sets: {
          forward: { ...forward, inputHash: hash },
          reverse: { ...reverse, inputHash: hash },
        },
      }
    : {
        state: "generate",
        reason: `facts changed and the text no longer validates: ${summarize(issues)}`,
      };
}

export async function classifyGeneralUnit(
  context: UnitContext,
  entry: PlannedChampionLane,
): Promise<UnitState & { set?: GeneralTipSet }> {
  const existing = await context.store.generalSet(entry.lane, entry.championId);
  if (existing === undefined) {
    return { state: "generate", reason: "missing" };
  }
  if (existing.promptVersion !== context.promptVersion) {
    return { state: "generate", reason: "other prompt version" };
  }
  const edited = await editedWikiPages(context.wiki, existing.wiki);
  if (edited.length > 0) {
    return {
      state: "generate",
      reason: `wiki edited: ${edited.join(", ")}`,
    };
  }
  const grounding = await loadChampionGrounding(entry.championId);
  const hash = generalUnitHash(context.promptVersion, entry.lane, grounding, {
    wiki: existing.wiki,
    groundingVersion: existing.groundingVersion ?? 1,
  });
  if (existing.inputHash === hash) {
    return { state: "current" };
  }
  const restamped = { ...existing, inputHash: hash };
  const issues = validateGeneralTipSet(restamped, {
    champions: [grounding],
    abilityIndex: context.abilityIndex,
    glossary: await context.store.glossary(),
  });
  return issues.length === 0
    ? {
        state: "restamp",
        reason: "facts changed, text still valid",
        set: restamped,
      }
    : {
        state: "generate",
        reason: `facts changed and the text no longer validates: ${summarize(issues)}`,
      };
}

export type DroppedUnit = {
  kind: "matchup" | "general";
  lane: Lane;
  championIds: readonly ChampionId[];
  issues: TipIssue[];
};

export type GenerationReport = {
  selected: { matchups: number; general: number };
  current: number;
  restamped: number;
  generated: number;
  /** Generated units whose first answer already passed. */
  passedFirstAttempt: number;
  dropped: DroppedUnit[];
  usage: TipUsage;
  /** `lookup` calls the model made across the generated units. */
  toolCalls: number;
  /** Distinct wiki pages the generated units used. */
  wikiPages: number;
  /** Set when the budget stopped the run before every unit was handled. */
  stoppedByBudget: string | undefined;
  /** Units never started because the run stopped first. */
  notStarted: number;
};

export type RunOptions = {
  store: TipStore;
  model: TipModel;
  promptVersion: string;
  work: SelectedWork;
  wiki?: WikiClient | undefined;
  concurrency: number;
  maxOutputTokens: number;
  log?: ((line: string) => void) | undefined;
};

type Pool<Item> = { items: readonly Item[]; started: number };

async function runPool<Item>(
  items: readonly Item[],
  concurrency: number,
  stopped: () => boolean,
  worker: (item: Item) => Promise<void>,
): Promise<number> {
  const pool: Pool<Item> = { items, started: 0 };
  const lanes = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (!stopped()) {
        const item = pool.items[pool.started];
        if (item === undefined) {
          return;
        }
        pool.started += 1;
        await worker(item);
      }
    },
  );
  await Promise.all(lanes);
  return items.length - pool.started;
}

function describe(unit: RankedMatchupUnit | PlannedChampionLane): string {
  return "championIds" in unit
    ? `${unit.lane} ${unit.championIds[0].toString()} vs ${unit.championIds[1].toString()}`
    : `${unit.lane} ${unit.championId.toString()} general`;
}

export async function runGeneration(
  options: RunOptions,
): Promise<GenerationReport> {
  const { store, model, promptVersion, work } = options;
  const log = (line: string): void => {
    options.log?.(line);
  };
  const abilityIndex = await loadAbilityNameIndex();
  const context: UnitContext = {
    store,
    promptVersion,
    abilityIndex,
    wiki: options.wiki,
  };
  const usedPages = new Set<string>();
  const report: GenerationReport = {
    selected: { matchups: work.matchups.length, general: work.general.length },
    current: 0,
    restamped: 0,
    generated: 0,
    passedFirstAttempt: 0,
    dropped: [],
    usage: EMPTY_USAGE,
    toolCalls: 0,
    wikiPages: 0,
    stoppedByBudget: undefined,
    notStarted: 0,
  };
  let fatal: Error | undefined;
  const stopped = (): boolean =>
    report.stoppedByBudget !== undefined || fatal !== undefined;

  const environment = async (): Promise<UnitEnvironment> => ({
    model,
    promptVersion,
    abilityIndex,
    glossary: await store.glossary(),
    maxOutputTokens: options.maxOutputTokens,
    wiki: options.wiki,
  });

  const record = (
    outcome: {
      usage: TipUsage;
      attempts: UnitAttempt[];
      status: string;
      toolCalls: number;
      wiki: WikiRevisions;
    },
    label: string,
  ): void => {
    report.usage = addUsage(report.usage, outcome.usage);
    report.toolCalls += outcome.toolCalls;
    for (const page of Object.keys(outcome.wiki)) {
      usedPages.add(page);
    }
    report.wikiPages = usedPages.size;
    log(
      `${outcome.status === "ok" ? "ok     " : "dropped"} ${label} (${outcome.attempts.length.toString()} call${outcome.attempts.length === 1 ? "" : "s"}, $${outcome.usage.costUsd.toFixed(4)})`,
    );
  };

  const guard = async (task: () => Promise<void>): Promise<void> => {
    try {
      await task();
    } catch (error: unknown) {
      if (error instanceof TipBudgetExceededError) {
        report.stoppedByBudget ??= error.message;
        // The unit that hit the limit was started but did not finish.
        report.notStarted += 1;
      } else {
        fatal ??= error instanceof Error ? error : new Error(String(error));
      }
    }
  };

  const handleGeneral = (entry: PlannedChampionLane): Promise<void> =>
    guard(async () => {
      const state = await classifyGeneralUnit(context, entry);
      if (state.state === "current") {
        report.current += 1;
        return;
      }
      if (state.state === "restamp" && state.set !== undefined) {
        await store.putGeneralSet(state.set);
        report.restamped += 1;
        log(`restamp ${describe(entry)}`);
        await store.flush();
        return;
      }
      const grounding = await loadChampionGrounding(entry.championId);
      const outcome = await generateGeneralUnit(await environment(), {
        lane: entry.lane,
        grounding,
      });
      record(outcome, describe(entry));
      if (outcome.status === "dropped") {
        report.dropped.push({
          kind: "general",
          lane: entry.lane,
          championIds: [entry.championId],
          issues: outcome.issues,
        });
        return;
      }
      const result = outcome.result;
      await store.putGeneralSet(result.set);
      await store.addGlossaryEntries(result.glossaryAdditions);
      report.generated += 1;
      if (outcome.firstAttemptIssues.length === 0) {
        report.passedFirstAttempt += 1;
      }
      await store.flush();
    });

  const handleMatchup = (unit: RankedMatchupUnit): Promise<void> =>
    guard(async () => {
      const state = await classifyMatchupUnit(context, unit);
      if (state.state === "current") {
        report.current += 1;
        return;
      }
      if (state.state === "restamp" && state.sets !== undefined) {
        await store.putMatchupSet(state.sets.forward);
        await store.putMatchupSet(state.sets.reverse);
        report.restamped += 1;
        log(`restamp ${describe(unit)}`);
        await store.flush();
        return;
      }
      const groundings = await groundingsOf(unit);
      const outcome = await generateMatchupUnit(await environment(), {
        lane: unit.lane,
        championIds: unit.championIds,
        groundings,
        general: await generalSetsOf(store, unit.lane, unit.championIds),
      });
      record(outcome, describe(unit));
      if (outcome.status === "dropped") {
        report.dropped.push({
          kind: "matchup",
          lane: unit.lane,
          championIds: unit.championIds,
          issues: outcome.issues,
        });
        return;
      }
      const result = outcome.result;
      await store.putMatchupSet(result.forward);
      await store.putMatchupSet(result.reverse);
      await store.addGlossaryEntries(result.glossaryAdditions);
      report.generated += 1;
      if (outcome.firstAttemptIssues.length === 0) {
        report.passedFirstAttempt += 1;
      }
      await store.flush();
    });

  try {
    // General tips first: a matchup's near-duplicate check reads them.
    // Count after each pool: a unit that hits the budget adds to the same
    // counter while the pool is still running.
    const generalLeft = await runPool(
      work.general,
      options.concurrency,
      stopped,
      handleGeneral,
    );
    report.notStarted += generalLeft;
    const matchupsLeft = await runPool(
      work.matchups,
      options.concurrency,
      stopped,
      handleMatchup,
    );
    report.notStarted += matchupsLeft;
  } finally {
    await store.flush();
  }
  if (fatal !== undefined) {
    throw fatal;
  }
  return report;
}
