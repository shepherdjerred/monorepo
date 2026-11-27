import {
  laneToString,
  parseLane,
  type PlayerId,
  type Rank,
  type RiotMatchId,
} from "@scout-for-lol/data";
import type { GameResult } from "@scout-for-lol/design-system/domain/profile/result-strip";
import { wholePercent } from "#src/lib/format/percent.ts";
import { streakPhrase, wonOfLast } from "#src/lib/player/form-text.ts";
import type { PlayerProfileFilters } from "#src/lib/player/player-profile-filters.ts";
import {
  rankName,
  rankParts,
  type RankParts,
} from "#src/lib/player/rank-parts.ts";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";

export type PlayerSummary = RouterOutputs["consumerPlayer"]["profileSummary"];
type PoolEntry = PlayerSummary["championPool"][number];

/** Best champions shown before "See all". */
export const BEST_CHAMPIONS_PREVIEW = 3;
/** The share of games in one position that makes someone a main there. */
const MAIN_SHARE_PERCENT = 50;
/** Champions the hero names. */
const HERO_CHAMPIONS = 3;
/** The fewest kills in one fight that earn a highlight: a triple kill. */
const MULTI_KILL_HIGHLIGHT = 3;

/** What `profileSummary` reads: the page's filters for one player. */
export function playerSummaryInput(
  playerId: PlayerId,
  filters: PlayerProfileFilters,
) {
  return {
    playerId,
    games: filters.games,
    ...(filters.queues === undefined ? {} : { queues: filters.queues }),
  };
}

export type LatelyLines = {
  lead: string;
  sub: string | undefined;
  /** Oldest first, the order the strip draws them. */
  results: GameResult[];
};

function kdaText(summary: PlayerSummary): string | undefined {
  const form = summary.behavior?.recent20;
  return form === null || form === undefined
    ? undefined
    : `${form.kda.toFixed(2)} KDA`;
}

/** "Won 12 of the last 20" and the sentence under it, from the newest games. */
export function latelyLines(summary: PlayerSummary): LatelyLines | null {
  const { lately, streak } = summary.highlights;
  if (lately === null) return null;
  const rate = `${wholePercent((lately.wins / lately.games) * 100)} win rate`;
  const kda = kdaText(summary);
  const facts = [rate, ...(kda === undefined ? [] : [kda])].join(" and a ");
  const run = streakPhrase(streak);
  const sub =
    lately.games < 2
      ? undefined
      : run === undefined
        ? `With a ${facts}.`
        : `On ${run}, with a ${facts}.`;
  return {
    lead: wonOfLast(lately.wins, lately.games),
    sub,
    results: lately.results
      .toReversed()
      .map((game): GameResult => (game.win ? "win" : "loss")),
  };
}

export type HeroRank = {
  parts: RankParts;
  /** The other queue, or which queue this is when it is not Solo/Duo. */
  secondary: string | undefined;
};

/** Solo/Duo leads the hero; Flex follows it, or leads when it is all there is. */
export function heroRank(ranks: PlayerSummary["ranks"]): HeroRank | undefined {
  // A player with no accounts has no rank keys at all.
  const solo: Rank | undefined = "solo" in ranks ? ranks.solo : undefined;
  const flex: Rank | undefined = "flex" in ranks ? ranks.flex : undefined;
  const lead = solo ?? flex;
  if (lead === undefined) return undefined;
  const parts = rankParts(lead);
  if (solo === undefined) return { parts, secondary: "Flex" };
  if (flex === undefined) return { parts, secondary: undefined };
  const flexParts = rankParts(flex);
  return {
    parts,
    secondary: `${rankName(flex)}, ${flexParts.leaguePoints.toString()} LP in Flex`,
  };
}

export type HeroAbout = {
  /** "Mid main", when one position is half the games. */
  main: string | undefined;
  guild: string;
  champions: { championId: number; name: string }[];
};

function byGames(left: PoolEntry, right: PoolEntry): number {
  return (
    right.games - left.games ||
    right.winRate - left.winRate ||
    left.championName.localeCompare(right.championName) ||
    left.championId - right.championId
  );
}

/** Where they play, and who they play: the hero's two plain sentences. */
export function heroAbout(summary: PlayerSummary): HeroAbout {
  const top = summary.recentForm?.preferredPositions[0];
  const lane = top === undefined ? undefined : parseLane(top.position);
  const main =
    top !== undefined &&
    lane !== undefined &&
    top.percentage >= MAIN_SHARE_PERCENT
      ? `${laneToString(lane)} main`
      : undefined;
  return {
    main,
    guild: summary.guild.name,
    champions: summary.championPool
      .toSorted(byGames)
      .slice(0, HERO_CHAMPIONS)
      .map((entry) => ({
        championId: entry.championId,
        name: entry.championName,
      })),
  };
}

/** The champion behind the hero's art: the best one, else the most played. */
export function heroArtChampion(summary: PlayerSummary): number | undefined {
  return (
    summary.highlights.bestChampion?.championId ??
    summary.championPool.toSorted(byGames)[0]?.championId
  );
}

export type BestChampion = {
  championId: number;
  name: string;
  games: number;
  winRate: number;
  lowSample: boolean;
};

/** The champions this player does most with, most games first. */
export function bestChampions(summary: PlayerSummary): BestChampion[] {
  return summary.championPool.toSorted(byGames).map((entry) => ({
    championId: entry.championId,
    name: entry.championName,
    games: entry.games,
    winRate: entry.winRate * 100,
    lowSample: entry.lowSample,
  }));
}

export type PlaysWithFriend = {
  playerId: number;
  alias: string;
  /** "9 games together, won 6". */
  text: string;
  /** Wins first, then losses: the count as dots. */
  tally: GameResult[];
};

export type PlaysWith = { lead: string; friends: PlaysWithFriend[] };

/** The friends this player queues with, the most games together first. */
export function playsWith(summary: PlayerSummary): PlaysWith | null {
  const { friends } = summary.playsWith;
  const first = friends[0];
  if (first === undefined) return null;
  return {
    lead: `Mostly with ${first.alias}`,
    friends: friends.map((friend) => ({
      playerId: friend.playerId,
      alias: friend.alias,
      text: `${friend.games.toString()} games together, won ${friend.wins.toString()}`,
      tally: [
        ...Array.from({ length: friend.wins }, (): GameResult => "win"),
        ...Array.from(
          { length: friend.games - friend.wins },
          (): GameResult => "loss",
        ),
      ],
    })),
  };
}

const MULTI_KILLS: Record<number, string> = {
  2: "Double kill",
  3: "Triple kill",
  4: "Quadra kill",
  5: "Penta kill",
};

/** "Quadra kill" for a game worth a mark; undefined for an ordinary one. */
export function multiKillLabel(largestMultiKill: number): string | undefined {
  return largestMultiKill < MULTI_KILL_HIGHLIGHT
    ? undefined
    : (MULTI_KILLS[Math.min(largestMultiKill, 5)] ?? undefined);
}

export type PlayerSticker = {
  title: string;
  championId: number;
  matchId: RiotMatchId;
  atMs: number;
};

/** What the newest game earned: a sticker for a multi-kill. */
export function stickers(summary: PlayerSummary): PlayerSticker[] {
  const latest = summary.highlights.latestGame;
  if (latest === null) return [];
  const kill = multiKillLabel(latest.largestMultiKill);
  return kill === undefined
    ? []
    : [
        {
          title: `${kill} as ${latest.championName}`,
          championId: latest.championId,
          matchId: latest.matchId,
          atMs: latest.gameCreationMs,
        },
      ];
}
