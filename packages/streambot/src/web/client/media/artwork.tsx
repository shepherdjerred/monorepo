import { useState } from "react";
import type { MediaItem } from "./row-model.ts";

const GLYPHS: Readonly<Record<MediaItem["kind"], string>> = {
  song: "♪",
  album: "◎",
  artist: "☺",
  library: "▶",
  series: "▶",
  video: "▶",
  live: "●",
  history: "↺",
  link: "↗",
  playlist: "≡",
};

function source(item: Pick<MediaItem, "artworkUrl" | "sportsArtwork">): {
  url: string;
  logo: boolean;
} | null {
  if (item.artworkUrl !== undefined)
    return { url: item.artworkUrl, logo: false };
  const sports = item.sportsArtwork;
  if (sports?.thumbnailUrl !== undefined)
    return { url: sports.thumbnailUrl, logo: false };
  const logo = sports?.teams[0]?.logoUrl ?? sports?.league?.logoUrl;
  return logo === undefined ? null : { url: logo, logo: true };
}

/**
 * The picture beside a row or on a card. Decorative (the title is beside it), so its alt text is
 * empty; a missing or broken image falls back to a glyph for the kind of media.
 */
export function Artwork(props: {
  item: Pick<MediaItem, "artworkUrl" | "sportsArtwork" | "kind">;
  shape: "thumb" | "poster";
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const picked = source(props.item);
  const className = "artwork artwork-" + props.shape;
  if (picked === null || failed === picked.url)
    return (
      <span className={className + " artwork-empty"} aria-hidden="true">
        {GLYPHS[props.item.kind]}
      </span>
    );
  return (
    <img
      className={className + (picked.logo ? " artwork-logo" : "")}
      src={picked.url}
      alt=""
      width={props.shape === "thumb" ? 44 : 200}
      height={props.shape === "thumb" ? 44 : 300}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(picked.url);
      }}
    />
  );
}
