import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { asyncFeedsRepository } from "./sqlite-repository.ts";
import { FEEDS_STORE_CONTRACT } from "@shepherdjerred/feeds/server/contract/contract.ts";
import { SAMPLE_CATALOG } from "@shepherdjerred/feeds/server/contract/support.ts";
import { FeedsStore } from "./store.ts";

describe("SQLite FeedsStore contract", () => {
  for (const contractCase of FEEDS_STORE_CONTRACT) {
    test(contractCase.name, async () => {
      await contractCase.run(async () =>
        asyncFeedsRepository(FeedsStore.open(":memory:")),
      );
    });
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

    // Re-running reconcileCatalog when autoRead rule is unchanged preserves manual unread state
    store.updateEntriesState({ ids: [1001], isRead: false });
    store.reconcileCatalog(SAMPLE_CATALOG);
    expect(store.getEntriesByIds([1001])[0]?.isRead).toBe(false);

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

    // Title-only user feed update does not re-sweep manually unread entries
    const promoEntry = store
      .queryEntries({ view: "all", feedId: 11 })
      .items.find((i) => i.title === "Join our webinar");
    if (promoEntry === undefined) {
      throw new Error("Expected promo entry");
    }
    store.updateEntriesState({ ids: [promoEntry.id], isRead: false });
    expect(store.updateUserFeed(11, { title: "Renamed User Feed" }).ok).toBe(
      true,
    );
    expect(store.getEntriesByIds([promoEntry.id])[0]?.isRead).toBe(false);
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
