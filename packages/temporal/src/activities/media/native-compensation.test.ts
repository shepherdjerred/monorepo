import { Context } from "@temporalio/activity";
import { MockActivityEnvironment } from "@temporalio/testing";
import { CancelledFailure } from "@temporalio/common";
import { afterEach, expect, test, vi } from "vitest";
import {
  createNativeCompensationFileAdapter,
  nativeCompensationFileActivities,
} from "./native-compensation.ts";
import type { compensationExecution } from "./compensation-execution.ts";
import { QUEUE_WORKER_DEFINITIONS } from "#worker-config";

type Execution = ReturnType<typeof compensationExecution>;
type Activities = ReturnType<typeof createNativeCompensationFileAdapter>;
const prepare = {
  planId: crypto.randomUUID(),
  operationId: crypto.randomUUID(),
};
const apply = { ...prepare, planHash: "a".repeat(64) };
const effect = {
  schemaVersion: 1 as const,

  continuationId: crypto.randomUUID(),
  operationId: crypto.randomUUID(),
  recoveryEpoch: 1,
};
const names = ["prepare", "apply", "effect"] as const;

afterEach(() => vi.restoreAllMocks());

function environment(at = Date.now()) {
  return new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    startToCloseTimeoutMs: 30_000,
    scheduleToCloseTimeoutMs: 120_000,
  });
}
function invoke(activities: Activities, name: (typeof names)[number]) {
  if (name === "prepare")
    return activities.prepareNativeCompensationFiles(prepare);
  return name === "apply"
    ? activities.applyNativeCompensationFiles(apply)
    : activities.compensateNativePublicationFiles(effect);
}
function runtime(
  consume: (execution: Execution, input: unknown) => Promise<void>,
) {
  return {
    nativeFiles: {
      compensation(execution: Execution): Activities {
        return {
          prepareNativeCompensationFiles: (input) => consume(execution, input),
          applyNativeCompensationFiles: (input) => consume(execution, input),
          compensateNativePublicationFiles: async (input) => {
            await consume(execution, input);
            return { status: "compensated" as const, reason: null };
          },
        };
      },
    },
  };
}
function gate() {
  let resolve: (() => void) | undefined;
  const wait = new Promise<void>((finish) => {
    resolve = finish;
  });
  return {
    wait,
    release() {
      if (resolve === undefined) throw new Error("Gate was not initialized");
      resolve();
    },
  };
}

test.each(names)(
  "%s uses the pre-lazy monotonic deadline after a backward wall-clock move",
  async (name) => {
    const at = Date.now(),
      start = performance.now();
    const wall = vi.spyOn(Date, "now").mockReturnValue(at);
    const monotonic = vi.spyOn(performance, "now").mockReturnValue(start);
    const env = environment(at);
    const mutation = vi.fn();
    let reached = false;
    const cached = runtime(async (execution) => {
      reached = true;
      expect(execution.expiresAtMs).toBe(at + 30_000);
      expect(execution.signal).toBe(env.context.cancellationSignal);
      execution.assertActive();
      await Promise.resolve();
      // Wall time still has 19 seconds left; only the ORIGINAL monotonic
      // deadline rejects. A factory recaptured after lazy load would pass.
      wall.mockReturnValue(at + 11_000);
      monotonic.mockReturnValue(start + 31_000);
      execution.assertActive();
      mutation();
    });
    const load = vi.fn(() => {
      expect(Context.current()).toBe(env.context);
      wall.mockReturnValue(at - 20_000);
      monotonic.mockReturnValue(start + 1000);
      return Promise.resolve(cached);
    });
    const activities = createNativeCompensationFileAdapter(load);
    await expect(env.run(() => invoke(activities, name))).rejects.toMatchObject(
      {
        type: "CompensationActivityFailure",
        message:
          "Compensation Activity failed; review protected operation status",
        cause: undefined,
        details: undefined,
      },
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(reached).toBe(true);
    expect(mutation).not.toHaveBeenCalled();
  },
);

test("positive dispatch preserves exact public inputs and forwards one capability to each facet", async () => {
  const consumed: Execution[] = [];
  const inputs: unknown[] = [];
  const cached = runtime(async (execution, input) => {
    execution.assertActive();
    inputs.push(input);
    consumed.push(execution);
    await Promise.resolve();
    execution.assertActive();
  });
  const facet = vi.spyOn(cached.nativeFiles, "compensation");
  const activities = createNativeCompensationFileAdapter(() =>
    Promise.resolve(cached),
  );
  for (const name of names)
    await environment().run(() => invoke(activities, name));
  expect(inputs).toEqual([prepare, apply, effect]);
  expect(inputs[0]).toBe(prepare);
  expect(inputs[1]).toBe(apply);
  expect(inputs[2]).toBe(effect);
  expect(facet).toHaveBeenCalledTimes(3);
  for (const [index, execution] of consumed.entries()) {
    expect(facet.mock.calls[index]?.[0]).toBe(execution);
    expect(Object.keys(execution).sort()).toEqual([
      "assertActive",
      "checkpoint",
      "expiresAtMs",
      "signal",
    ]);
  }
  expect(new Set(consumed).size).toBe(3);
});

test("concurrent invocations share runtime factories but never capabilities or cancellation", async () => {
  const first = environment(),
    second = environment();
  const firstEntered = gate(),
    secondEntered = gate(),
    release = gate();
  const seen: Execution[] = [];
  const effects: AbortSignal[] = [];
  const cached = runtime(async (execution) => {
    seen.push(execution);
    if (execution.signal === first.context.cancellationSignal)
      firstEntered.release();
    else if (execution.signal === second.context.cancellationSignal)
      secondEntered.release();
    else throw new Error("Unexpected invocation signal");
    await release.wait;
    execution.assertActive();
    effects.push(execution.signal);
  });
  const activities = createNativeCompensationFileAdapter(() =>
    Promise.resolve(cached),
  );
  const firstRun = first.run(() =>
    activities.prepareNativeCompensationFiles(prepare),
  );
  const refused = expect(firstRun).rejects.toBeInstanceOf(CancelledFailure);
  const secondRun = second.run(() =>
    activities.prepareNativeCompensationFiles(prepare),
  );
  try {
    await Promise.all([firstEntered.wait, secondEntered.wait]);
    first.cancel();
  } finally {
    release.release();
  }
  await Promise.all([refused, secondRun]);
  expect(seen).toHaveLength(2);
  expect(seen[0]).not.toBe(seen[1]);
  expect(effects).toEqual([second.context.cancellationSignal]);
  expect(Object.keys(cached.nativeFiles)).toEqual(["compensation"]);
});

test("registered Files activities retain the exact adapter functions", () => {
  for (const [name, activity] of Object.entries(
    nativeCompensationFileActivities,
  )) {
    const workers = QUEUE_WORKER_DEFINITIONS.filter(
      (worker) => worker.kind === "activity" && name in worker.activities,
    );
    expect(workers.map((worker) => worker.role)).toEqual(["media-files"]);
    for (const worker of workers) {
      if (worker.kind !== "activity")
        throw new Error("Activity worker missing");
      expect(
        Object.entries(worker.activities).find(([key]) => key === name)?.[1],
      ).toBe(activity);
    }
  }
});
