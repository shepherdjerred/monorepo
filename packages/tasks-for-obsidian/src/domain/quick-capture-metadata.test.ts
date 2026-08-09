import { describe, expect, test } from "bun:test";

import { mergeProjects } from "./quick-capture-metadata";

describe("mergeProjects", () => {
  test("deduplicates bare and wikilink spellings without merging qualified paths", () => {
    expect(
      mergeProjects("[[Projects/Work]]", [
        "Work",
        "[[Areas/Work]]",
        "[[Projects/Work]]",
      ]),
    ).toEqual(["[[Projects/Work]]", "[[Areas/Work]]"]);
  });
});
