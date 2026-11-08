import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { z } from "zod";
import { ApplicationFailure } from "@temporalio/common";
import type * as Activity from "@temporalio/activity";
import type * as Job from "#lib/delivery/job.ts";
import { PLAN, temporal } from "#lib/delivery/workers/model-worker-fixture.ts";

/**
 * A worker rollout's read-only stages run a pinned Job that only reads and
 * proves. When the executor sees that Job fail, nothing changed, so it settles
 * the stage itself instead of leaving it running (which ends a self-hosted
 * deployment recovery-required, holding every environment). Effect stages
 * keep it running for independent recovery.
 */
const state = vi.hoisted(() => {
  const writes: { key: string; status: string; evidence: unknown[] }[] = [];
  const current: { value: unknown } = { value: undefined };
  return { writes, current };
});
vi.mock("@temporalio/activity", async (importOriginal) => ({
  ...(await importOriginal<typeof Activity>()),
  Context: {
    current: () => ({
      cancellationSignal: new AbortController().signal,
      heartbeat: vi.fn(),
      info: {
        workflowExecution: { workflowId: "delivery/d", runId: "run-1" },
      },
    }),
  },
}));
vi.mock("#lib/delivery/client.ts", () => ({
  deliveryRequest: (_path: string, _schema: unknown, body?: unknown) => {
    if (body === undefined) return Promise.resolve(state.current.value);
    const write = z
      .object({
        key: z.string(),
        status: z.string(),
        evidence: z.array(z.unknown()),
      })
      .parse(body);
    state.writes.push(write);
    return Promise.resolve(null);
  },
}));
vi.mock("#lib/delivery/workers/worker-hosts.ts", () => ({
  workerApplicationResources: () => Promise.resolve([]),
}));
vi.mock("#lib/delivery/job.ts", async (importOriginal) => {
  const original = await importOriginal<typeof Job>();
  return {
    ...original,
    runDeliveryJob: async (
      request: { stageKey: string },
      onReceipt: (receipt: unknown) => Promise<void>,
    ) => {
      await onReceipt({
        namespace: "delivery-worker-jobs",
        name: `delivery-${request.stageKey}`,
        uid: "job-uid-1",
        specFingerprint: "f".repeat(64),
        requestId: "request-1",
      });
      throw new original.DeliveryJobFailedError(
        "Delivery Job failed; inspect its recorded UID and bounded stage logs",
      );
    },
  };
});

const {
  inspectDeliveryWorkerImages,
  prepareDeliveryWorker,
  stepDeliveryWorker,
} = await import("./worker-rollout.ts");

async function failure(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    return error;
  }
  throw new Error("expected the stage to fail");
}

beforeEach(() => {
  vi.stubEnv("GIT_SHA", "c".repeat(40));
  state.current.value = temporal([]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  state.writes.length = 0;
});

describe("a worker rollout stage whose Job failed", () => {
  test.each([
    [
      "worker-image-provenance",
      () => inspectDeliveryWorkerImages("deployment-1"),
    ],
    ["worker-preflight", () => prepareDeliveryWorker("deployment-1")],
  ])("%s is read-only, so it settles failed", async (stage, run) => {
    const error = await failure(run());
    expect(error).toBeInstanceOf(ApplicationFailure);
    expect(error).toMatchObject({
      type: "DeliveryReadOnlyStageFailed",
      nonRetryable: true,
    });
    expect(state.writes.map(({ key, status }) => `${key} ${status}`)).toEqual([
      `${stage} running`,
      `${stage} running`,
      `${stage} failed`,
    ]);
    expect(state.writes.at(-1)?.evidence).toContainEqual(
      expect.objectContaining({
        summary: expect.stringContaining("before any routing change"),
      }),
    );
  });

  test("worker-promote may have moved routing, so its stage stays running", async () => {
    const error = await failure(
      stepDeliveryWorker("deployment-1", PLAN, "promote"),
    );
    expect(error).toMatchObject({ name: "DeliveryJobFailedError" });
    expect(state.writes.map(({ status }) => status)).not.toContain("failed");
  });
});
