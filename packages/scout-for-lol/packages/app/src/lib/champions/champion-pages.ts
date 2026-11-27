import { laneToString, type Lane } from "@scout-for-lol/data";
import { formatPercent } from "@scout-for-lol/design-system/domain/profile/win-rate-bar";
import type { DiscordGuildId } from "@scout-for-lol/data";
import type { PlayerProfileFilters } from "#src/lib/player/player-profile-filters.ts";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";

type IndexOutput = RouterOutputs["consumerChampion"]["index"];
export type IndexChampion = IndexOutput["champions"][number];
export type ComparisonRow =
  RouterOutputs["consumerChampion"]["compare"]["rows"][number];
export type MatchupEntry =
  RouterOutputs["consumerChampion"]["matchups"]["matchups"][number];
type MatchupTally = NonNullable<MatchupEntry["you"]>;

/** Rows the "Popular with your friends" list shows before a search narrows it. */
export const POPULAR_LIMIT = 10;
/** Champions "Yours" lists. */
export const YOURS_LIMIT = 5;
/** Games against a champion before a matchup counts as good or rough. */
export const MATCHUP_MIN_GAMES = 3;
/** Matchups listed under each of "does well" and "has a hard time". */
export const MATCHUP_LIMIT = 3;

/** The scope both champion pages send: the page filters and the chosen servers. */
export function championScopeInput(
  filters: PlayerProfileFilters,
  guildIds: DiscordGuildId[] | undefined,
) {
  return {
    games: filters.games,
    ...(filters.queues === undefined ? {} : { queues: filters.queues }),
    ...(guildIds === undefined ? {} : { guildIds }),
  };
}

function percent(fraction: number): string {
  return formatPercent(fraction * 100);
}

function plural(count: number, one: string, many: string): string {
  return `${count.toString()} ${count === 1 ? one : many}`;
}

/** "8 games", "1 game". */
export function gamesText(games: number): string {
  return plural(games, "game", "games");
}

export function ordinal(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${value.toString()}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[value % 10] ?? "th";
  return `${value.toString()}${suffix}`;
}

export type PageLines = { lead: string; sub?: string };

/** The hero of the index: the champion the servers play most, and who is best on it. */
export function championsIndexLines(champion: IndexChampion): PageLines {
  const lead = `${champion.name} is the favourite in your servers.`;
  const best = champion.bestFriend;
  if (champion.friendCount > 0 && best?.qualified === true) {
    return {
      lead,
      sub: `${plural(champion.friendCount, "friend plays", "friends play")} ${champion.name}, and ${best.alias} is the best of them at ${percent(best.winRate)}.`,
    };
  }
  if (champion.friendCount > 0) {
    return {
      lead,
      sub: `${plural(champion.friendCount, "friend plays", "friends play")} ${champion.name}.`,
    };
  }
  if (champion.you !== null) {
    return {
      lead,
      sub: `You have won ${percent(champion.you.winRate)} of ${plural(champion.you.games, "game", "games")}.`,
    };
  }
  return { lead };
}

/** The viewer's champions, most played first. */
export function yoursChampions(
  champions: readonly IndexChampion[],
): IndexChampion[] {
  return champions
    .filter((champion) => champion.you !== null)
    .toSorted(
      (left, right) =>
        (right.you?.games ?? 0) - (left.you?.games ?? 0) ||
        left.name.localeCompare(right.name),
    )
    .slice(0, YOURS_LIMIT);
}

/**
 * What the friends play: most friends first. A search looks through every
 * champion; without one the list stops at {@link POPULAR_LIMIT}.
 */
export function popularChampions(
  champions: readonly IndexChampion[],
  query: string,
): IndexChampion[] {
  const needle = query.trim().toLocaleLowerCase();
  const played = champions.filter((champion) => champion.friendCount > 0);
  return needle.length > 0
    ? played.filter((champion) =>
        champion.name.toLocaleLowerCase().includes(needle),
      )
    : played.slice(0, POPULAR_LIMIT);
}

export function recordText(wins: number, losses: number): string {
  const won = wins === 0 ? "no wins" : plural(wins, "win", "wins");
  const lost = losses === 0 ? "no losses" : plural(losses, "loss", "losses");
  return `${won}, ${lost}`;
}

/** "Won 7 of the last 10": how the newest games on the champion went. */
export function formText(row: ComparisonRow): string {
  const won = row.last10.filter((game) => game.win).length;
  return `Won ${won.toString()} of the last ${row.last10.length.toString()}`;
}

export type ChampionHeroInput = {
  name: string;
  qualifyingGames: number;
  /** Everyone with enough games, best win rate first. */
  qualified: readonly ComparisonRow[];
  /** Everyone with fewer games. */
  small: readonly ComparisonRow[];
  /** More qualified rows exist than were read. */
  truncated: boolean;
};

function pooledWinRate(rows: readonly ComparisonRow[]): number {
  const games = rows.reduce((total, row) => total + row.games, 0);
  const wins = rows.reduce((total, row) => total + row.wins, 0);
  return wins / games;
}

function viewerLines(input: ChampionHeroInput, index: number): PageLines {
  const viewer = input.qualified[index];
  if (viewer === undefined) throw new Error("Viewer row is out of range");
  const count = input.qualified.length;
  if (count === 1) {
    return {
      lead: `You are the only one in your servers with ${input.qualifyingGames.toString()} games on ${input.name}.`,
      sub: `${percent(viewer.winRate)} from ${viewer.games.toString()} games.`,
    };
  }
  const rank = index === 0 ? "best" : `${ordinal(index + 1)} best`;
  const of = input.truncated ? "" : ` of ${count.toString()}`;
  const most = input.qualified.every((row) => row.games <= viewer.games);
  const games = most
    ? `with the most games: ${viewer.games.toString()}`
    : `from ${viewer.games.toString()} games`;
  return {
    lead: `You have the ${rank} win rate${of} in your servers.`,
    sub: `${percent(viewer.winRate)} against a group average of ${percent(pooledWinRate(input.qualified))}, ${games}.`,
  };
}

/** The words of the champion page's hero, from who has played it. */
export function championHeroLines(input: ChampionHeroInput): PageLines {
  const viewerIndex = input.qualified.findIndex((row) => row.viewerLinked);
  if (viewerIndex !== -1) return viewerLines(input, viewerIndex);
  const viewerSmall = input.small.find((row) => row.viewerLinked);
  if (viewerSmall !== undefined) {
    return {
      lead: `You have ${recordText(viewerSmall.wins, viewerSmall.losses)} on ${input.name}.`,
    };
  }
  const best = input.qualified[0];
  if (best !== undefined) {
    return {
      lead: `${best.alias} is best on ${input.name}, at ${percent(best.winRate)}.`,
    };
  }
  const players = input.small.length;
  return {
    lead: `${plural(players, "player has", "players have")} played ${input.name}.`,
  };
}

function matchupWinRate(tally: MatchupTally): number {
  return tally.wins / tally.games;
}

export type MatchupGroups = {
  /** The headline: "Good against Yasuo, rough against Syndra". */
  lead: string | undefined;
  good: MatchupEntry[];
  hard: MatchupEntry[];
};

/** The viewer's matchups split into those they win and those they lose. */
export function matchupGroups(
  matchups: readonly MatchupEntry[],
): MatchupGroups {
  const counted = matchups.filter(
    (entry) => entry.you !== null && entry.you.games >= MATCHUP_MIN_GAMES,
  );
  const rate = (entry: MatchupEntry): number =>
    entry.you === null ? 0 : matchupWinRate(entry.you);
  const games = (entry: MatchupEntry): number => entry.you?.games ?? 0;
  const good = counted
    .filter((entry) => rate(entry) > 0.5)
    .toSorted(
      (left, right) => rate(right) - rate(left) || games(right) - games(left),
    )
    .slice(0, MATCHUP_LIMIT);
  const hard = counted
    .filter((entry) => rate(entry) < 0.5)
    .toSorted(
      (left, right) => rate(left) - rate(right) || games(right) - games(left),
    )
    .slice(0, MATCHUP_LIMIT);
  const best = good[0];
  const worst = hard[0];
  let lead: string | undefined;
  if (best !== undefined && worst !== undefined) {
    lead = `Good against ${best.opponent.name}, rough against ${worst.opponent.name}`;
  } else if (best !== undefined) {
    lead = `Good against ${best.opponent.name}`;
  } else if (worst !== undefined) {
    lead = `Rough against ${worst.opponent.name}`;
  }
  return { lead, good, hard };
}

/** Both lines under a matchup: the result, then the lane at 15 minutes. */
export function matchupLines(tally: MatchupTally): {
  result: string;
  lane: string | undefined;
} {
  const lane =
    tally.ahead15.games === 0
      ? undefined
      : `Ahead at 15 minutes in ${tally.ahead15.ahead.toString()} of ${plural(tally.ahead15.games, "lane game", "lane games")}`;
  return {
    result: `Won ${tally.wins.toString()} of ${plural(tally.games, "game", "games")}`,
    lane,
  };
}

/** The lane a champion's matchups open on: the chosen one, else the most played. */
export function activeLane(
  lanes: readonly { lane: Lane }[],
  chosen: Lane | undefined,
): Lane | undefined {
  const names = lanes.map((entry) => entry.lane);
  return chosen !== undefined && names.includes(chosen) ? chosen : names[0];
}

export function laneLabel(lane: Lane): string {
  return laneToString(lane);
}

export function compactPoints(points: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(points);
}
