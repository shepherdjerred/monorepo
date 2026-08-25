import { useQuery } from "@tanstack/react-query";
import { Input } from "@scout-for-lol/design-system/components/input";
import { Label } from "@scout-for-lol/design-system/components/label";
import { PlayerIdSchema, type PlayerId } from "@scout-for-lol/data";
import { useState } from "react";
import { useTRPC } from "#src/lib/trpc.ts";

export function CompetitionBuilderEntrants(props: {
  guildId: string;
  visibility: "OPEN" | "INVITE_ONLY" | "SERVER_WIDE";
  selected: PlayerId[];
  cap: number;
  canInvite: boolean;
  onChange: (selected: PlayerId[]) => void;
}) {
  const trpc = useTRPC();
  const [query, setQuery] = useState("");
  const players = useQuery(
    trpc.player.listPlayers.queryOptions({
      guildId: props.guildId,
      query: query.trim(),
      limit: 100,
    }),
  );

  if (props.visibility === "SERVER_WIDE") {
    return (
      <p className="text-sm text-scout-subtle">
        Scout will enroll every eligible tracked player, oldest tracked first,
        up to the {props.cap.toString()}-player cap. Manual selection is
        ignored.
      </p>
    );
  }
  if (!props.canInvite) {
    return (
      <p className="text-sm text-scout-subtle">
        You need the competition invite permission to choose initial entrants.
        You can still create the competition with an empty roster.
      </p>
    );
  }

  const selectedIds = new Set(props.selected);
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="competition-player-search">Tracked players</Label>
        <Input
          id="competition-player-search"
          type="search"
          placeholder="Filter tracked players"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
      </div>
      <p className="text-xs text-scout-subtle">
        Selected players join immediately. {props.selected.length.toString()} of{" "}
        {props.cap.toString()} selected.
      </p>
      <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border p-2">
        {players.isLoading && (
          <p className="p-2 text-sm text-scout-subtle">Loading players…</p>
        )}
        {players.data?.items.map((player) => {
          const playerId = PlayerIdSchema.parse(player.id);
          const checked = selectedIds.has(playerId);
          const atCap = !checked && props.selected.length >= props.cap;
          return (
            <label
              key={playerId}
              className="flex cursor-pointer items-center gap-3 rounded p-2 text-sm hover:bg-scout-hover"
            >
              <input
                type="checkbox"
                className="size-5"
                checked={checked}
                disabled={atCap}
                onChange={(event) => {
                  props.onChange(
                    event.target.checked
                      ? [...props.selected, playerId]
                      : props.selected.filter((id) => id !== playerId),
                  );
                }}
              />
              <span>{player.alias}</span>
            </label>
          );
        })}
        {!players.isLoading && players.data?.items.length === 0 && (
          <p className="p-2 text-sm text-scout-subtle">
            No tracked players match this search.
          </p>
        )}
      </div>
    </div>
  );
}
