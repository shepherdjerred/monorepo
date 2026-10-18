import { expect, test } from "vitest";
import {
  ArtifactVersionSchema,
  PlatformReleaseSnapshotSchema,
} from "@shepherdjerred/delivery/contract";
import { VERIFIED_ROOT_RELEASE_ANNOTATION } from "@shepherdjerred/ops-model/argocd-release-receipt.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { inspectRootRecovery } from "#lib/delivery/platform/recovery-root.ts";

function fixture() {
  const requestId = deliveryOperationId("failed/root:root-release"),
    operationId = crypto.randomUUID();
  const time = new Date().toISOString(),
    revision = "2.0.0-900";
  const artifact = (name: string) =>
    ArtifactVersionSchema.parse({
      id: `chart/${name}`,
      component: `chart:${name}`,
      kind: "chart",
      uri: `https://chartmuseum.tailnet-1a49.ts.net/charts/${name}-${revision}.tgz`,
      digest: `sha256:${"a".repeat(64)}`,
      version: revision,
      serviceId: "gitops",
      buildId: "build/root",
      sourceRevision: "b".repeat(40),
      createdAt: time,
    });
  const snapshot = PlatformReleaseSnapshotSchema.parse({
    kind: "root-release",
    source: {
      id: "build/root",
      sourceRevision: "b".repeat(40),
      repositoryId: 1,
      pipelineNumber: 900,
      ciUrl: "https://woodpecker.sjer.red/repos/1/pipeline/900",
    },
    charts: ["apps", "argocd"].map((name) => ({
      name,
      artifact: artifact(name),
    })),
    prerequisites: [],
    policyFingerprint: "c".repeat(64),
  });
  const context = {
    deployment: {
      deployment: { id: "failed/root", platformSnapshot: snapshot },
    },
    priorDeployment: null,
  };
  const source = (chart: string) => ({
    repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
    chart,
    targetRevision: revision,
    helm: {
      parameters: [{ name: "static", value: "frozen", forceString: true }],
    },
  });
  const receipt = {
    schema: "homelab-verified-root-release/v1",
    outcome: "applied-verified",
    rootApplication: "apps",
    requestId,
    operationId,
    revision,
    operationStartedAt: time,
    operationFinishedAt: time,
    verifiedAt: time,
    finalHealth:
      "published-applications-synced-healthy-retained-applications-observed",
  };
  const root = {
    metadata: {
      name: "apps",
      annotations: {
        [VERIFIED_ROOT_RELEASE_ANNOTATION]: JSON.stringify(receipt),
      },
    },
    spec: {
      source: {
        repoURL: "https://chartmuseum.tailnet-1a49.ts.net",
        chart: "apps",
        targetRevision: revision,
      },
    },
    status: {
      sync: { status: "Synced", revision },
      operationState: {
        phase: "Failed",
        message: "Operation terminated",
        startedAt: time,
        finishedAt: time,
        operation: {
          initiatedBy: { username: "woodpecker" },
          sync: { revision, prune: true },
          info: [
            { name: "ci.sjer.red/request-id", value: requestId },
            { name: "ci.sjer.red/operation-id", value: operationId },
            { name: "ci.sjer.red/revision", value: revision },
            { name: "ci.sjer.red/release-phase", value: "prune" },
          ],
        },
        syncResult: { revision, resources: [{ status: "Synced" }] },
      },
    },
  };
  const child = {
    spec: { source: source("argocd") },
    status: {
      sync: { status: "Synced", revision },
      health: { status: "Healthy" },
      operationState: { phase: "Succeeded" },
    },
  };
  const effects = {
    read: async (name: string) => (name === "apps" ? root : child),
    render: async () => [
      {
        kind: "Application",
        metadata: { name: "argocd" },
        spec: { source: source("argocd") },
      },
    ],
  };
  return { context, root, child, effects };
}
test("recovery accepts only the owned verified root termination plus the full frozen child source", async () => {
  const { context, effects, root, child } = fixture();
  const observed = await inspectRootRecovery(context, effects);
  expect(observed.state).toBe("desired");
  child.spec.source.helm.parameters[0]!.value = "foreign";
  await expect(inspectRootRecovery(context, effects)).rejects.toThrow(
    "frozen exact charts",
  );
  child.spec.source.helm.parameters[0]!.value = "frozen";
  await expect(
    inspectRootRecovery(context, {
      ...effects,
      read: async (name) =>
        name === "apps" ? { ...root, operation: { sync: {} } } : child,
    }),
  ).rejects.toThrow();
  root.status.operationState.operation.info[0]!.value = crypto.randomUUID();
  await expect(inspectRootRecovery(context, effects)).rejects.toThrow(
    "verified complete",
  );
});
