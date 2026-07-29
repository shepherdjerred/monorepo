import { describe, expect, test } from "bun:test";
import { PlayerConfigEntrySchema } from "@scout-for-lol/data";

import {
  BetaCorpus,
  writeBetaCorpusSnapshot,
} from "#materialization/beta-corpus.ts";

describe("BetaCorpus", () => {
  test("stores a sanitized beta profile snapshot", async () => {
    const path = `/tmp/scout-beta-corpus-${crypto.randomUUID()}.sqlite`;
    const puuid = "p".repeat(78);
    try {
      writeBetaCorpusSnapshot(
        path,
        [
          {
            accountId: 2,
            alias: "Jerred",
            discordId: "12345678901234567",
            playerId: 1,
            puuid,
            region: "AMERICA_NORTH",
            serverId: "23456789012345678",
          },
        ],
        "scout-beta-pod:test-uid",
      );

      const corpus = new BetaCorpus(path);
      try {
        expect(corpus.getProfile(puuid)).toEqual(
          PlayerConfigEntrySchema.parse({
            alias: "Jerred",
            discordAccount: { id: "12345678901234567" },
            league: {
              leagueAccount: { puuid, region: "AMERICA_NORTH" },
            },
          }),
        );
        expect(corpus.getProfile("missing")).toBeUndefined();
      } finally {
        corpus.close();
      }
    } finally {
      await Bun.file(path).delete();
    }
  });
});
