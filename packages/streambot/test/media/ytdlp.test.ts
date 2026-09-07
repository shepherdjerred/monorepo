import { describe, expect, test } from "vitest";
import {
  buildExtractorListArgs,
  buildInfoArgs,
  buildPlaylistArgs,
  buildSearchArgs,
  buildSubtitleEnumerationArgs,
  parseExtractors,
  ytdlpTarget,
} from "@shepherdjerred/streambot/sources/ytdlp.ts";
import {
  classifyYtdlpInfo,
  isNoPlayableFormatIssue,
  parseYtdlpInfo,
  selectedHasVideoStream,
  toResolvedSource,
  toStreamInputs,
} from "@shepherdjerred/streambot/sources/ytdlp-info.ts";
import {
  buildFormatSelector,
  NoUsableFormatError,
} from "@shepherdjerred/streambot/sources/format-select.ts";
import { reconcileMediaKind } from "@shepherdjerred/streambot/sources/media-kind.ts";

const VIDEO_SELECTOR = buildFormatSelector({ kind: "video", maxHeight: 720 });
const MUSIC_SELECTOR = buildFormatSelector({ kind: "music", maxHeight: 720 });

/** The header set YouTube actually signs a format with, captured from a real 2026.08.19 payload. */
const HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "Accept-Language": "en-us,en;q=0.5",
  "Sec-Fetch-Mode": "navigate",
};

/**
 * A real `+` merge answer, captured from
 * `-f "bestvideo[vcodec^=avc1][height<=?720]+bestaudio/bestvideo[height<=?720]+bestaudio/best"`.
 * Note what is NOT here: a top-level `url`. yt-dlp has no single URL for a merge, which is why the
 * schema's `url` is optional and why `requested_formats` is modelled at all.
 */
const MERGE = JSON.stringify({
  id: "8aGhZQkoFbQ",
  title: "A JSConf Talk",
  duration: 1800,
  webpage_url: "https://www.youtube.com/watch?v=8aGhZQkoFbQ",
  thumbnail: "https://i.ytimg.com/vi/8aGhZQkoFbQ/maxres.jpg",
  categories: ["Science & Technology"],
  track: null,
  artist: null,
  extractor_key: "Youtube",
  requested_formats: [
    {
      format_id: "136",
      url: "https://rr3---sn-xyz.googlevideo.com/videoplayback?itag=136",
      vcodec: "avc1.4d401f",
      acodec: "none",
      height: 720,
      ext: "mp4",
      http_headers: HEADERS,
    },
    {
      format_id: "251-10",
      url: "https://rr3---sn-xyz.googlevideo.com/videoplayback?itag=251",
      vcodec: "none",
      acodec: "opus",
      height: null,
      ext: "webm",
      http_headers: HEADERS,
    },
  ],
});

/**
 * A real `-f "bestaudio/best"` answer for the SAME kind of URL: one top-level `url`, format 251,
 * webm/Opus. This is the regression case — `-f best` cannot resolve this video at all.
 */
const AUDIO_ONLY = JSON.stringify({
  id: "lYBUbBu4W08",
  title: "Rick Astley - Never Gonna Give You Up",
  duration: 213,
  webpage_url: "https://www.youtube.com/watch?v=lYBUbBu4W08",
  categories: ["Music"],
  track: "Never Gonna Give You Up",
  artist: "Rick Astley",
  album: "Whenever You Need Somebody",
  extractor_key: "Youtube",
  url: "https://rr3---sn-xyz.googlevideo.com/videoplayback?itag=251",
  vcodec: "none",
  acodec: "opus",
  http_headers: HEADERS,
});

/**
 * archive.org serving a plain `.mp3`. The point of this fixture is the codec field: `vcodec` is
 * NOT the string `"none"`. A predicate written `vcodec === "none"` reads this as "has video",
 * routes an mp3 to Go Live, and ffmpeg dies on `-map 0:v`.
 *
 * Both non-`"none"` shapes are covered because both occur in the wild for this same URL: an
 * explicit `null`, and the key being omitted entirely (what 2026.08.19 returned when I captured
 * it). `.nullish()` accepts both and they must reach the same "unknown" answer.
 */
function archiveMp3(vcodec: null | undefined): string {
  return JSON.stringify({
    title: "test mp3 test file",
    webpage_url: "https://archive.org/details/testmp3testfile",
    extractor_key: "InternetArchive",
    url: "https://archive.org/download/testmp3testfile/mpthreetest.mp3",
    ...(vcodec === undefined ? {} : { vcodec }),
    acodec: "mp3",
    ext: "mp3",
  });
}
const ARCHIVE_MP3 = archiveMp3(null);

/** The minimum yt-dlp can return: a bare direct file behind the generic extractor. */
const MINIMAL = JSON.stringify({
  title: "A Clip",
  url: "https://example.invalid/clip.mp4",
});

describe("ytdlpTarget", () => {
  test("passes URLs and file paths through and wraps searches", () => {
    expect(ytdlpTarget({ kind: "url", url: "https://youtu.be/x" })).toBe(
      "https://youtu.be/x",
    );
    expect(ytdlpTarget({ kind: "file", path: "/v/a.mkv", title: "a" })).toBe(
      "/v/a.mkv",
    );
    expect(ytdlpTarget({ kind: "search", query: "lofi beats" })).toBe(
      "ytsearch1:lofi beats",
    );
  });
});

describe("buildInfoArgs", () => {
  test("passes the caller's selector rather than a hardcoded one", () => {
    // `-f best` is the live bug this replaces: most YouTube videos publish no muxed format, so it
    // failed outright with "Requested format is not available". The selector is a parameter because
    // resolution runs this probe twice with different ones.
    const args = buildInfoArgs(
      { kind: "url", url: "https://youtu.be/x" },
      VIDEO_SELECTOR,
    );
    expect(args).toContain("--dump-json");
    expect(args).not.toContain("--dump-single-json");
    expect(args).toContain("--skip-download");
    expect(args).not.toContain("best");
    expect(args.slice(-3)).toEqual([
      "-f",
      VIDEO_SELECTOR,
      "https://youtu.be/x",
    ]);
  });

  test("carries the music selector unchanged too", () => {
    const args = buildInfoArgs(
      { kind: "url", url: "https://youtu.be/x" },
      MUSIC_SELECTOR,
    );
    expect(args.slice(-3)).toEqual([
      "-f",
      "bestaudio/best",
      "https://youtu.be/x",
    ]);
  });

  test("uses video-shaped JSON for searches instead of a playlist wrapper", () => {
    const args = buildInfoArgs(
      { kind: "search", query: "Beggin Plankton AI cover" },
      MUSIC_SELECTOR,
    );
    expect(args).toContain("--dump-json");
    expect(args.at(-1)).toBe("ytsearch1:Beggin Plankton AI cover");
  });

  test("ignores any yt-dlp.conf on the host", () => {
    // Not tidiness. A host config setting `-o "%(title)s [%(id)s].%(ext)s"` makes yt-dlp read the
    // template fragment as a second URL and the resolve dies with
    // `ERROR: [generic] '[%(id)s].%(ext)s' is not a valid URL`. Production is unaffected (the
    // container has no user config), so what this protects is local reproduction behaving like
    // production rather than like whoever's dotfiles are on the machine.
    expect(
      buildInfoArgs({ kind: "url", url: "https://youtu.be/x" }, VIDEO_SELECTOR),
    ).toContain("--ignore-config");
  });

  test("the flag comes before the target, where yt-dlp will honour it", () => {
    // A global option after the URL is still parsed, but ordering it first keeps the argument list
    // readable as "how to run yt-dlp" followed by "what to run it on".
    const args = buildInfoArgs(
      { kind: "url", url: "https://youtu.be/x" },
      VIDEO_SELECTOR,
    );
    expect(args.indexOf("--ignore-config")).toBeGreaterThanOrEqual(0);
    expect(args.indexOf("--ignore-config")).toBeLessThan(
      args.indexOf("https://youtu.be/x"),
    );
  });

  test("subtitle enumeration ignores the host config too", () => {
    // Every yt-dlp invocation in this module passes it. Covering one and not the others would
    // leave `/stream subtitles`, search, playlist expansion and `/stream sources` still breakable
    // by a dotfile — the same confusing half-working local state, just moved.
    expect(
      buildSubtitleEnumerationArgs({ kind: "url", url: "https://youtu.be/x" }),
    ).toContain("--ignore-config");
  });

  test("subtitle enumeration asks for no format at all", () => {
    // Nothing there reads a media URL, and a playlist wrapper carries the subtitle dicts fine.
    const args = buildSubtitleEnumerationArgs({
      kind: "url",
      url: "https://youtu.be/x",
    });
    expect(args).toContain("--dump-single-json");
    expect(args).not.toContain("-f");
  });
});

describe("every yt-dlp invocation is hermetic", () => {
  // The whole point of extracting these builders. Each of the three used to assemble its argument
  // array inline inside the async function that spawns the subprocess, where no test could see it —
  // `--ignore-config` could be dropped from any of them and nothing would fail. That is the same
  // zero-failure shape as the wiring gaps this change already closed, so it does not get to survive
  // in the last three call sites.
  const builders: readonly {
    readonly name: string;
    readonly args: readonly string[];
  }[] = [
    {
      name: "resolve probe",
      args: buildInfoArgs(
        { kind: "url", url: "https://youtu.be/x" },
        VIDEO_SELECTOR,
      ),
    },
    {
      name: "subtitle enumeration",
      args: buildSubtitleEnumerationArgs({
        kind: "url",
        url: "https://youtu.be/x",
      }),
    },
    { name: "search", args: buildSearchArgs("lofi beats", 5) },
    {
      name: "playlist expansion",
      args: buildPlaylistArgs("https://youtu.be/playlist?list=abc"),
    },
    { name: "extractor listing", args: buildExtractorListArgs() },
  ];

  for (const { name, args } of builders) {
    test(`${name} ignores the host yt-dlp.conf`, () => {
      expect(args).toContain("--ignore-config");
    });
  }

  test("covers every builder in the module, so a new one cannot quietly skip the flag", () => {
    expect(builders).toHaveLength(5);
  });
});

describe("buildSearchArgs", () => {
  test("asks for a flat listing capped at the requested limit", () => {
    const args = buildSearchArgs("lofi beats", 3);
    expect(args).toContain("--flat-playlist");
    expect(args).toContain("--dump-json");
    // `--playlist-end N` and `ytsearchN:` must agree, or yt-dlp fetches more than it returns.
    expect(args.slice(-3)).toEqual([
      "--playlist-end",
      "3",
      "ytsearch3:lofi beats",
    ]);
  });

  test("does not resolve media — a search must never fetch signed urls", () => {
    // `--flat-playlist` is what keeps this cheap and keeps expiring URLs out of the result.
    expect(buildSearchArgs("q", 5)).toContain("--flat-playlist");
    expect(buildSearchArgs("q", 5)).not.toContain("-f");
  });
});

describe("buildPlaylistArgs", () => {
  test("prints one url/title row per entry rather than full JSON", () => {
    const args = buildPlaylistArgs("https://youtu.be/playlist?list=abc");
    expect(args).toContain("--flat-playlist");
    expect(args.slice(-3)).toEqual([
      "--print",
      "%(url)s\t%(title)s",
      "https://youtu.be/playlist?list=abc",
    ]);
  });
});

describe("buildExtractorListArgs", () => {
  test("lists extractors and nothing else", () => {
    expect(buildExtractorListArgs()).toEqual([
      "--ignore-config",
      "--list-extractors",
    ]);
  });
});

describe("YtdlpInfoSchema", () => {
  test("parses a merge answer, including per-format headers", () => {
    const info = parseYtdlpInfo(MERGE);
    expect(info.url).toBeUndefined();
    expect(info.requested_formats).toHaveLength(2);
    expect(info.requested_formats?.[0]).toMatchObject({
      format_id: "136",
      vcodec: "avc1.4d401f",
      acodec: "none",
      height: 720,
    });
    expect(info.requested_formats?.[0]?.http_headers).toEqual(HEADERS);
    expect(info.categories).toEqual(["Science & Technology"]);
    expect(info.extractor_key).toBe("Youtube");
  });

  test("parses a single-format answer with a top-level url", () => {
    const info = parseYtdlpInfo(AUDIO_ONLY);
    expect(info.url).toContain("itag=251");
    expect(info.requested_formats).toBeUndefined();
    expect(info.vcodec).toBe("none");
    expect(info.acodec).toBe("opus");
    expect(info.track).toBe("Never Gonna Give You Up");
    expect(info.album).toBe("Whenever You Need Somebody");
  });

  test("tolerates every optional field being absent", () => {
    const info = parseYtdlpInfo(MINIMAL);
    expect(info.categories).toBeUndefined();
    expect(info.track).toBeUndefined();
    expect(info.artist).toBeUndefined();
    expect(info.album).toBeUndefined();
    expect(info.extractor_key).toBeUndefined();
    expect(info.requested_formats).toBeUndefined();
    expect(info.vcodec).toBeUndefined();
    expect(info.acodec).toBeUndefined();
    expect(info.http_headers).toBeUndefined();
  });

  test("tolerates the nulls yt-dlp emits for undetermined fields", () => {
    const info = parseYtdlpInfo(
      JSON.stringify({
        title: "Generic",
        url: "https://example.invalid/clip.mp4",
        vcodec: null,
        acodec: null,
        categories: null,
        track: null,
      }),
    );
    expect(info.vcodec).toBeNull();
    expect(info.categories).toBeNull();
  });

  test("rejects a payload with neither a url nor requested_formats", () => {
    // The refinement: nothing playable must fail at the boundary, not surface later as an ffmpeg
    // error against `undefined`.
    const empty = JSON.stringify({ title: "Nothing", duration: 10 });
    expect(() => parseYtdlpInfo(empty)).toThrow();
    try {
      parseYtdlpInfo(empty);
      expect.unreachable("expected the refinement to reject this payload");
    } catch (error) {
      expect(isNoPlayableFormatIssue(error)).toBe(true);
    }
  });

  test("an empty requested_formats array is also nothing playable", () => {
    expect(() =>
      parseYtdlpInfo(JSON.stringify({ title: "T", requested_formats: [] })),
    ).toThrow();
  });

  test("a genuine shape mismatch is NOT the no-playable-format issue", () => {
    // The two want different replies, so they must stay distinguishable.
    try {
      parseYtdlpInfo(JSON.stringify({ duration: 5 }));
      expect.unreachable("expected a missing-title failure");
    } catch (error) {
      expect(isNoPlayableFormatIssue(error)).toBe(false);
    }
  });

  test("rejects non-JSON output", () => {
    expect(() => parseYtdlpInfo("not json at all")).toThrow();
  });
});

describe("selectedHasVideoStream", () => {
  test("true when a merge selected a real video codec", () => {
    expect(selectedHasVideoStream(parseYtdlpInfo(MERGE))).toBe(true);
  });

  test("false when the single selected format says vcodec: none", () => {
    expect(selectedHasVideoStream(parseYtdlpInfo(AUDIO_ONLY))).toBe(false);
  });

  test("undefined when yt-dlp did not say — absence is not a denial", () => {
    // A bare `.mp4` behind the generic extractor omits both codecs. Guessing "no video" there
    // would send every direct video link down the music path.
    expect(selectedHasVideoStream(parseYtdlpInfo(MINIMAL))).toBeUndefined();
  });

  test("a null vcodec is UNKNOWN, not 'no video' — the archive.org mp3 case", () => {
    // The tri-state that matters: `"none"` is a denial, `null` is silence. Collapsing them would
    // make this return `false`, and the two answers route the item to opposite transports.
    const info = parseYtdlpInfo(ARCHIVE_MP3);
    expect(info.vcodec).toBeNull();
    expect(info.vcodec).not.toBe("none");
    expect(selectedHasVideoStream(info)).toBeUndefined();
  });

  test("an ABSENT vcodec is unknown too — the same URL returns both shapes", () => {
    const info = parseYtdlpInfo(archiveMp3(undefined));
    expect(info.vcodec).toBeUndefined();
    expect(selectedHasVideoStream(info)).toBeUndefined();
  });

  test("a merge whose entries all say vcodec: none IS a denial", () => {
    expect(
      selectedHasVideoStream({
        title: "T",
        requested_formats: [
          {
            format_id: "a",
            url: "https://x.invalid/a",
            vcodec: "none",
            acodec: "opus",
          },
        ],
      }),
    ).toBe(false);
  });

  test("a merge whose entries left vcodec unset stays unknown", () => {
    expect(
      selectedHasVideoStream({
        title: "T",
        requested_formats: [
          { format_id: "a", url: "https://x.invalid/a", acodec: "mp3" },
        ],
      }),
    ).toBeUndefined();
  });
});

describe("toStreamInputs", () => {
  test("maps a merge to two inputs, each with its own signed headers", () => {
    expect(toStreamInputs(parseYtdlpInfo(MERGE), "video")).toEqual({
      ffmpegInput:
        "https://rr3---sn-xyz.googlevideo.com/videoplayback?itag=136",
      ffmpegInputHeaders: HEADERS,
      audioInput: "https://rr3---sn-xyz.googlevideo.com/videoplayback?itag=251",
      audioInputHeaders: HEADERS,
      formatIds: ["136", "251-10"],
    });
  });

  test("maps a single selected format to one input and no second input", () => {
    const inputs = toStreamInputs(parseYtdlpInfo(AUDIO_ONLY), "music");
    expect(inputs.ffmpegInput).toContain("itag=251");
    expect(inputs.ffmpegInputHeaders).toEqual(HEADERS);
    expect(inputs.audioInput).toBeUndefined();
    expect(inputs.audioInputHeaders).toBeUndefined();
  });

  test("omits headers entirely when the extractor set none", () => {
    const inputs = toStreamInputs(parseYtdlpInfo(MINIMAL), "video");
    expect(inputs.ffmpegInput).toBe("https://example.invalid/clip.mp4");
    expect(inputs.ffmpegInputHeaders).toBeUndefined();
  });

  test("throws NoUsableFormatError on a payload carrying neither shape", () => {
    // Unreachable through parseYtdlpInfo, but YtdlpInfo is constructible directly — a broken
    // internal contract must fail loudly rather than reach ffmpeg as `undefined`.
    expect(() => toStreamInputs({ title: "T" }, "video")).toThrow(
      NoUsableFormatError,
    );
  });
});

describe("classifyYtdlpInfo", () => {
  test("a talk stays video on the audio-first pass despite the audio-only selection", () => {
    expect(
      classifyYtdlpInfo(parseYtdlpInfo(MERGE), undefined, "audio-first"),
    ).toEqual({
      kind: "video",
      decidedBy: "categories",
    });
  });

  test("a topic track is music from its own tags", () => {
    expect(
      classifyYtdlpInfo(parseYtdlpInfo(AUDIO_ONLY), undefined, "audio-first"),
    ).toEqual({ kind: "music", decidedBy: "categories" });
  });

  test("an explicit mode wins over the metadata", () => {
    expect(
      classifyYtdlpInfo(parseYtdlpInfo(AUDIO_ONLY), "video", "audio-first"),
    ).toEqual({ kind: "video", decidedBy: "mode" });
  });

  test("the archive.org mp3 is NOT saved by metadata — it needs the ffprobe reconciliation", () => {
    // Honest about where the guarantee lives. `vcodec: null` is unknown, so rule 1 cannot fire and
    // this mp3 classifies as `video` on the metadata alone. What actually catches it is
    // `resolveSource`'s ffprobe of the final input plus `reconcileMediaKind` — see media-kind.test.
    expect(
      classifyYtdlpInfo(parseYtdlpInfo(ARCHIVE_MP3), undefined, "video"),
    ).toEqual({
      kind: "video",
      decidedBy: "default",
    });
    expect(reconcileMediaKind("video", false, undefined)).toEqual({
      outcome: "demote",
      decision: { kind: "music", decidedBy: "no-video-stream" },
    });
  });

  test("on the video pass, an audio-only selection keeps an explicit mode: video for the reconciler", () => {
    // The `/best` tail of the video selector landed on an audio format, which on this pass is a
    // real fact about the item rather than an artifact of what we asked for.
    expect(
      classifyYtdlpInfo(parseYtdlpInfo(AUDIO_ONLY), "video", "video"),
    ).toEqual({ kind: "video", decidedBy: "mode" });
  });

  test("a non-YouTube direct file defaults to video", () => {
    expect(
      classifyYtdlpInfo(parseYtdlpInfo(MINIMAL), undefined, "video"),
    ).toEqual({
      kind: "video",
      decidedBy: "default",
    });
  });
});

describe("toResolvedSource", () => {
  test("carries the split inputs, their headers, and the kind for a video item", () => {
    const resolved = toResolvedSource(parseYtdlpInfo(MERGE), {
      mediaKind: "video",
    });
    expect(resolved.title).toBe("A JSConf Talk");
    expect(resolved.mediaKind).toBe("video");
    expect(resolved.ffmpegInput).toContain("itag=136");
    expect(resolved.audioInput).toContain("itag=251");
    expect(resolved.ffmpegInputHeaders).toEqual(HEADERS);
    expect(resolved.audioInputHeaders).toEqual(HEADERS);
    expect(resolved.durationSeconds).toBe(1800);
    expect(resolved.provenance?.provider).toBe("youtube");
  });

  test("a music item gets one input and no second input", () => {
    const resolved = toResolvedSource(parseYtdlpInfo(AUDIO_ONLY), {
      mediaKind: "music",
    });
    expect(resolved.mediaKind).toBe("music");
    expect(resolved.ffmpegInput).toContain("itag=251");
    expect(resolved.audioInput).toBeUndefined();
    expect(resolved.audioInputHeaders).toBeUndefined();
  });

  test("a non-YouTube direct file resolves to its single url", () => {
    const resolved = toResolvedSource(parseYtdlpInfo(MINIMAL), {
      mediaKind: "video",
    });
    expect(resolved.ffmpegInput).toBe("https://example.invalid/clip.mp4");
    expect(resolved.provenance?.provider).toBe("url");
  });

  test("maps yt-dlp chapters to 1-based chapters", () => {
    const withChapters = JSON.stringify({
      title: "A Talk",
      url: "https://example.com/v.mp4",
      chapters: [
        { start_time: 0, end_time: 60, title: "Welcome" },
        { start_time: 60, end_time: 600 },
      ],
    });
    const resolved = toResolvedSource(parseYtdlpInfo(withChapters), {
      mediaKind: "video",
    });
    expect(resolved.chapters).toEqual([
      { index: 1, title: "Welcome", startSeconds: 0, endSeconds: 60 },
      { index: 2, title: "Chapter 2", startSeconds: 60, endSeconds: 600 },
    ]);
  });
});

describe("parseExtractors", () => {
  test("keeps names, trims, and drops blanks + broken extractors", () => {
    const stdout = [
      "youtube",
      "twitch:vod",
      "  vimeo  ",
      "",
      "20min (CURRENTLY BROKEN)",
      "Bilibili category extractor",
    ].join("\n");
    expect(parseExtractors(stdout)).toEqual([
      "youtube",
      "twitch:vod",
      "vimeo",
      "Bilibili category extractor",
    ]);
  });
});
