import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ArtifactVersion,
  PlatformRecoveryContext,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import { assertDeliveryRootPreservesSelection } from "homelab/scripts/argocd/argocd-delivery.ts";
import {
  completedOperationRequestId,
  completedOperationId,
  operationRevision,
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

/** Read-only stopped state is neither a complete release nor an unchanged prior. */
export async function inspectStoppedRootRecovery(
  context: {
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
    priorDeployment: unknown;
  },
  effects: {
    read: (name: string) => Promise<unknown>;
    render: (chart: ArtifactVersion) => Promise<unknown[]>;
  },
) {
  const detail = context.deployment;
  const snapshot = detail.deployment.platformSnapshot;
  if (
    context.priorDeployment !== null ||
    snapshot?.kind !== "root-release" ||
    !["failed", "canceled"].includes(detail.deployment.status) ||
    !detail.deployment.recoveryRequired ||
    detail.environment.acceptedPlatformDeploymentId !== null
  )
    throw new Error(
      "Stopped recovery is restricted to an unaccepted failed first root",
    );
  const chart = snapshot.charts.find(({ name }) => name === "apps");
  if (chart === undefined) throw new Error("Frozen first root lacks apps");
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
  assertDeliveryRootPreservesSelection(root);
  const operation = z
    .object({
      phase: z.enum(["Failed", "Error"]),
      finishedAt: z.string().min(1),
      startedAt: z.string().min(1),
      operation: object,
      syncResult: z.object({ revision: z.literal(chart.artifact.version) }),
    })
    .parse(root.status.operationState);
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
    proofSummary: `Stopped unaccepted first root ${requestId}/${operationId}; ${rendered.size.toString()} frozen root-owned Application identities and sources stable, no active operations; partial health retained without acceptance`,
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
