import { describe, expect, test } from "bun:test";

import {
  assertPublicWorkingDocumentPathsExist,
  isPublicWorkingDirectoryPath,
  isPublicWorkingDocumentPath,
  publicWorkingDocumentPaths,
} from "./wiki-publication.ts";

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

  test("rejects every stale publication path", () => {
    expect(() => {
      assertPublicWorkingDocumentPathsExist(
        ["plans/renamed.md", "todos/deleted.md", "guides/mistyped.md"],
        new Set(["plans/current.md"]),
      );
    }).toThrow(
      [
        "Public working document allowlist contains paths that were not discovered:",
        "- guides/mistyped.md",
        "- plans/renamed.md",
        "- todos/deleted.md",
      ].join("\n"),
    );
  });

  test("rejects the configured allowlist when its document is missing", () => {
    expect(() => {
      publicWorkingDocumentPaths(["plans/private-infrastructure.md"]);
    }).toThrow(
      [
        "Public working document allowlist contains paths that were not discovered:",
        "- plans/2026-07-28_human-wiki-scaffold.md",
      ].join("\n"),
    );
  });

  test("recognizes only published documents and their generated directories", () => {
    expect(
      isPublicWorkingDocumentPath("plans/2026-07-28_human-wiki-scaffold.md"),
    ).toBe(true);
    expect(isPublicWorkingDocumentPath("plans/private.md")).toBe(false);
    expect(isPublicWorkingDirectoryPath("plans")).toBe(true);
    expect(isPublicWorkingDirectoryPath("archive/completed")).toBe(false);
  });
});
