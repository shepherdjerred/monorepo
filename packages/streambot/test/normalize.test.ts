import { describe, expect, test } from "bun:test";
import {
  normalizeTitle,
  parseTitleYear,
} from "@shepherdjerred/streambot/sources/normalize.ts";

describe("normalizeTitle", () => {
  test("strips release junk after a bracketed year (the motivating case)", () => {
    expect(normalizeTitle("Avengers - Endgame (2019) Remux - Bluray")).toBe(
      "Avengers - Endgame (2019)",
    );
  });

  test("handles dotted scene names with trailing tags and a release group", () => {
    expect(
      normalizeTitle("Avengers.Endgame.2019.1080p.BluRay.x264-GROUP"),
    ).toBe("Avengers Endgame (2019)");
  });

  test("keeps a year that is part of the title, picking the real release year", () => {
    expect(normalizeTitle("Blade Runner 2049 (2017) Remux")).toBe(
      "Blade Runner 2049 (2017)",
    );
    expect(normalizeTitle("Blade.Runner.2049.2017.2160p.UHD.BluRay.x265")).toBe(
      "Blade Runner 2049 (2017)",
    );
  });

  test("leaves an already-clean title untouched", () => {
    expect(normalizeTitle("Black Swan")).toBe("Black Swan");
    expect(normalizeTitle("The Show - S01E01")).toBe("The Show - S01E01");
  });

  test("strips tags when there is no year", () => {
    expect(normalizeTitle("Some Movie 1080p WEB-DL DDP5.1 x265")).toBe(
      "Some Movie",
    );
  });

  test("does not treat a leading year as a release year", () => {
    expect(normalizeTitle("2001 A Space Odyssey")).toBe("2001 A Space Odyssey");
  });

  test("falls back to the despaced original for degenerate input", () => {
    expect(normalizeTitle("...")).toBe("...");
  });
});

describe("parseTitleYear", () => {
  test("returns title and year separately for poster lookups", () => {
    expect(parseTitleYear("Avengers - Endgame (2019) Remux - Bluray")).toEqual({
      title: "Avengers - Endgame",
      year: 2019,
    });
  });

  test("returns null year when none is present", () => {
    expect(parseTitleYear("Some Movie 1080p")).toEqual({
      title: "Some Movie",
      year: null,
    });
  });

  test("prefers a bracketed year over an in-title year", () => {
    expect(parseTitleYear("Blade Runner 2049 (2017)")).toEqual({
      title: "Blade Runner 2049",
      year: 2017,
    });
  });
});
