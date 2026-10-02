import {
  PLAYER_PROFILE_QUEUE_GROUPS,
  PLAYER_PROFILE_QUEUE_PRESETS,
  queueTypeToDisplayString,
  type PlayerProfileGameWindow,
  type QueueType,
} from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { useState } from "react";
import type { PlayerProfileFilters } from "#src/lib/player/player-profile-filters.ts";

function sameQueues(
  selected: QueueType[] | undefined,
  preset: readonly QueueType[] | undefined,
): boolean {
  return selected === undefined || preset === undefined
    ? selected === undefined && preset === undefined
    : selected.length === preset.length &&
        selected.every((queue) => preset.includes(queue));
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
  const [draft, setDraft] = useState<QueueType[]>(
    props.filters.queues ??
      PLAYER_PROFILE_QUEUE_GROUPS.flatMap((group) => group.queues),
  );
  const activePreset = PRESETS.find((preset) =>
    sameQueues(props.filters.queues, preset.queues),
  );

  function toggleQueue(queue: QueueType, checked: boolean): void {
    const selected = draft;
    const queues = checked
      ? [...selected, queue]
      : selected.filter((selectedQueue) => selectedQueue !== queue);
    setDraft(queues);
  }

  return (
    <div className="space-y-4 border-b pb-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="space-y-1 text-sm font-medium">
          <span className="block">Games</span>
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
          <legend className="text-sm font-medium">Queues</legend>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <Button
                key={preset.id}
                type="button"
                size="sm"
                aria-pressed={activePreset?.id === preset.id}
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
              ? "All queues"
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
                    checked={draft.includes(queue)}
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
        <div className="mt-4 flex items-center gap-3">
          <Button
            size="sm"
            disabled={draft.length === 0}
            onClick={() => {
              props.onChange(
                { games: props.filters.games, queues: draft },
                "queues",
              );
            }}
          >
            Apply queues
          </Button>
          {draft.length === 0 && (
            <p className="text-sm text-scout-subtle">
              Choose at least one queue.
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
