import { describe, expect, test } from "vitest";
import { MatchIdSchema } from "@scout-for-lol/data";
import {
  buildMatchArtifactObjectKey,
  buildPrematchArtifactObjectKey,
} from "@scout-for-lol/domain/artifacts/object-key.ts";
import {
  IsoInstantSchema,
  RiotMatchIdSchema,
} from "@scout-for-lol/domain/identity/brands.ts";
import { generateS3Key } from "#src/storage/s3-helpers.ts";

/**
 * The live write path and the domain's object-key builder describe the same
 * layout, and this pins them together so a change to either has to be a change
 * to both.
 *
 * They are NOT interchangeable today, and the difference is the point of the
 * last test here: `generateS3Key` formats the date in the host's local zone
 * while the domain builder normalizes to UTC. The deployment sets
 * `TZ=America/Los_Angeles`, so the two disagree for any game created in the
 * Pacific evening. `vitest.config.ts` pins `TZ=UTC`, which is why the whole
 * suite agreed for so long and why that last test constructs the divergence
 * arithmetically instead of relying on the runner's zone.
 */

const MATCH_ID = "NA1_5370969615";
const CAPTURED_AT = "2026-03-10T02:30:00.000Z";

function domainMatchKey(assetName: string, extension: string): string {
  return buildMatchArtifactObjectKey({
    matchId: RiotMatchIdSchema.parse(MATCH_ID),
    assetName,
    extension,
    capturedAt: IsoInstantSchema.parse(CAPTURED_AT),
  });
}

describe("write-path and domain key builders agree", () => {
  test.each([
    ["match", "json"],
    ["timeline", "json"],
    ["report", "png"],
    ["report", "svg"],
  ])("agree for %s.%s", (assetName, extension) => {
    expect(
      generateS3Key(
        MatchIdSchema.parse(MATCH_ID),
        assetName,
        extension,
        new Date(CAPTURED_AT),
      ),
    ).toBe(domainMatchKey(assetName, extension));
  });

  test("both pad single-digit months and days", () => {
    const capturedAt = "2026-01-05T08:15:30.000Z";

    expect(
      generateS3Key(
        MatchIdSchema.parse(MATCH_ID),
        "match",
        "json",
        new Date(capturedAt),
      ),
    ).toBe(
      buildMatchArtifactObjectKey({
        matchId: RiotMatchIdSchema.parse(MATCH_ID),
        assetName: "match",
        extension: "json",
        capturedAt: IsoInstantSchema.parse(capturedAt),
      }),
    );
    expect(
      generateS3Key(
        MatchIdSchema.parse(MATCH_ID),
        "match",
        "json",
        new Date(capturedAt),
      ),
    ).toContain("/2026/01/05/");
  });

  test("the prematch namespace is separate from the match namespace", () => {
    const prematchKey = buildPrematchArtifactObjectKey({
      resourceId: "5370969615",
      assetName: "spectator-data",
      extension: "json",
      capturedAt: IsoInstantSchema.parse(CAPTURED_AT),
    });

    expect(prematchKey.startsWith("prematch/")).toBe(true);
    expect(domainMatchKey("match", "json").startsWith("games/")).toBe(true);
  });
});

describe("the local-versus-UTC divergence this layout still carries", () => {
  test("a Pacific-evening game lands on different days in the two builders", () => {
    // 18:30 Pacific on 2026-03-09 is 02:30 UTC on 2026-03-10. The domain
    // builder always says the 10th; the write path says whatever the host's
    // zone says, which under TZ=America/Los_Angeles is the 9th.
    const pacificEvening = new Date(CAPTURED_AT);
    const writePathKey = generateS3Key(
      MatchIdSchema.parse(MATCH_ID),
      "match",
      "json",
      pacificEvening,
    );
    const utcKey = domainMatchKey("match", "json");

    expect(utcKey).toContain("/2026/03/10/");

    // Derive the host's own answer rather than assuming a zone, so this test
    // states the invariant under every runner: the two builders agree exactly
    // when the host's local date equals the UTC date.
    const localDay = pacificEvening.getDate();
    const utcDay = pacificEvening.getUTCDate();
    if (localDay === utcDay) {
      expect(writePathKey).toBe(utcKey);
    } else {
      expect(writePathKey).not.toBe(utcKey);
    }
  });
});
