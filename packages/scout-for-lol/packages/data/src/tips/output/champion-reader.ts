import type { Lane } from "#src/model/riot/lane.ts";
import {
  type ChampionTipsFile,
  ChampionTipsFileSchema,
  type ChampionTipsIndex,
  ChampionTipsIndexSchema,
  CHAMPION_TIPS_INDEX_PATH,
  type OutputCombo,
  type OutputTip,
  championTipsPath,
} from "#src/tips/output/champion-tips.ts";
import { GENERAL_TIPS_MIN, MATCHUP_TIPS_MIN } from "#src/tips/schema.ts";

/**
 * Reads the generated per-champion tips the way a page does: one champion at a
 * time. A hidden tip is never returned, and a set with fewer visible tips than
 * the minimum is hidden whole, like a stale one.
 */

export type VisibleTips = {
  patch: string;
  tips: OutputTip[];
};

export type VisibleGeneralTips = VisibleTips & { combos: OutputCombo[] };

export type ChampionTipsReader = {
  index: () => Promise<ChampionTipsIndex | null>;
  champion: (championKey: string) => Promise<ChampionTipsFile | null>;
  getChampionLaneTips: (input: {
    championKey: string;
    lane: Lane;
  }) => Promise<VisibleGeneralTips | null>;
  getMatchupTips: (input: {
    championKey: string;
    opponentKey: string;
    lane: Lane;
  }) => Promise<VisibleTips | null>;
};

const visible = (tips: readonly OutputTip[]): OutputTip[] =>
  tips.filter((tip) => tip.hidden !== true);

export function createChampionTipsReader(
  directory: string,
): ChampionTipsReader {
  const cache = new Map<string, Promise<ChampionTipsFile | null>>();

  async function readFile(
    championKey: string,
  ): Promise<ChampionTipsFile | null> {
    const file = Bun.file(`${directory}/${championTipsPath(championKey)}`);
    return (await file.exists())
      ? ChampionTipsFileSchema.parse(await file.json())
      : null;
  }

  const champion = (championKey: string): Promise<ChampionTipsFile | null> => {
    const cached = cache.get(championKey);
    if (cached !== undefined) {
      return cached;
    }
    const loading = readFile(championKey);
    cache.set(championKey, loading);
    return loading;
  };

  return {
    index: async () => {
      const file = Bun.file(`${directory}/${CHAMPION_TIPS_INDEX_PATH}`);
      return (await file.exists())
        ? ChampionTipsIndexSchema.parse(await file.json())
        : null;
    },
    champion,
    getChampionLaneTips: async ({ championKey, lane }) => {
      const file = await champion(championKey);
      const set = file?.general.find((entry) => entry.lane === lane);
      if (file === null || set === undefined) {
        return null;
      }
      const tips = visible(set.tips);
      return tips.length < GENERAL_TIPS_MIN
        ? null
        : { patch: file.patch, tips, combos: set.combos };
    },
    getMatchupTips: async ({ championKey, opponentKey, lane }) => {
      const file = await champion(championKey);
      const set = file?.matchups.find(
        (entry) => entry.lane === lane && entry.opponent === opponentKey,
      );
      if (file === null || set === undefined) {
        return null;
      }
      const tips = visible(set.tips);
      return tips.length < MATCHUP_TIPS_MIN
        ? null
        : { patch: file.patch, tips };
    },
  };
}

export const committedChampionTips = createChampionTipsReader(
  `${import.meta.dir}/../generated`,
);
