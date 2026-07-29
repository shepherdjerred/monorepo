import { describe, expect, test } from "bun:test";

import { publicWorkingDocumentPaths } from "./wiki-loader.ts";

describe("public working document allowlist", () => {
  test("excludes every workflow document that has not been explicitly approved", () => {
    expect(
      publicWorkingDocumentPaths([
        "plans/2026-07-28_human-wiki-scaffold.md",
        "archive/completed/homekit-secure-video.md",
        "plans/private-infrastructure.md",
      ]),
    ).toEqual(["plans/2026-07-28_human-wiki-scaffold.md"]);
  });
});
