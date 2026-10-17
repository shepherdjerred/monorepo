import { z } from "zod";
import { canonicalOrder } from "#migration/canonical-order.ts";
import { LegacyControllerSchema } from "#shared/legacy-observer.ts";
import { LEGACY_OBSERVER_CONFIG } from "./config.ts";
import {
  observerDigest as snapshotHash,
  LegacyObservationError,
  type Resource,
} from "./wire.ts";
import {
  possibleLegacyWriter,
  relevantClaimNames,
  writesRelevantClaim,
} from "./relevance.ts";

const replicas = z.object({
  replicas: z.int().nonnegative().optional(),
  readyReplicas: z.int().nonnegative().optional(),
  observedGeneration: z.int().nonnegative().optional(),
});
type Blocker = { code: string; kind: string; name: string };

function lineage(
  item: Resource,
  objects: Map<string, Resource>,
  seen = new Set<string>(),
): "legacy" | "retained" | "read_only" | "unknown" {
  if (seen.has(item.metadata.uid))
    throw new LegacyObservationError("owner_cycle");
  seen.add(item.metadata.uid);
  if (item.kind === "Deployment") {
    if (LEGACY_OBSERVER_CONFIG.legacyDeployments.includes(item.metadata.name))
      return "legacy";
    if (LEGACY_OBSERVER_CONFIG.readOnlyDeployments.includes(item.metadata.name))
      return "read_only";
    if (LEGACY_OBSERVER_CONFIG.retainedDeployments.includes(item.metadata.name))
      return "retained";
  }
  if (
    item.kind === "StatefulSet" &&
    LEGACY_OBSERVER_CONFIG.retainedStatefulSets.includes(item.metadata.name)
  )
    return "retained";
  const owners = item.metadata.ownerReferences;
  if (owners.length !== 1) return "unknown";
  const ref = owners[0];
  const parent = ref === undefined ? undefined : objects.get(ref.uid);
  return !parent ||
    parent.kind !== ref?.kind ||
    parent.metadata.name !== ref.name
    ? "unknown"
    : lineage(parent, objects, seen);
}

function objectBlocker(
  item: Resource,
  ownership: string,
  claims: Set<string>,
): string | undefined {
  if (ownership === "retained") return undefined;
  if (ownership === "read_only")
    return writesRelevantClaim(item, claims)
      ? "retained_consumer_library_writable"
      : undefined;
  if (item.metadata.deletionTimestamp !== undefined)
    return "controller_or_pod_terminating";
  if (item.kind === "Pod")
    return ["Succeeded", "Failed"].includes(String(item.status["phase"]))
      ? undefined
      : "live_or_unknown_pod";
  if (item.kind === "ReplicaSet") return replicaSetBlocker(item);
  if (item.kind === "Job") return jobBlocker(item);
  if (item.kind === "CronJob") return scheduleBlocker(item);
  return ownership === "legacy" && item.kind === "Deployment"
    ? undefined
    : "unrecognized_writer_controller";
}
function replicaSetBlocker(item: Resource) {
  const desired = replicas.parse(item.spec).replicas ?? 1;
  const status = replicas.parse(item.status);
  return desired === 0 &&
    (status.replicas ?? 0) === 0 &&
    (status.readyReplicas ?? 0) === 0
    ? undefined
    : "replicaset_not_stopped";
}
function jobBlocker(item: Resource) {
  return item.status["completionTime"] !== undefined &&
    (item.status["active"] ?? 0) === 0
    ? undefined
    : "job_not_completed";
}
function scheduleBlocker(item: Resource) {
  const active = z.array(z.unknown()).parse(item.status["active"] ?? []);
  return item.spec["suspend"] === true && active.length === 0
    ? undefined
    : "schedule_not_suspended";
}

function fingerprint(item: Resource) {
  return {
    kind: item.kind,
    name: item.metadata.name,
    uid: item.metadata.uid,
    generation: item.metadata.generation ?? null,
    specDigest: snapshotHash(item.spec),
    statusDigest: snapshotHash(item.status),
    deleting: item.metadata.deletionTimestamp ?? null,
  };
}
function isRelevant(item: Resource, ownership: string, claims: Set<string>) {
  return ownership !== "unknown" || possibleLegacyWriter(item, claims);
}
export function evaluateInventory(resources: Resource[]) {
  const byUid = new Map(resources.map((item) => [item.metadata.uid, item]));
  if (byUid.size !== resources.length)
    throw new LegacyObservationError("duplicate_uid");
  const blockers: Blocker[] = [];
  const controllers: z.infer<typeof LegacyControllerSchema>[] = [];
  for (const name of LEGACY_OBSERVER_CONFIG.legacyDeployments) {
    const item = resources.find(
      (value) => value.kind === "Deployment" && value.metadata.name === name,
    );
    if (!item) {
      blockers.push({ code: "target_missing", kind: "Deployment", name });
      continue;
    }
    const spec = replicas.parse(item.spec);
    const status = replicas.parse(item.status);
    const controller = LegacyControllerSchema.parse({
      kind: "Deployment",
      name,
      uid: item.metadata.uid,
      generation: item.metadata.generation,
      resourceVersion: item.metadata.resourceVersion,
      specDigest: snapshotHash(item.spec),
      desired: spec.replicas ?? 1,
      current: status.replicas ?? 0,
      ready: status.readyReplicas ?? 0,
      observedGeneration: status.observedGeneration ?? 0,
    });
    controllers.push(controller);
    if (
      [controller.desired, controller.current, controller.ready].some(
        (count) => count !== 0,
      )
    )
      blockers.push({ code: "target_not_stopped", kind: item.kind, name });
    if (controller.observedGeneration < controller.generation)
      blockers.push({ code: "controller_not_observed", kind: item.kind, name });
  }
  const relevant: unknown[] = [];
  const claims = relevantClaimNames(resources);
  for (const item of resources) {
    const ownership = lineage(item, byUid);
    if (!isRelevant(item, ownership, claims)) continue;
    const code = objectBlocker(item, ownership, claims);
    if (code !== undefined)
      blockers.push({ code, kind: item.kind, name: item.metadata.name });
    if (ownership !== "retained") relevant.push(fingerprint(item));
  }
  blockers.sort((a, b) =>
    canonicalOrder(
      `${a.kind}/${a.name}/${a.code}`,
      `${b.kind}/${b.name}/${b.code}`,
    ),
  );
  relevant.sort((a, b) => canonicalOrder(snapshotHash(a), snapshotHash(b)));
  return {
    controllers,
    blockers,
    inventoryDigest: snapshotHash(relevant),
    quiescent: blockers.length === 0,
  };
}
