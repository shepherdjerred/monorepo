import {
  ChampionMetaFileSchema,
  MatchupFileSchema,
  META_BRACKETS,
  META_CAVEATS,
  META_QUEUE_LABELS,
  META_SERVING_VERSION,
  META_TIER_LOWER_BOUNDS,
  MetaBracketSchema,
  MetaManifestSchema,
  MetaRoleSchema,
  tierFilePath,
  TierFileSchema,
  type ChampionMetaFile,
  type ChampionSlice,
  type MatchupFile,
  type MetaContext,
  type MetaManifest,
  type MetaThresholds,
  type MetaTierGrade,
  type TierEntry,
  type TierFile,
} from "#src/meta/meta-serving.ts";
import {
  entriesOf,
  type RollupRow,
  type SliceRows,
} from "#src/meta/meta-entries.ts";
import { wilsonInterval } from "#src/meta/wilson.ts";

/**
 * Pure assembly of the serving files from the roll-up's aggregated rows: no
 * I/O, so the shape, the minimum samples, the Wilson intervals and the tier
 * grades are all testable without DuckDB.
 */

export type MetaServingFiles = {
  manifest: MetaManifest;
  tiers: Map<string, TierFile>;
  champions: Map<number, ChampionMetaFile>;
  matchups: Map<number, MatchupFile>;
};

export function gradeForLowerBound(lower: number): MetaTierGrade {
  for (const [grade, bound] of META_TIER_LOWER_BOUNDS) {
    if (lower >= bound) return grade;
  }
  return "D";
}

/** `15.10` after `15.9`: patches compare as numbers, not strings. */
export function comparePatches(left: string, right: string): number {
  const [leftMajor = 0, leftMinor = 0] = left.split(".").map(Number);
  const [rightMajor = 0, rightMinor = 0] = right.split(".").map(Number);
  return leftMajor - rightMajor || leftMinor - rightMinor;
}

type ChampionTotals = { row: RollupRow; games: number; wins: number };

const stratumOf = (row: RollupRow): string =>
  `${row.patch}|${row.queue_id.toString()}|${row.bracket}`;
const sliceOf = (row: RollupRow): string =>
  `${stratumOf(row)}|${row.role}|${row.champion_id.toString()}`;
const championOf = (row: RollupRow): string =>
  `${stratumOf(row)}|${row.champion_id.toString()}`;

type RowIndex = {
  matches: Map<string, number>;
  bans: Map<string, number>;
  slices: Map<string, ChampionTotals>;
  championGames: Map<string, number>;
  nameVotes: Map<number, Map<string, number>>;
  detail: Map<string, SliceRows>;
};

function addChampionRow(index: RowIndex, row: RollupRow): void {
  const key = sliceOf(row);
  const existing = index.slices.get(key);
  if (existing === undefined) {
    index.slices.set(key, { row, games: row.games, wins: row.wins });
  } else {
    existing.games += row.games;
    existing.wins += row.wins;
  }
  const total = championOf(row);
  index.championGames.set(
    total,
    (index.championGames.get(total) ?? 0) + row.games,
  );
  const votes = index.nameVotes.get(row.champion_id) ?? new Map();
  votes.set(row.key1, (votes.get(row.key1) ?? 0) + row.games);
  index.nameVotes.set(row.champion_id, votes);
}

function addDetailRow(index: RowIndex, row: RollupRow): void {
  const key = sliceOf(row);
  const rows: SliceRows = index.detail.get(key) ?? new Map();
  rows.set(row.kind, [...(rows.get(row.kind) ?? []), row]);
  index.detail.set(key, rows);
}

function indexRows(rows: readonly RollupRow[]): RowIndex {
  const index: RowIndex = {
    matches: new Map(),
    bans: new Map(),
    slices: new Map(),
    championGames: new Map(),
    nameVotes: new Map(),
    detail: new Map(),
  };
  for (const row of rows) {
    switch (row.kind) {
      case "matches":
        index.matches.set(stratumOf(row), row.games);
        break;
      case "ban":
        index.bans.set(championOf(row), row.games);
        break;
      case "champion":
        addChampionRow(index, row);
        break;
      case "item":
      case "start_items":
      case "build_path":
      case "rune":
      case "spells":
      case "skill_order":
      case "matchup":
      case "trait_base":
      case "item_trait":
        addDetailRow(index, row);
        break;
    }
  }
  return index;
}

function championNames(index: RowIndex): Map<number, string> {
  const names = new Map<number, string>();
  for (const [championId, votes] of index.nameVotes) {
    const [winner] = [...votes].toSorted(
      ([leftName, left], [rightName, right]) =>
        right - left || leftName.localeCompare(rightName),
    );
    if (winner !== undefined) names.set(championId, winner[0]);
  }
  return names;
}

function queueLabel(queueId: number): string {
  return META_QUEUE_LABELS[queueId] ?? queueId.toString();
}

function contextOf(row: RollupRow): MetaContext {
  return {
    patch: row.patch,
    queueId: row.queue_id,
    queue: queueLabel(row.queue_id),
    bracket: MetaBracketSchema.parse(row.bracket),
  };
}

type Assembled = {
  slicesByChampion: Map<number, ChampionSlice[]>;
  tierEntries: Map<string, TierEntry[]>;
  matchupSlices: Map<number, MatchupFile["slices"]>;
};

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

function assembleSlices(
  index: RowIndex,
  names: ReadonlyMap<number, string>,
  thresholds: MetaThresholds,
): Assembled {
  const nameOf = (championId: number): string => {
    const name = names.get(championId);
    if (name === undefined) {
      throw new Error(
        `Champion ${championId.toString()} has no name in the partials`,
      );
    }
    return name;
  };
  const out: Assembled = {
    slicesByChampion: new Map(),
    tierEntries: new Map(),
    matchupSlices: new Map(),
  };
  for (const [key, champion] of [...index.slices].toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (champion.games < thresholds.minSliceGames) continue;
    const { row } = champion;
    const stratum = stratumOf(row);
    const stratumMatches = index.matches.get(stratum);
    if (stratumMatches === undefined) {
      throw new Error(
        `Stratum ${stratum} has champion rows but no match count`,
      );
    }
    const role = MetaRoleSchema.parse(row.role);
    const context = { ...contextOf(row), role };
    const rows: SliceRows = index.detail.get(key) ?? new Map();
    const winRate = wilsonInterval(champion.wins, champion.games);
    const tier = gradeForLowerBound(winRate.lower);
    const slice: ChampionSlice = {
      context,
      sample: { games: champion.games, matches: stratumMatches },
      winRate,
      pickRate: wilsonInterval(
        champion.games,
        Math.max(stratumMatches, champion.games),
      ),
      banRate: wilsonInterval(
        index.bans.get(championOf(row)) ?? 0,
        stratumMatches,
      ),
      roleShare: wilsonInterval(
        champion.games,
        index.championGames.get(championOf(row)) ?? champion.games,
      ),
      tier,
      ...entriesOf(rows, champion.games),
    };
    pushTo(out.slicesByChampion, row.champion_id, slice);
    pushTo(out.tierEntries, stratum, {
      championId: row.champion_id,
      championName: nameOf(row.champion_id),
      role,
      tier,
      games: champion.games,
      wins: champion.wins,
      winRate,
      pickRate: slice.pickRate,
      banRate: slice.banRate,
    });
    const opponents = (rows.get("matchup") ?? [])
      .map((entry) => ({
        championId: Number(entry.key1),
        championName: nameOf(Number(entry.key1)),
        games: entry.games,
        wins: entry.wins,
        winRate: wilsonInterval(entry.wins, entry.games),
      }))
      .toSorted(
        (left, right) =>
          right.games - left.games || left.championId - right.championId,
      );
    if (opponents.length > 0) {
      pushTo(out.matchupSlices, row.champion_id, { context, opponents });
    }
  }
  return out;
}

function assembleTiers(
  tierEntries: ReadonlyMap<string, TierEntry[]>,
  matches: ReadonlyMap<string, number>,
  buildId: string,
): Map<string, TierFile> {
  const gradeOrder = META_TIER_LOWER_BOUNDS.map(([grade]) => grade);
  const tiers = new Map<string, TierFile>();
  for (const [stratum, entries] of tierEntries) {
    const [patch = "", queueId = "", bracket = ""] = stratum.split("|");
    const context: MetaContext = {
      patch,
      queueId: Number(queueId),
      queue: queueLabel(Number(queueId)),
      bracket: MetaBracketSchema.parse(bracket),
    };
    tiers.set(
      tierFilePath(context),
      TierFileSchema.parse({
        schemaVersion: META_SERVING_VERSION,
        buildId,
        context,
        sample: { matches: matches.get(stratum) ?? 0 },
        gradeLowerBounds: Object.fromEntries(META_TIER_LOWER_BOUNDS),
        entries: entries.toSorted(
          (left, right) =>
            gradeOrder.indexOf(left.tier) - gradeOrder.indexOf(right.tier) ||
            right.winRate.lower - left.winRate.lower ||
            left.championId - right.championId ||
            left.role.localeCompare(right.role),
        ),
      }),
    );
  }
  return tiers;
}

function assembleManifest(input: {
  tiers: ReadonlyMap<string, TierFile>;
  champions: ReadonlyMap<number, ChampionMetaFile>;
  days: readonly string[];
  buildId: string;
  now: Date;
  thresholds: MetaThresholds;
}): MetaManifest {
  const summaries = [...input.tiers.values()]
    .map((file) => ({
      ...file.context,
      matches: file.sample.matches,
      entries: file.entries.length,
      path: tierFilePath(file.context),
    }))
    .toSorted(
      (left, right) =>
        comparePatches(right.patch, left.patch) ||
        left.queueId - right.queueId ||
        META_BRACKETS.indexOf(left.bracket) -
          META_BRACKETS.indexOf(right.bracket),
    );
  const defaultTier = summaries
    .filter((tier) => tier.bracket === "all")
    .toSorted(
      (left, right) =>
        comparePatches(right.patch, left.patch) || right.matches - left.matches,
    )
    .at(0);
  const firstDay = input.days.at(0);
  const lastDay = input.days.at(-1);
  if (firstDay === undefined || lastDay === undefined) {
    throw new Error("A roll-up needs at least one ingest day");
  }
  return MetaManifestSchema.parse({
    schemaVersion: META_SERVING_VERSION,
    buildId: input.buildId,
    generatedAt: input.now.toISOString(),
    source: { firstDay, lastDay, days: input.days.length },
    thresholds: input.thresholds,
    defaults:
      defaultTier === undefined
        ? null
        : {
            patch: defaultTier.patch,
            queueId: defaultTier.queueId,
            bracket: defaultTier.bracket,
          },
    patches: [...new Set(summaries.map((tier) => tier.patch))],
    queues: [...new Set(summaries.map((tier) => tier.queueId))]
      .toSorted((left, right) => left - right)
      .map((id) => ({ id, label: queueLabel(id) })),
    brackets: META_BRACKETS.filter((bracket) =>
      summaries.some((tier) => tier.bracket === bracket),
    ),
    champions: [...input.champions.values()]
      .map((file) => ({ id: file.championId, name: file.championName }))
      .toSorted((left, right) => left.id - right.id),
    tiers: summaries,
    caveats: META_CAVEATS,
  });
}

/** Pure assembly of the serving files from aggregated rows; no I/O. */
export function assembleMetaServing(input: {
  rows: readonly RollupRow[];
  days: readonly string[];
  buildId: string;
  now: Date;
  thresholds: MetaThresholds;
}): MetaServingFiles {
  const index = indexRows(input.rows);
  const names = championNames(index);
  const assembled = assembleSlices(index, names, input.thresholds);
  const tiers = assembleTiers(
    assembled.tierEntries,
    index.matches,
    input.buildId,
  );
  const champions = new Map<number, ChampionMetaFile>();
  const matchups = new Map<number, MatchupFile>();
  for (const [championId, slices] of assembled.slicesByChampion) {
    const championName = names.get(championId) ?? championId.toString();
    champions.set(
      championId,
      ChampionMetaFileSchema.parse({
        schemaVersion: META_SERVING_VERSION,
        buildId: input.buildId,
        championId,
        championName,
        slices,
      }),
    );
    const matchupSlices = assembled.matchupSlices.get(championId);
    if (matchupSlices !== undefined) {
      matchups.set(
        championId,
        MatchupFileSchema.parse({
          schemaVersion: META_SERVING_VERSION,
          buildId: input.buildId,
          championId,
          championName,
          slices: matchupSlices,
        }),
      );
    }
  }
  const manifest = assembleManifest({
    tiers,
    champions,
    days: input.days,
    buildId: input.buildId,
    now: input.now,
    thresholds: input.thresholds,
  });
  return { manifest, tiers, champions, matchups };
}
