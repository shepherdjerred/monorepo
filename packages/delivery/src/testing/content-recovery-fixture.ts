import type { Delivery } from "#infrastructure/delivery.ts";
import { testExecutor, testOperator, testPublisher } from "./seed.ts";
import { deliveryOperationId } from "#shared/operation-id.ts";
import { fingerprint } from "#infrastructure/delivery-records.ts";
import type {
  ContentRecoveryContext,
  ContentRecoveryOwnership,
} from "#shared/contract.ts";

/** Genuine disposable qualification and ordinary claims; no accepted-state import. */
export async function contentRecoveryFixture(
  delivery: Delivery,
  configuration?: Record<string, string>,
) {
  const build = await delivery.publish(
    {
      requestId: "content/source",
      serviceId: "static-sites",
      sourceRevision: "b".repeat(40),
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/100",
      verifiedAt: new Date().toISOString(),
      artifacts: [
        {
          id: "site/archive",
          kind: "archive",
          component: "site:sjer-red",
          uri: `s3://delivery-artifacts/sites/sjer-red/${"a".repeat(64)}.tar`,
          version: "2.0.0-100",
          digest: `sha256:${"a".repeat(64)}`,
        },
      ],
    },
    testPublisher,
    { repositoryId: 1, pipelineNumber: 100 },
  );
  await delivery.qualify(build.buildId, "verified", testExecutor);
  const [version] = await delivery.versions("static-sites");
  if (version === undefined)
    throw new Error("Qualified static test archive missing");
  const versionId = version.id;
  await delivery.registerPipeline(
    "content/pipeline",
    {
      kind: "static-site",
      bucket: "sjer-red",
      archiveComponent: "site:sjer-red",
      immutablePrefixes: [],
      extraExcludes: [],
      entrypoints: ["index.html"],
      verification: { url: "https://sjer.red", expectedStatus: 200 },
    },
    testOperator,
  );
  const env = await delivery.registerEnvironment(
    {
      id: "static-sites/sjer-red",
      serviceId: "static-sites",
      name: "sjer-red",
      pipelineRevisionId: "content/pipeline",
      configurationRevision: "content/config",
      configuration: {},
      automatic: false,
    },
    testOperator,
  );
  async function deployment(requestId: string) {
    const current = await delivery.database.environment.findUniqueOrThrow({
      where: { id: env.id },
    });
    return delivery.createDeployment(
      {
        requestId,
        environmentId: env.id,
        expectedGeneration: current.generation,
        versionSetRevisionId: versionId,
        kind: "deploy",
      },
      testOperator,
    );
  }
  async function accept(requestId: string) {
    const selected = await deployment(requestId);
    await delivery.claim(selected.id, testExecutor);
    await delivery.finish(
      selected.id,
      {
        status: "succeeded",
        message: "Independent exact archive/public receipt fixture",
        observedRevisionId: versionId,
        recoveryRequired: false,
        evidence: [
          {
            kind: "reconciliation",
            summary: "All frozen object bytes verified",
          },
          {
            kind: "acceptance",
            summary: "Public entrypoints match the frozen archive",
          },
        ],
      },
      testExecutor,
    );
    return selected;
  }
  const firstAccepted = await accept("content/accepted");
  let accepted = firstAccepted;
  if (configuration !== undefined) {
    await delivery.registerEnvironment(
      {
        id: env.id,
        serviceId: env.serviceId,
        name: env.name,
        pipelineRevisionId: env.pipelineRevisionId,
        configurationRevision: "content/second-config",
        configuration,
        automatic: false,
      },
      testOperator,
    );
    accepted = await accept("content/second-accepted");
  }
  const failed = await deployment("content/failed");
  await delivery.claim(failed.id, testExecutor);
  await delivery.stage(
    failed.id,
    {
      key: "reconcile",
      status: "running",
      operationId: failed.id,
      message: "S3 sync begun, cache response lost",
      evidence: [],
    },
    testExecutor,
  );
  await delivery.finish(
    failed.id,
    {
      status: "failed",
      message: "Static sync/cache response ambiguous",
      recoveryRequired: true,
      evidence: [],
    },
    testExecutor,
  );
  const current = await delivery.detail(failed.id);
  const request = {
    requestId: "content/recovery/first",
    expectedEnvironmentGeneration: current.environment.generation,
    reason:
      "Independently inspect and repair exact static publication after lost cache response",
  };
  const intent = await delivery.requestContentRecovery(
    failed.id,
    request,
    testOperator,
  );
  return {
    delivery,
    accepted,
    firstAccepted,
    failed,
    request,
    intent,
    deployment,
  };
}

export const contentBarrier = {
  adapter: "control-plane-dispatch-barrier/v1" as const,
  deploymentUID: "ordinary-host-original-uid",
  templateFingerprint: "a".repeat(64),
  priorReplicas: 1 as const,
  podUIDs: ["original-mutating-activity-pod"],
  replicaSetUIDs: ["original-worker-replica-set"],
};
export function contentNativeReceipt(
  id: string,
  action: "inspect" | "repair" = "inspect",
) {
  return {
    action,
    receipt: {
      namespace: "storm-forum" as const,
      name: `content-${action}-${fingerprint(id).slice(0, 12)}`,
      uid: crypto.randomUUID(),
      specFingerprint: "b".repeat(64),
      requestId: deliveryOperationId(`${id}:${action}`),
    },
  };
}
export function contentObservation(
  context: ContentRecoveryContext,
): ContentRecoveryOwnership {
  return {
    expectedEnvironmentGeneration: context.intent.expectedEnvironmentGeneration,
    snapshotFingerprint: context.intent.snapshotFingerprint,
    observedAt: new Date().toISOString(),
    sourceWorkflow: {
      workflowId: `delivery/${context.intent.deploymentId}`,
      status: "FAILED",
    },
    quiescence: {
      journalFingerprint: fingerprint(contentBarrier),
      deploymentUID: contentBarrier.deploymentUID,
      templateFingerprint: contentBarrier.templateFingerprint,
      replicas: 0,
      remainingPodUIDs: [],
    },
    nativeJobs: context.recoveryHistory.flatMap((intent) =>
      intent.nativeReceipts.map((entry) => ({
        ...entry.receipt,
        status: "Complete" as const,
        podsAbsent: true,
        podsTerminal: true as const,
      })),
    ),
  };
}
