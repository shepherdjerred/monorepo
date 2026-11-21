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

/**
 * The box a card gives each kind of media: Plex titles are 2:3 posters, music art is square, and
 * videos, live events and history entries are 16:9 frames.
 */
const POSTER_BOX: Readonly<
  Record<MediaItem["kind"], { name: string; width: number; height: number }>
> = {
  library: { name: "tall", width: 200, height: 300 },
  series: { name: "tall", width: 200, height: 300 },
  song: { name: "square", width: 200, height: 200 },
  album: { name: "square", width: 200, height: 200 },
  artist: { name: "square", width: 200, height: 200 },
  playlist: { name: "square", width: 200, height: 200 },
  video: { name: "wide", width: 320, height: 180 },
  live: { name: "wide", width: 320, height: 180 },
  history: { name: "wide", width: 320, height: 180 },
  link: { name: "wide", width: 320, height: 180 },
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
  const box =
    props.shape === "thumb"
      ? { name: "thumb", width: 44, height: 44 }
      : POSTER_BOX[props.item.kind];
  const className = "artwork artwork-" + props.shape + " artwork-" + box.name;
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
      width={box.width}
      height={box.height}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(picked.url);
      }}
    />
  );
}
