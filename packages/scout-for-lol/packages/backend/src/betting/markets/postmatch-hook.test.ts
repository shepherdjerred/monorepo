import { describe, expect, test, vi } from "vitest";
import {
  refreshPendingDareV2CalloutsWithoutBlocking,
  refreshSettledPoolMessages,
} from "#src/betting/markets/postmatch-hook.ts";
import type { SettlementSummary } from "#src/betting/settle.ts";
import { defaultDareV2CalloutDependencies } from "#src/betting/dares/presentation/dare-callout-v2.ts";

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

describe("refreshPendingDareV2CalloutsWithoutBlocking", () => {
  test("does not discard settlement results when Discord editing fails", async () => {
    const refresh = vi.fn(() =>
      Promise.reject(new Error("Discord message was deleted")),
    );

    await expect(
      refreshPendingDareV2CalloutsWithoutBlocking(
        defaultDareV2CalloutDependencies,
        refresh,
      ),
    ).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
