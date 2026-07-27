import { expect, test } from "bun:test";

import { parseConflictIgnore } from "./check-merge-conflicts.ts";

test("parseConflictIgnore removes comments, blanks, and surrounding whitespace", () => {
  expect(
    parseConflictIgnore("\n# generated\n dist/** \n\nfixtures/a.txt\n"),
  ).toEqual(["dist/**", "fixtures/a.txt"]);
});
