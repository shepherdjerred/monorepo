import {
  championNameToDisplayName,
  getChampionImageUrl,
} from "@scout-for-lol/data";
import { ChampionPortrait } from "@scout-for-lol/design-system/assets";
import { cn } from "#src/lib/cn.ts";

/**
 * The app's first browser-side Data Dragon asset.
 *
 * `champion.json` is already in this bundle (report-query-champions.ts parses
 * it for the champion combobox), so the icon costs no extra bundle weight —
 * `getChampionImageUrl` only builds a CDN URL.
 *
 * Champion names on match data are Data Dragon asset keys, so the key goes to
 * the image lookup while every visible label goes through
 * `championNameToDisplayName` (the difference between "MonkeyKing" and
 * "Wukong").
 *
 * A League Classic champion (`Jade_*`) has no Data Dragon CDN image, so it
 * resolves through the bundled game asset manifest instead.
 */
export function ChampionIcon(props: {
  championName: string;
  size?: "sm" | "md";
  className?: string;
  decorative?: boolean;
}) {
  const display = championNameToDisplayName(props.championName);
  const pixels = props.size === "md" ? 40 : 32;

  if (props.championName.startsWith("Jade_")) {
    return (
      <ChampionPortrait
        champion={props.championName}
        alt={props.decorative === true ? "" : display}
        title={display}
        style={{ width: pixels, height: pixels }}
        className={cn("rounded-md bg-muted", props.className)}
      />
    );
  }

  return (
    <img
      src={getChampionImageUrl(props.championName)}
      alt={props.decorative === true ? "" : display}
      title={display}
      width={pixels}
      height={pixels}
      loading="lazy"
      className={cn("rounded-md bg-muted", props.className)}
    />
  );
}
