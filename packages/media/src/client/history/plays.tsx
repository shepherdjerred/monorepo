import { useId } from "react";
import { HistoryIcon, SearchXIcon } from "lucide-react";
import { Link } from "react-router";
import { PlaybackHistorySchema } from "#shared/household/playback.ts";
import { readApi } from "#client/api.ts";
import { dateLabel } from "#client/components.tsx";
import {
  PLAY_FINISHED_COPY,
  PLAYBACK_DECISION_COPY,
  UNMATCHED_VIEWER,
} from "#client/presentation/playback.ts";
import { classNames } from "#client/ui/class-names.ts";
import { StatePill } from "#client/ui/poster-card.tsx";
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
        <p className={cx("detail")}>{PLAYBACK_DECISION_COPY[play.decision]}</p>
      </div>
      <div className={cx("playState")}>
        <StatePill
          state={PLAY_FINISHED_COPY[play.completed ? "finished" : "partial"]}
        />
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
      readApi(historyReadPath(view, cursor), PlaybackHistorySchema),
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
        <ul
          className={cx("plays")}
          aria-labelledby={heading}
          aria-busy={plays.stale}
        >
          {plays.items.map((play) => (
            <PlayRow key={play.id} play={play} showsViewer={owner} />
          ))}
        </ul>
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
