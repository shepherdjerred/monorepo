import { expect, test } from "vitest";
import { dependencyNoteText } from "./deps-summary-text.ts";

test("drops notes too short to be useful", () => {
  expect(dependencyNoteText("  short  ")).toBeUndefined();
  expect(dependencyNoteText(undefined)).toBeUndefined();
});

test("caps release notes without splitting an emoji heading", () => {
  const notes = dependencyNoteText(`${"x".repeat(3999)}🚀 Features`);
  expect(notes).toBe("x".repeat(3999));
  expect(notes?.isWellFormed()).toBe(true);
});
