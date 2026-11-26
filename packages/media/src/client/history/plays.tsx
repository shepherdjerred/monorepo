import { useId } from "react";
import { HistoryIcon, SearchXIcon } from "lucide-react";
import { Link } from "react-router";
import {
  PlaybackTimelineSchema,
  type PlaybackTimelineItem,
} from "#shared/household/playback.ts";
import { readApi } from "#client/api.ts";
import { dateLabel } from "#client/components.tsx";
import {
  PLAY_FINISHED_COPY,
  PLAYBACK_DECISION_COPY,
  UNMATCHED_VIEWER,
} from "#client/presentation/playback.ts";
import { classNames } from "#client/ui/class-names.ts";
import { StatePill } from "#client/ui/poster-card.tsx";
import { Poster } from "#client/ui/poster.tsx";
import { RowsSkeleton } from "#client/ui/skeleton.tsx";
import { EmptyState, ErrorState } from "#client/ui/states.tsx";
import { useCursorList } from "#client/ui/use-cursor-list.ts";
import { watchTime } from "./format.ts";
import styles from "./history.module.css";
import { PlayPoster, PlayTitle, type Play } from "./play.tsx";
import {
  filterKey,
  historyReadPath,
  isFiltered,
  type HistoryView,
} from "./view.ts";

const cx = classNames(styles);

function PlayRow({ play, showsViewer }: { play: Play; showsViewer: boolean }) {
  return (
    <li className={cx("play")}>
      <div className={cx("playPoster")}>
        <PlayPoster play={play} sizes="44px" />
      </div>
      <div className={cx("playTitle")}>
        <PlayTitle play={play} />
      </div>
      <div className={cx("playWhen")}>
        <time dateTime={play.startedAt}>{dateLabel(play.startedAt)}</time>
        {showsViewer && (
          <p className={cx("detail")}>{play.userName ?? UNMATCHED_VIEWER}</p>
        )}
      </div>
      <div className={cx("playHow")}>
        <p className={cx("playWatched")}>
          {watchTime(play.watchedMs)} on {play.platform}
        </p>
        <p className={cx("detail")}>
          {PLAYBACK_DECISION_COPY[play.decision]} ·{" "}
          {play.source === "plex" ? "Plex" : "Tautulli"}
        </p>
      </div>
      <div className={cx("playState")}>
        <StatePill
          state={PLAY_FINISHED_COPY[play.completed ? "finished" : "partial"]}
        />
      </div>
    </li>
  );
}

function PlexViewRow({
  view,
  showsViewer,
}: {
  view: Extract<PlaybackTimelineItem, { kind: "plex_view" }>;
  showsViewer: boolean;
}) {
  const title =
    view.title ||
    (view.mediaKind === "movie"
      ? "Movie title unavailable"
      : "Episode title unavailable");
  const seriesTitle = view.seriesTitle === "" ? null : view.seriesTitle;
  const name = seriesTitle ?? title;
  const detail = [
    name === title ? null : title,
    view.seasonNumber !== null && view.seasonNumber >= 0
      ? `Season ${String(view.seasonNumber)}`
      : null,
    view.episodeNumber !== null && view.episodeNumber >= 0
      ? `Episode ${String(view.episodeNumber)}`
      : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <li className={cx("play")}>
      <div className={cx("playPoster")}>
        <Poster path={null} title={name} sizes="44px" />
      </div>
      <div className={cx("playTitle")}>
        <span className={cx("playName")}>{name}</span>
        {detail !== "" && <p className={cx("detail")}>{detail}</p>}
      </div>
      <div className={cx("playWhen")}>
        <time dateTime={view.viewedAt}>{dateLabel(view.viewedAt)}</time>
        {showsViewer && (
          <p className={cx("detail")}>{view.userName ?? UNMATCHED_VIEWER}</p>
        )}
      </div>
      <div className={cx("playHow")}>
        <p className={cx("detail")}>
          {view.source === "view" ? "Plex view" : "Last watched in Plex"}
        </p>
      </div>
    </li>
  );
}

/**
 * The plays the filters leave, newest first, a page at a time. Each play
 * links to its title when the household holds it.
 */
export function PlaysSection({
  view,
  owner,
  clearedSearch,
}: {
  view: HistoryView;
  /** An owner reads the household's plays; a member reads their own. */
  owner: boolean;
  /** The address of this page with no filters. */
  clearedSearch: string;
}) {
  const heading = useId();
  const plays = useCursorList({
    queryKey: ["playback", "history", filterKey(view)],
    read: (cursor) =>
      readApi(historyReadPath(view, cursor), PlaybackTimelineSchema),
  });

  function content() {
    if (plays.error !== null) {
      return (
        <ErrorState
          error={plays.error}
          what={owner ? "The watch history" : "Your watch history"}
          onRetry={plays.retry}
        />
      );
    }
    if (plays.pending) return <RowsSkeleton label="Loading plays" />;
    if (plays.items.length === 0) {
      return isFiltered(view) ? (
        <EmptyState
          icon={SearchXIcon}
          title="No plays match"
          action={
            <Link
              className="button"
              to={{ search: clearedSearch }}
              replace
              preventScrollReset
            >
              Clear filters
            </Link>
          }
        >
          Nothing in the watch history fits this search and these filters.
        </EmptyState>
      ) : (
        <EmptyState
          icon={HistoryIcon}
          title="Nothing watched yet"
          action={
            <Link className="button primary" to="/library">
              Open the library
            </Link>
          }
        >
          {owner
            ? "Plays appear here once someone in the household watches something in Plex."
            : "Plays appear here once you watch something in Plex."}
        </EmptyState>
      );
    }
    return (
      <>
        <ol
          className={cx("plays")}
          role="list"
          aria-labelledby={heading}
          aria-busy={plays.stale}
        >
          {plays.items.map((record) =>
            record.kind === "session" ? (
              <PlayRow
                key={`session:${record.session.id}`}
                play={record.session}
                showsViewer={owner}
              />
            ) : (
              <PlexViewRow key={record.id} view={record} showsViewer={owner} />
            ),
          )}
        </ol>
        {plays.hasMore && (
          <div className={cx("more")}>
            <button
              className="button"
              type="button"
              disabled={plays.loadingMore}
              onClick={plays.loadMore}
            >
              {plays.loadingMore ? "Loading more…" : "Show more plays"}
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <section className={cx("section")} aria-labelledby={heading}>
      <h2 id={heading}>Plays</h2>
      {content()}
    </section>
  );
}
