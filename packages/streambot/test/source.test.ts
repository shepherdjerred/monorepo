import { describe, expect, test } from "bun:test";
import {
  SourceSchema,
  sourceIdentity,
  sourceLabel,
} from "@shepherdjerred/streambot/sources/source.ts";

describe("SourceSchema", () => {
  test("accepts a file source", () => {
    const source = SourceSchema.parse({
      kind: "file",
      path: "/videos/a.mkv",
      title: "a",
    });
    expect(source.kind).toBe("file");
  });

  test("accepts a url source", () => {
    const source = SourceSchema.parse({
      kind: "url",
      url: "https://youtu.be/abc",
    });
    expect(source.kind).toBe("url");
  });

  test("accepts a search source", () => {
    const source = SourceSchema.parse({ kind: "search", query: "lofi beats" });
    expect(source.kind).toBe("search");
  });

  test("rejects a url source with an invalid url", () => {
    expect(
      SourceSchema.safeParse({ kind: "url", url: "not a url" }).success,
    ).toBe(false);
  });

  test("rejects an unknown kind", () => {
    expect(
      SourceSchema.safeParse({ kind: "stream", url: "https://x.test" }).success,
    ).toBe(false);
  });
});

describe("sourceLabel", () => {
  test("labels each source kind", () => {
    expect(
      sourceLabel({ kind: "file", path: "/v/a.mkv", title: "Movie" }),
    ).toBe("Movie");
    expect(sourceLabel({ kind: "url", url: "https://youtu.be/abc" })).toBe(
      "https://youtu.be/abc",
    );
    expect(sourceLabel({ kind: "search", query: "lofi" })).toBe("lofi");
  });
});

describe("sourceIdentity", () => {
  test("prefixes the kind and the concrete locator per source kind", () => {
    expect(
      sourceIdentity({ kind: "file", path: "/v/a.mkv", title: "Movie" }),
    ).toBe("file:/v/a.mkv");
    expect(sourceIdentity({ kind: "url", url: "https://youtu.be/abc" })).toBe(
      "url:https://youtu.be/abc",
    );
    expect(sourceIdentity({ kind: "search", query: "lofi" })).toBe(
      "search:lofi",
    );
  });

  test("distinguishes two files that share a display title", () => {
    const a = sourceIdentity({ kind: "file", path: "/a/dupe.mkv", title: "T" });
    const b = sourceIdentity({ kind: "file", path: "/b/dupe.mkv", title: "T" });
    expect(a).not.toBe(b);
  });

  test("ignores the per-request subtitle preference", () => {
    const withoutPref = sourceIdentity({
      kind: "file",
      path: "/v/a.mkv",
      title: "Movie",
    });
    const withPref = sourceIdentity({
      kind: "file",
      path: "/v/a.mkv",
      title: "Movie",
      subtitles: { trackRef: { kind: "sidecar", file: "a.en.srt" } },
    });
    expect(withPref).toBe(withoutPref);
  });

  test("cannot collide across source kinds", () => {
    const fileId = sourceIdentity({
      kind: "file",
      path: "x",
      title: "x",
    });
    const urlId = sourceIdentity({ kind: "url", url: "https://x.test/x" });
    const searchId = sourceIdentity({ kind: "search", query: "x" });
    expect(new Set([fileId, urlId, searchId]).size).toBe(3);
  });
});
