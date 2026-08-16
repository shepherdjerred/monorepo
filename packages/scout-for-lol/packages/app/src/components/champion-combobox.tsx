import { browserChampions } from "@scout-for-lol/data/browser-assets";
import { ChampionCombobox as ScoutChampionCombobox } from "@scout-for-lol/design-system/domain/champion-combobox";

/**
 * Adapts the shared champion picker to the app form contract, where a champion
 * id is stored as a string and unresolved free text clears that id.
 */
export function ChampionCombobox(props: {
  value: string;
  onChange: (championId: string) => void;
  disabled?: boolean;
  id?: string;
}) {
  const championId = Number.parseInt(props.value, 10);
  const value = Number.isNaN(championId)
    ? undefined
    : browserChampions.find((champion) => champion.id === championId);

  return (
    <ScoutChampionCombobox
      value={value}
      onChange={(champion) => {
        props.onChange(champion.id.toString());
      }}
      onQueryChange={(query) => {
        const normalized = query.trim().toLowerCase();
        const exact = browserChampions.find(
          (champion) => champion.name.toLowerCase() === normalized,
        );
        props.onChange(exact?.id.toString() ?? "");
      }}
      disabled={props.disabled}
      id={props.id}
    />
  );
}
