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

  constructor(subscriptions: MockSubscription[]) {
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
      if (this.malformedList) return Response.json({ wrong: [] });
      return Response.json({ subscriptions: this.subscriptions });
    }
    if (url.pathname.endsWith("/subscription/export")) {
      return this.#export();
    }
    if (url.pathname.endsWith("/subscription/edit")) {
      return this.#edit(url, init);
    }
    return new Response("Not Found", { status: 404 });
  };

  #export(): Response {
    if (this.convergeFilters) {
      for (const feed of desiredFeeds) {
        const subscription = this.subscriptions.find(
          (candidate) => candidate.url === feed.url,
        );
        if (subscription !== undefined) {
          subscription.filtersActionRead = feed.filtersActionRead;
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

  async #edit(url: URL, init: RequestInit | undefined): Promise<Response> {
    if (this.editStatus !== 200)
      return new Response("Bad Request", { status: this.editStatus });
    const request = new Request(url.toString(), init);
    const body = new URLSearchParams(await request.text());
    const id = body.get("s");
    const action = body.get("ac");
    if (id === null || action === null)
      return new Response("Bad Request", { status: 400 });
    if (action === "subscribe") {
      const feedUrl = id.replace(/^feed\//, "");
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

async function reconcile(api: MockFreshRssApi) {
  return reconcileFreshRss({
    apiUrl: "http://freshrss-service/api/greader.php",
    user: "sjerred",
    password: "test-only-password",
    category: "Repo Stack",
    manifest: desiredManifest,
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

    expect(reconcile(api)).rejects.toThrow(
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

    expect(reconcile(api)).rejects.toThrow("authentication failed: HTTP 403");
  });

  test("fails on malformed API responses", async () => {
    const api = new MockFreshRssApi([]);
    api.malformedList = true;

    expect(reconcile(api)).rejects.toThrow("subscriptions array");
  });

  test("fails when subscription edits are rejected", async () => {
    const api = new MockFreshRssApi([]);
    api.editStatus = 400;

    expect(reconcile(api)).rejects.toThrow("subscription/edit");
  });

  test("fails unless release filters converge exactly", async () => {
    const api = new MockFreshRssApi([]);
    api.convergeFilters = false;

    expect(reconcile(api)).rejects.toThrow("filters did not converge");
  });

  test("rejects a runtime category that differs from the manifest", async () => {
    const api = new MockFreshRssApi([]);

    expect(
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
