import { describe, expect, test } from "vitest";
import { RawMatchSchema } from "@scout-for-lol/data/index.ts";

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

describe("RawMatchSchema with additive Riot fields", () => {
  test("preserves gameEndedInIGNBSurrender + teamIGNBSurrendered drift", async () => {
    const raw: unknown = JSON.parse(await Bun.file(TESTDATA_PATH).text());

    // Inject the two newer Riot fields into every participant.
    const participantCount = injectKeyIntoEachParticipant(
      raw,
      "gameEndedInIGNBSurrender",
      false,
    );
    injectKeyIntoEachParticipant(raw, "teamIGNBSurrendered", false);

    const result = RawMatchSchema.safeParse(raw);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");

    // The new Riot fields and the known fields remain available to consumers.
    expect(result.data.metadata.matchId).toBe("NA1_5370969615");
    expect(result.data.info.participants.length).toBeGreaterThan(0);
    expect(
      result.data.info.participants
        .slice(0, participantCount)
        .every(
          (participant) =>
            Reflect.get(participant, "gameEndedInIGNBSurrender") === false &&
            Reflect.get(participant, "teamIGNBSurrendered") === false,
        ),
    ).toBe(true);
  });
});
