import {
  browserClassicChampions,
  browserModernChampions,
} from "@scout-for-lol/data/browser-assets";
import type { CompetitionGameVariant } from "@scout-for-lol/data";
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
  gameVariant: CompetitionGameVariant;
  name?: string;
  required?: boolean;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}) {
  const champions =
    props.gameVariant === "MODERN"
      ? browserModernChampions
      : browserClassicChampions;
  const championId = Number.parseInt(props.value, 10);
  const value = Number.isNaN(championId)
    ? undefined
    : champions.find((champion) => champion.id === championId);

  return (
    <ScoutChampionCombobox
      value={value}
      items={champions}
      onChange={(champion) => {
        props.onChange(champion.id.toString());
      }}
      onQueryChange={(query) => {
        const normalized = query.trim().toLowerCase();
        const exact = champions.find(
          (champion) => champion.name.toLowerCase() === normalized,
        );
        props.onChange(exact?.id.toString() ?? "");
      }}
      disabled={props.disabled}
      id={props.id}
      name={props.name}
      required={props.required}
      ariaInvalid={props.ariaInvalid}
      ariaDescribedBy={props.ariaDescribedBy}
    />
  );
}
