import { describe, expect, test } from "bun:test";
import {
  SourceSchema,
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
