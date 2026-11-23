import { z } from "zod";
import type { PublicReplayTimeline } from "@scout-for-lol/domain/artifacts/public-replay-timeline.ts";

type PublicTimelineEvent = PublicReplayTimeline["events"][number];
export type ResearchTimelineEvent = {
  id: number;
  timestampMs: number;
  champion: string | null;
} & (
  | {
      type: "CHAMPION_KILL" | "CHAMPION_DEATH" | "CHAMPION_RETURN";
      partition: 0 | 1;
    }
  | { type: "ACTOR_LEVEL"; partition: 0 | 1 | null; level: number }
  | {
      type: "TURRET_DESTRUCTION";
      partition: null;
      defendingPartition: 0 | 1 | null;
    }
  | { type: "INHIBITOR_DESTRUCTION"; partition: null }
);
export type TimelineEvent = PublicTimelineEvent | ResearchTimelineEvent;

const eventGroups = {
  all: "All events",
  CHAMPION_KILL: "Takedowns",
  ELITE_MONSTER_KILL: "Neutral objectives",
  BUILDING_KILL: "Structures",
  GAME_END: "Match end",
};

const combatGroups = {
  all: "All events",
  CHAMPION_KILL: "Champion kills",
  CHAMPION_DEATH: "Champion deaths",
  ACTOR_LEVEL: "Level ups",
};

const lifecycleGroups = {
  ...combatGroups,
  CHAMPION_RETURN: "Champion returns",
};

export function replayEventGroups(props: {
  research?: boolean;
  returnsAvailable?: boolean;
  turretsAvailable?: boolean;
  inhibitorsAvailable?: boolean;
}) {
  if (props.research !== true) return eventGroups;
  return {
    ...(props.returnsAvailable === true ? lifecycleGroups : combatGroups),
    ...(props.turretsAvailable === true
      ? { TURRET_DESTRUCTION: "Turret destructions" }
      : {}),
    ...(props.inhibitorsAvailable === true
      ? { INHIBITOR_DESTRUCTION: "Inhibitor destructions" }
      : {}),
  };
}

const eventFilter = z.enum([
  "all",
  "CHAMPION_KILL",
  "ELITE_MONSTER_KILL",
  "BUILDING_KILL",
  "GAME_END",
  "CHAMPION_DEATH",
  "ACTOR_LEVEL",
  "CHAMPION_RETURN",
  "TURRET_DESTRUCTION",
  "INHIBITOR_DESTRUCTION",
]);
export type EventFilter = z.infer<typeof eventFilter>;

export function readReplayEventFilter(value: string) {
  return eventFilter.safeParse(value).data;
}

const objectiveTitles = {
  DRAGON: "Drake",
  AIR_DRAGON: "Cloud Drake",
  CHEMTECH_DRAGON: "Chemtech Drake",
  EARTH_DRAGON: "Mountain Drake",
  ELDER_DRAGON: "Elder Dragon",
  FIRE_DRAGON: "Infernal Drake",
  HEXTECH_DRAGON: "Hextech Drake",
  WATER_DRAGON: "Ocean Drake",
  BARON_NASHOR: "Baron Nashor",
  RIFTHERALD: "Rift Herald",
  HORDE: "Voidgrub",
  ATAKHAN: "Atakhan",
  TOWER_BUILDING: "Turret destroyed",
  INHIBITOR_BUILDING: "Inhibitor destroyed",
  OUTER_TURRET: "Outer turret destroyed",
  INNER_TURRET: "Inner turret destroyed",
  BASE_TURRET: "Base turret destroyed",
  NEXUS_TURRET: "Nexus turret destroyed",
} satisfies Record<NonNullable<PublicTimelineEvent["objective"]>, string>;

function researchEventTitle(event: ResearchTimelineEvent): string {
  switch (event.type) {
    case "ACTOR_LEVEL":
      return `Level up to ${event.level.toString()}`;
    case "CHAMPION_KILL":
      return "Champion kill";
    case "CHAMPION_DEATH":
      return "Champion death";
    case "CHAMPION_RETURN":
      return "Champion returned";
    case "INHIBITOR_DESTRUCTION":
      return "Inhibitor destroyed";
    case "TURRET_DESTRUCTION":
      if (event.defendingPartition === null) return "Turret destroyed";
      return event.defendingPartition === 0
        ? "Team A turret destroyed"
        : "Team B turret destroyed";
  }
}

export function eventTitle(event: TimelineEvent): string {
  if ("partition" in event) {
    const title = researchEventTitle(event);
    return event.champion === null ||
      event.type === "TURRET_DESTRUCTION" ||
      event.type === "INHIBITOR_DESTRUCTION"
      ? title
      : `${title} · ${event.champion}`;
  }
  if (event.objective !== null) return objectiveTitles[event.objective];
  switch (event.type) {
    case "CHAMPION_KILL":
      return "Champion takedown";
    case "ELITE_MONSTER_KILL":
      return "Neutral objective taken";
    case "BUILDING_KILL":
      return "Structure destroyed";
    case "GAME_END":
      return "Match ended";
  }
}

export function eventTeam(event: TimelineEvent): string | null {
  if ("partition" in event) {
    if (event.partition === null) return null;
    return event.partition === 0 ? "Team A" : "Team B";
  }
  if (event.teamId === null) return null;
  const team = event.teamId === 100 ? "Blue team" : "Red team";
  return event.type === "GAME_END" ? `${team} won` : team;
}
