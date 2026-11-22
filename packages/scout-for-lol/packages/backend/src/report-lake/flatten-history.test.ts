import { expect, test } from "vitest";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { z } from "zod";
import { convertHistoryMatch } from "#src/scout-client/canonical/history-match.ts";
import { flattenMatch } from "./flatten.ts";

async function fixture(name: string): Promise<unknown> {
  return await Bun.file(
    new URL(`../../../../testdata/lcu/${name}.json`, import.meta.url),
  ).json();
}

const GameSchema = z.looseObject({
  gameId: z.number(),
  participantIdentities: z.array(
    z.looseObject({ player: z.looseObject({ puuid: z.string() }) }),
  ),
});

test("a history record's lake rows say history and leave the unstated columns NULL", async () => {
  const game = GameSchema.parse(await fixture("lcu-game-aram-mayhem"));
  const observer = "o".repeat(78);
  const match = convertHistoryMatch(
    RiotMatchIdSchema.parse(`NA1_${game.gameId.toString()}`),
    {
      matchHistory: {
        ...game,
        participantIdentities: game.participantIdentities.map(
          (identity, index) =>
            index === 0
              ? { ...identity, player: { ...identity.player, puuid: observer } }
              : identity,
        ),
      },
      timeline: await fixture("lcu-timeline-aram-mayhem"),
    },
  );
  if (match === null) throw new Error("History fixture did not convert");
  const rows = flattenMatch(match);
  expect(rows).toHaveLength(10);
  for (const row of rows) {
    expect(row.coverage).toBe("history");
    expect(row.data_source).toBe("SCOUT_CLIENT");
    expect(row.time_played).toBeNull();
    expect(row.basic_pings).toBeNull();
    expect(row.baron_kills).toBeNull();
    expect(row.kills).toEqual(expect.any(Number));
  }
  expect(rows.filter((row) => row.participant_kind === "player")).toHaveLength(
    1,
  );
});
