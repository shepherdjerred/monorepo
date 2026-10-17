import { describe, it, expect } from "vitest";
import snapshot from "#migration/fixtures/resolved-profiles.json";
import cases from "#migration/fixtures/source-parse.json";
import { importResolvedProfiles } from "./profile-import.ts";
import { parseResolvedScene } from "#domain/resolved-parser.ts";

describe("verified source scene subset", () => {
  it("matches source quality, normalized title, release group and revisions for all captured parse cases", () => {
    for (const item of cases.cases) {
      const profile = importResolvedProfiles(snapshot).find(
        (report) => report.source === item.source,
      )?.profiles[0];
      if (profile === undefined) throw new Error("Fixture profile missing");
      const parsed = parseResolvedScene(profile, item.title);
      expect(parsed.reasons, item.title).toEqual([]);
      expect(parsed.qualityId, item.title).toBe(item.quality.quality.id);
      expect(parsed.releaseTitle, item.title).toBe(item.releaseTitle);
      expect(parsed.releaseGroup, item.title).toBe(item.releaseGroup);
      expect(parsed.revision, item.title).toEqual({
        version: item.quality.revision.version,
        real: item.quality.revision.real,
      });
    }
  });
  it("protects conflicting sources, unknown editions, anime and site prefixes instead of guessing", () => {
    const profile = importResolvedProfiles(snapshot)[0]?.profiles[0];
    if (profile === undefined) throw new Error("Fixture profile missing");
    for (const title of [
      "Dune.2021.1080p.WEB-DL.BluRay.H264-GROUP",
      "Dune.2021.1080p.720p.WEB-DL.H264-GROUP",
      "Dune.2021.EXTENDED.1080p.WEB-DL.H264-GROUP",
      "[GROUP] Dune - 01 [1080p]",
      "[site.example] Dune.2021.1080p.WEB-DL.H264-GROUP",
      "Dune.2021.1080p.WEB-DL.PROPER.REPACK-GROUP",
    ])
      expect(parseResolvedScene(profile, title).reasons, title).toEqual([
        "source_parse_unsupported",
      ]);
  });
});
