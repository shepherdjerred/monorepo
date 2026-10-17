import { describe, expect, it } from "vitest";
import { IntegrationError, type FetchTransport } from "./http.ts";
import { QbittorrentClient } from "./qbittorrent.ts";
import { PlexClient } from "./plex.ts";
import { TmdbClient } from "./tmdb.ts";

const hash = "a".repeat(40);
const torrent = {
  hash,
  name: "fixture",
  state: "stalledUP",
  category: "media",
  tags: "media-attempt1",
  progress: 1,
  ratio: 1,
  seeding_time: 86_400,
  size: 10,
  save_path: "/downloads",
  content_path: "/downloads/fixture.mkv",
};
const login = () =>
  new Response("Ok.", {
    headers: { "set-cookie": "SID=test-session; path=/; HttpOnly" },
  });

describe("qBittorrent protocol", () => {
  it("inventories other categories and requires category, exact tag, and normalized path ownership", async () => {
    const client = new QbittorrentClient(
      {
        baseUrl: "http://qbit.local",
        username: "fixture",
        password: "fixture",
        category: "media",
      },
      async (url) => {
        if (url.pathname.endsWith("auth/login")) return login();
        expect(url.searchParams.has("category")).toBe(false);
        return Response.json([
          torrent,
          { ...torrent, hash: "b".repeat(40), category: "legacy" },
        ]);
      },
    );
    await client.login();
    expect(await client.listAll()).toHaveLength(2);
    const ownership = { operationId: "attempt1", savePath: "/downloads/" };
    expect(() => client.validateOwnership(torrent, ownership)).not.toThrow();
    for (const changed of [
      { ...torrent, category: "legacy" },
      { ...torrent, tags: "media-attempt10" },
      { ...torrent, save_path: "/downloads/other" },
      { ...torrent, save_path: "downloads" },
    ])
      expect(() => client.validateOwnership(changed, ownership)).toThrow(
        "conflict",
      );
  });
  it("authenticates with a cookie and recognizes the previously submitted operation", async () => {
    const paths: string[] = [];
    const transport: FetchTransport = async (url, init) => {
      paths.push(url.pathname);
      expect(init.redirect).toBe("manual");
      if (url.pathname.endsWith("auth/login")) {
        expect(init.body).toBeInstanceOf(URLSearchParams);
        return login();
      }
      expect(new Headers(init.headers).get("cookie")).toBe("SID=test-session");
      return Response.json([torrent]);
    };
    const client = new QbittorrentClient(
      {
        baseUrl: "http://qbit.local:8080",
        username: "fixture",
        password: "fixture",
        category: "media",
      },
      transport,
    );
    await client.login();
    await expect(
      client.submit({
        operationId: "attempt1",
        hash,
        magnet: `magnet:?xt=urn:btih:${hash}`,
      }),
    ).resolves.toBe("already-present");
    expect(paths).toEqual(["/api/v2/auth/login", "/api/v2/torrents/info"]);
    await expect(
      client.submit({
        operationId: "attempt1",
        hash,
        magnet: `magnet:?xt=urn:btih:${hash}`,
        savePath: "/downloads/other",
      }),
    ).rejects.toMatchObject({ kind: "conflict" });
  });

  it("does not adopt or delete another application's torrent", async () => {
    const paths: string[] = [];
    const client = new QbittorrentClient(
      {
        baseUrl: "http://qbit.local",
        username: "fixture",
        password: "fixture",
        category: "media",
      },
      async (url) => {
        paths.push(url.pathname);
        return url.pathname.endsWith("auth/login")
          ? login()
          : Response.json([{ ...torrent, category: "radarr" }]);
      },
    );
    await client.login();
    await expect(
      client.remove({ operationId: "attempt1", hash, deleteFiles: true }),
    ).rejects.toMatchObject({ kind: "conflict" });
    expect(paths.some((path) => path.endsWith("delete"))).toBe(false);
  });

  it("records a lost submission response as unknown without retrying", async () => {
    let submissions = 0;
    const client = new QbittorrentClient(
      {
        baseUrl: "http://qbit.local",
        username: "fixture",
        password: "fixture",
        category: "media",
      },
      async (url, init) => {
        if (url.pathname.endsWith("auth/login")) return login();
        if (url.pathname.endsWith("torrents/info")) return Response.json([]);
        submissions += 1;
        const body = init.body;
        if (!(body instanceof URLSearchParams))
          throw new TypeError("Expected form body");
        expect(body.get("ratioLimit")).toBe("-1");
        expect(body.get("tags")).toBe("media-attempt1");
        expect(body.get("savepath")).toBe("/downloads/media/attempt1");
        throw new Error(
          "Network connection dropped after server accepted request with secret detail",
        );
      },
    );
    await client.login();
    await expect(
      client.submit({
        operationId: "attempt1",
        hash,
        magnet: `magnet:?xt=urn:btih:${hash}`,
        savePath: "/downloads/media/attempt1",
      }),
    ).rejects.toMatchObject({
      kind: "outcome-unknown",
      message: "qbittorrent: outcome-unknown",
    });
    expect(submissions).toBe(1);
  });

  it("rejects an unsuccessful 200 login and mismatched magnet identity", async () => {
    const client = new QbittorrentClient(
      {
        baseUrl: "http://qbit.local",
        username: "fixture",
        password: "fixture",
        category: "media",
      },
      async () => new Response("Fails."),
    );
    await expect(client.login()).rejects.toMatchObject({
      kind: "authentication",
    });
    await expect(
      client.submit({
        operationId: "attempt1",
        hash,
        magnet: `magnet:?xt=urn:btih:${"b".repeat(40)}`,
      }),
    ).rejects.toThrow("identity");
  });
});

describe("Plex observations", () => {
  it("reads current watch state with the particular user's token", async () => {
    const seen: string[] = [];
    const client = new PlexClient(
      {
        baseUrl: "http://plex.local:32400",
        token: "user-token",
        clientIdentifier: "media-fixture",
      },
      async (url, init) => {
        seen.push(url.pathname);
        expect(new Headers(init.headers).get("X-Plex-Token")).toBe(
          "user-token",
        );
        expect(url.search).not.toContain("token");
        return Response.json({
          MediaContainer: {
            size: 1,
            Metadata: [
              {
                ratingKey: "42",
                type: "movie",
                title: "Fixture",
                viewCount: 1,
              },
            ],
          },
        });
      },
    );
    await expect(client.watched("42")).resolves.toBe(true);
    expect(seen).toEqual(["/library/metadata/42"]);
  });

  it("rejects incomplete library pages instead of treating missing files as removed", async () => {
    const client = new PlexClient(
      {
        baseUrl: "http://plex.local",
        token: "fixture",
        clientIdentifier: "media-fixture",
      },
      async () => Response.json({ MediaContainer: { size: 0, totalSize: 12 } }),
    );
    await expect(
      client.libraryPage({ sectionId: "1", kind: "episode", offset: 0 }),
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("does not follow a credential-bearing redirect", async () => {
    const client = new PlexClient(
      {
        baseUrl: "http://plex.local",
        token: "fixture",
        clientIdentifier: "media-fixture",
      },
      async (_url, init) => {
        expect(init.redirect).toBe("manual");
        return new Response(null, {
          status: 302,
          headers: { location: "https://other.example" },
        });
      },
    );
    await expect(client.sections()).rejects.toBeInstanceOf(IntegrationError);
  });
});

describe("TMDB discovery", () => {
  it("keeps movie and series results while excluding people", async () => {
    const client = new TmdbClient(
      { kind: "bearer", token: "fixture-token" },
      async (url, init) => {
        expect(url.pathname).toBe("/3/search/multi");
        expect(url.searchParams.get("query")).toBe("Fixture");
        expect(new Headers(init.headers).get("authorization")).toBe(
          "Bearer fixture-token",
        );
        return Response.json({
          page: 1,
          total_pages: 1,
          results: [
            {
              id: 1,
              media_type: "movie",
              title: "Fixture",
              original_title: "Fixture",
              overview: "",
              release_date: "2020-01-01",
              poster_path: null,
              original_language: "en",
            },
            {
              id: 2,
              media_type: "tv",
              name: "Fixture",
              original_name: "Fixture",
              overview: "",
              first_air_date: "2021-01-01",
              poster_path: null,
              original_language: "en",
            },
            { id: 3, media_type: "person", name: "Fixture" },
          ],
        });
      },
    );
    const response = await client.search("Fixture");
    expect(response.results.map((item) => item.media_type)).toEqual([
      "movie",
      "tv",
    ]);
  });

  it("preserves throttling without leaking provider response bodies", async () => {
    const client = new TmdbClient(
      { kind: "bearer", token: "fixture-token" },
      async () =>
        new Response("sensitive provider body", {
          status: 429,
          headers: { "retry-after": "120" },
        }),
    );
    await expect(client.search("Fixture")).rejects.toMatchObject({
      kind: "rate-limited",
      retryAfterSeconds: 120,
      message: "tmdb: rate-limited",
    });
  });
  it("uses explicitly selected v3 API keys and sanitizes credential-bearing transport errors", async () => {
    const client = new TmdbClient(
      { kind: "api-key", apiKey: "fixture-secret" },
      async (url, init) => {
        expect(url.searchParams.get("api_key")).toBe("fixture-secret");
        expect(new Headers(init.headers).has("authorization")).toBe(false);
        throw new Error(url.toString());
      },
    );
    const promise = client.search("Fixture");
    await expect(promise).rejects.toMatchObject({
      message: "tmdb: unavailable",
    });
    await expect(promise).rejects.not.toHaveProperty("cause");
  });
});
