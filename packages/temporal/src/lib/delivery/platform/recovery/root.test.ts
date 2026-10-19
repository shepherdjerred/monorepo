import { expect, test } from "vitest";
import {
  ArtifactVersionSchema,
  PlatformReleaseSnapshotSchema,
} from "@shepherdjerred/delivery/contract";
import {
  VERIFIED_ROOT_RELEASE_ANNOTATION,
  VerifiedRootReleaseReceiptSchema,
} from "@shepherdjerred/ops-model/argocd-release-receipt.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";
import { inspectRootRecovery } from "#lib/delivery/platform/recovery-root.ts";
import { inspectStoppedRootRecovery } from "#lib/delivery/platform/recovery/root-stopped.ts";
import { DELIVERY_ROOT_IGNORE_EXPRESSIONS } from "homelab/src/delivery-ownership.ts";

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
      health: { status: "Progressing" },
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

test("verified root recovery accepts canonical floating source with exact receipt revision and retained Progressing health", async () => {
  const { context, root, effects } = fixture();
  root.spec.source.targetRevision = "~2.0.0-0";
  const observed = await inspectRootRecovery(context, effects);
  expect(observed.state).toBe("desired");
  expect(root.status.health.status).toBe("Progressing");
  expect(root.status.sync.revision).toBe("2.0.0-900");
});

test("floating root recovery retains exact receipt, source, child health and final observation fences", async () => {
  for (const drift of [
    "health",
    "revision",
    "source",
    "receipt",
    "child",
    "late-source",
    "late-receipt",
  ]) {
    const { context, root, child, effects } = fixture();
    root.spec.source.targetRevision = "~2.0.0-0";
    if (drift === "health") root.status.health.status = "Degraded";
    if (drift === "revision") root.status.sync.revision = "2.0.0-901";
    if (drift === "source") root.spec.source.targetRevision = "~2.0.0";
    if (drift === "receipt")
      root.status.operationState.operation.info[1]!.value = crypto.randomUUID();
    if (drift === "child") child.status.health.status = "Progressing";
    let reads = 0;
    await expect(
      inspectRootRecovery(context, {
        ...effects,
        read: async (name) => {
          if (name !== "apps") return child;
          reads += 1;
          const observed = structuredClone(root);
          if (reads === 2 && drift === "late-source")
            observed.spec.source.targetRevision = "2.0.0-900";
          if (reads === 2 && drift === "late-receipt") {
            const value = JSON.parse(
              observed.metadata.annotations[VERIFIED_ROOT_RELEASE_ANNOTATION],
            );
            value.verifiedAt = new Date(
              Date.parse(value.verifiedAt) + 1,
            ).toISOString();
            observed.metadata.annotations[VERIFIED_ROOT_RELEASE_ANNOTATION] =
              JSON.stringify(value);
          }
          return observed;
        },
      }),
    ).rejects.toThrow();
  }
});

function stoppedMetadata(name: string) {
  return {
    name,
    namespace: "argocd",
    uid: crypto.randomUUID(),
    annotations: {
      "ci.sjer.red/application-lifecycle": "retain",
      "argocd.argoproj.io/tracking-id": `apps:argoproj.io/Application:argocd/${name}`,
    },
  };
}
function stoppedFixture() {
  const original = fixture();
  const context = {
    ...original.context,
    deployment: {
      deployment: {
        ...original.context.deployment.deployment,
        status: "failed" as const,
        recoveryRequired: true,
      },
      environment: { acceptedPlatformDeploymentId: null },
    },
  };
  const root = {
    ...original.root,
    metadata: stoppedMetadata("apps"),
    spec: {
      ...original.root.spec,
      source: { ...original.root.spec.source, targetRevision: "~2.0.0-0" },
      destination: {
        namespace: "argocd",
        server: "https://kubernetes.default.svc",
      },
      syncPolicy: {
        automated: { enabled: false },
        syncOptions: ["RespectIgnoreDifferences=true"],
      },
      ignoreDifferences: [
        {
          group: "argoproj.io",
          kind: "Application",
          jqPathExpressions: [...DELIVERY_ROOT_IGNORE_EXPRESSIONS],
        },
      ],
    },
    status: {
      ...original.root.status,
      sync: { status: "OutOfSync", revision: "2.0.0-901" },
      health: { status: "Progressing" },
    },
  };
  const child = {
    ...original.child,
    metadata: stoppedMetadata("argocd"),
    spec: {
      ...original.child.spec,
      destination: {
        namespace: "argocd",
        server: "https://kubernetes.default.svc",
      },
    },
  };
  const manifests = [root, child].map(({ metadata: identity, spec }) => ({
    kind: "Application",
    metadata: structuredClone(identity),
    spec: structuredClone(spec),
  }));
  const effects = {
    read: async (name: string): Promise<unknown> =>
      structuredClone(name === "apps" ? root : child),
    render: async () => manifests,
  };
  return { context, root, child, effects };
}

test("stopped first-root inspection records actual partial state without claiming a verified release", async () => {
  const { context, effects, root, child } = stoppedFixture();
  Object.assign(child.metadata, {
    finalizers: [
      "post-delete-finalizer.argocd.argoproj.io",
      "post-delete-finalizer.argocd.argoproj.io/cleanup",
    ],
  });
  const proof = await inspectStoppedRootRecovery(context, effects);
  expect(proof.state).toBe("stopped");
  expect(proof.stoppedRoot.applications).toHaveLength(2);
  expect(
    proof.stoppedRoot.applications.find(({ name }) => name === "apps"),
  ).toMatchObject({
    uid: root.metadata.uid,
    targetRevision: "~2.0.0-0",
    syncStatus: "OutOfSync",
    health: "Progressing",
  });
  expect(root.status.sync.status).toBe("OutOfSync");
});

function stoppedWithPriorFixture() {
  const result = stoppedFixture();
  const priorId = "accepted/root";
  const priorSnapshot = structuredClone(
    result.context.deployment.deployment.platformSnapshot,
  );
  if (priorSnapshot.kind !== "root-release") throw new Error("Expected root");
  for (const chart of priorSnapshot.charts)
    chart.artifact.version = "2.0.0-899";
  const context = {
    ...result.context,
    deployment: {
      ...result.context.deployment,
      environment: { acceptedPlatformDeploymentId: priorId },
    },
    priorDeployment: {
      deployment: {
        id: priorId,
        status: "succeeded" as const,
        platformSnapshot: priorSnapshot,
      },
    },
  };
  const receipt = VerifiedRootReleaseReceiptSchema.parse(
    JSON.parse(
      fixture().root.metadata.annotations[VERIFIED_ROOT_RELEASE_ANNOTATION],
    ),
  );
  Object.assign(result.root.metadata.annotations, {
    [VERIFIED_ROOT_RELEASE_ANNOTATION]: JSON.stringify({
      ...receipt,
      requestId: deliveryOperationId(`${priorId}:root-release`),
      revision: "2.0.0-899",
    }),
  });
  return { ...result, context };
}

test("stopped later root preserves the historical accepted root while reporting the actual failed attempt", async () => {
  const { context, effects, root } = stoppedWithPriorFixture();
  const before = structuredClone(context);
  const proof = await inspectStoppedRootRecovery(context, effects);
  expect(proof.state).toBe("stopped");
  expect(proof.stoppedRoot.revision).toBe("2.0.0-900");
  expect(proof.proofSummary).toContain("prior accepted/root unchanged");
  expect(context).toEqual(before);
  expect(root.status.sync.status).toBe("OutOfSync");
});

test.each([
  "pointer",
  "status",
  "kind",
  "receipt-missing",
  "receipt-request",
  "receipt-revision",
  "receipt-time",
])("stopped later root rejects changed prior %s", async (change) => {
  const { context, effects, root } = stoppedWithPriorFixture();
  if (change === "pointer")
    context.deployment.environment.acceptedPlatformDeploymentId =
      "foreign/root";
  if (change === "status")
    Object.assign(context.priorDeployment.deployment, { status: "failed" });
  if (change === "kind")
    Object.assign(context.priorDeployment.deployment.platformSnapshot, {
      kind: "tofu-plan",
    });
  if (change === "receipt-missing")
    Reflect.deleteProperty(
      root.metadata.annotations,
      VERIFIED_ROOT_RELEASE_ANNOTATION,
    );
  else {
    const encoded = Object.entries(root.metadata.annotations).find(
      ([name]) => name === VERIFIED_ROOT_RELEASE_ANNOTATION,
    )?.[1];
    if (encoded === undefined) throw new Error("Expected historical receipt");
    const receipt = VerifiedRootReleaseReceiptSchema.parse(JSON.parse(encoded));
    if (change === "receipt-request") receipt.requestId = crypto.randomUUID();
    if (change === "receipt-revision") receipt.revision = "2.0.0-898";
    if (change === "receipt-time")
      receipt.verifiedAt = "2000-01-01T00:00:00.000Z";
    Object.assign(root.metadata.annotations, {
      [VERIFIED_ROOT_RELEASE_ANNOTATION]: JSON.stringify(receipt),
    });
  }
  await expect(inspectStoppedRootRecovery(context, effects)).rejects.toThrow();
});

function stoppedStageFixture() {
  const result = stoppedFixture();
  const { root, child } = result;
  root.status.operationState.phase = "Succeeded";
  root.status.operationState.syncResult.revision = "";
  root.status.operationState.operation.info[3]!.value = "stage";
  Object.assign(root.status.operationState.operation, {
    sync: {
      manifests: [
        JSON.stringify({
          kind: "Application",
          metadata: child.metadata,
          spec: child.spec,
        }),
      ],
      resources: [
        {
          group: "argoproj.io",
          kind: "Application",
          namespace: "argocd",
          name: "argocd",
        },
      ],
      source: root.spec.source,
    },
  });
  Object.assign(root.status, { sync: { status: "OutOfSync" } });
  const receipt = VerifiedRootReleaseReceiptSchema.parse(
    JSON.parse(
      fixture().root.metadata.annotations[VERIFIED_ROOT_RELEASE_ANNOTATION],
    ),
  );
  Object.assign(root.metadata.annotations, {
    [VERIFIED_ROOT_RELEASE_ANNOTATION]: JSON.stringify({
      ...receipt,
      requestId: crypto.randomUUID(),
      revision: "2.0.0-899",
    }),
  });
  return result;
}

test("stopped first-root accepts only its partial succeeded inline stage without a current complete receipt", async () => {
  const { context, effects, root } = stoppedStageFixture();
  const proof = await inspectStoppedRootRecovery(context, effects);
  expect(proof.state).toBe("stopped");
  expect(proof.stoppedRoot.revision).toBe("2.0.0-900");
  expect(
    proof.stoppedRoot.applications.find(({ name }) => name === "apps"),
  ).toMatchObject({
    uid: root.metadata.uid,
    operationPhase: "Succeeded",
    observedRevision: null,
    targetRevision: "~2.0.0-0",
    health: "Progressing",
  });
  expect(root.status.operationState.syncResult.revision).toBe("");
});

test.each([
  "phase",
  "duplicate-phase",
  "revision",
  "request",
  "result-revision",
  "prune",
  "manifests",
  "foreign-manifest",
  "resources",
  "receipt",
  "late-operation",
])("stopped succeeded stage refuses %s", async (change) => {
  const { context, effects, root } = stoppedStageFixture();
  const operation = root.status.operationState.operation;
  if (change === "phase") operation.info[3]!.value = "prune";
  if (change === "duplicate-phase")
    operation.info.push({ ...operation.info[3]! });
  if (change === "revision") operation.info[2]!.value = "2.0.0-901";
  if (change === "request") operation.info[0]!.value = crypto.randomUUID();
  if (change === "result-revision")
    root.status.operationState.syncResult.revision = "2.0.0-900";
  if (change === "prune") Object.assign(operation.sync, { prune: true });
  if (change === "manifests") Object.assign(operation.sync, { manifests: [] });
  if (change === "foreign-manifest")
    Object.assign(operation.sync, {
      manifests: [
        JSON.stringify({
          kind: "Application",
          metadata: { namespace: "argocd", name: "foreign" },
        }),
      ],
    });
  if (change === "resources") Object.assign(operation.sync, { resources: [] });
  if (change === "receipt")
    Object.assign(
      root.metadata.annotations,
      fixture().root.metadata.annotations,
    );
  let reads = 0;
  await expect(
    inspectStoppedRootRecovery(context, {
      ...effects,
      read: async (name) => {
        const observed = await effects.read(name);
        return name === "apps" && change === "late-operation" && reads++ > 0
          ? { ...root, operation: { sync: {} } }
          : observed;
      },
    }),
  ).rejects.toThrow();
});

test("stopped first-root proof refuses prior acceptance, foreign source/ownership, active operations and late UID changes", async () => {
  for (const change of [
    "prior",
    "accepted",
    "source",
    "request",
    "lifecycle",
    "active",
    "late-uid",
    "foreign-finalizer",
  ]) {
    const { context, effects, child, root } = stoppedFixture();
    if (change === "prior")
      Object.assign(context, { priorDeployment: context.deployment });
    if (change === "accepted")
      Object.assign(context.deployment.environment, {
        acceptedPlatformDeploymentId: "prior/root",
      });
    if (change === "source")
      child.spec.source.repoURL = "https://foreign.invalid";
    if (change === "request")
      root.status.operationState.operation.info[0]!.value = crypto.randomUUID();
    if (change === "lifecycle")
      child.metadata.annotations["ci.sjer.red/application-lifecycle"] =
        "cascade";
    if (change === "foreign-finalizer")
      Object.assign(child.metadata, { finalizers: ["foreign/owner"] });
    let reads = 0;
    await expect(
      inspectStoppedRootRecovery(context, {
        ...effects,
        read: async (name) => {
          const actual = await effects.read(name);
          if (change === "active" && name === "argocd")
            return { ...child, operation: { sync: {} } };
          reads += 1;
          if (change === "late-uid" && name === "argocd" && reads > 2)
            return {
              ...child,
              metadata: { ...child.metadata, uid: crypto.randomUUID() },
            };
          return actual;
        },
      }),
    ).rejects.toThrow();
  }
});
