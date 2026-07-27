import { useEffect, useRef, useState } from "react";
import { reportChampions } from "@scout-for-lol/data";
import { Combobox } from "#src/components/ui/combobox.tsx";

type ChampionEntry = { id: number; name: string };

const CHAMPIONS: ChampionEntry[] = reportChampions();

function championNameForId(value: string): string {
  const id = Number.parseInt(value, 10);
  if (Number.isNaN(id)) {
    return "";
  }
  return CHAMPIONS.find((champion) => champion.id === id)?.name ?? "";
}

/**
 * Champion picker backed by the local Data Dragon catalog. `value` is the
 * numeric champion id as a form-state string ("" = none). Free text that
 * exactly matches a champion name selects it; anything else clears the id so
 * form validation still catches an unresolved champion.
 */
export function ChampionCombobox(props: {
  value: string;
  onChange: (championId: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const [query, setQuery] = useState(() => championNameForId(props.value));
  // The last id this component emitted, so the sync effect can tell an external
  // value change (apply a preset) apart from the echo of our own onChange —
  // otherwise clearing the id while typing a partial name would wipe the input.
  const lastEmitted = useRef(props.value);

  // Keep the input text in sync when the controlled champion id changes from
  // outside (e.g. applying a preset that sets a different champion) so the
  // field never displays a champion the form state no longer holds.
  useEffect(() => {
    if (props.value === lastEmitted.current) {
      return;
    }
    lastEmitted.current = props.value;
    setQuery(championNameForId(props.value));
  }, [props.value]);

  const emit = (championId: string) => {
    lastEmitted.current = championId;
    props.onChange(championId);
  };

  const matches =
    query.trim().length === 0
      ? []
      : CHAMPIONS.filter((champion) =>
          champion.name.toLowerCase().includes(query.trim().toLowerCase()),
        ).slice(0, 20);

  return (
    <Combobox<ChampionEntry>
      value={query}
      onValueChange={(text) => {
        setQuery(text);
        const exact = CHAMPIONS.find(
          (champion) =>
            champion.name.toLowerCase() === text.trim().toLowerCase(),
        );
        emit(exact === undefined ? "" : exact.id.toString());
      }}
      items={matches}
      isLoading={false}
      getKey={(champion) => champion.id.toString()}
      onSelect={(champion) => {
        setQuery(champion.name);
        emit(champion.id.toString());
      }}
      disabled={props.disabled}
      placeholder="Search champions"
      id={props.id}
      renderItem={(champion) => (
        <span className="truncate">{champion.name}</span>
      )}
    />
  );
}
