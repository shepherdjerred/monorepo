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
