import { describe, it, expect } from "vitest";
import snapshot from "#migration/fixtures/resolved-profiles.json";
import cases from "#migration/fixtures/source-parse.json";
import observations from "#migration/fixtures/regex-observations.json";
import { importResolvedProfiles } from "./profile-import.ts";
import { prepareResolvedEvidence, regexRequests } from "./runtime-evidence.ts";
import { evaluateRelease, chooseUpgrade } from "#domain/quality.ts";
import type { QualityProfile, ReleaseAttributes } from "#shared/contract.ts";
import { runRegexMatcher } from "./regex-process.ts";

function legacyEnvelope(
  resolved: NonNullable<QualityProfile["resolved"]>,
): QualityProfile {
  return {
    id: "profile",
    version: 1,
    resolved,
    qualities: ["ignored"],
    rejectedCodecs: [],
    requiredAudioLanguages: [],
    minimumBytes: 0,
    maximumBytes: 1,
    minimumScore: 999_999,
    tagScores: {},
    cutoffQuality: "ignored",
    cutoffScore: 999_999,
  };
}
describe("production resolved policy dispatch", () => {
  it("uses source parser plus exact regex observations through the real legacy-shaped policy entrypoint", () => {
    let compared = 0;
    for (const item of cases.cases) {
      const report = importResolvedProfiles(snapshot).find(
        (entry) => entry.source === item.source,
      );
      if (report === undefined) throw new Error("Missing fixture");
      for (const resolved of report.profiles) {
        const evidence = prepareResolvedEvidence(resolved, {
          id: "release",
          title: item.title,
          identityConfirmed: true,
          sizeBytes: 20_000_000_000,
          runtimeMinutes: 100,
          originalLanguage: "en",
          audioLanguages: ["en"],
          specialEpisode: false,
        });
        evidence.regex.observations = observations.observations.map(
          (entry) => ({
            ...entry,
            result:
              entry.result === "match"
                ? "match"
                : entry.result === "no_match"
                  ? "no_match"
                  : "unknown",
          }),
        );
        const candidate: ReleaseAttributes = {
          id: "release",
          title: item.title,
          providerId: "fixture",
          mediaIds: ["movie"],
          identityConfidence: "exact",
          quality: "ignored",
          codec: "H264",
          audioLanguages: ["en"],
          sizeBytes: 20_000_000_000,
          scoreTags: [],
          resolvedEvidence: evidence,
        };
        const result = evaluateRelease(candidate, legacyEnvelope(resolved), [
          "movie",
        ]);
        const expected = resolved.profile.formatItems.filter((format) =>
          item.matchedFormatIds.includes(format.format),
        );
        expect(result.score, item.title).toBe(
          expected.reduce((score, format) => score + format.score, 0),
        );
        expect(result.reasons).not.toContain("resolved_custom_format_unknown");
        expect(
          evaluateRelease(candidate, legacyEnvelope(resolved), ["other"])
            .accepted,
        ).toBe(false);
        if (regexRequests(resolved, evidence.release).length > 0) {
          evidence.regex.observations = [];
          expect(
            chooseUpgrade({
              candidate,
              current: null,
              profile: legacyEnvelope(resolved),
              mediaIds: ["movie"],
            }).upgrade,
          ).toBe(false);
        }
        compared += 1;
      }
    }
    expect(compared).toBe(64);
  });
  it("executes a validated child protocol on Node APIs and rejects runtime culture drift without leaking stderr", async () => {
    const response = {
      protocolVersion: 1,
      engine: "dotnet-ignorecase",
      runtimeVersion: "10.0.11",
      culture: "en-US",
      observations: [],
    };
    const command = [
      process.execPath,
      "-e",
      `process.stdin.resume(); process.stdin.on('end', () => process.stdout.write(${JSON.stringify(JSON.stringify(response))}));`,
    ];
    expect(await runRegexMatcher(command, [])).toEqual(response);
    await expect(
      runRegexMatcher(
        [
          process.execPath,
          "-e",
          "process.stderr.write('private fixture detail');process.exit(3)",
        ],
        [],
      ),
    ).rejects.toThrow(
      /Regex (?:input pipe failed|matcher failed with exit code 3)/u,
    );
    await expect(
      runRegexMatcher(
        [
          process.execPath,
          "-e",
          `process.stdin.resume(); process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(JSON.stringify({ ...response, culture: "tr-TR" }))}));`,
        ],
        [],
      ),
    ).rejects.toThrow("Regex culture mismatch");
  });
});
