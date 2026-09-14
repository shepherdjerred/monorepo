import { describe, expect, test } from "vitest";
import {
  foldSightings,
  sightingsIn,
  splitRiotId,
  unknownShapeSightings,
} from "./extract.ts";

const A = `A${"a".repeat(77)}`;
const B = `B${"b".repeat(77)}`;

describe("sightingsIn — match", () => {
  test("pairs each participant's PUUID with the handle the payload recorded", () => {
    // The real shape, from games/2026/01/02/EUW1_7667855971/match.json.
    const sightings = sightingsIn("match", {
      metadata: { participants: [A, B] },
      info: {
        gameEndTimestamp: 1_700_000_000_000,
        participants: [
          { puuid: A, riotIdGameName: "Chilton", riotIdTagline: "bot" },
          { puuid: B, riotIdGameName: "Zozio8z", riotIdTagline: "EUW" },
        ],
      },
    });
    expect(sightings).toContainEqual({
      puuid: A,
      riotId: "Chilton#bot",
      at: 1_700_000_000_000,
    });
    expect(sightings).toContainEqual({
      puuid: B,
      riotId: "Zozio8z#EUW",
      at: 1_700_000_000_000,
    });
  });

  test("falls back to gameCreation when the game has no end stamp", () => {
    const [first] = sightingsIn("match", {
      info: {
        gameCreation: 42,
        participants: [{ puuid: A, riotIdGameName: "N", riotIdTagline: "T" }],
      },
    });
    expect(first?.at).toBe(42);
  });

  test("takes no handle from a half-present Riot ID", () => {
    // `Name#` cannot be resolved and would look real in the inventory.
    const [first] = sightingsIn("match", {
      info: {
        participants: [{ puuid: A, riotIdGameName: "N", riotIdTagline: "" }],
      },
    });
    expect(first?.riotId).toBeNull();
  });

  test("ignores anything that is not PUUID-shaped", () => {
    expect(
      sightingsIn("match", {
        metadata: { participants: ["short", 7, null, "x".repeat(77)] },
        info: {
          participants: [{ puuid: "also-short" }, { puuid: "y".repeat(79) }],
        },
      }),
    ).toEqual([]);
  });
});

describe("sightingsIn — prematch", () => {
  test("reads the combined riotId field spectator data uses", () => {
    const [first] = sightingsIn("prematch", {
      gameStartTime: 99,
      participants: [{ puuid: A, riotId: "Shen ra#8062" }],
    });
    expect(first).toEqual({ puuid: A, riotId: "Shen ra#8062", at: 99 });
  });

  test("rejects a riotId with no tag", () => {
    const [first] = sightingsIn("prematch", {
      participants: [{ puuid: A, riotId: "nohash" }],
    });
    expect(first?.riotId).toBeNull();
  });
});

describe("sightingsIn — timeline", () => {
  test("collects PUUIDs even though timelines carry no handle", () => {
    // Resolvable anyway: a timeline shares its match id with a match object.
    const sightings = sightingsIn("timeline", {
      metadata: { participants: [A] },
      info: { participants: [{ participantId: 1, puuid: A }] },
    });
    expect(sightings.every((s) => s.riotId === null)).toBe(true);
    expect(sightings.map((s) => s.puuid)).toEqual([A, A]);
  });
});

describe("unknownShapeSightings", () => {
  test("does not extract a PUUID-shaped substring from a longer token", () => {
    expect(unknownShapeSightings(`prefix ${"x".repeat(79)} suffix`)).toEqual(
      [],
    );
  });
});

describe("foldSightings", () => {
  test("the newest handle wins, because a rename makes older ones wrong", () => {
    const map = new Map<string, { riotId: string | null; at: number }>();
    foldSightings(map, [{ puuid: A, riotId: "Old#EUW", at: 100 }]);
    foldSightings(map, [{ puuid: A, riotId: "New#EUW", at: 200 }]);
    expect(map.get(A)).toEqual({ riotId: "New#EUW", at: 200 });
  });

  test("an older sighting does not overwrite a newer one", () => {
    const map = new Map<string, { riotId: string | null; at: number }>();
    foldSightings(map, [{ puuid: A, riotId: "New#EUW", at: 200 }]);
    foldSightings(map, [{ puuid: A, riotId: "Old#EUW", at: 100 }]);
    expect(map.get(A)?.riotId).toBe("New#EUW");
  });

  test("a handle-less sighting never displaces a known handle", () => {
    // Timelines produce these, and they must not erase what a match knew.
    const map = new Map<string, { riotId: string | null; at: number }>();
    foldSightings(map, [{ puuid: A, riotId: "Known#EUW", at: 100 }]);
    foldSightings(map, [{ puuid: A, riotId: null, at: 999 }]);
    expect(map.get(A)?.riotId).toBe("Known#EUW");
  });

  test("records an identity seen only without a handle", () => {
    const map = new Map<string, { riotId: string | null; at: number }>();
    foldSightings(map, [{ puuid: B, riotId: null, at: 0 }]);
    expect(map.has(B)).toBe(true);
    expect(map.get(B)?.riotId).toBeNull();
  });
});

describe("splitRiotId", () => {
  test("splits on the last hash, since a game name may contain spaces", () => {
    expect(splitRiotId("Shen ra#8062")).toEqual({
      gameName: "Shen ra",
      tagLine: "8062",
    });
  });

  test("refuses a malformed handle rather than inventing halves", () => {
    expect(splitRiotId("nohash")).toBeNull();
    expect(splitRiotId("#EUW")).toBeNull();
    expect(splitRiotId("Name#")).toBeNull();
  });
});
