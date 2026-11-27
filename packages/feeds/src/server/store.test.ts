import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";
import { DECLARED_FEEDS } from "@shepherdjerred/feeds/catalog/catalog.ts";
import {
  AI_SDK_ONLY_RULE,
  STRICT_RELEASE_RULES,
} from "@shepherdjerred/feeds/catalog/rules.ts";
import type { DeclaredFeed } from "@shepherdjerred/feeds/shared/contract.ts";
import { FeedsStore } from "./store.ts";

const SAMPLE_CATALOG: readonly DeclaredFeed[] = [
  {
    category: "Engineering & Infra",
    title: "Hono Releases",
    url: "https://github.com/honojs/hono/releases.atom",
    htmlUrl: "https://github.com/honojs/hono/releases",
    autoRead: STRICT_RELEASE_RULES,
  },
  {
    category: "AI",
    title: "Vercel News — AI SDK",
    url: "https://vercel.com/atom",
    htmlUrl: "https://vercel.com/ai-sdk",
    autoRead: AI_SDK_ONLY_RULE,
  },
  {
    category: "Essays & Personal Blogs",
    title: "Jerred's Blog",
    url: "https://sjer.red/rss.xml",
    htmlUrl: "https://sjer.red/",
  },
  {
    category: "Engineering & Infra",
    title: "Visual Studio Code",
    url: "https://code.visualstudio.com/feed.xml",
    htmlUrl: "https://code.visualstudio.com/",
    hidden: true,
  },
];

test("FeedsStore reconciles full catalog idempotently, preserves user feeds, and prunes stale code feeds", () => {
  const store = FeedsStore.open(":memory:");
  try {
    const initialEtag = store.subscriptionsEtag();
    const first = store.reconcileCatalog(DECLARED_FEEDS);
    expect(first).toEqual({ upserted: 65, pruned: 0 });
    const afterFirstEtag = store.subscriptionsEtag();
    expect(afterFirstEtag).not.toBe(initialEtag);

    const second = store.reconcileCatalog(DECLARED_FEEDS);
    expect(second).toEqual({ upserted: 65, pruned: 0 });
    expect(store.subscriptionsEtag()).toBe(afterFirstEtag);

    const createdUser = store.createUserFeed({
      url: "https://lwn.net/headlines/newrss?token=subscriber-demo",
      title: "LWN Subscriber",
      category: "Security",
      hidden: false,
    });
    expect(createdUser.ok).toBe(true);

    const third = store.reconcileCatalog(SAMPLE_CATALOG);
    expect(third).toEqual({ upserted: 4, pruned: 61 });

    const allFeeds = store.listAllFeeds();
    expect(allFeeds).toHaveLength(5);
    expect(allFeeds.filter((f) => f.source === "user")).toHaveLength(1);
    expect(allFeeds.filter((f) => f.source === "code")).toHaveLength(4);

    const categories = store.listAllCategories();
    expect(
      categories.map((c) => ({ label: c.label, managed: c.managed })),
    ).toEqual([
      { label: "Engineering & Infra", managed: true },
      { label: "AI", managed: true },
      { label: "Essays & Personal Blogs", managed: true },
      { label: "Uncategorized", managed: false },
      { label: "Security", managed: false },
    ]);
  } finally {
    store.close();
  }
});

test("FeedsStore migrates legacy SQLite schemas, cleans up obsolete managed categories, and applies auto-read retroactively", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "feeds-store-migrate-"));
  const dbPath = path.join(dir, "legacy-feeds.sqlite");
  try {
    const rawDb = new Database(dbPath);
    rawDb.run(
      "CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO meta VALUES ('subscriptions_etag', '1')",
    );
    rawDb.run(
      "CREATE TABLE categories (id INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT NOT NULL UNIQUE, managed INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 100)",
    );
    rawDb.run(
      "INSERT INTO categories (id, label, managed, sort_order) VALUES (1, 'Repo Stack', 1, 10), (2, 'Blogs', 1, 20), (3, 'Uncategorized', 0, 30)",
    );
    rawDb.run(
      "CREATE TABLE feeds (id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, category_id INTEGER NOT NULL REFERENCES categories(id), html_url TEXT, description TEXT, source TEXT NOT NULL CHECK (source IN ('code', 'user')), hidden INTEGER NOT NULL DEFAULT 0, auto_read_json TEXT, etag TEXT, last_modified TEXT, last_polled_at INTEGER, last_success_at INTEGER, last_status INTEGER, last_error TEXT, consecutive_failures INTEGER NOT NULL DEFAULT 0, next_poll_after INTEGER)",
    );
    rawDb.run(
      "INSERT INTO feeds (id, url, title, category_id, source, hidden) VALUES (10, 'https://github.com/honojs/hono/releases.atom', 'Hono Releases', 1, 'code', 0), (11, 'https://private.example/rss', 'Legacy User In Repo Stack', 1, 'user', 0)",
    );
    // Legacy entries table without categories_json column
    rawDb.run(
      "CREATE TABLE entries (id INTEGER PRIMARY KEY, feed_id INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE, guid TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL DEFAULT '', content_html TEXT NOT NULL DEFAULT '', published_at INTEGER NOT NULL, crawled_at_ms INTEGER NOT NULL, enclosures_json TEXT NOT NULL DEFAULT '[]', is_read INTEGER NOT NULL DEFAULT 0, is_starred INTEGER NOT NULL DEFAULT 0, auto_read_matched INTEGER NOT NULL DEFAULT 0, UNIQUE (feed_id, guid))",
    );
    rawDb.run(
      "INSERT INTO entries (id, feed_id, guid, url, title, published_at, crawled_at_ms, is_read, is_starred) VALUES (1001, 10, 'g-patch', 'https://github.com/honojs/hono/releases/tag/v4.13.21', 'v4.13.21', 1700000001, 1700000001000, 0, 0), (1002, 10, 'g-starred-patch', 'https://github.com/honojs/hono/releases/tag/v4.13.22', 'v4.13.22', 1700000002, 1700000002000, 0, 1), (1003, 10, 'g-minor', 'https://github.com/honojs/hono/releases/tag/v4.14.0', 'v4.14.0', 1700000003, 1700000003000, 0, 0)",
    );
    rawDb.close();

    const store = FeedsStore.open(dbPath);
    store.reconcileCatalog(SAMPLE_CATALOG);

    // Obsolete managed categories ("Repo Stack", "Blogs") removed; user feed moved to Uncategorized
    expect(store.listAllCategories().map((c) => c.label)).toEqual([
      "Engineering & Infra",
      "AI",
      "Essays & Personal Blogs",
      "Uncategorized",
    ]);
    expect(store.getFeedById(11)?.categoryLabel).toBe("Uncategorized");

    // Unstarred patch release retroactively auto-read; starred patch & .0 minor kept unread
    const entries = store.getEntriesByIds([1001, 1002, 1003]);
    expect(entries[0]?.isRead).toBe(true);
    expect(entries[0]?.autoReadMatched).toBe(true);
    expect(entries[1]?.isRead).toBe(false);
    expect(entries[1]?.isStarred).toBe(true);
    expect(entries[2]?.isRead).toBe(false);

    // Updating a user feed's autoRead rule also sweeps existing unread entries
    store.recordPollSuccess({
      feedId: 11,
      polledAtSeconds: 1_710_000_000,
      etag: null,
      lastModified: null,
      entries: [
        {
          guid: "u-promo",
          url: "https://private.example/webinar",
          title: "Join our webinar",
          author: "Marketing",
          contentHtml: "",
          publishedAt: 1_710_000_000,
          enclosures: [],
          categories: ["Webinar"],
        },
        {
          guid: "u-tech",
          url: "https://private.example/kernel",
          title: "Kernel sched_ext deep dive",
          author: "Eng",
          contentHtml: "",
          publishedAt: 1_710_000_010,
          enclosures: [],
          categories: ["Engineering"],
        },
      ],
    });
    const updatedUser = store.updateUserFeed(11, {
      autoRead: { field: "category", pattern: "^Webinar$", flags: "i" },
    });
    expect(updatedUser.ok).toBe(true);
    const userUnread = store.queryEntries({ view: "unread", feedId: 11 });
    expect(userUnread.items.map((i) => i.title)).toEqual([
      "Kernel sched_ext deep dive",
    ]);
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FeedsStore opens on-disk SQLite with WAL mode and persists monotonic 53-bit entry IDs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "feeds-store-wal-"));
  const dbPath = path.join(dir, "feeds.sqlite");
  try {
    const store1 = FeedsStore.open(dbPath);
    store1.reconcileCatalog(SAMPLE_CATALOG);
    const blog = store1.getFeedByUrl("https://sjer.red/rss.xml");
    expect(blog).toBeDefined();
    if (blog === undefined) {
      return;
    }
    store1.importRawEntry({
      id: 1_795_569_203_477_068,
      feedId: blog.id,
      guid: "imported-1",
      url: "https://sjer.red/1",
      title: "Imported Entry",
      author: "Jerred",
      contentHtml: "<p>Hi</p>",
      publishedAt: 1_795_569_203,
      crawledAtMs: 1_795_569_203_477,
      enclosures: [],
      isRead: false,
      isStarred: false,
    });
    store1.close();

    const store2 = FeedsStore.open(dbPath);
    store2.recordPollSuccess({
      feedId: blog.id,
      polledAtSeconds: 1_700_000_000,
      etag: '"v1"',
      lastModified: null,
      entries: [
        {
          guid: "polled-after-import",
          url: "https://sjer.red/2",
          title: "New Post",
          author: "Jerred",
          contentHtml: "<p>Body</p>",
          publishedAt: 1_700_000_000,
          enclosures: [],
        },
      ],
    });
    const entries = store2.queryEntries({ view: "all" });
    expect(entries.items).toHaveLength(2);
    expect(entries.items[0]?.id).toBe(1_795_569_203_477_069);
    expect(entries.items[1]?.id).toBe(1_795_569_203_477_068);
    expect(Number.isSafeInteger(entries.items[0]?.id)).toBe(true);
    store2.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FeedsStore applies auto-read on insert without overwriting manual unread/star state on re-poll", () => {
  const store = FeedsStore.open(":memory:");
  try {
    store.reconcileCatalog([
      ...SAMPLE_CATALOG,
      {
        category: "Essays & Personal Blogs",
        title: "No HtmlUrl Blog",
        url: "https://example.org/rss.xml",
      },
    ]);
    const hono = store.getFeedByUrl(
      "https://github.com/honojs/hono/releases.atom",
    );
    const vercel = store.getFeedByUrl("https://vercel.com/atom");
    const discoverable = store.getFeedByUrl("https://example.org/rss.xml");
    if (
      hono === undefined ||
      vercel === undefined ||
      discoverable === undefined
    ) {
      throw new Error("Expected sample feeds");
    }

    const honoPoll = store.recordPollSuccess({
      feedId: hono.id,
      polledAtSeconds: 1_710_000_000,
      etag: '"etag-1"',
      lastModified: "Mon, 01 Jan 2026 00:00:00 GMT",
      entries: [
        {
          guid: "hono-beta",
          url: "https://github.com/honojs/hono/releases/tag/v4.0.0-rc.1",
          title: "v4.0.0-rc.1",
          author: "yusukebe",
          contentHtml: "<p>RC</p>",
          publishedAt: 1_710_000_000,
          enclosures: [],
        },
        {
          guid: "hono-stable",
          url: "https://github.com/honojs/hono/releases/tag/v4.0.0",
          title: "v4.0.0",
          author: "yusukebe",
          contentHtml: "<p>Stable</p>",
          publishedAt: 1_710_000_010,
          enclosures: [],
        },
      ],
    });
    expect(honoPoll).toEqual({ inserted: 2, autoRead: 1 });

    const vercelPoll = store.recordPollSuccess({
      feedId: vercel.id,
      polledAtSeconds: 1_710_000_020,
      etag: null,
      lastModified: null,
      entries: [
        {
          guid: "v-1",
          url: "https://vercel.com/blog/ai-sdk-4",
          title: "Vercel AI SDK 4.0",
          author: "Vercel",
          contentHtml: "<p>AI SDK</p>",
          publishedAt: 1_710_000_020,
          enclosures: [],
        },
        {
          guid: "v-2",
          url: "https://vercel.com/blog/Ship-2026",
          title: "Vercel Ship 2026 Recap",
          author: "Vercel",
          contentHtml: "<p>Ship</p>",
          publishedAt: 1_710_000_025,
          enclosures: [],
        },
      ],
    });
    expect(vercelPoll).toEqual({ inserted: 2, autoRead: 1 });

    const autoReadView = store.queryEntries({ view: "auto-read" });
    expect(autoReadView.totalMatching).toBe(2);
    const betaItem = autoReadView.items.find((i) => i.title === "v4.0.0-rc.1");
    if (betaItem === undefined) {
      throw new Error("Expected beta item");
    }
    store.updateEntriesState({
      ids: [betaItem.id],
      isRead: false,
      isStarred: true,
    });

    const repoll = store.recordPollSuccess({
      feedId: hono.id,
      polledAtSeconds: 1_710_000_100,
      etag: '"etag-2"',
      lastModified: null,
      entries: [
        {
          guid: "hono-beta",
          url: "https://github.com/honojs/hono/releases/tag/v4.0.0-rc.1",
          title: "v4.0.0-rc.1 (updated notes)",
          author: "yusukebe",
          contentHtml: "<p>Updated RC notes</p>",
          publishedAt: 1_710_000_000,
          enclosures: [
            { href: "https://example.com/asset.tar.gz", length: 42 },
          ],
        },
      ],
    });
    expect(repoll).toEqual({ inserted: 0, autoRead: 0 });

    const reloaded = store.getEntriesByIds([betaItem.id])[0];
    expect(reloaded?.title).toBe("v4.0.0-rc.1 (updated notes)");
    expect(reloaded?.isRead).toBe(false);
    expect(reloaded?.isStarred).toBe(true);
    expect(reloaded?.enclosures).toEqual([
      { href: "https://example.com/asset.tar.gz", length: 42 },
    ]);

    store.recordPollSuccess({
      feedId: discoverable.id,
      polledAtSeconds: 1_710_000_200,
      etag: null,
      lastModified: null,
      discoveredHtmlUrl: "https://example.org/",
      entries: [],
    });
    expect(store.getFeedById(discoverable.id)?.htmlUrl).toBe(
      "https://example.org/",
    );
  } finally {
    store.close();
  }
});

test("FeedsStore handles poll scheduling, backoff filtering, 304 not-modified, and health redaction", () => {
  const store = FeedsStore.open(":memory:");
  try {
    store.reconcileCatalog(SAMPLE_CATALOG.slice(0, 2));
    const created = store.createUserFeed({
      url: "https://private.example.com/rss?token=keep-secret",
      title: "Private Feed",
      category: "Private",
      hidden: false,
    });
    if (!created.ok) {
      throw new Error("Expected user feed creation");
    }

    const dueInitial = store.listFeedsForPoll(1000);
    expect(dueInitial).toHaveLength(3);
    const firstFeed = dueInitial[0];
    if (firstFeed === undefined) {
      throw new Error("Expected first feed");
    }

    store.recordPollFailure({
      feedId: firstFeed.id,
      polledAtSeconds: 1000,
      status: 503,
      errorMessage: "Upstream 503",
      nextPollAfterSeconds: 2000,
    });
    expect(store.listFeedsForPoll(1500)).toHaveLength(2);
    expect(store.listFeedsForPoll(2000)).toHaveLength(3);
    expect(store.summary().stats.failingFeeds).toBe(1);

    store.recordPollNotModified({
      feedId: firstFeed.id,
      polledAtSeconds: 2000,
      etag: '"304-etag"',
    });
    const recovered = store.getFeedById(firstFeed.id);
    expect(recovered?.consecutiveFailures).toBe(0);
    expect(recovered?.lastError).toBeNull();
    expect(recovered?.lastStatus).toBe(304);
    expect(recovered?.etag).toBe('"304-etag"');

    const health = store.listFeedsHealth((url, source) =>
      source === "user" ? `${new URL(url).origin}?[REDACTED]` : url,
    );
    const userHealth = health.feeds.find((f) => f.source === "user");
    expect(userHealth?.displayUrl).toBe(
      "https://private.example.com?[REDACTED]",
    );
  } finally {
    store.close();
  }
});

test("FeedsStore supports FTS5 search with tricky punctuation, hidden feed scoping, pagination, and markAllRead", () => {
  const store = FeedsStore.open(":memory:");
  try {
    store.reconcileCatalog(SAMPLE_CATALOG);
    const blog = store.getFeedByUrl("https://sjer.red/rss.xml");
    const hiddenVsCode = store.getFeedByUrl(
      "https://code.visualstudio.com/feed.xml",
    );
    if (blog === undefined || hiddenVsCode === undefined) {
      throw new Error("Expected feeds");
    }

    store.recordPollSuccess({
      feedId: blog.id,
      polledAtSeconds: 1_720_000_000,
      etag: null,
      lastModified: null,
      entries: [
        {
          guid: "e1",
          url: "https://sjer.red/ai",
          title: "Shipping Vercel AI SDK in Production",
          author: "Jerred Shepherd",
          contentHtml: "<p>1</p>",
          publishedAt: 1_720_000_001,
          enclosures: [],
        },
        {
          guid: "e2",
          url: "https://sjer.red/ver",
          title: "Upgrading Hono to v1.4.2 safely",
          author: "Bjarne C++",
          contentHtml: "<p>2</p>",
          publishedAt: 1_720_000_002,
          enclosures: [],
        },
        {
          guid: "e3",
          url: "https://sjer.red/exact",
          title: "Notes on exact phrase matching in FTS5",
          author: "SQLite Team",
          contentHtml: "<p>3</p>",
          publishedAt: 1_720_000_003,
          enclosures: [],
        },
      ],
    });

    store.recordPollSuccess({
      feedId: hiddenVsCode.id,
      polledAtSeconds: 1_720_000_010,
      etag: null,
      lastModified: null,
      entries: [
        {
          guid: "vs-1",
          url: "https://code.visualstudio.com/updates/v1_99",
          title: "VS Code 1.99 Release",
          author: "Microsoft",
          contentHtml: "<p>Hidden</p>",
          publishedAt: 1_720_000_010,
          enclosures: [],
        },
        {
          guid: "vs-old",
          url: "https://code.visualstudio.com/updates/v1_50",
          title: "VS Code 1.50 Release",
          author: "Microsoft",
          contentHtml: "<p>Old Hidden</p>",
          publishedAt: 1_700_000_000,
          enclosures: [],
        },
      ],
    });

    expect(store.queryEntries({ view: "unread" }).totalMatching).toBe(3);
    expect(store.queryEntries({ view: "all" }).totalMatching).toBe(3);
    expect(store.summary().views.unread).toBe(3);

    expect(
      store.queryEntries({ view: "unread", category: "Engineering & Infra" })
        .totalMatching,
    ).toBe(2);
    expect(
      store.queryEntries({ view: "unread", feedId: hiddenVsCode.id })
        .totalMatching,
    ).toBe(2);

    const hiddenRecent = store
      .queryEntries({ view: "all", feedId: hiddenVsCode.id })
      .items.find((i) => i.title === "VS Code 1.99 Release");
    if (hiddenRecent === undefined) {
      throw new Error("Expected hidden entry");
    }
    store.editEntryTags({ ids: [hiddenRecent.id], markStarred: true });
    expect(store.queryEntries({ view: "starred" }).totalMatching).toBe(1);

    expect(
      store.queryEntries({ view: "all", q: "AI SDK" }).items.map((i) => i.url),
    ).toEqual(["https://sjer.red/ai"]);
    expect(
      store.queryEntries({ view: "all", q: "v1.4.2" }).items.map((i) => i.url),
    ).toEqual(["https://sjer.red/ver"]);
    expect(
      store.queryEntries({ view: "all", q: "c++" }).items.map((i) => i.url),
    ).toEqual(["https://sjer.red/ver"]);
    expect(
      store
        .queryEntries({ view: "all", q: '"exact phrase"' })
        .items.map((i) => i.url),
    ).toEqual(["https://sjer.red/exact"]);
    expect(
      store.queryEntries({ view: "all", q: '"exact' }).items.map((i) => i.url),
    ).toEqual(["https://sjer.red/exact"]);
    expect(
      store.queryEntries({ view: "all", q: "+++ ???" }).totalMatching,
    ).toBe(0);

    const page1 = store.queryEntries({ view: "all", limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.totalMatching).toBe(3);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = store.queryEntries({
      view: "all",
      limit: 2,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    // Age-cutoff markAllRead across visible + hidden feeds while preserving starred items
    expect(
      store.markAllRead({
        publishedBefore: 1_710_000_000,
        includeHidden: true,
        excludeStarred: true,
      }),
    ).toBe(1);
    expect(
      store.queryEntries({ view: "unread", feedId: hiddenVsCode.id })
        .totalMatching,
    ).toBe(1);

    expect(store.markAllRead({ view: "unread", q: "v1.4.2" })).toBe(1);
    expect(store.queryEntries({ view: "unread" }).totalMatching).toBe(2);
    expect(store.markAllRead({ view: "unread" })).toBe(2);
    expect(
      store.queryEntries({ view: "unread", feedId: hiddenVsCode.id })
        .totalMatching,
    ).toBe(1);
  } finally {
    store.close();
  }
});

test("FeedsStore enforces source='code' forbidden protection, user feed CRUD, and category mutations", () => {
  const store = FeedsStore.open(":memory:");
  try {
    store.reconcileCatalog(SAMPLE_CATALOG);
    const codeFeed = store.getFeedByUrl("https://sjer.red/rss.xml");
    if (codeFeed === undefined) {
      throw new Error("Expected code feed");
    }

    expect(store.updateUserFeed(codeFeed.id, { title: "Hack" })).toEqual({
      ok: false,
      kind: "forbidden",
      message: "Code-managed feeds cannot be modified",
    });
    expect(store.deleteUserFeed(codeFeed.id)).toEqual({
      ok: false,
      kind: "forbidden",
      message: "Code-managed feeds cannot be deleted",
    });

    expect(
      store.renameUserCategory("Engineering & Infra", "Other"),
    ).toMatchObject({
      ok: false,
      kind: "forbidden",
    });
    expect(store.deleteUserCategory("Essays & Personal Blogs")).toMatchObject({
      ok: false,
      kind: "forbidden",
    });

    expect(
      store.createUserFeed({
        url: codeFeed.url,
        category: "Custom",
        hidden: false,
      }),
    ).toMatchObject({ ok: false, kind: "conflict" });

    const created = store.createUserFeed({
      url: "https://user-feed.example.com/atom.xml",
      title: "My Feed",
      category: "Reading",
      hidden: false,
    });
    if (!created.ok) {
      throw new Error("Expected user feed created");
    }
    const updated = store.updateUserFeed(created.feed.id, {
      title: "My Updated Feed",
      url: "https://user-feed.example.com/atom.xml?key=rotated",
    });
    expect(updated.ok && updated.feed.title).toBe("My Updated Feed");

    expect(store.renameUserCategory("Reading", "Weekend")).toEqual({
      ok: true,
    });
    expect(store.getFeedById(created.feed.id)?.categoryLabel).toBe("Weekend");

    expect(store.deleteUserCategory("Weekend")).toEqual({ ok: true });
    expect(store.getFeedById(created.feed.id)?.categoryLabel).toBe(
      "Uncategorized",
    );
    expect(store.deleteUserFeed(created.feed.id)).toEqual({ ok: true });
  } finally {
    store.close();
  }
});

test("FeedsStore supports Reader sessions, stream queries, and entry pruning", () => {
  const store = FeedsStore.open(":memory:");
  try {
    store.reconcileCatalog(SAMPLE_CATALOG);
    const created = store.createUserFeed({
      url: "https://user-feed.example.com/atom.xml",
      title: "My Feed",
      category: "Reading",
      hidden: false,
    });
    const hiddenFeed = store.getFeedByUrl(
      "https://code.visualstudio.com/feed.xml",
    );
    if (!created.ok) {
      throw new Error("Expected user feed");
    }
    if (hiddenFeed === undefined) {
      throw new Error("Expected hidden feed");
    }

    store.createReaderSession({
      tokenSha256: "hash-valid",
      username: "jerred",
      nowSeconds: 1000,
      ttlSeconds: 300,
    });
    expect(store.validateReaderSession("hash-valid", 1200)).toEqual({
      username: "jerred",
    });
    expect(store.validateReaderSession("hash-valid", 1300)).toBeUndefined();

    store.recordPollSuccess({
      feedId: created.feed.id,
      polledAtSeconds: 5000,
      etag: null,
      lastModified: null,
      entries: [
        {
          guid: "u1",
          url: "https://u.example/1",
          title: "Old Read 1",
          author: "A",
          contentHtml: "",
          publishedAt: 100,
          enclosures: [],
        },
        {
          guid: "u2",
          url: "https://u.example/2",
          title: "Old Read 2",
          author: "A",
          contentHtml: "",
          publishedAt: 200,
          enclosures: [],
        },
        {
          guid: "u3",
          url: "https://u.example/3",
          title: "Old Starred Read",
          author: "A",
          contentHtml: "",
          publishedAt: 50,
          enclosures: [],
        },
        {
          guid: "u4",
          url: "https://u.example/4",
          title: "Old Unread",
          author: "A",
          contentHtml: "",
          publishedAt: 40,
          enclosures: [],
        },
        {
          guid: "u5",
          url: "https://u.example/5",
          title: "Recent Read",
          author: "A",
          contentHtml: "",
          publishedAt: 9950,
          enclosures: [],
        },
      ],
    });
    store.recordPollSuccess({
      feedId: hiddenFeed.id,
      polledAtSeconds: 5010,
      etag: null,
      lastModified: null,
      entries: [
        {
          guid: "h1",
          url: "https://code.visualstudio.com/1",
          title: "Hidden Item",
          author: "MS",
          contentHtml: "",
          publishedAt: 5000,
          enclosures: [],
        },
      ],
    });

    const rlPage1 = store.queryReaderStreamIds({
      stream: { kind: "reading-list" },
      excludeRead: false,
      limit: 2,
    });
    expect(rlPage1.ids).toHaveLength(2);
    expect(rlPage1.nextCursor).toBeDefined();
    const rlAll = store.queryReaderStreamIds({
      stream: { kind: "reading-list" },
      excludeRead: false,
      limit: 100,
    });
    expect(rlAll.ids).toHaveLength(5);
    const engStream = store.queryReaderStreamIds({
      stream: { kind: "category", label: "Engineering & Infra" },
      excludeRead: false,
      limit: 100,
    });
    expect(engStream.ids).toHaveLength(1);

    const userItems = store.getEntriesByIds(rlAll.ids);
    const byTitle = new Map(userItems.map((i) => [i.title, i.id]));
    store.editEntryTags({
      ids: [
        byTitle.get("Old Read 1") ?? 0,
        byTitle.get("Old Read 2") ?? 0,
        byTitle.get("Recent Read") ?? 0,
      ],
      markRead: true,
    });
    store.editEntryTags({
      ids: [byTitle.get("Old Starred Read") ?? 0],
      markRead: true,
      markStarred: true,
    });

    const pruned = store.pruneOldEntries({
      maxReadPerFeed: 2,
      minAgeSeconds: 100,
      nowSeconds: 10_000,
    });
    expect(pruned).toBe(1);
    const remainingTitles = store
      .queryEntries({ view: "all", feedId: created.feed.id })
      .items.map((i) => i.title);
    expect(remainingTitles).toContain("Old Read 2");
    expect(remainingTitles).toContain("Recent Read");
    expect(remainingTitles).toContain("Old Starred Read");
    expect(remainingTitles).toContain("Old Unread");
    expect(remainingTitles).not.toContain("Old Read 1");
  } finally {
    store.close();
  }
});
