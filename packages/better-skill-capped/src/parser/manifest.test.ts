import { describe, expect, test } from "bun:test";
import { ManifestSchema } from "./manifest.ts";
import fixture from "./fixtures/manifest.json";

describe("ManifestSchema", () => {
  test("parses real manifest fixture", () => {
    const result = ManifestSchema.parse(fixture);

    expect(result.timeStamp).toBe(1771681507372);
    expect(result.patch.patchVal).toBe("26.04");
    expect(result.videos).toHaveLength(3);
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
    const video = result.videos[0];

    expect(video.role).toBe("all");
    expect(video.title).toBe(
      "The New Most Underrated Champion For Solo Queue",
    );
    expect(video.uuid).toBe("4lt153z6bl");
    expect(video.durSec).toBe(436);
    expect(video.tId).toBe(1);
    expect(video.tSS).toBe("");
    expect(video.cSS).toBe("");
  });

  test("parses commentary fields with enums and rune/item fields", () => {
    const result = ManifestSchema.parse(fixture);
    const commentary = result.commentaries[0];

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
    const staff = result.staff[0];

    expect(staff.name).toBe("Hector");
    expect(staff.playerPeakRank).toBe(10);
  });

  test("parses courses with all fields", () => {
    const result = ManifestSchema.parse(fixture);
    const course = result.courses[0];

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
    const course = result.courses[1];

    expect(course.groupingKey).toBe("support-est-old");
    expect(course.tags).toEqual([
      "Support",
      "Support - Laning",
      "Support - Wave Control",
    ]);
  });

  test("parses carousel entries", () => {
    const result = ManifestSchema.parse(fixture);
    const entry = result.carousel[0];

    expect(entry.courseTitle).toContain("Jungling");
    expect(entry.page).toBe(1);
    expect(entry.size).toBe("3x2");
    expect(entry.url).toBeNull();
  });

  test("parses videosToCourses with chapter vids", () => {
    const result = ManifestSchema.parse(fixture);
    const entry = result.videosToCourses["Meta Updates {all}"];

    expect(entry).toBeDefined();
    expect(entry!.chapters[0].title).toBe("Course Content");
    expect(entry!.chapters[0].vids.length).toBeGreaterThan(0);
    expect(entry!.chapters[0].vids[0].uuid).toBe("4sghs37h9j");
  });

  test("parses videosToCourses vids with optional altTitle", () => {
    const result = ManifestSchema.parse(fixture);
    const entry =
      result.videosToCourses["Chapter 1: Wave Control {support}"];

    expect(entry).toBeDefined();
    expect(entry!.chapters[0].vids[0].altTitle).toBe(
      "Why Wave Control is Important for Supports",
    );
    expect(
      result.videosToCourses["Meta Updates {all}"]!.chapters[0].vids[0]
        .altTitle,
    ).toBeUndefined();
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
    const bad = structuredClone(fixture);
    bad.videos[0].role = "assassin";
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  test("rejects negative durSec", () => {
    const bad = structuredClone(fixture);
    bad.videos[0].durSec = -1;
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  test("rejects non-integer k/d/a", () => {
    const bad = structuredClone(fixture);
    bad.commentaries[0].k = 1.5;
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });

  test("coerces empty string d to 0", () => {
    const data = structuredClone(fixture);
    (data.commentaries[0] as Record<string, unknown>).d = "";
    const result = ManifestSchema.parse(data);
    expect(result.commentaries[0].d).toBe(0);
  });

  test("rejects commentary with role 'all'", () => {
    const bad = structuredClone(fixture);
    (bad.commentaries[0] as Record<string, unknown>).role = "all";
    expect(() => ManifestSchema.parse(bad)).toThrow();
  });
});
