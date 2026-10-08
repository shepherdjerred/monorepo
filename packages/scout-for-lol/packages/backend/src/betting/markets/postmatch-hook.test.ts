import {
  RiotMatchIdSchema,
  type RiotMatchId,
} from "@scout-for-lol/domain/identity/brands.ts";
import { describe, expect, test, vi } from "vitest";
import { BucksPoolTotalSchema } from "@scout-for-lol/data";
import {
  refreshPendingDareV2CalloutsWithoutBlocking,
  refreshSettledPoolMessages,
} from "#src/betting/markets/postmatch-hook.ts";
import type { SettlementSummary } from "#src/betting/settlement/settlement-types.ts";
import { defaultDareCalloutDependencies } from "#src/betting/dares/presentation/dare-callout.ts";

describe("refreshSettledPoolMessages", () => {
  test("removes straight-bet controls once even when no outcome is announced", async () => {
    const settlement: SettlementSummary = {
      matchId: RiotMatchIdSchema.parse("NA1_123"),
      serverId: "guild-one",
      winningTeamId: 100,
      voidReason: undefined,
      winnersPool: BucksPoolTotalSchema.parse(100),
      losersPool: BucksPoolTotalSchema.parse(50),
      houseCut: BucksPoolTotalSchema.parse(5),
      bets: [],
    };
    const refreshed: (readonly {
      matchId: RiotMatchId;
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
        defaultDareCalloutDependencies,
        refresh,
      ),
    ).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
