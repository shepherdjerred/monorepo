import {
  characterName,
  courseName,
  type RaceSummary,
} from "@discord-plays-mario-kart/common";
import { Avatar } from "#src/ui/avatar.tsx";
import { Badge } from "#src/ui/badge.tsx";
import { PlaceBadge } from "./bits.tsx";
import { GAME_MODE_LABELS, formatRaceTime, relativeTime } from "./format.ts";

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
          className="rounded-xl border border-border-subtle bg-surface-sunken px-3 py-2.5"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold text-ink">
              {courseName(race.courseId)}
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <Badge>{GAME_MODE_LABELS[race.gameMode]}</Badge>
              <span className="text-[11px] text-ink-faint">
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
                  <span className="hidden text-ink-faint sm:inline">
                    {characterName(result.characterId)}
                  </span>
                  <span className="w-14 text-right font-mono text-ink-muted tabular-nums">
                    {result.finished
                      ? formatRaceTime(result.raceTimeMs)
                      : "DNF"}
                  </span>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}
