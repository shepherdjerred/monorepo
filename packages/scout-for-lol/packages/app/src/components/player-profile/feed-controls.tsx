import { PLAYER_PROFILE_QUEUE_GROUPS } from "@scout-for-lol/data";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetTrigger,
} from "@scout-for-lol/design-system/components/overlays/bottom-sheet";
import { Chip } from "@scout-for-lol/design-system/components/surfaces/chip";
import { SlidersHorizontal } from "lucide-react";
import {
  allGamesFilters,
  GAME_WINDOWS,
  includedQueues,
  isAllGames,
  isRankedGames,
  rankedFilters,
  toggleQueue,
} from "#src/lib/player/feed-filters.ts";
import { queueLabel } from "#src/lib/player/player-feed.ts";
import type { PlayerProfileFilters } from "#src/lib/player/player-profile-filters.ts";

export type FilterKind = "games" | "queues";

type Props = {
  filters: PlayerProfileFilters;
  onChange: (filters: PlayerProfileFilters, kind: FilterKind) => void;
};

/** Which games the page shows: all of them, the ranked ones, or something finer. */
export function FeedControls({ filters, onChange }: Props) {
  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label="Which games to show"
    >
      <Chip
        pressed={isAllGames(filters)}
        onClick={() => {
          onChange(allGamesFilters(filters), "queues");
        }}
      >
        All
      </Chip>
      <Chip
        pressed={isRankedGames(filters)}
        onClick={() => {
          onChange(rankedFilters(filters), "queues");
        }}
      >
        Ranked
      </Chip>
      <MoreFilters filters={filters} onChange={onChange} />
    </div>
  );
}

function MoreFilters({ filters, onChange }: Props) {
  const included = includedQueues(filters);
  return (
    <BottomSheet>
      <BottomSheetTrigger asChild>
        <Chip variant="ghost" aria-haspopup="dialog">
          <SlidersHorizontal size={18} aria-hidden="true" />
          More filters
        </Chip>
      </BottomSheetTrigger>
      <BottomSheetContent title="More filters">
        <div className="grid gap-5 overflow-y-auto px-5 pb-6">
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-2 font-display text-lg font-bold">
              Games
            </legend>
            <div className="flex flex-wrap gap-2">
              {GAME_WINDOWS.map((window) => (
                <Chip
                  key={window.value}
                  pressed={filters.games === window.value}
                  onClick={() => {
                    onChange({ ...filters, games: window.value }, "games");
                  }}
                >
                  {window.label}
                </Chip>
              ))}
            </div>
          </fieldset>
          {PLAYER_PROFILE_QUEUE_GROUPS.map((group) => (
            <fieldset key={group.label} className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-2 font-display text-lg font-bold">
                {group.label}
              </legend>
              <div className="flex flex-wrap gap-2">
                {group.queues.map((queue) => (
                  <Chip
                    key={queue}
                    pressed={included.includes(queue)}
                    onClick={() => {
                      const queues = toggleQueue(filters.queues, queue);
                      onChange(
                        {
                          games: filters.games,
                          ...(queues === undefined ? {} : { queues }),
                        },
                        "queues",
                      );
                    }}
                  >
                    {queueLabel(queue) ?? queue}
                  </Chip>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </BottomSheetContent>
    </BottomSheet>
  );
}
