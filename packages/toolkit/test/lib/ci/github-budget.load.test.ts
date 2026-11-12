import { expect, test } from "vitest";
import { simulate } from "./github-budget-sim.ts";

/**
 * Thirty agents waiting at once must leave at least half of the account's
 * 5,000-point GraphQL bucket to everything else, and stay well inside REST.
 */
test("30 concurrent waiters for a simulated hour stay inside the shared GitHub budget", async () => {
  const result = await simulate({
    waiters: 30,
    minutes: 60,
    eventsPerMinute: 66,
    mainEventsPerMinute: 14,
    shared: true,
    seed: 4549,
  });
  console.log(
    `github-budget simulation: ${JSON.stringify({ ...result, readyLatencyMs: undefined, readyLatencyP50s: median(result.readyLatencyMs) / 1000, readyLatencyMaxS: Math.max(...result.readyLatencyMs) / 1000 })}`,
  );
  expect(result.events).toBeGreaterThan(60 * 60);
  expect(result.outcomes["ready"] ?? 0).toBeGreaterThan(20);
  expect(result.graphqlPoints).toBeLessThanOrEqual(2500);
  expect(result.restCharged).toBeLessThanOrEqual(2500);
  // Readiness stays prompt: a pipeline success is reported within a GitHub read interval.
  expect(Math.max(...result.readyLatencyMs)).toBeLessThanOrEqual(60_000);
}, 300_000);

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

test("a bucket other work has nearly drained slows periodic reads without losing readiness", async () => {
  // A 1,500 request bucket: waiters alone would cross the 20% floor.
  const result = await simulate({
    waiters: 30,
    minutes: 60,
    eventsPerMinute: 66,
    mainEventsPerMinute: 14,
    shared: true,
    seed: 4549,
    bucketLimit: 1500,
  });
  console.log(
    `github-budget throttled simulation: ${JSON.stringify({ ...result, readyLatencyMs: undefined, readyLatencyMaxS: Math.max(...result.readyLatencyMs) / 1000 })}`,
  );
  expect(result.restCharged).toBeLessThan(1500);
  expect(result.outcomes["ready"] ?? 0).toBeGreaterThan(20);
}, 300_000);
