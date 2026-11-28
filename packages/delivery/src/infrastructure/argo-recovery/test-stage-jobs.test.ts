import { describe, expect, it } from "vitest";
import { createRecoveryInspector } from "#infrastructure/recovery.ts";
import { recipeFromPipeline } from "#shared/model/recipe-adapter.ts";
import { RecipeDefinitionSchema } from "#shared/model/recipe-contract.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import { arcadePipeline } from "#testing/model-fixture.ts";
import { DeploymentDetailSchema } from "#shared/contract.ts";
import { createWorkerJobsReader } from "./test-stage-jobs.ts";

const timestamp = "2026-11-22T00:00:00.000Z";
const deploymentId = "deployment/test-stage-1";
const syncRequestId = deliveryOperationId(deploymentId);
const argoOperationId = "77777777-7777-4777-8777-777777777777";
const jobName = `delivery-${"a".repeat(40)}`;
const jobUid = "88888888-8888-4888-8888-888888888888";
const jobFingerprint = "f".repeat(64);

function buildDetail(compound: boolean) {
  const baseRecipe = recipeFromPipeline(arcadePipeline);
  if (baseRecipe.kind !== "kubernetes-application")
    throw new Error("Expected kubernetes-application recipe");
  const withTests = RecipeDefinitionSchema.parse({
    ...baseRecipe,
    oracle: {
      ...baseRecipe.oracle,
      tests: [{ suite: "smoke", resultPath: "packages/arcade/results.json" }],
    },
  });
  const companion = structuredClone(baseRecipe);
  companion.application.name = "arcade-companion";
  companion.steps = companion.steps.map((step) => ({
    ...step,
    instance: "application:arcade-companion",
  }));
  const definition = compound
    ? RecipeDefinitionSchema.parse({
        kind: "compound",
        subRecipes: [
          { instance: "application:arcade", definition: withTests },
          { instance: "application:arcade-companion", definition: companion },
        ],
      })
    : withTests;
  const syncKey = compound ? "sub1-step-sync" : "step-sync";
  const testKey = compound ? "sub1-test-smoke" : "test-smoke";
  const receipt = {
    namespace: "delivery-worker-jobs",
    name: jobName,
    uid: jobUid,
    specFingerprint: jobFingerprint,
    requestId: deploymentId,
  };
  return DeploymentDetailSchema.parse({
    deployment: {
      id: deploymentId,
      requestId: "req/1",
      environmentId: "arcade/prod",
      serviceId: "arcade",
      versionSetRevisionId: "vs/1",
      pipelineRevisionId: "arcade/1",
      configurationId: "cfg/1",
      catalogRevision: "cat/1",
      expectedGeneration: 0,
      kind: "deploy",
      status: "failed",
      requestedBy: "operator",
      message: "Lost lease during test stage",
      cancelRequested: false,
      recoveryRequired: true,
      createdAt: timestamp,
      startedAt: timestamp,
      finishedAt: timestamp,
    },
    environment: {
      id: "arcade/prod",
      serviceId: "arcade",
      name: "prod",
      application: "arcade",
      pipelineRevisionId: "arcade/1",
      declaredConfigurationId: "cfg/1",
      automatic: true,
      promotionSourceEnvironmentId: null,
      role: "durable",
      lifecycle: "active",
      approvalPolicy: "none",
      acceptedDeploymentId: null,
      generation: 1,
      desiredVersionSetRevisionId: "vs/1",
      observedVersionSetRevisionId: null,
      acceptedVersionSetRevisionId: null,
      observedAt: null,
      activeDeploymentId: deploymentId,
      createdAt: timestamp,
    },
    versionSet: {
      id: "vs/1",
      serviceId: "arcade",
      revision: 1,
      baseRevisionId: null,
      lineage: "0".repeat(64),
      orderKey: "0000000001.0000000000",
      createdAt: timestamp,
      components: {},
    },
    pipeline: { id: "arcade/1", createdAt: timestamp, definition },
    configuration: { id: "cfg/1", content: {} },
    evidence: [],
    stages: [
      {
        id: "stage/sync",
        deploymentId,
        key: syncKey,
        status: "succeeded",
        operationId: syncRequestId,
        message: "synced",
        startedAt: timestamp,
        updatedAt: timestamp,
      },
      ...(compound
        ? [
            {
              id: "stage/sync-2",
              deploymentId,
              key: "sub2-step-sync",
              status: "succeeded" as const,
              operationId: syncRequestId,
              message: "synced",
              startedAt: timestamp,
              updatedAt: timestamp,
            },
          ]
        : []),
      {
        id: "stage/test",
        deploymentId,
        key: testKey,
        status: "running",
        operationId: jobName,
        message: JSON.stringify(receipt),
        startedAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  });
}

function settledApp(name: string) {
  return {
    metadata: {
      name,
      resourceVersion: "99",
      annotations: { "delivery.shepherdjerred.com/environment": "arcade/prod" },
    },
    operation: null,
    status: {
      operationState: {
        phase: "Succeeded",
        finishedAt: timestamp,
        operation: {
          info: [
            { name: "ci.sjer.red/request-id", value: syncRequestId },
            { name: "ci.sjer.red/operation-id", value: argoOperationId },
          ],
        },
      },
      resources: [],
    },
  };
}

describe("createRecoveryInspector test-stage Job fencing (AI-353)", () => {
  it.each([false, true])(
    "requires terminal delivery-worker-jobs Job and Pod when test stage was recorded (compound=%s)",
    async (compound) => {
      const detail = buildDetail(compound);
      await expect(
        createRecoveryInspector({
          readApplication: async (name) => settledApp(name),
        })(detail, { operationId: argoOperationId, reason: "inspect" }),
      ).rejects.toMatchObject({ code: "PAUSED" });

      let jobState: { active: number; complete: boolean } = {
        active: 1,
        complete: false,
      };
      let podPhase = "Running";
      const readWorkerJobs = createWorkerJobsReader(async (path) => {
        if (
          path.includes("/apis/batch/v1/namespaces/delivery-worker-jobs/jobs/")
        ) {
          return {
            metadata: {
              name: jobName,
              namespace: "delivery-worker-jobs",
              uid: jobUid,
              annotations: {
                "delivery.shepherdjerred.com/request": deploymentId,
                "delivery.shepherdjerred.com/fingerprint": jobFingerprint,
              },
            },
            status: {
              active: jobState.active,
              conditions: jobState.complete
                ? [{ type: "Complete", status: "True" }]
                : [],
            },
          };
        }
        return {
          items: [
            {
              metadata: {
                ownerReferences: [{ kind: "Job", uid: jobUid }],
              },
              status: { phase: podPhase },
            },
          ],
        };
      });
      const inspect = createRecoveryInspector({
        readApplication: async (name) => settledApp(name),
        readWorkerJobs,
      });

      await expect(
        inspect(detail, { operationId: argoOperationId, reason: "inspect" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      jobState = { active: 0, complete: true };
      await expect(
        inspect(detail, { operationId: argoOperationId, reason: "inspect" }),
      ).rejects.toMatchObject({ code: "CONFLICT" });

      podPhase = "Succeeded";
      const evidence = await inspect(detail, {
        operationId: argoOperationId,
        reason: "inspect",
      });
      expect(evidence).toHaveLength(compound ? 3 : 2);
      expect(evidence.at(-1)).toEqual({
        kind: "reconciliation",
        operationId: jobUid,
        summary: `Terminal test stage Job delivery-worker-jobs/${jobName}, exact UID ${jobUid}, fingerprint ${jobFingerprint}`,
      });
    },
  );
});
