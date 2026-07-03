import { describe, expect, test } from "bun:test";
import { isPrunableImage } from "./scout-image-gc.ts";

describe("isPrunableImage", () => {
  const cutoff = new Date("2026-06-03T00:00:00Z");
  const old = new Date("2026-05-01T00:00:00Z");
  const recent = new Date("2026-06-20T00:00:00Z");

  test("prunes a .png older than the cutoff", () => {
    expect(isPrunableImage("games/2026/05/01/M1/report.png", old, cutoff)).toBe(
      true,
    );
  });

  test("prunes a .svg older than the cutoff", () => {
    expect(
      isPrunableImage("prematch/2026/05/01/G1/loading-screen.svg", old, cutoff),
    ).toBe(true);
  });

  test("prunes the nested ai-pipeline image", () => {
    expect(
      isPrunableImage(
        "games/2026/05/01/M1/ai-pipeline/final-image.png",
        old,
        cutoff,
      ),
    ).toBe(true);
  });

  test("keeps an image newer than the cutoff", () => {
    expect(
      isPrunableImage("games/2026/06/20/M2/report.png", recent, cutoff),
    ).toBe(false);
  });

  test("keeps JSON regardless of age", () => {
    expect(isPrunableImage("games/2026/05/01/M1/match.json", old, cutoff)).toBe(
      false,
    );
    expect(
      isPrunableImage("games/2026/05/01/M1/timeline.json", old, cutoff),
    ).toBe(false);
  });

  test("keeps an image written exactly at the cutoff (boundary is inclusive of retention)", () => {
    expect(
      isPrunableImage("games/2026/05/01/M1/report.png", cutoff, cutoff),
    ).toBe(false);
  });

  test("returns false when LastModified is undefined", () => {
    expect(
      isPrunableImage("games/2026/05/01/M1/report.png", undefined, cutoff),
    ).toBe(false);
  });

  test("respects a custom suffix set", () => {
    expect(
      isPrunableImage("games/2026/05/01/M1/report.png", old, cutoff, [".svg"]),
    ).toBe(false);
    expect(
      isPrunableImage("games/2026/05/01/M1/report.svg", old, cutoff, [".svg"]),
    ).toBe(true);
  });
});
