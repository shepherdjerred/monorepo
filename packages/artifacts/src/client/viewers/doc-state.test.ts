import { describe, expect, test } from "vitest";
import { artifactPathOf, nextDocState } from "./doc-state.ts";

const context = { entryPath: "index.html", prefixPathname: "/_t/abc/" };

describe("nextDocState", () => {
  test("drawn sets the size and keeps the scroll", () => {
    const scrolled = nextDocState(null, { t: "scroll", x: 0, y: 320 }, context);
    const drawn = nextDocState(
      scrolled,
      { t: "drawn", docW: 1440, docH: 3000 },
      context,
    );
    expect(drawn).toEqual({
      scrollX: 0,
      scrollY: 320,
      width: 1440,
      height: 3000,
      path: "index.html",
    });
  });

  test("a scroll that carries the size updates it", () => {
    const next = nextDocState(
      null,
      { t: "scroll", x: 0, y: 10, docW: 800, docH: 5000 },
      context,
    );
    expect(next).toMatchObject({ width: 800, height: 5000, scrollY: 10 });
  });

  test("nav sets the artifact path without the prefix, query or hash", () => {
    const next = nextDocState(
      null,
      { t: "nav", path: "/_t/abc/pages/b.html?x=1#top" },
      context,
    );
    expect(next?.path).toBe("pages/b.html");
  });

  test("messages that are not about the document return null", () => {
    expect(nextDocState(null, { t: "key", k: "c" }, context)).toBeNull();
    expect(
      nextDocState(null, { t: "error", message: "x" }, context),
    ).toBeNull();
  });
});

describe("artifactPathOf", () => {
  const entry = "index.html";
  const prefix = "/_t/abc/";

  test("strips the prefix and decodes", () => {
    expect(artifactPathOf("/_t/abc/docs/a%20b.html", prefix, entry)).toBe(
      "docs/a b.html",
    );
  });

  test("the prefix itself is the entry", () => {
    expect(artifactPathOf("/_t/abc/", prefix, entry)).toBe(entry);
    expect(artifactPathOf("/_t/abc/#/route", prefix, entry)).toBe(entry);
  });

  test("a location outside the prefix, or an invalid path, is the entry", () => {
    expect(artifactPathOf("/_t/other/x.html", prefix, entry)).toBe(entry);
    expect(artifactPathOf("/", prefix, entry)).toBe(entry);
    expect(artifactPathOf("/_t/abc/%E0%A4%A", prefix, entry)).toBe(entry);
    expect(artifactPathOf("/_t/abc/a/../../b", prefix, entry)).toBe(entry);
  });
});
