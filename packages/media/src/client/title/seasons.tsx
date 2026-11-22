import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRightIcon } from "lucide-react";
import { Link } from "react-router";
import { MediaDetailSchema } from "#shared/api.ts";
import type { MediaItem } from "#shared/contract.ts";
import { readApi } from "#client/api.ts";
import { AVAILABILITY_COPY } from "#client/presentation/availability.ts";
import { classNames } from "#client/ui/class-names.ts";
import { StatePill } from "#client/ui/poster-card.tsx";
import { RowsSkeleton } from "#client/ui/skeleton.tsx";
import { ErrorState } from "#client/ui/states.tsx";
import styles from "./title.module.css";

const cx = classNames(styles);

/** The address of a library item's own page. */
export function mediaPath(id: string): string {
  return `/media/${encodeURIComponent(id)}`;
}

/** How a title page reads a library item; seasons share its cache. */
export function readMedia(id: string) {
  return readApi(mediaPath(id), MediaDetailSchema);
}

/**
 * A season's episodes, each with where it stands in plain words and a link
 * to its own page, where it can be asked for by itself.
 */
export function EpisodeList({
  label,
  episodes,
}: {
  label: string;
  episodes: readonly MediaItem[];
}) {
  if (episodes.length === 0) {
    return (
      <p className={cx("quiet")}>
        The catalog has not listed this season’s episodes yet.
      </p>
    );
  }
  return (
    <ul className={cx("rows")} aria-label={label}>
      {episodes.map((episode) => (
        <li className={cx("row")} key={episode.id}>
          <span className={cx("rowNumber")} aria-hidden="true">
            {episode.episodeNumber ?? ""}
          </span>
          <Link className={cx("rowLink")} to={mediaPath(episode.id)}>
            <span className="sr-only">
              {episode.episodeNumber === null
                ? ""
                : `Episode ${String(episode.episodeNumber)}: `}
            </span>
            {episode.title}
          </Link>
          {episode.catalogState === "pending" && (
            <span className={cx("quiet")}>Details still loading</span>
          )}
          <StatePill state={AVAILABILITY_COPY[episode.availability]} />
        </li>
      ))}
    </ul>
  );
}

/** One season of a series: closed until asked for, then its episodes. */
function Season({ season }: { season: MediaItem }) {
  // The episodes are read the first time the season is opened.
  const [opened, setOpened] = useState(false);
  const detail = useQuery({
    queryKey: ["media", season.id],
    enabled: opened,
    queryFn: () => readMedia(season.id),
  });
  return (
    <li>
      <details
        className={cx("season")}
        onToggle={(event) => {
          if (event.currentTarget.open) setOpened(true);
        }}
      >
        <summary className={cx("seasonSummary")}>
          <ChevronRightIcon className={cx("chevron")} aria-hidden="true" />
          <span className={cx("seasonName")}>{season.title}</span>
          {season.catalogState === "pending" && (
            <span className={cx("quiet")}>Details still loading</span>
          )}
          <StatePill state={AVAILABILITY_COPY[season.availability]} />
        </summary>
        <div className={cx("seasonBody")}>
          {detail.error !== null && (
            <ErrorState
              error={detail.error}
              what={season.title}
              onRetry={() => {
                void detail.refetch();
              }}
            />
          )}
          {detail.error === null && detail.data === undefined && (
            <RowsSkeleton label={`Loading ${season.title}`} count={3} />
          )}
          {detail.data !== undefined && (
            <EpisodeList
              label={`${season.title} episodes`}
              episodes={detail.data.children}
            />
          )}
          <p className={cx("seasonLink")}>
            <Link to={mediaPath(season.id)}>Open {season.title}</Link> to ask
            for it on its own.
          </p>
        </div>
      </details>
    </li>
  );
}

/** A series' seasons, each opening onto its episodes. */
export function SeasonList({ seasons }: { seasons: readonly MediaItem[] }) {
  return (
    <ul className={cx("seasons")}>
      {seasons.map((season) => (
        <Season key={season.id} season={season} />
      ))}
    </ul>
  );
}
