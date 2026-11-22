import { CompassIcon } from "lucide-react";
import { Link } from "react-router";
import type { CatalogFeed } from "#shared/catalog/contract.ts";
import { FEED_COPY } from "#client/presentation/catalog.ts";
import { classNames } from "#client/ui/class-names.ts";
import { PosterRail, PosterRailStandIn } from "#client/ui/poster-rail.tsx";
import { PosterRailSkeleton } from "#client/ui/skeleton.tsx";
import { EmptyState, ErrorState } from "#client/ui/states.tsx";
import { useCatalogList, type CatalogList } from "./catalog-list.ts";
import styles from "./discover.module.css";
import { AccessNotice, CatalogCard } from "./titles.tsx";
import { FEED_ORDER, feedAddress } from "./view.ts";

const cx = classNames(styles);

/** A row shows a feed's first page; "See all" has the rest. */
const ROW_LENGTH = 20;

/**
 * Every feed's list. Each is read on its own, so one that fails leaves the
 * others standing; a feed the contract gains stops compiling here until it
 * has a row.
 */
function useFeeds(): Record<CatalogFeed, CatalogList> {
  return {
    trending: useCatalogList({ kind: "feed", feed: "trending" }),
    popular_movies: useCatalogList({ kind: "feed", feed: "popular_movies" }),
    popular_series: useCatalogList({ kind: "feed", feed: "popular_series" }),
    upcoming_movies: useCatalogList({ kind: "feed", feed: "upcoming_movies" }),
    on_the_air: useCatalogList({ kind: "feed", feed: "on_the_air" }),
  };
}

function failed(list: CatalogList): boolean {
  return list.error !== null && list.entries.length === 0;
}

/** The read succeeded and the feed has nothing on it. */
function answeredEmpty(list: CatalogList): boolean {
  return !list.pending && list.error === null && list.entries.length === 0;
}

function FeedRow({ feed, list }: { feed: CatalogFeed; list: CatalogList }) {
  const { title } = FEED_COPY[feed];
  const loading = list.pending && list.error === null;
  // A feed with nothing in it is not worth a heading.
  if (!loading && !failed(list) && list.entries.length === 0) return null;
  // The heading and the named list are how a row is found; five more
  // landmarks would only crowd the ones the shell has.
  return (
    <section className={cx("row")}>
      <div className={cx("rowHead")}>
        <h2 className={cx("rowTitle")}>{title}</h2>
        {!failed(list) && (
          <Link
            className={cx("seeAll")}
            to={feedAddress(feed)}
            aria-label={`See all: ${title}`}
          >
            See all
          </Link>
        )}
      </div>
      {loading && <PosterRailSkeleton label={`Loading ${title}`} />}
      {list.error !== null && failed(list) && (
        <PosterRailStandIn>
          <ErrorState error={list.error} what={title} onRetry={list.retry} />
        </PosterRailStandIn>
      )}
      {list.entries.length > 0 && (
        <PosterRail label={title}>
          {list.entries.slice(0, ROW_LENGTH).map(({ key, entry }) => (
            <li key={key}>
              <CatalogCard entry={entry} headingLevel={3} layout="rail" />
            </li>
          ))}
        </PosterRail>
      )}
    </section>
  );
}

/** The browse rows: what Discover shows when nothing is being searched for. */
export function DiscoverFeeds() {
  const feeds = useFeeds();
  const lists = FEED_ORDER.map((feed) => feeds[feed]);
  const firstError = lists[0]?.error ?? null;
  // The catalog itself is down: one explanation, not one in every row.
  if (firstError !== null && lists.every((list) => failed(list))) {
    return (
      <ErrorState
        error={firstError}
        what="Discover"
        onRetry={() => {
          for (const list of lists) list.retry();
        }}
      />
    );
  }
  // Said whether or not any row has a title to show it on.
  const notice = lists.some((list) => list.accessStale) && <AccessNotice />;
  if (lists.every((list) => answeredEmpty(list))) {
    return (
      <>
        {notice}
        <EmptyState icon={CompassIcon} title="Nothing to browse right now">
          The lists of popular titles are empty at the moment. Search above for
          a film or series by name.
        </EmptyState>
      </>
    );
  }
  return (
    <>
      {notice}
      {FEED_ORDER.map((feed) => (
        <FeedRow key={feed} feed={feed} list={feeds[feed]} />
      ))}
    </>
  );
}
