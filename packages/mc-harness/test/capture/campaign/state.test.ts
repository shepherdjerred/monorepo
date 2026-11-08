import { expect, it } from "vitest";
import {
  executeCampaign,
  replayCampaign,
  validateCampaign,
  validatePlan,
  type Campaign,
  type Batch,
} from "#src/capture/campaign/state.ts";
import type { SuiteRun } from "#src/capture/suite/archive.ts";

function pending(): Campaign {
  return validateCampaign({
    schema: 1,
    id: crypto.randomUUID(),
    suite: "test",
    fixture: "a".repeat(64),
    runtime: null,
    replay: null,
    scope: "all",
    batches: [
      { ids: ["first", "second"], fresh: false, replayOf: null, run: null },
      { ids: ["venue"], fresh: true, replayOf: null, run: null },
    ],
  });
}
function result(part: Batch): SuiteRun {
  return {
    schema: 1,
    id: crypto.randomUUID(),
    suite: "test",
    suiteFile: "packages/the-storm/tools/captures/suite.ts",
    fixture: "a".repeat(64),
    runtime: "b".repeat(64),
    rollout: "c".repeat(64),
    selection: { scenario: part.ids.join(",") },
    scenarios: part.ids.map((id) => ({ id, archive: "d".repeat(64) })),
  };
}
it("keeps completed batches after a failure and resumes only the pending venue with the pinned runtime", async () => {
  let saved = pending();
  await expect(
    executeCampaign(
      saved,
      (state) => {
        saved = state;
        return Promise.resolve();
      },
      (part) => {
        if (part.fresh) throw new Error("Native assertion failed");
        return Promise.resolve(result(part));
      },
    ),
  ).rejects.toThrow("Native assertion failed");
  const shared = saved.batches[0]?.run;
  expect(shared?.runtime).toBe("b".repeat(64));
  expect(saved.batches[1]?.run).toBeNull();
  const invoked: string[][] = [];
  const complete = await executeCampaign(
    saved,
    () => Promise.resolve(),
    (part, baseline) => {
      invoked.push(part.ids);
      expect(baseline).toBe(shared?.id);
      return Promise.resolve(result(part));
    },
  );
  expect(invoked).toEqual([["venue"]]);
  expect(complete.batches[0]?.run).toEqual(shared);
  const replay = replayCampaign(complete, true);
  expect(replay.replay).toBe(complete.id);
  expect(replay.batches.map((b) => b.replayOf)).toEqual([
    complete.batches[1]?.run?.id,
  ]);
  expect(replay.runtime).toBe(complete.runtime);
  expect(replay.scope).toBe("fresh");
  expect(() => replayCampaign(saved, false)).toThrow("complete campaign");
});
it("does not checkpoint changed immutable inputs, missing scenarios, or a filtered shot", async () => {
  for (const change of [
    { fixture: "f".repeat(64) },
    { runtime: "f".repeat(64) },
    { scenarios: [] },
    { selection: { shot: "first" } },
  ]) {
    const state = pending();
    state.runtime = "b".repeat(64);
    let writes = 0;
    await expect(
      executeCampaign(
        state,
        () => {
          writes++;
          return Promise.resolve();
        },
        (part) => Promise.resolve({ ...result(part), ...change }),
      ),
    ).rejects.toThrow("immutable inputs");
    expect(writes).toBe(0);
  }
});
it("refuses invalid checkpoint order, missing runtime, duplicate IDs and mixed replay", () => {
  const state = pending();
  const first = state.batches[0],
    last = state.batches[1];
  if (!first || !last) throw new Error("Missing test batches");
  for (const altered of [
    { ...state, batches: [first, { ...last, run: result(last) }] },
    { ...state, batches: [{ ...first, run: result(first) }, last] },
    { ...state, batches: [first, first] },
    { ...state, batches: [{ ...first, replayOf: crypto.randomUUID() }, last] },
  ])
    expect(() => validateCampaign(altered)).toThrow();
});
it("does not silently drop a batch from an edited suite", () => {
  const state = pending();
  expect(() =>
    validatePlan(state, {
      id: "test",
      bootstrap: [0, 64, 0],
      patches: [],
      scenarios: [],
    }),
  ).toThrow("plan differs");
});
