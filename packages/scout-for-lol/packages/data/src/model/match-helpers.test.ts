import { describe, expect, test } from "bun:test";
import { RawMatchSchema } from "#src/league/raw-match.schema.ts";
import { participantToChampion } from "#src/model/match-helpers.ts";

const TESTDATA_PATH = `${import.meta.dir}/../../../backend/src/league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json`;

function setNestedString(
  raw: unknown,
  path: readonly (string | number)[],
  value: string,
): void {
  let node: unknown = raw;
  for (let i = 0; i < path.length - 1; i += 1) {
    if (node === null || typeof node !== "object") {
      throw new Error(`bad fixture: cannot traverse to ${path.join(".")}`);
    }
    const segment = path[i];
    if (segment === undefined) throw new Error("undefined path segment");
    node = Reflect.get(node, segment);
  }
  if (node === null || typeof node !== "object") {
    throw new Error(`bad fixture: target is not an object`);
  }
  const last = path.at(-1);
  if (last === undefined) throw new Error("empty path");
  Reflect.set(node, last, value);
}

describe("participantToChampion", () => {
  test("normalizes Riot casing quirk in championName (FiddleSticks → Fiddlesticks)", async () => {
    const raw: unknown = JSON.parse(await Bun.file(TESTDATA_PATH).text());
    // Simulate the actual Riot match-data quirk that hit production.
    setNestedString(
      raw,
      ["info", "participants", 0, "championName"],
      "FiddleSticks",
    );

    const parsed = RawMatchSchema.parse(raw);
    const firstParticipant = parsed.info.participants[0];
    if (!firstParticipant) throw new Error("no participants in fixture");

    const champion = participantToChampion(firstParticipant);
    expect(champion.championName).toBe("Fiddlesticks");
  });

  test("leaves canonical names unchanged", async () => {
    const raw: unknown = JSON.parse(await Bun.file(TESTDATA_PATH).text());
    setNestedString(raw, ["info", "participants", 0, "championName"], "Aatrox");
    const parsed = RawMatchSchema.parse(raw);
    const firstParticipant = parsed.info.participants[0];
    if (!firstParticipant) throw new Error("no participants in fixture");
    expect(participantToChampion(firstParticipant).championName).toBe("Aatrox");
  });
});
