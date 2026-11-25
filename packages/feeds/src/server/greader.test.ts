import { describe, expect, test } from "vitest";
import { parseReaderItemId, toLongItemId } from "./greader-ids.ts";
import { createGoogleReaderRoutes } from "./greader.ts";
import type {
  FeedsPoller,
  FeedsRepository,
  ReaderStreamQuery,
  StoredCategory,
  StoredEntry,
  StoredFeed,
} from "./types.ts";

const ENTRY_ID_A = 1_796_046_480_182_156;
const ENTRY_ID_HIDDEN = ENTRY_ID_A + 31;
const ENTRY_ID_LWN = ENTRY_ID_A + 52;

function createSeedFeeds(initialNow: number): Map<number, StoredFeed> {
  return new Map<number, StoredFeed>([
    [
      1,
      {
        id: 1,
        url: "https://github.com/oven-sh/bun/releases.atom",
        title: "Bun Releases",
        categoryId: 1,
        categoryLabel: "Repo Stack",
        htmlUrl: "https://github.com/oven-sh/bun/releases",
        description: null,
        source: "code",
        hidden: false,
        autoRead: null,
        etag: null,
        lastModified: null,
        lastPolledAt: initialNow,
        lastSuccessAt: initialNow,
        lastStatus: 200,
        lastError: null,
        consecutiveFailures: 0,
        nextPollAfter: null,
      },
    ],
    [
      2,
      {
        id: 2,
        url: "https://github.com/vercel/ai/releases.atom",
        title: "Noisy Hidden Feed",
        categoryId: 1,
        categoryLabel: "Repo Stack",
        htmlUrl: "https://github.com/vercel/ai",
        description: null,
        source: "code",
        hidden: true,
        autoRead: null,
        etag: null,
        lastModified: null,
        lastPolledAt: initialNow,
        lastSuccessAt: initialNow,
        lastStatus: 200,
        lastError: null,
        consecutiveFailures: 0,
        nextPollAfter: null,
      },
    ],
    [
      3,
      {
        id: 3,
        url: "https://lwn.net/headlines/newrss?token=private_sub_token",
        title: "LWN Subscriber",
        categoryId: 3,
        categoryLabel: "Custom",
        htmlUrl: "https://lwn.net/",
        description: null,
        source: "user",
        hidden: false,
        autoRead: null,
        etag: null,
        lastModified: null,
        lastPolledAt: initialNow,
        lastSuccessAt: initialNow,
        lastStatus: 200,
        lastError: null,
        consecutiveFailures: 0,
        nextPollAfter: null,
      },
    ],
  ]);
}

function createSeedEntries(initialNow: number): Map<number, StoredEntry> {
  return new Map<number, StoredEntry>([
    [
      ENTRY_ID_A,
      {
        id: ENTRY_ID_A,
        feedId: 1,
        feedTitle: "Bun Releases",
        categoryLabel: "Repo Stack",
        feedHtmlUrl: "https://github.com/oven-sh/bun/releases",
        guid: "bun-1.3",
        url: "https://github.com/oven-sh/bun/releases/tag/bun-v1.3.0",
        title: "Bun v1.3.0",
        author: "Jarred",
        contentHtml: "<p>Fast</p>",
        publishedAt: initialNow - 100,
        crawledAtMs: initialNow * 1000,
        enclosures: [
          {
            href: "https://example.com/bun.zip",
            type: "application/zip",
            length: 512,
          },
        ],
        isRead: false,
        isStarred: false,
        autoReadMatched: false,
      },
    ],
    [
      ENTRY_ID_HIDDEN,
      {
        id: ENTRY_ID_HIDDEN,
        feedId: 2,
        feedTitle: "Noisy Hidden Feed",
        categoryLabel: "Repo Stack",
        feedHtmlUrl: "https://github.com/vercel/ai",
        guid: "hidden-1",
        url: "https://github.com/vercel/ai/releases/tag/v1",
        title: "Hidden Release",
        author: "Bot",
        contentHtml: "<p>Hidden</p>",
        publishedAt: initialNow - 50,
        crawledAtMs: initialNow * 1000,
        enclosures: [],
        isRead: false,
        isStarred: false,
        autoReadMatched: false,
      },
    ],
    [
      ENTRY_ID_LWN,
      {
        id: ENTRY_ID_LWN,
        feedId: 3,
        feedTitle: "LWN Subscriber",
        categoryLabel: "Custom",
        feedHtmlUrl: "https://lwn.net/",
        guid: "lwn-1",
        url: "https://lwn.net/Articles/1/",
        title: "Kernel Weekly",
        author: "corbet",
        contentHtml: "<p>Kernel</p>",
        publishedAt: initialNow - 10,
        crawledAtMs: initialNow * 1000,
        enclosures: [],
        isRead: false,
        isStarred: true,
        autoReadMatched: false,
      },
    ],
  ]);
}

function filterReaderEntries(
  entries: ReadonlyMap<number, StoredEntry>,
  feeds: ReadonlyMap<number, StoredFeed>,
  query: ReaderStreamQuery,
): StoredEntry[] {
  const sorted = [...entries.values()].sort((a, b) => b.id - a.id);
  return sorted.filter((entry) => {
    const feed = feeds.get(entry.feedId);
    if (query.excludeRead && entry.isRead) {
      return false;
    }
    if (
      query.minPublishedAt !== undefined &&
      entry.publishedAt < query.minPublishedAt
    ) {
      return false;
    }
    if (query.cursor !== undefined && entry.id >= query.cursor) {
      return false;
    }
    switch (query.stream.kind) {
      case "reading-list":
        return feed?.hidden !== true || entry.isStarred;
      case "starred":
        return entry.isStarred;
      case "feed":
        return entry.feedId === query.stream.feedId;
      case "category":
        return (
          entry.categoryLabel === query.stream.label && feed?.hidden !== true
        );
    }
  });
}

function createFakePoller(store: FeedsRepository): FeedsPoller {
  return {
    refreshAll: async () => ({
      skippedByFlag: false,
      polled: 0,
      notModified: 0,
      updated: 0,
      failed: 0,
      backedOff: 0,
      newEntries: 0,
      autoReadEntries: 0,
      durationMs: 1,
    }),
    refreshFeed: async () => ({ status: "not-modified", newEntries: 0 }),
    discoverAndSubscribe: async (input) => {
      if (input.url.includes("invalid.example")) {
        return { ok: false, kind: "invalid", message: "No feed found" };
      }
      const created = store.createUserFeed({
        url: `${input.url.replace(/\/$/u, "")}/feed.xml`,
        title: input.titleOverride ?? "Discovered Blog",
        category: input.category ?? "Uncategorized",
        hidden: false,
      });
      return created.ok
        ? { ok: true, feed: created.feed, newEntries: 3 }
        : created;
    },
  };
}

function createCategoryMutators(
  categories: Map<string, StoredCategory>,
  feeds: Map<number, StoredFeed>,
  bumpEtag: () => void,
): Pick<FeedsRepository, "renameUserCategory" | "deleteUserCategory"> {
  return {
    renameUserCategory: (oldLabel, newLabel) => {
      const cat = categories.get(oldLabel);
      if (cat === undefined) {
        return { ok: false, kind: "not-found", message: "Category not found" };
      }
      if (cat.managed) {
        return {
          ok: false,
          kind: "forbidden",
          message: "Managed category cannot be renamed",
        };
      }
      categories.delete(oldLabel);
      categories.set(newLabel, { ...cat, label: newLabel });
      for (const [id, f] of feeds) {
        if (f.categoryLabel === oldLabel) {
          feeds.set(id, { ...f, categoryLabel: newLabel });
        }
      }
      bumpEtag();
      return { ok: true };
    },
    deleteUserCategory: (label) => {
      const cat = categories.get(label);
      if (cat === undefined) {
        return { ok: false, kind: "not-found", message: "Category not found" };
      }
      if (cat.managed) {
        return {
          ok: false,
          kind: "forbidden",
          message: "Managed category cannot be deleted",
        };
      }
      categories.delete(label);
      bumpEtag();
      return { ok: true };
    },
  };
}

function createInMemoryReaderWorld(initialNow: number) {
  let currentNow = initialNow;
  let etagCounter = 1;
  let nextFeedId = 4;
  let nextCategoryId = 4;

  const sessions = new Map<string, { username: string; expiresAt: number }>();
  const categories = new Map<string, StoredCategory>([
    ["Repo Stack", { id: 1, label: "Repo Stack", managed: true, sortOrder: 1 }],
    ["Blogs", { id: 2, label: "Blogs", managed: true, sortOrder: 2 }],
    ["Custom", { id: 3, label: "Custom", managed: false, sortOrder: 3 }],
  ]);
  const feeds = createSeedFeeds(initialNow);
  const entries = createSeedEntries(initialNow);

  const ensureCategory = (label: string): number => {
    const existing = categories.get(label);
    if (existing !== undefined) {
      return existing.id;
    }
    const id = nextCategoryId;
    nextCategoryId += 1;
    categories.set(label, { id, label, managed: false, sortOrder: id });
    return id;
  };

  const store: FeedsRepository = {
    close: () => {
      /* noop */
    },
    reconcileCatalog: () => ({ upserted: 0, pruned: 0 }),
    pruneOldEntries: () => 0,
    listFeedsForPoll: () => [...feeds.values()],
    getFeedById: (id) => feeds.get(id),
    getFeedByUrl: (url) => [...feeds.values()].find((f) => f.url === url),
    recordPollNotModified: () => {
      /* noop */
    },
    recordPollSuccess: () => ({ inserted: 0, autoRead: 0 }),
    recordPollFailure: () => {
      /* noop */
    },
    summary: () => ({
      views: { unread: 0, all: 0, starred: 0, autoRead: 0 },
      categories: [],
      stats: {
        totalFeeds: feeds.size,
        codeFeeds: 2,
        userFeeds: 1,
        failingFeeds: 0,
        lastPolledAt: null,
      },
    }),
    listCategories: () => [],
    listFeedsHealth: () => ({ feeds: [], categories: [] }),
    queryEntries: () => ({ items: [], totalMatching: 0, nextCursor: null }),
    updateEntriesState: () => 0,
    markAllRead: () => 0,
    createUserFeed: (body) => {
      const catId = ensureCategory(body.category);
      const created: StoredFeed = {
        id: nextFeedId,
        url: body.url,
        title: body.title ?? body.url,
        categoryId: catId,
        categoryLabel: body.category,
        htmlUrl: body.htmlUrl ?? null,
        description: null,
        source: "user",
        hidden: body.hidden,
        autoRead: null,
        etag: null,
        lastModified: null,
        lastPolledAt: null,
        lastSuccessAt: null,
        lastStatus: null,
        lastError: null,
        consecutiveFailures: 0,
        nextPollAfter: null,
      };
      nextFeedId += 1;
      etagCounter += 1;
      feeds.set(created.id, created);
      return { ok: true, feed: created };
    },
    updateUserFeed: (id, body) => {
      const existing = feeds.get(id);
      if (existing === undefined) {
        return { ok: false, kind: "not-found", message: "Feed not found" };
      }
      if (existing.source === "code") {
        return {
          ok: false,
          kind: "forbidden",
          message: "Code-owned feed is immutable",
        };
      }
      const nextCat = body.category ?? existing.categoryLabel;
      const catId = ensureCategory(nextCat);
      const updated: StoredFeed = {
        ...existing,
        title: body.title ?? existing.title,
        categoryId: catId,
        categoryLabel: nextCat,
      };
      etagCounter += 1;
      feeds.set(id, updated);
      return { ok: true, feed: updated };
    },
    deleteUserFeed: (id) => {
      const existing = feeds.get(id);
      if (existing === undefined) {
        return { ok: false, kind: "not-found", message: "Feed not found" };
      }
      if (existing.source === "code") {
        return {
          ok: false,
          kind: "forbidden",
          message: "Code-owned feed cannot be deleted",
        };
      }
      feeds.delete(id);
      etagCounter += 1;
      return { ok: true };
    },
    createReaderSession: (input) => {
      sessions.set(input.tokenSha256, {
        username: input.username,
        expiresAt: input.nowSeconds + input.ttlSeconds,
      });
    },
    validateReaderSession: (tokenSha256, nowSec) => {
      const s = sessions.get(tokenSha256);
      return s !== undefined && s.expiresAt > nowSec
        ? { username: s.username }
        : undefined;
    },
    subscriptionsEtag: () => `rev${String(etagCounter)}`,
    listAllFeeds: () => [...feeds.values()],
    listAllCategories: () => [...categories.values()],
    queryReaderStreamIds: (query) => {
      const matched = filterReaderEntries(entries, feeds, query);
      const page = matched.slice(0, query.limit);
      const last = page.at(-1);
      return {
        ids: page.map((e) => e.id),
        ...(last !== undefined && matched.length > query.limit
          ? { nextCursor: last.id }
          : {}),
      };
    },
    getEntriesByIds: (ids) => {
      const idSet = new Set(ids);
      return [...entries.values()].filter((e) => idSet.has(e.id));
    },
    editEntryTags: (input) => {
      let changed = 0;
      for (const id of input.ids) {
        const existing = entries.get(id);
        if (existing !== undefined) {
          entries.set(id, {
            ...existing,
            isRead: input.markRead ?? existing.isRead,
            isStarred: input.markStarred ?? existing.isStarred,
          });
          changed += 1;
        }
      }
      return changed;
    },
    ...createCategoryMutators(categories, feeds, () => {
      etagCounter += 1;
    }),
  };

  const poller = createFakePoller(store);

  return {
    store,
    poller,
    feeds,
    entries,
    advanceTime: (deltaSeconds: number) => {
      currentNow += deltaSeconds;
    },
    nowSeconds: () => currentNow,
  };
}

async function loginAndFetchTokens(
  app: ReturnType<typeof createGoogleReaderRoutes>,
  email: string,
  passwd: string,
) {
  const loginRes = await app.request("/api/greader.php/accounts/ClientLogin", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ Email: email, Passwd: passwd }).toString(),
  });
  const loginText = await loginRes.text();
  const authToken = /^Auth=([0-9a-f]{64})$/mu.exec(loginText)?.[1] ?? "";
  const authHeader = { Authorization: `GoogleLogin auth=${authToken}` };
  const tokenRes = await app.request("/api/greader.php/reader/api/0/token", {
    headers: authHeader,
  });
  const writeToken = await tokenRes.text();
  return { authToken, authHeader, writeToken };
}

describe("greader-ids", () => {
  test("round-trips 64-bit Google Reader item IDs in both long hex and decimal formats", () => {
    const longHex = toLongItemId(ENTRY_ID_A);
    expect(longHex).toBe("tag:google.com,2005:reader/item/0006617ea8738b8c");
    expect(parseReaderItemId(longHex)).toBe(ENTRY_ID_A);
    expect(
      parseReaderItemId("tag:google.com,2005:reader/item/6617ea8738b8c"),
    ).toBe(ENTRY_ID_A);
    expect(parseReaderItemId(String(ENTRY_ID_A))).toBe(ENTRY_ID_A);

    const otherId = 1_795_569_203_477_068;
    expect(parseReaderItemId(toLongItemId(otherId))).toBe(otherId);
    expect(
      parseReaderItemId("tag:google.com,2005:reader/item/ffffffffffffffff"),
    ).toBeUndefined();
    expect(parseReaderItemId("0")).toBeUndefined();
    expect(parseReaderItemId("-42")).toBeUndefined();
    expect(parseReaderItemId("not-an-id")).toBeUndefined();
  });
});

describe("Google Reader auth, token retry, and ETag caching", () => {
  test("authenticates ClientLogin, enforces 30m HMAC T token expiry + retry, and caches tag/subscription lists with 304", async () => {
    const world = createInMemoryReaderWorld(1_760_000_000);
    const app = createGoogleReaderRoutes({
      store: world.store,
      poller: world.poller,
      readerUser: "jerred",
      readerPassword: "reader-password-123",
      writeTokenSecret: "hmac-write-token-secret",
      nowSeconds: world.nowSeconds,
    });

    const badLogin = await app.request(
      "/api/greader.php/accounts/ClientLogin",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          Email: "jerred",
          Passwd: "wrong",
        }).toString(),
      },
    );
    expect(badLogin.status).toBe(403);
    expect(await badLogin.text()).toBe("Error=BadAuthentication\n");

    const {
      authToken,
      authHeader,
      writeToken: writeToken1,
    } = await loginAndFetchTokens(app, "jerred", "reader-password-123");

    const unauthRes = await app.request(
      "/api/greader.php/reader/api/0/tag/list",
    );
    expect(unauthRes.status).toBe(401);

    const tagsRes = await app.request(
      "/api/greader.php/reader/api/0/tag/list?output=json",
      {
        headers: { Authorization: `googlelogin auth=${authToken}` },
      },
    );
    expect(tagsRes.status).toBe(200);
    const tagsEtag = tagsRes.headers.get("etag") ?? "";
    expect(tagsEtag).toBe('"tags-rev1"');
    const tagsJson = await tagsRes.json();
    expect(tagsJson.tags).toEqual([
      { id: "user/-/state/com.google/starred" },
      { id: "user/-/label/Repo Stack", type: "folder" },
      { id: "user/-/label/Blogs", type: "folder" },
      { id: "user/-/label/Custom", type: "folder" },
    ]);

    const tags304 = await app.request(
      "/api/greader.php/reader/api/0/tag/list",
      {
        headers: { ...authHeader, "If-None-Match": tagsEtag },
      },
    );
    expect(tags304.status).toBe(304);

    const subsRes = await app.request(
      "/api/greader.php/reader/api/0/subscription/list?output=json",
      { headers: authHeader },
    );
    expect(subsRes.status).toBe(200);
    const subsEtag = subsRes.headers.get("etag") ?? "";
    expect(subsEtag).toBe('"subs-rev1"');
    const subs304 = await app.request(
      "/api/greader.php/reader/api/0/subscription/list",
      {
        headers: { ...authHeader, "If-None-Match": subsEtag },
      },
    );
    expect(subs304.status).toBe(304);

    world.advanceTime(31 * 60);
    const expiredPost = await app.request(
      "/api/greader.php/reader/api/0/edit-tag",
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          T: writeToken1,
          i: String(ENTRY_ID_A),
          a: "user/-/state/com.google/read",
        }).toString(),
      },
    );
    expect(expiredPost.status).toBe(401);

    const tokenRes2 = await app.request("/api/greader.php/reader/api/0/token", {
      headers: authHeader,
    });
    const writeToken2 = await tokenRes2.text();
    const retryPost = await app.request(
      "/api/greader.php/reader/api/0/edit-tag",
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          T: writeToken2,
          i: toLongItemId(ENTRY_ID_A),
          a: "user/-/state/com.google/read",
        }).toString(),
      },
    );
    expect(retryPost.status).toBe(200);
    expect(await retryPost.text()).toBe("OK");
    expect(world.entries.get(ENTRY_ID_A)?.isRead).toBe(true);
  });
});

describe("Google Reader streams and contents", () => {
  test("serves stream/items/ids (hidden stream isolation + continuation) and stream/items/contents in requested order", async () => {
    const world = createInMemoryReaderWorld(1_760_000_000);
    const app = createGoogleReaderRoutes({
      store: world.store,
      poller: world.poller,
      readerUser: "jerred",
      readerPassword: "pw",
      writeTokenSecret: "secret",
      nowSeconds: world.nowSeconds,
    });

    const { authHeader, writeToken } = await loginAndFetchTokens(
      app,
      "jerred",
      "pw",
    );

    const readingListRes = await app.request(
      "/api/greader.php/reader/api/0/stream/items/ids?s=user/-/state/com.google/reading-list&xt=user/-/state/com.google/read&n=1",
      { headers: authHeader },
    );
    expect(readingListRes.status).toBe(200);
    expect(readingListRes.headers.get("date")).toBe(
      new Date(1_760_000_000 * 1000).toUTCString(),
    );
    const page1 = await readingListRes.json();
    expect(page1).toEqual({
      itemRefs: [{ id: String(ENTRY_ID_LWN) }],
      continuation: String(ENTRY_ID_LWN),
    });

    const page2Res = await app.request(
      `/api/greader.php/reader/api/0/stream/items/ids?s=user/-/state/com.google/reading-list&xt=user/-/state/com.google/read&c=${String(page1.continuation)}`,
      { headers: authHeader },
    );
    expect(await page2Res.json()).toEqual({
      itemRefs: [{ id: String(ENTRY_ID_A) }],
    });

    const hiddenDirectRes = await app.request(
      "/api/greader.php/reader/api/0/stream/items/ids?s=feed/2",
      { headers: authHeader },
    );
    expect(await hiddenDirectRes.json()).toEqual({
      itemRefs: [{ id: String(ENTRY_ID_HIDDEN) }],
    });

    const form = new URLSearchParams();
    form.set("T", writeToken);
    form.append("i", String(ENTRY_ID_A));
    form.append("i", toLongItemId(ENTRY_ID_LWN));
    const contentsRes = await app.request(
      "/api/greader.php/reader/api/0/stream/items/contents?output=json",
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      },
    );
    expect(contentsRes.status).toBe(200);
    const contents = await contentsRes.json();
    expect(contents.items.map((it: { id: string }) => it.id)).toEqual([
      toLongItemId(ENTRY_ID_A),
      toLongItemId(ENTRY_ID_LWN),
    ]);
    expect(contents.items[0].enclosure).toEqual([
      {
        href: "https://example.com/bun.zip",
        type: "application/zip",
        length: 512,
      },
    ]);
    expect(contents.items[1].categories).toContain(
      "user/-/state/com.google/starred",
    );
  });
});

describe("Google Reader subscriptions, categories, and OPML", () => {
  test("supports quickadd, user feed/category edits, OPML redaction, and 403 rejection on code-owned feeds/categories", async () => {
    const world = createInMemoryReaderWorld(1_760_000_000);
    const app = createGoogleReaderRoutes({
      store: world.store,
      poller: world.poller,
      readerUser: "jerred",
      readerPassword: "pw",
      writeTokenSecret: "secret",
      nowSeconds: world.nowSeconds,
    });

    const { authHeader, writeToken } = await loginAndFetchTokens(
      app,
      "jerred",
      "pw",
    );

    const quickRes = await app.request(
      "/api/greader.php/reader/api/0/subscription/quickadd",
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          T: writeToken,
          quickadd: "https://jvns.ca/",
        }).toString(),
      },
    );
    expect(quickRes.status).toBe(200);
    expect(await quickRes.json()).toEqual({
      numResults: 1,
      query: "https://jvns.ca/",
      streamId: "feed/4",
    });

    const quickFail = await app.request(
      "/api/greader.php/reader/api/0/subscription/quickadd",
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          T: writeToken,
          quickadd: "https://invalid.example/",
        }).toString(),
      },
    );
    expect(quickFail.status).toBe(200);
    expect(await quickFail.json()).toEqual({
      numResults: 0,
      error: "No feed found",
    });

    const forbiddenFeedDelete = await app.request(
      "/api/greader.php/reader/api/0/subscription/edit",
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          T: writeToken,
          ac: "unsubscribe",
          s: "feed/1",
        }).toString(),
      },
    );
    expect(forbiddenFeedDelete.status).toBe(403);

    const forbiddenCatRename = await app.request(
      "/api/greader.php/reader/api/0/rename-tag",
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          T: writeToken,
          s: "user/-/label/Repo Stack",
          dest: "user/-/label/Hacked",
        }).toString(),
      },
    );
    expect(forbiddenCatRename.status).toBe(403);

    const forbiddenCatDisable = await app.request(
      "/api/greader.php/reader/api/0/disable-tag",
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          T: writeToken,
          s: "user/-/label/Blogs",
        }).toString(),
      },
    );
    expect(forbiddenCatDisable.status).toBe(403);

    const userEdit = await app.request(
      "/api/greader.php/reader/api/0/subscription/edit",
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          T: writeToken,
          ac: "edit",
          s: "feed/4",
          t: "Julia Evans Blog",
          a: "user/-/label/Custom",
        }).toString(),
      },
    );
    expect(userEdit.status).toBe(200);
    expect(world.feeds.get(4)?.title).toBe("Julia Evans Blog");
    expect(world.feeds.get(4)?.categoryLabel).toBe("Custom");

    const renameOk = await app.request(
      "/api/greader.php/reader/api/0/rename-tag",
      {
        method: "POST",
        headers: {
          ...authHeader,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          T: writeToken,
          s: "user/-/label/Custom",
          dest: "user/-/label/Reading",
        }).toString(),
      },
    );
    expect(renameOk.status).toBe(200);

    const opmlExportRes = await app.request(
      "/api/greader.php/reader/api/0/subscription/export",
      { headers: authHeader },
    );
    expect(opmlExportRes.status).toBe(200);
    const opmlXml = await opmlExportRes.text();
    expect(opmlXml).toContain("https://github.com/oven-sh/bun/releases.atom");
    expect(opmlXml).toContain("https://jvns.ca/feed.xml");
    expect(opmlXml).not.toContain("private_sub_token");
    expect(opmlXml).not.toContain("lwn.net/headlines/newrss");

    const importXml = `<?xml version="1.0"?><opml version="2.0"><body>
      <outline text="Security" title="Security">
        <outline type="rss" title="Krebs" xmlUrl="https://krebsonsecurity.com/feed/" htmlUrl="https://krebsonsecurity.com/" />
      </outline>
    </body></opml>`;
    const importRes = await app.request(
      `/api/greader.php/reader/api/0/subscription/import?T=${encodeURIComponent(writeToken)}`,
      {
        method: "POST",
        headers: { ...authHeader, "Content-Type": "application/xml" },
        body: importXml,
      },
    );
    expect(importRes.status).toBe(200);
    const importedFeed = world.store.getFeedByUrl(
      "https://krebsonsecurity.com/feed/",
    );
    expect(importedFeed?.source).toBe("user");
    expect(importedFeed?.categoryLabel).toBe("Security");
  });
});
