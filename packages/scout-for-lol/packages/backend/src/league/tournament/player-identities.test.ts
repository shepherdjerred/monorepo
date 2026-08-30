import { describe, expect, test, vi } from "vitest";
import { LeaguePuuidSchema } from "@scout-for-lol/data/index.ts";
import { openLobby } from "#src/league/tournament/open-lobby-fixture.ts";

const resolvedPuuids: string[] = [];

vi.doMock("#src/lib/riot/account-riot-id.ts", () => ({
  getRiotIdByPuuid: async (puuid: string) => {
    resolvedPuuids.push(puuid);
    if (puuid.startsWith("b")) return null;
    return { gameName: "Joined Player", tagLine: "NA1" };
  },
}));

const { resolveLobbyPlayerNames } =
  await import("#src/league/tournament/player-identities.ts");

describe("open-lobby player enrichment", () => {
  test("renders every joined player as a Riot ID", async () => {
    const firstPuuid = LeaguePuuidSchema.parse("a".repeat(78));
    const secondPuuid = LeaguePuuidSchema.parse("c".repeat(78));

    await expect(
      resolveLobbyPlayerNames(openLobby([firstPuuid, secondPuuid])),
    ).resolves.toEqual(["Joined Player#NA1", "Joined Player#NA1"]);
    expect(resolvedPuuids).toEqual([firstPuuid, secondPuuid]);
  });

  test("uses the count-only card path rather than leaking or partially rendering PUUIDs", async () => {
    const resolvedPuuid = LeaguePuuidSchema.parse("a".repeat(78));
    const unresolvedPuuid = LeaguePuuidSchema.parse("b".repeat(78));

    await expect(
      resolveLobbyPlayerNames(openLobby([resolvedPuuid, unresolvedPuuid])),
    ).resolves.toBeUndefined();
  });
});
