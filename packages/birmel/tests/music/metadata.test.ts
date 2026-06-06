import { describe, expect, test } from "bun:test";
import {
  buildYouTubeCoverUrl,
  extractYouTubeVideoId,
  normalizeTrack,
  sumDurations,
} from "@shepherdjerred/birmel/music/metadata.ts";

describe("music metadata", () => {
  test("extracts YouTube video IDs from common URL shapes", () => {
    expect(
      extractYouTubeVideoId("https://www.youtube.com/watch?v=abc123"),
    ).toBe("abc123");
    expect(extractYouTubeVideoId("https://youtu.be/def456")).toBe("def456");
    expect(extractYouTubeVideoId("https://youtube.com/shorts/ghi789")).toBe(
      "ghi789",
    );
    expect(extractYouTubeVideoId("https://youtube.com/embed/jkl012")).toBe(
      "jkl012",
    );
  });

  test("does not extract YouTube IDs from non-YouTube hosts", () => {
    expect(extractYouTubeVideoId("https://example.com/watch?v=abc123")).toBe(
      undefined,
    );
    expect(buildYouTubeCoverUrl("https://example.com/watch?v=abc123")).toBe(
      undefined,
    );
  });

  test("builds YouTube cover URLs from track URLs", () => {
    expect(buildYouTubeCoverUrl("https://youtu.be/abc123")).toBe(
      "https://img.youtube.com/vi/abc123/hqdefault.jpg",
    );
  });

  test("normalizes track-like objects with thumbnail fallback", () => {
    const track = normalizeTrack({
      title: "Song",
      duration: "3:21",
      url: "https://www.youtube.com/watch?v=abc123",
      source: "youtube",
      requestedBy: { username: "jerred" },
    });

    expect(track).toEqual({
      title: "Song",
      duration: "3:21",
      url: "https://www.youtube.com/watch?v=abc123",
      source: "youtube",
      requestedBy: "jerred",
      coverUrl: "https://img.youtube.com/vi/abc123/hqdefault.jpg",
    });
  });

  test("sums known track durations", () => {
    expect(
      sumDurations([
        { title: "One", duration: "1:30", url: "https://example.com/1" },
        { title: "Two", duration: "2:45", url: "https://example.com/2" },
      ]),
    ).toBe("4:15");
  });
});
