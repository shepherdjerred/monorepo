import { describe, expect, test } from "bun:test";

import {
  isWorkflowDocumentPath,
  workflowDocumentPaths,
} from "#shared/docs-path";

describe("workflow document paths", () => {
  test("excludes the human wiki subtree", () => {
    expect(isWorkflowDocumentPath("plans/example.md")).toBe(true);
    expect(isWorkflowDocumentPath("wiki/src/content/docs/index.md")).toBe(
      false,
    );
  });

  test("filters and sorts scanned paths", () => {
    expect(
      workflowDocumentPaths([
        "wiki/AGENTS.md",
        "todos/later.md",
        "architecture/system.md",
      ]),
    ).toEqual(["architecture/system.md", "todos/later.md"]);
  });

  test("normalizes Windows glob paths before filtering", () => {
    expect(
      workflowDocumentPaths([
        String.raw`wiki\AGENTS.md`,
        String.raw`todos\later.md`,
        String.raw`plans\first.md`,
      ]),
    ).toEqual(["plans/first.md", "todos/later.md"]);
  });
});
