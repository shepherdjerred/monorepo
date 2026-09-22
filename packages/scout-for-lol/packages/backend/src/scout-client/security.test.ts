import { describe, expect, test } from "vitest";
import { ScoutClientObservationSchema } from "@scout-for-lol/data";
import {
  nextScoutClientObservationSequence,
  observationQuarantineReason,
} from "./ingress.ts";
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
        new Set(["0.1.0"]),
        NOW,
      ),
    ).toBeNull();
  });

  test("quarantines a payload that does not attest its observer", () => {
    expect(
      observationQuarantineReason(
        observation({ participants: [{ puuid: "someone-else" }] }),
        new Set([PUUID]),
        new Set(["0.1.0"]),
        NOW,
      ),
    ).toBe("observer_puuid_not_in_payload");
  });

  test("quarantines a PUUID not linked to the paired Discord user", () => {
    expect(
      observationQuarantineReason(
        observation({ participants: [{ puuid: PUUID }] }),
        new Set(),
        new Set(["0.1.0"]),
        NOW,
      ),
    ).toBe("unverified_local_puuid");
  });

  test("accepts an observation from an authenticated pre-upgrade version", () => {
    expect(
      observationQuarantineReason(
        observation({ participants: [{ puuid: PUUID }] }),
        new Set([PUUID]),
        new Set(["0.1.0", "0.2.0"]),
        NOW,
      ),
    ).toBeNull();
  });

  test("quarantines an app version that never authenticated", () => {
    expect(
      observationQuarantineReason(
        observation({ participants: [{ puuid: PUUID }] }),
        new Set([PUUID]),
        new Set(["0.2.0"]),
        NOW,
      ),
    ).toBe("unverified_app_version");
  });

  test("classifies a future timestamp as a correctable clock quarantine", () => {
    const future = {
      ...observation({ participants: [{ puuid: PUUID }] }),
      capturedAt: new Date(NOW.getTime() + 6 * 60 * 1000).toISOString(),
    };
    expect(
      observationQuarantineReason(
        future,
        new Set([PUUID]),
        new Set(["0.1.0"]),
        NOW,
      ),
    ).toBe("future_timestamp");
  });

  test("advances a restored device beyond the backend high-water mark", () => {
    expect(nextScoutClientObservationSequence(null)).toBe(1);
    expect(nextScoutClientObservationSequence(41n)).toBe(42);
    expect(() =>
      nextScoutClientObservationSequence(BigInt(Number.MAX_SAFE_INTEGER)),
    ).toThrow("sequence is exhausted");
  });
});
