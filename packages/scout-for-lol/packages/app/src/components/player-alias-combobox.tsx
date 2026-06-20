import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "#src/lib/trpc.ts";
import { useDebouncedValue } from "#src/hooks/use-debounced-value.ts";
import { Combobox } from "#src/components/ui/combobox.tsx";

type PlayerSummary = { id: number; alias: string };

/**
 * Typeahead for picking an existing player by alias, backed by the existing
 * `player.listPlayers` search. `value` is the chosen alias (also editable
 * free-text, so a not-yet-listed alias can still be typed).
 */
export function PlayerAliasCombobox(props: {
  guildId: string;
  value: string;
  onChange: (alias: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
}) {
  const trpc = useTRPC();
  const [query, setQuery] = useState(props.value);
  const debounced = useDebouncedValue(query);
  const search = useQuery(
    trpc.player.listPlayers.queryOptions(
      { guildId: props.guildId, query: debounced.trim(), limit: 20 },
      { enabled: debounced.trim().length > 0 },
    ),
  );

  return (
    <Combobox<PlayerSummary>
      value={query}
      onValueChange={(text) => {
        setQuery(text);
        props.onChange(text);
      }}
      items={search.data?.items ?? []}
      isLoading={search.isFetching}
      getKey={(player) => player.id.toString()}
      onSelect={(player) => {
        setQuery(player.alias);
        props.onChange(player.alias);
      }}
      disabled={props.disabled}
      placeholder={props.placeholder ?? "Search players"}
      emptyText="No matching players."
      className={props.className}
      id={props.id}
      renderItem={(player) => <span className="truncate">{player.alias}</span>}
    />
  );
}
