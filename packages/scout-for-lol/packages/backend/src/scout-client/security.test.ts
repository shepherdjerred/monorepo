import { describe, expect, test } from "vitest";
import { ScoutClientObservationSchema } from "@scout-for-lol/data";
import { observationQuarantineReason } from "./ingress.ts";
import { digestMatches, randomSecret, secretDigest } from "./secrets.ts";

const NOW = new Date("2026-09-20T12:00:00Z");
const PUUID = "test-puuid";

function observation(payload: unknown) {
  return ScoutClientObservationSchema.parse({
    protocolVersion: 1,
    schemaVersion: 1,
    observationId: "4fa2a856-53af-42a4-85af-5cc085a942a3",
    sequence: 1,
    capturedAt: NOW.toISOString(),
    appVersion: "0.1.0",
    kind: "post_game",
    localPuuid: PUUID,
    gameId: "123456",
    payload,
  });
}

describe("Scout Client ingress security", () => {
  test("stores only digests that verify the original secret", () => {
    const secret = randomSecret("sct_");
    const digest = secretDigest(secret);
    expect(digest).not.toContain(secret);
    expect(digestMatches(secret, digest)).toBe(true);
    expect(digestMatches(`${secret}x`, digest)).toBe(false);
  });

  test("accepts a verified observer present in post-game participants", () => {
    expect(
      observationQuarantineReason(
        observation({ participants: [{ puuid: PUUID }] }),
        new Set([PUUID]),
        "0.1.0",
        NOW,
      ),
    ).toBeNull();
  });

  test("quarantines a payload that does not attest its observer", () => {
    expect(
      observationQuarantineReason(
        observation({ participants: [{ puuid: "someone-else" }] }),
        new Set([PUUID]),
        "0.1.0",
        NOW,
      ),
    ).toContain("does not appear");
  });

  test("quarantines a PUUID not linked to the paired Discord user", () => {
    expect(
      observationQuarantineReason(
        observation({ participants: [{ puuid: PUUID }] }),
        new Set(),
        "0.1.0",
        NOW,
      ),
    ).toContain("not linked");
  });
});
