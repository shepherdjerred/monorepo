import { describe, expect, test } from "bun:test";
import { RawMatchSchema } from "@scout-for-lol/data/index.ts";
import { parseWithUnknownKeyFallback } from "#src/league/api/strict-with-loose-fallback.ts";

const TESTDATA_PATH = `${import.meta.dir}/../model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json`;

function injectKeyIntoEachParticipant(
  raw: unknown,
  key: string,
  value: unknown,
): number {
  if (raw === null || typeof raw !== "object") {
    throw new Error("payload is not an object");
  }
  const info = Reflect.get(raw, "info");
  if (info === null || typeof info !== "object") {
    throw new Error("payload has no info object");
  }
  const participants = Reflect.get(info, "participants");
  if (!Array.isArray(participants)) {
    throw new TypeError("payload has no participants array");
  }
  let count = 0;
  for (const participant of participants) {
    if (participant !== null && typeof participant === "object") {
      Reflect.set(participant, key, value);
      count += 1;
    }
  }
  return count;
}

describe("parseWithUnknownKeyFallback against real RawMatchSchema", () => {
  test("recovers from gameEndedInIGNBSurrender + teamIGNBSurrendered drift", async () => {
    const raw: unknown = JSON.parse(await Bun.file(TESTDATA_PATH).text());

    // Inject the two new Riot fields into every participant — same shape as
    // the prod ZodError we observed in scout-prod / scout-beta.
    const participantCount = injectKeyIntoEachParticipant(
      raw,
      "gameEndedInIGNBSurrender",
      false,
    );
    injectKeyIntoEachParticipant(raw, "teamIGNBSurrendered", false);

    const result = parseWithUnknownKeyFallback(RawMatchSchema, raw);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");

    // One path per (participant, key) pair
    const expectedCount = participantCount * 2;
    expect(result.unknownKeyPaths.length).toBe(expectedCount);
    expect(
      result.unknownKeyPaths.every(
        (p) =>
          p.endsWith(".gameEndedInIGNBSurrender") ||
          p.endsWith(".teamIGNBSurrendered"),
      ),
    ).toBe(true);
    expect(
      result.unknownKeyPaths.every((p) => p.startsWith("info.participants[")),
    ).toBe(true);

    // Parsed data preserved the legitimate fields
    expect(result.data.metadata.matchId).toBe("NA1_5370969615");
    expect(result.data.info.participants.length).toBeGreaterThan(0);
  });
});
