import { LcuTimelineSchema } from "./lcu-timeline.ts";
import type { LocalMatchBundle } from "./lcu-schema.ts";

type LegacyGame = LocalMatchBundle["matchHistory"];

/**
 * Which team took an objective first, from facts the League client reports:
 * the team that took the first one, `null` when no team took any, or
 * `undefined` when the facts can't tell.
 *
 * With one team (or none) holding kills, the counts decide. With several,
 * only the timeline's first matching `ELITE_MONSTER_KILL` does; a kill by a
 * participant the roster doesn't know proves nothing.
 */
export function firstObjectiveTeam(options: {
  readonly game: LegacyGame;
  readonly timeline: unknown;
  readonly kills: (team: LegacyGame["teams"][number]) => number | undefined;
  readonly monsterType: string;
}): number | null | undefined {
  const counts = options.game.teams.map((team) => ({
    teamId: team.teamId,
    kills: options.kills(team),
  }));
  if (counts.some((count) => count.kills === undefined)) return undefined;
  const takers = counts.filter((count) => (count.kills ?? 0) > 0);
  const [only, ...others] = takers;
  if (only === undefined) return null;
  if (others.length === 0) return only.teamId;

  const timeline = LcuTimelineSchema.safeParse(options.timeline);
  if (!timeline.success) return undefined;
  const first = timeline.data.frames
    .flatMap((frame) => frame.events)
    .filter(
      (event) =>
        event.type === "ELITE_MONSTER_KILL" &&
        event.monsterType === options.monsterType,
    )
    .toSorted((left, right) => left.timestamp - right.timestamp)[0];
  return first?.killerId === undefined
    ? undefined
    : options.game.participants.find(
        (participant) => participant.participantId === first.killerId,
      )?.teamId;
}
