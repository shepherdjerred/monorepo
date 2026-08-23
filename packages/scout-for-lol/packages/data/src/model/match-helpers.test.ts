import { describe, expect, test } from "vitest";
import { RawMatchSchema } from "#src/league/raw-match.schema.ts";
import type { RawParticipant } from "#src/league/raw-participant.schema.ts";
import { getTeams, participantToChampion } from "#src/model/match-helpers.ts";
import { toCustomLobby } from "#src/testing/custom-match-fixture.ts";

const TESTDATA_PATH = `${import.meta.dir}/../../../backend/src/league/model/__tests__/testdata/matches_2025_09_19_NA1_5370969615.json`;
// The only real 5v5 Summoner's Rift DTO in the repo; the matches_* fixtures are
// 16-player Arena.
const RIFT_PATH = `${import.meta.dir}/../../../../testdata/rift.json`;

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

async function riftMatch() {
  const raw: unknown = JSON.parse(await Bun.file(RIFT_PATH).text());
  return RawMatchSchema.parse(raw);
}

function puuidOf(participant: RawParticipant) {
  return participant.puuid;
}

function puuids(participants: RawParticipant[]) {
  return participants.map((participant) => puuidOf(participant));
}

describe("getTeams", () => {
  test("groups a blue-then-red 5v5 identically to the old positional slicing", async () => {
    const rift = await riftMatch();
    const all = rift.info.participants;

    const teams = getTeams(all, puuidOf);

    // The regression pin: this is exactly what slice(0,5)/slice(5,10) produced.
    expect(teams.blue).toEqual(puuids(all.slice(0, 5)));
    expect(teams.red).toEqual(puuids(all.slice(5, 10)));
  });

  test("groups correctly when Riot interleaves the sides", async () => {
    const rift = await riftMatch();
    const all = rift.info.participants;
    const interleaved = all.slice(0, 5).flatMap((blue, index) => {
      const red = all[index + 5];
      return red === undefined ? [blue] : [blue, red];
    });

    const teams = getTeams(interleaved, puuidOf);

    // Positional slicing would have filed 100,200,100,200,100 as "blue".
    expect(teams.blue).toEqual(puuids(all.slice(0, 5)));
    expect(teams.red).toEqual(puuids(all.slice(5, 10)));
  });

  test.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
    [3, 2],
  ])("handles a %ix%i lobby", async (blueCount, redCount) => {
    const custom = toCustomLobby(await riftMatch(), blueCount, redCount);

    const teams = getTeams(custom.info.participants, puuidOf);

    expect(teams.blue).toHaveLength(blueCount);
    expect(teams.red).toHaveLength(redCount);
  });

  test("drops a participant whose teamId is neither 100 nor 200", async () => {
    const rift = await riftMatch();
    const all = rift.info.participants;
    const first = all[0];
    if (first === undefined) throw new Error("no participants in fixture");
    const withStray = [{ ...first, teamId: 300 }, ...all.slice(1)];

    const teams = getTeams(withStray, puuidOf);

    // Dropped rather than misfiled. RosterSchema then rejects the short side,
    // so this cannot quietly produce a four-man report.
    expect(teams.blue).toHaveLength(4);
    expect(teams.red).toHaveLength(5);
  });
});
