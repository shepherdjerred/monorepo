import {
  MetaManifestSchema,
  META_TIER_LOWER_BOUNDS,
  type MetaRole,
  type MetaTierGrade,
} from "@scout-for-lol/data/meta/meta-serving.ts";
import { buildSnapshotV2 } from "#src/lib/champion-meta/snapshot-v2.ts";
import {
  CHAMPIONS,
  SETUPS,
  type ChampionSpec,
  type RoleSpec,
} from "./snapshot-v2-fixture-data.ts";
import {
  MatchupsResponseSchema,
  type SnapshotV2,
} from "#src/lib/champion-meta/snapshot-v2-schema.ts";
import { ChampionResponseSchema } from "#src/lib/champion-meta/snapshot.ts";

/**
 * A made-up snapshot v2 for rendering proof: seventeen champions over the five
 * roles, built through the same `buildSnapshotV2` the refresh uses, from
 * deterministic numbers. It is test data, not what the meta API served; the
 * committed copy under `snapshot-v2/` is checked against this builder, and the
 * design audit builds the public site from it (`CHAMPION_META_SNAPSHOT_FILE`).
 */

const PATCH = "16.23";
const QUEUE_ID = 420;
const BRACKET = "high";
const MATCHES = 140_000;

type Rate = { value: number; lower: number; upper: number };

/** The 95% Wilson interval, as the meta API computes its rates. */
function wilson(successes: number, total: number): Rate {
  const z = 1.96;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = p + (z * z) / (2 * total);
  const margin =
    z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  return {
    value: p,
    lower: (centre - margin) / denominator,
    upper: (centre + margin) / denominator,
  };
}

function gradeOf(rate: Rate): MetaTierGrade {
  const found = META_TIER_LOWER_BOUNDS.find(([, bound]) => rate.lower >= bound);
  if (found === undefined) throw new Error("No tier grade fits");
  return found[0];
}

/** Deterministic noise in [0, 1) from integers. */
function noise(...parts: number[]): number {
  let hash = 2_166_136_261;
  for (const part of parts) {
    hash = Math.imul(hash ^ part, 16_777_619) >>> 0;
    hash = Math.imul(hash ^ (hash >>> 13), 1_274_126_177) >>> 0;
  }
  return (hash >>> 0) / 4_294_967_296;
}

const CONTEXT = {
  patch: PATCH,
  queueId: QUEUE_ID,
  queue: "ranked_solo",
  bracket: BRACKET,
} as const;

/** The share of a slice's games the nth most played entry takes. */
function nth(rank: number): number {
  return 0.46 / (rank + 1);
}

function counted(games: number, share: number, winRate: number, key: number) {
  const entryGames = Math.max(21, Math.round(games * share));
  const wins = Math.round(entryGames * (winRate + (noise(key) - 0.5) * 0.04));
  return {
    games: entryGames,
    wins,
    winRate: wilson(wins, entryGames),
    share: wilson(entryGames, games),
  };
}

function sliceOf(spec: ChampionSpec, role: RoleSpec) {
  const setup = SETUPS[role.role];
  const wins = Math.round(role.games * role.winRate);
  const winRate = wilson(wins, role.games);
  const timeline = Math.round(role.games * 0.62);
  const seed = spec.id * 10 + roleIndex(role.role);
  const laneGames = Math.round(role.games * 0.2);
  const ahead = Math.round(
    laneGames *
      (0.5 + (role.winRate - 0.5) * 1.4 + (noise(seed, 7) - 0.5) * 0.08),
  );
  const durationShares = [0.31, 0.5, 0.19] as const;
  const durationBuckets = ["lt25", "25to35", "gt35"] as const;
  return {
    context: { ...CONTEXT, role: role.role },
    sample: { games: role.games, matches: MATCHES },
    winRate,
    pickRate: wilson(role.games, MATCHES),
    banRate: wilson(
      Math.round(MATCHES * (0.01 + noise(seed, 3) * 0.05)),
      MATCHES,
    ),
    roleShare: wilson(role.games, role.games + (spec.roles.length - 1) * 900),
    tier: gradeOf(winRate),
    coreItems: setup.builds
      .flat()
      .slice(0, 4)
      .map((itemId, rank) => ({
        itemId,
        ...counted(role.games, nth(rank), role.winRate, seed + itemId),
        denominator: "slice_games" as const,
      })),
    buildPaths: setup.builds.map((itemIds, rank) => ({
      itemIds,
      ...counted(timeline, nth(rank) * 0.7, role.winRate, seed + rank + 100),
      denominator: "games_with_timeline" as const,
    })),
    startingItems: setup.starting.map((items, rank) => ({
      items,
      ...counted(timeline, nth(rank), role.winRate, seed + rank + 200),
      denominator: "games_with_timeline" as const,
    })),
    runes: setup.runes.map((page, rank) => ({
      ...page,
      ...counted(role.games, nth(rank) * 0.9, role.winRate, seed + rank + 300),
      denominator: "games_with_runes" as const,
    })),
    spells: setup.spells.map((spellIds, rank) => ({
      spellIds,
      ...counted(role.games, nth(rank) * 1.5, role.winRate, seed + rank + 400),
      denominator: "slice_games" as const,
    })),
    skillOrders: setup.skills.map((order, rank) => ({
      order,
      ...counted(timeline, nth(rank) * 1.2, role.winRate, seed + rank + 500),
      denominator: "games_with_timeline" as const,
    })),
    lane: {
      games: laneGames,
      ahead,
      aheadRate: wilson(ahead, laneGames),
      share: wilson(laneGames, role.games),
      denominator: "slice_games" as const,
    },
    durations: durationBuckets.map((bucket, position) => {
      const delta = role.scaling * (position - 1);
      return {
        bucket,
        ...counted(
          role.games,
          durationShares[position] ?? 0,
          role.winRate + delta,
          seed + position + 600,
        ),
        denominator: "games_with_duration" as const,
      };
    }),
    boots: setup.boots.map((itemId, rank) => ({
      itemId,
      ...counted(
        role.games,
        rank === 0 ? 0.74 : 0.14,
        role.winRate,
        seed + itemId + 700,
      ),
      denominator: "games_with_boots" as const,
    })),
    itemsAfterCore: setup.afterCore.map((itemId, rank) => ({
      itemId,
      ...counted(
        role.games,
        nth(rank) * 0.6,
        role.winRate,
        seed + itemId + 800,
      ),
      denominator: "slice_games" as const,
    })),
    itemLift: [],
  };
}

function roleIndex(role: MetaRole): number {
  return ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"].indexOf(role);
}

function opponentsOf(spec: ChampionSpec, role: RoleSpec) {
  const rivals = CHAMPIONS.flatMap((other) =>
    other.id === spec.id
      ? []
      : other.roles
          .filter((entry) => entry.role === role.role)
          .map((entry) => ({ other, entry })),
  );
  return rivals
    .map(({ other, entry }) => {
      const low = Math.min(spec.id, other.id);
      const high = Math.max(spec.id, other.id);
      const games = Math.max(
        32,
        Math.round(
          Math.min(role.games, entry.games) * (0.03 + noise(low, high) * 0.1),
        ),
      );
      // The same pair is generated once, from the lower id's side.
      const lowerSide = 0.5 + (noise(low, high, 1) - 0.5) * 0.14;
      const winsForLow = Math.round(games * lowerSide);
      const wins = spec.id === low ? winsForLow : games - winsForLow;
      const laneGames = Math.round(games * 0.2);
      const laneForLow = Math.round(
        laneGames * (0.5 + (noise(low, high, 2) - 0.5) * 0.2),
      );
      const ahead = spec.id === low ? laneForLow : laneGames - laneForLow;
      return {
        championId: other.id,
        championName: other.name,
        games,
        wins,
        winRate: wilson(wins, games),
        lane: {
          games: laneGames,
          ahead,
          aheadRate: wilson(ahead, laneGames),
          share: wilson(laneGames, games),
          denominator: "matchup_games" as const,
        },
      };
    })
    .toSorted((a, b) => b.games - a.games);
}

export function buildSnapshotV2Fixture(): SnapshotV2 {
  const manifest = MetaManifestSchema.parse({
    schemaVersion: 1,
    buildId: "fixture-build",
    generatedAt: "2026-11-21T00:00:00.000Z",
    source: { firstDay: "2026-11-07", lastDay: "2026-11-20", days: 14 },
    thresholds: { minSliceGames: 100, minEntryGames: 20, minMatchupGames: 30 },
    lane: { firstDay: "2026-11-14", lastDay: "2026-11-20", days: 7 },
    defaults: { patch: PATCH, queueId: QUEUE_ID, bracket: BRACKET },
    patches: [PATCH],
    queues: [{ id: QUEUE_ID, label: "ranked_solo" }],
    brackets: [BRACKET],
    champions: CHAMPIONS.map(({ id, name }) => ({ id, name })),
    tiers: [],
    caveats: ["Test fixture: not real data."],
  });
  const champions = CHAMPIONS.map((spec) =>
    ChampionResponseSchema.parse({
      schemaVersion: 1,
      buildId: manifest.buildId,
      championId: spec.id,
      championName: spec.name,
      slices: spec.roles.map((role) => sliceOf(spec, role)),
    }),
  );
  const matchups = new Map(
    CHAMPIONS.map((spec) => [
      spec.id,
      MatchupsResponseSchema.parse({
        schemaVersion: 1,
        buildId: manifest.buildId,
        championId: spec.id,
        championName: spec.name,
        context: CONTEXT,
        slices: spec.roles.map((role) => ({
          context: { ...CONTEXT, role: role.role },
          opponents: opponentsOf(spec, role),
        })),
      }),
    ]),
  );
  return buildSnapshotV2({ manifest, champions, matchups });
}
