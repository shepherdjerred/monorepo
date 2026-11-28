import { expect } from "vitest";
import {
  countEntries,
  entryUrls,
  entryTitles,
  findEntry,
  SAMPLE_CATALOG,
  type OpenStore,
} from "./support.ts";

export async function searchesAndMarksRead(open: OpenStore): Promise<void> {
  const store = await open();
  try {
    await store.reconcileCatalog(SAMPLE_CATALOG);
    const blog = await store.getFeedByUrl("https://sjer.red/rss.xml");
    const hiddenVsCode = await store.getFeedByUrl(
      "https://code.visualstudio.com/feed.xml",
    );
    if (blog === undefined || hiddenVsCode === undefined) {
      throw new Error("Expected feeds");
    }

    await store.recordPollSuccess({
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

    await store.recordPollSuccess({
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

    expect(await countEntries(store, { view: "unread" })).toBe(3);
    expect(await countEntries(store, { view: "all" })).toBe(3);
    expect(await store.summary()).toMatchObject({ views: { unread: 3 } });

    expect(
      await countEntries(store, {
        view: "unread",
        category: "Engineering & Infra",
      }),
    ).toBe(2);
    expect(
      await countEntries(store, { view: "unread", feedId: hiddenVsCode.id }),
    ).toBe(2);

    const hiddenRecent = await findEntry(
      store,
      { view: "all", feedId: hiddenVsCode.id },
      "VS Code 1.99 Release",
    );
    if (hiddenRecent === undefined) {
      throw new Error("Expected hidden entry");
    }
    await store.editEntryTags({ ids: [hiddenRecent.id], markStarred: true });
    expect(await countEntries(store, { view: "starred" })).toBe(1);

    expect(await entryUrls(store, { view: "all", q: "AI SDK" })).toEqual([
      "https://sjer.red/ai",
    ]);
    expect(await entryUrls(store, { view: "all", q: "v1.4.2" })).toEqual([
      "https://sjer.red/ver",
    ]);
    expect(await entryUrls(store, { view: "all", q: "c++" })).toEqual([
      "https://sjer.red/ver",
    ]);
    expect(
      await entryUrls(store, { view: "all", q: '"exact phrase"' }),
    ).toEqual(["https://sjer.red/exact"]);
    expect(await entryUrls(store, { view: "all", q: '"exact' })).toEqual([
      "https://sjer.red/exact",
    ]);
    expect(await countEntries(store, { view: "all", q: "+++ ???" })).toBe(0);

    const page1 = await store.queryEntries({ view: "all", limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.totalMatching).toBe(3);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await store.queryEntries({
      view: "all",
      limit: 2,
      cursor: page1.nextCursor ?? undefined,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    // Age-cutoff markAllRead across visible + hidden feeds while preserving starred items
    expect(
      await store.markAllRead({
        publishedBefore: 1_710_000_000,
        includeHidden: true,
        excludeStarred: true,
      }),
    ).toBe(1);
    expect(
      await countEntries(store, { view: "unread", feedId: hiddenVsCode.id }),
    ).toBe(1);

    expect(await store.markAllRead({ view: "unread", q: "v1.4.2" })).toBe(1);
    expect(await countEntries(store, { view: "unread" })).toBe(2);
    expect(await store.markAllRead({ view: "unread" })).toBe(2);
    expect(
      await countEntries(store, { view: "unread", feedId: hiddenVsCode.id }),
    ).toBe(1);
  } finally {
    await store.close();
  }
}
export async function protectsCodeFeeds(open: OpenStore): Promise<void> {
  const store = await open();
  try {
    await store.reconcileCatalog(SAMPLE_CATALOG);
    const codeFeed = await store.getFeedByUrl("https://sjer.red/rss.xml");
    if (codeFeed === undefined) {
      throw new Error("Expected code feed");
    }

    expect(await store.updateUserFeed(codeFeed.id, { title: "Hack" })).toEqual({
      ok: false,
      kind: "forbidden",
      message: "Code-managed feeds cannot be modified",
    });
    expect(await store.deleteUserFeed(codeFeed.id)).toEqual({
      ok: false,
      kind: "forbidden",
      message: "Code-managed feeds cannot be deleted",
    });

    expect(
      await store.renameUserCategory("Engineering & Infra", "Other"),
    ).toMatchObject({
      ok: false,
      kind: "forbidden",
    });
    expect(
      await store.deleteUserCategory("Essays & Personal Blogs"),
    ).toMatchObject({
      ok: false,
      kind: "forbidden",
    });

    expect(
      await store.createUserFeed({
        url: codeFeed.url,
        category: "Custom",
        hidden: false,
      }),
    ).toMatchObject({ ok: false, kind: "conflict" });

    const created = await store.createUserFeed({
      url: "https://user-feed.example.com/atom.xml",
      title: "My Feed",
      category: "Reading",
      hidden: false,
    });
    if (!created.ok) {
      throw new Error("Expected user feed created");
    }
    const updated = await store.updateUserFeed(created.feed.id, {
      title: "My Updated Feed",
      url: "https://user-feed.example.com/atom.xml?key=rotated",
    });
    expect(updated.ok && updated.feed.title).toBe("My Updated Feed");

    expect(await store.renameUserCategory("Reading", "Weekend")).toEqual({
      ok: true,
    });
    expect(await store.getFeedById(created.feed.id)).toMatchObject({
      categoryLabel: "Weekend",
    });

    expect(await store.deleteUserCategory("Weekend")).toEqual({ ok: true });
    expect(await store.getFeedById(created.feed.id)).toMatchObject({
      categoryLabel: "Uncategorized",
    });
    expect(await store.deleteUserFeed(created.feed.id)).toEqual({ ok: true });
  } finally {
    await store.close();
  }
}
export async function servesReaderSessionsAndStreams(
  open: OpenStore,
): Promise<void> {
  const store = await open();
  try {
    await store.reconcileCatalog(SAMPLE_CATALOG);
    const created = await store.createUserFeed({
      url: "https://user-feed.example.com/atom.xml",
      title: "My Feed",
      category: "Reading",
      hidden: false,
    });
    const hiddenFeed = await store.getFeedByUrl(
      "https://code.visualstudio.com/feed.xml",
    );
    if (!created.ok) {
      throw new Error("Expected user feed");
    }
    if (hiddenFeed === undefined) {
      throw new Error("Expected hidden feed");
    }

    await store.createReaderSession({
      tokenSha256: "hash-valid",
      username: "jerred",
      nowSeconds: 1000,
      ttlSeconds: 300,
    });
    expect(await store.validateReaderSession("hash-valid", 1200)).toEqual({
      username: "jerred",
    });
    expect(
      await store.validateReaderSession("hash-valid", 1300),
    ).toBeUndefined();

    await store.recordPollSuccess({
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
    await store.recordPollSuccess({
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

    const rlPage1 = await store.queryReaderStreamIds({
      stream: { kind: "reading-list" },
      excludeRead: false,
      limit: 2,
    });
    expect(rlPage1.ids).toHaveLength(2);
    expect(rlPage1.nextCursor).toBeDefined();
    const rlAll = await store.queryReaderStreamIds({
      stream: { kind: "reading-list" },
      excludeRead: false,
      limit: 100,
    });
    expect(rlAll.ids).toHaveLength(5);
    const engStream = await store.queryReaderStreamIds({
      stream: { kind: "category", label: "Engineering & Infra" },
      excludeRead: false,
      limit: 100,
    });
    expect(engStream.ids).toHaveLength(1);

    const userItems = await store.getEntriesByIds(rlAll.ids);
    const byTitle = new Map(userItems.map((i) => [i.title, i.id]));
    await store.editEntryTags({
      ids: [
        byTitle.get("Old Read 1") ?? 0,
        byTitle.get("Old Read 2") ?? 0,
        byTitle.get("Recent Read") ?? 0,
      ],
      markRead: true,
    });
    await store.editEntryTags({
      ids: [byTitle.get("Old Starred Read") ?? 0],
      markRead: true,
      markStarred: true,
    });

    const pruned = await store.pruneOldEntries({
      maxReadPerFeed: 2,
      minAgeSeconds: 100,
      nowSeconds: 10_000,
    });
    expect(pruned).toBe(1);
    const remainingTitles = await entryTitles(store, {
      view: "all",
      feedId: created.feed.id,
    });
    expect(remainingTitles).toContain("Old Read 2");
    expect(remainingTitles).toContain("Recent Read");
    expect(remainingTitles).toContain("Old Starred Read");
    expect(remainingTitles).toContain("Old Unread");
    expect(remainingTitles).not.toContain("Old Read 1");
  } finally {
    await store.close();
  }
}
export async function allocatesIdsNewestFirst(open: OpenStore): Promise<void> {
  const store = await open();
  try {
    const created = await store.createUserFeed({
      url: "https://archive.example.org/rss.xml",
      title: "Full Archive Blog",
      category: "AI",
      hidden: false,
    });
    if (!created.ok) {
      throw new Error("Expected archive feed");
    }

    // Standard newest-first RSS order allocates highest ID to newest entry
    await store.recordPollSuccess({
      feedId: created.feed.id,
      polledAtSeconds: 2_000_000_000,
      etag: null,
      lastModified: null,
      entries: [
        {
          guid: "newest",
          url: "https://archive.example.org/newest",
          title: "Newest Post",
          author: "A",
          contentHtml: "",
          publishedAt: 1_999_999_900,
          enclosures: [],
        },
        {
          guid: "older",
          url: "https://archive.example.org/older",
          title: "Older Post",
          author: "A",
          contentHtml: "",
          publishedAt: 1_999_900_000,
          enclosures: [],
        },
      ],
    });
    expect(
      await entryTitles(store, { view: "unread", feedId: created.feed.id }),
    ).toEqual(["Newest Post", "Older Post"]);

    // Subsequent poll on an already-initialized feed marks >30d historical archive items as read without marking them autoReadMatched
    await store.recordPollSuccess({
      feedId: created.feed.id,
      polledAtSeconds: 2_000_000_900,
      etag: null,
      lastModified: null,
      entries: [
        {
          guid: "brand-new",
          url: "https://archive.example.org/brand-new",
          title: "Brand New Post",
          author: "A",
          contentHtml: "",
          publishedAt: 2_000_000_800,
          enclosures: [],
        },
        {
          guid: "archive-2016",
          url: "https://archive.example.org/2016",
          title: "2016 Historical Archive Post",
          author: "A",
          contentHtml: "",
          publishedAt: 1_456_387_200,
          enclosures: [],
        },
      ],
    });

    expect(
      await entryTitles(store, { view: "unread", feedId: created.feed.id }),
    ).toEqual(["Brand New Post", "Newest Post", "Older Post"]);
    const archived = await findEntry(
      store,
      { view: "all", feedId: created.feed.id },
      "2016 Historical Archive Post",
    );
    expect(archived?.isRead).toBe(true);
    expect(archived?.autoReadMatched).toBe(false);
  } finally {
    await store.close();
  }
}
