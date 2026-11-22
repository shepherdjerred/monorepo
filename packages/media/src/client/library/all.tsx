import { CompassIcon, SearchXIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { LibraryPageSchema } from "#shared/household/library.ts";
import { readApi } from "#client/api.ts";
import {
  kindAndYear,
  libraryStatePhrase,
} from "#client/presentation/state-phrase.ts";
import { classNames } from "#client/ui/class-names.ts";
import { PosterCard, PosterGrid } from "#client/ui/poster-card.tsx";
import { PosterGridSkeleton, RowsSkeleton } from "#client/ui/skeleton.tsx";
import { EmptyState, ErrorState } from "#client/ui/states.tsx";
import { useCursorList } from "#client/ui/use-cursor-list.ts";
import { LibraryList } from "./list-view.tsx";
import styles from "./library.module.css";
import { LibraryToolbar } from "./toolbar.tsx";
import {
  DEFAULT_VIEW,
  isFiltered,
  libraryReadPath,
  libraryViewSearch,
  readLibraryView,
  type LibraryView,
} from "./view.ts";

const cx = classNames(styles);

function NothingHere({
  view,
  hasMore,
  onMore,
}: {
  view: LibraryView;
  hasMore: boolean;
  onMore: () => void;
}) {
  // The API settles what a reader may see after it reads a page, so a page
  // can come back empty with more behind it.
  if (hasMore) {
    return (
      <EmptyState
        icon={SearchXIcon}
        title="Nothing so far"
        action={
          <button className="button" type="button" onClick={onMore}>
            Keep looking
          </button>
        }
      >
        None of the titles checked so far match. There are more to check.
      </EmptyState>
    );
  }
  if (isFiltered(view)) {
    return (
      <EmptyState
        icon={SearchXIcon}
        title="No titles match"
        action={
          <Link
            className="button"
            to={{
              search: libraryViewSearch({
                ...DEFAULT_VIEW,
                sort: view.sort,
                layout: view.layout,
              }),
            }}
          >
            Clear search and filters
          </Link>
        }
      >
        Nothing in the library fits this search and these filters.
      </EmptyState>
    );
  }
  return (
    <EmptyState
      icon={CompassIcon}
      title={
        view.sort === "added"
          ? "Nothing is ready to watch yet"
          : "The library is empty"
      }
      action={
        <Link className="button primary" to="/discover">
          Find something to watch
        </Link>
      }
    >
      Films and series appear here once someone in the household asks for them.
    </EmptyState>
  );
}

/** Every title the household has, as posters or as a compact list. */
export function LibraryAll({ user }: { user: MediaUser }) {
  const [params, setParams] = useSearchParams();
  const view = readLibraryView(params);
  const { layout, ...question } = view;
  const library = useCursorList({
    queryKey: ["library", question],
    read: (cursor) => readApi(libraryReadPath(view, cursor), LibraryPageSchema),
  });
  const skeleton =
    layout === "grid" ? (
      <PosterGridSkeleton label="Loading titles" />
    ) : (
      <RowsSkeleton label="Loading titles" />
    );
  return (
    <>
      <LibraryToolbar
        view={view}
        onChange={(next) => {
          // Typing and choosing refine one view; they are not steps to go
          // back through one letter at a time.
          setParams(libraryViewSearch(next), {
            replace: true,
            preventScrollReset: true,
          });
        }}
      />
      {view.sort === "added" && (
        <p className={cx("note")}>
          Newest first. Titles with nothing to watch yet are left out of this
          order.
        </p>
      )}
      {library.error !== null && (
        <ErrorState
          error={library.error}
          what="The library"
          onRetry={library.retry}
        />
      )}
      {library.error === null && library.pending && skeleton}
      {library.error === null &&
        !library.pending &&
        library.items.length === 0 && (
          <NothingHere
            view={view}
            hasMore={library.hasMore}
            onMore={library.loadMore}
          />
        )}
      {library.items.length > 0 &&
        (layout === "grid" ? (
          <PosterGrid label="Library titles" busy={library.stale}>
            {library.items.map((item) => (
              <li key={item.id}>
                <PosterCard
                  to={`/media/${encodeURIComponent(item.id)}`}
                  title={item.title}
                  detail={kindAndYear(item.kind, item.year)}
                  posterPath={item.artwork.posterPath}
                  state={libraryStatePhrase(item)}
                />
              </li>
            ))}
          </PosterGrid>
        ) : (
          <LibraryList user={user} items={library.items} busy={library.stale} />
        ))}
      {library.items.length > 0 && library.hasMore && (
        <div className={cx("more")}>
          <button
            className="button"
            type="button"
            disabled={library.loadingMore}
            onClick={library.loadMore}
          >
            {library.loadingMore ? "Loading more…" : "Show more titles"}
          </button>
        </div>
      )}
    </>
  );
}
