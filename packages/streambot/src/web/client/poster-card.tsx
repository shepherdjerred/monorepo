import type { z } from "zod";
import { Link } from "react-router";
import type { LibraryTitleSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { Artwork } from "./artwork.tsx";
import { MediaActions, type MediaListProps } from "./media-row.tsx";

export function PosterCard({
  item,
  openSeries,
  seriesHref,
  ...props
}: MediaListProps & {
  item: z.infer<typeof LibraryTitleSchema>;
  openSeries: (series: string, library: string) => void;
  seriesHref?: (series: string, library: string) => string;
}) {
  const artwork = (
    <Artwork
      className="poster-artwork"
      {...(item.artworkUrl === undefined ? {} : { url: item.artworkUrl })}
    />
  );
  return (
    <article className="poster-card">
      {item.kind === "series" ? (
        <Link
          className="poster-open"
          aria-label={"Browse episodes of " + item.title}
          to={seriesHref?.(item.series, item.library) ?? "/plex"}
          onClick={
            seriesHref === undefined
              ? () => {
                  openSeries(item.series, item.library);
                }
              : undefined
          }
        >
          {artwork}
          <h3>{item.title}</h3>
          <p>
            {item.seasons} {item.seasons === 1 ? "season" : "seasons"} ·{" "}
            {item.episodes} {item.episodes === 1 ? "episode" : "episodes"}
          </p>
          <span className="poster-browse">Browse episodes ↗</span>
        </Link>
      ) : (
        <>
          {artwork}
          <h3>{item.title}</h3>
          <p>
            {[item.library, item.year]
              .filter((value) => value !== undefined)
              .join(" · ")}
          </p>
          <MediaActions
            {...props}
            title={item.title}
            selection={{ kind: "library", id: item.id }}
          />
        </>
      )}
    </article>
  );
}
