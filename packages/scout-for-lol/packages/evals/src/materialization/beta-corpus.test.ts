import { describe, expect, test } from "bun:test";
import { PlayerConfigEntrySchema, RawMatchSchema } from "@scout-for-lol/data";

import {
  BetaCorpus,
  writeBetaCorpusSnapshot,
} from "#materialization/beta-corpus.ts";

describe("BetaCorpus", () => {
  test("preserves profiles when the same PUUID belongs to two guilds", async () => {
    const path = `/tmp/scout-beta-corpus-${crypto.randomUUID()}.sqlite`;
    const rawMatch: unknown = await Bun.file("../../testdata/rift.json").json();
    const match = RawMatchSchema.parse(rawMatch);
    const target = match.info.participants[0];
    const teammate = match.info.participants[1];
    if (target === undefined || teammate === undefined) {
      throw new Error("Raw match fixture must have at least two participants");
    }
    try {
      writeBetaCorpusSnapshot(
        path,
        [
          {
            accountId: 2,
            alias: "Jerred",
            discordId: "12345678901234567",
            playerId: 1,
            puuid: target.puuid,
            region: "AMERICA_NORTH",
            serverId: "23456789012345678",
          },
          {
            accountId: 4,
            alias: "Jerred Elsewhere",
            discordId: "34567890123456789",
            playerId: 3,
            puuid: target.puuid,
            region: "AMERICA_NORTH",
            serverId: "45678901234567890",
          },
          {
            accountId: 5,
            alias: "Teammate",
            discordId: null,
            playerId: 4,
            puuid: teammate.puuid,
            region: "AMERICA_NORTH",
            serverId: "23456789012345678",
          },
          {
            accountId: 6,
            alias: "Teammate Elsewhere",
            discordId: null,
            playerId: 5,
            puuid: teammate.puuid,
            region: "AMERICA_NORTH",
            serverId: "45678901234567890",
          },
        ],
        "scout-beta-pod:test-uid",
      );

      const corpus = new BetaCorpus(path);
      try {
        expect(corpus.getProfile(1, target.puuid)).toEqual(
          PlayerConfigEntrySchema.parse({
            alias: "Jerred",
            discordAccount: { id: "12345678901234567" },
            league: {
              leagueAccount: {
                puuid: target.puuid,
                region: "AMERICA_NORTH",
              },
            },
          }),
        );
        expect(corpus.getProfile(3, target.puuid)).toEqual(
          PlayerConfigEntrySchema.parse({
            alias: "Jerred Elsewhere",
            discordAccount: { id: "34567890123456789" },
            league: {
              leagueAccount: {
                puuid: target.puuid,
                region: "AMERICA_NORTH",
              },
            },
          }),
        );
        expect(
          corpus
            .profilesForMatch(match, 3, target.puuid)
            .map((profile) => profile.alias),
        ).toEqual(["Jerred Elsewhere", "Teammate Elsewhere"]);
        expect(() => corpus.profilesForMatch(match, 999, target.puuid)).toThrow(
          "Beta player 999 does not own account",
        );
        expect(corpus.getProfile(1, "missing")).toBeUndefined();
        expect(corpus.getProfile(999, target.puuid)).toBeUndefined();
      } finally {
        corpus.close();
      }
    } finally {
      await Bun.file(path).delete();
    }
  });
});
