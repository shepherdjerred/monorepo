import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  TemporalReplayNamespaceSchema,
  mapWithConcurrency,
  replayTemporalHistoryBatch,
  temporalOperatorConnectionOptions,
  parseTemporalReplayTargets,
  type TemporalReplayBatch,
} from "./temporal-replay.ts";

function validateBetaWorkflowId(value: string) {
  if (!value.startsWith("scout-beta-")) throw new Error("Wrong stage");
  return value;
}

describe("Temporal replay executions", () => {
  const first = "81811c56-c5cb-4401-a272-a6578512ede6";
  const second = "10c752e8-51af-47b7-aad5-17e64668f095";
  it("retains two exact runs of the same Workflow alongside a latest-run request", () => {
    expect(
      parseTemporalReplayTargets(
        [
          "--run",
          "scout-beta-dispatch",
          first,
          "--run",
          "scout-beta-dispatch",
          second,
          "scout-beta-match",
        ],
        validateBetaWorkflowId,
      ),
    ).toEqual([
      { workflowId: "scout-beta-dispatch", runId: first },
      { workflowId: "scout-beta-dispatch", runId: second },
      "scout-beta-match",
    ]);
  });
  it.each([
    { args: ["--run"] },
    { args: ["--run", "scout-beta-dispatch"] },
    { args: ["--run", "scout-beta-dispatch", "not-a-run"] },
    { args: ["--run", "scout-prod-dispatch", first] },
  ])(
    "rejects incomplete, invalid, or wrong-stage targets $args",
    ({ args }) => {
      expect(() =>
        parseTemporalReplayTargets(args, validateBetaWorkflowId),
      ).toThrow();
    },
  );
});

describe("Temporal replay namespace", () => {
  it.each(["dev", "beta", "prod"])("accepts %s", (namespace) => {
    expect(TemporalReplayNamespaceSchema.parse(namespace)).toBe(namespace);
  });

  it.each([undefined, "", "default", "staging"])("rejects %s", (namespace) => {
    expect(() => TemporalReplayNamespaceSchema.parse(namespace)).toThrow();
  });
});

describe("Temporal replay connection", () => {
  it("uses the configured internal endpoint without a credential", () => {
    expect(
      temporalOperatorConnectionOptions({
        TEMPORAL_ADDRESS: "temporal.example:7233",
      }),
    ).toEqual({ address: "temporal.example:7233" });
  });

  it("passes the external API credential to the SDK over TLS", () => {
    expect(
      temporalOperatorConnectionOptions({
        TEMPORAL_ADDRESS: "temporal.example:443",
        TEMPORAL_TLS: "true",
        TEMPORAL_API_KEY: "test-only",
      }),
    ).toEqual({
      address: "temporal.example:443",
      tls: true,
      apiKey: "test-only",
    });
  });

  it.each([undefined, "false"])(
    "rejects credentials without TLS (%s)",
    (tls) => {
      expect(() =>
        temporalOperatorConnectionOptions({
          TEMPORAL_ADDRESS: "temporal.example:443",
          TEMPORAL_TLS: tls,
          TEMPORAL_API_KEY: "test-only",
        }),
      ).toThrow("requires TEMPORAL_TLS=true");
    },
  );

  it("rejects empty credentials and ambiguous TLS", () => {
    expect(() =>
      temporalOperatorConnectionOptions({
        TEMPORAL_ADDRESS: "temporal.example:443",
        TEMPORAL_TLS: "true",
        TEMPORAL_API_KEY: "",
      }),
    ).toThrow("nonempty TEMPORAL_API_KEY");
    expect(() =>
      temporalOperatorConnectionOptions({
        TEMPORAL_ADDRESS: "temporal.example:443",
        TEMPORAL_TLS: "yes",
      }),
    ).toThrow();
  });

  it.each([undefined, ""])(
    "requires an explicit nonempty address (%s)",
    (address) => {
      expect(() =>
        temporalOperatorConnectionOptions({ TEMPORAL_ADDRESS: address }),
      ).toThrow("TEMPORAL_ADDRESS is required");
    },
  );
});

describe("Temporal replay concurrency", () => {
  it("bounds in-flight work and keeps input order", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency(
      [50, 10, 30, 0, 20, 40, 5],
      3,
      async (delay, index) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, delay));
        inFlight--;
        return index;
      },
    );
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(peak).toBe(3);
  });

  it("rejects when any item fails and refuses a non-positive limit", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, (value) =>
        value === 2
          ? Promise.reject(new Error("lookup failed"))
          : Promise.resolve(value),
      ),
    ).rejects.toThrow("lookup failed");
    await expect(
      mapWithConcurrency([1], 0, (value) => Promise.resolve(value)),
    ).rejects.toThrow("positive integer");
  });
});

function runId(index: number): string {
  return `00000000-0000-4000-8000-00000000000${String(index)}`;
}

/** A replay that returns one result for `workflowId`, whatever was requested. */
function singleResult(workflowId: string): TemporalReplayBatch {
  return () =>
    (async function* () {
      await Promise.resolve();
      yield { workflowId, runId: runId(0) };
    })();
}

function discardLine(): void {
  // These cases assert the thrown error, not the per-history lines.
}

/** A one-call replay that fails the named histories, recording each call. */
function fakeReplay(failing: ReadonlySet<string>) {
  const calls: { workflowsPath: string; workflowIds: string[] }[] = [];
  const replay: TemporalReplayBatch = (options, batch) => {
    const workflowIds = [...batch].map(({ workflowId }) => workflowId);
    calls.push({ workflowsPath: options.workflowsPath, workflowIds });
    return (async function* () {
      for (const [index, workflowId] of workflowIds.entries()) {
        await Promise.resolve();
        yield {
          workflowId,
          runId: runId(index + 5),
          ...(failing.has(workflowId)
            ? {
                error: Object.assign(new Error(`${workflowId} diverged`), {
                  name: "DeterminismViolationError",
                }),
              }
            : {}),
        };
      }
    })();
  };
  return { calls, replay };
}

describe("Temporal replay batch", () => {
  const histories = ["first", "second", "third", "fourth"].map(
    (workflowId, index) => ({
      workflowId,
      runId: index === 3 ? undefined : runId(index),
      history: { events: [workflowId] },
    }),
  );

  it("replays every history in one batch and reports each one", async () => {
    const { calls, replay } = fakeReplay(new Set());
    const lines: string[] = [];
    const outcomes = await replayTemporalHistoryBatch({
      histories,
      workflowsPath: "/workflows/index.ts",
      replay,
      log: (line) => lines.push(line),
    });
    expect(calls).toEqual([
      {
        workflowsPath: "/workflows/index.ts",
        workflowIds: ["first", "second", "third", "fourth"],
      },
    ]);
    // A latest-run target reports the run the replay actually covered.
    expect(outcomes.map((outcome) => outcome.runId)).toEqual([
      runId(0),
      runId(1),
      runId(2),
      runId(8),
    ]);
    expect(lines.map((line) => JSON.parse(line) as unknown)).toEqual(
      outcomes.map((outcome) => ({
        kind: "temporal-replay-history",
        workflowId: outcome.workflowId,
        runId: outcome.runId,
        outcome: "passed",
      })),
    );
  });

  it("fails the run after reporting every history when one is nondeterministic", async () => {
    const { calls, replay } = fakeReplay(new Set(["second"]));
    const lines: string[] = [];
    await expect(
      replayTemporalHistoryBatch({
        histories,
        workflowsPath: "/workflows/index.ts",
        replay,
        log: (line) => lines.push(line),
      }),
    ).rejects.toThrow(
      `Replay failed for 1 of 4 histories: second/${runId(1)} (DeterminismViolationError: second diverged)`,
    );
    expect(calls).toHaveLength(1);
    expect(
      lines.map(
        (line) =>
          z.object({ outcome: z.string() }).parse(JSON.parse(line)).outcome,
      ),
    ).toEqual(["passed", "failed", "passed", "passed"]);
  });

  it("refuses a short or mismatched result stream", async () => {
    await expect(
      replayTemporalHistoryBatch({
        histories,
        workflowsPath: "/workflows/index.ts",
        replay: singleResult("first"),
        log: discardLine,
      }),
    ).rejects.toThrow("Replay ended after 1 of 4 histories");
    await expect(
      replayTemporalHistoryBatch({
        histories,
        workflowsPath: "/workflows/index.ts",
        replay: singleResult("second"),
        log: discardLine,
      }),
    ).rejects.toThrow("does not match requested history first");
  });
});
