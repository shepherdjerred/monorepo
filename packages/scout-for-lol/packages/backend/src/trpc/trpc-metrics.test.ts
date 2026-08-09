/**
 * tRPC call instrumentation.
 *
 * The reason this is middleware rather than the adapter's `onError` hook is
 * that `onError` only fires on failure — it can produce an error count but
 * never an error *rate*. These tests pin both halves: successes are counted as
 * `OK`, and failures are counted with their TRPCError code.
 */

import { describe, it, expect, afterAll } from "bun:test";
import { createOfflineTrpcHarness } from "#src/testing/test-trpc-caller.ts";

const trpc = await createOfflineTrpcHarness("trpc-metrics-test");

const { trpcCallsTotal, trpcCallDuration } =
  await import("#src/metrics/web.ts");

async function callCount(procedure: string, code: string): Promise<number> {
  const metric = await trpcCallsTotal.get();
  return (
    metric.values.find(
      (value) =>
        value.labels.procedure === procedure && value.labels.code === code,
    )?.value ?? 0
  );
}

async function durationSamples(procedure: string): Promise<number> {
  const metric = await trpcCallDuration.get();
  return (
    metric.values.find(
      (value) =>
        value.metricName === "scout_trpc_duration_seconds_count" &&
        value.labels.procedure === procedure,
    )?.value ?? 0
  );
}

describe("tRPC metrics middleware", () => {
  afterAll(async () => {
    await trpc.prisma.$disconnect();
  });

  it("counts a successful call as OK", async () => {
    const before = await callCount("auth.sessionState", "OK");

    await trpc.anonCaller().auth.sessionState();

    expect(await callCount("auth.sessionState", "OK")).toBe(before + 1);
  });

  it("observes latency for successful calls", async () => {
    const before = await durationSamples("auth.sessionState");

    await trpc.anonCaller().auth.sessionState();

    expect(await durationSamples("auth.sessionState")).toBe(before + 1);
  });

  it("counts a failed call with its error code", async () => {
    const before = await callCount("auth.meWeb", "UNAUTHORIZED");

    // meWeb still throws for anonymous callers by design; sessionState is the
    // non-throwing probe the SPA uses.
    await expect(trpc.anonCaller().auth.meWeb()).rejects.toThrow();

    expect(await callCount("auth.meWeb", "UNAUTHORIZED")).toBe(before + 1);
  });

  it("labels by procedure, so one failure does not pollute another", async () => {
    const sessionStateErrors = await callCount(
      "auth.sessionState",
      "UNAUTHORIZED",
    );
    await expect(trpc.anonCaller().auth.meWeb()).rejects.toThrow();
    expect(await callCount("auth.sessionState", "UNAUTHORIZED")).toBe(
      sessionStateErrors,
    );
  });
});
