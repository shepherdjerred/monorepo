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
    expect(
      rewriteWikiLink(
        sourcePath,
        "../plans/2026-07-28_human-wiki-scaffold.md#verification",
      ),
    ).toBe("/working/plans/2026-07-28_human-wiki-scaffold/#verification");
    expect(rewriteWikiLink(sourcePath, "../plans/")).toBe("/working/plans/");
  });

  test("keeps unapproved docs links on GitHub", () => {
    const publishedSourcePath =
      "packages/docs/plans/2026-07-28_human-wiki-scaffold.md";
    expect(
      rewriteWikiLink(
        publishedSourcePath,
        "../decisions/2026-07-19_infrastructure-security-audit.md",
      ),
    ).toBe(
      "https://github.com/shepherdjerred/monorepo/blob/main/packages/docs/decisions/2026-07-19_infrastructure-security-audit.md",
    );
    expect(rewriteWikiLink(publishedSourcePath, "../archive/completed/")).toBe(
      "https://github.com/shepherdjerred/monorepo/tree/main/packages/docs/archive/completed/",
    );
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

  test("rewrites non-Markdown docs files to their repository sources", () => {
    expect(
      rewriteWikiLink(
        "packages/docs/decisions/2026-07-19_infrastructure-security-audit.md",
        "./2026-07-19_infrastructure-security-audit.typ",
      ),
    ).toBe(
      "https://github.com/shepherdjerred/monorepo/blob/main/packages/docs/decisions/2026-07-19_infrastructure-security-audit.typ",
    );
    expect(
      rewriteWikiLink(
        "packages/docs/decisions/2026-07-19_infrastructure-security-audit.md",
        "./2026-07-19_infrastructure-security-audit.pdf#page=2",
      ),
    ).toBe(
      "https://github.com/shepherdjerred/monorepo/blob/main/packages/docs/decisions/2026-07-19_infrastructure-security-audit.pdf#page=2",
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
