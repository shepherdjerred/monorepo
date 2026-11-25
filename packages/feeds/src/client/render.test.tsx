import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import {
  createThemeStore,
  type ThemeEnvironment,
} from "@shepherdjerred/console-ui";
import type {
  EntryListItem,
  FeedHealthItem,
  SummaryResponse,
} from "@shepherdjerred/feeds/shared/contract.ts";
import { EntriesSearchToolbar, EntryTable } from "./entry-table.tsx";
import { FeedsTable } from "./feeds-table.tsx";
import { FeedsPicker, FeedsSidebar } from "./sidebar.tsx";
import { UserFeedDialog } from "./user-feed-dialog.tsx";

const noop = (): void => {
  // Static markup render does not fire DOM handlers.
};

const asyncNoop = (): Promise<void> => Promise.resolve();

const environment: ThemeEnvironment = {
  storage: () => ({ getItem: () => null, setItem: noop, removeItem: noop }),
  darkQuery: { matches: false, addEventListener: noop },
  root: { dataset: {} },
  onStorage: noop,
};

const theme = createThemeStore("feeds-theme-test", environment);

const summary: SummaryResponse = {
  views: {
    unread: 18,
    all: 412,
    starred: 6,
    autoRead: 95,
  },
  categories: [
    {
      id: 1,
      label: "Repo Stack",
      managed: true,
      unreadCount: 11,
      feedCount: 24,
    },
    {
      id: 2,
      label: "Blogs",
      managed: true,
      unreadCount: 5,
      feedCount: 14,
    },
    {
      id: 3,
      label: "Uncategorized",
      managed: false,
      unreadCount: 2,
      feedCount: 1,
    },
  ],
  stats: {
    totalFeeds: 39,
    codeFeeds: 38,
    userFeeds: 1,
    failingFeeds: 2,
    lastPolledAt: 1_795_576_000,
  },
};

const entries: readonly EntryListItem[] = [
  {
    id: 101,
    title: "Bun 1.5 release notes",
    url: "https://bun.sh/blog/bun-v1.5",
    author: "Jarred Sumner",
    publishedAt: 1_795_575_700,
    crawledAtMs: 1_795_575_710_000,
    isRead: false,
    isStarred: true,
    autoReadMatched: false,
    feed: {
      id: 10,
      title: "Bun Blog",
      category: "Repo Stack",
      htmlUrl: "https://bun.sh/blog",
    },
  },
  {
    id: 100,
    title: "typescript@7.0.3-dev.20261124",
    url: "https://github.com/microsoft/TypeScript/releases/tag/v7.0.3-dev",
    author: "tsbot",
    publishedAt: 1_795_572_400,
    crawledAtMs: 1_795_572_410_000,
    isRead: true,
    isStarred: false,
    autoReadMatched: true,
    feed: {
      id: 11,
      title: "TypeScript Releases",
      category: "Repo Stack",
      htmlUrl: "https://github.com/microsoft/TypeScript",
    },
  },
];

const feeds: readonly FeedHealthItem[] = [
  {
    id: 10,
    title: "Bun Blog",
    category: "Repo Stack",
    source: "code",
    hidden: false,
    displayUrl: "https://bun.sh/rss.xml",
    htmlUrl: "https://bun.sh/blog",
    description: "Bun announcements",
    autoRead: {
      field: "title",
      pattern: String.raw`\b(canary|rc)\b`,
      flags: "i",
    },
    etag: '"abc"',
    lastModified: null,
    lastPolledAt: 1_795_576_000,
    lastSuccessAt: 1_795_576_000,
    lastStatus: 304,
    lastError: null,
    consecutiveFailures: 0,
    nextPollAfter: null,
    unreadCount: 3,
  },
  {
    id: 22,
    title: "LWN Subscriber Feed",
    category: "Uncategorized",
    source: "user",
    hidden: false,
    displayUrl: "https://lwn.net/headlines/newrss?[REDACTED]",
    htmlUrl: "https://lwn.net",
    description: null,
    autoRead: null,
    etag: null,
    lastModified: null,
    lastPolledAt: 1_795_575_000,
    lastSuccessAt: 1_795_500_000,
    lastStatus: 502,
    lastError: "Upstream HTTP 502",
    consecutiveFailures: 3,
    nextPollAfter: 1_795_579_000,
    unreadCount: 0,
  },
];

test("the sidebar renders view counts, failing badge, categories, and theme switcher", () => {
  const html = renderToStaticMarkup(
    <FeedsSidebar
      summary={summary}
      route={{ kind: "entries", view: "unread", category: "Repo Stack" }}
      theme={theme}
    />,
  );
  expect(html).toContain("Feeds");
  expect(html).toContain(">R<");
  expect(html).toContain("switch app");
  expect(html).toMatch(/>Views<\/p>/);
  expect(html).toMatch(/>Categories<\/p>/);
  expect(html).toMatch(/>Unread<\/span><span class="ui-nav-count">18</);
  expect(html).toMatch(/>Starred<\/span><span class="ui-nav-count">6</);
  expect(html).toMatch(/>Auto-read<\/span><span class="ui-nav-count">95</);
  expect(html).toMatch(
    />Feeds &amp; Health<\/span><span class="ui-nav-count">2</,
  );
  expect(html).toMatch(/>Repo Stack<\/span><span class="ui-nav-count">11</);
  expect(html).toMatch(/>Blogs<\/span><span class="ui-nav-count">5</);
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
  expect(html).toContain('href="/category/Repo%20Stack"');
  expect(html).toContain("Theme");

  // Failing badge disappears when failingFeeds === 0.
  const healthyHtml = renderToStaticMarkup(
    <FeedsSidebar
      summary={{
        ...summary,
        stats: { ...summary.stats, failingFeeds: 0 },
      }}
      route={{ kind: "entries", view: "unread" }}
      theme={theme}
    />,
  );
  expect(healthyHtml).toMatch(/>Feeds &amp; Health<\/span><\/a>/);
});

test("the narrow-width picker renders the app switcher and native select", () => {
  const html = renderToStaticMarkup(
    <FeedsPicker
      summary={summary}
      route={{ kind: "entries", view: "starred" }}
    />,
  );
  expect(html).toContain("switch app");
  expect(html).toContain("<select");
  expect(html).toContain(
    '<option value="/starred" selected="">Starred (6)</option>',
  );
  expect(html).toContain("Repo Stack (11)");
});

test("the entry table renders external links, feed filter chips, star/read states, auto-read badge, and load more", () => {
  const html = renderToStaticMarkup(
    <EntryTable
      entries={entries}
      view="all"
      activeIndex={0}
      nextCursor={99}
      totalMatching={412}
      nowSeconds={1_795_576_000}
      onToggleRead={noop}
      onToggleStar={noop}
      onLoadMore={noop}
    />,
  );
  expect(html).toContain('role="region"');
  expect(html).toContain('aria-label="Feed entries"');
  expect(html).toContain('tabindex="0"');
  expect(html).toContain(
    'href="https://bun.sh/blog/bun-v1.5" target="_blank" rel="noopener noreferrer"',
  );
  expect(html).toContain('href="/feed/10"');
  expect(html).toContain('aria-label="Remove star"');
  expect(html).toContain('aria-label="Star entry"');
  expect(html).toContain('aria-label="Mark read"');
  expect(html).toContain('aria-label="Mark unread"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('aria-pressed="false"');
  expect(html).toContain("Auto-read");
  expect(html).toContain("5m ago");
  expect(html).toContain("<time");
  expect(html).toContain("Load more");
  expect(html).toContain("Showing 2 of 412");
});

test("the feeds & health table renders status glyphs, redacted URLs, auto-read badges, and user-only actions", () => {
  const html = renderToStaticMarkup(
    <FeedsTable
      feeds={feeds}
      nowSeconds={1_795_576_000}
      onEdit={noop}
      onDelete={noop}
    />,
  );
  expect(html).toContain('data-sev="ok"');
  expect(html).toContain('data-sev="error"');
  expect(html).toContain("Critical");
  expect(html).toContain("https://lwn.net/headlines/newrss?[REDACTED]");
  expect(html).toContain(String.raw`~ /\b(canary|rc)\b/i`);
  expect(html).toContain("Upstream HTTP 502");
  expect(html).toContain("(3 failed)");
  expect(html).toContain(">Code<");
  expect(html).toContain(">User<");
  expect(html.match(/>Edit<\/button>/g)).toHaveLength(1);
  expect(html.match(/>Delete<\/button>/g)).toHaveLength(1);
});

test("the user feed dialog uses native modal semantics and never exposes stored secret URLs", () => {
  const userFeed = feeds[1];
  if (userFeed === undefined) throw new Error("missing fixture");

  const html = renderToStaticMarkup(
    <UserFeedDialog
      state={{ kind: "edit", feed: userFeed }}
      categories={summary.categories}
      onClose={noop}
      onCreate={asyncNoop}
      onUpdate={asyncNoop}
    />,
  );
  const dialogTag = html.slice(0, html.indexOf(">") + 1);
  expect(dialogTag).toContain("<dialog");
  expect(dialogTag).toContain('closedby="any"');
  expect(dialogTag).not.toContain(" open");
  expect(html).not.toContain('role="dialog"');
  expect(html).not.toContain("aria-modal");
  expect(html).toMatch(
    /<h1 id="[^"]+" class="fd-dialog-title">Edit user feed<\/h1>/,
  );
  expect(html).toContain('placeholder="Leave blank to keep stored URL"');
  expect(html).toContain('name="url" value=""');
  expect(html).toContain('autoCorrect="off"');
  expect(html).toContain('autoCapitalize="none"');
  expect(html).toContain('spellCheck="false"');
});

test("the search toolbar wraps a semantic <search> and GET form with identifier hints", () => {
  const html = renderToStaticMarkup(
    <EntriesSearchToolbar
      pathname="/category/Repo%20Stack"
      route={{ kind: "entries", view: "all", category: "Repo Stack" }}
      query="vitest"
      shownCount={2}
      totalMatching={8}
      onQueryChange={noop}
    />,
  );
  expect(html).toContain('<search class="fd-search">');
  expect(html).toContain('action="/category/Repo%20Stack" method="GET"');
  expect(html).toContain('type="hidden" name="view" value="all"');
  expect(html).toContain('type="search"');
  expect(html).toContain('name="q"');
  expect(html).toContain('value="vitest"');
  expect(html).toContain('autoComplete="off"');
  expect(html).toContain('autoCorrect="off"');
  expect(html).toContain("2 of 8");
});
