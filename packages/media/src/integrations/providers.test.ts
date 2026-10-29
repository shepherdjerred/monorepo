import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  AvistazFamilyProvider,
  KnabenProvider,
  PirateBayProvider,
} from "./providers.ts";
import {
  parseMagnetDownloadSearch,
  resolveMagnetDownloadHash,
} from "./magnetdownload.ts";
import { torrentInfoHashes } from "./torrent.ts";
import { QbittorrentClient } from "./qbittorrent.ts";

const hash = "a".repeat(40);

describe("public tracker contracts", () => {
  it("uses Knaben v2 GET pagination and verifies magnet identity", async () => {
    const client = new KnabenProvider(async (url) => {
      expect(url.pathname).toBe("/v2/search");
      expect(url.searchParams.get("f")).toBe("100");
      return Response.json({
        hits: [
          {
            id: "fixture",
            title: "Big Buck Bunny",
            bytes: 123,
            hash: hash.toUpperCase(),
            seeders: 2,
            details: "https://knaben.org/fixture",
            magnetUrl: `magnet:?xt=urn:btih:${hash}`,
            link: null,
          },
        ],
      });
    });
    await expect(
      client.search({ query: "Big Buck Bunny", kind: "movie", page: 2 }),
    ).resolves.toMatchObject([{ infoHash: hash, sizeBytes: 123 }]);
  });

  it("reads native Knaben recent pages and counts non-downloadable rows when continuing", async () => {
    const calls: URL[] = [];
    const row = {
      id: "recent",
      title: "Synthetic Film.2020.Extended.Cut",
      bytes: 123,
      hash,
      seeders: 2,
      details: "https://knaben.org/fixture",
      magnetUrl: null,
      link: null,
    };
    const provider = new KnabenProvider((url) => {
      calls.push(url);
      expect(url.pathname).toBe("/v2/browse");
      expect(Object.fromEntries(url.searchParams)).toMatchObject({
        o: "date",
        d: "desc",
        s: "100",
      });
      expect(url.searchParams.has("q")).toBe(false);
      return Promise.resolve(
        Response.json({
          hits:
            url.searchParams.get("f") === "0"
              ? Array.from({ length: 100 }, (_, i) => ({
                  ...row,
                  id: String(i),
                  hash: null,
                }))
              : [row],
        }),
      );
    });
    expect(await provider.recent({ page: 1 })).toEqual({
      candidates: [],
      scanned: 100,
      nextPage: 2,
    });
    expect(await provider.recent({ page: 2 })).toMatchObject({
      candidates: [
        {
          providerId: "knaben",
          infoHash: hash,
          editionEvidence: [{ text: row.title }],
        },
      ],
      scanned: 1,
      nextPage: null,
    });
    expect(calls.map((url) => url.searchParams.get("f"))).toEqual(["0", "100"]);
  });

  it("rejects an oversized recent response instead of silently dropping the unseen tail", async () => {
    const provider = new KnabenProvider(() =>
      Promise.resolve(
        Response.json({
          hits: Array.from({ length: 101 }, (_, i) => ({
            id: String(i),
            title: "Synthetic",
            bytes: 123,
            hash: null,
            seeders: 0,
            details: "https://knaben.org/fixture",
            magnetUrl: null,
          })),
        }),
      ),
    );
    await expect(provider.recent({ page: 1 })).rejects.toThrow(
      "invalid-response",
    );
  });

  it("normalizes TPB's numeric strings and explicit empty sentinel", async () => {
    const provider = new PirateBayProvider(async () =>
      Response.json([
        {
          id: "42",
          name: "Fixture",
          info_hash: hash,
          size: "1024",
          seeders: "5",
        },
      ]),
    );
    await expect(
      provider.search({ query: "Fixture", kind: "movie" }),
    ).resolves.toMatchObject([{ sizeBytes: 1024, seeders: 5, infoHash: hash }]);
    const empty = new PirateBayProvider(async () =>
      Response.json([
        {
          id: "0",
          name: "No results returned",
          info_hash: "0",
          size: "0",
          seeders: "0",
        },
      ]),
    );
    await expect(
      empty.search({ query: "Fixture", kind: "movie" }),
    ).resolves.toEqual([]);
  });

  it("parses MagnetDownload rows and refuses challenge pages or ambiguous hashes", () => {
    const html =
      '<table><tr><td class="x-item"><a href="/info/42" title="Fixture &amp; Film">Title</a><div class="tail">Files: 1 size: 1.5 GiB Type: video</div></td></tr></table>';
    expect(parseMagnetDownloadSearch(html)).toEqual([
      { id: "42", title: "Fixture & Film", sizeBytes: 1_610_612_736 },
    ]);
    expect(() =>
      parseMagnetDownloadSearch("<html>Please verify you are human</html>"),
    ).toThrow("invalid-response");
    expect(
      resolveMagnetDownloadHash({ items: [{ hash, name: "Fixture" }] }),
    ).toBe(hash);
    expect(() =>
      resolveMagnetDownloadHash({
        items: [{ hash }, { hash: "b".repeat(40) }],
      }),
    ).toThrow("invalid-response");
  });
});

describe("private family protocol", () => {
  it.each(["privatehd", "avistaz", "animez"] as const)(
    "reads %s recent pages without requiring a title or narrowing to one media type",
    async (providerId) => {
      const pages: string[] = [];
      const row = {
        url: `https://${providerId}.to/torrent/42`,
        download: `https://${providerId}.to/download/42?token=synthetic`,
        file_name: "Synthetic.2020.Extended.Cut.mkv",
        release_title: "Synthetic alternate title",
        info_hash: hash,
        file_size: 1024,
        seed: 1,
      };
      const provider = new AvistazFamilyProvider(
        {
          providerId,
          username: "synthetic",
          password: "synthetic",
          pid: "synthetic",
        },
        (url, init) => {
          if (url.pathname.endsWith("/auth"))
            return Promise.resolve(Response.json({ token: "synthetic" }));
          expect(new Headers(init.headers).get("Authorization")).toBe(
            "Bearer synthetic",
          );
          expect(url.pathname).toBe("/api/v1/jackett/torrents");
          expect(url.searchParams.get("search")).toBe("");
          expect(url.searchParams.get("limit")).toBe("50");
          expect(url.searchParams.get("in")).toBe(
            providerId === "animez" ? null : "1",
          );
          expect(url.searchParams.get("type")).toBe(
            providerId === "animez" ? null : "0",
          );
          const page = url.searchParams.get("page");
          pages.push(page ?? "missing");
          return Promise.resolve(
            Response.json({
              data:
                page === "1"
                  ? Array.from({ length: 50 }, (_, i) => ({
                      ...row,
                      url: `https://${providerId}.to/torrent/${String(i)}`,
                    }))
                  : [row],
            }),
          );
        },
      );
      await provider.login();
      const first = await provider.recent({ page: 1 });
      expect(first).toMatchObject({ scanned: 50, nextPage: 2 });
      expect(first.candidates).toHaveLength(50);
      expect(await provider.recent({ page: 2 })).toMatchObject({
        scanned: 1,
        nextPage: null,
        candidates: [
          {
            providerId,
            infoHash: hash,
            editionEvidence: [
              { text: row.file_name },
              { text: row.release_title },
            ],
          },
        ],
      });
      expect(pages).toEqual(["1", "2"]);
    },
  );
  it.each(["privatehd", "avistaz", "animez"] as const)(
    "authenticates %s directly and bounds credential destinations",
    async (providerId) => {
      const provider = new AvistazFamilyProvider(
        {
          providerId,
          username: "fixture",
          password: "fixture",
          pid: "fixture",
        },
        async (url, init) => {
          expect(url.origin).toBe(`https://${providerId}.to`);
          if (url.pathname.endsWith("auth"))
            return Response.json({ token: "fixture-session" });
          expect(new Headers(init.headers).get("authorization")).toBe(
            "Bearer fixture-session",
          );
          expect(init.redirect).toBe("manual");
          return Response.json({
            data: [
              {
                url: `https://${providerId}.to/torrent/42`,
                download: `https://${providerId}.to/download/42?token=fixture`,
                file_name: "Fixture.S01E01.mkv",
                release_title: "Fixture Episode 1",
                info_hash: hash,
                file_size: 1024,
                seed: 1,
              },
            ],
          });
        },
      );
      await provider.login();
      const result = await provider.search({ query: "Fixture", kind: "anime" });
      expect(result[0]?.providerId).toBe(providerId);
      expect(result[0]).not.toHaveProperty("references");
      expect(result[0]?.editionEvidence).toEqual([
        {
          text: "Fixture.S01E01.mkv",
          provenance: { kind: "release-title", field: "file_name" },
        },
        {
          text: "Fixture Episode 1",
          provenance: { kind: "release-title", field: "release_title" },
        },
      ]);
      expect(result[0]?.title).toBe(
        providerId === "animez" ? "Fixture Episode 1" : "Fixture.S01E01.mkv",
      );
      await expect(
        provider.download({
          providerId,
          providerReleaseId: "42",
          title: "Fixture",
          sizeBytes: 1,
          seeders: 1,
          infoHash: hash,
          detailsUrl: "https://example.test",
          download: { kind: "torrent", value: "https://other.test/credential" },
        }),
      ).rejects.toThrow("invalid-response");
    },
  );
});

describe("private torrent submission", () => {
  const info =
    "d6:lengthi1e4:name7:fixture12:piece lengthi16384e6:pieces20:aaaaaaaaaaaaaaaaaaaae";
  const bytes = new TextEncoder().encode(`d4:info${info}e`);
  const expected = createHash("sha1").update(info).digest("hex");
  it("hashes original info bytes and rejects malformed or duplicate dictionaries", () => {
    expect(torrentInfoHashes(bytes).v1).toBe(expected);
    expect(() =>
      torrentInfoHashes(
        new TextEncoder().encode(`d4:info${info}4:info${info}e`),
      ),
    ).toThrow("invalid-response");
    expect(() =>
      torrentInfoHashes(new TextEncoder().encode("d4:info999999999999:x")),
    ).toThrow("invalid-response");
  });
  it("sends bounded torrent bytes as multipart after verifying identity", async () => {
    let submitted = false;
    const client = new QbittorrentClient(
      {
        baseUrl: "http://qbit.local",
        username: "fixture",
        password: "fixture",
        category: "media",
      },
      async (url, init) => {
        if (url.pathname.endsWith("auth/login"))
          return new Response("Ok.", {
            headers: { "set-cookie": "SID=fixture; path=/" },
          });
        if (url.pathname.endsWith("info")) return Response.json([]);
        expect(init.body).toBeInstanceOf(FormData);
        submitted = true;
        return Response.json({
          added_torrent_ids: [expected],
          success_count: 1,
          failure_count: 0,
          pending_count: 0,
        });
      },
    );
    await client.login();
    await expect(
      client.submitTorrent({
        operationId: "00000000-0000-4000-8000-000000000001",
        attemptId: "00000000-0000-4000-8000-000000000002",
        savePath: "/downloads/media/00000000-0000-4000-8000-000000000002",
        hash: expected,
        bytes,
      }),
    ).resolves.toBe("accepted");
    expect(submitted).toBe(true);
  });
});
