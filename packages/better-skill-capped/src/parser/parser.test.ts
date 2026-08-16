import { describe, expect, test } from "bun:test";
import { ManifestSchema } from "./manifest.ts";
import {
  getImageUrl,
  parseDate,
  parseGameTime,
  parseManifest,
} from "./parser.ts";
import { parseRole } from "#src/model/role";
import fixture from "./fixtures/manifest.json";

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null) {
    throw new Error("Expected value to be defined");
  }
  return value;
}

const manifest = ManifestSchema.parse(fixture);

describe("parseManifest", () => {
  test("partitions videos into course-mapped and unmapped", () => {
    const content = parseManifest(manifest);

    expect(content.videos.map((video) => video.uuid).toSorted()).toEqual([
      "4lt153z6bl",
      "54q44khlyf",
      "fc617w6xvd",
      "pns2nw4pqg",
      "rfv2ryr5fh",
    ]);
    expect(content.unmappedVideos.map((video) => video.uuid)).toEqual([
      "v0unmapped1",
    ]);
  });

  test("tags every item with its kind discriminant", () => {
    const content = parseManifest(manifest);

    for (const video of [...content.videos, ...content.unmappedVideos]) {
      expect(video.kind).toBe("video");
    }
    for (const course of content.courses) {
      expect(course.kind).toBe("course");
    }
    for (const commentary of content.commentaries) {
      expect(commentary.kind).toBe("commentary");
    }
  });

  test("builds courses with resolved videos and alternate titles", () => {
    const content = parseManifest(manifest);
    const waveControl = must(
      content.courses.find((course) => course.uuid === "5760l2psnt"),
    );

    expect(waveControl.videos).toHaveLength(2);
    const first = must(waveControl.videos[0]);
    expect(first.video.uuid).toBe("54q44khlyf");
    // Regression: the old parser emitted `altTitle` against a model field
    // named `alternateTitle`, so alternate titles were always undefined.
    expect(first.alternateTitle).toBe(
      "Why Wave Control Is Important For Supports",
    );
  });

  test("omits description when the manifest field is empty", () => {
    const content = parseManifest(manifest);
    const metaUpdates = must(
      content.courses.find((course) => course.uuid === "900n94s4k4"),
    );

    expect("description" in metaUpdates).toBe(false);
  });

  test("strips role braces from course titles", () => {
    const content = parseManifest(manifest);
    const metaUpdates = must(
      content.courses.find((course) => course.uuid === "900n94s4k4"),
    );

    expect(metaUpdates.title.trim()).toBe("Meta Updates");
    expect(metaUpdates.role).toBe("all");
  });

  test("parses commentary matchup and game length in seconds", () => {
    const content = parseManifest(manifest);
    const kaisa = must(
      content.commentaries.find(
        (commentary) => commentary.uuid === "89vr3hw8qk",
      ),
    );

    expect(kaisa.champion).toBe("Kai'Sa");
    expect(kaisa.opponent).toBe("Fizz");
    // Regression: prod commentaries have no `title`; the old parser filtered
    // on it and silently dropped every commentary. The title is now derived.
    expect(kaisa.title).toBe("Kai'Sa vs Fizz");
    expect(kaisa.kills).toBe(6);
    expect(kaisa.deaths).toBe(1);
    expect(kaisa.assists).toBe(4);
    // Regression: parseInt("27m26s") used to drop the seconds entirely.
    expect(kaisa.gameLengthInSeconds).toBe(27 * 60 + 26);
    expect(kaisa.skillCappedUrl).toBe(
      "https://www.skill-capped.com/lol/commentaries/89vr3hw8qk",
    );
  });

  test("builds video URLs and release dates", () => {
    const content = parseManifest(manifest);
    const video = must(
      content.videos.find((candidate) => candidate.uuid === "4lt153z6bl"),
    );

    expect(video.skillCappedUrl).toBe(
      "https://www.skill-capped.com/lol/browse/video/4lt153z6bl",
    );
    expect(video.releaseDate.getTime()).toBe(1_771_135_200_000);
  });

  // Regression: `gameTime` is unvalidated free text upstream, and parsing it
  // used to throw. Because nothing between here and `App.loadContent` catches,
  // one unreadable commentary blanked the entire app.
  test("keeps loading every item when one commentary's game time is unreadable", () => {
    const clone = structuredClone(fixture);
    must(clone.commentaries[0]).gameTime = "unreadable";
    const content = parseManifest(ManifestSchema.parse(clone));

    expect(content.commentaries).toHaveLength(fixture.commentaries.length);
    expect(content.videos.length + content.unmappedVideos.length).toBe(
      fixture.videos.length,
    );

    const broken = must(
      content.commentaries.find(
        (commentary) => commentary.uuid === "89vr3hw8qk",
      ),
    );
    // Absent, not zero — a 0m00s tag would assert a game length we never read.
    expect(broken.gameLengthInSeconds).toBeUndefined();
    expect("gameLengthInSeconds" in broken).toBe(false);
    // The rest of the broken commentary still parses.
    expect(broken.title).toBe("Kai'Sa vs Fizz");

    const healthy = must(
      content.commentaries.find(
        (commentary) => commentary.uuid === "wrlky8mjty",
      ),
    );
    expect(healthy.gameLengthInSeconds).toBe(20 * 60 + 9);
  });

  test("carries course curation fields into the model", () => {
    const content = parseManifest(manifest);
    const waveControl = must(
      content.courses.find((course) => course.uuid === "5760l2psnt"),
    );

    expect(waveControl.tags).toEqual([
      "Support",
      "Support - Laning",
      "Support - Wave Control",
    ]);
    expect(waveControl.recommended).toBe(true);
    expect(waveControl.marketingString).toBe("Beginner's Guide");
    expect(waveControl.seasonString).toBe("Season 15");
  });

  test("exposes staff, patch, and manifest generation time", () => {
    const content = parseManifest(manifest);

    const hector = must(content.staffByName.get("Hector"));
    expect(hector.summonerName).toBe("HgHector");
    expect(hector.playerPeakRank).toBe(10);

    expect(content.patch.version).toBe("26.04");
    expect(content.generatedAt.getTime()).toBe(1_771_681_507_372);
  });

  test("throws when a course references a video missing from the manifest", () => {
    const clone = structuredClone(fixture);
    const entry = must(clone.videosToCourses["Meta Updates {all}"]);
    must(must(entry.chapters[0]).vids[0]).uuid = "does-not-exist";

    expect(() => parseManifest(ManifestSchema.parse(clone))).toThrow(
      /references unknown video/,
    );
  });
});

describe("parseGameTime", () => {
  test("parses minutes and seconds", () => {
    expect(parseGameTime("27m26s")).toBe(1646);
    expect(parseGameTime("20m9s")).toBe(1209);
  });

  test("parses minutes-only values", () => {
    expect(parseGameTime("27m")).toBe(1620);
  });

  test("tolerates the malformed variants seen in production", () => {
    expect(parseGameTime("23m35")).toBe(1415);
    expect(parseGameTime("33m11ss")).toBe(1991);
    expect(parseGameTime("34m06s ")).toBe(2046);
    expect(parseGameTime("27m17m")).toBe(1637);
  });

  test("returns undefined on unrecognizable input", () => {
    expect(parseGameTime("garbage")).toBeUndefined();
    expect(parseGameTime("")).toBeUndefined();
  });
});

describe("getImageUrl", () => {
  test("derives the thumbnail URL when no screenshot is set", () => {
    const video = must(manifest.videos[0]);
    expect(getImageUrl(video)).toBe(
      "https://ik.imagekit.io/skillcapped/thumbnails/4lt153z6bl/thumbnails/thumbnail_1.jpg",
    );
  });

  test("rewrites cloudfront screenshots to imagekit", () => {
    const video = must(
      manifest.videos.find((candidate) => candidate.uuid === "54q44khlyf"),
    );
    expect(getImageUrl(video)).toBe(
      "https://ik.imagekit.io/skillcapped/customss/jpg-images/wavectrl01.jpg",
    );
  });
});

describe("parseDate", () => {
  test("treats manifest timestamps as epoch milliseconds", () => {
    expect(parseDate(1_740_031_200_000).toISOString()).toBe(
      "2025-02-20T06:00:00.000Z",
    );
  });
});

describe("parseRole", () => {
  test("parses case-insensitively", () => {
    expect(parseRole("TOP")).toBe("top");
    expect(parseRole("adc")).toBe("adc");
  });

  test("throws on unknown roles", () => {
    expect(() => parseRole("assassin")).toThrow(/Unknown role/);
  });
});
