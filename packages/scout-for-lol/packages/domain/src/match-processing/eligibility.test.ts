import { expect, test } from "vitest";
import {
  processingEligibility,
  LIVE_DISCOVERY_WINDOW_MS,
} from "./eligibility.ts";
import { promoteArchiveOnlyToFull } from "./transitions.ts";
import { MatchProcessingStateSchema } from "./states.ts";
import { IsoInstantSchema } from "#src/identity/brands.ts";

test("only ordinary first discoveries within fifteen minutes permit effects", () => {
  const completedAt = 1_800_000_000_000;
  expect(
    processingEligibility({
      historical: false,
      completedAt,
      discoveredAt: completedAt + LIVE_DISCOVERY_WINDOW_MS,
    }).policy,
  ).toBe("FULL");
  expect(
    processingEligibility({
      historical: false,
      completedAt,
      discoveredAt: completedAt + LIVE_DISCOVERY_WINDOW_MS + 1,
    }).policy,
  ).toBe("HISTORY_ONLY");
  expect(
    processingEligibility({
      historical: true,
      completedAt,
      discoveredAt: completedAt,
    }).policy,
  ).toBe("HISTORY_ONLY");
});

test("history-only cannot promote into effect processing", () => {
  const state = MatchProcessingStateSchema.parse({
    matchId: "NA1_42",
    owner: { kind: "temporal-v2" },
    policy: "HISTORY_ONLY",
    promotion: null,
    receipts: [],
  });
  expect(
    promoteArchiveOnlyToFull({
      state,
      promotedAt: IsoInstantSchema.parse("2026-10-13T00:00:00.000Z"),
    }),
  ).toEqual({ outcome: "conflict", reason: "history-only-is-permanent" });
});
