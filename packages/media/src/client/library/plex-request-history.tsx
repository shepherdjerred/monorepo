import { useId } from "react";
import {
  PlexHistoricalViewsSchema,
  type PlexHistoricalViews,
} from "#shared/household/plex-history.ts";
import { readApi } from "#client/api.ts";
import { dateLabel } from "#client/components.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { RowsSkeleton } from "#client/ui/skeleton.tsx";
import { ErrorState } from "#client/ui/states.tsx";
import { useCursorList } from "#client/ui/use-cursor-list.ts";
import styles from "./library.module.css";

const cx = classNames(styles);

function PlexHistoryRow({
  view,
}: {
  view: PlexHistoricalViews["items"][number];
}) {
  const seriesTitle =
    view.kind === "episode" && view.seriesTitle !== ""
      ? view.seriesTitle
      : null;
  const title =
    view.title ||
    (view.kind === "movie"
      ? "Movie title unavailable"
      : "Episode title unavailable");
  const detail = [
    seriesTitle === null ? null : title,
    view.seasonNumber === null || view.seasonNumber < 0
      ? null
      : `Season ${String(view.seasonNumber)}`,
    view.episodeNumber === null || view.episodeNumber < 0
      ? null
      : `Episode ${String(view.episodeNumber)}`,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <li className={cx("plexHistoryRow")}>
      <div>
        <p className={cx("entryTitle")}>{seriesTitle ?? title}</p>
        {view.kind === "episode" && detail !== "" && (
          <p className={cx("rowDetail")}>{detail}</p>
        )}
      </div>
      <div className={cx("plexHistoryWhen")}>
        <time dateTime={view.viewedAt}>{dateLabel(view.viewedAt)}</time>
        {view.source === "last_watched" && (
          <p className={cx("rowDetail")}>Last watched in Plex</p>
        )}
      </div>
    </li>
  );
}

/** The signed-in person's Plex history stays separate from live requests. */
export function PlexRequestHistory({ userId }: { userId: string }) {
  const heading = useId();
  const history = useCursorList({
    queryKey: ["plex-request-history", userId],
    read: (cursor) =>
      readApi(
        cursor === null
          ? "/requests/plex-history"
          : `/requests/plex-history?cursor=${encodeURIComponent(cursor)}`,
        PlexHistoricalViewsSchema,
      ),
  });
  if (!history.pending && history.error === null && history.items.length === 0)
    return null;

  return (
    <section className={cx("plexHistory")}>
      <h2 id={heading}>Watched in Plex</h2>
      {history.pending && <RowsSkeleton label="Loading your Plex history" />}
      {history.items.length > 0 && (
        <ol
          className={cx("entries")}
          role="list"
          aria-labelledby={heading}
          aria-busy={history.loadingMore}
        >
          {history.items.map((view) => (
            <PlexHistoryRow
              key={`${view.source}:${String(view.sourceViewId)}`}
              view={view}
            />
          ))}
        </ol>
      )}
      {history.error !== null && (
        <ErrorState
          error={history.error}
          what={
            history.items.length > 0 ? "More Plex history" : "Your Plex history"
          }
          headingLevel={3}
          onRetry={
            history.items.length > 0 && history.hasMore
              ? history.loadMore
              : history.retry
          }
        />
      )}
      {history.error === null &&
        (history.hasMore || history.pages.length > 1) && (
          <div className={cx("more")}>
            <button
              className="button"
              type="button"
              aria-disabled={history.loadingMore || !history.hasMore}
              onClick={() => {
                if (history.hasMore && !history.loadingMore) history.loadMore();
              }}
            >
              {history.loadingMore
                ? "Loading earlier watches…"
                : history.hasMore
                  ? "Show earlier watches"
                  : "All Plex history loaded"}
            </button>
          </div>
        )}
    </section>
  );
}
