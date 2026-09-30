import { describe, expect, test } from "vitest";
import {
  buildFormatSelector,
  httpHeaderInputOptions,
  NoUsableFormatError,
  NO_PLAYABLE_FORMAT_ISSUE,
} from "@shepherdjerred/streambot/sources/format-select.ts";

/** `config.stream.height`'s default — the Go Live output height the video selector caps to. */
const MAX_HEIGHT = 720;

describe("buildFormatSelector", () => {
  // These strings ARE the contract with yt-dlp, so they are asserted character for character.
  // A silent edit to one of them is a production format-selection change with no other signal.
  test("music asks for the best audio-only stream, with a muxed tail", () => {
    expect(buildFormatSelector({ kind: "music", maxHeight: MAX_HEIGHT })).toBe(
      "bestaudio/best",
    );
  });

  test("music ignores the height cap — there is no picture to cap", () => {
    expect(buildFormatSelector({ kind: "music", maxHeight: 1080 })).toBe(
      buildFormatSelector({ kind: "music", maxHeight: 240 }),
    );
  });

  test("video prefers H.264 within the cap, then any codec, then muxed, then audio", () => {
    expect(buildFormatSelector({ kind: "video", maxHeight: MAX_HEIGHT })).toBe(
      "bestvideo[vcodec^=avc1][height<=?720]+bestaudio/" +
        "bestvideo[height<=?720]+bestaudio/" +
        "best/" +
        "bestaudio",
    );
  });

  test("ends in a bare bestaudio tail so an audio-only source degrades instead of erroring", () => {
    // `best` means "best format containing BOTH video and audio" — the same semantics that make
    // `-f best` fail on YouTube. On a source with no picture anywhere, branch 3 errors out too, so
    // without this tail a `mode: "video"` SoundCloud link fails with "Requested format is not
    // available" rather than falling back to audio and being reclassified as music.
    const selector = buildFormatSelector({
      kind: "video",
      maxHeight: MAX_HEIGHT,
    });
    expect(selector.endsWith("/bestaudio")).toBe(true);
    expect(selector.split("/").at(-1)).toBe("bestaudio");
  });

  test("the height cap tracks config.stream.height", () => {
    expect(buildFormatSelector({ kind: "video", maxHeight: 1080 })).toContain(
      "[height<=?1080]",
    );
    expect(buildFormatSelector({ kind: "video", maxHeight: 480 })).toContain(
      "[height<=?480]",
    );
  });

  test("uses yt-dlp's SOFT height comparison, so a too-tall source still matches", () => {
    // `height<=?720` (with the `?`) matches a format whose height is unknown or above the cap
    // rather than failing the branch. Without it, a source that only publishes 1080p would fall
    // all the way through to `best` — the very selector this change exists to stop relying on.
    const selector = buildFormatSelector({
      kind: "video",
      maxHeight: MAX_HEIGHT,
    });
    expect(selector).toContain("[height<=?720]");
    expect(selector).not.toContain("[height<=720]");
  });

  test("every video branch pairs a video stream with audio", () => {
    // A branch that selected video alone would play silently, which is worse than falling through.
    const branches = buildFormatSelector({
      kind: "video",
      maxHeight: MAX_HEIGHT,
    }).split("/");
    expect(branches).toHaveLength(4);
    expect(branches[0]).toContain("+bestaudio");
    expect(branches[1]).toContain("+bestaudio");
    expect(branches[2]).toBe("best");
    expect(branches[3]).toBe("bestaudio");
  });

  test("prefers avc1 over the AV1 a naive selector picks", () => {
    // Measured: bare `bestvideo+bestaudio` selects `av01.0.04M.08` at 720p on YouTube today. The
    // video path encodes through VAAPI H264, so an AV1 source forces a software decode the GPU
    // cannot help with. The first branch pins avc1; the second exists for sources without it.
    const selector = buildFormatSelector({
      kind: "video",
      maxHeight: MAX_HEIGHT,
    });
    const avc1At = selector.indexOf("vcodec^=avc1");
    const anyCodecAt = selector.indexOf("bestvideo[height");
    // Both asserted present BEFORE comparing. `indexOf` answers -1 for a missing substring, so a
    // bare `bestvideo[height<=?720]+bestaudio` selector — precisely the AV1-picking bug this test
    // exists to catch — would satisfy `-1 < 0` and pass.
    expect(avc1At).toBeGreaterThanOrEqual(0);
    expect(anyCodecAt).toBeGreaterThanOrEqual(0);
    expect(avc1At).toBeLessThan(anyCodecAt);
  });
});

describe("httpHeaderInputOptions", () => {
  test("renders a header set as ffmpeg's CRLF-joined -headers option", () => {
    expect(
      httpHeaderInputOptions({
        "User-Agent": "Mozilla/5.0",
        Referer: "https://www.youtube.com/",
      }),
    ).toEqual([
      "-headers",
      "User-Agent: Mozilla/5.0\r\nReferer: https://www.youtube.com/",
    ]);
  });

  test("emits nothing at all for an absent or empty header set", () => {
    // An empty `-headers ""` is not the same thing as no `-headers`, so the caller must be able to
    // spread this unconditionally.
    expect(httpHeaderInputOptions(undefined)).toEqual([]);
    expect(httpHeaderInputOptions({})).toEqual([]);
  });

  test("keeps a single header on one option pair", () => {
    expect(httpHeaderInputOptions({ Cookie: "a=b" })).toEqual([
      "-headers",
      "Cookie: a=b",
    ]);
  });
});

describe("NoUsableFormatError", () => {
  test("names the stream the item was missing, per kind", () => {
    expect(
      new NoUsableFormatError("music", "selector: bestaudio/best").message,
    ).toContain("no playable audio stream");
    expect(
      new NoUsableFormatError("video", "selector: best").message,
    ).toContain("no playable video stream");
  });

  test("carries the kind so callers can branch without parsing the message", () => {
    expect(new NoUsableFormatError("music", "x").kind).toBe("music");
    expect(new NoUsableFormatError("video", "x").kind).toBe("video");
  });

  test("includes the detail so a live failure names the selector that missed", () => {
    expect(
      new NoUsableFormatError("video", "selector: bestvideo+bestaudio/best")
        .message,
    ).toContain("bestvideo+bestaudio/best");
  });
});

describe("NO_PLAYABLE_FORMAT_ISSUE", () => {
  test("is a stable constant shared with the yt-dlp schema refinement", () => {
    // `ytdlp.ts` recognises its own refinement failure by matching this exact string among Zod's
    // issues. Changing it in one place only would silently turn a specific, actionable reply back
    // into a generic parse error.
    expect(NO_PLAYABLE_FORMAT_ISSUE).toBe(
      "yt-dlp returned neither a media url nor requested_formats; nothing to play",
    );
  });
});
