import { expect, test, vi } from "vitest";
import { compensationAwait } from "./execution.ts";

test("expired invocation never starts the supplied IO thunk", async () => {
  const work = vi.fn(() => Promise.resolve("late"));
  const execution = {
    signal: new AbortController().signal,
    assertActive: () => {
      throw new Error("expired");
    },
    checkpoint: () => Promise.resolve(),
  };
  await expect(compensationAwait(execution, work)).rejects.toThrow("expired");
  expect(work).not.toHaveBeenCalled();
});
test("cancellation while awaited IO settles blocks its result", async () => {
  const controller = new AbortController();
  const execution = {
    signal: controller.signal,
    assertActive: () => controller.signal.throwIfAborted(),
    checkpoint: () => Promise.resolve(),
  };
  await expect(
    compensationAwait(execution, async () => {
      await Promise.resolve();
      controller.abort(new Error("cancelled"));
      return "late";
    }),
  ).rejects.toThrow("cancelled");
});
