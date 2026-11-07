import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { PlexBindingExecution } from "@shepherdjerred/media/plex-binding";
import type * as BudgetModule from "@shepherdjerred/media/publication-authority-budget";
import { createProviderFeedWorkerActivitiesV1 } from "./provider-feed.ts";

const { lifecycle } = vi.hoisted(() => {
  const events: string[] = [];
  return { lifecycle: events };
});
// Observe construction only: all actual hundred-record accounting remains the real implementation.
vi.mock(
  "@shepherdjerred/media/publication-authority-budget",
  async (original) => {
    const actual = await original<typeof BudgetModule>();
    return {
      ...actual,
      PublicationAuthorityReadBudget: class
        extends actual.PublicationAuthorityReadBudget
      {
        constructor() {
          super();
          lifecycle.push("budget");
        }
      },
    };
  },
);

beforeEach(() => {
  lifecycle.splice(0);
});
afterEach(() => {
  vi.restoreAllMocks();
});
const input = {
  schemaVersion: 1 as const,
  operationId: crypto.randomUUID(),
  sourceId: crypto.randomUUID(),
  cursor: null,
};
type PublicationAuthorityReadBudget =
  BudgetModule.PublicationAuthorityReadBudget;
function environment(at: number) {
  return new MockActivityEnvironment({
    scheduledTimestampMs: at,
    currentAttemptScheduledTimestampMs: at,
    startToCloseTimeoutMs: 120_000,
    scheduleToCloseTimeoutMs: 180_000,
    heartbeatTimeoutMs: 30_000,
  });
}
function runtime(
  check: (
    execution: PlexBindingExecution,
    budget: PublicationAuthorityReadBudget,
  ) => void,
) {
  return {
    providerFeed: {
      matchProviderFeedSource: (
        actualInput: unknown,
        execution: PlexBindingExecution,
        budget: PublicationAuthorityReadBudget,
      ) => {
        expect(actualInput).toBe(input);
        lifecycle.push("dispatch");
        check(execution, budget);
        return Promise.resolve({
          status: "processed" as const,
          processed: 1,
          nextCursor: null,
        });
      },
    },
  };
}

test("the provider-feed allowance and original SDK observation precede cold loading without changing the personal feed envelope", async () => {
  const at = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  const check = vi.fn(
    (
      execution: PlexBindingExecution,
      budget: PublicationAuthorityReadBudget,
    ) => {
      expect(execution.observed.wall).toBe(at);
      expect(execution.expiresAtMs).toBe(at + 60_000);
      execution.assertActive();
      expect(budget.take).toBe(101);
      budget.consume(99);
      const sameAllowance = budget;
      expect(sameAllowance.take).toBe(2);
      sameAllowance.consume(1);
      expect(budget.take).toBe(1);
      expect(() => budget.consume(1)).toThrow("100 total queried records");
    },
  );
  const activity = createProviderFeedWorkerActivitiesV1(() => {
    expect(lifecycle).toEqual(["budget"]);
    lifecycle.push("load");
    clock.mockReturnValue(at + 1000);
    return Promise.resolve(runtime(check));
  }).matchProviderFeedSource;
  expect(await environment(at).run(activity, input)).toEqual({
    status: "processed",
    processed: 1,
    nextCursor: null,
  });
  expect(lifecycle).toEqual(["budget", "load", "dispatch"]);
  expect(check).toHaveBeenCalledTimes(1);
});

test.each(["expired", "cancelled"] as const)(
  "an initially %s provider feed cannot initialize a runtime or dispatch provider work",
  async (state) => {
    const at = Date.now();
    const env = environment(state === "expired" ? at - 120_001 : at);
    if (state === "cancelled") env.cancel();
    const load = vi.fn(() => Promise.resolve(runtime(vi.fn())));
    const activity =
      createProviderFeedWorkerActivitiesV1(load).matchProviderFeedSource;
    await expect(env.run(activity, input)).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
    expect(lifecycle).toEqual(["budget"]);
  },
);

test.each(["expired", "cancelled"] as const)(
  "a provider feed cannot renew %s SDK authority during lazy loading",
  async (state) => {
    const at = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    const env = environment(at);
    const check = vi.fn();
    const activity = createProviderFeedWorkerActivitiesV1(() => {
      lifecycle.push("load");
      if (state === "expired") clock.mockReturnValue(at + 120_001);
      else env.cancel();
      return Promise.resolve(runtime(check));
    }).matchProviderFeedSource;
    await expect(env.run(activity, input)).rejects.toThrow();
    expect(check).not.toHaveBeenCalled();
    expect(lifecycle).toEqual(["budget", "load"]);
  },
);

test("a cached provider-feed runtime receives a new independent SDK capability and one real allowance per Activity", async () => {
  const at = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(at);
  const executions: PlexBindingExecution[] = [];
  const budgets: PublicationAuthorityReadBudget[] = [];
  const cached = runtime((execution, budget) => {
    executions.push(execution);
    budgets.push(budget);
    expect(budget.take).toBe(101);
    budget.consume(100);
  });
  const activity = createProviderFeedWorkerActivitiesV1(() =>
    Promise.resolve(cached),
  ).matchProviderFeedSource;
  await environment(at).run(activity, input);
  clock.mockReturnValue(at + 1);
  await environment(at + 1).run(activity, input);
  expect(executions[0]).not.toBe(executions[1]);
  expect(executions.map((execution) => execution.observed.wall)).toEqual([
    at,
    at + 1,
  ]);
  expect(budgets[0]).not.toBe(budgets[1]);
  expect(budgets.map((budget) => budget.take)).toEqual([1, 1]);
});
