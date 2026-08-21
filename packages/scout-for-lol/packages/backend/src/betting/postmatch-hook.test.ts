import { describe, expect, test } from "vitest";
import { refreshSettledPoolMessages } from "#src/betting/postmatch-hook.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";

describe("refreshSettledPoolMessages", () => {
  test("removes straight-bet controls once even when no outcome is announced", async () => {
    const settlement: SettlementSummary = {
      matchId: "NA1_123",
      serverId: "guild-one",
      winningTeamId: 100,
      voidReason: undefined,
      winnersPool: 100,
      losersPool: 50,
      houseCut: 5,
      bets: [],
    };
    const refreshed: (readonly {
      matchId: string;
      serverId: string;
    }[])[] = [];

    await refreshSettledPoolMessages(
      [settlement, settlement],
      [],
      (pools) => {
        refreshed.push(pools);
        return Promise.resolve();
      },
      () => Promise.resolve(),
    );

    expect(refreshed).toEqual([[settlement]]);
  });
});
