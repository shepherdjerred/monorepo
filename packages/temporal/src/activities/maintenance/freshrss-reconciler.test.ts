import { describe, expect, test } from "vitest";
import {
  type DesiredFeed,
  type DesiredManifest,
  type FetchRequest,
  reconcileFreshRss,
} from "./freshrss-reconciler.ts";

type MockCategory = {
  id: string;
  label: string;
};

type MockSubscription = {
  id: string;
  title: string;
  url: string;
  categories: MockCategory[];
  filtersActionRead?: string;
};

const BUN_RELEASES_URL = "https://github.com/oven-sh/bun/releases.atom";
const TYPESCRIPT_BLOG_URL = "https://devblogs.microsoft.com/typescript/feed/";
const PRERELEASE_FILTER = String.raw`\b(alpha|beta|rc|canary|dev|nightly|preview|pre)\b`;

const desiredFeeds: DesiredFeed[] = [
  {
    title: "Bun Releases",
    url: BUN_RELEASES_URL,
    filtersActionRead: PRERELEASE_FILTER,
  },
  { title: "TypeScript Blog", url: TYPESCRIPT_BLOG_URL },
];

const desiredManifest: DesiredManifest = {
  category: "Repo Stack",
  feeds: desiredFeeds,
};

function category(label: string): MockCategory {
  return { id: `user/-/label/${label}`, label };
}

class MockFreshRssApi {
  subscriptions: MockSubscription[];
  readonly calls: string[] = [];
  authenticationStatus = 200;
  malformedList = false;
  editStatus = 200;
  convergeFilters = true;
  /** How FreshRSS serializes a filter it stores; the export returns this form. */
  storeFilter: (filter: string) => string = (filter) => filter;
  /** Feed URLs FreshRSS will refuse to subscribe, as it does for a URL whose
   *  content-type is not a feed type. */
  readonly refusedSubscribeUrls = new Set<string>();

  constructor(
    subscriptions: MockSubscription[],
    readonly desired: DesiredFeed[] = desiredFeeds,
  ) {
    this.subscriptions = structuredClone(subscriptions);
  }

  readonly fetch: FetchRequest = async (input, init) => {
    const url = new URL(
      input instanceof Request ? input.url : input.toString(),
    );
    this.calls.push(`${init?.method ?? "GET"} ${url.pathname}`);
    if (url.pathname.endsWith("/accounts/ClientLogin")) {
      return new Response(
        this.authenticationStatus === 200
          ? "SID=test\nAuth=test-auth\n"
          : "BadAuthentication",
        { status: this.authenticationStatus },
      );
    }
    if (url.pathname.endsWith("/token")) return new Response("test-token");
    if (url.pathname.endsWith("/subscription/list")) {
      return this.malformedList
        ? Response.json({ wrong: [] })
        : Response.json({ subscriptions: this.subscriptions });
    }
    if (url.pathname.endsWith("/subscription/export")) {
      return this.#export();
    }
    return url.pathname.endsWith("/subscription/edit")
      ? this.#edit(url, init)
      : new Response("Not Found", { status: 404 });
  };

  #export(): Response {
    if (this.convergeFilters) {
      for (const feed of this.desired) {
        const subscription = this.subscriptions.find(
          (candidate) => candidate.url === feed.url,
        );
        if (subscription !== undefined) {
          if (feed.filtersActionRead === undefined) {
            delete subscription.filtersActionRead;
          } else {
            subscription.filtersActionRead = this.storeFilter(
              feed.filtersActionRead,
            );
          }
        }
      }
    }
    const outlines = this.subscriptions
      .map((subscription) => {
        const filter =
          subscription.filtersActionRead === undefined
            ? ""
            : ` frss:filtersActionRead="${escapeXml(subscription.filtersActionRead)}"`;
        return `<outline text="${escapeXml(subscription.title)}" xmlUrl="${escapeXml(subscription.url)}"${filter}/>`;
      })
      .join("");
    return new Response(`<opml><body>${outlines}</body></opml>`);
  }

  #subscribe(id: string, body: URLSearchParams): Response {
    const feedUrl = id.replace(/^feed\//u, "");
    if (this.refusedSubscribeUrls.has(feedUrl))
      return new Response("Bad Request", { status: 400 });
    const title = body.get("t");
    const label = body.get("a")?.replace("user/-/label/", "");
    if (title === null || label === undefined)
      return new Response("Bad Request", { status: 400 });
    this.subscriptions.push({
      id,
      title,
      url: feedUrl,
      categories: [category(label)],
    });
    return new Response("OK");
  }

  async #edit(url: URL, init: RequestInit | undefined): Promise<Response> {
    if (this.editStatus !== 200)
      return new Response("Bad Request", { status: this.editStatus });
    const request = new Request(url.toString(), init);
    const body = new URLSearchParams(await request.text());
    const id = body.get("s");
    const action = body.get("ac");
    if (id === null || action === null)
      return new Response("Bad Request", { status: 400 });
    if (action === "subscribe") return this.#subscribe(id, body);
    const index = this.subscriptions.findIndex(
      (subscription) => subscription.id === id,
    );
    if (index === -1) return new Response("Bad Request", { status: 400 });
    if (action === "unsubscribe") {
      this.subscriptions.splice(index, 1);
    } else if (action === "edit") {
      const subscription = this.subscriptions[index];
      if (subscription === undefined)
        return new Response("Bad Request", { status: 400 });
      const title = body.get("t");
      const label = body.get("a")?.replace("user/-/label/", "");
      if (title === null || label === undefined)
        return new Response("Bad Request", { status: 400 });
      subscription.title = title;
      const removed = new Set(
        body
          .getAll("r")
          .map((categoryId) => categoryId.replace("user/-/label/", "")),
      );
      subscription.categories = subscription.categories.filter(
        (candidate) => !removed.has(candidate.label),
      );
      if (
        !subscription.categories.some((candidate) => candidate.label === label)
      ) {
        subscription.categories.push(category(label));
      }
    }
    return new Response("OK");
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function reconcile(
  api: MockFreshRssApi,
  manifest: DesiredManifest = desiredManifest,
) {
  return reconcileFreshRss({
    apiUrl: "http://freshrss-service/api/greader.php",
    user: "sjerred",
    password: "test-only-password",
    category: "Repo Stack",
    manifest,
    request: api.fetch,
    delay: () => Promise.resolve(),
  });
}

describe("FreshRSS reconciler", () => {
  test("subscribes missing feeds and reaches the exact desired state", async () => {
    const outside = {
      id: "feed/100",
      title: "Private feed",
      url: "https://example.com/private.xml",
      categories: [category("Uncategorized")],
    };
    const api = new MockFreshRssApi([outside]);

    expect(await reconcile(api)).toEqual({ desired: 2, edited: 2, pruned: 0 });
    expect(api.subscriptions).toContainEqual(outside);
    expect(
      api.subscriptions.filter(
        (subscription) => subscription.categories[0]?.label === "Repo Stack",
      ),
    ).toHaveLength(2);
  });

  test("reconciles the other feeds when FreshRSS refuses one", async () => {
    // FreshRSS rejects a URL it cannot read as a feed — a community mirror
    // served as text/plain, say. Aborting there left every later feed
    // unreconciled for as long as the bad URL stayed in the manifest, and the
    // failure only ever named the first refusal.
    const api = new MockFreshRssApi([]);
    api.refusedSubscribeUrls.add(BUN_RELEASES_URL);

    await expect(reconcile(api)).rejects.toThrow(
      new RegExp(
        `refused 1 of 2.*${BUN_RELEASES_URL.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`)}`,
        "su",
      ),
    );

    // The refused feed is absent, and the one FreshRSS accepted is fully
    // reconciled rather than collateral damage.
    const managed = api.subscriptions.filter(
      (subscription) => subscription.categories[0]?.label === "Repo Stack",
    );
    expect(managed.map((subscription) => subscription.url)).toEqual([
      TYPESCRIPT_BLOG_URL,
    ]);
    expect(managed[0]?.title).toBe("TypeScript Blog");
  });

  test("moves existing desired feeds and applies the desired title", async () => {
    const api = new MockFreshRssApi([
      {
        id: "feed/1",
        title: "Old Bun title",
        url: BUN_RELEASES_URL,
        categories: [category("Uncategorized")],
      },
    ]);

    await reconcile(api);

    expect(
      api.subscriptions.find((subscription) => subscription.id === "feed/1"),
    ).toEqual({
      id: "feed/1",
      title: "Bun Releases",
      url: BUN_RELEASES_URL,
      categories: [category("Repo Stack")],
      filtersActionRead: PRERELEASE_FILTER,
    });
  });

  test("prunes only stale subscriptions in Repo Stack", async () => {
    const outside = {
      id: "feed/90",
      title: "LWN",
      url: "https://example.com/lwn.xml",
      categories: [category("Uncategorized")],
    };
    const api = new MockFreshRssApi([
      outside,
      {
        id: "feed/91",
        title: "Stale managed feed",
        url: "https://example.com/stale.xml",
        categories: [category("Repo Stack")],
      },
    ]);

    expect(await reconcile(api)).toEqual({ desired: 2, edited: 2, pruned: 1 });
    expect(api.subscriptions).toContainEqual(outside);
    expect(
      api.subscriptions.some((subscription) => subscription.id === "feed/91"),
    ).toBe(false);
  });

  test("refuses to unsubscribe a stale feed shared with an unmanaged category", async () => {
    const shared = {
      id: "feed/92",
      title: "Shared feed",
      url: "https://example.com/shared.xml",
      categories: [category("Repo Stack"), category("Keep Me")],
    };
    const api = new MockFreshRssApi([shared]);

    await expect(reconcile(api)).rejects.toThrow(
      "also belong to unmanaged categories",
    );
    expect(api.subscriptions).toEqual([shared]);
  });

  test("is idempotent", async () => {
    const api = new MockFreshRssApi([]);

    await reconcile(api);
    const stateAfterFirstRun = structuredClone(api.subscriptions);
    expect(await reconcile(api)).toEqual({ desired: 2, edited: 2, pruned: 0 });
    expect(api.subscriptions).toEqual(stateAfterFirstRun);
  });

  test("fails on authentication errors", async () => {
    const api = new MockFreshRssApi([]);
    api.authenticationStatus = 403;

    await expect(reconcile(api)).rejects.toThrow(
      "authentication failed: HTTP 403",
    );
  });

  test("fails on malformed API responses", async () => {
    const api = new MockFreshRssApi([]);
    api.malformedList = true;

    await expect(reconcile(api)).rejects.toThrow("subscriptions array");
  });

  test("fails when subscription edits are rejected", async () => {
    const api = new MockFreshRssApi([]);
    api.editStatus = 400;

    await expect(reconcile(api)).rejects.toThrow("subscription/edit");
  });

  test("fails unless release filters converge exactly", async () => {
    const api = new MockFreshRssApi([]);
    api.convergeFilters = false;

    await expect(reconcile(api)).rejects.toThrow(
      `filters did not converge to the desired OPML settings: ${BUN_RELEASES_URL} wants ${JSON.stringify(PRERELEASE_FILTER)}, export has null`,
    );
  });

  test("names a declared filter FreshRSS stores in a different form", async () => {
    const vercelUrl = "https://vercel.com/atom";
    const bangFilter = String.raw`!intitle:/\bAI SDK\b/i`;
    const feeds: DesiredFeed[] = [
      { title: "Vercel News", url: vercelUrl, filtersActionRead: bangFilter },
      { title: "TypeScript Blog", url: TYPESCRIPT_BLOG_URL },
    ];
    const api = new MockFreshRssApi([], feeds);
    // FreshRSS parses `!` and `-` as the same negation but stores only `-`,
    // so the export can never equal a `!`-negated declaration.
    api.storeFilter = (filter) => filter.replace(/^!/u, "-");

    await expect(
      reconcile(api, { category: "Repo Stack", feeds }),
    ).rejects.toThrow(
      `${vercelUrl} wants ${JSON.stringify(bangFilter)}, export has ${JSON.stringify(bangFilter.replace(/^!/u, "-"))}`,
    );
  });

  test("rejects a runtime category that differs from the manifest", async () => {
    const api = new MockFreshRssApi([]);

    await expect(
      reconcileFreshRss({
        apiUrl: "http://freshrss-service/api/greader.php",
        user: "sjerred",
        password: "test-only-password",
        category: "Other",
        manifest: desiredManifest,
        request: api.fetch,
        delay: () => Promise.resolve(),
      }),
    ).rejects.toThrow("does not match");
  });
});
