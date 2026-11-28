import { describe, expect, it } from "vitest";
import type { V1Job, V1Pod } from "@kubernetes/client-node";
import {
  DeploymentDetailSchema,
  WorkerRecoveryContextSchema,
} from "@shepherdjerred/delivery/contract";
import { deliveryJobManifest } from "#lib/delivery/job-manifest.ts";
import { frozenRunnerImage } from "#lib/delivery/model/oracle-inputs.ts";
import { timestamp } from "#lib/delivery/model/testing.ts";
import type { DeliveryJobRequest } from "#shared/delivery-job.ts";
import { definition, temporal } from "./model-worker-fixture.ts";
import { proveTerminalWorkerJobs } from "./worker-recovery-jobs.ts";

function buildWorkerTestFixture(compound: boolean) {
  const withSuite = {
    ...definition,
    oracle: {
      ...definition.oracle,
      tests: [{ suite: "smoke", resultPath: "packages/temporal/results.json" }],
    },
  };
  const recipe = compound
    ? {
        kind: "compound",
        subRecipes: [
          {
            instance: "application:temporal-companion",
            definition: {
              ...withSuite,
              application: {
                ...withSuite.application,
                name: "temporal-companion",
              },
              steps: withSuite.steps.slice(0, 2).map((step) => ({
                ...step,
                instance: "application:temporal-companion",
              })),
            },
          },
          { instance: "application:temporal", definition: withSuite },
        ],
      }
    : withSuite;
  const stageKey = compound ? "sub1-test-smoke" : "test-smoke";
  const base = temporal([], []);
  const runnerImage = frozenRunnerImage(base, withSuite.runner);
  const sourceRevision =
    base.versionSet.components[withSuite.chartComponent]?.sourceRevision ?? "";
  const testRequest: DeliveryJobRequest = {
    deploymentId: base.deployment.id,
    stageKey,
    recipe: "test",
    runnerImage,
    sourceRevision,
    input: { suite: "smoke", workspace: "packages/temporal" },
  };
  const manifest = deliveryJobManifest(testRequest);
  const operationId = manifest.metadata?.name ?? "";
  const uid = "11111111-2222-4333-8444-555555555555";
  const fingerprint =
    manifest.metadata?.annotations?.[
      "delivery.shepherdjerred.com/fingerprint"
    ] ?? "";
  const receipt = {
    namespace: "delivery-worker-jobs" as const,
    name: operationId,
    uid,
    specFingerprint: fingerprint,
    requestId: base.deployment.id,
  };
  const detail = DeploymentDetailSchema.parse({
    ...base,
    pipeline: { ...base.pipeline, definition: recipe },
    deployment: {
      ...base.deployment,
      status: "failed",
      recoveryRequired: true,
    },
    stages: [
      {
        id: "stage/test",
        deploymentId: base.deployment.id,
        key: stageKey,
        status: "running",
        operationId,
        message: JSON.stringify(receipt),
        startedAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  });
  const sha = "f".repeat(64);
  const context = WorkerRecoveryContextSchema.parse({
    deployment: detail,
    pool: {
      versions: detail.deployment.workerSnapshot?.versions ?? [],
      generation: 0,
      environmentId: detail.environment.id,
    },
    intent: {
      status: "pending",
      id: "intent-353",
      deploymentId: detail.deployment.id,
      expectedEnvironmentGeneration: detail.environment.generation,
      requestedBy: "operator-353",
      reason: "Verify test-stage Job fencing",
      snapshotFingerprint: sha,
      poolFingerprint: sha,
      workflowId: "wf-353",
      createdAt: timestamp,
      submittedAt: null,
      finishedAt: null,
      message: null,
    },
  });
  const job: V1Job = structuredClone(manifest);
  job.metadata = structuredClone(job.metadata) ?? {};
  job.metadata.uid = uid;
  return { context, job, operationId, uid, fingerprint, stageKey };
}

describe("proveTerminalWorkerJobs test-stage fencing (AI-353)", () => {
  it.each([false, true])(
    "refuses while recorded test stage Job or Pod is active (compound=%s), and settles once terminal",
    async (compound) => {
      const { context, job, operationId, uid, fingerprint } =
        buildWorkerTestFixture(compound);
      job.status = { active: 1, conditions: [] };
      let pods: V1Pod[] = [];
      const reader = {
        job: async (name: string) => {
          expect(name).toBe(operationId);
          return job;
        },
        pods: async () => pods,
      };
      await expect(proveTerminalWorkerJobs(context, reader)).rejects.toThrow(
        "Recovery Job is not independently terminal",
      );

      job.status = {
        active: 0,
        conditions: [{ type: "Failed", status: "True" }],
      };
      pods = [
        {
          metadata: {
            ownerReferences: [
              { kind: "Job", uid, apiVersion: "batch/v1", name: operationId },
            ],
          },
          status: { phase: "Running" },
        },
      ];
      await expect(proveTerminalWorkerJobs(context, reader)).rejects.toThrow(
        "Recovery Job still has a live or terminating executor Pod",
      );

      pods = [
        {
          metadata: {
            ownerReferences: [
              { kind: "Job", uid, apiVersion: "batch/v1", name: operationId },
            ],
          },
          status: { phase: "Failed" },
        },
      ];
      const evidence = await proveTerminalWorkerJobs(context, reader);
      expect(evidence).toEqual([
        {
          kind: "reconciliation",
          operationId: uid,
          summary: `Terminal fixed test Job delivery-worker-jobs/${operationId}, exact UID ${uid}, fingerprint ${fingerprint}`,
        },
      ]);
    },
  );

  it("proves an uncreated pre-receipt test stage Job when GET returns 404 and no Pods exist", async () => {
    const { context, operationId } = buildWorkerTestFixture(false);
    context.deployment.stages[0]!.message =
      "Waiting for an identity-bound revision-pinned Job";
    const evidence = await proveTerminalWorkerJobs(context, {
      job: () =>
        Promise.reject(Object.assign(new Error("absent"), { code: 404 })),
      pods: async () => [],
    });
    expect(evidence).toEqual([
      {
        kind: "reconciliation",
        operationId,
        summary: `Read-only test Job delivery-worker-jobs/${operationId} was not created: authenticated GET 404, no recorded native receipt and no executor Pods`,
      },
    ]);
  });
});
