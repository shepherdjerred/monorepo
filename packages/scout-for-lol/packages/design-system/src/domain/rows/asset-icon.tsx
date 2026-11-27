import { GameAssetImage } from "#src/assets/index.tsx";
import { cn } from "#src/lib/cn.ts";

/** A game icon a row can show: an item, rune, summoner spell, ability or lane. */
export type AssetRef = {
  kind: "item" | "rune" | "spell" | "ability" | "lane";
  key: string | number;
};

/**
 * A small square icon from the game assets. The label is the icon's accessible
 * name; pass an empty string when the words beside it already say it.
 */
export function AssetIcon({
  asset,
  label,
  className,
}: {
  asset: AssetRef;
  label: string;
  className?: string;
}) {
  return (
    <span className={cn("scout-asset-icon", className)} data-kind={asset.kind}>
      <GameAssetImage kind={asset.kind} assetKey={asset.key} alt={label} />
    </span>
  );
}
