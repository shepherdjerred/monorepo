import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ArtifactVersion,
  PlatformRecoveryContext,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  VERIFIED_ROOT_RELEASE_ANNOTATION,
  VerifiedRootReleaseReceiptSchema,
} from "@shepherdjerred/ops-model/argocd-release-receipt.ts";
import { assertDeliveryRootPreservesSelection } from "homelab/scripts/argocd/argocd-delivery.ts";
import {
  completedOperationRequestId,
  completedOperationId,
  operationRevision,
  RELEASE_PHASE_INFO_NAME,
} from "homelab/scripts/argocd/argocd-manifest-overrides.ts";
import { deliveryOperationId } from "#lib/delivery/selection.ts";

const object = z.record(z.string(), z.unknown());
const application = z.object({
  metadata: z.object({
    name: z.string(),
    namespace: z.literal("argocd"),
    uid: z.uuid(),
    deletionTimestamp: z.null().optional(),
    annotations: z.record(z.string(), z.string()),
    finalizers: z.array(z.string()).optional(),
    labels: z.record(z.string(), z.string()).optional(),
    ownerReferences: z.array(object).optional(),
  }),
  operation: z.null().optional(),
  spec: object,
  status: z.object({
    sync: z.object({ status: z.string(), revision: z.string().optional() }),
    health: z.object({ status: z.string() }).optional(),
    operationState: z
      .object({ phase: z.enum(["Succeeded", "Failed", "Error"]) })
      .loose()
      .optional(),
  }),
});
const hash = (value: unknown) =>
  createHash("sha256").update(canonicalJson(value)).digest("hex");
const environmentAnnotation = "delivery.shepherdjerred.com/environment";
// ArgoCD v3.5.4 appcontroller.go:2092-2097 adds these for post-delete hooks.
const controllerFinalizers = new Set([
  "post-delete-finalizer.argocd.argoproj.io",
  "post-delete-finalizer.argocd.argoproj.io/cleanup",
]);

function requireStoppedOperation(
  root: ReturnType<typeof application.parse>,
  revision: string,
  names: ReadonlySet<string>,
) {
  const operation = z
    .object({
      phase: z.enum(["Succeeded", "Failed", "Error"]),
      finishedAt: z.string().min(1),
      startedAt: z.string().min(1),
      operation: object,
      syncResult: z.object({ revision: z.string() }),
    })
    .parse(root.status.operationState);
  if (operation.phase !== "Succeeded") {
    z.literal(revision).parse(operation.syncResult.revision);
    return operation;
  }
  const stage = z
    .object({
      sync: z.object({
        prune: z.literal(false).optional(),
        manifests: z.array(z.string().min(1)).min(1),
        resources: z
          .array(
            z.object({
              group: z.literal("argoproj.io"),
              kind: z.literal("Application"),
              namespace: z.literal("argocd"),
              name: z.string().min(1),
            }),
          )
          .min(1),
      }),
      info: z.array(z.object({ name: z.string(), value: z.string() })),
    })
    .parse(operation.operation);
  const phases = stage.info.filter(
    ({ name }) => name === RELEASE_PHASE_INFO_NAME,
  );
  if (
    operation.syncResult.revision !== "" ||
    phases.length !== 1 ||
    phases[0]?.value !== "stage"
  )
    throw new Error(
      "Stopped successful root operation is not an owned partial inline stage",
    );
  const staged = stage.sync.manifests.map(
    (manifest) =>
      z
        .object({
          kind: z.literal("Application"),
          metadata: z.object({
            namespace: z.literal("argocd"),
            name: z.string().min(1),
          }),
        })
        .parse(JSON.parse(manifest)).metadata.name,
  );
  if (
    new Set(staged).size !== staged.length ||
    staged.some((name) => !names.has(name)) ||
    canonicalJson([...staged].sort()) !==
      canonicalJson(stage.sync.resources.map(({ name }) => name).sort())
  )
    throw new Error(
      "Stopped inline stage resources differ from the frozen Application inventory",
    );
  const encoded = root.metadata.annotations[VERIFIED_ROOT_RELEASE_ANNOTATION];
  if (encoded !== undefined) {
    const receipt = VerifiedRootReleaseReceiptSchema.parse(JSON.parse(encoded));
    if (receipt.requestId === completedOperationRequestId(root))
      throw new Error(
        "Stopped stage already has a complete verified receipt for this request",
      );
  }
  return operation;
}

/** Only the two root-declared Delivery fields belong to the independent leaf owner. */
function rootOwnedSource(raw: unknown, delegated: boolean) {
  const source = object.parse(structuredClone(raw));
  if (delegated) {
    delete source["targetRevision"];
    if (source["helm"] !== undefined) {
      const helm = object.parse(source["helm"]);
      delete helm["parameters"];
      if (Object.keys(helm).length === 0) delete source["helm"];
      else source["helm"] = helm;
    }
  }
  return source;
}

type StoppedRootContext = {
  deployment: {
    deployment: Pick<
      PlatformRecoveryContext["deployment"]["deployment"],
      "id" | "platformSnapshot" | "status" | "recoveryRequired"
    >;
    environment: Pick<
      PlatformRecoveryContext["deployment"]["environment"],
      "acceptedPlatformDeploymentId"
    >;
  };
  priorDeployment: {
    deployment: Pick<
      PlatformRecoveryContext["deployment"]["deployment"],
      "id" | "platformSnapshot" | "status"
    >;
  } | null;
};

function requireAcceptedPrior(context: StoppedRootContext) {
  const prior = context.priorDeployment;
  const accepted = context.deployment.environment.acceptedPlatformDeploymentId;
  if (prior === null) {
    if (accepted !== null)
      throw new Error("Stopped root lost its accepted prior");
  } else if (
    prior.deployment.id === context.deployment.deployment.id ||
    prior.deployment.id !== accepted ||
    prior.deployment.status !== "succeeded" ||
    prior.deployment.platformSnapshot?.kind !== "root-release"
  )
    throw new Error(
      "Stopped root accepted prior differs from its frozen successful release",
    );
  return prior;
}

function requireHistoricalPriorReceipt(
  root: ReturnType<typeof application.parse>,
  prior: StoppedRootContext["priorDeployment"],
) {
  if (prior === null) return;
  const snapshot = prior.deployment.platformSnapshot;
  if (snapshot?.kind !== "root-release")
    throw new Error("Accepted prior is not a frozen root release");
  const chart = snapshot.charts.find(({ name }) => name === "apps");
  const receipt = VerifiedRootReleaseReceiptSchema.parse(
    JSON.parse(
      z
        .string()
        .parse(root.metadata.annotations[VERIFIED_ROOT_RELEASE_ANNOTATION]),
    ),
  );
  if (
    receipt.revision !== chart?.artifact.version ||
    receipt.requestId !==
      deliveryOperationId(`${prior.deployment.id}:root-release`) ||
    Date.parse(receipt.operationFinishedAt) <
      Date.parse(receipt.operationStartedAt) ||
    Date.parse(receipt.verifiedAt) < Date.parse(receipt.operationFinishedAt)
  )
    throw new Error(
      "Stopped attempt lost the exact historical accepted root receipt",
    );
}

/** Read-only stopped state is neither a complete release nor an unchanged prior. */
export async function inspectStoppedRootRecovery(
  context: StoppedRootContext,
  effects: {
    read: (name: string) => Promise<unknown>;
    render: (chart: ArtifactVersion) => Promise<unknown[]>;
  },
) {
  const detail = context.deployment;
  const snapshot = detail.deployment.platformSnapshot;
  const prior = requireAcceptedPrior(context);
  if (
    snapshot?.kind !== "root-release" ||
    !["failed", "canceled"].includes(detail.deployment.status) ||
    !detail.deployment.recoveryRequired
  )
    throw new Error(
      "Stopped recovery requires a failed root attempt and its unchanged accepted prior",
    );
  const chart = snapshot.charts.find(({ name }) => name === "apps");
  if (chart === undefined) throw new Error("Frozen root attempt lacks apps");
  const requestId = deliveryOperationId(`${detail.deployment.id}:root-release`);
  const rendered = new Map<string, ReturnType<typeof application.parse>>();
  // Rendered resources have no native UID/status; parse their relevant source metadata separately.
  const expected = new Map<
    string,
    {
      metadata: {
        name: string;
        annotations: Record<string, string>;
        finalizers?: string[] | undefined;
      };
      spec: Record<string, unknown>;
    }
  >();
  for (const raw of await effects.render(chart.artifact)) {
    if (z.object({ kind: z.string() }).parse(raw).kind !== "Application")
      continue;
    const item = z
      .object({
        metadata: z.object({
          name: z.string(),
          annotations: z.record(z.string(), z.string()),
          finalizers: z.array(z.string()).optional(),
        }),
        spec: object,
      })
      .parse(raw);
    if (expected.has(item.metadata.name))
      throw new Error("Frozen root has duplicate Applications");
    expected.set(item.metadata.name, item);
  }
  if (!expected.has("apps") || expected.size > 200)
    throw new Error("Frozen root Application inventory is incomplete");
  const inspect = async (name: string) => {
    const actual = application.parse(
      await effects.read(encodeURIComponent(name)),
    );
    const wanted = expected.get(name);
    if (wanted === undefined) throw new Error("Unknown root Application");
    const delegated = wanted.metadata.annotations[environmentAnnotation];
    if (
      actual.metadata.name !== name ||
      actual.metadata.annotations["argocd.argoproj.io/tracking-id"] !==
        `apps:argoproj.io/Application:argocd/${name}` ||
      actual.metadata.annotations["ci.sjer.red/application-lifecycle"] !==
        wanted.metadata.annotations["ci.sjer.red/application-lifecycle"] ||
      actual.metadata.annotations[environmentAnnotation] !== delegated ||
      (wanted.metadata.finalizers ?? []).some(
        (finalizer) => !(actual.metadata.finalizers ?? []).includes(finalizer),
      ) ||
      (actual.metadata.finalizers ?? []).some(
        (finalizer) =>
          !(wanted.metadata.finalizers ?? []).includes(finalizer) &&
          !controllerFinalizers.has(finalizer),
      ) ||
      canonicalJson(actual.spec["destination"]) !==
        canonicalJson(wanted.spec["destination"]) ||
      canonicalJson(
        rootOwnedSource(actual.spec["source"], delegated !== undefined),
      ) !==
        canonicalJson(
          rootOwnedSource(wanted.spec["source"], delegated !== undefined),
        )
    )
      throw new Error(
        `Stopped root child ${name} differs from frozen source/lifecycle ownership`,
      );
    return actual;
  };
  for (const name of [...expected.keys()].sort())
    rendered.set(name, await inspect(name));
  const root = rendered.get("apps");
  if (root === undefined) throw new Error("Current root is missing");
  requireHistoricalPriorReceipt(root, prior);
  assertDeliveryRootPreservesSelection(root);
  const operation = requireStoppedOperation(
    root,
    chart.artifact.version,
    new Set(expected.keys()),
  );
  const operationId = z.uuid().parse(completedOperationId(root));
  if (
    completedOperationRequestId(root) !== requestId ||
    operationRevision(operation.operation) !== chart.artifact.version ||
    !z
      .object({ automated: z.object({ enabled: z.literal(false) }) })
      .safeParse(root.spec["syncPolicy"]).success
  )
    throw new Error(
      "Stopped root does not retain its owned terminal frozen operation and paused source",
    );
  for (const [name, before] of rendered) {
    const after = await inspect(name);
    if (canonicalJson(after) !== canonicalJson(before))
      throw new Error(
        "Root Application identity/source/operation changed during stopped inspection",
      );
  }
  return {
    state: "stopped" as const,
    observedAt: new Date().toISOString(),
    proofSummary: `Stopped root attempt ${requestId}/${operationId}; ${rendered.size.toString()} frozen root-owned Application identities and sources stable, no active operations; partial health retained without acceptance, prior ${prior?.deployment.id ?? "none"} unchanged`,
    stoppedRoot: {
      requestId,
      operationId,
      revision: chart.artifact.version,
      applications: [...rendered.values()].map((item) => ({
        name: item.metadata.name,
        uid: item.metadata.uid,
        sourceFingerprint: hash(item.spec["source"]),
        specFingerprint: hash(item.spec),
        lifecycleFingerprint: hash(item.metadata),
        targetRevision: z
          .object({ targetRevision: z.string() })
          .parse(item.spec["source"]).targetRevision,
        syncStatus: item.status.sync.status,
        observedRevision: item.status.sync.revision ?? null,
        health: item.status.health?.status ?? null,
        operationPhase: item.status.operationState?.phase ?? null,
      })),
    },
  };
}
