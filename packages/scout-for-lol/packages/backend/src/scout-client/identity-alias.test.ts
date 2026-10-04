import { describe, expect, test } from "vitest";
import { ScoutClientObservationSchema } from "@scout-for-lol/data";
import {
  LCU_BOT_UUID,
  accountRouteFor,
  isLcuUuid,
  lcuIdentitiesIn,
  lcuUuidsIn,
  translatePayloadIdentities,
} from "./identity-alias.ts";
import { translateObservation } from "./observation-identity.ts";

const SELF_UUID = "1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b";
const FRIEND_UUID = "6a7b8c9d-0e1f-4203-9405-a6b7c8d9e0f1";
const SELF_PUUID = "s".repeat(78);
const FRIEND_PUUID = "f".repeat(78);

/** `/lol-summoner/v1/current-summoner`, as the client wraps it. */
const accountProfile = {
  resource: "account_profile",
  data: {
    puuid: SELF_UUID,
    gameName: "sjerred",
    tagLine: "sjerr",
    summonerId: 20_493_912,
  },
};

/** `/lol-match-history/v1/games/{id}` identities, including a bot slot. */
const gameIdentities = {
  participantIdentities: [
    {
      participantId: 1,
      player: { puuid: SELF_UUID, gameName: "sjerred", tagLine: "sjerr" },
    },
    {
      participantId: 2,
      player: { puuid: FRIEND_UUID, gameName: "Virmel", tagLine: "NA1" },
    },
    {
      participantId: 3,
      player: { puuid: LCU_BOT_UUID, gameName: "Sett Bot", tagLine: "" },
    },
  ],
};

/** `/lol-lobby/v2/lobby` members name a UUID but no tag line. */
const lobby = {
  resource: "lobby",
  data: { members: [{ puuid: FRIEND_UUID, summonerName: "Virmel" }] },
};

describe("League-client identities", () => {
  test("recognises a real account UUID and not the bot placeholder", () => {
    expect(isLcuUuid(SELF_UUID)).toBe(true);
    expect(isLcuUuid(LCU_BOT_UUID)).toBe(false);
    expect(isLcuUuid(SELF_PUUID)).toBe(false);
  });

  test("reads full identities from a profile and from game participants", () => {
    expect(lcuIdentitiesIn(accountProfile)).toEqual([
      { lcuUuid: SELF_UUID, gameName: "sjerred", tagLine: "sjerr" },
    ]);
    expect(lcuIdentitiesIn(gameIdentities)).toEqual([
      { lcuUuid: SELF_UUID, gameName: "sjerred", tagLine: "sjerr" },
      { lcuUuid: FRIEND_UUID, gameName: "Virmel", tagLine: "NA1" },
    ]);
  });

  test("cannot resolve a lobby member, who has no tag line", () => {
    expect(lcuIdentitiesIn(lobby)).toEqual([]);
    expect(lcuUuidsIn(lobby)).toEqual(new Set([FRIEND_UUID]));
  });

  test("translates every aliased identity and leaves the rest as they are", () => {
    const identities = new Map([[SELF_UUID, SELF_PUUID]]);

    expect(translatePayloadIdentities(gameIdentities, identities)).toEqual({
      participantIdentities: [
        {
          participantId: 1,
          player: { puuid: SELF_PUUID, gameName: "sjerred", tagLine: "sjerr" },
        },
        {
          participantId: 2,
          // No alias yet: kept, and so it can't equal any Riot PUUID.
          player: { puuid: FRIEND_UUID, gameName: "Virmel", tagLine: "NA1" },
        },
        {
          participantId: 3,
          player: { puuid: LCU_BOT_UUID, gameName: "Sett Bot", tagLine: "" },
        },
      ],
    });
  });

  test("translates replay-style PUUID keys too", () => {
    expect(
      translatePayloadIdentities(
        [{ PUUID: FRIEND_UUID }],
        new Map([[FRIEND_UUID, FRIEND_PUUID]]),
      ),
    ).toEqual([{ PUUID: FRIEND_PUUID }]);
  });

  test("routes account lookups by the platform the client reported", () => {
    expect(accountRouteFor("na1")).toBe("AMERICAS");
    expect(accountRouteFor("EUW1")).toBe("EUROPE");
    expect(accountRouteFor("OC1")).toBe("ASIA");
    expect(accountRouteFor(undefined)).toBe("AMERICAS");
  });
});

describe("translateObservation", () => {
  test("rewrites the observer and payload, leaving the original untouched", () => {
    const raw = ScoutClientObservationSchema.parse({
      protocolVersion: 1,
      schemaVersion: 1,
      observationId: "4fa2a856-53af-42a4-85af-5cc085a942a3",
      sequence: 1,
      capturedAt: "2026-10-03T12:00:00.000Z",
      appVersion: "0.1.0",
      kind: "post_game",
      localPuuid: SELF_UUID,
      gameId: "5653248720",
      payload: gameIdentities,
    });

    const translated = translateObservation(
      raw,
      new Map([
        [SELF_UUID, SELF_PUUID],
        [FRIEND_UUID, FRIEND_PUUID],
      ]),
    );

    expect(translated.localPuuid).toBe(SELF_PUUID);
    expect(lcuUuidsIn(translated.payload)).toEqual(new Set());
    expect(raw.localPuuid).toBe(SELF_UUID);
    expect(lcuUuidsIn(raw.payload)).toEqual(new Set([SELF_UUID, FRIEND_UUID]));
  });
});
