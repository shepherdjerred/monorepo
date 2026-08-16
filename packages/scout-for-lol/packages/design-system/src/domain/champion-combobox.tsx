import { browserChampions } from "@scout-for-lol/data/browser-assets";
import { useEffect, useMemo, useState } from "react";
import { ChampionPortrait } from "#src/assets/index.tsx";
import { Combobox } from "#src/components/combobox.tsx";

export type ChampionOption = (typeof browserChampions)[number];

export function ChampionCombobox(props: {
  value: ChampionOption | undefined;
  onChange: (champion: ChampionOption) => void;
  disabled?: boolean | undefined;
  id?: string | undefined;
  placeholder?: string | undefined;
  onQueryChange?: ((query: string) => void) | undefined;
}) {
  const [query, setQuery] = useState(props.value?.name ?? "");
  useEffect(() => {
    setQuery(props.value?.name ?? "");
  }, [props.value]);
  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized.length === 0
      ? browserChampions
      : browserChampions.filter((champion) =>
          champion.name.toLowerCase().includes(normalized),
        );
  }, [query]);
  return (
    <Combobox
      id={props.id}
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
