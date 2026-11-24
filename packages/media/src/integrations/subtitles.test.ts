import { describe, expect, it, vi } from "vitest";
import { OpenSubtitlesProvider, AssrtProvider } from "./subtitle-providers.ts";
import {
  chineseScriptEvidence,
  validateSubtitle,
} from "./subtitle-validation.ts";
import {
  parseSubhdSearch,
  PinchTabSubtitleBrowser,
  ZimukuProvider,
} from "./browser-subtitles.ts";

const subhdCard = (label: string) =>
  `<div class="bg-white"><a href="/a/abc42">Fixture</a><div class="view-text">Fixture.S01E01</div><div class="text-truncate"><span>简体</span><span>SRT</span></div>${label}</div>`;
const validateAss = (content: string, requireSimplified = true) =>
  validateSubtitle({
    bytes: new TextEncoder().encode(content),
    filename: "fixture.ass",
    requireSimplified,
    provenanceText: "",
  });

describe("subtitle content evidence", () => {
  it("rejects reversed, out-of-range, missing-body and unordered cues", () => {
    for (const content of [
      "1\n00:00:03,000 --> 00:00:01,000\nHello",
      "1\n00:60:01,000 --> 01:00:03,000\nHello",
      "1\n00:00:01,000 --> 00:00:03,000\n<i></i>",
      "1\n00:00:03,000 --> 00:00:04,000\nHello\n\n2\n00:00:01,000 --> 00:00:02,000\nWorld",
      "1\n00:00:01,000 --> 00:00:03,000\nHello\n2\n00:00:04,000 --> 00:00:05,000\nWorld",
    ])
      expect(() =>
        validateSubtitle({
          bytes: new TextEncoder().encode(content),
          filename: "fixture.srt",
          requireSimplified: false,
          provenanceText: "",
        }),
      ).toThrow();
  });
  it("counts only visible ASS dialogue and validates the declared Events structure", () => {
    const header =
      "[Script Info]\nTitle: 这是我们的国家，欢迎来到这里\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n";
    expect(() =>
      validateAss(
        `${header}Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{这是我们的国家，欢迎来到这里}Hello`,
      ),
    ).toThrow("Simplified");
    expect(
      validateAss(
        `${header}Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,这是我们的国家，欢迎来到这里`,
      ).simplifiedEvidence,
    ).toBeGreaterThanOrEqual(5);
    expect(() =>
      validateAss(
        `${header}Dialogue: 0,0:00:03.00,0:00:01.00,Default,,0,0,0,,Hello`,
        false,
      ),
    ).toThrow("ordered");
    expect(() =>
      validateAss("[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Hello", false),
    ).toThrow("malformed");
  });
  it("accepts BOM UTF16 and explicitly declared GB18030 without guessing legacy encodings", () => {
    const content =
      "1\n00:00:01,000 --> 00:00:03,000\n这是我们的国家，欢迎来到这里\n";
    const bytes = new Uint8Array(
      Buffer.concat([Buffer.from([255, 254]), Buffer.from(content, "utf16le")]),
    );
    expect(
      validateSubtitle({
        bytes,
        filename: "fixture.srt",
        requireSimplified: true,
        provenanceText: "",
      }).format,
    ).toBe("srt");
    expect(() =>
      validateSubtitle({
        bytes,
        filename: "fixture.srt",
        requireSimplified: true,
        provenanceText: "",
        declaredEncoding: "gb18030",
      }),
    ).toThrow("conflicts");
    const legacy = new Uint8Array([
      ...new TextEncoder().encode("1\n00:00:01,000 --> 00:00:03,000\n"),
      0xd6,
      0xd0,
      0xce,
      0xc4,
    ]);
    expect(
      validateSubtitle({
        bytes: legacy,
        filename: "fixture.srt",
        requireSimplified: false,
        provenanceText: "",
        declaredEncoding: "gb18030",
      }).text,
    ).toContain("中文");
    expect(() =>
      validateSubtitle({
        bytes: legacy,
        filename: "fixture.srt",
        requireSimplified: false,
        provenanceText: "",
      }),
    ).toThrow("encoding");
  });
  it("uses distinct characters from complete OpenCC tables and rejects Traditional text", () => {
    expect(
      chineseScriptEvidence("这是我们的国家，欢迎来到这里").simplifiedEvidence,
    ).toBeGreaterThanOrEqual(5);
    expect(
      chineseScriptEvidence("這是我們的國家，歡迎來到這裡").traditionalEvidence,
    ).toBeGreaterThan(0);
    expect(chineseScriptEvidence("这这这这这这").simplifiedEvidence).toBe(1);
    const bytes = new TextEncoder().encode(
      "1\n00:00:01,000 --> 00:00:03,000\n这是我们的国家，欢迎来到这里\n",
    );
    expect(
      validateSubtitle({
        bytes,
        filename: "fixture.srt",
        requireSimplified: true,
        provenanceText: "原创翻译",
      }).format,
    ).toBe("srt");
    expect(() =>
      validateSubtitle({
        bytes,
        filename: "fixture.srt",
        requireSimplified: true,
        provenanceText: "AI translation",
      }),
    ).toThrow("machine");
  });
  it("rejects HTML, untrusted encodings, and text without timed dialogue", () => {
    for (const content of [
      "<html>Sign in</html>",
      "这是我们的国家，欢迎来到这里",
    ]) {
      expect(() =>
        validateSubtitle({
          bytes: new TextEncoder().encode(content),
          filename: "fixture.srt",
          requireSimplified: true,
          provenanceText: "",
        }),
      ).toThrow();
    }
    expect(() =>
      validateSubtitle({
        bytes: new Uint8Array([255, 255]),
        filename: "fixture.srt",
        requireSimplified: false,
        provenanceText: "",
      }),
    ).toThrow("encoding");
  });
});

describe("subtitle provenance credits", () => {
  it("accepts ordinary English AI dialogue without treating it as subtitle provenance", () => {
    for (const dialogue of [
      "Did you use AI for your homework?",
      "We discussed AI translation in class.",
      "AI translation is an interesting research topic.",
      "Translation by artificial intelligence is not reliable.",
      "Subtitles generated by AI are controversial.",
      "Machine translated the message incorrectly.",
      "Subtitles: machine translation is still imperfect.",
      "<i>Translation by artificial intelligence is not reliable.</i>",
    ]) {
      const text = `1\n00:00:01,000 --> 00:00:03,000\n${dialogue}\n`;
      expect(
        validateSubtitle({
          bytes: new TextEncoder().encode(text),
          filename: "episode.en.srt",
          requireSimplified: false,
          provenanceText: "English",
        }).text,
      ).toBe(text);
    }
  });
  it("still rejects explicit machine translation credits and provenance metadata", () => {
    for (const credit of [
      "Subtitles generated by AI",
      "Translated using AI",
      "[Machine-translated subtitles]",
      "[[Machine-translated subtitles]])",
      "AI translation",
      "AI-generated captions",
      "Machine translated by Google Translate",
      "AI translation by ChatGPT",
      "Subtitles: machine-translated",
      "<i>Translation by artificial intelligence</i>",
      "Translation by artificial intelligence.",
      "Translation by AI (ChatGPT)",
      "Subtitles generated by artificial intelligence: Whisper",
      "Translated using AI - Whisper",
      "[Translated using AI [Whisper]]",
      "[Translated using AI!]",
      "Title: Translation by artificial intelligence",
      "机器翻译",
      "<i>机器翻译：测试</i>",
    ])
      expect(() =>
        validateSubtitle({
          bytes: new TextEncoder().encode(
            `1\n00:00:01,000 --> 00:00:03,000\n${credit}\n`,
          ),
          filename: "episode.en.srt",
          requireSimplified: false,
          provenanceText: "English",
        }),
      ).toThrow("machine");
    for (const provenanceText of [
      "AI",
      "AI translation",
      "machine translated",
      "English AI subtitles",
      "AI caption track",
    ])
      expect(() =>
        validateSubtitle({
          bytes: new TextEncoder().encode(
            "1\n00:00:01,000 --> 00:00:03,000\nOrdinary dialogue.\n",
          ),
          filename: "episode.en.srt",
          requireSimplified: false,
          provenanceText,
        }),
      ).toThrow("machine");
  });
});

describe("OpenSubtitles provider boundaries", () => {
  it("filters machine-labelled OpenSubtitles and downloads by exact file ID", async () => {
    const calls: string[] = [];
    const provider = new OpenSubtitlesProvider(
      { apiKey: "fixture", userAgent: "media-test v1" },
      async (url, init) => {
        calls.push(url.pathname);
        if (url.pathname.endsWith("subtitles")) {
          expect(url.search).toBe(
            "?ai_translated=exclude&languages=en&query=fixture",
          );
          return Response.json({
            total_pages: 1,
            data: [
              {
                id: "1",
                attributes: {
                  language: "en",
                  release: "Fixture",
                  machine_translated: true,
                  files: [{ file_id: 41, file_name: "fixture.srt" }],
                },
              },
              {
                id: "2",
                attributes: {
                  language: "en",
                  release: "Fixture",
                  files: [{ file_id: 42, file_name: "fixture.srt" }],
                },
              },
              {
                id: "3",
                attributes: {
                  language: "en",
                  release: "Fixture",
                  ai_translated: true,
                  files: [{ file_id: 43, file_name: "fixture.srt" }],
                },
              },
            ],
          });
        }
        if (url.pathname.endsWith("download")) {
          expect(init.body).toBe(JSON.stringify({ file_id: 42 }));
          return Response.json({
            link: "https://dl.opensubtitles.com/fixture",
            file_name: "fixture.srt",
          });
        }
        expect(new Headers(init.headers).has("Api-Key")).toBe(false);
        return new Response("subtitle bytes");
      },
    );
    const results = await provider.search({
      query: "  Fixture  ",
      language: "EN",
      hearingImpaired: "any",
      page: 1,
    });
    expect(results.candidates.map((candidate) => candidate.id)).toEqual(["2"]);
    const download = await provider.download(42);
    expect(download.filename).toBe("fixture.srt");
    expect(calls).toEqual([
      "/api/v1/subtitles",
      "/api/v1/download",
      "/fixture",
    ]);
  });

  it("follows one equivalent search redirect on the login-selected VIP host", async () => {
    const calls: string[] = [];
    const query =
      "?ai_translated=exclude&episode_number=2&foreign_parts_only=exclude&hearing_impaired=only&languages=en&page=2&parent_imdb_id=123&query=fixture+show&season_number=1";
    const location = `/api/v1/subtitles${query.replace("+", "%20")}`;
    const provider = new OpenSubtitlesProvider(
      { apiKey: "fixture", userAgent: "media-test v1" },
      async (url, init) => {
        calls.push(url.href);
        const headers = new Headers(init.headers);
        expect(headers.get("Api-Key")).toBe("fixture");
        expect(init.redirect).toBe("manual");
        if (url.pathname.endsWith("login")) {
          expect(init.method).toBe("POST");
          expect(headers.has("Authorization")).toBe(false);
          return Response.json({
            token: "fixture-token",
            base_url: "vip-api.opensubtitles.com",
          });
        }
        expect(headers.get("Authorization")).toBe("Bearer fixture-token");
        if (calls.length === 2) {
          expect(url.search).toBe(query);
          return new Response(null, { status: 301, headers: { location } });
        }
        return Response.json({ total_pages: 3, data: [] });
      },
    );

    await provider.login("fixture-user", "fixture-password");
    await expect(
      provider.search({
        query: "Fixture Show",
        language: "en",
        parentImdbId: "tt0000123",
        season: 1,
        episode: 2,
        forced: false,
        hearingImpaired: "required",
        page: 2,
      }),
    ).resolves.toEqual({ totalPages: 3, candidates: [] });
    expect(calls).toEqual([
      "https://api.opensubtitles.com/api/v1/login",
      `https://vip-api.opensubtitles.com/api/v1/subtitles${query}`,
      `https://vip-api.opensubtitles.com${location}`,
    ]);
  });

  it.each([
    "https://example.com/api/v1/subtitles?ai_translated=exclude&languages=en&query=fixture",
    "https://vip-api.opensubtitles.com/api/v1/subtitles?ai_translated=exclude&languages=en&query=fixture",
    "https://user@api.opensubtitles.com/api/v1/subtitles?ai_translated=exclude&languages=en&query=fixture",
    "/api/v1/download?ai_translated=exclude&languages=en&query=fixture",
    "/api/v1/subtitles?languages=en&query=fixture",
    "/api/v1/subtitles?ai_translated=exclude&languages=en&query=fixture&query=other",
  ])(
    "rejects an OpenSubtitles search redirect that changes its destination or scope (%s)",
    async (location) => {
      const transport = vi.fn(
        async () => new Response(null, { status: 301, headers: { location } }),
      );
      const provider = new OpenSubtitlesProvider(
        { apiKey: "fixture", userAgent: "media-test v1" },
        transport,
      );
      await expect(
        provider.search({ query: "fixture", language: "en" }),
      ).rejects.toMatchObject({ kind: "invalid-response", status: 301 });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );

  it("stops an OpenSubtitles search after one redirect", async () => {
    const transport = vi.fn(
      async () =>
        new Response(null, {
          status: 301,
          headers: {
            location: "?ai_translated=exclude&languages=en&query=fixture",
          },
        }),
    );
    const provider = new OpenSubtitlesProvider(
      { apiKey: "fixture", userAgent: "media-test v1" },
      transport,
    );
    await expect(
      provider.search({ query: "fixture", language: "en" }),
    ).rejects.toMatchObject({ kind: "unavailable", status: 301 });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("rejects an unrecognized OpenSubtitles login host before storing its token", async () => {
    const transport = vi.fn(async () =>
      Response.json({ token: "fixture-token", base_url: "example.com" }),
    );
    const provider = new OpenSubtitlesProvider(
      { apiKey: "fixture", userAgent: "media-test v1" },
      transport,
    );
    await expect(
      provider.login("fixture-user", "fixture-password"),
    ).rejects.toMatchObject({ kind: "invalid-response" });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("does not replay OpenSubtitles login or download POST requests on redirect", async () => {
    const transport = vi.fn(
      async (url: URL) =>
        new Response(null, { status: 301, headers: { location: url.href } }),
    );
    const provider = new OpenSubtitlesProvider(
      { apiKey: "fixture", userAgent: "media-test v1" },
      transport,
    );
    await expect(
      provider.login("fixture-user", "fixture-password"),
    ).rejects.toMatchObject({ kind: "unavailable", status: 301 });
    await expect(provider.download(42)).rejects.toMatchObject({
      kind: "outcome-unknown",
      status: 301,
    });
    expect(transport.mock.calls.map(([url]) => url.pathname)).toEqual([
      "/api/v1/login",
      "/api/v1/download",
    ]);
  });
});

describe("subtitle provider boundaries", () => {
  it("ASSRT accepts numeric and decimal-string file IDs and verifies detail identity", async () => {
    const calls: string[] = [];
    const provider = new AssrtProvider("fixture-token", async (url) => {
      calls.push(url.pathname);
      if (url.pathname === "/v1/sub/search") {
        expect(url.searchParams.get("is_file")).toBe("1");
        expect(url.searchParams.get("cnt")).toBe("15");
        return Response.json({
          status: 0,
          sub: { subs: [{ id: 41 }, { fileid: "42" }, { fileid: 43 }] },
        });
      }
      expect(url.pathname).toBe("/v1/sub/detail");
      expect(url.searchParams.get("id")).toBe("42");
      return Response.json({ status: 0, sub: { subs: [{ id: 43 }] } });
    });
    const results = await provider.search("Fixture");
    expect(results).toEqual([{ id: 41 }, { fileid: 42 }, { fileid: 43 }]);
    const raw = results[1];
    if (raw === undefined || !("fileid" in raw))
      throw new Error("Missing raw ASSRT search record");
    await expect(
      provider.downloadMember(raw.fileid, "Fixture.srt"),
    ).rejects.toMatchObject({ kind: "invalid-response" });
    expect(calls).toEqual(["/v1/sub/search", "/v1/sub/detail"]);
  });

  it("ASSRT rejects malformed and unsafe raw file IDs during search", async () => {
    for (const fileid of [
      true,
      0,
      -42,
      4.2,
      Number.MAX_SAFE_INTEGER + 1,
      "",
      " 42",
      "42\n",
      "+42",
      "4e2",
      "4.2",
      "0x2a",
      "9007199254740992",
    ]) {
      const provider = new AssrtProvider("fixture-token", async (url) => {
        expect(url.pathname).toBe("/v1/sub/search");
        return Response.json({ status: 0, sub: { subs: [{ fileid }] } });
      });
      await expect(provider.search("Fixture")).rejects.toMatchObject({
        kind: "invalid-response",
      });
    }
  });

  it("ASSRT keeps auth out of URLs and selects one exact pack member", async () => {
    const provider = new AssrtProvider("fixture-token", async (url, init) => {
      expect(url.search).not.toContain("token");
      if (url.hostname === "api.assrt.net") {
        expect(new Headers(init.headers).get("authorization")).toBe(
          "Bearer fixture-token",
        );
        return Response.json({
          status: 0,
          sub: {
            subs: [
              {
                id: 42,
                filelist: [
                  {
                    f: "Fixture.S01E01.srt",
                    url: "https://file0.assrt.net/first",
                  },
                  {
                    f: "Fixture.S01E02.srt",
                    url: "https://file0.assrt.net/second",
                  },
                ],
              },
            ],
          },
        });
      }
      expect(url.pathname).toBe("/second");
      expect(new Headers(init.headers).has("authorization")).toBe(false);
      return new Response("episode two");
    });
    expect(
      new TextDecoder().decode(
        await provider.downloadMember(42, "Fixture.S01E02.srt"),
      ),
    ).toBe("episode two");
    await expect(
      provider.downloadMember(42, "Fixture.S01E03.srt"),
    ).rejects.toThrow("conflict");
  });

  it("SubHD accepts provenance-labelled cards and detects challenges", () => {
    expect(parseSubhdSearch(subhdCard("原创翻译"))).toHaveLength(1);
    expect(parseSubhdSearch(subhdCard("AI翻译"))).toEqual([]);
    expect(() =>
      parseSubhdSearch(
        '<title>Just a moment</title><div id="challenge-running"></div>',
      ),
    ).toThrow("interaction-required");
  });

  it("SubHD browser verifies the current origin before calling page APIs", async () => {
    let calls = 0;
    const browser = new PinchTabSubtitleBrowser(
      {
        baseUrl: "http://pinchtab.local",
        token: "fixture",
        instanceId: "instance1",
      },
      async () => {
        calls += 1;
        return Response.json({
          result: {
            origin: "https://other.example",
            path: "/a/abc",
            ready: "complete",
            challenge: false,
          },
        });
      },
    );
    await expect(browser.prepareSubhd("tab1", "abc")).rejects.toThrow(
      "invalid-response",
    );
    expect(calls).toBe(1);
  });

  it("Zimuku stops at a browser challenge without solving it", async () => {
    const provider = new ZimukuProvider(
      async () => new Response("<html>yunsuo verification</html>"),
    );
    await expect(provider.search("Fixture")).rejects.toThrow(
      "interaction-required",
    );
  });
});

const quotaReply = (calls: string[], quota: number) => async (url: URL) => {
  calls.push(url.pathname);
  return Response.json({ status: 0, user: { quota } });
};

describe("ASSRT request pacing", () => {
  it("counts the quota request and spaces authenticated search and detail", async () => {
    const calls: string[] = [];
    let previousMetadataAt: number | undefined;
    const provider = new AssrtProvider("fixture-token", async (url, init) => {
      calls.push(url.pathname);
      const token = new Headers(init.headers).get("authorization");
      if (url.hostname !== "api.assrt.net") {
        expect(token).toBeNull();
        return new Response("caption");
      }
      expect(token).toBe("Bearer fixture-token");
      const now = performance.now();
      if (previousMetadataAt !== undefined)
        expect(now - previousMetadataAt).toBeGreaterThanOrEqual(1000);
      previousMetadataAt = now;
      if (url.pathname === "/v1/user/quota")
        return Response.json({ status: 0, user: { quota: 60 } });
      if (url.pathname === "/v1/sub/search")
        return Response.json({ status: 0, sub: { subs: [{ fileid: "42" }] } });
      expect(url.pathname).toBe("/v1/sub/detail");
      return Response.json({
        status: 0,
        sub: {
          subs: [
            {
              id: 42,
              filelist: [
                {
                  f: "fixture.srt",
                  url: "https://file0.assrt.net/fixture",
                },
              ],
            },
          ],
        },
      });
    });
    await expect(provider.paceLookup(105_000)).resolves.toBe(1);
    await expect(provider.search("Fixture")).resolves.toEqual([{ fileid: 42 }]);
    const download = await provider.downloadMember(42, "fixture.srt");
    expect(new TextDecoder().decode(download)).toBe("caption");
    expect(calls).toEqual([
      "/v1/user/quota",
      "/v1/sub/search",
      "/v1/sub/detail",
      "/fixture",
    ]);
  });

  it("defers early when the quota slot cannot fit and aborts a pending metadata wait", async () => {
    const calls: string[] = [];
    const lowBudget = new AssrtProvider("fixture-token", quotaReply(calls, 5));
    await expect(lowBudget.paceLookup(11_999)).resolves.toBe(12);
    await expect(lowBudget.search("Fixture")).rejects.toMatchObject({
      kind: "rate-limited",
      retryAfterSeconds: 12,
    });

    const controller = new AbortController();
    const cancelled = new AssrtProvider("fixture-token", quotaReply(calls, 1));
    await expect(
      cancelled.paceLookup(105_000, {
        observed: { wall: Date.now(), monotonic: performance.now() },
        signal: controller.signal,
      }),
    ).resolves.toBe(60);
    const search = cancelled.search("Fixture");
    controller.abort();
    await expect(search).rejects.toMatchObject({ kind: "unavailable" });
    expect(calls).toEqual(["/v1/user/quota", "/v1/user/quota"]);
  });

  it("clips ASSRT to the earlier authority deadline instead of the full invocation", async () => {
    const calls: string[] = [];
    const provider = new AssrtProvider("fixture-token", quotaReply(calls, 5));
    const wall = Date.now();
    await provider.paceLookup(105_000, {
      observed: { wall, monotonic: performance.now() },
      expiresAtMs: wall + 16_000,
      signal: new AbortController().signal,
    });
    await expect(provider.search("Fixture")).rejects.toMatchObject({
      kind: "rate-limited",
      retryAfterSeconds: 12,
    });
    expect(calls).toEqual(["/v1/user/quota"]);
  });

  it("charges previous provider time even when the wall clock moves backwards", async () => {
    const calls: string[] = [];
    const provider = new AssrtProvider("fixture-token", quotaReply(calls, 5));
    const wall = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(wall - 20_000);
    try {
      await provider.paceLookup(105_000, {
        observed: {
          wall: wall - 100_000,
          monotonic: performance.now() - 100_000,
        },
        expiresAtMs: wall + 120_000,
        signal: new AbortController().signal,
      });
      await expect(provider.search("Fixture")).rejects.toMatchObject({
        kind: "rate-limited",
      });
      expect(calls).toEqual(["/v1/user/quota"]);
    } finally {
      clock.mockRestore();
    }
  });

  it("leaves the download outcome unknown if authority aborts the second detail call", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const provider = new AssrtProvider("fixture-token", async (url) => {
      calls.push(url.pathname);
      if (url.pathname === "/v1/user/quota")
        return Response.json({ status: 0, user: { quota: 60 } });
      expect(url.pathname).toBe("/v1/sub/detail");
      if (calls.length === 3) {
        controller.abort();
        throw new DOMException("Fixture cancellation", "AbortError");
      }
      return Response.json({ status: 0, sub: { subs: [{ id: 42 }] } });
    });
    await provider.paceLookup(105_000, {
      observed: { wall: Date.now(), monotonic: performance.now() },
      signal: controller.signal,
    });
    await expect(provider.detail(42)).resolves.toMatchObject({ id: 42 });
    await expect(
      provider.downloadMember(42, "Fixture.srt"),
    ).rejects.toMatchObject({ kind: "outcome-unknown" });
    expect(calls).toEqual([
      "/v1/user/quota",
      "/v1/sub/detail",
      "/v1/sub/detail",
    ]);
  });

  it("only treats a status-less HTTP transport timeout as unknown after the download claim", async () => {
    const provider = new AssrtProvider("fixture-token", async () => {
      throw new DOMException("Fixture HTTP deadline", "TimeoutError");
    });
    await expect(provider.detail(42)).rejects.toMatchObject({
      kind: "unavailable",
    });
    await expect(
      provider.downloadMember(42, "Fixture.srt"),
    ).rejects.toMatchObject({ kind: "outcome-unknown" });

    const rejected = new AssrtProvider("fixture-token", async () =>
      Response.json({}, { status: 503 }),
    );
    await expect(
      rejected.downloadMember(42, "Fixture.srt"),
    ).rejects.toMatchObject({ kind: "unavailable", status: 503 });
  });

  it.each([
    { id: 43, kind: "invalid-response" },
    { id: 42, kind: "conflict" },
  ])(
    "preserves definitive $kind during concurrent cancellation",
    async ({ id, kind }) => {
      const controller = new AbortController();
      const calls: string[] = [];
      const provider = new AssrtProvider("fixture-token", async (url) => {
        calls.push(url.pathname);
        controller.abort();
        return Response.json({ status: 0, sub: { subs: [{ id }] } });
      });
      await expect(
        provider.downloadMember(42, "Fixture.srt", controller.signal),
      ).rejects.toMatchObject({ kind });
      expect(calls).toEqual(["/v1/sub/detail"]);
    },
  );
});
