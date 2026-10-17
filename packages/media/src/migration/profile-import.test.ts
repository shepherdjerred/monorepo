import { describe, expect, it } from "vitest";
import snapshot from "#migration/fixtures/resolved-profiles.json";
import sourceCases from "#migration/fixtures/source-parse.json";
import regexEvidence from "#migration/fixtures/regex-observations.json";
import {
  importResolvedProfiles,
  ProfileSnapshotSchema,
  reportProfileDrift,
} from "./profile-import.ts";
import { observedRegexMatcher } from "./regex-evidence.ts";
import { evaluateResolvedRelease } from "#domain/resolved-quality.ts";
import { createAdoptionReport } from "./adoption-report.ts";

describe("resolved source import", () => {
  it("preserves every live profile, custom format, quality definition and equal-rank group", () => {
    const reports = importResolvedProfiles(snapshot);
    expect(reports.map((item) => item.profiles.length)).toEqual([5, 3]);
    expect(reports.every((item) => !item.mayWrite)).toBe(true);
    const radarr = reports[0]?.profiles[0];
    expect(radarr?.customFormats).toHaveLength(41);
    expect(radarr?.qualityDefinitions).toHaveLength(30);
    expect(
      radarr?.profile.items.some(
        (item) => "id" in item && item.id === 1002 && item.items.length === 2,
      ),
    ).toBe(true);
  });

  it("uses stable observation hashes across capture timestamps and reports desired/live drift", () => {
    const first = importResolvedProfiles(snapshot);
    const second = importResolvedProfiles({
      ...snapshot,
      capturedAt: "2026-10-18T00:00:00.000Z",
    });
    expect(first.map((item) => item.snapshotHash)).toEqual(
      second.map((item) => item.snapshotHash),
    );
    for (const report of first) {
      expect(reportProfileDrift(report, { profileNames: ["Best"] })).toEqual({
        desiredMissing: ["Best"],
        observedUnscored: ["Best Available"],
      });
    }
  });

  it("protects unverified source versions and rejects dangling or duplicate source identities", () => {
    const changed = ProfileSnapshotSchema.parse(snapshot);
    const source = changed.inventories[0];
    if (source === undefined) throw new Error("Missing source fixture");
    source.version = "99.0.0";
    expect(importResolvedProfiles(changed)[0]?.protectedReasons).toContain(
      "source_version_not_verified",
    );
    expect(importResolvedProfiles(changed)[0]?.profiles).toEqual([]);
    source.profiles.push(
      source.profiles[0] ??
        (() => {
          throw new Error("Missing profile");
        })(),
    );
    expect(() => importResolvedProfiles(changed)).toThrow(
      "Duplicate profile ID",
    );
  });

  it("matches live source format decisions for all 16 releases across all 8 profiles", () => {
    const reports = importResolvedProfiles(snapshot);
    const matcher = observedRegexMatcher(regexEvidence);
    let comparisons = 0;
    for (const test of sourceCases.cases) {
      const report = reports.find((item) => item.source === test.source);
      if (report === undefined || test.matchedFormatIds === null)
        throw new Error("Incomplete source evidence");
      for (const profile of report.profiles) {
        const evaluation = evaluateResolvedRelease(
          profile,
          {
            id: test.title,
            qualityId: test.quality.quality.id,
            identityConfirmed: true,
            releaseTitle: test.releaseTitle,
            releaseGroup: test.releaseGroup,
            filename: "",
            sizeBytes: 20_000_000_000,
            runtimeMinutes: 100,
            audioLanguages: ["en"],
            originalLanguage: "en",
            revision: test.quality.revision,
            specialEpisode: false,
          },
          matcher,
        );
        const expected = profile.profile.formatItems.filter(
          (item) =>
            item.score !== 0 && test.matchedFormatIds.includes(item.format),
        );
        expect(evaluation.unknownFormats, test.title).toEqual([]);
        expect(
          evaluation.matchedFormats.toSorted((a, b) => a - b),
          test.title,
        ).toEqual(
          expected.map((item) => item.format).toSorted((a, b) => a - b),
        );
        expect(evaluation.score, test.title).toBe(
          expected.reduce((sum, item) => sum + item.score, 0),
        );
        comparisons += 1;
      }
    }
    expect(comparisons).toBe(64);
  });

  it("does not invent regex results and rejects conflicting evidence", () => {
    const matcher = observedRegexMatcher(regexEvidence);
    expect(matcher("unobserved", "input")).toBe("unknown");
    expect(() =>
      observedRegexMatcher({
        ...regexEvidence,
        observations: [
          { pattern: "a", value: "a", result: "match" },
          { pattern: "a", value: "a", result: "no_match" },
        ],
      }),
    ).toThrow("Conflicting regex observations");
  });
});

describe("read-only adoption evidence", () => {
  const asset = {
    source: "radarr",
    sourceInstance: "home",
    sourceId: 12,
    sourceMediaId: 42,
    externalIds: { tmdb: "438631" },
    path: "/data/movies/Dune/Dune.mkv",
    sizeBytes: 123_456,
    checksum: "a".repeat(64),
    qualityProfileId: 1,
    coverageExternalIds: ["tmdb:438631"],
    capturedAt: "2026-10-17T00:00:00.000Z",
  };
  it("keeps exact matches unowned until an explicit owner transfer", () => {
    const target = {
      mediaId: "dune",
      externalIds: { tmdb: "438631" },
      checksum: null,
    };
    const result = createAdoptionReport([asset], [target]);
    expect(result[0]).toMatchObject({
      state: "awaiting_owner_transfer",
      owned: false,
      mayWrite: false,
      candidateMediaIds: ["dune"],
    });
    expect(createAdoptionReport([asset], [target])).toEqual(result);
  });
  it("protects unknown checksums, ambiguous identity and overlapping source ownership", () => {
    const targets = ["one", "two"].map((mediaId) => ({
      mediaId,
      externalIds: { tmdb: "438631" },
      checksum: null,
    }));
    const results = createAdoptionReport(
      [
        { ...asset, checksum: null },
        { ...asset, sourceId: 13 },
      ],
      targets,
    );
    expect(results[0]?.reasons).toEqual([
      "identity_ambiguous",
      "checksum_unverified",
      "source_ownership_overlap",
    ]);
    expect(results.every((item) => item.state === "protected")).toBe(true);
  });
});
