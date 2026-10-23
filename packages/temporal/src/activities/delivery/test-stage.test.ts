import { afterEach, describe, expect, it, vi } from "vitest";
import { MockActivityEnvironment } from "@temporalio/testing";
import type {
  DeliveryJobReceipt,
  DeliveryJobRequest,
} from "#shared/delivery-job.ts";

const requests: { path: string; body: unknown }[] = [];
const server = vi.hoisted(() => ({ lapsed: false }));
vi.mock("#lib/delivery/client.ts", () => ({
  deliveryRequest: vi.fn(
    async (path: string, _schema: unknown, body?: unknown) => {
      // The server refuses any stage write once the lease has lapsed (D7).
      if (server.lapsed)
        throw new Error(
          "The deployment's lease lapsed; it is no longer provably owned and ends in recovery (D7)",
        );
      requests.push({ path, body });
      return {};
    },
  ),
}));

const testStage = await import("./test-stage.ts");
/** The stage runs as the Activity of its executor Workflow (D7). */
async function runDeliveryTestStage(
  ...args: Parameters<typeof testStage.runDeliveryTestStage>
) {
  return await new MockActivityEnvironment().run<
    Parameters<typeof testStage.runDeliveryTestStage>,
    Awaited<ReturnType<typeof testStage.runDeliveryTestStage>>,
    typeof testStage.runDeliveryTestStage
  >(testStage.runDeliveryTestStage, ...args);
}

afterEach(() => {
  requests.splice(0);
  server.lapsed = false;
});

const REQUEST = {
  stageKey: "test-e2e",
  suite: "test:e2e",
  workspace: "packages/delivery",
  sourceRevision: "b".repeat(40),
  runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
};
/** A running stage write under the executor's identity (D7). */
const running = (message: string) => ({
  path: "deployments/deployment%2Ftest/stages",
  body: {
    key: "test-e2e",
    status: "running",
    operationId: expect.stringMatching(/^delivery-[a-f0-9]{40}$/u),
    message,
    evidence: [],
    // The executor names itself on every stage write (D7).
    executor: {
      workflowId: expect.any(String),
      workflowRunId: expect.any(String),
    },
  },
});

describe("runDeliveryTestStage", () => {
  it("records the stage running before the Job and on its receipt, and returns test evidence", async () => {
    const receipt = {
      namespace: "delivery-worker-jobs" as const,
      name: "delivery-abc",
      uid: "11111111-1111-4111-8111-111111111111",
      specFingerprint: "f".repeat(64),
      requestId: "deployment/test",
    };
    const result = {
      schema: "delivery-test-stage/v1",
      suite: "test:e2e",
      workspace: "packages/delivery",
      exitCode: 0,
      passed: 12,
      failed: 0,
      durationMs: 1234,
      reportSha256: `sha256:${"a".repeat(64)}`,
      failures: [],
      truncated: false,
    };
    const runJob = vi.fn(
      async (
        request: DeliveryJobRequest,
        onReceipt: (native: DeliveryJobReceipt) => Promise<void>,
      ): Promise<unknown> => {
        expect(request).toMatchObject({
          recipe: "test",
          stageKey: "test-e2e",
          input: { suite: "test:e2e", workspace: "packages/delivery" },
        });
        await onReceipt(receipt);
        return result;
      },
    );
    const outcome = await runDeliveryTestStage(
      "deployment/test",
      REQUEST,
      runJob,
    );
    expect(requests).toEqual([
      running("Waiting for an identity-bound revision-pinned Job"),
      running(JSON.stringify(receipt)),
    ]);
    expect(outcome.result).toEqual(result);
    expect(outcome.evidence).toEqual({
      kind: "test",
      summary: JSON.stringify(result),
      operationId: receipt.uid,
    });
  });
  it("refuses a result naming another suite", async () => {
    const runJob = vi.fn(async (): Promise<unknown> => ({
      schema: "delivery-test-stage/v1",
      suite: "test",
      workspace: "packages/delivery",
      exitCode: 0,
      passed: 1,
      failed: 0,
      durationMs: 1,
      reportSha256: null,
      failures: [],
      truncated: false,
    }));
    await expect(
      runDeliveryTestStage("deployment/test", REQUEST, runJob),
    ).rejects.toThrow("no persisted native receipt");
  });
  it("is refused at its intent before any Job when the lease lapsed (D7)", async () => {
    server.lapsed = true;
    const runJob = vi.fn(async (): Promise<unknown> => ({}));
    await expect(
      runDeliveryTestStage("deployment/test", REQUEST, runJob),
    ).rejects.toThrow(/lease lapsed/u);
    expect(runJob).not.toHaveBeenCalled();
  });
});
