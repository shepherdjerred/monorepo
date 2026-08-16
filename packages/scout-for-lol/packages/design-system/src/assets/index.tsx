import {
  gameAssetManifest,
  getBrowserChampionName,
  getGameAsset,
  type GameAssetKind,
  type GameAssetManifestEntry,
} from "@scout-for-lol/data/browser-assets";
import type { CSSProperties, ImgHTMLAttributes, ReactNode } from "react";

export const SCOUT_GAME_ASSET_VERSION = gameAssetManifest.sourceVersion;
export const SCOUT_GAME_ASSET_ROOT = `/assets/scout/game/${SCOUT_GAME_ASSET_VERSION}`;

export function gameAssetUrl(asset: GameAssetManifestEntry): string {
  return `${SCOUT_GAME_ASSET_ROOT}/${asset.relativePath}`;
}

export function resolveGameAssetUrl(
  kind: GameAssetKind,
  canonicalKey: string | number,
): string {
  return gameAssetUrl(getGameAsset(kind, canonicalKey));
}

type AssetImageProps = Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  "src" | "width" | "height" | "alt"
> & {
  kind: GameAssetKind;
  assetKey: string | number;
  alt: string;
  priority?: boolean;
  optional?: boolean;
  placeholder?: ReactNode;
  crop?: "contain" | "cover";
};

export function GameAssetImage(props: AssetImageProps) {
  const {
    kind,
    assetKey,
    alt,
    priority = false,
    optional = false,
    placeholder,
    crop = "cover",
    style,
    ...imageProps
  } = props;
  let asset: GameAssetManifestEntry;
  try {
    asset = getGameAsset(kind, assetKey);
  } catch (error) {
    if (!optional) throw error;
    return (
      placeholder ?? (
        <span className="scout-asset-placeholder" role="img" aria-label={alt} />
      )
    );
  }
  const imageStyle: CSSProperties = { objectFit: crop, ...style };
  return (
    <img
      {...imageProps}
      src={gameAssetUrl(asset)}
      width={asset.width}
      height={asset.height}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      style={imageStyle}
    />
  );
}

type ChampionArtProps = Omit<AssetImageProps, "kind" | "assetKey" | "alt"> & {
  champion: string | number;
  alt?: string;
};

function championAlt(
  champion: string | number,
  alt: string | undefined,
  optional: boolean | undefined,
  suffix: string,
): string {
  if (alt !== undefined) return alt;
  if (optional === true) return `Unknown champion${suffix}`;
  return `${getBrowserChampionName(champion)}${suffix}`;
}

export function ChampionPortrait({
  champion,
  alt,
  ...props
}: ChampionArtProps) {
  return (
    <GameAssetImage
      {...props}
      kind="champion"
      assetKey={champion}
      alt={championAlt(champion, alt, props.optional, "")}
    />
  );
}
export function ChampionLoadingArt({
  champion,
  alt,
  ...props
}: ChampionArtProps) {
  return (
    <GameAssetImage
      {...props}
      kind="champion-loading"
      assetKey={champion}
      alt={championAlt(champion, alt, props.optional, " loading art")}
    />
  );
}
export function ChampionSplashArt({
  champion,
  alt,
  ...props
}: ChampionArtProps) {
  return (
    <GameAssetImage
      {...props}
      kind="champion-splash"
      assetKey={champion}
      alt={championAlt(champion, alt, props.optional, " splash art")}
    />
  );
}
export function ItemIcon(
  props: Omit<AssetImageProps, "kind" | "assetKey"> & { item: string | number },
) {
  const { item, ...imageProps } = props;
  return <GameAssetImage {...imageProps} kind="item" assetKey={item} />;
}
export function RuneIcon(
  props: Omit<AssetImageProps, "kind" | "assetKey"> & { rune: string | number },
) {
  const { rune, ...imageProps } = props;
  return <GameAssetImage {...imageProps} kind="rune" assetKey={rune} />;
}
export function SummonerSpellIcon(
  props: Omit<AssetImageProps, "kind" | "assetKey"> & {
    spell: string | number;
  },
) {
  const { spell, ...imageProps } = props;
  return <GameAssetImage {...imageProps} kind="spell" assetKey={spell} />;
}
export function AugmentIcon(
  props: Omit<AssetImageProps, "kind" | "assetKey"> & {
    augment: string | number;
  },
) {
  const { augment, ...imageProps } = props;
  return <GameAssetImage {...imageProps} kind="augment" assetKey={augment} />;
}
export function LaneIcon(
  props: Omit<AssetImageProps, "kind" | "assetKey"> & { lane: string },
) {
  const { lane, ...imageProps } = props;
  return <GameAssetImage {...imageProps} kind="lane" assetKey={lane} />;
}

export const SCOUT_RANKS = [
  "Iron",
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Emerald",
  "Diamond",
  "Master",
  "Grandmaster",
  "Challenger",
] as const;
export type ScoutRank = (typeof SCOUT_RANKS)[number];
export function rankCrestUrl(rank: ScoutRank): string {
  return `/assets/scout/shared/ranks/Rank=${rank}.png`;
}
export function RankCrest(
  props: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt"> & {
    rank: ScoutRank;
    alt?: string;
  },
) {
  const { rank, alt, ...imageProps } = props;
  return (
    <img
      {...imageProps}
      src={rankCrestUrl(rank)}
      alt={alt ?? `${rank} rank crest`}
      loading="lazy"
      decoding="async"
    />
  );
}
