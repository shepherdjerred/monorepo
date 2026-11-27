import type {
  StoryAssist,
  StoryEvent,
  StoryFrame,
} from "#src/reports/duckdb/consumer/match-story-reads.ts";
import { findAces } from "#src/trpc/router/consumer/match-story-aces.ts";
import {
  championKills,
  clusterKills,
  findMultiKills,
  type KillEvent,
  type StoryRoster,
} from "#src/trpc/router/consumer/match-story-fights.ts";

export type MomentKind =
  | "first_blood"
  | "multi_kill"
  | "ace"
  | "deciding_fight"
  | "tower"
  | "inhibitor"
  | "dragon"
  | "herald"
  | "baron";

export type MomentPlayer = {
  participantId: number;
  displayName: string;
  championId: number;
  championName: string;
  role: "killer" | "victim" | "assist";
};

/**
 * One fact from the game's timeline. `text` states it ("First blood at 4:12 by
 * RiverQuartz"); the other fields carry what it states.
 */
export type StoryMoment = {
  id: string;
  kind: MomentKind;
  timestampMs: number;
  /** The team that did it. */
  teamId: number;
  players: MomentPlayer[];
  /** The length of a multi-kill; the winning side's kills in a fight. */
  count: number | null;
  /** The losing side's kills in a fight. */
  opposingCount: number | null;
  text: string;
};

/** More than a long game produces: 22 towers, 6 inhibitors, objectives, kills. */
export const MAX_STORY_MOMENTS = 80;

/** Chronological tie order: what happened first within the same instant. */
const KIND_ORDER: readonly MomentKind[] = [
  "first_blood",
  "multi_kill",
  "ace",
  "deciding_fight",
  "tower",
  "inhibitor",
  "dragon",
  "herald",
  "baron",
];

/** What survives when a game exceeds the cap: the most telling facts first. */
const KEEP_ORDER: readonly MomentKind[] = [
  "deciding_fight",
  "baron",
  "ace",
  "inhibitor",
  "dragon",
  "herald",
  "first_blood",
  "multi_kill",
  "tower",
];

const FIGHT_FOLLOW_UP_MS = 120_000;
const MAX_PLAYERS_PER_MOMENT = 5;

const DRAGON_NAMES: ReadonlyMap<string, string> = new Map([
  ["FIRE_DRAGON", "Infernal dragon"],
  ["WATER_DRAGON", "Ocean dragon"],
  ["EARTH_DRAGON", "Mountain dragon"],
  ["AIR_DRAGON", "Cloud dragon"],
  ["HEXTECH_DRAGON", "Hextech dragon"],
  ["CHEMTECH_DRAGON", "Chemtech dragon"],
  ["ELDER_DRAGON", "Elder dragon"],
]);

const LANE_NAMES: ReadonlyMap<string, string> = new Map([
  ["TOP_LANE", "top"],
  ["MID_LANE", "mid"],
  ["BOT_LANE", "bot"],
]);

const TOWER_NAMES: ReadonlyMap<string, string> = new Map([
  ["OUTER_TURRET", "Outer"],
  ["INNER_TURRET", "Inner"],
  ["BASE_TURRET", "Base"],
]);

const MULTI_KILL_NAMES: ReadonlyMap<number, string> = new Map([
  [3, "Triple kill"],
  [4, "Quadra kill"],
  [5, "Penta kill"],
]);

export function formatGameTime(timestampMs: number): string {
  const seconds = Math.floor(timestampMs / 1000);
  const rest = seconds % 60;
  return `${Math.floor(seconds / 60).toString()}:${rest.toString().padStart(2, "0")}`;
}

function capitalize(text: string): string {
  return `${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;
}

function player(
  roster: StoryRoster,
  participantId: number | null,
  role: MomentPlayer["role"],
): MomentPlayer[] {
  const entry =
    participantId === null || participantId <= 0
      ? undefined
      : roster.get(participantId);
  if (entry === undefined || participantId === null) return [];
  return [
    {
      participantId,
      displayName: entry.displayName,
      championId: entry.championId,
      championName: entry.championName,
      role,
    },
  ];
}

function withBy(text: string, killers: readonly MomentPlayer[]): string {
  const first = killers[0];
  return first === undefined ? text : `${text} by ${first.displayName}`;
}

function assistantsOf(
  assists: readonly StoryAssist[],
  eventId: string,
  roster: StoryRoster,
): MomentPlayer[] {
  return assists
    .filter((assist) => assist.event_id === eventId)
    .flatMap((assist) => player(roster, assist.participant_id, "assist"));
}

function objectiveTeam(event: StoryEvent, roster: StoryRoster): number | null {
  if (event.killer_team_id !== null && event.killer_team_id > 0) {
    return event.killer_team_id;
  }
  return event.killer_id !== null && event.killer_id > 0
    ? (roster.get(event.killer_id)?.teamId ?? null)
    : null;
}

type ObjectiveBuilders = {
  roster: StoryRoster;
  assists: readonly StoryAssist[];
};

function objectiveMoment(
  event: StoryEvent,
  context: ObjectiveBuilders,
): StoryMoment | null {
  const killers = [
    ...player(context.roster, event.killer_id, "killer"),
    ...assistantsOf(context.assists, event.event_id, context.roster),
  ].slice(0, MAX_PLAYERS_PER_MOMENT);
  const teamId = objectiveTeam(event, context.roster);
  const base = {
    timestampMs: event.event_timestamp_ms,
    players: killers,
    count: null,
    opposingCount: null,
  };
  const when = formatGameTime(event.event_timestamp_ms);
  const monsterName = monsterLabel(event);
  if (monsterName !== null && event.event_type === "ELITE_MONSTER_KILL") {
    if (teamId === null) return null;
    return {
      ...base,
      id: `${monsterName.kind}:${event.event_id}`,
      kind: monsterName.kind,
      teamId,
      text: withBy(`${monsterName.label} at ${when}`, killers),
    };
  }
  if (event.event_type === "BUILDING_KILL") {
    const lost = event.team_id;
    const actor =
      teamId ??
      [
        ...new Set([...context.roster.values()].map((entry) => entry.teamId)),
      ].find((id) => id !== lost) ??
      null;
    const label = buildingLabel(event);
    if (actor === null || label === null) return null;
    return {
      ...base,
      id: `${label.kind}:${event.event_id}`,
      kind: label.kind,
      teamId: actor,
      text: withBy(`${label.label} at ${when}`, killers),
    };
  }
  return null;
}

function monsterLabel(
  event: StoryEvent,
): { kind: "dragon" | "herald" | "baron"; label: string } | null {
  if (event.monster_type === "DRAGON") {
    return {
      kind: "dragon",
      label: DRAGON_NAMES.get(event.monster_sub_type ?? "") ?? "Dragon",
    };
  }
  if (event.monster_type === "RIFTHERALD") {
    return { kind: "herald", label: "Rift Herald" };
  }
  return event.monster_type === "BARON_NASHOR"
    ? { kind: "baron", label: "Baron" }
    : null;
}

function buildingLabel(
  event: StoryEvent,
): { kind: "tower" | "inhibitor"; label: string } | null {
  const lane = LANE_NAMES.get(event.lane_type ?? "");
  if (event.building_type === "INHIBITOR_BUILDING") {
    return {
      kind: "inhibitor",
      label: lane === undefined ? "Inhibitor" : capitalize(`${lane} inhibitor`),
    };
  }
  if (event.building_type !== "TOWER_BUILDING") return null;
  if (event.tower_type === "NEXUS_TURRET") {
    return { kind: "tower", label: "Nexus tower" };
  }
  const tier = TOWER_NAMES.get(event.tower_type ?? "");
  const lanePart = lane === undefined ? "" : ` ${lane}`;
  return {
    kind: "tower",
    label: tier === undefined ? "Tower" : `${tier}${lanePart} tower`,
  };
}

function firstBloodMoment(
  kills: readonly KillEvent[],
  roster: StoryRoster,
): StoryMoment | null {
  // A turret or minion execution (`killerId` 0) is not first blood.
  const first = kills.find((kill) => kill.killerId > 0);
  if (first === undefined) return null;
  const killers = player(roster, first.killerId, "killer");
  return {
    id: `first_blood:${first.eventId}`,
    kind: "first_blood",
    timestampMs: first.timestampMs,
    teamId: first.teamId,
    players: [...killers, ...player(roster, first.victimId, "victim")],
    count: null,
    opposingCount: null,
    text: withBy(
      `First blood at ${formatGameTime(first.timestampMs)}`,
      killers,
    ),
  };
}

function multiKillMoments(
  kills: readonly KillEvent[],
  roster: StoryRoster,
): StoryMoment[] {
  return findMultiKills(kills).flatMap((multi) => {
    const label = MULTI_KILL_NAMES.get(Math.min(multi.length, 5));
    const killers = player(roster, multi.killerId, "killer");
    if (label === undefined || killers.length === 0) return [];
    return [
      {
        id: `multi_kill:${multi.last.eventId}`,
        kind: "multi_kill" as const,
        timestampMs: multi.last.timestampMs,
        teamId: multi.last.teamId,
        players: killers,
        count: Math.min(multi.length, 5),
        opposingCount: null,
        text: withBy(
          `${label} at ${formatGameTime(multi.last.timestampMs)}`,
          killers,
        ),
      },
    ];
  });
}

function aceMoments(options: {
  kills: readonly KillEvent[];
  roster: StoryRoster;
  frames: readonly StoryFrame[];
}): StoryMoment[] {
  return findAces(options).map((ace) => {
    const killers = player(options.roster, ace.kill.killerId, "killer");
    return {
      id: `ace:${ace.kill.eventId}`,
      kind: "ace" as const,
      timestampMs: ace.kill.timestampMs,
      teamId: ace.kill.teamId,
      players: killers,
      count: null,
      opposingCount: null,
      text: withBy(`Ace at ${formatGameTime(ace.kill.timestampMs)}`, killers),
    };
  });
}

/**
 * The last fight the winners took by two kills or more that was followed,
 * within two minutes, by the winners destroying an inhibitor or the game
 * ending. A game with no winner (a remake) has none.
 */
function decidingFightMoment(options: {
  kills: readonly KillEvent[];
  events: readonly StoryEvent[];
  roster: StoryRoster;
  winnerTeamId: number | null;
}): StoryMoment | null {
  const { winnerTeamId } = options;
  if (winnerTeamId === null) return null;
  const followUps = options.events
    .filter(
      (event) =>
        event.event_type === "GAME_END" ||
        (event.event_type === "BUILDING_KILL" &&
          event.building_type === "INHIBITOR_BUILDING" &&
          objectiveTeam(event, options.roster) === winnerTeamId),
    )
    .map((event) => event.event_timestamp_ms);
  const fights = clusterKills(options.kills).filter((cluster) => {
    if (cluster.kills.length < 3) return false;
    const won = cluster.kills.filter(
      (kill) => kill.teamId === winnerTeamId,
    ).length;
    const lost = cluster.kills.length - won;
    const end = cluster.endMs;
    return (
      won - lost >= 2 &&
      followUps.some((at) => at >= end && at - end <= FIGHT_FOLLOW_UP_MS)
    );
  });
  const fight = fights.at(-1);
  if (fight === undefined) return null;
  const winnerKills = fight.kills.filter(
    (kill) => kill.teamId === winnerTeamId,
  );
  const killerIds = [
    ...new Set(
      winnerKills.flatMap((kill) => (kill.killerId > 0 ? [kill.killerId] : [])),
    ),
  ].toSorted((left, right) => left - right);
  return {
    id: `deciding_fight:${fight.startEventId}`,
    kind: "deciding_fight",
    timestampMs: fight.startMs,
    teamId: winnerTeamId,
    players: killerIds
      .flatMap((id) => player(options.roster, id, "killer"))
      .slice(0, MAX_PLAYERS_PER_MOMENT),
    count: winnerKills.length,
    opposingCount: fight.kills.length - winnerKills.length,
    text: `Deciding fight at ${formatGameTime(fight.startMs)}, ${winnerKills.length.toString()} kills to ${(fight.kills.length - winnerKills.length).toString()}`,
  };
}

function compareMoments(left: StoryMoment, right: StoryMoment): number {
  return (
    left.timestampMs - right.timestampMs ||
    KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind) ||
    (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
  );
}

function capMoments(moments: StoryMoment[]): StoryMoment[] {
  return moments.length <= MAX_STORY_MOMENTS
    ? moments
    : moments
        .toSorted(
          (left, right) =>
            KEEP_ORDER.indexOf(left.kind) - KEEP_ORDER.indexOf(right.kind) ||
            compareMoments(left, right),
        )
        .slice(0, MAX_STORY_MOMENTS)
        .toSorted(compareMoments);
}

/**
 * The game's key moments, oldest first. Deterministic: ties on time break by
 * kind and then id, and nothing depends on the order the events arrive in.
 */
export function buildMoments(options: {
  events: readonly StoryEvent[];
  assists: readonly StoryAssist[];
  frames: readonly StoryFrame[];
  roster: StoryRoster;
  winnerTeamId: number | null;
}): StoryMoment[] {
  const kills = championKills(options.events, options.roster);
  const objectives = options.events.flatMap((event) => {
    const moment = objectiveMoment(event, options);
    return moment === null ? [] : [moment];
  });
  const first = firstBloodMoment(kills, options.roster);
  const moments = [
    ...(first === null ? [] : [first]),
    ...multiKillMoments(kills, options.roster),
    ...aceMoments({
      kills,
      roster: options.roster,
      frames: options.frames,
    }),
    ...objectives,
  ];
  const deciding = decidingFightMoment({
    kills,
    events: options.events,
    roster: options.roster,
    winnerTeamId: options.winnerTeamId,
  });
  if (deciding !== null) moments.push(deciding);
  return capMoments(moments.toSorted(compareMoments));
}
