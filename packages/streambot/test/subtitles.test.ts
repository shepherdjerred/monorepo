import { describe, expect, test } from "bun:test";
import {
  classifySubtitleCodec,
  effectiveSubtitleConfig,
  embeddedSubtitleModifier,
  listYtdlpSubtitleCandidates,
  parseFfprobeSubtitles,
  parseLangPref,
  parseSidecarName,
  pickEmbeddedSubtitle,
  pickWrittenSubtitleFile,
  rankSidecars,
  rankSubtitleCandidates,
  toEmbeddedCandidates,
  ytdlpSubtitleArgs,
  type FfprobeSubtitleStream,
  type SidecarCandidate,
  type SubtitleCandidate,
} from "@shepherdjerred/streambot/sources/subtitles.ts";
import { loadConfig } from "@shepherdjerred/streambot/config/index.ts";
import type { Config } from "@shepherdjerred/streambot/config/schema.ts";

const baseConfig = loadConfig({
  BOT_TOKEN: "bot-token",
  TOKEN: "user-token",
  GUILD_ID: "208425771172102144",
  COMMAND_CHANNEL_ID: "692223827475824650",
  VIDEO_CHANNEL_ID: "692223827475824650",
  VIDEOS_DIR: "/tmp/videos",
});

function configWith(subtitles: Partial<Config["subtitles"]>): Config {
  return {
    ...baseConfig,
    subtitles: { ...baseConfig.subtitles, ...subtitles },
  };
}

describe("classifySubtitleCodec", () => {
  test("text codecs", () => {
    for (const c of ["subrip", "srt", "ass", "ssa", "mov_text", "webvtt"]) {
      expect(classifySubtitleCodec(c)).toBe("text");
    }
  });
  test("image codecs (cannot be burned via subtitles filter)", () => {
    for (const c of ["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle"]) {
      expect(classifySubtitleCodec(c)).toBe("image");
    }
  });
  test("case-insensitive; unknown is other", () => {
    expect(classifySubtitleCodec("SubRip")).toBe("text");
    expect(classifySubtitleCodec("eia_608")).toBe("other");
  });
});

describe("parseSidecarName (real Plex/Bazarr names)", () => {
  const base = "Dune (2021) Remux-2160p Proper";
  test("language + forced modifier", () => {
    expect(parseSidecarName(`${base}.en.forced.srt`, base)).toEqual({
      lang: "en",
      modifier: "forced",
    });
  });
  test("language only", () => {
    expect(
      parseSidecarName(
        "House of the Dragon - S01E10 - The Black Queen Bluray-1080p.en.srt",
        "House of the Dragon - S01E10 - The Black Queen Bluray-1080p",
      ),
    ).toEqual({ lang: "en", modifier: null });
  });
  test("hearing-impaired modifier", () => {
    const b = "Veep - S04E08 - B+ill Bluray-1080p";
    expect(parseSidecarName(`${b}.en.hi.srt`, b)).toEqual({
      lang: "en",
      modifier: "hi",
    });
  });
  test("region-tagged language is one token", () => {
    expect(parseSidecarName(`${base}.zh-TW.srt`, base)).toEqual({
      lang: "zh-TW",
      modifier: null,
    });
    expect(parseSidecarName(`${base}.zh.hi.srt`, base)).toEqual({
      lang: "zh",
      modifier: "hi",
    });
  });
  test("ass/ssa/vtt extensions accepted", () => {
    expect(parseSidecarName(`${base}.en.ass`, base)?.lang).toBe("en");
    expect(parseSidecarName(`${base}.en.vtt`, base)?.lang).toBe("en");
  });
  test("first token is the language even when it collides with a modifier name (hi = Hindi)", () => {
    // `hi` is both ISO 639-1 Hindi and the hearing-impaired modifier; as the FIRST token it's the
    // language, not a modifier (regression: Greptile P1).
    expect(parseSidecarName(`${base}.hi.srt`, base)).toEqual({
      lang: "hi",
      modifier: null,
    });
    // As a trailing token it's the modifier on an explicit language.
    expect(parseSidecarName(`${base}.en.hi.srt`, base)).toEqual({
      lang: "en",
      modifier: "hi",
    });
    // Hindi + hearing-impaired: language first, modifier second.
    expect(parseSidecarName(`${base}.hi.hi.srt`, base)).toEqual({
      lang: "hi",
      modifier: "hi",
    });
  });
  test("rejects non-matching base, non-subtitle ext, and bitmap pairs", () => {
    expect(parseSidecarName(`Other Movie.en.srt`, base)).toBeNull();
    expect(parseSidecarName(`${base}.en.txt`, base)).toBeNull();
    expect(parseSidecarName(`${base}.en.sub`, base)).toBeNull(); // VobSub (image) excluded
    expect(parseSidecarName(`${base}.mkv`, base)).toBeNull();
  });
});

function mk(file: string): SidecarCandidate {
  const info = parseSidecarName(file, "M");
  if (info === null) throw new Error(`bad fixture: ${file}`);
  return { ...info, file };
}

describe("rankSidecars", () => {
  test("prefers preferred language, then full over forced", () => {
    const cands = [mk("M.zh.srt"), mk("M.en.forced.srt"), mk("M.en.srt")];
    expect(rankSidecars(cands, ["en", "eng"])?.file).toBe("M.en.srt");
  });
  test("full preferred over hi/sdh, hi over forced", () => {
    expect(
      rankSidecars([mk("M.en.hi.srt"), mk("M.en.srt")], ["en"])?.file,
    ).toBe("M.en.srt");
    expect(
      rankSidecars([mk("M.en.forced.srt"), mk("M.en.hi.srt")], ["en"])?.file,
    ).toBe("M.en.hi.srt");
  });
  test("explicit forced pin wins when present", () => {
    const cands = [mk("M.en.srt"), mk("M.en.forced.srt")];
    expect(rankSidecars(cands, ["en"], "forced")?.file).toBe("M.en.forced.srt");
  });
  test("falls back to first available when no language matches", () => {
    expect(rankSidecars([mk("M.zh.srt")], ["en"])?.file).toBe("M.zh.srt");
  });
  test("empty → null", () => {
    expect(rankSidecars([], ["en"])).toBeNull();
  });
});

describe("embeddedSubtitleModifier", () => {
  test("dispositions are authoritative (forced beats title)", () => {
    expect(embeddedSubtitleModifier({ disposition: { forced: 1 } })).toBe(
      "forced",
    );
    expect(
      embeddedSubtitleModifier({ disposition: { hearing_impaired: 1 } }),
    ).toBe("sdh");
  });
  test("title tags are a conservative fallback", () => {
    expect(embeddedSubtitleModifier({ tags: { title: "FORCED" } })).toBe(
      "forced",
    );
    expect(embeddedSubtitleModifier({ tags: { title: "English (SDH)" } })).toBe(
      "sdh",
    );
    expect(
      embeddedSubtitleModifier({ tags: { title: "Hearing Impaired" } }),
    ).toBe("sdh");
  });
  test("plain tracks (and bare CC titles) are full", () => {
    expect(embeddedSubtitleModifier({ tags: { language: "eng" } })).toBeNull();
    expect(embeddedSubtitleModifier({ tags: { title: "CC" } })).toBeNull();
  });
});

describe("rankSubtitleCandidates (cross-source)", () => {
  // The exact Endgame regression: a forced-only English sidecar next to a remux whose full
  // English subs are embedded (subrip default + subrip SDH + PGS variants). The forced sidecar
  // used to win on source priority and the user saw "no subtitles".
  const forcedSidecar: SubtitleCandidate = {
    kind: "sidecar",
    file: "M.en.forced.srt",
    lang: "en",
    modifier: "forced",
  };
  const endgameStreams: FfprobeSubtitleStream[] = [
    { codec_name: "subrip", tags: { language: "eng" } },
    {
      codec_name: "subrip",
      tags: { language: "eng", title: "SDH" },
      disposition: { hearing_impaired: 1 },
    },
    { codec_name: "hdmv_pgs_subtitle", tags: { language: "eng" } },
    {
      codec_name: "hdmv_pgs_subtitle",
      tags: { language: "fre", title: "FORCED" },
    },
  ];
  const endgame = [forcedSidecar, ...toEmbeddedCandidates(endgameStreams)];
  const LANGS = ["en", "eng", "en-US"];

  test("full embedded track beats a forced-only sidecar (PGS never competes)", () => {
    const ranked = rankSubtitleCandidates(endgame, LANGS);
    expect(ranked[0]).toEqual({
      kind: "embedded",
      subtitleIndex: 0,
      codec: "subrip",
      lang: "eng",
      modifier: null,
    });
    // SDH (quality 1) still beats the forced sidecar (quality 2).
    expect(ranked[1]?.kind).toBe("embedded");
    expect(ranked[2]).toBe(forcedSidecar);
    expect(ranked).toHaveLength(3); // both PGS tracks were excluded up front
  });

  test("pinned forced modifier flips the ranking (sublang:en.forced)", () => {
    expect(rankSubtitleCandidates(endgame, LANGS, "forced")[0]).toBe(
      forcedSidecar,
    );
  });

  test("sidecar wins over embedded only at equal language + modifier quality", () => {
    const fullSidecar: SubtitleCandidate = {
      kind: "sidecar",
      file: "M.en.srt",
      lang: "en",
      modifier: null,
    };
    const ranked = rankSubtitleCandidates(
      [...toEmbeddedCandidates(endgameStreams), fullSidecar],
      LANGS,
    );
    expect(ranked[0]).toBe(fullSidecar);
  });

  test("language preference dominates modifier quality across sources", () => {
    const italianFull: SubtitleCandidate = {
      kind: "embedded",
      subtitleIndex: 0,
      codec: "subrip",
      lang: "ita",
      modifier: null,
    };
    const englishSdh: SubtitleCandidate = {
      kind: "sidecar",
      file: "M.en.sdh.srt",
      lang: "en",
      modifier: "sdh",
    };
    expect(rankSubtitleCandidates([italianFull, englishSdh], LANGS)[0]).toBe(
      englishSdh,
    );
  });

  test("ytdlp candidates rank by language pref, manual before auto, then alphabetically", () => {
    const enManual: SubtitleCandidate = {
      kind: "ytdlp",
      lang: "en",
      name: "English",
      autoGenerated: false,
      modifier: null,
    };
    const enAuto: SubtitleCandidate = {
      kind: "ytdlp",
      lang: "en",
      name: "English",
      autoGenerated: true,
      modifier: null,
    };
    const deManual: SubtitleCandidate = {
      kind: "ytdlp",
      lang: "de",
      name: "German",
      autoGenerated: false,
      modifier: null,
    };
    const ranked = rankSubtitleCandidates([enAuto, deManual, enManual], LANGS);
    expect(ranked).toEqual([enManual, enAuto, deManual]);
  });
});

describe("listYtdlpSubtitleCandidates", () => {
  test("maps manual + auto dicts to one candidate per language, tagging autoGenerated", () => {
    const candidates = listYtdlpSubtitleCandidates(
      { en: [{ name: "English" }], de: [{ name: "German" }] },
      { en: [{ name: "English (auto-generated)" }] },
      true,
    );
    expect(candidates).toEqual([
      {
        kind: "ytdlp",
        lang: "en",
        name: "English",
        autoGenerated: false,
        modifier: null,
      },
      {
        kind: "ytdlp",
        lang: "de",
        name: "German",
        autoGenerated: false,
        modifier: null,
      },
      {
        kind: "ytdlp",
        lang: "en",
        name: "English (auto-generated)",
        autoGenerated: true,
        modifier: null,
      },
    ]);
  });

  test("ignores automatic_captions entirely when includeAuto is false", () => {
    const candidates = listYtdlpSubtitleCandidates(
      { en: [{ name: "English" }] },
      { es: [{ name: "Spanish (auto-generated)" }] },
      false,
    );
    expect(candidates).toEqual([
      {
        kind: "ytdlp",
        lang: "en",
        name: "English",
        autoGenerated: false,
        modifier: null,
      },
    ]);
  });

  test("falls back to null name when the format entry has none", () => {
    const candidates = listYtdlpSubtitleCandidates({ en: [{}] }, {}, true);
    expect(candidates).toEqual([
      {
        kind: "ytdlp",
        lang: "en",
        name: null,
        autoGenerated: false,
        modifier: null,
      },
    ]);
  });
});

describe("effectiveSubtitleConfig / parseLangPref", () => {
  test("defaults to config when no per-request pref", () => {
    expect(effectiveSubtitleConfig(undefined, baseConfig)).toEqual({
      enabled: true,
      languages: ["en", "eng", "en-US"],
      pinnedModifier: null,
    });
  });
  test("per-request enabled overrides global", () => {
    expect(
      effectiveSubtitleConfig({ enabled: false }, baseConfig).enabled,
    ).toBe(false);
    expect(
      effectiveSubtitleConfig({ enabled: true }, configWith({ enabled: false }))
        .enabled,
    ).toBe(true);
  });
  test("sublang overrides language list and can pin a modifier", () => {
    expect(effectiveSubtitleConfig({ language: "es" }, baseConfig)).toEqual({
      enabled: true,
      languages: ["es"],
      pinnedModifier: null,
    });
    expect(
      effectiveSubtitleConfig({ language: "en.forced" }, baseConfig),
    ).toEqual({ enabled: true, languages: ["en"], pinnedModifier: "forced" });
  });
  test("parseLangPref splits a trailing modifier", () => {
    expect(parseLangPref("en")).toEqual({ language: "en", modifier: null });
    expect(parseLangPref("en.forced")).toEqual({
      language: "en",
      modifier: "forced",
    });
    expect(parseLangPref("zh-TW")).toEqual({
      language: "zh-TW",
      modifier: null,
    });
  });
});

describe("ytdlpSubtitleArgs", () => {
  test("writes + converts subs; auto-captions only when enabled", () => {
    const withAuto = ytdlpSubtitleArgs(
      "URL",
      ["en", "eng"],
      { manual: true, auto: true },
      "/tmp/o.%(ext)s",
    );
    expect(withAuto).toContain("--write-subs");
    expect(withAuto).toContain("--write-auto-subs");
    expect(withAuto).toContain("--convert-subs");
    expect(withAuto[withAuto.indexOf("--sub-langs") + 1]).toBe("en,eng");
    expect(withAuto.at(-1)).toBe("URL");

    const noAuto = ytdlpSubtitleArgs(
      "URL",
      ["en"],
      { manual: true, auto: false },
      "/tmp/o.%(ext)s",
    );
    expect(noAuto).not.toContain("--write-auto-subs");
  });

  test("an exact auto-only pick requests ONLY auto-captions, never manual (regression: mixing both let a same-language manual track silently win)", () => {
    const autoOnly = ytdlpSubtitleArgs(
      "URL",
      ["en"],
      { manual: false, auto: true },
      "/tmp/o.%(ext)s",
    );
    expect(autoOnly).not.toContain("--write-subs");
    expect(autoOnly).toContain("--write-auto-subs");
  });

  test("an exact manual-only pick requests ONLY manual subs, never auto", () => {
    const manualOnly = ytdlpSubtitleArgs(
      "URL",
      ["en"],
      { manual: true, auto: false },
      "/tmp/o.%(ext)s",
    );
    expect(manualOnly).toContain("--write-subs");
    expect(manualOnly).not.toContain("--write-auto-subs");
  });
});

describe("pickWrittenSubtitleFile", () => {
  test("prefers preferred language then srt over vtt", () => {
    expect(
      pickWrittenSubtitleFile(
        ["x.es.srt", "x.en.vtt", "x.en.srt"],
        ["en", "es"],
      ),
    ).toBe("x.en.srt");
  });
  test("returns null when no subtitle files written", () => {
    expect(pickWrittenSubtitleFile(["x.en.json", "x.mp4"], ["en"])).toBeNull();
  });
});

describe("pickEmbeddedSubtitle (real Dune ffprobe shape)", () => {
  const dune: FfprobeSubtitleStream[] = [
    {
      codec_name: "hdmv_pgs_subtitle",
      tags: { language: "eng" },
      disposition: { forced: 0 },
    },
    {
      codec_name: "hdmv_pgs_subtitle",
      tags: { language: "ita" },
      disposition: { forced: 0 },
    },
    {
      codec_name: "subrip",
      tags: { language: "ita" },
      disposition: { forced: 1 },
    },
  ];
  test("skips PGS image subs and picks the only burnable text track", () => {
    // English exists only as PGS (un-burnable); the subrip (ita) is the lone text stream → index 2.
    expect(pickEmbeddedSubtitle(dune, ["en", "eng", "en-US"])).toEqual({
      subtitleIndex: 2,
      codec: "subrip",
    });
  });
  test("returns null when every embedded track is image-based", () => {
    expect(pickEmbeddedSubtitle(dune.slice(0, 2), ["en"])).toBeNull();
  });
  test("prefers the preferred-language text track", () => {
    const streams: FfprobeSubtitleStream[] = [
      { codec_name: "subrip", tags: { language: "ita" } },
      { codec_name: "subrip", tags: { language: "eng" } },
    ];
    expect(pickEmbeddedSubtitle(streams, ["en", "eng"])?.subtitleIndex).toBe(1);
  });
  test("full > SDH > forced among embedded tracks (incl. title-derived modifiers)", () => {
    const streams: FfprobeSubtitleStream[] = [
      {
        codec_name: "subrip",
        tags: { language: "eng" },
        disposition: { forced: 1 },
      },
      { codec_name: "subrip", tags: { language: "eng", title: "SDH" } },
      { codec_name: "subrip", tags: { language: "eng" } },
    ];
    expect(pickEmbeddedSubtitle(streams, ["eng"])?.subtitleIndex).toBe(2);
    expect(
      pickEmbeddedSubtitle(streams.slice(0, 2), ["eng"])?.subtitleIndex,
    ).toBe(1);
    expect(
      pickEmbeddedSubtitle(streams, ["eng"], "forced")?.subtitleIndex,
    ).toBe(0);
  });
});

describe("parseFfprobeSubtitles", () => {
  test("extracts subtitle streams from ffprobe json", () => {
    const json = JSON.stringify({
      streams: [
        {
          codec_name: "subrip",
          tags: { language: "eng" },
          disposition: { forced: 0 },
        },
      ],
    });
    expect(parseFfprobeSubtitles(json)).toEqual([
      {
        codec_name: "subrip",
        tags: { language: "eng" },
        disposition: { forced: 0 },
      },
    ]);
  });
  test("tolerates missing streams key", () => {
    expect(parseFfprobeSubtitles("{}")).toEqual([]);
  });
});
