import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  DeliveryJobReceipt,
  DeliveryJobRequest,
} from "#shared/delivery-job.ts";

const requests: { path: string; body: unknown }[] = [];
vi.mock("#lib/delivery/client.ts", () => ({
  deliveryRequest: vi.fn(
    async (path: string, _schema: unknown, body?: unknown) => {
      requests.push({ path, body });
      return {};
    },
  ),
}));

const { runDeliveryTestStage } = await import("./test-stage.ts");

afterEach(() => {
  requests.splice(0);
});

describe("runDeliveryTestStage", () => {
  it("records the stage running on the Job receipt and returns test evidence", async () => {
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
      {
        stageKey: "test-e2e",
        suite: "test:e2e",
        workspace: "packages/delivery",
        sourceRevision: "b".repeat(40),
        runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
      },
      runJob,
    );
    expect(requests).toEqual([
      {
        path: "deployments/deployment%2Ftest/stages",
        body: {
          key: "test-e2e",
          status: "running",
          operationId: expect.stringMatching(/^delivery-[a-f0-9]{40}$/u),
          message: JSON.stringify(receipt),
          evidence: [],
        },
      },
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
      runDeliveryTestStage(
        "deployment/test",
        {
          stageKey: "test-e2e",
          suite: "test:e2e",
          workspace: "packages/delivery",
          sourceRevision: "b".repeat(40),
          runnerImage: `docker.io/shepherdjerred/ci-base@sha256:${"a".repeat(64)}`,
        },
        runJob,
      ),
    ).rejects.toThrow("no persisted native receipt");
  });
});
