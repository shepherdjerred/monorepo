import { describe, expect, test } from "bun:test";
import {
  isPrunableImage,
  showcaseExemptKeysByBucket,
} from "./scout-image-gc.ts";

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
      isPrunableImage("games/2026/05/01/M1/report.png", old, cutoff, {
        suffixes: [".svg"],
      }),
    ).toBe(false);
    expect(
      isPrunableImage("games/2026/05/01/M1/report.svg", old, cutoff, {
        suffixes: [".svg"],
      }),
    ).toBe(true);
  });

  test("keeps a showcase-exempt key regardless of age", () => {
    const exemptKeys = new Set(["games/2026/05/01/M1/report.png"]);
    expect(
      isPrunableImage("games/2026/05/01/M1/report.png", old, cutoff, {
        exemptKeys,
      }),
    ).toBe(false);
    // A sibling that is NOT in the manifest still prunes.
    expect(
      isPrunableImage("games/2026/05/01/M1/report.svg", old, cutoff, {
        exemptKeys,
      }),
    ).toBe(true);
  });
});

describe("showcaseExemptKeysByBucket", () => {
  test("assigns keys without an explicit bucket to scout-prod", () => {
    const byBucket = showcaseExemptKeysByBucket({
      entries: [
        {
          imageKey: "games/2026/05/01/M1/report.png",
          dataKey: "games/2026/05/01/M1/match.json",
        },
      ],
    });

    expect(byBucket.get("scout-prod")).toEqual(
      new Set([
        "games/2026/05/01/M1/report.png",
        "games/2026/05/01/M1/match.json",
      ]),
    );
    expect(byBucket.has("scout-beta")).toBe(false);
  });

  test("exempts a pinned entry's keys in the bucket it pins, not the default", () => {
    const byBucket = showcaseExemptKeysByBucket({
      entries: [
        { bucket: "scout-beta", imageKey: "games/2026/05/01/B1/report.png" },
        { imageKey: "games/2026/05/01/P1/report.png" },
      ],
    });

    expect(byBucket.get("scout-beta")).toEqual(
      new Set(["games/2026/05/01/B1/report.png"]),
    );
    expect(byBucket.get("scout-prod")).toEqual(
      new Set(["games/2026/05/01/P1/report.png"]),
    );
  });

  test("keeps a pinned key alive in its own bucket and prunable in the other", () => {
    const cutoff = new Date("2026-06-03T00:00:00Z");
    const old = new Date("2026-05-01T00:00:00Z");
    const key = "prematch/2026/05/01/B1/loading-screen.png";
    const byBucket = showcaseExemptKeysByBucket({
      entries: [{ bucket: "scout-beta", imageKey: key }],
    });

    expect(
      isPrunableImage(key, old, cutoff, {
        exemptKeys: byBucket.get("scout-beta") ?? new Set<string>(),
      }),
    ).toBe(false);
    expect(
      isPrunableImage(key, old, cutoff, {
        exemptKeys: byBucket.get("scout-prod") ?? new Set<string>(),
      }),
    ).toBe(true);
  });

  test("entries with no keys (competition graph) contribute no exemptions", () => {
    const byBucket = showcaseExemptKeysByBucket({
      entries: [{ bucket: "scout-beta" }],
    });

    expect(byBucket.get("scout-beta")).toEqual(new Set<string>());
  });
});
