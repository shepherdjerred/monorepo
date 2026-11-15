import { z } from "zod";
import type {
  DeploymentDetail,
  WorkerVersion,
} from "@shepherdjerred/delivery/contract";
import { canonicalJson } from "homelab/scripts/canonical-json.ts";
import {
  ManagedResourcesSchema,
  parseObject,
  type ManagedResource,
} from "homelab/scripts/argocd/argocd-apply-safety.ts";
import { ArgoResourceSchema } from "#lib/delivery/argocd-proof.ts";
import { requireRenderedSource } from "#lib/delivery/model/application-proof.ts";
import type { RenderedApplication } from "#lib/delivery/model/application.ts";
import { deliveryWorkerPool, renderedWorkerPool } from "./worker-pool.ts";

/** The objects the worker chart renders for one retained host. */
const HOST_KINDS = new Set([
  "apps/Deployment",
  "/ServiceAccount",
  "/Service",
  "monitoring.coreos.com/ServiceMonitor",
]);
/** Every per-host object name carries `delivery-wf-retained-<first 12 of the Build ID>`. */
const HOST_TRACK = /(?:^|-)delivery-wf-retained-([a-f0-9]{12})(?:-|$)/u;
const BUILD_LABEL = "delivery.shepherdjerred.com/worker-build";

const Native = ArgoResourceSchema.extend({
  metadata: ArgoResourceSchema.shape.metadata.extend({
    uid: z.string().min(1),
  }),
}).loose();
const HostDeployment = z.object({
  spec: z.object({
    replicas: z.number().int().nonnegative(),
    template: z.object({
      metadata: z.object({ labels: z.record(z.string(), z.string()) }),
    }),
  }),
  status: z
    .object({ replicas: z.number().int().nonnegative().optional() })
    .default({}),
});

function retiredHost(
  resource: ManagedResource,
  namespace: string,
  retired: ReadonlyMap<string, WorkerVersion>,
): WorkerVersion | undefined {
  const track = HOST_TRACK.exec(resource.name)?.[1];
  return track === undefined ||
    resource.namespace !== namespace ||
    !HOST_KINDS.has(`${resource.group ?? ""}/${resource.kind}`)
    ? undefined
    : retired.get(track);
}

/** The live object is exactly the retired host's, owned by this Application and already at zero. */
function assertRetiredHostObject(
  raw: unknown,
  cached: z.infer<typeof Native>,
  context: {
    application: string;
    resource: ManagedResource;
    worker: WorkerVersion;
    seen: Set<string>;
  },
) {
  const { application, resource, worker, seen } = context;
  const native = Native.parse(raw);
  const { metadata } = native;
  const group = resource.group ?? "";
  if (
    metadata.uid !== cached.metadata.uid ||
    seen.has(metadata.uid) ||
    native.kind !== resource.kind ||
    metadata.name !== resource.name ||
    metadata.namespace !== resource.namespace ||
    metadata.deletionTimestamp !== undefined ||
    metadata.annotations?.["argocd.argoproj.io/hook"] !== undefined ||
    metadata.annotations?.["argocd.argoproj.io/tracking-id"] !==
      `${application}:${group}/${resource.kind}:${resource.namespace ?? ""}/${resource.name}`
  )
    throw new Error(
      `Retired worker host object ${group}/${resource.kind} ${resource.name} is not the exact owned resource`,
    );
  seen.add(metadata.uid);
  if (resource.kind !== "Deployment") return;
  const host = HostDeployment.parse(raw);
  if (
    host.spec.replicas !== 0 ||
    (host.status.replicas ?? 0) !== 0 ||
    host.spec.template.metadata.labels[BUILD_LABEL] !== worker.buildId
  )
    throw new Error(
      `Retired worker host ${resource.name} is not its build's Deployment at zero replicas`,
    );
}

/**
 * Whether the owned sync of a worker Application prunes. The rendered pool
 * leaves out every host an earlier retirement scaled to zero, so ArgoCD
 * marks their objects for pruning. It prunes only when every obsolete object
 * is one of those hosts' and each is the exact owned object, its Deployment
 * already at zero replicas for that build. Any other obsolete object leaves
 * the sync unpruned, as before, so this never deletes what it cannot prove.
 */
export async function workerSyncPrunes(
  detail: DeploymentDetail,
  rendered: Pick<
    RenderedApplication,
    "name" | "environmentId" | "revision" | "source"
  >,
  read: (path: string) => Promise<unknown>,
): Promise<boolean> {
  const pool = deliveryWorkerPool(detail);
  const host = pool?.versions[0]?.host;
  if (pool === undefined || host?.application !== rendered.name) return false;
  const kept = new Set(
    renderedWorkerPool(pool).versions.map((worker) => worker.buildId),
  );
  const retired = new Map(
    pool.versions
      .filter((worker) => !kept.has(worker.buildId))
      .map((worker) => [worker.buildId.slice(0, 12), worker]),
  );
  if (retired.size === 0) return false;
  const app = encodeURIComponent(rendered.name);
  const before = requireRenderedSource(
    await read(`${app}?refresh=hard`),
    rendered,
  );
  if (
    ["Running", "Terminating"].includes(
      before.status.operationState?.phase ?? "",
    )
  )
    throw new Error("Worker host pruning requires a settled Application");
  const desired = new Set(
    z
      .object({ manifests: z.array(z.string()) })
      .parse(
        await read(
          `${app}/manifests?revision=${encodeURIComponent(rendered.revision)}`,
        ),
      )
      .manifests.map(
        (manifest) =>
          ArgoResourceSchema.parse(JSON.parse(manifest)).metadata.name,
      ),
  );
  const obsolete = ManagedResourcesSchema.parse(
    await read(`${app}/managed-resources`),
  ).items.filter(
    (resource) =>
      parseObject(resource.liveState, resource, "liveState") !== null &&
      parseObject(resource.targetState, resource, "targetState") === null,
  );
  if (obsolete.length === 0) return false;
  const proven: { resource: ManagedResource; worker: WorkerVersion }[] = [];
  for (const resource of obsolete) {
    const worker = retiredHost(resource, host.kubernetesNamespace, retired);
    // Another obsolete object stays prune-pending, as it did before.
    if (worker === undefined || desired.has(resource.name)) return false;
    proven.push({ resource, worker });
  }
  const seen = new Set<string>();
  for (const { resource, worker } of proven) {
    const cached = Native.parse(
      parseObject(resource.liveState, resource, "liveState"),
    );
    const query = new URLSearchParams({
      namespace: host.kubernetesNamespace,
      resourceName: resource.name,
      group: resource.group ?? "",
      version: cached.apiVersion.slice(cached.apiVersion.lastIndexOf("/") + 1),
      kind: resource.kind,
    });
    const native = z
      .object({ manifest: z.string() })
      .parse(await read(`${app}/resource?${query.toString()}`));
    assertRetiredHostObject(JSON.parse(native.manifest), cached, {
      application: rendered.name,
      resource,
      worker,
      seen,
    });
  }
  const after = requireRenderedSource(await read(app), rendered);
  if (
    after.metadata.uid !== before.metadata.uid ||
    canonicalJson(after.spec) !== canonicalJson(before.spec)
  )
    throw new Error("Worker Application changed before its pruning sync");
  return true;
}
