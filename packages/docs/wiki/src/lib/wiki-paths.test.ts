import { describe, expect, test } from "bun:test";

import { rewriteWikiLink } from "./wiki-paths.ts";

describe("wiki link rewriting", () => {
  const sourcePath =
    "packages/docs/wiki/src/content/docs/explanation/example.md";

  test("rewrites repository links to GitHub", () => {
    expect(
      rewriteWikiLink(
        sourcePath,
        "../../../../../../homelab/src/index.ts:42-48",
      ),
    ).toBe(
      "https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/index.ts#L42-L48",
    );
  });

  test("leaves absolute and external links unchanged", () => {
    expect(rewriteWikiLink(sourcePath, "#section")).toBe("#section");
    expect(rewriteWikiLink(sourcePath, "/reference/")).toBe("/reference/");
    expect(rewriteWikiLink(sourcePath, "https://example.com")).toBe(
      "https://example.com",
    );
  });
});
