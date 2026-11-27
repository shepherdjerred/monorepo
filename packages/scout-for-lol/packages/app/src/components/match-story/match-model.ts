import {
  championNameToDisplayName,
  parseLane,
  rankToSimpleString,
  type Rank,
} from "@scout-for-lol/data";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";
import { formatRiotId } from "#src/lib/format/riot-id-format.ts";
import { matchQueueLabel } from "#src/lib/player/match-review.ts";

export type MatchDetail = RouterOutputs["consumerMatch"]["detail"];
export type MatchStory = RouterOutputs["consumerMatch"]["story"];
export type DetailMatch = MatchDetail["match"];
export type DetailParticipant =
  DetailMatch["teams"][number]["participants"][number];
export type StoryParticipant = MatchStory["participants"][number];
export type StoryMoment = MatchStory["moments"][number];

export type MatchResult = "win" | "loss" | "remake";

const APEX_TIERS = new Set(["master", "grandmaster", "challenger"]);

/** Every participant of a two-team match, blue first. */
export function allParticipants(match: DetailMatch): DetailParticipant[] {
  return match.teams.flatMap((team) => team.participants);
}

/** The player this page is about. A match page without one is a broken contract. */
export function viewerOf(match: DetailMatch): DetailParticipant {
  const viewer = allParticipants(match).find(
    (participant) => participant.selectedPlayer,
  );
  if (viewer === undefined) {
    throw new Error("Match detail names no selected player");
  }
  return viewer;
}

export function resultOf(
  match: DetailMatch,
  viewer: DetailParticipant,
): MatchResult {
  if (match.remake) return "remake";
  return viewer.win ? "win" : "loss";
}

/** The Scout alias first, then the Riot ID, then the champion. */
export function displayNameOf(participant: DetailParticipant): string {
  return (
    participant.scoutAliases.at(0)?.alias ??
    formatRiotId(
      participant.riotId,
      championNameToDisplayName(participant.championName),
    )
  );
}

/** The Riot ID as the game shows it, or the champion where none was recorded. */
export function riotIdOf(participant: DetailParticipant): string {
  return formatRiotId(
    participant.riotId,
    championNameToDisplayName(participant.championName),
  );
}

/** "Ranked Solo", "Arena": the queue as a heading-case label. */
export function queueName(queue: string | null): string {
  const label = matchQueueLabel(queue);
  if (label === "ranked solo") return "Ranked Solo";
  return label === "ranked flex"
    ? "Ranked Flex"
    : `${label.slice(0, 1).toUpperCase()}${label.slice(1)}`;
}

export function championLabel(championName: string): string {
  return championNameToDisplayName(championName);
}

const POSITION_LABELS = {
  top: "top",
  jungle: "jungle",
  middle: "mid",
  adc: "bot",
  support: "support",
} as const;

/** "mid", "bot": null for a mode with no positions. */
export function positionLabel(position: string): string | null {
  const lane = parseLane(position);
  return lane === undefined ? null : POSITION_LABELS[lane];
}

/** "Ahri, mid" or just "Ahri". */
export function championLine(participant: DetailParticipant): string {
  const name = championLabel(participant.championName);
  const position = positionLabel(participant.position);
  return position === null ? name : `${name}, ${position}`;
}

export function kdaText(participant: {
  kills: number;
  deaths: number;
  assists: number;
}): string {
  return `${participant.kills.toString()}/${participant.deaths.toString()}/${participant.assists.toString()}`;
}

/** "18.4K" under 100K, "1.2M" above; whole numbers below a thousand. */
export function compactNumber(value: number): string {
  if (value < 1000) return value.toString();
  return value < 1_000_000
    ? `${(value / 1000).toFixed(1)}K`
    : `${(value / 1_000_000).toFixed(1)}M`;
}

/** Tracked teammates of the viewer, in roster order. */
export function friendsOf(
  match: DetailMatch,
  viewer: DetailParticipant,
): DetailParticipant[] {
  return allParticipants(match).filter(
    (participant) =>
      participant !== viewer &&
      participant.teamId === viewer.teamId &&
      participant.scoutAliases.length > 0,
  );
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  const head = names.slice(0, -1).join(", ");
  return `${head} and ${names.at(-1) ?? ""}`;
}

export function durationMinutes(seconds: number): number {
  return Math.max(1, Math.round(seconds / 60));
}

const RELATIVE_UNITS: readonly {
  unit: Intl.RelativeTimeFormatUnit;
  ms: number;
}[] = [
  { unit: "day", ms: 86_400_000 },
  { unit: "hour", ms: 3_600_000 },
  { unit: "minute", ms: 60_000 },
];

/** "2 hours ago"; a game more than 30 days old gets its date. */
export function relativeTime(ms: number, now: number): string {
  const elapsed = Math.max(0, now - ms);
  if (elapsed >= 30 * 86_400_000) {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date(ms));
  }
  const formatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
  for (const { unit, ms: size } of RELATIVE_UNITS) {
    if (elapsed >= size) {
      return formatter.format(-Math.floor(elapsed / size), unit);
    }
  }
  return "just now";
}

function rankText(rank: Rank): string {
  const name = APEX_TIERS.has(rank.tier)
    ? rankToSimpleString(rank).split(" ").slice(0, -1).join(" ")
    : rankToSimpleString(rank);
  return `${name}, ${rank.lp.toString()} LP`;
}

/**
 * The LP sentence, from what the rank snapshots state: never estimated. `null`
 * when this game left no ranked snapshot for the viewer.
 */
export function lpSentence(
  lpDelta: DetailParticipant["lpDelta"],
): string | null {
  if (lpDelta === null) return null;
  const after = rankText(lpDelta.rankAfter);
  if (lpDelta.delta === null) return `Now ${after}.`;
  if (lpDelta.delta === 0) return `No LP change, ${after}.`;
  const direction = lpDelta.delta > 0 ? "Up" : "Down";
  return `${direction} ${Math.abs(lpDelta.delta).toString()} LP to ${after}.`;
}

export type HeroText = {
  title: string;
  lead: string;
  sub: string;
};

export function heroText(options: {
  match: DetailMatch;
  viewer: DetailParticipant;
  queue: string;
  now: number;
}): HeroText {
  const { match, viewer } = options;
  const name = displayNameOf(viewer);
  const champion = championLabel(viewer.championName);
  const result = resultOf(match, viewer);
  const title =
    result === "remake"
      ? `${name} played ${champion}`
      : `${name} ${result === "win" ? "won" : "lost"} as ${champion}`;
  const friends = friendsOf(match, viewer).map((friend) =>
    displayNameOf(friend),
  );
  const minutes = durationMinutes(match.gameDurationSeconds).toString();
  const lead = `${kdaText(viewer)} in a ${minutes}-minute game${
    friends.length === 0 ? "" : `, with ${joinNames(friends)}`
  }.`;
  const when =
    match.gameCreationMs === null
      ? null
      : relativeTime(match.gameCreationMs, options.now);
  const queueAndWhen = [options.queue, when]
    .filter((part) => part !== null)
    .join(", ");
  const lp = lpSentence(viewer.lpDelta);
  const sub = [
    result === "remake" ? "Remade, no result." : null,
    lp,
    `${queueAndWhen}.`,
  ]
    .filter((part) => part !== null)
    .join(" ");
  return { title, lead, sub };
}

export type LaneResult = {
  opponent: DetailParticipant;
  /** The viewer's gold minus the opponent's at 15:00. */
  goldDelta: number;
  creepScoreDelta: number;
  xpDelta: number;
};

/**
 * The viewer's lane at 15 minutes, from the viewer's side. `null` when the game
 * has no pairing, no timeline, ended before 15:00, or was remade.
 */
export function laneResultOf(
  match: DetailMatch,
  viewer: DetailParticipant,
): LaneResult | null {
  if (match.remake || match.roleMatchups === null) return null;
  if (viewer.participantId === null) return null;
  const matchup = match.roleMatchups.find(
    (candidate) =>
      candidate.blueParticipantId === viewer.participantId ||
      candidate.redParticipantId === viewer.participantId,
  );
  if (matchup?.at15 == null) return null;
  const viewerIsBlue = matchup.blueParticipantId === viewer.participantId;
  const opponentId = viewerIsBlue
    ? matchup.redParticipantId
    : matchup.blueParticipantId;
  const opponent = allParticipants(match).find(
    (participant) => participant.participantId === opponentId,
  );
  if (opponent === undefined) {
    throw new Error("Role matchup names a participant the match does not hold");
  }
  const sign = viewerIsBlue ? 1 : -1;
  return {
    opponent,
    goldDelta: sign * matchup.at15.goldDelta,
    creepScoreDelta: sign * matchup.at15.creepScoreDelta,
    xpDelta: sign * matchup.at15.xpDelta,
  };
}

/** "Ahead of Yasuo at 15 minutes, by 640 gold." */
export function laneLead(lane: LaneResult): string {
  const opponent = championLabel(lane.opponent.championName);
  if (lane.goldDelta === 0) return `Even with ${opponent} at 15 minutes.`;
  const side = lane.goldDelta > 0 ? "Ahead of" : "Behind";
  return `${side} ${opponent} at 15 minutes, by ${Math.abs(lane.goldDelta).toLocaleString("en-US")} gold.`;
}

function laneFigure(value: number, noun: string): string {
  if (value === 0) return `same ${noun}`;
  const amount = Math.abs(value);
  return `${amount.toLocaleString("en-US")} ${value > 0 ? "more" : "fewer"} ${noun}`;
}

/** "14 more minions, 320 more experience": the other two lane figures. */
export function laneDetail(lane: LaneResult): string {
  const text = [
    laneFigure(lane.creepScoreDelta, "minions"),
    laneFigure(lane.xpDelta, "experience"),
  ].join(", ");
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
}

/** The player with the most damage to champions, or `null` on a tie. */
export function topDamage(match: DetailMatch): DetailParticipant | null {
  const sorted = allParticipants(match).toSorted(
    (left, right) => right.damageToChampions - left.damageToChampions,
  );
  const [first, second] = sorted;
  if (first === undefined) return null;
  return second?.damageToChampions === first.damageToChampions ? null : first;
}
