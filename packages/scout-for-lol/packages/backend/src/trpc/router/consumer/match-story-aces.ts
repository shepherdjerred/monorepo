import type { StoryFrame } from "#src/reports/duckdb/consumer/match-story-reads.ts";
import type {
  KillEvent,
  StoryRoster,
} from "#src/trpc/router/consumer/match-story-fights.ts";

/** Base respawn wait in seconds by champion level 1 to 18. */
const BASE_RESPAWN_SECONDS = [
  6, 6, 8, 8, 10, 12, 16, 21, 26, 32.5, 35, 37.5, 40, 42.5, 45, 47.5, 50, 52.5,
] as const;

/**
 * The shortest time a champion of this level stays dead. Riot lengthens the
 * wait as the game goes on, so the real wait is never shorter: a team this
 * counts as wiped was wiped, and a wipe with late-game waits can be missed.
 */
function minimumRespawnMs(level: number): number {
  const index = Math.min(Math.max(level, 1), BASE_RESPAWN_SECONDS.length) - 1;
  return (BASE_RESPAWN_SECONDS[index] ?? 6) * 1000;
}

function levelAt(
  framesByParticipant: ReadonlyMap<number, readonly StoryFrame[]>,
  participantId: number,
  timestampMs: number,
): number {
  let level = 1;
  for (const frame of framesByParticipant.get(participantId) ?? []) {
    if (frame.frame_timestamp_ms > timestampMs) break;
    level = frame.level;
  }
  return level;
}

export type Ace = { kill: KillEvent };

/**
 * Kills after which every player on the dying team is dead at once. Only
 * teams of exactly five rostered players can be aced.
 */
export function findAces(options: {
  kills: readonly KillEvent[];
  roster: StoryRoster;
  frames: readonly StoryFrame[];
}): Ace[] {
  const framesByParticipant = new Map<number, StoryFrame[]>();
  for (const frame of options.frames) {
    const list = framesByParticipant.get(frame.participant_id) ?? [];
    list.push(frame);
    framesByParticipant.set(frame.participant_id, list);
  }
  for (const list of framesByParticipant.values()) {
    list.sort(
      (left, right) => left.frame_timestamp_ms - right.frame_timestamp_ms,
    );
  }
  const membersByTeam = new Map<number, number[]>();
  for (const [participantId, entry] of options.roster) {
    const members = membersByTeam.get(entry.teamId) ?? [];
    members.push(participantId);
    membersByTeam.set(entry.teamId, members);
  }
  // The moment each player, last killed, is expected to return.
  const backAt = new Map<number, number>();
  const aces: Ace[] = [];
  for (const kill of options.kills) {
    backAt.set(
      kill.victimId,
      kill.timestampMs +
        minimumRespawnMs(
          levelAt(framesByParticipant, kill.victimId, kill.timestampMs),
        ),
    );
    const members = membersByTeam.get(kill.victimTeamId) ?? [];
    if (
      members.length === 5 &&
      members.every((id) => (backAt.get(id) ?? 0) > kill.timestampMs)
    ) {
      aces.push({ kill });
    }
  }
  return aces;
}
