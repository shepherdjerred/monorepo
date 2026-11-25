import { useEffect, useRef, useState, type RefObject } from "react";
import { z } from "zod";
import {
  FigureStrip,
  ShellFrame,
  type ThemeStore,
} from "@shepherdjerred/console-ui";
import type {
  EntryListItem,
  FeedHealthItem,
} from "@shepherdjerred/feeds/shared/contract.ts";
import {
  useCreateUserFeed,
  useDeleteUserFeed,
  useEntries,
  useFeedsList,
  useMarkAllRead,
  useRefreshFeeds,
  useSummary,
  useUpdateEntriesState,
  useUpdateUserFeed,
} from "./api.ts";
import { EntriesSection } from "./entry-table.tsx";
import { DeleteFeedDialog, FeedsSection } from "./feeds-table.tsx";
import {
  buildMarkAllReadBody,
  buildSummaryFigures,
  parseRoute,
  parseSearch,
  routeTitle,
  searchSuffix,
  type Route,
} from "./model.ts";
import { FeedsHeader, FeedsPicker, FeedsSidebar } from "./sidebar.tsx";
import {
  UserFeedDialog,
  type UserFeedDialogState,
} from "./user-feed-dialog.tsx";

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest(
      "input, select, textarea, dialog, [contenteditable='true']",
    ) !== null
  );
}

function shouldIgnoreGlobalKey(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented ||
    event.isComposing ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    isEditableTarget(event.target) ||
    document.querySelector("dialog[open]") !== null
  );
}

type EntryShortcutContext = {
  readonly entries: readonly EntryListItem[];
  readonly activeIndex: number | undefined;
  readonly setActiveIndex: React.Dispatch<
    React.SetStateAction<number | undefined>
  >;
  readonly onToggleRead: (entry: EntryListItem) => void;
  readonly onToggleStar: (entry: EntryListItem) => void;
  readonly onFocusSearch: () => void;
};

function handleEntryShortcut(
  key: string,
  context: EntryShortcutContext,
): boolean {
  if (key === "/") {
    context.onFocusSearch();
    return true;
  }
  const { entries, activeIndex, setActiveIndex } = context;
  if (entries.length === 0) return false;
  if (key === "j") {
    setActiveIndex((prev) =>
      prev === undefined ? 0 : Math.min(entries.length - 1, prev + 1),
    );
    return true;
  }
  if (key === "k") {
    setActiveIndex((prev) => (prev === undefined ? 0 : Math.max(0, prev - 1)));
    return true;
  }
  const active = activeIndex === undefined ? undefined : entries[activeIndex];
  if (active === undefined) return false;
  if (key === "o") {
    globalThis.open(active.url, "_blank", "noopener,noreferrer");
    return true;
  }
  if (key === "m") {
    context.onToggleRead(active);
    return true;
  }
  if (key === "s") {
    context.onToggleStar(active);
    return true;
  }
  return false;
}

function useWorkspaceShortcuts(options: {
  readonly isEntriesRoute: boolean;
  readonly entries: readonly EntryListItem[];
  readonly activeIndex: number | undefined;
  readonly setActiveIndex: React.Dispatch<
    React.SetStateAction<number | undefined>
  >;
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly onToggleRead: (entry: EntryListItem) => void;
  readonly onToggleStar: (entry: EntryListItem) => void;
  readonly onRefresh: () => void;
}): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (shouldIgnoreGlobalKey(event)) return;
      if (event.key === "r") {
        event.preventDefault();
        options.onRefresh();
        return;
      }
      if (!options.isEntriesRoute) return;
      const handled = handleEntryShortcut(event.key, {
        entries: options.entries,
        activeIndex: options.activeIndex,
        setActiveIndex: options.setActiveIndex,
        onToggleRead: options.onToggleRead,
        onToggleStar: options.onToggleStar,
        onFocusSearch: () => {
          options.searchInputRef.current?.focus();
          options.searchInputRef.current?.select();
        },
      });
      if (handled) event.preventDefault();
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  });
}

function activeFeedTitleFor(
  route: Route | undefined,
  feeds: readonly FeedHealthItem[] | undefined,
): string | undefined {
  return route?.kind === "entries" && route.feedId !== undefined
    ? feeds?.find((feed) => feed.id === route.feedId)?.title
    : undefined;
}

function shouldLoadFeeds(route: Route | undefined): boolean {
  return (
    route !== undefined &&
    (route.kind === "feeds" || route.feedId !== undefined)
  );
}

type WorkspaceBodyProps = {
  readonly route: Route | undefined;
  readonly title: string;
  readonly pathname: string;
  readonly query: string;
  readonly searchInputRef: RefObject<HTMLInputElement | null>;
  readonly entriesQuery: ReturnType<typeof useEntries>;
  readonly feedsQuery: ReturnType<typeof useFeedsList>;
  readonly activeIndex: number | undefined;
  readonly deletingId: number | undefined;
  readonly onQueryChange: (next: string) => void;
  readonly onSelectIndex: (index: number) => void;
  readonly onToggleRead: (entry: EntryListItem) => void;
  readonly onToggleStar: (entry: EntryListItem) => void;
  readonly onEditFeed: (feed: FeedHealthItem) => void;
  readonly onDeleteFeed: (feed: FeedHealthItem) => void;
  readonly onNavigate: (href: string) => void;
};

function WorkspaceBody(props: WorkspaceBodyProps): React.JSX.Element {
  if (props.route === undefined) {
    return (
      <p className="fd-empty">
        Page not found.{" "}
        <a
          href="/"
          className="fd-inline-link"
          onClick={(event) => {
            event.preventDefault();
            props.onNavigate("/");
          }}
        >
          Return to Unread
        </a>
        .
      </p>
    );
  }
  if (props.route.kind === "feeds") {
    return (
      <FeedsSection
        feeds={props.feedsQuery.data?.feeds}
        isPending={props.feedsQuery.isPending}
        errorMessage={
          props.feedsQuery.isError ? props.feedsQuery.error.message : undefined
        }
        deletingId={props.deletingId}
        onEditFeed={props.onEditFeed}
        onDeleteFeed={props.onDeleteFeed}
        onNavigate={props.onNavigate}
      />
    );
  }
  const pages = props.entriesQuery.data?.pages;
  const entries = pages?.flatMap((page) => page.items) ?? [];
  return (
    <EntriesSection
      route={props.route}
      title={props.title}
      pathname={props.pathname}
      query={props.query}
      searchInputRef={props.searchInputRef}
      entries={entries}
      hasLoaded={pages !== undefined}
      nextCursor={pages?.at(-1)?.nextCursor ?? null}
      totalMatching={pages?.[0]?.totalMatching ?? 0}
      isPending={props.entriesQuery.isPending}
      errorMessage={
        props.entriesQuery.isError
          ? props.entriesQuery.error.message
          : undefined
      }
      isFetchingNextPage={props.entriesQuery.isFetchingNextPage}
      activeIndex={props.activeIndex}
      onQueryChange={props.onQueryChange}
      onSelectIndex={props.onSelectIndex}
      onToggleRead={props.onToggleRead}
      onToggleStar={props.onToggleStar}
      onLoadMore={() => {
        void props.entriesQuery.fetchNextPage();
      }}
      onNavigate={props.onNavigate}
    />
  );
}

export function App({
  theme,
}: {
  readonly theme: ThemeStore;
}): React.JSX.Element {
  const [pathname, setPathname] = useState(() => globalThis.location.pathname);
  const [searchStr, setSearchStr] = useState(() => globalThis.location.search);
  const [query, setQuery] = useState(() =>
    parseSearch(globalThis.location.search),
  );
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);
  const [dialogState, setDialogState] = useState<UserFeedDialogState>({
    kind: "closed",
  });
  const [confirmDelete, setConfirmDelete] = useState<
    FeedHealthItem | undefined
  >(undefined);
  const [bannerError, setBannerError] = useState<string | undefined>(undefined);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const route = parseRoute(pathname, searchStr);
  const summary = useSummary();
  const isEntriesRoute = route?.kind === "entries";
  const feedsQuery = useFeedsList(shouldLoadFeeds(route));
  const entriesQuery = useEntries(
    isEntriesRoute
      ? {
          view: route.view,
          category: route.category,
          feedId: route.feedId,
          q: query,
        }
      : { view: "unread" },
    isEntriesRoute,
  );

  const updateStateMutation = useUpdateEntriesState();
  const markAllReadMutation = useMarkAllRead();
  const refreshMutation = useRefreshFeeds();
  const createFeedMutation = useCreateUserFeed();
  const updateFeedMutation = useUpdateUserFeed();
  const deleteFeedMutation = useDeleteUserFeed();

  const entries = entriesQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const reportError = (error: Error): void => {
    setBannerError(error.message);
  };

  useEffect(() => {
    const onPopState = (): void => {
      const nextSearch = globalThis.location.search;
      setPathname(globalThis.location.pathname);
      setSearchStr(nextSearch);
      setQuery(parseSearch(nextSearch));
      setActiveIndex(undefined);
    };
    globalThis.addEventListener("popstate", onPopState);
    return () => {
      globalThis.removeEventListener("popstate", onPopState);
    };
  }, []);

  function navigate(href: string): void {
    const parsed = new URL(href, globalThis.location.origin);
    globalThis.history.pushState(
      null,
      "",
      `${parsed.pathname}${parsed.search}`,
    );
    setPathname(parsed.pathname);
    setSearchStr(parsed.search);
    setQuery(parseSearch(parsed.search));
    setActiveIndex(undefined);
    setBannerError(undefined);
  }

  function updateQuery(next: string): void {
    setQuery(next);
    setActiveIndex(undefined);
    const suffix = searchSuffix(next, searchStr);
    setSearchStr(suffix);
    globalThis.history.replaceState(null, "", `${pathname}${suffix}`);
  }

  function toggleRead(entry: EntryListItem): void {
    setBannerError(undefined);
    updateStateMutation.mutate(
      { ids: [entry.id], isRead: !entry.isRead },
      { onError: reportError },
    );
  }

  function toggleStar(entry: EntryListItem): void {
    setBannerError(undefined);
    updateStateMutation.mutate(
      { ids: [entry.id], isStarred: !entry.isStarred },
      { onError: reportError },
    );
  }

  function triggerRefresh(): void {
    if (refreshMutation.isPending) return;
    setBannerError(undefined);
    refreshMutation.mutate(undefined, { onError: reportError });
  }

  function triggerMarkViewRead(): void {
    const topEntry = entries[0];
    if (
      topEntry === undefined ||
      markAllReadMutation.isPending ||
      route?.kind !== "entries"
    ) {
      return;
    }
    setBannerError(undefined);
    markAllReadMutation.mutate(
      buildMarkAllReadBody(route, query, topEntry.id),
      { onError: reportError },
    );
  }

  useWorkspaceShortcuts({
    isEntriesRoute,
    entries,
    activeIndex,
    setActiveIndex,
    searchInputRef,
    onToggleRead: toggleRead,
    onToggleStar: toggleStar,
    onRefresh: triggerRefresh,
  });

  async function confirmDeleteFeed(): Promise<void> {
    if (confirmDelete === undefined || deleteFeedMutation.isPending) return;
    try {
      await deleteFeedMutation.mutateAsync(confirmDelete.id);
      setConfirmDelete(undefined);
    } catch (error: unknown) {
      const parsed = z.object({ message: z.string() }).safeParse(error);
      setBannerError(parsed.success ? parsed.data.message : "Delete failed.");
      setConfirmDelete(undefined);
    }
  }

  const feedsList = feedsQuery.data?.feeds;
  const title = route === undefined ? "Feeds" : routeTitle(route, feedsList);
  const figures = buildSummaryFigures(summary.data);

  return (
    <ShellFrame
      sidebar={
        <FeedsSidebar
          summary={summary.data}
          route={route}
          theme={theme}
          status={summary.isPending ? "Loading summary…" : undefined}
          failure={summary.isError ? summary.error.message : undefined}
          onNavigate={navigate}
        />
      }
    >
      <main className="fd-workspace">
        <FeedsPicker
          summary={summary.data}
          route={route}
          activeFeedTitle={activeFeedTitleFor(route, feedsList)}
          onNavigate={navigate}
        />
        <FeedsHeader
          title={title}
          route={route}
          summary={summary.data}
          query={query}
          hasEntries={entries.length > 0}
          isRefreshing={refreshMutation.isPending}
          isMarkingRead={markAllReadMutation.isPending}
          onNavigate={navigate}
          onRefresh={triggerRefresh}
          onMarkViewRead={triggerMarkViewRead}
          onAddFeed={() => {
            setDialogState({ kind: "create" });
          }}
        />
        {figures === undefined ? null : <FigureStrip figures={figures} />}
        {bannerError === undefined ? null : (
          <p role="alert" className="fd-banner-error">
            {bannerError}
          </p>
        )}
        <WorkspaceBody
          route={route}
          title={title}
          pathname={pathname}
          query={query}
          searchInputRef={searchInputRef}
          entriesQuery={entriesQuery}
          feedsQuery={feedsQuery}
          activeIndex={activeIndex}
          deletingId={
            deleteFeedMutation.isPending
              ? deleteFeedMutation.variables
              : undefined
          }
          onQueryChange={updateQuery}
          onSelectIndex={setActiveIndex}
          onToggleRead={toggleRead}
          onToggleStar={toggleStar}
          onEditFeed={(feed) => {
            setDialogState({ kind: "edit", feed });
          }}
          onDeleteFeed={setConfirmDelete}
          onNavigate={navigate}
        />
        <UserFeedDialog
          state={dialogState}
          categories={
            feedsQuery.data?.categories ?? summary.data?.categories ?? []
          }
          onClose={() => {
            setDialogState({ kind: "closed" });
          }}
          onCreate={async (body) => {
            await createFeedMutation.mutateAsync(body);
          }}
          onUpdate={async (id, body) => {
            await updateFeedMutation.mutateAsync({ id, body });
          }}
        />
        <DeleteFeedDialog
          target={confirmDelete}
          isDeleting={deleteFeedMutation.isPending}
          onClose={() => {
            setConfirmDelete(undefined);
          }}
          onConfirm={() => {
            void confirmDeleteFeed();
          }}
        />
      </main>
    </ShellFrame>
  );
}
