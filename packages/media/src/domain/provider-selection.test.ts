import { expect, test } from "vitest";
import {
  compareProviderCandidates,
  evaluateProviderSelection,
} from "./provider-selection.ts";

const base = {
  policy: {
    priority: 1,
    minimumSeeders: 1,
    delaySeconds: 900,
    bypassAtHighestQuality: true,
  },
  seeders: 1,
  firstSeenAt: 0,
  now: 1000,
  qualityRank: 1,
  highestQualityRank: 2,
  rejected: false,
};
test("release delay waits 15 minutes with a highest allowed quality bypass", () => {
  expect(evaluateProviderSelection(base)).toEqual({
    accepted: false,
    reason: "release_delay_pending",
    eligibleAt: 900_000,
  });
  expect(evaluateProviderSelection({ ...base, now: 900_000 }).accepted).toBe(
    true,
  );
  expect(evaluateProviderSelection({ ...base, qualityRank: 2 }).accepted).toBe(
    true,
  );
});
test("unknown/zero seeders and a previously rejected source cannot use the quality bypass", () => {
  for (const seeders of [null, 0])
    expect(
      evaluateProviderSelection({ ...base, qualityRank: 2, seeders }).reason,
    ).toBe("minimum_seeders_not_met");
  expect(
    evaluateProviderSelection({ ...base, qualityRank: 2, rejected: true })
      .reason,
  ).toBe("release_previously_rejected");
});
test("private priority breaks equal quality and score ties without overriding quality", () => {
  const candidates = [
    { id: "public", rank: 2, score: 30, priority: 25 },
    { id: "private", rank: 2, score: 30, priority: 1 },
    { id: "lower", rank: 1, score: 300, priority: 1 },
  ];
  expect(
    candidates.sort(compareProviderCandidates).map((item) => item.id),
  ).toEqual(["private", "public", "lower"]);
});
