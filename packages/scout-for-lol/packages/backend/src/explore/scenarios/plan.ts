import {
  ExploreScenarioCorpusSchema,
  type DiscordGuildId,
  type ExploreScenarioCase,
  type ExploreScenarioCorpus,
  type ExploreScenarioSurface,
} from "@scout-for-lol/data";
import { scenarioGuildId } from "#src/explore/scenarios/world.ts";

/**
 * Which (case, surface) runs a selection asks for.
 *
 * Pure, and free of anything that reads configuration, because the entry
 * script needs every guild id before it may load the agent: the dev guild
 * override is read once, at first import.
 */

export const SCENARIO_CORPUS_URL = new URL(
  "../../../../data/src/model/reports/explore-scenario-corpus.json",
  import.meta.url,
);

export type ScenarioRunPlan = {
  readonly entry: ExploreScenarioCase;
  /** The case's position in the corpus, which every fixture id derives from. */
  readonly caseIndex: number;
  readonly surface: ExploreScenarioSurface;
  readonly guildId: DiscordGuildId;
};

export async function loadScenarioCorpus(): Promise<{
  readonly corpus: ExploreScenarioCorpus;
  readonly raw: string;
}> {
  const raw = await Bun.file(SCENARIO_CORPUS_URL).text();
  return { corpus: ExploreScenarioCorpusSchema.parse(JSON.parse(raw)), raw };
}

export function scenarioPlan(
  corpus: ExploreScenarioCorpus,
  selection: {
    readonly only: readonly string[];
    readonly surfaces: readonly ExploreScenarioSurface[];
  },
): readonly ScenarioRunPlan[] {
  const unknown = selection.only.filter(
    (id) => !corpus.cases.some((entry) => entry.id === id),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown scenario ids: ${unknown.join(", ")}.`);
  }
  return corpus.cases.flatMap((entry, caseIndex) => {
    if (selection.only.length > 0 && !selection.only.includes(entry.id)) {
      return [];
    }
    return entry.surfaces
      .filter(
        (surface) =>
          selection.surfaces.length === 0 ||
          selection.surfaces.includes(surface),
      )
      .map((surface) => ({
        entry,
        caseIndex,
        surface,
        guildId: scenarioGuildId(caseIndex, surface),
      }));
  });
}
