import { describe, expect, test, vi } from "vitest";
import { RiotBudgetLedger } from "#src/league/api/client/rate-budget.ts";
import type { BudgetRefusal } from "#src/league/api/client/rate-limiter.ts";
import {
  createLiveFormRiotApi,
  LiveFormBudgetDeferred,
} from "#src/live-roster/live-roster-form-riot.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { testPuuid } from "#src/testing/test-ids.ts";

const PUUID = testPuuid("stranger");

/** A window already full: 20 of 20 requests spent in the current second. */
function saturatedResponse(): Response {
  return new Response("[]", {
    status: 200,
    headers: {
      "x-app-rate-limit": "20:1",
      "x-app-rate-limit-count": "20:1",
    },
  });
}

describe("createLiveFormRiotApi", () => {
  test("a call the ledger will not admit gives up when the pass runs out of time, at backfill priority, and never sends", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(saturatedResponse()));
    const refusals: BudgetRefusal[] = [];
    const api = createLiveFormRiotApi({
      apiKey: "test-key",
      budgetMode: () => "enforce",
      signal: AbortSignal.timeout(150),
      onBudgetRefusal: (refusal) => refusals.push(refusal),
      fetchFn,
      ledger: new RiotBudgetLedger({ clock: Date.now }),
    });

    // The first read teaches the ledger the key is at its limit.
    await api.rankedMatchIds(PUUID, "AMERICAS", 5);
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // The second is refused: backfill may fill 60% of a window, and it is full.
    await expect(
      api.rankedMatchIds(PUUID, "AMERICAS", 5),
    ).rejects.toBeInstanceOf(LiveFormBudgetDeferred);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(refusals[0]).toMatchObject({
      priority: "backfill",
      outcome: "deferred",
    });
  });

  test("after the pass has ended, nothing is sent at all", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(saturatedResponse()));
    const controller = new AbortController();
    controller.abort();
    const api = createLiveFormRiotApi({
      apiKey: "test-key",
      budgetMode: () => "observe",
      signal: controller.signal,
      fetchFn,
      ledger: new RiotBudgetLedger({ clock: Date.now }),
    });

    await expect(
      api.match(RiotMatchIdSchema.parse("NA1_1"), "AMERICAS"),
    ).rejects.toBeInstanceOf(LiveFormBudgetDeferred);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
