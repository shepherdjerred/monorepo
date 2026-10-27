import { createScoutPrematchActivities } from "#src/temporal/prematch/prematch-activities.ts";
import { RiotMatchIdSchema } from "@scout-for-lol/domain/identity/brands.ts";
import { expect, test } from "vitest";

test("a retained market Activity is a terminal no-op on every retry", async () => {
  const input = {
    stage: "dev" as const,
    riotMatchId: RiotMatchIdSchema.parse("NA1_7100000001"),
  };
  const { openPrematchMarkets } = createScoutPrematchActivities();
  const expected = {
    guard: { outcome: "already-applied" },
    fact: { outcome: "already-applied" },
    effects: 0,
  };
  expect(await openPrematchMarkets(input)).toEqual(expected);
  expect(await openPrematchMarkets(input)).toEqual(expected);
});
