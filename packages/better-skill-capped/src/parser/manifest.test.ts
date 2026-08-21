import { describe, expect, test } from "vitest";
import { ManifestSchema } from "./manifest.ts";
import fixture from "./fixtures/manifest.json";

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) {
    throw new Error("Expected value to be defined");
  }
  return value;
}

function withFirstVideoOverride(overrides: Record<string, unknown>): unknown {
  const clone = structuredClone(fixture);
  return {
    ...clone,
    videos: [
      { ...must(clone.videos[0]), ...overrides },
      ...clone.videos.slice(1),
    ],
  };
}

function withFirstCommentaryOverride(
  overrides: Record<string, unknown>,
): unknown {
  const clone = structuredClone(fixture);
  return {
    ...clone,
    commentaries: [
      { ...must(clone.commentaries[0]), ...overrides },
      ...clone.commentaries.slice(1),
    ],
  };
}

describe("ManifestSchema", () => {
  test("parses real manifest fixture", () => {
    const result = ManifestSchema.parse(fixture);

    expect(result.timeStamp).toBe(1_771_681_507_372);
    expect(result.patch.patchVal).toBe("26.04");
    expect(result.videos).toHaveLength(6);
    expect(result.commentaries).toHaveLength(2);
    expect(result.staff).toHaveLength(2);
    expect(result.courses).toHaveLength(2);
    expect(Object.keys(result.videosToCourses)).toHaveLength(2);
    expect(result.carousel).toHaveLength(2);
    expect(result.tagInfo).toHaveLength(3);
    expect(result.config.game).toBe("lol");
  });

  test("parses video fields with enum role", () => {
    const result = ManifestSchema.parse(fixture);
    const video = must(result.videos[0]);

    expect(video.role).toBe("all");
    expect(video.title).toBe("The New Most Underrated Champion For Solo Queue");
    expect(video.uuid).toBe("4lt153z6bl");
    expect(video.durSec).toBe(436);
    expect(video.tId).toBe(1);
    expect(video.tSS).toBe("");
    expect(video.cSS).toBe("");
  });

  test("parses commentary fields with enums and rune/item fields", () => {
    const result = ManifestSchema.parse(fixture);
    const commentary = must(result.commentaries[0]);

    expect(commentary.role).toBe("mid");
    expect(commentary.staff).toBe("Hector");
    expect(commentary.yourChampion).toBe("Kai'Sa");
    expect(commentary.theirChampion).toBe("Fizz");
    expect(commentary.k).toBe(6);
    expect(commentary.d).toBe(1);
    expect(commentary.a).toBe(4);
    expect(commentary.carry).toBe("Light");
    expect(commentary.type).toBe("Smurf");
    expect(commentary.rune1).toBe("");
    expect(commentary.item1).toBe("");
  });

  test("parses staff with playerPeakRank", () => {
    const result = ManifestSchema.parse(fixture);
    const staff = must(result.staff[0]);

    expect(staff.name).toBe("Hector");
    expect(staff.playerPeakRank).toBe(10);
  });

  test("parses courses with all fields", () => {
    const result = ManifestSchema.parse(fixture);
    const course = must(result.courses[0]);

    expect(course.title).toBe("Meta Updates {all}");
    expect(course.courseImage3).toContain("https://");
    expect(course.tags).toEqual([]);
    expect(course.recommended).toBe(true);
    expect(course.override).toBe(true);
    expect(course.overlay).toBe("none");
    expect(course.groupingKey).toBeUndefined();
  });

  test("parses course with optional groupingKey", () => {
    const result = ManifestSchema.parse(fixture);
    const course = must(result.courses[1]);

    expect(course.groupingKey).toBe("support-est-old");
    expect(course.tags).toEqual([
      "Support",
      "Support - Laning",
      "Support - Wave Control",
    ]);
  });

  test("parses carousel entries", () => {
    const result = ManifestSchema.parse(fixture);
    const entry = must(result.carousel[0]);

    expect(entry.courseTitle).toContain("Jungling");
    expect(entry.page).toBe(1);
    expect(entry.size).toBe("3x2");
    expect(entry.url).toBeNull();
  });

  test("parses videosToCourses with chapter vids", () => {
    const result = ManifestSchema.parse(fixture);
    const entry = must(result.videosToCourses["Meta Updates {all}"]);
    const chapter = must(entry.chapters[0]);

    expect(chapter.title).toBe("Course Content");
    expect(chapter.vids.length).toBeGreaterThan(0);
    expect(must(chapter.vids[0]).uuid).toBe("4lt153z6bl");
  });

  test("parses videosToCourses vids with optional altTitle", () => {
    const result = ManifestSchema.parse(fixture);
    const entry = must(
      result.videosToCourses["Chapter 1: Wave Control {support}"],
    );

    expect(must(must(entry.chapters[0]).vids[0]).altTitle).toBe(
      "Why Wave Control is Important for Supports",
    );
    const metaEntry = must(result.videosToCourses["Meta Updates {all}"]);
    expect(must(must(metaEntry.chapters[0]).vids[0]).altTitle).toBeUndefined();
  });

  test("handles thisWeekData as empty array", () => {
    const result = ManifestSchema.parse(fixture);
    expect(Array.isArray(result.thisWeekData)).toBe(true);
    expect(result.thisWeekData).toHaveLength(0);
  });

  test("rejects unknown fields (strict mode)", () => {
    const bad = { ...fixture, unknownField: "oops" };
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  test("rejects invalid role", () => {
    const bad = withFirstVideoOverride({ role: "assassin" });
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  test("rejects negative durSec", () => {
    const bad = withFirstVideoOverride({ durSec: -1 });
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  test("rejects non-integer k/d/a", () => {
    const bad = withFirstCommentaryOverride({ k: 1.5 });
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  test("coerces empty string d to 0", () => {
    const data = withFirstCommentaryOverride({ d: "" });
    const result = ManifestSchema.parse(data);
    expect(must(result.commentaries[0]).d).toBe(0);
  });

  test("normalizes numeric rune field to string", () => {
    const data = withFirstCommentaryOverride({ rune3: 3008 });
    const result = ManifestSchema.parse(data);
    expect(must(result.commentaries[0]).rune3).toBe("3008");
  });

  test("rejects commentary with role 'all'", () => {
    const bad = withFirstCommentaryOverride({ role: "all" });
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });
});
