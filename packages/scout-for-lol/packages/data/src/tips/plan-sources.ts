import type { LanePriorArtifact } from "#src/lane-priors/schema.ts";
import type {
  ChampionMetaFile,
  MatchupFile,
  MetaBracket,
  MetaRole,
} from "#src/meta/meta-serving.ts";
import {
  type ChampionId,
  ChampionIdSchema,
} from "#src/model/core/identifiers.ts";
import { LANE_ORDER, type Lane } from "#src/model/riot/lane.ts";
import type {
  TipPlanChampionLane,
  TipPlanOpponent,
  TipPlanSource,
} from "#src/tips/plan.ts";

/**
 * Plan sources. Lane priors are available now but only count how often each
 * champion plays each lane, so their opponent counts are an estimate; meta
 * slices count real matchups and replace them once the crawl has data.
 */

/**
 * Plan from the lane-prior artifact. Lane priors do not record who faced whom,
 * so a champion's games against an opponent are estimated as its lane games
 * split by the opponent's share of the remaining picks in that lane.
 */
export function lanePriorTipPlanSource(
  artifact: LanePriorArtifact,
): TipPlanSource {
  const champions = artifact.champions.map((entry) => ({
    championId: ChampionIdSchema.parse(entry.championId),
    total: entry.total,
    counts: entry.counts,
  }));
  const laneTotals = new Map<Lane, number>(
    LANE_ORDER.map((lane) => [
      lane,
      champions.reduce((sum, champion) => sum + champion.counts[lane], 0),
    ]),
  );
  const laneGames = (lane: Lane): number => laneTotals.get(lane) ?? 0;

  return {
    name: `lane priors ${artifact.source.startDate} to ${artifact.source.endDate}, ${artifact.source.matchCount.toString()} matches`,
    laneGames,
    championLanes: () =>
      champions.flatMap((champion) =>
        LANE_ORDER.filter((lane) => champion.counts[lane] > 0).map(
          (lane): TipPlanChampionLane => ({
            championId: champion.championId,
            lane,
            games: champion.counts[lane],
            championGames: champion.total,
          }),
        ),
      ),
    opponents: (championId, lane) => {
      const own =
        champions.find((champion) => champion.championId === championId)
          ?.counts[lane] ?? 0;
      const others = laneGames(lane) - own;
      if (own === 0 || others <= 0) {
        return [];
      }
      return champions
        .filter(
          (champion) =>
            champion.championId !== championId && champion.counts[lane] > 0,
        )
        .map((champion): TipPlanOpponent => ({
          championId: champion.championId,
          games: (own * champion.counts[lane]) / others,
        }));
    },
  };
}

const ROLE_LANES: Record<MetaRole, Lane> = {
  TOP: "top",
  JUNGLE: "jungle",
  MIDDLE: "middle",
  BOTTOM: "adc",
  UTILITY: "support",
};

export type MetaTipPlanContext = {
  patch: string;
  queueId: number;
  bracket: MetaBracket;
};

function inContext(
  context: { patch: string; queueId: number; bracket: MetaBracket },
  wanted: MetaTipPlanContext,
): boolean {
  return (
    context.patch === wanted.patch &&
    context.queueId === wanted.queueId &&
    context.bracket === wanted.bracket
  );
}

/**
 * Plan from the meta serving files of one (patch, queue, bracket). A slice's
 * `roleShare` gives the champion's games across every role, including roles
 * under the serving sample floor that have no slice of their own.
 */
export function metaTipPlanSource(input: {
  champions: readonly ChampionMetaFile[];
  matchups: readonly MatchupFile[];
  context: MetaTipPlanContext;
}): TipPlanSource {
  const slices = input.champions.flatMap((file) =>
    file.slices
      .filter((slice) => inContext(slice.context, input.context))
      .map((slice) => ({
        championId: ChampionIdSchema.parse(file.championId),
        slice,
      })),
  );
  const matches = Math.max(
    0,
    ...slices.map(({ slice }) => slice.sample.matches),
  );
  const opponentsByKey = new Map<string, TipPlanOpponent[]>();
  for (const file of input.matchups) {
    for (const slice of file.slices) {
      if (!inContext(slice.context, input.context)) {
        continue;
      }
      opponentsByKey.set(
        `${file.championId.toString()}:${ROLE_LANES[slice.context.role]}`,
        slice.opponents.map((opponent) => ({
          championId: ChampionIdSchema.parse(opponent.championId),
          games: opponent.games,
        })),
      );
    }
  }
  const { patch, queueId, bracket } = input.context;

  return {
    name: `meta ${patch} queue ${queueId.toString()} ${bracket}`,
    // Two players hold each role in a match.
    laneGames: () => matches * 2,
    championLanes: () =>
      slices.map(({ championId, slice }): TipPlanChampionLane => {
        if (slice.roleShare.value <= 0) {
          throw new Error(
            `meta slice for champion ${championId.toString()} ${slice.context.role} has games but no role share`,
          );
        }
        return {
          championId,
          lane: ROLE_LANES[slice.context.role],
          games: slice.sample.games,
          championGames: slice.sample.games / slice.roleShare.value,
        };
      }),
    opponents: (championId: ChampionId, lane: Lane) =>
      opponentsByKey.get(`${championId.toString()}:${lane}`) ?? [],
  };
}
