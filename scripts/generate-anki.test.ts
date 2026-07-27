import { expect, test } from "bun:test";

import { deckCommand } from "./generate-anki.ts";

test("deckCommand maps one Markdown source to the matching Anki package", () => {
  expect(deckCommand("book_ostep")).toEqual([
    "bunx",
    "mdanki",
    "book_ostep.md",
    "book_ostep.apkg",
    "--config",
    "settings.json",
  ]);
});
