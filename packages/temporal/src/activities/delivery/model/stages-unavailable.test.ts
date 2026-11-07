import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MockActivityEnvironment } from "@temporalio/testing";
import { forumDetail } from "#lib/delivery/model/forum-testing.ts";
import type * as Client from "#lib/delivery/client.ts";

/**
 * A self-hosted sync reads its deployment back through the API that same
 * sync is replacing (D8). The 2026-11-05 delivery/prod release failed on one
 * refused connection here and held every environment behind the dispatch
 * barrier. Only the HTTP request is a stand-in.
 */
const request = vi.hoisted(() => vi.fn());
vi.mock("#lib/delivery/client.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof Client>()),
  deliveryRequest: request,
}));

const { DeliveryApiUnavailableError, DELIVERY_API_UNAVAILABLE_WAIT } =
  await import("#lib/delivery/client.ts");
const { recordStage, requireOwned } = await import("./stages.ts");

const owned = () => {
  const { current } = forumDetail();
  return { ...current, selfHosted: true };
};
const refused = () =>
  new DeliveryApiUnavailableError("Delivery API deployments/x is unreachable");

function inActivity<T>(run: () => Promise<T>) {
  const env = new MockActivityEnvironment();
  const heartbeats: unknown[] = [];
  env.on("heartbeat", (details: unknown) => heartbeats.push(details));
  return { result: env.run(run), heartbeats };
}

type Outcome<T> = { value: T } | { error: unknown };

async function outcomeOf<T>(promise: Promise<T>): Promise<Outcome<T>> {
  try {
    return { value: await promise };
  } catch (error) {
    return { error };
  }
}

async function settle<T>(promise: Promise<T>) {
  const outcome = outcomeOf(promise);
  await vi.runAllTimersAsync();
  return await outcome;
}

function failureOf<T>(outcome: Outcome<T>) {
  if (!("error" in outcome)) throw new Error("expected the step to fail");
  return outcome.error;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  request.mockReset();
});

describe("a step outlasts its own API rollout", () => {
  test("requireOwned reads through refused connections and heartbeats", async () => {
    const current = owned();
    request
      .mockRejectedValueOnce(refused())
      .mockRejectedValueOnce(refused())
      .mockResolvedValueOnce(current);
    const { result, heartbeats } = inActivity(() =>
      requireOwned(current.deployment.id),
    );
    expect(await settle(result)).toEqual({ value: current });
    expect(request).toHaveBeenCalledTimes(3);
    expect(heartbeats).toEqual([
      { deliveryApiUnavailable: 1 },
      { deliveryApiUnavailable: 2 },
    ]);
  });

  test("an outage longer than the bounded wait still fails the step", async () => {
    const current = owned();
    request.mockRejectedValue(refused());
    const { result } = inActivity(() => requireOwned(current.deployment.id));
    expect(failureOf(await settle(result))).toBeInstanceOf(
      DeliveryApiUnavailableError,
    );
    expect(request).toHaveBeenCalledTimes(
      DELIVERY_API_UNAVAILABLE_WAIT.attempts,
    );
  });

  test("losing ownership is never waited out", async () => {
    const current = owned();
    request.mockResolvedValueOnce({
      ...current,
      deployment: { ...current.deployment, status: "failed" },
    });
    const { result } = inActivity(() => requireOwned(current.deployment.id));
    expect(failureOf(await settle(result))).toMatchObject({
      message: expect.stringMatching(/no longer owns its environment/u),
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  test("a stage write repeats the identical request after a refusal", async () => {
    const current = owned();
    request.mockRejectedValueOnce(refused()).mockResolvedValueOnce(null);
    const { result } = inActivity(() =>
      recordStage(current, "step-sync", "succeeded", { operationId: "op-1" }),
    );
    expect(await settle(result)).toEqual({ value: undefined });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]).toEqual(request.mock.calls[0]);
  });
});
