import { describe, expect, test } from "bun:test";

import {
  markdownPathToSlug,
  rewriteWikiLink,
  workingDirectorySlug,
  workingDocumentSlug,
} from "./wiki-paths.ts";

describe("wiki route generation", () => {
  test("normalizes Markdown indexes", () => {
    expect(markdownPathToSlug("index.md")).toBe("index");
    expect(markdownPathToSlug("architecture/index.md")).toBe("architecture");
    expect(markdownPathToSlug("guides/deploy.md")).toBe("guides/deploy");
  });

  test("keeps the source index distinct from the working landing page", () => {
    expect(workingDocumentSlug("index.md")).toBe("working/source-index");
    expect(workingDirectorySlug("architecture")).toBe("working/architecture");
  });
});

describe("wiki link rewriting", () => {
  const sourcePath = "packages/docs/guides/example.md";

  test("rewrites docs links to working routes", () => {
    expect(rewriteWikiLink(sourcePath, "../architecture/system.md#flow")).toBe(
      "/working/architecture/system/#flow",
    );
    expect(rewriteWikiLink(sourcePath, "../plans/")).toBe("/working/plans/");
  });

  test("rewrites repository links to GitHub", () => {
    expect(rewriteWikiLink(sourcePath, "../../homelab/README.md")).toBe(
      "https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/README.md",
    );
    expect(
      rewriteWikiLink(sourcePath, "../../homelab/src/index.ts:42-48"),
    ).toBe(
      "https://github.com/shepherdjerred/monorepo/blob/main/packages/homelab/src/index.ts#L42-L48",
    );
  });

  test("leaves absolute and external links unchanged", () => {
    expect(rewriteWikiLink(sourcePath, "#section")).toBe("#section");
    expect(rewriteWikiLink(sourcePath, "/working/")).toBe("/working/");
    expect(rewriteWikiLink(sourcePath, "https://example.com")).toBe(
      "https://example.com",
    );
  });
});
