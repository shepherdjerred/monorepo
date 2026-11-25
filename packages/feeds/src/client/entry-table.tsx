import { useRef, type MouseEvent, type RefObject } from "react";
import { CircleCheckIcon, CircleIcon, StarIcon } from "lucide-react";
import { Button, Chip, Field, IconButton } from "@shepherdjerred/console-ui";
import type {
  EntryListItem,
  EntryView,
} from "@shepherdjerred/feeds/shared/contract.ts";
import {
  entryHostname,
  formatIsoTimestamp,
  formatRelativeTime,
  type EntriesRoute,
} from "./model.ts";

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export type SearchToolbarProps = {
  readonly pathname: string;
  readonly route: EntriesRoute;
  readonly query: string;
  readonly shownCount: number | undefined;
  readonly totalMatching: number;
  readonly inputRef?: RefObject<HTMLInputElement | null> | undefined;
  readonly onQueryChange: (next: string) => void;
};

export function EntriesSearchToolbar({
  pathname,
  route,
  query,
  shownCount,
  totalMatching,
  inputRef,
  onQueryChange,
}: SearchToolbarProps): React.JSX.Element {
  const lastCompositionEndAt = useRef<number | null>(null);

  return (
    <search className="fd-search">
      <form
        method="GET"
        action={pathname}
        className="ui-toolbar fd-search-form"
        onSubmit={(event) => {
          event.preventDefault();
          onQueryChange(query);
        }}
      >
        {route.category !== undefined && route.view === "all" ? (
          <input type="hidden" name="view" value="all" />
        ) : null}
        <Field label="Search" layout="inline">
          {(control) => (
            <input
              {...control}
              ref={inputRef}
              type="search"
              name="q"
              value={query}
              placeholder="Filter headlines or body…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              onCompositionEnd={(event) => {
                lastCompositionEndAt.current = event.nativeEvent.timeStamp;
              }}
              onChange={(event) => {
                onQueryChange(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (event.nativeEvent.isComposing) return;
                const endedAt = lastCompositionEndAt.current;
                if (
                  endedAt !== null &&
                  Math.abs(event.nativeEvent.timeStamp - endedAt) < 50
                ) {
                  return;
                }
                onQueryChange(event.currentTarget.value);
              }}
            />
          )}
        </Field>
        <Button type="submit">Search</Button>
        {shownCount === undefined ? null : (
          <span className="ui-count" aria-live="polite">
            {shownCount} of {totalMatching}
          </span>
        )}
        <span className="ui-muted fd-shortcuts-hint">
          Shortcuts: <kbd className="ui-mono">j</kbd>/
          <kbd className="ui-mono">k</kbd> move ·{" "}
          <kbd className="ui-mono">o</kbd> open ·{" "}
          <kbd className="ui-mono">m</kbd> read ·{" "}
          <kbd className="ui-mono">s</kbd> star ·{" "}
          <kbd className="ui-mono">/</kbd> search ·{" "}
          <kbd className="ui-mono">r</kbd> refresh
        </span>
      </form>
    </search>
  );
}

export type EntryTableProps = {
  readonly entries: readonly EntryListItem[];
  readonly view: EntryView;
  readonly activeIndex: number | undefined;
  readonly nextCursor: number | null;
  readonly totalMatching: number;
  readonly isLoadingMore?: boolean | undefined;
  readonly nowSeconds?: number | undefined;
  readonly onSelectIndex?: ((index: number) => void) | undefined;
  readonly onToggleRead: (entry: EntryListItem) => void;
  readonly onToggleStar: (entry: EntryListItem) => void;
  readonly onLoadMore?: (() => void) | undefined;
  readonly onNavigate?: ((href: string) => void) | undefined;
};

export function EntryTable({
  entries,
  view,
  activeIndex,
  nextCursor,
  totalMatching,
  isLoadingMore = false,
  nowSeconds,
  onSelectIndex,
  onToggleRead,
  onToggleStar,
  onLoadMore,
  onNavigate,
}: EntryTableProps): React.JSX.Element {
  const showAutoReadBadge = view === "all" || view === "auto-read";

  return (
    <>
      <div
        tabIndex={0}
        role="region"
        aria-label="Feed entries"
        className="ui-table-scroll fd-table-wrap"
      >
        <table className="ui-table fd-entry-table">
          <thead>
            <tr>
              <th scope="col" className="fd-col-icon">
                <span className="ui-sr-only">Star</span>
              </th>
              <th scope="col" className="fd-col-feed">
                Feed
              </th>
              <th scope="col">Entry</th>
              <th scope="col" className="fd-col-meta">
                Published
              </th>
              <th scope="col" className="fd-col-icon">
                <span className="ui-sr-only">Read status</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, index) => {
              const isActive = index === activeIndex;
              const iso = formatIsoTimestamp(entry.publishedAt);
              const relative = formatRelativeTime(
                entry.publishedAt,
                nowSeconds,
              );
              const host = entryHostname(entry.url);
              const metaParts: string[] = [];
              if (entry.author.trim().length > 0) {
                metaParts.push(entry.author.trim());
              }
              if (host.length > 0) {
                metaParts.push(host);
              }
              const feedHref = `/feed/${String(entry.feed.id)}`;

              return (
                <tr
                  key={entry.id}
                  data-unread={entry.isRead ? undefined : ""}
                  data-current={isActive ? "" : undefined}
                  onClick={() => {
                    onSelectIndex?.(index);
                  }}
                >
                  <td className="fd-cell-star">
                    <IconButton
                      icon={StarIcon}
                      label={entry.isStarred ? "Remove star" : "Star entry"}
                      aria-pressed={entry.isStarred}
                      {...(entry.isStarred
                        ? { className: "fd-star-active" }
                        : {})}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleStar(entry);
                      }}
                    />
                  </td>
                  <td className="fd-cell-feed">
                    <a
                      href={feedHref}
                      className="fd-feed-chip-link"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (
                          onNavigate !== undefined &&
                          isPlainLeftClick(event)
                        ) {
                          event.preventDefault();
                          onNavigate(feedHref);
                        }
                      }}
                    >
                      <Chip
                        label={entry.feed.category}
                        value={entry.feed.title}
                      />
                    </a>
                  </td>
                  <th scope="row" className="fd-cell-title">
                    <div className="fd-entry-headline">
                      {entry.isRead ? null : (
                        <span className="fd-unread-dot" aria-hidden="true" />
                      )}
                      <a
                        href={entry.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="fd-entry-link"
                      >
                        {entry.title}
                      </a>
                      {showAutoReadBadge && entry.autoReadMatched ? (
                        <span className="fd-inline-chip">
                          <Chip
                            label="Rule"
                            value="Auto-read"
                            severity="info"
                          />
                        </span>
                      ) : null}
                    </div>
                  </th>
                  <td className="fd-cell-meta">
                    <div className="fd-meta-stack">
                      {metaParts.length === 0 ? null : (
                        <span
                          className="ui-muted fd-meta-source"
                          title={metaParts.join(" · ")}
                        >
                          {metaParts.join(" · ")}
                        </span>
                      )}
                      <time
                        className="ui-mono fd-time"
                        dateTime={iso}
                        title={iso}
                      >
                        {relative}
                      </time>
                    </div>
                  </td>
                  <td className="fd-cell-read">
                    <IconButton
                      icon={entry.isRead ? CircleIcon : CircleCheckIcon}
                      label={entry.isRead ? "Mark unread" : "Mark read"}
                      aria-pressed={!entry.isRead}
                      {...(entry.isRead
                        ? {}
                        : { className: "fd-unread-active" })}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleRead(entry);
                      }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {nextCursor === null ? null : (
        <div className="ui-section-foot">
          <Button
            type="button"
            disabled={isLoadingMore}
            onClick={() => {
              onLoadMore?.();
            }}
          >
            {isLoadingMore ? "Loading…" : "Load more"}
          </Button>
          <span className="ui-count">
            Showing {entries.length} of {totalMatching}
          </span>
        </div>
      )}
    </>
  );
}

export type EntriesSectionProps = {
  readonly route: EntriesRoute;
  readonly title: string;
  readonly pathname: string;
  readonly query: string;
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly entries: readonly EntryListItem[];
  readonly hasLoaded: boolean;
  readonly nextCursor: number | null;
  readonly totalMatching: number;
  readonly isPending: boolean;
  readonly errorMessage: string | undefined;
  readonly isFetchingNextPage: boolean;
  readonly activeIndex: number | undefined;
  readonly onQueryChange: (next: string) => void;
  readonly onSelectIndex: (index: number) => void;
  readonly onToggleRead: (entry: EntryListItem) => void;
  readonly onToggleStar: (entry: EntryListItem) => void;
  readonly onLoadMore: () => void;
  readonly onNavigate: (href: string) => void;
};

export function EntriesSection(props: EntriesSectionProps): React.JSX.Element {
  const trimmed = props.query.trim();
  return (
    <section
      className="fd-entries-section"
      aria-label={`${props.title} entries`}
    >
      <EntriesSearchToolbar
        pathname={props.pathname}
        route={props.route}
        query={props.query}
        shownCount={props.hasLoaded ? props.entries.length : undefined}
        totalMatching={props.totalMatching}
        inputRef={props.searchInputRef}
        onQueryChange={props.onQueryChange}
      />
      {props.isPending ? (
        <p className="fd-empty">Loading entries…</p>
      ) : props.errorMessage === undefined ? (
        props.entries.length === 0 ? (
          <p className="fd-empty">
            {trimmed.length > 0
              ? `No entries match “${trimmed}”.`
              : "No entries in this view."}
          </p>
        ) : (
          <EntryTable
            entries={props.entries}
            view={props.route.view}
            activeIndex={props.activeIndex}
            nextCursor={props.nextCursor}
            totalMatching={props.totalMatching}
            isLoadingMore={props.isFetchingNextPage}
            onSelectIndex={props.onSelectIndex}
            onToggleRead={props.onToggleRead}
            onToggleStar={props.onToggleStar}
            onLoadMore={props.onLoadMore}
            onNavigate={props.onNavigate}
          />
        )
      ) : (
        <p className="fd-empty" role="alert">
          {props.errorMessage}
        </p>
      )}
    </section>
  );
}
