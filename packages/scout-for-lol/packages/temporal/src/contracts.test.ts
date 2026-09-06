import { describe, expect, test } from "vitest";
import { PostMatchDiscoveryResultSchema } from "./contracts.ts";

describe("post-match discovery result puuid validation", () => {
  test("accepts a Riot PUUID that starts with an underscore", () => {
    // Real incident: base64url-derived PUUIDs may start with `_` or `-`.
    // A schema that assumes an alphanumeric first character throws on every
    // replay of the workflow that parses this, wedging it forever.
    const sourcePuuid =
      "_UiFP1VZrFut5_6UFe-ksTFBQnBO-tj3YZuwfdcg59Qm2kq-8FW1uD7eAuH-muhhBaNppwZcknUv4A";
    expect(
      PostMatchDiscoveryResultSchema.parse({
        matches: [
          {
            matchId: "NA1_5635515108",
            sourcePuuid,
            region: "AMERICA_NORTH",
            delivery: "live",
          },
        ],
      }).matches[0]?.sourcePuuid,
    ).toBe(sourcePuuid);
  });
});

describe("post-match discovery result compatibility", () => {
  test("treats pre-field activity completions as complete evidence", () => {
    expect(
      PostMatchDiscoveryResultSchema.parse({ matches: [] }).evidenceComplete,
    ).toBe(true);
  });

  test("preserves an explicit incomplete-evidence barrier", () => {
    expect(
      PostMatchDiscoveryResultSchema.parse({
        matches: [],
        evidenceComplete: false,
      }).evidenceComplete,
    ).toBe(false);
  });

  test("preserves the completion watermark for deadline settlement", () => {
    expect(
      PostMatchDiscoveryResultSchema.parse({
        matches: [],
        evidenceComplete: true,
        evidenceWatermark: "2026-09-01T16:00:00.000Z",
      }).evidenceWatermark,
    ).toBe("2026-09-01T16:00:00.000Z");
  });
});
