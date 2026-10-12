import {
  characterName,
  courseName,
  type RaceSummary,
} from "@discord-plays-mario-kart/common";
import { Avatar } from "#src/ui/avatar.tsx";
import { Badge } from "#src/ui/badge.tsx";
import { CheckerStrip } from "#src/ui/mk.tsx";
import { LapTime, PlaceBadge } from "./bits.tsx";
import { GAME_MODE_LABELS, relativeTime } from "./format.ts";

/** Races, newest first, each with its human racers by placement. */
export function RaceList({
  races,
  nowMs,
  highlightId,
}: {
  races: readonly RaceSummary[];
  nowMs: number;
  /** Discord id whose row is emphasised (the viewed player). */
  highlightId?: string;
}) {
  return (
    <ul className="space-y-2">
      {races.map((race) => (
        <li
          key={race.id}
          className="relative overflow-hidden rounded-xl border border-border-subtle bg-surface-sunken px-3 pt-3.5 pb-2.5"
        >
          <CheckerStrip className="absolute inset-x-0 top-0 h-1.5 opacity-70" />
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="mk-title truncate text-base text-white">
              {courseName(race.courseId)}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <Badge>{GAME_MODE_LABELS[race.gameMode]}</Badge>
              <span className="text-[11px] text-ink-muted">
                {relativeTime(race.finishedAtMs, nowMs)}
              </span>
            </span>
          </div>
          <ul className="space-y-1">
            {race.results.map((result, index) => {
              const name =
                result.player?.name ?? result.name ?? "Unknown driver";
              const emphasised =
                highlightId !== undefined &&
                result.player?.discordId === highlightId;
              return (
                <li
                  key={`${String(race.id)}-${String(index)}`}
                  className="flex items-center gap-2 text-xs"
                >
                  <PlaceBadge place={result.placement} size="sm" />
                  <Avatar
                    name={name}
                    url={result.player?.avatarUrl ?? null}
                    seed={result.player?.discordId ?? name}
                    size="xs"
                  />
                  <span
                    className={
                      emphasised
                        ? "min-w-0 flex-1 truncate font-semibold text-ink"
                        : "min-w-0 flex-1 truncate text-ink-muted"
                    }
                  >
                    {name}
                  </span>
                  <span className="hidden text-ink-muted sm:inline">
                    {characterName(result.characterId)}
                  </span>
                  <LapTime
                    ms={result.raceTimeMs}
                    finished={result.finished}
                    className="w-16 text-right text-xs"
                  />
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
