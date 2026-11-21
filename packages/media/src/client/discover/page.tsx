import { ArrowLeftIcon, SearchXIcon } from "lucide-react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import type { CatalogFeed } from "#shared/catalog/contract.ts";
import { PageTitle } from "#client/components.tsx";
import { FEED_COPY } from "#client/presentation/catalog.ts";
import { classNames } from "#client/ui/class-names.ts";
import { Section } from "#client/ui/section.tsx";
import { EmptyState } from "#client/ui/states.tsx";
import { useCatalogList, type CatalogList } from "./catalog-list.ts";
import styles from "./discover.module.css";
import { DiscoverFeeds } from "./feeds.tsx";
import { AccessNotice, CatalogGrid } from "./titles.tsx";
import { DISCOVER_PATH, feedFromSlug, readSearch } from "./view.ts";

const cx = classNames(styles);

/** What a screen reader hears as the results under a search change. */
function resultsSummary(query: string, list: CatalogList): string {
  if (list.pending || list.stale) return `Searching for “${query}”`;
  if (list.error !== null) return "";
  const count = list.entries.length;
  if (count === 0) return `No titles match “${query}”`;
  const titles = count === 1 ? "1 title" : `${String(count)} titles`;
  return list.hasMore ? `${titles} shown, more to load` : `${titles} shown`;
}

function SearchResults({ query }: { query: string }) {
  const list = useCatalogList({ kind: "search", query });
  return (
    <>
      {list.accessStale && <AccessNotice />}
      <Section
        title={`Results for “${query}”`}
        link={{ to: DISCOVER_PATH, text: "Clear search" }}
      >
        <p className="sr-only" role="status">
          {resultsSummary(query, list)}
        </p>
        <CatalogGrid
          list={list}
          label="Search results"
          what="The search"
          headingLevel={3}
          empty={
            <EmptyState icon={SearchXIcon} title="No titles match">
              Nothing in the catalog is called “{query}”. Try another title, or
              its name in the language it was made in.
            </EmptyState>
          }
        />
      </Section>
    </>
  );
}

/**
 * Discover: rows of what is popular, or the results of the search in the
 * address. The search field is the one in the top bar, which stays in view
 * above every page and searches as it is typed in while this page is open.
 */
export function DiscoverPage() {
  const [params] = useSearchParams();
  const query = readSearch(params);
  return (
    <>
      <PageTitle title="Discover">
        <p>
          Browse what is popular, or search above for any film or series. Each
          title shows what your household already has.
        </p>
      </PageTitle>
      {query === "" ? <DiscoverFeeds /> : <SearchResults query={query} />}
    </>
  );
}

function FeedTitles({ feed }: { feed: CatalogFeed }) {
  const list = useCatalogList({ kind: "feed", feed });
  const { title, about } = FEED_COPY[feed];
  return (
    <>
      <Link className={cx("back")} to={DISCOVER_PATH}>
        <ArrowLeftIcon aria-hidden="true" />
        Discover
      </Link>
      <PageTitle title={title}>
        <p>{about}</p>
      </PageTitle>
      {list.accessStale && <AccessNotice />}
      <CatalogGrid
        list={list}
        label={title}
        what={title}
        headingLevel={2}
        empty={
          <EmptyState icon={SearchXIcon} title="This list is empty right now">
            There is nothing on it at the moment. The other lists on Discover
            may have something.
          </EmptyState>
        }
      />
    </>
  );
}

/** One feed, all of it, at `/discover/:feed`. */
export function DiscoverFeedPage() {
  const feed = feedFromSlug(useParams()["feed"]);
  if (feed === null) return <Navigate to={DISCOVER_PATH} replace />;
  // Keyed, so one feed's titles are never shown under another's heading.
  return <FeedTitles key={feed} feed={feed} />;
}
