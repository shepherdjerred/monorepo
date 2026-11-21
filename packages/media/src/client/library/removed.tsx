import { ArchiveIcon } from "lucide-react";
import type { z } from "zod";
import { Link } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import {
  RemovalHistoryPageSchema,
  type RemovalHistoryItemSchema,
} from "#shared/household/calendar.ts";
import { readApi } from "#client/api.ts";
import {
  REMOVAL_REASON_COPY,
  REMOVAL_STATE_COPY,
  REMOVED_KIND_COPY,
  RESTORE_COPY,
} from "#client/presentation/removal.ts";
import { shortDate } from "#client/presentation/state-phrase.ts";
import { ListedTargets } from "#client/target-controls/listed.tsx";
import { ListedMediaAction } from "#client/target-controls/protection.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { Poster } from "#client/ui/poster.tsx";
import { StatePill } from "#client/ui/poster-card.tsx";
import { RowsSkeleton } from "#client/ui/skeleton.tsx";
import { EmptyState, ErrorState } from "#client/ui/states.tsx";
import { useCursorList } from "#client/ui/use-cursor-list.ts";
import styles from "./library.module.css";
import { restorable, useRemovals, type Removal } from "./removals.ts";

const cx = classNames(styles);

type Removed = z.infer<typeof RemovalHistoryItemSchema>;

/** "Film", "Season 2", or "Season 2, episode 4: Headspace". */
function part(item: Removed): string {
  if (item.seasonNumber === null) return REMOVED_KIND_COPY[item.kind];
  return item.episodeNumber === null
    ? `Season ${String(item.seasonNumber)}`
    : `Season ${String(item.seasonNumber)}, episode ${String(item.episodeNumber)}: ${item.title}`;
}

/** When it left and, once known, when its files went or will go. */
function dates(item: Removed): string {
  // A removal that was called off never finished removing anything.
  if (item.state === "cancelled") {
    return `Removal started ${shortDate(item.quarantinedAt)}.`;
  }
  const left = `Removed ${shortDate(item.quarantinedAt)}.`;
  if (item.state === "purged") {
    return item.purgedAt === null
      ? `${left} Files deleted; the date was not recorded.`
      : `${left} Files deleted ${shortDate(item.purgedAt)}.`;
  }
  return item.restoreState === "recoverable" && item.restoreDeadline !== null
    ? `${left} Can be restored until ${shortDate(item.restoreDeadline)}.`
    : left;
}

function Row({
  user,
  item,
  canRestore,
}: {
  user: MediaUser;
  item: Removed;
  /** The reader may put it back: it is on their own list of removals. */
  canRestore: boolean;
}) {
  const name = item.seriesTitle ?? item.title;
  const address = `/media/${encodeURIComponent(item.mediaId)}`;
  return (
    <li className={cx("entry")}>
      <div className={cx("entryPoster")}>
        <Poster path={item.artwork.posterPath} title={name} sizes="72px" />
      </div>
      <div className={cx("entryBody")}>
        <h2 className={cx("entryTitle")}>
          <Link to={address}>{name}</Link>
        </h2>
        <p className={cx("rowDetail")}>{part(item)}</p>
        <p className={cx("entryState")}>
          <StatePill state={REMOVAL_STATE_COPY[item.state]} />
        </p>
        {item.state !== "cancelled" && (
          <p className={cx("rowDetail")}>
            {REMOVAL_REASON_COPY[item.reason]}
            {item.requesterContext === "your_request" &&
              " You had asked for this."}
          </p>
        )}
        <p className={cx("rowDetail")}>{dates(item)}</p>
        {RESTORE_COPY[item.restoreState] !== null && (
          <p className={cx("rowDetail")}>{RESTORE_COPY[item.restoreState]}</p>
        )}
      </div>
      <div className={cx("entryAction")}>
        {canRestore ? (
          <ListedMediaAction
            user={user}
            mediaId={item.mediaId}
            action="restore"
          />
        ) : (
          <Link className="button subtle" to={address}>
            {item.restoreState === "reacquire" ? "Ask for it again" : "Open"}
            <span className="sr-only"> {name}</span>
          </Link>
        )}
      </div>
    </li>
  );
}

/**
 * A removal the reader may undo that the history shown so far does not list.
 * It keeps its restore action here, so the action never depends on how much
 * history has been loaded.
 */
function Unlisted({ user, removal }: { user: MediaUser; removal: Removal }) {
  return (
    <li className={cx("entry")}>
      <div className={cx("entryPoster")}>
        <Poster
          path={removal.artwork.posterPath}
          title={removal.rootTitle}
          sizes="72px"
        />
      </div>
      <div className={cx("entryBody")}>
        <h2 className={cx("entryTitle")}>
          <Link to={`/media/${encodeURIComponent(removal.mediaId)}`}>
            {removal.rootTitle}
          </Link>
        </h2>
        {removal.mediaId !== removal.rootMediaId && (
          <p className={cx("rowDetail")}>{removal.media.title}</p>
        )}
        <p className={cx("entryState")}>
          <StatePill state={REMOVAL_STATE_COPY.quarantined} />
        </p>
        {removal.purgeAfter !== null && (
          <p className={cx("rowDetail")}>
            Can be restored until {shortDate(removal.purgeAfter)}.
          </p>
        )}
      </div>
      <div className={cx("entryAction")}>
        <ListedMediaAction
          user={user}
          mediaId={removal.mediaId}
          action="restore"
        />
      </div>
    </li>
  );
}

/** What left the library, why, and what can still be put back. */
export function LibraryRemoved({ user }: { user: MediaUser }) {
  const history = useCursorList({
    queryKey: ["removal-history"],
    read: (cursor) =>
      readApi(
        `/removal-history${cursor === null ? "" : `?cursor=${encodeURIComponent(cursor)}`}`,
        RemovalHistoryPageSchema,
      ),
  });
  const removals = useRemovals();
  if (history.error !== null) {
    return (
      <ErrorState
        error={history.error}
        what="What was removed"
        onRetry={history.retry}
      />
    );
  }
  if (removals.error !== null) {
    return (
      <ErrorState
        error={removals.error}
        what="What can be restored"
        onRetry={() => {
          void removals.refetch();
        }}
      />
    );
  }
  if (history.pending || removals.data === undefined) {
    return <RowsSkeleton label="Loading what was removed" />;
  }
  const undoable = restorable(removals.data);
  const undoableIds = new Set(undoable.map((removal) => removal.mediaId));
  const listedIds = new Set(
    history.items
      .filter((item) => item.restoreState === "recoverable")
      .map((item) => item.mediaId),
  );
  const unlisted = undoable.filter(
    (removal) => !listedIds.has(removal.mediaId),
  );
  if (history.items.length === 0 && unlisted.length === 0) {
    return (
      <EmptyState icon={ArchiveIcon} title="Nothing has been removed">
        When a film or series leaves the library, the record of it stays here,
        along with whether it can be restored.
      </EmptyState>
    );
  }
  return (
    <>
      <p className={cx("intro")}>
        What left the library and why. For a week after something leaves, its
        files are set aside and can be restored by the people who asked for it
        or the library owner; after that, asking for it again starts a new
        search.
      </p>
      <ListedTargets mediaIds={[...undoableIds]}>
        <ul className={cx("entries")} aria-label="Removed">
          {unlisted.map((removal) => (
            <Unlisted key={removal.id} user={user} removal={removal} />
          ))}
          {history.items.map((item) => (
            <Row
              key={item.id}
              user={user}
              item={item}
              canRestore={
                item.restoreState === "recoverable" &&
                undoableIds.has(item.mediaId)
              }
            />
          ))}
        </ul>
      </ListedTargets>
      {history.hasMore && (
        <div className={cx("more")}>
          <button
            className="button"
            type="button"
            disabled={history.loadingMore}
            onClick={history.loadMore}
          >
            {history.loadingMore ? "Loading more…" : "Show earlier removals"}
          </button>
        </div>
      )}
    </>
  );
}
