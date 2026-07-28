import { expect, test } from "bun:test";

import {
  isMergeConflictCandidate,
  parseConflictIgnore,
} from "./migration-core.ts";

test("parseConflictIgnore removes comments, blanks, and surrounding whitespace", () => {
  expect(
    parseConflictIgnore("\n# generated\n dist/** \n\nfixtures/a.txt\n"),
  ).toEqual(["dist/**", "fixtures/a.txt"]);
});

test("merge-conflict checks scope local work to changed source files", () => {
  expect(isMergeConflictCandidate("packages/app/src/index.ts")).toBe(true);
  expect(isMergeConflictCandidate("packages/app/config.toml")).toBe(true);
  expect(isMergeConflictCandidate("packages/app/image.png")).toBe(false);
});
