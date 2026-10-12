import {
  championNameToDisplayName,
  QueueTypeSchema,
  queueTypeToDisplayString,
  isClassicAssetMode,
} from "@scout-for-lol/data";
import type { RouterOutputs } from "#src/lib/query/trpc.ts";
import type {
  MatchParticipant,
  MatchTeam,
} from "#src/components/match/match-scoreboard.tsx";

export type ReviewTimeline = RouterOutputs["consumerMatch"]["reviewTimeline"];
export function supportsReviewMap(match: {
  mapId: number;
  queueId: number;
  gameMode: string;
  gameVersion: string;
}): boolean {
  return (
    match.mapId === 11 &&
    !isClassicAssetMode(match.queueId, match.gameMode) &&
    Number(match.gameVersion.split(".")[0]) >= 14
  );
}
export function matchQueueLabel(queue: string | null): string {
  if (queue === null) return "Match review";
  const parsed = QueueTypeSchema.safeParse(queue.toLowerCase());
  return parsed.success
    ? queueTypeToDisplayString(parsed.data)
    : queue.toLowerCase().replaceAll("_", " ");
}
export type ReviewFrame = ReviewTimeline["frames"][number];
export type ReviewEvent = ReviewTimeline["events"][number];
export type ReviewSnapshot = {
  timestampMs: number;
  frames: ReviewFrame[];
  goldDifference: number | null;
};

export function matchClock(ms: number): string {
  return `${Math.floor(ms / 60_000).toString()}:${Math.floor(
    (ms % 60_000) / 1000,
  )
    .toString()
    .padStart(2, "0")}`;
}

export function teamName(id: number): string {
  return id === 100
    ? "Blue team"
    : id === 200
      ? "Red team"
      : `Team ${id.toString()}`;
}

export function participantName(participant: MatchParticipant): string {
  const champion = championNameToDisplayName(participant.championName);
  return `${participant.riotId.gameName ?? champion} · ${champion}`;
}

export function reviewSnapshots(
  frames: ReviewFrame[],
  teams: MatchTeam[],
): ReviewSnapshot[] {
  const byTime = new Map<number, ReviewFrame[]>();
  const teamById = new Map(
    teams.flatMap((team) =>
      team.participants.map((p) => [p.participantId, team.teamId] as const),
    ),
  );
  for (const frame of frames) {
    const snapshot = byTime.get(frame.frame_timestamp_ms) ?? [];
    snapshot.push(frame);
    byTime.set(frame.frame_timestamp_ms, snapshot);
  }
  return [...byTime]
    .toSorted(([a], [b]) => a - b)
    .map(([timestampMs, rows]) => {
      const full =
        rows.length === teamById.size &&
        rows.every((frame) => teamById.has(frame.participant_id));
      const standard =
        teams.length === 2 &&
        teams.every((team) => team.teamId === 100 || team.teamId === 200);
      return {
        timestampMs,
        frames: rows,
        goldDifference:
          full && standard
            ? rows.reduce(
                (sum, frame) =>
                  sum +
                  frame.total_gold *
                    (teamById.get(frame.participant_id) === 100 ? 1 : -1),
                0,
              )
            : null,
      };
    });
}

export function snapshotAt(
  snapshots: ReviewSnapshot[],
  timestampMs: number,
): ReviewSnapshot | undefined {
  return snapshots.findLast((snapshot) => snapshot.timestampMs <= timestampMs);
}

// Riot's modern SR world bounds. The image's Y axis runs downwards.
export function projectRiftPosition(x: number, y: number) {
  return {
    x: Math.max(0, Math.min(100, (x / 15_000) * 100)),
    y: Math.max(0, Math.min(100, 100 - (y / 15_000) * 100)),
  };
}

export function laneOpponent(
  participant: MatchParticipant | undefined,
  teams: MatchTeam[],
): MatchParticipant | undefined {
  if (
    participant === undefined ||
    !["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"].includes(
      participant.position,
    )
  )
    return undefined;
  const ownTeam = teams.find((team) =>
    team.participants.some(
      (p) => p.participantId === participant.participantId,
    ),
  );
  const candidates = teams
    .filter((team) => team !== ownTeam)
    .flatMap((team) => team.participants)
    .filter((p) => p.position === participant.position);
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function frameDifference(frame: ReviewFrame, opponent: ReviewFrame) {
  return {
    gold: frame.total_gold - opponent.total_gold,
    cs:
      frame.minions_killed +
      frame.jungle_minions_killed -
      opponent.minions_killed -
      opponent.jungle_minions_killed,
    xp: frame.xp - opponent.xp,
  };
}

const OBJECTIVES: Record<string, string> = {
  BARON_NASHOR: "Baron Nashor",
  RIFTHERALD: "Rift Herald",
  HORDE: "Void Grubs",
  ATAKHAN: "Atakhan",
  DRAGON: "Dragon",
  AIR_DRAGON: "Cloud Drake",
  EARTH_DRAGON: "Mountain Drake",
  FIRE_DRAGON: "Infernal Drake",
  WATER_DRAGON: "Ocean Drake",
  HEXTECH_DRAGON: "Hextech Drake",
  CHEMTECH_DRAGON: "Chemtech Drake",
  ELDER_DRAGON: "Elder Dragon",
  OUTER_TURRET: "outer turret",
  INNER_TURRET: "inner turret",
  BASE_TURRET: "inhibitor turret",
  NEXUS_TURRET: "Nexus turret",
  TOWER_BUILDING: "turret",
  INHIBITOR_BUILDING: "inhibitor",
  TOP_LANE: "top",
  MID_LANE: "mid",
  BOT_LANE: "bot",
};
function objective(value: string | null, fallback: string): string {
  return value === null
    ? fallback
    : (OBJECTIVES[value] ?? value.toLowerCase().replaceAll("_", " "));
}

export function eventTeam(
  event: ReviewEvent,
  teams: MatchTeam[],
): number | null {
  if (event.type === "GAME_END") return event.winningTeamId;
  const killerTeam = teams.find((team) =>
    team.participants.some((p) => p.participantId === event.killerId),
  )?.teamId;
  // A building's team_id identifies its owner, not the team that destroyed it.
  if (event.type === "BUILDING_KILL")
    return (
      killerTeam ??
      event.killerTeamId ??
      (event.teamId === 100 ? 200 : event.teamId === 200 ? 100 : null)
    );
  return killerTeam ?? event.killerTeamId ?? event.winningTeamId;
}

export function eventDescription(
  event: ReviewEvent,
  teams: MatchTeam[],
): string {
  const participants = teams.flatMap((team) => team.participants);
  const name = (id: number | null) => {
    const participant = participants.find((p) => p.participantId === id);
    return participant === undefined
      ? "Minions or a turret"
      : championNameToDisplayName(participant.championName);
  };
  const team = eventTeam(event, teams);
  const actor = team === null ? name(event.killerId) : teamName(team);
  switch (event.type) {
    case "CHAMPION_KILL":
      return `${name(event.killerId)} defeated ${name(event.victimId)}`;
    case "ELITE_MONSTER_KILL":
      return `${actor} took ${objective(event.monsterSubtype ?? event.monster, "an objective")}`;
    case "BUILDING_KILL":
      return `${actor} destroyed ${objective(event.lane, "")} ${objective(event.tower ?? event.building, "a structure")}`;
    case "GAME_END":
      return `${actor} won the game`;
    default:
      throw new Error(`Unsupported review event: ${event.type}`);
  }
}
