import { LaneSchema, type Lane, type Rank } from "@scout-for-lol/data";
import type { ScoutRank } from "@scout-for-lol/design-system/assets";
import {
  divisionToString,
  parseQueueType,
  queueTypeToDisplayString,
} from "@scout-for-lol/data";
import { getBrowserChampionName } from "@scout-for-lol/data/browser-assets";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";

export type LiveGameData = RouterOutputs["consumerLive"]["game"];
export type LiveListData = RouterOutputs["consumerLive"]["list"];
export type LiveParticipant = LiveGameData["participants"][number];
export type LiveSummary = LiveListData[number];

/** How often a page refreshes while the game it shows is still being played. */
export const LIVE_REFRESH_MS = 45_000;

/** A time as the wire carries it: an ISO string, or the Date it parses to. */
export type Instant = Date | string | number;

const MINUTE_MS = 60_000;

export function championName(championId: number): string {
  return getBrowserChampionName(championId);
}

function pluralize(count: number, noun: string): string {
  return `${count.toString()} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * How long the game has been going: "6 minutes in", "1 hour 5 minutes in".
 * Riot reports no start time while a lobby is still loading, so the time the
 * game was detected stands in for it.
 */
export function elapsedLabel(input: {
  startedAt: Instant | null;
  detectedAt: Instant;
  now: Instant;
}): string {
  const since = new Date(input.startedAt ?? input.detectedAt).getTime();
  const minutes = Math.max(
    0,
    Math.floor((new Date(input.now).getTime() - since) / MINUTE_MS),
  );
  if (minutes < 1) return "just started";
  if (minutes < 60) return `${pluralize(minutes, "minute")} in`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? `${pluralize(hours, "hour")} in`
    : `${pluralize(hours, "hour")} ${pluralize(rest, "minute")} in`;
}

/** The queue as a short label: "Ranked Solo", "ARAM", "Normal". */
export function queueLabel(queueId: number): string | undefined {
  const queue = parseQueueType(queueId);
  if (queue === undefined) return undefined;
  if (queue === "solo") return "Ranked Solo";
  if (queue === "flex") return "Ranked Flex";
  const label = queueTypeToDisplayString(queue);
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

/** "A Ranked Solo game." */
export function queueSentence(queueId: number): string {
  const label = queueLabel(queueId);
  if (label === undefined) return "A game.";
  const article = /^[aeiou]/i.test(label) ? "An" : "A";
  return `${article} ${label} game.`;
}

const LANE_SHORT: Record<Lane, string> = {
  top: "top",
  jungle: "jungle",
  middle: "mid",
  adc: "bot",
  support: "support",
};

/** "in top", "in the jungle", "in mid", "in bot", "as support". */
const LANE_PLAYING: Record<Lane, string> = {
  top: "in top",
  jungle: "in the jungle",
  middle: "in mid",
  adc: "in bot",
  support: "as support",
};

const LANE_PERSON: Record<Lane, string> = {
  top: "top laner",
  jungle: "jungler",
  middle: "mid laner",
  adc: "bot laner",
  support: "support",
};

/** Top to support, the order a lobby lists a team in. */
const LANE_ORDER: readonly (Lane | null)[] = [
  "top",
  "jungle",
  "middle",
  "adc",
  "support",
  null,
];

/** The lane the lobby inferred, or none when it could not tell. */
export function laneOf(participant: LiveParticipant): Lane | null {
  return LaneSchema.nullable().parse(participant.lane);
}

/** "top laner", "jungler": who a lane's player is. */
export function lanePerson(lane: Lane): string {
  return LANE_PERSON[lane];
}

export function laneShort(lane: Lane): string {
  return LANE_SHORT[lane];
}

/** "Garen, top": the champion and, when the lobby shows it, the lane. */
export function championLine(participant: LiveParticipant): string {
  const lane = laneOf(participant);
  const name = championName(participant.championId);
  return lane === null ? name : `${name}, ${laneShort(lane)}`;
}

const APEX_TIERS: ReadonlySet<Rank["tier"]> = new Set([
  "master",
  "grandmaster",
  "challenger",
]);

/** "III" for Emerald III; none above Diamond, where LP alone places a player. */
export function rankDivision(rank: Rank): string | undefined {
  return APEX_TIERS.has(rank.tier)
    ? undefined
    : divisionToString(rank.division);
}

/** A rank as people say it: "Emerald III", and "Master" with no division. */
export function rankLabel(rank: Rank): string {
  const tier = `${rank.tier.charAt(0).toUpperCase()}${rank.tier.slice(1)}`;
  const division = rankDivision(rank);
  return division === undefined ? tier : `${tier} ${division}`;
}

const CREST_BY_TIER: Record<Rank["tier"], ScoutRank> = {
  iron: "Iron",
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
  platinum: "Platinum",
  emerald: "Emerald",
  diamond: "Diamond",
  master: "Master",
  grandmaster: "Grandmaster",
  challenger: "Challenger",
};

/** The crest a rank is drawn with: its tier, whatever the division. */
export function rankCrestTier(rank: Rank): ScoutRank {
  return CREST_BY_TIER[rank.tier];
}

/**
 * The rank to show for someone: the one Scout held at detection for a friend,
 * the one the follow-up read for a stranger, and nothing when neither exists.
 */
export function rankOf(participant: LiveParticipant): Rank | null {
  if (participant.rank !== null) return participant.rank;
  const form = participant.recentForm;
  return form?.status === "fetched" ? form.rank : null;
}

/** The name a row shows: a friend's alias, else the Riot ID the lobby named. */
export function displayName(participant: LiveParticipant): string {
  return participant.friend?.alias ?? participant.riotId ?? "Hidden";
}

function friendsIn(game: LiveGameData): LiveParticipant[] {
  return game.participants.filter((participant) => participant.friend !== null);
}

/** The friends in the game, in the order the lobby lists them. */
export function liveFriends(game: LiveGameData): LiveParticipant[] {
  return orderedTeams(game).flatMap((team) =>
    team.participants.filter((participant) => participant.friend !== null),
  );
}

export type LiveTeam = {
  teamId: number;
  /** "RiverQuartz's team" for a team with friends, "Their team" for the rest. */
  title: string;
  participants: LiveParticipant[];
};

function joinNames(names: readonly string[]): string {
  return names.length <= 1
    ? names.join("")
    : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

function teamTitle(participants: readonly LiveParticipant[]): string {
  const names = participants.flatMap((participant) =>
    participant.friend === null ? [] : [participant.friend.alias],
  );
  if (names.length === 0) return "Their team";
  return names.length > 2 ? "Friends' team" : `${joinNames(names)}'s team`;
}

function laneRank(participant: LiveParticipant): number {
  return LANE_ORDER.indexOf(laneOf(participant));
}

/**
 * The two teams, the one with the first friend in it first, each from top to
 * support. A lobby whose lanes could not be told apart keeps Riot's order.
 */
export function orderedTeams(game: LiveGameData): LiveTeam[] {
  const first = game.participants.find(
    (participant) => participant.friend !== null,
  );
  const teamIds = [
    ...new Set(game.participants.map((participant) => participant.teamId)),
  ].toSorted((a, b) => {
    if (a === first?.teamId) return -1;
    return b === first?.teamId ? 1 : a - b;
  });
  return teamIds.map((teamId) => {
    const participants = game.participants
      .filter((participant) => participant.teamId === teamId)
      .toSorted((a, b) => laneRank(a) - laneRank(b));
    return { teamId, title: teamTitle(participants), participants };
  });
}

/** The player a lane faces: the one in the same lane on the other team. */
export function laneOpponent(
  game: LiveGameData,
  participant: LiveParticipant,
): LiveParticipant | undefined {
  const lane = laneOf(participant);
  if (lane === null) return undefined;
  const opposite = game.participants.filter(
    (other) => other.teamId !== participant.teamId && laneOf(other) === lane,
  );
  return opposite.length === 1 ? opposite[0] : undefined;
}

export type LiveHeroLines = {
  /** The page's name: the friends in the game. */
  title: string;
  lead: string;
  sub: string;
  /** The champion whose art fills the hero. */
  championId: number;
};

function friendNames(game: LiveGameData): string[] {
  return friendsIn(game).flatMap((participant) =>
    participant.friend === null ? [] : [participant.friend.alias],
  );
}

/** "RiverQuartz", "RiverQuartz and Quillon", "RiverQuartz and 2 friends". */
export function friendsTitle(names: readonly string[]): string {
  if (names.length <= 2) return joinNames(names);
  const [first = ""] = names;
  return `${first} and ${(names.length - 1).toString()} friends`;
}

function singleFriendSentence(
  game: LiveGameData,
  friend: LiveParticipant,
  verb: string,
): string {
  const lane = laneOf(friend);
  const opponent = laneOpponent(game, friend);
  return [
    `${verb} ${championName(friend.championId)}`,
    ...(lane === null ? [] : [LANE_PLAYING[lane]]),
    ...(opponent === undefined
      ? []
      : [`against ${championName(opponent.championId)}`]),
  ].join(" ");
}

/** The hero in words: who is playing what, against whom, and for how long. */
export function liveHeroLines(game: LiveGameData, now: Instant): LiveHeroLines {
  const friends = liveFriends(game);
  const [lead] = friends;
  if (lead === undefined) {
    throw new Error(`Live game ${game.riotMatchId} has no friend in it`);
  }
  const timing = game.ended
    ? null
    : elapsedLabel({
        startedAt: game.startedAt,
        detectedAt: game.detectedAt,
        now,
      });
  const verb = game.ended ? "Played" : "Playing";
  const sentence =
    friends.length === 1
      ? singleFriendSentence(game, lead, verb)
      : `${verb} ${joinNames(
          friends.map((friend) => championName(friend.championId)),
        )}`;
  return {
    title: friendsTitle(friendNames(game)),
    lead: timing === null ? `${sentence}.` : `${sentence}, ${timing}.`,
    sub: queueSentence(game.queueId),
    championId: lead.championId,
  };
}

/** The queue and time a game in a list reads as: "Ranked Solo, 6 minutes in". */
export function summaryLine(summary: LiveSummary, now: Instant): string {
  const timing = elapsedLabel({
    startedAt: summary.startedAt,
    detectedAt: summary.detectedAt,
    now,
  });
  const queue = queueLabel(summary.queueId);
  return queue === undefined ? timing : `${queue}, ${timing}`;
}

/** The friends in a game as a sentence: "as Ahri in mid". */
export function summaryFriendLine(
  friend: LiveSummary["friends"][number],
): string {
  const lane = LaneSchema.nullable().parse(friend.lane);
  const where = lane === null ? "" : ` ${LANE_PLAYING[lane]}`;
  return `as ${championName(friend.championId)}${where}`;
}

/** The list's lead: who is playing right now. */
export function liveListLead(games: readonly LiveSummary[]): string {
  const names = [
    ...new Set(
      games.flatMap((game) => game.friends.map((friend) => friend.alias)),
    ),
  ];
  if (names.length === 0) return "";
  const verb = names.length === 1 ? "is" : "are";
  return `${friendsTitle(names)} ${verb} in a game right now.`;
}
