import { describe, expect, test } from "vitest";
import { foldPlayerName, toPlayerName } from "./names.ts";

describe("foldPlayerName", () => {
  test("keeps plain names", () => {
    expect(foldPlayerName("Jerred")).toBe("Jerred");
  });

  test("folds accents to their base letters", () => {
    expect(foldPlayerName("Zoë Café")).toBe("Zoe Cafe");
  });

  test("drops emoji and other scripts and collapses the gaps", () => {
    expect(foldPlayerName("🏎️ Speed  Demon 🔥")).toBe("Speed Demon");
  });

  test("caps the length at the overlay's limit", () => {
    expect(foldPlayerName("a".repeat(40))).toHaveLength(20);
  });

  test("returns undefined when nothing drawable is left", () => {
    expect(foldPlayerName("🔥🔥")).toBeUndefined();
    expect(foldPlayerName("日本語")).toBeUndefined();
  });
});

describe("toPlayerName", () => {
  test("prefers the first candidate that survives folding", () => {
    expect(toPlayerName(["🔥", "Display", undefined], "user")).toBe("Display");
  });

  test("falls back to the username", () => {
    expect(toPlayerName([null, "日本語"], "jerred_")).toBe("jerred_");
  });
});
