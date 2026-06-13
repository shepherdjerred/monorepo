import { describe, expect, test } from "bun:test";
import {
  buildInfoArgs,
  parseExtractors,
  parseYtdlpInfo,
  toResolvedSource,
  ytdlpTarget,
} from "@shepherdjerred/streambot/sources/ytdlp.ts";

// Trimmed sample of real `yt-dlp --dump-single-json` output (extra fields elided; the schema
// strips anything it doesn't model).
const SAMPLE = JSON.stringify({
  id: "dQw4w9WgXcQ",
  title: "Rick Astley - Never Gonna Give You Up",
  url: "https://rr3---sn-xyz.googlevideo.com/videoplayback?expire=123",
  duration: 213,
  is_live: false,
  webpage_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxres.jpg",
  formats: [{ format_id: "18" }],
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
  test("requests a single muxed format with no download", () => {
    const args = buildInfoArgs({ kind: "url", url: "https://youtu.be/x" });
    expect(args).toContain("--dump-single-json");
    expect(args).toContain("--skip-download");
    expect(args.slice(-3)).toEqual(["-f", "best", "https://youtu.be/x"]);
  });
});

describe("parseYtdlpInfo / toResolvedSource", () => {
  test("parses the fields we trust and drops the rest", () => {
    const info = parseYtdlpInfo(SAMPLE);
    expect(info.title).toBe("Rick Astley - Never Gonna Give You Up");
    expect(info.duration).toBe(213);
    expect(info.is_live).toBe(false);
  });

  test("maps info to a resolved ffmpeg input", () => {
    const resolved = toResolvedSource(parseYtdlpInfo(SAMPLE));
    expect(resolved.title).toBe("Rick Astley - Never Gonna Give You Up");
    expect(resolved.ffmpegInput).toContain("googlevideo.com");
    expect(resolved.chapters).toEqual([]);
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
    const resolved = toResolvedSource(parseYtdlpInfo(withChapters));
    expect(resolved.chapters).toEqual([
      { index: 1, title: "Welcome", startSeconds: 0, endSeconds: 60 },
      { index: 2, title: "Chapter 2", startSeconds: 60, endSeconds: 600 },
    ]);
  });

  test("rejects output missing required fields", () => {
    expect(() => parseYtdlpInfo(JSON.stringify({ title: "no url" }))).toThrow();
  });

  test("rejects non-JSON output", () => {
    expect(() => parseYtdlpInfo("not json at all")).toThrow();
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
