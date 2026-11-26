import { describe, expect, test } from "vitest";
import { noop } from "#client/lib/noop.ts";
import { matches, SHORTCUT_SHEET, type KeyInput } from "./shortcuts.ts";

function key(init: Partial<KeyInput> & { key: string }): KeyInput {
  return { metaKey: false, ctrlKey: false, altKey: false, ...init };
}

describe("matches", () => {
  test("letters compare case-insensitively", () => {
    expect(matches({ key: "c", run: noop }, key({ key: "C" }))).toBe(true);
  });

  test("named keys compare exactly", () => {
    expect(matches({ key: "Escape", run: noop }, key({ key: "Escape" }))).toBe(
      true,
    );
    expect(matches({ key: "Escape", run: noop }, key({ key: "escape" }))).toBe(
      false,
    );
  });

  test("a modifier leaves the browser's own shortcut alone", () => {
    expect(
      matches({ key: "c", run: noop }, key({ key: "c", metaKey: true })),
    ).toBe(false);
    expect(
      matches({ key: "[", run: noop }, key({ key: "[", ctrlKey: true })),
    ).toBe(false);
  });
});

describe("the shortcut sheet", () => {
  test("documents every review key", () => {
    const keys = SHORTCUT_SHEET.map((row) => row.keys).join(" ");
    for (const expected of [
      "C",
      "Enter",
      "Esc",
      "F",
      "J / K",
      "R",
      "E",
      "[ / ]",
      "?",
    ])
      expect(keys).toContain(expected);
  });
});
