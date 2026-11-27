import type { StoryEvent } from "#src/reports/duckdb/consumer/match-story-reads.ts";

/** Who is who in the match, by participant id. */
export type StoryRosterEntry = {
  teamId: number;
  championId: number;
  championName: string;
  displayName: string;
};

export type StoryRoster = ReadonlyMap<number, StoryRosterEntry>;

/** A champion kill whose victim is on the roster. */
export type KillEvent = {
  eventId: string;
  timestampMs: number;
  /** `0` when minions or a turret finished the victim. */
  killerId: number;
  victimId: number;
  /** The team that scored the kill. */
  teamId: number;
  victimTeamId: number;
};

/** Gaps within one fight, and within one multi-kill (Riot's own window). */
const FIGHT_GAP_MS = 15_000;
const MULTI_KILL_GAP_MS = 10_000;

function byTimeThenId(
  left: { timestampMs: number; eventId: string },
  right: { timestampMs: number; eventId: string },
): number {
  return (
    left.timestampMs - right.timestampMs ||
    (left.eventId < right.eventId ? -1 : left.eventId > right.eventId ? 1 : 0)
  );
}

/**
 * Champion kills in time order. A kill whose victim is not on the roster, or
 * whose scoring team cannot be named, is left out: it cannot be placed.
 */
export function championKills(
  events: readonly StoryEvent[],
  roster: StoryRoster,
): KillEvent[] {
  const teams = new Set([...roster.values()].map((entry) => entry.teamId));
  return events
    .flatMap((event): KillEvent[] => {
      if (event.event_type !== "CHAMPION_KILL") return [];
      if (event.victim_id === null || event.victim_id <= 0) return [];
      const victimTeamId = roster.get(event.victim_id)?.teamId;
      if (victimTeamId === undefined) return [];
      const killerId = event.killer_id ?? 0;
      const others = [...teams].filter((id) => id !== victimTeamId);
      const teamId =
        event.killer_team_id !== null && event.killer_team_id > 0
          ? event.killer_team_id
          : (roster.get(killerId)?.teamId ??
            (others.length === 1 ? others[0] : undefined));
      if (teamId === undefined) return [];
      return [
        {
          eventId: event.event_id,
          timestampMs: event.event_timestamp_ms,
          killerId,
          victimId: event.victim_id,
          teamId,
          victimTeamId,
        },
      ];
    })
    .toSorted(byTimeThenId);
}

export type KillCluster = {
  kills: KillEvent[];
  startMs: number;
  endMs: number;
  startEventId: string;
};

/** Kills chained by gaps of at most 15 seconds, in time order. */
export function clusterKills(kills: readonly KillEvent[]): KillCluster[] {
  const clusters: KillEvent[][] = [];
  for (const kill of kills) {
    const current = clusters.at(-1);
    const previous = current?.at(-1);
    if (
      current !== undefined &&
      previous !== undefined &&
      kill.timestampMs - previous.timestampMs <= FIGHT_GAP_MS
    ) {
      current.push(kill);
    } else {
      clusters.push([kill]);
    }
  }
  return clusters.flatMap((group) => {
    const first = group[0];
    const last = group.at(-1);
    return first === undefined || last === undefined
      ? []
      : [
          {
            kills: group,
            startMs: first.timestampMs,
            endMs: last.timestampMs,
            startEventId: first.eventId,
          },
        ];
  });
}

export type MultiKill = {
  killerId: number;
  /** Kills in the streak; three or more. */
  length: number;
  last: KillEvent;
};

/**
 * Streaks of three or more kills by one champion, each kill within ten
 * seconds of the one before. A streak of four is one quadra kill, not also a
 * triple.
 */
export function findMultiKills(kills: readonly KillEvent[]): MultiKill[] {
  const byKiller = new Map<number, KillEvent[]>();
  for (const kill of kills) {
    if (kill.killerId <= 0) continue;
    const list = byKiller.get(kill.killerId) ?? [];
    list.push(kill);
    byKiller.set(kill.killerId, list);
  }
  const found: MultiKill[] = [];
  for (const [killerId, list] of byKiller) {
    let streak: KillEvent[] = [];
    const flush = (): void => {
      const last = streak.at(-1);
      if (last !== undefined && streak.length >= 3) {
        found.push({ killerId, length: streak.length, last });
      }
      streak = [];
    };
    for (const kill of list) {
      const previous = streak.at(-1);
      if (
        previous !== undefined &&
        kill.timestampMs - previous.timestampMs > MULTI_KILL_GAP_MS
      ) {
        flush();
      }
      streak.push(kill);
    }
    flush();
  }
  return found;
}
