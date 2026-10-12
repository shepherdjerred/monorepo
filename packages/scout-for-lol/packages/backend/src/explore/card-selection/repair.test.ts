import { expect, test, vi } from "vitest";
import {
  EXPLORE_MAX_OUTPUT_TOKENS,
  EXPLORE_MAX_STEPS,
  ExploreMatchCardRequestSchema,
  ExploreLoadoutCardRequestSchema,
} from "@scout-for-lol/data";
import { repairExploreCardSelection } from "./repair.ts";
import { ExploreCardSelectionError } from "#src/explore-match/card-selection-error.ts";

const valid = ExploreMatchCardRequestSchema.parse({
  matchId: "NA1_5635906027",
  size: "S",
});
const unsupported = ExploreMatchCardRequestSchema.parse({
  matchId: "NA1_5635906026",
  size: "S",
});
const eligible = {
  eligibleMatchIds: new Set([valid.matchId]),
  eligibleLoadoutPairs: new Set<string>(),
};

test("an unsupported or stale card gets one correction using the remaining budget and same signal", async () => {
  const controller = new AbortController();
  const correct = vi.fn(async () => ({
    matchCards: [valid],
    loadoutCards: [],
  }));
  expect(
    await repairExploreCardSelection({
      ...eligible,
      selection: { matchCards: [unsupported], loadoutCards: [] },
      stepsUsed: 3,
      outputTokensUsed: 1000,
      abortSignal: controller.signal,
      correct,
    }),
  ).toEqual({ matchCards: [valid], loadoutCards: [] });
  expect(correct).toHaveBeenCalledOnce();
  expect(correct).toHaveBeenCalledWith(
    expect.objectContaining({
      failure: expect.any(ExploreCardSelectionError),
      maxOutputTokens: EXPLORE_MAX_OUTPUT_TOKENS - 1000,
      abortSignal: controller.signal,
    }),
  );
});

test("supported cards pass without another model call", async () => {
  const correct = vi.fn();
  const selection = { matchCards: [valid], loadoutCards: [] };
  expect(
    await repairExploreCardSelection({
      ...eligible,
      selection,
      stepsUsed: 3,
      outputTokensUsed: 1000,
      abortSignal: undefined,
      correct,
    }),
  ).toBe(selection);
  expect(correct).not.toHaveBeenCalled();
});

test("a participant outside the latest query requires an explicit model correction", async () => {
  const loadout = ExploreLoadoutCardRequestSchema.parse({
    matchId: valid.matchId,
    puuid: "9a7b7de0-ef0a-4efe-aec6-87e7e1e6f028",
    size: "S",
  });
  const correct = vi.fn(async () => ({
    matchCards: [valid],
    loadoutCards: [],
  }));
  expect(
    await repairExploreCardSelection({
      ...eligible,
      selection: { matchCards: [valid], loadoutCards: [loadout] },
      stepsUsed: 3,
      outputTokensUsed: 1000,
      abortSignal: undefined,
      correct,
    }),
  ).toEqual({ matchCards: [valid], loadoutCards: [] });
  expect(correct).toHaveBeenCalledWith(
    expect.objectContaining({
      failure: expect.objectContaining({ cardType: "loadout" }),
    }),
  );
});

test("a repeated invalid correction fails with the typed boundary error instead of retrying or discarding", async () => {
  const selection = { matchCards: [unsupported], loadoutCards: [] };
  const correct = vi.fn(async () => selection);
  await expect(
    repairExploreCardSelection({
      ...eligible,
      selection,
      stepsUsed: 3,
      outputTokensUsed: 1000,
      abortSignal: undefined,
      correct,
    }),
  ).rejects.toBeInstanceOf(ExploreCardSelectionError);
  expect(correct).toHaveBeenCalledOnce();
});

test.each([
  { stepsUsed: EXPLORE_MAX_STEPS, outputTokensUsed: 1000 },
  { stepsUsed: 3, outputTokensUsed: EXPLORE_MAX_OUTPUT_TOKENS },
])("exhausted turn budget prevents correction (%j)", async (budget) => {
  const correct = vi.fn();
  await expect(
    repairExploreCardSelection({
      ...eligible,
      ...budget,
      selection: { matchCards: [unsupported], loadoutCards: [] },
      abortSignal: undefined,
      correct,
    }),
  ).rejects.toBeInstanceOf(ExploreCardSelectionError);
  expect(correct).not.toHaveBeenCalled();
});

test("cancellation prevents a correction without replacing the deadline", async () => {
  const controller = new AbortController();
  const reason = new Error("turn deadline reached");
  controller.abort(reason);
  const correct = vi.fn();
  await expect(
    repairExploreCardSelection({
      ...eligible,
      selection: { matchCards: [unsupported], loadoutCards: [] },
      stepsUsed: 3,
      outputTokensUsed: 1000,
      abortSignal: controller.signal,
      correct,
    }),
  ).rejects.toBe(reason);
  expect(correct).not.toHaveBeenCalled();
});
