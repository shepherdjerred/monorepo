import { describe, expect, test } from "bun:test";
import {
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
