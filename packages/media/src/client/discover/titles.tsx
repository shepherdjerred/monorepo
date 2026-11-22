import type { ReactNode } from "react";
import { useIsFetching } from "@tanstack/react-query";
import { queryClient } from "#client/api.ts";
import { classNames } from "#client/ui/class-names.ts";
import { PosterCard, PosterGrid } from "#client/ui/poster-card.tsx";
import { PosterGridSkeleton } from "#client/ui/skeleton.tsx";
import { ErrorState } from "#client/ui/states.tsx";
import {
  householdState,
  localDay,
  releaseDetail,
  titleAddress,
  type CatalogEntry,
} from "./card.ts";
import { CATALOG_QUERY_KEY, type CatalogList } from "./catalog-list.ts";
import styles from "./discover.module.css";

const cx = classNames(styles);

/** One catalog title as a poster card carrying what the household has. */
export function CatalogCard({
  entry,
  headingLevel,
  layout,
}: {
  entry: CatalogEntry;
  headingLevel: 2 | 3;
  layout: "grid" | "rail";
}) {
  const { item, access } = entry;
  const household = householdState(item.library, access);
  return (
    <PosterCard
      to={titleAddress(item)}
      title={item.title}
      detail={releaseDetail(item, localDay(new Date()))}
      note={household.note}
      posterPath={item.posterPath}
      state={household.state}
      invites={household.invites}
      headingLevel={headingLevel}
      layout={layout}
    />
  );
}

/**
 * Said once, above the titles, when Media could not check them against the
 * library: the cards carry no state, and this is why. The reader can still
 * open any title; the only thing to do about the check is to ask again.
 */
export function AccessNotice() {
  const checking = useIsFetching({ queryKey: [CATALOG_QUERY_KEY] }) > 0;
  return (
    <section className={cx("notice")} aria-labelledby="discover-access">
      <h2 className={cx("noticeTitle")} id="discover-access">
        Media could not confirm your Plex access just now
      </h2>
      <p className={cx("noticeBody")}>
        Until it can, the titles here do not show what your household already
        has. You can still open any of them. Check again in a few minutes; if
        this keeps happening, ask the library owner.
      </p>
      <button
        className="button"
        type="button"
        disabled={checking}
        onClick={() => {
          void queryClient.invalidateQueries({
            queryKey: [CATALOG_QUERY_KEY],
          });
        }}
      >
        {checking ? "Checking…" : "Check again"}
      </button>
    </section>
  );
}

/**
 * A search's results or a whole feed as a poster grid, with every state the
 * read can be in: loading, failed, empty, and more to come.
 */
export function CatalogGrid({
  list,
  label,
  what,
  headingLevel,
  empty,
}: {
  list: CatalogList;
  /** The grid's accessible name. */
  label: string;
  /** The grid as the start of a sentence, for its error state. */
  what: string;
  headingLevel: 2 | 3;
  /** Shown when the read succeeded and found nothing. */
  empty: ReactNode;
}) {
  const failure = list.error !== null && (
    <ErrorState error={list.error} what={what} onRetry={list.retry} />
  );
  if (list.entries.length === 0) {
    if (list.error !== null) return failure;
    // Nothing yet, or nothing left over from the question before this one.
    return list.pending || list.stale ? (
      <PosterGridSkeleton label="Loading titles" count={20} />
    ) : (
      empty
    );
  }
  return (
    <>
      <PosterGrid label={label} busy={list.stale}>
        {list.entries.map(({ key, entry }) => (
          <li key={key}>
            <CatalogCard
              entry={entry}
              headingLevel={headingLevel}
              layout="grid"
            />
          </li>
        ))}
      </PosterGrid>
      {failure}
      {list.error === null && list.hasMore && (
        <div className={cx("more")}>
          <button
            className="button"
            type="button"
            disabled={list.loadingMore}
            onClick={list.loadMore}
          >
            {list.loadingMore ? "Loading more…" : "Show more titles"}
          </button>
        </div>
      )}
    </>
  );
}
