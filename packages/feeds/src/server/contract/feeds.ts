import { expect } from "vitest";
import { DECLARED_FEEDS } from "@shepherdjerred/feeds/catalog/catalog.ts";
import { firstEntry, SAMPLE_CATALOG, type OpenStore } from "./support.ts";

export async function reconcilesCatalog(open: OpenStore): Promise<void> {
  const store = await open();
  try {
    const initialEtag = await store.subscriptionsEtag();
    const first = await store.reconcileCatalog(DECLARED_FEEDS);
    expect(first).toEqual({ upserted: 65, pruned: 0 });
    const afterFirstEtag = await store.subscriptionsEtag();
    expect(afterFirstEtag).not.toBe(initialEtag);

    const second = await store.reconcileCatalog(DECLARED_FEEDS);
    expect(second).toEqual({ upserted: 65, pruned: 0 });
    expect(await store.subscriptionsEtag()).toBe(afterFirstEtag);

    const createdUser = await store.createUserFeed({
      url: "https://lwn.net/headlines/newrss?token=subscriber-demo",
      title: "LWN Subscriber",
      category: "Security",
      hidden: false,
    });
    expect(createdUser.ok).toBe(true);

    const third = await store.reconcileCatalog(SAMPLE_CATALOG);
    expect(third).toEqual({ upserted: 4, pruned: 61 });

    const allFeeds = await store.listAllFeeds();
    expect(allFeeds).toHaveLength(5);
    expect(allFeeds.filter((f) => f.source === "user")).toHaveLength(1);
    expect(allFeeds.filter((f) => f.source === "code")).toHaveLength(4);

    const categories = await store.listAllCategories();
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
    await store.close();
  }
}
export async function appliesAutoReadOnInsert(open: OpenStore): Promise<void> {
  const store = await open();
  try {
    await store.reconcileCatalog([
      ...SAMPLE_CATALOG,
      {
        category: "Essays & Personal Blogs",
        title: "No HtmlUrl Blog",
        url: "https://example.org/rss.xml",
      },
    ]);
    const hono = await store.getFeedByUrl(
      "https://github.com/honojs/hono/releases.atom",
    );
    const vercel = await store.getFeedByUrl("https://vercel.com/atom");
    const discoverable = await store.getFeedByUrl(
      "https://example.org/rss.xml",
    );
    if (
      hono === undefined ||
      vercel === undefined ||
      discoverable === undefined
    ) {
      throw new Error("Expected sample feeds");
    }

    const honoPoll = await store.recordPollSuccess({
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

    const vercelPoll = await store.recordPollSuccess({
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

    const autoReadView = await store.queryEntries({ view: "auto-read" });
    expect(autoReadView.totalMatching).toBe(2);
    const betaItem = autoReadView.items.find((i) => i.title === "v4.0.0-rc.1");
    if (betaItem === undefined) {
      throw new Error("Expected beta item");
    }
    await store.updateEntriesState({
      ids: [betaItem.id],
      isRead: false,
      isStarred: true,
    });

    const repoll = await store.recordPollSuccess({
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

    const [reloaded] = await store.getEntriesByIds([betaItem.id]);
    expect(reloaded?.title).toBe("v4.0.0-rc.1 (updated notes)");
    expect(reloaded?.isRead).toBe(false);
    expect(reloaded?.isStarred).toBe(true);
    expect(reloaded?.enclosures).toEqual([
      { href: "https://example.com/asset.tar.gz", length: 42 },
    ]);

    await store.recordPollSuccess({
      feedId: discoverable.id,
      polledAtSeconds: 1_710_000_200,
      etag: null,
      lastModified: null,
      discoveredHtmlUrl: "https://example.org/",
      entries: [],
    });
    expect(await store.getFeedById(discoverable.id)).toMatchObject({
      htmlUrl: "https://example.org/",
    });
  } finally {
    await store.close();
  }
}
export async function autoReadsBackfilledCategories(
  open: OpenStore,
): Promise<void> {
  const store = await open();
  try {
    const createdCategoryRuleFeed = await store.createUserFeed({
      url: "https://vendor.example.org/rss.xml",
      title: "Vendor Blog",
      category: "Engineering & Infra",
      hidden: false,
      autoRead: { field: "category", pattern: "^Company$", flags: "i" },
    });
    if (!createdCategoryRuleFeed.ok) {
      throw new Error("Expected vendor feed");
    }
    expect(
      await store.recordPollSuccess({
        feedId: createdCategoryRuleFeed.feed.id,
        polledAtSeconds: 1_710_000_300,
        etag: '"e1"',
        lastModified: null,
        entries: [
          {
            guid: "vendor-1",
            url: "https://vendor.example.org/post-1",
            title: "Partnership announcement",
            author: "Vendor",
            contentHtml: "<p>Initial draft without category</p>",
            publishedAt: 1_710_000_300,
            enclosures: [],
            categories: [],
          },
        ],
      }),
    ).toEqual({ inserted: 1, autoRead: 0 });

    expect(
      await store.recordPollSuccess({
        feedId: createdCategoryRuleFeed.feed.id,
        polledAtSeconds: 1_710_000_400,
        etag: '"e2"',
        lastModified: null,
        entries: [
          {
            guid: "vendor-1",
            url: "https://vendor.example.org/post-1",
            title: "Partnership announcement",
            author: "Vendor",
            contentHtml: "<p>Tagged Company</p>",
            publishedAt: 1_710_000_300,
            enclosures: [],
            categories: ["Company"],
          },
        ],
      }),
    ).toEqual({ inserted: 0, autoRead: 1 });
    const vendorEntry = await firstEntry(store, {
      view: "all",
      feedId: createdCategoryRuleFeed.feed.id,
    });
    expect(vendorEntry?.isRead).toBe(true);
    expect(vendorEntry?.autoReadMatched).toBe(true);

    if (vendorEntry === undefined) {
      throw new Error("Expected vendor entry");
    }
    await store.updateEntriesState({ ids: [vendorEntry.id], isRead: false });
    expect(
      await store.recordPollSuccess({
        feedId: createdCategoryRuleFeed.feed.id,
        polledAtSeconds: 1_710_000_500,
        etag: '"e3"',
        lastModified: null,
        entries: [
          {
            guid: "vendor-1",
            url: "https://vendor.example.org/post-1",
            title: "Partnership announcement",
            author: "Vendor",
            contentHtml: "<p>Tagged Company</p>",
            publishedAt: 1_710_000_300,
            enclosures: [],
            categories: ["Company"],
          },
        ],
      }),
    ).toEqual({ inserted: 0, autoRead: 0 });
    expect(await store.getEntriesByIds([vendorEntry.id])).toMatchObject([
      { isRead: false },
    ]);
  } finally {
    await store.close();
  }
}
export async function schedulesPolls(open: OpenStore): Promise<void> {
  const store = await open();
  try {
    await store.reconcileCatalog(SAMPLE_CATALOG.slice(0, 2));
    const created = await store.createUserFeed({
      url: "https://private.example.com/rss?token=keep-secret",
      title: "Private Feed",
      category: "Private",
      hidden: false,
    });
    if (!created.ok) {
      throw new Error("Expected user feed creation");
    }

    const dueInitial = await store.listFeedsForPoll(1000);
    expect(dueInitial).toHaveLength(3);
    const firstFeed = dueInitial[0];
    if (firstFeed === undefined) {
      throw new Error("Expected first feed");
    }

    await store.recordPollFailure({
      feedId: firstFeed.id,
      polledAtSeconds: 1000,
      status: 503,
      errorMessage: "Upstream 503",
      nextPollAfterSeconds: 2000,
    });
    expect(await store.listFeedsForPoll(1500)).toHaveLength(2);
    expect(await store.listFeedsForPoll(2000)).toHaveLength(3);
    expect(await store.summary()).toMatchObject({ stats: { failingFeeds: 1 } });

    await store.recordPollNotModified({
      feedId: firstFeed.id,
      polledAtSeconds: 2000,
      etag: '"304-etag"',
    });
    const recovered = await store.getFeedById(firstFeed.id);
    expect(recovered?.consecutiveFailures).toBe(0);
    expect(recovered?.lastError).toBeNull();
    expect(recovered?.lastStatus).toBe(304);
    expect(recovered?.etag).toBe('"304-etag"');

    const health = await store.listFeedsHealth((url, source) =>
      source === "user" ? `${new URL(url).origin}?[REDACTED]` : url,
    );
    const userHealth = health.feeds.find((f) => f.source === "user");
    expect(userHealth?.displayUrl).toBe(
      "https://private.example.com?[REDACTED]",
    );
  } finally {
    await store.close();
  }
}
