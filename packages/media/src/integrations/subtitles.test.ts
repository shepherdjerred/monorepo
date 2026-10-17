import { describe, expect, it } from "vitest";
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

describe("subtitle provider boundaries", () => {
  it("filters machine-labelled OpenSubtitles and downloads by exact file ID", async () => {
    const calls: string[] = [];
    const provider = new OpenSubtitlesProvider(
      { apiKey: "fixture", userAgent: "media-test v1" },
      async (url, init) => {
        calls.push(url.pathname);
        if (url.pathname.endsWith("subtitles"))
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
            ],
          });
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
    const results = await provider.search({ query: "Fixture", language: "en" });
    expect(results.candidates.map((candidate) => candidate.id)).toEqual(["2"]);
    const download = await provider.download(42);
    expect(download.filename).toBe("fixture.srt");
    expect(calls).toEqual([
      "/api/v1/subtitles",
      "/api/v1/download",
      "/fixture",
    ]);
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
