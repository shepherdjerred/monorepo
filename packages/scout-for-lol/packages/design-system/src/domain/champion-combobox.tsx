import { browserChampions } from "@scout-for-lol/data/browser-assets";
import { useMemo, useState } from "react";
import { ChampionPortrait } from "#src/assets/index.tsx";
import { Combobox } from "#src/components/combobox.tsx";

export type ChampionOption = (typeof browserChampions)[number];

/**
 * Query text to show after the selected champion changes underneath the input.
 *
 * A new selection always wins. A cleared selection is only adopted when the
 * input still shows the champion that was just cleared: text the user is in the
 * middle of typing is never overwritten.
 */
export function syncedChampionQuery(input: {
  query: string;
  previous: ChampionOption | undefined;
  next: ChampionOption | undefined;
}): string {
  if (input.next !== undefined) {
    return input.next.name;
  }
  return input.query === (input.previous?.name ?? "") ? "" : input.query;
}

export function ChampionCombobox(props: {
  value: ChampionOption | undefined;
  onChange: (champion: ChampionOption) => void;
  items?: ChampionOption[] | undefined;
  disabled?: boolean | undefined;
  id?: string | undefined;
  name?: string | undefined;
  required?: boolean | undefined;
  ariaInvalid?: boolean | undefined;
  ariaDescribedBy?: string | undefined;
  placeholder?: string | undefined;
  onQueryChange?: ((query: string) => void) | undefined;
}) {
  const [query, setQuery] = useState(props.value?.name ?? "");
  const [syncedValue, setSyncedValue] = useState(props.value);
  if (props.value?.key !== syncedValue?.key) {
    setSyncedValue(props.value);
    setQuery(
      syncedChampionQuery({ query, previous: syncedValue, next: props.value }),
    );
  }
  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const source = props.items ?? browserChampions;
    return normalized.length === 0
      ? source
      : source.filter((champion) =>
          champion.name.toLowerCase().includes(normalized),
        );
  }, [props.items, query]);
  return (
    <Combobox
      id={props.id}
      name={props.name}
      required={props.required}
      ariaInvalid={props.ariaInvalid}
      ariaDescribedBy={props.ariaDescribedBy}
      value={query}
      onValueChange={(value) => {
        setQuery(value);
        props.onQueryChange?.(value);
      }}
      items={items}
      isLoading={false}
      disabled={props.disabled}
      openOnEmptyQuery
      placeholder={props.placeholder ?? "Search champions"}
      getKey={(champion) => champion.key}
      renderItem={(champion) => (
        <>
          <ChampionPortrait
            champion={champion.key}
            alt=""
            style={{ width: 28, height: 28 }}
          />
          <span>{champion.name}</span>
        </>
      )}
      onSelect={(champion) => {
        setQuery(champion.name);
        props.onChange(champion);
      }}
      onBlur={() => {
        setQuery(props.value?.name ?? "");
      }}
    />
  );
}
