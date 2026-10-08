import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  lcuUuidsIn,
  translatePayloadIdentities,
} from "#src/scout-client/identity-alias.ts";
import { convertLcuMatchBundle } from "./lcu-match.ts";

const FixtureSchema = z
  .object({
    matchHistory: z.object({ gameDuration: z.number() }).loose(),
    endOfGame: z.unknown(),
    timeline: z.unknown(),
  })
  .strict();

/**
 * A real ranked game as the Scout Client bundles it — `games/{id}`, the
 * end-of-game block, and `game-timelines/{id}` — redacted: every player UUID
 * is a stable fake, every name a placeholder, and the chat credentials the
 * League client includes are gone.
 */
async function rankedBundle() {
  const raw = await Bun.file(
    new URL(
      "../../../../../testdata/lcu/lcu-postgame-ranked.json",
      import.meta.url,
    ),
  ).json();
  const identities = new Map(
    [...lcuUuidsIn(raw)].map((uuid) => [uuid, `${uuid}-${"p".repeat(41)}`]),
  );
  const bundle = FixtureSchema.parse(
    translatePayloadIdentities(raw, identities),
  );
  const start = 1_790_000_000_000;
  return {
    ...bundle,
    timing: {
      gameStartTimestamp: start,
      gameEndTimestamp: start + bundle.matchHistory.gameDuration * 1000,
    },
  };
}

describe("convertLcuMatchBundle", () => {
  test("converts a real ranked game with every participant", async () => {
    const match = convertLcuMatchBundle(
      RiotMatchIdSchema.parse("NA1_5654104474"),
      await rankedBundle(),
    );

    expect(match).not.toBeNull();
    expect(match?.metadata.dataVersion).toBe("local-1");
    expect(match?.info.queueId).toBe(420);
    expect(match?.info.participants).toHaveLength(10);
    expect(match?.metadata.participants).toHaveLength(10);
    expect(match?.info.teams.map((team) => team.win).toSorted()).toEqual([
      false,
      true,
    ]);
  });

  test("names champions by their Match-V5 key, not the display name", async () => {
    const match = convertLcuMatchBundle(
      RiotMatchIdSchema.parse("NA1_5654104474"),
      await rankedBundle(),
    );
    const wukong = match?.info.participants.find(
      (participant) => participant.championId === 62,
    );

    expect(wukong?.championName).toBe("MonkeyKing");
  });

  test("keeps the rune page and leaves the unreported stat shards absent", async () => {
    const match = convertLcuMatchBundle(
      RiotMatchIdSchema.parse("NA1_5654104474"),
      await rankedBundle(),
    );
    const perks = match?.info.participants[0]?.perks;

    expect(perks?.styles).toHaveLength(2);
    expect(perks?.styles[0]?.selections).toHaveLength(4);
    expect(perks?.statPerks).toBeUndefined();
  });

  test("states which team took the first Rift Herald", async () => {
    const match = convertLcuMatchBundle(
      RiotMatchIdSchema.parse("NA1_5654104474"),
      await rankedBundle(),
    );
    const firsts =
      match?.info.teams.filter((team) => team.objectives.riftHerald.first) ??
      [];

    expect(firsts.length).toBeLessThanOrEqual(1);
    for (const team of firsts) {
      expect(team.objectives.riftHerald.kills).toBeGreaterThan(0);
    }
  });

  test("refuses a bundle whose players have no alias yet", async () => {
    const raw = await Bun.file(
      new URL(
        "../../../../../testdata/lcu/lcu-postgame-ranked.json",
        import.meta.url,
      ),
    ).json();

    expect(
      convertLcuMatchBundle(RiotMatchIdSchema.parse("NA1_5654104474"), {
        ...FixtureSchema.parse(raw),
        timing: { gameStartTimestamp: 1, gameEndTimestamp: 2 },
      }),
    ).toBeNull();
  });
});
