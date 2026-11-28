import {
  MetaRoleSchema,
  type MetaContext,
  type MetaManifest,
  type MetaRole,
} from "@scout-for-lol/data/meta/meta-serving.ts";
import {
  championFile,
  EMPTY_SNAPSHOT_V2,
  matchupFile,
  slugOf,
  CHAMPION_META_SNAPSHOT_V2_VERSION,
  type ChampionRef,
  type MatchupRecord,
  type MatchupsResponse,
  type SliceHeadline,
  type SnapshotChampion,
  type SnapshotIndex,
  type SnapshotMatchup,
  type SnapshotV2,
} from "./snapshot-v2-schema.ts";
import type { ChampionResponse } from "./snapshot.ts";

/**
 * Split the meta API's answers into the snapshot v2 files. Pure: the fetching
 * is `refresh.ts`, the bytes are `snapshot-v2-files.ts`.
 *
 * Every figure is copied as the API served it, interval and game count
 * included; nothing here re-derives a rate or relaxes a floor.
 */

export type MetaSource = {
  manifest: MetaManifest;
  /** One response per champion with at least one slice, as `GET champions/:id`. */
  champions: readonly ChampionResponse[];
  /** One response per champion with listed matchups, as `GET matchups/:id`. */
  matchups: ReadonlyMap<number, MatchupsResponse>;
};

const ROLE_ORDER: readonly MetaRole[] = MetaRoleSchema.options;

type ResponseSlice = ChampionResponse["slices"][number];

function headlineOf(slice: ResponseSlice): SliceHeadline {
  return {
    games: slice.sample.games,
    winRate: slice.winRate,
    tier: slice.tier,
  };
}

function byRole(left: { role: MetaRole }, right: { role: MetaRole }): number {
  return ROLE_ORDER.indexOf(left.role) - ROLE_ORDER.indexOf(right.role);
}

function refOf(id: number, name: string): ChampionRef {
  return { id, name, slug: slugOf(name) };
}

function snapshotContext(manifest: MetaManifest): MetaContext {
  const { defaults } = manifest;
  if (defaults === null) throw new Error("A snapshot needs a default context");
  const queue = manifest.queues.find((entry) => entry.id === defaults.queueId);
  if (queue === undefined) {
    throw new Error(`Manifest has no queue ${defaults.queueId.toString()}`);
  }
  return {
    patch: defaults.patch,
    queueId: defaults.queueId,
    queue: queue.label,
    bracket: defaults.bracket,
  };
}

function assertContext(
  actual: MetaContext,
  wanted: MetaContext,
  what: string,
): void {
  if (
    actual.patch !== wanted.patch ||
    actual.queueId !== wanted.queueId ||
    actual.bracket !== wanted.bracket
  ) {
    throw new Error(
      `${what} is at patch ${actual.patch}, queue ${actual.queueId.toString()}, bracket ${actual.bracket}, not the snapshot's ${wanted.patch}, ${wanted.queueId.toString()}, ${wanted.bracket}`,
    );
  }
}

function championFileOf(
  response: ChampionResponse,
  matchups: MatchupsResponse | undefined,
  context: MetaContext,
): SnapshotChampion {
  for (const slice of response.slices) {
    assertContext(
      slice.context,
      context,
      `Champion ${response.championName} ${slice.context.role}`,
    );
  }
  return {
    schemaVersion: CHAMPION_META_SNAPSHOT_V2_VERSION,
    buildId: response.buildId,
    ...refOf(response.championId, response.championName),
    context,
    slices: response.slices.toSorted((a, b) =>
      byRole({ role: a.context.role }, { role: b.context.role }),
    ),
    matchups: (matchups?.slices ?? [])
      .map((slice) => ({
        role: slice.context.role,
        opponents: slice.opponents.map((opponent) => ({
          ...refOf(opponent.championId, opponent.championName),
          games: opponent.games,
          wins: opponent.wins,
          winRate: opponent.winRate,
          ...(opponent.lane === undefined ? {} : { lane: opponent.lane }),
        })),
      }))
      .toSorted(byRole),
  };
}

function indexOf(
  source: MetaSource,
  champions: readonly SnapshotChampion[],
  context: MetaContext,
): SnapshotIndex {
  const { manifest } = source;
  return {
    schemaVersion: CHAMPION_META_SNAPSHOT_V2_VERSION,
    source: {
      buildId: manifest.buildId,
      generatedAt: manifest.generatedAt,
      firstDay: manifest.source.firstDay,
      lastDay: manifest.source.lastDay,
      minSliceGames: manifest.thresholds.minSliceGames,
      minMatchupGames: manifest.thresholds.minMatchupGames,
      lane: manifest.lane ?? null,
    },
    context,
    caveats: manifest.caveats,
    champions: champions.map((champion) => ({
      id: champion.id,
      name: champion.name,
      slug: champion.slug,
      roles: champion.slices
        .toSorted(
          (left, right) =>
            right.sample.games - left.sample.games ||
            byRole({ role: left.context.role }, { role: right.context.role }),
        )
        .map((slice) => ({
          role: slice.context.role,
          ...headlineOf(slice),
          pickRate: slice.pickRate,
          banRate: slice.banRate,
          opponents:
            champion.matchups.find((entry) => entry.role === slice.context.role)
              ?.opponents.length ?? 0,
        })),
    })),
  };
}

type ResponseOpponent = MatchupsResponse["slices"][number]["opponents"][number];

/** The opponent's own record in the same matchup, as its matchups file lists it. */
function recordOf(entry: ResponseOpponent | undefined): MatchupRecord | null {
  if (entry === undefined) return null;
  return {
    games: entry.games,
    wins: entry.wins,
    winRate: entry.winRate,
    ...(entry.spells === undefined ? {} : { spells: entry.spells }),
    ...(entry.lane === undefined ? {} : { lane: entry.lane }),
  };
}

function matchupFilesOf(
  source: MetaSource,
  champions: ReadonlyMap<number, ChampionResponse>,
  context: MetaContext,
): Map<string, SnapshotMatchup> {
  const files = new Map<string, SnapshotMatchup>();
  const sliceOf = (championId: number, role: MetaRole) => {
    const slice = champions
      .get(championId)
      ?.slices.find((candidate) => candidate.context.role === role);
    return slice === undefined ? null : headlineOf(slice);
  };
  const entryOf = (championId: number, role: MetaRole, opponentId: number) =>
    source.matchups
      .get(championId)
      ?.slices.find((candidate) => candidate.context.role === role)
      ?.opponents.find((candidate) => candidate.championId === opponentId);
  for (const [championId, response] of source.matchups) {
    const champion = champions.get(championId);
    if (champion === undefined) {
      throw new Error(
        `Matchups for champion ${championId.toString()}, which has no slice`,
      );
    }
    const self = refOf(champion.championId, champion.championName);
    for (const slice of response.slices) {
      assertContext(
        slice.context,
        context,
        `Matchups of ${champion.championName} ${slice.context.role}`,
      );
      const { role } = slice.context;
      for (const entry of slice.opponents) {
        const { championId: opponentId, championName, ...record } = entry;
        const opponent = refOf(opponentId, championName);
        const path = matchupFile(self.slug, role, opponent.slug);
        if (files.has(path)) throw new Error(`Two matchups write ${path}`);
        files.set(path, {
          schemaVersion: CHAMPION_META_SNAPSHOT_V2_VERSION,
          buildId: response.buildId,
          context: { ...context, role },
          champion: { ...self, slice: sliceOf(championId, role), record },
          opponent: {
            ...opponent,
            slice: sliceOf(opponentId, role),
            record: recordOf(entryOf(opponentId, role, championId)),
          },
        });
      }
    }
  }
  return files;
}

export function buildSnapshotV2(source: MetaSource): SnapshotV2 {
  if (source.manifest.defaults === null || source.champions.length === 0) {
    return EMPTY_SNAPSHOT_V2;
  }
  const context = snapshotContext(source.manifest);
  const responses = new Map(
    source.champions.map((response) => [response.championId, response]),
  );
  const champions = source.champions
    .map((response) =>
      championFileOf(
        response,
        source.matchups.get(response.championId),
        context,
      ),
    )
    .toSorted((left, right) => left.slug.localeCompare(right.slug));
  const championFiles = new Map<string, SnapshotChampion>();
  for (const champion of champions) {
    const path = championFile(champion.slug);
    if (championFiles.has(path)) throw new Error(`Two champions write ${path}`);
    championFiles.set(path, champion);
  }
  return {
    index: indexOf(source, champions, context),
    champions: championFiles,
    matchups: matchupFilesOf(source, responses, context),
  };
}
