import type { AbilitySlot } from "#src/data-dragon/ability-facts.ts";
import { latestVersion } from "#src/data-dragon/version.ts";
import type { ChampionId } from "#src/model/core/identifiers.ts";
import { getChampionById } from "#src/model/riot/champion-registry.ts";
import type { Lane } from "#src/model/riot/lane.ts";
import { isTipSetStaleAgainstCurrentFacts } from "#src/tips/input-hash.ts";
import {
  type GeneralTipFile,
  GeneralTipFileSchema,
  type GeneralTipSet,
  type MatchupTipFile,
  MatchupTipFileSchema,
  type MatchupTipSet,
  generalTipFilePath,
  matchupTipFilePath,
} from "#src/tips/schema.ts";

/** One tip as a page shows it: the text and the ability icons beside it. */
export type ConsumerTip = {
  text: string;
  abilities: { championId: ChampionId; slot: AbilitySlot; name: string }[];
};

export type ConsumerTips = {
  tips: ConsumerTip[];
  /** The patch whose facts the tips agree with. */
  patch: string;
};

export type TipReader = {
  getChampionLaneTips: (input: {
    championId: ChampionId;
    lane: Lane;
  }) => Promise<ConsumerTips | null>;
  getMatchupTips: (input: {
    championId: ChampionId;
    opponentId: ChampionId;
    lane: Lane;
  }) => Promise<ConsumerTips | null>;
};

/** `16.23.1` → `16.23`. */
export const CURRENT_TIP_PATCH = latestVersion.split(".").slice(0, 2).join(".");

function toConsumerTips(set: MatchupTipSet | GeneralTipSet): ConsumerTips {
  return {
    tips: set.tips.map((tip) => ({
      text: tip.text,
      abilities: tip.cites.flatMap((cite) =>
        cite.kind === "ability"
          ? [{ championId: cite.champion, slot: cite.slot, name: cite.name }]
          : [],
      ),
    })),
    patch: CURRENT_TIP_PATCH,
  };
}

/**
 * Read generated tips from `directory`. The matrix is pruned, so a missing
 * file or set means no tips for that champion or matchup and returns null. A
 * stale set (its facts changed since generation) is hidden the same way until
 * the generator rewrites it; a file that fails its schema is a broken contract
 * and throws.
 */
export function createTipReader(directory: string): TipReader {
  const files = new Map<string, Promise<unknown>>();

  async function readJson(path: string): Promise<unknown> {
    const cached = files.get(path);
    if (cached !== undefined) {
      return cached;
    }
    const read = (async (): Promise<unknown> => {
      const file = Bun.file(`${directory}/${path}`);
      if (!(await file.exists())) {
        return null;
      }
      const value: unknown = await file.json();
      return value;
    })();
    files.set(path, read);
    return read;
  }

  async function readMatchupFile(
    lane: Lane,
    championId: ChampionId,
  ): Promise<MatchupTipFile | null> {
    const entry = getChampionById(championId);
    if (entry === undefined) {
      return null;
    }
    const path = matchupTipFilePath(lane, entry.key);
    const raw = await readJson(path);
    if (raw === null) {
      return null;
    }
    const file = MatchupTipFileSchema.parse(raw);
    if (file.lane !== lane || file.champion !== championId) {
      throw new Error(`${path} holds another champion or lane`);
    }
    return file;
  }

  async function readGeneralFile(lane: Lane): Promise<GeneralTipFile | null> {
    const path = generalTipFilePath(lane);
    const raw = await readJson(path);
    if (raw === null) {
      return null;
    }
    const file = GeneralTipFileSchema.parse(raw);
    if (file.lane !== lane) {
      throw new Error(`${path} holds another lane`);
    }
    return file;
  }

  async function fresh(
    set: MatchupTipSet | GeneralTipSet | undefined,
  ): Promise<ConsumerTips | null> {
    return set === undefined || (await isTipSetStaleAgainstCurrentFacts(set))
      ? null
      : toConsumerTips(set);
  }

  return {
    getChampionLaneTips: async ({ championId, lane }) => {
      const file = await readGeneralFile(lane);
      return fresh(file?.sets.find((set) => set.champion === championId));
    },
    getMatchupTips: async ({ championId, opponentId, lane }) => {
      const file = await readMatchupFile(lane, championId);
      return fresh(file?.sets.find((set) => set.opponent === opponentId));
    },
  };
}

let committedTips: TipReader | undefined;

function committedTipReader(): TipReader {
  committedTips ??= createTipReader(`${import.meta.dir}/generated`);
  return committedTips;
}

/** General tips for playing a champion in a lane, or null when there are none. */
export async function getChampionLaneTips(input: {
  championId: ChampionId;
  lane: Lane;
}): Promise<ConsumerTips | null> {
  return committedTipReader().getChampionLaneTips(input);
}

/** Tips for playing `championId` against `opponentId` in a lane, or null. */
export async function getMatchupTips(input: {
  championId: ChampionId;
  opponentId: ChampionId;
  lane: Lane;
}): Promise<ConsumerTips | null> {
  return committedTipReader().getMatchupTips(input);
}
