import { describe, expect, test } from "bun:test";
import {
  classifyPlayError,
  isHttpUrl,
  resolvePlayQuery,
} from "@shepherdjerred/streambot/discord/resolve.ts";
import type { LibraryEntry } from "@shepherdjerred/streambot/sources/library.ts";

const entries: LibraryEntry[] = [
  {
    title: "Black Swan",
    path: "/media/movies/Black Swan/Black Swan.mkv",
    relativePath: "Black Swan/Black Swan.mkv",
    library: "movies",
  },
];

describe("isHttpUrl", () => {
  test("recognises http(s) urls only", () => {
    expect(isHttpUrl("https://youtu.be/abc")).toBe(true);
    expect(isHttpUrl("http://example.com")).toBe(true);
    expect(isHttpUrl("ftp://example.com")).toBe(false);
    expect(isHttpUrl("just text")).toBe(false);
  });
});

describe("resolvePlayQuery", () => {
  test("prefers a local library match", () => {
    expect(resolvePlayQuery("black swan", entries)).toEqual({
      kind: "file",
      path: "/media/movies/Black Swan/Black Swan.mkv",
      title: "Black Swan",
    });
  });

  test("treats an http(s) url as a url source", () => {
    expect(resolvePlayQuery("https://youtu.be/abc", entries)).toEqual({
      kind: "url",
      url: "https://youtu.be/abc",
    });
  });

  test("falls back to a search source", () => {
    expect(resolvePlayQuery("never gonna give you up", entries)).toEqual({
      kind: "search",
      query: "never gonna give you up",
    });
  });
});

describe("classifyPlayError", () => {
  test("recognizes an unsupported site", () => {
    const message = classifyPlayError(
      new Error(
        "yt-dlp exited with code 1: ERROR: Unsupported URL: https://nope.example",
      ),
      "url",
    );
    expect(message).toContain("isn't supported");
  });

  test("recognizes an unavailable/private video", () => {
    expect(
      classifyPlayError(new Error("ERROR: Video unavailable"), "url"),
    ).toContain("unavailable, private, or has been removed");
    expect(
      classifyPlayError(new Error("ERROR: Private video"), "url"),
    ).toContain("unavailable, private, or has been removed");
  });

  test("recognizes a no-results search failure only for search sources", () => {
    expect(
      classifyPlayError(
        new Error("yt-dlp exited with code 1: No videos found"),
        "search",
      ),
    ).toBe("No results found for that search.");
    // Same message on a url source doesn't get the search-specific bucket.
    expect(
      classifyPlayError(
        new Error("yt-dlp exited with code 1: No videos found"),
        "url",
      ),
    ).toStartWith("Couldn't queue that:");
  });

  test("falls back to a trimmed generic message for anything else", () => {
    const longMessage = `yt-dlp exited with code 1: ${"x".repeat(500)}`;
    const message = classifyPlayError(new Error(longMessage), "url");
    expect(message).toStartWith("Couldn't queue that:");
    expect(message.length).toBeLessThan(longMessage.length);
  });
});
