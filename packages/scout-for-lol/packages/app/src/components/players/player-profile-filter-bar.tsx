import {
  PLAYER_PROFILE_QUEUE_GROUPS,
  PLAYER_PROFILE_QUEUE_PRESETS,
  queueTypeToDisplayString,
  type PlayerProfileGameWindow,
  type QueueType,
} from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import type { PlayerProfileFilters } from "#src/lib/player-profile-filters.ts";

function sameQueues(
  selected: QueueType[] | undefined,
  preset: readonly QueueType[] | undefined,
): boolean {
  if (selected === undefined || preset === undefined) {
    return selected === undefined && preset === undefined;
  }
  return (
    selected.length === preset.length &&
    selected.every((queue) => preset.includes(queue))
  );
}

const PRESETS: readonly {
  id: string;
  label: string;
  queues?: readonly QueueType[];
}[] = [
  { id: "all", label: "All games" },
  {
    id: "competitive",
    label: "Competitive",
    queues: PLAYER_PROFILE_QUEUE_PRESETS.competitive,
  },
  {
    id: "solo",
    label: "Solo / duo",
    queues: PLAYER_PROFILE_QUEUE_PRESETS.solo,
  },
  { id: "flex", label: "Flex", queues: PLAYER_PROFILE_QUEUE_PRESETS.flex },
  { id: "clash", label: "Clash", queues: PLAYER_PROFILE_QUEUE_PRESETS.clash },
];

export function PlayerProfileFilterBar(props: {
  filters: PlayerProfileFilters;
  onChange: (filters: PlayerProfileFilters, kind: "games" | "queues") => void;
}) {
  const activePreset = PRESETS.find((preset) =>
    sameQueues(props.filters.queues, preset.queues),
  );

  function toggleQueue(queue: QueueType, checked: boolean): void {
    const selected = props.filters.queues ?? [];
    const queues = checked
      ? [...selected, queue]
      : selected.filter((selectedQueue) => selectedQueue !== queue);
    props.onChange(
      {
        games: props.filters.games,
        ...(queues.length === 0 ? {} : { queues }),
      },
      "queues",
    );
  }

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="space-y-1 text-sm font-medium">
          <span className="block">Game window</span>
          <select
            name="games"
            value={props.filters.games.toString()}
            className="h-9 rounded-md border border-input bg-background px-3"
            onChange={(event) => {
              const value = event.currentTarget.value;
              const games: PlayerProfileGameWindow =
                value === "50" ? 50 : value === "all" ? "all" : 20;
              props.onChange({ ...props.filters, games }, "games");
            }}
          >
            <option value="20">Last 20</option>
            <option value="50">Last 50</option>
            <option value="all">All time</option>
          </select>
        </label>

        <fieldset className="min-w-0 space-y-2">
          <legend className="text-sm font-medium">Queue preset</legend>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                variant={activePreset?.id === preset.id ? "default" : "outline"}
                onClick={() => {
                  props.onChange(
                    {
                      games: props.filters.games,
                      ...(preset.queues === undefined
                        ? {}
                        : { queues: [...preset.queues] }),
                    },
                    "queues",
                  );
                }}
              >
                {preset.label}
              </Button>
            ))}
            {activePreset === undefined && (
              <Badge className="h-8 px-3">Custom</Badge>
            )}
          </div>
        </fieldset>
      </div>

      <details>
        <summary className="cursor-pointer text-sm font-medium">
          Choose queues
          <span className="ml-2 font-normal text-scout-subtle">
            {props.filters.queues === undefined
              ? "Every recorded queue, including unmapped history"
              : `${props.filters.queues.length.toString()} selected`}
          </span>
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLAYER_PROFILE_QUEUE_GROUPS.map((group) => (
            <fieldset key={group.label} className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-scout-subtle">
                {group.label}
              </legend>
              {group.queues.map((queue) => (
                <label key={queue} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="queue"
                    value={queue}
                    checked={props.filters.queues?.includes(queue) ?? false}
                    onChange={(event) => {
                      toggleQueue(queue, event.currentTarget.checked);
                    }}
                  />
                  {queueTypeToDisplayString(queue)}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
      </details>
    </div>
  );
}
